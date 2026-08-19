#!/usr/bin/env node
/* =============================================================================
 * tests/yearroll.js — the suite reads the year off the data, never the calendar
 * -----------------------------------------------------------------------------
 * On the first of January this application used to go quietly wrong. Not fail —
 * go wrong, which is worse, and in three different ways at once:
 *
 *   · AGG Fuel Recovery summed `market|2026|month` cells. A 2027 export writes
 *     `market|2027|month`, so every sum found nothing and the page published a
 *     complete table of ZEROES under headings that said 2026.
 *   · Ready-Mix resolved current and prior year by asking for the columns named
 *     "2026 Vol" and "2025 Net Sales ex VA (CAD)". A 2027 export has neither;
 *     col_ returns -1, toNum_ turns the missing cell into 0, and the page
 *     publishes zeroes.
 *   · TP01 read the QlikView file with headers.indexOf('2026 Volume'). Same -1,
 *     same silence, and the workbook still downloads.
 *
 * None of it would have thrown, and none of it would have failed a harness:
 * every fixture in tests/ is a 2026 workbook. So this file is the one that runs
 * the code against a workbook from ANOTHER year and insists the answers move
 * with it. **2031 and 2030 are chosen because they are not this year and not
 * the year any other fixture uses** — a check that used the current pair could
 * not tell "reads the data" from "assumes the calendar".
 *
 * WHAT IT COVERS
 *   1. AGG Fuel Recovery, end to end through getFscData: the payload names the
 *      years the sheet named, and the figures are the sheet's rather than zero.
 *   2. Ready-Mix's loaders: the year-named columns are found by shape, and the
 *      two newest win when a workbook carries three.
 *   3. The QlikView sync's column alias: the export's "2031 revenue" maps to
 *      the sheet's "Total Revenue - 2031", for any year, not just the two that
 *      used to be listed.
 *   4. TP01's own reader, which is client-side and had the same bug.
 *   5. Nothing in app.html spells a year into anything a user reads. This is
 *      the check that stops it coming back, and it carries the list of the
 *      places where a year IS still written down on purpose — the QlikView
 *      guides' sample rows, which illustrate the shape of an export and are
 *      not claims about the current year.
 *
 * Run:  node tests/yearroll.js          # no dependencies
 * ===========================================================================*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { region, attach } = require('./scriptgs.js');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');

/* The year the workbooks in this file are from. Deliberately not this one. */
const CY = 2031, PY = 2030;

