/* The Deck Builder's static gates — no browser, no Google, no dependencies.
 *
 * ---------------------------------------------------------------------------
 * 1. CSS COVERAGE  —  the bug that shipped the July deck
 *
 * The slide BUILDERS were lifted out of the report pages into Deck_Fuel /
 * Deck_PV / Deck_SEG / Deck_RMX. The CSS their markup depends on stayed behind
 * in each page's private <style>. Every report page still includes its own
 * module, so the pages looked right — but the Deck Builder includes the modules
 * WITHOUT the pages, and every generated slide was photographed with that
 * styling missing: headings rendered as unstyled body text running into their
 * badge, and Price & Volume tables fell back to the generic cell padding, which
 * is wide enough that the last column was cut in half on every AGG slide.
 *
 * Nothing failed. The deck published 43 slides that were simply wrong, and a
 * picture cannot be restyled after the fact.
 *
 * So: every class a deck module puts in its markup must have a rule the DECK
 * BUILDER can see — Styles.html or Deck_Styles.html. A class styled only in a
 * report page is the exact defect above and fails here.
 *
 * 2. RECIPE  —  Southwest Land / Docks are not markets
 *
 * Those four rows used to say market:'Southwest Land', which matches no market,
 * so they published a page of zeroes instead of failing. They are a refine
 * WITHIN Southwest, and DECK_getRecipe has to carry `refine` through to the
 * page or the fix is inert.
 *
 *   node tests/deckstatic.js
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

let failed = 0;
function check(label, ok, detail) {
  if (!ok) failed++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok || !detail ? '' : '\n        ' + detail));
}

/* ---- what a file's markup USES vs what its <style> blocks DEFINE ---------- */
function classesUsed(src) {
  const out = new Set();
  for (const m of src.matchAll(/class(?:Name)?\s*=\s*['"]([^'"<>{}]+)['"]/g))
    for (const c of m[1].split(/\s+/)) if (c) out.add(c);
  return out;
}
/* HTML comments come off first: a doc comment that merely MENTIONS a style tag
   would otherwise open a bogus block and drag prose in as CSS. */
