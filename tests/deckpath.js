/* Exercise the path the Deck Builder actually takes, under jsdom:
 *   Deck_Sources.html  -> creates AmrDeckSource
 *   Deck_Fuel.html     -> registers 'fsc' and 'rfsc' into it
 *   AmrDeckSource.build(spec) -> prepare() (server call) then content() (DOM)
 *
 * google.script.run is stubbed so prepare() resolves from a fake backend.
 */
const fs = require('fs');
const vm = require('vm');
/* jsdom is not vendored — this repo is a flat mirror of the Apps Script
   project and has no node_modules. require() resolves from THIS directory, so
   installing it elsewhere and running from that cwd will not work; say so
   plainly instead of throwing a module-not-found stack. */
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  console.error('jsdom is not installed where this script can see it.\n' +
    '  npm install jsdom --prefix ' + __dirname + '\n' +
    'or point NODE_PATH at an existing install:\n' +
    '  NODE_PATH=/path/to/node_modules node tests/deckpath.js');
  process.exit(2);
}
const REPO = require('path').resolve(__dirname, '..');
const { module: mod } = require('./apphtml.js');

function scriptOf(f) {
  return (fs.readFileSync(`${REPO}/${f}`, 'utf8').match(/<script>([\s\S]*?)<\/script>/g) || [])
    .map(b => b.replace(/^<script>/, '').replace(/<\/script>$/, '')).join('\n');
}

const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
const win = dom.window;

const rows = [
  { market: 'GTA AGG', tonnes26: 1282643, tonnes25: 1390172, fsc26: 314818, fsc25: 0 },
  { market: 'Manitoba', tonnes26: 209115, tonnes25: 215405, fsc26: 54055, fsc25: 56064 },
  { market: 'Grand Total', isTotal: true },
];
const MODEL = {
  markets: ['GTA AGG', 'Manitoba'], latestMonth: 'JUL', cyYear: 2026,
  exec: { MTD: { all: rows, applied: rows }, YTD: { all: rows, applied: rows } },
};

const PVREPORT = { period:'MTD', filterValue:'GTA', latestMonth:7,
  tables:[ { dimension:'Market', key:'MARKET', volMix:-0.002, rows:[
    {label:'GTA',cyVol:1282643,pyVol:1390172,volPct:-0.077,cyAsp:15.10,pyAsp:14.47,aspPct:0.044,ppi:0.026}],
    total:{cyVol:2266382,pyVol:2444425,volPct:-0.073,cyAsp:17.11,pyAsp:16.64,aspPct:0.028,ppi:0.03} } ],
  revenueBridge:{pyRev:40668495,volImpact:-2962143,priceImpact:1061457,cyRev:38767809},
  priceBridge:{ppi:0.03,totalAsp:0.028,items:[{label:'Region/Market mix',value:-0.003}]} };

/* GETREPORT DOES NOT RETURN THE TABLES IN THE ORDER IT WAS ASKED FOR, and the
   stub has to reproduce that or the check below passes on the server's
   accident rather than on the adapter's work. The real one walks
   CONFIG.DIMENSIONS and pushes a table for every key that appears in the
   request — so the array comes back in the SERVER's order however the request
   was written — and appends the customer-segment pivot last, because that one
   is built off a different pivot. */
const PV_SERVER_ORDER = [
  ['REGION','Region'], ['MARKET','Market'], ['SUBMARKET1','Submarket'],
  ['PLANT_TYPE','Plant Type'], ['MATERIAL_FAM','Material Family'],
  ['PROD_CLASS','Product Class'], ['PLANT','Plant'], ['MATERIAL','Material'],
  ['CUST_SEGMENT','Customer Segment'],
];
function pvReport(opts){
  const want = (opts && opts.dimensions) || ['SUBMARKET1','PLANT_TYPE','PROD_CLASS'];
  const base = PVREPORT.tables[0];
  const tables = PV_SERVER_ORDER.filter(([k]) => want.indexOf(k) !== -1)
    .map(([k, label]) => Object.assign({}, base, { key:k, dimension:label }));
  return Object.assign({}, PVREPORT, { tables, dimensionsAsked: want.slice() });
}
const CUSTREP = { rows:[{label:'Amrize RMX',secondary:'INTERNAL RMX',cyVol:28680,pyVol:29575,
  volPct:-0.03,cyAsp:25.6,pyAsp:24.04,aspPct:0.065,cyFsc:12333,ppi:0.088,deltaApplied:0.43}],
  total:{cyVol:99001,pyVol:141871,volPct:-0.302,cyAsp:24.74,pyAsp:23.39,aspPct:0.058,cyFsc:28426,ppi:0.06,deltaApplied:0.45} };
