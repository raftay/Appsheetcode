#!/usr/bin/env node
/* =============================================================================
 * tests/pageparity.js — the OLD page and the MERGED page render the same thing
 * -----------------------------------------------------------------------------
 * merge.js proves app.html is structurally sound and modparity.js proves the
 * shared modules came across untouched. Neither runs a page. This does: it
 * boots the legacy page and app.html's port of it side by side under jsdom,
 * with google.script.run stubbed to return the same model to both, and diffs
 * the DOM they produce.
 *
 * It is the gate PLAN.md §12 asks for, and it is what catches the class of
 * break the other harnesses cannot see — a mistyped id, a listener that never
 * got wired, a template that mounts empty. Every page chunk should add its case
 * to PAGES below before touching the page.
 *
 * WHAT IS COMPARED. #tablesHost after load, then again after switching view,
 * plus the rail controls the page fills in from the data (market list, month
 * picker, auto-title). Not the whole body: the merged page deliberately differs
 * outside it — one shared guide instead of a copy, data-act buttons instead of
 * inline handlers.
 *
 * WHAT IS ASSERTED INSTEAD. Exactly that shared chrome, on the merged side only:
 * the guide mounted with this page's steps and this page's own panel moved into
 * it, the "?" source hint opens the shared modal with this page's content, the
 * page switcher is there and knows which page it is on, every name that used to
 * be a page global is now a local, and every module the page leans on exists.
 * The hint check is the one that has already earned its keep — chunk 2 ported
 * AmrHint without the click handler that opens it, and no diff would ever have
 * shown that, because the button renders perfectly either way.
 *
 * STUBS, AND WHY EACH ONE IS HONEST
 *   · google.script.run  — the server is not reachable off-platform. Both sides
 *     get the identical model, so any difference is the page's.
 *   · injected <script src>  — app.html's AmrLib fetches CDN libraries and
 *     awaits onload before boot(). jsdom loads no external resources, so the
 *     promise would never settle and boot would never run. The stub resolves
 *     them immediately; nothing under test uses html2canvas or SheetJS at boot.
 *
 * Run:  npm install jsdom     # not vendored
 *       node tests/pageparity.js
 * ===========================================================================*/
'use strict';
const fs   = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
/* The Ready-Mix model lives in its own module because cssparity.js renders the
   same page from it, and that harness's whole guarantee — any difference is a
   CASCADE difference — holds only while both sides render identical markup. */
const { RMX_MARKETS, rmxKeysPayload, rmxModel } = require('./rmxfixture');
const { legacy: legacyFile } = require('./apphtml.js');

const ROOT = path.join(__dirname, '..');
const URL_BASE = 'https://script.google.com/macros/s/TEST/exec';

/* ---------------------------------------------------------------- fixtures */
/* The July 2026 shape regress.js uses, with the summary and by-month sections
   it does not exercise filled in — this harness renders those tables too. */
function fscModel() {
  const mk = (market, t26, t25, f26, f25) =>
    ({ market, tonnes26: t26, tonnes25: t25, fsc26: f26, fsc25: f25 });
  const exec = () => ({
    all: [
      mk('GTA AGG', 1282643, 1390172, 314818, 0),
      mk('SW Ontario', 675623, 692108, 105512, 0),
      mk('Manitoba', 209115, 215405, 54055, 56064),
      { market: 'Grand Total', isTotal: true },
    ],
    applied: [
      mk('GTA AGG', 865515, 0, 314818, 0),
      mk('SW Ontario', 391703, 0, 105512, 0),
      mk('Manitoba', 150702, 152912, 54055, 56064),
      { market: 'Grand Total', isTotal: true },
    ],
  });
  const srow = (market, tv, tf, av, ans, f25, wVol, wNS, av25, fsc25c) =>
    ({ market, totalVol: tv, totalFSC: tf, appliedVol: av, appliedNS: ans,
       fscT2025: f25, wVol, wNS, av25, fsc25c });
  const summary = () => [
    srow('GTA AGG',    1282643, 314818, 865515, 41203344, 0,    1282643, 61000000, 0,      0),
    srow('SW Ontario',  675623, 105512, 391703, 18800000, 0,     675623, 29000000, 0,      0),
    srow('Manitoba',    209115,  54055, 150702,  9100000, 0.37,  209115, 12000000, 152912, 56064),
    { market: 'Grand Total', isTotal: true },
  ];
  const bmrows = [
    { month: 'Jan', fsc25: 4100, vol25: 12000, fsc26: 5200, vol26: 13100 },
    { month: 'Feb', fsc25: 3900, vol25: 11500, fsc26: 5000, vol26: 12800 },
    { month: 'Jul', fsc25: 6100, vol25: 19000, fsc26: 7400, vol26: 20100 },
  ];
  return {
    markets: ['GTA AGG', 'SW Ontario', 'Manitoba'],
    latestMonth: 'JUL',
    months: [1, 2, 7],
    monthNames: ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'],
    defaultMonth: 7,
    exec: { MTD: exec(), YTD: exec() },
    summary: { MTD: summary(), YTD: summary() },
    byMonth: {
      'GTA AGG':    { rows: bmrows },
      'SW Ontario': { rows: bmrows },
      'Manitoba':   { rows: bmrows },
    },
    sask: { configured: true, unmatched: ['NORTHERN READY MIX'], duplicates: [] },
  };
}

/* The RMX twin. Same shape — AmrFuelExec is shared — with the two real
   differences the page has: the years travel in the payload as cyYear, and
   there is no Saskatchewan section because that is an Aggregates concern. */
