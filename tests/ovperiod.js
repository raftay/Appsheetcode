/* tests/ovperiod.js — the Overview's Period control and its empty panels
 *
 *   npm install playwright
 *   node tests/ovperiod.js                 # checks
 *   node tests/ovperiod.js /tmp/shots      # …and a screenshot per case
 *   CHROMIUM_PATH=/path/to/chrome node tests/ovperiod.js
 *
 * WHY THIS EXISTS
 * Two changes to the Overview are only visible in a browser, and both fail
 * silently rather than loudly.
 *
 *   1. PERIOD NOW HAS FOUR SETTINGS. "Prev month (MTD)" and "Prev month (YTD)"
 *      are not server periods — they are spans on the month cube, so pressing
 *      one has to move the slider, light the right button, switch the page to
 *      local compute, AND leave the server payload on the matching MTD / YTD
 *      tab (Product Category reads it). A regression here does not throw: it
 *      quietly shows the wrong month's numbers, which is the exact bug the
 *      Product Category panel had.
 *
 *   2. A PANEL WITH NOTHING IN IT IS NOT SHOWN. There is no notice, no empty
 *      frame and no explanation anywhere on the page any more. The failure
 *      mode is a card that stays behind after the selection moved past it —
 *      again, no error, just a stale panel.
 *
 * So this boots the REAL page with google.script.run stubbed and a synthetic
 * month cube, presses each Period button, and reads what is on the page.
 * It is a wiring test, not a data test: the payloads are made up.
 *
 * IT RUNS TWICE, against the legacy Page_Overview.html and against app.html's
 * port of it (chunks 8-9), with the same fixture, the same clicks and the same
 * checks. That is what makes it a gate on the MERGE and not only on the page:
 * every failure names the side it happened on, so "both broke" and "the port
 * broke" cannot be confused. Delete the legacy side at chunk 13, when the file
 * it reads is gone.
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const SHOTS = process.argv[2] || '';

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  console.error('playwright is not installed where this script can see it.\n' +
    '  npm install playwright --prefix ' + REPO);
  process.exit(2);
}
function browserPath() {
  const env = process.env.CHROMIUM_PATH;
  if (env && fs.existsSync(env)) return env;
  for (const dir of ['/opt/pw-browsers', '/root/.cache/ms-playwright']) {
    if (!fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir)) {
      for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
        const p = path.join(dir, d, sub);
        if (/^chromium-/.test(d) && fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
function expand(src, depth) {
  return src.replace(/<\?!?=\s*include\('([^']+)'\)\s*\?>/g,
      (m, name) => (depth > 3 ? '' : expand(read(name + '.html'), (depth || 0) + 1)))
    /* app.html carries its server values in <body> data attributes, so they
       have to be filled rather than stripped — an empty data-page mounts
       nothing at all and the failure looks like a dead page. */
    .replace(/<\?!?=\s*page\s*\?>/g, 'overview')
    .replace(/<\?!?=\s*appUrl\s*\?>/g, 'https://script.google.com/macros/s/TEST/exec')
    .replace(/<\?!?=\s*appMode\s*\?>/g, 'false')
    .replace(/<\?[=!]?[\s\S]*?\?>/g, '');
}

/* The two sides. `merged` is app.html mounted on the overview route; it is the
   same file the live app serves, with the same stub spliced into its body. */
const SIDES = [
  { name: 'legacy', file: 'Page_Overview.html' },
  /* `shell` is chunk 8's marker and chunk 9 deletes it: the merged page has the
     period model, the month window and the cube but not the panel painters yet,
     so checks 1-2 run against it and 3-7 do not. It is here rather than absent
     because the four Period buttons ARE chunk 8's review, and they are only
     observable in a browser. */
  { name: 'merged', file: 'app.html', shell: true }
];

/* ---- the synthetic cube -------------------------------------------------
   Two years, eight months each, so the newest month is Aug-2025 and the month
   before it is Jul-2025 — the shape the real books are in when the Product
   Segment tabs are July's. Every month carries the same four rows, which is
   enough for every panel to have something to draw and keeps the arithmetic
   checkable by hand. */
const YMS = [];
for (let m = 1; m <= 8; m++) { YMS.push(202400 + m); YMS.push(202500 + m); }
YMS.sort((a, b) => a - b);

