/* QlikSync.gs, run for real against a fake Spreadsheet + Drive service.
 *
 * Two things this file has to keep getting right.
 *
 *   BATCHING   The band of array formulas is cleared and restored a RUN at a
 *              time, not a CELL at a time. Every one of those was a round trip
 *              to Sheets, and the count is what used to push a sync past the
 *              Apps Script runtime limit and get the trigger killed mid-write.
 *              Batching them must change no formula: every anchor still comes
 *              back re-pointed at the new height, its own and across tabs.
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
  const hdr = ['LOOKUP KEY', 'Year', 'Month', 'Plant Type', 'Material Family',
               'Fuel Surchage', 'Volume', 'CY Fuel', 'PY Fuel', 'Net', 'Adj', 'Flag'];
  const banner  = ['Bill Year', 2025, 2025, '', '', '', '', '', '', '', '', ''];
  const anchors = hdr.map((_, i) => (RAW_FORMULAS[i + 1] ? { f: RAW_FORMULAS[i + 1] } : ''));
  const stale   = () => ['', 'OLD', 'OLD', 'OLD', 'OLD', 'OLD', 'OLD', '', '', '', '', ''];
  /* ten rows in the sheet, five in the export: it has to shrink */
  return makeSheet(RAW_TAB, [banner, hdr, anchors, stale(), stale(), stale(),
                             stale(), stale(), stale(), stale()]);
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
  PROPS = {}; OPS = []; TICK = tick; SYNC_ALL_CALLS = 0;
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
const formulaRow = (sh, row) => sh._grid()[row - 1].map(c => c.f);

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
  check('the sheet ends exactly where the export does', raw.getMaxRows(), 7);
  check('...and so does the other-revenue tab', other.getMaxRows(), 4);
  check('the export data landed', raw.getRange(3, 6, 1, 2).getValues(), [[10, 100]]);
  check('the last export row landed', raw.getRange(7, 6, 1, 2).getValues(), [[50, 500]]);
  check('no stale row survived underneath', raw.getRange(7, 2, 1, 1).getValues(), [[2026]]);
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

  /* The clear happens before the write, over the same runs. Six formula cells,
     all on row 3; the banner rows above hold none. (The block clear that
     precedes the data write spans rows 3-7 and is not one of these.) */
  const bandClears = OPS.filter(o =>
    o.sheet === RAW_TAB && o.op === 'clearContent' && /^[A-L]3(:[A-L]3)?$/.test(o.a1));
  check('and they are cleared in two calls, not six', bandClears.length, 2);

  checkThat('the whole tab costs well under a call per cell',
    writes(RAW_TAB).length <= 8, `${writes(RAW_TAB).length} write calls: ` +
    JSON.stringify(writes(RAW_TAB).map(o => o.op + ' ' + o.a1)));
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
    ['Ready-Mix', 'Slide Builder']);
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
    rows.filter(r => r.willSync).map(r => r.source), ['Slide Builder']);
  check('and it names the page it feeds',
    rows.filter(r => r.willSync)[0].feeds, 'segment');
}

console.log(fails ? `\n${fails} failing check(s)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
