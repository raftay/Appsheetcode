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

The commit to stage from is **`6400026`**, the parent of `cc3adc9` where `Deck_Fuel.html` was
added. Twelve comparisons, all identical, as of chunk 3.

## `merge.js` — the structural gate for `app.html`

Six invariants that nothing enforces at runtime: every inline script parses, every
`<template id="tpl-X">` has exactly one `AMR.page('X')`, every `getElementById` target exists
in that page's own template, no id is declared by two pages, every §A4 rule is scoped, and no
page registration leaks a global. Plus the three Apps Script templating traps that have each
shipped once — see `PLAN.md` §8.

```bash
node tests/merge.js
```

## `pageparity.js` — the old page against the merged page

Boots the legacy page and `app.html`'s port of it **side by side** under jsdom, hands both the
same model through a stubbed `google.script.run`, and diffs the DOM across every view.

```bash
npm install playwright chart.js jsdom     # none are vendored
node tests/pageparity.js
```

Install all three at once. `--no-save` prunes whatever is not on the command line, so doing
them one at a time leaves you with only the last. Chromium is already on the box at
`/opt/pw-browsers`, so `npx playwright install` is not needed.

**Add your page's case to `PAGES` before you touch the page**, not after. A case is the legacy
filename, a model fixture, the views to walk, the shared chrome to assert, and — if the page
renders a notice above its tables — the words that must survive. Two cases live there now, and
they are nearly identical because the two fuel pages are: that is the point, not duplication to
be factored out. Give each fixture the things its page does *differently* (the RMX one carries
`cyYear` and no `sask` section) or those paths are never exercised.

Three things it does deliberately, each of which took a wrong answer to find:

- **It proves each side rendered before comparing them.** Two identically empty pages diff
  clean, and that is how the first run "passed". Each side must produce a `<table>` and, where
  declared, the data notice; the fuel fixture carries an unmatched Saskatchewan customer so a
  notice that stopped rendering cannot read as a match.
- **It compares the `.card` inside `#tablesHost`, not the host.** The card is the payload and
  must be byte-identical. What sits beside it is chrome the merge is allowed to restyle, so it
  is compared as *text*: the words and numbers still have to match, the wrapper need not.
- **It stubs injected `<script src>` to resolve at once.** jsdom fetches nothing, so
  `AMR.lib.need()` would wait forever on a CDN library and `boot()` would never run. Nothing
  under test uses html2canvas or SheetJS at boot.
- **`setup` reaches state a mount does not.** Some readings are only meaningful after a
  control is driven — Product Segment opens on Central Canada, which has no KPI row, so its
  strip compares empty-to-empty until the case picks a market that has one. A case's optional
  `setup(win)` runs on both sides before anything is compared.
- **`DUMP=<page id> node tests/pageparity.js`** prints what a case actually compares. Run it
  when a mutation you expected to fail passes instead; usually the reading is not looking at
  the thing you changed.
- **Stub the ENVELOPE the caller reads, not the function name.** `getKpiValues` answers
  `{generation, cached, values}` and `AmrKpi.load` settles to null on anything else — a stub
  returning the bare store leaves the KPI strip empty and looks like a fixture that does not
  matter.
- **A renamed id is declared, not dropped.** When a port adopts a name the suite already uses
  for that role — Ready-Mix's `#rmxPreviewHost` became `#previewHost` — put it in the case's
  `legacyIds` map. The legacy side then reads the old id and the comparison still happens.
  Deleting the reading instead is how a rename hides a break.

It boots the **legacy** page too, which makes it the gate for deletions from those files: the
two dead includes chunk 6 removed from `Page_Rmx.html` would have broken the legacy side if
either had been live.

## `modparity.js` — §E holds verbatim copies

Every shared module inside `app.html`'s §E is byte-for-byte the file it was ported from. That
is what lets `regress.js`, `slidefit.js` and `deckpath.js` — all of which point at the *old*
files — count as proof about `app.html`. Line endings are normalised, because the repo is
mixed and `app.html` is LF throughout by `PLAN.md` §12.

```bash
node tests/modparity.js
```

**Retire this at chunk 13.** Once the old `.html` files are deleted there is no second copy to
compare against, and the harnesses above have to be repointed at `app.html` directly.

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

It also pins **whose dropdown is whose**. Southwest Land and Southwest Docks are a refine
*within* Southwest, so all three rows carry `market:'Southwest'` — and the deck's Region
memory was keyed by the market alone, so setting the region on one moved all three (and the
two refined rows read a different slot from the one `Page_PriceVolume` writes for them; its
`kpiViewKey` has had the refine in it all along). The cases walk the real sequence: set
Southwest, set Land, check neither moved the other, then check Docks follows Southwest until
it is given a region of its own. The period stays out of the key on purpose, so `current()`
for a view's YTD twin must return what its MTD was set to.

