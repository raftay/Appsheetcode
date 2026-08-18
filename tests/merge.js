#!/usr/bin/env node
/* =============================================================================
 * tests/merge.js — the structural gate for app.html
 * -----------------------------------------------------------------------------
 * app.html holds every page in one file, which only works because a few
 * invariants hold. Nothing enforces them at runtime: break one and the page
 * looks fine until the one path that touches it runs. So they are checked here.
 *
 *   1. Every inline script block parses.
 *   2. Every <template id="tpl-X"> has exactly one AMR.page('X') and vice versa.
 *   3. Every id a page's boot() looks up exists in that page's own template
 *      (or is one of the shared modal ids that live outside #appRoot).
 *   4. No page template declares the same id TWICE, and the runtime empties
 *      #appRoot before mounting. Ids ARE shared between pages on purpose —
 *      the twin pages are the same screen on different numbers and reuse each
 *      other's — which is only safe while exactly one page is in the document.
 *      That is the invariant checked here; see PLAN.md §3.
 *   5. Every rule in the §A4 page block is scoped to body[data-page="…"].
 *      An unscoped rule there leaks onto every other page.
 *   6. No page's boot() leaks a global: no bare assignment to window.* beyond
 *      the short allow-list the runtime itself sets.
 *   7. No page declares a local that SHADOWS one of the runtime's globals.
 *      Price & Volume carried `var AMR = …palette.slice()`; inside a
 *      registration IIFE that hides window.AMR from every line below it.
 *
 * Run:  node tests/merge.js
 * Exit: 0 all good, 1 on the first category that fails (all failures printed).
 * ===========================================================================*/
'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC  = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');

let failures = 0;
const fail = (test, msg) => { failures++; console.log(`  ✗ ${test}: ${msg}`); };
const pass = (test, msg) => console.log(`  ✓ ${test}${msg ? ': ' + msg : ''}`);

/* Comments in this file describe tag names in prose ("put it in a <body>
   attribute", "<?= x ?> escapes"). A checker that greps raw source reads those
   as code and reports failures that are really just documentation — which has
   now happened twice. So: strip HTML comments once, up front, and anchor on the
   REAL body element rather than the first text that looks like one. */
const NO_COMMENTS = SRC.replace(/<!--[\s\S]*?-->/g, '');
/* The attribute values contain scriptlets, and `<?= page ?>` has a `>` in it —
   so a plain [^>]* stops halfway through the tag. Allow either a non-'>' char
   or a whole scriptlet. */
const BODY_TAG = NO_COMMENTS.match(/<body\s(?:<\?[\s\S]*?\?>|[^>])*>/);
if (!BODY_TAG) { console.log('  ✗ setup: no <body …> element found'); process.exit(1); }
const BODY = NO_COMMENTS.slice(NO_COMMENTS.indexOf(BODY_TAG[0]));

