# PLAN — one `app.html`, one `app.gs`

**Status: planned. No merge code written yet.**

> ## Read this file before doing anything. Every session, every agent.
>
> Several agents work on this repo, from different accounts, with no shared memory between
> them. This file is the only thing they have in common — so it is read at the **start** of
> every session and updated at the **end** of every session that changed anything.
>
> **Start of session, in order:**
> 1. `git checkout merging-files` — all merge work happens here, and nowhere else.
>    `git pull` first; another agent may have moved it since your last look.
> 2. Read this file end to end. Not just your chunk — the [rules](#12-rules-for-whoever-does-the-work)
>    and the [legacy hit-list](#11-legacy-hit-list) are what stop two agents undoing each other.
> 3. Read §3 of `README.md` for the file map, and §7 for the domain rules. Those numbers are
>    load-bearing; do not re-derive them from the code on a hunch.
> 4. Take the **first unticked chunk** in [§8](#8-the-chunks). If it is already in progress,
>    the note beside it says who and since when — pick the next one instead.
>
> **End of session, whether or not you finished:**
> 1. Tick the chunk, or leave a one-line note beside it saying where it actually stands.
>    A half-done chunk with no note is the single most expensive thing you can leave behind.
> 2. Anything you learned that the next agent would otherwise rediscover goes in this file —
>    not in a commit message, which nobody reads before starting.
> 3. Commit and push to `merging-files`. Never to `main`, and never open a pull request for
>    it — the branch is the review surface, and the cutover (chunk 8) is what eventually
>    lands on `main` as one reviewed merge.
>
> **Do not trust your own memory of this repo.** If a session tells you something here is
> wrong, check it against the code and then fix this file. Four separate rounds of that have
> already happened; every one found something real.

---

## Contents

1. [The goal, and why](#1-the-goal-and-why)
1a. [Chunk 1 results — the three audits](#1a-chunk-1-results--the-three-audits)
2. [The thing that would have broken it](#2-the-thing-that-would-have-broken-it)
3. [How the pages live inside one HTML file](#3-how-the-pages-live-inside-one-html-file)
4. [The shape of `app.html`](#4-the-shape-of-apphtml)
5. [The shape of `app.gs`](#5-the-shape-of-appgs)
6. [The permissions self-check](#6-the-permissions-self-check)
7. [Logging, and the debug functions it replaces](#7-logging-and-the-debug-functions-it-replaces)
8. [The chunks](#8-the-chunks)
9. [What this costs](#9-what-this-costs)
10. [Three things this merge does not touch](#10-three-things-this-merge-does-not-touch)
11. [Legacy hit-list](#11-legacy-hit-list)
12. [Rules for whoever does the work](#12-rules-for-whoever-does-the-work)
13. [What this plan measured](#13-what-this-plan-measured)

---

## 1. The goal, and why

The Apps Script project is **37 files** — 16 `.gs` and 21 `.html`. Every change means finding
the right file in the editor, and moving the project in or out of the script editor means
copying 37 files one at a time. The goal is:

> **one `app.html` and one `app.gs`,** plus `appsscript.json`. Nothing else.

An Apps Script project holds only `.gs`, `.html` and `appsscript.json` — so `appsscript.json`
is the one unavoidable third file. It is now committed, and it is **not** disposable: it pins
the timezone, the V8 runtime and `executeAs: USER_DEPLOYING`. Chunk 7 adds `oauthScopes` to it;
nothing in the merge may quietly change the rest. The deck template
is a **Google Slides file in Drive**, addressed by `DECK_CONFIG.TEMPLATE_ID`; it was never a
project file.

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

## 1a. Chunk 1 results — the three audits

Run 2026-08-17 with a scope-aware analyser (comments and string/template literals blanked
before counting braces, so a `{` inside a string cannot fake a nesting level). **127 top-level
functions across the 16 `.gs` files.**

### Audit 1 — top-level collisions: **none**

Zero. Not one name is declared twice at genuine top level across all sixteen files. The 21
"collisions" a plain grep reports are all IIFE-internal — `PV`'s `getReport` and `RMX`'s
`getReport` are private to their own namespaces and never shared a scope.

**What this means for chunk 12:** the `.gs` merge really is ordered concatenation. No renaming,
no reconciliation, no shadowing to unpick. The `APP_CONFIG`-first rule still applies as
cheap insurance, but nothing currently depends on it.

### Audit 2 — top-level functions with no reference anywhere: **7 of 127**

Each one run through [§11](#11-legacy-hit-list)'s proof rule rather than deleted on the count:

| Function | Verdict |
|---|---|
| `doGet` (`Code.gs:39`) | **Keep** — Apps Script itself is the caller |
| `clearRetiredOverrides` (`Config.gs:545`) | **Keep** — its own comment says "run from the Apps Script editor", and it is idempotent. Editor tool, not dead code |
| `DECK_status` (`Deck_Backend.gs:700`) | **Keep for now** — one of the six documented `DECK_*` wrappers. The deck has never been run end to end, so a real build in chunk 10 is what proves whether the Publish stage needs it. Do not delete before that |
| `DECK_smokeTest` (`Deck_Backend.gs:718`) | **Delete** in chunk 12 — already on the debug list |
| `CUBE_historyStatus` (`Ov_Backend.gs:1430`) | **Candidate** — history-cube status readout, no caller, no comment claiming editor use. Decide in chunk 12 with the diagnostics |
| `getSaskRatesStatus` (`Sask_Backend.gs:241`) | **Candidate, and a finding.** Its comment says it exists "so the Settings screen can check the sheet without loading a whole page" — but no `.html` calls it. Either the Settings screen lost that feature or it was never wired. Decide whether to wire it or drop it; do not silently delete a documented integration |
| `syncSlideData` (`Code.gs:408`) | **Candidate** — part of the `SB` reader path already flagged for audit |

Note what did *not* appear: `qlikSyncCheck`, `qlikMarkCurrent`, `qlikStamps` and `qlikSyncNow`
all reference each other inside `QlikSync.gs`, so they never looked callerless. The proof rule
would have caught them anyway.

### Audit 3 — `#id` selectors carrying style: **132 rules, in two pages**

| Rules | File |
|---|---|
| 70 | `Page_Rmx.html` |
| 54 | `Page_PriceVolume.html` |
| 6 | `Page_Segment.html` |
| 1 each | `Page_FuelSurcharge.html`, `Page_RmxFuel.html` |

**This is much better news than [§3](#3-how-the-pages-live-inside-one-html-file) assumed.**
The id-styling problem is not spread across the suite — it is two pages, and the other twelve
files carry eight rules between them. So the id→class conversion is essentially the whole of
chunks 5 and 6 and almost nothing anywhere else, and chunks 2–4 can establish the component
layer without fighting it.

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

### The CSS is rebuilt, not copied

This is the one part of the merge that is **not** a move. Copy-pasting fourteen `<style>`
blocks into one file and scoping each with `body[data-page="x"]` would work, and it would
preserve today's rendering exactly — but it would also carry every ad-hoc decision across and
make the result harder to change than what we started with. Measured across the 1,929 lines
of CSS in those blocks:

| | Today | Target |
|---|---|---|
| Breakpoints | **9 distinct**, seven of them near-duplicate narrow widths: 760, 820, 860, 900, 980, 1080, 1180 px | **three named steps**, every stray mapped onto the nearest |
| Spinners | **three** — `spin` (defined twice), `irspin`, `amrload` | one keyframe, one class |
| Selectors defined in 3+ separate blocks | **27** — `.shell` ×5, `.seg` + `.seg button` ×5, `.previewCard` ×4, `.empty` ×4, `.dzstat` ×3, plus the guide's 16 | one definition each, in the component layer |
| `#id` selectors carrying style | **124** | zero — ids are JS hooks, classes carry appearance |

That last row is the reason the other three exist. Styling by id makes a rule
unshareable by construction: `#tablesHost .card` cannot be reused by a page that calls its
host something else, so the next page writes its own copy, and the copies drift. Every
duplicate selector and every stray breakpoint in this table grew out of that.

**So the stylesheet is built in layers, and page CSS is what is left after the layers take
what belongs to them:**

```
§A1  TOKENS       :root — colour, type scale, spacing, radius, shadow, the 3 breakpoints
§A2  BASE         reset, typography, form controls, focus states
§A3  COMPONENTS   .bar .shell .rail .panel .card .seg .chips .empty .dzstat
                  .previewCard .qlikGuide … — every block used by more than one page
§A4  PAGE         only what is genuinely unique to one page, scoped body[data-page="x"]
§B   SLIDE        .slide-bare — the capture styles (was Deck_Styles.html)
```

**Rules while porting each page:**

- **A rule that a second page would want goes to §A3, not §A4.** The test is not "does another
  page use it today" — it is "would another page's version of this be the same". `.seg` was
  written five times because nobody promoted it the first time.
- **Ids stop carrying style.** As each page is ported, its `#id` rules become classes. The id
  stays on the element for `getElementById`; the appearance moves to a class. This is what
  makes §A3 possible at all, and it is done page by page, not in one sweep.
- **No raw values.** Every colour, radius, shadow and font step comes from a token. A hex code
  in §A3 or §A4 is a token that has not been created yet.
- **Three breakpoints, named.** Every `@media` maps onto one of them. A page needing a fourth
  needs a reason written next to it.

### What this costs, and how it is checked

Being straight about it: **mechanical scoping was provably safe and this is not.** A designed
stylesheet will change some pixels somewhere — that is what consolidating seven breakpoints
into three means. The earlier instruction still stands (do not break the design), so the
verification has to be stronger than the diffing that covers the JS:

- **`tests/visual.js`** — screenshot every page at each of the three breakpoints, before and
  after, and diff the images. `tests/slidefit.js` already drives real Chromium through
  Playwright, so the harness and the browser are here; this is a new script, not new
  infrastructure. **Any page whose port cannot be screenshot-diffed gets scoped mechanically
  instead** and is revisited later. The rebuild is not worth an unverified change.
- **A computed-style diff** for the cases a screenshot cannot separate — hover, focus and
  `:disabled` states, which never appear in a static capture.

**Order matters:** §A1 and §A2 land in chunk 1, and §A3 grows as each page chunk contributes
its components. The last page ported should be adding almost nothing to §A3 — if it is still
adding a lot, the promotion test above is not being applied.

### Navigation does not change

Today a page switch is a full page load at `?page=rmx`. That stays true: `doGet` reads
`?page=`, `app.html` mounts that one page, done. **We are not building a single-page app.**
Client-side page switching is a real follow-up ([§10](#10-three-things-this-merge-does-not-touch)) but
not part of this merge — doing both at once would make any regression ambiguous between "the
merge broke it" and "the new router broke it".

---

## 4. The shape of `app.html`

```
<head>
  <style>  §A1 TOKENS      :root — colour, type, spacing, the 3 breakpoints      </style>
  <style>  §A2 BASE        reset, typography, form controls, focus              </style>
  <style>  §A3 COMPONENTS  every block used by more than one page  (see §3)     </style>
  <style>  §A4 PAGE        only what is unique, scoped body[data-page="…"]      </style>
  <style>  §B  SLIDE       .slide-bare capture styles   (was Deck_Styles.html)  </style>
</head>
<body data-page="<?= page ?>">
  <main id="appRoot"></main>                  <!-- the one mounted page -->
  …the shared modal shells, outside #appRoot so they survive a page swap…

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

  <template id="tpl-landing">   … markup, including this page's own header …   </template>
  <script>  AMR.page('landing', { … }); </script>
  …one pair per page…

  <script>  AMR.start();  </script>
</body>
```

> **Corrected in chunk 2:** an earlier draft had a single shared
> `<header class="bar" id="appBar">` built from each page's spec. That cannot work —
> the landing page deliberately has **no** header bar (its navy hero *is* the header),
> so one shared bar could not serve both without special-casing it back out again.
> Each page template carries its own header instead, which also keeps the markup
> diffable against the page it came from.

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

The Gmail scope is requested from every user, not only TP01 users — it is one script project,
already true today, and the merge does not change it. What the merge must not change either is
`appsscript.json`'s `"executeAs": "USER_DEPLOYING"`: TP01 mail is sent by the deployer, and
`getUserProperties()` therefore resolves to the deployer for everyone (see README §1).
`APP_verifyPermissions()` should report the effective user so a wrong deployment setting is
visible in one line rather than inferred from whose name is on an email.

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

Fifteen commits on `merging-files`. Each one ends with the app in a working state and can be
stopped at. **Take the first unticked chunk.** If a chunk carries a note saying someone is
mid-way through it, take the next one instead.

Chunks 3–9 are independent of each other — a swamp in one does not block the rest.

### Foundations

| # | Chunk | What lands | Review by | |
|---|---|---|---|---|
| 0 | **Plan** | This file. No code. | reading it | ✅ |
| 1 | **The audits** | No app code. Results in [§1a](#1a-chunk-1-results--the-three-audits): **zero** top-level `.gs` collisions, 7 of 127 functions callerless (5 keep, 2 candidates + 1 finding), and 132 id-style rules concentrated in just two pages. | the lists themselves | ✅ |
| 2 | **Skeleton + first two pages** | `app.html`: §A1 tokens, §A2 base, §A3 components, §A4 page CSS, §D runtime (`AMR.log`, `AMR.lib`, nav, modals, `AmrHint`, `AmrQlikGuide`, the registry). Landing + Inventory Report ported. `Code.gs` gains the `?page=app` route and reads `&view=`. Plus `tests/merge.js`. | `node tests/merge.js` green; then `?page=app` against `?page=`, and `?page=app&view=inventoryreport` against `?page=inventoryreport` | ✅ |

### The pages

| # | Chunk | What lands | Review by | |
|---|---|---|---|---|
| 3 | **AGG Fuel Recovery** | `Page_FuelSurcharge` + `Deck_Fuel`. First real port, chosen because `tests/regress.js` already proves this page byte-identical — the method gets validated where there is a gate on it. | `tests/regress.js` + the page | ☐ |
| 4 | **RMX Fuel Recovery** | `Page_RmxFuel`, reusing the `AmrFuelExec` and components chunk 3 promoted. Should be visibly smaller than chunk 3; if it is not, the promotion test is not being applied. | `tests/regress.js` + the page | ☐ |
| 5 | **AGG Price & Volume** | `Page_PriceVolume` + `Deck_PV` + `SlideExport` + `KpiShared` + `Cube`. The heaviest module load and the only page needing all three libraries. | `tests/pvcheck.js`, `tests/pvlookup.js`, `tests/slidefit.js` | ☐ |
| 6 | **Ready-Mix** | `Page_Rmx` + `Deck_RMX`. Drop the dead `include('Deck_RMX')` here. | `tests/rmxcost.js` + the page | ☐ |
| 7 | **Product Segment** | `Page_Segment` + `Deck_SEG`. | `tests/segboot.js`, `tests/deckstatic.js` | ☐ |
| 8 | **Overview, part 1 — shell and cube** | `Page_Overview`'s markup, its CSS (26 of the 65 `:root`/`body` hazards live here), the period model (`STATE`, `PICK_SERVER`, `windowPeriod`) and the `AmrCube` wiring. No panel painters yet. | `tests/ovperiod.js` + the page's four period buttons | ☐ |
| 9 | **Overview, part 2 — the panels** | The painters, the fifteen chart registries, `hidePanel` / `resetPanels` / `pcatFits`. Split from chunk 8 because 6,022 lines is a quarter of all client code and reviewing it in one commit is not reviewing it. | `tests/freshness.js` + every panel, all four periods | ☐ |
| 10 | **Deck Builder** | `Page_DeckBuilder` + `Deck_Sources` + `Deck_Styles`. | `tests/deckpath.js`, `tests/bgrender.js` + a real deck build | ☐ |
| 11 | **TP01** | `Page_TP01`. Mail sends as the deploying account. | a real send to a test recipient | ☐ |

### The server, and the cutover

| # | Chunk | What lands | Review by | |
|---|---|---|---|---|
| 12 | **`app.gs`** | All 16 `.gs` merged in the [§5](#5-the-shape-of-appgs) order, sectioned and commented. `APP_log()`, `APP_verifyPermissions()`, `oauthScopes` added to `appsscript.json`. The six debug functions deleted and `qlikStamps` decided. Old `.gs` deleted **in this same commit** — they cannot coexist ([§2](#2-the-thing-that-would-have-broken-it)). | `tests/configcheck.js`, `tests/qliksync.js`, `node --check`, then `APP_verifyPermissions()` in the editor | ☐ |
| 13 | **Cutover** | `doGet` serves `app.html` for every route; the `?page=app` scaffold goes; all old `.html` deleted; `README.md` and `CLAUDE.md` rewritten around two files. | the whole suite, every route | ☐ |

### After the merge is proven — see [§10](#10-three-things-this-merge-does-not-touch)

| # | Chunk | What lands | | |
|---|---|---|---|---|
| 14 | **Page switching without reload** | The nav mounts a page instead of reloading. Removes the whole per-load cost in [§9](#9-what-this-costs). | ☐ |
| 15 | **The three drifted helpers** | Diff `toNum_` / `norm_` / `gk_` across the three namespaces, write down what each difference *does*, then unify only what is provably equivalent. | ☐ |
| 16 | **Collapse `Deck_Styles`** | Fold the `.slide-bare` mirror into the component layer, proven against real captures. | ☐ |

### What chunk 2 settled

- **Shared modules port with the page that first exercises them**, not all up front.
  `AmrCache` / `AmrProgress` / `AmrBoot` arrive in chunk 3 with AGG Fuel Recovery, the first
  page that reads report data. Porting a module blind, with no page to prove it against, is
  how a silent break gets committed — and the two pages in chunk 2 need none of them.
- **The component layer paid immediately.** Three spinner keyframes (`spin`, `amrload`,
  `irspin`) collapsed to one; the Inventory Report's private `.ir-modal` / `.ir-card` /
  `.ir-input` shell is now the shared `.amr-modal` shell; the landing page's 820px and 900px
  breakpoints map onto `--bp-mid` and `--bp-narrow`.
- **One more dead thing found and dropped:** the landing page's "QlikView sync status" panel
  (`#qsPanel` / `#qsOut`, 17 lines of CSS behind it). Nothing ever wrote to it — it was the
  display for the sync-status feature that was never built, the same one `AmrQlik` belonged
  to. Deleted.
- **A bug shipped and the gate now covers it.** `app.html` read `window.APP_URL` twice and
  never set it — every old page had emitted it from `<?= appUrl ?>` and the merge dropped
  that line. `URL_BASE` was `''`, so every landing card href was **relative**, and a relative
  href inside the Apps Script sandbox iframe resolves against `googleusercontent.com`, not
  the web app. Clicking a card navigated the top window off the app: "it loads, then
  redirects". The page switcher also silently vanished, because `mountPageSwitcher` returns
  early on an empty `URL_BASE`.

  Two lessons, both now enforced: **`tests/merge.js` fails if `APP_URL` is read but never
  assigned, or assigned after §D reads it**; and `hrefFor()` is the single place that builds
  a link to another page, so it can log an error instead of silently returning a relative
  URL. It is also what makes the scaffold navigable — under `?page=app` the landing cards
  point at `?page=app&view=…`, so clicking through reaches the NEW pages rather than
  bouncing back to the legacy ones. `doGet` passes `appMode` for that, and at cutover
  `hrefFor` is the one function that changes.
- **`<?= ?>` ESCAPES. `<?!= ?>` does not.** This is the single sharpest edge in Apps Script
  templating and it cost two rounds. The first fix for the `APP_URL` bug emitted
  `window.APP_MODE = <?= appMode ? "'app'" : "''" ?>;`, which the server renders as
  `window.APP_MODE = &#39;app&#39;;` — **a syntax error that kills the entire script block**,
  taking the `APP_URL` assignment above it down too. It fails silently: the server renders
  without complaint and only the browser sees the damage.

  **Rule: values the server computes go in a `<body>` data attribute, never printed into
  JavaScript.** Escaping is correct and harmless in an attribute. `app.html` carries
  `data-page`, `data-app-url` and `data-app-mode`; the runtime reads them with
  `getAttribute`. `tests/merge.js` now fails on any `<?= ?>` inside a script block.
- **Apps Script evaluates every scriptlet in the file — including inside an HTML comment.**
  The comment written to explain the escaping hazard above contained the two forms as
  examples, and the render died with `ReferenceError: x is not defined` before the page
  loaded. A scriptlet in a comment is not documentation, it is code. Name the forms in prose
  or write them with entities; never as literals. `tests/merge.js` now scans **raw** source
  (comments and all) and fails on any scriptlet that is not one of the three variables `doGet`
  actually sets: `page`, `appUrl`, `appMode`.
- **A checker must not read prose as code.** Twice now a `merge.js` check keyed off text in a
  comment — first `§A4` in the head navigation, then `<body>` and `<?= ?>` inside the comment
  explaining this very hazard. It strips HTML comments up front now and anchors on the real
  `<body …>` element, matched with a scriptlet-aware pattern (a plain `[^>]*` stops at the
  `>` inside `<?= page ?>`).
- **`tests/merge.js` is the structural gate** and it works on both sides: it passed the real
  file, and unscoping one `.land-hero` rule made it fail with that selector named. It checks
  six invariants — script syntax, template↔registration pairing, every `getElementById`
  target existing, no id declared by two pages, every §A4 rule scoped, and no page leaking a
  global.

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
  executes its body on mount. [§10](#10-three-things-this-merge-does-not-touch) removes this cost
  entirely if it ever stops being acceptable.
- **Two pages get faster.** Landing and the Inventory Report load no CDN libraries at all once
  `AmrLib` is lazy.

---

## 10. Three things this merge does not touch

Each of these is a change worth making. None of them belongs *inside* the merge, and the
reason is the same every time: **if two changes land together and something breaks, you
cannot tell which one broke it.** The merge moves 37 files into 2 — that is already the
largest change this codebase has had. Anything that also changes *behaviour* waits until the
merge is proven, so a regression has one possible cause instead of two.

**1. Switching pages without reloading.** Today, clicking Ready-Mix in the nav loads a fresh
page from the server. Once everything is in one file, the browser already *has* Ready-Mix —
it could just show it, instantly. That is a genuine improvement and it is nearly free once
the merge is done. But it changes how navigation works, and if a page then misbehaves, "the
merge broke it" and "the new navigation broke it" look identical. So: merge first, keeping
navigation exactly as it is, then do this as its own change. Chunk 14.

**2. The three copies of `toNum_` / `norm_` / `gk_`.** Three namespaces each define their own
private version of these small helpers. They started identical and **have since drifted** —
so "tidying" them into one shared copy silently changes what at least two of them return, and
those helpers sit under every number the business reconciles against Qlik. This is the one
piece of duplication in the codebase that is safer left alone until someone diffs the three
implementations and proves what the differences actually do. Chunk 15 does exactly that.

**3. `Deck_Styles` duplicating page CSS.** The deck photographs slide content built by the
shared modules, but *without* the pages those modules normally live on — so it carries its own
mirror of the CSS those slides need, scoped under `.slide-bare`. It looks like pure
duplication. It is not, today: the pages and the deck are separate documents. After the merge
they are one document, and the mirror probably *can* collapse into the component layer — but
"probably" is not good enough for the deck's output, which is a picture nobody can restyle
after the fact. It comes across as-is, and any dedup is proven against real captures. Chunk 16.

---

## 11. Legacy hit-list

Everything unused comes out. But **"unused" has to be proved, and in Apps Script a grep does
not prove it** — read the next box before deleting anything.

> ### What counts as proof, and the trap that nearly cost the data pipeline
>
> Grep **is** reliable for one thing: every client→server call in this codebase uses a
> literal function name (`google.script.run.someFunction(…)`). There is no dynamic dispatch
> anywhere — `google.script.run[name]` appears zero times — so if no `.html` names a server
> function, no page calls it.
>
> **But a function with no caller in the repo can still be load-bearing**, because three
> kinds of caller live outside it:
>
> 1. **Time-driven triggers**, configured by hand in the Apps Script UI. Nothing in the repo
>    references them — there is not one `ScriptApp.newTrigger` in the codebase.
> 2. **Editor-run tools**, invoked by a human picking the function from the Run menu.
> 3. **`doGet`**, called by Apps Script itself.
>
> This is not hypothetical. An earlier draft of this file described `QlikSync.gs`'s four
> entry points as having "no client caller", which is true and badly misleading:
> **`qlikSyncCheck` is the time-driven trigger that runs the entire QlikView → Sheets data
> pipeline.** Deleting it because grep found no callers would have silently stopped every
> page's data from ever updating again, and nothing would have errored.
>
> So: **before deleting a top-level function, check the trigger list in the Apps Script UI
> and check whether its own comment says it is run from the editor.** Both are outside the
> repo. Only then does zero callers mean dead.

### Confirmed dead — remove when its chunk lands

- **`Page_Rmx.html`'s `include('Deck_RMX')`** *(chunk 6)*. The page calls nothing in
  `AmrRmxSlide`, and `Deck_RMX`'s only load-time side effect is registering the `rmx` adapter,
  which early-returns without `AmrDeckSource` — a file `Page_Rmx` does not include. 603 lines
  shipped on every Ready-Mix page load to do nothing. The module stays; the Deck Builder needs it.
- **Six of the seven QlikView guide copies** *(chunk 2)*. ~720 lines.
- **The six debug functions** *(chunk 12)* — see [§7](#7-logging-and-the-debug-functions-it-replaces).

### The QlikView sync is trigger-only, and stays that way

**Decision, not an accident: the sync runs on its time-driven trigger and has no UI. Do not
build one during the merge.** There is no ⇣ Pull from QlikView button and there never was —
older docs described an `AmrQlik` object that does not exist. A page that could trigger a
sync is a feature request, not a gap the merge is meant to close, and it would put a
minutes-long Drive job behind a button any user could press twice.

So there is nothing to remove on the page side, and nothing to add. On the server side, of
`QlikSync.gs`'s four entry points — all of them reached from the trigger or the editor, never
from a page:

| | |
|---|---|
| `qlikSyncCheck` | **Keep. Load-bearing.** The time-driven trigger target; the whole data pipeline runs through it |
| `qlikMarkCurrent` | **Keep.** Run once from the editor after the trigger is set up, so the first firing has stamps to compare. Needed again any time the trigger is rebuilt |
| `qlikSyncNow(scope)` | **Keep.** The only manual recovery path when the trigger misfires or a sync has to be forced |
| `qlikStamps` | **Candidate** — a read-only "what will the next check do" diagnostic. Deleting it costs the ability to answer that question without adding a log line. Decide in chunk 12 alongside the other diagnostics, not before |

### To audit before chunk 2 ends — audit, do not assume

- The `SB` reader / `getSlideData` / `syncSlideData` in `Code.gs`. The Segment page no longer
  reads those tabs; confirm the Overview still does before touching them.
- The CUSTOM FLAG LOOKUP path in `RMX_Suggest.gs`. `Page_Segment.html` states in its own help
  text that neither Extras table groups on it any more.
- The `RMX_Backend.gs` "legacy names" wrappers — `getMarkets`, `getKeys`, `getExtras`,
  `syncData`, `uploadRmxData`. Find each caller.
- The dead nav hook in `Shell.html`, which says in a comment that it is dead.
- The `EXECUTIVE OVERVIEW — canonical market list + PV/RMX name mapping` block in `Config.gs`,
  whose own banner comment starts `NOT USED`.
- Every `.gs` top-level function with no caller anywhere, listed once in chunk 1's audit and
  then worked through against the box above rather than deleted in a sweep.

---

## 12. Rules for whoever does the work

- **Branch.** `merging-files`, only. One commit per chunk, so any chunk can be reviewed or
  reverted on its own. Pull before you start — another agent may have moved it.
- **Leave the next agent a usable state.** Tick your chunk in [§8](#8-the-chunks) or annotate
  it with where it really stands, and put anything you learned in this file rather than in a
  commit message. Nobody reads commit messages before starting.
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
