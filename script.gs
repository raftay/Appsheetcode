/*****************************************************************************
 * script.gs — THE ENTIRE SERVER SIDE OF THE AMRIZE COMMERCIAL SUITE
 *****************************************************************************
 *
 * One file. Every backend.
 *
 * THE SCRIPT PROJECT IS THREE FILES: script.gs, app.html and appsscript.json.
 * There is no fourth, and nothing here reads one — doGet asks HtmlService for
 * 'app' and for nothing else. Moving the whole application means copying three
 * files, which is the entire point of it being shaped this way.
 *
 * IT IS script.gs AND NOT app.gs, AND THAT IS NOT A STYLE CHOICE. An Apps
 * Script project keys a file by its NAME WITHOUT THE EXTENSION, so 'app.gs'
 * and 'app.html' are both the file 'app' and the project cannot hold both —
 * the editor refuses the second one and the API rejects the push. It also
 * makes HtmlService.createTemplateFromFile('app') ambiguous, which is the
 * call doGet depends on. Renaming this back to app.gs breaks the project.
 *
 * The repo this came from also holds PLAN.md, README.md and a tests/ folder,
 * and if you have them they are worth reading — PLAN.md describes the merge
 * that produced this file, README §7 the domain rules. IF YOU DO NOT HAVE THEM,
 * everything you actually need in order not to break this file is below and in
 * the section banners. They are documentation, not dependencies.
 *
 * HOW TO NAVIGATE THIS FILE
 * -------------------------
 * Search for a section banner, e.g.  Ctrl+F  "§7"  or  "§11  TRIGGERS".
 *
 *   §1   CONFIG ............... APP_CONFIG, OVERVIEW, DECK_CONFIG, DECK_RECIPE,
 *                               APP_EXTRA_SOURCES, the Settings API. FIRST on
 *                               purpose, and its banner is the map of every
 *                               constant in this file worth changing.
 *   §2   LOGGING .............. APP_log, and the LOG_LEVEL switch.
 *   §3   ROUTER + PLUMBING .... doGet, getLogo, the data-generation stamps,
 *                               the chunked cache, the SB reader.
 *   §4   PERMISSIONS .......... APP_verifyPermissions(). Read this before
 *                               adding a service to the project.
 *   §5   SYNC ................. the QlikView → Sheets engine.
 *   §6   AGG .................. Price & Volume, its mapping check, AGG Fuel
 *                               Recovery, Saskatchewan rates.
 *   §7   RMX .................. Ready-Mix, its lookup suggester, RMX Fuel
 *                               Recovery.
 *   §8   OVERVIEW ............. the executive Overview and the month cube.
 *   §9   DECK ................. the Slides template reader, the deck writer and
 *                               the recipe checker. The template id, the folder
 *                               and the slide list are CONFIG, and live in §1.
 *   §10  SMALL PAGES .......... KPI workbooks, TP01 mail, Inventory Report.
 *   §11  TRIGGERS ............. everything reached from outside the repo.
 *
 * THE THINGS THAT WILL BITE YOU
 * -----------------------------
 * 1. EVERY .gs FILE IN AN APPS SCRIPT PROJECT SHARES ONE GLOBAL SCOPE. That is
 *    why this file exists at all, and why a second copy of it cannot sit in the
 *    project beside it: whichever file is evaluated last wins, silently, and
 *    the project's internal file order is not something this repo controls.
 *
 * 2. A FUNCTION WITH NO CALLER IN THE REPO CAN STILL BE LOAD-BEARING. Three
 *    kinds of caller live outside it: the time-driven trigger (§11), the
 *    editor's Run menu, and Apps Script itself calling doGet. Check the trigger
 *    list and the function's own comment before deciding anything is dead.
 *
 * 3. THE oauthScopes ARRAY IN appsscript.json REPLACES AUTO-DETECTION. Add a
 *    service, add its scope by hand — nothing warns you, the call just throws
 *    for every user. §4 is how you find that out in one run.
 *
 * 4. toNum_ / norm_ / gk_ HAVE DRIFTED, AND CHUNK 15 SETTLED THAT THEY STAY
 *    THAT WAY. Not three copies — SIX toNum_, SIX norm_ and two gk_, across
 *    SEVEN namespaces (QLIKSYNC, PV, PVLOOK, FSC, SASKRATES, RMX, RFSC), and
 *    four genuinely different dialects of each. The reason there is no safe
 *    direction to unify them in is that NEITHER DIALECT IS A SUPERSET:
 *
 *      · PV reads the text "5%" as 0.05; FSC/RFSC/RMX/SASK read it as 5.
 *        PV is right — a percent-FORMATTED cell already arrives as 0.05, so a
 *        "5%" that reaches toNum_ is text and means five percent.
 *      · FSC/RFSC/RMX/SASK read "(1,234)" as -1234; PV reads it as ZERO.
 *        They are right — that is how an accounting export writes a negative,
 *        and PV drops the figure rather than mis-signing it.
 *
 *    Pick either and you silently break the other, under 144 call sites, with
 *    nothing failing. So: DO NOT UNIFY THEM. tests/helpers.js pins all fourteen
 *    definitions to a table of inputs, so a future tidy fails there with the
 *    input that moved. PLAN.md chunk 15 has the full diff and the two latent
 *    bugs it turned up.
 *
 * 6. WHEN YOU DELETE CODE BY ANCHORED TEXT, DIFF THE SYMBOL TABLE — not just
 *    the syntax. A cut that takes one function too many is still perfectly
 *    valid JavaScript, and in a half-megabyte file nobody sees it in a diff.
 *    This is not hypothetical: the first build of this file lost RMX_whoWins
 *    that way. The anchor matched UNIQUELY, node --check passed, every
 *    structural check passed, and the only thing that noticed was a
 *    before/after set difference of declared names.
 *
 * 7. THE SILENT catch IS A DECISION, NOT A STYLE. Silent is right for an
 *    optional cache read and wrong for everything else — see §2's census. An
 *    invalidation that fails silently looks exactly like nothing having
 *    happened, which is the single most common shape of bug in this file's
 *    history.
 *
 * LINE ENDINGS: LF throughout. Most of the files this was merged from were
 * CRLF and two carried a lone CR as a line terminator; do not let an editor
 * flip any of it back. .gitattributes pins it if you have the repo.
 *****************************************************************************/


/* ============================================================================
 * §1  CONFIG — everything you are meant to change
 * ----------------------------------------------------------------------------
 * The single source of truth for everything configurable, and it comes FIRST on
 * purpose. IIFEs run at evaluation time, so anything that read config while
 * constructing itself would have to sit below this. Today nothing does — every
 * read is inside a function or a getter, which is why the old 16-file load order
 * never mattered — and putting config at the top means nothing ever has to.
 *
 * WHERE EVERY KNOB IS. A number in an 11,000-line file is either configuration
 * or it is code, and there is no way to tell which by looking at it. So the ones
 * that are configuration are either HERE, or they are named below with the
 * section that owns them. Nothing else in this file is meant to be edited by
 * hand.
 *
 *   IN THIS SECTION
 *     APP_CONFIG.PAGES.<page>.defaultSpreadsheetId   which Sheet a page reads
 *     APP_CONFIG.PAGES.<page>.SHEETS                 its tab names
 *     APP_CONFIG.PAGES.segment.MARKETS               the Slide Builder's markets
 *     APP_CONFIG.QLIK_SYNC.*                         the three QlikView exports
 *     APP_CONFIG.KPI_FOLDER_ID                       where the EBITDA books live
 *     APP_CONFIG.LOGO_URL                            the logo every export uses
 *     APP_CONFIG.LOG_LEVEL                           how much the server logs (§2)
 *     APP_CONFIG.CUBE.ERAS                           the closed-year books
 *     APP_CONFIG.CUBE.FLOOR                          oldest month the slider offers
 *     APP_CONFIG.CUBE.COVERAGE                       the PPI weight floors
 *     OVERVIEW.MARKETS                               the canonical market list, and
 *                                                    its PV / RMX spellings
 *     APP_EXTRA_SOURCES                              extra sheets a page's ⚙ offers
 *     DECK_CONFIG                                    the deck template and folder,
 *                                                    and the capture resolution
 *     DECK_RECIPE                                    WHICH slides the monthly deck
 *                                                    holds, and in what order
 *
 *   THE LAST TWO MOVED HERE FROM §9 IN CHUNK 22. They are the deck's two config
 *   objects and they used to sit behind the engine that reads them, ten thousand
 *   lines down. §9 still holds everything about the deck that is code.
 *   tests/gsparity.js declares the move.
 *
 *   STILL BESIDE THE CODE THAT READS THEM, deliberately — changing one of these
 *   means understanding what it feeds, and the comment beside it is the half you
 *   need:
 *     §3   APP_PAGES               the ten route names doGet accepts
 *     §3   APP_STAMP_TTL_S         how long a freshness stamp is memoised
 *     §6   SCHEMA_                 PV's cache-shape version — bump on a change
 *     §6   XF_TABLE_CAP / XF_CHILD_CAP / XF_DATA_CAP    cross-filter payload caps
 *     §6   LIST_CAP, RL_*          the lookup writer's column map
 *     §7   RXF_TABLE_CAP / RXF_DRILL_CAP / RXF_EXCL_CAP  the Ready-Mix equivalents
 *     §7   SG_OLD2NEW_LIST, SG_TECTS   the product suggester's vocabulary
 *     §8   OVCUBE_SHAPE_VER_       the month cube's shape version
 *     §10  TP_RECIP_KEY            names the PROPERTY the TP01 recipient map is
 *                                  stored in — the map itself is not in this file
 *
 *   THE CLIENT HAS ITS OWN, AND THE TWO DO NOT OVERLAP. Nothing in app.html
 *   reads a constant from this file; its tunables — the slide frame, and every
 *   page's whitespace defaults — are in ITS §C.
 * ============================================================================ */

/* ---- Config.gs ---------------------------------------------------------------
   Verbatim, plus one addition: APP_CONFIG.LOG_LEVEL, the server half of the
   logging switch §2 describes.  */

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

     Each export is named by its FILE ID below, so there is no folder to scan
     and no guessing which file is which. Re-exporting over the same file is
     what the check watches: its modified time moves and that source syncs.
     A brand-new file needs its id pasted in here.

     All three must be shared with whoever the web app runs as. */
  QLIK_SYNC: {
    /* The three QlikView exports, BY FILE ID. Each one feeds exactly one
       page, so a re-export of the Aggregates file no longer costs a Ready-Mix
       and Slide Builder sync as well.

       These are the .xls files themselves, not folders and not the workbooks
       they are written into. QlikSync converts each to a temporary Google
       Sheet to read it and throws that away afterwards. */
    AGG_FILE_ID: '19ptynrhtzC-Noi71znNbVIJw8GDmPUxZ',   // → Price & Volume
    RMX_FILE_ID: '1wUb82e1PVxstddK9IE2VxYLSQEicVAGK',   // → Ready-Mix (main, extra, assoc)
    SEG_FILE_ID: '1d1XzYlENUyE6sxBewCd-Q3GpjTNzgRZH'    // → Slide Builder
  },


  /* Logo used by every page's PNG export. */
  LOGO_URL: 'https://www.amrize.com/content/dam/newco/global/logo-amrize.svg',

  /* Script-Property key prefix. A page's chosen sheet is stored as
     <PROP_PREFIX><page>, e.g.  DATA_SPREADSHEET_ID__pricevolume            */
  PROP_PREFIX: 'DATA_SPREADSHEET_ID__',

  /* How much the server logs. One of 'debug' | 'info' | 'warn' | 'error', or
     'off'. Read fresh on every APP_log call, so changing it here takes effect
     on the next execution with nothing to redeploy. See script.gs §2.
     'info' is the production setting: entry points and phase boundaries, and
     every error with its context. 'debug' adds the detail you only want while
     something is being investigated. */
  LOG_LEVEL: 'info',

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
 * USED — and the "NOT USED" that stood here was wrong. getOverview (§8) reads
 * OVERVIEW.MARKETS on every Overview load, the page's footer reports any PV
 * market missing from it as "unmapped", and app.html names it by name in that
 * hint. Deleting it empties the Executive Overview. Corrected in chunk 22.
 * ------------------------------------------------------------------
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
                                       'histagg2', 'histrmx2'],
                          /* The Deck Builder owns no sheet either - it photographs
                             the other tools' blocks. Without this its data version
                             would resolve to nothing at all and never move, so
                             "Update from source" would report "no change" however
                             stale the deck was. Same trap the Overview fell into;
                             see the note on APP_sourceIds_ in Code.gs.
                             The five deck sources reduce to these four workbooks:
                             pv + cust -> pricevolume (+ saskrates), seg + rmx ->
                             rmx and segment, fsc -> pricevolume, rfsc -> rmx. */
                          deckbuilder: ['pricevolume', 'rmx', 'segment', 'saskrates'] };

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



/* ---- §1 DECK — the template, the folder, and the list of slides -------------
   MOVED HERE FROM §9 IN CHUNK 22, unchanged. Both objects are read only from
   inside functions in §9, so nothing depends on where they sit — which is why
   they could come to the top at all, and the reason §1 is at the top in the
   first place.

   WHY THEY ARE NOT IN §9 ANY MORE. The Deck Builder is the one page whose
   configuration a business user is expected to edit: a new template, a new
   destination folder, a slide added to or dropped from the monthly pack. All of
   it lived at lines 10,281 and 10,968 of an 11,700-line file, behind the engine
   that reads it. §9 is that engine — the template reader, the deck writer, the
   geometry — and none of it moved.

   The two headers that explain the template contract and the recipe's columns
   stayed with the code as well, so §9 still reads as one piece; what is here is
   the part you change.  */

var DECK_CONFIG = {

  /* The template deck, as a GOOGLE SLIDES file (not the .pptx). */
  TEMPLATE_ID: '1_VsyemKcWKipvi9pKttwotZcJH8sz3s7iKRgvxd3OQo',

  /* Every generated deck is moved here. Share as Editor with the team. */
  FOLDER_ID: '1WRHFhA3e_1KO30sUpGaF6W35VCN5AToS',

  /* Script Property overrides, so the ⚙ Settings modal can point these
     somewhere else later without a code push. Same pattern as the per-page
     sheet IDs in Config.gs. */
  PROP_TEMPLATE: 'DECK_TEMPLATE_ID',
  PROP_FOLDER: 'DECK_FOLDER_ID',

  /* Tokens. Kept in one place so the page and the server cannot drift. */
  TOKENS: {
    title: '{{TITLE}}',
    comment: '{{COMMENT}}',
    image: '{{IMAGE}}',
    image2: '{{IMAGE2}}',
    label1: '{{LABEL1}}',
    label2: '{{LABEL2}}',
    page: '{{PAGE}}',
    deckTitle: '{{DECK_TITLE}}',
    deckSub: '{{DECK_SUB}}'
  },

  /* Speaker-note prefixes. */
  LAYOUT_TAG: 'LAYOUT:',
  SLIDE_TAG: 'SLIDE:',

  /* Layouts that are documentation, never used to build a slide. */
  DOC_LAYOUTS: ['L_README'],

  /* The cover. It is a layout like any other, but it is FILLED IN PLACE by
     create() rather than duplicated by addSlide, so it is not something a
     recipe row can point at. readTemplate still returns it (tagged
     role:'cover') so the page can preview it; the page builds its recipe
     picker from role:'report' only. It also carries {{DECK_TITLE}} /
     {{DECK_SUB}} instead of {{TITLE}}, which is why validateTemplate judges
     it against a different checklist. */
  COVER_LAYOUT: 'L_COVER',

  /* Capture resolution the page should aim for, expressed as pixels per POINT
     of slot width. Slides renders a 720pt-wide slide to ~1920px on a big
     screen (2.67 px/pt), so 4 leaves headroom without bloating the payload.
     DECK_readTemplate returns a suggested pixel width per slot using this. */
  CAPTURE_PX_PER_PT: 4,

  /* Hard ceiling on a single capture, so one huge table cannot blow up the
     request. The page should downscale to fit rather than send more.

     2048 IS NOT AN ARBITRARY ROUND NUMBER - it is where Google resamples.
     Whatever is inserted here, an exported deck comes back with every picture
     capped at 2048px on its LONGEST side; in the July build 21 of the 43
     pictures were exactly 2048 wide or exactly 2048 tall, across every aspect
     ratio in the deck. Asking for 2400 therefore did not buy 2400 - it bought a
     2400px canvas that Google then bilinear-resampled down to 2048, so text
     rendered at one scale was squeezed to another and every slide came out
     softer than the same table screenshotted by hand.

     Capturing at the ceiling instead means html2canvas RENDERS the text at its
     final size - one sampling, not two - and nothing downstream touches it. The
     page also clamps the capture's HEIGHT to this, because the cap applies to
     the longest side: an unclamped tall table used to have its height reduced
     to 2048 and its width dragged down with it. */
  CAPTURE_MAX_PX: 2048
};


/* WHAT A ROW MEANS, in one screen. The long version — why the Top 10 slides are
   L_FULL_IMAGE, which slides the source pack does not have and why that is
   copied rather than corrected — stayed with DECK_getRecipe in §9, because it is
   about the checker as much as the list.

     id        unique and STABLE. It is written into the generated slide's
               speaker notes as "SLIDE: <id>", which is how a re-run knows what
               already landed and how one failed slide is retried without
               rebuilding the deck. Never reuse an id for a different slide.
     source    which page produces the content. Must match an id registered with
               AmrDeckSource (app.html §E).
     market    passed straight through to that source, spelled THE WAY THAT PAGE
               SPELLS IT — the Southwest is 'Southwest' to Price & Volume and
               'HNS_SW' to Ready-Mix. OVERVIEW.MARKETS above is the mapping.
     refine    optional narrowing WITHIN that market (the Land / Docks split).
     period    'MTD' | 'YTD'. Omitted where the slide shows both.
     layout    a LAYOUT id from the template's own speaker notes.
     title     the real, editable Slides heading — not baked into the picture.
     optional  true = shown unticked in the Plan stage.

   ADDING, DROPPING OR REORDERING A SLIDE IS AN EDIT TO THIS ARRAY AND NOTHING
   ELSE. The page reads it, shows it as a checklist, and builds it top to bottom;
   DECK_getRecipe (§9) rejects a duplicate id or a row with no layout before the
   build starts rather than at slide 30 of 43. */

var DECK_RECIPE = [

  /* ---- Fuel Recovery (4) ------------------------------------------------ */
  { id:'fsc_mtd',   source:'fsc',  period:'MTD', layout:'L_FULL_IMAGE_SMALL_OR_FSC',
    group:'Fuel Recovery', title:'Agg - Fuel Recovery MTD' },
  { id:'fsc_ytd',   source:'fsc',  period:'YTD', layout:'L_FULL_IMAGE_SMALL_OR_FSC',
    group:'Fuel Recovery', title:'Agg - Fuel Recovery YTD' },
  { id:'rfsc_mtd',  source:'rfsc', period:'MTD', layout:'L_FULL_IMAGE_SMALL_OR_FSC',
    group:'Fuel Recovery', title:'Rmx - Fuel Recovery MTD' },
  { id:'rfsc_ytd',  source:'rfsc', period:'YTD', layout:'L_FULL_IMAGE_SMALL_OR_FSC',
    group:'Fuel Recovery', title:'Rmx - Fuel Recovery YTD' },

  /* ---- AGG Price & Volume, with the Top 10 slide after each market ------ */
  { id:'pv_cc_mtd',   source:'pv', market:'Central Canada', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', title:'AGG - CENTRAL CANADA - MTD' },
  { id:'pv_cc_ytd',   source:'pv', market:'Central Canada', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', title:'AGG - CENTRAL CANADA - YTD' },

  { id:'pv_sk_mtd',   source:'pv', market:'Saskatchewan', period:'MTD',
    layout:'L_COMMENT_IMAGE_NO_KPI', group:'AGG', title:'AGG - SASKATCHEWAN - MTD' },
  { id:'pv_sk_ytd',   source:'pv', market:'Saskatchewan', period:'YTD',
    layout:'L_COMMENT_IMAGE_NO_KPI', group:'AGG', title:'AGG - SASKATCHEWAN - YTD' },
  { id:'cust_sk',     source:'cust', market:'Saskatchewan',
    layout:'L_FULL_IMAGE', group:'AGG',
    title:'TOP 10 CUSTOMERS MTD & YTD - Saskatchewan' },

  { id:'pv_mb_mtd',   source:'pv', market:'Manitoba', period:'MTD',
    layout:'L_COMMENT_IMAGE_NO_KPI', group:'AGG', title:'AGG - MANITOBA - MTD' },
  { id:'pv_mb_ytd',   source:'pv', market:'Manitoba', period:'YTD',
    layout:'L_COMMENT_IMAGE_NO_KPI', group:'AGG', title:'AGG - MANITOBA - YTD' },
  { id:'cust_mb',     source:'cust', market:'Manitoba',
    layout:'L_FULL_IMAGE', group:'AGG',
    title:'TOP 10 CUSTOMERS MTD & YTD - Manitoba' },

  { id:'pv_gta_mtd',  source:'pv', market:'Greater Toronto Area', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', title:'AGG - GTA COMMERCIAL - MTD' },
  { id:'pv_gta_ytd',  source:'pv', market:'Greater Toronto Area', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', title:'AGG - GTA COMMERCIAL - YTD' },
  { id:'cust_gta',    source:'cust', market:'Greater Toronto Area',
    layout:'L_FULL_IMAGE', group:'AGG',
    title:'TOP 10 CUSTOMERS MTD & YTD - GTA' },

  { id:'pv_sw_mtd',   source:'pv', market:'Southwest', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', title:'AGG - Southwest - MTD' },
  { id:'pv_sw_ytd',   source:'pv', market:'Southwest', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'AGG', title:'AGG - Southwest - YTD' },

  /* Land and Docks are a Southwest breakdown, not every month's story. They
     are in the pack, they are a now also checked by defualt.

     THEY ARE NOT MARKETS. Land and Docks are the two values of the MB
     SUBMARKET column INSIDE the Southwest market - the same split the Price &
     Volume page offers as its Land / Docks chips. These rows used to say
     market:'Southwest Land', which matched no market at all, so both slides
     published a full page of zeroes instead of failing. `refine` is the label,
     never the sheet's raw spelling: the adapter matches it against the market's
     own MB SUBMARKET values, so a re-spelling in the sheet needs no edit here. */
  { id:'pv_swland_mtd',  source:'pv', market:'Southwest', refine:'Land', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'AGG',
    title:'AGG - Southwest Land - MTD' },
  { id:'pv_swland_ytd',  source:'pv', market:'Southwest', refine:'Land', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'AGG',
    title:'AGG - Southwest Land - YTD' },
  { id:'pv_swdocks_mtd', source:'pv', market:'Southwest', refine:'Docks', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'AGG',
    title:'AGG - Southwest Docks - MTD' },
  { id:'pv_swdocks_ytd', source:'pv', market:'Southwest', refine:'Docks', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'AGG',
    title:'AGG - Southwest Docks - YTD' },

  { id:'cust_sw',     source:'cust', market:'Southwest',
    layout:'L_FULL_IMAGE', group:'AGG',
    title:'TOP 10 CUSTOMERS MTD & YTD - SW' },

  /* ---- Ready-Mix. Per market: Segment/Product (commented), then P&V ----- */
  { id:'seg_sk_mtd',  source:'seg', market:'SASKATCHEWAN', period:'MTD',
    layout:'L_COMMENT_IMAGE_NO_KPI', group:'RMX', title:'RMX - SASKATCHEWAN - Commercial MTD' },
  { id:'seg_sk_ytd',  source:'seg', market:'SASKATCHEWAN', period:'YTD',
    layout:'L_COMMENT_IMAGE_NO_KPI', group:'RMX', title:'RMX - SASKATCHEWAN - Commercial YTD' },
  { id:'rmx_sk_mtd',  source:'rmx', market:'SASKATCHEWAN', period:'MTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - Saskatchewan - Commercial MTD' },
  { id:'rmx_sk_ytd',  source:'rmx', market:'SASKATCHEWAN', period:'YTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - Saskatchewan - Commercial YTD' },

  { id:'seg_mb_mtd',  source:'seg', market:'MANITOBA', period:'MTD',
    layout:'L_COMMENT_IMAGE_NO_KPI', group:'RMX', title:'RMX - MANITOBA - Commercial MTD' },
  { id:'seg_mb_ytd',  source:'seg', market:'MANITOBA', period:'YTD',
    layout:'L_COMMENT_IMAGE_NO_KPI', group:'RMX', title:'RMX - MANITOBA - Commercial YTD' },
  { id:'rmx_mb_mtd',  source:'rmx', market:'MANITOBA', period:'MTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - Manitoba - Commercial MTD' },
  { id:'rmx_mb_ytd',  source:'rmx', market:'MANITOBA', period:'YTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - Manitoba - Commercial YTD' },

  { id:'seg_sw_mtd',  source:'seg', market:'HNS_SW', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'RMX', title:'RMX - HNS SW - Commercial MTD' },
  { id:'seg_sw_ytd',  source:'seg', market:'HNS_SW', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'RMX', title:'RMX - HNS SW - Commercial YTD' },
  { id:'rmx_sw_mtd',  source:'rmx', market:'HNS_SW', period:'MTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - HNS_SW - Commercial MTD' },
  { id:'rmx_sw_ytd',  source:'rmx', market:'HNS_SW', period:'YTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - HNS_SW - Commercial YTD' },

  { id:'seg_inn_mtd', source:'seg', market:'Innocon', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'RMX', title:'RMX - INNOCON - Commercial MTD' },
  { id:'seg_inn_ytd', source:'seg', market:'Innocon', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'RMX', title:'RMX - INNOCON - Commercial YTD' },
  { id:'rmx_inn_mtd', source:'rmx', market:'Innocon', period:'MTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - Innocon - Commercial MTD' },
  { id:'rmx_inn_ytd', source:'rmx', market:'Innocon', period:'YTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - Innocon - Commercial YTD' },

  { id:'seg_no_mtd',  source:'seg', market:'North', period:'MTD',
    layout:'L_COMMENT_IMAGE', group:'RMX', title:'RMX - NORTH - Commercial MTD' },
  { id:'seg_no_ytd',  source:'seg', market:'North', period:'YTD',
    layout:'L_COMMENT_IMAGE', group:'RMX', title:'RMX - NORTH - Commercial YTD' },
  { id:'rmx_no_mtd',  source:'rmx', market:'North', period:'MTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - North - Commercial MTD' },
  { id:'rmx_no_ytd',  source:'rmx', market:'North', period:'YTD',
    layout:'L_FULL_IMAGE', group:'RMX', title:'RMX - North - Commercial YTD' },

  { id:'cust_no',     source:'cust', market:'North',
    layout:'L_FULL_IMAGE_SMALL_OR_FSC', group:'AGG',
    title:'TOP 10 CUSTOMERS MTD & YTD - North' }
];



/* ============================================================================
 * §2  LOGGING
 * ----------------------------------------------------------------------------
 * New in chunk 12. One helper, one output shape, one switch. Before the merge
 * there was no convention at all: 20 Logger.log calls, 15 console.log, 9
 * console.error, all hand-concatenated strings, no levels, no timings, and no way
 * to turn any of it down short of editing call sites.
 *
 *     APP_log(level, where, msg, data)     'debug' | 'info' | 'warn' | 'error'
 *
 * Deliberately the SAME signature and the same output shape as app.html's
 * AMR.log, so a server line and a browser line describing the two halves of one
 * request read alike and can be grepped with one pattern.
 *
 * WHAT A LINE CARRIES. Enough to answer "what was asked, what came back, how
 * long, and did it come from cache" without needing a second line:
 *
 *     where   RMX.getKeys, DECK.addSlide — the function, not the file
 *     the arguments that SELECT data — market, period, month, page. Not whole
 *             payloads: a log line is not a copy of the answer.
 *     rows    or bytes, for anything cached — the size of the answer
 *     ms      the only field that catches a regression nobody reported
 *     cache   'hit' | 'miss' | 'skip'
 *
 * WHY 'skip' IS ONE OF THE THREE. APP_cachePut_ bails silently above its chunk
 * ceiling, and a silent bail is indistinguishable from a cache that is simply
 * never warm. README §6 records the most expensive mistake this suite has had —
 * every RMX entry point pulling a 14 MB bundle through CacheService to produce a
 * 72 KB answer — and it hid for a long time because nothing about it looked
 * wrong. A line carrying ms and bytes would have shown a flat 15–24 s against a
 * varying question on the first read of the transcript.
 *
 * ---------------------------------------------------------------------------
 * THE SILENT-CATCH CENSUS  (chunk 18) — 36 of them, every one decided.
 * ---------------------------------------------------------------------------
 * §7's rule is that silent is right for an OPTIONAL CACHE READ and wrong for
 * everything else. Applying it gave two groups, and the group a catch is in is
 * the whole of the decision.
 *
 * COUNT THEM WITH `catch\s*\([a-z0-9]+\)\s*\{\s*\}`, NOT `catch (e) {}`.
 * The obvious grep says 31 and the real number is 36: five of them are nested
 * and bind e2 or e3, and every one of those five turned out to be in the group
 * that has to speak — including a fallback chain in PVLOOK.applyRows whose
 * FALLBACK was also silent, so both ways of invalidating the cache could fail
 * with the rows already written and nothing said.
 *
 *   12 STAY SILENT. All of them are a cache handle, read or write whose failure
 *      costs speed and nothing else — getLogo's copy, APP_oneStamp_'s three,
 *      APP_forgetStamp_'s handle, the permissions probe cleaning up after
 *      itself, the logo invalidation in PV.clearCache, and the two cPut_
 *      wrappers (which now delegate to an APP_cachePut_ that logs and cannot
 *      throw). Plus two that ARE reported by their own return value:
 *      qlikStamps prints "(never)" / "unreadable" in the answer a human is
 *      reading, and APP_permAnySheetId_'s inner loop, where a page with no
 *      sheet configured is an expected miss rather than a failure.
 *
 *   24 NOW SPEAK, and they fall into one shape: AN INVALIDATION THAT FAILED
 *      SILENTLY LOOKS EXACTLY LIKE NOTHING HAVING HAPPENED. syncAll's three
 *      clears, APP_forgetStamp_'s remove, both bumpGeneration_ stamp drops, the
 *      history-cube token, and — the one that is logged at ERROR rather than
 *      warn — QLIKSYNC.run's syncAll, where the pipeline SUCCEEDS, the sheets
 *      hold new numbers, and every page keeps serving the old ones out of cache
 *      while the run reports ok. Nothing else in the system notices that.
 *      The rest change an answer or leave state behind: two unreleased locks,
 *      two untrashed Drive files, the segment year fallback, four QlikView
 *      stamp reads whose failure silently re-syncs an export, and the two
 *      cache-key generation fallbacks — where '0' is not "no cache", it is a
 *      key EVERY generation shares, so an entry written under it outlives the
 *      data it describes. And getLogo's outer catch, which is the first place a
 *      missing script.external_request scope would ever show itself.
 *
 * Anything added here later gets the same question, and it is not a style one.
 *
 * WHERE TO LOG. At entry points and phase boundaries. NEVER inside a per-row
 * loop: the Ready-Mix bundle is 40,000 rows, so a line per row would cost more
 * than the work it describes and would bury the line that matters. One line when
 * a server entry point is called, one when it answers, one per expensive phase
 * inside it — that is the whole budget.
 *
 * ERRORS LOG THE CONTEXT, NOT JUST THE MESSAGE. Every catch that is not an
 * optional cache read writes `where` plus the selecting arguments.
 *
 * THE SWITCH. APP_CONFIG.LOG_LEVEL, one of the four levels or 'off'. It is read
 * on every call rather than captured, so changing it in §1 takes effect on the
 * next execution with nothing to redeploy.
 *
 * SCOPE NOTE, so the next agent does not read this section as a broken promise.
 * Chunk 12 moved 10,889 lines of working backend into this file and edited none
 * of them. The call sites that exist are in §4, the code chunk 12 WROTE. The
 * moved entry points do not log yet, and wiring them is its own chunk with its
 * own gate — PLAN.md §8, chunk 18. Adding log lines to hot moved code that no
 * harness covers, inside the largest single change this codebase has had, is
 * exactly the two-changes-at-once trap PLAN.md §10 exists to stop.
 * ============================================================================ */

/* ---- logging.gs --------------------------------------------------------------
   New in chunk 12. Nothing was moved here.  */

var APP_LOG_LEVELS_ = { debug: 10, info: 20, warn: 30, error: 40, off: 99 };

/* The threshold, read fresh on every call. An unrecognised setting is treated
   as 'info' rather than silently disabling the log. */
function APP_logLevel_() {
  var want = '';
  try { want = String((typeof APP_CONFIG !== 'undefined' && APP_CONFIG.LOG_LEVEL) || ''); }
  catch (e) { want = ''; }
  want = want.toLowerCase();
  return APP_LOG_LEVELS_[want] ? want : 'info';
}

/* Render one data object as `k=v k=v`, with the well-known fields first and in
   a fixed order so two lines for the same call site line up when read down the
   page. Anything with a length is logged as its SIZE, never its contents —
   that is the difference between a log line and a copy of the payload. */
function APP_logData_(data) {
  if (!data) return '';
  var FIRST = ['ms', 'rows', 'bytes', 'cache', 'page', 'market', 'period', 'month'];
  var seen = {}, out = [];

  function put(k) {
    if (seen[k] || !Object.prototype.hasOwnProperty.call(data, k)) return;
    seen[k] = true;
    var v = data[k];
    if (v == null) v = '';
    else if (typeof v === 'number') v = (v === Math.round(v)) ? String(v) : v.toFixed(1);
    else if (typeof v === 'object') v = (v.length != null) ? ('[' + v.length + ']') : '{…}';
    else { v = String(v); if (v.length > 200) v = v.slice(0, 200) + '…'; }
    out.push(k + '=' + v);
  }

  for (var i = 0; i < FIRST.length; i++) put(FIRST[i]);
  var rest = [];
  for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k) && !seen[k]) rest.push(k);
  rest.sort();
  for (var j = 0; j < rest.length; j++) put(rest[j]);
  return out.join(' ');
}

/* The one log call. Writes to console rather than Logger because
   appsscript.json already sets "exceptionLogging": "STACKDRIVER" — console
   carries a real severity into Cloud Logging, so warn and error can be
   filtered for, which is the whole point of having levels. */
function APP_log(level, where, msg, data) {
  try {
    level = String(level || 'info').toLowerCase();
    if (!APP_LOG_LEVELS_[level]) level = 'info';
    if (APP_LOG_LEVELS_[level] < APP_LOG_LEVELS_[APP_logLevel_()]) return;

    var line = '[' + (where || '?') + '] ' + (msg || '');
    var tail = APP_logData_(data);
    if (tail) line += '  ' + tail;

    if (level === 'error')      console.error(line);
    else if (level === 'warn')  console.warn(line);
    else                        console.log(line);
  } catch (e) {
    /* Logging must never be the thing that breaks a request. Deliberate. */
  }
}

/* Wrap a unit of work so its elapsed ms is logged without every call site
   having to hold a start time. Returns whatever fn returns; a throw is logged
   at 'error' with the same `where` and then re-thrown, so wrapping a call
   never swallows it. Mirrors AMR.log.timed in app.html. */
function APP_logTimed(where, msg, fn, data) {
  var t0 = Date.now(), out;
  try {
    out = fn();
  } catch (err) {
    var bad = {}; for (var b in data) bad[b] = data[b];
    bad.ms = Date.now() - t0; bad.error = String((err && err.message) || err);
    APP_log('error', where, msg + ' — threw', bad);
    throw err;
  }
  var ok = {}; for (var g in data) ok[g] = data[g];
  ok.ms = Date.now() - t0;
  APP_log('info', where, msg, ok);
  return out;
}




/* ============================================================================
 * §3  ROUTER + PLUMBING
 * ----------------------------------------------------------------------------
 * doGet and everything shared across pages: include, the logo, the data-generation
 * stamps every page watches for freshness, the chunked script cache, and the SB
 * reader the Overview's segment and product-category panels are built on.
 *
 * doGet is the one function Apps Script itself calls. It still reads ?page= and
 * still serves one page per load — PLAN.md §3 is explicit that this merge does not
 * turn the suite into a single-page app, because a regression then could not be
 * told apart from a new router. Chunk 13 is where doGet starts serving app.html
 * for every route and the ?page=app scaffold goes.
 * ============================================================================ */

/* ---- Code.gs -----------------------------------------------------------------
   Verbatim, less syncSlideData — see the hit-list note in PLAN.md §11.  */

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
/* Every route serves app.html. There is one client file and it mounts ONE page,
   chosen by <body data-page> — so doGet's whole job is to decide which page name
   to hand it, and there is no file to pick any more.

   ?page= is unchanged from the nine-file era on purpose: the same nine values
   reach the same nine screens, so a bookmark, a shared link or a browser history
   entry from before the merge still lands where it did. The ?page=app scaffold
   that carried the merged client while it was built is gone with the files it
   was hiding from; so is its &view=.

   AN UNKNOWN ?page= FALLS BACK TO THE LANDING PAGE rather than mounting nothing.
   app.html mounts by looking up data-page in its registry, and a name with no
   registration leaves #appRoot empty with no error — a blank screen, which reads
   as an outage rather than as a typo. PAGES is the same list app.html's §D
   switcher carries; the two are checked against each other by tests/merge.js. */
var APP_PAGES = ['landing', 'overview', 'pricevolume', 'rmx', 'segment',
                 'fuelsurcharge', 'rmxfuel', 'tp01', 'inventoryreport', 'deckbuilder'];

function doGet(e) {
  var asked = (e && e.parameter && e.parameter.page ? String(e.parameter.page) : '').toLowerCase();
  var page  = APP_PAGES.indexOf(asked) === -1 ? 'landing' : asked;
  if (asked && page !== asked) {
    APP_log('warn', 'doGet', 'unknown page, serving the landing page', { asked: asked });
  }

  /* Rendered through a template for one reason now: the deployed /exec URL. The
     client cannot derive it — a relative href inside the Apps Script sandbox
     iframe resolves against googleusercontent.com, not the web app — and it is
     read from a <body> data attribute rather than printed into JavaScript,
     because the printing scriptlet HTML-escapes and would break the script
     block. PLAN.md §8, chunk 2. */
  var t = HtmlService.createTemplateFromFile('app');
  t.appUrl = getAppUrl_();
  t.page   = page;

  return t.evaluate()
    .setTitle('Amrize Commercial Suite')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* The deployed web-app URL (…/exec). Pages append ?page=xxx to navigate. */
function getAppUrl_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

/* `include(name)` stood here and is gone at the cutover. It spliced one HTML
   partial into another, and every one of its 47 call sites was in a file this
   commit deletes — app.html's only mention of the name is a comment about a
   partial that had already been dropped. It cannot come back either: there is
   one client file now, so there is no second file to splice. */


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
  } catch (e3) {
    /* Not silent (§7). Returning '' renders every page with no logo and no
       reason given — and this is also the first place a missing
       script.external_request scope shows up, which §6 warns nothing else will
       tell you about. */
    APP_log('warn', 'APP.getLogo', 'could not fetch the logo — pages will render without it',
            { error: String(e3) });
  }
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


/* ------------------------------------------------------------------------
 * THE DATA VERSION IS THE SOURCE SHEET'S LAST-MODIFIED TIME.
 * ------------------------------------------------------------------------
 * It used to be a counter that something had to remember to bump. Anything
 * that changed the data without bumping it — someone typing a row into
 * REGION LOOKUP, someone fixing a number by hand — left every page serving
 * figures that no longer matched the sheet, with nothing anywhere to notice.
 * And a bump with no real change threw away every cache for nothing.
 *
 * Drive already tracks exactly the thing we mean. So the version is the
 * spreadsheet's modified time: it moves when, and only when, the data behind
 * a page actually changed — whoever changed it and however. A sync, a hand
 * edit, a pasted column: all the same, all automatic.
 *
 * The Drive lookup is cached for half a minute so the pages' freshness check
 * costs nothing to run often.
 * ---------------------------------------------------------------------- */
var APP_STAMP_TTL_S = 30;
var APP_STAMP_MEMO  = {};      /* within one execution */

function APP_stampKey_(id){ return 'srcmtime|' + id; }

/* Every workbook a page's figures depend on: its own, plus anything listed
   for it in APP_EXTRA_SOURCES. The Executive Overview has no sheet of its own
   — it reads Price & Volume, Ready-Mix and Segment — so on its own id it would
   resolve to nothing at all, report a version that never moves, and would sit
   on stale figures forever with Update from source insisting there was
   nothing to do. */
function APP_sourceIds_(page){
  var seen = {}, ids = [];
  function add(p){
    if (!p) return;
    var id;
    try { id = getSpreadsheetIdForPage_(APP_sheetOwner_(p)); } catch (e) { return; }
    if (id && !seen[id]) { seen[id] = 1; ids.push(id); }
  }
  add(page);
  var extra = (typeof APP_EXTRA_SOURCES === 'object' && APP_EXTRA_SOURCES[page]) || [];
  extra.forEach(add);
  return ids;
}

/* The version of one workbook: its modified time in ms, as a string. */
function APP_oneStamp_(id){
  if (APP_STAMP_MEMO[id]) return APP_STAMP_MEMO[id];

  var key = APP_stampKey_(id), c = null;
  try { c = CacheService.getScriptCache(); } catch (e) {}
  if (c) { try { var hit = c.get(key); if (hit) return (APP_STAMP_MEMO[id] = hit); } catch (e) {} }

  var ms = '';
  try { ms = String(DriveApp.getFileById(id).getLastUpdated().getTime()); } catch (e) { ms = ''; }
  if (ms) {
    APP_STAMP_MEMO[id] = ms;
    if (c) { try { c.put(key, ms, APP_STAMP_TTL_S); } catch (e) {} }
  }
  return ms;
}

/* The stamp for a page: every workbook behind it, joined. Moves when ANY of
   them does, which is what a page reading three sheets needs. */
function APP_sourceStamp_(page){
  var ids = APP_sourceIds_(page);
  if (!ids.length) return '';
  var parts = ids.map(APP_oneStamp_);
  return parts.join('-');
}

/* Read Drive again on the next ask rather than trusting the half-minute copy.
   Called after this app itself writes to a sheet, and by the Update button. */
function APP_forgetStamp_(page){
  var ids = [];
  if (page) ids = APP_sourceIds_(page);
  else {
    APP_dataPages_().forEach(function(p){
      APP_sourceIds_(p).forEach(function(id){ if (ids.indexOf(id) === -1) ids.push(id); });
    });
  }
  var c = null;
  try { c = CacheService.getScriptCache(); } catch (e) {}
  ids.forEach(function(id){
    delete APP_STAMP_MEMO[id];
    if (c) {
    try { c.remove(APP_stampKey_(id)); }
    catch (e) {
      /* NOT AN OPTIONAL READ — an invalidation (§7). Failing here means the
         stale stamp is served for the rest of its TTL, so ↻ Update from source
         answers "already up to date" about a sheet that has changed. */
      APP_log('warn', 'APP.forgetStamp', 'could not drop the cached stamp — the page may be told nothing changed',
              { page: id, error: String(e) });
    }
  }
  });
}

/* CODE BUILD STAMP - bump this whenever backend LOGIC changes.
   The stamp above tracks the DATA. A code fix leaves the data untouched, so
   without this every device would keep serving figures the OLD code computed
   and the fix would look like it did nothing. */
var APP_CODE_BUILD = '2026-08-17c';

function APP_getGen_(page) {
  return (APP_sourceStamp_(page) || '0') + '.' + APP_CODE_BUILD;
}

/* Kept because a dozen call sites use it after writing to a sheet. Nothing is
   bumped any more — the write itself moved the modified time — so all this
   has to do is stop us reading a stale copy of it. */
function APP_bumpGen_(page) {
  APP_forgetStamp_(page);
  return APP_getGen_(page);
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
  var t0 = Date.now();
  try {
    var s = JSON.stringify(obj), CH = 90000, n = Math.ceil(s.length / CH);
    if (n > 250) {
      /* THE SILENT BAIL THIS WHOLE FIELD EXISTS FOR. Above the chunk ceiling
         nothing is stored, so every later request recomputes — and from the
         outside that is indistinguishable from a cache that is simply never
         warm. README §6 is what that costs: every Ready-Mix entry point pulled
         a 14 MB bundle through CacheService to produce a 72 KB answer, for a
         long time, because nothing about it looked wrong. A flat elapsed time
         against a varying question is the tell, and it needs a line to be read
         off. warn, not debug: this is a cache that is not working. */
      APP_log('warn', 'APP.cachePut', 'too big to cache — every read will recompute',
              { cache: 'skip', bytes: s.length, chunks: n, limit: 250,
                ms: Date.now() - t0, key: key });
      return;
    }
    var m = {}; m[key + '__meta'] = String(n);
    for (var i = 0; i < n; i++) m[key + '__' + i] = s.substring(i * CH, (i + 1) * CH);
    CacheService.getScriptCache().putAll(m, 21600);
    APP_log('debug', 'APP.cachePut', 'stored',
            { cache: 'put', bytes: s.length, chunks: n, ms: Date.now() - t0, key: key });
  } catch (e) {
    /* NOT SILENT. §7's rule is that silent is right for an optional cache READ
       and wrong for everything else — a write that throws means every later
       request recomputes, which is the same outcome as the bail above and just
       as invisible. */
    APP_log('warn', 'APP.cachePut', 'write failed — every read will recompute',
            { cache: 'skip', ms: Date.now() - t0, key: key, error: String(e) });
  }
}
function APP_cacheGet_(key) {
  var t0 = Date.now();
  try {
    var c = CacheService.getScriptCache(), meta = c.get(key + '__meta');
    if (!meta) {
      APP_log('debug', 'APP.cacheGet', 'miss', { cache: 'miss', ms: Date.now() - t0, key: key });
      return null;
    }
    var n = parseInt(meta, 10), ids = [];
    for (var i = 0; i < n; i++) ids.push(key + '__' + i);
    var got = c.getAll(ids), parts = [];
    for (var j = 0; j < n; j++) {
      var p = got[key + '__' + j];
      if (p == null) {
        /* A PARTIAL IS NOT A MISS, and telling them apart matters. The meta
           key says n chunks and one of them has gone, so the whole entry is
           unusable — but something WAS stored, recently, and it was big enough
           to be worth storing. Reported as a miss to the caller, because that
           is what it is, and logged as its own thing because a run of these is
           an entry too big to survive its own TTL rather than a cold cache. */
        APP_log('warn', 'APP.cacheGet', 'partial — one chunk expired, the entry is unusable',
                { cache: 'miss', chunks: n, missingAt: j, ms: Date.now() - t0, key: key });
        return null;
      }
      parts.push(p);
    }
    var raw = parts.join('');
    var out = JSON.parse(raw);
    APP_log('debug', 'APP.cacheGet', 'hit',
            { cache: 'hit', bytes: raw.length, chunks: n, ms: Date.now() - t0, key: key });
    return out;
  } catch (e) {
    /* A read is the one case §7 says may be silent — but "may" is about not
       breaking the caller, and it still returns null and recomputes. Saying so
       at warn costs nothing and a run of them is a real signal. */
    APP_log('warn', 'APP.cacheGet', 'read failed — recomputing',
            { cache: 'miss', ms: Date.now() - t0, key: key, error: String(e) });
    return null;
  }
}


/* ========================================================================
 * GLOBAL SYNC — invalidate every page's cache at once
 * ====================================================================== */
function syncAll() {
  /* Nothing to bump: the version is the sheet's modified time, and whatever
     just changed the data moved it already. All this has to do is stop us
     answering from the half-minute copy of that time. */
  APP_forgetStamp_(null);
  try { PV.clearCache();          }
  catch (e) { APP_log('warn', 'APP.syncAll', 'could not clear PV.clearCache — Price & Volume keeps serving the report it built before the sync',
                      { error: String(e) }); }
  try { RMX_NS.bumpGeneration();  }
  catch (e) { APP_log('warn', 'APP.syncAll', 'could not clear RMX.bumpGeneration — every Ready-Mix cache key still points at the pre-sync generation',
                      { error: String(e) }); }
  try { CacheService.getScriptCache().remove('amrize_logo_datauri'); }
  catch (e) { APP_log('warn', 'APP.syncAll', 'could not clear logo — the logo stays as it was, which is cosmetic and the only one of the three that is',
                      { error: String(e) }); }
  return { ok: true, at: new Date().toISOString() };
}

/* ------------------------------------------------------------------------
 * ↻ UPDATE FROM SOURCE
 * ------------------------------------------------------------------------
 * Reads Drive again and reports the sheet's version. If it is the one the
 * page already has, the data has not changed and NOTHING is thrown away —
 * pressing the button on an unchanged sheet used to make every user rebuild
 * every table for no reason.
 * ---------------------------------------------------------------------- */
function updateFromSource(page, have) {
  page = String(page || '');
  APP_forgetStamp_(page);
  var gen = APP_getGen_(page);
  if (have && String(have) === gen) {
    return { ok: true, changed: false, generation: gen };
  }
  return { ok: true, changed: true, generation: gen };
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
  //
  // asText picks getDisplayValues() over getValues(). The Segment tabs are read
  // that way because Sheets turns a Bill Month like JUL-26 into a Date object
  // and only getDisplayValues() gives back the literal string.
  function readTab_(name, required, asText) {
    var sh = APP_openSpreadsheet_('segment').getSheetByName(name);
    if (!sh) {
      if (required) {
        throw new Error('Tab "' + name + '" was not found in the Slide Builder data sheet. ' +
          'Check the tab name in your Google Sheet (or update APP_CONFIG.PAGES.segment in Config.gs).');
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
  // Ready-Mix export's Bill Month column. That export carries every month of
  // the prior year ("Dec-25" against nothing this year), so the newest value
  // in it is always DECEMBER, and the page defaulted to December in August.
  // The stamp is still written (the sync report shows it) but it is no longer
  // what the picker starts on.
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




/* ============================================================================
 * §4  PERMISSIONS — the self-check
 * ----------------------------------------------------------------------------
 * New in chunk 12. Run APP_verifyPermissions() from the Apps Script editor after
 * pasting this file in. It prints one line per service and returns the same thing
 * as an object, so it is readable in the log and inspectable in the debugger.
 *
 * It has TWO jobs, and they are different problems.
 *
 * 1. FORCE THE SCOPES TO BE REQUESTED. Apps Script decides which OAuth scopes to
 *    ask for by STATICALLY SCANNING the code for service references. A service
 *    reached only down a rare branch can end up in the manifest or not, depending
 *    on how the scan reads it. This function names every service the suite uses,
 *    in plain code the scan cannot miss.
 *
 *    It is belt-and-braces alongside the explicit "oauthScopes" array now in
 *    appsscript.json, which is the reliable mechanism and which this project did
 *    not have committed at all before chunk 12.
 *
 *    AN EXPLICIT oauthScopes ARRAY REPLACES AUTO-DETECTION. Adding a service to
 *    this project now means adding its scope to appsscript.json by hand. Nothing
 *    will warn you: the call simply throws at runtime for every user. This
 *    function is how you find that out in one run instead of from a support
 *    message. Add the service here at the same time.
 *
 * 2. PROVE EACH ONE ACTUALLY WORKS, with a harmless read, returning a per-service
 *    verdict rather than dying on the first failure — so one missing grant cannot
 *    hide the other six. Nothing below writes, sends, creates or deletes
 *    anything. The one exception is CacheService, which writes and then reads
 *    back its own probe key under a name nothing else uses, because a cache you
 *    cannot write to is not a working cache.
 *
 * WHO IS RUNNING. appsscript.json pins "executeAs": "USER_DEPLOYING", which is
 * why TP01 mail is sent by the deployer and why getUserProperties() resolves to
 * the deployer for EVERYBODY — that is what makes the TP01 recipient map one
 * shared list (README §1). The check reports the effective user against the
 * active user so a wrong deployment setting is one line to read rather than
 * something inferred from whose name is on an email.
 *
 * THE SEVEN SCOPES, AND WHAT NEEDS EACH. JSON takes no comments, so this is the
 * only place the reasoning lives. Every one was traced to a real call, not
 * guessed — the CHECKS array below carries the same mapping in code, beside the
 * probe that proves it, so the two cannot drift apart.
 *
 *   auth/spreadsheets            SpreadsheetApp.openById — every page's data.
 *                                The project is NOT bound to a spreadsheet, so
 *                                the narrower "current document" scope is no use.
 *   auth/drive                   DriveApp getFileById / getFolderById /
 *                                createFile, AND the Drive v3 REST call in §5
 *                                that converts a QlikView export to a Sheet with
 *                                ScriptApp.getOAuthToken(). Full drive, not
 *                                drive.file: the files were not created by this
 *                                script.
 *   auth/presentations           SlidesApp.openById — the Deck Builder.
 *   auth/script.send_mail        MailApp.sendEmail — TP01 only. NOT the full
 *                                Gmail scope: GmailApp is referenced nowhere in
 *                                this file, and script.send_mail is the narrower
 *                                grant that covers sending with attachments.
 *   auth/script.external_request UrlFetchApp — the Amrize logo, and the Drive
 *                                REST call above.
 *   auth/script.scriptapp        ScriptApp.getService().getUrl(), which is what
 *                                getAppUrl_ in §3 builds every page link from.
 *                                Included deliberately even though it may be
 *                                reachable without it: if that URL comes back
 *                                empty, every link on the landing page goes
 *                                RELATIVE, and a relative href inside the Apps
 *                                Script sandbox iframe resolves against
 *                                googleusercontent.com — the page loads and then
 *                                navigates the user off the app. That failure
 *                                already shipped once (PLAN.md §8, chunk 2). An
 *                                extra line on the consent screen is the cheaper
 *                                side of that trade.
 *   auth/userinfo.email          Session.getActiveUser().getEmail(), which §10
 *                                stamps onto an archived KPI workbook, and the
 *                                effective-user line this check reports.
 *
 * CacheService, PropertiesService, LockService, Utilities and HtmlService need no
 * scope, which is why they carry "(none needed)" below rather than being left
 * out: a service that is checked and needs nothing is a different fact from a
 * service nobody remembered.
 * ============================================================================ */

/* ---- permissions.gs ----------------------------------------------------------
   New in chunk 12. Nothing was moved here.  */

function APP_verifyPermissions() {
  var t0 = Date.now();
  APP_log('info', 'APP.verifyPermissions', 'starting');

  var out = { ok: true, ran: new Date().toISOString(), who: {}, services: [], missing: [] };

  /* Who the script is running as. Not a scope check — context for every line
     below it, and the fastest way to see a wrong executeAs. */
  try { out.who.effective = Session.getEffectiveUser().getEmail() || '(none)'; }
  catch (e) { out.who.effective = 'unavailable — ' + APP_permErr_(e); }
  try { out.who.active = Session.getActiveUser().getEmail() || '(hidden)'; }
  catch (e) { out.who.active = 'unavailable — ' + APP_permErr_(e); }
  try { out.who.timeZone = Session.getScriptTimeZone(); }
  catch (e) { out.who.timeZone = 'unavailable'; }

  /* One entry per service: what it is for, and a read that proves the grant.
     Each `probe` returns a short string describing what came back. A probe
     that throws is caught by the runner, never by the probe. */
  var CHECKS = [
    { service: 'SpreadsheetApp', scope: 'auth/spreadsheets',
      usedFor: "every page's data",
      probe: function () {
        var id = APP_permAnySheetId_();
        if (!id) return 'no sheet configured to read — scope referenced, not proven';
        return 'opened "' + SpreadsheetApp.openById(id).getName() + '"';
      } },

    { service: 'DriveApp', scope: 'auth/drive',
      usedFor: 'KPI workbook folder, QlikView exports, history cube files, source modified-times',
      probe: function () {
        var id = (APP_CONFIG.KPI_FOLDER_ID || '');
        if (!id) return 'no KPI folder configured — scope referenced, not proven';
        var f = DriveApp.getFolderById(id);
        return 'read folder "' + f.getName() + '"';
      } },

    { service: 'MailApp', scope: 'auth/script.send_mail',
      usedFor: 'TP01 only — the per-market transfer-price workbooks',
      probe: function () {
        /* Reads the quota. Sends nothing. */
        return MailApp.getRemainingDailyQuota() + ' message(s) left in today’s quota';
      } },

    { service: 'SlidesApp', scope: 'auth/presentations',
      usedFor: 'Deck Builder — the template and every generated deck',
      probe: function () {
        var id = (typeof DECK_CONFIG !== 'undefined' && DECK_CONFIG.TEMPLATE_ID) || '';
        if (!id) return 'no deck template configured — scope referenced, not proven';
        return 'opened template "' + SlidesApp.openById(id).getName() + '"';
      } },

    { service: 'UrlFetchApp', scope: 'auth/script.external_request',
      usedFor: 'the Amrize logo, and the Drive REST call that converts a QlikView export',
      probe: function () {
        var r = UrlFetchApp.fetch(APP_CONFIG.LOGO_URL,
                  { muteHttpExceptions: true, followRedirects: true });
        return 'logo fetch returned HTTP ' + r.getResponseCode();
      } },

    { service: 'CacheService', scope: '(none needed)',
      usedFor: 'every cached report, and the chunked bundle cache',
      probe: function () {
        var k = 'APP_permcheck_' + Date.now(), c = CacheService.getScriptCache();
        c.put(k, 'ok', 60);
        var back = c.get(k);
        try { c.remove(k); } catch (e) {}
        if (back !== 'ok') throw new Error('wrote a probe key and read back ' + String(back));
        return 'wrote and read back a probe key';
      } },

    { service: 'PropertiesService', scope: '(none needed)',
      usedFor: 'per-page sheet overrides, TP01 recipients, QlikView sync stamps',
      probe: function () {
        var n = PropertiesService.getScriptProperties().getKeys().length;
        var u = PropertiesService.getUserProperties().getKeys().length;
        return n + ' script propert(ies), ' + u + ' user propert(ies)';
      } },

    { service: 'ScriptApp', scope: 'auth/script.scriptapp',
      usedFor: 'the deployment URL every page link is built from, and the Drive REST token',
      probe: function () {
        var url = '';
        try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
        var tok = ScriptApp.getOAuthToken();
        return (url ? 'web app URL resolved' : 'NO web app URL — every page link would be relative')
             + ', OAuth token ' + (tok ? 'issued' : 'MISSING');
      } },

    { service: 'LockService', scope: '(none needed)',
      usedFor: 'the QlikView sync, and the lookup writers',
      probe: function () {
        var l = LockService.getScriptLock(), got = l.tryLock(1000);
        if (got) l.releaseLock();
        return got ? 'took and released the script lock'
                   : 'lock is held right now (a sync may be running) — the service works';
      } },

    { service: 'Session', scope: 'auth/userinfo.email',
      usedFor: 'the script timezone, and who archived a KPI workbook',
      probe: function () {
        return 'timezone ' + Session.getScriptTimeZone()
             + ', effective user ' + (out.who.effective || '?');
      } }
  ];

  for (var i = 0; i < CHECKS.length; i++) {
    var c = CHECKS[i], row = { service: c.service, scope: c.scope, usedFor: c.usedFor };
    var t1 = Date.now();
    try {
      row.detail = String(c.probe());
      row.ok = true;
    } catch (e) {
      row.ok = false;
      row.detail = APP_permErr_(e);
      out.ok = false;
      out.missing.push(c.service);
    }
    row.ms = Date.now() - t1;
    out.services.push(row);
    APP_log(row.ok ? 'info' : 'error', 'APP.verifyPermissions', c.service,
            { ms: row.ms, ok: row.ok, detail: row.detail });
  }

  /* The readable version. Logger rather than console: this one is meant to be
     read in the editor's own log pane, right after you press Run. */
  var lines = [];
  lines.push('APP_verifyPermissions  —  ' + out.ran);
  lines.push('');
  lines.push('  running as   : ' + out.who.effective + '   (executeAs: USER_DEPLOYING)');
  lines.push('  active user  : ' + out.who.active);
  lines.push('  timezone     : ' + out.who.timeZone);
  lines.push('');
  for (var j = 0; j < out.services.length; j++) {
    var s = out.services[j];
    lines.push('  ' + (s.ok ? 'OK  ' : 'FAIL') + '  ' + APP_permPad_(s.service, 18)
               + APP_permPad_(s.scope, 30) + s.detail);
  }
  lines.push('');
  lines.push(out.ok ? '  Every service answered. Nothing is missing.'
                    : '  MISSING OR BROKEN: ' + out.missing.join(', ')
                      + '\n  Add the scope to appsscript.json oauthScopes, save, and re-authorise.');
  var report = lines.join('\n');
  out.report = report;
  Logger.log(report);

  APP_log(out.ok ? 'info' : 'error', 'APP.verifyPermissions', 'done',
          { ms: Date.now() - t0, ok: out.ok, missing: out.missing.length });
  return out;
}

/* The first sheet id any page resolves to, so the SpreadsheetApp probe reads
   something real rather than a hard-coded id that can rot. Settings overrides
   are honoured, which is the point — it proves the sheet the app will actually
   open, not the one in the code default. */
function APP_permAnySheetId_() {
  try {
    var pages = APP_dataPages_();
    for (var i = 0; i < pages.length; i++) {
      try {
        var id = getSpreadsheetIdForPage_(pages[i]);
        if (id) return id;
      } catch (e) {}      /* a page with no sheet configured is an expected miss */
    }
  } catch (e) {
    APP_log('warn', 'APP.permAnySheetId', 'no sheet to probe with — the SpreadsheetApp check ' +
            'below cannot prove anything', { error: String(e) });
  }
  return '';
}

/* Apps Script permission failures carry the useful part in the message, and
   the stack is noise in a report meant to be read in one glance. */
function APP_permErr_(e) {
  var m = String((e && e.message) || e || 'unknown error');
  return m.length > 300 ? m.slice(0, 300) + '…' : m;
}

function APP_permPad_(s, n) {
  s = String(s == null ? '' : s);
  while (s.length < n) s += ' ';
  return s;
}




/* ============================================================================
 * §5  SYNC
 * ----------------------------------------------------------------------------
 * The QlikView → Sheets pipeline. Three exports in Drive, each named by file id
 * in §1, each feeding exactly one page — so a re-exported Aggregates file costs
 * an Aggregates sync and nothing else.
 *
 * This section is the ENGINE. What starts it lives in §11 with the other entry
 * points nothing in this repo calls — the trigger list and the Run menu are both
 * outside the repo, and that is precisely why they get their own signposted
 * section rather than being left to a grep to find.
 *
 * IT HAS NO UI, AND THAT IS A DECISION. There is no ⇣ Pull from QlikView button
 * and there never was. A page that could start a sync would put a minutes-long
 * Drive job behind a button any user could press twice. See PLAN.md §11.
 * ============================================================================ */

/* ---- QlikSync.gs -------------------------------------------------------------
   The QLIKSYNC engine. Its four entry points are in §11.  */

/*****************************************************************************
 * QlikSync.gs — pull the QlikView exports straight out of Drive and replace
 *               the data in each tool's Google Sheet.
 * ---------------------------------------------------------------------------
 * WHAT IT DOES
 *   Three QlikView exports, each named by FILE ID in Config.gs, each feeding
 *   exactly one page:
 *
 *     AGG_FILE_ID  →  Price & Volume workbook
 *                       Combined Data CPI Raw
 *                       Combined Data CPI Other Revenue
 *     RMX_FILE_ID  →  Ready-Mix workbook   (the Margin Monitor export)
 *                       Main Raw Data · Extra Raw Data · Associate Raw Data
 *     SEG_FILE_ID  →  Slide Builder workbook (the Segment/Product export)
 *                       Slide Segment MTD / YTD
 *                       Slide Product <Market> MTD / YTD
 *
 *   One file per page means a re-exported Aggregates file costs an Aggregates
 *   sync and nothing else.
 *
 * HOW A TAB IS REPLACED
 *   Two modes, chosen per tab in SPEC below.
 *
 *   'columns'  The raw-data tabs. Their layout does not match the export:
 *              different column ORDER, extra columns the export never sends
 *              (LOOKUP KEY, Month, CY/PY Fuel Surcharge …), and banner rows
 *              above the header. So we match COLUMN BY COLUMN on the header
 *              name, write only the columns the export actually feeds, and
 *              leave every other column — including all the formulas — alone.
 *
 *   'replace'  The Slide Builder tabs. No formulas, no extra columns: the tab
 *              is cleared and rewritten from the export as-is.
 *
 * FORMULAS
 *   The raw tabs are driven by single-cell ARRAY formulas sitting in the first
 *   data row (LOOKUP KEY, Month, the fuel-surcharge splits, the totals). They
 *   carry a hard-coded last row — "A3:A50040". If the new export is longer than
 *   that, everything past the old end silently gets nothing. So after writing,
 *   every anchor formula is re-pointed at the FULL height of its sheet, and
 *   cross-sheet references are re-pointed at the full height of the sheet they
 *   name. The blank-row guards already in those formulas do the rest.
 *
 * ROWS
 *   Grow only. If the export is taller than the sheet, rows are inserted; if it
 *   is shorter, the surplus is cleared but the rows stay. Nothing is ever
 *   deleted out from under a formula.
 *
 * SETUP
 *   The three file ids live in Config.gs → APP_CONFIG.QLIK_SYNC.
 *   Nothing else to enable: the Drive REST copy below runs on the script's own
 *   OAuth token, so the Advanced Drive Service does NOT need to be turned on.
 *
 * TRIGGERS
 *   ONE time-driven trigger on qlikSyncCheck. Every firing compares each
 *   export's modified time against the
 *   one it last synced and does nothing at all for the ones that have not
 *   moved — so an ordinary firing is three Drive lookups.
 *
 *   Run qlikMarkCurrent() ONCE after setting the trigger up. Without it the
 *   first firing has nothing to compare, treats all three exports as new and
 *   syncs every one of them.
 *
 *   qlikStamps() shows what the next check will compare, and what it will do.
 *
 *   Nothing in the UI starts a sync.
 *
 * NOTE — no validation yet. This copies what the export says, as the export
 * says it. Reconciliation checks come later.
 *****************************************************************************/

var QLIKSYNC = (function () {

  /* =====================================================================
   * 0. small helpers
   * =================================================================== */

  /* Header names are compared loosely: case, non-breaking spaces, doubled
     spaces and stray padding all vary between QlikView exports and the sheet
     ("2025  CM2" vs "2025 CM2", " CY vs PY" vs "CY vs PY"). */
  function norm_(v) {
    return String(v == null ? '' : v)
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function isBlankRow_(row) {
    for (var i = 0; i < row.length; i++) {
      var v = row[i];
      if (v !== '' && v != null) return false;
    }
    return true;
  }

  /* Trailing blank rows are common in converted exports. */
  function trimGrid_(rows) {
    var end = rows.length;
    while (end > 0 && isBlankRow_(rows[end - 1])) end--;
    return rows.slice(0, end);
  }

  /* The header row of an EXPORT tab: the first row carrying a few names.
     QlikView puts it on row 1, but this survives a title row appearing. */
  function srcHeaderRow_(values) {
    for (var r = 0; r < Math.min(6, values.length); r++) {
      var filled = 0;
      for (var c = 0; c < values[r].length; c++) if (norm_(values[r][c])) filled++;
      if (filled >= 3) return r;
    }
    return 0;
  }

  /* Contiguous runs of non-empty cells across one row of a grid, as
     { start (0-based), len }. A band of array formulas sits in a handful of
     adjacent columns, so clearing and restoring it a RUN at a time is a few
     calls per row instead of one per cell — see the note on the six minutes
     below for why that difference decides whether a trigger survives. */
  function cellRuns_(rowArr) {
    var out = [], i = 0;
    while (i < rowArr.length) {
      if (!rowArr[i]) { i++; continue; }
      var s = i;
      while (i < rowArr.length && rowArr[i]) i++;
      out.push({ start: s, len: i - s });
    }
    return out;
  }


  /* =====================================================================
   * 1. WHERE EACH COLUMN GOES
   * ---------------------------------------------------------------------
   * Only the names that DIFFER need listing. Everything else matches
   * outright ("2026 Vol" → "2026 Vol"). Left = the export's name,
   * right = the tab's name.
   * =================================================================== */

  /* SYNONYMS — names that mean the same column on either side.
     The month column is the case that needs it: QlikView exports it as
     `bill_month`, the sheet's header spells it "Bill Month", and norm_ only
     folds case and whitespace — not underscores — so the two would otherwise
     never match. Both carry the year ("Apr-25" / "Apr-26"), one year per row. */
  var SYNONYM = {
    'bill month': 'monthcol', 'billmonth':   'monthcol', 'bill_month': 'monthcol'
  };
  function canon_(name) { return SYNONYM[name] || name; }
  function isMonthCol_(name) { return canon_(name) === 'monthcol'; }

  /* Extras + Associates: the export names the year first, the sheet last. */
  var ALIAS_EXTRA = {
    'plant_descr':                  'Plant',
    '2025 revenue':                 'Total Revenue - 2025',
    '2026 revenue':                 'Total Revenue - 2026',
    '2025 revenue (m3 applied to)': 'Revenue (M3 Applied To) - 2025',
    '2026 revenue (m3 applied to)': 'Revenue (M3 Applied To) - 2026',
    '2025 m3 applied to':           'M3 Applied To - 2025',
    '2026 m3 applied to':           'M3 Applied To - 2026'
  };

  /* Main Raw Data and both AGG tabs use the same names on both sides. */
  var ALIAS_NONE = {};


  /* =====================================================================
   * 2. WHICH EXPORT TAB FEEDS WHICH SHEET TAB
   * ---------------------------------------------------------------------
   *   folder  'AGG' | 'RMX' | 'SEG' — which export file it comes from
   *   page    the Config.gs page id whose workbook owns the tab
   *   tab     the tab name in that workbook
   *   mode    'columns' (map by header, keep formulas) | 'replace' (wipe)
   *   srcTab  match the export tab by NAME (the Slide Builder export names
   *           its tabs); otherwise…
   *   match   …match by the header names the export tab must contain
   *   pick    tie-breaker when two export tabs look identical
   * =================================================================== */

  function buildSpec_() {
    var SPEC = [

      /* ---- AGG folder → Price & Volume ---- */
      { folder: 'AGG', page: 'pricevolume', tab: 'Combined Data CPI Raw',
        mode: 'columns', alias: ALIAS_NONE,
        match: ['year', 'month', 'plant type', 'material family', 'fuel surchage'] },

      { folder: 'AGG', page: 'pricevolume', tab: 'Combined Data CPI Other Revenue',
        mode: 'columns', alias: ALIAS_NONE,
        match: ['year', 'month', 'other revenue'] },

      /* ---- RMX folder → Ready-Mix ---- */
      /* stampMonth: this is the export that says which month everything is
         for. The Slide Builder's Segment tabs arrive pre-split into MTD and
         YTD with no Bill Month of their own, so its month picker takes its
         default from here. */
      { folder: 'RMX', page: 'rmx', tab: 'Main Raw Data',
        mode: 'columns', alias: ALIAS_NONE, stampMonth: true,
        match: ['bill month', 'plant', 'product mix', 'major project segment'] },

      /* Extras and Associates are the SAME shape — identical headers, so the
         header fingerprint cannot tell them apart. What separates them is the
         content: the fuel surcharge only ever appears on the Extras side, and
         Main Raw Data's surcharge formula reads it from there. */
      { folder: 'RMX', page: 'rmx', tab: 'Extra Raw Data',
        mode: 'columns', alias: ALIAS_EXTRA,
        match: ['bill_month', 'mat_prod_hier_3', 'mat_descr'], pick: 'extras' },

      { folder: 'RMX', page: 'rmx', tab: 'Associate Raw Data',
        mode: 'columns', alias: ALIAS_EXTRA,
        match: ['bill_month', 'mat_prod_hier_3', 'mat_descr'], pick: 'assoc' },

      /* ---- RMX folder → Slide Builder ----
         The export already splits MTD and YTD and is already summed to
         Segment x Market, so there is no Bill Month column any more and no
         per-month repetition: 29 rows, not 400. */
      { folder: 'SEG', page: 'segment', tab: 'Slide Segment MTD',
        mode: 'replace', srcTab: 'Summary MTD' },
      { folder: 'SEG', page: 'segment', tab: 'Slide Segment YTD',
        mode: 'replace', srcTab: 'Summary YTD' }
    ];

    /* One product tab per market per period. The export names them by market
       key ("HNS_SW MTD"); the workbook names them by label ("Slide Product
       HNS MTD"). Both lists live in Config.gs, so adding a market is a config
       change, not a code change. Marked optional: a market with no tab yet is
       reported and skipped, never fatal. */
    var seg     = APP_CONFIG.PAGES.segment || {};
    var markets = seg.MARKETS || [];
    var labels  = seg.MARKET_LABEL || {};
    markets.forEach(function (m) {
      ['MTD', 'YTD'].forEach(function (p) {
        SPEC.push({
          folder: 'SEG', page: 'segment',
          tab:    'Slide Product ' + (labels[m] || m) + ' ' + p,
          mode:   'replace',
          srcTab: m + ' ' + p,
          optional: true
        });
      });
    });

    return SPEC;
  }


  /* =====================================================================
   * 3. DRIVE → a readable grid
   * ---------------------------------------------------------------------
   * Apps Script cannot read .xls / .xlsx directly. Drive can convert one to a
   * Google Sheet in a single REST call; we read it, then throw the copy away.
   * Using the REST endpoint (rather than the Advanced Drive Service) means
   * there is no service to switch on in the editor.
   * =================================================================== */

  var EXCEL_MIME = {
    'application/vnd.ms-excel': 1,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 1,
    'application/vnd.google-apps.spreadsheet': 1
  };

  /* Convert to a temporary Google Sheet and return the new file id. */
  function convertToSheet_(fileId, name) {
    var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) +
              '/copy?supportsAllDrives=true&fields=id';
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        name: '~qliksync temp — ' + name,
        mimeType: MimeType.GOOGLE_SHEETS
      }),
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      throw new Error('Drive could not convert "' + name + '" to a Google Sheet. ' +
        'Response ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    }
    return JSON.parse(res.getContentText()).id;
  }

  function trashFile_(fileId) {
    try { DriveApp.getFileById(fileId).setTrashed(true); }
  catch (e) { APP_log('warn', 'APP.trashFile', 'could not trash the file — it stays in the folder',
                      { fileId: fileId, error: String(e) }); }
  }

  /* Every tab of one export, as { name, hdr:[normalised], raw:[…], rows:[…] } */
  function readExport_(file) {
    var tempId = null, books = [];
    try {
      var ssId = (file.mime === 'application/vnd.google-apps.spreadsheet')
                 ? file.id
                 : (tempId = convertToSheet_(file.id, file.name));
      var ss = SpreadsheetApp.openById(ssId);
      ss.getSheets().forEach(function (sh) {
        var values = sh.getDataRange().getValues();
        if (!values.length) return;
        var h = srcHeaderRow_(values);
        books.push({
          file:  file.name,
          name:  sh.getName(),
          hdr:   values[h].map(norm_),
          rows:  trimGrid_(values.slice(h + 1)),
          hdrRaw: values[h]
        });
      });
    } finally {
      if (tempId) trashFile_(tempId);
    }
    return books;
  }


  /* =====================================================================
   * 4. PICK THE RIGHT EXPORT TAB
   * =================================================================== */

  /* Extras and Associates arrive with IDENTICAL headers, so the header
     fingerprint cannot separate them. Their mat_prod_hier_3 category lists,
     though, do not overlap at all — the numeric prefixes collide ("4 :
     Conveyors/Pumps" vs "4 : Steel Fibers") but the wording never does. Score a
     tab against both lists and take whichever side it leans to, rather than
     resting the whole decision on one category being present. */
  var HIER_EXTRA = [
    /fuel\s*surcharge/i, /environmental/i, /freight|deliver/i,
    /afterhours|after\s*hours|opening/i, /conveyor|pump/i,
    /winter|summer|handling/i, /truck\s*rental/i, /cooling/i
  ];
  var HIER_ASSOC = [
    /admixture/i, /colou?r\b/i, /steel\s*fib/i, /polypropylene|poly\s*fib/i,
    /accelerator/i, /concrete\s*block/i, /yard|stone|sand/i, /retarder/i,
    /water\s*reduc/i, /air\s*entrain/i
  ];

  /* How strongly a tab reads as Extras (positive) or Associates (negative). */
  function hierLean_(tab) {
    var c = tab.hdr.indexOf('mat_prod_hier_3');
    if (c === -1) return 0;

    var seen = {}, n = Math.min(tab.rows.length, 6000);
    for (var i = 0; i < n; i++) {
      var v = String(tab.rows[i][c] == null ? '' : tab.rows[i][c]).trim();
      if (v) seen[v] = 1;
    }
    var lean = 0;
    Object.keys(seen).forEach(function (cat) {
      var e = 0, a = 0, j;
      for (j = 0; j < HIER_EXTRA.length; j++) if (HIER_EXTRA[j].test(cat)) e = 1;
      for (j = 0; j < HIER_ASSOC.length; j++) if (HIER_ASSOC[j].test(cat)) a = 1;
      lean += e - a;                      /* a category matching both counts 0 */
    });
    return lean;
  }

  function pickSource_(tabs, spec) {
    var i, cands = [];

    /* Named tab (the Slide Builder export). */
    if (spec.srcTab) {
      var want = norm_(spec.srcTab);
      for (i = 0; i < tabs.length; i++) if (norm_(tabs[i].name) === want) return tabs[i];
      return null;
    }

    /* Otherwise fingerprint on the header names. */
    for (i = 0; i < tabs.length; i++) {
      var ok = true;
      var canonHdr = tabs[i].hdr.map(canon_);
      for (var m = 0; m < spec.match.length; m++) {
        if (canonHdr.indexOf(canon_(norm_(spec.match[m]))) === -1) { ok = false; break; }
      }
      if (ok) cands.push(tabs[i]);
    }
    if (!cands.length) return null;
    if (cands.length === 1) return cands[0];

    if (spec.pick === 'extras' || spec.pick === 'assoc') {
      var best = cands[0], bestLean = hierLean_(cands[0]);
      for (i = 1; i < cands.length; i++) {
        var lean = hierLean_(cands[i]);
        if (spec.pick === 'extras' ? (lean > bestLean) : (lean < bestLean)) {
          best = cands[i]; bestLean = lean;
        }
      }
      return best;
    }
    return cands[0];
  }


  /* =====================================================================
   * 5. FORMULAS — find them, and re-point them at the new sheet height
   * =================================================================== */

  /* A1 ranges, with an optional sheet prefix. Whole-column refs ($K:$K) carry
     no row numbers and are left untouched — they already cover everything. */
  var RANGE_RE = /(?:'((?:[^']|'')+)'!|([A-Za-z0-9_]+)!)?(\$?[A-Z]{1,3}\$?)(\d+):(\$?[A-Z]{1,3}\$?)(\d+)/g;

  function reanchor_(formula, ownEnd, endsByTab) {
    return String(formula).replace(RANGE_RE,
      function (whole, quoted, bare, c1, r1, c2, r2) {
        var tab = quoted || bare || null;
        var end = ownEnd;
        if (tab) {
          var key = norm_(String(tab).replace(/''/g, "'"));
          if (!(key in endsByTab)) return whole;      // a sheet we do not touch
          end = endsByTab[key];
        }
        var prefix = tab ? (quoted ? "'" + quoted + "'!" : bare + '!') : '';
        return prefix + c1 + r1 + ':' + c2 + end;
      });
  }

  /* Where the data actually starts.
     Not always header + 1: "Combined Data CPI Other Revenue" keeps a totals row
     between its header and its first record, and that totals row holds a
     formula, so "first row with a formula" is not enough on its own.

     What IS reliable is that the LOOKUP KEY / Month array formulas sit exactly
     on the first data row, and they live in columns the export never feeds. So:
     the first row under the header carrying a formula in a column NOTHING is
     being written into. Failing that (a tab with no formulas), the first row
     where the mapped columns are actually populated. */
  function firstDataRow_(sh, hdrRow, mappedCols, nCols) {
    var span = Math.min(sh.getMaxRows(), hdrRow + 4) - hdrRow;
    if (span <= 0) return hdrRow + 1;

    var isMapped = {};
    mappedCols.forEach(function (c) { isMapped[c] = 1; });

    var f = sh.getRange(hdrRow + 1, 1, span, nCols).getFormulas();
    for (var r = 0; r < span; r++) {
      for (var c = 0; c < f[r].length; c++) {
        if (f[r][c] && !isMapped[c + 1]) return hdrRow + 1 + r;
      }
    }

    var v = sh.getRange(hdrRow + 1, 1, span, nCols).getValues();
    var need = Math.ceil(mappedCols.length / 2);
    for (var r2 = 0; r2 < span; r2++) {
      var filled = 0;
      for (var i = 0; i < mappedCols.length; i++) {
        var val = v[r2][mappedCols[i] - 1];
        if (val !== '' && val != null) filled++;
      }
      if (filled >= need) return hdrRow + 1 + r2;
    }
    return hdrRow + 1;
  }


  /* =====================================================================
   * 6. WRITE — 'columns' mode
   * =================================================================== */

  /* The sheet's header row: the one that matches the most export names.
     The raw tabs carry a banner row above it ("Bill Year | 2025 | 2025 …",
     or the totals row on Main Raw Data). */
  function tgtHeaderRow_(probe, wanted) {
    var best = 0, bestScore = -1;
    for (var r = 0; r < probe.length; r++) {
      var score = 0;
      for (var c = 0; c < probe[r].length; c++) {
        if (wanted[canon_(norm_(probe[r][c]))]) score++;
      }
      if (score > bestScore) { bestScore = score; best = r; }
    }
    return { row: best + 1, score: bestScore };
  }

  /* Contiguous runs of column indexes, so we write one block per run instead
     of one call per column. */
  function runs_(cols) {
    var s = cols.slice().sort(function (a, b) { return a - b; }), out = [];
    for (var i = 0; i < s.length; i++) {
      if (out.length && s[i] === out[out.length - 1].end + 1) out[out.length - 1].end = s[i];
      else out.push({ start: s[i], end: s[i] });
    }
    return out;
  }

  /* The Bill Month cell as { y, m } (m is 0-based) — used to work out which
     month the exports are for, so the Slide Builder's month picker can default
     to it. A value carrying no year is not readable and returns null. */
  function monthYM_(v) {
    var MON = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
                jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
    var d = null, m;
    if (Object.prototype.toString.call(v) === '[object Date]') d = v;
    else if (typeof v === 'number') d = new Date(Math.round((v - 25569) * 86400000));
    if (d) return { y: d.getFullYear(), m: d.getMonth() };

    var s = String(v == null ? '' : v).trim();

    var mt = s.match(/^([A-Za-z]{3,})[\s\-\/.]*(\d{2,4})$/);
    if (!mt) return null;
    m = MON[mt[1].slice(0, 3).toLowerCase()];
    if (m === undefined) return null;
    var y = parseInt(mt[2], 10); if (y < 100) y += 2000;
    return { y: y, m: m };
  }

  /* The latest month the export actually carries.

     NOT CAPPED at last calendar month. A Bill Month ("Dec-25") names its own
     year and is not ambiguous, so the newest value is taken literally — the
     2024-2023 and 2025-2024 history workbooks are in this format too, and a
     closed year legitimately ends in December.

     This stamp is informational: it is written to QLIK_REPORT_MONTH and shown
     in the sync report, but the Product Segment page works its reporting month
     out from the calendar (see Code.gs reportMonth_) rather than reading it. */
  function latestMonth_(src, col) {
    var best = null;
    for (var i = 0; i < src.rows.length; i++) {
      var ym = monthYM_(src.rows[i][col]);
      if (!ym) continue;
      if (!best || ym.y > best.y || (ym.y === best.y && ym.m > best.m)) best = ym;
    }
    return best;
  }

  /* The month column is stored as TEXT, never a date — a real date in that cell
     is what makes the year hide in the day field.

     Bill Month keeps its year ("Aug-25"): the year is what tells every reader
     which of the two year-columns the row's figures belong to, so it must
     never be dropped. A string goes through untouched, which is the normal
     case; only a value that arrived as a date or an Excel serial has to be
     formatted back into "MMM-yy". */
  function monthText_(v) {
    if (v === '' || v == null) return '';
    var fmt = 'MMM-yy';
    if (Object.prototype.toString.call(v) === '[object Date]') {
      return Utilities.formatDate(v, Session.getScriptTimeZone(), fmt);
    }
    if (typeof v === 'number') {                        // Excel serial
      var d = new Date(Math.round((v - 25569) * 86400000));
      return Utilities.formatDate(d, 'UTC', fmt);
    }
    return String(v);
  }

  function writeColumns_(sh, src, spec, plan) {
    var nCols = sh.getMaxColumns();

    /* --- where the header sits, and what each export column maps to --- */
    var wanted = {};
    src.hdr.forEach(function (h) {
      if (!h) return;
      wanted[canon_(norm_(spec.alias[h] || h))] = 1;
    });

    var probeRows = Math.min(8, sh.getMaxRows());
    var probe = sh.getRange(1, 1, probeRows, nCols).getValues();
    var head  = tgtHeaderRow_(probe, wanted);
    var hdrRow = head.row;
    /* compared in canonical form, so "bill_month" finds a "Bill Month" column */
    var tgtHdr = probe[hdrRow - 1].map(function (h) { return canon_(norm_(h)); });

    /* Export column  →  sheet column (1-based). Names first; where a name is
       repeated or blank on either side, fall back to the same position. */
    var pairs = [], used = {}, unmatched = [];
    function countOf(arr, v) { var n = 0; for (var i = 0; i < arr.length; i++) if (arr[i] === v) n++; return n; }

    for (var sc = 0; sc < src.hdr.length; sc++) {
      var raw = src.hdr[sc];
      if (!raw) continue;
      var name = canon_(norm_(spec.alias[raw] || raw));
      var tc = -1;
      if (countOf(src.hdr, raw) === 1 && countOf(tgtHdr, name) === 1) {
        tc = tgtHdr.indexOf(name);
      }
      if (tc === -1 && sc < tgtHdr.length && tgtHdr[sc] === name) tc = sc;   // positional
      /* THE SHEET REPEATS A NAME, THE EXPORT DOES NOT.
         "Combined Data CPI Raw" carries two columns headed "PY Rev exWorks"
         (R and S). The export sends one. Requiring exactly one on each side
         made the pair ambiguous, the positional fallback landed on a different
         column, and PY revenue was quietly never written - so every sync left
         last export's PY dollars sitting against this export's rows.

         One export column and several sheet columns of that name is not
         ambiguous: it is the first of them, and any others are the sheet's own
         working columns, which stay untouched because `used` blocks a second
         write. The reverse - the EXPORT repeating a name - stays unmatched,
         because then there really is no way to tell which is which. */
      if (tc === -1 && countOf(src.hdr, raw) === 1 && countOf(tgtHdr, name) > 1) {
        for (var dc = 0; dc < tgtHdr.length; dc++) {
          if (tgtHdr[dc] === name && !used[dc]) { tc = dc; break; }
        }
      }
      if (tc === -1 || used[tc]) { unmatched.push(src.hdrRaw[sc]); continue; }
      used[tc] = 1;
      pairs.push({ src: sc, col: tc + 1, isMonth: (name === 'monthcol') });
    }
    if (!pairs.length) {
      throw new Error('None of the export columns matched "' + spec.tab + '". ' +
        'Export header: ' + src.hdrRaw.join(' | '));
    }

    var firstData = firstDataRow_(sh, hdrRow, pairs.map(function (p) { return p.col; }), nCols);
    var n         = src.rows.length;

    /* Everything from row 1 down to the first data row: the totals band and the
       array-formula anchors. Taken now, re-pointed and put back after the write.
       They come out BEFORE the sheet is resized, so a shrink never leaves a
       formula pointing past the end of its own sheet, and nothing is ever
       written into a live spill range. */
    var band = sh.getRange(1, 1, firstData, nCols).getFormulas();
    for (var br = 0; br < band.length; br++) {
      var clearRuns = cellRuns_(band[br]);
      for (var cr = 0; cr < clearRuns.length; cr++) {
        sh.getRange(br + 1, clearRuns[cr].start + 1, 1, clearRuns[cr].len).clearContent();
      }
    }

    /* --- the sheet ends up EXACTLY as tall as the export ---
       Every row is replaced on every run, so a correction made to a month that
       has already closed comes through: there is no history kept here that the
       export does not still carry. Surplus rows are deleted rather than left
       blank, so nothing stale can survive underneath the new data. */
    var target = Math.max(firstData, firstData + n - 1);
    var have   = sh.getMaxRows();
    if (target > have)      sh.insertRowsAfter(have, target - have);
    else if (target < have) sh.deleteRows(target + 1, have - target);
    var sheetEnd = sh.getMaxRows();

    /* --- clear then write, one block per contiguous run of columns --- */
    var blocks = runs_(pairs.map(function (p) { return p.col; }));
    blocks.forEach(function (b) {
      var w = b.end - b.start + 1;
      sh.getRange(firstData, b.start, sheetEnd - firstData + 1, w).clearContent();
    });

    var CHUNK = 5000;
    blocks.forEach(function (b) {
      var w    = b.end - b.start + 1;
      var mine = pairs.filter(function (p) { return p.col >= b.start && p.col <= b.end; });

      /* Bill Month must land as text, so the column's format goes to plain
         text before anything is written into it. */
      mine.forEach(function (p) {
        if (p.isMonth) sh.getRange(firstData, p.col, sheetEnd - firstData + 1, 1).setNumberFormat('@');
      });

      for (var off = 0; off < n; off += CHUNK) {
        var h = Math.min(CHUNK, n - off), grid = new Array(h);
        for (var r = 0; r < h; r++) {
          var row = new Array(w);
          for (var k = 0; k < w; k++) row[k] = '';
          for (var q = 0; q < mine.length; q++) {
            var p = mine[q], v = src.rows[off + r][p.src];
            row[p.col - b.start] = p.isMonth ? monthText_(v) : (v === undefined ? '' : v);
          }
          grid[r] = row;
        }
        sh.getRange(firstData + off, b.start, h, w).setValues(grid);
      }
    });

    plan.push({ sh: sh, firstData: firstData, band: band, nCols: nCols });

    var stamped = null;
    if (spec.stampMonth) {
      for (var sp = 0; sp < pairs.length; sp++) {
        if (pairs[sp].isMonth) { stamped = latestMonth_(src, pairs[sp].src); break; }
      }
    }

    return {
      tab: spec.tab, mode: 'columns', from: src.file + ' · ' + src.name,
      rows: n, columns: pairs.length, firstDataRow: firstData,
      unmatched: unmatched, reportMonth: stamped
    };
  }


  /* =====================================================================
   * 7. WRITE — 'replace' mode  (Slide Builder tabs)
   * =================================================================== */

  function writeReplace_(sh, src, spec) {
    var grid = [src.hdrRaw].concat(src.rows);
    var rows = grid.length;
    var cols = 0;
    grid.forEach(function (r) { if (r.length > cols) cols = r.length; });
    for (var r = 0; r < rows; r++) {
      while (grid[r].length < cols) grid[r].push('');
    }

    sh.clearContents();

    /* Exactly as tall as the export — surplus rows go, so nothing stale is
       left sitting under the new table. */
    var have = sh.getMaxRows();
    if (rows > have)      sh.insertRowsAfter(have, rows - have);
    else if (rows < have) sh.deleteRows(rows + 1, have - rows);
    if (cols > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
    sh.getRange(1, 1, rows, cols).setValues(grid);

    return {
      tab: spec.tab, mode: 'replace', from: src.file + ' · ' + src.name,
      rows: rows - 1, columns: cols, firstDataRow: 2, unmatched: []
    };
  }


  /* =====================================================================
   * 8. THE RUN
   * =================================================================== */

  /* The three exports, each by file id, each feeding one page. There is no
     folder to scan and no guessing which file is which. */
  function sources_() {
    var q = (APP_CONFIG && APP_CONFIG.QLIK_SYNC) || {};
    var out = [
      { key: 'AGG', id: q.AGG_FILE_ID, scope: 'pricevolume', label: 'Aggregates' },
      { key: 'RMX', id: q.RMX_FILE_ID, scope: 'rmx',         label: 'Ready-Mix' },
      { key: 'SEG', id: q.SEG_FILE_ID, scope: 'segment',     label: 'Slide Builder' }
    ];
    var missing = out.filter(function (x) { return !x.id; }).map(function (x) { return x.key; });
    if (missing.length) {
      throw new Error('The QlikView export file ids are not set: ' + missing.join(', ') +
        '. Add them to APP_CONFIG.QLIK_SYNC in Config.gs.');
    }
    return out;
  }

  function sourceById_(key) {
    var all = sources_();
    for (var i = 0; i < all.length; i++) if (all[i].key === key) return all[i];
    return null;
  }

  /* One export file, as { id, name, mime } — the shape readExport_ wants. */
  function exportFile_(src) {
    var f;
    try { f = DriveApp.getFileById(src.id); } catch (e) {
      throw new Error('Could not open the ' + src.label + ' export (file id ' + src.id +
        '). Check APP_CONFIG.QLIK_SYNC in Config.gs, and that the file is shared with you.');
    }
    return { id: f.getId(), name: f.getName(), mime: f.getMimeType() };
  }

  /* scope: 'all', or a page id ('pricevolume' | 'rmx' | 'segment') so a tool's
     own button pulls only what that tool reads. Only the folders the chosen
     tabs actually need get opened. */
  function run(scope) {
    var want = String(scope || 'all').toLowerCase();

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) {
      /* The hourly trigger overlapping a manual run from the editor. Nothing
         is wrong, but nothing was written either — `error` says the run did
         not happen, which is what stops the caller recording it as done. */
      return { ok: false, scope: want, files: [], done: [], skipped: [], failed: [],
               error: 'Another update is already running. Try again in a moment.' };
    }
    var started = new Date();
    var done = [], skipped = [], failed = [];

    try {
      var SPEC = buildSpec_().filter(function (s) { return want === 'all' || s.page === want; });
      if (!SPEC.length) {
        return { ok: false, error: 'Nothing is set up to update for "' + want + '".' };
      }

      /* --- open only the export files these tabs need, once each --- */
      var tabsByFolder = { AGG: [], RMX: [], SEG: [] };
      var filesSeen    = [];
      var needed = {};
      SPEC.forEach(function (s) { needed[s.folder] = 1; });

      sources_().forEach(function (src) {
        if (!needed[src.key]) return;
        var f = exportFile_(src);
        filesSeen.push(src.label + ': ' + f.name);
        tabsByFolder[src.key] = readExport_(f);
      });

      /* --- one workbook at a time, so its formulas can be fixed together --- */
      var byPage = {};
      SPEC.forEach(function (s) { (byPage[s.page] = byPage[s.page] || []).push(s); });

      Object.keys(byPage).forEach(function (page) {
        var ss;
        try {
          ss = APP_openSpreadsheet_(page);
        } catch (e) {
          byPage[page].forEach(function (s) {
            failed.push({ tab: s.tab, error: e.message });
          });
          return;
        }

        var plan = [], ends = {};

        byPage[page].forEach(function (spec) {
          try {
            var sh = ss.getSheetByName(spec.tab);
            if (!sh) {
              (spec.optional ? skipped : failed).push({
                tab: spec.tab,
                error: 'No tab called "' + spec.tab + '" in ' + APP_CONFIG.PAGES[page].label + '.'
              });
              return;
            }
            var src = pickSource_(tabsByFolder[spec.folder], spec);
            if (!src) {
              (spec.optional ? skipped : failed).push({
                tab: spec.tab,
                error: 'Nothing in the ' + spec.folder + ' folder matches this tab' +
                       (spec.srcTab ? ' (looked for an export tab called "' + spec.srcTab + '")' : '') + '.'
              });
              return;
            }
            var res = (spec.mode === 'replace')
              ? writeReplace_(sh, src, spec)
              : writeColumns_(sh, src, spec, plan);
            if (res.reportMonth) {
              try {
                PropertiesService.getScriptProperties().setProperty(
                  'QLIK_REPORT_MONTH', res.reportMonth.y + '-' + res.reportMonth.m);
              } catch (e2) {
                /* The Overview reads this back as the year on its segment
                   columns. Silent here is the cause of a missing year there,
                   two sections away and with nothing connecting them. */
                APP_log('warn', 'QLIKSYNC.run', 'could not record the report month — the ' +
                        'Overview will show its segment columns without a year',
                        { tab: spec.tab, error: String(e2) });
              }
            }
            done.push(res);
            ends[norm_(spec.tab)] = sh.getMaxRows();
          } catch (e) {
            failed.push({ tab: spec.tab, error: e.message });
          }
        });

        /* Every tab in this workbook has its final height now, so the array
           formulas can be re-pointed — including the ones that reach across
           into another tab of the same workbook. */
        plan.forEach(function (p) {
          var ownEnd = p.sh.getMaxRows();
          for (var r = 0; r < p.band.length; r++) {
            var fRuns = cellRuns_(p.band[r]);
            for (var q = 0; q < fRuns.length; q++) {
              var start = fRuns[q].start, len = fRuns[q].len, seg = new Array(len);
              for (var k = 0; k < len; k++) {
                seg[k] = reanchor_(p.band[r][start + k], ownEnd, ends);
              }
              try {
                p.sh.getRange(r + 1, start + 1, 1, len).setFormulas([seg]);
              } catch (e) {
                failed.push({ tab: p.sh.getName(),
                  error: 'Could not restore the formulas in ' +
                         p.sh.getRange(r + 1, start + 1, 1, len).getA1Notation() +
                         ': ' + e.message });
              }
            }
          }
        });

        SpreadsheetApp.flush();
      });

      /* --- every cached copy, everywhere, is now stale --- */
      try { syncAll(); }
  catch (e) {
    /* The sync WORKED and the caches were not cleared, so every page will keep
       serving pre-sync numbers while reporting success. There is nothing else
       in the system that notices this. */
    APP_log('error', 'QLIKSYNC.run', 'data synced but the caches were NOT cleared — pages will serve stale figures',
            { error: String(e && e.message || e) });
  }

      return {
        ok: failed.length === 0,
        scope: want,
        files: filesSeen,
        done: done,
        skipped: skipped,
        failed: failed,
        seconds: Math.round((new Date() - started) / 100) / 10
      };

    } catch (e) {
      return { ok: false, scope: want, error: e.message, files: [],
               done: done, skipped: skipped, failed: failed };
    } finally {
      try { lock.releaseLock(); }
      catch (e2) { APP_log('warn', 'QLIKSYNC.run', 'the sync lock was not released — the next ' +
                           'hourly run will wait it out', { error: String(e2) }); }
    }
  }

  return { run: run, sources: sources_ };
})();




/* ============================================================================
 * §6  AGG — Aggregates
 * ----------------------------------------------------------------------------
 * Price & Volume, its mapping check, AGG Fuel Recovery, and the Saskatchewan
 * rate table Fuel Recovery reads through PV.
 *
 * PV, PV_Lookup, FSC and SASKRATES each keep their own private toNum_ / norm_ /
 * gk_, and so do §5's QLIKSYNC and §7's RMX and RFSC. They have drifted, chunk 15
 * diffed all fourteen definitions, and the verdict was DO NOT UNIFY — see the
 * file header, item 4. Two things found here specifically, both recorded as
 * findings rather than fixed inside a cleanup:
 *
 *   · PV.toNum_ reads an accounting negative "(1,234)" as ZERO. Its strip leaves
 *     the parentheses, parseFloat gives NaN, and NaN becomes 0. Every other copy
 *     in the suite reads -1234. If the Price & Volume source ever carries
 *     parenthesised negatives, they are being silently dropped — not mis-signed,
 *     dropped, which is why nothing looks wrong.
 *   · PVLOOK.gk_ builds its cache key from the generation alone; PV.gk_ also
 *     mixes in SCHEMA_. So bumping the schema invalidates one cache and leaves
 *     the other serving rows shaped the old way.
 *
 * tests/helpers.js is the gate on all of it.
 * ============================================================================ */

/* ---- PV_Backend.gs -----------------------------------------------------------
   Aggregates Price & Volume. Its getReport returns the cached report BEFORE it
   touches the pivot — the thing the Ready-Mix side did not do, and the whole of
   README §6.  */

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
  /* THE PARENTHESES ARE A MINUS SIGN. An accounting export writes -1,234 as
     "(1,234)", and stripping only [$,%\s] left the brackets in place: parseFloat
     gave NaN and NaN became 0, so the figure was DROPPED rather than mis-signed
     — which is why nothing ever looked wrong. Every other toNum_ in the suite
     (FSC, RFSC, RMX, SASKRATES) has always read it as -1234; this is that rule,
     spelled the way they spell it, and it is the whole of PLAN.md chunk 20.
     It cannot touch a value that is not a parenthesised NUMBER: "(n/a)" still
     reads 0, because parseFloat still gives NaN. The percent rule above is
     untouched — chunk 15's point was that PV is RIGHT about "5%" and the others
     are wrong, and the two rules are about different inputs. */
  s = s.replace(/[$,%\s]/g, '').replace(/\(/g, '-').replace(/\)/g, '');
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
/* The version IS the source sheet's modified time (Code.gs). It moves when
   the data behind this page actually changes — a sync, or somebody typing
   into a lookup tab — and not otherwise, so an unchanged sheet keeps every
   cached table valid however many times anything is pressed. */
function generation_() {
  if (_GEN != null) return _GEN;
  try { _GEN = APP_sourceStamp_('pricevolume') || '1'; } catch (e) { _GEN = '1'; }
  return _GEN;
}
/* Nothing to bump: whatever just wrote to the sheet moved its modified time.
   Forget the copy we are holding so the next read sees it. */
function bumpGeneration_() {
  _GEN = null;
  try { APP_forgetStamp_('pricevolume'); }
  catch (e) { APP_log('warn', 'PV.bumpGeneration', 'generation moved but the source stamp did not — ' +
                      'freshness checks will disagree with the cache', { error: String(e) }); }
  return generation_();
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
    RAW_HEADER_NAMES:  RAW_HEADER_NAMES_,

    /* THE CACHE-SHAPE VERSION, so PV_Lookup.gs can key on the same one. Same
       argument as readTab directly above: two copies of one rule is how it
       keeps coming back. PV_Lookup caches a result COMPUTED FROM the rows this
       schema describes, so a bump that strands PV's tables has to strand its
       check too — see PLAN.md chunk 21. Exported as a value: bumping it means
       editing the literal, which is what SCHEMA_'s own comment asks for. */
    SCHEMA:            SCHEMA_
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

/* ---- PV_Lookup.gs ------------------------------------------------------------
   The Aggregates mapping check. Reads the raw tab's header from row 2, under the
   totals band — the third file in the suite to have to learn that.  */

/*****************************************************************************
 * PV_Lookup.gs — Price & Volume "Mapping check": find raw rows REGION LOOKUP
 *                couldn't match, and let the user add the missing row.
 * ---------------------------------------------------------------------------
 * WHAT IT CHECKS
 *
 *   REGION LOOKUP, keyed on column A ("Plant # - Desc"). A raw Plant with no
 *   row there gets a BLANK region, subregion, market, submarket 1 & 2 and MB
 *   submarket, a blank country, and therefore falls back to USD. Its volume
 *   and revenue still count — they just land in an unlabelled bucket, which
 *   is exactly why nobody notices.
 *
 *   TOPLINE REV LOOKUP2 is deliberately NOT checked. A miss there falls back
 *   to "TOP LINE REVENUE", which is the normal case — that tab lists the
 *   exceptions, so "no row" is not a problem to report.
 *
 * THE TAB IS PART TYPED, PART CALCULATED
 *
 *   A..I  typed:      Plant # - Desc | PLANT | Submarket | Market | Subregion |
 *                     Region | MB REGION | MB MARKET | MB SUBMARKET
 *   J..L  CALCULATED: FORMATTED REGION   =vlookup(G<row>,$P$2:$Q$11,2,false)
 *                     FORMATTED MARKET   =H<row>
 *                     COMBINED SUBMARKET =I<row>
 *
 *   So the dialog only ever shows A (fixed) and asks for B..I. It never shows
 *   J..L at all. They are filled by COPYING THE
 *   FORMULAS DOWN from the last existing row — Sheets re-points the relative
 *   references per row and leaves $P$2:$Q$11 alone. Nothing about those three
 *   formulas is hard-coded here, so if the sheet's formulas change, new rows
 *   follow automatically.
 *
 *   Because J is a vlookup into P2:Q11, MB REGION (column G) is restricted to
 *   the values in column P. Anything else makes J come back #N/A, which is the
 *   same broken row in a different disguise.
 *
 * NO PREDICTION. Unlike RMX_Suggest.gs there is no nearest-neighbour model and
 * no confidence banding. This file only answers "is there a row for this?" and
 * then hands the user dropdowns of the values that already exist in that tab.
 *
 * COLUMNS ARE ADDRESSED BY POSITION, NOT BY HEADER NAME. That is deliberate:
 * PV_Backend.buildLookups_ READS this tab by position (col 10 REGION, col 4
 * SUBREGION, col 11 MARKET, col 12 SUBMARKET1, col 3 SUBMARKET2, col 9 MB
 * SUBMARKET). Writing by header name could quietly disagree with how the data
 * is read. The header row is used for the dialog's labels only.
 *
 * MOSTLY SELF-CONTAINED: PV_Backend.gs is wrapped in an IIFE, so its helpers
 * (buildLookups_, cacheGet_ …) are closure-private and unreachable from here,
 * and the small ones below are local copies.
 *
 * THE TAB READER IS NOT ONE OF THEM. Reading a tab means knowing which row the
 * header is on, and this file's own copy of that rule said "row 1" — which is
 * wrong for Combined Data CPI Raw, where the totals band sits above the
 * header, and is exactly how the mapping check came to report no "Plant"
 * column on a tab that has one. PV now exports its reader (PV.readTab) and
 * this file calls it, so that rule exists once.
 *
 * The outside things used are the genuine globals — APP_CONFIG,
 * APP_openSpreadsheet_, APP_getGen_, APP_bumpGen_ — plus PV.readTab,
 * PV.RAW_HEADER_NAMES and PV.clearCache().
 *****************************************************************************/

var PVLOOK = (function () {

/* =================== config =================== */
var LOCK_MS  = 30000;
var LIST_CAP = 300;   // values listed (the count shown is the TRUE total)

var RL_WIDTH  = 12;   // A:L — the row PV reads
var RL_TYPED  = 9;    // A:I are typed; J:L are formulas copied down
var RL_KEY    = 0;    // A  Plant # - Desc          (the lookup key)
var RL_PLANT  = 1;    // B  PLANT                   (the code, prefilled)
var RL_MBREG  = 6;    // G  MB REGION               (feeds the J vlookup)
var RL_P_LIST = 15;   // P  the MB REGION list the J vlookup reads

function S_(){ return APP_CONFIG.PAGES.pricevolume.SHEETS; }

/* =================== generic helpers (copies — PV's are private) ========= */
function norm_(s){ return String(s == null ? '' : s).toLowerCase().replace(/[\s_\.\[\]\(\)%#\/-]+/g, ' ').trim(); }
function lk_(s){ return String(s == null ? '' : s).trim().toLowerCase(); }
function txt_(v){ return String(v == null ? '' : v).trim(); }
function toNum_(v){
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  var s = String(v).trim(), pct = /%/.test(s);
  /* THE PARENTHESES ARE A MINUS SIGN. An accounting export writes -1,234 as
     "(1,234)", and stripping only [$,%\s] left the brackets in place: parseFloat
     gave NaN and NaN became 0, so the figure was DROPPED rather than mis-signed
     — which is why nothing ever looked wrong. Every other toNum_ in the suite
     (FSC, RFSC, RMX, SASKRATES) has always read it as -1234; this is that rule,
     spelled the way they spell it, and it is the whole of PLAN.md chunk 20.
     It cannot touch a value that is not a parenthesised NUMBER: "(n/a)" still
     reads 0, because parseFloat still gives NaN. The percent rule above is
     untouched — chunk 15's point was that PV is RIGHT about "5%" and the others
     are wrong, and the two rules are about different inputs. */
  s = s.replace(/[$,%\s]/g, '').replace(/\(/g, '-').replace(/\)/g, '');
  if (s === '' || s === '-') return 0;
  var n = parseFloat(s);
  if (isNaN(n)) return 0;
  return pct ? n / 100 : n;
}
function ci_(H, name){ var n = norm_(name); return (n in H) ? H[n] : -1; }

/* The plant code at the front of "3223-MESA SAND AND GRAVEL" / "3A01 - PITT
   RIVER QUARRY". A prefill for column B only — the user can overwrite it. */
function code_(v){
  var s = txt_(v), i = s.indexOf('-');
  return (i > 0 ? s.slice(0, i) : s).trim();
}

/* =================== cache ===================
 * This file's OWN entries only — the mapping-check result. The tabs it reads
 * are cached by PV.readTab under PV's key, which is how a tab either page has
 * already read this generation is free for the other.
 * Generation-keyed, so a sync invalidates it with everything else. */
function gen_(){ return APP_getGen_('pricevolume'); }
/* PV.SCHEMA IS IN THE KEY, AND CHUNK 21 IS WHY. It was not, and PV's own key
   always had it — so bumping SCHEMA_ stranded every Price & Volume table and
   left this page's mapping check serving a result computed from rows of the old
   shape. Read at call time, never at construction: PV is above this IIFE, but
   nothing here should depend on that.

   THE TWO KEYS ARE STILL NOT THE SAME KEY, deliberately. PV keys on the raw
   source stamp; this keys on APP_getGen_, which is that stamp PLUS
   APP_CODE_BUILD — so a code push already invalidates the check and does not
   invalidate PV's tables. That is the safe direction of the two (an extra
   rebuild, never a stale read) and it is left alone.

   Every existing entry under the old key is now unreachable: one miss, then a
   rebuild, for one page's mapping check. */
function gk_(k){ return 'pv|g' + gen_() + '|' + PV.SCHEMA + '|' + k; }

function pvGet_(key){
  try {
    var c = CacheService.getScriptCache(), meta = c.get(key + ':meta'); if (!meta) return null;
    var info = JSON.parse(meta), ks = []; for (var i = 0; i < info.n; i++) ks.push(key + ':' + i);
    var m = c.getAll(ks), s = '';
    for (var j = 0; j < info.n; j++){ var p = m[key + ':' + j]; if (p == null) return null; s += p; }
    return s.length === info.len ? JSON.parse(s) : null;
  } catch (e) { return null; }
}
function pvPut_(key, obj){
  try {
    var j = JSON.stringify(obj), sz = 95000;
    if (j.length > 250 * sz) return false;
    var c = CacheService.getScriptCache(), idx = 0, m = {};
    for (var i = 0; i < j.length; i += sz){ m[key + ':' + idx] = j.slice(i, i + sz); idx++; }
    m[key + ':meta'] = JSON.stringify({ n: idx, len: j.length });
    c.putAll(m, 21600);
    return true;
  } catch (e) { return false; }
}

/* =================== sheet access =================== */
function sheet_(name){
  var ss = APP_openSpreadsheet_('pricevolume');
  var sh = ss.getSheetByName(name); if (sh) return sh;
  var want = lk_(name), all = ss.getSheets();
  for (var i = 0; i < all.length; i++) if (lk_(all[i].getName()) === want) return all[i];
  throw new Error('Sheet not found: "' + name + '". Check the tab names in Config.gs.');
}
/* { header: normalised name -> index, rows: everything under it }. Values, not
   formulas — which is what we want: J:L arrive as the text they evaluate to.

   THE HEADER IS NOT ROW 1 ON THE RAW TAB. It used to be read as row 1 here,
   and Combined Data CPI Raw sums ABOVE its header — so the totals band was
   taken for the header, every column came back -1, and the mapping check died
   with 'no "Plant" column' against a tab whose row 2 says Plant. (Other
   Revenue sums BELOW its header, so the same blind read happens to work
   there, which is why this only ever failed on the one tab.)

   PV.readTab locates the header by scoring the first rows against the names
   the tab should carry, and is the SAME reader PV_Backend uses for the same
   tabs — same cache entry, so a tab either page has read this generation is
   free for the other. Naming nothing keeps row 1, which is what the two
   LOOKUP tabs want: they are read by column POSITION, not by name. */
function tab_(name){
  return PV.readTab(name, name === S_().SHEET ? PV.RAW_HEADER_NAMES : null);
}
/* The header row as WRITTEN (original casing), for the dialog's column labels. */
function labels_(name){
  var sh = sheet_(name), lc = Math.max(sh.getLastColumn(), 1);
  return sh.getRange(1, 1, 1, lc).getValues()[0];
}
/* Raw data: the connected sheet, or this session's uploaded QlikView files. */
function rawTab_(upload){
  if (upload){
    var t = pvGet_('up:' + upload);
    if (!t) throw new Error('Your uploaded data has expired (sessions last up to 6 hours). '
      + 'Press "Back to sheet data", or upload the two Excel files again.');
    return t;
  }
  return tab_(S_().SHEET);
}
/* Deep link straight to the tab, for anyone who'd rather edit it in Sheets. */
function lookupUrl_(){
  try {
    var sh = sheet_(S_().REGION_LOOKUP);
    return sh.getParent().getUrl() + '#gid=' + sh.getSheetId();
  } catch (e){ return ''; }
}

/* Distinct non-blank values in one column of an already-read tab. */
function distinct_(rows, c){
  var seen = {}, out = [];
  for (var r = 0; r < rows.length; r++){
    var v = txt_(rows[r][c]);
    if (!v || seen[v]) continue;
    seen[v] = 1; out.push(v);
  }
  out.sort();
  return out;
}

/* =================== public: what didn't match =================== */
/* Always every market and every month, whatever the page filters say — this
   is about fixing the lookup tab, not reading a period. */
function getUnmapped(opts){
  opts = opts || {};
  var ck = opts.upload ? ('pvl|up|' + opts.upload + '|check') : gk_('lookupcheck');
  if (!opts.force){ var hit = pvGet_(ck); if (hit) return hit; }

  var raw = rawTab_(opts.upload), H = raw.header;

  /* CY = the later of the two "#### Volume" columns, exactly as PV does it. */
  var vc = []; for (var n in H){ var m = n.match(/^(\d{4}) volume$/); if (m) vc.push({ y: +m[1], i: H[n] }); }
  vc.sort(function (a, b){ return a.y - b.y; });
  var iP = ci_(H, 'Plant');
  var iV = vc.length > 1 ? vc[vc.length - 1].i : ci_(H, 'CY Volume');
  var iR = ci_(H, 'CY Rev exWorks');
  if (iP === -1) throw new Error('The raw tab has no "Plant" column, so the mapping check can\u2019t run.');

  /* Just enough of PV's buildLookups_ to answer "is there a row?". */
  var rl = tab_(S_().REGION_LOOKUP), known = {};
  rl.rows.forEach(function (r){ var p = lk_(r[RL_KEY]); if (p) known[p] = 1; });

  var miss = {};
  raw.rows.forEach(function (r){
    var plant = txt_(r[iP]); if (!plant) return;      // a blank row isn't a mapping problem
    var pk = lk_(plant); if (pk in known) return;
    var g = miss[pk];
    if (!g) g = miss[pk] = { value: plant, rows: 0, cyVol: 0, cyRev: 0, code: code_(plant) };
    g.rows++;
    g.cyVol += (iV === -1) ? 0 : toNum_(r[iV]);
    g.cyRev += (iR === -1) ? 0 : toNum_(r[iR]);
  });

  var list = Object.keys(miss).map(function (k){ return miss[k]; })
    .sort(function (a, b){ return Math.abs(b.cyRev) - Math.abs(a.cyRev); });   // biggest money first

  var out = { ok: true, region: list.slice(0, LIST_CAP), regionTotal: list.length,
              total: list.length, cap: LIST_CAP, url: lookupUrl_(), generation: gen_() };
  pvPut_(ck, out);
  return out;
}

/* =================== public: the add-row form =================== */
/* One descriptor per TYPED column (A:I), with the values that already exist in
   that column. The three calculated columns are not described or returned —
   the dialog never shows them. Fetched only when the dialog is opened. */
function getForm(){
  var name = S_().REGION_LOOKUP, t = tab_(name), lab = labels_(name), cols = [];

  for (var c = 0; c < RL_TYPED; c++){
    /* Column A is the key (fixed) and column B is a per-plant code, so it's a
       free-text box. Everything else is categorical — always a dropdown, however
       many values it holds. */
    var kind = (c === RL_KEY) ? 'key' : (c === RL_PLANT ? 'text' : 'select');
    cols.push({
      i: c,
      label: txt_(lab[c]) || ('Column ' + String.fromCharCode(65 + c)),
      kind: kind,
      options: (kind === 'select') ? distinct_(t.rows, c) : [],
      allowNew: true,
      note: ''
    });
  }

  /* MB REGION feeds  J = vlookup(G, $P$2:$Q$11, 2, false).  A value that isn't
     in column P makes J come back #N/A, so this one column is closed: pick from
     the list or add the region to P:Q on the tab first. */
  var pList = distinct_(t.rows, RL_P_LIST);
  if (pList.length){
    cols[RL_MBREG].options = pList;
    cols[RL_MBREG].allowNew = false;
    cols[RL_MBREG].note = 'Must be one of these \u2014 FORMATTED REGION looks it up in P:Q.';
  }

  /* J:L are formulas and are never shown or asked for — applyRows copies them
     down from the row above. */
  return { ok: true, tab: name, typed: RL_TYPED, width: RL_WIDTH,
           cols: cols, url: lookupUrl_(), generation: gen_() };
}

/* =================== public: write the approved rows =================== */
/* This writes to a source of truth, so:
 *   - a script lock, so two people can't append at once
 *   - the tab is re-read at write time and existing keys are skipped
 *     (the mapping list on screen may be minutes stale)
 *   - A:I are written as values; J:L are the last row's formulas copied down,
 *     never typed, so relative references re-point per row
 *   - nothing past column L (the P:Q and Q:R blocks) is touched
 *   - the key column is forced to text so codes like 3A01 survive
 *   - the PV generation is bumped, so every cached tab, pivot and report for
 *     every user is instantly unreachable */
function applyRows(payload){
  payload = payload || {};
  var rows = payload.rows || [];
  if (!rows.length) return { ok: true, added: 0, skipped: 0, skippedValues: [] };

  var name = S_().REGION_LOOKUP;
  var lock = LockService.getScriptLock();
  try { lock.waitLock(LOCK_MS); }
  catch (e){ throw new Error('Someone else is updating the lookup tab right now. Please try again in a moment.'); }

  try {
    var sh = sheet_(name), values = sh.getDataRange().getValues();

    /* The last row that actually has a key. NOT getLastRow(), which would also
       count the P:Q / Q:R blocks sitting to the right. */
    var lastData = 1;
    for (var i = values.length - 1; i >= 1; i--){
      if (txt_(values[i][RL_KEY])){ lastData = i + 1; break; }    // 1-based
    }

    var have = {};
    for (var h = 1; h < values.length; h++){ var k = lk_(values[h][RL_KEY]); if (k) have[k] = 1; }

    var out = [], skipped = [];
    rows.forEach(function (r){
      var key = txt_(r.key);
      if (!key || have[lk_(key)]){ if (key) skipped.push(key); return; }
      have[lk_(key)] = 1;
      var cells = r.cells || {}, line = [];
      for (var c = 0; c < RL_TYPED; c++) line.push('');
      line[RL_KEY] = key;
      for (var c2 = 1; c2 < RL_TYPED; c2++){
        var v = cells[c2];
        line[c2] = (v == null) ? '' : String(v);
      }
      out.push(line);
    });

    var copied = false;
    if (out.length){
      var at = lastData + 1;
      sh.getRange(at, RL_KEY + 1, out.length, 1).setNumberFormat('@');   // keys stay text (3A01, 3G20…)
      sh.getRange(at, 1, out.length, RL_TYPED).setValues(out);

      /* J:L — copy the calculated tail down from the row above. copyTo tiles the
         source across the destination and re-points relative references row by
         row, so =H<row> / =I<row> follow and $P$2:$Q$11 stays put. */
      var nF = RL_WIDTH - RL_TYPED;
      if (lastData >= 2 && txt_(sh.getRange(lastData, RL_TYPED + 1).getFormula())){
        sh.getRange(lastData, RL_TYPED + 1, 1, nF)
          .copyTo(sh.getRange(at, RL_TYPED + 1, out.length, nF));
        copied = true;
      }
      SpreadsheetApp.flush();
      try { PV.clearCache(); }
      catch (e){
        try { APP_bumpGen_('pricevolume'); }
        catch (e2){
          /* Both ways of invalidating failed and the rows are already written,
             so the Mapping check will keep reporting the values just mapped. */
          APP_log('warn', 'PVLOOK.applyRows', 'rows written but NO cache was invalidated — ' +
                  'the mapping check will still show them as unmapped',
                  { error: String(e), fallback: String(e2) });
        }
      }
    }

    return { ok: true, added: out.length, skipped: skipped.length, skippedValues: skipped,
             formulasCopied: copied, generation: APP_getGen_('pricevolume') };

  } finally {
    try { lock.releaseLock(); }
    catch (e) { APP_log('warn', 'PVLOOK.applyRows', 'the lock was not released — the next writer will wait it out',
                        { error: String(e) }); }
  }
}

return { getUnmapped: getUnmapped, getForm: getForm, applyRows: applyRows };

})();

/* ---- top-level wrappers for google.script.run ---- */
function getPvUnmapped(opts) {
  var t0 = Date.now();
  APP_log('info', 'PVLOOK.getUnmapped', 'reading',
          { upload: !!(opts && opts.upload), force: !!(opts && opts.force) });
  try {
    var out = PVLOOK.getUnmapped(opts);
    /* The three lists ARE the answer — one row per distinct unmapped value —
       so their sizes are the size §7 asks for, not the bytes behind them. */
    APP_log('info', 'PVLOOK.getUnmapped', 'ok',
            { ms: Date.now() - t0,
              rows: ((out && out.product) || []).length + ((out && out.extras) || []).length +
                    ((out && out.flag) || []).length,
              product: ((out && out.product) || []).length,
              extras:  ((out && out.extras)  || []).length,
              flag:    ((out && out.flag)    || []).length });
    return out;
  } catch (err) {
    APP_log('error', 'PVLOOK.getUnmapped', 'failed',
            { ms: Date.now() - t0, upload: !!(opts && opts.upload),
              error: String(err && err.message ? err.message : err) });
    throw err;
  }
}
function getPvLookupForm()     { return PVLOOK.getForm(); }
function applyPvLookupRows(p)  { return PVLOOK.applyRows(p); }

/* ---- FSC_Backend.gs ----------------------------------------------------------
   AGG Fuel Recovery. Caches the sheet read AND the finished result, so one read
   serves two identical calls (tests/fscheader.js proves it).  */

/*****************************************************************************
 * AMRIZE FUEL RECOVERY - backend
 * ---------------------------------------------------------------------------
 * SOURCE: the Price & Volume sheet's "Combined Data CPI Raw" tab. There is no
 * separate Fuel Recovery sheet any more.
 *
 * WHY THE SOURCE MOVED
 *   The old Fuel Recovery sheet arrived pre-summed to Market x Sold To x Year x
 *   Month. Applied tonnes had to be inferred from that summary, so any plant or
 *   product that shared a Market+Sold To bucket with a surcharged line was swept
 *   in whole - applied tonnes came out too high, and the $/applied-tonne rate
 *   too low.
 *
 *   Combined Data CPI Raw carries the surcharge on the SAME ROW as the volume it
 *   was charged on, at Plant x Material x Customer x Month grain. So "applied"
 *   is now read, not inferred: a row either carries a charge or it does not, and
 *   its own tonnes are the ones that count. The numbers on this page will move,
 *   and the direction is expected - applied tonnes down, $/applied tonne up.
 *
 * THE HEADER IS NOT ROW 1. The tab carries a totals band above its column
 * names (row 1 sums, row 2 names, row 3 first record), so the header row is
 * located by scoring, exactly as Price & Volume does. See headerRow_().
 *
 * COLUMNS USED (names matched case- and space-insensitively)
 *   Plant · Year · Month
 *   "#### Volume"      - one column per year; the row's Year picks which
 *   CY / PY Rev exWorks - net sales, picked the same way
 *   New Fuel Surcharge  - THE surcharge column
 *
 *   NOTE ON "Fuel Surchage" (the source's own typo): it is a partial column -
 *   in the July file it is non-zero on 1,225 of 31,347 rows and totals $379k
 *   against New Fuel Surcharge's $1.91m. Where it IS set it agrees. It is
 *   deliberately NOT read; CY/PY Fuel Surcharge are just New split by the row's
 *   year, so they are equivalent and only used as a fallback.
 *
 * MARKET comes from REGION LOOKUP (same tab Price & Volume uses), keyed on the
 * plant, so this page speaks the same market names as every other page.
 *
 * Everything below the reader is unchanged: the summary, executive and
 * by-month views all work off the same {cells, markets, latest} bundle.
 *****************************************************************************/
var FSC = (function () {

  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  /* PV market names, so the Overview and Price & Volume agree with this page */
  var EXEC_ORDER = ['Greater Toronto Area','Southwest','Manitoba','Saskatchewan','North'];

  /* ---------- small parsing helpers ---------- */
  function norm_(s){ return String(s == null ? '' : s).replace(/\u00A0/g,' ').trim().toLowerCase().replace(/\s+/g,' '); }
  function toNum_(v){
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    var s = String(v).replace(/[$,%\s]/g,'').replace(/\(/g,'-').replace(/\)/g,'');
    var n = parseFloat(s); return isNaN(n) ? 0 : n;
  }
  function monthOrd_(v){
    if (v instanceof Date) return v.getMonth() + 1;
    var s = norm_(v).slice(0,3);
    for (var i = 0; i < 12; i++) if (MONTHS[i].toLowerCase() === s) return i + 1;
    return 0;
  }
  function pick_(idx, names){
    for (var i = 0; i < names.length; i++){ var k = norm_(names[i]); if (k in idx) return idx[k]; }
    return -1;
  }

  /* ---------- THE HEADER ROW IS NOT ALWAYS ROW 1 ----------
     "Combined Data CPI Raw" carries a TOTALS BAND above its header: row 1 is
     the sums, row 2 the column names, row 3 the first data row. Reading row 1
     blindly took that band as the header, every column came back -1, and the
     page reported Plant, Year, Month, "#### Volume" and New Fuel Surcharge all
     missing at once - the tell-tale of a header read one row too high, since a
     genuine rename never loses every column together.

     Price & Volume already solves this in tabHeaderRow_(); the same scoring is
     repeated here rather than shared because the two files are separate Apps
     Script globals and FSC must keep parsing an UPLOAD, which never goes
     through PV's reader at all.

     Score the first few rows against the names this tab is supposed to carry
     and take the best. A "#### Volume" column counts too, so a file that rolls
     over to a new year needs no edit here. */
  var CPI_HEADER_NAMES_ = ['lookup key','sold to','plant','plant type','material family',
    'customer parent','product class [rock]','product application','material',
    'cust segment [rock]','year','month','cy rev exworks','py rev exworks',
    'new fuel surcharge','cy fuel surcharge','py fuel surcharge','fuel surchage'];

  function headerRow_(grid, names){
    var want = {};
    (names || CPI_HEADER_NAMES_).forEach(function(n){ want[norm_(n)] = 1; });
    var best = 0, bestScore = -1, limit = Math.min(grid.length, 8);
    for (var r = 0; r < limit; r++){
      var row = grid[r] || [], score = 0;
      for (var c = 0; c < row.length; c++){
        var k = norm_(row[c]); if (!k) continue;
        if (want[k] || /^\d{4} volume$/.test(k)) score++;
      }
      if (score > bestScore){ bestScore = score; best = r; }
    }
    return best;
  }

  /* ---------- shared column resolution for a CPI grid ----------
     Used by both the sheet reader and the upload path, so an uploaded export
     and the live tab are parsed by exactly the same rules. */
  function cpiCols_(header, headerRowNo){
    var idx = {};
    header.forEach(function(h,i){ var k = norm_(h); if (k && !(k in idx)) idx[k] = i; });

    var c = {
      key:   pick_(idx, ['lookup key','key']),
      plant: pick_(idx, ['plant']),
      year:  pick_(idx, ['year']),
      month: pick_(idx, ['month']),
      fsc:    pick_(idx, ['new fuel surcharge']),
      rawFsc: pick_(idx, ['fuel surchage','fuel surcharge']),   // the source's own typo
      cyFsc: pick_(idx, ['cy fuel surcharge']),
      pyFsc: pick_(idx, ['py fuel surcharge']),
      cyRev: pick_(idx, ['cy rev exworks','cy rev ex-works']),
      pyRev: pick_(idx, ['py rev exworks','py rev ex-works']),
      vol:   {}                      // year -> column
    };
    /* "2026 Volume" / "2025 Volume": the header carries the year, so nothing
       here has to be edited when the file rolls over to a new year. */
    header.forEach(function(h,i){
      var m = /^(\d{4})\s+volume$/.exec(norm_(h));
      if (m) c.vol[Number(m[1])] = i;
    });

    var miss = [];
    if (c.plant < 0) miss.push('Plant');
    if (c.year  < 0) miss.push('Year');
    if (c.month < 0) miss.push('Month');
    if (!Object.keys(c.vol).length) miss.push('"#### Volume"');
    if (c.fsc < 0 && c.cyFsc < 0 && c.pyFsc < 0 && c.rawFsc < 0) miss.push('New Fuel Surcharge');
    if (miss.length){
      /* Name the row that was read and the names found on it. When the header
         moves, everything is "missing" at once and the row number is the fix. */
      var seenNames = header.map(norm_).filter(function(x){ return !!x; }).slice(0, 12);
      throw new Error('The Combined Data CPI Raw tab is missing these column(s): '
        + miss.join(', ') + '. The header was read as row ' + (headerRowNo || 1)
        + ', which carries: ' + (seenNames.join(', ') || '(nothing)')
        + '. Check the header row spelling.');
    }
    return c;
  }

  /* ---------- plant -> market, from REGION LOOKUP ----------
     The CPI tab has no Market column of its own. REGION LOOKUP is the same tab
     Price & Volume resolves markets with, so both pages bucket a plant the
     same way and a lookup fix shows up on both at once.

     FORMATTED MARKET is preferred because that is the vocabulary the rest of
     the app uses (Greater Toronto Area / Southwest / North / Manitoba /
     Saskatchewan); MB MARKET and Market are fallbacks for an older sheet. */
  function plantMarkets_(ss){
    var sh = findTab_(ss, ['region lookup']);
    if (!sh) throw new Error('The Price & Volume sheet is missing a "REGION LOOKUP" tab, '
      + 'which is where each plant\u2019s market comes from.');
    var v = sh.getDataRange().getValues();
    if (v.length < 2) return {};

    var hdr = -1;
    for (var h = 0; h < Math.min(v.length, 10); h++){
      var row = v[h].map(norm_);
      if (row.indexOf('plant # - desc') >= 0 || row.indexOf('plant') >= 0){ hdr = h; break; }
    }
    if (hdr < 0) hdr = 0;

    var idx = {};
    v[hdr].forEach(function(x,i){ var k = norm_(x); if (k && !(k in idx)) idx[k] = i; });
    var cKey = pick_(idx, ['plant # - desc','plant #-desc','plant']);
    var cMkt = pick_(idx, ['formatted market','mb market','market']);
    if (cKey < 0 || cMkt < 0) return {};

    var map = {};
    for (var r = hdr + 1; r < v.length; r++){
      var k = norm_(v[r][cKey]); if (!k) continue;
      var m = String(v[r][cMkt] == null ? '' : v[r][cMkt]).trim();
      if (m && !(k in map)) map[k] = m;      // first match wins, VLOOKUP parity
    }
    return map;
  }

  function findTab_(ss, names){
    var sheets = ss.getSheets();
    for (var n = 0; n < names.length; n++){
      var want = norm_(names[n]);
      for (var i = 0; i < sheets.length; i++){
        var nm = norm_(sheets[i].getName());
        if (nm === want || nm.indexOf(want) === 0) return sheets[i];
      }
    }
    return null;
  }

  /* ---------- turn a CPI grid into (market|year|month) buckets ----------
     APPLIED is now read straight off the row: a line either carries a fuel
     surcharge or it does not, and only its own tonnes count as applied. That is
     the whole point of moving source - it used to be inferred from a bucket. */
  function buildCells_(grid, mktOf, unknownLabel, otherRev){
    /* hr, not 0: the tab sums ABOVE its header (see headerRow_) */
    var hr = headerRow_(grid);
    var c  = cpiCols_(grid[hr], hr + 1);
    var first = hr + 1;                      // first data row

    /* the newest year in the file decides which Rev column belongs to a row */
    var yMax = 0;
    for (var s0 = first; s0 < grid.length; s0++){
      var y0 = Math.round(toNum_(grid[s0][c.year]));
      if (y0 > yMax) yMax = y0;
    }

    /* ---- replicate the sheet's New Fuel Surcharge ARRAYFORMULA ----------
       The sheet does not store a raw surcharge per row. It takes the Other
       Revenue total for the row's LOOKUP KEY and spreads it across that key's
       rows in proportion to volume, falling back to the Combined file's own
       "Fuel Surchage" column when the key is absent from Other Revenue:

         vol   = the volume column for this row's year
         denom = SUMIF(key) of that same volume column
         src   = SUMIF(Other Revenue, key)
         fsc   = key in Other Revenue ? (denom ? src*vol/denom : 0) : rawFsc

       Reading the LIVE sheet needs none of this - the formula has already
       evaluated and New Fuel Surcharge is a number. It matters for UPLOADS,
       where the Combined export is raw QlikView output with no formula in it,
       which is why the Other Revenue export is still required. */
    var denom = null;
    if (otherRev && c.key >= 0){
      denom = { hi:{}, lo:{} };
      var vHi = c.vol[yMax], vLo = c.vol[yMax - 1];
      for (var q = first; q < grid.length; q++){
        var kq = norm_(grid[q][c.key]); if (!kq) continue;
        if (vHi != null) denom.hi[kq] = (denom.hi[kq] || 0) + toNum_(grid[q][vHi]);
        if (vLo != null) denom.lo[kq] = (denom.lo[kq] || 0) + toNum_(grid[q][vLo]);
      }
    }

    var cells = {}, markets = [], seen = {}, newest = 0, unknown = {}, used = 0;
    var monthsCy = {};
    for (var r = first; r < grid.length; r++){
      var row = grid[r];
      var yr = Math.round(toNum_(row[c.year]));  if (!yr) continue;
      var mo = monthOrd_(row[c.month]);          if (!mo) continue;

      var pk = norm_(row[c.plant]);
      var mk = (pk && mktOf[pk]) || '';
      if (!mk){
        if (pk) unknown[String(row[c.plant]).trim()] = 1;
        mk = unknownLabel;                       // never silently dropped
      }

      /* volume comes from the column named for THIS row's year; the other
         year's column is zero on the same row */
      var vc  = c.vol[yr];
      var vol = (vc == null) ? 0 : toNum_(row[vc]);
      var ns  = (yr === yMax)
        ? (c.cyRev < 0 ? 0 : toNum_(row[c.cyRev]))
        : (c.pyRev < 0 ? 0 : toNum_(row[c.pyRev]));

      var fsc;
      if (denom){
        /* upload path: build it the way the sheet's formula does */
        var kr = norm_(row[c.key]);
        if (kr && (kr in otherRev)){
          var dn = (yr === yMax) ? denom.hi[kr] : denom.lo[kr];
          fsc = dn ? (otherRev[kr] * vol / dn) : 0;
        } else {
          fsc = (c.rawFsc >= 0) ? toNum_(row[c.rawFsc]) : 0;
        }
      } else if (c.fsc >= 0) fsc = toNum_(row[c.fsc]);
      else fsc = (yr === yMax ? (c.cyFsc < 0 ? 0 : toNum_(row[c.cyFsc]))
                              : (c.pyFsc < 0 ? 0 : toNum_(row[c.pyFsc])));

      if (!vol && !ns && !fsc) continue;         // padding rows
      used++;

      var applied = (fsc !== 0);                 // <> 0, matching the old flag rule
      if (!seen[mk]){ seen[mk] = true; markets.push(mk); }
      if (yr === yMax && vol !== 0){
        monthsCy[mo] = 1;                        // what the picker may offer
        if (mo > newest) newest = mo;
      }

      var key = mk + '|' + yr + '|' + mo;
      var b = cells[key] || (cells[key] = { vol:0, ns:0, fsc:0, avol:0, ans:0, afsc:0 });
      b.vol += vol; b.ns += ns; b.fsc += fsc;
      if (applied){ b.avol += vol; b.ans += ns; b.afsc += fsc; }
    }

    if (!used) throw new Error('No usable rows were found in Combined Data CPI Raw \u2014 '
      + 'every row needs a Year, a Month and a volume, revenue or surcharge figure.');

    /* THE DEFAULT MONTH IS LAST CALENDAR MONTH, NOT THE NEWEST IN THE FILE.
       This page used to report whichever month the export happened to reach,
       so on a sheet already carrying a part-billed August it published August
       while Price & Volume, Ready-Mix and RMX Fuel Recovery all published July
       — one deck, two months, and the half-month read as a collapse. Every
       other backend already resolves it this way (pvReportMonth_ in
       PV_Backend, reportMonth_ in RMX_Backend, buildCells_ in RFSC_Backend);
       this is the fourth catching up. If last month is not in the export yet,
       fall back to the newest month that is. */
    var prevCal = (new Date()).getMonth();       // 0-based month = last month, 1-12
    if (!prevCal) prevCal = 12;                  // in January, last month is December
    var monthList = Object.keys(monthsCy).map(Number).sort(function(a,b){ return a-b; });
    var latest = monthsCy[prevCal] ? prevCal : (newest || prevCal);

    var un = Object.keys(unknown);
    return { cells: cells, markets: markets, latest: latest || 1,
             monthList: monthList,
             unknownPlants: un.sort(), rows: used };
  }

  /* ---------- read the live Price & Volume sheet ---------- */
  function readData_(){
    var ss = APP_openSpreadsheet_('pricevolume');
    var sh = findTab_(ss, ['combined data cpi raw','combined data cpi','cpi raw']);
    if (!sh) throw new Error('The Price & Volume sheet is missing a tab called '
      + '"Combined Data CPI Raw", which is where fuel surcharge now comes from.');

    var values = sh.getDataRange().getValues();
    if (values.length < 2) throw new Error('The "' + sh.getName()
      + '" tab has headers but no data rows yet.');

    return buildCells_(values, plantMarkets_(ss), 'Unmapped plants');
  }

  /* Sum one market's buckets over a set of months, for one year. */
  function sum_(D, mk, yr, months){
    var t = { vol:0, ns:0, fsc:0, avol:0, ans:0, afsc:0, wVol:0, wNS:0 };
    months.forEach(function(mo){
      var b = D.cells[mk + '|' + yr + '|' + mo]; if (!b) return;
      t.vol += b.vol; t.ns += b.ns; t.fsc += b.fsc;
      t.avol += b.avol; t.ans += b.ans; t.afsc += b.afsc;
      if (b.avol > 0){ t.wVol += b.vol; t.wNS += b.ns; }   // months that actually had applied tonnes
    });
    return t;
  }

  /* ---------- Summary view (MTD / YTD, applied basis) ---------- */
  function summaryFor_(D, months){
    var rows = D.markets.map(function(mk){
      var c = sum_(D, mk, 2026, months), p = sum_(D, mk, 2025, months);
      var f26 = c.avol ? c.fsc / c.avol : 0;
      var f25 = p.avol ? p.fsc / p.avol : 0;      // no 2025 charge → 0
      return { market: mk, totalVol: c.vol, totalFSC: c.fsc, appliedVol: c.avol,
               pctVolApplied: c.wVol ? c.avol / c.wVol : 0,
               appliedNS: c.ans, pctNSApplied: c.wNS ? c.ans / c.wNS : 0,
               fscT2026: f26, fscT2025: f25, yoy: f26 - f25 };
    });

    // TOTAL: sum components, re-derive ratios.
    var t = { totalVol:0, totalFSC:0, appliedVol:0, appliedNS:0, wv:0, wn:0, av25:0, fsc25:0 };
    D.markets.forEach(function(mk){
      var c = sum_(D, mk, 2026, months), p = sum_(D, mk, 2025, months);
      t.totalVol += c.vol; t.totalFSC += c.fsc; t.appliedVol += c.avol; t.appliedNS += c.ans;
      t.wv += c.wVol; t.wn += c.wNS; t.av25 += p.avol; t.fsc25 += p.fsc;
    });
    var tf26 = t.appliedVol ? t.totalFSC / t.appliedVol : 0;
    var tf25 = t.av25 ? t.fsc25 / t.av25 : 0;
    rows.push({ market:'TOTAL', isTotal:true, totalVol:t.totalVol, totalFSC:t.totalFSC,
                appliedVol:t.appliedVol, pctVolApplied: t.wv ? t.appliedVol / t.wv : 0,
                appliedNS:t.appliedNS, pctNSApplied: t.wn ? t.appliedNS / t.wn : 0,
                fscT2026: tf26, fscT2025: tf25, yoy: tf26 - tf25 });
    return rows;
  }

  /* ---------- By-month view (applied basis) ---------- */
  function byMonthFor_(D, mk, months){
    function line(mo){
      var c = D.cells[mk + '|2026|' + mo] || { fsc:0, avol:0 };
      var p = D.cells[mk + '|2025|' + mo] || { fsc:0, avol:0 };
      var t26 = c.avol ? c.fsc / c.avol : 0, t25 = p.avol ? p.fsc / p.avol : 0;
      return { month: MONTHS[mo-1], fscT25:t25, fsc25:p.fsc, vol25:p.avol,
               fscT26:t26, fsc26:c.fsc, vol26:c.avol, yoy: t26 - t25 };
    }
    var rows = months.map(line);
    var c = sum_(D, mk, 2026, months), p = sum_(D, mk, 2025, months);
    var a26 = c.avol ? c.fsc / c.avol : 0, a25 = p.avol ? p.fsc / p.avol : 0;
    return { rows: rows, avg: { month:'YTD Avg', isAvg:true,
             fscT25:a25, fsc25:p.fsc, vol25:p.avol,
             fscT26:a26, fsc26:c.fsc, vol26:c.avol, yoy: a26 - a25 } };
  }

  /* ---------- Executive view (Excel pivot replica) ---------- */
  function execOrder_(markets){
    return markets.slice().sort(function(a,b){
      var ia = EXEC_ORDER.indexOf(a), ib = EXEC_ORDER.indexOf(b);
      if (ia < 0 && ib < 0) return a.localeCompare(b);
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia - ib;
    });
  }

  function execTable_(D, months, basis){
    var applied = (basis === 'applied');
    var rows = execOrder_(D.markets).map(function(mk){
      var c = sum_(D, mk, 2026, months), p = sum_(D, mk, 2025, months);
      var t26 = applied ? c.avol : c.vol, t25 = applied ? p.avol : p.vol;
      // Fuel recovery DOLLARS are the same money on both bases - only the tonnes
      // change. Taking afsc as the numerator dropped every credit row, which made
      // applied recovery LARGER than all-tonnes recovery even though applied tonnes
      // are a strict subset.
      var f26 = c.fsc, f25 = p.fsc;
      var pt26 = t26 ? f26 / t26 : 0, pt25 = t25 ? f25 / t25 : 0;
      // "New business": charged in 2026 but not 2025 → 2025 $/t and YOY show N/A,
      // and this market is left out of the Grand Total's 2025 $/t.
      var newBiz = (f25 === 0);
      return { market:mk, tonnes26:t26, tonnes25:t25, fsc26:f26, fsc25:f25,
               perT26:pt26, perT25:pt25, yoy: pt26 - pt25, newBiz:newBiz };
    });

    var t = { market:'Grand Total', isTotal:true, tonnes26:0, tonnes25:0, fsc26:0, fsc25:0 };
    var t25base = 0, f25base = 0;
    rows.forEach(function(r){
      t.tonnes26 += r.tonnes26; t.tonnes25 += r.tonnes25; t.fsc26 += r.fsc26; t.fsc25 += r.fsc25;
      t25base += r.tonnes25; f25base += r.fsc25;
    });
    t.perT26 = t.tonnes26 ? t.fsc26 / t.tonnes26 : 0;
    t.perT25 = t.tonnes25 ? t.fsc25 / t.tonnes25 : 0;
    t.newBiz = (f25base === 0);
    t.yoy = t.perT26 - t.perT25;
    rows.push(t);
    return rows;
  }

/* ---------- uploaded file ----------------------------------------------
     One file now: the Combined CPI export, parsed by exactly the same rules as
     the live tab. It carries no REGION LOOKUP of its own, so the plant->market
     map still comes from the Price & Volume sheet; if that cannot be opened,
     every row lands in one bucket rather than failing outright, and the page
     says so.                                                                */
  function readUpload_(grid, other){
    if (!grid || grid.length < 2)
      throw new Error('That file looks empty \u2014 it needs a header row plus data rows.');
    if (!other || other.length < 2)
      throw new Error('The Other Revenue export is needed too \u2014 the surcharge is built from it, '
        + 'spread across each LOOKUP KEY by volume.');

    /* Other Revenue: LOOKUP KEY -> summed revenue. Duplicate keys are summed,
       and a key present at $0 still counts as present (that is what decides
       whether the Combined file's own column is used instead). */
    var oi = {}, ohr = headerRow_(other, ['lookup key','key','other revenue','revenue']);
    other[ohr].forEach(function(h,i){ var k = norm_(h); if (k && !(k in oi)) oi[k] = i; });
    var oK = pick_(oi, ['lookup key','key']),
        oR = pick_(oi, ['other revenue','revenue']);
    if (oK < 0 || oR < 0)
      throw new Error('The Other Revenue export needs a LOOKUP KEY column and an Other Revenue column. '
        + 'Its header was read as row ' + (ohr + 1) + '.');
    var map = {};
    for (var i = ohr + 1; i < other.length; i++){
      var k = norm_(other[i][oK]); if (!k) continue;
      map[k] = (map[k] || 0) + toNum_(other[i][oR]);
    }

    var mktOf = {};
    try { mktOf = plantMarkets_(APP_openSpreadsheet_('pricevolume')); } catch (e){ mktOf = {}; }
    return buildCells_(grid, mktOf, 'All plants', map);
  }

  /* ---------- Saskatchewan: recovery comes from the increase sheet ----------
     Saskatchewan has no fuel surcharge. It has a per-customer mid-year price
     increase instead, and a per-CUSTOMER rate can't be applied to the data on
     this page — it arrives already summed to Market/Year/Month. Price & Volume
     does the arithmetic per raw row and hands the monthly totals over here.

     Only Saskatchewan's current-year RECOVERY and APPLIED TONNES are replaced.
     Total volume and net sales stay whatever this page's own source says, and
     last year is left alone (the increase started this year, so there is
     nothing there to replace). The applied share of net sales is prorated from
     the applied tonnes, since the increase sheet carries no revenue of its own.

     If Saskatchewan is missing from this page's source entirely, it is added
     using Price & Volume's tonnes so the market still shows up. With no rates
     sheet configured this is a no-op and the page reads exactly as before. */
  /* newest year this page holds for a market - its cells are keyed market|year|month */
  function newestYear_(D, mk){
    var pre = mk + '|', best = 0;
    for (var k in D.cells){
      if (k.indexOf(pre) !== 0) continue;
      var y = parseInt(k.split('|')[1], 10);
      if (y > best) best = y;
    }
    return best;
  }

  function applySask_(D){
    var m = null;
    try { m = PV.saskMonthly(); }
    catch (e){
      // Say so on the page rather than showing a silent row of zeroes.
      return { configured: true, ok: false, market: 'Saskatchewan', unmatched: [], duplicates: [],
               error: 'Saskatchewan\u2019s increase could not be read from Price & Volume: '
                    + ((e && e.message) ? e.message : String(e)) };
    }
    if (!m || !m.ok) return (m && m.note) || null;

    var want = norm_(m.market), mk = null;
    for (var i = 0; i < D.markets.length; i++){
      if (norm_(D.markets[i]) === want){ mk = D.markets[i]; break; }
    }
    var isNew = !mk;
    if (isNew){ mk = m.market; D.markets.push(mk); }

    /* THE YEAR COMES FROM THIS PAGE, never from Price & Volume. That sheet keeps
       the bill year in a column of its own and its Month column is bare ("Jul"),
       so the month it hands over carries no year - keying on it filed
       Saskatchewan's recovery under year 0, a cell nothing here ever reads,
       which is why the market sat at $0 while the customer tab was correct. */
    var yr = newestYear_(D, mk) || 2026;

    for (var mo = 1; mo <= 12; mo++){
      var s = m.byMonth[mo]; if (!s) continue;
      var key = mk + '|' + yr + '|' + mo;
      var b = D.cells[key] || (D.cells[key] = { vol:0, ns:0, fsc:0, avol:0, ans:0, afsc:0 });
      if (isNew || !b.vol){ b.vol = s.vol; b.ns = s.rev; }     // no tonnes of its own here
      b.fsc = s.recovery; b.afsc = s.recovery; b.avol = s.appliedVol;
      b.ans = b.vol ? b.ns * (s.appliedVol / b.vol) : 0;
    }
    return m.note;
  }

  /* ---------- an arbitrary month window ----------------------------------
     The cells are keyed market|year|month with REAL years, so unlike the
     Price & Volume pivot (whose Month column is a bare "Jul" with the year
     living in separate CY/PY columns) this page CAN answer a window that
     crosses a year boundary. Given { from:202502, to:202604 } it reports those
     15 months against the same 15 months a year earlier.

     Returns null when the window is not usable, and the caller falls back to
     the normal MTD / YTD tables rather than showing an empty page.          */
  function windowMonths_(D, win){
    if (!win || !win.from || !win.to) return null;
    var out = [], ym = Number(win.from), to = Number(win.to), guard = 0;
    while (ym <= to && guard++ < 400){
      out.push({ y: Math.floor(ym / 100), m: ym % 100 });
      var y2 = Math.floor(ym / 100), m2 = (ym % 100) + 1;
      if (m2 > 12){ m2 = 1; y2++; }
      ym = y2 * 100 + m2;
    }
    return out.length ? out : null;
  }
  /* Sum a market over explicit (year, month) pairs, offset by `yearShift`
     years - so the same list serves both the window and its comparison. */
  function sumWin_(D, mk, pairs, yearShift){
    var t = { vol:0, ns:0, fsc:0, avol:0, ans:0, afsc:0, wVol:0, wNS:0 };
    pairs.forEach(function(p){
      var b = D.cells[mk + '|' + (p.y + yearShift) + '|' + p.m]; if (!b) return;
      t.vol += b.vol; t.ns += b.ns; t.fsc += b.fsc;
      t.avol += b.avol; t.ans += b.ans; t.afsc += b.afsc;
      if (b.avol > 0){ t.wVol += b.vol; t.wNS += b.ns; }
    });
    return t;
  }
  function summaryWin_(D, pairs){
    var rows = D.markets.map(function(mk){
      var c = sumWin_(D, mk, pairs, 0), p = sumWin_(D, mk, pairs, -1);
      var f26 = c.avol ? c.fsc / c.avol : 0, f25 = p.avol ? p.fsc / p.avol : 0;
      return { market: mk, totalVol: c.vol, totalFSC: c.fsc, appliedVol: c.avol,
               pctVolApplied: c.wVol ? c.avol / c.wVol : 0,
               appliedNS: c.ans, pctNSApplied: c.wNS ? c.ans / c.wNS : 0,
               fscT2026: f26, fscT2025: f25, yoy: f26 - f25 };
    });
    var t = { totalVol:0, totalFSC:0, appliedVol:0, appliedNS:0, wv:0, wn:0, av25:0, fsc25:0 };
    D.markets.forEach(function(mk){
      var c = sumWin_(D, mk, pairs, 0), p = sumWin_(D, mk, pairs, -1);
      t.totalVol += c.vol; t.totalFSC += c.fsc; t.appliedVol += c.avol; t.appliedNS += c.ans;
      t.wv += c.wVol; t.wn += c.wNS; t.av25 += p.avol; t.fsc25 += p.fsc;
    });
    var tf26 = t.appliedVol ? t.totalFSC / t.appliedVol : 0;
    var tf25 = t.av25 ? t.fsc25 / t.av25 : 0;
    rows.push({ market:'TOTAL', isTotal:true, totalVol:t.totalVol, totalFSC:t.totalFSC,
                appliedVol:t.appliedVol, pctVolApplied: t.wv ? t.appliedVol / t.wv : 0,
                appliedNS:t.appliedNS, pctNSApplied: t.wn ? t.appliedNS / t.wn : 0,
                fscT2026: tf26, fscT2025: tf25, yoy: tf26 - tf25 });
    return rows;
  }

  /* ---------- build the full page payload from a data bundle ----------
     `sel` is the Report month picker: 1-12 pins the report to that month, 0 or
     absent uses the default worked out in buildCells_ (last calendar month).
     MTD is that month alone, YTD is January through it, and the by-month table
     stops there too — nothing past the report month counts towards anything.
     Same contract, field for field, as RFSC_Backend's output_. */
  function output_(D, win, sel){
    var rpt = Number(sel) || 0;
    if (rpt < 1 || rpt > 12) rpt = D.latest;

    var sask = applySask_(D);
    var ytd = []; for (var m = 1; m <= rpt; m++) ytd.push(m);
    var mtd = [rpt];
    var pairs = windowMonths_(D, win);

    var byMonth = {};
    D.markets.forEach(function(mk){ byMonth[mk] = byMonthFor_(D, mk, ytd); });

    return {
      markets:     D.markets,
      latestMonth: MONTHS[rpt - 1],
      month:       rpt,                       // the month this payload is for
      defaultMonth: D.latest,                 // what "last closed" resolves to
      months:      D.monthList || [],         // what the picker may offer
      monthNames:  MONTHS,
      summary: { MTD: summaryFor_(D, mtd), YTD: summaryFor_(D, ytd) },
      exec: {
        MTD: { all: execTable_(D, mtd, 'all'), applied: execTable_(D, mtd, 'applied') },
        YTD: { all: execTable_(D, ytd, 'all'), applied: execTable_(D, ytd, 'applied') }
      },
      byMonth: byMonth,
      /* present only when a window was asked for; the page keeps MTD and YTD
         either way, so nothing downstream has to change to ignore it */
      window: pairs ? { from:win.from, to:win.to, months:pairs.length,
                        summary: summaryWin_(D, pairs) } : null,
      sask: sask || null,
      source: 'Combined Data CPI Raw',
      /* plants with no REGION LOOKUP row: their tonnes and dollars are still in
         the totals, under "Unmapped plants", instead of vanishing */
      unknownPlants: D.unknownPlants || [],
      rowsRead: D.rows || 0
    };
  }


  /* ---------- THE READ IS CACHED, LIKE EVERY OTHER BACKEND'S ----------
     readData_() did a full getDataRange().getValues() of the raw tab on EVERY
     call, and the entry point below had no result cache either. So this page
     re-read tens of thousands of rows out of Sheets on every open, every '↻
     Update from source', and once more for each of the deck's fuel slides.
     Nothing else in the suite does that: PV.getReport, RMX and the Overview all
     answer from a cached result first and only touch the sheet on a miss.

     Both layers are cached now, and both keys carry APP_getGen_ - the source
     workbook's modified time plus the code build stamp - so a sync or a code
     change strands them by itself and there is nothing to invalidate by hand.
     UPLOADS ARE NEVER CACHED: that is one user's session.
  ------------------------------------------------------------------- */
  function gkFsc_(key){
    var gen = '0';
    try { gen = APP_getGen_('pricevolume') || '0'; }
    catch (e) {
      /* '0' is not "no cache" — it is a key every generation shares, so an
         entry written under it outlives the data it describes. */
      APP_log('warn', 'APP.cacheKey', 'no data generation — every generation will share one cache key',
              { page: 'pricevolume', error: String(e) });
    }
    return 'fsc|g' + gen + '|' + key;
  }
  /* The chunked cache helpers live in Code.gs. Every .gs file shares one global
     scope, so at request time they are there - but a missing helper must never be
     what takes this page down, so both are reached through a guard and a failure
     just means "not cached". */
  function cGet_(k){
    try { return (typeof APP_cacheGet_ === 'function') ? APP_cacheGet_(k) : null; }
    catch (e){ return null; }
  }
  function cPut_(k, v){
    try { if (typeof APP_cachePut_ === 'function') APP_cachePut_(k, v); } catch (e){}
  }
  function cachedRead_(){
    var ck = gkFsc_('data');
    var hit = cGet_(ck);
    if (hit) return hit;
    var D = readData_();
    cPut_(ck, D);
    return D;
  }

  /* ---------- the two calls the page makes ---------- */
  function getFscData(opts){
    opts = opts || {};
    var win = opts.window || (opts.from ? opts : null);
    var ck = gkFsc_('out|' + JSON.stringify(win || null) + '|m' + (opts.month || 0));
    var hit = cGet_(ck); if (hit) return hit;
    var out = output_(cachedRead_(), win, opts.month);
    cPut_(ck, out);
    return out;
  }
  /* The page may still send { combined, other } from the old two-file uploader;
     only the combined grid is used now, and a lone grid is accepted too. */
  function getFscDataFromUpload(p){
    var grid = p && (p.combined || p.grid || p.cpi);
    if (!grid) throw new Error('Upload the Combined CPI export.');
    return output_(readUpload_(grid, p.other), p.window || null, p && p.month);
  }

  return { getFscData: getFscData, getFscDataFromUpload: getFscDataFromUpload };
})();

/* Top-level wrappers the page calls via google.script.run.
   Logged so the Executions page always shows whether the call arrived. */
function getFscData(opts){
  var t0 = Date.now();
  APP_log('info', 'FSC.getFscData', 'reading', { month: (opts && opts.month) || 0 });
  try {
    var out = FSC.getFscData(opts);
    APP_log('info', 'FSC.getFscData', 'ok',
            { ms: Date.now() - t0, rows: out.markets.length,
              month: (opts && opts.month) || 0, latest: out.latestMonth });
    return out;
  } catch (err) {
    /* §7: an error logs the CONTEXT, not just the message — the month is what
       selects the data, so a failure that only happens on one of them is
       readable off the line rather than reproduced. */
    APP_log('error', 'FSC.getFscData', 'failed',
            { ms: Date.now() - t0, month: (opts && opts.month) || 0,
              error: String(err && err.message ? err.message : err) });
    throw err;
  }
}
function getFscDataFromUpload(p){
  try {
    console.log('[FSC] getFscDataFromUpload: start');
    var out = FSC.getFscDataFromUpload(p);
    console.log('[FSC] upload: ok \u00b7 ' + out.markets.length + ' markets \u00b7 latest ' + out.latestMonth);
    return out;
  } catch (err) {
    console.error('[FSC] getFscDataFromUpload failed: ' + (err && err.message ? err.message : err));
    throw err;
  }
}

/* ---- Sask_Backend.gs ---------------------------------------------------------
   The Saskatchewan rate table, read through PV. getSaskRatesStatus is BOTH an
   editor tool and, since chunk 19, the readout under the saskrates row in the
   Settings modal — it took until then for the second half of its own comment to
   become true. It follows APP_EXTRA_SOURCES rather than a page list, so it
   appears on exactly the pages that read the sheet.  */

/*****************************************************************************
 * SASKATCHEWAN MID-YEAR INCREASE — the rates sheet
 * ---------------------------------------------------------------------------
 * Saskatchewan doesn't run a fuel surcharge. Instead each customer got a
 * mid-year PRICE INCREASE of so many dollars per tonne, effective from its own
 * start date, tracked in a separate Google Sheet:
 *
 *     Customer                              Increase Amount ($/tn)   Start Date
 *     SASKATOON READY MIX - P4L10                             0.43   2026-05-01
 *     HEIDELBERG MATERIALS CANADA LIMITED - 113002            0.75   2026-06-01
 *
 * Recovery is simply  rate x tonnes billed on or after the start date, which
 * is exactly how the tracking sheet's own "Actual Recovery YTD" column is
 * built (48,872.12 t x $0.43 = $21,015.01).
 *
 * THIS FILE ONLY READS AND MATCHES. The arithmetic happens in PV_Backend.gs,
 * per raw row, so the Price & Volume customer tab and the Fuel Recovery page
 * both get it from one place.
 *
 * MATCHING is on Sold To, one sheet row to one customer. Names are compared
 * with everything that could differ stripped out — case, single vs double
 * spaces, non-breaking spaces, the fancy dashes Excel likes to insert, dots
 * and brackets — so "F. PETERS EXCAVATING (1996) LTD - 73544" still matches
 * "F PETERS EXCAVATING (1996) LTD  -  73544". Failing that, the trailing
 * account code (P4L10, 113002) is tried on its own, but only when that code
 * is unique in the sheet. Anything that still matches nothing is reported to
 * the pages, which show it in a notice rather than silently dropping it.
 *
 * SET IT UP: paste the sheet link into the Settings modal against
 * "Saskatchewan Increase Tracking", or set
 * APP_CONFIG.PAGES.saskrates.defaultSpreadsheetId in Config.gs. Until then
 * this module reports "not configured" and both pages behave exactly as
 * they do today.
 *
 * AFTER EDITING THE SHEET press "Update from source" on Price & Volume —
 * the rates ride along in the same cached pivots as the rest of the data.
 *****************************************************************************/
var SASKRATES = (function () {

  var MEMO = null;                       // one read per execution, that's all it needs

  function cfg_()    { return (APP_CONFIG.PAGES && APP_CONFIG.PAGES.saskrates) || {}; }
  function market_() { return String(cfg_().MARKET || 'Saskatchewan'); }

  /* ---------- text handling ---------- */
  function clean_(s) {
    return String(s == null ? '' : s)
      .replace(/\u00A0/g, ' ')                    // non-breaking space
      .replace(/[\u2010-\u2015\u2212]/g, '-')     // en/em dashes, minus sign -> hyphen
      .replace(/\s+/g, ' ')
      .trim();
  }
  /* the comparison key: letters and digits only, so spacing and punctuation
     can never decide whether two names are the same customer */
  function key_(s) { return clean_(s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  /* trailing account code — the part after the last dash ("... - P4L10") */
  function code_(s) {
    var t = clean_(s), i = t.lastIndexOf('-');
    if (i < 0) return '';
    var c = t.slice(i + 1).toUpperCase().replace(/[^A-Z0-9]/g, '');
    return (c.length >= 4) ? c : '';            // too short to be an id
  }

  function toNum_(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    var n = parseFloat(String(v).replace(/[$,\s]/g, '').replace(/\(/g, '-').replace(/\)/g, ''));
    return isNaN(n) ? 0 : n;
  }

  var MON = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };

  /* a date (or a typed "May-26" / "2026-05-01") -> {ym: year*12+month, mon: 1-12} */
  function startOf_(v) {
    if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v))
      return { ym: v.getFullYear() * 12 + (v.getMonth() + 1), mon: v.getMonth() + 1 };
    var s = clean_(v).toLowerCase(); if (!s) return null;
    var year = 0, ym = s.match(/(19|20)\d{2}/); if (ym) year = parseInt(ym[0], 10);
    var mon = 0;
    for (var k in MON) { if (s.indexOf(k) !== -1) { mon = MON[k]; break; } }
    if (!mon) {                                   // numeric forms: 2026-05-01, 5/1/2026
      var parts = s.split(/[^0-9]+/).filter(function (x) { return x !== ''; });
      for (var i = 0; i < parts.length; i++) {
        var n = parseInt(parts[i], 10);
        if (n >= 1 && n <= 12 && String(n) !== String(year)) { mon = n; break; }
      }
    }
    if (!mon) return null;
    return { ym: (year || 0) * 12 + mon, mon: mon };
  }

  /* ---------- read the sheet ---------- */
  function pickTab_(ss) {
    var want = clean_(cfg_().SHEETS && cfg_().SHEETS.RATES);
    if (want) {
      var sh = ss.getSheetByName(want);
      if (!sh) throw new Error('The Saskatchewan increase sheet has no tab called "' + want +
        '". Check the tab name at the bottom of the sheet, or clear SHEETS.RATES in Config.gs to use the first tab.');
      return sh;
    }
    var all = ss.getSheets();
    if (!all.length) throw new Error('The Saskatchewan increase sheet has no tabs.');
    return all[0];
  }

  /* The real header sits below a blank row in the sample file, so the first
     8 rows are scanned for it rather than assuming row 1. */
  function headerRow_(values) {
    var limit = Math.min(8, values.length);
    for (var r = 0; r < limit; r++) {
      var row = values[r], hasCust = false, hasRate = false;
      for (var c = 0; c < row.length; c++) {
        var t = clean_(row[c]).toLowerCase();
        if (!t) continue;
        if (/^customer\b/.test(t)) hasCust = true;
        if (t.indexOf('increase amount') !== -1 || t.indexOf('$/tn') !== -1 ||
            t.indexOf('$/t') !== -1 || /^rate\b/.test(t)) hasRate = true;
      }
      if (hasCust && hasRate) return r;
    }
    return -1;
  }

  function read_() {
    if (MEMO) return MEMO;

    var out = { ok: false, configured: false, market: market_(), rows: [],
                byKey: {}, byCode: {}, duplicates: [], error: '' };

    var ss = APP_openSpreadsheetOptional_('saskrates');
    if (!ss) return (MEMO = out);                 // not set up: silently inert
    out.configured = true;

    try {
      var sh = pickTab_(ss);
      var values = sh.getDataRange().getValues();
      var hr = headerRow_(values);
      if (hr < 0) throw new Error('No header row was found in the "' + sh.getName() +
        '" tab \u2014 it needs a "Customer" column and an "Increase Amount ($/tn)" column.');

      var cCust = -1, cRate = -1, cStart = -1;
      values[hr].forEach(function (h, i) {
        var t = clean_(h).toLowerCase(); if (!t) return;
        if (cCust  < 0 && /^customer\b/.test(t)) cCust = i;
        if (cRate  < 0 && (t.indexOf('increase amount') !== -1 || t.indexOf('$/tn') !== -1 ||
                           t.indexOf('$/t') !== -1 || /^rate\b/.test(t))) cRate = i;
        if (cStart < 0 && t.indexOf('start') !== -1) cStart = i;
      });
      if (cCust < 0 || cRate < 0) throw new Error('The "' + sh.getName() +
        '" tab needs a Customer column and an Increase Amount ($/tn) column.');
      if (cStart < 0) throw new Error('The "' + sh.getName() +
        '" tab needs a Start Date column \u2014 without it there is no way to know which tonnes the increase applies to.');

      var seenKey = {}, codeCount = {};
      for (var r = hr + 1; r < values.length; r++) {
        var name = clean_(values[r][cCust]);
        if (!name) continue;
        var low = name.toLowerCase();
        if (low === 'total' || low === 'totals' || low === 'grand total') continue;

        var rate = toNum_(values[r][cRate]);
        var st   = startOf_(values[r][cStart]);
        if (!rate || !st) continue;               // no rate or no start date = nothing to apply

        var k = key_(name);
        if (seenKey[k]) { out.duplicates.push(name); continue; }   // one customer, one rate
        seenKey[k] = true;

        var entry = { name: name, rate: rate, startYm: st.ym, startMon: st.mon, code: code_(name) };
        out.rows.push(entry);
        out.byKey[k] = entry;
        if (entry.code) codeCount[entry.code] = (codeCount[entry.code] || 0) + 1;
      }

      /* the account code is only safe to match on when it is unique here */
      out.rows.forEach(function (e) { if (e.code && codeCount[e.code] === 1) out.byCode[e.code] = e; });

      out.ok = out.rows.length > 0;
      if (!out.ok) out.error = 'No usable rows were found in the "' + sh.getName() +
        '" tab \u2014 every row needs a customer, an increase amount and a start date.';
    } catch (err) {
      out.error = (err && err.message) ? err.message : String(err);
    }
    return (MEMO = out);
  }

  /* ---------- what the backends use ----------
     A matcher is a fresh object each time, so the "matched nothing" list is
     about THIS pass over the data and never leaks between requests. */
  function matcher() {
    var R = read_(), hit = {};

    function find(soldTo) {
      if (!R.ok) return null;
      var e = R.byKey[key_(soldTo)];
      if (!e) { var c = code_(soldTo); if (c) e = R.byCode[c]; }
      if (e) hit[e.name] = true;
      return e || null;
    }
    function note() {
      var unmatched = R.rows.filter(function (e) { return !hit[e.name]; })
                            .map(function (e) { return e.name; });
      return { configured: R.configured, ok: R.ok, market: R.market,
               customers: R.rows.length, matched: R.rows.length - unmatched.length,
               unmatched: unmatched, duplicates: R.duplicates, error: R.error };
    }
    return { ok: R.ok, market: R.market, find: find, note: note };
  }

  /* Does a bill month fall on or after a rate's start date?
     monthYm comes from PV's monthKey_ (year*12+month). Sheets that carry the
     month WITHOUT a year fall back to comparing the month on its own. */
  function inEffect(monthYm, entry) {
    if (!entry) return false;
    if (monthYm > 12) return monthYm >= entry.startYm;
    return monthYm >= entry.startMon;
  }

  /* A short fingerprint of what the sheet currently says. Anything that caches
     work derived from these rates keys on it, so an edit to a rate or a start
     date shows up on the next page load instead of waiting on a data refresh. */
  function version() {
    var R = read_();
    if (!R.configured) return 'off';
    if (!R.ok) return 'err';
    var s = '';
    R.rows.forEach(function (e) { s += e.name + '\u0001' + e.rate + '\u0001' + e.startYm + '\u0002'; });
    var d = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s);
    var h = ''; for (var i = 0; i < 6; i++) h += ('0' + (d[i] & 255).toString(16)).slice(-2);
    return R.rows.length + '-' + h;
  }

  function status() { var R = read_(); return matcher().note(); }

  return { matcher: matcher, inEffect: inEffect, status: status, market: market_, version: version };
})();

/* Top-level wrapper so the Settings screen (and a quick manual run) can check
   the sheet without loading a whole page. */
function getSaskRatesStatus() { return SASKRATES.status(); }



/* ============================================================================
 * §7  RMX — Ready-Mix
 * ----------------------------------------------------------------------------
 * Ready-Mix Price & Volume, its lookup suggester, and RMX Fuel Recovery.
 *
 * TWO NAMES HERE ARE DELIBERATE AND LOOK LIKE MISTAKES. RMX_NS captures the
 * namespace object this section builds, and every entry point goes through it
 * rather than through the ambient RMX — that was insurance against a second file
 * declaring RMX and winning. After the merge there IS no second file, but the
 * capture stays: removing it is a refactor with no gate, not part of a move.
 * And getRmxCrossReport is not called getCrossReport because that top-level name
 * already belongs to §6.
 *
 * RMX's norm_ IS THE STRICTEST IN THE SUITE and that is deliberate: it alone
 * strips zero-width characters and a BOM, drops the leading apostrophe Sheets
 * uses to mark a cell as text, and straightens curly quotes. Ready-Mix keys come
 * from hand-maintained mapping tabs, which is where all four of those actually
 * turn up. Do not "simplify" it to match §6's — see the file header, item 4, and
 * tests/helpers.js, which pins every one of those characters to an expected
 * answer.
 * ============================================================================ */

/* ---- RMX_Backend.gs ----------------------------------------------------------
   Verbatim, less the four debug functions and the three IIFE exports that existed
   only to feed one of them. See PLAN.md §7.  */

/*****************************************************************************
 * AMRIZE RMX — backend (namespaced as RMX)
 * ---------------------------------------------------------------------------
 * Original RMX backend, unchanged except that:
 *   1. it is wrapped in an IIFE so its helpers cannot collide with PV, and
 *   2. its sheet opener now reads the Settings-chosen sheet (APP_openSpreadsheet_).
 * This app owns the generation-token cache the whole suite standardises on:
 * getKeys() returns key rows once and the client regroups locally; syncData()
 * is the only path that re-reads the spreadsheet.
 *****************************************************************************/
var RMX = (function () {

/****************************************************************
 * Amrize RMX — Price & Volume web app (computes from RAW tabs)
 * Reads: Main Raw Data, Extra Raw Data, Associate Raw Data,
 *        PLANT LOOKUP, PRODUCT MASTER, EXTRAS LOOKUP
 * and reproduces BASE / ALL-IN ASP, PPI, MIX EFFECT, the ASP
 * bridge, and the Extras/VAP analysis.
 *
 * CACHING MODEL
 * -------------
 *  - Parsed lookups + ALL parsed rows (main/extras/assoc, every month)
 *    are cached ONCE in CacheService (chunked, 6h TTL).
 *  - Period (MTD/YTD) is now a query-time filter, exactly like market:
 *    rows carry a `month` ordinal, MTD scopes to bundle.latestMonth,
 *    YTD applies no month filter. Switching period never re-reads the sheet.
 *  - getKeys() returns the per-market KEY ROWS once; the client
 *    does all breakdown grouping locally, so changing "break down
 *    by" never hits the server or the sheet.
 *  - syncData() bumps a generation token (instant invalidation of
 *    every cache key) and re-warms the data bundle. This is the
 *    ONLY path that re-reads the spreadsheet.
 ****************************************************************/

/* Returned with every payload so the page can tell, without anyone guessing,
   WHICH copy of this file is actually answering. Bump it whenever this file
   changes in a way the page cares about. */
var BUILD = 'rmx-2026-08-12-top10-plants';

var CONFIG = {
  // Sheet/tab names + the data-source sheet now live centrally in Config.gs.
  // `SHEETS` is a getter so it always reflects APP_CONFIG at call time.
  get SHEETS(){ return APP_CONFIG.PAGES.rmx.SHEETS; },
  APPLIED_BASE_CY: null,   // null => total CY concrete m3 across all markets (≈714,957). Override to match sheet exactly.
  APPLIED_BASE_PY: null,   // null => total PY concrete m3 across all markets (≈947,519).
  MAX_DIMS: 24,            // effectively unlimited (only 4 breakdowns exist); grouping happens client-side
  CACHE_TTL: 21600,        // 6 hours
  CACHE_VER: 'v18',  // bumped: RMX_prepare warms every selection off ONE bundle read,
                     // and the per-selection key is built in one place (selKey_).
                     // v17: getKeys / getExtras / getSlideTables cache their own
                     // FINISHED payload per market+period+month (selCached_), the way
                     // PV.getReport and getCrossReport already do. New key shape.
                     // v16: the bundle now carries latestMonth (the REPORT month) and
                     // months (what the picker may offer). A v15 bundle was written
                     // BEFORE `months` existed, and a cached one with the field missing
                     // is what made the month picker read "Latest" with no month and the
                     // period filter fall back to "every row". See bundleOk_ below - the
                     // shape is now checked on read, so a version bump is a belt to that
                     // brace rather than the only thing standing between the two shapes.
  BREAKDOWNS: [
    { key:'SUBMARKET', label:'Submarket' },
    { key:'SEGMENT',   label:'Major Project Segment' },
    { key:'STRENGTH',  label:'Strength Class' },
    { key:'CLASS',     label:'Product Class' },
    /* PLANT is NOT a key-grain dimension - see plantRows_ below. It rides its
       own pre-rolled list in getKeys, and the page shows the TOP TEN of it. */
    { key:'PLANT',     label:'Top 10 Plants' }
  ]
};

/* doGet + getLogo are now handled centrally in Code.gs */

/* =================== small utils =================== */
function norm_(s){
  return String(s == null ? '' : s)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')   // zero-width chars + BOM
    .replace(/\u00A0/g, ' ')                  // non-breaking space -> normal space
    .replace(/^['\u2018\u2019`]+/, '')        // leading apostrophes / text-format marker
    .replace(/[\u2018\u2019]/g, "'")          // curly single quotes -> straight
    .replace(/[\u201C\u201D]/g, '"')          // curly double quotes -> straight
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
function toNum_(v){
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  var s = String(v).replace(/[$,%\s]/g,'').replace(/[()]/g, function(m){ return m==='('?'-':''; });
  if (s === '-' || s === '') return 0;
  var n = parseFloat(s); return isNaN(n) ? 0 : n;
}
function openBook_(){
  // CONSOLIDATED SUITE: always read from the sheet chosen in Settings (Code.gs).
  return APP_openSpreadsheet_('rmx');
}
function sheetByName_(ss, name){
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  var want = norm_(name), all = ss.getSheets();
  for (var i=0;i<all.length;i++) if (norm_(all[i].getName()) === want) return all[i];
  return null;
}
function indexValues_(values, mustHave){
  var hdrRow = 0;
  for (var r=0; r<Math.min(8, values.length); r++){
    var rowNorm = values[r].map(norm_);
    var ok = true;
    for (var m=0; m<(mustHave||[]).length; m++){
      if (rowNorm.indexOf(norm_(mustHave[m])) === -1){ ok = false; break; }
    }
    if (ok && (mustHave && mustHave.length)){ hdrRow = r; break; }
  }
  var idx = {};
  values[hdrRow].forEach(function(h,i){ if (h !== '' && h != null) idx[norm_(h)] = i; });
  return { values: values, hdr: hdrRow, idx: idx };
}
function readSheet_(name, mustHave){
  var ss = openBook_();
  var sh = sheetByName_(ss, name);
  if (!sh) throw new Error('Sheet not found: ' + name);
  return indexValues_(sh.getDataRange().getValues(), mustHave);
}
function col_(sheet, name){ var i = sheet.idx[norm_(name)]; return (i==null?-1:i); }
function firstCol_(sheet, names){
  for (var i=0;i<names.length;i++){ var c = col_(sheet, names[i]); if (c !== -1) return c; }
  throw new Error('Missing column (looked for: ' + names.join(', ') + ')');
}


/* =================== chunked cache + generation =================== */
var _GEN = null;
/* The version IS the source sheet's modified time (Code.gs). It moves when
   the data behind this page actually changes — a sync, or somebody typing
   into a lookup tab — and not otherwise, so an unchanged sheet keeps every
   cached table valid however many times anything is pressed. */
function generation_() {
  if (_GEN != null) return _GEN;
  try { _GEN = APP_sourceStamp_('rmx') || '1'; } catch (e) { _GEN = '1'; }
  return _GEN;
}
/* Nothing to bump: whatever just wrote to the sheet moved its modified time.
   Forget the copy we are holding so the next read sees it. */
function bumpGeneration_() {
  _GEN = null;
  try { APP_forgetStamp_('rmx'); }
  catch (e) { APP_log('warn', 'RMX.bumpGeneration', 'generation moved but the source stamp did not — ' +
                      'freshness checks will disagree with the cache', { error: String(e) }); }
  return generation_();
}
function cacheKey_(parts){ return CONFIG.CACHE_VER + '|g' + generation_() + '|' + parts.join('|'); }

function cachePut_(key, obj){
  try {
    var cache = CacheService.getScriptCache();
    var str = JSON.stringify(obj);
    var CHUNK = 90000;                       // stay under the 100KB/value cap
    var n = Math.ceil(str.length / CHUNK);
    if (n > 250) return;                      // too big to cache safely; skip (will recompute)
    var entries = {};
    entries[key + '__meta'] = String(n);
    for (var i=0;i<n;i++) entries[key + '__' + i] = str.substring(i*CHUNK, (i+1)*CHUNK);
    cache.putAll(entries, CONFIG.CACHE_TTL);
  } catch(e){ /* best effort: ignore cache failures */ }
}
function cacheGet_(key){
  try {
    var cache = CacheService.getScriptCache();
    var meta = cache.get(key + '__meta');
    if (!meta) return null;
    var n = parseInt(meta, 10);
    var ids = []; for (var i=0;i<n;i++) ids.push(key + '__' + i);
    var got = cache.getAll(ids);
    var parts = [];
    for (var j=0;j<n;j++){ var p = got[key + '__' + j]; if (p == null) return null; parts.push(p); }
    return JSON.parse(parts.join(''));
  } catch(e){ return null; }
}

/* =================== per-selection cache ===================
 * ONE FINISHED PAYLOAD PER SELECTION, not one raw bundle per request.
 *
 * Everything on this page is computed from `loadDataCached_()`, the whole
 * Ready-Mix dataset as one cached object. That object is the right thing to
 * cache — it is read once instead of forty thousand rows being pulled out of
 * Sheets again — but it was the ONLY thing cached, and it is several megabytes.
 * So every getKeys / getExtras / getSlideTables call, including the ones that
 * asked for a market somebody had already looked at a minute earlier, paid for:
 *
 *   · the chunked CacheService read (one get per 90 KB),
 *   · JSON.parse of the whole dataset,
 *   · keyRows_ / ppiMaps_ / plantRows_ over every row of it.
 *
 * The Aggregates side has never done that: PV.getReport caches the FINISHED
 * report for the exact selection and returns it before it touches the pivot,
 * which is the whole reason Price & Volume feels instant next to Ready-Mix.
 * getCrossReport (the Overview's Ready-Mix panels) already copies that pattern.
 * These three are the ones that never got it.
 *
 * The entry is per market + period + month, and cacheKey_ already folds in the
 * workbook's modified time and CACHE_VER — so a sync or a code change strands
 * every one of them at once and there is nothing to invalidate by hand.
 *
 * UPLOADS ARE NEVER CACHED HERE. "Run on my own QlikView files" is one user's
 * session; its bundle has its own key (upKey_) that deliberately leaves the
 * generation out, and the payloads computed from it must not be handed to
 * anybody else. Same rule as PV.getReport.
 */
/* THE KEY, IN ONE PLACE. prepareAll() writes these entries and getKeys /
   getExtras / getSlideTables read them, so the two must agree exactly. Two
   copies of a cache key is how you ship a warm pass that writes where nothing
   reads: everything looks like it worked and every request still recomputes. */
function selKey_(kind, period, month, market){
  return [kind, (period === 'MTD') ? 'MTD' : 'YTD',
          'm' + (Number(month) || 0), market || 'auto'];
}

function selCached_(parts, opts, build){
  var ck = opts.upload ? null : cacheKey_(parts);
  if (ck && !opts.force){ var hit = cacheGet_(ck); if (hit) return hit; }
  var out = build();
  if (ck) cachePut_(ck, out);
  return out;
}

/* =================== unmapped-row collector ===================
 * Every lookup miss is recorded once per distinct cell value, with a row
 * count and totals, so the Mapping check card can show exactly what needs
 * adding to PRODUCT MASTER / EXTRAS LOOKUP / CUSTOM FLAG. Collected inside
 * the loaders, so it costs no extra sheet reads and rides along on the
 * cached bundle (uploaded QlikView files included). */
function newUnmapped_(){ return { product:{}, extras:{}, flag:{} }; }

function noteUnmapped_(bag, kind, value, market, nums, hier3){
  if (!bag) return;
  var v = String(value == null ? '' : value).trim();
  if (!v) return;                       // a blank cell isn't a mapping problem
  var map = bag[kind], k = norm_(v), g = map[k];
  if (!g) g = map[k] = { value:v, rows:0, markets:{}, h3:{}, cyVol:0, pyVol:0, cyRev:0, pyRev:0 };
  g.rows++;
  var m = String(market||'').trim(); if (m) g.markets[m] = true;
  var h = String(hier3||'').trim();     // EXTRAS only: the mat_prod_hier_3 it sits under
  if (h) g.h3[h] = true;
  g.cyVol += nums.cyVol||0; g.pyVol += nums.pyVol||0;
  g.cyRev += nums.cyRev||0; g.pyRev += nums.pyRev||0;
}

function finishUnmapped_(bag){
  function list(map){
    return Object.keys(map).map(function(k){
      var g = map[k];
      return { value:g.value, rows:g.rows, markets:Object.keys(g.markets).sort(),
               hier3:Object.keys(g.h3).sort(),
               cyVol:g.cyVol, pyVol:g.pyVol, cyRev:g.cyRev, pyRev:g.pyRev };
    }).sort(function(a,b){                 // biggest money impact first
      return (Math.abs(b.cyRev)+Math.abs(b.pyRev)) - (Math.abs(a.cyRev)+Math.abs(a.pyRev));
    });
  }
  return { product:list(bag.product), extras:list(bag.extras), flag:list(bag.flag) };
}

/* =================== lookups (cached) =================== */
function buildLookups_(){
  var plant = {}, product = {}, extras = {};
  var p = readSheet_(CONFIG.SHEETS.PLANT, ['plant','market']);
  var pPlant=col_(p,'plant'), pReg=col_(p,'region'), pSub=col_(p,'subregion'),
      pMkt=col_(p,'market'), pSm=col_(p,'submarket');
  for (var i=p.hdr+1;i<p.values.length;i++){
    var row=p.values[i], k=String(row[pPlant]||'').trim(); if(!k) continue;
    k=k.toUpperCase();
    if (k in plant) continue;   // VLOOKUP parity: first match wins on duplicates
    plant[k] = { region: row[pReg], subregion: row[pSub], market: row[pMkt], submarket: row[pSm] };
  }
  var pm = readSheet_(CONFIG.SHEETS.PRODUCT, ['product code','strength class']);
  var cCode=col_(pm,'product code'), cStr=col_(pm,'strength class'),
      cCls=col_(pm,'new product class'), cApp=col_(pm,'new product application');
  for (var j=pm.hdr+1;j<pm.values.length;j++){
    var rw=pm.values[j], code=String(rw[cCode]||'').trim(); if(!code) continue;
    code=code.toUpperCase();
    if (code in product) continue;   // VLOOKUP parity: first match wins on duplicates
    product[code] = { strength: rw[cStr]||'Others', cls: rw[cCls]||'Others', app: rw[cApp]||'Others' };
  }
  var el = readSheet_(CONFIG.SHEETS.EXTRASLU, ['material (mat_descr)']);
  var eCat = firstCol_(el, ['category','catergory','new bucket']);
  var eMat = firstCol_(el, ['material (mat_descr)','mat_descr','material']);
  for (var k2=el.hdr+1; k2<el.values.length; k2++){
    var er=el.values[k2];
    var bucket=String(er[eCat]||'').trim(), mat=String(er[eMat]||'').trim();
    if (!mat || !bucket) continue;
    var kFull = norm_(mat);
    if (!(kFull in extras)) extras[kFull] = { type: bucket };
    var dash = mat.indexOf(' - ');
    if (dash > 0){
      var kShort = norm_(mat.substring(dash + 3));
      if (kShort && !(kShort in extras)) extras[kShort] = { type: bucket };
    }
  }
  var customFlag = {};
  var cf = readSheet_(CONFIG.SHEETS.CUSTOMFLAG, ['mat_descr','custom flag']);
  var cfDescr=col_(cf,'mat_descr'), cfFlag=col_(cf,'custom flag');
  for (var k3=cf.hdr+1;k3<cf.values.length;k3++){
    var cr=cf.values[k3], d=String(cr[cfDescr]||'').trim(); if(!d) continue;
    customFlag[norm_(d)] = String(cr[cfFlag]||'').trim() || 'Other';
  }
  return { plant: plant, product: product, extras: extras, customFlag: customFlag };
}

function getLookupsCached_(force){
  var key = cacheKey_(['lookups']);
  if (!force){ var c = cacheGet_(key); if (c) return c; }
  var LK = buildLookups_();
  cachePut_(key, LK);
  return LK;
}
function marketsOf_(LK){
  var mk = {};
  for (var k in LK.plant){ var m = String(LK.plant[k].market||'').trim(); if (m) mk[m] = true; }
  return Object.keys(mk).sort();
}

function productCode_(productMix){
  // sheet: =IF(TRIM(K)="-","-", IFERROR(TRIM(LEFT(K, FIND(" - ", K) - 1)), K))
  var s = String(productMix==null?'':productMix);
  if (s.trim()==='-') return '-';
  var p = s.indexOf(' - ');
  return (p>0 ? s.substring(0,p) : s).trim();
}
function dimsForPlant_(LK, plant){
  var hit = LK.plant[String(plant||'').trim().toUpperCase()];
  return hit || { region:'', subregion:'', market:'', submarket:'' };
}
function dimsForProduct_(LK, productMix){
  // SHEET PARITY — the trimming pivot's exact formula:
  //   =if($K2=0, "Others", vlookup(code, 'PRODUCT MASTER'!..., n, false))
  // 1) blank / 0 Product Mix  -> "Others" outright (never reaches the lookup)
  var mixS = String(productMix==null?'':productMix).trim();
  if (mixS==='' || mixS==='0') return { strength:'Others', cls:'Others', app:'Others' };
  // 2) everything else — INCLUDING mix "-" — goes through the PRODUCT MASTER
  //    lookup exactly like the sheet's VLOOKUP (first matching row wins).
  //    A miss is the sheet's #N/A: its own bucket, never merged into Others
  //    server-side (the website's Combined toggle merges display-side).
  var code = productCode_(mixS);
  var hit = LK.product[code.toUpperCase()];
  return hit || { strength:'#N/A', cls:'#N/A', app:'#N/A', miss:true };
}
/* THE MONTH COLUMN — BILL MONTH ("Apr-25" / "Apr-26").
   ---------------------------------------------------------------------------
   The QlikView export sends it as `bill_month`; the Google Sheet's header
   spells it "Bill Month". Both are listed below because norm_ collapses
   whitespace but NOT underscores, so "bill_month" would not otherwise match.

   BILL MONTH CARRIES THE YEAR, AND THAT SPLITS EACH MONTH ACROSS TWO ROWS:
   "Apr-25" carries the prior-year figures, "Apr-26" the current-year ones, and
   the off-year columns on each are blank. So one plant x mix x segment x month
   arrives as TWO rows that have to be RE-AGGREGATED before any ratio is taken.

   That re-aggregation is not a special case here — it is how the whole file
   already works. Every consumer buckets and SUMS first, then divides:
     keyRows_   submarket x segment x app x class x strength
     plantRows_ plant
     ppiMaps_   plant x mix (x breakdown label), summed in add() before roll()
                takes ASP, applies the covered_() floors and sets the weight
     rxfPpi_ / the plant x mix detail — same shape
   Nothing computes an ASP, a coverage decision or a weight off a single row,
   so the "Apr-25" and "Apr-26" halves meet in the bucket and the arithmetic is
   the same as if one row had carried both years.

   THE YEAR ON THE CELL IS DELIBERATELY IGNORED. This file buckets on the month
   ordinal alone and takes current vs prior year from the "2025 Vol" /
   "2026 Vol" COLUMNS, which are populated on whichever row the year belongs
   to. Reading the year off the cell as well would add nothing and would drop
   any row whose spelling failed to parse a year.

   THE FORMATTING DEFECT IS THE STANDING RISK. Bill Month arrives as text and
   has come through mixed ("Jul-26" on some rows, "July-26" on others).
   monthOrd_ only reads the first three letters, so THIS file is immune — but
   anything joining on that cell with an exact match, the sheet's own SUMIFS
   LOOKUP KEY joins in particular, drops the mismatched rows SILENTLY. Fix the
   spelling in the sheet before trusting any figure.
   -------------------------------------------------------------------------- */
var MONTH_COLS_ = ['bill month','billmonth','bill_month','month'];
function monthCol_(s){
  for (var i=0;i<MONTH_COLS_.length;i++){ var c = col_(s, MONTH_COLS_[i]); if (c !== -1) return c; }
  return -1;
}

/* The cell is TEXT ("Apr-25"), never a date — that is the path that matters and
   the only one the sheet produces. "Apr-25", "Apr-26" and the mis-spelled
   "April-26" all collapse to the same ordinal: only the first three letters are
   read, and the year is discarded. The Date branch is a guard for a workbook
   that has been through Excel and come back with the cell coerced. */
var MONTH_ORD_ = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
function monthOrd_(v){
  if (v instanceof Date) return v.getMonth()+1;
  var s = norm_(v); if (!s) return 0;
  var o = MONTH_ORD_[s.slice(0,3)]; if (o) return o;
  var m = s.match(/(^|[^0-9])(1[0-2]|0?[1-9])([^0-9]|$)/);
  return m ? parseInt(m[2],10) : 0;
}
function extrasLookup_(LK, descr){
  var hit = LK.extras[norm_(descr)];                       // exact "SAP# - NAME" or bare name
  if (!hit){
    var d = String(descr).indexOf(' - ');
    if (d > 0) hit = LK.extras[norm_(String(descr).substring(d + 3))];  // strip SAP prefix
  }
  return hit || { type: 'Unclassified', miss:true };
}

/* Each row now carries its month ordinal (1-12, or 0 if no month col).
   Period filtering is applied at QUERY time, not at load time. */
function loadMain_(LK, src, bag){
  var s = src || readSheet_(CONFIG.SHEETS.MAIN, ['plant','product mix','major project segment']);
  var cMonth=monthCol_(s),                         // Bill Month ("Apr-25" / "Apr-26")
      cPlant=col_(s,'plant'), cMix=col_(s,'product mix'),
      cSeg=col_(s,'major project segment'),
      cPyV=col_(s,'2025 vol'), cPyR=col_(s,'2025 net sales ex va (cad)'),
      cCyV=col_(s,'2026 vol'), cCyR=col_(s,'2026 net sales ex va (cad)'),
      /* Fuel surcharge, allocated down to the mix row by the sheet's own MAP
         formula: the plant x bill-month total from Extra Raw Data, split across
         that key's rows in proportion to volume. OPTIONAL - a workbook without
         the columns simply reports no surcharge by mix, and the Fuel Recovery
         page falls back to the Extras stream for every figure it can. */
      cCyF=col_(s,'cy fuel surcharge'), cPyF=col_(s,'py fuel surcharge');
  var out=[];
  for (var i=s.hdr+1;i<s.values.length;i++){
    var row=s.values[i]; var plant=String(row[cPlant]||'').trim(); if(!plant) continue;
    var pd=dimsForPlant_(LK, plant), pr=dimsForProduct_(LK, row[cMix]);
    var mix = String(row[cMix]==null?'':row[cMix]).trim();
    var pyV=toNum_(row[cPyV]), pyR=toNum_(row[cPyR]), cyV=toNum_(row[cCyV]), cyR=toNum_(row[cCyR]);
    // PRODUCT MASTER miss -> log the WHOLE Product Mix cell, e.g.
    // "RMXCXFORDRS1 -  30 MPA NA 40MM HR1 W"
    if (pr.miss) noteUnmapped_(bag, 'product', mix, pd.market,
                               { cyVol:cyV, pyVol:pyV, cyRev:cyR, pyRev:pyR });
    out.push({ month: (cMonth===-1?0:monthOrd_(row[cMonth])),
      plant: plant, mix: mix,
      market: pd.market, submarket: pd.submarket, segment: row[cSeg],
      strength: pr.strength, cls: pr.cls, app: pr.app,
      pyVol: pyV, pyRev: pyR, cyVol: cyV, cyRev: cyR,
      cyFsc: (cCyF===-1?0:toNum_(row[cCyF])), pyFsc: (cPyF===-1?0:toNum_(row[cPyF])) });
  }
  return out;
}

function loadStream_(LK, sheetName, src, bag){
  var s = src || readSheet_(sheetName, ['plant','mat_prod_hier_3','major project segment']);
    var cMo=monthCol_(s),                          // Bill Month ("Apr-25" / "Apr-26")
      cPlant=col_(s,'plant'), cH3=col_(s,'mat_prod_hier_3'),
      cDescr=col_(s,'mat_descr'),
      cSeg=col_(s,'major project segment'),
      cPyR=col_(s,'total revenue - 2025'), cCyR=col_(s,'total revenue - 2026'),
      cPyM=col_(s,'m3 applied to - 2025'), cCyM=col_(s,'m3 applied to - 2026');
  var streamLabel = (sheetName === CONFIG.SHEETS.ASSOC) ? 'VAP' : 'EXTRAS';
  var out=[];
  for (var i=s.hdr+1;i<s.values.length;i++){
    var row=s.values[i]; var plant=String(row[cPlant]||'').trim(); if(!plant) continue;
    var pd=dimsForPlant_(LK, plant); var h3=String(row[cH3]||'').trim();
    var descr = (cDescr===-1) ? '' : String(row[cDescr]||'').trim();
    var lu = extrasLookup_(LK, descr);          // v2: bucket by mat_descr, not hier3
    var flagHit = LK.customFlag[norm_(descr)];  // undefined = not in CUSTOM FLAG at all
    var flag = flagHit || 'Other';
    var pyR=toNum_(row[cPyR]), cyR=toNum_(row[cCyR]), pyM=toNum_(row[cPyM]), cyM=toNum_(row[cCyM]);
    var nums = { cyVol:cyM, pyVol:pyM, cyRev:cyR, pyRev:pyR };
    if (lu.miss)  noteUnmapped_(bag, 'extras', descr, pd.market, nums, h3);  // EXTRAS LOOKUP miss -> hier3 + mat_descr
    if (!flagHit) noteUnmapped_(bag, 'flag',   descr, pd.market, nums);   // CUSTOM FLAG miss  -> mat_descr
    out.push({ month: (cMo===-1?0:monthOrd_(row[cMo])),
      plant: plant,                               // NEW: lets the Overview cross-filter
                                                  // follow a Plant / Submarket selection.
                                                  // Additive only - getExtras rolls up on
                                                  // type/flag and never reads it.
      market: pd.market, submarket: pd.submarket, segment: row[cSeg],
      hier3: h3, descr: descr, flag: flag, type: lu.type, stream: streamLabel,
      pyRev: pyR, cyRev: cyR, pyM3: pyM, cyM3: cyM });
  }
  return out;
}
/* =================== data bundle (cached, period-agnostic) =================== */
/* A cached bundle is only usable if it has the fields today's code reads.
   Version keys alone are not enough: CACHE_VER was left on v15 across a drop
   that ADDED a field, so a bundle written by the older build sat there looking
   valid while `months` was missing and `latestMonth` could not be trusted. The
   cost of getting this wrong is silent and severe - the month filter degrades
   to "no filter" and every YTD figure quietly includes the whole prior year -
   so the shape is checked rather than assumed, exactly as the history cube
   does. A bundle that fails is rebuilt, not repaired. */
function bundleOk_(b){
  return !!(b && b.main && b.months
            && Number(b.latestMonth) >= 1 && Number(b.latestMonth) <= 12);
}

function loadDataCached_(force){
  var key = cacheKey_(['data']);
  if (!force){ var c = cacheGet_(key); if (bundleOk_(c)) return c; }
  var LK = getLookupsCached_(force);
  var bag = newUnmapped_();
  var main = loadMain_(LK, null, bag);
  var latest = reportMonth_(main);          // latest month with CY volume, capped at last month
  var bundle = {
    main:   main,
    extras: loadStream_(LK, CONFIG.SHEETS.EXTRA, null, bag),
    assoc:  loadStream_(LK, CONFIG.SHEETS.ASSOC, null, bag),
    markets: marketsOf_(LK),
    latestMonth: latest,
    months: monthsOf_(main),
    unmapped: finishUnmapped_(bag)
  };
  cachePut_(key, bundle);
  return bundle;
}

/* =================== "Central Canada" (every market) ===================
 * The pages offer one extra entry above the market list, labelled
 * "Central Canada", whose value is the sentinel below. It is NOT a market in
 * PLANT LOOKUP - it simply means "don't filter by market", so every table,
 * every PPI weight and the Extras/VAP rollup cover all markets at once.
 *
 * PPI stays EXACT here (no blending): ppiMaps_ buckets at plant x mix, and a
 * plant belongs to exactly one market, so dropping the market filter just adds
 * more plant x mix buckets to the same SUM(FACTOR)/SUM(WEIGHT).
 *
 * NOTE - the EBITDA workbook's "RMX Summary" tab does carry a "Central  RMX"
 * block, but it is HNSSW + North + Innocon only (Manitoba and Saskatchewan sit
 * in the separate MB/SK workbook), so it is NOT the same population as this
 * selection. No KPI card is wired to it for that reason. This mismatch is
 * unique to the EBITDA report: the QlikView exports and the Google Sheets this
 * page reads always include MB/SK.
 */
var ALL_MARKETS = '__ALL__';
function mktOk_(rowMarket, sel){
  return sel === ALL_MARKETS || String(rowMarket) === String(sel);
}

/* THE REPORT MONTH — the month the pages report on by default.
   ------------------------------------------------------------------------
   LAST CALENDAR MONTH. Today is in the middle of being billed, so reporting it
   would put a few days of this month against a full month a year ago. In
   August the answer is July, in January it is December.

   This has to be stated rather than inferred, because the export carries the
   WHOLE of last year: the "-25" rows run Jan through Dec whether or not this
   year has reached those months. "The latest month in the data" is therefore
   always December - a month with last year's volume and none of this year's -
   which is what made MTD read an empty month and YTD compare part of this year
   against ALL of last year. The test below is on CURRENT-year figures only,
   which under Bill Month means the "-26" rows, so it stops at the last month
   actually billed.

   THE ONE EXCEPTION is a month that has not been exported yet. Early in the
   month, before the QlikView pull has run, last month may carry no
   current-year figures at all; defaulting to it would show the same empty
   month this rule exists to avoid. So if last month is not in the data, the
   latest month that IS carries the report instead.

   YTD then means January THROUGH the report month, not "every row present".
   The page's Report month picker overrides all of this. */
function reportMonth_(main){
  var prev = (new Date()).getMonth();             // 0-based month = last month, 1-12
  if (!prev) prev = 12;                           // in January, last month is December

  var latestCy = 0, hasPrev = false;
  for (var i = 0; i < main.length; i++){
    var m = main[i];
    if (!(m.cyVol || m.cyRev)) continue;          // current-year figures only
    if (m.month === prev) hasPrev = true;
    if (m.month > latestCy) latestCy = m.month;
  }
  if (hasPrev) return prev;                       // the normal path
  return latestCy || prev;                        // last month not exported yet
}

/* Which months the data actually carries, and which of those have CURRENT-YEAR
   volume. The page fills its month picker from this, so the list can never
   offer a month the sheet does not hold. */
/* The picker's options, rebuilt if the bundle predates the field. */
function bundleMonths_(bundle){
  if (bundle && bundle.months && bundle.months.cy) return bundle.months;
  var m = monthsOf_((bundle && bundle.main) || []);
  if (bundle) bundle.months = m;
  return m;
}

function monthsOf_(main){
  var any = {}, cy = {};
  for (var i = 0; i < main.length; i++){
    var m = main[i];
    if (!m.month) continue;
    if (m.cyVol || m.pyVol || m.cyRev || m.pyRev) any[m.month] = 1;
    if (m.cyVol || m.cyRev) cy[m.month] = 1;
  }
  function list(o){ return Object.keys(o).map(Number).sort(function(a,b){ return a-b; }); }
  return { all: list(any), cy: list(cy) };
}

/* THE MONTH THE PAGE IS ASKING FOR.
   `sel` is the month picker: 1-12 pins the report to that month, 0 or absent
   uses the report month worked out from the data. Either way:
       MTD  => that month alone        (positive)
       YTD  => January through it      (negative, "up to and including")
   0 means no month filter at all, kept for callers that want everything. */
/* The bundle's report month, worked out on the spot if the bundle does not
   carry one.

   THIS MUST NEVER RETURN 0. A zero here means "no month filter at all", and
   that is not a safe default: it silently reports part of this year against
   the WHOLE of last year, because the export carries all twelve of last year's
   months. A missing field has to degrade to last calendar month, never to
   showing everything. reportMonth_ always returns 1-12, even on no rows. */
function bundleMonth_(bundle){
  var m = Number(bundle && bundle.latestMonth) || 0;
  if (m >= 1 && m <= 12) return m;
  m = reportMonth_((bundle && bundle.main) || []);
  if (bundle) bundle.latestMonth = m;      // so the rest of the request agrees
  return m;
}

function monthFor_(bundle, period, sel){
  var rpt = Number(sel) || 0;
  if (rpt < 1 || rpt > 12) rpt = bundleMonth_(bundle);
  return (period === 'MTD') ? rpt : -rpt;
}
/* The month a request actually landed on, echoed back so the picker can show
   what it is reporting even when the page did not name one. */
function monthSel_(bundle, sel){
  var rpt = Number(sel) || 0;
  if (rpt < 1 || rpt > 12) rpt = bundleMonth_(bundle);
  return rpt;
}

/* The one place a row's month is tested against the period. */
function inMonth_(rowMonth, month){
  if (!month) return true;                        // no filter
  if (month > 0) return rowMonth === month;       // MTD: exactly that month
  return rowMonth > 0 && rowMonth <= -month;      // YTD: January through it
}

/* Scope a row list to the period (0 => all months, like "all markets"). */
function scopeMonth_(rows, month){
  if (!month) return rows;
  return rows.filter(function(r){ return inMonth_(r.month, month); });
}

/* =================== computation =================== */
/* PPI COVERAGE — Qlik floors (shared with the Overview month cube)
 * ------------------------------------------------------------------
 * A plant x mix pair only earns PPI weight when BOTH years clear the
 * floors. Qlik's Weight expression, verbatim:
 *     if(vCYREVMIX>110, if(vCYVOL>1, if(vPYREVMIX>110, if(vPYVOL>1 ...
 * This used to test "> 0" on all four figures, which let pairs carrying
 * a couple of dollars of prior-year revenue into the index. A full year
 * dilutes them; a single month does not — on 2025 vs 2024, MTD Jun read
 * 4834% under ">0" and 2.61% under the floors, and North YTD 57.68% vs
 * 3.74%. Cost of the floors: 75 of 3,863 pairs, 0.063% of total weight.
 *
 * Thresholds live in APP_CONFIG.CUBE.COVERAGE.rmx so this page and the
 * cube can never drift apart. Read lazily (Config.gs may load after this
 * file) and memoised — roll() calls this once per bucket.
 *
 * AGGREGATES IS NOT THE SAME RULE. PV_Backend.gs keeps its own ">0"
 * coverage: it matches Qlik today and its bad rows carry $404 / $53,542
 * of PY revenue, well clear of any $110 floor. Do not copy this there.
 */
var _COV_RMX = null;
function covRmx_(){
  if (_COV_RMX) return _COV_RMX;
  var c = {};
  try { c = ((APP_CONFIG.CUBE||{}).COVERAGE||{}).rmx || {}; } catch(e){ c = {}; }
  _COV_RMX = { minVol: (c.minVol==null ? 1 : c.minVol),      // fall back to the Qlik
               minRev: (c.minRev==null ? 110 : c.minRev) };  // floors, never to >0
  return _COV_RMX;
}
function covered_(pyVol,pyRev,cyVol,cyRev){
  var c = covRmx_();
  return pyVol>c.minVol && cyVol>c.minVol && pyRev>c.minRev && cyRev>c.minRev;
}

/* KEY-GRAIN ROWS — VOLUME + BASE REVENUE ONLY
 * ------------------------------------------------------------------
 * The mapping sheet's KEY is  =E&F&G&H&I :
 *     SUBMARKET & Segment & PRODUCT APPLICATION & PRODUCT CLASS & STRENGTH CLASS
 * summed over the whole period. That grain is correct for VOL and ASP, and
 * those columns tie to Qlik exactly, so it is left alone.
 *
 * PPI is NOT computed here any more. Qlik indexes at PLANT x MIX grain (see
 * its "PPI (Mix Only)" report), which neither contains nor is contained by the
 * KEY grain — segment is a row-level field, so one plant x mix line can span
 * several segments. PPI therefore cannot be summed off these rows and lives in
 * ppiMaps_() below instead.
 */
function keyRows_(main, market, month){
  var keys={}, order=[];
  main.forEach(function(m){
    if (!mktOk_(m.market, market)) return;         // '__ALL__' = Central Canada, no market filter
    if (!inMonth_(m.month, month)) return;         // MTD: the report month; YTD: January through it

    var d={submarket:m.submarket,segment:m.segment,app:m.app,cls:m.cls,strength:m.strength};
    var kk=[d.submarket,d.segment,d.app,d.cls,d.strength].join('|');
    var g=keys[kk];
    if(!g){
      g=keys[kk]={dims:d, pyVol:0,pyRev:0,cyVol:0,cyRev:0};
      order.push(kk);
    }
    g.pyVol+=m.pyVol; g.pyRev+=m.pyRev; g.cyVol+=m.cyVol; g.cyRev+=m.cyRev;
  });

  return order.map(function(kk){
    var g=keys[kk];
    return {
      dims:g.dims, pyVol:g.pyVol, cyVol:g.cyVol,
      baseCY:g.cyRev, basePY:g.pyRev
    };
  });
}

/* PLANT ROLLUP - ITS OWN LIST, DELIBERATELY NOT PART OF THE KEY GRAIN
 * ------------------------------------------------------------------
 * Plant is NOT in keyRows_' key. Adding it there would have been the tidier
 * looking change - groupBy_ would then handle it like every other dimension -
 * but the key grain is (submarket, segment, app, class, strength) and plant
 * cuts across all five, so the row count multiplies. That payload is cached in
 * the browser's localStorage, which tops out around 900KB, and it is already
 * the biggest thing this page ships.
 *
 * So plants come down PRE-ROLLED instead: one row per plant, a couple of
 * hundred at most. The page sorts them by CY volume and shows the top ten.
 * PPI is read from ppiMaps_().PLANT, which buckets at plant x mix - the same
 * grain Qlik indexes at - so a plant's PPI is exact, not a blend.
 */
function plantRows_(main, market, month){
  var map={}, order=[];
  main.forEach(function(m){
    if (!mktOk_(m.market, market)) return;         // '__ALL__' = Central Canada, no market filter
    if (!inMonth_(m.month, month)) return;
    var label = String(m.plant||'').trim() || '(blank)';
    var g = map[label];
    if (!g){ g = map[label] = { label:label, pyVol:0, cyVol:0, baseCY:0, basePY:0 }; order.push(label); }
    g.pyVol += m.pyVol; g.cyVol += m.cyVol; g.baseCY += m.cyRev; g.basePY += m.pyRev;
  });
  return order.map(function(l){ return map[l]; });
}

/* The Top-10 table, built the same way every other table is.
 * TOTAL IS THE WHOLE SELECTION, NOT THE TEN ROWS: the shares are read against
 * every plant in the market, so the ten rows deliberately add to less than
 * 100% - that gap is the point of the table. Mix effect is not reported: it is
 * only meaningful across a complete set of rows. */
function plantTable_(plants, ppiMap, totalWf){
  var groups = (plants||[]).map(function(p){
    return finalizeGroup_({ label:p.label, pyVol:p.pyVol, cyVol:p.cyVol,
                            baseCY:p.baseCY, basePY:p.basePY }, (ppiMap||{})[p.label]);
  });
  var total = totalOf_(groups, totalWf);           // every plant, before the slice
  groups.sort(function(a,b){ return b.cyVol-a.cyVol; });
  return { key:'PLANT', label:'Top 10 Plants', topN:10, noMix:true,
           rows: groups.slice(0,10).map(pack_), total: pack_(total), mixEffect:0 };
}

/* PPI WEIGHTS — Qlik parity, at PLANT x MIX grain
 * ------------------------------------------------------------------
 * Mirrors Qlik's "PPI (Mix Only)" report exactly:
 *     ASP%   = (cyRev/cyVol - pyRev/pyVol) / (pyRev/pyVol)
 *     WEIGHT = cyRev, but only when BOTH years clear covered_()'s floors
 *     FACTOR = WEIGHT x ASP%
 *     PPI    = SUM(FACTOR) / SUM(WEIGHT)
 * There is deliberately NO +/-50% ASP% cap. The mapping sheet applies one
 * (ABS(N)>0.5 -> coverage 0); Qlik does not, and the excluded rows are often
 * the single largest PPI contributors. Qlik is the source of truth.
 *
 * Selecting a breakdown value in Qlik re-runs the aggregation inside that
 * selection, so each dimension gets its own bucketing at plant x mix x label.
 * For SUBMARKET (fixed by plant) and STRENGTH / CLASS (fixed by mix) that is
 * identical to plain plant x mix; for SEGMENT (a row-level field) it is
 * genuinely finer, which is why the segment rows do not weight-average back to
 * the Total. That is Qlik's behaviour, not a rounding artefact.
 *
 * Returns a compact map the client can look up by label — a few dozen entries,
 * so switching breakdown chips never needs another server call:
 *   { total:{w,f}, SUBMARKET:{label:{w,f},..}, SEGMENT:{..},
 *     STRENGTH:{..}, CLASS:{..} }
 */
function ppiFieldOf_(m, dimKey){
  return dimKey==='SUBMARKET' ? m.submarket
       : dimKey==='SEGMENT'   ? m.segment
       : dimKey==='STRENGTH'  ? m.strength
       : dimKey==='PLANT'     ? m.plant
       : m.cls;                                    // CLASS
}
function ppiMaps_(main, market, month){
  var DIMS = CONFIG.BREAKDOWNS.map(function(b){ return b.key; });
  var buckets = { total:{} };                      // bucketKey -> {label, pyVol,pyRev,cyVol,cyRev}
  DIMS.forEach(function(d){ buckets[d] = {}; });

  main.forEach(function(m){
    if (!mktOk_(m.market, market)) return;         // '__ALL__' = Central Canada, no market filter
    if (!inMonth_(m.month, month)) return;
    var pm = String(m.plant||'') + '|' + String(m.mix||'');

    function add(store, bk, label){
      var g = store[bk];
      if (!g) g = store[bk] = { label:label, pyVol:0,pyRev:0,cyVol:0,cyRev:0 };
      g.pyVol+=m.pyVol; g.pyRev+=m.pyRev; g.cyVol+=m.cyVol; g.cyRev+=m.cyRev;
    }
    add(buckets.total, pm, 'Total');
    DIMS.forEach(function(d){
      var label = String(ppiFieldOf_(m, d)||'(blank)').trim() || '(blank)';
      add(buckets[d], pm + '|' + label, label);
    });
  });

  function roll(store){
    var out = {};
    for (var bk in store){
      var g = store[bk];
      var pyAsp = g.pyVol ? g.pyRev/g.pyVol : 0;
      var cyAsp = g.cyVol ? g.cyRev/g.cyVol : 0;
      var inc   = pyAsp ? (cyAsp-pyAsp)/pyAsp : 0;
      var w     = covered_(g.pyVol, g.pyRev, g.cyVol, g.cyRev) ? g.cyRev : 0;
      var o = out[g.label];
      if (!o) o = out[g.label] = { w:0, f:0 };
      o.w += w; o.f += w * inc;
    }
    return out;
  }

  var res = { total: roll(buckets.total).Total || { w:0, f:0 } };
  DIMS.forEach(function(d){ res[d] = roll(buckets[d]); });
  return res;
}

/* PPI from a {w,f} pair (or a list of them). Single place the division lives. */
function ppiOf_(wf){ return (wf && wf.w) ? wf.f/wf.w : 0; }

function groupBy_(rows, dimKey, ppiMap){
  var map={}, order=[];
  function fld(d){ return dimKey==='SUBMARKET'?d.submarket: dimKey==='SEGMENT'?d.segment: dimKey==='STRENGTH'?d.strength: d.cls; }
  rows.forEach(function(r){
    var label=String(fld(r.dims)||'(blank)').trim()||'(blank)';
    if(!map[label]){ map[label]={label:label, pyVol:0,cyVol:0,baseCY:0,basePY:0}; order.push(label);}
    var g=map[label];
    g.pyVol+=r.pyVol; g.cyVol+=r.cyVol; g.baseCY+=r.baseCY; g.basePY+=r.basePY;
  });
  // PPI is NOT summed from these rows — it is read at plant x mix grain.
  return order.map(function(l){ return finalizeGroup_(map[l], (ppiMap||{})[l]); });
}
function finalizeGroup_(g, wf){
  g.aspBaseCY = g.cyVol? g.baseCY/g.cyVol : 0;
  g.aspBasePY = g.pyVol? g.basePY/g.pyVol : 0;
  g.aspIncBase = g.aspBasePY? (g.aspBaseCY-g.aspBasePY)/g.aspBasePY : 0;
  g.ppiBase = ppiOf_(wf);
  return g;
}
function totalOf_(groups, totalWf){
  var t={label:'Total', pyVol:0,cyVol:0,baseCY:0,basePY:0};
  groups.forEach(function(g){ t.pyVol+=g.pyVol;t.cyVol+=g.cyVol;t.baseCY+=g.baseCY;t.basePY+=g.basePY;});
  return finalizeGroup_(t, totalWf);   // plain plant x mix — identical on every breakdown
}
function pack_(g){
  return { label:g.label, cyVol:g.cyVol, pyVol:g.pyVol, volPct: g.pyVol? (g.cyVol-g.pyVol)/g.pyVol : 0,
    aspBaseCY:g.aspBaseCY, aspBasePY:g.aspBasePY, aspIncBase:g.aspIncBase, ppiBase:g.ppiBase };
}
function mixEffect_(groups, total){
  if (!total.pyVol || !total.aspBasePY) return 0;
  var sp=0; groups.forEach(function(g){ var share = g.pyVol/total.pyVol; sp += share*g.aspBaseCY; });
  var priceOnly = (sp - total.aspBasePY)/total.aspBasePY;
  return total.aspIncBase - priceOnly;
}

/* =================== session uploads (QlikView Excel) ===================
   Uploaded raw data replaces the RAW tabs for ONE browser session only.
   Lookups still come from the connected Google Sheet. Nothing is written
   back. Stored in the chunked cache under a random token, 6h TTL. */
function upKey_(token){ return CONFIG.CACHE_VER + '|up|' + token; }   // no generation_: Sync must not kill uploads

function combineTwoRowHeader_(values){
  // Extras/Associates QlikView export: row 1 = bill years over the metric
  // columns, row 2 = names. Merge into "Total Revenue - 2025" style names.
  var nameRow = -1;
  for (var r=0; r<Math.min(6, values.length); r++){
    var rowNorm = values[r].map(norm_);
    for (var mc=0; mc<MONTH_COLS_.length; mc++){
      if (rowNorm.indexOf(MONTH_COLS_[mc]) !== -1){ nameRow = r; break; }
    }
    if (nameRow !== -1) break;
  }
  if (nameRow <= 0) return values;                       // already single-row header
  var years = values[nameRow-1], names = values[nameRow].slice();
  for (var c=0; c<names.length; c++){
    var y = String(years[c]==null?'':years[c]).trim().slice(0,4);
    if (/^(19|20)\d\d$/.test(y)) names[c] = String(names[c]) + ' - ' + y;
  }
  return [names].concat(values.slice(nameRow+1));
}

function requireCols_(s, names, label){
  var missing = names.filter(function(n){ return col_(s, n) === -1; });
  if (missing.length)
    throw new Error(label + ' upload doesn\u2019t match the expected QlikView format. Missing column(s): '
      + missing.join(', ') + '. Please re-download from QlikView without changing the columns.');
}

function uploadData(payload){
  payload = payload || {};
  if (!payload.main || !payload.extras || !payload.assoc)
    throw new Error('Please choose all three QlikView files (Main, Extras, Associates) first.');
  var LK = getLookupsCached_(false);

  var sMain = indexValues_(payload.main, ['plant','product mix','major project segment']);
  requireCols_(sMain, ['plant','product mix','major project segment',
    '2025 vol','2026 vol','2025 net sales ex va (cad)','2026 net sales ex va (cad)'], 'Main Raw Data');
  if (monthCol_(sMain)===-1)
    throw new Error('Main Raw Data upload needs a "Bill Month" column (the export spells it "bill_month").');

  var sExtra = indexValues_(combineTwoRowHeader_(payload.extras), ['plant','mat_prod_hier_3','major project segment']);
  var sAssoc = indexValues_(combineTwoRowHeader_(payload.assoc),  ['plant','mat_prod_hier_3','major project segment']);
  var streamCols = ['plant','mat_prod_hier_3','major project segment','mat_descr',
    'total revenue - 2025','total revenue - 2026','m3 applied to - 2025','m3 applied to - 2026'];
  requireCols_(sExtra, streamCols, 'Extra Raw Data');
  requireCols_(sAssoc, streamCols, 'Associate Raw Data');
  if (monthCol_(sExtra)===-1) throw new Error('Extra Raw Data upload needs a "Bill Month" column (the export spells it "bill_month").');
  if (monthCol_(sAssoc)===-1) throw new Error('Associate Raw Data upload needs a "Bill Month" column (the export spells it "bill_month").');

  var bag = newUnmapped_();
  var main = loadMain_(LK, sMain, bag);   // blank-Plant rows (incl. the totals row) are skipped by the loaders
  if (!main.length) throw new Error('Main Raw Data upload has no data rows.');
  var latest = reportMonth_(main);          // latest month with CY volume, capped at last month

  var bundle = {
    main:   main,
    extras: loadStream_(LK, CONFIG.SHEETS.EXTRA, sExtra, bag),
    assoc:  loadStream_(LK, CONFIG.SHEETS.ASSOC, sAssoc, bag),
    markets: marketsOf_(LK),
    latestMonth: latest,
    months: monthsOf_(main),
    unmapped: finishUnmapped_(bag)
  };
  var token = Utilities.getUuid().slice(0,8);
  cachePut_(upKey_(token), bundle);
  if (!cacheGet_(upKey_(token)))
    throw new Error('The uploaded files are too large to hold in the session cache. Filter the QlikView download down and try again.');
  return { ok:true, token:token, latestMonth:latest,
           rows:{ main:main.length, extras:bundle.extras.length, assoc:bundle.assoc.length } };
}

function loadUploaded_(token){
  var b = cacheGet_(upKey_(token));
  if (!b) throw new Error('Your uploaded data has expired (sessions last up to 6 hours). '
    + 'Please upload the Excel files again, or press "Back to sheet data".');
  return b;
}

/* =================== client-facing API =================== */
function getMarkets(){
  var LK = getLookupsCached_(false);
  var out = { markets: marketsOf_(LK), allMarkets: ALL_MARKETS, build: BUILD,
              breakdowns: CONFIG.BREAKDOWNS, generation: generation_() };
  /* the month picker needs its options before the first table lands. The
     bundle is already cached by this point on every visit but the first, and a
     failure here must not stop the page opening. */
  try {
    var b = loadDataCached_(false);
    out.latestMonth = bundleMonth_(b);
    out.months = bundleMonths_(b);
  } catch (e){ out.months = { all:[], cy:[] }; }
  return out;
}

/* =================== prepareAll - THE ONE PULL ===================
 * ONE CALL READS THE SHEET DATA. EVERYTHING ELSE READS A FINISHED ANSWER.
 *
 * The measurement that produced this (tests/rmxcost.js):
 *
 *   the cached data bundle .................  14 MB  -> 160 cache chunks
 *   a finished getKeys payload, one market ..  72 KB  ->   1 cache chunk
 *   ...Central Canada .......................  367 KB ->   5 cache chunks
 *   grouping the rows for all 12 selections .  0.3 s  in total
 *
 * Every getKeys / getExtras / getSlideTables / getMarkets call used to open with
 * loadDataCached_(), which pulls all 160 chunks back out of CacheService before
 * it can group a single row. So a request that produces 72 KB moved 14 MB to do
 * it, and did it again for the next market, and again for the other period. The
 * grouping was never the cost - 0.3 s for all twelve - and that is why the
 * execution log showed a flat 15-24 s per call whatever was being asked for.
 *
 * It is also exactly why the Aggregates side feels instant next to this one:
 * PV.getReport returns its cached report BEFORE it touches the pivot. Nothing
 * about Ready-Mix is heavier - it just had no equivalent of that.
 *
 * So: read the bundle ONCE, compute every selection off it, and put each
 * finished payload in the cache under the key its own reader looks in. After
 * this the page's own calls are 1-5 chunk reads, and switching market costs
 * about a second instead of twenty.
 *
 * IT CHANGES NO ARITHMETIC. keyRows_, ppiMaps_, plantRows_, slideSegment_ and
 * extrasPayload_ are called with exactly the arguments getKeys / getSlideTables
 * pass them today - same rows, same market sentinel, same month. The only
 * difference is how many times the bundle is fetched to feed them.
 *
 * `want` is which page is asking, because warming what nobody will read is just
 * a slower call:
 *   'keys'  RMX - Price & Volume        (12 payloads)
 *   'slide' Commercial Product Segment  (12 payloads)
 *   'all'   both, plus Extras           (36) - for a scheduled warm
 *
 * It also RETURNS the payload for `market`, so the page that asked can render
 * from this one response without a second round trip.
 *
 * UPLOADS SKIP ALL OF IT. "Run on my own QlikView files" is one user's session
 * and its figures must never land in a cache everybody reads (see selCached_).
 */
function prepareAll(opts){
  opts = opts || {};
  var t0 = new Date().getTime();
  var want = (opts.want === 'keys' || opts.want === 'slide' || opts.want === 'all')
    ? opts.want : 'all';

  var bundle = opts.upload ? loadUploaded_(opts.upload)
                           : loadDataCached_(!!opts.force);   // the one big read
  var month   = monthSel_(bundle, opts.month);                // 1-12
  var markets = bundle.markets || [];
  var list    = [ALL_MARKETS].concat(markets);
  var asked   = opts.market || ALL_MARKETS;
  var payloads = {}, warmed = 0;

  /* Every reply carries these, exactly as the individual calls do, so a page
     can fill its pickers from this one answer. */
  function stamp(o){
    o.month = month;
    o.latestMonth = bundleMonth_(bundle);
    o.months = bundleMonths_(bundle);
    o.build = BUILD;
    o.generation = generation_();
    return o;
  }

  /* Write one finished payload where its own reader will look for it. An upload
     session gets the answer but never the shared cache entry. */
  function keep(kind, period, market, out){
    if (!opts.upload) cachePut_(cacheKey_(selKey_(kind, period, month, market)), out);
    warmed++;
    return out;
  }

  /* ...AND HAND THEM ALL BACK, not just the one that was asked for.
     Warming the server cache alone still leaves a round trip per market: pick
     GTA and the page waits on a call, which is exactly what Aggregates does NOT
     do - its opening call carries every market, so switching is instant and
     costs nothing. These are the same finished payloads that just went into the
     cache, so this is one response instead of twelve, and after it the pages
     switch market with no server call at all.

     Sizes, from tests/rmxcost.js: one market is ~72 KB, Central Canada ~361 KB,
     so both periods together are around a megabyte. That is a fine response and
     a poor localStorage entry - the pages keep them in memory and go on writing
     AmrCache one market at a time (it caps near 900 KB per entry). */
  function wire(kind, period, market, out){
    payloads[kind + '|' + market + '|' + period] = out;
    return out;
  }

  ['MTD','YTD'].forEach(function(period){
    var m = monthFor_(bundle, period, month);
    /* the month filter, once per period rather than once per market per table */
    var scoped = scopeMonth_(bundle.main, m);
    /* what getKeys would resolve an empty market to, so the 'auto' entry the
       first RMX load asks for is warmed too */
    var auto = pickMarket_(scoped);

    list.forEach(function(mk){
      if (want === 'keys' || want === 'all'){
        var k = keep('keys', period, mk, stamp({
          ok:true, market:mk, period:period,
          keys:   keyRows_(bundle.main, mk, m),
          ppi:    ppiMaps_(bundle.main, mk, m),
          plants: plantRows_(bundle.main, mk, m),
          breakdowns: CONFIG.BREAKDOWNS
        }));
        if (mk === auto) keep('keys', period, '', k);      // the '' -> 'auto' alias
        wire('keys', period, mk, k);
      }

      if (want === 'slide' || want === 'all'){
        var s = keep('slide', period, mk, stamp({
          ok:true, market:mk, period:period,
          markets: markets, allMarkets: ALL_MARKETS,
          segment: slideSegment_(bundle, mk, m),
          extras:  extrasPayload_(bundle, scoped, mk, m),
          rowCount: scoped.length
        }));
        wire('slide', period, mk, s);
      }

      if (want === 'all'){
        var e = extrasPayload_(bundle, scoped, mk, m);
        e.ok = true; e.market = mk; e.period = period; e.month = month;
        keep('extras', period, mk, e);
        if (mk === auto) keep('extras', period, '', e);
      }
    });
  });

  /* One field of the bundle we already have open. The Mapping check panel is on
     every RMX page load, and this is what stops it costing a second 14 MB read. */
  if (!opts.upload){
    cachePut_(cacheKey_(['unmapped']), unmappedOf_(bundle));
    warmed++;
  }

  return { ok:true, warmed:warmed, want:want,
           markets:markets, allMarkets:ALL_MARKETS,
           breakdowns:CONFIG.BREAKDOWNS,
           month:month, latestMonth:bundleMonth_(bundle),
           months:bundleMonths_(bundle),
           build:BUILD, generation:generation_(),
           ms: new Date().getTime() - t0,
           /* every market x period the page will ever ask for, keyed
              '<kind>|<market>|<period>' */
           payloads: payloads,
           /* the one the caller opens on, for a page that wants only that */
           payload: payloads[(want === 'slide' ? 'slide' : 'keys') + '|' + asked
                             + '|' + (opts.period === 'YTD' ? 'YTD' : 'MTD')] || null };
}

/* Every value the lookups couldn't match, across ALL markets and ALL months
 * (deliberately never filtered by the page's market/period selection — this
 * is about fixing the lookup tabs, not reading a period). */
/* Cached like everything else. It is one field of the bundle - so answering it
   used to mean pulling all 160 chunks of that bundle back to hand over a list
   the pages show in a side panel, on EVERY page load. prepareAll fills this
   entry while it already has the bundle open, which makes it free. */
function unmappedOf_(bundle){
  var u = (bundle && bundle.unmapped) || { product:[], extras:[], flag:[] };
  return { ok:true, product:u.product, extras:u.extras, flag:u.flag,
           total: u.product.length + u.extras.length + u.flag.length,
           generation: generation_() };
}
function getUnmapped(opts){
  opts = opts || {};
  return selCached_(['unmapped'], opts, function(){
    return unmappedOf_(opts.upload ? loadUploaded_(opts.upload)
                                   : loadDataCached_(!!opts.force));
  });
}

function pickMarket_(main){
  var byM={}; main.forEach(function(m){ byM[m.market]=(byM[m.market]||0)+m.cyVol; });
  var best='',bv=-1; for(var mm in byM){ if(byM[mm]>bv){bv=byM[mm];best=mm;} }
  return best;
}

/**
 * NEW: returns the raw KEY ROWS for one market+period.
 * The client groups these by any breakdown(s) locally, so changing
 * "break down by" never calls the server again.
 */
function getKeys(opts){
  opts = opts || {};
  var period = (opts.period==='MTD') ? 'MTD' : 'YTD';
  return selCached_(selKey_('keys', period, opts.month, opts.market),
                    opts, function(){
    var bundle = opts.upload ? loadUploaded_(opts.upload) : loadDataCached_(!!opts.force);
    var month = monthFor_(bundle, period, opts.month);
    var market = opts.market || pickMarket_(scopeMonth_(bundle.main, month));

    // Passed strictly main data (no extras/assoc)
    var keys = keyRows_(bundle.main, market, month);
    var ppi  = ppiMaps_(bundle.main, market, month);
    /* Pre-rolled, one row per plant - the Top 10 Plants chip reads this instead
       of the key rows. See plantRows_ for why it is not in the key grain. */
    var plants = plantRows_(bundle.main, market, month);

    return { ok:true, market:market, period:period, keys:keys, ppi:ppi, plants:plants,
             month: monthSel_(bundle, opts.month),
             latestMonth: bundleMonth_(bundle),
             months: bundleMonths_(bundle),
             build: BUILD,
             breakdowns:CONFIG.BREAKDOWNS, generation:generation_() };
  });
}

/**
 * Sync: invalidate ALL cached data and re-warm the data bundle
 * from the spreadsheet. This is the only path that re-reads the sheet.
 */
function syncData(opts){
  opts = opts || {};
  bumpGeneration_();                                  // every old cache key is now unreachable
  var period = (opts.period==='MTD') ? 'MTD' : 'YTD';
  loadDataCached_(true);                              // force fresh read + repopulate under new generation
  return { ok:true, period:period, build:BUILD, generation:generation_(), at:new Date().toISOString() };
}

/* getReport kept for backwards-compatibility (now cache-backed; no dim cap). */
function getReport(opts){
  opts = opts || {};
  var dims = (opts.dimensions && opts.dimensions.length) ? opts.dimensions.slice(0, CONFIG.MAX_DIMS) : [ opts.breakdown || 'SUBMARKET' ];
  var period = (opts.period==='MTD') ? 'MTD' : 'YTD';
  var bundle = opts.upload ? loadUploaded_(opts.upload) : loadDataCached_(!!opts.force);
  var month = monthFor_(bundle, period, opts.month);
  var market = opts.market || pickMarket_(scopeMonth_(bundle.main, month));

  var keys = keyRows_(bundle.main, market, month);
  var ppi  = ppiMaps_(bundle.main, market, month);

  function labelFor(k){ return (CONFIG.BREAKDOWNS.filter(function(b){return b.key===k;})[0]||{label:k}).label; }
  var tables = dims.map(function(dim){
    /* PLANT is not a key-grain field - it comes off its own rollup. */
    if (dim==='PLANT'){
      return plantTable_(plantRows_(bundle.main, market, month), ppi.PLANT, ppi.total);
    }
    var groups = groupBy_(keys, dim, ppi[dim]);
    groups.sort(function(a,b){ return b.cyVol-a.cyVol; });
    var total = totalOf_(groups, ppi.total);
    return { key:dim, label:labelFor(dim), rows:groups.map(pack_), total:pack_(total), mixEffect: mixEffect_(groups, total) };
  });
  return { ok:true, market:market, period:period, dimensions:dims, tables:tables };
}
function getExtras(opts){
  opts = opts || {};
  var period = (opts.period==='MTD') ? 'MTD' : 'YTD';
  return selCached_(selKey_('extras', period, opts.month, opts.market),
                    opts, function(){
    var bundle = opts.upload ? loadUploaded_(opts.upload) : loadDataCached_(!!opts.force);
    var month = monthFor_(bundle, period, opts.month);
    var main = scopeMonth_(bundle.main, month);
    var market = opts.market || pickMarket_(main);
    var out = extrasPayload_(bundle, main, market, month);
    out.ok = true; out.market = market; out.period = period;
    out.month = monthSel_(bundle, opts.month);
    return out;
  });
}

/* THE EXTRAS / VAP TABLES for one market + month scope.
 * ---------------------------------------------------------------------------
 * Split out of getExtras so the Commercial Product Segment slide page can get
 * these AND its segment table in ONE round trip (getSlideTables below) rather
 * than computing the same rows twice. `main` must already be month-scoped.
 *
 * BOTH TABLES NOW GROUP ON THE EXTRAS LOOKUP CATEGORY.
 * The detail table used to group on CUSTOM FLAG LOOKUP (mat_descr -> Custom
 * Flag). It does not any more: EXTRAS LOOKUP is the ONE classification both
 * tables read, so a material moves in both places at once and there is a single
 * tab to maintain. The two tables carry the same labels on purpose - what
 * differs is the BASE: the by-type table prices on total concrete m3, the
 * detail table prices on applied m3 and prints penetration next to it.
 *
 * The rows still carry `flag` and the mapping / suggestion cards still report
 * CUSTOM FLAG misses, so nothing else in the suite breaks - but nothing
 * DISPLAYS a flag any more. Pull that plumbing when the mapping card goes.
 */
function extrasPayload_(bundle, main, market, month){
  var extras = bundle.extras.filter(function(e){return mktOk_(e.market, market) && inMonth_(e.month, month);});
  var assoc  = bundle.assoc.filter(function(e){return mktOk_(e.market, market) && inMonth_(e.month, month);});
  // applied-rate base = GLOBAL total concrete m3 (all markets, month-scoped), CY & PY separately (sheet hard-codes 714957 / 947519)
  var gCY=0, gPY=0;
  main.forEach(function(m){ gCY+=m.cyVol; gPY+=m.pyVol; });
  var baseCY = (CONFIG.APPLIED_BASE_CY!=null) ? CONFIG.APPLIED_BASE_CY : gCY;
  var basePY = (CONFIG.APPLIED_BASE_PY!=null) ? CONFIG.APPLIED_BASE_PY : gPY;

  /* ASP base for the BY EXTRA TYPE table = total concrete m3 from Main Raw Data
     for the SELECTED market, same month scope, CY and PY separately.

     "M3 Applied To" is not addable across extra types: fibre's applied m3 and
     accelerator's applied m3 are the same physical pour, counted once under each
     hier_3. Summing it for the Total row divides revenue by a denominator that
     counts the same concrete several times over, so the Total is not the sum of
     its rows. It also lets ASP change read $0.00 while penetration halves and the
     revenue walks away - the opposite of what the slide is meant to show.
     One concrete base for every row fixes both: rows add to the Total, and ASP
     change carries rate AND penetration.

     The detail table keeps applied m3 on purpose - it prints vol applied and
     applied rate next to it, so its ASP is explicitly a per-applied-m3 rate. */
  var volBaseCY=0, volBasePY=0;
  main.forEach(function(m){ if(mktOk_(m.market, market)){ volBaseCY+=m.cyVol; volBasePY+=m.pyVol; } });

  function rollup(stream, field){
    var map={}, order=[];
    stream.forEach(function(e){ var label = field==='type'? e.type : field==='flag'? e.flag : e.hier3;
      if(!map[label]){ map[label]={label:label, cyRev:0,pyRev:0,cyM3:0,pyM3:0}; order.push(label); }
      var g=map[label]; g.cyRev+=e.cyRev; g.pyRev+=e.pyRev; g.cyM3+=e.cyM3; g.pyM3+=e.pyM3; });
    return order.map(function(l){ return finalizeExtra_(map[l], baseCY, basePY); });
  }
  /* re-base ASP onto total concrete m3 (by-extra-type table only) */
  function onVolume_(g){
    g.aspCY  = volBaseCY ? g.cyRev/volBaseCY : 0;
    g.aspPY  = volBasePY ? g.pyRev/volBasePY : 0;
    g.aspChg = g.aspCY - g.aspPY;
    return g;
  }
  function tot(list){ var t={label:'Total',cyRev:0,pyRev:0,cyM3:0,pyM3:0};
    list.forEach(function(g){t.cyRev+=g.cyRev;t.pyRev+=g.pyRev;t.cyM3+=g.cyM3;t.pyM3+=g.pyM3;});
    return finalizeExtra_(t, baseCY, basePY); }
  var all = extras.concat(assoc);
  function byRev_(a,b){ return b.cyRev-a.cyRev; }
  function onVolList_(list){ return list.map(function(g){ return onVolume_(g); }).sort(byRev_); }

  /* Split the by-extra-type summary into the same EXTRAS / VAP streams the
     detail table uses, each with its own subtotal, plus a grand total. */
  var byTypeEx = onVolList_(rollup(extras, 'type'));
  var byTypeVp = onVolList_(rollup(assoc,  'type'));
  var byType   = onVolList_(rollup(all,    'type'));   // kept flat for the Overview page

  /* EXTRAS LOOKUP, not CUSTOM FLAG - see the note above this function. */
  var exDetail = rollup(extras,'type').sort(byRev_);
  var vpDetail = rollup(assoc,'type').sort(byRev_);

  return { appliedBaseCY:baseCY, appliedBasePY:basePY,
    volBaseCY:volBaseCY, volBasePY:volBasePY,
    groupedOn:'EXTRAS LOOKUP',
    byType:byType,               byTypeTotal:       onVolume_(tot(byType)),
    byTypeExtras:byTypeEx,       byTypeExtrasTotal: onVolume_(tot(byTypeEx)),
    byTypeVap:byTypeVp,          byTypeVapTotal:    onVolume_(tot(byTypeVp)),
    extras:exDetail, extrasTotal:tot(exDetail),
    vap:vpDetail,    vapTotal:   tot(vpDetail),
    detailTotal: tot(exDetail.concat(vpDetail)) };
}
function finalizeExtra_(g, baseCY, basePY){
  g.revPct = g.pyRev? (g.cyRev-g.pyRev)/Math.abs(g.pyRev) : 0;
  g.aspCY = g.cyM3? g.cyRev/g.cyM3 : 0;
  g.aspPY = g.pyM3? g.pyRev/g.pyM3 : 0;
  g.aspChg = g.aspCY-g.aspPY;
  g.rateCY = baseCY? g.cyM3/baseCY : 0;   // 2026 applied rate = 2026 M3 / total CY concrete
  g.ratePY = basePY? g.pyM3/basePY : 0;   // 2025 applied rate = 2025 M3 / total PY concrete
  g.rateChg = g.rateCY - g.ratePY;        // change in applied rate
  return g;
}


/* ===================== COMMERCIAL PRODUCT SEGMENT SLIDE =====================
 * ONE call builds the whole slide: the Major Project Segment table AND the two
 * Extras / VAP tables, for one market + period + month.
 *
 * THE SEGMENT TABLE IS COMPUTED FROM Main / Extra / Associate Raw Data.
 * It used to be read off the pre-summed "Slide Segment MTD / YTD" tabs that
 * QlikView wrote for that page alone. Those tabs were a second copy of numbers
 * this backend already holds - one more export to run every month, and one more
 * thing to drift from the Ready-Mix page. The page now reads THIS, so the slide
 * and the RMX page can never disagree, the market list is the real PLANT LOOKUP
 * one, and the month picker actually slices the data instead of only setting
 * the wording.
 *
 * ASP INC VA = (base concrete revenue + Extras + VAP) / concrete m3, per
 * segment, on ONE denominator - the segment's own concrete volume - so the rows
 * add to the Total exactly. Applied m3 is deliberately NOT the denominator: it
 * counts the same pour once per extra type (see the note above rxfAspBlock_).
 *
 * Extras and VAP rows DO carry Major Project Segment, so the VA half follows
 * the segment split properly. They carry no product mix, which is why this
 * page offers no strength / class breakdown.
 */
function slideSegment_(bundle, market, month){
  var agg = {}, order = [];
  function bucket(label){
    var g = agg[label];
    if (!g){ g = agg[label] = { label:label, cyVol:0, pyVol:0,
                                baseCY:0, basePY:0, vaCY:0, vaPY:0 }; order.push(label); }
    return g;
  }
  bundle.main.forEach(function(m){
    if (!mktOk_(m.market, market) || !inMonth_(m.month, month)) return;
    var g = bucket(rxfLbl_(m.segment));
    g.cyVol += m.cyVol; g.pyVol += m.pyVol; g.baseCY += m.cyRev; g.basePY += m.pyRev;
  });
  function addVa(rows){
    rows.forEach(function(e){
      if (!mktOk_(e.market, market) || !inMonth_(e.month, month)) return;
      var g = bucket(rxfLbl_(e.segment));
      g.vaCY += e.cyRev; g.vaPY += e.pyRev;
    });
  }
  addVa(bundle.extras); addVa(bundle.assoc);

  var t = { label:'Total', cyVol:0, pyVol:0, baseCY:0, basePY:0, vaCY:0, vaPY:0 };
  order.forEach(function(k){
    var g = agg[k];
    t.cyVol+=g.cyVol; t.pyVol+=g.pyVol; t.baseCY+=g.baseCY; t.basePY+=g.basePY;
    t.vaCY+=g.vaCY;   t.vaPY+=g.vaPY;
  });

  /* A rate is null, never 0, when its denominator is missing - the page prints
     "-" for it rather than a $0.00 that reads like a real price. */
  function pack(g, tot){
    var aCY = g.cyVol ? (g.baseCY + g.vaCY) / g.cyVol : null;
    var aPY = g.pyVol ? (g.basePY + g.vaPY) / g.pyVol : null;
    return { label:g.label, cyVol:g.cyVol, pyVol:g.pyVol,
             cyShare: tot.cyVol ? g.cyVol/tot.cyVol : 0,
             pyShare: tot.pyVol ? g.pyVol/tot.pyVol : 0,
             volPct:  g.pyVol   ? (g.cyVol-g.pyVol)/g.pyVol : null,
             baseCY:g.baseCY, basePY:g.basePY, vaCY:g.vaCY, vaPY:g.vaPY,
             revCY:g.baseCY+g.vaCY, revPY:g.basePY+g.vaPY,
             aspCY:aCY, aspPY:aPY,
             aspPct: (aCY!=null && aPY) ? (aCY-aPY)/aPY : null };
  }
  var rows = order.map(function(k){ return pack(agg[k], t); })
                  .sort(function(a,b){ return b.cyVol - a.cyVol; });
  return { rows:rows, total:pack(t, t) };
}

/* Everything Page_Segment.html needs, in one round trip. Market defaults to
   Central Canada (every market), which is what that page opens on. */
function getSlideTables(opts){
  opts = opts || {};
  var period = (opts.period==='MTD') ? 'MTD' : 'YTD';
  return selCached_(selKey_('slide', period, opts.month, opts.market || ALL_MARKETS),
                    opts, function(){
    var bundle = opts.upload ? loadUploaded_(opts.upload) : loadDataCached_(!!opts.force);
    var month  = monthFor_(bundle, period, opts.month);
    var main   = scopeMonth_(bundle.main, month);
    var market = opts.market || ALL_MARKETS;
    return { ok:true, market:market, period:period,
             month:       monthSel_(bundle, opts.month),
             latestMonth: bundleMonth_(bundle),
             months:      bundleMonths_(bundle),
             markets:     bundle.markets || [],
             allMarkets:  ALL_MARKETS,
             segment:     slideSegment_(bundle, market, month),
             extras:      extrasPayload_(bundle, main, market, month),
             rowCount:    main.length,
             build: BUILD, generation: generation_() };
  });
}


/* ===================== CROSS-FILTER report (Executive Overview) =====================
 * One payload that serves every Ready-Mix panel on the Overview page, the same
 * way PV.getCrossReport serves the Aggregates side. Same contract, same cache
 * discipline, same nFail/fail trick for the per-field option lists.
 *
 *   filters : OR within a field, AND across fields. A field filters ITSELF too,
 *             so clicking "Civil" collapses the Segment table to Civil; more
 *             values are added through the search box.
 *   options : per field, the values still available if THAT field's own filter
 *             were lifted (everything else applied) - feeds the add-search.
 *
 * PPI IS RE-INDEXED, NEVER SUMMED. Every metrics call re-buckets its own slice
 * to PLANT x MIX and re-tests covered_() on the collapse, which is exactly what
 * Qlik does when you make a selection. Two consequences to keep in mind:
 *   - a segment row's PPI does not weight-average back to the Total, because
 *     one plant x mix line can span several segments (this is Qlik's behaviour,
 *     not a rounding artefact - see the note above ppiMaps_);
 *   - monthly PPI does not sum to YTD PPI, because coverage is decided on the
 *     collapsed period. `notes.ppiNotAdditive` carries that to the page.
 *
 * EXTRAS / VAP CANNOT FOLLOW EVERY FILTER. Those rows are keyed on plant +
 * material and carry no product mix, so STRENGTH and CLASS are meaningless to
 * them. When either is selected the ASP block comes back {ok:false} and the
 * page shows "-" for Extras / VAP / All-in; BASE and PPI stay correct.
 * =================================================================== */
var RXF_ORDER   = ['SUBMARKET', 'SEGMENT', 'STRENGTH', 'CLASS', 'PLANT'];
var RXF_LABEL   = { SUBMARKET:'Submarket', SEGMENT:'Major Project Segment',
                    STRENGTH:'Strength Class', CLASS:'Product Class', PLANT:'Plant' };
var RXF_EXTRA_OK = { SUBMARKET:1, SEGMENT:1, PLANT:1 };   // fields extras rows carry
var RXF_MIX_ONLY = ['STRENGTH', 'CLASS'];                 // fields only Main Raw Data has
var RXF_TABLE_CAP = { PLANT: 80 };                        // options carry the full label list
var RXF_DRILL_CAP = 100;                                  // plant x mix drill rows
var RXF_EXCL_CAP  = 25;                                   // coverage-excluded pairs listed

function rxfLbl_(v){ return String(v==null?'':v).trim() || '(blank)'; }
function rxfMainVal_(m, f){
  return f==='SUBMARKET' ? m.submarket
       : f==='SEGMENT'   ? m.segment
       : f==='STRENGTH'  ? m.strength
       : f==='CLASS'     ? m.cls
       :                   m.plant;               // PLANT
}
function rxfExtraVal_(e, f){
  return f==='SUBMARKET' ? e.submarket
       : f==='SEGMENT'   ? e.segment
       : f==='PLANT'     ? e.plant
       :                   '';                    // STRENGTH / CLASS: not on these rows
}

/* PPI for an arbitrary slice, at Qlik's plant x mix grain, coverage floors
   re-tested on whatever the slice collapses to. Returns the weight/factor pair
   as well so the page can merge slices without re-asking the server. */
function rxfPpi_(rows){
  var b = {}, order = [];
  rows.forEach(function(m){
    var k = String(m.plant||'') + '\u2016' + String(m.mix||'');
    var g = b[k];
    if (!g){ g = b[k] = { pyVol:0, pyRev:0, cyVol:0, cyRev:0 }; order.push(k); }
    g.pyVol+=m.pyVol; g.pyRev+=m.pyRev; g.cyVol+=m.cyVol; g.cyRev+=m.cyRev;
  });
  var w = 0, f = 0;
  order.forEach(function(k){
    var g = b[k];
    if (!covered_(g.pyVol, g.pyRev, g.cyVol, g.cyRev)) return;
    var pa = g.pyVol ? g.pyRev/g.pyVol : 0, ca = g.cyVol ? g.cyRev/g.cyVol : 0;
    w += g.cyRev; f += g.cyRev * (pa ? (ca-pa)/pa : 0);
  });
  return { w:w, f:f, ppi: w ? f/w : 0, pairs: order.length };
}

/* VOL + BASE revenue + PPI for a slice. Same field names the Overview already
   reads off out.rmx[market], so the page's formatters need no changes. */
function rxfMetrics_(rows){
  var cyVol=0, pyVol=0, baseCY=0, basePY=0;
  rows.forEach(function(m){ cyVol+=m.cyVol; pyVol+=m.pyVol; baseCY+=m.cyRev; basePY+=m.pyRev; });
  var aCY = cyVol ? baseCY/cyVol : 0, aPY = pyVol ? basePY/pyVol : 0;
  var pp  = rxfPpi_(rows);
  return { cyVol:cyVol, pyVol:pyVol, volPct: pyVol ? (cyVol-pyVol)/pyVol : 0,
           baseCY:baseCY, basePY:basePY, aspBaseCY:aCY, aspBasePY:aPY,
           aspIncBase: aPY ? (aCY-aPY)/aPY : 0,
           rfiBase:pp.w, facBase:pp.f, ppiBase:pp.ppi,
           present: !!(cyVol||pyVol||baseCY||basePY) };
}

/* BASE / EXTRAS / VAP / ALL-IN on ONE denominator - the filtered total concrete
   m3 - so the three rows add to All-in exactly and every figure is a genuine
   $/m3 on the same base as BASE ASP. Applied m3 is deliberately NOT used here:
   it counts the same pour once per extra type and is not additive. */
function rxfAspBlock_(volCY, volPY, baseCY, basePY, exRows, vaRows){
  function sum(rows){
    var s = { cy:0, py:0 };
    rows.forEach(function(e){ s.cy += e.cyRev; s.py += e.pyRev; });
    return s;
  }
  function row(label, cyRev, pyRev){
    var cy = volCY ? cyRev/volCY : 0, py = volPY ? pyRev/volPY : 0;
    return { label:label, cyRev:cyRev, pyRev:pyRev, aspCY:cy, aspPY:py,
             aspChg: cy-py, aspPct: py ? (cy-py)/py : 0,
             revPct: pyRev ? (cyRev-pyRev)/Math.abs(pyRev) : 0 };
  }
  var ex = sum(exRows), va = sum(vaRows);
  return { ok:true, volCY:volCY, volPY:volPY,
           rows: [ row('Base', baseCY, basePY),
                   row('Extras', ex.cy, ex.py),
                   row('VAP', va.cy, va.py) ],
           total: row('All-in', baseCY+ex.cy+va.cy, basePY+ex.py+va.py) };
}

function getCrossReport(opts){
  opts = opts || {};
  var period = (opts.period==='MTD') ? 'MTD' : 'YTD';
  var market = opts.market || ALL_MARKETS;

  /* normalise filters + a stable signature (sorted, so equivalent selections
     share one cache entry) */
  var filters = {}, sigParts = [];
  RXF_ORDER.forEach(function(f){
    var v = (opts.filters && opts.filters[f]) || [];
    filters[f] = (Object.prototype.toString.call(v)==='[object Array]' ? v : [v])
      .map(function(x){ return String(x==null?'':x).trim(); })
      .filter(function(x){ return !!x; });
    if (filters[f].length) sigParts.push(f + '=' + filters[f].slice().sort().join('\u2016'));
  });

  var ck = cacheKey_(['xf', period, 'm' + (Number(opts.month) || 0), market,
                      sigParts.join('&') || 'none']);
  var hit = cacheGet_(ck); if (hit) return hit;

  var bundle = loadDataCached_(false);
  var month  = monthFor_(bundle, period, opts.month);

  var fSet = {};
  RXF_ORDER.forEach(function(f){
    var s = null;
    if (filters[f].length){ s = {}; filters[f].forEach(function(v){ s[v] = true; }); }
    fSet[f] = s;
  });

  /* ONE pass over the market's rows. Month is deliberately NOT applied here -
     the trend series needs every month while the panels need the period scope,
     and both come off this list. nFail/fail answer "all filters except F"
     without a second pass. */
  var recs = [];
  bundle.main.forEach(function(m){
    if (!mktOk_(m.market, market)) return;
    var rc = { r:m, v:{}, nFail:0, fail:'' };
    RXF_ORDER.forEach(function(f){
      var val = rxfLbl_(rxfMainVal_(m, f));
      rc.v[f] = val;
      if (fSet[f] && !fSet[f][val]){ rc.nFail++; rc.fail = f; }
    });
    recs.push(rc);
  });
  function inPeriod(rc){ return inMonth_(rc.r.month, month); }

  var full = [];
  recs.forEach(function(rc){ if (rc.nFail===0 && inPeriod(rc)) full.push(rc.r); });
  var totals = rxfMetrics_(full);

  /* per-field OPTIONS: every filter applied except the field's own */
  var options = {};
  RXF_ORDER.forEach(function(f){
    var opt = {};
    recs.forEach(function(rc){
      if (!inPeriod(rc)) return;
      if (rc.nFail===0 || (rc.nFail===1 && rc.fail===f)){ var v = rc.v[f]; if (v) opt[v] = true; }
    });
    options[f] = Object.keys(opt).sort();
  });

  /* dimension tables - fully filtered, own field included */
  var tables = [];
  RXF_ORDER.forEach(function(f){
    var groups = {}, order = [];
    recs.forEach(function(rc){
      if (rc.nFail!==0 || !inPeriod(rc)) return;
      var k = rc.v[f];
      var g = groups[k]; if (!g){ g = groups[k] = []; order.push(k); }
      g.push(rc.r);
    });
    var rows = order.map(function(k){ var mm = rxfMetrics_(groups[k]); mm.label = k; return mm; })
      .sort(function(a,b){ return b.cyVol - a.cyVol; });
    var trimmed = 0, cap = RXF_TABLE_CAP[f];
    if (cap && rows.length > cap){ trimmed = rows.length - cap; rows = rows.slice(0, cap); }
    tables.push({ key:f, label:RXF_LABEL[f], rows:rows, trimmed:trimmed });
  });

  /* EXTRAS / VAP - only when no mix-only field is selected */
  var mixFiltered = false;
  RXF_MIX_ONLY.forEach(function(f){ if (filters[f].length) mixFiltered = true; });
  function extraPass(e, useMonth){
    if (!mktOk_(e.market, market)) return false;
    if (useMonth && !inMonth_(e.month, month)) return false;
    for (var i=0; i<RXF_ORDER.length; i++){
      var f = RXF_ORDER[i];
      if (!fSet[f] || !RXF_EXTRA_OK[f]) continue;
      if (!fSet[f][rxfLbl_(rxfExtraVal_(e, f))]) return false;
    }
    return true;
  }
  var exRows = [], vaRows = [];
  if (!mixFiltered){
    bundle.extras.forEach(function(e){ if (extraPass(e, true)) exRows.push(e); });
    bundle.assoc .forEach(function(e){ if (extraPass(e, true)) vaRows.push(e); });
  }
  var asp = mixFiltered
    ? { ok:false, reason:'mix',
        why:'Extras and VAP are recorded per plant and material, with no product '
          + 'mix, so a ' + RXF_MIX_ONLY.map(function(f){ return RXF_LABEL[f]; }).join(' or ')
          + ' filter cannot be applied to them. Base ASP and PPI are unaffected.' }
    : rxfAspBlock_(totals.cyVol, totals.pyVol, totals.baseCY, totals.basePY, exRows, vaRows);

  /* by extra type, on the same single denominator as the ASP block */
  var byType = null;
  if (!mixFiltered){
    var tmap = {}, torder = [];
    exRows.concat(vaRows).forEach(function(e){
      var k = e.stream + '\u2016' + e.type;
      var g = tmap[k];
      if (!g){ g = tmap[k] = { label:e.type, stream:e.stream, cyRev:0, pyRev:0 }; torder.push(k); }
      g.cyRev += e.cyRev; g.pyRev += e.pyRev;
    });
    byType = torder.map(function(k){
      var g = tmap[k];
      g.aspCY = totals.cyVol ? g.cyRev/totals.cyVol : 0;
      g.aspPY = totals.pyVol ? g.pyRev/totals.pyVol : 0;
      g.aspChg = g.aspCY - g.aspPY;
      g.revPct = g.pyRev ? (g.cyRev-g.pyRev)/Math.abs(g.pyRev) : 0;
      return g;
    }).sort(function(a,b){ return b.cyRev - a.cyRev; });
  }

  /* MONTHLY SERIES - every month the data carries, ignoring the MTD scope, so
     the trend charts do not collapse to one point when MTD is selected. */
  var mrows = {}, mmonths = {};
  recs.forEach(function(rc){
    if (rc.nFail!==0) return;
    var mo = rc.r.month || 0; if (!mo) return;
    (mrows[mo] || (mrows[mo] = [])).push(rc.r);
    mmonths[mo] = true;
  });
  var mex = {}, mva = {};
  if (!mixFiltered){
    bundle.extras.forEach(function(e){ if (extraPass(e,false) && e.month) (mex[e.month]||(mex[e.month]={cy:0,py:0})), mex[e.month].cy+=e.cyRev, mex[e.month].py+=e.pyRev; });
    bundle.assoc .forEach(function(e){ if (extraPass(e,false) && e.month) (mva[e.month]||(mva[e.month]={cy:0,py:0})), mva[e.month].cy+=e.cyRev, mva[e.month].py+=e.pyRev; });
  }
  var months = Object.keys(mmonths).map(Number).sort(function(a,b){ return a-b; })
    .map(function(mo){
      var mm = rxfMetrics_(mrows[mo]);
      var ex = mex[mo] || { cy:0, py:0 }, va = mva[mo] || { cy:0, py:0 };
      return { month:mo, cyVol:mm.cyVol, pyVol:mm.pyVol, volPct:mm.volPct,
               aspBaseCY:mm.aspBaseCY, aspBasePY:mm.aspBasePY, aspIncBase:mm.aspIncBase,
               ppiBase:mm.ppiBase, rfiBase:mm.rfiBase, facBase:mm.facBase,
               exAspCY: mixFiltered ? null : (mm.cyVol ? ex.cy/mm.cyVol : 0),
               exAspPY: mixFiltered ? null : (mm.pyVol ? ex.py/mm.pyVol : 0),
               vaAspCY: mixFiltered ? null : (mm.cyVol ? va.cy/mm.cyVol : 0),
               vaAspPY: mixFiltered ? null : (mm.pyVol ? va.py/mm.pyVol : 0) };
    });

  /* PLANT x MIX DRILL - the grain PPI is actually indexed at. `excluded` lists
     the pairs the coverage floors drop: pairs that WOULD have earned weight
     under the old "> 0" test. That is the list that makes a 23,664% North read
     explain itself in one click instead of needing a harness. */
  var pmMap = {}, pmOrder = [];
  full.forEach(function(m){
    var k = String(m.plant||'') + '\u2016' + String(m.mix||'');
    var g = pmMap[k];
    if (!g){ g = pmMap[k] = { plant:m.plant, mix:m.mix, pyVol:0, pyRev:0, cyVol:0, cyRev:0 }; pmOrder.push(k); }
    g.pyVol+=m.pyVol; g.pyRev+=m.pyRev; g.cyVol+=m.cyVol; g.cyRev+=m.cyRev;
  });
  var drill = [], excluded = [];
  pmOrder.forEach(function(k){
    var g = pmMap[k];
    var pa = g.pyVol ? g.pyRev/g.pyVol : 0, ca = g.cyVol ? g.cyRev/g.cyVol : 0;
    var inc = pa ? (ca-pa)/pa : 0;
    var cov = covered_(g.pyVol, g.pyRev, g.cyVol, g.cyRev);
    var row = { plant:g.plant, mix:g.mix, cyVol:g.cyVol, pyVol:g.pyVol,
                cyRev:g.cyRev, pyRev:g.pyRev, aspCY:ca, aspPY:pa, aspInc:inc,
                covered:cov, weight: cov ? g.cyRev : 0 };
    drill.push(row);
    /* would have counted under "> 0" but does not clear the floors */
    if (!cov && g.pyVol>0 && g.pyRev>0 && g.cyVol>0 && g.cyRev>0){
      excluded.push({ plant:g.plant, mix:g.mix, pyVol:g.pyVol, pyRev:g.pyRev,
                      cyVol:g.cyVol, cyRev:g.cyRev, aspInc:inc, wouldWeigh:g.cyRev });
    }
  });
  drill.sort(function(a,b){ return b.cyRev - a.cyRev; });
  excluded.sort(function(a,b){ return Math.abs(b.aspInc*b.wouldWeigh) - Math.abs(a.aspInc*a.wouldWeigh); });
  var drillTrimmed = Math.max(0, drill.length - RXF_DRILL_CAP);
  var exclCount = excluded.length;

  var cov = covRmx_();
  var report = {
    ok: true, period: period, market: market, filters: filters,
    totals: totals, tables: tables, options: options,
    asp: asp, byType: byType, months: months,
    drill: { rows: drill.slice(0, RXF_DRILL_CAP), trimmed: drillTrimmed,
             pairs: drill.length,
             excluded: excluded.slice(0, RXF_EXCL_CAP), excludedCount: exclCount,
             coverage: { minVol: cov.minVol, minRev: cov.minRev } },
    notes: {
      ppiNotAdditive: true,       // monthly PPI does not sum to the period PPI
      extrasFollowMix: false,     // Extras/VAP carry no product mix
      mixFiltered: mixFiltered
    },
    labels: RXF_LABEL, order: RXF_ORDER,
    rowCount: full.length, latestMonth: bundleMonth_(bundle),
    /* NOT `months` - that key is already taken above by the MONTHLY SERIES the
       trend charts read, and a second `months:` here silently overwrote it.
       The picker's option list travels as monthOptions. */
    month: monthSel_(bundle, opts.month), monthOptions: bundleMonths_(bundle),
    generation: generation_()
  };
  cachePut_(ck, report);
  return report;
}


  // Surface what the front end / Code.gs need.
  return {
    getMarkets:     getMarkets,
    prepareAll:     prepareAll,   // the one pull - see the block comment above
    getKeys:        getKeys,
    getExtras:      getExtras,
    getSlideTables: getSlideTables,  // Commercial Product Segment slide (one call)
    getCrossReport: getCrossReport,   // Overview cross-filter (RMX side)
    getUnmapped:    getUnmapped,
    syncData:       syncData,
    uploadData:     uploadData,
    bumpGeneration: bumpGeneration_,  // used by Code.gs syncAll()
    /* The Overview's month cube reads these — the SAME cached bundle this page
       already built (main / extras / assoc + lookups), so the cube never opens
       the sheet itself and adds nothing to any page load. Read-only. */
    dataBundle:     function(){ return loadDataCached_(false); },
    lookups:        function(){ return getLookupsCached_(false); },
  };
})();

/* ==========================================================================
 * NAMESPACE CAPTURE - do not remove.
 * --------------------------------------------------------------------------
 * Every .gs file in an Apps Script project shares ONE global scope, and files
 * are evaluated in an order the editor does not show. If any other file in the
 * project also declares `var RMX` (an old copy of this backend left behind is
 * the usual way), whichever file loads LAST wins - silently. The page then
 * calls into a stale object that returns no month list, so every figure covers
 * the whole year, and RMX.build/RMX.dataBundle are simply missing.
 *
 * RMX_NS captures the object THIS file built, at the moment THIS file is
 * evaluated. A sibling that reassigns `RMX` afterwards cannot reach it. Every
 * entry point below, and every other file in the suite, goes through RMX_NS.
 * ======================================================================== */
var RMX_NS = RMX;

/* ==========================================================================
 * Top-level wrappers for google.script.run.
 * --------------------------------------------------------------------------
 * The RMX_* names are what Page_Rmx.html calls. They are unique to this file,
 * so a stale sibling with its own generic getKeys/getMarkets cannot shadow
 * them. The bare names below are kept so anything still calling the old
 * endpoints keeps working - but they too resolve through RMX_NS, never
 * through the ambient `RMX`.
 * ======================================================================== */
function RMX_getMarkets(opts)     { return RMX_NS.getMarkets(opts); }
function RMX_prepare(opts) {
  var t0 = Date.now();
  APP_log('info', 'RMX.prepareAll', 'reading',
          { market: (opts && opts.market) || '', month: (opts && opts.month) || 0,
            want: (opts && opts.want) || 'all', upload: !!(opts && opts.upload),
            force: !!(opts && opts.force) });
  try {
    var out = RMX_NS.prepareAll(opts);
    /* ELAPSED MS IS THE FIELD THAT EARNS ITS PLACE HERE. README §6: every RMX
       entry point used to pull a 14 MB bundle through CacheService to produce a
       72 KB answer, and it hid for a long time because nothing about it looked
       wrong. A flat 15-24 s against a varying question is what a reader would
       have seen on the first line of the transcript. */
    APP_log('info', 'RMX.prepareAll', 'ok',
            { ms: Date.now() - t0, rows: ((out && out.markets) || []).length,
              month: out && out.month, latest: out && out.latestMonth,
              warmed: out && out.warmed, want: out && out.want });
    return out;
  } catch (err) {
    APP_log('error', 'RMX.prepareAll', 'failed',
            { ms: Date.now() - t0, market: (opts && opts.market) || '',
              month: (opts && opts.month) || 0,
              error: String(err && err.message ? err.message : err) });
    throw err;
  }
}
function RMX_getKeys(opts)        { return RMX_NS.getKeys(opts); }
function RMX_getExtras(opts)      { return RMX_NS.getExtras(opts); }
function RMX_getSlideTables(opts) { return RMX_NS.getSlideTables(opts); }
function RMX_getUnmapped(opts)    { return RMX_NS.getUnmapped(opts); }
function RMX_getCrossReport(opts) { return RMX_NS.getCrossReport(opts); }
function RMX_syncData(opts)       { return RMX_NS.syncData(opts); }
function RMX_uploadData(p)        { return RMX_NS.uploadData(p); }

/* legacy names - unchanged signatures, now bound to the captured namespace */
function getMarkets(opts) { return RMX_NS.getMarkets(opts); }
function getKeys(opts)    { return RMX_NS.getKeys(opts); }
function getExtras(opts)  { return RMX_NS.getExtras(opts); }
/* NOT named getCrossReport: that top-level name already belongs to PV (Aggregates). */
function getRmxCrossReport(opts) { return RMX_NS.getCrossReport(opts); }
function getRmxUnmapped(opts) { return RMX_NS.getUnmapped(opts); }
function syncData(opts)   { return RMX_NS.syncData(opts); }
function uploadRmxData(p) { return RMX_NS.uploadData(p); }


/* ---- RMX_Suggest.gs ----------------------------------------------------------
   The Ready-Mix lookup suggester behind the Mapping check card.  */

/*****************************************************************************
 * RMX_Suggest.gs — Mapping check: suggest new lookup rows, then write them.
 * ---------------------------------------------------------------------------
 * When the Mapping check finds values the lookup tabs can't match, this file
 * proposes the row that should be added, shows how confident it is, and (once
 * the user ticks and approves) appends the rows to the lookup tabs.
 *
 * THREE INDEPENDENT MODELS — one per lookup. They never inform each other.
 *
 *   PRODUCT MASTER      deterministic parse of the Product Mix text
 *                       (MPa -> Strength Class, -TECT token -> Product Class,
 *                        Application derived, retired brand -> Old/New Desc)
 *   CUSTOM FLAG LOOKUP  nearest-neighbour on mat_descr wording
 *   EXTRAS LOOKUP       nearest-neighbour on mat_descr wording
 *                       (mat_prod_hier_3 is carried through from the raw data,
 *                        never predicted — it's the user's column)
 *
 * WHY NEAREST-NEIGHBOUR AND NOTHING CLEVERER
 * So: no training, no weights, no probability tables. Just "which existing
 * row reads most like this one". Deterministic — same input, same output.
 *
 * Low-confidence rows are NOT guessed: they fall back to the catch-all value
 * and are flagged in the UI for the user to set.
 *
 * SELF-CONTAINED BY NECESSITY: RMX_Backend.gs and PV_Backend.gs are both
 * wrapped in IIFEs, so their helpers (norm_, readSheet_, col_, ...) are
 * closure-private and unreachable from here. Everything below is local, with
 * an sg* prefix so it can never collide. The only outside things used are the
 * genuine globals: APP_CONFIG, APP_openSpreadsheet_, APP_cachePut_/GET_,
 * APP_getGen_, and the RMX namespace's two exported functions.
 *
 * STRENGTH RULE (v2): a Strength Class is assigned ONLY when the text carries
 * an MPa marker directly against a number. A bare number in a product name
 * (VERTICAL40, ULTRAHORIZONTAL 35 C1) or against a class token (30F1, 35 C1)
 * is NOT evidence of strength — those rows are "Others". This mirrors the
 * PRODUCT MASTER sheet after the consistency pass.
 *****************************************************************************/

var RMXSUGGEST = (function () {

/* =================== config =================== */
function sgSheets_(){ return APP_CONFIG.PAGES.rmx.SHEETS; }

var SG_CACHE_VER = 'sg2';          // bumped: model shape + strength rule changed
var SG_LOCK_MS   = 30000;

/* Retired -> current brand names (PRODUCT MASTER only).
 * Ordered longest-first so a short variant can never eat a longer one, and
 * includes the misspellings that actually occur in the source data. */
var SG_OLD2NEW_LIST = [
  ['WEATHERMIX', 'TEMPTECT'],
  ['WEATHER MIX','TEMPTECT'],
  ['CHRONOLIA',  'RAPIDTECT'],
  ['ARTEV IA',   'IMAGITECT'],     // observed typo: "ARTEV IA COLOUR 32MPA..."
  ['ARTEVIA',    'IMAGITECT'],
  ['ECOPACT',    'ECOTECT'],
  ['ECOAPCT',    'ECOTECT'],       // observed typo: "ECOAPCT ULTRA HORI 25MPA..."
  ['DYNAMAX',    'SUPERTECT'],
  ['AGILIA',     'FLUIDTECT'],
  ['AGILA',      'FLUIDTECT']      // observed typo: "AGILA 30 10MM UNDERGROUND"
];
/* NOT brands, deliberately: a bare "ECO" is a modifier that rides alongside a
 * real brand (TEMPTECT ECO, SUPERTECT ECO), and "COLD WEATHER" is weather. */

var SG_TECTS = ['ECOTECT','TEMPTECT','SUPERTECT','FLUIDTECT','RAPIDTECT','IMAGITECT','CONDUTECT'];

/* Strength: an MPa marker against a number is the ONLY accepted evidence. */
var SG_RE_MPA_WORD = /(\d+(?:\.\d+)?)\s*M(?:PA?|A)\b/;   // 35MPA / 32 MPA / 32MP / 65MA typo
var SG_RE_MPA_GLUE = /(\d+(?:\.\d+)?)\s*MPA/;            // 50MPAF1 / 0.4MPAUFILL
var SG_RE_MPA_TYPO = /(\d+(?:\.\d+)?)\s*M(?:P|A)\b/;     // flags MP / MA spellings

/* "ECO <retired brand>" compound. In the sheet this pattern is only ever
 * resolved as ECOTECT + stem for WEATHERMIX (18 rows, e.g.
 *   ECO WEATHERMIX 25MPA F2 20MM HR -> ECOTECT TEMP 25MPA F2 20MM HR).
 * DYNAMAX compounds went the other way (ECO DYNAMAX 60MPA -> SUPERTECT ECO
 * 60MPA), so the rule is restricted to WEATHERMIX rather than generalised. */
var SG_RE_ECO = /^\s*ECO\s+(WEATHERMIX)\b/;

/* =================== small utils =================== */
function sgNorm_(s){
  return String(s == null ? '' : s)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/^['\u2018\u2019`]+/, '')
    .trim().toLowerCase().replace(/\s+/g, ' ');
}
/* mat_descr is "CODE - NAME". Split on the FIRST " - " only: descriptions
   contain their own dashes (e.g. "CONCRETE BLOCK - #2"). */
function sgSplit_(matDescr){
  var s = String(matDescr == null ? '' : matDescr).trim();
  var p = s.indexOf(' - ');
  if (p > 0) return { code: s.substring(0, p).trim(), name: s.substring(p + 3).trim() };
  return { code: '', name: s };
}
/* Distinct uppercase alphanumeric tokens — the only "feature" used. */
function sgTokens_(s){
  var raw = String(s == null ? '' : s).toUpperCase().split(/[^A-Z0-9]+/);
  var seen = {}, out = [];
  for (var i = 0; i < raw.length; i++){
    var t = raw[i];
    if (!t || seen[t]) continue;
    seen[t] = 1; out.push(t);
  }
  return out;
}
function sgEscape_(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* =================== cache =================== */
/* The model holds every lookup row's token array, so it can exceed the ~900KB
 * at which CacheService silently drops a write. Prefer the chunked writer when
 * the project exposes one; fall back to the plain pair otherwise. */
function sgCachePut_(key, obj){
  if (typeof APP_cachePutBig_ === 'function') return APP_cachePutBig_(key, obj);
  return APP_cachePut_(key, obj);
}
function sgCacheGet_(key){
  if (typeof APP_cacheGetBig_ === 'function') return APP_cacheGetBig_(key);
  return APP_cacheGet_(key);
}

/* =================== sheet access =================== */
function sgSheet_(name){
  var ss = APP_openSpreadsheet_('rmx');
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  var want = sgNorm_(name), all = ss.getSheets();
  for (var i = 0; i < all.length; i++) if (sgNorm_(all[i].getName()) === want) return all[i];
  throw new Error('Sheet not found: ' + name);
}
/* Header row is found the same way RMX_Backend does: the first row (of the
   first 8) that contains every "mustHave" column. */
function sgTable_(name, mustHave){
  var sh = sgSheet_(name);
  var values = sh.getDataRange().getValues();
  var hdr = 0;
  if (mustHave && mustHave.length){
    for (var r = 0; r < Math.min(8, values.length); r++){
      var rowN = values[r].map(sgNorm_), ok = true;
      for (var m = 0; m < mustHave.length; m++){
        if (rowN.indexOf(sgNorm_(mustHave[m])) === -1){ ok = false; break; }
      }
      if (ok){ hdr = r; break; }
    }
  }
  var idx = {};
  (values[hdr] || []).forEach(function(h, i){ if (h !== '' && h != null) idx[sgNorm_(h)] = i; });
  return { sh: sh, values: values, hdr: hdr, idx: idx };
}
function sgCol_(t, name){ var i = t.idx[sgNorm_(name)]; return (i == null ? -1 : i); }
/* Soft: returns -1 instead of throwing. EXTRAS LOOKUP's header is spelled
   "Catergory" in the live sheet, so every lookup here tries known variants. */
function sgFirstCol_(t, names){
  for (var i = 0; i < names.length; i++){ var c = sgCol_(t, names[i]); if (c !== -1) return c; }
  return -1;
}

/* =================== nearest-neighbour model =================== */
/* One entry per existing lookup row: its tokens, its category, and the
   description itself (so the UI can show WHY a suggestion was made). */
function sgIndexRows_(rows){
  var idx = {};
  for (var i = 0; i < rows.length; i++){
    var t = rows[i].t;
    for (var j = 0; j < t.length; j++) (idx[t[j]] = idx[t[j]] || []).push(i);
  }
  return idx;
}
function sgDistinct_(rows){
  var c = {};
  rows.forEach(function(r){ c[r.c] = (c[r.c] || 0) + 1; });
  return Object.keys(c).sort(function(a, b){ return c[b] - c[a]; });   // most used first
}
/* The value a low-confidence row falls back to: the explicit catch-all if the
   tab has one, otherwise the most common value. */
function sgFallback_(options){
  for (var i = 0; i < options.length; i++) if (/^other/i.test(options[i])) return options[i];
  return options[0] || 'Others';
}

function sgBuildModel_(){
  var S = sgSheets_();

  /* ---- CUSTOM FLAG LOOKUP : mat_descr -> Custom Flag ---- */
  var cf = sgTable_(S.CUSTOMFLAG, ['mat_descr','custom flag']);
  var cfD = sgCol_(cf, 'mat_descr'), cfF = sgCol_(cf, 'custom flag');
  var flagRows = [];
  for (var i = cf.hdr + 1; i < cf.values.length; i++){
    var d = String(cf.values[i][cfD] || '').trim(),
        v = String(cf.values[i][cfF] || '').trim();
    if (!d || !v) continue;
    var nm = sgSplit_(d).name;
    flagRows.push({ t: sgTokens_(nm), c: v, d: nm });
  }

  /* ---- EXTRAS LOOKUP : mat_descr -> Catergory  (hier_3 kept for the UI) ---- */
  var el = sgTable_(S.EXTRASLU, ['material (mat_descr)']);
  var elC = sgFirstCol_(el, ['category','catergory','new bucket']);
  var elM = sgFirstCol_(el, ['material (mat_descr)','mat_descr','material']);
  var elH = sgFirstCol_(el, ['mat_prod_hier_3','mat prod hier 3','hier3','hier 3']);
  var extraRows = [], hier3Seen = {};
  for (var k = el.hdr + 1; k < el.values.length; k++){
    var em = String(el.values[k][elM] || '').trim(),
        ec = String(el.values[k][elC] || '').trim();
    if (elH !== -1){
      var h = String(el.values[k][elH] || '').trim();
      if (h) hier3Seen[h] = 1;
    }
    if (!em || !ec) continue;
    var enm = sgSplit_(em).name;
    extraRows.push({ t: sgTokens_(enm), c: ec, d: enm });
  }

  /* ---- PRODUCT MASTER : only its existing vocabulary is needed, because the
     suggestion itself is parsed from the text, not matched to a neighbour ---- */
  var pm = sgTable_(S.PRODUCT, ['product code','strength class']);
  var pmS = sgCol_(pm, 'strength class'),
      pmC = sgCol_(pm, 'new product class'),
      pmA = sgCol_(pm, 'new product application');
  var strengthSet = {}, clsSet = {}, appSet = {};
  for (var p = pm.hdr + 1; p < pm.values.length; p++){
    var rw = pm.values[p];
    if (pmS !== -1 && rw[pmS]) strengthSet[String(rw[pmS]).trim()] = 1;
    if (pmC !== -1 && rw[pmC]) clsSet[String(rw[pmC]).trim()] = 1;
    if (pmA !== -1 && rw[pmA]) appSet[String(rw[pmA]).trim()] = 1;
  }

  return {
    flag:   { rows: flagRows,  idx: sgIndexRows_(flagRows)  },
    extras: { rows: extraRows, idx: sgIndexRows_(extraRows) },
    options: {
      flag:     sgDistinct_(flagRows),
      category: sgDistinct_(extraRows),
      hier3:    Object.keys(hier3Seen).sort(),
      strength: Object.keys(strengthSet).sort(),
      cls:      Object.keys(clsSet).sort(),
      app:      Object.keys(appSet).sort()
    }
  };
}
function sgModelCached_(force){
  var key = SG_CACHE_VER + '|g' + APP_getGen_('rmx') + '|sugmodel';
  if (!force){ var c = sgCacheGet_(key); if (c) return c; }
  var m = sgBuildModel_();
  sgCachePut_(key, m);
  return m;
}

/* Jaccard between the query token set and one candidate's token array. */
function sgJaccard_(qMap, qLen, arr){
  var inter = 0;
  for (var i = 0; i < arr.length; i++) if (qMap[arr[i]]) inter++;
  var uni = qLen + arr.length - inter;
  return uni ? inter / uni : 0;
}

/* Nearest-neighbour classify.
 * Candidates come from an inverted index, rarest token first, so a query never
 * scores every row — a very common token (e.g. "M3") is only used to widen the
 * pool if nothing rarer produced candidates. */
function sgClassify_(M, name, fallback){
  var q = sgTokens_(name);
  if (!q.length) return { value: fallback, band: 'Low', sim: 0, why: [] };
  var qMap = {}; for (var a = 0; a < q.length; a++) qMap[q[a]] = 1;

  var byRarity = q.slice().sort(function(x, y){
    return (M.idx[x] ? M.idx[x].length : 0) - (M.idx[y] ? M.idx[y].length : 0);
  });
  var cand = {}, n = 0, used = 0;
  for (var i = 0; i < byRarity.length; i++){
    var post = M.idx[byRarity[i]];
    if (!post) continue;
    if (post.length > 400 && used > 0) continue;      // too common to widen with
    for (var j = 0; j < post.length; j++){ if (!cand[post[j]]){ cand[post[j]] = 1; n++; } }
    used++;
    if (n > 1500) break;
  }

  var best = [];
  for (var idx in cand){
    var r = M.rows[idx];
    var s = sgJaccard_(qMap, q.length, r.t);
    if (s > 0) best.push({ s: s, c: r.c, d: r.d });
  }
  if (!best.length) return { value: fallback, band: 'Low', sim: 0, why: [] };
  best.sort(function(x, y){ return y.s - x.s; });
  var top = best.slice(0, 3);

  /* Bands exactly as validated. Agreement among the top 3 matters more than
     raw similarity: three neighbours saying the same thing is the signal. */
  var band;
  if (top.length >= 3 && top[0].c === top[1].c && top[1].c === top[2].c && top[0].s >= 0.50) band = 'High';
  else if (top.length >= 2 && top[0].c === top[1].c && top[0].s >= 0.34) band = 'Med';
  else if (top[0].s >= 0.70) band = 'High';
  else band = 'Low';

  /* A Low row defaults to the catch-all rather than guessing — but the closest
     match still travels with it, so the UI can offer it as a one-click option.
     (Measured: the raw guess is right 77.5% of the time on Low rows, the
     catch-all 64%. The user decides, we just don't pretend to be sure.) */
  return {
    value: (band === 'Low') ? fallback : top[0].c,
    guess: top[0].c,
    band:  band,
    sim:   Math.round(top[0].s * 100) / 100,
    why:   top.map(function(x){ return { d: x.d, c: x.c, s: Math.round(x.s * 100) / 100 }; })
  };
}

/* =================== PRODUCT MASTER: deterministic parse =================== */
function sgBucket_(v){
  if (v == null || isNaN(v)) return 'Others';
  if (v <= 15) return '0-15Mpa';
  if (v <= 20) return '15-20Mpa';
  if (v <= 25) return '21-25Mpa';
  if (v <= 30) return '26-30Mpa';
  if (v <= 35) return '31-35Mpa';
  if (v <= 44) return '36-44Mpa';
  if (v <= 64) return '45-64Mpa';
  return '65+Mpa';
}
/* Returns {band, how, typo}.
 *   explicit  the text carries an MPa marker against a number -> High
 *   null      no MPa marker at all                            -> Low, "Others"
 * A bare number — in a product name (VERTICAL40) or against a class token
 * (30F1) — is deliberately NOT treated as a strength. */
function sgStrength_(text){
  var u = String(text).toUpperCase(), m;
  if ((m = SG_RE_MPA_WORD.exec(u)) || (m = SG_RE_MPA_GLUE.exec(u))){
    return { band: sgBucket_(parseFloat(m[1])), how: 'explicit', typo: SG_RE_MPA_TYPO.test(u) };
  }
  return { band: 'Others', how: null, typo: false };
}
/* First -TECT token wins — including when two brands appear in one
 * description. Brandless rows are legitimately "Others". */
function sgProductClass_(text){
  var u = String(text).toUpperCase(), best = null, at = -1;
  for (var i = 0; i < SG_TECTS.length; i++){
    var p = u.indexOf(SG_TECTS[i]);
    if (p !== -1 && (at === -1 || p < at)){ at = p; best = SG_TECTS[i]; }
  }
  return best || 'Others';
}
/* Old Description is filled ONLY when a retired brand was actually present;
 * otherwise it stays blank and the text goes straight to New Description.
 * Leading "ECO WEATHERMIX" is the one compound the sheet resolves as ECOTECT
 * plus the other brand's stem:
 *   ECO WEATHERMIX 25MPA F2 20MM HR -> ECOTECT TEMP 25MPA F2 20MM HR */
function sgBrand_(desc){
  var src = String(desc == null ? '' : desc);
  var u = src.toUpperCase();

  var hits = [], occupied = [];
  for (var i = 0; i < SG_OLD2NEW_LIST.length; i++){
    var tok = SG_OLD2NEW_LIST[i][0], from = 0, p;
    while ((p = u.indexOf(tok, from)) !== -1){
      var clash = false;
      for (var o = 0; o < occupied.length; o++){
        if (p < occupied[o][1] && p + tok.length > occupied[o][0]){ clash = true; break; }
      }
      if (!clash){
        occupied.push([p, p + tok.length]);
        hits.push({ at: p, tok: tok, to: SG_OLD2NEW_LIST[i][1] });
      }
      from = p + tok.length;
    }
  }
  if (!hits.length) return { oldD: '', newD: src, eco: false };

  var m = SG_RE_ECO.exec(u);
  if (m){
    var stem = 'TEMPTECT'.replace('TECT', '');            // WEATHERMIX -> TEMP
    var tail = src.substring(m[0].length);                // preserve original casing
    return { oldD: src, newD: 'ECOTECT ' + stem + tail, eco: true };
  }

  /* Replace longest tokens first so a short variant can't corrupt a long one. */
  var uniq = {}, ordered = [];
  hits.forEach(function(h){ if (!uniq[h.tok]){ uniq[h.tok] = 1; ordered.push(h); } });
  ordered.sort(function(a, b){ return b.tok.length - a.tok.length; });
  var out = src;
  ordered.forEach(function(h){
    out = out.replace(new RegExp(sgEscape_(h.tok), 'ig'), h.to);
  });
  return { oldD: src, newD: out, eco: false };
}
function sgProductRow_(productMix){
  var sp   = sgSplit_(productMix);
  var code = sp.code || String(productMix || '').trim();
  var desc = sp.name || '';
  var br   = sgBrand_(desc);
  var st   = sgStrength_(br.newD);
  var cls  = sgProductClass_(br.newD);
  var app  = (cls === 'Others') ? 'Others'
           : (st.band === 'Others' ? cls + ' Others' : cls + ' ' + st.band);

  var notes = [], band;
  if (br.eco)               notes.push('ECO compound brand \u2014 check which brand leads');
  else if (br.oldD)         notes.push('retired brand converted');
  if (st.how === 'explicit'){
    band = 'High';
    if (st.typo){ band = 'Med'; notes.push('MPa is spelled "MP"/"MA" \u2014 fix the description text'); }
  } else {
    band = 'Low';
    notes.push('no MPa in the text \u2014 strength left as Others');
  }
  if (br.eco && band === 'High') band = 'Med';

  return { code: code, oldD: br.oldD, newD: br.newD,
           strength: st.band, cls: cls, app: app,
           band: band, note: notes.join('; ') };
}

/* =================== public: suggestions =================== */
function getSuggestions(opts){
  opts = opts || {};
  var un = RMX_NS.getUnmapped({ upload: opts.upload, force: !!opts.force });
  var M  = sgModelCached_(!!opts.force);

  var fbFlag = sgFallback_(M.options.flag);
  var fbCat  = sgFallback_(M.options.category);

  var product = (un.product || []).map(function(r){
    var s = sgProductRow_(r.value);
    return { value: r.value, rows: r.rows, markets: r.markets,
             code: s.code, oldD: s.oldD, newD: s.newD,
             strength: s.strength, cls: s.cls, app: s.app,
             band: s.band, note: s.note, why: [] };
  });

  var flag = (un.flag || []).map(function(r){
    var c = sgClassify_(M.flag, sgSplit_(r.value).name, fbFlag);
    return { value: r.value, rows: r.rows, markets: r.markets,
             flag: c.value, guess: c.guess, band: c.band, sim: c.sim, why: c.why,
             note: c.band === 'Low' ? 'no close match \u2014 defaulted' : '' };
  });

  var extras = (un.extras || []).map(function(r){
    var c = sgClassify_(M.extras, sgSplit_(r.value).name, fbCat);
    var h3 = (r.hier3 && r.hier3.length) ? r.hier3[0] : '';
    return { value: r.value, rows: r.rows, markets: r.markets,
             category: c.value, guess: c.guess, hier3: h3, hier3All: r.hier3 || [],
             band: c.band, sim: c.sim, why: c.why,
             note: c.band === 'Low' ? 'no close match \u2014 defaulted' : '' };
  });

  return { ok: true, product: product, extras: extras, flag: flag,
           options: M.options,
           total: product.length + extras.length + flag.length };
}

/* =================== public: links to the tabs themselves ===================
 * For anyone who'd rather edit the lookup in Sheets than through the dialog.
 * A tab that can't be opened comes back as '' and the link is simply hidden. */
function getUrls(){
  var S = sgSheets_(), out = {};
  [['product', S.PRODUCT], ['extras', S.EXTRASLU], ['flag', S.CUSTOMFLAG]].forEach(function(p){
    try {
      var sh = sgSheet_(p[1]);
      out[p[0]] = sh.getParent().getUrl() + '#gid=' + sh.getSheetId();
    } catch (e){ out[p[0]] = ''; }
  });
  return out;
}

/* =================== public: write approved rows =================== */
/* Appends to the lookup tab. Guarded because this writes to a source of truth:
 *   - a script lock, so two approvals can't interleave
 *   - the tab is re-read at write time and anything already there is skipped
 *     (the suggestion list may be minutes stale)
 *   - columns are resolved by header, never by fixed position
 *   - the key column is forced to text so leading zeros survive
 *   - the RMX generation is bumped so every cache picks the new rows up */
function applyRows(payload){
  payload = payload || {};
  var target = String(payload.target || '');
  var rows = payload.rows || [];
  if (!rows.length) return { ok: true, added: 0, skipped: 0, skippedValues: [] };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(SG_LOCK_MS); }
  catch (e){ throw new Error('Someone else is updating the lookup tabs right now. Please try again in a moment.'); }

  try {
    var S = sgSheets_(), t, plan;

    if (target === 'product'){
      t = sgTable_(S.PRODUCT, ['product code','strength class']);
      plan = {
        key:  sgCol_(t, 'product code'),
        cols: [
          { c: sgCol_(t, 'product code'),               f: function(r){ return r.code; } },
          { c: sgFirstCol_(t, ['old description']),     f: function(r){ return r.oldD || ''; } },
          { c: sgFirstCol_(t, ['new description']),     f: function(r){ return r.newD || ''; } },
          { c: sgFirstCol_(t, ['strength class']),      f: function(r){ return r.strength || 'Others'; } },
          { c: sgFirstCol_(t, ['new product class']),   f: function(r){ return r.cls || 'Others'; } },
          { c: sgFirstCol_(t, ['new product application']), f: function(r){ return r.app || 'Others'; } }
        ],
        keyOf: function(r){ return String(r.code || '').trim().toUpperCase(); },
        existing: function(v){ return String(v || '').trim().toUpperCase(); }
      };
    } else if (target === 'flag'){
      t = sgTable_(S.CUSTOMFLAG, ['mat_descr','custom flag']);
      plan = {
        key:  sgCol_(t, 'mat_descr'),
        cols: [
          { c: sgCol_(t, 'mat_descr'),    f: function(r){ return r.value; } },
          { c: sgCol_(t, 'custom flag'),  f: function(r){ return r.flag || ''; } }
        ],
        keyOf: function(r){ return sgNorm_(r.value); },
        existing: function(v){ return sgNorm_(v); }
      };
    } else if (target === 'extras'){
      t = sgTable_(S.EXTRASLU, ['material (mat_descr)']);
      var eM = sgFirstCol_(t, ['material (mat_descr)','mat_descr','material']);
      plan = {
        key:  eM,
        cols: [
          { c: sgFirstCol_(t, ['category','catergory','new bucket']), f: function(r){ return r.category || ''; } },
          { c: sgFirstCol_(t, ['mat_prod_hier_3','mat prod hier 3','hier3','hier 3']), f: function(r){ return r.hier3 || ''; } },
          { c: eM, f: function(r){ return r.value; } }
        ],
        keyOf: function(r){ return sgNorm_(r.value); },
        existing: function(v){ return sgNorm_(v); }
      };
    } else {
      throw new Error('Unknown lookup target: ' + target);
    }

    var missing = plan.cols.filter(function(c){ return c.c === -1; });
    if (plan.key === -1 || missing.length)
      throw new Error('Could not find the expected column(s) in that lookup tab. '
        + 'Check the header row hasn\u2019t been renamed.');

    /* what's already there (re-read now, not from cache) */
    var have = {};
    for (var i = t.hdr + 1; i < t.values.length; i++){
      var kv = plan.existing(t.values[i][plan.key]);
      if (kv) have[kv] = 1;
    }

    var width = Math.max(t.sh.getLastColumn(), 1);
    plan.cols.forEach(function(c){ if (c.c + 1 > width) width = c.c + 1; });

    var out = [], skipped = [];
    rows.forEach(function(r){
      var k = plan.keyOf(r);
      if (!k || have[k]){ skipped.push(r.value); return; }
      have[k] = 1;
      var line = [];
      for (var w = 0; w < width; w++) line.push('');
      plan.cols.forEach(function(c){ line[c.c] = c.f(r); });
      out.push(line);
    });

    if (out.length){
      var at = t.sh.getLastRow() + 1;
      t.sh.getRange(at, plan.key + 1, out.length, 1).setNumberFormat('@');   // keep leading zeros
      t.sh.getRange(at, 1, out.length, width).setValues(out);
      SpreadsheetApp.flush();
      RMX_NS.bumpGeneration();          // every cached lookup/data key is now unreachable
    }
    return { ok: true, added: out.length, skipped: skipped.length, skippedValues: skipped };

  } finally {
    try { lock.releaseLock(); }
    catch (e) { APP_log('warn', 'RMXSUGGEST.applyRows', 'the lock was not released — the next writer will wait it out',
                        { error: String(e) }); }
  }
}

return { getSuggestions: getSuggestions, applyRows: applyRows, getUrls: getUrls };

})();

/* ---- top-level wrappers for google.script.run ---- */
function getRmxSuggestions(opts){ return RMXSUGGEST.getSuggestions(opts); }
function applyRmxLookupRows(p){   return RMXSUGGEST.applyRows(p); }
function getRmxLookupUrls(){      return RMXSUGGEST.getUrls(); }

/* ---- RFSC_Backend.gs ---------------------------------------------------------
   RMX Fuel Recovery — the same screen as §6's fuel page on different numbers,
   which is why the two share 21 of their 21 element ids in app.html.  */

/*****************************************************************************
 * AMRIZE RMX FUEL RECOVERY - backend
 * ---------------------------------------------------------------------------
 * The Ready-Mix twin of FSC_Backend.gs. Same page, same four views, same
 * editable-cell model - Ready-Mix numbers instead of Aggregates.
 *
 * SOURCES: the Ready-Mix sheet's "Main Raw Data" and "Extra Raw Data" tabs.
 *
 *   Main Raw Data  - total volume and net sales, the denominators.
 *     Bill Month                     - carries the YEAR as well as the month
 *                                      ("Feb-25"), which decides which pair of
 *                                      year columns a row uses.
 *     "#### Vol"                     - one column per year
 *     "#### Net Sales Ex VA (CAD)"   - one column per year
 *     Major Project Segment          - the one product dimension this page can
 *                                      filter on (see FILTERS below)
 *
 *   Extra Raw Data - the surcharge itself: dollars AND applied m3.
 *     mat_prod_hier_3 matching /fuel surcharge/i
 *     "Total Revenue - ####"         - one column per year
 *     "M3 Applied To - ####"         - one column per year
 *
 * WHY BOTH THE DOLLARS AND THE m3 COME OFF EXTRA RAW DATA
 *   Main Raw Data's CY / PY Fuel Surcharge columns are not a per-row charge.
 *   They are a sheet formula that takes the plant-month's surcharge out of
 *   Extra Raw Data and SPREADS it across every Main Raw Data row sharing the
 *   same LOOKUP KEY, pro rata by volume. Two things follow:
 *
 *   1. APPLIED m3 CANNOT BE INFERRED FROM IT. Every row of a charged
 *      plant-month comes back non-zero at one single $/m3 - verified across all
 *      568 plant-months in the July book, none of which carries more than one
 *      distinct rate. "This row's surcharge is not zero" only ever meant "this
 *      row's plant-month was charged".
 *
 *   2. THE SPREAD IS ONLY TRUE AT PLANT-MONTH TOTALS. Split it any finer and it
 *      reports the segment's share of VOLUME, not its share of the CHARGE. In
 *      July 2026 that is COD +25%, Specialty +35%, ICI -12% against the actual
 *      figures, with the total tying exactly. Any filtered view built on the
 *      spread would be wrong in a way the totals never reveal.
 *
 *   Extra Raw Data carries Qlik's own revenue and "M3 Applied To" on the
 *   surcharge lines. Both are read rather than inferred, from the same rows, at
 *   the same grain - so numerator and denominator agree at every level and
 *   nothing here depends on LOOKUP KEY.
 *
 * FACT GRAIN: plant x Major Project Segment x year x month. Nothing is capped
 *   or adjusted, so a filtered total is a plain sum over surviving facts and can
 *   never differ from the same cells inside a wider selection.
 *
 * COVERAGE - WHY IT NEEDS A GROSS DENOMINATOR
 *   Applied m3 sometimes lands above a cell's volume, and the reason is credits.
 *   "#### Vol" is NET: a reversal posts as a negative row and takes m3 back out.
 *   Qlik's "M3 Applied To" is measured on what SHIPPED, and a credit does not
 *   post a matching negative against it. Tested on every cell in the July book,
 *   at both plant x segment x month and plant x month:
 *       applied > NET volume        ->  19 cells / 2,127 m3   (28 / 3,508 at plant)
 *       applied > POSITIVE-only vol ->   0 cells /     0 m3   ( 0 /     0 at plant)
 *   Not one exception at either grain, and every one of the 19 has a credit row
 *   in it. So applied m3 is a strict subset of DELIVERED volume, and coverage is
 *       applied m3 / gross (positive-row) m3
 *   which cannot exceed 100% by construction. Nothing is capped: the earlier cap
 *   was fixing a denominator, and the right denominator needs no cap.
 *
 *   Total m3 stays NET everywhere else, so this page ties to the rest of the
 *   suite; gross is carried alongside it purely as the coverage denominator.
 *
 * SUMMING MATERIAL CODES IS SAFE. 202 cells carry more than one surcharge code -
 * usually a rate change mid-month (Winnipeg 908176 + 914144) or two FLEX FUEL
 * tiers on one plant. In not one of them does the sum exceed delivered volume
 * while the largest single code does not, i.e. the codes partition the load
 * rather than overlapping on it.
 *
 * FILTERS (opts.plants / opts.segments, and RFSC.getFacts for the Overview)
 *   FOLLOWS a selection on Plant, Market, Submarket - all of which resolve to a
 *   set of plants - and on Major Project Segment.
 *   CANNOT FOLLOW Strength Class, Product Class or Mix. Those come off PRODUCT
 *   MASTER via Product Mix, and Extra Raw Data has no mix column; the surcharge
 *   is charged per load, not per mix. A caller that narrows on one of those must
 *   drop the applied basis rather than show a number that ignored the filter.
 *
 * MARKET and SUBMARKET come from PLANT LOOKUP, keyed on Plant, so this page
 * buckets a plant exactly the way RMX - Price & Volume does.
 *
 * FALLBACK: with no Extra Raw Data (an upload that only sent Main, or a year
 * missing from the tab) the old Main-Raw-Data surcharge columns still run for
 * the affected years and say so in the payload, rather than reporting zero.
 *
 * NO HARD-CODED YEARS. The Aggregates backend names its fields 26/25; those
 * names are kept here so the page is a straight clone, but they mean CY and PY
 * and the actual years travel in cyYear / pyYear. A year roll needs no edit.
 *****************************************************************************/
var RFSC = (function () {

  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  /* The order the exec slide reads in. Anything not listed sorts alphabetically
     after these, so a new market appears rather than disappearing. */
  var EXEC_ORDER = ['Innocon','HNS SW','North','Manitoba','Saskatchewan'];
  /* PLANT LOOKUP writes HNS_SW / MANITOBA; the rest of the suite says HNS SW /
     Manitoba. One map, so this page speaks the same market names as the others. */
  var MKT_LABEL = { 'hns_sw':'HNS SW', 'hns sw':'HNS SW', 'innocon':'Innocon',
                    'north':'North', 'manitoba':'Manitoba', 'saskatchewan':'Saskatchewan' };
  /* Which Extra Raw Data lines are the fuel surcharge. mat_prod_hier_3 is the
     grouping SAP already maintains for exactly this - "9 : Fuel Surcharge"
     covers FUEL SURCHARGE/CARBURANT, every FLEX FUEL FEE and every TIER code in
     one predicate. mat_descr is deliberately NOT consulted: it is a list of
     material names that changes whenever a code is renamed, and matching on it
     would mean chasing renames forever to keep a total correct. */
  var FSC_HIER = /fuel\s*surcharge/i;
  var UNSEG = '(no segment)';

  /* ---------- small parsing helpers ---------- */
  function norm_(s){ return String(s == null ? '' : s).replace(/\u00A0/g,' ').trim().toLowerCase().replace(/\s+/g,' '); }
  function toNum_(v){
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v).replace(/[$,%\s]/g,'').replace(/\(/g,'-').replace(/\)/g,'');
    var n = parseFloat(s); return isNaN(n) ? 0 : n;
  }
  function pick_(idx, names){
    for (var i = 0; i < names.length; i++){ var k = norm_(names[i]); if (k in idx) return idx[k]; }
    return -1;
  }
  function label_(m){
    var k = norm_(m);
    return MKT_LABEL[k] || String(m == null ? '' : m).trim();
  }
  function seg_(v){ var s = String(v == null ? '' : v).trim(); return s || UNSEG; }
  /* A list of allowed values -> a lookup set, or null for "no filter". An empty
     array is treated as no filter, so a caller that clears its chips gets
     everything back instead of an empty report. */
  function allow_(list){
    if (!list) return null;
    var arr = Array.isArray(list) ? list : [list];
    if (!arr.length) return null;
    var set = {}, n = 0;
    for (var i = 0; i < arr.length; i++){
      var k = norm_(arr[i]); if (!k) continue;
      set[k] = true; n++;
    }
    return n ? set : null;
  }

  /* Bill Month -> { y, m }. The tab stores it as TEXT ("FEB-25"), which is the
     path that matters; a Date is handled too because Sheets sometimes parses it.
     A two-digit day between 20 and 40 is Sheets having read "Feb-25" as the
     25th of February, so the day is the year.

     Only the first three letters are read, so "July-26" and "Jul-26" land on the
     same month. */
  /* The month cell: Bill Month "Apr-25" -> { y:2025, m:4 }. The year is on the
     cell, and it is the ONE year that row feeds — "Apr-25" carries the
     prior-year columns, "Apr-26" the current-year ones, and each month
     therefore arrives as TWO rows that the buckets below re-aggregate.

     A value with no year at all is not readable here and returns null; the
     caller skips the row and the "no usable rows" error below is what surfaces
     it, rather than a silently half-empty report. */
  function monthNum_(name){
    var k = String(name || '').slice(0,3).toLowerCase();
    for (var i = 0; i < 12; i++) if (MONTHS[i].toLowerCase() === k) return i + 1;
    return 0;
  }
  function billYm_(v){
    if (v instanceof Date && !isNaN(v)){
      var d = v.getDate();
      return { y: (d >= 20 && d <= 40) ? 2000 + d : v.getFullYear(), m: v.getMonth() + 1 };
    }
    var s = String(v == null ? '' : v).trim();

    var mt = s.match(/^([A-Za-z]{3,})[\s\-\/.]*(\d{2,4})$/);
    if (!mt) return null;
    var mo = monthNum_(mt[1]);
    if (!mo) return null;
    var yr = parseInt(mt[2], 10);
    if (yr < 100) yr += 2000;
    return { y: yr, m: mo };
  }

  function findTab_(ss, names){
    var sheets = ss.getSheets(), i, j;
    for (i = 0; i < sheets.length; i++){
      var n = norm_(sheets[i].getName());
      for (j = 0; j < names.length; j++) if (n === norm_(names[j])) return sheets[i];
    }
    return null;
  }
  /* The header is not always the first row - Main Raw Data carries a totals
     strip above it and Extra Raw Data carries a warning note - so it is found
     by content, exactly as the AGG reader does. */
  /* Accepted names for the month column. The sheet's header is "Bill Month";
     the QlikView export spells it "bill_month", and norm_ leaves underscores
     alone, so that spelling has to be listed in its own right. */
  var MONTH_NAMES_ = ['bill month','billmonth','bill_month'];

  /* `must` names every column the row needs; `oneOf` is a set where ANY one
     will do (the month column, which has more than one spelling). */
  function headerRow_(grid, must, oneOf){
    for (var r = 0; r < Math.min(grid.length, 10); r++){
      var row = (grid[r] || []).map(norm_), ok = true;
      for (var i = 0; i < must.length; i++) if (row.indexOf(norm_(must[i])) < 0){ ok = false; break; }
      if (ok && oneOf && oneOf.length){
        ok = false;
        for (var j = 0; j < oneOf.length; j++) if (row.indexOf(norm_(oneOf[j])) >= 0){ ok = true; break; }
      }
      if (ok) return r;
    }
    return 0;
  }

  /* ---------- column resolution, shared by the sheet and the upload ---------- */
  function mainCols_(header){
    var idx = {};
    header.forEach(function(h,i){ var k = norm_(h); if (k && !(k in idx)) idx[k] = i; });
    var c = {
      plant: pick_(idx, ['plant']),
      bill:  pick_(idx, MONTH_NAMES_),
      seg:   pick_(idx, ['major project segment','project segment','segment']),
      cyFsc: pick_(idx, ['cy fuel surcharge']),
      pyFsc: pick_(idx, ['py fuel surcharge']),
      vol:   {},                     // year -> column
      ns:    {}                      // year -> column
    };
    header.forEach(function(h,i){
      var s = norm_(h), m;
      if ((m = /^(\d{4})\s+vol$/.exec(s)))                          c.vol[Number(m[1])] = i;
      else if ((m = /^(\d{4})\s+net sales ex va( \(cad\))?$/.exec(s))) c.ns[Number(m[1])] = i;
    });
    var miss = [];
    if (c.plant < 0) miss.push('Plant');
    if (c.bill  < 0) miss.push('Bill Month');
    if (!Object.keys(c.vol).length) miss.push('"#### Vol"');
    if (miss.length) throw new Error('The Main Raw Data tab is missing these column(s): '
      + miss.join(', ') + '. Check the header row spelling.');
    return c;
  }

  /* Extra Raw Data. mat_prod_hier_3 is REQUIRED - it is the only thing that says
     a line is the fuel surcharge, and there is no honest fallback for it. */
  function extraCols_(header){
    var idx = {};
    header.forEach(function(h,i){ var k = norm_(h); if (k && !(k in idx)) idx[k] = i; });
    var c = {
      plant: pick_(idx, ['plant']),
      bill:  pick_(idx, MONTH_NAMES_),
      hier3: pick_(idx, ['mat_prod_hier_3','mat prod hier 3']),
      seg:   pick_(idx, ['major project segment','project segment','segment']),
      m3:    {},                     // year -> column
      rev:   {}                      // year -> column
    };
    header.forEach(function(h,i){
      var s = norm_(h), m;
      if ((m = /^m3 applied to\s*-?\s*(\d{4})$/.exec(s)))   c.m3[Number(m[1])]  = i;
      else if ((m = /^total revenue\s*-?\s*(\d{4})$/.exec(s))) c.rev[Number(m[1])] = i;
    });
    var miss = [];
    if (c.plant < 0) miss.push('Plant');
    if (c.bill  < 0) miss.push('Bill Month');
    if (c.hier3 < 0) miss.push('mat_prod_hier_3');
    if (!Object.keys(c.m3).length)  miss.push('"M3 Applied To - ####"');
    if (!Object.keys(c.rev).length) miss.push('"Total Revenue - ####"');
    if (miss.length) throw new Error('The Extra Raw Data tab is missing these column(s): '
      + miss.join(', ') + '. That tab is where the fuel surcharge and its applied m\u00b3 come '
      + 'from; check the header row spelling.');
    return c;
  }

  /* ---------- plant -> market / submarket, from PLANT LOOKUP ----------
     Submarket comes back too, so a caller filtering on submarket can turn that
     into a plant set without opening the workbook a second time. */
  function plantDims_(ss){
    var sh = findTab_(ss, [APP_CONFIG.PAGES.rmx.SHEETS.PLANT, 'plant lookup']);
    if (!sh) throw new Error('The Ready-Mix sheet is missing a "PLANT LOOKUP" tab, '
      + 'which is where each plant\u2019s market comes from.');
    var v = sh.getDataRange().getValues();
    if (v.length < 2) return {};
    var hdr = headerRow_(v, ['plant']);
    var idx = {};
    (v[hdr] || []).forEach(function(x,i){ var k = norm_(x); if (k && !(k in idx)) idx[k] = i; });
    var cKey = pick_(idx, ['plant']), cMkt = pick_(idx, ['market']),
        cSub = pick_(idx, ['submarket','sub market']);
    if (cKey < 0 || cMkt < 0) return {};
    var map = {};
    for (var r = hdr + 1; r < v.length; r++){
      var k = norm_(v[r][cKey]); if (!k) continue;
      var m = String(v[r][cMkt] == null ? '' : v[r][cMkt]).trim();
      if (m && !(k in map)) map[k] = {                      // first match wins, VLOOKUP parity
        market:    label_(m),
        submarket: cSub < 0 ? '' : String(v[r][cSub] == null ? '' : v[r][cSub]).trim(),
        plant:     String(v[r][cKey] == null ? '' : v[r][cKey]).trim()
      };
    }
    return map;
  }

  /* ---------- the surcharge, read off Extra Raw Data ----------
     Returns { fact: { 'plant|segment|yyyy|m' -> {m3, fsc} }, years, lines }.

     Every fuel-surcharge line on a plant-month-segment is summed. The charge is
     not one material - FUEL SURCHARGE/CARBURANT, FLEX FUEL FEE 1-8 per market
     and FUEL SURCHARGE TIER 1-7 are 28 codes between them in the July book, and
     131 plant-months carry two or three at once - but they all sit under the one
     mat_prod_hier_3, which is what this matches on.

     `years` is what lets a partial tab degrade honestly: a year with no lines at
     all falls back to Main Raw Data instead of reporting zero. */
  function surchargeFromExtra_(grid, dispGrid){
    if (!grid || grid.length < 2) return null;
    var disp = dispGrid || grid;
    var hdr = headerRow_(grid, ['plant'], MONTH_NAMES_);
    var c   = extraCols_(grid[hdr] || []);

    var fact = {}, years = {}, lines = 0;
    for (var i = hdr + 1; i < grid.length; i++){
      var row = grid[i], drow = disp[i] || row;
      if (!FSC_HIER.test(String(row[c.hier3] || ''))) continue;

      var pk = norm_(row[c.plant]); if (!pk) continue;
      /* the displayed Bill Month, so "JUL-26" stays text rather than becoming
         whatever day Sheets guessed */
      var bm = billYm_(drow[c.bill] != null && drow[c.bill] !== '' ? drow[c.bill] : row[c.bill]);
      if (!bm) continue;

      /* Bill Month names the one year this row feeds. */
      var yr = bm.y;
      var mc = c.m3[yr], rc = c.rev[yr];
      if (mc == null && rc == null) continue;      // no columns for that year
      years[yr] = true; lines++;

      var m3  = (mc == null) ? 0 : toNum_(row[mc]);
      var fsc = (rc == null) ? 0 : toNum_(row[rc]);
      if (!m3 && !fsc) continue;                   // a $0 line still proved the year is covered

      var key = pk + '|' + norm_(seg_(row[c.seg])) + '|' + yr + '|' + bm.m;
      var f = fact[key] || (fact[key] = { m3:0, fsc:0 });
      f.m3 += m3; f.fsc += fsc;                    // sum every surcharge code on the cell
    }
    return lines ? { fact: fact, years: years, lines: lines } : null;
  }

  /* ---------- the one place rows become buckets ----------
     grid    - Main Raw Data
     dims    - plant key -> { market, submarket }
     charge  - surchargeFromExtra_ output, or null
     filter  - { plants:[], segments:[] }, either side optional */
  function buildCells_(grid, dims, unknownLabel, charge, filter){
    var hdr = headerRow_(grid, ['plant'], MONTH_NAMES_);
    var c = mainCols_(grid[hdr] || []);

    var okPlant = allow_(filter && filter.plants);
    var okSeg   = allow_(filter && filter.segments);

    /* The newest year is CY, and the surcharge column follows from that. Bill
       Month carries the year on the row, so it is read from the rows; the
       "#### Vol" column headers are only a fallback for a tab whose month
       cells are all unreadable, which the "no usable rows" check below then
       reports rather than quietly halving the book. */
    var yMax = 0, i, bm, y;
    for (i = hdr + 1; i < grid.length; i++){
      bm = billYm_(grid[i][c.bill]);
      if (bm && bm.y > yMax) yMax = bm.y;
    }
    if (!yMax){
      for (y in c.vol) if (Number(y) > yMax) yMax = Number(y);
    }
    if (!yMax) throw new Error('No usable month values were found in Main Raw Data \u2014 '
      + 'Bill Month should read like "Jul-26".');

    /* PASS 1 - plant x segment x year x month, the grain the surcharge arrives
       at. `spread` is Main Raw Data's own surcharge column, kept only as the
       per-year fallback for when Extra Raw Data cannot cover a year. */
    var bucket = {}, order = [], markets = [], seen = {}, unknown = {}, used = 0, skipped = 0;
    for (i = hdr + 1; i < grid.length; i++){
      var row = grid[i];
      bm = billYm_(row[c.bill]); if (!bm) continue;
      var mo = bm.m;

      var pk = norm_(row[c.plant]); if (!pk) continue;
      var sg = seg_(c.seg < 0 ? '' : row[c.seg]), sk = norm_(sg);
      if ((okPlant && !okPlant[pk]) || (okSeg && !okSeg[sk])){ skipped++; continue; }

      var d  = dims[pk] || null;
      var mk = d ? d.market : '';
      var unk = '';
      if (!mk){ unk = String(row[c.plant]).trim(); mk = unknownLabel; }

      /* Bill Month names the one year this row feeds, so a plant x segment x
         month bucket is filled by the "-25" row and the "-26" row in turn —
         both land in `bucket` and are summed there before anything divides. */
      var yr  = bm.y;
      var vc  = c.vol[yr], nc = c.ns[yr];
      var vol = (vc == null) ? 0 : toNum_(row[vc]);
      var ns  = (nc == null) ? 0 : toNum_(row[nc]);
      var spr = (yr === yMax) ? (c.cyFsc < 0 ? 0 : toNum_(row[c.cyFsc]))
                              : (c.pyFsc < 0 ? 0 : toNum_(row[c.pyFsc]));
      if (!vol && !ns && !spr) continue;              // padding rows
      used++;

      if (!seen[mk]){ seen[mk] = true; markets.push(mk); }

      var bKey = pk + '|' + sk + '|' + yr + '|' + mo;
      var b = bucket[bKey];
      if (!b){ b = bucket[bKey] = { pk:pk, sk:sk, sg:sg, mk:mk, yr:yr, mo:mo,
                                    vol:0, gross:0, ns:0, spread:0, sprVol:0, sprNS:0 };
               order.push(bKey); }
      b.vol += vol; b.ns += ns; b.spread += spr;
      /* gross = delivered m3, credits excluded. The coverage denominator, and
         the only place a negative row is deliberately ignored. */
      if (vol > 0) b.gross += vol;
      if (spr !== 0){ b.sprVol += vol; b.sprNS += ns; }   // the old rule, fallback only

      if (unk){
        var u = unknown[unk] || (unknown[unk] = { vol:0, ns:0, fsc:0 });
        u.vol += vol; u.ns += ns; u.fsc += spr;
      }
    }
    if (!used) throw new Error('No usable rows were found in Main Raw Data \u2014 every row needs a '
      + 'month and a volume, net sales or surcharge figure.'
      + (skipped ? ' (' + skipped + ' rows were excluded by the current filter.)' : ''));

    /* PASS 2 - resolve the surcharge for each bucket, then fold to market.
       The clamp runs HERE, at fact grain, so a filtered total is a plain sum of
       the same numbers a wider selection would have used. */
    var cells = {}, facts = [], overGross = 0, overGrossM3 = 0, fellBack = {}, k;
    for (var oi = 0; oi < order.length; oi++){
      var f = bucket[order[oi]];
      var avol, fsc, fromExtra = false;

      if (charge && charge.years[f.yr]){
        var hit = charge.fact[f.pk + '|' + f.sk + '|' + f.yr + '|' + f.mo];
        avol = hit ? hit.m3  : 0;
        fsc  = hit ? hit.fsc : 0;
        fromExtra = true;
        /* Read as measured. Applied m3 above NET volume is a credit, not an
           error - see the header. Anything above GROSS would be, so it is
           counted and surfaced rather than adjusted away; it is currently zero
           across the whole book. */
        if (avol > f.gross + 0.5){ overGross++; overGrossM3 += (avol - f.gross); }
      } else {
        avol = f.sprVol;                        // no Extra cover for this year
        fsc  = f.spread;
        if (charge) fellBack[f.yr] = true;
      }

      /* Extra Raw Data carries no net sales, so the applied share of net sales
         is prorated off the applied share of volume - the same thing the
         Aggregates Saskatchewan path does with its increase sheet. */
      var ans = fromExtra ? (f.vol ? f.ns * (avol / f.vol) : 0) : f.sprNS;

      var key = f.mk + '|' + f.yr + '|' + f.mo;
      var t = cells[key] || (cells[key] = { vol:0, gross:0, ns:0, fsc:0, avol:0, ans:0, afsc:0 });
      t.vol += f.vol; t.gross += f.gross; t.ns += f.ns; t.fsc += fsc;
      t.avol += avol; t.ans += ans;
      /* the recovery DOLLARS are the same money on both bases - afsc is carried
         for callers that want it, never used to divide */
      t.afsc += fsc;

      var dm = dims[f.pk] || null;
      facts.push({ plant:     dm ? dm.plant : f.pk,
                   market:    f.mk,
                   submarket: dm ? dm.submarket : '',
                   segment:   f.sg,
                   year: f.yr, month: f.mo,
                   vol: f.vol, gross: f.gross, ns: f.ns, appliedVol: avol, fsc: fsc });
    }

    /* DROP ANYTHING THAT NETS TO NOTHING.
       A row is kept above whenever it carries a figure, which is right - but a
       reversal pair (a posting and its back-out in the next month) carries two
       and adds up to zero. That used to raise a whole market of zeroes on the
       slide, and a plant with no lookup row alongside it, over a correction that
       changed no number anywhere. A market that contributes nothing is not shown
       at all, and an unmapped plant is only worth naming if its own figures net
       to something. */
    var ZERO = 1e-9, dead = {};
    markets = markets.filter(function(m){
      var live = ovNet_(cells, m, ZERO);
      if (!live) dead[m] = true;
      return live;
    });
    for (k in cells) if (dead[k.substring(0, k.indexOf('|'))]) delete cells[k];
    facts = facts.filter(function(r){ return !dead[r.market]; });

    /* THE REPORT MONTH — LAST CALENDAR MONTH.
       The running month is only part-billed, so reporting it would put a few
       days of this month against a full month a year ago. The export carries
       every month of the PRIOR year ("Jan-25" through "Dec-25"), so this has
       to be stated rather than read off the data.

       Re-read from what SURVIVED the netting above, so a dropped market can
       never be the thing that decides which month MTD means. And if last month
       has not been exported yet, the latest month that does carry current-year
       volume stands in for it rather than showing an empty month. */
    var prevCal = (new Date()).getMonth() || 12;      // 0-based month = last month
    var latest = 0, hasPrev = false;
    for (k in cells){
      var parts = k.split('|');
      if (Number(parts[1]) !== yMax) continue;        // current year only
      if (cells[k].vol === 0) continue;
      var mn = Number(parts[2]);
      if (mn === prevCal) hasPrev = true;
      if (mn > latest) latest = mn;
    }
    latest = hasPrev ? prevCal : (latest || prevCal);

    /* The months the picker can offer: current-year months that carry volume.
       Months past the reporting point hold last year's figures against nothing
       at all, so offering one would only ever read -100%. */
    var cyMonths = {};
    for (k in cells){
      var pr = k.split('|');
      if (Number(pr[1]) !== yMax) continue;
      if (cells[k].vol === 0) continue;
      cyMonths[Number(pr[2])] = 1;
    }
    var monthList = Object.keys(cyMonths).map(Number).sort(function(a,b){ return a-b; });

    var unkList = Object.keys(unknown).filter(function(n){
      var u = unknown[n];
      return (Math.abs(u.vol) > ZERO || Math.abs(u.ns) > ZERO || Math.abs(u.fsc) > ZERO);
    }).sort();

    return { cells: cells, facts: facts, markets: markets, latest: latest || 1,
             monthList: monthList,
             cy: yMax, py: yMax - 1,
             unknownPlants: unkList, rows: used, rowsFiltered: skipped,
             filtered: !!(okPlant || okSeg),
             chargeSource: charge ? 'extra' : 'spread',
             chargeLines:  charge ? charge.lines : 0,
             fallbackYears: Object.keys(fellBack).sort(),
             overGross: overGross, overGrossM3: overGrossM3 };
  }

  /* Does this market have a single figure left once its own months are netted?
     Netted, not summed as absolutes: a posting and its reversal cancel, which is
     exactly the case this exists to catch. */
  function ovNet_(cells, mk, eps){
    var v = 0, n = 0, f = 0, pre = mk + '|';
    for (var k in cells){
      if (k.indexOf(pre) !== 0) continue;
      v += cells[k].vol; n += cells[k].ns; f += cells[k].fsc;
    }
    return (Math.abs(v) > eps || Math.abs(n) > eps || Math.abs(f) > eps);
  }

  /* ---------- reading the live sheet ---------- */
  /* getDisplayValues keeps "JUL-26" as text - getValues would hand back a Date
     and the year would come from whatever day Sheets guessed. Extra Raw Data is
     read BOTH ways: displayed for the Bill Month, raw for the figures, so a cell
     format that rounds m3 to whole numbers cannot shave the applied volume. */
  function readData_(filter){
    var ss = APP_openSpreadsheet_('rmx');
    var sh = findTab_(ss, [APP_CONFIG.PAGES.rmx.SHEETS.MAIN, 'main raw data']);
    if (!sh) throw new Error('The Ready-Mix sheet is missing a tab called "Main Raw Data", '
      + 'which is where the Ready-Mix volume comes from.');
    var values = sh.getDataRange().getDisplayValues();
    if (values.length < 2) throw new Error('The "' + sh.getName() + '" tab has headers but no data rows yet.');
    return buildCells_(values, plantDims_(ss), 'Unmapped plants', readExtra_(ss), filter);
  }

  function readExtra_(ss){
    var sh = findTab_(ss, [APP_CONFIG.PAGES.rmx.SHEETS.EXTRA, 'extra raw data']);
    if (!sh) throw new Error('The Ready-Mix sheet is missing a tab called "Extra Raw Data", '
      + 'which is where the fuel surcharge and its applied m\u00b3 come from.');
    var rng = sh.getDataRange();
    if (rng.getNumRows() < 2) throw new Error('The "' + sh.getName() + '" tab has headers but no data rows yet.');
    return surchargeFromExtra_(rng.getValues(), rng.getDisplayValues());
  }

  /* ---------- reading an upload ----------
     The page may send Extra Raw Data alongside Main. If it does not, the live
     Ready-Mix workbook is asked for it, so an upload of just the Main tab still
     gets real applied m3 rather than falling back to the spread. */
  function readUpload_(grid, extraGrid, filter){
    if (!grid || grid.length < 2)
      throw new Error('That file looks empty \u2014 it needs a header row plus data rows.');
    var dims = {}, charge = null;
    try {
      var ss = APP_openSpreadsheet_('rmx');
      dims = plantDims_(ss);
      charge = extraGrid ? surchargeFromExtra_(extraGrid) : readExtra_(ss);
    } catch (e){
      if (extraGrid){ try { charge = surchargeFromExtra_(extraGrid); } catch (e2){ charge = null; } }
    }
    return buildCells_(grid, dims, 'All plants', charge, filter);
  }

  /* ---------- sums ---------- */
  function sum_(D, mk, yr, months){
    var t = { vol:0, gross:0, ns:0, fsc:0, avol:0, ans:0, afsc:0, wVol:0, wNS:0 };
    months.forEach(function(mo){
      var b = D.cells[mk + '|' + yr + '|' + mo]; if (!b) return;
      t.vol += b.vol; t.gross += b.gross; t.ns += b.ns; t.fsc += b.fsc;
      t.avol += b.avol; t.ans += b.ans; t.afsc += b.afsc;
      /* coverage weighs on GROSS, and only over months that had a surcharge at
         all - a month with none is not 0% coverage, it is out of scope */
      if (b.avol > 0){ t.wVol += b.gross; t.wNS += b.ns; }
    });
    return t;
  }

  /* ---------- Summary view (MTD / YTD, applied basis) ---------- */
  function summaryFor_(D, months){
    var rows = D.markets.map(function(mk){
      var c = sum_(D, mk, D.cy, months), p = sum_(D, mk, D.py, months);
      var fCy = c.avol ? c.fsc / c.avol : 0;
      var fPy = p.avol ? p.fsc / p.avol : 0;
      return { market: mk, totalVol: c.vol, grossVol: c.gross, totalFSC: c.fsc, appliedVol: c.avol,
               pctVolApplied: c.wVol ? c.avol / c.wVol : 0,
               appliedNS: c.ans, pctNSApplied: c.wNS ? c.ans / c.wNS : 0,
               fscT2026: fCy, fscT2025: fPy, yoy: fCy - fPy,
               /* raw parts, so the page's TOTAL row re-derives instead of
                  averaging ratios */
               wVol: c.wVol, wNS: c.wNS, av25: p.avol, fsc25c: p.fsc };
    });
    var t = { totalVol:0, grossVol:0, totalFSC:0, appliedVol:0, appliedNS:0, wv:0, wn:0, avPy:0, fscPy:0 };
    D.markets.forEach(function(mk){
      var c = sum_(D, mk, D.cy, months), p = sum_(D, mk, D.py, months);
      t.totalVol += c.vol; t.grossVol += c.gross; t.totalFSC += c.fsc;
      t.appliedVol += c.avol; t.appliedNS += c.ans;
      t.wv += c.wVol; t.wn += c.wNS; t.avPy += p.avol; t.fscPy += p.fsc;
    });
    var tfCy = t.appliedVol ? t.totalFSC / t.appliedVol : 0;
    var tfPy = t.avPy ? t.fscPy / t.avPy : 0;
    rows.push({ market:'TOTAL', isTotal:true, totalVol:t.totalVol, grossVol:t.grossVol, totalFSC:t.totalFSC,
                appliedVol:t.appliedVol, pctVolApplied: t.wv ? t.appliedVol / t.wv : 0,
                appliedNS:t.appliedNS, pctNSApplied: t.wn ? t.appliedNS / t.wn : 0,
                fscT2026: tfCy, fscT2025: tfPy, yoy: tfCy - tfPy });
    return rows;
  }

  /* ---------- By-month view (applied basis) ---------- */
  function byMonthFor_(D, mk, months){
    function line(mo){
      var c = D.cells[mk + '|' + D.cy + '|' + mo] || { fsc:0, avol:0 };
      var p = D.cells[mk + '|' + D.py + '|' + mo] || { fsc:0, avol:0 };
      var tCy = c.avol ? c.fsc / c.avol : 0, tPy = p.avol ? p.fsc / p.avol : 0;
      return { month: MONTHS[mo-1], fscT25:tPy, fsc25:p.fsc, vol25:p.avol,
               fscT26:tCy, fsc26:c.fsc, vol26:c.avol, yoy: tCy - tPy };
    }
    var rows = months.map(line);
    var c = sum_(D, mk, D.cy, months), p = sum_(D, mk, D.py, months);
    var aCy = c.avol ? c.fsc / c.avol : 0, aPy = p.avol ? p.fsc / p.avol : 0;
    return { rows: rows, avg: { month:'YTD Avg', isAvg:true,
             fscT25:aPy, fsc25:p.fsc, vol25:p.avol,
             fscT26:aCy, fsc26:c.fsc, vol26:c.avol, yoy: aCy - aPy } };
  }

  /* ---------- Executive view (the slide's four tables) ---------- */
  function execOrder_(markets){
    return markets.slice().sort(function(a,b){
      var ia = EXEC_ORDER.indexOf(a), ib = EXEC_ORDER.indexOf(b);
      if (ia < 0 && ib < 0) return a.localeCompare(b);
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia - ib;
    });
  }
  function execTable_(D, months, basis){
    var applied = (basis === 'applied');
    var rows = execOrder_(D.markets).map(function(mk){
      var c = sum_(D, mk, D.cy, months), p = sum_(D, mk, D.py, months);
      var tCy = applied ? c.avol : c.vol, tPy = applied ? p.avol : p.vol;
      /* The recovery DOLLARS are the same money on both bases - only the m3
         change. Taking afsc as the numerator would drop every credit row and
         make applied recovery larger than all-m3 recovery. */
      var fCy = c.fsc, fPy = p.fsc;
      var pCy = tCy ? fCy / tCy : 0, pPy = tPy ? fPy / tPy : 0;
      return { market:mk, tonnes26:tCy, tonnes25:tPy, fsc26:fCy, fsc25:fPy,
               perT26:pCy, perT25:pPy, yoy: pCy - pPy, newBiz:(fPy === 0) };
    });
    var t = { market:'Grand Total', isTotal:true, tonnes26:0, tonnes25:0, fsc26:0, fsc25:0 };
    var fPyBase = 0;
    rows.forEach(function(r){
      t.tonnes26 += r.tonnes26; t.tonnes25 += r.tonnes25;
      t.fsc26 += r.fsc26; t.fsc25 += r.fsc25; fPyBase += r.fsc25;
    });
    t.perT26 = t.tonnes26 ? t.fsc26 / t.tonnes26 : 0;
    t.perT25 = t.tonnes25 ? t.fsc25 / t.tonnes25 : 0;
    t.newBiz = (fPyBase === 0);
    t.yoy = t.perT26 - t.perT25;
    rows.push(t);
    return rows;
  }

  /* ---------- the page payload ---------- */
  /* `sel` is the page's Report month picker: 1-12 pins the report to that
     month, 0 or absent uses the default worked out in buildCells_ (last
     calendar month). MTD is that month alone, YTD is January through it, and
     the by-month table stops there too - nothing past the report month counts
     towards anything. */
  function output_(D, sel){
    var rpt = Number(sel) || 0;
    if (rpt < 1 || rpt > 12) rpt = D.latest;

    var ytd = []; for (var m = 1; m <= rpt; m++) ytd.push(m);
    var mtd = [rpt];
    var byMonth = {};
    D.markets.forEach(function(mk){ byMonth[mk] = byMonthFor_(D, mk, ytd); });
    return {
      markets:     D.markets,
      latestMonth: MONTHS[rpt - 1],
      month:       rpt,                       // the month this payload is for
      defaultMonth: D.latest,                 // what "Last closed month" resolves to
      months:      D.monthList || [],         // what the picker may offer
      monthNames:  MONTHS,
      cyYear:      D.cy,
      pyYear:      D.py,
      unit:        'm\u00b3',
      summary: { MTD: summaryFor_(D, mtd), YTD: summaryFor_(D, ytd) },
      exec: {
        MTD: { all: execTable_(D, mtd, 'all'), applied: execTable_(D, mtd, 'applied') },
        YTD: { all: execTable_(D, ytd, 'all'), applied: execTable_(D, ytd, 'applied') }
      },
      byMonth: byMonth,
      source: (D.chargeSource === 'extra') ? 'Main Raw Data + Extra Raw Data' : 'Main Raw Data',
      /* plants with no PLANT LOOKUP row: their m3 and dollars stay in the
         totals, under "Unmapped plants", instead of vanishing */
      unknownPlants: D.unknownPlants || [],
      rowsRead: D.rows || 0,
      /* where the surcharge came from, what the filter did and what had to be
         trimmed. The page can show these; nothing breaks if it ignores them. */
      fsc: {
        source:        D.chargeSource,              // 'extra' | 'spread'
        lines:         D.chargeLines || 0,
        fallbackYears: D.fallbackYears || [],
        overGross:     { cells: D.overGross || 0, m3: D.overGrossM3 || 0 },
        filtered:      !!D.filtered,
        rowsFiltered:  D.rowsFiltered || 0,
        note:          fscNote_(D)
      }
    };
  }

  /* One plain-English line about the applied basis, for the page footer. */
  function fscNote_(D){
    if (D.chargeSource !== 'extra')
      return 'Extra Raw Data could not be read, so the surcharge falls back to Main Raw Data\u2019s '
           + 'CY / PY Fuel Surcharge columns. Those are a pro-rata spread of the plant-month\u2019s '
           + 'charge, so applied m\u00b3 reads close to total m\u00b3 and any split finer than a '
           + 'plant-month is indicative only.';
    var bits = ['Fuel surcharge dollars and applied m\u00b3 both come from the Extra Raw Data lines '
              + 'under mat_prod_hier_3 \u201cFuel Surcharge\u201d, at plant \u00d7 segment \u00d7 month. '
              + 'Coverage is applied m\u00b3 over DELIVERED m\u00b3: total m\u00b3 is net of credits, '
              + 'and a credit takes m\u00b3 back out without reversing the surcharge it already carried.'];
    if (D.overGross)
      bits.push('Warning: ' + D.overGross + ' cell' + (D.overGross === 1 ? '' : 's')
              + ' report more applied m\u00b3 than they delivered, by '
              + Math.round(D.overGrossM3).toLocaleString()
              + ' m\u00b3 in total. That should not happen and is worth raising with the Qlik export.');
    if ((D.fallbackYears || []).length)
      bits.push('Extra Raw Data has no fuel-surcharge lines for ' + D.fallbackYears.join(', ')
              + ', so those years fall back to Main Raw Data.');
    if (D.filtered)
      bits.push('Filtered view: ' + Number(D.rowsFiltered || 0).toLocaleString()
              + ' Main Raw Data rows excluded.');
    return bits.join(' ');
  }

  /* ---------- fact table, for the Executive Overview ----------
     COLUMNAR, not a list of objects. 2,657 facts as {plant, market, submarket,
     segment, ...} came to 483 KB - close enough to the 900 KB ceiling that a
     year roll or a wider window would push a cached copy over it, and
     cachePut_ fails SILENTLY above that line. Dimension tables plus numeric
     rows cut it to a fraction and cost the client one index lookup.

       plants   [ [name, market, submarket], ... ]      row index = plant id
       segments [ 'ICI', 'Civil', ... ]                 row index = segment id
       rows     [ [plantId, segId, year, month,
                   netM3, grossM3, netSales, appliedM3, fsc], ... ]

     Sliced on the client, the way the RMX cross-filter already slices PPI
     weights: Submarket / Market / Plant chips resolve to a plant id set and
     Project Segment straight to a segment id, then it is a sum. Nothing was
     capped or prorated at this grain, so every subset adds to exactly what it
     contributes to the whole.

     Strength Class, Product Class and Mix are NOT here and cannot be: they come
     off PRODUCT MASTER via Product Mix, which Extra Raw Data does not carry -
     the surcharge is charged per load, not per mix. `dimensions` says so, so the
     client does not have to hard-code the rule. */
  function facts_(D){
    var pIdx = {}, plants = [], sIdx = {}, segments = [], rows = [];
    D.facts.forEach(function(f){
      var pk = f.plant + '\u0000' + f.market;
      if (!(pk in pIdx)){ pIdx[pk] = plants.length; plants.push([f.plant, f.market, f.submarket]); }
      if (!(f.segment in sIdx)){ sIdx[f.segment] = segments.length; segments.push(f.segment); }
      rows.push([ pIdx[pk], sIdx[f.segment], f.year, f.month,
                  r2_(f.vol), r2_(f.gross), r2_(f.ns), r2_(f.appliedVol), r2_(f.fsc) ]);
    });
    return {
      cols:        ['plantId','segmentId','year','month','m3','grossM3','netSales','appliedM3','fsc'],
      plantCols:   ['plant','market','submarket'],
      plants:      plants,
      segments:    segments,
      rows:        rows,
      markets:     D.markets,
      cyYear:      D.cy,
      pyYear:      D.py,
      latestMonth: D.latest,
      unit:        'm\u00b3',
      dimensions:  { supported:   ['market','submarket','plant','segment'],
                     unsupported: ['strength','productClass','mix'] },
      /* coverage = appliedM3 / grossM3. NEVER appliedM3 / m3: m3 is net of
         credits and a credit does not reverse the surcharge already charged on
         the load, so that ratio can read above 100% on a segment carrying a big
         reversal. Nothing here is capped - the gross denominator is the fix. */
      coverage:    { numerator:'appliedM3', denominator:'grossM3' },
      fsc: {
        source:        D.chargeSource,
        lines:         D.chargeLines || 0,
        fallbackYears: D.fallbackYears || [],
        overGross:     { cells: D.overGross || 0, m3: D.overGrossM3 || 0 },
        note:          fscNote_(D)
      }
    };
  }
  /* two decimals is well inside m3 and dollar precision, and drops the long
     floating-point tails that were a third of the payload */
  function r2_(n){ return Math.round(n * 100) / 100; }


  /* ---------- THE READ IS CACHED, LIKE EVERY OTHER BACKEND'S ----------
     readData_() did a full getDataRange().getValues() of the raw tab on EVERY
     call, and the entry point below had no result cache either. So this page
     re-read tens of thousands of rows out of Sheets on every open, every '↻
     Update from source', and once more for each of the deck's fuel slides.
     Nothing else in the suite does that: PV.getReport, RMX and the Overview all
     answer from a cached result first and only touch the sheet on a miss.

     Both layers are cached now, and both keys carry APP_getGen_ - the source
     workbook's modified time plus the code build stamp - so a sync or a code
     change strands them by itself and there is nothing to invalidate by hand.
     UPLOADS ARE NEVER CACHED: that is one user's session.
  ------------------------------------------------------------------- */
  function gkFsc_(key){
    var gen = '0';
    try { gen = APP_getGen_('rmx') || '0'; }
    catch (e) {
      /* '0' is not "no cache" — it is a key every generation shares, so an
         entry written under it outlives the data it describes. */
      APP_log('warn', 'APP.cacheKey', 'no data generation — every generation will share one cache key',
              { page: 'rmx', error: String(e) });
    }
    return 'rfsc|g' + gen + '|' + key;
  }
  /* The chunked cache helpers live in Code.gs. Every .gs file shares one global
     scope, so at request time they are there - but a missing helper must never be
     what takes this page down, so both are reached through a guard and a failure
     just means "not cached". */
  function cGet_(k){
    try { return (typeof APP_cacheGet_ === 'function') ? APP_cacheGet_(k) : null; }
    catch (e){ return null; }
  }
  function cPut_(k, v){
    try { if (typeof APP_cachePut_ === 'function') APP_cachePut_(k, v); } catch (e){}
  }
  function cachedRead_(filter){
    var ck = gkFsc_('data|' + JSON.stringify(filter || null));
    var hit = cGet_(ck);
    if (hit) return hit;
    var D = readData_(filter);
    cPut_(ck, D);
    return D;
  }

  return {
    getRmxFuel: function(opts){
      var filter = (opts && opts.filter) ? opts.filter : opts;
      var ck = gkFsc_('out|' + JSON.stringify(filter || null) + '|m' + ((opts && opts.month) || 0));
      var hit = cGet_(ck); if (hit) return hit;
      var out = output_(cachedRead_(filter), opts && opts.month);
      cPut_(ck, out);
      return out;
    },
    /* Unaggregated facts for the Overview. Takes the same optional filter, but
       the Overview will usually pull them unfiltered once and slice on the
       client, the way the RMX cross-filter already does. */
    getFacts:   function(opts){
      return facts_(cachedRead_(opts && opts.filter ? opts.filter : opts));
    },
    getRmxFuelUpload: function(p){
      var grid = p && (p.main || p.grid);
      if (!grid) throw new Error('Upload the Ready-Mix PPI export.');
      return output_(readUpload_(grid, p && p.extra, p && p.filter), p && p.month);
    }
  };
})();

/* Top-level wrappers the page calls via google.script.run.
   Logged so the Executions page always shows whether the call arrived. */
function getRmxFuelData(opts){
  try {
    console.log('[RFSC] getRmxFuelData: start');
    var out = RFSC.getRmxFuel(opts);
    console.log('[RFSC] getRmxFuelData: ok \u00b7 ' + out.markets.length + ' markets \u00b7 latest '
      + out.latestMonth + ' ' + out.cyYear
      + ' \u00b7 surcharge from ' + out.fsc.source + ' (' + out.fsc.lines + ' lines)');
    return out;
  } catch (err) {
    console.error('[RFSC] getRmxFuelData failed: ' + (err && err.message ? err.message : err));
    throw err;
  }
}
/* The Executive Overview's RMX fuel panel. */
function getRmxFscFacts(opts){
  try {
    console.log('[RFSC] getRmxFscFacts: start');
    var out = RFSC.getFacts(opts);
    console.log('[RFSC] getRmxFscFacts: ok \u00b7 ' + (out.rows ? out.rows.length : 0) + ' facts \u00b7 '
      + out.markets.length + ' markets \u00b7 surcharge from ' + out.fsc.source);
    return out;
  } catch (err) {
    console.error('[RFSC] getRmxFscFacts failed: ' + (err && err.message ? err.message : err));
    throw err;
  }
}
function getRmxFuelDataFromUpload(p){
  try {
    console.log('[RFSC] getRmxFuelDataFromUpload: start');
    var out = RFSC.getRmxFuelUpload(p);
    console.log('[RFSC] upload: ok \u00b7 ' + out.markets.length + ' markets \u00b7 latest ' + out.latestMonth
      + ' \u00b7 surcharge from ' + out.fsc.source);
    return out;
  } catch (err) {
    console.error('[RFSC] getRmxFuelDataFromUpload failed: ' + (err && err.message ? err.message : err));
    throw err;
  }
}



/* ============================================================================
 * §8  OVERVIEW
 * ----------------------------------------------------------------------------
 * The executive Overview and the month fact cube behind it. The largest single
 * region in this file and the only one that was already flat — 62 genuinely
 * top-level names, no IIFE.
 *
 * The cube reads the SAME cached bundle §7 already built, so it never opens the
 * Ready-Mix sheet itself and adds nothing to any page load.
 * ============================================================================ */

/* ---- Ov_Backend.gs -----------------------------------------------------------
   Verbatim, less CUBE_historyStatus — see the hit-list note in PLAN.md §11.  */

/*****************************************************************************
 * EXECUTIVE OVERVIEW — backend  (page id: 'overview')
 * ---------------------------------------------------------------------------
 * The Overview page is a READ-ONLY dashboard. It has NO Google Sheet of its
 * own: it reuses the numbers the other tools already compute, so it can never
 * drift from them. It calls into the existing namespaces:
 *     • PV.getReport(...)   — Aggregates, broken down by MARKET (all markets)
 *                             + the SAME revenue / ASP growth bridges the
 *                             Price & Volume report shows (all-markets and
 *                             one per mapped market)
 *     • RMX.getKeys(...)    — Ready-Mix, one market at a time
 *     • getSlideData()      — the Product Segment sheet (Ready-Mix), compacted
 *                             into per-market segment rows for the RMX tab
 * Everything is served from those tools' existing generation-token caches, so
 * opening the Overview never re-reads a spreadsheet on its own. Pressing
 * "Update from source" on the PV / RMX / Product Segment page is still the
 * only refresh path.
 *
 * IMPORTANT — the two business lines are shown SIDE BY SIDE and are NEVER
 * summed together. Aggregates are metric tonnes; Ready-Mix is m3. The
 * Product Segment data is Ready-Mix (m3), so it lives on the RMX tab only.
 *
 * The canonical market list + the PV/RMX name mapping live in Config.gs
 * (OVERVIEW.MARKETS) so renaming a market is a one-line edit there.
 *
 * PPI accuracy note:
 *   • RMX per-market rows expose rfiBase/facBase (the PPI numerator/
 *     denominator, indexed at Qlik's plant x mix grain), so ANY subset's PPI
 *     is EXACT (Σfac / Σrfi) on the client — a plant sits in one market only.
 *   • PV's public report exposes ppi per market but not its weight, so:
 *        – all markets  → exact (report total's PPI, returned as aggAll.ppi)
 *        – one market   → exact (that market's own PPI)
 *        – a 2+ subset  → CY-revenue-weighted blend of the markets' PPIs
 *   • The ASP-growth bridge (PPI → mix items → Total ASP%) needs row-level
 *     data, so it is served pre-computed by PV: one for all markets and one
 *     per mapped market. For a 2+ market subset the client shows a short
 *     "pick one market or all" note instead of an approximation.
 *****************************************************************************/

/* Client-callable entry point. opts = { period:'MTD'|'YTD' }.
 * Returns per-canonical-market PV + RMX blocks, PV growth bridges, and the
 * Product Segment breakdown; the client applies the market selection locally
 * so switching markets is instant (no server round-trip).                    */
function getOverview(opts){
  opts = opts || {};
  var period = (opts.period === 'YTD') ? 'YTD' : 'MTD';

  /* Server-side memo, keyed by ALL THREE source generations: pressing
     "Update from source" on the Price & Volume, RMX or Product Segment page
     bumps its generation, which makes this key unreachable — so the overview
     always reflects the base tables. Uses the shared chunked cache helpers
     from Code.gs. */
  var pvG = APP_getGen_('pricevolume'), rmxG = APP_getGen_('rmx'), sbG = APP_getGen_('segment');
  var gen = pvG + '-' + rmxG + '-' + sbG;
  var ck  = 'ov|g' + gen + '|' + period;
  var hit = APP_cacheGet_(ck);
  if (hit) return hit;

  var markets = (typeof OVERVIEW !== 'undefined' && OVERVIEW.MARKETS) ? OVERVIEW.MARKETS : [];
  var out = {
    ok: true,
    period: period,
    markets: markets.map(function(m){ return { key:m.key, label:m.label, pvName:m.pv, rmxName:m.rmx }; }),
    pv:  {},          // key -> { present, cyVol, pyVol, cyRev, pyRev, cyAsp, pyAsp, aspPct, volPct, ppi }
    rmx: {},          // key -> { present, cyVol, pyVol, baseCY, basePY, aspBaseCY, aspBasePY, aspIncBase, volPct, rfiBase, facBase, ppiBase }
    aggAll: null,     // exact all-markets Aggregates total (incl. PPI)
    bridges: { all: null, byKey: {} },   // PV growth bridges: {rev, asp} — asp = { ppi, items:[{label,value}…], totalAsp }
    seg: null,        // Product Segment (Ready-Mix): { ok, monthIdx, cyYear, markets:{key:[rows]}, unmatched:[] }
    prodCat: null,    // Product Category (Ready-Mix): { ok, markets:{key:[rows]}, missing:[keys] }
    errors: {},       // { pv:'…', rmx:'…', seg:'…' } when a source can't be read
    unmatched: { pv: [] }   // PV markets present in the sheet but not in OVERVIEW.MARKETS
  };

  /* ---------------- Aggregates (Price & Volume) ---------------- */
  try {
    var rep = PV.getReport({
      period: period,
      dimensions: ['MARKET'],
      filterField: 'MARKET',
      filterValue: '__ALL__'
    });
    var table = (rep.tables && rep.tables[0]) ? rep.tables[0] : { rows: [], total: {} };

    /* the SAME bridges the Price & Volume report draws (all markets) */
    out.bridges.all = { rev: rep.revenueBridge || null, asp: rep.priceBridge || null };

    var byLabel = {};
    (table.rows || []).forEach(function(r){ byLabel[ovNorm_(r.label)] = r; });

    var seen = {};
    markets.forEach(function(m){
      var r = byLabel[ovNorm_(m.pv)];
      if (r) {
        seen[ovNorm_(m.pv)] = true;
        // cyRev/pyRev are exact: ASP is defined as revenue / volume.
        var cyRev = (r.cyAsp || 0) * (r.cyVol || 0);
        var pyRev = (r.pyAsp || 0) * (r.pyVol || 0);
        out.pv[m.key] = {
          present: !!((r.cyVol || 0) || (r.pyVol || 0)),
          cyVol: r.cyVol || 0, pyVol: r.pyVol || 0,
          cyRev: cyRev, pyRev: pyRev,
          cyAsp: r.cyAsp || 0, pyAsp: r.pyAsp || 0,
          aspPct: r.aspPct || 0, volPct: r.volPct || 0,
          ppi: r.ppi || 0
        };
      } else {
        out.pv[m.key] = { present: false };
      }
    });

    // Any market the sheet has that our map doesn't — surface for a quick fix.
    (table.rows || []).forEach(function(r){
      if (!seen[ovNorm_(r.label)]) out.unmatched.pv.push(r.label);
    });

    var t = table.total || {};
    out.aggAll = {
      cyVol: t.cyVol || 0, pyVol: t.pyVol || 0,
      cyAsp: t.cyAsp || 0, pyAsp: t.pyAsp || 0,
      aspPct: t.aspPct || 0, volPct: t.volPct || 0,
      ppi: t.ppi || 0
    };

    /* per-market bridges — one filtered PV report per mapped market. These
       hit PV's own per-selection report cache (and the shared pivot cache),
       so after the first build they cost next to nothing. */
    markets.forEach(function(m){
      if (!out.pv[m.key] || !out.pv[m.key].present) return;
      try {
        var r1 = PV.getReport({
          period: period,
          dimensions: ['MARKET'],
          filterField: 'MARKET',
          filterValue: m.pv
        });
        out.bridges.byKey[m.key] = { rev: r1.revenueBridge || null, asp: r1.priceBridge || null };
      } catch (be) { /* a single market failing shouldn't blank the bridges */ }
    });
  } catch (e) {
    out.errors.pv = (e && e.message) ? e.message : String(e);
  }

  /* ---------------- Ready-Mix (RMX) ---------------- */
  try {
    markets.forEach(function(m){
      try {
        var k = RMX_NS.getKeys({ period: period, market: m.rmx });
        var s = { cyVol:0, pyVol:0, baseCY:0, basePY:0 };
        /* VOL and BASE revenue come from the KEY rows (exact). PPI does NOT —
           it is indexed at Qlik's plant x mix grain, which the key rows cannot
           represent, so the market total and each submarket read their
           weight/factor pair straight from the server's ppi map. Summing those
           pairs across markets stays exact because a plant belongs to exactly
           one market. */
        var ppi = k.ppi || {};
        function wfOf(x){ return { w: (x && x.w) || 0, f: (x && x.f) || 0 }; }
        function ppiOf(x){ return (x && x.w) ? x.f / x.w : 0; }

        /* RMX.getKeys already returns a ppi map for ALL FOUR breakdowns, and
           the key rows carry the matching dims. Only SUBMARKET used to be kept
           and the other three were discarded, so the Ready-Mix dimension
           tables cost nothing to build here: no second call, no second read.
           `sub` stays as an alias of the SUBMARKET rows so anything already
           reading it is untouched. */
        var RMX_DIMS = [
          { key:'SUBMARKET', pick:function(d){ return d && d.submarket; } },
          { key:'SEGMENT',   pick:function(d){ return d && d.segment;   } },
          { key:'STRENGTH',  pick:function(d){ return d && d.strength;  } },
          { key:'CLASS',     pick:function(d){ return d && d.cls;       } }
        ];
        var dMap = {}, dOrder = {};
        RMX_DIMS.forEach(function(D){ dMap[D.key] = {}; dOrder[D.key] = []; });
        (k.keys || []).forEach(function(r){
          s.cyVol   += r.cyVol   || 0;
          s.pyVol   += r.pyVol   || 0;
          s.baseCY  += r.baseCY  || 0;
          s.basePY  += r.basePY  || 0;
          RMX_DIMS.forEach(function(D){
            var lbl = String(D.pick(r.dims) || '(blank)').trim() || '(blank)';
            var g = dMap[D.key][lbl];
            if (!g){
              g = dMap[D.key][lbl] = { label:lbl, cyVol:0, pyVol:0, baseCY:0, basePY:0 };
              dOrder[D.key].push(lbl);
            }
            g.cyVol += r.cyVol || 0; g.pyVol += r.pyVol || 0;
            g.baseCY += r.baseCY || 0; g.basePY += r.basePY || 0;
          });
        });
        function dimRowsOf(key){
          var wfMap = ppi[key] || {};
          return dOrder[key].map(function(lbl){
            var g = dMap[key][lbl];
            var aCY = g.cyVol ? g.baseCY / g.cyVol : 0;
            var aPY = g.pyVol ? g.basePY / g.pyVol : 0;
            var wf  = wfOf(wfMap[lbl]);
            return {
              label: g.label, cyVol: g.cyVol, pyVol: g.pyVol,
              volPct: g.pyVol ? (g.cyVol - g.pyVol) / g.pyVol : 0,
              aspBaseCY: aCY, aspBasePY: aPY,
              aspIncBase: aPY ? (aCY - aPY) / aPY : 0,
              rfiBase: wf.w, facBase: wf.f,
              ppiBase: ppiOf(wf)
            };
          }).sort(function(a, b){ return b.cyVol - a.cyVol; });
        }
        var dims = {};
        RMX_DIMS.forEach(function(D){ dims[D.key] = dimRowsOf(D.key); });
        var subRows = dims.SUBMARKET;
        var tot   = wfOf(ppi.total);
        var aspCY = s.cyVol ? s.baseCY / s.cyVol : 0;
        var aspPY = s.pyVol ? s.basePY / s.pyVol : 0;
        out.rmx[m.key] = {
          present: !!(s.cyVol || s.pyVol),
          cyVol: s.cyVol, pyVol: s.pyVol,
          baseCY: s.baseCY, basePY: s.basePY,
          aspBaseCY: aspCY, aspBasePY: aspPY,
          aspIncBase: aspPY ? (aspCY - aspPY) / aspPY : 0,
          volPct: s.pyVol ? (s.cyVol - s.pyVol) / s.pyVol : 0,
          rfiBase: tot.w, facBase: tot.f,
          ppiBase: ppiOf(tot),
          sub: subRows,
          dims: dims
        };
      } catch (inner) {
        // A single market failing shouldn't blank the RMX column.
        out.rmx[m.key] = { present: false, error: (inner && inner.message) ? inner.message : String(inner) };
      }
    });
  } catch (e) {
    out.errors.rmx = (e && e.message) ? e.message : String(e);
  }

  /* ---------------- Product Segment (Ready-Mix) ----------------
     Reads the Segment tool's already-cached slide data and compacts the
     all-markets segment grid into a few rows per market. Same math as the
     Product Segment page: the period chooses the tab (QlikView splits MTD and
     YTD), and ASP is volume-weighted (rows carry cyRev/pyRev = Σ vol×ASP so
     the client can merge markets exactly). */
  try {
    var sd = getSlideData();            // version-cached in Code.gs
    /* MTD and YTD are separate tabs now — the export splits them, so the
       period picks the tab rather than filtering rows by month. */
    var segGrid = sd ? ((period === 'YTD') ? sd.segYTD : sd.segMTD) : null;
    out.seg = ovSegment_(segGrid, period, markets);
    out.prodCat = ovProdCat_(sd, period, markets);
  } catch (e) {
    out.errors.seg = (e && e.message) ? e.message : String(e);
  }

  out.generation = gen;                 // client uses this for its device cache
  APP_cachePut_(ck, out);
  return out;
}

/* ========================================================================
 * Product Segment compaction — a straight port of the Segment page's
 * segCols / segmentTable logic (display-value strings in, numbers out),
 * collapsed to { seg, cyVol, pyVol, cyRev, pyRev } per market.
 *
 * The grid handed in is ONE PERIOD's tab, already summed to Segment x Market
 * by QlikView with the current and prior year on the same row. There is no
 * Bill Month column any more, so there is nothing to filter by month: every
 * row on the tab belongs to the period. `period` is kept only for the label
 * the caller reports back.
 * ======================================================================== */
function ovSegment_(grid, period, markets){
  if (!grid || grid.length < 2) return { ok:false };

  var hdr = grid[0] || [];
  function colFind(re){ for (var i = 0; i < hdr.length; i++){ if (re.test(String(hdr[i] || ''))) return i; } return -1; }

  var cSeg = colFind(/segment/i); if (cSeg < 0) cSeg = 0;
  var cMkt = colFind(/market/i);

  /* year columns by their 4-digit year — larger year = CY (year-roll safe) */
  var years = {};
  hdr.forEach(function(h, i){
    var s = String(h || ''); var m = s.match(/\b(20\d{2})\b/); if (!m) return;
    var y = +m[1]; years[y] = years[y] || {};
    if (/vol/i.test(s)) years[y].vol = i;
    else if (/asp/i.test(s)) years[y].asp = i;
  });
  var ys = Object.keys(years).map(Number).sort(function(a, b){ return a - b; });
  var cyYear = ys.length ? ys[ys.length - 1] : null;
  var pyYear = ys.length > 1 ? ys[0] : null;
  var C = {
    cyVol: cyYear != null && years[cyYear].vol != null ? years[cyYear].vol : -1,
    cyAsp: cyYear != null && years[cyYear].asp != null ? years[cyYear].asp : -1,
    pyVol: pyYear != null && years[pyYear].vol != null ? years[pyYear].vol : -1,
    pyAsp: pyYear != null && years[pyYear].asp != null ? years[pyYear].asp : -1
  };
  if (C.cyVol < 0) return { ok:false };

  function num(v){
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).replace(/[$,\s]/g, '').replace(/[\u2013\u2014\u2212]/g, '-');
    if (s === '' || s === '-' || /^n\/?a$/i.test(s)) return null;
    var f = parseFloat(s);
    return isNaN(f) ? null : f;
  }
  function norm(s){ return String(s == null ? '' : s).trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }

  /* segment-sheet market name → canonical overview key (case-insensitive) */
  var keyOf = {};
  (markets || []).forEach(function(m){ keyOf[norm(m.rmx)] = m.key; });

  var byKey = {}, unmatched = {};
  grid.slice(1).forEach(function(r){
    var seg = String(r[cSeg] == null ? '' : r[cSeg]).trim(); if (!seg) return;   // skips the grand-total row
    var mktRaw = cMkt >= 0 ? String(r[cMkt] == null ? '' : r[cMkt]).trim() : '';
    var key = keyOf[norm(mktRaw)];
    if (!key){ if (mktRaw) unmatched[mktRaw] = true; return; }
    var mk = byKey[key] || (byKey[key] = {});
    var a = mk[seg] || (mk[seg] = { seg: seg, cyVol: 0, pyVol: 0, cyRev: 0, pyRev: 0 });
    var cv = num(r[C.cyVol]) || 0, pv = C.pyVol >= 0 ? (num(r[C.pyVol]) || 0) : 0;
    var ca = C.cyAsp >= 0 ? num(r[C.cyAsp]) : null, pa = C.pyAsp >= 0 ? num(r[C.pyAsp]) : null;
    a.cyVol += cv; a.pyVol += pv;
    if (ca != null) a.cyRev += cv * ca;
    if (pa != null) a.pyRev += pv * pa;
  });

  var mkts = {};
  Object.keys(byKey).forEach(function(k){
    mkts[k] = Object.keys(byKey[k]).map(function(s){ return byKey[k][s]; });
  });
  /* monthIdx is the month the tab is FOR - 1-12, via ovSegMonth_ below, which
     is the calendar's last closed month. The tab does not say so itself and
     never will: it has no month column. */
  var monthIdx = ovSegMonth_();
  if (cyYear == null) {
    try {
      var st = String(PropertiesService.getScriptProperties().getProperty('QLIK_REPORT_MONTH') || '');
      var mt = st.match(/^(\d{4})-(\d{1,2})$/);
      if (mt) cyYear = +mt[1];
    } catch (e) {
      APP_log('warn', 'OV.segNorm', 'could not read QLIK_REPORT_MONTH — the year on the ' +
              'segment columns will be missing', { error: String(e) });
    }
  }

  return { ok:true, monthIdx: monthIdx, cyYear: cyYear, markets: mkts, unmatched: Object.keys(unmatched) };
}

/* ========================================================================
 * Product Category compaction — from the per-market "Slide Product <Market>
 * MTD/YTD" tabs already inside getSlideData (numbers, not display strings).
 * A straight port of the Segment page's productTable column detection.
 * Rows carry vol-weighted revenue/CM2 sums (vol x ASP, vol x CM2) so an
 * All-markets merge on the client reproduces weighted ASP and CM2 exactly.
 * ======================================================================== */
/* The month both Segment-sourced panels are for: LAST CALENDAR MONTH, from the
   calendar rather than the data. The Slide tabs carry no month column - they
   arrive pre-split into MTD and YTD - so this is the only thing that can be
   said about them, and the Overview needs it to know whether showing them
   alongside its own selection would mislead. 1-12, or 0 if unreadable. */
function ovSegMonth_(){
  /* The calendar, not QLIK_REPORT_MONTH. That stamp is taken off the Ready-Mix
     export's Bill Month column, which runs through the whole of the PRIOR year
     ("Dec-25" against nothing this year), so the newest value in it is not
     evidence of the reporting month on its own — and reading it here while
     Code.gs reads the calendar would let this panel and the Product Segment
     page name two different months for the same tabs. One rule: last calendar
     month, 1-12. */
  var m = (new Date()).getMonth();               // 0-based this month = 1-12 last month
  return m ? m : 12;                             // in January, December
}

function ovProdCat_(sd, period, markets){
  var out = { ok:false, markets:{}, missing:[], monthIdx: ovSegMonth_() };
  if (!sd || !sd.prod) return out;
  function pnorm(x){ return String(x == null ? '' : x).trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }
  var prodKeys = Object.keys(sd.prod);
  (markets || []).forEach(function(m){
    var name = null;
    for (var i = 0; i < prodKeys.length; i++){
      if (pnorm(prodKeys[i]) === pnorm(m.rmx)){ name = prodKeys[i]; break; }
    }
    var entry = name ? sd.prod[name] : null;
    var grid  = entry ? entry[period] : null;
    if (!grid || grid.length < 2){ out.missing.push(m.key); return; }
    var rows = ovProdRows_(grid, name);
    if (rows.length){ out.markets[m.key] = rows; out.ok = true; }
    else out.missing.push(m.key);
  });
  return out;
}
function ovProdRows_(grid, marketName){
  var hdr = grid[0] || [];
  function colFind(re){ for (var i = 0; i < hdr.length; i++){ if (re.test(String(hdr[i] || ''))) return i; } return -1; }
  function colsAll(test){ var a = []; hdr.forEach(function(h, i){ if (test(String(h || ''))) a.push(i); }); return a; }
  function num(v){
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var t = String(v).replace(/[$,\s]/g, '').replace(/[\u2013\u2014\u2212]/g, '-');
    if (t === '' || t === '-' || /^n\/?a$/i.test(t)) return null;
    var f = parseFloat(t); return isNaN(f) ? null : f;
  }
  function pnorm(x){ return String(x == null ? '' : x).trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }

  var cCat = colFind(/product category/i); if (cCat < 0) cCat = 1;
  var cType = colFind(/type/i); if (cType < 0) cType = 0;
  var cMkt = colFind(/market/i);                                  // -1 when the tab has no Market column
  var volC = colsAll(function(x){ return /vol/i.test(x) && /m3|\(m/i.test(x); });
  if (volC.length < 2) volC = colsAll(function(x){ return /vol/i.test(x); });
  var aspC = colsAll(function(x){ return /asp/i.test(x); });
  var cm2C = colsAll(function(x){ return /cm2/i.test(x) && !/icm2/i.test(x); });
  var cCYv = volC[0], cPYv = volC[1], cCYa = aspC[0], cPYa = aspC[1], cCYc = cm2C[0], cPYc = cm2C[1];

  var dataRows = grid.slice(1);
  if (cMkt >= 0){
    dataRows = dataRows.filter(function(r){ return pnorm(r[cMkt]) === pnorm(marketName); });
  }
  var recs = [];
  dataRows.forEach(function(r){
    var cat = String(r[cCat] == null ? '' : r[cCat]).trim();
    var typ = String(r[cType] == null ? '' : r[cType]).trim();
    if (!cat) return;
    var cv = num(r[cCYv]), pv = num(r[cPYv]);
    var ca = (cCYa != null) ? num(r[cCYa]) : null, pa = (cPYa != null) ? num(r[cPYa]) : null;
    var c2 = (cCYc != null) ? num(r[cCYc]) : null, p2 = (cPYc != null) ? num(r[cPYc]) : null;
    recs.push({
      typ: typ, cat: cat, tk: typ.toLowerCase(), ck: cat.toLowerCase(),
      total: cat.toLowerCase() === 'total',
      cyVol: cv || 0, pyVol: pv || 0,
      cyRev:  (cv != null && ca != null) ? cv * ca : 0,
      pyRev:  (pv != null && pa != null) ? pv * pa : 0,
      cyCm2W: (cv != null && c2 != null) ? cv * c2 : 0,
      pyCm2W: (pv != null && p2 != null) ? pv * p2 : 0
    });
  });
  return recs;
}

/* Normalise a market label for matching PV sheet values to OVERVIEW.MARKETS. */
function ovNorm_(s){
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
}
/*****************************************************************************
 * MONTH CUBE — the Overview's history + month/year selection
 * ---------------------------------------------------------------------------
 * getOverview() above is untouched: it paints the page instantly on open and
 * is always the floor. Everything BELOW exists so the browser can hold one
 * compact fact table and compute every section from it — which is what makes
 * picking an arbitrary month, market or cross-filter cost nothing at all.
 *
 * WHERE THE ROWS COME FROM
 *   live    — PV.rawEnriched() and RMX.dataBundle(): the SAME cached rows the
 *             Price & Volume and RMX pages already built. The cube never reads
 *             the live sheets itself and adds nothing to any page load.
 *   history — the two closed-year workbooks (Config: histagg / histrmx), read
 *             ONCE by CUBE_rebuildHistory() and parked as JSON in Drive.
 *
 * LOOKUPS ALWAYS COME FROM THE CURRENT-YEAR BOOKS.
 * The history workbooks carry their own REGION LOOKUP / PLANT LOOKUP /
 * PRODUCT MASTER copies, but those froze at export time and drift. So the
 * history file on Drive stores FACTS ONLY — no market, no submarket, no
 * strength class. Every one of those is resolved at build time from the LIVE
 * lookups, which means editing a live lookup row re-labels all of history at
 * once, with no re-export and no rebuild.
 *
 * The cost of that choice: a plant or mix that traded in 2024 but has since
 * been dropped from the live lookup has nowhere to resolve to. Those are
 * COLLECTED, not silently bucketed — the manifest returns them the same way
 * RMX's getUnmapped does, so they can be added to the live lookup exactly like
 * a new plant, and the next build picks them up.
 *
 * THE MERGE RULE IS ONE LINE: history first, then drop every history month the
 * live sheet also carries. Live always wins. That is why there is no "cut off
 * at month N" constant — when the live sheet's PY runs out mid-year, the rest
 * of that year falls through to history on its own.
 *
 * WHY PLANT AND MATERIAL MUST SURVIVE
 *   PPI is indexed at Qlik's plant x material (RMX: plant x mix) grain and its
 *   coverage test has to be re-applied to whatever the selection collapses to.
 *   Keeping those two columns is what lets the browser recompute PPI for any
 *   month, market subset and filter — and why a multi-market PPI off this cube
 *   is EXACT rather than the revenue-weighted blend the cards fall back to.
 *
 * COVERAGE / QLIK PARITY  (APP_CONFIG.CUBE.COVERAGE)
 *   RMX mirrors Qlik's Weight expression: volume > 1 AND revenue > 110 on BOTH
 *   years. On 2025 vs 2024 that moves all-markets from 5.19% to 2.05% and
 *   North from 57.68% to 3.74%, dropping 75 of 3,863 pairs worth 0.063% of the
 *   weight. Two parts of that expression CANNOT be reproduced from the export
 *   and are therefore NOT applied:
 *     • Wildmatch(mix_prod_hier_1,'A*') — the field is absent from Main Raw Data.
 *     • the material exclusions behind vPYVOLMatExclusion and
 *       vASPCYExcVAMatExcluded, which shift the ASP the index is built on.
 *   Qlik's own +/-20% factor cap is COMMENTED OUT in the expression, so this
 *   code deliberately has no cap either.
 *   Aggregates is left at 0/0: the same floors change nothing there (its bad
 *   rows carry $404 and $53,542 of prior-year revenue), so it awaits its own
 *   Qlik expression rather than a guessed number.
 *****************************************************************************/

/* Bump whenever OVCUBE_SHAPE_ changes. It goes into ovcGen_(), so every cached
   chunk built against the OLD column set becomes unreachable instead of being
   served with the wrong columns. v2 = soldTo + fv on agg, ex + va on rmx.
   v3 = calendar-year chunk blocks and the era list in the manifest, neither of
   which an already-cached v2 manifest carries. */
var OVCUBE_SHAPE_VER_ = 'v3';

var OVCUBE_TOK_PROP_ = 'cube_hist_tok';   // bumped by CUBE_rebuildHistory()

/* Column layouts. Index 0 is always ym; dims follow; measures last. */
var OVCUBE_SHAPE_ = {
  /* soldTo costs ~5.6% more rows (29,527 -> 31,168 on the July file) because
     custParent is already here and is nearly 1:1 with it. fv = the volume on
     rows that actually carried a fuel surcharge, so applied tonnes can be
     summed locally instead of inferred from a bucket. */
  agg: { dims: ['plant','material','plantType','matFam','prodClass','prodApp',
                'custSeg','custParent','soldTo'],
         vals: ['v','r','fsc','fv'] },
  /* ex / va = extras and VAP revenue, so the Ready-Mix page can build its
     all-in ASP without a server call. Strength, product class and application
     already arrive through mixMap and are NOT dims. */
  rmx: { dims: ['plant','mix','segment'], vals: ['v','r','ex','va'] }
};

/* Positional offsets derived from the shape, so adding a dim never again means
   hunting for r[9] / r[10] literals scattered through the rolls and sides. */
function ovcIx_(line){
  var SH = OVCUBE_SHAPE_[line], ix = { ym:0, dim:{}, val:{}, nd: SH.dims.length };
  SH.dims.forEach(function(d, i){ ix.dim[d] = i + 1; });
  SH.vals.forEach(function(v, i){ ix.val[v] = SH.dims.length + 1 + i; });
  return ix;
}

/* ---------------------------------------------------------------- helpers */
function ovcNum_(v){
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var s = String(v).replace(/[$,\s]/g, '').replace(/[\u2013\u2014\u2212]/g, '-');
  if (s === '' || s === '-' || /^n\/?a$/i.test(s)) return 0;
  var f = parseFloat(s);
  return isNaN(f) ? 0 : f;
}
/* Like ovcCol_ but returns -1 instead of throwing when the column is absent,
   for fields an older export may not carry. */
function ovcColOpt_(t, name){
  try { return ovcCol_(t, name); } catch (e){ return -1; }
}
function ovcStr_(v){ return String(v == null ? '' : v).trim(); }
function ovcH_(s){ return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); }
function ovcUp_(v){ return ovcStr_(v).toUpperCase(); }
function ovcCfg_(){ return (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.CUBE) ? APP_CONFIG.CUBE : {}; }

var OVCUBE_MON_ = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
                    jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };

function ovcMonOrd_(v){
  if (v instanceof Date) return v.getMonth() + 1;
  var s = ovcStr_(v).toLowerCase();
  return s ? (OVCUBE_MON_[s.slice(0, 3)] || 0) : 0;
}

/* Bill Month -> 202607.
   The sheets store this as TEXT ("JUL-26"), which is the path that matters.
   The Date branch is a guard: when a workbook has been through Excel, "Jul-24"
   comes back as 2026-07-24 — the month is right and the YEAR IS HIDING IN THE
   DAY. Verified on all 58,259 history rows: decoding day -> year agrees with
   the 2024 / 2025 volume columns on every single one. */
function ovcBillYm_(v){
  if (v instanceof Date && !isNaN(v)){
    var d = v.getDate();
    var y = (d >= 20 && d <= 40) ? 2000 + d : v.getFullYear();
    return y * 100 + (v.getMonth() + 1);
  }
  var s = ovcStr_(v);

  /* A value with no year ("Jul") cannot say which year it belongs to, so it is
     not readable here: 0 sends the row to the caller's `skipped` count rather
     than into an arbitrary year. */
  var m = s.match(/^([A-Za-z]{3,})[\s\-\/.]*(\d{2,4})$/);
  if (!m) return 0;
  var mo = OVCUBE_MON_[m[1].slice(0, 3).toLowerCase()];
  if (!mo) return 0;
  var yr = parseInt(m[2], 10);
  if (yr < 100) yr += 2000;
  return yr * 100 + mo;
}

/* A dictionary that can be SEEDED from history, so the live half codes itself
   into the same namespace and the merge is a plain concat. */
function ovcDict_(seed){
  var list = (seed || []).slice(), map = {};
  for (var i = 0; i < list.length; i++) map[list[i]] = i;
  return {
    list: list,
    idx: function(v){
      var s = ovcStr_(v), hit = map[s];
      if (hit === undefined){ hit = list.length; list.push(s); map[s] = hit; }
      return hit;
    }
  };
}
function ovcDicts_(line, seed){
  var d = {};
  OVCUBE_SHAPE_[line].dims.forEach(function(f){ d[f] = ovcDict_(seed ? seed[f] : null); });
  return d;
}

/* Unmapped collector — same shape as RMX's finishUnmapped_, so "add these rows
   to the lookup" works identically for history. */
function ovcBag_(){ return { plant:{}, mix:{}, revType:{} }; }
function ovcNote_(bag, kind, value, vol, rev, ym){
  if (!bag) return;
  var v = ovcStr_(value); if (!v) return;          // a blank cell isn't a mapping problem
  var m = bag[kind], k = ovcUp_(v), g = m[k];
  if (!g) g = m[k] = { value:v, rows:0, vol:0, rev:0, months:{} };
  g.rows++; g.vol += vol || 0; g.rev += rev || 0;
  if (ym) g.months[ym] = true;
}
function ovcBagOut_(bag){
  function list(m){
    return Object.keys(m).map(function(k){
      var g = m[k], mo = Object.keys(g.months).sort();
      return { value:g.value, rows:g.rows, vol:g.vol, rev:g.rev,
               firstMonth:+mo[0] || null, lastMonth:+mo[mo.length - 1] || null };
    }).sort(function(a, b){ return Math.abs(b.rev) - Math.abs(a.rev); });   // biggest money first
  }
  var out = { plant:list(bag.plant), mix:list(bag.mix), revType:list(bag.revType) };
  out.any = !!(out.plant.length || out.mix.length || out.revType.length);
  return out;
}

/* One-shot tab read. Deliberately uncached: this runs from the Rebuild button,
   not from a page load. getDisplayValues keeps "JUL-26" as text. */
function ovcReadTab_(ss, name, mustHave){
  var sh = null, want = ovcH_(name);
  ss.getSheets().forEach(function(s){ if (!sh && ovcH_(s.getName()) === want) sh = s; });
  if (!sh) throw new Error('Tab not found: "' + name + '" in ' + ss.getName());
  var values = sh.getDataRange().getDisplayValues();
  var hdrRow = 0;
  if (mustHave && mustHave.length){
    for (var r = 0; r < Math.min(8, values.length); r++){
      var norm = values[r].map(ovcH_), ok = true;
      for (var k = 0; k < mustHave.length; k++){
        if (norm.indexOf(ovcH_(mustHave[k])) === -1){ ok = false; break; }
      }
      if (ok){ hdrRow = r; break; }
    }
  }
  var idx = {};
  (values[hdrRow] || []).forEach(function(h, i){ var n = ovcH_(h); if (n && !(n in idx)) idx[n] = i; });
  return { values: values, hdr: hdrRow, idx: idx };
}
function ovcCol_(t, name){ var i = t.idx[ovcH_(name)]; return (i === undefined) ? -1 : i; }

/* Find "#### Volume" / "#### Vol" columns and report which year each is.
   Never used to DECIDE a row's year — an export that reuses the live template
   can carry 2026/2025 headers over 2025/2024 data. Only the pairing comes from
   here; the year itself comes from the Year column (AGG) or Bill Month (RMX). */
function ovcYearCols_(t, re){
  var out = [];
  Object.keys(t.idx).forEach(function(h){
    var m = h.match(re);
    if (m) out.push({ y: parseInt(m[1], 10), i: t.idx[h] });
  });
  out.sort(function(a, b){ return a.y - b.y; });
  return out;
}


/* ========================================================================
 * CURRENT-YEAR LOOKUPS  (never the history book's own frozen copies)
 * ====================================================================== */
function ovcLookupsAgg_(){
  var ss = APP_openSpreadsheet_('pricevolume');
  var S  = APP_CONFIG.PAGES.pricevolume.SHEETS;
  var rl = ovcReadTab_(ss, S.REGION_LOOKUP, []);
  var plant = {};                     // PLANT(upper) -> attrs (positional: PV's buildLookups_)
  rl.values.slice(1).forEach(function(r){
    var p = ovcUp_(r[0]); if (!p || (p in plant)) return;
    plant[p] = { region: ovcStr_(r[9]),  subregion: ovcStr_(r[3]), market: ovcStr_(r[10]),
                 sm1:    ovcStr_(r[11]), sm2:       ovcStr_(r[2]), mb:     ovcStr_(r[8]) };
  });
  var tl = ovcReadTab_(ss, S.TOPLINE_LOOKUP, []);
  var topline = {};
  tl.values.slice(1).forEach(function(r){
    var k = ovcUp_(r[0]); if (k && !(k in topline)) topline[k] = ovcStr_(r[9]);
  });
  return { plant: plant, topline: topline };
}

function ovcLookupsRmx_(){
  var ss = APP_openSpreadsheet_('rmx');
  var S  = APP_CONFIG.PAGES.rmx.SHEETS;
  var p  = ovcReadTab_(ss, S.PLANT, ['plant', 'market']);
  var cP = ovcCol_(p, 'plant'), cM = ovcCol_(p, 'market'), cS = ovcCol_(p, 'submarket');
  var plant = {};
  for (var i = p.hdr + 1; i < p.values.length; i++){
    var k = ovcUp_(p.values[i][cP]); if (!k || (k in plant)) continue;   // VLOOKUP parity
    plant[k] = { market: ovcStr_(p.values[i][cM]), submarket: ovcStr_(p.values[i][cS]) };
  }
  var pm = ovcReadTab_(ss, S.PRODUCT, ['product code', 'strength class']);
  var cC = ovcCol_(pm, 'product code'), cSt = ovcCol_(pm, 'strength class'),
      cCl = ovcCol_(pm, 'new product class'), cA = ovcCol_(pm, 'new product application');
  var product = {};
  for (var j = pm.hdr + 1; j < pm.values.length; j++){
    var code = ovcUp_(pm.values[j][cC]); if (!code || (code in product)) continue;
    product[code] = { strength: ovcStr_(pm.values[j][cSt]) || 'Others',
                      cls:      ovcStr_(pm.values[j][cCl]) || 'Others',
                      app:      ovcStr_(pm.values[j][cA])  || 'Others' };
  }
  return { plant: plant, product: product };
}


/* ========================================================================
 * ROLL — facts only. No lookups touched here, by design.
 * `t` given: read a history tab.  `live` given: the base page's cached rows.
 * ====================================================================== */
function ovcAggRoll_(t, c, volHi, volLo, yMax, yMin, live, seed){
  var D = ovcDicts_('agg', seed), acc = {}, order = [], skipped = 0;
  var IX = ovcIx_('agg');

  function push(ym, p, m, pt, mf, pc, pa, cs, cp, st, v, r, fsc, fv){
    if (!ym || (!v && !r && !fsc)) return;
    var k = ym + '\u0001' + p + '\u0001' + m + '\u0001' + pt + '\u0001' + mf
          + '\u0001' + pc + '\u0001' + pa + '\u0001' + cs + '\u0001' + cp
          + '\u0001' + st;
    var a = acc[k];
    if (!a){ a = acc[k] = [ym, p, m, pt, mf, pc, pa, cs, cp, st, 0, 0, 0, 0]; order.push(k); }
    a[IX.val.v] += v; a[IX.val.r] += r; a[IX.val.fsc] += fsc; a[IX.val.fv] += (fv || 0);
  }

  if (t){
    for (var i = t.hdr + 1; i < t.values.length; i++){
      var row = t.values[i];
      var yr = Math.round(ovcNum_(row[c.year])), mo = ovcMonOrd_(row[c.month]);
      if (!yr || !mo){ skipped++; continue; }
      var hi = (yr === yMax);
      if (!hi && yr !== yMin){ skipped++; continue; }
      var hv = ovcNum_(row[hi ? volHi : volLo]);
      var hf = ovcNum_(row[hi ? c.cyFsc : c.pyFsc]);
      /* Applied volume: use the sheet's own FSC volume column when the export
         carries it, otherwise fall back to the row rule - a line that carried a
         charge contributes its own tonnes. An older history export without the
         column therefore still gives the right applied tonnes. */
      var hfv;
      var fvCol = hi ? c.fscCyVol : c.fscPyVol;
      if (fvCol != null && fvCol >= 0) hfv = ovcNum_(row[fvCol]);
      else hfv = (hf !== 0) ? hv : 0;
      /* Sold To is optional: a history export without the column keeps every
         row under a blank Sold To rather than shifting any other dimension. */
      var stIx = (c.soldTo != null && c.soldTo >= 0) ? D.soldTo.idx(row[c.soldTo]) : D.soldTo.idx('');
      push(yr * 100 + mo,
        D.plant.idx(row[c.plant]), D.material.idx(row[c.material]),
        D.plantType.idx(row[c.plantType]), D.matFam.idx(row[c.matFam]),
        D.prodClass.idx(row[c.prodClass]), D.prodApp.idx(row[c.prodApp]),
        D.custSeg.idx(row[c.custSeg]), D.custParent.idx(row[c.custParent]), stIx,
        hv,
        ovcNum_(row[hi ? c.cyRev : c.pyRev]),
        hf, hfv);
    }
  } else {
    /* PV enriched rows carry both years side by side: CY belongs to yMax,
       PY to yMax-1. Nothing here re-reads a sheet. */
    for (var j = 0; j < live.length; j++){
      var e = live[j], m2 = ovcMonOrd_(e.month);
      if (!m2){ skipped++; continue; }
      var p = D.plant.idx(e.plant), mt = D.material.idx(e.material),
          pt = D.plantType.idx(e.plantType), mf = D.matFam.idx(e.materialFam),
          pc = D.prodClass.idx(e.prodClass), pa = D.prodApp.idx(e.prodApp),
          cs = D.custSeg.idx(e.custSeg), cp = D.custParent.idx(e.custParent),
          st = D.soldTo.idx(e.soldTo || '');
      /* PV's enriched rows carry the per-month applied tonnes already (that is
         what the FSC page reconciles against); fall back to the row rule. */
      var cfv = (e.fscCyVol != null) ? e.fscCyVol : (e.cyFsc ? e.cyVol : 0);
      var pfv = (e.fscPyVol != null) ? e.fscPyVol : (e.pyFsc ? e.pyVol : 0);
      push(yMax * 100 + m2,       p, mt, pt, mf, pc, pa, cs, cp, st, e.cyVol, e.cyRev, e.cyFsc, cfv);
      push((yMax - 1) * 100 + m2, p, mt, pt, mf, pc, pa, cs, cp, st, e.pyVol, e.pyRev, e.pyFsc, pfv);
    }
  }
  var dict = {};
  OVCUBE_SHAPE_.agg.dims.forEach(function(f){ dict[f] = D[f].list; });
  return { line:'agg', rows: order.map(function(k){ return acc[k]; }), dict: dict, skipped: skipped };
}

function ovcRmxRoll_(t, c, byYear, live, cyYear, seed){
  var D = ovcDicts_('rmx', seed), acc = {}, order = [], skipped = 0;
  var IX = ovcIx_('rmx');

  function push(ym, p, mx, sg, v, r, ex, va){
    ex = ex || 0; va = va || 0;
    if (!ym || (!v && !r && !ex && !va)) return;
    var k = ym + '\u0001' + p + '\u0001' + mx + '\u0001' + sg;
    var a = acc[k];
    if (!a){ a = acc[k] = [ym, p, mx, sg, 0, 0, 0, 0]; order.push(k); }
    a[IX.val.v] += v; a[IX.val.r] += r; a[IX.val.ex] += ex; a[IX.val.va] += va;
  }

  if (t){
    for (var i = t.hdr + 1; i < t.values.length; i++){
      var row = t.values[i];
      if (!ovcStr_(row[c.plant])) continue;
      var ym = ovcBillYm_(row[c.bill]);
      if (!ym){ skipped++; continue; }

      /* Bill Month ("Jul-26") names its own year, and that is the one year the
         row feeds. Each month therefore arrives twice — once per year — and
         push() sums the two into the same ym bucket. */
      var mo = ym % 100, yr = Math.floor(ym / 100);
      var col = byYear[yr];
      if (!col){ skipped++; continue; }        // year outside this workbook's two
      push(yr * 100 + mo, D.plant.idx(row[c.plant]), D.mix.idx(row[c.mix]),
           D.segment.idx(row[c.seg]), ovcNum_(row[col.v]), ovcNum_(row[col.r]),
           (col.ex != null && col.ex >= 0) ? ovcNum_(row[col.ex]) : 0,
           (col.va != null && col.va >= 0) ? ovcNum_(row[col.va]) : 0);
    }
  } else {
    for (var j = 0; j < live.length; j++){
      var e = live[j];
      if (!e.month){ skipped++; continue; }
      var pi = D.plant.idx(e.plant), mi = D.mix.idx(e.mix), si = D.segment.idx(e.segment);
      push(cyYear * 100 + e.month,       pi, mi, si, e.cyVol, e.cyRev,
           e.cyExRev || 0, e.cyVaRev || 0);
      push((cyYear - 1) * 100 + e.month, pi, mi, si, e.pyVol, e.pyRev,
           e.pyExRev || 0, e.pyVaRev || 0);
    }
  }
  var dict = {};
  OVCUBE_SHAPE_.rmx.dims.forEach(function(f){ dict[f] = D[f].list; });
  return { line:'rmx', rows: order.map(function(k){ return acc[k]; }), dict: dict, skipped: skipped };
}


/* ========================================================================
 * SIDE-TABLES — built ONCE over the merged dictionaries, from LIVE lookups.
 * This is the step that keeps history labelled by the current-year books.
 * ====================================================================== */
function ovcAggSides_(cube, LK, bag){
  var M = { market: ovcDict_(), sm1: ovcDict_(), sm2: ovcDict_(), mb: ovcDict_(), revType: ovcDict_() };
  var pm = { market: [], sm1: [], sm2: [], mb: [] };
  var vol = {}, rev = {};
  var AX = ovcIx_('agg');
  cube.rows.forEach(function(r){
    vol[r[AX.dim.plant]] = (vol[r[AX.dim.plant]] || 0) + r[AX.val.v];
    rev[r[AX.dim.plant]] = (rev[r[AX.dim.plant]] || 0) + r[AX.val.r];
  });

  cube.dict.plant.forEach(function(name, i){
    var a = LK.plant[ovcUp_(name)];
    if (!a){ ovcNote_(bag, 'plant', name, vol[i] || 0, rev[i] || 0); a = {}; }
    pm.market.push(M.market.idx(a.market || ''));
    pm.sm1.push(M.sm1.idx(a.sm1 || ''));
    pm.sm2.push(M.sm2.idx(a.sm2 || ''));
    pm.mb.push(M.mb.idx(a.mb || ''));
  });

  /* revType is keyed Plant&Material&SM2&SM1 in the sheet, but SM2/SM1 are
     functions of the plant, so plant|material is a complete key here. */
  var rt = {}, seen = {};
  cube.rows.forEach(function(r){
    var kk = r[AX.dim.plant] + '|' + r[AX.dim.material];
    if (seen[kk]) return;
    seen[kk] = 1;
    var lk = ovcUp_(cube.dict.plant[r[AX.dim.plant]]) + ovcUp_(cube.dict.material[r[AX.dim.material]])
           + ovcUp_(M.sm2.list[pm.sm2[r[AX.dim.plant]]]) + ovcUp_(M.sm1.list[pm.sm1[r[AX.dim.plant]]]);
    var hit = LK.topline[lk];
    if (hit === undefined)
      ovcNote_(bag, 'revType', cube.dict.plant[r[AX.dim.plant]] + ' | '
        + cube.dict.material[r[AX.dim.material]], r[AX.val.v], r[AX.val.r], r[AX.ym]);
    rt[kk] = M.revType.idx(hit || 'TOP LINE REVENUE');
  });

  ['market','sm1','sm2','mb','revType'].forEach(function(f){ cube.dict[f] = M[f].list; });
  cube.plantMap = pm;
  cube.revType  = rt;
  return cube;
}

function ovcRmxSides_(cube, LK, bag){
  var M = { market: ovcDict_(), submarket: ovcDict_(),
            strength: ovcDict_(), cls: ovcDict_(), app: ovcDict_() };
  var pm = { market: [], submarket: [] }, mm = { strength: [], cls: [], app: [] };
  var vol = {}, rev = {};
  var RX = ovcIx_('rmx');
  cube.rows.forEach(function(r){
    vol[r[RX.dim.plant]] = (vol[r[RX.dim.plant]] || 0) + r[RX.val.v];
    rev[r[RX.dim.plant]] = (rev[r[RX.dim.plant]] || 0) + r[RX.val.r];
  });

  cube.dict.plant.forEach(function(name, i){
    var a = LK.plant[ovcUp_(name)];
    if (!a){ ovcNote_(bag, 'plant', name, vol[i] || 0, rev[i] || 0); a = {}; }
    pm.market.push(M.market.idx(a.market || ''));
    pm.submarket.push(M.submarket.idx(a.submarket || ''));
  });

  var mvol = {}, mrev = {};
  cube.rows.forEach(function(r){
    mvol[r[RX.dim.mix]] = (mvol[r[RX.dim.mix]] || 0) + r[RX.val.v];
    mrev[r[RX.dim.mix]] = (mrev[r[RX.dim.mix]] || 0) + r[RX.val.r];
  });
  cube.dict.mix.forEach(function(mixName, i){
    var s = ovcStr_(mixName), hit;
    if (s === '' || s === '0') hit = { strength:'Others', cls:'Others', app:'Others' };
    else {
      /* RMX's productCode_ rule: everything before " - ", and a bare "-" is a
         real code that must still go through PRODUCT MASTER. */
      var code = (s === '-') ? '-' : (s.indexOf(' - ') > 0 ? s.substring(0, s.indexOf(' - ')) : s);
      hit = LK.product[ovcUp_(code)];
      if (!hit){
        ovcNote_(bag, 'mix', mixName, mvol[i] || 0, mrev[i] || 0);
        hit = { strength:'#N/A', cls:'#N/A', app:'#N/A' };   // kept separate from "Others" on purpose
      }
    }
    mm.strength.push(M.strength.idx(hit.strength));
    mm.cls.push(M.cls.idx(hit.cls));
    mm.app.push(M.app.idx(hit.app));
  });

  ['market','submarket','strength','cls','app'].forEach(function(f){ cube.dict[f] = M[f].list; });
  cube.plantMap = pm;
  cube.mixMap   = mm;
  return cube;
}


/* ========================================================================
 * HISTORY BUILDERS — facts only; nothing here reads a lookup
 * ====================================================================== */
/* `page` is the era's page id ('histagg', 'histagg2', ...). Nothing in here is
   year-aware - the years come from the Year column and the "#### Volume"
   headers - so every era reads through this one function. */
function ovcHistAgg_(page){
  page = page || 'histagg';
  var ss = APP_openSpreadsheet_(page);
  var S  = APP_CONFIG.PAGES[page].SHEETS;
  var t  = ovcReadTab_(ss, S.SHEET, ['plant', 'material', 'year', 'month']);
  var c = {
    year: ovcCol_(t, 'year'), month: ovcCol_(t, 'month'),
    plant: ovcCol_(t, 'plant'), material: ovcCol_(t, 'material'),
    plantType: ovcCol_(t, 'plant type'), matFam: ovcCol_(t, 'material family'),
    prodClass: ovcCol_(t, 'product class [rock]'), prodApp: ovcCol_(t, 'product application'),
    custSeg: ovcCol_(t, 'cust segment [rock]'), custParent: ovcCol_(t, 'customer parent'),
    cyRev: ovcCol_(t, 'cy rev exworks'), pyRev: ovcCol_(t, 'py rev exworks'),
    cyFsc: ovcCol_(t, 'cy fuel surcharge'), pyFsc: ovcCol_(t, 'py fuel surcharge'),
    /* optional: absent in older exports, handled in the roll */
    soldTo:   ovcColOpt_(t, 'sold to'),
    fscCyVol: ovcColOpt_(t, 'fsc cy volume'),
    fscPyVol: ovcColOpt_(t, 'fsc py volume')
  };
  var vc = ovcYearCols_(t, /^(\d{4}) volume$/);
  if (vc.length < 2) throw new Error('History Aggregates: expected two "#### Volume" columns.');

  /* THE HEADER DOES NOT DECIDE ANYTHING - not the year of a row, and not which
     volume column belongs to which year. The 2024/2023 export ships its two
     columns labelled "2023 Volume", "2024 Volume" in that order while the data
     underneath is still CY-then-PY like every other book, so pairing on the
     header year reads the wrong column for BOTH years and the whole era lands
     with zero volume against real revenue.

     So: find the columns by header (above), then let the DATA say which is CY.
     Each row fills exactly one of the two, so totalling both columns split by
     Year and taking the larger on the yMax rows is unambiguous. Ties and empty
     books fall back to left-most = CY, which is how every export is laid out. */
  var yMin = 0, yMax = 0, i, y;
  for (i = t.hdr + 1; i < t.values.length; i++){
    y = Math.round(ovcNum_(t.values[i][c.year])); if (!y) continue;
    if (!yMax || y > yMax) yMax = y;
    if (!yMin || y < yMin) yMin = y;
  }
  if (!yMax) throw new Error('History Aggregates: the Year column is empty.');

  var iA = vc[0].i, iB = vc[vc.length - 1].i, sumA = 0, sumB = 0;
  for (i = t.hdr + 1; i < t.values.length; i++){
    y = Math.round(ovcNum_(t.values[i][c.year]));
    if (y !== yMax) continue;
    sumA += Math.abs(ovcNum_(t.values[i][iA]));
    sumB += Math.abs(ovcNum_(t.values[i][iB]));
  }
  var volHi = (sumB > sumA) ? iB : iA;              // whichever the CY rows fill
  var volLo = (volHi === iA) ? iB : iA;
  return ovcAggRoll_(t, c, volHi, volLo, yMax, yMin, null, null);
}

function ovcHistRmx_(page){
  page = page || 'histrmx';
  var ss = APP_openSpreadsheet_(page);
  var S  = APP_CONFIG.PAGES[page].SHEETS;
  var t  = ovcReadTab_(ss, S.MAIN, ['plant', 'product mix']);
  var vcols = ovcYearCols_(t, /^(\d{4}) vol$/);
  var rcols = ovcYearCols_(t, /^(\d{4}) net sales ex va \(cad\)$/);
  if (vcols.length < 2 || rcols.length < 2)
    throw new Error('History Ready-Mix: expected two "#### Vol" and two "#### Net Sales Ex VA (CAD)" columns.');
  var byYear = {};
  vcols.forEach(function(x){ (byYear[x.y] = byYear[x.y] || {}).v = x.i; });
  rcols.forEach(function(x){ (byYear[x.y] = byYear[x.y] || {}).r = x.i; });
  /* ovcH_ leaves underscores alone, so the export's "bill_month" needs its own
     entry alongside the sheet's "Bill Month". */
  var cBill = ovcCol_(t, 'bill month');
  if (cBill < 0) cBill = ovcCol_(t, 'billmonth');
  if (cBill < 0) cBill = ovcCol_(t, 'bill_month');
  if (cBill < 0) throw new Error('History Ready-Mix: no "Bill Month" column was found.');
  var c = { bill: cBill, plant: ovcCol_(t, 'plant'),
            mix: ovcCol_(t, 'product mix'), seg: ovcCol_(t, 'major project segment') };
  return ovcRmxRoll_(t, c, byYear, null, 0, null);
}


/* ========================================================================
 * LIVE BUILDERS — seeded with the history dictionaries so codes line up
 * ====================================================================== */
function ovcLiveAgg_(seed){
  var rows = PV.rawEnriched();
  var cy = rows.cyYear || (new Date()).getFullYear();
  return ovcAggRoll_(null, null, 0, 0, cy, cy - 1, rows, seed);
}

/* RMX's loader hard-codes its year column names, so the CY year is read off
   the sheet header instead of assumed — three rows, not a data read. */
function ovcLiveRmxYear_(){
  var ss = APP_openSpreadsheet_('rmx');
  var S = APP_CONFIG.PAGES.rmx.SHEETS, want = ovcH_(S.MAIN), sh = null;
  ss.getSheets().forEach(function(s){ if (!sh && ovcH_(s.getName()) === want) sh = s; });
  if (!sh) throw new Error('Tab not found: "' + S.MAIN + '"');
  var head = sh.getRange(1, 1, Math.min(3, sh.getLastRow()), Math.min(30, sh.getLastColumn())).getDisplayValues();
  var best = 0;
  head.forEach(function(r){ r.forEach(function(h){
    var m = ovcH_(h).match(/^(\d{4}) vol$/); if (m && +m[1] > best) best = +m[1];
  }); });
  if (!best) throw new Error('Could not read the current year from the RMX "#### Vol" headers.');
  return best;
}
function ovcLiveRmx_(seed){
  return ovcRmxRoll_(null, null, null, RMX_NS.dataBundle().main || [], ovcLiveRmxYear_(), seed);
}


/* ========================================================================
 * MERGE — history first, live overwrites every month it carries.
 * Live was seeded with history's dictionaries, so codes already agree and
 * this is a filter plus a concat.
 * ====================================================================== */
function ovcMerge_(hist, live){
  if (!hist) return live;
  var seen = {};
  live.rows.forEach(function(r){ seen[r[0]] = true; });
  var rows = [];
  hist.rows.forEach(function(r){ if (!seen[r[0]]) rows.push(r); });   // live always wins
  live.rows.forEach(function(r){ rows.push(r); });
  rows.sort(function(a, b){ return a[0] - b[0]; });
  return { line: live.line, rows: rows, dict: live.dict,             // live.dict is history's superset
           skipped: (hist.skipped || 0) + (live.skipped || 0) };
}


/* ========================================================================
 * PERSISTENCE — history JSON in Drive (no ceiling, permanent); the merged
 * cube's client chunks in CacheService under the generation token.
 * ====================================================================== */
function ovcFolder_(){
  /* KPI_FOLDER_ID is a PROPERTY of APP_CONFIG, never a global \u2014 the old
     `typeof KPI_FOLDER_ID` test could therefore never be true, so every history
     write threw "Set APP_CONFIG.CUBE.HIST_FOLDER_ID" even with the KPI folder
     configured. Read it off APP_CONFIG, which is where it actually lives. */
  var cfgId = '';
  try { cfgId = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.KPI_FOLDER_ID) || ''; } catch (e) { cfgId = ''; }
  var id = ovcCfg_().HIST_FOLDER_ID || cfgId;
  if (!id) throw new Error('No Drive folder is set for the history files. Add APP_CONFIG.KPI_FOLDER_ID '
    + '(or APP_CONFIG.CUBE.HIST_FOLDER_ID) in Config.gs.');
  return DriveApp.getFolderById(id);
}
/* ------------------------------------------------------------------ eras --
 * An ERA is one closed-year workbook PAIR (an Aggregates book and a Ready-Mix
 * book covering the same two years). APP_CONFIG.CUBE.ERAS lists them NEWEST
 * FIRST and everything below is written against that list, so a fourth book is
 * a config line rather than a code change.
 * ------------------------------------------------------------------------ */
function ovcEras_(){
  var e = ovcCfg_().ERAS;
  return (e && e.length) ? e : [{ id:'h1', label:'history', agg:'histagg', rmx:'histrmx' }];
}
function ovcEra_(id){
  var want = String(id || ''), out = null;
  ovcEras_().forEach(function(e){ if (!out && e.id === want) out = e; });
  return out;
}
function ovcEraPage_(era, line){ return (era && era[line]) ? era[line] : ''; }
/* Has this era's book been pointed at a sheet? Script Properties only - no
   Drive call, no open - because it runs inside every manifest build. */
function ovcEraLinked_(era, line){
  var page = ovcEraPage_(era, line);
  if (!page || !APP_CONFIG.PAGES[page]) return false;
  try { return !!getSpreadsheetIdForPage_(page); } catch (e){ return false; }
}

/* The FIRST era keeps the plain FILES name, so adding a second era never
   orphans a file already sitting in Drive; later eras carry the id. */
function ovcHistName_(line, eraId){
  var base = (ovcCfg_().FILES || {})[line] || ('cube_hist_' + line + '.json');
  var eras = ovcEras_(), first = eras.length ? eras[0].id : '';
  if (!eraId || eraId === first) return base;
  return base.replace(/\.json$/i, '') + '_' + eraId + '.json';
}
function ovcHistWrite_(line, eraId, obj){
  var name = ovcHistName_(line, eraId), folder = ovcFolder_();
  var it = folder.getFilesByName(name);
  while (it.hasNext()) it.next().setTrashed(true);
  /* STAMP THE SHAPE. A history file is a bare array of arrays: nothing in the
     JSON says how many dimensions sit between ym and the measures. Adding a
     dimension (soldTo did exactly this) therefore shifts every measure one slot
     to the LEFT when an older file is read back - volume starts reading the
     revenue column, ASP collapses to zero, and nothing anywhere reports an
     error. Writing the shape here and checking it in ovcHistFile_ turns that
     silent corruption into a plain "not built yet". */
  var SH = OVCUBE_SHAPE_[line] || { dims: [], vals: [] };
  var out = { line: obj.line, rows: obj.rows, dict: obj.dict, skipped: obj.skipped || 0,
              shape: OVCUBE_SHAPE_VER_, dims: SH.dims, vals: SH.vals };
  folder.createFile(name, JSON.stringify(out), MimeType.PLAIN_TEXT);
}
/* A file whose shape does not match the code reading it is treated as ABSENT,
   not as data. The era then reports built:false, the Overview's background
   loader picks it up on its own and re-reads the book once - so a shape change
   costs one silent rebuild instead of a page full of wrong numbers. */
function ovcHistShapeOk_(line, o){
  if (!o) return false;
  if (o.shape !== OVCUBE_SHAPE_VER_) return false;
  var SH = OVCUBE_SHAPE_[line] || { dims: [], vals: [] };
  if (!o.dims || !o.vals) return false;
  if (o.dims.join('|') !== SH.dims.join('|')) return false;
  if (o.vals.join('|') !== SH.vals.join('|')) return false;
  return true;
}
function ovcHistFile_(line, eraId){
  try {
    var it = ovcFolder_().getFilesByName(ovcHistName_(line, eraId));
    if (!it.hasNext()) return null;
    var o = JSON.parse(it.next().getBlob().getDataAsString());
    if (!o || !o.rows || !o.dict) return null;
    return ovcHistShapeOk_(line, o) ? o : null;   // stale layout -> rebuild, never misread
  } catch (e){ return null; }        // not built yet -> the charts simply start later
}

/* -------------------------------------------------------- dictionary remap --
 * THE one gotcha of a second era. Each history file is built on its own with
 * seed:null, so plant 7 in the 2025/2024 file is NOT plant 7 in the 2024/2023
 * file. Concatenating their rows would silently relabel half the cube.
 *
 * The fix is a remap at READ time, not a shared seed at write time: the newest
 * era present becomes the master dictionary and every older era's codes are
 * translated into it. That is order-independent, so rebuilding one book later
 * can never corrupt another, and the live half is still seeded from one
 * dictionary exactly as before.
 * ------------------------------------------------------------------------ */
function ovcMaster_(line, seedDict){
  var M = {};
  OVCUBE_SHAPE_[line].dims.forEach(function(f){
    var list = (seedDict && seedDict[f]) ? seedDict[f].slice() : [], map = {};
    for (var i = 0; i < list.length; i++) map[list[i]] = i;
    M[f] = { list: list, map: map };
  });
  return M;
}
function ovcMasterDict_(line, M){
  var d = {};
  OVCUBE_SHAPE_[line].dims.forEach(function(f){ d[f] = M[f].list; });
  return d;
}
/* old code -> master code, one lookup array per dimension */
function ovcRemap_(line, M, dict){
  var maps = {};
  OVCUBE_SHAPE_[line].dims.forEach(function(f){
    var src = (dict && dict[f]) || [], m = M[f], arr = new Array(src.length);
    for (var i = 0; i < src.length; i++){
      var lab = String(src[i] == null ? '' : src[i]), hit = m.map[lab];
      if (hit === undefined){ hit = m.list.length; m.list.push(lab); m.map[lab] = hit; }
      arr[i] = hit;
    }
    maps[f] = arr;
  });
  return maps;
}

/* Every built era, folded into ONE history cube with ONE dictionary.
   Newest era first; an older book's month is dropped when a newer book already
   carries it (2024 lives in both books). Live then wins over the lot in
   ovcMerge_, exactly as it did with a single archive. */
function ovcHistRead_(line){
  var dims = OVCUBE_SHAPE_[line].dims;
  var M = null, rows = [], skipped = 0, seen = {}, got = [];

  ovcEras_().forEach(function(era){
    var f = ovcHistFile_(line, era.id);
    if (!f) return;
    var mine = {}, kept = 0, i, d;

    if (!M){
      /* the newest era present: its dictionary IS the master, so its rows go
         in untouched - no copy, no translation */
      M = ovcMaster_(line, f.dict);
      for (i = 0; i < f.rows.length; i++){ mine[f.rows[i][0]] = true; rows.push(f.rows[i]); kept++; }
    } else {
      var map = ovcRemap_(line, M, f.dict);
      for (i = 0; i < f.rows.length; i++){
        var r = f.rows[i], ym = r[0];
        mine[ym] = true;
        if (seen[ym]) continue;                    // a newer book already owns this month
        var q = r.slice();
        for (d = 0; d < dims.length; d++){
          var mp = map[dims[d]], c = q[d + 1];
          q[d + 1] = (mp && mp[c] != null) ? mp[c] : 0;
        }
        rows.push(q); kept++;
      }
    }
    Object.keys(mine).forEach(function(k){ seen[k] = true; });
    var ms = Object.keys(mine).map(Number).sort(function(a, b){ return a - b; });
    skipped += f.skipped || 0;
    got.push({ id: era.id, label: era.label || era.id, rows: kept, months: ms.length,
               from: ms[0] || null, to: ms[ms.length - 1] || null });
  });

  if (!M) return null;                             // nothing built yet
  rows.sort(function(a, b){ return a[0] - b[0]; });
  return { line: line, rows: rows, dict: ovcMasterDict_(line, M),
           skipped: skipped, eras: got };
}

/* What the browser needs to run the background reads by itself: which eras
   have a sheet link, and which of those have actually been built. `linked` is
   read fresh from Script Properties; saving a sheet id runs syncAll(), which
   moves the generation on, so a manifest can never sit on a stale answer. */
function ovcEraStat_(line, hist){
  var built = {};
  ((hist && hist.eras) || []).forEach(function(e){ built[e.id] = e; });
  return ovcEras_().map(function(e){
    var b = built[e.id];
    return { id: e.id, label: e.label || e.id,
             linked: ovcEraLinked_(e, line), built: !!b,
             months: b ? b.months : 0, from: b ? b.from : null, to: b ? b.to : null };
  });
}
function ovcHistTok_(){
  try { return PropertiesService.getScriptProperties().getProperty(OVCUBE_TOK_PROP_) || '0'; }
  catch (e) { return '0'; }
}
function ovcGen_(){
  return APP_getGen_('pricevolume') + '-' + APP_getGen_('rmx') + '-h' + ovcHistTok_() + '-s' + OVCUBE_SHAPE_VER_;
}


/* ========================================================================
 * BUILD + SLICE — one merged cube per line, cut into client chunks
 * ====================================================================== */
/* Blocks follow the CALENDAR YEAR, newest first, capped at CHUNK_MONTHS.
   The old plan cut fixed 12-month slices from the newest month backwards, so
   the first block to land ended on an arbitrary boundary (Aug 25 - Jul 26) and
   the slider stopped somewhere meaningless while the rest streamed. Year
   blocks make the first arrival exactly the current year to date, and each
   later one a whole earlier year, so the left handle walks back Jan 26 ->
   Jan 25 -> Jan 24 -> Jan 23 and every stop is a span someone would ask for. */
function ovcChunkPlan_(ymList){
  var cap = ovcCfg_().CHUNK_MONTHS || 12;
  var months = ymList.slice().sort(function(a, b){ return b - a; });   // newest first
  var order = [], byYear = {};
  months.forEach(function(m){
    var y = Math.floor(m / 100);
    if (!byYear[y]){ byYear[y] = []; order.push(y); }
    byYear[y].push(m);
  });
  var out = [];
  order.forEach(function(y){
    var list = byYear[y];
    for (var i = 0; i < list.length; i += cap){
      var slice = list.slice(i, i + cap);
      out.push({ i: out.length, from: Math.min.apply(null, slice),
                 to: Math.max.apply(null, slice), months: slice });
    }
  });
  return out;
}

function ovcBuild_(line){
  var gen = ovcGen_(), key = 'ovc|' + gen + '|' + line;
  var cached = APP_cacheGet_(key + '|man');
  if (cached) return cached;

  var hist = ovcHistRead_(line);
  var live = (line === 'agg') ? ovcLiveAgg_(hist ? hist.dict : null)
                              : ovcLiveRmx_(hist ? hist.dict : null);
  var cube = ovcMerge_(hist, live);

  /* every label resolved here, from the CURRENT-YEAR lookups */
  var bag = ovcBag_();
  if (line === 'agg') ovcAggSides_(cube, ovcLookupsAgg_(), bag);
  else                ovcRmxSides_(cube, ovcLookupsRmx_(), bag);

  var ymSet = {}; cube.rows.forEach(function(r){ ymSet[r[0]] = true; });
  var ymList = Object.keys(ymSet).map(Number).sort(function(a, b){ return a - b; });
  var plan = ovcChunkPlan_(ymList);
  var SH = OVCUBE_SHAPE_[line], nd = SH.dims.length;

  plan.forEach(function(ch){
    var want = {}; ch.months.forEach(function(m){ want[m] = true; });
    var cols = { ym: [] };
    SH.dims.concat(SH.vals).forEach(function(f){ cols[f] = []; });
    cube.rows.forEach(function(r){
      if (!want[r[0]]) return;
      cols.ym.push(r[0]);
      for (var d = 0; d < nd; d++) cols[SH.dims[d]].push(r[d + 1]);
      for (var v = 0; v < SH.vals.length; v++) cols[SH.vals[v]].push(Math.round(r[nd + 1 + v] * 100) / 100);
    });
    ch.rows = cols.ym.length;
    APP_cachePut_(key + '|c' + ch.i, { ok:true, gen:gen, line:line, i:ch.i, cols:cols });
  });

  var manifest = {
    ok: true, gen: gen, line: line, ym: ymList,
    dims: SH.dims, vals: SH.vals,
    chunks: plan.map(function(c){ return { i:c.i, from:c.from, to:c.to, rows:c.rows }; }),
    dict: cube.dict, plantMap: cube.plantMap,
    mixMap: cube.mixMap || null, revType: cube.revType || null,
    coverage: (ovcCfg_().COVERAGE || {})[line] || { minVol:0, minRev:0 },
    skipped: cube.skipped || 0,
    history: !!hist,
    /* which closed-year books exist, which are linked, which are built - the
       browser drives the background reads off this and needs no second call */
    eras: ovcEraStat_(line, hist),
    floor: ovcCfg_().FLOOR || 0,
    unmapped: ovcBagOut_(bag)
  };
  APP_cachePut_(key + '|man', manifest);
  return manifest;
}


/* ========================================================================
 * CLIENT-CALLABLE
 * ====================================================================== */

/* One small call on page open: dictionaries, side-tables, the chunk plan and
   the coverage thresholds — everything the browser needs to start decoding.
   A line that fails is reported without taking the other one down. */
function CUBE_getManifest(opts){
  /* Price & Volume only ever asks about Aggregates and Ready-Mix only about
     Ready-Mix, so building both cubes for them was half the work thrown away
     — and on a cold server cache that is the single slowest thing the page
     does. Pages now name the lines they need; the Overview still asks for
     both, and no argument at all still means both. */
  opts = opts || {};
  var want = (opts.lines && opts.lines.length) ? opts.lines : ['agg', 'rmx'];
  var out = { ok:false, gen: ovcGen_(), lines: {}, errors: {} };
  ['agg', 'rmx'].forEach(function(line){
    if (want.indexOf(line) === -1) return;
    try { out.lines[line] = ovcBuild_(line); out.ok = true; }
    catch (e){ out.errors[line] = (e && e.message) ? e.message : String(e); }
  });
  out.only = want.slice();
  return out;
}

/* One month-block of facts. Requested newest-first. */
function CUBE_getChunk(opts){
  opts = opts || {};
  var line = (opts.line === 'rmx') ? 'rmx' : 'agg';
  var i = Math.max(0, parseInt(opts.i, 10) || 0);
  var key = 'ovc|' + ovcGen_() + '|' + line + '|c' + i;
  var hit = APP_cacheGet_(key);
  if (hit) return hit;
  ovcBuild_(line);                                  // cache lapsed — rebuild, then read back
  return APP_cacheGet_(key) || { ok:false, line:line, i:i, error:'Chunk ' + i + ' is not available.' };
}

/* Read ONE history workbook and park it in Drive. One line of one era per
   call, so each stays well inside the 6-minute limit however many books get
   added. The browser runs these itself, newest era first, whenever a book has
   a sheet link and no built file; the pill's Reload button re-reads them all. */
function CUBE_rebuildHistory(opts){
  opts = opts || {};
  var line = (opts.line === 'rmx') ? 'rmx' : 'agg';
  var era  = ovcEra_(opts.era) || ovcEras_()[0];       // no era named -> the newest book
  var page = ovcEraPage_(era, line);
  var what = (line === 'agg' ? 'Aggregates' : 'Ready-Mix') + ' history (' + (era.label || era.id) + ')';
  var t0 = new Date().getTime();

  /* Fail with something a non-technical user can act on. Without this the
     Overview's "Load history" button reports Apps Script's own wording, which
     does not say WHICH sheet is missing or where to set it. */
  var sid = '';
  try { sid = page ? getSpreadsheetIdForPage_(page) : ''; } catch (e) { sid = ''; }
  if (!sid) return { ok:false, line:line, era:era.id,
    error: 'The ' + what + ' sheet has not been chosen yet. '
         + 'Open \u2699 Data sheet, paste its link, save, then press Load history again.' };

  var cube;
  try { cube = (line === 'agg') ? ovcHistAgg_(page) : ovcHistRmx_(page); }
  catch (e){ return { ok:false, line:line, era:era.id,
                      error: (e && e.message) ? e.message : String(e) }; }
  ovcHistWrite_(line, era.id, cube);
  try {
    PropertiesService.getScriptProperties()
      .setProperty(OVCUBE_TOK_PROP_, String(parseInt(ovcHistTok_(), 10) + 1));
  } catch (e) {
    /* The rebuilt history is already written. Without the token bump no client
       is told to go and get it, so the work is done and invisible. */
    APP_log('warn', 'CUBE.rebuildHistory', 'history rebuilt but the token did not move — ' +
            'clients will keep the cube they have', { line: line, era: era.id, error: String(e) });
  }
  var s = {}; cube.rows.forEach(function(r){ s[r[0]] = true; });
  var ym = Object.keys(s).map(Number).sort(function(a, b){ return a - b; });
  return { ok:true, line:line, era:era.id, label:era.label || era.id,
           rows:cube.rows.length, skipped:cube.skipped || 0,
           months:ym.length, from:ym[0] || null, to:ym[ym.length - 1] || null,
           seconds: Math.round((new Date().getTime() - t0) / 100) / 10 };
}

/* Has history been built, what does it cover, and is anything unmapped?
   Unmapped is resolved against the LIVE lookups, so this is also the "which
   rows do I need to add to REGION LOOKUP / PLANT LOOKUP / PRODUCT MASTER"
   report. Cheap: history comes from Drive, live from the base pages' caches. */
/* Force the next read to re-open the lookup tabs.
 *
 * Writing a row through the Overview's own lookup editor already bumps the
 * generation, so this is for the OTHER case: someone edited PLANT LOOKUP,
 * REGION LOOKUP or PRODUCT MASTER directly in Sheets. Nothing on the server
 * knows that happened, so every cache keeps serving rows resolved against the
 * old lookup. Moving both generations on makes every cached tab, pivot, report
 * and cube chunk unreachable for every user; ovcBuild_ then re-runs and
 * re-reads the lookups (ovcReadTab_ is uncached by design).
 *
 * Facts are untouched: the history files in Drive are keyed separately by
 * ovcHistTok_, so this costs a lookup re-read and a cube rebuild, never a
 * re-read of the closed-year sheets. */
function OV_refreshLookups(){
  var out = { ok: true };
  try { out.pricevolume = APP_bumpGen_('pricevolume'); }
  catch (e){ out.ok = false; out.error = String(e); }
  try { out.rmx = APP_bumpGen_('rmx'); }
  catch (e){ out.ok = false; out.error = String(e); }
  out.gen = ovcGen_();
  return out;
}




/* ============================================================================
 * §9  DECK
 * ----------------------------------------------------------------------------
 * The Deck Builder's server half: the Slides template reader, the deck writer, and
 * the recipe that says which slide is built from what.
 *
 * The template is a Google Slides file in Drive addressed by
 * DECK_CONFIG.TEMPLATE_ID. It was never a project file, and this merge does not
 * change that.
 * ============================================================================ */

/* ---- Deck_Backend.gs ---------------------------------------------------------
   The Slides template reader and deck writer. Verbatim, less DECK_smokeTest.
   DECK_status stays: the deck has never been run end to end, so a real build is
   what decides whether Publish needs it.  */

/*****************************************************************************
 * Deck_Backend.gs - Google Slides deck builder (PHASE 0: server plumbing)
 * ---------------------------------------------------------------------------
 * WHAT THIS IS
 *   The server half of the Deck Builder page. It copies a TEMPLATE deck, then
 *   builds report slides into the copy one at a time. Titles and comment boxes
 *   stay REAL, EDITABLE Slides text; only the table / chart goes in as a
 *   picture. That is the whole point - it is not the current PNG export, which
 *   flattens the title and the comment band into the image.
 *
 * THE TEMPLATE CONTRACT (two dumb mechanisms, so the template stays editable)
 *   1. LAYOUT ID  - every template slide carries "LAYOUT: <id>" in its SPEAKER
 *                   NOTES. That is how a slide is found. Reorder or restyle the
 *                   template freely; nothing here cares about slide order.
 *   2. TOKENS     - {{TITLE}} {{COMMENT}} {{IMAGE}} {{IMAGE2}} {{LABEL1}}
 *                   {{LABEL2}} {{PAGE}} {{DECK_TITLE}} {{DECK_SUB}}
 *                   Each token is the text OF A SHAPE, never a text box laid
 *                   over a rectangle. An image slot is ONE shape: this code
 *                   reads its geometry, deletes it, and fits the picture into
 *                   exactly that rectangle.
 *
 *   Moving or resizing a box in the template moves the picture. No code change.
 *
 * ADDING A LAYOUT
 *   Copy a layout slide, resize its boxes, give it a NEW id in the speaker
 *   notes, and point a recipe row at that id. Nothing here needs editing:
 *   layouts are discovered, never listed. {{IMAGE2}}, {{LABEL1}} and {{LABEL2}}
 *   stay supported for that reason, even though no shipped layout uses them.
 *   Run DECK_validateTemplate() after any edit.
 *
 * WHY THE PICTURE IS FITTED, NEVER STRETCHED
 *   scale = min(boxW/imgW, boxH/imgH), then centred in the box. A short wide
 *   table leaves space above and below rather than distorting. The caller sends
 *   the capture's PIXEL dimensions; only their RATIO is used, so the units on
 *   either side never have to agree.
 *
 * HOW A GENERATED SLIDE IS TELLABLE FROM A LAYOUT
 *   A duplicated slide inherits the template's speaker notes, so DECK_addSlide
 *   OVERWRITES them with "SLIDE: <recipeId>". That single move buys three
 *   things: DECK_finish can delete every slide still saying "LAYOUT:",
 *   DECK_status can report what already landed, and a re-run can skip slides
 *   that are already there.
 *
 * ONE SLIDE PER CALL - DELIBERATE
 *   The 6-minute limit is per execution, not per deck. One slide per call keeps
 *   every call at 2-4s, makes a failure cost one slide instead of the deck, and
 *   lets the page show honest progress. Do not "optimise" this into a batch.
 *
 * PHASE 0 SCOPE
 *   Server only. No page yet. Run DECK_smokeTest() from the editor to prove the
 *   geometry against the real template before anything is built on top.
 *
 * SETUP (once)
 *   1. Upload Amrize_Deck_Template.pptx to Drive and open it with Google
 *      Slides ("Open with > Google Slides") so it becomes a real Slides file.
 *   2. Put that file's ID in DECK_CONFIG.TEMPLATE_ID below.
 *   3. Put the destination folder's ID in DECK_CONFIG.FOLDER_ID. That folder
 *      must be shared as EDITOR with everyone who will build decks.
 *   4. Run DECK_validateTemplate(), then DECK_smokeTest(). The second
 *      prints a deck URL. Open it.
 *
 * SCOPES: Slides + Drive. Deploy EXECUTE AS USER, so the deck belongs to
 * whoever pressed the button (same deployment TP01 already uses).
 *****************************************************************************/

/* THE TWO THINGS ANYONE EDITS ABOUT THE DECK ARE IN §1, AT THE TOP OF THIS
   FILE.  Ctrl+F  "§1 DECK".  DECK_CONFIG — the template and folder ids, the
   capture resolution — and DECK_RECIPE — which slides the monthly deck holds,
   and in what order — used to sit here, ten thousand lines down, behind the
   engine that reads them. The one part of the deck a business user is expected
   to change was the hardest part of the file to find.

   NOTHING ELSE MOVED. Everything below is the reader, the writer and the
   geometry: code, not configuration. tests/gsparity.js declares the cut, so
   this region is still proved verbatim against the file it came from apart
   from it. */


var DECK = (function () {

  /* ======================================================================
   * small helpers
   * ==================================================================== */

  function cfg_(key, prop) {
    var v = '';
    try { v = PropertiesService.getScriptProperties().getProperty(prop) || ''; }
    catch (e) { v = ''; }
    return v || DECK_CONFIG[key] || '';
  }
  function templateId_() { return cfg_('TEMPLATE_ID', DECK_CONFIG.PROP_TEMPLATE); }
  function folderId_() { return cfg_('FOLDER_ID', DECK_CONFIG.PROP_FOLDER); }

  function fail_(msg) { throw new Error(msg); }

  /* Speaker notes of a slide, '' when the slide has none. Guarded because a
     notes page or its shape can legitimately be absent. */
  function notes_(slide) {
    try {
      var np = slide.getNotesPage(); if (!np) return '';
      var sh = np.getSpeakerNotesShape(); if (!sh) return '';
      return sh.getText().asString() || '';
    } catch (e) { return ''; }
  }
  function setNotes_(slide, text) {
    try {
      var np = slide.getNotesPage(); if (!np) return;
      var sh = np.getSpeakerNotesShape(); if (!sh) return;
      sh.getText().setText(String(text == null ? '' : text));
    } catch (e) { /* notes are metadata; never fail a slide over them */ }
  }

  /* "LAYOUT: L_FULL_IMAGE" -> "L_FULL_IMAGE". '' when absent. */
  function layoutIdOf_(slide) {
    var m = String(notes_(slide)).match(/LAYOUT:\s*([A-Za-z0-9_\-]+)/);
    return m ? m[1] : '';
  }
  function recipeIdOf_(slide) {
    var m = String(notes_(slide)).match(/SLIDE:\s*(\S+)/);
    return m ? m[1] : '';
  }

  function isDocLayout_(id) {
    return DECK_CONFIG.DOC_LAYOUTS.indexOf(id) !== -1;
  }
  function isCoverLayout_(id) {
    return !!id && id === DECK_CONFIG.COVER_LAYOUT;
  }

  /* Text of a shape, '' when it has none. Shapes, images and lines all live in
     getShapes()/getPageElements(), and only some carry text. */
  function shapeText_(shape) {
    try {
      var t = shape.getText(); if (!t) return '';
      return t.asString() || '';
    } catch (e) { return ''; }
  }

  /* The ONE shape whose text carries a token. Returns null when absent - an
     optional slot (a layout with no {{COMMENT}}) is not an error. */
  function findTokenShape_(slide, token) {
    var shapes = slide.getShapes();
    for (var i = 0; i < shapes.length; i++) {
      if (shapeText_(shapes[i]).indexOf(token) !== -1) return shapes[i];
    }
    return null;
  }

  /* How many shapes on this slide carry the token. Anything but 0 or 1 is a
     template mistake worth naming out loud. */
  function countTokenShapes_(slide, token) {
    var shapes = slide.getShapes(), n = 0;
    for (var i = 0; i < shapes.length; i++) {
      if (shapeText_(shapes[i]).indexOf(token) !== -1) n++;
    }
    return n;
  }

  function rectOf_(shape) {
    return {
      x: shape.getLeft(), y: shape.getTop(),
      w: shape.getWidth(), h: shape.getHeight()
    };
  }

  /* Fit-and-centre. Ratio only, so px in / pt out is fine. */
  function fitRect_(box, imgW, imgH) {
    var iw = Number(imgW) || 0, ih = Number(imgH) || 0;
    if (!(iw > 0 && ih > 0)) { iw = box.w; ih = box.h; }
    var s = Math.min(box.w / iw, box.h / ih);
    var w = iw * s, h = ih * s;
    return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w: w, h: h };
  }

  /* Accepts a bare base64 string or a full data: URL. */
  function pngBlob_(b64, name) {
    var s = String(b64 || '');
    var comma = s.indexOf(',');
    if (s.slice(0, 5) === 'data:' && comma !== -1) s = s.slice(comma + 1);
    s = s.replace(/\s+/g, '');
    if (!s) fail_('Empty image payload for ' + (name || 'slide'));
    return Utilities.newBlob(Utilities.base64Decode(s), 'image/png',
      (name || 'slide') + '.png');
  }

  /* replaceAllText keeps the formatting of the run it replaces, which is why
     titles keep the template's font. Empty string is a legal replacement and
     is how a comment box is left blank but still styled. */
  function setToken_(slide, token, value) {
    if (!token) return;
    try { slide.replaceAllText(token, String(value == null ? '' : value)); }
    catch (e) { /* token simply absent from this layout */ }
  }


  /* ======================================================================
   * DECK_readTemplate - what layouts exist, and where their slots sit
   * ----------------------------------------------------------------------
   * The page draws its previews from this. Returning real geometry in points
   * means the in-page preview is a faithful mock of the generated slide, and
   * it follows the template when someone moves a box.
   * ==================================================================== */
  function readTemplate(templateId) {
    var id = templateId || templateId_();
    if (!id || id.indexOf('PUT_') === 0) {
      fail_('No template set. Put the Google Slides file ID in ' +
        'DECK_CONFIG.TEMPLATE_ID (see the header of Deck_Backend.gs).');
    }

    var pres;
    try { pres = SlidesApp.openById(id); }
    catch (e) {
      fail_('Cannot open the template (' + id + '). Check the ID, and that it ' +
        'is a Google Slides file rather than an unconverted .pptx.');
    }

    var pw = pres.getPageWidth(), ph = pres.getPageHeight();
    var slides = pres.getSlides();
    var layouts = [];

    for (var i = 0; i < slides.length; i++) {
      var lid = layoutIdOf_(slides[i]);
      if (!lid) continue;                       // not a tagged layout
      if (isDocLayout_(lid)) continue;          // the README

      var slots = {}, order = [];
      var TOK = DECK_CONFIG.TOKENS;
      for (var k in TOK) {
        if (!TOK.hasOwnProperty(k)) continue;
        var sh = findTokenShape_(slides[i], TOK[k]);
        if (!sh) continue;
        var r = rectOf_(sh);
        if (k === 'image' || k === 'image2') {
          /* Tell the page how big to capture, so nobody has to guess. */
          r.capturePx = Math.min(DECK_CONFIG.CAPTURE_MAX_PX,
            Math.round(r.w * DECK_CONFIG.CAPTURE_PX_PER_PT));
          /* ...and the ceiling itself, because the page must clamp the capture's
             HEIGHT to it too - see CAPTURE_MAX_PX. */
          r.maxPx = DECK_CONFIG.CAPTURE_MAX_PX;
        }
        slots[k] = r;
        order.push(k);
      }

      layouts.push({
        layoutId: lid,
        index: i,
        /* 'cover' is filled in place by create(); only 'report' layouts can be
           duplicated by addSlide, so only they belong in a recipe. */
        role: isCoverLayout_(lid) ? 'cover' : 'report',
        slots: slots,
        has: {
          title: !!slots.title, comment: !!slots.comment,
          image: !!slots.image, image2: !!slots.image2,
          label1: !!slots.label1, label2: !!slots.label2
        },
        tokens: order
      });
    }

    if (!layouts.length) {
      fail_('The template has no layout slides. Every layout slide needs ' +
        '"LAYOUT: <id>" in its speaker notes.');
    }

    var reportCount = 0;
    for (var r = 0; r < layouts.length; r++) {
      if (layouts[r].role === 'report') reportCount++;
    }
    if (!reportCount) {
      fail_('The template has a cover but no report layouts, so there is ' +
        'nothing for a recipe row to point at. Add at least one slide with ' +
        '"LAYOUT: <id>" in its speaker notes and an ' +
        DECK_CONFIG.TOKENS.image + ' box on it.');
    }

    return {
      templateId: id,
      name: pres.getName(),
      pageWidth: pw, pageHeight: ph,      // points; 720 x 405 for 16:9
      layouts: layouts,
      reportCount: reportCount,
      slideCount: slides.length
    };
  }


  /* ======================================================================
   * DECK_create - copy the template, fill the cover, park it in the folder
   * ----------------------------------------------------------------------
   * The layout slides are deliberately LEFT IN at this stage; addSlide needs
   * them to duplicate from. DECK_finish removes them at the end.
   * ==================================================================== */
  function create(opts) {
    opts = opts || {};
    var tid = opts.templateId || templateId_();
    var fid = opts.folderId || folderId_();
    if (!fid || fid.indexOf('PUT_') === 0) {
      fail_('No deck folder set. Put the Drive folder ID in ' +
        'DECK_CONFIG.FOLDER_ID (see the header of Deck_Backend.gs).');
    }

    /* Check folder access BEFORE copying, so a permissions problem does not
       leave a stray half-built deck in someone's My Drive. */
    var folder;
    try { folder = DriveApp.getFolderById(fid); folder.getName(); }
    catch (e) {
      fail_('You do not have access to the deck folder (' + fid + '). Ask for ' +
        'Editor access, then try again.');
    }

    var name = opts.name || ('Amrize Commercial Deck - ' +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM yyyy'));

    var copy;
    try { copy = DriveApp.getFileById(tid).makeCopy(name); }
    catch (e) { fail_('Could not copy the template: ' + e.message); }

    try { copy.moveTo(folder); }
    catch (e) {
      fail_('The deck was created but could not be moved into the deck ' +
        'folder - Editor access is needed on that folder. It is in your My ' +
        'Drive as "' + name + '".');
    }

    var deckId = copy.getId();
    var pres = SlidesApp.openById(deckId);
    var slides = pres.getSlides();

    /* Fill the cover in place; it is a layout like any other, so it is tagged
       SLIDE: __cover__ to survive the cleanup in finish(). */
    for (var i = 0; i < slides.length; i++) {
      if (layoutIdOf_(slides[i]) !== 'L_COVER') continue;
      setToken_(slides[i], DECK_CONFIG.TOKENS.deckTitle, opts.deckTitle || name);
      setToken_(slides[i], DECK_CONFIG.TOKENS.deckSub, opts.deckSub || '');
      setNotes_(slides[i], DECK_CONFIG.SLIDE_TAG + ' __cover__');
      break;
    }
    pres.saveAndClose();

    return {
      deckId: deckId,
      url: 'https://docs.google.com/presentation/d/' + deckId + '/edit',
      name: name
    };
  }


  /* ======================================================================
   * DECK_addSlide - ONE report slide
   * ----------------------------------------------------------------------
   * spec: { recipeId, layoutId, title, comment, label1, label2,
   *         png, imgW, imgH, png2, img2W, img2H }
   * ==================================================================== */
  function addSlide(deckId, spec) {
    spec = spec || {};
    if (!deckId) fail_('addSlide called without a deckId.');
    if (!spec.layoutId) fail_('addSlide called without a layoutId.');

    var pres = SlidesApp.openById(deckId);
    var slides = pres.getSlides();

    /* Find the layout to duplicate. Only ever match a LAYOUT: slide - never a
       SLIDE: one, or the second Fuel Recovery slide would clone the first. */
    var src = null;
    for (var i = 0; i < slides.length; i++) {
      if (layoutIdOf_(slides[i]) === spec.layoutId) { src = slides[i]; break; }
    }
    if (!src) {
      pres.saveAndClose();
      fail_('Layout "' + spec.layoutId + '" is not in this deck. Check the ' +
        'LAYOUT: line in the template\'s speaker notes.');
    }

    var slide = src.duplicate();
    slide.move(pres.getSlides().length - 1);      // duplicate lands next to src

    /* Claim it immediately: if a later step throws, finish() will not mistake
       this half-built slide for a layout and the page can retry by id. */
    setNotes_(slide, DECK_CONFIG.SLIDE_TAG + ' ' + (spec.recipeId || 'unnamed'));

    var T = DECK_CONFIG.TOKENS;
    setToken_(slide, T.title, spec.title || '');
    setToken_(slide, T.comment, spec.comment || '');   // '' = blank but styled
    setToken_(slide, T.label1, spec.label1 || '');
    setToken_(slide, T.label2, spec.label2 || '');
    setToken_(slide, T.deckSub, spec.subtitle || '');  // section dividers use it
    /* {{PAGE}} is left alone here - it is stamped in finish(), when the final
       slide order is actually known. */

    placeImage_(slide, T.image, spec.png, spec.imgW, spec.imgH, spec.recipeId);
    placeImage_(slide, T.image2, spec.png2, spec.img2W, spec.img2H, spec.recipeId);

    /* Blank every token the recipe did not fill, so a literal "{{TOKEN}}" can
       never reach the finished deck. This is not hypothetical: L_SECTION
       carries {{DECK_SUB}}, and create() only fills that on the cover - so a
       divider slide used to ship the raw token text to the meeting.
       {{PAGE}} is the one exception; finish() stamps it once the order is
       final. The image tokens are already gone - placeImage_ removes the
       shape whether or not a picture was supplied. */
    for (var t in T) {
      if (!T.hasOwnProperty(t) || t === 'page') continue;
      setToken_(slide, T[t], '');
    }

    /* Read the index BEFORE closing. A Presentation cannot be touched after
       saveAndClose() - getSlides() on a closed presentation throws, which used
       to turn every successful slide into a failed one. */
    var slideIndex = pres.getSlides().length - 1;
    pres.saveAndClose();

    return {
      recipeId: spec.recipeId || '',
      layoutId: spec.layoutId,
      slideIndex: slideIndex
    };
  }

  /* Read the slot, delete it, drop the fitted picture in its place. A slot
     with no picture supplied is emptied rather than left showing a dashed
     placeholder box in the finished deck. */
  function placeImage_(slide, token, b64, w, h, name) {
    var shape = findTokenShape_(slide, token);
    if (!shape) return;                      // layout has no such slot

    if (!b64) { shape.remove(); return; }

    var box = rectOf_(shape);
    shape.remove();

    var img = slide.insertImage(pngBlob_(b64, name));
    var r = fitRect_(box, w || img.getWidth(), h || img.getHeight());
    img.setLeft(r.x).setTop(r.y).setWidth(r.w).setHeight(r.h);
    return img;
  }


  /* ======================================================================
   * DECK_finish - park everything that is not a built slide, number the pages
   * ----------------------------------------------------------------------
   * THE TEMPLATE SLIDES ARE MOVED TO THE END, NOT DELETED. They used to be
   * removed outright, which threw away the one copy of each layout that the
   * deck was actually built from - so a slide that came out wrong could not be
   * rebuilt by hand from the layout beside it, and there was nothing left to
   * check a suspect box against. Parking them costs a few slides at the back of
   * a 43-slide deck and can be deleted in one selection by whoever wants them
   * gone.
   *
   * Everything the builder made carries "SLIDE: <id>" in its speaker notes.
   * Parking by the ABSENCE of that tag rather than the presence of "LAYOUT:"
   * also sweeps up any untagged slide left in the template, which would
   * otherwise sit in the middle of the deck.
   * ==================================================================== */
  function finish(deckId) {
    if (!deckId) fail_('finish called without a deckId.');
    var pres = SlidesApp.openById(deckId);

    var slides = pres.getSlides();
    var parked = [];
    for (var i = 0; i < slides.length; i++) {
      if (!recipeIdOf_(slides[i])) parked.push(slides[i]);
    }
    /* Each to the last index IN ORDER, so they keep their template order at the
       back instead of arriving reversed. */
    for (var p = 0; p < parked.length; p++) parked[p].move(slides.length - 1);

    /* Now the order is final, so {{PAGE}} can mean something. Only BUILT slides
       are numbered: a parked layout is not page 44 of the deck, and leaving its
       {{PAGE}} token alone is what keeps it usable as a template. */
    slides = pres.getSlides();
    var page = 0;
    for (var j = 0; j < slides.length; j++) {
      if (!recipeIdOf_(slides[j])) continue;
      setToken_(slides[j], DECK_CONFIG.TOKENS.page, String(++page));
    }
    pres.saveAndClose();

    return {
      deckId: deckId,
      url: 'https://docs.google.com/presentation/d/' + deckId + '/edit',
      /* the deck proper - what the page reports as "N slides published" - not
         counting the layouts parked behind it */
      slides: page,
      templateSlidesParked: parked.length
    };
  }


  /* ======================================================================
   * DECK_status - what already landed (drives resume + retry)
   * ==================================================================== */
  function status(deckId) {
    if (!deckId) fail_('status called without a deckId.');
    var pres = SlidesApp.openById(deckId);
    var slides = pres.getSlides();
    var built = [], layouts = [];
    for (var i = 0; i < slides.length; i++) {
      var lid = layoutIdOf_(slides[i]);
      if (lid) { layouts.push(lid); continue; }
      var rid = recipeIdOf_(slides[i]);
      if (rid && rid !== '__cover__') built.push({ recipeId: rid, index: i });
    }
    return {
      deckId: deckId,
      url: 'https://docs.google.com/presentation/d/' + deckId + '/edit',
      built: built,
      layoutsRemaining: layouts,
      total: slides.length
    };
  }

  /* ======================================================================
   * DECK_validateTemplate - check a template BEFORE building 43 slides on it
   * ----------------------------------------------------------------------
   * Anyone can edit the template, and every edit is a chance to break the two
   * things the builder relies on: a unique LAYOUT id per slide, and a token
   * living in exactly one shape. Both fail in ways that are baffling after the
   * fact - a layout silently never used, or a picture landing in the wrong
   * box. Naming them here turns a mystery into a sentence.
   * ==================================================================== */
  function validateTemplate(templateId) {
    var id = templateId || templateId_();
    var pres;
    try { pres = SlidesApp.openById(id); }
    catch (e) {
      return {
        ok: false, templateId: id, layouts: [],
        errors: ['Cannot open the template (' + id + '). Check the ID, and ' +
          'that it is a Google Slides file rather than an unconverted .pptx.'],
        warnings: []
      };
    }

    var slides = pres.getSlides();
    var errors = [], warnings = [], layouts = [], seen = {};
    var TOK = DECK_CONFIG.TOKENS;

    for (var i = 0; i < slides.length; i++) {
      var at = 'slide ' + (i + 1);
      var lid = layoutIdOf_(slides[i]);

      if (!lid) {
        warnings.push(at + ' has no "LAYOUT: <id>" in its speaker notes. It is ' +
          'ignored, and it is removed from every generated deck.');
        continue;
      }
      if (seen[lid]) {
        errors.push('Layout id "' + lid + '" is on slide ' + seen[lid] + ' AND ' +
          at + '. Ids must be unique - the builder uses the first and the ' +
          'other is never reached.');
      } else {
        seen[lid] = i + 1;
      }
      if (isDocLayout_(lid)) continue;

      var tokens = [];
      for (var k in TOK) {
        if (!TOK.hasOwnProperty(k)) continue;
        var n = countTokenShapes_(slides[i], TOK[k]);
        if (!n) continue;
        tokens.push(k);
        if (n > 1) {
          errors.push(TOK[k] + ' appears in ' + n + ' shapes on ' + at +
            ' (' + lid + '). It must be in exactly one, or the builder cannot ' +
            'tell which box the picture belongs in.');
        }
      }

      /* The cover is judged against a different checklist: it is filled in
         place by create(), never duplicated, so {{TITLE}} and {{PAGE}} are not
         things it is missing - they are things it should not have. */
      if (isCoverLayout_(lid)) {
        if (tokens.indexOf('deckTitle') === -1) {
          warnings.push(lid + ' (' + at + ') has no ' + TOK.deckTitle +
            ', so the deck name will not appear on the cover.');
        }
        if (tokens.indexOf('image') !== -1) {
          warnings.push(lid + ' (' + at + ') has an ' + TOK.image + ' box. ' +
            'The cover is never given a picture, so that box is deleted and ' +
            'leaves a gap. Remove it from the template.');
        }
      } else {
        if (tokens.indexOf('title') === -1) {
          warnings.push(lid + ' (' + at + ') has no ' + TOK.title +
            ', so its slides will have no heading.');
        }
        if (tokens.indexOf('image2') !== -1 && tokens.indexOf('image') === -1) {
          warnings.push(lid + ' (' + at + ') has ' + TOK.image2 + ' but no ' +
            TOK.image + '. Fill the first slot before adding a second.');
        }
        if (tokens.indexOf('page') === -1) {
          warnings.push(lid + ' (' + at + ') has no ' + TOK.page +
            ', so its slides will not be numbered.');
        }
      }

      layouts.push({
        layoutId: lid, slide: i + 1, tokens: tokens,
        role: isCoverLayout_(lid) ? 'cover' : 'report'
      });
    }

    if (!layouts.length) {
      errors.push('No usable layouts. Every layout slide needs ' +
        '"LAYOUT: <id>" in its speaker notes.');
    }

    var report = {
      ok: errors.length === 0, templateId: id, name: pres.getName(),
      pageWidth: pres.getPageWidth(), pageHeight: pres.getPageHeight(),
      layouts: layouts, errors: errors, warnings: warnings
    };

    Logger.log('Template "%s"  %s x %s pt', report.name,
      report.pageWidth, report.pageHeight);
    for (var a = 0; a < layouts.length; a++) {
      Logger.log('  %s  (slide %s)  tokens: %s', layouts[a].layoutId,
        layouts[a].slide, layouts[a].tokens.join(', ') || 'none');
    }
    for (var b = 0; b < errors.length; b++) Logger.log('  ERROR   %s', errors[b]);
    for (var c = 0; c < warnings.length; c++) Logger.log('  warning %s', warnings[c]);
    Logger.log(report.ok ? 'Template is usable.' : 'Template has errors - fix before building.');

    return report;
  }

  return {
    readTemplate: readTemplate, validateTemplate: validateTemplate,
    create: create, addSlide: addSlide, finish: finish, status: status
  };
})();


/*****************************************************************************
 * Thin globals - google.script.run can only reach top-level functions.
 * Same wrapper pattern as PV_Backend.gs / RMX_Backend.gs.
 *****************************************************************************/
function DECK_readTemplate(templateId) { return DECK.readTemplate(templateId); }
function DECK_validateTemplate(templateId) { return DECK.validateTemplate(templateId); }
function DECK_create(opts) { return DECK.create(opts); }
function DECK_addSlide(deckId, spec) { return DECK.addSlide(deckId, spec); }
function DECK_finish(deckId) { return DECK.finish(deckId); }
function DECK_status(deckId) { return DECK.status(deckId); }


/* ---- Deck_Recipe.gs ----------------------------------------------------------
   Which slide is built from what. Southwest Land and Docks refine the Southwest
   MARKET rather than naming a market that does not exist.  */

/*****************************************************************************
 * Deck_Recipe.gs - WHICH slides the monthly deck contains, and in what order.
 * ---------------------------------------------------------------------------
 * THIS FILE IS CONFIG, NOT CODE. Adding, removing or reordering a slide is an
 * edit to the array below - nothing else in the suite needs to change. The
 * Deck Builder page reads it, shows it as a checklist, and builds it top to
 * bottom.
 *
 * It was transcribed from the July 2026 pack ("AGG - CENTRAL CANADA - MTDYTD
 * Prep.pdf", 43 slides at 720 x 405 pt), so the default output matches the
 * deck that is built by hand today.
 *
 * EVERY ROW
 *   id       unique, stable. It is written into the generated slide's speaker
 *            notes as "SLIDE: <id>", which is how DECK_status knows what
 *            already landed and how a single failed slide is retried without
 *            rebuilding the deck. NEVER reuse an id for a different slide.
 *   source   which page produces the content block. Must match an id passed to
 *            AmrDeckSource.register() - see Deck_Sources.html.
 *   market   passed straight through to that source. The spelling is the one
 *            THAT PAGE uses, which is not the same across pages: the Southwest
 *            is 'Southwest' to Price & Volume and 'HNS_SW' to Ready-Mix. The
 *            canonical mapping lives in OVERVIEW.MARKETS (Config.gs).
 *   refine   optional. A narrowing WITHIN that market, passed through to the
 *            source, which decides what it means. Today only 'pv' reads it, as
 *            the Land / Docks split of the Southwest (see those rows below).
 *   period   'MTD' | 'YTD'. Omitted where the slide shows both.
 *   layout   a LAYOUT id from the template's speaker notes.
 *   title    the real, editable Slides heading. NOT baked into the picture.
 *   optional true = shown unticked in the Plan stage, so it is only built when
 *            someone asks for it that month.
 *
 * WHY THE TOP 10 CUSTOMER SLIDES ARE L_FULL_IMAGE
 *   That slide is two stacked tables, MTD over YTD. The Price & Volume page
 *   already exports both as ONE content block, so one picture in the full-width
 *   slot reproduces it exactly and needs no new layout. The alternative - two
 *   pictures in an L_FULL_STACK with {{LABEL1}} / {{LABEL2}} - is supported by
 *   Deck_Backend.gs but that layout is NOT in the shipped template. To switch:
 *   add the layout to the template, then change 'layout' on these five rows.
 *
 * MARKET COVERAGE NOTE
 *   The source pack has no AGG summary slide for North, and no Top 10 slide for
 *   Central Canada. That is copied faithfully rather than "corrected" - if the
 *   business wants them, add the rows.
 *****************************************************************************/

/* THE RECIPE ITSELF IS IN §1 — Ctrl+F "§1 DECK". The list of slides moved to
   the top of the file in chunk 22; the checking below did not, because it is
   code. */


/*****************************************************************************
 * DECK_getRecipe - the recipe, checked, for the page.
 * ---------------------------------------------------------------------------
 * The checking is the point. A duplicate id silently overwrites another
 * slide's status and makes a retry fix the wrong row; a row with no layout
 * fails at slide 30 of 43. Both are cheap to catch here and baffling to
 * diagnose later.
 *****************************************************************************/
function DECK_getRecipe() {
  var seen = {}, problems = [], rows = [];

  for (var i = 0; i < DECK_RECIPE.length; i++) {
    var r = DECK_RECIPE[i], at = 'row ' + (i + 1);

    if (!r.id) { problems.push(at + ' has no id.'); continue; }
    if (seen[r.id]) {
      problems.push('Duplicate id "' + r.id + '" (' + at + ' and row ' +
        seen[r.id] + '). Ids must be unique - they are what a retry targets.');
      continue;
    }
    seen[r.id] = i + 1;

    if (!r.source) problems.push(r.id + ' has no source.');
    if (!r.layout) problems.push(r.id + ' has no layout.');
    if (!r.title)  problems.push(r.id + ' has no title.');
    if (r.period && r.period !== 'MTD' && r.period !== 'YTD') {
      problems.push(r.id + ' has period "' + r.period + '" - expected MTD or YTD.');
    }

    rows.push({
      id: r.id, source: r.source, market: r.market || '',
      /* a within-market narrowing, e.g. Southwest -> Land. The source decides
         what it means; nothing here needs to know. */
      refine: r.refine || '',
      period: r.period || '', layout: r.layout, title: r.title,
      subtitle: r.subtitle || '', group: r.group || 'Other',
      optional: !!r.optional
    });
  }

  return { rows: rows, count: rows.length, problems: problems };
}




/* ============================================================================
 * §10  SMALL PAGES
 * ----------------------------------------------------------------------------
 * The three pages with a backend small enough to have no namespace of its own:
 * the shared EBITDA workbooks, TP01's mail sender, and the Inventory Report.
 *
 * TP01 mail is sent by whoever DEPLOYED the app, because appsscript.json pins
 * "executeAs": "USER_DEPLOYING". That also makes getUserProperties() the
 * deployer's for everybody, which is why the market → email map is ONE shared
 * list. Chunk 11 corrected the page copy that said otherwise.
 * ============================================================================ */

/* ---- Kpi_Backend.gs ----------------------------------------------------------
   The shared EBITDA workbooks in Drive. One upload replaces the file for
   everyone, which is why archiving stamps who did it.  */

/*****************************************************************************
 * AMRIZE KPI WORKBOOKS — shared backend
 * ---------------------------------------------------------------------------
 * The two EBITDA workbooks (main "AGG & RMX EBITDA Report" + the
 * "Manitoba / Saskatchewan" one) feed the SAP/USGAAP KPI cards on the
 * Price & Volume, Product Segment and Overview pages.
 *
 * They used to live on each person's own device, so everybody had to
 * upload them separately. Now:
 *
 *   • the uploader's BROWSER parses the workbook and sends only the small
 *     set of numbers behind the cards (a few KB) — never the file contents;
 *   • those numbers are saved as ONE json file in the shared Drive folder,
 *     so every user on every device sees the same thing;
 *   • the raw .xlsx is archived beside it, purely so anyone can open Drive
 *     and see / download exactly which file is in use;
 *   • the numbers are cached on the server and on each device, keyed by a
 *     data version — the same pattern the report tables use. Uploading
 *     bumps the version, which instantly strands every old copy.
 *
 * ONE-TIME SETUP: Config.gs -> APP_CONFIG.KPI_FOLDER_ID must hold the id of
 * a Drive folder shared with the team as Editor.
 *****************************************************************************/
var KPI = (function () {

  var PK_JSON = 'KPI_VALUES_FILE';                    // Drive id of the values json
  var PK_FILE = { main: 'KPI_XLSX_MAIN', mbsk: 'KPI_XLSX_MBSK' };
  var FILE_LABEL = { main: 'AGG & RMX EBITDA Report', mbsk: 'Manitoba Saskatchewan' };

  function folder_() {
    var id = APP_CONFIG.KPI_FOLDER_ID;
    if (!id) throw new Error('The shared KPI folder isn\u2019t set up yet. Paste the folder id into ' +
      'Config.gs \u2192 KPI_FOLDER_ID.');
    try { return DriveApp.getFolderById(id); }
    catch (e) { throw new Error('Couldn\u2019t open the shared KPI folder. Check KPI_FOLDER_ID in ' +
      'Config.gs, and that the folder is shared with you.'); }
  }

  function trash_(id) {
  if (!id) return;
  try { DriveApp.getFileById(id).setTrashed(true); }
  catch (e) { APP_log('warn', 'DECK.trash', 'could not trash the file — it stays in the deck folder',
                      { fileId: id, error: String(e) }); }
}

  /* ok:false means the file EXISTS but this account couldn't read it
     (folder not shared with them) — treated differently from "nothing
     uploaded", and never cached. */
  function readValues_() {
    var id = PropertiesService.getScriptProperties().getProperty(PK_JSON);
    if (!id) return { values: null, ok: true };
    try { return { values: JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString()), ok: true }; }
    catch (e) { return { values: null, ok: false, err: (e && e.message ? e.message : String(e)) }; }
  }

  function writeValues_(values) {
    var props = PropertiesService.getScriptProperties();
    var f = folder_().createFile('KPI card values.json', JSON.stringify(values), 'application/json');
    trash_(props.getProperty(PK_JSON));
    props.setProperty(PK_JSON, f.getId());
  }

  /* read -> change -> write, all inside one lock, so two people replacing
     DIFFERENT workbooks at the same time can't overwrite each other. */
  function mutate_(fn) {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var r = readValues_();
      if (!r.ok) throw new Error('The shared KPI file couldn\u2019t be opened (' + r.err +
        '). Check that the shared folder is shared with you, then try again.');
      var values = r.values || {};
      fn(values);
      writeValues_(values);
      return values;
    } finally { lock.releaseLock(); }
  }

  /* ---------- what the pages call ---------- */

  /* knownGen = the version this device already holds. When it matches, the
     answer is 4 bytes instead of the whole payload. */
  function getKpiValues(knownGen) {
    var gen = APP_getGen_('kpi');
    if (knownGen && String(knownGen) === String(gen)) return { generation: gen, cached: true };

    var key = 'kpi|g' + gen + '|values';
    var hit = APP_cacheGet_(key);
    if (hit) return { generation: gen, values: hit.values };

    var r = readValues_();
    if (r.ok) APP_cachePut_(key, { values: r.values });   // never cache a failed read
    var out = { generation: gen, values: r.values };
    if (!r.ok) out.problem = 'The shared KPI numbers couldn\u2019t be opened for this account (' +
      r.err + ') \u2014 ask for access to the shared Drive folder.';
    return out;
  }

  /* Replace ONE workbook's slice of the numbers. The other book is left
     exactly as it was, so people can update either file on its own. */
  function saveKpiBook(book, sliceJson) {
    if (book !== 'main' && book !== 'mbsk') throw new Error('Unknown workbook \u201c' + book + '\u201d.');
    var slice;
    try { slice = JSON.parse(sliceJson); } catch (e) { slice = null; }
    if (!slice || !slice.plant || !slice.rmx)
      throw new Error('The workbook arrived incomplete \u2014 please try the upload again.');
    try { slice.by = Session.getActiveUser().getEmail() || ''; } catch (e) { slice.by = ''; }

    var values = mutate_(function (v) { v[book] = slice; });
    var gen = APP_bumpGen_('kpi');
    APP_cachePut_('kpi|g' + gen + '|values', { values: values });
    return { generation: gen, values: values };
  }

  /* Keep the actual .xlsx in the folder so anyone can see what is in use.
     Best effort: the cards already work without it. */
  function archiveKpiFile(book, fileName, b64) {
    if (book !== 'main' && book !== 'mbsk') return false;
    var bytes = Utilities.base64Decode(b64);
    var name = 'KPI \u2014 ' + FILE_LABEL[book] + ' (in use).xlsx';
    var blob = Utilities.newBlob(bytes,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name);
    var props = PropertiesService.getScriptProperties();
    var f = folder_().createFile(blob);
    trash_(props.getProperty(PK_FILE[book]));
    props.setProperty(PK_FILE[book], f.getId());
    return true;
  }

  /* Remove one workbook for everyone. */
  function clearKpiBook(book) {
    if (book !== 'main' && book !== 'mbsk') throw new Error('Unknown workbook \u201c' + book + '\u201d.');
    var values = mutate_(function (v) { delete v[book]; });
    var props = PropertiesService.getScriptProperties();
    trash_(props.getProperty(PK_FILE[book]));
    props.deleteProperty(PK_FILE[book]);
    var gen = APP_bumpGen_('kpi');
    APP_cachePut_('kpi|g' + gen + '|values', { values: values });
    return { generation: gen, values: values };
  }

  return { getKpiValues: getKpiValues, saveKpiBook: saveKpiBook,
           archiveKpiFile: archiveKpiFile, clearKpiBook: clearKpiBook };
})();

/* Top-level wrappers the pages call via google.script.run. */
function getKpiValues(knownGen) {
  try {
    var out = KPI.getKpiValues(knownGen);
    console.log('[KPI] getKpiValues: gen ' + out.generation + (out.cached ? ' \u00b7 unchanged' : ' \u00b7 sent'));
    return out;
  } catch (err) {
    console.error('[KPI] getKpiValues failed: ' + (err && err.message ? err.message : err));
    throw err;
  }
}
function saveKpiBook(book, sliceJson) {
  try {
    console.log('[KPI] saveKpiBook: ' + book + ' \u00b7 ' + (sliceJson ? sliceJson.length : 0) + ' chars');
    var out = KPI.saveKpiBook(book, sliceJson);
    console.log('[KPI] saveKpiBook: shared with everyone \u00b7 gen ' + out.generation);
    return out;
  } catch (err) {
    console.error('[KPI] saveKpiBook failed: ' + (err && err.message ? err.message : err));
    throw err;
  }
}
function archiveKpiFile(book, fileName, b64) {
  try {
    var ok = KPI.archiveKpiFile(book, fileName, b64);
    console.log('[KPI] archiveKpiFile: ' + book + ' stored in the shared folder');
    return ok;
  } catch (err) {
    console.error('[KPI] archiveKpiFile failed: ' + (err && err.message ? err.message : err));
    throw err;
  }
}
function clearKpiBook(book) {
  try {
    var out = KPI.clearKpiBook(book);
    console.log('[KPI] clearKpiBook: ' + book + ' removed for everyone \u00b7 gen ' + out.generation);
    return out;
  } catch (err) {
    console.error('[KPI] clearKpiBook failed: ' + (err && err.message ? err.message : err));
    throw err;
  }
}

/* ---- TP01_Backend.gs ---------------------------------------------------------
   TP01 mail. Sends as the DEPLOYING account, so the recipient map is one shared
   list — see the section banner.  */

/*****************************************************************************
 * TP01-ZIPR Transfer Price Tool — backend
 * ---------------------------------------------------------------------------
 * Three small functions:
 *   TP_sendMarketEmail  : the page builds the per-market Excel in the browser
 *                         (SheetJS, base64) and sends it here to be mailed.
 *   TP_getRecipients    : the shared market → email map (see below).
 *   TP_saveRecipient    : save/update one market's recipient in that map.
 *
 * SENDER IDENTITY: mail goes out as whoever the web app EXECUTES AS, and
 * appsscript.json pins that to "executeAs": "USER_DEPLOYING" - so every
 * TP01 email is sent by the account that DEPLOYED the app.
 *
 * That also makes getUserProperties() the deployer's for everybody, so the
 * market -> email map below is ONE shared list: editing a market's recipient
 * changes it for everyone.
 *****************************************************************************/

var TP_RECIP_KEY = 'TP01_RECIPIENTS';

function TP_getRecipients() {
  try {
    var raw = PropertiesService.getUserProperties().getProperty(TP_RECIP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

function TP_saveRecipient(market, email) {
  var props = PropertiesService.getUserProperties();
  var map;
  try { map = JSON.parse(props.getProperty(TP_RECIP_KEY) || '{}'); } catch (e) { map = {}; }
  market = String(market || '').trim();
  email  = String(email  || '').trim();
  if (!market) throw new Error('Missing market name.');
  if (email) map[market] = email;
  else       delete map[market];          // cleared box = forget it
  props.setProperty(TP_RECIP_KEY, JSON.stringify(map));
  return { ok: true };
}

function TP_sendMarketEmail(o) {
  if (!o || !o.to || !o.xlsxB64) throw new Error('Missing recipient or file.');
  var blob = Utilities.newBlob(
    Utilities.base64Decode(o.xlsxB64),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    o.filename || 'Transfer_Price_Report.xlsx'
  );
  MailApp.sendEmail({
    to: String(o.to),
    subject: String(o.subject || 'Transfer Price Report'),
    htmlBody: String(o.htmlBody || ''),
    attachments: [blob]
  });
  return { ok: true };
}

function TP_sendCombinedEmail(o) {
  if (!o || !o.to || !o.files || !o.files.length) throw new Error('Missing recipient or files.');
  var mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  var blobs = o.files.map(function (f) {
    return Utilities.newBlob(Utilities.base64Decode(f.xlsxB64), mime,
                             f.filename || 'Transfer_Price_Report.xlsx');
  });
  MailApp.sendEmail({
    to: String(o.to),
    subject: String(o.subject || 'Transfer Price Report'),
    htmlBody: String(o.htmlBody || ''),
    attachments: blobs
  });
  return { ok: true };
}

/* ---- IR_Backend.gs -----------------------------------------------------------
   The Inventory Report's source setting. The smallest backend in the file.  */

/*****************************************************************************
 * INVENTORY REPORT — backend (namespaced IR)
 * ---------------------------------------------------------------------------
 * The Inventory Report page displays a PDF stored on Google Drive.
 * Which file to show is stored in Script Properties (same persistent store
 * as the data-sheet setting), so it is shared by every user of the app and
 * survives reloads/redeploys.
 *
 * NOTE: the backend deliberately does NOT touch DriveApp — the viewer's own
 * browser loads the file through Drive's /preview endpoint, so no Drive
 * OAuth scope is needed here. We only parse, store, and return the file ID
 * plus the derived URLs.
 *****************************************************************************/
var IR = (function () {

  var PROP_KEY = 'INVENTORY_REPORT_SOURCE';   // JSON: { fileId, label, savedAt }

  /* Accepts a Drive link in any common shape, or a bare file ID:
   *   https://drive.google.com/file/d/<ID>/view?usp=sharing
   *   https://drive.google.com/file/d/<ID>/preview
   *   https://drive.google.com/open?id=<ID>
   *   https://drive.google.com/uc?id=<ID>
   *   <ID>
   */
  function extractFileId_(input) {
    var s = String(input == null ? '' : input).trim();
    if (!s) return '';
    var m = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
    return '';
  }

  /* Build the UI payload from a stored record. */
  function payload_(rec) {
    return {
      configured:  true,
      fileId:      rec.fileId,
      label:       rec.label || '',
      savedAt:     rec.savedAt || '',
      previewUrl:  'https://drive.google.com/file/d/' + rec.fileId + '/preview',
      viewUrl:     'https://drive.google.com/file/d/' + rec.fileId + '/view',
      downloadUrl: 'https://drive.google.com/uc?export=download&id=' + rec.fileId
    };
  }

  function getSettings() {
    var raw = PropertiesService.getScriptProperties().getProperty(PROP_KEY) || '';
    if (!raw) return { configured: false };
    var rec;
    try { rec = JSON.parse(raw); } catch (e) { rec = null; }
    if (!rec || !rec.fileId) return { configured: false };
    return payload_(rec);
  }

  /* Save a new source (link/ID + optional display label). */
  function saveSource(input, label) {
    var id = extractFileId_(input);
    if (!id) throw new Error('That doesn\u2019t look like a Google Drive link or file ID. In Drive, right-click the PDF \u2192 Share \u2192 Copy link, and paste it here.');

    var rec = {
      fileId:  id,
      label:   String(label == null ? '' : label).trim(),
      savedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d, yyyy HH:mm')
    };
    PropertiesService.getScriptProperties().setProperty(PROP_KEY, JSON.stringify(rec));
    return payload_(rec);
  }

  return { getSettings: getSettings, saveSource: saveSource };
})();

/* ---- top-level wrappers for google.script.run ---- */
function IR_getSettings()             { return IR.getSettings(); }
function IR_saveSource(input, label)  { return IR.saveSource(input, label); }



/* ============================================================================
 * §11  TRIGGERS + EDITOR ENTRY POINTS
 * ----------------------------------------------------------------------------
 * Everything in this file that is reached from OUTSIDE the repo. Nothing here has
 * a caller a grep can find, and every one of them is load-bearing anyway:
 *
 *   qlikSyncCheck    the time-driven trigger target. THE WHOLE DATA PIPELINE runs
 *                    through it. Deleting it because grep found no caller would
 *                    silently stop every page's data from ever updating again,
 *                    and nothing would error. Set ONE hourly trigger on it.
 *   qlikMarkCurrent  run once from the editor after the trigger is set up, so the
 *                    first firing has stamps to compare. Needed again whenever
 *                    the trigger is rebuilt.
 *   qlikStamps       what the next check will compare, and what it will do.
 *                    tests/qliksync.js exercises it — three checks.
 *   qlikSyncNow      the only manual recovery path when the trigger misfires.
 *
 * The other functions in this file that are run by hand rather than called are
 * signposted where they live, because they belong with the code they report on:
 * APP_verifyPermissions (§4), clearRetiredOverrides (§1), getSaskRatesStatus (§6)
 * and the six DECK_* wrappers (§9).
 *
 * RMX_whoWins used to be on that list and is gone. It answered "is a second .gs
 * in this project also defining RMX and winning" — a question that stopped
 * having an answer the moment there was one .gs. THAT is why it went, not
 * because §2's logging replaced it: a diagnostic that can no longer observe
 * anything is not superseded, it is unreachable.
 *
 * THIS IS WHY THE SECTION EXISTS. There is not one ScriptApp.newTrigger in the
 * codebase — the trigger is configured by hand in the Apps Script UI, so nothing
 * in the repo points at it. Ctrl+F "§11" is the substitute for that missing
 * reference.
 * ============================================================================ */

/* ---- QlikSync.gs -------------------------------------------------------------
   The four entry points. The QLIKSYNC engine they drive is in §5.  */

/* ==========================================================================
 * THE ONLY THING THAT STARTS A SYNC: one hourly trigger.
 * --------------------------------------------------------------------------
 * Set ONE time-driven trigger on qlikSyncCheck, at whatever interval suits.
 *
 * It looks at when each export file was last modified. The ones that have not
 * changed since they were last synced are skipped outright — nothing opened,
 * nothing written, every page still serving from cache. Only a genuinely new
 * export costs anything, and only for the page it feeds.
 *
 * Writing to a workbook moves its modified time, and that IS the data version
 * every open page is watching — so the prompt appears on its own, with
 * nothing here having to tell anybody. See AmrFresh in Shell.html.
 * ======================================================================== */
var QLIK_STAMP_KEY = 'QLIK_FILE_STAMPS';

/* Each export is checked on its own, so a re-exported Aggregates file costs an
   Aggregates sync and nothing else. */
function qlikSyncCheck() {
  /* THE TRIGGER TARGET. Nothing in the repo points at it (there is not one
     ScriptApp.newTrigger in the codebase — see §11's banner), it runs hourly
     with nobody watching, and every page's data depends on it. The log line is
     the only account of a run that will ever exist, which is why the entry is
     logged before anything can throw. */
  var t0 = Date.now();
  APP_log('info', 'QLIKSYNC.check', 'trigger fired');
  var props = PropertiesService.getScriptProperties();
  var seen = {};
  try { seen = JSON.parse(props.getProperty(QLIK_STAMP_KEY) || '{}'); }
  catch (e) {
    /* NOT SILENT (§7). A corrupt stamp property means every source looks
       changed, so the next line re-syncs all of them — minutes of Drive work
       that reads as a normal busy run. */
    APP_log('warn', 'QLIKSYNC.check', 'stamps unreadable — every source will look changed',
            { error: String(e) });
    seen = {};
  }

  var sources;
  try { sources = QLIKSYNC.sources(); }
  catch (e) {
    APP_log('error', 'QLIKSYNC.check', 'could not list the sources — the pipeline did not run',
            { ms: Date.now() - t0, error: String(e && e.message || e) });
    return { ok: false, error: e.message };
  }

  var out = { ok: true, changed: [], unchanged: [], failed: [] };

  sources.forEach(function (src) {
    var stamp;
    try {
      stamp = String(DriveApp.getFileById(src.id).getLastUpdated().getTime());
    } catch (e) {
      out.failed.push(src.label + ': cannot read the file (' + e.message + ')');
      out.ok = false;
      return;
    }
    if (stamp === seen[src.key]) { out.unchanged.push(src.label); return; }

    var res = QLIKSYNC.run(src.scope);

    /* Remember the stamp unless the run fell over completely (file unreadable,
       another sync holding the lock). A run that FINISHED but wrote a bad tab
       is not retried: that tab will be just as broken in fifteen minutes, and
       re-syncing forever neither fixes it nor tells anybody. It is logged. */
    if (res.error) {
      out.failed.push(src.label + ': ' + res.error);
      out.ok = false;
    } else {
      seen[src.key] = stamp;
      out.changed.push(src.label);
      if (!res.ok) {
        out.failed.push(src.label + ': ' + JSON.stringify(res.failed));
        /* A run that FINISHED but wrote a bad tab is deliberately not retried
           (see above), so this line is the only record that it happened. */
        APP_log('warn', 'QLIKSYNC.check', 'synced, but some tabs did not write',
                { source: src.label, failed: res.failed });
      }
    }
  });

  props.setProperty(QLIK_STAMP_KEY, JSON.stringify(seen));
  APP_log(out.failed.length ? 'error' : 'info', 'QLIKSYNC.check', 'done',
          { ms: Date.now() - t0, changed: out.changed.length,
            unchanged: out.unchanged.length, failed: out.failed.length,
            detail: out.failed.length ? out.failed.join(' | ') : '' });
  return out;
}

/* Run this once from the editor after setting the trigger up, so the FIRST
   check has something to compare against.

   Without it the first firing sees no stamps at all, treats all three exports
   as new and syncs every one of them — minutes of work replacing data the
   sheet very likely already has. Harmless, just slow and pointless. */
function qlikMarkCurrent() {
  var seen = {};
  QLIKSYNC.sources().forEach(function (src) {
    try { seen[src.key] = String(DriveApp.getFileById(src.id).getLastUpdated().getTime()); }
    catch (e) {
      APP_log('warn', 'QLIKSYNC.markCurrent', 'no stamp for this source — it will look changed ' +
              'on the next check and be re-synced', { source: src.key, error: String(e) });
    }
  });
  PropertiesService.getScriptProperties().setProperty(QLIK_STAMP_KEY, JSON.stringify(seen));
  return 'Marked ' + Object.keys(seen).length + ' export(s) as already synced.';
}

/* What the check is about to compare, for a look from the editor. */
function qlikStamps() {
  var props = PropertiesService.getScriptProperties(), seen = {};
  try { seen = JSON.parse(props.getProperty(QLIK_STAMP_KEY) || '{}'); } catch (e) {}
  return QLIKSYNC.sources().map(function (src) {
    var now = '';
    try { now = String(DriveApp.getFileById(src.id).getLastUpdated().getTime()); } catch (e) { now = 'unreadable'; }
    return { source: src.label, feeds: src.scope, lastSynced: seen[src.key] || '(never)',
             fileNow: now, willSync: now !== seen[src.key] };
  });
}

/* Manual sync, from the editor only. Nothing in the UI calls this.
   Records the stamps of whatever it covered, so the next check does not
   immediately redo the same work. */
function qlikSyncNow(scope) {
  var want = (typeof scope === 'string' && scope) ? scope : 'all';
  var res  = QLIKSYNC.run(want);
  if (!res.error) {
    var props = PropertiesService.getScriptProperties(), seen = {};
    try { seen = JSON.parse(props.getProperty(QLIK_STAMP_KEY) || '{}'); }
    catch (e) {
      /* Not silent (§7). Starting from {} means only the sources this run
         covered get written back and every OTHER stamp is wiped, so the next
         hourly check re-syncs the lot — which is the one thing this function
         says it exists to prevent. */
      APP_log('warn', 'QLIKSYNC.syncNow', 'stamps unreadable — the other sources will be ' +
              're-synced on the next check', { scope: want, error: String(e) });
      seen = {};
    }
    QLIKSYNC.sources().forEach(function (src) {
      if (want !== 'all' && src.scope !== want) return;
      try { seen[src.key] = String(DriveApp.getFileById(src.id).getLastUpdated().getTime()); }
      catch (e) {
        APP_log('warn', 'QLIKSYNC.syncNow', 'no stamp for this source — it will be re-synced ' +
                'on the next check', { source: src.key, error: String(e) });
      }
    });
    props.setProperty(QLIK_STAMP_KEY, JSON.stringify(seen));
  }
  return res;
}
