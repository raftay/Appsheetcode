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
let BOOM = null;                                  /* (sheet, a1) => throw here */

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
          span((i, j) => { at(i, j).v = g[i][j]; at(i, j).f = ''; });
          return rng;
        },
        setFormulas(g) {
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
const AGG_ID = '19ptynrhtzC-Noi71znNbVIJw8GDmPUxZ';
const RMX_ID = '1wUb82e1PVxstddK9IE2VxYLSQEicVAGK';
const SEG_ID = '1d1XzYlENUyE6sxBewCd-Q3GpjTNzgRZH';
const NAMES = { [AGG_ID]: 'Agg Margin Monitor Export.xls',
                [RMX_ID]: 'CAN RMX Margin Monitor 2.xls',
                [SEG_ID]: 'CAN RMX Margin Monitor 3.xls' };
let MTIME = {};                                   /* per export file */

function load({ tick = 0, lockFree = true } = {}) {
  PROPS = {}; OPS = []; TICK = tick; SYNC_ALL_CALLS = 0; BOOM = null;
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
      openById: id => ((id in NAMES) ? exportBook() : BOOKS[id]),
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
    Session: { getScriptTimeZone: () => 'America/Toronto' },
    Utilities: { formatDate: d => String(d) },
    MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
    ScriptApp: { getOAuthToken: () => 'tok' },
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
  check('six formulas go back in two calls', restores.length, 2);
  check('one of those calls covers the five-column run',
    restores.filter(o => o.cells === 5).length, 1);
  check('nothing goes back one cell at a time', perCell.length, 0);

  /* AND THEY ARE NEVER TAKEN OUT TO MAKE ROOM. The write lands on the mapped
     columns from row 3 down; every anchor is in a column the export does not
     feed, so there is nothing to clear ahead of it. Clearing them used to leave
     the band absent for the whole workbook's pass, which is why the next test
     kills a write and expects to find them still there. (The block clear that
     precedes the data write spans B3:G10 and is not one of these.) */
  const bandClears = OPS.filter(o =>
    o.sheet === RAW_TAB && o.op === 'clearContent' && /^[A-M]3(:[A-M]3)?$/.test(o.a1));
  check('the anchors are not cleared to make room for the write', bandClears.length, 0);

  checkThat('the whole tab costs well under a call per cell',
    writes(RAW_TAB).length <= 8, `${writes(RAW_TAB).length} write calls: ` +
    JSON.stringify(writes(RAW_TAB).map(o => o.op + ' ' + o.a1)));
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

console.log(fails ? `\n${fails} failing check(s)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
