#!/usr/bin/env node
/* =============================================================================
 * tests/tp01engine.js — the TP01 comparison, and the rules that must not drift
 * -----------------------------------------------------------------------------
 * TPE (script.gs §10) is where every Transfer Price number is worked out. It used
 * to be in the browser, and the reason it moved is that the weekly trigger needs
 * the same numbers and a trigger has no browser — so this is the code the page
 * runs AND the code the trigger runs, and there is no second copy to diff it
 * against. That is the point of it, and it is also why this harness exists: with
 * one implementation, the only thing holding the rules in place is a test that
 * states them.
 *
 * Nothing here touches Google. The region is sliced out of script.gs and run in
 * a vm with PV.rawEnriched() and APP_CONFIG stubbed, which is honest because
 * TPE reads exactly two things from outside itself and those are both of them.
 *
 * WHAT IT CLAIMS, one case per rule that has a way of going quietly wrong:
 *
 *   1  key         the two sides build the same Concat Key from differently
 *                  shaped inputs — Plant and Material code-first, Sold To
 *                  code-LAST, and one prefix character dropped from the
 *                  ship-to / sold-to on both sides
 *   2  tp01-wins   a key priced on both SAP tabs takes its TP01 price
 *   3  blank       an unmatched row gets BLANK, not zero, in all three
 *                  calculated columns
 *   4  revenue     Additional Revenue to Post and Total Corrected Revenue
 *   5  parent      Customer Parent is exact equality — "Metrix RMX" is a
 *                  different company and must not come through
 *   6  year        a row from another year is dropped, and the year comes off
 *                  the Year column rather than the calendar
 *   7  rollup      the drilled-down rows sum, and the ASP is RECOMPUTED from
 *                  the sums rather than averaged from the rows
 *   8  period      the volume and ASP columns are found by SHAPE, and a header
 *                  that names no period THROWS rather than returning -1
 *   9  exception   below ASP by more than a cent, asymmetrically
 *  10  aging       report date minus Valid From, longest first
 *  11  date        the report date comes off the FILE, never the calendar
 *  12  market      the split, and a plant with no lookup row
 *  13  combined    the all-markets exceptions grid the automated mail attaches
 *
 * Run:  node tests/tp01engine.js
 * ===========================================================================*/
'use strict';
const vm = require('vm');
const { region } = require('./scriptgs.js');

let failures = 0, checks = 0;
function ok(name, cond, detail) {
  checks++;
  if (cond) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (detail ? '\n       ' + detail : ''));
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
     'got  ' + JSON.stringify(got) + '\n       want ' + JSON.stringify(want));
}

/* ---------------------------------------------------------------------------
 * The context. APP_log is installed first for the reason scriptgs.js gives:
 * Apps Script evaluates every .gs into one global scope, so a region that logs
 * can reach §2's helper at run time and a harness that does not provide it is
 * modelling the scope wrongly.
 * ------------------------------------------------------------------------- */
const logs = [];
function ctxWith(rows, cyYear, parent) {
  if (cyYear !== undefined) rows.cyYear = cyYear;
  const ctx = {
    console,
    APP_log: (level, src, msg, d) => logs.push({ level, src, msg, d }),
    APP_CONFIG: { TP01_MAIL: { CUSTOMER_PARENT: parent === undefined ? 'Amrize RMX' : parent } },
    PV: { rawEnriched: () => rows }
  };
  vm.createContext(ctx);
  vm.runInContext(region('TP01_Engine.gs'), ctx, { filename: 'script.gs §10 TP01_Engine.gs' });
  return ctx;
}

/* One AGG row, at the shape the real workbook has:
 *   Sold To   "BURLINGTON READY MIX - P4Q01"   code LAST
 *   Plant     "3G00 - STONEWALL QUARRY"        code FIRST
 *   Material  "9023 - LI,40-20MM,CLEAR"        code FIRST, and a comma in the
 *                                              description that is not a " - "
 */
