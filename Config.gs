/*****************************************************************************
 * Config.gs — SINGLE SOURCE OF TRUTH for everything configurable
 * ---------------------------------------------------------------------------
 * Everything you would ever want to tweak lives in ONE place: APP_CONFIG.
 *
 *   • Each page reads from its OWN Google Sheet.
 *   • The sheet is set IN CODE here (defaultSpreadsheetId) and can be
 *     OVERRIDDEN per page at runtime from the Settings modal (⚙ bottom-right).
 *   • Tab names, market lists, and the logo all live here too — no more
 *     hunting through PV_Backend.gs / RMX_Backend.gs / Code.gs.
 *
 * Resolution order for a page's sheet (first hit wins):
 *     1. Settings override   (Script Property  DATA_SPREADSHEET_ID__<page>)
 *     2. Code default        (APP_CONFIG.PAGES[page].defaultSpreadsheetId)
 * That's it — set the default below; optionally override it from the ⚙ UI.
 *
 * The backends never reference APP_CONFIG at file-load time (only inside
 * functions / getters), so the order Apps Script loads .gs files never matters.
 *****************************************************************************/

var APP_CONFIG = {

  /* Shared Drive folder for the KPI (EBITDA) workbooks. One upload on the
     Price & Volume or Product Segment page replaces the file for EVERYONE.
     Must be shared with the team as Editor. */
  KPI_FOLDER_ID: '1uUjtYN2kJ5-TmvYPKdMbNYe8juVMeEYU',


  /* Drive folders holding the raw QlikView exports, read by QlikSync.gs when
     someone presses "Update data from QlikView" on the home page.

     File NAMES are never trusted — every Excel file in the folder is opened and
     identified by what is inside it, so re-exporting under a different name
     needs no change here. Just drop the new export in and delete the old one.

       AGG_FOLDER_ID  the Aggregates Margin Monitor export
                      → Price & Volume workbook (Combined Data CPI Raw +
                        Combined Data CPI Other Revenue)

       RMX_FOLDER_ID  BOTH Ready-Mix exports, in one folder:
                      the Margin Monitor export → Ready-Mix workbook
                        (Main / Extra / Associate Raw Data)
                      the Segment + Product export → Slide Builder workbook
                        (Slide Segment MTD/YTD, Slide Product <Market> MTD/YTD)

     Both folders must be shared with whoever runs the update. */
  QLIK_SYNC: {
    AGG_FOLDER_ID: '1PiUwYYHwFklcJBjIR4v1n0HsNDrCCxyg',
    RMX_FOLDER_ID: '1sdHATTQIxGAkB55R-Xz85FJjpxU8ROAO'
  },


  /* Logo used by every page's PNG export. */
  LOGO_URL: 'https://www.amrize.com/content/dam/newco/global/logo-amrize.svg',

  /* Script-Property key prefix. A page's chosen sheet is stored as
     <PROP_PREFIX><page>, e.g.  DATA_SPREADSHEET_ID__pricevolume            */
  PROP_PREFIX: 'DATA_SPREADSHEET_ID__',

  /* ----------------------------------------------------------------------
   * PER-PAGE CONFIGURATION
   * ----------------------------------------------------------------------
   *   defaultSpreadsheetId : set the sheet IN CODE here. The Settings UI can
   *                          override it per page at runtime.
   *   SHEETS               : the tab names that page reads. Rename tabs here.
   * -------------------------------------------------------------------- */
  PAGES: {

    /* ---------------- Price & Volume ---------------- */
    pricevolume: {
      label: 'Price & Volume Analysis',
      defaultSpreadsheetId: '1mneM33Ej5gOGfXsbVyVOV0wQoLVVLmB-okupVUQ5TwQ',
      SHEETS: {
        SHEET:          'Combined Data CPI Raw',
        REGION_LOOKUP:  'REGION LOOKUP',
        TOPLINE_LOOKUP: 'TOPLINE REV LOOKUP2'
      }
    },

    /* ---------------- Amrize RMX ---------------- */
    rmx: {
      label: 'Amrize RMX',
      defaultSpreadsheetId: '1rC-YErwPAuk9v4ELBrl6IH7VB8Hhr0vlcZUDGMXZVH8',
      SHEETS: {
        MAIN:      'Main Raw Data',
        EXTRA:     'Extra Raw Data',
        ASSOC:     'Associate Raw Data',
        PLANT:     'PLANT LOOKUP',
        PRODUCT:   'PRODUCT MASTER',
        EXTRASLU:  'EXTRAS LOOKUP',
        CUSTOMFLAG:'CUSTOM FLAG LOOKUP'
      }
    },

    /* ---------------- Slide Builder ---------------- */
    segment: {
      label: 'Commercial Product Segment',
      defaultSpreadsheetId: '1ED6caThzPlyP76w6eNIdjbriz7CVRySo2qzRmTGDiDk',   // ← set your Slide Builder sheet here, or via Settings
      SHEETS: {
        /* Major Project Segment, already summed to Segment x Market by
           QlikView and already split by period — so there is no Bill Month
           column any more and no per-month row repetition. The old single
           "Slide Segment" tab carried every month and the page did the
           MTD/YTD split itself; the export does that now. */
        segMTD: 'Slide Segment MTD',
        segYTD: 'Slide Segment YTD'
      },
      // Markets the Slide Builder builds (drives the per-market product tabs).
      // These are the markets with a PRODUCT TAB in the sheet. The page also
      // offers "Central Canada", but it needs nothing here: its Segment table
      // reads the Slide Segment tab unfiltered, and its Product table is rolled
      // up in the browser from the five tabs below. So there is deliberately no
      // "Slide Product Central" tab to create or maintain.
      MARKETS: ['HNS_SW', 'Innocon', 'Manitoba', 'North', 'Saskatchewan'],
      MARKET_LABEL: { HNS_SW:'HNS', Innocon:'Innocon', Manitoba:'Manitoba', North:'North', Saskatchewan:'Saskatchewan' }
    },

    /* ---------------- Saskatchewan increase tracking ----------------
       Saskatchewan has no fuel surcharge. In its place a per-customer
       mid-year PRICE INCREASE ($/tonne, from a start date) is tracked in
       its OWN Google Sheet, and that is what drives Saskatchewan's fuel
       recovery on the Price & Volume customer tab and on the Fuel Recovery
       page. Paste the sheet link into \u2699 Settings (or set the id here).

       Leave it unset and nothing changes anywhere — both pages behave
       exactly as they do today.

       Expected columns (header row may sit below blank rows; order and
       spacing don't matter): Customer \u00b7 Increase Amount ($/tn) \u00b7 Start Date.
       Blank rows and a Totals row are skipped. */
    saskrates: {
      label: 'Saskatchewan Increase Tracking',
      hint:  'Per-customer $/tonne increase and start date. Drives Saskatchewan\u2019s recovery on the '
           + 'Price & Volume customer tab and the Fuel Recovery tables. Optional — leave it unset and '
           + 'Saskatchewan reads exactly as it does today.',
      defaultSpreadsheetId: '',      // \u2190 paste the sheet id here, or set it in \u2699 Settings
      MARKET: 'Saskatchewan',        // the Price & Volume / Fuel Recovery market these rates belong to
      SHEETS: {
        RATES: ''                    // tab name; leave '' to use the first tab in the sheet
      }
    },

    /* ---------------- Fuel Recovery ---------------- */
    fuelsurcharge: {
      label: 'Fuel Recovery',
      /* NO SHEET OF ITS OWN ANY MORE.
         Fuel recovery is read from the Price & Volume sheet's
         "Combined Data CPI Raw" tab, where the surcharge sits on the same row
         as the volume it was charged on. The old Fuel Recovery workbook was
         pre-summed to Market x Sold To, so applied tonnes had to be inferred
         from a bucket and came out too high. Nothing to configure here: point
         Price & Volume at the right sheet and this page follows.

         Saskatchewan is the exception - it has a price increase rather than a
         surcharge, and that still comes from the Saskatchewan rates sheet
         (see APP_EXTRA_SOURCES below).

         `readsFrom` is now ENFORCED, not just documentation: id resolution
         follows it (APP_sheetOwner_) and the ⚙ panel skips this page's own
         row, so the retired Fuel Recovery workbook cannot come back through the
         DATA_SPREADSHEET_ID__fuelsurcharge property left over from before the
         move. Run clearRetiredOverrides() once to delete that property. */
      readsFrom: 'pricevolume',
      SHEETS: {}
    },

    /* ---------------- HISTORY: Aggregates (2025 / 2024) ----------------
       Read ONCE, by the "Rebuild history" button on the Overview, and never
       on the user path. The Overview's month cube merges these closed years
       under the live Price & Volume sheet — live always wins for any month
       it carries, so the 2025 months the live sheet still holds as PY come
       from live and the rest come from here.

       NOTE — the export reuses the live template, so this tab's headers can
       still read "2026 Volume" / "2025 Volume" while the data is 2025/2024.
       The cube reads the YEAR COLUMN, never the header, so a stale header
       does not shift a month into the wrong year.                          */
    histagg: {
      label: 'Aggregates history (2025 / 2024)',
      hint:  'Closed-year Price & Volume export. Optional.',
      defaultSpreadsheetId: '',      // \u2190 paste the sheet id here, or set it in \u2699 Settings
      SHEETS: {
        SHEET:          'Combined Data CPI Raw',
        REGION_LOOKUP:  'REGION LOOKUP',
        TOPLINE_LOOKUP: 'TOPLINE REV LOOKUP2'
      }
    },

    /* ---------------- HISTORY: Ready-Mix (2025 / 2024) ----------------
       Same contract as histagg. Bill Month is read as TEXT ("JUL-26"), with
       a fallback for sheets that store it as a real date.                  */
    histrmx: {
      label: 'Ready-Mix history (2025 / 2024)',
      hint:  'Closed-year RMX PPI export. Optional.',
      defaultSpreadsheetId: '',      // \u2190 paste the sheet id here, or set it in \u2699 Settings
      SHEETS: {
        MAIN:    'Main Raw Data',
        EXTRA:   'Extra Raw Data',
        ASSOC:   'Associate Raw Data',
        PLANT:   'PLANT LOOKUP',
        PRODUCT: 'PRODUCT MASTER'
      }
    },

    /* ------- HISTORY, ONE BOOK BACK: Aggregates (2024 / 2023) -------
       Identical in every way to histagg above - same export, same tabs, one
       pair of years earlier. Nothing in the reader is year-aware: it takes the
       years from the Year column and the "#### Volume" headers, so a third,
       fourth or fifth book needs a page entry here and a line in CUBE.ERAS,
       never a code change.

       Where two books overlap - 2024 is the PY of one and the CY of the other
       - the NEWER book wins that month, and the live sheet wins over both. */
    histagg2: {
      label: 'Aggregates history (2024 / 2023)',
      hint:  'Closed-year Price & Volume export, one book back. Optional.',
      defaultSpreadsheetId: '',      // paste the sheet id here, or set it in the Data sheet panel
      SHEETS: {
        SHEET:          'Combined Data CPI Raw',
        REGION_LOOKUP:  'REGION LOOKUP',
        TOPLINE_LOOKUP: 'TOPLINE REV LOOKUP2'
      }
    },

    /* ------- HISTORY, ONE BOOK BACK: Ready-Mix (2024 / 2023) ------- */
    histrmx2: {
      label: 'Ready-Mix history (2024 / 2023)',
      hint:  'Closed-year RMX PPI export, one book back. Optional.',
      defaultSpreadsheetId: '',      // paste the sheet id here, or set it in the Data sheet panel
      SHEETS: {
        MAIN:    'Main Raw Data',
        EXTRA:   'Extra Raw Data',
        ASSOC:   'Associate Raw Data',
        PLANT:   'PLANT LOOKUP',
        PRODUCT: 'PRODUCT MASTER'
      }
    }
  },

  /* ----------------------------------------------------------------------
   * MONTH CUBE (Executive Overview trends + month/year selection)
   * ----------------------------------------------------------------------
   * The browser holds a compact fact table and computes every section from
   * it, so changing month / market / filter never touches the server.
   *
   *   CHUNK_MONTHS  how many months travel in one google.script.run call.
   *                 12 keeps each chunk near 1 MB of JSON. Apps Script runs a
   *                 user's calls one after another, so the per-call overhead
   *                 — not the payload — is what the loading time is made of:
   *                 fewer, fatter chunks finish sooner. Chunks are requested
   *                 NEWEST FIRST, and the browser asks for the line you are
   *                 actually looking at before the other one.
   *   HIST_FOLDER_ID  where the two built history files are parked. Defaults
   *                 to the KPI folder so there is nothing new to share.
   * -------------------------------------------------------------------- */
  CUBE: {
    CHUNK_MONTHS:   12,
    HIST_FOLDER_ID: '',                    // '' -> falls back to KPI_FOLDER_ID
    FILES: { agg: 'cube_hist_agg.json', rmx: 'cube_hist_rmx.json' },

    /* ------------------------------------------------------------------
     * ERAS - the closed-year books, NEWEST FIRST.
     * ------------------------------------------------------------------
     * One entry per workbook pair. `id` names the built file (the first era
     * keeps the plain FILES names above, so nothing already in Drive is
     * orphaned; later eras get "_h2", "_h3" ...). `agg` / `rmx` are the page
     * ids in PAGES above, which is where each book's sheet link lives.
     *
     * Adding a 2022 / 2023 book later is TWO page entries plus ONE line here.
     * Reading is automatic: any era with a sheet link and no built file is
     * read once, in the background, newest first.
     *
     * Overlap rule: an earlier entry in this list WINS any month a later one
     * also carries (2024 lives in both books below), and the live sheet wins
     * over every era.
     * ---------------------------------------------------------------- */
    ERAS: [
      { id:'h1', label:'2025 / 2024', agg:'histagg',  rmx:'histrmx'  },
      { id:'h2', label:'2024 / 2023', agg:'histagg2', rmx:'histrmx2' }
    ],

    /* Oldest month the Overview's slider will ever offer. Guards against one
       stray mis-dated row dragging the handle back to 1970. Raise it when a
       book is retired, never to hide a book that is still configured. */
    FLOOR: 202301,

    /* ------------------------------------------------------------------
     * PPI COVERAGE THRESHOLDS \u2014 Qlik parity
     * ------------------------------------------------------------------
     * A plant x material (AGG) / plant x mix (RMX) pair only earns PPI
     * weight when BOTH years clear these floors. The app used to test
     * "> 0" on all four figures, which let rows carrying a couple of
     * cents of prior-year revenue into the index \u2014 harmless once a full
     * year dilutes them, ruinous in a single month.
     *
     * RMX mirrors Qlik's Weight expression exactly:
     *     if(vCYREVMIX>110, if(vCYVOL>1, if(vPYREVMIX>110, if(vPYVOL>1 \u2026
     * Verified on 2025 vs 2024: all-markets moves 5.19% -> 2.05% and North
     * 57.68% -> 3.74%, dropping 75 of 3,863 pairs worth 0.063% of weight.
     *
     * AGG is left at 0/0 \u2014 the same floors change NOTHING there (its bad
     * rows carry $404 and $53,542 of prior-year revenue, well clear of any
     * $110 floor), so guessing a number would only invent a divergence.
     * Fill these in once the Aggregates Qlik expression is to hand.
     *
     * NOTE: Qlik's Weight also carries Wildmatch(mix_prod_hier_1,'A*') and
     * a set of material exclusions that the export does not expose. See
     * the header comment in Ov_Backend.gs.
     * ---------------------------------------------------------------- */
    COVERAGE: {
      agg: { minVol: 0, minRev: 0    },    // \u2190 awaiting the Aggregates Qlik expression
      rmx: { minVol: 1, minRev: 110  }     // Qlik: vol > 1, revenue > 110
    }
  }
};

