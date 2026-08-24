/* scriptgs.js — read one merged region out of script.gs.
 * ---------------------------------------------------------------------------
 * Chunk 12 merged the 16 .gs files into one script.gs and deleted them. Seven
 * harnesses used to read a .gs file by name; they read a REGION of script.gs now,
 * and this is the one place that knows how to find one.
 *
 * Why regions rather than just loading the whole file: several of these
 * harnesses assert on source text — "PV takes its generation from the sheet",
 * "no local header-is-row-1 reader is back in PV_Lookup". Run against the whole
 * of script.gs those regexes match if ANY of the eleven sections satisfies them,
 * so a check that used to pin one backend would quietly start passing because
 * a different one happens to contain the pattern. Slicing keeps every one of
 * those assertions exactly as sharp as it was.
 *
 * The regions were byte-for-byte the files they came from, and gsparity.js
 * proved it until a legitimate change landed inside one and it retired, as its
 * own header said it should. What still holds is the shape this relies on: one
 * `/* ---- <name>.gs -` banner per region, in ORDER, each running to the next
 * §-section banner. Move one and the throw below names it.
 *
 *     const { region, whole, load } = require('./scriptgs.js');
 *     region('PV_Backend.gs')          // the merged text, minus its banner
 *     load(ctx, 'Config.gs')           // …evaluated into a vm context
 *
 * ONE REGION IS NO LONGER ONLY ITS FILE. Chunk 22 moved DECK_CONFIG and
 * DECK_RECIPE — the deck's two config objects — from §9 to the end of §1, so
 * region('Config.gs') is Config.gs *plus* those two declarations. A caller
 * wanting DECK_RECIPE asks for 'Config.gs'; one wanting DECK_getRecipe still
 * asks for 'Deck_Recipe.gs' (tests/deckstatic.js loads both, which is what the
 * one-global-scope runtime does anyway). A region ends at the next SECTION
 * banner, so the block cannot leak past §1.
 *
 * A REGION THAT IS NOT IN THIS LIST IS NOT MISSING, IT IS SWALLOWED. The walk
 * finds each banner in ORDER sequence and a region runs to the NEXT ONE LISTED,
 * so an unlisted banner in between just becomes part of the region before it —
 * silently, and with the harness still passing. That is how region('IR_Backend.gs')
 * came to include IR_MailWatch.gs, which is still true and still deliberate:
 * nothing wants the mail watch on its own. TP01's three new regions ARE listed,
 * because tp01engine.js and tp01xlsx.js each want exactly one of them.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const APP = fs.readFileSync(path.join(REPO, 'script.gs'), 'utf8');

/* The merged files, in the order they appear. QlikSync.gs is listed twice —
   the engine in §5, its trigger and editor entry points in §11 — so callers
   that want one half pass an index; region('QlikSync.gs') joins both, which is
   what a harness that used to read the whole file wants. */
const ORDER = [
  'Config.gs', 'logging.gs', 'Code.gs', 'permissions.gs', 'QlikSync.gs',
  'PV_Backend.gs', 'PV_Lookup.gs', 'FSC_Backend.gs', 'Sask_Backend.gs',
  'RMX_Backend.gs', 'RMX_Suggest.gs', 'RFSC_Backend.gs', 'Ov_Backend.gs',
  'Deck_Backend.gs', 'Deck_Recipe.gs', 'Kpi_Backend.gs', 'TP01_Backend.gs',
  'TP01_Engine.gs', 'TP01_Xlsx.gs', 'TP01_MailWatch.gs',
  'IR_Backend.gs', 'QlikSync.gs',
];

/* Walk the file once, finding each region's banner in ORDER sequence. The
   sources carry their own `/* ---- … ` rules, so a bare search would hit those
   too; anchoring on the filename and walking forward in order cannot. */
