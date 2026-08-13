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

  /* ---------- shared column resolution for a CPI grid ----------
     Used by both the sheet reader and the upload path, so an uploaded export
     and the live tab are parsed by exactly the same rules. */
  function cpiCols_(header){
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
    if (miss.length) throw new Error('The Combined Data CPI Raw data is missing these column(s): '
      + miss.join(', ') + '. Check the header row spelling.');
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
    var c = cpiCols_(grid[0]);

    /* the newest year in the file decides which Rev column belongs to a row */
    var yMax = 0;
    for (var s0 = 1; s0 < grid.length; s0++){
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
      for (var q = 1; q < grid.length; q++){
        var kq = norm_(grid[q][c.key]); if (!kq) continue;
        if (vHi != null) denom.hi[kq] = (denom.hi[kq] || 0) + toNum_(grid[q][vHi]);
        if (vLo != null) denom.lo[kq] = (denom.lo[kq] || 0) + toNum_(grid[q][vLo]);
      }
    }

    var cells = {}, markets = [], seen = {}, latest = 0, unknown = {}, used = 0;
    for (var r = 1; r < grid.length; r++){
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
      if (yr === yMax && vol !== 0 && mo > latest) latest = mo;

      var key = mk + '|' + yr + '|' + mo;
      var b = cells[key] || (cells[key] = { vol:0, ns:0, fsc:0, avol:0, ans:0, afsc:0 });
      b.vol += vol; b.ns += ns; b.fsc += fsc;
      if (applied){ b.avol += vol; b.ans += ns; b.afsc += fsc; }
    }

    if (!used) throw new Error('No usable rows were found in Combined Data CPI Raw \u2014 '
      + 'every row needs a Year, a Month and a volume, revenue or surcharge figure.');

    var un = Object.keys(unknown);
    return { cells: cells, markets: markets, latest: latest || 1,
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
    var oi = {};
    other[0].forEach(function(h,i){ var k = norm_(h); if (k && !(k in oi)) oi[k] = i; });
    var oK = pick_(oi, ['lookup key','key']),
        oR = pick_(oi, ['other revenue','revenue']);
    if (oK < 0 || oR < 0)
      throw new Error('The Other Revenue export needs a LOOKUP KEY column and an Other Revenue column.');
    var map = {};
    for (var i = 1; i < other.length; i++){
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

  /* ---------- build the full page payload from a data bundle ---------- */
  function output_(D, win){
    var sask = applySask_(D);
    var ytd = []; for (var m = 1; m <= D.latest; m++) ytd.push(m);
    var mtd = [D.latest];
    var pairs = windowMonths_(D, win);

    var byMonth = {};
    D.markets.forEach(function(mk){ byMonth[mk] = byMonthFor_(D, mk, ytd); });

    return {
      markets:     D.markets,
      latestMonth: MONTHS[D.latest - 1],
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

  /* ---------- the two calls the page makes ---------- */
  function getFscData(opts){
    opts = opts || {};
    return output_(readData_(), opts.window || (opts.from ? opts : null));
  }
  /* The page may still send { combined, other } from the old two-file uploader;
     only the combined grid is used now, and a lone grid is accepted too. */
  function getFscDataFromUpload(p){
    var grid = p && (p.combined || p.grid || p.cpi);
    if (!grid) throw new Error('Upload the Combined CPI export.');
    return output_(readUpload_(grid, p.other), p.window || null);
  }

  return { getFscData: getFscData, getFscDataFromUpload: getFscDataFromUpload };
})();

/* Top-level wrappers the page calls via google.script.run.
   Logged so the Executions page always shows whether the call arrived. */
function getFscData(opts){
  try {
    console.log('[FSC] getFscData: start');
    var out = FSC.getFscData(opts);
    console.log('[FSC] getFscData: ok \u00b7 ' + out.markets.length + ' markets \u00b7 latest ' + out.latestMonth);
    return out;
  } catch (err) {
    console.error('[FSC] getFscData failed: ' + (err && err.message ? err.message : err));
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