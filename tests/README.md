# tests/

Node harnesses for the parts of the suite that can be checked **without** Google access.

They exist because most of this project cannot be tested off-platform — anything touching
SlidesApp, DriveApp, CacheService or a spreadsheet needs the live deployment. What *can* be
checked is the pure client-side compute and render layer, and that is exactly where the Deck
Builder extraction work lives.

Nothing here is uploaded to Apps Script. The repo root is a flat mirror of the script
project; this folder is not part of it.

**The whole script project is `script.gs`, `app.html` and `appsscript.json`.** Both merged
files have a reader in front of them:

| | reader | reads a deleted file out of |
|---|---|---|
| server | `scriptgs.js` — one **region** of `script.gs` | git, at `4d8ee5d` |
| client | `apphtml.js` — a **module / style layer / page** of `app.html`, or a deleted file whole | git, at `61b714c` |

Read the reader's header before pointing anything new at either file. The distinction that
matters is *which* of the two things a harness wants: the code that **ships** (a region of the
merged file) or the app it **replaced** (the deleted file, out of git). `deckpath` walks the
deck adapters, so it wants §E; `pageparity` is a comparison, so it wants the old page. Getting
that backwards leaves a harness testing a file nobody serves.

**The legacy half of a comparison retires when a page or module is deliberately changed** —
not when the files are deleted. Until then `app.html` really is a port of those files and the
comparison really does mean something. `pageparity.js` and `cssparity.js` are what is left of
that family; delete them at that point rather than weakening them.

`gsparity.js` and `modparity.js` were the two parity gates and are **gone**, on exactly that
rule and by their own instruction. The CY/PY header work changed code inside moved regions of
both files on purpose, so neither file is a copy of anything any more and a gate saying
otherwise could only be weakened, never passed. What they were protecting — that a region
sliced out of `script.gs` or `app.html` is the code that actually runs — is now protected by
the harnesses that run that code rather than by comparing it to a commit.

Install everything at once: `npm install playwright chart.js jsdom`. `--no-save` prunes
whatever is not on the command line, so doing them one at a time leaves you with only the last.
Chromium is already at `/opt/pw-browsers`.

## The two harnesses that were deleted, and why it was not laziness

`regress.js` and `pvcheck.js` are gone. Both did the same thing: run the **pre-extraction**
page code and the extracted module over one model and diff the HTML, with the old page staged
by hand into `$OLD_DIR`. Three things killed them, and the third is the one that matters.

1. **The comparand is unreachable.** They wanted `Page_FuelSurcharge.html` / `Page_RmxFuel.html`
   at `6400026` and `Page_PriceVolume.html` at `cc3adc9`. Neither commit is in this repo any
   more. The recipe in this file could not be followed by anyone who read it.
2. **The newest copy that IS reachable makes the diff a tautology.** At `cbed9df^`,
   `buildExecTables` is `return AmrFuelExec.execTables(...)` and `buildCustTable` is
   `return AmrPvSlide.custTableHtml(...)`. Staging from there compares each module against
   *itself* — a check that passes no matter what breaks.
3. **The claim had already been superseded on purpose.** Chunks 16–19 changed both fuel pages
   and chunks 22–23 changed `AmrFuelExec` and `AmrPvSlide`. "Byte-identical to the
   pre-extraction page" stopped being something anyone wanted to be true.

**The lesson that outlived them: a gate whose second side has to be assembled by hand is a
gate that stops running.** Point at a commit, never at a directory somebody fills in. That is
why `apphtml.js` is built the way it is.

## `merge.js` — the structural gate for `app.html`

Ten invariants that nothing enforces at runtime: every inline script parses, every
`<template id="tpl-X">` has exactly one `AMR.page('X')`, every `getElementById` target exists
in that page's own template, no id is declared by two pages, every §A4 rule is scoped, no
page registration leaks a global, no page shadows a runtime global, and **no §A4 rule reaches
outside its own page's markup** (check 8, `css-reach`). Plus the three Apps Script templating
traps that have each shipped once — see `README.md` §7.

