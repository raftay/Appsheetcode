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
  lone `\r` as a line terminator), and three harnesses still read them out of git. A scripted
  edit that touches historical text must open with `newline=''`. `.gitattributes` pins the
  three project files.
- **Most of this cannot be tested off-platform.** Anything touching `SlidesApp`, `DriveApp`,
  `CacheService` or a spreadsheet needs the live deployment. What *can* be checked is the
  client-side compute and render layer — that is what `tests/` is for. Run the relevant
  harnesses before and after touching a page; see `tests/README.md`.
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
different accounts, the pages serve one account's Drive while `qlikSyncCheck` writes from
another's and `inventoryReportMailCheck` reads another's mail. **Create both triggers from the
account that deployed the web app**, and if you are ever unsure which one that is,
`APP_verifyPermissions()` prints the effective user — run it from the editor, and read the
`ran` line of a trigger's own execution log to see who a firing actually ran as.

**Its `oauthScopes` array replaces Apps Script's automatic scope detection.** Add a service,
add its scope by hand — nothing warns you, the call just throws for every user.
`APP_verifyPermissions()` (`script.gs` §4) catches it in one editor run, reporting one line
per service rather than dying on the first failure, so a missing grant cannot hide the other
six. Each of the eight scopes was traced to a real call:

| Scope | What needs it |
|---|---|
| `auth/spreadsheets` | `SpreadsheetApp.openById` — the project is not bound to a sheet, so the narrower current-document scope is no use |
| `auth/drive` | `DriveApp` get/create **and** the Drive v3 REST `files/copy` in §5 that converts a QlikView export. Full `drive`, not `drive.file`: the files were not created by this script |
| `auth/presentations` | `SlidesApp.openById` — the Deck Builder |
| `auth/script.send_mail` | `MailApp.sendEmail` — TP01. Still not a Gmail scope: it is the narrow "send mail as you" grant and it cannot read a mailbox. The read side is the next row, and the two are separate grants on purpose |
| `auth/gmail.readonly` | `GmailApp.search` / `getAttachments` — §10's Inventory Report mail watch, and nothing else. **Read-only deliberately**: the watch remembers which messages it has already published in a Script Property rather than labelling or archiving them, so `gmail.modify` is not needed and nothing ever writes to a mailbox. This is the widest grant in the list — it can read every message the deployer can — and it is here only because Gmail has no "one sender, one subject" scope to ask for instead.
The mailbox it reads is the **trigger creator's**, not the deployer's (§1). `APP_CONFIG.INVENTORY_MAIL.FROM` is the narrowing the project *can* do |
| `auth/script.external_request` | `UrlFetchApp` — the logo, and the Drive REST call above |
| `auth/script.scriptapp` | `ScriptApp.getService().getUrl()`, which every page link is built from. Included deliberately even though it may be reachable without it: if that URL comes back empty every link goes **relative**, and a relative href inside the Apps Script sandbox iframe resolves against `googleusercontent.com`, navigating the user off the app. That shipped once |
| `auth/userinfo.email` | `Session.getActiveUser().getEmail()` — who archived a KPI workbook, and the check's own report |

