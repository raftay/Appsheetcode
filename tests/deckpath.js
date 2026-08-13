/* Exercise the path the Deck Builder actually takes, under jsdom:
 *   Deck_Sources.html  -> creates AmrDeckSource
 *   Deck_Fuel.html     -> registers 'fsc' and 'rfsc' into it
 *   AmrDeckSource.build(spec) -> prepare() (server call) then content() (DOM)
 *
 * google.script.run is stubbed so prepare() resolves from a fake backend.
 */
const fs = require('fs');
const vm = require('vm');
/* jsdom is not vendored — this repo is a flat mirror of the Apps Script
   project and has no node_modules. require() resolves from THIS directory, so
   installing it elsewhere and running from that cwd will not work; say so
   plainly instead of throwing a module-not-found stack. */
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  console.error('jsdom is not installed where this script can see it.\n' +
    '  npm install jsdom --prefix ' + __dirname + '\n' +
    'or point NODE_PATH at an existing install:\n' +
    '  NODE_PATH=/path/to/node_modules node tests/deckpath.js');
  process.exit(2);
}
const REPO = require('path').resolve(__dirname, '..');

function scriptOf(f) {
  return (fs.readFileSync(`${REPO}/${f}`, 'utf8').match(/<script>([\s\S]*?)<\/script>/g) || [])
    .map(b => b.replace(/^<script>/, '').replace(/<\/script>$/, '')).join('\n');
}

const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
const win = dom.window;

const rows = [
  { market: 'GTA AGG', tonnes26: 1282643, tonnes25: 1390172, fsc26: 314818, fsc25: 0 },
  { market: 'Manitoba', tonnes26: 209115, tonnes25: 215405, fsc26: 54055, fsc25: 56064 },
  { market: 'Grand Total', isTotal: true },
];
const MODEL = {
  markets: ['GTA AGG', 'Manitoba'], latestMonth: 'JUL', cyYear: 2026,
  exec: { MTD: { all: rows, applied: rows }, YTD: { all: rows, applied: rows } },
};

const PVREPORT = { period:'MTD', filterValue:'GTA', latestMonth:7,
  tables:[ { dimension:'Market', volMix:-0.002, rows:[
    {label:'GTA',cyVol:1282643,pyVol:1390172,volPct:-0.077,cyAsp:15.10,pyAsp:14.47,aspPct:0.044,ppi:0.026}],
    total:{cyVol:2266382,pyVol:2444425,volPct:-0.073,cyAsp:17.11,pyAsp:16.64,aspPct:0.028,ppi:0.03} } ],
  revenueBridge:{pyRev:40668495,volImpact:-2962143,priceImpact:1061457,cyRev:38767809},
  priceBridge:{ppi:0.03,totalAsp:0.028,items:[{label:'Region/Market mix',value:-0.003}]} };
const CUSTREP = { rows:[{label:'Amrize RMX',secondary:'INTERNAL RMX',cyVol:28680,pyVol:29575,
  volPct:-0.03,cyAsp:25.6,pyAsp:24.04,aspPct:0.065,cyFsc:12333,ppi:0.088,deltaApplied:0.43}],
  total:{cyVol:99001,pyVol:141871,volPct:-0.302,cyAsp:24.74,pyAsp:23.39,aspPct:0.058,cyFsc:28426,ppi:0.06,deltaApplied:0.45} };
/* RMX_getSlideTables shape (Segment page) and RMX_getKeys/getExtras (RMX page) */
const SEGREP = { market:'SASKATCHEWAN', period:'MTD', latestMonth:7,
  segment:{ rows:[{label:'Res - Low Rise',cyVol:8458,cyPct:.48,pyVol:6754,pyPct:.45,volPct:.25,cyAspVa:314.98,pyAspVa:305.38,aspIncVa:.031}],
            total:{cyVol:17673,pyVol:14948,volPct:.18,cyAspVa:351.36,pyAspVa:337.20,aspIncVa:.042} },
  extras:{ extras:[{label:'Performance',cyVol:2429,volInc:.061,volChg:-.016,cyAsp:365.23,aspInc:.053,cm2:118.44,cm2Inc:0}],
           vap:[{label:'General Purpose',cyVol:7985,volInc:.486,volChg:.092,cyAsp:326.96,aspInc:.03,cm2:69.32,cm2Inc:-.39}] } };