function aggRow(o) {
  return Object.assign({
    custParent: 'Amrize RMX', year: 2026, month: 'Jan', market: 'Manitoba',
    soldTo: 'BURLINGTON READY MIX - P4Q01', plant: '3G00 - STONEWALL QUARRY',
    material: '9023 - LI,40-20MM,CLEAR', cyVol: 100, cyRev: 3000
  }, o || {});
}

/* A SAP workbook grid, with the export's own furniture above the header: a
 * title, the date, "Source: SAP", a blank, then the CnTy row. */
function sapGrid(tab, rows, dateCell) {
  const head = tab === 'TP01'
    ? ['CnTy','S Plant','Material','Ship-to / Partner PC','Amount','Unit','per','UoM','Valid From','Valid to']
    : ['CnTy','Plant','Material','Ship-To Party','Amount','Condition currency','Pricing unit','Unit of measure','Valid From','Valid to'];
  return [['Transfer Prices ' + tab + ' Canada Central Region'],
          ['', dateCell === undefined ? '07/14/2026' : dateCell],
          ['', 'Source: SAP'],
          [],
          head].concat(rows.map(r => [tab].concat(r)));
}
/* [ plant, material, shipTo, amount, validFrom ] */
function sapRow(a) { return [a[0], a[1], a[2], a[3], 'CAD', 1, 'TO', a[4] || '01/01/2026', '12/31/2026']; }

function readBoth(TPE, tp01Rows, ziprRows, dateCell) {
  return TPE.readSap({ TP01: sapGrid('TP01', tp01Rows, dateCell),
                       ZIPR: sapGrid('ZIPR', ziprRows, dateCell) });
}

console.log('tp01engine.js — TPE, sliced out of script.gs §10\n');

/* ---- 1 / 2 / 3 / 4 : the key, the tab precedence, blanks, the revenue ---- */
{
  const ctx = ctxWith([
    aggRow({ cyVol: 200, cyRev: 6000 }),                                  // ASP 30
    aggRow({ month: 'Feb', material: '9999 - NOT IN SAP', cyVol: 10, cyRev: 100 })
  ], 2026);
  const TPE = ctx.TPE;

  const sap = readBoth(TPE,
    [sapRow(['3G00', '9023', '64Q01', 25.00])],     // TP01 says 25
    [sapRow(['3G00', '9023', '64Q01', 99.00])]);    // ZIPR says 99 for the same key

  eq('1  key: both sides reduce to plant + 4-char ship-to + material',
     sap.rows[0]['Concat Key'], '3G004Q019023');
  ok('1  key: the AGG side agrees',
     TPE.buildQlkKey('3G00 - STONEWALL QUARRY', 'BURLINGTON READY MIX - P4Q01',
                     '9023 - LI,40-20MM,CLEAR') === '3G004Q019023');

  const cmp = TPE.compare(sap, TPE.qlikFromSheet());
  const H = cmp.headers;
  const iTP = H.indexOf('SAP Transfer Price');
  const iAdd = H.indexOf('Additional Revenue to Post');
  const iTot = H.indexOf('Total Corrected Revenue ex-Works');
  const matchedRow = cmp.rows.find(r => r[H.indexOf('Concat Key')] === '3G004Q019023');
  const missRow    = cmp.rows.find(r => r[H.indexOf('Concat Key')] !== '3G004Q019023');

  eq('2  tp01-wins: a key priced on both tabs takes the TP01 price', matchedRow[iTP], 25);
  eq('3  blank: an unmatched row gets blank, never zero, in all three columns',
     [missRow[iTP], missRow[iAdd], missRow[iTot]], ['', '', '']);
  eq('4  revenue: (TP - ASP) x Volume', matchedRow[iAdd], (25 - 30) * 200);
  eq('4  revenue: total corrected = that + ASP x Volume', matchedRow[iTot], (25 - 30) * 200 + 30 * 200);
  eq('4  counts', [cmp.matched, cmp.unmatched], [1, 1]);
}

