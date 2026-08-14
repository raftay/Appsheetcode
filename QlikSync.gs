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
              } catch (e2) {}
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
      try { syncAll(); } catch (e) {}

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
      try { lock.releaseLock(); } catch (e2) {}
    }
  }

  return { run: run, sources: sources_ };
})();


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
  var props = PropertiesService.getScriptProperties();
  var seen = {};
  try { seen = JSON.parse(props.getProperty(QLIK_STAMP_KEY) || '{}'); } catch (e) { seen = {}; }

  var sources;
  try { sources = QLIKSYNC.sources(); }
  catch (e) { Logger.log('QlikView check failed: ' + e.message); return { ok: false, error: e.message }; }

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
        Logger.log('QlikView ' + src.label + ' synced with bad tabs: ' + JSON.stringify(res.failed));
      }
    }
  });

  props.setProperty(QLIK_STAMP_KEY, JSON.stringify(seen));
  if (out.failed.length) Logger.log('QlikView check: ' + out.failed.join(' | '));
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
    catch (e) {}
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
    try { seen = JSON.parse(props.getProperty(QLIK_STAMP_KEY) || '{}'); } catch (e) {}
    QLIKSYNC.sources().forEach(function (src) {
      if (want !== 'all' && src.scope !== want) return;
      try { seen[src.key] = String(DriveApp.getFileById(src.id).getLastUpdated().getTime()); }
      catch (e) {}
    });
    props.setProperty(QLIK_STAMP_KEY, JSON.stringify(seen));
  }
  return res;
}
