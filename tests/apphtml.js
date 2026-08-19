/* apphtml.js — read a merged region out of app.html, or a deleted file out of git.
 * ---------------------------------------------------------------------------
 * The client-side twin of scriptgs.js. Chunk 13 deleted the 20 legacy .html files,
 * and ten harnesses read one by name. They read one of two things now, and
 * which one they want is a real distinction rather than a detail:
 *
 *   module(name) / styleBlock(tag) / pageOf(id)
 *       a region of app.html — for a harness whose job is to check the CODE
 *       THAT SHIPS. `deckpath` walks the deck adapters; after the cutover the
 *       adapters are §E, so §E is what it has to walk. Pointing it at a git
 *       copy of Deck_PV.html would leave it testing a file nobody serves.
 *
 *   legacy(file)
 *       the deleted file, read out of GIT — for a harness whose job is to
 *       compare the merged app against the app it replaced. `pageparity` and
 *       `cssparity` need a second side, and there is no second side on disk.
 *       Point at a commit instead
 *       of a directory. regress.js and pvcheck.js used it too, from a directory
 *       staged BY HAND — which is what eventually killed them, see below.
 *
 * §E was byte-for-byte the files it came from, and modparity.js proved it until
 * a deliberate change landed inside a module and it retired, as its own header
 * said it should. legacy() stays, because pageparity and cssparity still need a
 * second side and git is where it is.
 *
 * WHEN THE LEGACY SIDE RETIRES. The moment a page is deliberately changed,
 * app.html stops being a port of anything and every legacy() comparison starts
 * failing for the right reason. Delete those harnesses then — do not weaken
 * them. Chunk 14 (page switching without reload) is the likely first one.
 *
 *     const { module: mod, legacy, styleBlock, pageOf } = require('./apphtml.js');
 *     mod('AmrSlide')            // the §E module's script block
 *     legacy('Page_Rmx.html')    // the deleted file, out of git
 *     REF=<commit> node tests/whatever.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const APP_PATH = path.join(REPO, 'app.html');
const APP = fs.readFileSync(APP_PATH, 'utf8');

/* The cutover's parent — the last commit where the 20 legacy .html existed. */
const REF = process.env.REF || '61b714c';

