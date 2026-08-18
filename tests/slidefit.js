/* The AGG Price & Volume and Product Segment SLIDES, laid out in a real browser.
 *
 *   npm install playwright chart.js
 *   node tests/slidefit.js            # checks only
 *   node tests/slidefit.js /tmp/shots # …and write a PNG per case
 *
 * WHY THIS ONE NEEDS A BROWSER
 * jsdom has no layout: every clientWidth is 0, so `deckpath.js` can prove the
 * slide is ASSEMBLED but not that it FITS. Fitting is the whole job of
 * AmrPvSlide.fitSlide — it grows the KPI strip, the tables and the two
 * waterfalls into the frame's real height and width — and every way it can go
 * wrong is silent: a clipped PPI column, a grand-total row cut off at the
 * bottom, or a third of the picture left white. Those ship as a picture nobody
 * can restyle afterwards.
 *
 * So this harness builds the SAME block the Deck Builder builds
 * (AmrPvSlide.contentOffscreen) inside the SAME frame (AmrSlide.build, bare)
 * and runs the SAME fitter, then measures the result, over the frame shapes
 * and payloads the deck actually produces:
 *
 *   deck        a L_COMMENT_IMAGE-shaped slot        (1600 x 1030)
 *   page        the report page's own slide, header + comment bands (1600x900)
 *   deck-short  a short, wide slot                   (1600 x 700)
 *   deck-tall   a tall slot                          (1600 x 1200)
 *   deck-cc     Central Canada — five markets in the first table
 *   deck-nokpi  Manitoba / Saskatchewan — no EBITDA workbook, no KPI strip
 *
 * What it asserts, per case:
 *   · no table is clipped by its card (the PPI column bug)
 *   · no KPI card clips its own text
 *   · the table stack does not overflow the row, and the content does not
 *     overflow the frame (which would make AmrSlide.build scale it a second time)
 *   · no white band under the tables or under the charts
 *   · the bottom of the lower chart lines up with the bottom of the last table
 *
 * The Product Segment slide (AmrSegSlide.fitSlide) gets the same treatment for
 * its own KPI strip, which grows the same way: it must not clip a card and must
 * not push the slide past its frame.
 *
 * The web fonts are NOT vendored, so it runs in whatever sans the machine has.
 * Every check is a relationship between measured boxes, so it holds either way;
 * only the exact font sizes it prints will differ from production.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const SHOTS = process.argv[2] || '';

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  console.error('playwright is not installed where this script can see it.\n' +
    '  npm install playwright chart.js --prefix ' + REPO + '\n' +
    'It needs a Chromium build too: npx playwright install chromium');
  process.exit(2);
}

/* A browser Playwright can drive: its own download, or one already on the box
   (this repo is often worked on in a container that ships Chromium). */
function browserPath() {
  const env = process.env.CHROMIUM_PATH;
  if (env && fs.existsSync(env)) return env;
  for (const dir of ['/opt/pw-browsers', '/root/.cache/ms-playwright']) {
    if (!fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir)) {
      const p = path.join(dir, d, 'chrome-linux', 'chrome');
      if (/^chromium-/.test(d) && fs.existsSync(p)) return p;
    }
  }
  return null;                       // let Playwright use its own
}

/* app.html off disk, the deleted legacy files out of git — see apphtml.js. */
const read = require('./apphtml.js').source;
const strip = s => s.replace(/<\?!?=?[\s\S]*?\?>/g, '');      // <?!= include(...) ?>
const styleOf = f => (read(f).match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];

const CHARTJS = path.join(REPO, 'node_modules/chart.js/dist/chart.umd.js');
if (!fs.existsSync(CHARTJS)) {
  console.error('chart.js is not installed: npm install chart.js --prefix ' + REPO);
  process.exit(2);
}

/* One market, shaped like a real getReport payload: three dimension tables,
   the revenue bridge and the price bridge. */