/* RMX_getSlideTables shape (Segment page) and RMX_getKeys/getExtras (RMX page) */
const SEGREP = { market:'SASKATCHEWAN', period:'MTD', latestMonth:7,
  segment:{ rows:[{label:'Res - Low Rise',cyVol:8458,cyPct:.48,pyVol:6754,pyPct:.45,volPct:.25,cyAspVa:314.98,pyAspVa:305.38,aspIncVa:.031}],
            total:{cyVol:17673,pyVol:14948,volPct:.18,cyAspVa:351.36,pyAspVa:337.20,aspIncVa:.042} },
  extras:{ extras:[{label:'Performance',cyVol:2429,volInc:.061,volChg:-.016,cyAsp:365.23,aspInc:.053,cm2:118.44,cm2Inc:0}],
           vap:[{label:'General Purpose',cyVol:7985,volInc:.486,volChg:.092,cyAsp:326.96,aspInc:.03,cm2:69.32,cm2Inc:-.39}] } };
const RMXKEYS = { market:'SASKATCHEWAN', period:'MTD', latestMonth:7, rows:[], plants:[], keys:[] };
/* the Extras payload shape renderExtras() consumes: two streams plus their
   subtotals, and the merged detail list */
const XR = (label,cyRev,pyRev,cyAsp,pyAsp) => ({ label, cyRev, pyRev,
  revPct:(cyRev-pyRev)/pyRev, cyAsp, pyAsp, aspChg:cyAsp-pyAsp });
const RMXEXTRAS = { market:'SASKATCHEWAN', period:'MTD',
  byTypeExtras:[ XR('Standard Fees',774945,632407,43.85,42.31) ],
  byTypeExtrasTotal: XR('EXTRAS',774945,632407,43.85,42.31),
  byTypeVap:[ XR('Other VAP',177009,135567,10.02,9.07) ],
  byTypeVapTotal: XR('VAP',177009,135567,10.02,9.07),
  byTypeTotal: XR('Total',1425417,1021567,80.66,68.34),
  /* the merged detail table reads these two directly */
  extras:[ { label:'Standard Fees', cyVol:0, cyRev:774945, pyRev:632407,
             revPct:.225, cyAsp:43.85, pyAsp:42.31, aspChg:1.54 } ],
  vap:[ { label:'Other VAP', cyVol:0, cyRev:177009, pyRev:135567,
          revPct:.306, cyAsp:10.02, pyAsp:9.07, aspChg:.95 } ] };
let calls = [];
/* google.script.run, stubbed. Each property access returns a FRESH runner:
   the real thing lets two chains be in flight at once, and 'cust' relies on
   that (it asks for MTD and YTD in parallel). A shared handler would silently
   hang the second one. */
win.google = {
  script: {
    get run() {
      const api = {};
      let ok = null;
      api.withSuccessHandler = f => (ok = f, api);
      api.withFailureHandler = () => api;
      /* a function payload is called with the request, so a stub can answer
         the question that was actually asked */
      const reply = (name, payload) => (...a) => {
        calls.push([name, a]);
        setTimeout(() => ok(typeof payload === 'function' ? payload(...a) : payload), 0);
      };
      api.getFscData = reply('getFscData', MODEL);
      api.getRmxFuelData = reply('getRmxFuelData', MODEL);
      api.getReport = reply('getReport', pvReport);
      api.getCustomerReport = reply('getCustomerReport', CUSTREP);
      api.RMX_getSlideTables = reply('RMX_getSlideTables', SEGREP);
      api.RMX_getKeys = reply('RMX_getKeys', RMXKEYS);
      api.RMX_getExtras = reply('RMX_getExtras', RMXEXTRAS);
      return api;
    },
  },
};

/* jsdom has no canvas and we do not load Chart.js: stub both so the PV path's
   ASSEMBLY (tables, KPI row, layout) can be exercised. The charts themselves
   come out as empty images — real chart rendering is a browser check. */
win.HTMLCanvasElement.prototype.getContext = function(){ return {}; };
win.Chart = function(ctx, cfg){
  this.options = (cfg && cfg.options) || {};
  this.destroy = function(){}; this.resize = function(){}; this.draw = function(){};
  this.toBase64Image = function(){ return 'data:image/png;base64,STUB'; };
};

