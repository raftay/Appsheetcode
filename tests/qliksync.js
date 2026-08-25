/* QlikSync.gs, run for real against a fake Spreadsheet + Drive service.
 *
 * Two things this file has to keep getting right.
 *
 *   BATCHING   The band of array formulas is restored a RUN at a time, not a
 *              CELL at a time. Every one of those was a round trip to Sheets,
 *              and the count is what used to push a sync past the Apps Script
 *              runtime limit and get the trigger killed mid-write. Batching
 *              them must change no formula: every anchor still comes back
 *              re-pointed at the new height, its own and across tabs.
 *
 *   OWNERSHIP  The sync owns the columns it pairs, from the first data row
 *              down, and NOTHING ELSE on the tab. Two ways it used to take
 *              more than that, and both are gated here:
 *
 *              It cleared the whole formula band before writing and put it
 *              back only after the LAST tab of the workbook, so a run that
 *              died in between deleted every anchor with nothing left to
 *              restore — and nothing for the next run to find either. Now only
 *              a formula sitting in a column the export feeds is cleared, and
 *              the harness makes a write throw to prove the rest survive it.
 *
 *              ROWS ARE THE OTHER WAY ROUND and stay that way: the data ends
 *              exactly where the export ends, surplus rows deleted. Every
 *              formula on these tabs is a single-cell ARRAY formula on the
 *              first data row — nothing is filled down — so a surplus row
 *              holds no formula of anybody's, and leaving them would have
 *              January reading a December-sized sheet for eleven months.
 *
 *   THE CHECK  Nothing in the UI starts a sync. One time-driven trigger
 *              compares each export FILE's modified time against the one it
 *              last synced, and does nothing at all for the ones that have not
 *              moved — so an ordinary firing is three Drive lookups and pages
 *              keep serving from cache. One file per page, so a re-exported
 *              Aggregates file costs an Aggregates sync and nothing else.
 *
 *              The retry rule matters too: a run that could not HAPPEN (the
 *              lock was held) keeps no stamp and is tried again, while a run
 *              that finished with a broken TAB does keep its stamp — that tab
 *              will be just as broken next time, and re-syncing forever
 *              neither fixes it nor tells anybody.
 *
 *   node tests/qliksync.js
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const { load: loadRegions } = require('./scriptgs.js');   // qliksync has its own load()
const REPO = path.resolve(__dirname, '..');

let fails = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) console.log(`         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`);
}
function checkThat(name, ok, detail) {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok && detail !== undefined) console.log(`         ${detail}`);
}

/* ======================================================================
 * A fake Sheets service: a grid of { v, f } cells, and a log of every
 * write call made against it. The log is the point — the timeout fix is a
 * claim about HOW MANY calls the sync makes.
 * ==================================================================== */
const RealDate = Date;
let CLOCK = RealDate.UTC(2026, 7, 13, 6, 0, 0);   /* virtual, ms */
let TICK = 0;                                     /* ms added per write call */
let OPS = [];                                     /* every write, in order */
let BOOM = null;                                  /* (sheet, a1) => a VALUE write throws */
let BOOM_F = null;                                /* (sheet, a1) => a FORMULA write throws */
let SHORT = null;                                 /* drop writes past this row  */

function colA1(c) {                               /* 1-based → A, B, … */
  let s = '';
  while (c > 0) { const r = (c - 1) % 26; s = String.fromCharCode(65 + r) + s; c = (c - 1 - r) / 26; }
  return s;
}
function cell(x) {
  if (x && typeof x === 'object' && 'f' in x) return { v: '', f: x.f };
  return { v: x === undefined ? '' : x, f: '' };
}

function makeSheet(name, rows) {
  const grid = rows.map(r => r.map(cell));
  let nCols = Math.max(...grid.map(r => r.length));
  grid.forEach(r => { while (r.length < nCols) r.push(cell('')); });

  const sh = {
    getName: () => name,
    getMaxRows: () => grid.length,
    /* What settle_ polls: the last row carrying anything. A converted copy that
       is still filling answers this with less than it will in a moment, which
       is the whole failure it exists to wait out. */
    getLastRow: () => {
      let last = 0;
      grid.forEach((r, i) => { if (r.some(c => c.v !== '' || c.f !== '')) last = i + 1; });
      return last;
    },
    getMaxColumns: () => nCols,
    _grid: () => grid,

    getRange(r, c, nr, nc) {
      nr = nr === undefined ? 1 : nr;
      nc = nc === undefined ? 1 : nc;
      const a1 = colA1(c) + r + (nr > 1 || nc > 1 ? ':' + colA1(c + nc - 1) + (r + nr - 1) : '');
      const at = (i, j) => grid[r - 1 + i][c - 1 + j];
      const log = op => OPS.push({ sheet: name, op, a1, cells: nr * nc });
      const span = fn => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) fn(i, j); };
      const rng = {
        getA1Notation: () => a1,
        getValues:   () => Array.from({ length: nr }, (_, i) =>
                             Array.from({ length: nc }, (_, j) => at(i, j).v)),
        getFormulas: () => Array.from({ length: nr }, (_, i) =>
                             Array.from({ length: nc }, (_, j) => at(i, j).f)),
        setValues(g) {
          /* The runtime limit, in a form a harness can reach: BOOM makes one
             write blow up where a killed execution would simply stop. What has
             to be true either way is that the anchors are still on the sheet. */
          if (BOOM && BOOM(name, a1)) { log('setValues'); throw new Error('write failed'); }
          log('setValues'); CLOCK += TICK;
          /* AND THE QUIETER HALF OF THE SAME FAILURE. A kill does not always
             throw where the harness can see it — the rows simply stop arriving,
             which is what a tab ending at 1,113 of 49,000 looks like from the
             outside. SHORT drops every write past a row so the post-write check
             has something real to catch. */
          span((i, j) => {
            if (SHORT != null && r + i > SHORT) return;
            at(i, j).v = g[i][j]; at(i, j).f = '';
          });
          return rng;
        },
        setFormulas(g) {
          /* SEPARATE FROM BOOM, and it has to be. Putting the band back is
             wrapped in its own catch in two places, and the tab it leaves
             behind is not the one a failed DATA write leaves — so a harness
             that made both fail together could not tell them apart. */
          if (BOOM_F && BOOM_F(name, a1)) { log('setFormulas'); throw new Error('formula write failed'); }
          log('setFormulas'); CLOCK += TICK;
          span((i, j) => { at(i, j).f = g[i][j]; at(i, j).v = ''; });
          return rng;
        },
        setFormula(f) {
          log('setFormula'); CLOCK += TICK;
          span((i, j) => { at(i, j).f = f; at(i, j).v = ''; });
          return rng;
        },
        clearContent() {
          log('clearContent'); CLOCK += TICK;
          span((i, j) => { at(i, j).v = ''; at(i, j).f = ''; });
          return rng;
        },
        setNumberFormat() { log('setNumberFormat'); return rng; },
      };
      return rng;
    },
    getDataRange() { return sh.getRange(1, 1, grid.length, nCols); },
    clearContents() {
      OPS.push({ sheet: name, op: 'clearContents', a1: 'all', cells: 0 });
      grid.forEach(r => r.forEach(c2 => { c2.v = ''; c2.f = ''; }));
    },
    insertRowsAfter(after, howMany) {
      const blank = () => Array.from({ length: nCols }, () => cell(''));
      grid.splice(after, 0, ...Array.from({ length: howMany }, blank));
    },
    deleteRows(from, howMany) { grid.splice(from - 1, howMany); },
    insertColumnsAfter(after, howMany) {
      nCols += howMany;
      grid.forEach(r => r.splice(after, 0, ...Array.from({ length: howMany }, () => cell(''))));
    },
  };
  return sh;
}

/* Every cell of a tab, value and formula, as one comparable string. What most
   of the gate checks below actually assert is that this does not move. */
function snap(sh) { return JSON.stringify(sh._grid()); }

function makeBook(sheets) {
  return {
    getSheets: () => sheets,
    getSheetByName: n => sheets.filter(s => s.getName() === n)[0] || null,
  };
}

/* ======================================================================
 * Fixtures — shaped like the real thing, small enough to reason about.
 *
 * The Price & Volume workbook is the interesting one: a banner row above the
 * header, and a first data row carrying array formulas in columns the export
 * never feeds. Those formulas are what the sync has to lift out, keep, and put
 * back re-pointed at the new height.
 * ==================================================================== */
const RAW_TAB   = 'Combined Data CPI Raw';
const OTHER_TAB = 'Combined Data CPI Other Revenue';

/* Column 1 stands alone; columns 8-12 are one contiguous run. Cell-at-a-time
   that is 6 calls to clear and 6 to restore; run-at-a-time it is 2 and 2. */
