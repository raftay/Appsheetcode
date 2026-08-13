# tests/

Node harnesses for the parts of the suite that can be checked **without** Google access.

They exist because most of this project cannot be tested off-platform — anything touching
SlidesApp, DriveApp, CacheService or a spreadsheet needs the live deployment. What *can* be
checked is the pure client-side compute and render layer, and that is exactly where the Deck
Builder extraction work lives. These two harnesses are the regression gate for Phases 3–4.

Nothing here is uploaded to Apps Script. The repo root is a flat mirror of the script
project; this folder is not part of it.

## `regress.js` — the extraction gate

Runs the **pre-extraction** page code and the **post-extraction** shared module over the same
data model and diffs the HTML. The pass condition is byte-identical output.

This is the test that makes moving code out of a working page safe. Every phase that pulls a
page's builders into a shared include should extend it before touching the page.

Covers both fuel pages × three period modes × clean and edited state, where *edited* means
typed numeric overrides, a renamed label, and a hidden market — the paths the shared `ctx`
replaced, and the ones where a silent regression would only ever surface in somebody's
already-edited slide.

```bash
# stage the pre-change pages somewhere, then point the harness at them
mkdir -p /tmp/old
git show <commit-before-your-change>:Page_FuelSurcharge.html > /tmp/old/old_fsc.html
git show <commit-before-your-change>:Page_RmxFuel.html       > /tmp/old/old_rfsc.html
OLD_DIR=/tmp/old node tests/regress.js
```

The line ranges for the old files are in the `CASES` array — they bracket the state block
through the last exec builder. Re-check them against the commit you are diffing; they are
line numbers, and they move.

## `deckpath.js` — the deck's own path

Loads `Deck_Sources.html` then `Deck_Fuel.html` under jsdom with `google.script.run` stubbed,
and drives `AmrDeckSource.build(spec)` exactly as the Deck Builder's Render stage does.

Checks that the adapters register, that each recipe row yields a content block with
`contenteditable` stripped and the right period heading, that an unregistered source rejects
with a readable sentence rather than a stack trace, and that each backend is called **once**
across the two slides that share it.

```bash
npm install jsdom     # not vendored
node tests/deckpath.js
```

Add a case here for every new source id a phase registers.

## Also worth running

```bash
# every inline <script> in a page must parse — the house rule, and cheap
node --check <(sed -n '/<script>/,/<\/script>/p' Page_X.html)   # or the checkjs helper
```

`.gs` files need a `.js` extension before `node --check` will look at them.

Both harnesses take a synthetic model and need no Google access, so they run anywhere Node
does. Keep `tests/node_modules` out of git — the repo root must stay a clean mirror of the
Apps Script project.
