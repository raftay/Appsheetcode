/* Prove the Deck_PV.html lift is faithful on the paths that need no Chart.js:
 *   buildCustTable  (the TOP 10 CUSTOMERS table)
 *   tableInnerHtml  (a dimension table on the market slide)
 *   slideTitle / monthTag_
 * Old page code vs the extracted module, same inputs, diffed.
 */
const fs = require('fs'), vm = require('vm');
const REPO = require('path').resolve(__dirname, '..');
const S = process.env.OLD_DIR || __dirname;

const scriptsOf = f => (fs.readFileSync(f, 'utf8').match(/<script>([\s\S]*?)<\/script>/g) || [])
  .map(b => b.replace(/^<script>/, '').replace(/<\/script>$/, '')).join('\n');

/* ---- old page: run just the definitions, in a DOM-free sandbox ---- */
const oldCode = scriptsOf(`${S}/old_pv.html`);
// keep only top-level function/var declarations we need; running the whole
// page script would fire its boot code, so slice the closure out by name.
function grab(code, names) {
  const out = [];
  for (const n of names) {
    let m = new RegExp('^function\\s+' + n + '\\s*\\(', 'm').exec(code);
    if (m) {
      let i = code.indexOf('{', m.index + m[0].length - 1), d = 0, j = i;
      for (; j < code.length; j++) {
        if (code[j] === '{') d++;
        else if (code[j] === '}') { d--; if (!d) break; }
      }
      out.push(code.slice(m.index, j + 1));
      continue;
    }
    m = new RegExp('^var\\s+' + n + '\\s*=', 'm').exec(code);
    if (m) {
      let i = m.index + m[0].length, d = 0, j = i;
      for (; j < code.length; j++) {
        const c = code[j];
        if ('{[('.includes(c)) d++;
        else if ('}])'.includes(c)) d--;
        else if (c === ';' && d <= 0) break;
      }
      out.push(code.slice(m.index, j + 1));
      continue;
    }
    throw new Error('not found in old page: ' + n);
  }
  return out.join('\n');
}

const NEEDED = ['fInt', 'fMoney', 'fAsp', 'fPct', 'fPctSign', 'fPct0', 'fTSign',
  'CONFIG', 'STATE', 'esc', 'pctNote', 'secLabel', 'metricLabel',
  'custMetricCells', 'custSubtotal', 'buildCustTable', 'tableInnerHtml',
  'PV_MONTH_NAMES', 'monthTag_', 'slideTitle'];

const oldCtx = { console, document: { getElementById: () => null }, localStorage: { getItem: () => null } };
oldCtx.window = oldCtx;
vm.createContext(oldCtx);
vm.runInContext(grab(oldCode, NEEDED), oldCtx);

/* ---- the module ---- */
const modCtx = { console, document: { createElement: () => ({ style: {}, querySelectorAll: () => [] }) },
                 window: {}, localStorage: { getItem: () => null } };
modCtx.window = modCtx;
vm.createContext(modCtx);
vm.runInContext(scriptsOf(`${REPO}/Deck_PV.html`), modCtx);
const M = modCtx.AmrPvSlide;

/* ---- fixtures ---- */
const custRows = [
  { label: 'Amrize RMX', secondary: 'INTERNAL RMX', cyVol: 28680, pyVol: 29575, volPct: -0.03,
    cyAsp: 25.60, pyAsp: 24.04, aspPct: 0.065, cyFsc: 12333, ppi: 0.088, deltaApplied: 0.43 },
  { label: 'PRAIRIE PAVING (2006) INC', secondary: 'EXTERNAL ASPHALT', cyVol: 17353, pyVol: 11689,
    volPct: 0.485, cyAsp: 21.71, pyAsp: 25.38, aspPct: -0.145, cyFsc: 0, ppi: -0.016, deltaApplied: 0 },
];
const custData = { rows: custRows, total: { cyVol: 99001, pyVol: 141871, volPct: -0.302,
  cyAsp: 24.74, pyAsp: 23.39, aspPct: 0.058, cyFsc: 28426, ppi: 0.06, deltaApplied: 0.45 } };

const dimTable = { dimension: 'Market', volMix: -0.002, rows: [
  { label: 'Greater Toronto Area', cyVol: 1282643, pyVol: 1390172, volPct: -0.077, cyAsp: 15.10, pyAsp: 14.47, aspPct: 0.044, ppi: 0.026 },
  { label: 'Southwest', cyVol: 675623, pyVol: 692108, volPct: -0.024, cyAsp: 18.68, pyAsp: 18.32, aspPct: 0.019, ppi: 0.021 },
], total: { cyVol: 2266382, pyVol: 2444425, volPct: -0.073, cyAsp: 17.11, pyAsp: 16.64, aspPct: 0.028, ppi: 0.03 } };

const report = { period: 'MTD', filterValue: 'Central Canada', tables: [dimTable] };

const CTXOPTS = {
  slide: oldCtx.CONFIG.slide, month: 0, latestMonth: 7, period: 'MTD',
  custSecondary: 'CUST_SEGMENT', custSort: 'cyVol', custDir: 'top', custTopN: '10',
  custSearch: '', collapsed: {},
};

let checks = 0, fails = 0;
function cmp(name, before, after) {
  checks++;
  if (before === after) { console.log(`  ok    ${name}  (${String(before).length} chars)`); return; }
  fails++;
  console.log(`  FAIL  ${name}`);
  const a = String(before), b = String(after);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      console.log(`        first diff at ${i}`);
      console.log(`        before: ${JSON.stringify(a.slice(Math.max(0, i - 50), i + 70))}`);
      console.log(`        after : ${JSON.stringify(b.slice(Math.max(0, i - 50), i + 70))}`);
      break;
    }
  }
}

// tableInnerHtml — pure
cmp('tableInnerHtml (dimension table)', oldCtx.tableInnerHtml(dimTable), M.tableInnerHtml(dimTable));

// monthTag_ / slideTitle
Object.assign(oldCtx.STATE, { month: 0, latestMonth: 7 });
cmp('monthTag_', oldCtx.monthTag_(), M.monthTag(CTXOPTS));
cmp('slideTitle', oldCtx.slideTitle(report), M.slideTitle(report, CTXOPTS));

// buildCustTable across the view options that drive it
for (const sec of ['CUST_SEGMENT', 'PRODUCT_APP']) {
  for (const dir of ['top', 'bottom']) {
    for (const topN of ['10', 'ALL']) {
      Object.assign(oldCtx.STATE, { custSecondary: sec, custSort: 'cyVol', custDir: dir,
        custTopN: topN, custSearch: '', collapsed: {} });
      const ctx = Object.assign({}, CTXOPTS, { custSecondary: sec, custDir: dir, custTopN: topN });
      cmp(`buildCustTable sec=${sec} dir=${dir} top=${topN}`,
        oldCtx.buildCustTable(custData), M.custTableHtml(custData, ctx));
    }
  }
}

console.log(`\n${checks} comparisons, ${fails} failed.`);
console.log(fails ? 'LIFT IS NOT FAITHFUL.' : 'LIFT IS FAITHFUL on the non-chart paths.');
process.exit(fails ? 1 : 0);
