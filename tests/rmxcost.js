/* tests/rmxcost.js — why Ready-Mix was slow, and that RMX_prepare fixes it
 * without moving a number.
 *
 *   node tests/rmxcost.js            # the checks
 *   N=80000 node tests/rmxcost.js    # a bigger sheet
 *
 * WHY THIS EXISTS
 * The execution log showed RMX_getSlideTables and RMX_getKeys at a flat 15-24 s
 * per call, for every market, every time, while the Aggregates side answered the
 * same shape of question in 2-6 s. The obvious suspect was the grouping. It was
 * not: this harness times it at 0.3 s for ALL TWELVE selections. What costs the
 * time is that each of those calls opened with loadDataCached_(), and the cached
 * bundle is 14 MB — 160 CacheService chunks — pulled back in full to produce a
 * 72 KB answer.
 *
 * That ratio is the whole bug, and it is the one thing a Node harness can show
 * without Google access: sizes and chunk counts are arithmetic, and the grouping
 * is pure JavaScript. What it cannot time is CacheService itself, so it reports
 * chunk counts rather than pretending to know the seconds.
 *
 * WHAT IT PINS
 *   1. the bundle is orders of magnitude bigger than any answer taken off it,
 *      so a per-request bundle read can never be cheap;
 *   2. reading it once for all twelve selections is dramatically less work;
 *   3. prepareAll writes each payload under the key its OWN reader looks in —
 *      the failure this would otherwise ship silently is a warm pass that fills
 *      keys nobody reads, where everything looks fine and every request still
 *      recomputes;
 *   4. prepareAll changes no figure: every payload it caches is identical to
 *      what the individual call computes.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = path.resolve(__dirname, '..');
const { region } = require('./scriptgs.js');

/* ---- the Apps Script globals RMX_Backend.gs touches --------------------- */
const CACHE = {};                       // a CacheService that counts its traffic
let gets = 0, puts = 0, getKeysN = 0, putKeysN = 0;
global.CacheService = { getScriptCache(){ return {
  get(k){ gets++; getKeysN++; return CACHE[k] == null ? null : CACHE[k]; },
  getAll(ids){ gets++; getKeysN += ids.length; const o = {};
               ids.forEach(k => { if (CACHE[k] != null) o[k] = CACHE[k]; }); return o; },
  put(k, v){ puts++; putKeysN++; CACHE[k] = v; },
  putAll(o){ puts++; const ks = Object.keys(o); putKeysN += ks.length;
             ks.forEach(k => { CACHE[k] = o[k]; }); },
  remove(k){ delete CACHE[k]; } }; } };
global.PropertiesService = { getScriptProperties(){ return {
  getProperty(){ return null; }, setProperty(){}, deleteProperty(){} }; } };
global.SpreadsheetApp = {};
global.DriveApp = {};
global.MimeType = {};
global.Logger = { log(){} };
global.Utilities = { getUuid(){ return 'tok'; } };
global.APP_sourceStamp_ = () => '1';
global.APP_forgetStamp_ = () => {};
global.APP_openSpreadsheet_ = () => { throw new Error('rmxcost never opens a sheet'); };
global.APP_CONFIG = { CUBE: { COVERAGE: { rmx: { pyVol:1, cyVol:1, pyRev:110, cyRev:110 } } } };

/* script.gs §7 (was RMX_Backend.gs) is one IIFE, so its helpers are private. One
   extra key is spliced onto the object it returns; nothing else is touched.

   The anchor used to carry a literal \r\n, because RMX_Backend.gs was CRLF like
   most of the repo. script.gs is LF throughout (PLAN.md §12), so the line ending
   is matched rather than spelled — otherwise this harness fails at the splice
   with "could not find the IIFE return", which reads like the return moved. */
