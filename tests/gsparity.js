/* gsparity.js — app.gs still holds each of the 16 .gs files, verbatim.
 * ---------------------------------------------------------------------------
 * Chunk 12 merged 10,889 lines of working backend into one file. The argument
 * that made that safe was that it is a MOVE — ordered concatenation, no
 * renaming, no reconciliation (PLAN.md §5, and the zero-collision audit in
 * §1a). This harness is what turns that argument into something checkable.
 *
 * It reads the 16 originals out of GIT rather than off disk, because chunk 12
 * deleted them in the same commit that added app.gs — they cannot coexist in an
 * Apps Script project (PLAN.md §2). That is the same staging trick regress.js
 * and pvcheck.js already use, just pointed at a commit instead of a directory.
 *
 *     node tests/gsparity.js            # no dependencies
 *     REF=<commit> node tests/gsparity.js
 *
 * WHAT IT CHECKS
 *   1. every source file appears in app.gs verbatim, after the edits declared
 *      in EDITS below and nothing else;
 *   2. the sections appear in the PLAN.md §5 order;
 *   3. the top-level name set changed by EXACTLY the declared deletions and
 *      additions — this is the check that earns its place, see below;
 *   4. no top-level name is declared twice (one global scope, last one wins,
 *      silently — the whole reason this file is one file);
 *   5. LF throughout, per PLAN.md §12.
 *
 * WHY CHECK 3 EXISTS. The build's anchored cuts each have to match exactly
 * once, which sounds like enough and is not. The RMX_debugMonths cut ran from
 * its banner to the first `  return s;\n}` after it — and RMX_debugMonths does
 * not end that way, RMX_whoWins does. The cut matched, uniquely, and quietly
 * took RMX_whoWins with it: a function the Ready-Mix page names by name in its
 * own error banner, telling users to go and run it. Nothing else noticed. A
 * before/after diff of the top-level names named it immediately.
 *
 * WHEN TO RETIRE THIS. The moment a legitimate change lands inside a moved
 * region, app.gs stops being a copy of anything and this harness starts failing
 * for the right reason. It is the server-side twin of modparity.js and has the
 * same end of life: keep it while app.gs is still provably the 16 files, delete
 * it — do not weaken it — when it is not. Until then it is the only proof that
 * a half-million-byte concatenation did not corrupt anything in the middle.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
/* The merge parent: chunk 11, the last commit where the 16 .gs still existed. */
const REF = process.env.REF || '4d8ee5d';

let fails = 0;
function check(what, cond, detail) {
  if (cond) { console.log('  ok    ' + what); return; }
  fails++;
  console.log('  FAIL  ' + what + (detail ? '\n        ' + detail : ''));
}

/* Line endings: the repo is mixed — 15 of the 16 .gs were CRLF, Code.gs was LF,
   and FSC_Backend.gs and RFSC_Backend.gs each carried one LONE CR used as a
   line terminator (old-Mac style, between cPut_ and cachedRead_). All three
   forms normalise to LF, which is what PLAN.md §12 pins app.gs to. */
const lf = s => s.replace(/\r\n?/g, '\n');

const gitShow = f => lf(execFileSync('git', ['show', REF + ':' + f],
  { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 }));

/* ===========================================================================
 * The complete list of every edit chunk 12 made to the merged sources.
 * Anything not declared here must be byte-for-byte what it was.
 * ======================================================================== */
