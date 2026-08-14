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
    } catch (e) {}
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
  } catch (e) {}
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

function CUBE_historyStatus(){
  var out = { ok:true, tok: ovcHistTok_(), lines:{}, eras:{} };
  ['agg', 'rmx'].forEach(function(line){
    var h = ovcHistRead_(line);
    out.eras[line] = ovcEraStat_(line, h);
    if (!h){ out.lines[line] = { built:false }; return; }
    var s = {}; h.rows.forEach(function(r){ s[r[0]] = true; });
    var ym = Object.keys(s).map(Number).sort(function(a, b){ return a - b; });
    var info = { built:true, rows:h.rows.length, months:ym.length,
                 from:ym[0] || null, to:ym[ym.length - 1] || null,
                 eras:h.eras || [], unmapped:null };
    try { info.unmapped = (ovcBuild_(line) || {}).unmapped || null; } catch (e){ info.error = String(e); }
    out.lines[line] = info;
  });
  return out;
}
