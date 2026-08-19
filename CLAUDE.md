# Amrize Commercial Suite — start here

## Before you do anything: read `PLAN.md`

**[`PLAN.md`](PLAN.md) is required reading at the start of every session, for every agent.**

Several agents work on this repo from different accounts with no shared memory. `PLAN.md` is
the only context they have in common: it carries the current project, the chunk each session
should pick up, the rules that stop two agents undoing each other, and a legacy hit-list of
things that look deletable and are not.

It also opens with a session-start and session-end protocol. Follow both. The end-of-session
half matters as much as the start: **a half-finished chunk with no note beside it is the most
expensive thing you can leave behind.**

Then read `README.md` §3 (the file map) and §7 (domain rules that must not drift).

## The branch

All merge work happens on **`merging-files`**. Never `main`, and no pull requests for it —
the branch is the review surface. `git pull` before you start; another agent may have moved
it since anyone last looked.

## What this repo is

A flat mirror of one Google Apps Script project. **The project is three files** — `script.gs`,
`app.html` and `appsscript.json` — with no folders, no build step and no package manager.
`tests/` is Node-only and is **not** part of the script project.

**The server file is `script.gs`, and renaming it back to `app.gs` breaks the project.** Apps
Script keys a file by its name *without* the extension, so `app.gs` and `app.html` would both be
the file `app` — the editor refuses the second, `clasp push` is rejected, and
`createTemplateFromFile('app')` stops being unambiguous. The HTML keeps the name `app`.

**Those three files are the whole application, and that is tested rather than asserted.**
`tests/threefiles.js` copies them into an empty directory, evaluates `script.gs` whole in one
scope, calls `doGet` for all twelve routes, checks the only file it ever asks `HtmlService`
for is `app`, and boots what it serves in real Chromium. Nothing else on disk.

**So everything else here is deletable, and here is exactly what deleting it costs.** The app
does not notice; you lose the ability to *check* it. `PLAN.md` is the record of why the code is
shaped this way and the traps that have already been paid for once each; `README.md` §7 is the
domain rules; `tests/` is the only proof available off-platform that a page still renders what
it rendered. The survival-critical half of `PLAN.md` — the scoping trap, the scriptlet trap, the
style-element trap, the one-global-scope rule, the symbol-table rule — is duplicated into the
headers of `script.gs` and `app.html`, deliberately, so that a copy of the three files carries its
own warnings. **What is not duplicated is the evidence**: every one of those rules is there
because something broke, and the account of what broke is in `PLAN.md`.

`.claspignore` is what stops `clasp push` uploading `tests/*.js` into the script project;
`.gitattributes` pins the three files to LF, which is the repo's most-repeated hazard.

The merge that got here is finished. Chunk 12 collapsed 16 `.gs` into `script.gs`; chunk 13 was
the cutover — `doGet` serves `app.html` for every route and the 21 legacy `.html` are gone.
Navigate both files by section banner (`Ctrl+F "§7"` in `script.gs`, `"§P rmx"` in `app.html`),
or by the original filename, which each region still carries as a `/* ---- RMX_Backend.gs ----`
locator.

- It is a standalone web app, not bound to a spreadsheet. Each page opens its own Google
  Sheet by id, resolved at call time.
- `doGet(e)` validates `?page=` against `APP_PAGES` and serves `app.html`, which mounts one
  `<template>` into `#appRoot`. The ten route names are unchanged from the nine-file era, so
  old bookmarks still work; an unknown one serves the landing page rather than mounting
  nothing. **Three lists must name the same ten pages** — `APP_PAGES`, §D's `AMR_PAGES` and
  the `§P` templates — and `tests/merge.js` check 10 is what holds them together.
- Apps Script evaluates every `.gs` into **one** global scope — which is why there is now
  only one. Entry points are still prefixed (`RMX_`, `PV`, `DECK_`, `TP_`, `IR`) and
  everything real still lives inside a namespace IIFE; the reasons outlived the file count.
- **The settings live at the top of each file, and the top of each file says where the rest
  are.** `script.gs` §1 holds `APP_CONFIG`, `OVERVIEW`, `DECK_CONFIG` and `DECK_RECIPE` — the
  sheet ids, tab names, markets, the deck template and folder, and which 43 slides the monthly
  pack contains; `app.html` §C holds `AMR_TUNABLES` — the slide frame and every page's
  whitespace defaults. Both banners also name the constants that deliberately stayed beside
  the code that reads them. Read those two banners before grepping for a number.
