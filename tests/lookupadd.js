/* The Overview's "+ Add these rows", against the list it actually shows.
 *
 * Why it exists: the Ready-Mix mix section listed 1,116 mixes with no
 * PRODUCT MASTER row, and the form it opened said
 *
 *     Add 0 rows to the lookup      Nothing left to add here.
 *
 * The section and the form were reading two different lists. The section's
 * comes from the MONTH CUBE — the live report plus the closed-year books,
 * every one of them resolved against the LIVE PRODUCT MASTER — so a mix that
 * traded in a closed year and has since been dropped from the master is on it.
 * The form asked `getRmxSuggestions({})`, whose miss list is the LIVE report's
 * own, which cannot contain those mixes; and when the live report was clean it
 * contained nothing at all. The client then filtered that answer by the values
 * on screen, found no overlap, and fell back to offering the whole live list —
 * so the two ways this could go wrong were "nothing to add" and "rows you did
 * not ask about", and there was no third way for it to be right.
 *
 * The fix is that the caller's values ARE the question: `getSuggestions` takes
 * them, classifies them (sgProductRow_ parses text and reads no report), drops
 * the codes PRODUCT MASTER already carries and says how many those were.
 *
 * So this harness pins both halves:
 *   · the server answers the values it is handed, and does not read the report
 *   · the Overview hands over the values its own section is listing
 *
 *   node tests/lookupadd.js
 */
'use strict';
const vm = require('vm');
const { region, load: loadRegions } = require('./scriptgs.js');
const { pageOf } = require('./apphtml.js');

let fails = 0;
/* Every lookup below goes through this: a gate that throws on the first thing
   it disagrees with reports one line and hides the rest, which is exactly the
   run you get when it is doing its job. */
function pick(list, code) { return (list || []).filter(p => p.code === code)[0] || {}; }
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

/* ======================================================================
 * The three lookup tabs, shaped like the real ones.
 * ==================================================================== */
const PRODUCT_GRID = [
  ['Product Code', 'Old Description', 'New Description', 'Strength Class',
   'New Product Class', 'New Product Application'],
  ['RMXZ75NMS52', '', '75MPA@90D 20MM NA SF SP MANITOULIN ST.', '65+Mpa', 'Others', 'Others'],
  ['RMXP50NL15X', '', 'ST.PUMP 50 NA A23.1-04 HR', '45-64Mpa', 'Others', 'Others'],
];
const EXTRAS_GRID = [
  ['Material (mat_descr)', 'Catergory', 'mat_prod_hier_3'],   // the live tab's own spelling
  ['EXT001 - SATURDAY DELIVERY', 'Delivery', 'SERVICES'],
  ['EXT002 - WINTER HEATING', 'Heating', 'SERVICES'],
];
const FLAG_GRID = [
  ['mat_descr', 'Custom Flag'],
  ['RMXZ75NMS52 - 75MPA@90D 20MM NA SF SP MANITOULIN ST.', 'Standard'],
];

/* The four the Overview listed, taken off the reported screen. Two are new,
   one is already in PRODUCT MASTER above, and the fourth repeats the first
   one's CODE under a different description — which is one row in a tab keyed
   on the code, not two. */
const NEW_MIX_A = 'RMXUU32A7GF - HIGHWAY PAVING GUL 6-8%';
const NEW_MIX_B = 'RMXXQ04AZ01 - 0.55 W/C 28MPA 40MM HRWR NO SLAG';
const IN_MASTER = 'RMXP50NL15X - ST.PUMP 50 NA A23.1-04 HR';
const SAME_CODE = 'RMXUU32A7GF -  HIGHWAY PAVING GUL 6-8% REV B';
const SECTION   = [NEW_MIX_A, NEW_MIX_B, IN_MASTER, SAME_CODE];

/* ======================================================================
 * Fakes: enough Apps Script for RMX_Suggest, and a report that can be
 * asked whether it was read at all.
 * ==================================================================== */
function makeSheet(name, grid) {
  return {
    getName: () => name,
    getLastRow: () => grid.length,
    getLastColumn: () => Math.max(...grid.map(r => r.length)),
    getSheetId: () => 7,
    getParent: () => ({ getUrl: () => 'https://docs.google.com/spreadsheets/d/BOOK' }),
    getDataRange: () => ({ getValues: () => grid.map(r => r.slice()) }),
    getRange: () => ({ setValues: rows => rows.forEach(r => grid.push(r.slice())),
                       setNumberFormat: () => {} }),
  };
}

