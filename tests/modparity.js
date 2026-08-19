#!/usr/bin/env node
/* =============================================================================
 * tests/modparity.js — §E of app.html holds VERBATIM copies
 * -----------------------------------------------------------------------------
 * Every shared module ported into app.html's §E already has a gate pointed at
 * the file it came from: slidefit.js drives AmrSlide through real Chromium,
 * deckpath.js walks the adapters. Those proofs are about Deck_Fuel.html and
 * SlideExport.html — not about the copy inside app.html.
 *
 * THIS IS NOW THE ONLY PROOF THAT AmrFuelExec AND AmrPvSlide ARE WHAT THEY
 * WERE. regress.js and pvcheck.js used to diff them against the pre-extraction
 * pages; both were deleted, because the pages they diffed against are behind
 * commits this repo no longer reaches AND because the newest copies it does
 * reach are one-line delegations to these very modules — a comparison that
 * passes whatever either side does. What survived is this harness, which
 * stages from a reachable commit and declares its edits.
 *
 * This is what connects the two. While both copies exist, a byte-for-byte match
 * means every one of those gates covers app.html for free, and a merge that
 * "tidied" a module on the way in fails here with the module named.
 *
 * A module changed ON PURPOSE since the port is declared in EDITS below and
 * applied to the source side before comparing — gsparity.js's mechanism, for
 * gsparity.js's reason. Two lines of fix is not worth losing the proof over the
 * rest. Retire this when that list stops being short enough to read.
 *
 * IT SURVIVED CHUNK 13, and the plan said it would not. The chunk-13 note read
 * "retire this — once the old .html are deleted there is no second copy". There
 * is: they are in git, and gsparity.js had already established that reading a
 * deleted file out of a commit is the same comparison. So this reads its source
 * side through apphtml.legacy() now and keeps working.
 *
 * That matters more than it looks, because apphtml.js is what the repointed
 * gates read app.html THROUGH, and its slicing is only trustworthy while §E is
 * still a verbatim copy. Deleting this would have removed the proof underneath
 * the thing built to replace it.
 *
 * RETIRE IT WHEN A §E MODULE IS DELIBERATELY CHANGED — not when the sources are
 * deleted. Same end of life as gsparity.js, for the same reason its header
 * gives: keep it while app.html is still provably those files, delete it rather
 * than weaken it when it is not.
 *
 * Run:  node tests/modparity.js
 * ===========================================================================*/
'use strict';
const fs   = require('fs');
const path = require('path');

const { legacy, MODULES, REF } = require('./apphtml.js');

const ROOT = path.join(__dirname, '..');
const APP  = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');

/* The module table lives in apphtml.js: two files need it, and one list cannot
   drift from itself. Each entry's marker is the module's own opening line, which
   is what makes this a match on code rather than on a banner comment someone
   could copy without the body. */

/* ---------------------------------------------------------------- EDITS
 * Changes made to a module ON PURPOSE since it was ported, declared here and
 * applied to the SOURCE side before comparing — exactly the mechanism
 * gsparity.js uses for script.gs, and for the same reason.
 *
 * A module that has been deliberately changed is no longer a verbatim copy, and
 * the honest options are to declare the change or to retire the harness. Two
 * lines of fix is not worth losing the proof over the other 130 KB, so: declare
 * it, keep everything else exact, and retire this when the list stops being
 * short enough to read.
 *
 * Anything not declared here must still be byte-for-byte what it was.
 */