const RAW_FORMULAS = {
  1:  '=ARRAYFORMULA(IF(B3:B50040="","",B3:B50040&"-"&C3:C50040))',
  8:  '=ARRAYFORMULA(F3:F50040*1)',
  9:  "=ARRAYFORMULA('Combined Data CPI Other Revenue'!C3:C50040)",
  10: '=ARRAYFORMULA(H3:H50040-I3:I50040)',
  11: '=SUM($G$3:$G$50040)',
  12: '=ARRAYFORMULA(IF(D3:D50040="","",1))',
};

function rawSheet() {
  /* COLUMN M IS SOMEBODY ELSE'S. The export does not feed it and the sync has
     never heard of it: a note on the first data row and content under it. The
     sync must read straight past the whole column — never clear it, never
     write into it — while still doing what it likes with the ROWS, which
     belong to the export. */
  const hdr = ['LOOKUP KEY', 'Year', 'Month', 'Plant Type', 'Material Family',
               'Fuel Surchage', 'Volume', 'CY Fuel', 'PY Fuel', 'Net', 'Adj', 'Flag',
               'Notes'];
  const banner  = ['Bill Year', 2025, 2025, '', '', '', '', '', '', '', '', '', ''];
  const anchors = hdr.map((_, i) => (RAW_FORMULAS[i + 1] ? { f: RAW_FORMULAS[i + 1] } : ''));
  anchors[12] = 'keep-3';                     /* a plain value, not a formula */
  const stale = n => ['', 'OLD', 'OLD', 'OLD', 'OLD', 'OLD', 'OLD', '', '', '', '', '',
                      { f: '=B' + n + '&"-note"' }];
  /* ten rows in the sheet, five in the export: it used to shrink */
  return makeSheet(RAW_TAB, [banner, hdr, anchors, stale(4), stale(5), stale(6),
                             stale(7), stale(8), stale(9), stale(10)]);
}
function otherSheet() {
  const hdr = ['LOOKUP KEY', 'Year', 'Month', 'Other Revenue'];
  const anchors = [{ f: '=ARRAYFORMULA(IF(B2:B50040="","",B2:B50040))' }, '', '', ''];
  return makeSheet(OTHER_TAB, [hdr, anchors, ['', 'OLD', 'OLD', 'OLD'],
                               ['', 'OLD', 'OLD', 'OLD'], ['', 'OLD', 'OLD', 'OLD'],
                               ['', 'OLD', 'OLD', 'OLD']]);
}

/* The two AGG exports, as QlikView sends them: header on row 1, data under. */
function exportBook() {
  const raw = [['Year', 'Month', 'Plant Type', 'Material Family', 'Fuel Surchage', 'Volume']];
  for (let i = 1; i <= 5; i++) raw.push([2026, 'Apr', 'Fixed', 'Sand', 10 * i, 100 * i]);
  const other = [['Year', 'Month', 'Other Revenue']];
  for (let i = 1; i <= 3; i++) other.push([2026, 'Apr', 7 * i]);
  return makeBook([makeSheet('CPI Raw Export', raw), makeSheet('CPI Other Export', other)]);
}

/* ======================================================================
 * The context: Config.gs for APP_CONFIG, then QlikSync.gs on top of it.
 * ==================================================================== */
let PROPS = {};
let BOOKS = {};
let SYNC_ALL_CALLS = 0;
/* WHICH EXPORT THE SYNC IS ABOUT TO READ. The gate below compares an export
   against the shape of the LAST GOOD ONE, so proving anything about it needs
   two runs with different files — a good one to set the baseline, then the bad
   one. Reset to the good export by load(). */
let EXPORT = exportBook;
let SLEPT = [];        /* every Utilities.sleep, in ms */
let MAILS = [];        /* every MailApp.sendEmail, in order */
let TRIGGERS = [];     /* the project's triggers, as ScriptApp sees them */
const AGG_ID = '19ptynrhtzC-Noi71znNbVIJw8GDmPUxZ';
const RMX_ID = '1wUb82e1PVxstddK9IE2VxYLSQEicVAGK';
const SEG_ID = '1d1XzYlENUyE6sxBewCd-Q3GpjTNzgRZH';
const NAMES = { [AGG_ID]: 'Agg Margin Monitor Export.xls',
                [RMX_ID]: 'CAN RMX Margin Monitor 2.xls',
                [SEG_ID]: 'CAN RMX Margin Monitor 3.xls' };
let MTIME = {};                                   /* per export file */

function load({ tick = 0, lockFree = true } = {}) {
  PROPS = {}; OPS = []; TICK = tick; SYNC_ALL_CALLS = 0; BOOM = null; BOOM_F = null;
  EXPORT = exportBook; MAILS = []; TRIGGERS = []; SLEPT = []; SHORT = null;
  MTIME = { [AGG_ID]: 1000, [RMX_ID]: 2000, [SEG_ID]: 3000 };
  CLOCK = RealDate.UTC(2026, 7, 13, 6, 0, 0);

  const sheets = { raw: rawSheet(), other: otherSheet() };
  BOOKS = { pricevolume: makeBook([sheets.raw, sheets.other]), _sheets: sheets };

  class FakeDate {
    constructor(...a) { this._t = a.length ? new RealDate(...a).getTime() : CLOCK; }
    getTime()     { return this._t; }
    valueOf()     { return this._t; }
    toISOString() { return new RealDate(this._t).toISOString(); }
  }
  FakeDate.UTC = RealDate.UTC;
  FakeDate.now = () => CLOCK;

  const ctx = {
    Date: FakeDate,
    JSON, Math, Object, Array, String, Number, RegExp, Error, isNaN, parseInt, parseFloat,
    console: { log: () => {}, error: () => {}, warn: () => {} },
    Logger: { log: () => {} },

    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in PROPS ? PROPS[k] : null),
        setProperty: (k, v) => { PROPS[k] = String(v); },
        deleteProperty: k => { delete PROPS[k]; },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => lockFree, releaseLock: () => {} }) },
    SpreadsheetApp: {
      openById: id => ((id in NAMES) ? EXPORT() : BOOKS[id]),
      flush: () => {},
    },
    DriveApp: {
      /* One export file per source id, each with its own modified time, so the
         check can be watched picking up one and leaving the others alone. */
      getFileById: id => {
        if (!(id in MTIME)) return { setTrashed: () => {} };   /* the temp copy */
        return {
          getId: () => id,
          getName: () => NAMES[id],
          getMimeType: () => 'application/vnd.google-apps.spreadsheet',
          getLastUpdated: () => new RealDate(MTIME[id]),
          setTrashed: () => {},
        };
      },
    },
    Session: { getScriptTimeZone: () => 'America/Toronto',
               getEffectiveUser: () => ({ getEmail: () => 'ops@example.test' }) },
    /* sleep() ADVANCES THE VIRTUAL CLOCK rather than the real one, so settle_'s
       wait is observable without the harness taking nine seconds to run. */
    Utilities: { formatDate: d => String(d),
                 sleep: ms => { CLOCK += ms; SLEPT.push(ms); } },
    MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
    /* A failed run reports itself by mail and arms one retry, and both are
       silent-on-throw by design — so without these two the checks below would
       pass against a run that told nobody anything. */
    MailApp: { sendEmail: m => { MAILS.push(m); } },
    ScriptApp: {
      getOAuthToken: () => 'tok',
      getProjectTriggers: () => TRIGGERS.slice(),
      deleteTrigger: t => { const i = TRIGGERS.indexOf(t); if (i !== -1) TRIGGERS.splice(i, 1); },
      newTrigger: fn => ({ timeBased: () => ({ after: ms => ({ create: () => {
        const t = { getHandlerFunction: () => fn, _after: ms };
        TRIGGERS.push(t); return t;
      } }) }) }),
    },
    UrlFetchApp: { fetch: () => { throw new Error('no conversion expected'); } },
    syncAll: () => { SYNC_ALL_CALLS++; return { ok: true }; },
  };
  ctx.global = ctx;
  vm.createContext(ctx);
  loadRegions(ctx, 'Config.gs');
  /* the page's workbook comes from the fake service, not from a property */
  ctx.APP_openSpreadsheet_ = page => {
    if (!BOOKS[page]) throw new Error('no fake workbook for ' + page);
    return BOOKS[page];
  };
  /* §5 builds QLIKSYNC; §11 holds the four entry points that drive it. */
  loadRegions(ctx, 'QlikSync.gs');
  return ctx;
}

const writes = sheet => OPS.filter(o => o.sheet === sheet &&
  ['clearContent', 'setValues', 'setFormula', 'setFormulas', 'clearContents'].indexOf(o.op) !== -1);