const AGG_DIMS = ['plant','material','plantType','matFam','prodClass','prodApp','custSeg','custParent','soldTo'];
const AGG_ROWS = [
  /* plant, material, plantType, matFam, prodClass, prodApp, custSeg, custParent, soldTo */
  [0,0,0,0,0,0,0,0,0],
  [0,1,0,1,1,0,1,1,0],
  [1,0,1,0,0,0,0,1,0],
  [1,1,1,1,1,0,1,0,0]
];
const AGG_DICT = {
  plant:['P1','P2'], material:['Sand 0-5','Stone 20mm'],
  plantType:['Pit','Quarry'], matFam:['Sand','Stone'], prodClass:['Class A','Class B'],
  prodApp:['General'], custSeg:['Residential','ICI'], custParent:['Alpha Corp','Beta Ltd'],
  soldTo:[''], market:['Southwest','North'], sm1:['SM One','SM Two'], sm2:[''], mb:['Land']
};
const RMX_DIMS = ['plant','mix','segment'];
const RMX_DICT = {
  plant:['R1','R2'], mix:['30 MPa','35 MPa'], segment:['ICI','Civil'],
  market:['HNS SW','North'], submarket:['RSM One','RSM Two'],
  strength:['30 MPa','35 MPa'], cls:['Standard','Special'], app:['Slab']
};

function aggCols() {
  const cols = { ym: [] };
  AGG_DIMS.concat(['v','r','fsc','fv']).forEach(f => cols[f] = []);
  YMS.forEach(ym => {
    const cy = ym > 202412;                       // 2025 is the current year
    AGG_ROWS.forEach((r, i) => {
      cols.ym.push(ym);
      AGG_DIMS.forEach((d, k) => cols[d].push(r[k]));
      const vol = 1000 + i * 100 + (cy ? 120 : 0);
      cols.v.push(vol);
      cols.r.push(vol * (cy ? 15.5 + i : 14.9 + i));   // ASP up year on year
      cols.fsc.push(cy ? 900 + i * 10 : 800 + i * 10);
      cols.fv.push(vol * 0.8);
    });
  });
  return cols;
}
function rmxCols() {
  const cols = { ym: [] };
  RMX_DIMS.concat(['v','r','ex','va']).forEach(f => cols[f] = []);
  const rows = [[0,0,0],[0,1,1],[1,0,0],[1,1,1]];
  YMS.forEach(ym => {
    const cy = ym > 202412;
    rows.forEach((r, i) => {
      cols.ym.push(ym);
      RMX_DIMS.forEach((d, k) => cols[d].push(r[k]));
      const vol = 500 + i * 50 + (cy ? 60 : 0);
      cols.v.push(vol);
      cols.r.push(vol * (cy ? 210 + i : 202 + i));
      cols.ex.push(vol * 12);
      cols.va.push(vol * 5);
    });
  });
  return cols;
}
const CUBE = {
  agg: { dims:AGG_DIMS, vals:['v','r','fsc','fv'], dict:AGG_DICT,
         plantMap:{ market:[0,1], sm1:[0,1], sm2:[0,0], mb:[0,0] }, mixMap:null,
         cols:aggCols() },
  rmx: { dims:RMX_DIMS, vals:['v','r','ex','va'], dict:RMX_DICT,
         plantMap:{ market:[0,1], submarket:[0,1] },
         mixMap:{ strength:[0,1], cls:[0,1], app:[0,0] }, cols:rmxCols() }
};

const MARKETS = [
  { key:'sw',    label:'Southwest', pvName:'Southwest', rmxName:'HNS SW' },
  { key:'north', label:'North',     pvName:'North',     rmxName:'North' }
];

/* Chart.js and its datalabels plugin come off a CDN, which this harness has no
   business reaching. Every panel here is judged by its TABLE and by whether its
   card is on the page, so the charts only have to exist and be destroyable —
   but they do have to not throw, because a chart that throws aborts the painter
   around it and leaves exactly the kind of stale panel this test is looking for. */