const EDITS = {
  'Config.gs': [
    { kind: 'insert', why: 'PLAN §7 — the server half of the LOG_LEVEL switch.',
      after: "  PROP_PREFIX: 'DATA_SPREADSHEET_ID__',\n",
      text: `
  /* How much the server logs. One of 'debug' | 'info' | 'warn' | 'error', or
     'off'. Read fresh on every APP_log call, so changing it here takes effect
     on the next execution with nothing to redeploy. See app.gs §2.
     'info' is the production setting: entry points and phase boundaries, and
     every error with its context. 'debug' adds the detail you only want while
     something is being investigated. */
  LOG_LEVEL: 'info',
` },
  ],

  'Code.gs': [
    { kind: 'rewrite', gone: [], added: ['APP_PAGES'],
      why: 'CHUNK 13, THE CUTOVER. doGet used to map nine ?page= values onto nine HTML files ' +
           'and carry a tenth, ?page=app, for the merged client while it was being built. ' +
           'There is one client file now, so there is nothing to pick: every route serves ' +
           'app.html and doGet only decides which page name to hand it. ?page= keeps the same ' +
           'nine values on purpose — a bookmark from before the merge still lands where it did ' +
           '— and an unknown one falls back to the landing page rather than mounting nothing, ' +
           'because app.html leaves #appRoot empty for a name it has no registration for and a ' +
           'blank screen reads as an outage. APP_PAGES is the new top-level name; ' +
           'tests/merge.js check 10 holds it and app.html\'s switcher to the same list.',
      from: 'function doGet(e) {\n',
      to: '    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);\n}',
      text: `/* Every route serves app.html. There is one client file and it mounts ONE page,
   chosen by <body data-page> — so doGet's whole job is to decide which page name
   to hand it, and there is no file to pick any more.

   ?page= is unchanged from the nine-file era on purpose: the same nine values
   reach the same nine screens, so a bookmark, a shared link or a browser history
   entry from before the merge still lands where it did. The ?page=app scaffold
   that carried the merged client while it was built is gone with the files it
   was hiding from; so is its &view=.

   AN UNKNOWN ?page= FALLS BACK TO THE LANDING PAGE rather than mounting nothing.
   app.html mounts by looking up data-page in its registry, and a name with no
   registration leaves #appRoot empty with no error — a blank screen, which reads
   as an outage rather than as a typo. PAGES is the same list app.html's §D
   switcher carries; the two are checked against each other by tests/merge.js. */
var APP_PAGES = ['landing', 'overview', 'pricevolume', 'rmx', 'segment',
                 'fuelsurcharge', 'rmxfuel', 'tp01', 'inventoryreport', 'deckbuilder'];

function doGet(e) {
  var asked = (e && e.parameter && e.parameter.page ? String(e.parameter.page) : '').toLowerCase();
  var page  = APP_PAGES.indexOf(asked) === -1 ? 'landing' : asked;
  if (asked && page !== asked) {
    APP_log('warn', 'doGet', 'unknown page, serving the landing page', { asked: asked });
  }

  /* Rendered through a template for one reason now: the deployed /exec URL. The
     client cannot derive it — a relative href inside the Apps Script sandbox
     iframe resolves against googleusercontent.com, not the web app — and it is
     read from a <body> data attribute rather than printed into JavaScript,
     because the printing scriptlet HTML-escapes and would break the script
     block. PLAN.md §8, chunk 2. */
  var t = HtmlService.createTemplateFromFile('app');
  t.appUrl = getAppUrl_();
  t.page   = page;

  return t.evaluate()
    .setTitle('Amrize Commercial Suite')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}` },

    { kind: 'rewrite', gone: ['include'], added: [],
      why: 'CHUNK 13. include(name) spliced one HTML partial into another, and all 47 of its ' +
           'call sites were in the 21 .html files the cutover deletes — app.html has none, ' +
           'its only mention of the name being a comment about a partial already dropped. It ' +
           'cannot come back: one client file means there is no second file to splice into it.',
      from: '/* Pull a shared HTML partial (Styles / Shell) into a page.\n',
      to: '  return HtmlService.createHtmlOutputFromFile(name).getContent();\n}',
      text: `/* \`include(name)\` stood here and is gone at the cutover. It spliced one HTML
   partial into another, and every one of its 47 call sites was in a file this
   commit deletes — app.html's only mention of the name is a comment about a
   partial that had already been dropped. It cannot come back either: there is
   one client file now, so there is no second file to splice. */` },

    { kind: 'cut', gone: ['syncSlideData'],
      why: 'DEAD. Zero references repo-wide. Its own comment claims the Segment page calls it; ' +
           'README §7 disproves that — the page moved to RMX_getSlideTables. getSlideData STAYS ' +
           '(Ov_Backend.gs:240 calls it), and updateFromSource is the live "Update from source" ' +
           'path for every page.',
      from: '// "Update from source": new data version (every saved copy everywhere is now\n',
      to: 'EOF' },
  ],

  'RMX_Backend.gs': [
    { kind: 'cut', gone: [],
      why: 'PLAN §7 debug function (IIFE-private, so not a top-level name). Logger-only ' +
           'diagnostic from a past Others-vs-#N/A investigation. No caller.',
      from: '/* Run from the Apps Script editor (View > Logs). Lists the rows most likely to\n',
      to: "  return 'Logged ' + Object.keys(revOnly).length + ' revenue-only lines, ' + Object.keys(naMix).length + ' #N/A mixes. See View > Logs.';\n}\n\n" },

    { kind: 'cut', gone: [],
      why: 'PLAN §7 debug function — and THIS is the one that writes a CSV to Drive; the plan ' +
           'attributed that to debugNaOthers. §7 required a check before deleting it, and the ' +
           'check passes: the live Mapping check covers it and better. getUnmapped -> ' +
           'unmappedOf_ -> finishUnmapped_ returns every lookup miss per distinct value with ' +
           'row counts, markets, mat_prod_hier_3 and CY/PY volume AND revenue, sorted by money ' +
           'impact, on screen. The CSV was a strict subset of that, behind an editor run.',
      from: 'function debugUnclassified(market){\n',
      to: '  return file.getUrl();\n}\n\n' },

    { kind: 'cut', gone: [],
      why: 'the two IIFE exports the deleted debug functions were reached through.',
      from: '    debugNaOthers:  debugNaOthers,\n',
      to: '    debugUnclassified: debugUnclassified,\n' },

    { kind: 'replace',
      why: 'cacheVer / generation / bundleOk existed only for RMX_debugMonths — one caller ' +
           'each, all inside it. build STAYS: RMX_whoWins reads it, and the Ready-Mix page ' +
           'banner tells users to run RMX_whoWins() by name. Comment repointed at the caller ' +
           'that is left.',
      from: `    /* read-only, for RMX_debugMonths */
    build:          function(){ return BUILD; },
    cacheVer:       function(){ return CONFIG.CACHE_VER; },
    generation:     function(){ return generation_(); },
    bundleOk:       function(b){ return bundleOk_(b); }
  };`,
      to: `    /* read-only, for RMX_whoWins */
    build:          function(){ return BUILD; }
  };` },

    { kind: 'cut', gone: ['RMX_debugMonths'],
      why: 'PLAN §7 debug function. Editor-run month diagnostic, no caller. The end anchor is ' +
           "this function's own last line and not a generic one: an earlier `  return s;` " +
           'anchor matched RMX_whoWins instead and silently deleted it.',
      from: '/* ==========================================================================\n * RMX_debugMonths - run this from the Apps Script editor, then View > Logs.\n',
      to: "  return out.join('\\n');\n}\n\n" },

    { kind: 'cut', gone: ['RMX_debugNaOthers', 'RMX_debugUnclassified'],
      why: 'the two top-level wrappers for the deleted debug functions.',
      from: "/* Diagnostic: run this from the editor (pick a market, e.g. 'HNS_SW'), then View > Logs */\n",
      to: 'EOF' },
  ],

  'Ov_Backend.gs': [
    { kind: 'cut', gone: ['CUBE_historyStatus'],
      why: 'DEAD. Zero references across every .gs, .html and harness; no comment claiming ' +
           'editor use; not a trigger target. The era coverage it reports is already on screen — ' +
           "CUBE_getManifest returns each line's eras with built/linked flags, which is what " +
           "app.html's history pill renders.",
      from: 'function CUBE_historyStatus(){\n',
      to: 'EOF' },
  ],

  'Deck_Backend.gs': [
    { kind: 'cut', gone: ['DECK_smokeTest'],
      why: 'PLAN §7 debug function. Builds a throwaway 3-slide deck to eyeball image geometry. ' +
           'No caller.',
      from: '/*****************************************************************************\n * DECK_smokeTest - run this from the Apps Script editor, before any UI exists.\n',
      to: 'EOF' },
  ],
};

