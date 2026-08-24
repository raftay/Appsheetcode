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
/* .gs names resolve to a region of script.gs; .html names to app.html off disk or,
   for the files the cutover deleted, to the commit before it. Both indirections
   exist so the checks below keep reading what they always read. */
const read = f => (f.endsWith('.gs') ? require('./scriptgs.js').region(f)
                                    : require('./apphtml.js').source(f));

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
  /* THE SCRIPT PROPERTY STORE, stubbed, because the recipe now reads one.
     DECK_getRecipe applies the saved layout map, so a harness that cannot
     answer PropertiesService is not modelling the thing under test — and a
     stub that can be WRITTEN is what lets the override cases below exist at
     all. Everything else about the deck backend stays untouched: nothing in
     these regions calls SlidesApp until something invokes it. */
  let PROPS = {};
  const propsStub = {
    getScriptProperties: () => ({
      getProperty: k => (k in PROPS ? PROPS[k] : null),
      setProperty: (k, v) => { PROPS[k] = String(v); },
      deleteProperty: k => { delete PROPS[k]; },
    }),
  };
  const ctx = { PropertiesService: propsStub, Logger: { log() {} } };

  /* THREE REGIONS, because chunk 22 split the recipe from its checker:
     DECK_RECIPE is config and moved to §1, DECK_getRecipe is code and stayed
     in §9 — and the layout map it applies belongs to the DECK namespace in
     Deck_Backend.gs, which owns the one implementation of that store. Apps
     Script evaluates all of them into one global scope, so evaluating them
     into one context is what models the runtime — the same reason scriptgs.js
     installs APP_log before any region. Config.gs first: the array has to
     exist before the function that walks it is called, not before it is
     declared. */
  require('vm').runInNewContext(read('Config.gs'), ctx, { filename: 'script.gs (Config.gs)' });
  require('vm').runInNewContext(read('Deck_Backend.gs'), ctx, { filename: 'script.gs (Deck_Backend.gs)' });
  require('vm').runInNewContext(read('Deck_Recipe.gs'), ctx, { filename: 'script.gs (Deck_Recipe.gs)' });
  const LAYOUT_PROP = ctx.DECK_CONFIG.PROP_LAYOUTS;
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

  /* ---- the saved layout map ---------------------------------------------
     Which template layout a row is built from is editable from the Deck
     Builder page and stored shared, so DECK_RECIPE's `layout` is a DEFAULT
     now. Two things have to stay true or the feature is a trap: an untouched
     row must read exactly as it did before this existed, and an override must
     be visible AS an override rather than looking like what the recipe says.
     The second is what lets anyone tell a deliberate change from one somebody
     made by accident months ago. */
  check('layout map · with nothing stored, every row is on its recipe layout',
    out.rows.every(r => r.layout === r.recipeLayout && !r.layoutOverridden),
    out.rows.filter(r => r.layout !== r.recipeLayout).map(r => r.id).join(', '));
  check('layout map · and the recipe reports no overrides',
    out.overrideCount === 0 && Object.keys(out.overrides).length === 0);

  {
    /* one row moved to a layout the recipe does not name for it */
    const target = out.rows[0], other = out.rows.find(r => r.recipeLayout !== target.recipeLayout);
    PROPS[LAYOUT_PROP] = JSON.stringify({ [target.id]: other.recipeLayout });
    const o2 = ctx.DECK_getRecipe();
    const moved = o2.rows.find(r => r.id === target.id);

    check('layout map · a stored override is what the row is BUILT from',
      moved.layout === other.recipeLayout,
      `${target.id} built from ${moved.layout}, expected ${other.recipeLayout}`);
    check('layout map · ...and the recipe default travels beside it',
      moved.recipeLayout === target.recipeLayout,
      `recipeLayout=${moved.recipeLayout}, expected ${target.recipeLayout}`);
    check('layout map · ...and the row is flagged as moved',
      moved.layoutOverridden === true);
    check('layout map · exactly one row is affected',
      o2.rows.filter(r => r.layoutOverridden).length === 1 && o2.overrideCount === 1,
      o2.rows.filter(r => r.layoutOverridden).map(r => r.id).join(', '));
    check('layout map · every other row is untouched',
      o2.rows.filter(r => r.id !== target.id).every(r => r.layout === r.recipeLayout));
  }

  {
    /* an override that names the row's OWN default is not a change. It should
       never be written — setLayout deletes the key instead — but a store
       edited by hand can hold one, and calling it "moved" would send somebody
       hunting for a difference that is not there. */
    const target = out.rows[0];
    PROPS[LAYOUT_PROP] = JSON.stringify({ [target.id]: target.recipeLayout });
    const o3 = ctx.DECK_getRecipe();
    check('layout map · an override equal to the default is not a change',
      o3.rows.find(r => r.id === target.id).layoutOverridden === false);
  }

  {
    /* a key for a row that has since been deleted from DECK_RECIPE. It does
       nothing and explains nothing, so it has to be SAID rather than silently
       ignored — this is the one that would otherwise outlive everyone who
       knew about it. */
    PROPS[LAYOUT_PROP] = JSON.stringify({ a_row_that_was_deleted: 'L_FULL_IMAGE' });
    const o4 = ctx.DECK_getRecipe();
    check('layout map · an override for a row that no longer exists is reported',
      o4.problems.some(p => /a_row_that_was_deleted/.test(p)),
      o4.problems.join('; ') || 'no problems reported');
    check('layout map · ...and does not move any live row',
      o4.rows.every(r => r.layout === r.recipeLayout));
  }

  {
    /* a property that will not parse must not lock the page out of Plan: the
       recipe has a perfectly good default sitting in DECK_RECIPE. */
    PROPS[LAYOUT_PROP] = 'not json {{{';
    const o5 = ctx.DECK_getRecipe();
    check('layout map · an unparseable store falls back to the recipe',
      o5.rows.length === out.rows.length && o5.rows.every(r => r.layout === r.recipeLayout));
  }

  /* ==== THE ARRANGEMENT ===================================================
   * DECK_PLAN carries the order, the membership and the per-row edits;
   * DECK_TABLE_MAP carries what each scope shows. Both are shared Script
   * Properties on the PROP_LAYOUTS pattern, and both have to satisfy the two
   * rules that keep DECK_RECIPE meaningful:
   *
   *   1. NOTHING STORED = byte-identical to the recipe.
   *   2. A recipe row added AFTER an order was saved is inserted beside its
   *      recipe predecessor — not appended, not dropped.
   *
   * The second is the one that decides whether the recipe stays editable in
   * code. Without it, adding a slide to the array either does nothing
   * visible or lands it at the back of the pack, and the person who edited
   * the array has no way to tell which.
   * ======================================================================= */
  const PLAN_PROP = ctx.DECK_CONFIG.PROP_PLAN;
  const TBL_PROP  = ctx.DECK_CONFIG.PROP_TABLES;
  const setPlan  = o => { PROPS[PLAN_PROP] = JSON.stringify(o); };
  const setTbl   = o => { PROPS[TBL_PROP]  = JSON.stringify({ v: 1, scopes: o }); };
  const idsOf    = o => o.rows.map(r => r.id);
  const RECIPE_IDS = out.rows.map(r => r.id);

  {
    /* Rule 1, stated as strongly as it can be: with nothing stored the answer
       is the recipe, in the recipe's order, with every row's tick, tables and
       KPI exactly where they were before either store existed. */
    PROPS = {};
    const o = ctx.DECK_getRecipe();
    check('plan · with nothing stored the deck is the recipe, in order',
      idsOf(o).join(',') === ctx.DECK_RECIPE.map(r => r.id).join(','));
    check('plan · ...and no row is arranged, edited, added or dropped',
      o.planned === false && o.deleted.length === 0 &&
      o.rows.every(r => !r.added && !r.rowEdited));
    check('plan · ...and every row is ticked exactly as `optional` says',
      o.rows.every(r => r.on === !r.optional));
    check('table map · ...and no row has tables or a KPI of its own',
      o.scopeCount === 0 &&
      o.rows.every(r => r.tables === null && r.kpi === null &&
                        r.tablesScope === '' && r.kpiScope === ''),
      o.rows.filter(r => r.tables || r.kpi).map(r => r.id).join(', '));
    check('plan · ...and there are no problems to report',
      o.problems.length === 0, o.problems.join('; '));
  }

  {
    /* THE ORDER. Reverse the whole deck; every row must come back in that
       order and nothing else about any of them may move. */
    setPlan({ v: 1, order: RECIPE_IDS.slice().reverse() });
    const o = ctx.DECK_getRecipe();
    check('plan · a saved order is the order the deck comes back in',
      idsOf(o).join(',') === RECIPE_IDS.slice().reverse().join(','),
      idsOf(o).slice(0, 4).join(','));
    check('plan · ...with every row still there, exactly once',
      o.rows.length === RECIPE_IDS.length &&
      new Set(idsOf(o)).size === RECIPE_IDS.length);
    check('plan · ...and reordering changes nothing else about a row',
      o.rows.every(r => r.layout === r.recipeLayout && !r.rowEdited && !r.added));
    check('plan · ...and the page is told an arrangement exists',
      o.planned === true);
  }

  {
    /* RULE 2. Save an order, then add a row to DECK_RECIPE beside pv_sw_mtd
       the way somebody editing §1 would. It must land beside pv_sw_mtd in the
       arranged deck — not at the back, and not nowhere. */
    setPlan({ v: 1, order: RECIPE_IDS.slice().reverse() });
    const at = ctx.DECK_RECIPE.findIndex(r => r.id === 'pv_sw_mtd');
    const fresh = { id: 'pv_brandnew_mtd', source: 'pv', market: 'North',
                    period: 'MTD', layout: 'L_COMMENT_IMAGE', group: 'AGG',
                    title: 'AGG - NORTH - MTD' };
    ctx.DECK_RECIPE.splice(at + 1, 0, fresh);
    const o = ctx.DECK_getRecipe();
    const ids = idsOf(o);
    check('plan · a recipe row added after an order was saved is not dropped',
      ids.indexOf('pv_brandnew_mtd') !== -1);
    check('plan · ...and is inserted BESIDE its recipe predecessor',
      ids[ids.indexOf('pv_sw_mtd') + 1] === 'pv_brandnew_mtd',
      'it landed at ' + ids.indexOf('pv_brandnew_mtd') + ' of ' + ids.length +
      ', pv_sw_mtd is at ' + ids.indexOf('pv_sw_mtd'));
    check('plan · ...not appended to the back of the pack',
      ids[ids.length - 1] !== 'pv_brandnew_mtd');
    check('plan · ...and nothing is reported about it',
      o.problems.length === 0, o.problems.join('; '));
    ctx.DECK_RECIPE.splice(at + 1, 1);
  }

  {
    /* A row that precedes every anchor goes to the FRONT, not the back —
       otherwise a slide added at the top of the recipe would arrive last. */
    setPlan({ v: 1, order: ['pv_sw_mtd', 'pv_sw_ytd'] });
    const o = ctx.DECK_getRecipe();
    check('plan · a partial order keeps everything else around it',
      o.rows.length === RECIPE_IDS.length);
    check('plan · ...with the rows before the first anchor still in front',
      idsOf(o)[0] === 'fsc_mtd', idsOf(o).slice(0, 3).join(','));
  }

  {
    /* OFF AND DROP ARE DIFFERENT QUESTIONS. `off` leaves the slide in the
       list, unticked; `drop` takes it out of the pack, and Arrange lists it
       under Deleted slides so it can come back. */
    setPlan({ v: 1, off: ['fsc_mtd'], on: ['pv_swland_mtd'], drop: ['cust_no'] });
    const o = ctx.DECK_getRecipe();
    const byId2 = {}; o.rows.forEach(r => { byId2[r.id] = r; });
    check('plan · an unticked slide is still in the list, unticked',
      !!byId2.fsc_mtd && byId2.fsc_mtd.on === false);
    check('plan · an optional slide ticked here comes back ticked',
      byId2.pv_swland_mtd.on === true && byId2.pv_swland_mtd.optional === false);
    check('plan · a DROPPED slide is not in the list at all',
      byId2.cust_no === undefined && o.rows.length === RECIPE_IDS.length - 1);
    check('plan · ...and is listed under Deleted slides, so it can come back',
      o.deleted.length === 1 && o.deleted[0].id === 'cust_no' &&
      o.deleted[0].inRecipe === true && !!o.deleted[0].title,
      JSON.stringify(o.deleted));
    check('plan · ...and a deletion is NOT reported as a problem',
      o.problems.length === 0, o.problems.join('; '));
  }

  {
    /* THE TWO STALE CASES HAVE TO BE TOLD APART, or every deletion produces a
       banner nobody can clear. An id in the order that is genuinely gone is
       reported; the same id in `drop` is a deliberate deletion and is not. */
    setPlan({ v: 1, order: RECIPE_IDS.concat(['a_row_that_was_deleted']) });
    const o = ctx.DECK_getRecipe();
    check('plan · an order naming a slide that does not exist is reported',
      o.problems.some(p => /a_row_that_was_deleted/.test(p)), o.problems.join('; '));

    setPlan({ v: 1, order: RECIPE_IDS, drop: ['cust_no'] });
    const o2 = ctx.DECK_getRecipe();
    check('plan · ...but a DROPPED id in the order is not — the deletion is deliberate',
      o2.problems.length === 0, o2.problems.join('; '));

    /* the same distinction for the layout store: a dropped row's saved layout
       is not an orphan, it is waiting for a Restore */
    PROPS[LAYOUT_PROP] = JSON.stringify({ cust_no: 'L_FULL_IMAGE' });
    const o3 = ctx.DECK_getRecipe();
    check('plan · ...and neither is the saved LAYOUT of a dropped row',
      !o3.problems.some(p => /cust_no/.test(p)), o3.problems.join('; '));
    delete PROPS[LAYOUT_PROP];

    /* THE CASE THE GUARD ACTUALLY EXISTS FOR. A row that was dropped from the
       page and has SINCE been deleted from DECK_RECIPE is in neither the deck
       nor the recipe — so every "does this id still exist?" answers no, and
       without the drop list it produces three banners at once that nobody can
       clear from anywhere. It is not a problem; it is a finished deletion. */
    const gone = ctx.DECK_RECIPE.pop();
    setPlan({ v: 1, order: RECIPE_IDS, drop: [gone.id],
              rows: { [gone.id]: { title: 'edited before it was deleted' } } });
    PROPS[LAYOUT_PROP] = JSON.stringify({ [gone.id]: 'L_COMMENT_IMAGE' });
    const o4 = ctx.DECK_getRecipe();
    check('plan · a dropped row that has since left the recipe banners nothing',
      !o4.problems.some(p => new RegExp(gone.id).test(p)),
      o4.problems.join('; '));
    check('plan · ...and is still listed under Deleted slides, marked as gone',
      o4.deleted.length === 1 && o4.deleted[0].id === gone.id &&
      o4.deleted[0].inRecipe === false,
      JSON.stringify(o4.deleted));
    delete PROPS[LAYOUT_PROP];
    ctx.DECK_RECIPE.push(gone);
  }

  {
    /* PER-ROW EDITS. Source, market, period, refine, title and group are all
       editable, and '' is a real value — that is how changing a source clears
       a period the new adapter has no use for. */
    setPlan({ v: 1, rows: { pv_sw_mtd: { title: 'AGG - SW - MTD' },
                            seg_no_ytd: { source: 'rmx', market: 'North', period: '' } } });
    const o = ctx.DECK_getRecipe();
    const byId2 = {}; o.rows.forEach(r => { byId2[r.id] = r; });
    check('plan · a retitled row carries the new title',
      byId2.pv_sw_mtd.title === 'AGG - SW - MTD' && byId2.pv_sw_mtd.rowEdited === true);
    check('plan · ...and what the recipe says travels beside it',
      byId2.pv_sw_mtd.recipeRow.title === 'AGG - Southwest - MTD',
      JSON.stringify(byId2.pv_sw_mtd.recipeRow));
    check('plan · a row whose SOURCE was changed comes back under the new one',
      byId2.seg_no_ytd.source === 'rmx' && byId2.seg_no_ytd.market === 'North');
    check('plan · ...and an edit of "" really clears the field',
      byId2.seg_no_ytd.period === '', JSON.stringify(byId2.seg_no_ytd.period));
    check('plan · an untouched row is untouched',
      byId2.pv_sw_ytd.rowEdited === false &&
      byId2.pv_sw_ytd.title === 'AGG - Southwest - YTD');
  }

  {
    /* AN ADDED ROW is a slide like any other: it takes a place in the order,
       it is ticked, and it resolves up its own source's ladder. */
    setPlan({ v: 1,
      add: [{ id: 'pv_no_mtd', source: 'pv', market: 'North', period: 'MTD',
              layout: 'L_COMMENT_IMAGE', group: 'AGG', title: 'AGG - NORTH - MTD' }],
      order: ['pv_no_mtd'].concat(RECIPE_IDS) });
    const o = ctx.DECK_getRecipe();
    check('plan · an added slide is in the deck, where the order puts it',
      idsOf(o)[0] === 'pv_no_mtd' && o.rows.length === RECIPE_IDS.length + 1);
    check('plan · ...marked as added, and ticked',
      o.rows[0].added === true && o.rows[0].on === true);
    check('plan · ...with no recipe row behind it to fall back to',
      o.rows[0].recipeRow === null);
    check('plan · ...and no problems',
      o.problems.length === 0, o.problems.join('; '));
  }

  {
    /* An unparseable store must not lock anybody out of Plan: there is a
       perfectly good default sitting in DECK_RECIPE. Same rule as the layout
       map, and it has to hold for BOTH new stores. */
    PROPS = {};
    PROPS[PLAN_PROP] = 'not json {{{';
    PROPS[TBL_PROP] = '[1,2,3]';
    const o = ctx.DECK_getRecipe();
    check('plan · an unparseable arrangement falls back to the recipe',
      idsOf(o).join(',') === ctx.DECK_RECIPE.map(r => r.id).join(','));
    check('table map · ...and an unparseable table map leaves every row on its default',
      o.rows.every(r => r.tables === null && r.kpi === null));
  }

  /* ==== THE SCOPE LADDER ===================================================
   * "Change every market at once, or just this one" with no flag: a row walks
   * four keys and takes the first answer. `period` is in none of them above
   * the first, which is what makes a change to a market reach its MTD and its
   * YTD slide together — and rung 1 is there for the month they should differ.
   *
   * Land and Docks are the rung most markets do not have. They are two values
   * of Southwest's MB SUBMARKET column, not markets, so all three Southwest
   * rows carry market:'Southwest' — and a ladder that could not separate them
   * would make "Southwest" and "Southwest Docks" one setting.
   * ======================================================================= */
  {
    PROPS = {};
    setTbl({
      'pv':                 { tables: ['SUBMARKET1', 'PLANT_TYPE', 'PROD_CLASS'], kpi: { on: true } },
      'pv|Southwest':       { tables: ['SUBMARKET1', 'PROD_CLASS'] },
      'pv|Southwest|Docks': { kpi: { on: true, sheet: 'AGG SW' } },
      'row:pv_sw_ytd':      { tables: ['MARKET'] },
      'rmx':                { tables: ['SUBMARKET', 'STRENGTH'] },
    });
    const o = ctx.DECK_getRecipe();
    const b = {}; o.rows.forEach(r => { b[r.id] = r; });

    check('ladder · a source-wide selection reaches every slide that page makes',
      b.pv_cc_mtd.tables.join(',') === 'SUBMARKET1,PLANT_TYPE,PROD_CLASS' &&
      b.pv_cc_mtd.tablesScope === 'pv',
      b.pv_cc_mtd.tablesScope + ' -> ' + JSON.stringify(b.pv_cc_mtd.tables));
    check('ladder · ...and stops at the page that made it',
      b.rmx_sk_mtd.tables.join(',') === 'SUBMARKET,STRENGTH' &&
      b.seg_sk_mtd.tables === null);
    check('ladder · a market beats its source',
      b.pv_sw_mtd.tables.join(',') === 'SUBMARKET1,PROD_CLASS' &&
      b.pv_sw_mtd.tablesScope === 'pv|Southwest');
    check('ladder · ...and reaches BOTH its periods, because period is in no key',
      b.pv_sw_ytd.tablesScope !== 'pv' && b.pv_swland_ytd.tablesScope === 'pv|Southwest' &&
      b.pv_swland_mtd.tablesScope === 'pv|Southwest');
    check('ladder · one slide beats its market — the only way MTD and YTD differ',
      b.pv_sw_ytd.tables.join(',') === 'MARKET' &&
      b.pv_sw_ytd.tablesScope === 'row:pv_sw_ytd' &&
      b.pv_sw_mtd.tables.join(',') === 'SUBMARKET1,PROD_CLASS');
    check('ladder · a market with no rung of its own falls through to the source',
      b.pv_mb_mtd.tablesScope === 'pv' && b.pv_gta_ytd.tablesScope === 'pv');

    /* Land and Docks, proved separate. */
    check('ladder · Docks has a rung Southwest and Land do not',
      b.pv_swdocks_mtd.kpiScope === 'pv|Southwest|Docks' &&
      b.pv_swdocks_mtd.kpi.sheet === 'AGG SW',
      b.pv_swdocks_mtd.kpiScope);
    check('ladder · ...and Land does not read it',
      b.pv_swland_mtd.kpiScope === 'pv' && b.pv_swland_mtd.kpi.sheet === '');
    check('ladder · ...nor does plain Southwest',
      b.pv_sw_mtd.kpiScope === 'pv');
    check('ladder · ...while Docks still takes its TABLES from the market',
      b.pv_swdocks_mtd.tablesScope === 'pv|Southwest',
      'tables and KPI resolve independently, or a KPI-only rung would strand '
      + 'the tables at the source');
    check('ladder · the ladder each row walked comes back with it',
      b.pv_swdocks_mtd.scopeLadder.join(' > ')
        === 'row:pv_swdocks_mtd > pv|Southwest|Docks > pv|Southwest > pv',
      b.pv_swdocks_mtd.scopeLadder.join(' > '));
    check('ladder · ...and a row with no market has only two rungs',
      b.fsc_mtd.scopeLadder.join(' > ') === 'row:fsc_mtd > fsc',
      b.fsc_mtd.scopeLadder.join(' > '));
  }

  {
    /* A ROW WHOSE SOURCE WAS CHANGED ABANDONS ITS OLD row: SCOPE.
       Its table keys are the previous adapter's catalogue and mean nothing to
       the new one — 'seg:segment' is not something Ready-Mix can draw. Every
       other rung carries the source in its key and self-invalidates; a row:
       key does not, so setTables stamps the source on it. */
    PROPS = {};
    setTbl({
      'row:seg_mb_ytd': { tables: ['seg:segment'], 'for': 'seg' },
      'rmx':            { tables: ['SUBMARKET', 'PLANT'] },
    });
    const before = ctx.DECK_getRecipe().rows.find(r => r.id === 'seg_mb_ytd');
    check('ladder · a row: scope answers while the source is the one it is for',
      before.tables.join(',') === 'seg:segment' &&
      before.tablesScope === 'row:seg_mb_ytd');

    setPlan({ v: 1, rows: { seg_mb_ytd: { source: 'rmx', market: 'MANITOBA' } } });
    const after = ctx.DECK_getRecipe().rows.find(r => r.id === 'seg_mb_ytd');
    check('ladder · ...and is abandoned the moment the source changes',
      after.tablesScope !== 'row:seg_mb_ytd',
      'it still resolved at ' + after.tablesScope);
    check('ladder · ...resolving up the NEW source\'s ladder instead',
      after.tables.join(',') === 'SUBMARKET,PLANT' && after.tablesScope === 'rmx',
      after.tablesScope + ' -> ' + JSON.stringify(after.tables));
  }

  /* ==== WRITING ============================================================
   * The page writes through DECK_setPlan / DECK_setTables. Neither opens the
   * template, so neither can check a layout name or a table key — the page
   * banners an unknown key at Plan, where the catalogue lives. What they DO
   * check is shape, count and size, and the size guard has to refuse rather
   * than truncate: a rejected write leaves the last good arrangement in place
   * and a truncated one does not.
   * ======================================================================= */
  {
    PROPS = {};
    ctx.DECK_setPlan({ order: ['fsc_ytd', 'fsc_mtd'], off: ['cust_no'] });
    check('setPlan · writes one property, and getRecipe reads it back',
      typeof PROPS[PLAN_PROP] === 'string' &&
      ctx.DECK_getRecipe().rows[0].id === 'fsc_ytd');
    ctx.DECK_resetPlan();
    check('setPlan · reset DELETES the property rather than storing "{}"',
      !(PLAN_PROP in PROPS));
    check('setPlan · ...and the deck is the recipe again',
      ctx.DECK_getRecipe().rows.map(r => r.id).join(',')
        === ctx.DECK_RECIPE.map(r => r.id).join(','));

    /* an empty arrangement is the same as none: rule 1 has to survive a save */
    ctx.DECK_setPlan({ order: [], off: [], on: [], drop: [], rows: {}, add: [] });
    check('setPlan · saving an empty arrangement stores nothing at all',
      !(PLAN_PROP in PROPS));
  }

  {
    const fails = (label, fn, re) => {
      let msg = '';
      try { fn(); } catch (e) { msg = e.message; }
      check(label, re.test(msg), msg || 'it was accepted');
    };
    PROPS = {};
    fails('setPlan · an added slide with no id is refused',
      () => ctx.DECK_setPlan({ add: [{ source: 'pv', layout: 'L_FULL_IMAGE' }] }), /no id/);
    fails('setPlan · an added slide reusing a recipe id is refused',
      () => ctx.DECK_setPlan({ add: [{ id: 'fsc_mtd', source: 'pv', layout: 'L_FULL_IMAGE' }] }),
      /already a slide in the recipe/);
    fails('setPlan · an id the speaker-note pattern cannot read back is refused',
      () => ctx.DECK_setPlan({ add: [{ id: 'has a space', source: 'pv', layout: 'L_FULL_IMAGE' }] }),
      /not a usable slide id/);
    fails('setPlan · an added slide with no source is refused',
      () => ctx.DECK_setPlan({ add: [{ id: 'x1', layout: 'L_FULL_IMAGE' }] }), /no source/);
    fails('setPlan · an added slide with no layout is refused',
      () => ctx.DECK_setPlan({ add: [{ id: 'x1', source: 'pv' }] }), /no layout/);
    check('setPlan · ...and a refused save changed nothing',
      !(PLAN_PROP in PROPS));

    /* THE SIZE GUARD. `add` is the only unbounded part of either store. */
    const fat = [];
    for (let i = 0; i < 400; i++) {
      fat.push({ id: 'gen_' + i, source: 'pv', market: 'Central Canada', period: 'MTD',
                 layout: 'L_COMMENT_IMAGE', group: 'AGG',
                 title: 'A generated slide with a title long enough to matter ' + i });
    }
    fails('setPlan · an arrangement too big for a property is refused, not truncated',
      () => ctx.DECK_setPlan({ add: fat }), /too big to save/);
    check('setPlan · ...and nothing was written',
      !(PLAN_PROP in PROPS));

    /* AND THE GUARD MUST NOT BE SOMETHING A HUMAN CAN HIT. The figures in
       DECK_CONFIG.PROP_MAX_BYTES' header are measured here: the pathological
       case — all 43 rows reordered AND rewritten, market and period included —
       is what has to fit, because anything a person actually does is smaller. */
    const everyRow = {};
    RECIPE_IDS.forEach(id => { everyRow[id] = { title: 'A rewritten slide title for ' + id,
                                                market: 'Central Canada', period: 'MTD' }; });
    ctx.DECK_setPlan({ order: RECIPE_IDS.slice().reverse(), off: RECIPE_IDS.slice(0, 8),
                       rows: everyRow });
    check('setPlan · the whole recipe reordered AND rewritten still fits ('
      + PROPS[PLAN_PROP].length + ' of ' + ctx.DECK_CONFIG.PROP_MAX_BYTES + ')',
      PROPS[PLAN_PROP].length < ctx.DECK_CONFIG.PROP_MAX_BYTES,
      PROPS[PLAN_PROP].length + ' characters');

    /* the plain case — just an order — is the one that has to be cheap */
    PROPS = {};
    ctx.DECK_setPlan({ order: RECIPE_IDS.slice().reverse() });
    check('setPlan · ...and a reordered deck on its own costs almost nothing ('
      + PROPS[PLAN_PROP].length + ')',
      PROPS[PLAN_PROP].length < 1024, PROPS[PLAN_PROP].length + ' characters');

    /* how much room is left for added slides, stated rather than assumed */
    PROPS = {};
    let room = 0;
    try {
      for (room = 0; room < 300; room++) {
        ctx.DECK_setPlan({ order: RECIPE_IDS, add: new Array(room).fill(0).map((_, i) =>
          ({ id: 'add_' + i, source: 'pv', market: 'Central Canada', period: 'MTD',
             layout: 'L_COMMENT_IMAGE', group: 'AGG', title: 'AGG - CENTRAL CANADA - MTD ' + i })) });
      }
    } catch (e) { /* the guard fired, which is the point */ }
    check('setPlan · ...leaving room for ' + room + ' added slides on top of all 43',
      room > 40 && room < 300, room + ' added slides');
    PROPS = {};
  }

  {
    PROPS = {};
    ctx.DECK_setTables('pv', { tables: ['SUBMARKET1', 'PROD_CLASS'] });
    ctx.DECK_setTables('pv|Southwest', { kpi: { on: false } });
    let o = ctx.DECK_getRecipe();
    let b = {}; o.rows.forEach(r => { b[r.id] = r; });
    check('setTables · a scope written here is what the rows resolve to',
      b.pv_cc_mtd.tables.join(',') === 'SUBMARKET1,PROD_CLASS');
    check('setTables · ...and a KPI-only scope leaves the tables where they were',
      b.pv_sw_mtd.kpi.on === false && b.pv_sw_mtd.kpiScope === 'pv|Southwest' &&
      b.pv_sw_mtd.tablesScope === 'pv');

    /* THE ORDER IS THE SELECTION. There is one array, so "which tables" and
       "in what order" cannot disagree with each other. */
    ctx.DECK_setTables('pv', { tables: ['PROD_CLASS', 'SUBMARKET1'] });
    o = ctx.DECK_getRecipe(); b = {}; o.rows.forEach(r => { b[r.id] = r; });
    check('setTables · the array\'s order is carried through, not sorted',
      b.pv_cc_mtd.tables.join(',') === 'PROD_CLASS,SUBMARKET1');

    /* A row: scope is stamped with the source it belongs to, so a later
       source change can abandon it without the page having to remember. */
    ctx.DECK_setTables('row:pv_sw_mtd', { tables: ['MARKET'], source: 'pv' });
    check('setTables · a row: scope records which source it is for',
      JSON.parse(PROPS[TBL_PROP]).scopes['row:pv_sw_mtd']['for'] === 'pv',
      PROPS[TBL_PROP]);

    ctx.DECK_resetTables('row:pv_sw_mtd');
    check('setTables · one scope can be cleared on its own',
      !JSON.parse(PROPS[TBL_PROP]).scopes['row:pv_sw_mtd'] &&
      !!JSON.parse(PROPS[TBL_PROP]).scopes['pv']);
    ctx.DECK_resetTables();
    check('setTables · ...and reset with no scope deletes the property',
      !(TBL_PROP in PROPS));

    const fails2 = (label, fn, re) => {
      let msg = '';
      try { fn(); } catch (e) { msg = e.message; }
      check(label, re.test(msg), msg || 'it was accepted');
    };
    fails2('setTables · a selection that is not a list is refused',
      () => ctx.DECK_setTables('pv', { tables: 'SUBMARKET1' }), /has to be a list/);
    fails2('setTables · an absurd number of tables is refused',
      () => ctx.DECK_setTables('pv', { tables: new Array(40).fill(0).map((_, i) => 'D' + i) }),
      /is the limit/);
    fails2('setTables · an empty selection is refused where the source needs one',
      () => ctx.DECK_setTables('pv', { tables: [], min: 1 }),
      /at least 1 table/);
    check('setTables · ...and none of those wrote anything',
      !(TBL_PROP in PROPS));
  }

  /* ---- AN ADDED SLIDE IS A SLIDE LIKE ANY OTHER -------------------------
     It takes a layout, it is retried by id, and its layout is overridable
     from the same dropdown as every other row's. setLayout used to look the
     id up in DECK_RECIPE alone, so the one row that only exists in the plan
     was the one row whose layout could not be saved — and, worse, could not
     be CLEARED either, which is what a deletion has to do or the override
     outlives the slide as an orphan nobody can reach except by resetting
     every row at once. */
  {
    PROPS = {};
    ctx.DECK_setPlan({ add: [{ id: 'pv_added1', source: 'pv', market: 'North',
      period: 'MTD', layout: 'L_COMMENT_IMAGE', group: 'AGG', title: 'New' }] });
    const o = ctx.DECK_getRecipe();
    check('layout · an added slide is in the recipe the page is given',
      o.rows.some(r => r.id === 'pv_added1' && r.added));

    /* CLEARING NEEDS NO TEMPLATE AND NO LOOKUP: there is no name to check. So
       these are wrapped — a clear that reached readTemplate would throw
       "Cannot open the template" in this harness, and an uncaught throw kills
       the run instead of naming the check that found it. */
    const clear = id => { try { return ctx.DECK_setLayout(id, ''); }
                          catch (e) { return { error: e.message }; } };
    const cleared = clear('pv_added1');
    check('layout · an added slide\'s override can be cleared',
      cleared.overridden === false && cleared.layout === 'L_COMMENT_IMAGE',
      JSON.stringify(cleared));
    check('layout · ...and so can one for a slide that no longer exists at all',
      clear('deleted_before_you_looked').overridden === false,
      JSON.stringify(clear('deleted_before_you_looked')) +
      ' — a deleted added row leaves an override that nothing else can reach');

    let msg = '';
    try { ctx.DECK_setLayout('never_existed', 'L_FULL_IMAGE'); } catch (e) { msg = e.message; }
    check('layout · but SETTING one on a slide that does not exist is refused',
      /not in the recipe/.test(msg), msg || 'it was accepted');
    check('layout · ...and the message says where it looked',
      /Arrange stage/.test(msg), msg);

    /* SETTING one needs a template, because that is the one path with a reason
       to open it: a layout name that does not exist must never reach the store
       or every later Plan carries the mistake. So this is the only check here
       that stubs a presentation — the smallest one readTemplate reads. */
    const shape = (text, x, y, w, h) => ({
      getText: () => ({ asString: () => text }),
      getLeft: () => x, getTop: () => y, getWidth: () => w, getHeight: () => h,
    });
    const layoutSlide = id => ({
      getNotesPage: () => ({ getSpeakerNotesShape: () => ({
        getText: () => ({ asString: () => 'LAYOUT: ' + id, setText() {} }) }) }),
      getShapes: () => [shape('{{TITLE}}', 40, 30, 640, 40),
                        shape('{{IMAGE}}', 40, 90, 640, 240),
                        shape('{{PAGE}}', 660, 380, 40, 15)],
    });
    ctx.SlidesApp = { openById: () => ({
      getName: () => 'Amrize Deck Template', getPageWidth: () => 720, getPageHeight: () => 405,
      getSlides: () => [layoutSlide('L_COMMENT_IMAGE'), layoutSlide('L_FULL_IMAGE')],
      saveAndClose() {},
    }) };

    const set = ctx.DECK_setLayout('pv_added1', 'L_FULL_IMAGE');
    check('layout · an added slide can be re-pointed like any other row',
      set.overridden === true && set.layout === 'L_FULL_IMAGE',
      JSON.stringify(set));
    check('layout · ...and the recipe the page is given says so',
      ctx.DECK_getRecipe().rows.filter(r => r.id === 'pv_added1')[0].layoutOverridden === true);
    check('layout · ...while an unknown layout name still never reaches the store',
      (() => { try { ctx.DECK_setLayout('pv_added1', 'L_NOT_IN_TEMPLATE'); return false; }
               catch (e) { return /not a report layout/.test(e.message); } })());
    check('layout · ...and re-picking the row\'s own default removes the key, not stores it',
      ctx.DECK_setLayout('pv_added1', 'L_COMMENT_IMAGE').overridden === false &&
      !PROPS[LAYOUT_PROP]);
    delete ctx.SlidesApp;
    PROPS = {};
  }

  PROPS = {};
}

