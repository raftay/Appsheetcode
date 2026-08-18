#!/usr/bin/env node
/* =============================================================================
 * tests/slidecss.js — what §B still does that §A1–§A3 do not  (PLAN.md chunk 16)
 * -----------------------------------------------------------------------------
 *   npm install playwright
 *   node tests/slidecss.js
 *   CHROMIUM_PATH=/path/to/chrome node tests/slidecss.js
 *
 * WHY THIS EXISTS
 *
 * §B is `Deck_Styles.html`: the CSS the deck's bare captures need, scoped under
 * `.slide-bare`. It was written when the deck and the pages were SEPARATE
 * DOCUMENTS — the Deck Builder included the slide modules without the pages
 * those modules normally live on, so every rule their markup depended on had to
 * be restated. PLAN.md §10 kept it out of the merge and asked chunk 16 to fold
 * it into the component layer "only against real captures: the deck's output is
 * a picture nobody can restyle afterwards, so 'these look the same' is not the
 * standard."
 *
 * WHAT CHANGED IS THE DOCUMENT. `AmrSlide.captureBare` builds its box and
 * attaches it to `document.body` — inside the merged file, where §A1–§A3 are
 * already loaded. So a §B rule that merely restates a component rule is now
 * dead weight; a §B rule that OVERRIDES one is still doing the job it was
 * written for. Nothing in the file distinguishes the two, and reading them
 * cannot: several restate a value that §A3 has since changed, which looks
 * identical in a diff and is not.
 *
 * HOW IT DECIDES, AND WHY THIS IS PROOF RATHER THAN INSPECTION
 *
 * For each of §B's rules, build the DOM its own selector requires — the full
 * ancestor chain, read off the selector — inside a real `.slide-bare` box in a
 * real document with the real stylesheet. Then read the computed value of every
 * property the rule declares, twice: with §B enabled and with §B disabled.
 *
 *   · same both ways  → the rule changes nothing. The cascade already produces
 *                       that value, so §B is restating §A3 and can go.
 *   · different       → the rule is load-bearing. It stays, and the harness
 *                       prints what it is worth so the next person does not
 *                       have to work it out again.
 *
 * The direction of the risk is the safe one: a rule whose context this cannot
 * reproduce comes out as "load-bearing" and is KEPT. This never argues for
 * deleting something it does not understand.
 *
 * IT IS ALSO THE STANDING GATE. Once the redundant rules are gone, every rule
 * left in §B must still be doing something — so a future edit to §A3 that
 * happens to make a §B rule redundant, or one to §B that makes a rule a no-op,
 * shows up here as a rule that stopped mattering.
 * ===========================================================================*/
'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const ROOT = path.join(__dirname, '..');

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

/* ------------------------------------------------------------------ read §B
   Anchored on the banner text, not on a style-element count: §B's position has
   already moved once, and check 9 in merge.js exists because that block was
   malformed for three chunks. */
const APP = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
const bAt = APP.indexOf('§B  SLIDE CSS');
if (bAt === -1) { console.error('slidecss.js: no §B banner in app.html'); process.exit(1); }
const bOpen  = APP.lastIndexOf('<style>', bAt);
const bClose = APP.indexOf('</style>', bAt);
const B_CSS  = APP.slice(bOpen + '<style>'.length, bClose);

/* The rules come from the CSSOM in the browser, not from a regex here: the
   browser's parse is the authoritative one, and §B has already shipped once in
   a state where reading it as text and reading it as CSS disagreed (merge.js
   check 9 exists for that). All this side does is confirm the block is there. */
/* The tag whitelist is the one thing the page side needs from here: a selector
   naming something that is not a known element is a selector this builder does
   not understand, and it is reported rather than approximated. */
const TAGS = ['table','thead','tbody','tfoot','tr','th','td','div','span','p','h1','h2',
              'h3','h4','ul','li','b','i','small','strong','em','section','aside','main',
              'header','footer','img','canvas','a','button','svg'];