`CacheService`, `PropertiesService`, `LockService`, `Utilities` and `HtmlService` need no
scope. They are still checked and reported as `(none needed)` — a service that needs nothing
is a different fact from a service nobody remembered. `script.gs` §4's `CHECKS` array holds
the service → scope mapping in code beside the probe that proves it, so the table above and
the manifest cannot quietly drift apart.

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
| `tp01` | Transfer Price Tool | uploaded file + mail |
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
| §3 | **ROUTER + PLUMBING** — `doGet`, `getLogo`, the data-generation stamps, the chunked cache, the SB reader, and the **period helpers** (`APP_period_`, `APP_yearCols_`, `APP_periodMap_`) every header read goes through |
| §4 | **PERMISSIONS** — `APP_verifyPermissions()`. Read before adding a service |
| §5 | **SYNC** — the QlikView → Sheets engine |
| §6 | **AGG** — Price & Volume, its mapping check, AGG Fuel Recovery, Saskatchewan rates |
| §7 | **RMX** — Ready-Mix, its lookup suggester, RMX Fuel Recovery |
| §8 | **OVERVIEW** — the executive Overview and the month cube |
| §9 | **DECK** — the Slides template reader, the deck writer, the recipe checker |
| §10 | **SMALL PAGES** — KPI workbooks, TP01 mail, the Inventory Report and the mail watch that publishes it |
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
| §E | **SHARED MODULES** — fourteen: `AmrTick`, `AmrCache`, `AmrKpi`, `AmrCube`, `AmrDeckSource`, `AmrPvSlide`, `AmrProgress`, `AmrBoot`, `AmrFresh`, `AmrStamp`, `AmrSlide`, `AmrFuelExec`, `AmrSegSlide`, `AmrRmxSlide` |
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
  figures are out of date" poll.
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
  plus the typed `REGION LOOKUP` and `TOPLINE REV LOOKUP2` tabs.
- **Ready-Mix workbook** — `Main Raw Data`, `Extra Raw Data`, `Associate Raw Data`, plus
  `PLANT LOOKUP`, `PRODUCT MASTER`, `EXTRAS LOOKUP`, `CUSTOM FLAG LOOKUP`.
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

### Syncing: one trigger, and nothing else

**The sync is trigger-only by design and has no UI.** (This is one of the suite's *two*
time-driven triggers — the Inventory Report's mail watch, below, is the other. Neither is
created in code; both are set by hand in the Apps Script UI, which is why `script.gs` §11
exists.) There is no pull button and one is not
wanted — a sync is a minutes-long Drive job, not something to put behind a control a user can
press twice. Set **one** time-driven trigger on `qlikSyncCheck`; 15 minutes costs three Drive
lookups when nothing has changed.

`qlikSyncCheck` skips a source whose file has not moved since it was last synced.
**`qlikSyncNow` deliberately does not** — somebody running it by hand is there *because* the
sheet is wrong and the file did not move (a bad write, a header renamed in the workbook, a
cleared cache), so the trigger's optimisation must not reach them.

**Columns are paired on the figure and the period, never on the literal header** — see §7. The
sync writes data under the headers the workbook already has and never rewrites a header row,
so a new year's column has to exist there before anything can be written into it. Until it
does, the export's new column is reported unmatched rather than written somewhere wrong. There
is **no positional fallback**: one existed, and it is how PY revenue was written into the
wrong column for a whole run.

### What the sync owns

**The columns it pairs, from the first data row down. Nothing else on the tab.** Every other
column — a lookup, a helper, a filled-down formula, a block parked to the right — is read past
and left as it was, on every tab, whether or not the code knows it is there. **Assume one is
there.** (The Product Segment tabs are the exception and are in `'replace'` mode for it: they
are pre-aggregated by QlikView, the tab *is* the export, and the whole of it is rewritten. Do
not put a working column on one.)

It used to take more than that, and `tests/qliksync.js` gates it now:

- **The formula band was cleared whole** before the write and put back only after the *last*
  tab of the workbook — absent for the entire pass. One throw, or one execution killed at the
  runtime limit, and every anchor was deleted with nothing left to restore, and nothing for
  the next run to find either. That is why the Ready-Mix workbook lost array formulas and the
  Aggregates one never did on identical code: three tens-of-thousands-of-rows tabs reach the
  limit far sooner than two. Only a formula in a column the export *feeds* is cleared now — by
  construction the anchors are somewhere else, since `firstDataRow_` finds that row by looking
  for a formula in a column nothing is written into. Left alone, an anchor is at worst still
  pointing at the old height, which is the state re-anchoring exists to improve.
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
**QlikView delivers `.xls` and cannot deliver anything else, so this happens on every sync.**
`readExport_` does skip the copy for an export that is already a Google Sheet, but that is not
a route this pipeline can take.

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