The harness's `localStorage` had to be replaced with `defineProperty`, not assignment: jsdom's
own throws on an opaque origin and a plain assignment leaves the getter in place, so every
read threw and every write was swallowed by the callers' `try`/`catch`. The Region memory IS
`localStorage`, so without that fix the "it remembered" cases pass for the wrong reason.

It also pins two things the Deck Builder's source check depends on.

**The Region dropdown is per row, not per page.** Manitoba and Saskatchewan read the *second*
EBITDA workbook; every other market reads the first. One merged list meant a Saskatchewan row
was offered Ontario's regions and defaulted to the first of them — a real region sheet,
silently the wrong one. It showed no wrong numbers only because the KPI strip is suppressed
for those two markets while their workbook is missing, so the day that file is uploaded is
the day it would have surfaced. The harness asserts each row is offered its own book's
regions and only those, that the recipe's capitalised spelling (`SASKATCHEWAN`) lands on the
same book, and that a missing workbook reads as missing rather than as an empty list.

**`reset()` on every source.** The adapters hold what they fetched for the life of the page —
that is what makes `prepare()` cheap the second time — so moving the server's cache version
does nothing about the copy already in the browser. The harness fails if any registered
source has no `reset()`, and checks that a slide rebuilt after `resetAll()` actually goes
back to the server instead of re-photographing what it was holding. It also checks the pair
`resetAll()` / `warmAll()`: clearing blanks the Region dropdown, and warming fills it back in
**with nothing rendered**, still scoped to each row's own workbook.

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

## `rmxcost.js` — why Ready-Mix was slow, and that the fix moves no number

```bash
node tests/rmxcost.js            # no dependencies
N=80000 node tests/rmxcost.js    # a bigger sheet
```

The execution log showed `RMX_getSlideTables` and `RMX_getKeys` at a flat **15–24 s per
call**, for every market, every time, while Aggregates answered the same shape of question
in 2–6 s. The obvious suspect was the grouping. It was not — this harness times the grouping
at **0.3 s for all twelve selections**.

What cost the time is that every one of those calls opened with `loadDataCached_()`, and the
cached bundle is **14 MB — 160 CacheService chunks** — pulled back in full to produce a
**72 KB** answer. That ratio is the whole bug, and it is exactly what the Aggregates side
never does: `PV.getReport` returns its cached report *before* it touches the pivot.

It reports chunk counts rather than pretending to know seconds: sizes and chunk counts are
arithmetic, the grouping is pure JavaScript, and CacheService itself is the one part a Node
harness cannot time.

Pins, in order:

1. **the bundle dwarfs every answer taken off it**, so a per-request bundle read can never
   be cheap;
2. **the grouping was never the cost** — under a second for all twelve;
3. **`prepareAll` writes where the readers read.** This is the failure that would otherwise
   ship silently: a warm pass that fills keys nobody looks in, where every check passes,
   the log looks healthy and every request still recomputes. The harness counts the cache
   keys a read touches — 2, against the bundle's 160 — so a key that drifts fails here
   rather than in production. `selKey_()` exists for the same reason: one definition, used
   by both sides.
4. **it moves no figure.** Every payload `prepareAll` caches is compared byte-for-byte with
   what the individual call computes, for every market × period, keys and slide alike.
5. **an upload session stays private.** "Run on my own QlikView files" must never write to
   a cache everybody reads.

## `segboot.js` — the Ready-Mix pages' boot, in a real browser

```bash
npm install playwright
node tests/segboot.js                  # checks
node tests/segboot.js /tmp/shots       # …and a screenshot per page
CHROMIUM_PATH=/path/to/chrome node tests/segboot.js
```

`RMX_prepare` replaced a boot sequence, and a boot sequence is the thing unit checks cannot
see. The failure modes are all wiring: *the page fetches the market `prepare` already handed
it*, *the loading screen never comes down*, *switching market goes back to the server
anyway*, *two progress jobs stack up and read as a flicker*.

So it boots the **real page files** — includes resolved the way `include()` resolves them —
with `google.script.run` stubbed, then counts the calls and reads the progress overlay.
Per page it fails on: more or fewer than one `RMX_prepare`, any surviving `RMX_getMarkets`,
any re-fetch of the opening market, an overlay still up after the tables rendered, a second
progress job stacked underneath, or a market switch costing more than a couple of calls.

It is a wiring test, not a data test — the payloads are synthetic.

## `bgrender.js` — the render keeps going when the tab does not

