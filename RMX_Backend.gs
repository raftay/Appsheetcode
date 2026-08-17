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
  try { APP_forgetStamp_('rmx'); } catch (e) {}
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
function aspInc_(cyRev, cyVol, pyRev, pyVol){
  var a = pyVol? pyRev/pyVol : 0, b = cyVol? cyRev/cyVol : 0; return a ? (b-a)/a : 0;
}
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


/* Run from the Apps Script editor (View > Logs). Lists the rows most likely to
 * explain an Others vs #N/A mismatch with the sheet:
 *  - "revenue-only" lines (0 volume but nonzero revenue) and the label the app
 *    gave them — these shift a bucket's ASP without shifting its volume
 *  - the biggest product mixes the app classified as #N/A (code not found in
 *    PRODUCT MASTER), so they can be checked against the sheet's #N/A rows
 */
function debugNaOthers(market){
  var LK = getLookupsCached_(false);
  var main = loadMain_(LK);
  if (market) main = main.filter(function(m){ return String(m.market)===String(market); });

  var revOnly={}, naMix={};
  main.forEach(function(m){
    var rev = m.cyRev + m.pyRev, vol = m.cyVol + m.pyVol;
    if (vol===0 && rev!==0){
      var k1 = m.cls + ' | ' + m.mix;
      var a = revOnly[k1] || (revOnly[k1]={label:m.cls, mix:m.mix, code:productCode_(m.mix), cyRev:0, pyRev:0});
      a.cyRev+=m.cyRev; a.pyRev+=m.pyRev;
    }
    if (m.cls==='#N/A'){
      var k2 = m.mix;
      var b = naMix[k2] || (naMix[k2]={mix:m.mix, code:productCode_(m.mix), cyVol:0, pyVol:0, cyRev:0, pyRev:0});
      b.cyVol+=m.cyVol; b.pyVol+=m.pyVol; b.cyRev+=m.cyRev; b.pyRev+=m.pyRev;
    }
  });
  function top(map, n){
    return Object.keys(map).map(function(k){return map[k];})
      .sort(function(a,b){ return (Math.abs(b.cyRev)+Math.abs(b.pyRev)) - (Math.abs(a.cyRev)+Math.abs(a.pyRev)); })
      .slice(0, n);
  }
  Logger.log('=== REVENUE-ONLY lines (0 vol, rev<>0) — label these get in the app ===');
  top(revOnly, 30).forEach(function(r){
    Logger.log('[' + r.label + '] code=' + r.code + '  CY $' + Math.round(r.cyRev) + '  PY $' + Math.round(r.pyRev) + '  mix=' + r.mix);
  });
  Logger.log('=== Biggest product mixes classified #N/A (code not in PRODUCT MASTER) ===');
  top(naMix, 30).forEach(function(r){
    Logger.log('code=' + r.code + '  CYvol ' + Math.round(r.cyVol) + '  PYvol ' + Math.round(r.pyVol) + '  CY $' + Math.round(r.cyRev) + '  PY $' + Math.round(r.pyRev) + '  mix=' + r.mix);
  });
  return 'Logged ' + Object.keys(revOnly).length + ' revenue-only lines, ' + Object.keys(naMix).length + ' #N/A mixes. See View > Logs.';
}