const EDITS = {
  AmrFresh: [
    { kind: 'insert',
      why: 'BOTH RELOADS IN THIS MODULE RELOADED THE SANDBOX IFRAME. The page runs inside an ' +
           'Apps Script sandbox iframe whose URL is a one-shot googleusercontent.com content ' +
           'URL, so window.location.reload() re-requests that, gets nothing back, and leaves a ' +
           'blank page the user has to reload by hand. Reported as "Update from source turns ' +
           'the page white"; it predates the merge — Shell.html had the same two lines. §D\'s ' +
           'navTop is the only correct way to navigate out of the sandbox.',
      before: '  function show(){',
      text: `  /* RELOAD THE TOP WINDOW, NEVER THIS ONE. The page runs inside an Apps Script
     sandbox iframe whose URL is a one-shot googleusercontent.com content URL:
     window.location.reload() re-requests THAT, gets nothing back, and leaves a
     blank page the user has to reload by hand. Both reloads in this module did
     that — it is the "Update from source turns the page white" report, and it
     predates the merge. §D's navTop is the only correct way to navigate, and
     AMR.nav.reload() is it pointed at the current page. */
  function reloadTop(){
    try {
      if (window.AMR && AMR.nav && AMR.nav.reload) { AMR.nav.reload(); return; }
      if (window.amrNavTop && window.APP_URL) {
        var p = window.APP_PAGE;
        var href = (p && p !== 'landing') ? (window.APP_URL + '?page=' + p) : window.APP_URL;
        window.amrNavTop(href + (href.indexOf('?') === -1 ? '?' : '&') + 'r=' + Date.now());
        return;
      }
    } catch (e) {}
    /* Last resort. Wrong inside the sandbox, but better than doing nothing on a
       page that somehow has no runtime. */
    window.location.reload();
  }

` },
    { kind: 'replace',
      why: 'the no-chrome fallback, same reason.',
      from: '    if (!el) { window.location.reload(); return; }   /* no chrome: just refresh */',
      to:   '    if (!el) { reloadTop(); return; }               /* no chrome: just refresh */' },
    { kind: 'replace',
      why: 'the stale dialog\'s own button — the one the report was about.',
      from: `      b.textContent = 'Loading the new figures\\u2026';
      window.location.reload();`,
      to:   `      b.textContent = 'Loading the new figures\\u2026';
      reloadTop();` },
    { kind: 'replace',
      why: 'THE WATCH HAD TO BECOME STOPPABLE, and this is the first §E edit chunk 14 forced. ' +
           'Before chunk 14 a page switch was a full reload, so this module was re-evaluated ' +
           'between pages and its state went with it. Now it is not. The poll reschedules with ' +
           'setTimeout rather than running on an interval, so §D\'s capture cannot see it — and ' +
           'leaving it running is not a stray timer, it is a wrong answer: `mine` is the data ' +
           'version of the page that STARTED the watch while page() reads window.APP_PAGE, ' +
           'which the switch has already moved. APP_getGen_ is per page, so the next poll ' +
           'compares two different pages\' versions, never matches, and greys out a page that is ' +
           'perfectly current — then show() clears the timer, so freshness checking is dead for ' +
           'the rest of the session. Reproduced in Chromium before the fix; tests/pageswitch.js ' +
           'check "stale-poll" is the gate.',
      from: `      timer = setTimeout(check, EVERY);
    }
  };`,
      to:   `      timer = setTimeout(check, EVERY);
    },

    /* END THIS PAGE'S WATCH. Called by §D's teardown, because since chunk 14 a
       page switch is not a reload and this module is no longer re-evaluated
       between pages.

       What it costs to leave running is not a stray timer, it is a wrong
       answer. \`mine\` is the data version of the page that STARTED the watch,
       while page() reads window.APP_PAGE, which the switch has already moved —
       and APP_getGen_ is per page, so the next poll compares one page's version
       with another page's and they never match. The user gets "these figures are
       out of date" over a page that is perfectly current, and show() clears the
       timer on its way out, so freshness checking is dead for the rest of the
       session. Clearing \`mine\` is what lets the new page start its own watch:
       start() declines while one is already running. */
    stop: function(){
      if (timer){ clearTimeout(timer); timer = null; }
      mine = null;
      shown = false;
    }
  };` },
  ],

  AmrSlide: [
    { kind: 'replace',
      why: 'CHUNK 22 — THE FRAME\'S FOUR NUMBERS MOVED TO §C, and nothing else about the module ' +
           'changed: same values, read from one place instead of declared in four. They are ' +
           'settings rather than constants — the size of every exported PNG, the padding of ' +
           'every deck picture, and where the comment bands start — and a setting whose only ' +
           'home is line 6,080 of a 22,000-line file is a setting nobody can find. WHAT THIS ' +
           'COSTS, stated plainly: slidefit.js drives the LEGACY SlideExport.html, so it no ' +
           'longer exercises this module\'s first five lines. threefiles.js, pageparity.js and ' +
           'bgrender.js all boot app.html whole, which is where §C exists, so the frame is still ' +
           'rendered from these values in Chromium and under jsdom — what is no longer proved ' +
           'is that the two copies agree about them.',
      from: `  var W = 1600, H = 900, PAD = 40;          // the pages' 16:9 canvas
  /* A bare frame keeps a hair of padding so a card's border and shadow are not
     shaved off at the picture's edge. */
  var BARE_PAD = 8;
  var MARGINS = { left:120, right:120, top:30, bottom:30 };  // current comment bands`,
      to: `  /* THE FRAME'S FOUR NUMBERS ARE IN §C — Ctrl+F "§C  TUNABLES". They were the
     first lines of this module, which is the right place for a constant nobody
     changes and the wrong one for a setting: resizing the exported slide meant
     finding the module that owns the frame first. The values are unchanged.
     Read once, here, because §C is above §E and cannot move below it. */
  var T = AMR_TUNABLES.slide;
  var W = T.W, H = T.H, PAD = T.PAD;        // the pages' 16:9 canvas
  var BARE_PAD = T.BARE_PAD;
  /* A COPY: the sliders assign into MARGINS, and §C's table must not move with
     them. */
  var MARGINS = { left:T.MARGINS.left, right:T.MARGINS.right,
                  top:T.MARGINS.top, bottom:T.MARGINS.bottom };  // current comment bands` },

    { kind: 'replace',
      why: 'and the slider ceilings with them — a page that does not name its own maxima gets ' +
           '§C\'s, which is where the numbers now are.',
      from: `    var maxLR = opts.maxLR || 650, maxTB = opts.maxTB || 320;`,
      to:   `    var maxLR = opts.maxLR || T.MAX_LR, maxTB = opts.maxTB || T.MAX_TB;` },
  ],

  AmrFuelExec: [
    { kind: 'replace',
      why: 'CHUNK 23 — the AGG fallback stopped naming a year. On the first of January this application went quietly wrong in ' +
           'three places at once, and every one of them published ZEROES or a stale label rather than ' +
           'failing. The years travel in every payload now (the backends read them off the workbook\'s ' +
           'own column names), so nothing in the client spells one out. tests/yearroll.js runs the whole ' +
           'thing against a 2031 workbook and is the standing gate. ' +
           'This one line WAS the AGG page\'s year rather than a last resort: getFscData did not send ' +
           'cyYear at all until chunk 23, so the || branch is what every AGG heading read. Both units ' +
           'now fall back to the calendar, and only for a payload cached before the field existed.',
      from: `      /* The AGG page hard-coded 2026/2025 in its headers. Reading cyYear when
         the backend sends it keeps today's output identical and stops this
         being a silent landmine the next time the year rolls. */
      cy: function(d){ return (d && d.cyYear) || 2026; }`,
      to: `      /* The AGG page hard-coded 2026/2025 in its headers. Reading cyYear when
         the backend sends it keeps today's output identical and stops this
         being a silent landmine the next time the year rolls.

         THE FALLBACK NAMED 2026 UNTIL CHUNK 23, which made it a landmine of its
         own: getFscData did not send cyYear at all until that chunk, so this
         line WAS the AGG page's year rather than a last resort. Both units read
         the calendar now, and only when a payload predates the field. */
      cy: function(d){ return (d && d.cyYear) || new Date().getFullYear(); }` },
  ],

  AmrSegSlide: [
    { kind: 'replace',
      why: 'CHUNK 23 — the module takes its two years from the payload. On the first of January this application went quietly wrong in ' +
           'three places at once, and every one of them published ZEROES or a stale label rather than ' +
           'failing. The years travel in every payload now (the backends read them off the workbook\'s ' +
           'own column names), so nothing in the client spells one out. tests/yearroll.js runs the whole ' +
           'thing against a 2031 workbook and is the standing gate. ' +
           'Its header arrays are built from CY_YEAR / PY_YEAR, which were two literals; they are ' +
           'derived now, with today\'s calendar year as the fallback for a payload that predates the ' +
           'fields — a guess rather than a setting, which is why it is not in §C.',
      from: `  var ALL_MKT = '__ALL__';

  var CY_YEAR = 2026, PY_YEAR = 2025;

  var MARKET_LABEL = { '__ALL__':'Central Canada', HNS_SW:'HNS', Innocon:'Innocon',`,
      to: `  var ALL_MKT = '__ALL__';

  /* THE YEAR IS THE DATA'S, NOT THE CALENDAR'S AND NOT A LITERAL.
     Every payload from the server now says which two years it is about —
     the backends read them off the workbook's own column names — so nothing
     here spells a year out. The initial pair is only what to print if a
     payload arrives without them, which today means one cached before this
     landed; today's calendar year is the least-wrong guess, and it is a
     guess rather than a setting, which is why it is not in §C.
     PLAN.md chunk 23. */
  var CY_YEAR = new Date().getFullYear(), PY_YEAR = CY_YEAR - 1;
  function years_(d){
    var cy = d && Number(d.cyYear);
    if(cy > 0){ CY_YEAR = cy; PY_YEAR = Number(d.pyYear) > 0 ? Number(d.pyYear) : cy - 1; }
  }

  var MARKET_LABEL = { '__ALL__':'Central Canada', HNS_SW:'HNS', Innocon:'Innocon',` },
    { kind: 'replace',
      why: 'and the one hook that keeps them current: withCtx is where a payload becomes the module\'s ' +
           'own, so it is the only place that has to remember. ',
      from: `  function withCtx(ctx, fn){
    var prev = CTX; CTX = ctx_(ctx);
    try { return fn(); } finally { CTX = prev; }
  }`,
      to: `  function withCtx(ctx, fn){
    var prev = CTX; CTX = ctx_(ctx);
    years_(CTX.data);            /* the payload names its own two years */
    try { return fn(); } finally { CTX = prev; }
  }` },
  ],

  AmrRmxSlide: [
    { kind: 'insert',
      why: 'CHUNK 23 — its table headings ask the payload instead of naming 2026 and 2025. On the first of January this application went quietly wrong in ' +
           'three places at once, and every one of them published ZEROES or a stale label rather than ' +
           'failing. The years travel in every payload now (the backends read them off the workbook\'s ' +
           'own column names), so nothing in the client spells one out. tests/yearroll.js runs the whole ' +
           'thing against a 2031 workbook and is the standing gate. ' +
           'Stateless, because these builders already receive the payload — nothing here needs to ' +
           'remember a year between calls.',
      before: `  function byTypeRow(r){`,
      text: `  /* THE YEAR IS THE DATA'S, NOT THE CALENDAR'S AND NOT A LITERAL. Every payload
     says which two years it is about — the backend reads them off the
     workbook's own column names — so no heading here spells one out. The
     fallback is only for a payload cached before those fields existed, and
     today's calendar year is the least-wrong guess. PLAN.md chunk 23. */
  function cyOf(d){ var y = d && Number(d.cyYear); return y > 0 ? y : new Date().getFullYear(); }
  function pyOf(d){ var y = d && Number(d.pyYear); return y > 0 ? y : cyOf(d) - 1; }
` },
    { kind: 'replace',
      why: 'the by-type table\'s four year headings. ',
      from: `      +'<th class="gA">2026 Rev</th><th class="gA">2025 Rev</th><th class="gA">Rev % chg</th>'
      +'<th class="gB">2026 ASP/m³</th><th class="gB">2025 ASP/m³</th><th class="gB">ASP change</th></tr></thead><tbody>';`,
      to: `      +'<th class="gA">'+cyOf(d)+' Rev</th><th class="gA">'+pyOf(d)+' Rev</th><th class="gA">Rev % chg</th>'
      +'<th class="gB">'+cyOf(d)+' ASP/m³</th><th class="gB">'+pyOf(d)+' ASP/m³</th><th class="gB">ASP change</th></tr></thead><tbody>';` },
    { kind: 'replace',
      why: 'and the detail table\'s ten. ',
      from: `      +'<th class="gV">2026 vol applied</th><th class="gV">2026 appl. rate</th>'
      +'<th class="gV">2025 vol applied</th><th class="gV">2025 appl. rate</th><th class="gV">Δ appl. rate</th>'
      +'<th class="gA">2026 Rev</th><th class="gA">2025 Rev</th><th class="gA">Rev % chg</th>'
      +'<th class="gB">2026 Applied ASP</th><th class="gB">2025 Applied ASP</th><th class="gB">ASP change</th></tr></thead><tbody>';`,
      to: `      +'<th class="gV">'+cyOf(d)+' vol applied</th><th class="gV">'+cyOf(d)+' appl. rate</th>'
      +'<th class="gV">'+pyOf(d)+' vol applied</th><th class="gV">'+pyOf(d)+' appl. rate</th><th class="gV">Δ appl. rate</th>'
      +'<th class="gA">'+cyOf(d)+' Rev</th><th class="gA">'+pyOf(d)+' Rev</th><th class="gA">Rev % chg</th>'
      +'<th class="gB">'+cyOf(d)+' Applied ASP</th><th class="gB">'+pyOf(d)+' Applied ASP</th><th class="gB">ASP change</th></tr></thead><tbody>';` },
  ],

  AmrProgress: [
    { kind: 'replace',
      why: 'THE OVERLAY OUTLIVED THE PAGE THAT RAISED IT. #amrLoad is on §D\'s KEEP_ON_SWITCH ' +
           'list — correctly, because this module caches `mounted` and `host`, and detaching the ' +
           'node leaves the flag true and the screen unable to appear again. But keeping the ' +
           'NODE while keeping the JOBS strands it: the callback that would have called done() ' +
           'or clear() belongs to the page that has gone, §D\'s stale guard drops it by design, ' +
           'and nothing else ever removes the job. The new page then sits under the old page\'s ' +
           'loading screen until a full reload — and switching pages while something is loading ' +
           'is exactly when a user clicks away. Reproduced in Chromium before the fix; ' +
           'tests/pageswitch.js check "stranded-overlay" is the gate.',
      from: `    repaint: render
  };`,
      to:   `    repaint: render,

    /* EVERYTHING THIS PAGE PUT UP, GONE. Called by §D's teardown on a page
       switch. The node cannot simply be removed — #amrLoad is on §D's
       KEEP_ON_SWITCH list precisely because \`mounted\` and \`host\` are cached
       here, and detaching it would leave the flag true and the screen unable to
       appear again — so the JOBS are what has to go.

       Left alone they strand the overlay: the callback that would have called
       done() or clear() belongs to the page that has gone, and §D's stale guard
       drops it, so nothing ever removes the job and the new page sits under the
       old page's loading screen until a full reload. Switching pages while
       something is loading is exactly when a user clicks away. */
    reset: function(){
      jobs = {}; details = {}; detail = null;
      disarm();
      /* Only if the screen was ever built: render() would otherwise mount it
         here, on a page that never showed one, and put a node on <body> that
         teardown has just finished accounting for. */
      if (mounted) render();
    }
  };` },
  ],
};

