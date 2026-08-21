#!/usr/bin/env node
/* =============================================================================
 * tests/cssdropped.js — a rule the port left behind
 * -----------------------------------------------------------------------------
 *   node tests/cssdropped.js
 *   REF=<commit> node tests/cssdropped.js
 *
 * WHY THIS EXISTS
 * The third member of the family `pageparity.js` and `cssparity.js` belong to,
 * and it is here because the gap between those two is where a real bug lived
 * for the whole of the merge.
 *
 *   · pageparity  proves the merged page emits the same HTML.
 *   · cssparity   proves the cascade over that HTML computes the same values.
 *   · neither can see CSS THAT IS SIMPLY GONE, if the markup it styled is not
 *     in the fixture.
 *
 * Ready-Mix's "this table is affected" strip is what that looks like. Chunk 6
 * ported Page_Rmx.html and dropped seven rules — `.impact`, `.impact-i`,
 * `.impact-t`, `.impact-go` — and the page kept emitting the markup for all of
 * them. Three things had to be true at once for nobody to notice, and they
 * were: setStrip() BUILDS the strip in JS, so no markup gate ever meets the
 * class; no fixture in tests/ answers RMX_getUnmapped with a row, so the strip
 * renders in no harness run; and cssparity derives its property list FROM the
 * §A4 block, so the properties of a missing block are not on the list. What
 * shipped was the raw markup — the "!" badge run into the sentence as
 * "!339 products", and a browser-grey "Fix mapping" button inside the text.
 * `body.sug-open` and `#mapHost td.mkt` went the same way in the same chunk.
 *
 * WHAT IT CHECKS
 * For every class the deleted files styled: if app.html still EMITS that class
 * and has no rule that could match it, the port dropped the rule. That is the
 * whole claim. It is deliberately not "every class has a rule" — app.html has
 * two dozen classes that never had one (slide markup carrying its own inline
 * styles, and names that exist for a querySelector), and a check needing an
 * allow-list that long would be answering with its allow-list rather than with
 * the file. Anchoring on what the old files ACTUALLY STYLED needs no
 * exceptions at all, and it is green with none.
 *
 * WHAT IT DOES NOT CHECK, on purpose: the other direction. A rule in app.html
 * whose class nobody emits looks like dead CSS and is exactly what README §9
 * says a grep may not be used to prove — a class can be written by code this
 * scanner does not read as markup. Reporting that as a failure would make this
 * harness a reason to delete live rules.
 *
 * WHEN IT RETIRES: with pageparity and cssparity, and for their reason. The
 * moment a page is deliberately restyled rather than ported, "the old file
 * styled it" stops being an argument that the new one must. Delete it then —
 * do not weaken it, and do not start an allow-list to keep it passing.
 * ===========================================================================*/
'use strict';
const { legacy, source, REF } = require('./apphtml.js');

let failures = 0;
const fail = (what, msg) => { failures++; console.log(`  ✗ ${what}: ${msg}`); };
const pass = (what, msg) => console.log(`  ✓ ${what}${msg ? ': ' + msg : ''}`);

/* The 20 .html files the cutover deleted. Named rather than globbed: a glob
   over a git tree that silently returned fewer files every run would report
   "nothing dropped" for the same reason it always does. */
const LEGACY = [
  'Cube.html', 'Deck_Fuel.html', 'Deck_PV.html', 'Deck_RMX.html', 'Deck_SEG.html',
  'Deck_Sources.html', 'Deck_Styles.html', 'KpiShared.html', 'Landing.html',
  'Page_DeckBuilder.html', 'Page_FuelSurcharge.html', 'Page_InventoryReport.html',
  'Page_Overview.html', 'Page_PriceVolume.html', 'Page_Rmx.html', 'Page_RmxFuel.html',
  'Page_Segment.html', 'Page_TP01.html', 'Shell.html', 'SlideExport.html', 'Styles.html',
];

const styleBlocks = s => [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
const uncomment   = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ');

/* Class tokens in SELECTOR position, and the rule each one first appears in.
   THE PATTERN MAY NOT ANCHOR ON THE PRECEDING `}`. Written that way it consumes
   the brace that ends each rule, so the next match has to find the NEXT one and
   every second rule in the file is skipped — which reported 59 dropped classes
   the first time this ran, all but three of them rules that are right there.
   Matching an unanchored `selector{decls}` also walks INTO an at-rule for free:
   the prelude of `@media …{` cannot match `[^{}]*\}` and is stepped over, so
   the rules inside it are read and the prelude is not mistaken for one. */
function styledClasses(css) {
  const out = new Map();          /* class -> the first rule that names it */
  for (const m of uncomment(css).matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (!sel || sel.startsWith('@')) continue;
    for (const c of sel.matchAll(/\.(-?[_A-Za-z][-\w]*)/g)) {
      if (!out.has(c[1])) out.set(c[1], sel + '{' + m[2].trim() + '}');
    }
  }
  return out;
}

/* Class tokens app.html EMITS, from the three forms that put one on an element.
   Read outside the style blocks, so a selector is never mistaken for markup. */
function emittedClasses(html) {
  const rest = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  const out = new Set();
  const take = t => { if (/^[A-Za-z][-\w]*$/.test(t)) out.add(t); };
  for (const m of rest.matchAll(/class\s*=\s*["']([^"'<>]*)["']/g))
    m[1].split(/[\s+]+/).forEach(take);
  for (const m of rest.matchAll(/className\s*=\s*['"]([^'"]*)['"]/g))
    m[1].split(/\s+/).forEach(take);
  for (const m of rest.matchAll(/classList\.(?:add|remove|toggle|contains)\(\s*['"]([-\w]+)['"]/g))
    take(m[1]);
  return out;
}

const APP       = source('app.html');
const appStyled = styledClasses(styleBlocks(APP).join('\n'));
const appEmits  = emittedClasses(APP);

if (!appStyled.size || !appEmits.size) {
  fail('setup', 'read no classes out of app.html — the scanner, not the file');
} else {
  let checked = 0, files = 0;
  const dropped = [];
  for (const file of LEGACY) {
    const css = styleBlocks(legacy(file)).join('\n');
    if (!css.trim()) continue;
    files++;
    for (const [cls, rule] of styledClasses(css)) {
      checked++;
      if (appStyled.has(cls)) continue;      /* still has a rule */
      if (!appEmits.has(cls)) continue;      /* markup went too — a real removal */
      dropped.push({ file, cls, rule });
    }
  }

  if (!files) {
    fail('setup', `no <style> found in any of the ${LEGACY.length} deleted files at ${REF} — ` +
                  `the reader is pointed somewhere wrong, and an empty left-hand side ` +
                  `passes this check no matter what app.html lost`);
  } else {
    /* One line per class, with the rule that is missing, so the fix is a copy
       rather than an archaeology session in git. */
    for (const d of dropped) {
      fail('dropped-rule',
           `app.html still emits class "${d.cls}" and has no rule for it. ` +
           `${d.file} styled it:\n      ${d.rule.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
    if (!dropped.length) {
      pass('dropped-rule',
           `${checked} classes styled across ${files} deleted files, and every one ` +
           `app.html still emits still has a rule`);
    }
  }
}

console.log(failures ? `\n${failures} failure(s)`
                     : '\ncssdropped.js: the port left no rule behind');
process.exit(failures ? 1 : 0);
