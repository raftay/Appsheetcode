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
    try { lock.releaseLock(); } catch (e){}
  }
}

return { getSuggestions: getSuggestions, applyRows: applyRows, getUrls: getUrls };

})();

/* ---- top-level wrappers for google.script.run ---- */
function getRmxSuggestions(opts){ return RMXSUGGEST.getSuggestions(opts); }
function applyRmxLookupRows(p){   return RMXSUGGEST.applyRows(p); }
function getRmxLookupUrls(){      return RMXSUGGEST.getUrls(); }