vm.createContext(win);
vm.runInContext(mod('AmrDeckSource'), win);
/* The real AmrKpi lives in KpiShared.html, which this harness does not load —
   the deck modules only ever touch this handful of it. Mirror the shape,
   including the two-workbook split: Manitoba and Saskatchewan read the 'mbsk'
   book, every other market reads 'main'. The stub carries ONE region per book,
   so a row offered the wrong book's regions shows up as the wrong label rather
   than as an empty list that could equally mean "no workbook". */
win.AmrKpi = {
  plantIndex: (v, book) => {
    if(!v) return [];
    const all = [{ label:'Central', book:'main' }, { label:'GTA', book:'main' },
                 { label:'Regina', book:'mbsk' }];
    return book ? all.filter(e => e.book === book) : all;
  },
  bookFor: market => /^(manitoba|sask)/i.test(String(market || '').trim()) ? 'mbsk' : 'main',
  bookLabel: book => book === 'mbsk' ? 'Manitoba / Saskatchewan EBITDA' : 'AGG & RMX EBITDA',
  hasBook: (v, book) => !!(v && (book === 'mbsk' ? v.mbsk : true)),
  load: cb => setTimeout(() => cb({ ok:true }), 0),
  /* the numbers behind the KPI cards, for whichever region sheet is picked */
  plant: (vals, entry, period) => entry
    ? { aspCy:16.23, aspPy:15.57, salesCy:31790, salesPy:32500, volCy:1960, volPy:2090 }
    : null,
  /* THE RMX SIDE OF THE SAME WORKBOOK, for the Product Segment KPI row — and
     in the shape the module actually reads. It used to answer with the AGG
     card's fields (aspCy / salesCy / volCy), which AmrSegSlide has no use
     for, so segKpiCardsHtml built nothing and the strip has never once
     rendered under this harness. Nothing noticed because nothing asserted on
     it. The real rmxValues() returns one entry per named row of the "RMX
     Summary" block, each { cy, py, cyU, pyU, dn, dp }. */
  rmx: (vals, market, period) => vals
    ? { units: { cy:17673, py:14948, cyU:0, pyU:0, dn:2725,  dp:0.182 },
        rev:   { cy:4908,  py:4086,  cyU:0, pyU:0, dn:822,   dp:0.201 },
        conc:  { cy:4210,  py:3560,  cyU:0, pyU:0, dn:650,   dp:0.183 },
        raw:   { cy:1980,  py:1704,  cyU:0, pyU:0, dn:276,   dp:0.162 } }
    : null,
};
/* jsdom's own localStorage throws on an opaque origin, and a plain assignment
   does not replace it — the getter is still jsdom's, so every read threw and
   every write was swallowed by the callers' try/catch. That is not a harmless
   difference here: the Region memory IS localStorage, so without this the
   picker silently remembers nothing and every "it remembered" check passes for
   the wrong reason. defineProperty actually replaces it. */
Object.defineProperty(win, 'localStorage', { configurable:true, writable:true,
  value: (function(){ var m={}; return {
    getItem:k=>(k in m?m[k]:null), setItem:(k,v)=>{m[k]=String(v);},
    removeItem:k=>{delete m[k];} }; })() });
vm.runInContext(mod('AmrFuelExec'), win);
vm.runInContext(mod('AmrPvSlide'), win);
vm.runInContext(mod('AmrSegSlide'), win);
vm.runInContext(mod('AmrRmxSlide'), win);

const R = win.AmrDeckSource;
console.log('registered sources:', R.list().join(', '));
console.log('missingFor([fsc,rfsc,pv]):',
  R.missingFor([{ source: 'fsc' }, { source: 'rfsc' }, { source: 'pv' }]).join(', ') || '(none)');

const specs = [
  { id: 'fsc_mtd', source: 'fsc', period: 'MTD', layout: 'L_FULL_IMAGE' },
  { id: 'fsc_ytd', source: 'fsc', period: 'YTD', layout: 'L_FULL_IMAGE' },
  { id: 'rfsc_mtd', source: 'rfsc', period: 'MTD', layout: 'L_FULL_IMAGE' },
  { id: 'rfsc_ytd', source: 'rfsc', period: 'YTD', layout: 'L_FULL_IMAGE' },
  { id: 'pv_gta_mtd', source: 'pv', market: 'GTA', period: 'MTD', layout: 'L_COMMENT_IMAGE' },
  { id: 'pv_cc_ytd', source: 'pv', market: 'Central Canada', period: 'YTD', layout: 'L_COMMENT_IMAGE' },
  { id: 'cust_gta', source: 'cust', market: 'GTA', layout: 'L_FULL_IMAGE' },
  { id: 'seg_sk_mtd', source: 'seg', market: 'SASKATCHEWAN', period: 'MTD', layout: 'L_COMMENT_IMAGE_NO_KPI' },
  { id: 'rmx_sk_mtd', source: 'rmx', market: 'SASKATCHEWAN', period: 'MTD', layout: 'L_FULL_IMAGE' },
];

