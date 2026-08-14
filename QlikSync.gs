/*****************************************************************************
 * QlikSync.gs — pull the QlikView exports straight out of Drive and replace
 *               the data in each tool's Google Sheet.
 * ---------------------------------------------------------------------------
 * WHAT IT DOES
 *   Two Drive folders hold the QlikView exports. The file NAMES are not
 *   trusted — every Excel file in the folder is opened and identified by what
 *   is actually inside it, so re-exporting under a different name changes
 *   nothing here.
 *
 *     AGG folder  →  Price & Volume workbook
 *                      Combined Data CPI Raw
 *                      Combined Data CPI Other Revenue
 *     RMX folder  →  Ready-Mix workbook   (the Margin Monitor export)
 *                      Main Raw Data · Extra Raw Data · Associate Raw Data
 *                 →  Slide Builder workbook (the Segment/Product export)
 *                      Slide Segment MTD / YTD
 *                      Slide Product <Market> MTD / YTD
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
 *   Folder ids live in Config.gs → APP_CONFIG.QLIK_SYNC.
 *   Nothing else to enable: the Drive REST copy below runs on the script's own
 *   OAuth token, so the Advanced Drive Service does NOT need to be turned on.
 *
 * TRIGGERS
 *   Attach them to qlikSyncDailyAgg / qlikSyncDailyRmx / qlikSyncDailySegment,
 *   one scope each — not to qlikSyncNow, which takes an argument a trigger
 *   would fill with its own event object.
 *
 *   run() RETURNS its errors, it never throws them, so a failed tab does not
 *   mark the execution failed. What does is Apps Script killing the run for
 *   passing its runtime limit — invisible to the try/catch, and late enough
 *   that the sheets are already written. A trigger that reports "failed" over
 *   correctly updated sheets is nearly always that. Section 0b keeps the run
 *   inside its budget and leaves a breadcrumb either way; qlikSyncLastRun()
 *   at the bottom of this file reads it back.
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
   * 0b. THE SIX MINUTES, AND THE BREADCRUMB
   * ---------------------------------------------------------------------
   * Apps Script kills any execution that passes its runtime limit. That kill
   * is not an exception: the try/catch in run() never sees it, the return
   * value never reaches anybody, and all that is left is a trigger the
   * dashboard marks "failed" and a "failed to complete successfully" email —
   * even though every sheet the run had already written is sitting there
   * correctly updated. A sync that "works but keeps saying failed" is very
   * often exactly this, and nothing about it is visible after the fact.
   *
   * Two things here, together:
   *
   *   BUDGET   No new tab is started once the run is this far in. The work
   *            already done is kept, the rest is reported as not-run, and the
   *            execution ENDS instead of being killed — so the trigger says
   *            what actually happened rather than just "failed".
   *
   *   REPORT   A breadcrumb written to Script Properties as the run moves
   *            through its phases. Property writes survive the kill, so even
   *            a run that does get cut off leaves behind the tab it was on.
   *            Read it back with qlikSyncLastRun().
   * =================================================================== */
  var BUDGET_MS  = 4 * 60 * 1000;      /* of the six; the rest finishes up */
  var REPORT_KEY = 'QLIK_SYNC_LAST_RUN';


  /* =====================================================================
   * 0c. PULLING AND PUBLISHING ARE TWO DIFFERENT THINGS
   * ---------------------------------------------------------------------
   * This used to end by calling syncAll(), which bumps every page's data
   * version. That version is what invalidates BOTH caches: the 6-hour server
   * cache, and each device's saved tables in localStorage — and the device
   * copies have no expiry at all, so the version is the only thing that ever
   * clears them (Shell.html, AmrCache.check).
   *
   * Bumping it the moment the sheet is written meant the sync pulled the floor
   * out from under whoever was already reading:
   *
   *   · the page you are on keeps its tables, because nothing re-checks the
   *     version mid-session — so the sync looks like it did nothing;
   *   · leave the page and come back and boot() sees a new version, wipes the
   *     device copy, and the server cache is cold too, so the whole 50k-row
   *     rebuild has to happen inside that one page load. Slow at best, and a
   *     blank page when it does not make it.
   *
   * So the pull no longer publishes. It writes the sheet and leaves a note
   * saying which pages have new data behind them; the site keeps serving the
   * numbers it already has until someone chooses to take the new ones, which
   * is when the versions move. Nobody is interrupted mid-read, and the rebuild
   * happens at a moment a human is watching and can be shown progress.
   * =================================================================== */
  var PENDING_KEY = 'QLIK_PENDING_UPDATE';

  /* Merged, not replaced: an AGG pull followed by an RMX pull leaves BOTH
     waiting to be published, and the older timestamp is the honest one. */
  function markPending_(pages, files) {
    try {
      var p = PropertiesService.getScriptProperties();
      var cur = {};
      try { cur = JSON.parse(p.getProperty(PENDING_KEY) || '{}'); } catch (e) { cur = {}; }
      var list = (cur.pages || []).slice();
      pages.forEach(function (pg) { if (list.indexOf(pg) === -1) list.push(pg); });
      if (!list.length) return;
      p.setProperty(PENDING_KEY, JSON.stringify({
        since: cur.since || new Date().toISOString(),
        at:    new Date().toISOString(),
        pages: list,
        files: (files || []).slice(0, 8)
      }));
    } catch (e) {}
  }

  function pending() {
    try {
      var raw = PropertiesService.getScriptProperties().getProperty(PENDING_KEY);
      if (!raw) return { pending: false, pages: [] };
      var v = JSON.parse(raw);
      if (!v.pages || !v.pages.length) return { pending: false, pages: [] };
      return { pending: true, since: v.since, at: v.at, pages: v.pages, files: v.files || [] };
    } catch (e) { return { pending: false, pages: [] }; }
  }

  function clearPending() {
    try { PropertiesService.getScriptProperties().deleteProperty(PENDING_KEY); } catch (e) {}
  }

  /* A Script Property holds 9 kB. One "none of the export columns matched"
     message carries the whole export header and can be most of that on its
     own, so every line is clipped before it goes in: a report that cannot be
     stored is worth nothing on the morning it is needed. */
  function clip_(s) {
    s = String(s == null ? '' : s);
    return s.length > 200 ? s.slice(0, 197) + '…' : s;
  }

  function report_(patch) {
    try {
      var p = PropertiesService.getScriptProperties();
      var cur = {};
      try { cur = JSON.parse(p.getProperty(REPORT_KEY) || '{}'); } catch (e) { cur = {}; }
      Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
      var s = JSON.stringify(cur);
      if (s.length > 8500) {
        ['done', 'skipped', 'failed', 'notRun'].forEach(function (k) {
          if (cur[k] && cur[k].length > 6) {
            cur[k] = cur[k].slice(0, 6).concat(['… and ' + (cur[k].length - 6) + ' more']);
          }
        });
        s = JSON.stringify(cur).slice(0, 8500);
        try { JSON.parse(s); } catch (e2) { s = JSON.stringify({ phase: cur.phase, ok: cur.ok,
          error: 'The full report was too long to store.' }); }
      }
      p.setProperty(REPORT_KEY, s);
    } catch (e) {}                     /* diagnostics never break the sync */
  }

  /* What the last run got to. `phase` is the breadcrumb: if it still reads
     mid-run, that run was killed there rather than finishing. */
  function lastRun() {
    try {
      var raw = PropertiesService.getScriptProperties().getProperty(REPORT_KEY);
      if (!raw) return { ok: false, error: 'No QlikView sync has been recorded yet.' };
      var r = JSON.parse(raw);
      if (r.phase && r.phase !== 'finished') {
        r.verdict = 'This run never reached the end. It stopped during "' + r.phase +
          '" — on a time-driven trigger that almost always means it ran past the ' +
          'Apps Script runtime limit and was killed, which is what the "failed" ' +
          'notice is reporting.';
      }
      return r;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }


  /* =====================================================================
   * 1. WHERE EACH COLUMN GOES
   * ---------------------------------------------------------------------
   * Only the names that DIFFER need listing. Everything else matches
   * outright ("2026 Vol" → "2026 Vol"). Left = the export's name,
   * right = the tab's name.
   * =================================================================== */

  /* SYNONYMS — names that mean the same column on either side.
     The month column is the live case: QlikView now sends MYMONTH ("Apr", with
     both years populated on the one row) where it used to send Bill Month
     ("Apr-25", one year per row). Whichever of the two the export says and
     whichever the sheet header still says, the two match each other, so the
     column lands in the right place before, during and after the changeover. */
  var SYNONYM = {
    'mymonth':    'monthcol', 'my month':    'monthcol', 'my_month':   'monthcol',
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
   *   folder  'AGG' | 'RMX'      — which Drive folder to look in
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
      { folder: 'RMX', page: 'segment', tab: 'Slide Segment MTD',
        mode: 'replace', srcTab: 'Summary MTD' },
      { folder: 'RMX', page: 'segment', tab: 'Slide Segment YTD',
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
          folder: 'RMX', page: 'segment',
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

  function excelFilesIn_(folderId, label) {
    var out = [];
    var folder;
    try {
      folder = DriveApp.getFolderById(folderId);
    } catch (e) {
      throw new Error('Could not open the ' + label + ' Drive folder (id ' + folderId +
        '). Check APP_CONFIG.QLIK_SYNC in Config.gs, and that the folder is shared with you.');
    }
    var it = folder.getFiles();
    while (it.hasNext()) {
      var f = it.next();
      var mime = f.getMimeType();
      var name = f.getName();
      if (EXCEL_MIME[mime] || /\.xlsx?$/i.test(name)) {
        out.push({ id: f.getId(), name: name, mime: mime });
      }
    }
    return out;
  }

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
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
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

  /* The month cell as { y, m } (m is 0-based). y is null for MyMonth, which
     carries no year at all — used to work out which month the exports are for,
     so the Slide Builder's month picker can default to it. */
  function monthYM_(v) {
    var MON = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
                jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
    var d = null, m;
    if (Object.prototype.toString.call(v) === '[object Date]') d = v;
    else if (typeof v === 'number') d = new Date(Math.round((v - 25569) * 86400000));
    if (d) return { y: d.getFullYear(), m: d.getMonth() };

    var s = String(v == null ? '' : v).trim();

    var bare = s.match(/^([A-Za-z]{3,})$/);             // MyMonth: no year
    if (bare) {
      m = MON[bare[1].slice(0, 3).toLowerCase()];
      return (m === undefined) ? null : { y: null, m: m };
    }

    var mt = s.match(/^([A-Za-z]{3,})[\s\-\/.]*(\d{2,4})$/);
    if (!mt) return null;
    m = MON[mt[1].slice(0, 3).toLowerCase()];
    if (m === undefined) return null;
    var y = parseInt(mt[2], 10); if (y < 100) y += 2000;
    return { y: y, m: m };
  }

  /* The latest month the export actually carries.
     MyMonth gives no year, so the year comes from the "#### Vol" headers
     instead — the newest one there is the current year.

     CAPPED AT LAST CALENDAR MONTH — but only when the winning value is itself
     year-less. A MyMonth column carries both years on the one row, so a row
     headed "Dec" is last year's December sitting against nothing at all this
     year, and the export carries all twelve. Taking the newest value literally
     therefore said DECEMBER every month of the year, which is what made the
     Product Segment page open on December in August.

     A Bill Month ("Dec-25") names its own year and is not ambiguous, so it is
     never capped — the 2024-2023 and 2025-2024 history workbooks are still in
     that format, and a closed year legitimately ends in December. `bare` is
     therefore set from the WINNING value, not from "some row somewhere was
     year-less": on a source carrying both formats the year-bearing value wins
     the comparison anyway (a bare month sorts as year 0), and capping it would
     have pulled a known December back to last month for no reason. */
  function latestMonth_(src, col) {
    var best = null, bare = false, i;
    for (i = 0; i < src.rows.length; i++) {
      var ym = monthYM_(src.rows[i][col]);
      if (!ym) continue;
      if (!best || (ym.y || 0) > (best.y || 0) ||
          ((ym.y || 0) === (best.y || 0) && ym.m > best.m)) { best = ym; bare = (ym.y == null); }
    }
    if (best && best.y == null) {
      var y = 0;
      for (i = 0; i < src.hdr.length; i++) {
        var hm = String(src.hdr[i] || '').match(/\b(20\d{2})\b/);
        if (hm && +hm[1] > y) y = +hm[1];
      }
      best = y ? { y: y, m: best.m } : null;
    }
    if (best && bare) {
      var now = new Date(), cy = now.getFullYear(), cm = now.getMonth() - 1;   // last calendar month
      if (cm < 0) { cm = 11; cy -= 1; }
      if (best.y > cy || (best.y === cy && best.m > cm)) best = { y: cy, m: cm };
    }
    return best;
  }

  /* The month column is stored as TEXT, never a date — a real date in that cell
     is what makes the year hide in the day field.

     MyMonth stays a bare month ("Aug"); Bill Month keeps its year ("Aug-25").
     A string goes through untouched, which is the normal case for both; only a
     value that arrived as a date or a serial has to be formatted, and then the
     shape follows the EXPORT's own spelling. A MyMonth column must never gain
     a year it did not have — that missing year is exactly what tells every
     reader that both years sit on the one row. */
  function monthText_(v, isMyMonth) {
    if (v === '' || v == null) return '';
    var fmt = isMyMonth ? 'MMM' : 'MMM-yy';
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
    /* compared in canonical form, so "MyMonth" finds a "Bill Month" column */
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
      /* myMonth: the EXPORT's own spelling decides the shape written, not the
         sheet's header — an export still sending Bill Month keeps its year
         even if the sheet column has already been renamed. */
      pairs.push({ src: sc, col: tc + 1, isMonth: (name === 'monthcol'),
                   myMonth: /^my[ _]?month$/.test(norm_(raw)) });
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
            row[p.col - b.start] = p.isMonth ? monthText_(v, p.myMonth) : (v === undefined ? '' : v);
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

  function folderIds_() {
    var q = (APP_CONFIG && APP_CONFIG.QLIK_SYNC) || {};
    if (!q.AGG_FOLDER_ID || !q.RMX_FOLDER_ID) {
      throw new Error('The QlikView Drive folders are not set. ' +
        'Add APP_CONFIG.QLIK_SYNC.AGG_FOLDER_ID and .RMX_FOLDER_ID in Config.gs.');
    }
    return q;
  }

  /* scope: 'all', or a page id ('pricevolume' | 'rmx' | 'segment') so a tool's
     own button pulls only what that tool reads. Only the folders the chosen
     tabs actually need get opened. */
  function run(scope) {
    var want = String(scope || 'all').toLowerCase();

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) {
      /* Three daily triggers set to the same time is the usual way here: two
         of them find the lock held and come back with this. Nothing is wrong,
         but nothing was updated either, so it goes on the record as a run that
         ended on its own — not as a half-written one. */
      var busyMsg = 'Another update is already running. Try again in a moment.';
      report_({ phase: 'finished', ok: false, scope: want, error: busyMsg,
                startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
                seconds: 0, done: [], skipped: [], failed: [], notRun: [] });
      return { ok: false, scope: want, error: busyMsg,
               files: [], done: [], skipped: [], failed: [], notRun: [] };
    }

    var started = new Date();
    var done = [], skipped = [], failed = [], notRun = [], touched = {};
    function elapsed_()  { return new Date() - started; }
    function outOfTime_() { return elapsed_() > BUDGET_MS; }

    report_({ startedAt: started.toISOString(), scope: want, phase: 'starting',
              ok: null, done: [], skipped: [], failed: [], notRun: [], error: null });

    try {
      var ids  = folderIds_();
      var SPEC = buildSpec_().filter(function (s) { return want === 'all' || s.page === want; });
      if (!SPEC.length) {
        return { ok: false, error: 'Nothing is set up to update for "' + want + '".' };
      }

      /* --- read only the folders these tabs need, once each --- */
      var tabsByFolder = { AGG: [], RMX: [] };
      var filesSeen    = [];
      var needed = {};
      SPEC.forEach(function (s) { needed[s.folder] = 1; });

      [['AGG', ids.AGG_FOLDER_ID], ['RMX', ids.RMX_FOLDER_ID]].forEach(function (pair) {
        if (!needed[pair[0]]) return;
        excelFilesIn_(pair[1], pair[0]).forEach(function (f) {
          report_({ phase: 'reading ' + pair[0] + ' export: ' + f.name });
          filesSeen.push(pair[0] + ': ' + f.name);
          tabsByFolder[pair[0]] = tabsByFolder[pair[0]].concat(readExport_(f));
        });
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
          /* Starting another tab now would run past the limit and get the
             whole execution killed mid-write. Stop while the run still owns
             its own ending. */
          if (outOfTime_()) {
            notRun.push({ tab: spec.tab, error: 'Ran out of time before this tab was reached.' });
            return;
          }
          report_({ phase: 'writing ' + spec.tab });
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
              } catch (e2) {}
            }
            done.push(res);
            touched[page] = 1;                 /* this page has new data behind it */
            ends[norm_(spec.tab)] = sh.getMaxRows();
          } catch (e) {
            failed.push({ tab: spec.tab, error: e.message });
          }
        });

        /* Every tab in this workbook has its final height now, so the array
           formulas can be re-pointed — including the ones that reach across
           into another tab of the same workbook. */
        report_({ phase: 'restoring formulas in ' + APP_CONFIG.PAGES[page].label });
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

      /* --- the sheet has the new data; the site is not told yet (see 0c) --- */
      var pages = Object.keys(touched);
      report_({ phase: 'noting what is waiting to be published' });
      markPending_(pages, filesSeen);

      var out = {
        ok: failed.length === 0 && notRun.length === 0,
        scope: want,
        files: filesSeen,
        done: done,
        skipped: skipped,
        failed: failed,
        notRun: notRun,
        pagesUpdated: pages,
        awaitingPublish: pages.length > 0,
        seconds: Math.round(elapsed_() / 100) / 10
      };
      if (notRun.length) {
        out.error = 'Ran out of time with ' + notRun.length + ' tab' +
          (notRun.length === 1 ? '' : 's') + ' still to do. Everything written so far ' +
          'is good — run the update again, or give each page its own trigger so no ' +
          'single run has to do all of them.';
      }
      finish_(out);
      return out;

    } catch (e) {
      var bad = { ok: false, scope: want, error: e.message, files: [],
                  done: done, skipped: skipped, failed: failed, notRun: notRun };
      finish_(bad);
      return bad;
    } finally {
      try { lock.releaseLock(); } catch (e2) {}
    }

    /* The record of a run that reached its own ending. Only the shape of the
       outcome is kept — the full row-by-row detail goes back to the caller,
       not into a Script Property. */
    function finish_(res) {
      report_({
        phase:      'finished',
        ok:         res.ok,
        error:      clip_(res.error || '') || null,
        finishedAt: new Date().toISOString(),
        seconds:    Math.round(elapsed_() / 100) / 10,
        done:       res.done.map(function (d) { return d.tab + ' (' + d.rows + ' rows)'; }),
        skipped:    res.skipped.map(function (s) { return clip_(s.tab + ': ' + s.error); }),
        failed:     res.failed.map(function (f) { return clip_(f.tab + ': ' + f.error); }),
        notRun:     res.notRun.map(function (n) { return n.tab; })
      });
      /* Visible in the Executions list without marking the run failed — a run
         that finished and reported its own problems is not a crash. */
      if (!res.ok) {
        try {
          console.error('QlikView sync (' + want + ') finished with problems: ' +
            (res.error || '') + ' ' + res.failed.map(function (f) {
              return f.tab + ': ' + f.error;
            }).join(' | '));
        } catch (e3) {}
      }
    }
  }

  return { run: run, lastRun: lastRun,
           pending: pending, clearPending: clearPending };
})();


