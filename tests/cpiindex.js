/* tests/cpiindex.js — the CPI coverage gate, and the reason it did nothing
 * ---------------------------------------------------------------------------
 * CPI shipped with a gate the page never applied. The Overview published
 * +141.7% for 2026 Jan-Aug against Qlik's 2.86%, and +243.0% for GTA against
 * 2.48% — one pair, plant 3P36 / Brock Aggregates / 9141, whose March 2025
 * invoice of $693.98 met an April credit of $693.84. Fourteen cents against 47
 * tonnes is an ASP move of +492,409%, and it carried 135 of those 141.7 points
 * by itself.
 *
 * Nothing was wrong with the arithmetic. THE GATE NEVER ARRIVED.
 *
 *   §1's COVERAGE block is read on the server, but the browser does the
 *   pooling, so the numbers TRAVEL — inside the cube manifest and inside the
 *   cross-filter dataset. Every cache key in that chain was built from the
 *   DATA's generation and the cube's SHAPE, neither of which moves when a
 *   threshold is edited. The server's own manifest cache answered from the copy
 *   it built before the edit; the browser's IndexedDB copy of that manifest is
 *   only wiped when the generation moves, so a warm device kept painting from
 *   the pre-edit manifest indefinitely; and reading the missing key with
 *   `|| 0` took it for "no gate at all".
 *
 * So this harness gates the two halves of the fix, and the arithmetic that
 * sits between them:
 *
 *   1. A COVERAGE EDIT IS AN INVALIDATION. ovcCovTok_ hashes the block into
 *      ovcGen_, and getCrossData's key carries it too. Also that the token is
 *      STABLE — one that moved on its own would wipe the cube on every boot.
 *   2. A PAYLOAD THAT CANNOT SAY WHAT THE GATE IS REPORTS NO CPI. Not an
 *      ungated one. The column is dropped exactly as it is on a line with no
 *      sold-to, which is a rule app.html already had and states in three places.
 *   3. A GATED PAIR LEAVES BOTH SUMS. That is the correction over the outlier
 *      cap this replaces, which left the weight behind and dropped only the
 *      factor. Qlik deletes; so do we.
 *   4. THE SERVER AND THE BROWSER POOL THE SAME WAY. piIndex_ and AmrCube's
 *      pool() are two copies of one method; they are asserted equal on one
 *      fixture, at both grains, gated and ungated.
 *
 * THE FIXTURE IS TWO REAL PAIRS. Brock Aggregates and JNF Ready Mix, their own
 * numbers as they stand in the 2026 Jan-Aug window, beside one ordinary pair at
 * the same plant and material. Both bad pairs are needed and they fail
 * different floors: Brock has fourteen cents of prior-year revenue, so the
 * revenue floor takes it; JNF is large and healthy on every figure the floors
 * can see and only the PRICE floor catches it. A harness carrying Brock alone
 * would pass on a half-fix that leaves SW Ontario reading 14.36%.
 *
 * The ordinary pair shares their plant and material deliberately: at the CPI
 * grain (plant x sold-to x material) these are three pairs and the gate has
 * something to catch, while at the PPI grain (plant x material) they are ONE
 * pair with nothing extreme left in it — which is the actual reason PPI never
 * needed the rule and must not be given it.
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
 *   A  the credit-cancelled pair (Brock). 47.04 t for $0.14 last year
 *      against 2,918.59 t for $42,780.71: ASP 0.003 -> 14.658, +492,409%.
 *      Caught by minRev.
 *   B  an ordinary pair. $20.00/t -> $20.60/t, +3.0%. Kept.
 *   C  the rebate-priced pair (JNF). 378 t at $2.343/t against 24,593 t at
 *      $22.75/t, +870.9%, carrying $559k. Clears every volume and revenue
 *      floor; caught by minAsp alone.
 * ==================================================================== */
const PLANT = '3P36 - TRT MOSPORT #20 SAND & GRAVEL';
const MAT   = '9141 - SG,CONCRETE SAND,W';
const SOLD_A = 'BROCK AGGREGATES INC - 73325';
const SOLD_B = 'ORDINARY CUSTOMER LTD - 10001';
const SOLD_C = 'JNF READY MIX - 70123';

const A = { pyVol: 47.04, pyRev: 0.14, cyVol: 2918.59, cyRev: 42780.71 };
const B = { pyVol: 1000,  pyRev: 20000, cyVol: 1000,   cyRev: 20600 };
/* C — the pair the volume and revenue floors do NOT catch, and the reason the
   gate needs a price floor as well. JNF Ready Mix's own numbers: 378 t at
   $2.343/t last year (the rebate, not a price) against 24,593 t at $22.75/t
   this year. Every figure clears "> 1" comfortably. */
