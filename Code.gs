/*****************************************************************************
 * AMRIZE COMMERCIAL SUITE — main entry / router
 * ---------------------------------------------------------------------------
 * This single Apps Script project hosts the web apps under one URL:
 *    ?page=pricevolume   → Price & Volume Analysis
 *    ?page=rmx           → Amrize RMX (Price & Volume)
 *    ?page=segment  → Slide Builder (Google Sheets → slide PNG)
 *    ?page=fuelsurcharge → Fuel Recovery executive view (editable slide PNG)
 *    ?page=deckbuilder   → Deck Builder (every page → one Google Slides deck)
 *    (no page / unknown) → Landing page that links to all of them.
 *
 * IMPORTANT — this project is NOT bound to a spreadsheet.
 * Each page now reads from ITS OWN Google Sheet. The defaults are set in code
 * and can be overridden per page from the Settings modal. ALL of that config
 * (per-page sheet IDs, tab names, the logo) lives in ONE place: Config.gs.
 *
 * The functions in THIS file are the page-shared plumbing:
 *   - doGet()      : the router (decides which page to show)
 *   - include()    : lets an HTML file pull in a shared partial
 *   - getLogo()    : the Amrize logo (used by every export)
 *   - syncAll()    : clear every cache after data changes
 *   - Slide Builder backend (SB)
 *
 * The Deck Builder is the one page with no data source of its own: it reads
 * the recipe (Deck_Recipe.gs), the Slides template (Deck_Backend.gs) and then
 * whatever the other pages already produce. Nothing here needs to know about
 * it beyond the route above.
 *
 * Per-page DATA-SOURCE config + the Settings API (getSettings, getAllSettings,
 * saveSpreadsheetId, clearSpreadsheetOverride, APP_openSpreadsheet_) all live
 * in Config.gs. Each app's own analytics live in PV_Backend.gs / RMX_Backend.gs
 * / FSC_Backend.gs.
 *****************************************************************************/


/* ========================================================================
 * ROUTER
 * ====================================================================== */
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page ? String(e.parameter.page) : '').toLowerCase();

  // Map the ?page= value to the HTML file that should be served.
  var file;
  if      (page === 'pricevolume')  file = 'Page_PriceVolume';
  else if (page === 'rmx')          file = 'Page_Rmx';
  else if (page === 'segment')      file = 'Page_Segment';
  else if (page === 'fuelsurcharge')file = 'Page_FuelSurcharge';
  else if (page === 'rmxfuel')      file = 'Page_RmxFuel';
  else if (page === 'tp01')         file = 'Page_TP01';
  else if (page === 'inventoryreport') file = 'Page_InventoryReport';
  else if (page === 'overview')     file = 'Page_Overview';
  else if (page === 'deckbuilder')  file = 'Page_DeckBuilder';
  else                              file = 'Landing';

  // We render through a template so each page can inject the web-app URL
  // (used to build the Home / page-switch links) without hard-coding it.
  var t = HtmlService.createTemplateFromFile(file);
  t.appUrl  = getAppUrl_();   // available inside the HTML as <?= appUrl ?>
  t.page    = page || 'landing';

  return t.evaluate()
    .setTitle('Amrize Commercial Suite')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* The deployed web-app URL (…/exec). Pages append ?page=xxx to navigate. */
function getAppUrl_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

/* Pull a shared HTML partial (Styles / Shell) into a page.
 * Used in the HTML like:  <?!= include('Styles') ?>                       */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}


/* ========================================================================
 * SHARED LOGO  (one copy used by every page's PNG export)
 * ----------------------------------------------------------------------
 * The URL lives centrally in Config.gs (APP_CONFIG.LOGO_URL).
 * ====================================================================== */
function getLogo() {
  var KEY = 'amrize_logo_datauri';
  try { var c = CacheService.getScriptCache().get(KEY); if (c) return c; } catch (e) {}
  try {
    var resp = UrlFetchApp.fetch(APP_CONFIG.LOGO_URL, { muteHttpExceptions: true, followRedirects: true });
    if (resp.getResponseCode() === 200) {
      var uri = 'data:image/svg+xml;base64,' + Utilities.base64Encode(resp.getContent());
      try { CacheService.getScriptCache().put(KEY, uri, 21600); } catch (e2) {}
      return uri;
    }
  } catch (e3) {}
  return '';
}

function getGuideImages(ids){
  return (ids||[]).map(function(id){
    try{
      var b = DriveApp.getFileById(id).getBlob();
      return 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
    }catch(e){ return ''; }
  });
}


/* ========================================================================
 * DATA VERSION (per page) + shared chunked cache
 * ----------------------------------------------------------------------
 * Each report page has ONE "data version" number stored in Script
 * Properties. Every server cache key AND every browser (localStorage)
 * cache key includes it, so bumping the number instantly strands every
 * old copy — for every user — with nothing to enumerate or delete.
 *
 * The number only changes when someone presses "Update from source"
 * (or syncAll). CacheService can hold values for at most 6 h; when an
 * entry lapses it is silently recomputed once and re-cached — the user
 * just sees a normal load. The browser copies (AmrCache in Shell.html)
 * have no expiry at all: they stay valid until the version changes.
 * ====================================================================== */
