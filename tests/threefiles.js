#!/usr/bin/env node
/* =============================================================================
 * tests/threefiles.js — the project really is three files
 * -----------------------------------------------------------------------------
 *   npm install playwright
 *   node tests/threefiles.js
 *
 * WHY THIS EXISTS
 *
 * The whole point of the merge was that moving this application means copying
 * three files: app.gs, app.html and appsscript.json. Everything else in the
 * repo — README.md, PLAN.md, CLAUDE.md, tests/ — is scaffolding, and the claim
 * is that it can all be deleted without the app noticing.
 *
 * THAT CLAIM HAS NEVER BEEN TESTED, and the repo's own rule is that a deletion
 * you have not tried is a deletion you have not done. Chunk 13 learned it the
 * hard way: ten harnesses were repointed at app.html, all ten went green, and
 * FOUR of them failed the moment the legacy files were actually moved aside,
 * because each had a read the first pass missed. "Hide before you delete."
 *
 * So this copies the three files into an empty directory and runs the app out
 * of THAT — nothing else on disk, nothing to fall back on:
 *
 *   1. app.gs is evaluated whole, in one scope, exactly as Apps Script does it.
 *   2. doGet() is called for every route, with HtmlService faked closely enough
 *      to prove the one thing that matters: the ONLY file it asks for is 'app'.
 *   3. The HTML doGet produces — scriptlets rendered, not the raw file — is
 *      booted in real Chromium, and the page must actually mount.
 *
 * A missing fourth file shows up as a thrown 'no such file', a page that mounts
 * nothing, or a console error. All three are failures here.
 * ===========================================================================*/
'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const THREE = ['app.gs', 'app.html', 'appsscript.json'];

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  console.error('playwright is not installed where this script can see it.\n' +
    '  npm install playwright --prefix ' + ROOT);
  process.exit(2);
}
function browserPath() {
  const env = process.env.CHROMIUM_PATH;
  if (env && fs.existsSync(env)) return env;
  for (const dir of ['/opt/pw-browsers', '/root/.cache/ms-playwright']) {
    if (!fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir))
      for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
        const p = path.join(dir, d, sub);
        if (/^chromium-/.test(d) && fs.existsSync(p)) return p;
      }
  }
  return null;
}

let failures = 0;
const fail = (what, msg) => { failures++; console.log(`  ✗ ${what}: ${msg}`); };
const pass = (what, msg) => console.log(`  ✓ ${what}${msg ? ': ' + msg : ''}`);

/* ---------------------------------------------------------------- the island
   An empty directory holding nothing but the three files. Everything below
   reads from HERE, never from the repo. */
const ISLAND = fs.mkdtempSync(path.join(os.tmpdir(), 'amr-threefiles-'));
for (const f of THREE) fs.copyFileSync(path.join(ROOT, f), path.join(ISLAND, f));
{
  const stray = fs.readdirSync(ISLAND).filter(f => !THREE.includes(f));
  if (stray.length) fail('setup', `the island is not clean: ${stray.join(', ')}`);
  else pass('setup', `${ISLAND} holds ${THREE.join(', ')} and nothing else`);
}

/* ------------------------------------------------------- 1. app.gs evaluates
   In ONE scope, whole, the way Apps Script does it — not region by region. If
   two top-level names collided, or a section referred to something no longer
   there, this is where it stops. */
const asked = [];          /* every file name HtmlService is asked for */
const ctx = {
  console: { log(){}, warn(){}, error(){}, info(){} },
  HtmlService: {
    createTemplateFromFile(name) {
      asked.push(name);
      const file = path.join(ISLAND, name + '.html');
      if (!fs.existsSync(file))
        throw new Error('no such file in the project: ' + name + '.html');
      const raw = fs.readFileSync(file, 'utf8');
      const t = {
        evaluate() {
          /* Apps Script's printing scriptlet HTML-ESCAPES, and the whole reason
             server values ride in <body> data attributes is that printing one
             into JavaScript emits &#39; and kills the block. Escaping here is
             what makes this a faithful render rather than a substitution. */
          const esc = s => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
          const out = raw.replace(/<\?(!?)=\s*([\s\S]*?)\s*\?>/g, (all, bang, expr) => {
            if (!/^[A-Za-z_$][\w$]*$/.test(expr))
              throw new Error('a scriptlet in app.html is not a bare variable: ' + expr);
            const v = t[expr];
            if (v === undefined) throw new Error('app.html asks for an unset scriptlet: ' + expr);
            return bang ? String(v) : esc(v);
          });
          if (/<\?/.test(out)) throw new Error('a scriptlet survived the render');
          return { html: out, setTitle(){ return this; }, addMetaTag(){ return this; },
                   setXFrameOptionsMode(){ return this; }, getContent(){ return this.html; } };
        }
      };
      return t;
    },
    XFrameOptionsMode: { ALLOWALL: 1 },
  },
  /* The services doGet touches on the way through. Everything else in app.gs is
     evaluated but not called. */
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty(){} }),
                       getUserProperties:   () => ({ getProperty: () => null, setProperty(){} }) },
  CacheService: { getScriptCache: () => ({ get: () => null, getAll: () => ({}), put(){}, putAll(){}, remove(){} }) },
  Utilities: { base64Encode: s => String(s), formatDate: () => '' },
  Session: { getActiveUser: () => ({ getEmail: () => '' }),
             getEffectiveUser: () => ({ getEmail: () => '' }),
             getScriptTimeZone: () => 'America/New_York' },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
