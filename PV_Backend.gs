/*****************************************************************************
 * PRICE & VOLUME ANALYSIS — backend (namespaced as PV)
 * ---------------------------------------------------------------------------
 * This is the ORIGINAL Price & Volume backend, unchanged except that:
 *   1. it is wrapped in an IIFE so its helpers (CONFIG, norm_, toNum_,
 *      cachePutBig_, getReport, ...) cannot collide with the RMX backend, and
 *   2. its sheet opener now reads the Settings-chosen sheet (APP_openSpreadsheet_).
 * Client-callable entry points are re-exported as plain top-level functions
 * at the bottom so google.script.run can reach them.
 *****************************************************************************/
var PV = (function () {

/**
 * Amrize Price & Volume Analysis — Apps Script backend (single-source rewrite)
 * ---------------------------------------------------------------------------
 * Reads ONE raw sheet ("Combined Data CPI Raw") plus two lookup tabs, then
 * reproduces in JS everything the four old pivoted sheets did:
 *   - VLOOKUP region/market/submarket/country + currency + revenue type
 *   - PY/CY split (PY = earlier year, CY = later year)
 *   - per-pivot-row ASP %, revenue coverage, PPI factors
 *   - fuel-surcharge + applied-volume columns (customer view)
 * MTD = latest month present in CY data;  YTD = all months collapsed.
 *
 * VERIFY (numbers depend on these):
 *  1. PY = lower of the two "#### Volume" years, CY = higher.
 *  2. REGION LOOKUP (key = Plant, range A:L): col10 REGION, col4 SUBREGION,
 *     col11 MARKET, col12 SUBMARKET1, col3 SUBMARKET2, col9 MB SUBMARKET;
 *     and Q:R maps REGION -> COUNTRY.
 *  3. TOPLINE REV LOOKUP2 (key = Plant&Material&Submarket2&Submarket1): col10 = REVENUE TYPE.
 *  4. Pivot ASP is revenue-weighted (Sum Rev / Sum Vol).
 *  5. Pivot granularity: markets = Month+PlantType+MaterialFamily+ProductClass+Plant+Material;
 *     customers = that + CustSegment+ProductApplication+CustomerParent+SoldTo.
 */

var CONFIG = {
  // Sheet/tab names + the data-source sheet now live centrally in Config.gs.
  // `RAW` is a getter so it always reflects APP_CONFIG, evaluated at call time.
  get RAW(){ return APP_CONFIG.PAGES.pricevolume.SHEETS; },

  ACTIVE_PERIODS: ['MTD', 'YTD'],
  DEFAULT_REVENUE_TYPE: 'TOP LINE REVENUE',

  DIMENSIONS: [
    { key: 'REGION',       label: 'Region',          header: 'REGION' },
    { key: 'MARKET',       label: 'Market',          header: 'MARKET' },
    { key: 'SUBMARKET1',   label: 'Submarket',       header: 'SUBMARKET1' },
    { key: 'PLANT_TYPE',   label: 'Plant Type',      header: 'Plant Type' },
    { key: 'MATERIAL_FAM', label: 'Material Family', header: 'Material Family' },
    { key: 'PROD_CLASS',   label: 'Product Class',   header: 'Product Class [Rock]' },
    { key: 'PLANT',        label: 'Plant',           header: 'Plant' },
    { key: 'MATERIAL',     label: 'Material',        header: 'Material' },
    /* Customer Segment lives only in the CUSTOMER pivot. The market pivot's
       grain is plant × material (Qlik's aggr(%plant,%material)) and its
       precomputed factor columns are only exact at that grain — adding a
       column to it would shift every PPI on the page and on the Overview.
       custPivot:true tells getReport to build this ONE table off the customer
       pivot with the grain-stable custPpi_ method, and leave the rest alone. */
    { key: 'CUST_SEGMENT', label: 'Customer Segment', header: 'Cust Segment [Rock]', custPivot: true }    
  ],

  COLS: {
    PY_VOL: 'PY Volume', CY_VOL: 'CY Volume', PY_REV: 'PY REV', CY_REV: 'CY REV',
    CY_REV_PPI: 'CY REV (FOR PPI)', FACTOR_CY: 'FACTOR (CY REV %)', REVENUE_TYPE: 'REVENUE TYPE'
  }
};

/* ===================== web entry ===================== */
/* doGet + getLogo are now handled centrally in Code.gs */

/* ===================== generic helpers ===================== */
function norm_(s) { return String(s == null ? '' : s).toLowerCase().replace(/[\s_\.\[\]\(\)%#\/-]+/g, ' ').trim(); }
var lk_ = function (s) { return String(s == null ? '' : s).trim().toLowerCase(); };

function toNum_(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  var s = String(v).trim(), pct = /%/.test(s);
  s = s.replace(/[$,%\s]/g, '');
  if (s === '' || s === '-') return 0;
  var n = parseFloat(s);
  if (isNaN(n)) return 0;
  return pct ? n / 100 : n;
}

function colIndex_(header, name) { var n = norm_(name); return (n in header) ? header[n] : -1; }

function getSS_() {
  // CONSOLIDATED SUITE: always read from the sheet chosen in Settings (Code.gs).
  return APP_openSpreadsheet_('pricevolume');
}
function getSheetCI_(ss, name) {
  var sh = ss.getSheetByName(name); if (sh) return sh;
  var want = String(name).toLowerCase().trim(), all = ss.getSheets();
  for (var i = 0; i < all.length; i++) if (all[i].getName().toLowerCase().trim() === want) return all[i];
  return null;
}

/* =============== data version (generation) + chunked cache ===============
 * pv_cache_gen lives in Script Properties and only changes when someone
 * presses "Update from source" (clearCache below). Every cache key is
 * prefixed with it, so bumping it instantly strands every old entry for
 * every user — nothing needs to be enumerated or deleted.               */
var _GEN = null;
function generation_() {
  if (_GEN != null) return _GEN;
  try {
    var p = PropertiesService.getScriptProperties(), g = p.getProperty('pv_cache_gen');
    if (!g) { g = '1'; p.setProperty('pv_cache_gen', g); }
    _GEN = g;
  } catch (e) { _GEN = '1'; }
  return _GEN;
}
function bumpGeneration_() {
  try {
    var p = PropertiesService.getScriptProperties();
    var g = String(parseInt(p.getProperty('pv_cache_gen') || '1', 10) + 1);
    p.setProperty('pv_cache_gen', g);
    _GEN = g;
    return g;
  } catch (e) { _GEN = null; return generation_(); }
}
var SCHEMA_ = 'v5';   // bump when a COMPUTED pivot column changes meaning, or when a CACHED SHAPE does (v5: readTab_ locates the header row, so rows start lower; pivots carry a month)
function gk_(key) { return 'pv|g' + generation_() + '|' + SCHEMA_ + '|' + key; }

/* chunked CacheService cache (best-effort, 6 h — the CacheService maximum) */
function cacheGet_(key) {
  try {
    var c = CacheService.getScriptCache(), meta = c.get(key + ':meta'); if (!meta) return null;
    var info = JSON.parse(meta), ks = []; for (var i = 0; i < info.n; i++) ks.push(key + ':' + i);
    var m = c.getAll(ks), s = ''; for (var j = 0; j < info.n; j++) { var p = m[key + ':' + j]; if (p == null) return null; s += p; }
    return s.length === info.len ? JSON.parse(s) : null;
  } catch (e) { return null; }
}

/* chunked cache put (6h TTL, ~23MB ceiling) — the one writer for everything:
   raw tabs, pivots, reports and the cross-filter dataset all go through it. */
function cachePutBig_(key, obj) {
  try {
    var j = JSON.stringify(obj), sz = 95000;
    if (j.length > 250 * sz) return false;
    var c = CacheService.getScriptCache(), idx = 0, m = {};
    for (var i = 0; i < j.length; i += sz) { m[key + ':' + idx] = j.slice(i, i + sz); idx++; }
    m[key + ':meta'] = JSON.stringify({ n: idx, len: j.length });
    c.putAll(m, 21600);
    return true;
  } catch (e) { return false; }
}
function upKeyPV_(t) { return 'up:' + t; }
function upTab_(token) {
  var t = cacheGet_(upKeyPV_(token));
  if (!t) throw new Error('Your uploaded data has expired (sessions last up to 6 hours). '
    + 'Please upload the two Excel files again, or press "Back to sheet data".');
  return t;
}

/* THE HEADER ROW IS NOT ALWAYS ROW 1.
   Both CPI tabs now carry a totals band, and the two tabs put it on opposite
   sides of their header: "Combined Data CPI Raw" sums ABOVE the header (row 1
   header, row 2 = the names, row 3 = data) while "Combined Data CPI Other
   Revenue" sums BELOW it. Reading row 1 blindly took the totals band as the
   header on the Raw tab, every colIndex_ came back -1, and the page then read
   blanks for month, plant and volume alike.

   So: score the first few rows against the names this tab is supposed to
   carry and take the best. A caller that names nothing keeps the old
   behaviour (row 1), which is what the two LOOKUP tabs want - they are read by
   column POSITION, not by name. */
function tabHeaderRow_(values, expect) {
  if (!expect || !expect.length) return 0;
  var want = {};
  expect.forEach(function (n) { want[norm_(n)] = 1; });
  var best = 0, bestScore = -1, limit = Math.min(values.length, 8);
  for (var r = 0; r < limit; r++) {
    var row = values[r] || [], score = 0;
    for (var c = 0; c < row.length; c++) if (want[norm_(row[c])]) score++;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

/* read a tab: header row located as above, rows = everything under it (cached) */
function readTab_(sheetName, expect) {
  var ck = gk_('tab:' + sheetName), hit = cacheGet_(ck); if (hit) return hit;
  var sh = getSheetCI_(getSS_(), sheetName);
  if (!sh) throw new Error('Sheet not found: "' + sheetName + '". Check CONFIG.RAW names.');
  var values = sh.getDataRange().getValues(), header = {};
  var hr = tabHeaderRow_(values, expect);
  (values[hr] || []).forEach(function (h, i) { var n = norm_(h); if (n && !(n in header)) header[n] = i; });
  var out = { header: header, rows: values.slice(hr + 1), headerRow: hr + 1 };
  cachePutBig_(ck, out);   // chunked: the raw tab is far over the old single-put cap, which silently skipped
  return out;
}

/* The names the Raw tab must carry. Enough of them that a totals band, a
   banner or a stray note can never out-score the real header. */
var RAW_HEADER_NAMES_ = ['LOOKUP KEY', 'Sold To', 'Plant', 'Plant Type', 'Material Family',
  'Customer Parent', 'Product Class [Rock]', 'Product Application', 'Material',
  'Cust Segment [Rock]', 'Year', 'Month', 'CY Rev exWorks', 'PY Rev exWorks',
  'PY Fuel Surcharge', 'CY Fuel Surcharge'];



/* ===================== raw -> enriched -> pivot ===================== */
function buildLookups_() {
  var rl = readTab_(CONFIG.RAW.REGION_LOOKUP), plantMap = {}, regionCountry = {};
  rl.rows.forEach(function (r) {
    var plant = lk_(r[0]);
    if (plant && !(plant in plantMap))
      plantMap[plant] = { region: r[9], subregion: r[3], market: r[10], sm1: r[11], sm2: r[2], mb: r[8] };
    var reg = lk_(r[16]); if (reg && !(reg in regionCountry)) regionCountry[reg] = r[17];   // Q -> R
  });
  var tl = readTab_(CONFIG.RAW.TOPLINE_LOOKUP), topline = {};
  tl.rows.forEach(function (r) { var k = lk_(r[0]); if (k && !(k in topline)) topline[k] = r[9]; }); // A -> J
  return { plantMap: plantMap, regionCountry: regionCountry, topline: topline };
}

function getRawEnriched_(upToken) {
  var raw = upToken ? upTab_(upToken) : readTab_(CONFIG.RAW.SHEET, RAW_HEADER_NAMES_), H = raw.header;
  var vc = []; for (var n in H) { var m = n.match(/^(\d{4}) volume$/); if (m) vc.push({ y: +m[1], i: H[n] }); }
  vc.sort(function (a, b) { return a.y - b.y; });
  var ix = {
    month: colIndex_(H, 'Month'), plantType: colIndex_(H, 'Plant Type'), materialFam: colIndex_(H, 'Material Family'),
    prodClass: colIndex_(H, 'Product Class [Rock]'), custSeg: colIndex_(H, 'Cust Segment [Rock]'),
    prodApp: colIndex_(H, 'Product Application'), plant: colIndex_(H, 'Plant'), material: colIndex_(H, 'Material'),
    custParent: colIndex_(H, 'Customer Parent'), soldTo: colIndex_(H, 'Sold To'),
    pyVol: vc.length ? vc[0].i : colIndex_(H, 'PY Volume'),
    cyVol: vc.length > 1 ? vc[vc.length - 1].i : colIndex_(H, 'CY Volume'),
    pyRev: colIndex_(H, 'PY Rev exWorks'), cyRev: colIndex_(H, 'CY Rev exWorks'),
    pyFsc: colIndex_(H, 'PY Fuel Surcharge'), cyFsc: colIndex_(H, 'CY Fuel Surcharge'),
    lkey: colIndex_(H, 'LOOKUP KEY')
  };
  var L = buildLookups_();
  var enriched = raw.rows.map(function (r) {
    var rawPlant = r[ix.plant], rawMaterial = r[ix.material];
    var plant = String(rawPlant == null ? '' : rawPlant).trim();
    var info = L.plantMap[lk_(plant)] || {};
    var region = info.region || '', sm1 = info.sm1 || '', sm2 = info.sm2 || '';
    var country = L.regionCountry[lk_(region)] || '';
    var key = String(rawPlant == null ? '' : rawPlant) + String(rawMaterial == null ? '' : rawMaterial)
            + String(sm2 == null ? '' : sm2) + String(sm1 == null ? '' : sm1);   // Plant&Material&SM2&SM1
    return {
      month: String(r[ix.month] || '').trim(),
      monthNo: pvMonthNum_(r[ix.month]),
      plantType: r[ix.plantType], materialFam: r[ix.materialFam], prodClass: r[ix.prodClass],
      custSeg: r[ix.custSeg], prodApp: r[ix.prodApp], plant: plant, material: String(rawMaterial == null ? '' : rawMaterial).trim(),
      custParent: r[ix.custParent], soldTo: r[ix.soldTo],
      region: region, subregion: info.subregion || '', market: info.market || '', country: country,
      currency: (String(country).toUpperCase() === 'CAN') ? 'CAD' : 'USD',
      sm1: sm1, sm2: sm2, mb: info.mb || '',
      revType: L.topline[lk_(key)] || 'TOP LINE REVENUE',
      pyVol: toNum_(r[ix.pyVol]), cyVol: toNum_(r[ix.cyVol]),
      pyRev: toNum_(r[ix.pyRev]), cyRev: toNum_(r[ix.cyRev]),
      pyFsc: toNum_(r[ix.pyFsc]), cyFsc: toNum_(r[ix.cyFsc]),
      lkey: ix.lkey === -1 ? '' : String(r[ix.lkey] == null ? '' : r[ix.lkey])
    };
  });

  /* Re-spread each LOOKUP KEY's surcharge across that key's rows in proportion to
     volume. Where the sheet sourced the charge from Other Revenue this is already
     true and the pass is a no-op. Where it fell back to the raw "Fuel Surchage"
     column it is NOT: that column parks the whole key's charge on whichever single
     row happened to hold it, so only that row's tonnes ever lit up as applied.
     Manitoba's surcharge is entirely in that bucket ($378,900), which is why its
     applied tonnes came in 27% under the Fuel Surcharge page (111,821 vs 152,912).
     Dollars are unchanged - only their distribution inside a key, and therefore
     which tonnes count as applied. */
  if (ix.lkey !== -1) {
    var kb = {};
    enriched.forEach(function (r) {
      if (!r.lkey) return;
      var b = kb[r.lkey] || (kb[r.lkey] = { pf: 0, cf: 0, pv: 0, cv: 0 });
      b.pf += r.pyFsc; b.cf += r.cyFsc; b.pv += r.pyVol; b.cv += r.cyVol;
    });
    enriched.forEach(function (r) {
      var b = r.lkey ? kb[r.lkey] : null; if (!b) return;
      r.pyFsc = b.pv ? b.pf * r.pyVol / b.pv : 0;
      r.cyFsc = b.cv ? b.cf * r.cyVol / b.cv : 0;
    });
  }

  /* The raw tab keeps the bill YEAR in a column of its own - the Month column is
     bare ("Jul"), so monthKey_ can never say which year a row belongs to. The CY
     year is whatever the higher "#### Volume" header says, which is already how
     CY volume itself is chosen. The Fuel Recovery page keys its cells by year, so
     it needs this handed over. */
  enriched.cyYear = vc.length > 1 ? vc[vc.length - 1].y : (vc.length ? vc[0].y : 0);

  /* Worked out once, off the full unfiltered set, so every period and every
     month choice on this request agrees about which months exist and which one
     the page lands on by default. */
  enriched.months      = pvMonthsOf_(enriched);
  enriched.reportMonth = pvReportMonth_(enriched);

  enriched.saskNote = applySask_(enriched);
  return enriched;
}

/* ---- Saskatchewan: a mid-year price increase stands in for the surcharge ----
   Saskatchewan doesn't run a fuel surcharge. Each customer got so many dollars
   per tonne from its own start date instead (SASKRATES reads that sheet), and
   that is what the recovery columns should show for this market.

   Applied HERE, per raw row, BEFORE anything groups or aggregates, so the
   customer table's recovery $, its APPLIED TONNES (buildPivot_ already decides
   those per month, which is exactly what a mid-year start needs) and every
   $/t that follows are all consistent with no further changes anywhere.

     CY recovery = rate x CY tonnes, but only for bill months on or after that
                   customer's start date
     PY recovery = 0 - the increase started this year, there is nothing to
                   compare it against

   A Saskatchewan customer that isn't in the rates sheet gets 0 and is reported
   in the returned note, which the pages show. Every other market is untouched,
   and with no rates sheet configured this is a no-op. */
function applySask_(rows) {
  var M = SASKRATES.matcher();
  if (!M.ok) return M.note();
  var want = String(M.market == null ? '' : M.market).trim().toLowerCase();
  rows.forEach(function (r) {
    if (String(r.market == null ? '' : r.market).trim().toLowerCase() !== want) return;
    var e = M.find(r.soldTo);
    r.pyFsc = 0;
    r.cyFsc = (e && SASKRATES.inEffect(monthKey_(r.month), e)) ? e.rate * r.cyVol : 0;
  });
  return M.note();
}

/* ---- Saskatchewan month by month, for the Fuel Recovery page ----
   That page reads a tab aggregated to Market/Year/Month with no customer
   column, so a per-customer rate can't be applied to it. It calls this
   instead: the same per-row numbers as the customer tab, summed by bill
   month. Tonnes and revenue come along so that page has something honest to
   show if Saskatchewan isn't in its own source at all.

   The cache key carries a fingerprint of the RATES SHEET, so editing a rate or
   a start date is picked up on the next page load. Only a change to the CPI
   data itself still needs "Update from source", same as everything else. */
function saskMonthly_() {
  var ck = gk_('sask:monthly:' + SASKRATES.version());
  var hit = cacheGet_(ck); if (hit) return hit;

  var rows = getRawEnriched_(null), note = rows.saskNote || null;
  var res;
  if (!note || !note.ok) {
    res = { ok: false, note: note };
  } else {
    var want = String(note.market == null ? '' : note.market).trim().toLowerCase();
    var byMonth = {}, year = 0;
    rows.forEach(function (r) {
      if (String(r.market == null ? '' : r.market).trim().toLowerCase() !== want) return;
      var mk = monthKey_(r.month); if (!mk) return;
      var y  = mk > 12 ? Math.floor((mk - 1) / 12) : 0;
      var mo = mk > 12 ? (mk - y * 12) : mk;
      if (y > year) year = y;
      var b = byMonth[mo] || (byMonth[mo] = { recovery: 0, appliedVol: 0, vol: 0, rev: 0 });
      b.vol += r.cyVol; b.rev += r.cyRev;
      if (r.cyFsc) { b.recovery += r.cyFsc; b.appliedVol += r.cyVol; }
    });
    /* A bare Month column leaves year at 0. Fall back to the CY year off the
       "#### Volume" headers - without it the Fuel Recovery page looks its cells
       up under year 0, finds none, and Saskatchewan reads $0 there while the
       customer tab (which never needs the year) reads correctly. */
    if (!year) year = rows.cyYear || new Date().getFullYear();
    res = { ok: true, market: note.market, year: year, byMonth: byMonth, note: note };
  }
  cachePutBig_(ck, res);   // cachePut_ never existed here — cachePutBig_ is the only writer
  return res;
}

var PIVOT_COLS_MARKET = ['REGION', 'SUBREGION', 'MARKET', 'COUNTRY', 'SUBMARKET1', 'SUBMARKET2', 'MB SUBMARKET',
  'REVENUE TYPE', 'Month', 'Plant Type', 'Material Family', 'Product Class [Rock]', 'Plant', 'Material',
  'PY Volume', 'CY Volume', 'PY ASP ex-Works', 'CY ASP ex-Works', 'PY REV', 'CY REV',
  'ASP %', 'PY REV (FOR PPI)', 'FACTOR (PY REV%)', 'CY REV (FOR PPI)', 'FACTOR (CY REV %)'];

var PIVOT_COLS_CUST = ['REGION', 'SUBREGION', 'MARKET', 'COUNTRY', 'SUBMARKET1', 'SUBMARKET2', 'MB SUBMARKET',
  'REVENUE TYPE', 'Month', 'Plant Type', 'Material Family', 'Product Class [Rock]', 'Cust Segment [Rock]',
  'Product Application', 'Plant', 'Material', 'Customer Parent', 'Sold To',
  'PY Volume', 'CY Volume', 'PY ASP ex-Works', 'CY ASP ex-Works', 'PY REV', 'CY REV',
  'PY Fuel Surcharge', 'CY Fuel Surcharge', 'FSC PY Volume', 'FSC CY Volume',
  'ASP %', 'PY REV (FOR PPI)', 'FACTOR (PY REV%)', 'CY REV (FOR PPI)', 'FACTOR (CY REV %)'];

/* ==========================================================================
 * THE MONTH MODEL
 * --------------------------------------------------------------------------
 * The QlikView export carries the WHOLE prior year - 2025 runs Jan to Dec -
 * while the current year stops at the last billed month. With no month filter
 * a YTD report therefore put seven months of 2026 against twelve months of
 * 2025 and read about -45% on volume for no reason other than the calendar.
 *
 * The AGG tabs have no Bill Month: the month is a bare name ("Jul") in one
 * column and the YEAR sits in another, one year per row. So the month here is
 * simply 1-12, and which YEAR a row belongs to is already settled by which of
 * the "#### Volume" columns carries its figure.
 *
 *   MTD  =>  that month on its own
 *   YTD  =>  January through that month
 *
 * Same rule as the Ready-Mix page, so the two never disagree about what a
 * period means.
 * ======================================================================== */

var PV_MONTH_NAMES_ = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];

/* "Jul", "Jul-25", 7, a real date -> 7. Anything unreadable -> 0. */
function pvMonthNum_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return v.getMonth() + 1;
  if (typeof v === 'number' && v >= 1 && v <= 12) return Math.round(v);
  var s = String(v == null ? '' : v).trim().toLowerCase(); if (!s) return 0;
  var names = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
  var k = s.slice(0, 3);
  if (names[k]) return names[k];
  var mm = s.match(/^(1[0-2]|0?[1-9])$/);
  return mm ? parseInt(mm[1], 10) : 0;
}

/* Which months the sheet holds, and which of those carry CURRENT-YEAR figures.
   The picker is built from the CY list only: the months past the reporting
   point hold last year's tonnes against nothing at all, so offering one would
   read as -100%. */
function pvMonthsOf_(rows) {
  var any = {}, cy = {};
  for (var i = 0; i < rows.length; i++) {
    var m = rows[i].monthNo; if (!m) continue;
    if (rows[i].cyVol || rows[i].pyVol || rows[i].cyRev || rows[i].pyRev) any[m] = 1;
    if (rows[i].cyVol || rows[i].cyRev) cy[m] = 1;
  }
  function list(o) { return Object.keys(o).map(Number).sort(function (a, b) { return a - b; }); }
  return { all: list(any), cy: list(cy) };
}

/* The month a report lands on when nobody names one: LAST CALENDAR MONTH,
   because the running month is only part-billed and reads as a collapse.
   If that month is not in the export yet, the newest month that is. */
function pvReportMonth_(rows) {
  var prev = (new Date()).getMonth();              // 0-based month = last month, 1-12
  if (!prev) prev = 12;                            // in January, last month is December
  var latestCy = 0, hasPrev = false;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!(r.cyVol || r.cyRev)) continue;           // current-year figures only
    if (r.monthNo === prev) hasPrev = true;
    if (r.monthNo > latestCy) latestCy = r.monthNo;
  }
  if (hasPrev) return prev;
  return latestCy || prev;
}

/* sel: 1-12 pins the report to that month; 0 or absent uses the report month.
   MTD returns it positive, YTD negative - one number carries both. */
function pvMonthFor_(rows, period, sel) {
  var m = pvMonthSel_(rows, sel);
  return (period === 'MTD') ? m : -m;
}
function pvMonthSel_(rows, sel) {
  var m = Number(sel) || 0;
  if (m < 1 || m > 12) m = pvReportMonth_(rows);
  return m;
}

/* The one place a row's month is tested against the period. */
function pvInMonth_(rowMonth, month) {
  if (!month) return true;                         // no filter
  if (month > 0) return rowMonth === month;        // MTD: exactly that month
  return rowMonth > 0 && rowMonth <= -month;       // YTD: January through it
}

function monthKey_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return v.getFullYear() * 12 + v.getMonth() + 1;
  var s = String(v == null ? '' : v).trim().toLowerCase(); if (!s) return 0;
  var names = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  var year = 0, ym = s.match(/(19|20)\d{2}/); if (ym) year = parseInt(ym[0], 10);
  var mon = 0; for (var k in names) { if (s.indexOf(k) !== -1) { mon = names[k]; break; } }
  if (!mon) { var mm = s.match(/\b(1[0-2]|0?[1-9])\b/); if (mm) mon = parseInt(mm[1], 10); }
  return year && mon ? year * 12 + mon : (mon || 0);
}

/* WHICH MONTHS THE SHEET HOLDS, cheaply.
   buildPivot_ has to resolve the month BEFORE it can build its cache key, and
   calling getRawEnriched_ to find out would put a full enrich - 30k+ rows,
   plus both lookup tabs - in front of every cache HIT. The month needs three
   columns and no lookups, so read just those and cache the answer. */
function pvMonthMeta_(upToken) {
  var ck = upToken ? ('pv|up|' + upToken + ':monthmeta') : gk_('monthmeta');
  var hit = cacheGet_(ck); if (hit) return hit;

  var raw = upToken ? upTab_(upToken) : readTab_(CONFIG.RAW.SHEET, RAW_HEADER_NAMES_), H = raw.header;
  var vc = []; for (var n in H) { var m = n.match(/^(\d{4}) volume$/); if (m) vc.push({ y: +m[1], i: H[n] }); }
  vc.sort(function (a, b) { return a.y - b.y; });
  var iMo = colIndex_(H, 'Month');
  var iPy = vc.length ? vc[0].i : colIndex_(H, 'PY Volume');
  var iCy = vc.length > 1 ? vc[vc.length - 1].i : colIndex_(H, 'CY Volume');

  var lite = raw.rows.map(function (r) {
    return { monthNo: pvMonthNum_(r[iMo]),
             pyVol: toNum_(r[iPy]), cyVol: toNum_(r[iCy]), pyRev: 0, cyRev: 0 };
  });
  var out = { months: pvMonthsOf_(lite), reportMonth: pvReportMonth_(lite) };
  cachePutBig_(ck, out);
  return out;
}

/* Build a synthetic {header, rows} identical in shape to the old pivoted sheets.

   `monthSel` is the page's month picker: 1-12 pins the report to that month, 0
   or absent uses the report month worked out from the data. It is part of the
   cache key, so MTD Jun and MTD Jul are separate entries and neither can be
   served for the other.

   MTD used to take the LATEST month carrying current-year figures and YTD used
   no month filter at all. Both are wrong the moment the export carries a full
   prior year and a part-billed running month: MTD landed on a half-billed
   August, and YTD put seven months of this year against twelve of last. */
function buildPivot_(period, withCustomer, upToken, monthSel) {
  var meta  = pvMonthMeta_(upToken);
  var m1    = Number(monthSel) || 0;
  if (m1 < 1 || m1 > 12) m1 = meta.reportMonth;
  var month = (period === 'MTD') ? m1 : -m1;               // +m = MTD, -m = YTD
  var mTag  = 'm' + month;
  var pck = upToken
    ? 'pv|up|' + upToken + ':' + period + ':' + mTag + ':' + (withCustomer ? 'cust' : 'mkt')   // session uploads: no version (they die with the session)
    : gk_('pivot:' + period + ':' + mTag + ':' + (withCustomer ? 'cust' : 'mkt'));
  var phit = cacheGet_(pck); if (phit) return phit;

  var rows = getRawEnriched_(upToken);                     // only on a real miss
  var collapseMonth = (period === 'YTD');

  var groups = {}  
  rows.forEach(function (r) {
    if (!pvInMonth_(r.monthNo, month)) return;
    var kp = withCustomer
      ? [collapseMonth ? '' : r.month, r.plantType, r.materialFam, r.prodClass, r.custSeg, r.prodApp, r.plant, r.material, r.custParent, r.soldTo]
      : [collapseMonth ? '' : r.month, r.plantType, r.materialFam, r.prodClass, r.plant, r.material];
    var k = kp.join('|\u2016|'), g = groups[k];
    if (!g) g = groups[k] = { s: r, pyVol: 0, cyVol: 0, pyRev: 0, cyRev: 0, pyFsc: 0, cyFsc: 0, fm: null };
    g.pyVol += r.pyVol; g.cyVol += r.cyVol; g.pyRev += r.pyRev; g.cyRev += r.cyRev; g.pyFsc += r.pyFsc; g.cyFsc += r.cyFsc;
    /* Applied tonnes have to be decided PER MONTH, BEFORE the YTD collapse merges
       the months into one group. Deciding it afterwards marks a customer's whole
       Jan-Jul volume as "applied" when the surcharge only started in April, which
       inflated YTD applied tonnes to 5.91 Mt against the FSC page's 3.90 Mt. The
       FSC sheet flags per month too, so this is what makes the two agree. */
    if (withCustomer) {
      var fmk = collapseMonth ? String(r.month == null ? '' : r.month) : '';
      var fb = (g.fm || (g.fm = {}))[fmk] || (g.fm[fmk] = { pv: 0, cv: 0, pf: 0, cf: 0 });
      fb.pv += r.pyVol; fb.cv += r.cyVol; fb.pf += r.pyFsc; fb.cf += r.cyFsc;
    }
  });



  var cols = withCustomer ? PIVOT_COLS_CUST : PIVOT_COLS_MARKET;
  var header = {}, idx = {};
  cols.forEach(function (c, i) { idx[c] = i; var nn = norm_(c); if (!(nn in header)) header[nn] = i; });

  var out = [];
  Object.keys(groups).forEach(function (k) {
    var g = groups[k], s = g.s;
    var pyAsp = g.pyVol ? g.pyRev / g.pyVol : 0, cyAsp = g.cyVol ? g.cyRev / g.cyVol : 0;
    var aspPct = pyAsp ? (cyAsp - pyAsp) / pyAsp : 0;
    var cov = (g.pyRev > 0 && g.cyRev > 0 && pyAsp > 0 && cyAsp > 0) ? 1 : 0;

    var pyPpi = cov ? g.pyRev : 0, cyPpi = cov ? g.cyRev : 0;

    var row = new Array(cols.length); function set(name, val) { row[idx[name]] = val; }
    set('REGION', s.region); set('SUBREGION', s.subregion); set('MARKET', s.market); set('COUNTRY', s.country);
    set('SUBMARKET1', s.sm1); set('SUBMARKET2', s.sm2); set('MB SUBMARKET', s.mb);
    set('REVENUE TYPE', s.revType); set('Month', collapseMonth ? '' : s.month);
    set('Plant Type', s.plantType); set('Material Family', s.materialFam); set('Product Class [Rock]', s.prodClass);
    set('Plant', s.plant); set('Material', s.material);
    set('PY Volume', g.pyVol); set('CY Volume', g.cyVol); set('PY ASP ex-Works', pyAsp); set('CY ASP ex-Works', cyAsp);
    set('PY REV', g.pyRev); set('CY REV', g.cyRev); set('ASP %', aspPct);
    set('PY REV (FOR PPI)', pyPpi); set('FACTOR (PY REV%)', aspPct * pyPpi);
    set('CY REV (FOR PPI)', cyPpi); set('FACTOR (CY REV %)', aspPct * cyPpi);
    if (withCustomer) {
      set('Cust Segment [Rock]', s.custSeg); set('Product Application', s.prodApp);
      set('Customer Parent', s.custParent); set('Sold To', s.soldTo);
      set('PY Fuel Surcharge', g.pyFsc); set('CY Fuel Surcharge', g.cyFsc);
      /* <> 0, not > 0 (matches the sheet's FSC flag): a month that nets to a
         credit is still a month the surcharge applied to those tonnes. */
      var fpv = 0, fcv = 0, fm = g.fm || {};
      for (var fk in fm) { var fb2 = fm[fk]; if (fb2.pf !== 0) fpv += fb2.pv; if (fb2.cf !== 0) fcv += fb2.cv; }
      set('FSC PY Volume', fpv); set('FSC CY Volume', fcv);
    }
    out.push(row);
  });
  var result = { header: header, rows: out, sask: rows.saskNote || null,
                 month: Math.abs(month), months: meta.months || { all: [], cy: [] },
                 reportMonth: meta.reportMonth || 0 };
  cachePutBig_(pck, result);   // chunked: pivots are multi-MB; the old put's 900KB guard meant they were never cached
  return result;
}

/* Every report echoes back the month it actually landed on and the months the
   sheet holds, so the page's picker is built from the SERVER's answer and can
   never offer a month the data does not have - and so a page talking to an old
   backend can tell, rather than quietly showing whole-year figures. */
var PV_BUILD = 'pv-2026-08-11-month-picker';
function pvStampMonth_(report, data) {
  report.build       = PV_BUILD;
  report.month       = data.month || 0;
  report.months      = data.months || { all: [], cy: [] };
  report.latestMonth = data.reportMonth || 0;
  return report;
}

/* THE MONTH LIST, ON ITS OWN.
   The page can be answered entirely from its month cube, in which case no
   report request is ever made and the picker would have nothing to build
   itself from. It used to fall back to the cube's own block list, which is a
   different question - the cube also holds the closed-year history eras, and
   its idea of "the months available" is whatever it happens to have chunked.
   This is the sheet's answer, it is small, and it is cached. */
function getMonths(opts) {
  opts = opts || {};
  var meta = pvMonthMeta_(opts.upload || null);
  return { ok: true, build: PV_BUILD, months: meta.months || { all: [], cy: [] },
           latestMonth: meta.reportMonth || 0, generation: generation_() };
}

/* ===================== MARKETS report ===================== */
function getReport(opts) {
  opts = opts || {};
  var period = (CONFIG.ACTIVE_PERIODS.indexOf(opts.period) !== -1) ? opts.period : 'MTD';
  var dims = (opts.dimensions && opts.dimensions.length) ? opts.dimensions.slice() : ['MARKET'];
  var filterField = opts.filterField || 'MARKET';
  /* breakdown-only: filtering by Customer Segment would pull every other
    table onto the customer pivot, so it falls back to MARKET. */
  var fIn = CONFIG.DIMENSIONS.filter(function (d) { return d.key === filterField; })[0];
  if (fIn && fIn.custPivot) filterField = 'MARKET';
  var filterValue = opts.filterValue || '__ALL__';
  var refineValue = opts.refineValue || '__ALL__';
  var refineMode = (opts.refineMode === 'exclude') ? 'exclude' : 'include';
  var monthSel = Number(opts.month) || 0;
  if (monthSel < 1 || monthSel > 12) monthSel = 0;      // 0 = let the data decide

  /* whole-report cache: the finished table set for this exact selection is
     shared by every user until "Update from source" bumps the version */
  var rck = null;
  if (!opts.upload) {
    rck = gk_(['rpt:m', period, 'm' + monthSel, dims.join(','), filterField, filterValue, refineValue, refineMode].join('|'));
    var rhit = cacheGet_(rck); if (rhit) return rhit;
  }

  var data = buildPivot_(period, false, opts.upload || null, monthSel);
  var sheetName = CONFIG.RAW.SHEET + ' (' + period + ')';
  var H = data.header;

  var ix = {
    pyVol: colIndex_(H, CONFIG.COLS.PY_VOL), cyVol: colIndex_(H, CONFIG.COLS.CY_VOL),
    pyRev: colIndex_(H, CONFIG.COLS.PY_REV), cyRev: colIndex_(H, CONFIG.COLS.CY_REV),
    cyRevPpi: colIndex_(H, CONFIG.COLS.CY_REV_PPI), factorCy: colIndex_(H, CONFIG.COLS.FACTOR_CY),
    revType: colIndex_(H, CONFIG.COLS.REVENUE_TYPE)
  };

  var dimDefs  = CONFIG.DIMENSIONS.filter(function (d) { return dims.indexOf(d.key) !== -1 && !d.custPivot; });
  var custDims = CONFIG.DIMENSIONS.filter(function (d) { return dims.indexOf(d.key) !== -1 &&  d.custPivot; });
  dimDefs.forEach(function (d) { d.idx = colIndex_(H, d.header); });
  var filterDef = CONFIG.DIMENSIONS.filter(function (d) { return d.key === filterField && !d.custPivot; })[0];
  var filterIdx = filterDef ? colIndex_(H, filterDef.header) : -1;
  var refineIdx = colIndex_(H, 'MB SUBMARKET');

  var filterOptions = {}, refineOptions = {}, rows = [];
  data.rows.forEach(function (row) {
    if (ix.revType !== -1 && CONFIG.DEFAULT_REVENUE_TYPE) {
      var rt = String(row[ix.revType] || '').trim().toUpperCase();
      if (rt && rt !== CONFIG.DEFAULT_REVENUE_TYPE.toUpperCase()) return;
    }
    if (!(toNum_(row[ix.pyVol]) || toNum_(row[ix.cyVol]) || toNum_(row[ix.pyRev]) || toNum_(row[ix.cyRev]))) return;

    if (filterIdx !== -1) {
      var fv = String(row[filterIdx] || '').trim();
      if (fv) filterOptions[fv] = true;
      if (filterValue !== '__ALL__' && fv !== filterValue) return;
    }
    if (refineIdx !== -1) {
      var rv = String(row[refineIdx] || '').trim();
      if (rv) refineOptions[rv] = true;
      if (refineValue !== '__ALL__') {
        var match = (rv === refineValue);
        if (refineMode === 'include' && !match) return;
        if (refineMode === 'exclude' && match) return;
      }
    }
    rows.push(row);
  });

  var report = {
    ok: true, period: period, sheetName: sheetName,
    filterField: filterField, filterValue: filterValue, filterOptions: Object.keys(filterOptions).sort(),
    refineValue: refineValue, refineMode: refineMode, refineOptions: Object.keys(refineOptions).sort(),
    rowCount: rows.length,
    dimensionsAvailable: CONFIG.DIMENSIONS.map(function (d) { return { key: d.key, label: d.label }; }),
    tables: [], revenueBridge: revenueBridge_(rows, ix), priceBridge: null
  };
  dimDefs.forEach(function (d) { report.tables.push(buildTable_(rows, ix, d)); });
  if (custDims.length) {
    var mktTotal = metrics_(agg_(rows, ix));   // one identical Grand total across every table
    custDims.forEach(function () {
      report.tables.push(buildCustSegTable_(period, opts.upload || null,
        filterField, filterValue, refineValue, refineMode, mktTotal));
    });
  }
  report.priceBridge = priceBridge_(rows, ix, H);
  report.sask = data.sask || null;   // Saskatchewan increase: matched / unmatched customers
  report.generation = generation_();
  pvStampMonth_(report, data);
  if (rck) cachePutBig_(rck, report);
  return report;
}

function agg_(rows, ix) {
  var s = { pyVol: 0, cyVol: 0, pyRev: 0, cyRev: 0, cyRevPpi: 0, factorCy: 0 };
  rows.forEach(function (r) {
    s.pyVol += toNum_(r[ix.pyVol]); s.cyVol += toNum_(r[ix.cyVol]);
    s.pyRev += toNum_(r[ix.pyRev]); s.cyRev += toNum_(r[ix.cyRev]);
    s.cyRevPpi += toNum_(r[ix.cyRevPpi]); s.factorCy += toNum_(r[ix.factorCy]);
  });
  return s;
}
function metrics_(s) {
  var cyAsp = s.cyVol ? s.cyRev / s.cyVol : 0, pyAsp = s.pyVol ? s.pyRev / s.pyVol : 0;
  return {
    cyVol: s.cyVol, pyVol: s.pyVol, volPct: s.pyVol ? (s.cyVol - s.pyVol) / s.pyVol : 0,
    cyAsp: cyAsp, pyAsp: pyAsp, aspPct: pyAsp ? (cyAsp - pyAsp) / pyAsp : 0,
    ppi: s.cyRevPpi ? s.factorCy / s.cyRevPpi : 0
  };
}
function buildTable_(rows, ix, dimDef) {
  var groups = {};
  rows.forEach(function (r) {
    var k = (dimDef.idx !== -1) ? String(r[dimDef.idx] || '(blank)').trim() : '(n/a)'; if (!k) k = '(blank)';
    (groups[k] = groups[k] || []).push(r);
  });
  var groupRows = Object.keys(groups).map(function (k) { var m = metrics_(agg_(groups[k], ix)); m.label = k; return m; })
    .sort(function (a, b) { return b.cyVol - a.cyVol; });
  var total = metrics_(agg_(rows, ix));
  var sumPyVol = 0, volFixedNumer = 0;
  groupRows.forEach(function (g) { sumPyVol += g.pyVol; volFixedNumer += g.pyVol * g.cyAsp; });
  var volFixedAsp = sumPyVol ? volFixedNumer / sumPyVol : 0;
  var priceOnly = total.pyAsp ? (volFixedAsp - total.pyAsp) / total.pyAsp : 0;
  return { dimension: dimDef.label, key: dimDef.key, rows: groupRows, total: total, volMix: total.aspPct - priceOnly };
}
function revenueBridge_(rows, ix) {
  var t = agg_(rows, ix), pyAsp = t.pyVol ? t.pyRev / t.pyVol : 0;
  var volImpact = pyAsp * (t.cyVol - t.pyVol);
  return { pyRev: t.pyRev, volImpact: volImpact, priceImpact: (t.cyRev - t.pyRev) - volImpact, cyRev: t.cyRev };
}
function priceBridge_(rows, ix, H) {
  var total = metrics_(agg_(rows, ix)), ppi = total.ppi, aspInc = total.aspPct;
  var marketMix = dimVolMix_(rows, ix, colIndex_(H, 'MARKET'));
  var submarketMix = dimVolMix_(rows, ix, colIndex_(H, 'SUBMARKET1'));
  var regionMarketMix = (marketMix + submarketMix) / 2;
  var geologyMix = dimVolMix_(rows, ix, colIndex_(H, 'Material Family'));
  var plantMix = dimVolMix_(rows, ix, colIndex_(H, 'Plant Type'));
  var prodMix = dimVolMix_(rows, ix, colIndex_(H, 'Product Class [Rock]'));
  var customerMix = (aspInc - ppi) - (regionMarketMix + geologyMix + plantMix + prodMix);
  return {
    ppi: ppi, aspInc: aspInc,
    items: [
      { label: 'Region / Market mix', value: regionMarketMix },
      { label: 'Geology vol mix', value: geologyMix },
      { label: 'Plant type vol mix', value: plantMix },
      { label: 'Prod class vol mix', value: prodMix },
      { label: 'Customer mix', value: customerMix }
    ],
    totalAsp: aspInc
  };
}
function dimVolMix_(rows, ix, dimColIdx) {
  if (dimColIdx === -1) return 0;
  var groups = {};
  rows.forEach(function (r) { var k = String(r[dimColIdx] || '(blank)').trim() || '(blank)'; (groups[k] = groups[k] || []).push(r); });
  var total = metrics_(agg_(rows, ix)), sumPyVol = 0, volFixedNumer = 0;
  Object.keys(groups).forEach(function (k) { var m = metrics_(agg_(groups[k], ix)); sumPyVol += m.pyVol; volFixedNumer += m.pyVol * m.cyAsp; });
  var volFixedAsp = sumPyVol ? volFixedNumer / sumPyVol : 0;
  var priceOnly = total.pyAsp ? (volFixedAsp - total.pyAsp) / total.pyAsp : 0;
  return total.aspPct - priceOnly;
}
/* ---- Customer Segment table (customer pivot) ---------------------------
 * Volume / revenue / ASP are plain sums, so they tie out to the other tables
 * exactly. PPI uses custPpi_ — aggregate the row's own slice to Plant+Material
 * and coverage-gate it — the same grain-stable method getCrossReport uses.
 * Shape is identical to buildTable_, so the page renders it unchanged.     */
function segMetrics_(grpRows, ix) {
  var s = { pyVol: 0, cyVol: 0, pyRev: 0, cyRev: 0 };
  grpRows.forEach(function (r) {
    s.pyVol += toNum_(r[ix.pyVol]); s.cyVol += toNum_(r[ix.cyVol]);
    s.pyRev += toNum_(r[ix.pyRev]); s.cyRev += toNum_(r[ix.cyRev]);
  });
  var cyAsp = s.cyVol ? s.cyRev / s.cyVol : 0, pyAsp = s.pyVol ? s.pyRev / s.pyVol : 0;
  return applyPpi_({
    cyVol: s.cyVol, pyVol: s.pyVol, volPct: s.pyVol ? (s.cyVol - s.pyVol) / s.pyVol : 0,
    cyAsp: cyAsp, pyAsp: pyAsp, aspPct: pyAsp ? (cyAsp - pyAsp) / pyAsp : 0,
    cyRev: s.cyRev, pyRev: s.pyRev, ppi: 0
  }, grpRows, ix);
}

function buildCustSegTable_(period, upload, filterField, filterValue, refineValue, refineMode, mktTotal) {
  var data = buildPivot_(period, true, upload || null);
  var H = data.header;
  var ix = {
    pyVol: colIndex_(H, CONFIG.COLS.PY_VOL), cyVol: colIndex_(H, CONFIG.COLS.CY_VOL),
    pyRev: colIndex_(H, CONFIG.COLS.PY_REV), cyRev: colIndex_(H, CONFIG.COLS.CY_REV),
    revType: colIndex_(H, CONFIG.COLS.REVENUE_TYPE),
    plantCol: colIndex_(H, 'Plant'), matCol: colIndex_(H, 'Material')
  };
  var segIdx = colIndex_(H, 'Cust Segment [Rock]');
  var fDef = CONFIG.DIMENSIONS.filter(function (d) { return d.key === filterField && !d.custPivot; })[0];
  var fIdx = fDef ? colIndex_(H, fDef.header) : -1;
  var refIdx = colIndex_(H, 'MB SUBMARKET');

  var groups = {}, order = [], all = [];
  data.rows.forEach(function (row) {
    if (ix.revType !== -1 && CONFIG.DEFAULT_REVENUE_TYPE) {
      var rt = String(row[ix.revType] || '').trim().toUpperCase();
      if (rt && rt !== CONFIG.DEFAULT_REVENUE_TYPE.toUpperCase()) return;
    }
    if (!(toNum_(row[ix.pyVol]) || toNum_(row[ix.cyVol]) || toNum_(row[ix.pyRev]) || toNum_(row[ix.cyRev]))) return;
    if (fIdx !== -1 && filterValue !== '__ALL__' && String(row[fIdx] || '').trim() !== filterValue) return;
    if (refIdx !== -1 && refineValue !== '__ALL__') {
      var match = (String(row[refIdx] || '').trim() === refineValue);
      if (refineMode === 'include' && !match) return;
      if (refineMode === 'exclude' && match) return;
    }
    var k = (segIdx !== -1) ? (String(row[segIdx] || '').trim() || '(blank)') : '(n/a)';
    if (!groups[k]) { groups[k] = []; order.push(k); }
    groups[k].push(row); all.push(row);
  });

  var groupRows = order.map(function (k) { var m = segMetrics_(groups[k], ix); m.label = k; return m; })
    .sort(function (a, b) { return b.cyVol - a.cyVol; });

  var total = mktTotal || segMetrics_(all, ix);
  var sumPyVol = 0, volFixedNumer = 0;
  groupRows.forEach(function (g) { sumPyVol += g.pyVol; volFixedNumer += g.pyVol * g.cyAsp; });
  var volFixedAsp = sumPyVol ? volFixedNumer / sumPyVol : 0;
  var priceOnly = total.pyAsp ? (volFixedAsp - total.pyAsp) / total.pyAsp : 0;

  return { dimension: 'Customer Segment', key: 'CUST_SEGMENT',
           rows: groupRows, total: total, volMix: total.aspPct - priceOnly };
}
/* ===================== CUSTOMER report ===================== */
var CUST_SECONDARY = { CUST_SEGMENT: 'Cust Segment [Rock]', PRODUCT_APP: 'Product Application', SOLD_TO: 'Sold To' };

/* Qlik-parity PPI: within the given rows (already sliced to one table row's
   context — market filter + customer parent [+ segment/app/sold-to]), aggregate
   to Plant+Material; lines with both-year volume AND revenue > 0 get
   weight = CY REV and factor = weight * ASP%;  PPI = Σ factor / Σ weight. */
function custPpi_(rows, ix) {
  var g = {};
  rows.forEach(function (r) {
    var k = String(r[ix.plantCol] || '') + '|\u2016|' + String(r[ix.matCol] || '');
    var o = g[k] || (g[k] = { pyVol: 0, cyVol: 0, pyRev: 0, cyRev: 0 });
    o.pyVol += toNum_(r[ix.pyVol]); o.cyVol += toNum_(r[ix.cyVol]);
    o.pyRev += toNum_(r[ix.pyRev]); o.cyRev += toNum_(r[ix.cyRev]);
  });
  var weight = 0, factor = 0;
  Object.keys(g).forEach(function (k) {
    var o = g[k];
    if (o.pyVol > 0 && o.cyVol > 0 && o.pyRev > 0 && o.cyRev > 0) {
      var pyAsp = o.pyRev / o.pyVol, cyAsp = o.cyRev / o.cyVol;
      factor += o.cyRev * ((cyAsp - pyAsp) / pyAsp);   // PI Factor = Weight * ASP%
      weight += o.cyRev;                               // Weight = CY REV if covered
    }
  });
  return { weight: weight, factor: factor, ppi: weight ? factor / weight : 0 };
}

/* Qlik's outer guard: if the table row itself lacks positive both-year
   revenue, PPI shows 0 regardless. */
function applyPpi_(m, rows, ix) {
  var pp = custPpi_(rows, ix);
  if (!(m.cyRev > 0 && m.pyRev > 0)) pp = { weight: pp.weight, factor: pp.factor, ppi: 0 };
  m.ppi = pp.ppi; m.cyRevPpi = pp.weight; m.factorCy = pp.factor;
  return m;
}

function getCustomerReport(opts) {
  opts = opts || {};
  var secondary = (opts.secondary && CUST_SECONDARY[opts.secondary]) ? opts.secondary : 'NONE';
  var period = (opts.period === 'YTD') ? 'YTD' : 'MTD';
  var market = opts.market || '__ALL__';
  var monthSel = Number(opts.month) || 0;
  if (monthSel < 1 || monthSel > 12) monthSel = 0;

  var rck = null;
  if (!opts.upload) {
    rck = gk_(['rpt:c', period, 'm' + monthSel, secondary, market].join('|'));
    var rhit = cacheGet_(rck); if (rhit) return rhit;
  }

  var data = buildPivot_(period, true, opts.upload || null, monthSel);
  var sheetName = CONFIG.RAW.SHEET + ' (' + period + ')';
  var H = data.header;
  var ix = {
    parent: colIndex_(H, 'Customer Parent'), soldTo: colIndex_(H, 'Sold To'), market: colIndex_(H, 'MARKET'),
    revType: colIndex_(H, 'REVENUE TYPE'),
    pyVol: colIndex_(H, 'PY Volume'), cyVol: colIndex_(H, 'CY Volume'),
    pyRev: colIndex_(H, 'PY REV'), cyRev: colIndex_(H, 'CY REV'),
    cyRevPpi: colIndex_(H, 'CY REV (FOR PPI)'), factorCy: colIndex_(H, 'FACTOR (CY REV %)'),
    pyFsc: colIndex_(H, 'PY Fuel Surcharge'), cyFsc: colIndex_(H, 'CY Fuel Surcharge'),
    fscPyVol: colIndex_(H, 'FSC PY Volume'), fscCyVol: colIndex_(H, 'FSC CY Volume'),
    plantCol: colIndex_(H, 'Plant'), matCol: colIndex_(H, 'Material')
  };
  var secIdx = (secondary !== 'NONE') ? colIndex_(H, CUST_SECONDARY[secondary]) : -1;

  var groups = {}, rows = [], marketOptions = {};
  data.rows.forEach(function (row) {
    if (ix.revType !== -1 && CONFIG.DEFAULT_REVENUE_TYPE) {
      var rt = String(row[ix.revType] || '').trim().toUpperCase();
      if (rt && rt !== CONFIG.DEFAULT_REVENUE_TYPE.toUpperCase()) return;
    }
    if (!(toNum_(row[ix.pyVol]) || toNum_(row[ix.cyVol]) || toNum_(row[ix.pyRev]) || toNum_(row[ix.cyRev]))) return;
    if (ix.market !== -1) {
      var mv = String(row[ix.market] || '').trim();
      if (mv) marketOptions[mv] = true;
      if (market !== '__ALL__' && mv !== market) return;
    }
    var parent = (ix.parent !== -1 ? String(row[ix.parent] || '').trim() : '');
    if (!parent && ix.soldTo !== -1) parent = String(row[ix.soldTo] || '').trim();
    if (!parent || parent === '#N/A') parent = '(no customer)';
    (groups[parent] = groups[parent] || []).push(row);
    rows.push(row);
  });

var outRows = Object.keys(groups).map(function (p) {
    var grp = groups[p], m = applyPpi_(custMetrics_(custAgg_(grp, ix)), grp, ix); m.label = p;
    if (secIdx !== -1) {
      var sub = {};
      grp.forEach(function (r) { var k = String(r[secIdx] || '(blank)').trim() || '(blank)'; (sub[k] = sub[k] || []).push(r); });
      m.children = Object.keys(sub).map(function (k) { var cm = applyPpi_(custMetrics_(custAgg_(sub[k], ix)), sub[k], ix); cm.label = k; return cm; })
        .sort(function (a, b) { return b.cyVol - a.cyVol; });
    } else m.children = [];
    return m;
  }).sort(function (a, b) { return b.cyVol - a.cyVol; });

  var report = {
    ok: true, sheetName: sheetName, period: period, secondary: secondary, market: market,
    marketOptions: Object.keys(marketOptions).sort(),
    rowCount: rows.length, customerCount: outRows.length,
    total: applyPpi_(custMetrics_(custAgg_(rows, ix)), rows, ix), rows: outRows,
    diagnostics: {
      resolvedColumns: {
        customerParent: ix.parent !== -1, soldTo: ix.soldTo !== -1, market: ix.market !== -1,
        cyVol: ix.cyVol !== -1, pyVol: ix.pyVol !== -1, cyRev: ix.cyRev !== -1, pyRev: ix.pyRev !== -1,
        cyFsc: ix.cyFsc !== -1, pyFsc: ix.pyFsc !== -1, fscCyVol: ix.fscCyVol !== -1, fscPyVol: ix.fscPyVol !== -1,
        cyRevPpi: ix.cyRevPpi !== -1, factorCy: ix.factorCy !== -1, segment: secIdx !== -1
      }
    }
  };
  report.generation = generation_();
  pvStampMonth_(report, data);
  if (rck) cachePutBig_(rck, report);
  return report;
}

/* "Update from source": bump the data version. Every cached tab, pivot and
   finished report — for every user — is instantly unreachable; the next
   request re-reads the spreadsheet and recomputes under the new version. */
function clearCache() {
  var g = bumpGeneration_();
  try { CacheService.getScriptCache().remove('amrize_logo'); } catch (e) {}
  return { ok: true, generation: g, clearedAt: new Date().toISOString() };
}


function custAgg_(rows, ix) {
  var s = { pyVol: 0, cyVol: 0, pyRev: 0, cyRev: 0, cyRevPpi: 0, factorCy: 0, pyFsc: 0, cyFsc: 0, fscPyVol: 0, fscCyVol: 0 };
  rows.forEach(function (r) {
    s.pyVol += toNum_(r[ix.pyVol]); s.cyVol += toNum_(r[ix.cyVol]);
    s.pyRev += toNum_(r[ix.pyRev]); s.cyRev += toNum_(r[ix.cyRev]);
    s.cyRevPpi += toNum_(r[ix.cyRevPpi]); s.factorCy += toNum_(r[ix.factorCy]);
    s.pyFsc += toNum_(r[ix.pyFsc]); s.cyFsc += toNum_(r[ix.cyFsc]);
    s.fscPyVol += toNum_(r[ix.fscPyVol]); s.fscCyVol += toNum_(r[ix.fscCyVol]);
  });
  return s;
}
function custMetrics_(s) {
  var cyAsp = s.cyVol ? s.cyRev / s.cyVol : 0, pyAsp = s.pyVol ? s.pyRev / s.pyVol : 0;
  var cyPerAll = s.cyVol ? s.cyFsc / s.cyVol : 0, pyPerAll = s.pyVol ? s.pyFsc / s.pyVol : 0;
  var cyPerApplied = s.fscCyVol ? s.cyFsc / s.fscCyVol : 0, pyPerApplied = s.fscPyVol ? s.pyFsc / s.fscPyVol : 0;
  return {
    cyVol: s.cyVol, pyVol: s.pyVol, volPct: s.pyVol ? (s.cyVol - s.pyVol) / s.pyVol : 0,
    cyAsp: cyAsp, pyAsp: pyAsp, aspPct: pyAsp ? (cyAsp - pyAsp) / pyAsp : 0,
    cyFsc: s.cyFsc, pyFsc: s.pyFsc, appliedCy: s.fscCyVol, appliedPy: s.fscPyVol,
    ppi: s.cyRevPpi ? s.factorCy / s.cyRevPpi : 0,
    cyPerAll: cyPerAll, pyPerAll: pyPerAll, cyPerApplied: cyPerApplied, pyPerApplied: pyPerApplied,
    deltaAll: cyPerAll - pyPerAll, deltaApplied: cyPerApplied - pyPerApplied,
    cyRev: s.cyRev, pyRev: s.pyRev, cyRevPpi: s.cyRevPpi, factorCy: s.factorCy
  };
}

/* =================== session upload (QlikView Excel) ===================
   Replaces "Combined Data CPI Raw" for ONE browser session. Replicates the
   sheet formulas: LOOKUP KEY = Year&SoldTo&Plant&PlantType&CustParent&CustSeg&Month;
   New Fuel Surcharge = Other-Revenue total for the key, allocated across the
   key's rows by that bill-year's volume, falling back to the raw "Fuel
   Surchage" column when the key has no Other Revenue; PY/CY FSC = split by Year.
   Lookups (REGION LOOKUP, TOPLINE REV LOOKUP2) still come from the sheet. */
function uploadData(payload) {
  payload = payload || {};
  if (!payload.raw || !payload.other)
    throw new Error('Please choose both files: "Combined Data CPI Raw" and "Combined Data Other Revenue".');

  function idxOf(values) {
    var hdr = values[0] || [], H = {};
    hdr.forEach(function (h, i) { var n = norm_(h); if (n && !(n in H)) H[n] = i; });
    return { hdr: hdr, H: H, rows: values.slice(1) };
  }
  function need(t, names, label) {
    var miss = names.filter(function (n) { return colIndex_(t.H, n) === -1; });
    if (miss.length) throw new Error(label + ' upload doesn\u2019t match the expected QlikView format. Missing column(s): '
      + miss.join(', ') + '. Please re-download from QlikView without changing the columns.');
  }
  var R = idxOf(payload.raw), O = idxOf(payload.other);
  need(R, ['Year', 'Month', 'Plant Type', 'Material Family', 'Product Class [Rock]', 'Cust Segment [Rock]',
           'Product Application', 'Plant', 'Material', 'Customer Parent', 'Sold To',
           '2025 Volume', '2026 Volume', 'PY Rev exWorks', 'CY Rev exWorks', 'Fuel Surchage'], 'Combined Data CPI Raw');
  need(O, ['Year', 'Sold To', 'Plant', 'Plant Type', 'Customer Parent', 'Cust Segment [Rock]', 'Month', 'Other Revenue'],
          'Combined Data Other Revenue');

  function ci(t, n) { return colIndex_(t.H, n); }
  var rp = { yr: ci(R, 'Year'), st: ci(R, 'Sold To'), pl: ci(R, 'Plant'), pt: ci(R, 'Plant Type'),
             cp: ci(R, 'Customer Parent'), cs: ci(R, 'Cust Segment [Rock]'), mo: ci(R, 'Month'),
             v25: ci(R, '2025 Volume'), v26: ci(R, '2026 Volume'), fsc: ci(R, 'Fuel Surchage') };
  var op = { yr: ci(O, 'Year'), st: ci(O, 'Sold To'), pl: ci(O, 'Plant'), pt: ci(O, 'Plant Type'),
             cp: ci(O, 'Customer Parent'), cs: ci(O, 'Cust Segment [Rock]'), mo: ci(O, 'Month'), rev: ci(O, 'Other Revenue') };

  function s_(v) { return String(v == null ? '' : v); }
  function keyR(r) { return s_(r[rp.yr]) + s_(r[rp.st]) + s_(r[rp.pl]) + s_(r[rp.pt]) + s_(r[rp.cp]) + s_(r[rp.cs]) + s_(r[rp.mo]); }
  function keyO(r) { return s_(r[op.yr]) + s_(r[op.st]) + s_(r[op.pl]) + s_(r[op.pt]) + s_(r[op.cp]) + s_(r[op.cs]) + s_(r[op.mo]); }

  // drop the totals row under the header + blank rows (they have no Plant)
  var rows  = R.rows.filter(function (r) { return s_(r[rp.pl]).trim() !== ''; });
  var oRows = O.rows.filter(function (r) { return s_(r[op.pl]).trim() !== ''; });
  if (!rows.length) throw new Error('Combined Data CPI Raw upload has no data rows.');

  var orSum = {};   // presence of the key matters even when the sum is 0 (sheet: COUNTIF > 0)
  oRows.forEach(function (r) { var k = keyO(r); orSum[k] = (orSum[k] || 0) + toNum_(r[op.rev]); });

  function volOf(r) { var y = toNum_(r[rp.yr]); return y === 2026 ? toNum_(r[rp.v26]) : y === 2025 ? toNum_(r[rp.v25]) : 0; }
  var volSum = {}, rawSum = {};
  rows.forEach(function (r) {
    var k = keyR(r);
    volSum[k] = (volSum[k] || 0) + volOf(r);
    rawSum[k] = (rawSum[k] || 0) + toNum_(r[rp.fsc]);   // the Qlik fallback, totalled per key
  });

  var header = R.hdr.slice(); var base = header.length;
  header.push('PY Fuel Surcharge', 'CY Fuel Surcharge');
  var out = rows.map(function (r) {
    var k = keyR(r), y = toNum_(r[rp.yr]), nf;
    /* Spread by volume whichever source applies. The Qlik fallback used to be left
       sitting on the one row that carried it, so only that row's tonnes counted as
       applied - the cause of Manitoba running 27% light. */
    var d = volSum[k];
    if (k in orSum) nf = d ? orSum[k] * volOf(r) / d : 0;
    else nf = d ? rawSum[k] * volOf(r) / d : 0;
    var row = r.slice(0, base); while (row.length < base) row.push('');
    row.push(y === 2025 ? nf : 0, y === 2026 ? nf : 0);
    return row;
  });

  var Hn = {}; header.forEach(function (h, i) { var n = norm_(h); if (n && !(n in Hn)) Hn[n] = i; });
  var token = Utilities.getUuid().slice(0, 8);
  if (!cachePutBig_(upKeyPV_(token), { header: Hn, rows: out }))
    throw new Error('The uploaded files are too large to hold in the session cache. Filter the QlikView download down and try again.');
  return { ok: true, token: token, rows: out.length };
}

/* ===================== CROSS-FILTER report (Executive Overview) =====================
 * One payload that serves every Aggregates panel on the Overview page once the
 * user starts clicking values into the cross-filter. Runs on the CUSTOMER
 * pivot, which carries every dimension (incl. MB SUBMARKET + Customer Parent).
 *   filters : OR within a field, AND across fields — the field filters itself
 *             too (click Limestone Quarry and the Plant Type table collapses
 *             to Limestone Quarry; more values are added via the search).
 *   options : per field, the distinct values available if that field's OWN
 *             filter were lifted (everything else still applied) — this feeds
 *             the add-search so a second value can be picked after the panel
 *             has collapsed to the current selection.
 *   refine  : the same MB-submarket Only/Exclude layer the PV page has
 *             (e.g. Southwest only Docks / excluding Docks).
 * PPI everywhere = the customer-report method (aggregate the slice to
 * Plant+Material, coverage-gate, weight by CY REV) — grain-stable at any
 * slice depth; the pivot's precomputed factor columns are only exact at the
 * pivot's own grain, so they are not used here.                             */
var XF_FIELDS = {
  MARKET:       'MARKET',
  SUBMARKET1:   'SUBMARKET1',
  PLANT_TYPE:   'Plant Type',
  MATERIAL_FAM: 'Material Family',
  PROD_CLASS:   'Product Class [Rock]',
  PLANT:        'Plant',
  MATERIAL:     'Material',
  CUST_PARENT:  'Customer Parent'
};
var XF_ORDER = ['MARKET', 'SUBMARKET1', 'PLANT_TYPE', 'MATERIAL_FAM', 'PROD_CLASS', 'PLANT', 'MATERIAL', 'CUST_PARENT'];
var XF_TABLE_KEYS = ['MARKET', 'SUBMARKET1', 'PLANT_TYPE', 'MATERIAL_FAM', 'PROD_CLASS', 'PLANT', 'MATERIAL'];
var XF_TABLE_CAP = { PLANT: 80, MATERIAL: 80 };     // biggest tables — options carry the full label list for search
var XF_CHILD_CAP = 25;                              // segment children kept for the top N customers only

function xfMetrics_(grpRows, ix) {
  var s = { pyVol: 0, cyVol: 0, pyRev: 0, cyRev: 0, pyFsc: 0, cyFsc: 0 };
  grpRows.forEach(function (r) {
    s.pyVol += toNum_(r[ix.pyVol]); s.cyVol += toNum_(r[ix.cyVol]);
    s.pyRev += toNum_(r[ix.pyRev]); s.cyRev += toNum_(r[ix.cyRev]);
    if (ix.pyFsc !== -1) s.pyFsc += toNum_(r[ix.pyFsc]);
    if (ix.cyFsc !== -1) s.cyFsc += toNum_(r[ix.cyFsc]);
  });
  var cyAsp = s.cyVol ? s.cyRev / s.cyVol : 0, pyAsp = s.pyVol ? s.pyRev / s.pyVol : 0;
  var pp = custPpi_(grpRows, ix);
  return {
    cyVol: s.cyVol, pyVol: s.pyVol, volPct: s.pyVol ? (s.cyVol - s.pyVol) / s.pyVol : 0,
    cyAsp: cyAsp, pyAsp: pyAsp, aspPct: pyAsp ? (cyAsp - pyAsp) / pyAsp : 0,
    ppi: (s.cyRev > 0 && s.pyRev > 0) ? pp.ppi : 0,
    cyRev: s.cyRev, pyRev: s.pyRev, cyFsc: s.cyFsc, pyFsc: s.pyFsc,
    present: !!(s.cyVol || s.pyVol || s.cyRev || s.pyRev)
  };
}

/* the PV ASP% bridge with the grain-stable PPI injected: the mix items only
   use vol/rev columns (safe at any grain); customer mix is the residual. */
function xfPriceBridge_(rows, ix, H, ppi) {
  var total = metrics_(agg_(rows, ix)), aspInc = total.aspPct;
  var marketMix = dimVolMix_(rows, ix, colIndex_(H, 'MARKET'));
  var submarketMix = dimVolMix_(rows, ix, colIndex_(H, 'SUBMARKET1'));
  var regionMarketMix = (marketMix + submarketMix) / 2;
  var geologyMix = dimVolMix_(rows, ix, colIndex_(H, 'Material Family'));
  var plantMix = dimVolMix_(rows, ix, colIndex_(H, 'Plant Type'));
  var prodMix = dimVolMix_(rows, ix, colIndex_(H, 'Product Class [Rock]'));
  var customerMix = (aspInc - ppi) - (regionMarketMix + geologyMix + plantMix + prodMix);
  return {
    ppi: ppi, aspInc: aspInc,
    items: [
      { label: 'Region / Market mix', value: regionMarketMix },
      { label: 'Geology vol mix', value: geologyMix },
      { label: 'Plant type vol mix', value: plantMix },
      { label: 'Prod class vol mix', value: prodMix },
      { label: 'Customer mix', value: customerMix }
    ],
    totalAsp: aspInc
  };
}

function getCrossReport(opts) {
  opts = opts || {};
  var period = (opts.period === 'YTD') ? 'YTD' : 'MTD';

  /* normalise filters + build a stable signature (sorted, so equivalent
     selections share one cache entry) */
  var filters = {}, sigParts = [];
  XF_ORDER.forEach(function (f) {
    var v = (opts.filters && opts.filters[f]) || [];
    filters[f] = (Array.isArray(v) ? v : [v]).map(function (x) { return String(x == null ? '' : x).trim(); }).filter(Boolean);
    if (filters[f].length) sigParts.push(f + '=' + filters[f].slice().sort().join('\u2016'));
  });
  var refine = opts.refine || {};
  var refVals = (Array.isArray(refine.values) ? refine.values : []).map(function (x) { return String(x == null ? '' : x).trim(); }).filter(Boolean);
  var refMode = (refine.mode === 'exclude') ? 'exclude' : 'include';
  if (refVals.length) sigParts.push('REF:' + refMode + '=' + refVals.slice().sort().join('\u2016'));

  var monthSel = Number(opts.month) || 0;
  if (monthSel < 1 || monthSel > 12) monthSel = 0;

  var rck = gk_('rpt:x|' + period + '|m' + monthSel + '|' + (sigParts.join('&') || 'none'));
  var hit = cacheGet_(rck); if (hit) return hit;

  var data = buildPivot_(period, true, null, monthSel);
  var H = data.header;
  var ix = {
    pyVol: colIndex_(H, 'PY Volume'), cyVol: colIndex_(H, 'CY Volume'),
    pyRev: colIndex_(H, 'PY REV'), cyRev: colIndex_(H, 'CY REV'),
    cyRevPpi: colIndex_(H, 'CY REV (FOR PPI)'), factorCy: colIndex_(H, 'FACTOR (CY REV %)'),
    pyFsc: colIndex_(H, 'PY Fuel Surcharge'), cyFsc: colIndex_(H, 'CY Fuel Surcharge'),
    revType: colIndex_(H, 'REVENUE TYPE'),
    plantCol: colIndex_(H, 'Plant'), matCol: colIndex_(H, 'Material'),
    soldTo: colIndex_(H, 'Sold To'), custSeg: colIndex_(H, 'Cust Segment [Rock]')
  };
  var fIdx = {}; XF_ORDER.forEach(function (f) { fIdx[f] = colIndex_(H, XF_FIELDS[f]); });
  var mbIdx = colIndex_(H, 'MB SUBMARKET');

  var fSet = {};
  XF_ORDER.forEach(function (f) {
    var s = null;
    if (filters[f].length) { s = {}; filters[f].forEach(function (v) { s[v] = true; }); }
    fSet[f] = s;
  });
  var refSet = null;
  if (refVals.length) { refSet = {}; refVals.forEach(function (v) { refSet[v] = true; }); }

  /* one pass: per row, resolve each field's value + whether it passes that
     field's filter. nFail/fail let "all filters except field F" be answered
     without a second pass: nFail===0, or nFail===1 && fail===F. */
  var recs = [], refineOptions = {};
  data.rows.forEach(function (row) {
    if (ix.revType !== -1 && CONFIG.DEFAULT_REVENUE_TYPE) {
      var rt = String(row[ix.revType] || '').trim().toUpperCase();
      if (rt && rt !== CONFIG.DEFAULT_REVENUE_TYPE.toUpperCase()) return;
    }
    if (!(toNum_(row[ix.pyVol]) || toNum_(row[ix.cyVol]) || toNum_(row[ix.pyRev]) || toNum_(row[ix.cyRev]))) return;
    var rec = { row: row, v: {}, nFail: 0, fail: '' };
    XF_ORDER.forEach(function (f) {
      var val = (fIdx[f] !== -1) ? String(row[fIdx[f]] || '').trim() : '';
      if (f === 'CUST_PARENT' && (!val || val === '#N/A')) {
        val = (ix.soldTo !== -1) ? String(row[ix.soldTo] || '').trim() : '';
        if (!val || val === '#N/A') val = '(no customer)';
      }
      rec.v[f] = val;
      if (fSet[f] && !fSet[f][val]) { rec.nFail++; rec.fail = f; }
    });
    var mv = (mbIdx !== -1) ? String(row[mbIdx] || '').trim() : '';
    rec.refOk = !refSet || (refMode === 'include' ? !!refSet[mv] : !refSet[mv]);
    if (mv && rec.nFail === 0) refineOptions[mv] = true;   // refine options ignore the refine itself
    recs.push(rec);
  });

  var full = [];
  recs.forEach(function (rc) { if (rc.nFail === 0 && rc.refOk) full.push(rc.row); });
  var totals = xfMetrics_(full, ix);

  /* per-field OPTIONS for the add-search: every filter applied except the
     field's own (refine always applied) — labels only, kept small */
  var options = {};
  XF_ORDER.forEach(function (f) {
    var opt = {};
    recs.forEach(function (rc) {
      if (!rc.refOk) return;
      if (rc.nFail === 0 || (rc.nFail === 1 && rc.fail === f)) { var v = rc.v[f]; if (v) opt[v] = true; }
    });
    options[f] = Object.keys(opt).sort();
  });

  /* dimension tables — fully filtered (own field included) */
  var tables = [];
  XF_TABLE_KEYS.forEach(function (f) {
    var groups = {}, order = [];
    recs.forEach(function (rc) {
      if (rc.nFail !== 0 || !rc.refOk) return;
      var k = rc.v[f] || '(blank)';
      var g = groups[k]; if (!g) { g = groups[k] = []; order.push(k); }
      g.push(rc.row);
    });
    var rows = order.map(function (k) { var m = xfMetrics_(groups[k], ix); m.label = k; return m; })
      .sort(function (a, b) { return b.cyVol - a.cyVol; });
    var trimmed = 0, cap = XF_TABLE_CAP[f];
    if (cap && rows.length > cap) { trimmed = rows.length - cap; rows = rows.slice(0, cap); }
    tables.push({ key: f, rows: rows, trimmed: trimmed });
  });

  /* customers — fully filtered, ranked, with Cust Segment children for the
     top XF_CHILD_CAP (the split view only expands the top of the table) */
  var cg = {}, cOrder = [];
  recs.forEach(function (rc) {
    if (rc.nFail !== 0 || !rc.refOk) return;
    var p = rc.v.CUST_PARENT || '(no customer)';
    var g = cg[p]; if (!g) { g = cg[p] = { rows: [], seg: {}, segOrder: [] }; cOrder.push(p); }
    g.rows.push(rc.row);
    var sk = (ix.custSeg !== -1) ? (String(rc.row[ix.custSeg] || '(blank)').trim() || '(blank)') : '(blank)';
    var sg = g.seg[sk]; if (!sg) { sg = g.seg[sk] = []; g.segOrder.push(sk); }
    sg.push(rc.row);
  });
  var custRows = cOrder.map(function (p) {
    var g = cg[p], m = xfMetrics_(g.rows, ix); m.label = p; m._g = g; return m;
  }).sort(function (a, b) { return b.cyVol - a.cyVol; });
  custRows.forEach(function (m, i) {
    var g = m._g; delete m._g;
    m.children = (i < XF_CHILD_CAP)
      ? g.segOrder.map(function (sk) { var cm = xfMetrics_(g.seg[sk], ix); cm.label = sk; return cm; })
          .sort(function (a, b) { return b.cyVol - a.cyVol; })
      : [];
  });

  var pyAsp = totals.pyAsp, volImpact = pyAsp * (totals.cyVol - totals.pyVol);
  var report = {
    ok: true, period: period,
    filters: filters, refine: { values: refVals, mode: refMode },
    totals: totals, tables: tables, options: options,
    refineOptions: Object.keys(refineOptions).sort(),
    customers: { rows: custRows, total: totals, customerCount: custRows.length },
    revenueBridge: { pyRev: totals.pyRev, volImpact: volImpact,
                     priceImpact: (totals.cyRev - totals.pyRev) - volImpact, cyRev: totals.cyRev },
    priceBridge: full.length ? xfPriceBridge_(full, ix, H, totals.ppi) : null,
    rowCount: full.length
  };
  report.generation = generation_();
  pvStampMonth_(report, data);
  cachePutBig_(rck, report);
  return report;
}

/* ===================== CROSS-FILTER dataset (client-side engine) =====================
 * One compact, dictionary-encoded columnar copy of the customer pivot's
 * filter-relevant content, shipped to the browser so filter changes compute
 * locally (no server round trip per click). Built once per generation+period
 * and chunk-cached. Row filter (revenue type + nonzero) and the Customer
 * Parent fallback are applied HERE so client numbers match getCrossReport
 * exactly. If the encoded payload exceeds XF_DATA_CAP the verdict is cached
 * and the client silently falls back to getCrossReport.                    */
var XF_DATA_CAP = 8 * 1024 * 1024;   // ~8MB JSON

function getCrossData(opts) {
  opts = opts || {};
  var period = (opts.period === 'YTD') ? 'YTD' : 'MTD';
  var ck = gk_('xfdata:' + period);
  var hit = cacheGet_(ck); if (hit) return hit;

  var data = buildPivot_(period, true, null), H = data.header;
  var ix = {
    pyVol: colIndex_(H, 'PY Volume'), cyVol: colIndex_(H, 'CY Volume'),
    pyRev: colIndex_(H, 'PY REV'), cyRev: colIndex_(H, 'CY REV'),
    pyFsc: colIndex_(H, 'PY Fuel Surcharge'), cyFsc: colIndex_(H, 'CY Fuel Surcharge'),
    revType: colIndex_(H, 'REVENUE TYPE'), soldTo: colIndex_(H, 'Sold To'),
    custSeg: colIndex_(H, 'Cust Segment [Rock]')
  };
  var fIdx = {}; XF_ORDER.forEach(function (f) { fIdx[f] = colIndex_(H, XF_FIELDS[f]); });
  var mbIdx = colIndex_(H, 'MB SUBMARKET');

  var FIELDS = XF_ORDER.concat(['MB', 'CUST_SEG']);
  var dicts = {}, maps = {}, cols = {};
  FIELDS.forEach(function (f) { dicts[f] = []; maps[f] = {}; cols[f] = []; });
  var nums = { pyVol: [], cyVol: [], pyRev: [], cyRev: [], pyFsc: [], cyFsc: [] };
  function code(f, val) {
    var m = maps[f];
    if (val in m) return m[val];
    var i = dicts[f].length; dicts[f].push(val); m[val] = i; return i;
  }
  function r2(x) { return Math.round(x * 100) / 100; }
  function r3(x) { return Math.round(x * 1000) / 1000; }

  data.rows.forEach(function (row) {
    if (ix.revType !== -1 && CONFIG.DEFAULT_REVENUE_TYPE) {
      var rt = String(row[ix.revType] || '').trim().toUpperCase();
      if (rt && rt !== CONFIG.DEFAULT_REVENUE_TYPE.toUpperCase()) return;
    }
    var pv = toNum_(row[ix.pyVol]), cv = toNum_(row[ix.cyVol]);
    var pr = toNum_(row[ix.pyRev]), cr = toNum_(row[ix.cyRev]);
    if (!(pv || cv || pr || cr)) return;
    XF_ORDER.forEach(function (f) {
      var val = (fIdx[f] !== -1) ? String(row[fIdx[f]] || '').trim() : '';
      if (f === 'CUST_PARENT' && (!val || val === '#N/A')) {
        val = (ix.soldTo !== -1) ? String(row[ix.soldTo] || '').trim() : '';
        if (!val || val === '#N/A') val = '(no customer)';
      }
      cols[f].push(code(f, val));
    });
    cols.MB.push(code('MB', (mbIdx !== -1) ? String(row[mbIdx] || '').trim() : ''));
    cols.CUST_SEG.push(code('CUST_SEG', (ix.custSeg !== -1) ? (String(row[ix.custSeg] || '').trim() || '(blank)') : '(blank)'));
    nums.pyVol.push(r3(pv)); nums.cyVol.push(r3(cv));
    nums.pyRev.push(r2(pr)); nums.cyRev.push(r2(cr));
    nums.pyFsc.push(ix.pyFsc !== -1 ? r2(toNum_(row[ix.pyFsc])) : 0);
    nums.cyFsc.push(ix.cyFsc !== -1 ? r2(toNum_(row[ix.cyFsc])) : 0);
  });

  var payload = { ok: true, period: period, n: cols.MARKET.length,
                  dicts: dicts, cols: cols, nums: nums, generation: generation_() };
  var size = 0;
  try { size = JSON.stringify(payload).length; } catch (e) { size = XF_DATA_CAP + 1; }
  if (size > XF_DATA_CAP) {
    var verdict = { ok: false, tooBig: true, size: size, generation: generation_() };
    cachePutBig_(ck, verdict);
    return verdict;
  }
  cachePutBig_(ck, payload);
  return payload;
}

  // Surface only what the front end / Code.gs need to call.
  return {
    getReport:         getReport,
    getMonths:         getMonths,
    getCustomerReport: getCustomerReport,
    getCrossReport:    getCrossReport,
    getCrossData:      getCrossData,
    clearCache:        clearCache,
    uploadData:        uploadData,
    saskMonthly:       saskMonthly_,
    /* The Overview's month cube reads these — the SAME cached rows this page
       already built, so the cube never opens the sheet itself and adds nothing
       to any page load. Read-only: the cube only ever sums them.
       The array also carries .cyYear (see getRawEnriched_). */
    rawEnriched:       getRawEnriched_,

    /* THE TAB READER ITSELF, and the names it scores the header row against.
       PV_Lookup.gs is outside this IIFE and had its own copy of "the header is
       row 1" — which is how the mapping check came to report no "Plant" column
       on a tab that plainly has one: it was reading the totals band that sits
       ABOVE the header on Combined Data CPI Raw. FSC_Backend.gs had the same
       bug and got the same fix separately. Three copies of one rule is how it
       keeps coming back, so there is one reader now and everybody calls it. */
    readTab:           readTab_,
    RAW_HEADER_NAMES:  RAW_HEADER_NAMES_
  };
})();

/* ---- top-level wrappers (google.script.run can only see plain functions) ---- */
function getReport(opts)         { return PV.getReport(opts); }
function getPvMonths(opts)       { return PV.getMonths(opts); }
function getCustomerReport(opts) { return PV.getCustomerReport(opts); }
function getCrossReport(opts)    { return PV.getCrossReport(opts); }
function getCrossData(opts)      { return PV.getCrossData(opts); }
function clearCache()            { return PV.clearCache(); }
function uploadPvData(p)         { return PV.uploadData(p); }