```bash
npm install playwright
node tests/bgrender.js
```

Clicking onto another tab used to stop the Deck Builder dead on whatever slide it was
rendering, and there was nothing to see: no error, no red row, the progress line just froze
mid-deck. One line caused it — a browser does not fire `requestAnimationFrame` in a hidden
tab **at all**, and `captureBare` waited for two frames before photographing. Not late.
Never.

So the property under test is not "it is fast in the background", it is *it finishes with no
frames at all* — which is what a hidden tab is, and which is testable without hiding
anything: take `requestAnimationFrame` away and see whether the capture still resolves. On
the pre-fix tree this file reports the hang after 8 s, plus the capture frame left pinned
off-screen behind it. It also fails if `AmrTick` falls back to a main-thread timer, because
that is throttled in exactly the situation it exists for.

html2canvas is stubbed. This is about the wait before it, not the picture.

## `ovperiod.js` — the Overview's Period control, in a real browser

```bash
npm install playwright
node tests/ovperiod.js                  # checks
node tests/ovperiod.js /tmp/shots       # …and three full-page screenshots
DBG=1 node tests/ovperiod.js            # dump the boot state and stop guessing
CHROMIUM_PATH=/path/to/chrome node tests/ovperiod.js
```

Two Overview changes are only visible in a browser, and both fail **silently**.

*Period now has four settings.* `Prev month (MTD)` and `Prev month (YTD)` are not server
periods — they are spans on the month cube — so pressing one has to move the slider, light
the right button, switch the page to local compute, and still leave the server payload on
the matching MTD / YTD tab, because Product Category reads it. Nothing here throws when it
breaks: it shows the wrong month's numbers, which is the exact bug Product Category had.

*A panel with nothing in it is not shown.* There is no notice and no empty frame left
anywhere on the page, so the failure mode is a card that stays behind after the selection
moved past it — again, no error, just a stale panel.

So it boots the **real page** with `google.script.run` stubbed and a **synthetic month
cube**: two years, eight months each, four rows a month, so the newest month is Aug-2025 and
the one before it is Jul-2025 — the shape the real books are in when the Slide tabs are
July's. It then presses each Period button on both tabs and reads the DOM.

It fails on: the four buttons not being there or not lighting; a Prev-month press landing on
the wrong span; **any visible `.ov-notice` / `.ov-exempt` anywhere, on any pick, on either
tab**; Product Category showing under `MTD` or `YTD`, or missing under either Prev-month
pick; an empty plants / customers / fuel / ASP-build-up table under a Prev-month span (those
all come from the cube now, so empty means the wiring went); the SAP cards or the extras-by-
type panel surviving a cube span; a single-month pick leaving *Month by month* on the page;
a 2024 window keeping the surcharge panels (their columns are a live-book field); and a card
that does not come back when a server period is pressed again.

Chart.js is stubbed to a no-op constructor. Every assertion is about a table or about whether
a card is on the page — but the stub matters more than that sounds: a chart that throws
aborts the painter around it and leaves exactly the kind of stale panel this test hunts, so
without it the whole file fails for the wrong reason.

It is a wiring test, not a data test — the payloads are synthetic.

## `fscheader.js` also proves the fuel read is cached

Added when the other backends were audited. `readData_()` did a full
`getDataRange().getValues()` of the raw tab on **every** call, and `getFscData` had no result
cache either — so the page re-read tens of thousands of rows on every open, every *↻ Update
from source*, and once more for each of the deck's two fuel slides. Nothing else in the suite
does that.

The harness counts sheet reads: the same question twice must read the sheet **once**, and a
different month must be its own entry rather than a stale hit. That is also what catches a
cache key that varies when it should not.

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

**The loading overlay comes back down.** `AmrFresh.ifChanged` raises the shell's full-screen
`sync` job but only clears it on the one path where nothing changed — every other caller is a
report page that goes straight into its own rebuild and owns the screen from there. The Deck
Builder prints a banner and stops, so when the data *had* moved the overlay sat there saying
*Checking the sheet…* over a page that had already finished: the server call showed
`Completed` in the execution log and nothing was wrong except that nobody cleared the job.
The harness fails if `Page_DeckBuilder.html` stops calling `AmrProgress.clear('sync')`, and
fails if `dbRenderAll` stops running the source check — a deck built from replaced figures
builds perfectly and goes red nowhere, so it is part of Render rather than a button that can
be skipped.

