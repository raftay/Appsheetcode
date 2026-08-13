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
9. [Working conventions](#9-working-conventions)
10. [Session log](#10-session-log)

---

## Working on this repo — read first

**Commit straight to `main`. Do not open pull requests.** Everything in this repo goes to
`main` directly; a PR just adds a review step nobody is waiting on and leaves branches to
clean up. If you are an agent picking this up: check out `main`, commit there, push there.

Two things that will bite you if you skip them:

- **Preserve CRLF line endings** in every `.gs` and `.html` file. Scripted edits must open
  files with `newline=''` and write `\r\n`, or the whole file shows as changed.
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

| File | Lines | Role |
|---|---|---|
| `Code.gs` | 339 | Router (`doGet`), `include()`, `getLogo()`, data-generation helpers, chunked cache helpers, `syncAll()`, and the `SB` Slide-Builder sheet reader |
| `Config.gs` | 510 | `APP_CONFIG` — every sheet ID, tab name, market list, cube constants — plus the Settings API |
| `PV_Backend.gs` | 1393 | AGG Price & Volume aggregation |
| `PV_Lookup.gs` | 334 | REGION LOOKUP mapping-check for Price & Volume |
| `RMX_Backend.gs` | 1735 | Ready-Mix PPI/ASP engine; also serves the Segment page via `RMX_getSlideTables` |
| `RMX_Suggest.gs` | 575 | Lookup-miss suggestions (PRODUCT MASTER / CUSTOM FLAG / EXTRAS), three independent models |
| `Ov_Backend.gs` | 1453 | Executive Overview aggregator + the closed-year history cube |
| `FSC_Backend.gs` | 581 | AGG fuel recovery |
| `RFSC_Backend.gs` | 898 | RMX fuel recovery |
| `Sask_Backend.gs` | 240 | Saskatchewan per-customer mid-year price increase (read + name matching only) |
| `Kpi_Backend.gs` | 181 | Shared EBITDA KPI workbook values in a Drive folder |
| `QlikSync.gs` | 898 | Pulls QlikView exports out of Drive and replaces sheet tabs; scheduled triggers |
| `TP01_Backend.gs` | 72 | Transfer Price — per-market email send, recipients in User Properties |
| `IR_Backend.gs` | 76 | Inventory Report — stores/derives a Drive PDF file ID (never touches DriveApp) |
| `Deck_Backend.gs` | 714 | Deck Builder server plumbing: template geometry, create/addSlide/finish/status, validator. See §8 |
| `Deck_Recipe.gs` | 208 | **Config, not code** — which 43 slides the deck contains, in order, plus `DECK_getRecipe()` which checks them |

### Client (`.html`)

Shared partials, pulled in with `<?!= include('Name') ?>`:

| File | Lines | Role |
|---|---|---|
| `Styles.html` | 215 | The one stylesheet — Amrize colour tokens (navy `#011E6A`), reset, every shared component. Goes in `<head>` |
| `Shell.html` | 781 | Shared runtime: page switcher (`AMR_PAGES`), Help modal, ⚙ Settings modal, `AmrCache`, `AmrQlik`, `AmrProgress` |
| `SlideExport.html` | 305 | `AmrSlide` — the 1600×900 slide frame, whitespace sliders, full-window viewer, html2canvas PNG export, and `captureBare` for the deck |
| `KpiShared.html` | 373 | `AmrKpi` — upload/parse/share the EBITDA workbooks; used by three pages |
| `Cube.html` | 622 | `AmrCube` — the month fact table in typed arrays, backed by IndexedDB |
| `Deck_Sources.html` | 104 | `AmrDeckSource` — the content-source registry the Deck Builder asks for tables. Included **only** by the Deck Builder |
| `Deck_Fuel.html` | 298 | `AmrFuelExec` — the Fuel Recovery exec tables, shared by **both** fuel pages and the deck. Also holds the `fsc` / `rfsc` adapters |
| `Deck_SEG.html` | 535 | `AmrSegSlide` — RMX Product Segment slide content; holds the `seg` adapter |
| `Deck_RMX.html` | 588 | `AmrRmxSlide` — RMX Price & Volume: the client-side compute layer, the table renderers, and the offscreen-host scrape; holds the `rmx` adapter |
| `Deck_PV.html` | 869 | `AmrPvSlide` — the AGG Price & Volume slide content (KPI strip, dimension tables, waterfall charts) and the customer block. Shared by the PV page and the deck; holds the `pv` / `cust` adapters |

Page files: `Landing.html`, `Page_Overview.html` (5602 lines), `Page_PriceVolume.html`
(2543), `Page_Rmx.html` (1666), `Page_Segment.html` (1381), `Page_FuelSurcharge.html`
(1069), `Page_RmxFuel.html` (1067), `Page_TP01.html` (1097), `Page_InventoryReport.html`
(239).

Third-party libraries are loaded from CDN per page: Chart.js, SheetJS (XLSX),
html2canvas.

---

## 4. Shared runtime

Everything below lives in `Shell.html` unless noted.

- **`AMR_PAGES`** — the page-switcher list. Adding a page means one line here, one line in
  `doGet`, and (optionally) a card in `Landing.html`.
- **`AmrCache`** — device-level report cache in `localStorage`, keyed by a data-generation
  token. No expiry: entries stay valid until the token moves.
- **`AmrQlik`** — the per-page ⇣ *Pull from QlikView* button, wired to `QlikSync.gs`.
- **`AmrProgress`** — the shared progress pill.
- **`AmrCube`** (`Cube.html`) — the browser-side month fact table. Reads its column layout
  from the server's manifest (`man.dims` / `man.vals`), never hardcoded. Persisted to
  **IndexedDB**, not `localStorage` — the cube is a few MB and `localStorage` stores UTF-16,
  so a 5 MB payload occupies ~10 MB and gets evicted.
- **`AmrSlide`** (`SlideExport.html`) — builds a fixed 1600×900 slide off-screen: a header
  with title/subtitle/logo, then the page's content node inside four adjustable blank
  bands (left/right default 120px, top/bottom 30px). `previewInto` renders a scaled live
  preview, `viewSlide` shows it full-window, `exportSlide` captures to PNG with
  html2canvas.

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

Scheduled sync triggers fire at 2 PM, one per data source.

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
| `AmrCache` | `localStorage` | device-level report cache, no expiry, keyed by generation token |
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

### The reporting month

Always **last calendar month** (current month − 1), computed from the clock — never derived
from the data. The QlikView `MyMonth` column is a bare month name with no year and carries
every month of the prior year, so a maximum-based scan always returns December. `latestMonth_`
is capped at last calendar month for year-less values only; year-bearing history values
(`Aug-25`) are not capped.

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

So: the pipeline is complete end to end and the four Fuel Recovery slides build all the way
through. The remaining 39 rows are waiting on their adapters, and the Plan stage names the
missing sources up front rather than failing 39 times.

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

## 9. Working conventions

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

## 10. Session log

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
| | **Pay down the Phase 4 debt** — add SEG/RMX before-after harnesses, then make `Page_Segment.html` and `Page_Rmx.html` delegate instead of holding duplicate copies | ☐ |
| 2026-08-13 | `DECK_CONFIG.TEMPLATE_ID` + `FOLDER_ID` set to the live template and deck folder | ✅ done |
| | **Add the Slides + Drive scopes and serve `?page=deckbuilder` from the execute-as-user deployment**, then run `DECK_validateTemplate()` | ☐ |
| | Deck Builder Phase 3 — `pv` + `cust` adapters (19 slides) | ☐ |
| | Deck Builder Phase 4 — `rmx` + `seg` adapters (20 slides) | ☐ |

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
- ❌ **Not run:** `DECK_create` / `addSlide` / `finish`, the page in a real browser, and any
  capture through html2canvas. Those need the live deployment.

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