Check 9, `style-blocks`, is why §B stopped losing a rule: a style element's content is text
until its closing tag, so anything that leaks in is parsed as CSS, and CSS error recovery eats
the rule after it silently. Check 10, `routes`, holds `script.gs`'s `APP_PAGES`, §D's `AMR_PAGES`
and the `§P` templates to the same ten page names — three lists in two languages that nothing
else makes agree.

`css-reach` is the one that needs explaining. It builds the real document — the shared modal
shells, the guide aside and FAB `AmrQlikGuide` appends to `<body>` at runtime, and the page
mounted in `#appRoot` — and asks each §A4 selector what it actually **matches**, rather than
what it looks like. A match outside `#appRoot` fails; a match on `#appRoot` fails unless the
selector names it, because `#appRoot` is a `<main>` and a rule meant for the mount should say
so. Two shipped bugs are why: `body[data-page="rmx"] main{}` restyled the mount, and
`body[data-page="rmx"] aside{}` reached the QlikView guide and held it open.

A selector may name its page three ways — `body[data-page="x"] …`,
`html:has(body[data-page="x"])`, and **`:where(body[data-page="x"]) …`**, which is the
specificity-neutral form and the one to use where a page block styles bare elements. See
`cssparity.js` for what the other two cost.

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

## `cssparity.js` — the merged page's CASCADE, not just its markup

`pageparity.js` proves the merged page emits the same HTML. That is not the same as proving it
**looks** the same, and the gap is a property of how the merge was done rather than bad luck.

Every page's style block was scoped by prefixing `body[data-page="x"] `. That does two things
and only one of them was intended: it narrows what the selector matches, **and it raises the
selector's specificity by one attribute selector.** The raise is invisible until a shared
§A1–§A3 rule declares the same property on the same element — then the page rule, which used
to lose, starts winning, and the DOM is byte-identical while the pixels are not.

```bash
npm install playwright
node tests/cssparity.js
CHROMIUM_PATH=/path/to/chrome node tests/cssparity.js
```

It boots `Page_Rmx.html` and `app.html`'s Ready-Mix route in **real Chromium** off the same
model, then compares the computed value of every property the §A4 Ready-Mix block declares,
for every element inside `#tablesHost` and `#extrasHost`. 10,600 values per run.

**Ready-Mix is the page that needs this**, because it is the only one whose §A4 block styles
bare elements — `table`, `th`, `td`, `thead th`, `tfoot td`, `tr.subtotal td`. Every other page
anchors on its own classes, where the same raise cannot reach a shared rule. It found 673
differing computed values on the first run: `.rtbl`, which is §A3's and had always governed
these tables, was losing to the scoped page rules. Headers rendered at 10.5px instead of 13px,
cells at 8/10px padding instead of 6/9px, and the grand-total row changed colour and weight.

Four things about it are deliberate:

- **The property list is derived from the §A4 block, not hard-coded**, and the run FAILS if the
  block declares a shorthand the harness cannot expand. A list that quietly stopped covering a
  new rule would be worse than no list.
- **It waits for a table rather than sleeping.** A fixed timeout that is slightly too short
  reports "no differences", which is the worst possible pass.
- **It pairs elements inside the two hosts `pageparity.js` already proves are byte-identical**,
  so pairing is safe by construction — and it re-asserts tag and count per element anyway.
- **`KNOWN` is a list of claims, not a tolerance.** Each entry says why a difference is
  deliberate, and the run fails if the difference it describes has **stopped** happening. A
  silenced check that no longer applies is how an allow-list becomes a blindfold.

The fix it drove is worth copying: scoping a page block with **`:where(body[data-page="x"])`**
instead of `body[data-page="x"]` narrows the rule without adding weight, so the specificity is
exactly what the unscoped legacy rule had. That is what "scoping a style block" was assumed to
mean all along.

## `pageswitch.js` — switching pages leaves nothing behind