const PVREPORT = {
  period: 'MTD', filterValue: 'Windsor', latestMonth: 7,
  tables: [
    { dimension: 'Submarket', volMix: 0.002, rows: [
      { label:'Windsor Essex', cyVol:75745, pyVol:64529, volPct:-0.164, cyAsp:26.82, pyAsp:29.02, aspPct:-0.014, ppi:0.008 },
      { label:'Sarnia',        cyVol:33962, pyVol:34126, volPct:-0.005, cyAsp:31.44, pyAsp:33.59, aspPct:-0.064, ppi:0.006 } ],
      total:{ cyVol:109707, pyVol:118656, volPct:-0.075, cyAsp:29.50, pyAsp:30.33, aspPct:-0.028, ppi:0.007 } },
    { dimension: 'Plant Type', volMix: -0.013, rows: [
      { label:'Aggregate Depot', cyVol:82621, pyVol:65452, volPct:0.262, cyAsp:29.09, pyAsp:30.90, aspPct:-0.058, ppi:-0.006 },
      { label:'Resale',          cyVol:27086, pyVol:53204, volPct:-0.491, cyAsp:30.72, pyAsp:29.64, aspPct:0.037, ppi:0.069 } ],
      total:{ cyVol:109707, pyVol:118656, volPct:-0.075, cyAsp:29.50, pyAsp:30.33, aspPct:-0.028, ppi:0.007 } },
    { dimension: 'Product Class', volMix: -0.084, rows: [
      { label:'Premium Granular', cyVol:43232, pyVol:26995, volPct:0.601, cyAsp:23.63, pyAsp:24.32, aspPct:-0.028, ppi:-0.016 },
      { label:'Clears',           cyVol:37040, pyVol:64961, volPct:-0.430, cyAsp:34.17, pyAsp:31.56, aspPct:-0.083, ppi:0.033 },
      { label:'Premium Sands',    cyVol:23539, pyVol:16821, volPct:0.399, cyAsp:30.43, pyAsp:27.36, aspPct:0.112, ppi:-0.003 },
      { label:'Other',            cyVol:3972,  pyVol:9218,  volPct:-0.569, cyAsp:45.22, pyAsp:45.20, aspPct:-0.001, ppi:-0.009 },
      { label:'Oversize',         cyVol:1741,  pyVol:441,   volPct:2.946, cyAsp:28.30, pyAsp:27.60, aspPct:-0.025, ppi:0.025 },
      { label:'Granular & Fills', cyVol:183,   pyVol:221,   volPct:-1.710, cyAsp:38.67, pyAsp:17.00, aspPct:-0.098, ppi:0.094 } ],
      total:{ cyVol:109707, pyVol:118656, volPct:-0.075, cyAsp:29.50, pyAsp:30.33, aspPct:-0.028, ppi:0.007 } }
  ],
  revenueBridge:{ pyRev:3598390, volImpact:-271438, priceImpact:-91980, cyRev:3235864 },
  priceBridge:{ ppi:0.007, totalAsp:-0.028, items:[
    { label:'Region/Market mix', value:0.001 }, { label:'Geology mix', value:-0.009 },
    { label:'Plant type mix', value:-0.011 },   { label:'Prod class mix', value:-0.084 },
    { label:'Customer mix', value:0.008 } ] }
};