(async () => {
  const exe = browserPath();
  if (!exe) { console.error('no Chromium found (set CHROMIUM_PATH)'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: exe });
  const pg = await browser.newPage({ viewport: { width: 1600, height: 900 } });

  /* The real document: app.html itself, with no page mounted. Every style layer
     is present and in its real order, which is the whole point — a rule's fate
     depends on what §A3 says AND on §B coming after it. */
  const tmp = path.join(os.tmpdir(), 'amr_slidecss.html');
  fs.writeFileSync(tmp, APP.replace(/<\?!?=\s*(\w+)\s*\?>/g, (a, n) =>
    ({ page: 'deckbuilder', appUrl: 'https://example.invalid/exec' })[n] ?? ''));
  await pg.goto('file://' + tmp, { waitUntil: 'domcontentloaded' });

  /* §B is identified by its content, not its index, and the check that it was
     found is separate from the check that it can be turned off. */
  /* The ten page names, taken from the file rather than typed here — merge.js
     check 10 is what keeps that list honest. */
  const PAGES = await pg.evaluate(() =>
    (window.AMR && AMR.pages ? AMR.pages.map(p => p.p) : ['landing']));
  if (PAGES.length !== 10) fail('setup', `expected ten pages, AMR.pages has ${PAGES.length}`);

  const found = await pg.evaluate(marker => {
    const el = [...document.querySelectorAll('style')].find(s => s.textContent.includes(marker));
    if (!el) return false;
    el.setAttribute('data-slidecss', '1');
    return true;
  }, '§B  SLIDE CSS');
  if (!found) { fail('setup', 'could not find §B in the live document'); }

  const result = await pg.evaluate(({ tagSet, pages }) => {
    const styleEl = document.querySelector('style[data-slidecss]');
    const sheet   = styleEl.sheet;
    const all     = [...sheet.cssRules];
    const nonStyle = all.filter(r => r.type !== CSSRule.STYLE_RULE).length;
    const rules   = all.filter(r => r.type === CSSRule.STYLE_RULE);

    const NEED = { td:'tr', th:'tr', tr:'tbody', tbody:'table', thead:'table', tfoot:'table' };
    const TAGS = new Set(tagSet);

    function parseCompound(part) {
      /* :first-child is allowed and then dropped, because every element this
         builder makes IS the first child of its parent — one child per level,
         by construction. Any other pseudo is refused by name rather than
         guessed at: :hover and :nth-child would both build something that
         quietly is not what the selector meant. */
      part = part.replace(/:first-child/g, '');
      const m = part.match(/^([a-z][a-z0-9]*)?((?:[.#][\w-]+)*)$/i);
      if (!m) return null;
      const tag = m[1] || null;
      const names = (m[2].match(/[.#][\w-]+/g) || []);
      if (tag && !TAGS.has(tag.toLowerCase())) return null;
      return { tag, classes: names.filter(n => n[0] === '.').map(n => n.slice(1)),
                    ids:     names.filter(n => n[0] === '#').map(n => n.slice(1)) };
    }

    function alternatives(selectorText) {
      return selectorText.split(',').map(one => {
        /* A child combinator builds the same chain a descendant one does — this
           builder puts each level directly inside the last, so `a > b` and
           `a b` produce the identical DOM and the stricter selector still
           matches. */
        const parts = one.trim().replace(/\s*>\s*/g, ' ').split(/\s+/);
        if (parts.some(p => /[+~:[\]]/.test(p.replace(/:first-child/g, ''))))
          return { skip: 'sibling combinator or a pseudo other than :first-child' };
        const chain = parts.map(parseCompound);
        if (chain.some(c => !c)) return { skip: 'selector shape' };
        if (!chain.length || !chain[0].classes.includes('slide-bare'))
          return { skip: 'not anchored on .slide-bare' };
        return { chain, selector: one.trim() };
      });
    }

    function build(chain) {
      /* Off-screen but LAID OUT. display:none would make every computed value
         meaningless, and that is the classic way this measurement goes wrong. */
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute; left:-99999px; top:0; width:1600px';
      let node = host;
      for (const c of chain) {
        const tag = c.tag || 'div';
        if (NEED[tag]) {
          const stack = [];
          let t = tag;
          while (NEED[t]) {
            t = NEED[t];
            if (node !== host && node.tagName.toLowerCase() === t) break;
            stack.unshift(t);
          }
          for (const st of stack) { const e = document.createElement(st); node.appendChild(e); node = e; }
        }
        const el = document.createElement(tag);
        for (const cl of c.classes) el.classList.add(cl);
        for (const id of c.ids) el.id = id;
        el.textContent = 'Xg';
        node.appendChild(el);
        node = el;
      }
      document.body.appendChild(host);
      return { host, target: node };
    }

    const out = [];
    for (const rule of rules) {
      const alts  = alternatives(rule.selectorText);
      const props = [...rule.style];
      const built = alts.map(a => (a.skip ? null : build(a.chain)));

      /* CUSTOM PROPERTIES ARE THE TRAP HERE, and ignoring them would produce a
         false "redundant". The slide fitter sets --tpy / --tpx / --thf on the
         table at run time; a §B rule reading var(--tpy,4px) and a §A3 rule
         reading the SAME var compute identically whether the variable is set or
         not, but a §B rule reading the var against a §A3 rule with a LITERAL
         only differs once the variable is set — which is never true at rest and
         always true when the deck actually captures. So every custom property
         the rule mentions is set to a value nothing else would produce, and the
         reading is taken again. */
      const vars = [...new Set((rule.cssText.match(/--[\w-]+/g) || []))];
      const read = () => built.map(b => {
        if (!b) return null;
        const cs = getComputedStyle(b.target);
        const rest = props.map(p => cs.getPropertyValue(p)).join('|');
        for (const v of vars) b.target.style.setProperty(v, '37px');
        const cs2 = getComputedStyle(b.target);
        const set = props.map(p => cs2.getPropertyValue(p)).join('|');
        for (const v of vars) b.target.style.removeProperty(v);
        return rest + ' ~ ' + set;
      });

      /* ONE RULE AT A TIME. Disabling the whole block conflates them: §B's
         table.gt override moves --px, so every rule downstream of it looks
         load-bearing whether or not it says anything §A3 does not. The question
         that decides a deletion is "if THIS rule went, would anything move".

         AND UNDER EVERY PAGE. §A4 is scoped on body[data-page], and scoping
         RAISES SPECIFICITY — that is the trap that cost 673 computed values on
         Ready-Mix and it applies here too: a §B rule can be the thing beating a
         page rule, which would look like pure duplication of §A3 under any
         other page. A rule is only redundant if it is redundant under all ten.
         The capture box is a child of <body>, so whichever page is mounted when
         the deck runs is a real context, not a hypothetical one. */
      const saved = rule.style.cssText;
      const wasPage = document.body.getAttribute('data-page');
      const diffs = [];
      for (const pageId of pages) {
        document.body.setAttribute('data-page', pageId);
        const on = read();
        rule.style.cssText = '';
        const off = read();
        rule.style.cssText = saved;
        for (let i = 0; i < built.length; i++)
          if (built[i] && on[i] !== off[i])
            diffs.push({ alt: alts[i].selector, page: pageId, on: on[i], off: off[i] });
      }
      document.body.setAttribute('data-page', wasPage);

      out.push({ index: out.length, selector: rule.selectorText, decls: saved,
                 skipped: alts.every(a => a.skip),
                 skipWhy: alts.map(a => a.skip).filter(Boolean)[0] || '',
                 matters: diffs.length > 0, diffs, props });

      for (const b of built) if (b) b.host.remove();
      if (rule.style.cssText !== saved)
        out[out.length - 1].restoreFailed = true;
    }
    return { out, nonStyle };
  }, { tagSet: TAGS, pages: PAGES });

  if (result.nonStyle) {
    fail('setup', `§B has ${result.nonStyle} rule(s) that are not plain style rules (an @media, ` +
                  `say). This harness builds one element per selector and cannot reason about ` +
                  `them — teach it before trusting the numbers below.`);
  }
  const broken = result.out.filter(r => r.restoreFailed);
  if (broken.length) fail('setup', `${broken.length} rule(s) could not be restored after being ` +
                                   `blanked — the readings after that point are not trustworthy`);
  const rows = result.out;

  const skipped   = rows.filter(r => r.skipped);
  const redundant = rows.filter(r => !r.skipped && !r.matters);
  const load      = rows.filter(r => !r.skipped && r.matters);

  console.log(`  §B has ${rows.length} rules: ${load.length} change something, ` +
              `${redundant.length} change nothing, ${skipped.length} could not be built\n`);

  if (process.env.SLIDECSS_DUMP) {
    require('fs').writeFileSync(process.env.SLIDECSS_DUMP,
      /* INDEXES, not selectors. §B declares .slide-bare table.gt TWICE — a
         second, narrower copy further down the block — so a selector is not a
         key here and matching on one would delete both. */
      JSON.stringify({ redundant: redundant.map(r => r.index),
                       redundantSel: redundant.map(r => r.selector),
                       keeps:     load.map(r => r.selector) }, null, 1));
  }
  if (process.env.SLIDECSS_LIST) {
    for (const r of redundant) console.log(`   REDUNDANT  ${r.selector}  { ${r.decls} }`);
    for (const r of skipped)   console.log(`   SKIPPED    ${r.selector}   (${r.skipWhy})`);
    for (const r of load)      console.log(`   KEEPS      ${r.selector}\n              ` +
      r.diffs.map(d => `${d.alt}: [${d.on}] vs [${d.off}] on ${r.props.join(',')}`).join('\n              '));
  }

  /* THE GATE. After chunk 16 every rule left in §B earns its place, so a rule
     that changes nothing is either a §A3 edit that made it redundant or a §B
     edit that made it a no-op. Either way somebody needs to look. */
  if (redundant.length) {
    fail('every-rule-earns-it', `${redundant.length} rule(s) in §B compute identically when that ` +
      `rule alone is blanked, on all ten pages — the rest of the cascade already produces those ` +
      `values, so they restate §A3 rather than overriding it. Chunk 16 emptied §B of exactly ` +
      `this, so either a §A3 edit has made one redundant or a §B edit has made one a no-op. ` +
      `Run with SLIDECSS_LIST=1 to see them.\n` +
      redundant.slice(0, 8).map(r => `        · ${r.selector} { ${r.decls} }`).join('\n'));
  } else {
    pass('every-rule-earns-it', `all ${load.length} buildable rules change a computed value`);
  }

  /* A skip is not a pass. If this number grows, the harness has stopped covering
     part of §B and the "every rule earns it" claim above is narrower than it
     reads. */
  const SKIP_BUDGET = Number(process.env.SLIDECSS_SKIPS || 0);
  if (skipped.length > SKIP_BUDGET) {
    fail('coverage', `${skipped.length} rule(s) could not be built and were not checked at all ` +
      `(budget ${SKIP_BUDGET}). A skipped rule is unproven, not proven safe.\n` +
      skipped.slice(0, 8).map(r => `        · ${r.selector}   (${r.skipWhy})`).join('\n'));
  } else if (skipped.length) {
    pass('coverage', `${skipped.length} rule(s) skipped, within the declared budget of ${SKIP_BUDGET}`);
  } else {
    pass('coverage', 'every rule in §B was built and measured');
  }

  await browser.close();
  console.log(failures ? `\n${failures} failure(s)`
                       : '\nslidecss.js: every rule in §B does something the component layer does not');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