function styleText(src) {
  return [...src.replace(/<!--[\s\S]*?-->/g, '')
             .matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
}
function classesDefined(src) {
  return new Set([...styleText(src).matchAll(/\.([A-Za-z][\w-]*)/g)].map(m => m[1]));
}

/* Classes the modules position with INLINE styles — they are hooks for the
   fitters (querySelector) and JS, never for a stylesheet. Listing them keeps
   the gate honest instead of loose. */
const INLINE_ONLY = new Set([
  'pv-exp-row', 'pv-exp-tables', 'pv-exp-tables-inner', 'pv-exp-charts', 'pv-exp-kpis',
  'pv-chart-block', 'pv-chart-title',
  'cust-blk', 'cust-blk-lbl',
  'rmx-exp-row', 'rmx-exp-inner', 'mkt-card', 'export-cb',
  'seg-slide-wrap', 'seg-kpi-row',
  'fsc-cell',
  /* interaction-only: the deck photographs a static page, so a cursor or a
     hover state has nothing to change */
  'impact', 'impact-go', 'impact-i', 'impact-t', 'phold', 'fsc-in', 'fsc-calc',
  'has-kids',
]);

const deckVisible = new Set([
  ...classesDefined(read('Styles.html')),
  ...classesDefined(read('Deck_Styles.html')),
]);

const MODULES = {
  'Deck_PV.html': 'Page_PriceVolume.html',
  'Deck_RMX.html': 'Page_Rmx.html',
  'Deck_SEG.html': 'Page_Segment.html',
  'Deck_Fuel.html': 'Page_FuelSurcharge.html',
};

for (const [mod, page] of Object.entries(MODULES)) {
  const used = classesUsed(read(mod));
  const own = classesDefined(read(mod));
  const pageOnly = [...used].filter(c =>
    !deckVisible.has(c) && !own.has(c) && !INLINE_ONLY.has(c));
  check(mod + ' · every styled class reaches the Deck Builder', pageOnly.length === 0,
    pageOnly.length ? 'styled only in ' + page + ': ' + pageOnly.sort().join(', ') +
      '\n        → add the rule to Deck_Styles.html (scoped under .slide-bare)' : '');
}

/* Deck_Styles must not leak outside a capture: every selector sits under
   .slide-bare, so it can never reach the Deck Builder's own UI. */
{
  const css = styleText(read('Deck_Styles.html')).replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap(m => m[1].split(',')).map(s => s.trim()).filter(Boolean);
  const leaky = selectors.filter(s => !s.startsWith('.slide-bare'));
  check('Deck_Styles.html · every rule is scoped to .slide-bare', leaky.length === 0,
    leaky.slice(0, 5).join(' | '));
  check('Deck_Styles.html · is included by the Deck Builder',
    /include\('Deck_Styles'\)/.test(read('Page_DeckBuilder.html')));
}

/* ---- ONE FITTER ----------------------------------------------------------
 * The deck used to photograph content in an unbounded box and each module
 * carried a second, width-only `fitBare` for it. With no height in the frame
 * nothing could fit vertically, the stack ran as tall as it liked, and the
 * server shrank the whole picture into the image box — taking rows and columns
 * with it. The deck now builds the same framed slide the pages do, so fitSlide
 * is the only fitter. A second one reintroduces the drift, and the two would
 * disagree exactly where nobody is looking: in the generated deck.
 *
 * Prose may still explain it; a definition, export or reference may not.
 */
for (const mod of [...Object.keys(MODULES), 'SlideExport.html', 'Page_DeckBuilder.html']) {
  const src = read(mod);
  const code = [/function\s+fitBare/, /fitBare\s*:/, /\.fitBare\b/]
    .filter(re => re.test(src)).map(String);
  check(mod + ' · no second, bare-capture fitter', code.length === 0,
    'found ' + code.join(', ') + ' — the deck and the pages must share fitSlide');
}

/* ---- ONE MONTH ------------------------------------------------------------
 * The deck is built for ONE report month — pick July and every slide is July,
 * MTD and YTD, on all four backends. Every adapter used to hard-code `month: 0`
 * in its server call, which meant "whatever the backend calls the last closed
 * month" and could not be steered at all. A single `month: 0` left behind is a
 * slide that quietly ignores the picker, and it looks right until someone
 * builds last quarter's deck.
 *
 * Each backend resolves 0 to last calendar month itself, so the literal is only
 * ever wrong here — in the layer that has a spec to read it from.
 */
for (const mod of [...Object.keys(MODULES), 'Page_DeckBuilder.html']) {
  const hits = [...read(mod).matchAll(/month\s*:\s*0\b/g)].map(m => m[0]);
  check(mod + ' · no adapter hard-codes the report month', hits.length === 0,
    'found ' + hits.length + ' × "month: 0" — pass monthOf(spec) so the deck\'s picker reaches it');
}

/* ---- the recipe ---------------------------------------------------------- */
{
  const ctx = {};
  require('vm').runInNewContext(read('Deck_Recipe.gs'), ctx, { filename: 'Deck_Recipe.gs' });
  const out = ctx.DECK_getRecipe();

  check('recipe · no structural problems', out.problems.length === 0, out.problems.join('; '));

  const byId = {};
  out.rows.forEach(r => { byId[r.id] = r; });
  const land = ['pv_swland_mtd', 'pv_swland_ytd'];
  const docks = ['pv_swdocks_mtd', 'pv_swdocks_ytd'];

  check('recipe · Land / Docks rows filter the Southwest MARKET',
    land.concat(docks).every(id => byId[id] && byId[id].market === 'Southwest'),
    land.concat(docks).map(id => id + '=' + (byId[id] || {}).market).join(', '));
  check('recipe · and carry the refine through DECK_getRecipe',
    land.every(id => byId[id].refine === 'Land') &&
    docks.every(id => byId[id].refine === 'Docks'),
    land.concat(docks).map(id => id + '→' + (byId[id] || {}).refine).join(', '));
  check('recipe · no market is spelled "Southwest Land" / "Southwest Docks" any more',
    !out.rows.some(r => /^southwest (land|docks)$/i.test(r.market)));
  check('recipe · every other row still has an empty refine',
    out.rows.filter(r => r.refine).length === 4);
}

console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nall checks passed');
process.exit(failed ? 1 : 0);