Chunk 14 made the nav mount a page instead of reloading. A reload used to *be* the teardown,
so taking it away means the previous page has to be taken apart by hand — and emptying
`#appRoot` does not do that.

```bash
npm install playwright
node tests/pageswitch.js
```

It switches through every page **twice** and asserts the document comes back to the same shape
each time. Twice, because none of this shows up on the first switch: it shows up on the fifth,
as a page that has grown slow or a handler firing for a screen the user left.

What it checks, and why each one is there:

- **One page in the document.** Pages share ids on purpose — the two fuel pages are the same
  screen on different numbers — and that only holds while exactly one is mounted. Disable the
  `#appRoot` clear and this reports `syncBtn, banner, monthSel…` declared twice.
- **The `<body>` shell is unchanged.** The guide aside, its FAB, the progress screen and the
  lightbox all live *outside* `#appRoot`, which is exactly why emptying it misses them.
- **Chromium's own listener count, through CDP** — not `AMR.nav.held()`. That distinction cost
  a mutation: `held()` reports what the runtime *recorded*, so a teardown that forgets
  `removeEventListener` but still empties its own array reports zero either way. Asking the
  browser instead catches it, and quantifies it: **48 listeners leaked per lap** with removal
  disabled.
- **No uncaught errors**, attributed to the page that was mounted when they happened.

Mutation-tested three ways: stop removing listeners, stop removing body children, stop
emptying `#appRoot`. Each is caught, and each names what actually broke.

## `apphtml.js` — not a harness; the reader in front of `app.html`

The client-side twin of `scriptgs.js`, and it answers two different questions:

```js
const { module: mod, legacy, source, styleBlock, pageOf, pageCss } = require('./apphtml.js');
mod('AmrSlide')             // the §E module's script block — the code that SHIPS
styleBlock('A3')            // one style layer, by its banner
pageOf('rmx')               // one page's <template>, its registration JS, and its §A4 rules
legacy('Page_Rmx.html')     // the deleted file, out of git — the app it REPLACED
source('Shell.html')        // app.html/script.gs off disk, anything else out of git
```

`source()` is the drop-in for a harness that splices pages together and needs `include('Shell')`
to resolve: swap its one `read` helper and every check it had keeps working.

`pageCss(id)` returns a page's §A4 rules **with the page scope stripped**, because that is what
reading a legacy page's own style block used to give — leaving the scope on would mean none of
them applied in a synthetic document. Both scoping forms are recognised, `:where()` included.

`mod()` slices a §E module out of the shipped file, which is the code that runs. It used to be
backed by `modparity.js` proving that slice byte-for-byte identical to the file it came from;
that gate is gone now the modules have deliberately changed, so what a `mod()` check proves is
what it says and nothing about a deleted file.

## `rmxfixture.js` — not a harness; the Ready-Mix model both sides render

`pageparity.js` and `cssparity.js` both need Ready-Mix to render its real tables, and they need
it to render the *same* ones: cssparity's whole guarantee — any difference is a **cascade**
difference — holds only while both sides are looking at identical markup. Two copies of the
model would drift and the guarantee would quietly stop being true.

## `threefiles.js` — the project really is three files

The claim the whole merge was for: moving this application means copying `script.gs`, `app.html`
and `appsscript.json`, and everything else in the repo is scaffolding. Until this existed that
claim had never been tried — and the repo's own rule is that a deletion you have not tested is
a deletion you have not done. Chunk 13 is why: ten harnesses were repointed at `app.html`, all
ten went green, and **four failed the moment the legacy files were actually moved aside**,
because each had a read the first pass missed. *Hide before you delete.*

So it copies the three files into an empty temp directory and runs the app out of **that**:

1. `script.gs` is evaluated **whole, in one scope**, exactly as Apps Script does it — not region
   by region like the other harnesses. A section that referred to something no longer there
   stops here.
2. `doGet` is called for all twelve routes with `HtmlService` faked closely enough to prove the
   one thing that matters: **the only file it ever asks for is `app`**. The fake escapes the
   printing scriptlet, because that is what Apps Script does and it is the trap that has shipped
   twice.