var APP_GEN_PROPS = { pricevolume: 'pv_cache_gen', rmx: 'cache_gen', segment: 'sb_cache_gen',
                      kpi: 'kpi_cache_gen' };

/* CODE BUILD STAMP - bump this whenever backend LOGIC changes.
   The generation below tracks the DATA: it moves when someone presses "Update
   from source". On its own that is not enough to invalidate a browser's saved
   tables, because a code fix leaves the data generation untouched - so every
   device keeps serving figures the OLD code computed and the fix looks like it
   did nothing. Folding this stamp into the token every page compares means a
   backend change clears each device on its next visit. */
var APP_CODE_BUILD = '2026-08-11a';

function APP_getGen_(page) {
  var prop = APP_GEN_PROPS[page]; if (!prop) return '1.' + APP_CODE_BUILD;
  try {
    var p = PropertiesService.getScriptProperties(), g = p.getProperty(prop);
    if (!g) { g = '1'; p.setProperty(prop, g); }
    return g + '.' + APP_CODE_BUILD;
  } catch (e) { return '1.' + APP_CODE_BUILD; }
}
function APP_bumpGen_(page) {
  var prop = APP_GEN_PROPS[page]; if (!prop) return '1';
  try {
    var p = PropertiesService.getScriptProperties();
    var g = String(parseInt(p.getProperty(prop) || '1', 10) + 1);
    p.setProperty(prop, g);
    return g;
  } catch (e) { return APP_getGen_(page); }
}
/* Tiny call every page makes on open: which data version is current?
 * The browser compares it with what it stored on its last visit. */
function getDataVersion(page) {
  page = String(page || '');
  return { page: page, generation: APP_getGen_(page) };
}

/* Several pages need more than one page's version before they can trust their
   device cache — the Executive Overview needs three. Asking three times cost
   three round trips, and Apps Script runs one user's calls end to end, so that
   was most of a second of dead time before the page had even started loading.
   One call, one execution, every version. */
function getDataVersions(pages) {
  var list = (pages && pages.length) ? pages : APP_dataPages_();
  var out = {};
  for (var i = 0; i < list.length; i++) {
    var p = String(list[i] || '');
    if (!p) continue;
    try { out[p] = APP_getGen_(p); } catch (e) { out[p] = ''; }
  }
  return { ok: true, generations: out };
}

/* chunked CacheService helpers (6 h TTL) used by the Slide data below */
function APP_cachePut_(key, obj) {
  try {
    var s = JSON.stringify(obj), CH = 90000, n = Math.ceil(s.length / CH);
    if (n > 250) return;                          // too big to cache; will recompute
    var m = {}; m[key + '__meta'] = String(n);
    for (var i = 0; i < n; i++) m[key + '__' + i] = s.substring(i * CH, (i + 1) * CH);
    CacheService.getScriptCache().putAll(m, 21600);
  } catch (e) {}
}
function APP_cacheGet_(key) {
  try {
    var c = CacheService.getScriptCache(), meta = c.get(key + '__meta');
    if (!meta) return null;
    var n = parseInt(meta, 10), ids = [];
    for (var i = 0; i < n; i++) ids.push(key + '__' + i);
    var got = c.getAll(ids), parts = [];
    for (var j = 0; j < n; j++) { var p = got[key + '__' + j]; if (p == null) return null; parts.push(p); }
    return JSON.parse(parts.join(''));
  } catch (e) { return null; }
}


/* ========================================================================
 * GLOBAL SYNC — invalidate every page's cache at once
 * ====================================================================== */
function syncAll() {
  try { RMX_NS.bumpGeneration(); } catch (e) {}     // RMX
  try { PV.clearCache();      } catch (e) {}     // Price & Volume (bumps its data version)
  try { APP_bumpGen_('segment'); } catch (e) {}  // Segment Product
  try { APP_bumpGen_('kpi');     } catch (e) {}  // shared KPI workbooks
  try { CacheService.getScriptCache().remove('amrize_logo_datauri'); } catch (e) {}
  return { ok: true, at: new Date().toISOString() };
}


/* ========================================================================
 * SLIDE BUILDER backend
 * ----------------------------------------------------------------------
 * Mirrors the original Excel-upload layout, but reads from the Google Sheet:
 *
 *   • Major Project Segment  → TWO tabs (MTD + YTD), each holding ALL markets.
 *   • Product Category       → ONE tab PER MARKET PER PERIOD (like the old
 *                              per-market uploads). With 5 markets that is
 *                              10 product tabs (5 × MTD/YTD).
 *
 * Product tabs are read tolerantly: a market with no tab yet simply shows
 * "waiting for data" on the slide instead of breaking the whole page, so you
 * can create them as you go (8, 10, however many markets you actually build).
 *
 * To rename things or point at a different sheet, edit
 * APP_CONFIG.PAGES.segment in Config.gs (SHEETS, MARKETS, MARKET_LABEL,
 * defaultSpreadsheetId) — nothing in this file needs to change.
 * ====================================================================== */