let fails = 0;
const check = (what, cond, detail) => {
  if (cond) { console.log('  ok    ' + what); return; }
  fails++;
  console.log('  FAIL  ' + what + (detail !== undefined ? '\n        ' + detail : ''));
};
const eq = (what, got, want) =>
  check(what, JSON.stringify(got) === JSON.stringify(want),
        'got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want));

console.log('a workbook from ' + CY + ', read by code written in 2026:\n');

/* ===========================================================================
 * 1. AGG Fuel Recovery — the page that would have published zeroes
 * ======================================================================== */
{
  const HEADER = ['LOOKUP KEY', 'Plant', 'Year', 'Month', CY + ' Volume', PY + ' Volume',
    'CY Rev exWorks', 'PY Rev exWorks', 'New Fuel Surcharge', 'Fuel Surchage'];
  const BAND = ['', '', '', '', 350, 150, 3000, 1500, 425, 0];
  const DATA = [
    ['K1', 'P1', CY, 'Jul', 100, 0, 1000, 0, 300, 0],
    ['K2', 'P1', CY, 'Jul', 200, 0, 2000, 0, 0, 0],
    ['K3', 'P1', PY, 'Jul', 0, 150, 0, 1500, 150, 0],
    ['', '', '', '', '', '', '', '', '', ''],
  ];
  const REGION = [['Plant # - Desc', 'Formatted Market'], ['P1', 'Greater Toronto Area']];

  const sheet = (name, values) => ({ getName: () => name, getDataRange: () => ({ getValues: () => values }) });
  const ctx = {
    console,
    APP_openSpreadsheet_: () => ({ getSheets: () => [
      sheet('Combined Data CPI Raw', [BAND, HEADER].concat(DATA)),
      sheet('REGION LOOKUP', REGION)] }),
    PV: { saskMonthly: () => null },
    __cache: {},
  };
  ctx.APP_getGen_ = () => 'g1';
  ctx.APP_cacheGet_ = k => (Object.prototype.hasOwnProperty.call(ctx.__cache, k) ? JSON.parse(ctx.__cache[k]) : null);
  ctx.APP_cachePut_ = (k, v) => { ctx.__cache[k] = JSON.stringify(v); };
  attach(ctx);
  vm.createContext(ctx);
  vm.runInContext(region('FSC_Backend.gs'), ctx, { filename: 'script.gs (FSC_Backend.gs)' });

  const out = ctx.getFscData();
  const gta = out.summary.YTD.filter(r => r.market === 'Greater Toronto Area')[0];

  eq('FSC · the payload names the sheet\'s years', [out.cyYear, out.pyYear], [CY, PY]);
  eq('FSC · current-year tonnes are read, not zero', gta.totalVol, 300);
  eq('FSC · current-year recovery is read, not zero', gta.totalFSC, 300);
  eq('FSC · $/applied tonne, current year', gta.fscT2026, 3);
  /* The prior-year half is the one a literal 2025 would also have missed. */
  eq('FSC · $/applied tonne, prior year', gta.fscT2025, 1);
  eq('FSC · YOY is the difference of the two', gta.yoy, 2);

  const bm = out.byMonth['Greater Toronto Area'];
  const jul = bm.rows.filter(r => r.month === 'Jul')[0];
  eq('FSC · the by-month table reads both years too', [jul.fscT26, jul.fscT25], [3, 1]);

  const ex = out.exec.YTD.applied.filter(r => r.market === 'GTA AGG' || /GTA/.test(r.market))[0]
          || out.exec.YTD.applied[0];
  check('FSC · the exec table is not empty either', ex && ex.tonnes26 > 0,
        JSON.stringify(out.exec.YTD.applied.slice(0, 2)));
}

/* ===========================================================================
 * 1b. The same page, with the workbook re-headed CY / PY
 * ---------------------------------------------------------------------------
 * The Aggregates workbook's period columns have been renamed from years to
 * CY/PY, and can be renamed back. "CY Volume" names no year at all, so a
 * reader keying its cells by the row's Year finds nothing under it — every
 * figure zero, every heading correct, nothing thrown. The Year column beside
 * it is what dates the pair, and it is the same column the page already reads.
 * ======================================================================== */
{
  const HEADER = ['LOOKUP KEY', 'Plant', 'Year', 'Month', 'CY Volume', 'PY Volume',
    'CY Rev exWorks', 'PY Rev exWorks', 'New Fuel Surcharge', 'Fuel Surcharge'];
  const BAND = ['', '', '', '', 350, 150, 3000, 1500, 425, 0];
  const DATA = [
    ['K1', 'P1', CY, 'Jul', 100, 0, 1000, 0, 300, 0],
    ['K2', 'P1', CY, 'Jul', 200, 0, 2000, 0, 0, 0],
    ['K3', 'P1', PY, 'Jul', 0, 150, 0, 1500, 150, 0],
    ['', '', '', '', '', '', '', '', '', ''],
  ];
  const REGION = [['Plant # - Desc', 'Formatted Market'], ['P1', 'Greater Toronto Area']];

  const sheet = (name, values) => ({ getName: () => name, getDataRange: () => ({ getValues: () => values }) });
  const ctx = {
    console,
    APP_openSpreadsheet_: () => ({ getSheets: () => [
      sheet('Combined Data CPI Raw', [BAND, HEADER].concat(DATA)),
      sheet('REGION LOOKUP', REGION)] }),
    PV: { saskMonthly: () => null },
    __cache: {},
  };
  ctx.APP_getGen_ = () => 'g1';
  ctx.APP_cacheGet_ = k => (Object.prototype.hasOwnProperty.call(ctx.__cache, k) ? JSON.parse(ctx.__cache[k]) : null);
  ctx.APP_cachePut_ = (k, v) => { ctx.__cache[k] = JSON.stringify(v); };
  attach(ctx);
  vm.createContext(ctx);
  vm.runInContext(region('FSC_Backend.gs'), ctx, { filename: 'script.gs (FSC_Backend.gs)' });

  const out = ctx.getFscData();
  const gta = out.summary.YTD.filter(r => r.market === 'Greater Toronto Area')[0];

  eq('FSC CY/PY · the Year column dates the columns', [out.cyYear, out.pyYear], [CY, PY]);
  eq('FSC CY/PY · current-year tonnes are read, not zero', gta.totalVol, 300);
  eq('FSC CY/PY · $/applied tonne, current year', gta.fscT2026, 3);
  eq('FSC CY/PY · $/applied tonne, prior year', gta.fscT2025, 1);
}

/* ===========================================================================
 * 1c. The Aggregates UPLOAD path takes the same two shapes
 * ---------------------------------------------------------------------------
 * `uploadData` replaces the raw tab for one browser session from two QlikView
 * files the user picks. It used to require the exact strings — "2025 Volume",
 * "2026 Volume", "Fuel Surchage" — and refuse a perfectly good download with
 * "Missing column(s)" the day any of them changed. Loud rather than silent,
 * which is why it survived longer than the read path, but wrong either way.
 * ======================================================================== */
{
  const ctx = attach({ console });
  ctx.Utilities = { getUuid: () => 'abcdef0123456789' };
  const BOX = {};
  ctx.CacheService = { getScriptCache: () => ({
    put: (k, v) => { BOX[k] = v; }, get: k => (k in BOX ? BOX[k] : null),
    putAll: o => { for (const k in o) BOX[k] = o[k]; },
    getAll: ks => { const o = {}; ks.forEach(k => { if (k in BOX) o[k] = BOX[k]; }); return o; },
    remove: k => { delete BOX[k]; }, removeAll: ks => ks.forEach(k => { delete BOX[k]; }),
  }) };
  vm.createContext(ctx);
  vm.runInContext(region('PV_Backend.gs'), ctx, { filename: 'script.gs (PV_Backend.gs)' });
  /* uploadData is private to the PV namespace; uploadPvData is the wrapper
     google.script.run calls. Its only side effect is a chunked cache put, and
     the fake CacheService above makes that a no-op. */
  const upload_ = ctx.uploadPvData;

  const DIMS = ['Year', 'Month', 'Plant Type', 'Material Family', 'Product Class [Rock]',
    'Cust Segment [Rock]', 'Product Application', 'Plant', 'Material', 'Customer Parent', 'Sold To'];
  const dimRow = y => [y, 'Jul', 'Fixed', 'Sand', 'Rock', 'Seg', 'App', 'P1', 'M1', 'CP', 'ST'];
  const other = [DIMS.concat(['Other Revenue']), dimRow(CY).concat([100])];

  const upload = (volNames, fscName) => upload_({
    raw: [DIMS.concat(volNames, ['PY Rev exWorks', 'CY Rev exWorks', fscName]),
          dimRow(PY).concat([50, 0], [500, 0, 7]),
          dimRow(CY).concat([0, 60], [0, 600, 9])],
    other: other,
  });

  const years = upload([PY + ' Volume', CY + ' Volume'], 'Fuel Surchage');
  eq('upload · a year-named export is still accepted', [years.ok, years.rows], [true, 2]);

  const cypy = upload(['PY Volume', 'CY Volume'], 'Fuel Surcharge');
  eq('upload · so is a CY/PY-headed one with the typo fixed', [cypy.ok, cypy.rows], [true, 2]);

  let threw = '';
  try { upload(['PY Volume'], 'Fuel Surcharge'); } catch (e) { threw = String(e.message || e); }
  check('upload · one volume column only is still refused, by name',
        /prior volume column|CY Volume/.test(threw), threw || '(it did not throw)');
}

/* ===========================================================================
 * 2. Ready-Mix — the loaders that asked for a year by name
 * ======================================================================== */
{
  /* yearPair_ is private to the RMX namespace IIFE — which is the point of the
     namespace — so it is lifted out by brace-matching and evaluated on its own,
     the way tests/helpers.js lifts the six toNum_. It closes over nothing, and
     a copy that started to would fail here on the first call rather than
     quietly reading a global. */
  const RMXSRC = region('RMX_Backend.gs');
  const at = RMXSRC.indexOf('function yearPair_(sheet, base, dataCyYear){');
  if (at === -1) throw new Error('yearroll.js: yearPair_ is not in the RMX region any more');
  let depth = 0, end = -1;
  for (let i = RMXSRC.indexOf('{', at); i < RMXSRC.length; i++) {
    if (RMXSRC[i] === '{') depth++;
    else if (RMXSRC[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
  }
  /* It leans on §3's shared helpers, which in Apps Script are one global scope
     away. attach() supplies exactly those. */
  const ctx = attach({});
  ctx.yearPair_ = new Function('APP_yearCols_', 'APP_hdrArray_',
    'return (' + RMXSRC.slice(at, end).replace(/^function \w+/, 'function') + ');')(
    ctx.APP_yearCols_, ctx.APP_hdrArray_);

  const idx = names => {
    const o = {};
    names.forEach((n, i) => { o[n] = i; });
    return { idx: o };
  };

  const vol = ctx.yearPair_(idx(['plant', PY + ' vol', CY + ' vol']), 'vol');
  eq('RMX · "#### Vol" resolves to the two newest years', [vol.cy, vol.py], [CY, PY]);
  eq('RMX · ...and to their columns', [vol.cyCol, vol.pyCol], [2, 1]);

  const rev = ctx.yearPair_(idx(['plant', 'total revenue - ' + PY, 'total revenue - ' + CY]),
                            'total revenue');
  eq('RMX · "Total Revenue - ####" resolves the same way', [rev.cy, rev.py], [CY, PY]);

  /* A workbook that still carries a third, older year: the two newest win, and
     the oldest is ignored rather than mistaken for PY. */
  const three = ctx.yearPair_(idx([(PY - 1) + ' vol', CY + ' vol', PY + ' vol']), 'vol');
  eq('RMX · three years in one workbook — the two newest win', [three.cy, three.py], [CY, PY]);

  /* A workbook with only one year still answers rather than throwing. The YEAR
     below it is known — a prior year always exists — but there is no COLUMN
     for it, and those are two different answers. */
  const one = ctx.yearPair_(idx([CY + ' vol']), 'vol');
  eq('RMX · one year only — cy found, py has no column', [one.cy, one.py, one.pyCol], [CY, PY, -1]);

  /* THE WORKBOOK HAS BEEN RE-HEADED. "CY Vol" / "PY Vol" name no year at all,
     so the pair is only datable from the rows — the Bill Month the loader
     already reads. Without the year handed in there is nothing to key a cell
     on, which is the whole of this failure: a page of zeroes under correct
     headings, and nothing thrown. */
  const cy = idx(['plant', 'py vol', 'cy vol']);
  eq('RMX · "CY Vol" / "PY Vol" find their columns', 
     [ctx.yearPair_(cy, 'vol', CY).cyCol, ctx.yearPair_(cy, 'vol', CY).pyCol], [2, 1]);
  eq('RMX · and the Bill Month dates them', 
     [ctx.yearPair_(cy, 'vol', CY).cy, ctx.yearPair_(cy, 'vol', CY).py], [CY, PY]);
  eq('RMX · a mixed header — "Total Revenue -PY" with no space', 
     ctx.yearPair_(idx(['total revenue -py', 'total revenue - cy']), 'total revenue', CY).cyCol, 1);

  /* Every call site hands the year over. A call that forgets it works on a
     year-named workbook and reads zero on a CY/PY one, which is exactly the
     failure that does not announce itself. */
  const calls = (RMXSRC.match(/yearPair_\(s,[^\n]*\)/g) || []);
  check('RMX · every yearPair_ call passes the data year (' + calls.length + ' call sites)',
        calls.length >= 4 && calls.every(c => /cyData/.test(c)),
        calls.join('\n        '));
}

/* ===========================================================================
 * 3. The QlikView sync's column alias
 * ======================================================================== */
{
  const src = region('QlikSync.gs');
  const m = src.match(/var ALIAS_EXTRA = \{[\s\S]*?function alias_\(spec, base\) \{[\s\S]*?\n  \}/);
  check('sync · the alias table and alias_ are where this expects them', !!m);
  if (m) {
    const ctx = attach({});
    vm.createContext(ctx);
    vm.runInContext(m[0].replace(/^ {2}/gm, ''), ctx);
    const spec = { alias: ctx.ALIAS_EXTRA };
    /* Aliasing works on the BASE — the name with its period taken off — so one
       entry covers every year and both spellings of every year. */
    const base = n => ctx.alias_(spec, ctx.APP_period_(n).base);
    eq('sync · "#### revenue" → "total revenue"', base(CY + ' revenue'), 'total revenue');
    eq('sync · and so does "Total Revenue -PY"', base('Total Revenue -PY'), 'total revenue');
    eq('sync · the (m3 applied to) form is not swallowed by the plain one',
       base(CY + ' revenue (m3 applied to)'), 'revenue (m3 applied to)');
    eq('sync · "#### m3 applied to" keeps its own base',
       base(CY + ' m3 applied to'), 'm3 applied to');
    eq('sync · 2026 reduces the same way as ' + CY, base('2026 revenue'), 'total revenue');
    eq('sync · a name with no period is untouched', base('major project segment'),
       'major project segment');
    eq('sync · two literals, neither carrying a year',
       Object.keys(ctx.ALIAS_EXTRA).sort(), ['plant_descr', 'revenue']);
  }
}

/* ===========================================================================
 * 4. TP01 — the same bug, client-side
 * ======================================================================== */
{
  const at = APP.indexOf('function iYearCol(headers, suffix)');
  check('TP01 · iYearCol is in app.html', at !== -1);
  if (at !== -1) {
    const end = APP.indexOf('\n  }', at) + 4;
    const iYearCol = new Function(APP.slice(at, end) + '; return iYearCol;')();
    const hdr = ['Sold To', 'Plant', 'Material', 'Month', CY + ' Volume', CY + ' ASP ex-Works'];
    eq('TP01 · the volume column is found by shape', iYearCol(hdr, 'Volume'), 4);
    eq('TP01 · so is ASP ex-Works', iYearCol(hdr, 'ASP ex-Works'), 5);
    eq('TP01 · an export carrying both years uses the newer',
       iYearCol(['x', PY + ' Volume', CY + ' Volume'], 'Volume'), 2);
    eq('TP01 · a missing column is still -1, not column 0',
       iYearCol(['Sold To', 'Plant'], 'Volume'), -1);
    eq('TP01 · a suffix must match in full', iYearCol([CY + ' Volume x'], 'Volume'), -1);
    /* And the export re-headed the way the workbooks already have been. */
    eq('TP01 · "CY Volume" is found too',
       iYearCol(['x', 'PY Volume', 'CY Volume'], 'Volume'), 2);
    eq('TP01 · a trailing period, dash optional',
       iYearCol(['Volume -PY', 'Volume - CY'], 'Volume'), 1);
    eq('TP01 · PY on its own is read rather than missed',
       iYearCol(['x', 'PY ASP ex-Works'], 'ASP ex-Works'), 1);
  }
  check('TP01 · no indexOf on a year-named column survives',
        !/indexOf\('\d{4} (Volume|ASP ex-Works)'\)/.test(APP),
        'a literal year is back in TP01\'s column lookup');
}

/* ===========================================================================
 * 5. Nothing a user reads spells a year — and what is allowed to
 * ---------------------------------------------------------------------------
 * Every remaining four-digit year in app.html has to be on this list. They are
 * all the same kind of thing: SAMPLE ROWS in the QlikView guides, which show
 * the shape of an export ("Jan-2026 · P100 · MAT-1"), beside made-up plant
 * codes and made-up materials. They are illustrations of a format, not claims
 * about the current year, and freezing them is the point — a guide that
 * silently re-dated itself every January would be harder to trust, not easier.
 * ======================================================================== */
{
  /* COMMENTS AND SAMPLE ROWS ARE NOT THE THING BEING CHECKED, so both come out
     first — and the comments come out with a state machine rather than a line
     shape, because this file's block comments continue on lines that begin
     with neither / nor *. A build stamp like "2026-08-11" is a date, not a
     year, and is dropped the same way. */
  const noComments = (src) => {
    let out = '', i = 0, mode = 0;   /* 0 code · 1 block · 2 line · 3 html */
    while (i < src.length) {
      const two = src.substr(i, 2), four = src.substr(i, 4);
      if (mode === 0) {
        if (two === '/*') { mode = 1; i += 2; continue; }
        if (two === '//') { mode = 2; i += 2; continue; }
        if (four === '<!--') { mode = 3; i += 4; continue; }
        out += src[i++]; continue;
      }
      if (mode === 1 && two === '*/') { mode = 0; i += 2; continue; }
      if (mode === 2 && src[i] === '\n') { mode = 0; out += '\n'; i++; continue; }
      if (mode === 3 && src.substr(i, 3) === '-->') { mode = 0; i += 3; continue; }
      if (src[i] === '\n') out += '\n';
      i++;
    }
    return out;
  };

  /* What a year is still allowed to appear in: a sample row or a sample header
     in one of the QlikView guides. Every one of them sits beside a made-up
     plant ("P100"), a made-up material ("MAT-1") or a made-up mix
     ("AB123 - 25 MPa"), which is what makes them illustrations of a FORMAT
     rather than statements about the current year. Re-dating them every
     January would make the guide harder to trust, not easier. */
  const ALLOWED = [
    /<t[hd]>20\d\d[^<]*<\/t[hd]>/,                 /* a sample header or cell */
    /<td>Jan-20\d\d<\/td>/,
    /Total Revenue - 20\d\d/,
    /M3 Applied To - 20\d\d/,
    /Revenue \(M3 Applied To\) - 20\d\d/,
  ];
  const code = noComments(APP).replace(/20\d\d-\d\d(-\d\d)?/g, '');
  const lines = code.split('\n');
  const carry = lines.filter(l => /\b20(2[4-9]|3\d)\b/.test(l));
  const stray = [];
  carry.forEach((l, n) => {
    if (ALLOWED.some(re => re.test(l))) return;
    stray.push(l.trim().slice(0, 100));
  });
  check('app.html · every year outside a comment is a guide sample (' + carry.length +
        ' lines carry one)', stray.length === 0, stray.join('\n        '));

  /* The other direction: the pages must actually be asking. A page that stopped
     reading cyYear would pass the check above by saying nothing at all. */
  const asks = (APP.match(/cyYear/g) || []).length;
  check('app.html · the pages read cyYear from the payload (' + asks + ' references)', asks >= 8,
        'only ' + asks + ' — a page has stopped taking its year from the data');
}

console.log(fails ? `\n${fails} failing check(s)`
                  : '\nyearroll.js: a ' + CY + ' workbook reads as ' + CY + ', everywhere.');
process.exit(fails ? 1 : 0);