try {
  vm.runInContext(fs.readFileSync(path.join(ISLAND, 'app.gs'), 'utf8'), ctx,
                  { filename: 'app.gs' });
  pass('app.gs', 'the whole file evaluates in one scope, with no other file present');
} catch (e) {
  fail('app.gs', `it does not evaluate on its own: ${e.message}`);
}

/* ------------------------------------------------- 2. doGet asks for one file */
let served = null;
if (typeof ctx.doGet === 'function') {
  const routes = ctx.APP_PAGES.concat(['', 'nosuchpage']);
  let ok = true;
  for (const p of routes) {
    try {
      const out = ctx.doGet({ parameter: p ? { page: p } : {} });
      if (!out || !out.html) { fail('doGet', `?page=${p || '(none)'} produced nothing`); ok = false; }
      if (p === 'rmx') served = out.html;
    } catch (e) { fail('doGet', `?page=${p || '(none)'} threw: ${e.message}`); ok = false; }
  }
  const uniq = [...new Set(asked)];
  if (uniq.length !== 1 || uniq[0] !== 'app') {
    fail('one-html-file', `doGet asked for ${JSON.stringify(uniq)} — the project is meant to ` +
      `hold ONE html file. Anything else here is a fourth file that has to travel with these three.`);
  } else if (ok) {
    pass('one-html-file', `${routes.length} routes served, and every one asked for 'app' and nothing else`);
  }
} else {
  fail('doGet', 'app.gs defines no doGet');
}

/* --------------------------------------------- 3. what it serves actually runs */
(async () => {
  if (!served) { fail('boots', 'no served HTML to boot'); }
  else {
    const exe = browserPath();
    if (!exe) { console.error('no Chromium found (set CHROMIUM_PATH)'); process.exit(2); }
    const browser = await chromium.launch({ executablePath: exe });
    const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errs = [];
    pg.on('pageerror', e => errs.push(e.message));

    /* No google.script here ON PURPOSE. app.html's LIVE flag is meant to make
       every server call optional, so a page opened outside the web app still
       renders its chrome — and if it does not, the file is not self-contained
       in the way this test is claiming. */
    const out = path.join(ISLAND, 'served.html');
    fs.writeFileSync(out, served);
    await pg.goto('file://' + out, { waitUntil: 'load' });
    await pg.waitForTimeout(600);

    const state = await pg.evaluate(() => ({
      page:    document.body.getAttribute('data-page'),
      appUrl:  document.body.getAttribute('data-app-url'),
      mounted: document.getElementById('appRoot').children.length,
      runtime: !!(window.AMR && window.AMR.page),
      pages:   (window.AMR && window.AMR.pages || []).length,
    }));

    if (!state.runtime)      fail('boots', 'the §D runtime is not there — window.AMR is missing');
    else if (state.page !== 'rmx') fail('boots', `body[data-page] is "${state.page}", expected "rmx"`);
    else if (!state.mounted) fail('boots', 'the page mounted nothing into #appRoot');
    else if (state.pages !== 10) fail('boots', `the switcher knows ${state.pages} pages, expected 10`);
    else pass('boots', `served ?page=rmx mounts in a browser with only the three files on disk`);

    /* The escaping trap, checked on the RENDERED output rather than the source:
       an appUrl that arrived HTML-escaped inside a script block is the failure
       that shipped in chunk 2 and it is invisible in the file itself. */
    if (state.appUrl !== 'https://script.google.com/macros/s/TEST/exec')
      fail('server-values', `data-app-url came through as "${state.appUrl}" — a server value ` +
        `reached the page mangled, which is the escaping trap PLAN.md §8 records twice`);
    else pass('server-values', 'the deployed URL survives the render intact');

    if (errs.length) fail('pageerror', errs.slice(0, 2).join(' | ').slice(0, 200));
    else pass('pageerror', 'no uncaught errors booting outside the web app');

    await browser.close();
  }

  fs.rmSync(ISLAND, { recursive: true, force: true });
  console.log(failures ? `\n${failures} failure(s)`
                       : '\nthreefiles.js: app.gs + app.html + appsscript.json are the whole application');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