### Per-page sheet overrides

A page's workbook can be repointed at runtime from its ⚙ panel, stored as a Script Property.
`APP_sheetOwner_` redirects a `readsFrom` page to the owning page's key, so a save through a
borrowing page cannot create an orphan; `clearRetiredOverrides()` deletes keys left behind by
a page that no longer owns a workbook. `tests/configcheck.js` is the gate.

### The Inventory Report publishes itself

**The second time-driven trigger, and the only other one.** Set one hourly trigger on
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
- **The month window anchors on the NEWEST month, and the server is asked for it.** "This
  month" means the latest month there is data for and "Prev month" the one before it. The
  server reports would otherwise land on the reporting month (last calendar month), so the
  page reported two months at once — on an August visit a server KPI strip read 2,266,577 t
  above a cube-fed table reading 1,067,541 t for the same selection, every market at −50% or
  worse. `getOverview` takes a `month` (in its cache key), the Overview passes
  `anchorMonth()`, and both halves answer for the same month. The first fetch runs before the
  cube exists and so asks for month 0 — the server's own default; when the cube lands and the
  anchor is known, a cache-first re-fetch brings the two into line.
- **The EBITDA workbook is a CLOSED-month statement, so its cards read `kpiMonth()`** — the
  month *before* the anchor — and say which month that is. It arrives during the month after
  the one it covers, so it can never answer for "this month"; moving the whole page back to
  meet it was the wrong half to move.
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
>    references them — there is not one `ScriptApp.newTrigger` in the codebase.
> 2. **Editor-run tools**, invoked by a human from the Run menu.
> 3. **`doGet`**, called by Apps Script itself.
>
> This is not hypothetical. An earlier draft of the merge plan described the sync's four entry
> points as having "no client caller" — true, and badly misleading: **`qlikSyncCheck` is the
> time-driven trigger that runs the entire QlikView → Sheets pipeline.** Deleting it on a
> zero-caller count would have silently stopped every page's data from updating again, and
> nothing would have errored.
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
| `qlikSyncCheck` | **Load-bearing.** The time-driven trigger target; the whole data pipeline runs through it |
| `qlikMarkCurrent` | Run once from the editor after the trigger is set up, so the first firing has stamps to compare. Needed again any time the trigger is rebuilt |
| `qlikSyncNow(scope)` | The only manual recovery path when the trigger misfires or a sync has to be forced |
| `qlikStamps` | A diagnostic worth having, and firmer than that: `tests/qliksync.js` exercises it in **three** checks. Deleting it fails a green harness |
| `clearRetiredOverrides` | Its own comment says "run from the Apps Script editor", and it is idempotent. An editor tool, not dead code |
| `getSaskRatesStatus` | Its comment says "so the Settings screen **(and a quick manual run)** can check the sheet" — that parenthetical is the editor-tool criterion. The Settings screen never calls it; wiring it would be a behaviour change, not a cleanup |
| `DECK_status` | A real deck build has still never run against the live deployment, and that is what decides whether the Publish stage needs it. **Do not delete before then** |
| `SB` · `getSlideData` | Live — the Overview's segment and product-category panels read them |
| `RMX_getCrossReport` · `getRmxUnmapped` · `uploadRmxData` · `getMarkets` · `getKeys` · `getExtras` · `syncData` | The **legacy-name wrappers**. Zero callers is not the test: they exist so a stale deployment still resolves, and removing one changes what that deployment does. `getMarkets` / `getKeys` / `getExtras` are exactly the generic names the `RMX_NS` capture protects against. Treat as its own piece of work |
| `doGet` | Apps Script itself is the caller |

**All seven debug functions are already gone**, and a repo-wide audit of every top-level
declaration found no others: every remaining callerless name is either a deliberate keep above
or was dead code rather than a diagnostic.

