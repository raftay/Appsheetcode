#!/usr/bin/env node
/* =============================================================================
 * tests/deckarrange.js — the Arrange stage, driven, against the REAL server
 * -----------------------------------------------------------------------------
 * deckstatic.js proves the two stores in isolation and deckpath.js proves the
 * adapters honour what those stores resolve to. Neither runs the page. This
 * does — and it does it against the actual §9 functions rather than a stub, so
 * the thing under test is the WHOLE round trip: the page builds a plan, the
 * server normalises and stores it, and the next Plan reads it back.
 *
 * WHY NOT A pageparity CASE. That harness compares this page against the one it
 * was ported from, and the page it was ported from has no Arrange stage. There
 * is no second side, so there is nothing to diff; what there is instead is a
 * behaviour worth asserting, which is what this file does. pageparity keeps its
 * own job: #dbList's rows are still compared byte for byte, and nothing here is
 * allowed to change that.
 *
 * THE ONE RULE EVERY CHECK BELOW COMES BACK TO. Nothing stored means the deck
 * is DECK_RECIPE, byte for byte. An arrangement that saved what was on screen
 * rather than what DIFFERS from the recipe would freeze all 43 rows the first
 * time anybody pressed a button, and the next person to re-point a slide in
 * code would change nothing and have no way to see why.
 *
 *   node tests/deckarrange.js
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (e) {
  console.error('jsdom is not installed where this script can see it.\n' +
    '  npm install jsdom --prefix ' + path.resolve(__dirname, '..'));
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..');
const { region } = require('./scriptgs.js');
const URL_BASE = 'https://script.google.com/macros/s/TESTDEPLOY/exec';

let failed = 0, ran = 0;
function check(label, ok, detail) {
  ran++;
  if (!ok) failed++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label +
    (ok || !detail ? '' : '\n         ' + detail));
}
function section(t) { console.log('\n' + t); }

/* ---------------------------------------------------------------------------
 * THE SERVER, FOR REAL. Config.gs, Deck_Backend.gs and Deck_Recipe.gs into one
 * vm context, exactly as Apps Script evaluates them into one global scope, over
 * a Script Property store that is a plain object. Nothing here calls SlidesApp:
 * the four functions the Arrange stage uses — getRecipe, setPlan, setTables,
 * resetTables — are the ones that deliberately make no Slides call, which is
 * what keeps Plan instant and what makes this harness possible at all.
 * ------------------------------------------------------------------------- */
let PROPS = {};
const server = (() => {
  const ctx = {
    Logger: { log() {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in PROPS ? PROPS[k] : null),
        setProperty: (k, v) => { PROPS[k] = String(v); },
        deleteProperty: k => { delete PROPS[k]; },
      }),
    },
  };
  vm.createContext(ctx);
  for (const f of ['Config.gs', 'Deck_Backend.gs', 'Deck_Recipe.gs']) {
    vm.runInContext(region(f), ctx, { filename: 'script.gs (' + f + ')' });
  }
  return ctx;
})();
const RECIPE_IDS = server.DECK_RECIPE.map(r => r.id);
const plan = () => (PROPS[server.DECK_CONFIG.PROP_PLAN]
  ? JSON.parse(PROPS[server.DECK_CONFIG.PROP_PLAN]) : null);
const tableMap = () => (PROPS[server.DECK_CONFIG.PROP_TABLES]
  ? JSON.parse(PROPS[server.DECK_CONFIG.PROP_TABLES]) : null);

/* The template the page reads its geometry from. Every layout DECK_RECIPE
   names has to be here or the page banners the row and the list reads as
   broken for the wrong reason. */
function template() {
  const rect = (x, y, w, h, extra) => Object.assign({ x, y, w, h }, extra || {});
  const names = [...new Set(server.DECK_RECIPE.map(r => r.layout))];
  return {
    templateId: 'TPL1', name: 'Amrize Deck Template',
    pageWidth: 720, pageHeight: 405,
    layouts: names.map((id, i) => ({
      layoutId: id, slide: i + 1, role: 'report',
      slots: { title: rect(40, 30, 640, 40), comment: rect(40, 340, 640, 50),
               image: rect(40, 90, 640, 240, { capturePx: 800, maxPx: 2048 }) },
      tokens: ['title', 'comment', 'image'],
    })),
  };
}

/* A Price & Volume payload the render path can actually build a slide out of.
   getReport is modelled the way it really behaves — a table per requested
   dimension, pushed in the SERVER's order whatever order the request used —
   because the adapter reorders what comes back and a fixture that handed them
   over pre-sorted would test nothing. */
const PV_ORDER = [
  ['REGION', 'Region'], ['MARKET', 'Market'], ['SUBMARKET1', 'Submarket'],
  ['PLANT_TYPE', 'Plant Type'], ['MATERIAL_FAM', 'Material Family'],
  ['PROD_CLASS', 'Product Class'], ['PLANT', 'Plant'], ['MATERIAL', 'Material'],
  ['CUST_SEGMENT', 'Customer Segment'],
];
function pvReport(o) {
  const want = (o && o.dimensions) || ['SUBMARKET1', 'PLANT_TYPE', 'PROD_CLASS'];
  const total = { cyVol: 2266382, pyVol: 2444425, volPct: -0.073, cyAsp: 17.11,
                  pyAsp: 16.64, aspPct: 0.028, ppi: 0.03 };
  return {
    ok: true, period: (o && o.period) || 'MTD', filterField: 'MARKET',
    filterValue: (o && o.filterValue) || '__ALL__', filterOptions: [],
    refineValue: '__ALL__', refineMode: 'include',
    refineOptions: ['SW Land', 'SW DOCKS'], latestMonth: 7, rowCount: 1,
    tables: PV_ORDER.filter(([k]) => want.indexOf(k) !== -1).map(([k, label]) => ({
      dimension: label, key: k, volMix: -0.002, total: total,
      rows: [{ label: 'A', cyVol: 1282643, pyVol: 1390172, volPct: -0.077,
               cyAsp: 15.1, pyAsp: 14.47, aspPct: 0.044, ppi: 0.026 }],
    })),
    revenueBridge: { pyRev: 40668495, volImpact: -2962143, priceImpact: 1061457, cyRev: 38767809 },
    priceBridge: { ppi: 0.03, totalAsp: 0.028, items: [{ label: 'Region/Market mix', value: -0.003 }] },
  };
}