/* the rollup slide: cut by MARKET, so the first table is five rows deep */
const CC = JSON.parse(JSON.stringify(PVREPORT));
CC.tables[0] = { dimension: 'Market', volMix: 0.004, rows: [
    { label:'GTA', cyVol:1282643, pyVol:1390172, volPct:-0.077, cyAsp:15.10, pyAsp:14.47, aspPct:0.044, ppi:0.026 },
    { label:'Southwest Ontario', cyVol:409707, pyVol:418656, volPct:-0.021, cyAsp:29.50, pyAsp:30.33, aspPct:-0.028, ppi:0.007 },
    { label:'Eastern Ontario', cyVol:309707, pyVol:318656, volPct:-0.028, cyAsp:19.50, pyAsp:20.33, aspPct:-0.041, ppi:0.011 },
    { label:'Manitoba', cyVol:209115, pyVol:215405, volPct:-0.029, cyAsp:22.14, pyAsp:21.02, aspPct:0.053, ppi:0.018 },
    { label:'Saskatchewan', cyVol:109707, pyVol:118656, volPct:-0.075, cyAsp:26.82, pyAsp:29.02, aspPct:-0.076, ppi:0.008 } ],
    total: PVREPORT.tables[0].total };

/* Styles.html + Deck_Styles.html is what the DECK sees; the page's own block is
   added because the framed (non-bare) case is the report page's slide, and the
   two are meant to be mirrors of each other. */
/* the Product Segment payload, shaped like RMX_getSlideTables.
   The deck's slide is TWO tables — Segment and By extra type — so the extras
   half has to be shaped the way extrasTypeTable() actually reads it
   (byTypeExtras / byTypeVap and their totals). It used to carry a made-up
   {extras, vap} shape that matched nothing, so extrasTypeTable returned null
   and every seg case here was silently a ONE-table slide: the case that broke
   in the July deck — two tall tables in a short, wide image box — was never
   being measured. Figures are the July 2026 Innocon slide. */
const SEGREP = { market:'Innocon', period:'MTD', latestMonth:7,
  segment:{
    total:{ cyVol:83324, pyVol:73398, volPct:.14, aspCY:229.07, aspPY:222.43, aspPct:.030 },
    rows:[
      { label:'ICI',             cyVol:33341, cyShare:.40, pyVol:21718, pyShare:.30, volPct:.54,  aspCY:196.71, aspPY:190.97, aspPct:.030 },
      { label:'Res - High Rise', cyVol:22940, cyShare:.28, pyVol:30004, pyShare:.41, volPct:-.24, aspCY:256.25, aspPY:259.21, aspPct:-.011 },
      { label:'Civil',           cyVol:13989, cyShare:.17, pyVol:8356,  pyShare:.11, volPct:.67,  aspCY:312.62, aspPY:261.51, aspPct:.195 },
      { label:'Specialty',       cyVol:7889,  cyShare:.09, pyVol:3829,  pyShare:.05, volPct:1.06, aspCY:173.41, aspPY:178.04, aspPct:-.026 },
      { label:'Res - Low Rise',  cyVol:4728,  cyShare:.06, pyVol:8842,  pyShare:.12, volPct:-.47, aspCY:170.57, aspPY:157.66, aspPct:.082 },
      { label:'COD',             cyVol:438,   cyShare:.01, pyVol:650,   pyShare:.01, volPct:-.33, aspCY:233.81, aspPY:215.70, aspPct:.084 } ] },
  extras:{
    byTypeExtras:[
      { label:'Cooling',         cyRev:2195484, pyRev:1415233, revPct:.551,  aspCY:26.35, aspPY:19.28, aspChg:7.07 },
      { label:'Standard Fees',   cyRev:851652,  pyRev:743222,  revPct:.146,  aspCY:10.22, aspPY:10.13, aspChg:0.10 },
      { label:'Misc',            cyRev:371062,  pyRev:170827,  revPct:1.172, aspCY:4.45,  aspPY:2.33,  aspChg:2.13 },
      { label:'Flex Fuel (FSC)', cyRev:354672,  pyRev:218141,  revPct:.626,  aspCY:4.26,  aspPY:2.97,  aspChg:1.28 },
      { label:'Winter Heat',     cyRev:-10,     pyRev:0,       revPct:0,     aspCY:0,     aspPY:0,     aspChg:0 } ],
    byTypeExtrasTotal:{ cyRev:3772860, pyRev:2547562, revPct:.481, aspCY:45.28, aspPY:34.71, aspChg:10.57 },
    byTypeVap:[
      { label:'Other VAP', cyRev:547078, pyRev:341295, revPct:.603,  aspCY:6.57, aspPY:4.65, aspChg:1.92 },
      { label:'Super P',   cyRev:290375, pyRev:538993, revPct:-.461, aspCY:3.48, aspPY:7.34, aspChg:-3.86 },
      { label:'Fibers',    cyRev:61333,  pyRev:32455,  revPct:.890,  aspCY:0.74, aspPY:0.44, aspChg:0.29 },
      { label:'Color',     cyRev:11270,  pyRev:19715,  revPct:-.428, aspCY:0.14, aspPY:0.27, aspChg:-0.13 },
      { label:'Temptect',  cyRev:0,      pyRev:2984,   revPct:-1,    aspCY:0,    aspPY:0.04, aspChg:-0.04 } ],
    byTypeVapTotal:{ cyRev:910056,  pyRev:935441,  revPct:-.027, aspCY:10.92, aspPY:12.74, aspChg:-1.82 },
    byTypeTotal:   { cyRev:4682916, pyRev:3483003, revPct:.345,  aspCY:56.20, aspPY:47.45, aspChg:8.75 },
    extras:[], vap:[] } };

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
${strip(read('Styles.html'))}
${strip(read('Deck_Styles.html'))}
<style>${styleOf('Page_PriceVolume.html')}</style>
<!-- the Product Segment page's own block: the NON-bare seg case is that page's
     slide, and .crow / .ccell / .ccap / table.gt live here. Deck_Styles.html
     only carries the .slide-bare copies, so without this the framed case was
     measured with unstyled tables falling back to the generic 10px/12px cell
     padding — 52px taller than the real thing, and nothing like what the page
     exports. -->