let src = region('RMX_Backend.gs');
const RET_RE = /  \/\/ Surface what the front end \/ Code\.gs need\.\r?\n  return \{/;
const RET = (src.match(RET_RE) || [])[0];
if (!RET) {
  console.error('could not find the IIFE return in script.gs §7 (RMX_Backend.gs)'); process.exit(2);
}
src = src.replace(RET, RET + '\n    __t: { keyRows_:keyRows_, plantRows_:plantRows_,' +
  ' ppiMaps_:ppiMaps_, slideSegment_:slideSegment_, extrasPayload_:extrasPayload_,' +
  ' scopeMonth_:scopeMonth_, inMonth_:inMonth_, monthFor_:monthFor_,' +
  ' selKey_:selKey_, cacheKey_:cacheKey_, cacheGet_:cacheGet_, cachePut_:cachePut_,' +
  ' loadDataCached_:loadDataCached_, ALL_MARKETS:ALL_MARKETS, CONFIG:CONFIG },');
vm.runInThisContext(src, { filename: 'script.gs (RMX_Backend.gs)' });
const T = RMX.__t;

/* ---- a bundle the shape of the live one -------------------------------- */
const MARKETS = ['HNS_SW', 'North', 'Innocon', 'Manitoba', 'Saskatchewan'];
const SEGS = ['Res - Low Rise', 'Res - High Rise', 'ICI', 'Civil', 'COD', 'Specialty'];
const CLS = ['Standard', 'Structural', 'Specialty', 'Others'];
const APPL = ['Slab', 'Wall', 'Footing', 'Column', 'Others'];
const STR = ['20 MPa', '25 MPa', '30 MPa', '35 MPa', '40 MPa', 'Others'];
const TYPES = ['Cooling', 'Standard Fees', 'Misc', 'Flex Fuel (FSC)', 'Fibers', 'Color'];
const N = Number(process.env.N || 40000);

let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = a => a[Math.floor(rnd() * a.length)];

function mkMain(n){
  const out = [];
  for (let i = 0; i < n; i++){
    const mk = MARKETS[i % MARKETS.length];
    out.push({ month: 1 + (i % 12), plant: 'P' + (100 + (i % 200)),
      mix: 'AB' + (100 + (i % 600)) + ' - ' + pick(STR),
      market: mk, submarket: mk + ' SM' + (i % 4),
      segment: pick(SEGS), app: pick(APPL), cls: pick(CLS), strength: pick(STR),
      pyVol: Math.round(rnd()*900), cyVol: Math.round(rnd()*900),
      pyRev: Math.round(rnd()*180000), cyRev: Math.round(rnd()*180000) });
  }
  return out;
}
function mkStream(n, stream){
  const out = [];
  for (let i = 0; i < n; i++){
    const mk = MARKETS[i % MARKETS.length];
    out.push({ month: 1 + (i % 12), plant: 'P' + (100 + (i % 200)), market: mk,
      submarket: mk + ' SM' + (i % 4), segment: pick(SEGS),
      hier3: 'H' + (i % 12), descr: 'Material ' + (i % 90), flag: 'Other',
      type: pick(TYPES), stream: stream,
      pyRev: Math.round(rnd()*4000), cyRev: Math.round(rnd()*5000),
      pyM3: Math.round(rnd()*700), cyM3: Math.round(rnd()*800) });
  }
  return out;
}
const bundle = {
  main: mkMain(N),
  extras: mkStream(Math.round(N * 0.45), 'EXTRAS'),
  assoc:  mkStream(Math.round(N * 0.15), 'VAP'),
  markets: MARKETS, latestMonth: 7,
  months: { all:[1,2,3,4,5,6,7], cy:[1,2,3,4,5,6,7] },
  unmapped: { product:[], extras:[], flag:[] }
};

let bad = 0;
const check = (label, ok, note) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || !note ? '' : '\n         ' + note));
  if (!ok) bad++;
};
const ms = fn => { const a = process.hrtime.bigint(); const r = fn();
  return { ms: Number(process.hrtime.bigint() - a) / 1e6, r }; };
const CH = 90000;
const chunks = o => Math.ceil(JSON.stringify(o).length / CH);
const kb = o => JSON.stringify(o).length / 1024;

console.log('\nRMX cost — ' + N.toLocaleString() + ' main rows, ' +
  bundle.extras.length.toLocaleString() + ' extra, ' + bundle.assoc.length.toLocaleString() + ' assoc\n');

/* ---- 1. the bundle dwarfs every answer taken off it -------------------- */
console.log('1. what has to move through CacheService');
const all = [T.ALL_MARKETS].concat(MARKETS);
const m7 = 7, scoped = T.scopeMonth_(bundle.main, m7);
const oneKeys = { ok:true, keys:T.keyRows_(bundle.main, 'Innocon', m7),
                  ppi:T.ppiMaps_(bundle.main, 'Innocon', m7),
                  plants:T.plantRows_(bundle.main, 'Innocon', m7) };
const ccKeys  = { ok:true, keys:T.keyRows_(bundle.main, T.ALL_MARKETS, m7),
                  ppi:T.ppiMaps_(bundle.main, T.ALL_MARKETS, m7),
                  plants:T.plantRows_(bundle.main, T.ALL_MARKETS, m7) };
const row = (l, o) => console.log('     ' + l.padEnd(40) + kb(o).toFixed(0).padStart(7) + ' KB   '
  + String(chunks(o)).padStart(3) + ' chunks');
row('the data bundle', bundle);
row('a getKeys payload, one market', oneKeys);
row('a getKeys payload, Central Canada', ccKeys);
check('the bundle needs more than 20x the chunks of the biggest answer off it',
  chunks(bundle) > chunks(ccKeys) * 20,
  'bundle ' + chunks(bundle) + ' chunks vs ' + chunks(ccKeys));

