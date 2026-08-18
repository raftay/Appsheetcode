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
const read = f => (f.endsWith('.gs') ? require('./appgs.js').region(f)
                                    : fs.readFileSync(path.join(REPO, f), 'utf8'));

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

/* ---- ONE COPY OF THE SLIDE ------------------------------------------------
 * Phases 2 and 3 rewired their report pages so there is exactly one copy of
 * each algorithm; Phase 4 shipped Deck_SEG.html / Deck_RMX.html as DUPLICATES
 * of what the pages already held, and said so. That debt is what let the two
 * copies disagree: the module defaulted `By extra type` OFF while the page had
 * it ON, and the KPI-strip fitter had to be fixed in both places or in neither.
 *
 * Page_Segment.html delegates now. It keeps its own on-page cards, its own
 * table renderer and all its UI, but the SLIDE's content, its KPI cards and its
 * fitter come from AmrSegSlide. A page that re-defines any of them has grown a
 * second copy back.
 *
 * Page_Rmx.html is the one still to pay down; it is listed here as a reminder,
 * not as a failure.
 */
{
  const src = read('Page_Segment.html');
  const owned = [
    ['buildSlideContent', /function\s+buildSlideContent\s*\([^)]*\)\s*\{\s*return\s+AmrSegSlide\./],
    ['fitTables',         /function\s+fitTables\s*\([^)]*\)\s*\{\s*return\s+AmrSegSlide\./],
    ['segKpiCardsHtml',   /function\s+segKpiCardsHtml\s*\([^)]*\)\s*\{\s*return\s+AmrSegSlide\./]
  ];
  for (const [name, re] of owned) {
    check('Page_Segment.html · ' + name + ' delegates to AmrSegSlide', re.test(src),
      'it holds its own copy again — fix the slide in Deck_SEG.html and let the page call it');
  }
  /* the fitter that only ever lived on the page */
  check('Page_Segment.html · no second KPI-strip fitter',
    !/function\s+fitSegKpiRow/.test(src),
    'the strip is sized by AmrSegSlide, inside the fitter that knows the frame height');
  /* exportSel must be RESOLVED, not passed half-filled: an absent key means
     "the module's default", and the two disagree about `By extra type`. */
  check('Page_Segment.html · passes a fully resolved exportSel',
    /'seg:segment':\s*isOn\(/.test(src) && /'seg:byType':\s*isOn\(/.test(src)
      && /'seg:detail':\s*isOn\(/.test(src),
    'a key left out falls back to the module default, which differs from this page\'s');
}

/* ---- ONE PULL, ONE LOADING SCREEN ----------------------------------------
 * Both Ready-Mix pages opened by asking the server for one market at a time,
 * and every one of those calls began with loadDataCached_() - 160 CacheService
 * chunks to produce a one-chunk answer (tests/rmxcost.js has the sizes). On top
 * of that each page ran its own background loop over every market x period, so
 * opening the page was a dozen of those reads, serially, in front of anything
 * the user did next.
 *
 * RMX_prepare replaces all of it: one execution, one bundle read, every
 * selection computed and cached. So the pages must ask for it, must NOT carry a
 * warm loop any more, and must show ONE loading screen - AmrProgress shows the
 * lowest-order job and lists the rest, so several keys going up and down at
 * their own moments is exactly what read as flicker.
 */
for (const page of ['Page_Rmx.html', 'Page_Segment.html']) {
  const src = read(page);
  check(page + ' \u00b7 opens with RMX_prepare', /\.RMX_prepare\(/.test(src),
    'the page still asks for one market at a time, and each of those reads the whole bundle');
  check(page + ' \u00b7 no per-market warm loop', !/function\s+warm(Keys|Markets)\b/.test(src),
    'prepare warms every selection server-side off ONE bundle read; a client loop '
    + 'undoes that by asking for each one separately');
  /* one job key, and it is cleared in exactly one place */
  const keys = [...src.matchAll(/AmrProgress\.(?:set|fail)\(\s*'([a-z]+)'/g)].map(m => m[1]);
  const uniq = [...new Set(keys)];
  check(page + ' \u00b7 raises one progress key, not several',
    uniq.length <= 1, 'raises ' + JSON.stringify(uniq) + ' - each one is another screen');
  check(page + ' \u00b7 no "done" tick between screens', !/AmrProgress\.done\(/.test(src),
    'a tick that flashes for 1.2s and is replaced by the next job is the flicker');
}

/* ---- ONE SCREEN, ACROSS EVERY PAGE --------------------------------------
 * The rule is the shell's, not each page's: AmrBoot holds ONE screen until every
 * step a page named has landed, and AmrProgress waits out a grace period so
 * anything quick paints nothing at all. A page that opens without naming its
 * boot steps goes back to taking its screen down when the FIRST thing finishes,
 * which is how people ended up reading half-filled pages.
 *
 * `done()` is banned outright. It flashes a tick for 1.2s and is then replaced
 * by whatever goes up next, which is the flicker itself.
 */
for (const page of ['Page_Overview.html', 'Page_PriceVolume.html', 'Page_Segment.html',
                    'Page_Rmx.html', 'Page_FuelSurcharge.html', 'Page_RmxFuel.html']) {
  const src = read(page);
  check(page + ' \u00b7 names its boot steps', /AmrBoot\.need\(/.test(src),
    'without AmrBoot the opening screen comes down when the first call returns');
  check(page + ' \u00b7 answers them', /AmrBoot\.(done|fail)\(/.test(src),
    'a step that never reports is a loading screen that never lifts');
  check(page + ' \u00b7 no "done" tick anywhere', !/AmrProgress\.done\(/.test(src),
    'a tick that flashes and is replaced by the next job is the flicker');
}
check('Shell.html \u00b7 AmrBoot exists', /window\.AmrBoot\s*=/.test(read('Shell.html')));
check('Shell.html \u00b7 AmrProgress has a grace period',
  /GRACE/.test(read('Shell.html')),
  'without it every sub-second fetch flashes a screen');
check('Page_Rmx.html \u00b7 no longer boots through RMX_getMarkets',
  !/\.RMX_getMarkets\(/.test(read('Page_Rmx.html')),
  'that call opens with loadDataCached_() too, so it was an 18-second call to fill a dropdown');

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

/* ---- the shell's loading overlay comes back down ------------------------- *
 * AmrFresh.ifChanged puts up the full-screen 'sync' job, but only takes it
 * down again on the ONE path where nothing changed. Every other caller is a
 * report page that goes straight into its own rebuild and owns the screen from
 * there. The Deck Builder does not: it prints a banner and stops. So when the
 * data HAD moved, the overlay sat there saying "Checking the sheet…" over a
 * page that had already finished, with the banner visible behind it — the
 * server call showed Completed in the execution log and nothing was wrong
 * except that nobody had cleared the job. It must clear it itself.
 * -------------------------------------------------------------------------- */
{
  const src = read('Page_DeckBuilder.html');
  check('deck builder · takes the shell\'s sync overlay down itself',
    /AmrProgress\s*\.\s*clear\s*\(\s*['"]sync['"]\s*\)/.test(src),
    'no AmrProgress.clear(\'sync\') — ifChanged only clears it when nothing changed');

  /* Render must run the check itself. There is deliberately no button for it:
     a deck built from figures the sheet replaced an hour ago builds perfectly
     and goes red nowhere, so it must not be skippable. */
  const render = src.slice(src.indexOf('function dbRenderAll'));
  check('deck builder · Render runs the source check first',
    /function dbRenderAll[\s\S]{0,900}?dbSourceCheck\s*\(/.test(render),
    'dbRenderAll does not call dbSourceCheck');

  /* And the Region dropdown has to be answerable BEFORE a render, or the
     choice it exists to offer can only be made after paying for the render
     that used the wrong one. The KPI workbook is loaded by prepare(), which
     runs during a render, so Plan has to warm it separately. */
  check('deck builder · Plan warms the Region dropdowns',
    /function dbPlan[\s\S]{0,3000}?dbWarmPickers\s*\(/.test(src),
    'dbPlan does not call dbWarmPickers — pickers stay blank until a render');

  /* A HIDDEN TAB IS THE NORMAL WAY TO RUN THIS PAGE. Nobody watches forty
     slides go by, so the render has to survive the tab going to the
     background — and two browser behaviours between them used to stop it:
     requestAnimationFrame does not fire at all in a hidden tab, and a
     main-thread setTimeout is clamped to once a second and then once a
     minute. Both are covered by AmrTick (worker-backed), and both regress
     invisibly: the page simply sits there. */
  check('deck builder · the render loop is paced by a worker timer',
    /function dbSoon[\s\S]{0,200}?AmrTick\s*\(/.test(src) &&
    /dbSoon\s*\(\s*next\s*\)/.test(src),
    'the slide loop yields with a bare setTimeout — a hidden tab throttles it to '
    + 'one slide a second, then one a minute');

  check('slide export · the capture does not wait on a frame that never comes',
    /AmrTick\s*&&\s*AmrTick\.frames/.test(read('SlideExport.html')),
    'captureBare still waits on requestAnimationFrame alone — in a background tab '
    + 'that callback never fires and the render stops on that slide, forever');

  check('shell · AmrTick runs its timer in a worker',
    /window\.AmrTick\s*=/.test(read('Shell.html')) &&
    /new\s+Worker\s*\(/.test(read('Shell.html')),
    'AmrTick is missing or is a plain setTimeout wrapper, which is what it exists '
    + 'to avoid');

  /* Choosing a Region mid-render must not end the render or lose the slide. */
  const pick = src.slice(src.indexOf('function dbPickKpi'),
                         src.indexOf('function dbPickKpi') + 2200);
  check('deck builder · choosing a Region does not end a running render',
    !/setBusy\s*\(\s*false\s*\)/.test(pick),
    'dbPickKpi calls setBusy(false) — pressed mid-render it re-enables Render and '
    + 'Publish over a pass that is still going');
  check('deck builder · and puts an already-photographed slide back in the queue',
    /RQ\.list\.push\s*\(\s*row\s*\)/.test(pick),
    'a slide dropped by a Region change is left "pending" and never rebuilt');
  check('deck builder · a slide records which Region it was photographed with',
    /row\.kpiUsed\s*=\s*dbKpiNow\s*\(/.test(src),
    'nothing records the region a picture used, so a later change cannot tell '
    + 'which pictures went stale');
  check('deck builder · no row pins a Region over the source\'s own memory',
    /delete\s+row\.spec\.kpiSheet/.test(pick),
    'a kpiSheet left pinned on a row outranks the view memory, so the row goes '
    + 'stale the moment its MTD/YTD twin is changed instead');
}

/* ---- the Region memory is keyed by VIEW, and Land / Docks are views -------- *
 * Southwest Land and Southwest Docks are a refine WITHIN Southwest, so all
 * three rows carry market:'Southwest'. Page_PriceVolume's kpiViewKey has always
 * had the refine in the key; the deck's copy did not, so one dropdown moved all
 * three rows — and the refined rows read a different slot from the one the
 * report page writes. The period stays OUT of the key on purpose: MTD and YTD
 * of one view read the same region sheet, and that pair moving together is the
 * only sharing anybody wants.
 * -------------------------------------------------------------------------- */
{
  const pv = read('Deck_PV.html');
  const key = (pv.match(/function kpiViewKeyFor[\s\S]*?\n  }/) || [''])[0];
  check('deck · the Region key takes the refine',
    /function kpiViewKeyFor\s*\(\s*filterField\s*,\s*filterValue\s*,\s*refine\s*\)/.test(key),
    'kpiViewKeyFor ignores the refine — Southwest, Southwest·Land and '
    + 'Southwest·Docks then share one slot');
  check('deck · ...and not the period',
    !/period/.test(key),
    'the period is in the Region key — MTD and YTD would remember separately, '
    + 'and they read the same sheet');
  check('deck · every Region call site passes the row\'s refine',
    (pv.match(/bookOf\(spec\),\s*spec\.refine\)/g) || []).length >= 2 &&
    /kpiRemember\('MARKET',\s*filterValueOf\(spec\.market\),\s*sheet,\s*spec\.refine\)/.test(pv),
    'a call site still drops the refine, so what is written and what is read '
    + 'disagree');
  check('deck · and the report page keys it the same way',
    /kpiViewKey\s*\(\)\s*\{[\s\S]{0,240}?refineValue/.test(read('Page_PriceVolume.html')),
    'Page_PriceVolume no longer keys its Region memory by the refine — the two '
    + 'now disagree about which slot a Land slide reads');
}

/* ---- the source contract ------------------------------------------------- *
 * Every source that feeds a Region dropdown must be able to fill it in before
 * anything is rendered. prepare() loads the KPI workbook too, but prepare()
 * only runs during a render — so a source with a kpiPicker and no warm() puts
 * the page back to reading "no workbook" on every row until the first render
 * has already happened.
 * -------------------------------------------------------------------------- */
{
  ['Deck_PV.html', 'Deck_SEG.html'].forEach(f => {
    const src = read(f);
    if (!/kpiPicker\s*:/.test(src)) return;
    check(f + ' · a source with a Region dropdown warms it',
      /\bwarm\s*:\s*function/.test(src),
      'declares kpiPicker but no warm() — the dropdown cannot answer until a render');
  });
}

/* ---- the recipe ---------------------------------------------------------- */
{
  const ctx = {};
  require('vm').runInNewContext(read('Deck_Recipe.gs'), ctx, { filename: 'app.gs (Deck_Recipe.gs)' });
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