/* Tolerant of a row that is not there: a regression that SHRINKS the sheet has
   to read as a failed check, not as a stack trace that hides the ones after
   it — which is exactly how the row-deletion mutation first presented. */
const formulaRow = (sh, row) => (sh._grid()[row - 1] || []).map(c => c.f);
const valuesIn = (sh, r, c, nr, nc) =>
  (sh.getMaxRows() >= r + nr - 1)
    ? sh.getRange(r, c, nr, nc).getValues()
    : 'the sheet is only ' + sh.getMaxRows() + ' rows tall';

/* ======================================================================
 * 1. The run does what it always did
 * ==================================================================== */
console.log('a clean run over both Price & Volume tabs:');
{
  const ctx = load();
  const res = ctx.qlikSyncNow('pricevolume');

  check('it reports success', res.ok, true);
  check('nothing failed', res.failed, []);
  check('both tabs were written', res.done.map(d => d.tab).sort(), [OTHER_TAB, RAW_TAB]);
  check('the raw tab took all five export rows', res.done.filter(d => d.tab === RAW_TAB)[0].rows, 5);

  const raw = BOOKS._sheets.raw, other = BOOKS._sheets.other;
  /* The export is five rows and the sheet is ten: the surplus goes. Leaving it
     would have January reading a December-sized sheet for eleven months, and
     no reader can tell an empty row from one the export stopped sending. */
  check('the sheet ends exactly where the export does', raw.getMaxRows(), 7);
  check('...and so does the other-revenue tab', other.getMaxRows(), 4);
  check('the export data landed', raw.getRange(3, 6, 1, 2).getValues(), [[10, 100]]);
  check('the last export row landed', raw.getRange(7, 6, 1, 2).getValues(), [[50, 500]]);
  check('no stale row survived underneath', raw.getRange(7, 2, 1, 1).getValues(), [[2026]]);
}

/* ======================================================================
 * 1b. A column the export does not feed is not the sync's to touch
 * ----------------------------------------------------------------------
 * THE RULE HAS TWO HALVES AND THEY POINT OPPOSITE WAYS. Rows below the data
 * belong to the export and go when it shrinks — checked above. COLUMNS do not:
 * the sync writes the ones it paired and reads past everything else, whatever
 * is in it and whether or not this file has heard of it.
 * ==================================================================== */
console.log('\na column nobody told the sync about is read past, not written:');
{
  const ctx = load();
  ctx.qlikSyncNow('pricevolume');
  const raw = BOOKS._sheets.raw;

  check('the note on the first data row is still there',
    valuesIn(raw, 3, 13, 1, 1), [['keep-3']]);
  check('and its content across the data is untouched',
    raw._grid().slice(3).map(r => r[12].f),
    ['=B4&"-note"', '=B5&"-note"', '=B6&"-note"', '=B7&"-note"']);
  check('nothing was written into it either',
    OPS.filter(o => o.sheet === RAW_TAB && /M/.test(o.a1) && o.op !== 'clearContents').length, 0);
}

/* ======================================================================
 * 1c. The run says WHEN it wrote, and off which export
 * ----------------------------------------------------------------------
 * The header's stamp cannot read this off Drive. A row typed into a lookup tab
 * moves the workbook's modified time exactly as a sync does, so the only thing
 * that can say "QlikView updated this sheet" is the run that did it.
 * ==================================================================== */
console.log('\nthe run records when this page was last written from QlikView:');
{
  const ctx = load();
  ctx.qlikSyncNow('pricevolume');
  const log = JSON.parse(PROPS.QLIK_LAST_SYNC || '{}');

  check('it recorded the page it wrote', Object.keys(log), ['pricevolume']);
  check('with both tabs', log.pricevolume.tabs, 2);
  check('and none of them broken', log.pricevolume.failed, 0);
  check('the export it read is dated', log.pricevolume.exportAt, MTIME[AGG_ID]);
  check('and named', log.pricevolume.exportName, NAMES[AGG_ID]);
  checkThat('the time it WROTE is its own, not the export\'s date',
    log.pricevolume.at !== log.pricevolume.exportAt,
    'the two clocks have been collapsed into one');

  /* A run for one page must not wipe another page's stamp — the same trap
     qlikSyncNow already guards for the file stamps, one property over. */
  ctx.qlikSyncNow('rmx');
  const after = JSON.parse(PROPS.QLIK_LAST_SYNC || '{}');
  check('and a run for another page leaves it alone',
    after.pricevolume && after.pricevolume.tabs, 2);
}

/* ======================================================================
 * 2. Every anchor formula comes back, re-pointed
 * ==================================================================== */
console.log('\nthe array formulas are restored at the new height:');
{
  const ctx = load();
  ctx.qlikSyncNow('pricevolume');
  const got = formulaRow(BOOKS._sheets.raw, 3);

  check('its own rows are re-pointed at the sheet end',
    got[0], '=ARRAYFORMULA(IF(B3:B7="","",B3:B7&"-"&C3:C7))');
  check('a plain range too', got[7], '=ARRAYFORMULA(F3:F7*1)');
  check('a cross-tab range follows the OTHER tab\'s height',
    got[8], "=ARRAYFORMULA('Combined Data CPI Other Revenue'!C3:C4)");
  check('two ranges in one formula both move', got[9], '=ARRAYFORMULA(H3:H7-I3:I7)');
  check('an absolute range moves as well', got[10], '=SUM($G$3:$G$7)');
  check('and the last of the run is not dropped', got[11], '=ARRAYFORMULA(IF(D3:D7="","",1))');
  check('the other tab keeps its own anchor',
    formulaRow(BOOKS._sheets.other, 2)[0], '=ARRAYFORMULA(IF(B2:B4="","",B2:B4))');

  const mapped = formulaRow(BOOKS._sheets.raw, 3).filter((f, i) => f && i >= 1 && i <= 6);
  check('no formula was written into a column the export feeds', mapped, []);
}

/* ======================================================================
 * 3. The count of calls — this is the timeout
 * ==================================================================== */
console.log('\nthe formula band is handled a run at a time, not a cell at a time:');
{
  const ctx = load();
  ctx.qlikSyncNow('pricevolume');

  const restores = OPS.filter(o => o.sheet === RAW_TAB && o.op === 'setFormulas');
  const perCell  = OPS.filter(o => o.op === 'setFormula');

  /* TWO PASSES, EACH A RUN AT A TIME. The band goes back the moment THIS tab is
     written — so the window it is absent for is one tab's write rather than the
     whole workbook's pass — and again at the end of run(), because a reference
     into a sibling tab cannot be re-pointed until every tab has its final
     height. Six formulas in two runs, twice over, is four calls; what must
     never happen is a call per cell, which is what used to push a sync past the
     runtime limit. */
  check('six formulas go back a run at a time, in two passes', restores.length, 4);
  check('each pass covers the five-column run in one call',
    restores.filter(o => o.cells === 5).length, 2);
  check('nothing goes back one cell at a time', perCell.length, 0);

  /* AND THEY DO COME OUT, WHICH IS THE 08-24 CHANGE AND NOT A REGRESSION OF THE
     08-23 ONE. Leaving the band on the tab means every setValues into a mapped
     column re-evaluates the LOOKUP KEY array formula over the whole column
     before the next block can go in, dozens of times over a 47,000-row export —
     which is what turned a write that finished into one that did not. What made
     taking it out safe the second time is that it is PARKED in a script
     property first, so a killed execution has something to put back; the two
     tests below are the halves of that. (The block clear that precedes the data
     write spans B3:G10 and is not one of these.) */
  const bandClears = OPS.filter(o =>
    o.sheet === RAW_TAB && o.op === 'clearContent' && /^[A-M]3(:[A-M]3)?$/.test(o.a1));
  check('the band is cleared a run at a time too', bandClears.length, 2);

  checkThat('the whole tab costs well under a call per cell',
    writes(RAW_TAB).length <= 12, `${writes(RAW_TAB).length} write calls: ` +
    JSON.stringify(writes(RAW_TAB).map(o => o.op + ' ' + o.a1)));
}

/* ======================================================================
 * 3a. The park, and the warning it used to leave behind
 * ----------------------------------------------------------------------
 * The band is taken off the tab for the write, so between the clear and the
 * restore there is a window in which the anchors exist only in this
 * execution's memory. Apps Script kills an execution at the runtime limit
 * without running a `finally`, so that window is covered by parking the band
 * in a script property first: the next run puts a parked band back before it
 * touches the tab.
 *
 * WHICH MAKES THE PARK'S LIFETIME THE THING TO GATE. A park that outlives the
 * band's return is a run that reports at warn that an earlier execution was
 * killed, and puts back a band that is already there — and until this was
 * fixed that happened for EVERY tab that threw, because the drop sat on the
 * clean path only while the restore that always runs is the pass at the end of
 * run(). Two of those warnings are in the 08-24 field logs, from tabs that
 * failed inside a run that finished normally.
 * ==================================================================== */