3. The HTML `doGet` produced — scriptlets rendered, not the raw file — is booted in real
   Chromium **with no `google.script` present**, and the page must actually mount. If it needs
   the server to render its own chrome, it is not self-contained the way this is claiming.

```bash
node tests/threefiles.js
```

## `fuelcache.js` — the fuel pages cache the sheet, and only the sheet

Chunk 17 wired `AmrCache` into both Fuel Recovery pages. `README.md` §10 named three things the
chunk must not guess at, and each is a check here, on both pages:

| check | what it would catch |
|---|---|
| `cold` | a first visit reads the sheet once and stores exactly one entry, keyed on the month |
| `warm` | a repeat visit paints with **no** sheet read — and painted something, so a page that failed to boot cannot pass as a cache hit |
| `month-keyed` | picking another month reads the sheet; going back does not; two months means two entries |
| `typed-not-data` | typing into a cell must not change what is stored — `NUM_OV`/`TXT_OV` are the user's edits, not the sheet's data |
| `upload-not-cached` | running on an uploaded workbook writes nothing; the fixture stamps every payload with its source so this is read off the store rather than inferred |
| `version-bump` | a new data version wipes the store and re-reads |

It drives real Chromium: `localStorage`, a real boot and a real upload through a file input.
SheetJS is stubbed because what is under test is the cache, not the parser.

**One mutation is worth repeating.** "Cache the upload too" was first mutated by removing the
`!STATE.upload` guard on the write in `loadData` — and it **passed**, because the upload path
has its own success handler and never called `AmrCache.set` at all. The mutation that models
the real future mistake is *adding* a write to `runUpload`, and that fails with the store's
contents named. A mutation that does not change behaviour tells you nothing about the gate.

```bash
node tests/fuelcache.js
```

## `slidecss.js` — §B is only what a capture cannot inherit

`Deck_Styles.html` was 86 rules because the Deck Builder loaded the slide modules **without**
the report pages those modules live on, so every rule their markup needed had to be restated
under `.slide-bare`. The merge ended that: `captureBare` attaches its box to `<body>` in a
document where §A1–§A3 are already loaded. Chunk 16 cut §B to **7 rules**, and this is what
holds it there.

For each rule it builds the DOM that rule's own selector requires, in the real document with
the real stylesheet, and blanks **that one rule** under all ten `data-page` values. A rule that
changes no computed value is restating the component layer and fails the run.

Three things it had to learn, each of which would otherwise have given a wrong answer:

- **One rule at a time, not the whole block.** §B's rules masked each other — its `table.gt`
  override moves `--px`, so everything downstream looked load-bearing. Whole-block toggling
  reported 11 keepers where per-rule reported 27, and after the redundant ones went, 19 of
  those 27 turned out to be restatements as well. Deleting to a fixpoint took three passes.
- **Custom properties, set as well as unset.** A §B rule reading `var(--tpy,4px)` against a §A3
  rule reading the same var is identical at rest and identical when set. Against a §A3 rule
  with a *literal* it differs **only once the fitter sets it** — which is exactly when the deck
  captures. Every custom property a rule mentions is set to a distinctive value and read again.
- **Every page, because scoping raises specificity.** §A4 is scoped on `body[data-page]`, and a
  §B rule can be the thing beating a page rule. A rule is redundant only if it is redundant
  under all ten.

The reduction itself was proved separately and end to end — 880 specimens, every computed
property, ten pages, **784,380 values, all identical** — because a per-rule test decides what
to delete and cannot prove a *set* of deletions is safe.

Mutation-tested by adding a rule that restates §A3, which fails naming it.

```bash
node tests/slidecss.js
SLIDECSS_LIST=1 node tests/slidecss.js     # what each rule is worth
```

## `helpers.js` — the drifted helpers, pinned as they are