/* ==========================================================================
 * Called from the ⇣ Pull from QlikView button (google.script.run).
 *
 *   qlikSyncNow()               everything
 *   qlikSyncNow('pricevolume')  the Aggregates tabs only
 *   qlikSyncNow('rmx')          the Ready-Mix raw tabs only
 *   qlikSyncNow('segment')      the Slide Builder tabs only
 *
 * A page passes its own id, so pressing the button on one tool does not make
 * everybody wait for the other exports to be converted and read.
 * ======================================================================== */
function qlikSyncNow(scope) {
  /* A time-driven trigger hands its own event object to whatever function it
     is attached to. Wire a trigger straight to THIS one and `scope` arrives as
     { triggerUid: …, authMode: … }, which matches no page, filters the spec
     down to nothing and returns "nothing is set up to update for [object
     Object]" — a daily run that quietly does nothing. Only a real page id
     counts; anything else means everything.
     The three qlikSyncDaily* functions below are the ones to attach a trigger
     to, precisely because they take no argument. */
  return QLIKSYNC.run(typeof scope === 'string' ? scope : 'all');
}
function qlikSyncDailyAgg() {
  return qlikSyncNow('pricevolume');
}
function qlikSyncDailyRmx() {
  return qlikSyncNow('rmx');
}
function qlikSyncDailySegment() {
  return qlikSyncNow('segment');
}

/* ==========================================================================
 * What did the last run actually do?
 *
 * Run this from the Apps Script editor after a trigger reports a failure. A
 * run that was killed for going over the runtime limit cannot report anything
 * itself — the breadcrumb it left behind is all there is, and this reads it:
 *
 *   phase: "finished"          it ended on its own; `ok`, `failed` and
 *                              `error` say how it went.
 *   phase: anything else       it was killed there. On a trigger that means
 *                              the runtime limit, and the sheets it had
 *                              already written are still correctly updated —
 *                              which is why the sync "works" and the trigger
 *                              still says failed.
 * ======================================================================== */
function qlikSyncLastRun() {
  var r = QLIKSYNC.lastRun();
  try { console.log(JSON.stringify(r, null, 2)); } catch (e) {}
  return r;
}