function rmxFuelModel() {
  const m = fscModel();
  delete m.sask;
  m.cyYear = 2026;
  m.markets = ['Innocon', 'Dufferin', 'Hamilton Dock'];
  const ren = { 'GTA AGG': 'Innocon', 'SW Ontario': 'Dufferin', 'Manitoba': 'Hamilton Dock' };
  const fix = rows => rows.map(r => r.isTotal ? r : Object.assign({}, r, { market: ren[r.market] || r.market }));
  for (const p of ['MTD', 'YTD']) {
    m.exec[p] = { all: fix(m.exec[p].all), applied: fix(m.exec[p].applied) };
    m.summary[p] = fix(m.summary[p]);
  }
  m.byMonth = { 'Innocon': m.byMonth['GTA AGG'], 'Dufferin': m.byMonth['SW Ontario'],
                'Hamilton Dock': m.byMonth['Manitoba'] };
  return m;
}

/* Price & Volume. The report is one payload per (period, filter) selection;
   the harness only needs one, because what it is proving is that the same
   payload renders the same DOM on both sides. Row fields are the eight
   AmrPvSlide.tableInnerHtml reads, plus the totals row it re-derives. */
function pvModel() {
  const row = (label, cyVol, pyVol, cyAsp, pyAsp, ppi) => ({
    label, cyVol, pyVol, volPct: pyVol ? cyVol / pyVol - 1 : 0,
    cyAsp, pyAsp, aspPct: pyAsp ? cyAsp / pyAsp - 1 : 0, ppi,
  });
  const rows = [
    row('Aggregates', 1282643, 1390172, 14.62, 13.81, 0.0412),
    row('Asphalt',     675623,  692108, 21.07, 20.44, 0.0188),
    row('Other',        99001,  141871,  9.55,  9.90, -0.0212),
  ];
  const total = row('Grand total', 2057267, 2224151, 15.94, 15.12, 0.0331);
  const table = dimension => ({ dimension, volMix: 0.0114, rows, total });
  return {
    period: 'MTD', filterField: 'market', filterValue: '__ALL__',
    refineValue: '__ALL__', refineOptions: [],
    filterOptions: ['GTA', 'Southwest', 'Manitoba'],
    rowCount: 48213,
    tables: [table('Submarket'), table('Plant Type')],
    /* the two waterfalls AmrPvSlide.renderCharts draws */
    revenueBridge: { pyRev: 33_640_000, volImpact: -2_180_000, priceImpact: 2_960_000, cyRev: 34_420_000 },
    priceBridge: { ppi: 0.0331, totalAsp: 0.0542,
                   items: [{ label: 'Mix', value: 0.0114 }, { label: 'Price', value: 0.0097 }] },
    latestMonth: 7,
    months: [1, 2, 7],
  };
}

/* Ready-Mix. The shape is lifted from tests/segboot.js, which already drives
   the real page through RMX_prepare in a browser — reusing it means this
   harness and that one cannot disagree about what the server sends. */
/* Product Segment reads RMX_getSlideTables. Shape lifted from segboot.js's
   slide() fixture, for the same reason as rmxKeysPayload above. */
const SEG_ROWS = [
  { label:'ICI',             cyVol:33341, cyShare:.40, pyVol:21718, pyShare:.30, volPct:.54,  aspCY:196.71, aspPY:190.97, aspPct:.030 },
  { label:'Res - High Rise', cyVol:22940, cyShare:.28, pyVol:30004, pyShare:.41, volPct:-.24, aspCY:256.25, aspPY:259.21, aspPct:-.011 },
  { label:'Civil',           cyVol:13989, cyShare:.17, pyVol:8356,  pyShare:.11, volPct:.67,  aspCY:312.62, aspPY:261.51, aspPct:.195 },
];
function segmentModel() {
  const tot = t => ({ cyRev:t, pyRev:t*0.8, revPct:.25, aspCY:26.35, aspPY:19.28, aspChg:7.07 });
  return {
    ok: true, market: 'Innocon', period: 'MTD', month: 7, latestMonth: 7,
    months: { all: [1, 2, 3, 4, 5, 6, 7], cy: [1, 2, 3, 4, 5, 6, 7] },
    markets: RMX_MARKETS, allMarkets: '__ALL__', build: 'b1', generation: 'g1',
    segment: { total: { cyVol:83324, pyVol:73398, volPct:.14, aspCY:229.07, aspPY:222.43, aspPct:.03 },
               rows: SEG_ROWS },
    extras: {
      byTypeExtras: [Object.assign({ label:'Cooling' }, tot(2195484))],
      byTypeExtrasTotal: tot(2195484),
      byTypeVap: [Object.assign({ label:'Other VAP' }, tot(547078))],
      byTypeVapTotal: tot(547078),
      byTypeTotal: tot(2742562),
      extras: [], vap: [],
    },
    rowCount: 1000,
  };
}

/* The shared EBITDA workbook, as AmrKpi stores it after an upload:
   { main|mbsk: { name, ts, headers[], rmx: { <marketKey>: { tab, MTD, YTD } } } }.
   Without this the KPI strip renders empty on both sides and the comparison
   proves nothing about it — which is how commenting out segKpiInit() passed. */
function kpiValues() {
  const fig = (u, r, c) => ({ units: u, rev: r, conc: c, raw: { EBITDA: r } });
  const mkt = tab => ({ tab, MTD: fig(83324, 2742562, 229.07), YTD: fig(512004, 17420880, 231.44) });
  return {
    main: { name: 'AGG & RMX EBITDA Report.xlsx', ts: 1755300000000,
            headers: ['Ontario', 'Quebec'],
            rmx: { HNS_SW: mkt('HNS'), North: mkt('North'), Innocon: mkt('Innocon') },
            plant: {} },
    mbsk: null,
  };
}


