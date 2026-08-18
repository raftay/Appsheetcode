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
 * RETIRE THIS AT CHUNK 13. Once the old .html files are deleted there is no
 * second copy to compare against, and the gates above have to be repointed at
 * app.html directly. PLAN.md §8 carries that note.
 *
 * Run:  node tests/modparity.js
 * ===========================================================================*/
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP  = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');

/* module marker -> the file it was ported from. The marker is the module's own
   opening line, which is what makes this a match on code rather than on a
   comment banner someone could copy without the body. */
const MODULES = [
  { name: 'AmrProgress',  open: 'window.AmrProgress = (function(){', from: 'Shell.html' },
  { name: 'AmrBoot',      open: 'window.AmrBoot = (function(){',     from: 'Shell.html' },
  { name: 'AmrFresh',     open: 'window.AmrFresh = (function(){',    from: 'Shell.html' },
  { name: 'AmrSlide',     open: 'var AmrSlide = (function(){',       from: 'SlideExport.html' },
  { name: 'AmrFuelExec',  open: 'var AmrFuelExec = (function(){',    from: 'Deck_Fuel.html' },
  { name: 'AmrCache',     open: 'window.AmrCache = (function(){',    from: 'Shell.html' },
  { name: 'AmrKpi',       open: 'window.AmrKpi = (function(){',      from: 'KpiShared.html' },
  { name: 'AmrCube',      open: 'window.AmrCube = (function(){',     from: 'Cube.html' },
  { name: 'AmrPvSlide',   open: 'var AmrPvSlide = (function(){',     from: 'Deck_PV.html' }
];

const blocksOf = src => [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

let failures = 0;
const fail = (name, msg) => { failures++; console.log(`  ✗ ${name}: ${msg}`); };

const appBlocks = blocksOf(APP);
const sources   = {};

for (const m of MODULES) {
  if (!sources[m.from]) sources[m.from] = blocksOf(fs.readFileSync(path.join(ROOT, m.from), 'utf8'));

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
  const b = norm(their[0]);

  if (a === b) { console.log(`  ✓ ${m.name}: verbatim from ${m.from} (${a.length} chars)`); continue; }

  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  fail(m.name, `differs from ${m.from} at char ${i}\n` +
       `        app.html   : ${JSON.stringify(a.slice(i, i + 70))}\n` +
       `        ${m.from.padEnd(11)}: ${JSON.stringify(b.slice(i, i + 70))}`);
}

console.log(failures ? `\n${failures} failure(s)` : '\nmodparity.js: every §E module is a verbatim copy');
process.exit(failures ? 1 : 0);
