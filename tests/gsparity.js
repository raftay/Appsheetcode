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
 * THE DECK'S LAYOUT MAP, SPELLED OUT — because a declared edit has to BE the
 * text, not a reference to it. Reading this out of script.gs would make the
 * check vacuous: it would prove the file matches itself. Anything in the file
 * that drifts from this block fails "§9 Deck_Backend.gs verbatim", which is
 * exactly what a declared edit is for.
 * ======================================================================== */
const DECK_LAYOUT_STORE = `  function templateId_() { return cfg_('TEMPLATE_ID', DECK_CONFIG.PROP_TEMPLATE); }
  function folderId_() { return cfg_('FOLDER_ID', DECK_CONFIG.PROP_FOLDER); }

  /* ======================================================================
   * THE LAYOUT MAP - which template layout each recipe row is built from
   * ----------------------------------------------------------------------
   * DECK_RECIPE names a layout per row. That is the DEFAULT, and it is now
   * overridable from the Deck Builder page: pick a different layout for a
   * slide and it is written here, shared, and used by every build after it
   * until somebody picks again.
   *
   * ONLY THE DIFFERENCES ARE STORED. A row built from its recipe layout has
   * no key at all, which is what keeps an edit to DECK_RECIPE meaningful:
   * copying all 43 rows in here the first time anyone touched one would
   * freeze the recipe, and the next person to re-point a slide in the code
   * would change nothing and have no way to see why.
   *
   * NOTHING HERE VALIDATES AGAINST THE TEMPLATE, deliberately. This runs
   * with no Slides call, DECK_getRecipe is the page's first request, and
   * opening the template to check a name would put a multi-second API call
   * in front of the one stage that is meant to be instant. An override
   * naming a layout the template does not have is caught where every other
   * bad layout already is - readTemplate returns the real list, and the page
   * banners the mismatch before a build can start. Saving is checked instead
   * at the point of saving, where the page has the template open anyway.
   * ==================================================================== */
  function layoutMap_() {
    var raw = '';
    try { raw = PropertiesService.getScriptProperties().getProperty(DECK_CONFIG.PROP_LAYOUTS) || ''; }
    catch (e) { return {}; }
    if (!raw) return {};
    var o;
    /* A property that will not parse is not worth an error on every Plan:
       one bad write would lock the page out of a stage that has a perfectly
       good default sitting in DECK_RECIPE. Fall back to no overrides and
       say so in the log. */
    try { o = JSON.parse(raw); } catch (e) {
      Logger.log('DECK layout map is not valid JSON - ignoring it. Value: %s', raw);
      return {};
    }
    if (!o || typeof o !== 'object' || o instanceof Array) return {};
    var out = {};
    for (var k in o) {
      if (o.hasOwnProperty(k) && typeof o[k] === 'string' && o[k]) out[k] = o[k];
    }
    return out;
  }

  function writeLayoutMap_(map) {
    var props = PropertiesService.getScriptProperties();
    var keys = Object.keys(map);
    /* An empty map is a DELETED property, not the string "{}" - so "has
       anybody overridden anything?" stays one question with one answer. */
    if (!keys.length) props.deleteProperty(DECK_CONFIG.PROP_LAYOUTS);
    else props.setProperty(DECK_CONFIG.PROP_LAYOUTS, JSON.stringify(map));
    return map;
  }

  /* Set one row's layout. Passing the row's own recipe layout, or '', REMOVES
     the override rather than storing a key that says "the default" - see the
     only-the-differences rule above. Returns the whole map so the caller can
     see the state it just produced instead of assuming it. */
  function setLayout_(recipeId, layoutId) {
    recipeId = String(recipeId || '');
    layoutId = String(layoutId || '');
    if (!recipeId) fail_('setLayout needs a recipe row id.');

    var row = null;
    for (var i = 0; i < DECK_RECIPE.length; i++) {
      if (DECK_RECIPE[i].id === recipeId) { row = DECK_RECIPE[i]; break; }
    }
    if (!row) fail_('No recipe row with id "' + recipeId + '".');

    /* Checked HERE and not in layoutMap_ because this is the one path that
       already has a reason to open the template: a name that does not exist
       must never reach the store, or every later Plan carries the mistake. */
    if (layoutId) {
      var tpl = readTemplate(null), ok = false, names = [];
      for (var j = 0; j < tpl.layouts.length; j++) {
        if (tpl.layouts[j].role !== 'report') continue;
        names.push(tpl.layouts[j].layoutId);
        if (tpl.layouts[j].layoutId === layoutId) ok = true;
      }
      if (!ok) {
        fail_('"' + layoutId + '" is not a report layout in this template. ' +
          'It has: ' + (names.join(', ') || 'none') + '.');
      }
    }

    var map = layoutMap_();
    if (!layoutId || layoutId === row.layout) delete map[recipeId];
    else map[recipeId] = layoutId;

    writeLayoutMap_(map);
    Logger.log('DECK layout: %s -> %s', recipeId, map[recipeId] || (row.layout + ' (default)'));
    return { recipeId: recipeId, layout: map[recipeId] || row.layout,
             overridden: !!map[recipeId], map: map };
  }

  /* Put every row back on the layout DECK_RECIPE names. */
  function resetLayouts_() {
    writeLayoutMap_({});
    Logger.log('DECK layout map cleared - every row is back on its recipe layout.');
    return { map: {} };
  }
`;

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

  /* ---- CHUNK 23: the year-named columns are found by shape ---------------------
     13 hunk(s), all of them the same edit: a year that was typed out
     becomes a year that was read. gone: [] on every one — nothing was deleted. */
    { kind: 'replace', gone: [],
      why: 'CHUNK 23 — READY-MIX ASKED FOR ITS COLUMNS BY YEAR NAME. col_(s, \'2026 vol\') returns -1 on a 2027 export, toNum_ turns the missing cell into 0, and every figure on the page reads zero without anything failing. The one new helper, yearPair_, finds the year-named columns by SHAPE and keeps the two newest — the same thing RFSC_Backend.gs\'s mainCols_ has always done. The years then travel out with the bundle and on every payload, so no page has to spell one out. bundleOk_ rejects a bundle written before they did, which rebuilds it once. ',
      from: `function col_(sheet, name){ var i = sheet.idx[norm_(name)]; return (i==null?-1:i); }`,
      to: `function col_(sheet, name){ var i = sheet.idx[norm_(name)]; return (i==null?-1:i); }

/* ---- THE YEAR IS IN THE COLUMN NAME, AND IT IS THE DATA'S YEAR ------------
   "2026 Vol", "2025 Net Sales ex VA (CAD)", "Total Revenue - 2026". This file
   deliberately ignores the year on the ROW (see loadMain_'s header) and takes
   current vs prior from the COLUMNS — which was right, and was then spelled out
   as literals, so the two newest years were pinned to 2026 and 2025 in eight
   places. On the first export of a new year every one of those lookups returns
   -1, toNum_ turns the missing cell into 0, and the page publishes a full set
   of zeroes without failing: the exact shape of bug this suite keeps paying for.

   So the pattern is matched instead and the two NEWEST years found are CY and
   PY. RFSC_Backend.gs's mainCols_ has always done it this way; this is the rest
   of Ready-Mix catching up (PLAN.md chunk 23).

   The regex must be non-global: exec on a /g regex carries lastIndex between calls
   and would skip every other column. */
function yearPair_(sheet, re){
  var found = {}, k;
  for (k in sheet.idx){
    var m = re.exec(k);
    if (m) found[Number(m[1])] = sheet.idx[k];
  }
  var ys = Object.keys(found).map(Number).sort(function(a,b){ return b-a; });
  return { cy:    ys.length     ? ys[0] : 0,
           py:    ys.length > 1 ? ys[1] : 0,
           cyCol: ys.length     ? found[ys[0]] : -1,
           pyCol: ys.length > 1 ? found[ys[1]] : -1,
           years: ys };
}
/* (kept small on purpose: one place decides what a year column looks like) */
function yearsInHeader_(sheet, re){ return yearPair_(sheet, re).years; }` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `      cPyV=col_(s,'2025 vol'), cPyR=col_(s,'2025 net sales ex va (cad)'),
      cCyV=col_(s,'2026 vol'), cCyR=col_(s,'2026 net sales ex va (cad)'),`,
      to: `      /* CY and PY are the two newest years the COLUMNS carry — see yearPair_.
         Not 2026 and 2025, which is what these four lines used to say. */
      vY=yearPair_(s, /^(\\d{4}) vol$/),
      rY=yearPair_(s, /^(\\d{4}) net sales ex va \\(cad\\)$/),
      cPyV=vY.pyCol, cPyR=rY.pyCol,
      cCyV=vY.cyCol, cCyR=rY.cyCol,` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `      pyVol: pyV, pyRev: pyR, cyVol: cyV, cyRev: cyR,
      cyFsc: (cCyF===-1?0:toNum_(row[cCyF])), pyFsc: (cPyF===-1?0:toNum_(row[cPyF])) });
  }
  return out;
}`,
      to: `      pyVol: pyV, pyRev: pyR, cyVol: cyV, cyRev: cyR,
      cyFsc: (cCyF===-1?0:toNum_(row[cCyF])), pyFsc: (cPyF===-1?0:toNum_(row[cPyF])) });
  }
  /* WHICH TWO YEARS THESE ROWS ARE, carried on the array itself so the bundle
     and then every payload can say so without re-reading the header.
     PV_Backend.gs stamps getRawEnriched_'s array the same way. */
  out.cyYear = vY.cy || rY.cy;
  out.pyYear = vY.py || rY.py;
  return out;
}` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `      cPyR=col_(s,'total revenue - 2025'), cCyR=col_(s,'total revenue - 2026'),
      cPyM=col_(s,'m3 applied to - 2025'), cCyM=col_(s,'m3 applied to - 2026');`,
      to: `      /* the two newest years the columns carry, not two literals */
      rY=yearPair_(s, /^total revenue - (\\d{4})$/),
      mY=yearPair_(s, /^m3 applied to - (\\d{4})$/),
      cPyR=rY.pyCol, cCyR=rY.cyCol,
      cPyM=mY.pyCol, cCyM=mY.cyCol;` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `      pyRev: pyR, cyRev: cyR, pyM3: pyM, cyM3: cyM });
  }
  return out;
}
/* =================== data bundle (cached, period-agnostic) =================== */`,
      to: `      pyRev: pyR, cyRev: cyR, pyM3: pyM, cyM3: cyM });
  }
  out.cyYear = rY.cy || mY.cy;
  out.pyYear = rY.py || mY.py;
  return out;
}
/* =================== data bundle (cached, period-agnostic) =================== */` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `  var bundle = {
    main:   main,
    extras: loadStream_(LK, CONFIG.SHEETS.EXTRA, null, bag),
    assoc:  loadStream_(LK, CONFIG.SHEETS.ASSOC, null, bag),
    markets: marketsOf_(LK),
    latestMonth: latest,
    months: monthsOf_(main),
    unmapped: finishUnmapped_(bag)
  };`,
      to: `  var bundle = {
    main:   main,
    extras: loadStream_(LK, CONFIG.SHEETS.EXTRA, null, bag),
    assoc:  loadStream_(LK, CONFIG.SHEETS.ASSOC, null, bag),
    markets: marketsOf_(LK),
    latestMonth: latest,
    months: monthsOf_(main),
    /* the two years the Main tab's columns carry, so every payload below can
       label its own headings instead of the page spelling out a year */
    cyYear: main.cyYear || 0,
    pyYear: main.pyYear || 0,
    unmapped: finishUnmapped_(bag)
  };` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `function bundleOk_(b){
  return !!(b && b.main && b.months
            && Number(b.latestMonth) >= 1 && Number(b.latestMonth) <= 12);
}`,
      to: `function bundleOk_(b){
  return !!(b && b.main && b.months
            && Number(b.latestMonth) >= 1 && Number(b.latestMonth) <= 12
            /* chunk 23: a bundle written before the years travelled with the
               data has none, and a page reading it would fall back to a
               hard-coded pair. Same rule as the months check above, for the same
               reason — rebuild it rather than repair it. */
            && Number(b.cyYear) > 0);
}` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `    var b = loadDataCached_(false);
    out.latestMonth = bundleMonth_(b);
    out.months = bundleMonths_(b);`,
      to: `    var b = loadDataCached_(false);
    out.latestMonth = bundleMonth_(b);
    out.months = bundleMonths_(b);
    /* the two years the data names, so the page's headings never spell one out
       themselves (PLAN.md chunk 23) */
    out.cyYear = b.cyYear; out.pyYear = b.pyYear;` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `  function stamp(o){
    o.month = month;
    o.latestMonth = bundleMonth_(bundle);
    o.months = bundleMonths_(bundle);`,
      to: `  function stamp(o){
    o.month = month;
    o.latestMonth = bundleMonth_(bundle);
    o.months = bundleMonths_(bundle);
    o.cyYear = bundle.cyYear; o.pyYear = bundle.pyYear;` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `           month:month, latestMonth:bundleMonth_(bundle),
           months:bundleMonths_(bundle),
           build:BUILD, generation:generation_(),`,
      to: `           month:month, latestMonth:bundleMonth_(bundle),
           months:bundleMonths_(bundle),
           cyYear:bundle.cyYear, pyYear:bundle.pyYear,
           build:BUILD, generation:generation_(),` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `             month: monthSel_(bundle, opts.month),
             latestMonth: bundleMonth_(bundle),
             months: bundleMonths_(bundle),
             build: BUILD,
             breakdowns:CONFIG.BREAKDOWNS, generation:generation_() };`,
      to: `             month: monthSel_(bundle, opts.month),
             latestMonth: bundleMonth_(bundle),
             months: bundleMonths_(bundle),
             cyYear: bundle.cyYear, pyYear: bundle.pyYear,
             build: BUILD,
             breakdowns:CONFIG.BREAKDOWNS, generation:generation_() };` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `             month:       monthSel_(bundle, opts.month),
             latestMonth: bundleMonth_(bundle),
             months:      bundleMonths_(bundle),
             markets:     bundle.markets || [],`,
      to: `             month:       monthSel_(bundle, opts.month),
             latestMonth: bundleMonth_(bundle),
             months:      bundleMonths_(bundle),
             cyYear:      bundle.cyYear, pyYear: bundle.pyYear,
             markets:     bundle.markets || [],` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `    rowCount: full.length, latestMonth: bundleMonth_(bundle),`,
      to: `    rowCount: full.length, latestMonth: bundleMonth_(bundle),
    cyYear: bundle.cyYear, pyYear: bundle.pyYear,` },


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

  /* ---- WHICH LAYOUT EACH RECIPE ROW USES, CHOSEN FROM THE PAGE -------------
     DECK_RECIPE's `layout` column was the only answer, and changing it meant a
     code push by somebody with editor access — for a decision ("this slide
     should be the full-width layout, not the one with a comment box") that is
     nobody's idea of code. It is a stored override now: a shared Script
     Property holding ONLY the rows that differ, applied by DECK_getRecipe.

     THREE HUNKS, all additive. Nothing that was here changed behaviour; the
     export block gained three names and the thin-globals block gained two. */
    { kind: 'replace', gone: [],
      why: 'the store itself, beside the other two Script Property readers it is modelled on ' +
           '(templateId_ / folderId_ above). It holds the DIFFERENCES from DECK_RECIPE and not ' +
           'a copy of it, which is what keeps editing the recipe meaningful: writing all 43 rows ' +
           'in the first time anyone touched one would freeze the array, and the next person to ' +
           're-point a slide in the code would change nothing and have no way to see why. ' +
           'setLayout_ is the one path that validates against the template, because it is the ' +
           'one path that already has a reason to open it — DECK_getRecipe must stay instant.',
      from: `  function templateId_() { return cfg_('TEMPLATE_ID', DECK_CONFIG.PROP_TEMPLATE); }
  function folderId_() { return cfg_('FOLDER_ID', DECK_CONFIG.PROP_FOLDER); }
`,
      to: DECK_LAYOUT_STORE },

    { kind: 'replace', gone: [],
      why: 'and the namespace exports the three, so DECK_getRecipe and the two thin globals have ' +
           'one implementation to reach rather than a second copy of the same property key.',
      from: `  return {
    readTemplate: readTemplate, validateTemplate: validateTemplate,
    create: create, addSlide: addSlide, finish: finish, status: status
  };`,
      to: `  return {
    readTemplate: readTemplate, validateTemplate: validateTemplate,
    create: create, addSlide: addSlide, finish: finish, status: status,
    layoutMap: layoutMap_, setLayout: setLayout_, resetLayouts: resetLayouts_
  };` },

    { kind: 'replace', gone: [], added: ['DECK_setLayout', 'DECK_resetLayouts'],
      why: 'and the page can reach them. google.script.run only sees top-level functions, so ' +
           'the same thin-wrapper pattern as the six above it.',
      from: `function DECK_status(deckId) { return DECK.status(deckId); }`,
      to: `function DECK_status(deckId) { return DECK.status(deckId); }
/* The layout map. setLayout opens the template to check the name, so it is the
   slow one of the three and the only one that can fail. */
function DECK_setLayout(recipeId, layoutId) { return DECK.setLayout(recipeId, layoutId); }
function DECK_resetLayouts() { return DECK.resetLayouts(); }` },
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

    { kind: 'replace', gone: [],
      why: 'and the file\'s own header stops telling people to edit code. "Change \'layout\' on ' +
           'these five rows" was the instruction for switching the Top 10 slides to an ' +
           'L_FULL_STACK; it is a dropdown now, and a header that still names a code push is ' +
           'how somebody ends up asking for editor access they do not need. Comment only.',
      from: ` *   Deck_Backend.gs but that layout is NOT in the shipped template. To switch:
 *   add the layout to the template, then change 'layout' on these five rows.`,
      to: ` *   Deck_Backend.gs but that layout is NOT in the shipped template. To switch:
 *   add the layout to the template, then pick it on those five rows in the Plan
 *   stage - which is now a dropdown, and no longer needs a code push.` },

  /* ---- THE LAYOUT MAP IS APPLIED HERE ------------------------------------
     DECK_getRecipe is the Plan stage's only request and it must stay instant,
     so this reads ONE Script Property and makes no Slides call. Two hunks:
     the read, and what a row now carries. */
    { kind: 'replace', gone: [],
      why: 'the saved overrides, read once for the whole recipe rather than per row.',
      from: `function DECK_getRecipe() {
  var seen = {}, problems = [], rows = [];

  for (var i = 0; i < DECK_RECIPE.length; i++) {`,
      to: `function DECK_getRecipe() {
  var seen = {}, problems = [], rows = [];

  /* Whatever anybody has re-pointed from the Deck Builder page. Only the rows
     that differ are in here; everything else keeps the layout below. Read ONCE
     for the whole recipe rather than per row - it is a single property. */
  var over = DECK.layoutMap();

  for (var i = 0; i < DECK_RECIPE.length; i++) {` },

    { kind: 'replace', gone: [],
      why: 'and a row says which layout it is BUILT from, which layout the recipe NAMES, and ' +
           'whether those differ. All three, because one on its own is a trap: the page offers ' +
           '"back to the default" from the second, and the third is the only way anybody can ' +
           'tell a deliberate override from one somebody picked by accident three months ago. ' +
           'The orphan check at the end is the same argument — an override whose row has since ' +
           'been deleted from DECK_RECIPE does nothing and explains nothing, so it is SAID. It ' +
           'is not deleted here: a read is not the place to write.',
      from: `    rows.push({
      id: r.id, source: r.source, market: r.market || '',
      /* a within-market narrowing, e.g. Southwest -> Land. The source decides
         what it means; nothing here needs to know. */
      refine: r.refine || '',
      period: r.period || '', layout: r.layout, title: r.title,
      subtitle: r.subtitle || '', group: r.group || 'Other',
      optional: !!r.optional
    });
  }

  return { rows: rows, count: rows.length, problems: problems };
}`,
      to: `    /* An override on a row with no layout of its own is still an override, so
       the check above stays about the RECIPE and this stays about the store. */
    var chosen = over[r.id] || r.layout;

    rows.push({
      id: r.id, source: r.source, market: r.market || '',
      /* a within-market narrowing, e.g. Southwest -> Land. The source decides
         what it means; nothing here needs to know. */
      refine: r.refine || '',
      period: r.period || '', layout: chosen, title: r.title,
      /* WHAT THE RECIPE SAYS, alongside what is being used. The page offers
         "back to default" from these two, and showing which rows have been
         moved is the only way anyone can tell a deliberate override from a
         layout somebody picked by accident three months ago. */
      recipeLayout: r.layout,
      layoutOverridden: !!(over[r.id] && over[r.id] !== r.layout),
      subtitle: r.subtitle || '', group: r.group || 'Other',
      optional: !!r.optional
    });
  }

  /* An override whose row has since been deleted from DECK_RECIPE would sit in
     the store forever, doing nothing and explaining nothing. Say so; do not
     delete it here, because a read is not the place to write. */
  for (var k in over) {
    if (over.hasOwnProperty(k) && !seen[k]) {
      problems.push('The saved layout for "' + k + '" points at a recipe row ' +
        'that no longer exists. It is being ignored. Use Reset layouts to clear it.');
    }
  }

  return { rows: rows, count: rows.length, problems: problems,
           overrides: over, overrideCount: Object.keys(over).length };
}` },
  ],

  'FSC_Backend.gs': [

  /* ---- CHUNK 23: the years come from the data, not from two literals -----------
     9 hunk(s), all of them the same edit: a year that was typed out
     becomes a year that was read. gone: [] on every one — nothing was deleted. */
    { kind: 'replace', gone: [],
      why: 'CHUNK 23 — THIS PAGE SUMMED TWO LITERAL YEARS AND WOULD HAVE PUBLISHED ZEROES. buildCells_ always keyed its buckets market|year|month with the year off the ROW, and always knew yMax — the newest year in the file — but every reader below compared against 2026 and 2025. On the first export of a new year every sum found nothing, and the page published a full table of zeroes under headings naming a year that had gone: no error, no empty state, just wrong numbers. RFSC_Backend.gs, the Ready-Mix twin, has carried cy/py since it was written; this is the Aggregates half catching up, hunk for hunk. tests/yearroll.js runs it against a 2031 workbook. ',
      from: `    var un = Object.keys(unknown);
    return { cells: cells, markets: markets, latest: latest || 1,
             monthList: monthList,
             unknownPlants: un.sort(), rows: used };`,
      to: `    var un = Object.keys(unknown);
    /* THE YEARS COME OUT WITH THE DATA. yMax is the newest year in the file and
       it has always decided which Rev column a row belongs to; everything below
       used to compare against the literals 2026 and 2025 instead, so on the
       first of January this page would have summed cells nothing had written
       and published a table of zeroes — silently, because zero is a number.
       RFSC_Backend.gs has carried cy/py since it was written; this is the
       Aggregates half catching up (PLAN.md chunk 23). */
    return { cells: cells, markets: markets, latest: latest || 1,
             monthList: monthList,
             cy: yMax, py: yMax - 1,
             unknownPlants: un.sort(), rows: used };` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `  function summaryFor_(D, months){
    var rows = D.markets.map(function(mk){
      var c = sum_(D, mk, 2026, months), p = sum_(D, mk, 2025, months);
      var f26 = c.avol ? c.fsc / c.avol : 0;
      var f25 = p.avol ? p.fsc / p.avol : 0;      // no 2025 charge → 0`,
      to: `  function summaryFor_(D, months){
    /* fscT2026 / fscT2025 ARE NOT YEARS, THEY ARE CY AND PY. The names are the
       suite's convention — RFSC_Backend.gs's header states it and keeps them
       for the same reason: the two fuel pages are clones and a field rename
       here would have to be a rename there and in both pages. The actual years
       travel as cyYear / pyYear in the payload. */
    var rows = D.markets.map(function(mk){
      var c = sum_(D, mk, D.cy, months), p = sum_(D, mk, D.py, months);
      var f26 = c.avol ? c.fsc / c.avol : 0;
      var f25 = p.avol ? p.fsc / p.avol : 0;      // no prior-year charge → 0` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `    var t = { totalVol:0, totalFSC:0, appliedVol:0, appliedNS:0, wv:0, wn:0, av25:0, fsc25:0 };
    D.markets.forEach(function(mk){
      var c = sum_(D, mk, 2026, months), p = sum_(D, mk, 2025, months);`,
      to: `    var t = { totalVol:0, totalFSC:0, appliedVol:0, appliedNS:0, wv:0, wn:0, av25:0, fsc25:0 };
    D.markets.forEach(function(mk){
      var c = sum_(D, mk, D.cy, months), p = sum_(D, mk, D.py, months);` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `      var c = D.cells[mk + '|2026|' + mo] || { fsc:0, avol:0 };
      var p = D.cells[mk + '|2025|' + mo] || { fsc:0, avol:0 };`,
      to: `      var c = D.cells[mk + '|' + D.cy + '|' + mo] || { fsc:0, avol:0 };
      var p = D.cells[mk + '|' + D.py + '|' + mo] || { fsc:0, avol:0 };` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `    var rows = months.map(line);
    var c = sum_(D, mk, 2026, months), p = sum_(D, mk, 2025, months);`,
      to: `    var rows = months.map(line);
    var c = sum_(D, mk, D.cy, months), p = sum_(D, mk, D.py, months);` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `    var rows = execOrder_(D.markets).map(function(mk){
      var c = sum_(D, mk, 2026, months), p = sum_(D, mk, 2025, months);`,
      to: `    var rows = execOrder_(D.markets).map(function(mk){
      var c = sum_(D, mk, D.cy, months), p = sum_(D, mk, D.py, months);` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `      // "New business": charged in 2026 but not 2025 → 2025 $/t and YOY show N/A,
      // and this market is left out of the Grand Total's 2025 $/t.`,
      to: `      // "New business": charged this year but not last → the prior-year $/t and
      // YOY show N/A, and this market is left out of the Grand Total's PY $/t.` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `    var yr = newestYear_(D, mk) || 2026;`,
      to: `    var yr = newestYear_(D, mk) || D.cy;` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `      months:      D.monthList || [],         // what the picker may offer
      monthNames:  MONTHS,
      summary: { MTD: summaryFor_(D, mtd), YTD: summaryFor_(D, ytd) },`,
      to: `      months:      D.monthList || [],         // what the picker may offer
      monthNames:  MONTHS,
      /* THE TWO YEARS THIS PAYLOAD IS ABOUT, read off the data rather than the
         calendar or a constant. Every heading and title on the page is labelled
         from these — see app.html §C, which holds the fallback for a payload
         that predates them. RMX Fuel Recovery has sent them since it was
         written; this is the pair that lets the two pages stay clones. */
      cyYear:      D.cy,
      pyYear:      D.py,
      summary: { MTD: summaryFor_(D, mtd), YTD: summaryFor_(D, ytd) },` },


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

  /* ---- CHUNK 20: the same fix, because this is the same copy --------------
     PV_Lookup's toNum_ was byte-identical to PV's. Chunk 15's table records the
     two as ONE dialect ("PV · PVLOOK"), so fixing one and not the other would
     have invented a fifth dialect inside a family — the precise shape of drift
     this whole set of chunks exists to stop. */
    { kind: 'replace', gone: [],
      why: 'The byte-identical twin of the PV_Backend.gs edit above, for the same reason. This ' +
           'copy sits under the mapping check, which ranks unmapped rows BY MONEY IMPACT — so ' +
           'a dropped negative here does not just change a total, it reorders the list of what ' +
           'to fix first. ',
      from: String.raw`  var s = String(v).trim(), pct = /%/.test(s);
  s = s.replace(/[$,%\s]/g, '');
  if (s === '' || s === '-') return 0;`,
      to:   String.raw`  var s = String(v).trim(), pct = /%/.test(s);
  /* THE PARENTHESES ARE A MINUS SIGN. An accounting export writes -1,234 as
     "(1,234)", and stripping only [$,%\s] left the brackets in place: parseFloat
     gave NaN and NaN became 0, so the figure was DROPPED rather than mis-signed
     — which is why nothing ever looked wrong. Every other toNum_ in the suite
     (FSC, RFSC, RMX, SASKRATES) has always read it as -1234; this is that rule,
     spelled the way they spell it, and it is the whole of PLAN.md chunk 20.
     It cannot touch a value that is not a parenthesised NUMBER: "(n/a)" still
     reads 0, because parseFloat still gives NaN. The percent rule above is
     untouched — chunk 15's point was that PV is RIGHT about "5%" and the others
     are wrong, and the two rules are about different inputs. */
  s = s.replace(/[$,%\s]/g, '').replace(/\(/g, '-').replace(/\)/g, '');
  if (s === '' || s === '-') return 0;` },

  /* ---- CHUNK 21: the mapping check keys on the schema it depends on ------- */
    { kind: 'replace', gone: [],
      why: 'PVLOOK.gk_ omitted SCHEMA_ where PV.gk_ carried it, so bumping the schema stranded ' +
           'every Price & Volume table and left this page\'s mapping check serving a result ' +
           'COMPUTED FROM rows of the old shape — a stale answer that looks exactly like a ' +
           'correct one. It reads PV.SCHEMA rather than declaring a second copy of the token, ' +
           'because a second literal is the thing nobody remembers to bump. Every existing ' +
           'entry under the old key becomes unreachable: one miss, then a rebuild, for one ' +
           'page\'s check. tests/pvlookup.js check 5 RUNS it — the read crosses an IIFE ' +
           'boundary, which is the half that can actually break. ',
      from: `function gen_(){ return APP_getGen_('pricevolume'); }
function gk_(k){ return 'pv|g' + gen_() + '|' + k; }`,
      to: `function gen_(){ return APP_getGen_('pricevolume'); }
/* PV.SCHEMA IS IN THE KEY, AND CHUNK 21 IS WHY. It was not, and PV's own key
   always had it — so bumping SCHEMA_ stranded every Price & Volume table and
   left this page's mapping check serving a result computed from rows of the old
   shape. Read at call time, never at construction: PV is above this IIFE, but
   nothing here should depend on that.

   THE TWO KEYS ARE STILL NOT THE SAME KEY, deliberately. PV keys on the raw
   source stamp; this keys on APP_getGen_, which is that stamp PLUS
   APP_CODE_BUILD — so a code push already invalidates the check and does not
   invalidate PV's tables. That is the safe direction of the two (an extra
   rebuild, never a stale read) and it is left alone.

   Every existing entry under the old key is now unreachable: one miss, then a
   rebuild, for one page's mapping check. */
function gk_(k){ return 'pv|g' + gen_() + '|' + PV.SCHEMA + '|' + k; }` },

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

  /* ---- CHUNK 23: the column alias knows any year, not two ----------------------
     5 hunk(s), all of them the same edit: a year that was typed out
     becomes a year that was read. gone: [] on every one — nothing was deleted. */
    { kind: 'replace', gone: [],
      why: 'CHUNK 23 — SIX ALIAS ENTRIES COVERED EXACTLY TWO YEARS. The export names the year first (\'2026 revenue\') and the sheet names it last (\'Total Revenue - 2026\'), and the map listed both spellings for 2025 and 2026 only. They are one pattern each now, so whatever year the export names finds the sheet\'s column of the same year. NOTE WHAT THIS DOES NOT DO: the sync writes data under the headers the SHEET already has and never rewrites a header row, so the workbook still has to gain the new year\'s columns before anything can be written into them — until it does, the export\'s new column matches nothing and is reported as unmatched rather than written somewhere wrong. ',
      from: `  /* Extras + Associates: the export names the year first, the sheet last. */
  var ALIAS_EXTRA = {
    'plant_descr':                  'Plant',
    '2025 revenue':                 'Total Revenue - 2025',
    '2026 revenue':                 'Total Revenue - 2026',
    '2025 revenue (m3 applied to)': 'Revenue (M3 Applied To) - 2025',
    '2026 revenue (m3 applied to)': 'Revenue (M3 Applied To) - 2026',
    '2025 m3 applied to':           'M3 Applied To - 2025',
    '2026 m3 applied to':           'M3 Applied To - 2026'
  };`,
      to: `  /* Extras + Associates: the export names the year first, the sheet last.

     THE SIX YEAR ENTRIES WERE LITERALS FOR 2025 AND 2026, and a rule that only
     knows two years stops being a rule on the first of January. They are one
     pattern each now (PLAN.md chunk 23): whatever year the export names, the
     sheet's spelling of that same year is what it maps to.

     THIS IS ONLY THIS HALF OF THE ROLL, and the other half is not in this repo.
     The sync writes DATA under the headers the SHEET already has; it never
     rewrites a header row. So a new year's column has to exist in the workbook
     before anything can be written into it — until it does, the export's new
     column matches nothing and is reported as unmatched rather than being
     written somewhere wrong. What these patterns buy is that the moment the
     workbook gains "Total Revenue - 2027", the export's "2027 revenue" finds
     it, with no code change. */
  var ALIAS_EXTRA = {
    'plant_descr': 'Plant'
  };
  /* Tried in order, first match wins; each is anchored, so the "(m3 applied
     to)" forms cannot be swallowed by the plain revenue one. */
  var ALIAS_EXTRA_RE = [
    [/^(\\d{4}) revenue \\(m3 applied to\\)$/i, 'Revenue (M3 Applied To) - $1'],
    [/^(\\d{4}) m3 applied to$/i,               'M3 Applied To - $1'],
    [/^(\\d{4}) revenue$/i,                     'Total Revenue - $1']
  ];

  /* One export column's name as the SHEET spells it: the exact map first, then
     the patterns, then the name unchanged. */
  function alias_(spec, raw) {
    var name = String(raw == null ? '' : raw);
    var hit = spec.alias && spec.alias[name];
    if (hit) return hit;
    var rules = spec.aliasRe || [];
    for (var i = 0; i < rules.length; i++) {
      if (rules[i][0].test(name)) return name.replace(rules[i][0], rules[i][1]);
    }
    return name;
  }` },

    { kind: 'replace', gone: [],
      why: '…the same edit, Extra Raw Data. ',
      from: `      { folder: 'RMX', page: 'rmx', tab: 'Extra Raw Data',
        mode: 'columns', alias: ALIAS_EXTRA,`,
      to: `      { folder: 'RMX', page: 'rmx', tab: 'Extra Raw Data',
        mode: 'columns', alias: ALIAS_EXTRA, aliasRe: ALIAS_EXTRA_RE,` },

    { kind: 'replace', gone: [],
      why: '…the same edit, Associate Raw Data. ',
      from: `      { folder: 'RMX', page: 'rmx', tab: 'Associate Raw Data',
        mode: 'columns', alias: ALIAS_EXTRA,`,
      to: `      { folder: 'RMX', page: 'rmx', tab: 'Associate Raw Data',
        mode: 'columns', alias: ALIAS_EXTRA, aliasRe: ALIAS_EXTRA_RE,` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `      wanted[canon_(norm_(spec.alias[h] || h))] = 1;`,
      to: `      wanted[canon_(norm_(alias_(spec, h)))] = 1;` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `      var name = canon_(norm_(spec.alias[raw] || raw));`,
      to: `      var name = canon_(norm_(alias_(spec, raw)));` },

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

  /* ---- CHUNK 23: the upload path stops naming the year the reader resolves -----
     4 hunk(s), all of them the same edit: a year that was typed out
     becomes a year that was read. gone: [] on every one — nothing was deleted. */
    { kind: 'replace', gone: [],
      why: 'CHUNK 23 — THE UPLOAD PATH NAMED THE YEARS THE READ PATH RESOLVES. readTab_ has matched \'#### Volume\' by pattern since it was written (\'the header carries the year, so nothing here has to be edited when the file rolls over\'), and uploadData listed \'2025 Volume\' and \'2026 Volume\' as required columns four lines away from it. On a new year\'s export that REFUSES a perfectly good download — loud rather than silent, which is why it lasted, and wrong either way. ',
      from: `  need(R, ['Year', 'Month', 'Plant Type', 'Material Family', 'Product Class [Rock]', 'Cust Segment [Rock]',
           'Product Application', 'Plant', 'Material', 'Customer Parent', 'Sold To',
           '2025 Volume', '2026 Volume', 'PY Rev exWorks', 'CY Rev exWorks', 'Fuel Surchage'], 'Combined Data CPI Raw');`,
      to: `  need(R, ['Year', 'Month', 'Plant Type', 'Material Family', 'Product Class [Rock]', 'Cust Segment [Rock]',
           'Product Application', 'Plant', 'Material', 'Customer Parent', 'Sold To',
           'PY Rev exWorks', 'CY Rev exWorks', 'Fuel Surchage'], 'Combined Data CPI Raw');

  /* THE VOLUME COLUMNS CARRY THE YEAR, AND THIS LIST USED TO NAME 2026 AND 2025.
     The read path has resolved them by pattern since it was written — "the
     header carries the year, so nothing here has to be edited when the file
     rolls over" — and the UPLOAD path did not, so on the first export of a new
     year this required two columns the file no longer has and refused a
     perfectly good download with "Missing column(s): 2025 Volume, 2026 Volume".
     Loud rather than silent, which is why it survived, but wrong either way.
     Same rule as everywhere else now (PLAN.md chunk 23): find every
     "#### Volume", keep them BY YEAR, and let each row pick its own. */
  var volCols = {};
  R.hdr.forEach(function (h, i) {
    var m = /^(\\d{4})\\s+volume$/.exec(norm_(h));
    if (m && !(Number(m[1]) in volCols)) volCols[Number(m[1])] = i;
  });
  var volYears = Object.keys(volCols).map(Number).sort(function (a, b) { return b - a; });
  if (volYears.length < 2)
    throw new Error('Combined Data CPI Raw upload needs two "#### Volume" columns (e.g. "'
      + ((new Date()).getFullYear()) + ' Volume" and the year before). Found: '
      + (volYears.length ? volYears.join(', ') : 'none')
      + '. Please re-download from QlikView without changing the columns.');` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `             v25: ci(R, '2025 Volume'), v26: ci(R, '2026 Volume'), fsc: ci(R, 'Fuel Surchage') };`,
      to: `             vol: volCols, cy: volYears[0], py: volYears[1], fsc: ci(R, 'Fuel Surchage') };` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `  function volOf(r) { var y = toNum_(r[rp.yr]); return y === 2026 ? toNum_(r[rp.v26]) : y === 2025 ? toNum_(r[rp.v25]) : 0; }`,
      to: `  /* the volume column named for THIS row's year; a row from a year the file has
     no column for contributes nothing, which is what the two literals used to
     say the long way round */
  function volOf(r) { var c = rp.vol[Math.round(toNum_(r[rp.yr]))]; return c == null ? 0 : toNum_(r[c]); }` },

    { kind: 'replace', gone: [],
      why: '…the same edit, next hunk. ',
      from: `    row.push(y === 2025 ? nf : 0, y === 2026 ? nf : 0);`,
      to: `    row.push(y === rp.py ? nf : 0, y === rp.cy ? nf : 0);` },


  /* ---- CHUNK 20: PV.toNum_ stops dropping accounting negatives -------------
     THE FIRST EDIT IN THIS FILE THAT CHANGES AN ANSWER rather than a message or
     a comment. Chunk 15 diffed the six toNum_, recorded this as a finding and
     deliberately did not fix it inside a cleanup; chunk 20 is that finding,
     fixed on its own. tests/helpers.js's table moves with it — two cells, 0 to
     -1234 and 0 to -99.5 — which is the visible record of what changed.

     NOTE THE `String.raw`. Both anchors are regex source, and in an ordinary
     template literal `\s` collapses to `s`, so the anchor would not match the
     file it came from. */
    { kind: 'replace', gone: [],
      why: 'PV.toNum_("(1,234)") was 0. The strip left the brackets in place, parseFloat gave ' +
           'NaN, and NaN became 0 — so a parenthesised negative was DROPPED from every sum it ' +
           'landed in rather than mis-signed, which is exactly why nothing ever looked wrong. ' +
           'Every other copy in the suite has always read it as -1234. This is NOT the ' +
           'unification chunk 15 forbade: the percent rule that makes PV right and the others ' +
           'wrong is untouched, because the two rules are about different inputs. And it cannot ' +
           'reach a value that is not a parenthesised NUMBER — "(n/a)" still reads 0. ',
      from: String.raw`  var s = String(v).trim(), pct = /%/.test(s);
  s = s.replace(/[$,%\s]/g, '');
  if (s === '' || s === '-') return 0;`,
      to:   String.raw`  var s = String(v).trim(), pct = /%/.test(s);
  /* THE PARENTHESES ARE A MINUS SIGN. An accounting export writes -1,234 as
     "(1,234)", and stripping only [$,%\s] left the brackets in place: parseFloat
     gave NaN and NaN became 0, so the figure was DROPPED rather than mis-signed
     — which is why nothing ever looked wrong. Every other toNum_ in the suite
     (FSC, RFSC, RMX, SASKRATES) has always read it as -1234; this is that rule,
     spelled the way they spell it, and it is the whole of PLAN.md chunk 20.
     It cannot touch a value that is not a parenthesised NUMBER: "(n/a)" still
     reads 0, because parseFloat still gives NaN. The percent rule above is
     untouched — chunk 15's point was that PV is RIGHT about "5%" and the others
     are wrong, and the two rules are about different inputs. */
  s = s.replace(/[$,%\s]/g, '').replace(/\(/g, '-').replace(/\)/g, '');
  if (s === '' || s === '-') return 0;` },

  /* ---- CHUNK 21: PV exports its schema token, so there is only one --------- */
    { kind: 'replace', gone: [],
      why: 'PV_Lookup.gs keys its own cache on PV.SCHEMA now, and SCHEMA_ is private to this ' +
           'IIFE — so it has to be exported for the fix to work at all. Same move, and the same ' +
           'argument, as readTab and RAW_HEADER_NAMES directly above it: two copies of one rule ' +
           'is how it keeps coming back. ',
      from: `    readTab:           readTab_,
    RAW_HEADER_NAMES:  RAW_HEADER_NAMES_
  };`,
      to: `    readTab:           readTab_,
    RAW_HEADER_NAMES:  RAW_HEADER_NAMES_,

    /* THE CACHE-SHAPE VERSION, so PV_Lookup.gs can key on the same one. Same
       argument as readTab directly above: two copies of one rule is how it
       keeps coming back. PV_Lookup caches a result COMPUTED FROM the rows this
       schema describes, so a bump that strands PV's tables has to strand its
       check too — see PLAN.md chunk 21. Exported as a value: bumping it means
       editing the literal, which is what SCHEMA_'s own comment asks for. */
    SCHEMA:            SCHEMA_
  };` },

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
               'APP_PAGES',
               /* the deck's layout map — the page writes it, DECK_getRecipe reads it */
               'DECK_setLayout', 'DECK_resetLayouts'];

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
