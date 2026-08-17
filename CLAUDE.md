# Amrize Commercial Suite — start here

## Before you do anything: read `PLAN.md`

**[`PLAN.md`](PLAN.md) is required reading at the start of every session, for every agent.**

Several agents work on this repo from different accounts with no shared memory. `PLAN.md` is
the only context they have in common: it carries the current project (collapsing 37 Apps
Script files into one `app.html` + one `app.gs`), the chunk each session should pick up, the
rules that stop two agents undoing each other, and a legacy hit-list of things that look
deletable and are not.

It also opens with a session-start and session-end protocol. Follow both. The end-of-session
half matters as much as the start: **a half-finished chunk with no note beside it is the most
expensive thing you can leave behind.**

Then read `README.md` §3 (the file map) and §7 (domain rules that must not drift).

## The branch

All merge work happens on **`merging-files`**. Never `main`, and no pull requests for it —
the branch is the review surface. `git pull` before you start; another agent may have moved
it since anyone last looked.

## What this repo is

A flat mirror of one Google Apps Script project. Every `.gs` and `.html` at the root is one
file in the script editor — no folders, no build step, no package manager. `appsscript.json`
is the project manifest and is tracked; `tests/` is Node-only and is **not** part of the
script project.

- It is a standalone web app, not bound to a spreadsheet. Each page opens its own Google
  Sheet by id, resolved at call time.
- `doGet(e)` maps `?page=` to an HTML file. Nine routes plus a landing page.
- Apps Script evaluates every `.gs` into **one** global scope, so entry points are prefixed
  (`RMX_`, `PV`, `DECK_`, `TP_`, `IR`) and everything real lives inside a namespace IIFE.
- `appsscript.json` pins `executeAs: USER_DEPLOYING` — everything runs as the deploying
  account.

## Things that will bite you

- **Do not flip a file's line endings.** The repo is mixed: most `.html` are CRLF, some `.gs`
  are LF. Scripted edits must open with `newline=''` and write back what was already there,
  or a two-line change shows up as a whole-file diff.
- **Most of this cannot be tested off-platform.** Anything touching `SlidesApp`, `DriveApp`,
  `CacheService` or a spreadsheet needs the live deployment. What *can* be checked is the
  client-side compute and render layer — that is what `tests/` is for. Run the relevant
  harnesses before and after touching a report page; see `tests/README.md`.
- **`node --check` does not accept `.gs`.** Copy to a `.js` path first.
- **Nothing gets deleted on a hunch.** Every removal needs a repo-wide grep proving zero live
  references, logged in the `README.md` session log with what proved it. "Looks unused" is
  not evidence — several things that look dead are load-bearing, and several things that look
  live are not. Both lists are in `PLAN.md`.
- **Verify documentation against the code before relying on it.** Repeated audits of
  `README.md` have each found real errors — stale identifiers, a documented object that never
  existed, counts that had drifted. If something here or there contradicts the code, the code
  wins; then fix the document.