/* The Deck Builder reads two things before it can draw anything: the template's
   geometry (which drives every preview mock and every capture size) and the
   recipe (which IS the slide list). Four rows, one per adapter shape, so the
   list exercises a KPI Region picker, a row without one, and both layouts. */
function deckModel() {
  const rect = (x, y, w, h, extra) => Object.assign({ x, y, w, h }, extra || {});
  const layout = (id, has) => ({
    layoutId: id, index: 1, role: 'report',
    slots: Object.assign(
      { title: rect(40, 30, 640, 40), image: rect(40, 90, 640, 280, { capturePx: 800, maxPx: 1600 }) },
      has.comment ? { comment: rect(40, 380, 640, 60) } : {}),
    has: { title: true, comment: !!has.comment, image: true, image2: false, label1: false, label2: false },
    tokens: ['title', 'image'].concat(has.comment ? ['comment'] : [])
  });
  return {
    template: {
      templateId: 'TPL1', name: 'Amrize Deck Template',
      pageWidth: 720, pageHeight: 405,
      layouts: [layout('L_FULL_IMAGE', {}), layout('L_COMMENT_IMAGE', { comment: true })],
      reportCount: 2, slideCount: 3
    },
    recipe: {
      rows: [
        { id:'fsc_mtd', source:'fsc',  market:'',            refine:'', period:'MTD', layout:'L_FULL_IMAGE',    title:'AGG Fuel Recovery — MTD', subtitle:'', group:'Fuel',   optional:false },
        { id:'pv_gta',  source:'pv',   market:'GTA',         refine:'', period:'MTD', layout:'L_COMMENT_IMAGE', title:'AGG Price & Volume — GTA', subtitle:'', group:'AGG',   optional:false },
        { id:'seg_sk',  source:'seg',  market:'SASKATCHEWAN',refine:'', period:'YTD', layout:'L_COMMENT_IMAGE', title:'Product Segment — SK',     subtitle:'', group:'RMX',   optional:true  },
        { id:'nope',    source:'ghost',market:'',            refine:'', period:'',    layout:'L_FULL_IMAGE',    title:'A source nothing registers',subtitle:'', group:'Other', optional:false }
      ],
      count: 4, problems: []
    }
  };
}

/* TP01 does everything in the browser until Send, so a boot-time fixture is
   the recipient map — which is also what proves the boot path ran: the two
   "always send to" boxes are filled from it. */
function tp01Model() {
  return { 'ALL::mkt': 'ops@amrize.com', 'ALL::exc': 'controlling@amrize.com',
           'GTA AGG': 'gta@amrize.com', 'EXC::GTA AGG': 'gta.exc@amrize.com' };
}

/* Server replies, by function name. A page asking for anything not listed here
   is a finding, not something to paper over — the runner reports it. */
function serverStubs(model) {
  return {
    /* Deck Builder */
    DECK_readTemplate: () => model.template,
    DECK_getRecipe:    () => model.recipe,
    /* TP01 */
    TP_getRecipients:  () => model,
    TP_saveRecipient:  () => ({ ok: true }),
    getFscData:      () => model,
    getRmxFuelData:  () => model,
    getFscDataFromUpload:     () => model,
    getRmxFuelDataFromUpload: () => model,
    /* Price & Volume */
    getReport:         () => model,
    getCustomerReport: () => ({ MTD: { rows: [], total: null }, YTD: { rows: [], total: null } }),
    getPvMonths:       () => ({ months: model.months || [], latest: model.latestMonth || 0, defaultMonth: 0 }),
    getPvUnmapped:     () => ({ ok: true, sections: [] }),
    getPvLookupForm:   () => ({ ok: true, rows: [], columns: [] }),
    /* the envelope AmrKpi.load expects, not the bare store: it reads
       r.generation / r.cached / r.values and settles to null otherwise */
    getKpiValues:      () => ({ generation: 'kpi-1', cached: false, values: kpiValues() }),
    CUBE_getManifest:  () => ({ ok: false, blocks: [] }),
    /* Ready-Mix */
    RMX_prepare:    () => model,
    RMX_getKeys:    () => model.payload || model,
    RMX_getExtras:  o => ({ ok: true, market: o && o.market, period: o && o.period,
                            byTypeExtras: [], byTypeVap: [], extras: [], vap: [] }),
    RMX_getUnmapped:    () => ({ ok: true, sections: [] }),
    RMX_getSlideTables: () => model,
    RMX_uploadData:     () => ({ ok: true, token: 'tok' }),
    RMX_getSuggestions: () => ({ ok: true, sections: [] }),
    getLogo:         () => '',
    getGuideImages:  ids => (ids || []).map(() => ''),
    getDataVersion:  () => ({ generation: 'test-gen-1' }),
    getSettingsFor:  () => [],
    getAllSettings:  () => [],
  };
}

/* ------------------------------------------------------------ page sources */
/* Resolve a legacy page the way HtmlService would: splice in every include()
   and fill the three template variables doGet sets. */
/* The legacy pages were deleted at the cutover; they come out of git now. This
   harness is a COMPARISON — it needs a second side, and there is no second side
   on disk. See apphtml.js for when the legacy half retires (it is not "when the
   files are gone", it is "when a page is deliberately changed"). */
