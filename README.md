# Amrize Commercial Suite

A single Google Apps Script web app serving Central Canada commercial reporting for
Aggregates (AGG) and Ready-Mix Concrete (RMX). It reads QlikView exports landed into Google
Sheets and renders interactive dashboards, editable executive tables, slide-ready PNG
exports, and a monthly Google Slides deck.

**The script project is three files: `script.gs`, `app.html` and `appsscript.json`.** No
folders, no build step, no package manager — paste those three into the script editor and it
runs. `tests/` is Node-only and is **not** part of the project; `tests/threefiles.js` proves
the claim by running the whole application out of a directory holding only those three.

Navigate both merged files by section banner rather than by scrolling: `Ctrl+F` for `§7` in
`script.gs`, `§P rmx` in `app.html`. Each region also carries the name of the file it was
merged from as a locator (`/* ---- RMX_Backend.gs ----`), which is what the commit history
and `PLAN.md` refer to.

> **`script.gs` must not be renamed back to `app.gs`.** Apps Script keys a file by its name
> *without* the extension, so `app.gs` and `app.html` are both the file `app`: the project
> cannot hold both, the editor refuses the second, `clasp push` is rejected, and
> `HtmlService.createTemplateFromFile('app')` — the call `doGet` depends on — stops being
> unambiguous.

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
8. [The Deck Builder](#8-the-deck-builder)
9. [Working conventions](#9-working-conventions)
10. [Session log](#10-session-log)

---

## Working on this repo — read first

> **Agents: read [`PLAN.md`](PLAN.md) at the start of every session.** Several agents work
> here from different accounts with no shared memory; that file is the only context they
> have in common, and it opens with a session-start and session-end protocol. It carries the
> evidence behind every rule below — this document states the rules, `PLAN.md` says what
> broke to produce them. [`CLAUDE.md`](CLAUDE.md) is the short version of both.

**All work happens on `merging-files`.** Never `main`, and no pull requests for it — the
branch is the review surface. `git pull` before you start; another agent may have moved it.

Four things that will bite you:

- **`script.gs` and `app.html` are LF throughout — keep them that way.** The files they were
  merged from were mixed three ways (most `.html` CRLF, `Code.gs` LF, and two `.gs` carried a
  lone `\r` as a line terminator), and three harnesses still read them out of git. A scripted
  edit that touches historical text must open with `newline=''`. `.gitattributes` pins the
  three project files.
- **Most of this cannot be tested off-platform.** Anything touching `SlidesApp`, `DriveApp`,
  `CacheService` or a spreadsheet needs the live deployment. What *can* be checked is the
  client-side compute and render layer — that is what `tests/` is for. Run the relevant
  harnesses before and after touching a page; see `tests/README.md`.
- **`node --check` does not accept `.gs`.** Copy to a `.js` path first.
- **Nothing gets deleted on a hunch.** Every removal needs a repo-wide grep proving zero live
  references, logged in §10 with what proved it. Several things that look dead are
  load-bearing; several that look live are not. Both lists are in `PLAN.md` §11.

**Verify this document against the code before relying on it.** Repeated audits have each
found real errors — stale identifiers, a documented object that never existed, counts that
had drifted. If this file and the code disagree, the code wins; then fix this file.

---

## 1. How it runs

**Not bound to a spreadsheet.** The project is a standalone web app. Each page opens its own
Google Sheet by id, resolved at call time — so one deployment serves workbooks that have no
relationship to each other.

`doGet(e)` validates `?page=` against `APP_PAGES` and serves `app.html`, which mounts one
`<template>` into `#appRoot`. An unknown page name serves the landing page rather than
mounting nothing, and logs a warning. The ten route names are unchanged from the nine-file
era, so old bookmarks still work.

`appsscript.json` pins `executeAs: USER_DEPLOYING` — everything runs as the deploying
account, which is also why `getUserProperties()` is effectively one shared store and why
TP01's market → email map is a single list.

**Its `oauthScopes` array replaces Apps Script's automatic scope detection.** Add a service,
add its scope by hand — nothing warns you, the call just throws for every user.
`APP_verifyPermissions()` (`script.gs` §4) catches it in one editor run. The seven scopes
today are spreadsheets, drive, presentations, script.send_mail, script.external_request,
script.scriptapp and userinfo.email.

---

## 2. Pages and routes

Ten pages, one `<template>` and one `AMR.page()` registration each.

| Route | Page | Reads |
|---|---|---|
| `landing` | The suite home | nothing |
| `overview` | Executive Overview | all three, read-only |
| `pricevolume` | AGG Price & Volume | Price & Volume workbook |
| `rmx` | Ready-Mix | Ready-Mix workbook |
| `segment` | RMX Product Segment (Slide Builder) | Slide Builder workbook |
| `fuelsurcharge` | AGG Fuel Recovery | Price & Volume workbook (`readsFrom`) |
| `rmxfuel` | RMX Fuel Recovery | Ready-Mix workbook |
| `tp01` | Transfer Price Tool | uploaded file + mail |
| `inventoryreport` | Inventory Report viewer | a Drive PDF |
| `deckbuilder` | Deck Builder | the recipe + every page's content |

**Three lists must name the same ten pages** — `APP_PAGES` (`script.gs` §3), `AMR_PAGES`
(`app.html` §D) and the `§P` templates. `tests/merge.js` check 10 is what holds them
together, and `tests/pageswitch.js` proves switching between them leaves nothing behind.

---

## 3. File map

### Server — `script.gs`, one file, one shared global scope

Apps Script evaluates every `.gs` in a project into **one** global scope, which is why there
is now only one file: whichever copy is evaluated last wins, silently, and the project's
internal file order is not something this repo controls. Entry points are prefixed (`RMX_`,
`PV`, `DECK_`, `TP_`, `IR`, `APP_`) and everything real lives inside a namespace IIFE.

| § | Holds |
|---|---|
| §1 | **CONFIG** — `APP_CONFIG`, `OVERVIEW`, `DECK_CONFIG`, `DECK_RECIPE`, `APP_EXTRA_SOURCES`, the Settings API. First on purpose; its banner is the map of every constant worth changing |
| §2 | **LOGGING** — `APP_log`, the `LOG_LEVEL` switch, and the silent-catch census |
| §3 | **ROUTER + PLUMBING** — `doGet`, `getLogo`, the data-generation stamps, the chunked cache, the SB reader |
| §4 | **PERMISSIONS** — `APP_verifyPermissions()`. Read before adding a service |
| §5 | **SYNC** — the QlikView → Sheets engine |
| §6 | **AGG** — Price & Volume, its mapping check, AGG Fuel Recovery, Saskatchewan rates |
| §7 | **RMX** — Ready-Mix, its lookup suggester, RMX Fuel Recovery |
| §8 | **OVERVIEW** — the executive Overview and the month cube |
| §9 | **DECK** — the Slides template reader, the deck writer, the recipe checker |
| §10 | **SMALL PAGES** — KPI workbooks, TP01 mail, Inventory Report |
| §11 | **TRIGGERS** — everything reached from outside the repo |

### Client — `app.html`, one file

| § | Holds |
|---|---|
| §A1 | **TOKENS** — `:root` custom properties. The only place a colour is defined |
| §A2 | **BASE** — reset, typography, form controls, focus |
| §A3 | **COMPONENTS** — every block used by more than one page |
| §A4 | **PAGE CSS** — one block per page, scoped `body[data-page="x"]` |
| §B | **SLIDE CSS** — `.slide-bare` capture styles |
| §C | **TUNABLES** — `AMR_TUNABLES`: the slide frame, every page's whitespace defaults. Runs before §D and §E, whose IIFEs read it while constructing |
| §D | **RUNTIME** — the AMR core: logging, lib loader, nav, modals, the page switcher |
| §E | **SHARED MODULES** — thirteen: `AmrTick`, `AmrCache`, `AmrKpi`, `AmrCube`, `AmrDeckSource`, `AmrPvSlide`, `AmrProgress`, `AmrBoot`, `AmrFresh`, `AmrSlide`, `AmrFuelExec`, `AmrSegSlide`, `AmrRmxSlide` |
| §P | **PAGES** — one `<template>` + one registration per page |

**The settings live at the top of each file, and the top of each file says where the rest
are.** `script.gs` §1 and `app.html` §C are the two banners to read before grepping for a
number; both also name the constants that deliberately stayed beside the code that reads
them.

---

## 4. Shared runtime

`AMR` (§D) owns the shell: logging, the external-library loader, navigation, modals, and the
page switcher that mounts a `<template>` into `#appRoot` instead of reloading.

The thirteen §E modules are the code shared between a page and the deck. The ones worth
knowing before touching a page:

- **`AmrSlide`** — the 16:9 slide frame, the whitespace sliders and every PNG export. Its
  four frame numbers are in §C.
- **`AmrFuelExec`** — the Fuel Recovery exec tables. Both fuel pages and the deck render from
  this one copy, which is what makes them agree.
- **`AmrPvSlide` / `AmrSegSlide` / `AmrRmxSlide`** — the slide content for Price & Volume,
  Product Segment and Ready-Mix.
- **`AmrCube`** — the month fact table, in IndexedDB. What the Overview's window mode is
  computed from.
- **`AmrKpi`** — the shared EBITDA workbooks and the KPI strip.
- **`AmrDeckSource`** — the registry a page uses to offer its content to the Deck Builder.
- **`AmrProgress` / `AmrBoot` / `AmrFresh`** — one loading screen, one boot gate, one "these
  figures are out of date" poll.
- **`AmrTick`** — a timer a background tab cannot throttle. A plain `setTimeout` is clamped
  to one a second when the tab is hidden and one a *minute* after five minutes of it, which
  is exactly how deck rendering is normally used.

`tests/modparity.js` proves every §E module is byte-for-byte the file it was ported from,
with each deliberate edit declared and reasoned. It is the only surviving proof for
`AmrFuelExec` and `AmrPvSlide`.

---

## 5. Data sources and configuration

### Where the data comes from

QlikView exports land in Drive as `.xls`. The sync addresses **three of them by file id**
(`APP_CONFIG.QLIK_SYNC`) — it does not scan a folder and does not identify a file by its
contents. Each is converted to a temporary Google Sheet to be read, and that copy is thrown
away afterwards.

> **The filename does not matter; the file identity does.** Re-exporting *over* an existing
> file is fine. Exporting to a *new* file — same path, same name — gives it a new id, and the
> sync keeps reading the old one until `APP_CONFIG.QLIK_SYNC` is updated.

It writes into:

- **Price & Volume workbook** — `Combined Data CPI Raw`, `Combined Data CPI Other Revenue`,
  plus the typed `REGION LOOKUP` and `TOPLINE REV LOOKUP2` tabs.
- **Ready-Mix workbook** — `Main Raw Data`, `Extra Raw Data`, `Associate Raw Data`, plus
  `PLANT LOOKUP`, `PRODUCT MASTER`, `EXTRAS LOOKUP`, `CUSTOM FLAG LOOKUP`.
- **Slide Builder workbook** — `Slide Segment MTD` / `YTD` and `Slide Product <Market> MTD` /
  `YTD`, all pre-aggregated by QlikView.

Alongside those: the EBITDA KPI workbooks in a shared Drive folder
(`APP_CONFIG.KPI_FOLDER_ID`), the Saskatchewan rates sheet, the inventory PDF, and the
optional closed-year history books (`histagg`, `histrmx`, `histagg2`, `histrmx2`).

### The data version is the sheet's modified time

There is no cache counter to bump. `APP_getGen_(page)` is the **last-modified time of the
workbook that page reads**, plus the code build stamp. Drive already tracks exactly what we
mean, so the version moves when — and only when — the data actually changed: QlikSync writes
a raw tab, or somebody types a row into `REGION LOOKUP`. Nothing has to be told, and nobody
has to remember to press anything.

The Drive lookup is memoised for 30 seconds. `APP_bumpGen_` / `bumpGeneration_` / `syncAll()`
still exist because a dozen call sites use them after writing to a sheet — they no longer
bump anything, they just drop that 30-second copy so the next read sees the new time.

### Syncing: one trigger, and nothing else

**The sync is trigger-only by design and has no UI.** There is no pull button and one is not
wanted — a sync is a minutes-long Drive job, not something to put behind a control a user can
press twice. Set **one** time-driven trigger on `qlikSyncCheck`; 15 minutes costs three Drive
lookups when nothing has changed.

### Per-page sheet overrides

A page's workbook can be repointed at runtime from its ⚙ panel, stored as a Script Property.
`APP_sheetOwner_` redirects a `readsFrom` page to the owning page's key, so a save through a
borrowing page cannot create an orphan; `clearRetiredOverrides()` deletes keys left behind by
a page that no longer owns a workbook. `tests/configcheck.js` is the gate.

---

## 6. Caching model

Four layers, each with a different job:

| Layer | Where | Notes |
|---|---|---|
| `APP_cachePut_` / `APP_cacheGet_` | Apps Script `CacheService` | chunked at 90 KB, **max 250 chunks**, 6 h TTL |
| `cachePutBig_` | `CacheService` | the chunked writer for large payloads — required for customer reports and raw tab caches |
| `AmrCache` | `localStorage` | per-device report cache, no expiry, keyed by generation token. **Caps near 900 KB per entry** — write one market at a time, never a whole set |
| `AmrCube` / `AmrKpiStore` | IndexedDB | multi-MB cube data |

**Invalidation is by generation token, never by deletion.** Every server *and* browser cache
key embeds `APP_sourceStamp_(page) + '.' + APP_CODE_BUILD`. When it moves, every old copy on
every device is stranded at once, with nothing to enumerate.

- **Data changes** move the first part on their own (§5).
- **Code changes** move the second. `APP_CODE_BUILD` is a literal in §3. **Bump it whenever
  backend logic changes** — without it a code fix leaves the data stamp untouched, every
  device keeps serving figures the *old* code computed, and the fix looks like it did nothing.

`getDataVersions(pages)` returns several pages' tokens in one round trip. Apps Script runs one
user's calls end to end, so the Overview's three separate calls cost most of a second of dead
time before the page starts loading.

### The 14 MB bundle, and the shape of the bug it caused

**Never read the whole Ready-Mix bundle to answer one question.** This is the single most
expensive mistake in the suite's history and it hid for a long time because nothing about it
looked wrong. `loadDataCached_()` caching the whole dataset as one object is right — it is
what stops forty thousand rows being pulled out of Sheets again. But `getKeys`, `getExtras`,
`getSlideTables`, `getUnmapped` and `getMarkets` all *opened* with it, so a request producing
a **72 KB** answer moved **14 MB** through `CacheService` to do it, again for the next market
and again for the other period. The tell was a flat 15–24 s per call whatever was asked: the
cost did not vary with the question because it was not the question.

The grouping was never the cost — `tests/rmxcost.js` times it at 0.3 s for all twelve market ×
period selections. **`RMX_prepare` is the one pull:** one execution, one bundle read, every
selection computed and cached under the key its own reader looks in. Three rules came out of
it:

- **`selKey_()` is the only place a per-selection cache key is built.** Two copies of a cache
  key is how you ship a warm pass that writes where nothing reads: every check passes, the log
  looks healthy, and every request still recomputes.
- **A client-side warm loop is not the answer to a slow call.** Twelve expensive reads,
  serially, queued in front of whatever the user does next. Warm on the server, in one
  execution, or not at all.
- **Ship every market to the browser, not one per click.** Warming the server cache is half
  the job; the page still pays a round trip per market otherwise. Aggregates never did that —
  its opening call carries every market, which is why it always felt instant.

**A silent `catch` is a decision, not a style.** Silent is right for an optional cache read
and wrong for everything else. `APP_cachePut_` bails above 250 chunks; that bail is logged at
`warn` precisely because from the outside it is indistinguishable from a cache that is simply
never warm. `tests/logging.js` holds every silent catch to account.

---

## 7. Domain rules that must not drift

Hard-won and expensive to rediscover. Changing any of these changes numbers the business
reconciles against Qlik.

### Reading Google Sheets

- **Always use `getDisplayValues()` for Bill Month.** Sheets parses `JUL-26` into a Date;
  only `getDisplayValues()` returns the literal string.
- **The year is DATA, not a setting — do not add a knob for it.** Every backend reads the
  current and prior year off the workbook's own column names (`"2026 Vol"`, `"#### Volume"`,
  `"Total Revenue - ####"`) and sends `cyYear` / `pyYear` with the payload; every heading
  prints what it was sent. Scan headers for a `####` pattern — larger is CY, smaller is PY.
  Before chunk 23 four data contracts named the year and each failed **silently** on the first
  export of a new year: a full table of zeroes under a heading naming the year that had gone.
  `tests/yearroll.js` runs the suite against a 2031 workbook and is what keeps it that way.
  The only years left in `app.html` are the QlikView guides' sample rows, which illustrate a
  format and are meant to stay put.
- **Never trust history headers.** The AGG history export reuses the live template, so headers
  can read `2026 Volume` over actual 2025 data. Read the Year column.
- **Duplicate column names** require first-unused matching.
- **Bill Month has two header spellings and inconsistent values.** QlikView exports
  `bill_month`; the sheet header reads `Bill Month`. No `norm_` here folds underscores, so
  both are listed explicitly wherever the column is resolved. Values vary too (`Jul-26` vs
  `July-26`), which breaks SUMIFS joins.
- **Bill Month splits each month across two rows** — `Jul-25` carries the prior-year columns,
  `Jul-26` the current-year ones, off-year columns blank. Everything downstream must therefore
  **sum into its bucket before taking any ratio**. ASP, the PPI `covered_()` floors and the PPI
  weight all are. Any new per-row ratio is a bug.

### The reporting month

Always **last calendar month** (current − 1), computed from the clock, never derived from the
data: the export carries every month of the *prior* year, so a maximum-based scan always
returns December. `latestMonth_` takes the newest value literally and is **not** capped — a
Bill Month names its own year, and the closed-year books legitimately end in December. That
stamp (`QLIK_REPORT_MONTH`) is informational only.

Pre-aggregated tabs (Slide Segment, Slide Product) have **no month column at all** and cannot
be re-sliced: whatever month the export was run for, both tabs are for that month.

### RMX PPI

- PPI uses **plant × mix grain** (Qlik's `aggr(..., %plant, %material)`) — context-dependent
  per table row, not a static precomputed pivot key.
- The ±50% ASP% coverage cap and `COVERAGE_CAP` were **removed** to match Qlik.
- The `#N/A` merge toggle moves labels only, never PPI numbers.
- Group PPIs do **not** weight-average back to Total. This matches Qlik; it is not a bug.
- Coverage floors come from `APP_CONFIG.CUBE.COVERAGE.rmx` — two keys, `minVol: 1` and
  `minRev: 110`, which `covered_()` applies to all four figures (both years' volume *and*
  revenue must clear them). `COVERAGE.agg` is deliberately `0 / 0` until the Aggregates Qlik
  expression is to hand.

### Fuel recovery

- **AGG** reads the Price & Volume sheet's `Combined Data CPI Raw`, where the surcharge sits
  on the same row as the volume it was charged on. The old pre-summed Fuel Recovery workbook
  is **retired** — it forced applied tonnes to be inferred from a bucket and they came out too
  high. `PAGES.fuelsurcharge.readsFrom` is enforced by `APP_sheetOwner_`.
- **The header row on `Combined Data CPI Raw` is row 2, not row 1** — the tab sums *above* its
  column names. `headerRow_` scores the first rows and takes the best. Reading row 1 blindly
  produced "missing these column(s): Plant, Year, Month, "#### Volume", New Fuel Surcharge" —
  **five columns lost at once is always a misplaced header, never five renames.** Gate:
  `node tests/fscheader.js`.
- **RMX** applied m³ comes from the `M3 Applied To` columns in `Extra Raw Data`, matched via
  `mat_prod_hier_3` containing "fuel surcharge". Coverage = applied m³ ÷ gross m³, **no cap**.
  Both dollars *and* applied volume must come from Extra Raw Data — the Main Raw Data
  volume-proportional spread is only accurate at plant-month total level and misallocates by
  segment.
- "Applied" tonnes = customer-months with an actual FSC. Reversal/credit rows affect the dollar
  total but **not** the denominator.
- **Saskatchewan has no fuel surcharge.** It has a per-customer mid-year price increase
  ($/tonne from a start date) in its own sheet. Recovery = rate × tonnes billed on or after
  the start date. §6 reads and name-matches; the arithmetic happens once, per raw row.
- Name normalisation for matching: non-breaking spaces, en/em dashes, collapsed whitespace,
  case, punctuation — with a fallback to unique trailing account codes.

### Extras / VAP

- **Applied-to m³ is not addable across extra types** — the same physical pour is counted under
  each hierarchy group it belongs to.
- By-extra-type **summary** tables use total concrete m³ as the ASP denominator (additive);
  **detail** tables use applied m³ (per-applied-unit, explicitly labelled).
- Revenue-weighted apportionment *within* a single extra type is correct. The double-count
  reviewers flag is *between* types, not within them.

### Product classification

- **Match on SAP numeric codes, not descriptions.** Descriptions get renamed (WEATHERMIX →
  TEMPTECT); the numeric code prefix is stable.
- **Strength class:** only assign when a number appears directly adjacent to an MPa marker.
  Bare numbers in product names or class tokens do not count — default to `Others`.

### The `toNum_` / `norm_` / `gk_` family — do NOT unify them

Not three copies: **six `toNum_`, six `norm_` and two `gk_`, across seven namespaces**
(`QLIKSYNC`, `PV`, `PVLOOK`, `FSC`, `SASKRATES`, `RMX`, `RFSC`), in four genuinely different
dialects. There is no safe direction to unify in because **neither dialect is a superset**:

- `PV` reads the text `"5%"` as `0.05`; `FSC`/`RFSC`/`RMX`/`SASK` read it as `5`. PV is right —
  a percent-*formatted* cell already arrives as 0.05, so a `"5%"` reaching `toNum_` is text.
- `FSC`/`RFSC`/`RMX`/`SASK` read `"(1,234)"` as `-1234`. PV read it as **zero** until chunk 20
  — the brackets survived the strip, `parseFloat` gave `NaN`, `NaN` became 0, so the figure was
  *dropped from every sum rather than mis-signed*, which is exactly why nothing looked wrong.

Pick either and you silently break the other under 144 call sites, with nothing failing.
`tests/helpers.js` pins all fourteen definitions to a table of inputs, so a future tidy fails
there with the input that moved.

### The Overview specifically

- It is a **strictly read-only aggregator**. It never recomputes independently, always defers
  to the base tools' caches, and never blends AGG and RMX lines.
- Customer data calls `getCustomerReport` **directly per selected market** and merges parent
  rows client-side. A dedicated `getOverviewCustomers` server function hung; the direct PV
  pattern fixed it.
- PPI accuracy: RMX rows expose `rfiBase`/`facBase` for exact subset PPI. AGG all-markets
  returns the exact `aggAll.ppi`; a single market is exact; **2+ market subsets** use a
  CY-revenue-weighted blend labelled ⓘ *"Estimate for a mix of markets"*.
- `pyStale()` greys out prior-year-derived metrics when the window exceeds 12 months.
- **Period has four settings and only two exist on the server.** `MTD` and `YTD` are what the
  backends answer for. `PMTD` / `PYTD` are the same two shapes one month back, computed in the
  browser from the month cube. `STATE.pick` is the button; `STATE.period` stays the *server*
  period; `STATE.win` is true for both Prev-month picks and any dragged span.
  `windowPeriod()` tests the Prev-month spans FIRST, against the union's own last month — when
  Ready-Mix runs a month ahead of Aggregates a single month is both "Aggregates' MTD" and "the
  previous month", and the two answers drive different panels.
- **A panel with nothing in it is not shown.** One rule, no exceptions: no rows, no data, not
  computable for this window → `hidePanel(bodyId)`. `resetPanels()` runs at the top of
  `renderTab()`. Only genuine *faults* still speak — a sheet that has not been set, a call that
  failed — because those are fixable and the message carries the link.
- **Product Category is a Prev-month panel.** The Slide tabs arrive pre-split, pre-summed, with
  no month column, and the month they are for is the *previous* calendar month while the fact
  tables already run into the current one. Under "This month" it drew July's tabs under an
  August heading. `pcatFits()` shows it only when a Prev-month pick is active AND the month it
  lands on is the tabs' own month, and it is decided FIRST in the Ready-Mix branch so nothing
  later can throw and leave it showing.
- **In window mode the server reports must not paint.** `loadDims` / `loadPM` / `paintRxfPanels`
  still run — they keep the filter lists and the shared cache warm — but they fetch for the
  *server* period, so `srvOwnsAgg()` and an early return stop them repainting a fifth of a
  second after the cube drew the window. For the same reason `renderTab()` tests `winMode()`
  BEFORE `xfActive()`: the cube applies the page's cross-filters itself.
- **What the cube can answer is not a short list.** In window mode the browser builds the plant
  & material explorer, the customer table, both fuel-surcharge panels, the revenue and ASP-mix
  waterfalls and the Ready-Mix ASP build-up. Genuinely absent: the SAP / USGAAP cards, extras
  BY TYPE, Ready-Mix fuel recovery (the type and per-load surcharge are not columns), and the
  surcharge panels outside the current book year (`winFscOk()`).
- History cube: era files are registered in `APP_EXTRA_SOURCES.overview`; `ERAS` is
  newest-first. History JSON is stamped with shape/dims/vals so stale files auto-rebuild. A
  **dictionary remap** is required when merging per-era files built with independent
  dictionaries.
- `cyMonths` and `pyMonths` passed to `AmrCube.query` must be **index-aligned**, and
  `groupBy:'ym'` must map prior-year rows onto their CY slot — otherwise the series returns
  twice as many points with PPI 0.
- Numeric reconciliation tolerance is 1e-5 relative (measures are rounded to 2 dp on the wire);
  the un-rounded path achieves 1e-15.

### Rendering traps

- **Scoping a CSS rule is not a neutral transformation of it.** `body[data-page="x"] ` narrows
  what a selector matches AND raises its specificity by an attribute selector, so a prefixed
  bare `th{}` can start beating shared `.class` rules the original lost to — that cost 673
  computed values on Ready-Mix. Use `:where(body[data-page="x"])`, which adds no weight. And
  the page is not the document: `#appRoot` is a `<main>` between `<body>` and the page, so a
  bare `main{}` restyles the mount. `tests/merge.js` check 8 covers reach, `tests/cssparity.js`
  covers weight.
- **Apps Script runs every `<? … ?>` in an HTML file, comments included**, and its printing
  scriptlet HTML-escapes — so one written as an example in a comment breaks the render, and one
  printed into JavaScript can emit `&#39;` and kill the whole script block. Server values
  belong in a `<body>` data attribute. `tests/merge.js` enforces both.
- **A style element's content is text until its closing tag.** Anything that leaks in is parsed
  as CSS, and CSS error recovery eats the rule after it without a word. §B shipped that way for
  three chunks because a builder split a file on a style tag written in *prose* inside a
  comment. Never write either tag as a literal when you mean to name it. `merge.js` check 9 is
  the gate.
- **A server callback can outlive its page.** `google.script.run` handlers on a switcher-mounted
  page land after `#appRoot` has been emptied, and an unguarded `el.style` throws out of a
  callback nothing is catching. Look the element up and bail if it is gone — in the failure
  handler too. `tests/pageswitch.js` catches these as uncaught page errors.
- Chart instances are tracked in **per-section registries** — `CH` in §P `overview` holds
  fifteen arrays, not one global list. A single list means re-rendering one section destroys
  another section's canvases.
- Grid children default to `min-width:auto`. Panels inside grid containers need `min-width:0`,
  and canvases need `max-width:100%`, or they overflow.
- §A3 sets `thead th` background to `--blue-80`. A page using a plain `<table>` must set an
  explicit white background on `th`/`td` or it renders blue-on-blue.
- Drive `/preview` embeds are cross-origin — custom zoom controls cannot coexist with Drive's
  native ones.
- **A slide fitter must fit to the frame's HEIGHT as well as its width.** `AmrSlide.build`
  scales the whole stack when it overflows — a last-resort clamp, not a layout. It shrinks the
  type the fitter just chose, and because transform-origin is top *centre* it also pulls content
  away from the edges the fitter had just filled. A width-only fitter reads as "the tables are
  huge, everything else is a smear, and there is white down both sides" — which is what the
  Product Segment slides looked like in the July deck. `tests/slidefit.js` fails on any content
  still overflowing its frame.
- **One loading screen means one `AmrProgress` key.** It shows the lowest-order job and lists
  the rest underneath, so several keys raised and cleared at their own moments reads as a
  flicker of half-second screens. Both Ready-Mix pages raise a single `LOAD_JOB`, pass the
  varying part as the job's `note`, and clear it in exactly one place.
- **There is no region to choose on an RMX slide.** `AmrKpi.rmx()` finds a market's block in the
  workbook's `RMX Summary` tab **by name** and reads no sheet index; only the Price & Volume
  cards read a per-region plant statement. A control that cannot affect its output does not
  belong on the page.
- **Every size in a KPI card is `em`, so the row's font-size IS the card's size.** A strip
  dropped into a bare flex row with no font-size inherits the 16px body font and clips its own
  text rather than spilling.

---

## 8. The Deck Builder

One button that produces the monthly Google Slides deck — 43 slides across AGG P&V, RMX P&V,
RMX Segment, Fuel Recovery and Top-10 Customers — where the **title is real editable Slides
text**, the **comment box is a real empty text box**, and only the table is a picture.

### Why an image at all

The tables are the output of the pages' own compute and fitting, in the browser. Rebuilding
them as native Slides tables would mean a second implementation of every layout rule, kept in
step by hand. One picture per slide, captured by `html2canvas` at the slot's own aspect ratio,
is the trade: the numbers come from one place, and everything a human edits afterwards stays
native.

### The template contract

The deck template is a **Google Slides file in Drive** (`DECK_CONFIG.TEMPLATE_ID`), never a
project file. Each layout slide declares itself in its **speaker notes**:

- `LAYOUT: <id>` names the layout. `L_README` is documentation and is skipped; `L_COVER` is
  filled in place by `create()` rather than duplicated, so no recipe row can point at it.
- Token text boxes mark the slots: `{{TITLE}}`, `{{COMMENT}}`, `{{IMAGE}}`, `{{IMAGE2}}`,
  `{{LABEL1}}`, `{{LABEL2}}`, `{{PAGE}}`, `{{DECK_TITLE}}`, `{{DECK_SUB}}`.
- Generated slides are stamped `SLIDE: <recipeId>` in their own notes, which is how a re-run
  knows what already landed and how one failed slide is retried without rebuilding the deck.

`DECK_readTemplate` returns real slot geometry in points, so the in-page preview is a faithful
mock and follows the template when somebody moves a box. **`CAPTURE_MAX_PX: 2048` is not an
arbitrary round number** — it is where Google resamples. Whatever is inserted, an exported deck
comes back with every picture capped at 2048px on its longest side, so asking for 2400 buys a
2400px canvas that Google then bilinear-resamples down, and text rendered at one scale is
squeezed to another. Capturing at the ceiling means the text is rendered once, at final size.

### Three stages, never one shot

Forty-three slides of Slides API round trips do not fit in one execution, and a failure at
slide 40 must not cost the first 39.

1. **Plan** — read the recipe. No data, instant. Untick what this month skips.
2. **Render** — check the source sheets first, then one slide at a time in the browser: ask the
   source for its content block, photograph it, keep the PNG. All the compute is here. The
   source check is *part of* Render rather than a fourth button, because photographing 43
   slides from figures the sheet replaced an hour ago is the one failure this page cannot show
   you — every slide builds, nothing goes red, and the deck is quietly last week's.
3. **Publish** — one `google.script.run` per slide. ~2–4 s each, well inside the 6-minute limit
   because no call ever handles more than one slide.

A row that fails is marked red and left alone; pressing Render again retries only the
unfinished rows.

### The recipe, and changing it

`DECK_RECIPE` (§1) is 43 rows, transcribed from the July 2026 pack. Each row names an `id`
(stable — it is what a retry targets), a `source` registered with `AmrDeckSource`, a `market`
spelled **the way that page spells it**, an optional `refine` (the Southwest Land / Docks
split), a `period`, a `layout`, a `title` and an `optional` flag. `DECK_getRecipe` rejects a
duplicate id or a row with no layout before the build starts rather than at slide 30 of 43.

**Which layout a row uses is editable from the page.** The Plan stage offers every report
layout the template has as a per-row dropdown, and the choice is saved **shared** — one Script
Property (`DECK_CONFIG.PROP_LAYOUTS`), so it is the default everybody gets until somebody
changes it again. Three things about it are deliberate:

- **Only the differences are stored.** A row on its recipe layout has no key. Copying all 43
  rows in the first time anyone touched one would freeze the recipe, and the next person to
  re-point a slide in the code would change nothing and have no way to see why.
- **Changing a layout drops that row's picture** and puts it back on the live render queue. The
  capture's height and pixel width come from the layout's `{{IMAGE}}` box, so a picture taken
  for a full-width slot is the wrong shape for a half-width one — and nothing downstream would
  notice.
- **Validation is at the point of saving, not reading.** `DECK_getRecipe` is Plan's only request
  and must stay instant, so it makes no Slides call; `DECK_setLayout` already has a reason to
  open the template. An override for a row that has left `DECK_RECIPE` is reported rather than
  silently ignored, and an unparseable store falls back to the recipe instead of locking the
  page out of Plan.

Adding, dropping or reordering a slide is still an edit to `DECK_RECIPE` and nothing else.

**Market coverage note:** the source pack has no AGG summary slide for North and no Top 10
slide for Central Canada. That is copied faithfully rather than "corrected".

### Still owed

Nothing off-platform can do any of these. **A real end-to-end build has never been run against
the live deployment** — every adapter is registered and the path is exercised offline, but
`DECK_create` / `addSlide` / `finish` have not run for real, and no capture has gone through
`html2canvas` outside a harness. `DECK_status` is kept until that build says whether the
Publish stage needs it.

---

## 9. Working conventions

### Delivery

Work on `merging-files`, commit with a message that says *why*, and update `PLAN.md` and §10
below at the end of every session that changed anything. A half-finished chunk with no note
beside it is the most expensive thing you can leave behind.

### Code hygiene

- One global scope on the server; one `AMR` namespace on the client. Entry points are
  prefixed; everything else lives inside an IIFE.
- **When you delete code by anchored text, diff the symbol table, not just the syntax.** A cut
  that takes one function too many is still valid JavaScript. The first build of `script.gs`
  lost `RMX_whoWins` that way — the anchor matched *uniquely*, `node --check` passed, every
  structural check passed, and the only thing that noticed was a before/after set difference of
  top-level names. `tests/gsparity.js` checks it now.
- **A comment that says code is dead is not evidence.** `OVERVIEW` carried a banner starting
  `NOT USED` for four chunks while `getOverview` read its market list on every Overview load —
  the label came across in a verbatim merge, which is exactly how a wrong comment outlives the
  thing that made it wrong. Read the code, not the label.
- **A function with no caller in the repo can still be load-bearing.** Three kinds of caller
  live outside it: the time-driven trigger (§11), the editor's Run menu, and Apps Script itself
  calling `doGet`.

### Testing

26 Node harnesses in `tests/`. `npm install playwright chart.js jsdom` at the repo root gets
everything; Chromium is already at `/opt/pw-browsers`. Start with `tests/README.md` — it says
what each one claims and, for the comparison harnesses, exactly how much of that claim still
holds.

**When a comparison stops being wholly true, narrow what it claims to exactly what is still
provable and say so — do not soften the comparison itself, and do not throw away the part that
still holds.** `gsparity.js` and `modparity.js` both carry declared edits for this reason: each
deliberate change is listed with its rationale, and every other byte is still proved verbatim.

**A gate whose second side has to be assembled by hand is a gate that stops running.**
`regress.js` and `pvcheck.js` were deleted for that: they wanted pre-extraction pages staged
into a directory from commits this repo no longer reaches, and the newest copies it does reach
delegate straight back to the modules under test — a comparison that passes whatever either
side does. `gsparity.js` and `apphtml.js` stage from a *commit*, and both still work.

---

## 10. Session log

One row per session. The deep evidence — what broke, what was measured, what was ruled out —
lives in [`PLAN.md`](PLAN.md); this is the index. **An unmarked row means the task is
incomplete or was forgotten.**

| Date | Task | Status |
|---|---|---|
| 2026-08-13 | Audit the repo against the chat-memory README and rewrite it as a project document | ✅ |
| 2026-08-13 | Deck Builder phases 0b–3 — fix six `Deck_Backend` bugs, build the page, the recipe (43 rows), the fuel and PV extractions, the per-row KPI Region picker | ✅ |
| 2026-08-14 | The Overview's window mode, the month cube, and the panel-emptiness rule | ✅ |
| 2026-08-17 | Chunks 1–11 of the merge — the three audits, the runtime, §A1–§A4, and nine pages ported | ✅ |
| 2026-08-18 | **Chunk 12** — 16 `.gs` collapsed into one file. Lost `RMX_whoWins` to a uniquely-matching anchor and caught it only on a symbol-table diff; `gsparity.js` exists because of it | ✅ |
| 2026-08-18 | **Chunk 13, the cutover** — `doGet` serves `app.html` for every route; the 21 legacy `.html` deleted. 37 files are 3 | ✅ |
| 2026-08-18 | **The Ready-Mix specificity audit** — 673 computed values had moved, because scoping a rule raises its specificity. `:where()` and `cssparity.js` | ✅ |
| 2026-08-18 | **§B was malformed from chunk 10** and one rule was silently gone — a builder split a file on a style tag written in prose. `merge.js` check 9 | ✅ |
| 2026-08-18 | Every repointed harness proved green twice — once with the legacy files present, then again with them hidden. Four failed the second run, each with a read the first pass had missed. **Hide before you delete** | ✅ |
| 2026-08-19 | **Chunk 14** — the nav mounts a page instead of reloading; `pageswitch.js` proves it leaves nothing behind | ✅ |
| 2026-08-19 | **Chunk 15** — the `toNum_` / `norm_` / `gk_` census: six, six and two across seven namespaces, four dialects, no safe unification. `helpers.js` pins all fourteen | ✅ |
| 2026-08-19 | **Chunks 16–19** — §B narrowed to what a capture cannot inherit; the fuel pages' cache; `slidecss.js`, `fuelcache.js`, `logging.js`, `settings.js` | ✅ |
| 2026-08-19 | **Chunk 22** — the settings a user changes moved to the top of both files: `script.gs` §1 and `app.html` §C. `tunables.js` proves §C is what the pages said | ✅ |
| 2026-08-19 | **Chunk 20** — `PV.toNum_` stopped dropping accounting negatives. `'(1,234)'` read as **0**, not −1234, so the figure was dropped from every sum rather than mis-signed — which is why nothing ever looked wrong | ✅ |
| 2026-08-19 | **Chunk 21** — the mapping check is keyed on the schema it depends on. `PV.gk_` mixed `SCHEMA_` in and `PVLOOK.gk_` did not, so a schema bump left the check serving a result computed from rows of the old shape | ✅ |
| 2026-08-19 | **Chunk 23 — the year is data, not a setting.** Four data contracts named it and each failed *silently* on the first export of a new year: a complete table of zeroes under last year's heading. `yearroll.js` runs the suite against a 2031 workbook | ✅ |
| 2026-08-19 | **Chunk 24 — which layout each slide uses is a dropdown, not a code push.** Per-row layout picker on the Plan stage, stored shared in one Script Property, differences only. Changing a layout drops that row's picture, because the capture's shape comes from the layout's image box | ✅ |
| 2026-08-19 | **The intermittent landing-page `Cannot read properties of null (reading 'style')` is diagnosed and fixed.** It was RMX's `renderUnmapped`: a `google.script.run` answer landing after the page had been unmounted, with no guard on `#mapHost`. The Price & Volume copy has carried that guard since the Inventory Report fix; this one was missed. Both failure handlers guarded too | ✅ |
| 2026-08-19 | **`regress.js` and `pvcheck.js` deleted.** The pages they diffed against are behind commits this repo no longer reaches, and the newest copies it does reach are one-line delegations to the modules under test — so the diff was a tautology. `modparity.js` is what survives, and its header now says it is the only proof for `AmrFuelExec` and `AmrPvSlide` | ✅ |
| | **`APP_verifyPermissions()` has never been run.** Needs somebody in the Apps Script editor; nothing off-platform can exercise `SpreadsheetApp`, `DriveApp`, `SlidesApp` or `MailApp` | ☐ |
| | **No real deck has been built against the live deployment.** Every adapter is registered and the path is exercised offline, but `DECK_create` / `addSlide` / `finish` have never run. `DECK_status` is kept until that build says whether Publish needs it | ☐ |
| | **One look at the Price & Volume sheet:** whether it carries any parenthesised negatives decides only whether anyone notices chunk 20 — a no-op if it has none, correctly counted figures if it has some | ☐ |