/* ------------------------------------------------------------------
 * NOT USED 
 * EXECUTIVE OVERVIEW — canonical market list + PV/RMX name mapping.
 * The Overview page reads PV and RMX (never blends them). Each row maps
 * ONE overview market to the exact MARKET value in each source.
 *   pv  = the value in the PV "MARKET" column
 *   rmx = the RMX market key (matches APP_CONFIG.PAGES.segment.MARKETS)
 * If a PV market name differs from below, the Overview footer will list it
 * as "unmapped" — just correct the pv value here.
 * ------------------------------------------------------------------ */
var OVERVIEW = {
  MARKETS: [
    { key:'north', label:'North',             pv:'North',        rmx:'North' },
    { key:'sask',  label:'Saskatchewan',      pv:'Saskatchewan', rmx:'SASKATCHEWAN' },
    { key:'mb',    label:'Manitoba',          pv:'Manitoba',     rmx:'MANITOBA' },
    { key:'sw',    label:'SW / HNS',   pv:'Southwest',    rmx:'HNS_SW' },
    { key:'gta',   label:'GTA / Innocon', pv:'Greater Toronto Area',      rmx:'Innocon' }
  ]
};


/* ========================================================================
 * Helpers (plain functions — hoisted, so always safe to call)
 * ====================================================================== */