**The Region dropdown answers before a render.** It lists the KPI workbook's sheets, and that
workbook was only fetched by `prepare()`, which runs *during* a render — so every row read
*no workbook* until the first render had already been paid for, which is the wrong way round:
the region is chosen to avoid rendering the wrong one. The harness fails if `dbPlan` stops
calling `dbWarmPickers`, or if a source declares a `kpiPicker` without a `warm()` to fill it.

It also checks `Deck_Styles.html` is scoped (**every** selector under `.slide-bare`, the
wrapper `captureBare` photographs, so the file can never reach a page or the Deck Builder's
own UI) and included, and that the Southwest **Land / Docks** recipe rows filter the
Southwest *market* with a `refine`, rather than naming a market that does not exist.

## `pvlookup.js` — the mapping check, and where the header row is

Runs `PV_Backend.gs` + `PV_Lookup.gs` under Node over a grid shaped like `Combined Data CPI
Raw` — **totals band on row 1, header on row 2**, which is how that tab actually sits.

```bash
node tests/pvlookup.js           # no dependencies
```

**Why it exists.** `getPvUnmapped` failed with *"The raw tab has no "Plant" column, so the
mapping check can't run"* against a tab whose row 2 says `Plant`. `PV_Lookup.gs` had its own
copy of "the header is row 1", took the totals band for the header, resolved every column to
`-1`, and blamed the sheet. On the pre-fix file this harness reproduces that error verbatim.

That was the **third** copy of the header-row rule: `PV_Backend.readTab_` located it properly
(SCHEMA `v5`), `FSC_Backend.headerRow_` was fixed separately for the same reason, and this
one never got it. So the fix was to stop having a third copy — `PV` exports `readTab` and
`RAW_HEADER_NAMES`, `PV_Lookup` calls them — and the harness fails if a local reader comes
back or `PV.readTab` stops being used.

It also pins the other half of the rule: the two **LOOKUP** tabs are read by column
*position* and must keep row 1, so the reader has to be told nothing for them. A located
header row there would silently drop the first mapping and report a mapped plant as missing.
And it checks the two files still share one cache entry per tab, which is the only reason
the mapping check does not re-read 40k rows the page has already read.

## `qliksync.js` — the sync, and the hourly check

Runs `QlikSync.gs` against a fake Spreadsheet + Drive service.

```bash
node tests/qliksync.js           # no dependencies
```

**Batching.** The band of array formulas used to be cleared one
`getRange().clearContent()` at a time and restored one `setFormula()` at a time — a round
trip to Sheets per cell, across every raw tab, twice. That is what pushed a sync past the
Apps Script runtime limit and got the trigger killed mid-write, which is why it reported
"failed" over sheets that were correctly updated. Both go a contiguous **run** at a time now,
so the harness counts calls: six formulas in a row, two calls each way, and no `setFormula`
at all. It also pins the *result* — every anchor still re-pointed at the new height, its own
(`B3:B50040` → `B3:B7`) and across tabs — because a faster sync that writes different
formulas is not the same sync.

**The hourly check.** Nothing in the UI starts a sync. The trigger compares the exports'
modified times against the last set it saw, so an ordinary hour costs one Drive listing and
nothing else: the harness asserts a second look writes nothing and throws no cache away, and
that bumping a file's modified time is picked up. It also pins the retry rule — a run that
*could not happen* (lock held) leaves the stamp alone and is retried, a run that *finished
with a bad tab* records the stamp and logs, because that tab will be just as broken next hour.

## `freshness.js` — the data version

Runs `Config.gs` + `Code.gs` under Node with Drive stubbed, and counts the Drive calls.

```bash
node tests/freshness.js          # no dependencies
```

**Why it exists.** The version used to be a counter something had to remember to bump. A hand
edit to `REGION LOOKUP` bumped nothing, so every page kept serving figures that no longer
matched the sheet with nothing anywhere to notice — and a bump with no real change threw every
cache away for nothing. It is the workbook's last-modified time now.

Pins: it moves on a hand edit with nothing being told; it does *not* move on an untouched
sheet; each page follows its own workbook and a `readsFrom` page follows its owner's; twenty
asks cost one Drive call but forgetting the stamp reads again; an unreachable sheet still
answers rather than taking the page down; and ↻ Update from source reports *no change* on an
untouched sheet, always re-reads Drive rather than trusting the 30-second copy, and treats a
page with no version yet as changed. The **Deck Builder** is covered as its own case for the
same reason the Overview is: it owns no workbook, so without `APP_EXTRA_SOURCES.deckbuilder`
its version is a constant and its button reports "no change" however stale the deck is. It also checks PV and RMX read that same stamp instead of
keeping counters, and that the loading screen is the full-screen one with the API pages
already call left intact.

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

## `configcheck.js` — the sheet-resolution rules