<style>${styleOf('Page_Segment.html')}</style>
<style>body{margin:0}</style>
</head><body>
<script>${fs.readFileSync(CHARTJS, 'utf8')}<\/script>
${strip(read('SlideExport.html'))}
${strip(read('KpiShared.html'))}
${strip(read('Deck_PV.html'))}
${strip(read('Deck_SEG.html'))}
<script>
window.__SEG = ${JSON.stringify(SEGREP)};
window.__renderSeg = function(w, h, bare){
  var ctx = { data: window.__SEG, market:'Innocon', period:'MTD',
              exportSel:{ 'seg:segment':true, 'seg:byType':true, 'seg:detail':false },
              kpi: AmrPvSlide.kpiFor({ok:1}, 'RMX_MARKET', 'Innocon') };
  var el = AmrSegSlide.content(ctx);
  var box = AmrSlide.build(el, { width:w, height:h, bare:!!bare,
    fit: function(b){ return AmrSegSlide.fitSlide(b, ctx); } });
  box.style.position = 'static'; box.style.left = 'auto';
  box.id = 'shot';
  document.body.appendChild(box);
};
window.__measureSeg = function(){
  var box = document.getElementById('shot');
  var center = box.querySelector('.slide-center');
  var krow = box.querySelector('.seg-kpi-row');
  var tabs = [].slice.call(box.querySelectorAll('table.gt'));
  var B = function(e){ return Math.round(e.getBoundingClientRect().bottom); };
  return {
    kpiFont: krow ? parseFloat(getComputedStyle(krow).fontSize) : 0,
    /* what the strip is worth in the FINISHED picture: build() scales the whole
       stack when it overflows, and that scale is what used to leave the strip
       at five effective pixels */
    kpiScaled: krow ? Math.round(parseFloat(getComputedStyle(krow).fontSize)
                      * (center.getBoundingClientRect().width / (center.offsetWidth || 1)) * 10) / 10 : 0,
    kpiClip: krow ? Math.max.apply(null, [0].concat([].map.call(krow.children,
      function(c){ return c.scrollWidth - c.clientWidth; }))) : 0,
    tables: tabs.length,
    tableFont: parseFloat(getComputedStyle(box.querySelector('table.gt')).fontSize),
    /* a table wider than the cell it sits in is a clipped column: .ccell hides
       the overflow, so the last column simply disappears off the picture */
    tableClip: Math.max.apply(null, [0].concat(tabs.map(function(t){
      var room = t.parentElement ? t.parentElement.clientWidth : 0;
      return room ? Math.round(t.getBoundingClientRect().width - room) : 0; }))),
    /* the caption sits at the very left of the block; a negative body margin
       used to push its first letter off the edge of the picture */
    capLeft: (function(){
      var c = box.querySelector('.ccap'); if(!c) return 99;
      return Math.round(c.getBoundingClientRect().left - box.getBoundingClientRect().left);
    })(),
    bodyB: B(center.parentElement),
    lastB: tabs.length ? B(tabs[tabs.length - 1]) : 0,
    centerH: center.parentElement.clientHeight, centerScroll: center.scrollHeight
  };
};
/* the real AmrKpi, with only the two workbook readers stubbed — stripHtml and
   fitStrip are the things under test */