/* The nine names chunk 12 WROTE: §2 logging and §4 permissions. */
/* Top-level names app.gs has that no source file did. The chunk-12 nine are the
   logging switch and the permissions self-check; APP_PAGES is chunk 13's, the
   route list doGet validates against. Anything else appearing here is a name the
   merge invented without saying so. */
const ADDED = ['APP_LOG_LEVELS_', 'APP_logLevel_', 'APP_logData_', 'APP_log', 'APP_logTimed',
               'APP_verifyPermissions', 'APP_permAnySheetId_', 'APP_permErr_', 'APP_permPad_',
               'APP_PAGES'];

/* PLAN.md §5 order. QlikSync.gs is NOT in this list: it is the one file that
   lands in two places — the engine in §5, its trigger and editor entry points
   in §11 — so it gets its own block below, which also checks it sits between
   Code.gs and PV_Backend.gs where §5 says it should. */
const ORDER = [
  ['1',  'Config.gs'],
  ['3',  'Code.gs'],
  ['6',  'PV_Backend.gs'], ['6', 'PV_Lookup.gs'], ['6', 'FSC_Backend.gs'], ['6', 'Sask_Backend.gs'],
  ['7',  'RMX_Backend.gs'], ['7', 'RMX_Suggest.gs'], ['7', 'RFSC_Backend.gs'],
  ['8',  'Ov_Backend.gs'],
  ['9',  'Deck_Backend.gs'], ['9', 'Deck_Recipe.gs'],
  ['10', 'Kpi_Backend.gs'], ['10', 'TP01_Backend.gs'], ['10', 'IR_Backend.gs'],
];