var SB = (function () {

  // All Slide Builder config (tabs, markets, labels, sheet) lives in Config.gs.
  // We read it through a helper AT CALL TIME so file load-order never matters.
  function cfg_(){ return APP_CONFIG.PAGES.segment; }

  // Per-market product tab name. e.g. market 'North', period 'MTD'
  // → "Slide Product North MTD". Name your tabs to match.
  function productTabName_(market, period) {
    var lbl = cfg_().MARKET_LABEL || {};
    return 'Slide Product ' + (lbl[market] || market) + ' ' + period;
  }

  // Read one tab as a grid of rows (header row first). Required tabs throw if
  // missing; optional tabs return null so a not-yet-created market is skipped.
  function readTab_(name, required) {
    var sh = APP_openSpreadsheet_('segment').getSheetByName(name);
    if (!sh) {
      if (required) {
        throw new Error('Tab "' + name + '" was not found in the Slide Builder data sheet. ' +
          'Check the tab name in your Google Sheet (or update APP_CONFIG.PAGES.segment in Config.gs).');
      }
      return null;
    }
    return sh.getDataRange().getValues();
  }


  function readTab_(name, required, asText) {
    var sh = APP_openSpreadsheet_('segment').getSheetByName(name);
    if (!sh) {
      if (required) {
        throw new Error('Tab "' + name + '" was not found in the Slide Builder data sheet. ' +
          'Check the tab name in your Google Sheet (or update APP_CONFIG.PAGES.slidebuilder in Config.gs).');
      }
      return null;
    }
    var rng = sh.getDataRange();
    return asText ? rng.getDisplayValues() : rng.getValues();
  }

  // Which month the Segment tabs are for, as "YYYY-M" (M is 0-based, like the
  // browser's Date).
  //
  // This is ALWAYS LAST CALENDAR MONTH, and it is worked out from the calendar
  // rather than read out of the data, because the data cannot answer it. The
  // Segment tabs arrive from QlikView already split into MTD and YTD and
  // already summed to Segment x Market: there is no month column on them at
  // all, and nothing to aggregate or slice. Whatever month the export was run
  // for, both tabs are for that one month, and that month is the last closed
  // one - the running month is only part-billed.
  //
  // It used to come from QLIK_REPORT_MONTH, stamped by QlikSync off the
  // Ready-Mix export's month column. That column is MYMONTH: a bare "Jul" with
  // no year, both years on the one row. The export carries every month of the
  // prior year, so the newest value in it is always DECEMBER, and the page
  // defaulted to December in August. The stamp is still written (the sync
  // report shows it) but it is no longer what the picker starts on.
  function reportMonth_() {
    var tz = Session.getScriptTimeZone();
    var y  = +Utilities.formatDate(new Date(), tz, 'yyyy');
    var m  = +Utilities.formatDate(new Date(), tz, 'M') - 1;   // 0-based, this month
    m -= 1;                                                    // last calendar month
    if (m < 0) { m = 11; y -= 1; }                             // in January, December of last year
    return y + '-' + m;
  }

  // Return the two all-market segment grids plus a per-market product grid for
  // every market, in one call. Shape:
  //   { segMTD, segYTD, reportMonth, prod: { <market>: { MTD:[…]|null, YTD:[…]|null } } }
  //
  // The segment tabs are read tolerantly, like the product tabs: a sheet that
  // has not been split into MTD / YTD yet shows "waiting for data" on that
  // slide instead of taking the whole page down with it.
  function getSlideData() {
    var SHEETS  = cfg_().SHEETS;
    var MARKETS = cfg_().MARKETS || [];
    var out = {
      segMTD: readTab_(SHEETS.segMTD, false, true),
      segYTD: readTab_(SHEETS.segYTD, false, true),
      reportMonth: reportMonth_(),
      prod: {}
    };
    MARKETS.forEach(function (m) {
      out.prod[m] = {
        MTD: readTab_(productTabName_(m, 'MTD'), false),
        YTD: readTab_(productTabName_(m, 'YTD'), false)
      };
    });
    return out;
  }

  return { getSlideData: getSlideData };
})();

// Top-level wrappers the Segment Product page calls via google.script.run.
// getSlideData is version-cached: the tabs are only re-read when the cache is
// empty (first visit / after 6 h) or after "Update from source".
function getSlideData() {
  var key = 'sb|g' + APP_getGen_('segment') + '|slideData';
  var hit = APP_cacheGet_(key);
  if (hit && (hit.segMTD || hit.segYTD)) return hit;      // ignore the old single-tab shape
  var out = SB.getSlideData();
  out.generation = APP_getGen_('segment');
  APP_cachePut_(key, out);
  return out;
}
// "Update from source": new data version (every saved copy everywhere is now
// stale), then re-read the sheet and re-cache under the new version.
function syncSlideData() {
  APP_bumpGen_('segment');
  return getSlideData();
}