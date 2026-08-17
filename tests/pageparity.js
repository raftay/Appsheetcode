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
const { JSDOM } = require('jsdom');

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

/* Server replies, by function name. A page asking for anything not listed here
   is a finding, not something to paper over — the runner reports it. */
function serverStubs(model) {
  return {
    getFscData:      () => model,
    getRmxFuelData:  () => model,
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
function legacySource(file) {
  let src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const missing = [];
  src = src.replace(/<\?!?=\s*include\('([\w-]+)'\)\s*\?>/g, (_, name) => {
    const p = path.join(ROOT, name + '.html');
    if (!fs.existsSync(p)) { missing.push(name); return ''; }
    return fs.readFileSync(p, 'utf8');
  });
  if (missing.length) throw new Error(`${file}: include() names no file: ${missing.join(', ')}`);
  return fillVars(src, { page: 'fuelsurcharge', appUrl: URL_BASE, appMode: 'false' });
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
function boot(html, label, model) {
  const asked = [];
  const stubs = serverStubs(model);
  const errors = [];

  const dom = new JSDOM(html, {
    url: URL_BASE + '?page=fuelsurcharge',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
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
    /* Views to walk, by the data-v the rail's segmented control carries. */
    views: ['EXEC', 'EXEC_MTD', 'MTD', 'YTD', 'BYMONTH'],
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

  const guide = doc.getElementById('qlikGuide');
  t('QlikView guide mounted', !!guide);
  if (guide && spec.guideSteps != null) {
    const got = guide.querySelectorAll('#qlikGuideSteps p').length;
    t(`guide has ${spec.guideSteps} steps`, got === spec.guideSteps, `got ${got}`);
  }
  t('guide FAB mounted', !!doc.getElementById('qgFab'));
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
function snapshot(win) {
  const doc = win.document;
  const txt = id => { const e = doc.getElementById(id); return e ? e.innerHTML : '(missing #' + id + ')'; };
  const val = id => { const e = doc.getElementById(id); return e ? e.value : '(missing #' + id + ')'; };

  const host = doc.getElementById('tablesHost');
  const card = host && host.querySelector('.card');
  const aside = [].filter.call(host ? host.children : [],
                               el => !el.classList.contains('card'));

  return {
    tables:  card ? card.innerHTML : '(no .card in #tablesHost)',
    notice:  aside.map(el => el.textContent.replace(/\s+/g, ' ').trim()).join(' | '),
    markets: txt('mktList'),
    months:  txt('fscMonthSel'),
    title:   val('titleIn'),
    status:  (doc.getElementById('loadStat') || {}).textContent,
  };
}

function clickView(win, view) {
  const b = win.document.querySelector(`#viewSeg button[data-v="${view}"]`);
  if (!b) throw new Error(`no view button [data-v="${view}"]`);
  b.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
}

/* ------------------------------------------------------------------- main */
(async function main() {
  let checks = 0, fails = 0;
  const fail = msg => { fails++; console.log(`  FAIL  ${msg}`); };
  const ok   = msg => console.log(`  ok    ${msg}`);

  for (const page of PAGES) {
    const model = page.model();
    const A = boot(legacySource(page.legacy), 'legacy', model);
    const B = boot(mergedSource(page.id), 'merged', model);

    await settle(300);

    for (const side of [A, B]) side.errors.forEach(e => fail(e));

    /* Both must actually have rendered — two identically empty pages are not a
       pass, and that is the failure mode a naive diff would call green. The
       fixture carries an unmatched Saskatchewan customer for the same reason:
       a notice that silently stopped rendering would otherwise read as a match. */
    for (const [name, side] of [['legacy', A], ['merged', B]]) {
      const snap = snapshot(side.window);
      checks++;
      if (snap.tables && snap.tables.includes('<table')) ok(`${page.id} · ${name} rendered a table`);
      else fail(`${page.id} · ${name} rendered no table — got ${JSON.stringify(String(snap.tables).slice(0, 120))}`);
      if (page.expectNotice) {
        checks++;
        if (snap.notice && snap.notice.includes(page.expectNotice)) ok(`${page.id} · ${name} rendered the data notice`);
        else fail(`${page.id} · ${name} lost the data notice — got ${JSON.stringify(String(snap.notice).slice(0, 120))}`);
      }
    }

    if (page.chrome) checks += checkChrome(B.window, page.chrome, page.id, ok, fail);

    for (const view of page.views) {
      if (view !== 'EXEC') { clickView(A.window, view); clickView(B.window, view); await settle(30); }
      const a = snapshot(A.window), b = snapshot(B.window);
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