console.log('\nthe parked band is dropped once the band is back on the tab:');
{
  const ctx = load();
  ctx.qlikSyncNow('pricevolume');
  const parked = Object.keys(PROPS).filter(k => /BAND_PARK/.test(k));
  check('a clean run leaves nothing parked', parked, []);

  /* A write that throws is the closest a harness gets to the runtime limit, and
     it is also the case the limit does not cover: run() carries on, records the
     tab as failed, and its restore pass still puts the band back. So the park
     is spent, and a park left behind here is what made the next run cry wolf. */
  const ctx2 = load();
  BOOM = (sheet) => sheet === RAW_TAB;
  ctx2.qlikSyncNow('pricevolume');
  BOOM = null;
  check('a tab that threw leaves nothing parked either',
    Object.keys(PROPS).filter(k => /BAND_PARK/.test(k)), []);

  /* AND A BAND THAT REALLY IS STILL OFF THE TAB STAYS PARKED. Without this the
     check above passes just as well against a drop that runs unconditionally,
     which is the one arrangement that loses the anchors for good. */
  const ctx3 = load();
  BOOM_F = (sheet) => sheet === RAW_TAB;
  ctx3.qlikSyncNow('pricevolume');
  BOOM_F = null;
  check('a restore that could not be written keeps its park',
    Object.keys(PROPS).filter(k => /BAND_PARK/.test(k)).length, 1);
}

/* ======================================================================
 * 3a-ii. A parked band is written FROM, not put back and taken off again
 * ----------------------------------------------------------------------
 * THE 08-24 FIELD FAILURE, AND IT COST THE WHOLE RUN. unpark_ was the first
 * line of writeColumns_ and wrote the parked band home; forty lines later the
 * same band was read, parked and cleared again. Putting six ARRAYFORMULAs back
 * onto a 47,845-row tab is exactly the full-column recalculation the band is
 * taken out to avoid — and the sheet was still doing it when the write asked
 * for the tab, which came back as "Service timed out: Spreadsheets" on BOTH
 * Aggregates tabs. ~150 seconds producing nothing, and Ready-Mix and Product
 * Segment then ran out of execution time behind it.
 *
 * The park is a copy of the band. Reading it is free.
 * ==================================================================== */
console.log('\na parked band is written from, not put back first:');
{
  const ctx = load();
  ctx.qlikSyncNow('pricevolume');                    /* a clean run: a real band */

  /* What a killed execution leaves behind: the band in the property and an
     empty row on the tab. A restore that cannot be written reaches the same
     end state, and it is the one a harness can reach. */
  BOOM_F = (sheet) => sheet === RAW_TAB;
  ctx.qlikSyncNow('pricevolume');
  BOOM_F = null;
  check('the band is parked',
    Object.keys(PROPS).filter(k => /BAND_PARK/.test(k)).length, 1);
  check('and off the tab', formulaRow(BOOKS._sheets.raw, 3).filter(f => f).length, 0);

  OPS = [];
  const res = ctx.qlikSyncNow('pricevolume');
  const mine = OPS.filter(o => o.sheet === RAW_TAB);
  const firstWrite = mine.findIndex(o => o.op === 'setValues');
  checkThat('the next run does write the tab', firstWrite !== -1,
    JSON.stringify(mine.map(o => o.op)));
  check('and puts nothing back before it does',
    mine.slice(0, firstWrite).filter(o => o.op === 'setFormulas').length, 0);
  /* The band clear DOES still run: a kill landing between park_ and the clear
     leaves the property written and the band still on the tab, and this run
     would otherwise write with the anchors in place. */
  checkThat('but the band cells are still cleared before it',
    mine.slice(0, firstWrite).filter(o => o.op === 'clearContent' &&
                                          /^[A-M]3(:[A-M]3)?$/.test(o.a1)).length > 0,
    JSON.stringify(mine.slice(0, firstWrite).map(o => o.op + ' ' + o.a1)));

  check('the tab wrote', res.ok, true);

  /* AND IT LANDED ON THE ROW IT BELONGS ON. firstDataRow_ finds that row by
     looking for a formula in a column the export does not feed — and with the
     band off the tab there is none on the first data row, so it finds the next
     row down of the foreign column that IS filled down (column M here, which
     this fixture carries precisely because the sync must not touch it) and
     answers one row too low. Every row of the export would then be written one
     row out, on every run following a killed one. The park records the row,
     which is what makes reading it enough. */
  check('the export starts on the first data row, not one below it',
    BOOKS._sheets.raw.getMaxRows(), 7);
  check('the band is home afterwards',
    formulaRow(BOOKS._sheets.raw, 3).filter(f => f).length, 6);
  check('re-pointed at the new height',
    formulaRow(BOOKS._sheets.raw, 3)[0],
    '=ARRAYFORMULA(IF(B3:B7="","",B3:B7&"-"&C3:C7))');
  check('with nothing left parked',
    Object.keys(PROPS).filter(k => /BAND_PARK/.test(k)), []);
}

/* ======================================================================
 * 3b. A run that dies in the middle still leaves the formulas behind
 * ----------------------------------------------------------------------
 * The reported fault, and the reason the two changes above are one change.
 * Apps Script kills an execution at the runtime limit with no `finally` and no
 * catch — three tens-of-thousands-of-rows Ready-Mix tabs reach that far sooner
 * than two Aggregates ones, which is why one workbook lost its formulas and the
 * other never did on identical code. A throw is the closest a harness gets, and
 * it also covers the case a kill does not: the run continues, records the tab
 * as failed, and must still put the band back.
 * ==================================================================== */
console.log('\na write that blows up does not take the array formulas with it:');
{
  const ctx = load();
  BOOM = (sheet) => sheet === RAW_TAB;
  const res = ctx.qlikSyncNow('pricevolume');
  BOOM = null;

  check('the tab is reported as failed', res.failed.length >= 1, true);
  const got = formulaRow(BOOKS._sheets.raw, 3);
  check('the lookup-key anchor is still on the sheet',
    got[0], '=ARRAYFORMULA(IF(B3:B7="","",B3:B7&"-"&C3:C7))');
  check('...and so is the rest of the band',
    got.filter(f => f).length, 6);
  check('the other tab still wrote', BOOKS._sheets.other.getRange(2, 4, 1, 1).getValues(),
    [[7]]);
}

/* ======================================================================
 * 4. The check: per export file, and only when Drive says it moved
 * ==================================================================== */
console.log('\nthe check syncs the export that moved, and only that one:');
{
  const ctx = load();

  const first = ctx.qlikSyncCheck();
  check('with nothing on record every export looks new',
    first.changed.length, 3);
  check('and none is skipped', first.unchanged, []);

  const after = OPS.length;
  const second = ctx.qlikSyncCheck();
  check('a second look syncs nothing', second.changed, []);
  check('all three are recognised as unchanged', second.unchanged.length, 3);
  check('and nothing was written', OPS.length, after);

  MTIME[AGG_ID] += 1000;                       /* only Aggregates re-exported */
  const third = ctx.qlikSyncCheck();
  check('the re-exported one is picked up', third.changed, ['Aggregates']);
  check('the other two are left alone', third.unchanged.sort(),
    ['Product Segment', 'Ready-Mix']);
}

console.log('\nmarking the current exports stops a needless first sync:');
{
  const ctx = load();
  const msg = ctx.qlikMarkCurrent();
  checkThat('it says how many it marked', /3/.test(msg), msg);

  const res = ctx.qlikSyncCheck();
  check('nothing looks new', res.changed, []);
  check('nothing was synced', SYNC_ALL_CALLS, 0);
  check('and nothing was written', OPS.length, 0);
}

console.log('\na run that could not happen is retried next time:');
{
  const ctx = load({ lockFree: false });          /* another sync holds the lock */
  const res = ctx.qlikSyncCheck();
  check('it did not succeed', res.ok, false);
  check('nothing was recorded as synced', res.changed, []);
  check('and nothing was written', OPS.length, 0);

  const seen = JSON.parse(PROPS.QLIK_FILE_STAMPS || '{}');
  check('no stamp was kept, so the next check tries again',
    Object.keys(seen).length, 0);
}

console.log('\nqlikStamps says what the next check will do:');
{
  const ctx = load();
  ctx.qlikMarkCurrent();
  MTIME[SEG_ID] += 5000;

  const rows = ctx.qlikStamps();
  check('one row per export', rows.length, 3);
  check('the moved one is flagged',
    rows.filter(r => r.willSync).map(r => r.source), ['Product Segment']);
  check('and it names the page it feeds',
    rows.filter(r => r.willSync)[0].feeds, 'segment');
}

