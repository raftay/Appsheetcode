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

## `publish.js` — pulling, showing, and telling everyone

Runs `Code.gs` + `QlikSync.gs` under Node with the two page backends stubbed at their
generation-bumping edge, plus static checks over `Shell.html`.

```bash
node tests/publish.js            # no dependencies
```

**Why it exists.** The pull used to end with `syncAll()`, moving every page's data version the
instant the sheet was written. That version is the only thing that ever clears a device's
saved tables, so a sync yanked the ground out from under whoever was reading: the page you
were on kept its tables (nothing re-checks mid-session, so the pull looked like it did
nothing), and navigating away and back wiped the device copy against a cold server cache —
one page load then had to rebuild 50k rows, which is where the blank page came from.

Server side it pins: the pull records what it wrote **before** publishing and only forgets it
once the publish went through; publishing touches only the pages that were waiting; a page
whose bump throws stays on the list with `ok:false`; and the answer rides along on
`getDataVersion` so a page open costs no extra round trip.

It also pins the **running flag expiring**. A run killed at the runtime limit never reaches
its `finally`, so a stuck flag would grey out every page in the suite forever. Anything older
than the window, or corrupt, reads as finished and is cleaned up.

Client side (static, no jsdom): a scrim exists in the shell with no dismiss control, the
watcher pauses while the tab is hidden and polls faster during a pull, a finished pull *or* a
generation that moved while we weren't looking reloads the page, and a failed poll is not
treated as news. The forced prompt is checked for having no way out — `data-locked` honoured
by both dismissal handlers, no ✕, exactly one action and no *Later* — along with the two
judgement calls: a failed publish keeps a way out, and page open forces rather than offers.

One section guards a trap the prompt walked into on the way here: `AmrProgress.detail()` was a
single page-wide registration, so a shared module using it would have taken the popover away
from the Overview's month history. Detail bodies are keyed by job now.

These are static checks in the spirit of `deckstatic.js`: jsdom is not vendored, so nothing
here renders. **The scrim and the modal still want looking at in a real browser** — the
harness proves the wiring, not the look.

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

The web fonts are not vendored either, so it runs in whatever sans the machine has: every
check is a relationship between measured boxes, so it holds either way — only the exact font
sizes it prints differ from production.