function load(report) {
  const CACHE = {};
  const sheets = [
    makeSheet('PRODUCT MASTER', PRODUCT_GRID.map(r => r.slice())),
    makeSheet('EXTRAS LOOKUP', EXTRAS_GRID.map(r => r.slice())),
    makeSheet('CUSTOM FLAG LOOKUP', FLAG_GRID.map(r => r.slice())),
  ];
  const book = {
    getSheets: () => sheets,
    getSheetByName: n => sheets.filter(s => s.getName() === n)[0] || null,
    getUrl: () => 'https://docs.google.com/spreadsheets/d/BOOK',
  };
  const reads = { unmapped: 0 };

  const ctx = {
    JSON, Math, Object, Array, String, Number, RegExp, Error, Date, isNaN, parseInt, parseFloat,
    console: { log: () => {}, error: () => {}, warn: () => {} },
    SpreadsheetApp: { openById: () => book, flush: () => {} },
    LockService: { getScriptLock: () => ({ waitLock: () => true, releaseLock: () => {} }) },
    APP_log: () => {},
    APP_getGen_: () => '1.build',
    APP_openSpreadsheet_: () => book,
    APP_cachePut_: (k, v) => { CACHE[k] = JSON.stringify(v); },
    APP_cacheGet_: k => (k in CACHE ? JSON.parse(CACHE[k]) : null),
    RMX_NS: {
      bumpGeneration: () => '2',
      getUnmapped: () => { reads.unmapped++; return report; },
    },
    _reads: reads,
  };
  ctx.global = ctx;
  vm.createContext(ctx);
  loadRegions(ctx, 'Config.gs');
  ctx.APP_openSpreadsheet_ = () => book;
  loadRegions(ctx, 'RMX_Suggest.gs');
  return ctx;
}

/* A live report with nothing wrong with it — the state the Overview's form
   was answered from, and the reason it came back empty. */
const CLEAN = { ok: true, product: [], extras: [], flag: [], total: 0 };

/* ======================================================================
 * 1. The failure, in the shape it was reported
 * ==================================================================== */
console.log('the mixes on screen get a proposed row each, even with a clean report:');
{
  const ctx = load(CLEAN);
  const r = ctx.getRmxSuggestions({ values: SECTION });

  check('it succeeds', r.ok, true);
  check('it does not come back empty', r.product.length > 0, true);
  check('one row per distinct new code, in the order asked',
    r.product.map(p => p.code), ['RMXUU32A7GF', 'RMXXQ04AZ01']);
  check('every value it was handed was looked at', r.asked, 4);
  check('and it never read the live report', ctx._reads.unmapped, 0);
}

/* ======================================================================
 * 2. What the proposal says
 * ==================================================================== */
console.log('\nthe proposal is parsed from the description, not guessed:');
{
  const ctx = load(CLEAN);
  const r = ctx.getRmxSuggestions({ values: SECTION });
  const b = pick(r.product, 'RMXXQ04AZ01');

  check('the strength comes off the MPa marker', b.strength, '26-30Mpa');
  check('no -TECT brand in the text is "Others"', b.cls, 'Others');
  check('an explicit MPa is a High-confidence row', b.band, 'High');
  check('the whole Product Mix value travels with it', b.value, NEW_MIX_B);

  const a = pick(r.product, 'RMXUU32A7GF');
  check('no MPa in the text leaves the strength alone', a.strength, 'Others');
  check('...and says so rather than pretending', a.band, 'Low');

  const opts = r.options || {};
  check('the tab’s own vocabulary comes back for the dropdowns',
    opts.strength, ['45-64Mpa', '65+Mpa']);
}

/* ======================================================================
 * 3. The two ways a list of values can lie
 * ==================================================================== */
console.log('\nit proposes nothing the tab already has, and says so:');
{
  const ctx = load(CLEAN);
  const r = ctx.getRmxSuggestions({ values: SECTION });

  check('the code already in PRODUCT MASTER is not offered',
    r.product.filter(p => p.code === 'RMXP50NL15X').length, 0);
  check('it is counted instead', r.already, 1);
  check('two descriptions sharing a code are ONE row',
    r.product.filter(p => p.code === 'RMXUU32A7GF').length, 1);
  check('and it is the first one asked for, not the last',
    pick(r.product, 'RMXUU32A7GF').value, NEW_MIX_A);
}
console.log('\na section whose codes are all in the tab already can say why:');
{
  const ctx = load(CLEAN);
  const r = ctx.getRmxSuggestions({ values: [IN_MASTER] });
  check('nothing is proposed', r.product.length, 0);
  check('and the count that explains it is there', r.already, 1);
}

/* ======================================================================
 * 4. The Ready-Mix page's own call is untouched
 * ==================================================================== */