/* ---------------------------------------------------------------- 1. syntax */
{
  /* Apps Script scriptlets (<?= … ?>) are server-side templating, not JS — the
     browser never sees them. Substitute a string literal so the surrounding
     code can still be parsed: it is valid both as a bare expression and inside
     the quotes a scriptlet is usually written into. */
  const stub = code => code.replace(/<\?[-=!]?[\s\S]*?\?>/g, '"__SCRIPTLET__"');
  const blocks = [...BODY.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let bad = 0;
  blocks.forEach((code, i) => {
    try { new vm.Script(stub(code), { filename: `app.html#script[${i}]` }); }
    catch (e) { bad++; fail('syntax', `block ${i}: ${e.message}`); }
  });
  if (!bad) pass('syntax', `${blocks.length} script blocks parse`);
}

/* --------------------------------------- 1b. the values §D depends on exist */
{
  /* The deployment URL must reach the client. Without it every href is relative,
     and a relative href inside the Apps Script sandbox iframe resolves against
     googleusercontent.com rather than the web app — the page loads and then
     navigates somewhere wrong. Shipped once; guarded now. */
  let ok = true;
  for (const attr of ['data-app-url', 'data-app-mode', 'data-page']) {
    if (!new RegExp(`\\b${attr}=`).test(BODY_TAG[0])) {
      ok = false; fail('server-values', `<body> does not carry ${attr}`);
    }
  }
  if (!/data-app-url="<\?=\s*appUrl\s*\?>"/.test(BODY_TAG[0])) {
    ok = false; fail('server-values', 'data-app-url is not fed from <?= appUrl ?>');
  }
  if (ok) pass('server-values', '<body> carries app-url, app-mode and page');
}

/* ------------------------------------ 1b2. every scriptlet is a real one */
{
  /* Apps Script evaluates EVERY <? … ?> in the file, including ones inside an
     HTML comment — a scriptlet written as an example in a comment is code, and
     it fails the render with a ReferenceError before the page ever loads. That
     shipped. So: the file may only contain scriptlets over variables doGet
     actually sets on the template. Note this scans RAW source, comments and
     all — that is the whole point of the check. */
  const TEMPLATE_VARS = ['page', 'appUrl', 'appMode'];
  const scriptlets = [...SRC.matchAll(/<\?[-=!]?\s*([\s\S]*?)\s*\?>/g)];
  let bad = 0;
  for (const m of scriptlets) {
    const expr = m[1].trim();
    if (!TEMPLATE_VARS.includes(expr)) {
      bad++;
      fail('scriptlets-real',
           `<?= ${expr.slice(0, 40)} ?> is not one of ${TEMPLATE_VARS.join(', ')} — ` +
           'if this is an example inside a comment, Apps Script will still run it');
    }
  }
  if (!bad) pass('scriptlets-real', `${scriptlets.length} scriptlets, all real`);
}

/* ------------------------------------ 1c. no escaping scriptlet inside JS */
{
  /* <?= x ?> HTML-ESCAPES what it prints; <?!= x ?> does not. So a <?= ?> that
     emits a quote inside a <script> block renders as &#39; and takes the WHOLE
     block down with a syntax error — silently, because the server renders fine
     and only the browser sees the damage. Values the server computes belong in
     a <body> attribute (checked above), never printed into JS. */
  let bad = 0;
  for (const m of BODY.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    for (const sc of m[1].matchAll(/<\?=[\s\S]*?\?>/g)) {
      bad++;
      fail('no-scriptlet-in-js',
           `escaping scriptlet inside a script block: ${sc[0].slice(0, 48)} — ` +
           'put the value in a <body> data attribute instead');
    }
  }
  if (!bad) pass('no-scriptlet-in-js', 'no <?= ?> inside any script block');
}

/* ------------------------------------------------- 2. template ↔ registration */
const templates = [...NO_COMMENTS.matchAll(/<template id="tpl-([\w-]+)">/g)].map(m => m[1]);
{
  const regs = [...NO_COMMENTS.matchAll(/AMR\.page\('([\w-]+)'/g)].map(m => m[1]);
  const orphanTpl = templates.filter(t => !regs.includes(t));
  const orphanReg = regs.filter(r => !templates.includes(r));
  const dupTpl = templates.filter((t, i) => templates.indexOf(t) !== i);
  const dupReg = regs.filter((r, i) => regs.indexOf(r) !== i);
  orphanTpl.forEach(t => fail('pairing', `template tpl-${t} has no AMR.page('${t}')`));
  orphanReg.forEach(r => fail('pairing', `AMR.page('${r}') has no template tpl-${r}`));
  dupTpl.forEach(t => fail('pairing', `duplicate template tpl-${t}`));
  dupReg.forEach(r => fail('pairing', `duplicate registration ${r}`));
  if (!orphanTpl.length && !orphanReg.length && !dupTpl.length && !dupReg.length) {
    pass('pairing', `${templates.length} pages (${templates.join(', ')})`);
  }
}

/* Pull each page's template markup and its registration JS. */
function sliceFor(name) {
  const tOpen = NO_COMMENTS.indexOf(`<template id="tpl-${name}">`);
  const tpl   = NO_COMMENTS.slice(tOpen, NO_COMMENTS.indexOf('</template>', tOpen));
  const rOpen = NO_COMMENTS.indexOf(`AMR.page('${name}'`);
  const js    = NO_COMMENTS.slice(rOpen, NO_COMMENTS.indexOf('</script>', rOpen));
  return { tpl, js, ids: new Set([...tpl.matchAll(/id="([\w-]+)"/g)].map(m => m[1])) };
}
const PAGES = Object.fromEntries(templates.map(n => [n, sliceFor(n)]));

/* Ids that live outside #appRoot, in the shared modal shells. */
const SHARED_IDS = new Set([
  'appRoot', 'amrHelpModal', 'amrHelpTitle', 'amrHelpBody',
  'amrSetModal', 'amrSetTitle', 'amrSetIntro', 'amrSetList',
  'amrHintModal', 'amrHintBody', 'amrStale', 'amrStaleTitle', 'amrStaleBtn',
  'qlikGuide', 'qlikGuideSteps', 'qgHide', 'qgFab'
]);

/* ------------------------------------------------------- 3. ids resolve */
{
  let bad = 0;
  for (const [name, p] of Object.entries(PAGES)) {
    const used = new Set([...p.js.matchAll(/getElementById\('([\w-]+)'\)/g)].map(m => m[1]));
    for (const id of used) {
      if (!p.ids.has(id) && !SHARED_IDS.has(id)) {
        bad++; fail('ids-resolve', `${name}: getElementById('${id}') matches nothing in tpl-${name}`);
      }
    }
  }
  if (!bad) pass('ids-resolve', 'every getElementById target exists');
}

/* ------------------------------- 4. one id once per page, one page mounted */
{
  /* Ids repeat ACROSS pages by design. AGG Fuel Recovery and RMX Fuel Recovery
     are the same screen on different numbers, so they share #syncBtn,
     #tablesHost, #titleIn and eighteen more; forcing one of them to invent
     rfSyncBtn would make the twins stop being diffable to buy nothing. What
     must never happen is the same id twice in ONE page, or two pages in the
     document at once — so those are what is checked. */
  let bad = 0;
  for (const [name, p] of Object.entries(PAGES)) {
    const seen = new Map();
    for (const m of p.tpl.matchAll(/id="([\w-]+)"/g)) {
      seen.set(m[1], (seen.get(m[1]) || 0) + 1);
    }
    for (const [id, n] of seen) {
      if (n > 1) { bad++; fail('ids-unique', `tpl-${name} declares #${id} ${n} times`); }
    }
  }
  if (!bad) {
    const shared = new Map();
    for (const [name, p] of Object.entries(PAGES)) {
      for (const id of p.ids) shared.set(id, (shared.get(id) || 0) + 1);
    }
    const reused = [...shared.values()].filter(n => n > 1).length;
    pass('ids-unique', `${shared.size} ids, none declared twice in one page` +
                       (reused ? ` (${reused} deliberately shared between pages)` : ''));
  }
}

/* ------------------------------------------------- 4b. one page at a time */
{
  /* The check above is only sound because AMR.start() empties #appRoot before
     it mounts. Without that line a second mount would put two #tablesHost in
     one document and getElementById would answer for whichever came first —
     which is exactly what chunk 14 will be tempted to do for speed. */
  const start = NO_COMMENTS.slice(NO_COMMENTS.indexOf('function start()'));
  const body = start.slice(0, start.indexOf('\n  }'));
  const clears = /getElementById\('appRoot'\)[\s\S]{0,200}?\.innerHTML\s*=\s*''/.test(body);
  if (clears) pass('single-mount', 'AMR.start() empties #appRoot before mounting');
  else fail('single-mount',
            'AMR.start() does not clear #appRoot before appending — two mounted pages ' +
            'would share ids. See PLAN.md §3.');
}

/* ------------------------------------------------------- 5. §A4 is scoped */
{
  /* Find the STYLE BLOCK carrying the §A4 banner — not the first mention of
     "§A4", which is the navigation comment in <head>. */
  const styleBlocks = [...NO_COMMENTS.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]);
  const block = styleBlocks.find(b => /§A4\s+PAGE CSS/.test(b));
  if (!block) fail('css-scope', 'could not find the §A4 style block');
  else {
    const css = block
      .replace(/\/\*[\s\S]*?\*\//g, '')       // comments
      .replace(/@media[^{]*\{/g, '');         // media wrappers (rules inside still checked)
    let bad = 0;
    for (const rule of css.matchAll(/(^|\})\s*([^{}@]+)\{/g)) {
      const selector = rule[2].trim();
      if (!selector) continue;
      for (const part of selector.split(',')) {
        const sel = part.trim();
        if (!sel) continue;
        if (!/^body\[data-page=/.test(sel) && !/^html:has\(body\[data-page=/.test(sel)) {
          bad++; fail('css-scope', `unscoped §A4 selector: ${sel.slice(0, 70)}`);
        }
      }
    }
    if (!bad) pass('css-scope', 'every §A4 rule is scoped to a page');
  }
}

/* ------------------------------------------------ 6. pages leak no globals */
{
  const ALLOWED = new Set([
    'amrGoHome', 'amrNavTop', 'amrOpenHelp', 'amrOpenSettings',
    'AmrHint', 'AmrQlikGuide', 'AMR', 'HELP_HTML', 'APP_URL', 'amrReloadData'
  ]);
  let bad = 0;
  for (const [name, p] of Object.entries(PAGES)) {
    for (const m of p.js.matchAll(/window\.(\w+)\s*=/g)) {
      if (!ALLOWED.has(m[1])) {
        bad++; fail('no-leaks', `${name}: assigns window.${m[1]}`);
      }
    }
  }
  if (!bad) pass('no-leaks', 'no page registration leaks a global');
}

/* -------------------------------------------- 7. nothing shadows the runtime */
{
  /* A page keeps its own names — that is the whole point of the registry — but
     not these. A local `var AMR` hides the runtime from every line below it in
     the same IIFE, and the failure is silent: AMR.log is suddenly an array.
     Price & Volume really did declare one (a dead colour alias); chunk 5
     deleted it, and this is what keeps it deleted. */
  const RUNTIME = ['AMR', 'AmrHint', 'AmrQlikGuide', 'AmrCache', 'AmrProgress',
                   'AmrBoot', 'AmrFresh', 'AmrSlide', 'AmrKpi', 'AmrCube',
                   'AmrFuelExec', 'AmrPvSlide'];
  let bad = 0;
  for (const [name, p] of Object.entries(PAGES)) {
    for (const m of p.js.matchAll(/(?:^|[;{}\s])(?:var|let|const|function)\s+(\w+)/g)) {
      if (RUNTIME.includes(m[1])) {
        bad++;
        fail('no-shadow', `${name} declares ${m[1]}, which shadows the runtime global of that name`);
      }
    }
  }
  if (!bad) pass('no-shadow', 'no page shadows a runtime global');
}

console.log(failures ? `\n${failures} failure(s)` : '\nmerge.js: all checks passed');
process.exit(failures ? 1 : 0);