/* ---- 5 / 6 / 7 : the filter, the year, the roll-up ---------------------- */
{
  const ctx = ctxWith([
    aggRow({ cyVol: 100, cyRev: 2500 }),                    // rolls with the next
    aggRow({ cyVol: 100, cyRev: 3500, prodClass: 'other' }),
    aggRow({ custParent: 'Metrix RMX', cyVol: 50, cyRev: 5000 }),
    aggRow({ year: 2025, cyVol: 0, cyRev: 0 }),
    aggRow({ year: 2025, cyVol: 77, cyRev: 777 })           // a stray with figures
  ], 2026);
  const q = ctx.TPE.qlikFromSheet();

  eq('5  parent: "Metrix RMX" is a different company and does not come through',
     q.rows.length, 1);
  eq('6  year: a 2025 row is dropped even when it carries figures',
     q.meta.matchedParentRows, 2);
  eq('7  rollup: the drilled-down rows sum', [q.rows[0][6], q.rows[0][7]], [200, 6000]);
  eq('7  rollup: the ASP is recomputed from the sums, not averaged from the rows',
     q.rows[0][8], 30);
}
{
  /* The case where a mean and a weighted mean disagree, which is the whole
     reason the ASP is recomputed: 10t at $10 and 990t at $50 is $49.60, not
     the $30 an unweighted average would give. */
  const ctx = ctxWith([
    aggRow({ cyVol: 10,  cyRev: 100 }),
    aggRow({ cyVol: 990, cyRev: 49500 })
  ], 2026);
  const q = ctx.TPE.qlikFromSheet();
  eq('7  rollup: revenue-weighted, and it is not the mean of the two ASPs',
     q.rows[0][8], 49.6);
}

/* ---- 8 : the period columns, found by shape and never by name ----------- */
{
  const ctx = ctxWith([aggRow({})], 2026);
  const TPE = ctx.TPE;
  eq('8  period: a four-digit year at the front', TPE.iYearCol(['2026 Volume'], 'Volume'), 0);
  eq('8  period: CY beats a named year', TPE.iYearCol(['2026 Volume', 'CY Volume'], 'Volume'), 1);
  eq('8  period: the newer year wins', TPE.iYearCol(['2025 Volume', '2027 Volume'], 'Volume'), 1);
  eq('8  period: PY only when it is all there is', TPE.iYearCol(['PY Volume'], 'Volume'), 0);
  eq('8  period: a token at the end, dash optional',
     TPE.iYearCol(['Total Revenue - 2025'], 'Total Revenue'), 0);
  eq('8  period: a header naming none of it matches nothing',
     TPE.iYearCol(['Volume'], 'Volume'), -1);

  /* AND THE FAILURE THAT SHIPPED ONCE: a volume column nobody can find used to
     mean every revenue figure came out of a blank cell while the workbook built
     and downloaded perfectly. It throws now. */
  const sap = readBoth(TPE, [sapRow(['3G00', '9023', '64Q01', 25])], []);
  let threw = '';
  try {
    TPE.compare(sap, { headers: ['Market','Sold To','Plant','Material','Month','Volume','ASP ex-Works'],
                       rows: [['Manitoba','X - P4Q01','3G00 - Q','9023 - M','Jan',1,1]], source: 'upload' });
  } catch (e) { threw = String(e.message); }
  ok('8  period: a volume column naming no period THROWS rather than reading as -1',
     /no volume and\/or ASP ex-Works column/.test(threw), threw || '(nothing was thrown)');
}