/* The page ids that have a data source. */
function APP_dataPages_(){ return ['pricevolume', 'rmx', 'segment', 'saskrates',
                                  'histagg', 'histrmx',
                                  'histagg2', 'histrmx2']; }

/* Extra data sources a page shows in its \u2699 Data sheet panel, on top of its
   own. Saskatchewan's increase rates feed BOTH the Price & Volume customer tab
   and the Fuel Recovery tables, so both pages list (and can change) that sheet
   without anyone having to go back to the home screen. */
var APP_EXTRA_SOURCES = { pricevolume: ['saskrates'],
                          /* Fuel Recovery now reads Price & Volume, so its Data
                             sheet panel offers that sheet and the Saskatchewan
                             rates rather than a workbook of its own. */
                          fuelsurcharge: ['pricevolume', 'saskrates'],
                          /* RMX Fuel Recovery has no sheet of its own - it runs off the
                             Ready-Mix workbook's Main and Extra Raw Data tabs, so its
                             panel offers that one sheet. */
                          rmxfuel: ['rmx'],
                          /* The Commercial Product Segment slide reads the Ready-Mix
                             workbook now (Main / Extra / Associate Raw Data), not the
                             pre-summed Slide Segment / Slide Product tabs, so its panel
                             offers that sheet as well as its own. */
                          segment: ['rmx'],
                          /* The Executive Overview has no sheet of its own \u2014 it reads the
                             other tools'. Listing them here gives its \u2699 panel the full set,
                             including the two closed-year history books the month cube needs. */
                          overview: ['pricevolume', 'rmx', 'segment',
                                       'histagg', 'histrmx',
                                       'histagg2', 'histrmx2'] };

