/* tests/cpiindex.js — the CPI outlier exclusion, and the reason it did nothing
 * ---------------------------------------------------------------------------
 * CPI shipped with an exclusion the page never applied. The Overview published
 * +141.7% for 2026 Jan-Aug against Qlik's 2.86%, and +243.0% for GTA against
 * 2.48% — one pair, plant 3P36 / Brock Aggregates / 9141, whose March 2025
 * invoice of $693.98 met an April credit of $693.84. Fourteen cents against 47
 * tonnes is an ASP move of +492,409%, and it carried 135 of those 141.7 points
 * by itself.
 *
 * Nothing was wrong with the arithmetic. The THRESHOLD NEVER ARRIVED.
 *
 *   §1's COVERAGE block is read on the server, but the browser does the
 *   pooling, so the numbers TRAVEL — inside the cube manifest and inside the
 *   cross-filter dataset. Every cache key in that chain was built from the
 *   DATA's generation and the cube's SHAPE, neither of which moves when a
 *   threshold is edited. The server's own manifest cache answered from the copy
 *   it built before the edit; the browser's IndexedDB copy of that manifest is
 *   only wiped when the generation moves, so a warm device kept painting from
 *   the pre-edit manifest indefinitely; and `cov.cpiOutlier || 0` reads a
 *   missing key as "no threshold at all".
 *
 * So this harness gates the two halves of the fix, and the arithmetic that
 * sits between them:
 *
 *   1. A COVERAGE EDIT IS AN INVALIDATION. ovcCovTok_ hashes the block into
 *      ovcGen_, and getCrossData's key carries it too. Also that the token is
 *      STABLE — one that moved on its own would wipe the cube on every boot.
 *   2. A PAYLOAD THAT CANNOT SAY WHAT THE EXCLUSION IS REPORTS NO CPI. Not an
 *      unexcluded one. The column is dropped exactly as it is on a line with no
 *      sold-to, which is a rule app.html already had and states in three places.
 *   3. THE SERVER AND THE BROWSER POOL THE SAME WAY. piIndex_ and AmrCube's
 *      pool() are two copies of one method; they are asserted equal on one
 *      fixture, at both grains, with and without the threshold.
 *
 * THE FIXTURE IS THE REAL PAIR. Its four numbers are Brock Aggregates' own, as
 * they appear in the 2026 Jan-Aug window, beside one ordinary pair at the same
 * plant and material. That is deliberate: at the CPI grain (plant x sold-to x
 * material) they are two pairs and the exclusion has something to catch, while
 * at the PPI grain (plant x material) they are ONE pair and there is nothing
 * extreme left to see — which is the actual reason PPI never needed the rule
 * and must not be given it.
 *
 *   node tests/cpiindex.js            # no dependencies
 */
'use strict';
const vm = require('vm');
const { load, region } = require('./scriptgs.js');
const { module: mod, whole: appWhole } = require('./apphtml.js');

let fails = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) console.log(`         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`);
}
function checkThat(name, ok, detail) {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok && detail !== undefined) console.log(`         ${detail}`);
}
/* An index is a ratio of sums; comparing two implementations of it to the last
   bit would fail on summation order alone. Six figures is far tighter than any
   difference this harness is looking for. */
function near(name, got, want, tol) {
  const ok = Math.abs(got - want) <= (tol === undefined ? 1e-9 : tol);
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) console.log(`         got  ${got}\n         want ${want} (±${tol === undefined ? 1e-9 : tol})`);
}

/* ======================================================================
 * THE FIXTURE
 * One plant, one material, two sold-tos, one month against the same month
 * a year back.
 *
 *   A  the credit-cancelled pair. 47.04 t for $0.14 last year against
 *      2,918.59 t for $42,780.71 this year: ASP 0.003 -> 14.658, +492,409%.
 *   B  an ordinary pair. $20.00/t -> $20.60/t, +3.0%.
 * ==================================================================== */
const PLANT = '3P36 - TRT MOSPORT #20 SAND & GRAVEL';
const MAT   = '9141 - SG,CONCRETE SAND,W';
const SOLD_A = 'BROCK AGGREGATES INC - 73325';
const SOLD_B = 'ORDINARY CUSTOMER LTD - 10001';