/* ======================================================================
 * The two sides spell their periods differently, and always will
 * ----------------------------------------------------------------------
 * The Aggregates export names years — "2025 Volume", "2026 Volume" — and the
 * workbook it feeds has been moved to "CY Volume" / "PY Volume". Neither side
 * is under this code's control and either can change again, so the pairing is
 * on the figure and its period rather than on the literal header.
 *
 * The surcharge is the same defect wearing different clothes: the export heads
 * it "Fuel Surchage" and the workbook "Fuel Surcharge". One missing letter,
 * one column that matched nothing and was never written, and a tab that looked
 * healthy because every OTHER column synced.
 * ==================================================================== */
function periodBook() {
  const hdr = ['LOOKUP KEY', 'Year', 'Month', 'Plant Type', 'Material Family',
               'CY Volume', 'PY Volume', 'CY Rev exWorks', 'PY Rev exWorks',
               'Fuel Surcharge', 'CY Fuel Surcharge'];
  /* the banner the real tab carries above its header: periods, no figures */
  const banner  = ['', '', '', '', '', 'CY', 'PY', 'CY', 'PY', '', ''];
  const anchors = ['', '', '', '', '', '', '', '', '', '',
                   { f: '=ARRAYFORMULA(F3:F50040*1)' }];
  const stale = () => ['', 'OLD', 'OLD', 'OLD', 'OLD', -1, -1, -1, -1, -1, ''];
  return makeBook([makeSheet(RAW_TAB, [banner, hdr, anchors, stale(), stale()]),
                   makeSheet(OTHER_TAB, [['LOOKUP KEY', 'Year', 'Month', 'Other Revenue'],
                                         ['', '', '', ''], ['', 'OLD', 'OLD', 'OLD']])]);
}
/* Years on one side, CY/PY on the other, and the export's own typo. */
function periodExport() {
  const raw = [['Year', 'Month', 'Plant Type', 'Material Family',
                '2025 Volume', '2026 Volume', 'PY Rev exWorks', 'CY Rev exWorks',
                'Fuel Surchage']];
  raw.push([2026, 'Apr', 'Fixed', 'Sand', 11, 22, 33, 44, 55]);
  raw.push([2025, 'Apr', 'Fixed', 'Sand', 66, 77, 88, 99, 110]);
  const other = [['Year', 'Month', 'Other Revenue'], [2026, 'Apr', 7]];
  return makeBook([makeSheet('CPI Raw Export', raw),
                   makeSheet('CPI Other Export', other)]);
}

console.log('\nyears on one side, CY/PY on the other:');
{
  const ctx = load();
  BOOKS.pricevolume = periodBook();
  ctx.SpreadsheetApp.openById = id => ((id in NAMES) ? periodExport() : BOOKS[id]);

  const res = ctx.qlikSyncNow('pricevolume');
  const tab = res.done.filter(d => d.tab === RAW_TAB)[0] || { unmatched: ['(tab not written)'] };
  check('every export column found a home', tab.unmatched, []);
  check('all nine were paired', tab.columns, 9);
  check('CY was read off the Year column, not the header', tab.dataYear, 2026);

  const g = BOOKS.pricevolume.getSheetByName(RAW_TAB)._grid();
  const at = (row, name) => {
    const c = g[1].findIndex(x => String(x.v) === name);
    return c === -1 ? '(no such column)' : g[row - 1][c].v;
  };
  check('"2026 Volume" wrote into "CY Volume"',      at(3, 'CY Volume'), 22);
  check('"2025 Volume" wrote into "PY Volume"',      at(3, 'PY Volume'), 11);
  check('CY Rev exWorks is not swapped with PY',     at(3, 'CY Rev exWorks'), 44);
  check('nor PY with CY',                            at(3, 'PY Rev exWorks'), 33);
  check('"Fuel Surchage" wrote into "Fuel Surcharge"', at(3, 'Fuel Surcharge'), 55);
  check('and not into "CY Fuel Surcharge"',          at(3, 'CY Fuel Surcharge'), '');
  check('the second export row landed too',          at(4, 'CY Volume'), 77);
}

/* The workbook has not gained next year's column yet. Pairing on rank would
   write 2027's figures into the 2026 column; pairing on the year leaves it
   unmatched, which is reported and is the right answer. */
console.log('\na year the workbook does not have yet is reported, not guessed at:');
{
  const ctx = load();
  BOOKS.pricevolume = makeBook([makeSheet(RAW_TAB, [
    ['LOOKUP KEY', 'Year', 'Month', 'Plant Type', 'Material Family',
     'Fuel Surcharge', '2026 Volume', '2025 Volume'],
    ['', '', '', '', '', '', '', ''],
  ])]);
  ctx.SpreadsheetApp.openById = id => ((id in NAMES) ? makeBook([makeSheet('X', [
    ['Year', 'Month', 'Plant Type', 'Material Family', 'Fuel Surchage',
     '2027 Volume', '2026 Volume'],
    [2027, 'Apr', 'Fixed', 'Sand', 1, 5, 6],
  ])]) : BOOKS[id]);

  const res = ctx.qlikSyncNow('pricevolume');
  const tab = res.done.filter(d => d.tab === RAW_TAB)[0] || {};
  check('the new year is named as unmatched', tab.unmatched, ['2027 Volume']);
  check('and every other column still paired', tab.columns, 6);
}

/* ======================================================================
 * The temp sheet is private, and it goes away
 * ----------------------------------------------------------------------
 * An .xls export cannot be read where it stands, so Drive converts it to a
 * Google Sheet first. That copy must not inherit the export's audience: a new
 * Drive file takes its sharing from the folder it is created in, so one made
 * with no parent lands beside the export, in whatever shared folder that sits
 * in, and turns up in other people's Drive activity mail.
 *
 * Nothing here creates a permission — that is the only Drive call that emails
 * anybody — and the copy is trashed whether the read worked or not.
 * ==================================================================== */
/* The trigger skips a source that has not moved. A person running the manual
   sync is here BECAUSE the sheet is wrong and the file did NOT move, so that
   rule must not reach them. */
console.log('\nthe manual sync ignores the export\u2019s modified time:');
{
  const ctx = load();
  const first = ctx.qlikSyncNow('pricevolume');
  check('the first run wrote', first.done.length > 0, true);

  const wroteFirst = OPS.length;
  OPS = [];
  const again = ctx.qlikSyncNow('pricevolume');   /* same file, same modified time */
  check('and so did the second, with nothing having changed', again.done.length > 0, true);
  checkThat('it wrote as much the second time', OPS.length === wroteFirst,
            OPS.length + ' vs ' + wroteFirst);

  /* …while the trigger, on that same unchanged file, does nothing at all. Only
     Aggregates is looked at here: the manual run covered that scope alone, so
     the other two have no stamp yet and still count as new. */
  OPS = [];
  const chk = ctx.qlikSyncCheck();
  checkThat('the trigger still skips what has not moved',
            chk.changed.indexOf('Aggregates') === -1 && chk.unchanged.indexOf('Aggregates') !== -1,
            JSON.stringify({ changed: chk.changed, unchanged: chk.unchanged }));
  check('and it wrote nothing for Price & Volume',
    OPS.filter(o => o.sheet === RAW_TAB).length, 0);
}

/* ======================================================================
 * THE CONVERTED COPY IS NOT FINISHED WHEN DRIVE HANDS BACK ITS ID.
 * ----------------------------------------------------------------------
 * files/copy returns as soon as the file RECORD exists, and converting tens of
 * thousands of rows of .xls is not instant — the sheet is READABLE while it is
 * still filling, and answers getDataRange() with however much has landed,
 * truthfully and short, with no error anywhere.
 *
 * That is the shape of the reported failure: a 49,000-row export read as ~1,100
 * rows, written as 1,100 rows, and — because the sheet ends where the export
 * ends — the other 48,000 DELETED to match. Two things have to be true, and the
 * second matters more than the first: the read waits, and if it gives up
 * waiting it must not throw, because the gate is what actually stops a short
 * read reaching the tab.
 * ==================================================================== */
