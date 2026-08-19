/* PV_Lookup.gs's mapping check, over a tab shaped like the real one.
 *
 * Why it exists: getPvUnmapped failed with
 *
 *     Error: The raw tab has no "Plant" column, so the mapping check can't run.
 *
 * against Combined Data CPI Raw, whose row 2 says Plant in as many words. The
 * tab sums ABOVE its header — row 1 is a totals band — and this file had its
 * own copy of "the header is row 1". Every column resolved to -1 and the check
 * blamed the sheet.
 *
 * That is the THIRD file to carry that rule: PV_Backend.gs fixed it in its
 * readTab_ (SCHEMA v5), FSC_Backend.gs fixed it again in headerRow_, and this
 * one never got it. So the fix was to stop having a third copy — PV exports
 * readTab and PV_Lookup calls it — and this harness is what keeps that true.
 *
 *   node tests/pvlookup.js
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const { region, load: loadRegions } = require('./scriptgs.js');   // this file has its own load()
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
 * The two tabs, as they actually sit in the workbook.
 * ==================================================================== */
const RAW_HEADER = ['LOOKUP KEY', 'Sold To', 'Plant', 'Plant Type', 'Material Family',
  'Customer Parent', 'Product Class [Rock]', 'Product Application', 'Material',
  'Cust Segment [Rock]', 'Year', 'Month', '2026 Volume', '2025 Volume',
  'CY Rev exWorks', 'PY Rev exWorks'];

/* Row 1 is the totals band: numbers under the numeric columns, blanks over the
   text ones. This is the row the old reader took for the header. */
const TOTALS_BAND = RAW_HEADER.map((h, i) => (i >= 12 ? 10737475.69 + i : ''));

function rawRow(plant, vol, rev) {
  const r = new Array(RAW_HEADER.length).fill('');
  r[0] = plant + '|X'; r[1] = 'SOME CUSTOMER'; r[2] = plant;
  r[3] = 'Limestone Quarry'; r[10] = 2026; r[11] = 'May';
  r[12] = vol; r[13] = 0; r[14] = rev; r[15] = 0;
  return r;
}

/* REGION LOOKUP has its header on row 1 and is read by POSITION — locating a
   header row on it would be wrong, so the reader must be told nothing here. */
const LOOKUP_GRID = [
  ['Plant # - Desc', 'PLANT', 'Submarket', 'Market', 'Subregion', 'Region',
   'MB REGION', 'MB MARKET', 'MB SUBMARKET', 'FORMATTED REGION', 'FORMATTED MARKET',
   'COMBINED SUBMARKET', '', '', '', 'MB REGION LIST', 'MB REGION OUT'],
  ['3P02 - DUNDAS QUARRY', '3P02', 'GTA', 'GTA AGG', 'ON', 'CANADA',
   'EAST', 'GTA', 'GTA', 'East', 'GTA', 'GTA', '', '', '', 'EAST', 'East'],
];

function rawGrid() {
  return [
    TOTALS_BAND,
    RAW_HEADER,
    rawRow('3P02 - DUNDAS QUARRY', 414, 10654.25),   /* mapped */
    rawRow('9Z99 - BRAND NEW PIT', 202, 6007.50),    /* not in REGION LOOKUP */
    rawRow('9Z99 - BRAND NEW PIT', 149, 4445.00),
    rawRow('8Y88 - ANOTHER NEW PIT', 36, 806.00),
  ];
}

/* ======================================================================
 * Fakes: enough Apps Script for PV_Backend's reader and PV_Lookup.
 * ==================================================================== */
function makeSheet(name, grid) {
  return {
    getName: () => name,
    getLastColumn: () => Math.max(...grid.map(r => r.length)),
    getMaxRows: () => grid.length,
    getSheetId: () => 42,
    getParent: () => ({ getUrl: () => 'https://docs.google.com/spreadsheets/d/BOOK' }),
    getDataRange: () => ({ getValues: () => grid.map(r => r.slice()) }),
    getRange: (r, c, nr, nc) => ({
      getValues: () => Array.from({ length: nr }, (_, i) =>
        Array.from({ length: nc }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? '')),
    }),
  };
}