const STUB = `
<script>
window.Chart = function(canvas, cfg){ this.canvas=canvas; this.config=cfg; };
window.Chart.prototype.destroy = function(){};
window.Chart.register = function(){};
window.ChartDataLabels = { id:'datalabels' };
/* app.html loads Chart.js and SheetJS through AmrLib, which injects a
   <script src> and AWAITS its onload before boot(). Off the network that
   promise never settles and the page never boots — which reads as a dead
   port rather than as a missing CDN. Resolve every injected script at once;
   the stubs above are what the checks actually run against, on both sides. */
(function(){
  var create = document.createElement.bind(document);
  document.createElement = function(tag){
    var el = create(tag);
    if(String(tag).toLowerCase() === 'script'){
      var src = '';
      Object.defineProperty(el, 'src', {
        get:function(){ return src; },
        set:function(v){ src = v; setTimeout(function(){ el.onload && el.onload(); }, 0); }
      });
    }
    return el;
  };
})();
window.__CALLS = [];
window.__CUBE = ${JSON.stringify(CUBE)};
window.__YMS  = ${JSON.stringify(YMS)};
window.google = { script: { run: (function(){
  var MARKETS = ${JSON.stringify(MARKETS)};
  function mkt(seed){
    return { present:true, cyVol:1000+seed, pyVol:900+seed, cyRev:16000+seed, pyRev:14000+seed,
             cyAsp:16+seed/100, pyAsp:15+seed/100, aspPct:.06, volPct:.11, ppi:.04 };
  }
  function overview(o){
    var period=(o&&o.period==='YTD')?'YTD':'MTD';
    var pv={}, rmx={}, prodMk={};
    MARKETS.forEach(function(m,i){
      pv[m.key]=mkt(i*10);
      rmx[m.key]={ present:true, cyVol:900+i, pyVol:800+i, baseCY:180000, basePY:160000,
                   aspBaseCY:200, aspBasePY:195, aspIncBase:.026, volPct:.12,
                   rfiBase:1, facBase:.03, ppiBase:.03, sub:[], dims:{} };
      /* The two periods carry DIFFERENT volumes on purpose. Product Category
         is the panel that reads the server payload while the page is on a
         Prev-month span, so PICK_SERVER is what decides which tab it gets —
         and with one number for both periods, swapping PMTD and PYTD in
         PICK_SERVER passed this harness clean. Check 4 reads these figures. */
      var v1 = (period==='MTD') ? 310037 : 410037;
      var v2 = (period==='MTD') ? 545411 : 645411;
      prodMk[m.key]=[
        { typ:'VAP', cat:'Performance', tk:'vap', ck:'performance', total:false,
          cyVol:v1, pyVol:328000, cyRev:77e6, pyRev:84e6, cyCm2W:17e6, pyCm2W:22e6 },
        { typ:'VAP', cat:'Total', tk:'vap', ck:'total', total:true,
          cyVol:v2, pyVol:592000, cyRev:138e6, pyRev:152e6, cyCm2W:31e6, pyCm2W:39e6 }
      ];
    });
    return { ok:true, period:period, markets:MARKETS, pv:pv, rmx:rmx,
      aggAll:{ cyVol:2000, pyVol:1800, cyAsp:16, pyAsp:15, aspPct:.06, volPct:.11, ppi:.04 },
      bridges:{ all:{ rev:null, asp:{ ppi:.04, items:[{label:'Region / Market mix',value:.01}], totalAsp:.06 } }, byKey:{} },
      seg:{ ok:true, monthIdx:7, markets:{}, unmatched:[] },
      /* the Slide tabs are ALWAYS last month's — July here, while the fact
         table already runs to August. That gap is the whole point. */
      prodCat:{ ok:true, monthIdx:7, markets:prodMk, missing:[] },
      errors:{}, unmatched:{ pv:[] }, generation:'g1' };
  }
  function make(h){
    function reply(name, fn){
      return function(o){ window.__CALLS.push([name, o]);
        var r = fn(o || {}); setTimeout(function(){ h.s && h.s(r); }, 0); };
    }
    return {
      withSuccessHandler:function(f){ return make({s:f, f:h.f}); },
      withFailureHandler:function(f){ return make({s:h.s, f:f}); },
      getOverview:      reply('getOverview', overview),
      getDataVersions:  reply('getDataVersions', function(){
        return { generations:{ pricevolume:'p1', rmx:'r1', segment:'s1' } }; }),
      CUBE_getManifest: reply('CUBE_getManifest', function(o){
        var want=(o.lines&&o.lines.length)?o.lines:['agg','rmx'], out={ ok:true, gen:'c1', lines:{}, errors:{} };
        want.forEach(function(l){
          var c=window.__CUBE[l];
          out.lines[l]={ ok:true, gen:'c1', line:l, ym:window.__YMS,
            dims:c.dims, vals:c.vals,
            chunks:[{ i:0, from:window.__YMS[0], to:window.__YMS[window.__YMS.length-1], rows:c.cols.ym.length }],
            dict:c.dict, plantMap:c.plantMap, mixMap:c.mixMap, revType:null,
            coverage:{ minVol:0, minRev:0 }, skipped:0, history:true,
            /* one closed-year book, already built: nothing for the page to read
               in the background, so the boot screen can come down */
            eras:[{ id:'h1', label:'2024 book', linked:true, built:true }],
            floor:0, unmapped:{} };
        });
        return out; }),
      CUBE_getChunk:    reply('CUBE_getChunk', function(o){
        return { ok:true, gen:'c1', line:o.line, i:0, cols:window.__CUBE[o.line].cols }; }),
      getReport:        reply('getReport', function(){ return { ok:true, tables:[] }; }),
      getCustomerReport:reply('getCustomerReport', function(o){
        function cust(label, seed){
          return { label:label, cyVol:5000-seed, pyVol:4600-seed, cyRev:78000-seed, pyRev:69000-seed,
                   cyRevPpi:78000-seed, factorCy:2800-seed, cyFsc:900-seed, pyFsc:820-seed,
                   children:[{ label:'ICI', cyVol:2500, pyVol:2300, cyRev:39000, pyRev:34500,
                               cyRevPpi:39000, factorCy:1400, cyFsc:450, pyFsc:410 }] };
        }
        return { ok:true, rows:[cust('Alpha Corp',0), cust('Beta Ltd',400), cust('Gamma Inc',800)] }; }),
      getFscData:       reply('getFscData', function(){
        return { latestMonth:8, unknownPlants:[], summary:{ MTD:[
          { market:'Southwest', totalFSC:12000, fscT2026:1.2, fscT2025:1.1, yoy:.1 },
          { market:'Total', isTotal:true, totalFSC:12000, fscT2026:1.2, fscT2025:1.1, yoy:.1 }
        ], YTD:[] } }; }),
      getRmxCrossReport:reply('getRmxCrossReport', function(){
        return { ok:true, totals:{ present:true, cyVol:900, pyVol:800, cyAsp:200, pyAsp:195,
                 aspPct:.026, volPct:.12, ppi:.03 }, tables:[], asp:null, byType:null, options:{} }; }),
      getCrossData:     reply('getCrossData', function(){ return { ok:false }; }),
      getRmxFscFacts:   reply('getRmxFscFacts', function(){
        return { ok:true, cyYear:2025, pyYear:2024, latestMonth:8,
                 cols:['plantId','segmentId','year','month','m3','grossM3','appliedM3','fsc'],
                 plantCols:['plant','market','submarket'],
                 plants:[['R1','HNS SW','RSM One'],['R2','North','RSM Two']],
                 segments:['ICI','Civil'],
                 rows:[[0,0,2025,7,500,520,480,4800],[0,0,2024,7,470,500,450,4200],
                       [1,1,2025,8,400,420,380,3800],[1,1,2024,8,380,400,360,3300]] }; }),
      getLogo:          reply('getLogo', function(){ return ''; }),
      getGuideImages:   reply('getGuideImages', function(){ return []; }),
      getKpiValues:     reply('getKpiValues', function(){ return { generation:'k1', values:null }; })
    };
  }
  return make({});
})() } };
document.addEventListener('DOMContentLoaded', function(){
  if(!window.AmrKpi) return;
  AmrKpi.load = function(cb){ cb && cb(null); };      // no EBITDA workbook in this run
  AmrKpi.files = function(){ return { main:null, mbsk:null }; };
});
</script>`;