### Still worth auditing

- The CUSTOM FLAG LOOKUP path in the Ready-Mix suggester. The Product Segment page's own help
  text says neither Extras table groups on it any more.
- The legacy-name wrappers in the table above — find each caller, then decide as a unit.

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

28 Node harnesses in `tests/`. `npm install playwright chart.js jsdom` at the repo root gets
everything; Chromium is already at `/opt/pw-browsers`. Start with `tests/README.md` — it says
what each one claims and, for the comparison harnesses, exactly how much of that claim still
holds.

**When a comparison stops being wholly true, narrow what it claims to exactly what is still
provable and say so — do not soften the comparison itself.** `gsparity.js` and `modparity.js`
carried declared edits for exactly that reason while they lived: each deliberate change listed
with its rationale, every other byte still proved verbatim.

**And when the claim stops being true at all, delete the harness rather than weaken it.** Both
of those said so in their own headers, and both are now gone: the CY/PY header work changed
code inside moved regions of `script.gs` and `app.html` on purpose, so neither file is a copy
of anything and no version of those gates could pass honestly. What they protected — that a
region sliced out of either file is the code that actually runs — is protected now by the
harnesses that run that code.

**A gate whose second side has to be assembled by hand is a gate that stops running.**
`regress.js` and `pvcheck.js` were deleted for that: they wanted pre-extraction pages staged
into a directory from commits this repo no longer reaches, and the newest copies it does reach
delegate straight back to the modules under test — a comparison that passes whatever either
side does. `apphtml.js` stages from a *commit*, and still works.

**A harness that has never failed has not been tested.** Every gate here was mutation-tested
before being trusted — unscoping one rule for `merge.js`, renaming a column header and
disabling a click handler for `pageparity.js`, restoring the year literal for `yearroll.js`.
`pageparity.js` passed clean on its first run **for the wrong reason**: both sides had died
identically. That is exactly the bug this rule exists to catch.

**Add your page's case to `pageparity.js` before you touch the page**, so you find out on the
first run rather than the last. And **do not anchor a harness on a spelled-out line ending** —
that broke `rmxcost.js` once, and the failure read as though the code had moved.