const QLIK_SPLIT =
  '/* ==========================================================================\n' +
  ' * THE ONLY THING THAT STARTS A SYNC: one hourly trigger.\n';

function applyEdits(file, src) {
  for (const op of (EDITS[file] || [])) {
    if (op.kind === 'insert') {
      if (src.split(op.after).length !== 2) throw new Error(file + ': insert anchor not unique');
      src = src.replace(op.after, op.after + op.text);
    } else if (op.kind === 'rewrite') {
      /* A span of the source REPLACED by new text, rather than moved. `replace`
         swaps one exact string; this swaps everything from `from` through the end
         of `to`, which is what a rewritten function needs. The new text is a
         literal here on purpose — reading it back out of app.gs would make the
         check unable to fail. */
      const i = src.indexOf(op.from);
      if (i === -1 || src.indexOf(op.from, i + 1) !== -1)
        throw new Error(file + ': rewrite start not found exactly once');
      const j = src.indexOf(op.to, i);
      if (j === -1) throw new Error(file + ': rewrite end not found after start');
      src = src.slice(0, i) + op.text + src.slice(j + op.to.length);
    } else if (op.kind === 'replace') {
      if (src.split(op.from).length !== 2) throw new Error(file + ': replace block not unique');
      src = src.replace(op.from, op.to);
    } else {
      const i = src.indexOf(op.from);
      if (i === -1 || src.indexOf(op.from, i + 1) !== -1)
        throw new Error(file + ': cut start not found exactly once');
      let end;
      if (op.to === 'EOF') end = src.length;
      else {
        const j = src.indexOf(op.to, i);
        if (j === -1) throw new Error(file + ': cut end not found after start');
        end = j + op.to.length;
      }
      src = src.slice(0, i) + src.slice(end);
    }
  }
  return src;
}

/* ---- scope-aware top-level declarations --------------------------------- */
/* Comments, strings, template literals AND regex literals are blanked before
   braces are counted, so a `{` inside a string cannot fake a nesting level and
   a `/[)]/` cannot unbalance the parens. Without the regex case, RMX_Backend.gs
   alone reports four unclosed braces and most of the file reads as top level. */
