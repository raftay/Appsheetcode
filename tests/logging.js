#!/usr/bin/env node
/* =============================================================================
 * tests/logging.js — the server's logging, and the silent catches  (chunk 18)
 * -----------------------------------------------------------------------------
 *   node tests/logging.js          # no dependencies
 *
 * WHY THIS EXISTS
 *
 * Chunk 12 wrote APP_log and deliberately left the 10,889 moved lines alone:
 * moving is neither writing nor rewriting, and new Cloud Logging writes on the
 * hottest path in the suite are behaviour, which §10 kept out of the merge.
 * Chunk 18 wired it in and decided all 36 silent catches. This is what stops
 * both from decaying.
 *
 * THE CHECK THAT EARNS ITS PLACE IS THE CENSUS. A `catch (e) {}` is one
 * keystroke and it is invisible in review — that is exactly how 36 of them
 * accumulated. §7's rule is that silent is right for an OPTIONAL CACHE READ and
 * wrong for everything else, and the whole of chunk 18's judgement is in which
 * group each one landed. So every silent catch left in script.gs is listed here by
 * the function that contains it, and a new one fails this harness with "decide
 * it" rather than sliding in behind a green run.
 *
 * COUNT THEM WITH THE RIGHT PATTERN. `catch (e) {}` finds 31 and the real number
 * was 36: five are nested and bind e2 or e3. Every one of those five turned out
 * to belong in the group that has to speak — including a fallback chain whose
 * FALLBACK was also silent, so both ways of invalidating a cache could fail with
 * the rows already written and nothing said. The regex below is the honest one.
 * ===========================================================================*/
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP  = fs.readFileSync(path.join(ROOT, 'script.gs'), 'utf8');
const LINES = APP.split('\n');

let failures = 0;
const fail = (what, msg) => { failures++; console.log(`  ✗ ${what}: ${msg}`); };
const pass = (what, msg) => console.log(`  ✓ ${what}${msg ? ': ' + msg : ''}`);

/* Which function a line is in. Good enough for a report: these are all
   top-level or one level of namespace, and the point is to name a place a
   human can find, not to build a parser. */
const FNRE = /^\s*(?:function\s+([A-Za-z0-9_]+)|([A-Za-z0-9_]+)\s*:\s*function)/;
function fnAt(lineNo) {
  for (let i = lineNo - 1; i >= 0; i--) {
    const m = FNRE.exec(LINES[i]);
    if (m) return m[1] || m[2];
  }
  return '(top level)';
}

/* ------------------------------------------------------------------ 1. census
 * Every silent catch that is allowed to stay, and why. Each one is an optional
 * cache handle, read or write whose failure costs speed and nothing else — or,
 * for the last two, is already reported through the value the function returns.
 */
const ALLOWED = {
  getLogo:             ['reading the cached copy',
                        'writing the fetched logo back to the cache — the FETCH itself now warns'],
  APP_oneStamp_:       ['the cache handle', 'the cached stamp', 'writing the stamp back'],
  APP_forgetStamp_:    ['the cache handle'],
  probe:               ['the permissions probe removing its own test key'],
  APP_permAnySheetId_: ['a page with no sheet configured is an expected miss, not a failure'],
  clearCache:          ['the logo copy — cosmetic, and refetched on the next page load'],
  /* Two copies, one per namespace (FSC and RFSC), and they are the same three
     lines — see chunk 15 on why the duplicated private helpers stay. */
  cPut_:               ['delegates to APP_cachePut_, which logs and cannot throw',
                        'the second namespace\'s copy of the same wrapper'],
  qlikStamps:          ['a read-only editor diagnostic that PRINTS "(never)" in its own answer'],
};

const SILENT = /catch\s*\(\s*[A-Za-z0-9_]+\s*\)\s*\{\s*\}/;
const found = [];
LINES.forEach((l, i) => {
  if (!SILENT.test(l)) return;
  if (/^\s*\*/.test(l)) return;            /* the census comment describes the pattern */
  found.push({ line: i + 1, fn: fnAt(i), text: l.trim() });
});

const counts = {};
found.forEach(f => { counts[f.fn] = (counts[f.fn] || 0) + 1; });