function legacySource(file, pageId) {
  let src = legacyFile(file);
  const missing = [];
  src = src.replace(/<\?!?=\s*include\('([\w-]+)'\)\s*\?>/g, (_, name) => {
    try { return legacyFile(name + '.html'); }
    catch (e) { missing.push(name); return ''; }
  });
  if (missing.length) throw new Error(`${file}: include() names no file: ${missing.join(', ')}`);
  return fillVars(src, { page: pageId, appUrl: URL_BASE, appMode: 'false' });
}

function mergedSource(pageId) {
  const src = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
  return fillVars(src, { page: pageId, appUrl: URL_BASE, appMode: 'false' });
}

function fillVars(src, vars) {
  return src.replace(/<\?!?=\s*(\w+)\s*\?>/g, (all, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : all);
}

/* --------------------------------------------------------------- the runner */
function boot(html, label, model, pageId) {
  const asked = [];
  const stubs = serverStubs(model);
  const errors = [];

  /* jsdom has no canvas, so every chart logs a "getContext not implemented"
     jsdomError. Both sides get it equally and neither is compared on pixels;
     forwarding the rest keeps real page errors visible. */
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    if (/getContext/.test(String(e && e.message))) return;
    errors.push(`${label}: ${e && e.message}`);
  });
  ['log', 'info', 'warn', 'error'].forEach(m => vc.on(m, () => {}));

  const dom = new JSDOM(html, {
    virtualConsole: vc,
    url: URL_BASE + '?page=' + pageId,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      /* Chart.js. Neither side gets the real one — jsdom fetches no scripts,
         and the legacy page's <script src> is as dead as the merged page's
         injected one — so without a stub BOTH pages throw inside renderCharts
         and stop before their tables, which a diff would happily call a match.
         The stub records what it was asked to draw and nothing more: a canvas
         cannot be diffed, and what this harness is for is the DOM around it. */
      window.Chart = function (ctx, cfg) {
        this.config = cfg; this.data = cfg && cfg.data;
        this.update = function () {}; this.destroy = function () {};
        this.resize = function () {}; this.toBase64Image = function () { return ''; };
        this.getDatasetMeta = function () { return { data: [] }; };
      };
      window.Chart.register = function () {};
      window.Chart.defaults = { font: {}, plugins: { legend: {}, tooltip: {} }, scale: {} };

      /* CDN libraries: jsdom fetches nothing, so an injected <script src> would
         leave AmrLib's promise pending forever and boot() would never run. */
      const create = window.document.createElement.bind(window.document);
      window.document.createElement = function (tag) {
        const el = create(tag);
        if (String(tag).toLowerCase() === 'script') {
          let src = '';
          Object.defineProperty(el, 'src', {
            get() { return src; },
            set(v) { src = v; setTimeout(() => el.onload && el.onload(), 0); },
          });
        }
        return el;
      };

      /* The server. Each `google.script.run` read hands back a fresh runner, as
         the real one does, so two calls in flight cannot steal each other's
         handlers. The chaining methods return the PROXY, not the object behind
         it — returning the target is what breaks `.withSuccessHandler(f)
         .getFscData()`, and it fails as "getFscData is not a function". Every
         call records its name, so an unstubbed one is reported rather than
         quietly resolving to undefined. */
      function runner() {
        let ok = null, bad = null;
        const api = {};
        const proxy = new Proxy(api, {
          get(t, prop) {
            if (prop === 'withSuccessHandler') return f => { ok = f; return proxy; };
            if (prop === 'withFailureHandler') return f => { bad = f; return proxy; };
            if (typeof prop !== 'string') return undefined;
            return function (...args) {
              asked.push(prop);
              setTimeout(() => {
                if (!stubs[prop]) {
                  errors.push(`${label}: no stub for google.script.run.${prop}()`);
                  bad && bad(new Error('no stub for ' + prop));
                  return;
                }
                try { ok && ok(stubs[prop](...args)); }
                catch (e) { errors.push(`${label}: stub ${prop} threw ${e.message}`); bad && bad(e); }
              }, 0);
            };
          },
        });
        return proxy;
      }
      Object.defineProperty(window, 'google', {
        value: { script: { get run() { return runner(); }, host: { close() {} } } },
        writable: true,
      });

      window.addEventListener('error', e => errors.push(`${label}: ${e.message || e.error}`));
    },
  });

  return { dom, window: dom.window, asked, errors };
}

const settle = ms => new Promise(r => setTimeout(r, ms));