function applyEdits(name, src) {
  for (const op of (EDITS[name] || [])) {
    if (op.kind === 'insert') {
      if (src.split(op.before).length !== 2)
        throw new Error(name + ': insert anchor is not unique — ' + JSON.stringify(op.before));
      src = src.replace(op.before, op.text + op.before);
    } else {
      if (src.split(op.from).length !== 2)
        throw new Error(name + ': replace block is not unique — ' + JSON.stringify(op.from.slice(0, 50)));
      src = src.replace(op.from, op.to);
    }
  }
  return src;
}

const blocksOf = src => [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

let failures = 0;
const fail = (name, msg) => { failures++; console.log(`  ✗ ${name}: ${msg}`); };

const appBlocks = blocksOf(APP);
const sources   = {};

for (const m of MODULES) {
  if (!sources[m.from]) sources[m.from] = blocksOf(legacy(m.from));

  const mine  = appBlocks.filter(b => b.includes(m.open));
  const their = sources[m.from].filter(b => b.includes(m.open));

  if (mine.length !== 1)  { fail(m.name, `${mine.length} copies in app.html §E, expected 1`); continue; }
  if (their.length !== 1) { fail(m.name, `${their.length} copies in ${m.from}, expected 1`); continue; }

  /* Each side keeps its own banner comment above the module — app.html's says
     where it came from, the source file's says what it is for — so the compare
     starts at the module's first line of code.

     Line endings are normalised, and that is deliberate rather than sloppy: the
     repo is mixed (Deck_Fuel.html is CRLF, Shell.html and SlideExport.html are
     LF) and PLAN.md §12 says app.html is written LF throughout. Comparing raw
     would fail on every CRLF source at the first newline and say nothing about
     the code. */
  const norm = s => s.slice(s.indexOf(m.open)).replace(/\r\n/g, '\n').trim();
  const a = norm(mine[0]);
  const b = applyEdits(m.name, norm(their[0]));
  const edits = (EDITS[m.name] || []).length;

  if (a === b) {
    console.log(`  ✓ ${m.name}: ${edits ? `${edits} declared edit(s), otherwise verbatim from` : 'verbatim from'}` +
                ` ${m.from} (${a.length} chars)`);
    continue;
  }

  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  fail(m.name, `differs from ${m.from} at char ${i}\n` +
       `        app.html   : ${JSON.stringify(a.slice(i, i + 70))}\n` +
       `        ${m.from.padEnd(11)}: ${JSON.stringify(b.slice(i, i + 70))}`);
}

console.log(failures ? `\n${failures} failure(s)`
                     : `\nmodparity.js: every §E module is a verbatim copy (sources read at ${REF})`);
process.exit(failures ? 1 : 0);
