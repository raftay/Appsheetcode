# Amrize Commercial Suite — start here

## Read [`README.md`](README.md). It is the whole brief.

The sections you will want first from the readme:

- **§3** the file map — what is in `script.gs`'s eleven sections and `app.html`'s eight, and
  how ten pages live in one HTML file.
- **§7** the domain rules that must not drift. Changing any of them changes numbers the
  business reconciles against Qlik.
- **§9** what must not be deleted, and what counts as proof that something is dead. In Apps
  Script a grep does not prove it.
- **§10** working conventions, and **§11** the session log — add a row at the end of any
  session that changed something.

## What this repo is

A flat mirror of one Google Apps Script project. **The project is three files** — `script.gs`,
`app.html` and `appsscript.json` — with no folders, no build step and no package manager. The
repo now holds nothing else that runs: the Node harnesses that used to sit in `tests/` were
removed on 2026-08-25 and are recoverable from git history if they are ever wanted back.

**So the checks are the ones in the code.** `node --check` on a copy of `script.gs` at a `.js`
path is the syntax gate; `APP_verifyPermissions` (§4) is the runtime one, and it is the thing
to run in the editor after any change to the sync, the triggers or `appsscript.json`.

**The server file is `script.gs`, and renaming it back to `app.gs` breaks the project.** Apps
Script keys a file by its name *without* the extension, so `app.gs` and `app.html` would both
be the file `app` — the editor refuses the second, `clasp push` is rejected, and
`createTemplateFromFile('app')` stops being unambiguous.

Both files carry their own warnings in their banners, deliberately, so a copy of the three
files travels with them. 

## The six that will bite you

Each is stated in full in `README.md`; these are the ones worth knowing before you touch
anything.

1. **`script.gs` and `app.html` are LF throughout.** A scripted edit must open with
   `newline=''`. `.gitattributes` pins them. `node --check` does not accept `.gs` — copy to a
   `.js` path first.