console.log('\na copy that is still filling is waited for, not read short:');
{
  const ctx = load();
  const TEMP = 'temp-file-id';
  /* Five rows arrive one read at a time — a copy caught mid-conversion. */
  let landed = 1;
  const growing = () => {
    const raw = [['Year', 'Month', 'Plant Type', 'Material Family', 'Fuel Surchage', 'Volume']];
    for (let i = 1; i <= landed; i++) raw.push([2026, 'Apr', 'Fixed', 'Sand', 10 * i, 100 * i]);
    if (landed < 5) landed++;
    const other = [['Year', 'Month', 'Other Revenue']];
    for (let i = 1; i <= 3; i++) other.push([2026, 'Apr', 7 * i]);
    return makeBook([makeSheet('CPI Raw Export', raw), makeSheet('CPI Other Export', other)]);
  };

  ctx.DriveApp.getFileById = id => {
    if (id === TEMP) return { setTrashed: () => {} };
    return { getId: () => id, getName: () => NAMES[id],
             getMimeType: () => 'application/vnd.ms-excel',      /* forces a conversion */
             getLastUpdated: () => new RealDate(MTIME[id]), setTrashed: () => {} };
  };
  ctx.DriveApp.getRootFolder = () => ({ getId: () => 'my-drive-root' });
  ctx.UrlFetchApp.fetch = url => {
    if (/\/copy\?/.test(url)) return { getResponseCode: () => 200,
                                       getContentText: () => JSON.stringify({ id: TEMP }) };
    if (/\/permissions\?/.test(url)) return { getResponseCode: () => 200,
                                              getContentText: () => JSON.stringify({ permissions: [] }) };
    return { getResponseCode: () => 204, getContentText: () => '' };
  };
  ctx.SpreadsheetApp.openById = id => ((id === TEMP) ? growing() : BOOKS[id]);

  const res = ctx.qlikSyncNow('pricevolume');
  checkThat('it waited rather than reading the first answer', SLEPT.length > 0, SLEPT.join(','));
  check('and read the export whole', res.done.filter(d => d.tab === RAW_TAB)[0].rows, 5);
}

console.log('\na copy that never settles is still refused rather than written short:');
{
  /* THE ONE THAT MATTERS. The wait makes a short read rare; it cannot make it
     impossible, so giving up waiting must not become a way to write one. */
  const ctx = load();
  ctx.qlikSyncNow('pricevolume');                       /* a baseline to fail against */
  const shape = JSON.parse(PROPS.QLIK_TAB_SHAPE);
  const key = Object.keys(shape).filter(k => /combined data cpi raw/i.test(k))[0];
  shape[key].rows = 49000;
  Object.keys(shape[key].cols).forEach(c => { shape[key].cols[c] = 49000; });
  PROPS.QLIK_TAB_SHAPE = JSON.stringify(shape);

  const raw = BOOKS._sheets.raw;
  const good = snap(raw), rowsBefore = raw.getMaxRows();
  const TEMP = 'temp-file-id';
  let n = 1;
  ctx.DriveApp.getFileById = id => {
    if (id === TEMP) return { setTrashed: () => {} };
    return { getId: () => id, getName: () => NAMES[id],
             getMimeType: () => 'application/vnd.ms-excel',
             getLastUpdated: () => new RealDate(MTIME[id]), setTrashed: () => {} };
  };
  ctx.DriveApp.getRootFolder = () => ({ getId: () => 'my-drive-root' });
  ctx.UrlFetchApp.fetch = url => {
    if (/\/copy\?/.test(url)) return { getResponseCode: () => 200,
                                       getContentText: () => JSON.stringify({ id: TEMP }) };
    return { getResponseCode: () => 200,
             getContentText: () => JSON.stringify({ permissions: [] }) };
  };
  /* Never the same twice: the wait runs out and the read gets what it gets. */
  ctx.SpreadsheetApp.openById = id => {
    if (id !== TEMP) return BOOKS[id];
    const rows = [['Year', 'Month', 'Plant Type', 'Material Family', 'Fuel Surchage', 'Volume']];
    for (let i = 1; i <= n; i++) rows.push([2026, 'Apr', 'Fixed', 'Sand', 10 * i, 100 * i]);
    n++;
    return makeBook([makeSheet('CPI Raw Export', rows)]);
  };

  const res = ctx.qlikSyncNow('pricevolume');
  checkThat('the wait ran out', SLEPT.length >= 6, SLEPT.join(','));
  check('the short read is refused', res.ok, false);
  check('the tab still has its rows', raw.getMaxRows(), rowsBefore);
  check('and its content', snap(raw), good);
}

console.log('\nthe converted copy is private, and is cleaned up:');
{
  const ctx = load();
  const CALLS = [];
  const TEMP = 'temp-file-id';
  let trashed = [];

  ctx.DriveApp.getFileById = id => {
    if (id === TEMP) return { setTrashed: () => { trashed.push(id); } };
    return {
      getId: () => id, getName: () => NAMES[id],
      getMimeType: () => 'application/vnd.ms-excel',      /* forces a conversion */
      getLastUpdated: () => new RealDate(MTIME[id]),
      setTrashed: () => { trashed.push(id); },
    };
  };
  ctx.DriveApp.getRootFolder = () => ({ getId: () => 'my-drive-root' });
  ctx.UrlFetchApp.fetch = (url, opts) => {
    CALLS.push({ url, method: (opts && opts.method) || 'get', payload: opts && opts.payload });
    if (/\/copy\?/.test(url)) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ id: TEMP }) };
    if (/\/permissions\?/.test(url)) return { getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ permissions: [
        { id: 'owner1', role: 'owner' }, { id: 'reader1', role: 'reader' },
        { id: 'writer1', role: 'writer' }] }) };
    return { getResponseCode: () => 204, getContentText: () => '' };
  };
  ctx.SpreadsheetApp.openById = id => ((id === TEMP) ? exportBook() : BOOKS[id]);

  ctx.qlikSyncNow('pricevolume');

  const copy = CALLS.filter(c => /\/copy\?/.test(c.url))[0];
  checkThat('the copy names a parent of its own', !!copy && /"parents":\["my-drive-root"\]/.test(copy.payload),
            copy && copy.payload);
  check('every non-owner permission is deleted',
    CALLS.filter(c => c.method === 'delete' && /\/permissions\//.test(c.url))
         .map(c => c.url.split('/permissions/')[1].split('?')[0]).sort(),
    ['reader1', 'writer1']);
  check('and the owner\u2019s is left alone',
    CALLS.filter(c => /\/permissions\/owner1/.test(c.url)).length, 0);
  checkThat('no permission is ever created — that is the call that emails people',
    CALLS.every(c => !(c.method === 'post' && /\/permissions/.test(c.url))));
  check('the temp sheet is trashed', trashed, [TEMP]);
}

/* ======================================================================
 * Stranded temp sheets are cleared, and only stranded ones
 * ----------------------------------------------------------------------
 * The exports are .xls and cannot be read in place, so EVERY sync makes a
 * copy. readExport_ trashes it in a `finally`, which covers every way the read
 * can fail except the one that matters: Apps Script killing the execution at
 * the runtime limit, where `finally` does not run at all. That kill is what
 * this file's batching checks exist to avoid, so it is not hypothetical — and
 * one stranded file per kill, forever, is a leak.
 *
 * It trashes files, so the guards are the check: the prefix, the mime type,
 * and an hour's age so a copy another execution is reading is never taken.
 * ==================================================================== */
console.log('\nstranded temp sheets are cleared, and only those:');
{
  const ctx = load();
  const HOUR = 3600 * 1000;
  const files = [
    { id: 'old-temp',   name: '~qliksync temp — Agg.xls',  age: 3 * HOUR, mime: 'application/vnd.google-apps.spreadsheet' },
    { id: 'live-temp',  name: '~qliksync temp — Rmx.xls',  age: 30 * 1000, mime: 'application/vnd.google-apps.spreadsheet' },
    { id: 'not-sheet',  name: '~qliksync temp — odd',      age: 3 * HOUR, mime: 'application/pdf' },
    { id: 'not-ours',   name: 'Q3 ~qliksync temp notes',   age: 9 * HOUR, mime: 'application/vnd.google-apps.spreadsheet' },
    { id: 'unrelated',  name: 'Agg Margin Monitor Export', age: 9 * HOUR, mime: 'application/vnd.google-apps.spreadsheet' },
  ];
  let trashed = [], query = '';
  ctx.DriveApp.searchFiles = q => {
    query = q;
    /* the fake honours the mimeType and trashed clauses the query carries; the
       prefix and the age are the code's own job and are left to it */
    const hits = files.filter(f => f.mime === 'application/vnd.google-apps.spreadsheet');
    let i = 0;
    return {
      hasNext: () => i < hits.length,
      next: () => {
        const f = hits[i++];
        return { getId: () => f.id, getName: () => f.name,
                 getDateCreated: () => new RealDate(CLOCK - f.age),
                 setTrashed: () => { trashed.push(f.id); } };
      },
    };
  };

  ctx.qlikSyncNow('pricevolume');

  checkThat('it asks Drive for untrashed Sheets carrying the prefix',
            /~qliksync temp/.test(query) && /trashed = false/.test(query) &&
            /google-apps\.spreadsheet/.test(query), query);
  check('the stranded one is trashed', trashed, ['old-temp']);
  checkThat('a copy a live run may be reading is left alone', trashed.indexOf('live-temp') === -1);
  checkThat('and a file that merely mentions the prefix is left alone',
            trashed.indexOf('not-ours') === -1);
}