**Nothing in `tests/` is uploaded to Apps Script.** `.claspignore` is what stops `clasp push`
carrying it into the script project.

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
| 2026-08-20 | **CPI published +206.7%, and the cause was a credit row.** A reversal is its own raw row \u2014 revenue, no volume \u2014 so netted into a pair it moves the dollars without moving the tonnes: it does not reduce a price, it destroys one. Plant `3P36` / Brock Aggregates / `9141` billed 47.04 t for $693.98 in March 2025 and took a $693.84 credit in April, leaving **fourteen cents against 47 tonnes** and a price "move" of **+492,409%** that carried 95.6% of \u03a3factor by itself. CPI's ASP now comes off **priced** revenue \u2014 revenue on rows that carried volume \u2014 which is how this data can express Qlik's own prior-year test (`_rev_base + _Enviro_Fees + _Govt_Fees + _disc_comp`, no `_credit_debit`, no `_rebate`). PPI is deliberately NOT given the rule: at plant \u00d7 material grain the credit is diluted, and its published figures reconcile as they stand. Written once per runtime and applied in all three. **The residual is stated, not tuned away**: 3.06% / 2.76% against Qlik's 2.95% / 2.67%, with an exhaustive search over grain \u00d7 revenue basis \u00d7 weight \u00d7 threshold finding nothing within 0.03pp of both, and the same harness reproducing every market's volume and revenue to the dollar | \u2705 |
| 2026-08-20 | **Every numeric axis rounds now.** Chart.js walks a scale by repeated addition and 14.8 + 0.2 is 15.000000000000002, so "ASP by month" printed sixteen digits of it; `headroom()` had fixed the bounds last session but not the ticks the chart makes out of them. `axFix()` takes its precision from the tick SPACING, so one helper serves dollars, tonnes and percentages, and every raw `'$'+v` callback is gone. Magnitude suffixes are deliberately not unified \u2014 volume axes read in thousands, money axes in millions, and both are what their readers expect | \u2705 |
| 2026-08-20 | **PPI and CPI share one chart, and the green is gone.** Colour is the SERIES, not the sign: one index drawn green-for-up borrowed a semantic the rest of the page spends on growth, and green is not in the palette at all. PPI takes navy and CPI the light blue, exactly as this year / last year do on every other paired chart in the panel. **Past twelve months \u2014 or in the oldest year the history holds \u2014 every same-period-last-year series is dropped**, the index chart with them, and the note says which of the two reasons applies. `pyAbsent()` is the new half: the 2023 chip selected a window where vs-last-year was blank everywhere at once, which reads as a broken page rather than as an absent prior year. The chip stays \u2014 the cube answers volume and revenue there perfectly well; it is the columns that go | \u2705 |
| 2026-08-20 | **CPI, calibrated against Qlik's own exports rather than reasoned at.** Five Cust Price Detail exports (2026 Jan\u2013Jul: all markets and each of GTA, SW, Manitoba, Saskatchewan) carry Qlik's per-pair Weight and Factor, and they settle two things the expressions alone did not. **The denominator is TotalWeight, not \u03a3Weight** \u2014 $136,727,744 against $123,520,166 on the all-markets export, a tenth apart, and summing covered CY revenue reproduces it to the dollar on all five. An outlier therefore keeps its weight and loses only its factor. **The threshold is 500%, not the \u00b150% the footnote states**: Qlik keeps pairs to |ASP%| 330% and zeroes from 647%, so anything in that gap reproduces its selection exactly (0.000pp on all five) while a 50% cap costs 1.26pp on SW alone. What remains \u2014 +0.02pp Manitoba, +0.03pp Saskatchewan, +0.28pp GTA, +0.33pp all markets, +0.59pp SW \u2014 is entirely `Weight` being a rebate-adjusted revenue the export nets away, ~0.82\u00d7 ex-Works on 2,788 of 3,117 kept rows with a per-row ratio, so no constant recovers it. The priced-revenue rule from earlier today is backed out: it was the right instinct about credits and the wrong mechanism, and PPI is bit-for-bit what it has always published | \u2705 |
| 2026-08-20 | **"This month" is the newest month again, and the server is asked for it.** The anchor had been moved to the reporting month to stop the page reporting two months at once; that fixed the disagreement by moving the wrong half. `getOverview` takes a `month` now (in its cache key) and the Overview passes its anchor, so the server-fed and cube-fed halves answer for the same month while "This month" keeps meaning the latest month there is data for. The EBITDA workbook is the one thing that genuinely belongs to the closed month, and it is handled where it is read \u2014 `kpiMonth()` is the anchor minus one, and the cards name it | \u2705 |
| 2026-08-21 | **The CPI exclusion was right and never arrived — a tunable that ships inside a cached payload.** The Overview published **+141.7%** for 2026 Jan–Aug against Qlik's 2.86%, and **+243.0%** for GTA against 2.48%, with `cpiOutlier: 5.0` sitting correctly in §1 the whole time. Replicating both August exports out of the raw sheet reproduces every published figure to the decimal **at threshold = 0** — MTD 2.79/2.31/3.52/1.61/6.36, YTD 141.72/242.97/14.36/2.85/5.95/6.22 — which names the fault exactly: §1 is read on the server, the **browser** does the pooling, so the number travels in the cube manifest and the cross-filter dataset, and every cache key in that chain is built from the DATA's generation. `cov.cpiOutlier || 0` then read the missing key as *no threshold at all*, and the browser's IndexedDB copy of that manifest is only wiped when the generation moves — so a warm device painted the pre-edit manifest indefinitely. **`ovcCovTok_` hashes the whole `COVERAGE` block into `ovcGen_`** (and into `getCrossData`'s key), so a floor edit is an invalidation; **a payload that cannot say what the exclusion is now reports NO CPI**, `null` not `0`, dropping the column exactly as a line with no Sold To does; and `revalidate()` writes the confirmed manifest back, which `adoptGen()` only ever did on a cold start. `tests/cpiindex.js` gates both halves off the real Brock Aggregates pair, mutation-tested both ways | ✅ |
| 2026-08-21 | **A stronger GATE for CPI, and the outlier cap retires.** A cap was always the wrong shape: it dropped a pair's factor and left its weight in the denominator — a dilution, where Qlik DELETES. `COVERAGE.cpi` is three floors now (`minVol` 1 t, `minRev` $1, `minAsp` $3.00/t) and a pair that fails leaves both sums. **The volume and revenue floors alone are a trap**: they take the Brock pair and look like a fix while SW Ontario still reads **14.36%**, because `3Q00` / JNF Ready Mix / `9055` sails through them — 378 t at $2.343/t last year against 24,593 t at $22.75/t this, +870.9%, carrying $559,436 of weight and +3.13pp of the index on its own. Nothing about it is small; only its PRICE gives it away, and $2.343/t is Ontario's rebate rate. So `minAsp` is the floor that matters, and it is the visible shadow of Qlik's net-revenue gate (rebate $2.248/t Ontario, $0.60 Manitoba, $0.90 Saskatchewan, nil on recycled). Calibrated on both August exports: Jan–Aug **141.719% → 6.248% (> 1 only) → 3.106%** against Qlik's 2.864%; Aug MTD **2.789% → 2.724%** against 2.646%. Costs three pairs Qlik keeps, worth $1,894 of $155.5M. Any floor from $2.50 to ~$3.90 gives the same answer; $4.00 starts eating bank sand at $3.97/t. `tests/cpiindex.js` carries BOTH bad pairs deliberately — one that the revenue floor catches and one that only the price floor does, so a half-fix cannot pass | ✅ |
| 2026-08-21 | **The 500% threshold is a guard, not Qlik's rule — and the last session's evidence for it was an accident of the window.** Qlik zeroes **10 of 3,407** covered pairs in 2026 Jan–Aug; five move by less than 100% and two by less than 5% (**+4.55%**, **+0.26%**), while it *keeps* pairs at −115.9%, +225.4% and, on the Aug MTD export, **+472.8%**. No |ASP%| threshold selects that set; the "330–647% gap" only looked like one because Jan–Jul held no counter-example. **What actually selects it: `Weight` is CY revenue net of the per-tonne aggregate levy, and Qlik's coverage runs on the net figure.** `(CY revenue − Weight) ÷ CY volume` lands on **$2.248/t Ontario, $0.60/t Manitoba, $0.90/t Saskatchewan, nil on recycled** across 3,397 pairs and both exports — 9 of the 10 zeroed pairs have a net-of-levy ASP at or below ten cents in one year. That column does not exist here, so the guard stays, and it costs **0.0001pp** against Qlik's own selection (3.0933% vs 3.0934%) and drops no pair Qlik keeps. **The denominator was never the problem**: Σ covered CY revenue reproduces `TotalWeight` to the penny on both exports ($155,497,057.14 and $13,041,331.22). The residual after the fix is **+0.23pp** all-markets — Qlik weighting the numerator net and dividing by gross, ~0.905× with a per-row ratio. Manitoba +0.01pp, Saskatchewan +0.04pp, North 0.00pp, because their levy is small or nil. Do not spend another session tuning the threshold | ✅ |
| 2026-08-21 | **Four field reports, and three of them were one bug wearing different clothes: a module that outlives the page that used it.** (1) **The AGG page loaded for ever until you refreshed.** `AmrCube` is a §E singleton and §D mounts ten pages into one document, so the second visit's `AmrCube.on()` listener met a cube whose `init()` had already run — it returned `Promise.resolve(false)` and emitted nothing, `AmrBoot`'s `month history` step was never answered, and `AmrProgress` is modal. A second `init()` is a **page switch**: `on()` replays the settled event to a late listener and returns an unsubscribe, `teardown()` calls `AmrCube.detach()`, and a line the first boot never fetched (PV configures `agg` alone; the Overview then wants `rmx`) is fetched now. `pageswitch.js` could not have caught it — its fixture answers `CUBE_getManifest` with `ok:false` and the **error** path does emit. (2) **Product Segment never once read its own device store.** `AmrCache.get()` is gated on `ready`, and the only thing that set `ready` was the reply to `RMX_prepare` — the call the store existed to avoid — so the store was **write-only for the life of the page** and every open paid the most expensive call in the suite to be handed back what was already there. `AmrCache.warm()` opens on the generation the device itself confirmed and `RMX_getStamp()` checks it behind the paint: `{generation, build}`, the same two fields under the same names as `prepareAll`'s `stamp()`, no sheet read. Not `getDataVersion('rmx')` — different pair, different shape, and §6 has the account of what two copies of one token cost. A warm open now costs one small call, and market and period switches cost **none**. (3) **Both fuel pages paint before the version call answers** rather than after it — same `warm()`, with `check()` returning whether the store survived and only a warm paint re-read. The version call is still issued FIRST, because `set()` will not write under a generation it does not know yet and sending the read first stored nothing at all. Measured at 800ms of stubbed latency: 1868ms → 905ms cold, **942ms → 31ms warm**. `ready` is per page now; it was one boolean across ten pages. (4) **The Ready-Mix UI at ≥1720px**: §A3 pins the QlikView guide open and hides the FAB that closes it, and the rule that carves the 288px names `.shell` — Ready-Mix lays out with `.wrap`, so the guide sat on top of the last 250px of every table, the ✓ matched pills and every per-card help button. One media query; also un-nested the Export theme `.field` that was a child of the N/A one. **`reopen.js` is the new gate and it asserts the thing a call count cannot see**: replies are held for a fixed latency and outstanding calls counted by name, so “a table is on screen while the version call has not come back” is an assertion. `APP_CODE_BUILD` bumped — the client now paints device entries before validating them, and one cold load per device buys the guarantee that every warm paint after this deploy came from a store this code wrote | ✅ |
| 2026-08-21 | **The Ready-Mix mapping warning shipped unstyled, and four more of chunk 6's drops were sitting beside it.** Reported as the sentence under a table name; what it was is seven CSS rules — `.impact`, `.impact-i`, `.impact-t`, `.impact-go` — left behind when `Page_Rmx.html` was ported. The page kept emitting the markup, so the `!` badge ran straight into the sentence as **"!339 products"** and "Fix mapping" was a browser-grey UA button inside the text. **Three things had to be true at once for no gate to see it, and they were:** `setStrip()` builds the strip in JS, so no markup check ever meets the class; **no fixture in `tests/` answers `RMX_getUnmapped` with a row**, so the strip renders in no harness run; and `cssparity` derives its property list *from* the §A4 block, so a missing block's properties are not on the list. Four more came out of the same audit. **`#mapHost td.mkt` went too**, so the page's own `td{text-align:right; white-space:nowrap}` took the Market(s) column — right-aligned, and a list of markets that will not wrap. **Two classes were renamed by the promotion and only one caller was told**: §A3 took Price & Volume's `mchev` and `map-open`, Ready-Mix went on emitting `chev` and `sug-open`, so its mapping-check arrow fell through to the generic 10px `.chev` and **never rotated** — an open section looked exactly like a shut one — and the page behind the suggested-rows dialog kept scrolling. A promoted rule is only shared if every caller uses the promoted NAME. **And the strip was disappearing on every re-render**: `if(window.paintImpact) paintImpact()` was a page function asking whether it existed, which on `Page_Rmx.html`'s file scope was always yes and inside a page module is always no. Measured: 3 strips to 0 on one period click, and no way back but a reload. `tests/cssdropped.js` is the new gate — for every class the 20 deleted files styled, if `app.html` still emits it and has no rule, the port dropped it. 717 classes, **no allow-list**, mutation-tested by putting the block back in the bin. `cssparity`'s EXPAND gained `border-color` because the restored `.impact-go:hover` declares it, and its run is 50 properties to 52 | ✅ |
| 2026-08-23 | **The sync was deleting columns it does not own, and the header now says how old the figures are.** Reported as "pulling RMX from Qlik deletes my array formulas on Main and Extras, and the Aggregates sheets keep theirs" — and the two workbooks go through **the same writer**, so the difference was never in the code, it was in how far the code got. `writeColumns_` cleared the WHOLE formula band before writing and put it back only after the LAST tab of the workbook, so the anchors were absent for the entire pass: one throw, or one execution killed at the runtime limit, and they were gone with nothing left to restore — and nothing for the next run to find either, which is why they never came back on their own. **Three tens-of-thousands-of-rows Ready-Mix tabs reach that limit far sooner than two Aggregates ones**, and that is the whole of the difference. Only a formula in a column the export FEEDS is cleared now — by construction the anchors are elsewhere, since `firstDataRow_` finds that row by looking for a formula in a column nothing is written into — and the band is registered for restore BEFORE anything destructive runs. **Rows point the other way and stay as they were**: the data ends exactly where the export ends, surplus deleted, because nothing on these tabs is filled down — every formula is a single-cell array formula on the first data row — and leaving them would have January reading a December-sized sheet for eleven months. `tests/qliksync.js` carries a column the sync has never heard of and makes a write blow up to prove the anchors are still on the sheet afterwards; the whole-band clear and a full-width block clear were both put back to watch it fail. **And the header answers the other question.** ↻ Update from source says whether anything is NEWER; it has never said how old what you are looking at IS. `AmrStamp` (§E) is its own control beside it, injected into every header that has one the way the page switcher is, showing **two clocks that must never be collapsed into one**: when the workbook last changed, and when QlikSync last wrote it (plus the date on the export it read). The second is recorded by the run, because **Drive cannot tell a sync from a hand edit** — a row typed into REGION LOOKUP moves the modified time exactly as a sync does. `freshness.js` gates precisely that: a hand edit moves the sheet clock and leaves the QlikView clock where it was. The bar had **seven pixels** of slack on Price & Volume at 1720, so the stamp gives up its date for its age below `--bp-wide` and its frame with it; four pages lose one breakpoint step and three lose nothing, measured and written into §A3. **And the Slide Builder is Product Segment now** — one line away from "Deck Builder" it read as a second deck tool, and it is not one. Renamed in prose across `script.gs`, `app.html` and both READMEs; the workbook's own TAB names (`Slide Segment MTD`, `Slide Product <Market> MTD`) and the `SB` namespace keep the old spelling on purpose, the first because the sync matches tabs by name and the second because it is a rename across every call site for no reader's benefit — both now say so where they live. One stale comment fell out of it: the SEG folder's SPEC block was headed "RMX folder" | ✅ |
| | **`APP_verifyPermissions()` has never been run.** Needs somebody in the Apps Script editor; nothing off-platform can exercise `SpreadsheetApp`, `DriveApp`, `SlidesApp` or `MailApp` | ☐ |
| | **No real deck has been built against the live deployment.** Every adapter is registered and the path is exercised offline, but `DECK_create` / `addSlide` / `finish` have never run. `DECK_status` is kept until that build says whether Publish needs it | ☐ |
| | **One look at the Price & Volume sheet:** whether it carries any parenthesised negatives decides only whether anyone notices chunk 20 — a no-op if it has none, correctly counted figures if it has some | ☐ |