/* ---- what the page should look like, per Period button ------------------ */
const IN_BROWSER = {
  /* everything the checks need, read out of the live DOM in one go */
  snap: () => {
    const vis = el => !!(el && el.offsetParent !== null);
    const panel = id => {
      const p = document.getElementById(id);
      return { there: !!p, shown: vis(p), text: p ? (p.textContent || '').trim() : '' };
    };
    const seg = [].map.call(document.querySelectorAll('#periodSeg button'), b => ({
      k: b.dataset.period, label: b.textContent.trim(),
      on: b.getAttribute('aria-pressed') === 'true', off: !!b.disabled
    }));
    const ids = ['colAggTrend','colAggKpi','colAgg','colDims','colBridge','colExplore','colCust',
                 'colFsc','colFscCust','colRmxTrend','colRmxKpi','colRmx','colRmxDims',
                 'colProdCat','colRmxAsp','colRmxFuel','colExtras'];
    const panels = {};
    ids.forEach(id => panels[id] = panel(id));
    return {
      seg: seg,
      win: (document.getElementById('winVal') || {}).textContent || '',
      winN: (document.getElementById('winN') || {}).textContent || '',
      panels: panels,
      /* any visible text that explains an absence is a regression by itself */
      excuses: [].filter.call(document.querySelectorAll('.ov-notice, .ov-exempt'), n => vis(n))
                 .map(n => (n.textContent || '').trim().slice(0, 90)),
      aspCol: vis(document.getElementById('aspCol')),
      tables: {
        cust: document.querySelectorAll('#custBody table tr').length,
        exp: document.querySelectorAll('#expBody table tr').length,
        pcat: document.querySelectorAll('#pcatBody table tr').length,
        fsc: document.querySelectorAll('#fscBody table tr').length,
        rmxAsp: document.querySelectorAll('#rmxAspBody table tr').length
      },
      canvases: [].map.call(document.querySelectorAll('canvas'), c => c.id).filter(Boolean)
    };
  }
};