/* Validate an incoming page id. We do NOT silently default to a page here:
   a wrong/blank id used to make RMX open the Price & Volume sheet and throw a
   confusing "Sheet not found". Now it fails loudly and tells you what to fix. */
function APP_requirePage_(page){
  var p = String(page || '').toLowerCase();
  if (!APP_CONFIG.PAGES[p]) {
    throw new Error('Internal: APP_openSpreadsheet_ was called with page "' + page +
      '". A backend is not passing its page id. Expected one of: ' + APP_dataPages_().join(', ') +
      '. (Check the APP_openSpreadsheet_(\'…\') call in PV_Backend.gs / RMX_Backend.gs / FSC_Backend.gs / Code.gs.)');
  }
  return p;
}

/* The Script-Property key for a page's chosen sheet. Keyed on the page that
   OWNS the sheet, so read, save and clear all address the same property. */
function APP_propKey_(page){ return APP_CONFIG.PROP_PREFIX + APP_sheetOwner_(page); }

/* A page that reads someone else's sheet owns none of its own. `readsFrom`
   redirects every id lookup to that page, so a workbook a page has been
   RETIRED FROM can never come back through a stale Script Property. Fuel
   Recovery is the case in point: it moved to the Price & Volume sheet's
   Combined Data CPI Raw tab, but DATA_SPREADSHEET_ID__fuelsurcharge was still
   set from before the move, so its ⚙ panel kept offering the dead workbook. */