const A = { pyVol: 47.04, pyRev: 0.14, cyVol: 2918.59, cyRev: 42780.71 };
const B = { pyVol: 1000,  pyRev: 20000, cyVol: 1000,   cyRev: 20600 };

const aspOf = p => ((p.cyRev / p.cyVol) - (p.pyRev / p.pyVol)) / (p.pyRev / p.pyVol);

/* What the answer has to be, worked out here rather than copied off a run.
   CPI: both pairs are covered, so both are in the WEIGHT — Qlik's TotalWeight is
   every covered pair — and only A is taken out of the FACTOR. */
const CPI_WEIGHT    = A.cyRev + B.cyRev;
const CPI_FACTOR_ON = B.cyRev * aspOf(B);                       // A excluded
const CPI_FACTOR_OFF= A.cyRev * aspOf(A) + B.cyRev * aspOf(B);  // the bug
const CPI_ON  = CPI_FACTOR_ON  / CPI_WEIGHT;
const CPI_OFF = CPI_FACTOR_OFF / CPI_WEIGHT;

/* PPI: one pair, because the grain drops sold-to. Nothing to exclude. */
const P = { pyVol: A.pyVol + B.pyVol, pyRev: A.pyRev + B.pyRev,
            cyVol: A.cyVol + B.cyVol, cyRev: A.cyRev + B.cyRev };
const PPI = aspOf(P);

console.log('\ntests/cpiindex.js');
console.log(`  fixture: pair A moves ${(aspOf(A) * 100).toFixed(0)}%, pair B ${(aspOf(B) * 100).toFixed(1)}%`);
console.log(`           CPI with the guard ${(CPI_ON * 100).toFixed(4)}%, without it ${(CPI_OFF * 100).toFixed(0)}%`);
console.log(`           PPI (one pair at its own grain) ${(PPI * 100).toFixed(4)}%\n`);

/* ======================================================================
 * 1. A COVERAGE EDIT IS AN INVALIDATION
 * ==================================================================== */
console.log('1. ovcCovTok_ — editing a threshold moves the generation');

const ctx = vm.createContext({
  console,
  /* Ov_Backend reads these two at generation time. Fixed, so the ONLY thing
     that can move ovcGen_ in this section is the coverage block. */
  APP_getGen_: () => 'g1',
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '0' }) },
});
load(ctx, 'Config.gs', 'Ov_Backend.gs');

const COV = ctx.APP_CONFIG.CUBE.COVERAGE;
const gen0 = ctx.ovcGen_();
const tok0 = ctx.ovcCovTok_();

checkThat('the token is in the generation', gen0.indexOf(tok0) !== -1,
          `gen ${gen0} does not contain ${tok0}`);
check('the generation is stable when nothing changes', ctx.ovcGen_(), gen0);

COV.cpiOutlier = 3.0;
checkThat('cpiOutlier 5.0 -> 3.0 moves it', ctx.ovcGen_() !== gen0, ctx.ovcGen_());
COV.cpiOutlier = 5.0;
check('and putting it back restores it', ctx.ovcGen_(), gen0);

/* A token that only noticed cpiOutlier would let the PPI floors go stale in
   exactly the same way. It hashes the whole block. */
COV.rmx.minRev = 111;
checkThat('an rmx floor moves it too', ctx.ovcGen_() !== gen0, ctx.ovcGen_());
COV.rmx.minRev = 110;
check('and back', ctx.ovcGen_(), gen0);

/* Nothing about deleting a key can leave the token where it was, either — a
   removed threshold is the exact state that produced +141.7%. */
delete COV.cpiOutlier;
checkThat('deleting cpiOutlier moves it', ctx.ovcGen_() !== gen0, ctx.ovcGen_());
COV.cpiOutlier = 5.0;
check('and restoring it restores the generation', ctx.ovcGen_(), gen0);

/* The cross-filter dataset carries the same number and is cached under its own
   key. Source text, because getCrossData needs a Spreadsheet to run. */