/* ---- 2. the grouping was never the cost ------------------------------- */
console.log('\n2. where the work actually is');
const group = ms(() => {
  for (const p of [m7, -m7]) for (const mk of all){
    T.keyRows_(bundle.main, mk, p); T.ppiMaps_(bundle.main, mk, p); T.plantRows_(bundle.main, mk, p);
  }
});
const json = JSON.stringify(bundle);
const reparse = ms(() => { for (let i = 0; i < all.length * 2; i++) JSON.parse(json); });
console.log('     grouping all 12 selections'.padEnd(45) + group.ms.toFixed(0).padStart(7) + ' ms');
console.log('     re-parsing the bundle 12 times'.padEnd(45) + reparse.ms.toFixed(0).padStart(7) + ' ms');
console.log('     (CacheService transfer is on top of the parse, and is the part'
  + '\n      Node cannot see — 160 chunks a call, 12 calls)');
check('grouping every selection costs under a second',
  group.ms < 1000, group.ms.toFixed(0) + ' ms');

/* ---- 3. prepareAll writes where the readers read ---------------------- */
console.log('\n3. prepareAll fills the keys the readers look in');
/* the bundle is what loadDataCached_ would have returned */
T.cachePut_(T.cacheKey_(['data']), bundle);
T.cachePut_(T.cacheKey_(['lookups']), { plant:{}, product:{}, extras:{}, customFlag:{} });

for (const want of ['keys', 'slide']) {
  gets = puts = getKeysN = putKeysN = 0;
  const p = RMX.prepareAll({ want: want, month: m7, market: 'Innocon', period: 'MTD' });
  check('prepare(' + want + ') warmed 12 selections', p.warmed >= 12, 'warmed ' + p.warmed);
  check('prepare(' + want + ') hands back the asked-for payload', !!p.payload);
  check('prepare(' + want + ') reports the market list and month options',
    p.markets.length === MARKETS.length && !!(p.months && p.months.cy.length));
  const writes = putKeysN;

  /* now every reader must be a HIT — no bundle read at all */
  const before = getKeysN;
  const out = (want === 'keys')
    ? RMX.getKeys({ market:'Innocon', period:'MTD', month:m7 })
    : RMX.getSlideTables({ market:'Innocon', period:'MTD', month:m7 });
  const readChunks = getKeysN - before;
  check('a ' + want + ' read after prepare touches few chunks, not the bundle',
    readChunks < 40, readChunks + ' cache keys read (the bundle alone is ' + chunks(bundle) + ')');
  check('...and still answers', !!(out && out.ok));
  console.log('       prepare wrote ' + writes + ' cache keys; the read took ' + readChunks);
}

/* ---- the Mapping check panel rides along free -------------------------- */
{
  const before = getKeysN;
  const u = RMX.getUnmapped({});
  const read = getKeysN - before;
  check('getUnmapped after prepare reads a cache entry, not the bundle',
    read < 40, read + ' cache keys read (the bundle is ' + chunks(bundle) + ')');
  check('...and still answers', !!(u && u.ok && u.total != null));
}

/* ---- 4. and it changes no figure ------------------------------------- */
console.log('\n4. every warmed payload equals what the single call computes');
for (const period of ['MTD', 'YTD']) {
  const m = T.monthFor_(bundle, period, m7);
  const sc = T.scopeMonth_(bundle.main, m);
  for (const mk of all) {
    /* getKeys */
    const warmK = T.cacheGet_(T.cacheKey_(T.selKey_('keys', period, m7, mk)));
    const liveK = { keys:T.keyRows_(bundle.main, mk, m), ppi:T.ppiMaps_(bundle.main, mk, m),
                    plants:T.plantRows_(bundle.main, mk, m) };
    const okK = warmK && JSON.stringify({ keys:warmK.keys, ppi:warmK.ppi, plants:warmK.plants })
                       === JSON.stringify(liveK);
    /* getSlideTables */
    const warmS = T.cacheGet_(T.cacheKey_(T.selKey_('slide', period, m7, mk)));
    const liveS = { segment:T.slideSegment_(bundle, mk, m),
                    extras:T.extrasPayload_(bundle, sc, mk, m) };
    const okS = warmS && JSON.stringify({ segment:warmS.segment, extras:warmS.extras })
                       === JSON.stringify(liveS);
    if (!okK || !okS) {
      bad++;
      console.log('  FAIL ' + mk + ' ' + period + (okK ? '' : ' — keys differ')
        + (okS ? '' : ' — slide differs'));
    }
  }
}
if (!bad) console.log('  ok   identical for every market x period, keys and slide alike');

/* ---- 5. an upload session never lands in the shared cache ------------ */
console.log('\n5. an upload session stays private');
const beforeKeys = Object.keys(CACHE).length;
try { RMX.prepareAll({ want:'keys', month:m7, upload:'nope' }); } catch (e) {}
check('prepare with an upload token writes no shared entry',
  Object.keys(CACHE).length === beforeKeys,
  (Object.keys(CACHE).length - beforeKeys) + ' new keys appeared');

console.log(bad ? '\n' + bad + ' CHECK(S) FAILED' : '\nRMX COST OK.');
process.exit(bad ? 1 : 0);
