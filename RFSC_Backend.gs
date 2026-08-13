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
  /* The month cell, in either shape.
       MyMonth    "Apr"          -> { y:null, m:4 }   both years on THIS row
       Bill Month "Apr-25"       -> { y:2025, m:4 }   one year per row
     A null year means "this row carries every year the columns hold", which is
     what yearsOn_ below turns into the list of year slots to read. */
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

    var my = s.match(/^([A-Za-z]{3,})$/);              // MyMonth: no year at all
    if (my){ var m0 = monthNum_(my[1]); return m0 ? { y:null, m:m0 } : null; }

    var mt = s.match(/^([A-Za-z]{3,})[\s\-\/.]*(\d{2,4})$/);
    if (!mt) return null;
    var mo = monthNum_(mt[1]);
    if (!mo) return null;
    var yr = parseInt(mt[2], 10);
    if (yr < 100) yr += 2000;
    return { y: yr, m: mo };
  }

  /* Which years a row feeds. Bill Month names one; MyMonth feeds every year
     the metric columns carry, because both sit on the same row. `maps` is one
     or more year -> column objects; a year counts if any of them has it. */
  function yearsOn_(bm, maps){
    if (!bm) return [];
    if (bm.y != null) return [bm.y];
    var seen = {}, out = [];
    for (var i = 0; i < maps.length; i++){
      for (var y in (maps[i] || {})){
        var n = Number(y);
        if (n && !seen[n]){ seen[n] = 1; out.push(n); }
      }
    }
    return out.sort(function(a,b){ return a - b; });
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
  /* Accepted names for the month column. MyMonth ("Apr") is what the export
     sends now; Bill Month ("Apr-25") is still read so an uploaded Excel file
     from before the change keeps working. */
  var MONTH_NAMES_ = ['mymonth','my month','my_month','bill month','billmonth'];

  /* `must` names every column the row needs; `oneOf` is a set where ANY one
     will do (the month column, which has two spellings). */
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
    if (c.bill  < 0) miss.push('MyMonth (or Bill Month)');
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
    if (c.bill  < 0) miss.push('MyMonth (or Bill Month)');
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

      /* Bill Month names one year; MyMonth carries every year the columns hold
         on this one row, so the row is read once per year. */
      var yrs = yearsOn_(bm, [c.m3, c.rev]);
      for (var yi = 0; yi < yrs.length; yi++){
        var yr = yrs[yi];
        var mc = c.m3[yr], rc = c.rev[yr];
        if (mc == null && rc == null) continue;    // no columns for that year
        years[yr] = true; lines++;

        var m3  = (mc == null) ? 0 : toNum_(row[mc]);
        var fsc = (rc == null) ? 0 : toNum_(row[rc]);
        if (!m3 && !fsc) continue;                 // a $0 line still proved the year is covered

        var key = pk + '|' + norm_(seg_(row[c.seg])) + '|' + yr + '|' + bm.m;
        var f = fact[key] || (fact[key] = { m3:0, fsc:0 });
        f.m3 += m3; f.fsc += fsc;                  // sum every surcharge code on the cell
      }
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

    /* The newest year is CY, and the surcharge column follows from that.
       With Bill Month the year is on the row, so it is read from the rows.
       With MyMonth there is no year on the row at all, so it comes from the
       "#### Vol" column headers instead \u2014 the same two years, just written
       once at the top rather than on every line. */
    var yMax = 0, i, bm, y;
    for (i = hdr + 1; i < grid.length; i++){
      bm = billYm_(grid[i][c.bill]);
      if (bm && bm.y != null && bm.y > yMax) yMax = bm.y;
    }
    if (!yMax){
      for (y in c.vol) if (Number(y) > yMax) yMax = Number(y);
    }
    if (!yMax) throw new Error('No usable month values were found in Main Raw Data \u2014 '
      + 'MyMonth should read like "Jul", or Bill Month like "Jul-26".');

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

      /* One year with Bill Month, both with MyMonth. Everything below is per
         year, so a MyMonth row lands in exactly the same two buckets that two
         Bill Month rows used to. */
      var yrs = yearsOn_(bm, [c.vol, c.ns]);
      for (var yi = 0; yi < yrs.length; yi++){
        var yr = yrs[yi];
        var vc  = c.vol[yr], nc = c.ns[yr];
        var vol = (vc == null) ? 0 : toNum_(row[vc]);
        var ns  = (nc == null) ? 0 : toNum_(row[nc]);
        var spr = (yr === yMax) ? (c.cyFsc < 0 ? 0 : toNum_(row[c.cyFsc]))
                                : (c.pyFsc < 0 ? 0 : toNum_(row[c.pyFsc]));
        if (!vol && !ns && !spr) continue;            // padding rows
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
       days of this month against a full month a year ago. The MyMonth export
       carries every month of the year (the prior-year figures ride on the same
       row), so this has to be stated rather than read off the data.

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

  return {
    getRmxFuel: function(opts){
      return output_(readData_(opts && opts.filter ? opts.filter : opts), opts && opts.month);
    },
    /* Unaggregated facts for the Overview. Takes the same optional filter, but
       the Overview will usually pull them unfiltered once and slice on the
       client, the way the RMX cross-filter already does. */
    getFacts:   function(opts){ return facts_(readData_(opts && opts.filter ? opts.filter : opts)); },
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