const undecided = found.filter(f => !ALLOWED[f.fn]);
if (undecided.length) {
  fail('census', `${undecided.length} silent catch(es) in a function chunk 18 did not clear. ` +
    `§7: silent is right for an OPTIONAL CACHE READ and wrong for everything else — an ` +
    `invalidation that fails silently looks exactly like nothing having happened. Decide it, ` +
    `then either make it log or add it to ALLOWED here with the reason.\n` +
    undecided.slice(0, 8).map(f => `        · script.gs:${f.line} in ${f.fn}() — ${f.text.slice(0, 74)}`)
             .join('\n'));
} else {
  const over = Object.keys(counts).filter(fn => counts[fn] > ALLOWED[fn].length);
  if (over.length) {
    fail('census', `${over.map(fn => `${fn}() now has ${counts[fn]} silent catches and ${ALLOWED[fn].length} ` +
      `are accounted for`).join('; ')}. A new one in a function that already has an allowed one ` +
      `is still a new decision.`);
  } else {
    pass('census', `${found.length} silent catches, every one accounted for ` +
                   `(36 before chunk 18)`);
  }
}

/* -------------------------------------------------- 2. the four entry points
 * README §10 names these four and the order it names them in is the order of the
 * payoff. Each must log its arrival, its answer and its failure — and carry
 * elapsed ms, which §7 calls the only field that catches a regression nobody
 * reported. */
