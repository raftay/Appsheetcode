# Amrize Commercial Suite

A single Google Apps Script web app serving Central Canada commercial reporting for
Aggregates (AGG) and Ready-Mix Concrete (RMX). It reads QlikView exports landed into Google
Sheets and renders interactive dashboards, editable executive tables, slide-ready PNG
exports, and a monthly Google Slides deck.

**The script project is three files: `script.gs`, `app.html` and `appsscript.json`.** No
folders, no build step, no package manager — paste those three into the script editor and it
runs. There is nothing else in this repo that runs: the Node harnesses that used to sit in
`tests/` were removed on 2026-08-25.

**THAT MAKES EVERY OTHER `tests/…` REFERENCE IN THIS DOCUMENT HISTORICAL.** They are kept
because each records what a gate proved and why the behaviour beside it is shaped the way it
is, which is the durable half of a harness. None of them names a file you can run today.
`git checkout <commit> -- tests/` brings any of them back if it is ever wanted.

Navigate both merged files by section banner rather than by scrolling: `Ctrl+F` for `§7` in
`script.gs`, `§P rmx` in `app.html`. Each region also carries the name of the file it was
merged from as a locator (`/* ---- RMX_Backend.gs ----`), which is what the commit history
refers to.

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
9. [Deleting things, and what must not be deleted](#9-deleting-things-and-what-must-not-be-deleted)
10. [Working conventions](#10-working-conventions)
11. [Session log](#11-session-log)

---

## Working on this repo — read first

> **Agents: this file is the whole brief. Read it at the start of every session.** Several
> agents work here from different accounts with no shared memory, so this is the only context
> they have in common. It used to be split three ways: `PLAN.md` carried the 37-file merge and
> the evidence behind every rule, `CLAUDE.md` a summary of both. That merge is finished, so
> `PLAN.md`'s durable half is here and its per-chunk narrative is in the git history, where it
> belongs; `CLAUDE.md` is now a short pointer to this file rather than a second copy of it.
> **Three documents describing one codebase is how the three of them drift apart**, and that
> has already cost this repo real bugs — a `NOT USED` banner on live code, counts that had
> moved, a documented object that never existed. One document, checked against the code.

**All work happens on `merging-files`.** Never `main`, and no pull requests for it — the
branch is the review surface. `git pull` before you start; another agent may have moved it.
One commit per piece of work, so any of it can be reviewed or reverted on its own.

**Leave the next agent a usable state.** Anything you learned that the next person would
otherwise rediscover goes in *this file*, not in a commit message — nobody reads commit
messages before starting. A half-finished job with no note beside it is the single most
expensive thing you can leave behind.

Four things that will bite you:

- **`script.gs` and `app.html` are LF throughout — keep them that way.** The files they were
  merged from were mixed three ways (most `.html` CRLF, `Code.gs` LF, and two `.gs` carried a
  lone `\r` as a line terminator). A scripted edit that touches historical text must open with
  `newline=''`. `.gitattributes` pins the three project files.
- **Most of this cannot be tested off-platform, and there is no harness here now.** Anything
  touching `SlidesApp`, `DriveApp`, `CacheService` or a spreadsheet needs the live deployment.
  What is left is `node --check` on a copy of `script.gs`, and `APP_verifyPermissions` in the
  editor — see [§10 Testing](#testing).
- **`node --check` does not accept `.gs`.** Copy to a `.js` path first.
- **Nothing gets deleted on a hunch.** Every removal needs a repo-wide grep proving zero live
  references, logged in §11 with what proved it. Several things that look dead are
  load-bearing and several that look live are not — [§9](#9-deleting-things-and-what-must-not-be-deleted)
  is the list and the proof rule.

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

`appsscript.json` pins `executeAs: USER_DEPLOYING` — every **web request** runs as the
deploying account, which is also why `getUserProperties()` is effectively one shared store and
why TP01's market → email map is a single list.

**`executeAs` does not govern the triggers, and this is the trap.** An installable trigger runs
as **whoever created it in the Triggers UI** — not the script owner, not the deployer, not the
person whose browser is open. Two identities, two consent screens, two sets of Drive and Gmail
access, and nothing anywhere reports the mismatch: if the deployer and the trigger-creator are
different accounts, the pages serve one account's Drive while `qlikSyncAggregates` and its two
siblings write from another's, `inventoryReportMailCheck` reads another's mail, `tp01ReportMailCheck` reads
another's mail **and sends the exceptions report under another's name**, and `APP_warmCaches`
warms every page's figures out of another account's Drive. **Create all six
triggers from the account that deployed the web app**, and if you are ever unsure which one
that is, `APP_verifyPermissions()` prints the effective user — run it from the editor, and read
the `ran` line of a trigger's own execution log to see who a firing actually ran as.

**Whether the triggers exist at all is the other half of that**, and until recently
nothing in the project could answer it: none of them is created in code (§11 — the single
`ScriptApp.newTrigger` in the codebase arms the sync's one-shot retry and nothing else), so a
timer that was never added — or was deleted — leaves no trace anywhere, raises no
error, and writes no log line, *because nothing runs*. `APP_verifyPermissions()`'s `ScriptApp`
row names all three targets and says which of them are armed. **It sees only the caller's own
triggers**, which is the platform's rule and not a limitation of the check — and it is the same
rule as above, so "NOT SET" run from the deploying account is the answer that means something.
A missing trigger does not fail the row; it is a configuration fact, not a missing grant.

**Its `oauthScopes` array replaces Apps Script's automatic scope detection.** Add a service,
add its scope by hand — nothing warns you, the call just throws for every user.
`APP_verifyPermissions()` (`script.gs` §4) catches it in one editor run, reporting one line
per service rather than dying on the first failure, so a missing grant cannot hide the other
six. Each of the eight scopes was traced to a real call:

| Scope | What needs it |
|---|---|
| `auth/spreadsheets` | `SpreadsheetApp.openById` — the project is not bound to a sheet, so the narrower current-document scope is no use. **Also the Sheets REST API**, which `settle_` polls to find out whether a converted export has stopped growing: the Spreadsheet service cannot answer that question twice in one execution, so the wait has to be made of HTTP calls |
| `auth/drive` | `DriveApp` get/create **and** the Drive v3 REST `files/copy` in §5 that converts a QlikView export. Full `drive`, not `drive.file`: the files were not created by this script |
| `auth/presentations` | `SlidesApp.openById` — the Deck Builder |
| `auth/script.send_mail` | `MailApp.sendEmail` — TP01, both the per-market files a person sends from the page and the weekly exceptions report the trigger sends. Still not a Gmail scope: it is the narrow "send mail as you" grant and it cannot read a mailbox. The read side is the next row, and the two are separate grants on purpose |
| `auth/gmail.readonly` | `GmailApp.search` / `getAttachments` — §10's **two** mail watches, the Inventory Report's and TP01's, and nothing else. **Read-only deliberately**: both remember which messages they have already handled in a Script Property rather than labelling or archiving them, so `gmail.modify` is not needed and nothing ever writes to a mailbox. This is the widest grant in the list — it can read every message the deployer can — and it is here only because Gmail has no "one sender, one subject" scope to ask for instead.
The mailbox each reads is the **trigger creator's**, not the deployer's (§1). `APP_CONFIG.INVENTORY_MAIL.FROM` and `APP_CONFIG.TP01_MAIL.FROM` are the narrowing the project *can* do |
| `auth/script.external_request` | `UrlFetchApp` — the logo, the Drive REST call above, and the Sheets REST poll the sync waits on |
| `auth/script.scriptapp` | `ScriptApp.getService().getUrl()`, which every page link is built from, **and** `ScriptApp.getProjectTriggers()`, the read that reports which of §11's three trigger targets are armed. That second call settles a doubt this row used to carry — the grant was described here as possibly reachable without it, and it is not. It would be here for the URL alone anyway: if that URL comes back empty every link goes **relative**, and a relative href inside the Apps Script sandbox iframe resolves against `googleusercontent.com`, navigating the user off the app. That shipped once |
| `auth/userinfo.email` | `Session.getActiveUser().getEmail()` — who archived a KPI workbook, and the check's own report |

`CacheService`, `PropertiesService`, `LockService`, `Utilities` and `HtmlService` need no
scope. They are still checked and reported as `(none needed)` — a service that needs nothing
is a different fact from a service nobody remembered. **All five have a row**; `Utilities` and
`HtmlService` were named in this paragraph and missing from the array for a while, which is
exactly the drift the paragraph exists to prevent. Neither is a formality: `Utilities.zip` is
what writes the `.xlsx` the weekly TP01 report attaches, so if it ever stopped producing a
readable archive the mail would keep going out and the **attachment** would be the broken
thing; and `HtmlService.createTemplateFromFile('app')` is the call that stops being
unambiguous the moment `script.gs` is renamed back to `app.gs`. `script.gs` §4's `CHECKS`
array holds the service → scope mapping in code beside the probe that proves it, so the table
above and the manifest cannot quietly drift apart.

---

## 2. Pages and routes

Ten pages, one `<template>` and one `AMR.page()` registration each.

| Route | Page | Reads |
|---|---|---|
| `landing` | The suite home | nothing |
| `overview` | Executive Overview | all three, read-only |
| `pricevolume` | AGG Price & Volume | Price & Volume workbook |
| `rmx` | Ready-Mix | Ready-Mix workbook |
| `segment` | RMX Product Segment | Product Segment workbook |
| `fuelsurcharge` | AGG Fuel Recovery | Price & Volume workbook (`readsFrom`) |
| `rmxfuel` | RMX Fuel Recovery | Ready-Mix workbook |
| `tp01` | Transfer Price Tool | the SAP file (uploaded, or off the mailbox) + Price & Volume workbook |
| `inventoryreport` | Inventory Report viewer | a Drive PDF, published by the mail watch |
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
| §3 | **ROUTER + PLUMBING** — `doGet`, `getLogo`, the data-generation stamps, the chunked cache, **`APP_batch`** (several calls in one execution, dispatched through `APP_BATCH_ALLOW_`), the SB reader, and the **period helpers** (`APP_period_`, `APP_yearCols_`, `APP_periodMap_`) every header read goes through |
| §4 | **PERMISSIONS** — `APP_verifyPermissions()`. Read before adding a service |
| §5 | **SYNC** — the QlikView → Sheets engine |
| §6 | **AGG** — Price & Volume, its mapping check, AGG Fuel Recovery, Saskatchewan rates |
| §7 | **RMX** — Ready-Mix, its lookup suggester, RMX Fuel Recovery |
| §8 | **OVERVIEW** — the executive Overview and the month cube |
| §9 | **DECK** — the Slides template reader, the deck writer, the recipe checker, and the three shared stores behind the Arrange stage |
| §10 | **SMALL PAGES** — KPI workbooks; the Inventory Report and the mail watch that publishes it; and TP01, which is no longer small: `TPE` (the comparison the page and the trigger share), `TPXLSX` (an `.xlsx` written by hand), `TPAUTO` (the weekly report's settings) and `TPMAIL` (the watch that drives it), beside the mail sender that was always there |
| §11 | **TRIGGERS** — everything reached from outside the repo, including **`APP_warmCaches`**, the hourly timer that rebuilds what a sync invalidated so the first person to open a page does not |

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
| §E | **SHARED MODULES** — sixteen: `AmrTick`, `AmrCache`, `AmrKpi`, `AmrCube`, `AmrDeckSource`, `AmrPvSlide`, `AmrProgress`, `AmrBoot`, `AmrFresh`, `AmrStamp`, `AmrSlide`, `AmrFuelExec`, `AmrSegSlide`, `AmrRmxSlide`, `AmrHover`, `AmrSugChip` |
| §P | **PAGES** — one `<template>` + one registration per page |

**The settings live at the top of each file, and the top of each file says where the rest
are.** `script.gs` §1 and `app.html` §C are the two banners to read before grepping for a
number; both also name the constants that deliberately stayed beside the code that reads
them.

### How ten pages live in one HTML file

Concatenating the pages breaks on two collisions. Both fixes are load-bearing and neither is
obvious from the code alone.

**Duplicate element ids.** `#syncBtn`, `#market`, `#banner` and dozens more exist on several
pages, across ~350 `getElementById` / `querySelector` call sites. The fix is that **only one
page's markup is ever in the document**: each page lives in a `<template id="tpl-rmx">`, and
exactly one is cloned into `#appRoot`.

`<template>` is the right container for a reason worth writing down — its contents are parsed
into a **separate inert document fragment**, so `document.getElementById` cannot see them. Ten
pages of markup sit in the file and only the mounted one is addressable, so every call site
keeps working unchanged. The obvious alternative, `<script type="text/html">`, is worse here:
the pages contain 2–7 literal closing-script tokens each, any one of which would terminate the
block early and silently.

> **Shared ids are the point, not a compromise.** 37 ids are declared by more than one page,
> and the two fuel pages share all 21 of theirs — they are the same screen on different
> numbers. **Where two pages do the same thing they use the same id and the same class; where
> they differ, they differ.** RMX Fuel's single upload is `#upMain` because AGG's two are
> `#upComb` and `#upOther`, and that is a real difference rather than a naming one. An early
> rule forbidding shared ids outright would have forced a rename pass on nearly every page and
> left the twins no longer diffable against each other, to buy a guarantee the mount already
> provides.

What keeps that safe is enforced rather than assumed: `AMR.start()` **empties `#appRoot`
before mounting** and `tests/merge.js` fails if that line goes; `merge.js` checks the
invariant that does matter — no id declared twice *inside one page's template*. **The
switcher must replace the mounted page, never add a second beside it** — caching mounted
pages for speed is the one implementation that breaks this, and it is ruled out. The QlikView
guide and its FAB are appended to `<body>`, *outside* `#appRoot`, so they need their own
teardown.

**Duplicate JS globals.** Every page declared its own top-level `state`, `fmt`, `boot`,
`render`. The fix is that **each page's JS is one IIFE that registers itself** —
`AMR.page('rmx', { title, libs, boot })` — so everything the page declared at top level is a
local inside it and **no page variable was renamed**. The only edits were the ~51 inline
`on*="…"` handlers, which lose access to global scope and became `addEventListener` calls
inside the IIFE. `merge.js` checks that no page registration leaks a global and that no page
shadows a runtime one.

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
  figures are out of date" poll. The screen covers the page for exactly one situation — an
  opening with nothing behind it yet — and is a bottom-right card for everything else; see
  §6's *One screen, and only while the page is empty*.
- **`AmrTick`** — a timer a background tab cannot throttle. A plain `setTimeout` is clamped
  to one a second when the tab is hidden and one a *minute* after five minutes of it, which
  is exactly how deck rendering is normally used.

**A §E module is a singleton and every page shares it.** That is what §E is *for*, and it is
also the shape of a bug the page switcher made possible and a reload used to hide. Three of
them hold state that outlives a mount and each answers for it in §D's `teardown()`:
`AmrFresh.stop()`, `AmrProgress.reset()` and `AmrCube.detach()`. The one that cost a page:

> **`AmrCube.init()` used to return silently on a second call.** The guard was right for a
> single page load and wrong the moment ten pages live in one document — coming back to the
> AGG page registered an `AmrCube.on()` listener against a cube that had already finished and
> would never emit again, so `AmrBoot`'s `month history` step was never answered and the modal
> loading screen stayed up until the tab was reloaded. A second `init()` is a **page switch**,
> not a duplicate boot: `on()` replays the settled event to a listener that arrives late, and a
> line the first boot never fetched (Price & Volume configures `agg` alone; the Overview opened
> after it wants `rmx` too) is fetched now. `on()` also hands back an unsubscribe, because a
> dead page's repaint left wired to the cube is the other half of the same root.

§E used to be byte-for-byte the files it was ported from, and `tests/modparity.js` proved it.
That gate has retired — see §10 — so a §E module is now proved by the harnesses that run it,
not by a comparison with a deleted file.

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
  plus the typed `REGION LOOKUP` and `TOPLINE REV LOOKUP2` tabs. Both data tabs are named in
  `APP_CONFIG.PAGES.pricevolume.SHEETS` (`SHEET`, `OTHER_REV`) and `buildSpec_` reads the
  second from there rather than spelling it a second time — the closed-year books carry the
  same two tabs, because it is the same export template.
- **Ready-Mix workbook** — `Main Raw Data`, `Extra Raw Data`, `Associate Raw Data`, plus
  `PLANT LOOKUP`, `PRODUCT MASTER`, `EXTRAS LOOKUP`. **There were four lookup tabs.**
  `CUSTOM FLAG LOOKUP` keyed on the same `mat_descr` and bucketed the same materials as
  `EXTRAS LOOKUP`; both Extras tables had already been moved onto `EXTRAS LOOKUP`, nothing
  displayed a flag, and the two tabs had drifted into disagreeing. It is gone from the code
  entirely — Config, lookups, miss lists, suggestion model and add-rows form. The tab may stay
  in the workbook; nothing reads it.
- **Product Segment workbook** — `Slide Segment MTD` / `YTD` and `Slide Product <Market> MTD` /
  `YTD`, all pre-aggregated by QlikView.

> **This workbook and its page were called the Slide Builder.** They are **Product Segment**
> now, everywhere in prose — one line away from "Deck Builder" it read as a second deck tool,
> and it is not one. Two things deliberately keep the old spelling: the **tab names** in the
> workbook itself (`Slide Segment MTD`, `Slide Product HNS MTD`), because the sync matches
> them by name and renaming a tab in code without renaming it in the Google Sheet stops the
> sync dead; and the **`SB` namespace** in `script.gs` §3, with the `sbWs` ids that call it,
> because that is a rename across every call site in `app.html` for no reader's benefit. Both
> say so where they live.

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

### The header says how old the figures are — two clocks, not one

`↻ Update from source` answers *is there anything newer*. It has never said *how old is what I
am looking at*, and on a page allowed to paint from a device cache those are different
questions. **`AmrStamp` (`app.html` §E) is a separate control beside that button**, injected
into every header that has one by `AMR.mount()` the same way the page switcher is — six page
templates would otherwise be six copies to keep in step. `getSourceTimes(page)` feeds it, one
row per workbook the page reads, so the Overview reports all three rather than a single time
that would have to stand for the stalest of them.

**The two clocks must never be collapsed into one.**

- **The sheet** — when the workbook last *changed*. The data version's own time, so the page's
  figures are that version of the sheet.
- **QlikView** — when the sync last *wrote* it, plus the date on the export it read.
  **`QLIKSYNC.run` records this itself**, because Drive cannot tell a sync from a hand edit: a
  row typed into `REGION LOOKUP` moves the modified time exactly as a sync does, and a header
  that called that a QlikView update would be lying about where the numbers came from.

Usually seconds apart. When they are not — a hand edit today over a sync from Tuesday, or a
sync this morning off an export QlikView dropped on Monday — the difference is the whole
reason both are shown. `qlikStamps()` shows the same pair from the editor.

**Every control on that bar costs width and the bar has almost none to spare** — Price &
Volume had seven pixels of it at 1720 before this button existed. So the stamp shows the date
and time while there is room and its age alone once there is not, and gives up its own frame
before the bar gives up a row. `app.html` §A3 carries the measured before/after widths at
which each header goes to two rows.

### Syncing: one trigger per export

**The sync is trigger-only by design and has no UI.** There is no pull button and one is not
wanted — a sync is a minutes-long Drive job, not something to put behind a control a user can
press twice.

**Set one time-driven trigger on each of `qlikSyncAggregates`, `qlikSyncReadyMix` and
`qlikSyncSegment`, a few minutes apart.** Fifteen minutes suits all three. Each compares its
own export's modified time against the one it last synced and does nothing at all if it has
not moved, so an ordinary firing is **one** Drive lookup.

**It used to be one trigger on `qlikSyncCheck`, and that is what the timeouts were.** The
three exports together are about seven minutes of work — Aggregates 52,538 rows, Ready-Mix
82,200, Product Segment small, plus three conversions and three reads — and an Apps Script
execution is six. One firing could never hold the job however it was arranged: it did as much
as fitted and armed a one-shot for the rest, so the tail of the work went round a retry chain
and the sheets ran a pipeline behind. Each export in its own execution is two to three minutes
against six, with the settle, the read and the write all inside one page's own limit and
nothing to defer.

**`qlikSyncCheck` was deleted on 2026-08-25** — it was kept after the split only so a trigger
still pointed at it would not fail silently, and keeping it kept a way to start all three
exports in one execution. **So check the Triggers UI**: a trigger still set on that name now
fails on every firing, and a timer nobody is watching fails quietly. Delete it, set one on each
of the three targets above, and run `APP_verifyPermissions()` to see which are armed.

**The lock is script-wide, which is why they are staggered.** `LockService` has no named
locks, so two of these firing across each other means the second waits five seconds, gives up,
and returns without writing or stamping anything; its next firing picks the export up. Nothing
is damaged and nothing is half-written — it costs that export one interval, and all three
exports rarely move at once.

(These are three of the suite's *five* time-driven triggers — the Inventory Report's mail
watch and TP01's are the others, both below. None of the five is created in code; all are set
by hand in the Apps Script UI, which is why `script.gs` §11 exists. There is **exactly one**
`ScriptApp.newTrigger` in the codebase and it is none of them — a run whose export fails its
checks arms a **one-shot retry** five minutes out, pointed at `qlikSyncRetry`, which deletes
it when it fires. Do not add a trigger for that one by hand.)

The timers skip a source whose file has not moved since it was last synced. **The manual path
deliberately does not** — somebody running it by hand is there *because* the sheet is wrong
and the file did not move (a bad write, a header renamed in the workbook, a cleared cache), so
the timer's optimisation must not reach them.

**`qlikAggNow`, `qlikRmxNow` and `qlikSegmentNow` are that path, and they are the whole of
it.** One export each, no argument to pass, and no way to ask for more than one — the Run menu
calls a function with no arguments, so a source key that is not already in the function cannot
be typed into that menu at all. They are **not** trigger targets: they skip nothing, so a
timer on one would re-sync minutes of Drive work every interval for ever.

**`qlikSyncNow(scope)` was deleted on 2026-08-25 along with `qlikSyncCheck`.** It took `'all'`
as well as one source, and `'all'` was its default for no argument — which is precisely what
the Run menu passed, so picking it out of the dropdown did the opposite of what its own comment
told you to prefer: three exports in one execution, the seven minutes that does not fit six,
with the third usually refused on the budget and pushed round the retry chain. The private
`qlikSyncNowOne_` behind the three wrappers takes **one** source and refuses anything naming
more or naming nothing, so there is no longer a way — from the editor or from code — to start
all three in one execution.

**Columns are paired on the figure and the period, never on the literal header** — see §7. The
sync writes data under the headers the workbook already has and never rewrites a header row,
so a new year's column has to exist there before anything can be written into it. Until it
does, the export's new column is reported unmatched rather than written somewhere wrong. There
is **no positional fallback**: one existed, and it is how PY revenue was written into the
wrong column for a whole run.

### Nothing is written until the export has been checked

**A bad export used to land silently, and that is the worst shape a data bug can take.** An
export went out with `CY Rev exWorks`, `PY Rev exWorks` and `Fuel Surcharge` left off. Every
other column paired, wrote cleanly, and produced a tab whose totals row read `0.00` across
three columns — no failed tab, no error, no log line, and a page that looked exactly like a
page. **Rows made it worse rather than better**: the sheet ends where the export ends, so a
short export does not leave the surplus behind, it *deletes* it. Right when the export is
real; catastrophic when it is truncated, because the good data is gone before anybody sees a
number.

So there is a gate, and **its position is the whole point — it runs before anything
destructive**. By the time it returns, nothing has been cleared, no row deleted and no formula
lifted out. A tab that fails is left *exactly* as it was: last week's figures, wrong by a
week, which a reader can recognise. What that replaces is this week's hole, which nobody can.

Five checks. **The first needs no history at all, and it is the only one that can see a copy
read while Drive was still converting it** — the server says the export tab holds 47,634 rows
and the read came back with 1,113 of them. Every other check on the list compares this export
against the *last good one*, and a truncated read defeats all of them: the rows that did land
are perfectly well formed, every column present and full, the grid rectangular. Those three
are only possible because **every successful write records what the tab looked like** — how
many rows the export carried and how many values each paired column filled
(`QLIK_TAB_SHAPE`). "This column is empty" is not a fault on its own; it is a fault against a
column that was full last week.

- **The read is as tall as the file it came out of.** What `getDataRange()` returned against
  what the Sheets REST poll says the copy actually holds — under half, above a 500-row floor,
  because `rowCount` is an *allocated* height and a converted copy can carry blank rows past
  its data. It also closes the hole the baseline leaves: the shrink check needs a previous
  good shape, so the **first** truncated read after a sheet is emptied or a shape record is
  lost has nothing to fail against, writes, and then records its own 1,113 rows as the
  standard every later run is measured from.
- **The grid is rectangular.** A row shorter than the header means the read came back
  truncated between Drive and here.
- **No column has gone missing** — one that fed this tab on the last good run and pairs with
  nothing now. A column that has *never* paired is still only reported as unmatched, because
  that is also what a new year's column looks like before somebody adds it to the workbook.
- **None arrived empty that used to carry figures.** The reported failure, exactly.
- **The export has not collapsed** — under half the last good row count, above a 500-row floor
  where the ratio starts to mean anything. This is the one standing between a truncated read
  and `deleteRows`.

**A collapse is real once a year, and the check has to know it.** These exports carry the year
they are for, so a **January file is a twelfth of a December one** — which is the whole reason
surplus rows are deleted rather than left. Refusing that would stop the pipeline dead every
January, on the one day nobody is expecting it. So a shrink is allowed when the export's
**newest period has moved on**, and only then; it is logged at `warn` when it is being relied
on, because this is the gap in the check. The period is read two ways and both are needed:
Ready-Mix from its `Bill Month`, and **Aggregates from the Year column** — only `Bill Month`
canonicalises to `monthcol`, and AGG carries a bare `Month` beside a separate `Year`, so
without the fallback every AGG tab has no period at all and January is refused on the line that
most needs it. A truncated read of a January file would come through this gap: check 0 and
`settle_` below are what address that, and the row-count check after the write is what reports
it if all three miss.

**A refused run is never recorded as the baseline.** Recording it would move the standard down
to the broken export, and the same broken export sent again would sail through — the gate would
report a fault once and then adopt it. It is the one a "does the gate still fire" check cannot
see, so it is written down instead: `recordShape_` is called past every check in
`writeColumns_`, and moving it any earlier is the mistake.

After the write there are three cheaper checks, and between them they answer "did the tab get
what the export sent" in the two numbers a reader would count.

- **The tab ends exactly where the export ends** — `getMaxRows()` against the first data row
  plus the export's row count, and **both directions are faults**. Too short is a tab that
  could not be grown to fit, which is usually the workbook's ten-million-cell limit. Too tall
  is surplus the resize did not take out: rows below the export's last one still holding the
  previous export's figures, and no reader can tell one of those from a row this export
  stopped sending. That is the failure the surplus is deleted to prevent, so not reporting it
  would defeat the delete. It costs nothing — the numbers are already in hand.
- **Every export column either paired or is named.** Each named export column pairs with a
  header on the tab and is written, or does not and is not, so `paired` + `unmatched` is the
  export's whole width and both are logged on every run and returned in the result. **An
  unmatched column is not a failure and must not become one** — it is exactly what a new
  year's column looks like before somebody adds it to the workbook, and refusing over one
  would stop the pipeline dead every January. What *is* a failure is a column that paired on
  the last good run and pairs with nothing now, and the gate above has already made it one.
- **The last row of each block is read back**, and a block whose final row is empty where the
  export's is not means the write stopped short. Values are deliberately *not* compared —
  Sheets coerces on the way in, so a cell-by-cell diff would fail on writes that are perfectly
  correct, and a check that cries wolf here is worse than no check.

**The full-block `clearContent` before the write looks redundant and must stay.** `runs_`
merges only strictly adjacent columns, so every column inside a block is a mapped one and the
grid fills every cell of every block row; the resize has just made the tab end exactly where
the write ends. On a run that *completes*, the clear touches nothing the write does not
immediately overwrite, and dropping it looks like a free saving on the pass that reaches the
six-minute limit. **The run that does not complete is the whole reason it is not free.** A kill
mid-write throws nowhere this code can see — the rows simply stop arriving. Cleared first, the
tail of that tab is **blank**: wrong, obvious, and exactly what the last-row check reads. Not
cleared, the tail still holds the **previous export's figures** — last month's numbers under
this month's heading, with nothing to tell them apart. This was tried the other way and
reverted: with a short write and no clear, the last-row check reads the old rows as evidence
the write arrived and the run reports success.

### Nobody is watching a trigger, so a failed run says so

A throw inside a time-driven trigger reaches one place: the execution log, which nobody opens
until they already suspect something. **A failed run reports the failure in full** — the
source, the tab, every reason the gate produced, and two things the reasons alone do not: that
**the sheet is unchanged rather than half-written**, and what happens next. Both matter — "the
sync failed" usually means something was half-done, and here it means the opposite.

**Whether that report is also MAILED is a switch, and it is off by default.** `qlikAlertsOn()`
turns it on and `qlikAlertsOff()` turns it back off — two editor tools over one Script
Property, `QLIK_ALERT_MAIL`, which has to say `on` before `MailApp` is reached. The recipient
is a separate property, `QLIK_ALERT_TO`, falling back to the account the execution runs as,
which by the trigger rule above is by definition whoever set the pipeline up; the address
survives a mute, so turning the mail back on does not need it typed in again.

**Off by default, because the mail's failure mode is volume.** It was written for a pipeline
nobody was watching and it is the right thing for one — but a sync that has started failing
sends the same mail every fifteen minutes to somebody who is already dealing with it, and
that is how the one mail that matters ends up looking exactly like the twenty before it.

**Muted is not silent, and that is why this is a switch rather than a deletion.** A muted run
writes the *entire* report it would have sent to the execution log at `error` — the same text,
in the one place a trigger does reach — and `qlikRetryStatus()` says the mail is off every time
it is asked, so a mute set for one bad afternoon cannot quietly outlive the afternoon. Nothing
else changes: the gate still refuses a bad export, the tab is still left exactly as it was, the
stamp is still withheld and the one-shot retry is still armed.

**The retry is one attempt, five minutes out, and then it stops.** The existing rule still
stands — a run that FINISHED with a broken tab is not retried, because that tab will be just
as broken in fifteen minutes. A run that failed its *checks* is the exception, and only
because of what usually causes it: a file Drive was still writing when the sync opened it.
That is gone a few minutes later; a genuinely broken export is not fixed by asking again. A
gate failure also **withholds the export's stamp**, on the timer path and the manual one alike
— keeping it would mark a file as read that the run refused to read. `qlikRetryStatus()` shows
what is waiting, and which tabs it is waiting on.

**And the retry rewrites the tabs that failed, not the page they are on.** The failure record
names them; `run(page, only)` takes that list, and the retry is its only caller — the three
timers and the three editor tools pass nothing and get the whole page, exactly as before. One
Ready-Mix tab failing used to retry all three: 82,200 rows rewritten to fix 14,157, which is
the work that used the budget up in the first place, done again. **And it is a risk taken for
no gain, not merely waste** — a retry killed mid-write on a tab that was already right takes a
*good* tab apart and leaves it blank below the boundary. A record that cannot name its tabs
(a read that failed before any tab was reached, or one written before the field existed) still
retries the whole page, because doing nothing would silently drop the failure that armed it.

### What the sync owns

**The columns it pairs, from the first data row down. Nothing else on the tab.** Every other
column — a lookup, a helper, a filled-down formula, a block parked to the right — is read past
and left as it was, on every tab, whether or not the code knows it is there. **Assume one is
there.** (The Product Segment tabs are the exception and are in `'replace'` mode for it: they
are pre-aggregated by QlikView, the tab *is* the export, and the whole of it is rewritten. Do
not put a working column on one.)

It used to take more than that, and each of these is a change that has to stay made:

- **The formula band was cleared whole** before the write and put back only after the *last*
  tab of the workbook — absent for the entire pass. One throw, or one execution killed at the
  runtime limit, and every anchor was deleted with nothing left to restore, and nothing for
  the next run to find either. That is why the Ready-Mix workbook lost array formulas and the
  Aggregates one never did on identical code: three tens-of-thousands-of-rows tabs reach the
  limit far sooner than two.

  **It still comes out whole, and that was the half of this that was right.** Leaving it in
  place was tried, on the reasoning that it "bought nothing and cost everything", and what it
  bought is the **recalculation**. `Combined Data CPI Raw` carries a single-cell array formula
  on its first data row — `=IF(B3:B47634="", "", UPPER(SUBSTITUTE(TEXT(K3:K47634 & B3:B47634 &
  …))))` — and a totals row above it summing `M3:M47634` and five columns beside it. Every
  `setValues` into a mapped column changes the range that array formula reads, so the sheet
  re-evaluates ~140,000 string operations and six full-column sums *before the next block can
  go in*, dozens of times over a 47,000-row export. That is what turned a write that used to
  finish into one that does not: the run dies partway down with `SpreadsheetApp` reporting the
  workbook as **"missing"**, the mapped columns are already cleared to the bottom, and the tab
  is left holding eleven hundred rows and a **half-written row at the boundary**. With the band
  out there is nothing to recalculate and the write is a write.

  **What changes is the window it is absent for, and what happens if that window is
  interrupted.** The band goes back as soon as *that tab* is written, not at the end of the
  workbook — and before it comes out it is **parked in a script property** (`QLIK_BAND_PARK::
  <page>::<tab>`), so it survives the one thing a `finally` does not: Apps Script killing the
  execution. `unpark_` puts a parked band home before anything reads that tab's formulas again.
  A band too big to park (9 KB is the limit; these are a few hundred bytes) is **not taken out
  at all** — the write falls back to clearing only the cell it would collide with, and is slow,
  which is the right way round: slow is a state that finishes. The pass at the end of `run()`
  still re-points the whole band once every tab has its final height, because a reference into
  a *sibling* tab cannot be resolved until then.
**Rows are the other way round, and stay that way.** The data ends exactly where the export
ends: a taller export inserts rows, a shorter one has its surplus **deleted**. Leaving them
would have January reading a December-sized sheet for eleven months, and no reader can tell an
empty row from a row the export stopped sending. That is safe precisely because every formula
on these tabs is a **single-cell array formula anchored on the first data row** — nothing is
filled down, so a surplus row holds no formula of anybody's, only spill, which comes back when
the anchor is re-pointed at the new height.

### The `~qliksync temp` sheet

Apps Script cannot read `.xls` / `.xlsx` — `SpreadsheetApp` opens a Google Sheet and nothing
else — so Drive converts each export to a temporary one, which is read and then trashed.
**QlikView delivers an Excel workbook and cannot deliver anything else, so this happens on every
sync.** The file names in Drive end `.xls`; the content is `.xlsx`, and that mismatch is worth
knowing only because the *format* was twice guessed at as the reason one export truncated and
another did not. It was not the reason either time. `readExport_` does skip the copy for an
export that is already a Google Sheet, but that is not a route this pipeline can take.

**The copy is not finished when Drive hands back its id, and this is the cause of a tab that
stops partway down.** `files/copy` returns as soon as the file *record* exists; converting tens
of thousands of rows of Excel is not instant, and the sheet is **readable while it is still
filling** — `getDataRange()` answers with however much has landed, truthfully and short, with
no error anywhere. Read straight away, a 47,000-row export comes back as a thousand-odd rows,
is written as a thousand-odd rows, and the other 46,000 are **deleted** to match, because the
sheet ends where the export ends.

**It is not a race, and the conversion is not what is slow.** Lengthening the wait from about a
second and a half to about six moved the Aggregates tab from **1,113 rows to 2,224** — twice the
wait, twice the rows, the same file — which reads like a fill in progress and is not one. The
poll below settled it: asked over REST, the copy holds **all 47,845 rows by its second look**,
about four seconds in, and has stopped changing. The file is finished. What is still catching up
is **`SpreadsheetApp`'s view of it**, and it catches up far too slowly to wait out — the doubling
was that view advancing, not rows landing. It is **not about size and not about `.xls` against
`.xlsx`** either: every one of these exports is `.xlsx`, and both of those were guessed and both
were wrong.

**So the read has a second half.** The wait makes sure the file is done; `readExport_` then
measures what `SpreadsheetApp` handed back against what the poll says the tab holds, logs both at
`info` on **every tab of every run** — "they agreed" is the line that says the read is sound, and
its absence is how a run that stopped earlier tells you where — and a short answer is **read
again over the same REST calls the poll is made of**, with `UNFORMATTED_VALUE` so a date arrives
as the Excel serial `monthText_` and `monthYM_` already expect. A tab `SpreadsheetApp` does not
return *at all* is fetched the same way rather than written off. Ten rows of slack, because the
poll measures a band of columns and the read measures the whole tab.

**So the wait has to watch a number that moves while Drive is filling, and three were tried
before one did.**

- `SpreadsheetApp.getLastRow()`, flushed before each look, with a comment calling that flush
  load-bearing. It is not: `flush()` pushes *this execution's pending writes* out to the server
  and says nothing about a file **Drive's converter** is filling behind the script's back, and
  the Spreadsheet service answers the second look out of the first look's snapshot. Two looks
  that agree because nothing re-read.
- **Drive's `version`.** It moves when a user or an API call changes the file. The converter's
  own writing does not bump it, so it is stable from the first look — the wait agrees with
  itself immediately and returns after six seconds. That is exactly what shipped, and exactly
  why the row count *doubled* instead of arriving.
- **`gridProperties.rowCount`.** The tab's *allocated* height, which Drive is free to size
  before it fills a cell of it.

What does move is **the number of rows that hold something**, and the Sheets REST API reports it
live. So the poll asks `values.get` for the rows themselves — and only for the ones it has not
already seen: a window of 20,000 rows starting at the frontier the last look found, walked
forward until a window comes back short. The first look on a copy that is barely started costs
one small call per tab, every later look costs one more, and the whole wait reads the equivalent
of the probe columns once. The probe is **`A:E`, a band and not one column**, because
`values.get` trims trailing empty rows out of its answer — which is what makes a window's length
mean "the last row here with something in it" — but only for the columns asked about, and an
export whose first column has gaps would end the walk on a hole. `rowCount` is still asked for,
because a `values.get` whose range runs past the end of a sheet answers **HTTP 400** rather than
with fewer rows: it bounds the probe, it does not end the wait. **The tab list is asked every
look and never cached**, because Drive adds the tabs one at a time as well — a copy reporting one
tab now can report four in thirty seconds, and a cached list is a way of settling happily on a
third of a file.

One agreeing pair of looks is not enough — a conversion pauses between tabs and a pause landing
across a single gap reads exactly like a finished file — so it wants **two consecutive
agreements**, starting 2 s apart and backing off to 10 s, because a copy that has been filling
for two minutes is not going to be caught out by a look every second. The ceiling is **4
minutes**, bounded by what is left of a five-minute slice of the execution **once the write's
three minutes have been taken out of it**, and floored at 60 s — so on a fresh execution the
wait may spend **two** of the five, not four. The floor still **wins over the budget**: a run
that has already spent its slice is a run about to be killed at the six-minute limit, and being
killed during the *wait* costs a stranded temp copy the sweep clears, while giving up on the
wait costs a truncated tab.

**The reserve is what was missing, and its absence is a whole class of timeout.** The
arithmetic used to be "five minutes minus what this run has already spent", which on a fresh
execution is all five — so a wait that ran to its 4-minute ceiling left **sixty seconds** to
read the conversion and write 82,200 rows of Ready-Mix, and no version of that finishes. What
it produced on 2026-08-25 is two tabs written, `Associate Raw Data` refused 5,000 rows into a
14,157-row write, a retry armed, and the same four minutes spent waiting again on the retry.
**The two outcomes are not symmetrical**, which is the argument for taking the time off the
wait rather than off the write: a wait cut short reads a copy that may still be filling, and
check 0 catches exactly that — refuses the tab, leaves it as it was, arms the retry. A write
cut short is the failure with no floor under it. So the wait gives way. **Giving up still does not throw**, and check 0 above is why.
When the fill cannot be watched at all the wait goes blind for **45 s** and says so at `warn` —
sized by the measurement above rather than by optimism — and a blind wait is served its full
length rather than being allowed to finish early on Drive's `version`, which agrees with itself
from the first look whatever the converter is doing.

**And it needs the Sheets API switched on — which is a line in `appsscript.json`, not a scope.**
The first `APP_verifyPermissions` after the poll shipped returned **HTTP 403 — "Google Sheets API
has not been used in project … before or it is disabled"**. That is not OAuth and there is no
consent screen to go looking for: the scope is granted and `SpreadsheetApp` works everywhere, the
token is good and the Drive REST row passes on the same one. What is off is the **API itself, in
the Cloud project behind the script** — a default Apps Script project has Drive switched on and
Sheets switched off, which is precisely the shape of one of those two rows passing and the other
not. `appsscript.json` now carries it as an advanced service —
`dependencies.enabledAdvancedServices`, `userSymbol: "Sheets"`, `version: "v4"`,
`serviceId: "sheets"` — and **that entry is what switches the API on**. **Nothing in the code
calls the `Sheets` symbol**; §5 reaches the same API over `UrlFetchApp` on the script's own
token. It looks unused. Deleting it breaks the QlikView sync, silently, in the way this whole
section is about — §9's list has it. Without it the sync still runs and runs blind: the wait
falls back to the fixed sleep and **check 0 cannot run at all**, with one `warn` per execution
naming the fix.

**One page, one export, one execution — and that is the whole of `run()` now.** `run()` takes a
page id, reads that page's one export and writes that page's one workbook. `openWorkbook_` still
asks **three times, three seconds apart**, because in the middle of a run that has already opened
the same file, `SpreadsheetApp` reporting a workbook as "missing (perhaps it was deleted, or you
don't have read access?)" is the service refusing one call rather than a permission that is not
there — that happened to a file its owner had opened successfully two minutes earlier in the same
execution.

**The page is the unit of the WORKBOOK**, because the array formulas are re-pointed once per
workbook off an `ends` map holding the final height of every tab this run changed, and a formula
on one tab can name a range on another. A read that fails fails **one page**, by tab name,
instead of throwing into `run()`'s own catch, which reports an error and no failed tabs — and it
is flagged retryable, so an export nothing could read is never stamped as read.

**Which is not the same as every tab having to be written, and it was read that way for a
while.** What actually has to hold is that no formula is left pointing at a height that has
moved — so the re-point pass covers **every `'columns'` tab of the page**, not only the ones in
`plan`. A tab this run did not write has its band read off the tab (a dozen rows, one call) and
re-pointed only if it names a tab this run *did* write; a tab naming nobody is read and not
written. **That closes a hole the full-run path had all along**: a run whose second tab failed
its gate left the first tab's cross-references pointing at the second tab's old height, with
nothing to notice. The Product Segment tabs are not asked — they *are* their export, carry no
band by rule, and a page of them is forty tabs.

**What went with the split is most of what used to be here.** `run()` took `'all'`, walked a
`byPage` map, read each export on first use and dropped it when the last page needing it was
done, refused a page it could not *start* inside the budget, armed a retry for the pages that
were left, and stamped the pages that finished so the retry would not redo them. Every piece of
that existed to fit three exports into one execution and to make the leftovers converge across
firings. One export per execution needs none of it.

**The budget check that is left is per TAB, and it is still the important one.** Apps Script kills
an execution at six minutes without running a `finally` or throwing anywhere the code can see —
the rows simply stop arriving, the tab is blank below wherever it got to, and the caller has no
failure to report, so it stamps the export as read and nothing looks at that tab again. Past a
five-minute mark `run()` refuses the remaining tabs **as retryable**: nothing is opened, nothing
is written, the stamp is withheld and the one-shot is armed with a whole six minutes of its own.

**And the retry is one attempt for both kinds of failure now.** It used to be one for a broken
export and up to five for the clock, and the reason for the second number was convergence: a run
of `'all'` retried only the *pages* that failed, so every attempt was strictly smaller than the
one before it. **The shrinking is back, one level down** — a retry does the *tabs* that failed,
so a Ready-Mix retry for one tab is 14,157 rows rather than 82,200 — but one attempt is still
the right number: what is left after that is an export that is genuinely wrong, and asking a
third time neither fixes it nor tells anybody. With one export to an execution and the write
no longer spending its time on `Utilities.formatDate`, it should not be reached at all.

**A retry that works records the export as read.** The failure that armed it withheld the stamp
on purpose; without this the stamp stays withheld, the next firing of that export's timer sees a
file it has never synced, and re-does the minutes of work that have just been done. The time
recorded is the one the run itself read — off `QLIK_LAST_SYNC`, not whatever is in Drive when the
retry finishes, because QlikView dropping a new export mid-retry is exactly the case where the
second of those marks a file as read that nothing has looked at.

**And a parked band is READ, never put back first — that one cost a whole run.** The band is
taken off the tab for the write because leaving it there makes the sheet recalculate the whole
LOOKUP KEY column between one block and the next. It is parked in a script property so a killed
execution has something to put back, and `unpark_` used to be the first line of `writeColumns_`:
it wrote the band home, and forty lines later the same band was read, parked and cleared again.
**Putting six `ARRAYFORMULA`s back onto a 47,845-row tab is exactly the recalculation the band is
taken out to avoid**, and the sheet was still doing it when the write asked for the tab. On 08-24
that came back as `Service timed out: Spreadsheets` on *both* Aggregates tabs — about 150 seconds
producing nothing — and Ready-Mix and Product Segment then ran out of execution time behind it.

The park is a copy of the band; reading it is free. `readPark_` returns it and the write puts it
back at the end the way it puts back one it lifted out itself. **The park carries the first data
row and that is not a convenience**: `firstDataRow_` finds that row by looking for a formula in a
column the export does not feed, and with the band off the tab there is none on the first data
row — so it finds the next row down of a foreign column that *is* filled down and answers one row
too low, and every row of the export lands one row out. The unpark had been hiding that by
putting the band back before the row was looked for. Three things have to stay true together:
`readPark_` READS the park and does not write it back, the first data row comes out of the park
when there is one, and the band cells are still cleared — because a kill between `park_` and
the clear leaves the band on the tab.

**One export per firing was argued against once, on 08-24, and the argument was wrong.** It ran:
all three exports rarely move at once, so deferring work that would have fitted turns a single run
into three spread across fifteen minutes; and three timers serialise on the script-wide lock
anyway, so a collision costs a whole interval instead of five minutes. Both halves are true and
neither is the point. **The common case is one export moving**, and that case is now one short
execution instead of a firing that has to decide what to defer — the collision it worried about
needs two exports to move inside one run's length, which is the rare case, and it costs that
export one interval rather than leaving the pipeline a lap behind. What actually settled it is
that seven minutes of work does not fit six however it is arranged: the old shape did not avoid
the cost, it moved it into a retry chain.

Because it happens every time, **`sweepTemps_` clears the strays**. The copy is trashed in a
`finally`, which covers every way the read can fail except the runtime limit — Apps Script
kills the execution and no `finally` runs. That kill is what the formula band's run-at-a-time
batching exists to avoid, so it is not hypothetical, and one stranded copy per kill is a slow
leak. The sweep runs inside the lock and trashes only files that carry the `~qliksync temp`
prefix, are Google Sheets, and are **over an hour old** — so a copy another execution is
reading can never be taken out from under it. Trashed, never permanently deleted.

**It must not be shared with anybody.** A new Drive file takes its audience from the folder it
is created in, so a copy made with no parent lands beside the export — in whatever shared
folder that sits in, visible to everyone with access and turning up in their Drive activity
mail. The copy is created in the script account's own Drive root and every non-owner
permission on it is removed before anything is read. **Nothing in the codebase creates a Drive
permission**, which is the only call that emails a person.

### Where a Ready-Mix run's six minutes were actually going

Three of them were being spent on work that produced nothing, and all three are the same shape:
something correct being done far more times than it has answers.

**`Utilities.formatDate` was being called once per exported row, and that was most of the
write.** `monthText_` turns a Bill Month into text, and the two calls it makes to do that —
`Session.getScriptTimeZone` and `Utilities.formatDate` — are not JavaScript: each one crosses
out of the V8 runtime into Apps Script's own services and back, and **the crossing is the cost,
not the formatting**. Ready-Mix writes 82,200 rows across its three tabs and every one carries
a Bill Month, so that is ~165,000 service calls a sync — which is, to within noise, the whole
of the ~165 s the Ready-Mix write was measured at. **A month column of 82,200 rows holds about
a dozen distinct values**, so the answers are memoised on the value: on a harness of 34,200
rows over 114 distinct values, 29,100 `formatDate` calls became **97** and 15,600
`getScriptTimeZone` calls became **1**, with identical output on every one. The cache
*memoises*; it does not reimplement — `Utilities.formatDate` still produces every string
returned, because hand-rolling `MMM-yy` would mean hand-rolling a time zone, which is not a
trade worth making for a column nobody looks at twice. It empties itself past 5,000 distinct
values, so a column that is not a month column costs nothing worse than what it used to.

**The formula band was going back onto every tab twice.** `writeColumns_` puts it home the
moment its own tab is written; the pass at the end of `run()` then re-points the whole band
again, because a reference into a *sibling* tab cannot be resolved until every height is final.
For a formula that names no sibling — which is nearly all of them — those two passes write the
**identical string**, and the second one costs exactly what the band is taken off the tab to
avoid: six `ARRAYFORMULA`s landing on a 47,845-row column is 140,000 string operations and six
full-column sums, served before the next call is. So the second pass now re-points each run
both ways and **skips the ones that come out identical**. It is a comparison of the formulas,
not an assumption about the heights: a sibling reference this pass can now resolve, or a height
that moved, still writes. A tab that threw mid-write, a band too big to park, and a restore
that half-failed all fall through to the write, because in each of those the band really is
still off the tab.

**And the export's month column was being walked twice.** `shapeOf_` walks it for the gate;
`writeColumns_` walked it again for `QLIK_REPORT_MONTH`, 40,000 rows later, for the same answer
off the same column. The shape record carries it now.

**What was looked at and left alone**, because each is load-bearing in a way that costs less
than it saves: the full-block `clearContent` before the write (§5 — it is what makes a killed
write *blank* rather than last month's figures), the unconditional `setNumberFormat('@')` on
the month column (`getNumberFormat` answers for the top-left cell only, so a column pasted over
in the middle would keep whatever that paste brought), and the poll's per-look Drive call
(dropping it saves one REST call in six and costs the wait its only signal when the Sheets API
is off).

### The first open of the day paid for everything, and now a timer does

**Every cached answer in this project is keyed on its source workbook's modified time.** That is
the right key and it has a consequence nobody had costed: the moment a QlikView sync writes a
sheet, every cached report, pivot, cube manifest and cube chunk keyed on that workbook becomes
unreachable **at once** — and `CacheService`'s ceiling is six hours anyway, so an overnight gap
empties it regardless.

Nothing rebuilt any of that except **a person opening the page**. So the first open after the
morning sync paid for all of it, in the foreground, one six-minute execution at a time, with a
loading screen up. Measured on 26 Aug 2026 from the execution log:

| Execution | Duration |
|---|---|
| `APP_batch` (the Overview's opening list) | 56.9 s |
| `APP_batch` again | **144.0 s** |
| `CUBE_getChunks` | **113.8 s, then FAILED** |
| `CUBE_getManifest` | 34.4 s |
| `CUBE_rebuildHistory` × 4 | ~29 s each |
| `getGuideImages` | 6.2 s and 6.5 s — but see below: this one **overlapped** the batch and was not part of the wait |

About five minutes before the page was usable — and the second person in got a warm page for
free, because the first one had paid for it.

**`getGuideImages` is in that table and is not one of the five minutes**, and the log is what
says so rather than the reasoning: it started at 09:02:33 and ran 6.2 s, and both
`getSourceTimes` and `APP_batch` started at 09:02:36 — *inside that window*. Those six seconds
were running alongside the opening batch, not in front of it. Moving the fetch to the fab's
click was tried on that wrong reading and **reverted the same day**: it saved the page load
nothing and cost the guide a six-second panel of *loading…* at the moment somebody asks for
help. What the measurement did earn is the server-side cache (§3 `getGuideImages`, one data URI
per Drive id), which makes the fetch cheap wherever it happens.

**Set one hourly trigger on `APP_warmCaches` (§11), from the account that deployed the web app.**
It is that first open, run at an hour when nobody is waiting: stale closed-year books, then one
token bump, then both cubes, then the two source bundles and the fixed-argument page answers.

- **An ordinary firing costs nothing.** Each step checks the cache under the *current*
  generation and returns, so a firing on unchanged data is a handful of cache reads and one
  Drive lookup per workbook. It does work only in the case where a user would otherwise have
  done that work instead — the same bargain the three QlikView timers make.
- **Hourly, not six-hourly.** The TTL is a ceiling, not a promise: an entry can be evicted early
  (see §6's item ceiling) and a chunked entry that loses one part is unusable. Hourly repairs
  that within the hour.
- **The order is the point.** Books, then the token, then the cubes. A book rebuilt *after* a
  cube moves `ovcHistTok_` and makes the cube that was just built unreachable — which is the
  cascade the old code ran four times in a row, once per book.
- **It never runs past its budget.** It stops starting work at `APP_WARM_BUDGET_MS` and refuses
  to start a book read without `APP_WARM_BOOK_MS` left. Whatever it does not reach is reported
  as deferred and picked up by the next firing.

`APP_warmStatus()` answers what a firing would do — which books are stale and why, which cubes
are cold — and does none of it. Run it from the editor first.

**It is the one trigger whose absence is invisible.** Every other target in §11 stops something
happening when it is not set. Without this one the app is entirely correct and merely slow,
which is why it is on `APP_TRIGGER_TARGETS` and reported by `APP_verifyPermissions()`.

**And an hour is too long for the one invalidation the app makes itself.** A lookup row is a
write to a source workbook: `applyRmxLookupRows` / `applyPvLookupRows` move that workbook's
modified time, which is `APP_getGen_`, so approving three mixes strands the Ready-Mix bundle,
both Overview payloads, both cube manifests and every chunk in the same instant. That is
correct — the mapping re-labels every year, closed ones included — but the only thing that
rebuilt any of it was the next person to open a page, **who is the person who just approved
the row**, and who approved it precisely to go and look at what it changed. So both writers
call `APP_warmSoon_`, which arms the same warm as a **one-shot a minute out** (past the page's
own follow-up counts, short of anyone reaching the Overview). It is the second — and last —
`ScriptApp.newTrigger` in the file, the same shape as §5's sync retry.

> **Its handler is `APP_warmNow`, not `APP_warmCaches`, and that is not a style choice.** A
> one-shot's only handle on itself is the handler function's *name*, so it deletes every
> trigger on that name as it fires. Point it at `APP_warmCaches` and the first firing deletes
> the **hourly** trigger with it — arriving at "the one trigger whose absence is invisible" on
> purpose. `APP_warmNow` is not on `APP_TRIGGER_TARGETS` and must never be given a timer.

### A closed-year book is re-read when it changes, not when nothing holds a copy of it

`CUBE_rebuildHistory` used to be reached whenever no usable file was parked in Drive for a book —
missing, or written against an older `OVCUBE_SHAPE_VER_`. That answers *can this be read at all*
and says nothing about *does it still match the workbook*, so:

- the two occasions a book genuinely needs re-reading were served by accident, and
- **one occasion that needs nothing at all cost four full reads.** Bump the shape version and
  every parked file becomes unreadable at once, so the next person to open the Overview read all
  four books, in the foreground, at ~29 s each — with every read moving `ovcHistTok_`, throwing
  away the cube they were waiting for and rebuilding it between books.

Staleness is now **the workbook's own Drive modified time**, which is what `APP_getGen_` has
meant by "the data changed" since the counter went. `ovcHistWrite_` stamps the parked JSON with
`src` (taken *before* the read, so a book edited mid-read is still stale afterwards), and a copy
goes in Script Properties so `ovcHistWhy_` can answer without opening a megabyte of Drive to
find out whether it needs opening. `ovcHistRead_` parses every file anyway, so it back-fills
that property from the file — the file is the truth about what it was built from.

**Three states, not two**, and the third is the one that cost the morning:

| | meaning | who acts |
|---|---|---|
| `first` | no file has **ever** been written for this book | the browser reads it — somebody has just linked it and is sitting there |
| `stale` | built, and the book or the shape version has moved | the hourly trigger, or the pill's **Reload history** |
| `adopt` | readable, but carries no record of what it was built from | the trigger, **once**, to give it one |

The property is what tells `first` from a shape bump at no cost: a stamp exists if and only if a
file was written at some point. **Unknown is never guessed stale** — guessing there is guessing
four workbook reads.

`CUBE_rebuildHistory` takes `ifStale` (skip a book that has not moved) and `bump:false` (leave
the token alone, so a caller reading several books can call `CUBE_bumpHistoryToken()` **once** at
the end instead of invalidating every cached chunk of both lines four times over).

### One cube build, not one per caller

A cold cube build is the most expensive thing in `script.gs`, and it is entered from
`CUBE_getManifest` **and** from `CUBE_getChunks`, from every open page — and Apps Script runs
*different users* concurrently. So the morning after a sync, six people opening the Overview was
six builds of the same two cubes, each slow because of the other five, and the winner's answer
thrown away five times.

`ovcBuild_` is a gate over `ovcBuildNow_` now. **Not `LockService`**: it has no named locks, so
the only lock available is the one the QlikView timers hold for two to three minutes at a time
while they write a sheet, and a page load waiting on that is the opposite of the point. The flag
is an ordinary cache entry and the rule is advisory — whoever finds no marker sets one and
builds; whoever finds one waits for the **manifest key**, which `ovcBuildNow_` writes last, after
every chunk, so its arrival means the whole line is in. Two callers can still both start; the
cost of that race is what everybody paid before.

The wait cap is set **beyond** a build rather than inside one, because a wait that expires is the
worst outcome there is — the waiter spends the wait and still has to build, so it pays both.

### Per-page sheet overrides

A page's workbook can be repointed at runtime from its ⚙ panel, stored as a Script Property.
`APP_sheetOwner_` redirects a `readsFrom` page to the owning page's key, so a save through a
borrowing page cannot create an orphan; `clearRetiredOverrides()` deletes keys left behind by
a page that no longer owns a workbook. `tests/configcheck.js` was the gate.

> **An override OUTRANKS this file, silently and for ever.**
> `getSpreadsheetIdForPage_` is `override || default`. So editing a
> `defaultSpreadsheetId` in §1 changes **nothing** on a project where somebody once pasted a
> link into ⚙ Settings — the page goes on reading the workbook from that paste, with no error
> and no log line, and the only place it shows is the `override` badge on the ⚙ panel. Every
> new export written to a **new file** rather than over the old one is a chance to acquire one.
> **`useCodeSheets()`** (editor tool, idempotent) is the answer: it deletes the override for
> every page that *has* a code default and returns what each page now resolves to. It
> deliberately leaves alone any page whose default is `''` — the four **history books** are
> linked nowhere but the property store, and clearing theirs would unlink the closed years.

### The Inventory Report publishes itself

**The second time-driven trigger.** Set one hourly trigger on
`inventoryReportMailCheck` (`script.gs` §11); the engine it drives is `IRMAIL` in §10, next to
the `IR` backend whose setting it writes, and everything configurable about it is
`APP_CONFIG.INVENTORY_MAIL` in §1.

Each firing searches **the trigger creator's own mailbox** — see §1: the trigger runs as
whoever added it, not as the deployer — for mail whose subject starts with
`SUBJECT_PREFIX`, from `FROM`, inside `WINDOW_DAYS`. For every message it has not published
before it files the PDF attachment into `FOLDER_ID` and calls **`IR.saveSource` — the same
call the page's modal makes**, which is why there is no second setting anywhere and why a
hand-set source and an auto-set one are indistinguishable.

Five things about it are decisions, not details:

- **An hour with no new mail does nothing at all.** No folder opened, no file written, no
  property touched — the Gmail search is the entire cost, and that is most hours. "New" is by
  Gmail message id, so a mail that has already been published is never pulled again however
  many times the trigger fires, and whether or not its PDF is still in the folder.
- **The period comes off the subject, never off the calendar.** July's report is mailed at the
  end of July, in August, or weeks later if it is re-issued — so `new Date()` would label it
  with the wrong month exactly when a late report made the label worth having. This is §7's
  rule about naming a period, in a different costume. `MMM, YYYY`, so
  `Inventory Report - Jul, 2026` is both the heading and the filename: three letters, a comma
  and the four-digit year. A four-digit number only counts as a year between **2005 and 2100**,
  which is what stops `Report - Jul, 1200 tonnes` publishing as "Jul, 1200".
- **The fallback is the month *before* the send date, not the month of it.** A report is
  published after the period it covers, so a mail with no month in its subject landing in
  August is August's mail about July. It rolls the year back with it — a January mail falls
  back to *December of the previous year*, and getting that wrong is a heading twelve months
  out, once a year. It is still a guess and it warns. A subject that names a month but no year
  gets the send date's year, unless that would put the report in the future ("Dec" arriving in
  January is *last* December).
- **One file per month in the folder, and more than one mail a month is normal** — the data
  gets corrected and the report re-sent. Each new copy for a period replaces the one before
  it: the newest is filed, the page is pointed at it, **and only then** is the previous copy
  trashed. That order is the safety of it — trash-first leaves the page pointing into the bin
  for as long as it takes the save to fail. Trashed, never deleted: it is recoverable in
  Drive's bin, and it is matched on *that period's* name, so the other months — the archive —
  are never touched.
- **It never writes to the mailbox.** Which messages are done is a Script Property
  (`INVENTORY_REPORT_MAIL_SEEN`, the last 300 ids), not a Gmail label — which is what keeps
  the grant at `gmail.readonly`. A message that fails on the Drive side is *not* marked, so it
  is retried next hour; one that can never work (no PDF on it) *is*, so it stops logging
  forever.

`inventoryReportMailStatus()` runs the same search from the editor and reports what the check
would do — the query, the folder it can see, what the page is showing, and every unpublished
mail with the heading it would be given — without filing anything. Run it before setting the
trigger: a wrong prefix or an unshared folder shows up there rather than in a trigger nobody
is watching.

**A subject line is not a credential.** Anybody who can reach that mailbox can send one, and
what the watch finds is published to every user of the app. `FROM` is the only narrowing
available — Gmail has no per-sender scope — so emptying it is a real decision.

---

### The transfer-price exceptions report sends itself

**The third time-driven trigger, and the first daily one.** Set one day timer on
`tp01ReportMailCheck` (`script.gs` §11); the engine is `TPMAIL` in §10, beside the `TPE`
comparison it drives, and everything configurable in code is `APP_CONFIG.TP01_MAIL` in §1.
**Who it mails is not in code** — it is a Script Property the TP01 page's *Automated email*
panel writes.

The SAP transfer-price file arrives by mail every Tuesday. Each firing searches **the trigger
creator's mailbox** (§1) for a subject carrying the whole configured sentence, reads the
`.xlsx` on it, builds the other side of the comparison out of the Aggregates workbook, and
mails the **exceptions** — one email, every market stacked in the body, one combined workbook
attached. The market breakdown is computed and not sent.

Six things about it are decisions, not details:

- **The QlikView export is not needed at all.** That report was only ever a filtered, rolled-up
  view of the Aggregates data this app already reads: `Customer Parent = Amrize RMX`, the
  current year, rolled from the raw tab's grain back to the export's, with the ASP recomputed
  as revenue ÷ volume. `TPE.qlikFromSheet` is the whole of it, and it opens nothing new. The
  page still accepts a QlikView file and **that file wins when it is there** — two inputs, one
  pipeline.
- **The filter is exact equality on `Amrize RMX`, never a `contains`.** That column also
  carries `Metrix RMX`, which is a different company.
- **A raw row carries one year.** A 2025 row parks its figures in the PY columns and zeros the
  CY ones. So "this year only" is *both* halves — the Year column **and** the CY columns — and
  testing one of them silently drops or doubles rows depending which you pick.
- **Daily, for a weekly mail.** A day with no new mail costs one Gmail search and nothing else
  — no sheet read, no comparison, no Drive file, no property written. That is six days in
  seven. What the seventh buys is that a report re-issued mid-week goes out the next morning
  instead of waiting for the following Tuesday.
- **Only the newest unseen mail is reported on**, and this is where it and the Inventory
  Report's watch deliberately part company. `IRMAIL` publishes every unseen message because
  each is a different month's report. A transfer-price file is a *snapshot*: three unseen mails
  are three versions of one list, and reporting all three would be three chances to act on the
  stale two. The older ones are marked done without being sent.
- **The settings are a *Script* Property, not a user one.** `TP_getRecipients` uses
  `getUserProperties()`, which resolves to the deployer on a web request and to the **trigger
  creator** inside a trigger. Let those two accounts differ and a recipient typed on the
  website would be invisible to the trigger, silently, while the run reported success.

**Nothing is marked done when the run fails**, so a Drive hiccup or a sheet that lost its
sharing is retried tomorrow. A new file with **no recipients configured** is an error and is
also not marked — the fix is ten seconds on the page, and tomorrow's run picks the same message
up. A mail with no workbook on it *is* marked, because it will never grow one.

`tp01ReportMailStatus()` runs the same check from the editor and reports what it found — the
query and every mail it matches, the Aggregates rows behind the comparison **with the
customer-parent spellings actually in the sheet**, and the match rate between the two sides,
with ten keys from each side when the answer is none. It sends nothing and marks nothing. Run
it before setting the trigger; a subject that no longer matches or a spelling that has drifted
shows up there rather than in a trigger nobody is watching. The page's *Preview* button runs
the same thing.

**It answers two questions that are not about the data at all, and they come first.** Whether a
trigger on `tp01ReportMailCheck` exists, and what is left of today's send quota. Everything else
in that report describes what the run would *find*; these two are the ways it goes missing with
nobody told — **a timer nobody added writes no log line and raises no error, because nothing
runs**, and a send refused for want of the grant fails inside a trigger, into a log nobody
opens, on the one morning a week the report was due. Both describe whoever runs the call: the
quota is their quota and the triggers are their triggers, which is the §1 rule again, so run it
from the deploying account and both lines describe the run that will actually happen. They are
computed *before* the "`TP01_MAIL.SUBJECT` is empty" bail, because a half-built config is
exactly when it is worth knowing the rest of the plumbing is there.

### TP01's numbers moved to the server, and that was the point

The Transfer Price page used to do all of it in the browser: the SAP read, the Concat Key on
both sides, the two revenue columns, the market split, the exception rule, the aging and the
email HTML. That was fine while a person was the only way to start it. The moment a trigger had
to produce the same figures the choice was one engine on the server or **two copies of one set
of rules with nothing at run time ever reporting that they had drifted** — which is the failure
this whole document is shaped around.

So `TPE` (§10) owns every number and the email body, and the browser keeps the two jobs it is
better at and which are not calculations: parsing a dropped workbook (SheetJS) and writing the
`.xlsx` behind Download and Send. A trigger cannot do the second, which is what `TPXLSX` is
for — **an `.xlsx` written by hand**, because an `.xlsx` is a zip of XML and `Utilities.zip`
makes zips. The alternative it was chosen over is written into its banner: a temp Google Sheet
exported through Drive, which costs a file created, exported and trashed on every run against
a six-minute ceiling this codebase has been killed by before, cannot produce an Excel table,
and — the deciding half — could not have been tested off-platform at all.

**The key is the one thing on this page that cannot be guessed from either file alone.** SAP
gives `S Plant` + `Ship-to / Partner PC` + `Material`; the Aggregates tab gives `Plant` +
`Sold To` + `Material`. Plant and Material put their code **first** (`3P02 - DUNDAS QUARRY`)
and Sold To puts it **last** (`BURLINGTON READY MIX - P4Q01`), which is why there are two
extractors and not one. Both sides then drop a **one-character prefix** from the customer /
ship-to code — `6` on the SAP side, `P` on the Aggregates side — and the four characters that
remain are the plant space. `64Q01` and `P4Q01` both reduce to `4Q01`, and that is what makes
the two files line up at all.


## 6. Caching model

Four layers, each with a different job:

| Layer | Where | Notes |
|---|---|---|
| `APP_cachePut_` / `APP_cacheGet_` | Apps Script `CacheService` | chunked at 90 KB, **max 250 chunks**, 6 h TTL — but see the item ceiling below |
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

### The `CacheService` limit that is not in the quotas table

Three of the four numbers the chunked cache is written against are Google's published figures
and are real: **100 KB per value** (so the 90,000-character chunk, which leaves ten per cent of
headroom because the limit is in *bytes* and the chunk is counted in *characters*), **6 hours**
maximum expiration, and **250 characters** of key. The Properties figures are real too —
**9 KB per value, 500 KB per store** — and `DECK_CONFIG.PROP_MAX_BYTES` is deliberately written
against the documented 9 KB rather than the larger figure the runtime is observed to accept; the
biggest arrangement anyone has built measures 5,183 bytes, so nothing is being limited by it.

**The one that bites is not published at all: a script cache holds about 1,000 items**, and
evicts **FIFO in blocks of roughly a hundred** when it fills. Items, not keys as this repo uses
the word — one 90 KB chunk is one item, plus a meta key per entry.

What that means here had never been costed. A megabyte of cube chunk is twelve items; one
line's year-blocks plus its manifest is seventy to ninety; both lines is most of two hundred.
So **a cold cube build writes a fifth of the whole cache in one go** and evicts the oldest
hundred items of whatever was in it — possibly including its own earlier chunks. That is
exactly the *partial* `APP_cacheGet_` reports, whose comment used to read it as an entry too big
to survive its own TTL: right symptom, wrong cause, and the pieces of one entry cannot expire
apart because they are written in one `putAll` with one expiry.

Two things follow, both now in the code. `APP_cachePut_` **warns when one entry takes a tenth
of the budget** — it was stored, nothing failed, and it is the cause of somebody else's partial
read. And `ovcBuildNow_` **checks its own chunks are still there** once the manifest is written,
at one meta read per block, and logs an `error` when they are not: a cube the cache cannot hold
is not a slow page, it is a page that rebuilds in a loop. That loop is what a `CUBE_getChunks`
execution running **113.8 seconds and then failing** looked like from the outside, with nothing
anywhere saying why.

The 250-chunk hard refusal stays as it is. Lowering it would make things uncacheable that are
cached successfully today, and a refused entry is recomputed on *every* request, which is worse
than an entry that evicts its neighbours.

The browser side needs no revision: `localStorage` is 5–10 MB per origin **and stores UTF-16**,
so `AmrCache`'s conservative cap is right, and the cube is in IndexedDB precisely because it is
not.

### One round trip, not six — and what may travel in it

**Apps Script runs one user's `google.script.run` calls END TO END.** Nothing a page issues
overlaps: six calls are six queue waits, six executions and six round trips, in order, even
when five of them are a `CacheService` read that returns in milliseconds. That is not a
detail of the transport, it is where a page's loading time actually goes — the Executive
Overview opened with **twenty-four** of them and the figures were in cache the whole time.

`APP_batch({calls:[…]})` (§3) runs a list in one execution. Each entry is caught on its own,
so one failure reports itself in its own slot rather than taking the page down, and
`AMR.batch(list)` (§D) is the browser side: same length, same order, `{ok:true,value}` or
`{ok:false,error}` per slot. Three rules make it safe to reach for:

- **The allow-list is the boundary, not a formality.** Dispatching by name off a
  client-supplied string is how a web app hands the browser the whole server file.
  `APP_BATCH_ALLOW_` names the thirty functions that may be reached this way and it holds
  **reads only**. A write — a sync, an upload, a lookup row, an email — stays a call of its
  own, because *"which of the six actually ran before the budget stopped it"* must never be
  a question anybody has to ask about one of those.
- **The budget bounds when a call STARTS, never how long it runs, and it takes two numbers
  to say so.** Six separate calls get six six-minute ceilings; one batch gets one — so a
  batch of two four-minute calls is a batch that gets killed where the two on their own
  would both have finished, and that is the one way this transport could hang a page that
  the calls it replaced could not. `APP_BATCH_BUDGET_MS` is the plain "long enough";
  `APP_BATCH_CEILING_MS` is the one that matters when the calls are big, and the estimate
  for the next call is the **longest one so far** — a batch whose first call took four
  minutes will not start a second. Everything it does not reach is `skipped`, which is not
  an error: `AMR.batch` re-issues those slots on their own and each then gets a full
  ceiling of its own.
- **It never leaves a caller without an answer.** A failed batch, a skipped slot, or a
  deployment that has no `APP_batch` in it at all: all three fall back to one call each,
  which is exactly what the page did before. The worst case is the number of round trips it
  already had, so pushing `app.html` ahead of `script.gs` degrades rather than breaks.
  **A batch the call guard gave up on is the one case that must not fall back**, and it is
  the expensive one: seven minutes with no answer does not mean the batch failed, it means
  the batch *vanished*, and an Apps Script execution that stops reporting is usually still
  running. Fanning three slots out then queues three more executions **behind** the one that
  is already the problem, each with a watchdog of its own and each entering the same cold
  build — one slow open becomes four. `AMR.batch`'s `lost()` answers every slot with the
  guard's own error instead, so each caller takes the failure path it already has.
- **Nothing a dispatched call does may quietly spend the whole ceiling**, and there is
  exactly one thing that can: `ovcBuild_`'s single-flight wait, which sleeps up to two
  minutes when another execution is building the line. That is the right trade for a call
  that owns its own six minutes and the wrong one inside a batch, where it is two minutes
  the slots behind it do not get — they come back `skipped` and are re-issued as separate
  executions, so a wait meant to *save* an execution costs one. `APP_batch` publishes its
  deadline as `APP_BATCH_UNTIL_` and `ovcWaitBudget_` trims the wait to fit inside it,
  keeping back `APP_BATCH_BUILD_RESERVE_MS` to build the line itself if the wait does not
  pay off. Outside a batch the deadline is 0 and nothing changes.

**What decides membership is what the page is WAITING on, never what it will eventually
want.** A batch is one reply, so everything in it arrives at the speed of its slowest entry.
The Overview's opening batch is three calls — the three versions, the cube manifest, the KPI
values — because the first paint cannot happen until the overview payload is in and that
cannot be *asked for* until the manifest names the month. The customer merge, the
cross-report and the older month blocks arrive behind the paint and must not be allowed in
front of it.

### A call that never answers

**`google.script.run` has no timeout and no way to ask for one.** If the server execution
dies without reporting — the platform kills it at six minutes, the connection to the frame
is lost, a quota bites — **neither handler runs**. Nothing anywhere is watching, so the page
sits under its loading screen for ever. Every "it just got stuck" is a candidate for this and
none of them leaves a trace: no error, no failed call, nothing in any log. A caller cannot
defend against it either, because the defence is a timer and there is nowhere sensible to put
114 of them.

There is one sensible place, and it is §D's call guard — the same interception that already
drops a stale answer from a page that has gone. Every call is stamped, put on `INFLIGHT` and
given a watchdog; whichever of the three fires first — success, failure, watchdog — settles
it and the other two are ignored (a late answer is dropped and logged, never applied on top
of a page that has moved on). When the watchdog wins it runs **the caller's own failure
handler**, so a hang becomes the error path the page already has: the banner it already
writes, the `hideLoader()` it already calls, the boot step it already answers.

- **Seven minutes, and it is not a guess.** Apps Script kills an execution at six, so
  anything still outstanding past that is dead rather than slow. A shorter timer would mean
  telling somebody their cold cube build failed while the server is still building it.
- **What makes the wait bearable is not that number.** `AMR.inflight()` lists what is
  outstanding, longest first, so `AmrBoot`'s own 150-second watchdog now names the call —
  *"the server has not answered getOverview for 143 seconds"* — instead of printing
  "a step is missing its `AmrBoot.done()`" for a fault that is not the page's. It still says
  that, but only when nothing is outstanding, which is when it is true.
- **And 150 seconds is shorter than a cold open, so the card must not go red on one.** A
  sync or a single lookup row strands every cached answer, and the next open rebuilds all of
  it — measured at about five minutes. The watchdog was therefore firing on the one open
  with the best possible reason to be slow, painting a bug report over it and inviting a
  reload, which cannot cancel the execution and only queues another behind it. People
  reloaded; it got worse. A call still in the air is the proof this is the server working,
  so the screen keeps its colour, names the call and **counts up**, re-looking every 15 s.
  The red card is raised on **two consecutive looks with nothing outstanding** — two,
  because a page's opening is a chain and there is a real gap between one call's answer and
  the next call being issued.
- **`withUserObject` is named explicitly in the guard.** It returns a runner like the two
  handler methods, so falling through to the "this is the server call" branch armed a
  watchdog against a function that never went anywhere *and* handed back an unwrapped runner,
  losing the guard for the rest of the chain. It did the second of those before this was
  written down.

### One screen, and only while the page is empty

The full-screen loading card exists for a good reason: a marker off in the corner was too
easy to miss and people were reading half-loaded tables without realising. **That reason
expires the moment the page has something real on it.** After that the modal is not
protecting anybody from a half-loaded table — the table is loaded and the screen is sitting
on top of it saying so — and every later fetch threw it back up, so an open read as: screen,
page, screen again, page.

`AmrProgress` now has two forms of the same card, and `AmrBoot` chooses between them.
`need()` raises the modal because the page behind it is empty; **`painted()` gives it back**,
and `done('data')` calls `painted()` — `'data'` is the step every page names for "the tables
are on the page", so this is one rule rather than six `hideLoader()`s, the sixth of which
would be forgotten. Nothing about the refcount changes: the steps still stand, the same
wording and percentage and list of what is outstanding are still shown, and the month blocks
still stream — over a page you can now read and click. `finish()` and `reset()` both drop
back to the corner, so no page inherits the last one's answer.

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

### Paint from the device, then confirm — and what that is not

`AmrCache.get()` is gated on `ready`, and `ready` only goes true once the **server** has
confirmed the generation. That is the right gate and it was in the wrong place: it meant the
first paint waited a full round trip on **every** open, however much the device already held,
and Apps Script runs one user's calls end to end so that is the better part of a second of
blank page in front of an answer that was already here. Three pages read as "it loads again
every time you open it" for that reason and one of them was worse — Product Segment could
never read its own store on open at all, because the only thing that set `ready` was the reply
to the call the store existed to avoid. Its store was **write-only for the life of the page**,
and nothing looked wrong in any log, because `RMX_prepare` really was doing its job.

`AmrCache.warm()` opens the store on the generation **this device itself last confirmed**, so
the page paints at once and the version is checked behind it — the warm start `AmrCube` has
always done against IndexedDB. It is only ever correct with a `check()` behind it, and three
things are load-bearing:

- **`boot()` still asks, every time**, and still starts `AmrFresh` from the reply. `check()`
  now returns whether the store **survived**; `boot(done)` passes that to `done(kept)`. A
  caller that painted warm and is told `kept === false` must read again.
- **Only a warm paint is re-read.** A cold open has already gone to the source by the time the
  version comes back, and reading twice for one open is the bug this removes, not a safety
  margin.
- **The version call is issued FIRST and answered first.** `set()` will not write a payload
  before the generation it belongs under is known, or `check()` wipes it a moment later as an
  orphan — sending the read first is how a cold open ended up storing nothing at all. Only the
  *paint* came off the round trip; the write still waits for the version.

**`RMX_getStamp()` is what confirms the Ready-Mix pages** — `{generation, build}`, the same two
fields under the same names that `prepareAll`'s `stamp()` puts on every heavy payload, with no
sheet read and no bundle behind them. It has to be those two: `getDataVersion('rmx')` answers
`APP_sourceStamp_` + `APP_CODE_BUILD`, which is a **differently shaped pair**, and two copies of
one cache token is the mistake at the top of this section.

`ready` is also **per page** now. It was one boolean for the whole module while §D mounts ten
pages into one document, so a version confirmed on AGG Fuel Recovery left the store of whatever
mounted next readable before anything had checked *its* version.

`tests/reopen.js` gates all of it, and it gates the thing a call count cannot see: the stub
holds every reply for a fixed latency and counts what is outstanding per call name, so
"a table is on screen while the version call has not come back" is an assertion.

### What the fuel pages' device cache must never do

Both Fuel Recovery pages cache the sheet on the device, and three invariants keep that honest.
`tests/fuelcache.js` gates all three, mutation-tested three ways.

- **The uploaded-workbook path is never cached.** Both pages can run on a file the user dropped
  in. That is session-only by design and is not what the sheet holds; `upOff()` is the boundary.
- **The month is part of the key.** Both pages send `{month}` with every read and the payload
  differs per month. A cache keyed on the page alone would serve July's figures for May.
- **A typed-over cell is not data.** `NUM_OV` / `TXT_OV` are the user's edits, and the month
  picker already clears them for exactly this reason. Restoring a cached model must not
  resurrect them.

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
- **The period is DATA, not a setting — do not add a knob for it, and do not name one back at
  a header.** The same figure is headed four different ways across the exports and the
  workbooks, and all four are live: `2026 Volume`, `CY Volume`, `Total Revenue - 2025`,
  `Total Revenue -PY`. The two sides do not have to agree and currently do not — the
  Aggregates export still names years while its workbook has been moved to CY/PY — and either
  can change again, in either direction.

  **One place decides what a period column looks like: `script.gs` §3's `APP_period_` and the
  helpers around it.** A header is split into the *figure* and the *period*; the period token
  is CY, PY or a four-digit year, it can sit at either end of the name, and the dash before it
  is optional. Everything that reads a header goes through them — the sync, all five readers,
  and `iYearCol` in `app.html` (which is the one client-side copy of the rule, and says so).

  A lookup that names a period back returns −1 the day the header changes, `toNum_` turns the
  missing cell into 0, and the page publishes a full table of zeroes under correct-looking
  headings without failing. That has now happened twice, for two different reasons: the year
  rolling, and the workbook being re-headed.
- **Which year is current comes from the DATA.** `CY` names no year at all, so a reader keying
  its cells by year has nothing to key on: it is read off the **Year column** (Aggregates) or
  the **year on a Bill Month** (Ready-Mix). Never off the calendar — a cap against "the
  future" was tried in `APP_dataCyYear_` and taken out again, because it made the answer
  depend on the day the code ran. And never off the header alone: the AGG history export
  reuses the live template, so headers can read `2026 Volume` over actual 2025 data.

  Payloads carry `cyYear` / `pyYear` and every heading prints what it was sent. The only years
  left in `app.html` are the QlikView guides' sample rows, which illustrate a format and are
  meant to stay put. `tests/yearroll.js` runs the suite against a 2031 workbook **and** against
  a CY/PY-headed one.
- **The header is folded, not matched literally.** `Fuel Surchage` is the Aggregates export's
  own name for the column its workbook heads `Fuel Surcharge`; `ex Works` / `ex-Works` /
  `exWorks` alternate freely on both sides. `APP_hdrNorm_` folds both. The surcharge typo is
  not a footnote — one missing letter meant that single column matched nothing and was never
  written, while every other column on the tab synced, so the tab looked healthy and the
  surcharge sat at the previous export's figures.
- **Duplicate column names** require first-unused matching.
- **Bill Month has two header spellings and inconsistent values.** QlikView exports
  `bill_month`; the sheet header reads `Bill Month`. No `norm_` here folds underscores, so
  both are listed explicitly wherever the column is resolved. Values vary too (`Jul-26` vs
  `July-26`), which breaks SUMIFS joins.
- **Bill Month splits each month across two rows** — `Jul-25` carries the prior-year columns,
  `Jul-26` the current-year ones, off-year columns blank. Everything downstream must therefore
  **sum into its bucket before taking any ratio**. ASP, the PPI `covered_()` floors and the PPI
  weight all are. Any new per-row ratio is a bug.

### A row of the Aggregates raw tab carries ONE year

The tab has `CY Volume` and `PY Volume` side by side **and** a `Year` column, and the obvious
reading of that — every row carries both years for its month — is wrong. A row whose `Year` is
2025 has its figures in the **PY** columns and zeros in the CY ones; a 2026 row has them the
other way round. `ovcAggRoll_`'s live branch pushes both sides of every row and gets away with
it only because `push` returns early on an all-zero row.

So **"this year only" is two conditions, not one**: `Year === cyYear` *and* the CY columns.
Test only the Year column and you keep last year's rows carrying zeros; test only the CY
columns and you keep this year's figures plus a stripe of zeroed 2025 rows that quietly change
every average that divides by a row count. `TPE.qlikFromSheet` does both, and
`tests/tp01engine.js` case 6 is what says so.

### The reporting month

Always **last calendar month** (current − 1), computed from the clock, never derived from the
data: the export carries every month of the *prior* year, so a maximum-based scan always
returns December. `latestMonth_` takes the newest value literally and is **not** capped — a
Bill Month names its own year, and the closed-year books legitimately end in December. That
stamp (`QLIK_REPORT_MONTH`) is informational only.

Pre-aggregated tabs (Slide Segment, Slide Product) have **no month column at all** and cannot
be re-sliced: whatever month the export was run for, both tabs are for that month.

### PPI and CPI — one formula, two keys

Both are Qlik's weighted price index, and both are the same three lines of arithmetic.
Only the **key** differs:

| | the pair it indexes on |
|---|---|
| **PPI** | Plant × Product |
| **CPI** | Plant × **Sold To** × Product |

For every pair, inside the rows already sliced to the row's own context:

```
Weight = CY revenue — but only where BOTH years carry volume AND revenue
                      on that pair; otherwise 0
ASP%   = (CY rev ÷ CY vol) ÷ (PY rev ÷ PY vol) − 1
Factor = Weight × ASP%
Index  = Σ Factor ÷ Σ Weight
```

Weight and Factor are summed **before** anything divides, so the index is a
revenue-weighted average of like-for-like price moves — never an average of row
percentages, and it does not weight-average back from its own rows.

**Why the two differ.** PPI asks what a *product's* price did; CPI asks what a *customer*
was charged for it. Adding Sold To splits one PPI pair into many, and a customer who bought
a product in only one of the two years fails the coverage test and drops out of CPI while
staying in PPI. So the two carry different total weights and are two measures, not two
views of one.

**Why a hand-built PPI and CPI come out identical.** They will, every time, if the ASP% is
fixed *per row* and then revenue-weighted: `Σ(ASP%ᵢ × CYrevᵢ) ÷ Σ(CYrevᵢ)` does not care how
the rows are grouped, so adding Customer to the key changes nothing. The grain only bites
when volume and revenue are **summed into the bucket first and the ratio taken after** —
the same "sum into its bucket before taking any ratio" rule the Bill Month note above states.
Group first, divide second, and the two indices separate on their own.

**CPI divides by TotalWeight, which is NOT the sum of the weights it used.** Read straight
off Qlik's own Cust Price Detail exports (2026 Jan–Jul: all markets and each of GTA, SW,
Manitoba, Saskatchewan), `CPI = [CPI Factor] ÷ [TotalWeight]`, and on the all-markets export
those two columns total **$136,727,744** against **$123,520,166** — a tenth apart. So:

```
TotalWeight = CY revenue of EVERY covered pair          ← the denominator
Factor      = CY revenue × ASP%, over covered pairs
              that are not outliers                     ← the numerator
```

A pair excluded as an outlier **keeps its weight and loses its factor**. The exclusion is a
dilution, not a deletion. Summing covered CY revenue reproduces `TotalWeight` to the dollar on
all five Jan–Jul exports, and **to the penny** on both August ones — `$155,497,057.14` for
Jan–Aug and `$13,041,331.22` for Aug MTD, from the app's own raw rows at the app's own grain.
The denominator is not the part that is wrong. PPI passes no threshold, so both its sums run
over the same pairs and it is arithmetically what it has always computed — unchanged.

**The gate is stronger than "> 0", and that is the whole rule.** A pair earns weight only
if it shows a **real price in both years**. Qlik gates on revenue *net of rebates*; this export
carries only gross ex-Works, and on 2026 Jan–Aug that difference is 10 pairs. Two of them wreck
the page on their own:

| pair | last year | this year | ASP move | carries |
|---|---|---|---|---|
| `3P36` / Brock Aggregates / `9141` | 47.04 t for **$0.14** | 2,918.59 t for $42,780.71 | +492,409% | 135pp |
| `3Q00` / JNF Ready Mix / `9055` | 378 t at **$2.343/t** | 24,593 t at $22.75/t | +870.9% | +3.13pp |

Brock is a March 2025 invoice of $693.98 met by an April credit of $693.84 — fourteen cents
against 47 tonnes. JNF is the one that matters for the design: **nothing about it is small.**
$559,436 of weight, five figures of tonnes, every volume and revenue figure comfortably above
any floor you would think to set. Only its *price* gives it away, and $2.343/t is Ontario's
rebate rate, not a price.

So `COVERAGE.cpi` carries three floors, and each catches a different thing:

| floor | value | what it takes out |
|---|---|---|
| `minVol` | 1 t | a pair that barely traded in either year |
| `minRev` | $1 | **Brock** — fourteen cents is not a year of trading |
| `minAsp` | $3.00/t | **JNF** — the visible shadow of Qlik's net-revenue gate |

`minAsp` is the one doing the work. Ontario's rebate runs $2.248/t (Manitoba $0.60,
Saskatchewan $0.90, nil on recycled), so a pair whose year averaged $2.34/t was billing the
rebate and not a price. Qlik nets that to zero and drops the pair; we cannot see the rebate,
but we can see that no real product sells for $2.34 a tonne.

**It is a GATE, not an outlier cap, and the difference is the denominator.** A pair that fails
leaves the **weight as well as the factor** — a deletion, which is what Qlik does. The ±50% and
500% caps that preceded it were dilutions: they dropped the factor and left the weight behind,
which is why neither ever reproduced Qlik's selection.

Calibrated against Qlik's Cust Price Detail for both August windows, all markets:

| | `vol/rev > 0` | `> 1` only | `+ $3.00 ASP` | Qlik |
|---|---|---|---|---|
| **Jan–Aug 2026** | 141.719% | 6.248% | **3.106%** | 2.864% |
| **Aug 2026 MTD** | 2.789% | 2.789% | **2.724%** | 2.646% |

The `> 1` column is the trap: it takes Brock and looks like a fix, while SW Ontario still reads
**14.36%** because JNF sails through it. The price floor costs three pairs Qlik keeps, worth
$1,894 out of $155.5M of weight. Anything from $2.50 to about $3.90 gives the same answer to
the third decimal; $4.00 starts eating real product — bank sand runs $3.97/t. $3.00 is the
middle of that window. **Do not tune these floors at the residual below**; it is a different
thing entirely.

**What is left, and why it cannot be closed here.** With the denominator exact to the penny and
the gate reproducing Qlik's selection, the remaining error is that **Qlik weights the numerator
by net-of-rebate revenue while dividing by a gross `TotalWeight`** — its `Weight` runs ~0.905×
ex-Works with a per-row ratio, so no constant recovers it:

| 2026 Jan–Aug | Qlik | app | residual |
|---|---|---|---|
| All markets | 2.864% | 3.106% | +0.24pp |
| GTA | 2.48% | 2.74% | +0.26pp |
| SW Ontario | 3.05% | 3.37% | +0.32pp |
| Manitoba | 2.84% | 2.85% | **+0.01pp** |
| Saskatchewan | 5.91% | 5.95% | **+0.04pp** |
| North | 6.22% | 6.22% | **0.00pp** |

Manitoba, Saskatchewan and North land inside 0.04pp because their rebate is small or nil.
Closing GTA and SW needs `_rebate` as its own column in the Price & Volume export. Until then
this is the ceiling, and it is a weighting difference rather than a wrong method.

**And none of it is real if the gate does not travel.** See §7's next note.

### The tunable that shipped inside a cached payload

A CPI threshold was added, was correct, and changed nothing for a day. The Overview went on
publishing **+141.7%** for 2026 Jan–Aug against Qlik's 2.86%, and **+243.0%** for GTA against
2.48% — the Brock Aggregates pair above, unexcluded, carrying 135 of those points.

The arithmetic was never wrong. **The number never arrived.** §1's `COVERAGE` block is read on
the server, but the browser does the pooling, so the thresholds *travel* — inside the cube
manifest and inside the cross-filter dataset. Every cache key in that chain was built from the
**data's** generation and the cube's **shape**, and neither moves when a threshold is edited:

| layer | what it held | how long |
|---|---|---|
| `CacheService` (`ovcBuild_`) | the manifest built before the edit | 6 h |
| IndexedDB (`AmrCube`) | that manifest, replayed on every warm start | until the generation moved |
| reading the missing key with `\|\| 0` | took it for *no gate at all* | — |

Two changes, and they are two halves of one rule:

1. **`ovcCovTok_` hashes the whole `COVERAGE` block into `ovcGen_`**, and `getCrossData`'s key
   carries it too. Editing a floor is now the same kind of event as a shape change — one
   invalidation, nothing to remember separately. `getCrossData`'s key is scoped rather than
   folded into `gk_`: nothing else under `gk_` carries a coverage threshold.
2. **A payload that cannot say what the gate is reports NO CPI**, in `pool()` and in
   `poolPairs()` alike — `null`, not an empty gate. The column is dropped exactly as it is on a
   line with no Sold To. An absent column is a question the page declines to answer; a wrong one
   is not. A block present but all-zero is a *deliberate* empty gate and still reports.

`revalidate()` also writes the confirmed manifest back to IndexedDB. It was only ever stored by
`adoptGen()`, which runs on a **cold** start, so a warm device painted from the manifest it
first saw for as long as the generation held, however many times the server rebuilt it.

**The general rule: a tunable that ships inside a cached payload belongs in that payload's
cache key.** `tests/cpiindex.js` gates both halves.

The arithmetic is written once per runtime — `piIndex_` (`script.gs` §6), `pool()` in
`AmrCube`, and `poolPairs()` in the Overview's local cross-filter path — and CPI is reported
only where Sold To exists. `metrics_()` is the deliberate exception: it sums the pivot's own
precomputed weight columns at a **finer** key, those are the numbers Price & Volume has
always published, and it is left alone rather than unified. See the banner over `piIndex_`.
Unifying it is a one-line change and it is **not** blocked on effort — it is blocked on the
fact that it moves every PPI on that page in the same commit, which is the opposite of
"PPI is correct". Do it as its own change, against a reconciliation, or not at all.

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
- **The AGG surcharge columns start in 2026** (`FSC_FROM_YM = 202601` in the Overview). The
  dollars and the tonnes they were charged on are a live-book field; the closed books that
  pre-date it do not carry them, and summed over one of those months the answer is a clean
  `$0.00` — indistinguishable, on a chart or in a table, from the surcharge collapsing. So every
  surcharge panel starts there rather than drawing that zero, the monthly chart included, and it
  is a DATE rather than "the newest book year": a 2026–2027 window is one the surcharge can
  answer in full.
- **RMX fuel recovery reaches back exactly two years, because one export holds two.** `RFSC`
  facts carry `cyYear` and `pyYear` and nothing older, so a custom window whose months sit in
  `pyYear` has no year to compare against. Those windows report the current side only
  (`rfuelSlice()`'s `noPy`) — and a rolling twelve months is one of them by construction.

### Extras / VAP

- **NOT ALL EXTRAS REVENUE IS CONCRETE REVENUE, and all-in ASP carries only the half that
  is.** Three families of `mat_prod_hier_3` are sales that have no m³ behind them: **pumping
  and conveying** (boom pumps, line pumps, conveyor trucks, their travel time and their
  hourly / minimum charges — a placement *service* sold beside the pour), **blocks**
  (concrete, interlocking, decorative, half) and **yard sales / resale aggregates** (AGGNEO,
  concrete stone and sand resale, premium slate and limestone, crushed recycled concrete).
  Qlik's `PPI (All IN)` sheet carries none of them; this file carried all three until
  2026-08-27, and that was the whole of the *"all-in ASP does not tie to Qlik"* gap.
  `rmxNonConc_` (§7) is the rule and `RMX_NONCONC_H3_` is the list. **The key is
  `mat_prod_hier_3` and it cannot be the EXTRAS LOOKUP category**: pumping sits inside
  *Misc* beside minimum-load and afterhours charges, which ARE concrete revenue, and blocks
  and yard sales sit inside *Other VAP* beside real admixtures. EXTRAS LOOKUP stays the one
  classification for TYPE and is not bent into carrying this as well — the tab's own
  `mat_prod_hier_3` column is what both paths read.
- **The two spellings of one group are the trap.** The raw tabs truncate the column at 24
  characters (`7 : Yard-stone-sand sale`) while EXTRAS LOOKUP holds it whole
  (`7 : Yard-stone-sand sales`), and the spacing around the colon differs between them
  (`4: Conveyors/Pumps` against `4 : Conveyors/Pumps`). `rmxH3Key_` normalises the spacing
  and the match is a prefix **either way**, with an 8-character floor so a stub cannot match.
  The code before the colon is **not** unique on its own — `9` is Fuel Surcharge on Extra Raw
  Data and Concrete Blocks on Associate Raw Data, `4` is Conveyors/Pumps and Steel Fibers —
  so the name has to be part of the key.
- **The split happens once, at the bundle, and every caller inherits it.** `splitNonConc_`
  takes those rows off `extras` / `assoc` into `bundle.nonConc`; `ovcRmxExtraTab_` keeps them
  out of the month cube for the same reason (the window-mode all-in ASP and the period-mode
  one are the same arithmetic over the same money, and filtering one of them is two answers
  to one question). Eleven places sum those two streams — a per-caller filter is a per-caller
  chance to forget. **Nothing is silently dropped**: the amount and the groups it came from
  ride the payloads as `nonConc` and are printed under the by-extra-type tables.
- **Measured against Qlik on HNS_SW / Jul-26 MTD**, which is the slice it was reported on:
  Qlik prints CY **$200.43** and PY **$201.61**; this file printed $202.03 / $204.45 and now
  prints $200.43 / $201.61, to the cent, with the ASP move at −0.6% rather than −1.2%. The
  excluded money is $87,400 CY and $163,146 PY out of $1,438,521 / $1,455,339 of extras and
  VAP. **BASE ("mix only") never moved and does not move here** — it was already right, which
  is what said the fault was on the VA side.
- **Three of the seven entries are measured; four are their own siblings.** Conveyors/Pumps,
  Concrete Blocks and Yard-stone-sand sales carry money in that slice and are what the
  arithmetic proves. Conveying/Pumping, Resale Aggregates, Aggregates and Crushed Recycled
  Concrete are the same two families under the codes the other markets and the closed books
  spell them with. **R/M Truck Rental is deliberately NOT on the list** — renting the mixer is
  charged on the delivery, and no reconciled slice yet says which side Qlik puts it on. A
  second Qlik screenshot from another market is what would settle it.
- **Applied-to m³ is not addable across extra types** — the same physical pour is counted under
  each hierarchy group it belongs to.
- **These rows carry their year, on Bill Month, and always have.** "Jan-25" is what decides
  which of the tab's two money columns a row fills, on the live book and on every closed one.
  The pair is headed `- CY` / `- PY` on the live export and `- 2024` / `- 2025` on the history
  ones, and **that difference costs nothing**: `APP_yearCols_` turns both into the same
  year → column map, which is the reason that helper exists. Anything claiming these rows have
  "no year of their own" is describing §7's `loadStream_`, not the sheet — see the next bullet.
- **An extras row is a Main Raw Data row with a different lookup, and the cube treats it as one.**
  `Main Raw Data` carries a Product Mix that `PRODUCT MASTER` turns into strength / class /
  application; `Extra Raw Data` and `Associate Raw Data` carry a `mat_descr` that `EXTRAS LOOKUP`
  turns into an extra type. Same plant, same Bill Month, same Major Project Segment, same money.
  So the month cube's Ready-Mix line has **four** dimensions — `plant × mix × segment × extra` —
  where `extra` holds the raw `mat_descr` exactly as `mix` holds the raw Product Mix, and
  `extraMap.extraType` is the side-table resolved from the LIVE `EXTRAS LOOKUP` at build time
  exactly as `mixMap` is resolved from the live `PRODUCT MASTER`. All three tabs are read in one
  pass (`ovcRmxAcc_` / `ovcRmxMain_` / `ovcRmxExtraTab_`), live and history alike, into the same
  rows, the same chunks and the same parked file. **There is no extras endpoint, no extras file
  and no extras shape version**, and the browser groups by type itself for any span the slider
  can reach.
- **A concrete row is one or the other, and the money says which.** Concrete: a mix, a blank
  `extra`, volume in `v` and base revenue in `r`. Extras: a blank mix, an `extra`, and its
  revenue in `ex` (Extra Raw Data) or `va` (Associate Raw Data), with **no volume**. That is
  what makes it safe: a blank mix is what `dimsForProduct_` already buckets as *Others* and
  never reaches `PRODUCT MASTER`, a plant × mix pair of zeroes fails the browser's `> 0`
  coverage test so **no PPI or CPI moves**, and every grouped view filters on
  `cyVol / pyVol / cyRev / pyRev` before it renders, so an extras-only group cannot appear as a
  row of zeroes in a breakdown or a dimension table.
- **`ex` / `va` were structurally zero for a long time.** They have been in the rmx line since
  shape v2 and nothing wrote to them — the live roll read `e.cyExRev` off Main Raw Data rows
  that never had such a field, and the history roll read `col.ex` out of a `byYear` map built
  from the volume and net-sales headers alone. Every Extras and VAP row of the Overview's
  window-mode ASP build-up read `$0.00` and All-in equalled Base, under a correct-looking
  heading, for as long as that panel existed. They are read from the tabs now, so the build-up
  and the by-type table underneath it are the same rows summed two ways.
- **"Extras & VAP, book year only" was never about months.** One export holds `cyYear` and
  `pyYear` and nothing older, and nothing used to read the closed books' extras tabs —
  `ovcHistRmx_` took Main Raw Data and stopped. That is the whole of the restriction, and it is
  gone: a Ready-Mix book is one read and its extras land with its volumes, so a year the slider
  can reach is a year the panel can answer. Neither extras tab is required — a book that ships
  only `Main Raw Data` parks its months and reports no extras.
- **"M3 Applied To" is not read into the cube at all.** It counts the same physical pour once
  under every extra that touched it, so it is not addable across types; the Overview's panel
  divides by total concrete m³ instead, which is the same denominator the ASP build-up above it
  uses and is what makes the rows add to the total. The Ready-Mix page's own **detail** table
  keeps applied m³ and prints penetration beside it — see the last two bullets.
- By-extra-type **summary** tables use total concrete m³ as the ASP denominator (additive);
  **detail** tables use applied m³ (per-applied-unit, explicitly labelled).
- Revenue-weighted apportionment *within* a single extra type is correct. The double-count
  reviewers flag is *between* types, not within them.

### Product classification

- **Match on SAP numeric codes, not descriptions.** Descriptions get renamed (WEATHERMIX →
  TEMPTECT); the numeric code prefix is stable.
- **Strength class:** only assign when a number appears directly adjacent to an MPa marker.
  Bare numbers in product names or class tokens do not count — default to `Others`.

### The suggester's band is the verdict; its score is presentation

`RMXSUGGEST` answers every proposed lookup row with a **band** — `High` / `Med` / `Low` — and
those three were validated against the tabs. **Nothing may start branching on the `score`
beside them.** The score exists because three buckets cannot be acted on across a list of
1,116 mixes: "Check" covers a row that nearly made High and one that nearly fell to Low, and
the reader has to tell them apart. So the score is the *same* verdict spread out, and each
band owns a slice of 0–100 that nothing leaves — `sgBandSpan_`: Low 15–54, Med 55–79, High
80–100. A Review row cannot score 81 and a Confident one cannot score 54, which is the
property that lets a chip print its word and its percentage together without them ever
disagreeing.

Inside a slice the position is the evidence's own strength: the nearest existing row's
similarity for a MATCHED suggestion (EXTRAS LOOKUP), the parts that were readable for a PARSED
one (PRODUCT MASTER). Changing the band rules changes which rows get pre-ticked and written;
changing the score changes only what the chip reads.

**Every row carries `reasons`, and it is never empty.** That is not decoration either: `why`
(the nearest-neighbour list) is empty *by construction* for every PRODUCT MASTER row, because
those rows are parsed rather than matched, and `note` is empty on exactly the rows that parsed
cleanly — so a confidence hover built from those two showed nothing at all on the rows a
reader was most likely to interrogate. A parsed row's `reasons` states all four reads (key,
brand, strength, class) whether each succeeded or not.

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
  pattern fixed it. The fan-out it left behind — one round trip per selected market, serially,
  so the panel took as long as the number of markets somebody happened to click — travels as
  one `AMR.batch` now. The merge is unchanged and still in the browser; only the transport
  moved. **One market short is not a customer panel**: the merge ADDS markets, so a slot that
  failed is an error message, never a quietly smaller total under the same heading.
- PPI accuracy: RMX rows expose `rfiBase`/`facBase` for exact subset PPI. AGG all-markets
  returns the exact `aggAll.ppi`; a single market is exact; **2+ market subsets** use a
  CY-revenue-weighted blend labelled ⓘ *"Estimate for a mix of markets"*.
- **Past twelve months the page reports volume and revenue, and nothing else.** `pyStale()`
  is the test — every "vs last year" is comparing months with months already inside the window
  — and `volRev()` is the consequence. Nothing that *divides* survives it: a pooled ASP across
  several years is not a price anyone charged, so ASP % inc, PPI, VOL %, both growth bridges
  and the Ready-Mix ASP build-up go with the prior-year columns. What is left is what **adds**.
  The panels do not print dashes where those numbers were — the KPI strip drops to two cards
  (`.kpi-row.two`), the tables drop six of their eight measure columns, the second donut becomes
  **revenue share**, the "vs last year" bars lose their prior-year series and the price chart is
  replaced by a revenue one. A blank chart under a live heading and a table of em dashes are
  both worse than not asking the question. `measHead()` / `measCells()` are the single place the
  columns are decided, which is what keeps six tables in step.
- **Revenue reaches this page under three names and every payload has it.** The cube and both
  cross reports say `cyRev` / `pyRev`; every Ready-Mix report says `baseCY` / `basePY`, because
  for Ready-Mix that figure *is* base concrete revenue; `PV.getReport` now sends `cyRev` too
  rather than leaving it to be read back off ASP. `revCY()` / `revPY()` read all three, and the
  ASP fallback is still there for a cached payload built before the field existed — exact
  except on a row with dollars and no volume, where ASP is 0 and ASP × volume drops them.
- **The cube keys a plant-derived field by the FIELD name, not by the plantMap it resolves
  through.** Aggregates submarkets are `submarket1`, and `sm1` is the dictionary. Asking for
  `sm1` matched nothing, and *the cube's answer to a `groupBy` it cannot resolve is not an
  error* — it drops every row into one bucket keyed `\u0001all`, which the page then discards
  as a sentinel. So on any window the submarket breakdown was simply absent, a submarket
  cross-filter was ignored by every cube-fed panel, and the ASP bridge's submarket mix item
  came out a flat zero, halving Region / Market mix (their average). Price & Volume hit this
  first; `AmrCube.dict()` now accepts either spelling so the two entry points cannot disagree.
- **Market summary sits above Month by month on both tabs, and it is cube-fed on purpose.**
  Period has four settings and only two exist on the server, so a table built off a report
  would mean one thing under MTD and nothing at all under Prev month (YTD). The cube answers
  all four and a dragged span besides. PPI is re-pooled on the span, never averaged out of the
  months in it.
- **A computed axis bound prints every digit it has.** Chart.js lays its ticks between the min
  and max it is handed, so a headroom of `9.1318562625202050` was the axis label. `headroom()`
  snaps both ends outward to a round step first — 9.13 becomes 10, −3.45 becomes −4 — and
  `fAxisPct()` rounds the label, because 3 × 0.2 is `0.6000000000000001` in binary.
- **The fuel-surcharge panel rides in with the overview payload.** That sheet carries no
  version token, so `loadFsc()` painted from the device and re-checked itself in the
  background — two executions on every open, for a panel this page's first paint draws
  anyway. It is a slot in the same batch as the `getOverview` pair now, on the first `load()`
  only, and `FSC_CHECKED` is what stops a Period switch or a re-anchor asking again. A failed
  slot puts `FSC_CHECKED` back and the panel takes `loadFsc()`'s own path, which has the
  message and the link.
- **The month window anchors on the NEWEST month, and the server is asked for it.** "This
  month" means the latest month there is data for and "Prev month" the one before it. The
  server reports would otherwise land on the reporting month (last calendar month), so the
  page reported two months at once — on an August visit a server KPI strip read 2,266,577 t
  above a cube-fed table reading 1,067,541 t for the same selection, every market at −50% or
  worse. `getOverview` takes a `month` (in its cache key), the Overview passes
  `anchorMonth()`, and both halves answer for the same month.
  **EVERY server call this page makes carries that month, and for two months it was only
  one of them.** `getOverview` was fixed and the other eight were not, so the split it was
  written to close reopened one panel lower: on the Ready-Mix tab `getRmxCrossReport` — and
  `RMX_NS.getKeys` inside `getOverview` itself — answered for the report month while the
  Market summary directly beneath answered for the anchor, and *"This month"* reproduced
  *"Prev month"* exactly. On the Aggregates tab it is inverted: the strip is anchored and
  `loadDims`, `loadPM`, `loadCustomers`, `loadXf` and `getCrossData` were not, so the
  submarket rows did not sum to the strip above them, and clicking any cross-filter moved
  the strip itself back a month. The list of calls is in §11 (2026-08-26). Two rules come
  out of it and neither is optional: **`month` travels with every request**, and **the month
  is in every client key** — `dimsKey` / `pmKey` / `xfSig` / `rxfSig` / `custKey` / the
  `XDATA` slot / the surcharge payload, not just `loadKey`, or the safety net below re-fetches
  one call and leaves six caches on the month they were first filled for, device copies
  included. **And being answered for the month you asked for is not the same as that month
  having rows in it**: a book the export has not reached answers correctly with nothing in
  it, so every report's `month` and its `months.cy` list are read back and `monthWarn()`
  names the difference in the tab footer rather than refusing to paint.
  **The MANIFEST is what the first fetch anchors on, and that is a different question from
  the slider's.** The first fetch used to run before the cube existed and so asked for month
  0 — the server's own default — and when a block landed the anchor moved and the whole thing
  was fetched again; each of those two fetches also prefetched the other Period, so one page
  open was four `getOverview` calls. The manifest already names every month the cube covers
  and it is the first thing the page receives, so `SEED_YM` takes the newest month off it and
  the first fetch is already right. `winMonths()` is untouched and still reads what has
  LANDED, deliberately — that rule is about not letting somebody drag into a month whose block
  is still in flight, and it can only ever be narrower than the manifest, never wider. The
  cache-first re-fetch stays as a safety net for the same reason it was written: two halves of
  the page reporting different months is a fault nobody can see from the outside.
- **The EBITDA workbook is a CLOSED-month statement, so its cards read `kpiMonth()`** — the
  month *before* the anchor — and say which month that is. It arrives during the month after
  the one it covers, so it can never answer for "this month"; moving the whole page back to
  meet it was the wrong half to move. **The month on that card is an EXPECTATION, and the
  wording says so.** `AmrKpi` carries no month at all — the cards show whatever workbook was
  last uploaded — so printing `kpiMonth()` flatly asserted something nobody had checked,
  which is the failure the label was added to prevent, one step further back. It reads *"the
  closed month, expected July 2026"*.
- **Period has four settings and only two exist on the server.** `MTD` and `YTD` are what the
  backends answer for. `PMTD` / `PYTD` are the same two shapes one month back, computed in the
  browser from the month cube. `STATE.pick` is the button; `STATE.period` stays the *server*
  period; `STATE.win` is true for both Prev-month picks and any dragged span.
  `windowPeriod()` tests the Prev-month spans FIRST, against the union's own last month — when
  Ready-Mix runs a month ahead of Aggregates a single month is both "Aggregates' MTD" and "the
  previous month", and the two answers drive different panels.
- **The opening screen waits for the opening WINDOW, not the whole history.** `AmrBoot`'s
  `month history` step used to be released only when every calendar-year block had streamed
  *and* every linked closed-year book had been read — minutes of a modal over a page whose own
  pill says "Nothing else on the page is waiting on this". `histBootReady()` releases it once
  the cube can answer the month the page opens on (that month and the same month a year
  earlier — two blocks); the rest keeps arriving behind the pill, which is not modal.
  **And the pill says the one line, not the paragraph.** `histState().long` — four sentences
  about calendar years landing newest first and the slider growing as they do — was printed
  under the line that already reads *"Loading months… 62% · back to Jan 23"*, for the whole of
  every open, on a page whose figures were behind it. The card carries the short line and the
  two buttons (⚙ Data sheet, Reload history — the only route to either); `long` is still
  written and still shown for a **fault**, which is the one case where the wording is the
  point, because it names the reason and carries the link.
- **The month blocks travel several to a call.** A block is already built and cached by the
  time the browser asks, so eight of them was eight queue waits for data that was sitting
  there. `CUBE_getChunks` takes the browser's ORDERED list — that order is the streaming plan,
  and re-ordering it server-side would send the Ready-Mix tab the Aggregates cube first — and
  `CUBE.CHUNKS_PER_CALL` (§1, and it rides in on the manifest so there is one copy of it) says
  how many to ask for. It may answer with fewer: the reply has to survive being serialised, so
  it stops short of `CUBE.BYTES_PER_CALL`, measured off the cache's own chunk count rather
  than by reading the entry to find out how big it is. Fewer than asked is normal and the rest
  are re-asked — **gated on that reply having carried at least one usable block**, which is
  what makes a block that can never be served get tried once instead of for ever.
- **The data-quality panel offers EVERY row, and the reason it used to offer 200 is fixed
  rather than capped.** The arithmetic behind the cap was right: the Ready-Mix mix section
  lists well over a thousand mixes, each proposed row is five controls, and three of those
  are selects carrying the whole PRODUCT MASTER vocabulary. Measured in Chromium, 1,200 rows
  rendered that way is **91,200 nodes and 5.8 seconds** of frozen main thread — on a fast
  machine with nothing else running, so inside the Apps Script frame it is a page that has
  hung. `LK_BATCH = 200` made that about 1.6s and left the real cost in place: fixing 1,116
  mixes meant six rounds of fill → save → **wait for the cube to rebuild**, and the rebuild
  is the slow half. Two changes remove the cost instead of the rows:
  **`lkSelect` renders one option** — the selected one, which is what a save reads, so a
  select nobody touches still writes the right value — and `lkFill()` puts the rest in on the
  first focus or mousedown, both of which fire before the dropdown opens; and **`.lk-row`
  carries `content-visibility:auto`**, so the 340px scroll box lays out the rows you can see
  rather than the thousand you cannot. Same 1,200 rows: **25,200 nodes and 325 ms**, eighteen
  times faster than what the cap was protecting against and quicker than the old form managed
  with 200. The one trap, and it is checked: with no value the old select rendered nothing
  selected and the browser took the FIRST option, so that is what a save has always written —
  `lkSelect` therefore selects `list[0]`, not blank.
- **The listing shows every row too, and only for the section that is OPEN.** It used to stop
  at the 60 biggest by revenue and say so, which on 1,116 mixes is a footnote where the answer
  should be. The 60 was there because `renderDq()` builds every section at once, open or shut;
  building the table only for an open one removes the reason and the cap with it. The section
  toggle therefore re-renders rather than just flipping a class.
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
- **An in-panel toggle repaints from whatever is DRIVING the page, never from the server.**
  `repaintPanel(win, xf, srv)` is the same three-way answer `renderTab()` gives and
  `srvOwnsAgg()` states, in the one other place it has to be given. Pressing *Split by
  segment*, *Product Class* or *Submarkets* is not a new selection — period, window and market
  have not moved — but all five toggles called the server painter unconditionally, and the
  server painter fetches `STATE.period`. On a Prev-month or dragged span that put the
  month-to-date back into the panel a moment after the click, under the window's own heading,
  so the page read as having forgotten which months were selected while every panel around it
  still showed them. `ovperiod.js` check 8 presses all five and fails if the panel's subtitle
  stops naming the window. **A late server ANSWER is the same rule**: the customer merge and
  `renderFsc()` test `winMode()` too, because a fetch issued for `STATE.period` can land after
  the user has opened a window, and the request-key check catches a changed market but not a
  changed owner.
- **In window mode the server reports must not paint.** `loadDims` / `loadPM` / `paintRxfPanels`
  still run — they keep the filter lists and the shared cache warm — but they fetch for the
  *server* period, so `srvOwnsAgg()` and an early return stop them repainting a fifth of a
  second after the cube drew the window. For the same reason `renderTab()` tests `winMode()`
  BEFORE `xfActive()`: the cube applies the page's cross-filters itself.
- **What the cube can answer is not a short list.** In window mode the browser builds the plant
  & material explorer, the customer table, both fuel-surcharge panels, the revenue and ASP-mix
  waterfalls, the Ready-Mix ASP build-up — pooled and **per month**, as a stack and as an all-in
  line beside the base one — and Ready-Mix fuel recovery, which is **not** a cube panel at all:
  the RFSC facts carry `(plant, segment, year, month)` of their own, so `rfuelWinSpan()` filters
  them on the window directly. Genuinely absent: the SAP / USGAAP cards, and the Aggregates
  surcharge panels before `FSC_FROM_YM` (`winFscOk()`).
- **Extras & VAP by type is a GROUP-BY, not a fetch.** It was hidden for Prev-month picks and
  every dragged span, then briefly given a server endpoint of its own, on the observation that
  the cube could not split extras by type. It can: `extra` is a dimension of the Ready-Mix line
  and `extraMap.extraType` is what `EXTRAS LOOKUP` calls it, so `winExtrasReport()` is one more
  pass over the fact table already in the browser — the same pass, the same filters and the same
  months as the ASP build-up above it, which is what makes the two agree. **Nothing is fetched
  for it and there is no book-year gate**: a year the slider can reach is a year the panel
  answers, because a book's extras were read with its volumes. `getRmxCrossReport` is still
  fetched in window mode, because its per-field option lists feed the filter drop-downs, and it
  paints **nothing** there. **Product Category is the only panel on this page gated on WHICH
  period is picked.**
- **The data-quality badge asks for nothing, and that is what makes it honest.** Every section
  comes off the cube manifest the page already holds, so the ⚠ count is right from the first
  paint. Two of them used to come from a second call (`getRmxSuggestions`) over the LIVE
  workbook alone, made only by `dqOpen()` — so the extras misses did not exist until somebody
  opened the panel, and even then they could only ever see two book years. **A material that
  traded in a closed year and is not in `EXTRAS LOOKUP` was invisible**: the panel reported "all
  matched" while the Extras & VAP table quietly dropped that revenue into *Unclassified*. The
  cube collects the misses across every era while it builds, exactly as it does for
  `PRODUCT MASTER`, and the manifest now carries `unmapped.checked` — **how many distinct values
  were tested**, per kind — because "all matched" and "nothing was examined" had looked identical
  on that line through every version of this panel that has ever been wrong. The section reads
  *"✓ all 812 matched"*, or *"✓ nothing to check"*, and never just a tick.
  The **add-rows** form still asks the server, and it asks it about **the values on screen**
  (`getRmxSuggestions {values, kind}`) rather than about the live workbook's own miss list —
  those are not the same list, and asking for the wrong one is what opened that form empty while
  the section behind it listed 1,116 mixes.
- History cube: era files are registered in `APP_EXTRA_SOURCES.overview`; `ERAS` is
  newest-first. History JSON is stamped with shape/dims/vals so stale files auto-rebuild. A
  **dictionary remap** is required when merging per-era files built with independent
  dictionaries.
- **A Ready-Mix book is ONE read, and its extras come with it.** `CUBE_rebuildHistory {line,
  era}` reads `Main Raw Data`, `Extra Raw Data` and `Associate Raw Data` into one accumulator
  and parks one file. It was briefly two calls — `part:'extras'`, its own Drive file, its own
  `OVX_SHAPE_VER_` — on the grounds that Main is ~58,000 rows and neither half should cost the
  other's time. That saved one read and bought a second thing to queue, to fail, to invalidate
  and to forget, and a closed year that carried its volumes with no extras against them for as
  long as nobody triggered the other half. The extras tabs are a fraction of Main's size.
- **A change to what a column CONTAINS is a shape change.** `OVCUBE_SHAPE_VER_`'s comment used
  to say "bump whenever `OVCUBE_SHAPE_` changes", meaning the layout, and `ex` / `va` did not
  move when they went from never-written to filled — so it was not bumped, and the fix reached
  nobody. Both caches key on `ovcGen_()` and the browser's IndexedDB wipes **only** when that
  token moves, so every warm device replayed the pre-fold blocks indefinitely. This is the
  second time this exact failure has been written up here: `ovcCovTok_`'s banner is the first,
  for a COVERAGE threshold that travelled inside a cached payload whose key never noticed it.
  **If a payload carries it, the key has to.**
- `cyMonths` and `pyMonths` passed to `AmrCube.query` must be **index-aligned**, and
  `groupBy:'ym'` must map prior-year rows onto their CY slot — otherwise the series returns
  twice as many points with PPI 0.
- Numeric reconciliation tolerance is 1e-5 relative (measures are rounded to 2 dp on the wire);
  the un-rounded path achieves 1e-15.

#### Every restriction on the Overview, and the gate that enforces it

The bullets above say *why* each of these is the way it is and are the thing to read before
changing one. This table is the **index**: what the rule is, and the one function to `Ctrl+F`
for. If a panel is missing from a screenshot, start here — a panel that is simply not on the
page is almost always one of these deciding correctly.

| # | Restriction | Gate |
|---|---|---|
| 1 | Read-only aggregator: never recomputes, always defers to the base tools' caches, never blends an AGG line with an RMX one | the page has no arithmetic of its own outside the cube painters |
| 2 | A market has to be in `OVERVIEW.MARKETS` or it is on no panel; what is in the sheets and not in that list is named in the footer and in Data quality | `dqUnmapped()`, `out.unmatched` |
| 3 | Market selection is **one market or All markets** — the chips are single-select, so there is no 2+ subset to reach any more | `renderChips()` (`next = [mk]`), `selectedKeys()` |
| 4 | Period has four picks and **only two exist on the server**; `PMTD` / `PYTD` are the same two shapes one month back, computed in the browser | `PICK_SERVER`, `STATE.pick` vs `STATE.period` |
| 5 | The anchor is the **newest month the cube holds**, not the reporting month; **every** server call is passed it and **every** client key carries it, or the page reports two months at once | `anchorMonth()`, `loadMonth()`, `SEED_YM`, `dimsKey` / `pmKey` / `xfSig` / `rxfSig` / `custKey` / `xdataKey` / `fscKey` |
| 5b | A report that answered for another month, or for this one with no rows in it, **says so** — it is never assumed and never used to refuse the paint | `monthWarn()`, `paidMonth()`, each payload's `month` + `months.cy` |
| 6 | **All four** Period buttons stay **disabled** until the cube can resolve their span — pressing one MOVES THE HANDLES, so none of them works without it | `syncPeriodSeg()` / `periodSpan()` |
| 6b | The KPI strip **names its own span**, like every other card, on every paint path including loading and fault states | `kpiSpan()`, `stripLabel()` |
| 7 | The slider offers only months that have **landed**, never the manifest's full range | `winMonths()` (reads `AmrCube.months`, not `manifest.ym`) |
| 8 | Prev-month spans are tested **before** MTD/YTD, because one month can be both when the lines run a month apart | `windowPeriod()` |
| 9 | Past twelve months the page reports **volume and revenue and nothing else** — no ASP % inc, PPI, VOL %, neither bridge, no pooled RMX ASP build-up. The month/quarter trend is exempt (every point is one bucket against the same bucket a year earlier) but loses its prior-year series; the monthly build-up **stack** stops at twelve buckets on legibility, not honesty | `pyStale()` → `volRev()`, columns via `measHead()` / `measCells()`; `longWin` / `buIx` in `renderTrendPanel()` |
| 10 | **Product Category** is shown for the two Prev-month picks only, AND only when the month it lands on is the Slide tabs' own month. **The only WHICH-PERIOD gate left on the page** | `pcatFits()`, decided first in the RMX branch |
| 11 | **Extras & VAP by type** is on every Period pick AND every window, and in window mode it is a **local group-by** on the cube's `extra` dimension — no fetch, no book-year gate | `winExtrasReport()` → `renderWinExtras()` |
| 12 | **Ready-Mix fuel recovery** answers for a window too — not from the cube (the per-load surcharge is on no fact-table column) but from the RFSC facts' own `(year, month)`. One export holds `cyYear` and `pyYear`, so a window reaching back into `pyYear` — **a rolling twelve months, by construction** — reports this year and DROPS the prior-year columns and bars rather than dashing or zeroing them | `rfuelWinSpan()` → `rfuelSlice()`'s `noPy` |
| 13 | Every **fuel-surcharge** panel, pooled and monthly, starts at `FSC_FROM_YM` (`202601`) — before that the surcharge columns are not in the book, and $0.00 on a chart is indistinguishable from a collapse. A date, not "the newest book year": a 2026–2027 window is one the surcharge can answer in full | `winFscOk()`, `fsIx` in `renderTrendPanel()` |
| 14 | The **SAP / USGAAP cards** are hidden outright in window mode; they are statement figures and exist per month or per year only. Out of window mode they read the month BEFORE the anchor and say which | `syncWinPanels()`, `kpiMonth()` |
| 15 | **A panel with nothing in it is not shown** — no rows, no data, not computable → the card goes. Only genuine faults speak, because those are fixable and carry a link | `hidePanel()` / `resetPanels()` at the top of `renderTab()` |
| 16 | In window mode the **server reports must not paint**, with no exception: `loadDims` / `loadPM` / `paintRxfPanels` still run to keep the filter lists and shared caches warm and paint nothing | `srvOwnsAgg()`, `winMode()` early returns |
| 17 | `renderTab()` tests `winMode()` **before** `xfActive()` — the cube applies the page's cross-filters itself | `renderTab()` |
| 18 | An in-panel toggle repaints from whatever is **driving** the page, never from the server | `repaintPanel(win, xf, srv)` |
| 19 | A **late** server answer re-tests the same three-way answer; a request key catches a changed market but not a changed owner | `winMode()` in the customer merge and `renderFsc()` |
| 20 | PPI is never averaged or summed: re-pooled on the span, exact for all-markets and for a single market | `AmrCube` coverage recompute; `rfiBase` / `facBase` |
| 21 | Applied-to m³ is not additive across extra types; every $/m³ in the by-type table sits on **total concrete m³**, which is what makes the rows addable | `rxfAspBlock_`, `sumRows()` |
| 22 | Extras and VAP carry **no product mix**, so a Strength or Product Class filter would ZERO them rather than narrow them: the ASP build-up and the by-type table are both DROPPED. Refused, never silently ignored | `RXF_MIX_ONLY` / `mixFiltered` on the cross-report; `rxfMixFiltered()` in `renderWinRmxAsp()` and `renderWinExtras()` |
| 23 | Customers are fetched **per selected market** and merged in the browser; a slot that failed is an error, never a quietly smaller total | `loadCustomers()` + `AMR.batch` |
| 24 | Revenue reaches the page under **three names** and every payload has it | `revCY()` / `revPY()` |
| 25 | The cube keys a plant-derived field by the **field** name (`submarket1`), not by the plantMap (`sm1`); a `groupBy` it cannot resolve returns one bucket, not an error | `AmrCube.dict()` accepts either |
| 26 | Chart instances live in **per-section registries**, never one global list | `CH` in §P `overview` (fifteen arrays) |
| 27 | Data quality is deliberately **not** filtered by market, period or window — it is about fixing the lookup tabs, not reading a slice | `dqSections()` |
| 28 | Data quality asks the server for **nothing** — every section is the cube manifest's, so the ⚠ count is right from the first paint. A clean section states the POPULATION it tested, so "all matched" cannot mean "nothing was examined" | `dqSections()`, `unmapped.checked` from `ovcBagOut_` |
| 29 | One loading screen, one `AmrProgress` key; the boot screen releases on the opening WINDOW, not the whole history | `histBootReady()`, `AmrBoot.painted()` |
| 30 | `invalidateAll()` is the **single** invalidation path — a cache added later has exactly one function to be added to | `invalidateAll()` |
| 31 | `ex` / `va` on the rmx line are the **extras tabs themselves**, read in the same pass as Main Raw Data — so the ASP build-up and the by-type table below it are the same rows summed two ways, not two sources that happen to agree | `ovcRmxAcc_`, `ovcRmxExtraTab_` |

### Rendering traps

- **Scoping a CSS rule is not a neutral transformation of it.** `body[data-page="x"] ` narrows
  what a selector matches AND raises its specificity by an attribute selector, so a prefixed
  bare `th{}` can start beating shared `.class` rules the original lost to — that cost 673
  computed values on Ready-Mix. Use `:where(body[data-page="x"])`, which adds no weight. And
  the page is not the document: `#appRoot` is a `<main>` between `<body>` and the page, so a
  bare `main{}` restyles the mount. `tests/merge.js` check 8 covers reach, `tests/cssparity.js`
  covers weight.
- **A cascade gate cannot see a rule that is simply GONE.** `cssparity` compares computed
  values over markup both sides render, and derives the properties it compares *from the block
  it is auditing* — so a block the port dropped contributes no markup to pair and no properties
  to compare. Ready-Mix's `.impact` strip shipped that way for the whole merge: the page kept
  emitting the markup, the `!` badge ran into the sentence as "!339 products", and the "Fix
  mapping" button was a browser-grey UA button in the middle of the text. `setStrip()` builds
  the strip in JS, so no markup check meets the class either, and **no fixture in `tests/`
  answers `RMX_getUnmapped` with a row**, so it renders in no harness run at all.
  `tests/cssdropped.js` is the gate: every class the deleted files styled, that `app.html`
  still emits, still has a rule.
- **A promoted rule is only shared if every caller uses the promoted NAME.** When the two
  mapping checks were merged into §A3, Price & Volume's names won — `mchev` for the section
  arrow, `map-open` for the body scroll lock — and Ready-Mix's markup went on emitting `chev`
  and `sug-open`. Neither is an error anywhere: `chev` fell through to the generic 10px rule and
  the section arrow **never rotated**, so an open section looked exactly like a shut one, and
  the page behind the dialog kept scrolling. Renaming a class into a shared layer is a change to
  every emitter of it, not only to the CSS.
- **Apps Script runs every `<? … ?>` in an HTML file, comments included**, and its printing
  scriptlet HTML-escapes — so one written as an example in a comment breaks the render, and one
  printed into JavaScript can emit `&#39;` and kill the whole script block. Server values
  belong in a `<body>` data attribute. `tests/merge.js` enforces both.
- **A style element's content is text until its closing tag.** Anything that leaks in is parsed
  as CSS, and CSS error recovery eats the rule after it without a word. §B shipped that way for
  three chunks because a builder split a file on a style tag written in *prose* inside a
  comment. Never write either tag as a literal when you mean to name it. `merge.js` check 9 is
  the gate.
- **The page switcher only unmounts what it can SEE, and a reload used to tear down
  everything.** That is the whole class of bug switching introduced. The sharpest instance:
  `setInterval` is wrapped so the runtime can cancel it, and `app.html` never calls it — not
  once. The hook was written for `AmrFresh`'s five-minute poll, and `AmrFresh` reschedules with
  `setTimeout`, so the poll **survived every switch**. What that cost was not a stray timer but
  a *wrong answer*: the watch holds the data version of the page that started it, `page()` reads
  `window.APP_PAGE` which the switch has already moved, and the generation token is **per
  page** — so the poll compared two different pages' versions, never matched, and told the user
  their figures were stale. Anything a page starts that the runtime cannot see needs its own
  teardown; `tests/pageswitch.js` checks that no five-minute watch outlives the page that
  started it.
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
- **Past `--bp-wide` the QlikView guide is pinned open, and a page has to carve its column
  out.** §A3 shows `.qlikGuide` and hides its FAB above 1720px, because at that width there is
  room for both — and the rule that makes the room names `.shell`. Ready-Mix lays itself out
  with `.wrap` (see §A4's note on why), so it kept the full viewport and the guide was pinned
  open **on top of it**: the last 250px of every table, the ✓ matched pills on the mapping
  check and the per-card help buttons all under a panel with no way to shut it, because the
  FAB that closes it is `display:none` at exactly that width. Every other guide page has a
  `.shell` or is centred narrow enough to clear it; the landing page's full-bleed hero is the
  one deliberate overlap. **Adding a page whose root is not `.shell`, or mounting the guide on
  one, means adding it to that media query.**

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

### Four stages, never one shot

Forty-three slides of Slides API round trips do not fit in one execution, and a failure at
slide 40 must not cost the first 39.

1. **Plan** — read the recipe. No data, instant.
2. **Arrange** — order, membership, what each slide shows. No data either, and no Slides call:
   it is three Script Property reads, which is what keeps it as quick as Plan. See *Arranging
   the deck* below.
3. **Render** — check the source sheets first, then one slide at a time in the browser: ask the
   source for its content block, photograph it, keep the PNG. All the compute is here. The
   source check is *part of* Render rather than a separate button, because photographing 43
   slides from figures the sheet replaced an hour ago is the one failure this page cannot show
   you — every slide builds, nothing goes red, and the deck is quietly last week's.
4. **Publish** — one `google.script.run` per slide. ~2–4 s each, well inside the 6-minute limit
   because no call ever handles more than one slide.

**Render can be stopped.** A `Stop render` button appears beside Render while a pass is
running and ends it at the *next* slide: the one being photographed finishes and is kept,
because a capture is one `html2canvas` call that either produces a picture or does not, and
abandoning it half way would cost that slide for nothing. Everything already rendered stays, so
pressing Render again carries on with what is left — the same rule a failed slide already
relies on, since a pass only ever renders `r.on && !r.png`.

A row that fails is marked red and left alone; pressing Render again retries only the
unfinished rows — and `DECK_finish` is given the deck's order so the retried slide lands where
it belongs rather than behind everything built on the first press. `addSlide` always appends,
so before that a slide that failed at position 30 published at 44, and `{{PAGE}}` numbered that
order confidently.

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

### Arranging the deck

**Arrange is a mode of the slide list, not a panel above it.** It used to be its own card
holding a *second copy* of all 43 rows in a 620 px scroller with a fixed 356 px column beside
it — so the layout picker was in one list, the arrows and the tables in the other, and every
change meant scrolling between them. Pressing Arrange now grows each row's own cells in place:
the move arrows and the tick at the front, the editable title and the source / market / refine
/ period selects under it, `Tables` and `×` at the end, with the layout picker, the Region
dropdown, the status and the preview exactly where they were. `Tables` opens the scope panel as
a **drawer under that row** — pressed again, it closes. The two were kept apart for one reason
and the reason is gone rather than overruled: `#dbList`'s markup was what `pageparity.js`
diffed byte for byte, and that harness went with the rest of `tests/` on 2026-08-25 ([§10](#10-working-conventions)).
The one thing that did *not* merge is the tick, which has always meant two things and still
does: outside Arrange it is this browser's "skip it on this render" and saves nothing; inside
it is the pack's membership, saved for everybody.

**Adding, dropping and reordering a slide are all things the page does now** — as are
retitling one, changing which market or period it is for, changing which *page* produces it,
and choosing which tables it shows. Two more shared Script Properties carry it, on exactly the
pattern `PROP_LAYOUTS` set: `DECK_PLAN` holds the order, the membership and the per-row edits;
`DECK_TABLE_MAP` holds what each scope shows.

**Editing `DECK_RECIPE` is still the right way to change what the pack *is*.** The stage is for
what *this month's* pack does, and two rules keep both true at once:

- **Nothing stored is byte-identical to the recipe.** An untouched row has no key anywhere, and
  an arrangement that happens to equal the recipe is *deleted* rather than kept. Otherwise the
  first press of any button in Arrange would freeze all 43 rows, and the next person to
  re-point a slide in code would change nothing and have no way to see why. The sharp cases are
  the undos: move a slide and move it back, untick and re-tick, delete and Restore.
- **A recipe row added after an order was saved is inserted beside its recipe predecessor.**
  Not appended, not dropped — so adding a slide between two others in the array puts it between
  those two others in the deck, whatever anybody has arranged.

**Deleting and unticking answer different questions**, and both exist. `off` is "not in this
month's pack" — the slide stays in the list, greyed, one click from coming back. `drop` is "not
part of the pack any more", and it comes with a **Deleted slides** list and a Restore, because
a deletion nobody can undo from the page is only undoable by editing a Script Property. The two
also have to be told apart in the *stale-key* check, or every deletion produces a banner nobody
can clear.

**The scope ladder** is how "change every market at once, or just this one" works with no flag.
A row walks four keys and takes the first answer, tables and KPI resolved independently:

| Rung | Key | Means |
|---|---|---|
| 1 | `row:pv_sw_ytd` | one slide — the only way to make MTD and YTD differ |
| 2 | `pv\|Southwest\|Docks` | the Land / Docks split. **Southwest only** |
| 3 | `pv\|Manitoba` | one market, both periods |
| 4 | `pv` | every slide that page produces |
| — | the adapter's own default | nothing stored: what the deck builds today |

`period` appears in no key above rung 1, which is what makes a change to a market reach its MTD
and YTD slides together. **Rung 2 is Southwest's alone** — Land and Docks are two values of its
`MB SUBMARKET` column, not markets, and no other market divides below market level.

**The panel opens on the market rung**, rung 3 — not on the widest one. A table selection or a
KPI region is nearly always "this market, both periods", and opening on `pv` made the safe
change the one you had to go looking for and the one that moves all fourteen Price & Volume
slides the one you got by not looking. A row that names no market — Fuel Recovery, whose whole ladder is `row:fsc_mtd` then
`fsc` — opens on the broadest rung it has, which for a source with one slide per period *is*
the market. **The Region select belongs to the two rungs that are one view of one market** —
the market's, rung 3, and rung 2 where a market has a Land / Docks split — and is offered
nowhere else: a sheet name out of one market's EBITDA workbook is meaningless on `pv`, where it
would be handed to every other market's slides, and on `row:` it settles one slide while its
MTD/YTD twin reads the market's, which is the same figure disagreeing with itself in one pack.
**Rung 2 is not a nicety for the Region**: Southwest Land and Southwest Docks read different
region sheets from whole-market Southwest, and once the per-device memory went there was no
other place that difference could live. The strip's on/off is *not* gated with either — that
question is meaningful at every rung, and switching the strip off across a whole source is a
real thing to want.

**Which rung is answering is said once, on the row.** The `.db-ar-scope` line under a slide's
title names where its tables and KPI come from; the rung buttons carried a second copy of it as
an "answering" badge, and two answers to *where does this come from* in one panel is one too
many.

`tables` is one **ordered** array, so "which tables" and "in what order" cannot disagree. The
AGG side has to impose that order client-side: `getReport` walks `CONFIG.DIMENSIONS` and pushes
a table for every key in the request, so the array comes back in the *server's* order however
the request was written, with the customer-segment pivot appended last. Ready-Mix gets it free.

**A changed selection drops exactly the pictures it changed.** `tablesUsed` / `kpiUsed` are
stamped at render time, so it is a comparison and not a guess: a scope reaches every slide
below it, but a row with a more specific rung answering for it did not move and its picture is
still right. Changing a row's source, market, period or refine drops its picture
*unconditionally* — a different market is different figures, whatever it was rendered with.
Reordering drops nothing: it changes only where a slide lands, which is `finish`'s job.

**An added slide is a slide like any other.** It takes a layout, it is retried by id, and its
layout is overridable from the same dropdown as every other row's — so `DECK_setLayout` resolves
an id against the recipe *and* the plan's `add`. Clearing an override is checked first and opens
no template, because it is the one call that has to work for a slide that no longer exists:
deleting an added row takes it out of `add`, and the override it left behind would otherwise be
an orphan reachable only by resetting every row's layout at once.

**Changing a source is not a relabel.** A different adapter runs, so the market is re-spelled
through `OVERVIEW.MARKETS` — the same market is `'Southwest'` to Price & Volume and `'HNS_SW'`
to Ready-Mix, and a market the new source cannot spell blanks the field and forces a re-pick
rather than carrying a name that matches no row. That is exactly what once published Southwest
Land as a page of zeroes. Refine clears unless the new source still offers one there, period
clears for a source that shows both, and the row's own table scope is discarded because its
keys belong to the old catalogue.

**The KPI Region is the arrangement's, and there is no per-device memory left under it.** It
used to sit between the shared choice and the workbook default: the same localStorage map the
Price & Volume page writes, so two people building from the same saved arrangement could
publish different KPI numbers on the same slide with nothing on screen saying so — and a region
is not something you can see is wrong on a finished picture. Two answers remain and both are
the same on every device: **the region a rung of that row's ladder chose**, and — when none has
— **the first region sheet of the workbook that row's market reads**. The per-row control is a
**read-out**, captioned `Region · shared` or `Region · default` so a real region sheet nobody
picked is readable rather than silent, and the Arrange drawer's own "not set" option names
whichever of the two would answer instead. The Price & Volume page keeps its own per-view
memory for its own screen; it no longer has any say in what a deck slide shows.

**A property value has a size limit and the writers measure before they write**, refusing with
a readable sentence rather than truncating: a rejected save leaves the last good arrangement in
place and a truncated one does not. The guard is Google's published 9 KB per value, not the
larger figure the runtime is observed to accept, and it costs nothing — the whole deck
reordered is 608 characters, ten added slides 2,227, and the pathological case (all 43 rows
reordered *and* rewritten) 5,183.

**Market coverage note:** the source pack has no AGG summary slide for North and no Top 10
slide for Central Canada. That is copied faithfully rather than "corrected".

### Still owed

Nothing off-platform can do any of these. **A real end-to-end build has never been run against
the live deployment** — every adapter is registered and the path is exercised offline, but
`DECK_create` / `addSlide` / `finish` have not run for real, and no capture has gone through
`html2canvas` outside a harness. `DECK_status` is kept until that build says whether the
Publish stage needs it. `finish` taking an order is on that same path: the ordering itself is
gated against a stubbed presentation in `deckstatic.js`, but a real deck is what confirms
`Slide.move()` behaves as the model assumes when 43 of them run in one execution.

---

## 9. Deleting things, and what must not be deleted

Everything unused should come out. **But "unused" has to be proved, and in Apps Script a grep
does not prove it.**

> ### What counts as proof, and the trap that nearly cost the data pipeline
>
> Grep **is** reliable for one thing: every client → server call here uses a literal function
> name (`google.script.run.someFunction(…)`). There is no dynamic dispatch anywhere —
> `google.script.run[name]` appears zero times — so if nothing in `app.html` names a server
> function, no page calls it.
>
> **But a function with no caller in the repo can still be load-bearing**, because three kinds
> of caller live outside it:
>
> 1. **Time-driven triggers**, configured by hand in the Apps Script UI. Nothing in the repo
>    references them: the single `ScriptApp.newTrigger` in the codebase arms the sync's one-shot
>    retry (`qlikSyncRetry`) and none of the three hand-set timers.
> 2. **Editor-run tools**, invoked by a human from the Run menu.
> 3. **`doGet`**, called by Apps Script itself.
>
> This is not hypothetical. An earlier draft of the merge plan described the sync's four entry
> points as having "no client caller" — true, and badly misleading: **`qlikSyncCheck` was the
> time-driven trigger that ran the entire QlikView → Sheets pipeline.** Deleting it on a
> zero-caller count would have silently stopped every page's data from updating again, and
> nothing would have errored. (That function is gone now — deliberately, on 2026-08-25, and
> with the trigger list checked. `qlikSyncAggregates`, `qlikSyncReadyMix` and `qlikSyncSegment`
> stand in exactly the same position and carry exactly the same warning.)
>
> So: **before deleting a top-level function, check the trigger list in the Apps Script UI and
> check whether its own comment says it is run from the editor.** Both are outside the repo.
> Only then does zero callers mean dead.

Client-side modules are the one place grep *is* conclusive — no dynamic dispatch, and a
browser module cannot be reached by a trigger or the Run menu.

**And a comment claiming code is dead is not evidence either.** `OVERVIEW` carried a banner
starting `NOT USED` for four chunks while `getOverview` read its market list on every Overview
load. The candidate was not a function nobody could find a caller for — it was a `var` that
*announced itself as dead*, in a comment that survived a verbatim merge precisely because the
merge moved everything without editing it. A grep for the name answers it in one second, and
the banner still stood for four chunks. **Read the code, not the label.**

### Things that look deletable and are not

| | |
|---|---|
| `park_`'s `firstData` | Looks like a field nothing reads back. It is the first data row, and it is the only correct answer available to a run that finds a parked band: with the band off the tab `firstDataRow_` answers one row too low, and the export lands one row out |
| `qlikSyncAggregates` / `qlikSyncReadyMix` / `qlikSyncSegment` | **The data pipeline.** One hand-set time-driven trigger each, and nothing in the repo points at any of them. Deleting one stops that page's figures updating for ever, silently, while the other two keep going — which reads as a fault in the page rather than in the timer |
| `qlikMarkCurrent` | Run once from the editor after the timers are set up, so the first firing of each has a stamp to compare. Needed again any time they are rebuilt |
| `qlikAggNow` / `qlikRmxNow` / `qlikSegmentNow` | **Editor tools, and the whole of the manual recovery path** when a timer misfires or a sync has to be forced. The Run menu passes no arguments, so a function taking a source key cannot be run from it — these three carry the key, which is why they exist and why they take nothing. Zero callers is what they are for |
| `qlikSyncNowOne_` | The one export behind those three. Private, and it stays private: it is what makes "one at a time" a property of the code rather than advice. `qlikSyncNow(scope)` and `qlikSyncCheck` — the two ways of asking for all three at once — were removed on 2026-08-25 |
| `qlikStamps` | What each timer will compare on its next firing, and what it will do. With five hand-set triggers and no harness left, the diagnostics are how this pipeline is inspected at all |
| `qlikAlertsOn` / `qlikAlertsOff` | The failure mail's switch, and the only way to reach it without editing Project Settings by hand. Editor tools, and the mute they set is reported by `qlikRetryStatus` precisely so it cannot be forgotten |
| `clearRetiredOverrides` | Its own comment says "run from the Apps Script editor", and it is idempotent. An editor tool, not dead code |
| `useCodeSheets` | Same kind of thing, for the opposite problem: an override that is still *valid* but no longer *wanted*, which is what makes a changed `defaultSpreadsheetId` do nothing. Editor tool, idempotent, and it reports what every page resolves to afterwards |
| `getSaskRatesStatus` | Its comment says "so the Settings screen **(and a quick manual run)** can check the sheet" — that parenthetical is the editor-tool criterion. The Settings screen never calls it; wiring it would be a behaviour change, not a cleanup |
| `DECK_status` | A real deck build has still never run against the live deployment, and that is what decides whether the Publish stage needs it. **Do not delete before then** |
| `SB` · `getSlideData` | Live — the Overview's segment and product-category panels read them |
| `RMX_getCrossReport` · `getRmxUnmapped` · `uploadRmxData` · `getMarkets` · `getKeys` · `getExtras` · `syncData` | The **legacy-name wrappers**. Zero callers is not the test: they exist so a stale deployment still resolves, and removing one changes what that deployment does. `getMarkets` / `getKeys` / `getExtras` are exactly the generic names the `RMX_NS` capture protects against. Treat as its own piece of work |
| `doGet` | Apps Script itself is the caller |
| `appsscript.json`'s `Sheets` advanced service | **Nothing calls the `Sheets` symbol** — §5 reaches the same API over `UrlFetchApp` on the script's own token. Listing it is what switches the **Sheets API on in the Cloud project**, which a default Apps Script project has off while Drive's is on. Remove it and every Sheets REST call answers 403: the sync's wait for a converted export goes blind, `check 0` stops running, and a 47,634-row export lands as 1,113 rows with nothing reporting it |

**All seven debug functions are already gone**, and a repo-wide audit of every top-level
declaration found no others: every remaining callerless name is either a deliberate keep above
or was dead code rather than a diagnostic.

### Still worth auditing

- The legacy-name wrappers in the table above — find each caller, then decide as a unit.

**CUSTOM FLAG LOOKUP was the last entry here and it is done.** The audit it asked for held: the
tab keyed on `mat_descr` and bucketed it, which is what `EXTRAS LOOKUP` does; both Extras tables
had already been moved onto `EXTRAS LOOKUP`; nothing displayed a flag anywhere in the suite. It
is gone from `APP_CONFIG`, from `buildLookups_`, from `loadStream_`'s rows, from the miss lists,
from the suggester's model and options, and from both add-rows forms. **Removing a lookup is not
the same as removing a diagnostic** — this one was reported to users as a fourth thing to keep in
step, and every row it "matched" was a row `EXTRAS LOOKUP` had to match as well.

### If you do audit the symbol table, use a scope-aware analyser

A naive column-0 grep reports **330** functions in `script.gs`; scope-aware says **154** are
genuinely top level, because the file does not indent IIFE bodies. Any analyser has to blank
comments, strings, template literals **and regex literals** — without the last case a `/[)]/`
or a `/'/` unbalances the brace counter and whole regions read as nested — and then assert its
brace, paren and bracket counters all return to zero. A counter that does not balance is
telling you it misread the file.

---

## 10. Working conventions

### Delivery

Work on `merging-files`, commit with a message that says *why*, and add a row to
[§11](#11-session-log) at the end of every session that changed anything.

### One change at a time

**If two changes land together and something breaks, you cannot tell which one broke it.**
That is why the 37-file merge carried no behaviour changes inside it, and why each of the
things that *were* wanted — client-side page switching, the fuel pages' device cache, the §B
reduction — landed afterwards as its own piece of work with its own gate. A new feature
wearing a port's clothes is the specific shape to watch for: if a merged page then paints a
stale figure, "the merge broke it" and "the new cache broke it" look identical.

The same rule is why a deliberate edit inside a moved region gets **declared** to the parity
harnesses rather than waved through — see Testing below.

### Logging

Both files have one logging helper, with the same signature and the same output shape:

```js
APP_log(level, where, msg, data)   // script.gs — 'debug' | 'info' | 'warn' | 'error'
AMR.log (level, where, msg, data)  // app.html  — same
```

One helper means one place to change the format and **one switch to turn the noise down** —
`APP_CONFIG.LOG_LEVEL` for the server, read fresh on every call so changing it takes effect on
the next execution with nothing to redeploy, and a `localStorage` key for the browser.

A line carries enough to answer "what was asked, what came back, how long, and did it come
from cache" without a second line: `where` (the function, not the file), the arguments that
*select* data (market, period, month — not whole payloads), the size of the answer, **elapsed
ms**, and the cache verdict.

- **Log at entry points and phase boundaries. Never inside a per-row loop.** The Ready-Mix
  bundle is 40,000 rows; a line per row would cost more than the work it describes and bury
  the line that matters.
- **Elapsed ms is the only field that catches a regression nobody reported.**
- **The cache field earns its place** because of §6's 14 MB bundle: a log line carrying elapsed
  ms and bytes-read would have shown a flat 15–24 s against a varying question on the first
  read of the transcript. Every cache read logs which of `hit` / `miss` / `skip` it was —
  `skip` included, because a silent bail is indistinguishable from a cache that is never warm.
- **Errors log the context, not just the message** — `where` plus the selecting arguments.

`tests/logging.js` enforces all of it: every silent `catch` is listed with its reason, so a new
one fails with "decide it"; the named entry points must log arrival, answer, failure and
elapsed ms; and no `APP_log` may sit inside a per-row loop.

### Code hygiene

- One global scope on the server; one `AMR` namespace on the client. Entry points are
  prefixed; everything else lives inside an IIFE.
- **When you delete code by anchored text, diff the symbol table, not just the syntax.** A cut
  that takes one function too many is still valid JavaScript. The first build of `script.gs`
  lost `RMX_whoWins` that way — the anchor matched *uniquely*, `node --check` passed, every
  structural check passed, and the only thing that noticed was a before/after set difference of
  top-level names.
- **A comment that says code is dead is not evidence.** `OVERVIEW` carried a banner starting
  `NOT USED` for four chunks while `getOverview` read its market list on every Overview load —
  the label came across in a verbatim merge, which is exactly how a wrong comment outlives the
  thing that made it wrong. Read the code, not the label.
- **A function with no caller in the repo can still be load-bearing.** Three kinds of caller
  live outside it: the time-driven trigger (§11), the editor's Run menu, and Apps Script itself
  calling `doGet`.

### Testing

**There is no test harness in this repo any more.** The 31 Node gates that lived in `tests/`
were removed on 2026-08-25, at the point where the QlikView sync was rewritten around one
export per execution and most of what `tests/qliksync.js` gated no longer existed. They are in
git history and `git checkout <commit> -- tests/` brings any of them back.

**So the checks are the ones in the code, and they are the ones to keep working:**

- `node --check` on a copy of `script.gs` at a `.js` path. `node` will not accept a `.gs`
  extension, so copy first.
- **`APP_verifyPermissions` (§4)** — run it in the editor after any change to the sync, the
  triggers or `appsscript.json`. Its `ScriptApp` row is the only report the project has of
  which of the five hand-set triggers are actually armed, and its Sheets REST row is the only
  thing that catches the Sheets API being switched off in the Cloud project.
- **`qlikStamps()`** — what each timer will compare on its next firing and what it will do.
- **`qlikRetryStatus()`** — whether a retry is waiting, and why.
- **The gate in `checkSource_`** is the real test of an export, and it runs on every sync
  rather than on demand. §5's "nothing is written until the export has been checked" is what
  it does and why each check is there.

**If you write a new harness, mutation-test it before trusting it.** Every gate that used to
be here was — and `pageparity.js` passed clean on its first run **for the wrong reason**: both
sides had died identically. A harness that has never failed has not been tested. And **do not
anchor one on a spelled-out line ending**; that broke `rmxcost.js` once and the failure read as
though the code had moved.

**Nothing outside the three project files is uploaded to Apps Script.** `.claspignore` is what
stops `clasp push` carrying anything else into the script project.

---

## 11. Session log

One row per session: what was done, and the finding worth keeping. The blow-by-blow of how
each was reached is in the commit that made it. **An unmarked row means the task is incomplete
or was forgotten.**

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
| 2026-08-19 | **Three documents became one.** `PLAN.md`'s durable half — the deletion proof rule and the keep-list, how ten pages live in one HTML file, the logging convention, the OAuth scope table, the harness rules — moved here; its 2,400 lines of merge narrative went with it, into the git history. `CLAUDE.md` is a pointer now rather than a second copy. **The cost that had to be paid first was the ~30 pointers in `script.gs`, `app.html` and `tests/` that named `PLAN.md` sections and chunk numbers**: leaving those dangling is precisely the trap this repo has been bitten by, so each was repointed, and the ones inside `gsparity`/`modparity` declared-edit text had to change on both sides at once or the parity gates fail | ✅ |
| 2026-08-19 | **The period is data too.** The Aggregates workbook was re-headed from `2026 Volume` to `CY Volume` while its export still names years, so the sync silently stopped writing those columns. One rule now: split a header into the figure and its period (`APP_period_`), pair on that, and take the current year off the **data** — the Year column or a Bill Month. Two defects fell out of it: `Fuel Surchage` vs `Fuel Surcharge`, one missing letter that left that single column never written while the tab looked healthy; and the sync's positional fallback, which is how PY revenue once went into the wrong column for a whole run | ✅ |
| 2026-08-19 | **The `~qliksync temp` sheet is contained, and its strays are swept.** A Drive copy made with no parent inherits the folder it lands in, so it was being born into the shared folder the export sits in. It is created in the script account's own Drive root now and has every non-owner permission stripped before it is read; nothing in the codebase creates a Drive permission, which is the only call that emails anybody. **The exports are `.xls` and cannot be anything else, so a copy is made on every sync** — which turns the one case `finally` cannot cover, Apps Script killing the execution at the runtime limit, from a one-off into a leak. `sweepTemps_` clears it, guarded on the prefix, the mime type and an hour's age | ✅ |
| 2026-08-19 | **`gsparity.js` and `modparity.js` deleted**, on the rule their own headers gave: a legitimate change landed inside a moved region of both files, so neither is a copy of anything and the gates could only be weakened, never passed. `script.gs` and `app.html` also lost every reference to `README.md`, `PLAN.md`, `tests/` and chunk numbers — they explain themselves and each other now, and nothing outside | ✅ |
| 2026-08-19 | **The Inventory Report publishes itself.** A second hourly trigger (`inventoryReportMailCheck`) watches the mailbox for the Qlik Sense report mail, files its PDF into the Drive folder and calls the same `IR.saveSource` the modal calls — so there is still exactly one setting. **The month is read off the subject, never off the calendar**: June's report is mailed in July as often as not, and stamping `new Date()` on it would mislabel it precisely when a late report made it matter. Old copies are superseded by rename, never overwritten or trashed. The grant is `gmail.readonly` because the "already published" list is a Script Property rather than a Gmail label | ✅ |
| 2026-08-19 | **The mail watch, second pass.** The folder keeps **one file per month** now — a re-issue replaces its predecessor rather than superseding it by rename, filed and pointed at before the old copy is trashed, and trashed rather than deleted. The heading and the filename are `MMM, YYYY` (`Inventory Report - Jul, 2026`), with a 2005–2100 floor so a four-digit figure in a subject cannot be read as a year. **The no-month fallback is the month BEFORE the send date**, year rolled back with it — a report is published after the period it covers, so a January mail with a bare subject means last December | ✅ |
| 2026-08-20 | **The Overview past twelve months: volume and revenue, and the columns that cannot be honest are gone rather than dashed.** ASP, PPI, every `vs last year` series, both growth bridges and the Ready-Mix ASP build-up drop out; the KPI strip becomes two cards, the second donut becomes revenue share and the price chart becomes a revenue chart, so every panel is full rather than blank. Revenue is now a first-class measure at every grain — market, submarket, plant type, product class, plant, material, customer, both lines — through one `measHead()` / `measCells()` pair. A **Market summary** table (market → submarkets, CY/PY volume, revenue, ASP and PPI) sits above Month by month on both tabs, cube-fed so it answers for all four Period settings. Two defects fell out of it: the Overview asked the cube for `sm1` where the field is `submarket1`, and **a `groupBy` the cube cannot resolve is not an error** — it returns one `\u0001all` bucket the page discards, so the submarket breakdown was missing from every window, a submarket cross-filter was silently ignored, and the ASP bridge's submarket mix item was a flat zero; and `headroom()` handed Chart.js raw bounds, which is how an axis came to read `9.1318562625202050%` | ✅ |
| 2026-08-20 | **An in-panel toggle was dropping the window.** Reported for *Split by segment*, and it was all five: *Product Class*, *Submarkets* on both tabs and *Project Segment* too. None of them is a new selection, but each called the **server** painter unconditionally and the server painter fetches `STATE.period` — so on a Prev-month or dragged span the panel came back holding the month-to-date under the window's own heading, a fifth of a second after the click, while every panel around it still showed the window. One rule now (`repaintPanel`), the same three-way answer `renderTab()` already gives. `ovperiod.js` check 8 presses all five; **its legacy side is retired** on this repo's own rule — the page was deliberately changed, and keeping the side would have meant skipping the new checks for it | ✅ |
| 2026-08-20 | **The Overview's two halves disagreed about which month "this month" is, and the fix is one anchor.** The server reports land on the reporting month — last calendar month — while the month cube also holds the running, part-billed month and the window anchored on *that*. So on an August visit the KPI strip read July's 2,266,577 t while the market table under it read August's 1,067,541 t for the same selection, every market at −50% or worse; and **"Prev month (MTD)", one back from the anchor, landed on the server's July, so the two Period buttons drew the same view.** `getOverview` echoes `reportMonth` off the data (`pvReportMonth_`, never the clock) and `anchorMonth()` uses it, clock rule as fallback; the part-billed month is still a drag away as the custom window it is. The KPI cards now name their month, so the workbook's MTD and YTD halves can no longer read as "unchanged" beside a Period that did move | ✅ |
| 2026-08-20 | **The opening screen stopped waiting for the whole history.** `AmrBoot`'s `month history` step was released only once every calendar-year block had streamed *and* every linked closed-year book had been read end to end — minutes of a modal over a page whose own pill says "Nothing else on the page is waiting on this". `histBootReady()` releases it when the cube can answer the month the page opens on; the rest arrives behind the pill | ✅ |
| 2026-08-20 | **CPI joins PPI: one formula, two keys.** They are the same weighted index — coverage-gated pairs, weight = CY revenue, factor = weight × the pair's own ASP move, Σfactor ÷ Σweight — differing only in what a *pair* is: PPI keys on plant × product, CPI on plant × **sold-to** × product (Qlik's Cust Price Detail calls that column "Customer", and it is Sold To). Written once per runtime: `piIndex_` on the server, `pool()` in `AmrCube`, `poolPairs()` in the Overview's local cross-filter path; `SOLD_TO` rides the cross dataset so both cross paths agree. **The column is drawn only where its source can answer it** — never as dashes, never filled with PPI, which would read as the two indices agreeing. `metrics_()` is left alone deliberately: it sums the pivot's precomputed weights at a finer key and those are the figures Price & Volume publishes | ✅ |
| 2026-08-20 | **CPI published +206.7%, and the cause was a credit row.** A reversal is its own raw row \u2014 revenue, no volume \u2014 so netted into a pair it moves the dollars without moving the tonnes: it does not reduce a price, it destroys one. Plant `3P36` / Brock Aggregates / `9141` billed 47.04 t for $693.98 in March 2025 and took a $693.84 credit in April, leaving **fourteen cents against 47 tonnes** and a price "move" of **+492,409%** that carried 95.6% of \u03a3factor by itself. CPI's ASP now comes off **priced** revenue \u2014 revenue on rows that carried volume \u2014 which is how this data can express Qlik's own prior-year test (`_rev_base + _Enviro_Fees + _Govt_Fees + _disc_comp`, no `_credit_debit`, no `_rebate`). PPI is deliberately NOT given the rule: at plant \u00d7 material grain the credit is diluted, and its published figures reconcile as they stand. Written once per runtime and applied in all three. **The residual is stated, not tuned away**: 3.06% / 2.76% against Qlik's 2.95% / 2.67%, with an exhaustive search over grain \u00d7 revenue basis \u00d7 weight \u00d7 threshold finding nothing within 0.03pp of both, and the same harness reproducing every market's volume and revenue to the dollar | ✅ |
| 2026-08-20 | **Every numeric axis rounds now.** Chart.js walks a scale by repeated addition and 14.8 + 0.2 is 15.000000000000002, so "ASP by month" printed sixteen digits of it; `headroom()` had fixed the bounds last session but not the ticks the chart makes out of them. `axFix()` takes its precision from the tick SPACING, so one helper serves dollars, tonnes and percentages, and every raw `'$'+v` callback is gone. Magnitude suffixes are deliberately not unified \u2014 volume axes read in thousands, money axes in millions, and both are what their readers expect | ✅ |
| 2026-08-20 | **PPI and CPI share one chart, and the green is gone.** Colour is the SERIES, not the sign: one index drawn green-for-up borrowed a semantic the rest of the page spends on growth, and green is not in the palette at all. PPI takes navy and CPI the light blue, exactly as this year / last year do on every other paired chart in the panel. **Past twelve months \u2014 or in the oldest year the history holds \u2014 every same-period-last-year series is dropped**, the index chart with them, and the note says which of the two reasons applies. `pyAbsent()` is the new half: the 2023 chip selected a window where vs-last-year was blank everywhere at once, which reads as a broken page rather than as an absent prior year. The chip stays \u2014 the cube answers volume and revenue there perfectly well; it is the columns that go | ✅ |
| 2026-08-20 | **CPI, calibrated against Qlik's own exports rather than reasoned at.** Five Cust Price Detail exports (2026 Jan\u2013Jul: all markets and each of GTA, SW, Manitoba, Saskatchewan) carry Qlik's per-pair Weight and Factor, and they settle two things the expressions alone did not. **The denominator is TotalWeight, not \u03a3Weight** \u2014 $136,727,744 against $123,520,166 on the all-markets export, a tenth apart, and summing covered CY revenue reproduces it to the dollar on all five. An outlier therefore keeps its weight and loses only its factor. **The threshold is 500%, not the \u00b150% the footnote states**: Qlik keeps pairs to |ASP%| 330% and zeroes from 647%, so anything in that gap reproduces its selection exactly (0.000pp on all five) while a 50% cap costs 1.26pp on SW alone. What remains \u2014 +0.02pp Manitoba, +0.03pp Saskatchewan, +0.28pp GTA, +0.33pp all markets, +0.59pp SW \u2014 is entirely `Weight` being a rebate-adjusted revenue the export nets away, ~0.82\u00d7 ex-Works on 2,788 of 3,117 kept rows with a per-row ratio, so no constant recovers it. The priced-revenue rule from earlier today is backed out: it was the right instinct about credits and the wrong mechanism, and PPI is bit-for-bit what it has always published | ✅ |
| 2026-08-20 | **"This month" is the newest month again, and the server is asked for it.** The anchor had been moved to the reporting month to stop the page reporting two months at once; that fixed the disagreement by moving the wrong half. `getOverview` takes a `month` now (in its cache key) and the Overview passes its anchor, so the server-fed and cube-fed halves answer for the same month while "This month" keeps meaning the latest month there is data for. The EBITDA workbook is the one thing that genuinely belongs to the closed month, and it is handled where it is read \u2014 `kpiMonth()` is the anchor minus one, and the cards name it | ✅ |
| 2026-08-21 | **The CPI exclusion was right and never arrived — a tunable that ships inside a cached payload.** The Overview published **+141.7%** for 2026 Jan–Aug against Qlik's 2.86%, and **+243.0%** for GTA against 2.48%, with `cpiOutlier: 5.0` sitting correctly in §1 the whole time. Replicating both August exports out of the raw sheet reproduces every published figure to the decimal **at threshold = 0** — MTD 2.79/2.31/3.52/1.61/6.36, YTD 141.72/242.97/14.36/2.85/5.95/6.22 — which names the fault exactly: §1 is read on the server, the **browser** does the pooling, so the number travels in the cube manifest and the cross-filter dataset, and every cache key in that chain is built from the DATA's generation. `cov.cpiOutlier || 0` then read the missing key as *no threshold at all*, and the browser's IndexedDB copy of that manifest is only wiped when the generation moves — so a warm device painted the pre-edit manifest indefinitely. **`ovcCovTok_` hashes the whole `COVERAGE` block into `ovcGen_`** (and into `getCrossData`'s key), so a floor edit is an invalidation; **a payload that cannot say what the exclusion is now reports NO CPI**, `null` not `0`, dropping the column exactly as a line with no Sold To does; and `revalidate()` writes the confirmed manifest back, which `adoptGen()` only ever did on a cold start. `tests/cpiindex.js` gates both halves off the real Brock Aggregates pair, mutation-tested both ways | ✅ |
| 2026-08-21 | **A stronger GATE for CPI, and the outlier cap retires.** A cap was always the wrong shape: it dropped a pair's factor and left its weight in the denominator — a dilution, where Qlik DELETES. `COVERAGE.cpi` is three floors now (`minVol` 1 t, `minRev` $1, `minAsp` $3.00/t) and a pair that fails leaves both sums. **The volume and revenue floors alone are a trap**: they take the Brock pair and look like a fix while SW Ontario still reads **14.36%**, because `3Q00` / JNF Ready Mix / `9055` sails through them — 378 t at $2.343/t last year against 24,593 t at $22.75/t this, +870.9%, carrying $559,436 of weight and +3.13pp of the index on its own. Nothing about it is small; only its PRICE gives it away, and $2.343/t is Ontario's rebate rate. So `minAsp` is the floor that matters, and it is the visible shadow of Qlik's net-revenue gate (rebate $2.248/t Ontario, $0.60 Manitoba, $0.90 Saskatchewan, nil on recycled). Calibrated on both August exports: Jan–Aug **141.719% → 6.248% (> 1 only) → 3.106%** against Qlik's 2.864%; Aug MTD **2.789% → 2.724%** against 2.646%. Costs three pairs Qlik keeps, worth $1,894 of $155.5M. Any floor from $2.50 to ~$3.90 gives the same answer; $4.00 starts eating bank sand at $3.97/t. `tests/cpiindex.js` carries BOTH bad pairs deliberately — one that the revenue floor catches and one that only the price floor does, so a half-fix cannot pass | ✅ |
| 2026-08-21 | **The 500% threshold is a guard, not Qlik's rule — and the last session's evidence for it was an accident of the window.** Qlik zeroes **10 of 3,407** covered pairs in 2026 Jan–Aug; five move by less than 100% and two by less than 5% (**+4.55%**, **+0.26%**), while it *keeps* pairs at −115.9%, +225.4% and, on the Aug MTD export, **+472.8%**. No |ASP%| threshold selects that set; the "330–647% gap" only looked like one because Jan–Jul held no counter-example. **What actually selects it: `Weight` is CY revenue net of the per-tonne aggregate levy, and Qlik's coverage runs on the net figure.** `(CY revenue − Weight) ÷ CY volume` lands on **$2.248/t Ontario, $0.60/t Manitoba, $0.90/t Saskatchewan, nil on recycled** across 3,397 pairs and both exports — 9 of the 10 zeroed pairs have a net-of-levy ASP at or below ten cents in one year. That column does not exist here, so the guard stays, and it costs **0.0001pp** against Qlik's own selection (3.0933% vs 3.0934%) and drops no pair Qlik keeps. **The denominator was never the problem**: Σ covered CY revenue reproduces `TotalWeight` to the penny on both exports ($155,497,057.14 and $13,041,331.22). The residual after the fix is **+0.23pp** all-markets — Qlik weighting the numerator net and dividing by gross, ~0.905× with a per-row ratio. Manitoba +0.01pp, Saskatchewan +0.04pp, North 0.00pp, because their levy is small or nil. Do not spend another session tuning the threshold | ✅ |
| 2026-08-21 | **Four field reports, and three of them were one bug wearing different clothes: a module that outlives the page that used it.** (1) **The AGG page loaded for ever until you refreshed.** `AmrCube` is a §E singleton and §D mounts ten pages into one document, so the second visit's `AmrCube.on()` listener met a cube whose `init()` had already run — it returned `Promise.resolve(false)` and emitted nothing, `AmrBoot`'s `month history` step was never answered, and `AmrProgress` is modal. A second `init()` is a **page switch**: `on()` replays the settled event to a late listener and returns an unsubscribe, `teardown()` calls `AmrCube.detach()`, and a line the first boot never fetched (PV configures `agg` alone; the Overview then wants `rmx`) is fetched now. `pageswitch.js` could not have caught it — its fixture answers `CUBE_getManifest` with `ok:false` and the **error** path does emit. (2) **Product Segment never once read its own device store.** `AmrCache.get()` is gated on `ready`, and the only thing that set `ready` was the reply to `RMX_prepare` — the call the store existed to avoid — so the store was **write-only for the life of the page** and every open paid the most expensive call in the suite to be handed back what was already there. `AmrCache.warm()` opens on the generation the device itself confirmed and `RMX_getStamp()` checks it behind the paint: `{generation, build}`, the same two fields under the same names as `prepareAll`'s `stamp()`, no sheet read. Not `getDataVersion('rmx')` — different pair, different shape, and §6 has the account of what two copies of one token cost. A warm open now costs one small call, and market and period switches cost **none**. (3) **Both fuel pages paint before the version call answers** rather than after it — same `warm()`, with `check()` returning whether the store survived and only a warm paint re-read. The version call is still issued FIRST, because `set()` will not write under a generation it does not know yet and sending the read first stored nothing at all. Measured at 800ms of stubbed latency: 1868ms → 905ms cold, **942ms → 31ms warm**. `ready` is per page now; it was one boolean across ten pages. (4) **The Ready-Mix UI at ≥1720px**: §A3 pins the QlikView guide open and hides the FAB that closes it, and the rule that carves the 288px names `.shell` — Ready-Mix lays out with `.wrap`, so the guide sat on top of the last 250px of every table, the ✓ matched pills and every per-card help button. One media query; also un-nested the Export theme `.field` that was a child of the N/A one. **`reopen.js` is the new gate and it asserts the thing a call count cannot see**: replies are held for a fixed latency and outstanding calls counted by name, so “a table is on screen while the version call has not come back” is an assertion. `APP_CODE_BUILD` bumped — the client now paints device entries before validating them, and one cold load per device buys the guarantee that every warm paint after this deploy came from a store this code wrote | ✅ |
| 2026-08-21 | **The Ready-Mix mapping warning shipped unstyled, and four more of chunk 6's drops were sitting beside it.** Reported as the sentence under a table name; what it was is seven CSS rules — `.impact`, `.impact-i`, `.impact-t`, `.impact-go` — left behind when `Page_Rmx.html` was ported. The page kept emitting the markup, so the `!` badge ran straight into the sentence as **"!339 products"** and "Fix mapping" was a browser-grey UA button inside the text. **Three things had to be true at once for no gate to see it, and they were:** `setStrip()` builds the strip in JS, so no markup check ever meets the class; **no fixture in `tests/` answers `RMX_getUnmapped` with a row**, so the strip renders in no harness run; and `cssparity` derives its property list *from* the §A4 block, so a missing block's properties are not on the list. Four more came out of the same audit. **`#mapHost td.mkt` went too**, so the page's own `td{text-align:right; white-space:nowrap}` took the Market(s) column — right-aligned, and a list of markets that will not wrap. **Two classes were renamed by the promotion and only one caller was told**: §A3 took Price & Volume's `mchev` and `map-open`, Ready-Mix went on emitting `chev` and `sug-open`, so its mapping-check arrow fell through to the generic 10px `.chev` and **never rotated** — an open section looked exactly like a shut one — and the page behind the suggested-rows dialog kept scrolling. A promoted rule is only shared if every caller uses the promoted NAME. **And the strip was disappearing on every re-render**: `if(window.paintImpact) paintImpact()` was a page function asking whether it existed, which on `Page_Rmx.html`'s file scope was always yes and inside a page module is always no. Measured: 3 strips to 0 on one period click, and no way back but a reload. `tests/cssdropped.js` is the new gate — for every class the 20 deleted files styled, if `app.html` still emits it and has no rule, the port dropped it. 717 classes, **no allow-list**, mutation-tested by putting the block back in the bin. `cssparity`'s EXPAND gained `border-color` because the restored `.impact-go:hover` declares it, and its run is 50 properties to 52 | ✅ |
| 2026-08-23 | **The sync was deleting columns it does not own, and the header now says how old the figures are.** Reported as "pulling RMX from Qlik deletes my array formulas on Main and Extras, and the Aggregates sheets keep theirs" — and the two workbooks go through **the same writer**, so the difference was never in the code, it was in how far the code got. `writeColumns_` cleared the WHOLE formula band before writing and put it back only after the LAST tab of the workbook, so the anchors were absent for the entire pass: one throw, or one execution killed at the runtime limit, and they were gone with nothing left to restore — and nothing for the next run to find either, which is why they never came back on their own. **Three tens-of-thousands-of-rows Ready-Mix tabs reach that limit far sooner than two Aggregates ones**, and that is the whole of the difference. Only a formula in a column the export FEEDS is cleared now — by construction the anchors are elsewhere, since `firstDataRow_` finds that row by looking for a formula in a column nothing is written into — and the band is registered for restore BEFORE anything destructive runs. **Rows point the other way and stay as they were**: the data ends exactly where the export ends, surplus deleted, because nothing on these tabs is filled down — every formula is a single-cell array formula on the first data row — and leaving them would have January reading a December-sized sheet for eleven months. `tests/qliksync.js` carries a column the sync has never heard of and makes a write blow up to prove the anchors are still on the sheet afterwards; the whole-band clear and a full-width block clear were both put back to watch it fail. **And the header answers the other question.** ↻ Update from source says whether anything is NEWER; it has never said how old what you are looking at IS. `AmrStamp` (§E) is its own control beside it, injected into every header that has one the way the page switcher is, showing **two clocks that must never be collapsed into one**: when the workbook last changed, and when QlikSync last wrote it (plus the date on the export it read). The second is recorded by the run, because **Drive cannot tell a sync from a hand edit** — a row typed into REGION LOOKUP moves the modified time exactly as a sync does. `freshness.js` gates precisely that: a hand edit moves the sheet clock and leaves the QlikView clock where it was. The bar had **seven pixels** of slack on Price & Volume at 1720, so the stamp gives up its date for its age below `--bp-wide` and its frame with it; four pages lose one breakpoint step and three lose nothing, measured and written into §A3. **And the Slide Builder is Product Segment now** — one line away from "Deck Builder" it read as a second deck tool, and it is not one. Renamed in prose across `script.gs`, `app.html` and both READMEs; the workbook's own TAB names (`Slide Segment MTD`, `Slide Product <Market> MTD`) and the `SB` namespace keep the old spelling on purpose, the first because the sync matches tabs by name and the second because it is a rename across every call site for no reader's benefit — both now say so where they live. One stale comment fell out of it: the SEG folder's SPEC block was headed "RMX folder" | ✅ |
| 2026-08-23 | **The Arrange stage — slide order, per-slide tables and the KPI strip are editable from the page, and `DECK_RECIPE` is still meaningful.** Two shared Script Properties on the `PROP_LAYOUTS` pattern: `DECK_PLAN` carries order, membership and per-row edits, `DECK_TABLE_MAP` carries what each scope shows. **A scope ladder answers “change every market at once, or just this one” with no flag** — `row:<id>` → `pv|Southwest|Docks` → `pv|Southwest` → `pv`, first answer wins, tables and KPI resolved independently. `period` is in no key above the first, so a change to a market reaches its MTD and YTD slides together; rung 2 is Southwest's alone, because Land and Docks are two values of its `MB SUBMARKET` column and no other market divides below market level. **The recipe stays the default on two rules**: nothing stored is byte-identical to it (an arrangement equal to the recipe is *deleted*, or the first button press would freeze all 43 rows), and a row added to the array later is inserted beside its predecessor rather than appended. Deleting and unticking are kept apart, with a Deleted slides list and Restore, and so are their two stale-key cases — otherwise every deletion banners something nobody can clear. **The finding worth keeping is the retried-slide ordering defect, invisible until order became editable**: `addSlide` always appends and Publish skips a row already `done`, so a slide that failed at position 30 and was retried published at 44 — and `finish` stamped `{{PAGE}}` against that order confidently. Three more came out of reading the same path. `getReport` **ignores the order of the `dimensions` array it is sent**, walking `CONFIG.DIMENSIONS` instead and appending the customer-segment pivot last, so AGG table order has to be imposed client-side — into a *shallow copy*, because one payload is shared by the MTD row, its YTD twin and the unrefined report Land/Docks resolves against. The QlikView ASP card read `d.tables[0].total`, so an empty or total-less first table baked “Load market data to fill this card” into a published picture — same shape as the Southwest Land page of zeroes. And the **KPI Region was per-device while everything else here is shared**, so a colleague building from your arrangement could get different numbers with nothing saying so; the shared value is on top now and the per-row dropdown greys out and says where it comes from rather than moving and changing nothing. Six commits, each with its own gate. `tests/deckarrange.js` is new and drives the page against the **real** §9 functions rather than stubs — 103 checks, including a real render, and it found two things static checks cannot see: **an element `id` is a `window` property**, so a function sharing a name with one is indistinguishable from a leak (functions are verbs now, ids are nouns), and saving a scope redrew only the right-hand panel, leaving the other slides it reaches naming the rung they were on before. Two fixture faults fell out of it too, both of which had made a check *impossible* rather than wrong: `deckpath`'s `getReport` stub ignored the request, so it could not reproduce the ordering defect at all, and its `AmrKpi.rmx` stub answered with the AGG card's fields — the Product Segment KPI strip had never once rendered under that harness | ✅ |
| 2026-08-24 | **The Arrange panel opened on the widest rung and asked the Region everywhere.** Three things, all in the right-hand panel and all about the same thing — *how much does this button move*. (1) **The default rung is the market's now**, not the source's. A table selection or a KPI region is nearly always "this market, both periods"; opening on `pv` meant the safe change was the one you had to go looking for and the one that moves all fourteen Price & Volume slides was the one you got by not looking. `arrDefaultScope()` is one helper used by **both** the drawer and `arrScopeKey()`, because a panel that draws one rung and saves against another is worse than either. A row with no market — Fuel Recovery, ladder `row:fsc_mtd` then `fsc` — falls back to the broadest rung it has, which for a source with one slide per period *is* the market. (2) **The Region dropdown is a question about a market, so it is only put on the market's rung.** A sheet name out of Central Canada's EBITDA workbook means nothing on `pv` — it would be handed to every other market's slides as well — and on `row:` it settles one slide while its MTD/YTD twin still asks the device. Both were reachable and both read as a choice the panel had offered. The strip's **on/off is deliberately not gated with it**: that question is meaningful at every rung. (3) **The "answering:" badge comes off the rung buttons and its CSS with it** — the `.db-ar-scope` line under each slide title already says where that row's tables and KPI come from, and two answers to one question in one panel is one too many — **as does the paragraph under the Region select**, which explained the per-device fallback at length in a panel whose every other control says what it does in its own label. `tests/deckarrange.js` is 103 checks to **113**: the badge check is replaced by its opposite, and the Region gate is asserted at all three rungs — the fixture has no workbook uploaded, so what the market rung shows is the "nothing to choose from yet" note rather than the dropdown, which is exactly the claim, that the question is *put* there and not at the other two | ✅ |
| 2026-08-24 | **The transfer-price exceptions report sends itself, and the page stopped doing its own arithmetic.** Set one **day timer** on `tp01ReportMailCheck`, from the account that deployed the app — the third trigger in the suite and the first daily one. The SAP TP01/ZIPR file arrives by mail weekly; **the QlikView export it was compared against turned out not to be a separate report at all**, but a filtered, rolled-up view of the Aggregates data this app already reads — `Customer Parent = Amrize RMX`, current year, rolled from the raw tab's grain back to the export's with the ASP recomputed as revenue ÷ volume — so `TPE.qlikFromSheet` builds it out of `PV.rawEnriched()` and opens nothing new. The page keeps its QlikView drop zone as an **override**: two inputs, one pipeline. **The calculations moved to the server, and that is the change the rest depends on.** A trigger has no browser, so the alternative was two copies of one set of rules with nothing at run time reporting they had drifted; `TPE` (§10) owns every number and the email body, the browser keeps parsing dropped workbooks and writing the files its own buttons produce, and `TPXLSX` writes the trigger's `.xlsx` **by hand** — an `.xlsx` is a zip of XML and `Utilities.zip` makes zips. The rejected alternative is in its banner: a temp Google Sheet exported through Drive, which costs a file created, exported and trashed per run against a six-minute ceiling this repo has been killed by, cannot produce an Excel table, and could not have been tested off-platform at all. **Four things the real workbook settled that were going to be guessed wrong.** Customer Parent is `Amrize RMX` and that column also holds `Metrix RMX`, so the filter is exact equality and never a `contains`. `Sold To` puts its code **last** (`BURLINGTON READY MIX - P4Q01`) while `Plant` and `Material` put theirs first — two extractors, not one — and **both sides drop a one-character prefix** from the ship-to / sold-to, `6` on SAP's and `P` on the sheet's, leaving the four characters that make `64Q01` and `P4Q01` the same `4Q01`. And **a raw row carries ONE year**: a 2025 row parks its figures in the PY columns and zeros the CY ones, so "this year only" is the Year column **and** the CY columns, never either alone — now §7. Settings are a **Script** Property, not a user one, because `getUserProperties()` resolves to the deployer on a web request and to the **trigger creator** inside a trigger, and a recipient typed on the website would otherwise be invisible to the run that needed it. Only the **newest** unseen mail is reported on — three unseen mails are three versions of one snapshot, and this is where it and `IRMAIL` deliberately part company. A failed run marks nothing done; a new file with no recipients is an error and also marks nothing. `tp01ReportMailStatus()` answers what the code cannot — whether the subject still matches, whether the sheet still spells the parent that way (**printing the spellings that are in the column when it does not**), and the match rate with ten keys from each side when it is zero. New: `tests/tp01engine.js` (13 rules, one case each) and `tests/tp01xlsx.js`, which zips the parts and reads them back through a reader written against OOXML rather than against the writer. **`pageparity.js`'s `tp01` case retired rather than being weakened**, on `tests/README.md`'s own rule: three deliberate copy corrections were what failed, each revertible to make it pass, which is the shape of softening a gate. What went with it: nothing now proves the eleven ex-inline handlers are still wired. `logging.js` caught two empty catches in the new watch on the way past, which is what it is for | ✅ |
| 2026-08-24 | **The permission check can now see the triggers, and two scratch files left the repo.** Nothing in the project could say whether the three §11 timers exist — there is not one `ScriptApp.newTrigger` in the codebase, so a timer that was never added or was deleted leaves **no trace, no error and no log line, because nothing runs**, and for the TP01 report that reads as an email nobody misses. `APP_verifyPermissions()`'s `ScriptApp` row names all three targets and says which are armed; `tp01ReportMailStatus()` and the page's *Preview* answer the same question for their own timer, beside what is left of the send quota, and both come **before** the config bail, because a half-built config is when it is worth knowing the plumbing is there. `getProjectTriggers()` **sees only the caller's own triggers** — the platform's rule, and the same rule as §1's, so "NOT SET" only means what it says when run from the deploying account; it is reported as a configuration fact and does **not** fail the row, which is reserved for a missing grant. **`Utilities` and `HtmlService` were named in the "(none needed)" paragraph and absent from the `CHECKS` array**, which is the drift that paragraph exists to prevent, and neither is a formality: `Utilities.zip` writes the `.xlsx` the weekly report attaches, so if it stopped producing a readable archive the mail would keep going out and the **attachment** would be the broken thing, and `createTemplateFromFile('app')` is the call that stops being unambiguous the moment `script.gs` is renamed back to `app.gs`. `appsscript.json` needed **no change** — all eight scopes were already traced to a real call, and adding one for safety's sake buys a wider consent screen and nothing else — but the `script.scriptapp` row is no longer hedged, since `getProjectTriggers()` genuinely requires it. `tp01.js` and `script.gs.syms` deleted: the first a byte-identical copy of `app.html`'s `tp01` page with `var _x = ` prefixed so `node --check` would take it, the second a symbol dump; both were scratch committed by accident, neither referenced anywhere, and **neither was ever part of the three-file project** — `.claspignore` had kept them out of the editor, so git was the only place they were wrong. All 30 harnesses pass, `threefiles.js` among them | ✅ |
| | **`APP_verifyPermissions()` has never been run.** Needs somebody in the Apps Script editor; nothing off-platform can exercise `SpreadsheetApp`, `DriveApp`, `SlidesApp` or `MailApp` | ☐ |
| | **No real deck has been built against the live deployment.** Every adapter is registered and the path is exercised offline, but `DECK_create` / `addSlide` / `finish` have never run. `DECK_status` is kept until that build says whether Publish needs it | ☐ |
| | **One look at the Price & Volume sheet:** whether it carries any parenthesised negatives decides only whether anyone notices chunk 20 — a no-op if it has none, correctly counted figures if it has some | ☐ |
| 2026-08-24 | **Nothing is written until the export has been checked, and the header's stamp stops asking a question it cannot answer.** Four field reports. **(1) The sync landed a bad export silently** — three columns (`CY Rev exWorks`, `PY Rev exWorks`, `Fuel Surcharge`) left out of a QlikView export, every other column paired and wrote, and the tab's totals read `0.00` with no failed tab, no error and no log line. Rows made it worse: the sheet ends where the export ends, so a short read does not leave the surplus, it **deletes** it. There is a gate now and **its position is the point** — it runs before the band comes out, before the resize, before a cell is cleared, so a refused tab is left *exactly* as it was. Three of its four checks need a baseline, so every successful write records the tab's shape (`QLIK_TAB_SHAPE`): rows carried, and values filled per paired column. "This column is empty" is only a fault against a column that was full. Two false positives were designed out and both are gated: the shape is keyed on the **canonical** column name, so fixing the "Fuel Surchage" typo in an export does not read as one column vanishing and another appearing; and a **collapse is allowed when the export's newest period has moved on**, because a January file really is a twelfth of a December one and refusing it would stop the pipeline every year — the period comes from `Bill Month` on Ready-Mix and from the **Year column** on Aggregates, which carries no `Bill Month` at all. **A refused run never becomes that baseline** — recording it would move the standard down to the broken export and the same export sent again would pass, so the gate would report a fault once and adopt it; `tests/qliksync.js` gates that specifically and it is the case a "does the gate fire" check cannot see. **(2) A 49,000-row export stopping at row 1,113.** The likeliest cause is upstream of the write entirely: `files/copy` returns as soon as the file **record** exists, and a large `.xls` is still converting after that — the sheet is readable while it fills, so `getDataRange()` answers short, truthfully, with no error, and the sync then deletes the rest of the tab to match. `settle_` polls every tab's last row until two reads agree before anything is read — with a `SpreadsheetApp.flush()` before each look, without which the whole function is a no-op, since the Spreadsheet service caches within an execution and two identical answers would mean only that nothing re-read — and it **deliberately does not throw when it gives up**, because the gate is what makes a short read harmless. Two further changes on the same symptom: a **read-back of each block's last row** now reports a short write instead of leaving it silent — and it is flagged **retryable**, which is the half that matters, since without it the truncated tab keeps the export's stamp and is never looked at again; and the shrink check stands between a truncated read and `deleteRows`. **One change was tried and reverted, and the harness is why**: dropping the redundant-looking `clearContent` before the write. On a run that completes it clears nothing the write does not overwrite. On a run that is KILLED it is the difference between a blank tail — wrong, obvious, detectable — and a tail still holding last month's figures under this month's heading. The staged short-write case reported success without it. It is worth one API call per block to keep the failure undisguised. **(3) Nobody is watching a trigger**, so a failed run mails the source, the tab, the reason, that **the sheet is unchanged rather than half-written**, and what happens next — and arms **one** retry five minutes out (`qlikSyncRetry`, the codebase's only `ScriptApp.newTrigger`, which deletes itself when it fires). A gate failure also withholds the export's stamp in both `qlikSyncCheck` and `qlikSyncNow`, which would otherwise mark a file as read that the run refused to read. Two bugs the harness found in that machinery: `runRetries_` held a copy of the retry log across `run()`, which writes the same property, so a second failure's "give up" decision was undone; and a clean run did not clear a pending retry, so the one-shot fired against a source already fixed and left `tries` at 1, telling the next genuine failure it had already had its retry. **(4) The Overview's age stamp** dropped the QlikView clock and the four closed-year history books. The QlikView clock is a fact about ONE workbook; the Overview reads three, and the history books are not synced at all, so the panel stacked three sync times under three sheet times and four sections whose only content was "not known". Not the two clocks collapsed into one — that rule forbids *deriving* the QlikView time from Drive; what is left is labelled "last updated from the Google Sheet". **(5) The opening screen belonged to the whole tab rather than to a page.** `AmrBoot` is a §E singleton and nothing reset it, so a completed boot left `over` set and every page after the first loaded behind no screen at all, and a page switched away from mid-boot left steps nothing would ever report — a modal screen over a finished page until the 150s watchdog. `AmrBoot.reset()` joins teardown's list, before `AmrProgress.reset()`. The other half is not fixable here: Apps Script runs a user's calls end to end, so a tab reloaded mid-load leaves its call running and the reload is queued behind it; at 12s the screen now says so, and says reloading again only lengthens the queue. New gates: `boot-refcount` and `slow-open` in `pageswitch.js`, thirteen cases in `qliksync.js` — the destructive ones assert the tab is **byte-identical** afterwards, and all are mutation-tested — and the Overview cases in `freshness.js` rewritten to the new contract. `APP_CODE_BUILD` → `2026-08-24a` | ✅ |
| | **The sync gate has never run against a real export.** `QLIK_TAB_SHAPE` is empty until the first successful sync after this deploy, and **every check passes by default with no baseline** — so the first run records and the second is the first one actually guarded. Watch that a normal month-on-month change does not trip the shrink check | ☐ |
| | **`QLIK_ALERT_TO` is unset**, so the failure mail goes to whoever created the trigger. Set the Script Property if it should go to somebody else | ☐ |
| 2026-08-24 | **The row the sync stopped at was never about the export, the tab, or how full either of them was — it was one cached read.** Reported again after the gate shipped: the Aggregates tabs stop at **row 1,114** of a 47,634-row export, the same row whether the tab was full or had just been emptied by hand, while Ready-Mix comes through whole; and the `~qliksync temp` copy appears in Drive and is gone again seconds later. All three are one fact. **`settle_` polled the converting copy through `SpreadsheetApp`**, and the Spreadsheet service snapshots a spreadsheet on an execution's FIRST look at it and answers everything later in that execution from the snapshot — so the second poll agreed with the first *because it was the first*, the wait returned after one 1.5 s sleep, and `getDataRange()` then read the same frozen half-converted grid. The `SpreadsheetApp.flush()` in front of each look, which the last session called load-bearing, is not: it pushes **this execution's pending writes** out and says nothing about a file **Drive's converter** is filling behind the script's back. Same row every time because it is however much had landed when the snapshot was taken; independent of the tab because it never read the tab; one export whole and another not because a copy that finishes converting inside the first look has nothing left to land. **Not size** — that was guessed and it was wrong: Ready-Mix is the bigger read at 44k/23k/14k rows against Aggregates' 47k/4k. The likeliest difference is `.xlsx` against `.xls`, which Drive does not convert the same way, and it is not load-bearing either way: it decides only whether the copy is still filling at the moment of the first look, and the wait removes that moment. **The poll is HTTP now** — `spreadsheets.get` for `gridProperties.rowCount` **and Drive's `version` beside it**, on the same OAuth token the Drive calls use, so every look is a fresh answer, and **nothing opens the copy with `SpreadsheetApp` until the poll has settled**, which is the whole fix: the snapshot is then taken of a finished file. Both numbers, because `rowCount` is an *allocated* height and would be final from the first look if Drive sizes the grid up front and fills cells into it, while `version` moves for as long as anything is being written in. Two agreeing looks was never enough either (a conversion pauses between tabs), so it wants **two consecutive** agreements, 2 s apart, under a 90 s ceiling; a poll that cannot run at all waits blind for 15 s and says so at `warn`. **And the gate gets a check that needs no history** — `check 0`, the read's height against the height the server reports for that tab, under half above a 500-row floor. It is the only one of the five that can see this failure: the 1,113 rows that landed are perfectly well formed and defeat every check that compares against the last good export. It also closes the hole underneath them — with no baseline the first truncated read passes, writes, and **records its own 1,113 rows as the standard** the next run is judged against, which is why emptying the tab by hand and re-syncing did not clear it. `APP_verifyPermissions` gains a **Sheets REST** row, and it earned itself on the first run: **HTTP 403, "Google Sheets API has not been used in project … or it is disabled"**. That is not OAuth and no consent screen will appear for it — the scope is granted and `SpreadsheetApp` has always worked; what is off is the **API itself in the Cloud project behind the script**, which for a default Apps Script project has Drive on and Sheets off. So the poll is now built the other way up: **Drive's `version` is the half that always works** and is asked first and unconditionally, Sheets `rowCount` is asked on top of it, and one 403 turns the Sheets half off for the rest of the execution with a `warn` naming the fix rather than forty-five more refusals. Without it the sync still works — the wait still waits, which is what the truncation was about — and **check 0 is skipped rather than guessed at**. Turn it on in Apps Script ▸ Services ▸ Google Sheets API, or from the console link in the 403 itself. **`tests/qliksync.js` is red and left that way on purpose**: its two `settle_` cases drive the copy's growth through a fake `SpreadsheetApp` that re-reads honestly, which is the one thing the real service does not do — they assert the mechanism that was removed, and rewriting them means modelling the per-execution snapshot in the harness. Next session's first job | ☐ |
| 2026-08-24 | **The wait was right in kind and wrong in what it watched, and the fix is one line of manifest plus a probe that measures rows.** Reported after the HTTP poll shipped: the Aggregates tab moved from **1,113 rows to 2,224** — twice the wait, twice the rows, the same file — which is the measurement that ends the guessing. It is a **slow fill at roughly 350 rows a second**, so a 47,634-row export is over **two minutes** of converting; nothing is intermittent, and the row it stops at is the same every run because the wait was the same length every run. **Both format guesses were wrong**: every export is `.xlsx` (the Drive names end `.xls`), and size was wrong before that. Three signals were tried and only the third moves while Drive fills: `SpreadsheetApp.getLastRow()` answers the second look from the first look's snapshot; **Drive's `version` is not bumped by the converter's own writing**, so a wait built on it agrees with itself from the first look and returns after six seconds — that is why the count doubled instead of arriving; `gridProperties.rowCount` is the *allocated* height. What moves is **how many rows hold something**, so the poll walks `values.get` over `A:E` in 20,000-row windows starting at the frontier the last look found — one small call per tab per look, the whole wait reading the probe columns once — with `rowCount` kept only to bound the range, since a `values.get` past the end of a sheet answers **400**, not fewer rows. The **tab list is re-asked every look**: Drive adds tabs one at a time too. Two consecutive agreements, 2 s backing off to 10 s, a 4-minute ceiling inside a five-minute slice of the execution, **floored at 60 s and the floor wins** — being killed during the wait costs a stranded copy the sweep clears, giving up on the wait costs a truncated tab. Blind wait raised 15 s → **45 s**, and a blind wait is served its full length rather than finishing early on `version`. **And the 403 was never an OAuth failure**: `appsscript.json` now carries the Sheets API as an advanced service (`dependencies.enabledAdvancedServices`), which is what switches that API on in the Cloud project — a default Apps Script project has Drive on and Sheets off. **Nothing in the code calls the `Sheets` symbol**, so it reads as unused and is in §9's do-not-delete list with the failure it causes spelled out. It had been added by hand in the live project and was not in the repo; that is why the same 403 came back on the next push. `tests/qliksync.js`'s two `settle_` cases are **still red and still deliberate** — they assert a mechanism now removed twice over, and rewriting them means modelling both the per-execution snapshot and a windowed HTTP probe. Not run this session: the change was pushed for a field test on the real exports, which is the only place a two-minute conversion exists | ☐ |
| 2026-08-24 | **The conversion was never the slow part — `SpreadsheetApp`'s view of the converted file is.** The REST poll shipped and worked: it reports the Aggregates copy holding **47,845 and 4,693 rows, settled by its second look, about four seconds in**, and Ready-Mix at 44,247 / 23,795 / 14,158. So the file is finished almost immediately, and the earlier 1,113 → 2,224 doubling was **`SpreadsheetApp` catching up**, not rows landing — which is why waiting longer helped a little and would never have been enough. So the read has a second half: `readExport_` logs the read height against the poll's height at `info` for **every tab of every run**, and a read short by more than ten rows is **taken again over the same `values.get` calls the poll is made of**, `UNFORMATTED_VALUE` so dates arrive as the Excel serial `monthText_` and `monthYM_` already handle. A tab `SpreadsheetApp` omits entirely is fetched the same way instead of being written off. **The same run then died on the destination workbook** — `SpreadsheetApp` calling the Price & Volume sheet "missing (perhaps it was deleted, or you don't have read access?)" two minutes after opening it, on a file its owner owns. Reading whole is what exposed it: `run()` held **three whole exports at once** (~130k rows) where truncated reads had cost nothing, so an export is now read when the page that needs it is about to be written and dropped when the last page that needs it is done — peak one export, not three. The page stays the unit of the write (the formula re-point needs every tab's final height). A failed read now fails **one page**, not the run; `openWorkbook_` retries three times, three seconds apart; and past five minutes the remaining pages are refused **as retryable** rather than killed mid-write, which would leave a blank tail, no failure to report, and a stamped export nobody looks at again. Not run this session, at the field test's request | ☐ |
| 2026-08-24 | **The write, not the read — and it was the formula band, put back the wrong way on 08-23.** A screenshot settled it: the tab is at **full height with the sync's columns cleared to the bottom**, ~1,113 rows written, and **one half-written row at the boundary** (`A` and `B` filled, everything right of them blank). So the read is whole now and the resize ran; what does not finish is the WRITE, and a half-written row is a flush that was cut off rather than an exception. The cause is the change made on 08-23: leaving the formula band on the tab during the write, on the reasoning that clearing it "bought nothing". What it bought is the **recalculation** — the LOOKUP KEY array formula reads `B3:B47634`, so every `setValues` into a mapped column re-evaluates ~140,000 string operations plus six full-column sums before the next block can go in, dozens of times over. The run dies partway with `SpreadsheetApp` calling the workbook **"missing"** at ~3½ minutes, nowhere near the six-minute limit — the generic shape of the Sheets backend refusing a request that took too long. **So the band comes out whole again, and both halves are kept**: it goes back the moment *that tab* is written rather than after the last tab of the workbook, and it is **parked in a script property first**, so a killed execution cannot lose it — `unpark_` restores it before anything reads that tab's formulas again. A band too big to park is not taken out at all and the write is merely slow. Two guards beside it: the chunk loop **stops itself past five minutes with a retryable throw**, because being killed mid-flush is the same tab in the same state minus the failure record, the mail and the armed retry; and the workbook pass still re-points the whole band at the end, since a sibling-tab reference cannot be resolved until every height is final | ☐ |
| 2026-08-24 | **Aggregates is right, and what is left is arithmetic.** The band coming out fixed the write: `read=47845 holds=47845`, 52,538 rows written in ~80 s, tab whole. Ready-Mix then stopped 10,000 rows into a 23,794-row tab and Product Segment was never started — both reported cleanly by the guards rather than being killed mid-flush, which is the guards doing their job. The measurement it produced is the point: **~135,000 rows and three conversions is about seven minutes of work inside a six-minute limit.** No tuning closes a gap that shape, so the job is spread across executions and **the retry is the mechanism** — which needed three fixes to converge rather than circle. Failures now **name their page**, so a retry is armed for the pages that failed instead of for the scope that was asked for (a retry of `'all'` re-wrote the 52,000 Aggregates rows that had already landed before reaching the work that had not, then ran out in the same place). `qlikSyncNow` **stamps per page**: it used to withhold every stamp when any tab anywhere was gated, on the reasoning that a `{ tab, error }` record does not say which source its tab came from — it does now. And **the clock gets a higher ceiling than a broken export**: one retry is right for a file that failed its checks, because a second failure means the export is wrong, while running out of time means nothing is wrong at all and each attempt is strictly smaller than the last. `QLIK_RETRY_MAX_BUDGET` is 5, **per page**, and a page carrying one genuine check failure among its clock failures is a one-retry page again | ☐ |
| 2026-08-25 | **The Overview’s "+ Add these rows" was asking about a different list than the one it was showing.** Reported as a form that opened on **"Add 0 rows to the lookup · Nothing left to add here."** underneath a section listing **1,116** Ready-Mix mixes with no `PRODUCT MASTER` row. Both lists were real and neither was wrong: the section’s comes from the **month cube**, which is the live report **plus the closed-year books**, every row of it resolved against the **live** `PRODUCT MASTER` — so a mix that traded in a closed year and has since been dropped from the master is on that list **and on no live one**. The form called `getRmxSuggestions({})`, whose miss list is the live report’s own. **There was no way for that to come out right**: a clean live report gave a form with nothing in it, and a dirty one gave rows the section had not listed, because the client answered an empty filter with `if(!list.length) list=r.product` — a fallback that silently changes the question. `getSuggestions` now takes the caller’s `values` and classifies **those**: `sgProductRow_` parses the description and reads no report at all, so the Overview’s add-rows click stopped pulling the 14 MB bundle as a side effect. Deduped **by product code**, since that is the column `applyRows` keys on and two descriptions sharing a code are one row in the tab; codes the tab already carries are dropped rather than proposed again and counted as `already`, so the empty form can say **which** empty it is — "all of these are in `PRODUCT MASTER` already, the count above it is the cube’s" is a different fact from "nothing matched", and the cube being minutes behind the tab is normal. The model gained the code set for that (`SG_CACHE_VER` → `sg3`). **The form is capped at `LK_BATCH` = 200**: 1,116 proposals is 1,116 × five controls, three of them selects carrying the whole master vocabulary, built inside the Apps Script frame before anything appears — the section is sorted by revenue, so a batch is the biggest ones and the note says how many are waiting. The Ready-Mix page’s own dialog is untouched: it asks with no `values`, its section and its form read the one live list, and that is why it never showed this. `tests/lookupadd.js` is the new gate — the server half over the three lookup tabs, the client half by slicing `lkOpen` out of `app.html` and stubbing `google.script.run`; mutation-tested by reverting each half alone (14 cases fail without the server, 8 without the client). All 31 harnesses pass | ✅ |
| 2026-08-25 | **`Service timed out: Spreadsheets` was the unpark, and the band it put back was one it was about to take off again.** The 22:12 run is the whole story: at 22:13:03 `unpark_` — the first line of `writeColumns_` — wrote a parked band home, and forty lines later that same band was read, parked and cleared again. **Putting six `ARRAYFORMULA`s back onto a 47,845-row tab is exactly the full-column recalculation §5b takes the band out to avoid**, and the sheet was still doing it when the write asked for the tab: `Service timed out: Spreadsheets` on BOTH Aggregates tabs, about 150 seconds producing nothing, and Ready-Mix (30,000 of 44,246 rows) and Product Segment ran out of execution time behind it. The park is a copy of the band, so `readPark_` reads it and the write puts it back at the end the way it puts back one it lifted out itself. **Removing the unpark exposed what it had been hiding**: `firstDataRow_` finds the first data row by looking for a formula in a column the export does not feed, and with the band off the tab there is none on that row — it finds the next row down of a foreign column that IS filled down and answers **one row too low**, so every row of the export lands one row out on every run following a killed one. The park carries `firstData` and that is now what is read; the harness caught it on the fixture's deliberate untouched column M. **The 08-25 one-export-per-firing change is reverted**, and the reasoning it was built on was wrong twice over: the `scope=all tries=1` line that was read as a stale build was a stale READING — the code and the mail were current — and deferring an export that would have fitted makes the common case worse, turning one run into three across fifteen minutes when all three exports rarely move together. `run()` already refuses a PAGE it cannot start and arms the one-shot for what is left, so a firing is one execution's worth of work rather than one export's. Kept from that change: the three park fixes (the drop moved to the restore pass that always runs, `putBand_` reporting whether the band actually went back, and its catch no longer silent), the stamp read/write folded into one helper each, and `logging.js` green again. **A number-format skip was written and dropped**: `getNumberFormat` on a range answers for the top-left cell only, so a column pasted over in the middle would keep the wrong format and Bill Month would come back as a date in the rows nobody looks at — the wrong trade for one write. Six mutations, every one caught. `qliksync.js`'s two `settle_` cases are still red and still deliberate. **What is left is arithmetic and it is tight**: about 320–350 seconds of work against a 360-second limit with the budget guard at 300, so the biggest remaining lever is the write itself — `values.batchUpdate` over the Sheets REST API the poll already uses, which would also blind every write-path gate in the harness and is its own piece of work | ☐ |
| 2026-08-25 | **One export per execution, three timers, and most of `run()` went with it.** The job is about seven minutes — Aggregates 52,538 rows and ~80 s to write, Ready-Mix 82,200 and ~165 s, Product Segment small, three conversions and reads another ~70 s — and an Apps Script execution is six. **No arrangement of one firing holds that**, which is what every timeout since 08-23 has been: the old `run('all')` did as much as fitted and pushed the rest into a retry chain, so the tail of the work ran a lap behind. `run()` takes a PAGE now — one export, one workbook, one execution, two to three minutes against six — and §11 sets **one time-driven trigger per export** (`qlikSyncAggregates`, `qlikSyncReadyMix`, `qlikSyncSegment`), a few minutes apart because the lock is script-wide and `LockService` has no named ones. `qlikSyncCheck` stays as the pre-split target only so an existing trigger on it does not fail silently; `APP_TRIGGER_TARGETS` is five entries now and `APP_verifyPermissions` is still the only report of which are armed. **What went is the point**: the `byPage` walk, the read-on-first-use/drop-on-last-use bookkeeping, the per-page budget refusal, the per-page retry fan-out and `QLIK_RETRY_MAX_BUDGET` all existed to fit three exports into one execution and make the leftovers converge across firings — with one page a firing there is nothing left to shrink, so a clock failure retries **once**, like a broken export, and five identical attempts were five ways of not saying that a page does not fit. **Two holes closed on the way**: a page whose export could not be READ kept its stamp, marking a file as read that nothing had opened, so the next firing skipped it — it is flagged retryable now; and a retry that SUCCEEDED never wrote a stamp, so the next firing re-did the minutes of work it had just done, and it now records the modified time the run itself read off `QLIK_LAST_SYNC` rather than whatever is in Drive when the retry finishes. **The two counts the business reconciles against Qlik are checked out loud after the write**: the tab must end at `firstData + rows - 1` exactly and **both directions throw** (too tall is surplus still holding the previous export's figures, which is the failure deleting the surplus exists to prevent), and paired-vs-unmatched columns are logged on every run and returned — unmatched deliberately **not** a failure, because that is what a new year's column looks like before somebody adds it to the workbook and refusing would stop the pipeline every January. The shrink allowance on a period roll is untouched, and so is the rule that the sync owns only the columns it pairs. **`tests/` is deleted** — 31 harnesses, 500 KB — rather than rewritten around a `run()` that no longer has the shape they gated; they are in git history, and every `tests/…` reference left in this document is now marked historical at the top. `node --check` and `APP_verifyPermissions` are what is left | ☐ |
| 2026-08-25 | **`qlikSyncNow` run from the editor asks for `'all'`, which is the one thing its own comment says not to do.** The Run menu calls a function with no arguments and `qlikSyncNow`'s default for none is `'all'` — three exports in one execution, the seven minutes that does not fit six, with the third usually refused on the budget and retried. There is no way to pass `'AGG'` from that dropdown, so "prefer one at a time" was advice nobody standing in the editor could follow. `qlikAggNow`, `qlikRmxNow` and `qlikSegmentNow` are that call with the key already in it, and nothing else: the unconditional pull, the stamp read before the run, the stamp withheld on a gated export and the single result object are all still `qlikSyncNow`'s. **They are deliberately not trigger targets** and are not in `APP_TRIGGER_TARGETS` — they skip an unchanged export the way the timers do, which is to say not at all, so a timer on one would re-sync minutes of Drive work every interval for ever. Named in §11's banner and in §9's do-not-delete table, because zero callers is what an editor tool looks like | ✅ |
| 2026-08-25 | **Both ways of starting all three exports at once are gone, and "one at a time" is now a property of the code rather than advice.** `qlikSyncCheck` ran the three exports in one execution and was kept, after the 08-25 split, only so that a trigger still pointed at it would not fail silently; `qlikSyncNow(scope)` took `'all'` and **defaulted to it** for the no-argument call the Run menu makes. Both were the same seven minutes against a six-minute execution that every timeout since 08-23 has been, and keeping either kept a way to ask for it. **Both are deleted.** What is behind `qlikAggNow` / `qlikRmxNow` / `qlikSegmentNow` is now the private `qlikSyncNowOne_`, which takes ONE source and refuses anything naming more or naming nothing — `'all'` arrives as a name no source answers to, so the refusal is a `pick.length !== 1` check rather than a comment asking nicely, and there is no branch left that could walk more than one source. Everything else is unchanged and deliberately so: the unconditional pull (the manual path exists BECAUSE the file did not move), the stamp read before the run, the stamp withheld on a gated export, one result object. **The operational half is the trigger list, not the code**: a timer still set on `qlikSyncCheck` now fails on every firing, and a timer nobody watches fails quietly — delete it, set one on each of `qlikSyncAggregates`, `qlikSyncReadyMix` and `qlikSyncSegment`, and run `APP_verifyPermissions` to see which are armed. `APP_TRIGGER_TARGETS` is unchanged, because `qlikSyncCheck` was never in it. Six prose references followed the code: the two places in §5 that told a reader to run `qlikSyncNow` are **in the failure email a human reads**, so they name the three wrappers now. `node --check` clean | ☐ |
| 2026-08-25 | **The sync failure mail is a switch now, and it is off by default.** `MailApp` is reached only when `QLIK_ALERT_MAIL` says `on`; `qlikAlertsOn()` / `qlikAlertsOff()` (§11) are the two editor tools that set it, and neither touches `QLIK_ALERT_TO`, so the address survives a mute. The mail was written for a pipeline nobody was watching and is right for one — but a sync that has *started* failing sends the same mail every fifteen minutes to somebody already dealing with it, and that is how the one mail that matters ends up looking like the twenty before it. **Muted is not silent**, which is why this is a switch and not a deletion: `run()` returns its failures to a time-driven trigger, which reads them nowhere, so a muted run writes the **entire** report it would have mailed to the execution log at `error`, and `qlikRetryStatus()` names the mute every time it is asked — a mute set for one bad afternoon cannot quietly outlive the afternoon | ✅ |
| 2026-08-25 | **Most of the Ready-Mix write was `Utilities.formatDate`, called once a row.** `monthText_` crosses out of V8 into Apps Script's services twice per row to format a Bill Month, and the *crossing* is the cost — 82,200 rows is ~165,000 service calls, which is to within noise the whole of the ~165 s that write was measured at. A month column holds about a dozen distinct values, so the answers are memoised on the value: 29,100 `formatDate` calls become 97 on a 34,200-row harness, identical output on every one. Two more of the same shape went with it — the formula band was going home **twice** per tab (the second pass now skips a run whose re-pointed formulas are identical to the ones already there, which is the 140,000-string-operation recalculation the band is taken *off* the tab to avoid), and the month column was walked twice for one answer. **And the settle now reserves the write's three minutes**: the ceiling was "five minutes minus what this run has spent", so a 4-minute wait left 60 s to write 82,200 rows — which is exactly the run that refused `Associate Raw Data` 5,000 rows in | ✅ |
| 2026-08-25 | **The retry does the tabs that failed, not the page they are on.** One Ready-Mix tab failing retried all three — 82,200 rows rewritten to fix 14,157, which is the work that used the budget up in the first place — and that is a **risk** taken for no gain, not merely waste: a retry killed mid-write on a tab that was already right takes a *good* tab apart and leaves it blank below the boundary. The failure record names its tabs and `run(page, only)` takes the list; the timers and the editor tools pass nothing and get the whole page. **"The page cannot be split further" was the wrong reading of a true constraint** — what has to hold is that no formula is left pointing at a height that has moved, so the re-point pass now covers every `'columns'` tab of the page rather than only the ones in `plan`: a tab this run did not write has its band read off the tab and re-pointed only if it names a tab this run did. That **closes a hole the full-run path had all along** — a run whose second tab failed its gate left the first tab's cross-references pointing at the second tab's old height, with nothing to notice | ✅ |
| 2026-08-25 | **The opening is a batch now, and the loading screen gets out of the way once there are figures behind it.** The Executive Overview opened with **24 `google.script.run` calls** — 4 `getOverview`, 8 `CUBE_getChunk`, 2 `CUBE_getManifest`, 3 `getFscData`, 3 `getCustomerReport`, plus versions, source times and KPI values — and Apps Script runs a user's calls END TO END, so none of it overlapped and almost all of it was handing over something `CacheService` already held. Four mechanisms, in the order they matter. **`APP_batch(calls)` (§3)** runs a list in ONE execution, each entry caught on its own, dispatching only through `APP_BATCH_ALLOW_` — 30 READS, no writes, because "which of the six ran before the budget stopped it" must never be a question about a sync or an email — and stops STARTING work at `APP_BATCH_BUDGET_MS`, marking the rest `skipped` for the browser to re-issue. `AMR.batch` (§D) is the transport and falls back to one call each on ANY failure, including a deployment with no `APP_batch` in it. **`CUBE_getChunks` (§8)** takes a mixed, ORDERED list — the order is the streaming plan, newest block of the line you are looking at first — and stops short of `CUBE.BYTES_PER_CALL` using the cache's own meta rather than reading to find out; a reply shorter than the ask is normal and the browser re-asks, gated on that reply having carried at least one usable block so a dead chunk is tried once and not for ever. **The month anchor comes off the manifest** (`SEED_YM`): the first `getOverview` used to ask for month 0, then the first block landed, moved the anchor and the whole thing was fetched again — twice over, because each fetch prefetched the other Period. `winMonths()` is untouched and still reads what has LANDED; this is a different question and only the server fetch asks it. **And `AmrBoot.painted()`**: the full-screen screen is now modal for exactly one situation — an opening with nothing behind it — and becomes a bottom-right card the moment `done('data')` says there are figures on the page, which is also what stops every later fetch throwing a second full-screen screen over a finished one. Overview 24 → **7**; Price & Volume 4 opening calls → 1 and its chunk calls 4 → 2; Ready-Mix `RMX_prepare` + `getLogo` → 1; both fuel pages' version + logo → 1. **Left undone on purpose:** Product Segment still opens with two (`getKpiValues`, then `RMX_getStamp`/`RMX_prepare`) — folding them in means teaching `bootLoad` to carry passengers on the page with the write-only-store history, for one round trip; and `AmrStamp` still fetches `getSourceTimes` on its own because §D mounts it before the page's `boot()` runs, so there is no batch to put it in yet | ✅ |
| 2026-08-25 | **The data-quality cap is gone, and a call that never answers no longer hangs the page.** Two things, and the second is the answer to "it gets stuck randomly". **The 200-row cap on the lookup editor** was protecting against a real cost measured in Chromium: 1,200 proposed rows rendered eagerly is 91,200 nodes and **5.8 seconds** of frozen main thread, because three of the five controls per row carry the whole PRODUCT MASTER vocabulary. Capping made that 1.6s and left the expensive half in place — six rounds of fill/save/wait-for-the-cube-to-rebuild to fix 1,116 mixes. `lkSelect` now renders ONE option (the selected one, which is what a save reads) and `lkFill()` adds the rest on first focus or mousedown; `.lk-row` carries `content-visibility:auto` so the 340px scroll box lays out what is visible. Same 1,200 rows: **25,200 nodes and 325ms** — eighteen times faster than what the cap protected against, and quicker than the old form was at 200. The trap, checked in Chromium against the shipped functions: an empty value used to render no selected option and the browser took the FIRST one, so `lkSelect` selects `list[0]` rather than blank or a save writes something different from what it always did. The 60-row listing cap went the same way — the table is built only for the section that is OPEN, so the reason for it is gone. **And the hang.** `google.script.run` has no timeout and no way to ask for one: when an execution dies without reporting, NEITHER handler runs, nothing is watching, and the page sits under its screen for ever leaving no trace anywhere — no error, no failed call, nothing in any log. §D's call guard (the same interception that drops a stale answer) now stamps every call, tracks it on `INFLIGHT` and gives it a 7-minute watchdog — past the platform's own 6-minute kill, so a cold cube build is never failed while it is still building — and whichever of success/failure/watchdog fires first settles it, the losers ignored. A watchdog win runs the CALLER'S OWN failure handler, so a hang becomes the error path each page already has. `AMR.inflight()` is what makes the wait diagnosable: `AmrBoot`'s 150s watchdog names the call that has not answered instead of blaming the page's code, which it now only does when nothing is outstanding. Two related fixes found on the way: `withUserObject` was falling through the guard's dispatch branch and handing back an UNWRAPPED runner (losing the guard for the rest of the chain), and `APP_batch` gained `APP_BATCH_CEILING_MS` — it estimates the next call from the longest one so far and refuses to start work that would run into the 6-minute limit, which is the one way batching could hang a page that separate calls could not | ✅ |
| 2026-08-25 | **Extras & VAP is on the Overview for every Period pick, and the data-quality badge now counts the section that explains it.** The by-type table was hidden for both Prev-month picks and every dragged span on a correct observation — the month cube carries the extras MONEY (`ex` / `va`, which is what the ASP build-up above it sums) and not the extra TYPE — but *the cube cannot answer it* is a different question from *the page cannot show it*. `RMX_NS.getCrossReport` can, once it is asked for the right months: it takes a **month span** (`monthFrom` / `monthTo`, 1-12 inclusive) beside its original `period` + `month` pair, both scoped through one `inScope_` so the two halves of an answer cannot disagree, and the span is in the cache key and echoed back as `monthSpan`. In the page `rxfWinScope()` is the single decision: null on the MTD / YTD path — **nothing on that path moves, the server still answers for its own reporting month** — and the window's own two months otherwise, carried in `rxfSig()` so a stale reply cannot paint and in `rxfArg()` so the signature and the call cannot describe two different reports. **This is not the server painting over a window**: the rule it looks like it breaks is *a report fetched for `STATE.period` must not paint a window*, and this one was not fetched for `STATE.period`; every other Ready-Mix panel still belongs to the cube, so no figure on the tab has two sources. **The real restriction is the book year, not the period.** These rows carry a month and a cy/py pair and no year of their own, so month 3 is March of `cyYear` against March of `pyYear` — ask for a span in a closed year and the report would answer for the book year's months without saying so. The caller refuses (same shape as `winFscOk`), the server does not, and the panel is not shown there. **Product Category is now the only which-period gate left on the page.** **And the ⚠ badge was counting four of its six sections.** EXTRAS LOOKUP and CUSTOM FLAG misses are not in the cube — the RMX fact table has plant, mix and segment and no extras or material *description* to match on — so they come from `getRmxSuggestions`, which only `dqOpen()` ever called: the extras misses did not exist until somebody opened the panel, and **an unmatched extras row is exactly the one that drops a type out of the table above**. `boot()` asks once, 1.2s behind the first paint. Nothing about it was ever period-scoped on the server; `getUnmapped` walks the whole bundle. **Found and NOT changed** (both would move numbers that are right today): `getRmxCrossReport` and `getOverview`'s RMX half send no month at all, so they answer for RMX's *reporting* month while `getOverview`'s PV half is passed the cube anchor — two months on one page whenever the running month has RMX rows; and pressing YTD on the Ready-Mix tab always costs a round trip, because `rxfSig()` is keyed on `STATE.period` and nothing prefetches the other period's cross-report the way `load()` prefetches the other `getOverview`. `node --check` clean on `script.gs` and on all 28 of `app.html`'s script blocks | ✅ |
| 2026-08-25 | **The extras tabs always carried their year; nobody had ever read the closed books', and `ex` / `va` had never been written at all.** The previous row's account of *why* Extras & VAP stopped at the book year was wrong and is corrected here. **Bill Month carries the year on every one of these rows**, live book and closed alike, and the `- CY` / `- PY` versus `- 2024` / `- 2025` heading is a difference `APP_yearCols_` erases — that helper exists for this. What discards the year is §7's `loadStream_` (`monthOrd_` reads three letters), and what actually bounded the panel is that **one workbook holds two book years and `ovcHistRmx_` reads Main Raw Data and stops**. So the restriction was never about months. **§8 now has extras FACTS**: `ovcHistRmxExtras_` reads a closed book's Extra Raw Data and Associate Raw Data tabs, `ovcXWrite_` parks them per era (`part:'extras'`, its own file and its own `OVX_SHAPE_VER_`, so an extras change never makes the month files stale or the other way round), and `ovcXRead_` merges them with the live tabs on one `ym` axis under one master dictionary — history first, newest book wins a shared month, live wins over the lot, the same one line `ovcMerge_` follows. Facts only: plant, segment, mat_descr, with market and the extra TYPE resolved from the LIVE lookups at read time, so an EXTRAS LOOKUP edit re-labels every closed year at once. `RMX_getExtrasByMonths` answers the panel for an explicit `ym` list and **returns revenue, not `$/m³`** — the denominator is the browser's own, and a second copy would be two answers to one question. **The second bug is the one nobody could see.** `ex` / `va` have been in `CUBE.SHAPE` since v2 and **nothing has ever written to them**: the live roll read `e.cyExRev` off Main Raw Data rows that never had such a field, the history roll read `col.ex` from a `byYear` map built out of the volume and net-sales headers alone. Every Extras and VAP row of the window-mode ASP build-up was `$0.00` and All-in equalled Base, under a correct heading, for the life of the panel. `ovcRmxFoldExtras_` fills both from the same facts the by-type table reads — onto the BLANK mix, which `dimsForProduct_` buckets as *Others*, carrying no volume and no base revenue, so a pair of zeroes fails the browser's `> 0` coverage test (no PPI, no CPI moves) and every grouped view filters on volume/revenue before rendering (no extras-only row of zeroes). **And a month nobody has read is not a month with no extras**: `ovcXAcc_` records a source's span from every readable row, and the panel prints which window months are uncovered instead of totalling the ones that are. The `monthFrom` / `monthTo` span added earlier the same day is **gone** — it could only ever answer inside the live book year while the other eight blocks of that report were scoped to a period, which is one payload with one correct block. `getCrossReport` is a period report again (its single `inScope_` is what the attempt left behind and is kept). A throwaway Node harness over the extracted pure functions covered the dictionary remap across eras, the CY-wins-a-shared-month rule on a 24-month window, the market/segment/mix filters, a closed-year answer, the uncovered lists and the fold; `node --check` clean on `script.gs` and on all 28 of `app.html`'s script blocks | ✅ |
| 2026-08-25 | **The extras fix was correct and unreachable: both caches key on a token that did not move.** The previous row's work — `ovcRmxFoldExtras_` filling `ex` / `va` from the extras facts — was deployed and running, and the window-mode ASP build-up went on reporting **Extras $0.00, VAP $0.00, All-in = Base** against a correct Base. Nothing was wrong with the fold (a Node harness over the extracted function proves it: 18 assertions covering both streams on both sides of the year, the blank-mix rule, base volume and revenue untouched, a plant the cube has never seen becoming a new dictionary entry, and an applied-m³-only row moving no money). **What was wrong is that nobody could ever receive it.** A cube chunk is cached server-side under `ovcGen_()` and again in the browser's IndexedDB under the same token, and the browser wipes **only** when that token moves. `ex` and `va` did not change POSITION, so `OVCUBE_SHAPE_` was untouched, so `OVCUBE_SHAPE_VER_` was left on `v3` — and every warm device replayed pre-fold blocks, in which those two columns are zero, for as long as it kept its IndexedDB. `OVCUBE_SHAPE_VER_` is `v4` and its comment now says *and whenever what is WRITTEN INTO a column changes*, which is the half it left out. **The structural half is `ovcGen_()` carrying `OVX_SHAPE_VER_`.** Keeping the extras shape out of the cube's generation was right when the cube did not read the extras; it stopped being right the moment the fold made two of its columns extras money. The separation survives where it belongs — the parked history FILES still key on it independently, so an extras rebuild still does not invalidate the month files. **This is the second write-up of one failure**: `ovcCovTok_`'s banner is the first, for a CPI threshold that travelled inside a cached payload whose key never noticed it and published +141.7% against Qlik's 2.86%. If a payload carries it, the key has to. **The three live workbooks were repointed** — Price & Volume, Ready-Mix and Product Segment all had 2025-vintage `defaultSpreadsheetId`s. And editing one of those is **not enough on a project that carries an override**: `getSpreadsheetIdForPage_` is `override || default`, so a link pasted into ⚙ Settings months ago outranks this file silently and for ever. **`useCodeSheets()`** deletes the override for every page that has a code default and reports what each page then resolves to; it deliberately spares the four history books, whose default is `''` by design and whose link lives nowhere but the property store. **`Combined Data CPI Other Revenue` is named in Config now** (`SHEETS.OTHER_REV`), on the live page and on both closed-year Aggregates books — it is the same export template, so the closed books carry the tab too — and `buildSpec_` reads it from there instead of spelling it a second time. **The history books' lookup tabs are gone from Config**, which is the honest statement of what was already true: `ovcLookupsAgg_` and `ovcLookupsRmx_` open the LIVE workbooks every time and a closed book's frozen `REGION LOOKUP` / `TOPLINE REV LOOKUP2` / `PLANT LOOKUP` / `PRODUCT MASTER` have never been read, so re-mapping a plant today re-labels every closed year at once. Declaring four tab names nothing reads invited exactly the wrong repair. `node --check` clean on `script.gs`; `app.html` unchanged | ✅ |
| 2026-08-25 | **The Deck Builder is one list: Arrange stopped being a second copy of it, and Render can be stopped.** Arrange was a panel above `#dbList` with all 43 rows in a 620px scroller and a fixed 356px column beside it, so the layout picker was in one list and the arrows, the fields and the tables in the other — the complaint was scrolling between two lists to change one slide. It is a **mode of the one list** now: `rowHtml` grows the row's arrange cells (arrows, tick, editable title, the adapter-declared selects, Tables, ×) and `arrSideHtml` opens the scope panel as a **drawer under the row whose Tables button asked for it**, three columns wide instead of one narrow one. **The constraint that kept them apart was dead, not overruled**: every comment saying `#dbList` is diffed byte for byte by `pageparity.js` was written against a harness removed with the rest of `tests/` on 2026-08-25, and four of them still asserted it in the present tense — the shape §9 warns about, a comment outliving the thing that made it true. Two placement facts cost a rebuild each and are now in the CSS: the selects on a second grid line **cannot span to `-1`** or the row-spanning thumbnail is pushed into an eleventh implicit column and the title collapses to 40px, and at the 980px step they must stop at line 6 because the four narrower columns do not exist there. **Render's Stop ends the pass at the next slide, never mid-capture** — the slide in flight is finished and kept, which makes a second Render a resume rather than a restart on the rule a failed slide already used (`r.on && !r.png`); `RENDERING` is separate from `BUSY` because Plan and Publish are busy too and have nothing to stop. Checked against a throwaway Playwright harness that mounts the real page over stubbed `google.script.run` — move, add, delete, the drawer following a moved row, Done, both breakpoints, and a stop at slide 2 of 12 resuming to 12 of 12 | ✅ |
| 2026-08-26 | **Extras and VAP are rows of the Ready-Mix line now, and the three things built to carry them separately are gone.** The last three sessions answered *the cube cannot split extras by type* by building a second structure beside it: a parked extras file per era with its own `OVX_SHAPE_VER_`, a second `CUBE_rebuildHistory` part to fill it, `ovcXAcc_` / `ovcXRead_` / `ovcXFacts_` to merge it, `ovcRmxFoldExtras_` to fold it back into the cube it had been kept out of, `RMX_getExtrasByMonths` to query it, `RMX_NS.extraResolver()` to label it, and a fetch-and-cache triple in the page to receive it. **The premise was wrong.** An extras row is a Main Raw Data row with a different lookup — same plant, same Bill Month, same Major Project Segment, same money — and the cube already knows how to carry one of those: `mix` holds the raw Product Mix and `mixMap` holds what `PRODUCT MASTER` calls it. So the rmx line has a fourth dimension, `extra`, holding the raw `mat_descr`, with `extraMap.extraType` resolved from the LIVE `EXTRAS LOOKUP` at build time exactly as `mixMap` is; `Main Raw Data`, `Extra Raw Data` and `Associate Raw Data` go into one accumulator (`ovcRmxAcc_`), in one read, live and history alike, into the same rows, the same chunks and the same parked file. `OVCUBE_SHAPE_VER_` → `v5`, which is what makes every warm device pick it up. **Everything above deletes**: one endpoint, one Drive file, one shape version, one rebuild part, one resolver, ~530 lines of §8 and the page's whole `WEXT_*` fetch path — and with it the queue that was re-reading closed books on a loop. The Overview's by-type table is `winExtrasReport()`, a group-by on the fact table already in the browser, answering for any span the slider reaches including a closed year, with no round trip and no *"this month has no extras source yet"* note to write because a book's extras land with its volumes. The ASP build-up above it and the table below it are now the same rows summed two ways. **CUSTOM FLAG LOOKUP is removed.** It keyed on the same `mat_descr` and bucketed the same materials as `EXTRAS LOOKUP`, both Extras tables had already been moved onto `EXTRAS LOOKUP`, nothing displayed a flag, and the two tabs had drifted — so it is gone from Config, `buildLookups_`, the stream rows, the miss lists, the suggester's model and both add-rows forms. §9's *still worth auditing* entry for it is closed. **And "✓ all matched" was a lie the panel could not help telling.** The extras and CUSTOM FLAG miss lists came from `getRmxSuggestions` over the LIVE workbook alone, so a material that traded in a closed year and is in no lookup was invisible — the badge said everything matched while the by-type table dropped that revenue into *Unclassified*. Those misses are collected by the cube across every era now, like `PRODUCT MASTER`'s, and `unmapped.checked` carries **how many distinct values were tested** so the section reads *"✓ all 812 matched"*: "nothing failed" and "nothing was examined" had looked identical on that line through every version of this panel that has ever been wrong. The badge asks the server for nothing at all and is right from the first paint. `node --check` clean on `script.gs` and on all 28 of `app.html`'s script blocks | ✅ |
| 2026-08-26 | **The morning's first open was rebuilding every cache in the foreground, and now an hourly timer does it at an hour when nobody is waiting.** Reported as *five minutes to load*, and the execution log says exactly that: `APP_batch` at 56.9s then **144.0s**, a `CUBE_getChunks` that ran **113.8s and then FAILED**, a 34.4s manifest, four `CUBE_rebuildHistory` at ~29s each, and `getGuideImages` at 6.2s and 6.5s in front of all of it. **One cause, four mechanisms.** Every cached answer is keyed on its source workbook's modified time, so a sync makes all of them unreachable at once and nothing rebuilt any of it except a person opening the page — the first one in paid for everything and everyone after them got it free. **(1) `APP_warmCaches` is the sixth trigger target** (one hourly timer, §11): stale books, one token bump, both cubes, the two source bundles, the fixed-argument answers, all under a budget that refuses to start a book read it cannot finish, with `APP_warmStatus()` to say what a firing would do without doing it. A firing on unchanged data is a handful of cache reads and one Drive lookup per workbook. **(2) A closed-year book is re-read when it CHANGES.** It used to be re-read whenever no usable file was parked for it — which is a fine answer to *can this be read* and no answer to *does it still match the workbook*, and it meant bumping `OVCUBE_SHAPE_VER_` (v5, the day before) made all four files unreadable at once so the next person to open the Overview read all four, **with every read moving `ovcHistTok_` and throwing away the cube they were waiting for**. `ovcHistWrite_` stamps the file with the book's modified time, taken BEFORE the read; a copy in Script Properties lets `ovcHistWhy_` answer without opening a megabyte of Drive to decide whether to open it; and `ovcHistRead_` back-fills that property from the file, which is the truth. **Three states, not two**: `first` (never built — the browser still reads it, because somebody has just linked a book and is sitting there), `stale` (the trigger's job and the pill's Reload), and `adopt` (readable but carrying no record of what it was built from — read once, to give it one; every file in Drive on the day this shipped). The property is what tells `first` from a shape bump at no cost. `bump:false` + `CUBE_bumpHistoryToken()` makes four books one invalidation instead of four. **(3) `ovcBuild_` is single-flight.** It is entered from `CUBE_getManifest` AND `CUBE_getChunks`, from every open page, and Apps Script runs different users concurrently — six people opening the Overview was six builds of the same two cubes. NOT `LockService`: there are no named locks, so the only lock is the one the QlikView timers hold for minutes while writing a sheet. An advisory cache marker, with the wait keyed on the manifest (written LAST, after every chunk) and the cap set BEYOND a build — a wait that expires pays for the wait and the build both. **(4) `getGuideImages` caches each screenshot's data URI under its Drive id**, so a panel that cost a Drive read and a base64 per picture per page open, for ever, costs one cache read after the first of the six hours. **The other half of this was wrong and was reverted the same day.** The fetch was moved off mount and onto the fab's click on the reading that six seconds of it sat *in front of* the opening batch — and the log says it did not: `getGuideImages` started 09:02:33 for 6.2s and both `getSourceTimes` and `APP_batch` started at 09:02:36, *inside* that window, on both of the morning's openings. It overlapped. Deferring therefore saved the page load nothing and cost the guide six seconds of *loading…* at the moment somebody asks for help, so mounting is the right time and the executable code is back to what it was. **The wider claim is the one to be careful with**: `APP_batch`'s own banner says Apps Script runs one user's calls END TO END, and these two openings show three of them overlapping — whatever the general rule is, it is not safe to reason from it about a specific call without checking that call's own timings. **The quota audit found the opposite of what was asked.** 9 KB/property, 500 KB/store, 100 KB/value, 6 h TTL and 250-char keys are all real published figures and none of them is limiting anything here (the biggest deck arrangement measures 5,183 of its 9,216 bytes). **The one that bites is not in the quotas table at all: a script cache holds ~1,000 ITEMS and evicts FIFO in blocks of ~100.** A megabyte of chunk is twelve items, both cubes is most of two hundred — so a cold build writes a fifth of the cache and evicts the oldest hundred of everything else, possibly including its own earlier chunks. That is precisely the *partial* `APP_cacheGet_` reports, whose comment read it as a TTL problem: right symptom, wrong cause, and the pieces of one entry cannot expire apart because they share one `putAll`. `APP_cachePut_` now warns when one entry takes a tenth of the budget, and `ovcBuildNow_` checks its own blocks survived the write and logs an `error` when they did not — which is what the 113.8s failure was. **Not changed, and worth knowing**: `ovcBuild_` is monolithic, so the current year's block cannot arrive until 2023 has been read, remapped, merged, labelled and chunked — the current tab is held hostage by the oldest one. Warming takes that off the user's path; splitting it does not fit in this change. `APP_CODE_BUILD` → `2026-08-26a`, which strands every server and device cache for a genuine cold-load measurement **without** touching the parked history files (they key on `ovcHistTok_` and `OVCUBE_SHAPE_VER_`, so a reset costs a cube rebuild and never four workbook reads — bumping the shape version to force a cold load would have cost both). Symbol-table diff clean (13 functions and 9 constants added, nothing removed); `node --check` clean on `script.gs` and on all 28 of `app.html`'s script blocks | ✅ |
| 2026-08-26 | **The Overview was reporting two months at once, and the fix for that had reached one call in nine.** Reported from the page: under *This month (MTD)* the Ready-Mix KPI strip read **180,038 m³** above a Market summary reading **111,463 m³** for the same selection, and under *Year to date* **849,476** above **960,939** — in both cases the strip was printing the **Prev month** figure exactly. Nothing was stale: the cube-fed panels answer for `anchorMonth()` (the newest month there is data for, August) and the server reports answer for `reportMonth_` (last calendar month, July), and only `getOverview` had ever been passed a month. **The 2026-08-25 row named this and left it** — *“Found and NOT changed (both would move numbers that are right today)”* — which was a defensible call about the server's own numbers and the wrong one about the page: they were right relative to the report month and wrong relative to everything printed under them, and there was nothing on screen to tell the two apart. **The month now travels with all nine**: `rxfArg` → `getRmxCrossReport`, `RMX_NS.getKeys` and the per-market bridges inside `getOverview` (one payload had been carrying two months, and one market drew a revenue waterfall and an ASP waterfall from different ones), `loadDims` and `loadPM` → `getReport`, `loadCustomers` → `getCustomerReport`, `loadXf` → `getCrossReport`, `prefetchXData` → `getCrossData` (**the only report in the file that had no month parameter at all** — it takes one now, in the key beside `ovcCovTok_`, for exactly the reason that token is there), and both fuel-surcharge panels, which were a third and fourth idea of *this month* on one screen. **And into every key**: `dimsKey` / `pmKey` / `xfSig` / `rxfSig` / `custKey` / the `XDATA` slot / the surcharge payload. Only `loadKey` had it, so `wireCube`'s safety net — the thing written for *two halves of the page reporting different months* — re-fetched `getOverview` and left six caches, device copies included, on whatever month they were first filled for. **Being answered for the month you asked for is not the same as that month having rows in it**: a book the export has not reached answers correctly with nothing in it, and zero is the one figure that looks like data, so every payload's `month` and `months.cy` are read back and `monthWarn()` names the difference in the footer — said out loud rather than used to refuse the paint, because a page that will not draw is worse than one that says which month it drew. **Four things that were wrong independent of the month.** `renderRmxDims`' first-paint fallback re-derived base revenue as ASP×volume and then left it off the row it emitted, so `revCY()` fell through to an undefined `cyAsp` and the **Rev CY / Rev PY / Rev % columns of every Ready-Mix dimension table read $0, $0 and a dash** — transient normally, *permanent whenever the cross-report failed*, because `rows` is non-null by then and the error path is never reached; the exact `baseCY` / `basePY` had been on those rows all along. `aggTotals` copied seven fields off `aggAll` and left `cyRev` / `pyRev` behind, forcing the revenue bridge back onto the lossy form `revCY()` exists to replace. `joinCpi` writes onto rows that live in `DIMS_CACHE`, and an early `return false` left the **previous window's CPI** on them for `hasCpi()` to find — it clears what it attached before deciding now, and only what it attached, so a report carrying its own CPI is neither wiped nor overwritten. `syncWindow`'s re-pin test read `WIN.months[length-2]` **after** the list had been replaced, so it fired on windows that were never pinned and dragged the user's end handle forward every time a history block landed (blocks arrive newest-first and extend the list at the FRONT). **Three silences.** All four Period buttons need `periodSpan()` to resolve — pressing one MOVES THE HANDLES — but only the Prev-month pair was marked disabled, so *This month* and *Year to date* looked pressable, were pressable and did nothing for the first seconds of every open. A market name the cube cannot resolve made the Market summary **vanish** while the server-fed panels above went on showing that market; it is a mapping fault and it now says so. And the **KPI strip named no span at all** — the one panel on the page with no heading, no eyebrow and no months on it, which is precisely what made a strip on July above a table on August invisible; it carries the same sentence every other card does, on every paint path, and *Month by month*'s note stops claiming *“adds up to the KPI strip above”* unless the two spans actually match. **Not done, and the tradeoff is real:** the anchor is the union of both lines' newest months, so a line that runs a month BEHIND the other is now asked for a month it may not carry and answers with zeros — previously it answered for its own report month instead. That is the documented one-anchor design (§7) and the AGG half has behaved this way since the anchor shipped; `monthWarn` is what makes it visible rather than silent. A per-line month would mean a second month in `getOverview`'s cache key and a second concept on the page. `node --check` clean on `script.gs` and on all 28 of `app.html`'s script blocks; nothing here can be exercised off-platform, so **run `APP_verifyPermissions` and step through all four Period buttons on both tabs in the editor before trusting it** | ✅ |
| 2026-08-26 | **A lookup row was costing the next person a five-minute foreground rebuild, and the transport was making a slow one worse.** Reported as *whenever a data row changes in one lookup table it forces reload on the entire thing*, and the execution log is the whole story: `applyRmxLookupRows` at 14:08:34, then the Overview opened at 14:09:59 into `APP_batch` **59.7 s (status Unknown)**, `APP_batch` again at 14:11:01 for **79 s**, and a red *Still waiting for data* card over an empty page. Nothing was broken. A lookup row is a **write to a source workbook**, `APP_getGen_` is that workbook's modified time, so approving three mixes strands the Ready-Mix bundle, both Overview payloads, both manifests and every chunk at once — correctly, because the mapping re-labels every year including the closed ones — and the only thing that ever rebuilt any of it was **the next person to open a page**, who is the person who just approved the row. **`APP_warmSoon_` arms `APP_warmCaches` as a one-shot a minute out** (the second `ScriptApp.newTrigger` in the file, same shape as §5's sync retry, its own handler name `APP_warmNow` because a one-shot pointed at `APP_warmCaches` would delete the *hourly* trigger as it fired). Three things around it were making the wait read as a fault: **AmrBoot's 150-second watchdog is shorter than a cold open**, so the one open with the best reason to be slow got the bug-report card and an invitation to reload — it now names the live call and counts up, and blames the code only after two consecutive looks with **nothing** outstanding; **`AMR.batch` fanned a vanished batch out into one call each**, queueing three more executions behind the one that was already the problem, and now fails every slot with the guard's own error instead; and **`ovcBuild_`'s two-minute single-flight sleep did not know it was inside a batch**, spending the batch's ceiling asleep and getting the slots behind it `skipped` — `APP_batch` publishes its deadline and the wait is trimmed to fit, keeping back enough to build the line itself. `APP_CODE_BUILD` is deliberately **not** bumped: nothing here changes a computed figure, and bumping it would strand every cache in the app to ship a fix whose entire point is not stranding caches | ✅ |
| 2026-08-26 | **The confidence hover on suggested lookup rows showed nothing on the rows most worth interrogating, and the Overview's form showed no confidence at all.** Reported from the Ready-Mix page: the Confidence chips in *Suggested lookup rows* hover to an empty tooltip. They did, and it was not a CSS problem — `sugChip` built its `title` out of `note` and `why`, and for a PRODUCT MASTER row **both are empty by construction**: those rows are PARSED rather than matched, so `RMXSUGGEST` hard-codes `why: []` for every one of them, and `note` is filled only when something went wrong. A row that parsed cleanly therefore had `title=""`, which is a tooltip that never appears — the chips that hovered to nothing were exactly the *Confident* ones. **Fixed on the server first, because the UI had nothing to show.** `sgProductRow_` now returns `reasons`, one line per decision and always all four — how the code was split, what the brand resolved to, whether a number sat against an MPa marker, which -TECT token won — stated whether each succeeded or not, because *"no retired brand in the text"* answers the question as much as a conversion does. `sgClassify_` returns the same for matched rows, plus how many of the closest neighbours agree, counted **consecutively from the top the way the bands count it**, so a card can never read *"2 of 3 agree"* beside a chip that says Review. **Both now carry a `score`, and §7 says what it is not:** the band is still the verdict and nothing branches on the number — each band owns a slice of 0–100 (`sgBandSpan_`: Low 15–54, Med 55–79, High 80–100) so the chip's word and its percentage cannot disagree, and the position inside the slice is the neighbour's similarity for a matched row, the parts that were readable for a parsed one. **Two shared §E modules, because two pages ask the same question.** `AmrHover` paints one card at `<body>` with `position:fixed` — every surface that shows a chip sits in a scroll box (`.sugbox-body`, `.lk-body`, `.dq-body` are all `overflow:auto`) and an in-flow popup is clipped at the first edge it reaches — and it is delegated from `document` and asks its source for HTML **only on hover**, which is the same reason `lkSelect` leaves its options out until a select is touched: the Overview's mix form runs to 1,116 rows. It **re-places on scroll rather than hiding**, because hiding raced — scroll is dispatched on the next frame, so a pointer landing on a chip during a settling scroll had the card shown and instantly hidden again. `AmrSugChip` owns the chip and the card wording, and its sentences describe the evidence only, never what the surface did with it: the dialog pre-ticks its Confident rows and the Overview's form has no ticks at all. **The Overview's lookup editor now shows the chip it never had** — it had always shown the server's *answer* (a Category, a Strength) and never how sure it was — plus a red spine on `Low` rows, because a chip is 60px of a 900px row and *"which of these do I have to read"* is the whole question when the form opens on four figures of unmapped mixes. `.sugchip` was unscoped out of `.sugHost` to make that possible. **Checked** with `node --check` on all 30 script blocks and on `script.gs`, the classifier probed off the real code against parse cases (clean, retired brand, ECO compound, `65MA` typo, bare number, no code prefix) and a synthetic EXTRAS model, and both surfaces driven in Chromium: hover shows, the card escapes its scroll box, mouse-out / Escape hide, focus opens it, a resize re-places it, and nothing is injected by a mix name containing a literal `<script>`. |
| 2026-08-26 | **"All-in ASP" was a heading over a base-concrete line, and the cause was that one panel had two sources.** The Overview's *Month by month* chart took the live cross-report as an argument and overlaid its extras on the ASP line wherever it reached. That report carries the CURRENT data year only and **is not fetched at all in window mode** — `renderWinRmx` passed `null` — so on most spans the chart drew base concrete under an all-in heading, and on the spans where the report *did* reach, the line changed meaning halfway along and the step where it changed read as a price move. **The premise was already dead.** Extras and VAP became columns of the Ready-Mix fact table earlier the same day (`ex` / `va`, the fourth-dimension rewrite in the row above), so the monthly split is a local sum over the months the panel is already drawing — for any span the slider can reach, closed years included. `renderTrendPanel` takes `(line)` now and nothing else; `buildUpByYm`, which existed only to guess which calendar year the report's bare 1-12 months belonged to, is gone, and `histSpan` — its last caller — with it (§9: client-side grep is conclusive, and it had none). **Base and all-in are four lines, not one that switches.** Colour is the MEASURE (navy base, `--blue-40` all-in) and dash is the YEAR; the panel's own navy/light-blue convention is left untouched on the charts that still carry one measure, which is Aggregates and any Ready-Mix window whose books ship no extras tab. A month with no extras has **no** all-in point rather than one equal to base — `spanGaps:false`, so the gap is visible instead of the line quietly falling to base. The heading says which of the two is actually there. The build-up **stack** draws for any selection of twelve months or fewer (thirty-one stacked bars is a wall, and past a year the two lines carry the same story). **All-in PPI sits beside base PPI**, as `(ppiBase × baseASP_PY + ΔextrasVAP) ÷ allInASP_PY` — the like-for-like base $ move plus the real $ move on the two extra streams, over last year's all-in price. With no extras it collapses to `ppiBase` exactly, which is the test that says it is one arithmetic and not two. It is **deliberately not a second coverage-weighted index**: an extras row carries a plant and a material and no mix, so no pair of its own can ever clear the plant × mix coverage the pooled index runs on. **Ready-Mix fuel recovery no longer sits window mode out.** It bailed on the reasoning that a window is the cube's and these facts have no cube behind them — true, and beside the point: every RFSC row is `(plant, segment, year, month)`, so `rfuelWinSpan` filters them directly. What the window changes is how far the COMPARISON reaches: one export holds `cyYear` and `pyYear` and nothing older, so a window reaching back into `pyYear` — **which a rolling twelve months does by construction** — would be asking for `pyYear-1`. Those windows report this year and drop the prior-year columns and bars outright, rather than printing a column of dashes or a $0 PY rate that reads as a collapse. **The Aggregates surcharge starts at 2026 and now says so in one place.** `winFscOk` tested "window inside the newest book year", which is the right answer by accident and stops being right the moment 2026 closes — a 2026–2027 window is one the surcharge can answer in full. It is a date now, `FSC_FROM_YM = 202601`, and the **monthly** chart is clipped to it as well (it never was): summed over a month whose book has no surcharge columns the answer is a clean $0.00, on the same axis as real recoveries, and a real-looking zero says *the surcharge collapsed* rather than *nobody recorded it*. The chart draws its own months and its own labels, exactly as the build-up stack does, and a note names the first one. **Two notes came out on request**: the ASP build-up's *"Denominator for every row: … total concrete, not applied m³"* (the panel's sub line already says every row divides by the same total concrete m³ — the §7 rule it protects has not moved) and the trend panel's *"Monthly volume and revenue add up to the KPI strip above / Monthly PPI does not"* pair, which was boilerplate under every chart. **The half of that note that could be false is kept**: when the panel's span and the KPI strip's span genuinely differ it still says so, which is the fault it was written to catch. `node --check` clean on `script.gs` and on all 30 of `app.html`'s script blocks | ✅ |
| 2026-08-26 | **The Deck Builder's KPI Region was the one setting it kept on your own device, and the one view that needed its own could not be given one.** Reported from the page: *remove the local storage KPI*, and *for Southwest I can't select Land only or Docks only*. They are the same defect from both ends. The per-row Region dropdown wrote `pvKpiViewMap` in `localStorage` through `kpiPicker.choose()` → `AmrPvSlide.kpiRemember()`, and `kpiFor()` read that map between the shared scope and the workbook default — so **everything else Arrange saves is shared and this one thing was not**, and two people building from the same saved arrangement could publish different KPI numbers on the same slide with nothing on screen saying so. A region is not something you can see is wrong on a finished picture. It is gone: `KPI_MAP_KEY`, `kpiLoadMap`, `kpiSaveMap`, `kpiViewKeyFor`, `kpiRemember` and the `map` field of `kpiFor`'s return, whose only callers were the deck's two — the **Price & Volume page has its own independent copy** of that map (`KPI.map`, same key) for its own screen and is untouched. `kpiFor(vals, override, book)` now has two answers, both the same on every device. `dbPickKpi` went with it, and `spec.kpiSheet` with that: grep proves the per-row pin was **read in two places and assigned in none** since the shared scope arrived. The row's Region cell is a read-out captioned `Region · shared` or `Region · default`, because the fallback is the workbook's *first* region sheet — a real region nobody picked, the same shape that once put an Ontario region on a Manitoba slide — and that has to be readable rather than silent. **The second half is what removing the memory exposed**: the Region select was gated to `key === marketRung(sp)`, so Southwest Land and Southwest Docks — which read different region sheets from whole-market Southwest — had nowhere left to say so. The gate is `kpiRungOk()` now, market rung **or** refine rung; the ladder already carried `pv|Southwest|Land`, both `scopeLadder_` and `ladderFor` build it, and the server needed no change at all. The drawer's *— each person's own choice —* option was true only while the memory existed, so it names the real alternative instead (`arrKpiBelow()`: the rung below that chose one, or the workbook's first sheet). **Opening that rung for real exposed a third thing, in the half of the panel not being changed**: the strip's tick box read the rung's OWN entry (`!ke || ke.on !== false`), so a rung storing nothing drew a *ticked* box over a strip a broader rung had switched off — and ticking it wrote nothing at all, because `arrKpiPatch` collapsed "on with no region" to null against a hard-coded default instead of against **what the rung inherits**. Both now resolve the whole inherited entry (`arrKpiBelow`, first rung with a `kpi` key wins whole, exactly as `resolveScope_` does it), so a no-sheet entry is kept only for an `on` that differs and unticking the box under a broader rung's region no longer drops that region with it. No harness left to extend; the gate run was `node --check` on all 30 inline script blocks of `app.html`, extracted to `.js` paths | ✅ |
| 2026-08-27 | **The CPI card was missing on every fresh open of the Overview and appeared on the next selection change — the same figures, drawn twice, with nothing on screen to say why the second drawing had a card the first did not.** On a server pick (This month / Year to date) three panels get their CPI from the month cube and are painted by the server: the KPI strip through `serverCpi()`, the dimension table and the explorer through `joinCpi()`. `getOverview` and `getReport` come back seconds **before** the first month-block does, so all three ran at the one moment `cube()` had nothing to say — and nothing ran them again. `wireCube`'s listener has always ended `if(winMode()) renderActiveTab(); else renderTrendSoon();`: a **window** is re-rendered whole when a block lands, a server pick gets its **trend** repainted and never its panels. So the card waited for the next thing that happened to call `renderTab()`, which for most people was resetting a selection. `repaintServerCpi()` is the missing half — the strip, `renderDimPies()` and `renderExplorer()`, and **only** those: a window is already handled by the same listener, a cross-filter report carries Sold To and answers for its own CPI (see `joinCpi`), Ready-Mix carries no Sold To at all, and both painters are pure reads of `DIMS_CACHE` / `PM_CACHE`, so a landing block can never become a server call. **The trigger is the ANSWER, not the event.** The listener fires once per month-block and almost none of them change what the cube can say about the picked period, so repainting per block would rebuild four charts for nothing; `repaintServerCpiSoon()` compares `serverCpi('agg')` against what was last drawn and debounces 260 ms, the same as `renderTrendSoon`. `''` — the cube cannot stand in — is a value like any other there, so the card comes back **down** as readily as it goes up when the handles leave the pick. The memo is kept honest at the other end too: `renderTab()` clears it to `null` (unknown, so the next block re-evaluates) and the server-pick branch records what it actually drew, which is what stops a stale reading from an earlier pick suppressing a repaint the new one needs. **Ready-Mix is untouched and stays without the card**, as its own comment and the window painters already said. `node --check` clean on all 30 of `app.html`'s inline script blocks, extracted to `.js` paths | ✅ |
| 2026-08-27 | **All-in ASP (INC VA) did not tie to Qlik anywhere it appeared, and the reason was that three families of extras are not concrete revenue at all.** Reported against the RMX PPI book on HNS_SW / Jul-26 MTD: Qlik's `PPI (All IN)` prints CY **$200.43** and PY **$201.61**, this file printed **$202.03 / $204.45**, and *mix only* matched — which is the sentence that says where to look, because BASE and ALL-IN differ by exactly one thing. Reconciled off the uploaded workbook rather than reasoned about: the gap is **$87,490 CY / $163,139 PY**, and a search over every subset of the 19 `mat_prod_hier_3` groups in that slice returns **one** answer inside the tolerance Qlik's 2-dp printing allows (±$272 CY, ±$287 PY) — Conveyors/Pumps, Concrete Blocks and Yard-stone-sand sales, at $87,400 / $163,146. Taking them out lands on **$200.43 / $201.61 to the cent**, and on −0.6% rather than −1.2% for the ASP move. It triangulates: the SAP/USGAAP *Concrete Sales* KPI on the same page reads $10,920k / $11,585k against the reconstruction's $10,930k / $11,585k, and its *Total Revenue* − *Concrete Sales* gap ($109k / $172k) is the same order as the excluded money — SAP books pumping, blocks and yard sales as other revenue, so Qlik's concrete ASP never had them. **The key is `mat_prod_hier_3`, never the EXTRAS LOOKUP category**, and §7 says why: pumping is inside *Misc* beside minimum-load and afterhours charges that ARE concrete revenue, blocks and yard sales are inside *Other VAP* beside real admixtures. EXTRAS LOOKUP is still the one classification for TYPE — what it gains is its own `mat_prod_hier_3` column being READ (`buildLookups_`), because the month cube holds `mat_descr` and nothing else and both paths have to answer the same way. **One split, at the bundle** (`splitNonConc_` → `bundle.nonConc`), because eleven places sum `extras` / `assoc` and a per-caller filter is eleven chances to forget; `ovcRmxExtraTab_` keeps the same rows out of the parked history for the same reason, so the window-mode build-up and the period-mode one stay one arithmetic. **The 24-character truncation is the trap**: the raw tabs carry `7 : Yard-stone-sand sale`, EXTRAS LOOKUP carries `7 : Yard-stone-sand sales`, and the spacing around the colon differs between them — `rmxH3Key_` normalises the spacing and matches as a prefix either way with an 8-character floor, and the code before the colon is not unique on its own (`9` is Fuel Surcharge on one tab and Concrete Blocks on the other). **`CACHE_VER` v19 → v20 and `OVCUBE_SHAPE_VER_` v5 → v6**, the second for exactly the case its own banner was written for: the COLUMNS did not move, so a warm browser would go on drawing the old all-in ASP from IndexedDB against a fixed server, and every parked history file would keep replaying it. **Nothing is dropped silently** — `nonConc` rides the extras payload and the cross-report's ASP block, and the by-extra-type tables on the RMX page, the Product Segment slide and the Overview print the amount and the groups under themselves. **Four of the seven list entries are siblings, not measurements** (Conveying/Pumping, Resale Aggregates, Aggregates, Crushed Recycled Concrete — the same two families under other markets' codes); **R/M Truck Rental is deliberately left in** and a second Qlik slice from another market is what would settle it. Impact where it lands, all months pooled: HNS_SW −$2.22/m³ CY, North −$5.40, Saskatchewan −$7.44, Innocon −$0.01, Manitoba $0.00. Gate: `node --check` clean on `script.gs` and on all 30 of `app.html`'s inline script blocks; the rule itself extracted from `script.gs` and run under Node over all 38,031 extras/VAP rows of the real workbook — it catches the five groups that exist and nothing else, and reproduces Qlik's $200.43 / $201.61 exactly | ✅ |
