#!/usr/bin/env node
/* =============================================================================
 * tests/modparity.js — §E of app.html holds VERBATIM copies
 * -----------------------------------------------------------------------------
 * Every shared module ported into app.html's §E already has a gate pointed at
 * the file it came from: regress.js proves AmrFuelExec byte-identical to the
 * page code it replaced, slidefit.js drives AmrSlide through real Chromium,
 * deckpath.js walks the adapters. Those proofs are about Deck_Fuel.html and
 * SlideExport.html — not about the copy inside app.html.
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
