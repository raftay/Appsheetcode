# PLAN — one `app.html`, one `app.gs`

**Status: planned. No merge code written yet.**

> ## Work on this plan happens on the `merging-files` branch. Only there.
>
> Every chunk below is a commit on `merging-files`. Do not commit merge work to `main`, and
> do not open a pull request for it — the branch is the review surface, and the cutover
> (chunk 8) is what eventually lands on `main`, as one reviewed merge.
>
> If you are a session picking this up cold: `git checkout merging-files`, read this file
> and §3 of `README.md`, then continue from the first unticked chunk in [§8](#8-the-chunks).

---

## Contents

1. [The goal, and why](#1-the-goal-and-why)
2. [The thing that would have broken it](#2-the-thing-that-would-have-broken-it)
3. [How the pages live inside one HTML file](#3-how-the-pages-live-inside-one-html-file)
4. [The shape of `app.html`](#4-the-shape-of-apphtml)
5. [The shape of `app.gs`](#5-the-shape-of-appgs)
6. [The permissions self-check](#6-the-permissions-self-check)
7. [Logging, and the debug functions it replaces](#7-logging-and-the-debug-functions-it-replaces)
8. [The chunks](#8-the-chunks)
9. [What this costs](#9-what-this-costs)
10. [Deliberately not in this merge](#10-deliberately-not-in-this-merge)
11. [Legacy hit-list](#11-legacy-hit-list)
12. [Rules for whoever does the work](#12-rules-for-whoever-does-the-work)
13. [What this plan measured](#13-what-this-plan-measured)

---

## 1. The goal, and why

The Apps Script project is **37 files** — 16 `.gs` and 21 `.html`. Every change means finding
the right file in the editor, and moving the project in or out of the script editor means
copying 37 files one at a time. The goal is:

> **one `app.html` and one `app.gs`.** Nothing else in the script project except
> `appsscript.json` and the deck template `.pptx`.

Two files means two copy-pastes to move the whole application. That is the point, and it is
worth some cost elsewhere ([§9](#9-what-this-costs)).

Secondary goals, explicitly in scope:

- **Legacy goes.** Old functions, unreferenced UI, dead includes, superseded helpers —
  removed, not carried across. Previously-deployed URLs breaking is acceptable and expected.
- **Navigable comments.** Both files get a table-of-contents banner at the top and a
  consistent section banner before each region, so `Ctrl+F` on a banner name is how you
  navigate a 20,000-line file.
- **A permissions self-check** — a function that proves every OAuth scope the app needs has
  been granted, and names the one that has not ([§6](#6-the-permissions-self-check)).

---

## 2. The thing that would have broken it

**`app.gs` cannot sit in the live script project next to the files it replaces.**

Apps Script evaluates every `.gs` file into one shared global scope. Two files both declaring
`doGet`, `include`, `getLogo` or `var APP_CONFIG` do not coexist — the last file evaluated
wins, and which one is "last" is the project's internal file order, not something the repo
controls. Dropping a complete `app.gs` into the live project would silently re-point the live
router and the live config at half-built code.

`app.html` has no such problem. HTML files are inert until something serves them, so an
`app.html` can sit in the live project indefinitely, costing nothing, as long as no route
points at it.

**That asymmetry sets the order of the whole project:**

1. Build **`app.html` first**, inside the live project, reachable only through a new
   `?page=app` route. It calls the *existing, unchanged* `.gs` backends. Every legacy page
   keeps working untouched throughout, and each ported page can be diffed against its
   original live (`?page=rmx` against `?page=app&view=rmx`).
2. Merge the `.gs` files **last**, as a single atomic cutover commit — delete all 16, add
   `app.gs` — at a point where `app.html` is already known good.

The only edit to legacy code before cutover is **one line in `Code.gs`'s `doGet`** adding the
`app` route. Deleting that line reverts it.

---

## 3. How the pages live inside one HTML file

The naive merge — concatenate the pages — breaks on three collisions. Each has a cheap fix,
and the fixes are what make this tractable.

### Duplicate element IDs

`#syncBtn`, `#market`, `#banner`, `#kpiFile` and dozens more exist on several pages. There
are ~350 `getElementById` / `querySelector` call sites across the pages and none of them
should have to change.

**Fix: only one page's markup is ever in the document.** Each page's markup lives in a
`<template id="tpl-rmx">`; on load, exactly one is cloned into `#appRoot`.

`<template>` is the right container and the reason is worth writing down: its contents are
parsed into a **separate inert document fragment**, so `document.getElementById` cannot see
them. Twenty pages of markup can sit in the file and only the mounted one is addressable.
Every call site keeps working unchanged, because at runtime the document contains one page,
exactly as it does today.

> The obvious alternative — `<script type="text/html">` — is worse here. The pages contain
> 2–7 literal `</script>` tokens each, so any markup that ever picked one up would terminate
> the block early and silently. `<template>` has no such escaping hazard.

### Duplicate JS globals

Every page declares its own top-level `state`, `fmt`, `boot`, `render`. Concatenated, they
overwrite each other.

**Fix: each page's JS becomes one IIFE** that registers itself:

```js
AMR.page('rmx', { title:'RMX — Price & Volume', libs:['html2canvas','xlsx'], boot:function(){ … } });
```

Everything the page declared at top level becomes a local inside that IIFE. **No page
variable gets renamed.** The only edits are the ~51 inline `on*="…"` handlers across all
pages, which lose access to the global scope — they become `addEventListener` calls inside
the IIFE.

### Duplicate CSS

Each page's private `<style>` block uses generic names — `.wrap`, `.rail`, `.panel`, `.card`
— with different rules per page.

**Fix: prefix every selector in a page's block with `body[data-page="rmx"]`.** `<body>`
carries `data-page` for the one mounted page, so only that page's rules can match. Prefixing
raises specificity uniformly within a block, so rule order *within* a page is preserved; and
it raises page rules above the shared stylesheet, which is the direction they already win in
today (the page block comes after the shared one in `<head>`).

**This is the fiddliest part of the merge and the one most likely to break design silently.
Three things the prefixer cannot do blind:**

| Hazard | Count | Handling |
|---|---|---|
| Selectors targeting `body`, `html` or `:root` themselves | **65**, concentrated in `Page_Overview` (26) and `Page_Rmx` (18) | by hand — a `body{…}` rule becomes `body[data-page="x"]{…}`, but a `:root{--token:…}` rule must **stay at `:root`** or the token stops resolving |
| `@media` blocks | 15 across the pages | prefix the rules *inside* the block, never the `@media` line |
| `@keyframes` | 4 (`Page_InventoryReport`, `Page_PriceVolume`, `Page_Rmx`, `Page_TP01`) | leave entirely alone — percentage selectors are not element selectors. Rename only if two pages define the same animation name with different frames |

### Navigation does not change

Today a page switch is a full page load at `?page=rmx`. That stays true: `doGet` reads
`?page=`, `app.html` mounts that one page, done. **We are not building a single-page app.**
Client-side page switching is a real follow-up ([§10](#10-deliberately-not-in-this-merge)) but
not part of this merge — doing both at once would make any regression ambiguous between "the
merge broke it" and "the new router broke it".

---

## 4. The shape of `app.html`

```
<head>
  <style>  §A  DESIGN TOKENS + SHARED COMPONENTS     (was Styles.html)          </style>
  <style>  §B  SLIDE CSS, scoped .slide-bare         (was Deck_Styles.html)     </style>
  <style>  §C  PER-PAGE BLOCKS, each scoped body[data-page="…"]                 </style>
</head>
<body data-page="<?= page ?>">
  <header class="bar" id="appBar"></header>   <!-- built from the active page's spec -->
  <main id="appRoot"></main>                  <!-- the one mounted page -->

  <script>  §D  SHARED RUNTIME
              AmrLib        lazy CDN loader — Chart.js / html2canvas / SheetJS   (new)
              AmrCache      device report cache              (was Shell.html)
              AmrProgress   the progress pill                (was Shell.html)
              AmrBoot       the one loading screen           (was Shell.html)
              AmrHelp / AmrSettings  the two modals          (was Shell.html)
              AmrQlikGuide  the QlikView guide aside         (was 7 copies — see below)
              AMR.page()    the page registry + mount        (new)
  </script>
  <script>  §E  SHARED MODULES
              AmrCube  AmrKpi  AmrSlide  AmrDeckSource
              AmrFuelExec  AmrPvSlide  AmrSegSlide  AmrRmxSlide
  </script>

  <template id="tpl-landing">   … markup …   </template>
  <script>  AMR.page('landing', { … }); </script>
  …one pair per page…

  <script>  AMR.start();  </script>
</body>
```

### The QlikView guide is the first real win

The floating "Download from QlikView" aside is copy-pasted into **seven** pages —
`Landing`, `Page_PriceVolume`, `Page_Rmx`, `Page_Segment`, `Page_FuelSurcharge`,
`Page_RmxFuel`, `Page_TP01`. Measured across their style and script blocks: **817 lines**,
differing only in the step text and screenshot IDs (the CSS copies differ by two lines of
dead `.wrap` / `.shell` margin drift). It becomes one `AmrQlikGuide.mount(steps)` of about 95
lines and each page passes its own array — **roughly 720 lines deleted for no behaviour
change.**

### `AmrLib` — lazy CDN loading

No page needs all three libraries, and two need none:

| Page | Chart.js | html2canvas | SheetJS |
|---|:--:|:--:|:--:|
| `pricevolume` | ● | ● | ● |
| `deckbuilder` | ● | ● | |
| `overview` | ● | | ● |
| `rmx`, `segment`, `fuelsurcharge`, `rmxfuel` | | ● | ● |
| `tp01` | | | ● |
| *landing*, `inventoryreport` | | | |

Each page declares `libs:[…]` in its registration and `AmrLib.need()` injects what is missing
before `boot()`. The Landing page and Inventory Report end up **faster than they are today**.

---

## 5. The shape of `app.gs`

The `.gs` merge is far less risky than it looks, and this is worth knowing before starting:
**almost everything is already namespaced.** Twelve of the sixteen files are a single
`var NS = (function(){ … })()`, and the function declarations inside them sit at column 0
only because the files do not indent IIFE bodies. A grep for `^function` reports 21 apparent
collisions; scope-aware inspection shows nearly all are IIFE-internal (`PV`'s `getReport` and
`RMX`'s `getReport` never shared a scope), and the codebase already knows about the real
ones — `RMX_Backend.gs` carries the comment *"NOT named `getCrossReport`: that top-level name
already belongs to PV."*

So the merge is close to ordered concatenation. Two rules make it safe:

1. **`APP_CONFIG` goes first.** IIFEs execute at evaluation time, so anything reading config
   while constructing itself must come after it. Today every read is inside a function, so
   nothing depends on this — putting config first means nothing ever has to.
2. **The collision audit is scope-aware, not a grep.** Before merging, list genuinely
   top-level declarations only; merge once that list has no duplicates. Shared private
   helpers duplicated across namespaces (`toNum_`, `norm_`, `gk_`) **stay inside their own
   IIFEs** — do not hoist them into one shared helper as part of this merge. They have
   drifted apart, and unifying them is a behaviour change wearing a cleanup's clothes.

Section order:

```
§1  CONFIG            APP_CONFIG, APP_EXTRA_SOURCES, Settings API          (Config.gs)
§2  LOGGING           APP_log() + LOG_LEVEL                                (new — §7)
§3  ROUTER + PLUMBING doGet, include, getLogo, data-generation, cache       (Code.gs)
§4  PERMISSIONS       APP_verifyPermissions()                              (new — §6)
§5  SYNC              QlikSync.gs
§6  AGG               PV_Backend, PV_Lookup, FSC_Backend, Sask_Backend
§7  RMX               RMX_Backend, RMX_Suggest, RFSC_Backend
§8  OVERVIEW          Ov_Backend
§9  DECK              Deck_Backend, Deck_Recipe
§10 SMALL PAGES       Kpi_Backend, TP01_Backend, IR_Backend
§11 TRIGGERS          the scheduled trigger entry points
```

---

## 6. The permissions self-check

`app.gs` gains `APP_verifyPermissions()` — run it from the editor after pasting the file in,
and it reports one line per service.

It has two jobs, and they are different problems:

- **Force the scopes to be requested.** Apps Script decides which OAuth scopes to ask for by
  *statically scanning the code* for service references. A service reached only down a rare
  branch can end up in the manifest or not, depending on how the scan reads it. This function
  references every service the suite uses, so the scan cannot miss one. It is belt-and-braces
  alongside an explicit `oauthScopes` array in `appsscript.json` — the reliable mechanism, and
  one this project does not currently have committed at all.
- **Prove each one actually works**, with a harmless read, returning a per-service verdict
  rather than dying on the first failure — so one missing grant cannot hide the other six.

Services to cover, from an audit of the current `.gs` files:

| Service | Used for |
|---|---|
| `SpreadsheetApp` | every page's data |
| `DriveApp` | KPI workbook folder, QlikView export folders, inventory PDF, source modified-times |
| `MailApp` / `GmailApp` | TP01 only |
| `SlidesApp` | Deck Builder |
| `UrlFetchApp` | the logo |
| `CacheService` · `PropertiesService` | caching and settings |
| `ScriptApp` | deployment URL, scheduled triggers |
| `LockService` · `Session` | sync locking, timezone |

The Gmail scope is requested from everyone on the main deployment, not only TP01 users. That
is already true today — it is one script project — and the merge does not change it.

---

## 7. Logging, and the debug functions it replaces

### Every function written for the merge gets a log line

Both files get one logging helper, and every function written or rewritten during the merge
uses it. Today there is no convention at all: 20 `Logger.log` calls, 15 `console.log`, 9
`console.error`, all hand-concatenated strings, no levels, no timings, no way to turn any of
it down.

```js
APP_log(level, where, msg, data)   // app.gs   — 'debug' | 'info' | 'warn' | 'error'
AMR.log (level, where, msg, data)  // app.html — same signature, same output shape
```

One helper means one place to change the format, one place to add a timestamp, and **one
switch to turn the noise down** — a `LOG_LEVEL` in `APP_CONFIG` for the server and a
`localStorage` key for the browser, so a quiet production default does not mean editing
call sites when something needs investigating.

**What a line carries.** Enough to answer "what was asked, what came back, how long, and did
it come from cache" without adding a second log line:

| Field | Why |
|---|---|
| `where` | `RMX.getKeys`, `DECK.addSlide` — the function, not the file |
| the arguments that select data | market, period, month, page. Not whole payloads |
| the size of the answer | rows, or bytes for anything cached |
| elapsed ms | the only field that catches a regression nobody reported |
| cache `hit` / `miss` / `skip` | see below |

**Log at entry points and phase boundaries. Never inside a per-row loop.** The Ready-Mix
bundle is 40,000 rows; a log line per row would cost more than the work it describes and
would bury the line that matters. One line when a server entry point is called, one when it
answers, one per expensive phase inside it — that is the whole budget.

**The cache field is the one that earns its place.** §6 of the README records the most
expensive mistake in the suite's history: every RMX entry point opened by pulling a 14 MB
bundle through `CacheService` to produce a 72 KB answer, and it hid for a long time because
nothing about it looked wrong. A log line carrying elapsed ms and bytes-read would have shown
a flat 15–24 s against a varying question on the first read of the transcript. Every cache
read written during the merge logs which of `hit` / `miss` / `skip` it was — `skip` included,
because `APP_cachePut_` silently bails above its chunk ceiling and a silent bail is
indistinguishable from a cache that is simply never warm.

**Errors log the context, not just the message.** Every `catch` writes `where` plus the
selecting arguments. Half the current `catch` blocks swallow silently — `catch (e) {}` — which
is right for an optional cache read and wrong for anything else; the merge does not carry the
silent ones across without deciding which they are.

### The debug functions go

Six of them, ~148 lines, and **not one has a caller** — each is referenced only by its own
declaration and, for two, a top-level wrapper that is itself uncalled:

| Function | Lines | |
|---|---|---|
| `DECK_smokeTest` | 45 | `Deck_Backend.gs` |
| `RMX_debugMonths` | 46 | `RMX_Backend.gs` |
| `debugNaOthers` + `RMX_debugNaOthers` | 34 | writes a CSV to Drive |
| `debugUnclassified` + `RMX_debugUnclassified` | 23 | |

They are editor-run diagnostics from specific past investigations, kept in case they are
wanted again. That is exactly what the logging above replaces: a diagnostic you have to
remember exists, paste a market key into and run by hand is worse than a line that was
already written when the thing happened.

**Delete all six in chunk 8** — but two need a check first, not an assumption:

- `debugUnclassified` lists materials missing from `PRODUCT MASTER`. `RMX_Suggest.gs` and the
  page's Mapping check appear to cover this, and better. Confirm before deleting; if it turns
  out to be the only way to get the full list, it is a **feature that needs a button**, not a
  debug function to preserve.
- `debugNaOthers` writes a CSV to Drive, so it is part of why the project holds a Drive scope.
  Removing it does not remove the scope (Drive is needed for much more), but check the
  `APP_verifyPermissions()` list stays accurate after it goes.

Nothing else is deleted under this heading. A diagnostic with a real caller, or one the
Deck Builder's ✓ *Check template* button runs, stays.

---

## 8. The chunks

Each chunk is one reviewable commit on `merging-files`, ends with the app in a working state,
and can be stopped at. Chunks 2–6 are independent of each other: if one turns out to be a
swamp, the others still land.

| # | Chunk | What lands | Review by | |
|---|---|---|---|---|
| 0 | **Plan** | This file. No code. | reading it | ✅ |
| 1 | **Foundations + audit** | `app.html` skeleton: §A–§E, the page registry, `AmrLib`, `AMR.log` ([§7](#7-logging-and-the-debug-functions-it-replaces)), the deduped `AmrQlikGuide`. Landing + Inventory Report ported. One line added to `Code.gs` for the `?page=app` route. Plus the scope-aware `.gs` collision list, written into this file. | `?page=app` shows the landing page and the Inventory Report, identical to `?page=` and `?page=inventoryreport` | ☐ |
| 2 | **Fuel pair** | `Page_FuelSurcharge` + `Page_RmxFuel` + `Deck_Fuel`. Deliberately first: `tests/regress.js` already proves these two byte-identical, so the porting method gets validated where there is a real gate on it. | `tests/regress.js` green + both pages side by side | ☐ |
| 3 | **AGG Price & Volume** | `Page_PriceVolume` + `Deck_PV` + `SlideExport` + `KpiShared` + `Cube`. The heaviest shared-module load, and the only page needing all three libraries. | `tests/pvcheck.js`, `tests/pvlookup.js`, `tests/slidefit.js` + the page | ☐ |
| 4 | **RMX pair** | `Page_Rmx` + `Page_Segment` + `Deck_RMX` + `Deck_SEG`. Drop `Page_Rmx`'s dead `include('Deck_RMX')` here — see [§11](#11-legacy-hit-list). | `tests/rmxcost.js`, `tests/segboot.js` + both pages | ☐ |
| 5 | **Overview** | `Page_Overview` alone — 6,022 lines, a quarter of all the client code, and 26 of the 65 CSS scoping hazards. Nothing else in this chunk. | `tests/ovperiod.js`, `tests/freshness.js` + the page | ☐ |
| 6 | **Deck Builder + TP01** | `Page_DeckBuilder` + `Deck_Sources` + `Deck_Styles`, and `Page_TP01`. TP01 is served from the second, execute-as-user deployment — that deployment must be re-pointed too. | `tests/deckpath.js`, `tests/deckstatic.js`, `tests/bgrender.js` + a real deck build | ☐ |
| 7 | **`app.gs`** | All 16 `.gs` merged, sectioned and commented. `APP_log()` and `APP_verifyPermissions()`. `appsscript.json` with explicit `oauthScopes`. Old `.gs` deleted **in this same commit** — they cannot coexist ([§2](#2-the-thing-that-would-have-broken-it)). | `tests/configcheck.js`, `tests/qliksync.js`, `node --check`, then `APP_verifyPermissions()` in the editor | ☐ |
| 8 | **Cutover + sweep** | `doGet` serves `app.html` for every route; the `?page=app` scaffold goes; all old `.html` deleted; legacy hit-list executed; the six debug functions deleted ([§7](#7-logging-and-the-debug-functions-it-replaces)); `README.md` rewritten around two files. | the whole suite, every route | ☐ |

---

## 9. What this costs

Stated up front so nobody is surprised later:

- **`app.html` will be ~1.0 MB** (1.13 MB of HTML today, less the ~720 lines of guide
  duplication and whatever the legacy sweep takes). **`app.gs` ~515 KB.** Both are far inside
  Apps Script's limits, but the script editor gets sluggish on files this size. That is the
  trade being made deliberately: slower to edit in the browser, trivial to move.
- **Every page load ships every page.** Today `?page=rmx` sends 96 KB; afterwards it sends the
  whole file. HtmlService gzips, so expect roughly 200 KB on the wire against ~25 KB now. The
  extra is markup the browser parses into inert fragments and CSS it discards on a `data-page`
  mismatch — not extra JS to run, since each page's code is one registration IIFE that only
  executes its body on mount. [§10](#10-deliberately-not-in-this-merge) removes this cost
  entirely if it ever stops being acceptable.
- **Two pages get faster.** Landing and the Inventory Report load no CDN libraries at all once
  `AmrLib` is lazy.

---

## 10. Deliberately not in this merge

- **Client-side page switching.** Once every page is in one file, switching without a reload
  is nearly free and would make the suite feel much faster. Separate change: it alters
  navigation behaviour, and doing it here would make any regression ambiguous.
- **Unifying the duplicated private helpers** (`toNum_`, `norm_`, `gk_`) across namespaces.
  They have drifted; unifying them changes behaviour. Separate change, with its own evidence.
- **Collapsing `Deck_Styles` into the page blocks.** The mirror exists because the deck
  includes the slide *builders* without the *pages*. Once everything is one file that reason
  weakens — but the rules are `.slide-bare`-scoped and correct today, so they come across
  as-is in chunk 6 and any dedup is proven separately, against real captures.

---

## 11. Legacy hit-list

**Confirmed — remove when its chunk lands:**

- **`Page_Rmx.html`'s `include('Deck_RMX')`** *(chunk 4)*. The page calls nothing in
  `AmrRmxSlide`, and `Deck_RMX`'s only load-time side effect is registering the `rmx` adapter,
  which early-returns without `AmrDeckSource` — a file `Page_Rmx` does not include. 603 lines
  shipped on every Ready-Mix page load to do nothing. The module itself stays; the Deck
  Builder needs it.
- **The seven copies of the QlikView guide** *(chunk 1)*. ~720 lines.

**To audit before chunk 1 ends — audit, do not assume:**

- The `SB` reader / `getSlideData` / `syncSlideData` in `Code.gs`. The Segment page no longer
  reads those tabs; confirm the Overview still does before touching them.
- The CUSTOM FLAG LOOKUP path in `RMX_Suggest.gs`. `Page_Segment.html` states in its own help
  text that neither Extras table groups on it any more.
- The `RMX_Backend.gs` "legacy names" wrappers — `getMarkets`, `getKeys`, `getExtras`,
  `syncData`, `uploadRmxData`. Find each caller.
- The dead nav hook in `Shell.html`, which says in a comment that it is dead.
- The `EXECUTIVE OVERVIEW — canonical market list + PV/RMX name mapping` block in
  `Config.gs`, whose own banner comment starts `NOT USED`. Confirm nothing reads it.

**Not a deletion, a warning:** there is no `AmrQlik` and no ⇣ *Pull from QlikView* button
anywhere in the client, though older docs described both. `QlikSync.gs` is reached by
scheduled trigger only, and its four entry points (`qlikSyncCheck`, `qlikMarkCurrent`,
`qlikStamps`, `qlikSyncNow`) have no client caller. Do not "restore" it during the merge — if
a Pull button is wanted, that is a feature, not a repair.

---

## 12. Rules for whoever does the work

- **Branch.** `merging-files`, only. One commit per chunk, so any chunk can be reviewed or
  reverted on its own.
- **Nothing is deleted on a hunch.** Every removal needs a repo-wide grep proving zero live
  references, and gets logged in the `README.md` session log with what proved it. "Looks
  unused" is not evidence.
- **Do not flip a file's line endings.** The repo is mixed — most `.html` are CRLF, some `.gs`
  are LF. `app.html` and `app.gs` are written fresh, so pick **LF** for both and keep it.
  Scripted edits to existing files must open with `newline=''` and write back what was there.
- **Every function you write or rewrite logs.** `APP_log` / `AMR.log`, at entry points and
  phase boundaries only, never inside a per-row loop, always with elapsed ms and the cache
  verdict on anything that reads a cache. See [§7](#7-logging-and-the-debug-functions-it-replaces).
- **Do not carry a `catch (e) {}` across without deciding what it is.** Silent is right for an
  optional cache read and wrong for everything else.
- **Comment as you merge, not after.** Every section gets its banner and its "why" note while
  the context is fresh. A 20,000-line file with no signposts is worse than 37 files.
- **Run the harnesses in `tests/` before and after each chunk.** They are the only proof
  available off-platform that a page still renders what it rendered. Two more are worth adding
  in chunk 1:
  - `tests/merge.js` — every id a page's JS references exists in that page's `<template>`;
    every page CSS block is scoped; no page IIFE leaks a global.
  - `tests/pageparity.js` — old page against new page under jsdom with `google.script.run`
    stubbed, DOM diffed. The same pattern `tests/regress.js` already uses.
- **Nothing in `tests/` is uploaded to Apps Script.** It is not part of the two-file project.

---

## 13. What this plan measured

Every number above was measured against the code on 2026-08-17, not recalled.

| Claim | How it was checked |
|---|---|
| 37 script-project files; ~1.13 MB HTML, ~527 KB `.gs` | `git ls-files` and `wc -c` |
| The guide is duplicated across 7 pages, 817 lines | style/script blocks containing `qlikGuide` extracted and counted; copies diffed pairwise |
| ~350 `getElementById` / `querySelector` call sites | counted per page |
| ~51 inline `on*=` handlers | counted per page |
| 65 `body` / `html` / `:root` selectors, 15 `@media`, 4 `@keyframes` | counted per page style block |
| Pages carry 2–7 literal `</script>` tokens | counted — this is why `<template>`, not `<script type="text/html">` |
| Which CDN libraries each page loads | the `<script src>` tags read per page |
| The `.gs` "collisions" are nearly all IIFE-internal | each `^function` hit traced to its enclosing scope |
| Every `include('X')` resolves to a real file | all 11 partial names checked against the file list |
| `Page_Rmx` never calls `AmrRmxSlide` | grepped both directions |
| `AmrQlik` does not exist; QlikSync has no client caller | grepped every `.html` for the object, the ⇣ button, and all four entry points |
| Routes match the README's table | `doGet`'s nine `page === '…'` branches listed and compared |
| No `appsscript.json` is committed | `ls` |
| 6 debug functions, ~148 lines, none with a caller | each name grepped across every `.gs` and `.html`; brace-matched to measure |
| Logging today: 20 `Logger.log`, 15 `console.log`, 9 `console.error`, no convention | counted per file |
