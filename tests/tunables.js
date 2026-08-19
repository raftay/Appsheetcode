#!/usr/bin/env node
/* =============================================================================
 * tests/tunables.js — §C says exactly what the pages used to say themselves
 * -----------------------------------------------------------------------------
 * Chunk 22 lifted the slide frame and every page's whitespace defaults out of
 * the module and the pages that read them into app.html's §C. That is a MOVE,
 * and a move is only safe if the values did not change on the way — the same
 * argument gsparity.js and modparity.js make about their halves of the merge,
 * and the same way of proving it: read the BEFORE out of git and compare.
 *
 * WHAT IT CHECKS
 *   1. §C evaluates on its own, with no runtime around it. It sits above §D and
 *      §E because their IIFEs read it while they construct; anything it needed
 *      from them would be a load-order bug that only shows up in the browser.
 *   2. Every number in §C is the number that was in the page, at REF.
 *   3. Every page that mounts whitespace sliders takes them from §C, under its
 *      OWN page id — a copy-pasted 'pricevolume' in the Ready-Mix page would
 *      silently give Ready-Mix the wrong bands and nothing else would notice.
 *   4. ws() hands out a COPY. mountControls keeps the object it is given and
 *      the sliders write back into it, so a shared object would let one page's
 *      dragging move another page's defaults.
 *
 * WHEN TO RETIRE IT. Check 2 is the parity half and it retires the way its
 * siblings do: the day someone deliberately changes one of these defaults — a
 * new frame size, a page's bands re-tuned — that number stops being "what the
 * page used to say" and the check should be deleted rather than edited to
 * match. Checks 1, 3 and 4 are invariants, not comparisons; they stay.
 *
 * Run:  node tests/tunables.js          # no dependencies
 *       REF=<commit> node tests/tunables.js
 * ===========================================================================*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { pageOf, whole } = require('./apphtml.js');

const REPO = path.resolve(__dirname, '..');
/* The commit before chunk 22 moved any of this. */
const REF = process.env.REF || 'c24ccd6';

let fails = 0;
const check = (what, cond, detail) => {
  if (cond) { console.log('  ok    ' + what); return; }
  fails++;
  console.log('  FAIL  ' + what + (detail ? '\n        ' + detail : ''));
};

const lf = s => s.replace(/\r\n?/g, '\n');
const OLD = lf(execFileSync('git', ['show', REF + ':app.html'],
  { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 }));
const APP = whole();

/* ===========================================================================
 * The BEFORE, as literals. Written out here rather than parsed out of REF,
 * because a check that derives both sides from the same text cannot fail —
 * gsparity.js's note on its `rewrite` edits says the same thing. Each string is
 * asserted to appear in REF's app.html, so the literals cannot rot either.
 * ======================================================================== */
const WAS = {
  slide: [
    `  var W = 1600, H = 900, PAD = 40;          // the pages' 16:9 canvas`,
    `  var BARE_PAD = 8;`,
    `  var MARGINS = { left:120, right:120, top:30, bottom:30 };  // current comment bands`,
    `    var maxLR = opts.maxLR || 650, maxTB = opts.maxTB || 320;`,
  ],
  pages: {
    /* [ the call as it stood at REF, how many copies of it REF holds ] */
    fuelsurcharge: [`    AmrSlide.mountControls('fscWs', { left:140, right:140, top:40, bottom:40, maxLR:650, maxTB:320,
      onChange:function(){ renderPreview(); } });`, 2],
    rmxfuel: null,          /* byte-identical to the line above — same entry, two pages */
    pricevolume: [`    AmrSlide.mountControls('pvWs', { left:375, right:0, top:10, bottom:0,
      maxLR:1000, maxTB:400, onChange:function(){ renderSlidePreview(); } });`, 1],
    rmx: [`    AmrSlide.mountControls('rmxWs', { left:15, right:15, top:15, bottom:15, maxLR:600, maxTB:300,
      onChange:function(){ renderRmxPreview(); } });`, 1],
    segment: [`    AmrSlide.mountControls('sbWs', {
      left:345, right:55, top:WS.top, bottom:15, maxLR:650, maxTB:320,`, 1],
  },
  segmentTopBand: `  var WS_TOP = { withKpi:20, withoutKpi:{ 1:165, 2:110, 3:60 } };`,
};

/* What those literals MEAN, which is what §C has to agree with. */
const EXPECT_SLIDE = { W:1600, H:900, PAD:40, BARE_PAD:8, MAX_LR:650, MAX_TB:320,
                       MARGINS:{ left:120, right:120, top:30, bottom:30 } };
const EXPECT_WS = {
  pricevolume:   { left:375, right:0,   top:10, bottom:0,  maxLR:1000, maxTB:400 },
  rmx:           { left:15,  right:15,  top:15, bottom:15, maxLR:600,  maxTB:300 },
  fuelsurcharge: { left:140, right:140, top:40, bottom:40, maxLR:650,  maxTB:320 },
  rmxfuel:       { left:140, right:140, top:40, bottom:40, maxLR:650,  maxTB:320 },
  /* no `top`: the Slide Builder's top band is the one that moves with the KPI
     cards, so the page supplies it from segmentTopBand. */
  segment:       { left:345, right:55,             bottom:15, maxLR:650,  maxTB:320 },
};
const EXPECT_TOP_BAND = { withKpi:20, withoutKpi:{ 1:165, 2:110, 3:60 } };