function APP_sheetOwner_(page){
  var p = APP_requirePage_(page), seen = {};
  while (APP_CONFIG.PAGES[p] && APP_CONFIG.PAGES[p].readsFrom && !seen[p]){
    seen[p] = 1;
    var next = String(APP_CONFIG.PAGES[p].readsFrom).toLowerCase();
    if (!APP_CONFIG.PAGES[next]) break;
    p = next;
  }
  return p;
}

/* Resolve the spreadsheet id for a page: UI override → code default. */
function getSpreadsheetIdForPage_(page){
  var p = APP_sheetOwner_(page);
  var override = PropertiesService.getScriptProperties().getProperty(APP_propKey_(p));
  return override || APP_CONFIG.PAGES[p].defaultSpreadsheetId || '';
}

/* Where a page's id is coming from (for the Settings UI badge). */
function spreadsheetSourceForPage_(page){
  var p = APP_sheetOwner_(page);
  if (PropertiesService.getScriptProperties().getProperty(APP_propKey_(p))) return 'override';
  if (APP_CONFIG.PAGES[p].defaultSpreadsheetId)                            return 'code';
  return 'none';
}


/* ========================================================================
 * SHARED SHEET ACCESS — called by every page's backend.
 * Pass the page id so each page opens ITS OWN sheet.
 * (Backends call: APP_openSpreadsheet_('pricevolume' | 'rmx' | 'segment' | 'fuelsurcharge'))
 * ====================================================================== */
