/* FSC_Backend header-row gate.
 *
 * The Fuel Recovery page died with
 *
 *   The Combined Data CPI Raw data is missing these column(s):
 *   Plant, Year, Month, "#### Volume", New Fuel Surcharge
 *
 * which is not five renamed columns - it is the header read one row too high.
 * "Combined Data CPI Raw" sums ABOVE its header, so row 1 is a totals band,
 * row 2 the column names and row 3 the first record. FSC_Backend used to take
 * grid[0] as the header; it now scores the first rows and takes the best, the
 * way PV_Backend's tabHeaderRow_ does.
 *
 * This harness runs FSC_Backend.gs under Node with the two Apps Script globals
 * it touches stubbed (APP_openSpreadsheet_, PV), over a grid shaped like the
 * real tab - totals band and all.
 *
 *   node tests/fscheader.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const { region, attach } = require('./scriptgs.js');
/* Was FSC_Backend.gs; it is script.gs §6 now. tests/gsparity.js proves the region
   is still byte-for-byte that file, which is what keeps this harness a proof
   about the code that actually runs. */
const SRC = region('FSC_Backend.gs');

/* ---- the tab, as the sheet really lays it out ---------------------------- */
const HEADER = ['LOOKUP KEY', 'Plant', 'Year', 'Month', '2026 Volume', '2025 Volume',
  'CY Rev exWorks', 'PY Rev exWorks', 'New Fuel Surcharge', 'Fuel Surchage'];

/* row 1: the totals band. No column names on it - only sums. */
const BAND = ['', '', '', '', 350, 150, 3000, 1500, 425, 0];

const DATA = [
  //  key   plant  year   month  v26  v25  cyRev  pyRev  newFsc  rawFsc
  ['K1', 'P1', 2026, 'Jul', 100, 0, 1000, 0, 300, 0],
  ['K2', 'P1', 2026, 'Jul', 200, 0, 2000, 0, 0, 0],   // no charge -> not applied
  ['K3', 'P2', 2025, 'Jul', 0, 150, 0, 1500, 100, 0],
  ['K4', 'P3', 2026, 'Jul', 50, 0, 500, 0, 25, 0],    // plant absent from REGION LOOKUP
  ['', '', '', '', '', '', '', '', '', ''],           // padding
];

const REGION = [
  ['Plant # - Desc', 'Formatted Market'],
  ['P1', 'Greater Toronto Area'],
  ['P2', 'Manitoba'],
];

/* ---- the smallest SpreadsheetApp that FSC_Backend actually uses ---------- */
let SHEET_READS = 0;                    // every getDataRange().getValues() of the raw tab
function fakeSheet(name, values) {
  return { getName: () => name, getDataRange: () => ({ getValues: () => {
    if (/cpi/i.test(name)) SHEET_READS++;
    return values;
  } }) };
}
function fakeSS(cpi) {
  const sheets = [fakeSheet('Combined Data CPI Raw', cpi), fakeSheet('REGION LOOKUP', REGION)];
  return { getSheets: () => sheets };
}

function load(cpi) {
  const ctx = {
    console,
    APP_openSpreadsheet_: () => fakeSS(cpi),
    PV: { saskMonthly: () => null },      // no Saskatchewan rates sheet configured
  };
  /* The chunked cache helpers live in Code.gs, which this harness does not load.
     Stubbing them here is not decoration: getFscData caches its READ and its
     RESULT now, and a harness that leaves them undefined would only ever measure
     the cold path. __cache is inspected below to prove the second call does not
     go back to the sheet. */
  ctx.__cache = {};
  ctx.APP_getGen_  = function(){ return 'g1'; };
  ctx.APP_cacheGet_ = function(k){ return Object.prototype.hasOwnProperty.call(ctx.__cache, k)
    ? JSON.parse(ctx.__cache[k]) : null; };
  ctx.APP_cachePut_ = function(k, v){ ctx.__cache[k] = JSON.stringify(v); };
  /* APP_log lives in §2 and this harness loads only §6's FSC region. Apps Script
     puts every .gs in ONE global scope, so the helper really is reachable from
     here at run time — chunk 18 added a log line to getFscData and this harness
     died on "APP_log is not defined", which reads like a broken build and is a
     missing global. attach() records the calls on ctx.__log. */
  attach(ctx);
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'script.gs (FSC_Backend.gs)' });
  return ctx;
}

/* ---- assertions ---------------------------------------------------------- */
let failed = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

/* 1. the real layout: totals band, header on row 2 */
{
  const out = load([BAND, HEADER].concat(DATA)).getFscData();
  const gta = out.summary.YTD.filter(r => r.market === 'Greater Toronto Area')[0];

  check('band + header row 2 · latest month', out.latestMonth, 'Jul');
  check('band + header row 2 · markets',
    out.markets.slice().sort(), ['Greater Toronto Area', 'Manitoba', 'Unmapped plants']);
  check('band + header row 2 · GTA total volume', gta.totalVol, 300);
  check('band + header row 2 · GTA recovery $', gta.totalFSC, 300);
  check('band + header row 2 · GTA applied tonnes (charged rows only)', gta.appliedVol, 100);
  check('band + header row 2 · GTA $/applied tonne', gta.fscT2026, 3);
  check('band + header row 2 · unmapped plant kept, not dropped', out.unknownPlants, ['P3']);
  check('band + header row 2 · rows read (padding skipped)', out.rowsRead, 4);
}