const SPANS = [];
{
  let from = 0;
  for (const file of ORDER) {
    const marker = '\n/* ---- ' + file + ' -';
    const at = APP.indexOf(marker, from);
    if (at === -1) throw new Error('scriptgs.js: no banner for ' + file + ' after offset ' + from +
      '\n  script.gs does not have the shape this helper expects.');
    const bodyAt = APP.indexOf('*/\n', at);
    if (bodyAt === -1) throw new Error('scriptgs.js: unterminated banner for ' + file);
    SPANS.push({ file, start: bodyAt + 3 });
    from = bodyAt;
  }
  /* A region runs to the next region's banner, less any SECTION banner sitting
     between the two. Matching that separator has to be exact: the sources carry
     plenty of their own `/* ===== ` rules and several end with one, so a loose
     search truncates the region at the file's own last banner instead. PV,
     PV_Lookup and RMX_Suggest each lost their `top-level wrappers` block to
     exactly that before this pattern was pinned to the builder's own shape —
     76 equals signs, then a ` * §<n>` line, which nothing in the sources has. */
  const SECTION = /\n\/\* ={76}\n \* §\d/;
  for (let i = 0; i < SPANS.length; i++) {
    const hardEnd = (i + 1 < SPANS.length)
      ? APP.lastIndexOf('\n/* ---- ' + SPANS[i + 1].file + ' -', SPANS[i + 1].start) + 1
      : APP.length;
    const between = APP.slice(SPANS[i].start, hardEnd);
    const m = SECTION.exec(between);
    SPANS[i].end = m ? SPANS[i].start + m.index + 1 : hardEnd;
  }
}

function spansFor(file) {
  const hits = SPANS.filter(s => s.file === file);
  if (!hits.length) throw new Error('scriptgs.js: ' + file + ' is not one of the merged files');
  return hits;
}

/* The merged text of a file. `which` picks one half of a split file. */
function region(file, which) {
  const hits = spansFor(file);
  const use = (which == null) ? hits : [hits[which]];
  return use.map(s => APP.slice(s.start, s.end)).join('\n').replace(/\s+$/, '') + '\n';
}

/* Evaluate one or more regions into a vm context, in the order given.
 *
 * APP_log IS INSTALLED FIRST, AND THAT IS MODELLING RATHER THAN CONVENIENCE.
 * Apps Script evaluates every .gs into ONE global scope — the whole reason this
 * file exists — so script.gs §2's helper is reachable from every other section at
 * run time. A harness that slices out one region and does not provide it is
 * modelling the scope wrongly, and chunk 18 is where that stopped being
 * theoretical: the moment a moved backend gained a log line, three harnesses
 * died on "APP_log is not defined" — a failure that reads like a broken build
 * and is a missing global.
 *
 * It RECORDS rather than discarding, so a harness that wants to assert on what
 * was logged can read ctx.__log without arranging anything. Nothing is printed:
 * a harness's output should be its own checks.
 */
function load(ctx, ...files) {
  attach(ctx);
  for (const f of files) vm.runInContext(region(f), ctx, { filename: 'script.gs (' + f + ')' });
  return ctx;
}

/* §3's shared header helpers — APP_hdrNorm_, APP_period_, APP_yearCols_ and the
   rest — sliced out of script.gs. They sit between the §3 banner and the first
   merged file's banner, so they belong to no region and a harness that loads
   one region alone would not have them. In Apps Script it would: one global
   scope, every section can see them. Same argument as APP_log below. */
function sharedSource() {
  const at = APP.indexOf('\n * §3  ROUTER + PLUMBING');
  if (at === -1) throw new Error('scriptgs.js: no §3 banner in script.gs');
  const from = APP.indexOf('*/\n', at);
  const to   = APP.indexOf('\n/* ---- ', from);
  if (from === -1 || to === -1) throw new Error('scriptgs.js: §3 has lost its shape');
  return APP.slice(from + 3, to);
}

/* Built once and copied by reference. The helpers close over nothing but their
   own definitions, so a function made here works in any context it is handed
   to — which is what lets attach() run before vm.createContext as well as
   after. */
const SHARED = (() => {
  const box = { console };
  vm.createContext(box);
  vm.runInContext(sharedSource(), box, { filename: 'script.gs (§3 shared)' });
  const out = {};
  for (const k of Object.keys(box)) if (k.startsWith('APP_')) out[k] = box[k];
  return out;
})();

/* For harnesses that build and run their own context rather than going through
   load(). Call it before vm.createContext. */
function attach(ctx) {
  for (const k in SHARED) if (!ctx[k]) ctx[k] = SHARED[k];
  if (!ctx.APP_log) {
    ctx.__log = [];
    ctx.APP_log = function (level, where, msg, data) {
      ctx.__log.push({ level: level, where: where, msg: msg, data: data || {} });
    };
  }
  return ctx;
}

const whole = () => APP;

module.exports = { region, load, attach, whole, shared: () => SHARED, ORDER, REPO,
                   APP_PATH: path.join(REPO, 'script.gs') };