const RMXKEYS = { market:'SASKATCHEWAN', period:'MTD', latestMonth:7, rows:[], plants:[], keys:[] };
/* the Extras payload shape renderExtras() consumes: two streams plus their
   subtotals, and the merged detail list */
const XR = (label,cyRev,pyRev,cyAsp,pyAsp) => ({ label, cyRev, pyRev,
  revPct:(cyRev-pyRev)/pyRev, cyAsp, pyAsp, aspChg:cyAsp-pyAsp });
const RMXEXTRAS = { market:'SASKATCHEWAN', period:'MTD',
  byTypeExtras:[ XR('Standard Fees',774945,632407,43.85,42.31) ],
  byTypeExtrasTotal: XR('EXTRAS',774945,632407,43.85,42.31),
  byTypeVap:[ XR('Other VAP',177009,135567,10.02,9.07) ],
  byTypeVapTotal: XR('VAP',177009,135567,10.02,9.07),
  byTypeTotal: XR('Total',1425417,1021567,80.66,68.34),
  /* the merged detail table reads these two directly */
  extras:[ { label:'Standard Fees', cyVol:0, cyRev:774945, pyRev:632407,
             revPct:.225, cyAsp:43.85, pyAsp:42.31, aspChg:1.54 } ],
  vap:[ { label:'Other VAP', cyVol:0, cyRev:177009, pyRev:135567,
          revPct:.306, cyAsp:10.02, pyAsp:9.07, aspChg:.95 } ] };
let calls = [];
/* google.script.run, stubbed. Each property access returns a FRESH runner:
   the real thing lets two chains be in flight at once, and 'cust' relies on
   that (it asks for MTD and YTD in parallel). A shared handler would silently
   hang the second one. */
win.google = {
  script: {
    get run() {
      const api = {};
      let ok = null;
      api.withSuccessHandler = f => (ok = f, api);
      api.withFailureHandler = () => api;
      const reply = (name, payload) => (...a) => {
        calls.push([name, a]);
        setTimeout(() => ok(payload), 0);
      };
      api.getFscData = reply('getFscData', MODEL);
      api.getRmxFuelData = reply('getRmxFuelData', MODEL);
      api.getReport = reply('getReport', PVREPORT);
      api.getCustomerReport = reply('getCustomerReport', CUSTREP);
      api.RMX_getSlideTables = reply('RMX_getSlideTables', SEGREP);
      api.RMX_getKeys = reply('RMX_getKeys', RMXKEYS);
      api.RMX_getExtras = reply('RMX_getExtras', RMXEXTRAS);
      return api;
    },
  },
};

/* jsdom has no canvas and we do not load Chart.js: stub both so the PV path's
   ASSEMBLY (tables, KPI row, layout) can be exercised. The charts themselves
   come out as empty images — real chart rendering is a browser check. */
win.HTMLCanvasElement.prototype.getContext = function(){ return {}; };
win.Chart = function(ctx, cfg){
  this.options = (cfg && cfg.options) || {};
  this.destroy = function(){}; this.resize = function(){}; this.draw = function(){};
  this.toBase64Image = function(){ return 'data:image/png;base64,STUB'; };
};

vm.createContext(win);
vm.runInContext(scriptOf('Deck_Sources.html'), win);
win.AmrKpi = {
  plantIndex: v => (v ? [{ label:'Central' }, { label:'GTA' }] : []),
  load: cb => setTimeout(() => cb({ ok:true }), 0),
  /* the numbers behind the KPI cards, for whichever region sheet is picked */
  plant: (vals, entry, period) => entry
    ? { aspCy:16.23, aspPy:15.57, salesCy:31790, salesPy:32500, volCy:1960, volPy:2090 }
    : null,
  /* the RMX side of the same workbook, for the Product Segment KPI row */
  rmx: (vals, market, period) => vals
    ? { aspCy:277.71, aspPy:273.37, salesCy:4908, salesPy:4086, volCy:17673, volPy:14948,
        cm2Cy:121.09, cm2Py:133.2 }
    : null,
};
win.localStorage = (function(){ var m={}; return {
  getItem:k=>(k in m?m[k]:null), setItem:(k,v)=>{m[k]=String(v);}, removeItem:k=>{delete m[k];} }; })();