console.log('\nwith no values it still answers all three tabs from the report:');
{
  const ctx = load({
    ok: true,
    product: [{ value: NEW_MIX_A, rows: 3, markets: ['GTA'] }],
    extras:  [{ value: 'EXT009 - SUNDAY DELIVERY', rows: 2, markets: ['GTA'], hier3: ['SERVICES'] }],
    flag:    [{ value: 'RMXQ1 - 30MPA NA 20MM', rows: 1, markets: ['North'] }],
    total: 3,
  });
  const r = ctx.getRmxSuggestions({});

  check('the report was read', ctx._reads.unmapped, 1);
  check('its product miss is proposed', r.product.map(p => p.code), ['RMXUU32A7GF']);
  check('its extras miss is classified', r.extras.length, 1);
  check('its flag miss is classified', r.flag.length, 1);
  check('the row count from the report travels with it', pick(r.product, 'RMXUU32A7GF').rows, 3);
  check('the total counts all three', r.total, 3);
}

/* ======================================================================
 * 5. The client half: the Overview hands over its OWN list
 * ==================================================================== */
console.log('\nthe Overview asks about the rows it is showing:');
{
  /* lkOpen, sliced out of the page by brace count rather than by any spelled
     out line ending — the one function that decides what gets asked. */
  const js = pageOf('overview').js;
  const at = js.indexOf('function lkOpen(');
  checkThat('lkOpen is still there to slice', at !== -1);
  let i = js.indexOf('{', at), depth = 0, end = -1;
  for (let p = i; p < js.length; p++) {
    if (js[p] === '{') depth++;
    else if (js[p] === '}') { depth--; if (!depth) { end = p + 1; break; } }
  }
  const src = js.slice(at, end);

  const batch = Number((js.match(/var LK_BATCH\s*=\s*(\d+)/) || [])[1]);
  checkThat('LK_BATCH is declared', batch > 0, String(batch));

  function run(values, answer) {
    const seen = { payload: null };
    let state = null;
    const runner = {
      withSuccessHandler(f) { runner._ok = f; return runner; },
      withFailureHandler(f) { runner._no = f; return runner; },
      getRmxSuggestions(p) { seen.payload = p; runner._ok(answer); },
      getPvLookupForm() { runner._ok({ ok: true, cols: [] }); },
    };
    const ctx = {
      JSON, Math, Object, Array, String, Number, Boolean,
      IS_LIVE: true, LK: {}, LK_BATCH: batch, DQX: {},
      lkSet: (id, patch) => { state = Object.assign(state || {}, patch); },
      lkClose: () => {},
      google: { script: { run: runner } },
    };
    vm.createContext(ctx);
    vm.runInContext(src + '\nlkOpen("rmx|mix","rmx|mix",VALUES);'
      .replace('VALUES', JSON.stringify(values)), ctx);
    return { payload: seen.payload, state: state };
  }

  const answer = { ok: true, already: 0, options: {},
                   product: [{ value: NEW_MIX_A, code: 'RMXUU32A7GF', newD: 'HIGHWAY PAVING GUL 6-8%',
                               strength: 'Others', cls: 'Others', app: 'Others' }] };
  const got = run(SECTION, answer);

  checkThat('the call carries values at all — the whole bug',
    !!(got.payload && got.payload.values), JSON.stringify(got.payload));
  check('and they are the section’s own values', (got.payload || {}).values, SECTION);
  check('the form is filled from the answer', ((got.state || {}).rows || []).map(r => r.key), [NEW_MIX_A]);
  check('nothing is skipped by default', (((got.state || {}).rows || [])[0] || {}).skip, false);

  /* 1,116 rows of five controls is not a form. The section is sorted by
     revenue, so a batch is the biggest ones and the rest wait their turn. */
  const many = Array.from({ length: 1116 }, (_, i) => 'RMXB' + i + ' - 30MPA NA 20MM');
  const big = run(many, { ok: true, already: 0, options: {}, product: [] });
  check('a long section is asked about one batch at a time',
    ((big.payload || {}).values || many).length, batch);
  check('the biggest by revenue go first', ((big.payload || {}).values || [])[0], many[0]);
  check('the form remembers how many there were', (big.state || {}).total, 1116);
  check('...and how many are still waiting', (big.state || {}).more, 1116 - batch);

  /* The empty case that used to be a dead end now says which empty it is. */
  const none = run([IN_MASTER], { ok: true, already: 1, options: {}, product: [] });
  checkThat('"nothing to add" explains itself when the tab is simply ahead',
    /already/i.test((none.state || {}).note || ''), JSON.stringify((none.state || {}).note));
}

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