window.AmrKpi.plantIndex = function(v){ return v ? [{label:'Central'}] : []; };
window.__AmrKpiStubs = {
  plantIndex: function(v){ return v ? [{label:'Central'}] : []; },
  plant: function(vals, entry){
    return entry ? { aspCy:18.63, aspPy:18.22, salesCy:12590, salesPy:12610,
                     volCy:676, volPy:690 } : null; },
  /* the Product Segment strip: units + three money cards */
  rmx: function(vals){
    return vals ? {
      units:{ cy:17.67, py:14.95 },
      rev:{ cy:4908, py:4086, cyU:277.71, pyU:273.37 },
      conc:{ cy:4211, py:3550, cyU:238.29, pyU:237.49 },
      raw:{ cy:2140, py:1770, cyU:121.09, pyU:118.42 }
    } : null; }
};
Object.keys(window.__AmrKpiStubs).forEach(function(k){
  window.AmrKpi[k] = window.__AmrKpiStubs[k];
});
/* THE ON-PAGE STRIP — the "KPIs" panel above the slide preview, and what
   Download KPI PNG photographs. Same cards, sized by AmrKpi rather than by a
   slide fitter. It is here because it fails the same way and only a browser
   can see it: every size in a card is em, the page set no font-size at all, so
   five cards were laid out against the 16px body font, clipped their own text
   and wrapped the fifth onto a line of its own. */