const KW = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
                    'throw', 'case', 'do', 'else', 'yield', 'await']);
function blank(src) {
  let out = '', i = 0, prev = '';
  const n = src.length;
  const run = (a, b) => { for (let k = a; k < b; k++) out += (src[k] === '\n' ? '\n' : ' '); };
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === '/' && c2 === '/') { let j = i; while (j < n && src[j] !== '\n') j++; run(i, j); i = j; continue; }
    if (c === '/' && c2 === '*') {
      let j = i + 2; while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      j = Math.min(j + 2, n); run(i, j); i = j; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') { j += 2; continue; } j++; }
      j = Math.min(j + 1, n); run(i, j); i = j; prev = 'STR'; continue;
    }
    if (c === '/') {
      const afterValue = /[\w$)\]]/.test(prev) && !KW.has(prev);
      if (!afterValue) {
        let j = i + 1, cls = false, ok = false;
        while (j < n) {
          const d = src[j];
          if (d === '\\') { j += 2; continue; }
          if (d === '\n') break;
          if (cls) { if (d === ']') cls = false; }
          else if (d === '[') cls = true;
          else if (d === '/') { ok = true; j++; break; }
          j++;
        }
        if (ok) { while (j < n && /[a-z]/.test(src[j])) j++; run(i, j); i = j; prev = 'RE'; continue; }
      }
      out += c; i++; prev = '/'; continue;
    }
    if (/[\w$]/.test(c)) {
      let j = i; while (j < n && /[\w$]/.test(src[j])) j++;
      const w = src.slice(i, j); out += w; i = j; prev = w; continue;
    }
    out += c; i++; if (!/\s/.test(c)) prev = c;
  }
  return out;
}

function topLevel(src) {
  const lines = blank(src).split('\n');
  const names = [];
  let d = 0, p = 0, b = 0;
  for (const line of lines) {
    if (!d && !p && !b) {
      let m;
      if ((m = /^\s*function\s+([A-Za-z_$][\w$]*)/.exec(line))) names.push(m[1]);
      else if ((m = /^\s*(var|let|const)\s+([A-Za-z_$][\w$]*)/.exec(line))) names.push(m[2]);
    }
    for (const ch of line) {
      if (ch === '{') d++; else if (ch === '}') d--;
      else if (ch === '(') p++; else if (ch === ')') p--;
      else if (ch === '[') b++; else if (ch === ']') b--;
    }
  }
  return { names, balanced: !d && !p && !b };
}

/* ========================================================================= */
const app = fs.readFileSync(path.join(REPO, 'app.gs'), 'utf8');

console.log('app.gs against the 16 .gs files at ' + REF + ':\n');

/* ---- 5. line endings ---------------------------------------------------- */
check('LF throughout — no CR survived the merge', app.indexOf('\r') === -1,
  'PLAN.md §12 pins app.gs to LF. An editor has flipped it.');

/* ---- 1 + 2. every region present, verbatim, in order -------------------- */
let cursor = 0;
let lastLabel = 'the top of the file';
const foundAt = {};
for (const [section, file] of ORDER) {
  let want;
  try { want = applyEdits(file, gitShow(file)); }
  catch (e) { check('§' + section + '  ' + file + ' — edits apply', false, String(e.message)); continue; }
  want = want.replace(/\n+$/, '\n');

  const at = app.indexOf(want, cursor);
  if (at === -1) {
    const anywhere = app.indexOf(want);
    check('§' + section + '  ' + file.padEnd(18) + ' verbatim', false,
      anywhere === -1
        ? 'not present — it differs from ' + REF + ':' + file + ' by more than the declared edits'
        : 'present, but BEFORE ' + lastLabel + ' — the §5 section order is wrong');
  } else {
    check('§' + section + '  ' + file.padEnd(18) + ' verbatim  (' + want.length.toLocaleString() + ' bytes)', true);
    foundAt[file] = at;
    cursor = at + want.length;
    lastLabel = file;
  }
}

