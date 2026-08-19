/* gsparity.js — script.gs still holds each of the 16 .gs files, verbatim.
 * ---------------------------------------------------------------------------
 * Chunk 12 merged 10,889 lines of working backend into one file. The argument
 * that made that safe was that it is a MOVE — ordered concatenation, no
 * renaming, no reconciliation (PLAN.md §5, and the zero-collision audit in
 * §1a). This harness is what turns that argument into something checkable.
 *
 * It reads the 16 originals out of GIT rather than off disk, because chunk 12
 * deleted them in the same commit that added script.gs — they cannot coexist in an
 * Apps Script project (PLAN.md §2). That is the same staging trick regress.js
 * and pvcheck.js already use, just pointed at a commit instead of a directory.
 *
 *     node tests/gsparity.js            # no dependencies
 *     REF=<commit> node tests/gsparity.js
 *
 * WHAT IT CHECKS
 *   1. every source file appears in script.gs verbatim, after the edits declared
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
 * region, script.gs stops being a copy of anything and this harness starts failing
 * for the right reason. It is the server-side twin of modparity.js and has the
 * same end of life: keep it while script.gs is still provably the 16 files, delete
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
   forms normalise to LF, which is what PLAN.md §12 pins script.gs to. */
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
     on the next execution with nothing to redeploy. See script.gs §2.
     'info' is the production setting: entry points and phase boundaries, and
     every error with its context. 'debug' adds the detail you only want while
     something is being investigated. */
  LOG_LEVEL: 'info',