async function run(side, browser, allFails) {
  const pg = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  const tmp = path.join(require('os').tmpdir(), 'amr_overview_' + side.name + '.html');
  /* The stub goes straight after the real <body …> tag. Two traps, both hit:
     app.html's tag carries the data attributes §D reads, so it cannot be
     matched as a bare "<body>"; and its <head> comment DESCRIBES a body tag in
     prose, so the first match in the file is inside a comment and the whole
     stub lands commented out — which reads as a page that boots and does
     nothing. So: search after </head>, and check the tag really is the
     element. merge.js learned the same lesson twice. */
  const raw = expand(read(side.file), 0);
  const head = raw.indexOf('</head>');
  if (head < 0) throw new Error(side.file + ': no </head>');
  const tag = raw.slice(head).match(/<body[^>]*>/);
  if (!tag) throw new Error(side.file + ': no <body> element after </head>');
  const at = head + tag.index + tag[0].length;
  const html = raw.slice(0, at) + STUB + raw.slice(at);
  fs.writeFileSync(tmp, html);
  if (process.env.DBG) pg.on('console', m => console.log('[' + side.name + ' console]', m.text().slice(0, 200)));
  await pg.goto('file://' + tmp, { waitUntil: 'load' });
  await pg.waitForTimeout(1500);
  /* DBG=1 prints where the boot got to. Worth having: when this file fails at
     the very first click it is almost always the loading screen still up over
     the page, which looks nothing like the failure it actually is. */
  if (process.env.DBG) {
    console.log(JSON.stringify(await pg.evaluate(() => ({
      calls: window.__CALLS.map(c => c[0]),
      boot: window.AmrBoot && window.AmrBoot.waiting(),
      finished: window.AmrBoot && window.AmrBoot.finished(),
      cube: window.AmrCube && window.AmrCube.progress && window.AmrCube.progress(),
      man: !!(window.AmrCube && window.AmrCube.manifest && window.AmrCube.manifest('agg')),
      winVal: (document.getElementById('winVal')||{}).textContent
    })), null, 1));
  }

  const fails = [];
  const bad = m => fails.push(side.name + ': ' + m);
  const snap = () => pg.evaluate('(' + IN_BROWSER.snap.toString() + ')()');
  async function press(kind) {
    await pg.click('#periodSeg button[data-period="' + kind + '"]');
    await pg.waitForTimeout(650);
    return snap();
  }
  async function tab(which) {
    await pg.click('#ovTabs button[data-tab="' + which + '"]');
    await pg.waitForTimeout(650);
    return snap();
  }

  /* ---- 1. the control itself ---- */
  let s = await snap();
  const keys = s.seg.map(b => b.k).join(',');
  if (keys !== 'MTD,YTD,PMTD,PYTD') bad('Period buttons are [' + keys + '], expected MTD,YTD,PMTD,PYTD');
  const pressed = s.seg.filter(b => b.on).map(b => b.k);
  if (pressed.join(',') !== 'MTD') bad('on open, pressed = [' + pressed + '], expected MTD alone');
  if (s.seg.some(b => b.off)) bad('a Period button is still disabled once the cube has landed: '
    + s.seg.filter(b => b.off).map(b => b.k));

  /* ---- 2. Prev month moves the slider to the month before the newest ---- */
  s = await press('PMTD');
  if (!s.seg.find(b => b.k === 'PMTD').on) bad('pressing Prev month (MTD) did not light its button');
  if (s.win.replace(/\s+/g, ' ') !== 'Jul 2025→Jul 2025') bad('Prev month (MTD) window is "' + s.win + '", expected Jul 2025→Jul 2025');
  if (!/= Prev month/.test(s.winN)) bad('the slider does not name the Prev-month span: "' + s.winN + '"');

  s = await press('PYTD');
  if (s.win.replace(/\s+/g, ' ') !== 'Jan 2025→Jul 2025') bad('Prev month (YTD) window is "' + s.win + '", expected Jan 2025→Jul 2025');

  s = await press('MTD');
  if (s.win.replace(/\s+/g, ' ') !== 'Aug 2025→Aug 2025') bad('This month window is "' + s.win + '", expected Aug 2025→Aug 2025');

  /* Chunk 8 stops here: everything below reads a panel, and the painters are
     chunk 9. Delete these three lines with the `shell` flag above. */
  if (side.shell) { await pg.close(); allFails.push.apply(allFails, fails); return; }

  /* ---- 3. no panel anywhere ever explains itself ---- */
  for (const k of ['MTD','YTD','PMTD','PYTD']) {
    const t = await press(k);
    if (t.excuses.length) bad(k + ': a visible notice survives — ' + JSON.stringify(t.excuses));
    const rmxTab = await tab('rmx');
    if (rmxTab.excuses.length) bad(k + ' (Ready-Mix): a visible notice survives — ' + JSON.stringify(rmxTab.excuses));
    await tab('agg');
  }

  /* ---- 4. Product Category is a Prev-month panel and nothing else ---- */
  const pcat = {};
  for (const k of ['MTD','YTD','PMTD','PYTD']) {
    await press(k);
    pcat[k] = (await tab('rmx')).panels.colProdCat;
    await tab('agg');
  }
  if (pcat.MTD.shown) bad('Product category is showing under This month — its tabs are last month\'s');
  if (pcat.YTD.shown) bad('Product category is showing under Year to date');
  if (!pcat.PMTD.shown) bad('Product category is NOT showing under Prev month (MTD)');
  if (!pcat.PYTD.shown) bad('Product category is NOT showing under Prev month (YTD)');
  /* …and it must be showing the RIGHT tab. A Prev-month pick is a cube span,
     but this one panel still reads the server payload, and PICK_SERVER is the
     only thing that says which of MTD / YTD that is. The fixture gives the two
     periods different volumes so the wrong tab is visible rather than
     plausible — swapping PMTD and PYTD in PICK_SERVER used to pass. */
  /* All markets is the default, so the panel shows the two markets merged —
     620,074 is the MTD tab and 820,074 the YTD one. */
  if (pcat.PMTD.shown && !(/620,074/.test(pcat.PMTD.text) && !/820,074/.test(pcat.PMTD.text)))
    bad('Prev month (MTD) shows Product Category off the wrong tab — expected the MTD payload');
  if (pcat.PYTD.shown && !(/820,074/.test(pcat.PYTD.text) && !/620,074/.test(pcat.PYTD.text)))
    bad('Prev month (YTD) shows Product Category off the wrong tab — expected the YTD payload');

  /* ---- 5. plants, materials, customers and the bridges answer for a
             Prev-month span, which is a cube span, not a server one ---- */
  await press('PMTD');
  s = await snap();
  if (!s.panels.colExplore.shown) bad('Prev month: Plants & materials is not shown');
  if (s.tables.exp < 4) bad('Prev month: the plants/materials tables are empty (' + s.tables.exp + ' rows)');
  if (!s.panels.colCust.shown) bad('Prev month: Top 10 customers is not shown');
  if (s.tables.cust < 2) bad('Prev month: the customer table is empty (' + s.tables.cust + ' rows)');
  if (!s.panels.colBridge.shown) bad('Prev month: Growth bridges is not shown');
  if (!s.aspCol) bad('Prev month: the ASP % growth bridge is missing');
  if (s.canvases.indexOf('br_asp') === -1) bad('Prev month: the ASP bridge canvas was never drawn');
  if (!s.panels.colFsc.shown) bad('Prev month: Fuel surcharge is not shown for a current-year window');
  if (s.tables.fsc < 2) bad('Prev month: the fuel-surcharge table is empty');
  if (s.panels.colAggKpi.shown) bad('Prev month: the SAP / USGAAP cards are showing for a cube span');
  /* one month is not a trend */
  if (s.panels.colAggTrend.shown) bad('Prev month (a single month): Month by month is still on the page');

  /* the Ready-Mix ASP build-up is extras + VAP over one denominator, and both
     are columns in the fact table */
  const r = await tab('rmx');
  if (!r.panels.colRmxAsp.shown) bad('Prev month: the ASP build-up is not shown');
  if (r.tables.rmxAsp < 4) bad('Prev month: the ASP build-up table is empty');
  if (r.panels.colExtras.shown) bad('Prev month: Extras & VAP by type is showing — the extra type is not in the cube');
  if (r.panels.colRmxFuel.shown) bad('Prev month: Fuel recovery is showing — its facts are a separate server table');
  /* a stale trend is the quiet failure: the panel keeps whatever span it was
     last painted for unless the window path repaints it too */
  if (r.panels.colRmxTrend.shown) bad('Prev month (a single month): Ready-Mix Month by month is still on the page');
  await tab('agg');

  /* ---- 6. an older year drops the surcharge panels and keeps the rest ---- */
  await pg.evaluate(() => {
    const q = [].find.call(document.querySelectorAll('#winQuick button'), b => b.textContent.trim() === '2024');
    q && q.click();
  });
  await pg.waitForTimeout(700);
  s = await snap();
  if (s.panels.colFsc.shown) bad('a 2024 window still shows Fuel surcharge — its columns are a live-book field');
  if (s.panels.colFscCust.shown) bad('a 2024 window still shows the surcharge customers panel');
  if (!s.panels.colAgg.shown) bad('a 2024 window lost the market breakdown, which the cube can answer');
  if (s.excuses.length) bad('2024 window: a visible notice survives — ' + JSON.stringify(s.excuses));

  /* ---- 7. and pressing a server period brings everything back ---- */
  s = await press('YTD');
  if (!s.panels.colCust.shown) bad('YTD: Top 10 customers did not come back after a window');
  if (!s.panels.colAggTrend.shown) bad('YTD: Month by month did not come back after a single-month window');
  /* no EBITDA workbook is uploaded in this run, and the server report here
     carries no plant or material rows: both cards go, heading and all */
  if (s.panels.colAggKpi.shown) bad('YTD: the SAP / USGAAP card is on the page with no workbook behind it');
  if (s.panels.colExplore.shown) bad('YTD: Plants & materials is on the page with no rows in it');

  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const shot = n => path.join(SHOTS, side.name + '-' + n + '.png');
    await pg.screenshot({ path: shot('overview-ytd'), fullPage: true });
    await press('PMTD');
    await pg.screenshot({ path: shot('overview-prevmonth'), fullPage: true });
    await tab('rmx');
    await pg.screenshot({ path: shot('overview-prevmonth-rmx'), fullPage: true });
  }

  await pg.close();
  if (errs.length) fails.unshift(side.name + ': page errors: ' + JSON.stringify(errs.slice(0, 4)));
  allFails.push.apply(allFails, fails);
}

(async () => {
  const exe = browserPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const fails = [];
  for (const side of SIDES) {
    if (!fs.existsSync(path.join(REPO, side.file))) {
      fails.push(side.name + ': ' + side.file + ' is missing');
      continue;
    }
    await run(side, browser, fails);
  }
  await browser.close();

  if (fails.length) {
    console.error('\novperiod: ' + fails.length + ' problem(s)\n');
    fails.forEach(f => console.error('  ✗ ' + f));
    process.exit(1);
  }
  console.log('ovperiod: ok — ' + SIDES.map(s => s.name + (s.shell ? ' (shell only)' : '')).join(' + ') +
    ': four Period settings, Product Category on Prev month only, ' +
    'no panel left explaining itself.');
})();