/* A sweep that cannot run leaves files behind, which is untidy. A sync that
   stops because of it is an outage. */
console.log('\na sweep that throws does not stop the sync:');
{
  const ctx = load();
  ctx.DriveApp.searchFiles = () => { throw new Error('Drive search is unavailable'); };
  const res = ctx.qlikSyncNow('pricevolume');
  check('the sync still ran', res.done.length > 0, true);
  check('and it still says it succeeded', res.ok, true);
}

/* ======================================================================
 * THE GATE — a bad export is refused, and refusing it costs nothing.
 * ----------------------------------------------------------------------
 * The reported failure, and it is worth stating exactly, because the shape of
 * it is what makes it dangerous. An export went out with three columns left
 * off. Every OTHER column paired, wrote cleanly, and landed a tab whose totals
 * read 0.00 across revenue and fuel surcharge — no error, no failed tab, no
 * log line, and a page that looked exactly like a page.
 *
 * Rows make it worse rather than better. The sheet ends where the export ends,
 * so a SHORT export does not leave the surplus behind — it deletes it. That is
 * right when the export is real and catastrophic when it is truncated: the good
 * data is gone before anybody sees a number.
 *
 * So the gate runs before ANYTHING destructive, and what these checks are
 * really about is the sheet being byte-identical afterwards.
 * ==================================================================== */

/* One good run, then one bad one. The baseline is the point: an empty column is
   not a fault on its own, it is a fault against a column that was full. */
function afterBad(makeBadExport) {
  const ctx = load();
  const first = ctx.qlikSyncNow('pricevolume');
  const raw = BOOKS._sheets.raw;
  const good = snap(raw);
  MAILS = []; TRIGGERS = []; OPS = [];
  EXPORT = makeBadExport;
  MTIME[AGG_ID] = 9999;                       /* the file moved, so a check would read it */
  const second = ctx.qlikSyncNow('pricevolume');
  return { ctx, first, second, raw, good, after: snap(raw) };
}

console.log('\na column left out of the export does not empty the column in the sheet:');
{
  /* Volume gone from the header entirely. NOT one of the five names in this
     tab's `match` fingerprint, deliberately: drop one of THOSE and the export
     tab is not recognised at all, which is a different failure one step
     earlier (and is checked below). This is the case the fingerprint cannot
     see — an export that still looks like itself and is missing a figure. */
  const r = afterBad(() => {
    const raw = [['Year', 'Month', 'Plant Type', 'Material Family', 'Fuel Surchage']];
    for (let i = 1; i <= 5; i++) raw.push([2026, 'Apr', 'Fixed', 'Sand', 10 * i]);
    const other = [['Year', 'Month', 'Other Revenue']];
    for (let i = 1; i <= 3; i++) other.push([2026, 'Apr', 7 * i]);
    return makeBook([makeSheet('CPI Raw Export', raw), makeSheet('CPI Other Export', other)]);
  });
  check('the first run wrote', r.first.ok, true);
  check('the second is refused', r.second.ok, false);
  checkThat('and says which column went missing',
    /Volume/.test(JSON.stringify(r.second.failed)), JSON.stringify(r.second.failed));
  check('the tab is byte-for-byte what the good run left', r.after, r.good);
  checkThat('nothing was written, cleared or deleted on it',
    OPS.filter(o => o.sheet === RAW_TAB &&
                    /setValues|clearContent|clearContents/.test(o.op)).length === 0,
    JSON.stringify(OPS.filter(o => o.sheet === RAW_TAB).map(o => o.op)));
}

console.log('\na column that arrives empty is refused, not written as blanks:');
{
  /* The header is there and every cell under it is not — which is what an
     export built with the column unticked actually looks like. */
  const r = afterBad(() => {
    const raw = [['Year', 'Month', 'Plant Type', 'Material Family', 'Fuel Surchage', 'Volume']];
    for (let i = 1; i <= 5; i++) raw.push([2026, 'Apr', 'Fixed', 'Sand', '', 100 * i]);
    const other = [['Year', 'Month', 'Other Revenue']];
    for (let i = 1; i <= 3; i++) other.push([2026, 'Apr', 7 * i]);
    return makeBook([makeSheet('CPI Raw Export', raw), makeSheet('CPI Other Export', other)]);
  });
  check('it is refused', r.second.ok, false);
  checkThat('and says the column is empty and was not',
    /empty in this export/.test(JSON.stringify(r.second.failed)), JSON.stringify(r.second.failed));
  check('the tab is untouched', r.after, r.good);
}

console.log('\nan export that collapsed does not take the sheet down with it:');
{
  /* THE DESTRUCTIVE ONE. Rows belong to the export, so without this the sheet
     is cut to the truncated export's height and last week's data is gone. */
  const ctx = load();
  ctx.qlikSyncNow('pricevolume');
  const raw = BOOKS._sheets.raw;
  /* Grow the baseline past SHRINK_FLOOR so the ratio applies at all — below it
     a proportion means nothing and the check deliberately does not fire. */
  const shape = JSON.parse(PROPS.QLIK_TAB_SHAPE);
  const key = Object.keys(shape).filter(k => /combined data cpi raw/i.test(k))[0];
  shape[key].rows = 49000;
  Object.keys(shape[key].cols).forEach(c => { shape[key].cols[c] = 49000; });
  PROPS.QLIK_TAB_SHAPE = JSON.stringify(shape);

  const good = snap(raw), rowsBefore = raw.getMaxRows();
  MAILS = []; TRIGGERS = [];
  MTIME[AGG_ID] = 9999;
  const res = ctx.qlikSyncNow('pricevolume');

  check('it is refused', res.ok, false);
  checkThat('and says the export is too short to be a month’s change',
    /too few to be a month/.test(JSON.stringify(res.failed)), JSON.stringify(res.failed));
  check('the tab still has its rows', raw.getMaxRows(), rowsBefore);
  check('and its content', snap(raw), good);
}

console.log('\na write that stops partway down is reported, not left to be found in the numbers:');
{
  /* THE REPORTED SYMPTOM, staged directly: 49,000 rows sent, the tab stopping
     at a fraction of it. A kill at the six-minute limit does not throw anywhere
     the code can see — the rows simply stop arriving — so nothing in the pass
     noticed, the run reported success, and the tab looked like a tab. */
  const ctx = load();
  SHORT = 4;                                  /* nothing lands past row 4 */
  const res = ctx.qlikSyncNow('pricevolume');

  check('the run does not claim success', res.ok, false);
  const raw = res.failed.filter(f => f.tab === RAW_TAB)[0];
  checkThat('it says the write stopped short', /stopped short/.test(raw.error), raw && raw.error);
  checkThat('and names how many rows were sent', /5 rows were sent/.test(raw.error), raw.error);
  /* IT IS RETRYABLE, and that is the half that matters: without the flag the
     export keeps its stamp, the truncated tab is marked as synced, and nothing
     ever looks at it again. */
  check('it is flagged for a retry', raw.check, true);
  check('and one is armed', TRIGGERS.length, 1);
  const seen = JSON.parse(PROPS[Object.keys(PROPS).filter(k => /STAMP/.test(k))[0]] || '{}');
  checkThat('with the export not stamped as synced', !seen.AGG, JSON.stringify(seen));
}