/* What Publish sent, so the arrangement can be followed all the way to the
   deck. The three writers are real globals but every one of them opens Slides,
   which is the one thing off-platform cannot do — so they are taken back here
   and record their arguments instead. */
const PUBLISHED = { slides: [], finish: null };

/* Everything the page asks for that is NOT the deck's own server half. */
const OTHER = {
  DECK_create: () => ({ deckId: 'D1', name: 'Deck',
                        url: 'https://docs.google.com/presentation/d/D1/edit' }),
  DECK_addSlide: (id, spec) => { PUBLISHED.slides.push(spec.recipeId); return { recipeId: spec.recipeId }; },
  DECK_finish: (id, order) => { PUBLISHED.finish = order || null;
    return { deckId: id, url: 'https://docs.google.com/presentation/d/D1/edit',
             slides: PUBLISHED.slides.length, templateSlidesParked: 2 }; },
  getReport: pvReport,
  getCustomerReport: () => ({ rows: [], total: null }),
  RMX_getKeys: () => ({ market: 'X', period: 'MTD', latestMonth: 7,
                        rows: [], plants: [], keys: [], breakdowns: [] }),
  RMX_getSlideTables: () => ({ market: 'X', period: 'MTD', latestMonth: 7,
                               segment: { rows: [], total: null }, extras: { extras: [], vap: [] } }),
  getFscData: () => ({ markets: [], exec: { MTD: { all: [], applied: [] },
                                            YTD: { all: [], applied: [] } } }),
  getRmxFuelData: () => ({ markets: [], exec: { MTD: { all: [], applied: [] },
                                                YTD: { all: [], applied: [] } } }),
  DECK_readTemplate: () => template(),
  getKpiValues: () => ({ generation: 'kpi-1', cached: false,
                         values: { main: null, mbsk: null } }),
  getDataVersion: () => ({ generation: 'gen-1' }),
  /* Render opens with the source check — deliberately, and it is not
     skippable — so it has to be answerable here. Nothing has moved, which is
     the normal answer and the one that leaves every picture alone. */
  updateFromSource: () => ({ ok: true, changed: false, generation: 'gen-1' }),
  getSourceTimes: () => ({ ok: true, sources: [] }),
  getLogo: () => '',
  getGuideImages: ids => (ids || []).map(() => ''),
  getSettingsFor: () => [],
  getAllSettings: () => [],
  CUBE_getManifest: () => ({ ok: false, blocks: [] }),
};

/* --------------------------------------------------------------- the page */
function mount() {
  const html = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8')
    .replace(/<\?!?=\s*(\w+)\s*\?>/g, (all, name) =>
      ({ page: 'deckbuilder', appUrl: URL_BASE, appMode: 'false' }[name] !== undefined
        ? { page: 'deckbuilder', appUrl: URL_BASE, appMode: 'false' }[name] : all));

  const errors = [], asked = [];
  /* How long a server reply takes. 0 for everything above; the render checks
     slow the DATA calls down so a change can be made WHILE a pass is running,
     which is the case the live queue exists for.

     ONLY THE DATA CALLS. The arrangement's four writers open no sheet and no
     template — that is the whole reason the stage can save optimistically and
     correct itself on the answer — so leaving them instant is not making the
     harness convenient, it is modelling the difference the design rests on. */
  const delay = { ms: 0, of: name => (/^DECK_/.test(name) ? 0 : delay.ms) };
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String(e && e.message);
    if (/getContext|Not implemented/.test(m)) return;
    errors.push(m);
  });
  ['log', 'info', 'warn', 'error'].forEach(m => vc.on(m, () => {}));

  const dom = new JSDOM(html, {
    virtualConsole: vc, url: URL_BASE + '?page=deckbuilder',
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      /* HTML2CANVAS, MINUS THE CANVAS. The staleness checks need rows that
         actually HAVE a picture, and the only honest way to get one is to run
         the render loop. What comes back is not compared — a canvas cannot be
         — so the stub answers with the shape captureBare reads and nothing
         more. It resolves on its own timer, which is what the real one does. */
      win.html2canvas = () => new Promise(res => setTimeout(() => res({
        width: 800, height: 450, toDataURL: () => 'data:image/png;base64,AA',
      }), 5));
      /* Chart.js. `options` is not decoration: captureChart turns the
         animation off and the devicePixelRatio up around a capture and puts
         both back afterwards, so a chart object without one throws inside the
         render loop and every slide that draws a chart fails. */
      win.Chart = function (c, cfg) {
        this.config = cfg; this.data = cfg && cfg.data;
        this.options = (cfg && cfg.options) || {};
        this.canvas = c && c.canvas ? c.canvas : null;
        this.update = () => {}; this.destroy = () => {};
        this.resize = () => {}; this.draw = () => {};
        this.toBase64Image = () => 'data:image/png;base64,AA';
        this.getDatasetMeta = () => ({ data: [] });
      };
      win.Chart.register = () => {}; win.Chart.defaults = { font: {}, plugins: {}, scale: {} };
      /* jsdom fetches nothing, so an injected <script src> would leave AmrLib's
         promise pending for ever and boot() would never run. */
      const create = win.document.createElement.bind(win.document);
      win.document.createElement = function (tag) {
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
      /* Deleting a slide and resetting the arrangement both confirm first —
         they are shared and they are destructive, which is exactly when a
         page should ask. The harness always says yes; the check that the
         question is asked at all is below. */
      win.__confirms = [];
      win.confirm = msg => { win.__confirms.push(String(msg)); return true; };

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
                try {
                  /* THE REAL FUNCTION where there is one, and OTHER wins
                     where it is listed. DECK_readTemplate is a real global
                     too — it just opens the template, which is a SlidesApp
                     call and the one thing this harness cannot make — so the
                     fixture has to be able to take a name back.

                     google.script.run serialises, so the arguments cross a
                     realm boundary here exactly as they do live, which is the
                     thing that caught `x instanceof Array` in the stores. */
                  const fn = OTHER[prop]
                    || (typeof server[prop] === 'function' ? server[prop] : null);
                  if (!fn) {
                    errors.push('no stub for google.script.run.' + prop + '()');
                    return bad && bad(new Error('no stub for ' + prop));
                  }
                  const out = fn(...args);
                  ok && ok(JSON.parse(JSON.stringify(out === undefined ? null : out)));
                } catch (e) { bad && bad(e); }
              }, delay.of(prop));
            };
          },
        });
        return proxy;
      }
      Object.defineProperty(win, 'google', {
        value: { script: { get run() { return runner(); }, host: { close() {} } } },
        writable: true,
      });
      win.addEventListener('error', e => errors.push(String(e.message || e.error)));
    },
  });
  return { win: dom.window, errors, asked, delay };
}

