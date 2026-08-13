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