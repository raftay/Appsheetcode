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
 * EVERYTHING YOU NEED IN ORDER NOT TO BREAK THIS FILE IS IN IT — below, and in
 * the section banners. The only other file it speaks to is app.html, which is
 * the whole client and carries its own.
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
 *                               the chunked cache, the SB reader, and the
 *                               period helpers every header read goes through.
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
 *   §10  SMALL PAGES .......... KPI workbooks, the Inventory Report and the mail
 *                               watch that publishes it, and TP01 — its mail
 *                               sender, the comparison engine the page and the
 *                               trigger share, an .xlsx writer, and the mail
 *                               watch that reports the exceptions weekly.
 *   §11  TRIGGERS ............. everything reached from outside this file.
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
 * 4. toNum_ / norm_ / gk_ HAVE DRIFTED, AND THEY STAY THAT WAY. Not three
 *    copies — SIX toNum_, SIX norm_ and two gk_, across
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
 *    nothing failing. So: DO NOT UNIFY THEM.
 *
 * 5. A COLUMN HEADER NAMES A PERIOD, AND IT NAMES IT FOUR DIFFERENT WAYS.
 *    "2026 Volume", "CY Volume", "Total Revenue - 2025", "Total Revenue -PY" —
 *    all four are live, the exports and the workbooks disagree with each other
 *    right now, and both sides change without notice. Read a header through §3's
 *    APP_period_ / APP_yearCols_ and never by naming a period back at it. A
 *    lookup that names one returns -1 the day it changes, toNum_ turns the
 *    missing cell into 0, and the page publishes a full set of zeroes under
 *    correct-looking headings without failing.
 *
 *    AND WHICH YEAR IS CURRENT COMES FROM THE DATA. "CY" names no year, so a
 *    reader keying cells by year has nothing to key on: it comes off the Year
 *    column (Aggregates) or the year on a Bill Month (Ready-Mix). Never off the
 *    calendar, and never off the header alone — an export can reuse last year's
 *    template.
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
 *     APP_CONFIG.PAGES.segment.MARKETS               the Product Segment's markets
 *     APP_CONFIG.QLIK_SYNC.*                         the three QlikView exports
 *     APP_CONFIG.KPI_FOLDER_ID                       where the EBITDA books live
 *     APP_CONFIG.INVENTORY_MAIL                      the mailbox the Inventory
 *                                                    Report publishes itself from
 *     APP_CONFIG.TP01_MAIL                           the mailbox the weekly SAP
 *                                                    transfer-price file arrives in
 *     APP_CONFIG.LOGO_URL                            the logo every export uses
 *     APP_CONFIG.LOG_LEVEL                           how much the server logs (§2)
 *     APP_CONFIG.CUBE.ERAS                           the closed-year books
 *     APP_CONFIG.CUBE.FLOOR                          oldest month the slider offers
 *     APP_CONFIG.CUBE.COVERAGE                       the PPI weight floors
 *     OVERVIEW.MARKETS                               the canonical market list, and
 *                                                    its PV / RMX spellings
 *     APP_EXTRA_SOURCES                              extra sheets a page's ⚙ offers
 *     DECK_CONFIG                                    the deck template and folder,
 *                                                    the capture resolution, and the
 *                                                    three Script Properties the page
 *                                                    saves an arrangement into
 *     DECK_RECIPE                                    WHICH slides the monthly deck
 *                                                    holds, and in what order — the
 *                                                    DEFAULT, editable from the page
 *
 *   THE LAST TWO ARE THE DECK'S CONFIG OBJECTS. They sit here rather than
 *   behind the engine that reads them, ten thousand lines down. §9 still holds
 *   everything about the deck that is code.
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
 *     §8   ovcCovTok_              hashes §1's COVERAGE into the cube's
 *                                  generation, because the browser pools with
 *                                  those thresholds and they travel in a
 *                                  CACHED manifest. Not a tunable — the thing
 *                                  that makes editing one take effect
 *     §10  TP_RECIP_KEY            names the PROPERTY the TP01 recipient map is
 *                                  stored in — the map itself is not in this file
 *     §10  TP_AUTO_KEY            same, for the AUTOMATED TP01 email's recipients
 *                                  and switches. A SCRIPT property, not a user one
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
       and Product Segment sync as well.

       These are the .xls files themselves, not folders and not the workbooks
       they are written into. QlikSync converts each to a temporary Google
       Sheet to read it and throws that away afterwards. */
    AGG_FILE_ID: '19ptynrhtzC-Noi71znNbVIJw8GDmPUxZ',   // → Price & Volume
    RMX_FILE_ID: '1wUb82e1PVxstddK9IE2VxYLSQEicVAGK',   // → Ready-Mix (main, extra, assoc)
    SEG_FILE_ID: '1d1XzYlENUyE6sxBewCd-Q3GpjTNzgRZH'    // → Product Segment
  },


  /* WHERE THE INVENTORY REPORT COMES FROM BY ITSELF.

     The monthly PDF arrives by mail. inventoryReportMailCheck (§11) is the
     hourly trigger target; the IRMAIL engine it drives is in §10, beside the
     IR backend whose setting it writes. Nothing here is read at load time.

     A month can bring more than one mail — the data gets corrected and the
     report is re-sent — so this is not a once-a-month job: every message that
     matches is published, newest last, the page ends up showing the newest one,
     and the folder keeps ONE file per month. A run that finds no new mail does
     nothing at all. */
  INVENTORY_MAIL: {

    /* The Drive folder every published PDF is filed into. This is the folder
       itself, not a file in it. It must be shared with whoever the web app
       runs as, with edit rights — the watch creates files in it. */
    FOLDER_ID: '1eF2SI9vCMtQ1x0lNNyCvRGrpIgvC_Znu',

    /* What a report mail's subject STARTS WITH. The period follows it
       ("… Report - Jul, 2026") and is read off the subject, never off the
       calendar: July's report routinely lands in August. When the subject names
       no month at all, the fallback is the month BEFORE the mail's send date,
       for the same reason. */
    SUBJECT_PREFIX: 'Monthly Central Region Qlik Sense Report',

    /* Who the mail is accepted from, as a Gmail `from:` term — a domain, an
       address, or several separated by OR. A subject line is not a credential:
       anybody who can reach this mailbox can send one, and the watch publishes
       what it finds to every user of the app. '' accepts anybody, and means
       exactly that. */
    FROM: 'amrize.com',

    /* How far back each check searches. It only has to cover the gap between
       two firings plus whatever downtime you are willing to sleep through —
       a longer window costs nothing but is no use either, because a message
       this has already published is skipped on its id. */
    WINDOW_DAYS: 45,

    /* What the page shows above the report, with the period appended:
       "Inventory Report - Jul, 2026". The period is always three letters, a
       comma and the four-digit year — the same string the file in the folder is
       named, which is what lets a re-issue find and replace the copy it is
       replacing. */
    LABEL_PREFIX: 'Inventory Report - '
  },


  /* WHERE THE WEEKLY TRANSFER-PRICE FILE COMES FROM BY ITSELF.

     The SAP TP01/ZIPR export is mailed every Tuesday. tp01ReportMailCheck (§11)
     is the DAILY trigger target; the TPMAIL engine it drives is in §10, beside
     the TP01 backend it sends through. Nothing here is read at load time.

     Daily rather than weekly on purpose: a run that finds no new mail costs one
     Gmail search and NOTHING else — no sheet read, no comparison, no property
     written — so six days out of seven are free, and a report re-issued
     mid-week goes out the next morning instead of waiting a week. */
  TP01_MAIL: {

    /* THE WHOLE SUBJECT SENTENCE, and the match is CONTAINS rather than
       STARTS-WITH — which is where this differs from INVENTORY_MAIL above.
       The mail reaches the mailbox as a forward, and a ticket system adds its
       own furniture around the line, so anchoring at the front would miss it.
       "Re:"/"Fwd:" markers are stripped before the test either way.

       Gmail's own subject: term matches WORDS in any order, so the search is
       only the cheap filter — this string is the real one. */
    SUBJECT: 'TP01 - ZIPR Report ECAN Plants 3Q, 3P, 3R, 3G and 3L',

    /* Who the mail is accepted from, as a Gmail `from:` term. The report is
       raised by nabs.customermaster@amrize.com and reaches this mailbox
       FORWARDED BY A COLLEAGUE, so the sender on the message is theirs, not the
       robot's — which is why this is the domain and not the address. A subject
       line is not a credential (§5); this is the only narrowing Gmail offers,
       and '' accepts anybody. */
    FROM: 'amrize.com',

    /* How far back each check searches. Three weekly sends is plenty: a message
       already reported on is skipped on its id, so a longer window costs
       nothing and buys nothing. */
    WINDOW_DAYS: 21,

    /* WHICH ROWS OF THE AGGREGATES SHEET ARE THE QLIKVIEW SIDE.

       Matched as an exact value once normalised, NEVER as "contains RMX": that
       column also carries "Metrix RMX", which is a different company. */
    CUSTOMER_PARENT: 'Amrize RMX',

    /* Recipients are NOT here. They live in the TP01_AUTOMAIL Script Property,
       typed on the page's Automated email panel, because a trigger runs as
       whoever created it (§1) and getUserProperties() would then resolve to a
       different store than the website writes to. TP_getAutoConfig is the
       reader. */

    /* Subject and filename of what goes out. The report date is appended, and
       it comes off the SAP FILE'S OWN date cell — never off the calendar, for
       the reason §7 gives about naming a period. */
    OUT_SUBJECT: 'Transfer Price Exceptions',
    OUT_FILENAME: 'Transfer_Price_Exceptions_All_Markets'
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

    /* ---------------- Product Segment ---------------- */
    segment: {
      label: 'Commercial Product Segment',
      defaultSpreadsheetId: '1ED6caThzPlyP76w6eNIdjbriz7CVRySo2qzRmTGDiDk',   // ← set your Product Segment sheet here, or via Settings
      SHEETS: {
        /* Major Project Segment, already summed to Segment x Market by
           QlikView and already split by period — so there is no Bill Month
           column any more and no per-month row repetition. The old single
           "Slide Segment" tab carried every month and the page did the
           MTD/YTD split itself; the export does that now. */
        segMTD: 'Slide Segment MTD',
        segYTD: 'Slide Segment YTD'
      },
      // Markets the Product Segment builds (drives the per-market product tabs).
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
       years from the Year column and the volume headers, so a third,
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
     * AGG's volume/revenue floors are left at 0/0 \u2014 the same floors change
     * NOTHING there (its bad rows carry $404 and $53,542 of prior-year
     * revenue, well clear of any $110 floor), so guessing a number would
     * only invent a divergence.
     *
     * NOTE: Qlik's Weight also carries Wildmatch(mix_prod_hier_1,'A*') and
     * a set of material exclusions that the export does not expose. See
     * the header comment in Ov_Backend.gs.
     *
     *
     * ------------------------------------------------------------------
     * cpi \u2014 THE CPI COVERAGE GATE, AND ONLY CPI'S.
     * ------------------------------------------------------------------
     * A PAIR HAS TO SHOW A REAL PRICE IN BOTH YEARS. That is the whole
     * rule. It is a GATE, not an outlier filter: a pair that fails leaves
     * the WEIGHT as well as the FACTOR, which is what Qlik does and what
     * the +/-50% and 500% caps both tried and failed to approximate.
     *
     * WHY IT HAS TO BE STRONGER THAN "> 0". Qlik gates on revenue NET OF
     * REBATES; this export carries only gross ex-Works. On 2026 Jan-Aug
     * that difference is 10 pairs, and two of them wreck the page alone:
     *
     *   3P36 / Brock Aggregates / 9141 - a March 2025 invoice of $693.98
     *   met an April credit of $693.84, leaving FOURTEEN CENTS against 47
     *   tonnes. Prior-year ASP $0.003/t, "price move" +492,409%, and 135
     *   of a 141.7% answer by itself.
     *
     *   3Q00 / JNF Ready Mix / 9055 - 378 t at $2.343/t last year against
     *   24,593 t at $22.75/t this year. NOTHING ABOUT IT IS SMALL: it
     *   carries $559,436 of weight and +870.9%, which is +3.13pp of the
     *   all-markets index on its own. It is why SW Ontario still read
     *   14.36% with only the volume and revenue floors applied.
     *
     * THE THREE FLOORS, AND WHAT EACH CATCHES.
     *
     *   minVol / minRev   more than a tonne and more than a dollar in
     *                     BOTH years. This is what takes Brock out:
     *                     fourteen cents is not a year of trading.
     *
     *   minAsp            and both years must average more than $3.00 a
     *                     tonne. THIS IS THE ONE THAT MATTERS. It is the
     *                     visible shadow of Qlik's net-revenue gate:
     *                     Ontario's rebate runs $2.248/t (Manitoba $0.60,
     *                     Saskatchewan $0.90, nil on recycled), so a pair
     *                     whose year averaged $2.34/t was billing the
     *                     rebate and not a price. Qlik nets that to zero
     *                     and drops the pair. We cannot see the rebate,
     *                     but we can see that no real product sells for
     *                     $2.34 a tonne.
     *
     * CALIBRATED, NOT GUESSED, against Qlik's Cust Price Detail for Aug
     * MTD and 2026 Jan-Aug, all markets:
     *
     *                vol/rev > 0    > 1 only   + $3.00 ASP     Qlik
     *     Jan-Aug       141.719%      6.248%       3.106%     2.864%
     *     Aug MTD         2.789%      2.789%       2.724%     2.646%
     *
     * The ASP floor costs three pairs Qlik keeps, worth $1,894 out of
     * $155.5M of weight. Anything from $2.50 to about $3.90 gives the
     * same answer to the third decimal; $4.00 starts eating real product
     * (bank sand runs $3.97/t). $3.00 is the middle of that window.
     *
     * WHAT IS LEFT IS NOT THIS. The residual against Qlik - +0.24pp all
     * markets, +0.01pp Manitoba, 0.00pp North - is the WEIGHT BASIS, not
     * the gate: Qlik weights the numerator by revenue net of rebates and
     * divides by a gross TotalWeight. Closing it needs _rebate as its own
     * column in the export. DO NOT TUNE THESE FLOORS AT IT. README \u00a77.
     *
     * NOT APPLIED TO PPI, which passes no block at all and is bit-for-bit
     * the index it has always published.
     *
     * AND IT IS ONLY REAL IF IT TRAVELS. The browser does the pooling, so
     * this block ships inside cached payloads; ovcCovTok_ (\u00a78) is what
     * makes editing it an invalidation, and a payload that arrives without
     * it reports NO CPI rather than an ungated one. Read that comment
     * before changing anything here.
     * ---------------------------------------------------------------- */
    COVERAGE: {
      agg: { minVol: 0, minRev: 0    },    // \u2190 awaiting the Aggregates Qlik expression
      rmx: { minVol: 1, minRev: 110  },    // Qlik: vol > 1, revenue > 110
      /* CPI only. A pair with no real price in both years is not a pair. */
      cpi: { minVol: 1, minRev: 1, minAsp: 3 }
    }
  }
};

/* ------------------------------------------------------------------
 * USED — and the "NOT USED" that stood here was wrong. getOverview (§8) reads
 * OVERVIEW.MARKETS on every Overview load, the page's footer reports any PV
 * market missing from it as "unmapped", and app.html names it by name in that
 * hint. Deleting it empties the Executive Overview.
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

/* ------------------------------------------------------------------------
 * WHAT THE HEADER'S AGE STAMP LISTS, AND WHAT IT LEAVES OUT
 * ------------------------------------------------------------------------
 * The stamp answers "how old are the figures I am looking at". Two things do
 * not belong in that answer, and both are subtractions from APP_EXTRA_SOURCES
 * rather than a second list of sources — the ⚙ Data sheet panel still offers
 * every workbook, because that panel answers a different question.
 * ---------------------------------------------------------------------- */

/* WORKBOOKS THE STAMP DOES NOT LIST AT ALL. The closed-year history books are
   read ONCE, by "Rebuild history" on the Overview, and never on the user path.
   Their age says nothing about the figures on screen — a 2024 book is supposed
   to be old — and QlikView does not sync them, so every one of them added a
   section to the panel whose only content was "not known". Four rows of that
   under three real ones is what made the panel unreadable. */
var APP_STAMP_SKIP = { histagg: 1, histrmx: 1, histagg2: 1, histrmx2: 1 };

/* PAGES THAT SHOW THE GOOGLE SHEET CLOCK ONLY. The QlikView clock is a fact
   about ONE workbook — when the sync last wrote it — so it means something on a
   page that reads one. The Executive Overview reads three, and three sync times
   stacked up under three sheet times is not an answer to "how old is this
   page"; it is four clocks the reader has to reconcile themselves.

   THIS IS NOT THE TWO CLOCKS BEING COLLAPSED INTO ONE. That rule forbids
   DERIVING the QlikView time from Drive, which would call a hand edit a
   QlikView update. Showing one clock and not the other tells no lie: what is
   left is labelled "last updated from the Google Sheet", which is exactly what
   it is. The pages that read a single workbook still show both. */
var APP_STAMP_NO_QLIK = { overview: 1 };

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
   Both objects are read only from inside functions in §9, so nothing depends on
   where they sit — which is why they can be at the top at all, and the reason
   §1 is at the top in the first place.

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

  /* WHICH LAYOUT EACH RECIPE ROW USES, when somebody has changed one from the
     Deck Builder page. A JSON object of { recipeId: layoutId } holding ONLY the
     rows that differ from DECK_RECIPE below — an untouched row is absent, not
     copied, so re-pointing a slide in the recipe still moves every deck that
     never overrode it.

     IT IS SHARED, NOT PER-USER: getScriptProperties, like the template and
     folder ids above, so one person's change is the default everybody gets
     until somebody changes it again. That is the intent — the mapping is a
     property of the monthly pack, not a per-device preference like the KPI
     region sheet. DECK_setLayout writes it; DECK_resetLayouts empties it. */
  PROP_LAYOUTS: 'DECK_LAYOUT_MAP',

  /* THE ARRANGEMENT: slide ORDER, which slides are in the pack, and the
     per-row edits made from the Arrange stage. Same store, same rules and the
     same reason as PROP_LAYOUTS above - shared, differences only, an untouched
     row absent rather than copied.

       { v:1,
         order: [ids],            the deck order
         off:   [ids],            in the list, starts unticked
         on:    [ids],            optional in the recipe, ticked here
         drop:  [ids],            deleted from the pack outright
         rows:  { id: {source,market,refine,period,title,group} },
         add:   [ {id,source,market,refine,period,layout,group,title} ] }

     OFF AND DROP ARE NOT THE SAME QUESTION. `off` is "not in this month's
     pack" - the slide stays in Arrange, greyed, one click from coming back.
     `drop` is "not part of the pack any more", and Arrange keeps a Deleted
     slides list so a deletion is recoverable from the page rather than only
     from a Script Property edit.

     DECK_setPlan writes it; DECK_resetPlan empties it. */
  PROP_PLAN: 'DECK_PLAN',

  /* WHICH TABLES A SLIDE SHOWS, AND WHETHER IT CARRIES A KPI STRIP, per
     SCOPE rather than per row - because the same change is nearly always
     wanted on every market at once.

       { v:1, scopes: { '<key>': { tables:[keys], kpi:{on,sheet} } } }

     A row walks four keys and takes the first answer, tables and KPI
     resolved independently:

       row:<id>                 one slide. The only way to make MTD and YTD
                                differ, and the only rung most markets have
                                below their own.
       <source>|<mkt>|<refine>  the Land / Docks split. SOUTHWEST ONLY - no
                                other market has a refine, so for them this
                                rung simply does not exist.
       <source>|<mkt>           one market, both periods.
       <source>                 every slide that page produces.

     `period` appears in no key above the first, which is what makes "change
     this market" reach its MTD and YTD slides together.

     `tables` IS ONE ORDERED ARRAY: the order is the selection, so "which" and
     "in what order" cannot disagree, and a key that is not in it is off.

     DECK_setTables writes it; DECK_resetTables empties it. */
  PROP_TABLES: 'DECK_TABLE_MAP',

  /* HOW BIG EITHER OF THOSE TWO IS ALLOWED TO GET.
     `add` is the only unbounded part of the arrangement, so both writers
     measure the serialised string and refuse with a sentence rather than
     truncating - a half-written order is worse than a rejected one.

     THE NUMBER IS GOOGLE'S PUBLISHED PER-VALUE FIGURE, NOT THE OBSERVED ONE.
     The Quotas for Google Services page lists 9 KB per property value and
     500 KB per store. The runtime does not appear to enforce the first: it
     has been measured accepting values far above 9 KB and only refusing near
     the store-wide ceiling, with "You have exceeded the property storage
     quota." Which of the two to write against is not a close call - the
     documented figure is the contract and the observed one is an accident of
     today's implementation - and the difference is not worth having anyway.
     Measured, on the 43-row recipe:

         the whole deck reordered                            608
         ...plus five unticked and two deleted               684
         ...plus six rows retitled                           995
         a reordered deck with ten slides added            2,227
         every one of the 43 rewritten, market and all     5,183
         refused at                                    43 + ~52 added slides

     So the guard sits beyond a 95-slide pack and no arrangement anybody
     builds by hand comes near it. */
  PROP_MAX_BYTES: 9216,

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
     layout    a LAYOUT id from the template's own speaker notes. THE DEFAULT
               ONLY — the Deck Builder's Plan stage offers every report layout
               the template has as a dropdown on each row, and a choice made
               there is saved shared (DECK_CONFIG.PROP_LAYOUTS) and used by
               every build until somebody picks again. Changing the value here
               still moves every row nobody has overridden, which is why the
               store holds the differences and not a copy of this column.
     title     the real, editable Slides heading — not baked into the picture.
     optional  true = shown unticked in the Plan stage. Editable too — see below.

   THIS ARRAY IS THE DEFAULT NOW, NOT THE ONLY ANSWER. Adding, dropping,
   reordering, retitling or re-pointing a slide is something anybody can do
   from the Deck Builder's ARRANGE stage, and what they do is saved SHARED, in
   the two Script Properties named above — PROP_PLAN and PROP_TABLES. Editing
   this array is still the right way to change what the pack IS; the stage is
   for what this month's pack does.

   AND THE TWO STAY MEANINGFUL TOGETHER, which is the whole reason the stores
   hold differences rather than copies:

     · NOTHING STORED IS BYTE-IDENTICAL TO THIS ARRAY. An untouched row has no
       key anywhere, and an arrangement that happens to equal the recipe is
       DELETED rather than kept — otherwise the first press of any button in
       Arrange would freeze all 43 rows, and the next person to edit here would
       change nothing and have no way to see why.
     · A ROW ADDED HERE AFTER AN ORDER WAS SAVED IS INSERTED BESIDE ITS
       PREDECESSOR IN THIS ARRAY. Not appended, not dropped. So adding a slide
       between two others here puts it between those two others in the deck,
       whatever anybody has arranged.

   DECK_getRecipe (§9) applies all of it, and still rejects a duplicate id or a
   row with no layout before the build starts rather than at slide 30 of 43. */

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
 * One helper, one output shape, one switch. What it replaced was no convention
 * at all: 20 Logger.log calls, 15 console.log, 9 console.error, all
 * hand-concatenated strings, no levels, no timings, and no way to turn any of
 * it down short of editing call sites.
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
 * never warm. That is the most expensive mistake this suite has had — every RMX
 * entry point pulling a 14 MB bundle through CacheService to produce a 72 KB
 * answer — and it hid for a long time because nothing about it looked wrong. A
 * line carrying ms and bytes would have shown a flat 15–24 s against a varying
 * question on the first read of the transcript.
 *
 * ---------------------------------------------------------------------------
 * THE SILENT-CATCH CENSUS — 36 of them, every one decided.
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
 * NOT EVERY ENTRY POINT LOGS YET, and that is not an oversight. The call sites
 * that exist are in §4 and in the sync; the older backends do not, and wiring
 * them is its own change with its own review. Adding log lines to hot code
 * while changing what that code does is two changes at once, which is how a
 * regression stops being attributable to either of them.
 * ============================================================================ */

/* ---- logging.gs --------------------------------------------------------------
   APP_log and the LOG_LEVEL switch.  */

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
 * doGet is the one function Apps Script itself calls. It reads ?page= and serves
 * ONE page per load: app.html mounts the page named on <body data-page>, and
 * this is not a single-page app.
 *
 * §3 also holds the period helpers every reader and the sync go through —
 * APP_period_ and the rest — because a header is read from more than one
 * section and only one of them may decide what a period column looks like.
 * ============================================================================ */

/* ========================================================================
 * PERIOD COLUMNS — the one place that reads a period out of a header name
 * ----------------------------------------------------------------------
 * The same figure is headed four different ways across the exports and the
 * workbooks they feed, and all four are live:
 *
 *     2026 Volume     CY Volume     Total Revenue - 2025     Total Revenue -PY
 *
 * The two sides do not have to agree and currently do not: the Aggregates
 * export still names years while its workbook has been moved to CY/PY. Both
 * sides also roll — 2025/2026 becomes 2026/2027 — and either can be switched
 * to CY/PY without warning. Everything that reads a header goes through the
 * helpers below so none of that costs a code change.
 *
 * WHICH YEAR IS CURRENT IS DECIDED BY THE DATA, NOT BY THE HEADER. A header
 * spelling its periods "CY"/"PY" names no year at all, so a reader keying its
 * cells by year has nothing to key on. The Year column (Aggregates) and the
 * year on a Bill Month (Ready-Mix) are the answer, and they are also the
 * check: whatever a header claims, the rows say which years the book holds.
 * ====================================================================== */

/* Header text, flattened. Case, non-breaking spaces, doubled spaces and stray
   padding all vary between an export and the workbook it feeds. Two spellings
   are folded outright because both ship and both mean one column:

     · "Fuel Surchage" is the Aggregates export's own name for the column its
       workbook heads "Fuel Surcharge". One missing letter meant that one
       column matched nothing and was never written, while every other column
       on the tab synced — so the tab looked fine and the surcharge was stale.
     · "ex Works" / "ex-Works" / "exWorks" alternate freely on both sides. */
function APP_hdrNorm_(v) {
  return String(v == null ? '' : v)
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/surchage/g, 'surcharge')
    .replace(/ex[\s\-]?works/g, 'exworks');
}

/* One header split into the figure it names and the period it names it for,
   as { base, period: 'cy' | 'py' | '', year }.

   The token is CY, PY or a four-digit year. It can sit at either end or in the
   middle ("FSC CY Volume"), and the dash between it and the rest is optional —
   "Total Revenue - 2025", "Total Revenue -PY" and "2025 Revenue" are one shape.

   A NAME CARRYING NO TOKEN IS NOT A VAGUER SPELLING OF ONE. "Fuel Surcharge"
   comes back with period '' and year 0, and that is a period of its own: the
   Aggregates workbook carries "Fuel Surcharge", "CY Fuel Surcharge" and "PY
   Fuel Surcharge" side by side, and they are three different columns.

   TWO TOKENS MEANS NEITHER, so nothing is invented for a "2025 vs 2026"
   heading — it is left whole and matches only itself. */
function APP_period_(name) {
  var s = APP_hdrNorm_(name);
  var out = { base: s, period: '', year: 0 };
  if (!s) return out;

  var re = /(^|[^a-z0-9])((?:19|20)\d{2}|cy|py)(?![a-z0-9])/g, hits = [], m;
  while ((m = re.exec(s))) hits.push({ at: m.index + m[1].length, tok: m[2] });
  if (hits.length !== 1) return out;

  var at = hits[0].at, tok = hits[0].tok;
  var left  = s.slice(0, at).replace(/[\s\-]+$/, '');
  var right = s.slice(at + tok.length).replace(/^[\s\-]+/, '');
  out.base = (left && right) ? (left + ' ' + right) : (left || right);
  if (tok === 'cy' || tok === 'py') out.period = tok;
  else out.year = Number(tok);
  return out;
}

/* The year a cell names, whatever shape it arrives in: a Year column's 2026, a
   Bill Month's "Apr-25" or "July-2026", a real Date, or the Excel serial a
   round trip through .xls leaves behind. 0 means the cell names no year, which
   is normal rather than an error — the Aggregates tabs carry a bare "Jul" in
   their Month column and keep the year in a column of its own. */
function APP_cellYear_(v) {
  if (v == null || v === '') return 0;
  if (Object.prototype.toString.call(v) === '[object Date]') return v.getFullYear();
  if (typeof v === 'number') {
    if (v >= 1990 && v <= 2100) return Math.round(v);                 // a Year cell
    if (v > 20000 && v < 80000)                                       // an Excel serial
      return new Date(Math.round((v - 25569) * 86400000)).getUTCFullYear();
    return 0;
  }
  var s = String(v).trim(), m = /(^|[^0-9])((?:19|20)\d{2})(?![0-9])/.exec(s);
  if (m) return Number(m[2]);
  m = /^[A-Za-z]{3,}[\s\-\/.]*(\d{2})$/.exec(s);                      // "Apr-25"
  return m ? 2000 + Number(m[1]) : 0;
}

/* The newest year the ROWS name in `col`, starting at `from` for a grid that
   still has its header on the front. This is what decides which of a tab's two
   period columns is current.

   NOTHING HERE CONSULTS THE CALENDAR, and a cap against "the future" was tried
   and taken out again. It made the answer depend on the day the code ran, which
   is the one dependency this whole family of helpers exists to remove — a
   workbook is read the same way whenever it is opened. APP_cellYear_ only
   accepts 19xx/20xx, so a mistyped cell cannot invent a year outside that. */
function APP_dataCyYear_(rows, col, from) {
  if (!rows || col == null || col < 0) return 0;
  var best = 0;
  for (var i = from || 0; i < rows.length; i++) {
    var r = rows[i]; if (!r) continue;
    var y = APP_cellYear_(r[col]);
    if (y > best) best = y;
  }
  return best;
}

/* Every column of `headerRow` that names `base` for a period, as
   { byYear, cy, py, cyYear, pyYear, years }. `base` may be a list, for a
   figure that is spelled more than one way ("Net Sales Ex VA", with or without
   the "(CAD)" the export sometimes drops).

   `byYear` is the map a reader keys on: the row says 2026, byYear[2026] says
   which column to read. A header that names its years builds that map itself.
   A header that says CY/PY CANNOT, and `dataCyYear` — the newest year the rows
   carry — is what fills it in. Without that a CY/PY-headed workbook reads as a
   column of zeroes under correct-looking headings, which is the failure this
   helper exists to stop.

   A HEADER THAT NAMES YEARS IS BELIEVED OVER dataCyYear. The years are the
   answer there, and the first export of a new year legitimately carries a
   column for a year no row has reached yet. */
function APP_yearCols_(headerRow, base, dataCyYear) {
  var want = (base instanceof Array ? base : [base]).map(APP_hdrNorm_);
  var years = [], cy = -1, py = -1, i, p;
  headerRow = headerRow || [];
  for (i = 0; i < headerRow.length; i++) {
    p = APP_period_(headerRow[i]);
    if (want.indexOf(p.base) === -1) continue;
    if (p.year) years.push({ y: p.year, i: i });
    else if (p.period === 'cy' && cy < 0) cy = i;
    else if (p.period === 'py' && py < 0) py = i;
  }
  years.sort(function (a, b) { return b.y - a.y; });

  var out = { byYear: {}, cy: cy, py: py, cyYear: 0, pyYear: 0,
              years: years.map(function (x) { return x.y; }) };
  years.forEach(function (x) { if (!(x.y in out.byYear)) out.byYear[x.y] = x.i; });

  if (years.length) {
    if (out.cy < 0) out.cy = years[0].i;
    if (out.py < 0 && years.length > 1) out.py = years[1].i;
    out.cyYear = years[0].y;
    out.pyYear = years.length > 1 ? years[1].y : years[0].y - 1;
  } else if (dataCyYear) {
    out.cyYear = Number(dataCyYear);
    out.pyYear = out.cyYear - 1;
    if (out.cy >= 0) out.byYear[out.cyYear] = out.cy;
    if (out.py >= 0) out.byYear[out.pyYear] = out.py;
  }
  return out;
}

/* A { normalised name -> column } index turned back into a header row, so the
   helpers above can read it. Several of the readers hold their header that
   way and never keep the row itself. */
function APP_hdrArray_(index) {
  var out = [];
  for (var k in index) if (Object.prototype.hasOwnProperty.call(index, k)) out[index[k]] = k;
  return out;
}

/* One header row, indexed so it can be matched against another header row that
   spells its periods differently. Three indexes, because three questions:

     plain   base            -> column, for a header naming no period
     year    base + '|y2026' -> column
     rank    base + '|cy'    -> column, and '|py'

   `rank` is the bridge. An explicit CY/PY token goes in as itself; a
   year-named column is ranked against the other years the SAME header gives
   that base — newest is CY, the one below it is PY. Ranking rather than naming
   is the point: the sync has to pair "2026 Volume" with "CY Volume" and cannot
   rewrite either side.

   THE YEAR KEY IS TRIED FIRST WHEN BOTH SIDES NAME YEARS, and that is not a
   detail. A workbook gains a new year's column by hand, some time after the
   export already has it. Pairing on rank inside that window would write this
   year's figures into last year's column; pairing on the year leaves the new
   column unmatched, which is reported, and is the right answer. */
function APP_periodMap_(headerRow) {
  var out = { plain: {}, year: {}, rank: {}, hasYear: {}, rankAt: {} }, byBase = {};
  headerRow = headerRow || [];
  for (var i = 0; i < headerRow.length; i++) {
    var p = APP_period_(headerRow[i]);
    if (!p.base) continue;
    if (!p.period && !p.year) {
      if (!(p.base in out.plain)) out.plain[p.base] = i;
    } else if (p.year) {
      out.hasYear[p.base] = 1;
      var yk = p.base + '|y' + p.year;
      if (!(yk in out.year)) out.year[yk] = i;
      (byBase[p.base] = byBase[p.base] || []).push({ y: p.year, i: i });
    } else {
      var tk = p.base + '|' + p.period;
      if (!(tk in out.rank)) { out.rank[tk] = i; out.rankAt[i] = p.period; }
    }
  }
  Object.keys(byBase).forEach(function (base) {
    var list = byBase[base].sort(function (a, b) { return b.y - a.y; });
    ['cy', 'py'].forEach(function (per, n) {
      if (!list[n] || (base + '|' + per) in out.rank) return;
      out.rank[base + '|' + per] = list[n].i;
      out.rankAt[list[n].i] = per;
    });
  });
  return out;
}

/* Which column of `tgt` holds what the other side's column `p` names, where
   `base` is that name after any per-tab aliasing and `srcRank` is 'cy' / 'py'
   / '' — the rank that column has in ITS OWN header. -1 when nothing does,
   which is a reportable answer and not a failure. */
function APP_periodFind_(tgt, base, p, srcRank) {
  if (!base) return -1;
  if (!p.period && !p.year) return (base in tgt.plain) ? tgt.plain[base] : -1;
  if (p.year) {
    var yk = base + '|y' + p.year;
    if (yk in tgt.year) return tgt.year[yk];
    if (tgt.hasYear[base]) return -1;         // both sides name years: the year decides
  }
  var rk = base + '|' + (p.period || srcRank || '');
  return (rk in tgt.rank) ? tgt.rank[rk] : -1;
}

/* ---- Code.gs -----------------------------------------------------------------
   The router, the logo, the freshness stamps, the chunked cache, the SB reader.  */

/*****************************************************************************
 * AMRIZE COMMERCIAL SUITE — main entry / router
 * ---------------------------------------------------------------------------
 * This single Apps Script project hosts the web apps under one URL:
 *    ?page=pricevolume   → Price & Volume Analysis
 *    ?page=rmx           → Amrize RMX (Price & Volume)
 *    ?page=segment       → Product Segment (Google Sheets → slide PNG)
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
 *   - Product Segment backend (SB)
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
   as an outage rather than as a typo. This is the same list app.html's §D
   switcher carries, and the two have to stay identical. */
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
     block — see app.html's banner on the same trap. */
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
var APP_CODE_BUILD = '2026-08-24a';

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
         warm. What that costs: every Ready-Mix entry point pulled
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


/* ------------------------------------------------------------------------
 * WHERE THE FIGURES CAME FROM, AND WHEN — the header's stamp button.
 * ------------------------------------------------------------------------
 * TWO CLOCKS, AND THEY ARE NOT THE SAME CLOCK. "Update from source" answers
 * whether there is something newer; it has never said how old what you are
 * looking at is, and those are different questions on a page that is allowed
 * to paint from a device cache.
 *
 *   sheetAt   when the workbook behind this page last CHANGED. This is the
 *             modified time the data version is built from, so a page holding
 *             generation G is holding the sheet as it stood at sheetAt — and
 *             the browser can read its own generation to say so without asking
 *             anybody. Moved by whoever moved it: a sync, or a hand edit.
 *   qlik      when QLIKSYNC last WROTE that workbook, and the date on the
 *             export it read. Drive cannot answer this and must not be made to
 *             guess: a row typed into REGION LOOKUP moves sheetAt exactly as a
 *             sync does. §5's run() records it.
 *
 * One row per workbook the page reads, so the Executive Overview — which owns
 * no sheet and reads three — reports all three rather than a single time that
 * would have to stand for the stalest of them. The Drive lookups are the same
 * memoised half-minute stamps every freshness check already pays for.
 *
 * TWO SUBTRACTIONS, BOTH IN §1 AND NEITHER OF THEM A SECOND SOURCE LIST.
 * APP_STAMP_SKIP drops the closed-year history books, which are read once by
 * "Rebuild history" and are not synced; APP_STAMP_NO_QLIK drops the QlikView
 * clock on a page that reads several workbooks, where one sync time per
 * workbook is not an answer to "how old is this page". The ⚙ Data sheet panel
 * is unaffected by both — it still offers every workbook, because choosing a
 * sheet and dating one are different questions. `qlik` on the answer says which
 * of the two clocks the caller is being given, so the panel does not have to
 * infer it from a row of zeroes.
 * ---------------------------------------------------------------------- */
function getSourceTimes(page) {
  page = String(page || '');
  var wantQlik = !(typeof APP_STAMP_NO_QLIK === 'object' && APP_STAMP_NO_QLIK[page]);

  /* The page's own workbook first, then anything its ⚙ panel lists for it —
     the same set APP_sourceIds_ walks, kept as PAGES so each row can be named
     and asked for its own sync stamp. */
  var want = [], seen = {};
  function add(p){
    if (!p) return;
    var o;
    try { o = APP_sheetOwner_(p); } catch (e) { return; }
    if (!o || seen[o]) return;
    if (typeof APP_STAMP_SKIP === 'object' && APP_STAMP_SKIP[o]) return;
    seen[o] = 1; want.push(o);
  }
  add(page);
  ((typeof APP_EXTRA_SOURCES === 'object' && APP_EXTRA_SOURCES[page]) || []).forEach(add);

  var rows = [];
  want.forEach(function (p) {
    var id = '';
    try { id = getSpreadsheetIdForPage_(p); } catch (e) { id = ''; }
    if (!id) return;

    var ms = parseInt(APP_oneStamp_(id), 10);
    /* Not asked for at all when the page is not showing that clock — the sync
       log is a Script Property and a JSON.parse per row, and reading it to
       produce fields nothing renders is the shape of cost that hides. */
    var q  = null;
    if (wantQlik) { try { q = QLIKSYNC.lastSync(p); } catch (e) { q = null; } }

    rows.push({
      page:       p,
      label:      (APP_CONFIG.PAGES[p] && APP_CONFIG.PAGES[p].label) || p,
      sheetAt:    ms > 0 ? ms : 0,
      qlikAt:     (q && q.at)       || 0,
      exportAt:   (q && q.exportAt) || 0,
      exportName: (q && q.exportName) || '',
      tabs:       (q && q.tabs)     || 0,
      qlikFailed: (q && q.failed)   || 0
    });
  });

  return { ok: true, page: page, now: Date.now(), qlik: wantQlik, sources: rows };
}


/* ========================================================================
 * PRODUCT SEGMENT backend
 * ----------------------------------------------------------------------
 * THE NAMESPACE IS `SB` AND THE PAGE IS PRODUCT SEGMENT. The prefix is left
 * from when this page was called the Slide Builder, which read as a second
 * Deck Builder and is why the name went; renaming the namespace would touch
 * every call site in app.html for nothing. SB is this page and no other.
 *
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

  // All Product Segment config (tabs, markets, labels, sheet) lives in Config.gs.
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
        throw new Error('Tab "' + name + '" was not found in the Product Segment data sheet. ' +
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
 * Run APP_verifyPermissions() from the Apps Script editor after pasting this
 * file in. It prints one line per service and returns the same thing
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
 *    It is belt-and-braces alongside the explicit "oauthScopes" array in
 *    appsscript.json, which is the reliable mechanism.
 *
 *    AN EXPLICIT oauthScopes ARRAY REPLACES AUTO-DETECTION. Adding a service to
 *    this project now means adding its scope to appsscript.json by hand. Nothing
 *    will warn you: the call simply throws at runtime for every user. This
 *    function is how you find that out in one run instead of from a support
 *    message. Add the service here at the same time.
 *
 *    AND ONE ENTRY IN THE MANIFEST IS NOT A SCOPE AT ALL. appsscript.json's
 *    dependencies.enabledAdvancedServices lists the Google Sheets API v4, and
 *    NOTHING IN THIS FILE CALLS THE `Sheets` SYMBOL — §5 reaches the same API
 *    over UrlFetchApp on the script's own token. It is there because listing an
 *    advanced service is what switches that API ON in the Cloud project behind
 *    the script, and a default Apps Script project has Drive's API on and
 *    Sheets' off. Without it every Sheets REST call comes back 403, the sync's
 *    wait for a converted export goes blind, and the truncation that wait
 *    exists to prevent comes back. It looks unused; deleting it breaks the
 *    QlikView sync. The Sheets REST row below is what says so out loud.
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
 * shared list (§1). The check reports the effective user against the
 * active user so a wrong deployment setting is one line to read rather than
 * something inferred from whose name is on an email.
 *
 * THE EIGHT SCOPES, AND WHAT NEEDS EACH. JSON takes no comments, so this is the
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
 *   auth/script.send_mail        MailApp.sendEmail — TP01 only, in both its
 *                                shapes: the per-market workbooks somebody sends
 *                                from the page, and the weekly exceptions report
 *                                the §11 day timer sends with nobody watching.
 *                                THE TRIGGER IS THE ONE THAT NEEDS SAYING: it
 *                                runs as whoever created it, so it is THAT
 *                                account's grant that has to be live, not the
 *                                deployer's by assumption and not yours.
 *                                Still NOT a Gmail scope: it is the narrow "send
 *                                mail as you" grant, it covers sending with
 *                                attachments, and it does not let anything read
 *                                a mailbox. The read side is the line below, and
 *                                the two are separate grants on purpose.
 *   auth/gmail.readonly          GmailApp.search and getAttachments — §10's TWO
 *                                mail watches, the Inventory Report's and
 *                                TP01's, and nothing else in the file.
 *                                READ-ONLY deliberately: both remember which
 *                                messages they have already handled in a Script
 *                                Property rather than labelling or archiving
 *                                them, so neither ever writes to anybody's
 *                                mailbox and gmail.modify is not needed. This is the widest grant in the list —
 *                                it can read every message the deployer can —
 *                                and it is here only because Gmail has no
 *                                "one sender, one subject" scope to ask for
 *                                instead. APP_CONFIG.INVENTORY_MAIL.FROM is the
 *                                narrowing this project CAN do; do not empty it
 *                                without meaning to.
 *   auth/script.external_request UrlFetchApp — the Amrize logo, and the Drive
 *                                REST call above.
 *   auth/script.scriptapp        ScriptApp.getService().getUrl(), which is what
 *                                getAppUrl_ in §3 builds every page link from,
 *                                AND ScriptApp.getProjectTriggers() — the read
 *                                the check below uses to say whether §11's three
 *                                trigger targets are armed. That second call
 *                                settles a doubt this line used to carry: the
 *                                grant was once described here as possibly
 *                                reachable without it, and it is not.
 *                                It would be here for the URL alone anyway. If
 *                                that URL comes back empty, every link on the
 *                                landing page goes RELATIVE, and a relative href
 *                                inside the Apps Script sandbox iframe resolves
 *                                against googleusercontent.com — the page loads
 *                                and then navigates the user off the app. That
 *                                failure already shipped once. An extra line on
 *                                the consent screen is the cheaper side of that
 *                                trade.
 *   auth/userinfo.email          Session.getActiveUser().getEmail(), which §10
 *                                stamps onto an archived KPI workbook, and the
 *                                effective-user line this check reports.
 *
 * CacheService, PropertiesService, LockService, Utilities and HtmlService need no
 * scope, which is why they carry "(none needed)" below rather than being left
 * out: a service that is checked and needs nothing is a different fact from a
 * service nobody remembered. All five have a row. Utilities and HtmlService
 * were named in this paragraph and absent from the array for a while, which is
 * the drift the paragraph exists to prevent — and Utilities is not a formality
 * any more, because Utilities.zip is what writes the .xlsx the weekly report
 * attaches.
 * ============================================================================ */

/* ---- permissions.gs ----------------------------------------------------------
   APP_verifyPermissions and its two formatting helpers.  */

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
      usedFor: 'TP01 — the per-market workbooks a person sends, and the weekly ' +
               'exceptions report the trigger sends',
      probe: function () {
        /* Reads the quota. Sends nothing. */
        return MailApp.getRemainingDailyQuota() + ' message(s) left in today’s quota';
      } },

    { service: 'GmailApp', scope: 'auth/gmail.readonly',
      usedFor: "two mail watches — the Inventory Report's (§10 IRMAIL) and TP01's (§10 TPMAIL)",
      probe: function () {
        /* Runs BOTH watches' OWN searches, so what this proves is the thing
           that matters: the grant is live AND the queries the triggers will run
           come back. A probe that runs a lookalike query proves the wrong
           thing, which is why neither is spelled out here. Reads nothing else,
           publishes nothing, sends nothing, marks nothing seen. */
        var out = [];
        [['Inventory', typeof IRMAIL !== 'undefined' && IRMAIL.query && IRMAIL.query()],
         ['TP01',      typeof TPMAIL !== 'undefined' && TPMAIL.query && TPMAIL.query()]
        ].forEach(function (pair) {
          var q = pair[1] || '';
          out.push(q ? (pair[0] + ': ' + GmailApp.search(q, 0, 5).length + ' thread(s) match ' + q)
                     : (pair[0] + ': no subject configured — scope referenced, not proven'));
        });
        return out.join('  |  ');
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

    /* THE ONE CALL THIS REPORT USED TO TAKE ON TRUST. The sync converts each
       .xls export through the Drive REST API on the script's own OAuth token —
       three things at once (the token is issued, external requests are
       allowed, the export is readable), and none of them proved by the logo
       fetch above or by the DriveApp probe. A read of one export's metadata
       proves all three, writes nothing, and fails here rather than an hour
       later inside a trigger nobody is watching. */
    { service: 'Drive REST', scope: 'auth/drive + auth/script.external_request',
      usedFor: 'the QlikView sync: converting each export to a Google Sheet',
      probe: function () {
        var q = (APP_CONFIG && APP_CONFIG.QLIK_SYNC) || {};
        var id = q.AGG_FILE_ID || q.RMX_FILE_ID || q.SEG_FILE_ID || '';
        if (!id) return 'no export file id configured — scope referenced, not proven';
        var r = UrlFetchApp.fetch(
          'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
          '?supportsAllDrives=true&fields=name,mimeType',
          { muteHttpExceptions: true,
            headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } });
        if (r.getResponseCode() !== 200) {
          throw new Error('Drive answered HTTP ' + r.getResponseCode() + ' for the export file id ' +
            id + ': ' + r.getContentText().slice(0, 200));
        }
        return 'read "' + (JSON.parse(r.getContentText()).name || '?') + '"';
      } },

    /* AND THE SECOND REST CALL THE SYNC MAKES, which is newer than the one
       above and just as unproven by anything else here. Before the converted
       copy is opened, the sync asks the SHEETS API how tall each of its tabs
       is, and it keeps asking until the answer stops changing — because the
       Spreadsheet service cannot answer that question honestly twice in one
       execution, and a copy read while Drive is still filling it is how a
       47,000-row export became 1,113 rows on the tab.

       So the wait is only as good as this endpoint. If the token is refused
       here the sync does not stop — it waits blind and reads — but it loses
       both the wait AND the check that measures the read against the file, and
       nothing else in the system would say so. A metadata read of one of the
       app's own workbooks proves the endpoint, the token and the scope
       together, and writes nothing. */
    { service: 'Sheets REST', scope: 'auth/spreadsheets + auth/script.external_request',
      usedFor: 'the QlikView sync: watching a converted export fill, and check 0',
      probe: function () {
        var id = '';
        try { id = getSpreadsheetIdForPage_('pricevolume'); } catch (e) { id = ''; }
        if (!id) return 'no Price & Volume sheet configured — scope referenced, not proven';
        var r = UrlFetchApp.fetch(
          'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id) +
          '?fields=sheets.properties(title,gridProperties(rowCount))',
          { muteHttpExceptions: true,
            headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } });
        if (r.getResponseCode() !== 200) {
          /* A 403 HERE IS NOT AN OAUTH FAILURE, and reading it as one sends
             whoever runs this looking for a consent screen that will never
             appear. The scope is granted — SpreadsheetApp works on every page —
             and the token is good, because the Drive REST row above went
             through on the same one. What is off is the Sheets API in the CLOUD
             PROJECT behind the script: a default Apps Script project has Drive
             switched on and Sheets switched off, which is exactly the shape of
             one of these two rows passing and the other not. */
          var body = r.getContentText().slice(0, 300);
          throw new Error('The Sheets API answered HTTP ' + r.getResponseCode() + ' for ' + id +
            ': ' + body +
            (/has not been used in project|is disabled|SERVICE_DISABLED/i.test(body)
              ? ' \u2014 THIS IS NOT A PERMISSION PROMPT ANYTHING CAN TRIGGER. The scope is ' +
                'granted and the token is good (the Drive REST row above uses the same one); the ' +
                'Sheets API is switched off in the Cloud project behind this script, as it is in ' +
                'every default Apps Script project. Turn it on either way round: Apps Script ' +
                'editor \u25b8 Services \u25b8 + \u25b8 Google Sheets API \u25b8 Add, or open ' +
                'the console link in the message above and press Enable. Then run this again.'
              : '') +
            ' THE PROJECT ASKS FOR IT IN appsscript.json, as an advanced service \u2014 ' +
            'dependencies.enabledAdvancedServices, userSymbol "Sheets", version "v4", serviceId ' +
            '"sheets" \u2014 and that entry IS how the API gets switched on for the Cloud ' +
            'project. Nothing in the code calls the Sheets symbol, so an editor tidying unused ' +
            'services away removes it and this row goes red again. Put it back and re-push. ' +
            'Without it the sync still runs, and blind: the wait for a converted export cannot ' +
            'see the copy filling \u2014 Drive\u2019s version number does not move while the ' +
            'converter writes \u2014 so it falls back to a fixed sleep, and check 0, the one ' +
            'that measures what was READ against how tall the file actually is, cannot run at ' +
            'all.');
        }
        var tabs = (JSON.parse(r.getContentText()).sheets || []).length;
        return 'read the grid of ' + tabs + ' tab(s)';
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
      usedFor: 'per-page sheet overrides, TP01 recipients and its automated-email ' +
               'settings, QlikView sync stamps, the two mail watches\u2019 seen-lists',
      probe: function () {
        var n = PropertiesService.getScriptProperties().getKeys().length;
        var u = PropertiesService.getUserProperties().getKeys().length;
        return n + ' script propert(ies), ' + u + ' user propert(ies)';
      } },

    { service: 'ScriptApp', scope: 'auth/script.scriptapp',
      usedFor: 'the deployment URL every page link is built from, the Drive REST token, ' +
               'and whether §11’s five trigger targets are armed',
      probe: function () {
        var url = '';
        try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
        var tok = ScriptApp.getOAuthToken();

        /* THE FIVE TRIGGERS, WHICH NOTHING ELSE IN THE PROJECT CAN SEE. Every
           one is added BY HAND (§11) — the single newTrigger in the codebase
           arms §5's one-shot sync retry and nothing else — so a trigger that
           was never added, or was deleted, leaves no trace anywhere: that
           export just stops syncing, and the two mail watches just never
           arrive. Nothing errors, and that is the point. This line is the only
           report of their existence the project has.

           THREE OF THE FIVE ARE THE DATA PIPELINE, one per QlikView export.
           "NOT SET" on any one of them is one page's figures frozen while the
           other two keep updating, which is the shape of a fault that gets
           blamed on the page rather than on the timer.

           A MISSING TRIGGER IS NOT A FAILED CHECK. The probe throws only when
           the scope is missing; an absent trigger is a configuration fact and
           is reported in this line rather than turning the row red. */
        return (url ? 'web app URL resolved' : 'NO web app URL — every page link would be relative')
             + ', OAuth token ' + (tok ? 'issued' : 'MISSING')
             + ', triggers — ' + APP_permTriggers_();
      } },

    { service: 'Utilities', scope: '(none needed)',
      usedFor: 'the TP01 exceptions .xlsx, which §10 writes by hand as a zip of XML',
      probe: function () {
        /* THE ONE PLATFORM CALL THE HAND-WRITTEN WORKBOOK RESTS ON. §10 builds
           the .xlsx the weekly report attaches part by part and zips it,
           because a trigger has no browser and therefore no SheetJS — and an
           .xlsx IS a zip of XML. Utilities.zip is the whole of that dependency.
           If it ever stopped producing a readable archive the report would go
           on sending happily and the ATTACHMENT would be the broken thing,
           which is the failure nobody reads a log to find. Zips two tiny parts
           and reads the size back; writes nothing anywhere. */
        var z = Utilities.zip([Utilities.newBlob('<a/>', 'application/xml', 'a.xml'),
                               Utilities.newBlob('<b/>', 'application/xml', 'b.xml')], 'probe.zip');
        var n = z.getBytes().length;
        if (!n) throw new Error('Utilities.zip returned an empty archive');
        return 'zipped two parts into ' + n + ' bytes';
      } },

    { service: 'HtmlService', scope: '(none needed)',
      usedFor: 'serving the app — the one createTemplateFromFile in the project',
      probe: function () {
        /* Names the file exactly the way doGet does. It resolves or it throws,
           and a throw here is the failure the banner at the top of this file
           warns about: rename script.gs back to app.gs and BOTH files are
           called "app", so this call stops being unambiguous. Builds the
           template; does not evaluate it. */
        HtmlService.createTemplateFromFile('app');
        return 'app.html resolved by name';
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
  /* WHAT TO DO ABOUT IT, AND THE TWO CASES ARE NOT THE SAME. A row carrying a
     scope failed for want of that grant. A row reading "(none needed)" failed
     for some other reason entirely — Utilities.zip returning nothing, app.html
     not resolving by name — and no scope will fix it, so saying "add the scope"
     to somebody looking at one of those sends them to the wrong file. */
  lines.push(out.ok ? '  Every service answered. Nothing is missing.'
                    : '  MISSING OR BROKEN: ' + out.missing.join(', ')
                      + '\n  A row with a SCOPE beside it: add that scope to appsscript.json'
                      + '\n  oauthScopes, save, and re-authorise.'
                      + '\n  A row reading "(none needed)" failed for some OTHER reason — its'
                      + '\n  own line says which — and no scope will fix it.');
  var report = lines.join('\n');
  out.report = report;
  Logger.log(report);

  APP_log(out.ok ? 'info' : 'error', 'APP.verifyPermissions', 'done',
          { ms: Date.now() - t0, ok: out.ok, missing: out.missing.length });
  return out;
}

/* THE §11 TRIGGER TARGETS, AND THIS IS THE LIST. Nothing in the repo points at
   any of them — they are configured by hand in the Apps Script UI — so this
   array is the reference §11's banner says is missing, and it is what has to be
   updated when a target is added. THE FIRST THREE ARE THE DATA PIPELINE, one
   timer per QlikView export — sources_() in §5 names the same three, from the
   source's own side.

   IT REPORTS ONLY THE TRIGGERS THE ACCOUNT RUNNING THE CHECK CREATED. That is
   the platform's rule, not a shortcut here, and it is the same rule §11 is built
   on: an installable trigger runs as whoever added it. So "NOT SET" means "not
   set BY YOU" — run this as the account that deployed the web app, which is the
   account all of them are supposed to belong to, and then it means what it says.

   TWO OF ONE TARGET IS WORTH SEEING TOO: a duplicated day timer sends the
   weekly exceptions report twice, and the seen-list makes the second send
   nothing, so the only symptom is a run that finds no new mail. */
var APP_TRIGGER_TARGETS = ['qlikSyncAggregates', 'qlikSyncReadyMix', 'qlikSyncSegment',
                           'inventoryReportMailCheck', 'tp01ReportMailCheck'];

function APP_permTriggers_() {
  var mine = ScriptApp.getProjectTriggers(), got = {}, i;
  for (i = 0; i < mine.length; i++) {
    var fn = mine[i].getHandlerFunction();
    got[fn] = (got[fn] || 0) + 1;
  }
  var out = [];
  for (i = 0; i < APP_TRIGGER_TARGETS.length; i++) {
    var t = APP_TRIGGER_TARGETS[i], n = got[t] || 0;
    out.push(t + ': ' + (n === 0 ? 'NOT SET' : n === 1 ? 'set' : n + ' SET — one too many'));
  }
  return out.join('; ');
}

/* Whether the account running the call has a trigger on ONE named target, for a
   report that cares about its own trigger rather than all three. Same
   own-triggers-only rule as above. */
function APP_permTriggerCount_(handler) {
  try {
    var mine = ScriptApp.getProjectTriggers(), n = 0;
    for (var i = 0; i < mine.length; i++) {
      if (mine[i].getHandlerFunction() === handler) n++;
    }
    return n;
  } catch (e) { return -1; }      /* -1 = could not look, which is not the same as none */
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
 * AND ONE EXPORT PER EXECUTION. run() takes a page, reads that page's one
 * export and writes that page's one workbook. §11 sets a timer per export, so
 * the three never share a six-minute limit they never fitted into.
 *
 * This section is the ENGINE. What starts it lives in §11 with the other entry
 * points nothing in this repo calls — the trigger list and the Run menu are both
 * outside the repo, and that is precisely why they get their own signposted
 * section rather than being left to a grep to find.
 *
 * IT HAS NO UI, AND THAT IS A DECISION. There is no ⇣ Pull from QlikView button
 * and there never was. A page that could start a sync would put a minutes-long
 * Drive job behind a button any user could press twice.
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
 *     SEG_FILE_ID  →  Product Segment workbook (the Segment/Product export)
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
 *   'replace'  The Product Segment tabs. No formulas, no extra columns: the tab
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
 *   AN ANCHOR IS NEVER TAKEN OUT TO MAKE ROOM FOR THE WRITE. It is read, left
 *   where it is, and written back re-pointed. Only a formula sitting in a
 *   column the export FEEDS is cleared first, because that is a cell the write
 *   is about to land on. The band used to be cleared whole, and it was absent
 *   for the entire workbook's pass — one throw, or one execution killed at the
 *   runtime limit, and every anchor was gone with nothing left to restore, and
 *   nothing for the next run to find either.
 *
 * ROWS
 *   The data ends exactly where the export ends, in both modes. Taller export,
 *   rows inserted; shorter export, the surplus DELETED rather than left blank —
 *   otherwise January reads a December-sized sheet for eleven months, and no
 *   reader can tell an empty row from a row the export stopped sending.
 *
 *   That is safe because every formula on these tabs is a single-cell ARRAY
 *   formula anchored on the first data row. Nothing is filled down, so a
 *   surplus row holds no formula of anybody's — only spill, which comes back
 *   when the anchor is re-pointed at the new height.
 *
 * WHAT THE SYNC OWNS
 *   ROWS BELOW THE DATA ARE THE EXPORT'S. COLUMNS ARE NOT.
 *
 *   In 'columns' mode the sync owns the columns it PAIRS, and that is all.
 *   Every other column on the tab — a lookup, a working column, an anchor for
 *   something this file has never heard of — is read past and left exactly as
 *   it was, on every tab. Assume one is there. In 'replace' mode the tab is the
 *   export and the whole of it is rewritten, which is why nothing but a
 *   QlikView tab is in that mode.
 *
 * SETUP
 *   The three file ids live in Config.gs → APP_CONFIG.QLIK_SYNC.
 *   Nothing else to enable: the Drive REST copy below runs on the script's own
 *   OAuth token, so the Advanced Drive Service does NOT need to be turned on.
 *
 * TRIGGERS
 *   ONE TIME-DRIVEN TRIGGER PER EXPORT — qlikSyncAggregates, qlikSyncReadyMix
 *   and qlikSyncSegment — set a few minutes apart. Each compares its own
 *   export's modified time against the one it last synced and does nothing at
 *   all if it has not moved, so an ordinary firing is ONE Drive lookup.
 *
 *   ONE EXPORT PER EXECUTION IS THE POINT OF THE SPLIT. The three together are
 *   about seven minutes of work and an Apps Script execution is six, so a
 *   single firing could never hold the job: it did as much as fitted and left
 *   the rest to a retry chain. Separately they are two to three minutes each.
 *
 *   Run qlikMarkCurrent() ONCE after setting them up. Without it the first
 *   firing of each has nothing to compare, treats its export as new and syncs
 *   it.
 *
 *   qlikStamps() shows what the next firing of each will compare, and what it
 *   will do.
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
     `bill_month`, the sheet's header spells it "Bill Month", and header
     normalising folds case and whitespace, not underscores, so the two would
     otherwise never match. Both carry the year ("Apr-25" / "Apr-26"), one year
     per row, which is also where a Ready-Mix tab's current year is read from. */
  var SYNONYM = {
    'bill month': 'monthcol', 'billmonth':   'monthcol', 'bill_month': 'monthcol'
  };
  function canon_(name) { return SYNONYM[name] || name; }
  function isMonthCol_(name) { return canon_(name) === 'monthcol'; }

  /* Extras + Associates: the only two names that still differ once the period
     has been taken off the header.

     THERE USED TO BE SIX YEAR-BY-YEAR ENTRIES HERE, then three patterns that
     carried the year across. Both are gone: matching is on the BASE now — the
     name with its CY, PY or year removed — so "2025 Revenue", "2027 Revenue"
     and "Total Revenue -PY" are one entry between them, and a roll to the next
     year costs nothing here.

     THE SYNC NEVER REWRITES A HEADER ROW. It writes data under the headers the
     workbook already has, so a new year's column has to exist there before
     anything can be written into it. Until it does, the export's new column
     matches nothing and is reported as unmatched rather than written somewhere
     wrong — see APP_periodFind_ for why that is deliberate. */
  var ALIAS_EXTRA = {
    'plant_descr': 'plant',
    'revenue':     'total revenue'
  };

  /* The base of one export column as the SHEET spells it. Keyed on the base,
     so nothing here has to know which years are in play. */
  function alias_(spec, base) {
    return (spec.alias && spec.alias[base]) || base;
  }

  /* Main Raw Data and both AGG tabs use the same names on both sides. */
  var ALIAS_NONE = {};


  /* =====================================================================
   * 2. WHICH EXPORT TAB FEEDS WHICH SHEET TAB
   * ---------------------------------------------------------------------
   *   folder  'AGG' | 'RMX' | 'SEG' — which export file it comes from
   *   page    the Config.gs page id whose workbook owns the tab
   *   tab     the tab name in that workbook
   *   mode    'columns' (map by header, keep formulas) | 'replace' (wipe)
   *   srcTab  match the export tab by NAME (the Product Segment export names
   *           its tabs); otherwise…
   *   match   …match by the header names the export tab must contain
   *   pick    tie-breaker when two export tabs look identical
   * =================================================================== */

  function buildSpec_() {
    var SPEC = [

      /* ---- AGG folder → Price & Volume ---- */
      { folder: 'AGG', page: 'pricevolume', tab: 'Combined Data CPI Raw',
        mode: 'columns', alias: ALIAS_NONE,
        match: ['year', 'month', 'plant type', 'material family', 'fuel surcharge'] },

      { folder: 'AGG', page: 'pricevolume', tab: 'Combined Data CPI Other Revenue',
        mode: 'columns', alias: ALIAS_NONE,
        match: ['year', 'month', 'other revenue'] },

      /* ---- RMX folder → Ready-Mix ---- */
      /* stampMonth: this is the export that says which month everything is
         for. The Product Segment's Segment tabs arrive pre-split into MTD and
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

      /* ---- SEG folder → Product Segment ----
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
   * Apps Script cannot read .xls / .xlsx directly — SpreadsheetApp opens a
   * Google Sheet and nothing else. Drive converts one in a single REST call;
   * we read the copy, then throw it away. Using the REST endpoint rather than
   * the Advanced Drive Service means there is no service to switch on in the
   * editor.
   *
   * THE TEMP SHEET IS NOT OPTIONAL. QlikView delivers .xls and that is not
   * negotiable, so a copy is made on EVERY sync — this is the steady state,
   * not a fallback. (readExport_ does skip the copy for an export that is
   * already a Google Sheet, which is why the branch is there; it is not a
   * route anybody can take here.)
   *
   * That it happens every time is why sweepTemps_ exists. A `finally` covers
   * every way the read can fail except the runtime limit, where the execution
   * is killed and no `finally` runs — and one stranded copy per kill, forever,
   * is a leak in the script account's Drive rather than a one-off.
   *
   * AND IT MUST NOT BE SHARED WITH ANYBODY. A new Drive file takes its
   * audience from the folder it is created in, so a copy made with no parent
   * lands beside the export — in whatever shared folder that sits in, visible
   * to everyone with access to it and turning up in their Drive activity
   * mail. The copy is therefore created in the script account's own Drive
   * root, and any permission that still came across with it is removed before
   * anything is read. Nothing in this file ever CREATES a permission, which is
   * the only Drive call that emails a person.
   * =================================================================== */

  var EXCEL_MIME = {
    'application/vnd.ms-excel': 1,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 1,
    'application/vnd.google-apps.spreadsheet': 1
  };

  /* One Drive REST call on the script's own token. */
  function driveFetch_(url, opts) {
    var o = { muteHttpExceptions: true };
    for (var k in opts) o[k] = opts[k];
    o.headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
    return UrlFetchApp.fetch(url, o);
  }
  var DRIVE_V3 = 'https://www.googleapis.com/drive/v3/files/';

  /* The temp copy's name always starts with this, which is what makes the
     leftovers below identifiable. Do not change it without changing them. */
  var TEMP_PREFIX = '~qliksync temp';

  /* Convert to a temporary Google Sheet and return the new file id. */
  function convertToSheet_(fileId, name) {
    var body = { name: TEMP_PREFIX + ' \u2014 ' + name, mimeType: MimeType.GOOGLE_SHEETS };

    /* The script account's own Drive root: a folder nobody else can see, so
       the copy is born private instead of inheriting the export folder's
       audience. If the root cannot be read the copy is still made — a sync
       that stops because it could not name a folder would be worse than one
       that makes a file it then unshares and trashes. */
    try { body.parents = [DriveApp.getRootFolder().getId()]; }
    catch (e) {
      APP_log('warn', 'QLIKSYNC.convert', 'no Drive root to copy into — the temp sheet will be ' +
              'made beside the export instead', { file: name, error: String(e) });
    }

    var res = driveFetch_(DRIVE_V3 + encodeURIComponent(fileId) + '/copy?supportsAllDrives=true&fields=id',
                          { method: 'post', contentType: 'application/json',
                            payload: JSON.stringify(body) });
    if (res.getResponseCode() !== 200) {
      throw new Error('Drive could not convert "' + name + '" to a Google Sheet. ' +
        'Response ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    }
    var id = JSON.parse(res.getContentText()).id;
    unshare_(id, name);
    return id;
  }

  /* Every permission on the temp copy except its owner's, removed. Belt to the
     private-parent braces: it costs one list call and it is the only thing
     that can prove nobody else can reach the file. A failure here is a warning
     and not a throw — the file is trashed either way, and refusing to sync
     because a tidy-up call failed would stop the pipeline over nothing. */
  function unshare_(fileId, name) {
    try {
      var res = driveFetch_(DRIVE_V3 + encodeURIComponent(fileId) +
                            '/permissions?supportsAllDrives=true&fields=permissions(id,role)',
                            { method: 'get' });
      if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
      var perms = (JSON.parse(res.getContentText()).permissions || []);
      perms.forEach(function (pm) {
        if (pm.role === 'owner') return;
        driveFetch_(DRIVE_V3 + encodeURIComponent(fileId) + '/permissions/' +
                    encodeURIComponent(pm.id) + '?supportsAllDrives=true', { method: 'delete' });
      });
    } catch (e) {
      APP_log('warn', 'QLIKSYNC.convert', 'could not strip the temp sheet\u2019s sharing — it may be ' +
              'visible to whoever the export is shared with until it is trashed',
              { file: name, fileId: fileId, error: String(e) });
    }
  }

  /* Trashed, and permanently deleted if trashing will not take. It is a file
     this run created seconds ago, named "~qliksync temp", holding nothing that
     is not already in the export — so leaving one behind on every sync is the
     worse outcome. */
  function trashFile_(fileId) {
    try { DriveApp.getFileById(fileId).setTrashed(true); return; }
    catch (e) {
      try {
        var res = driveFetch_(DRIVE_V3 + encodeURIComponent(fileId) + '?supportsAllDrives=true',
                              { method: 'delete' });
        if (res.getResponseCode() < 300 || res.getResponseCode() === 404) return;
        throw new Error('HTTP ' + res.getResponseCode());
      } catch (e2) {
        APP_log('warn', 'QLIKSYNC.trashFile', 'the temp sheet could not be removed — it stays in ' +
                'Drive', { fileId: fileId, error: String(e), deleteError: String(e2) });
      }
    }
  }

  /* ---- LEFTOVERS ---------------------------------------------------------
     readExport_ trashes its temp copy in a `finally`, which covers every way
     the read can fail — except the one that matters most here. Apps Script
     kills an execution at the runtime limit; `finally` does not run, and the
     copy is stranded. That kill is not hypothetical for this pipeline: it is
     what the formula band's run-at-a-time batching exists to avoid, and it
     used to report "failed" over tabs that had written correctly.

     Every sync makes a copy — the exports are .xls and there is no reading one
     in place — so a stranded file is not a one-off, it is a slow leak in the
     script account's Drive. This is the only thing that clears them.

     IT IS NO LONGER THE ONLY ENGINE MAKING THEM. §10's TPMAIL converts the
     weekly SAP attachment through convertToSheet_ as well, so a copy this
     sweep trashes may have been made by the transfer-price trigger rather than
     by a sync. Matching on the prefix rather than on who made it is what lets
     that be true without this function knowing anything about TP01.

     THREE GUARDS, because this trashes files. The name must actually start
     with the prefix (Drive's `title contains` is looser than it looks), it
     must be a Google Sheet, and it must be over an hour old so a copy another
     execution is reading right now can never be taken out from under it.
     Trashed, never permanently deleted: recoverable is the right default for
     anything this decides on its own. */
  var TEMP_MIN_AGE_MS = 60 * 60 * 1000;
  var TEMP_SWEEP_CAP  = 50;          // a backlog must not eat the runtime budget

  function sweepTemps_() {
    var found = 0, trashed = 0;
    try {
      var q = 'title contains "' + TEMP_PREFIX + '"' +
              ' and mimeType = "application/vnd.google-apps.spreadsheet"' +
              ' and trashed = false';
      var it = DriveApp.searchFiles(q), cutoff = Date.now() - TEMP_MIN_AGE_MS;
      while (it.hasNext() && found < TEMP_SWEEP_CAP) {
        var f = it.next();
        found++;
        if (String(f.getName()).indexOf(TEMP_PREFIX) !== 0) continue;
        if (f.getDateCreated().getTime() > cutoff) continue;
        try { f.setTrashed(true); trashed++; }
        catch (e) {
          APP_log('warn', 'QLIKSYNC.sweep', 'a stranded temp sheet would not trash',
                  { fileId: f.getId(), error: String(e) });
        }
      }
    } catch (e) {
      /* Not silent, and not fatal: a sweep that cannot run leaves files behind,
         which is untidy, while a sync that stops because of it is an outage. */
      APP_log('warn', 'QLIKSYNC.sweep', 'could not look for stranded temp sheets',
              { error: String(e) });
    }
    if (trashed) {
      APP_log('info', 'QLIKSYNC.sweep', 'trashed temp sheets a killed run left behind',
              { found: found, trashed: trashed });
    }
    return trashed;
  }

  /* Every tab of one export, as { name, hdr:[normalised], raw:[…], rows:[…] } */

  /* ===================================================================
   * THE COPY IS NOT FINISHED WHEN DRIVE SAYS THE FILE EXISTS.
   * -------------------------------------------------------------------
   * files/copy returns as soon as the file RECORD is there, and it returns the
   * id the moment it has one — but converting tens of thousands of rows of
   * Excel into a Google Sheet is not instant, and the sheet is readable while
   * it is still filling. Open it straight away and getDataRange() answers with
   * however much has landed, truthfully and short, with no error anywhere: a
   * 47,634-row export read as 1,113 rows, written to the tab as 1,113 rows,
   * and — since the sheet ends exactly where the export ends — the other
   * 46,000 DELETED to match.
   *
   * IT IS NOT A RACE, AND IT IS NOT THE CONVERSION THAT IS SLOW. Lengthening
   * the wait from about a second and a half to about six moved the Aggregates
   * tab from 1,113 rows to 2,224 — twice the wait, twice the rows, the same
   * file — which reads like a fill in progress and is not one. The poll below
   * settled that: asked over REST, the copy holds all 47,845 rows by its
   * SECOND look, about four seconds in, and has stopped changing. The file is
   * finished. What is still catching up is SPREADSHEETAPP'S VIEW OF IT, and it
   * catches up far too slowly to wait out — the doubling was that view
   * advancing, not rows landing.
   *
   * WHICH IS WHY THE READ HAS A SECOND HALF NOW. The wait makes sure the file
   * is done, and readExport_ measures what SpreadsheetApp gave it against what
   * the poll says the tab holds; a short answer is read again over the same
   * REST calls the poll is made of, which have just been proved on that exact
   * file in that exact execution. It is not about size and not about .xls
   * against .xlsx — every one of these exports is .xlsx, and both of those
   * were guessed and both were wrong.
   *
   * SO THE WAIT HAS TO WATCH A NUMBER THAT MOVES WHILE DRIVE IS FILLING, and
   * three were tried before one did:
   *
   *   SpreadsheetApp.getLastRow(), flushed before each look. flush() pushes
   *   THIS EXECUTION'S pending writes out to the server; it says nothing about
   *   a file Drive's converter is filling behind the script's back, and the
   *   Spreadsheet service answers the second look out of the first look's
   *   snapshot. Two looks that agree because nothing re-read.
   *
   *   Drive's file `version`. It moves when a user or an API call changes the
   *   file. The converter's own writing does not bump it, so it is stable from
   *   the first look — the wait agrees with itself immediately and returns
   *   after six seconds. That is exactly what shipped, and exactly why the row
   *   count doubled instead of arriving.
   *
   *   gridProperties.rowCount. The tab's ALLOCATED height, which Drive is free
   *   to size before it fills a cell of it. It is still asked for, because a
   *   values.get whose range runs past the end of a sheet answers HTTP 400
   *   rather than with fewer rows — but it bounds the probe, it does not end
   *   the wait.
   *
   * WHAT DOES MOVE IS THE NUMBER OF ROWS THAT HOLD SOMETHING, and the Sheets
   * REST API reports it live. So the poll asks values.get for the rows
   * themselves — and only for the ones it has not already seen: a window
   * starting at the frontier the last look found, walked forward until a
   * window comes back short. The first look on an empty copy costs one small
   * call per tab, every later look costs one more, and the whole wait reads
   * the equivalent of the probe columns once.
   *
   * THE TAB LIST IS ASKED EVERY LOOK, never cached, because Drive adds the
   * tabs one at a time as well: a copy reporting one tab now can report four
   * in thirty seconds, and a cached list is a way of settling happily on a
   * third of a file.
   *
   * BUDGET. This runs inside a six-minute execution that still has the export
   * to read and tens of thousands of rows to write afterwards, so the wait is
   * capped by its own ceiling AND by what is left of a five-minute slice of
   * the execution, whichever is nearer — but never below a floor, because a
   * wait that gives up early is the whole of the bug it exists to fix.
   *
   * IT STILL DOES NOT THROW WHEN IT GIVES UP, and the checks are still why. A
   * copy still growing after the budget is unusual and not proof of anything;
   * what stands between a short read and a wrecked tab is checkSource_, which
   * measures what came back from the READ against what this poll says the copy
   * actually holds. That comparison is the one check in the file that needs no
   * history to make it — see check 0.
   *
   * AND IT NEEDS THE SHEETS API SWITCHED ON. Not a scope — the API itself, in
   * the Cloud project behind the script, which a default Apps Script project
   * has switched OFF while Drive's is on. appsscript.json carries it as an
   * advanced service for exactly this reason and for no other: nothing in this
   * file calls the `Sheets` symbol, so an editor tidying unused services away
   * would take the wait's only working signal with it. See the Sheets REST row
   * in APP_verifyPermissions.
   * ================================================================= */

  /* Not a Drive endpoint, but the same authenticated GET on the same token, so
     driveFetch_ is what makes the call. */
  var SHEETS_V4 = 'https://sheets.googleapis.com/v4/spreadsheets/';

  /* WHETHER THE SHEETS REST API IS ANSWERING AT ALL, for this execution.

     IT IS NOT AN OAUTH QUESTION AND THE 403 IT RETURNS SAYS SO — "Google
     Sheets API has not been used in project NNN before or it is disabled". The
     scope is granted (SpreadsheetApp has always worked), the token is fine
     (the Drive REST calls above go through on it); what is off is the API
     itself. Nothing the script can do at runtime grants it and no consent
     screen will appear.

     ONE REFUSAL IS ENOUGH. The poll makes dozens of looks per export; asking
     again costs half a second each and answers the same. */
  var SHEETS_API_OFF = false;

  /* A REFUSAL AND A BAD REQUEST ARE NOT THE SAME EVENT. Only 401/403 means the
     API is not available to this script; anything else is one call going wrong
     and the next look asks again. Switching the poll off for the rest of the
     execution over a transient 500 would cost the wait its only working
     signal. */
  function sheetsFatal_(code) { return code === 401 || code === 403; }

  function sheetsOff_(res, file) {
    SHEETS_API_OFF = true;
    /* NOT SILENT (§7). The sync goes on without it, but blind: it can no
       longer see the copy fill, so the wait falls back to a fixed sleep, and
       check 0 — the one that measures the read against the file — cannot run
       at all. Losing a check quietly is how the failure this all came from
       lasted as long as it did. */
    APP_log('warn', 'QLIKSYNC.read', 'the Sheets API is not answering, so this run cannot watch ' +
            'the converted copy fill and cannot check that it read each export whole — put the ' +
            'Sheets advanced service back into appsscript.json (dependencies.' +
            'enabledAdvancedServices: userSymbol "Sheets", version "v4", serviceId "sheets"), or ' +
            'add it from the Apps Script editor ▸ Services ▸ Google Sheets API, then run ' +
            'APP_verifyPermissions',
            { file: file, http: res.getResponseCode(),
              answer: res.getContentText().slice(0, 200) });
  }

  /* The copy's tabs, live, as [{ title, cap }] — cap being the tab's ALLOCATED
     height. The titles are what the walk below iterates; the cap is what keeps
     it inside the grid, because values.get answers a range that runs past the
     end of a sheet with HTTP 400 rather than with fewer rows. */
  function tabGrid_(ssId, file) {
    var r = driveFetch_(SHEETS_V4 + encodeURIComponent(ssId) +
                        '?fields=sheets.properties(title,gridProperties(rowCount))',
                        { method: 'get' });
    if (r.getResponseCode() !== 200) {
      if (sheetsFatal_(r.getResponseCode())) sheetsOff_(r, file);
      return null;
    }
    return (JSON.parse(r.getContentText()).sheets || []).map(function (sh) {
      var pr = sh.properties || {}, gp = pr.gridProperties || {};
      return { title: String(pr.title || ''), cap: Number(gp.rowCount || 0) };
    });
  }

  /* HOW MANY ROWS OF ONE TAB HOLD ANYTHING. The search starts at `from`, so a
     look only pays for what has landed since the last one.

     THE PROBE IS A BAND OF COLUMNS AND NOT ONE COLUMN. values.get trims the
     trailing empty rows out of its answer, which is what makes a window's
     length mean "the last row in this window with something in it" — but only
     for the columns asked about, and an export whose first column has gaps
     would end the walk on a hole. Five columns is enough that a row blank
     across all of them is the end of the data rather than a gap in it.

     A FULL WINDOW IS NOT AN ANSWER, it is "keep going": the fill runs past the
     end of what was asked for, so the walk moves on a window and asks again. */
  var PROBE_LAST_COL = 'E', PROBE_WINDOW = 20000, PROBE_MAX_WALK = 60;

  function filledTo_(ssId, title, from, cap, file) {
    var at = Math.max(1, from), walks = 0;
    if (!cap || at > cap) return from - 1;          /* nothing new can be there */
    while (walks++ < PROBE_MAX_WALK) {
      var end = Math.min(cap, at + PROBE_WINDOW - 1), span = end - at + 1;
      var a1 = "'" + String(title).replace(/'/g, "''") + "'!A" + at + ':' +
               PROBE_LAST_COL + end;
      var r = driveFetch_(SHEETS_V4 + encodeURIComponent(ssId) + '/values/' +
                          encodeURIComponent(a1) +
                          '?valueRenderOption=UNFORMATTED_VALUE&fields=values',
                          { method: 'get' });
      if (r.getResponseCode() !== 200) {
        if (sheetsFatal_(r.getResponseCode())) sheetsOff_(r, file);
        else {
          APP_log('warn', 'QLIKSYNC.read', 'a look at how far the converted copy has filled did ' +
                  'not answer — the wait carries on without this one',
                  { file: file, tab: title, range: a1, http: r.getResponseCode(),
                    answer: r.getContentText().slice(0, 200) });
        }
        return null;
      }
      var got = (JSON.parse(r.getContentText()).values || []).length;
      if (got < span) return at + got - 1;
      if (end >= cap) return cap;
      at = end + 1;
    }
    return at - 1;
  }

  /* THE TAB ITSELF, THROUGH THE API THAT COULD SEE IT. The poll above and the
     read below disagree about how tall a tab is more often than either of them
     is wrong about anything else, and only one of the two has ever been caught
     answering short: SpreadsheetApp. So when it does, the rows are fetched over
     the same REST calls the poll is made of, which have just been proved on
     this exact file, in this exact execution, to see every row of it.

     UNFORMATTED_VALUE, so a date arrives as an Excel serial rather than as
     text. That is what monthText_ and monthYM_ already expect from an export —
     both carry a serial branch — and it is the rendering closest to what
     getValues() hands back.

     A WINDOW THAT IS NOT THE LAST ONE KEEPS ITS FULL HEIGHT. values.get trims
     the trailing empty rows out of its answer, which is exactly what makes the
     poll work and exactly what would shift every row below a gap up by the size
     of the gap here.

     AND THE RESULT IS A RECTANGLE, because getValues() answers one and
     everything downstream assumes it — check 1 asserts it outright. */
  var READ_WINDOW = 10000;

  function restRead_(ssId, title, upto, file) {
    var out = [], at = 1, wide = 0, i, k;
    while (at <= upto) {
      var end = Math.min(upto, at + READ_WINDOW - 1);
      var a1 = "'" + String(title).replace(/'/g, "''") + "'!" + at + ':' + end;
      var r = driveFetch_(SHEETS_V4 + encodeURIComponent(ssId) + '/values/' +
                          encodeURIComponent(a1) +
                          '?valueRenderOption=UNFORMATTED_VALUE&fields=values',
                          { method: 'get' });
      if (r.getResponseCode() !== 200) {
        if (sheetsFatal_(r.getResponseCode())) sheetsOff_(r, file);
        APP_log('warn', 'QLIKSYNC.read', 'the second read of a short tab did not answer either ' +
                '\u2014 the short read stands, and check 0 is what stops it being written',
                { file: file, tab: title, range: a1, http: r.getResponseCode(),
                  answer: r.getContentText().slice(0, 200) });
        return null;
      }
      var vals = JSON.parse(r.getContentText()).values || [];
      for (i = 0; i < vals.length; i++) {
        if (vals[i].length > wide) wide = vals[i].length;
        out.push(vals[i]);
      }
      if (end < upto) for (k = vals.length; k < end - at + 1; k++) out.push([]);
      at = end + 1;
    }
    for (i = 0; i < out.length; i++) {
      for (k = out[i].length; k < wide; k++) out[i].push('');
    }
    return out;
  }

  /* WHERE THE CONVERSION HAS GOT TO: { version, modified, tabs: { title: rows }
     | null }. `was` is the previous look, so each tab's walk starts where the
     last one finished.

     DRIVE FIRST AND UNCONDITIONALLY. Its version and modified time are the
     half that always answers — the Drive API is on in every Apps Script
     project by construction, since this file could not convert an export
     without it — and they are what a run with the Sheets API off has instead
     of nothing. They do not move while the converter writes, which is why they
     are not allowed to end the wait on their own (see settle_).

     It throws only when DRIVE cannot answer; the caller decides what that is
     worth. */
  function copyState_(ssId, was, file) {
    var d = driveFetch_(DRIVE_V3 + encodeURIComponent(ssId) +
                        '?supportsAllDrives=true&fields=version,modifiedTime', { method: 'get' });
    if (d.getResponseCode() !== 200) {
      throw new Error('Drive answered HTTP ' + d.getResponseCode() + ': ' +
                      d.getContentText().slice(0, 200));
    }
    var meta = JSON.parse(d.getContentText());
    var out = { version:  String(meta.version || ''),
                modified: String(meta.modifiedTime || ''),
                tabs:     null };
    if (SHEETS_API_OFF) return out;

    var grid = tabGrid_(ssId, file);
    if (!grid) return out;

    var tabs = {}, had = (was && was.tabs) || {};
    for (var i = 0; i < grid.length; i++) {
      var t = grid[i].title, seen = had[t] || 0;
      var now = filledTo_(ssId, t, seen + 1, grid[i].cap, file);
      if (now === null) return out;          /* the API stopped answering mid-walk */
      tabs[t] = Math.max(now, seen);         /* a frontier never goes backwards */
    }
    out.tabs = tabs;
    return out;
  }

  /* One look as a comparable string. Object key order is not guaranteed and
     two looks that differ only in it are the same look, so the tabs are sorted
     rather than handed to JSON.stringify as they come. */
  function stateKey_(s) {
    var parts = [s.version, s.modified];
    if (s.tabs) Object.keys(s.tabs).sort().forEach(function (t) { parts.push(t + '=' + s.tabs[t]); });
    else        parts.push('tabs?');
    return parts.join('|');
  }

  /* HOW LONG TO WAIT FOR A CONVERTED COPY TO STOP GROWING.

     TWO CONSECUTIVE AGREEING LOOKS, NOT ONE. A conversion does not fill at a
     constant rate — it pauses between tabs, and a pause landing across a
     single gap reads exactly like a finished file.

     THE GAP GROWS. A copy that has been filling for two minutes is not going
     to be caught out by a look every second, and the early looks are the cheap
     ones. */
  var SETTLE_STABLE = 2;
  var SETTLE_GAP_MS = 2000, SETTLE_GAP_MAX = 10000, SETTLE_GAP_GROW = 1.4;

  /* The ceiling on the wait, the floor under it, and the slice of the
     execution it may not eat into. Six minutes is the whole budget; five is
     what this may spend of it, because the export still has to be read and
     written after the wait returns.

     THE FLOOR WINS OVER THE BUDGET, and it is longer than the blind wait below
     so that a blind wait always finishes inside its own ceiling rather than
     falling out of the loop reporting a copy that is "still growing". A run
     that has already spent its slice is a run about to be killed at the
     six-minute limit; being killed during the WAIT costs a stranded temp copy
     the sweep clears, while giving up on the wait costs a truncated tab.

     AND THE WRITE IS RESERVED FOR OUT OF THAT SLICE, WHICH IT USED NOT TO BE.
     The arithmetic was `EXEC_SAFE_MS minus what this run has already spent`,
     which on a fresh execution is the whole five minutes — so a wait allowed to
     run to its 240-second ceiling left SIXTY seconds for the conversion to be
     read and 82,200 rows of Ready-Mix to be written, and there is no version of
     that which finishes. The failure it produced is the one this reserve is
     named after: two tabs written, the third refused 5,000 rows in, a retry
     armed and the same four minutes spent waiting all over again.

     WHAT THE TWO OUTCOMES COST IS NOT SYMMETRICAL, and that is the whole
     argument for taking the time off the wait rather than off the write. A wait
     cut short reads a copy that may still be filling — and check 0 catches
     exactly that, refuses the tab, leaves it as it was and arms the retry. A
     write cut short is the failure with no floor under it: the rows stop
     arriving mid-flush, nothing throws, and only the per-tab budget check
     stands between that and a tab stamped as synced. So the wait gives way.

     THREE MINUTES, WHICH IS THE HEAVIEST PAGE'S WRITE WITH ROOM OVER IT.
     Ready-Mix was measured at about 165 seconds for its 82,200 rows, and the
     month-column caching above takes a large bite out of that. It leaves the
     wait 120 seconds on a fresh execution, against the four seconds the poll
     has ever actually needed to watch a copy stop filling — this is a ceiling
     on a pathological conversion, not a budget the normal case spends. */
  var SETTLE_CEIL_MS = 240000, SETTLE_FLOOR_MS = 60000, EXEC_SAFE_MS = 300000;
  var WRITE_RESERVE_MS = 180000;

  /* This execution's own start. The module body runs once, when the script
     loads, which is near enough to it for a budget. */
  var EXEC_T0 = Date.now();

  /* What to do when the fill cannot be watched at all — Drive refusing, or the
     Sheets API switched off. Wait a fixed moment, then read. It is a worse
     answer than watching and a better one than not waiting, and it is sized by
     the measurement in the banner rather than by optimism. */
  var SETTLE_BLIND_MS = 45000;

  function settle_(ssId, name) {
    var t0 = Date.now(), prev = null, last = null, stable = 0, looks = 0, gap = SETTLE_GAP_MS;
    var ceiling = Math.max(SETTLE_FLOOR_MS,
                           Math.min(SETTLE_CEIL_MS,
                                    EXEC_SAFE_MS - WRITE_RESERVE_MS - (Date.now() - EXEC_T0)));

    while (Date.now() - t0 < ceiling) {
      var now;
      try { now = copyState_(ssId, last, name); }
      catch (e) {
        /* NOT SILENT (§7). Without the poll the read is timed by hope again,
           and the only thing left between a half-converted copy and the tab is
           check 0 — which cannot run either, because it is this call that
           gives it the number to compare against. */
        APP_log('warn', 'QLIKSYNC.read', 'Drive could not say whether the converted copy is ' +
                'still being written — waiting a fixed moment instead, and this run has nothing ' +
                'to check the read against', { file: name, error: String(e && e.message || e) });
        Utilities.sleep(SETTLE_BLIND_MS);
        return null;
      }
      looks++;
      last = now;
      var key = stateKey_(now);
      if (key === prev) stable++;
      else { prev = key; stable = 0; }

      /* SETTLED — BUT ONLY IF THE POLL COULD SEE THE FILL. With the tab
         numbers, agreement means the rows stopped arriving. Without them the
         only thing agreeing with itself is Drive's version, which agrees from
         the first look whatever the converter is doing, so a blind wait is
         served its full length instead of being allowed to finish early on a
         number that never moves. */
      if (stable >= SETTLE_STABLE && (now.tabs || Date.now() - t0 >= SETTLE_BLIND_MS)) {
        if (now.tabs) {
          APP_log('info', 'QLIKSYNC.read', 'the converted copy has stopped filling',
                  { file: name, looks: looks, seconds: Math.round((Date.now() - t0) / 1000),
                    rows: stateKey_(now) });
        }
        return now.tabs;
      }

      Utilities.sleep(gap);
      gap = Math.min(SETTLE_GAP_MAX, Math.round(gap * SETTLE_GAP_GROW));
    }

    APP_log('warn', 'QLIKSYNC.read', 'the converted copy was still growing when the wait ran ' +
            'out — it is read as it stands, and check 0 is what stops a short read being written',
            { file: name, after: prev, looks: looks,
              seconds: Math.round((Date.now() - t0) / 1000),
              ceiling: Math.round(ceiling / 1000) });
    return last ? last.tabs : null;
  }

  function readExport_(file) {
    var tempId = null, books = [];
    try {
      var ssId = (file.mime === 'application/vnd.google-apps.spreadsheet')
                 ? file.id
                 : (tempId = convertToSheet_(file.id, file.name));
      /* Only a CONVERTED copy can still be filling. A file that was already a
         Google Sheet was not written by this run and is whatever it is.

         NOTHING ABOVE THIS LINE MAY OPEN THE COPY WITH SpreadsheetApp — see the
         banner. The service snapshots a spreadsheet on an execution's first
         look at it, so one early call freezes a half-converted grid in front of
         every read that follows, settle_'s own included. */
      var grid = tempId ? settle_(ssId, file.name) : null;

      /* One tab, however its rows were come by. `holds` is what the poll says
         the file has in that tab and 0 when there was nothing to ask (a source
         that was already a Google Sheet, or a poll that could not run) — kept
         beside the height the READ came back with, because this is the last
         point at which the two numbers exist together. Everything downstream
         sees rows that are perfectly well formed and cannot tell a truncated
         read from a short export; check 0 compares these two. */
      function book_(tab, values, holds) {
        if (!values.length) return;
        var h = srcHeaderRow_(values);
        books.push({
          file:  file.name,
          name:  tab,
          hdr:   values[h].map(APP_hdrNorm_),
          rows:  trimGrid_(values.slice(h + 1)),
          hdrRaw: values[h],
          readRows: values.length,
          gridRows: holds
        });
      }

      var ss = SpreadsheetApp.openById(ssId), seen = {};
      ss.getSheets().forEach(function (sh) {
        var tab = sh.getName();
        seen[tab] = 1;
        var values = sh.getDataRange().getValues();
        var holds  = (grid && grid[tab]) || 0;

        /* BOTH NUMBERS, EVERY TAB, EVERY RUN, AT info. Not only when they
           disagree: "they agreed" is the line that says the read is sound, and
           its absence from a log is how a run that never got this far tells
           you where it stopped. */
        if (holds) {
          APP_log('info', 'QLIKSYNC.read', 'read a tab of the export',
                  { file: file.name, tab: tab, read: values.length, holds: holds });
        }

        /* AND IF THEY DISAGREE, ASK THE OTHER ONE. The poll has just walked
           this file over REST and found every row of it; SpreadsheetApp is the
           half that has been caught answering short. So a short answer is not
           accepted — the tab is read again through the API that could see it,
           and the run carries on with whichever read is taller. Ten rows of
           slack because the poll measures a band of columns and the read
           measures the whole tab, and the two can differ by a hair at the
           bottom without anything being wrong. */
        if (holds && values.length < holds - 10) {
          APP_log('warn', 'QLIKSYNC.read', 'SpreadsheetApp read this tab short of what the ' +
                  'server reports for it — reading it again over the Sheets API instead',
                  { file: file.name, tab: tab, read: values.length, holds: holds });
          var again = restRead_(ssId, tab, holds, file.name);
          if (again && again.length > values.length) {
            APP_log('info', 'QLIKSYNC.read', 'the second read came back whole',
                    { file: file.name, tab: tab, was: values.length, now: again.length });
            values = again;
          }
        }

        book_(tab, values, holds);
      });

      /* A tab the server lists that the read did not return AT ALL — the same
         event as a short read, one step further along, and answered the same
         way: the rows are fetched over REST rather than the tab being written
         off. It is logged either way, because pickSource_'s own report names
         the SHEET tab that went unfed and this names the export tab that never
         arrived, and only the two together say why. */
      if (grid) {
        Object.keys(grid).forEach(function (t) {
          if (seen[t] || !grid[t]) return;
          APP_log('warn', 'QLIKSYNC.read', 'the converted copy holds a tab SpreadsheetApp did ' +
                  'not return at all — reading it over the Sheets API instead',
                  { file: file.name, tab: t, rows: grid[t] });
          var got = restRead_(ssId, t, grid[t], file.name);
          if (got && got.length) book_(t, got, grid[t]);
        });
      }
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

    /* Named tab (the Product Segment export). */
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
        if (canonHdr.indexOf(canon_(APP_hdrNorm_(spec.match[m]))) === -1) { ok = false; break; }
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
   * 5b. THE FORMULA BAND, WHILE A TAB IS BEING WRITTEN
   * ---------------------------------------------------------------------
   * THE BAND COMES OUT BEFORE THE WRITE AND GOES BACK STRAIGHT AFTER IT, AND
   * THIS IS ABOUT SPEED. It was changed the other way on 2026-08-23 with the
   * note "clearing the whole band bought nothing and cost everything", and the
   * first half of that was wrong.
   *
   * What it bought is the recalculation. "Combined Data CPI Raw" carries a
   * single-cell ARRAY formula on its first data row —
   *
   *   =IF(B3:B47634="", "", UPPER(SUBSTITUTE(TEXT(K3:K47634 & B3:B47634 & …))))
   *
   * — and a totals row above it summing M3:M47634 and five columns beside it.
   * Every setValues into a mapped column is a change to the range that array
   * formula reads, so the sheet re-evaluates a hundred and forty thousand
   * string operations plus six full-column sums BEFORE THE NEXT WRITE CAN GO
   * IN, dozens of times over a 47,000-row export. That is what turned a write
   * that used to finish into one that does not: the run dies partway down with
   * SpreadsheetApp reporting the workbook as "missing", the mapped columns are
   * already cleared to the bottom, and the tab is left holding eleven hundred
   * rows and a half-written one at the boundary. WITH THE BAND OUT there is
   * nothing on the tab to recalculate and the write is a write.
   *
   * WHAT IT COST WAS REAL TOO, and it is the half worth keeping: the restore
   * used to run ONCE, after the last tab of the workbook, so a run killed
   * anywhere in between deleted every anchor for good — and the next run found
   * no formula to lift out, so they never came back on their own.
   *
   * BOTH, THEN. The band goes back as soon as THIS tab is written, not at the
   * end of the workbook, so the window it is absent for is one tab's write
   * rather than a whole pass. And before it comes out it is PARKED in a script
   * property, so the window survives the one thing a `finally` does not: Apps
   * Script killing the execution. The next run puts a parked band back before
   * it touches the tab.
   *
   * A BAND THAT WILL NOT FIT IN A PROPERTY IS NOT TAKEN OUT AT ALL. Nine
   * kilobytes is the limit and these bands are a few hundred bytes; if one is
   * ever bigger, the write falls back to the minimal clear below and is slow,
   * which is the right way round — slow is a state that finishes.
   * =================================================================== */

  var BAND_PARK_PREFIX = 'QLIK_BAND_PARK::', BAND_PARK_MAX = 8000;

  function bandKey_(spec) { return BAND_PARK_PREFIX + spec.page + '::' + spec.tab; }

  function park_(spec, firstData, band, nCols) {
    var payload;
    try { payload = JSON.stringify({ firstData: firstData, nCols: nCols, band: band, at: Date.now() }); }
    catch (e) { payload = ''; }
    if (!payload || payload.length > BAND_PARK_MAX) {
      APP_log('warn', 'QLIKSYNC.write', 'the formula band is too big to park, so it stays on the ' +
              'tab while it is written — the write will be slower because the sheet recalculates ' +
              'between blocks', { tab: spec.tab, bytes: payload ? payload.length : 0 });
      return false;
    }
    try { PropertiesService.getScriptProperties().setProperty(bandKey_(spec), payload); return true; }
    catch (e) {
      /* Not silent (§7): without the park there is nothing to put the band back
         if this execution is killed, so the write keeps it in place instead. */
      APP_log('warn', 'QLIKSYNC.write', 'the formula band could not be parked, so it stays on the ' +
              'tab while it is written', { tab: spec.tab, error: String(e && e.message || e) });
      return false;
    }
  }

  function dropPark_(spec) {
    try { PropertiesService.getScriptProperties().deleteProperty(bandKey_(spec)); }
    catch (e) {
      /* NOT SILENT (§7). A park that outlives the band's return is not lost
         data — the band is back on the tab — but the next run writes this tab
         from a copy it did not take, on a first data row it did not find. Today
         both are the same as what it would have read; the day they are not,
         nothing would say where the numbers came from. */
      APP_log('warn', 'QLIKSYNC.write', 'the parked copy of the formula band could not be ' +
              'cleared — the next run will take this tab\u2019s band and first data row from a ' +
              'copy this run made rather than from the tab',
              { tab: spec.tab, page: spec.page, error: String(e && e.message || e) });
    }
  }

  /* Every formula of a band written back, re-pointed at the heights given.
     `ends` empty means only the tab's OWN ranges move — a reference into
     another tab of the workbook is left exactly as it was, for the pass at the
     end of run() to fix once every tab has its final height.

     RETURNS WHETHER EVERY RUN ACTUALLY WENT BACK, and both callers drop the
     park on that answer rather than on having reached this line. A band still
     off the tab with its park deleted is the one state the park exists to make
     impossible: nothing on the sheet, and nothing anywhere else either. */
  function putBand_(sh, band, ownEnd, ends, note) {
    var home = true;
    for (var r = 0; r < band.length; r++) {
      var runs = cellRuns_(band[r] || []);
      for (var q = 0; q < runs.length; q++) {
        var start = runs[q].start, len = runs[q].len, seg = new Array(len);
        for (var k = 0; k < len; k++) seg[k] = reanchor_(band[r][start + k], ownEnd, ends || {});
        try { sh.getRange(r + 1, start + 1, 1, len).setFormulas([seg]); }
        catch (e) {
          home = false;
          APP_log('error', 'QLIKSYNC.write', 'a formula could not be put back' + (note ? ' (' + note + ')' : ''),
                  { tab: sh.getName(), at: sh.getRange(r + 1, start + 1, 1, len).getA1Notation(),
                    error: String(e && e.message || e) });
        }
      }
    }
    return home;
  }

  /* A BAND AN EARLIER RUN TOOK OUT AND WAS KILLED BEFORE PUTTING BACK. It is
     the real band; the row on the tab is the empty one that run left behind.
     So it is READ here and handed to the write, which puts it back at the end
     the way it puts back one it lifted out itself.

     IT IS NOT PUT ON THE TAB FIRST, AND THAT COST A WHOLE RUN. It used to be:
     unpark_ wrote the band home and forty lines later writeColumns_ read it,
     parked it and cleared it again. Restoring six ARRAYFORMULAs onto a
     47,845-row tab is the full-column recalculation §5b takes the band out to
     avoid — 140,000 string operations and six column sums — and the sheet was
     still doing it when the write asked for the tab. On 08-24 that came back as
     "Service timed out: Spreadsheets" on BOTH Aggregates tabs, ~150 seconds
     spent producing nothing, and Ready-Mix and Product Segment then ran out of
     execution time behind it.

     IT CARRIES THE FIRST DATA ROW AND THAT IS NOT A CONVENIENCE. firstDataRow_
     finds that row by looking for a formula in a column the export does not
     feed — and with the band off the tab there is none on the first data row,
     so it finds the next row down of a foreign column that IS filled down and
     answers one row too low. Every row of the export would then be written one
     row out. The park was recorded by a run that could still see the band, so
     it is the answer that row-finding cannot reach; the alternative was
     writing the band back onto the tab purely so it could be looked at, which
     is what this whole change is removing.

     Returns { band, firstData }, or null when there is nothing parked. */
  function readPark_(spec) {
    var raw = null;
    try { raw = PropertiesService.getScriptProperties().getProperty(bandKey_(spec)); }
    catch (e) { return null; }
    if (!raw) return null;
    var p = null;
    try { p = JSON.parse(raw); } catch (e) { p = null; }
    if (!(p && p.band && p.band.length && p.firstData > 0)) { dropPark_(spec); return null; }
    APP_log('info', 'QLIKSYNC.write', 'an earlier run left this tab\u2019s formula band parked — ' +
            'writing from the parked copy and putting it back at the end',
            { tab: spec.tab, page: spec.page, firstData: p.firstData,
              parked: new Date(p.at || 0).toISOString() });
    return { band: p.band, firstData: p.firstData };
  }

  /* =====================================================================
   * 6. WRITE — 'columns' mode
   * =================================================================== */

  /* One header row, in the form the pairing below compares. */
  function hdrKeys_(row) {
    return (row || []).map(function (h) { return canon_(APP_hdrNorm_(h)); });
  }

  /* The sheet's header row: the one the most export columns can be paired
     against. The raw tabs carry a banner row above it — "Bill Year | PY | PY |
     CY", or the totals strip on Main Raw Data — and a banner scores nothing,
     because a bare period token with no figure beside it is not a column name
     and APP_periodMap_ does not index one. */
  function tgtHeaderRow_(probe, srcKeys, srcMap, spec) {
    var best = 0, bestScore = -1;
    for (var r = 0; r < probe.length; r++) {
      var map = APP_periodMap_(hdrKeys_(probe[r])), score = 0, taken = {};
      for (var sc = 0; sc < srcKeys.length; sc++) {
        if (!srcKeys[sc]) continue;
        var p  = APP_period_(srcKeys[sc]);
        var tc = APP_periodFind_(map, alias_(spec, p.base), p, srcMap.rankAt[sc]);
        if (tc !== -1 && !taken[tc]) { taken[tc] = 1; score++; }
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

  /* =====================================================================
   * THE MONTH COLUMN, AND THE TWO CACHES IN FRONT OF IT
   * ---------------------------------------------------------------------
   * BOTH FUNCTIONS BELOW ARE CALLED ONCE PER ROW OF AN EXPORT, and that is the
   * only thing about them that matters for the runtime. Ready-Mix writes 82,200
   * rows across its three tabs and every one of them carries a Bill Month, so
   * monthText_ runs 82,200 times a sync and latestMonth_ walks the column again
   * on top of that.
   *
   * A COLUMN OF 82,200 ROWS HOLDS ABOUT A DOZEN DISTINCT VALUES. It is a month
   * column: "Apr-26" repeats for every row of April. So the answer for a value
   * that has already been seen is the answer it gave last time — the mapping is
   * deterministic inside one execution, because the only thing it depends on
   * that is not the value itself is the script's time zone, which does not move
   * — and a cache in front of it turns tens of thousands of calls into a dozen.
   *
   * WHICH MATTERS BECAUSE OF WHAT monthText_ CALLS. Utilities.formatDate and
   * Session.getScriptTimeZone are not JavaScript: each one crosses out of the
   * V8 runtime into Apps Script's own services and back, and that crossing is
   * the expensive part, not the formatting. Two of them per row, 82,200 rows,
   * is on the order of a minute and a half of a six-minute execution spent
   * formatting the same twelve strings over and over — which is most of the
   * gap between a Ready-Mix sync that finishes and one that runs out of time
   * with its last tab half written.
   *
   * THE CACHE MEMOISES, IT DOES NOT REIMPLEMENT. Every branch below is the one
   * that was there before and Utilities.formatDate still produces every string
   * this returns; what changed is how many times it is asked. Rewriting
   * "MMM-yy" by hand in JavaScript would be faster still and would also be a
   * second implementation of a time zone, which is not a trade worth making
   * for a column nobody looks at twice.
   *
   * AND IT IS BOUNDED. A month column cannot grow one, but nothing here
   * enforces that the column IS a month column, so the cache empties itself
   * rather than assuming: a run that somehow puts 5,000 distinct values through
   * it starts again from empty and is merely as slow as it used to be.
   * =================================================================== */
  var MONTH_NAMES = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
                      jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };

  var MONTH_CACHE_MAX = 5000;
  var monthTextCache_ = {}, monthTextN_ = 0, monthTz_ = null;
  var monthYMCache_   = {}, monthYMN_   = 0;

  /* One export value as a cache key, or null for something not worth keying.
     A Date and the Excel serial for the same instant are different keys on
     purpose: the two branches below format them against different time zones,
     so they are not interchangeable and must not share an entry. */
  function monthKey_(v) {
    if (Object.prototype.toString.call(v) === '[object Date]') return 'd' + v.getTime();
    if (typeof v === 'number') return 'n' + v;
    return 's' + String(v == null ? '' : v);
  }

  /* The Bill Month cell as { y, m } (m is 0-based) — used to work out which
     month the exports are for, so the Product Segment's month picker can default
     to it. A value carrying no year is not readable and returns null.

     A FRESH OBJECT EVERY TIME, even on a cache hit. latestMonth_ hands what
     this returns straight out to a caller that keeps it, and handing out the
     cached object would let one caller's edit reach the next row's answer. */
  function monthYM_(v) {
    var ck = monthKey_(v), hit = monthYMCache_[ck];
    if (hit !== undefined) return hit ? { y: hit.y, m: hit.m } : null;

    var got = monthYMRead_(v);
    if (monthYMN_ >= MONTH_CACHE_MAX) { monthYMCache_ = {}; monthYMN_ = 0; }
    monthYMCache_[ck] = got; monthYMN_++;
    return got ? { y: got.y, m: got.m } : null;
  }

  function monthYMRead_(v) {
    var d = null, m;
    if (Object.prototype.toString.call(v) === '[object Date]') d = v;
    else if (typeof v === 'number') d = new Date(Math.round((v - 25569) * 86400000));
    if (d) return { y: d.getFullYear(), m: d.getMonth() };

    var s = String(v == null ? '' : v).trim();

    var mt = s.match(/^([A-Za-z]{3,})[\s\-\/.]*(\d{2,4})$/);
    if (!mt) return null;
    m = MONTH_NAMES[mt[1].slice(0, 3).toLowerCase()];
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

    /* A STRING IS ALREADY THE ANSWER and costs nothing to hand back, so it
       never reaches the cache — which is also what keeps the cache small when
       an export sends its months as text. */
    var isDate = Object.prototype.toString.call(v) === '[object Date]';
    if (!isDate && typeof v !== 'number') return String(v);

    var ck = monthKey_(v), hit = monthTextCache_[ck];
    if (hit !== undefined) return hit;

    var fmt = 'MMM-yy', out;
    if (isDate) {
      /* Asked once per execution rather than once per row. The script's time
         zone is a project setting; it cannot change under a running script. */
      if (monthTz_ === null) monthTz_ = Session.getScriptTimeZone();
      out = Utilities.formatDate(v, monthTz_, fmt);
    } else {                                            // Excel serial
      out = Utilities.formatDate(new Date(Math.round((v - 25569) * 86400000)), 'UTC', fmt);
    }

    if (monthTextN_ >= MONTH_CACHE_MAX) { monthTextCache_ = {}; monthTextN_ = 0; }
    monthTextCache_[ck] = out; monthTextN_++;
    return out;
  }

  /* Which year the EXPORT is current for, read off its ROWS. The Aggregates
     tabs keep it in a Year column, Ready-Mix on the Bill Month ("Jul-26").

     Nothing in the pairing needs it — that is settled by rank, which holds
     whatever the two sides call their periods. It is here because it is the
     one figure that says the sync read the file the way a person reading it
     would, and it goes back with the run so somebody can check it against the
     export they just dropped in Drive. */
  function srcCyYear_(src, keys) {
    var yc = -1, mc = -1;
    for (var i = 0; i < keys.length; i++) {
      if (yc < 0 && keys[i] === 'year')     yc = i;
      if (mc < 0 && keys[i] === 'monthcol') mc = i;
    }
    return APP_dataCyYear_(src.rows, yc) || APP_dataCyYear_(src.rows, mc);
  }

  /* The newest year the export's own HEADERS name, or 0 if they name none. */
  function hdrCyYear_(keys) {
    var best = 0;
    for (var i = 0; i < keys.length; i++) {
      var y = APP_period_(keys[i]).year;
      if (y > best) best = y;
    }
    return best;
  }

  function writeColumns_(sh, src, spec, plan) {
    var nCols = sh.getMaxColumns();

    var srcKeys = src.hdr.map(canon_);
    var srcMap  = APP_periodMap_(srcKeys);
    var dataYear = srcCyYear_(src, srcKeys), headYear = hdrCyYear_(srcKeys);

    /* --- where the header sits, and what each export column maps to --- */
    var probeRows = Math.min(8, sh.getMaxRows());
    var probe = sh.getRange(1, 1, probeRows, nCols).getValues();
    var head  = tgtHeaderRow_(probe, srcKeys, srcMap, spec);
    var hdrRow = head.row;
    var tgtMap = APP_periodMap_(hdrKeys_(probe[hdrRow - 1]));

    /* Export column  →  sheet column (1-based).

       PAIRING IS ON THE FIGURE AND THE PERIOD, NEVER ON THE LITERAL HEADER.
       "2026 Volume" and "CY Volume" are one column; so are "Fuel Surchage" and
       "Fuel Surcharge", which is a real defect and not a hypothetical — one
       missing letter in the export left that single column matching nothing
       while every other column on the tab wrote, so the surcharge sat at the
       previous export's figures and the tab looked healthy. APP_periodFind_
       decides all of it. What is left here is the two rules about repeats.

       THE SHEET MAY REPEAT A NAME AND THE EXPORT MAY NOT. "Combined Data CPI
       Raw" has carried two columns of one name; the export sends one. One
       export column against several sheet columns of that name is not
       ambiguous — it is the first of them, which is the one the index holds,
       and the rest are the sheet's own working columns, left untouched because
       `used` blocks a second write. The reverse IS ambiguous: an export
       repeating a name is reported unmatched, because nothing can say which of
       the two is which.

       THERE IS NO POSITIONAL FALLBACK ANY MORE. There was, and it is how PY
       revenue was quietly written into the wrong column for a whole run: a
       name that failed to match landed on whatever sat at the same index. A
       column that cannot be paired by name is reported, not guessed at. */
    var pairs = [], used = {}, unmatched = [], srcSeen = {};
    for (var i0 = 0; i0 < srcKeys.length; i0++) {
      if (srcKeys[i0]) srcSeen[srcKeys[i0]] = (srcSeen[srcKeys[i0]] || 0) + 1;
    }

    for (var sc = 0; sc < srcKeys.length; sc++) {
      var key = srcKeys[sc];
      if (!key || srcSeen[key] > 1) { if (key) unmatched.push(src.hdrRaw[sc]); continue; }
      var p    = APP_period_(key);
      var base = alias_(spec, p.base);
      var tc   = APP_periodFind_(tgtMap, base, p, srcMap.rankAt[sc]);
      if (tc === -1 || used[tc]) { unmatched.push(src.hdrRaw[sc]); continue; }
      used[tc] = 1;
      pairs.push({ src: sc, col: tc + 1, isMonth: (base === 'monthcol') });
    }
    if (!pairs.length) {
      throw new Error('None of the export columns matched "' + spec.tab + '". ' +
        'Export header: ' + src.hdrRaw.join(' | '));
    }

    /* THE GATE, AND ITS POSITION IN THIS FUNCTION IS THE WHOLE POINT.
       Nothing below this line is reversible: the band comes out, rows are
       inserted or DELETED to the export's height, and the mapped columns are
       overwritten. A tab that fails here is left exactly as it was — last
       week's figures, wrong by a week, which is a state a reader can recognise.
       What it replaces is this week's hole, which is not: a column of zeroes
       looks like a column of zeroes.

       It throws rather than returning, because run() already treats a throw as
       "this tab did not write" — it records the tab as failed, leaves the
       formula band alone, and carries on with the workbook's other tabs. */
    var check = checkSource_(spec, src, pairs, tabShape_(spec.page, spec.tab));
    if (!check.ok) throw checkError_(spec, check);

    /* THE CHECK THE YEAR BUYS. Where the export names years, the newest one it
       names should be the newest one its rows carry. When it is not, the file
       is not the file it claims to be — a stale export, or a tab from another
       era — and the run says so. The columns are still written: pairing is on
       rank, and rank is right either way. */
    if (dataYear && headYear && dataYear !== headYear) {
      APP_log('warn', 'QLIKSYNC.write', 'the export names a different year from the one its rows carry',
              { tab: spec.tab, headerYear: headYear, dataYear: dataYear });
    }

    /* HOW MANY OF THE EXPORT'S COLUMNS THIS RUN ACTUALLY WRITES, ON THE LOG OF
       EVERY RUN. Every named export column either pairs with a header on the
       tab and is written, or does not and is not — so `paired` + `unmatched` is
       the export's whole width, and the two numbers together are the answer to
       "did the tab get the columns the export sent".

       AN UNMATCHED COLUMN IS NOT A FAILURE AND MUST NOT BECOME ONE. It is
       exactly what a new year's column looks like before somebody adds it to
       the workbook — the sync never rewrites a header row — so refusing over
       one would stop the pipeline every January. What IS a failure is a column
       that paired on the last good run and pairs with nothing now, and
       checkSource_ above has already made that one. This is the line that
       makes the difference visible before anybody has to go looking, and it is
       returned as well, so a caller can compare it against the export. */
    if (unmatched.length) {
      APP_log('warn', 'QLIKSYNC.write', 'the export carries columns this tab has no header for — ' +
              'they are not written, which is what a new year\u2019s column looks like until ' +
              'somebody adds it to the workbook',
              { tab: spec.tab, paired: pairs.length, unmatched: unmatched.length,
                names: unmatched.join(', ') });
    } else {
      APP_log('info', 'QLIKSYNC.write', 'every column the export carries pairs with a header on ' +
              'the tab', { tab: spec.tab, paired: pairs.length });
    }

    /* THE BAND, FROM WHEREVER THE REAL ONE IS, AND BEFORE THE ROW IS LOOKED
       FOR — see readPark_ on why the row comes out of the park too. */
    var park      = readPark_(spec);
    var firstData = park ? park.firstData
                         : firstDataRow_(sh, hdrRow, pairs.map(function (p) { return p.col; }), nCols);
    var n         = src.rows.length;

    /* Everything from row 1 down to the first data row: the totals band and the
       array-formula anchors. Taken now, re-pointed and put back once every tab
       in this workbook has its final height.

       IT COMES OUT WHOLE, AND §5b IS WHY — the short version being that every
       write into a mapped column is a change to the range the LOOKUP KEY array
       formula reads, so leaving it in place makes the sheet recalculate 47,000
       rows of string work between one block of the write and the next until the
       execution dies partway down. Parked first, so a kill cannot lose it, and
       put back the moment this tab is written rather than at the end of the
       workbook's pass.

       WHEN IT CANNOT BE PARKED only the cells the write will land on are
       cleared, which is the older, slower, safe behaviour: the data write
       starts at firstData and touches the MAPPED columns only, so the one band
       cell it can collide with is a formula sitting in a mapped column on
       firstData itself. */
    var isMapped = {};
    pairs.forEach(function (p) { isMapped[p.col] = 1; });

    var band = park ? park.band : sh.getRange(1, 1, firstData, nCols).getFormulas();

    /* REGISTERED BEFORE ANYTHING DESTRUCTIVE RUNS. If the resize or the write
       throws, run() records the tab as failed and carries on — and the restore
       pass still has this entry, so the band goes back re-pointed instead of
       staying as the write left it. */
    var entry = { sh: sh, spec: spec, firstData: firstData, band: band, nCols: nCols,
                  /* the height the band was last put back against, and 0 while it
                     is still off the tab — see the restore pass at the end of
                     run(), which uses it to tell "already home" from "still out". */
                  homeEnd: 0 };
    plan.push(entry);

    /* A band already in the property does not need putting there again.

       THE CLEAR STILL RUNS EITHER WAY, and skipping it was tried: a parked
       band is USUALLY already off the tab, because the park is written and the
       cells are cleared one line apart — but a kill landing between those two
       leaves the property written and the band still sitting there, and this
       run would then write with the anchors in place, which is the
       recalculation that started all of this. Two clearContent calls against
       cells that are usually already empty is the cheap side of that. */
    var parked = park ? true : park_(spec, firstData, band, nCols);
    var cr;
    if (parked) {
      for (var br = 0; br < band.length; br++) {
        var wholeRuns = cellRuns_(band[br]);
        for (cr = 0; cr < wholeRuns.length; cr++) {
          sh.getRange(br + 1, wholeRuns[cr].start + 1, 1, wholeRuns[cr].len).clearContent();
        }
      }
    } else if (!parked) {
      var onWrite = (band[firstData - 1] || []).map(function (f, i) {
        return (f && isMapped[i + 1]) ? f : '';
      });
      var clearRuns = cellRuns_(onWrite);
      for (cr = 0; cr < clearRuns.length; cr++) {
        sh.getRange(firstData, clearRuns[cr].start + 1, 1, clearRuns[cr].len).clearContent();
      }
    }

    /* --- THE SHEET ENDS EXACTLY WHERE THE EXPORT DOES ---
       Every row is replaced on every run, so a correction made to a month that
       has already closed comes through: there is no history kept here that the
       export does not still carry. Surplus rows are DELETED rather than left
       blank, and that is deliberate — leaving them costs a January reading a
       December-sized sheet for eleven months, and no reader can tell an empty
       row from a row the export stopped sending.

       DELETING A ROW IS SAFE HERE, AND DELETING A COLUMN'S CONTENT IS NOT.
       Every formula on these tabs is a single-cell ARRAY formula anchored on
       the first data row — nothing is filled down, so a surplus row holds no
       formula of anybody's, only spill, and the anchor re-points at the new
       height afterwards. Rows below the data are the export's to give and take.
       The columns are the other way round: see the note above the band. */
    var target = Math.max(firstData, firstData + n - 1);
    var have   = sh.getMaxRows();
    if (target > have)      sh.insertRowsAfter(have, target - have);
    else if (target < have) sh.deleteRows(target + 1, have - target);
    var sheetEnd = sh.getMaxRows();

    /* --- clear then write, one block per contiguous run of columns ---

       THE CLEAR LOOKS REDUNDANT AND IS NOT. runs_() merges only strictly
       adjacent columns, so every column inside a block is a mapped one and the
       grid below fills every cell of every block row; the resize has just made
       the tab end exactly where the write ends. On a run that completes, the
       clear touches nothing the write does not immediately overwrite, and
       dropping it looks like a free saving on the pass that reaches the
       six-minute runtime limit.

       IT IS NOT FREE, AND THE RUN THAT DOES NOT COMPLETE IS THE WHOLE REASON.
       A kill mid-write does not throw anywhere this code can see — the rows
       simply stop arriving. Cleared first, the tail of that tab is BLANK: wrong,
       obvious, and detectable, which is exactly what the last-row check below
       reads. Not cleared, the tail still holds the PREVIOUS export's figures —
       last month's numbers under this month's heading, with nothing to tell
       them apart. That is the same failure wearing a disguise, and it is worth
       one API call per block to keep it undisguised.

       (This was tried the other way and reverted: with a write that lands
       short and no clear, the check below reads the OLD rows as evidence the
       write arrived and the run reports success.) */
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
         text before anything is written into it.

         IT IS SET EVERY RUN AND THAT WAS TRIED THE OTHER WAY. Skipping it when
         the column already reads '@' saves a write over 44,000 cells, and
         getNumberFormat on a range answers for the TOP-LEFT CELL ONLY — so a
         column whose middle had been pasted over would keep whatever format
         that paste brought, and Bill Month would come back as a date in the
         rows nobody looked at. Setting it unconditionally is the cheap half of
         that trade. */
      mine.forEach(function (p) {
        if (p.isMonth) sh.getRange(firstData, p.col, sheetEnd - firstData + 1, 1).setNumberFormat('@');
      });

      for (var off = 0; off < n; off += CHUNK) {
        /* STOP ON PURPOSE RATHER THAN BE STOPPED. Apps Script kills an
           execution at six minutes without running a `finally` and without
           throwing anywhere this code can see: the rows simply stop arriving
           mid-flush, which is why a killed write leaves a HALF-WRITTEN ROW at
           the boundary and no error anywhere. A throw here is the same tab in
           the same state, with three differences that decide everything — run()
           records it as failed, the mail says so, and `retryable_` arms the
           one-shot, so the tab is rewritten whole five minutes later instead of
           sitting truncated until somebody notices the numbers. The formula
           band goes back either way: it is registered in `plan` and parked in a
           property. */
        if (Date.now() - EXEC_T0 > EXEC_SAFE_MS) {
          throw retryable_('"' + spec.tab + '" ran out of execution time ' +
            off + ' rows into a ' + n + '-row write, so it was stopped before Apps Script could ' +
            'kill it mid-row. The tab is blank below row ' + (firstData + off - 1) + ' in the ' +
            'columns the sync owns; a retry has been armed and rewrites it whole.');
        }
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

    /* --- AND IT ALL LANDED ---
       The gate above checks the export. This checks the SHEET, and it is the
       only thing in the pass that can see the failure that started all of
       this: a tab that stops partway down with nothing reporting an error.

       Two reads, both single-row, because the expensive version of this check
       is not worth its own runtime — and a truncated write always shows in the
       same place. If the last row of the block is blank where the export's last
       row is not, the write did not reach the bottom.

       VALUES ARE NOT COMPARED, ON PURPOSE. Sheets coerces on the way in — a
       numeric string lands as a number, a date-shaped one as a date — so a
       cell-by-cell diff would fail on writes that are perfectly correct, and a
       check that cries wolf is worse here than no check at all. Presence is
       what a truncation destroys and presence is what is asked. */
    if (n > 0) {
      /* THE HEIGHT, EXACTLY — one row per export row from the first data row
         down, and nothing past it. The resize above made it so; this is the
         read-back that says it still is, and it is the check that costs
         nothing.

         BOTH DIRECTIONS ARE FAULTS AND THEY ARE DIFFERENT ONES. Too SHORT is a
         tab that could not be grown to fit the export, which is usually the
         workbook's ten-million-cell limit. Too TALL is surplus the resize did
         not take out — rows below the export's last one, holding whatever the
         previous export left there, and no reader can tell one of those from a
         row this export stopped sending. That is the failure the surplus is
         deleted to prevent, so leaving it unreported would defeat the delete. */
      var lastRow = firstData + n - 1, endsAt = sh.getMaxRows();
      if (endsAt !== lastRow) {
        throw retryable_('"' + spec.tab + '" ends at row ' + endsAt + ' where the export needs ' +
          n + ' rows, down to row ' + lastRow + '. ' + (endsAt < lastRow
            ? 'The tab could not be grown to fit the export — check whether the workbook is at ' +
              'its 10 million cell limit.'
            : 'The surplus rows below the export were not removed, so the tab is taller than the ' +
              'export and the rows past ' + lastRow + ' are the previous export\u2019s.'));
      }
      var wantLast = 0;
      for (var wq = 0; wq < pairs.length; wq++) {
        var wv = src.rows[n - 1][pairs[wq].src];
        if (wv !== '' && wv != null) wantLast++;
      }
      if (wantLast) {
        var gotLast = 0;
        blocks.forEach(function (b) {
          var w = b.end - b.start + 1;
          var back = sh.getRange(lastRow, b.start, 1, w).getValues()[0];
          for (var k = 0; k < w; k++) if (back[k] !== '' && back[k] != null) gotLast++;
        });
        if (!gotLast) {
          throw retryable_('"' + spec.tab + '" was written but stopped short: the export\'s last ' +
            'row carries ' + wantLast + ' values and row ' + lastRow + ' of the tab is empty ' +
            'across every column written. ' + n + ' rows were sent. This is usually the ' +
            'six-minute runtime limit killing the run mid-write; the tab is left as it is and ' +
            'the next run rewrites it whole.');
        }
      }
    }

    /* THE BAND GOES HOME NOW, NOT AT THE END OF THE WORKBOOK. Every write into
       this tab is done, so there is nothing left for the array formulas to slow
       down, and the window in which they are absent closes here rather than
       after the last tab of the workbook — which is the difference between a
       killed run costing one tab's anchors and costing all of them.

       ONLY THIS TAB'S OWN RANGES ARE MOVED. A reference into another tab of the
       same workbook is left exactly as it was, because that tab may not have
       been written yet; the pass at the end of run() re-points the whole band
       again once every height is final, and it re-points from the same `band`
       this took out. */
    if (parked) {
      var homeEnd = sh.getMaxRows();
      if (putBand_(sh, band, homeEnd, {}, null)) { entry.homeEnd = homeEnd; dropPark_(spec); }
    }

    /* Recorded only now, past every check, so a bad run cannot become the
       baseline the NEXT run measures itself against — which would let a fault
       through by degrees, one export at a time. */
    recordShape_(spec.page, spec.tab, check.shape);

    /* THE REPORT MONTH, OFF THE WALK THE GATE HAS ALREADY DONE. This used to
       call latestMonth_ again, which is a second pass over every row of the
       export — 40,000 of them on Main Raw Data, each one a regex or a Date —
       to answer a question shapeOf_ answered before the gate ran. It is the
       same column read the same way; the only thing that changed is that it is
       read once. */
    var stamped = (spec.stampMonth && check.shape.month) ? check.shape.month : null;

    return {
      tab: spec.tab, mode: 'columns', from: src.file + ' · ' + src.name,
      rows: n, columns: pairs.length, firstDataRow: firstData,
      /* the export's own width and height, beside what was written out of them */
      exportColumns: pairs.length + unmatched.length, exportRows: n,
      unmatched: unmatched, reportMonth: stamped,
      /* what the run decided CY and PY are, so the report can be checked
         against the export rather than taken on trust */
      cyYear: dataYear || headYear, headerYear: headYear, dataYear: dataYear
    };
  }


  /* =====================================================================
   * 7. WRITE — 'replace' mode  (Product Segment tabs)
   * =================================================================== */

  function writeReplace_(sh, src, spec) {
    var grid = [src.hdrRaw].concat(src.rows);
    var rows = grid.length;
    var cols = 0;
    grid.forEach(function (r) { if (r.length > cols) cols = r.length; });
    for (var r = 0; r < rows; r++) {
      while (grid[r].length < cols) grid[r].push('');
    }

    /* SAME GATE, AND THIS MODE NEEDS IT MORE THAN THE OTHER ONE DOES: the very
       next statement clears the whole tab, so there is no partial failure here
       to recognise afterwards — a bad export takes everything. Every column is
       checked rather than a paired subset, because in this mode the export IS
       the tab and there is nothing else on it to pair against. */
    var everyCol = src.hdrRaw.map(function (_, i) { return { src: i }; });
    var check = checkSource_(spec, src, everyCol, tabShape_(spec.page, spec.tab));
    if (!check.ok) throw checkError_(spec, check);

    /* THE ONLY MODE THAT OWNS ITS WHOLE TAB. These are the Product Segment tabs:
       pre-aggregated by QlikView, no formulas and no columns of anybody else's,
       so the tab IS the export and clearing it is the contract. Do not put a
       working column on one of these — 'columns' mode is what keeps a tab's
       other columns; this mode never has. */
    sh.clearContents();

    /* Exactly as tall as the export — surplus rows go, so nothing stale is
       left sitting under the new table. */
    var have = sh.getMaxRows();
    if (rows > have)      sh.insertRowsAfter(have, rows - have);
    else if (rows < have) sh.deleteRows(rows + 1, have - rows);
    if (cols > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
    sh.getRange(1, 1, rows, cols).setValues(grid);

    /* Exactly as tall as the export, both directions — see the same check in
       'columns' mode. Here `rows` counts the header row too, because in this
       mode the export IS the tab. */
    if (sh.getMaxRows() !== rows) {
      throw retryable_('"' + spec.tab + '" ends at row ' + sh.getMaxRows() + ' where the export ' +
        'needs ' + rows + ' rows including its header. ' + (sh.getMaxRows() < rows
          ? 'The tab could not be grown to fit it.'
          : 'The surplus rows below the export were not removed.'));
    }
    recordShape_(spec.page, spec.tab, check.shape);

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
    /* `trigger` is the §11 entry point that pulls this source — one timer per
       export, which is the shape of the whole pipeline now. It is here rather
       than in §11 so that qlikStamps() and APP_verifyPermissions name the same
       three functions from the same list. */
    var out = [
      { key: 'AGG', id: q.AGG_FILE_ID, scope: 'pricevolume', label: 'Aggregates',
        trigger: 'qlikSyncAggregates' },
      { key: 'RMX', id: q.RMX_FILE_ID, scope: 'rmx',         label: 'Ready-Mix',
        trigger: 'qlikSyncReadyMix' },
      { key: 'SEG', id: q.SEG_FILE_ID, scope: 'segment',     label: 'Product Segment',
        trigger: 'qlikSyncSegment' }
    ];
    var missing = out.filter(function (x) { return !x.id; }).map(function (x) { return x.key; });
    if (missing.length) {
      throw new Error('The QlikView export file ids are not set: ' + missing.join(', ') +
        '. Add them to APP_CONFIG.QLIK_SYNC in Config.gs.');
    }
    return out;
  }

  /* The source behind a page id ('pricevolume' | 'rmx' | 'segment'), so a
     failure mail can name the export a person would recognise rather than the
     page id. */
  function sourceByScope_(scope) {
    var all;
    try { all = sources_(); } catch (e) { return null; }
    for (var i = 0; i < all.length; i++) if (all[i].scope === scope) return all[i];
    return null;
  }

  function sourceById_(key) {
    var all = sources_();
    for (var i = 0; i < all.length; i++) if (all[i].key === key) return all[i];
    return null;
  }

  /* One export file, as { id, name, mime } — the shape readExport_ wants, plus
     the file's own modified time. That last field is how the header's stamp can
     say WHICH export a page's figures came out of: the sheet was written at one
     time, out of a file QlikView dropped at another, and a sync that ran an
     hour ago off a two-day-old export is not fresh data. The File is already
     open here, so it costs nothing. */
  function exportFile_(src) {
    var f;
    try { f = DriveApp.getFileById(src.id); } catch (e) {
      throw new Error('Could not open the ' + src.label + ' export (file id ' + src.id +
        '). Check APP_CONFIG.QLIK_SYNC in Config.gs, and that the file is shared with you.');
    }
    var at = 0;
    try { at = f.getLastUpdated().getTime(); } catch (e2) {
      /* Not silent (§7): a zero here is what makes the stamp panel say the
         export's date is unknown, which reads as a bug in the panel. */
      APP_log('warn', 'QLIKSYNC.exportFile', 'could not read when the export was dropped — the ' +
              'stamp will not be able to date it', { source: src.label, error: String(e2) });
    }
    return { id: f.getId(), name: f.getName(), mime: f.getMimeType(), updated: at };
  }

  /* ==========================================================================
   * WHEN A PAGE'S WORKBOOK WAS LAST WRITTEN FROM QLIKVIEW
   * --------------------------------------------------------------------------
   * Drive's modified time — the thing the data version is built from — answers
   * "this sheet changed". It cannot answer "this sheet was synced", and the two
   * must not read as the same event: typing one row into REGION LOOKUP moves the
   * modified time exactly as a sync does, and a header that called that a
   * QlikView update would be lying about where the figures came from.
   *
   * So the run records it, per page: when it wrote, how many tabs it wrote,
   * whether they all landed, and the date on the export it read. One small
   * property, written once per page per sync.
   * ======================================================================== */
  var QLIK_SYNC_LOG_KEY = 'QLIK_LAST_SYNC';

  function syncLog_() {
    try { return JSON.parse(PropertiesService.getScriptProperties()
                              .getProperty(QLIK_SYNC_LOG_KEY) || '{}'); }
    catch (e) {
      APP_log('warn', 'QLIKSYNC.syncLog', 'the sync log is unreadable — every page will report ' +
              'that it has never been synced', { error: String(e) });
      return {};
    }
  }

  function recordSync_(page, info) {
    var all = syncLog_();
    all[page] = info;
    try { PropertiesService.getScriptProperties()
            .setProperty(QLIK_SYNC_LOG_KEY, JSON.stringify(all)); }
    catch (e) {
      /* The data landed; only the stamp did not. Warn rather than fail — but
         warn, because the header will go on showing the PREVIOUS sync's time
         over figures that have moved since, which is the one way this can
         mislead somebody. */
      APP_log('warn', 'QLIKSYNC.recordSync', 'could not record when this page was synced — the ' +
              'header stamp will keep showing the previous time',
              { page: page, error: String(e) });
    }
  }

  /* What the header asks for. null means this page has never been synced — the
     Deck Builder and the Inventory Report never are. */
  function lastSync_(page) {
    return (page && syncLog_()[page]) || null;
  }


  /* =====================================================================
   * 5b. WHAT A GOOD PULL LOOKS LIKE — the shape of every tab, kept
   * ---------------------------------------------------------------------
   * THE CHECK THAT MATTERS CANNOT BE MADE FROM ONE EXPORT ALONE. "This column
   * is empty" is not a fault on its own — plenty of columns legitimately are —
   * and "this export has 1,100 rows" is not either. Both become faults the
   * moment you know what the LAST good one carried. So every successful write
   * records two numbers per tab: how many rows the export had, and how many
   * values each paired column actually filled. The next run compares.
   *
   * This is the whole answer to the reported failure. An export that went out
   * with CY Rev exWorks, PY Rev exWorks and Fuel Surcharge left off still
   * paired every OTHER column, wrote cleanly, and landed a tab whose totals row
   * read 0.00 across three columns with nothing anywhere reporting a problem.
   * Against the previous shape it is not ambiguous at all: three columns that
   * carried tens of thousands of values last week carry none this week.
   * ================================================================== */
  var QLIK_SHAPE_KEY = 'QLIK_TAB_SHAPE';

  function shapeLog_() {
    try { return JSON.parse(PropertiesService.getScriptProperties()
                              .getProperty(QLIK_SHAPE_KEY) || '{}'); }
    catch (e) {
      /* NOT SILENT. With no shapes to compare against, every check below passes
         by default — which is the pre-check behaviour, and is exactly the state
         that let three empty columns through. */
      APP_log('warn', 'QLIKSYNC.shapeLog', 'the tab-shape record is unreadable — this run has ' +
              'nothing to compare against and its column checks will all pass',
              { error: String(e) });
      return {};
    }
  }

  /* Keyed on the tab NAME and the page that owns it: two workbooks are free to
     hold a tab called the same thing, and run() already refuses to match on
     tab name alone for that reason. */
  function shapeKey_(page, tab) { return page + '|' + norm_(tab); }

  function tabShape_(page, tab) {
    return shapeLog_()[shapeKey_(page, tab)] || null;
  }

  function recordShape_(page, tab, shape) {
    var all = shapeLog_();
    all[shapeKey_(page, tab)] = shape;
    try { PropertiesService.getScriptProperties()
            .setProperty(QLIK_SHAPE_KEY, JSON.stringify(all)); }
    catch (e) {
      /* The data landed and only the record did not. Warn rather than fail —
         but warn, because the NEXT run is the one that pays: it compares
         against a shape one run out of date, or against none at all. */
      APP_log('warn', 'QLIKSYNC.recordShape', 'could not record what this tab looked like — the ' +
              'next run has less to check against', { tab: tab, error: String(e) });
    }
  }

  /* What one export tab looks like, in the two numbers a bad pull moves. Only
     the PAIRED columns are counted: an unpaired one is already reported as
     unmatched and writes nowhere, so its fill is nobody's business.

     KEYED ON THE CANONICAL NAME, WHICH IS WHAT PAIRING ITSELF USES. Keyed on
     the raw header, a cosmetic change in the export — a double space, a case
     change, "Fuel Surchage" corrected to "Fuel Surcharge" — would read as one
     column vanishing and another appearing, and this gate would block a sync
     over a typo being fixed. The canonical form is stable under exactly the
     variations the pairing is stable under, which is the property wanted here.
     `names` keeps the raw spelling beside it, because the message this ends up
     in is read by somebody looking at the export, not at the code. */
  function shapeOf_(src, pairs) {
    var cols = {}, names = {}, n = src.rows.length, ym = 0, month = null, monthAsked = false;
    for (var q = 0; q < pairs.length; q++) {
      var sc = pairs[q].src, fill = 0;
      for (var i = 0; i < n; i++) {
        var v = src.rows[i][sc];
        if (v !== '' && v != null) fill++;
      }
      var key = canon_(src.hdr[sc]);
      if (!key) continue;                       /* an unnamed column names nothing */
      cols[key] = fill;
      names[key] = String(src.hdrRaw[sc]);
      if (pairs[q].isMonth && ym === 0) {
        var mm = latestMonth_(src, sc);
        /* THE FIRST MONTH COLUMN'S ANSWER, KEPT WHATEVER IT IS — including
           null. It is the same column, chosen the same way, that writeColumns_
           used to walk the export a second time for; keeping it here is what
           lets that walk go. Later month columns can still supply `ym`, which
           is the behaviour that was here, but they do not become the stamp. */
        if (!monthAsked) { monthAsked = true; month = mm; }
        if (mm) ym = mm.y * 12 + mm.m;
      }
    }

    /* THE PERIOD THIS EXPORT IS FOR, and it has to be found two ways because
       the two lines carry it differently. Ready-Mix has a Bill Month ("Apr-26")
       and the loop above reads it. THE AGGREGATES TABS DO NOT — only "Bill
       Month" canonicalises to monthcol, and AGG carries a bare "Month" beside a
       separate "Year", so `monthYM_('Apr')` has no year to read and returns
       null. Without this fallback `ym` is 0 on every AGG tab, `rolled` is never
       true, and the shrink check refuses the January sync on the one line it
       most needs to allow it. */
    if (!ym) {
      var y = srcCyYear_(src, src.hdr.map(canon_));
      if (y) ym = y * 12;
    }
    return { rows: n, cols: cols, names: names, ym: ym, month: month, at: Date.now() };
  }

  /* HOW FAR AN EXPORT IS ALLOWED TO SHRINK BEFORE IT IS TREATED AS BROKEN.
     Rows belong to the export — a shorter one has its surplus DELETED, which is
     right and is what stops January reading a December-sized sheet. It is also
     what makes a truncated read destructive rather than merely wrong: the sheet
     is cut down to whatever the bad export happened to carry, and the good data
     is gone before anybody sees a number. A real month-on-month fall is a few
     per cent; half is not a month, it is a broken file. Below the floor the
     ratio means nothing, so it is not applied. */
  var SHRINK_FLOOR = 500, SHRINK_KEEP = 0.5;

  /* HOW SHORT A READ HAS TO BE BEFORE IT COUNTS AS A TRUNCATION rather than as
     a tab with some blank rows on the end of it.

     `gridRows` is the tab's ALLOCATED height as the server reports it, and that
     is not always the same as the height of the data in it — a converted copy
     can carry blank rows past the last one that matters. So a strict comparison
     would refuse healthy exports, which is why this has a ratio at all.

     HALF, AND A FLOOR UNDER IT. The failure this exists to catch is not a
     handful of rows: it is 1,113 rows against 47,634, a copy read while Drive
     was still filling it. Below the floor the ratio means nothing and is not
     applied, the same rule the shrink check above follows. */
  var READ_FLOOR = 500, READ_KEEP = 0.5;

  /* ===================================================================
   * THE GATE. IT RUNS BEFORE ANYTHING DESTRUCTIVE, AND THAT IS THE POINT.
   * -------------------------------------------------------------------
   * By the time this returns, nothing has been cleared, no row has been
   * deleted and no formula has been lifted out. A tab that fails here is left
   * EXACTLY as it was — last week's figures, which are wrong by a week, rather
   * than this week's hole, which is wrong in a way no reader can see.
   * ================================================================= */
  function checkSource_(spec, src, pairs, prev) {
    var bad = [], n = src.rows.length, wide = src.hdr.length;

    /* 0. THE READ IS AS TALL AS THE FILE IT CAME OUT OF.
          THE ONLY CHECK HERE THAT NEEDS NO HISTORY, and the only one that can
          see the failure the read banner describes. Every other check on this
          list compares the export against the LAST GOOD ONE, and a copy read
          while Drive was still converting it defeats all of them: the 1,113
          rows that did land are perfectly well formed, every column is present
          and full, the grid is rectangular, and nothing downstream can tell
          them from an export that is genuinely that short. The one thing that
          gives it away is the file itself — the server says the tab holds
          47,634 rows and the read came back with 1,113 — and this is the last
          point in the pass at which both numbers are still in hand.

          IT ALSO CLOSES THE HOLE THE BASELINE LEAVES. The shrink check below
          needs a previous good shape to measure against, and the run that
          records that shape is the run before it — so the FIRST truncated read
          after a sheet has been emptied or a shape record lost has nothing to
          fail against, writes, and then records its own 1,113 rows as the
          baseline every later run is measured from. This one does not care what
          came before. */
    if (src.gridRows >= READ_FLOOR && src.readRows &&
        src.readRows < Math.ceil(src.gridRows * READ_KEEP)) {
      bad.push('the export tab "' + src.name + '" holds ' + src.gridRows + ' rows on the server ' +
               'but only ' + src.readRows + ' came back from the read — the converted copy was ' +
               'opened before Drive had finished filling it');
    } else if (src.gridRows && src.readRows && src.readRows < src.gridRows - 10) {
      /* Not a failure and worth a line anyway: a gap of any size is the shape
         of the failure above, seen while it is still nothing. Silence about the
         small version is what let the large one run for months. */
      APP_log('info', 'QLIKSYNC.check', 'the read came back shorter than the tab the server ' +
              'reports', { tab: spec.tab, from: src.name, read: src.readRows, holds: src.gridRows });
    }

    /* 1. THE GRID IS RECTANGULAR. getValues() returns one by construction, so a
          short row means the read came back truncated between Drive and here —
          which is the failure that ends with a tab stopping at row 1,113 of
          49,000 and no error anywhere. */
    for (var i = 0; i < n; i++) {
      if (src.rows[i].length < wide) {
        bad.push('row ' + (i + 1) + ' of the export has ' + src.rows[i].length +
                 ' cells where its header has ' + wide + ' — the export was read short');
        break;
      }
    }

    var now = shapeOf_(src, pairs);

    if (prev && prev.cols) {
      /* 2. NO COLUMN HAS GONE MISSING. A column that fed this tab on the last
            good run and pairs with nothing now was dropped or renamed in the
            export. Note what this does NOT catch, deliberately: a column that
            has never paired is reported as unmatched and is not a failure,
            because that is also what a new year's column looks like before
            somebody adds it to the workbook. */
      var here = {};
      for (var h = 0; h < src.hdr.length; h++) { var k = canon_(src.hdr[h]); if (k) here[k] = 1; }

      Object.keys(prev.cols).forEach(function (key) {
        if (key in now.cols) return;
        var was = (prev.names && prev.names[key]) || key;
        /* WHICH OF THE TWO IT IS matters to whoever has to fix it: a column
           the export stopped sending is a QlikView job to re-run, and one the
           export still sends but that no longer pairs is a header renamed on
           one side of the pairing — usually in the workbook. */
        bad.push(here[key]
          ? 'the column "' + was + '" is in this export but no longer pairs with any column ' +
            'on the tab — a header has been renamed on one side or the other'
          : 'the column "' + was + '" fed this tab on the last good run and is not in this export');
      });
    }

    /* 3. AND NONE ARRIVED EMPTY THAT USED TO CARRY FIGURES. The reported
          failure, exactly: revenue and fuel surcharge present in the header,
          paired, written, and empty all the way down. */
    Object.keys(now.cols).forEach(function (key) {
      if (now.cols[key] === 0 && prev && prev.cols && prev.cols[key] > 0) {
        bad.push('the column "' + (now.names[key] || key) + '" is empty in this export and ' +
                 'carried ' + prev.cols[key] + ' values on the last good run');
      }
    });

    /* 4. THE EXPORT HAS NOT COLLAPSED. See SHRINK_FLOOR.

          AND THE ONE CASE WHERE A COLLAPSE IS REAL: the turn of the year. These
          exports carry the year they are for, so a January file is a twelfth of
          a December one — which is the whole reason surplus rows are deleted
          rather than left (leaving them has January reading a December-sized
          sheet for eleven months). Refusing that would stop the pipeline dead
          every January, on the one day of the year nobody is expecting it.

          So a shrink is allowed when the export's NEWEST MONTH has moved on,
          and only then. It still says so: this is the gap in the check and it
          should be visible when it is being relied on. A truncated read of a
          January file would come through this — the settle before the read is
          what addresses that, and the row-count check after the write is what
          reports it if both miss. */
    if (prev && prev.rows >= SHRINK_FLOOR && n < Math.ceil(prev.rows * SHRINK_KEEP)) {
      var rolled = !!(now.ym && prev.ym && now.ym > prev.ym);
      if (rolled) {
        APP_log('warn', 'QLIKSYNC.check', 'the export is far shorter than the last good one, and ' +
                'is allowed only because its newest month has moved on — a period roll',
                { tab: spec.tab, rows: n, was: prev.rows });
      } else {
        bad.push('the export carries ' + n + ' rows where the last good one carried ' + prev.rows +
                 ' — too few to be a month’s change, its newest month has not moved on, and ' +
                 'writing it would delete the rest of the tab');
      }
    }

    return { ok: !bad.length, problems: bad, shape: now };
  }

  /* A GATE FAILURE, FLAGGED AS ONE. run() records every kind of tab failure the
     same way, and the two are not the same thing: a tab that failed its CHECKS
     is worth trying again in five minutes, because the usual cause is a file
     that was still being written when this run opened it. A tab that failed any
     other way is not — see 5d. `qlikCheck` is how the difference survives being
     turned into a { tab, error } record. */
  function checkError_(spec, check) {
    return retryable_('The export did not pass its checks, so "' + spec.tab + '" was left ' +
      'exactly as it was — ' + check.problems.join('; ') + '.');
  }

  /* A FAILURE WORTH TRYING AGAIN, whatever produced it. The gate uses it, and
     so does the post-write check — a tab that stopped short is the clearest
     case of all: the next run rewrites it whole, and without the flag it keeps
     the export's stamp and is never looked at again. What is NOT flagged is
     anything a second attempt cannot change (a tab missing from the workbook, a
     header that pairs with nothing on either side), because retrying those
     neither fixes them nor tells anybody, which is the rule §11's check has
     always followed. */
  function retryable_(message) {
    var e = new Error(message);
    e.qlikCheck = true;
    return e;
  }

  /* =====================================================================
   * 5c. TELLING SOMEBODY — this runs on a timer with nobody watching
   * ---------------------------------------------------------------------
   * A throw inside a time-driven trigger reaches one place: the execution log,
   * which nobody opens until they already suspect something. Every failure
   * above is silent to the person who actually needs it — the tab looks
   * healthy, the totals are just wrong — so a failed run says so by mail.
   *
   * TO WHOM. APP_CONFIG.SYNC_ALERT_TO if it is set, otherwise the account the
   * execution is running as. That default is the right one here rather than a
   * fallback: an installable trigger runs as WHOEVER CREATED IT (§11), so the
   * effective user is by definition the person who set this pipeline up.
   *
   * AND WHETHER TO MAIL ANYBODY AT ALL IS A SWITCH, DEFAULTING TO NO. The mail
   * was written for a pipeline nobody was watching, and it is the right thing
   * for one — but a sync that is failing for a reason somebody is already
   * working on sends the same mail every fifteen minutes to a person who
   * already knows, and a mail nobody reads is worse than no mail, because the
   * one that matters arrives looking exactly like the twenty before it. So it
   * is opt-in: QLIK_ALERT_MAIL must say `on` before MailApp is reached, and
   * qlikAlertsOn() / qlikAlertsOff() (§11) are the two editor tools that set
   * it. Neither touches QLIK_ALERT_TO — the address survives being muted, so
   * turning the mail back on does not need it typed in again.
   *
   * MUTED IS NOT SILENT, AND THAT IS THE WHOLE OF WHY THIS IS A SWITCH RATHER
   * THAN A DELETION. §7's rule is that nothing fails quietly, and the mail was
   * the only thing standing behind it here: run() returns its failures to a
   * time-driven trigger, which reads them nowhere. So a muted run writes the
   * ENTIRE report it would have sent to the execution log at `error` — the same
   * text, the same reasons, in the one place a trigger does reach — and
   * qlikRetryStatus() says out loud that the mail is off whenever it is.
   * ================================================================== */

  /* The switch, and it is a Script Property rather than a constant so that
     turning the mail back on is a Run-menu click and not a deployment. */
  var QLIK_ALERT_MAIL_KEY = 'QLIK_ALERT_MAIL';

  /* ANYTHING BUT AN EXPLICIT YES IS NO — an unset property, a typo, a
     PropertiesService that will not answer. The failure still reaches the log
     either way, so the safe direction here is the quiet one: a run that cannot
     read the switch mails nobody rather than mailing everybody. */
  function alertMailOn_() {
    try {
      var v = String(PropertiesService.getScriptProperties()
                       .getProperty(QLIK_ALERT_MAIL_KEY) || '').trim().toLowerCase();
      return v === 'on' || v === 'yes' || v === 'true' || v === '1';
    } catch (e) { return false; }
  }

  /* What §11's two entry points do. Returns the state it left behind, so the
     Run menu's execution log shows what happened without a second call. */
  function setAlertMail_(on) {
    var to = alertTo_();
    try {
      if (on) PropertiesService.getScriptProperties().setProperty(QLIK_ALERT_MAIL_KEY, 'on');
      else    PropertiesService.getScriptProperties().deleteProperty(QLIK_ALERT_MAIL_KEY);
    } catch (e) {
      return { mail: alertMailOn_() ? 'on' : 'off', to: to,
               error: 'The switch could not be written: ' + String(e && e.message || e) };
    }
    APP_log('info', 'QLIKSYNC.alert', 'the sync failure mail was switched ' + (on ? 'on' : 'off'),
            { to: to.join(',') });
    return {
      mail: alertMailOn_() ? 'on' : 'off',
      to: to,
      note: on
        ? (to.length ? 'A failed sync will mail ' + to.join(', ') + '.'
                     : 'The mail is on but there is nobody to send it to — set the ' +
                       'QLIK_ALERT_TO script property.')
        : 'A failed sync will write its whole report to the execution log at error level and ' +
          'mail nobody. qlikAlertsOn() puts the mail back.'
    };
  }

  function alertTo_() {
    var to = [];
    try {
      var raw = PropertiesService.getScriptProperties().getProperty('QLIK_ALERT_TO') ||
                (typeof APP_CONFIG === 'object' && APP_CONFIG.SYNC_ALERT_TO) || '';
      to = String(raw).split(/[,;\s]+/).filter(function (x) { return x.indexOf('@') !== -1; });
    } catch (e) { to = []; }
    if (!to.length) {
      try { var me = Session.getEffectiveUser().getEmail(); if (me) to = [me]; } catch (e) {}
    }
    return to;
  }

  function alert_(subject, lines) {
    var body = lines.join('\n');

    /* SWITCHED OFF IS STILL REPORTED, IN FULL. The body is the report — every
       reason the gate produced, which tab, and what happens next — so it goes
       to the log verbatim rather than being summarised into a line that would
       send somebody looking for the mail that is not coming. */
    if (!alertMailOn_()) {
      APP_log('error', 'QLIKSYNC.alert', 'the sync failed and the failure mail is switched off, ' +
              'so this line is the whole report — qlikAlertsOn() puts the mail back',
              { subject: subject, report: body });
      return false;
    }

    var to = alertTo_();
    if (!to.length) {
      APP_log('error', 'QLIKSYNC.alert', 'the sync failed and there is nobody to tell — set the ' +
              'QLIK_ALERT_TO script property', { subject: subject, report: body });
      return false;
    }
    try {
      MailApp.sendEmail({ to: to.join(','), subject: subject, body: body });
      return true;
    } catch (e) {
      /* The last thing that could have reported the failure has failed. There
         is nothing below this to fall back to, so it is an error and it names
         both problems — the sync's and the mail's. */
      APP_log('error', 'QLIKSYNC.alert', 'could not send the sync failure mail, so this run is ' +
              'reported nowhere but here', { subject: subject, error: String(e), body: body });
      return false;
    }
  }


  /* =====================================================================
   * 5d. THE RETRY — once, five minutes out, and then it stops
   * ---------------------------------------------------------------------
   * The existing rule stands and is worth restating, because this is an
   * exception to it: a run that FINISHED with a broken tab is not retried,
   * because that tab will be just as broken in fifteen minutes and re-syncing
   * forever neither fixes it nor tells anybody.
   *
   * A run that failed its CHECKS is the one case where a retry is worth
   * something, and only because of what usually causes it: a file Drive was
   * still writing when the sync opened it, or an export QlikView had not
   * finished dropping. Both are gone a few minutes later. So the retry is ONE
   * further attempt, five minutes out, and then it gives up and says so — a
   * genuinely broken export is not fixed by asking again and the mail has
   * already gone out either way.
   *
   * THIS IS THE ONLY ScriptApp.newTrigger IN THE CODEBASE, and §11's banner —
   * which said there were none — says so now. It is a one-shot: it arms itself
   * here and deletes itself when it fires, and arming it clears any spent one
   * first, so these cannot accumulate against the per-script trigger limit.
   * ================================================================== */
  var QLIK_RETRY_KEY = 'QLIK_RETRY', QLIK_RETRY_MAX = 1, QLIK_RETRY_MINS = 5;

  /* ONE RETRY, FOR BOTH KINDS OF FAILURE, AND THERE USED TO BE TWO CEILINGS.
     A broken export is not worth asking twice: a second failure means the file
     itself is wrong and asking again only delays saying so. Running out of
     execution time used to retry under a ceiling of five instead, and the
     reason was convergence — a run of 'all' retried only the PAGES that failed,
     so every attempt was strictly smaller than the one before it and the chain
     finished.

     A RUN IS ONE PAGE NOW, so there is nothing left to shrink: a page that ran
     out of time retries by doing the same page again, and five identical
     attempts are five ways of not saying that the page does not fit. It should
     not happen at all now — the whole of Ready-Mix, the heaviest of the three,
     is about three minutes of a six-minute execution — and if it does, the mail
     saying so is the useful outcome, not a fourth attempt. */
  var QLIK_RETRY_FN = 'qlikSyncRetry';

  function retryLog_() {
    try { return JSON.parse(PropertiesService.getScriptProperties()
                              .getProperty(QLIK_RETRY_KEY) || '{}'); }
    catch (e) {
      /* NOT SILENT (§7). An unreadable retry log reads as "nothing is waiting",
         so a source that failed its checks is quietly never tried again — and
         `tries` starts from zero, so it can also be retried more often than the
         cap allows. Both are invisible from the outside. */
      APP_log('warn', 'QLIKSYNC.retry', 'the retry record is unreadable — anything waiting to be ' +
              'retried is forgotten, and the retry cap starts again', { error: String(e) });
      return {};
    }
  }
  function saveRetry_(all) {
    try { PropertiesService.getScriptProperties()
            .setProperty(QLIK_RETRY_KEY, JSON.stringify(all)); }
    catch (e) {
      APP_log('warn', 'QLIKSYNC.retry', 'could not record the retry state — a retry may run ' +
              'twice or not at all', { error: String(e) });
    }
  }

  /* Every trigger this project has ever armed for the retry handler, gone.
     getProjectTriggers() sees only the CALLER'S OWN triggers, which is the
     platform's rule and the same one §11 spells out — so this clears what this
     account armed, which is the only thing it could have armed. */
  function dropRetryTriggers_() {
    var gone = 0;
    try {
      ScriptApp.getProjectTriggers().forEach(function (t) {
        if (t.getHandlerFunction() === QLIK_RETRY_FN) { ScriptApp.deleteTrigger(t); gone++; }
      });
    } catch (e) {
      APP_log('warn', 'QLIKSYNC.retry', 'could not clear the spent retry triggers',
              { error: String(e) });
    }
    return gone;
  }

  /* A SCOPE THAT SUCCEEDED IS NOT WAITING FOR ANYTHING. Called on every clean
     run, not only by the retry path, because the retry is not the only thing
     that can fix one: the scheduled check comes round every fifteen minutes and
     somebody can run that page's qlikAggNow / qlikRmxNow / qlikSegmentNow at any
     point, and either may land before the five-minute one-shot fires. Left behind, the entry costs twice — the retry
     fires against a source that is already right, and `tries` stays at 1, so
     the NEXT genuine failure is told it has already had its retry and gives up
     immediately. */
  function clearRetry_(scope) {
    var all = retryLog_();
    if (!(scope in all)) return;
    delete all[scope];
    saveRetry_(all);
    if (!Object.keys(all).length) dropRetryTriggers_();
  }

  function scheduleRetry_(scope, problems) {
    var all = retryLog_(), rec = all[scope] || { tries: 0 };
    if (rec.tries >= QLIK_RETRY_MAX) {
      APP_log('error', 'QLIKSYNC.retry', 'this page has already been retried and failed again — ' +
              'it will not be retried further',
              { scope: scope, tries: rec.tries, cap: QLIK_RETRY_MAX, problems: problems });
      delete all[scope];
      saveRetry_(all);
      return 'exhausted';
    }
    rec.tries++; rec.at = Date.now(); rec.problems = problems;
    all[scope] = rec;
    saveRetry_(all);

    /* CLEAR THEM AND MAKE ONE. Three timers can each leave a page waiting, and
       nothing runs more than one export in an execution any more — but the
       three of them can still leave three pages waiting between firings; two
       triggers on this handler would fire two executions minutes apart doing
       the same work, and the second would find the lock held. runRetries_ walks
       every waiting page off one firing, so one trigger is all that is ever
       wanted. Dropping first also replaces a trigger that somehow survived its
       own firing, which counting the existing ones would mistake for the one
       about to fire. */
    dropRetryTriggers_();
    try {
      ScriptApp.newTrigger(QLIK_RETRY_FN).timeBased()
        .after(QLIK_RETRY_MINS * 60 * 1000).create();
      APP_log('info', 'QLIKSYNC.retry', 'armed a one-shot retry',
              { page: scope, minutes: QLIK_RETRY_MINS, attempt: rec.tries });
      return 'armed';
    } catch (e) {
      /* Not fatal — the mail has already named the problem, and the ordinary
         time-driven check will come round again. But the "five minutes" the
         mail promises will not happen, so it is not silent either. */
      APP_log('error', 'QLIKSYNC.retry', 'could not arm the retry — the next scheduled check is ' +
              'the next attempt', { page: scope, error: String(e) });
      return 'unarmed';
    }
  }

  /* THE MAIL A FAILED RUN SENDS, AND THE RETRY IT ARMS.
     Written for the person who owns the EXPORT, not for whoever maintains the
     code: every reason the gate produces already names the tab, the column and
     what it carried last time, so the body is those reasons and the two facts
     that make them actionable — which file was read, and what happens next. */
  function reportFailure_(scope, failed, filesSeen, started) {
    var label = (sourceByScope_(scope) || {}).label || scope;
    var retryable = failed.filter(function (f) { return f.check; });

    /* ONE PAGE, SO ONE RETRY. A run is one export and one workbook now, so the
       per-page fan-out this used to do — several pages failing in one firing,
       each asking for its own retry, the mail reporting the best of the three
       answers — has one page to report on and one answer to give.

       'armed' | 'exhausted' | 'unarmed' are still three different things to
       tell somebody, and one boolean told two of them the same lie. */
    var retry = 'none';
    if (retryable.length) {
      retry = scheduleRetry_(scope, retryable.map(function (f) {
        return f.tab + ': ' + f.error;
      }));
    }

    var body = [];
    body.push('The QlikView sync ran at ' + started + ' and ' + failed.length +
              ' tab(s) did not update.');
    body.push('');
    body.push('Source: ' + label + (filesSeen.length ? ' — ' + filesSeen.join(', ') : ''));
    body.push('');
    failed.forEach(function (f) { body.push('  • ' + f.tab + '\n      ' + f.error); });
    body.push('');
    if (retryable.length) {
      body.push('WHAT THE SHEET LOOKS LIKE NOW: unchanged. A tab that fails its checks is left ' +
                'exactly as it was, so it is showing the last good export rather than a ' +
                'half-written one. The figures are out of date; they are not wrong in a way ' +
                'nobody can see.');
      body.push('');
      body.push(
        retry === 'armed'
          ? 'WHAT HAPPENS NEXT: this runs again by itself in about ' + QLIK_RETRY_MINS +
            ' minutes. The usual cause is an export that was still being written when the sync ' +
            'opened it, and that clears on its own. If the retry fails too, nothing further is ' +
            'scheduled and the export itself needs looking at.'
        : retry === 'exhausted'
          ? 'WHAT HAPPENS NEXT: nothing automatic — this has already been retried once and ' +
            'failed again, so the export itself needs looking at. Re-export it and run this ' +
            'page\u2019s qlikAggNow / qlikRmxNow / qlikSegmentNow from the Apps Script editor, ' +
            'or wait for the next scheduled check.'
          : 'WHAT HAPPENS NEXT: the automatic retry could not be scheduled, so the next ' +
            'scheduled check is the next attempt. The export was not marked as read, so that ' +
            'check will pick it up rather than skip it.');
    } else {
      body.push('WHAT HAPPENS NEXT: nothing automatic. This is not a failure a retry fixes — ' +
                'run this page\u2019s qlikAggNow / qlikRmxNow / qlikSegmentNow from the Apps ' +
                'Script editor once the cause above is dealt with.');
    }
    alert_('QlikView sync failed — ' + label + ' (' + failed.length + ' tab' +
           (failed.length === 1 ? '' : 's') + ')', body);
  }

  /* What the one-shot trigger runs. Exposed on the namespace so §11's entry
     point is one line and this stays beside the state it reads. */
  function runRetries_() {
    dropRetryTriggers_();                     /* including the one now firing */
    var scopes = Object.keys(retryLog_());
    if (!scopes.length) return { ok: true, retried: [] };

    var out = { ok: true, retried: [], failed: [] };
    scopes.forEach(function (scope) {
      var res = run(scope);

      /* RE-READ, NEVER HOLD. run() reaches scheduleRetry_ on its way out and
         that writes this same property — it is what decides whether a second
         failure arms anything and what clears the entry when it will not. A
         copy taken before the run and written back after would undo that
         decision and leave the scope waiting for a retry that is never coming,
         which is the one state this whole mechanism must not produce. */
      var all = retryLog_();
      if (res.ok) { delete all[scope]; out.retried.push(scope); }
      else {
        out.ok = false;
        out.failed.push(scope + ': ' + (res.error || JSON.stringify(res.failed)));
      }
      saveRetry_(all);
    });
    return out;
  }

  /* SpreadsheetApp.openById on a workbook this account OWNS can still come back
     "Document … is missing". In the middle of a run that has already opened the
     same file it is not a permission failure, it is the service refusing one
     call — so it is asked again rather than reported as a workbook that is not
     there. Three attempts, three seconds apart; the third refusal is the
     answer. */
  function openWorkbook_(page) {
    var tries = 0, last = null;
    while (tries++ < 3) {
      try { return APP_openSpreadsheet_(page); }
      catch (e) {
        last = e;
        if (tries < 3) {
          APP_log('warn', 'QLIKSYNC.run', 'the workbook would not open — asking again',
                  { page: page, attempt: tries, error: String(e && e.message || e) });
          Utilities.sleep(3000);
        }
      }
    }
    throw last;
  }

  /* ONE PAGE, ONE EXPORT, ONE EXECUTION — AND THAT IS THE WHOLE FIX.
     ---------------------------------------------------------------------
     `page` is a page id: 'pricevolume' | 'rmx' | 'segment'. Each one is fed by
     exactly one export file, so a run is one conversion, one read, one workbook
     and nothing else. §11 sets a TIMER PER PAGE — three timers, three targets.

     THE JOB NEVER FITTED ONE EXECUTION AND WAS NEVER GOING TO. Measured on the
     run that finally read and wrote everything whole: Aggregates is 52,538 rows
     and about 80 seconds to write, Ready-Mix is 82,200 and about 165, Product
     Segment is small, and the three conversions and reads cost another ~70
     seconds on top. That is roughly seven minutes of work inside a six-minute
     limit, and no amount of tuning closes a gap that shape. Split three ways it
     is two to three minutes a page, with the settle, the read and the write all
     inside one page's own six minutes.

     WHAT WENT WITH THE SPLIT, AND IT IS MOST OF WHAT USED TO BE HERE. run()
     took 'all', walked a byPage map, read each export on first use and dropped
     it when the last page needing it was done, refused a page it could not
     START inside the budget, armed a retry for the pages that were left, and
     stamped the pages that finished so the retry would not redo them. Every
     piece of that existed to fit three exports into one execution and to make
     the leftovers converge across firings. One export per execution needs none
     of it: there is one page, one folder, one file, and the only budget check
     left is the per-TAB one below.

     THE LOCK IS STILL SCRIPT-WIDE, because LockService has no named locks. Two
     timers firing across each other costs the second one its interval — it
     returns `error`, no stamp is written, and its next firing picks the export
     up — which is why §11 sets the three a few minutes apart. All three exports
     rarely move at once, so this is a cost that is almost never paid.

     WHAT THE PAGE IS THE UNIT OF, and why a page cannot be split further: the
     array formulas are re-pointed once per WORKBOOK, off an `ends` map that has
     to hold every tab of it, so one page's tabs have to be written in one
     execution. */
  function run(page) {
    var want = String(page || '').toLowerCase();

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) {
      /* Another of the three timers is mid-run, or somebody is pulling by hand
         from the editor. Nothing is wrong, but nothing was written either —
         `error` says the run did not happen, which is what stops the caller
         recording it as done. */
      return { ok: false, scope: want, files: [], done: [], skipped: [], failed: [],
               error: 'Another update is already running. Try again in a moment.' };
    }

    var started = new Date();
    var done = [], skipped = [], failed = [], filesSeen = [];

    /* Inside the lock, so it can never see another execution's live copy. */
    sweepTemps_();

    try {
      var SPEC = buildSpec_().filter(function (s) { return s.page === want; });
      if (!SPEC.length) {
        return { ok: false, scope: want, files: [], done: [], skipped: [], failed: [],
                 error: 'Nothing is set up to update for "' + want + '".' };
      }

      /* Every tab of a page comes out of one export folder. */
      var src = sourceById_(SPEC[0].folder);

      var tabs = null, ss = null, exportAt = 0, exportName = '';
      try {
        var f = exportFile_(src);
        filesSeen.push(src.label + ': ' + f.name);
        exportAt = f.updated; exportName = f.name;
        tabs = readExport_(f);
        ss   = openWorkbook_(want);
      } catch (e) {
        /* A READ THAT FAILS FAILS EVERY TAB OF THE PAGE, BY NAME. It used to
           throw into run()'s own catch, which reports an error and no failed
           tabs — a broken export that said nothing about what it broke.

           AND IT IS FLAGGED AS A CHECK FAILURE, which is what withholds the
           export's stamp. Nothing here read the file: the copy failed, or Drive
           refused it, or the workbook would not open three times running. §11's
           rule is that a stamp marks a file as READ, and keeping one here marks
           a file as read that nothing looked at — the next firing then skips
           it, and the page sits on last week's figures with nothing scheduled
           to fix it. It also arms the one retry, which is the right number: a
           conversion that failed once often works five minutes later, and a
           file that is genuinely not there is not found by asking twice. */
        SPEC.forEach(function (s) {
          failed.push({ tab: s.tab, page: want, check: true, error: e.message });
        });
      }

      var plan = [], ends = {};

      if (ss) {
        SPEC.forEach(function (spec) {
          /* NOT STARTED IS BETTER THAN KILLED HALFWAY. A tab is tens of
             thousands of rows of writing, and Apps Script kills an execution at
             six minutes without running a `finally` or throwing anywhere this
             code can see — the rows simply stop arriving. The tab is then blank
             below wherever it got to, and worse, the caller has no failure to
             report so it stamps the export as read and nothing looks at that tab
             again until somebody notices the numbers.

             So a tab that cannot be STARTED inside the budget is refused before
             it opens anything, and refused as a CHECK failure, which withholds
             the stamp and arms the one-shot five minutes out. */
          if (Date.now() - EXEC_T0 > EXEC_SAFE_MS) {
            failed.push({ tab: spec.tab, page: want, check: true,
              error: 'This execution ran out of time before "' + spec.tab + '" could be ' +
                     'started, so nothing was written and the tab is exactly as it was. A ' +
                     'retry has been armed; it will have the whole of its own six minutes.' });
            return;
          }

          try {
            var sh = ss.getSheetByName(spec.tab);
            if (!sh) {
              (spec.optional ? skipped : failed).push({
                tab: spec.tab, page: want,
                error: 'No tab called "' + spec.tab + '" in ' + APP_CONFIG.PAGES[want].label + '.'
              });
              return;
            }
            var from = pickSource_(tabs, spec);
            if (!from) {
              /* FLAGGED AS A CHECK FAILURE, and it is one: the fingerprint this
                 tab is found by is a handful of its own column names, so
                 "nothing matches" and "a column the tab needs is missing" are
                 the same event seen one step earlier — and the same causes
                 produce it, a file still being written among them. Without the
                 flag this kept the export's stamp and was never tried again. */
              (spec.optional ? skipped : failed).push({
                tab: spec.tab, page: want,
                check: !spec.optional,
                error: 'Nothing in the ' + spec.folder + ' folder matches this tab' +
                       (spec.srcTab ? ' (looked for an export tab called "' + spec.srcTab + '")' : '') +
                       '. The tab is found by the column names it must contain (' +
                       (spec.srcTab ? 'the export tab name' : (spec.match || []).join(', ')) +
                       '), so an export missing one of those matches nothing at all. ' +
                       'Nothing was written and the tab is exactly as it was.'
              });
              return;
            }

            var res = (spec.mode === 'replace')
              ? writeReplace_(sh, from, spec)
              : writeColumns_(sh, from, spec, plan);

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
            failed.push({ tab: spec.tab, page: want, error: e.message,
                          check: !!(e && e.qlikCheck) });
          }
        });
      }

      /* Every tab in this workbook has its final height now, so the array
         formulas can be re-pointed — including the ones that reach across into
         another tab of the same workbook. */
      plan.forEach(function (p) {
        var ownEnd = p.sh.getMaxRows(), home = true;
        for (var r = 0; r < p.band.length; r++) {
          var fRuns = cellRuns_(p.band[r]);
          for (var q = 0; q < fRuns.length; q++) {
            var start = fRuns[q].start, len = fRuns[q].len, seg = new Array(len);

            /* A RUN THIS PASS WOULD WRITE UNCHANGED IS NOT WRITTEN AGAIN, AND
               THAT IS NOT A MICRO-SAVING. writeColumns_ already put this band
               back the moment its own tab was written, with an empty `ends` —
               so every formula that does NOT reach into a sibling tab came out
               of that call exactly as it comes out of this one. Writing it a
               second time changes nothing on the tab and costs the thing §5b
               takes the band off the tab to avoid in the first place: six
               ARRAYFORMULAs landing on a 47,845-row column is 140,000 string
               operations and six full-column sums, and the sheet does all of it
               before the next call is served. Doing that twice per tab, once
               for nothing, is where a page's last minutes were going.

               `homeEnd` is the height that earlier restore was pointed at, and
               it is 0 unless the restore ran AND every run of it wrote. So a tab
               that threw mid-write, a band that could not be parked, and a
               restore that half failed all fall through to the write below —
               which is the safe direction, because in each of those the band
               really is still off the tab.

               THE COMPARISON IS THE FORMULA, NOT THE ASSUMPTION. Nothing here
               relies on believing the heights match: each cell is re-pointed
               both ways and skipped only if the two strings are identical, so a
               sibling reference that this pass can now resolve, or a height that
               moved since, writes exactly as it did before. */
            var same = !!p.homeEnd;
            for (var k = 0; k < len; k++) {
              seg[k] = reanchor_(p.band[r][start + k], ownEnd, ends);
              if (same && seg[k] !== reanchor_(p.band[r][start + k], p.homeEnd, {})) same = false;
            }
            if (same) continue;

            try {
              p.sh.getRange(r + 1, start + 1, 1, len).setFormulas([seg]);
            } catch (e) {
              home = false;
              failed.push({ tab: p.sh.getName(), page: want,
                error: 'Could not restore the formulas in ' +
                       p.sh.getRange(r + 1, start + 1, 1, len).getA1Notation() +
                       ': ' + e.message });
            }
          }
        }

        /* THE PARK IS SPENT THE MOMENT THE BAND IS BACK ON THE TAB, AND THIS IS
           THE PASS THAT ALWAYS RUNS. writeColumns_ drops it too, but only on the
           path where the tab wrote cleanly — so every tab that threw (a failed
           check, and every tab stopped at the execution budget) left a park
           behind that the band restored HERE had already made stale. The next
           run then found one, put a band back that was already there, and said
           at warn that an earlier run had been killed. It had not been: it had
           thrown, been reported, and cleaned up after itself everywhere except
           here.

           A restore that could not be written keeps its park, because then the
           band really is still off the tab. */
        if (home && p.spec) dropPark_(p.spec);
      });

      if (ss) {
        SpreadsheetApp.flush();

        /* The workbook is written and its formulas are back: this is the moment
           the page's figures actually became the export's. Recorded even when a
           tab failed, because the tabs that DID write are the export's now and
           the header stamp is about them. */
        recordSync_(want, { at: Date.now(), tabs: done.length, failed: failed.length,
                            exportAt: exportAt, exportName: exportName });
      }

      /* --- every cached copy of these figures is now stale ---
         Skipped when nothing was written, because then nothing is stale: a run
         that could not read its export has changed no number anywhere, and
         clearing the caches would cost every page a cold rebuild for nothing. */
      if (done.length) {
        try { syncAll(); }
        catch (e) {
          /* The sync WORKED and the caches were not cleared, so every page will
             keep serving pre-sync numbers while reporting success. There is
             nothing else in the system that notices this. */
          APP_log('error', 'QLIKSYNC.run', 'data synced but the caches were NOT cleared — pages ' +
                  'will serve stale figures', { error: String(e && e.message || e) });
        }
      }

      /* NOBODY IS WATCHING THIS. run() is reached from a time-driven trigger and
         from the editor, and its return value has one reader in each case: the
         trigger's log line, and whoever typed qlikAggNow / qlikRmxNow /
         qlikSegmentNow. A tab that did not write is invisible to the person
         whose numbers are wrong — the tab still looks like a tab — so a failed
         run says so out loud before it returns, and arms the one retry if the
         failure is the kind a retry can fix.

         A CLEAN RUN CLEARS THE PAGE'S RETRY RECORD whether or not the retry is
         what fixed it: the scheduled timer comes round on its own and somebody
         can run that page's qlikAggNow / qlikRmxNow / qlikSegmentNow at any
         point, and either may land before the five-minute one-shot fires. */
      if (failed.length) reportFailure_(want, failed, filesSeen, started);
      else clearRetry_(want);

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
      return { ok: false, scope: want, error: e.message, files: filesSeen,
               done: done, skipped: skipped, failed: failed };
    } finally {
      try { lock.releaseLock(); }
      catch (e2) { APP_log('warn', 'QLIKSYNC.run', 'the sync lock was not released — the next ' +
                           'firing will wait it out', { error: String(e2) }); }
    }
  }

  /* toSheet and trash are exposed for §10's TPMAIL, which has the same problem
     this engine has - Apps Script cannot read an .xlsx, only Drive can convert
     one - and no reason to own a second answer to it. A copy made through
     convertToSheet_ is born in the script account's own Drive root, has every
     non-owner permission stripped, and wears TEMP_PREFIX, so sweepTemps_ above
     clears one a runtime kill strands whichever engine made it. */
  return { run: run, sources: sources_, lastSync: lastSync_,
           retry: runRetries_, retryPending: retryLog_, dropRetries: dropRetryTriggers_,
           shape: tabShape_,
           alertMail: alertMailOn_, setAlertMail: setAlertMail_, alertTo: alertTo_,
           toSheet: convertToSheet_, trash: trashFile_, tempPrefix: TEMP_PREFIX };
})();




/* ============================================================================
 * §6  AGG — Aggregates
 * ----------------------------------------------------------------------------
 * Price & Volume, its mapping check, AGG Fuel Recovery, and the Saskatchewan
 * rate table Fuel Recovery reads through PV.
 *
 * PV, PV_Lookup, FSC and SASKRATES each keep their own private toNum_ / norm_ /
 * gk_, and so do §5's QLIKSYNC and §7's RMX and RFSC. All fourteen definitions
 * have been diffed and the verdict is DO NOT UNIFY — see the file header, item
 * 4. Two things found here specifically, both recorded as findings rather than
 * fixed inside a cleanup:
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
 * ============================================================================ */

/* ---- PV_Backend.gs -----------------------------------------------------------
   Aggregates Price & Volume. Its getReport returns the cached report BEFORE it
   touches the pivot — the thing the Ready-Mix side did not do, and the whole of
   §2's note on the 14 MB bundle.  */

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
 *  1. CY and PY are the volume pair, however the tab heads it; the Year column
 *     says which year is which when it says CY/PY.
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
     spelled the way they spell it — see the file header, item 4.
     It cannot touch a value that is not a parenthesised NUMBER: "(n/a)" still
     reads 0, because parseFloat still gives NaN. The percent rule above is
     untouched: PV is RIGHT about "5%" and the others are wrong, and the two
     rules are about different inputs. */
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
  /* Volume, revenue and the surcharge split, whichever way the tab spells its
     periods — "2026 Volume" and "CY Volume" both land here, and so do "CY Rev
     exWorks" and "2026 Rev exWorks". When it says CY/PY the header names no
     year at all, so the Year column is what says which year is which; the tab
     keeps one, and it is the same column the month model reads. */
  var hdrArr = APP_hdrArray_(H);
  var cyData = APP_dataCyYear_(raw.rows, colIndex_(H, 'Year'));
  var vol = APP_yearCols_(hdrArr, 'volume',        cyData);
  var rev = APP_yearCols_(hdrArr, 'rev exworks',   cyData);
  var fsc = APP_yearCols_(hdrArr, 'fuel surcharge', cyData);
  var ix = {
    month: colIndex_(H, 'Month'), plantType: colIndex_(H, 'Plant Type'), materialFam: colIndex_(H, 'Material Family'),
    prodClass: colIndex_(H, 'Product Class [Rock]'), custSeg: colIndex_(H, 'Cust Segment [Rock]'),
    prodApp: colIndex_(H, 'Product Application'), plant: colIndex_(H, 'Plant'), material: colIndex_(H, 'Material'),
    custParent: colIndex_(H, 'Customer Parent'), soldTo: colIndex_(H, 'Sold To'),
    pyVol: vol.py, cyVol: vol.cy,
    pyRev: rev.py, cyRev: rev.cy,
    pyFsc: fsc.py, cyFsc: fsc.cy,
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
     bare ("Jul"), so monthKey_ can never say which year a row belongs to. The
     Fuel Recovery page keys its cells by year, so it needs this handed over. */
  enriched.cyYear = vol.cyYear;

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
  var vol = APP_yearCols_(APP_hdrArray_(H), 'volume',
                          APP_dataCyYear_(raw.rows, colIndex_(H, 'Year')));
  var iMo = colIndex_(H, 'Month'), iPy = vol.py, iCy = vol.cy;

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
    /* Revenue is reported in its own right now (the Overview's tables carry a
       Rev CY / Rev PY / Rev % group), so it is sent rather than left to be read
       back off ASP. The two agree everywhere except the one row that matters:
       volume zero with revenue on it — a credit or a freight-only line — where
       ASP is 0 and ASP x volume drops the dollars entirely. */
    cyRev: s.cyRev, pyRev: s.pyRev,
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

/* ===================== ONE PRICE INDEX, TWO GRAINS =====================
 * Qlik measures a price move at a fixed GRAIN and pools the result. Inside the
 * rows already sliced to one table row's context (market filter + customer
 * parent [+ segment / application / sold-to]), aggregate to that grain; a pair
 * carrying BOTH years' volume and revenue earns weight = its CY revenue and
 * factor = weight × its own ASP move; the index is Σ factor ÷ Σ weight.
 *
 * THE GRAIN IS THE ONLY DIFFERENCE between the two indices the business runs:
 *
 *     PPI   plant × material              Qlik: aggr(…, %plant, %material)
 *     CPI   plant × sold-to × material    Qlik's Cust Price Detail — whose
 *                                          "Customer" column is SOLD TO, not
 *                                          Customer Parent
 *
 * PPI asks what a product's price did; CPI asks what a customer was charged for
 * it. Adding sold-to splits one covered pair into many, and a customer who
 * bought a product in only one of the two years drops out of CPI while staying
 * in PPI — which is why the two carry different total weights and are not two
 * views of one number.
 *
 * Everything else — the coverage test, the weight, the factor, the pooling — is
 * the same arithmetic, so it is written ONCE here and every caller that starts
 * from RAW ROWS goes through it (custPpi_, custCpi_, applyPpi_, xfMetrics_,
 * segMetrics_ and the customer report).
 *
 * THE ONE PATH THAT DOES NOT, AND WHY IT IS LEFT ALONE. metrics_() reads the
 * pivot's OWN precomputed weight columns ("CY REV (FOR PPI)" / "FACTOR (CY REV
 * %)"), which buildPivot_ writes per pivot group — and that key is FINER than
 * plant × material: it carries plant type, material family and product class,
 * and on the customer variant segment and application too. A pair split across
 * two product classes is two pairs there, each coverage-tested on its own, so
 * the two methods do not have to agree and in general do not.
 *
 * That is NOT tidied away, because those are the numbers the Price & Volume
 * report has always published and the business reconciles against Qlik. Moving
 * metrics_ onto this function would move every PPI on that page in the same
 * commit as adding a column, with nothing failing. It is a real difference,
 * written down rather than unified — see README §7 and the toNum_ family for
 * the same rule applied to a different set of near-duplicates.
 * ====================================================================== */
var PI_SEP_ = '|\u2016|';

/* ---- THE DENOMINATOR IS NOT THE SUM OF THE WEIGHTS ------------------------
 * Read off Qlik's own Cust Price Detail exports (2026 Jan-Jul, all markets and
 * each of the four): CPI is [CPI Factor] / [TotalWeight], and TotalWeight is NOT
 * the sum of the Weight column. On the all-markets export they are $136,727,744
 * against $123,520,166 - a tenth apart, and the difference is the whole reason
 * the page read 3.6% where Qlik reads 3.33%.
 *
 *   TotalWeight = CY revenue of EVERY covered pair
 *   Factor      = CY revenue x ASP%, over covered pairs that are not outliers
 *
 * So a pair excluded as an outlier still counts in the denominator. It is
 * dropped from the numerator, not from the population - which is what makes the
 * exclusion a dilution rather than a deletion, and it is exactly what the two
 * columns in Qlik's export show. Verified: Sum(covered CY revenue) reproduces
 * TotalWeight to five significant figures on all five exports.
 *
 * PPI passes no outlier threshold, so for PPI every covered pair is in both
 * sums and this is arithmetically identical to what it has always computed.
 * ------------------------------------------------------------------------- */
function piCpiCov_() {
  var C = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.CUBE && APP_CONFIG.CUBE.COVERAGE)
        ? APP_CONFIG.CUBE.COVERAGE : {};
  return C.cpi || null;
}

/* ONE POOLING PASS, and `cov` is the whole difference between the two indices
   besides the key. PPI passes null and every test below collapses to the "> 0"
   it has always run; CPI passes \u00a71's cpi block and a pair that fails leaves BOTH
   sums. That last part is the correction: a gate DELETES a pair, where the
   outlier cap it replaces left the weight behind and only dropped the factor. */
function piIndex_(rows, ix, keyOf, cov) {
  var g = {};
  rows.forEach(function (r) {
    var k = keyOf(r);
    var o = g[k] || (g[k] = { pyVol: 0, cyVol: 0, pyRev: 0, cyRev: 0 });
    o.pyVol += toNum_(r[ix.pyVol]); o.cyVol += toNum_(r[ix.cyVol]);
    o.pyRev += toNum_(r[ix.pyRev]); o.cyRev += toNum_(r[ix.cyRev]);
  });
  var mv = cov ? (cov.minVol || 0) : 0,
      mr = cov ? (cov.minRev || 0) : 0,
      ma = cov ? (cov.minAsp || 0) : 0;
  var weight = 0, factor = 0;
  Object.keys(g).forEach(function (k) {
    var o = g[k];
    /* Coverage: both years carry volume AND revenue, above the floors. A pair
       that exists in only one year has no price MOVE to measure. */
    if (!(o.pyVol > mv && o.cyVol > mv && o.pyRev > mr && o.cyRev > mr)) return;
    var pyAsp = o.pyRev / o.pyVol, cyAsp = o.cyRev / o.cyVol;
    /* ...and a price in both years, not a rebate (see \u00a71 cpi.minAsp) */
    if (ma > 0 && !(cyAsp > ma && pyAsp > ma)) return;
    weight += o.cyRev;                                 // TotalWeight: every covered pair
    factor += o.cyRev * ((cyAsp - pyAsp) / pyAsp);     // Factor = Weight * ASP%
  });
  return { weight: weight, factor: factor, index: weight ? factor / weight : 0 };
}

function piKeyPpi_(ix) {
  return function (r) {
    return String(r[ix.plantCol] || '') + PI_SEP_ + String(r[ix.matCol] || '');
  };
}
/* CPI needs Sold To, and only the CUSTOMER variant of the pivot carries it.
   null when it is absent, so a caller reading the market variant reports NO CPI
   rather than a plant × material index under a CPI heading — which is the same
   number as PPI and would read as agreement rather than as an absent column. */
function piKeyCpi_(ix) {
  if (ix.soldTo == null || ix.soldTo === -1) return null;
  return function (r) {
    return String(r[ix.plantCol] || '') + PI_SEP_ + String(r[ix.soldTo] || '')
         + PI_SEP_ + String(r[ix.matCol] || '');
  };
}

function custPpi_(rows, ix) {
  var p = piIndex_(rows, ix, piKeyPpi_(ix), null);     // no floors: PPI is unchanged
  return { weight: p.weight, factor: p.factor, ppi: p.index };
}
/* null when the config carries no cpi block, for the same reason piKeyCpi_
   returns null without Sold To: report NO CPI rather than an ungated one. */
function custCpi_(rows, ix) {
  var k = piKeyCpi_(ix); if (!k) return null;
  var cov = piCpiCov_(); if (!cov) return null;
  var c = piIndex_(rows, ix, k, cov);
  return { weight: c.weight, factor: c.factor, cpi: c.index };
}

/* Qlik's outer guard: if the table row itself lacks positive both-year
   revenue, the index shows 0 regardless. Applied to both. */
function applyPpi_(m, rows, ix) {
  var live = (m.cyRev > 0 && m.pyRev > 0);
  var pp = custPpi_(rows, ix);
  m.ppi = live ? pp.ppi : 0; m.cyRevPpi = pp.weight; m.factorCy = pp.factor;
  var cc = custCpi_(rows, ix);
  if (cc) { m.cpi = live ? cc.cpi : 0; m.cyRevCpi = cc.weight; m.factorCpi = cc.factor; }
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
  /* A column is present if its FIGURE and PERIOD are, not if its exact string
     is. The export spells CY and PY as years and the workbook spells them CY
     and PY; it also heads the surcharge "Fuel Surchage". Naming any of those
     back rejects a perfectly good download. */
  function need(t, names, label) {
    var map = APP_periodMap_(t.hdr);
    var miss = names.filter(function (n) {
      var q = APP_period_(n);
      return APP_periodFind_(map, q.base, q, '') === -1;
    });
    if (miss.length) throw new Error(label + ' upload doesn\u2019t match the expected QlikView format. Missing column(s): '
      + miss.join(', ') + '. Please re-download from QlikView without changing the columns.');
  }
  var R = idxOf(payload.raw), O = idxOf(payload.other);
  need(R, ['Year', 'Month', 'Plant Type', 'Material Family', 'Product Class [Rock]', 'Cust Segment [Rock]',
           'Product Application', 'Plant', 'Material', 'Customer Parent', 'Sold To',
           'PY Rev exWorks', 'CY Rev exWorks', 'Fuel Surcharge'], 'Combined Data CPI Raw');

  /* THE VOLUME COLUMNS CARRY THE PERIOD, AND THIS LIST USED TO NAME 2026 AND
     2025. The read path has resolved them by shape since it was written and
     the UPLOAD path did not, so on the first export of a new year this
     required two columns the file no longer has and refused a perfectly good
     download with "Missing column(s): 2025 Volume, 2026 Volume". Loud rather
     than silent, which is why it survived, but wrong either way — and a file
     headed "CY Volume" would be refused the same way.

     Same rule as everywhere else: find the volume pair however it is headed,
     key it BY YEAR off the file's own Year column, and let each row pick its
     own. */
  var upCy    = APP_dataCyYear_(R.rows, colIndex_(R.H, 'Year'));
  var upVol   = APP_yearCols_(R.hdr, 'volume', upCy);
  var volCols = upVol.byYear;
  var volYears = Object.keys(volCols).map(Number).sort(function (a, b) { return b - a; });
  if (volYears.length < 2)
    throw new Error('Combined Data CPI Raw upload needs a current and a prior volume column '
      + '("CY Volume" and "PY Volume", or "#### Volume" for two years). Found: '
      + (volYears.length ? volYears.join(', ') : 'none')
      + '. Please re-download from QlikView without changing the columns.');
  need(O, ['Year', 'Sold To', 'Plant', 'Plant Type', 'Customer Parent', 'Cust Segment [Rock]', 'Month', 'Other Revenue'],
          'Combined Data Other Revenue');

  function ci(t, n) { return colIndex_(t.H, n); }
  var rp = { yr: ci(R, 'Year'), st: ci(R, 'Sold To'), pl: ci(R, 'Plant'), pt: ci(R, 'Plant Type'),
             cp: ci(R, 'Customer Parent'), cs: ci(R, 'Cust Segment [Rock]'), mo: ci(R, 'Month'),
             vol: volCols, cy: volYears[0], py: volYears[1],
             fsc: APP_periodFind_(APP_periodMap_(R.hdr), 'fuel surcharge',
                                  { base: 'fuel surcharge', period: '', year: 0 }, '') };
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

  /* the volume column named for THIS row's year; a row from a year the file has
     no column for contributes nothing, which is what the two literals used to
     say the long way round */
  function volOf(r) { var c = rp.vol[Math.round(toNum_(r[rp.yr]))]; return c == null ? 0 : toNum_(r[c]); }
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
    row.push(y === rp.py ? nf : 0, y === rp.cy ? nf : 0);
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
  var live = (s.cyRev > 0 && s.pyRev > 0);
  var pp = custPpi_(grpRows, ix), cc = custCpi_(grpRows, ix);
  return {
    cyVol: s.cyVol, pyVol: s.pyVol, volPct: s.pyVol ? (s.cyVol - s.pyVol) / s.pyVol : 0,
    cyAsp: cyAsp, pyAsp: pyAsp, aspPct: pyAsp ? (cyAsp - pyAsp) / pyAsp : 0,
    ppi: live ? pp.ppi : 0,
    /* null, not 0, when this pivot cannot answer for CPI: the page prints a dash
       rather than a flat zero that reads as "no price movement". */
    cpi: cc ? (live ? cc.cpi : 0) : null,
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
  /* The payload CARRIES the cpi coverage block (below), so the token belongs in the
     key that stores it — same rule and the same reason as ovcGen_ (§8). Without
     it a threshold edit is invisible here for the cache's six hours. Scoped to
     this one key rather than folded into gk_: nothing else under gk_ carries a
     coverage threshold, and widening it would throw away every PV cache for a
     change that touches one payload. */
  var ck = gk_('xfdata:' + period + '|c' + ovcCovTok_());
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

  /* SOLD_TO rides along so the BROWSER can compute CPI on this dataset too.
     Without it the cross-filtered tables gained or lost the CPI column purely
     on whether the payload fitted under XF_DATA_CAP - the local path could not
     answer, the server path could. It is one dictionary-coded column and it is
     nearly 1:1 with CUST_PARENT (which already falls back to it when blank), so
     the cost is small; and if it does push a period over the cap, the fallback
     is getCrossReport, which computes the same CPI. Consistent either way. */
  var FIELDS = XF_ORDER.concat(['MB', 'CUST_SEG', 'SOLD_TO']);
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
    cols.SOLD_TO.push(code('SOLD_TO', (ix.soldTo !== -1) ? (String(row[ix.soldTo] || '').trim() || '(blank)') : '(blank)'));
    cols.CUST_SEG.push(code('CUST_SEG', (ix.custSeg !== -1) ? (String(row[ix.custSeg] || '').trim() || '(blank)') : '(blank)'));
    nums.pyVol.push(r3(pv)); nums.cyVol.push(r3(cv));
    nums.pyRev.push(r2(pr)); nums.cyRev.push(r2(cr));
    nums.pyFsc.push(ix.pyFsc !== -1 ? r2(toNum_(row[ix.pyFsc])) : 0);
    nums.cyFsc.push(ix.cyFsc !== -1 ? r2(toNum_(row[ix.cyFsc])) : 0);
  });

  var payload = { ok: true, period: period, n: cols.MARKET.length,
                  dicts: dicts, cols: cols, nums: nums,
                  /* \u00a71's CPI coverage block, so the local path gates CPI on exactly
                     the rule the server does. null travels as null: a payload
                     that cannot say what the gate is reports NO CPI. */
                  cpiCoverage: ((ovcCfg_().COVERAGE || {}).cpi) || null,
                  generation: generation_() };
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
       check too. Exported as a value: bumping it means
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
     spelled the way they spell it — see the file header, item 4.
     It cannot touch a value that is not a parenthesised NUMBER: "(n/a)" still
     reads 0, because parseFloat still gives NaN. The percent rule above is
     untouched: PV is RIGHT about "5%" and the others are wrong, and the two
     rules are about different inputs. */
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
/* PV.SCHEMA IS IN THE KEY. It was not, and PV's own key
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

  /* CY volume and CY revenue, however the tab spells its periods, exactly as PV
     picks them. */
  var iP = ci_(H, 'Plant');
  var hdrArr = APP_hdrArray_(H), cyData = APP_dataCyYear_(raw.rows, ci_(H, 'Year'));
  var iV = APP_yearCols_(hdrArr, 'volume',      cyData).cy;
  var iR = APP_yearCols_(hdrArr, 'rev exworks', cyData).cy;
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
   serves two identical calls.  */

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
 * COLUMNS USED (matched on the FIGURE and its PERIOD, not on the literal name)
 *   Plant · Year · Month
 *   volume              - "CY Volume" or "#### Volume"; the row's Year picks
 *                         which, and the Year column is what dates a CY header
 *   rev exWorks         - "CY Rev exWorks" or "#### Rev exWorks"
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
     and take the best. A volume column counts however it is headed — "2026
     Volume", "CY Volume" — so neither a roll to a new year nor a switch to
     CY/PY needs an edit here. */
  var CPI_HEADER_NAMES_ = ['lookup key','sold to','plant','plant type','material family',
    'customer parent','product class [rock]','product application','material',
    'cust segment [rock]','year','month','cy rev exworks','py rev exworks',
    'new fuel surcharge','cy fuel surcharge','py fuel surcharge','fuel surcharge'];

  function headerRow_(grid, names){
    var want = {};
    (names || CPI_HEADER_NAMES_).forEach(function(n){ want[norm_(n)] = 1; });
    var best = 0, bestScore = -1, limit = Math.min(grid.length, 8);
    for (var r = 0; r < limit; r++){
      var row = grid[r] || [], score = 0;
      for (var c = 0; c < row.length; c++){
        var k = norm_(row[c]); if (!k) continue;
        if (want[k] || APP_period_(k).base === 'volume') score++;
      }
      if (score > bestScore){ bestScore = score; best = r; }
    }
    return best;
  }

  /* ---------- shared column resolution for a CPI grid ----------
     Used by both the sheet reader and the upload path, so an uploaded export
     and the live tab are parsed by exactly the same rules.

     `grid` and `headerRowNo` are how the year is read. This tab has been headed
     "2026 Volume" and "CY Volume", and a CY header names no year at all — so
     the Year column beside it is what says which year a CY column holds. Pass
     the grid and the period columns resolve either way; pass the header alone
     and only a year-named tab can be read. */
  function cpiCols_(header, headerRowNo, grid){
    var idx = {};
    header.forEach(function(h,i){ var k = norm_(h); if (k && !(k in idx)) idx[k] = i; });

    var c = {
      key:   pick_(idx, ['lookup key','key']),
      plant: pick_(idx, ['plant']),
      year:  pick_(idx, ['year']),
      month: pick_(idx, ['month']),
      fsc:    pick_(idx, ['new fuel surcharge']),
      rawFsc: pick_(idx, ['fuel surchage','fuel surcharge']),   // the source's own typo
      vol:   {}                      // year -> column
    };

    var dataCy = APP_dataCyYear_(grid, c.year, headerRowNo || 0);
    var volY   = APP_yearCols_(header, 'volume',       dataCy);
    var revY   = APP_yearCols_(header, 'rev exworks',  dataCy);
    var fscY   = APP_yearCols_(header, 'fuel surcharge', dataCy);
    c.vol   = volY.byYear;
    c.cyRev = revY.cy; c.pyRev = revY.py;
    c.cyFsc = fscY.cy; c.pyFsc = fscY.py;
    c.cyYear = volY.cyYear || dataCy;

    var miss = [];
    if (c.plant < 0) miss.push('Plant');
    if (c.year  < 0) miss.push('Year');
    if (c.month < 0) miss.push('Month');
    if (!Object.keys(c.vol).length) miss.push('a volume column ("CY Volume" or "#### Volume")');
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
    var c  = cpiCols_(grid[hr], hr + 1, grid);
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
    /* THE YEARS COME OUT WITH THE DATA. yMax is the newest year in the file and
       it has always decided which Rev column a row belongs to; everything below
       used to compare against the literals 2026 and 2025 instead, so on the
       first of January this page would have summed cells nothing had written
       and published a table of zeroes — silently, because zero is a number.
       RFSC_Backend.gs has carried cy/py since it was written; this is the
       Aggregates half doing the same. The year is DATA. */
    return { cells: cells, markets: markets, latest: latest || 1,
             monthList: monthList,
             cy: yMax, py: yMax - 1,
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
    /* fscT2026 / fscT2025 ARE NOT YEARS, THEY ARE CY AND PY. The names are the
       suite's convention — RFSC_Backend.gs's header states it and keeps them
       for the same reason: the two fuel pages are clones and a field rename
       here would have to be a rename there and in both pages. The actual years
       travel as cyYear / pyYear in the payload. */
    var rows = D.markets.map(function(mk){
      var c = sum_(D, mk, D.cy, months), p = sum_(D, mk, D.py, months);
      var f26 = c.avol ? c.fsc / c.avol : 0;
      var f25 = p.avol ? p.fsc / p.avol : 0;      // no prior-year charge → 0
      return { market: mk, totalVol: c.vol, totalFSC: c.fsc, appliedVol: c.avol,
               pctVolApplied: c.wVol ? c.avol / c.wVol : 0,
               appliedNS: c.ans, pctNSApplied: c.wNS ? c.ans / c.wNS : 0,
               fscT2026: f26, fscT2025: f25, yoy: f26 - f25 };
    });

    // TOTAL: sum components, re-derive ratios.
    var t = { totalVol:0, totalFSC:0, appliedVol:0, appliedNS:0, wv:0, wn:0, av25:0, fsc25:0 };
    D.markets.forEach(function(mk){
      var c = sum_(D, mk, D.cy, months), p = sum_(D, mk, D.py, months);
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
      var c = D.cells[mk + '|' + D.cy + '|' + mo] || { fsc:0, avol:0 };
      var p = D.cells[mk + '|' + D.py + '|' + mo] || { fsc:0, avol:0 };
      var t26 = c.avol ? c.fsc / c.avol : 0, t25 = p.avol ? p.fsc / p.avol : 0;
      return { month: MONTHS[mo-1], fscT25:t25, fsc25:p.fsc, vol25:p.avol,
               fscT26:t26, fsc26:c.fsc, vol26:c.avol, yoy: t26 - t25 };
    }
    var rows = months.map(line);
    var c = sum_(D, mk, D.cy, months), p = sum_(D, mk, D.py, months);
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
      var c = sum_(D, mk, D.cy, months), p = sum_(D, mk, D.py, months);
      var t26 = applied ? c.avol : c.vol, t25 = applied ? p.avol : p.vol;
      // Fuel recovery DOLLARS are the same money on both bases - only the tonnes
      // change. Taking afsc as the numerator dropped every credit row, which made
      // applied recovery LARGER than all-tonnes recovery even though applied tonnes
      // are a strict subset.
      var f26 = c.fsc, f25 = p.fsc;
      var pt26 = t26 ? f26 / t26 : 0, pt25 = t25 ? f25 / t25 : 0;
      // "New business": charged this year but not last → the prior-year $/t and
      // YOY show N/A, and this market is left out of the Grand Total's PY $/t.
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
    var yr = newestYear_(D, mk) || D.cy;

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
      /* THE TWO YEARS THIS PAYLOAD IS ABOUT, read off the data rather than the
         calendar or a constant. Every heading and title on the page is labelled
         from these — see app.html §C, which holds the fallback for a payload
         that predates them. RMX Fuel Recovery has sent them since it was
         written; this is the pair that lets the two pages stay clones. */
      cyYear:      D.cy,
      pyYear:      D.py,
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
   editor tool and the readout under the saskrates row in the Settings modal.
   It follows APP_EXTRA_SOURCES rather than a page list, so it
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
 * turn up. Do not "simplify" it to match §6's — see the file header, item 4.
 * ============================================================================ */

/* ---- RMX_Backend.gs ----------------------------------------------------------
   Ready-Mix: the loaders, the bundle, the PPI weights and the one pull.  */

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

/* ---- CURRENT AND PRIOR YEAR COME FROM THE COLUMNS ------------------------
   "2026 Vol", "2025 Net Sales ex VA (CAD)", "Total Revenue - 2026" — and now
   "CY Vol", "PY Net Sales Ex VA (CAD)", "Total Revenue -PY" as well, because
   the workbook has been re-headed and can be re-headed again.

   These were once spelled out as literals, so the two newest years were pinned
   to 2026 and 2025 in eight places. On the first export of a new year every
   one of those lookups returns -1, toNum_ turns the missing cell into 0, and
   the page publishes a full set of zeroes without failing.

   `base` is the figure with its period taken off, so one call covers every
   spelling of it. `dataCyYear` is what a CY/PY header cannot supply: the year
   read off the rows' own Bill Month, which is where this file's current year
   has to come from once the column names stop carrying one. */
function yearPair_(sheet, base, dataCyYear){
  var y = APP_yearCols_(APP_hdrArray_(sheet.idx), base, dataCyYear);
  return { cy: y.cyYear, py: y.pyYear, cyCol: y.cy, pyCol: y.py, years: y.years };
}
/* (kept small on purpose: one place decides what a year column looks like) */
function yearsInHeader_(sheet, base){ return yearPair_(sheet, base).years; }
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
      /* CY and PY, however the columns are headed — see yearPair_. When they
         say "CY Vol" rather than "2026 Vol" the header names no year, so the
         year comes off the rows' own Bill Month. */
      cyData=APP_dataCyYear_(s.values, cMonth, s.hdr + 1),
      vY=yearPair_(s, 'vol', cyData),
      rY=yearPair_(s, ['net sales ex va (cad)','net sales ex va'], cyData),
      cPyV=vY.pyCol, cPyR=rY.pyCol,
      cCyV=vY.cyCol, cCyR=rY.cyCol,
      /* Fuel surcharge, allocated down to the mix row by the sheet's own MAP
         formula: the plant x bill-month total from Extra Raw Data, split across
         that key's rows in proportion to volume. OPTIONAL - a workbook without
         the columns simply reports no surcharge by mix, and the Fuel Recovery
         page falls back to the Extras stream for every figure it can. */
      fY=yearPair_(s, 'fuel surcharge', cyData),
      cCyF=fY.cyCol, cPyF=fY.pyCol;
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
  /* WHICH TWO YEARS THESE ROWS ARE, carried on the array itself so the bundle
     and then every payload can say so without re-reading the header.
     PV_Backend.gs stamps getRawEnriched_'s array the same way. */
  out.cyYear = vY.cy || rY.cy;
  out.pyYear = vY.py || rY.py;
  return out;
}

function loadStream_(LK, sheetName, src, bag){
  var s = src || readSheet_(sheetName, ['plant','mat_prod_hier_3','major project segment']);
    var cMo=monthCol_(s),                          // Bill Month ("Apr-25" / "Apr-26")
      cPlant=col_(s,'plant'), cH3=col_(s,'mat_prod_hier_3'),
      cDescr=col_(s,'mat_descr'),
      cSeg=col_(s,'major project segment'),
      /* the two periods the columns carry, named either way, with the year
         off the rows' Bill Month for when they are named CY/PY */
      cyData=APP_dataCyYear_(s.values, cMo, s.hdr + 1),
      rY=yearPair_(s, 'total revenue', cyData),
      mY=yearPair_(s, 'm3 applied to', cyData),
      cPyR=rY.pyCol, cCyR=rY.cyCol,
      cPyM=mY.pyCol, cCyM=mY.cyCol;
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
  out.cyYear = rY.cy || mY.cy;
  out.pyYear = rY.py || mY.py;
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
            && Number(b.latestMonth) >= 1 && Number(b.latestMonth) <= 12
            /* a bundle written before the years travelled with the
               data has none, and a page reading it would fall back to a
               hard-coded pair. Same rule as the months check above, for the same
               reason — rebuild it rather than repair it. */
            && Number(b.cyYear) > 0);
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
    /* the two years the Main tab's columns carry, so every payload below can
       label its own headings instead of the page spelling out a year */
    cyYear: main.cyYear || 0,
    pyYear: main.pyYear || 0,
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
    /* the two years the data names, so the page's headings never spell one
       out themselves */
    out.cyYear = b.cyYear; out.pyYear = b.pyYear;
  } catch (e){ out.months = { all:[], cy:[] }; }
  return out;
}

/* =================== prepareAll - THE ONE PULL ===================
 * ONE CALL READS THE SHEET DATA. EVERYTHING ELSE READS A FINISHED ANSWER.
 *
 * The measurement that produced this:
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
    o.cyYear = bundle.cyYear; o.pyYear = bundle.pyYear;
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

     Sizes: one market is ~72 KB, Central Canada ~361 KB,
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
           cyYear:bundle.cyYear, pyYear:bundle.pyYear,
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
             cyYear: bundle.cyYear, pyYear: bundle.pyYear,
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
             cyYear:      bundle.cyYear, pyYear: bundle.pyYear,
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
    cyYear: bundle.cyYear, pyYear: bundle.pyYear,
    /* NOT `months` - that key is already taken above by the MONTHLY SERIES the
       trend charts read, and a second `months:` here silently overwrote it.
       The picker's option list travels as monthOptions. */
    month: monthSel_(bundle, opts.month), monthOptions: bundleMonths_(bundle),
    generation: generation_()
  };
  cachePut_(ck, report);
  return report;
}


  /* THE TWO FIELDS A DEVICE CACHE KEYS ON, AND NOTHING ELSE.
     -------------------------------------------------------------------------
     Every heavy Ready-Mix payload carries `generation` and `build`, and the
     pages hash the pair into the token AmrCache stamps its store with. Asking
     "is what this device holds still current?" therefore meant fetching a whole
     payload to read two strings off the front of it - so the Product Segment
     page called RMX_prepare on every open, and the answer was almost always
     "yes, exactly what you already have".

     This is those two strings on their own. It opens NO spreadsheet and NO
     bundle: generation_() is the source workbook's Drive MODIFIED TIME, memoised
     in this execution and in CacheService above it, and BUILD is a literal. It
     costs the round trip and, at worst, the same Drive metadata read every page
     already makes through getDataVersion.

     IT MUST KEEP RETURNING THE SAME TWO FIELDS, UNDER THE SAME NAMES, AS
     stamp() above. README §6 is explicit that two copies of a cache token is
     how you ship a check that disagrees with the thing it is checking: the
     device would be wiped on every other load and every request would recompute
     while every log line looked healthy. getDataVersion('rmx') is NOT a
     substitute - it answers APP_sourceStamp_ + APP_CODE_BUILD, which is a
     different pair with a different shape. */
  function getStamp(){
    return { ok:true, generation: generation_(), build: BUILD };
  }

  // Surface what the front end / Code.gs need.
  return {
    getMarkets:     getMarkets,
    getStamp:       getStamp,     // the device-cache token, without the payload
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
/* Is what this device already holds still current? See getStamp above: the two
   token fields, no sheet read, no bundle. */
function RMX_getStamp()           { return RMX_NS.getStamp(); }
function RMX_prepare(opts) {
  var t0 = Date.now();
  APP_log('info', 'RMX.prepareAll', 'reading',
          { market: (opts && opts.market) || '', month: (opts && opts.month) || 0,
            want: (opts && opts.want) || 'all', upload: !!(opts && opts.upload),
            force: !!(opts && opts.force) });
  try {
    var out = RMX_NS.prepareAll(opts);
    /* ELAPSED MS IS THE FIELD THAT EARNS ITS PLACE HERE. Every RMX
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

var SG_CACHE_VER = 'sg3';          // bumped: model shape (codes) + strength rule changed
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
  var pmK = sgCol_(pm, 'product code'),
      pmS = sgCol_(pm, 'strength class'),
      pmC = sgCol_(pm, 'new product class'),
      pmA = sgCol_(pm, 'new product application');
  var strengthSet = {}, clsSet = {}, appSet = {}, codes = {};
  for (var p = pm.hdr + 1; p < pm.values.length; p++){
    var rw = pm.values[p];
    /* THE CODES THEMSELVES, keyed exactly as applyRows keys them. A caller
       that hands in its own list (the Overview does) can be minutes older
       than this tab, so a code already here is dropped rather than proposed
       a second time. */
    if (pmK !== -1 && rw[pmK]) codes[String(rw[pmK]).trim().toUpperCase()] = 1;
    if (pmS !== -1 && rw[pmS]) strengthSet[String(rw[pmS]).trim()] = 1;
    if (pmC !== -1 && rw[pmC]) clsSet[String(rw[pmC]).trim()] = 1;
    if (pmA !== -1 && rw[pmA]) appSet[String(rw[pmA]).trim()] = 1;
  }

  return {
    flag:   { rows: flagRows,  idx: sgIndexRows_(flagRows)  },
    extras: { rows: extraRows, idx: sgIndexRows_(extraRows) },
    codes:  codes,
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

/* The caller's own list of Product Mix values, classified.
 *
 * Deduped by PRODUCT CODE, because that is the column applyRows keys on: two
 * descriptions sharing one code are one row in the tab, and offering both
 * would promise an add that the writer then reports as "already there".
 * A code the tab already carries is dropped for the same reason, and counted
 * as `already` so the caller can say WHY a section with rows on screen has
 * nothing left to add — which is the honest answer when the cube is older
 * than the lookup, and is not the same answer as "nothing matched".
 *
 * The order the caller sent is kept: the Overview sends biggest revenue
 * first, and that is the order the form should propose them in. */
function sgFromValues_(values, M){
  var seen = {}, product = [], asked = 0, already = 0, codes = (M && M.codes) || {};
  for (var i = 0; i < values.length; i++){
    var v = String(values[i] == null ? '' : values[i]).trim();
    if (!v) continue;
    asked++;
    var s = sgProductRow_(v), k = String(s.code || '').trim().toUpperCase();
    if (!k || seen[k]) continue;
    seen[k] = 1;
    if (codes[k]){ already++; continue; }
    product.push({ value: v, rows: 0, markets: [],
                   code: s.code, oldD: s.oldD, newD: s.newD,
                   strength: s.strength, cls: s.cls, app: s.app,
                   band: s.band, note: s.note, why: [] });
  }
  return { ok: true, product: product, extras: [], flag: [],
           options: M.options, asked: asked, already: already,
           total: product.length };
}

/* =================== public: suggestions ===================
 * TWO CALLERS, TWO SOURCES FOR THE MISS LIST.
 *
 *   · The Ready-Mix page asks with no `values`. Its Mapping check and this
 *     call read the SAME live report, so the list on screen and the list the
 *     dialog offers are the same list, and all three tabs are answered at once.
 *
 *   · The Overview asks with `values` — the mixes ITS mapping check listed.
 *     Those come from the month cube, which is the live report PLUS the
 *     closed-year books resolved against the LIVE PRODUCT MASTER. A mix that
 *     traded in a closed year and has since been dropped from the master is on
 *     that list and on no live one, so answering the Overview from the live
 *     report handed back rows it had not asked about — and, when the live
 *     report was clean, handed back nothing at all while 1,116 mixes sat on
 *     screen. Classifying the values it hands in is the whole fix, and it
 *     costs no report read: sgProductRow_ parses the text and nothing else.
 *
 * Only PRODUCT MASTER can be answered this way. EXTRAS and CUSTOM FLAG are
 * matched on a description the cube does not carry, so their miss lists still
 * come from the report, and a `values` call returns them empty rather than
 * pretending otherwise.
 */
function getSuggestions(opts){
  opts = opts || {};
  var M = sgModelCached_(!!opts.force);
  if (opts.values && opts.values.length) return sgFromValues_(opts.values, M);

  var un = RMX_NS.getUnmapped({ upload: opts.upload, force: !!opts.force });

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
           options: M.options, asked: product.length, already: 0,
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
 *     volume                         - "CY Vol" or "#### Vol"
 *     net sales                      - "CY Net Sales Ex VA (CAD)" or "####…"
 *     Major Project Segment          - the one product dimension this page can
 *                                      filter on (see FILTERS below)
 *
 *   Extra Raw Data - the surcharge itself: dollars AND applied m3.
 *     mat_prod_hier_3 matching /fuel surcharge/i
 *     revenue                        - "Total Revenue - CY" or "- ####"
 *     applied m3                     - "M3 Applied To - CY" or "- ####"
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
  function mainCols_(header, grid, hdrRow){
    var idx = {};
    header.forEach(function(h,i){ var k = norm_(h); if (k && !(k in idx)) idx[k] = i; });
    var c = {
      plant: pick_(idx, ['plant']),
      bill:  pick_(idx, MONTH_NAMES_),
      seg:   pick_(idx, ['major project segment','project segment','segment']),
      vol:   {},                     // year -> column
      ns:    {}                      // year -> column
    };
    /* "2026 Vol" or "CY Vol", and the same for net sales and the surcharge.
       A CY header names no year, so the year comes off the rows' own Bill
       Month — which is where this reader's current year has come from all
       along, and the reason it is the check rather than the header. */
    var cyData = APP_dataCyYear_(grid, c.bill, (hdrRow || 0) + 1);
    var volY = APP_yearCols_(header, 'vol', cyData);
    var nsY  = APP_yearCols_(header, ['net sales ex va (cad)','net sales ex va'], cyData);
    var fscY = APP_yearCols_(header, 'fuel surcharge', cyData);
    c.vol = volY.byYear;
    c.ns  = nsY.byYear;
    c.cyFsc = fscY.cy;
    c.pyFsc = fscY.py;

    var miss = [];
    if (c.plant < 0) miss.push('Plant');
    if (c.bill  < 0) miss.push('Bill Month');
    if (!Object.keys(c.vol).length) miss.push('a volume column ("CY Vol" or "#### Vol")');
    if (miss.length) throw new Error('The Main Raw Data tab is missing these column(s): '
      + miss.join(', ') + '. Check the header row spelling.');
    return c;
  }

  /* Extra Raw Data. mat_prod_hier_3 is REQUIRED - it is the only thing that says
     a line is the fuel surcharge, and there is no honest fallback for it. */
  function extraCols_(header, grid, hdrRow){
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
    /* "M3 Applied To - 2026", "M3 Applied To - CY", "2026 M3 Applied To" — the
       dash is optional and the period sits at either end. The year for a CY/PY
       header comes off the rows' Bill Month. */
    var cyData = APP_dataCyYear_(grid, c.bill, (hdrRow || 0) + 1);
    c.m3  = APP_yearCols_(header, 'm3 applied to', cyData).byYear;
    c.rev = APP_yearCols_(header, 'total revenue', cyData).byYear;

    var miss = [];
    if (c.plant < 0) miss.push('Plant');
    if (c.bill  < 0) miss.push('Bill Month');
    if (c.hier3 < 0) miss.push('mat_prod_hier_3');
    if (!Object.keys(c.m3).length)  miss.push('an applied-m\u00b3 column ("M3 Applied To - CY" or "- ####")');
    if (!Object.keys(c.rev).length) miss.push('a revenue column ("Total Revenue - CY" or "- ####")');
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
    var c   = extraCols_(grid[hdr] || [], disp, hdr);

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
    var c = mainCols_(grid[hdr] || [], grid, hdr);

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
   The Executive Overview, the month cube and the history eras.  */

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
  /* WHICH MONTH TO ANSWER FOR. 0 = let the data decide, which is the REPORTING
     month (last calendar month). The Overview passes the newest month the month
     cube holds instead, because that is what its slider calls "This month" and
     the two halves of that page have to be reporting the same month - the
     alternative is a KPI strip on July above a table on August, which is what
     it did. See app.html anchorMonth(). */
  var monthSel = Number(opts.month) || 0;
  if (monthSel < 1 || monthSel > 12) monthSel = 0;

  /* Server-side memo, keyed by ALL THREE source generations: pressing
     "Update from source" on the Price & Volume, RMX or Product Segment page
     bumps its generation, which makes this key unreachable — so the overview
     always reflects the base tables. Uses the shared chunked cache helpers
     from Code.gs. */
  var pvG = APP_getGen_('pricevolume'), rmxG = APP_getGen_('rmx'), sbG = APP_getGen_('segment');
  var gen = pvG + '-' + rmxG + '-' + sbG;
  var ck  = 'ov|g' + gen + '|' + period + '|m' + monthSel;
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
    unmatched: { pv: [] },  // PV markets present in the sheet but not in OVERVIEW.MARKETS

    /* WHICH MONTH THIS ANSWER IS FOR, 1-12, taken off the report below rather
       than the clock. The Overview draws two ways at once — the server reports
       here, and the browser month cube — and the two used to disagree about
       what "this month" meant: the server lands on the REPORTING MONTH (last
       calendar month, §7), while the cube naturally anchors on the newest block
       it holds, which in the running month is a part-billed month nobody has
       finished billing. The page then showed the server's July in its KPI strip
       and the cube's August in the table directly underneath it, and "Prev
       month" — August minus one — reproduced the server's July exactly, so the
       two Period buttons drew the same view.
       Sending the month makes one of them the anchor and it is this one: it
       comes from the DATA (pvReportMonth_ reads the months the rows actually
       carry) and it is the month every server-fed panel on the page is already
       showing. 0 when the report could not be read. */
    reportMonth: 0
  };

  /* ---------------- Aggregates (Price & Volume) ---------------- */
  try {
    var rep = PV.getReport({
      period: period,
      month: monthSel,
      dimensions: ['MARKET'],
      filterField: 'MARKET',
      filterValue: '__ALL__'
    });
    var table = (rep.tables && rep.tables[0]) ? rep.tables[0] : { rows: [], total: {} };

    /* pvStampMonth_ puts the month this report landed on onto every PV answer.
       Forwarded verbatim - the page anchors its month window on it. */
    out.reportMonth = rep.latestMonth || 0;

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
      cyRev: t.cyRev || 0, pyRev: t.pyRev || 0,
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
              /* base concrete revenue in its own right - the Overview's tables
                 report it beside volume, and ASP x volume loses a row that has
                 dollars on no volume */
              baseCY: g.baseCY, basePY: g.basePY,
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

/* The period columns for one figure ("Volume", "Vol", "Net Sales Ex VA (CAD)"),
   oldest first, as { y, i }. A header that says CY/PY carries no year of its
   own, so `cyYear` — read off the tab's Year column or its Bill Month — is
   what puts a year on those.

   NEVER USED TO DECIDE A ROW'S YEAR. An export that reuses the live template
   can carry 2026/2025 headers over 2025/2024 data. Only the pairing comes from
   here; the year itself comes from the Year column (AGG) or Bill Month (RMX),
   which is also what is handed in below. */
function ovcYearCols_(t, base, cyYear){
  var y = APP_yearCols_(APP_hdrArray_(t.idx), base, cyYear), out = [];
  Object.keys(y.byYear).forEach(function(k){ out.push({ y: Number(k), i: y.byYear[k] }); });
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
    /* optional: absent in older exports, handled in the roll */
    soldTo:   ovcColOpt_(t, 'sold to'),
    fscCyVol: ovcColOpt_(t, 'fsc cy volume'),
    fscPyVol: ovcColOpt_(t, 'fsc py volume')
  };
  /* Revenue and the surcharge split, however this era's book heads them. The
     year handed in is 0 here on purpose: these two are only ever needed as a
     CY/PY PAIR, and where the header names years the newest is CY either way.
     Volume is the one that needs the data to decide, and it is done below. */
  var revC = APP_yearCols_(APP_hdrArray_(t.idx), 'rev exworks', 0);
  var fscC = APP_yearCols_(APP_hdrArray_(t.idx), 'fuel surcharge', 0);
  c.cyRev = revC.cy; c.pyRev = revC.py;
  c.cyFsc = fscC.cy; c.pyFsc = fscC.py;
  /* THE HEADER DOES NOT DECIDE ANYTHING - not the year of a row, and not which
     volume column belongs to which year. The 2024/2023 export ships its two
     columns labelled "2023 Volume", "2024 Volume" in that order while the data
     underneath is still CY-then-PY like every other book, so pairing on the
     header year reads the wrong column for BOTH years and the whole era lands
     with zero volume against real revenue.

     So the Year column is read FIRST. It says which years the book holds — the
     only thing that can, for a tab headed "CY Volume" / "PY Volume" — and then
     the DATA says which of the two columns is CY. Each row fills exactly one
     of them, so totalling both split by Year and taking the larger on the yMax
     rows is unambiguous. Ties and empty books fall back to left-most = CY,
     which is how every export is laid out. */
  var yMin = 0, yMax = 0, i, y;
  for (i = t.hdr + 1; i < t.values.length; i++){
    y = Math.round(ovcNum_(t.values[i][c.year])); if (!y) continue;
    if (!yMax || y > yMax) yMax = y;
    if (!yMin || y < yMin) yMin = y;
  }
  if (!yMax) throw new Error('History Aggregates: the Year column is empty.');

  var vc = ovcYearCols_(t, 'volume', yMax);
  if (vc.length < 2) throw new Error('History Aggregates: expected two volume columns '
    + '("CY Volume" / "PY Volume", or "#### Volume").');

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
  /* ovcH_ leaves underscores alone, so the export's "bill_month" needs its own
     entry alongside the sheet's "Bill Month". It is read before the columns
     because it is what dates them: a tab headed "CY Vol" names no year. */
  var cBill = ovcCol_(t, 'bill month');
  if (cBill < 0) cBill = ovcCol_(t, 'billmonth');
  if (cBill < 0) cBill = ovcCol_(t, 'bill_month');
  if (cBill < 0) throw new Error('History Ready-Mix: no "Bill Month" column was found.');
  var cyBill = APP_dataCyYear_(t.values, cBill, t.hdr + 1);

  var vcols = ovcYearCols_(t, 'vol', cyBill);
  var rcols = ovcYearCols_(t, ['net sales ex va (cad)', 'net sales ex va'], cyBill);
  if (vcols.length < 2 || rcols.length < 2)
    throw new Error('History Ready-Mix: expected two volume and two net-sales columns '
      + '("CY Vol" / "PY Vol", or "#### Vol").');
  var byYear = {};
  vcols.forEach(function(x){ (byYear[x.y] = byYear[x.y] || {}).v = x.i; });
  rcols.forEach(function(x){ (byYear[x.y] = byYear[x.y] || {}).r = x.i; });
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

/* The Ready-Mix bundle already worked its own current year out — off the
   columns when they name one, off the rows' Bill Month when they say CY/PY —
   so the roll reads it from there rather than opening the workbook again. The
   header read below is the fallback for a bundle written before that field
   existed; it only works on a year-named header, which is why it is second. */
function ovcLiveRmxYear_(){
  var ss = APP_openSpreadsheet_('rmx');
  var S = APP_CONFIG.PAGES.rmx.SHEETS, want = ovcH_(S.MAIN), sh = null;
  ss.getSheets().forEach(function(s){ if (!sh && ovcH_(s.getName()) === want) sh = s; });
  if (!sh) throw new Error('Tab not found: "' + S.MAIN + '"');
  var head = sh.getRange(1, 1, Math.min(3, sh.getLastRow()), Math.min(30, sh.getLastColumn())).getDisplayValues();
  var best = 0;
  head.forEach(function(r){ r.forEach(function(h){
    var p = APP_period_(h); if (p.base === 'vol' && p.year > best) best = p.year;
  }); });
  if (!best) throw new Error('Could not read the current year from the Ready-Mix volume headers.');
  return best;
}
function ovcLiveRmx_(seed){
  var b = RMX_NS.dataBundle();
  return ovcRmxRoll_(null, null, null, b.main || [], b.cyYear || ovcLiveRmxYear_(), seed);
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
/* ---- A TUNABLE THAT SHIPS INSIDE A CACHED PAYLOAD NEEDS TO BE IN ITS KEY ----
 * §1's COVERAGE block is not read where it is used. The browser does the
 * pooling, so the thresholds TRAVEL — in the cube manifest (below) and in the
 * cross-filter dataset (getCrossData, §6) — and every cache key in that chain
 * was built from the DATA's generation and the cube's SHAPE. Neither moves when
 * a threshold is edited.
 *
 * So adding a CPI threshold changed nothing anyone could see. The server-side
 * manifest cache answered from the copy it built before the edit; the browser's
 * IndexedDB copy of that manifest is only ever wiped when the generation moves,
 * so it warm-painted from the pre-edit manifest indefinitely; and reading the
 * missing key with `|| 0` took it for "no gate at all". The Overview published
 * +141.7% for 2026 Jan-Aug against Qlik's 2.86% — one pair, plant 3P36 / Brock
 * Aggregates / 9141, whose prior year was a $0.14 residue after a credit,
 * carrying an ASP move of +492,409% and 135pp of the answer by itself. The
 * exclusion that exists to catch exactly that row was on the server the whole
 * time and never reached the code that pools.
 *
 * The token below is what makes a COVERAGE edit an invalidation. It hashes the
 * whole block, so a floor changing is the same kind of event as a shape change
 * and needs no second thing to remember. Pair it with the fail-closed read in
 * app.html's pool(): a payload that carries no threshold reports NO CPI rather
 * than an unexcluded one, so the gap between an edit and a warm device catching
 * up is an absent column instead of a wrong number.
 * ------------------------------------------------------------------------- */
function ovcCovTok_(){
  var C = ovcCfg_().COVERAGE || {}, parts = [];
  Object.keys(C).sort().forEach(function(k){
    var v = C[k];
    if (v && typeof v === 'object'){
      var inner = [];
      Object.keys(v).sort().forEach(function(k2){ inner.push(k2 + ':' + v[k2]); });
      parts.push(k + '{' + inner.join(',') + '}');
    } else parts.push(k + ':' + v);
  });
  var s = parts.join(';'), h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
function ovcGen_(){
  return APP_getGen_('pricevolume') + '-' + APP_getGen_('rmx') + '-h' + ovcHistTok_()
       + '-s' + OVCUBE_SHAPE_VER_ + '-c' + ovcCovTok_();
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
    /* the line's floors, plus \u00a71's CPI coverage block, so the browser gates CPI
       on exactly the rule the server does */
    coverage: (function(){
      var C = ovcCfg_().COVERAGE || {};
      var c = C[line] || { minVol:0, minRev:0 };
      return { minVol: c.minVol||0, minRev: c.minRev||0, cpi: C.cpi || null };
    })(),
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

   NOTHING ELSE IS UP THERE. Everything below is the reader, the writer and the
   geometry: code, not configuration. */


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

  /* ======================================================================
   * THE LAYOUT MAP - which template layout each recipe row is built from
   * ----------------------------------------------------------------------
   * DECK_RECIPE names a layout per row. That is the DEFAULT, and it is now
   * overridable from the Deck Builder page: pick a different layout for a
   * slide and it is written here, shared, and used by every build after it
   * until somebody picks again.
   *
   * ONLY THE DIFFERENCES ARE STORED. A row built from its recipe layout has
   * no key at all, which is what keeps an edit to DECK_RECIPE meaningful:
   * copying all 43 rows in here the first time anyone touched one would
   * freeze the recipe, and the next person to re-point a slide in the code
   * would change nothing and have no way to see why.
   *
   * NOTHING HERE VALIDATES AGAINST THE TEMPLATE, deliberately. This runs
   * with no Slides call, DECK_getRecipe is the page's first request, and
   * opening the template to check a name would put a multi-second API call
   * in front of the one stage that is meant to be instant. An override
   * naming a layout the template does not have is caught where every other
   * bad layout already is - readTemplate returns the real list, and the page
   * banners the mismatch before a build can start. Saving is checked instead
   * at the point of saving, where the page has the template open anyway.
   * ==================================================================== */
  function layoutMap_() {
    var raw = '';
    try { raw = PropertiesService.getScriptProperties().getProperty(DECK_CONFIG.PROP_LAYOUTS) || ''; }
    catch (e) { return {}; }
    if (!raw) return {};
    var o;
    /* A property that will not parse is not worth an error on every Plan:
       one bad write would lock the page out of a stage that has a perfectly
       good default sitting in DECK_RECIPE. Fall back to no overrides and
       say so in the log. */
    try { o = JSON.parse(raw); } catch (e) {
      Logger.log('DECK layout map is not valid JSON - ignoring it. Value: %s', raw);
      return {};
    }
    if (!o || typeof o !== 'object' || o instanceof Array) return {};
    var out = {};
    for (var k in o) {
      if (o.hasOwnProperty(k) && typeof o[k] === 'string' && o[k]) out[k] = o[k];
    }
    return out;
  }

  function writeLayoutMap_(map) {
    var props = PropertiesService.getScriptProperties();
    var keys = Object.keys(map);
    /* An empty map is a DELETED property, not the string "{}" - so "has
       anybody overridden anything?" stays one question with one answer. */
    if (!keys.length) props.deleteProperty(DECK_CONFIG.PROP_LAYOUTS);
    else props.setProperty(DECK_CONFIG.PROP_LAYOUTS, JSON.stringify(map));
    return map;
  }

  /* Set one row's layout. Passing the row's own recipe layout, or '', REMOVES
     the override rather than storing a key that says "the default" - see the
     only-the-differences rule above. Returns the whole map so the caller can
     see the state it just produced instead of assuming it. */
  /* The row an id names, whether DECK_RECIPE holds it or the Arrange stage
     added it. An added slide is a slide like any other - it takes a layout,
     it is retried by id, and its layout is overridable from the same dropdown
     - so a lookup that only knew about the array would refuse to save one. */
  function recipeRowById_(recipeId) {
    for (var i = 0; i < DECK_RECIPE.length; i++) {
      if (DECK_RECIPE[i].id === recipeId) return DECK_RECIPE[i];
    }
    var add = planStore_().add;
    for (var j = 0; j < add.length; j++) if (add[j].id === recipeId) return add[j];
    return null;
  }

  function setLayout_(recipeId, layoutId) {
    recipeId = String(recipeId || '');
    layoutId = String(layoutId || '');
    if (!recipeId) fail_('setLayout needs a recipe row id.');

    var map = layoutMap_();

    /* CLEARING IS ALWAYS SAFE, and it is checked FIRST because it is the one
       call that has to work for a slide that no longer exists: deleting an
       added row takes it out of `add`, and the override it left behind would
       otherwise be an orphan nobody could clear except by resetting every
       row's layout at once. Nothing is looked up and the template is not
       opened - there is no name to check. */
    if (!layoutId) {
      var back = recipeRowById_(recipeId);
      if (recipeId in map) {
        delete map[recipeId];
        writeLayoutMap_(map);
        Logger.log('DECK layout: %s cleared.', recipeId);
      }
      return { recipeId: recipeId, layout: (back && back.layout) || '',
               overridden: false, map: map };
    }

    var row = recipeRowById_(recipeId);
    if (!row) {
      fail_('No slide with id "' + recipeId + '". It is not in the recipe, and it is ' +
        'not one the Arrange stage has added.');
    }

    /* Checked HERE and not in layoutMap_ because this is the one path that
       already has a reason to open the template: a name that does not exist
       must never reach the store, or every later Plan carries the mistake. */
    var tpl = readTemplate(null), ok = false, names = [];
    for (var j = 0; j < tpl.layouts.length; j++) {
      if (tpl.layouts[j].role !== 'report') continue;
      names.push(tpl.layouts[j].layoutId);
      if (tpl.layouts[j].layoutId === layoutId) ok = true;
    }
    if (!ok) {
      fail_('"' + layoutId + '" is not a report layout in this template. ' +
        'It has: ' + (names.join(', ') || 'none') + '.');
    }

    if (layoutId === row.layout) delete map[recipeId];
    else map[recipeId] = layoutId;

    writeLayoutMap_(map);
    Logger.log('DECK layout: %s -> %s', recipeId, map[recipeId] || (row.layout + ' (default)'));
    return { recipeId: recipeId, layout: map[recipeId] || row.layout,
             overridden: !!map[recipeId], map: map };
  }

  /* Put every row back on the layout DECK_RECIPE names. */
  function resetLayouts_() {
    writeLayoutMap_({});
    Logger.log('DECK layout map cleared - every row is back on its recipe layout.');
    return { map: {} };
  }


  /* ======================================================================
   * THE ARRANGEMENT - order, membership, and the per-row edits
   * ----------------------------------------------------------------------
   * Modelled on layoutMap_ above, deliberately: same store, same shared
   * scope, same only-the-differences rule, same fall-back-and-say-so on a
   * property that will not parse. Two rules keep DECK_RECIPE meaningful:
   *
   *   1. NOTHING STORED means byte-identical to the recipe. An untouched row
   *      has no key anywhere - not in `order`, not in `rows`, nowhere.
   *   2. A RECIPE ROW ADDED AFTER AN ORDER WAS SAVED IS INSERTED BESIDE ITS
   *      RECIPE PREDECESSOR. Not appended, not dropped. Otherwise adding a
   *      slide in code would either do nothing visible or land it at the
   *      back of the pack, and neither is what the person editing the array
   *      asked for.
   *
   * NOTHING HERE VALIDATES A TABLE KEY OR A LAYOUT NAME, for the reason
   * layoutMap_ gives: DECK_getRecipe is Plan's only request and must stay
   * instant. setLayout checks a layout because it already has a reason to
   * open the template; nothing gives the arrangement that reason, and
   * mirroring the six adapters' dimension catalogues onto the server would
   * be a fourth copy of a list that already exists three times. Shape,
   * count and size are checked here; an unknown key is bannered by the page
   * at Plan, where the catalogue actually lives.
   * ==================================================================== */

  /* One property, parsed, or {} - never a throw. A bad write must not lock
     anybody out of Plan; the recipe underneath it is a perfectly good
     default. Same reasoning, same shape, as layoutMap_. */
  function readStore_(prop, what) {
    var raw = '';
    try { raw = PropertiesService.getScriptProperties().getProperty(prop) || ''; }
    catch (e) { return {}; }
    if (!raw) return {};
    var o;
    try { o = JSON.parse(raw); } catch (e) {
      Logger.log('DECK %s is not valid JSON - ignoring it. Value: %s', what, raw);
      return {};
    }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    return o;
  }

  /* An empty store is a DELETED property, not the string "{}", so "has
     anybody arranged anything?" stays one question with one answer.

     THE SIZE IS MEASURED BEFORE THE WRITE, not caught after it. `add` is the
     only unbounded part of either store, and a property that is refused
     leaves the last good arrangement in place - a truncated one would not. */
  function writeStore_(prop, obj, empty, what) {
    var props = PropertiesService.getScriptProperties();
    if (empty) { props.deleteProperty(prop); return obj; }
    var json = JSON.stringify(obj);
    if (json.length > DECK_CONFIG.PROP_MAX_BYTES) {
      fail_('This ' + what + ' is too big to save (' + json.length +
        ' characters; the limit is ' + DECK_CONFIG.PROP_MAX_BYTES + '). ' +
        'Nothing was changed. Delete some added slides, or shorten their titles.');
    }
    props.setProperty(prop, json);
    return obj;
  }

  /* Array.isArray, NOT `x instanceof Array`, everywhere in these two stores.
     Both take their input from google.script.run, which is a deserialisation
     boundary: the older idiom asks whether the value was built by THIS realm's
     Array, and an array that crossed a boundary was not. The layout map above
     keeps `instanceof` because it only ever reads its own JSON.parse output. */
  function strList_(v) {
    var out = [], seen = {};
    if (!Array.isArray(v)) return out;
    for (var i = 0; i < v.length; i++) {
      var s = String(v[i] == null ? '' : v[i]).trim();
      if (s && !seen[s]) { seen[s] = 1; out.push(s); }
    }
    return out;
  }

  /* The fields a row's own entry may change. `layout` is NOT one of them: it
     has had its own store since before this existed, and two places holding
     one answer is the drift README §9 is about. */
  var PLAN_FIELDS = ['source', 'market', 'refine', 'period', 'title', 'group'];

  function planRow_(o) {
    var out = null;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    for (var i = 0; i < PLAN_FIELDS.length; i++) {
      var k = PLAN_FIELDS[i];
      if (!o.hasOwnProperty(k)) continue;
      var v = String(o[k] == null ? '' : o[k]).trim();
      /* '' is a REAL value here - it is how a source change clears a period
         or a refine - so an empty string is kept and only an absent key
         means "unchanged". */
      (out = out || {})[k] = v;
    }
    return out;
  }

  function planStore_() {
    var o = readStore_(DECK_CONFIG.PROP_PLAN, 'plan');
    var plan = { v: 1, order: strList_(o.order), off: strList_(o.off),
                 on: strList_(o.on), drop: strList_(o.drop), rows: {}, add: [] };

    var rows = o.rows;
    if (rows && typeof rows === 'object' && !(Array.isArray(rows))) {
      for (var k in rows) {
        if (!rows.hasOwnProperty(k)) continue;
        var r = planRow_(rows[k]);
        if (r) plan.rows[String(k)] = r;
      }
    }

    var add = Array.isArray(o.add) ? o.add : [];
    var seen = {};
    for (var i = 0; i < add.length; i++) {
      var a = add[i];
      if (!a || typeof a !== 'object' || Array.isArray(a)) continue;
      var id = String(a.id == null ? '' : a.id).trim();
      if (!id || seen[id]) continue;
      seen[id] = 1;
      plan.add.push({
        id: id,
        source: String(a.source || '').trim(),
        market: String(a.market || '').trim(),
        refine: String(a.refine || '').trim(),
        period: String(a.period || '').trim(),
        layout: String(a.layout || '').trim(),
        group:  String(a.group  || '').trim() || 'Other',
        title:  String(a.title  || '').trim()
      });
    }
    return plan;
  }

  function planIsEmpty_(p) {
    return !p.order.length && !p.off.length && !p.on.length && !p.drop.length
        && !Object.keys(p.rows).length && !p.add.length;
  }

  function writePlan_(plan) {
    return writeStore_(DECK_CONFIG.PROP_PLAN, plan, planIsEmpty_(plan), 'arrangement');
  }

  /* Replace the whole arrangement. It is ONE object rather than a field at a
     time because every part of it is coupled: deleting a row has to come out
     of `order` and out of `add` in the same write, and two calls that can
     half-succeed would leave an order naming a slide that no longer exists.
     The page sends what it has on screen; this normalises and checks it. */
  function setPlan_(next) {
    next = next || {};
    var plan = { v: 1,
                 order: strList_(next.order), off: strList_(next.off),
                 on: strList_(next.on), drop: strList_(next.drop),
                 rows: {}, add: [] };

    var rows = next.rows;
    if (rows && typeof rows === 'object' && !(Array.isArray(rows))) {
      for (var k in rows) {
        if (!rows.hasOwnProperty(k)) continue;
        var r = planRow_(rows[k]);
        if (r) plan.rows[String(k)] = r;
      }
    }
    var add = Array.isArray(next.add) ? next.add : [];
    var seen = {};
    for (var i = 0; i < add.length; i++) {
      var a = add[i] || {};
      var id = String(a.id == null ? '' : a.id).trim();
      if (!id) fail_('An added slide has no id. Every slide needs one - it is what a retry targets.');
      if (!/^[A-Za-z0-9_\-]+$/.test(id)) {
        fail_('"' + id + '" is not a usable slide id. Letters, digits, - and _ only: ' +
          'the id is written into the slide’s speaker notes and read back with a pattern.');
      }
      if (seen[id]) fail_('Two added slides share the id "' + id + '". Ids must be unique.');
      seen[id] = 1;
      for (var j = 0; j < DECK_RECIPE.length; j++) {
        if (DECK_RECIPE[j].id === id) {
          fail_('"' + id + '" is already a slide in the recipe. An added slide needs an id of its own.');
        }
      }
      if (!String(a.source || '').trim()) fail_('The added slide "' + id + '" has no source.');
      if (!String(a.layout || '').trim()) fail_('The added slide "' + id + '" has no layout.');
      plan.add.push({
        id: id,
        source: String(a.source || '').trim(),
        market: String(a.market || '').trim(),
        refine: String(a.refine || '').trim(),
        period: String(a.period || '').trim(),
        layout: String(a.layout || '').trim(),
        group:  String(a.group  || '').trim() || 'Other',
        title:  String(a.title  || '').trim() || id
      });
    }

    writePlan_(plan);
    Logger.log('DECK plan saved: %s ordered, %s off, %s on, %s dropped, %s edited, %s added',
      plan.order.length, plan.off.length, plan.on.length, plan.drop.length,
      Object.keys(plan.rows).length, plan.add.length);
    return { plan: plan };
  }

  /* Back to DECK_RECIPE, exactly as it is written. */
  function resetPlan_() {
    writeStore_(DECK_CONFIG.PROP_PLAN, {}, true, 'arrangement');
    Logger.log('DECK plan cleared - the deck is the recipe again.');
    return { plan: { v: 1, order: [], off: [], on: [], drop: [], rows: {}, add: [] } };
  }


  /* ======================================================================
   * THE TABLE MAP - what each SCOPE shows
   * ==================================================================== */

  function kpiEntry_(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    var out = {};
    if (o.hasOwnProperty('on')) out.on = !!o.on;
    if (o.hasOwnProperty('sheet')) out.sheet = String(o.sheet == null ? '' : o.sheet).trim();
    return Object.keys(out).length ? out : null;
  }

  function tableMap_() {
    var o = readStore_(DECK_CONFIG.PROP_TABLES, 'table map');
    var out = { v: 1, scopes: {} };
    var sc = o.scopes;
    if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return out;
    for (var k in sc) {
      if (!sc.hasOwnProperty(k)) continue;
      var e = sc[k];
      if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
      var kept = {};
      if (Array.isArray(e.tables)) kept.tables = strList_(e.tables);
      var kpi = kpiEntry_(e.kpi);
      if (kpi) kept.kpi = kpi;
      /* WHICH SOURCE A row: SCOPE BELONGS TO. Every other rung carries its
         source in the key, so it self-invalidates when a row's source is
         changed; a row: key does not, and its table keys belong to the OLD
         adapter's catalogue and mean nothing to the new one. setTables
         stamps this; a store edited by hand may not have it, and then the
         entry is taken at face value. */
      if (e['for']) kept['for'] = String(e['for']).trim();
      if (Object.keys(kept).length) out.scopes[String(k)] = kept;
    }
    return out;
  }

  function writeTableMap_(map) {
    var empty = !Object.keys(map.scopes || {}).length;
    return writeStore_(DECK_CONFIG.PROP_TABLES, map, empty, 'table selection');
  }

  /* The most tables any adapter offers is nine. The cap is not a taste
     judgement about a readable slide - the page warns past four for that -
     it is a floor under the store: a hand-edited scope with two thousand
     keys in it is the thing that fills the property. */
  var TABLES_MAX = 16;

  /* Set one scope's tables and / or its KPI. Passing tables:null leaves the
     tables alone; passing [] is a real, empty selection and is refused for a
     source that needs at least one - see the QlikView card in Deck_PV. The
     caller says which source the scope belongs to so a row: key can be
     stamped; for every other rung it is the key's first segment anyway. */
  function setTables_(scopeKey, patch) {
    scopeKey = String(scopeKey || '').trim();
    patch = patch || {};
    if (!scopeKey) fail_('setTables needs a scope.');

    var map = tableMap_();
    var e = map.scopes[scopeKey] || {};

    if (patch.tables !== undefined && patch.tables !== null) {
      if (!Array.isArray(patch.tables)) fail_('The table selection has to be a list.');
      var list = strList_(patch.tables);
      if (list.length > TABLES_MAX) {
        fail_('That is ' + list.length + ' tables on one slide; ' + TABLES_MAX + ' is the limit.');
      }
      if (patch.min && list.length < patch.min) {
        fail_('This slide needs at least ' + patch.min + ' table' +
          (patch.min === 1 ? '' : 's') + ' - its KPI strip reads a grand total off one, ' +
          'and an empty selection publishes a picture that says "Load market data".');
      }
      e.tables = list;
    }

    if (patch.kpi !== undefined) {
      if (patch.kpi === null) delete e.kpi;
      else {
        var kpi = kpiEntry_(patch.kpi);
        if (!kpi) fail_('The KPI setting has to say on / off, a region sheet, or both.');
        e.kpi = kpi;
      }
    }

    if (scopeKey.indexOf('row:') === 0) {
      var src = String(patch.source || '').trim();
      if (src) e['for'] = src; else delete e['for'];
    } else {
      delete e['for'];
    }

    if (!Object.keys(e).length) delete map.scopes[scopeKey];
    else map.scopes[scopeKey] = e;

    writeTableMap_(map);
    Logger.log('DECK tables: %s -> %s', scopeKey, JSON.stringify(e));
    return { scope: scopeKey, entry: map.scopes[scopeKey] || null, map: map };
  }

  /* Clear one scope, or every scope when no key is given. */
  function resetTables_(scopeKey) {
    scopeKey = String(scopeKey || '').trim();
    if (!scopeKey) {
      writeStore_(DECK_CONFIG.PROP_TABLES, { v: 1, scopes: {} }, true, 'table selection');
      Logger.log('DECK table map cleared - every slide is back on its source’s own tables.');
      return { map: { v: 1, scopes: {} } };
    }
    var map = tableMap_();
    delete map.scopes[scopeKey];
    writeTableMap_(map);
    Logger.log('DECK tables: %s cleared.', scopeKey);
    return { scope: scopeKey, entry: null, map: map };
  }

  /* THE LADDER, most specific first. A row walks these and takes the first
     answer - tables and KPI resolved INDEPENDENTLY, because a market can
     want one set of tables for both its refines and a different KPI region
     on one of them.

     The refine rung only exists for a row that HAS a refine, which today
     means Southwest and nothing else; the market rung only for a row that
     names a market. So a Fuel Recovery row's whole ladder is 'row:fsc_mtd'
     then 'fsc', which is exactly right - it has no market to scope by. */
  function scopeLadder_(row) {
    var out = ['row:' + row.id], src = row.source || '';
    if (!src) return out;
    if (row.market && row.refine) out.push(src + '|' + row.market + '|' + row.refine);
    if (row.market) out.push(src + '|' + row.market);
    out.push(src);
    return out;
  }

  /* Resolve one field up the ladder. Returns { value, scope } with an empty
     scope when nothing is stored, which is the adapter's own default and the
     deck as it builds today. */
  function resolveScope_(map, ladder, field, source) {
    for (var i = 0; i < ladder.length; i++) {
      var e = map.scopes[ladder[i]];
      if (!e || e[field] === undefined) continue;
      /* A row: entry stamped for a DIFFERENT source is abandoned rather than
         applied: its table keys are the old adapter's and mean nothing to
         the new one. Broader scopes need no check - the source is in the key. */
      if (e['for'] && source && e['for'] !== source) continue;
      return { value: e[field], scope: ladder[i] };
    }
    return { value: null, scope: '' };
  }

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
   * reorderBuilt_ - the built slides, in the order they were planned in
   * ----------------------------------------------------------------------
   * `order` is a list of recipe ids, deck order, as the page has them. Every
   * slide carrying "SLIDE: <id>" is ranked by its place in that list; anything
   * built but NOT named keeps its current relative position behind the ranked
   * ones, which is what stops a slide from an earlier run being thrown away by
   * an order that predates it.
   *
   * THE COVER IS ALWAYS FIRST and is never in `order` - create() tags it
   * "SLIDE: __cover__" so finish() will not park it, and that same tag is what
   * pins it here rather than dropping it in with the unnamed rows at the back.
   *
   * Moving to an ABSOLUTE index also pushes every layout slide behind the
   * built ones, which is where the parking loop puts them anyway. A slide
   * already at its target index is left alone: this runs 43 times on a full
   * deck and a move is an API operation, so the common case - a deck built
   * straight through, already in order - costs nothing.
   * ==================================================================== */
  function reorderBuilt_(pres, order) {
    var rank = {};
    for (var i = 0; i < order.length; i++) {
      var id = String(order[i] || '');
      if (id && rank[id] === undefined) rank[id] = i;
    }

    var slides = pres.getSlides(), want = [], cur = [];
    for (var j = 0; j < slides.length; j++) {
      cur.push(slides[j].getObjectId());
      var rid = recipeIdOf_(slides[j]);
      if (!rid) continue;                                  // a layout; parked below
      var r = (rid === '__cover__') ? -1
            : (rank[rid] === undefined ? order.length : rank[rid]);
      want.push({ slide: slides[j], id: slides[j].getObjectId(), rank: r, was: j });
    }
    /* `was` breaks the tie, so an unranked slide - and two rows that somehow
       share an id - keep the order the deck already has rather than being
       shuffled by whatever the sort does with equal keys. */
    want.sort(function (a, b) { return (a.rank - b.rank) || (a.was - b.was); });

    /* `cur` MODELS the deck's order rather than re-reading it. getSlides()
       hands back a fresh wrapper per call, so two objects for one slide are
       never ===; and asking 43 times to answer "is it already there?" costs
       more than the moves. move(k) is a remove-then-insert, so mirroring that
       on the array keeps the model exact. */
    var moved = 0;
    for (var k = 0; k < want.length; k++) {
      if (cur[k] === want[k].id) continue;
      want[k].slide.move(k);
      cur.splice(cur.indexOf(want[k].id), 1);
      cur.splice(k, 0, want[k].id);
      moved++;
    }
    return moved;
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
   *
   * AND IT PUTS THE BUILT SLIDES IN ORDER FIRST, when the caller says what the
   * order is. See reorderBuilt_ above: this is the only place that can, because
   * it is the only step that runs once the last slide has landed.
   * ==================================================================== */
  function finish(deckId, order) {
    if (!deckId) fail_('finish called without a deckId.');
    var pres = SlidesApp.openById(deckId);

    var slides = pres.getSlides();

    /* PUT THE BUILT SLIDES IN THE ORDER THEY WERE PLANNED IN.
       addSlide always appends, and Publish skips a row that is already `done`,
       so a slide that failed at position 30 and was retried on the next press
       landed at 44 - behind every slide built before it. Nothing downstream
       noticed, because {{PAGE}} is stamped below against whatever order the
       deck happens to be in, so it numbered the wrong sequence confidently.

       That was survivable while the recipe was the only order there is: a
       retry was the only way to produce it, and it was rare. It stops being
       survivable the moment the order is editable from the page, because then
       the arrangement somebody saved is the thing the deck is meant to honour.

       AN ABSENT `order` KEEPS TODAY'S BEHAVIOUR EXACTLY. This is the publish
       path and it has never been run against the live deployment (README §11),
       so the no-argument call has to stay byte-for-byte what it was. */
    if (order && order.length) reorderBuilt_(pres, order);

    slides = pres.getSlides();
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
    create: create, addSlide: addSlide, finish: finish, status: status,
    layoutMap: layoutMap_, setLayout: setLayout_, resetLayouts: resetLayouts_,
    /* the arrangement and the table map. DECK_getRecipe reads both; the page
       writes them one call at a time. */
    plan: planStore_, setPlan: setPlan_, resetPlan: resetPlan_,
    tableMap: tableMap_, setTables: setTables_, resetTables: resetTables_,
    scopeLadder: scopeLadder_, resolveScope: resolveScope_
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
/* `order` is the recipe ids in DECK order - the arrangement the page is
   publishing, not the order the slides happened to be built in. Omit it and
   finish() behaves exactly as it did before it took one. */
function DECK_finish(deckId, order) { return DECK.finish(deckId, order); }
function DECK_status(deckId) { return DECK.status(deckId); }
/* The layout map. setLayout opens the template to check the name, so it is the
   slow one of the three and the only one that can fail. */
function DECK_setLayout(recipeId, layoutId) { return DECK.setLayout(recipeId, layoutId); }
function DECK_resetLayouts() { return DECK.resetLayouts(); }
/* The arrangement, and what each scope shows. Neither opens the template or a
   spreadsheet, so both are as quick as DECK_getRecipe - which is what lets the
   Arrange stage save optimistically and correct itself on the answer, the way
   the layout picker already does. */
function DECK_setPlan(plan) { return DECK.setPlan(plan); }
function DECK_resetPlan() { return DECK.resetPlan(); }
function DECK_setTables(scopeKey, patch) { return DECK.setTables(scopeKey, patch); }
function DECK_resetTables(scopeKey) { return DECK.resetTables(scopeKey); }


/* ---- Deck_Recipe.gs ----------------------------------------------------------
   Which slide is built from what. Southwest Land and Docks refine the Southwest
   MARKET rather than naming a market that does not exist.  */

/*****************************************************************************
 * Deck_Recipe.gs - WHICH slides the monthly deck contains, and in what order.
 * ---------------------------------------------------------------------------
 * THIS FILE IS CONFIG, NOT CODE - and it is the DEFAULT rather than the last
 * word. Adding, removing or reordering a slide here is still an edit to the
 * array and nothing else; it is no longer the only way to do any of them. The
 * Deck Builder's ARRANGE stage does all four from the page, and saves what it
 * does SHARED, in two Script Properties beside the layout map.
 *
 * Which leaves this array meaning what it always meant, on two rules those
 * stores keep: nothing stored is byte-identical to what is written here, and a
 * row added here after somebody saved an arrangement is inserted beside its
 * neighbour in this array rather than appended or dropped. Change what the
 * pack IS here; change what this month's pack does there.
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
 *   add the layout to the template, then pick it on those five rows in the Plan
 *   stage - which is now a dropdown, and no longer needs a code push.
 *
 * MARKET COVERAGE NOTE
 *   The source pack has no AGG summary slide for North, and no Top 10 slide for
 *   Central Canada. That is copied faithfully rather than "corrected" - if the
 *   business wants them, add the rows.
 *****************************************************************************/

/* THE RECIPE ITSELF IS IN §1 — Ctrl+F "§1 DECK". The list of slides is
   configuration and lives at the top; the checking below is code and lives
   here. */


/*****************************************************************************
 * DECK_getRecipe - the recipe, checked, for the page.
 * ---------------------------------------------------------------------------
 * The checking is the point. A duplicate id silently overwrites another
 * slide's status and makes a retry fix the wrong row; a row with no layout
 * fails at slide 30 of 43. Both are cheap to catch here and baffling to
 * diagnose later.
 *****************************************************************************/
/* One field of one row: the arrangement's edit if it has one, the recipe's
   value otherwise. '' IS A REAL EDIT - it is how changing a source clears a
   period or a refine that the new adapter has no use for - so an absent key
   is the only thing that means "unchanged". */
function DECK_planField_(base, edit, name) {
  return (edit && edit[name] !== undefined) ? edit[name] : String(base[name] || '');
}

function DECK_getRecipe() {
  var fieldOf_ = DECK_planField_;
  var problems = [];

  /* THREE STORES, READ ONCE EACH. All of it is one property apiece and none of
     it opens the template or a spreadsheet, which is what keeps Plan instant -
     see the note on layoutMap_ in Deck_Backend.gs for why that matters more
     than validating a name here would. */
  var over = DECK.layoutMap();          // which layout each row is built from
  var plan = DECK.plan();               // order, membership, per-row edits
  var tmap = DECK.tableMap();           // what each scope shows

  var dropped = {}, i, k;
  for (i = 0; i < plan.drop.length; i++) dropped[plan.drop[i]] = true;

  /* ---- 1 · THE LIVE ROWS, in NATURAL order -------------------------------
     Natural order is DECK_RECIPE as written, then the added rows. It is what
     `order` is applied ON TOP OF, and it is what a row with no place in a
     saved order falls back to - which is rule 2 in the store's header: a row
     added to the recipe after somebody saved an arrangement is inserted
     beside its recipe predecessor rather than appended or dropped. */
  var natural = [], seen = {}, offSet = {}, onSet = {};
  for (i = 0; i < plan.off.length; i++) offSet[plan.off[i]] = true;
  for (i = 0; i < plan.on.length; i++)  onSet[plan.on[i]] = true;

  function take(r, at, added) {
    if (!r.id) { problems.push(at + ' has no id.'); return; }
    if (seen[r.id]) {
      problems.push('Duplicate id "' + r.id + '" (' + at + ' and ' +
        seen[r.id] + '). Ids must be unique - they are what a retry targets.');
      return;
    }
    seen[r.id] = at;
    if (dropped[r.id]) return;                 // deleted from the pack outright
    natural.push({ recipe: r, added: !!added });
  }
  for (i = 0; i < DECK_RECIPE.length; i++) take(DECK_RECIPE[i], 'row ' + (i + 1), false);
  for (i = 0; i < plan.add.length; i++) take(plan.add[i], 'added slide "' + plan.add[i].id + '"', true);

  /* ---- 2 · THE SAVED ORDER, applied --------------------------------------
     The ids in `order` that are still live are the anchors. Everything else
     keeps its natural position RELATIVE to them: a row is emitted straight
     after the anchor it follows in natural order, and a row that precedes
     every anchor goes to the front. So adding a slide to DECK_RECIPE between
     two others puts it between those two others in the arranged deck. */
  var live = {}, ordered = [];
  for (i = 0; i < natural.length; i++) live[natural[i].recipe.id] = natural[i];
  for (i = 0; i < plan.order.length; i++) {
    if (live[plan.order[i]]) ordered.push(plan.order[i]);
  }

  var list;
  if (!ordered.length) {
    list = natural;                            // nothing saved: the recipe as written
  } else {
    var anchor = {}, after = { __head__: [] }, cursor = '__head__';
    for (i = 0; i < ordered.length; i++) { anchor[ordered[i]] = true; after[ordered[i]] = []; }
    for (i = 0; i < natural.length; i++) {
      var id = natural[i].recipe.id;
      if (anchor[id]) { cursor = id; continue; }
      after[cursor].push(natural[i]);
    }
    list = after.__head__.slice();
    for (i = 0; i < ordered.length; i++) {
      list.push(live[ordered[i]]);
      list = list.concat(after[ordered[i]]);
    }
  }

  /* ---- 3 · EACH ROW, with its edits, its tables and its KPI --------------- */
  var rows = [], warnedScope = {};
  for (i = 0; i < list.length; i++) {
    var base = list[i].recipe, edit = plan.rows[base.id] || null;
    var row = {
      id: base.id, source: fieldOf_(base, edit, 'source'),
      market: fieldOf_(base, edit, 'market'),
      /* a within-market narrowing, e.g. Southwest -> Land. The source decides
         what it means; nothing here needs to know. */
      refine: fieldOf_(base, edit, 'refine'), period: fieldOf_(base, edit, 'period'),
      title: fieldOf_(base, edit, 'title'), group: fieldOf_(base, edit, 'group') || 'Other'
    };

    if (!row.source) problems.push(row.id + ' has no source.');
    if (!row.title)  problems.push(row.id + ' has no title.');
    if (row.period && row.period !== 'MTD' && row.period !== 'YTD') {
      problems.push(row.id + ' has period "' + row.period + '" - expected MTD or YTD.');
    }

    /* An override on a row with no layout of its own is still an override, so
       the check stays about the RECIPE and this stays about the store. */
    var chosen = over[base.id] || base.layout;
    if (!base.layout) problems.push(row.id + ' has no layout.');

    /* THE LADDER. Tables and KPI are resolved INDEPENDENTLY - a market can
       want one set of tables across both its refines and a different KPI
       region on one of them - so each carries the rung that answered it. */
    var ladder = DECK.scopeLadder(row);
    var t = DECK.resolveScope(tmap, ladder, 'tables', row.source);
    var kp = DECK.resolveScope(tmap, ladder, 'kpi', row.source);

    row.layout = chosen;
    /* WHAT THE RECIPE SAYS, alongside what is being used. The page offers
       "back to default" from these, and showing which rows have been moved is
       the only way anyone can tell a deliberate change from one somebody made
       by accident three months ago. */
    row.recipeLayout = base.layout || '';
    row.layoutOverridden = !!(over[base.id] && over[base.id] !== base.layout);
    row.subtitle = base.subtitle || '';
    /* `optional` is what the RECIPE says; `on` is what this month's pack does,
       which is the recipe's answer unless somebody has ticked or unticked it
       here. An added row is on unless it says otherwise. */
    row.optional = !!base.optional;
    row.on = onSet[base.id] ? true : (offSet[base.id] ? false : !base.optional);
    row.added = !!list[i].added;
    row.rowEdited = !!edit;
    row.recipeRow = list[i].added ? null : {
      source: base.source || '', market: base.market || '', refine: base.refine || '',
      period: base.period || '', title: base.title || '', group: base.group || 'Other'
    };
    /* null = nothing stored, which is the adapter's own default and the deck
       as it builds today. The empty scope beside it says the same thing in the
       one place the page needs it: the scope selector, where the rung that is
       actually answering has to be visible before anybody changes five slides
       thinking they are changing one. */
    row.tables = Array.isArray(t.value) ? t.value.slice() : null;
    row.tablesScope = t.scope;
    row.kpi = kp.value ? { on: (kp.value.on === undefined ? true : !!kp.value.on),
                           sheet: kp.value.sheet || '' } : null;
    row.kpiScope = kp.scope;
    row.scopeLadder = ladder;

    rows.push(row);
  }

  /* ---- 4 · WHAT IS IN THE STORES AND NOT IN THE DECK ---------------------
     Say so; do not delete it here, because a read is not the place to write.
     A DROPPED id is the one case that must NOT be reported: a deletion is
     deliberate, and bannering it would put a warning on the page that nobody
     can clear - which is worse than the thing it warns about. Deleted slides
     have their own list in Arrange, with Restore, and that is where a drop is
     visible and undoable. */
  for (k in over) {
    if (over.hasOwnProperty(k) && !seen[k] && !dropped[k]) {
      problems.push('The saved layout for "' + k + '" points at a recipe row ' +
        'that no longer exists. It is being ignored. Use Reset layouts to clear it.');
    }
  }
  for (i = 0; i < plan.order.length; i++) {
    k = plan.order[i];
    if (!seen[k] && !dropped[k]) {
      problems.push('The saved order names "' + k + '", which is not a slide any ' +
        'more. It is being ignored - save the arrangement again to drop it.');
    }
  }
  for (k in plan.rows) {
    if (plan.rows.hasOwnProperty(k) && !seen[k] && !dropped[k]) {
      problems.push('The saved change to "' + k + '" is for a slide that no longer ' +
        'exists. It is being ignored - save the arrangement again to drop it.');
    }
  }

  /* THE DELETED SLIDES LIST. A drop is invisible and permanent from the page
     without it, and the only way back would be a Script Property edit. A
     dropped row that has ALSO left DECK_RECIPE is listed too, marked, so the
     entry can be cleared from the same place rather than banner-ing forever. */
  var recipeById = {};
  for (i = 0; i < DECK_RECIPE.length; i++) recipeById[DECK_RECIPE[i].id] = DECK_RECIPE[i];
  var deleted = [];
  for (i = 0; i < plan.drop.length; i++) {
    var d = recipeById[plan.drop[i]];
    deleted.push({ id: plan.drop[i], title: d ? (d.title || plan.drop[i]) : '',
                   group: d ? (d.group || 'Other') : '', inRecipe: !!d });
  }

  /* THE ORDER WITH NOTHING SAVED - the recipe as written, then the added rows.
     The page needs it to keep rule 1: an arrangement whose order matches this
     one is not an arrangement, and writing `order` anyway would freeze the
     recipe the first time anybody pressed a button. It cannot work this out
     for itself, because what it is given has already had the saved order
     applied to it. */
  var natural = [];
  for (i = 0; i < list.length; i++) natural.push(list[i].recipe.id);
  natural.sort(function (a, b) {
    function at(id) {
      for (var n = 0; n < DECK_RECIPE.length; n++) if (DECK_RECIPE[n].id === id) return n;
      for (var m = 0; m < plan.add.length; m++) if (plan.add[m].id === id) return DECK_RECIPE.length + m;
      return DECK_RECIPE.length + plan.add.length;
    }
    return at(a) - at(b);
  });

  return { rows: rows, count: rows.length, problems: problems,
           overrides: over, overrideCount: Object.keys(over).length,
           /* the arrangement as stored, so the page can save back exactly what
              it was given plus its own edit rather than reconstructing it */
           plan: plan, tables: tmap, naturalOrder: natural,
           planned: !!(plan.order.length || plan.off.length || plan.on.length ||
                       plan.drop.length || plan.add.length ||
                       Object.keys(plan.rows).length),
           scopeCount: Object.keys(tmap.scopes).length,
           deleted: deleted,
           /* the Add-slide picker's market list. One market, both spellings,
              against one key - which is what a source change re-maps through:
              the Southwest is 'Southwest' to Price & Volume and 'HNS_SW' to
              Ready-Mix, and a name that matches no row is what published
              Southwest Land as a page of zeroes. */
           markets: OVERVIEW.MARKETS };
}




/* ============================================================================
 * §10  SMALL PAGES
 * ----------------------------------------------------------------------------
 * The pages whose backends are small: the shared EBITDA workbooks, the Inventory
 * Report and its mail watch, and TP01 — which is no longer small. TP01 now holds
 * the comparison the page used to do in the browser (TPE), an .xlsx writer for
 * the trigger (TPXLSX), the automated report's settings (TPAUTO) and the mail
 * watch that drives it (TPMAIL), beside the mail sender that was always here.
 *
 * WHO SENDS TP01's MAIL DEPENDS ON WHAT STARTED IT, and the two answers differ.
 * A person pressing Send on the page goes through a WEB REQUEST, and
 * appsscript.json pins "executeAs": "USER_DEPLOYING" — so it is sent by whoever
 * DEPLOYED the app. That also makes getUserProperties() the deployer's for
 * everybody, which is why the market → email map is ONE shared list. The weekly
 * report is sent by a TRIGGER, and a trigger runs as WHOEVER CREATED IT. Create
 * the trigger from the deploying account and the two are the same one; the
 * automated settings are in SCRIPT properties either way, precisely so they
 * cannot end up in a store only one of the two can see.
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
 * TP01-ZIPR Transfer Price Tool — the page's backend
 * ---------------------------------------------------------------------------
 * WHAT THE PAGE ASKS FOR, IN THREE CALLS:
 *   TP_getComparison    the numbers. The browser parses the dropped workbooks
 *                       and sends grids; every figure is worked out here, by
 *                       TPE — the same engine the weekly trigger uses.
 *   TP_sendMarketEmail  one market's file, mailed. The page sends the workbook
 *                       it built; the SUBJECT AND BODY ARE BUILT HERE, off the
 *                       cached comparison, so there is one copy of them.
 *   TP_sendCombinedEmail the same, with every market's file on one mail.
 * plus the recipient map (below) and the automated report's settings (TPAUTO).
 *
 * WHY THE PAGE STOPPED DOING THE ARITHMETIC. It did all of it until the weekly
 * report had to be sent by a trigger, and a trigger has no browser. The choice
 * was one engine on this side or two copies of the same rules with nothing ever
 * reporting that they had drifted. TPE's banner has the rest.
 *
 * WHAT THE BROWSER STILL DOES, because it is better at both and neither is a
 * calculation: parsing a dropped .xlsx (SheetJS), and writing the .xlsx behind
 * the Download and Send buttons. The trigger cannot do the second one, which is
 * what TPXLSX is for.
 *
 * SENDER IDENTITY: mail from THIS file goes out as whoever the web app EXECUTES
 * AS, and appsscript.json pins that to "executeAs": "USER_DEPLOYING" — so every
 * mail a person sends from the page comes from the account that DEPLOYED the
 * app. The weekly report does NOT: it is sent by a trigger, and a trigger runs
 * as whoever created it. See §10's banner.
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


/* ---- the comparison, and the token the send calls come back with ---------
 *
 * The comparison is cached rather than handed back and forth, for one reason
 * that is not size: the SUBJECT AND BODY OF EVERY MAIL ARE BUILT HERE. A page
 * that posted rows back up with each Send would be a second chance for the two
 * sides to disagree about what they are describing, which is the whole thing
 * this arrangement exists to stop.
 *
 * SIX HOURS, which is CacheService's maximum, and the same expiry PV's uploaded
 * sessions have. A page left open longer gets a message telling it to drop the
 * file again rather than a stack trace.
 */
var TP_CMP_PREFIX = 'tp01|cmp|';

function TP_getComparison(payload) {
  var t0 = Date.now();
  payload = payload || {};

  var sap = TPE.readSap(payload.sap);

  /* THE UPLOADED FILE WINS WHEN IT IS THERE. With no QlikView file the other
     side is built from the Aggregates workbook, which is what the trigger
     always does and what the page does when only the SAP file is dropped. */
  var up = payload.qlk;
  var qlk = (up && up.headers && up.headers.length)
    ? { headers: up.headers, rows: up.rows || [], source: 'upload', meta: {} }
    : TPE.qlikFromSheet();

  var cmp = TPE.compare(sap, qlk);
  cmp.token = Utilities.getUuid();
  APP_cachePut_(TP_CMP_PREFIX + cmp.token, cmp);

  /* Three things the browser needs to WRITE a workbook and cannot work out
     without doing arithmetic again: the consolidated SAP grid behind the "SAP
     Consolidated" button, and the number-format map for each of the two shapes
     a market file comes in. iYearCol is what picks the volume and ASP columns,
     and there is one copy of it. */
  cmp.sapGrid = TPE.sapGrid(sap);
  cmp.formats = {
    mkt: TPE.numberFormats(cmp.headers),
    exc: TPE.numberFormats(cmp.headers.concat(['SAP Valid From', 'Days at Incorrect Price']))
  };

  APP_log('info', 'TP.getComparison', 'compared', {
    ms: Date.now() - t0, source: cmp.source, rows: cmp.rows.length,
    matched: cmp.matched, unmatched: cmp.unmatched,
    markets: Object.keys(cmp.markets || {}).length,
    exceptionMarkets: Object.keys(cmp.exceptions || {}).length,
    reportDate: cmp.reportDate, dateSource: cmp.dateSource
  });
  return cmp;
}

function TP_cmp_(token) {
  var cmp = token ? APP_cacheGet_(TP_CMP_PREFIX + String(token)) : null;
  if (!cmp) {
    throw new Error('This comparison has expired (sessions last up to 6 hours). ' +
      'Drop the SAP file again and the page will rebuild it.');
  }
  return cmp;
}

/* The subject both send paths use, so a market mail and the combined one
   cannot end up describing different weeks. */
function TP_subject_(kind, market, cmp) {
  var what = (kind === 'exc') ? 'Transfer Price Exceptions' : 'Transfer Price Report';
  return what + ' — ' + (market || 'All Markets') + ' (' + cmp.reportDate + ')';
}

var TP_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* One market's workbook, mailed. The page sends the file it built with SheetJS;
   everything that describes it is built here. */
function TP_sendMarketEmail(o) {
  if (!o || !o.to || !o.xlsxB64) throw new Error('Missing recipient or file.');
  var cmp = TP_cmp_(o.token);
  var kind = (o.kind === 'exc') ? 'exc' : 'mkt';
  var market = String(o.market || '');
  var list = ((kind === 'exc') ? cmp.exceptions : cmp.markets)[market];
  if (!list) throw new Error('There is nothing to send for "' + market + '".');

  MailApp.sendEmail({
    to: String(o.to),
    subject: TP_subject_(kind, market, cmp),
    htmlBody: TPE.emailBody(kind, market, list, cmp),
    attachments: [Utilities.newBlob(Utilities.base64Decode(o.xlsxB64), TP_XLSX_MIME,
                                    o.filename || 'Transfer_Price_Report.xlsx')]
  });
  return { ok: true };
}

/* Every market on one mail: the files attached, the breakdowns stacked. */
function TP_sendCombinedEmail(o) {
  if (!o || !o.to || !o.files || !o.files.length) throw new Error('Missing recipient or files.');
  var cmp = TP_cmp_(o.token);
  var kind = (o.kind === 'exc') ? 'exc' : 'mkt';

  MailApp.sendEmail({
    to: String(o.to),
    subject: TP_subject_(kind, '', cmp),
    htmlBody: TPE.stackedBody(kind, cmp),
    attachments: o.files.map(function (f) {
      return Utilities.newBlob(Utilities.base64Decode(f.xlsxB64), TP_XLSX_MIME,
                               f.filename || 'Transfer_Price_Report.xlsx');
    })
  });
  return { ok: true };
}


/* ---- TP01_Engine.gs ----------------------------------------------------------
   The comparison itself, moved off the page. One copy of the arithmetic, called
   by the browser and by the trigger.  */

/*****************************************************************************
 * TP01-ZIPR - the comparison engine (namespaced TPE)
 * ---------------------------------------------------------------------------
 * THIS USED TO LIVE IN THE BROWSER, and the whole of it did: the SAP read, the
 * Concat Key on both sides, the two revenue columns, the market split, the
 * exception rule, the aging and the email HTML were all in app.html's §P tp01.
 * That was fine while a person was the only way to start it. It stopped being
 * fine the moment a trigger had to do the same job, because a trigger has no
 * browser - and the alternative to moving it was a SECOND copy of the same
 * arithmetic on this side, with nothing at runtime ever reporting that the two
 * had drifted.
 *
 * So the split is now:
 *
 *   the browser   parses a dropped workbook (SheetJS) and writes the .xlsx the
 *                 Download and Send buttons produce. Neither is a calculation.
 *   this file     every number, and the email body.
 *   TPXLSX        writes the .xlsx for the trigger, which has no SheetJS.
 *
 * TWO INPUTS, ONE PIPELINE. The QlikView side can come from either:
 *
 *   · qlikFromSheet()  - the Aggregates workbook this app already reads,
 *     filtered to APP_CONFIG.TP01_MAIL.CUSTOMER_PARENT, restricted to the
 *     current year, rolled back up to the export's grain. This is the default
 *     and the only one the trigger can use.
 *   · a QlikView export dropped on the page, passed through as a grid. It WINS
 *     when it is there.
 *
 * Everything downstream of that choice is the same code, so this is two
 * sources, not two pipelines.
 *
 * WHAT MUST NOT DRIFT (README.md §7):
 *   · the period is never named back at a header. iYearCol_ finds the volume
 *     and ASP columns by SHAPE - CY, PY or a four-digit year at either end -
 *     and qlikFromSheet takes the year off the Year COLUMN, never off the
 *     calendar. A near miss returns -1 and the workbook then builds perfectly
 *     with blank revenue in it, which is the failure that shipped once.
 *   · the report date is the SAP file's OWN date cell. A file re-issued late
 *     must carry its own date, not the day the trigger happened to fire.
 *****************************************************************************/
var TPE = (function () {

  /* ======================================================================
   * PRIMITIVES - moved from the page, unchanged in meaning
   * ==================================================================== */

  function norm_(v) { return String(v == null ? '' : v).trim(); }

  function round4_(n) { return Math.round(n * 10000) / 10000; }

  function pad2_(n) { return (n < 10 ? '0' : '') + n; }

  /* Every date this engine handles ends up as YYYY-MM-DD, because that is what
     daysOutstanding_ subtracts: new Date('2026-01-01') is UTC midnight on both
     sides and the difference is exact days. A cell that cannot be read as a
     date is passed through as its own text rather than guessed at.

     THE mm/dd/yyyy BRANCH IS NEW. The SAP export writes "01/01/2026" and the
     page left that string alone - it happened to work because V8 parses US
     order, but it meant two shapes of the same field flowing through one
     subtraction. Normalising here costs nothing and removes the question. */
  function toDateStr_(val) {
    if (!val && val !== 0) return '';
    if (Object.prototype.toString.call(val) === '[object Date]') {
      return val.getFullYear() + '-' + pad2_(val.getMonth() + 1) + '-' + pad2_(val.getDate());
    }
    if (typeof val === 'number') {
      /* An Excel serial that survived a round trip through .xls. 25569 is the
         days between the 1900 and 1970 epochs; the range is what stops a plain
         quantity being read as a date. */
      if (val > 20000 && val < 80000) {
        var d = new Date(Math.round((val - 25569) * 86400000));
        return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
      }
      return String(val);
    }
    var s = String(val).trim();
    var m = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (m) return m[1] + '-' + pad2_(Number(m[2])) + '-' + pad2_(Number(m[3]));
    m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);            // 01/14/2026
    if (m) return m[3] + '-' + pad2_(Number(m[1])) + '-' + pad2_(Number(m[2]));
    return s;
  }

  /* THE COLUMN THAT NAMES A PERIOD, FOUND BY SHAPE AND NEVER BY NAME.
     Verbatim from app.html's §P tp01, and its comment there is the account of
     the day the six indexOf() calls it replaced all returned -1 at once: the
     volume and ASP columns read as missing, every Additional Revenue to Post
     came out of a blank cell, and the workbook still built and still
     downloaded with nothing on the page saying anything was wrong.

     Current wins: an explicit CY beats anything, a newer year beats an older
     one, and PY is taken only when it is all there is.

     NOTE it does NOT fold "ex-Works" / "exWorks" / "ex Works" together the way
     APP_hdrNorm_ does. The remainder is compared literally, so a caller asking
     for 'ASP ex-Works' gets nothing from a header spelling it 'ASP exWorks'.
     That is deliberate - both sides of this comparison are files this project
     writes or reads verbatim - but it is why qlikFromSheet spells its own
     headers the way it does. */
  function iYearCol_(headers, suffix) {
    var want = String(suffix).replace(/\s+/g, ' ').trim().toLowerCase();
    var best = -1, bestRank = -1;
    for (var i = 0; i < headers.length; i++) {
      var s = String(headers[i] == null ? '' : headers[i]).replace(/\s+/g, ' ').trim().toLowerCase();
      var m = /^((?:19|20)\d{2}|cy|py)\b[\s\-]*(.+)$/.exec(s), tok, rest;
      if (m) { tok = m[1]; rest = m[2]; }
      else {
        m = /^(.+?)[\s\-]*\b((?:19|20)\d{2}|cy|py)$/.exec(s);
        if (!m) continue;
        tok = m[2]; rest = m[1];
      }
      if (rest !== want) continue;
      var rank = (tok === 'cy') ? Infinity : (tok === 'py') ? 0 : Number(tok);
      if (rank > bestRank) { bestRank = rank; best = i; }
    }
    return best;
  }

  /* THE KEY, AND WHY THE TWO SIDES ARE EXTRACTED DIFFERENTLY.

     SAP:  S Plant + Ship-to/Partner PC (first character dropped) + Material
             3G00  +  64G00 -> 4G00                              +  9023
     AGG:  Plant   + Sold To            (first character dropped) + Material
             "3P02 - DUNDAS QUARRY"      "BURLINGTON READY MIX - P4Q01"
             -> 3P02                   +  P4Q01 -> 4Q01          +  9160

     Plant and Material put their CODE FIRST and Sold To puts it LAST, which is
     why there are two extractors and not one. Both sides then drop a
     one-character prefix from the customer / ship-to code - 6 on the SAP side,
     P on the Aggregates side - and the four characters that remain are the
     plant space, which is what makes the two line up at all. Verified against
     the Aggregates workbook, not assumed. */
  function buildSapKey_(plant, shipTo, material) {
    return norm_(plant) + norm_(shipTo).slice(1) + norm_(material);
  }
  function code_(val)       { var s = norm_(val); return s.indexOf(' - ') >= 0 ? s.split(' - ')[0].trim() : s; }
  function soldToCode_(val) { var s = norm_(val); return s.indexOf(' - ') >= 0 ? s.split(' - ').pop().trim() : s; }
  function buildQlkKey_(plant, soldTo, material) {
    return code_(plant) + soldToCode_(soldTo).slice(1) + code_(material);
  }

  /* Minimal HTML escape for the two sheet-sourced values the email prints.
     THE PAGE DID NOT DO THIS and a customer named "G&L Group" is why it is
     here - the ampersand is harmless, a stray angle bracket is not, and both
     come out of a column anybody can type into. */
  function esc_(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ======================================================================
   * THE SAP HALF
   * ==================================================================== */

  /* The eleven columns both tabs are reduced to, and what each tab calls them.
     TP01 and ZIPR carry the same figures under different headings; this is the
     only place that knows which is which. */
  var SAP_COLS = ['CnTy', 'Plant', 'Material', 'Ship-To Party', 'Concat Key', 'Amount',
                  'Currency', 'Pricing Unit', 'Unit of Measure', 'Valid From', 'Valid to'];
  var SAP_DATE_COLS = { 'Valid From': 1, 'Valid to': 1 };
  var SAP_MAP = {
    TP01: { 'CnTy':'CnTy', 'Plant':'S Plant', 'Material':'Material',
            'Ship-To Party':'Ship-to / Partner PC', 'Amount':'Amount', 'Currency':'Unit',
            'Pricing Unit':'per', 'Unit of Measure':'UoM',
            'Valid From':'Valid From', 'Valid to':'Valid to' },
    ZIPR: { 'CnTy':'CnTy', 'Plant':'Plant', 'Material':'Material',
            'Ship-To Party':'Ship-To Party', 'Amount':'Amount',
            'Currency':'Condition currency', 'Pricing Unit':'Pricing unit',
            'Unit of Measure':'Unit of measure',
            'Valid From':'Valid From', 'Valid to':'Valid to' }
  };

  /* The header row is not row 1 - the export puts a title, a date and a source
     line above it. It is the row carrying 'CnTy', and that is also what proves
     the grid is a SAP export at all. */
  function sapHeaderRow_(rows) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || [];
      for (var c = 0; c < r.length; c++) if (norm_(r[c]) === 'CnTy') return i;
    }
    return -1;
  }

  function sapRows_(data, headers, colMap) {
    var out = [];
    for (var i = 0; i < data.length; i++) {
      var row = data[i], obj = {};
      for (var c = 0; c < SAP_COLS.length; c++) {
        var col = SAP_COLS[c];
        if (col === 'Concat Key') continue;
        var idx = headers.indexOf(colMap[col]);
        var val = idx >= 0 ? row[idx] : '';
        if (SAP_DATE_COLS[col]) val = toDateStr_(val);
        obj[col] = (val == null) ? '' : val;
      }
      obj['Concat Key'] = buildSapKey_(obj['Plant'], obj['Ship-To Party'], obj['Material']);
      out.push(obj);
    }
    return out;
  }

  /* One SAP workbook, as { TP01: grid, ZIPR: grid } where a grid is an array of
     rows. Returns the consolidated rows, the report date, and the two counts.

     THE REPORT DATE COMES OFF THE FILE, three rows above its own header - the
     export writes a title, then the date, then "Source: SAP". Never off the
     calendar: a file re-issued a fortnight late still describes the day it was
     run, and README.md §7 is the rule this is an instance of. A file that has
     lost that cell is REPORTED rather than stamped with today, and the caller
     decides - which is the difference between a wrong date and a known one.

     BOTH TABS ARE REQUIRED, which is the page's rule and is kept deliberately.
     A price list with one of its two condition types missing produces
     confidently wrong corrections for every row the missing half priced, and
     there is nothing downstream that could notice. */
  function readSap(tabs) {
    if (!tabs) throw new Error('No SAP workbook was supplied.');
    var haveTp01 = !!(tabs.TP01 && tabs.TP01.length);
    var haveZipr = !!(tabs.ZIPR && tabs.ZIPR.length);
    if (!haveTp01 || !haveZipr) {
      throw new Error('The SAP workbook must contain both a TP01 and a ZIPR tab. Found: ' +
        (!haveTp01 && !haveZipr ? 'neither' : (haveTp01 ? 'TP01 only' : 'ZIPR only')) + '.');
    }

    var out = { rows: [], reportDate: '', dateSource: '', tp01Count: 0, ziprCount: 0 };
    ['TP01', 'ZIPR'].forEach(function (tab) {
      var g = tabs[tab] || [], hi = sapHeaderRow_(g);
      if (hi < 0) throw new Error('Could not find the header row (the one carrying "CnTy") on ' +
        'the ' + tab + ' tab of the SAP workbook.');
      var hdr = (g[hi] || []).map(norm_);
      var data = [], i, c;
      for (i = hi + 1; i < g.length; i++) {
        var r = g[i] || [], any = false;
        for (c = 0; c < r.length; c++) if (norm_(r[c]) !== '') { any = true; break; }
        if (any) data.push(r);
      }
      var rows = sapRows_(data, hdr, SAP_MAP[tab]);
      out.rows = out.rows.concat(rows);
      out[tab === 'TP01' ? 'tp01Count' : 'ziprCount'] = rows.length;

      if (tab === 'TP01' && !out.reportDate) {
        var cell = (g[hi - 3] && g[hi - 3][1]) || (g[2] && g[2][1]) || '';
        var got = toDateStr_(cell);
        if (/^\d{4}-\d{2}-\d{2}$/.test(got)) { out.reportDate = got; out.dateSource = 'file'; }
      }
    });
    return out;
  }

  /* ======================================================================
   * THE QLIKVIEW HALF, BUILT FROM THE AGGREGATES SHEET
   * ==================================================================== */

  /* WHY THIS IS NOT A SECOND EXPORT. The QlikView transfer-pricing report is a
     filtered, rolled-up view of the same Aggregates data this app already
     reads - so PV.rawEnriched() is the whole source. It arrives already
     market-enriched (REGION LOOKUP, keyed on Plant) and already carrying the
     current year, worked out from the Year COLUMN rather than the calendar.
     Nothing new is opened and no setting is added.

     A RAW ROW CARRIES ONE YEAR. A 2025 row parks its figures in the PY columns
     and zeros the CY ones; a 2026 row does the opposite. So "this year only" is
     BOTH halves - the Year column AND the CY columns - and testing only one of
     them silently drops or doubles rows depending which you pick.

     THE FILTER IS EXACT EQUALITY, NEVER A CONTAINS. That column also carries
     "Metrix RMX", which is a different company.

     THE ROLL-UP. The Aggregates tab is drilled down further than the export
     was: it also splits by Plant Type, Material Family, Product Class, Product
     Application and Cust Segment. Summing those away leaves the export's own
     grain, and the ASP is RECOMPUTED from the sums -

         ASP ex-Works = SUM(revenue) / SUM(volume)

     never averaged from the row-level ASPs. That is the revenue-weighted rule
     every Price & Volume pivot uses (§6), and it is what makes
     (SAP TP - ASP) x Volume come out right at this grain rather than at the one
     the rows arrived in. */
  var GK_ = String.fromCharCode(1);      // group-key join, as the month cube does it

  function qlikFromSheet() {
    var wantParent = String((APP_CONFIG.TP01_MAIL && APP_CONFIG.TP01_MAIL.CUSTOMER_PARENT) || '');
    var wantKey = wantParent.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!wantKey) throw new Error('APP_CONFIG.TP01_MAIL.CUSTOMER_PARENT is empty - there is ' +
      'nothing to filter the Aggregates rows down to.');

    var rows = PV.rawEnriched();
    var cyYear = Number(rows.cyYear || 0);
    if (!cyYear) throw new Error('The Aggregates sheet Year column gave no current year, so ' +
      'there is no way to tell which of its two volume columns is this year.');

    var acc = {}, order = [], parents = {}, noMarket = {}, kept = 0, seen = 0;
    for (var i = 0; i < rows.length; i++) {
      var e = rows[i];
      seen++;
      var p = String(e.custParent == null ? '' : e.custParent).replace(/\s+/g, ' ').trim();
      parents[p] = (parents[p] || 0) + 1;
      if (p.toLowerCase() !== wantKey) continue;
      if (Number(e.year || 0) && Number(e.year) !== cyYear) continue;

      var vol = Number(e.cyVol) || 0, rev = Number(e.cyRev) || 0;
      if (!vol && !rev) continue;

      var market = String(e.market == null ? '' : e.market).trim();
      if (!market) { noMarket[String(e.plant || '(blank plant)')] = 1; market = 'Unknown'; }

      var soldTo   = String(e.soldTo   == null ? '' : e.soldTo).trim();
      var plant    = String(e.plant    == null ? '' : e.plant).trim();
      var material = String(e.material == null ? '' : e.material).trim();
      var month    = String(e.month    == null ? '' : e.month).trim();

      var k = [market, month, plant, material, soldTo].join(GK_);
      var a = acc[k];
      if (!a) {
        a = acc[k] = { market: market, soldTo: soldTo, plant: plant,
                       material: material, month: month, vol: 0, rev: 0 };
        order.push(k);
      }
      a.vol += vol; a.rev += rev;
      kept++;
    }

    /* The two headers the comparison finds by shape. They name the year the
       DATA is, taken off the Year column - so this rolls to 2027 on its own,
       and neither name is ever written in code. Spelled to match what
       iYearCol_ compares literally: "ASP ex-Works", with the hyphen. */
    var headers = ['Market', 'Customer Parent', 'Sold To', 'Plant', 'Material', 'Month',
                   cyYear + ' Volume', cyYear + ' Rev exWorks', cyYear + ' ASP ex-Works'];

    var out = [];
    for (var n = 0; n < order.length; n++) {
      var g = acc[order[n]];
      out.push([g.market, wantParent, g.soldTo, g.plant, g.material, g.month,
                round4_(g.vol), round4_(g.rev), g.vol ? round4_(g.rev / g.vol) : '']);
    }

    var strays = Object.keys(noMarket);
    if (strays.length) {
      /* NOT SILENT (§7). These rows are kept, under the market "Unknown", so
         the money is still reported - but a plant missing from REGION LOOKUP is
         a lookup that needs a row, not a rounding error. */
      APP_log('warn', 'TPE.qlikFromSheet', 'plants with no REGION LOOKUP row - their rows are ' +
              'grouped under the market "Unknown" rather than dropped',
              { plants: strays.slice(0, 10).join(', '), count: strays.length });
    }

    return {
      headers: headers, rows: out, source: 'sheet',
      meta: { cyYear: cyYear, customerParent: wantParent, rawRows: seen,
              matchedParentRows: kept, rolledRows: out.length,
              unmappedPlants: strays, parents: parents }
    };
  }

  /* ======================================================================
   * THE COMPARISON
   * ==================================================================== */

  /* THE THREE COLUMNS THIS ADDS, and the shape of the output.

     Concat Key goes in immediately after Month, exactly where the page put it,
     because that is the column order everyone downstream has learned to read.
     The three calculated columns go on the end:

       SAP Transfer Price                 looked up by Concat Key
       Additional Revenue to Post       = (TP - ASP) x Volume
       Total Corrected Revenue ex-Works = that + (ASP x Volume)

     A ROW WITH NO SAP PRICE GETS ALL THREE BLANK, never zero. Zero is a price;
     blank is "there is no price for this", and the difference between them is
     the entire meaning of the unmatched count. */
  function compare(sap, qlk) {
    var sapPrice = {}, sapFrom = {}, i;
    for (i = 0; i < sap.rows.length; i++) {
      var sr = sap.rows[i], sk = norm_(sr['Concat Key']);
      /* FIRST ROW PER KEY WINS, and TP01 is concatenated ahead of ZIPR, so a
         key priced on both tabs takes its TP01 price. That is the page's rule
         and the business's. */
      if (sk && !(sk in sapPrice)) { sapPrice[sk] = sr['Amount']; sapFrom[sk] = sr['Valid From']; }
    }

    var qH = qlk.headers.map(norm_);
    var iSoldTo = qH.indexOf('Sold To');
    var iPlant  = qH.indexOf('Plant');
    var iMat    = qH.indexOf('Material');
    var iMonth  = qH.indexOf('Month');
    var iVolume = iYearCol_(qH, 'Volume');
    var iASPin  = iYearCol_(qH, 'ASP ex-Works');
    if (iSoldTo < 0 || iPlant < 0 || iMat < 0) {
      throw new Error('The QlikView data has no Sold To / Plant / Material columns, so no ' +
        'Concat Key can be built from it. Headers seen: ' + qlk.headers.join(' | '));
    }
    if (iVolume < 0 || iASPin < 0) {
      /* NOT a silent -1. This is README.md §7 exactly: every Additional Revenue
         to Post would come out of a blank cell and the workbook would still
         build, still download and still send, under correct-looking headings. */
      throw new Error('The QlikView data has no volume and/or ASP ex-Works column naming a ' +
        'period (CY, PY or a four-digit year). Headers seen: ' + qlk.headers.join(' | '));
    }

    var at = iMonth;                              // Concat Key is inserted after Month
    var headers = qlk.headers.slice(0, at + 1)
      .concat(['Concat Key'])
      .concat(qlk.headers.slice(at + 1))
      .concat(['SAP Transfer Price', 'Additional Revenue to Post',
               'Total Corrected Revenue ex-Works']);

    var rows = [], vfrom = [], matched = 0, unmatched = 0;
    for (var n = 0; n < qlk.rows.length; n++) {
      var src = qlk.rows[n], clean = [], c;
      for (c = 0; c < src.length; c++) {
        clean.push(Object.prototype.toString.call(src[c]) === '[object Date]'
                   ? toDateStr_(src[c]) : src[c]);
      }
      var key = buildQlkKey_(String(clean[iPlant]  == null ? '' : clean[iPlant]),
                             String(clean[iSoldTo] == null ? '' : clean[iSoldTo]),
                             String(clean[iMat]    == null ? '' : clean[iMat]));
      var raw = (key in sapPrice) ? sapPrice[key] : null;
      var tp = (raw !== null && raw !== '' && !isNaN(Number(raw))) ? Number(raw) : null;
      if (tp !== null) matched++; else unmatched++;

      var asp = Number(clean[iASPin]), vol = Number(clean[iVolume]);
      var add = (tp !== null && !isNaN(asp) && !isNaN(vol)) ? round4_((tp - asp) * vol) : '';
      var tot = (add !== '' && !isNaN(asp) && !isNaN(vol)) ? round4_(add + (asp * vol)) : '';

      rows.push(clean.slice(0, at + 1).concat([key]).concat(clean.slice(at + 1))
                     .concat([tp !== null ? tp : '', add, tot]));
      vfrom.push((key in sapFrom) ? (sapFrom[key] || '') : '');
    }

    /* Sorted on the Concat Key, like the page's file, so the same week's files
       produce the same workbook however many times they are run. */
    var keyAt = at + 1, idx = [];
    for (i = 0; i < rows.length; i++) idx.push(i);
    idx.sort(function (a, b) { return String(rows[a][keyAt]).localeCompare(String(rows[b][keyAt])); });
    var sRows = [], sFrom = [];
    for (i = 0; i < idx.length; i++) { sRows.push(rows[idx[i]]); sFrom.push(vfrom[idx[i]]); }

    var cmp = { headers: headers, rows: sRows, vfrom: sFrom,
                matched: matched, unmatched: unmatched,
                reportDate: sap.reportDate, dateSource: sap.dateSource,
                sapRows: sap.rows.length, tp01Count: sap.tp01Count, ziprCount: sap.ziprCount,
                source: qlk.source || 'sheet', meta: qlk.meta || {} };
    split_(cmp);
    return cmp;
  }

  /* Days the SAP price has been in effect while wrong: report date minus that
     price's Valid From. null when either date is missing - which is not the
     same as zero, and is printed as a dash rather than "0 days". */
  function daysOutstanding_(cmp, i) {
    var vf = cmp.vfrom[i];
    if (!vf || !cmp.reportDate) return null;
    var from = new Date(vf), ref = new Date(cmp.reportDate);
    if (isNaN(from.getTime()) || isNaN(ref.getTime())) return null;
    return Math.max(0, Math.floor((ref - from) / 86400000));
  }

  /* THE MARKET SPLIT AND THE EXCEPTION RULE.

     An exception is a row that MATCHED and whose SAP price is BELOW the ASP by
     more than a cent. Both sides are rounded to whole cents first so the test
     agrees with what is printed. A price that is higher, equal, or off by only
     a cent either way is not an exception - the asymmetry is the rule and not
     an oversight: revenue is being under-posted only when SAP is the lower
     number.

     Exceptions come out longest-outstanding first, so the row that has been
     wrong since January is at the top of the mail. */
  function split_(cmp) {
    var H = cmp.headers.map(norm_);
    var iMarket = H.indexOf('Market');
    var iSAP = H.indexOf('SAP Transfer Price');
    var iASP = iYearCol_(H, 'ASP ex-Works');
    var i;
    cmp.markets = {}; cmp.exceptions = {}; cmp.days = [];
    for (i = 0; i < cmp.rows.length; i++) cmp.days.push(daysOutstanding_(cmp, i));

    if (iMarket < 0) {
      /* NOT SILENT. The page returned early here and simply rendered nothing,
         which looks identical to "no rows". */
      APP_log('warn', 'TPE.split', 'the comparison has no Market column, so it cannot be split ' +
              'by market and nothing can be mailed', { headers: cmp.headers.join(' | ') });
      return;
    }

    function cents(n) { return Math.round(Number(n) * 100); }
    for (i = 0; i < cmp.rows.length; i++) {
      var row = cmp.rows[i];
      var market = String(row[iMarket] == null ? '' : row[iMarket]).trim() || 'Unknown';
      (cmp.markets[market] || (cmp.markets[market] = [])).push(i);

      var sap = row[iSAP], asp = iASP >= 0 ? row[iASP] : '';
      var isMatched = sap !== '' && sap !== null && !isNaN(Number(sap));
      if (isMatched && iASP >= 0 && asp !== '' && !isNaN(Number(asp)) &&
          (cents(sap) - cents(asp)) < -1) {
        (cmp.exceptions[market] || (cmp.exceptions[market] = [])).push(i);
      }
    }
    Object.keys(cmp.exceptions).forEach(function (m) {
      cmp.exceptions[m].sort(function (a, b) { return byAge_(cmp, a, b); });
    });
  }

  function byAge_(cmp, a, b) {
    var da = cmp.days[a], db = cmp.days[b];
    return (db == null ? -1 : db) - (da == null ? -1 : da);
  }

  /* ======================================================================
   * THE EMAIL BODY
   * ==================================================================== */

  /* One market's block: the summary chips, then the first twenty rows. Moved
     from the page unchanged except that Sold To and Material are ESCAPED now -
     see esc_ - and that the row list arrives as indexes into cmp.rows rather
     than as a second copy of the rows. */
  function emailBody(kind, market, list, cmp) {
    var isExc = kind === 'exc';
    var H = cmp.headers.map(norm_);
    var iASP = iYearCol_(H, 'ASP ex-Works'), iVol = iYearCol_(H, 'Volume');
    var iSAP = H.indexOf('SAP Transfer Price');
    var iAdd = H.indexOf('Additional Revenue to Post');
    var iSold = H.indexOf('Sold To'), iMat = H.indexOf('Material');

    var totalAdd = 0, totalVol = 0, oldest = null, i, r;
    for (i = 0; i < list.length; i++) {
      r = cmp.rows[list[i]];
      if (!isNaN(Number(r[iAdd]))) totalAdd += Number(r[iAdd]);
      if (!isNaN(Number(r[iVol]))) totalVol += Number(r[iVol]);
      if (isExc) {
        var d0 = cmp.days[list[i]];
        if (d0 !== null && (oldest === null || d0 > oldest)) oldest = d0;
      }
    }

    var DASH = '&mdash;';
    function fmt(n) {
      return isNaN(Number(n)) ? DASH : '$' + Number(n).toLocaleString('en-CA',
             { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function fmtVol(n) { return isNaN(Number(n)) ? DASH : Math.round(Number(n)).toLocaleString(); }
    function ageColor(d) { return d >= 60 ? '#B23A48' : d >= 30 ? '#B45309' : '#666'; }
    function fmtDays(d) { return d === null ? DASH : d + ' day' + (d !== 1 ? 's' : ''); }

    var PREVIEW_N = 20, body = '', td = 'padding:6px 10px;border-bottom:1px solid #e5e7eb;';
    for (i = 0; i < Math.min(list.length, PREVIEW_N); i++) {
      r = cmp.rows[list[i]];
      var delta = Number(r[iSAP]) - Number(r[iASP]);
      var d = isExc ? cmp.days[list[i]] : null;
      body += '<tr>' +
        '<td style="' + td + '">' + esc_(r[iSold]) + '</td>' +
        '<td style="' + td + '">' + esc_(r[iMat]) + '</td>' +
        '<td style="' + td + 'text-align:right;">' + fmtVol(r[iVol]) + '</td>' +
        '<td style="' + td + 'text-align:right;">' + fmt(r[iASP]) + '</td>' +
        '<td style="' + td + 'text-align:right;">' + fmt(r[iSAP]) + '</td>' +
        (isExc ? '<td style="' + td + 'text-align:right;' +
                 (delta < 0 ? 'color:#B23A48;' : 'color:#1F7A4D;') + '">' + fmt(delta) + '</td>' : '') +
        '<td style="' + td + 'text-align:right;' +
          (Number(r[iAdd]) < 0 ? 'color:#B23A48;' : 'color:#1F7A4D;') + '">' + fmt(r[iAdd]) + '</td>' +
        (isExc ? '<td style="' + td + 'text-align:right;font-weight:700;color:' +
                 (d === null ? '#666' : ageColor(d)) + ';">' + fmtDays(d) + '</td>' : '') +
        '</tr>';
    }
    if (list.length > PREVIEW_N) {
      body += '<tr><td colspan="' + (isExc ? 8 : 6) + '" style="padding:6px 10px;color:#999;' +
              'font-style:italic;">... and ' + (list.length - PREVIEW_N) +
              ' more rows (see attached)</td></tr>';
    }

    var heading = (isExc ? 'Transfer Price Exceptions &mdash; ' : 'Transfer Price Report &mdash; ')
                + esc_(market);
    var oldestChip = !isExc ? '' :
      '<td style="width:12px;"></td>' +
      '<td style="padding:8px 14px;background:' +
        (oldest !== null && oldest >= 60 ? '#F7E7EA' : '#FFF8E1') +
        ';border-radius:6px;text-align:center;">' +
        '<div style="font-size:20px;font-weight:700;color:' +
          (oldest === null ? '#666' : ageColor(oldest)) + ';">' +
          (oldest === null ? DASH : oldest + ' days') + '</div>' +
        '<div style="font-size:11px;color:#666;">Longest at Incorrect Price</div>' +
      '</td>';

    return '<div style="font-family:Arial,sans-serif;max-width:700px;">' +
      '<div style="background:#011E6A;padding:20px 28px;border-radius:8px 8px 0 0;">' +
        '<h2 style="color:white;margin:0;font-size:18px;">' + heading + '</h2>' +
        '<p style="color:#A9C3E8;margin:4px 0 0;font-size:13px;">Report Date: ' +
          esc_(cmp.reportDate) + ' &middot; ' + list.length + ' record' +
          (list.length !== 1 ? 's' : '') + '</p>' +
      '</div>' +
      '<div style="background:#F4F7FC;padding:16px 28px;border:1px solid #DCE6F2;border-top:none;">' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px;"><tr>' +
          '<td style="padding:8px 14px;background:#EEF7FF;border-radius:6px;text-align:center;">' +
            '<div style="font-size:20px;font-weight:700;color:#011E6A;">' + fmtVol(totalVol) + '</div>' +
            '<div style="font-size:11px;color:#666;">Total Volume</div>' +
          '</td>' +
          '<td style="width:12px;"></td>' +
          '<td style="padding:8px 14px;background:' + (totalAdd >= 0 ? '#E4F3EB' : '#F7E7EA') +
            ';border-radius:6px;text-align:center;">' +
            '<div style="font-size:20px;font-weight:700;color:' +
              (totalAdd >= 0 ? '#1F7A4D' : '#B23A48') + ';">' + fmt(totalAdd) + '</div>' +
            '<div style="font-size:11px;color:#666;">Total Additional Revenue to Post</div>' +
          '</td>' + oldestChip +
        '</tr></table>' +
      '</div>' +
      '<div style="padding:20px 28px;border:1px solid #DCE6F2;border-top:none;' +
           'border-radius:0 0 8px 8px;">' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead>' +
          '<tr style="background:#011E6A;color:white;">' +
            '<th style="padding:8px 10px;text-align:left;">Sold To</th>' +
            '<th style="padding:8px 10px;text-align:left;">Material</th>' +
            '<th style="padding:8px 10px;text-align:right;">Volume</th>' +
            '<th style="padding:8px 10px;text-align:right;">ASP ex-Works</th>' +
            '<th style="padding:8px 10px;text-align:right;">SAP Transfer Price</th>' +
            (isExc ? '<th style="padding:8px 10px;text-align:right;">TP &minus; ASP</th>' : '') +
            '<th style="padding:8px 10px;text-align:right;">Addl. Revenue to Post</th>' +
            (isExc ? '<th style="padding:8px 10px;text-align:right;">Past Due</th>' : '') +
          '</tr>' +
        '</thead><tbody>' + body + '</tbody></table>' +
      '</div>' +
    '</div>';
  }

  /* Every market's block, stacked - the page's "Send As One" body, and the only
     shape the automated mail uses. */
  function stackedBody(kind, cmp) {
    var map = (kind === 'exc') ? cmp.exceptions : cmp.markets;
    var names = Object.keys(map).sort(), out = [];
    for (var i = 0; i < names.length; i++) out.push(emailBody(kind, names[i], map[names[i]], cmp));
    return out.join('<div style="height:26px;"></div>');
  }

  /* ======================================================================
   * THE WORKBOOK GRIDS
   * ==================================================================== */

  /* One market's grid, or - with market null - EVERY market's rows in one grid,
     which is the shape the automated mail attaches. Market is already a column,
     so the combined file needs nothing added to say which rows belong where;
     the two aging columns go on the end, as on the page. */
  function grid(kind, market, cmp) {
    var isExc = (kind === 'exc');
    var map = isExc ? cmp.exceptions : cmp.markets;
    var list = [], i;
    if (market === null || market === undefined) {
      var names = Object.keys(map).sort();
      for (i = 0; i < names.length; i++) list = list.concat(map[names[i]]);
      if (isExc) list.sort(function (a, b) { return byAge_(cmp, a, b); });
    } else {
      list = map[market] || [];
    }

    var headers = isExc ? cmp.headers.concat(['SAP Valid From', 'Days at Incorrect Price'])
                        : cmp.headers.slice();
    var rows = [];
    for (i = 0; i < list.length; i++) {
      var n = list[i];
      rows.push(isExc
        ? cmp.rows[n].concat([cmp.vfrom[n] || '', cmp.days[n] === null ? '' : cmp.days[n]])
        : cmp.rows[n].slice());
    }
    return { headers: headers, rows: rows, count: rows.length };
  }

  /* Which columns get which number format, for whoever is writing the file -
     the same list the page applies. A column that is not there is simply
     absent from the map rather than present as -1. */
  function numberFormats(headers) {
    var H = headers.map(norm_), out = {};
    var vol = iYearCol_(H, 'Volume');
    if (vol >= 0) out[vol] = '0';
    [iYearCol_(H, 'ASP ex-Works'),
     H.indexOf('Total Standard Production Costs'),
     H.indexOf('SAP Transfer Price'),
     H.indexOf('Additional Revenue to Post'),
     H.indexOf('Total Corrected Revenue ex-Works')].forEach(function (i) {
      if (i >= 0) out[i] = '"$"#,##0.00';
    });
    return out;
  }

  /* The consolidated SAP rows as a grid, which is the ONLY thing the page's
     "SAP Consolidated" button ever wanted out of readSap. It comes back with
     the comparison rather than being rebuilt in the browser, because the merge
     of the two tabs and the Concat Key on them are exactly the arithmetic that
     stopped living there. */
  function sapGrid(sap) {
    var rows = [];
    for (var i = 0; i < sap.rows.length; i++) {
      var r = sap.rows[i], out = [];
      for (var c = 0; c < SAP_COLS.length; c++) out.push(r[SAP_COLS[c]]);
      rows.push(out);
    }
    return { headers: SAP_COLS.slice(), rows: rows, count: rows.length };
  }

  return {
    readSap:       readSap,
    sapGrid:       sapGrid,
    qlikFromSheet: qlikFromSheet,
    compare:       compare,
    emailBody:     emailBody,
    stackedBody:   stackedBody,
    grid:          grid,
    numberFormats: numberFormats,
    /* used by TPXLSX, by the status report and by the harnesses */
    iYearCol:      iYearCol_,
    toDateStr:     toDateStr_,
    buildSapKey:   buildSapKey_,
    buildQlkKey:   buildQlkKey_
  };
})();

/* ---- TP01_Xlsx.gs ------------------------------------------------------------
   An .xlsx, written by hand, because a trigger has no SheetJS.  */

/*****************************************************************************
 * A MINIMAL XLSX WRITER (namespaced TPXLSX)
 * ---------------------------------------------------------------------------
 * The page attaches workbooks SheetJS built in the browser. The trigger has no
 * browser, and Apps Script cannot load SheetJS. There were two ways out and
 * this is the second one:
 *
 *   (a) write a temp Google Sheet, set its number formats, export it as .xlsx
 *       through Drive and trash it. About fifty lines, uses only what is
 *       already scoped - and costs a Drive file created, exported and trashed
 *       on every run, against a six-minute execution ceiling this codebase has
 *       already been killed by once (README.md §5). It also cannot produce the
 *       Excel TABLE the page's files carry.
 *
 *   (b) this. An .xlsx IS a zip of XML and Utilities.zip makes zips. Seven
 *       small parts, no network, no Drive file, milliseconds instead of most of
 *       a minute - and, because it is pure string building, it is the only one
 *       of the two that can be tested off-platform at all.
 *
 * IF THIS EVER FIGHTS EXCEL, (a) IS THE FALLBACK and it is written down here
 * so the next person does not have to rediscover that there was a choice.
 *
 * WHAT IT DOES NOT DO, because nothing here needs it: no shared-string table
 * (every string is inline), no formulas, no merged cells, no more than one
 * sheet, no dates as date-typed cells - this engine hands over YYYY-MM-DD
 * strings and they stay strings, exactly as the page's files do.
 *
 * THE TABLE IS SKIPPED WHEN TWO HEADERS MATCH. An Excel table's column names
 * must be unique and must equal the header cells exactly; Excel repairs - that
 * is, silently rewrites - a file where they do not. A QlikView export with two
 * identically-named columns is not something this can fix without renaming a
 * column the reader is looking for, so it gets a plain sheet with an
 * AutoFilter instead, which loses banding and nothing else.
 *****************************************************************************/
var TPXLSX = (function () {

  var CURRENCY_FMT_ID = 164;             // first id available for a custom format

  function esc_(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      /* Control characters are not legal in XML 1.0 at all, and one arriving in
         a sheet cell is what turns "Excel cannot open this file" into an hour.
         Tab, newline and carriage return are the three that are. */
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  /* A1 for a zero-based column. */
  function colName_(n) {
    var s = '';
    n = n + 1;
    while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - r) / 26); }
    return s;
  }

  var XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  function contentTypes_(withTable) {
    return XML +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      (withTable ? '<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>' : '') +
      '</Types>';
  }

  function rootRels_() {
    return XML +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';
  }

  function workbook_(sheetName) {
    return XML +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + esc_(sheetName) + '" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>';
  }

  function workbookRels_() {
    return XML +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';
  }

  /* FOUR cellXfs, and the order of them is the contract with cellStyle_ below:
       0  general
       1  header - bold, white on the Amrize navy
       2  whole number      (built-in numFmtId 1, "0")
       3  currency          (custom 164, "$"#,##0.00)
     Anything added here goes on the END, or every styled cell in every file
     this writes shifts by one. */
  function styles_() {
    return XML +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="' + CURRENCY_FMT_ID +
        '" formatCode="&quot;$&quot;#,##0.00"/></numFmts>' +
      '<fonts count="2">' +
        '<font><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
      '</fonts>' +
      '<fills count="3">' +
        '<fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FF011E6A"/><bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="4">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
        '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="' + CURRENCY_FMT_ID + '" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
  }

  /* Which of the four cellXfs a body cell wants, from the format map TPE
     hands over. */
  function styleFor_(fmt) {
    if (fmt === '0') return 2;
    if (fmt) return 3;
    return 0;
  }

  function sheet_(headers, rows, fmts, withTable, ref) {
    var out = [], r, c, i;
    out.push(XML);
    /* The relationships namespace is declared on the ROOT rather than on the
       tablePart that uses it. Both are well-formed XML and Excel accepts
       either; on the root is what every other producer does, and a file that
       looks like the ones Excel wrote is a file that never has to be argued
       with. */
    out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
             'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
    out.push('<sheetViews><sheetView workbookViewId="0">' +
             '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
             '</sheetView></sheetViews>');

    out.push('<cols>');
    for (c = 0; c < headers.length; c++) {
      out.push('<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="22" customWidth="1"/>');
    }
    out.push('</cols>');

    out.push('<sheetData>');
    out.push('<row r="1">');
    for (c = 0; c < headers.length; c++) {
      out.push('<c r="' + colName_(c) + '1" s="1" t="inlineStr"><is><t xml:space="preserve">' +
               esc_(headers[c]) + '</t></is></c>');
    }
    out.push('</row>');

    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      out.push('<row r="' + (i + 2) + '">');
      for (c = 0; c < headers.length; c++) {
        var v = r[c], fmt = fmts[c], s = styleFor_(fmt);
        if (v === '' || v === null || v === undefined) {
          /* A styled-but-empty cell, so a blank Additional Revenue to Post
             still sits in a currency column instead of reverting to General
             the moment somebody types in it. */
          if (s) out.push('<c r="' + colName_(c) + (i + 2) + '" s="' + s + '"/>');
          continue;
        }
        if (typeof v === 'number' && isFinite(v)) {
          /* THE VOLUME COLUMN IS ROUNDED, NOT JUST FORMATTED, which is what the
             page does too: a "0" format on 404.21 displays 404 and still sums
             as 404.21, so a column of them does not add up to what it shows. */
          var num = (fmt === '0') ? Math.round(v) : v;
          out.push('<c r="' + colName_(c) + (i + 2) + '"' + (s ? ' s="' + s + '"' : '') + '><v>' +
                   num + '</v></c>');
        } else {
          out.push('<c r="' + colName_(c) + (i + 2) + '"' + (s ? ' s="' + s + '"' : '') +
                   ' t="inlineStr"><is><t xml:space="preserve">' + esc_(v) + '</t></is></c>');
        }
      }
      out.push('</row>');
    }
    out.push('</sheetData>');

    if (withTable) out.push('<tableParts count="1"><tablePart r:id="rId1"/></tableParts>');
    else out.push('<autoFilter ref="' + ref + '"/>');

    out.push('</worksheet>');
    return out.join('');
  }

  function sheetRels_() {
    return XML +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/>' +
      '</Relationships>';
  }

  function table_(name, headers, ref) {
    var cols = [];
    for (var c = 0; c < headers.length; c++) {
      cols.push('<tableColumn id="' + (c + 1) + '" name="' + esc_(headers[c]) + '"/>');
    }
    return XML +
      '<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" ' +
      'name="' + esc_(name) + '" displayName="' + esc_(name) + '" ref="' + ref + '" ' +
      'headerRowCount="1">' +
      '<autoFilter ref="' + ref + '"/>' +
      '<tableColumns count="' + headers.length + '">' + cols.join('') + '</tableColumns>' +
      '<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" ' +
      'showRowStripes="1" showColumnStripes="0"/>' +
      '</table>';
  }

  /* An Excel table's displayName may hold letters, digits, underscores and
     periods, must not start with a digit, and must not be a cell reference.
     Anything else is what "Excel found unreadable content" is made of. */
  function tableName_(s) {
    var n = String(s || 'Data').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!n || /^[0-9]/.test(n)) n = 'T_' + n;
    return n.slice(0, 60);
  }

  function uniqueHeaders_(headers) {
    var seen = {};
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i] == null ? '' : headers[i]).trim().toLowerCase();
      if (!h || seen[h]) return false;
      seen[h] = 1;
    }
    return true;
  }

  /* ONE WORKBOOK, ONE SHEET.
   *   grid      { headers, rows }   - what TPE.grid returns
   *   sheetName the tab name; Excel caps it at 31 characters and forbids  : \ / ? * [ ]
   *   tableName the Excel table's name, or '' for no table
   *   fmts      { columnIndex: numberFormatCode }, from TPE.numberFormats
   * Returns a Blob named <filename>, ready for MailApp.
   */
  function build(grid, opts) {
    opts = opts || {};
    var headers = grid.headers || [], rows = grid.rows || [];
    if (!headers.length) throw new Error('TPXLSX: a workbook needs at least one column.');

    var fmts = opts.formats || {};
    var sheetName = String(opts.sheetName || 'Sheet1').replace(/[:\\\/?*\[\]]/g, ' ').slice(0, 31) || 'Sheet1';
    var ref = 'A1:' + colName_(headers.length - 1) + (rows.length + 1);
    var wantTable = !!opts.tableName;
    var withTable = wantTable && uniqueHeaders_(headers);
    if (wantTable && !withTable) {
      APP_log('warn', 'TPXLSX.build', 'two columns share a name, so the workbook gets a plain ' +
              'AutoFilter instead of an Excel table - Excel rewrites a table whose column names ' +
              'are not unique', { sheet: sheetName });
    }

    var parts = [
      Utilities.newBlob(contentTypes_(withTable), 'application/xml', '[Content_Types].xml'),
      Utilities.newBlob(rootRels_(),              'application/xml', '_rels/.rels'),
      Utilities.newBlob(workbook_(sheetName),     'application/xml', 'xl/workbook.xml'),
      Utilities.newBlob(workbookRels_(),          'application/xml', 'xl/_rels/workbook.xml.rels'),
      Utilities.newBlob(styles_(),                'application/xml', 'xl/styles.xml'),
      Utilities.newBlob(sheet_(headers, rows, fmts, withTable, ref),
                                                  'application/xml', 'xl/worksheets/sheet1.xml')
    ];
    if (withTable) {
      parts.push(Utilities.newBlob(sheetRels_(), 'application/xml', 'xl/worksheets/_rels/sheet1.xml.rels'));
      parts.push(Utilities.newBlob(table_(tableName_(opts.tableName), headers, ref),
                                   'application/xml', 'xl/tables/table1.xml'));
    }

    var name = String(opts.filename || 'workbook.xlsx');
    if (!/\.xlsx$/i.test(name)) name += '.xlsx';
    return Utilities.zip(parts, name)
      .setContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  /* The XML parts as { path: text }, without zipping any of them. Nothing on
     the platform calls this - it is what lets a Node harness read what this
     writer produced without a Blob, and the parts it checks are then literally
     the parts that ship. */
  function parts(grid, opts) {
    opts = opts || {};
    var headers = grid.headers || [], rows = grid.rows || [];
    var fmts = opts.formats || {};
    var sheetName = String(opts.sheetName || 'Sheet1').slice(0, 31) || 'Sheet1';
    var ref = 'A1:' + colName_(headers.length - 1) + (rows.length + 1);
    var withTable = !!opts.tableName && uniqueHeaders_(headers);
    var out = {
      '[Content_Types].xml':          contentTypes_(withTable),
      '_rels/.rels':                  rootRels_(),
      'xl/workbook.xml':              workbook_(sheetName),
      'xl/_rels/workbook.xml.rels':   workbookRels_(),
      'xl/styles.xml':                styles_(),
      'xl/worksheets/sheet1.xml':     sheet_(headers, rows, fmts, withTable, ref)
    };
    if (withTable) {
      out['xl/worksheets/_rels/sheet1.xml.rels'] = sheetRels_();
      out['xl/tables/table1.xml'] = table_(tableName_(opts.tableName), headers, ref);
    }
    return out;
  }

  return { build: build, parts: parts, colName: colName_, tableName: tableName_ };
})();

/* ---- TP01_MailWatch.gs -------------------------------------------------------
   The other half of the automation: the daily mailbox check that runs the
   comparison and sends the exceptions, so nobody has to open the page at all.  */

/*****************************************************************************
 * TP01 - THE AUTOMATED EXCEPTIONS REPORT (namespaced TPAUTO / TPMAIL)
 * ---------------------------------------------------------------------------
 * The weekly job used to be: wait for the SAP mail, save its attachment, export
 * the QlikView transfer-pricing report, open the page, drop both files, type an
 * address, press Send. This does all of it on a trigger, and the QlikView
 * export is not needed at all - TPE.qlikFromSheet builds that side out of the
 * Aggregates workbook the app already reads.
 *
 * WHOSE MAILBOX, AND WHO THE MAIL COMES FROM - because it is not the obvious
 * answer and it is two different accounts if you set it up carelessly.
 * appsscript.json pins executeAs: USER_DEPLOYING, and that governs WEB REQUESTS
 * ONLY. An installable trigger runs as WHOEVER CREATED IT in the Triggers UI.
 * So this reads the trigger creator's mail, converts in the trigger creator's
 * Drive, and SENDS AS THE TRIGGER CREATOR - which is not who the page's own
 * Send button sends as. Add the trigger from the account that deployed the web
 * app and the two are the same one. §4 reports the effective user and a
 * trigger's execution log names who each firing ran as.
 *
 * THAT IS ALSO WHY THE CONFIG IS A SCRIPT PROPERTY. TP_getRecipients uses
 * getUserProperties(), which resolves to the deployer for every web user - and
 * to the TRIGGER CREATOR inside a trigger. If those two accounts ever differ, a
 * recipient typed on the website would be invisible here, silently, and the run
 * would mail nobody while reporting success. TPAUTO below is Script Properties,
 * which is one store for both.
 *
 * DAILY, FOR A WEEKLY MAIL. A day with no new mail costs one Gmail search and
 * NOTHING else: no sheet read, no comparison, no Drive file, no property
 * written. That is six days out of seven, and it buys the seventh - a report
 * re-issued mid-week goes out the next morning instead of waiting for Tuesday.
 *
 * ONLY THE NEWEST UNSEEN MAIL IS PROCESSED, and this is the one place the
 * Inventory Report's watch and this one deliberately differ. IRMAIL publishes
 * every unseen message because each one is a different month's report and they
 * are all wanted. A transfer-price file is a SNAPSHOT: three unseen mails are
 * three versions of the same list, and sending three emails about them would be
 * three chances to act on the stale two. So the older ones are marked done
 * without being sent, and the newest is the one that goes.
 *
 * NOTHING IS MARKED DONE WHEN THE RUN FAILS, so a Drive hiccup, an unshared
 * sheet or an empty recipient list is retried tomorrow rather than swallowed.
 * A mail carrying no spreadsheet IS marked, because it will never grow one.
 *
 * IT NEVER WRITES TO THE MAILBOX. Which messages are done is a Script Property,
 * not a Gmail label, which is what keeps the grant at gmail.readonly (§4).
 *****************************************************************************/

/* ------------------------------------------------------------------------
 * THE CONFIG RECORD - what the page's Automated email panel writes.
 * ---------------------------------------------------------------------- */
var TP_AUTO_KEY = 'TP01_AUTOMAIL';          // JSON: the switches and the addresses
var TP_AUTO_STATE_KEY = 'TP01_AUTOMAIL_STATE';   // JSON: what the last run did

var TPAUTO = (function () {

  function blank_() {
    return { enabled: false, to: [], cc: [], sendWhenEmpty: true, updatedAt: '', updatedBy: '' };
  }

  function emails_(v) {
    var list = (v instanceof Array) ? v : String(v == null ? '' : v).split(/[,;]/);
    var seen = {}, out = [];
    for (var i = 0; i < list.length; i++) {
      var e = String(list[i] || '').trim();
      if (e.indexOf('@') < 0) continue;
      var k = e.toLowerCase();
      if (seen[k]) continue;
      seen[k] = 1; out.push(e);
    }
    return out;
  }

  function get() {
    var raw = PropertiesService.getScriptProperties().getProperty(TP_AUTO_KEY) || '';
    var rec = blank_();
    if (raw) {
      var got = null;
      try { got = JSON.parse(raw); }
      catch (e) {
        /* NOT SILENT (§7). An unreadable record reads as "switched off", and a
           report that quietly stopped arriving is the hardest kind of failure
           to notice - nobody misses an email they were not expecting. */
        APP_log('warn', 'TPAUTO.get', 'the automated-email settings are unreadable, so the ' +
                'report is switched OFF until they are saved again', { error: String(e) });
      }
      if (got) {
        rec.enabled = !!got.enabled;
        rec.to = emails_(got.to);
        rec.cc = emails_(got.cc);
        rec.sendWhenEmpty = (got.sendWhenEmpty !== false);
        rec.updatedAt = String(got.updatedAt || '');
        rec.updatedBy = String(got.updatedBy || '');
      }
    }
    return rec;
  }

  function save(input) {
    input = input || {};
    var rec = {
      enabled: !!input.enabled,
      to: emails_(input.to),
      cc: emails_(input.cc),
      sendWhenEmpty: (input.sendWhenEmpty !== false),
      updatedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d, yyyy HH:mm'),
      updatedBy: ''
    };
    try { rec.updatedBy = Session.getActiveUser().getEmail() || ''; } catch (e) { rec.updatedBy = ''; }
    if (rec.enabled && !rec.to.length) {
      throw new Error('Turn the automated email on and it has to have somewhere to go - ' +
        'add at least one recipient, or leave it switched off.');
    }
    PropertiesService.getScriptProperties().setProperty(TP_AUTO_KEY, JSON.stringify(rec));
    return rec;
  }

  function state() {
    var raw = PropertiesService.getScriptProperties().getProperty(TP_AUTO_STATE_KEY) || '';
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function setState(o) {
    o = o || {};
    o.at = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d, yyyy HH:mm');
    try { PropertiesService.getScriptProperties().setProperty(TP_AUTO_STATE_KEY, JSON.stringify(o)); }
    catch (e) {
      APP_log('warn', 'TPAUTO.setState', 'the run happened but its outcome was not recorded, so ' +
              'the page will keep showing the previous run', { error: String(e) });
    }
    return o;
  }

  return { get: get, save: save, state: state, setState: setState, emails: emails_ };
})();

/* ---- top-level wrappers for google.script.run ---- */
function TP_getAutoConfig()    { return { config: TPAUTO.get(), state: TPAUTO.state() }; }
function TP_saveAutoConfig(o)  { return { config: TPAUTO.save(o), state: TPAUTO.state() }; }

/* The page's Preview button. Runs the same check the trigger would and reports
   what it found, without sending anything or marking anything.

   IT RUNS AS THE DEPLOYER, not as the person pressing it — a web request obeys
   executeAs, and the trigger obeys who created it. Set both up from the same
   account, which §10 says to anyway, and this previews the mailbox the trigger
   will actually read. Set them up from different accounts and this is a preview
   of the wrong inbox, which is exactly the failure worth being able to see. */
function TP_autoStatus() { return TPMAIL.status(); }


/* ------------------------------------------------------------------------
 * THE WATCH ITSELF.
 * ---------------------------------------------------------------------- */
var TPMAIL = (function () {

  var SEEN_KEY = 'TP01_REPORT_MAIL_SEEN';   // JSON: [ gmail message id, ... ]
  var SEEN_CAP = 200;                       // an order of magnitude over a window's worth

  function cfg_() {
    var c = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.TP01_MAIL) || {};
    return {
      subject:    String(c.SUBJECT || ''),
      from:       String(c.FROM || ''),
      windowDays: Number(c.WINDOW_DAYS) > 0 ? Math.round(Number(c.WINDOW_DAYS)) : 21,
      outSubject: String(c.OUT_SUBJECT || 'Transfer Price Exceptions'),
      outFile:    String(c.OUT_FILENAME || 'Transfer_Price_Exceptions_All_Markets')
    };
  }

  /* The Gmail query. Exposed because §4's permission probe runs exactly this -
     a scope check that proves a different query than the trigger uses proves
     the wrong thing. */
  function query() {
    var c = cfg_();
    if (!c.subject) return '';
    return 'subject:"' + c.subject + '" has:attachment newer_than:' + c.windowDays + 'd' +
           (c.from ? ' from:(' + c.from + ')' : '');
  }

  /* "Re:" and "Fwd:" come off the front first, in any combination - the report
     reaches this mailbox forwarded, and a rule that only accepted the original
     delivery would never fire once. */
  function stripMarkers_(subject) {
    var s = String(subject || '').replace(/^\s+/, ''), was;
    do { was = s; s = s.replace(/^(?:re|fw|fwd)\s*:\s*/i, ''); } while (s !== was);
    return s;
  }

  /* CONTAINS, not starts-with, and that is where this differs from IRMAIL.
     Gmail's subject: term matches WORDS in any order, so the search finds far
     more than the report; this is the real filter, and it wants the WHOLE
     configured sentence present. The ticket system that relays the report wraps
     its own furniture round the line, so anchoring at the front would miss it
     while still being no stricter about what else is in there. */
  function subjectMatches_(subject, want) {
    return stripMarkers_(subject).toLowerCase().indexOf(String(want).toLowerCase()) >= 0;
  }

  function readSeen_() {
    var raw = PropertiesService.getScriptProperties().getProperty(SEEN_KEY) || '';
    if (!raw) return [];
    var list = null;
    try { list = JSON.parse(raw); }
    catch (e) {
      /* NOT SILENT (§7). Every message still inside the window looks new, so
         the next run sends the newest one again - which is a duplicate of an
         email that was already correct, not a wrong number. Loud because a
         duplicate nobody can explain is worse than one that is explained. */
      APP_log('warn', 'TPMAIL.seen', 'the reported-message list is unreadable - the newest mail ' +
              'in the window will look new and be reported again', { error: String(e) });
      return [];
    }
    return (list && list.length) ? list : [];
  }

  function writeSeen_(list) {
    if (list.length > SEEN_CAP) list = list.slice(list.length - SEEN_CAP);
    PropertiesService.getScriptProperties().setProperty(SEEN_KEY, JSON.stringify(list));
  }

  function spreadsheetOn_(msg) {
    var atts = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
    for (var i = 0; i < atts.length; i++) {
      var a = atts[i], n = String(a.getName() || '');
      if (/\.xlsx?$/i.test(n)) return a;
      var t = String(a.getContentType() || '').toLowerCase();
      if (t.indexOf('spreadsheetml') >= 0 || t.indexOf('ms-excel') >= 0) return a;
    }
    return null;
  }

  /* ONE .xlsx ATTACHMENT, AS { tabName: grid }.

     Apps Script cannot read an .xlsx - SpreadsheetApp opens a Google Sheet and
     nothing else - so the bytes go to Drive, Drive converts a copy, the copy is
     read and both are trashed. §5 already owns that conversion (private parent,
     every non-owner permission stripped, TEMP_PREFIX on the name) and this
     calls it rather than keeping a second answer to the same problem.

     Both files are trashed in a `finally`, which covers every way the read can
     fail EXCEPT the runtime limit - Apps Script kills the execution and no
     `finally` runs. §5's sweepTemps_ clears a stranded Google Sheet; sweep_
     below clears the stranded upload, which is not a Sheet and so is not its
     business. */
  function gridsFrom_(att) {
    var upId = null, sheetId = null;
    try {
      var name = QLIKSYNC.tempPrefix + ' — ' + (att.getName() || 'sap.xlsx');
      upId = DriveApp.createFile(att.copyBlob().setName(name)).getId();
      sheetId = QLIKSYNC.toSheet(upId, att.getName() || 'sap.xlsx');

      var ss = SpreadsheetApp.openById(sheetId), out = {};
      ss.getSheets().forEach(function (sh) {
        var values = sh.getDataRange().getValues();
        if (values.length) out[String(sh.getName()).trim()] = values;
      });
      return out;
    } finally {
      if (sheetId) {
        /* QLIKSYNC.trash swallows and logs its own failures, so reaching this
           catch means something else did — and a temp Google Sheet left in
           Drive is the leak §5's sweep exists to stop. Not silent. */
        try { QLIKSYNC.trash(sheetId); }
        catch (e) {
          APP_log('warn', 'TPMAIL.grids', 'the converted copy of the SAP attachment was not ' +
                  'trashed — the sync\u2019s sweep will clear it within the hour',
                  { fileId: sheetId, error: String(e && e.message || e) });
        }
      }
      if (upId) {
        try { DriveApp.getFileById(upId).setTrashed(true); }
        catch (e) {
          APP_log('warn', 'TPMAIL.grids', 'the uploaded copy of the SAP attachment would not ' +
                  'trash - it stays in Drive under the temp prefix',
                  { fileId: upId, error: String(e && e.message || e) });
        }
      }
    }
  }

  /* THE STRANDED UPLOADS, and this is a function that trashes files, so it
     carries the same three guards §5's sweep does: the name must actually START
     with the prefix (Drive's `title contains` is looser than it looks), it must
     NOT be a Google Sheet (those are the sync's sweep to clear, and one may be
     being read right now by a sync this knows nothing about), and it must be
     over an hour old. Trashed, never deleted. */
  var STRAY_MIN_AGE_MS = 60 * 60 * 1000;
  var STRAY_CAP = 20;

  function sweep_() {
    var trashed = 0, stuck = [];
    try {
      var prefix = QLIKSYNC.tempPrefix;
      var it = DriveApp.searchFiles('title contains "' + prefix + '" and trashed = false');
      var cutoff = Date.now() - STRAY_MIN_AGE_MS, looked = 0;
      while (it.hasNext() && looked < STRAY_CAP) {
        var f = it.next();
        looked++;
        if (String(f.getName()).indexOf(prefix) !== 0) continue;
        if (f.getMimeType() === MimeType.GOOGLE_SHEETS) continue;
        if (f.getDateCreated().getTime() > cutoff) continue;
        /* Collected, not logged here: a line per file would put APP_log inside
           a loop, which §2 forbids for the reason a per-row log always turns
           out to have. One line after the loop says the same thing. */
        try { f.setTrashed(true); trashed++; } catch (e) { stuck.push(f.getName()); }
      }
    } catch (e) {
      APP_log('warn', 'TPMAIL.sweep', 'could not look for stranded attachment copies',
              { error: String(e) });
    }
    if (trashed) APP_log('info', 'TPMAIL.sweep', 'trashed attachment copies a killed run left ' +
                         'behind', { trashed: trashed });
    if (stuck.length) APP_log('warn', 'TPMAIL.sweep', 'some stranded attachment copies would not ' +
                              'trash — they stay in Drive under the temp prefix',
                              { files: stuck.slice(0, 5).join(', '), count: stuck.length });
    return trashed;
  }

  /* Every message the query finds that actually carries the sentence, newest
     last. Read-only; used by both run() and status(). */
  function candidates_(c) {
    var q = query(), threads = GmailApp.search(q, 0, 50), out = [];
    for (var t = 0; t < threads.length; t++) {
      var msgs = threads[t].getMessages();
      for (var i = 0; i < msgs.length; i++) {
        if (subjectMatches_(msgs[i].getSubject(), c.subject)) out.push(msgs[i]);
      }
    }
    out.sort(function (a, b) { return a.getDate().getTime() - b.getDate().getTime(); });
    return out;
  }

  function stamp_(d) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  }

  /* A one-line provenance strip under the report. It is the only thing in the
     mail the page's own Send does not produce, and it is here because this one
     arrives without anybody having asked for it: the first question about an
     unexpected email is where it came from. */
  function footer_(cmp, c) {
    var m = cmp.meta || {};
    return '<div style="font-family:Arial,sans-serif;max-width:700px;margin-top:18px;' +
           'padding:10px 14px;background:#F4F7FC;border:1px solid #DCE6F2;border-radius:6px;' +
           'color:#666;font-size:11px;line-height:1.5;">' +
           'Sent automatically from the Amrize Commercial Suite. ' +
           'SAP file dated <b>' + cmp.reportDate + '</b> (' + cmp.tp01Count + ' TP01 + ' +
           cmp.ziprCount + ' ZIPR rows). ' +
           'Compared against ' + (cmp.source === 'sheet'
             ? ('the Aggregates workbook &mdash; ' + (m.customerParent || '') + ', ' +
                (m.cyYear || '') + ', ' + (m.rolledRows || 0) + ' rows')
             : 'an uploaded QlikView export') + '. ' +
           cmp.matched + ' of ' + (cmp.matched + cmp.unmatched) + ' rows matched a SAP price.' +
           '</div>';
  }

  function emptyBody_(cmp, c) {
    return '<div style="font-family:Arial,sans-serif;max-width:700px;">' +
      '<div style="background:#011E6A;padding:20px 28px;border-radius:8px 8px 0 0;">' +
        '<h2 style="color:white;margin:0;font-size:18px;">Transfer Price Exceptions &mdash; none</h2>' +
        '<p style="color:#A9C3E8;margin:4px 0 0;font-size:13px;">Report Date: ' +
          cmp.reportDate + '</p>' +
      '</div>' +
      '<div style="padding:20px 28px;border:1px solid #DCE6F2;border-top:none;' +
           'border-radius:0 0 8px 8px;font-size:13px;color:#1F7A4D;font-weight:600;">' +
        'Every matched SAP transfer price is at or above its ASP ex-Works. ' +
        'Nothing needs correcting this week.' +
      '</div></div>';
  }

  /* One message, end to end: read the attachment, build the other side, compare,
     and send. Throws on anything worth retrying tomorrow; the caller decides
     what that means for the seen-list. */
  function report_(msg, c, auto) {
    var grids = gridsFrom_(spreadsheetOn_(msg));
    var sap = TPE.readSap(grids);
    if (!sap.reportDate) {
      /* THE DATE IS THE FILE'S OR IT IS THE MESSAGE'S, and never today's. A
         file re-issued a fortnight late describes the day it was run, and
         stamping it with the day the trigger fired is README.md §7's rule
         broken in the one place nobody would check. The send date is the
         nearest honest thing and it is reported as a guess. */
      sap.reportDate = TPE.toDateStr(msg.getDate());
      sap.dateSource = 'message';
      APP_log('warn', 'TPMAIL.report', 'the SAP file carried no readable date cell - the ' +
              'message send date is being used instead, and it is a guess',
              { subject: String(msg.getSubject() || ''), used: sap.reportDate });
    }

    var qlk = TPE.qlikFromSheet();
    var cmp = TPE.compare(sap, qlk);
    var exc = TPE.grid('exc', null, cmp);

    var out = { subject: String(msg.getSubject() || ''), sent: stamp_(msg.getDate()),
                reportDate: cmp.reportDate, dateSource: cmp.dateSource,
                matched: cmp.matched, unmatched: cmp.unmatched,
                exceptions: exc.count, markets: Object.keys(cmp.exceptions).length,
                mailed: false, to: auto.to.join(', '), cc: auto.cc.join(', ') };

    if (!exc.count && !auto.sendWhenEmpty) {
      APP_log('info', 'TPMAIL.report', 'no exceptions, and the settings say not to send on a ' +
              'clean week', { reportDate: cmp.reportDate });
      return out;
    }

    var subject = c.outSubject + ' — All Markets (' + cmp.reportDate + ')';
    var body = (exc.count ? TPE.stackedBody('exc', cmp) : emptyBody_(cmp, c)) + footer_(cmp, c);

    var mail = { to: auto.to.join(','), subject: subject, htmlBody: body };
    if (auto.cc.length) mail.cc = auto.cc.join(',');
    if (exc.count) {
      /* ONE COMBINED FILE, and this is the one place the automated output is
         deliberately not the shape the page produces. Market is already a
         column, so a single workbook says everything five per-market ones
         would and arrives as one thing to open. */
      mail.attachments = [TPXLSX.build(exc, {
        sheetName: 'Exceptions',
        tableName: 'Exceptions',
        formats: TPE.numberFormats(exc.headers),
        filename: c.outFile + '_' + cmp.reportDate + '.xlsx'
      })];
    }
    MailApp.sendEmail(mail);
    out.mailed = true;
    return out;
  }

  /* THE TRIGGER TARGET'S BODY. */
  function run() {
    var t0 = Date.now(), c = cfg_(), auto = TPAUTO.get();

    if (!c.subject) {
      APP_log('error', 'TPMAIL.run', 'not configured - set APP_CONFIG.TP01_MAIL.SUBJECT',
              { ms: Date.now() - t0 });
      return { ok: false, error: 'APP_CONFIG.TP01_MAIL.SUBJECT is empty.' };
    }
    if (!auto.enabled) {
      /* Off is a setting, not a failure, and it costs nothing to say so once a
         day in the log rather than leaving the trigger looking broken. */
      APP_log('info', 'TPMAIL.run', 'the automated exceptions report is switched off',
              { ms: Date.now() - t0 });
      return { ok: true, skipped: 'disabled' };
    }

    var threads;
    try { threads = candidates_(c); }
    catch (e) {
      APP_log('error', 'TPMAIL.run', 'the mailbox search failed - nothing was sent',
              { ms: Date.now() - t0, query: query(), error: String(e && e.message || e) });
      return { ok: false, error: String(e && e.message || e) };
    }

    var order = readSeen_(), seen = {}, k;
    for (k = 0; k < order.length; k++) seen[order[k]] = true;

    var fresh = [];
    for (k = 0; k < threads.length; k++) if (!seen[threads[k].getId()]) fresh.push(threads[k]);

    /* THE ORDINARY DAY. Nothing new means nothing happens - no sheet read, no
       Drive file, no property written. The Gmail search is the whole cost, and
       that is six days in seven. */
    if (!fresh.length) {
      APP_log('info', 'TPMAIL.run', 'no new mail - nothing to do',
              { ms: Date.now() - t0, matched: threads.length });
      return { ok: true, sent: 0, alreadyDone: threads.length };
    }

    if (!auto.to.length) {
      /* NOT marked done. The mail is here and correct; what is missing is
         somewhere to send it, and that is fixed on the page in ten seconds -
         at which point tomorrow's run picks this same message up. */
      APP_log('error', 'TPMAIL.run', 'a new SAP file is here but the automated email has no ' +
              'recipients - nothing was sent, and it will be retried tomorrow',
              { ms: Date.now() - t0, waiting: fresh.length });
      TPAUTO.setState({ ok: false, error: 'No recipients are configured.', sent: 0 });
      return { ok: false, error: 'No recipients are configured.' };
    }

    sweep_();

    /* ONLY THE NEWEST. The older unseen ones are earlier versions of the same
       list; reporting them too would be three chances to act on the stale two.
       They are marked done without being sent, and the log says how many. */
    var newest = fresh[fresh.length - 1], skipped = fresh.length - 1;
    var att = spreadsheetOn_(newest);
    if (!att) {
      /* Marked done: a mail with no workbook on it will never grow one, and
         retrying it daily forever would log the same warning until somebody
         deleted the message. */
      order.push(newest.getId()); writeSeen_(order);
      APP_log('warn', 'TPMAIL.run', 'a matching mail carried no spreadsheet - ignored from now on',
              { subject: String(newest.getSubject() || '') });
      return { ok: true, sent: 0, ignored: 1 };
    }

    var rec;
    try { rec = report_(newest, c, auto); }
    catch (e) {
      /* NOT marked done, on purpose: a Drive hiccup, a sheet that has lost its
         sharing or a header that moved is fixed by tomorrow's run, and
         forgetting the message would mean it is never retried. */
      APP_log('error', 'TPMAIL.run', 'could not report on the new SAP file - it will be retried ' +
              'tomorrow', { ms: Date.now() - t0, subject: String(newest.getSubject() || ''),
                            error: String(e && e.message || e) });
      TPAUTO.setState({ ok: false, sent: 0, subject: String(newest.getSubject() || ''),
                        error: String(e && e.message || e) });
      return { ok: false, error: String(e && e.message || e) };
    }

    for (k = 0; k < fresh.length; k++) order.push(fresh[k].getId());
    writeSeen_(order);

    rec.ok = true;
    rec.supersededMails = skipped;
    TPAUTO.setState(rec);
    APP_log('info', 'TPMAIL.run', rec.mailed ? 'reported' : 'nothing to report',
            { ms: Date.now() - t0, reportDate: rec.reportDate, exceptions: rec.exceptions,
              matched: rec.matched, unmatched: rec.unmatched, mailed: rec.mailed,
              superseded: skipped });
    return { ok: true, sent: rec.mailed ? 1 : 0, report: rec };
  }

  /* WHAT THE NEXT RUN WOULD DO, WITHOUT DOING ANY OF IT.

     This is the function to run before setting the trigger, and it is the one
     that answers the questions the code cannot answer on its own: whether the
     subject sentence matches the mail that actually arrives, whether the
     Aggregates sheet still spells the customer parent the way the config does,
     which markets the rows land in, and - the only number that really matters -
     what proportion of rows find a SAP price.

     IT SENDS NOTHING, MARKS NOTHING and writes no setting. It does make and
     trash one temporary Drive copy of the attachment, because there is no way
     to read an .xlsx without one; pass false to skip that and get the mail and
     sheet halves only. */
  function status(deep) {
    var c = cfg_(), auto = TPAUTO.get();
    var out = { query: query(), enabled: auto.enabled, to: auto.to, cc: auto.cc,
                sendWhenEmpty: auto.sendWhenEmpty, lastRun: TPAUTO.state(),
                mail: [], sheet: null, join: null, wouldSend: null, notes: [] };
    if (!auto.enabled)    out.notes.push('The automated email is switched OFF, so the trigger does nothing.');
    if (!auto.to.length)  out.notes.push('No recipients are set, so nothing could be sent.');

    /* ---- can it send, and is anything going to fire ----
       EVERYTHING ELSE IN THIS REPORT IS ABOUT THE DATA: what is in the mailbox,
       what is in the sheet, how well the two join. None of it says whether the
       mail could leave, or whether anything will ever run — and those are the
       two ways this feature fails in COMPLETE SILENCE. A day timer nobody added
       writes no log line and raises no error, because nothing runs. A send that
       is refused for want of the grant fails inside a trigger, into a log nobody
       opens, on the one morning a week the report was due.

       BOTH ANSWERS DESCRIBE WHOEVER RUNS THIS CALL. The quota is your quota and
       the triggers are your triggers — an installable trigger runs as the
       account that created it (§11) — so run this from the account that
       deployed the web app and both lines describe the run that will actually
       happen. This is deliberately before the SUBJECT check below: a half-built
       config is exactly when you want to know the rest of the plumbing is
       there. */
    out.sending = { quotaLeft: null, trigger: '' };
    try { out.sending.quotaLeft = MailApp.getRemainingDailyQuota(); }
    catch (e) {
      out.sending.quotaLeft = 'UNREADABLE — ' + String(e && e.message || e);
      out.notes.push('The send grant could not be read, so nothing would go out. That is ' +
        'auth/script.send_mail in appsscript.json, and APP_verifyPermissions (§4) is the ' +
        'call that reports on every scope at once.');
    }
    if (out.sending.quotaLeft === 0) out.notes.push('The daily send quota is EXHAUSTED. The next ' +
      'run would do all its work, find its exceptions, and fail on the last line.');

    var armed = APP_permTriggerCount_('tp01ReportMailCheck');
    out.sending.trigger = armed < 0  ? 'could not be read'
                        : armed === 0 ? 'NOT SET — not by this account, anyway'
                        : armed === 1 ? 'set'
                        : armed + ' SET — one too many';
    if (armed === 0) out.notes.push('NOTHING FIRES THIS. No trigger on tp01ReportMailCheck ' +
      'belongs to the account running this call, so the exceptions go out only when somebody ' +
      'presses a button on the page. §11 has the setup: one time-driven day timer, added from ' +
      'the account that deployed the web app. A trigger somebody ELSE added is invisible here ' +
      'and runs as them — their mailbox, their name on the email.');
    if (armed > 1) out.notes.push('More than one trigger fires tp01ReportMailCheck. The second ' +
      'run finds the mail already reported and sends nothing, so this is quiet rather than ' +
      'harmful — but it is not what was set up.');

    if (!out.query) { out.error = 'APP_CONFIG.TP01_MAIL.SUBJECT is empty.'; return out; }

    /* ---- the mailbox half ---- */
    var order = readSeen_(), seen = {}, k;
    for (k = 0; k < order.length; k++) seen[order[k]] = true;
    out.reportedCount = order.length;

    var msgs = [];
    try { msgs = candidates_(c); }
    catch (e) { out.error = 'The mailbox search failed: ' + String(e && e.message || e); return out; }

    var newestUnseen = null;
    for (k = 0; k < msgs.length; k++) {
      var m = msgs[k], att = spreadsheetOn_(m), isNew = !seen[m.getId()];
      if (isNew) newestUnseen = m;
      out.mail.push({
        subject: String(m.getSubject() || ''), from: String(m.getFrom() || ''),
        sent: stamp_(m.getDate()), unreported: isNew,
        attachment: att ? String(att.getName() || '') : 'NONE - this mail would be ignored'
      });
    }
    if (!msgs.length) out.notes.push('Nothing in the mailbox matches. Check the subject sentence ' +
      'and the FROM term in APP_CONFIG.TP01_MAIL - the query above is exactly what was run.');
    if (msgs.length && !newestUnseen) out.notes.push('Every matching mail has already been ' +
      'reported on, so the next run would do nothing.');

    /* ---- the Aggregates half ---- */
    try {
      var qlk = TPE.qlikFromSheet(), meta = qlk.meta;
      var top = Object.keys(meta.parents).sort(function (a, b) { return meta.parents[b] - meta.parents[a]; });
      var markets = {}, samples = [];
      for (k = 0; k < qlk.rows.length; k++) {
        var r = qlk.rows[k];
        markets[r[0]] = (markets[r[0]] || 0) + 1;
        if (samples.length < 10) {
          samples.push({ soldTo: r[2], plant: r[3], material: r[4],
                         key: TPE.buildQlkKey(r[3], r[2], r[4]) });
        }
      }
      out.sheet = {
        year: meta.cyYear, customerParent: meta.customerParent,
        rawRows: meta.rawRows, rowsForThatParent: meta.matchedParentRows,
        rolledRows: meta.rolledRows, markets: markets,
        unmappedPlants: meta.unmappedPlants,
        /* The spellings actually in the column, commonest first. A config that
           has drifted from the sheet shows up here as "0 rows" beside a list
           containing the name it should have been. */
        parentsInTheSheet: top.slice(0, 12).map(function (p) { return p + ' (' + meta.parents[p] + ')'; }),
        sampleKeys: samples
      };
      if (!meta.matchedParentRows) out.notes.push('NO Aggregates rows carry the customer parent ' +
        '"' + meta.customerParent + '". The spellings that ARE in that column are listed under ' +
        'sheet.parentsInTheSheet.');
      if (meta.unmappedPlants.length) out.notes.push(meta.unmappedPlants.length + ' plant(s) have ' +
        'no REGION LOOKUP row, so their rows land under the market "Unknown".');
    } catch (e) {
      out.sheet = { error: String(e && e.message || e) };
    }

    /* ---- the join, which is the number that matters ---- */
    if (deep === false) { out.notes.push('Ran shallow: the attachment was not read.'); return out; }
    var use = newestUnseen || (msgs.length ? msgs[msgs.length - 1] : null);
    if (!use || !out.sheet || out.sheet.error) return out;

    try {
      var sap = TPE.readSap(gridsFrom_(spreadsheetOn_(use)));
      if (!sap.reportDate) { sap.reportDate = TPE.toDateStr(use.getDate()); sap.dateSource = 'message'; }
      var cmp = TPE.compare(sap, TPE.qlikFromSheet());
      var exc = TPE.grid('exc', null, cmp);

      var unmatchedKeys = [], H = cmp.headers.indexOf('Concat Key');
      for (k = 0; k < cmp.rows.length && unmatchedKeys.length < 10; k++) {
        if (cmp.rows[k][cmp.headers.indexOf('SAP Transfer Price')] === '') unmatchedKeys.push(cmp.rows[k][H]);
      }
      var sapKeys = [];
      for (k = 0; k < sap.rows.length && sapKeys.length < 10; k++) sapKeys.push(sap.rows[k]['Concat Key']);

      out.join = {
        usedMail: String(use.getSubject() || ''), alreadyReported: !newestUnseen,
        reportDate: cmp.reportDate, dateSource: cmp.dateSource,
        tp01Rows: cmp.tp01Count, ziprRows: cmp.ziprCount,
        comparedRows: cmp.rows.length, matched: cmp.matched, unmatched: cmp.unmatched,
        matchRate: cmp.rows.length ? Math.round(cmp.matched / cmp.rows.length * 100) + '%' : 'n/a',
        exceptions: exc.count, exceptionMarkets: Object.keys(cmp.exceptions),
        firstSapKeys: sapKeys, firstUnmatchedKeys: unmatchedKeys
      };
      out.wouldSend = {
        to: auto.to.join(', '), cc: auto.cc.join(', '),
        subject: c.outSubject + ' — All Markets (' + cmp.reportDate + ')',
        attachment: exc.count ? (c.outFile + '_' + cmp.reportDate + '.xlsx') : '(none - no exceptions)',
        rows: exc.count
      };
      if (cmp.rows.length && cmp.matched === 0) out.notes.push('NOTHING matched. The two sides ' +
        'build their Concat Key from different things, or this SAP file covers different plants ' +
        '- compare join.firstSapKeys against sheet.sampleKeys.');
    } catch (e) {
      out.join = { error: String(e && e.message || e) };
    }
    return out;
  }

  return { run: run, status: status, query: query };
})();

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


/* ---- IR_MailWatch.gs ---------------------------------------------------------
   The other half of the Inventory Report: the hourly mailbox check that sets
   the source above, so nobody has to open the modal at all.  */

/*****************************************************************************
 * INVENTORY REPORT — the mail watch (namespaced IRMAIL)
 * ---------------------------------------------------------------------------
 * The report used to be published by hand: somebody saved the PDF out of the
 * mail, uploaded it to the Drive folder, copied the link, opened the page's
 * modal and pasted it. This does the same four things on a trigger.
 *
 * WHOSE MAILBOX IT IS, BECAUSE IT IS NOT THE OBVIOUS ANSWER. appsscript.json
 * pins executeAs: USER_DEPLOYING, and that governs WEB REQUESTS ONLY. An
 * installable trigger runs as WHOEVER CREATED IT in the Triggers UI — so this
 * reads the trigger creator's mail, writes to the trigger creator's Drive, and
 * asks the trigger creator for the gmail.readonly grant. Add the trigger from
 * the account that deployed the web app and the two identities are the same
 * one; add it from anywhere else and they are not, silently. §4 reports the
 * effective user, and a trigger's own execution log names who each firing ran
 * as.
 *
 *   1. search the mailbox for the report mail
 *   2. file its PDF into APP_CONFIG.INVENTORY_MAIL.FOLDER_ID
 *   3. name it for the period the SUBJECT names — "Jul, 2026"
 *   4. write it into the same Script Property the modal writes — IR.saveSource
 *
 * Step 4 is the whole reason there is no second setting anywhere. The page,
 * the modal and this all read and write one record, so a hand-set source and
 * an auto-set one are indistinguishable and either can override the other.
 *
 * A RUN THAT FINDS NO NEW MAIL DOES NOTHING AT ALL. It opens no folder, writes
 * no file and touches no property — the Gmail search is the entire cost of an
 * hour where nothing arrived, which is most hours. A message is "new" by its
 * Gmail id, so a mail that has already been published is never pulled twice,
 * however many times the trigger fires and whether or not its PDF is still in
 * the folder.
 *
 * THE PERIOD COMES OFF THE SUBJECT, NEVER OFF THE CALENDAR. July's report is
 * mailed at the end of July, early in August, or weeks later still when it is
 * re-issued — so a watch that stamped today's date onto the file would label a
 * late report with the wrong month every time, which is §7's rule about naming
 * a period wearing different clothes. "Monthly Central Region Qlik Sense
 * Report - Jul, 2026" gives Jul and 2026, and the heading and the filename both
 * read "Jul, 2026".
 *
 * WHEN THE SUBJECT SAYS NOTHING, THE FALLBACK IS THE MONTH BEFORE THIS ONE —
 * not this one. A report is published after the period it covers, so a mail
 * with no month in it that lands in August is August's mail about July. It is
 * still a guess and it warns; the point is that it is the guess that is right
 * most of the time rather than the one that is never right.
 *
 * ONE FILE PER MONTH IN THE FOLDER. More than one mail a month is normal, not
 * an error — the data gets corrected and the report re-sent — so each new copy
 * for a period REPLACES the one before it: the newest is filed, the page is
 * pointed at it, and only then is the previous copy trashed. Trashed, never
 * deleted: it sits in Drive's bin, recoverable, and nothing in this codebase
 * deletes permanently. Matched on that period's own name, so the other months
 * in the folder are never touched.
 *
 * WHAT IT DOES NOT DO, DELIBERATELY:
 *   · it does not label, archive, read receipts on or otherwise touch the
 *     mailbox — the grant is auth/gmail.readonly (§4). Which messages are
 *     already published is remembered in a Script Property instead.
 *   · it does not share the file it creates. A new file inherits the folder's
 *     sharing, and nothing in this codebase creates a Drive permission,
 *     because that is the one call that emails people.
 *****************************************************************************/
var IRMAIL = (function () {

  var SEEN_KEY = 'INVENTORY_REPORT_MAIL_SEEN';   // JSON: [ gmail message id, … ]

  /* How many message ids are remembered. Anything older falls off the end and
     would be published again if it were still inside WINDOW_DAYS — which is
     why this is an order of magnitude more than a window's worth of mail. */
  var SEEN_CAP = 300;

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
  var ABBR   = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* A four-digit number in a subject line is only a year if it is inside this
     range. Without a floor, "Report - Jul, 1200 tonnes" would publish as
     "Jul, 1200" — a heading that is wrong in a way nobody would think to check
     for, sitting under a report that is otherwise perfectly correct. */
  var YEAR_FLOOR = 2005;
  var YEAR_CEIL  = 2100;

  function cfg_() {
    var c = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.INVENTORY_MAIL) || {};
    return {
      folderId:    String(c.FOLDER_ID || ''),
      subject:     String(c.SUBJECT_PREFIX || ''),
      from:        String(c.FROM || ''),
      windowDays:  Number(c.WINDOW_DAYS) > 0 ? Math.round(Number(c.WINDOW_DAYS)) : 45,
      labelPrefix: String(c.LABEL_PREFIX == null ? '' : c.LABEL_PREFIX)
    };
  }

  /* The Gmail query. Exposed because §4's permission probe runs exactly this —
     a scope check that proves a different query than the trigger uses proves
     the wrong thing. */
  function query() {
    var c = cfg_();
    if (!c.subject) return '';
    return 'subject:"' + c.subject + '" has:attachment newer_than:' + c.windowDays + 'd'
         + (c.from ? ' from:(' + c.from + ')' : '');
  }

  /* "Re:" and "Fwd:" come off the front first, in any combination. A report
     that reaches the mailbox by being forwarded is still the report and still
     carries the PDF; a rule that only accepted the original delivery would
     fail the first time somebody passed one on. */
  function stripMarkers_(subject) {
    var s = String(subject || '').replace(/^\s+/, ''), was;
    do { was = s; s = s.replace(/^(?:re|fw|fwd)\s*:\s*/i, ''); } while (s !== was);
    return s;
  }

  /* Gmail's subject: term matches WORDS, anywhere in the subject and in any
     order — "Monthly Qlik Report Central Region Sense" matches the query
     above just as well, and so does a reply in the same thread. So the search
     is the cheap filter and this is the real one: what is left after the
     markers has to actually START with the configured prefix. */
  function subjectMatches_(subject, prefix) {
    return stripMarkers_(subject).toLowerCase().indexOf(prefix.toLowerCase()) === 0;
  }

  /* The fallback period: THE MONTH BEFORE the one the mail arrived in, because
     a report is published after the period it covers. Rolls the year back with
     it, which is the whole reason this is a function and not an arithmetic
     expression at the call site — a January mail falls back to December of the
     PREVIOUS year, and getting that wrong produces a heading that is off by
     twelve months exactly once a year. */
  function previousMonth_(when) {
    var m = when.getMonth() - 1, y = when.getFullYear();
    if (m < 0) { m = 11; y -= 1; }
    return { month: m, year: y };
  }

  /* The period the report is FOR, read out of whatever follows the prefix.
     Returns { month: 0-11, year: 2026, guessed: 'no' | 'year' | 'all' } —
     the caller warns on anything it had to guess.

     "- Jul, 2026", "- July 2026", "– JUL-2026" and "- Jul" all read as July.
     Three letters is the shortest abbreviation accepted, because two is
     ambiguous: "Ma" is March or May and "Ju" is June or July. */
  function periodFromSubject_(subject, prefix, received) {
    var rest = stripMarkers_(subject);
    if (rest.toLowerCase().indexOf(prefix.toLowerCase()) === 0) rest = rest.slice(prefix.length);

    var month = -1;
    var words = rest.replace(/[^A-Za-z]+/g, ' ').trim().split(' ');
    for (var i = 0; i < words.length && month < 0; i++) {
      var w = words[i].toLowerCase();
      if (w.length < 3) continue;
      for (var m = 0; m < MONTHS.length; m++) {
        if (MONTHS[m].toLowerCase().indexOf(w) === 0) { month = m; break; }
      }
    }
    if (month < 0) {
      var p = previousMonth_(received);
      return { month: p.month, year: p.year, guessed: 'all' };
    }

    var digits = rest.match(/\d{4}/g) || [];
    for (var d = 0; d < digits.length; d++) {
      var y = Number(digits[d]);
      if (y >= YEAR_FLOOR && y <= YEAR_CEIL) return { month: month, year: y, guessed: 'no' };
    }

    /* A month with no year beside it. It is the year the mail arrived in,
       unless that would put the report in the FUTURE — "Dec" arriving in
       January is last December, not the one eleven months away. */
    var year = received.getFullYear();
    if (month > received.getMonth()) year -= 1;
    return { month: month, year: year, guessed: 'year' };
  }

  /* The period as the heading and the filename both spell it: "Jul, 2026". */
  function code_(p) { return ABBR[p.month] + ', ' + p.year; }

  function stamp_(d, fmt) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), fmt);
  }

  function readSeen_() {
    var raw = PropertiesService.getScriptProperties().getProperty(SEEN_KEY) || '';
    if (!raw) return [];
    var list = null;
    try { list = JSON.parse(raw); }
    catch (e) {
      /* NOT SILENT (§7). An unreadable list means every message still inside
         the search window looks new, so the next block republishes all of
         them: the page lands back on the newest one, which is where it
         already was, and each month's folder copy is replaced by an identical
         one. It is recoverable and it is loud, because a run that suddenly
         does an hour's worth of work is not something anybody would trace
         back to here. */
      APP_log('warn', 'IRMAIL.seen', 'the published-message list is unreadable — every ' +
              'message in the window will look new and be published again', { error: String(e) });
      return [];
    }
    return (list && list.length) ? list : [];
  }

  function writeSeen_(list) {
    if (list.length > SEEN_CAP) list = list.slice(list.length - SEEN_CAP);
    PropertiesService.getScriptProperties().setProperty(SEEN_KEY, JSON.stringify(list));
  }

  /* ONE FILE PER MONTH. Everything already in the folder wearing this period's
     name goes, so the copy that is left is the one the page is showing. Two
     files for July, one of them stale, is a question somebody browsing the
     folder should never have to answer.

     TRASHED, NOT DELETED — it goes to Drive's bin and stays recoverable, which
     is what every other destructive call in this file does too.

     MATCHED ON THIS PERIOD'S NAME, never on "everything in the folder": the
     other months live here as well, and they are the archive. */
  function clearMonth_(folder, label, keepId) {
    var it = folder.getFiles(), doomed = [];
    while (it.hasNext()) {
      var f = it.next();
      if (f.getId() === keepId) continue;
      if (String(f.getName() || '').indexOf(label) !== 0) continue;
      doomed.push(f);
    }
    var gone = 0;
    for (var i = 0; i < doomed.length; i++) {
      try { doomed[i].setTrashed(true); gone++; }
      catch (e) {
        /* NOT SILENT (§7). The new copy is filed and the page is already
           pointing at it, so this is untidy rather than broken — but it is
           also the only way the folder ends up holding two files for one
           month, which is the single thing this function exists to prevent. */
        APP_log('warn', 'IRMAIL.clearMonth', 'could not trash the previous copy for this period',
                { file: doomed[i].getName(), error: String(e && e.message || e) });
      }
    }
    return gone;
  }

  function pdfOf_(msg) {
    var atts = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
    for (var i = 0; i < atts.length; i++) {
      var a = atts[i];
      if (/\.pdf$/i.test(a.getName() || '') ||
          String(a.getContentType() || '').toLowerCase().indexOf('pdf') >= 0) return a;
    }
    return null;
  }

  /* File one message's PDF and point the page at it. Throws on anything that
     is worth retrying in an hour (Drive unreachable, the property unwritable);
     returns null when the message can never work (no PDF on it), which is the
     difference between "come back later" and "stop asking". */
  function publish_(msg, c) {
    var pdf = pdfOf_(msg);
    if (!pdf) return null;

    var period = periodFromSubject_(msg.getSubject(), c.subject, msg.getDate());
    if (period.guessed === 'all') {
      APP_log('warn', 'IRMAIL.publish', 'no month in the subject — falling back to the month ' +
              'before the one the mail arrived in, which is a guess',
              { subject: String(msg.getSubject() || ''), period: code_(period) });
    } else if (period.guessed === 'year') {
      APP_log('warn', 'IRMAIL.publish', 'the subject named a month but no year — taking the year ' +
              'from the send date', { subject: String(msg.getSubject() || ''), period: code_(period) });
    }

    var label = c.labelPrefix + code_(period);
    var name  = label + '.pdf';

    var folder = DriveApp.getFolderById(c.folderId);
    var file   = folder.createFile(pdf.copyBlob().setName(name));

    /* The same call the modal makes. Everything the page needs — the preview
       URL, the heading, the "set on" line — is derived from this one record.

       IT HAPPENS BEFORE THE OLD COPY IS TRASHED, and that order is the safety
       of the whole thing: trash-first would leave the page pointing into the
       bin for as long as it took this line to fail. */
    IR.saveSource(file.getId(), label);
    var replaced = clearMonth_(folder, label, file.getId());

    return { fileId: file.getId(), name: name, label: label, replaced: replaced,
             sent: stamp_(msg.getDate(), 'yyyy-MM-dd HH:mm') };
  }

  /* THE TRIGGER TARGET'S BODY. One pass over everything the query finds that
     has not been published yet, oldest first, so the newest mail is the last
     one written and the page settles on it. */
  function run() {
    var t0 = Date.now();
    APP_log('info', 'IRMAIL.run', 'checking the mailbox');

    var c = cfg_();
    if (!c.subject || !c.folderId) {
      APP_log('error', 'IRMAIL.run', 'not configured — set APP_CONFIG.INVENTORY_MAIL ' +
              'SUBJECT_PREFIX and FOLDER_ID', { ms: Date.now() - t0 });
      return { ok: false, error: 'APP_CONFIG.INVENTORY_MAIL is incomplete.' };
    }

    var q = query(), threads;
    try { threads = GmailApp.search(q, 0, 50); }
    catch (e) {
      APP_log('error', 'IRMAIL.run', 'the mailbox search failed — nothing was published',
              { ms: Date.now() - t0, query: q, error: String(e && e.message || e) });
      return { ok: false, error: String(e && e.message || e) };
    }

    var order = readSeen_(), seen = {};
    for (var k = 0; k < order.length; k++) seen[order[k]] = true;

    var fresh = [], matched = 0;
    for (var t = 0; t < threads.length; t++) {
      var inThread = threads[t].getMessages();
      for (var i = 0; i < inThread.length; i++) {
        var m = inThread[i];
        if (!subjectMatches_(m.getSubject(), c.subject)) continue;
        matched++;
        if (!seen[m.getId()]) fresh.push(m);
      }
    }

    /* THE ORDINARY HOUR, AND THE POINT OF THE ID LIST. Nothing new means
       nothing happens: no folder opened, no file written, no property
       touched. A mail that has already been published is never pulled again,
       however many times this fires. */
    if (!fresh.length) {
      APP_log('info', 'IRMAIL.run', 'no new mail — nothing to do',
              { ms: Date.now() - t0, matched: matched, alreadyDone: matched });
      return { ok: true, published: [], alreadyDone: matched, ignored: [], failed: [] };
    }

    fresh.sort(function (a, b) { return a.getDate().getTime() - b.getDate().getTime(); });

    var out = { ok: true, published: [], alreadyDone: matched - fresh.length,
                ignored: [], failed: [] };
    var changed = false;

    for (var n = 0; n < fresh.length; n++) {
      var msg = fresh[n], id = msg.getId(), rec = null;

      try { rec = publish_(msg, c); }
      catch (e) {
        /* NOT marked as done, on purpose: a Drive hiccup or a folder that has
           lost its sharing is fixed by the next firing, and forgetting the
           message would mean it is never retried. */
        out.failed.push(String(msg.getSubject() || '(no subject)') + ': ' + (e && e.message || e));
        out.ok = false;
        APP_log('error', 'IRMAIL.run', 'could not publish a message — it will be retried on ' +
                'the next check', { subject: String(msg.getSubject() || ''),
                                    error: String(e && e.message || e) });
        continue;
      }

      /* Marked done either way from here. A mail with no PDF on it will never
         grow one, so retrying it hourly forever would log the same warning
         until somebody deleted the message. */
      order.push(id); changed = true;

      if (!rec) {
        out.ignored.push(String(msg.getSubject() || '(no subject)'));
        APP_log('warn', 'IRMAIL.run', 'a matching mail carried no PDF — ignored from now on',
                { subject: String(msg.getSubject() || '') });
        continue;
      }

      out.published.push(rec);
      APP_log('info', 'IRMAIL.run', 'published', { file: rec.name, label: rec.label,
              fileId: rec.fileId, replaced: rec.replaced, sent: rec.sent });
    }

    if (changed) writeSeen_(order);

    APP_log(out.failed.length ? 'error' : 'info', 'IRMAIL.run', 'done',
            { ms: Date.now() - t0, matched: matched, published: out.published.length,
              alreadyDone: out.alreadyDone, ignored: out.ignored.length,
              failed: out.failed.length,
              detail: out.failed.length ? out.failed.join(' | ') : '' });
    return out;
  }

  /* What the next check would see, for a look from the editor. Reads only:
     it publishes nothing, files nothing, trashes nothing and marks nothing. */
  function status() {
    var c = cfg_(), q = query();
    var out = { query: q, folder: '', showing: IR.getSettings(), published: 0, pending: [] };
    if (!q) { out.error = 'APP_CONFIG.INVENTORY_MAIL.SUBJECT_PREFIX is empty.'; return out; }

    try { out.folder = DriveApp.getFolderById(c.folderId).getName(); }
    catch (e) { out.folder = 'UNREADABLE — ' + String(e && e.message || e); }

    var order = readSeen_(), seen = {};
    for (var k = 0; k < order.length; k++) seen[order[k]] = true;
    out.published = order.length;

    var threads = GmailApp.search(q, 0, 50);
    for (var t = 0; t < threads.length; t++) {
      var inThread = threads[t].getMessages();
      for (var i = 0; i < inThread.length; i++) {
        var m = inThread[i];
        if (!subjectMatches_(m.getSubject(), c.subject)) continue;
        if (seen[m.getId()]) continue;
        var p = periodFromSubject_(m.getSubject(), c.subject, m.getDate());
        out.pending.push({
          subject: String(m.getSubject() || ''),
          sent:    stamp_(m.getDate(), 'yyyy-MM-dd HH:mm'),
          from:    String(m.getFrom() || ''),
          wouldBe: c.labelPrefix + code_(p) +
                   (p.guessed === 'all'  ? '  (month GUESSED — the one before the send date)' :
                    p.guessed === 'year' ? '  (year guessed from the send date)' : ''),
          hasPdf:  !!pdfOf_(m)
        });
      }
    }
    return out;
  }

  return { run: run, status: status, query: query };
})();



/* ============================================================================
 * §11  TRIGGERS + EDITOR ENTRY POINTS
 * ----------------------------------------------------------------------------
 * Everything in this file that is reached from OUTSIDE the repo. Nothing here has
 * a caller a grep can find, and every one of them is load-bearing anyway:
 *
 *   qlikSyncAggregates
 *   qlikSyncReadyMix
 *   qlikSyncSegment  THE DATA PIPELINE: ONE TIME-DRIVEN TRIGGER ON EACH, a few
 *                    minutes apart. One export per target and one export per
 *                    execution — the three together are about seven minutes of
 *                    work and an execution is six, which is what the timeouts
 *                    were. Deleting one because grep found no caller would
 *                    silently stop that page's data from ever updating again,
 *                    and nothing would error.
 *   qlikMarkCurrent  run once from the editor after the timers are set up, so
 *                    the first firing of each has a stamp to compare. Needed
 *                    again whenever they are rebuilt.
 *   qlikStamps       what the next firing of each will compare, and what it
 *                    will do.
 *   qlikAggNow
 *   qlikRmxNow
 *   qlikSegmentNow   THE MANUAL RECOVERY PATH when a timer misfires: one export
 *                    each, no argument to pass, and NO WAY TO ASK FOR MORE THAN
 *                    ONE. qlikSyncNow — which took 'all', and was handed 'all'
 *                    by a Run menu that passes no arguments — and qlikSyncCheck,
 *                    which ran all three exports in one execution, were both
 *                    removed on 2026-08-25: three exports is about seven minutes
 *                    of work and an execution is six, so every way of asking for
 *                    all of them at once was a way of asking for a timeout. NOT
 *                    trigger targets: they skip nothing, so a timer on one would
 *                    re-sync forever.
 *
 *                    IF A TRIGGER IS STILL SET ON qlikSyncCheck IT WILL NOW
 *                    FAIL, and a timer nobody watches fails quietly. Delete it
 *                    and set one on each of the three targets above —
 *                    APP_verifyPermissions (§4) is what shows you which are
 *                    armed.
 *   qlikSyncRetry    THE ONE TARGET NOBODY SETS UP. A run whose export failed
 *                    its checks — or ran out of execution time — arms a one-shot
 *                    trigger on this, five minutes out, and this deletes it when
 *                    it fires. Do NOT add a timer for it by hand — a repeating
 *                    one would re-sync forever.
 *   qlikRetryStatus  whether a retry is waiting, and why. Reads only.
 *
 *   inventoryReportMailCheck
 *                    THE FOURTH TRIGGER TARGET. Set ONE hourly trigger on it.
 *                    It publishes the Inventory Report out of the mailbox
 *                    (§10's IRMAIL). Nothing points at it either, and the page
 *                    it feeds has a modal that still works by hand — so with no
 *                    trigger set the page does not break, it just quietly stops
 *                    updating itself and waits for somebody who no longer knows
 *                    they are meant to do it.
 *   inventoryReportMailStatus
 *                    what that check would do right now — the query, the folder,
 *                    what the page is showing, and every mail it has not
 *                    published yet. Reads only; run it from the editor.
 *
 *   tp01ReportMailCheck
 *                    THE FIFTH TRIGGER TARGET, and the only DAILY one. Set ONE
 *                    time-driven day timer on it. It finds the weekly SAP
 *                    transfer-price mail, runs the comparison against the
 *                    Aggregates sheet and emails the exceptions (§10's TPMAIL).
 *                    Nothing points at it either. With no trigger set nothing
 *                    breaks — the page still does the whole job by hand — the
 *                    report simply never arrives, which is the failure nobody
 *                    notices, because nobody misses an email they were not
 *                    expecting.
 *   tp01ReportMailStatus
 *                    what THAT check would do right now, and the one to run
 *                    first: the query and every mail it matches, the Aggregates
 *                    rows behind the comparison with the customer-parent
 *                    spellings actually in the sheet, and the match rate between
 *                    the two sides. Sends nothing and marks nothing.
 *   qlikAlertsOn / qlikAlertsOff
 *                    whether a failed sync MAILS anybody. Off is the default and
 *                    off is not silent — the whole report goes to the execution
 *                    log at `error` either way, and qlikRetryStatus() names the
 *                    mute. §5c is the argument for the switch.
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
 * AND WHOEVER ADDS A TRIGGER IS WHO IT RUNS AS. Not the script owner and not
 * the deployer: executeAs: USER_DEPLOYING covers web requests, and an
 * installable trigger runs under the account that created it. Every trigger
 * here reads another account's Drive or mail to do its job — and the TP01 one
 * SENDS as its creator too — so adding one from the wrong account gives you a
 * run that authorises cleanly and then looks at the wrong data, or at nothing,
 * or mails from the wrong name. Add all five from the account that deployed the
 * web app.
 *
 * THIS IS WHY THE SECTION EXISTS. ALL FIVE of the timers above are configured
 * by hand in the Apps Script UI, so nothing in the repo points at any of them.
 * (There is exactly one ScriptApp.newTrigger in the codebase and it is not one
 * of these: §5 arms a ONE-SHOT retry five minutes out when an export fails its
 * checks, pointed at qlikSyncRetry below, which deletes it when it fires. Do
 * not add a trigger for that one by hand.) Ctrl+F "§11" is the substitute for
 * that missing reference, and APP_verifyPermissions (§4) is the substitute for
 * looking: its ScriptApp row names all five and says which of them the account
 * running it has actually armed.
 * ============================================================================ */

/* ---- QlikSync.gs -------------------------------------------------------------
   The entry points. The QLIKSYNC engine they drive is in §5.  */

/* ==========================================================================
 * WHAT STARTS A SYNC: THREE TIMERS, ONE PER EXPORT.
 * --------------------------------------------------------------------------
 * Set ONE time-driven trigger on each of qlikSyncAggregates, qlikSyncReadyMix
 * and qlikSyncSegment. Fifteen minutes suits all three, and SET THEM A FEW
 * MINUTES APART — see the note on the lock below.
 *
 * IT USED TO BE ONE TIMER ON ONE TARGET, AND THAT IS WHAT THE TIMEOUTS WERE.
 * The three exports together are about seven minutes of work — Aggregates 52,538
 * rows, Ready-Mix 82,200, Product Segment small, plus three conversions and
 * three reads — and an Apps Script execution is six. One firing could not hold
 * the job however it was arranged, so it did as much as fitted and armed a
 * one-shot for the rest, which meant the tail of the work went round a retry
 * chain and the sheets were half a pipeline behind for as long as it took.
 *
 * Each export in its own execution is two to three minutes against six. The
 * settle, the read and the write all fit inside one page's own limit, there is
 * nothing to defer, and a firing whose export has not moved costs ONE Drive
 * lookup and stops.
 *
 * Each of the three does the same thing for its own export: compare the file's
 * modified time against the one it last synced, and do nothing at all if it has
 * not moved. So an ordinary firing is one Drive lookup — nothing opened,
 * nothing written, every page still serving from cache.
 *
 * THE LOCK IS SCRIPT-WIDE AND THAT IS WHY THEY ARE STAGGERED. LockService has
 * no named locks, so two of these firing across each other means the second one
 * waits five seconds, gives up, and returns without writing or stamping
 * anything; its next firing picks the export up. Nothing is damaged and nothing
 * is half-written — it costs that export one interval. All three exports rarely
 * move at once, and a few minutes between the timers makes it rarer still.
 *
 * Run qlikMarkCurrent() ONCE after setting the timers up. Without it the first
 * firing of each has nothing to compare, treats its export as new, and syncs it.
 *
 * qlikStamps() shows what the next firing of each will compare, and what it
 * will do.
 *
 * Writing to a workbook moves its modified time, and that IS the data version
 * every open page is watching — so the prompt appears on its own, with nothing
 * here having to tell anybody. See AmrFresh in Shell.html.
 * ======================================================================== */
var QLIK_STAMP_KEY = 'QLIK_FILE_STAMPS';

/* The stamps, as { source key → the export's modified time when that source was
   last synced }. Read in four places and written in three, which is why the read
   and its warning live here once rather than four times, slightly differently. */
function qlikStampsRead_(where) {
  try { return JSON.parse(PropertiesService.getScriptProperties()
                            .getProperty(QLIK_STAMP_KEY) || '{}'); }
  catch (e) {
    /* NOT SILENT (§7). A corrupt stamp property means every source looks
       changed, so the next firing of each of the three re-syncs — minutes of
       Drive work that reads as a normal busy run. */
    APP_log('warn', where, 'stamps unreadable — every source will look changed',
            { error: String(e) });
    return {};
  }
}

function qlikStampsWrite_(seen, where) {
  try { PropertiesService.getScriptProperties()
          .setProperty(QLIK_STAMP_KEY, JSON.stringify(seen)); }
  catch (e) {
    /* NOT SILENT (§7). Nothing recorded means the source looks changed on the
       next firing and is synced again, which is slow rather than wrong — and
       invisible without this line. */
    APP_log('warn', where, 'could not record which export was synced — it will be synced again ' +
            'on the next check', { error: String(e) });
  }
}

/* RECORD THE EXPORT AS READ — OR DELIBERATELY DO NOT.
   `stamp` is the modified time as it was BEFORE the run, because that is the
   file this run actually read: QlikView dropping a new export while the sync is
   working is exactly the case where stamping what is in Drive NOW would mark a
   file as read that nothing has looked at.

   A TAB THAT FAILED ITS CHECKS WROTE NOTHING AT ALL, and the usual reason is a
   file that was still being written when the run opened it. Keeping the stamp
   there would mark the export as done having never read it, so the stamp is
   withheld and §5's own one-shot retry is what tries again. A run that FINISHED
   with a broken tab is a different thing and keeps its stamp: that tab will be
   just as broken in fifteen minutes, and re-syncing forever neither fixes it
   nor tells anybody. It is mailed and logged.

   THE STAMPS ARE RE-READ HERE RATHER THAN HELD ACROSS THE RUN. A sync is
   minutes long and the three timers are independent of each other, so a copy
   taken before the run and written back after would wipe whatever the other two
   recorded while this one was working. */
function qlikStampSource_(src, stamp, res, where) {
  if (res.error) return false;
  var gated = (res.failed || []).filter(function (f) { return f.check; });
  if (gated.length) return false;
  var seen = qlikStampsRead_(where);
  seen[src.key] = stamp;
  qlikStampsWrite_(seen, where);
  return true;
}

/* WHAT EACH OF THE THREE TIMERS RUNS. One export, one page, one execution.

   Nothing in the repo points at the three wrappers below (there is not one
   ScriptApp.newTrigger arming any of them — see §11's banner), they run with
   nobody watching, and every page's data depends on them. The log line is the
   only account of a run that will ever exist, which is why the entry is logged
   before anything can throw. */
function qlikSyncOne_(key) {
  var t0 = Date.now();
  APP_log('info', 'QLIKSYNC.check', 'trigger fired', { source: key });

  var src = null;
  try {
    QLIKSYNC.sources().forEach(function (s) { if (s.key === key) src = s; });
    if (!src) throw new Error('No QlikView export is configured for "' + key + '".');
  } catch (e) {
    APP_log('error', 'QLIKSYNC.check', 'could not read the source — the pipeline did not run',
            { source: key, ms: Date.now() - t0, error: String(e && e.message || e) });
    return { ok: false, source: key, error: String(e && e.message || e) };
  }

  var stamp;
  try { stamp = String(DriveApp.getFileById(src.id).getLastUpdated().getTime()); }
  catch (e) {
    APP_log('error', 'QLIKSYNC.check', 'cannot read the export file — the pipeline did not run',
            { source: src.label, ms: Date.now() - t0, error: String(e && e.message || e) });
    return { ok: false, source: src.label, error: String(e && e.message || e) };
  }

  var seen = qlikStampsRead_('QLIKSYNC.check');
  if (stamp === seen[src.key]) {
    APP_log('info', 'QLIKSYNC.check', 'unchanged since the last sync — nothing opened',
            { source: src.label, ms: Date.now() - t0 });
    return { ok: true, source: src.label, changed: false };
  }

  var res   = QLIKSYNC.run(src.scope);
  var gated = (res.failed || []).filter(function (f) { return f.check; });
  var kept  = qlikStampSource_(src, stamp, res, 'QLIKSYNC.check');

  APP_log(res.ok ? 'info' : (gated.length ? 'error' : 'warn'), 'QLIKSYNC.check',
          res.ok    ? 'synced'
        : res.error ? 'the run did not happen'
        : gated.length ? 'the export failed its checks and nothing was written to those tabs'
                       : 'synced, but some tabs did not write',
          { source: src.label, ms: Date.now() - t0, tabs: (res.done || []).length,
            error: res.error || '', failed: res.failed, stampKept: kept });

  return { ok: !!res.ok, source: src.label, changed: true, result: res };
}

/* THE THREE TRIGGER TARGETS. Set one time-driven trigger on each, a few minutes
   apart. Deleting one of these because grep found no caller would silently stop
   that page's data from ever updating again, and nothing would error. */
function qlikSyncAggregates() { return qlikSyncOne_('AGG'); }
function qlikSyncReadyMix()   { return qlikSyncOne_('RMX'); }
function qlikSyncSegment()    { return qlikSyncOne_('SEG'); }

/* Run this once from the editor after setting the timers up, so the FIRST
   firing of each has something to compare against.

   Without it the first firing sees no stamp, treats its export as new and syncs
   it — replacing data the sheet very likely already has. Harmless, just slow
   and pointless. */
function qlikMarkCurrent() {
  var seen = {};
  QLIKSYNC.sources().forEach(function (src) {
    try { seen[src.key] = String(DriveApp.getFileById(src.id).getLastUpdated().getTime()); }
    catch (e) {
      APP_log('warn', 'QLIKSYNC.markCurrent', 'no stamp for this source — it will look changed ' +
              'on the next check and be re-synced', { source: src.key, error: String(e) });
    }
  });
  qlikStampsWrite_(seen, 'QLIKSYNC.markCurrent');
  return 'Marked ' + Object.keys(seen).length + ' export(s) as already synced.';
}

/* What each timer is about to compare, for a look from the editor.

   `lastSynced` is the EXPORT'S modified time as of the last sync — what the
   next firing compares against — and not when that sync ran. `wroteAt` is when
   it ran, off the record §5 keeps for the header's stamp, and the two are
   different questions: a source can have been synced this morning off a file
   QlikView dropped on Monday. */
function qlikStamps() {
  var seen = qlikStampsRead_('QLIKSYNC.stamps');
  return QLIKSYNC.sources().map(function (src) {
    var now = '';
    try { now = String(DriveApp.getFileById(src.id).getLastUpdated().getTime()); } catch (e) { now = 'unreadable'; }
    var wrote = null;
    try { wrote = QLIKSYNC.lastSync(src.scope); } catch (e) { wrote = null; }
    return { source: src.label, feeds: src.scope, trigger: src.trigger,
             lastSynced: seen[src.key] || '(never)',
             fileNow: now, willSync: now !== seen[src.key],
             wroteAt: wrote ? new Date(wrote.at).toISOString() : '(never)',
             wroteTabs: wrote ? wrote.tabs : 0,
             wroteFailed: wrote ? wrote.failed : 0 };
  });
}

/* MANUAL SYNC, ONE EXPORT, from the editor only. Nothing in the UI calls this,
   and the three wrappers below are its only callers.

   IT DOES NOT LOOK AT THE EXPORT'S MODIFIED TIME, and that is the whole point
   of it. The timers skip a source that has not moved since it was last synced,
   which is right for something firing every fifteen minutes and wrong for a
   person who has just gone to run this by hand — they are here BECAUSE the
   sheet is wrong and the file did not move: a bad write, a header renamed in
   the workbook, a cache that got cleared. So this pulls unconditionally.

   ONE IS THE MOST IT WILL DO, AND THAT IS THE REASON IT LOOKS LIKE THIS. The
   public qlikSyncNow(scope) that used to be here took 'all' as well — and 'all'
   was its default for no argument, which is exactly what the Run menu passes.
   Three exports is about seven minutes of work against a six-minute execution,
   so asking for all of them was asking for the third to be refused on the
   budget and pushed round the retry chain. It is gone, and so is qlikSyncCheck,
   which did the same thing on a timer. This takes ONE source and REFUSES
   anything that names more or names nothing, so there is no longer a way — from
   the editor or from code — to start three exports in one execution. Run
   another wrapper afterwards if you want another export.

   `scope` is a page id ('pricevolume' | 'rmx' | 'segment') or a source key
   ('AGG' | 'RMX' | 'SEG'). 'all' is not a scope any more: it matches nothing
   and comes back as the refusal below.

   THE THREE WRAPPERS ARE NOT TRIGGER TARGETS AND MUST NOT BE ADDED TO
   APP_TRIGGER_TARGETS (§4). A timer belongs on qlikSyncAggregates /
   qlikSyncReadyMix / qlikSyncSegment, which skip an export whose file has not
   moved; these deliberately do not skip, so a timer on one would re-sync
   minutes of Drive work every interval, forever, for nothing. */
function qlikSyncNowOne_(scope) {
  var want = (typeof scope === 'string' && scope) ? scope.toLowerCase() : '';

  var srcs;
  try { srcs = QLIKSYNC.sources(); }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }

  var pick = srcs.filter(function (s) {
    return !!want && (s.scope === want || s.key.toLowerCase() === want);
  });

  /* EXACTLY ONE, OR NOTHING RUNS. 'all' arrives here as a name no source
     answers to, so the refusal costs nothing to state and there is no branch
     that could ever walk more than one source. */
  if (pick.length !== 1) {
    return { ok: false, error: 'One export at a time — "' + (want || '(nothing)') + '" names ' +
             (pick.length ? pick.length + ' of them' : 'none of them') + '. Use one of: ' +
             srcs.map(function (s) { return s.scope; }).join(', ') + '.' };
  }

  var src = pick[0];

  /* Read before the run, for the same reason qlikStampSource_ gives. */
  var stamp = null;
  try { stamp = String(DriveApp.getFileById(src.id).getLastUpdated().getTime()); }
  catch (e) {
    APP_log('warn', 'QLIKSYNC.syncNow', 'no stamp for this source — it will be re-synced on ' +
            'the next check', { source: src.key, error: String(e) });
  }

  var res = QLIKSYNC.run(src.scope);
  if (stamp !== null) qlikStampSource_(src, stamp, res, 'QLIKSYNC.syncNow');
  /* One source asked for, one result to look at. */
  return res;
}

/* ONE EXPORT, BY NAME, FOR THE EDITOR'S RUN MENU.

   THE RUN MENU CALLS A FUNCTION WITH NO ARGUMENTS, so a function that needs a
   source key cannot be run from it at all — which is why these three exist and
   why they take nothing. They are the whole of the manual path now, and all of
   each of them is qlikSyncNowOne_'s: the unconditional pull, the stamp read
   before the run, the stamp withheld when the export fails its checks, and one
   result object to look at rather than a wrapper round one. */
function qlikAggNow()     { return qlikSyncNowOne_('AGG'); }
function qlikRmxNow()     { return qlikSyncNowOne_('RMX'); }
function qlikSegmentNow() { return qlikSyncNowOne_('SEG'); }


/* ==========================================================================
 * THE ONE-SHOT RETRY — armed by §5, and the only trigger this project creates.
 * --------------------------------------------------------------------------
 * DO NOT ADD A TRIGGER FOR THIS BY HAND. Unlike the timers above, this one arms
 * itself: a run whose export failed its checks calls scheduleRetry_(), which
 * creates a single time-based trigger five minutes out and points it here. This
 * function deletes every trigger on its own handler — including the one that is
 * firing it — before doing anything else, so they cannot accumulate against the
 * per-script limit. A REPEATING timer on this would re-sync forever.
 *
 * IT RETRIES ONCE PER BROKEN EXPORT, AND ONCE IS NOW THE WHOLE RULE. The usual
 * cause of a check failure is an export Drive was still writing when the sync
 * opened it, and that is gone a few minutes later. A genuinely broken export is
 * not fixed by asking again, so a second failure arms nothing further and the
 * mail §5 already sent says so.
 *
 * RUNNING OUT OF EXECUTION TIME USED TO BE THE EXCEPTION and had a ceiling of
 * its own, because a run of 'all' retried only the PAGES that had failed and so
 * every attempt was smaller than the one before it. A run is one page now, so
 * there is nothing left to shrink and nothing for a longer chain to converge
 * on — and with one export to an execution it should not be happening at all.
 *
 * AND IT RUNS AS WHOEVER ARMED IT, which is whoever created the timer that
 * armed it — the same rule as every other trigger here (see the banner above).
 * That is the right account by construction: the retry is the same work the
 * timer does.
 * ======================================================================== */
function qlikSyncRetry() {
  var t0 = Date.now();
  APP_log('info', 'QLIKSYNC.retry', 'one-shot retry fired');
  var out;
  try { out = QLIKSYNC.retry(); }
  catch (e) {
    APP_log('error', 'QLIKSYNC.retry', 'the retry itself failed',
            { ms: Date.now() - t0, error: String(e && e.message || e) });
    return { ok: false, error: String(e && e.message || e) };
  }

  /* A RETRY THAT WORKED IS THE SYNC THAT DID NOT, so the export is recorded as
     read HERE. The failure that armed the retry withheld the stamp, on purpose;
     without this line it stays withheld, the next firing of that export's timer
     sees a file it has never synced, and re-does the minutes of work that have
     just been done.

     THE TIME RECORDED IS THE ONE THE RUN ITSELF READ, off the record §5 keeps
     for the header's stamp — not whatever is in Drive now. QlikView dropping a
     new export while the retry was working is exactly the case where the second
     of those would mark a file as read that nothing has looked at. */
  if ((out.retried || []).length) {
    try {
      var srcs = QLIKSYNC.sources(), seen = qlikStampsRead_('QLIKSYNC.retry'), any = false;
      out.retried.forEach(function (scope) {
        var wrote = QLIKSYNC.lastSync(scope);
        if (!wrote || !wrote.exportAt) return;
        srcs.forEach(function (s) {
          if (s.scope === scope) { seen[s.key] = String(wrote.exportAt); any = true; }
        });
      });
      if (any) qlikStampsWrite_(seen, 'QLIKSYNC.retry');
    } catch (e2) {
      APP_log('warn', 'QLIKSYNC.retry', 'the retry worked but the export was not recorded as ' +
              'read — the next firing will sync it again', { error: String(e2) });
    }
  }
  APP_log(out.ok ? 'info' : 'error', 'QLIKSYNC.retry', 'done',
          { ms: Date.now() - t0, retried: (out.retried || []).join(','),
            failed: (out.failed || []).join(' | ') });
  return out;
}


/* Run from the editor when you want to know whether a retry is waiting, and
   clear it if one is stuck. Reads the retry state; `dropRetryTriggers` is the
   escape hatch if a one-shot ever survives its own firing.

   IT REPORTS THE MAIL SWITCH TOO, and that is not a convenience. With the mail
   off, a failing sync says so in one place only — the execution log — and this
   is the diagnostic somebody reaches for when they suspect a sync is failing.
   Not saying "and by the way you asked not to be told" here is how a mute set
   for one bad afternoon outlives the afternoon. */
function qlikRetryStatus() {
  var pending = QLIKSYNC.retryPending();
  var keys = Object.keys(pending);
  var mailOn = QLIKSYNC.alertMail(), to = QLIKSYNC.alertTo();
  return {
    waiting: keys.map(function (k) {
      return { source: k, attempt: pending[k].tries, since: new Date(pending[k].at),
               problems: pending[k].problems };
    }),
    mail: mailOn ? 'on \u2014 a failed sync mails ' + (to.join(', ') || 'nobody (set QLIK_ALERT_TO)')
                 : 'OFF \u2014 a failed sync writes its whole report to the execution log at ' +
                   'error level and mails nobody. qlikAlertsOn() puts the mail back.',
    note: keys.length ? 'A one-shot trigger should be armed for these. qlikSyncRetry() runs it now.'
                      : 'Nothing is waiting to be retried.'
  };
}


/* ==========================================================================
 * THE FAILURE MAIL, ON AND OFF. Two editor tools, run from the Run menu.
 * --------------------------------------------------------------------------
 * §5c is the argument; this is the switch. THE MAIL IS OFF BY DEFAULT — a
 * pipeline that has started failing sends the same mail every fifteen minutes
 * to somebody who already knows, and that is how the one mail that matters
 * ends up looking like the twenty before it.
 *
 * WHAT IS NOT SWITCHED OFF IS THE FAILURE. A muted run writes the entire
 * report it would have mailed to the execution log at `error`, and
 * qlikRetryStatus() names the mute every time it is asked. Nothing about the
 * gate, the retry or the withheld stamp changes: a tab that fails its checks
 * is still left exactly as it was and still rewritten whole five minutes
 * later.
 *
 * NEITHER TOUCHES QLIK_ALERT_TO. The address is a separate property and it
 * survives a mute, so turning the mail back on does not need it typed in
 * again. Both return the state they left behind, so the Run menu's own log
 * line is the confirmation.
 * ======================================================================== */
function qlikAlertsOn()  { return QLIKSYNC.setAlertMail(true); }
function qlikAlertsOff() { return QLIKSYNC.setAlertMail(false); }


/* ---- IR_MailWatch.gs ---------------------------------------------------------
   The entry points. The IRMAIL engine they drive is in §10, next to the IR
   backend whose setting it writes.  */

/* ==========================================================================
 * THE SECOND HOURLY TRIGGER: the Inventory Report publishes itself.
 * --------------------------------------------------------------------------
 * Set ONE time-driven trigger on inventoryReportMailCheck — Triggers ▸ Add
 * trigger ▸ Time-driven ▸ Hour timer ▸ Every hour. ADD IT FROM THE ACCOUNT THAT
 * DEPLOYED THE WEB APP: a trigger runs as whoever created it, so it is that
 * account's mailbox this searches and that account that is asked to grant
 * gmail.readonly. Nothing in this repo creates
 * it and nothing calls this function; the trigger is the only caller it will
 * ever have.
 *
 * It looks for the report mail, files the PDF it carries into
 * APP_CONFIG.INVENTORY_MAIL.FOLDER_ID, names it for the period the subject
 * names ("Inventory Report - Jul, 2026.pdf"), and writes it into the Inventory
 * Report's source setting. A month's second report REPLACES its first: the
 * folder holds one file per month, and the copy that goes is trashed rather
 * than deleted. A message it has already published is skipped on its id, so an
 * hour where nothing arrived costs one Gmail search and NOTHING else — no
 * folder opened, no property written.
 *
 * Run inventoryReportMailStatus() from the editor first. It runs the same
 * search and reports what the check WOULD do — the query, the folder it can
 * see, and every unpublished mail with the heading it would be given — without
 * filing anything. A wrong subject prefix or an unshared folder shows up there
 * in one run instead of in a trigger nobody is watching.
 *
 * The first firing publishes everything inside WINDOW_DAYS that has not been
 * seen before, oldest first. That is one or two months of report mail on a
 * mailbox that has been receiving them, and the page lands on the newest — the
 * older ones are filed on the way past, one file per month, which is tidy
 * rather than wrong.
 * ======================================================================== */
function inventoryReportMailCheck()  { return IRMAIL.run(); }

/* What the check above would do right now, without doing any of it. */
function inventoryReportMailStatus() { return IRMAIL.status(); }


/* ==========================================================================
 * THE THIRD TRIGGER, AND THE FIRST DAILY ONE: the transfer-price exceptions
 * report sends itself.
 * --------------------------------------------------------------------------
 * Set ONE time-driven trigger on tp01ReportMailCheck — Triggers ▸ Add trigger ▸
 * Time-driven ▸ Day timer ▸ any hour. ADD IT FROM THE ACCOUNT THAT DEPLOYED THE
 * WEB APP: a trigger runs as whoever created it, so it is that account's mailbox
 * this searches, that account that is asked for gmail.readonly, and THAT ACCOUNT
 * THE MAIL IS SENT AS — which is not the same rule the page's own Send button
 * follows. Nothing in this repo creates the trigger and nothing calls this
 * function; the trigger is the only caller it will ever have.
 *
 * DAILY FOR A WEEKLY MAIL, and that is not waste. A day with no new mail costs
 * one Gmail search and nothing else — no sheet read, no comparison, no Drive
 * file, no property written — so six days in seven are free. What the seventh
 * buys is that a report re-issued mid-week goes out the next morning instead of
 * waiting for the following Tuesday.
 *
 * It finds the mail whose subject carries APP_CONFIG.TP01_MAIL.SUBJECT, reads
 * the .xlsx on it, builds the QlikView side out of the Aggregates workbook
 * (Customer Parent = Amrize RMX, this year, rolled to the export's grain), runs
 * the same comparison the page runs, and emails the exceptions — one mail, every
 * market stacked in the body, one combined workbook attached. Who it goes to is
 * the Automated email panel on the TP01 page, stored in Script Properties.
 *
 * ONLY THE NEWEST UNSEEN MAIL IS REPORTED ON. Older unseen ones are earlier
 * versions of the same list and are marked done without being sent.
 *
 * RUN tp01ReportMailStatus() FROM THE EDITOR FIRST. It answers the things the
 * code cannot answer on its own — whether the subject sentence matches the mail
 * that actually arrives, whether the sheet still spells the customer parent the
 * way the config does, and what proportion of rows find a SAP price — without
 * sending anything or marking anything.
 * ======================================================================== */
function tp01ReportMailCheck()  { return TPMAIL.run(); }

/* What the check above would do right now, without sending or marking any of
   it. It does make and trash one temporary Drive copy of the attachment, because
   there is no way to read an .xlsx without one. */
function tp01ReportMailStatus() { return TPMAIL.status(); }
