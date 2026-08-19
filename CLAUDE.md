# Amrize Commercial Suite — start here

## Read [`README.md`](README.md). It is the whole brief.

One document, because three documents describing one codebase is how the three of them drift
apart — and this repo has been bitten by that specifically, more than once. `PLAN.md` used to
carry the merge it described; that merge is finished, so its durable half is in `README.md`
and its narrative is in the git history.

The sections you will want first:

- **§3** the file map — what is in `script.gs`'s eleven sections and `app.html`'s eight, and
  how ten pages live in one HTML file.
- **§7** the domain rules that must not drift. Changing any of them changes numbers the
  business reconciles against Qlik.
- **§9** what must not be deleted, and what counts as proof that something is dead. In Apps
  Script a grep does not prove it.
- **§10** working conventions, and **§11** the session log — add a row at the end of any
  session that changed something.

## The branch

All work happens on **`merging-files`**. Never `main`, and no pull requests for it — the
branch is the review surface. `git pull` before you start; another agent may have moved it.

## What this repo is

A flat mirror of one Google Apps Script project. **The project is three files** — `script.gs`,
`app.html` and `appsscript.json` — with no folders, no build step and no package manager.
`tests/` is Node-only and is **not** part of the script project; `tests/threefiles.js` proves
that by running the whole application out of a directory holding only those three.

**The server file is `script.gs`, and renaming it back to `app.gs` breaks the project.** Apps
Script keys a file by its name *without* the extension, so `app.gs` and `app.html` would both
be the file `app` — the editor refuses the second, `clasp push` is rejected, and
`createTemplateFromFile('app')` stops being unambiguous.

Both files carry their own warnings in their banners, deliberately, so a copy of the three
files travels with them. What the banners do not carry is the **evidence** — every rule is
there because something broke, and the account of what broke is in `README.md` and in the
commit that made the change.

## The six that will bite you

Each is stated in full in `README.md`; these are the ones worth knowing before you touch
anything.

1. **`script.gs` and `app.html` are LF throughout.** A scripted edit must open with
   `newline=''`. `.gitattributes` pins them. `node --check` does not accept `.gs` — copy to a
   `.js` path first.
2. **Apps Script runs every `<? … ?>` in an HTML file, comments included**, and its printing
   scriptlet HTML-escapes. A style element's content is text until its closing tag, so a
   stray one is parsed as CSS and error recovery eats the next rule silently. Never write
   either tag as a literal when you mean to name it. `tests/merge.js` gates both.
3. **Scoping a CSS rule is not a neutral transformation of it** — it raises specificity. Use
   `:where(body[data-page="x"])`, which adds no weight.
4. **When you delete code by anchored text, diff the symbol table, not just the syntax.** A
   cut that takes one function too many is still valid JavaScript.
5. **A comment claiming code is dead is not evidence, and neither is a grep.** Read the code,
   and check the trigger list and the function's own comment before deleting anything.
6. **Never name a period back at a column header.** `2026 Volume`, `CY Volume`,
   `Total Revenue - 2025` and `Total Revenue -PY` are all live and both sides change without
   notice. Read a header through §3's `APP_period_` / `APP_yearCols_`, and take the current
   year off the **data** — the Year column, or a Bill Month. A lookup that names a period
   returns −1 the day it changes and the page publishes zeroes under correct headings.

## Most of this cannot be tested off-platform

Anything touching `SlidesApp`, `DriveApp`, `CacheService` or a spreadsheet needs the live
deployment. What *can* be checked is the client-side compute and render layer — that is what
the 24 harnesses in `tests/` are for. Run the relevant ones before and after touching a page;
`tests/README.md` says what each one claims.
