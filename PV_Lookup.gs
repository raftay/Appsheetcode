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
  s = s.replace(/[$,%\s]/g, '');
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
function gk_(k){ return 'pv|g' + gen_() + '|' + k; }

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
      try { PV.clearCache(); } catch (e){ try { APP_bumpGen_('pricevolume'); } catch (e2){} }
    }

    return { ok: true, added: out.length, skipped: skipped.length, skippedValues: skipped,
             formulasCopied: copied, generation: APP_getGen_('pricevolume') };

  } finally {
    try { lock.releaseLock(); } catch (e){}
  }
}

return { getUnmapped: getUnmapped, getForm: getForm, applyRows: applyRows };

})();

/* ---- top-level wrappers for google.script.run ---- */
function getPvUnmapped(opts)   { return PVLOOK.getUnmapped(opts); }
function getPvLookupForm()     { return PVLOOK.getForm(); }
function applyPvLookupRows(p)  { return PVLOOK.applyRows(p); }