` },

  /* ---- CHUNK 22: a comment that was wrong about live code ---------------- */
    { kind: 'replace',
      why: 'OVERVIEW WAS LABELLED "NOT USED" AND IS READ ON EVERY OVERVIEW LOAD. getOverview ' +
           '(§8) takes its market list from OVERVIEW.MARKETS, the page footer reports any PV ' +
           'market missing from it as unmapped, and app.html names the object by name in that ' +
           'hint. The label came across from Config.gs verbatim, which is exactly how a wrong ' +
           'comment survives a merge — and PLAN.md §11\'s rule is that nothing is deleted on a ' +
           'hunch, so the one thing that could have made this dangerous was a future reader ' +
           'believing the banner. Only the comment changed.',
      from: ` * NOT USED \n * EXECUTIVE OVERVIEW — canonical market list + PV/RMX name mapping.`,
      to: ` * USED — and the "NOT USED" that stood here was wrong. getOverview (§8) reads
 * OVERVIEW.MARKETS on every Overview load, the page's footer reports any PV
 * market missing from it as "unmapped", and app.html names it by name in that
 * hint. Deleting it empties the Executive Overview. Corrected in chunk 22.
 * ------------------------------------------------------------------
 * EXECUTIVE OVERVIEW — canonical market list + PV/RMX name mapping.` },
  ],

  'Code.gs': [

  /* ---- CHUNK 18: APP_log at the entry points, and the silent-catch pass ----
     Declared like every other edit, so the other ~10,800 lines stay proved verbatim.
     script.gs §2 carries the census and the rule each one was decided by. */
    { kind: 'replace',
      why: 'PLAN §7 and §18: THE SILENT SKIP IS WHY THE cache FIELD EXISTS. APP_cachePut_ bails ' +
           'above 250 chunks and says nothing, and a silent bail is indistinguishable from a ' +
           'cache that is simply never warm — which is exactly the shape of README §6\'s most ' +
           'expensive bug, where every RMX entry point pulled a 14 MB bundle to produce a 72 KB ' +
           'answer and nothing about it looked wrong. This is the highest-value log line in the ' +
           'file and chunk 18 says to do it first. The catch is no longer silent either: a cache ' +
           'WRITE that throws is not an optional read failing, it means every later request ' +
           'recomputes. ',
      from: `function APP_cachePut_(key, obj) {
  try {
    var s = JSON.stringify(obj), CH = 90000, n = Math.ceil(s.length / CH);
    if (n > 250) return;                          // too big to cache; will recompute
    var m = {}; m[key + '__meta'] = String(n);
    for (var i = 0; i < n; i++) m[key + '__' + i] = s.substring(i * CH, (i + 1) * CH);
    CacheService.getScriptCache().putAll(m, 21600);
  } catch (e) {}
}`,
      to:   `function APP_cachePut_(key, obj) {
  var t0 = Date.now();
  try {
    var s = JSON.stringify(obj), CH = 90000, n = Math.ceil(s.length / CH);
    if (n > 250) {
      /* THE SILENT BAIL THIS WHOLE FIELD EXISTS FOR. Above the chunk ceiling
         nothing is stored, so every later request recomputes — and from the
         outside that is indistinguishable from a cache that is simply never
         warm. README §6 is what that costs: every Ready-Mix entry point pulled
         a 14 MB bundle through CacheService to produce a 72 KB answer, for a
         long time, because nothing about it looked wrong. A flat elapsed time
         against a varying question is the tell, and it needs a line to be read
         off. warn, not debug: this is a cache that is not working. */
      APP_log('warn', 'APP.cachePut', 'too big to cache — every read will recompute',
              { cache: 'skip', bytes: s.length, chunks: n, limit: 250,
                ms: Date.now() - t0, key: key });
      return;
    }
    var m = {}; m[key + '__meta'] = String(n);
    for (var i = 0; i < n; i++) m[key + '__' + i] = s.substring(i * CH, (i + 1) * CH);
    CacheService.getScriptCache().putAll(m, 21600);
    APP_log('debug', 'APP.cachePut', 'stored',
            { cache: 'put', bytes: s.length, chunks: n, ms: Date.now() - t0, key: key });
  } catch (e) {
    /* NOT SILENT. §7's rule is that silent is right for an optional cache READ
       and wrong for everything else — a write that throws means every later
       request recomputes, which is the same outcome as the bail above and just
       as invisible. */
    APP_log('warn', 'APP.cachePut', 'write failed — every read will recompute',
            { cache: 'skip', ms: Date.now() - t0, key: key, error: String(e) });
  }
}` },
    { kind: 'replace',
      why: 'PLAN §7 and §18: hit/miss, and the third case nobody names. A chunked entry whose ' +
           'middle chunk has expired is not a miss — the meta says n chunks and one of them is ' +
           'gone, so the entry is unusable AND was recently big enough to be worth caching. It ' +
           'reads as a cache that never warms, exactly like the bail in APP_cachePut_. ',
      from: `function APP_cacheGet_(key) {
  try {
    var c = CacheService.getScriptCache(), meta = c.get(key + '__meta');
    if (!meta) return null;
    var n = parseInt(meta, 10), ids = [];
    for (var i = 0; i < n; i++) ids.push(key + '__' + i);
    var got = c.getAll(ids), parts = [];
    for (var j = 0; j < n; j++) { var p = got[key + '__' + j]; if (p == null) return null; parts.push(p); }
    return JSON.parse(parts.join(''));
  } catch (e) { return null; }
}`,
      to:   `function APP_cacheGet_(key) {
  var t0 = Date.now();
  try {
    var c = CacheService.getScriptCache(), meta = c.get(key + '__meta');
    if (!meta) {
      APP_log('debug', 'APP.cacheGet', 'miss', { cache: 'miss', ms: Date.now() - t0, key: key });
      return null;
    }
    var n = parseInt(meta, 10), ids = [];
    for (var i = 0; i < n; i++) ids.push(key + '__' + i);
    var got = c.getAll(ids), parts = [];
    for (var j = 0; j < n; j++) {
      var p = got[key + '__' + j];
      if (p == null) {
        /* A PARTIAL IS NOT A MISS, and telling them apart matters. The meta
           key says n chunks and one of them has gone, so the whole entry is
           unusable — but something WAS stored, recently, and it was big enough
           to be worth storing. Reported as a miss to the caller, because that
           is what it is, and logged as its own thing because a run of these is
           an entry too big to survive its own TTL rather than a cold cache. */
        APP_log('warn', 'APP.cacheGet', 'partial — one chunk expired, the entry is unusable',
                { cache: 'miss', chunks: n, missingAt: j, ms: Date.now() - t0, key: key });
        return null;
      }
      parts.push(p);
    }
    var raw = parts.join('');
    var out = JSON.parse(raw);
    APP_log('debug', 'APP.cacheGet', 'hit',
            { cache: 'hit', bytes: raw.length, chunks: n, ms: Date.now() - t0, key: key });
    return out;
  } catch (e) {
    /* A read is the one case §7 says may be silent — but "may" is about not
       breaking the caller, and it still returns null and recomputes. Saying so
       at warn costs nothing and a run of them is a real signal. */
    APP_log('warn', 'APP.cacheGet', 'read failed — recomputing',
            { cache: 'miss', ms: Date.now() - t0, key: key, error: String(e) });
    return null;
  }
}` },
    { kind: 'replace',
      why: 'AN INVALIDATION THAT FAILS SILENTLY IS THE WORST OF THE THIRTY. APP_forgetStamp_ is ' +
           'how \'Update from source\' stops answering from the half-minute copy of the sheet\'s ' +
           'modified time. If the remove throws, the stale stamp is served for the rest of its ' +
           'TTL and the button reports \'already up to date\' about a sheet that has changed. ',
      from: `  if (c) { try { c.remove(APP_stampKey_(id)); } catch (e) {} }`,
      to:   `  if (c) {
    try { c.remove(APP_stampKey_(id)); }
    catch (e) {
      /* NOT AN OPTIONAL READ — an invalidation (§7). Failing here means the
         stale stamp is served for the rest of its TTL, so ↻ Update from source
         answers "already up to date" about a sheet that has changed. */
      APP_log('warn', 'APP.forgetStamp', 'could not drop the cached stamp — the page may be told nothing changed',
              { page: id, error: String(e) });
    }
  }` },
    { kind: 'replace',
      why: 'syncAll\'s whole job is invalidation, and all three of its steps swallowed their ' +
           'failure. A sync that reports ok:true while a cache it could not clear keeps ' +
           'answering is the exact shape of bug nobody reports, because the numbers look ' +
           'plausible — they are just yesterday\'s. ',
      from: `  try { PV.clearCache();          } catch (e) {}`,
      to:   `  try { PV.clearCache();          }
  catch (e) { APP_log('warn', 'APP.syncAll', 'could not clear PV.clearCache — Price & Volume keeps serving the report it built before the sync',
                      { error: String(e) }); }` },
    { kind: 'replace',
      why: 'syncAll\'s whole job is invalidation, and all three of its steps swallowed their ' +
           'failure. A sync that reports ok:true while a cache it could not clear keeps ' +
           'answering is the exact shape of bug nobody reports, because the numbers look ' +
           'plausible — they are just yesterday\'s. ',
      from: `  try { RMX_NS.bumpGeneration();  } catch (e) {}`,
      to:   `  try { RMX_NS.bumpGeneration();  }
  catch (e) { APP_log('warn', 'APP.syncAll', 'could not clear RMX.bumpGeneration — every Ready-Mix cache key still points at the pre-sync generation',
                      { error: String(e) }); }` },
    { kind: 'replace',
      why: 'syncAll\'s whole job is invalidation, and all three of its steps swallowed their ' +
           'failure. A sync that reports ok:true while a cache it could not clear keeps ' +
           'answering is the exact shape of bug nobody reports, because the numbers look ' +
           'plausible — they are just yesterday\'s. ',
      from: `  try { CacheService.getScriptCache().remove('amrize_logo_datauri'); } catch (e) {}`,
      to:   `  try { CacheService.getScriptCache().remove('amrize_logo_datauri'); }
  catch (e) { APP_log('warn', 'APP.syncAll', 'could not clear logo — the logo stays as it was, which is cosmetic and the only one of the three that is',
                      { error: String(e) }); }` },
    { kind: 'replace',
      why: 'The INNER catch (the cache put) stays silent — an optional write. The OUTER one ' +
           'swallows a UrlFetchApp failure and returns \'\', which is every page rendering with no ' +
           'logo and no reason given. It is also the first place a MISSING ' +
           'script.external_request SCOPE would show, and §6 is explicit that an explicit ' +
           'oauthScopes array means nothing warns you. ',
      from: `      try { CacheService.getScriptCache().put(KEY, uri, 21600); } catch (e2) {}
      return uri;
    }
  } catch (e3) {}
  return '';`,
      to:   `      try { CacheService.getScriptCache().put(KEY, uri, 21600); } catch (e2) {}
      return uri;
    }
  } catch (e3) {
    /* Not silent (§7). Returning '' renders every page with no logo and no
       reason given — and this is also the first place a missing
       script.external_request scope shows up, which §6 warns nothing else will
       tell you about. */
    APP_log('warn', 'APP.getLogo', 'could not fetch the logo — pages will render without it',
            { error: String(e3) });
  }
  return '';` },

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

  /* ---- DEAD CODE FOUND BY THE 404-NAME AUDIT ---------------------------------
     Not debug functions — those are all gone. These are IIFE-private helpers with
     zero readers anywhere in script.gs, app.html or tests/, which the trailing
     underscore also puts out of reach of google.script.run. */
    /* gone: [] — the scope-aware analyser puts this INSIDE the namespace IIFE, so it
       was never one of the top-level names check 3 tracks. That is a stronger
       statement than 'no caller': it was never reachable from outside this section. */
    { kind: 'replace', gone: [],
      why: 'aspInc_ — an ASP-increase calculator with zero callers. Every ASP percentage the ' +
           'suite shows is computed where it is rendered; this is a leftover of a server-side ' +
           'version. IIFE-private, so not reachable from a page even by name. ',
      from: `function aspInc_(cyRev, cyVol, pyRev, pyVol){
  var a = pyVol? pyRev/pyVol : 0, b = cyVol? cyRev/cyVol : 0; return a ? (b-a)/a : 0;
}
`,
      to:   `` },

  /* ---- THE LAST DEBUG FUNCTION ----------------------------------------------
     Chunk 12 deleted six; RMX_whoWins was kept because the Ready-Mix page names it
     in an error banner. It goes now, and the reason is not that chunk 18 gave us
     logging — it is that three of the four things it reports became IMPOSSIBLE the
     moment there was one .gs file. */
    { kind: 'replace', gone: ['RMX_whoWins'],
      why: 'RMX_whoWins GOES. It is the last debug function in the suite, and the reason is not ' +
           'that chunk 18 gave us logging — it is that THREE OF THE FOUR THINGS IT REPORTS ARE ' +
           'NOW IMPOSSIBLE. It exists to answer \'is a second .gs in this project also defining ' +
           'RMX and winning\', by comparing RMX with RMX_NS, by printing the live source of ' +
           'getKeys, and by forcing a throw so the stack names the FILE that owns the winning ' +
           'copy. Since chunk 12 there is ONE .gs and there cannot be a second: RMX === RMX_NS ' +
           'by construction, and every stack names script.gs. The fourth thing, the backend build ' +
           'stamp, already rides in every payload as `build` and is printed in the very banner ' +
           'that used to tell the user to run this. So it is not a diagnostic that has been ' +
           'superseded — it is one that can no longer observe anything. ',
      from: `/* ==========================================================================
 * RMX_whoWins - run this if the page ever claims the backend is old again.
 * --------------------------------------------------------------------------
 * Prints which object the global name \`RMX\` currently resolves to, and forces
 * a throw inside it so the Apps Script stack trace names the FILE that owns
 * the winning copy. If that file is not RMX_Backend.gs, delete it.
 * ======================================================================== */