const C = { pyVol: 378.38, pyRev: 886.56, cyVol: 24593.23, cyRev: 559435.68 };

const aspOf = p => ((p.cyRev / p.cyVol) - (p.pyRev / p.pyVol)) / (p.pyRev / p.pyVol);

/* What the answer has to be, worked out here rather than copied off a run.
   GATED: A fails minRev ($0.14) and C fails minAsp ($2.343/t last year), so both
   leave the WEIGHT as well as the FACTOR. Only B is left. */
const CPI_WEIGHT_ON = B.cyRev;
const CPI_ON = aspOf(B);                                        // = factor / weight
/* UNGATED: what the page published — every pair in both sums. */
const CPI_WEIGHT_OFF = A.cyRev + B.cyRev + C.cyRev;
const CPI_OFF = (A.cyRev * aspOf(A) + B.cyRev * aspOf(B) + C.cyRev * aspOf(C)) / CPI_WEIGHT_OFF;
/* VOLUME AND REVENUE FLOORS ONLY: A goes, C stays. This is the half-fix, and it
   is why the gate carries a price floor too. */
const CPI_WEIGHT_VR = B.cyRev + C.cyRev;
const CPI_VR = (B.cyRev * aspOf(B) + C.cyRev * aspOf(C)) / CPI_WEIGHT_VR;

/* PPI: one pair, because the grain drops sold-to. Nothing to gate. */
const P = { pyVol: A.pyVol + B.pyVol + C.pyVol, pyRev: A.pyRev + B.pyRev + C.pyRev,
            cyVol: A.cyVol + B.cyVol + C.cyVol, cyRev: A.cyRev + B.cyRev + C.cyRev };
const PPI = aspOf(P);

console.log('\ntests/cpiindex.js');
console.log(`  fixture: A moves ${(aspOf(A) * 100).toFixed(0)}%, B ${(aspOf(B) * 100).toFixed(1)}%, C ${(aspOf(C) * 100).toFixed(1)}%`);
console.log(`           CPI gated ${(CPI_ON * 100).toFixed(4)}% · vol/rev floors only ${(CPI_VR * 100).toFixed(2)}% · ungated ${(CPI_OFF * 100).toFixed(0)}%`);
console.log(`           PPI (one pair at its own grain) ${(PPI * 100).toFixed(4)}%\n`);

/* ======================================================================
 * 1. A COVERAGE EDIT IS AN INVALIDATION
 * ==================================================================== */
console.log('1. ovcCovTok_ — editing the coverage block moves the generation');

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

COV.cpi.minAsp = 4;
checkThat('cpi.minAsp 3 -> 4 moves it', ctx.ovcGen_() !== gen0, ctx.ovcGen_());
COV.cpi.minAsp = 3;
check('and putting it back restores it', ctx.ovcGen_(), gen0);

COV.cpi.minRev = 2;
checkThat('a nested cpi floor moves it too', ctx.ovcGen_() !== gen0, ctx.ovcGen_());
COV.cpi.minRev = 1;
check('and back', ctx.ovcGen_(), gen0);

/* A token that only noticed the cpi block would let the PPI floors go stale in
   exactly the same way. It hashes the whole block. */
COV.rmx.minRev = 111;
checkThat('an rmx floor moves it too', ctx.ovcGen_() !== gen0, ctx.ovcGen_());
COV.rmx.minRev = 110;
check('and back', ctx.ovcGen_(), gen0);

/* Nothing about deleting a key can leave the token where it was, either — a
   removed gate is the exact state that produced +141.7%. */
const CPI_BLOCK = COV.cpi;
delete COV.cpi;
checkThat('deleting the whole cpi block moves it', ctx.ovcGen_() !== gen0, ctx.ovcGen_());
COV.cpi = CPI_BLOCK;
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
console.log('\n2. piIndex_ — a gated pair leaves BOTH sums');

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
/* The gate the config actually ships, read the way the server reads it, so this
   harness cannot drift from §1 by holding its own copy of the numbers. */
const GATE = sctx.piCpiCov_();
check('piCpiCov_ reads the shipped block', GATE, ctx.APP_CONFIG.CUBE.COVERAGE.cpi);
checkThat('…and it is a real gate, not an empty one',
          !!GATE && GATE.minVol > 0 && GATE.minRev > 0 && GATE.minAsp > 0, JSON.stringify(GATE));