const ENTRY = [
  { fn: 'getFscData',     where: 'FSC.getFscData' },
  { fn: 'getPvUnmapped',  where: 'PVLOOK.getUnmapped' },
  { fn: 'RMX_prepare',    where: 'RMX.prepareAll' },
  { fn: 'qlikSyncCheck',  where: 'QLIKSYNC.check' },
];
for (const e of ENTRY) {
  const at = LINES.findIndex(l => new RegExp('^function\\s+' + e.fn + '\\s*\\(').test(l));
  if (at === -1) { fail('entry-points', `${e.fn} is gone from script.gs`); continue; }
  /* the function body, by brace match */
  let depth = 0, end = at, started = false;
  for (; end < LINES.length; end++) {
    for (const ch of LINES[end]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) break;
  }
  const body = LINES.slice(at, end + 1).join('\n');
  const calls = (body.match(/APP_log\(/g) || []).length;
  const hasWhere = body.includes(`'${e.where}'`);
  const hasMs    = /ms:\s*Date\.now\(\)\s*-\s*t0/.test(body);
  const hasError = /APP_log\('error'/.test(body);
  const oldStyle = /console\.(log|error)\(|Logger\.log\(/.test(body);

  if (calls < 2)      fail('entry-points', `${e.fn} logs ${calls} time(s) — an entry point logs its arrival AND its answer`);
  else if (!hasWhere) fail('entry-points', `${e.fn} does not log under "${e.where}" — §7 wants the function, not the file`);
  else if (!hasMs)    fail('entry-points', `${e.fn} logs no elapsed ms. §7: it is the only field that catches a regression nobody reported`);
  else if (!hasError) fail('entry-points', `${e.fn} has no error-level line — §7: errors log the context, not just the message`);
  else if (oldStyle)  fail('entry-points', `${e.fn} still uses console.log/Logger.log alongside APP_log — one convention or none`);
  else pass('entry-points', `${e.fn} → ${e.where}: ${calls} lines, with ms and an error path`);
}

/* ----------------------------------------------------- 3. the cache verdicts
 * §7: 'skip' is one of the three BECAUSE APP_cachePut_ bails silently above its
 * chunk ceiling, and a silent bail is indistinguishable from a cache that is
 * never warm. README §6 is what that cost. */
const putAt = APP.indexOf('function APP_cachePut_');
const getAt = APP.indexOf('function APP_cacheGet_');
const cacheSrc = APP.slice(putAt, APP.indexOf('\n}\n', getAt) + 3);
for (const verdict of ['hit', 'miss', 'skip']) {
  if (!new RegExp(`cache:\\s*'${verdict}'`).test(cacheSrc))
    fail('cache-verdict', `the chunked cache helpers never report cache:'${verdict}'. ` +
      `All three exist because 'skip' — APP_cachePut_'s n > 250 bail — reads exactly like a ` +
      `cache that is never warm, and README §6 is what that cost the last time.`);
}
/* Structural, not a proximity match: find the bail and check the block it
   opens warns before it returns. An earlier version of this check used a
   character window and failed the moment the comment explaining the bail grew
   longer than the window — which is a check that breaks on documentation. */
const bailAt = cacheSrc.indexOf('n > 250');
const bailEnd = cacheSrc.indexOf('return;', bailAt);
if (bailAt === -1 || bailEnd === -1 ||
    !/APP_log\('warn'/.test(cacheSrc.slice(bailAt, bailEnd)))
  fail('cache-verdict', `APP_cachePut_'s "too big to cache" bail does not warn. It is the ` +
    `single highest-value log line in the file and README §10 says to do it first.`);
else pass('cache-verdict', "hit / miss / skip all reported, and the n > 250 bail warns");

/* ------------------------------------------------------- 4. never in a loop
 * §7: "Log at entry points and phase boundaries. NEVER inside a per-row loop.
 * The Ready-Mix bundle is 40,000 rows; a line per row would cost more than the
 * work it describes and would bury the line that matters." */
const LOOP = /\b(?:for|while)\s*\(|\.\s*(?:forEach|map|filter|reduce)\s*\(\s*function/;
/* Iterating a handful of NAMED THINGS is not a per-row loop. Each entry says
   what is being iterated, because "it's fine" is not a reason. */
const NOT_ROWS = {
  'QLIKSYNC.markCurrent':   'the six QlikView export sources',
  'QLIKSYNC.syncNow':       'the six QlikView export sources',
  'QLIKSYNC.run':           'the sync spec — one entry per sheet tab, not per row',
  'QLIKSYNC.check':         'the same six sources, once each per hourly run',
  'APP.forgetStamp':        'the page list — ten names, and only when a remove fails',
  'APP.verifyPermissions':  'the CHECKS array — one line per SERVICE is the whole output',
  /* The loop walks the chunks of ONE cache entry, and the line inside it
     RETURNS immediately: at most one per call, never one per chunk. */
  'APP.cacheGet':           'one chunked entry, and the line returns on the first gap',
  /* Stranded temp sheets, capped at 50 and normally zero. Named files a
     killed run left in Drive, not rows — and the line only fires for one that
     will not trash, which is the thing somebody would need to go and look at. */
  'QLIKSYNC.sweep':         'stranded temp files, capped at 50 and usually none',
  /* Report MAILS, not rows. A month brings one, occasionally two or three when
     the data is corrected and the report re-sent, and the search window caps
     it well below that — a line per message IS the account of the run. */
  'IRMAIL.run':             'the unpublished report mails — normally none, at most a few',
  /* The previous copies of ONE month, which is zero or one of them, and the
     line only fires for a copy that will not trash — the one case that leaves
     the folder holding two files for a month. */
  'IRMAIL.clearMonth':      "one month's previous copies, and only when one will not trash",
};
const inLoop = [];
LINES.forEach((l, i) => {
  if (!/APP_log\(/.test(l)) return;
  /* Walk back to the enclosing function, tracking which open blocks we are
     still inside. A loop header still on the stack means this line runs per
     iteration. */
  let depth = 0;
  for (let j = i; j >= 0; j--) {
    const line = LINES[j];
    for (let k = line.length - 1; k >= 0; k--) {
      if (line[k] === '}') depth++;
      else if (line[k] === '{') {
        if (depth === 0) {
          if (LOOP.test(line)) {
            const w = (LINES.slice(i, i + 3).join(' ').match(/'([A-Za-z]+\.[A-Za-z]+)'/) || [])[1] || '?';
            if (!NOT_ROWS[w]) inLoop.push({ line: i + 1, where: w, loop: line.trim().slice(0, 70) });
            return;
          }
        } else depth--;
      }
    }
    if (FNRE.test(line) && depth === 0) return;
  }
});
if (inLoop.length) {
  fail('never-in-a-loop', `${inLoop.length} APP_log call(s) sit inside a loop. §7: the ` +
    `Ready-Mix bundle is 40,000 rows, so a line per row costs more than the work it describes ` +
    `and buries the line that matters. If it iterates a handful of named things rather than ` +
    `rows, say so in NOT_ROWS here.\n` +
    inLoop.slice(0, 6).map(x => `        · script.gs:${x.line} (${x.where}) inside: ${x.loop}`).join('\n'));
} else {
  pass('never-in-a-loop', `${(APP.match(/APP_log\(/g) || []).length} APP_log calls, none per-row`);
}

console.log(failures ? `\n${failures} failure(s)`
                     : '\nlogging.js: every silent catch is accounted for, and the entry points speak');
process.exit(failures ? 1 : 0);