function APP_openSpreadsheet_(page){
  var p  = APP_requirePage_(page);
  var id = getSpreadsheetIdForPage_(p);
  if (!id) {
    throw new Error('No Google Sheet set for ' + APP_CONFIG.PAGES[p].label +
      '. Set APP_CONFIG.PAGES.' + p + '.defaultSpreadsheetId in Config.gs, ' +
      'or paste a link in \u2699 Settings.');
  }
  return SpreadsheetApp.openById(id);
}


/* Optional sources (currently just saskrates) must never break a page when
   they are not set up. This returns null instead of throwing. */
function APP_openSpreadsheetOptional_(page){
  try {
    var id = getSpreadsheetIdForPage_(page);
    return id ? SpreadsheetApp.openById(id) : null;
  } catch (e) { return null; }
}


/* ========================================================================
 * SETTINGS API — called from Shell.html (google.script.run)
 * ====================================================================== */

/* One page's data-source status. */
function getSettings(page){
  var p   = APP_requirePage_(page);
  var id  = getSpreadsheetIdForPage_(p);
  var out = {
    page:          p,
    label:         APP_CONFIG.PAGES[p].label,
    spreadsheetId: id,
    source:        spreadsheetSourceForPage_(p),   // 'override' | 'code' | 'none'
    configured:    !!id,
    hint:          APP_CONFIG.PAGES[p].hint || '',
    name:          '',
    url:           ''
  };
  if (id) {
    try {
      var ss = SpreadsheetApp.openById(id);
      out.name = ss.getName();
      out.url  = ss.getUrl();
    } catch (err) {
      out.configured = false;
      out.error = 'Saved sheet could not be opened: ' + (err && err.message || err);
    }
  }
  return out;
}

