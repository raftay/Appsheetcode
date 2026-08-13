# Appsheetcode


CHAT MEMORY FROM PREVIOUS DEVELOPMENT MAY BE OUTDATED OR HAVE INNACURACIES 

you  can go through and confirm to make sure its accurate
for first session review everything here and the code and re write into a proper project document

and before every coding session right what you will do and when complete market it 
if not market complete that means that this task is not complete or was forgoten to marke complte so you must check it 

Purpose & context

Rafay is building the Amrize Commercial Suite, a multi-page Google Apps Script web application serving Central Canada commercial reporting for Aggregates (AGG) and Ready-Mix Concrete (RMX) business lines. The suite reads from QlikView-sourced Google Sheets and renders interactive dashboards, slide exports, and executive reporting tools. Pages: AGG Price & Volume, RMX Price & Volume, RMX Product Segment, AGG Fuel Recovery, Transfer Price (TP01), and Executive Overview.

Design system: Archivo/Inter fonts, navy blue token system (--blue-80, --blue-20, --pos, --neg), shared components (Shell.html, Styles.html, SlideExport.html/AmrSlide engine, KpiShared.html, AmrProgress pill).

Core data sources: QlikView exports (.xlsx) loaded into Google Sheets; EBITDA KPI workbooks (main AGG/RMX report + Manitoba/Saskatchewan variant) stored in shared Drive folder; Saskatchewan FSC tracked separately as per-customer mid-year price increases via Sask_Backend.gs.

Markets (canonical → page-specific names): North, Saskatchewan, Manitoba, Southwest/HNS_SW, GTA Agg/Innocon. Central Canada = all-markets rollup (browser-side merge, no dedicated sheet tab).

Current state

Executive Overview page (?page=overview, first Landing card, OV_Backend.gs + Page_Overview.html):

Read-only dashboard; no sheet of its own; reuses PV.getReport + RMX.getKeys; never blends AGG and RMX lines
Global MTD/YTD toggle + multi-select market chips; client-side recompute is instant, only period changes hit server
Two KPI rows (AGG in tonnes, RMX in m³): Volume/ASP/PPI cards. PPI card labelled simply "PPI"; KPI big number = CY only with "Last year" sub-line
Two side-by-side market panels: CY/PY volume donuts, CY-vs-PY volume bar, horizontal ASP% inc + PPI bar
Customers section (AGG only): top-10 share donut, CY-vs-PY volume bar, table, "Split by segment" toggle
FSC section: by-market table + share pie (always all markets, respects MTD/YTD) + top-10 customers by FSC
Customer data flow: calls getCustomerReport directly per selected market, merges parent rows client-side. Earlier attempt using a new getOverviewCustomers server function hung; switching to the direct PV pattern fixed it
PPI accuracy: RMX rows expose rfiBase/facBase for exact subset PPI. AGG all-markets returns exact aggAll.ppi; single-market is exact; 2+ market subsets use CY-revenue-weighted blend labelled with ⓘ "Estimate for a mix of markets"
Caching: server memoized via APP_cachePut_/APP_cacheGet_ keyed by combined pricevolume+rmx generation tokens + period. Device cache via AmrCache ('ov:MTD'/'ov:YTD', 'c:<period|scope|split>', 'fsc'). Boot deferred to DOMContentLoaded (AmrCache defined in Shell.html, included after main script). FSC uses paint-then-revalidate (no version token)
History cube (Ov_Backend.gs): reads closed-year workbooks registered in APP_EXTRA_SOURCES.overview; ERAS config (newest-first) supports multiple history periods; history JSON stamped with shape/dims/vals — stale files auto-rebuild. getDisplayValues() required for Bill Month (text JUL-26, not Date object)
pyStale() logic: grays out prior-year-derived metrics when selected window exceeds 12 months
Month/Quarter toggle on AGG and RMX trend panels with correct per-bucket ASP/PPI recalculation for quarters

QlikView sync engine (QlikSync.gs, AmrQlik module in Shell.html):

Per-page scoped ⇣ Pull from QlikView buttons; scheduled triggers fire at 2 PM, separate trigger per data source
Data shape: QlikView uses "MyMonth" format (Apr, both years on same row). Slide Segment MTD and Slide Segment YTD are pre-aggregated tabs with no Bill Month column
Extra Raw Data vs Associate Raw Data fingerprinting: scored matcher across 18 category patterns
Report month dropdown on RMX and RMX Fuel pages; bundleOk_() shape guard rejects cached bundles missing months/latestMonth; BUILD stamp on every payload for deployment identification; loud banner replaces silent fallback when backend is out of date

Deck Builder (?page=deckbuilder, standalone page, planned but not yet built):

