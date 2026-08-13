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

let calls = [];
win.google = {
  script: {
    run: (function () {
      const api = {};
      let ok = null, fail = null;
      api.withSuccessHandler = f => (ok = f, api);
      api.withFailureHandler = f => (fail = f, api);
      api.getFscData = (...a) => { calls.push(['getFscData', a]); setTimeout(() => ok(MODEL), 0); };
      api.getRmxFuelData = (...a) => { calls.push(['getRmxFuelData', a]); setTimeout(() => ok(MODEL), 0); };
      return api;
    })(),
  },
};

vm.createContext(win);
vm.runInContext(scriptOf('Deck_Sources.html'), win);
vm.runInContext(scriptOf('Deck_Fuel.html'), win);

const R = win.AmrDeckSource;
console.log('registered sources:', R.list().join(', '));
console.log('missingFor([fsc,rfsc,pv]):',
  R.missingFor([{ source: 'fsc' }, { source: 'rfsc' }, { source: 'pv' }]).join(', ') || '(none)');

const specs = [
  { id: 'fsc_mtd', source: 'fsc', period: 'MTD', layout: 'L_FULL_IMAGE' },
  { id: 'fsc_ytd', source: 'fsc', period: 'YTD', layout: 'L_FULL_IMAGE' },
  { id: 'rfsc_mtd', source: 'rfsc', period: 'MTD', layout: 'L_FULL_IMAGE' },
  { id: 'rfsc_ytd', source: 'rfsc', period: 'YTD', layout: 'L_FULL_IMAGE' },
];

let bad = 0;
(async () => {
  for (const s of specs) {
    try {
      const el = await R.build(s);
      const editable = el.querySelectorAll('[contenteditable]').length;
      const tables = el.querySelectorAll('table.fsc-t.exec').length;
      const periods = [...el.querySelectorAll('.fsc-period')].map(n => n.textContent.trim());
      const okAll = tables === 2 && editable === 0 && periods.length === 1;
      if (!okAll) bad++;
      console.log(`  ${okAll ? 'ok  ' : 'FAIL'} ${s.id.padEnd(9)} tables=${tables} ` +
        `contenteditable=${editable} period="${periods.join('|')}"`);
    } catch (e) {
      bad++;
      console.log(`  FAIL ${s.id} -> ${e.message}`);
    }
  }

  // an unregistered source must fail with a sentence, not a stack trace
  try {
    await R.build({ id: 'pv_gta_mtd', source: 'pv' });
    console.log('  FAIL unregistered source resolved (should reject)'); bad++;
  } catch (e) {
    console.log(`  ok   unregistered source rejects: "${e.message.slice(0, 62)}…"`);
  }

  // each backend must be hit ONCE even though two slides use it
  const counts = calls.reduce((o, [f]) => (o[f] = (o[f] || 0) + 1, o), {});
  const cached = counts.getFscData === 1 && counts.getRmxFuelData === 1;
  if (!cached) bad++;
  console.log(`  ${cached ? 'ok  ' : 'FAIL'} backend calls: ${JSON.stringify(counts)} (want 1 each)`);
  console.log(`       args: ${JSON.stringify(calls.map(c => c[1]))}`);

  console.log(bad ? `\n${bad} FAILURE(S).` : '\nDECK PATH OK.');
  process.exit(bad ? 1 : 0);
})();