/* --------------------------------------------------------------- the cases */
const PAGES = [
  {
    id: 'fuelsurcharge',
    legacy: 'Page_FuelSurcharge.html',
    model: fscModel,
    /* Views to walk, by the data-v the rail's segmented control carries, and
       how to read this page: which host holds the payload that must be
       byte-identical, and which controls the data fills in. */
    views: ['EXEC', 'EXEC_MTD', 'MTD', 'YTD', 'BYMONTH'],
    viewButton: v => `#viewSeg button[data-v="${v}"]`,
    payload:   { host: 'tablesHost', inner: '.card' },
    readHtml:  { markets: 'mktList', months: 'fscMonthSel' },
    readValue: { title: 'titleIn' },
    readText:  { status: 'loadStat' },
    /* the fixture puts an unmatched customer in the Saskatchewan sheet, so the
       notice above the tables must appear on both sides */
    expectNotice: 'Saskatchewan increase',
    /* Everything the legacy page had that is NOT diffable, because the merged
       page provides it differently: one shared guide instead of a copy, a
       delegated hint handler instead of a per-page one, one page switcher. */
    chrome: {
      guideSteps: 2,             // the guide mounted, with this page's steps
      guideExtra: 'upGo',        // an id from the panel the page hands the guide
      hint: 'FSC Flag',          // text the "?" button must put in the modal
      /* Names that were top-level in Page_FuelSurcharge.html. Every one of them
         must now be a local of the registration IIFE — that is the whole reason
         twenty pages can share one document. */
      noGlobals: ['DATA', 'STATE', 'NUM_OV', 'TXT_OV', 'DERIVED', 'loadData',
                  'renderAll', 'computeAll', 'esc', 'fInt', 'applyView',
                  'buildContent', 'currentViewHTML', 'patchDerived'],
      modules: ['AMR', 'AmrSlide', 'AmrFuelExec', 'AmrProgress', 'AmrBoot',
                'AmrFresh', 'AmrHint', 'AmrQlikGuide'],
    },
  },
  {
    /* The heaviest page, and the only one whose payload is a LIST of cards —
       one per selected dimension — rather than a single table. */
    id: 'pricevolume',
    legacy: 'Page_PriceVolume.html',
    model: pvModel,
    views: ['markets', 'customers'],
    viewButton: v => `#viewNav button[data-view="${v}"]`,
    payload:   { host: 'tables' },
    /* custHost and viewNav are here because without them switching views was
       unobservable: #tables belongs to the Markets view and does not change
       when Customers is shown, so breaking switchView() passed clean. */
    readHtml:  { months: 'monthSel', filterValue: 'filterValue', dims: 'dimChips',
                 custHost: 'custHost', nav: 'viewNav' },
    readText:  { bridgeMeta: 'bridgeMeta', tableMeta: 'tableMeta', scope: 'scopeLabel',
                 custMeta: 'custMeta' },
    chrome: {
      guideSteps: 2,
      guideExtra: 'upRaw',
      hint: 'Combined Data CPI Raw',
      /* A sample of the 133 names that were top-level on this page. `AMR` is
         in the list for a reason: the page declared `var AMR` (a dead colour
         alias) which would have shadowed the runtime for every line inside
         the IIFE. It is deleted, and this is what keeps it deleted. */
      /* `AMR` is deliberately NOT in this list — it is the runtime's own
         global and is always present. That the page's dead `var AMR` is gone
         is checked by merge.js's no-shadow rule instead, which can see the
         source rather than only the window. */
      noGlobals: ['CONFIG', 'STATE', 'KPI', 'DIMS', 'charts', 'load',
                  'onData', 'renderTables', 'renderCharts', 'renderCustomers',
                  'loadCustomers', 'switchView', 'esc', 'fInt', 'syncData',
                  'wirePvCube', 'pvCtx', 'slideTitle', 'kpiInit', 'syncKpiName'],
      modules: ['AMR', 'AmrSlide', 'AmrCache', 'AmrKpi', 'AmrCube', 'AmrPvSlide',
                'AmrProgress', 'AmrBoot', 'AmrFresh', 'AmrHint', 'AmrQlikGuide'],
    },
  },
  {
    /* Commercial Product Segment. One view; the case is really about the three
       tables and the KPI strip, both of which AmrSegSlide also renders. */
    id: 'segment',
    legacy: 'Page_Segment.html',
    model: segmentModel,
    views: ['__mounted__'],
    viewButton: () => '',
    payload:   { host: 'tablesHost' },
    readHtml:  { preview: 'previewHost', markets: 'marketSel', months: 'monthSel',
                 kpi: 'segKpiStrip' },
    readValue: { title: 'titleIn', sub: 'subIn' },
    readText:  { status: 'loadStat' },
    /* Pick a market that HAS a KPI row, so #segKpiStrip is actually compared. */
    setup: win => {
      const sel = win.document.getElementById('marketSel');
      sel.value = 'Innocon';
      sel.dispatchEvent(new win.Event('change', { bubbles: true }));
    },
    chrome: {
      guideSteps: 3,
      guideExtra: 'upMain',
      hint: 'Main Raw Data',
      noGlobals: ['STATE', 'DATA', 'CACHE', 'esc', 'fInt', 'renderTables',
                  'renderTable', 'renderPreview', 'loadTables', 'applyData',
                  'segKpiInit', 'segPageInit', 'buildSlideContent', 'exportPNG',
                  'updateFromSheets', 'autoTitle', 'fitTables'],
      modules: ['AMR', 'AmrSlide', 'AmrCache', 'AmrKpi', 'AmrSegSlide',
                'AmrProgress', 'AmrBoot', 'AmrFresh', 'AmrHint', 'AmrQlikGuide'],
    },
  },
  {
    /* Ready-Mix. One view, so `views` is the single mount — what this case is
       really for is the breakdown chips and the period control, which rebuild
       the tables without going back to the server. */
    id: 'rmx',
    legacy: 'Page_Rmx.html',
    model: rmxModel,
    views: ['__mounted__'],
    viewButton: () => '',
    payload:   { host: 'tablesHost' },
    readHtml:  { extras: 'extrasHost', chips: 'chips', extraChips: 'extraChips',
                 market: 'market', months: 'monthSel', preview: 'previewHost' },
    /* the two ids this port renamed onto the suite's shared names */
    legacyIds: { previewHost: 'rmxPreviewHost', sugHost: 'sugModalHost' },
    readText:  { stamp: 'syncStamp', banner: 'bannerText' },
    chrome: {
      guideSteps: 3,
      guideExtra: 'upMain',
      /* Ready-Mix registers no AmrHint, so no `hint` here — asserting one
         would fail for the right reason on the wrong page. */
      noGlobals: ['STATE', 'IS_LIVE', 'esc', 'fInt', 'refresh', 'renderNow',
                  'buildTables', 'renderReport', 'renderExtras', 'doSync',
                  'loadUnmapped', 'openSug', 'closeSug', 'rmxPageInit',
                  'buildRmxContent', 'renderRmxPreview', 'exportComposite'],
      modules: ['AMR', 'AmrSlide', 'AmrCache', 'AmrProgress', 'AmrBoot',
                'AmrFresh', 'AmrHint', 'AmrQlikGuide'],
    },
  },
  {
    /* The Deck Builder. Its whole script was TOP LEVEL — no IIFE at all — so
       every one of its nine inline handlers resolved against window and none
       of them survives a registration. Six were in the markup; three were
       written into generated rows. This case reads the list after Plan, then
       unticks a slide, which is the only way to find out whether the delegated
       handler that replaced the inline onchange actually fires. */
    id: 'deckbuilder',
    legacy: 'Page_DeckBuilder.html',
    model: deckModel,
    views: ['__planned__', '__toggled__'],
    viewButton: () => '',
    /* Plan on both sides first — the list is empty until the recipe lands. */
    setup: async win => {
      win.document.getElementById('dbBtnPlan')
         .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 120));
    },
    drive: (win, view) => {
      if (view !== '__toggled__') return;
      const box = win.document.querySelector('#dbList .db-row input[type=checkbox]');
      if (!box) throw new Error('no slide checkbox in #dbList');
      box.checked = false;
      box.dispatchEvent(new win.Event('change', { bubbles: true }));
    },
    payload:  { host: 'dbList' },
    /* the list holds a "press Plan" note until the recipe lands, so what proves
       both sides rendered is the note, and the rows are proved by the diff */
    expectMarkup: 'db-note',
    readHtml: { tpl: 'dbTplInfo', sources: 'dbSources', month: 'dbMonth', banners: 'dbBanners' },
    readText: { prog: 'dbProg' },
    /* The three attributes the port moved, and nothing else. The legacy side
       writes inline handlers, the merged side data attributes; every figure,
       class, id and title in those 4 rows is still compared byte for byte. */
    normalise: t => t
      .replace(/ onchange="db(?:PickKpi|Toggle)\([^"]*\)"/g, '')
      .replace(/ onclick="dbOpenLb\([^"]*\)"/g, '')
      .replace(/ data-db-(?:kpi|toggle|lb)="\d+"/g, ''),
    chrome: {
      /* no guide and no "?" hint on this page — asserting either would fail
         for the right reason on the wrong page */
      noGlobals: ['ROWS', 'TPL', 'BUSY', 'DECK_MONTH', 'dbPlan', 'dbRenderAll',
                  'dbPublish', 'dbValidate', 'dbLoadTemplate', 'dbToggle',
                  'dbPickKpi', 'dbOpenLb', 'dbCloseLb', 'rowHtml', 'redraw',
                  'esc', 'srv', 'banner', 'prog', 'setBusy', 'dbPageInit'],
      modules: ['AMR', 'AmrSlide', 'AmrTick', 'AmrDeckSource', 'AmrKpi',
                'AmrCache', 'AmrPvSlide', 'AmrSegSlide', 'AmrRmxSlide',
                'AmrFuelExec', 'AmrProgress', 'AmrBoot', 'AmrFresh'],
    },
  },
  {
    /* TP01. Everything happens in the browser until Send, so there is little
       to diff before a workbook is dropped — and that is not what this case is
       for. Its risk is that the page had ~90 top-level names and eleven inline
       handlers, all of which resolved against window and none of which can. */
    id: 'tp01',
    legacy: 'Page_TP01.html',
    model: tp01Model,
    views: ['__mounted__', '__typed__'],
    viewButton: () => '',
    /* Type into the "always send to" box. It is the one control on this page
       reachable without a workbook, and its handler is one of the eleven the
       port moved off an inline on*= attribute. */
    drive: (win, view) => {
      if (view !== '__typed__') return;
      const el = win.document.getElementById('alwaysto-mkt');
      if (!el) throw new Error('no #alwaysto-mkt');
      el.value = 'new.recipient@amrize.com';
      el.dispatchEvent(new win.Event('change', { bubbles: true }));
    },
    readAsked: true,
    payload:  { host: 'marketList' },
    expectMarkup: 'exc-empty',
    readHtml: { exc: 'excList', pills: 'colPills', stats: 'statsGrid', status: 'status' },
    /* filled from the recipient map, so a boot that never ran is visible */
    readValue: { alwaysMkt: 'alwaysto-mkt', alwaysExc: 'alwaysto-exc' },
    chrome: {
      guideSteps: 1,             // the seventh and last copy, now one mount
      noGlobals: ['sapData', 'qlkBytes', 'sapWB', 'compWB', 'savedRecips',
                  'showStatus', 'slug', 'recipKey', 'parseEmails', 'alwaysList',
                  'onAlwaysToChange', 'recipientsFor', 'onRecipChange',
                  'downloadSAP', 'downloadComparison', 'downloadMarket',
                  'emailMarket', 'sendAll', 'sendAsOne', 'renderPanels',
                  'marketDataMap', 'excDataMap', 'setupDrop'],
      modules: ['AMR', 'AmrHint', 'AmrQlikGuide', 'AmrProgress', 'AmrBoot'],
    },
  },
  {
    /* The Ready-Mix twin. It shares 21 ids with the case above ON PURPOSE
       (PLAN.md §3) — that is not a mistake to be fixed, and the two cases
       being nearly identical is the point. */
    id: 'rmxfuel',
    legacy: 'Page_RmxFuel.html',
    model: rmxFuelModel,
    views: ['EXEC', 'EXEC_MTD', 'MTD', 'YTD', 'BYMONTH'],
    viewButton: v => `#viewSeg button[data-v="${v}"]`,
    payload:   { host: 'tablesHost', inner: '.card' },
    readHtml:  { markets: 'mktList', months: 'fscMonthSel' },
    readValue: { title: 'titleIn' },
    readText:  { status: 'loadStat' },
    /* no expectNotice: Ready-Mix has no Saskatchewan section */
    chrome: {
      guideSteps: 2,
      guideExtra: 'upMain',      // the one export, where AGG needs two
      hint: 'Bill Month carries the year',
      noGlobals: ['DATA', 'STATE', 'NUM_OV', 'TXT_OV', 'DERIVED', 'loadData',
                  'renderAll', 'computeAll', 'esc', 'fInt', 'applyView',
                  'buildContent', 'currentViewHTML', 'patchDerived', 'cyY', 'pyY'],
      modules: ['AMR', 'AmrSlide', 'AmrFuelExec', 'AmrProgress', 'AmrBoot',
                'AmrFresh', 'AmrHint', 'AmrQlikGuide'],
    },
  },
];