Three-stage workflow: Plan → Render → Publish (avoids single-shot timeouts)
Template (Amrize_Deck_Template.pptx) with seven layout archetypes identified by LAYOUT: in speaker notes; token placeholders ({{TITLE}}, {{IMAGE}}, etc.)
Config-driven recipe array in Config.gs (~45 slides across AGG P&V, RMX P&V, RMX Segment, Fuel Recovery, Top 10 Customers)
Five server-side functions planned: DECK_readTemplate, DECK_create, DECK_addSlide, DECK_finish, DECK_status
Shared adapter pattern AmrDeckSource.register so existing content builders feed both their own pages and the deck builder
Open questions outstanding: Drive folder destination, Top 10 customer slide structure, SW Land/SW Docks inclusion logic, data sourcing strategy

Key learnings & principles

Architecture:

Overview is strictly read-only aggregator — never recomputes data independently, always defers to base tool caches
getCustomerReport uses cachePutBig_ (not cachePut_) — customer reports exceed the ~900KB silent-drop limit; cacheGet_ reads both formats. Only the customer-report write was switched; getReport still uses cachePut_
APP_URL must live in its own isolated <script> tag before includes; loadData() must be called unconditionally outside any try/catch
Boot sequence must be deferred to DOMContentLoaded when Shell.html (which defines AmrCache) is included after the main script
cachePut_ silently drops payloads beyond ~22.5 MB; Script Properties capped at 500 KB — neither can hold cube data; use IndexedDB for large browser-side caches
Chart instances tracked in per-section registries (e.g., CH.mkt/cust/fsc/fscc) — not one global list — otherwise re-rendering one section destroys other sections' canvases
Grid children default to min-width:auto; add min-width:0 to panels inside grid containers + max-width:100% on canvases to prevent overflow
Shared Styles.html sets thead th background to --blue-80 — pages with plain <table> need explicit white background on th/td to avoid blue-on-blue

Data handling:

Always use getDisplayValues() for Bill Month — Google Sheets parses JUL-26 as a Date object; only getDisplayValues() returns the literal string
Year determination for CY/PY: scan header names for #### pattern, assign larger = CY, smaller = PY — no code changes needed for future year rolls
AGG history export reuses live template; headers may say 2026 Volume over actual 2025 data — read the Year column, never the header
Dictionary remap required when merging per-era history files built with independent dictionaries
cyMonths and pyMonths passed to AmrCube.query must be index-aligned; groupBy:'ym' must map prior-year rows onto their CY slot or the series returns twice as many points with PPI 0
Numeric reconciliation tolerance is 1e-5 relative (measures rounded to 2 decimal places on wire); un-rounded path achieves 1e-15

RMX PPI:

PPI uses plant × mix grain (Qlik's aggr(..., %plant, %material)) — context-dependent per table row, not a static precomputed pivot key
±50% ASP% coverage cap removed to match Qlik behavior; #N/A merge toggle moves only labels (not PPI numbers); group PPIs do not weight-average back to Total — both match Qlik
COVERAGE_CAP removed; fingerprinting hardened from single fuel-surcharge pattern to scored 18-category matcher

FSC / Saskatchewan:

Saskatchewan FSC not in Qlik — tracked as per-customer mid-year price increase in separate sheet; Sask_Backend.gs applies override per raw row before aggregation
Name normalization: non-breaking spaces, en/em dashes, collapsed whitespace, case, punctuation; fallback to unique trailing account codes
Applied tonnes denominator: "applied" = customer-months with actual FSC; reversal/credit rows affect dollar total but not denominator

Extras/VAP:

Applied-to m³ is not addable across extra types (same physical pour counted under each hierarchy group); use total concrete volume as ASP denominator
Revenue-weighted apportionment within a single extra type is correct; double-count flagged by reviewers is between types, not within them

Deployment:

CRLF line endings must be preserved in all .gs and .html files
Every inline <script> block must pass node --check before delivery
The build directory (/mnt/project/) is unreliable with shuffled filenames — Rafay's pasted code is always authoritative
Never deliver patches — always complete replacement files
Include diagnostic tools (e.g., RMX_debugMonths(), debugNaOthers) that make future failures self-explanatory; replace silent fallbacks with loud banners

Approach & patterns

Plan before code: no implementation until plan is explicitly approved
Complete files only: never deliver patches; address all instances of a problem across the codebase, not just the reported one
Single-pass execution: do all related changes in one pass to minimize token usage ("do all the drops at the same time")
Minimal targeted edits when the scope is small and well-defined; full rewrites when edits are numerous
Structured decision prompts: multiple-choice confirmations for design decisions before proceeding
Communication style: Rafay is terse and direct, uses shorthand and abbreviations, pushes back clearly when assumptions don't match intent; ask only minimum necessary clarifying questions
Infer intent from brief messages; don't over-engineer; users of the app are non-technical
Consistent patterns: always follow how the proven equivalent already works in the codebase rather than inventing new patterns
Version bumping: bump CACHE_VER / BUILD stamp whenever cache shape changes; stranding old caches via generation token increment (no enumeration/deletion needed)

Tools & resources

Platform: Google Apps Script (single project), Google Sheets as data store, Google Drive for shared KPI workbook storage
Frontend libs: Chart.js, SheetJS (CDN, client-side Excel parsing), html2canvas (PNG slide export), pptxgenjs (deck template generation)
Data sources: QlikView exports → Google Sheets; EBITDA KPI workbooks (Drive-shared); Saskatchewan per-customer rates sheet; closed-year history workbooks (AGG + RMX, multiple eras)
Caching layers: Apps Script CacheService (6-hour max TTL, server-side), Script Properties (generation tokens only), IndexedDB (large browser-side cube data), localStorage/AmrCache (device-level report cache)
Key files: Config.gs, Code.gs, Shell.html, Styles.html, SlideExport.html (AmrSlide engine), KpiShared.html, PV_Backend.gs, RMX_Backend.gs, Ov_Backend.gs, FSC_Backend.gs, RFSC_Backend.gs, Sask_Backend.gs, QlikSync.gs, PV_Lookup.gs, RMX_Suggest.gs, KPI_Backend.gs, Page_Overview.html, Page_PriceVolume.html, Page_Rmx.html, Page_Segment.html, Page_FuelSurcharge.html, Page_TP01.html, Landing.html





CHAT MEMEORY 2 of previosu developments same 

Purpose & context

Rafay builds and maintains the Amrize Commercial Suite, a Google Apps Script web application providing business intelligence dashboards for a Canadian aggregates and ready-mix (RMX) concrete operation. The suite reads from Google Sheets workbooks (fed by QlikView/Qlik exports and SAP data) and serves multiple analytical pages: Executive Overview, Price & Volume (AGG), Ready-Mix (RMX), Fuel Surcharge (AGG and RMX), Product Segment, Transfer Price (TP01), Inventory Report, Carrier Scorecard, and a Slide Builder. Success means accurate, fast-loading dashboards that match Qlik source figures and produce slide-ready PNG exports for business reviews.

Core domain areas: concrete price-performance analytics (PPI/ASP/m³), fuel surcharge recovery, volume/margin reporting, product classification (PRODUCT MASTER, EXTRAS/VAP lookup), plant and market hierarchies (HNS SW, North, Innocon, GTA AGG, SW Ontario, Manitoba, Saskatchewan), and month-over-month/YTD period comparisons.

Current state

Active engineering work spans several interconnected modules:

RMX page: Recently added a fourth lookup miss detector for PLANT LOOKUP (no auto-suggestion, dropdown-only, notification on unmatch). Cache at v15, suggestion cache at sg3. A known live plant miss exists (4Q15-HNS RMX MARKET AREA). The namespace collision bug (RMX_NS capture, RMX_ prefixed entry points) and cache token bug (APP_CODE_BUILD folded into cacheToken_) are resolved.
AGG/Price & Volume page: Schema at v5. Fixed: header row detection (tabHeaderRow_ scoring), month filter on YTD pivot (pvMonthFor_/pvInMonth_), duplicate column name handling in QlikSync.gs, and a performance regression resolved via pvMonthMeta_ lightweight cache entry.
Overview page: Month slider extended to include two closed-year history eras (2023/2024, 2024/2025) with year-aligned chunk planning, dictionary remap for plant label code differences across era files, and per-book session guards. Rolling history module (R12/R18/R24) built for both AGG and RMX tabs. Product-category panel updated to show its reporting month; window mode shows explanatory notice.
RMX Fuel Recovery page: Full RFSC_Backend.gs rewrite validated against July 2026 workbook. Applied m³ correctly sourced from "M3 Applied To" columns in Extra Raw Data, matched via mat_prod_hier_3 containing "fuel surcharge." Coverage = applied m³ ÷ gross (delivered) m³, no cap. Executive Overview RMX fuel panel built as five additive inserts with columnar fact payload fetched once and sliced client-side.
Correct default month: Always last calendar month (current month − 1), computed from the clock — not derived from data. latestMonth_ capped at last calendar month only for year-less values; year-bearing history values (e.g., "Aug-25") are not capped.

On the horizon

RMX Fuel Recovery page needs to be rebuilt to mirror the AGG Fuel Surcharge page (Page_FuelSurcharge) closely, including slide/PNG export and full period model — scope reduction must be raised as a question before building, not announced after delivery.
Rafay pushed back on two unilateral scope decisions at end of the fuel page session; clarifying question was pending.

Key learnings & principles

Scope changes require pre-approval: Rafay explicitly requires that any reduction in scope (features omitted, period model restricted, exports dropped) be raised as a question before building. Announcing omissions after delivery is not acceptable.
No plans, no caveats, no incremental passes: When asked to rewrite a file, rewrite it completely in one go. Do not propose phased approaches, flag risks speculatively, or add reconciliation steps unless asked.
Applied m³ and FSC dollars must both come from Extra Raw Data: The Main Raw Data volume-proportional spread is only accurate at the plant-month total level; it misallocates by segment, making Extra Raw Data the correct source for any filtered view.
Cache invalidation is critical: Code changes alone don't clear stale cached tables. Cache tokens must incorporate a build stamp (APP_CODE_BUILD). Schema/cache version bumps are required after structural changes. syncAll() on spreadsheet ID save already strands server and device caches simultaneously.
Apps Script global scope collision: All .gs files share one global namespace; last writer wins. Entry points must be uniquely prefixed (e.g., RMX_) and namespace objects captured at evaluation time.
cachePut_ vs cachePutBig_: cachePut_ silently bails above ~900KB, causing cache writes to be skipped entirely. Always use cachePutBig_ (chunked) for pivot and raw tab caches.
QlikView data quirks to anticipate: Bill Month spelling inconsistencies ("Jul-26" vs "July-26") break SUMIFS joins. Duplicate column names require first-unused matching. Pre-aggregated tabs (Product Segment) have no month column and cannot be re-sliced. mymonth columns contain bare month names with no year — maximum-based month detection always returns December without a clock-based cap.
SAP code matching over description matching: Product descriptions get renamed (e.g., WEATHERMIX → TEMPTECT); SAP numeric codes in the prefix remain stable and are the reliable matching key.
Strength class assignment rule: Only assign when a number appears directly adjacent to an MPa marker in the text. Bare numbers in product names or class tokens do not count; default to Others.
Coverage formula (RMX): Uses Qlik's actual floors (pyVol > 1, cyVol > 1, pyRev > 110, cyRev > 110) from APP_CONFIG.CUBE.COVERAGE.rmx to prevent drift.
ASP denominator: By-extra-type summary tables use total concrete m³ (additive across types). Detail tables (Extras/VAP) use applied m³ (per-applied-unit basis, explicitly labeled).
Cross-origin iframe limitation: Drive /preview embeds are cross-origin; custom zoom controls cannot coexist cleanly with Drive's native controls.

Approach & patterns

Validation against real workbooks: All backend changes are validated using Node.js harnesses running actual backend code against real workbook data (via Python/openpyxl dumps to JSON), with jsdom driving real page HTML for render tests. Regression suites confirm existing models produce identical output after changes.
Complete file rewrites preferred: Rafay prefers receiving complete drop-in replacement files over diffs or patch instructions, especially when changes are substantial. Surgical diffs are acceptable only for small, clearly scoped changes.
Client-side filter engine: getCrossData ships a dictionary-encoded columnar dataset to the browser once per period; filters computed locally in tens of milliseconds. LocalStorage caching restricted to primary slices only.
Corrections absorbed without re-litigation: When Rafay corrects a factual claim mid-session, the correction is absorbed and work continues. Claude does not re-litigate corrected points.
Communication style: Terse, direct, technical shorthand. Brief corrections expected and given. No explanatory footnotes in rendered output tables. Errors called out concisely.
Performance: Lightweight cache entries (e.g., pvMonthMeta_) used to resolve metadata without enriching full datasets. Background key warming. Columnar payloads to minimize transfer size.

Tools & resources

Platform: Google Apps Script (server), HTML/CSS/JS (client), Google CacheService (chunked, server-side), localStorage/IndexedDB (AmrKpiStore, AmrCache, client-side)
Data sources: QlikView exports → Google Sheets workbooks; SAP-originated data; monthly workbooks (e.g., Jul_2026_CCAN__RMX_PPI__6.xlsx, CPI Combined Central Canada AGG Price & Volume Report, FSC workbooks)
Key libraries: SheetJS (XLSX) for client-side workbook parsing, Chart.js for charts, jsdom for server-side render testing
Typography: Inter (body/UI, tabular numerals) + Archivo (headings/brand) — loaded in Shell.html or page <head>, not in Styles.html
File conventions: Styles.html for CSS tokens; Shell.html for shared nav/runtime; Cube.html shared include for AmrCube; /mnt/project/ for project files; outputs to /mnt/user-data/outputs/
Key backend modules: RMX_Backend.gs, RMX_Suggest.gs, PV_Backend.gs, FSC_Backend.gs, RFSC_Backend.gs, Ov_Backend.gs, QlikSync.gs, Config.gs, Code.gs, TP01_Backend.gs, IR_Backend.gs, Sask_Backend.gs, KpiShared.html