/* 2. a file WITHOUT the band still reads - the locator must not require one */
{
  const out = load([HEADER].concat(DATA)).getFscData();
  const gta = out.summary.YTD.filter(r => r.market === 'Greater Toronto Area')[0];
  check('header on row 1 · GTA recovery $', gta.totalFSC, 300);
  check('header on row 1 · rows read', out.rowsRead, 4);
}

/* 3. 2025 lands on the PY revenue column and its own volume column */
{
  const out = load([BAND, HEADER].concat(DATA)).getFscData();
  const mb = out.byMonth['Manitoba'].rows.filter(r => r.month === 'Jul')[0];
  check('prior year · Manitoba Jul 2025 $', mb.fsc25, 100);
  check('prior year · Manitoba Jul 2025 applied tonnes', mb.vol25, 150);
  check('prior year · nothing filed under 2026', mb.fsc26, 0);
}

/* 4. a genuinely wrong header still fails, and now names the row it read */
{
  const bad = [BAND, ['Plant', 'Year', 'Month'], ['P1', 2026, 'Jul']];
  let msg = '';
  try { load(bad).getFscData(); } catch (e) { msg = e.message; }
  check('bad header · still throws', /missing these column\(s\)/.test(msg), true);
  check('bad header · names the row read', /header was read as row 2/.test(msg), true);
  check('bad header · lists what it found', /plant, year, month/.test(msg), true);
}

/* 5. THE REPORT MONTH IS LAST CALENDAR MONTH, NOT THE NEWEST IN THE FILE.
 *
 * This page used to report whichever month the export happened to reach, so
 * once the sheet carried a part-billed running month it published that one
 * while Price & Volume, Ready-Mix and RMX Fuel Recovery all published last
 * month — one deck, two months. The other three backends already resolve it
 * this way; the assertion is that this one now agrees.
 *
 * Built relative to today so the harness cannot rot: a full LAST month and a
 * part-billed CURRENT month, which is exactly the shape that used to break it.
 */
{
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const cur = new Date().getMonth() + 1;
  const prev = cur - 1 || 12;                     // January -> December, as the backend does

  const row = (mo, vol, fsc) => ['K' + mo, 'P1', 2026, MON[mo - 1], vol, 0, vol * 10, 0, fsc, 0];
  const grid = [BAND, HEADER, row(prev, 100, 300), row(cur, 40, 80)];
  const of = out => out.summary.YTD.filter(r => r.market === 'Greater Toronto Area')[0];

  const dflt = load(grid).getFscData();
  check('report month · defaults to LAST month, not the part-billed one',
    dflt.latestMonth, MON[prev - 1]);
  check('report month · MTD is that month alone',
    dflt.summary.MTD.filter(r => r.market === 'Greater Toronto Area')[0].totalFSC, 300);
  check('report month · YTD stops there, the running month is excluded', of(dflt).totalFSC, 300);
  check('report month · echoed back for the picker', dflt.month, prev);
  check('report month · picker is offered both months', dflt.months, [prev, cur].sort((a, b) => a - b));

  const pinned = load(grid).getFscData({ month: cur });
  check('report month · an explicit month pins it', pinned.latestMonth, MON[cur - 1]);
  check('report month · and YTD then runs through it', of(pinned).totalFSC, 380);
  check('report month · the default is still reported alongside', pinned.defaultMonth, prev);

  /* last month not exported yet -> fall back to the newest month that is */
  const early = load([BAND, HEADER, row(prev === 1 ? 12 : prev - 1, 70, 210)]).getFscData();
  check('report month · falls back when last month is not in the export yet',
    early.month, prev === 1 ? 12 : prev - 1);
}

/* ---- the read is cached ---------------------------------------------------
 * readData_() did a full getDataRange().getValues() of the raw tab on EVERY
 * call and getFscData had no result cache either, so this page re-read tens of
 * thousands of rows out of Sheets on every open, every '↻ Update from source',
 * and once more for each of the deck's two fuel slides. Nothing else in the
 * suite does that — PV.getReport, RMX and the Overview all answer from a cached
 * result and only touch the sheet on a miss.
 *
 * Both layers are cached now. This is what proves it, and what would catch a
 * cache key that varies when it should not: the same question twice must read
 * the sheet ONCE.
 */
{
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const cur = new Date().getMonth() + 1;
  const prev = cur - 1 || 12;
  const row = (mo, vol, fsc) => ['K' + mo, 'P1', 2026, MON[mo - 1], vol, 0, vol * 10, 0, fsc, 0];
  const grid = [BAND, HEADER, row(prev, 100, 300), row(cur, 40, 80)];

  const api = load(grid);
  SHEET_READS = 0;
  const first = api.getFscData({});
  const readsAfterFirst = SHEET_READS;
  const second = api.getFscData({});
  check('the read is cached · one sheet read for the first call', readsAfterFirst, 1);
  check('the read is cached · and none for the second', SHEET_READS, readsAfterFirst);
  check('the read is cached · with the same answer',
    JSON.stringify(second) === JSON.stringify(first), true);
  /* a different question is a different entry, not a stale hit */
  const other = api.getFscData({ month: cur });
  check('the read is cached · a different month is its own entry',
    other.month === cur, true);
}

console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nall checks passed');
process.exit(failed ? 1 : 0);
