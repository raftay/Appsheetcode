# PLAN — one `app.html`, one `app.gs`

**Status: in progress on `merging-files`. Chunks 0–10 done — `app.html` is ~1.07 MB and holds the runtime, thirteen shared modules and nine of the ten pages. Only TP01 (chunk 11) is left on the client side. §A3 is 363 rules and §A4 is 372. All 17 test harnesses run and are green; `tests/ovperiod.js` and `tests/bgrender.js` both drive `app.html` through a real browser alongside their legacy side, and `tests/pageparity.js` now covers seven pages. The 16 `.gs` files are untouched and stay that way until chunk 12.**

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
10. [Four things this merge does not touch](#10-four-things-this-merge-does-not-touch)
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

**Shared ids are the point, not a compromise.** *(Settled in chunk 4.)* 37 ids are declared by
more than one page, and the two fuel pages share 21 of their 21 — they are the same screen on
different numbers. Chunk 2's `merge.js` forbade that outright, to keep chunk 14 safe. That was
the wrong trade: it would have forced a rename pass on nearly every remaining page chunk
(Ready-Mix × Segment share 15 ids, Price & Volume × Ready-Mix 12) and left the twins no longer
diffable against each other, all to buy a guarantee the mount already provides.

So the rule is the one the design always implied:

> **Where two pages do the same thing, they use the same id and the same class. Where they
> differ, they differ.** `#syncBtn` is the update button on both fuel pages; RMX Fuel's single
> upload is `#upMain` because AGG's two are `#upComb` and `#upOther`, and that is a real
> difference rather than a naming one.

What actually keeps it safe is **exactly one page in the document**, and that is now enforced
rather than assumed:

- `AMR.start()` **empties `#appRoot` before mounting**, and `tests/merge.js` fails if that line
  goes.
- `merge.js` checks the invariant that does matter — **no id declared twice inside one page's
  template** — instead of the one that does not.
- **Chunk 14 must replace the mounted page, never add a second beside it.** Caching mounted
  pages for speed is the one implementation that breaks this, so it is ruled out here in
  advance. The note is in `AMR.start()` too, where somebody writing that code will see it.
- The QlikView guide and its FAB are appended to `<body>`, outside `#appRoot`, so **chunk 14
  needs a teardown for them** whatever it does about ids.

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
Client-side page switching is a real follow-up ([§10](#10-four-things-this-merge-does-not-touch)) but
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
| 3 | **AGG Fuel Recovery** | `Page_FuelSurcharge` + `Deck_Fuel`. First real port, chosen because `tests/regress.js` already proves this page byte-identical — the method gets validated where there is a gate on it. §E gains `AmrProgress`, `AmrBoot`, `AmrFresh`, `AmrSlide`, `AmrFuelExec`; §A3 gains the slide frame, the load screen and the fuel tables. **No §A4 block at all** — see [§8's chunk 3 notes](#what-chunk-3-settled). Plus `tests/pageparity.js` and `tests/modparity.js`. `Code.gs` needed no change. | `tests/merge.js`, `tests/modparity.js`, `tests/pageparity.js`, `OLD_DIR=… tests/regress.js` — all green | ✅ |
| 4 | **RMX Fuel Recovery** | `Page_RmxFuel`, reusing the `AmrFuelExec` and components chunk 3 promoted. **It added zero CSS and zero modules** — §A3 is byte-for-byte the same 385 lines it was after chunk 3, which is the promotion test paying out. Settled the duplicate-id question ([§3](#3-how-the-pages-live-inside-one-html-file)) and hardened the mount. | `tests/merge.js`, `tests/pageparity.js` (90 comparisons, both fuel pages), `OLD_DIR=… tests/regress.js` — all green | ✅ |
| 5 | **AGG Price & Volume** | `Page_PriceVolume` + `Deck_PV` + `KpiShared` + `Cube`; `SlideExport` had already come in chunk 3. 1,800 lines of page JS, all three libraries, and all 54 id-scoped declarations converted — **and it needed exactly ONE §A4 rule.** §E gains `AmrCache`, `AmrKpi`, `AmrCube`, `AmrPvSlide`. | `merge.js`, `modparity.js`, `pageparity.js` (126 comparisons), `pvcheck.js`, `pvlookup.js`, `slidefit.js` — and the whole suite, all 17 harnesses, green | ✅ |
| 6 | **Ready-Mix** | `Page_Rmx` only — **`Deck_RMX` does NOT come here**, see below. 65 of its 67 id-scoped rules were deleted rather than ported, because chunk 5 had already promoted the same mapping check and dialog. **Two dead includes removed from the legacy page**: `Deck_RMX` and `Cube`, ~1,225 lines on every Ready-Mix load. The one page with a real §A4 block, and the reason is bare element selectors. | `tests/merge.js`, `tests/pageparity.js` (147 comparisons), `tests/rmxcost.js`, `tests/segboot.js` + the whole suite — all green | ✅ |
| 7 | **Product Segment** | `Page_Segment` + `Deck_SEG`. §E gains `AmrSegSlide`; §A3 gains `table.gt` and the slide-body rows. **Zero §A4 rules** — six id-scoped rules became `.tbl-stack` / `.previewHost`, and everything else was already shared. | `tests/merge.js`, `tests/pageparity.js` (170 comparisons), `tests/segboot.js`, `tests/deckstatic.js` + the whole suite — all green | ✅ |
| 8 | **Overview, part 1 — shell and cube** | `Page_Overview`'s whole markup (342 lines, 136 ids), its whole style block as **234 §A4 rules**, and the shell half of its script: state, helpers, the panel primitives, the market chips, the period model (`STATE`, `PICK_SERVER`, `windowPeriod`), the month window, the `AmrCube` wiring, the history pill, `load()` and `boot()`. No painters — they are behind a ten-name **CHUNK 9 SEAM** block. §A3 gained exactly one rule. `tests/ovperiod.js` drives `app.html` as a second side now, and `tests/merge.js` learned to resolve `$('id')`. | `tests/merge.js`, `tests/ovperiod.js` (both sides; merged is shell-only) + the whole suite — all green | ✅ |
| 9 | **Overview, part 2 — the panels** | Every painter, both cross-filter engines, the fifteen chart registries in `CH`, `pcatFits`, the SAP/USGAAP cards, customers, fuel surcharge, product category, and the data-quality sheet with its lookup editor — 4,128 lines, and **zero CSS**. The chunk-8 seam block goes; all ten names are the real thing. *(`hidePanel` / `resetPanels` are NOT here: they are the panel primitives the shell's own `renderTab` needs, so they landed in chunk 8. Corrected against the code.)* | `tests/ovperiod.js`, merged side's shell flag removed — all seven checks, both tabs, all four periods, mutation-tested three ways — plus the whole 17-harness suite, all green | ✅ |
| 10 | **Deck Builder** | `Page_DeckBuilder` + `Deck_Sources` + `Deck_Styles` **+ `Deck_RMX` + `AmrTick`** — §E gains `AmrDeckSource`, `AmrRmxSlide` and `AmrTick`, and §B gains the 86 `.slide-bare` capture rules. **70 §A4 rules, all `.db-*`, zero collisions.** Nine inline handlers became listeners, three of them delegated because the rows are redrawn. `tests/bgrender.js` drives `app.html` as a second side and checks all six deck sources register — the one thing that could only break in the merge. | `tests/merge.js`, `tests/modparity.js` (13 modules), `tests/bgrender.js` (both sides), `tests/pageparity.js` (190 comparisons) + the whole suite — all green. **A real deck build is still owed**: `DECK_create` / `addSlide` / `finish` have never run against the live deployment | ✅ |
| 11 | **TP01** | `Page_TP01`. Mail sends as the deploying account. | a real send to a test recipient | ☐ |

### The server, and the cutover

| # | Chunk | What lands | Review by | |
|---|---|---|---|---|
| 12 | **`app.gs`** | All 16 `.gs` merged in the [§5](#5-the-shape-of-appgs) order, sectioned and commented. `APP_log()`, `APP_verifyPermissions()`, `oauthScopes` added to `appsscript.json`. The six debug functions deleted and `qlikStamps` decided. Old `.gs` deleted **in this same commit** — they cannot coexist ([§2](#2-the-thing-that-would-have-broken-it)). | `tests/configcheck.js`, `tests/qliksync.js`, `node --check`, then `APP_verifyPermissions()` in the editor | ☐ |
| 13 | **Cutover** | `doGet` serves `app.html` for every route; the `?page=app` scaffold goes; all old `.html` deleted; `README.md` and `CLAUDE.md` rewritten around two files. **Delete `tests/modparity.js`** and repoint `regress.js` / `pageparity.js` / `slidefit.js` / `deckpath.js` at `app.html` — they compare against files that no longer exist after this commit. | the whole suite, every route | ☐ |

### After the merge is proven — see [§10](#10-four-things-this-merge-does-not-touch)

| # | Chunk | What lands | | |
|---|---|---|---|---|
| 14 | **Page switching without reload** | The nav mounts a page instead of reloading. Removes the whole per-load cost in [§9](#9-what-this-costs). **Must REPLACE the mounted page, never keep two** — pages share ids on purpose ([§3](#3-how-the-pages-live-inside-one-html-file)). Also needs a teardown for the guide aside and FAB, which live outside `#appRoot`. | ☐ |
| 15 | **The three drifted helpers** | Diff `toNum_` / `norm_` / `gk_` across the three namespaces, write down what each difference *does*, then unify only what is provably equivalent. | ☐ |
| 16 | **Collapse `Deck_Styles`** | Fold the `.slide-bare` mirror into the component layer, proven against real captures. | ☐ |
| 17 | **Device cache on both fuel pages** | Wire `AmrCache` into AGG Fuel Recovery and RMX Fuel Recovery, so a repeat visit paints from `localStorage` instead of waiting on the sheet. **Requested; new behaviour, not a port** — see [§10](#10-four-things-this-merge-does-not-touch). | ☐ |

### What chunk 2 settled

- **Shared modules port with the page that first exercises them**, not all up front.
  `AmrProgress` / `AmrBoot` arrive in chunk 3 with AGG Fuel Recovery, the first page that
  reads report data. Porting a module blind, with no page to prove it against, is how a
  silent break gets committed — and the two pages in chunk 2 need none of them.
  *(Corrected in chunk 3: this sentence also named `AmrCache`, which that page never calls.
  It goes to chunk 5. `AmrFresh` and `AmrSlide` came in its place. The rule was right; the
  list was written from memory rather than from the page.)*
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
  global. *(The id check was replaced in chunk 4 — see [§3](#3-how-the-pages-live-inside-one-html-file).
  Ids repeat across pages on purpose; what is checked now is that none repeats within one page
  and that the mount empties `#appRoot`.)*

### What chunk 10 settled

- **§E has an ORDER now, and it is load-bearing for the first time.** `AmrPvSlide`,
  `AmrFuelExec`, `AmrSegSlide` and `AmrRmxSlide` each end with an `AmrDeckSource.register()`
  wrapped in `if(!window.AmrDeckSource) return;`. Three of them have been in §E since chunks
  3, 5 and 7 with that guard falling straight through, because the registry was not there.
  Putting `AmrDeckSource` above all four is what turns them on — and putting it *below* even
  one of them costs that adapter silently: no error, no warning, just a Deck Builder that
  opens with a shorter source list than it should have. `tests/bgrender.js` checks the
  registry in a real browser for that reason, and was mutation-tested by moving
  `AmrDeckSource` below `AmrSegSlide`: five of the six sources vanish and it names them.

- **This page's whole script was top level — no IIFE at all.** That is why its nine inline
  `on*=` handlers worked, and why every one of them had to become a listener: inside a
  registration IIFE they resolve against `window` and find nothing. Six were in the markup
  (wired by id or `data-act`); **three were written into generated rows** by `rowHtml()` and
  `kpiPickerHtml()`, and those are delegated on `#dbList` rather than bound per row, because
  `redraw()` replaces that host's innerHTML on every status change and per-element listeners
  would go with it. This is the first port where generated handlers appeared; TP01 has three
  more of the same shape.

- **A diff cannot tell you a handler still fires.** `#dbList`'s markup differs by exactly the
  six attribute forms the port moved, so the case declares a `normalise` that strips those and
  compares everything else byte for byte — and then **unticks a slide** and compares again.
  Without that second step, deleting the delegated listener passes clean; with it, two
  comparisons fail. `pageparity.js` gained `drive` (a case can move a control any way it
  likes, not only by clicking a button) and `readAsked` (compare what each side asked the
  server, for rewiring that changes nothing on screen).

- **70 §A4 rules, zero collisions, nothing promoted.** Every rule is `.db-*` and none of them
  is a component: no other page has a slide-plan table, a three-stage bar or a preview mock
  built from template geometry. The chunk 6 test answering in the other direction, as the
  Overview's 234 did.

- **The Deck Builder is the one page that keeps a fourth breakpoint, with the reason written
  next to it.** 1080px (the rail dropping below the list) maps onto `--bp-mid`. 1180px does
  not: the slide rows degrade in two stages — drop the Layout column, then drop the Region
  picker and the thumbnail — and folding them together would put seven grid columns, 668px of
  fixed tracks, into a 644px column at 1000px wide. §3 allows a fourth step with a reason;
  this is the reason.

- **The page gained a `? Help` button.** It has always had `HELP_HTML` and no way to open it —
  the header carried Home and Check template only. One button, and the help it already had.

- **§B is a mirror and stays one.** `Deck_Styles.html`'s 86 rules are all under `.slide-bare`
  — checked, not assumed. They duplicate rules that also live in §A3, and collapsing them is
  chunk 16, against real captures: the deck's output is a picture nobody can restyle
  afterwards, so "these look the same" is not the standard.

- **A comment describing CSS is not CSS.** The first scan of `Deck_Styles.html` reported one
  unscoped rule, `.exp table td`. It came from the file's own header comment, which quotes
  `.exp table th, .exp table td{padding:4px 9px}` in prose to explain what the file exists
  for. Nothing is unscoped. That is the **fourth** time in this merge that a checker read
  prose as code; the fix is always the same — anchor on the element, strip comments first.

- **The scoper had to learn what an at-rule is.** Scoping `@keyframes spin{to{…}}` produced
  `@keyframes spin{body[data-page="tp01"] to{…}}` — a keyframe stop is not a selector, and a
  scoped one silently does nothing. `@media` and `@supports` wrap real selectors and are
  scoped; everything else is copied through. Found on TP01, fixed for both.

- **`AmrTick` ports here, as chunk 8 said it would.** The Deck Builder's `dbSoon` and
  `AmrSlide`'s capture settle are its only callers. `tests/bgrender.js` proves it is
  worker-backed inside `app.html`, not only inside `Shell.html`.

### What chunk 9 settled

- **It added no CSS and no modules** — the same shape chunk 4 had, for the same reason: chunk 8
  landed the whole style block, so §A3 is byte-for-byte what it was and §A4 did not move off
  302. A 4,128-line commit that touches no stylesheet is easier to review than a 6,000-line one
  that touches everything, which is the whole argument for the split.

- **The seam held.** All ten names in chunk 8's `CHUNK 9 SEAM` block are the page's own
  functions now and the block is gone. Nothing else in the port had to change to absorb them —
  no call site, no ordering, no state — which is what "the seam is ten names" was claiming and
  is now evidence rather than a plan.

- **`tests/ovperiod.js` runs all seven checks against `app.html`.** Four Period settings, both
  tabs, the four-period sweep for stray notices, Product Category on Prev month only *and off
  the right server tab*, plants/materials/customers/bridges/surcharge under a cube span, the
  2024 quick-window dropping the live-book panels, and a server period bringing everything
  back. The merged Overview answers identically to the legacy page on every one.

- **Mutation-tested three ways, each failing on the merged side alone**, so the gate is known to
  be reading the port and not something both sides share:
  - `pcatFits()` forced to `true` → Product Category shows under This month and Year to date.
  - `PICK_SERVER`'s `PMTD` / `PYTD` swapped → Product Category reads the wrong tab (the check
    chunk 8 had to add before this mutation could fail at all).
  - `prevMonthOf()` stepping back two months → both Prev-month windows land a month early.
  A fourth was tried and did **not** fail: making `snapWindowTo()` return immediately. That is
  not a hole — `periodSpan()` and `syncWindow()` between them still put the handles in the
  right place, so the mutation genuinely changes nothing observable. Worth writing down so the
  next agent does not go looking for the bug it implies.

- **`AmrKpiStore` is still unclaimed.** Neither Overview chunk touches it; the only pages left
  are the Deck Builder and TP01. Unless one of them turns out to call it, it goes at chunk 13
  as the hit-list says.

### What chunk 8 settled

- **The seam, and where it actually is.** Chunk 9's row used to claim `hidePanel` /
  `resetPanels`; they are the shell's, not a painter's — `renderTab()` calls `resetPanels()`
  before anything paints, so splitting them off would have left chunk 8 unable to mount its
  own page. They are in chunk 8. `pcatFits` really is chunk 9's: it is the Product Category
  panel's own decision and nothing else calls it.

  The seam is otherwise **ten names**, in one block marked `CHUNK 9 SEAM` at the top of
  `boot()`: `renderTab`, `renderActiveTab`, `renderXfBar`, `renderRxfBar`, `renderTrendNow`,
  `renderTrendSoon`, `dqBadge`, `loadWorkbooks`, `afterLookupWrite`, and `var RXF` — the one
  piece of painter state the shell touches, because the market chips clear the Ready-Mix
  submarket filter when the market changes. Chunk 9 replaces all ten and deletes the block.
  That is the whole cost of splitting a 5,272-line IIFE in two, and it was worth measuring
  before assuming: the naive guess was "a dozen stubs everywhere", and it is one block.

- **234 §A4 rules — and that is the right answer, not a failure of the promotion test.**
  Chunk 6 wrote the test as *"is this rule a component"*, and this page is where it pays out
  in the other direction. `.ov-*` is the page frame, `.kpi*` the headline strip, `.dq-*` /
  `.lk-*` the data-quality sheet and its lookup editor, `.xf-*` the two cross-filter engines.
  No other page has tabs, a month-window slider, a cross-filter chip bar or a lookup editor,
  and the two pages left to port (Deck Builder, TP01) have none of them either. Promoting any
  of it would only make §A3 harder to change. **§A3 grew by exactly one rule.**

- **The one rule it did add, and the finding behind it.** This page's `.seg` **is** §A3's
  `.seg.pills` — same 1px border, same 9px radius, same hover, same pressed state, written
  out again because nobody had promoted it. Eight controls now say `class="seg pills"` and
  the page carries no copy. The only thing its version had that §A3's did not is
  `.seg button[disabled]`, and that went to §A3: the two Prev-month buttons are dead until
  the cube holds the month they need, and a disabled state is a state of the control, not of
  a page. The one deliberate pixel change is 6px: `.seg.pills` pads `8px 12px` where this
  page padded `8px 15px`.

- **`.linkbtn` was an `<a>` all along.** §A3's version is a `<button>` in a `.linkbtns` row
  and never needed `display:inline-block` or `text-decoration:none`. The Overview's
  source-missing notice links to another tool with an anchor, so without those two the link
  underlines and its vertical padding does nothing. Both are in §A3 now — a fix, not a
  preference — and the page takes §A3's slightly smaller type and padding with it.

- **Four `@media` queries, two strays, one step.** 900px ×3 and 860px ×1 all map onto
  `--bp-mid` (980px), which is the only layout switch this page has: two columns to one, five
  KPI columns to a wrapping flex row. Between 860 and 980 the KPI strip now wraps where it
  used to stay in five columns — deliberate, and the safer side of it, because five cards
  with `min-width:158px` do not fit a 900px viewport without overflowing their tracks.

- **`tests/merge.js` could not see 139 of this page's id lookups.** The Overview and Ready-Mix
  both declare `function $(id){ return document.getElementById(id); }` and then use `$`
  everywhere; the ids-resolve check only matched the long form, so it was reading a third of
  what those two pages actually look up. It resolves both spellings now — but only on a page
  that declares that exact helper, so a jQuery-shaped `$` on some future page cannot be
  misread as an id lookup. It also had to learn that **an id can be built by the page**: every
  chart canvas here is written into a panel by the painter that then looks it up, so a lookup
  resolves against the template *or* against markup this page's own code builds. 110 lookups
  checked before, 249 after. Mutation-tested: `$('winVal')` → `$('winVall')` fails by name.

- **`tests/ovperiod.js` runs against `app.html` now, not only the legacy page.** Same fixture,
  same clicks, same seven checks, one label per side, and it is the gate this chunk and chunk
  9 rest on. Three things it taught:
  - **A `<body>` written in prose is still matched by a regex looking for `<body>`.** The stub
    is spliced in after the body tag; `app.html`'s `<head>` navigation comment *describes* one,
    so the first match in the file is inside a comment and the entire stub landed commented
    out — a page that boots and does nothing, which looks like a dead port. It searches after
    `</head>` now. That is the **third** time a checker in this repo has read prose as markup
    (see chunk 2's two); the lesson is not "be careful", it is *anchor on the element*.
  - **`AmrLib` has to be neutralised in any browser harness.** The merged page awaits an
    injected `<script src>`'s `onload` before `boot()`. Off the network that promise never
    settles and the page never boots. The stub resolves every injected script at once — the
    same trick `pageparity.js` already used under jsdom, now needed under Chromium too.
  - **A fixture that answers the same thing twice cannot test which question was asked.**
    `PICK_SERVER` says which server tab a Prev-month pick reads, and Product Category is the
    only panel that reads it — but the fixture returned identical rows for MTD and YTD, so
    **swapping `PMTD` and `PYTD` in `PICK_SERVER` passed clean, on both sides.** The two
    periods now carry different volumes and check 4 reads them. The swap fails by name.
- **Chunk 8's merged side is `shell: true`** — checks 1–2 (the Period control, the slider, the
  cube) run against it, 3–7 do not, because they read panels. Chunk 9 deletes the flag and the
  three lines that honour it. It is there rather than absent because the four Period buttons
  **are** chunk 8's review and they are only observable in a browser; mutation-tested by making
  `prevMonthOf()` step back two months, which fails both window assertions on the merged side
  alone.

- **`AmrTick` is NOT the Overview's** — the plan asked for this to be decided here. Grepped
  both ways: the page has zero references. Its real callers are `Page_DeckBuilder.html`'s
  `dbSoon` and `SlideExport.html`'s capture settle, so it ports in **chunk 10** with the Deck
  Builder, and `tests/bgrender.js` / `tests/deckstatic.js` are what will prove it. §E's
  `AmrSlide` already falls back gracefully when it is absent, which is why nothing has noticed.
  `AmrKpiStore` is still unclaimed and still goes at chunk 13 unless chunk 10 or 11 wants it.

- **The port was derived, not retyped**, as chunks 4 and 7 did it: the page's script block is
  spliced in whole and every edit is a declared substitution asserted to match exactly once.
  Three substitutions in the script, one in the markup, and the `class="seg"` rewrite is
  asserted to hit exactly eight. The style block went through a character scanner that copies
  everything outside a selector run byte for byte, so §A4 diffs cleanly against the original,
  and a separate pass checks all 234 rules survived with their declarations unchanged.

- **`String.replace(from, to)` ate the file.** The assembly spliced the registration in with a
  plain string replacement, and the page's own `fMoneyFull` contains `'-$':'$'` — a `$` followed
  by a quote, which `replace` reads as *"insert everything after the match"*. The Inventory
  Report block was duplicated 34 times and `app.html` came out 6,300 lines too long. Every
  splice in the assembly passes a **function** as the replacement now. `merge.js` caught it
  instantly, with 75 failures naming a duplicate registration.

### What chunk 7 settled

- **Zero §A4 rules.** Six id-scoped rules became classes (`#tablesHost` → `.tbl-stack`,
  `#previewHost` → §A3's existing `.previewHost`), `table.gt` and the slide-body rows
  (`.crow` / `.ccell` / `.ccap` / `.phold`) went to §A3 because `AmrSegSlide` emits the same
  markup for the deck, and `.shell{max-width:1480px}` / `.logoName` / `.dzstat` /
  `.previewCard` / `.empty` were all already there from chunk 3. §A4 is unchanged at 68 rules,
  all of them Landing's, Ready-Mix's and the Inventory Report's.
- **`.ghost` on white is NOT on this page.** Product Segment already used `.lk` for its two
  guide buttons. Four of five ported pages had the bug; this one had the fix. `Page_TP01` and
  `Landing` are what is left to check. *(Both checked in chunks 10–11: neither puts a button
  inside its guide at all — TP01's guide is one step with no upload panel, Landing's is five
  steps with none — so the item is closed.)*
- **THREE deferred inits, and the order is the contract.** `segKpiInit` was registered at line
  638 with five hundred lines of declarations below it, the main handler at 1058, and the
  guide's `wire()` in a tail IIFE. All three are called at the end of `boot()` **in the order
  the events fired them** — `segKpiInit()`, `segPageInit()`, `wire()`. Chunk 5's rule again,
  now applied to a page with three of them.
- **Blanket-indenting a ported body CORRUPTS multi-line template literals.** Product Segment
  carries its Amrize logo as a multi-line `` `<svg …>` `` literal, and two spaces per line
  changed the string the page renders. `pageparity.js` caught it — 169 of 170 identical and
  one inline SVG off by whitespace. The assembly step now uses an `indent_js()` that tracks
  unescaped backticks and leaves literal interiors alone. **Chunks 5 and 6 were checked and
  have no multi-line literals, so nothing is owed backwards** — but chunks 8–11 must use the
  literal-aware indenter.
- **`pageparity.js` grew two things this chunk, both because a mutation passed when it should
  not have:**
  - **`setup`** — an optional per-case hook run on both sides before anything is compared.
    Some state is only reachable by driving a control: this page opens on *Central Canada*,
    which legitimately has no KPI row, so `#segKpiStrip` was being compared empty-to-empty
    and commenting out `segKpiInit()` passed clean. The case now picks Innocon first.
  - **`DUMP=<page id>`** — prints what a case actually compares. That is how the two silent
    mutations were diagnosed: the reading was not looking at the thing being changed.
- **A stub has to match the ENVELOPE, not the payload.** `getKpiValues(known)` answers
  `{ generation, cached, values }` and `AmrKpi.load` settles to `null` on anything else, so
  a stub returning the bare store left the strip empty and looked like a fixture that did not
  matter. Read the caller, not the function name.
- **Reuse the fixtures that already exist, again.** Both new models in `pageparity.js` —
  `segmentModel` and the `RMX_getSlideTables` reply — are lifted from `tests/segboot.js`,
  which drives the real page through a browser.

### What chunk 6 settled

- **65 of 67 id-scoped rules were DELETED, not ported.** Chunk 5 promoted Price & Volume's
  mapping check and add-row dialog into §A3; Ready-Mix's near-identical copies simply went
  away. That is the whole return on chunk 5's promotion work, and it is why §A3 grew by only
  28 rules here while the page shed 67. The two survivors were `#rmxPreviewHost`, which became
  §A3's existing `.previewHost`.
- **This is the page that genuinely needs §A4, and the reason is worth knowing.** Ready-Mix
  styles **bare element selectors** — `table`, `th,td`, `thead th`, `tfoot td`, `aside`,
  `main`. In one document those repaint every other page. So they are *scoped*, not promoted:
  27 rules under `body[data-page="rmx"]`. That is the opposite call from chunks 3–5 and the
  right one — these are not a component, they are one page overriding the base layer for its
  dense, sticky-header report tables. **The test is not "is this rule shared", it is "is this
  rule a component".**
- **`Deck_RMX` is NOT ported here, and the chunk-6 row used to say it was.** `Page_Rmx.html`
  contains **zero** references to `AmrRmxSlide`. The module is the Deck Builder's and arrives
  in chunk 10, by the same rule that held `AmrCache` back to chunk 5. The `include` was 603
  lines shipped on every page load to register an adapter that early-returns without
  `AmrDeckSource`.
- **`include('Cube')` was dead here too — a new finding.** `Page_Rmx.html`'s only mention of
  the word "cube" is the include line itself, and `Cube.html` has **no auto-init** (its own
  closing comment says so: each page must call `AmrCube.configure({…}).init()`). So that is a
  second 622 lines. Both includes are removed from the legacy page: **~1,225 lines off every
  Ready-Mix page load, now, before cutover.**
- **The harness proved the removal.** `pageparity.js` boots the *legacy* page, so if either
  include had been live the legacy side would have broken and the diff would have failed. It
  still reports 147 comparisons identical. A deletion that a gate has to survive is worth more
  than a deletion with a grep beside it.
- **Ids renamed onto the suite's shared names**, as [§3](#3-how-the-pages-live-inside-one-html-file)
  asks: `#rmxPreviewHost` → `#previewHost`, `#sugModalHost` → `#sugHost` (and Price & Volume's
  `#pvSugHost` renamed to match — one component, one id), `.view on` → `.view active`.
  `pageparity.js` carries a **`legacyIds`** map so a rename is declared and still compared,
  rather than the reading being quietly dropped. Use it whenever a port adopts a shared name.
- **One deliberate pixel change, stated plainly.** The add-row dialog's cells are left-aligned
  now on Ready-Mix, where the page's `th,td{text-align:right}` had been right-aligning label
  text and dropdowns. Price & Volume had already fixed that on its own copy, with a comment;
  sharing the component shares the fix. The dialog is also 80px wider and its inputs 16px
  wider — PV's values, taken because keeping both meant keeping two dialogs. **Nothing here is
  screenshot-verified**; it is the one place chunk 6 changes appearance on purpose.
- **The DOMContentLoaded rule from chunk 5 paid for itself immediately.** Ready-Mix's handler
  sits near the *top* of its script with ~1,200 lines of declarations below it — the worst
  possible case. It became `rmxPageInit()`, called at the end of `boot()`. Written down once,
  applied without a debugging round.
- **Ready-Mix registers no `AmrHint`.** Its parity case has no `hint` assertion, on purpose: a
  chrome check that fails for the right reason on the wrong page is worse than no check.
- **`.ghost` on white — a fourth page.** Same invisible guide buttons. `Page_Segment`,
  `Page_TP01` and `Landing` are what is left to check.
- **Reuse the fixtures that already exist.** The Ready-Mix model in `pageparity.js` is lifted
  from `tests/segboot.js`, which drives the real page through `RMX_prepare` in a browser.
  Two harnesses that disagree about what the server sends are worse than one.

### What chunk 5 settled

- **The whole test suite runs now.** `slidefit`, `segboot`, `ovperiod`, `bgrender` and
  `deckpath` needed Playwright and Chart.js, which were simply not installed —
  `npm install playwright chart.js jsdom` (all three at once; `--no-save` prunes the others
  if you do them one at a time) plus the pre-installed Chromium at `/opt/pw-browsers`. Nothing
  was wrong with those harnesses. **17 harnesses, all green**, and chunk 5 is the first chunk
  whose gates were all actually run rather than reported as unavailable.
- **One §A4 rule for the largest page in the merge.** `body[data-page="pricevolume"] .shell`
  — a narrower rail and a narrower page. Everything else in its 162-line style block was
  shared: **27 of the 33 selectors it has in common with Ready-Mix are byte-identical once
  whitespace is normalised**, so the mapping check, the add-row dialog, the customer table,
  the view tabs and the export-compact variant all went to §A3. §A3 is 310 rules now.
- **The 54 id-scoped declarations are gone, and the win was not tidiness.** `#mapHost …` and
  `#pvSugHost …` became `.mapHost` / `.sugHost` — ids kept as JS hooks, appearance on the
  class, exactly as [§3](#3-how-the-pages-live-inside-one-html-file) requires. The point is
  what it unlocked: **Ready-Mix has a near-identical copy of both blocks, and chunk 6 now
  deletes its copy instead of porting it.** That is [§1a](#1a-chunk-1-results--the-three-audits)'s
  audit paying out — the id-styling problem was concentrated in two pages, and this was the
  first of them.
- **`var AMR` — dead, and it would have broken the runtime.** The page declared
  `var AMR = CONFIG.colors.palette.slice()`. One occurrence in the entire repo, its own
  declaration; `CONFIG.colors.palette` fed nothing else either, so both are deleted. But it
  was not merely dead: inside a registration IIFE `var AMR` **shadows `window.AMR` for every
  line below it**, so `AMR.log` would have been an array of hex strings. `merge.js` has a
  seventh check now — no page may declare a name the runtime owns — and it fails with the
  page and the name when the line is put back.
- **`syncKpiName()` deleted.** No caller anywhere, and the `#kpiName` input it wrote to
  exists in no file in the repo. The leftover of a removed "rename this sheet" control.
- **A DOMContentLoaded handler cannot just be invoked where it stood.** This is the sharpest
  thing chunk 5 learned and it will bite chunks 6–11. The event fired *after the whole script
  had been evaluated*, so the handler could read `var DIMS`, `var KPI_INPUT` and everything
  else declared **below** it. Inlining the body in place hoists those names but not their
  values, and boot died on `DIMS.forEach` before the page drew anything.

  > **Rule: a page's DOMContentLoaded body becomes a named function and is CALLED AT THE END
  > of `boot()`** — in registration order where there is more than one. That is the position
  > the event actually gave it. Chunks 3 and 4 got away with inlining only because their
  > handler was already the last thing in the file.
- **`AMR.start()` logs the stack now.** The bug above surfaced as one line —
  `TypeError: Cannot read properties of undefined (reading 'forEach')` — with no location, in
  a 9,000-line file. `boot threw` carries `err.stack` from here on; that single change is what
  turned it into a two-minute fix.
- **`AmrKpiStore` has no caller anywhere.** Grepped across every `.html` and `.gs`: the only
  hits are its own definition in `Shell.html` and two comments. It is **not** ported — see the
  legacy hit-list. `AmrTick` has no caller on any page ported so far either; the Overview
  (chunks 8–9) is where to check it.
- **The `.ghost`-on-white bug is on a third page.** Price & Volume's guide upload buttons had
  it too. Fixed here; `Page_Segment`, `Page_TP01` and `Landing` still need checking as their
  chunks land.
- **`pageparity.js` is page-driven now.** A case says which host holds the payload, which
  controls to read, and how to click a view; the fuel pages and PV share the machinery.
  Two things it taught this chunk:
  - **Chart.js has to be stubbed.** Neither side gets the real one — jsdom fetches nothing —
    so without a stub *both* pages throw inside `renderCharts` and stop before their tables,
    and the diff calls that a match. The stub records and draws nothing.
  - **Read something the change actually moves.** Breaking `switchView()` passed clean at
    first, because `#tables` belongs to the Markets view and does not change when Customers
    is shown. The case reads `#custHost`, `#viewNav` and `#custMeta` now, and the same
    mutation fails three comparisons. **Check your case fails before trusting that it passes.**
- **Staging recipes, so nobody re-derives them.** `regress.js` wants `6400026`; `pvcheck.js`
  wants `b713df9^` — the parent of the commit that added `Deck_PV.html`:
  ```bash
  git show b713df9^:Page_PriceVolume.html > /tmp/old/old_pv.html
  OLD_DIR=/tmp/old node tests/pvcheck.js      # 11 comparisons, 0 failed
  ```

### What chunk 4 settled

- **It added nothing.** No CSS, no modules, no `§A4` block — §A3 is byte-for-byte the same 385
  lines chunk 3 left it at, and the whole commit is one `<template>`, one registration and the
  id decision below. Chunk 3's style blocks were byte-identical between the two pages to begin
  with, so promoting instead of scoping there is what made this chunk free. **That is the bar
  for chunks 5–9:** whatever a page adds to §A3 is what the *next* page will not have to.
- **Duplicate ids are the design, and `merge.js` was changed to match.** Written up in
  [§3](#3-how-the-pages-live-inside-one-html-file). Short version: the two fuel pages share all
  21 of their markup ids because they are the same screen on different numbers; chunk 2's
  across-pages uniqueness check would have forced a rename pass on nearly every remaining
  chunk to buy a guarantee the mount already gives. So `AMR.start()` now **empties `#appRoot`
  before mounting**, `merge.js` checks that line and checks no id is declared twice *within* a
  page, and chunk 14 is on the record as having to replace the mounted page rather than keep
  two. The check moved from one that was easy to enforce to the one that is actually true.
- **The port was derived, not retyped.** `tpl_rmxfuel` and its registration were generated from
  the AGG ones by a script of declared substitutions, each asserting it matched exactly once.
  Two reasons, both worth keeping for chunk 6 (Ready-Mix × Segment share 15 ids and a lot of
  shape): a substitution that stops matching is a *loud* failure, where a hand-retype drops a
  branch silently; and the two registrations stay diffable, which is the only thing that will
  keep them in step when someone fixes a bug in one of them.
- **The real differences, all of them.** Everything else is the same code:
  `cyY()` / `pyY()` (the years ride in the payload, so no year-roll edit), the `'rmx'` units
  descriptor, `getRmxFuelData` / `getRmxFuelDataFromUpload`, **one** uploaded workbook
  (`#upMain`) where AGG needs two (`#upComb` + `#upOther`) because the Ready-Mix export carries
  CY/PY Fuel Surcharge as real columns, no Saskatchewan notice, and its own help, hint,
  auto-titles and `Innocon` default.
- **`#fscGuideExtra` became `#guideExtra` on both pages.** It is "this page's own panel inside
  the guide", not an Aggregates thing, and the twin needed the same slot. Renamed rather than
  duplicated under two names.
- **`tests/pageparity.js` now covers both pages — 90 comparisons, all identical.** The RMX case
  was mutation-tested too: asking `AmrFuelExec` for the `'agg'` units fails two views, and
  making `pyY()` return the current year fails four comparisons including the by-month title.
  Its fixture deliberately carries `cyYear` and **no** `sask` section, so the two things this
  page does differently are actually exercised rather than assumed.

### What chunk 3 settled

- **The page needed no `§A4` block at all.** Not one rule in `Page_FuelSurcharge.html`'s
  style block turned out to be unique to it. `.shell{max-width:1480px}` was already §A3's
  default; `.previewCard`, `.dzstat`, `.mkt-list`, `.logoName`, the slide frame and all 21
  `.fsc-*` rules are shared with RMX Fuel Recovery and the deck. **71 rules went into §A3 and
  none into §A4.** That is the promotion test working, and it sets the bar for chunk 4: if
  RMX Fuel Recovery adds much to §A3, something was scoped that should have been promoted
  here.
- **`.seg` got a modifier rather than an override.** The rail's six-button view picker is the
  full-width form of the shared control, so §A3 carries `.seg.full` (`display:flex`, buttons
  `flex:1`, unpicked options muted) and the page writes `class="seg full"`. The alternative
  was four `body[data-page="…"]` rules undoing the component one property at a time, and a
  page-scoped block that spends its rules cancelling §A3 is the signal that the component is
  wrong, not that the page is special.
- **The Saskatchewan notice became a component.** It was a `<div style="…">` carrying six
  raw values inline in the JS. It is `.notice` / `.notice.bad` / `.notice-ttl` in §A3 now —
  the same words, the same place, no hex in a string.
- **A dead button, shipped and now fixed.** Both fuel pages put `class="ghost"` on the
  guide's *Use uploaded data* / *Back to sheet data* buttons. `.ghost` is the header-bar
  button: white text on a transparent background. Inside the guide's white aside that is
  white on white — the buttons work and cannot be read. They are `.lk full` in `app.html`.
  **`Page_RmxFuel.html:792` and `:794` have the same two, so chunk 4 inherits the fix.**
- **`AmrHint` was ported in chunk 2 without the handler that opens it.** `AmrHint.btn()`
  writes a `.amr-qm` button and `AmrHint.show()` fills the modal, but the delegated click
  listener that joins them stayed behind in `Shell.html`. Neither page in chunk 2 has a "?"
  button, so nothing noticed. §D has it now, wired in `start()` alongside the other
  delegations. **The lesson generalises: a component ported without a page that exercises it
  is not proven, even when it looks complete** — which is the same rule chunk 2 wrote down
  for modules, applied to §D.
- **`AmrCache` did NOT come across, and the plan was wrong to say it would.** Chunk 2's note
  says `AmrCache` / `AmrProgress` / `AmrBoot` all arrive here. `AmrProgress` and `AmrBoot` did;
  `AmrCache` has no caller on this page — `Page_FuelSurcharge.html` never calls
  `AmrCache.boot()`. It goes to **chunk 5**, with `Page_PriceVolume`, which does. `AmrFresh`
  came instead, because the header's ↻ *Update from source* calls `AmrFresh.ifChanged`.
- **`Code.gs` needed no change.** Chunk 2's `?page=app&view=` route already passes any view
  name straight through to `<body data-page>`, so a new page is a `<template>` plus a
  registration and nothing else. That holds for every remaining page chunk.
- **`tests/pageparity.js` is the gate this chunk actually rested on**, and it is the one
  PLAN.md §12 asked for. It boots the legacy page and `app.html`'s port of it side by side
  under jsdom, with `google.script.run` stubbed to hand both the same model, and diffs the
  DOM: **46 comparisons, all identical.** It does two jobs. It *diffs* what both sides render
  — the tables in all five views, the market list, the month picker, the auto-title — and it
  *asserts* the shared chrome the merged page provides differently and so cannot be diffed:
  the guide mounted with this page's steps and this page's own panel moved into it, the "?"
  hint opening the shared modal with this page's content, the page switcher knowing which
  page it is on, every former page global now a local, every module present. That second half
  is what caught the `AmrHint` bug above, and no diff ever would have — the button renders
  perfectly whether or not anything listens to it. Three things the harness itself learned:
  - **Two identically empty pages are a passing diff.** The first run compared clean because
    both sides had died in the same place. It now asserts each side rendered a `<table>` and
    the data notice *before* comparing them, and the fixture carries an unmatched
    Saskatchewan customer so a notice that stopped rendering cannot read as a match.
  - **It compares the `.card` inside `#tablesHost`, not the host.** The card is the payload
    and must be byte-identical; what sits beside it is chrome the merge is allowed to
    restyle, and it is compared as text so the words and numbers still have to match.
  - **jsdom fetches nothing, so `AMR.lib` never settles.** An injected `<script src>` for a
    CDN library gets no `onload`, the promise stays pending and `boot()` never runs. The
    harness stubs script injection to resolve immediately; nothing under test uses
    html2canvas or SheetJS at boot.
  It was mutation-tested three ways: renaming one summary column header fails two views,
  commenting out `applyView` fails eight comparisons, and putting the `AmrHint` bug back
  fails the two hint assertions by name.
- **`tests/modparity.js` is what makes the other harnesses count.** `regress.js` proves
  `Deck_Fuel.html`; `slidefit.js` drives `SlideExport.html`. Those proofs say nothing about
  the copy in `app.html` unless the copy is identical — so this checks that every §E module
  is byte-for-byte its source file, and every gate in `tests/` transfers for free. It
  normalises line endings on purpose: `Deck_Fuel.html` is CRLF, `Shell.html` and
  `SlideExport.html` are LF, and `app.html` is LF throughout by §12.
  **Delete it at chunk 13** — after the old files go there is no second copy, and
  `regress.js`, `pageparity.js`, `slidefit.js` and `deckpath.js` all have to be repointed at
  `app.html`.
- **`regress.js` needs staging and the README's recipe is right.** `OLD_DIR` wants the
  pre-extraction pages, which are commit `6400026` (the parent of `cc3adc9`, where
  `Deck_Fuel.html` was added):
  ```bash
  mkdir -p /tmp/old
  git show 6400026:Page_FuelSurcharge.html > /tmp/old/old_fsc.html
  git show 6400026:Page_RmxFuel.html       > /tmp/old/old_rfsc.html
  OLD_DIR=/tmp/old node tests/regress.js     # 12 comparisons, 0 failed
  ```
- **Three harnesses cannot run in this environment and it is not this chunk's doing.**
  `segboot.js` and `ovperiod.js` need Playwright, which is not installed; `pvcheck.js` needs
  its own `OLD_DIR` staging. None of the three reads `app.html`.

---

## 9. What this costs

Stated up front so nobody is surprised later:

- **`app.html` is ~1.13 MB, not the ~1.0 MB estimated in chunk 0.** Measured with all ten
  pages in after chunk 11 — 1,158,583 bytes. The estimate was low because it assumed the
  legacy sweep would take more than it has: the sweep is real (~720 lines of guide, ~1,225
  lines of dead includes, the id-styling collapse, four spinner keyframes down to one) but the
  pages themselves port close to one-for-one, and §E grew by three modules the original count
  did not include. **`app.gs` ~515 KB.** Both are far inside Apps Script's limits, but the
  script editor gets sluggish on files this size. That is the trade being made deliberately:
  slower to edit in the browser, trivial to move.
- **Every page load ships every page.** Today `?page=rmx` sends 96 KB; afterwards it sends the
  whole file. HtmlService gzips, so expect roughly 200 KB on the wire against ~25 KB now. The
  extra is markup the browser parses into inert fragments and CSS it discards on a `data-page`
  mismatch — not extra JS to run, since each page's code is one registration IIFE that only
  executes its body on mount. [§10](#10-four-things-this-merge-does-not-touch) removes this cost
  entirely if it ever stops being acceptable.
- **Two pages get faster.** Landing and the Inventory Report load no CDN libraries at all once
  `AmrLib` is lazy.

---

## 10. Four things this merge does not touch

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

**3. Caching the two fuel pages on the device.** Asked for during chunk 3, and it belongs
here rather than in chunk 3 or 4 for the usual reason: **neither fuel page has ever had a
device cache, so adding one is a new feature wearing a port's clothes.** If the merged page
then painted a stale figure, "the merge broke it" and "the new cache broke it" would look
identical — and the whole point of chunks 3 and 4 is that their output is provably the same
as the old pages'. Chunk 17.

What already exists, so nobody rebuilds it:

- **The server side is done.** `FSC_Backend.gs` and `RFSC_Backend.gs` cache their sheet read
  *and* their finished result (added 2026-08-17; `tests/fscheader.js` proves one sheet read
  serves two identical calls). Only the per-device layer is missing.
- **`AmrCache` is the mechanism, unchanged.** `boot()` asks `getDataVersion(page)`, wipes this
  page's `localStorage` entries if the version moved, then `get`/`set` serve the payload.
- **`AmrFresh` is already wired on both pages**, so a version that moves while the page is
  open already greys it out. A cache does not change that, and must not be built to.

What the chunk has to decide, and must not guess:

- **The uploaded-workbook path must never be cached.** Both pages can run on a file the user
  dropped in. That is session-only by design and is not what the sheet holds; `upOff()` is
  the boundary.
- **The month is part of the key.** Both pages send `{month}` with every read and the payload
  differs per month. A cache keyed on the page alone would serve July's figures for May.
- **A typed-over cell is not data.** `NUM_OV` / `TXT_OV` are the user's edits, and the month
  picker already clears them for exactly this reason. Restoring a cached model must not
  resurrect them.
- **`AmrCache` arrives in chunk 5** with Price & Volume, the first page that calls it. This
  chunk is the second caller, not the first — do not port the module here.

**4. `Deck_Styles` duplicating page CSS.** The deck photographs slide content built by the
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

- **`Page_Rmx.html`'s `include('Deck_RMX')`** *(chunk 6, done)*. The page calls nothing in
  `AmrRmxSlide`, and `Deck_RMX`'s only load-time side effect is registering the `rmx` adapter,
  which early-returns without `AmrDeckSource` — a file `Page_Rmx` does not include. 603 lines
  shipped on every Ready-Mix page load to do nothing. The module stays; the Deck Builder needs it.
- **`Page_Rmx.html`'s `include('Cube')`** *(chunk 6, done)*. Found while porting: the page's
  only mention of "cube" was the include line, and `Cube.html` has no auto-init — each page
  must call `AmrCube.configure({…}).init()` itself. Another 622 lines. Both removals are
  covered by `tests/pageparity.js`, which boots the legacy page and would break if either
  had been live.
- **Six of the seven QlikView guide copies** *(chunk 2)*. ~720 lines.
- **The six debug functions** *(chunk 12)* — see [§7](#7-logging-and-the-debug-functions-it-replaces).
- **`Page_PriceVolume`'s `var AMR` and `CONFIG.colors.palette`** *(chunk 5, done)*. One
  occurrence of `AMR` in the whole repo — its own declaration — and the palette fed nothing
  else. It also shadowed the runtime; `merge.js`'s no-shadow check now guards that.
- **`Page_PriceVolume`'s `syncKpiName()`** *(chunk 5, done)*. No caller, and the `#kpiName`
  input it wrote to exists in no file.
- **`AmrKpiStore` in `Shell.html`** *(confirmed dead in chunk 10; delete at chunk 13)*.
  Every page is ported now, so there is nothing left that could claim it. **Zero callers anywhere** —
  grepped every `.html` and `.gs`; the only other hits are two comments. Client-side modules
  are the one place grep IS conclusive (§11's box: no dynamic dispatch, and a browser module
  cannot be reached by a trigger or the Run menu). It was deliberately NOT ported in chunk 5.
  If no page chunk claims it by chunk 13, it goes.
- **`AmrTick` in `Shell.html`** *(decided in chunk 8: KEEP, ports in chunk 10)*. The Overview
  was the page left to check and it has **zero** references. Its real callers are
  `Page_DeckBuilder.html`'s `dbSoon` and `SlideExport.html`'s capture settle, so it comes
  across with the Deck Builder; `tests/bgrender.js` and `tests/deckstatic.js` are the gates.
  §E's `AmrSlide` already degrades to `requestAnimationFrame` without it, which is why no
  ported page has missed it.

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
  available off-platform that a page still renders what it rendered. Three of them are about
  `app.html` itself, and all three now exist:
  - `tests/merge.js` *(chunk 2)* — every id a page's JS references exists in that page's
    `<template>`; every page CSS block is scoped; no page IIFE leaks a global.
  - `tests/pageparity.js` *(chunk 3)* — old page against new page under jsdom with
    `google.script.run` stubbed, DOM diffed. **Add your page's case to it before you touch
    the page**, so you find out on the first run rather than the last.
  - `tests/modparity.js` *(chunk 3, retires at chunk 13)* — every §E module is byte-for-byte
    the file it came from, which is what makes `regress.js`, `slidefit.js`, `pvcheck.js` and
    `deckpath.js` cover `app.html` too.
  - `tests/ovperiod.js` *(pointed at `app.html` in chunk 8)* and `tests/bgrender.js`
    *(chunk 10)* — the two harnesses that drive `app.html` through a real browser. Each runs
    the same fixture and the same checks against the legacy page and against `app.html`,
    labelling every failure with the side it happened on, so "both broke" and "the port
    broke" cannot be confused. `bgrender` also checks the deck source registry, which is the
    only way to catch a §E ordering mistake. Their legacy sides go at chunk 13 with the files
    they read.
- **Install the harness dependencies once, together.** `npm install playwright chart.js jsdom`
  — Chromium is already at `/opt/pw-browsers`. Five harnesses were being reported as
  "unavailable" for two chunks because nobody had run that line.
- **A harness that has never failed has not been tested.** Both gates written so far were
  mutation-tested before being trusted — unscoping one rule for `merge.js`, renaming a column
  header and disabling a click handler for `pageparity.js`. `pageparity.js` passed clean on
  its first run for the wrong reason (both sides had died identically), which is exactly the
  bug this rule exists to catch.
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
