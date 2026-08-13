# tests/

Node harnesses for the parts of the suite that can be checked **without** Google access.

They exist because most of this project cannot be tested off-platform — anything touching
SlidesApp, DriveApp, CacheService or a spreadsheet needs the live deployment. What *can* be
checked is the pure client-side compute and render layer, and that is exactly where the Deck
Builder extraction work lives. These two harnesses are the regression gate for Phases 3–4.

Nothing here is uploaded to Apps Script. The repo root is a flat mirror of the script
project; this folder is not part of it.

## `regress.js` — the extraction gate

Runs the **pre-extraction** page code and the **post-extraction** shared module over the same
data model and diffs the HTML. The pass condition is byte-identical output.

This is the test that makes moving code out of a working page safe. Every phase that pulls a
page's builders into a shared include should extend it before touching the page.

Covers both fuel pages × three period modes × clean and edited state, where *edited* means
typed numeric overrides, a renamed label, and a hidden market — the paths the shared `ctx`
replaced, and the ones where a silent regression would only ever surface in somebody's
already-edited slide.

```bash
# stage the pre-change pages somewhere, then point the harness at them
mkdir -p /tmp/old
git show <commit-before-your-change>:Page_FuelSurcharge.html > /tmp/old/old_fsc.html
git show <commit-before-your-change>:Page_RmxFuel.html       > /tmp/old/old_rfsc.html
OLD_DIR=/tmp/old node tests/regress.js
```

The line ranges for the old files are in the `CASES` array — they bracket the state block
through the last exec builder. Re-check them against the commit you are diffing; they are
line numbers, and they move.

## `deckpath.js` — the deck's own path

Loads `Deck_Sources.html` then `Deck_Fuel.html` under jsdom with `google.script.run` stubbed,
and drives `AmrDeckSource.build(spec)` exactly as the Deck Builder's Render stage does.

Checks that the adapters register, that each recipe row yields a content block with
`contenteditable` stripped and the right period heading, that an unregistered source rejects
with a readable sentence rather than a stack trace, and that each backend is called **once**
across the two slides that share it.

```bash
npm install jsdom     # not vendored
node tests/deckpath.js
```

Add a case here for every new source id a phase registers.

## `fscheader.js` — the Fuel Recovery reader

Runs `FSC_Backend.gs` under Node with its two Apps Script globals stubbed
(`APP_openSpreadsheet_` returns a fake spreadsheet, `PV.saskMonthly` returns nothing), over a
grid shaped like the real `Combined Data CPI Raw` tab — **totals band above the header
included**.

It exists because the page failed with *"missing these column(s): Plant, Year, Month, "####
Volume", New Fuel Surcharge"*, which was never five renamed columns: the reader took the
totals band as the header row. On the pre-fix `FSC_Backend.gs` this harness reproduces that
error verbatim.

```bash
node tests/fscheader.js          # no dependencies
```

Covers the band layout, a band-less file, prior-year rows landing on the PY revenue and PY
volume columns, and a genuinely wrong header still failing — with the row number it read.

It also covers the **report month**, built relative to today so it cannot rot: this backend
used to resolve to the newest month in the file, so once the sheet carried a part-billed
running month it published that one while the other three backends published last month.
The cases assert the default lands on last month, that an explicit month pins it, and that
it falls back to the newest month present when last month is not exported yet.

## `deckstatic.js` — the CSS the deck can actually see, and the recipe

No browser, no Google, no dependencies. Run it after touching a deck module, a report
page's styles, or the recipe.

```bash
node tests/deckstatic.js
```

**Why it exists.** The July 2026 deck published all 43 slides and every one of them was
photographed with its styling missing. Phases 2–4 lifted the slide *builders* into
`Deck_*.html`; the CSS their markup depends on stayed behind in each report page's own
style block. The pages still looked right — they include their module *and* have the CSS —
but the Deck Builder includes the modules **without** the pages. Headings rendered as
unstyled body text running straight into their badge, and Price & Volume tables fell back
to the generic cell padding, which is wide enough that the PPI column was cut in half by
the card's `overflow:hidden`. Nothing threw. On the pre-fix tree this harness names all
**46** orphaned classes across the four modules.

So: every class a deck module puts in its markup must have a rule in `Styles.html` or
`Deck_Styles.html`. A class styled only in a report page fails, and the failure names the
page to copy the rule from. Classes positioned by inline styles, and interaction-only ones
(`:hover`, `cursor`) that a still photograph cannot show, are listed in `INLINE_ONLY`
— add to that list only when the class genuinely has nothing to render.

**One fitter.** The deck used to capture into an unbounded box, so each module carried a
second width-only `fitBare` for it — with no height in the frame nothing fitted vertically,
and the far end of the pipeline shrank the whole picture into the image box, taking rows and
columns with it. The deck builds the same framed slide the pages do now, so `fitSlide` is
the only fitter and the harness fails on any `function fitBare`, `fitBare:` or `.fitBare`.
Prose about it is fine; a definition is not.

**One month.** The deck is built for one report month — pick July and every slide is July,
MTD and YTD, on all four backends. Each adapter used to hard-code `month: 0` in its server
call, so the picker could not reach it; the harness fails on any `month: 0` left in an
adapter or in the Deck Builder.

It also checks `Deck_Styles.html` is scoped (**every** selector under `.slide-bare`, the
wrapper `captureBare` photographs, so the file can never reach a page or the Deck Builder's
own UI) and included, and that the Southwest **Land / Docks** recipe rows filter the
Southwest *market* with a `refine`, rather than naming a market that does not exist.

## Also worth running

```bash
# every inline <script> in a page must parse — the house rule, and cheap
node --check <(sed -n '/<script>/,/<\/script>/p' Page_X.html)   # or the checkjs helper
```

`.gs` files need a `.js` extension before `node --check` will look at them.

Both harnesses take a synthetic model and need no Google access, so they run anywhere Node
does. Keep `tests/node_modules` out of git — the repo root must stay a clean mirror of the
Apps Script project.

## `pvcheck.js` — the Price & Volume lift

Same idea as `regress.js` but for `Deck_PV.html`: runs the old page's definitions and the
extracted module over the same fixtures and diffs the HTML. Covers the paths that need no
Chart.js — `tableInnerHtml`, `monthTag_`, `slideTitle`, and `buildCustTable` across every
secondary dimension, sort direction and top-N.

```bash
cp Page_PriceVolume.html /tmp/old/old_pv.html    # pre-rewiring copy
OLD_DIR=/tmp/old node tests/pvcheck.js
```

Extend it as Phase 3 lifts more (`custSlideSpec` next). The chart paths cannot be diffed
this way — Chart.js needs a real canvas — so those are checked in the browser.

`deckpath.js` stubs `Chart` and `HTMLCanvasElement.getContext` — jsdom has neither, and the
PV slides need both. That exercises the block's *assembly* (tables, KPI cards, chart slots);
whether a chart looks right is a browser check. The `google.script.run` stub returns a fresh
runner per access on purpose: `cust` asks for MTD and YTD in parallel, and a shared success
handler silently hangs the second call.