let bad = 0;
(async () => {
  for (const s of specs) {
    try {
      const el = await R.build(s);
      const editable = el.querySelectorAll('[contenteditable]').length;
      const tables = el.querySelectorAll('table.fsc-t.exec').length;
      const periods = [...el.querySelectorAll('.fsc-period')].map(n => n.textContent.trim());
      const isFuel = s.source === 'fsc' || s.source === 'rfsc';
      const okAll = isFuel ? (tables === 2 && editable === 0 && periods.length === 1)
                           : (el.querySelectorAll('table').length > 0);
      if (!okAll) bad++;
      const detail = isFuel
        ? `exec tables=${tables} period="${periods.join('|')}"`
        : `tables=${el.querySelectorAll('table').length}` +
          ` kpiCards=${el.querySelectorAll('.pv-exp-kpis > *').length}` +
          ` charts=${el.querySelectorAll('.pv-exp-charts img').length}` +
          ` custBlocks=${el.querySelectorAll('.cust-blk').length}`;
      console.log(`  ${okAll ? 'ok  ' : 'FAIL'} ${s.id.padEnd(10)} contenteditable=${editable} ${detail}`);
    } catch (e) {
      bad++;
      console.log(`  FAIL ${s.id} -> ${e.message}`);
    }
  }

  // an unregistered source must fail with a sentence, not a stack trace
  try {
    await R.build({ id: 'nope_x', source: 'nope' });
    console.log('  FAIL unregistered source resolved (should reject)'); bad++;
  } catch (e) {
    console.log(`  ok   unregistered source rejects: "${e.message.slice(0, 62)}…"`);
  }

  // each backend must be hit ONCE even though two slides use it
  const counts = calls.reduce((o, [f]) => (o[f] = (o[f] || 0) + 1, o), {});
  const cached = counts.getFscData === 1 && counts.getRmxFuelData === 1
    && counts.getReport === 2 && counts.getCustomerReport === 2
    && counts.RMX_getSlideTables === 1 && counts.RMX_getKeys === 1;
  if (!cached) bad++;
  console.log(`  ${cached ? 'ok  ' : 'FAIL'} backend calls: ${JSON.stringify(counts)} (one per market+period, never per slide)`);
  console.log(`       args: ${JSON.stringify(calls.map(c => c[1]))}`);

  /* ------------------------------------------------------------------
   * The Region dropdown is per ROW, not per page.
   * ------------------------------------------------------------------
   * Manitoba and Saskatchewan read the SECOND EBITDA workbook; every other
   * market reads the first. One merged list meant a Saskatchewan row was
   * offered Ontario's regions and defaulted to the first of them — a real
   * region sheet, silently the wrong one. It showed no wrong numbers only
   * because the KPI strip is suppressed for those two markets while their
   * workbook is missing; the moment it lands, that guard stops firing.
   * ---------------------------------------------------------------- */
  console.log('\nthe Region dropdown follows the row\'s own workbook:');
  const pick = (src, spec) => {
    const p = R.get(src).kpiPicker;
    return { sheets: p.sheets(spec), book: p.book(spec), has: p.hasBook(spec) };
  };
  const ok = (label, cond) => { if (!cond) bad++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`); };
  const gta  = pick('pv',  { market: 'GTA' });
  const sask = pick('pv',  { market: 'Saskatchewan' });

  ok('an Ontario row is offered the main book',        gta.book === 'main');
  ok('...and only its regions',                        JSON.stringify(gta.sheets) === '["Central","GTA"]');
  ok('a Saskatchewan row is sent to the MB/SK book',   sask.book === 'mbsk');
  ok('...and is NOT offered an Ontario region',        sask.sheets.indexOf('GTA') === -1);
  ok('a missing MB/SK workbook reads as missing',      sask.has === false);
  ok('...while the main book is present',              gta.has === true);

  /* AND THE RMX SLIDES HAVE NO DROPDOWN AT ALL.
     A region is a per-region PLANT STATEMENT tab, which is what the Price &
     Volume cards read. The Product Segment cards come from AmrKpi.rmx(), which
     finds the market's own block in "RMX Summary" by name and reads no sheet
     index at all — so there is nothing to choose. The seg adapter used to
     declare a picker built from the AGG region list anyway: AmrSegSlide ignored
     every field of it, so it changed nothing, and it put "AGG GTA" on ten
     Ready-Mix rows in the Deck Builder. */
  ok('an RMX Segment row offers no region dropdown',   !R.get('seg').kpiPicker);
  ok('...while the AGG rows still have one',           !!R.get('pv').kpiPicker);
  const segCtxKpi = (() => {
    /* the ctx the seg adapter hands the module: values only, no sheet/index */
    const src = R.get('seg');
    return typeof src.content === 'function';
  })();
  ok('the seg source still builds its slide without one', segCtxKpi);

  /* ------------------------------------------------------------------
   * reset() — what ↻ Update from source relies on.
   * ------------------------------------------------------------------
   * The adapters hold what they fetched for the life of the page. Bumping
   * the server's cache does nothing about that, so without this the button
   * re-photographs the copy already in this browser and the new figures
   * never appear.
   * ---------------------------------------------------------------- */
  console.log('\nreset() drops what the adapters are holding:');
  const withReset = R.list().filter(id => typeof R.get(id).reset === 'function');
  ok(`every source has one (${withReset.length}/${R.list().length})`,
     withReset.length === R.list().length);

  const before = calls.length;
  const n = R.resetAll();
  ok(`resetAll() ran them all (${n})`, n === R.list().length);

  /* The Region dropdown reads what was loaded, so resetAll() blanks it — and
     warmAll() has to be able to fill it in again with NOTHING rendered. That
     is the whole point of the hook: prepare() loads the same workbook, but
     only during a render, so before this the dropdown read "no workbook" on
     every row until the first render had already been paid for. */
  ok('resetAll() blanks the Region dropdown',
     pick('pv', { market: 'GTA' }).sheets.length === 0);
  await R.warmAll();
  ok('warmAll() fills it in again with nothing rendered',
     pick('pv', { market: 'GTA' }).sheets.length > 0);
  ok('...and it still respects the row\'s workbook',
     pick('pv', { market: 'Saskatchewan' }).sheets.indexOf('GTA') === -1);

  await R.build(specs[0]);                       // fsc_mtd, already built once
  const refetched = calls.length > before;
  ok('a rebuilt slide goes back to the server', refetched);

  /* ------------------------------------------------------------------
   * EVERY ROW'S DROPDOWN IS ITS OWN — except the MTD / YTD pair.
   * ------------------------------------------------------------------
   * Southwest Land and Southwest Docks are a REFINE within Southwest, not
   * markets, so all three rows carry market:'Southwest'. The deck's memory
   * key was the market alone, so setting the region on Southwest moved Land
   * and Docks with it, and the two refined rows also read a different slot
   * from the one the report page writes for them — Page_PriceVolume's
   * kpiViewKey has had the refine in it all along.
   *
   * The period is deliberately NOT in the key: MTD and YTD of one view read
   * the same region sheet in two places on it, and that pair moving together
   * is the one bit of sharing that is wanted.
   * ---------------------------------------------------------------- */
  console.log('\neach Region dropdown is its own, except MTD / YTD:');
  const P = R.get('pv').kpiPicker;
  const sw      = { market:'Southwest', period:'MTD' };
  const swYtd   = { market:'Southwest', period:'YTD' };
  const land    = { market:'Southwest', period:'MTD', refine:'Land' };
  const landYtd = { market:'Southwest', period:'YTD', refine:'Land' };
  const docks   = { market:'Southwest', period:'MTD', refine:'Docks' };
  const sheets  = P.sheets(sw);
  ok(`the market offers more than one region (${JSON.stringify(sheets)})`, sheets.length > 1);

  P.choose(sw, sheets[0]);
  P.choose(land, sheets[1]);
  ok('Southwest keeps the region it was given',        P.current(sw)      === sheets[0]);
  ok('...and its YTD twin moves with it',              P.current(swYtd)   === sheets[0]);
  ok('Southwest Land keeps its OWN region',            P.current(land)    === sheets[1]);
  ok('...and its YTD twin moves with it',              P.current(landYtd) === sheets[1]);
  ok('changing Land did not drag Southwest with it',   P.current(sw)      === sheets[0]);
  ok('Docks has never been set, so it follows Southwest',
     P.current(docks) === sheets[0]);
  P.choose(docks, sheets[1]);
  ok('...until it is given one of its own',            P.current(docks)   === sheets[1]);
  ok('...which leaves Southwest alone',                P.current(sw)      === sheets[0]);
  ok('...and leaves Land alone',                       P.current(land)    === sheets[1]);

  /* ------------------------------------------------------------------
   * THE QLIKVIEW ASP CARD MUST SURVIVE A REORDERED TABLE ARRAY.
   * ------------------------------------------------------------------
   * Every table getReport returns carries the SAME grand total — the
   * market's, computed once and packed onto each one — so which table the
   * card reads has never mattered while the array was the server's own,
   * always led by a dimension table with a total on it.
   *
   * It starts mattering the moment a slide picks WHICH tables it shows and
   * in what order. `d.tables[0].total` on a selection whose first table has
   * no total leaves the card reading "Load market data to fill this card" —
   * baked into a published picture, with every slide building and nothing
   * going red. That is the same shape as the Southwest-Land page of zeroes:
   * a wrong answer that fails silently.
   *
   * So the card takes the first table that HAS a total. The fixture below
   * puts a total-less table first ON PURPOSE — a real one, the customer-
   * segment pivot, which getReport appends without a `total` of its own.
   * ---------------------------------------------------------------- */
  console.log('\nthe QlikView ASP card reads a grand total, not the first table:');
  {
    const led = PVREPORT.tables[0];
    const noTotal = { dimension:'Customer Segment', rows:[
      { label:'INTERNAL RMX', cyVol:28680, pyVol:29575, volPct:-.03,
        cyAsp:25.6, pyAsp:24.04, aspPct:.065, ppi:.088 } ] };
    const ctx = data => ({
      slide: win.AmrPvSlide.SLIDE, data: data, period:'MTD', month:7, latestMonth:7,
      filterField:'MARKET', filterValue:'GTA', collapsed:{},
      kpi: win.AmrPvSlide.kpiFor({ ok:true }, 'MARKET', 'GTA', 'GTA', 'main', '')
    });
    const WAIT = 'Load market data to fill this card';
    /* the QlikView card is the SECOND of the two ASP cards */
    const qvCard = html => (html.split('QlikView')[1] || '');

    const asServed = win.AmrPvSlide.kpiCardsHtml(ctx(PVREPORT));
    ok('the server\'s own order still fills the card',
       !qvCard(asServed).includes(WAIT) && asServed.includes('QlikView'));

    const reordered = win.AmrPvSlide.kpiCardsHtml(
      ctx(Object.assign({}, PVREPORT, { tables: [noTotal, led] })));
    ok('a total-less table in front of it does not empty the card',
       !qvCard(reordered).includes(WAIT));
    ok('...and the figure is the same one, from the table that has it',
       qvCard(reordered).slice(0, 400) === qvCard(asServed).slice(0, 400));

    const onlyOne = win.AmrPvSlide.kpiCardsHtml(
      ctx(Object.assign({}, PVREPORT, { tables: [led] })));
    ok('one table on its own is enough',
       !qvCard(onlyOne).includes(WAIT));

    /* AND AN EMPTY SELECTION STILL SAYS SO. The card going blank when there
       is genuinely no total is the honest answer, not a case to paper over —
       what stops it reaching a slide is the per-source minimum of one table,
       enforced where the choice is made. */
    const none = win.AmrPvSlide.kpiCardsHtml(
      ctx(Object.assign({}, PVREPORT, { tables: [] })));
    ok('no tables at all is still reported as no data',
       qvCard(none).includes(WAIT));
  }

  /* ------------------------------------------------------------------
   * WHICH TABLES A SLIDE SHOWS, AND IN WHAT ORDER.
   * ------------------------------------------------------------------
   * The Arrange stage resolves a scope down to ONE ordered array of keys and
   * puts it on the spec. One array, so "which tables" and "in what order"
   * cannot disagree — and every source has to honour both halves of it.
   *
   * Each source declares what it can offer as a static `tables` descriptor
   * beside its kpiPicker: a catalogue, the fallback the deck builds today,
   * and a minimum where an empty selection would break something. Static,
   * because Plan has to stay instant and nothing here may ask the server.
   * ---------------------------------------------------------------- */
  console.log('\nevery source says what it can be asked for:');
  {
    const desc = id => R.get(id).tables;
    ok('pv offers the nine PV dimensions',
       desc('pv').catalogue.length === 9 &&
       desc('pv').catalogue.every(t => t.key && t.label));
    ok('...with the fallback the deck builds today',
       desc('pv').fallback({ market:'GTA' }).join(',') === 'SUBMARKET1,PLANT_TYPE,PROD_CLASS' &&
       desc('pv').fallback({ market:'Central Canada' }).join(',') === 'MARKET,PLANT_TYPE,PROD_CLASS',
       'the rollup slide is cut by MARKET, a market slide by SUBMARKET1');
    ok('...and a minimum of one, because the QlikView card reads a total',
       desc('pv').min === 1);
    ok('rmx offers the five breakdowns',
       desc('rmx').catalogue.map(t => t.key).join(',') === 'SUBMARKET,SEGMENT,STRENGTH,CLASS,PLANT');
    ok('...falling back to the three the page exports',
       desc('rmx').fallback().join(',') === 'SUBMARKET,STRENGTH,PLANT');
    ok('seg offers the three seg: cards',
       desc('seg').catalogue.map(t => t.key).join(',') === 'seg:segment,seg:byType,seg:detail');
    ok('...falling back to Segment + By extra type, not the module default',
       desc('seg').fallback().join(',') === 'seg:segment,seg:byType');
    ok('a source with nothing to pick declares nothing',
       !R.get('cust').tables && !R.get('fsc').tables && !R.get('rfsc').tables,
       'the panel says so rather than showing an empty control');

    /* AND WHO HAS A KPI STRIP AT ALL. pv has one and a region to choose;
       seg has one and no region — AmrKpi.rmx finds the market's block by
       name; rmx, cust and the two fuel sources have no strip. */
    ok('pv declares both halves of its KPI panel',
       R.get('pv').kpiToggle === true && !!R.get('pv').kpiPicker);
    ok('seg declares on/off and no region',
       R.get('seg').kpiToggle === true && !R.get('seg').kpiPicker);
    ok('rmx declares neither — its slide carries no strip',
       !R.get('rmx').kpiToggle && !R.get('rmx').kpiPicker);
  }

  console.log('\nthe order asked for is the order that comes back:');
  {
    /* THE CHECK THAT PROVES THE REORDER RATHER THAN THE SERVER'S ACCIDENT.
       PROD_CLASS before MARKET before SUBMARKET1 is deliberately the reverse
       of CONFIG.DIMENSIONS order, which is the order getReport pushes them
       in whatever the request says. If the adapter did not reorder, the
       headings would come back Market, Submarket, Product Class. */
    const want = ['PROD_CLASS', 'MARKET', 'SUBMARKET1'];
    const raw = pvReport({ dimensions: want }).tables.map(t => t.dimension);
    ok('the server hands them back in ITS order, not the asked-for one',
       raw.join(' | ') === 'Market | Submarket | Product Class',
       'the fixture is not reproducing the defect: ' + raw.join(' | '));

    const el = await R.build({ id:'pv_order', source:'pv', market:'GTA', period:'MTD',
                               layout:'L_COMMENT_IMAGE', tables: want });
    const heads = [...el.querySelectorAll('.tbl-card h3')].map(h => h.textContent.trim());
    ok('...and the slide shows them in the order the scope asked for',
       heads.join(' | ') === 'Product Class | Market | Submarket',
       heads.join(' | '));

    /* the payload is SHARED — the MTD row, its YTD twin and the unrefined
       report a Land/Docks row resolves against all point at it — so the
       reorder has to be into a copy. Building the same row again must not
       find a payload somebody else already shuffled. */
    const again = await R.build({ id:'pv_order2', source:'pv', market:'GTA', period:'MTD',
                                  layout:'L_COMMENT_IMAGE', tables: ['MARKET', 'PROD_CLASS'] });
    const heads2 = [...again.querySelectorAll('.tbl-card h3')].map(h => h.textContent.trim());
    ok('...and a second row off the same market gets its own order',
       heads2.join(' | ') === 'Market | Product Class', heads2.join(' | '));

    const plain = await R.build({ id:'pv_plain', source:'pv', market:'GTA', period:'MTD',
                                  layout:'L_COMMENT_IMAGE' });
    const heads3 = [...plain.querySelectorAll('.tbl-card h3')].map(h => h.textContent.trim());
    ok('a row with no selection is exactly what it was before any of this',
       heads3.join(' | ') === 'Submarket | Plant Type | Product Class', heads3.join(' | '));

    /* RMX gets the order free — buildTables maps over `dims` in order. */
    const rmxEl = await R.build({ id:'rmx_order', source:'rmx', market:'SASKATCHEWAN',
                                  period:'MTD', layout:'L_FULL_IMAGE',
                                  tables: ['CLASS', 'SUBMARKET'] });
    const rmxHeads = [...rmxEl.querySelectorAll('.rmx-eb-title')].map(h => h.textContent.trim());
    ok('a non-default rmx breakdown is built, in its own order (' +
       rmxHeads.join(' | ') + ')',
       rmxHeads.join(' | ') === 'By CLASS | By SUBMARKET',
       rmxHeads.join(' | ') || 'no table headings found');
    const rmxPlain = await R.build({ id:'rmx_plain', source:'rmx', market:'SASKATCHEWAN',
                                     period:'MTD', layout:'L_FULL_IMAGE' });
    const plainHeads = [...rmxPlain.querySelectorAll('.rmx-eb-title')]
      .map(h => h.textContent.trim()).join(' | ');
    ok('...while a row with no selection is still the three the page exports ('
       + plainHeads + ')',
       plainHeads === 'By SUBMARKET | By STRENGTH | PLANT',
       'PLANT is the pre-rolled Top 10 list and titles its own card, which is '
       + 'why it is not "By ..." like the key-grain three');

    /* SEG takes ctx.tableOrder. Its cards are captioned "<name> · <period>". */
    const segEl = await R.build({ id:'seg_order', source:'seg', market:'SASKATCHEWAN',
                                  period:'MTD', layout:'L_COMMENT_IMAGE_NO_KPI',
                                  tables: ['seg:byType', 'seg:segment'] });
    const segCaps = [...segEl.querySelectorAll('.ccap')].map(c => c.textContent.trim());
    ok('seg builds the cards the selection names, in its order (' +
       segCaps.join(' | ') + ')',
       segCaps.length === 2 && /extra type/i.test(segCaps[0]) && /Segment/i.test(segCaps[1]),
       segCaps.join(' | '));

    const segOne = await R.build({ id:'seg_one', source:'seg', market:'SASKATCHEWAN',
                                   period:'MTD', layout:'L_COMMENT_IMAGE_NO_KPI',
                                   tables: ['seg:segment'] });
    ok('...and one card on its own really is one card',
       segOne.querySelectorAll('.ccap').length === 1);
  }

  /* ------------------------------------------------------------------
   * THE KPI STRIP, AND WHOSE ANSWER WINS.
   * ------------------------------------------------------------------
   * The Region was per-DEVICE while everything else in Arrange is shared, so
   * a colleague building from your saved arrangement could get different KPI
   * numbers and nothing said so. The shared choice goes on top; under it the
   * device memory, which is what the Price & Volume page writes; under that
   * the first sheet on the row's own workbook.
   * ---------------------------------------------------------------- */
  console.log('\nthe KPI strip: on, off, and whose region wins:');
  {
    const strip = el => el.querySelectorAll('.pv-exp-kpis').length;
    const on = await R.build({ id:'pv_kpi_on', source:'pv', market:'GTA', period:'MTD',
                               layout:'L_COMMENT_IMAGE' });
    ok('a PV slide carries the strip by default', strip(on) === 1);
    const off = await R.build({ id:'pv_kpi_off', source:'pv', market:'GTA', period:'MTD',
                                layout:'L_COMMENT_IMAGE', kpi: { on:false } });
    ok('...and a scope can switch it off', strip(off) === 0);
    ok('...leaving the tables exactly as they were',
       off.querySelectorAll('.tbl-card').length === on.querySelectorAll('.tbl-card').length);

    const segStrip = el => el.querySelectorAll('.seg-kpi-row').length;
    const segOn = await R.build({ id:'seg_kpi_on', source:'seg', market:'SASKATCHEWAN',
                                  period:'MTD', layout:'L_COMMENT_IMAGE' });
    ok('a Product Segment slide carries its own strip', segStrip(segOn) === 1);
    const segOff = await R.build({ id:'seg_kpi_off', source:'seg', market:'SASKATCHEWAN',
                                   period:'MTD', layout:'L_COMMENT_IMAGE', kpi: { on:false } });
    ok('...and the same switch turns it off', segStrip(segOff) === 0);

    /* PRECEDENCE. Set the DEVICE memory to one sheet and the SHARED scope to
       the other, then ask what the row will read. */
    const P2 = R.get('pv').kpiPicker;
    const sheets2 = P2.sheets({ market:'GTA' });
    P2.choose({ market:'GTA' }, sheets2[0]);
    ok('with nothing shared, the device memory answers',
       P2.current({ market:'GTA' }) === sheets2[0]);
    ok('a shared region beats the device memory',
       P2.current({ market:'GTA', kpi:{ sheet: sheets2[1] } }) === sheets2[1],
       'read ' + P2.current({ market:'GTA', kpi:{ sheet: sheets2[1] } }));
    ok('...and the device memory is not written over by it',
       P2.current({ market:'GTA' }) === sheets2[0]);
    ok('a shared entry with on/off but NO region still follows the device',
       P2.current({ market:'GTA', kpi:{ on:true } }) === sheets2[0]);
  }

  console.log(bad ? `\n${bad} FAILURE(S).` : '\nDECK PATH OK.');
  process.exit(bad ? 1 : 0);
})();