- `appsscript.json` carries an explicit `oauthScopes` array, which **replaces** Apps Script's
  automatic scope detection. Add a service, add its scope by hand — nothing warns you, the
  call just throws for every user. `APP_verifyPermissions()` (`script.gs` §4) catches it in one
  editor run.
- `appsscript.json` pins `executeAs: USER_DEPLOYING` — everything runs as the deploying
  account.

## Things that will bite you

- **`script.gs` and `app.html` are LF throughout — keep them that way.** The deleted files were
  mixed **three ways** (most `.html` CRLF, `Code.gs` LF, and two `.gs` carried a lone `\r` as
  a line terminator), and three harnesses still read them out of git. Never anchor a test on
  a spelled-out `\r\n`.
- **Most of this cannot be tested off-platform.** Anything touching `SlidesApp`, `DriveApp`,
  `CacheService` or a spreadsheet needs the live deployment. What *can* be checked is the
  client-side compute and render layer — that is what `tests/` is for. Run the relevant
  harnesses before and after touching a page; see `tests/README.md`.
- **`node --check` does not accept `.gs`.** Copy to a `.js` path first.
- **Apps Script runs every `<? … ?>` in an HTML file, comments included**, and its printing
  scriptlet HTML-escapes — so one written as an example in a comment breaks the render, and
  one printed into JavaScript can emit `&#39;` and kill the whole script block. Server values
  belong in a `<body>` data attribute. `node tests/merge.js` enforces both.
- **A style element's content is text until its closing tag.** Anything that leaks in is
  parsed as CSS, and CSS error recovery eats the rule after it without a word. §B shipped
  that way for three chunks because a builder split a file on a `<style` written in *prose*
  inside a comment. Same trap as the scriptlet one above, in the build direction — never
  write either tag as a literal when you mean to name it. `merge.js` check 9 is the gate.
- **Scoping a CSS rule is not a neutral transformation of it.** `body[data-page="x"] `
  narrows what a selector matches AND raises its specificity by an attribute selector, so a
  prefixed bare `th{}` can start beating shared `.class` rules the original lost to — that
  cost 673 computed values on Ready-Mix. Use `:where(body[data-page="x"])`, which adds no
  weight. And the page is not the document: `#appRoot` is a `<main>` between `<body>` and the
  page, so a bare `main{}` restyles the mount. `merge.js` check 8 covers reach,
  `tests/cssparity.js` covers weight.
- **When you delete code by anchored text, diff the symbol table, not just the syntax.** A cut
  that takes one function too many is still valid JavaScript. Chunk 12 lost `RMX_whoWins` that
  way — the anchor matched *uniquely*, `node --check` passed, every structural check passed,
  and the only thing that noticed was a before/after set difference of top-level names.
- **The year is DATA, not a setting — do not add a knob for it.** Every backend reads the
  current and prior year off the workbook's own column names ("2026 Vol", "#### Volume",
  "Total Revenue - ####") and sends `cyYear` / `pyYear` with the payload; every heading and
  title on every page prints what it was sent. Before chunk 23 four data contracts named the
  year and each failed **silently** on the first export of a new year — a full table of
  zeroes under a heading naming the year that had gone. `tests/yearroll.js` runs the suite
  against a 2031 workbook and is what keeps it that way; the only years left in `app.html`
  are the QlikView guides' sample rows, which illustrate a format and are meant to stay put.
- **A comment that says code is dead is not evidence either.** `OVERVIEW` carried a banner
  starting `NOT USED` for four chunks while `getOverview` read its market list on every single
  Overview load — the label came across from `Config.gs` in a verbatim merge, which is exactly
  how a wrong comment outlives the thing that made it wrong. Read the code, not the label.
- **Nothing gets deleted on a hunch.** Every removal needs a repo-wide grep proving zero live
  references, logged in the `README.md` session log with what proved it. "Looks unused" is
  not evidence — several things that look dead are load-bearing, and several things that look
  live are not. Both lists are in `PLAN.md`.
- **Verify documentation against the code before relying on it.** Repeated audits of
  `README.md` have each found real errors — stale identifiers, a documented object that never
  existed, counts that had drifted. If something here or there contradicts the code, the code
  wins; then fix the document.