/* The merged page's shared chrome. Only the merged side has any of this, so it
   is asserted rather than diffed. */
function checkChrome(win, spec, id, ok, fail) {
  const doc = win.document;
  let n = 0;
  const t = (name, cond, extra) => {
    n++;
    if (cond) ok(`${id} · chrome · ${name}`);
    else fail(`${id} · chrome · ${name}${extra ? ' — ' + extra : ''}`);
  };

  /* Only seven of the ten pages ever had a QlikView guide. Asserting one on a
     page that never had it fails for the right reason on the wrong page —
     the same call chunk 6 made about AmrHint on Ready-Mix — so a case opts in
     by declaring how many steps it expects. */
  const guide = doc.getElementById('qlikGuide');
  if (spec.guideSteps != null) {
    t('QlikView guide mounted', !!guide);
    if (guide) {
      const got = guide.querySelectorAll('#qlikGuideSteps p').length;
      t(`guide has ${spec.guideSteps} steps`, got === spec.guideSteps, `got ${got}`);
    }
    t('guide FAB mounted', !!doc.getElementById('qgFab'));
  }
  if (spec.guideExtra) {
    t('the page\'s own guide panel moved into the aside',
      !!(guide && guide.querySelector('#' + spec.guideExtra)));
    t('...and left #appRoot',
      !doc.getElementById('appRoot').querySelector('#' + spec.guideExtra));
  }

  if (spec.hint) {
    const qm = doc.querySelector('.amr-qm');
    t('source-hint "?" button present', !!qm);
    if (qm) {
      qm.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      t('...opens the hint modal', doc.getElementById('amrHintModal').classList.contains('amr-open'));
      t('...with this page\'s hint in it',
        doc.getElementById('amrHintBody').innerHTML.includes(spec.hint));
      doc.getElementById('amrHintModal').classList.remove('amr-open');
    }
  }

  const sel = doc.querySelector('select.amr-pageSel');
  t('page switcher mounted in the header', !!sel);
  t('...showing this page', !!sel && sel.value === id, sel ? sel.value : '');

  const leaked = (spec.noGlobals || []).filter(k => k in win);
  t('the registration leaked no globals', leaked.length === 0, leaked.join(', '));

  const absent = (spec.modules || []).filter(k => !(k in win));
  t('every module the page needs is present', absent.length === 0, absent.join(', '));

  return n;
}