/* QlikSync.gs is the split one: §5 takes the engine, §11 the entry points, and
   the two halves must rejoin to exactly the file. */
{
  const whole = applyEdits('QlikSync.gs', gitShow('QlikSync.gs'));
  const i = whole.indexOf(QLIK_SPLIT);
  check('QlikSync.gs — the §5/§11 split banner is present and unique',
    i !== -1 && whole.indexOf(QLIK_SPLIT, i + 1) === -1);
  if (i !== -1) {
    const engine = whole.slice(0, i).replace(/\n+$/, '\n');
    const triggers = whole.slice(i).replace(/\n+$/, '\n');
    const a = app.indexOf(engine), b = app.indexOf(triggers);
    check('§5  the QLIKSYNC engine is verbatim  (' + engine.length.toLocaleString() + ' bytes)', a !== -1);
    check('§11 the four entry points are verbatim  (' + triggers.length.toLocaleString() + ' bytes)', b !== -1);
    check('§11 comes after §5 — the engine is built before the trigger names it', a !== -1 && b > a);
    check('§5  sits between Code.gs and PV_Backend.gs, where PLAN §5 puts it',
      a > foundAt['Code.gs'] && a < foundAt['PV_Backend.gs']);
    check('§11 comes last — after IR_Backend.gs, the end of §10', b > foundAt['IR_Backend.gs']);

    /* The seam is the one place a split can silently lose a line. Compare with
       runs of blank lines collapsed, so the check is blind to the whitespace
       the section banners legitimately change and blind to nothing else. */
    const squash = s => s.replace(/[ \t]+$/gm, '').replace(/\n{2,}/g, '\n').trim();
    check('the two halves rejoin to the whole file — nothing lost at the seam',
      squash(engine) + '\n' + squash(triggers) === squash(whole));
  }
}

/* ---- 3. the top-level name set moved by exactly what was declared ------- */
{
  const before = new Set();
  for (const f of ['Config.gs', 'Code.gs', 'QlikSync.gs', 'PV_Backend.gs', 'PV_Lookup.gs',
                   'FSC_Backend.gs', 'Sask_Backend.gs', 'RMX_Backend.gs', 'RMX_Suggest.gs',
                   'RFSC_Backend.gs', 'Ov_Backend.gs', 'Deck_Backend.gs', 'Deck_Recipe.gs',
                   'Kpi_Backend.gs', 'TP01_Backend.gs', 'IR_Backend.gs']) {
    topLevel(gitShow(f)).names.forEach(n => before.add(n));
  }
  const after = topLevel(app);
  check('the brace/paren/bracket count balances — the analyser read app.gs correctly',
    after.balanced);

  const now = new Set(after.names);
  const declaredGone = new Set();
  for (const ops of Object.values(EDITS)) for (const op of ops) (op.gone || []).forEach(n => declaredGone.add(n));

  const gone = [...before].filter(n => !now.has(n));
  const added = [...now].filter(n => !before.has(n));

  check('exactly the declared deletions are gone (' + [...declaredGone].length + ')',
    gone.length === declaredGone.size && gone.every(n => declaredGone.has(n)),
    'gone: [' + gone.join(', ') + ']\n        declared: [' + [...declaredGone].join(', ') + ']');
  check('exactly the declared additions are new (' + ADDED.length + ')',
    added.length === ADDED.length && added.every(n => ADDED.indexOf(n) !== -1),
    'added: [' + added.join(', ') + ']\n        declared: [' + ADDED.join(', ') + ']');
}

/* ---- 4. no top-level name is declared twice ---------------------------- */
{
  const seen = {}, dupes = [];
  for (const n of topLevel(app).names) { if (seen[n]) dupes.push(n); seen[n] = true; }
  check('no top-level name is declared twice', dupes.length === 0,
    'Apps Script evaluates every .gs into ONE global scope and the last one wins, silently: ' +
    dupes.join(', '));
}

console.log(fails ? `\n${fails} failing check(s)` : '\nMERGE IS A MOVE — every region is the file it came from.');
process.exit(fails ? 1 : 0);