/* ------------------------------------------------------------------ legacy */
const cache = new Map();
function legacy(file) {
  if (cache.has(file)) return cache.get(file);
  let out;
  try {
    out = execFileSync('git', ['show', REF + ':' + file],
                       { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    throw new Error(
      'apphtml.js: cannot read ' + file + ' at ' + REF + '.\n' +
      '  It was deleted at the cutover and is read out of git. A shallow clone will not\n' +
      '  have the commit — `git fetch --unshallow` — or set REF to one that does.');
  }
  cache.set(file, out);
  return out;
}

/* A file the harness names by path. app.html and appsscript.json are on disk;
   everything else the script project used to contain was deleted at the cutover
   and comes out of git. Harnesses that splice pages together — resolving
   include('Shell') and the rest — swap their one `read` helper for this and keep
   every check they had. */
const ON_DISK = new Set(['app.html', 'script.gs', 'appsscript.json']);
function source(file) {
  if (ON_DISK.has(file)) return fs.readFileSync(path.join(REPO, file), 'utf8');
  return legacy(file);
}

/* ------------------------------------------------------- regions of app.html */
const blocksOf = src => [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const APP_BLOCKS = blocksOf(APP);

/* Each module's own opening line — a match on CODE, not on a banner comment
   somebody could copy without the body. */
const MODULES = [
  { name: 'AmrProgress',   open: 'window.AmrProgress = (function(){', from: 'Shell.html' },
  { name: 'AmrBoot',       open: 'window.AmrBoot = (function(){',     from: 'Shell.html' },
  { name: 'AmrFresh',      open: 'window.AmrFresh = (function(){',    from: 'Shell.html' },
  { name: 'AmrSlide',      open: 'var AmrSlide = (function(){',       from: 'SlideExport.html' },
  { name: 'AmrFuelExec',   open: 'var AmrFuelExec = (function(){',    from: 'Deck_Fuel.html' },
  { name: 'AmrCache',      open: 'window.AmrCache = (function(){',    from: 'Shell.html' },
  { name: 'AmrKpi',        open: 'window.AmrKpi = (function(){',      from: 'KpiShared.html' },
  { name: 'AmrCube',       open: 'window.AmrCube = (function(){',     from: 'Cube.html' },
  { name: 'AmrPvSlide',    open: 'var AmrPvSlide = (function(){',     from: 'Deck_PV.html' },
  { name: 'AmrSegSlide',   open: 'var AmrSegSlide = (function(){',    from: 'Deck_SEG.html' },
  { name: 'AmrTick',       open: 'window.AmrTick = (function(){',     from: 'Shell.html' },
  { name: 'AmrDeckSource', open: 'var AmrDeckSource = (function(){',  from: 'Deck_Sources.html' },
  { name: 'AmrRmxSlide',   open: 'var AmrRmxSlide = (function(){',    from: 'Deck_RMX.html' },
];
const MODULE_BY_NAME = new Map(MODULES.map(m => [m.name, m]));

/* One §E module's script block. Returns the block from its first line of CODE,
   so the caller gets the module and not app.html's banner above it — which is
   also what makes the text comparable with the source file's copy. */
function moduleSrc(name) {
  const m = MODULE_BY_NAME.get(name);
  if (!m) throw new Error('apphtml.js: ' + name + ' is not one of the §E modules: ' +
                          MODULES.map(x => x.name).join(', '));
  const hits = APP_BLOCKS.filter(b => b.includes(m.open));
  if (hits.length !== 1) {
    throw new Error('apphtml.js: found ' + hits.length + ' copies of ' + name + ' in app.html §E, ' +
      'expected 1.\n  app.html does not have the shape this helper expects. Run tests/merge.js.');
  }
  return hits[0].slice(hits[0].indexOf(m.open));
}

/* One style layer, by its banner: A1 A2 A3 A4 B. Returns the CSS, not the tag. */
const STYLE_BANNER = {
  A1: /§A1\s+TOKENS/, A2: /§A2\s+BASE/, A3: /§A3\s+COMPONENTS/,
  A4: /§A4\s+PAGE CSS/, B: /§B\s+SLIDE CSS/,
};
function styleBlock(tag) {
  const re = STYLE_BANNER[String(tag).replace(/^§/, '')];
  if (!re) throw new Error('apphtml.js: no style layer named ' + tag +
                           ' (have ' + Object.keys(STYLE_BANNER).join(', ') + ')');
  const hits = [...APP.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style\s*>/gi)]
    .map(m => m[1]).filter(b => re.test(b));
  if (hits.length !== 1) throw new Error('apphtml.js: found ' + hits.length + ' §' + tag +
                                         ' style blocks, expected 1. Run tests/merge.js.');
  return hits[0];
}

/* The §A4 rules belonging to ONE page, WITH THE PAGE SCOPE STRIPPED — which is
   the merged equivalent of reading a legacy page's own style block, because
   that block was unscoped. A harness that injects this into a synthetic
   document gets the rules it used to get; leaving the scope on would mean none
   of them applied, since a synthetic body carries no data-page.

   @media wrappers are preserved. Dropping them would silently flatten every
   breakpoint into the base layer. */
function pageCss(id) {
  const scope = new RegExp(
    '(?::where\\(\\s*)?body\\[data-page="' + id + '"\\]\\)?\\s*', 'g');
  const mine = sel => sel.includes('data-page="' + id + '"');

  /* Split the layer into top-level rules and @media groups. One level of
     nesting is all §A4 has; anything deeper would need a real parser. */
  const block = styleBlock('A4').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];

  const rulesIn = text => {
    const kept = [];
    for (const r of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sels = r[1].split(',').map(x => x.trim()).filter(Boolean);
      if (!sels.length || !sels.every(mine)) continue;
      const bare = sels.map(x => x.replace(scope, '').trim() || 'body').join(', ');
      kept.push(bare + '{' + r[2].trim() + '}');
    }
    return kept;
  };

  let rest = block;
  for (const m of block.matchAll(/@media([^{]+)\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
    const inner = rulesIn(m[2]);
    if (inner.length) out.push('@media' + m[1].trim() + '{\n' + inner.join('\n') + '\n}');
    rest = rest.replace(m[0], '');
  }
  out.unshift(...rulesIn(rest));
  return out.join('\n');
}

/* One page's <template> markup and its AMR.page() registration JS. */
function pageOf(id) {
  const tOpen = APP.indexOf('<template id="tpl-' + id + '">');
  if (tOpen < 0) throw new Error('apphtml.js: no template for page ' + id);
  const tpl = APP.slice(tOpen + ('<template id="tpl-' + id + '">').length,
                        APP.indexOf('</template>', tOpen));
  const rOpen = APP.indexOf("AMR.page('" + id + "'");
  if (rOpen < 0) throw new Error('apphtml.js: no AMR.page registration for ' + id);
  const js = APP.slice(rOpen, APP.indexOf('</script>', rOpen));
  return { tpl, js, css: pageCss(id) };
}

const whole = () => APP;

module.exports = { legacy, source, module: moduleSrc, styleBlock, pageCss, pageOf, whole,
                   MODULES, REF, REPO, APP_PATH };