Runs `Config.gs` against a stubbed Script Properties store. The case it exists for: a page
with `readsFrom` and a **stale override** from when it owned a workbook — Fuel Recovery, which
is how "reading No longer needed FSC" survived the move to the Price & Volume sheet.

Checks that `APP_sheetOwner_` redirects to the owning page, that `APP_propKey_` routes read,
save *and* clear to the same property (so a save through a `readsFrom` page cannot recreate an
orphan key), that such a page is absent from its own ⚙ panel, that `clearRetiredOverrides()`
removes exactly the dead key, and that no `readsFrom` dangles or loops.

```bash
node tests/configcheck.js
```

No jsdom, no Google access.

## `slidefit.js` — the slide layout, in a real browser

The one harness that needs a browser. jsdom has no layout — every `clientWidth` is 0 — so
`deckpath.js` can prove a slide is *assembled* and never that it *fits*, and fitting is the
whole job of `AmrPvSlide.fitSlide` / `AmrSegSlide.fitSlide`. Every way a fitter goes wrong is
silent and ships as a picture nobody can restyle: the PPI column clipped by its card, the
grand-total row cut off at the bottom, a third of the frame left white.

It builds the SAME block the Deck Builder builds (`contentOffscreen`) in the SAME frame
(`AmrSlide.build`, bare) and runs the SAME fitter, over the frame shapes the deck produces —
a comment+image slot, a short one, a tall one, the report page's own 1600x900 slide — and the
payloads that behave differently: Central Canada (five markets in the first table) and a
market with no EBITDA workbook (no KPI strip at all). Then it measures.

Per case it fails on: a table clipped by its card, a KPI card clipping its own text, the
table stack overflowing its row, the content overflowing the frame (which would make
`AmrSlide.build` scale it a second time), a white band under either column, or the two
columns ending more than 28px apart.

```bash
npm install playwright chart.js     # not vendored
npx playwright install chromium     # or set CHROMIUM_PATH to one already on the box
node tests/slidefit.js              # checks only
node tests/slidefit.js /tmp/shots   # …and a PNG per case, to look at
```

### The Product Segment cases

`seg` / `seg-short` / `seg-squat` / `seg-page`. These are the ones worth understanding,
because for a while they were passing while measuring nothing.

**The fixture used to be wrong.** Its `extras` half carried a `{extras, vap}` shape that
`extrasTypeTable()` reads nothing from, so that table came back null and every seg case was
silently a ONE-table slide. The case that actually broke in the July deck — two tall tables
and a KPI strip in an image box that is wider than it is tall — was never being laid out.
The payload is the real July 2026 Innocon slide now, and the frames run down to 560px tall.

**What they pin, beyond the shared checks:**

- **Nothing is scaled twice.** `AmrSlide.build` scales the whole stack when it overflows the
  frame. That is a last-resort clamp, not a layout: it shrinks the type the fitter just
  chose, and it pulls the content away from the edges (transform-origin is top *centre*),
  which is where the white bands down both sides of the July slides came from. The old seg
  fitter grew tables on WIDTH alone to a 30px cap and left the height to that clamp.
  `kpiScaled` reports what the strip is worth in the finished picture, and on the pre-fix
  tree the four seg cases fail exactly as the deck looked: *fitted at 10px, scaled down to
  4.4px.*
- **The caption keeps its first letter.** A bare frame keeps `AmrSlide`'s 8px pad. The
  negative body margin that lets the report page's whitespace sliders reach the real slide
  edge must not apply to a deck capture, or `SEGMENT · MTD` photographs as `EGMENT · MTD`
  the moment the fitter starts using the full width.
- **Both tables are there.** `tables !== 2` fails, so a fixture that quietly stops building
  one cannot pass again.

### The on-page KPI strip

`kpi-1100` / `kpi-900` / `kpi-1400` — not a slide at all: the *KPIs* panel above the slide
preview, which is also exactly what **Download KPI PNG** photographs. The cards are the same
ones, sized by `AmrKpi.fitStrip` instead of a slide fitter.

It is in this file because it fails the same way and only a browser can see it. Every size
inside a KPI card is `em` against the row, so the row's font-size *is* the card's size —
and Price & Volume set none at all. The cards were laid out against the 16px body font,
clipped their own text (`TOTAL SALES — PRODUC`, `▼ −0.71 / −`) and pushed the fifth card
onto a line of its own with four cards' width of white beside it. The cases fail on any
clip, any second line, or the row overflowing its panel, at the widths a report page has.

The web fonts are not vendored either, so it runs in whatever sans the machine has: every
check is a relationship between measured boxes, so it holds either way — only the exact font
sizes it prints differ from production.
