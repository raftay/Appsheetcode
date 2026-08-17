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
 *   4. No page template declares an id that another page's template also
 *      declares — they are never in the document together today, but a future
 *      client-side page switch (chunk 14) would put them there.
 *   5. Every rule in the §A4 page block is scoped to body[data-page="…"].
 *      An unscoped rule there leaks onto every other page.
 *   6. No page's boot() leaks a global: no bare assignment to window.* beyond
 *      the short allow-list the runtime itself sets.
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

/* Only look at markup from <body> on — the head comment mentions tag names in
   prose and would otherwise be read as code. */
const BODY = SRC.slice(SRC.indexOf('<body'));

/* ---------------------------------------------------------------- 1. syntax */
{
  const blocks = [...BODY.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let bad = 0;
  blocks.forEach((code, i) => {
    try { new vm.Script(code, { filename: `app.html#script[${i}]` }); }
    catch (e) { bad++; fail('syntax', `block ${i}: ${e.message}`); }
  });
  if (!bad) pass('syntax', `${blocks.length} script blocks parse`);
}

/* ------------------------------------------------- 2. template ↔ registration */
const templates = [...SRC.matchAll(/<template id="tpl-([\w-]+)">/g)].map(m => m[1]);
{
  const regs = [...SRC.matchAll(/AMR\.page\('([\w-]+)'/g)].map(m => m[1]);
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
  const tOpen = SRC.indexOf(`<template id="tpl-${name}">`);
  const tpl   = SRC.slice(tOpen, SRC.indexOf('</template>', tOpen));
  const rOpen = SRC.indexOf(`AMR.page('${name}'`);
  const js    = SRC.slice(rOpen, SRC.indexOf('</script>', rOpen));
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

/* --------------------------------------------------- 4. ids unique per page */
{
  const owner = new Map();
  let bad = 0;
  for (const [name, p] of Object.entries(PAGES)) {
    for (const id of p.ids) {
      if (owner.has(id)) {
        bad++; fail('ids-unique', `#${id} declared in both tpl-${owner.get(id)} and tpl-${name}`);
      } else owner.set(id, name);
    }
  }
  if (!bad) pass('ids-unique', `${owner.size} ids, no collisions across pages`);
}

/* ------------------------------------------------------- 5. §A4 is scoped */
{
  /* Find the STYLE BLOCK carrying the §A4 banner — not the first mention of
     "§A4", which is the navigation comment in <head>. */
  const styleBlocks = [...SRC.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]);
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

console.log(failures ? `\n${failures} failure(s)` : '\nmerge.js: all checks passed');
process.exit(failures ? 1 : 0);