/* The fixture is only meaningful if the shipped numbers actually separate it.
   Asserted rather than assumed: raise minRev past $20,000 and B would fail too,
   and every expectation below would quietly become a different claim. */
checkThat('A fails the gate on prior-year revenue',
          !(A.pyRev > GATE.minRev), A.pyRev);
checkThat('C clears every volume and revenue floor',
          C.pyVol > GATE.minVol && C.cyVol > GATE.minVol &&
          C.pyRev > GATE.minRev && C.cyRev > GATE.minRev, JSON.stringify(C));
checkThat('…and fails only on prior-year price',
          !((C.pyRev / C.pyVol) > GATE.minAsp) && (C.cyRev / C.cyVol) > GATE.minAsp,
          C.pyRev / C.pyVol);
checkThat('B clears all three', B.pyVol > GATE.minVol && B.pyRev > GATE.minRev &&
          (B.pyRev / B.pyVol) > GATE.minAsp && (B.cyRev / B.cyVol) > GATE.minAsp, JSON.stringify(B));

const IX = { plantCol: 0, soldTo: 1, matCol: 2, pyVol: 3, cyVol: 4, pyRev: 5, cyRev: 6 };
const rows = [
  [PLANT, SOLD_A, MAT, A.pyVol, A.cyVol, A.pyRev, A.cyRev],
  [PLANT, SOLD_B, MAT, B.pyVol, B.cyVol, B.pyRev, B.cyRev],
  [PLANT, SOLD_C, MAT, C.pyVol, C.cyVol, C.pyRev, C.cyRev],
];
const cpiKey = sctx.piKeyCpi_(IX), ppiKey = sctx.piKeyPpi_(IX);

const sCpiOn  = sctx.piIndex_(rows, IX, cpiKey, GATE);
const sCpiOff = sctx.piIndex_(rows, IX, cpiKey, null);
const sCpiVR  = sctx.piIndex_(rows, IX, cpiKey, { minVol:1, minRev:1 });   // no price floor
const sPpi    = sctx.piIndex_(rows, IX, ppiKey, null);

near('a gated pair leaves the WEIGHT too', sCpiOn.weight, CPI_WEIGHT_ON, 1e-6);
checkThat('…which is what makes it a gate and not a cap',
          sCpiOn.weight < sCpiOff.weight, `${sCpiOn.weight} vs ${sCpiOff.weight}`);
near('gated CPI', sCpiOn.index, CPI_ON, 1e-12);
near('ungated CPI (what the page published)', sCpiOff.index, CPI_OFF, 1e-6);
checkThat('and the two are three orders of magnitude apart',
          sCpiOff.index / sCpiOn.index > 1000, sCpiOff.index / sCpiOn.index);

/* THE CHECK THAT WOULD HAVE CAUGHT THE HALF-FIX. Volume and revenue floors on
   their own take Brock and leave JNF, which is a 20x error still on the page. */
near('volume and revenue floors alone leave the rebate-priced pair', sCpiVR.index, CPI_VR, 1e-9);
checkThat('…which is still an order of magnitude wrong',
          sCpiVR.index > CPI_ON * 10, `${sCpiVR.index} vs ${CPI_ON}`);
near('only the price floor closes it', sCpiOn.index, CPI_ON, 1e-12);