function debugUnclassified(market){
  var LK = getLookupsCached_(false);
  var rows = loadStream_(LK, CONFIG.SHEETS.EXTRA).concat(loadStream_(LK, CONFIG.SHEETS.ASSOC));
  if (market) rows = rows.filter(function(r){ return String(r.market)===String(market); });
  var miss={}, order=[];
  rows.forEach(function(r){
    if (r.type !== 'Unclassified') return;
    var k = r.descr || '(blank mat_descr)';
    var g = miss[k];
    if (!g){ g = miss[k] = {descr:k, hier3:r.hier3, cyRev:0, pyRev:0, n:0}; order.push(k); }
    g.cyRev+=r.cyRev; g.pyRev+=r.pyRev; g.n++;
  });
  var list = order.map(function(k){return miss[k];})
    .sort(function(a,b){ return (Math.abs(b.cyRev)+Math.abs(b.pyRev)) - (Math.abs(a.cyRev)+Math.abs(a.pyRev)); });
  function esc(v){ v=String(v==null?'':v); return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; }
  var csv = ['mat_prod_hier_3,mat_descr,CY Rev,PY Rev,Row Count'];
  list.forEach(function(r){
    csv.push([esc(r.hier3), esc(r.descr), Math.round(r.cyRev), Math.round(r.pyRev), r.n].join(','));
  });
  var file = DriveApp.createFile('RMX_Unclassified_Materials.csv', csv.join('\n'), MimeType.CSV);
  Logger.log(list.length + ' distinct unclassified materials. CSV: ' + file.getUrl());
  return file.getUrl();
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
    debugNaOthers:  debugNaOthers,
    debugUnclassified: debugUnclassified,
    bumpGeneration: bumpGeneration_,  // used by Code.gs syncAll()
    /* The Overview's month cube reads these — the SAME cached bundle this page
       already built (main / extras / assoc + lookups), so the cube never opens
       the sheet itself and adds nothing to any page load. Read-only. */
    dataBundle:     function(){ return loadDataCached_(false); },
    lookups:        function(){ return getLookupsCached_(false); },
    /* read-only, for RMX_debugMonths */
    build:          function(){ return BUILD; },
    cacheVer:       function(){ return CONFIG.CACHE_VER; },
    generation:     function(){ return generation_(); },
    bundleOk:       function(b){ return bundleOk_(b); }
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
 * RMX_debugMonths - run this from the Apps Script editor, then View > Logs.
 * --------------------------------------------------------------------------
 * Answers, in one go, every question this page's month handling can raise:
 * which month column was found, what each month actually holds, which month
 * the report lands on and what MTD / YTD then add up to. If a figure on the
 * page disagrees with the sheet, this says where the two part company without
 * needing another round of screenshots.
 * ======================================================================== */
function RMX_debugMonths(){
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var out = [];
  function say(s){ out.push(s); Logger.log(s); }

  say('BUILD      ' + RMX_NS.build());
  say('CACHE_VER  ' + RMX_NS.cacheVer() + '   generation ' + RMX_NS.generation());
  say('Today      ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
      + '   so last calendar month = ' + MON[((new Date()).getMonth() || 12) - 1]);

  var b = RMX_NS.dataBundle();
  say('Bundle     ' + b.main.length + ' main rows   latestMonth=' + b.latestMonth
      + ' (' + (b.latestMonth ? MON[b.latestMonth-1] : '??') + ')'
      + '   months.cy=[' + ((b.months && b.months.cy) || []).join(',') + ']');
  say('Bundle shape OK? ' + (RMX_NS.bundleOk(b) ? 'yes' : 'NO - it would be rebuilt'));

  var cy = {}, py = {}, n = {};
  b.main.forEach(function(m){
    var k = m.month || 0;
    cy[k] = (cy[k]||0) + m.cyVol; py[k] = (py[k]||0) + m.pyVol; n[k] = (n[k]||0) + 1;
  });
  say('');
  say('month    rows        CY vol        PY vol');
  Object.keys(n).map(Number).sort(function(a,z){ return a-z; }).forEach(function(k){
    say(('  ' + (k ? MON[k-1] : '(none)')).slice(0,8)
        + String(n[k]).padStart(7)
        + (Math.round(cy[k]||0)).toLocaleString().padStart(14)
        + (Math.round(py[k]||0)).toLocaleString().padStart(14));
  });

  say('');
  ['MTD','YTD'].forEach(function(p){
    var r = RMX_NS.getKeys({ market:'__ALL__', period:p });
    var c = 0, y = 0;
    r.keys.forEach(function(k){ c += k.cyVol; y += k.pyVol; });
    say(p + '  month=' + r.month + ' (' + (r.month ? MON[r.month-1] : '??') + ')'
        + '   CY ' + Math.round(c).toLocaleString()
        + '   PY ' + Math.round(y).toLocaleString()
        + '   ' + (y ? (((c-y)/y*100).toFixed(1) + '%') : 'n/a'));
  });
  say('');
  say('If YTD PY here matches the sheet\u2019s FULL-YEAR total, the month filter is not '
    + 'running. If it matches Jan-to-report-month, the backend is right and the page is '
    + 'showing a cached copy - press \u21bb Update from source.');
  return out.join('\n');
}

/* ==========================================================================
 * RMX_whoWins - run this if the page ever claims the backend is old again.
 * --------------------------------------------------------------------------
 * Prints which object the global name `RMX` currently resolves to, and forces
 * a throw inside it so the Apps Script stack trace names the FILE that owns
 * the winning copy. If that file is not RMX_Backend.gs, delete it.
 * ======================================================================== */
function RMX_whoWins(){
  var log = [];
  function ok(v){ return (typeof v === 'function') ? 'function' : String(typeof v); }

  log.push('RMX_NS keys : ' + Object.keys(RMX_NS).join(', '));
  log.push('RMX    keys : ' + Object.keys(RMX).join(', '));
  log.push('RMX === RMX_NS ? ' + (RMX === RMX_NS ? 'yes - only one copy in the project'
                                                 : 'NO - a second file is defining RMX'));
  log.push('typeof RMX.build = ' + ok(RMX.build) + '    typeof RMX_NS.build = ' + ok(RMX_NS.build));
  log.push('this file BUILD  = ' + RMX_NS.build());
  log.push('--- live top-level getKeys ---\n' + String(getKeys));
  log.push('--- live RMX.getKeys (head) ---\n' + String(RMX.getKeys).slice(0, 600));

  try { RMX.getKeys({ upload: '__probe__', period: 'YTD' }); }
  catch (e){ log.push('--- stack (names the winning FILE) ---\n' + (e.stack || e.message || e)); }

  var s = log.join('\n\n');
  Logger.log(s);
  return s;
}

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
function RMX_prepare(opts)        { return RMX_NS.prepareAll(opts); }
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

/* Diagnostic: run this from the editor (pick a market, e.g. 'HNS_SW'), then View > Logs */
function RMX_debugNaOthers(){ return RMX_NS.debugNaOthers('HNS_SW'); }
function RMX_debugUnclassified(){ return RMX_NS.debugUnclassified(); }