/* ---- finish() PUBLISHES IN THE ORDER IT WAS GIVEN ------------------------ *
 * addSlide always appends, and Publish skips a row already marked done, so a
 * slide that failed at position 30 and was retried on the next press landed
 * behind every slide built before it — and {{PAGE}} then numbered that order
 * confidently. It was survivable while DECK_RECIPE was the only order there
 * is; it stops being survivable the moment the arrangement is something
 * somebody saved.
 *
 * BOTH HALVES MATTER. finish() is on the publish path, which has never run
 * against the live deployment (README §11), so the no-argument call has to
 * stay exactly what it was — and the one place that could regress silently is
 * a reorder that runs when nobody asked for one.
 *
 * The Slides stub below is the smallest presentation `finish` actually
 * touches: getSlides / move / getObjectId / the notes page / replaceAllText.
 * Everything else in Deck_Backend.gs is left alone, which is what keeps this
 * harness dependency-free.
 * -------------------------------------------------------------------------- */
{
  /* one slide: speaker notes, an object id, and the {{PAGE}} box */
  function slideStub(pres, id, notes) {
    let page = '{{PAGE}}';
    const sl = {
      getObjectId: () => id,
      move(i) {
        const at = pres._s.indexOf(sl);
        pres._s.splice(at, 1);
        pres._s.splice(i, 0, sl);
        pres._moves++;
      },
      getNotesPage: () => ({
        getSpeakerNotesShape: () => ({
          getText: () => ({ asString: () => notes, setText(t) { notes = t; } }),
        }),
      }),
      replaceAllText(tok, val) { if (tok === '{{PAGE}}') page = val; },
      _page: () => page,
    };
    return sl;
  }
  function presStub(spec) {
    const pres = { _s: [], _closed: false, _moves: 0 };
    pres._s = spec.map(([id, notes]) => slideStub(pres, id, notes));
    pres.getSlides = () => pres._s.slice();
    pres.saveAndClose = () => { pres._closed = true; };
    return pres;
  }

  /* A deck as a retry leaves it: the cover, three layouts still in place, and
     the built slides with pv_b published LAST because it failed the first
     time round and was retried on the second press. */
  const deck = () => presStub([
    ['c',  'SLIDE: __cover__'],
    ['l1', 'LAYOUT: L_FULL_IMAGE'],
    ['l2', 'LAYOUT: L_COMMENT_IMAGE'],
    ['a',  'SLIDE: pv_a'],
    ['c1', 'SLIDE: pv_c'],
    ['d',  'SLIDE: pv_d'],
    ['b',  'SLIDE: pv_b'],
  ]);
  const ids = p => p.getSlides().map(s => s.getObjectId()).join(',');

  let PROPS = {};
  const propsStub = { getScriptProperties: () => ({
    getProperty: k => (k in PROPS ? PROPS[k] : null),
    setProperty: (k, v) => { PROPS[k] = String(v); },
    deleteProperty: k => { delete PROPS[k]; },
  }) };

  function run(order) {
    const pres = deck();
    const ctx = {
      PropertiesService: propsStub, Logger: { log() {} },
      SlidesApp: { openById: () => pres },
    };
    require('vm').runInNewContext(read('Config.gs'), ctx, { filename: 'script.gs (Config.gs)' });
    require('vm').runInNewContext(read('Deck_Backend.gs'), ctx, { filename: 'script.gs (Deck_Backend.gs)' });
    const out = ctx.DECK_finish('D1', order);
    return { pres, out };
  }

  {
    const { pres, out } = run(['pv_a', 'pv_b', 'pv_c', 'pv_d']);
    check('finish · a supplied order is what the deck is published in',
      ids(pres) === 'c,a,b,c1,d,l1,l2', ids(pres));
    check('finish · the cover stays in front of it',
      pres.getSlides()[0].getObjectId() === 'c', ids(pres));
    check('finish · the layout slides are still parked behind everything',
      ids(pres).endsWith('l1,l2'), ids(pres));
    check('finish · {{PAGE}} numbers the FINAL order, not the built one',
      pres.getSlides().filter(s => s._page() !== '{{PAGE}}')
          .map(s => s.getObjectId() + '=' + s._page()).join(',')
        === 'c=1,a=2,b=3,c1=4,d=5',
      pres.getSlides().map(s => s.getObjectId() + '=' + s._page()).join(','));
    check('finish · ...and only the built slides are numbered',
      pres.getSlides().filter(s => s._page() === '{{PAGE}}')
          .map(s => s.getObjectId()).join(',') === 'l1,l2');
    check('finish · it reports the deck proper, not the parked layouts',
      out.slides === 5 && out.templateSlidesParked === 2,
      JSON.stringify({ slides: out.slides, parked: out.templateSlidesParked }));
  }

  {
    /* NO ORDER = TODAY'S BEHAVIOUR. Built slides keep the order they landed
       in — pv_b still at the back — and only the layouts move. */
    const { pres } = run(undefined);
    check('finish · with no order, nothing is reordered',
      ids(pres) === 'c,a,c1,d,b,l1,l2', ids(pres));
    /* THE ORDER IT PRODUCES IS NOT THE ONLY CLAIM. A reorder pass that runs
       when nobody asked for one lands on the same arrangement here — the deck
       is already in build order — so it is invisible in the ids and shows up
       only as work: five slides shuffled behind the two parked layouts. This
       is the publish path, and it has to be provably untouched, not
       coincidentally unchanged. */
    check('finish · ...and makes no move but the two that park the layouts',
      pres._moves === 2, pres._moves + ' moves');

    const empty = run([]);
    check('finish · and an empty order is the same as none',
      ids(empty.pres) === 'c,a,c1,d,b,l1,l2' && empty.pres._moves === 2,
      ids(empty.pres) + ' / ' + empty.pres._moves + ' moves');
  }

  {
    /* AN ORDER THAT PREDATES A SLIDE MUST NOT THROW IT AWAY. A row added to
       the recipe after somebody saved an arrangement is not in that list; it
       keeps its place behind the named rows rather than vanishing or landing
       at the front. */
    const { pres } = run(['pv_d', 'pv_a']);
    check('finish · a built slide the order does not name is kept, at the back',
      ids(pres) === 'c,d,a,c1,b,l1,l2', ids(pres));
  }

  {
    /* An id in the order that was never built is simply not there. */
    const { pres } = run(['pv_b', 'nothing_built_this', 'pv_a', 'pv_c', 'pv_d']);
    check('finish · an ordered id with no slide behind it is skipped',
      ids(pres) === 'c,b,a,c1,d,l1,l2', ids(pres));
  }
}

console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nall checks passed');
process.exit(failed ? 1 : 0);
