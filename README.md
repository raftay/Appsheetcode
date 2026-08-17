# Amrize Commercial Suite

A single Google Apps Script web app serving Central Canada commercial reporting for
Aggregates (AGG) and Ready-Mix Concrete (RMX). It reads QlikView exports that have been
landed into Google Sheets and renders interactive dashboards, editable executive tables,
and slide-ready PNG exports.

This repository is a flat mirror of the Apps Script project. Every `.gs` and `.html` file
here is one file in the script editor — there are no folders, no build step, and no
package manager. Push the contents of this repo into the Apps Script project (or paste
file by file) and it runs.

---

## Contents

0. [Working on this repo](#working-on-this-repo--read-first)
1. [How it runs](#1-how-it-runs)
2. [Pages and routes](#2-pages-and-routes)
3. [File map](#3-file-map)
4. [Shared runtime](#4-shared-runtime)
5. [Data sources and configuration](#5-data-sources-and-configuration)
6. [Caching model](#6-caching-model)
7. [Domain rules that must not drift](#7-domain-rules-that-must-not-drift)
8. [Next major project — Deck Builder](#8-next-major-project--deck-builder)
9. [The Great Merge — one app.html, one app.gs](#9-the-great-merge--one-apphtml-one-appgs)
10. [Working conventions](#10-working-conventions)
11. [Session log](#11-session-log)

---

## Working on this repo — read first

**Branch when the work is big enough to want one; commit straight to `main` when it is
not.** Small fixes go to `main` directly — a PR on a one-line change is a review step nobody
is waiting on. Anything that spans several files or several sessions gets a branch, so it can
be reviewed in pieces and abandoned cheaply if it goes wrong. The merge in [§9](#9-the-great-merge--one-apphtml-one-appgs)
is on `claude/merging-files-plan-5qmmak` for exactly that reason.

Two things that will bite you if you skip them:

- **Do not flip a file's line endings.** The repo is mixed: most `.html` files are CRLF,
  some `.gs` files are LF. Scripted edits must open with `newline=''` and write back the
  endings the file already had, or a two-line change shows up as a whole-file diff.
- **Run the harnesses in `tests/` before and after touching a report page.** They are the
  only way to prove an extraction did not change what a page renders — see `tests/README.md`.

---

## 1. How it runs

**Not bound to a spreadsheet.** The project is a standalone script. Each page opens its
own Google Sheet by ID, resolved at call time through `APP_openSpreadsheet_(page)` in
`Config.gs`. IDs are set in code and can be overridden per page at runtime from the ⚙
Settings modal (stored in Script Properties, so an override is shared by everyone).

**One deployment, many pages.** `doGet(e)` in `Code.gs` maps `?page=` to an HTML file and
renders it through `HtmlService.createTemplateFromFile`, injecting `appUrl` so pages can
link to each other without hard-coding the deployment URL.

**Two deployments exist.** The main one executes as the owner. `?page=tp01` is served from
a second deployment set to *Execute as: User accessing the web app*, so outgoing mail is
sent as the person using the tool and each person keeps their own recipient list in User
Properties. The Deck Builder will need the same execute-as-user deployment, so generated
decks belong to whoever pressed the button.

**Scopes in use:** Sheets, Drive (KPI workbook folder, QlikView export folders, inventory
PDF), Gmail (TP01 only). Slides will be added for the Deck Builder.

---

## 2. Pages and routes

| `?page=` | HTML file | Backend | Reads from |
|---|---|---|---|
| *(none)* | `Landing.html` | — | — |
| `overview` | `Page_Overview.html` | `Ov_Backend.gs` | no sheet of its own — reuses PV / RMX / Segment + history books |
| `pricevolume` | `Page_PriceVolume.html` | `PV_Backend.gs`, `PV_Lookup.gs` | `PAGES.pricevolume` |
| `rmx` | `Page_Rmx.html` | `RMX_Backend.gs`, `RMX_Suggest.gs` | `PAGES.rmx` |
| `segment` | `Page_Segment.html` | `RMX_Backend.gs` (`RMX_getSlideTables`) | `PAGES.rmx` |
| `fuelsurcharge` | `Page_FuelSurcharge.html` | `FSC_Backend.gs`, `Sask_Backend.gs` | `PAGES.pricevolume` + `PAGES.saskrates` |
| `rmxfuel` | `Page_RmxFuel.html` | `RFSC_Backend.gs` | `PAGES.rmx` |
| `tp01` | `Page_TP01.html` | `TP01_Backend.gs` | `PAGES.pricevolume` |
| `inventoryreport` | `Page_InventoryReport.html` | `IR_Backend.gs` | a Drive PDF (file ID in Script Properties) |
| `deckbuilder` | `Page_DeckBuilder.html` | `Deck_Backend.gs`, `Deck_Recipe.gs` | the other pages |

> The Deck Builder runs, and 23 of the 43 recipe rows build end to end (Fuel Recovery, AGG
> Price & Volume, Top 10 Customers). The `seg` and `rmx` adapters are Phase 4. See
> [§8](#8-next-major-project--deck-builder).

Three pages have **no sheet of their own** and read another page's: `fuelsurcharge` reads
Price & Volume (`readsFrom: 'pricevolume'`), `rmxfuel` reads the Ready-Mix workbook, and
`segment` reads the Ready-Mix workbook too. `APP_EXTRA_SOURCES` in `Config.gs` is what
makes those borrowed sheets appear and be editable in each page's ⚙ panel.

---

## 3. File map

### Server (`.gs`) — one shared global namespace

Apps Script evaluates every `.gs` file into **one** global scope; the last writer wins.
Entry points are therefore uniquely prefixed (`RMX_`, `PV`, `DECK_`, `TP_`, `IR`) and
namespace objects are captured at evaluation time.

| File | Role |
|---|---|
| `Code.gs` | Router (`doGet`), `include()`, `getLogo()`, data-generation helpers, chunked cache helpers, `syncAll()`, and the `SB` Slide-Builder sheet reader |
| `Config.gs` | `APP_CONFIG` — every sheet ID, tab name, market list, cube constants — plus the Settings API |
| `PV_Backend.gs` | AGG Price & Volume aggregation |
| `PV_Lookup.gs` | REGION LOOKUP mapping-check for Price & Volume |
| `RMX_Backend.gs` | Ready-Mix PPI/ASP engine; also serves the Segment page via `RMX_getSlideTables`. **`RMX_prepare` is the one pull** — see [§6](#6-caching-model) |
| `RMX_Suggest.gs` | Lookup-miss suggestions (PRODUCT MASTER / CUSTOM FLAG / EXTRAS), three independent models |
| `Ov_Backend.gs` | Executive Overview aggregator + the closed-year history cube |
| `FSC_Backend.gs` | AGG fuel recovery |
| `RFSC_Backend.gs` | RMX fuel recovery |
| `Sask_Backend.gs` | Saskatchewan per-customer mid-year price increase (read + name matching only) |
| `Kpi_Backend.gs` | Shared EBITDA KPI workbook values in a Drive folder |
| `QlikSync.gs` | Pulls QlikView exports out of Drive and replaces sheet tabs; scheduled triggers |
| `TP01_Backend.gs` | Transfer Price — per-market email send, recipients in User Properties |
| `IR_Backend.gs` | Inventory Report — stores/derives a Drive PDF file ID (never touches DriveApp) |
| `Deck_Backend.gs` | Deck Builder server plumbing: template geometry, create/addSlide/finish/status, validator. See §8 |
| `Deck_Recipe.gs` | **Config, not code** — which 43 slides the deck contains, in order, plus `DECK_getRecipe()` which checks them |

### Client (`.html`)

Shared partials, pulled in with `<?!= include('Name') ?>`:

| File | Role |
|---|---|
| `Styles.html` | The one stylesheet — Amrize colour tokens (navy `#011E6A`), reset, every shared component. Goes in `<head>` |
| `Shell.html` | Shared runtime: page switcher (`AMR_PAGES`), Help modal, ⚙ Settings modal, `AmrCache`, `AmrProgress`, `AmrBoot` |
| `SlideExport.html` | `AmrSlide` — the 1600×900 slide frame, whitespace sliders, full-window viewer, html2canvas PNG export, and `captureBare` for the deck |
| `KpiShared.html` | `AmrKpi` — upload/parse/share the EBITDA workbooks; used by three pages |
| `Cube.html` | `AmrCube` — the month fact table in typed arrays, backed by IndexedDB |
| `Deck_Sources.html` | `AmrDeckSource` — the content-source registry the Deck Builder asks for tables. Included **only** by the Deck Builder |
| `Deck_Styles.html` | The slide CSS the deck's captures need — a mirror of the slide rules in each report page's own style block, every selector scoped under `.slide-bare`. Included **only** by the Deck Builder. See [§8](#the-css-the-deck-could-not-see) |
| `Deck_Fuel.html` | `AmrFuelExec` — the Fuel Recovery exec tables, shared by **both** fuel pages and the deck. Also holds the `fsc` / `rfsc` adapters |
| `Deck_SEG.html` | `AmrSegSlide` — RMX Product Segment slide content; holds the `seg` adapter |
| `Deck_RMX.html` | `AmrRmxSlide` — RMX Price & Volume slide content and the `rmx` adapter. **Inert on `Page_Rmx`**: the page includes it but calls nothing in it, and the adapter registration is a no-op without `AmrDeckSource` (which only the Deck Builder includes). Flagged for the legacy sweep — see [§9.10](#911-rules-for-whoever-does-the-work) |
| `Deck_PV.html` | `AmrPvSlide` — the AGG Price & Volume slide content (KPI strip, dimension tables, waterfall charts) and the customer block. Shared by the PV page and the deck; holds the `pv` / `cust` adapters |

Page files: `Landing.html`, `Page_Overview.html`, `Page_PriceVolume.html`, `Page_Rmx.html`,
`Page_Segment.html`, `Page_FuelSurcharge.html`, `Page_RmxFuel.html`, `Page_TP01.html`,
`Page_InventoryReport.html`. `Page_Overview.html` is by far the largest, at roughly a
quarter of all the client code.

> **Line counts are deliberately not recorded here.** They were, and every one of the 34 had
> drifted — the file map claimed `Shell.html` was 781 lines when it was 1037. A number that
> is wrong is worse than no number. Run `wc -l` if you need one.

Third-party libraries are loaded from CDN per page: Chart.js, SheetJS (XLSX),
html2canvas.

---

## 4. Shared runtime

Everything below lives in `Shell.html` unless noted.

- **`AMR_PAGES`** — the page-switcher list. Adding a page means one line here, one line in
  `doGet`, and (optionally) a card in `Landing.html`.
- **`AmrCache`** — device-level report cache in `localStorage`, keyed by a data-generation
  token. No expiry: entries stay valid until the token moves.
- **There is no `AmrQlik`.** Earlier revisions of this README documented one — "the per-page
  ⇣ *Pull from QlikView* button, wired to `QlikSync.gs`". No such object exists in any client
  file, no such button exists on any page, and none of `QlikSync.gs`'s four entry points
  (`qlikSyncCheck`, `qlikMarkCurrent`, `qlikStamps`, `qlikSyncNow`) is called from any `.html`.
  **The sync is trigger-driven only.** What every page *does* carry is the ⇣ *Update from
  source* button, which is a different thing: it calls `updateFromSource()` in `Code.gs` and
  only re-checks the data version.
- **`AmrProgress`** — the shared progress pill.
- **The Region memory is keyed by VIEW, in one place.** `pvKpiViewMap` in `localStorage`,
  key = `MARKET:<market>` plus `:<refine>` when there is one. Southwest, Southwest·Land and
  Southwest·Docks are three views of one market and each remembers its own region sheet; the
  **period is deliberately not in the key**, so a view's MTD and YTD slides move together —
  they read the same sheet in two places on it. `Page_PriceVolume.kpiViewKey` and
  `Deck_PV.kpiViewKeyFor` must agree, or the deck reads a different slot from the one the
  report page wrote. A view with nothing remembered falls back to its market's slot before
  the first sheet on the list. Nothing may pin `spec.kpiSheet` over this map: a pin outranks
  it and goes stale the moment the twin row is changed instead.
- **`AmrTick`** — a timer a background tab cannot stop. `AmrTick(ms, fn)` is `setTimeout`
  with the sleep done inside a one-line **Worker**, because a main-thread timer is clamped to
  once a second in a hidden tab and to once a **minute** after five minutes of it.
  `AmrTick.frames(fn)` is "after a frame or two" that still resolves when there are no
  frames — `requestAnimationFrame` does not fire **at all** in a hidden tab, which is what
  used to stop the Deck Builder dead on whatever slide it was rendering when somebody
  clicked away. Both degrade to plain timers where a Worker cannot be created. Anything that
  waits before photographing the DOM, or paces a long job, uses these rather than the
  browser's own.
- **`AmrKpi`** (`KpiShared.html`) — the two EBITDA workbooks, plus the on-page KPI strip:
  `stripHtml(cards)` builds it, `fitStrip(row)` sizes it to the width it has, `stripPng`
  photographs it from an off-screen clone for *Download KPI PNG*.
- **`AmrCube`** (`Cube.html`) — the browser-side month fact table. Reads its column layout
  from the server's manifest (`man.dims` / `man.vals`), never hardcoded. Persisted to
  **IndexedDB**, not `localStorage` — the cube is a few MB and `localStorage` stores UTF-16,
  so a 5 MB payload occupies ~10 MB and gets evicted.
- **`AmrSlide`** (`SlideExport.html`) — builds a fixed 1600×900 slide off-screen: a header
  with title/subtitle/logo, then the page's content node inside four adjustable blank
  bands (left/right default 120px, top/bottom 30px). `previewInto` renders a scaled live
  preview, `viewSlide` shows it full-window, `exportSlide` captures to PNG with
  html2canvas.

  `captureBare` waits for the layout to settle through `AmrTick.frames`, never on
  `requestAnimationFrame` alone — see `AmrTick` above; `tests/bgrender.js` is the gate.

  Content that overflows is scaled down by a `transform` on `.slide-center`, measured on
  `scrollHeight`. A page's own `fit(box)` callback must therefore fit by **layout**
  (font-size), never by transform — a transform doesn't change `scrollHeight`, so the
  content would be scaled twice.

**Boot order matters.** `APP_URL` must live in its own isolated `<script>` tag *before*
the includes. Because `Shell.html` (which defines `AmrCache`) is included *after* a page's
main script, page boot must be deferred to `DOMContentLoaded`. `loadData()` must be called
unconditionally, outside any `try`/`catch`.

---

## 5. Data sources and configuration

### Where the data comes from

QlikView exports (`.xlsx`) land in two Drive folders. `QlikSync.gs` opens **every** Excel
file in the folder and identifies it by its contents, not its filename — re-exporting under
a different name changes nothing. It writes into:

- **Price & Volume workbook** — `Combined Data CPI Raw`, `Combined Data CPI Other Revenue`,
  plus the typed `REGION LOOKUP` and `TOPLINE REV LOOKUP2` tabs.
- **Ready-Mix workbook** — `Main Raw Data`, `Extra Raw Data`, `Associate Raw Data`, plus
  the `PLANT LOOKUP`, `PRODUCT MASTER`, `EXTRAS LOOKUP`, `CUSTOM FLAG LOOKUP` tabs.
- **Slide Builder workbook** — `Slide Segment MTD` / `Slide Segment YTD` and
  `Slide Product <Market> MTD` / `YTD`, all pre-aggregated by QlikView.

Alongside those: the EBITDA KPI workbooks in a shared Drive folder
(`APP_CONFIG.KPI_FOLDER_ID`), the Saskatchewan rates sheet, the inventory PDF, and the
optional closed-year history books (`histagg`, `histrmx`, `histagg2`, `histrmx2`).

### The data version is the sheet's modified time

There is no cache counter to bump. `APP_getGen_(page)` is the **last-modified time of the
workbook that page reads**, plus the code build stamp. Drive already tracks exactly what we
mean, so the version moves when — and only when — the data actually changed:

- QlikSync writes the raw tabs → moved.
- Somebody types a row into `REGION LOOKUP`, or fixes a number by hand → moved. Nothing has
  to be told; nobody has to remember to press anything.
- Nothing happened → identical, and every cached table stays valid.

The Drive lookup is cached for 30 seconds, so the pages' freshness check is cheap to run
often. `APP_bumpGen_` / `bumpGeneration_` / `syncAll()` all still exist because a dozen call
sites use them after writing to a sheet — they no longer bump anything, they just drop that
30-second copy so the next read sees the new time. `PV_Backend` and `RMX_Backend` read the
same stamp instead of their old `pv_cache_gen` / `cache_gen` counters.

### Syncing: one trigger, and nothing else

There is no ⇣ pull button. Set **one** time-driven trigger on `qlikSyncCheck`, at whatever
interval suits — 15 minutes costs three Drive lookups when nothing has changed.

The three exports are named by **file id** in `APP_CONFIG.QLIK_SYNC`, one per page:

| file id | export | feeds |
|---|---|---|
| `AGG_FILE_ID` | Aggregates Margin Monitor | Price & Volume |
| `RMX_FILE_ID` | CAN RMX Margin Monitor | Ready-Mix (main / extra / assoc) |
| `SEG_FILE_ID` | Segment + Product | Slide Builder |

Every firing compares each file's modified time with the one it last synced. Files that
haven't moved are skipped entirely, and each is checked on its own — a re-exported
Aggregates file costs an Aggregates sync and nothing else. An ordinary firing is three Drive
lookups.

**Run `qlikMarkCurrent()` once after setting the trigger up.** Without it the first firing has
nothing to compare, treats all three exports as new, and syncs every one of them — minutes of
work replacing data the sheet very likely already has. Harmless, just slow and pointless.

`qlikStamps()` shows what the next check will compare and what it will do.

**The retry rule.** A run that could not happen at all — file unreadable, another sync holding
the lock — keeps no stamp and is tried again next firing. A run that *finished* but wrote a
bad tab keeps its stamp and logs the failure: that tab will be just as broken next time, and
re-syncing forever neither fixes it nor tells anybody.

### What the user sees

`AmrFresh` in `Shell.html` asks every 5 minutes whether the version is still the one the page
loaded with. When it isn't, the page greys out and offers one button that reloads it.

**↻ Update from source** asks before it acts, on every page that has the button — Price &
Volume, Ready-Mix, Segment, the Overview and both Fuel Recovery pages. If nothing behind the
page has been touched it says *Already up to date* and throws nothing away; pressing it on an
unchanged sheet used to make every user rebuild every table for nothing. The Deck Builder has
no such button on purpose: it runs the same check inside Render, every time (below).

**On the Deck Builder the check has more to clear.** Render does not re-read the sheets and never
had to — every backend cache key is prefixed with the source workbook's modified time, so a
sync strands the old entries by itself and the next Render picks up the new figures. What
Render *does* reuse for the life of the page is what the **adapters** already fetched; that
is the whole point of `prepare()` being cheap the second time. So a sheet that changes while
the tab is open is invisible there, and pressing Render again will not do it either — a row
that already has a picture is skipped. So it clears every adapter through
`AmrDeckSource.resetAll()` and drops the rendered pictures, because they were photographed
from figures that are now the old ones — the same reasoning as changing the report month.

**And there is no button for it — it is the first half of Render.** The stages stay Plan →
Render → Publish, and Render opens with the check every time. A deck built from figures the
sheet replaced an hour ago is the one failure this page cannot show you: every slide builds,
nothing goes red, and the pack is quietly last week's. A step that must never be skipped does
not belong behind a button somebody has to remember, and a button that Render then repeats is
one more thing to explain. The check costs one ask for the workbooks' modified time — the
same number the caches are already keyed on — so when nothing has moved it says nothing,
throws nothing away and renders exactly as before (`dbSourceCheck`).

**The Region dropdown is answerable before any of that.** It lists the KPI workbook's region
sheets, and that workbook was only ever fetched by `prepare()` — which runs during a render.
So every row read *no workbook* until the first render had already happened, including rows
whose workbook was uploaded, and the region could only be corrected after paying for a render
that used the wrong one. Precisely backwards. The source contract grew `warm()`: load what the
Deck Builder needs to DESCRIBE a row, called once after Plan via `AmrDeckSource.warmAll()`.
Per-row data stays in `prepare()`.

**One trap worth knowing if you call `AmrFresh.ifChanged` from a new page.** It raises the
shell's full-screen `sync` job but only calls `AmrProgress.done` on the *nothing changed*
path — every other caller had been a report page that goes straight into its own rebuild and
owns the screen from there. A page that just prints a banner and stops has to call
`AmrProgress.clear('sync')` itself, on every path including failure, or the overlay sits
there saying *Checking the sheet…* over a page that finished seconds ago. Pinned by
`tests/deckstatic.js`.

A page's version covers **every workbook its figures depend on**, not just its own: the
Overview reads Price & Volume, Ready-Mix and Segment, so its version moves when any of the
three does. That comes from `APP_EXTRA_SOURCES` in `Config.gs`, which already listed exactly
that. Without it a page with no sheet of its own would report a version that never moved and
sit on stale figures with the button insisting there was nothing to do. The Deck Builder is
the same case and is listed there too — its five sources reduce to four workbooks
(`pricevolume`, `rmx`, `segment`, `saskrates`).

**ONE loading screen, up until everything is ready.** `AmrBoot` (`Shell.html`) is a
refcount over a single `AmrProgress` job. A page names what has to be true before it is worth
looking at — `AmrBoot.need('data')`, `need('month history')` — and answers each with
`AmrBoot.done(...)`; the screen goes up on the first `need()`, paints immediately (the page
behind it is empty), and comes down exactly once, when the **last** step lands. After that
boot is over and `need()` is ignored, so nothing can re-raise the opening screen.

Two rules came with it, and both were bugs before:

- **`AmrProgress` waits out a grace period (400 ms) before painting.** A screen that appears
  and disappears inside half a second is worse than no screen — it reads as the page
  stuttering. Jobs are registered immediately but only painted if they outlive the grace, so
  anything quick shows nothing at all. `{ now:true }` and any failure paint at once.
- **`AmrProgress.done()` is banned on report pages.** It flashes a tick for 1.2 s and is then
  replaced by whatever goes up next, which *is* the flicker. Clear the job instead.
  `tests/deckstatic.js` fails on a `done()` or on a page that opens without naming its boot
  steps; `tests/segboot.js` drives the real thing in a browser.

The failure mode of a refcount is a step that never reports, and its symptom is the worst one
available: a loading screen over a finished page, forever. So `AmrBoot` has a watchdog that
names what it is still waiting for. If you ever see that message, some path forgot its
`done()`.

**Loading is full-screen.** `AmrProgress` was a small pill in the corner, which was easy to
miss — people read half-loaded tables without realising. Same API (`set` / `done` / `fail` /
`clear` / `detail`), different chrome. The consequence worth knowing: work that used to run
quietly in the background now covers the page while it runs.

### `APP_CONFIG.PAGES` keys

`pricevolume`, `rmx`, `segment`, `saskrates`, `fuelsurcharge` (no sheet — `readsFrom:
'pricevolume'`), `histagg`, `histrmx`, and the one-book-back variants. Pages not listed
(`overview`, `rmxfuel`, `tp01`, `inventoryreport`, `deckbuilder`) have no sheet of their
own; `APP_EXTRA_SOURCES` gives their ⚙ panel the sheets they actually depend on.

`APP_requirePage_` deliberately **fails loudly** on an unknown page id rather than
defaulting — a blank id used to make RMX silently open the Price & Volume sheet.

### The Slide Segment tabs still matter

`Page_Segment.html` no longer reads them: it calls `RMX_getSlideTables` and computes from
the Ready-Mix raw tabs. But `getSlideData()` in `Code.gs` — which reads
`Slide Segment MTD/YTD` and the per-market `Slide Product` tabs — is **still live**, called
by `Ov_Backend.gs` for the Overview's segment and product-category panels. Do not delete
`SB`, `getSlideData`, or `APP_CONFIG.PAGES.segment.SHEETS` on the assumption they're dead.

### Markets

Canonical names differ per page. The set is: North, Saskatchewan, Manitoba, Southwest
(`HNS_SW`), GTA Agg / Innocon. **Central Canada is an all-markets rollup with no sheet tab
of its own** — it is merged browser-side. `APP_CONFIG.PAGES.segment.MARKETS` lists only the
markets that have a product tab, which is why Central Canada is deliberately absent.

---

## 6. Caching model

Four layers, each with a different job:

| Layer | Where | Notes |
|---|---|---|
| `APP_cachePut_` / `APP_cacheGet_` | Apps Script `CacheService` | chunked at 90 KB, max 250 chunks, 6 h TTL. Silently skips payloads it can't fit |
| `cachePutBig_` | `CacheService` | the chunked writer for large payloads — **required** for customer reports and raw tab caches |
| `AmrCache` | `localStorage` | device-level report cache, no expiry, keyed by generation token. **Caps near 900 KB per entry** — write one market at a time, never a whole set |
| `AmrCube` / `AmrKpiStore` | IndexedDB | multi-MB cube data |

**Invalidation is by generation token, never by deletion.** Every server *and* browser
cache key embeds a version string. Bumping the number strands every old copy on every
device at once, with nothing to enumerate.

```js
APP_GEN_PROPS = { pricevolume:'pv_cache_gen', rmx:'cache_gen',
                  segment:'sb_cache_gen', kpi:'kpi_cache_gen' }
APP_CODE_BUILD = '2026-08-11a'
```

Two separate things move that token:

- **Data changes** — pressing *Update from source* / `syncAll()` bumps the stored
  generation number.
- **Code changes** — `APP_CODE_BUILD` is folded into every token. **Bump it whenever
  backend logic changes.** Without it, a code fix leaves the data generation untouched,
  every device keeps serving figures the *old* code computed, and the fix looks like it did
  nothing.

`getDataVersions(pages)` returns several pages' tokens in one round trip — the Overview
needs three, and Apps Script runs one user's calls end to end, so three separate calls cost
most of a second of dead time before the page starts loading.

**The bundle is 14 MB — 160 cache chunks. Never read it to answer one question.**
This is the single most expensive mistake in the suite's history, and it hid for a long time
because nothing about it looks wrong. `loadDataCached_()` caches the whole Ready-Mix dataset
as one object, which is right: it is what stops forty thousand rows being pulled out of
Sheets again. But `getKeys`, `getExtras`, `getSlideTables`, `getUnmapped` and `getMarkets`
all *opened* with it, so a request that produces a **72 KB** answer moved **14 MB** through
`CacheService` to do it — and did it again for the next market, and again for the other
period. The execution log showed a flat 15–24 s per call whatever was being asked for, which
is the tell: the cost did not vary with the question because it was not the question.

The grouping was never the cost. `tests/rmxcost.js` times it at **0.3 s for all twelve
market × period selections**. And it is precisely why Aggregates has always felt instant next
to Ready-Mix: `PV.getReport` returns its cached report *before* it touches the pivot.

**`RMX_prepare` is the one pull.** One execution, one bundle read, every selection computed
and cached under the key its own reader looks in — then every page call is a 1–5 chunk read.
It changes no arithmetic: the compute functions are called with exactly the arguments the
individual entry points pass them, and the harness compares every warmed payload
byte-for-byte against the single-call result. Two rules came out of it:

- **`selKey_()` is the only place a per-selection cache key is built.** Two copies of a cache
  key is how you ship a warm pass that writes where nothing reads: every check passes, the
  log looks healthy, and every request still recomputes.
- **A client-side warm loop is not the answer to a slow call.** Both pages used to fetch
  every market × period in the background. That is twelve of the expensive read, serially —
  and because Apps Script runs one user's `google.script.run` calls end to end, they queue in
  front of whatever the user does next. Warm on the server, in one execution, or not at all.

**Ship every market to the browser, not one per click.** Warming the *server* cache is only
half the job: the page still pays a round trip per market, which is what "pick GTA and it
loads again" was. Aggregates never did that — its opening call carries every market, so
switching is instant. `RMX_prepare` returns `payloads`, the same finished objects it just
cached, keyed `<kind>|<market>|<period>`; both Ready-Mix pages seed their in-memory caches
from it and a market switch costs **zero** server calls. `tests/segboot.js` fails on one.
Seed under **both** the resolved month and whatever the picker is on — the RMX month picker
opens on "Last closed month", whose value is `0`, so seeding only the resolved month files
every payload under a name nothing ever looks up.

**Cache the ANSWER, not just the ingredients.** Every Ready-Mix page computes from
`loadDataCached_()` — the whole dataset as one cached object. Caching that is right: it is
what stops forty thousand rows being pulled out of Sheets again. But for a long time it was
the *only* thing cached on that side, so every `getKeys` / `getExtras` / `getSlideTables`
call — including one for a market somebody had looked at a minute earlier — paid for the
chunked `CacheService` read, a `JSON.parse` of several megabytes, and `keyRows_` /
`ppiMaps_` / `plantRows_` over every row of it. The Aggregates side has never done that:
`PV.getReport` caches the FINISHED report for the exact selection and returns it before it
touches the pivot, which is most of why Price & Volume feels instant next to Ready-Mix.
Those three now do the same through `selCached_`, keyed on market + period + month.
`getCrossReport` already did. **Uploads are never cached this way** — "run on my own
QlikView files" is one user's session, and its payloads must not be handed to anybody else.

**Known ceilings:** `cachePut_` silently bails above ~900 KB (customer reports exceed this
— that is why `getCustomerReport` uses `cachePutBig_` while `getReport` still uses
`cachePut_`). `CacheService` drops payloads beyond ~22.5 MB. Script Properties cap at
500 KB and hold generation tokens only.

---

## 7. Domain rules that must not drift

These are hard-won and expensive to rediscover. Changing any of them changes numbers the
business reconciles against Qlik.

### Reading Google Sheets

- **Always use `getDisplayValues()` for Bill Month.** Sheets parses `JUL-26` into a Date
  object; only `getDisplayValues()` returns the literal string.
- **Year determination for CY/PY:** scan header names for a `####` pattern; larger = CY,
  smaller = PY. No code change needed at year rollover.
- **Never trust history headers.** The AGG history export reuses the live template, so
  headers can read `2026 Volume` over actual 2025 data. Read the Year column.
- **Duplicate column names** require first-unused matching.
- **Bill Month spelling is inconsistent** in QlikView (`Jul-26` vs `July-26`) and breaks
  SUMIFS joins.
- **Bill Month has two header spellings.** QlikView exports `bill_month`; the sheet header
  reads `Bill Month`. No `norm_` in this codebase folds underscores, so both spellings are
  listed explicitly wherever the column is resolved (`MONTH_COLS_` in `RMX_Backend.gs`,
  `MONTH_NAMES_` in `RFSC_Backend.gs`, `SYNONYM` in `QlikSync.gs`, `ovcHistRmx_` in
  `Ov_Backend.gs`).
- **Bill Month splits each month across two rows** — `Jul-25` carries the prior-year
  columns, `Jul-26` the current-year ones, with the off-year columns blank. Everything
  downstream must therefore **sum into its bucket before taking any ratio**. It already
  does: ASP, the PPI `covered_()` floors and the PPI weight are all computed on summed
  plant × mix buckets, never on a single row. Any new per-row ratio would be a bug.

### The reporting month

Always **last calendar month** (current month − 1), computed from the clock — never derived
from the data. The export carries every month of the *prior* year (`Dec-25` sitting against
nothing this year), so a maximum-based scan always returns December. `latestMonth_` in
`QlikSync.gs` takes the newest value literally and is **not** capped — a Bill Month names its
own year, and the closed-year history workbooks legitimately end in December. That stamp
(`QLIK_REPORT_MONTH`) is informational only; the pages compute the month from the calendar.

Pre-aggregated tabs (Slide Segment, Slide Product) have **no month column at all** and
cannot be re-sliced — whatever month the export was run for, both tabs are for that month.

### RMX PPI

- PPI uses **plant × mix grain** (Qlik's `aggr(..., %plant, %material)`) — context-dependent
  per table row, not a static precomputed pivot key.
- The ±50% ASP% coverage cap and `COVERAGE_CAP` were **removed** to match Qlik.
- The `#N/A` merge toggle moves labels only, never PPI numbers.
- Group PPIs do **not** weight-average back to Total. This matches Qlik; it is not a bug.
- Coverage floors come from `APP_CONFIG.CUBE.COVERAGE.rmx` (`pyVol > 1`, `cyVol > 1`,
  `pyRev > 110`, `cyRev > 110`) — Qlik's actual floors, kept in config to prevent drift.

### Fuel recovery

- **AGG**: read from the Price & Volume sheet's `Combined Data CPI Raw`, where the surcharge
  sits on the same row as the volume it was charged on. The old pre-summed Fuel Recovery
  workbook forced applied tonnes to be inferred from a bucket, and they came out too high.
  That workbook is **retired**: `PAGES.fuelsurcharge.readsFrom` is now enforced by
  `APP_sheetOwner_`, so a leftover `DATA_SPREADSHEET_ID__fuelsurcharge` override can neither
  be read nor shown in the ⚙ panel. `clearRetiredOverrides()` deletes the stale property.
- **The header row on `Combined Data CPI Raw` is row 2, not row 1** — the tab sums *above*
  its column names. `FSC_Backend.gs` scores the first rows and takes the best
  (`headerRow_`), the same trick as `PV_Backend.tabHeaderRow_`. Reading row 1 blindly is
  what produced "missing these column(s): Plant, Year, Month, "#### Volume", New Fuel
  Surcharge" — five columns lost at once is always a misplaced header, never five renames.
  Gate: `node tests/fscheader.js`.
- **RMX**: applied m³ comes from the `M3 Applied To` columns in `Extra Raw Data`, matched via
  `mat_prod_hier_3` containing "fuel surcharge". Coverage = applied m³ ÷ gross (delivered)
  m³, **no cap**.
- Both dollars *and* applied volume must come from **Extra Raw Data**. The Main Raw Data
  volume-proportional spread is only accurate at the plant-month total level and misallocates
  by segment.
- "Applied" tonnes = customer-months with an actual FSC. Reversal/credit rows affect the
  dollar total but **not** the denominator.
- **Saskatchewan has no fuel surcharge.** It has a per-customer mid-year price increase
  ($/tonne from a start date), tracked in its own sheet. Recovery = rate × tonnes billed on
  or after the start date. `Sask_Backend.gs` reads and name-matches; the arithmetic happens
  once, per raw row, in `PV_Backend.gs`.
- Name normalization for matching: non-breaking spaces, en/em dashes, collapsed whitespace,
  case, punctuation — with a fallback to unique trailing account codes.

### Extras / VAP

- **Applied-to m³ is not addable across extra types** — the same physical pour is counted
  under each hierarchy group it belongs to.
- By-extra-type **summary** tables use total concrete m³ as the ASP denominator (additive).
  **Detail** tables use applied m³ (per-applied-unit, explicitly labelled).
- Revenue-weighted apportionment *within* a single extra type is correct. The double-count
  reviewers flag is *between* types, not within them.

### Product classification

- **Match on SAP numeric codes, not descriptions.** Descriptions get renamed (WEATHERMIX →
  TEMPTECT); the numeric code prefix is stable.
- **Strength class**: only assign when a number appears directly adjacent to an MPa marker.
  Bare numbers in product names or class tokens do not count — default to `Others`.

### The Overview specifically

- It is a **strictly read-only aggregator**. It never recomputes independently and always
  defers to the base tools' caches. It never blends AGG and RMX lines.
- Customer data calls `getCustomerReport` **directly per selected market** and merges parent
  rows client-side. An earlier attempt at a dedicated `getOverviewCustomers` server function
  hung; the direct PV pattern fixed it.
- PPI accuracy: RMX rows expose `rfiBase`/`facBase` for exact subset PPI. AGG all-markets
  returns the exact `aggAll.ppi`; a single market is exact; **2+ market subsets** use a
  CY-revenue-weighted blend labelled ⓘ *"Estimate for a mix of markets"*.
- `pyStale()` grays out prior-year-derived metrics when the selected window exceeds 12 months.
- **Period has FOUR settings, and only two of them exist on the server.** `MTD` and `YTD`
  are what `PV.getReport` / `RMX_NS.getKeys` / the Product Segment tabs answer for. `PMTD`
  and `PYTD` — *Prev month (MTD)* and *Prev month (YTD)* — are the same two shapes one month
  back and are computed in the browser from the month cube. `STATE.pick` is the button;
  `STATE.period` stays the SERVER period (`PICK_SERVER` maps `PMTD→MTD`, `PYTD→YTD`, so the
  payload on the matching tab is still loaded); `STATE.win` is true for both Prev-month picks
  and for any dragged span. `windowPeriod()` tests the Prev-month spans FIRST, against the
  union's own last month — when Ready-Mix runs a month ahead of Aggregates a single month is
  both "Aggregates' MTD" and "the previous month", and the two answers now drive different
  panels.
- **A panel with nothing in it is not shown.** There is one rule and no exceptions for
  emptiness: no rows, no data, not computable for this window → `hidePanel(bodyId)`, which
  clears the body and hides the card in `PANEL_OF`. `resetPanels()` runs at the top of
  `renderTab()` so every card comes back before the painters decide again. Only genuine
  FAULTS still speak — a sheet that has not been set, a call that failed — because those are
  fixable and the message carries the link. The old `winExempt()` / `.ov-exempt` notices,
  `kpiHint()`, `aspBlocked()` and `rfuelBlocked()` are gone.
- **Product Category is a Prev-month panel.** The Slide tabs arrive already split into MTD
  and YTD, already summed to segment × market, with no month column — and the month they are
  for is `ovSegMonth_()`, the PREVIOUS calendar month, while the fact tables already run into
  the current one. Under "This month" it was drawing July's tabs under an August heading.
  `pcatFits()` shows it only when a Prev-month pick is active AND the month it lands on is
  the tabs' own month; anywhere else the card is not on the page. It is also decided FIRST in
  the Ready-Mix branch of `renderTab()`, so nothing later can throw and leave it showing.
- **What the cube answers is not a short list.** The Aggregates fact table carries plant,
  material, plant type, material family, product class, customer parent, customer segment,
  the surcharge dollars (`fsc`) and the tonnes those dollars were charged on (`fv`); the
  Ready-Mix one carries extras and VAP revenue (`ex` / `va`). So in window mode the browser
  now builds the plant & material explorer, the customer table (segment split included),
  both fuel-surcharge panels, the revenue and ASP-mix waterfalls and the Ready-Mix ASP
  build-up. The ASP mix bridge is also the fallback on MTD / YTD for a **2+ market subset**,
  which the server ships no pre-computed bridge for. What is genuinely absent:
  the SAP / USGAAP cards (statement figures, per month or per year), extras BY TYPE and the
  Ready-Mix fuel recovery (the type and the per-load surcharge are not columns), and the
  surcharge panels outside the current book year (`winFscOk()` — the fsc columns are optional
  in the closed-year books).
- **In window mode the server reports must not paint.** `loadDims` / `loadPM` /
  `paintRxfPanels` still run — they keep the filter option lists and the shared report cache
  warm — but they are fetched for the SERVER period, so `srvOwnsAgg()` and an early return in
  `paintRxfPanels()` stop them repainting a fifth of a second after the cube drew the window.
  For the same reason `renderTab()` tests `winMode()` BEFORE `xfActive()`: the cube applies
  the page's cross-filters itself, while the cross-report knows nothing about a window.
- History cube: era files are registered in `APP_EXTRA_SOURCES.overview`; `ERAS` is
  newest-first. History JSON is stamped with shape/dims/vals so stale files auto-rebuild. A
  **dictionary remap** is required when merging per-era files built with independent
  dictionaries.
- `cyMonths` and `pyMonths` passed to `AmrCube.query` must be **index-aligned**, and
  `groupBy:'ym'` must map prior-year rows onto their CY slot — otherwise the series returns
  twice as many points with PPI 0.
- Numeric reconciliation tolerance is 1e-5 relative (measures are rounded to 2 dp on the
  wire); the un-rounded path achieves 1e-15.

### Rendering traps

- Chart instances are tracked in **per-section registries** (`CH.mkt`, `CH.cust`, `CH.fsc`,
  `CH.fscc`) — not one global list. A single list means re-rendering one section destroys
  another section's canvases.
- Grid children default to `min-width:auto`. Panels inside grid containers need
  `min-width:0`, and canvases need `max-width:100%`, or they overflow.
- `Styles.html` sets `thead th` background to `--blue-80`. A page using a plain `<table>`
  must set an explicit white background on `th`/`td` or it renders blue-on-blue.
- Drive `/preview` embeds are cross-origin — custom zoom controls cannot coexist with
  Drive's native ones.
- **A slide fitter must fit to the frame's HEIGHT as well as its width.** `AmrSlide.build`
  scales the whole stack when it overflows — that is a last-resort clamp, not a layout. It
  shrinks the type the fitter just chose, and because transform-origin is top *centre* it
  also pulls the content away from the edges the fitter had just filled. A width-only fitter
  therefore reads as "the tables are huge, everything else is a smear, and there is white
  down both sides". That is exactly what the Product Segment slides looked like in the July
  deck: the strip was fitted at its 10px base and then scaled to four effective pixels.
  `tests/slidefit.js` fails on any content that still overflows its frame.
- **One loading screen means one `AmrProgress` key.** It shows the lowest-order job and
  lists the rest underneath, so several keys raised and cleared at their own moments is what
  reads as a flicker of half-second screens — and `done()` adds a 1.2 s tick before the next
  job goes up. Both Ready-Mix pages raise a single `LOAD_JOB` with one wording, pass the
  varying part as the job's `note`, and clear it in exactly one place: where the tables
  actually reach the page.
- **There is no region to choose on an RMX slide.** `AmrKpi.rmx()` finds a market's block in
  the workbook's `RMX Summary` tab **by name** and reads no sheet index at all; only the
  Price & Volume cards read a per-region plant statement. The `seg` adapter used to declare a
  `kpiPicker` built from the AGG region list anyway — `AmrSegSlide` ignored every field of it,
  so it changed nothing and put *"AGG GTA"* on ten Ready-Mix rows in the Deck Builder. A
  control that cannot affect its output does not belong on the page.
- **Every size in a KPI card is `em`, so the row's font-size IS the card's size.** A strip
  dropped into a bare flex row with no font-size inherits the 16px body font, and the cards
  clip their own text (`overflow:hidden`) rather than spilling. `AmrKpi.stripHtml` /
  `AmrKpi.fitStrip` build and size every on-page strip; the slide fitters size the slide's.

---

## 8. Next major project — Deck Builder

**Goal:** one button that produces the whole monthly Google Slides deck — roughly 45 slides
across AGG P&V, RMX P&V, RMX Segment, Fuel Recovery and Top-10 Customers — where the **title
is real editable Slides text**, the **comment box is a real empty text box**, and only the
table or chart goes in as a picture.

This is deliberately *not* the existing PNG export, which flattens the header, the title and
the blank comment bands into one 1600×900 image.

### Why an image at all

Apps Script cannot render the page's HTML tables or Chart.js canvases — those only exist in
the browser. So the picture still has to be captured client-side with html2canvas. What
changes is *what* gets captured and *where it lands*.

`SlidesApp.insertTable` would give genuinely editable text, but styling a 14-column table
with merged header bands and per-cell colours costs one API call per cell — ~200 calls a
slide, with real timeout risk over 20 slides. Images for the tables, native text for
everything around them, is the right trade.

### The template contract

Two deliberately dumb mechanisms, so a non-technical user can restyle the deck without a
code change:

1. **Layout id in the speaker notes** — `LAYOUT: L_FULL_IMAGE`. That is how a layout slide
   is found. Reorder or restyle the template freely; nothing in the code cares about slide
   order.
2. **Tokens** — `{{TITLE}} {{COMMENT}} {{IMAGE}} {{IMAGE2}} {{LABEL1}} {{LABEL2}} {{PAGE}}
   {{DECK_TITLE}} {{DECK_SUB}}`. Each token is the **text of a shape**, never a text box laid
   over a rectangle. An image slot is *one* shape: the code reads its geometry, deletes it,
   and fits the picture into exactly that rectangle.

`{{IMAGE}}` is a **guide, not a frame**. Moving or resizing it in the template moves the
picture. Scale is `min(boxW/imgW, boxH/imgH)`, then centred — a short wide table letterboxes
rather than distorting, and the picture can never overlap the title or the comment panel.

Seven layouts were designed against the sample deck:

| Layout id | Use |
|---|---|
| `L_COVER` | deck cover |
| `L_COMMENT_IMAGE` | comment panel + one table (AGG/RMX market slides) |
| `L_FULL_IMAGE` | full-width single table (Fuel Recovery) |
| `L_FULL_STACK` | two stacked tables, MTD over YTD (Top 10 Customers) |
| `L_COMMENT_STACK` | comment panel + two stacked tables |
| `L_SECTION` | AGG / RMX section dividers |
| `L_README` | instructions; listed in `DOC_LAYOUTS`, deleted from every generated deck |

Google Slides 16:9 is **720 × 405 points**, not pixels. `DECK_CONFIG.CAPTURE_PX_PER_PT = 4`
and `CAPTURE_MAX_PX = 2400` — `DECK_readTemplate` returns a suggested capture width per slot
so nobody has to guess.

### What exists today — verified against the code

| Piece | State |
|---|---|
| `Deck_Backend.gs` — all five server functions + validator + smoke test | ✅ written (664 lines) |
| `?page=deckbuilder` route in `Code.gs` | ✅ wired |
| Page-switcher entry in `Shell.html` `AMR_PAGES` | ✅ wired |
| Two `Landing.html` cards | ✅ wired |
| `fsc` + `rfsc` adapters | ✅ moved into `Deck_Fuel.html`, where the deck can actually reach them |
| Shared exec-table engine (`AmrFuelExec`) | ✅ one copy serving both fuel pages and the deck |
| Exec views (`EXEC` / `EXEC_MTD` / `EXEC_YTD`) on both fuel pages | ✅ built |
| `Page_DeckBuilder.html` | ✅ built — Plan / Render / Publish, previews from template geometry |
| `AmrDeckSource` registry (`Deck_Sources.html`) | ✅ built — the two guarded adapters now have something to register into |
| `AmrSlide.captureBare` | ✅ built in `SlideExport.html` |
| Recipe (`Deck_Recipe.gs`) | ✅ built — 43 rows, transcribed from the July 2026 pack |
| `Amrize_Deck_Template.pptx` + sample-deck PDF | ✅ committed to the repo |
| **`DECK_CONFIG.TEMPLATE_ID` / `FOLDER_ID`** | ❌ **still `PUT_..._HERE` placeholders — set these before anything runs** |
| `pv` / `cust` adapters (`Deck_PV.html`) | ✅ live — 19 more rows build |
| `seg` / `rmx` adapters | ✅ live — all 43 rows now build |

So: the pipeline is complete end to end and all 43 rows build. The Plan stage still names
any missing source up front rather than failing once per row.

### What the first real deck got wrong (July 2026 build)

The 43-slide deck published without an error and was wrong in six ways. Every one of them
is the same shape of mistake — the deck reuses a page's builder but not the page's
*context*, and nothing checked that the context came with it.

#### The CSS the deck could not see

The big one, and the cause of three separate complaints. Phases 2–4 lifted the slide
builders into `Deck_*.html` but left the CSS they depend on in each report page's own style
block. Report pages include their module **and** have the CSS; the Deck Builder includes the
modules **without** the pages. So every slide was photographed with **46 classes unstyled**:

- Ready-Mix headings (`By submarket`, `By extra type`) lost `.rmx-eb-title` and rendered as
  unstyled lower-case body text, run straight into the mix badge — `.rmx-eb-badge`'s
  `margin-left:auto` is what separates them.
- Price & Volume tables lost `.exp table th, .exp table td{padding:4px 9px}` and fell back
  to the generic `10px 12px`. That is ~40% more width than the fitter budgeted for, and the
  fitter cannot recover it: `thead th` sets its size through a `font:` **shorthand**, which
  beats the inherited `font-size` the shrink loop is setting, so the header never shrinks.
  The PPI column was cut in half by the card's `overflow:hidden` on every AGG slide.
- Product Segment and Fuel tables lost their header, subtotal and grand-total colours.

Fixed by `Deck_Styles.html`, included by the Deck Builder only, every selector scoped under
`.slide-bare` (the wrapper `captureBare` photographs) so it cannot reach a page. The rules
are **mirrored, not moved**: moving a rule out of a page's style block changes that page's
cascade order, and these pages are in daily use. `tests/deckstatic.js` is the gate.

#### Southwest Land / Docks published a page of zeroes

Land and Docks are not markets — they are the two values of the **MB SUBMARKET** column
*inside* the Southwest market, which is what the Price & Volume page's refine chips toggle.
The recipe said `market:'Southwest Land'`, which matched no market, so the backend returned
an empty report and the slide published as a full page of `0`s rather than failing. Rows now
say `market:'Southwest', refine:'Land'`, and the `pv` adapter resolves that **label** against
the market's own `refineOptions` — the sheet's raw spelling is never written into the recipe.

#### Central Canada was cut by submarket

Inside one market the interesting cut is its submarkets. Central Canada is not a market, it
is every market at once, so the slide listed fourteen submarkets from five different markets
(West GTA next to Regina next to Sask AGG) and left the reader to reassemble them. The
rollup is cut by `MARKET` now; every other market keeps `SUBMARKET1`.

#### Rows and columns disappeared into the scaling

The one that made the slides unusable, and the reason for the others being hard to see.

A page photographs its content **inside the 1600×900 slide frame**: `AmrSlide.build()` puts
it there, runs the page's `fitSlide` — which fits the tables to the height the frame gives
it — then clamps anything still too tall, and captures at exactly 1600×900. Nothing
overflows because everything was fitted against a real height.

The deck did the opposite. `captureBare` dropped the content into an **unbounded** div and
ran a second, width-only fitter (`fitBare`) that each module carried a copy of. Its premise,
written in the comments, was that "height is free" because the picture gets scaled into the
image box by ratio anyway. Height was free in the wrong direction: the stack ran as tall as
its content, and `fitRect_` then shrank the whole picture — a 1971×2048 image into a
553×229 pt box — to get it in. Everything shrank together, and what did not survive was
rows and columns. Worse, the two customer fitters open with `if(!center) return`, so on a
frame with no `.slide-center` the Top 10 slides were never fitted at all.

`captureBare` now builds the same frame through the same `build()`, in **bare** mode: no
header, no logo, no whitespace bands (on a generated slide the title and the comment box are
real Slides text), and everything else identical. It is sized to the **shape of the image
box** — 1600 wide, `1600 × slotH/slotW` tall — so the picture fills its slot with no
letterboxing and the fitter gets the real height to fit into.

`fitBare` is gone from all four modules; `fitSlide` is the only fitter, which is what makes
"change the format in one place" true. `tests/deckstatic.js` fails if a second one appears.

#### Every picture was resampled on the way out

Whatever resolution is inserted, an exported deck comes back with every picture capped at
**2048 px on its longest side** — 21 of the 43 pictures were exactly 2048 wide or exactly
2048 tall. Capturing at 2400 therefore never bought 2400: it bought a canvas Google then
resampled, so text rendered at one scale was squeezed to another and every slide came out
softer than the same table screenshotted by hand. `CAPTURE_MAX_PX` is 2048 now and
`captureBare` clamps **both** dimensions to it, so html2canvas renders the text at its final
size — one sampling, not two. The height matters as much as the width: the cap is on the
longest side, so a tall table that overshot had its width dragged down with it.

#### The Land / Docks chips listed the whole dataset

Seven chips, five of which filtered to nothing. The cube path fed them
`AmrCube.dict('agg','mb')` — every MB SUBMARKET value in the cube — and the chips label them
all as just `Land` or `Docks`, so the other markets' values were indistinguishable from
Southwest's. The server has always scoped that list to the market being viewed; the cube path
now does too, grouped **without** the mb filter so the selected chip does not become the only
one left to select.

#### The Ready-Mix slides carried five tables and raw dimension keys

Two things, one `ctx`. `extraCards:['BYTYPE','DETAIL']` added *By extra type* and *Extras &
VAP detail* on top of the three dimension tables, so a five-table stack was squeezed into
one image slot — and those two belong on the Product Segment slide, which is where the
Segment page puts them. And `breakdowns:[]` left `labelForDim()` falling back to the **raw
dimension key**, which is why the slides read `By SUBMARKET` / `By STRENGTH` / `PLANT` where
the page reads `By Submarket` / `By Strength Class` / `Top 10 Plants`. `RMX_getKeys` returns
the label list; the adapter passes it through now. The slide is the page's three tables:
Submarket, Strength Class, Top 10 Plants. `RMX_getExtras` is no longer fetched.

#### The Product Segment slides carried one table

`exportSel:{}` reads as "each table's default", and two of the three default **off**
(`EXPORT_DEFAULT_OFF`), so the slide was the Segment table alone. The deck names what it
wants now — Segment **and** By extra type, the pair the Segment page ticks for its own
export. `Extras & VAP detail` stays off: it is the EXTRAS LOOKUP working view, too wide to
read at slide size.

#### The template slides were deleted

`finish()` removed every slide without a `SLIDE: <id>` note, which threw away the one copy
of each layout the deck was built from — so a slide that came out wrong could not be rebuilt
by hand from the layout beside it. They are **moved to the end** now, in template order.
Only built slides are numbered: a parked layout is not page 44, and leaving its `{{PAGE}}`
token unfilled is what keeps it usable as a template. `finish()` returns
`templateSlidesParked`, and `slides` is the count of the deck proper.

#### The deck could not be built for a chosen month

A deck is normally built *after* a month closes and all its data is in, so it needs to be
buildable for whichever month you name — and every slide has to agree. Each adapter
hard-coded `month: 0` in its server call, which meant "whatever the backend calls the last
closed month" and could not be steered.

The Deck Builder now has a **Report month** picker: one month for the whole deck, defaulting
to **last month**, offering the running month but never defaulting to it (it is only
part-billed, and a half-month reads as a collapse). The chosen month is stamped onto each
spec, keys every adapter's cache, and rides in every backend call — so MTD is that month
alone and YTD is January through it, on all four backends at once. Changing it invalidates
anything already rendered. The list is months of the current reporting year only: the
backends take a month 1-12 with no year and read it against the export's current year, so
offering "August last year" would silently be read as August *this* year.
`tests/deckstatic.js` fails on any `month: 0` left in an adapter.

#### AGG Fuel Recovery reported a different month from everything else

`FSC_Backend` resolved its report month to the **newest month in the file**, so on a sheet
already carrying a part-billed August it published August while Price & Volume, Ready-Mix
and RMX Fuel Recovery all published July — one deck, two months. The other three all resolve
to **last calendar month**, falling back to the newest month present if last month is not in
the export yet (`pvReportMonth_`, `reportMonth_`, `buildCells_`). This is the fourth catching
up. It also gained the month argument the other three already took, a `months` /
`defaultMonth` payload, and the **Report month** picker its page never had — the same picker,
same wording, as the RMX Fuel Recovery page.

So across every page the default is now last month, with the running month selectable.

#### Table titles came out lower-case

`fieldLabel()` lower-cased because its first caller put it mid-sentence ("all markets"), and
it later became the heading over a table. So the cube path titled its cards `submarket` while
the identical card built through the server path said `Submarket`. It returns the label as
written now; the one sentence context lower-cases at the call site.

### Bugs found and fixed

Found by reading the code and by validating the committed template offline against the
same contract `DECK_validateTemplate` enforces.

1. **`addSlide` read the presentation after `saveAndClose()`** — the return statement called
   `pres.getSlides().length - 1` on a closed presentation. Now the index is captured before
   closing. *(Defensive: the smoke test reportedly ran fine, so this may not throw in
   practice — but reading a closed handle is not something to rely on.)*
2. **Unfilled tokens shipped as literal text.** `L_SECTION` carries `{{DECK_SUB}}`, which
   only `create()` fills and only on the cover — so a divider slide put the raw text
   `{{DECK_SUB}}` in front of the meeting. `addSlide` now accepts `spec.subtitle` for it and
   then blanks every token the recipe did not fill. `{{PAGE}}` is the one exception; `finish()`
   still stamps it once the slide order is final.
3. **`DECK_smokeTest` logged `out.layoutsRemoved`**, but `finish()` returns
   `templateSlidesRemoved` — it printed `undefined`.
4. **`readTemplate` returned `L_COVER` as a usable layout.** Layouts now carry
   `role: 'cover' | 'report'`; the page builds its recipe picker from `report` only, and
   `readTemplate` fails loudly if a template has a cover but no report layouts.
5. **`validateTemplate` judged the cover by the wrong checklist** — warning it had no
   `{{TITLE}}` and no `{{PAGE}}`, neither of which a cover should have. It now checks the
   cover for `{{DECK_TITLE}}` and warns if it carries a stray `{{IMAGE}}` box.
6. **`Code.gs` defined `readTab_` twice** inside `SB`; the dead first copy is gone and the
   survivor's error message no longer names a config key (`PAGES.slidebuilder`) that does
   not exist.

### What the committed template actually contains

Validated offline with python-pptx against the same two contracts the builder relies on:

- **720 × 405 pt** — exactly Google Slides 16:9. ✅
- **Five tagged layouts**: `L_COVER`, `L_COMMENT_IMAGE`, `L_FULL_IMAGE`, `L_SECTION`,
  `L_README`. Every token sits in exactly one top-level shape, so nothing is nested in a
  group where `SlidesApp.getShapes()` could not reach it. ✅
- **`L_FULL_STACK` and `L_COMMENT_STACK` are NOT in the template** (the plan assumed seven
  layouts; five shipped). The recipe therefore routes the five Top-10 Customer slides to
  `L_FULL_IMAGE` as one image containing both tables — which is what the Price & Volume PNG
  export already produces. Every layout the recipe asks for exists. ✅
- One cosmetic nit: in `L_COMMENT_IMAGE` the `{{IMAGE}}` box starts 0.8 pt above the bottom
  of `{{TITLE}}`. Pictures are fitted and centred inside the box, so a normal wide table
  never reaches that edge — but nudging the image box down a point in the template removes
  the overlap entirely.

Slot geometry, for reference:

The **live** template (`DECK_CONFIG.TEMPLATE_ID`) carries four content layouts. The `.pptx`
committed here is the older five-layout starter and is now **out of date** — treat the Slides
file as the authority and run `DECK_validateTemplate()` after any edit.

| Layout | Used by | Why |
|---|---|---|
| `L_COMMENT_IMAGE` | AGG P&V (14) | comment panel + image; the captured block includes the KPI strip |
| `L_COMMENT_IMAGE_NO_KPI` | RMX Segment (10) | same, but the image box is smaller and sits lower — that content has no KPI strip, and the gap left at the top is where KPI cards can be added by hand |
| `L_FULL_IMAGE` | RMX P&V (10), Top 10 customers (4) | full-width block |
| `L_FULL_IMAGE_SMALL_OR_FSC` | Fuel Recovery (4), North customers (1) | a smaller image box, for content that is much shorter than a full market table |

### Architecture — three stages, never one shot

Deck building cannot be a single function: 45 slides of client-side rendering plus 45 Slides
API round trips will not fit in one execution, and a failure at slide 40 must not cost the
first 39.

1. **Plan** — build the slide list from the recipe. No data, instant. The user gets a
   checklist and can untick slides they don't want this month.
2. **Render** — walk the list *one slide at a time*: fetch that market/period's data → build
   the content block off-screen → `html2canvas` → thumbnail appears in the row. All the
   compute lives here, and one slide per tick keeps the browser responsive. *"Rendering 12 of
   45 · AGG – Manitoba – YTD."*
3. **Publish** — one `google.script.run` per slide. The server duplicates the layout, fills
   the tokens, inserts the image. ~2–4 s each, well inside the 6-minute limit because no call
   ever handles more than one slide.

A slide that fails is marked red and retried once; if it fails again the deck completes
without it and that row can be re-rendered alone. Nothing is ever redone from scratch.
`DECK_addSlide` overwrites the duplicated slide's speaker notes with `SLIDE: <recipeId>`,
which is what makes `DECK_finish` (delete everything still untagged) and `DECK_status`
(what already landed → resume) work.

**One slide per call is deliberate. Do not "optimise" it into a batch.**

### The one real refactor

The deck builder must not re-implement a single table. Every report page already has a
slide-content builder feeding `AmrSlide`. Those need to become shared includes
(`Deck_PV.html`, `Deck_RMX.html`, `Deck_SEG.html`, `Deck_FSC.html`, `Deck_RFSC.html`), each
pulled in by both its own page and the deck builder, each exposing the same adapter:

```js
AmrDeckSource.register('pv', {
  prepare(spec) -> Promise,      // load that market/period's data (cached)
  content(spec) -> DOM element   // the block: no header, no logo, no margins
});
```

Because `include()` inlines into the same document, moved functions still see the page's
globals — the extraction is mechanical, not a rewrite. It was agreed to extract the **pure
compute + render layer only**; the deck path has no user edits to honour, so the editable-cell
override layer (`NUM_OV`, `TXT_OV`, `DERIVED`) stays on the page.

**Each extraction has a hard pass/fail test: the page's existing PNG export must look
identical before and after.** One page at a time, verified before moving on.

### The in-website preview

`DECK_readTemplate` already returns real slot geometry in points. The page draws each preview
as a 16:9 div scaling those points down — comment panel, title and image rect exactly where
the template puts them — with the captured PNG dropped in at `object-fit:contain`. So the
preview is a faithful mock, it is instant, it needs no deck to exist yet, and moving a box in
the template moves the previews after a *Reload template*. No Slides thumbnail round-trip.

### Open questions

Three of the four are now answered by a default that is cheap to change. The first still
needs a decision.

1. **Where do decks land?** ❓ Still open. `DECK_CONFIG.FOLDER_ID` is a placeholder and
   `create()` refuses to run until it is set — deliberately, so a half-built deck never
   lands in a random My Drive. Set it to a shared folder (Editor access for everyone who
   builds decks), or change `create()` to skip the `moveTo`.
2. **Top-10 customer slides?** ✅ **One image**, matching what the Price & Volume PNG export
   already produces. North uses `L_FULL_IMAGE_SMALL_OR_FSC` because its customer table is
   much smaller than the other markets'; the rest use `L_FULL_IMAGE`.
3. **SW Land / SW Docks?** ✅ In the recipe, flagged `optional:true` — listed in the Plan
   stage but **unticked by default**, so they are built only when someone asks. Default deck
   is 39 slides; all 43 if both are ticked.
4. **Live data or page cache?** ✅ Whatever the source page already has. `prepare(spec)`
   returns `null` when the data is loaded, so the deck reuses the page's cache and never
   re-reads a sheet it does not have to.

### Order of work

| Phase | Scope | State |
|---|---|---|
| 0 | `Deck_Backend.gs`; template into Drive; `DECK_validateTemplate` + `DECK_smokeTest` pass | ✅ code written; smoke test run by Rafay |
| 0b | Fix the known bugs; commit the `.pptx` template | ✅ done — six fixed, template validated offline |
| 1 | `Page_DeckBuilder.html` + `AmrDeckSource` + `AmrSlide.captureBare` + `Deck_Recipe.gs`; previews from template geometry, no data yet | ✅ done |
| 2 | Fuel Recovery adapters into shared `Deck_Fuel.html` → first 4 slides end to end | ✅ done |
| 3 | AGG P&V adapter (`pv` + `cust`) → 14 summary + 5 customer slides | ✅ done |
| 4 | RMX P&V + Segment adapters (`rmx` + `seg`) → 20 slides | ✅ done — with one caveat, below |
| 5 | Optional: remember last month's comment text per slide id and pre-fill | ☐ |

### Phase 3 — done

`Deck_PV.html` holds the Price & Volume slide-content path; the page delegates to it and the
`pv` + `cust` adapters are live, so 19 more recipe rows build.

- The closure was **computed, not eyeballed**. `buildPvSlideContent(d)` and `slideTitle(d)`
  turned out to touch no page state at all; the whole closure reads only **14** context
  fields, listed on `ctx_()`.
- ~480 lines were lifted **mechanically** (a script pulled each definition verbatim and
  applied two uniform rewrites, `STATE.x → CTX.x` and `CONFIG.slide → CTX.slide`), then
  wrapped in an `AmrPvSlide` module with a `withCtx` entry layer so the lifted bodies stay
  byte-for-byte unchanged.
- **Delegate, do not delete.** A first pass at deleting the lifted definitions from the page
  was wrong: `esc` alone has 30 call sites, most outside the slide path, and a nested `esc`
  definition fooled the span finder. The page therefore keeps every name and signature and
  only the slide-content *entry points* were repointed. The page's own `esc`/formatters stay;
  the module carries private copies. That duplication is deliberate — trivial pure functions,
  versus breaking a working page.
- **Charts.** The page photographs its visible `#revChart` / `#aspChart`;
  `renderChartsOffscreen()` gives the deck a throwaway pair, draws, captures, destroys. The
  canvases are parked off-screen, **not** `display:none` — Chart.js draws nothing into a
  zero-size canvas.
- **The KPI region picker is now on the Deck Builder too.** Which EBITDA region sheet a
  market's KPI cards read is a per-device choice in `localStorage` under `pvKpiViewMap`,
  keyed by `filterField:filterValue`. The Deck Builder shows a Region dropdown on any row
  whose source declares a `kpiPicker`, reads and writes **that same map**, and drops the
  row's rendered picture when it changes — so a market whose region was never set, or set
  wrong, is fixed without leaving the page, and the report page sees the change too.
- **The picker follows the row's own workbook.** There are **two** EBITDA workbooks:
  Manitoba and Saskatchewan are the whole of the second one (`mbsk`), everything else is on
  the main one. The dropdown used to be the merged list from both, so a Saskatchewan row was
  offered Ontario's regions and defaulted to the first of them — a real region sheet,
  silently the wrong one. It showed no wrong numbers only because `kpiMissingBook()`
  suppresses the KPI strip for those two markets while their workbook is absent; the moment
  that file is uploaded the guard stops firing and the stale default would have gone onto
  the slide. `AmrKpi.plantIndex(vals, book)` now takes a book, `AmrKpi.bookFor(market)` says
  which one a market reads, and `kpiSheets` / `kpiFor` scope **both the offered list and the
  fallback default** to it. A row whose workbook is missing reads *no workbook* instead of a
  dropdown, and the dropdown appears on its own when the file is uploaded — no code change.
  Labels are worked out from the merged set before filtering, so the `· MB/SK` suffix means
  the same thing either way and the remembered choice is never stranded.
- **Central Canada** resolves to the backend's `__ALL__`; it is a rollup with no market tab.

**Verified:** `tests/pvcheck.js` — 11/11 byte-identical between old page code and the module
across `tableInnerHtml`, `monthTag_`, `slideTitle` and `buildCustTable` for every secondary
dimension, sort direction and top-N. `tests/deckpath.js` — all four sources register and all
seven sampled slides build, with the KPI strip populated (5 cards), both waterfalls captured,
and the customer slide carrying its two stacked blocks; each backend is called once per
market+period, not once per slide.

**A bug the harness caught:** `buildPvSlideContent` captured the hardcoded `revChart` /
`aspChart` ids, so deck slides came out with **no charts at all** — the offscreen canvases
have generated ids. The ids now travel on the ctx.

### Phase 4 — done, with one debt to pay

`Deck_SEG.html` and `Deck_RMX.html` complete the set. **All 43 recipe rows now have a
content source.**

- **Segment (`seg`)** was the easy half: `buildSlideContent()` builds from `DATA` and a
  `TABLES` config array, so it lifted cleanly. Five context fields.
- **RMX (`rmx`) was structurally different** and worth knowing about. `buildRmxContent()`
  does not build from data at all — it **scrapes the rendered DOM**, walking
  `#tablesHost .card` / `#extrasHost .card` and keeping whichever have their export
  checkbox ticked. And the page does not get finished tables from the server either:
  `RMX_getKeys` sends key rows and the **browser** builds every table via `buildTables()`.
  So the deck needed the compute layer *and* the renderers *and* a stage to render onto.
  `renderOffscreen()` builds the two hosts the renderers expect, parked off-screen, runs
  them, ticks every export checkbox, scrapes, and tears the hosts down — the same shape as
  the offscreen canvases in `Deck_PV.html`.

**The debt: the two pages do not delegate yet.** Phases 2 and 3 rewired their pages so there
is exactly one copy of each algorithm. Phase 4 did **not** — `Page_Segment.html` and
`Page_Rmx.html` still hold their own copies, so `Deck_SEG.html` / `Deck_RMX.html` are
currently *duplicates* rather than the single source of truth. A formatting or maths fix now
has to be applied twice, and that is exactly the drift the earlier phases existed to prevent.

That was a deliberate trade at the end of a long session: rewiring two more large working
pages without a before/after harness for them is the riskiest thing in this project, and the
harness is what makes it safe. **Pay it down next**, in this order:

1. Extend `tests/` with a SEG and an RMX before/after comparison, the way `pvcheck.js` works.
2. Then delegate, entry points only — `delegate, do not delete` (see Phase 3; `esc` and the
   formatters have call sites all over both pages).

**A bug the harness caught:** `renderReport()` and `renderExtras()` both end by refreshing the
report page's live slide preview. On the Deck Builder there is nothing to refresh, and every
RMX slide died on `renderRmxPreview is not defined`. It is now a guarded no-op in the module.

### How Phase 2 was done — the pattern Phases 3–4 should copy

The plan called for two files, `Deck_FSC.html` and `Deck_RFSC.html`. It shipped as **one**,
`Deck_Fuel.html`, because the two pages' exec paths turned out to be near-identical: same key
scheme, same maths, same markup, differing only in the units in the column headings and where
the year came from. Two files would have meant two copies of one algorithm and a standing
invitation to fix a bug in one and not the other. The differences now live in a **UNITS
descriptor** — two small objects, `agg` (tonnes) and `rmx` (m³).

The extraction pattern, which Phases 3–4 should follow:

1. **Everything moved is pure.** No global reads. Page state arrives as one `ctx` object —
   `{ numOv, txtOv, hidden, derived }`. That is exactly what lets the report page render
   *with* the user's typed overrides and the deck render *without* them, from one copy of
   the code.
2. **The page keeps its function names and signatures** (`computeExec`, `buildExecTable`,
   `buildExecTables`, `fscFit`) and delegates the body. The blast radius is four one-line
   function bodies per page, not a rewrite of a file that already works.
3. **The module fetches its own data.** On the Deck Builder there is no page `DATA` to
   borrow, so each adapter calls its own backend once and both of its slides reuse it —
   which is why `prepare()` returns `null` on the second call.
4. **Only the exec path moved.** The pages keep their own `STATE`, editable-cell overrides,
   summary and by-month tables, and all UI wiring. The deck wants none of it.
5. **`fit` comes in two flavours.** `fitSlide(box)` for the 1600×900 PNG frame (what the
   pages always used) and `fitBare(box)` for the deck's capture, which has no `.slide-center`
   and no imposed height — only width has to fit, so the type stays large. The adapter
   exposes `fit`, and `captureBare` calls it exactly as `AmrSlide.build()` does.

One thing that came out in the wash: the old adapters were guarded on
`if(window.AmrDeckSource)` inside the report pages — a registry those pages never create. So
they had never actually run. Moving them into a file the Deck Builder includes is what made
them live.

**Pass/fail test — and it passed.** A Node harness ran the pre-extraction page code and the
post-extraction module over the same model and diffed the HTML: **12 comparisons byte-identical**
(both pages × both periods and "both" × clean and edited state, where "edited" means typed
numeric overrides, a renamed label, and a hidden market). See §10.

### Recipe shape

One config array — adding, removing or reordering slides is a config edit, not code:

```js
{ id:'pv_gta_mtd', source:'pv', market:'GTA', period:'MTD',
  layout:'L_COMMENT_IMAGE', title:'AGG - GTA COMMERCIAL - MTD' }
```

Roughly 45 slides, matching the sample deck:

| Block | Count | Layout |
|---|---|---|
| Fuel Recovery — AGG/RMX × MTD/YTD | 4 | `L_FULL_IMAGE` |
| AGG P&V — Central, SK, MB, GTA, SW, SW Land, SW Docks × MTD/YTD | 14 | `L_COMMENT_IMAGE` |
| AGG Top 10 customers — 5 markets, MTD over YTD | 5 | `L_FULL_STACK` |
| RMX P&V — 5 markets × MTD/YTD | 10 | `L_COMMENT_IMAGE` |
| RMX Segment / Product — 5 markets × MTD/YTD | 10 | `L_COMMENT_IMAGE` |

### Setup checklist (once, before Phase 1)

1. Upload `Amrize_Deck_Template.pptx` to Drive and open it with Google Slides
   (*Open with → Google Slides*) so it becomes a real Slides file, not an unconverted `.pptx`.
2. Put that file's ID in `DECK_CONFIG.TEMPLATE_ID` (or the `DECK_TEMPLATE_ID` Script Property).
3. Put the destination folder's ID in `DECK_CONFIG.FOLDER_ID`. Share that folder as **Editor**
   with everyone who will build decks.
4. Add the **Slides** and **Drive** scopes.
5. Run `DECK_validateTemplate()`, then `DECK_smokeTest()`. The second prints a deck URL —
   open it and check: the title is real clickable text, the comment box is empty and typeable,
   the blue rectangle never crosses the title or the comment panel, and the README and layout
   slides are gone.
6. Serve `?page=deckbuilder` from the **execute-as-user** deployment (the one TP01 uses).

### Payload notes

A flat-colour table PNG at scale 2 is ~250–450 KB base64. One slide per
`google.script.run` call stays well clear of any limit — **do not batch the whole deck into
one call**. Chart.js canvases capture fine, but call `chart.resize()` and let a frame pass
before `html2canvas`, or the canvas comes back blank.

---

## 9. The Great Merge — one `app.html`, one `app.gs`

**Status: planned, not started. No code written yet.** Branch: `claude/merging-files-plan-5qmmak`.

This section is the whole plan. Another session should be able to pick it up cold, read
only this section plus §3, and continue from whichever chunk is not yet ticked.

### 9.1 The goal, and why

Today the Apps Script project is **43 files** — 16 `.gs` and 21 `.html` plus the README,
a `.pptx` and `tests/`. Every change means finding the right file in the editor, and moving
the project in or out of the script editor means copying files one at a time. The goal is:

> **one `app.html` and one `app.gs`.** Nothing else in the script project except
> `appsscript.json` and the deck template `.pptx`.

Two files means two copy-pastes to move the entire application. That is the whole point,
and it is worth some cost elsewhere (see §9.8).

Secondary goals, explicitly in scope:

- **Legacy goes.** Old functions, unreferenced UI, dead branches, superseded helpers — all
  removed, not carried across. Previously-deployed URLs breaking is acceptable and expected.
- **Navigable comments.** Both files get a table-of-contents banner at the top and a
  consistent section banner before each region, so `Ctrl+F` on a banner name is how you
  navigate a 20,000-line file.
- **A permissions self-check.** A function in `app.gs` that proves every OAuth scope the
  app needs has actually been granted, and says which one is missing when one is not.

### 9.2 The thing that would have broken it

**`app.gs` cannot sit in the live script project next to the files it replaces.**

Apps Script evaluates every `.gs` file into one shared global scope. Two files both
declaring `doGet`, `include`, `getLogo` or `var APP_CONFIG` do not coexist — the last file
evaluated wins, and which one is "last" is the project's internal file order, not something
we control from the repo. Dropping a complete `app.gs` into the live project would silently
re-point the live router and the live config at the new code, mid-build. That is exactly the
"don't break the existing app" failure the merge is supposed to avoid.

`app.html` has no such problem. HTML files are inert until something serves them, so an
`app.html` can sit in the live project indefinitely, costing nothing, as long as no route
points at it.

**That asymmetry sets the order of the whole project:**

1. Build **`app.html` first**, inside the live project, reachable only through a new
   `?page=app` route. It calls the *existing, unchanged* `.gs` backends. Every legacy page
   keeps working untouched the entire time, and each ported page can be diffed against its
   original live side by side (`?page=rmx` vs `?page=app&view=rmx`).
2. Merge the `.gs` files **last**, as a single atomic cutover commit — delete all 16, add
   `app.gs` — at a point where `app.html` is already known good.

The only edit to legacy code before cutover is **one line in `Code.gs`'s `doGet`** adding
the `app` route. It is reversible by deleting that line.

### 9.3 How the pages live inside one HTML file

The naive merge — concatenate the pages — breaks on three collisions. Each has a cheap fix,
and the fixes are what make this tractable:

**Duplicate element IDs.** `#syncBtn`, `#market`, `#banner`, `#kpiFile` and dozens more
exist on several pages. There are ~350 `getElementById` / `querySelector` call sites across
the pages and we do not want to touch any of them.

> **Fix: only one page's markup is ever in the DOM.** Each page's markup lives in an inert
> `<script type="text/html" id="tpl-rmx">…</script>` block. On load, exactly one is injected
> into `#appRoot`. Browsers do not parse `text/html` script blocks as DOM, so the other
> nineteen pages cost a string in memory and nothing else. Every `getElementById` call site
> keeps working **unchanged**, because at runtime the document contains one page, exactly as
> it does today.

**Duplicate JS globals.** Every page declares its own top-level `state`, `fmt`, `boot`,
`render`. Concatenated, they overwrite each other.

> **Fix: each page's JS becomes one IIFE** that registers itself:
> `AMR.page('rmx', { title:…, libs:['xlsx'], boot:function(){…} })`. Everything the page
> declared at top level becomes a local inside that IIFE. **No renaming of any page
> variable.** The only edits are the ~51 inline `on*="…"` handlers across all pages, which
> lose access to the global scope — they become `addEventListener` calls inside the IIFE.

**Duplicate CSS.** Each page's private `<style>` block uses generic names — `.wrap`,
`.rail`, `.panel`, `.card` — with different rules per page.

> **Fix: prefix every selector in a page's block with `body[data-page="rmx"]`.** `<body>`
> carries `data-page` for the one mounted page, so only that page's rules can match.
> Prefixing raises specificity uniformly within a block, so rule order *within* a page is
> preserved; and it raises page rules above the shared `Styles.html` rules, which is the
> direction they already win in today (the page block comes after the shared one in `<head>`).
> Selectors targeting `body` or `:root` themselves get handled by hand, not by the script.

**Navigation does not change.** Today a page switch is a full page load at `?page=rmx`.
That stays true: `doGet` reads `?page=`, `app.html` mounts that one page, done. **We are not
building a single-page app.** Client-side page switching without a reload is a real
possible follow-up (§9.9) but it is not part of this merge, because it would change the
suite's navigation behaviour at the same time as its file layout, and then a regression
could be either.

### 9.4 The shape of `app.html`

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
              AmrLib      lazy CDN loader — Chart.js / html2canvas / SheetJS
              AmrCache    device report cache            (was Shell.html)
              AmrProgress the progress pill              (was Shell.html)
              AmrBoot     the one loading screen         (was Shell.html)
              AmrHelp / AmrSettings modals               (was Shell.html)
              AmrQlikGuide  the QlikView guide aside     (was 7 copies, see below)
              AMR.page()  the page registry + mount      (new)
  </script>
  <script>  §E  SHARED MODULES
              AmrCube AmrKpi AmrSlide AmrDeckSource
              AmrFuelExec AmrPvSlide AmrSegSlide AmrRmxSlide
  </script>

  <script type="text/html" id="tpl-landing">   … markup …   </script>
  <script>  AMR.page('landing',  { … }); </script>
  …one pair per page…

  <script>  AMR.start();  </script>
</body>
```

**The QlikView guide is the first real win.** The floating "Download from QlikView" aside
is currently copy-pasted into seven pages — ~90 lines of identical CSS plus ~50 lines of
identical JS each, differing only in the step text and screenshot IDs. Verified: the CSS
blocks differ by two lines of dead `.wrap`/`.shell` margin drift, the JS by the data array
alone. It becomes one `AmrQlikGuide.mount(steps)` and each page passes its own array —
roughly **900 lines deleted** for zero behaviour change.

### 9.5 The shape of `app.gs`

The `.gs` merge is far less risky than it looks, and this is worth knowing before starting:
**almost everything is already namespaced.** Twelve of the sixteen files are a single
`var NS = (function(){ … })()` IIFE, and the function declarations inside them sit at
column 0 only because the files do not indent IIFE bodies. A grep for `^function` reports 21
apparent collisions; scope-aware inspection shows nearly all of them are IIFE-internal
(`PV`'s `getReport` and `RMX`'s `getReport` never shared a scope) and the codebase already
knows about the real ones — `RMX_Backend.gs` carries the comment *"NOT named
`getCrossReport`: that top-level name already belongs to PV."*

So the merge is close to ordered concatenation. Two rules make it safe:

1. **`APP_CONFIG` goes first.** IIFEs execute at evaluation time, so anything that reads
   config while constructing itself must come after it. (Most read config through a
   call-time `cfg_()` helper and would not care — but ordering it first means none of them
   have to.)
2. **The collision audit must be scope-aware, not a grep.** Before merging, parse each
   file and list genuinely top-level declarations only; merge only after that list has no
   duplicates. Shared private helpers duplicated across namespaces (`toNum_`, `norm_`,
   `gk_`) stay inside their own IIFEs — do **not** hoist them into one shared helper as
   part of this merge. They have drifted apart and unifying them is a behaviour change
   wearing a cleanup's clothes.

Section order in `app.gs`:

```
§1  CONFIG            APP_CONFIG, APP_EXTRA_SOURCES, Settings API   (Config.gs)
§2  ROUTER + PLUMBING doGet, include, getLogo, data-generation, cache helpers  (Code.gs)
§3  PERMISSIONS       APP_verifyPermissions()                        (new — see §9.6)
§4  SYNC              QlikSync.gs
§5  AGG               PV_Backend, PV_Lookup, FSC_Backend, Sask_Backend
§6  RMX               RMX_Backend, RMX_Suggest, RFSC_Backend
§7  OVERVIEW          Ov_Backend
§8  DECK              Deck_Backend, Deck_Recipe
§9  SMALL PAGES       Kpi_Backend, TP01_Backend, IR_Backend
§10 TRIGGERS/DIAG     scheduled triggers, editor-run diagnostics
```

### 9.6 The permissions self-check

`app.gs` gains `APP_verifyPermissions()` — run it from the editor after pasting the file in,
and it reports one line per service.

Two things it must do, because they are different problems:

- **Force the scopes to be requested.** Apps Script decides which OAuth scopes to ask for by
  *statically scanning the code* for service references. A service only reached down a rare
  branch can end up in the manifest anyway, or not, depending on how the scan reads it. The
  function references every service the suite uses, so the scan cannot miss one. This is
  belt-and-braces alongside an explicit `oauthScopes` array in `appsscript.json`, which is
  the reliable mechanism and which this project currently does not have committed.
- **Prove each one actually works** with a harmless read, and return a per-service verdict
  rather than dying on the first failure — so one missing grant does not hide the other six.

Services to cover, from an audit of the current `.gs` files:
`SpreadsheetApp` · `DriveApp` · `MailApp`/`GmailApp` (TP01 only) · `SlidesApp` (Deck Builder)
· `UrlFetchApp` (the logo) · `CacheService` · `PropertiesService` · `ScriptApp` (deployment
URL + triggers) · `LockService` · `Session`.

Note the Gmail scope is requested from everyone on the main deployment, not only TP01
users. That is already true today — it is one script project — and the merge does not
change it.

### 9.7 The chunks

Each chunk is one reviewable commit, ends with the app in a working state, and can be
stopped at. Tick these off as they land.

| # | Chunk | What lands | Review by |
|---|---|---|---|
| 0 | **Plan** | This section. No code. | reading it | ✅ |
| 1 | **Foundations + audit** | `app.html` skeleton: §A–§E, the page registry, `AmrLib`, the deduped `AmrQlikGuide`. Landing + Inventory Report ported. One line added to `Code.gs` for the `?page=app` route. Plus the two audits written up here: scope-aware `.gs` collision list, and the legacy hit-list. | `?page=app` shows the landing page and the Inventory Report, pixel-identical to `?page=` and `?page=inventoryreport` | ☐ |
| 2 | **Fuel pair** | `Page_FuelSurcharge` + `Page_RmxFuel` + `Deck_Fuel`. Deliberately first: `tests/regress.js` already proves these two byte-identical, so the porting method gets validated where there is a real gate on it. | `tests/regress.js` green + both fuel pages side by side | ☐ |
| 3 | **AGG Price & Volume** | `Page_PriceVolume` + `Deck_PV` + `SlideExport` + `KpiShared` + `Cube`. The biggest shared-module load. | `tests/pvcheck.js`, `tests/pvlookup.js`, `tests/slidefit.js` + the page | ☐ |
| 4 | **RMX pair** | `Page_Rmx` + `Page_Segment` + `Deck_RMX` + `Deck_SEG`. | `tests/rmxcost.js`, `tests/segboot.js` + both pages | ☐ |
| 5 | **Overview** | `Page_Overview` alone — 6,021 lines, a quarter of all the client code. Nothing else in this chunk. | `tests/ovperiod.js`, `tests/freshness.js` + the page | ☐ |
| 6 | **Deck Builder + TP01** | `Page_DeckBuilder` + `Deck_Sources` + `Deck_Styles`, and `Page_TP01`. TP01 is served from the second, execute-as-user deployment — that deployment must be re-pointed too. | `tests/deckpath.js`, `tests/deckstatic.js`, `tests/bgrender.js` + a real deck build | ☐ |
| 7 | **`app.gs`** | All 16 `.gs` merged, sectioned and commented. `APP_verifyPermissions()`. `appsscript.json` with explicit `oauthScopes`. Old `.gs` files deleted **in this same commit** — they cannot coexist (§9.2). | `tests/configcheck.js`, `tests/qliksync.js`, `node --check`, then `APP_verifyPermissions()` in the editor | ☐ |
| 8 | **Cutover + sweep** | `doGet` serves `app.html` for every route; `?page=app` scaffold removed; all old `.html` deleted; legacy hit-list executed; this README rewritten around two files. | the whole suite, every route | ☐ |

Chunks 2–6 are independent of each other. If one turns out to be a swamp, the others still
land.

### 9.8 What this costs, honestly

Worth stating so nobody is surprised later:

- **`app.html` will be ~1.0 MB** (1.13 MB of HTML today, less the ~900 lines of guide
  duplication and whatever the legacy sweep takes). **`app.gs` ~515 KB.** Both are far
  inside Apps Script's limits, but the script editor gets sluggish on files this size.
  That is the trade being made deliberately: slower to edit in the browser, trivial to move.
- **Every page load ships every page.** Today `?page=rmx` sends 96 KB; afterwards it sends
  the whole file. HtmlService gzips, so expect ~200 KB on the wire against ~25 KB now.
  The extra is markup the browser skips (inert `text/html` blocks) and CSS it discards on a
  `data-page` mismatch — not extra JS to parse, since each page's code is one small
  registration IIFE that only runs on mount. Acceptable; §9.9 removes it entirely if it
  ever stops being.
- **CDN libraries load lazily** via `AmrLib.need()`, so the Landing page and Inventory
  Report — which need none of them — get faster than they are today.

### 9.9 Deliberately not in this merge

- **Client-side page switching.** Once every page is in one file, switching pages without a
  reload is nearly free and would make the suite feel much faster. It is a separate change
  because it alters navigation behaviour, and doing it here would make any regression
  ambiguous between "the merge broke it" and "the new router broke it".
- **Unifying the duplicated private helpers** (`toNum_`, `norm_`, `gk_`) across namespaces.
  They have drifted; unifying them changes behaviour. Separate change, with its own evidence.
- **Collapsing `Deck_Styles` into the page blocks.** The mirror exists because the deck
  includes the slide *builders* without the *pages* (see §8). Once everything is one file
  that reason weakens — but the rules are `.slide-bare`-scoped and correct today, so they
  come across as-is in chunk 6 and any dedup is proven separately, against captures.

### 9.10 What the plan's own audit checked

Everything asserted in §9.2–§9.5 was measured against the code on 2026-08-17, not recalled:

| Claim | How it was checked |
|---|---|
| 43 files; ~1.13 MB of HTML, ~527 KB of `.gs` | `wc -c` over the tracked `.gs` / `.html` |
| The QlikView guide is duplicated across 7 pages | the blocks diffed pairwise — CSS differs by two lines of dead margin drift, JS by the step array alone |
| ~350 `getElementById` / `querySelector` call sites | counted per page |
| ~51 inline `on*=` handlers | counted per page |
| The `.gs` "collisions" are nearly all IIFE-internal | each `^function` hit traced to its enclosing scope; `PV`'s and `RMX`'s `getReport` never shared one |
| Every `include('X')` resolves | all 11 partial names checked against the file list |
| 43 recipe rows | `Deck_Recipe.gs` parsed — 44 `id:` hits, one of them inside `DECK_getRecipe`'s mapper |
| Routes match §2 | `doGet`'s nine `page === '…'` branches listed and compared |
| Line endings are mixed | `file(1)` — most `.html` CRLF, `Code.gs` LF |

Corrections this audit forced into the rest of the README are logged in §11.

### 9.11 Rules for whoever does the work

- **Nothing is deleted on a hunch.** Every removal needs a repo-wide grep proving zero live
  references, and gets logged in §10 with what proved it. "Looks unused" is not evidence.
- **Legacy hit-list — already confirmed, remove when its chunk lands:**
  - **`Page_Rmx.html`'s `include('Deck_RMX')`.** The page calls nothing in `AmrRmxSlide`,
    and `Deck_RMX`'s only load-time side effect is registering the `rmx` adapter, which
    early-returns without `AmrDeckSource` — a file `Page_Rmx` does not include. 603 lines
    shipped on every Ready-Mix page load to do nothing. Drop the include in chunk 4; the
    module itself stays, the Deck Builder needs it.
  - **`AmrQlik` and the ⇣ Pull-from-QlikView button.** Documented in §4 for a long time;
    neither has ever existed in the code. Nothing to delete — but do not "restore" it.
    `QlikSync.gs` is reached by scheduled trigger only, and its four entry points have no
    client caller. If a Pull button is wanted, that is a feature, not a repair.
- **Legacy hit-list to audit in chunk 1** — audit, do not assume: the `SB` reader /
  `getSlideData` / `syncSlideData` in `Code.gs` (§2 says the Segment page no longer reads
  those tabs, only the Overview does — confirm which); the CUSTOM FLAG LOOKUP path in
  `RMX_Suggest.gs` (`Page_Segment.html:1169` says it is no longer used by either table);
  the `RMX_Backend.gs:1953` "legacy names" wrappers (`getMarkets`, `getKeys`, `getExtras`,
  `syncData`, `uploadRmxData`) — find each caller; the dead nav hook at `Shell.html:321`,
  which says so itself.
- **Line endings.** The repo is mixed today — most `.html` are CRLF, `Code.gs` is LF. The
  merged files should be **one convention throughout** (pick LF, since both files are being
  written fresh). Scripted edits must open with `newline=''` and write explicitly.
- **Comment as you merge, not after.** Every section gets the banner and the "why" note
  while the context is fresh. A 20,000-line file with no signposts is worse than 43 files.
- **Run the harnesses in `tests/` before and after each chunk.** They are the only proof
  available off-platform that a page still renders what it rendered. Two new ones are worth
  adding in chunk 1: `tests/merge.js` (every id a page's JS references exists in that page's
  template; every page CSS block is scoped; no page IIFE leaks a global) and
  `tests/pageparity.js` (old page vs new page under jsdom with `google.script.run` stubbed,
  DOM diffed — the same pattern `regress.js` already uses).
- **Branch.** This work is on `claude/merging-files-plan-5qmmak`, not `main`. Each chunk is
  its own commit on that branch, so any one of them can be reviewed or reverted on its own.

---

## 10. Working conventions

### Delivery

- **Complete files, never patches.** When a file changes substantially, deliver the whole
  file as a drop-in replacement. Surgical edits are fine only for small, clearly scoped
  changes.
- **Fix all instances**, not just the reported one.
- **Single-pass execution** — do all related changes at once.
- **Plan before code** on anything structural; no implementation until the plan is approved.
- **Scope reductions require pre-approval.** Any feature omitted, period model restricted or
  export dropped must be raised *as a question before building*, not announced after delivery.
- Don't over-engineer. The users of this app are non-technical.
- Follow how the proven equivalent already works in the codebase rather than inventing a new
  pattern.

### Code hygiene

- **Preserve CRLF line endings** in all `.gs` and `.html` files.
- Every inline `<script>` block must pass `node --check` before delivery.
- **Bump `APP_CODE_BUILD` whenever backend logic changes**, and bump `CACHE_VER` whenever a
  cache shape changes.
- Prefix every server entry point uniquely — one global namespace, last writer wins.
- Ship diagnostics that make future failures self-explanatory (`RMX_debugMonths()`,
  `debugNaOthers`, `DECK_validateTemplate`). **Replace silent fallbacks with loud banners.**

### Testing

This is Apps Script: it needs live Google Sheets and Slides, so most of it cannot be run
outside the deployment. What *can* be done off-platform:

- `node --check` on every inline script block.
- Node harnesses running real backend code against real workbook data (dumped to JSON with
  Python/openpyxl), with jsdom driving real page HTML for render tests.
- Regression suites confirming an existing model produces identical output after a change.

Anything needing SlidesApp, DriveApp, CacheService or a real spreadsheet has to be verified
in the deployment by hand.

### Communication

Terse and direct. Brief corrections expected and given; absorb a correction and continue
without re-litigating it. Ask only the minimum necessary clarifying questions, and use
structured multiple-choice prompts for design decisions.

---

## 11. Session log

Before each coding session, add a row with what you intend to do. Mark it complete when it
is done. **An unmarked row means the task is either incomplete or was forgotten — check it
before assuming it is finished.**

| Date | Task | Status |
|---|---|---|
| 2026-08-13 | Audit repo against the chat-memory README; rewrite it as a project document reflecting the actual code | ✅ done |
| 2026-08-13 | Deck Builder Phase 0b — fix the `Deck_Backend.gs` bugs (6 found, 6 fixed); validate the committed template offline | ✅ done |
| 2026-08-13 | Deck Builder Phase 1 — `Page_DeckBuilder.html`, `Deck_Sources.html`, `AmrSlide.captureBare`, `Deck_Recipe.gs` (43 rows) | ✅ done |
| 2026-08-13 | Deck Builder Phase 2 — extract the fuel exec tables into shared `Deck_Fuel.html`; both fuel pages delegate; `fsc` + `rfsc` adapters live | ✅ done |
| 2026-08-13 | Deck Builder Phase 3 — `Deck_PV.html`; PV page delegates; `pv` + `cust` adapters live; per-row KPI Region picker on the Deck Builder | ✅ done |
| 2026-08-13 | Deck Builder Phase 4 — `Deck_SEG.html` + `Deck_RMX.html`; `seg` + `rmx` adapters live; template/folder IDs set; recipe mapped onto the four content layouts | ✅ done |
| 2026-08-14 | **Half of the Phase 4 debt paid** — `Page_Segment.html` delegates its slide content, KPI cards and fitter to `AmrSegSlide`; `tests/deckstatic.js` fails if a second copy comes back | ✅ done |
| | **The other half** — make `Page_Rmx.html` delegate to `AmrRmxSlide` instead of holding a duplicate copy | ☐ |
| 2026-08-13 | `DECK_CONFIG.TEMPLATE_ID` + `FOLDER_ID` set to the live template and deck folder | ✅ done |
| | **Add the Slides + Drive scopes and serve `?page=deckbuilder` from the execute-as-user deployment**, then run `DECK_validateTemplate()` | ☐ |
| | Deck Builder Phase 3 — `pv` + `cust` adapters (19 slides) | ☐ |
| | Deck Builder Phase 4 — `rmx` + `seg` adapters (20 slides) | ☐ |
| 2026-08-13 | AGG slide layout — fill the frame: bigger charts, bigger table type, KPI strip grown without clipping, and `tests/slidefit.js` to hold it there | ✅ done |
| 2026-08-14 | Product Segment slide — the same treatment: fit to the frame instead of letting `build()` scale the stack, so the KPI strip is readable on a deck slide | ✅ done |
| 2026-08-14 | The on-page KPI strip (Price & Volume + Segment) and *Download KPI PNG* — sized by `AmrKpi`, one clean row, nothing clipped | ✅ done |
| 2026-08-14 | Ready-Mix speed — `getKeys` / `getExtras` / `getSlideTables` cache their finished payload per market+period+month, the way `PV.getReport` always has | ✅ done |
| 2026-08-14 | The Segment page warms every market in the background; Ready-Mix shows its loading screen before the call that is slow, not after | ✅ done — **superseded 08-17**, see below |
| 2026-08-17 | **Found the real cost**: every RMX call re-read the 14 MB bundle (160 cache chunks) to produce a 72 KB answer. `RMX_prepare` does it once; `tests/rmxcost.js` is the evidence and the gate | ✅ done |
| 2026-08-17 | Both Ready-Mix pages open on ONE call, with ONE loading screen, and no client-side warm loop; `RMX_getMarkets` and the boot-time Mapping check are off the critical path (`tests/segboot.js`) | ✅ done |
| 2026-08-17 | The RMX Segment deck rows lose their KPI Region dropdown — `AmrKpi.rmx` resolves by market name and reads no region sheet, so the control did nothing | ✅ done |
| 2026-08-17 | **Audited the other backends** for the same shape. PV and the Overview already answer from a cached result before touching their pivot — nothing to do. **FSC and RFSC cached nothing at all**: a full `getDataRange()` of the raw tab on every call, no result cache. Both layers cached now (`tests/fscheader.js` proves one sheet read for two identical calls) | ✅ done |
| 2026-08-17 | `RMX_prepare` returns **every** market's payload, so a market switch costs no server call — the way Aggregates already worked | ✅ done |
| 2026-08-17 | **One loading screen** across the suite: `AmrBoot` holds it until every named step lands, `AmrProgress` gained a 400 ms grace so quick work paints nothing, and `done()` ticks are gone from every report page | ✅ done |
| | TP01, the Inventory Report and the Landing page have no boot screen wired — they read no report data, so there may be nothing to do. Check before adding one | ☐ |
| 2026-08-17 | **Planned the merge to one `app.html` + one `app.gs`** — see [§9](#9-the-great-merge--one-apphtml-one-appgs). Eight chunks, ordered around the finding that `app.gs` cannot coexist with the files it replaces | ✅ plan only, no code |
| 2026-08-17 | **Audited this README against the code.** Three classes of error found and fixed: (1) **every one of the 34 recorded line counts was stale** — `Shell.html` was documented at 781 lines and is 1037, `Deck_PV.html` at 869 and is 1391 — so the Lines columns are gone rather than corrected; (2) **`AmrQlik` was documented as core shared runtime and does not exist** — no client file references it, no ⇣ Pull-from-QlikView button exists on any page, and none of `QlikSync.gs`'s four entry points has a client caller, so the sync is trigger-driven only; (3) **`Deck_RMX.html` was described as the RMX page's compute layer** — `Page_Rmx.html` includes it and calls nothing in it, and its adapter registration no-ops without `AmrDeckSource`, so it is 603 inert lines on every Ready-Mix load | ✅ done |
| | **The rest of the README is not yet line-by-line verified.** §5 (sheet IDs, tab names, market lists), §6 (caching model) and §7 (domain rules) are the ones that would hurt most if stale, and they are the ones a merge session will be leaning on. Verify §7 against the code before trusting it in a chunk | ☐ |
| | **The de-bloat is deliberately deferred to chunk 8.** This file is ~1,340 lines and describes a 43-file layout that chunks 1–7 delete. Restructuring it now means writing it twice; the rewrite lands with the cutover, against two files | ☐ |

### What has and has not been run

This is Apps Script, so nothing touching SlidesApp, DriveApp or a spreadsheet can be
executed outside the deployment. What was actually verified for the work above:

- ✅ `node --check` on every changed `.gs` file and every inline `<script>` block.
- ✅ `DECK_getRecipe()` executed in Node: 43 rows, no duplicate ids, no missing fields.
- ✅ The committed `.pptx` parsed with python-pptx and checked against the same contract
  `DECK_validateTemplate` enforces — page size, layout tags, token uniqueness, no tokens
  nested inside groups, slot geometry.
- ✅ Every layout the recipe asks for confirmed present in the template.
- ✅ **Phase 2 extraction proved behaviour-preserving.** Pre- and post-extraction code run
  over the same model, HTML diffed: 12/12 byte-identical, across both pages, all three period
  modes, with and without user overrides + a hidden market.
- ✅ **The deck's own path exercised under jsdom** (`Deck_Sources` → `Deck_Fuel` →
  `AmrDeckSource.build`): both adapters register, all four fuel slides produce two exec
  tables with `contenteditable` stripped and the right period heading, an unregistered
  source rejects with a readable sentence, and each backend is called exactly **once**
  across its two slides.
- ✅ Every `include('X')` in every page resolves to a file that exists.
- ✅ **The AGG slide laid out in real Chromium** (`tests/slidefit.js`): the deck's own block,
  in the deck's own frame, through the deck's own fitter, over six frame shapes and payloads
  — nothing clipped, nothing overflowing, no white band under either column. The same run
  against the pre-change fitter fails four of the six cases, which is the point of it.
- ❌ **Not run:** `DECK_create` / `addSlide` / `finish`, the pages themselves in a real
  browser, and any capture through html2canvas. Those need the live deployment.

The two harnesses are worth keeping — they are the regression gate for Phases 3–4. Rebuild
them as `regress.js` (pre/post HTML diff) and `deckpath.js` (jsdom adapter run); both take a
synthetic model and need no Google access.

### Corrections made to the previous README

The old README was a paste of two chat-memory summaries. These points were wrong or stale:

- **"Deck Builder (planned but not yet built)"** — the server half (`Deck_Backend.gs`, 664
  lines) *is* built, the route and nav are wired, and two page adapters are registered. What
  is missing is the page, the registry, `captureBare`, and the recipe.
- **"Five server-side functions planned"** — all five exist, plus `DECK_validateTemplate` and
  `DECK_smokeTest`. They have never been run.
- **"pptxgenjs (deck template generation)"** listed as a frontend lib — it is not loaded by
  any page. The template was generated once, in chat, outside this project.
- **"Carrier Scorecard"** was listed as a page — there is no such page or route.
- **"Slide Builder"** as a distinct page — `?page=segment` is the *Commercial Product Segment*
  page, and it reads the Ready-Mix workbook via `RMX_getSlideTables`, not the pre-summed Slide
  Segment tabs. Those tabs are still read by `getSlideData()` in `Code.gs`, but only for the
  Overview.
- **`KPI_Backend.gs`** — the file is `Kpi_Backend.gs` (lowercase `pi`).
- The "on the horizon" note about rebuilding RMX Fuel Recovery to mirror the AGG page is
  **done**: both pages now carry the same exec views, `buildExecTables(period)`,
  `buildContentFor(period)` and a deck adapter.