function RMX_whoWins(){
  var log = [];
  function ok(v){ return (typeof v === 'function') ? 'function' : String(typeof v); }

  log.push('RMX_NS keys : ' + Object.keys(RMX_NS).join(', '));
  log.push('RMX    keys : ' + Object.keys(RMX).join(', '));
  log.push('RMX === RMX_NS ? ' + (RMX === RMX_NS ? 'yes - only one copy in the project'
                                                 : 'NO - a second file is defining RMX'));
  log.push('typeof RMX.build = ' + ok(RMX.build) + '    typeof RMX_NS.build = ' + ok(RMX_NS.build));
  log.push('this file BUILD  = ' + RMX_NS.build());
  log.push('--- live top-level getKeys ---\\n' + String(getKeys));
  log.push('--- live RMX.getKeys (head) ---\\n' + String(RMX.getKeys).slice(0, 600));

  try { RMX.getKeys({ upload: '__probe__', period: 'YTD' }); }
  catch (e){ log.push('--- stack (names the winning FILE) ---\\n' + (e.stack || e.message || e)); }

  var s = log.join('\\n\\n');
  Logger.log(s);
  return s;
}

/* ==========================================================================`,
      to:   `/* ==========================================================================` },

  /* ---- CHUNK 18: APP_log at the entry points, and the silent-catch pass ----
     Declared like every other edit, so the other ~10,800 lines stay proved verbatim.
     script.gs §2 carries the census and the rule each one was decided by. */
    { kind: 'replace',
      why: 'PLAN §18 names this as one of the four, and README §6 is why: RMX_prepare is the one ' +
           'big read the whole Ready-Mix side hangs off, and the bug that hid there for months ' +
           'was a flat elapsed time against a varying question. tests/rmxcost.js is the gate ' +
           'that already covers it. ',
      from: `function RMX_prepare(opts)        { return RMX_NS.prepareAll(opts); }`,
      to:   `function RMX_prepare(opts) {
  var t0 = Date.now();
  APP_log('info', 'RMX.prepareAll', 'reading',
          { market: (opts && opts.market) || '', month: (opts && opts.month) || 0,
            want: (opts && opts.want) || 'all', upload: !!(opts && opts.upload),
            force: !!(opts && opts.force) });
  try {
    var out = RMX_NS.prepareAll(opts);
    /* ELAPSED MS IS THE FIELD THAT EARNS ITS PLACE HERE. README §6: every RMX
       entry point used to pull a 14 MB bundle through CacheService to produce a
       72 KB answer, and it hid for a long time because nothing about it looked
       wrong. A flat 15-24 s against a varying question is what a reader would
       have seen on the first line of the transcript. */
    APP_log('info', 'RMX.prepareAll', 'ok',
            { ms: Date.now() - t0, rows: ((out && out.markets) || []).length,
              month: out && out.month, latest: out && out.latestMonth,
              warmed: out && out.warmed, want: out && out.want });
    return out;
  } catch (err) {
    APP_log('error', 'RMX.prepareAll', 'failed',
            { ms: Date.now() - t0, market: (opts && opts.market) || '',
              month: (opts && opts.month) || 0,
              error: String(err && err.message ? err.message : err) });
    throw err;
  }
}` },
    { kind: 'replace',
      why: 'bumpGeneration_ exists to make every cached answer unreachable. Dropping the stamp ' +
           'is half of that, and a silent failure leaves the two halves disagreeing: a new ' +
           'generation with the old modified time behind it. ',
      from: `  try { APP_forgetStamp_('rmx'); } catch (e) {}`,
      to:   `  try { APP_forgetStamp_('rmx'); }
  catch (e) { APP_log('warn', 'RMX.bumpGeneration', 'generation moved but the source stamp did not — ' +
                      'freshness checks will disagree with the cache', { error: String(e) }); }` },

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
           'each, all inside it. AND NOW build TOO: chunk 12 kept it because RMX_whoWins read ' +
           'it and the Ready-Mix banner told users to run that by name, and both of those went ' +
           'when RMX_whoWins did. BUILD itself stays — it rides in every payload as `build` and ' +
           'the page displays it; what goes is the namespace export nothing reads any more. ' +
           'Amended here rather than declared as a second edit, because a declaration should ' +
           'say what the net difference from the source IS, not how it got there.',
      from: `    /* read-only, for RMX_debugMonths */
    build:          function(){ return BUILD; },
    cacheVer:       function(){ return CONFIG.CACHE_VER; },
    generation:     function(){ return generation_(); },
    bundleOk:       function(b){ return bundleOk_(b); }
  };`,
      to: `  };` },

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

  /* ---- CHUNK 18: APP_log at the entry points, and the silent-catch pass ----
     Declared like every other edit, so the other ~10,800 lines stay proved verbatim.
     script.gs §2 carries the census and the rule each one was decided by. */
    { kind: 'replace',
      why: 'A fallback read, not a cache read: cyYear stays null and the Overview then labels ' +
           'its columns with no year. §7\'s exemption is for optional CACHE reads — this one ' +
           'changes an answer that reaches the screen. ',
      from: `      if (mt) cyYear = +mt[1];
    } catch (e) {}`,
      to:   `      if (mt) cyYear = +mt[1];
    } catch (e) {
      APP_log('warn', 'OV.segNorm', 'could not read QLIK_REPORT_MONTH — the year on the ' +
              'segment columns will be missing', { error: String(e) });
    }` },
    { kind: 'replace',
      why: 'An invalidation again: the history token is what tells every client the cube it has ' +
           'is out of date. The rebuild has already been WRITTEN by the line above, so failing ' +
           'here means the new history exists and nobody will be told to fetch it. ',
      from: `  } catch (e) {}
  var s = {}; cube.rows.forEach(function(r){ s[r[0]] = true; });`,
      to:   `  } catch (e) {
    /* The rebuilt history is already written. Without the token bump no client
       is told to go and get it, so the work is done and invisible. */
    APP_log('warn', 'CUBE.rebuildHistory', 'history rebuilt but the token did not move — ' +
            'clients will keep the cube they have', { line: line, era: era.id, error: String(e) });
  }
  var s = {}; cube.rows.forEach(function(r){ s[r[0]] = true; });` },

    { kind: 'cut', gone: ['CUBE_historyStatus'],
      why: 'DEAD. Zero references across every .gs, .html and harness; no comment claiming ' +
           'editor use; not a trigger target. The era coverage it reports is already on screen — ' +
           "CUBE_getManifest returns each line's eras with built/linked flags, which is what " +
           "app.html's history pill renders.",
      from: 'function CUBE_historyStatus(){\n',
      to: 'EOF' },
  ],

  'Deck_Backend.gs': [

  /* ---- CHUNK 22: the deck's CONFIG moved to §1; its CODE did not ----------
     A MOVE INSIDE THE FILE, not a deletion — DECK_CONFIG is still declared
     exactly once, at the top of §1, which is why `gone` is empty. Check 3 would
     say so anyway: a name that moved is still in script.gs's top-level set. */
    { kind: 'cut', gone: [],
      why: 'DECK_CONFIG MOVED TO §1. The template id, the destination folder and the capture ' +
           'resolution are the settings a business user is expected to change, and they sat at ' +
           'line 10,281 of an 11,700-line file, behind the engine that reads them. Nothing about ' +
           'the object changed — it is the same bytes, 3,024 of them, 10,000 lines earlier.',
      from: 'var DECK_CONFIG = {\n',
      to: '\n  CAPTURE_MAX_PX: 2048\n};\n' },

    { kind: 'replace',
      why: 'and the pointer left where it was, so §9 still tells you where its configuration went.',
      from: '\n\n\n\nvar DECK = (function () {\n',
      to: `

/* THE TWO THINGS ANYONE EDITS ABOUT THE DECK ARE IN §1, AT THE TOP OF THIS
   FILE.  Ctrl+F  "§1 DECK".  DECK_CONFIG — the template and folder ids, the
   capture resolution — and DECK_RECIPE — which slides the monthly deck holds,
   and in what order — used to sit here, ten thousand lines down, behind the
   engine that reads them. The one part of the deck a business user is expected
   to change was the hardest part of the file to find.

   NOTHING ELSE MOVED. Everything below is the reader, the writer and the
   geometry: code, not configuration. tests/gsparity.js declares the cut, so
   this region is still proved verbatim against the file it came from apart
   from it. */


var DECK = (function () {\n` },

    { kind: 'cut', gone: ['DECK_smokeTest'],
      why: 'PLAN §7 debug function. Builds a throwaway 3-slide deck to eyeball image geometry. ' +
           'No caller.',
      from: '/*****************************************************************************\n * DECK_smokeTest - run this from the Apps Script editor, before any UI exists.\n',
      to: 'EOF' },
  ],

  'Deck_Recipe.gs': [

  /* ---- CHUNK 22: the recipe is config, so it moved to §1 ------------------
     Its own header says it: "THIS FILE IS CONFIG, NOT CODE." The checking half
     — DECK_getRecipe — is code and stayed. Same shape of edit as DECK_CONFIG
     above, and `gone` is empty for the same reason: the array moved, it did not
     go away. */
    { kind: 'cut', gone: [],
      why: 'DECK_RECIPE MOVED TO §1. Adding, dropping or reordering a slide in the monthly pack ' +
           'is an edit to this array and to nothing else, which makes it the most-edited object ' +
           'in the file — and it sat at line 10,968, further down than anything except the small ' +
           'pages. The 43 rows are unchanged, byte for byte.',
      from: 'var DECK_RECIPE = [\n',
      to: "    title:'TOP 10 CUSTOMERS MTD & YTD - North' }\n];\n" },

    { kind: 'replace',
      why: 'and the pointer left in its place, beside the checker that reads it.',
      from: '\n\n\n\n/*****************************************************************************\n * DECK_getRecipe',
      to: `

/* THE RECIPE ITSELF IS IN §1 — Ctrl+F "§1 DECK". The list of slides moved to
   the top of the file in chunk 22; the checking below did not, because it is
   code. */


/*****************************************************************************
 * DECK_getRecipe` },
  ],

  'FSC_Backend.gs': [

  /* ---- CHUNK 18: APP_log at the entry points, and the silent-catch pass ----
     Declared like every other edit, so the other ~10,800 lines stay proved verbatim.
     script.gs §2 carries the census and the rule each one was decided by. */
    { kind: 'replace',
      why: 'PLAN §7: this wrapper is the "no convention at all" the chunk was written against — ' +
           'two hand-concatenated console.log strings, no level, no elapsed ms, no cache ' +
           'verdict. One of the four entry points chunk 18 names, chosen because ' +
           'tests/fscheader.js already covers it. ',
      from: `function getFscData(opts){
  try {
    console.log('[FSC] getFscData: start');
    var out = FSC.getFscData(opts);
    console.log('[FSC] getFscData: ok \\u00b7 ' + out.markets.length + ' markets \\u00b7 latest ' + out.latestMonth);
    return out;
  } catch (err) {
    console.error('[FSC] getFscData failed: ' + (err && err.message ? err.message : err));
    throw err;
  }
}`,
      to:   `function getFscData(opts){
  var t0 = Date.now();
  APP_log('info', 'FSC.getFscData', 'reading', { month: (opts && opts.month) || 0 });
  try {
    var out = FSC.getFscData(opts);
    APP_log('info', 'FSC.getFscData', 'ok',
            { ms: Date.now() - t0, rows: out.markets.length,
              month: (opts && opts.month) || 0, latest: out.latestMonth });
    return out;
  } catch (err) {
    /* §7: an error logs the CONTEXT, not just the message — the month is what
       selects the data, so a failure that only happens on one of them is
       readable off the line rather than reproduced. */
    APP_log('error', 'FSC.getFscData', 'failed',
            { ms: Date.now() - t0, month: (opts && opts.month) || 0,
              error: String(err && err.message ? err.message : err) });
    throw err;
  }
}` },
    { kind: 'replace',
      why: 'THE GENERATION IS PART OF THE CACHE KEY, so falling back to \'0\' does not disable the ' +
           'cache — it makes every generation share one key. A stale entry written under \'0\' is ' +
           'then served after the data has moved, which is the one failure a generation exists ' +
           'to prevent. ',
      from: `    try { gen = APP_getGen_('pricevolume') || '0'; } catch (e) {}`,
      to:   `    try { gen = APP_getGen_('pricevolume') || '0'; }
    catch (e) {
      /* '0' is not "no cache" — it is a key every generation shares, so an
         entry written under it outlives the data it describes. */
      APP_log('warn', 'APP.cacheKey', 'no data generation — every generation will share one cache key',
              { page: 'pricevolume', error: String(e) });
    }` },
  ],

  'PV_Lookup.gs': [

  /* ---- CHUNK 18: APP_log at the entry points, and the silent-catch pass ----
     Declared like every other edit, so the other ~10,800 lines stay proved verbatim.
     script.gs §2 carries the census and the rule each one was decided by. */
    { kind: 'replace',
      why: 'PLAN §18 names this as one of the four, because tests/pvlookup.js already covers it. ' +
           'The three lists are what the Mapping check card renders, so their sizes are the ' +
           'answer size. ',
      from: `function getPvUnmapped(opts)   { return PVLOOK.getUnmapped(opts); }`,
      to:   `function getPvUnmapped(opts) {
  var t0 = Date.now();
  APP_log('info', 'PVLOOK.getUnmapped', 'reading',
          { upload: !!(opts && opts.upload), force: !!(opts && opts.force) });
  try {
    var out = PVLOOK.getUnmapped(opts);
    /* The three lists ARE the answer — one row per distinct unmapped value —
       so their sizes are the size §7 asks for, not the bytes behind them. */
    APP_log('info', 'PVLOOK.getUnmapped', 'ok',
            { ms: Date.now() - t0,
              rows: ((out && out.product) || []).length + ((out && out.extras) || []).length +
                    ((out && out.flag) || []).length,
              product: ((out && out.product) || []).length,
              extras:  ((out && out.extras)  || []).length,
              flag:    ((out && out.flag)    || []).length });
    return out;
  } catch (err) {
    APP_log('error', 'PVLOOK.getUnmapped', 'failed',
            { ms: Date.now() - t0, upload: !!(opts && opts.upload),
              error: String(err && err.message ? err.message : err) });
    throw err;
  }
}` },
    { kind: 'replace',
      why: 'A lock that is not released blocks the next writer until the service times it out. ' +
           'It is in a finally, so the write itself has already succeeded or failed on its own ' +
           'terms — but the next user just sees the page hang. (The two copies are ' +
           'byte-identical, so the anchor carries the line above it to name which namespace it ' +
           'is in.) ',
      from: `             formulasCopied: copied, generation: APP_getGen_('pricevolume') };

  } finally {
    try { lock.releaseLock(); } catch (e){}
  }`,
      to:   `             formulasCopied: copied, generation: APP_getGen_('pricevolume') };

  } finally {
    try { lock.releaseLock(); }
    catch (e) { APP_log('warn', 'PVLOOK.applyRows', 'the lock was not released — the next writer will wait it out',
                        { error: String(e) }); }
  }` },
    { kind: 'replace',
      why: 'A FALLBACK CHAIN WHOSE FALLBACK IS ALSO SILENT. If clearCache throws it tries to ' +
           'bump the generation instead, which is the right design — but if that throws too, the ' +
           'rows have been WRITTEN to the sheet and nothing has been invalidated, so the Mapping ' +
           'check keeps reporting the values that were just mapped. ',
      from: `      try { PV.clearCache(); } catch (e){ try { APP_bumpGen_('pricevolume'); } catch (e2){} }`,
      to:   `      try { PV.clearCache(); }
      catch (e){
        try { APP_bumpGen_('pricevolume'); }
        catch (e2){
          /* Both ways of invalidating failed and the rows are already written,
             so the Mapping check will keep reporting the values just mapped. */
          APP_log('warn', 'PVLOOK.applyRows', 'rows written but NO cache was invalidated — ' +
                  'the mapping check will still show them as unmapped',
                  { error: String(e), fallback: String(e2) });
        }
      }` },
  ],

  'QlikSync.gs': [
    { kind: 'replace',
      why: 'The two Logger.log calls left in the trigger target. §7\'s whole point is ONE ' +
           'convention and one switch: a Logger.log carries no level, so in Cloud Logging a ' +
           'pipeline that synced bad tabs reads exactly like a routine run — and this is the ' +
           'function nobody is watching. ',
      from: `      if (!res.ok) {
        out.failed.push(src.label + ': ' + JSON.stringify(res.failed));
        Logger.log('QlikView ' + src.label + ' synced with bad tabs: ' + JSON.stringify(res.failed));
      }`,
      to:   `      if (!res.ok) {
        out.failed.push(src.label + ': ' + JSON.stringify(res.failed));
        /* A run that FINISHED but wrote a bad tab is deliberately not retried
           (see above), so this line is the only record that it happened. */
        APP_log('warn', 'QLIKSYNC.check', 'synced, but some tabs did not write',
                { source: src.label, failed: res.failed });
      }` },
    { kind: 'replace',
      why: 'The summary line, and the one a human goes looking for. It also gains the count and ' +
           'the elapsed ms, so an hourly run that is getting slower is visible without a second ' +
           'line. ',
      from: `  props.setProperty(QLIK_STAMP_KEY, JSON.stringify(seen));
  if (out.failed.length) Logger.log('QlikView check: ' + out.failed.join(' | '));
  return out;`,
      to:   `  props.setProperty(QLIK_STAMP_KEY, JSON.stringify(seen));
  APP_log(out.failed.length ? 'error' : 'info', 'QLIKSYNC.check', 'done',
          { ms: Date.now() - t0, changed: out.changed.length,
            unchanged: out.unchanged.length, failed: out.failed.length,
            detail: out.failed.length ? out.failed.join(' | ') : '' });
  return out;` },

  /* ---- CHUNK 18: APP_log at the entry points, and the silent-catch pass ----
     Declared like every other edit, so the other ~10,800 lines stay proved verbatim.
     script.gs §2 carries the census and the rule each one was decided by. */
    { kind: 'replace',
      why: 'PLAN §18 names this as one of the four. It is the TIME-DRIVEN TRIGGER TARGET — the ' +
           'whole QlikView pipeline runs through it and NOBODY IS WATCHING WHEN IT RUNS, so the ' +
           'log line is the only account of it that will ever exist. The Logger.log it replaces ' +
           'carried no level, so a failed pipeline run and a routine one read the same in Cloud ' +
           'Logging. ',
      from: `function qlikSyncCheck() {
  var props = PropertiesService.getScriptProperties();
  var seen = {};
  try { seen = JSON.parse(props.getProperty(QLIK_STAMP_KEY) || '{}'); } catch (e) { seen = {}; }

  var sources;
  try { sources = QLIKSYNC.sources(); }
  catch (e) { Logger.log('QlikView check failed: ' + e.message); return { ok: false, error: e.message }; }`,
      to:   `function qlikSyncCheck() {
  /* THE TRIGGER TARGET. Nothing in the repo points at it (there is not one
     ScriptApp.newTrigger in the codebase — see §11's banner), it runs hourly
     with nobody watching, and every page's data depends on it. The log line is
     the only account of a run that will ever exist, which is why the entry is
     logged before anything can throw. */
  var t0 = Date.now();
  APP_log('info', 'QLIKSYNC.check', 'trigger fired');
  var props = PropertiesService.getScriptProperties();
  var seen = {};
  try { seen = JSON.parse(props.getProperty(QLIK_STAMP_KEY) || '{}'); }
  catch (e) {
    /* NOT SILENT (§7). A corrupt stamp property means every source looks
       changed, so the next line re-syncs all of them — minutes of Drive work
       that reads as a normal busy run. */
    APP_log('warn', 'QLIKSYNC.check', 'stamps unreadable — every source will look changed',
            { error: String(e) });
    seen = {};
  }

  var sources;
  try { sources = QLIKSYNC.sources(); }
  catch (e) {
    APP_log('error', 'QLIKSYNC.check', 'could not list the sources — the pipeline did not run',
            { ms: Date.now() - t0, error: String(e && e.message || e) });
    return { ok: false, error: e.message };
  }` },
    { kind: 'replace',
      why: 'A Drive file that will not go to the trash is litter, not corruption — but a folder ' +
           'quietly filling up over months is a thing somebody eventually has to explain, and ' +
           'one line is the difference between explaining it and guessing. ',
      from: `  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}`,
      to:   `  try { DriveApp.getFileById(fileId).setTrashed(true); }
  catch (e) { APP_log('warn', 'APP.trashFile', 'could not trash the file — it stays in the folder',
                      { fileId: fileId, error: String(e) }); }` },
    { kind: 'replace',
      why: 'THE HIGHEST-SEVERITY SILENT CATCH IN THE FILE. This runs after a QlikView sync has ' +
           'written new data. If syncAll throws, the pipeline has succeeded, the sheets hold new ' +
           'numbers, and every page keeps serving the old ones out of cache — with the sync ' +
           'reporting success. Error, not warn: nothing else in the system will notice. ',
      from: `  try { syncAll(); } catch (e) {}`,
      to:   `  try { syncAll(); }
  catch (e) {
    /* The sync WORKED and the caches were not cleared, so every page will keep
       serving pre-sync numbers while reporting success. There is nothing else
       in the system that notices this. */
    APP_log('error', 'QLIKSYNC.run', 'data synced but the caches were NOT cleared — pages will serve stale figures',
            { error: String(e && e.message || e) });
  }` },
    { kind: 'replace',
      why: 'A stamp that cannot be read means this source looks CHANGED on the next check, so ' +
           'the whole export is re-synced — minutes of Drive work that reads as a normal busy ' +
           'run. ',
      from: `    try { seen[src.key] = String(DriveApp.getFileById(src.id).getLastUpdated().getTime()); }
    catch (e) {}
  });
  PropertiesService.getScriptProperties().setProperty(QLIK_STAMP_KEY, JSON.stringify(seen));`,
      to:   `    try { seen[src.key] = String(DriveApp.getFileById(src.id).getLastUpdated().getTime()); }
    catch (e) {
      APP_log('warn', 'QLIKSYNC.markCurrent', 'no stamp for this source — it will look changed ' +
              'on the next check and be re-synced', { source: src.key, error: String(e) });
    }
  });
  PropertiesService.getScriptProperties().setProperty(QLIK_STAMP_KEY, JSON.stringify(seen));` },
    { kind: 'replace',
      why: 'qlikSyncNow\'s own comment says it records the stamps \'so the next check does not ' +
           'immediately redo the same work\'. A silent parse failure defeats exactly that: seen ' +
           'starts empty, only the sources this run covered are written back, and EVERY OTHER ' +
           'SOURCE\'S STAMP IS WIPED — so the next hourly check re-syncs all of them. Minutes of ' +
           'Drive work that reads as a normal run. ',
      from: `    var props = PropertiesService.getScriptProperties(), seen = {};
    try { seen = JSON.parse(props.getProperty(QLIK_STAMP_KEY) || '{}'); } catch (e) {}
    QLIKSYNC.sources().forEach(function (src) {
      if (want !== 'all' && src.scope !== want) return;
      try { seen[src.key] = String(DriveApp.getFileById(src.id).getLastUpdated().getTime()); }
      catch (e) {}
    });`,
      to:   `    var props = PropertiesService.getScriptProperties(), seen = {};
    try { seen = JSON.parse(props.getProperty(QLIK_STAMP_KEY) || '{}'); }
    catch (e) {
      /* Not silent (§7). Starting from {} means only the sources this run
         covered get written back and every OTHER stamp is wiped, so the next
         hourly check re-syncs the lot — which is the one thing this function
         says it exists to prevent. */
      APP_log('warn', 'QLIKSYNC.syncNow', 'stamps unreadable — the other sources will be ' +
              're-synced on the next check', { scope: want, error: String(e) });
      seen = {};
    }
    QLIKSYNC.sources().forEach(function (src) {
      if (want !== 'all' && src.scope !== want) return;
      try { seen[src.key] = String(DriveApp.getFileById(src.id).getLastUpdated().getTime()); }
      catch (e) {
        APP_log('warn', 'QLIKSYNC.syncNow', 'no stamp for this source — it will be re-synced ' +
                'on the next check', { source: src.key, error: String(e) });
      }
    });` },
    { kind: 'replace',
      why: 'QLIK_REPORT_MONTH is read back by the Overview\'s segment reader as the year for its ' +
           'columns — the fallback that now warns when it is missing. This is where it is ' +
           'WRITTEN, so a silent failure here is the cause of that symptom, two sections away. ',
      from: `              try {
                PropertiesService.getScriptProperties().setProperty(
                  'QLIK_REPORT_MONTH', res.reportMonth.y + '-' + res.reportMonth.m);
              } catch (e2) {}`,
      to:   `              try {
                PropertiesService.getScriptProperties().setProperty(
                  'QLIK_REPORT_MONTH', res.reportMonth.y + '-' + res.reportMonth.m);
              } catch (e2) {
                /* The Overview reads this back as the year on its segment
                   columns. Silent here is the cause of a missing year there,
                   two sections away and with nothing connecting them. */
                APP_log('warn', 'QLIKSYNC.run', 'could not record the report month — the ' +
                        'Overview will show its segment columns without a year',
                        { tab: spec.tab, error: String(e2) });
              }` },
    { kind: 'replace',
      why: 'The third unreleased lock, and the one that matters most: this is the sync itself, ' +
           'so the next hourly firing waits it out and the pipeline skips an hour. ',
      from: `      try { lock.releaseLock(); } catch (e2) {}`,
      to:   `      try { lock.releaseLock(); }
      catch (e2) { APP_log('warn', 'QLIKSYNC.run', 'the sync lock was not released — the next ' +
                           'hourly run will wait it out', { error: String(e2) }); }` },
  ],

  'PV_Backend.gs': [

  /* ---- DEAD CODE FOUND BY THE 404-NAME AUDIT ---------------------------------
     Not debug functions — those are all gone. These are IIFE-private helpers with
     zero readers anywhere in script.gs, app.html or tests/, which the trailing
     underscore also puts out of reach of google.script.run. */
    /* gone: [] — the scope-aware analyser puts this INSIDE the namespace IIFE, so it
       was never one of the top-level names check 3 tracks. That is a stronger
       statement than 'no caller': it was never reachable from outside this section. */
    { kind: 'replace', gone: [],
      why: 'PV_MONTH_NAMES_ — a month-name constant with zero readers. pvMonthNum_ four lines ' +
           'below carries its own three-letter map and every renderer formats months in the ' +
           'browser, so nothing on the server has needed a list of month names. Not reachable ' +
           'from a page either: the trailing underscore is Apps Script\'s private convention and ' +
           'google.script.run cannot call a var. ',
      from: `var PV_MONTH_NAMES_ = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];

`,
      to:   `` },
    /* gone: [] — the scope-aware analyser puts this INSIDE the namespace IIFE, so it
       was never one of the top-level names check 3 tracks. That is a stronger
       statement than 'no caller': it was never reachable from outside this section. */
    { kind: 'replace', gone: [],
      why: 'pvMonthFor_ — a two-line wrapper over pvMonthSel_ that nothing calls. pvMonthSel_ ' +
           'itself is live and stays; this is the sign-carrying variant (MTD positive, YTD ' +
           'negative) that callers stopped using when the period stopped being encoded in the ' +
           'month. ',
      from: `/* sel: 1-12 pins the report to that month; 0 or absent uses the report month.
   MTD returns it positive, YTD negative - one number carries both. */
function pvMonthFor_(rows, period, sel) {
  var m = pvMonthSel_(rows, sel);
  return (period === 'MTD') ? m : -m;
}
`,
      to:   `` },

  /* ---- CHUNK 18: APP_log at the entry points, and the silent-catch pass ----
     Declared like every other edit, so the other ~10,800 lines stay proved verbatim.
     script.gs §2 carries the census and the rule each one was decided by. */
    { kind: 'replace',
      why: 'bumpGeneration_ exists to make every cached answer unreachable. Dropping the stamp ' +
           'is half of that, and a silent failure leaves the two halves disagreeing: a new ' +
           'generation with the old modified time behind it. ',
      from: `  try { APP_forgetStamp_('pricevolume'); } catch (e) {}`,
      to:   `  try { APP_forgetStamp_('pricevolume'); }
  catch (e) { APP_log('warn', 'PV.bumpGeneration', 'generation moved but the source stamp did not — ' +
                      'freshness checks will disagree with the cache', { error: String(e) }); }` },
  ],

  'RFSC_Backend.gs': [

  /* ---- CHUNK 18: APP_log at the entry points, and the silent-catch pass ----
     Declared like every other edit, so the other ~10,800 lines stay proved verbatim.
     script.gs §2 carries the census and the rule each one was decided by. */
    { kind: 'replace',
      why: 'THE GENERATION IS PART OF THE CACHE KEY, so falling back to \'0\' does not disable the ' +
           'cache — it makes every generation share one key. A stale entry written under \'0\' is ' +
           'then served after the data has moved, which is the one failure a generation exists ' +
           'to prevent. ',
      from: `    try { gen = APP_getGen_('rmx') || '0'; } catch (e) {}`,
      to:   `    try { gen = APP_getGen_('rmx') || '0'; }
    catch (e) {
      /* '0' is not "no cache" — it is a key every generation shares, so an
         entry written under it outlives the data it describes. */
      APP_log('warn', 'APP.cacheKey', 'no data generation — every generation will share one cache key',
              { page: 'rmx', error: String(e) });
    }` },
  ],

  'RMX_Suggest.gs': [

  /* ---- CHUNK 18: APP_log at the entry points, and the silent-catch pass ----
     Declared like every other edit, so the other ~10,800 lines stay proved verbatim.
     script.gs §2 carries the census and the rule each one was decided by. */
    { kind: 'replace',
      why: 'A lock that is not released blocks the next writer until the service times it out. ' +
           'It is in a finally, so the write itself has already succeeded or failed on its own ' +
           'terms — but the next user just sees the page hang. (The two copies are ' +
           'byte-identical, so the anchor carries the line above it to name which namespace it ' +
           'is in.) ',
      from: `    return { ok: true, added: out.length, skipped: skipped.length, skippedValues: skipped };

  } finally {
    try { lock.releaseLock(); } catch (e){}
  }`,
      to:   `    return { ok: true, added: out.length, skipped: skipped.length, skippedValues: skipped };

  } finally {
    try { lock.releaseLock(); }
    catch (e) { APP_log('warn', 'RMXSUGGEST.applyRows', 'the lock was not released — the next writer will wait it out',
                        { error: String(e) }); }
  }` },
  ],

  'Kpi_Backend.gs': [

  /* ---- CHUNK 18: APP_log at the entry points, and the silent-catch pass ----
     Declared like every other edit, so the other ~10,800 lines stay proved verbatim.
     script.gs §2 carries the census and the rule each one was decided by. */
    { kind: 'replace',
      why: 'Same as APP_trashFile_: litter rather than corruption, and the same one line is what ' +
           'stops a folder filling up unexplained. ',
      from: `function trash_(id) { if (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} } }`,
      to:   `function trash_(id) {
  if (!id) return;
  try { DriveApp.getFileById(id).setTrashed(true); }
  catch (e) { APP_log('warn', 'DECK.trash', 'could not trash the file — it stays in the deck folder',
                      { fileId: id, error: String(e) }); }
}` },
  ],

};

/* The nine names chunk 12 WROTE: §2 logging and §4 permissions. */
/* Top-level names script.gs has that no source file did. The chunk-12 nine are the
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
         literal here on purpose — reading it back out of script.gs would make the
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
const app = fs.readFileSync(path.join(REPO, 'script.gs'), 'utf8');

console.log('script.gs against the 16 .gs files at ' + REF + ':\n');

/* ---- 5. line endings ---------------------------------------------------- */
check('LF throughout — no CR survived the merge', app.indexOf('\r') === -1,
  'PLAN.md §12 pins script.gs to LF. An editor has flipped it.');

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
  check('the brace/paren/bracket count balances — the analyser read script.gs correctly',
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