window.__renderStrip = function(w){
  var old = document.getElementById('striphost'); if(old) old.remove();
  var host = document.createElement('div');
  host.id = 'striphost';
  host.className = 'card';
  host.style.cssText = 'padding:14px;width:' + w + 'px;box-sizing:border-box';
  document.body.appendChild(host);
  var ctx = { slide: AmrPvSlide.SLIDE, data: window.__PV, period:'MTD', month:7,
              latestMonth:7, filterField:'MARKET', filterValue:'Windsor',
              kpi: AmrPvSlide.kpiFor({ok:1}, 'MARKET', 'Windsor') };
  host.innerHTML = AmrKpi.stripHtml(AmrPvSlide.kpiCardsHtml(ctx));
  AmrKpi.fitStrip(host.firstChild);
};
window.__measureStrip = function(){
  var row = document.getElementById('striphost').firstChild;
  var cards = [].slice.call(row.children);
  var tops = {}; cards.forEach(function(c){ tops[Math.round(c.getBoundingClientRect().top)] = 1; });
  return {
    font: parseFloat(getComputedStyle(row).fontSize),
    cards: cards.length,
    lines: Object.keys(tops).length,
    clip: Math.max.apply(null, [0].concat(cards.map(function(c){ return c.scrollWidth - c.clientWidth; }))),
    overflow: Math.round(row.scrollWidth - row.clientWidth)
  };
};
window.__PV = ${JSON.stringify(PVREPORT)};
window.__CC = ${JSON.stringify(CC)};
window.__render = function(w, h, bare, opt){
  opt = opt || {};
  var data = opt.cc ? window.__CC : window.__PV;
  var ctx = { slide: AmrPvSlide.SLIDE, data: data, period:'MTD', month:7,
              latestMonth:7, filterField:'MARKET', filterValue: opt.market || 'Windsor',
              kpi: AmrPvSlide.kpiFor(opt.noKpi ? null : {ok:1}, 'MARKET', opt.market || 'Windsor') };
  var el = AmrPvSlide.contentOffscreen(data, ctx);
  var o = { width:w, height:h, bare:!!bare,
            fit: function(box){ return AmrPvSlide.fitSlide(box, ctx); } };
  if(!bare){
    o.title = 'WINDSOR PRICE & VOLUME ANALYSIS (MTD)';
    o.subtitle = 'Volumes in tonnes / revenue in CAD';
    o.margins = { left:120, right:120, top:30, bottom:30 };
  }
  var box = AmrSlide.build(el, o);
  box.style.position = 'static'; box.style.left = 'auto';
  box.id = 'shot';
  document.body.appendChild(box);
};
/* every box the checks below are about, measured in the browser */
window.__measure = function(){
  var box = document.getElementById('shot'), q = function(s){ return box.querySelector(s); };
  var B = function(e){ return Math.round(e.getBoundingClientRect().bottom); };
  var center = q('.slide-center'), body = center.parentElement;
  var tabs = q('.pv-exp-tables'), charts = q('.pv-exp-charts');
  var kpis = q('.pv-exp-kpis'), row = q('.pv-exp-row'), inner = q('.pv-exp-tables-inner');
  var cards = [].slice.call(box.querySelectorAll('.tbl-card'));
  var imgs = [].slice.call(box.querySelectorAll('.pv-exp-charts img'));
  var over = [].map.call(box.querySelectorAll('.tbl-card table'), function(t){
    var pad = t.parentElement, cs = getComputedStyle(pad);
    return Math.round(t.offsetWidth - (pad.clientWidth
      - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)));
  });
  return {
    bodyB: B(body),
    kpiFont: kpis ? parseFloat(getComputedStyle(kpis).fontSize) : 0,
    kpiClip: kpis ? Math.max.apply(null, [0].concat([].map.call(kpis.children,
      function(c){ return c.scrollWidth - c.clientWidth; }))) : 0,
    tablesW: tabs.clientWidth, chartsW: charts ? charts.clientWidth : 0,
    rowH: row.clientHeight, stackH: inner.scrollHeight,
    lastCardB: B(cards[cards.length-1]), chartsB: charts ? B(charts) : 0,
    imgSize: imgs.length ? (imgs[0].width + 'x' + imgs[0].height) : '',
    imgCount: imgs.length,
    tableFont: parseFloat(getComputedStyle(box.querySelector('.tbl-card table')).fontSize),
    tableClip: Math.max.apply(null, [0].concat(over)),
    centerH: center.clientHeight, centerScroll: center.scrollHeight
  };
};
<\/script>
</body></html>`;

const CASES = [
  { name:'deck',       w:1600, h:1030, bare:true },
  { name:'page',       w:1600, h:900,  bare:false },
  { name:'deck-short', w:1600, h:700,  bare:true },
  { name:'deck-tall',  w:1600, h:1200, bare:true },
  { name:'deck-cc',    w:1600, h:1030, bare:true, opt:{ cc:true, market:'__ALL__' } },
  { name:'deck-nokpi', w:1600, h:1030, bare:true, opt:{ noKpi:true } },
];

/* how much white is allowed under a column, and how far the two columns may
   disagree about where the bottom is — a card's own bottom padding and a chart
   block's are not the same number, so this is a tolerance, not zero */
const SLACK = 28;

(async () => {
  const exe = browserPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const pg = await browser.newPage({ viewport: { width: 1700, height: 1300 } });
  const errors = [];
  pg.on('pageerror', e => errors.push(e.message));

  const file = path.join(require('os').tmpdir(), 'amr_pvslide.html');
  fs.writeFileSync(file, PAGE);
  await pg.goto('file://' + file, { waitUntil: 'load' });
  await pg.evaluate(() => document.fonts.ready);
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  let bad = 0;
  for (const c of CASES) {
    await pg.evaluate(() => { const o = document.getElementById('shot'); if (o) o.remove(); });
    /* build once so the fonts a KPI card asks for are loaded, throw it away,
       then build the one we measure — production always has them up already */
    await pg.evaluate(a => window.__render(a[0], a[1], a[2], a[3]), [c.w, c.h, c.bare, c.opt || {}]);
    await pg.evaluate(() => document.fonts.ready);
    await pg.evaluate(() => document.getElementById('shot').remove());
    await pg.evaluate(a => window.__render(a[0], a[1], a[2], a[3]), [c.w, c.h, c.bare, c.opt || {}]);
    if (SHOTS) await (await pg.$('#shot')).screenshot({ path: path.join(SHOTS, 'pv_' + c.name + '.png') });

    const m = await pg.evaluate(() => window.__measure());
    const fail = [];
    if (m.imgCount !== 2) fail.push('expected 2 charts, got ' + m.imgCount);
    if (m.tableClip > 1) fail.push('a table is clipped by its card by ' + m.tableClip + 'px');
    if (m.kpiClip > 0) fail.push('a KPI card clips its own text by ' + m.kpiClip + 'px');
    if (m.stackH > m.rowH + 1) fail.push('the tables overflow the row by ' + (m.stackH - m.rowH) + 'px');
    if (m.centerScroll > m.centerH + 1) fail.push('the content overflows the frame by ' +
      (m.centerScroll - m.centerH) + 'px — build() will scale it a second time');
    if (m.bodyB - m.lastCardB > SLACK) fail.push('white band under the tables: ' + (m.bodyB - m.lastCardB) + 'px');
    if (m.chartsB && m.bodyB - m.chartsB > SLACK) fail.push('white band under the charts: ' + (m.bodyB - m.chartsB) + 'px');
    if (m.chartsB && Math.abs(m.chartsB - m.lastCardB) > SLACK)
      fail.push('the two columns end ' + Math.abs(m.chartsB - m.lastCardB) + 'px apart');

    console.log((fail.length ? 'FAIL ' : 'ok   ') + c.name.padEnd(11) +
      ' table=' + m.tableFont + 'px kpi=' + m.kpiFont + 'px' +
      ' cols=' + m.tablesW + '+' + m.chartsW + ' chart=' + m.imgSize +
      ' rowH=' + m.rowH + ' stack=' + m.stackH);
    if (fail.length) { bad++; console.log('       ' + fail.join('\n       ')); }
  }
  /* ---- Product Segment: the same frame, its own fitter -------------------
     THE SHORT, WIDE CASE IS THE ONE THAT MATTERS. A L_COMMENT_IMAGE slot is
     wider than it is tall, so the frame the deck captures into is short — and
     two full tables plus a KPI strip do not fit in it by accident. The old
     fitter grew the tables on WIDTH alone to a 30px cap and let AmrSlide.build
     scale the overflow away, which took the KPI strip down with it. */
  for (const c of [{ name:'seg',        w:1600, h:1030, bare:true },
                   { name:'seg-short',  w:1600, h:700,  bare:true },
                   { name:'seg-squat',  w:1600, h:560,  bare:true },
                   { name:'seg-page',   w:1600, h:900,  bare:false }]) {
    await pg.evaluate(() => { const o = document.getElementById('shot'); if (o) o.remove(); });
    await pg.evaluate(a => window.__renderSeg(a[0], a[1], a[2]), [c.w, c.h, c.bare]);
    await pg.evaluate(() => document.fonts.ready);
    await pg.evaluate(() => document.getElementById('shot').remove());
    await pg.evaluate(a => window.__renderSeg(a[0], a[1], a[2]), [c.w, c.h, c.bare]);
    if (SHOTS) await (await pg.$('#shot')).screenshot({ path: path.join(SHOTS, 'pv_' + c.name + '.png') });

    const m = await pg.evaluate(() => window.__measureSeg());
    const fail = [];
    if (m.tables !== 2) fail.push('expected the Segment + By-extra-type pair, got ' + m.tables + ' table(s)');
    if (!m.kpiFont) fail.push('no KPI strip');
    if (m.kpiFont && m.kpiFont < 10) fail.push('the KPI strip shrank below its old size');
    if (m.kpiClip > 0) fail.push('a KPI card clips its own text by ' + m.kpiClip + 'px');
    if (m.tableClip > 1) fail.push('a table is clipped by its cell by ' + m.tableClip + 'px');
    if (m.centerScroll > m.centerH) fail.push('the content overflows the frame by ' +
      (m.centerScroll - m.centerH) + 'px — build() will scale it a second time');
    /* the second scale is the actual defect: it is what shrank a 10px strip to
       five effective pixels on the July deck's slides */
    if (m.kpiScaled && m.kpiScaled < m.kpiFont - 0.2) fail.push(
      'the strip was scaled down to ' + m.kpiScaled + 'px after being fitted at ' + m.kpiFont + 'px');
    if (m.capLeft < 1) fail.push('the table caption starts at the picture edge and loses its first letter');
    if (m.bodyB - m.lastB > SLACK) fail.push('white band under the tables: ' + (m.bodyB - m.lastB) + 'px');
    console.log((fail.length ? 'FAIL ' : 'ok   ') + c.name.padEnd(11) +
      ' table=' + m.tableFont + 'px kpi=' + m.kpiFont + 'px tables=' + m.tables +
      ' cap@' + m.capLeft + ' slack=' + (m.bodyB - m.lastB));
    if (fail.length) { bad++; console.log('       ' + fail.join('\n       ')); }
  }

  /* ---- the on-page KPI strip, at the widths a report page actually has ---- */
  for (const w of [1100, 900, 1400]) {
    await pg.evaluate(x => window.__renderStrip(x), w);
    await pg.evaluate(() => document.fonts.ready);
    await pg.evaluate(x => window.__renderStrip(x), w);
    if (SHOTS) await (await pg.$('#striphost')).screenshot({ path: path.join(SHOTS, 'kpistrip_' + w + '.png') });
    const m = await pg.evaluate(() => window.__measureStrip());
    const fail = [];
    if (m.cards !== 5) fail.push('expected 5 cards, got ' + m.cards);
    if (m.clip > 0) fail.push('a card clips its own text by ' + m.clip + 'px');
    if (m.lines > 1) fail.push('the strip wrapped onto ' + m.lines + ' lines — the last card '
      + 'ends up alone beside four cards of white, and the PNG is photographed from this');
    if (m.overflow > 1) fail.push('the strip overflows its panel by ' + m.overflow + 'px');
    console.log((fail.length ? 'FAIL ' : 'ok   ') + ('kpi-' + w).padEnd(11) +
      ' font=' + m.font + 'px cards=' + m.cards + ' lines=' + m.lines);
    if (fail.length) { bad++; console.log('       ' + fail.join('\n       ')); }
  }

  await browser.close();

  if (errors.length) { bad++; console.log('\npage errors:\n  ' + errors.join('\n  ')); }
  console.log(bad ? '\n' + bad + ' case(s) FAILED' : '\nSLIDE FIT OK.');
  process.exit(bad ? 1 : 0);
})();