console.log('\nthe January export is a twelfth of the December one, and that is allowed:');
{
  /* THE FALSE POSITIVE THAT WOULD HAVE STOPPED THE PIPELINE ONCE A YEAR, on the
     one day nobody is expecting it. These exports carry the year they are for,
     so a January file IS a fraction of a December one — which is the whole
     reason surplus rows are deleted rather than left. The shrink check has to
     tell that from a truncated read, and what separates them is whether the
     export's newest period has moved on.

     The Aggregates line is the one that needs saying: only "Bill Month"
     canonicalises to monthcol, and AGG carries a bare "Month" beside a separate
     "Year", so the period here comes from the YEAR column or from nowhere. */
  const ctx = load();
  ctx.qlikSyncNow('pricevolume');
  const shape = JSON.parse(PROPS.QLIK_TAB_SHAPE);
  const key = Object.keys(shape).filter(k => /combined data cpi raw/i.test(k))[0];
  shape[key].rows = 49000;                             /* a full December */
  Object.keys(shape[key].cols).forEach(c => { shape[key].cols[c] = 49000; });
  PROPS.QLIK_TAB_SHAPE = JSON.stringify(shape);
  checkThat('the baseline knows which period it was for', shape[key].ym > 0, shape[key].ym);

  /* January of the next year: three rows, and the year has moved on. */
  EXPORT = () => {
    const raw = [['Year', 'Month', 'Plant Type', 'Material Family', 'Fuel Surchage', 'Volume']];
    for (let i = 1; i <= 3; i++) raw.push([2027, 'Jan', 'Fixed', 'Sand', 10 * i, 100 * i]);
    const other = [['Year', 'Month', 'Other Revenue']];
    for (let i = 1; i <= 3; i++) other.push([2027, 'Jan', 7 * i]);
    return makeBook([makeSheet('CPI Raw Export', raw), makeSheet('CPI Other Export', other)]);
  };
  MTIME[AGG_ID] = 22222;
  const jan = ctx.qlikSyncNow('pricevolume');
  check('the year roll writes', jan.ok, true);
  check('and the tab is January-sized', BOOKS._sheets.raw.getMaxRows(),
        jan.done.filter(d => d.tab === RAW_TAB)[0].firstDataRow + 2);

  /* AND THE SAME SHRINK WITHOUT THE ROLL IS STILL REFUSED. Without this the
     check above would pass just as well against a shrink check that had simply
     been deleted. */
  const ctx2 = load();
  ctx2.qlikSyncNow('pricevolume');
  const s2 = JSON.parse(PROPS.QLIK_TAB_SHAPE);
  const k2 = Object.keys(s2).filter(k => /combined data cpi raw/i.test(k))[0];
  s2[k2].rows = 49000;
  Object.keys(s2[k2].cols).forEach(c => { s2[k2].cols[c] = 49000; });
  PROPS.QLIK_TAB_SHAPE = JSON.stringify(s2);
  EXPORT = () => {
    const raw = [['Year', 'Month', 'Plant Type', 'Material Family', 'Fuel Surchage', 'Volume']];
    for (let i = 1; i <= 3; i++) raw.push([2026, 'Apr', 'Fixed', 'Sand', 10 * i, 100 * i]);
    return makeBook([makeSheet('CPI Raw Export', raw)]);
  };
  MTIME[AGG_ID] = 33333;
  check('the same collapse in the same period is refused',
        ctx2.qlikSyncNow('pricevolume').ok, false);
}

console.log('\nnobody is watching a trigger, so a refused run says so:');
{
  const r = afterBad(() => {
    const raw = [['Year', 'Month', 'Plant Type', 'Material Family', 'Fuel Surchage']];
    for (let i = 1; i <= 5; i++) raw.push([2026, 'Apr', 'Fixed', 'Sand', 10 * i]);
    return makeBook([makeSheet('CPI Raw Export', raw)]);
  });
  check('one mail went out', MAILS.length, 1);
  checkThat('it names the source a person would recognise',
    /Aggregates/.test(MAILS[0].subject), MAILS[0].subject);
  checkThat('it names the tab and the reason',
    /Combined Data CPI Raw/.test(MAILS[0].body) && /"Volume"/.test(MAILS[0].body),
    MAILS[0].body);
  /* THE LINE THAT STOPS SOMEBODY "FIXING" IT. A refused run leaves the sheet
     showing last week, which is out of date and not wrong — and that is the
     opposite of what "the sync failed" usually means. */
  checkThat('and says the sheet is unchanged rather than half-written',
    /unchanged/.test(MAILS[0].body), MAILS[0].body);

  /* ONE retry, five minutes out, armed by the run itself. */
  check('a single retry trigger is armed', TRIGGERS.length, 1);
  check('pointed at the retry handler', TRIGGERS[0].getHandlerFunction(), 'qlikSyncRetry');
  check('five minutes out', TRIGGERS[0]._after, 5 * 60 * 1000);

  /* AND THE EXPORT IS NOT MARKED AS READ. Keeping the stamp would tell the next
     scheduled check that this file is done, having never written a cell of it. */
  const seen = JSON.parse(PROPS.QLIK_LAST_STAMPS || PROPS[Object.keys(PROPS)
    .filter(k => /STAMP/.test(k))[0]] || '{}');
  checkThat('and the export is not stamped as synced', seen.AGG !== '9999',
    JSON.stringify(seen));
}

console.log('\nthe retry runs once and then gives up:');
{
  const bad = () => {
    const raw = [['Year', 'Month', 'Plant Type', 'Material Family', 'Fuel Surchage']];
    for (let i = 1; i <= 5; i++) raw.push([2026, 'Apr', 'Fixed', 'Sand', 10 * i]);
    return makeBook([makeSheet('CPI Raw Export', raw)]);
  };
  const r = afterBad(bad);
  check('the retry is waiting', Object.keys(r.ctx.QLIKSYNC.retryPending()).length, 1);

  MAILS = [];
  const out = r.ctx.qlikSyncRetry();
  check('it ran and failed again', out.ok, false);
  /* The one-shot deletes itself when it fires; a second failure arms nothing,
     because a genuinely broken export is not fixed by asking a third time and
     the mail has already gone out twice. */
  check('no further trigger is left armed', TRIGGERS.length, 0);
  check('and nothing is left waiting to be retried',
    Object.keys(r.ctx.QLIKSYNC.retryPending()).length, 0);
}

console.log('\na header spelt differently is not a column going missing:');
{
  /* THE FALSE POSITIVE THAT WOULD HAVE MADE THIS GATE UNUSABLE. The sheet has
     carried "Fuel Surchage" — a real typo, and one somebody will eventually fix
     in the export. Keyed on the raw header, the corrected spelling reads as one
     column vanishing and another appearing, and the sync would refuse to run
     over a typo being fixed. The shape is keyed on the CANONICAL name instead,
     which is the same form the pairing itself matches on, so it is stable under
     exactly the variations pairing is stable under. */
  const r = afterBad(() => {
    const raw = [['Year', ' MONTH ', 'Plant Type', 'Material Family', 'Fuel  Surchage', 'Volume']];
    for (let i = 1; i <= 5; i++) raw.push([2026, 'Apr', 'Fixed', 'Sand', 10 * i, 100 * i]);
    const other = [['Year', 'Month', 'Other Revenue']];
    for (let i = 1; i <= 3; i++) other.push([2026, 'Apr', 7 * i]);
    return makeBook([makeSheet('CPI Raw Export', raw), makeSheet('CPI Other Export', other)]);
  });
  check('it writes rather than reporting three columns missing', r.second.ok, true);
  check('every tab of it', r.second.done.length, 2);
}

console.log('\na refused export never becomes the baseline the next one is judged against:');
{
  /* THE FAILURE MODE A LATCH-CHECK CANNOT SEE, and the reason recordShape_ sits
     past every throw rather than beside the check that produced the shape. If a
     refused run recorded what it saw, the baseline would move DOWN to the
     broken export — and the same broken export, sent again, would then sail
     through, because a column that is empty against a baseline of empty is not
     a fault. The gate would report the fault exactly once and then adopt it. */
  const emptyFuel = () => {
    const raw = [['Year', 'Month', 'Plant Type', 'Material Family', 'Fuel Surchage', 'Volume']];
    for (let i = 1; i <= 5; i++) raw.push([2026, 'Apr', 'Fixed', 'Sand', '', 100 * i]);
    return makeBook([makeSheet('CPI Raw Export', raw)]);
  };
  const r = afterBad(emptyFuel);
  check('the first bad export is refused', r.second.ok, false);

  MTIME[AGG_ID] = 11111;
  const third = r.ctx.qlikSyncNow('pricevolume');
  check('and so is the same bad export sent again', third.ok, false);
  checkThat('for the same reason, not a new one',
    /empty in this export/.test(JSON.stringify(third.failed)), JSON.stringify(third.failed));
  check('with the tab still untouched', snap(r.raw), r.good);
}

console.log('\na good export after a bad one still writes:');
{
  const r = afterBad(() => {
    const raw = [['Year', 'Month', 'Plant Type', 'Material Family', 'Fuel Surchage']];
    for (let i = 1; i <= 5; i++) raw.push([2026, 'Apr', 'Fixed', 'Sand', 10 * i]);
    return makeBook([makeSheet('CPI Raw Export', raw)]);
  });
  check('the bad one was refused', r.second.ok, false);
  EXPORT = exportBook;
  MTIME[AGG_ID] = 12345;
  const third = r.ctx.qlikSyncNow('pricevolume');
  /* THE GATE MUST NOT LATCH, and it must not drift either. It compares against
     the last GOOD run: recording a refused run's shape would move the baseline
     down to the broken export and let the fault through on the next one, a
     column at a time. So the good export writes again, and what it writes is
     what the first good run wrote. */
  check('the good one writes', third.ok, true);
  check('every tab of it', third.done.length, 2);
  check('and the tab holds the good export again', snap(r.raw), r.good);
  checkThat('with nothing left waiting to retry',
    Object.keys(r.ctx.QLIKSYNC.retryPending()).length === 0);
}

console.log(fails ? `\n${fails} failing check(s)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