const settle = ms => new Promise(r => setTimeout(r, ms));

/* --------------------------------------------------------------- driving */
let W, ERRORS;
const $ = id => W.document.getElementById(id);
const click = el => el && el.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
const changeEl = el => el && el.dispatchEvent(new W.Event('change', { bubbles: true }));
const rows = () => [...W.document.querySelectorAll('#dbArrList .db-ar')];
const titles = () => rows().map(r => r.querySelector('.db-ar-ttl').value);
const listIds = () => [...W.document.querySelectorAll('#dbList .db-row')]
  .map(r => r.querySelector('.db-ttl').textContent);

async function planAndArrange() {
  click($('dbBtnPlan'));
  await settle(150);
  click($('dbBtnArrange'));
  await settle(80);
}
async function act(fn) { fn(); await settle(120); }

(async () => {
  const m = mount();
  W = m.win; ERRORS = m.errors;
  await settle(400);

  section('the page boots and the fourth stage is there:');
  check('the Deck Builder mounted', !!$('dbBtnPlan'), ERRORS.join('; '));
  check('Arrange sits between Plan and Render',
    !!$('dbBtnArrange') && !!$('dbStage4'));
  check('...and is disabled until there is a recipe to arrange',
    $('dbBtnArrange').disabled === true);
  check('the panel starts hidden', $('dbArrange').hidden === true);
  check('the rail says nothing until there is a recipe to describe',
    $('dbArrRail').textContent.trim() === '\u2014', $('dbArrRail').innerHTML);

  await planAndArrange();
  check('Plan then Arrange lists every recipe slide, in recipe order',
    rows().length === RECIPE_IDS.length, rows().length + ' rows');
  check('...and #dbList still holds the same slides',
    listIds().length === RECIPE_IDS.length);

  /* ==== RULE 1 ============================================================ */
  section('nothing stored means the deck is the recipe:');
  check('opening Arrange writes nothing at all',
    plan() === null && tableMap() === null,
    JSON.stringify({ plan: plan(), tables: tableMap() }));

  /* ==== ORDER ============================================================= */
  section('the order:');
  const first = titles()[0], second = titles()[1];
  await act(() => click(rows()[1].querySelector('[data-db-arr="down"]')));
  check('a slide moved down swaps with the one below it',
    titles()[1] !== second && titles()[2] === second,
    titles().slice(0, 4).join(' | '));
  check('...and the order is saved, ids only',
    !!plan() && plan().order.length === RECIPE_IDS.length &&
    plan().order[2] === RECIPE_IDS[1],
    JSON.stringify(plan() && plan().order.slice(0, 4)));
  check('...with nothing else in the store',
    plan().off.length === 0 && plan().drop.length === 0 &&
    Object.keys(plan().rows).length === 0 && plan().add.length === 0,
    JSON.stringify(plan()));

  /* Rule 1 again, and this is the half that is easy to get wrong: moving a
     slide back has to DELETE the property, not leave an order that happens to
     equal the recipe. A stored order equal to the recipe is a frozen recipe. */
  await act(() => click(rows()[2].querySelector('[data-db-arr="up"]')));
  check('moving it back puts the deck in recipe order again',
    titles()[0] === first && titles()[1] === second, titles().slice(0, 3).join(' | '));
  check('...and the saved order is REMOVED, not left equal to the recipe',
    plan() === null,
    'a stored order equal to DECK_RECIPE is a frozen recipe: ' + JSON.stringify(plan()));

  /* the arrows cannot run off either end */
  check('the first slide cannot move up',
    rows()[0].querySelector('[data-db-arr="up"]').disabled === true);
  check('the last cannot move down',
    rows()[rows().length - 1].querySelector('[data-db-arr="down"]').disabled === true);

  /* the deck really does come back in the saved order */
  await act(() => click(rows()[0].querySelector('[data-db-arr="down"]')));
  const moved = titles().slice(0, 3).join(' | ');
  click($('dbBtnPlan'));
  await settle(200);
  check('a re-Plan reads the arrangement back off the server',
    titles().slice(0, 3).join(' | ') === moved, titles().slice(0, 3).join(' | '));
  check('...and #dbList is in that order too',
    listIds()[0] === titles()[0], listIds()[0] + ' vs ' + titles()[0]);
  await act(() => click(rows()[1].querySelector('[data-db-arr="up"]')));

  /* ==== TICKS ============================================================= */
  section('in the pack, or not:');
  const tickOf = i => rows()[i].querySelector('[data-db-arr="tick"]');
  await act(() => { tickOf(0).checked = false; changeEl(tickOf(0)); });
  check('unticking a slide leaves it in the list, greyed',
    rows().length === RECIPE_IDS.length && rows()[0].className.indexOf('off') !== -1);
  check('...and is stored as an exception, not a copy of every row',
    plan().off.length === 1 && plan().on.length === 0,
    JSON.stringify(plan()));
  await act(() => { tickOf(0).checked = true; changeEl(tickOf(0)); });
  check('...and ticking it back empties the store again', plan() === null);

  /* AN OPTIONAL RECIPE ROW TICKED HERE is the other half of the same rule, and
     the recipe currently has none — the Land / Docks rows were the last of
     them and they are checked by default now. So one is made optional in the
     recipe for the length of this check, which is also the case that proves
     `on` and `off` are stored as exceptions to whatever the recipe says
     rather than as one list of ticks. */
  const optRow = server.DECK_RECIPE[5];
  optRow.optional = true;
  click($('dbBtnPlan'));
  await settle(200);
  const optAt = titles().indexOf(optRow.title);
  check('a recipe row marked optional comes back unticked',
    optAt >= 0 && !tickOf(optAt).checked, 'row ' + optAt);
  await act(() => { tickOf(optAt).checked = true; changeEl(tickOf(optAt)); });
  check('an optional slide ticked here is stored under `on`, not `off`',
    plan() && plan().on.length === 1 && plan().off.length === 0,
    JSON.stringify(plan()));
  await act(() => { tickOf(optAt).checked = false; changeEl(tickOf(optAt)); });
  check('...and unticking it clears the store — a tick equal to the recipe is no entry',
    plan() === null, JSON.stringify(plan()));
  optRow.optional = false;
  click($('dbBtnPlan'));
  await settle(200);

  /* ==== DELETE AND RESTORE ================================================ */
  section('deleting is not unticking:');
  const doomed = titles()[3];
  W.__confirms.length = 0;
  await act(() => click(rows()[3].querySelector('[data-db-arr="del"]')));
  check('deleting asks first, and says it is shared',
    W.__confirms.length === 1 && /shared/i.test(W.__confirms[0]), W.__confirms[0] || 'no confirm');
  check('the slide leaves the list entirely',
    rows().length === RECIPE_IDS.length - 1 && titles().indexOf(doomed) === -1);
  check('...and leaves #dbList too, so it cannot be rendered',
    listIds().indexOf(doomed) === -1);
  check('...and is stored under `drop`',
    plan() && plan().drop.length === 1, JSON.stringify(plan() && plan().drop));
  check('Deleted slides shows it, with a way back',
    $('dbArrDeleted').hidden === false &&
    /Restore/.test($('dbArrDeleted').innerHTML) &&
    $('dbArrDeleted').textContent.indexOf(doomed) !== -1,
    $('dbArrDeleted').textContent);
  check('...and a deletion is not bannered as a problem',
    $('dbBanners').textContent.indexOf('no longer exists') === -1,
    $('dbBanners').textContent);

  await act(() => click($('dbArrDeleted').querySelector('[data-db-restore]')));
  await settle(200);
  check('Restore puts it back where the recipe puts it',
    titles()[3] === doomed, titles().slice(2, 5).join(' | '));
  check('...and the store is empty again', plan() === null);
  check('...and Deleted slides is gone', $('dbArrDeleted').hidden === true);

  /* ==== EDITS ============================================================= */
  section('editing a row:');
  const ttl = rows()[0].querySelector('.db-ar-ttl');
  await act(() => { ttl.value = 'AGG - RETITLED - MTD'; changeEl(ttl); });
  check('a retitled slide is stored as one field of one row',
    plan() && Object.keys(plan().rows).length === 1 &&
    plan().rows[RECIPE_IDS[0]].title === 'AGG - RETITLED - MTD',
    JSON.stringify(plan() && plan().rows));
  check('...and the new title is what #dbList shows',
    listIds()[0] === 'AGG - RETITLED - MTD', listIds()[0]);
  const back = rows()[0].querySelector('.db-ar-ttl');
  await act(() => { back.value = server.DECK_RECIPE[0].title; changeEl(back); });
  check('...and putting the recipe title back empties the store', plan() === null);

  /* ==== CHANGING A SOURCE ================================================= */
  section('changing a source is not a relabel:');
  /* seg SASKATCHEWAN -> rmx. Same market, different spelling: 'SASKATCHEWAN'
     both sides here, so pick the Southwest, where the two really differ. */
  const swSeg = titles().findIndex((t, i) =>
    /HNS SW/.test(t) && /Commercial MTD/.test(t));
  check('the fixture has an RMX Southwest row to drive this with', swSeg >= 0);
  if (swSeg >= 0) {
    const srcSel = rows()[swSeg].querySelector('[data-db-arr="source"]');
    const before = rows()[swSeg].querySelector('[data-db-arr="market"]').value;
    check('...spelled the Ready-Mix way to start with', before === 'HNS_SW', before);
    await act(() => { srcSel.value = 'pv'; changeEl(srcSel); });
    const after = rows()[swSeg].querySelector('[data-db-arr="market"]').value;
    check('changing seg to pv RE-SPELLS the market through OVERVIEW.MARKETS',
      after === 'Southwest',
      'got "' + after + '" — a name that matches no row is what published '
      + 'Southwest Land as a page of zeroes');
    check('...and the new source is what is stored',
      plan().rows[server.DECK_RECIPE[swSeg] ? server.DECK_RECIPE[swSeg].id : ''] ||
      Object.keys(plan().rows).length === 1,
      JSON.stringify(plan().rows));
    check('...and pv on the Southwest is offered Land and Docks, which seg is not',
      !!rows()[swSeg].querySelector('[data-db-arr="refine"]'));
  }

  /* a source with no market at all, and a source that shows both periods */
  const fscAt = titles().findIndex(t => /Fuel Recovery MTD/.test(t));
  if (fscAt >= 0) {
    check('a Fuel Recovery row is offered no market — it has none',
      !rows()[fscAt].querySelector('[data-db-arr="market"]'));
    check('...but is offered MTD / YTD',
      !!rows()[fscAt].querySelector('[data-db-arr="period"]'));
  }
  const custAt = titles().findIndex(t => /TOP 10 CUSTOMERS/.test(t));
  if (custAt >= 0) {
    check('a Top 10 row shows both periods and is offered no period picker',
      !rows()[custAt].querySelector('[data-db-arr="period"]') &&
      /both periods/i.test(rows()[custAt].textContent));
    const s2 = rows()[custAt].querySelector('[data-db-arr="source"]');
    await act(() => { s2.value = 'pv'; changeEl(s2); });
    check('...and switching it to a source that HAS periods offers one',
      !!rows()[custAt].querySelector('[data-db-arr="period"]'));
  }

  /* back to a clean deck for the table checks */
  W.__confirms.length = 0;
  await act(() => click($('dbArrReset')));
  await settle(300);
  check('Reset arrangement asks first', W.__confirms.length === 1);
  check('...and puts the deck back to exactly the recipe',
    plan() === null && tableMap() === null && rows().length === RECIPE_IDS.length &&
    titles()[0] === server.DECK_RECIPE[0].title,
    JSON.stringify({ plan: plan(), tables: tableMap() }));

  /* ==== TABLES ============================================================ */
  section('what a scope shows:');
  const pvAt = titles().findIndex(t => /AGG - CENTRAL CANADA - MTD/.test(t));
  check('the fixture has a Price & Volume row', pvAt >= 0);
  await act(() => click(rows()[pvAt].querySelector('[data-db-arr="sel"]')));

  const scopeBtns = () => [...W.document.querySelectorAll('#dbArrSide [data-db-scope]')];
  check('the scope selector is in plain words, most specific first',
    scopeBtns().length === 3 &&
    /This slide only/.test(scopeBtns()[0].textContent) &&
    /Central Canada only/.test(scopeBtns()[1].textContent) &&
    /All Price & Volume slides/.test(scopeBtns()[2].textContent),
    scopeBtns().map(b => b.textContent.replace(/\s+/g, ' ').trim()).join(' / '));
  check('...and each rung says how many slides it would reach',
    /\d+ slides/.test(scopeBtns()[2].textContent),
    scopeBtns()[2].textContent.replace(/\s+/g, ' ').trim());
  /* 14: the seven Price & Volume markets/refines, MTD and YTD each. Central
     Canada, Saskatchewan, Manitoba, GTA, Southwest, Southwest Land,
     Southwest Docks. The Top 10 rows are 'cust', a different source. */
  const pvRows = server.DECK_RECIPE.filter(r => r.source === 'pv').length;
  check('the source-wide rung reaches every pv slide and no other (' + pvRows + ')',
    new RegExp(pvRows + ' slides').test(scopeBtns()[2].textContent),
    scopeBtns()[2].textContent.replace(/\s+/g, ' ').trim());

  const boxes = () => [...W.document.querySelectorAll('#dbArrSide [data-db-tb]')];
  check('the catalogue is the nine PV dimensions', boxes().length === 9);
  check('...with the three the deck builds today ticked',
    boxes().filter(b => b.checked).map(b => b.getAttribute('data-db-tb')).join(',')
      === 'MARKET,PLANT_TYPE,PROD_CLASS',
    boxes().filter(b => b.checked).map(b => b.getAttribute('data-db-tb')).join(','));
  check('...and nothing is stored until one is touched', tableMap() === null);

  /* the source-wide rung is the last button; pick it deliberately */
  await act(() => click(scopeBtns()[2]));
  const plantBox = () => boxes().filter(b => b.getAttribute('data-db-tb') === 'PLANT')[0];
  await act(() => { const b = plantBox(); b.checked = true; changeEl(b); });
  check('ticking a table saves it against the chosen scope',
    !!tableMap() && !!tableMap().scopes.pv &&
    tableMap().scopes.pv.tables.join(',') === 'MARKET,PLANT_TYPE,PROD_CLASS,PLANT',
    JSON.stringify(tableMap()));
  check('...and ticking APPENDS, so the order is the selection',
    tableMap().scopes.pv.tables[3] === 'PLANT');

  /* the arrows are the other half of "one ordered array" */
  await act(() => click(W.document.querySelector(
    '#dbArrSide .db-tb-row [data-db-tbmove="down"]:not([disabled])')));
  check('an arrow reorders the selection in place',
    tableMap().scopes.pv.tables.join(',') === 'PLANT_TYPE,MARKET,PROD_CLASS,PLANT',
    JSON.stringify(tableMap().scopes.pv.tables));

  await act(() => { const b = plantBox(); b.checked = false; changeEl(b); });
  await act(() => {
    const b = boxes().filter(x => x.getAttribute('data-db-tb') === 'PLANT_TYPE')[0];
    b.checked = false; changeEl(b);
  });
  check('unticking removes it from the array',
    tableMap().scopes.pv.tables.join(',') === 'MARKET,PROD_CLASS',
    JSON.stringify(tableMap().scopes.pv.tables));

  /* a scope answering shows up on the rows it reaches */
  /* A SCOPE REACHES OTHER SLIDES — that is the point of it — so every row it
     reaches has to repaint, not just the one that is selected. */
  const scopeLines = () => rows().map(r => {
    const e = r.querySelector('.db-ar-scope');
    return e ? e.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  check('every pv row now says where its tables come from',
    scopeLines().filter(t => /tables from All Price & Volume slides/.test(t)).length === pvRows,
    scopeLines().filter(Boolean).slice(0, 3).join(' / '));
  check('...and no row of another source does',
    scopeLines().filter(Boolean).length === pvRows,
    scopeLines().filter(Boolean).length + ' rows carry a scope line');

  /* THE MINIMUM. An empty pv selection publishes a picture saying "Load
     market data to fill this card" — a wrong answer that fails silently. */
  await act(() => {
    const b = boxes().filter(x => x.getAttribute('data-db-tb') === 'MARKET')[0];
    b.checked = false; changeEl(b);
  });
  await act(() => {
    const b = boxes().filter(x => x.getAttribute('data-db-tb') === 'PROD_CLASS')[0];
    b.checked = false; changeEl(b);
  });
  check('the last table cannot be unticked on a pv scope',
    tableMap().scopes.pv.tables.length >= 1,
    JSON.stringify(tableMap().scopes.pv.tables));
  /* THE GUARD IS DOUBLED ON PURPOSE and this asserts the OUTCOME, not which
     half produced it: the page refuses before it writes, and setTables_
     refuses again on the way in. Removing either one leaves this passing,
     which is the correct answer for a rule that must hold whichever way the
     store is written to — the page is not the only caller of DECK_setTables. */
  check('...and it says why, rather than just refusing',
    /Load market data/.test($('dbBanners').textContent),
    $('dbBanners').textContent.slice(0, 200));

  /* A MORE SPECIFIC RUNG BEATS IT, and the panel says which one is answering. */
  await act(() => click(rows()[pvAt].querySelector('[data-db-arr="sel"]')));
  await act(() => click(scopeBtns()[0]));                    // this slide only
  await act(() => {
    const b = boxes().filter(x => x.getAttribute('data-db-tb') === 'PLANT')[0];
    b.checked = true; changeEl(b);
  });
  const rowKey = 'row:' + server.DECK_RECIPE.filter(
    r => r.title === 'AGG - CENTRAL CANADA - MTD')[0].id;
  check('a row: scope is written, and stamped with the source it is for',
    !!tableMap().scopes[rowKey] && tableMap().scopes[rowKey]['for'] === 'pv',
    JSON.stringify(tableMap().scopes[rowKey]));
  await act(() => click(rows()[pvAt].querySelector('[data-db-arr="sel"]')));
  check('...and the panel marks the rung that is actually answering',
    /answering/.test(scopeBtns()[0].textContent),
    scopeBtns().map(b => b.textContent.replace(/\s+/g, ' ').trim()).join(' / '));
  check('...while the row beside it still resolves at the source',
    rows()[pvAt + 1].textContent.indexOf('All Price & Volume slides') !== -1);

  /* CHANGING THE SOURCE ABANDONS THAT row: SCOPE — its keys are the old
     adapter's catalogue and mean nothing to the new one. */
  const srcSel2 = rows()[pvAt].querySelector('[data-db-arr="source"]');
  await act(() => { srcSel2.value = 'rmx'; changeEl(srcSel2); });
  await settle(150);
  check('changing the source clears that slide\'s own table scope',
    !tableMap() || !tableMap().scopes[rowKey],
    JSON.stringify(tableMap() && tableMap().scopes[rowKey]));

  W.__confirms.length = 0;
  await act(() => click($('dbArrReset')));
  await settle(300);

  /* ==== KPI =============================================================== */
  section('the KPI strip:');
  const pv2 = titles().findIndex(t => /AGG - CENTRAL CANADA - MTD/.test(t));
  await act(() => click(rows()[pv2].querySelector('[data-db-arr="sel"]')));
  const kpiBox = () => W.document.querySelector('#dbArrSide [data-db-kpion]');
  check('a pv slide offers the strip as on / off', !!kpiBox() && kpiBox().checked === true);
  await act(() => { kpiBox().checked = false; changeEl(kpiBox()); });
  check('switching it off is stored against the scope',
    !!tableMap() && Object.keys(tableMap().scopes).some(
      k => tableMap().scopes[k].kpi && tableMap().scopes[k].kpi.on === false),
    JSON.stringify(tableMap()));
  await act(() => { kpiBox().checked = true; changeEl(kpiBox()); });
  check('...and switching it back on with no region stores nothing',
    tableMap() === null,
    'on with no region is the same as nothing stored: ' + JSON.stringify(tableMap()));

  const segAt = titles().findIndex(t => /RMX - SASKATCHEWAN - Commercial MTD/.test(t));
  await act(() => click(rows()[segAt].querySelector('[data-db-arr="sel"]')));
  check('a Product Segment slide offers on / off and no Region',
    !!W.document.querySelector('#dbArrSide [data-db-kpion]') &&
    !W.document.querySelector('#dbArrSide [data-db-kpisheet]'));
  const rmxAt = titles().findIndex(t => /RMX - Saskatchewan - Commercial MTD/.test(t));
  await act(() => click(rows()[rmxAt].querySelector('[data-db-arr="sel"]')));
  check('a Ready-Mix P&V slide says there is no strip to configure',
    !W.document.querySelector('#dbArrSide [data-db-kpion]') &&
    /no KPI strip/.test($('dbArrSide').textContent),
    $('dbArrSide').textContent.replace(/\s+/g, ' ').slice(-160));
  check('...and is still offered its five breakdowns',
    W.document.querySelectorAll('#dbArrSide [data-db-tb]').length === 5);

  const fscAt2 = titles().findIndex(t => /Fuel Recovery MTD/.test(t));
  await act(() => click(rows()[fscAt2].querySelector('[data-db-arr="sel"]')));
  check('a Fuel Recovery slide says its content is fixed',
    /fixed content/.test($('dbArrSide').textContent),
    $('dbArrSide').textContent.replace(/\s+/g, ' ').slice(-160));

  /* ==== ADDING ============================================================ */
  section('adding a slide:');
  const n0 = rows().length;
  await act(() => click($('dbArrAdd')));
  check('a new slide lands next to the one that was selected',
    rows().length === n0 + 1);
  const addedRow = rows()[titles().indexOf('New slide')];
  check('...marked as added here',
    !!addedRow && /added here/.test(addedRow.textContent),
    addedRow ? addedRow.textContent.replace(/\s+/g, ' ').slice(0, 120) : 'no "New slide" row');
  check('...and is stored in `add`, not as an edit to a recipe row',
    plan() && plan().add.length === 1 && Object.keys(plan().rows).length === 0,
    JSON.stringify(plan() && plan().add));
  check('...with an id nothing else uses',
    plan().add[0].id && RECIPE_IDS.indexOf(plan().add[0].id) === -1, plan().add[0].id);
  check('...and an order, because the deck is no longer the recipe',
    plan().order.length === n0 + 1);
  const addedAt = titles().indexOf('New slide');
  W.__confirms.length = 0;
  await act(() => click(rows()[addedAt].querySelector('[data-db-arr="del"]')));
  check('deleting an added slide leaves nothing behind',
    plan() === null,
    'an added row\'s deletion removes it from `add`; it is not a `drop`: '
    + JSON.stringify(plan()));

  /* AN ADDED SLIDE IS A SLIDE LIKE ANY OTHER, and its layout is overridable
     from the same dropdown as every other row's. setLayout used to look the id
     up in DECK_RECIPE alone, so the one row that exists only in the plan was
     the one row whose layout could not be saved — and, worse, could not be
     CLEARED either, which is what a deletion has to do or the override outlives
     the slide as an orphan that banners on every Plan. */
  const LAYOUT_PROP = server.DECK_CONFIG.PROP_LAYOUTS;
  await act(() => click($('dbArrAdd')));
  const newAt = titles().indexOf('New slide');
  const newId = plan().add[0].id;
  const lay = W.document.querySelectorAll('#dbList .db-lay')[newAt];
  check('an added slide gets the same layout picker as every other row',
    !!lay && [...lay.options].length > 1,
    lay ? [...lay.options].map(o => o.value).join(', ') : 'no layout picker on the added row');
  /* SAVING one is not provable here: DECK_setLayout opens the template, which
     is the one thing off-platform cannot do — it is documented as the slow one
     of the three and the only one that can fail. deckstatic.js proves that
     half against a stubbed presentation. What IS reachable from here is the
     clearing path, which deliberately opens nothing. */
  PROPS[LAYOUT_PROP] = JSON.stringify({ [newId]: 'L_FULL_IMAGE' });
  W.__confirms.length = 0;
  await act(() => click(rows()[titles().indexOf('New slide')].querySelector('[data-db-arr="del"]')));
  await settle(200);
  check('...and deleting it takes that override with it',
    !PROPS[LAYOUT_PROP] && plan() === null,
    'layouts=' + PROPS[LAYOUT_PROP] + ' plan=' + JSON.stringify(plan()));

  /* ==== THE RAIL ========================================================== */
  section('the rail:');
  check('with nothing arranged it says so',
    /Deck_Recipe/.test($('dbArrRail').innerHTML), $('dbArrRail').innerHTML);
  await act(() => click(rows()[0].querySelector('[data-db-arr="down"]')));
  check('...and a change made here is visible without opening the stage',
    /order has been changed/.test($('dbArrRail').innerHTML), $('dbArrRail').innerHTML);

  /* ==== #dbList IS NOT TOUCHED =========================================== */
  section('the slide list is not where any of this lives:');
  check('no Arrange control leaked into a #dbList row',
    W.document.querySelectorAll('#dbList [data-db-arr], #dbList [data-db-tb], ' +
      '#dbList [data-db-scope]').length === 0);
  check('...and the Arrange panel is not inside it',
    !$('dbList').contains($('dbArrange')));

  /* ==========================================================================
   * A CHANGED SELECTION DROPS EXACTLY THE PICTURES IT CHANGED
   * --------------------------------------------------------------------------
   * A scope reaches every slide below it. That is the point of it — and it is
   * also why the drop cannot be "everything this scope reaches": a row with a
   * more specific rung answering for it did not move, and throwing its picture
   * away costs a re-render for nothing. Each row is compared against what it
   * was actually RENDERED with.
   *
   * This runs on a SECOND page over a TRIMMED recipe. The checks above need all
   * 43 rows — the Southwest spellings, the source counts, the market coverage —
   * and these need every row to have a real picture, which means running the
   * render loop for each of them. Four rows is enough to state the claim and
   * fast enough to state it reliably.
   * ======================================================================== */
  {
    const keep = ['pv_cc_mtd', 'pv_cc_ytd', 'pv_sk_mtd', 'rmx_sk_mtd'];
    const full = server.DECK_RECIPE.slice();
    server.DECK_RECIPE.length = 0;
    keep.forEach(id => server.DECK_RECIPE.push(full.filter(r => r.id === id)[0]));
    PROPS = {};

    const m2 = mount();
    W = m2.win; ERRORS = m2.errors;
    await settle(400);
    await planAndArrange();

    section('a changed selection drops exactly the pictures it changed:');
    check('the trimmed deck mounted', rows().length === 4, rows().length + ' rows');

    const st = () => [...W.document.querySelectorAll('#dbList .db-st')]
      .map(e => e.textContent.trim());
    const shot = () => [...W.document.querySelectorAll('#dbList .db-thumb')]
      .map(e => e.className.indexOf('empty') === -1);

    click($('dbBtnRender'));
    await settle(2500);
    check('every slide renders', st().join(',') === 'ready,ready,ready,ready', st().join(','));
    check('...and every one has a picture', shot().every(Boolean), JSON.stringify(shot()));

    /* pv|Central Canada reaches two of the four: the MTD row and its YTD twin,
       because `period` is in no scope key above the first. The Saskatchewan pv
       row and the Ready-Mix row are on other rungs and did not move. */
    await act(() => click(rows()[0].querySelector('[data-db-arr="sel"]')));
    const scopeBtns2 = () => [...W.document.querySelectorAll('#dbArrSide [data-db-scope]')];
    await act(() => click(scopeBtns2()[1]));                  // Central Canada only
    const box = k => [...W.document.querySelectorAll('#dbArrSide [data-db-tb]')]
      .filter(b => b.getAttribute('data-db-tb') === k)[0];
    await act(() => { const b = box('PLANT'); b.checked = true; changeEl(b); });
    await settle(200);

    check('the two slides that scope moved lost their pictures',
      st()[0] === '—' && st()[1] === '—', st().join(','));
    check('...and the ones it did not move kept theirs',
      st()[2] === 'ready' && st()[3] === 'ready', st().join(','));
    check('...and the page says how many are rebuilding',
      /2 slides rebuilding/.test($('dbProg').textContent), $('dbProg').textContent);
    check('a change made after a pass has finished says to press Render',
      /press Render/.test($('dbProg').textContent), $('dbProg').textContent);

    /* AND A CHANGE THAT MOVES NOTHING TOUCHES NOTHING. Setting the same
       selection again is not a re-render — the picture is still right. */
    click($('dbBtnRender'));
    await settle(2500);
    check('re-rendering brings all four back', st().join(',') === 'ready,ready,ready,ready',
      st().join(','));
    await act(() => click(rows()[0].querySelector('[data-db-arr="sel"]')));
    await act(() => click(scopeBtns2()[2]));                  // all pv slides
    await act(() => {
      /* a KPI region on the pv scope: it reaches all three pv rows, but the
         workbook is not uploaded in this fixture, so there is no region to
         choose and the strip toggle is the change to make instead */
      const k = W.document.querySelector('#dbArrSide [data-db-kpion]');
      k.checked = false; changeEl(k);
    });
    await settle(200);
    check('a KPI change reaches every pv slide, and only those',
      st()[0] === '—' && st()[1] === '—' && st()[2] === '—' && st()[3] === 'ready',
      st().join(','));

    /* THE LIVE QUEUE. A slide already photographed when the change lands has
       to be rebuilt IN THIS PASS — not dropped to "pending" and then quietly
       never rebuilt, which is what a plain local todo list did before the
       queue and its cursor were kept on the page. The only way out of that
       was to wait for the pass to end and press Render again.

       The server is slowed so a change can be made while a pass is genuinely
       running. The Ready-Mix row is dropped first, unconditionally, by
       changing its period — that gives the pass something to do — and the pv
       scope is then changed while that row is still being fetched. */
    click($('dbBtnRender'));
    await settle(3000);
    check('everything is ready before the mid-pass check',
      st().join(',') === 'ready,ready,ready,ready', st().join(','));

    /* line the panel up FIRST, while nothing is running: the mid-pass action
       has to be one synchronous change, or the clicks that set it up would
       themselves take longer than the pass */
    await act(() => click(rows()[0].querySelector('[data-db-arr="sel"]')));
    await act(() => click(scopeBtns2()[2]));                 // all pv slides

    const per = rows()[3].querySelector('[data-db-arr="period"]');
    await act(() => { per.value = 'YTD'; changeEl(per); });
    check('changing a period drops that picture with nothing to compare',
      st()[3] === '—', st().join(','));
    check('...and says so, because a market or period IS the picture',
      /picture dropped/.test($('dbProg').textContent), $('dbProg').textContent);

    m2.delay.ms = 400;
    click($('dbBtnRender'));
    await settle(600);                       // the check has answered; row 4 is in flight
    check('a running pass leaves Render and Publish disabled',
      $('dbBtnRender').disabled === true && $('dbBtnPublish').disabled === true,
      'render=' + $('dbBtnRender').disabled + ' publish=' + $('dbBtnPublish').disabled);

    const kBox = W.document.querySelector('#dbArrSide [data-db-kpion]');
    kBox.checked = true; changeEl(kBox);                      // strip back on
    await settle(200);
    check('a change made mid-pass does not end the pass',
      $('dbBtnRender').disabled === true,
      'Render came back while a pass was still going: ' + $('dbProg').textContent);
    check('...and says the slides are rebuilding IN THIS RUN',
      /rebuilding in this run/.test($('dbProg').textContent), $('dbProg').textContent);

    m2.delay.ms = 0;
    await settle(4000);
    check('...and they are — the pass finishes with every slide built',
      st().join(',') === 'ready,ready,ready,ready', st().join(','));
    check('...rather than leaving one pending for somebody to notice',
      shot().every(Boolean), JSON.stringify(shot()));

    /* ---- AND THE ARRANGEMENT REACHES THE DECK -------------------------
       An order that Publish does not send is an order that stops at the page.
       finish() is the only step that can honour one, because it is the only
       one that runs after the last slide has landed. */
    await act(() => click(rows()[0].querySelector('[data-db-arr="down"]')));
    const want = titles().slice();
    click($('dbBtnPublish'));
    await settle(2000);
    check('Publish sends the deck order to finish()',
      !!PUBLISHED.finish && PUBLISHED.finish.length === 4,
      JSON.stringify(PUBLISHED.finish));
    const byId = {};
    server.DECK_RECIPE.forEach(r => { byId[r.title] = r.id; });
    check('...matching the list on screen, top to bottom',
      PUBLISHED.finish.join(',') === want.map(t => byId[t]).join(','),
      'sent ' + JSON.stringify(PUBLISHED.finish) +
      ', on screen ' + JSON.stringify(want.map(t => byId[t])));
    /* and it is the ARRANGED order rather than the recipe's, or the check
       above would pass on a deck nobody had rearranged */
    check('...which is not the recipe order it started in',
      PUBLISHED.finish.join(',') !== server.DECK_RECIPE.map(r => r.id).join(','),
      JSON.stringify(PUBLISHED.finish));

    server.DECK_RECIPE.length = 0;
    full.forEach(r => server.DECK_RECIPE.push(r));
  }

  section('');
  check('the page raised no errors', ERRORS.length === 0, ERRORS.slice(0, 4).join('\n         '));

  console.log(failed
    ? '\n' + failed + ' of ' + ran + ' check(s) FAILED'
    : '\nARRANGE OK — ' + ran + ' checks.');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