/* What is read out of a booted page and compared.

   `tables` is the .card INSIDE #tablesHost, not the host itself, and that split
   is the point: the card is the payload — every figure, every class, every
   total — and it must be byte-identical. What sits beside it is chrome the
   merge is allowed to restyle, and it is compared as TEXT so the words and
   numbers still have to match even when the markup carrying them does not.
   (Chunk 3 is exactly that case: the Saskatchewan notice's inline hex became
   the §A3 .notice component. Same sentence, different wrapper.) */
function snapshot(win, page, side) {
  const doc = win.document;
  /* A port may rename an id where the merged page adopts a name the suite
     already uses for that role — Ready-Mix's #rmxPreviewHost became
     #previewHost. `legacyIds` maps the new name back to the old one for the
     legacy side, so the rename is DECLARED and the comparison still happens,
     rather than the reading being quietly dropped. */
  const map = id => (side === 'legacy' && page.legacyIds && page.legacyIds[id]) || id;
  const txt = i => { const id = map(i); const e = doc.getElementById(id); return e ? e.innerHTML : '(missing #' + id + ')'; };
  const val = i => { const id = map(i); const e = doc.getElementById(id); return e ? e.value : '(missing #' + id + ')'; };

  const host = doc.getElementById(map(page.payload.host));
  const card = host && (page.payload.inner ? host.querySelector(page.payload.inner) : host);
  const aside = page.payload.inner
    ? [].filter.call(host ? host.children : [], el => !el.matches(page.payload.inner))
    : [];

  const out = {
    tables: card ? card.innerHTML
                 : `(no ${page.payload.inner || 'element'} in #${page.payload.host})`,
    notice: aside.map(el => el.textContent.replace(/\s+/g, ' ').trim()).join(' | '),
  };
  for (const [key, id] of Object.entries(page.readHtml || {})) out[key] = txt(id);
  /* A port is allowed to change HOW a handler is attached — inline on*= is
     what breaks inside a registration IIFE — so a case may declare exactly
     which attributes to drop before comparing. Everything else in the markup
     still has to match byte for byte, and whether the new handler actually
     fires is proved by driving it, not by reading it. */
  if (page.normalise) for (const k of Object.keys(out)) out[k] = page.normalise(String(out[k]));
  for (const [key, id] of Object.entries(page.readValue || {})) out[key] = val(id);
  for (const [key, i] of Object.entries(page.readText || {})) {
    const id = map(i); const e = doc.getElementById(id);
    out[key] = e ? e.textContent : '(missing #' + id + ')';
  }
  return out;
}