console.log('app.html §C against the pages it was lifted out of, at ' + REF + ':\n');

/* ---- 1. §C stands on its own, above everything that reads it ------------ */
let T = null;
{
  const open = APP.indexOf('window.AMR_TUNABLES = {');
  const close = APP.indexOf('\n};\n', open);
  check('§C is present exactly once', open !== -1 && close !== -1 &&
    APP.indexOf('window.AMR_TUNABLES = {', open + 1) === -1);

  if (open !== -1 && close !== -1) {
    const src = APP.slice(open, close + 3);
    const ctx = { window: {} };
    try {
      vm.runInNewContext(src, ctx, { filename: 'app.html (§C)' });
      T = ctx.window.AMR_TUNABLES;
    } catch (e) { /* reported by the check below */ }
    check('§C evaluates with nothing but `window` — no runtime, no modules', !!T,
      'it read something that does not exist yet at the point it runs');

    /* §E's modules are IIFEs: they execute as the parser reaches them, so a
       block they read at construction time has to be above them in the file. */
    const c = APP.indexOf('§C  TUNABLES');
    const d = APP.indexOf('§D  RUNTIME');
    const e = APP.indexOf('§E  SHARED MODULES');
    check('§C comes before §D and §E, which read it while they construct',
      c !== -1 && c < d && c < e, 'order: C@' + c + ' D@' + d + ' E@' + e);
  }
}

/* ---- 2. every number is the number the page had at REF ----------------- */
{
  for (const line of WAS.slide)
    check('REF still holds the frame line it was lifted from  ' + JSON.stringify(line.trim().slice(0, 44)),
      OLD.split(line).length === 2);
  check('REF still holds the Slide Builder top-band line',
    OLD.split(WAS.segmentTopBand).length === 2);
  for (const [page, entry] of Object.entries(WAS.pages)) {
    if (!entry) continue;
    const [text, copies] = entry;
    check('REF still holds ' + page + "'s mountControls call" +
          (copies > 1 ? ' (' + copies + ' copies — both fuel pages)' : ''),
      OLD.split(text).length === copies + 1,
      'found ' + (OLD.split(text).length - 1));
  }

  if (T) {
    /* Key ORDER is presentation, not value: §C groups the frame's four sizes
       before the bands, and this harness lists them the other way round. Sort
       before comparing so the check is about the numbers. */
    const stable = v => (v && typeof v === 'object' && !Array.isArray(v))
      ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
      : JSON.stringify(v);
    const same = (a, b) => stable(a) === stable(b);
    check('§C slide frame == the four lines AmrSlide used to declare',
      same(T.slide, EXPECT_SLIDE),
      JSON.stringify(T.slide) + '\n        wanted ' + JSON.stringify(EXPECT_SLIDE));
    check('§C whitespace table == the five pages\' own defaults',
      same(T.whitespace, EXPECT_WS),
      JSON.stringify(T.whitespace) + '\n        wanted ' + JSON.stringify(EXPECT_WS));
    check('§C segmentTopBand == the Slide Builder\'s WS_TOP',
      same(T.segmentTopBand, EXPECT_TOP_BAND),
      JSON.stringify(T.segmentTopBand));
  }
}

/* ---- 3. each page asks for ITS OWN bands ------------------------------- */
{
  for (const page of Object.keys(EXPECT_WS)) {
    let js = '';
    try { js = pageOf(page).js; } catch (e) { check(page + ' — registration found', false, String(e.message)); continue; }
    const mine = js.split("AMR_TUNABLES.ws('" + page + "'").length - 1;
    const any = js.split('AMR_TUNABLES.ws(').length - 1;
    check(page + ' takes its bands from §C, under its own page id',
      mine === 1 && any === 1,
      'ws(\'' + page + '\') × ' + mine + ', ws(…) × ' + any +
      ' — a copy-pasted page id gives this page another page\'s slide');
  }
  /* and nothing else in the file mounts sliders with a literal any more */
  const literal = APP.split(/mountControls\('\w+',\s*\{\s*left:/).length - 1;
  check('no page still mounts sliders from a literal', literal === 0,
    literal + ' left — §C is not the only source of truth');
}

/* ---- 4. ws() is a copy, not the table ---------------------------------- */
if (T) {
  const a = T.ws('rmx', { onChange: 1 });
  a.left = -999;
  check('ws() returns a copy — the sliders cannot write into §C',
    T.whitespace.rmx.left === EXPECT_WS.rmx.left,
    'the table moved to ' + T.whitespace.rmx.left);
  check('ws() layers the page\'s own options on top', T.ws('rmx', { onChange: 1 }).onChange === 1);
  check('ws() on an unknown page is the extras alone, not a throw',
    JSON.stringify(T.ws('nosuchpage', { top: 5 })) === '{"top":5}');
}

console.log(fails ? `\n${fails} failing check(s)`
                  : '\ntunables.js: §C is what the pages said, and every page reads its own row.');
process.exit(fails ? 1 : 0);
