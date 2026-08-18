/* Phase 2 regression gate.
 *
 * The pass/fail test for the extraction is: the exec-table HTML the page
 * renders must be IDENTICAL before and after. So run the OLD page code and the
 * NEW shared module over the same model and diff the strings.
 *
 * Both pages, both periods, both bases, and with user overrides + a hidden
 * market applied — because those are the paths the shared ctx replaced, and a
 * silent regression there would only ever show up in someone's edited slide.
 */
const fs = require('fs');
const path = require('path');
const OLD = process.env.OLD_DIR || __dirname;
const REPO = path.resolve(__dirname, '..');

function slice(file, from, to) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  return lines.slice(from - 1, to).join('\n');
}
function scriptOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/<script>([\s\S]*?)<\/script>/g);
  return m.map(b => b.replace(/^<script>/, '').replace(/<\/script>$/, '')).join('\n');
}

/* ---- a model shaped like getFscData()/getRmxFuelData(), with real numbers
        off the July 2026 pack so the formatters are actually exercised ---- */
function model(cyYear) {
  const mk = (market, t26, t25, f26, f25) =>
    ({ market, tonnes26: t26, tonnes25: t25, fsc26: f26, fsc25: f25 });
  const all = [
    mk('GTA AGG', 1282643, 1390172, 314818, 0),
    mk('SW Ontario', 675623, 692108, 105512, 0),
    mk('Manitoba', 209115, 215405, 54055, 56064),
    mk('Saskatchewan', 99001, 141871, 28426, 0),
    mk('NORTH ON', 0, 4869, 0, 0),
    { market: 'Grand Total', isTotal: true },
  ];
  const applied = [
    mk('GTA AGG', 865515, 0, 314818, 0),
    mk('SW Ontario', 391703, 0, 105512, 0),
    mk('Manitoba', 150702, 152912, 54055, 56064),
    mk('Saskatchewan', 62867, 0, 28426, 0),
    mk('NORTH ON', 0, 0, 0, 0),
    { market: 'Grand Total', isTotal: true },
  ];
  const d = {
    markets: ['GTA AGG', 'SW Ontario', 'Manitoba', 'Saskatchewan', 'NORTH ON'],
    latestMonth: 'JUL',
    exec: { MTD: { all, applied }, YTD: { all, applied } },
    summary: { MTD: [], YTD: [] },
    byMonth: {},
  };
  if (cyYear) d.cyYear = cyYear;
  return d;
}

/* ---- the NEW shared module, loaded once ----
   §E of app.html, not Deck_Fuel.html: that file was deleted at the cutover and,
   more to the point, §E is the code that ships. tests/modparity.js is what makes
   the swap a non-event — it proves the two were byte-identical. */
const modSrc = require('./apphtml.js').module('AmrFuelExec');
const modCtx = { window: {}, document: undefined, console };
modCtx.global = modCtx;
require('vm').createContext(modCtx);
require('vm').runInContext(modSrc, modCtx);
const AmrFuelExec = modCtx.AmrFuelExec;

/* ---- run the OLD page code in its own sandbox ---- */
function oldRunner(oldFile, from, to) {
  const code = slice(oldFile, from, to);
  const ctx = { console, document: { getElementById: () => null } };
  ctx.window = ctx;
  require('vm').createContext(ctx);
  require('vm').runInContext(code, ctx);
  return ctx;
}

const CASES = [
  {
    name: 'AGG Fuel Recovery',
    old: [path.join(OLD, 'old_fsc.html'), 178, 455],
    units: 'agg',
    data: model(null),          // AGG model has no cyYear -> module must fall back to 2026
  },
  {
    name: 'RMX Fuel Recovery',
    old: [path.join(OLD, 'old_rfsc.html'), 188, 471],
    units: 'rmx',
    data: model(2026),
  },
];

/* ctx variants: clean (what the deck sends), and edited (what a user's page
   looks like) — overrides on raw inputs, a renamed label, a hidden market. */
const VARIANTS = {
  clean: () => ({ numOv: {}, txtOv: {}, hidden: {} }),
  edited: () => ({
    numOv: { 'EXEC|MTD|all|Manitoba|t26': 222222,
             'EXEC|YTD|applied|GTA AGG|f26': 999999 },
    txtOv: { 'EXEC|MTD|all|GTA AGG|mkt': 'Greater Toronto' },
    hidden: { 'NORTH ON': true },
  }),
};

let checks = 0, fails = 0;

for (const c of CASES) {
  const page = oldRunner(...c.old);
  for (const [vname, mkv] of Object.entries(VARIANTS)) {
    for (const period of ['', 'MTD', 'YTD']) {
      const v = mkv();

      // OLD: page globals + its own compute pass
      page.DATA = c.data;
      page.NUM_OV = JSON.parse(JSON.stringify(v.numOv));
      page.TXT_OV = JSON.parse(JSON.stringify(v.txtOv));
      page.STATE.hidden = JSON.parse(JSON.stringify(v.hidden));
      page.DERIVED = {};
      ['MTD', 'YTD'].forEach(p => {
        page.computeExec(p, 'all'); page.computeExec(p, 'applied');
      });
      const before = page.buildExecTables(period);

      // NEW: shared module, same inputs through ctx
      const ctx = { numOv: v.numOv, txtOv: v.txtOv, hidden: v.hidden, derived: {} };
      ['MTD', 'YTD'].forEach(p => {
        AmrFuelExec.computeExec(c.data, p, 'all', ctx, ctx.derived);
        AmrFuelExec.computeExec(c.data, p, 'applied', ctx, ctx.derived);
      });
      const after = AmrFuelExec.execTables(c.data, period, ctx, c.units);

      checks++;
      const label = `${c.name} · ${vname} · period='${period || 'both'}'`;
      if (before === after) {
        console.log(`  ok    ${label}  (${before.length} chars)`);
      } else {
        fails++;
        console.log(`  FAIL  ${label}`);
        for (let i = 0; i < Math.max(before.length, after.length); i++) {
          if (before[i] !== after[i]) {
            console.log(`        first diff at ${i}`);
            console.log(`        before: ${JSON.stringify(before.slice(i - 60, i + 60))}`);
            console.log(`        after : ${JSON.stringify(after.slice(i - 60, i + 60))}`);
            break;
          }
        }
      }
    }
  }
}

console.log(`\n${checks} comparisons, ${fails} failed.`);
console.log(fails ? 'REGRESSION — the extraction changed the output.'
                  : 'IDENTICAL — extraction is behaviour-preserving.');
process.exit(fails ? 1 : 0);