function clickView(win, view, page) {
  /* Most pages switch view with a button. Some do not: the Deck Builder's
     second reading is taken after unticking a slide, which is a checkbox and a
     `change` event, and driving it is the POINT of that case — the port moved
     its handler from an inline onchange to a delegated one, and a diff of the
     markup alone would pass whether or not anything still listens. */
  if (page.drive) return page.drive(win, view);
  const b = win.document.querySelector(page.viewButton(view));
  if (!b) throw new Error(`no view button ${page.viewButton(view)}`);
  b.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
}

/* ------------------------------------------------------------------- main */
(async function main() {
  let checks = 0, fails = 0;
  const fail = msg => { fails++; console.log(`  FAIL  ${msg}`); };
  const ok   = msg => console.log(`  ok    ${msg}`);

  for (const page of PAGES) {
    const model = page.model();
    const A = boot(legacySource(page.legacy, page.id), 'legacy', model, page.id);
    const B = boot(mergedSource(page.id), 'merged', model, page.id);

    await settle(300);

    for (const side of [A, B]) side.errors.forEach(e => fail(e));

    /* Both must actually have rendered — two identically empty pages are not a
       pass, and that is the failure mode a naive diff would call green. The
       fixture carries an unmatched Saskatchewan customer for the same reason:
       a notice that silently stopped rendering would otherwise read as a match. */
    for (const [name, side] of [['legacy', A], ['merged', B]]) {
      const snap = snapshot(side.window, page, name);
      checks++;
      /* Both sides must actually have rendered — two identically empty pages
         are not a pass, and that is the failure mode a naive diff calls green.
         Most pages prove it with a <table>; the ones that do not say what to
         look for instead. The Deck Builder's list is empty until Plan runs, so
         its marker is checked after `setup`, not here. */
      const want = page.expectMarkup || '<table';
      if (page.expectMarkup === false) { checks--; }
      else if (snap.tables && snap.tables.includes(want)) ok(`${page.id} · ${name} rendered ${want}`);
      else fail(`${page.id} · ${name} rendered no ${want} — got ${JSON.stringify(String(snap.tables).slice(0, 120))}`);
      if (page.expectNotice) {
        checks++;
        if (snap.notice && snap.notice.includes(page.expectNotice)) ok(`${page.id} · ${name} rendered the data notice`);
        else fail(`${page.id} · ${name} lost the data notice — got ${JSON.stringify(String(snap.notice).slice(0, 120))}`);
      }
    }

    /* An optional per-case setup, run on BOTH sides before anything is
       compared. Some state is only reachable by driving a control: Product
       Segment opens on Central Canada, which has no KPI row, so its strip is
       legitimately empty until a market with one is picked. Without this the
       strip is compared empty-to-empty and proves nothing. */
    if (page.setup) {
      for (const side of [A, B]) await page.setup(side.window);
      await settle(120);
    }

    if (page.chrome) checks += checkChrome(B.window, page.chrome, page.id, ok, fail);

    for (const view of page.views) {
      if (view !== page.views[0]) {
        clickView(A.window, view, page); clickView(B.window, view, page); await settle(60);
      }
      const a = snapshot(A.window, page, 'legacy'), b = snapshot(B.window, page, 'merged');
      /* Some rewiring has no DOM to read: TP01's "always send to" box saves
         through the server and changes nothing on screen, so what proves its
         listener survived the move off an inline onchange is that both sides
         asked the server the same things in the same order. */
      if (page.readAsked) { a.asked = A.asked.join(','); b.asked = B.asked.join(','); }
      /* DUMP=<page id> prints what this case actually compares. Worth running
         when a mutation you expected to fail passes instead — usually the
         reading is not looking at the thing you changed. */
      if (process.env.DUMP === page.id) {
        console.log('--- DUMP', page.id, view, '---');
        for (const k of Object.keys(a)) console.log(k, '=', JSON.stringify(String(a[k]).slice(0, 400)));
      }
      for (const key of Object.keys(a)) {
        checks++;
        if (a[key] === b[key]) { ok(`${page.id} · ${view} · ${key}`); continue; }
        fail(`${page.id} · ${view} · ${key}`);
        let i = 0;
        const x = String(a[key]), y = String(b[key]);
        while (i < x.length && i < y.length && x[i] === y[i]) i++;
        console.log(`        first diff at ${i}`);
        console.log(`        legacy: ${JSON.stringify(x.slice(Math.max(0, i - 50), i + 70))}`);
        console.log(`        merged: ${JSON.stringify(y.slice(Math.max(0, i - 50), i + 70))}`);
      }
    }

    A.window.close(); B.window.close();
  }

  console.log(`\n${checks} comparisons, ${fails} failed.`);
  console.log(fails ? 'REGRESSION — the merged page does not render what the old one does.'
                    : 'IDENTICAL — the merged page renders what the old one does.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