const pv = region('PV_Backend.gs');
const xfKey = /var ck = gk_\('xfdata:(.*)\);/.exec(pv);
checkThat("getCrossData's cache key carries the coverage token",
          !!xfKey && /ovcCovTok_\(\)/.test(xfKey[1]),
          xfKey ? xfKey[0] : "no `var ck = gk_('xfdata:…);` in PV_Backend.gs");

/* ======================================================================
 * 2. THE SERVER'S POOLING — piIndex_
 * ==================================================================== */
console.log('\n2. piIndex_ — the threshold takes a pair out of the FACTOR only');

/* piIndex_ lives INSIDE `var PV = (function(){ … })()` and is not on the
   surface that IIFE returns — the front end never calls it directly. So take
   the helpers out of the region the way scriptgs.js takes §3's shared header
   functions out of the router: one slice, between two anchors that are lines of
   CODE, evaluated on its own. It carries the real toNum_ with it, which is the
   point — a stubbed one would not read an accounting negative.

   Nothing in the slice runs at load time except literal `var`s, so the fact
   that it stops short of getCustomerReport costs nothing. If either anchor
   moves this throws by name rather than quietly testing an empty string. */
function pvHelpers() {
  const src = region('PV_Backend.gs');
  const from = src.indexOf('\nfunction toNum_(v) {');
  const to = src.indexOf('\nfunction getCustomerReport(opts) {');
  if (from === -1 || to === -1 || to <= from) {
    throw new Error('cpiindex.js: PV_Backend.gs has lost the shape this slice needs —\n' +
      '  it runs from `function toNum_(v) {` to `function getCustomerReport(opts) {`,\n' +
      `  and found them at ${from} / ${to}.`);
  }
  return src.slice(from, to);
}
const sctx = vm.createContext({ console });
load(sctx, 'Config.gs');
vm.runInContext(pvHelpers(), sctx, { filename: 'script.gs (PV_Backend.gs price index)' });

/* The threshold the config actually ships, read the way the server reads it —
   so this harness cannot drift from §1 by holding its own copy of 5.0. */
const CAP = sctx.piCpiOutlier_();
check('piCpiOutlier_ reads the shipped threshold', CAP, ctx.APP_CONFIG.CUBE.COVERAGE.cpiOutlier);
checkThat('…and it is a real guard, not off', CAP > 0, CAP);

const IX = { plantCol: 0, soldTo: 1, matCol: 2, pyVol: 3, cyVol: 4, pyRev: 5, cyRev: 6 };
const rows = [
  [PLANT, SOLD_A, MAT, A.pyVol, A.cyVol, A.pyRev, A.cyRev],
  [PLANT, SOLD_B, MAT, B.pyVol, B.cyVol, B.pyRev, B.cyRev],
];
const cpiKey = sctx.piKeyCpi_(IX), ppiKey = sctx.piKeyPpi_(IX);

const sCpiOn  = sctx.piIndex_(rows, IX, cpiKey, CAP);
const sCpiOff = sctx.piIndex_(rows, IX, cpiKey, 0);
const sPpi    = sctx.piIndex_(rows, IX, ppiKey, 0);

near('CPI weight is EVERY covered pair, outlier included', sCpiOn.weight, CPI_WEIGHT, 1e-6);
near('the excluded pair keeps its weight', sCpiOn.weight, sCpiOff.weight, 1e-6);
near('CPI index with the guard', sCpiOn.index, CPI_ON, 1e-12);
near('CPI index without it (what the page published)', sCpiOff.index, CPI_OFF, 1e-6);
checkThat('and the two are three orders of magnitude apart',
          sCpiOff.index / sCpiOn.index > 1000, sCpiOff.index / sCpiOn.index);

near('PPI pools the two sold-tos into ONE pair', sPpi.index, PPI, 1e-12);
near('…and passing a threshold to PPI would change nothing at this grain',
     sctx.piIndex_(rows, IX, ppiKey, CAP).index, sPpi.index, 1e-12);

/* The grain is the only difference between the two indices, and CPI cannot be
   computed at all without sold-to. */
check('no sold-to column -> no CPI key, so no CPI',
      sctx.piKeyCpi_({ plantCol: 0, matCol: 2, soldTo: -1 }), null);

/* ======================================================================
 * 3. THE BROWSER'S POOLING — AmrCube.query
 * Driven through the real loader: a fake google.script.run answers the two
 * cube calls, and with no indexedDB the whole thing runs in memory.
 * ==================================================================== */
console.log('\n3. AmrCube.query — the same arithmetic, and the fail-closed read');

const SHAPE = { dims: ['plant', 'material', 'plantType', 'matFam', 'prodClass',
                       'prodApp', 'custSeg', 'custParent', 'soldTo'],
                vals: ['v', 'r', 'fsc', 'fv'] };

/* dictionary-coded columns, exactly the shape CUBE_getChunk sends */
const DICT = {
  plant: [PLANT], material: [MAT], plantType: ['Sand & Gravel Pit'], matFam: ['SAND & GRAVEL'],
  prodClass: ['Premium Granular'], prodApp: ['Contractors'], custSeg: ['BROKER'],
  custParent: ['G&L Group', 'Ordinary'], soldTo: [SOLD_A, SOLD_B],
  /* the plant-derived side tables, resolved through plantMap rather than
     carried on a fact row — 'market' is what the Market summary groups by */
  market: ['GTA AGG'], sm1: ['East GTA'], sm2: ['East GTA'], mb: ['Greater Toronto Area'],
};
const FACTS = [
  /* ym,      soldTo, custParent, v,        r */
  [202508, 0, 0, A.pyVol, A.pyRev],
  [202508, 1, 1, B.pyVol, B.pyRev],
  [202608, 0, 0, A.cyVol, A.cyRev],
  [202608, 1, 1, B.cyVol, B.cyRev],
];
function chunkCols() {
  const cols = { ym: [] };
  SHAPE.dims.concat(SHAPE.vals).forEach(f => { cols[f] = []; });
  FACTS.forEach(([ym, st, cp, v, r]) => {
    cols.ym.push(ym);
    cols.plant.push(0); cols.material.push(0); cols.plantType.push(0); cols.matFam.push(0);
    cols.prodClass.push(0); cols.prodApp.push(0); cols.custSeg.push(0);
    cols.custParent.push(cp); cols.soldTo.push(st);
    cols.v.push(v); cols.r.push(r); cols.fsc.push(0); cols.fv.push(0);
  });
  return cols;
}

/* `coverage` is the whole point of the fixture, so it is a parameter. Passing
   null builds the manifest a device held before the threshold existed: the key
   is ABSENT, not zero. */
function manifestFor(coverage) {
  const man = {
    ok: true, gen: 'fixture-' + (coverage ? JSON.stringify(coverage) : 'none'),
    line: 'agg', ym: [202508, 202608],
    dims: SHAPE.dims, vals: SHAPE.vals,
    chunks: [{ i: 0, from: 202508, to: 202608, rows: FACTS.length }],
    dict: DICT, plantMap: { market: [0], sm1: [0], sm2: [0], mb: [0] },
    skipped: 0, history: false, eras: [], floor: 202301, unmapped: null,
  };
  if (coverage) man.coverage = coverage;
  return man;
}

function bootCube(coverage) {
  const man = manifestFor(coverage);
  const answers = {
    CUBE_getManifest: () => ({ ok: true, gen: man.gen, lines: { agg: man }, only: ['agg'] }),
    CUBE_getChunk: o => ({ ok: true, gen: man.gen, line: 'agg', i: o.i, cols: chunkCols() }),
  };
  /* google.script.run's real contract: chained handlers, then the call. */
  function runner() {
    const st = { ok: null, err: null };
    const self = {
      withSuccessHandler(f) { st.ok = f; return self; },
      withFailureHandler(f) { st.err = f; return self; },
    };
    Object.keys(answers).forEach(fn => {
      self[fn] = arg => {
        try { st.ok && st.ok(answers[fn](arg || {})); }
        catch (e) { st.err && st.err(e); }
      };
    });
    return self;
  }
  const win = { indexedDB: undefined };
  const cctx = vm.createContext({
    console, window: win, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite,
    google: { script: { run: runner() } },
  });
  /* the module's IIFE assigns to window.AmrCube, exactly as the page does */
  vm.runInContext(mod('AmrCube'), cctx, { filename: 'app.html (AmrCube)' });
  const cube = win.AmrCube;
  cube.configure({ lines: ['agg'] });
  return cube.init().then(() => cube);
}

const CY = [202608], PY = [202508];

bootCube({ minVol: 0, minRev: 0, cpiOutlier: CAP }).then(cube => {
  const g = cube.query({ line: 'agg', cyMonths: CY, pyMonths: PY });
  checkThat('the cube loaded the fixture', !!g && g.cyVol > 0, JSON.stringify(g));
  near('cube CPI weight == piIndex_ weight', g.cpiW, sCpiOn.weight, 1e-6);
  near('cube CPI == piIndex_ CPI', g.cpi, sCpiOn.index, 1e-12);
  near('cube CPI == the figure worked out above', g.cpi, CPI_ON, 1e-12);
  near('cube PPI == piIndex_ PPI', g.ppi, sPpi.index, 1e-12);
  near('PPI is untouched by the CPI threshold', g.ppi, PPI, 1e-12);

  /* Grouping must not change the method: one market here, so the row and the
     total are the same pooling over the same pairs. */
  const rowsOut = cube.query({ line: 'agg', cyMonths: CY, pyMonths: PY, groupBy: 'market' });
  near('a grouped row pools the same way', rowsOut[0].cpi, CPI_ON, 1e-12);

  return bootCube({ minVol: 0, minRev: 0, cpiOutlier: 0 });
}).then(cube => {
  const g = cube.query({ line: 'agg', cyMonths: CY, pyMonths: PY });
  near('a deliberate 0 disables the guard (and is not read as "absent")',
       g.cpi, CPI_OFF, 1e-6);
  checkThat('…which is the +141.7% shape', g.cpi > 100, g.cpi);

  return bootCube(null);
}).then(cube => {
  const g = cube.query({ line: 'agg', cyMonths: CY, pyMonths: PY });
  /* THE ONE THAT WOULD HAVE CAUGHT IT. A manifest with no coverage block at all
     is what a warm device held. It must report NO CPI, not an unexcluded one. */
  check('a manifest with no threshold reports NO CPI', g.cpi, null);
  check('…and no CPI weight either', g.cpiW, 0);
  near('…while PPI still answers', g.ppi, PPI, 1e-12);

  const rowsOut = cube.query({ line: 'agg', cyMonths: CY, pyMonths: PY, groupBy: 'market' });
  check('grouped rows drop the column too', rowsOut[0].cpi, null);

  /* ==================================================================
   * 4. THE SAME RULE ON THE CROSS-FILTER PATH
   * xfComputeLocal is page code, not a module, so this is source text —
   * the same method tests/README.md describes for the PV_Lookup checks.
   * ================================================================ */
  console.log('\n4. xfComputeLocal — the local path reads it the same way');
  const app = appWhole();
  checkThat('CPIOUT is null when the payload carries no threshold',
            /var CPIOUT=\(D && D\.cpiOutlier!=null\) \? D\.cpiOutlier : null;/.test(app),
            'xfComputeLocal still reads `(D && D.cpiOutlier) || 0`, which reads a ' +
            'payload built before the threshold as "no threshold at all"');
  checkThat('…and a null threshold means no CPI, not an unexcluded one',
            /var ci=\(D\._pc && CPIOUT!==null\)\?poolPairs\(o\.pc, CPIOUT\):null;/.test(app),
            'xfComputeLocal still pools CPI whenever _pc exists');
  checkThat("the cube's pool() reads it the same way",
            /var cpiOut = \(cov && cov\.cpiOutlier != null\) \? cov\.cpiOutlier : null;/.test(app),
            'AmrCube still reads `cov.cpiOutlier || 0`');
  checkThat('the warm manifest is written back after revalidation',
            /if \(man\.gen === gen\)\{[\s\S]{0,900}?idbPut\('meta', 'man', man\);/.test(app),
            "revalidate() does not re-store the manifest, so a warm device keeps " +
            "painting from the one it first saw for as long as the generation holds");

  console.log(fails ? `\ncpiindex.js: ${fails} FAILED\n` : '\ncpiindex.js: all checks passed\n');
  process.exit(fails ? 1 : 0);
}).catch(e => {
  console.error('\ncpiindex.js: threw —', e && e.stack ? e.stack : e);
  process.exit(1);
});