near('PPI pools the three sold-tos into ONE pair', sPpi.index, PPI, 1e-12);
near('…and passing the gate to PPI would change nothing at this grain',
     sctx.piIndex_(rows, IX, ppiKey, GATE).index, sPpi.index, 1e-12);

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
  custParent: ['G&L Group', 'Ordinary', 'JNF'], soldTo: [SOLD_A, SOLD_B, SOLD_C],
  /* the plant-derived side tables, resolved through plantMap rather than
     carried on a fact row — 'market' is what the Market summary groups by */
  market: ['GTA AGG'], sm1: ['East GTA'], sm2: ['East GTA'], mb: ['Greater Toronto Area'],
};
const FACTS = [
  /* ym,      soldTo, custParent, v,        r */
  [202508, 0, 0, A.pyVol, A.pyRev],
  [202508, 1, 1, B.pyVol, B.pyRev],
  [202508, 2, 2, C.pyVol, C.pyRev],
  [202608, 0, 0, A.cyVol, A.cyRev],
  [202608, 1, 1, B.cyVol, B.cyRev],
  [202608, 2, 2, C.cyVol, C.cyRev],
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
   null builds the manifest a device held before the gate existed: the key is
   ABSENT, which is not the same as present and empty. */
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

bootCube({ minVol: 0, minRev: 0, cpi: GATE }).then(cube => {
  const g = cube.query({ line: 'agg', cyMonths: CY, pyMonths: PY });
  checkThat('the cube loaded the fixture', !!g && g.cyVol > 0, JSON.stringify(g));
  near('cube CPI weight == piIndex_ weight', g.cpiW, sCpiOn.weight, 1e-6);
  near('…and it is the gated weight, not every pair', g.cpiW, CPI_WEIGHT_ON, 1e-6);
  near('cube CPI == piIndex_ CPI', g.cpi, sCpiOn.index, 1e-12);
  near('cube CPI == the figure worked out above', g.cpi, CPI_ON, 1e-12);
  near('cube PPI == piIndex_ PPI', g.ppi, sPpi.index, 1e-12);
  near('PPI is untouched by the CPI threshold', g.ppi, PPI, 1e-12);

  /* Grouping must not change the method: one market here, so the row and the
     total are the same pooling over the same pairs. */
  const rowsOut = cube.query({ line: 'agg', cyMonths: CY, pyMonths: PY, groupBy: 'market' });
  near('a grouped row pools the same way', rowsOut[0].cpi, CPI_ON, 1e-12);

  return bootCube({ minVol: 0, minRev: 0, cpi: { minVol: 1, minRev: 1 } });
}).then(cube => {
  const g = cube.query({ line: 'agg', cyMonths: CY, pyMonths: PY });
  /* the half-fix, through the real cube: floors that do not include a price */
  near('the cube leaves the rebate-priced pair without a price floor', g.cpi, CPI_VR, 1e-9);
  checkThat('…still an order of magnitude wrong', g.cpi > CPI_ON * 10, g.cpi);

  return bootCube({ minVol: 0, minRev: 0, cpi: { minVol: 0, minRev: 0, minAsp: 0 } });
}).then(cube => {
  const g = cube.query({ line: 'agg', cyMonths: CY, pyMonths: PY });
  /* an all-zero block is a DELIBERATE empty gate, not an absent one: it must
     still report a number, or a zero could never be set on purpose. */
  near('an all-zero block is an empty gate, not an absent one', g.cpi, CPI_OFF, 1e-6);
  checkThat('…which is the +141.7% shape', g.cpi > 100, g.cpi);

  return bootCube(null);
}).then(cube => {
  const g = cube.query({ line: 'agg', cyMonths: CY, pyMonths: PY });
  /* THE ONE THAT WOULD HAVE CAUGHT IT. A manifest with no coverage block at all
     is what a warm device held. It must report NO CPI, not an unexcluded one. */
  check('a manifest with no coverage block reports NO CPI', g.cpi, null);
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
  const has = (label, needle, why) => checkThat(label, app.indexOf(needle) !== -1, why);

  has('CPICOV is null when the payload carries no block',
      'var CPICOV=(D && D.cpiCoverage) ? D.cpiCoverage : null;',
      'xfComputeLocal no longer reads the coverage block defensively');
  has('…and a null block means no CPI, not an ungated one',
      'var ci=(D._pc && CPICOV)?poolPairs(o.pc, CPICOV):null;',
      'xfComputeLocal still pools CPI whenever _pc exists');
  has("the cube's pool() reads it the same way",
      'var cpiCov = (cov && cov.cpi) ? cov.cpi : null;',
      'AmrCube no longer reads the coverage block defensively');

  /* THE PRICE FLOOR IS THE HALF THE FIXTURE ABOVE PROVES MATTERS, and neither
     browser path is exercised for it by the cube test — poolPairs is page code.
     Both are asserted here so a half-fix cannot ship on one path. */
  has('the local path gates on PRICE, not just volume and revenue',
      'if(xa>0 && !(ca>xa && pa>xa)) continue;',
      'poolPairs has no minAsp test — the rebate-priced pair survives there');
  has("…and so does the cube's",
      'if (xa > 0 && !(cyAsp > xa && pyAsp > xa)) continue;',
      'AmrCube pool() has no minAsp test');

  /* A gate deletes. If either path adds the weight before the tests, a gated
     pair is back in the denominator and the cap's bug is back with it. */
  has('the local path adds the weight AFTER the gate',
      'if(xa>0 && !(ca>xa && pa>xa)) continue;\n            w+=c.cr;',
      'poolPairs still counts a gated pair in the weight');

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