/* All data pages at once (used by the Landing page's Settings modal). */
function getAllSettings(){
  return APP_dataPages_().map(function(p){ return getSettings(p); });
}

/* Everything ONE page's \u2699 panel lists: its own sheet first, then any extra
   source that page reads. Always an array, even when there is just the one. */
function getSettingsFor(page){
  /* A page does NOT have to own a sheet. The Executive Overview owns none \u2014 it
     reads the other tools' \u2014 so APP_requirePage_ would throw here and its \u2699
     button would come back "Could not read settings". Own sheet first when there
     is one, then the extras. */
  var p   = String(page || '').toLowerCase();
  var out = [];
  /* ...and a page that declares `readsFrom` owns none either - Fuel Recovery
     reads Price & Volume now. Listing it would show its RETIRED workbook (or,
     once the id follows readsFrom, the Price & Volume sheet twice), so the
     page's own row is skipped and APP_EXTRA_SOURCES supplies the real sheets. */
  if (APP_CONFIG.PAGES[p] && !APP_CONFIG.PAGES[p].readsFrom) out.push(getSettings(p));
  (APP_EXTRA_SOURCES[p] || []).forEach(function(x){
    if (APP_CONFIG.PAGES[x]) out.push(getSettings(x));
  });
  if (!out.length) throw new Error('No data source is configured for the page "' + page + '".');
  return out;
}

/* Save a page's sheet (accepts a full URL or a bare id). Verifies access,
   stores the override per page, and clears caches so the next request reads
   fresh data. `page` is required now; it defaults to pricevolume if omitted. */
function saveSpreadsheetId(input, page){
  var p  = APP_requirePage_(page);
  var id = extractSpreadsheetId_(input);
  if (!id) throw new Error('That doesn\u2019t look like a Google Sheet link or ID. Paste the full URL from your browser.');

  var ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (err) { throw new Error('Could not open that sheet. Check the link and that you have access. (' + (err && err.message || err) + ')'); }

  PropertiesService.getScriptProperties().setProperty(APP_propKey_(p), id);
  syncAll();                       // changing a source must invalidate caches
  return { ok: true, page: p, spreadsheetId: id, name: ss.getName(), url: ss.getUrl() };
}

/* Remove a page's override so it falls back to the code default. */
function clearSpreadsheetOverride(page){
  var p = APP_requirePage_(page);
  PropertiesService.getScriptProperties().deleteProperty(APP_propKey_(p));
  syncAll();
  return getSettings(p);
}

/* One-off tidy-up, run from the Apps Script editor: delete the Script
   Properties belonging to pages that no longer own a sheet. Nothing reads them
   any more (getSpreadsheetIdForPage_ follows `readsFrom`), so this only stops a
   retired workbook - "No longer needed FSC" - from lingering in the property
   store. Safe to run any number of times. */
function clearRetiredOverrides(){
  var props = PropertiesService.getScriptProperties(), gone = [];
  Object.keys(APP_CONFIG.PAGES).forEach(function(p){
    if (!APP_CONFIG.PAGES[p].readsFrom) return;
    var key = APP_CONFIG.PROP_PREFIX + p;
    if (props.getProperty(key) != null){ props.deleteProperty(key); gone.push(key); }
  });
  return { cleared: gone };
}

/* Accepts ".../spreadsheets/d/<ID>/edit", or a bare ID, and returns the ID. */
function extractSpreadsheetId_(input){
  var s = String(input == null ? '' : input).trim();
  if (!s) return '';
  var m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;   // bare id: long token, no spaces/slashes
  return '';
}