/* ---- 9 / 10 / 12 / 13 : exceptions, aging, markets, the combined grid --- */
{
  const ctx = ctxWith([
    /* ASP 30, SAP 25  -> under by $5      -> exception */
    aggRow({ cyVol: 100, cyRev: 3000 }),
    /* ASP 30, SAP 35  -> OVER             -> not an exception */
    aggRow({ month: 'Feb', material: '9024 - X', cyVol: 100, cyRev: 3000 }),
    /* ASP 30.01, SAP 30 -> under by 1c    -> not an exception */
    aggRow({ month: 'Mar', material: '9025 - X', cyVol: 100, cyRev: 3001 }),
    /* ASP 30.02, SAP 30 -> under by 2c    -> exception, and the oldest */
    aggRow({ month: 'Apr', material: '9026 - X', cyVol: 100, cyRev: 3002 }),
    /* a different market */
    aggRow({ market: 'Saskatchewan', material: '9027 - X', cyVol: 100, cyRev: 3000 }),
    /* a plant with no REGION LOOKUP row */
    aggRow({ market: '', material: '9028 - X', plant: '3Z99 - NOWHERE', cyVol: 5, cyRev: 100 })
  ], 2026);
  const TPE = ctx.TPE;
  logs.length = 0;

  const sap = readBoth(TPE, [
    sapRow(['3G00', '9023', '64Q01', 25.00, '01/01/2026']),
    sapRow(['3G00', '9024', '64Q01', 35.00, '01/01/2026']),
    sapRow(['3G00', '9025', '64Q01', 30.00, '01/01/2026']),
    sapRow(['3G00', '9026', '64Q01', 30.00, '2025-06-01']),   // in effect far longer
    sapRow(['3G00', '9027', '64Q01', 25.00, '01/01/2026']),
    sapRow(['3Z99', '9028', '64Q01', 1.00,  '01/01/2026'])
  ], []);
  const cmp = TPE.compare(sap, TPE.qlikFromSheet());

  eq('9  exception: below by more than a cent only, and never when above',
     Object.keys(cmp.exceptions).sort(), ['Manitoba', 'Saskatchewan', 'Unknown']);
  eq('9  exception: Manitoba has the $5 and the 2c rows, not the 1c or the over-priced one',
     cmp.exceptions.Manitoba.length, 2);

  const iKey = cmp.headers.indexOf('Concat Key');
  const first = cmp.rows[cmp.exceptions.Manitoba[0]][iKey];
  ok('10 aging: longest-outstanding first', /9026$/.test(first),
     'first exception key was ' + first);
  eq('11 date: the report date is the file’s own cell, normalised',
     [cmp.reportDate, cmp.dateSource], ['2026-07-14', 'file']);
  eq('10 aging: report date minus Valid From, in whole days',
     cmp.days[cmp.exceptions.Manitoba[0]], 408);   // 2025-06-01 -> 2026-07-14

  eq('12 market: the split follows the Market column',
     Object.keys(cmp.markets).sort(), ['Manitoba', 'Saskatchewan', 'Unknown']);
  ok('12 market: a plant with no lookup row is LOGGED, not dropped',
     logs.some(l => l.level === 'warn' && /REGION LOOKUP/.test(l.msg)),
     JSON.stringify(logs.map(l => l.msg)));

  const all = TPE.grid('exc', null, cmp);
  eq('13 combined: every market in one grid, with Market already a column',
     all.count, 4);
  eq('13 combined: the two aging columns go on the end',
     all.headers.slice(-2), ['SAP Valid From', 'Days at Incorrect Price']);
  ok('13 combined: sorted longest-outstanding first across markets',
     all.rows[0][all.headers.indexOf('Days at Incorrect Price')] === 408);
  const fmts = TPE.numberFormats(all.headers);
  ok('13 combined: the money columns carry a currency format',
     fmts[all.headers.indexOf('SAP Transfer Price')] === '"$"#,##0.00');
}

/* ---- 11 : the date, and what happens when the file has lost it ---------- */
{
  const ctx = ctxWith([aggRow({})], 2026);
  const sap = ctx.TPE.readSap({
    TP01: sapGrid('TP01', [sapRow(['3G00', '9023', '64Q01', 25])], 'not a date'),
    ZIPR: sapGrid('ZIPR', [], 'not a date')
  });
  eq('11 date: a file with no readable date reports EMPTY rather than today',
     [sap.reportDate, sap.dateSource], ['', '']);
}

/* ---- both tabs are required ------------------------------------------- */
{
  const ctx = ctxWith([aggRow({})], 2026);
  let threw = '';
  try { ctx.TPE.readSap({ TP01: sapGrid('TP01', [sapRow(['3G00','9023','64Q01',25])]) }); }
  catch (e) { threw = String(e.message); }
  ok('   both SAP tabs are required — a half-priced list is refused',
     /both a TP01 and a ZIPR tab/.test(threw), threw || '(nothing was thrown)');
}

console.log('\n' + checks + ' checks, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
