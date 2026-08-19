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
 *      That is the invariant checked here; see README §3.
 *   5. Every rule in the §A4 page block is scoped to body[data-page="…"].
 *      An unscoped rule there leaks onto every other page. `:where(body[…])`
 *      counts as scoped and is the preferred form where a page block styles
 *      BARE ELEMENTS: :where() narrows without adding specificity, which is
 *      what a page prefix was always assumed to do and does not. Ready-Mix is
 *      written that way — see check 8 and README §3.
 *   6. No page's boot() leaks a global: no bare assignment to window.* beyond
 *      the short allow-list the runtime itself sets.
 *   7. No page declares a local that SHADOWS one of the runtime's globals.
 *      Price & Volume carried `var AMR = …palette.slice()`; inside a
 *      registration IIFE that hides window.AMR from every line below it.
 *   8. No §A4 rule REACHES OUTSIDE its own page's markup, and none restyles
 *      #appRoot without naming it. Scoping is not only narrowing: prefixing a
 *      bare `aside{}` with body[data-page="x"] also raises its specificity by
 *      an attribute selector, so it starts winning cascades the original lost.
 *      Ready-Mix shipped both halves of that — see the check for what broke.
 *  10. script.gs's APP_PAGES, §D's switcher list and §P's templates name the same
 *      pages. Nothing else makes those three agree, and drift is silent.
 *   9. Every style element is opened once, closed once, and holds only CSS.
 *      A style element's content is text until its closing tag, so anything
 *      that leaks in is parsed as CSS — and CSS error recovery eats the rule
 *      after it without a word. §B shipped that way; see the check.
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
  for (const attr of ['data-app-url', 'data-page']) {
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
  /* appMode went with the ?page=app scaffold at the cutover. A scriptlet over a
     variable doGet no longer sets is not a stale comment — the render throws
     ReferenceError before the page loads. */
  const TEMPLATE_VARS = ['page', 'appUrl'];
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
  /* Two spellings, because the pages have two. Most write getElementById; the
     Overview and Ready-Mix declare `function $(id){ return
     document.getElementById(id); }` and then use $ everywhere — 183 call sites
     between them, none of which this check could see when it only looked for
     the long form. A page that does NOT declare that helper is not scanned for
     `$(…)`, so a jQuery-shaped $ on some future page cannot be misread as an
     id lookup. */
  let bad = 0, seen = 0;
  const SHORT = /function\s+\$\s*\(\s*id\s*\)\s*\{\s*return\s+document\.getElementById\(\s*id\s*\)/;
  for (const [name, p] of Object.entries(PAGES)) {
    const used = new Set([...p.js.matchAll(/getElementById\('([\w-]+)'\)/g)].map(m => m[1]));
    const how = new Map([...used].map(id => [id, "getElementById('" + id + "')"]));
    if (SHORT.test(p.js)) {
      for (const m of p.js.matchAll(/(?:^|[^\w$.])\$\('([\w-]+)'\)/g)) {
        if (!used.has(m[1])) how.set(m[1], "$('" + m[1] + "')");
        used.add(m[1]);
      }
    }
    /* An id can also be created by the page itself: every chart canvas on the
       Overview is written into a panel by the painter that then looks it up.
       So a lookup resolves against the template OR against the markup this
       page's own code builds. A typo still fails, because the write and the
       read have to agree on the spelling either way. */
    const built = new Set([...p.js.matchAll(/id="([\w-]+)"/g)].map(m => m[1]));
    seen += used.size;
    for (const id of used) {
      if (!p.ids.has(id) && !SHARED_IDS.has(id) && !built.has(id)) {
        bad++; fail('ids-resolve', `${name}: ${how.get(id)} matches nothing in tpl-${name} and nothing in this page builds it`);
      }
    }
  }
  if (!bad) pass('ids-resolve', `every id a page looks up exists (${seen} lookups)`);
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
  /* The check above is only sound because mount() empties #appRoot before it
     appends. Without that line a second mount would put two #tablesHost in one
     document and getElementById would answer for whichever came first — which
     is exactly what chunk 14 was tempted to do for speed, and did not.
     tests/pageswitch.js proves the runtime behaviour; this proves the line is
     still there, which is cheaper and fails in a more obvious place. */
  const at = NO_COMMENTS.indexOf('function mount(id)');
  if (at === -1) {
    fail('single-mount', 'no function mount(id) in §D — the mount moved and this check is blind');
  } else {
    const body = NO_COMMENTS.slice(at, NO_COMMENTS.indexOf('\n  }', at));
    const clears = /getElementById\('appRoot'\)[\s\S]{0,200}?\.innerHTML\s*=\s*''/.test(body);
    if (clears) pass('single-mount', 'mount() empties #appRoot before mounting');
    else fail('single-mount',
              'mount() does not clear #appRoot before appending — two mounted pages ' +
              'would share ids. See README §3.');
  }
}

/* The three ways a §A4 selector may name its page. `:where(body[data-page=…])`
   is the specificity-neutral one: it narrows what the rule matches without
   adding an attribute selector's weight, which is the ONLY form that makes
   "scoping a page's style block" the neutral transformation the merge assumed
   it was. README §3 has what went wrong when it was not. */
const SCOPED = /^(?::where\(\s*)?(?:body\[data-page=|html:has\(\s*body\[data-page=)/;
/* the page id a selector is scoped to, whichever form it used */
const scopedPage = sel => {
  const m = sel.match(/body\[data-page="([\w-]+)"\]/);
  return m ? m[1] : null;
};

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
        if (!SCOPED.test(sel)) {
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

/* ------------------------------- 8. §A4 stays inside its own page's markup */
{
  /* WHY THIS EXISTS — two live bugs, one cause, neither visible in a diff.
   *
   * Every page used to BE the document: its markup were children of <body>,
   * and its style block could say `aside{…}` or `main{…}` and mean its own.
   * In app.html the page is mounted inside <main id="appRoot">, and two things
   * changed that a straight prefix does not account for:
   *
   *   · #appRoot IS a <main>. `body[data-page="rmx"] main{…}` matched the mount
   *     as well as the page's own <main>, so the whole page inherited a flex
   *     container and a 16px gap that were meant for one column.
   *   · AmrQlikGuide appends its <aside> to document.body, OUTSIDE #appRoot.
   *     `body[data-page="rmx"] aside{…}` is (0,1,2); .qlikGuide{display:none}
   *     is (0,1,0). The page rule won, and the guide opened on load and could
   *     not be closed. Legacy's bare `aside{}` was (0,0,1) and lost to the
   *     class — which is why this could only appear after the merge.
   *
   * So the invariant is not "is it scoped" (check 5) but "what does it REACH".
   * Build the real document — shared shells, the runtime-appended guide, the
   * page mounted in #appRoot — and ask the selector itself. */
  let jsdom = null;
  try { ({ JSDOM: jsdom } = require('jsdom')); } catch (e) { /* handled below */ }

  if (!jsdom) {
    console.log('  – css-reach: skipped, jsdom is not installed ' +
                '(npm install jsdom --prefix ' + ROOT + ')');
  } else {
    /* The shared shell is app.html's body with every <template> and <script>
       removed — what is left is #appRoot and the modal shells that live beside
       it. Taking it from the file rather than hard-coding it means a new shell
       element is covered the day it lands. */
    const SHELL = BODY
      .replace(/<template[\s\S]*?<\/template>/g, '')
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<\?[\s\S]*?\?>/g, '');

    /* What AmrQlikGuide.mount() appends to <body> at runtime. It is not in the
       file, so nothing static could see it — and it is exactly what got hit. */
    const RUNTIME_APPENDED =
      '<aside class="qlikGuide" id="qlikGuide"><div id="qlikGuideSteps"></div>' +
      '<button class="qgHide" id="qgHide">Close guide</button></aside>' +
      '<button class="qgFab" id="qgFab">Guide</button>' +
      '<div class="qgLightbox"><img alt=""></div>';

    const a4 = [...NO_COMMENTS.matchAll(/<style>([\s\S]*?)<\/style>/g)]
      .map(m => m[1]).find(b => /§A4\s+PAGE CSS/.test(b)) || '';
    const css = a4.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');

    /* selector → the one page it is scoped to, from the attribute value itself */
    const rules = [];
    for (const rule of css.matchAll(/(^|\})\s*([^{}@]+)\{/g)) {
      for (const part of rule[2].split(',')) {
        const sel = part.trim();
        if (!sel) continue;
        /* Match on the SCOPED forms, not on a raw `body[` prefix: the rmx block
           is written `:where(body[data-page="rmx"]) …`, and a prefix test drops
           all 27 of its rules from this check without saying so. */
        if (!SCOPED.test(sel)) continue;
        const page = scopedPage(sel);
        if (page) rules.push({ sel, page });
      }
    }

    let bad = 0, skipped = 0, checked = 0;
    for (const name of templates) {
      const mine = rules.filter(r => r.page === name);
      if (!mine.length) continue;
      const tpl = PAGES[name].tpl.replace(/^<template[^>]*>/, '');
      const dom = new jsdom(
        '<!doctype html><html><body data-page="' + name + '"></body></html>');
      const d = dom.window.document;
      d.body.innerHTML = SHELL + RUNTIME_APPENDED;
      const root = d.getElementById('appRoot');
      if (!root) { fail('css-reach', 'the shared shell has no #appRoot'); break; }
      root.innerHTML = tpl;

      for (const { sel } of mine) {
        let hits;
        try { hits = [...d.querySelectorAll(sel)]; }
        catch (e) { skipped++; continue; }   /* :has() and friends */
        checked++;
        for (const el of hits) {
          if (el === d.body || el === d.documentElement) continue;
          if (el === root) {
            /* Allowed, but only on purpose. A rule that means the mount says so. */
            if (!/#appRoot/.test(sel)) {
              bad++;
              fail('css-reach',
                   `${sel.slice(0, 60)} restyles #appRoot itself — the mount is a ` +
                   `<main>, so a bare element selector reaches it. Name #appRoot ` +
                   `if that is meant, or anchor the selector inside the page.`);
            }
            continue;
          }
          if (!root.contains(el)) {
            bad++;
            fail('css-reach',
                 `${sel.slice(0, 60)} reaches <${el.tagName.toLowerCase()}` +
                 (el.id ? '#' + el.id : '') +
                 (el.className ? '.' + String(el.className).split(/\s+/)[0] : '') +
                 `> which is OUTSIDE #appRoot. A page block has no business ` +
                 `styling the shared shell or anything the runtime appends to ` +
                 `<body>, and if the scope is a plain body[data-page=…] prefix ` +
                 `it does so at a HIGHER specificity than the shared rule that ` +
                 `owns the element. Anchor the selector on the page's own container.`);
          }
        }
      }
    }
    if (!bad) {
      pass('css-reach', `${checked} §A4 selectors stay inside their page` +
                        (skipped ? ` (${skipped} skipped: unsupported selector)` : ''));
    }
  }
}

/* ------------------------------------------ 9. the style elements are sound */
{
  /* WHY: §B shipped malformed and nothing noticed for three chunks.
   *
   * Deck_Styles.html explains itself in an HTML comment whose prose names a
   * style element by its tag. The chunk-10 builder split that file on the first
   * such token — the one inside the sentence — so §B opened with the tail of
   * that prose, a bare `-->`, and a second opening tag, all of it inside a live
   * style element. A style element's content is TEXT until its closing tag, so
   * none of that was markup; it was CSS. And CSS error recovery treats garbage
   * before the first `{` as a selector prelude and throws away the rule that
   * follows, so §B parsed as 85 rules where the file has 86 and
   * `.slide-bare .tbl-card` was silently gone.
   *
   * It had no visible effect only by luck — §A3 declares the same padding. The
   * next rule to land at the top of a block would not be so lucky.
   *
   * This scans RAW source, comments included, because that is where it started:
   * a tag written as a literal inside a comment is exactly what got copied. */
  const OPEN = /<style(?:\s[^>]*)?>/gi;
  const CLOSE = /<\/style\s*>/gi;
  const opens = [...SRC.matchAll(OPEN)].map(m => m.index);
  const closes = [...SRC.matchAll(CLOSE)].map(m => m.index);
  let bad = 0;

  if (opens.length !== closes.length) {
    bad++;
    fail('style-blocks',
         `${opens.length} opening style tags and ${closes.length} closing ones. ` +
         `An unclosed one swallows everything after it as CSS.`);
  }

  /* Every open must be followed by its own close before the next open. */
  for (let i = 0; i < opens.length; i++) {
    const close = closes.find(c => c > opens[i]);
    const nextOpen = opens[i + 1];
    if (close === undefined) {
      bad++;
      fail('style-blocks', `the style element at offset ${opens[i]} is never closed`);
      continue;
    }
    if (nextOpen !== undefined && nextOpen < close) {
      const line = SRC.slice(0, nextOpen).split('\n').length;
      bad++;
      fail('style-blocks',
           `a second opening style tag at line ${line} sits INSIDE the element ` +
           `opened at line ${SRC.slice(0, opens[i]).split('\n').length}. It is not ` +
           `markup there — it is CSS text, and the rule after it is discarded.`);
    }
  }

  /* And nothing that is plainly not CSS may sit at the top of a block. A stray
     `-->` is the tell the real one left: it means an HTML comment was spliced
     in without its opener. */
  for (const m of SRC.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style\s*>/gi)) {
    const body = m[1].replace(/\/\*[\s\S]*?\*\//g, '');
    if (/-->/.test(body)) {
      bad++;
      fail('style-blocks',
           `a style element at line ${SRC.slice(0, m.index).split('\n').length} contains ` +
           `a bare "-->" outside a CSS comment — an HTML comment was spliced in without ` +
           `its opener, and everything up to the next { is being eaten as a selector.`);
    }
  }

  if (!bad) pass('style-blocks', `${opens.length} style elements, each opened once and holding only CSS`);
}

/* ------------------------------- 10. the routes and the switcher are one list */
{
  /* Two lists name the pages: APP_PAGES in script.gs, which decides what ?page=
     serves, and AMR_PAGES in §D, which is the switcher in the header. They are
     in different files and different languages, and nothing makes them agree.
     Drift either way is silent and asymmetric:
       · in script.gs only  — the switcher cannot reach a page that works
       · in app.html only — the switcher offers a link that serves the landing
                            page instead, which reads as the click being ignored
     A page also needs a <template> and a registration, so all three are checked
     against each other here rather than pairwise. */
  const gs = fs.readFileSync(path.join(ROOT, 'script.gs'), 'utf8');
  const m = gs.match(/var APP_PAGES = \[([\s\S]*?)\];/);
  if (!m) {
    fail('routes', 'script.gs has no APP_PAGES array — doGet decides routes some other way now');
  } else {
    const routes = [...m[1].matchAll(/'([\w-]+)'/g)].map(x => x[1]);
    const swMatch = NO_COMMENTS.match(/var AMR_PAGES = \[([\s\S]*?)\];/);
    const switcher = swMatch ? [...swMatch[1].matchAll(/p:\s*'([\w-]+)'/g)].map(x => x[1]) : null;
    let bad = 0;
    if (!switcher) { bad++; fail('routes', 'app.html has no AMR_PAGES switcher list'); }
    else {
      for (const p of routes) {
        if (!switcher.includes(p)) { bad++; fail('routes', `script.gs routes ?page=${p} but the switcher never offers it`); }
        if (!templates.includes(p)) { bad++; fail('routes', `script.gs routes ?page=${p} but there is no template tpl-${p}`); }
      }
      for (const p of switcher) {
        if (!routes.includes(p)) {
          bad++;
          fail('routes', `the switcher offers ${p} but script.gs does not route it — ` +
                         `doGet falls back to the landing page, so the click looks ignored`);
        }
      }
    }
    if (!bad) pass('routes', `${routes.length} pages, and script.gs, the switcher and §P all agree`);
  }
}

console.log(failures ? `\n${failures} failure(s)` : '\nmerge.js: all checks passed');
process.exit(failures ? 1 : 0);