vm.runInContext(scriptOf('Deck_Fuel.html'), win);
vm.runInContext(scriptOf('Deck_PV.html'), win);
vm.runInContext(scriptOf('Deck_SEG.html'), win);
vm.runInContext(scriptOf('Deck_RMX.html'), win);

const R = win.AmrDeckSource;
console.log('registered sources:', R.list().join(', '));
console.log('missingFor([fsc,rfsc,pv]):',
  R.missingFor([{ source: 'fsc' }, { source: 'rfsc' }, { source: 'pv' }]).join(', ') || '(none)');

const specs = [
  { id: 'fsc_mtd', source: 'fsc', period: 'MTD', layout: 'L_FULL_IMAGE' },
  { id: 'fsc_ytd', source: 'fsc', period: 'YTD', layout: 'L_FULL_IMAGE' },
  { id: 'rfsc_mtd', source: 'rfsc', period: 'MTD', layout: 'L_FULL_IMAGE' },
  { id: 'rfsc_ytd', source: 'rfsc', period: 'YTD', layout: 'L_FULL_IMAGE' },
  { id: 'pv_gta_mtd', source: 'pv', market: 'GTA', period: 'MTD', layout: 'L_COMMENT_IMAGE' },
  { id: 'pv_cc_ytd', source: 'pv', market: 'Central Canada', period: 'YTD', layout: 'L_COMMENT_IMAGE' },
  { id: 'cust_gta', source: 'cust', market: 'GTA', layout: 'L_FULL_IMAGE' },
  { id: 'seg_sk_mtd', source: 'seg', market: 'SASKATCHEWAN', period: 'MTD', layout: 'L_COMMENT_IMAGE_NO_KPI' },
  { id: 'rmx_sk_mtd', source: 'rmx', market: 'SASKATCHEWAN', period: 'MTD', layout: 'L_FULL_IMAGE' },
];

let bad = 0;
(async () => {
  for (const s of specs) {
    try {
      const el = await R.build(s);
      const editable = el.querySelectorAll('[contenteditable]').length;
      const tables = el.querySelectorAll('table.fsc-t.exec').length;
      const periods = [...el.querySelectorAll('.fsc-period')].map(n => n.textContent.trim());
      const isFuel = s.source === 'fsc' || s.source === 'rfsc';
      const okAll = isFuel ? (tables === 2 && editable === 0 && periods.length === 1)
                           : (el.querySelectorAll('table').length > 0);
      if (!okAll) bad++;
      const detail = isFuel
        ? `exec tables=${tables} period="${periods.join('|')}"`
        : `tables=${el.querySelectorAll('table').length}` +
          ` kpiCards=${el.querySelectorAll('.pv-exp-kpis > *').length}` +
          ` charts=${el.querySelectorAll('.pv-exp-charts img').length}` +
          ` custBlocks=${el.querySelectorAll('.cust-blk').length}`;
      console.log(`  ${okAll ? 'ok  ' : 'FAIL'} ${s.id.padEnd(10)} contenteditable=${editable} ${detail}`);
    } catch (e) {
      bad++;
      console.log(`  FAIL ${s.id} -> ${e.message}`);
    }
  }

  // an unregistered source must fail with a sentence, not a stack trace
  try {
    await R.build({ id: 'nope_x', source: 'nope' });
    console.log('  FAIL unregistered source resolved (should reject)'); bad++;
  } catch (e) {
    console.log(`  ok   unregistered source rejects: "${e.message.slice(0, 62)}…"`);
  }

  // each backend must be hit ONCE even though two slides use it
  const counts = calls.reduce((o, [f]) => (o[f] = (o[f] || 0) + 1, o), {});
  const cached = counts.getFscData === 1 && counts.getRmxFuelData === 1
    && counts.getReport === 2 && counts.getCustomerReport === 2
    && counts.RMX_getSlideTables === 1 && counts.RMX_getKeys === 1;
  if (!cached) bad++;
  console.log(`  ${cached ? 'ok  ' : 'FAIL'} backend calls: ${JSON.stringify(counts)} (one per market+period, never per slide)`);
  console.log(`       args: ${JSON.stringify(calls.map(c => c[1]))}`);

  console.log(bad ? `\n${bad} FAILURE(S).` : '\nDECK PATH OK.');
  process.exit(bad ? 1 : 0);
})();