`toNum_`, `norm_` and `gk_` are duplicated across seven namespaces and have drifted. Chunk 15
diffed all fourteen definitions and decided they **stay** — the full reasoning is in `README.md` §7,
and the one line of it is: **neither dialect is a superset. Each is right exactly where the
other is wrong.** PV reads the text `"5%"` as `0.05` and `"(1,234)"` as `0`; the other four
read them as `5` and `-1234`. Both readings are defensible, so unifying has no safe direction,
and the change would be silent under 144 call sites.

This is a **characterisation** test, not a correctness one. It reads each definition out of
`script.gs` by namespace, runs it against a shared table of inputs, and asserts the answer is what
the suite gives today — nothing more. Change one on purpose and it fails naming the input that
moved.

It also holds three things that would otherwise be invisible: that each helper is still
**pure** (it is evaluated in a bare scope, so a copy that starts reading its namespace's state
throws rather than silently picking up a global), that the **census** is still 6 / 6 / 2 across
seven namespaces, and that `PV.gk_` still mixes `SCHEMA_` into its cache key where `PVLOOK.gk_`
does not.

Mutation-tested by performing the forbidden tidy — giving `FSC.toNum_` PV's percent rule — which
fails naming `"5%"` and `"-12.5%"`.

```bash
node tests/helpers.js
```

## `scriptgs.js` — not a harness; the region slicer the others use

Seven harnesses used to read a `.gs` file by name. They read a **region** of `script.gs` now, and
this is the one place that knows how to find one.

```js
const { region, load } = require('./scriptgs.js');
region('PV_Backend.gs')      // the merged text, minus its banner
load(ctx, 'Config.gs')       // ...evaluated into a vm context
```

**Read this before repointing anything else at `script.gs`.** Several of those harnesses assert on
*source text* — "PV takes its generation from the sheet", "no local header-is-row-1 reader is
back in `PV_Lookup`". Run against the whole merged file, those regexes pass if **any** of the
eleven sections satisfies them, so a check that used to pin one backend would start passing
because a different one happens to contain the pattern. Repointing them at the file rather than
the region would have left eight checks that could no longer fail.

`QlikSync.gs` is listed twice, because it is: the engine is §5 and its four entry points are
§11. `region('QlikSync.gs')` joins both, which is what a harness that used to read the whole
file wants.

Three of the seven have a `load()` of their own, so import it as `loadRegions`.

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

**And that `qlikSyncNow` does NOT do that.** Two manual runs over an unchanged file both
write, and write the same amount — while the trigger, on that same file, still skips it.
Somebody running the manual sync is there *because* the sheet is wrong and the file did not
move, so the trigger's optimisation must not reach them.

**Years on one side, CY/PY on the other.** The Aggregates export names years (`2025 Volume`,
`2026 Volume`) and the workbook it feeds has been re-headed to `CY Volume` / `PY Volume`.
Neither side is under this code's control and either can change again, so the fixture pairs
one against the other and checks every value lands in the column it belongs in — including
that CY and PY are not swapped, which is the failure a total would not show. The surcharge is
the same defect wearing different clothes: the export heads it `Fuel Surchage` and the
workbook `Fuel Surcharge`, one missing letter, one column that matched nothing and was never
written while every other column on the tab synced.

The other half of that rule is checked too: an export naming a year the workbook does not have
a column for yet is reported **unmatched**, not paired by rank into last year's column.

**The temp sheet.** An `.xls` export has to be converted before it can be read, and a Drive
copy takes its audience from the folder it is created in. The harness asserts the copy names a
parent of its own, that every non-owner permission is deleted and the owner's is not, that no
permission is ever *created* (the only Drive call that emails a person), and that the copy is
trashed.

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

## `tunables.js` — §C is what the pages said

The slide frame was lifted out of `AmrSlide` and the five pages' whitespace defaults out of
the pages, into `app.html`'s **§C TUNABLES**. That is a move, and this is the proof it changed
nothing on the way, by the method the merge itself used: read the BEFORE out of git.

```bash
node tests/tunables.js            # no dependencies
REF=<commit> node tests/tunables.js
```

Four things, and only the second is a comparison:

| check | what it holds |
|---|---|
| `§C evaluates with nothing but window` | §C sits above §D and §E because their IIFEs read it **while they construct**. Anything it needed from them would be a load-order bug that only appears in a browser — and only sometimes |
| every number == the page's own, at `REF` | each literal it was lifted from is asserted to still exist at that commit, so the harness's own copies cannot rot either |
| each page asks for **its own** row | a copy-pasted `'pricevolume'` in the Ready-Mix page would silently give Ready-Mix another page's slide, and nothing renders wrong enough to notice. It also fails if any page goes back to mounting sliders from a literal |
| `ws()` returns a copy | `mountControls` keeps the object it is handed and the sliders write back into it, so a shared object would let one page's dragging move another page's defaults |

**When to retire it:** the second row is the parity half and it goes the way its siblings do —
the day someone deliberately re-tunes one of these defaults, that number stops being "what the
page used to say" and the check should be deleted rather than edited to match. The other three
are invariants, not comparisons; they stay.

The values were also compared end to end in real Chromium when the move landed — all five
pages mounted byte-identical slider values before and after — but that check lives in the
session log rather than here, because it needs both trees at once.

## `yearroll.js` — a 2031 workbook reads as 2031

Every other fixture in this folder is a **2026** workbook, which is exactly why nothing here
caught the year being baked into four different data contracts: a fixture from the year the
code assumes cannot tell "reads the data" from "assumes the calendar".

```bash
node tests/yearroll.js            # no dependencies
```

So this one is from **2031**, and it runs the real code against it. **Section 1b runs the same
page again with the workbook re-headed `CY Volume` / `PY Volume`**, which is the other half of
the same property: a CY header names no year at all, so the Year column beside it is the only
thing that can date the pair, and without that the page reads as a column of zeroes under
correct headings.

| check | what would have happened without it |
|---|---|
| AGG Fuel Recovery, through `getFscData` | it summed `market\|2026\|month` buckets. A 2027 export writes 2027, every sum finds nothing, and the page publishes a **full table of zeroes** under headings naming a year that has gone — no error, no empty state |
| Ready-Mix's `yearPair_` | it asked for `'2026 vol'` by name. `col_` returns −1, `toNum_` turns the missing cell into 0, same zeroes. Also checks the two NEWEST of three years win, and that every call site hands over the data year — a call that forgets it works on a year-named workbook and reads zero on a CY/PY one |
| the QlikView sync's alias | six literal entries covering 2025 and 2026, then three patterns carrying the year across. Both are gone: aliasing is on the **base** — the name with its period removed — so one entry covers every year and both spellings of every year |
| TP01's `iYearCol` | `headers.indexOf('2026 Volume')` → −1, every Additional Revenue to Post computed off a blank cell, and the workbook still downloads. `CY Volume`, `Volume - CY` and a bare `PY` column are checked alongside the year forms |
| the Aggregates **upload** path (`uploadPvData`) | it required the exact strings `2025 Volume`, `2026 Volume`, `Fuel Surchage` and refused a good download with "Missing column(s)" the day any of them changed. Loud rather than silent, which is why it outlived the read path's fix — checked now against a year-named export, a CY/PY-headed one with the typo corrected, and a genuinely incomplete one that still has to be refused |
| every year left in `app.html` | the check that stops it coming back. Comments are stripped first (with a state machine, because this file's block comments continue on lines starting with neither `/` nor `*`), ISO dates are dropped, and what remains must be a **guide sample row** — the QlikView walkthroughs' made-up `Jan-2026 · P100 · MAT-1` lines, which illustrate the shape of an export and are meant to stay put |

Mutation-tested three ways, each caught by name: restoring FSC's literal `sum_(D, mk, 2026, …)`,
restoring TP01's `indexOf('2026 Volume')`, and letting one `2026` back into a table heading.

**This one does not retire.** It is not a comparison against a previous version of anything —
it is a property the suite has to keep, and the only harness in the folder that will still be
saying something true in 2031.