function load() {
  const CACHE = {};
  const sheets = [
    makeSheet('Combined Data CPI Raw', rawGrid()),
    makeSheet('REGION LOOKUP', LOOKUP_GRID.map(r => r.slice())),
    makeSheet('TOPLINE REV LOOKUP2', [['KEY', 'REVENUE TYPE']]),
  ];
  const book = {
    getSheets: () => sheets,
    getSheetByName: n => sheets.filter(s => s.getName() === n)[0] || null,
    getUrl: () => 'https://docs.google.com/spreadsheets/d/BOOK',
  };

  const ctx = {
    JSON, Math, Object, Array, String, Number, RegExp, Error, Date, isNaN, parseInt, parseFloat,
    console: { log: () => {}, error: () => {}, warn: () => {} },
    Logger: { log: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (k in CACHE ? CACHE[k] : null),
        getAll: ks => { const o = {}; ks.forEach(k => { if (k in CACHE) o[k] = CACHE[k]; }); return o; },
        put: (k, v) => { CACHE[k] = v; },
        putAll: m => { Object.keys(m).forEach(k => { CACHE[k] = m[k]; }); },
        remove: k => { delete CACHE[k]; },
        removeAll: ks => ks.forEach(k => { delete CACHE[k]; }),
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    SpreadsheetApp: { openById: () => book, flush: () => {} },
    Utilities: { formatDate: d => String(d) },
    Session: { getScriptTimeZone: () => 'America/Toronto' },
    APP_getGen_: () => '7.build',
    APP_bumpGen_: () => '8',
    APP_openSpreadsheet_: () => book,
    APP_openSpreadsheetOptional_: () => null,
    syncAll: () => ({ ok: true }),
    _cache: CACHE,
  };
  ctx.global = ctx;
  vm.createContext(ctx);
  loadRegions(ctx, 'Config.gs');
  ctx.APP_openSpreadsheet_ = () => book;
  loadRegions(ctx, 'PV_Backend.gs', 'PV_Lookup.gs');
  return ctx;
}

/* ======================================================================
 * 1. The failure, in the shape it was reported
 * ==================================================================== */
console.log('the raw tab sums above its header, and the check still reads it:');
{
  const ctx = load();
  let res, threw = null;
  try { res = ctx.getPvUnmapped({ force: true }); } catch (e) { threw = e.message; }

  checkThat('it does not claim the "Plant" column is missing',
    !/no "Plant" column/i.test(threw || ''), threw);
  checkThat('it does not throw at all', threw === null, threw);
  check('it reports success', res && res.ok, true);
}

/* ======================================================================
 * 2. And it reads the right rows, not the totals band
 * ==================================================================== */
console.log('\nit answers the question it was asked:');
{
  const ctx = load();
  const res = ctx.getPvUnmapped({ force: true });
  const got = (res.region || []).map(g => g.value);

  check('both unmapped plants are found', got.sort(),
    ['8Y88 - ANOTHER NEW PIT', '9Z99 - BRAND NEW PIT']);
  check('the mapped plant is not reported', got.indexOf('3P02 - DUNDAS QUARRY'), -1);
  check('the total agrees', res.total, 2);

  const nine = res.region.filter(g => g.value === '9Z99 - BRAND NEW PIT')[0];
  check('its rows are counted', nine.rows, 2);
  check('the plant code is prefilled from the key', nine.code, '9Z99');
  check('CY volume comes off the LATER "#### Volume" column', nine.cyVol, 351);
  check('CY revenue is summed', nine.cyRev, 10452.5);
  check('biggest money first', res.region[0].value, '9Z99 - BRAND NEW PIT');

  const band = (res.region || []).filter(g => /^\d/.test(g.value) && g.rows === 0);
  check('no row from the totals band leaked in as a plant', band, []);
}

/* ======================================================================
 * 3. The lookup tabs must NOT get a located header row
 * ==================================================================== */
console.log('\nthe lookup tabs are still read by position from row 1:');
{
  const ctx = load();
  const res = ctx.getPvUnmapped({ force: true });
  /* If REGION LOOKUP's header row had been "located" and skipped, the one
     mapped plant would have vanished from `known` and shown up as unmapped. */
  check('the mapped plant stayed mapped',
    (res.region || []).map(g => g.value).indexOf('3P02 - DUNDAS QUARRY'), -1);

  const form = ctx.getPvLookupForm ? ctx.getPvLookupForm() : ctx.PVLOOK.getForm();
  check('the form still labels column A from row 1', form.cols[0].label, 'Plant # - Desc');
  check('...and column B', form.cols[1].label, 'PLANT');
  checkThat('the dropdowns carry the tab\'s own values',
    form.cols[3].options.indexOf('GTA AGG') !== -1, JSON.stringify(form.cols[3].options));
}

/* ======================================================================
 * 4. One reader, not three
 * ==================================================================== */
console.log('\nthere is one tab reader, and PV_Lookup uses it:');
{
  const ctx = load();
  checkThat('PV exports it', typeof ctx.PV.readTab === 'function');
  checkThat('...along with the names it scores against',
    Array.isArray(ctx.PV.RAW_HEADER_NAMES) && ctx.PV.RAW_HEADER_NAMES.length > 8);

  /* The REGION, not the whole of script.gs: run against all eleven sections these
     two negative regexes would match on any backend that happens to slice a
     header off, and this check would pass while PV_Lookup regressed. */
  const src = region('PV_Lookup.gs');
  checkThat('PV_Lookup keeps no header-row rule of its own',
    !/values\[0\]\s*\|\|\s*\[\]/.test(src) && !/\.slice\(1\)/.test(src),
    'a local "header is row 1" reader is back in PV_Lookup.gs');
  checkThat('and it reads tabs through PV.readTab', /PV\.readTab\(/.test(src));

  /* The two files share one cache entry, so a tab either has read is free for
     the other. That only holds while they agree on the key. */
  const ctx2 = load();
  ctx2.PV.readTab('Combined Data CPI Raw', ctx2.PV.RAW_HEADER_NAMES);
  const keysAfterPV = Object.keys(ctx2._cache).filter(k => /tab:Combined Data CPI Raw/.test(k));
  ctx2.getPvUnmapped({ force: true });
  const keysAfterBoth = Object.keys(ctx2._cache).filter(k => /tab:Combined Data CPI Raw/.test(k));
  checkThat('the mapping check adds no second copy of the raw tab',
    keysAfterPV.length > 0 && keysAfterPV.length === keysAfterBoth.length,
    `${keysAfterPV.length} key(s) after PV, ${keysAfterBoth.length} after both`);
}

console.log(fails ? `\n${fails} failing check(s)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
