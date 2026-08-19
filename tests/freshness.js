/* The data version, which is now the source sheet's last-modified time.
 *
 * It used to be a counter something had to remember to bump. Anything that
 * changed the data without bumping it — somebody typing a row into REGION
 * LOOKUP, somebody fixing a number by hand — left every page serving figures
 * that no longer matched the sheet, with nothing anywhere to notice. And a
 * bump with no real change threw every cache away for nothing.
 *
 * Drive already tracks exactly what we mean, so:
 *
 *   IT MOVES WHEN THE DATA MOVES     whoever changed it, however
 *   IT DOES NOT MOVE OTHERWISE       an unchanged sheet keeps every cache
 *   IT IS CHEAP TO ASK               pages check it every few minutes
 *   PV AND RMX AGREE WITH IT         one answer, not three counters
 *
 *   node tests/freshness.js
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const { region, load: loadRegions } = require('./scriptgs.js');   // this file has its own load()
const REPO = path.resolve(__dirname, '..');
const APPHTML = require('./apphtml.js');
/* the legacy filenames these checks were written against, and the app.html page
   ids they became. Kept as a map so the check reads the same as it always did. */
const PAGE_ID = { Page_PriceVolume:'pricevolume', Page_Rmx:'rmx', Page_Segment:'segment',
                  Page_Overview:'overview', Page_FuelSurcharge:'fuelsurcharge',
                  Page_RmxFuel:'rmxfuel' };

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

function load() {
  const PROPS = {}, CACHE = {};
  const state = { mtime: {}, driveCalls: 0, missing: {} };

  const ctx = {
    JSON, Math, Object, Array, String, Number, RegExp, Error, Date, isNaN, parseInt, parseFloat,
    console: { log: () => {}, error: () => {}, warn: () => {} },
    Logger: { log: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in PROPS ? PROPS[k] : null),
        setProperty: (k, v) => { PROPS[k] = String(v); },
        deleteProperty: k => { delete PROPS[k]; },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (k in CACHE ? CACHE[k] : null),
        getAll: ks => { const o = {}; ks.forEach(k => { if (k in CACHE) o[k] = CACHE[k]; }); return o; },
        put: (k, v) => { CACHE[k] = v; },
        putAll: m => Object.keys(m).forEach(k => { CACHE[k] = m[k]; }),
        remove: k => { delete CACHE[k]; },
        removeAll: ks => ks.forEach(k => { delete CACHE[k]; }),
      }),
    },
    DriveApp: {
      getFileById: id => {
        state.driveCalls++;
        if (state.missing[id]) throw new Error('no access to ' + id);
        return { getLastUpdated: () => new Date(state.mtime[id] || 1000) };
      },
    },
    SpreadsheetApp: { openById: id => ({ getName: () => id, getUrl: () => 'u/' + id }) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 500, getContentText: () => '' }) },
    Utilities: { base64Encode: () => '', formatDate: d => String(d) },
    Session: { getScriptTimeZone: () => 'America/Toronto' },
    HtmlService: { createTemplateFromFile: () => ({}), createHtmlOutputFromFile: () => ({ getContent: () => '' }) },
    ScriptApp: { getService: () => ({ getUrl: () => '' }) },
    _state: state, _cache: CACHE,
  };
  ctx.global = ctx;
  vm.createContext(ctx);
  loadRegions(ctx, 'Config.gs', 'Code.gs');
  ctx.PV = { clearCache: () => {} };
  ctx.RMX_NS = { bumpGeneration: () => {} };

  const PV_ID  = ctx.APP_CONFIG.PAGES.pricevolume.defaultSpreadsheetId;
  const RMX_ID = ctx.APP_CONFIG.PAGES.rmx.defaultSpreadsheetId;
  state.mtime[PV_ID] = 1000; state.mtime[RMX_ID] = 2000;
  return { ctx, state, PV_ID, RMX_ID };
}

/* ======================================================================
 * 1. It tracks the sheet, not a counter
 * ==================================================================== */
console.log('the version follows the sheet:');
{
  const { ctx, state, PV_ID } = load();
  const a = ctx.APP_getGen_('pricevolume');
  checkThat('it carries the sheet\'s modified time', a.indexOf('1000') === 0, a);

  /* Same sheet, untouched: the version must not move, or every device rebuilds. */
  ctx.APP_forgetStamp_('pricevolume');
  check('an untouched sheet gives the same version', ctx.APP_getGen_('pricevolume'), a);

  /* Somebody edits REGION LOOKUP by hand — nothing calls anything. */
  state.mtime[PV_ID] = 5000;
  ctx.APP_forgetStamp_('pricevolume');
  checkThat('a hand edit moves it with nothing being told',
    ctx.APP_getGen_('pricevolume') !== a, ctx.APP_getGen_('pricevolume'));
}

console.log('\neach page follows its own sheet:');
{
  const { ctx, state, RMX_ID } = load();
  const pv = ctx.APP_getGen_('pricevolume'), rmx = ctx.APP_getGen_('rmx');
  checkThat('two workbooks, two versions', pv !== rmx, `${pv} / ${rmx}`);

  state.mtime[RMX_ID] = 9000;
  ctx.APP_forgetStamp_(null);
  check('touching Ready-Mix leaves Price & Volume alone', ctx.APP_getGen_('pricevolume'), pv);
  checkThat('and moves Ready-Mix', ctx.APP_getGen_('rmx') !== rmx);
}

console.log('\na page that reads another page\'s sheet follows that one:');
{
  const { ctx, state, PV_ID } = load();
  /* Fuel Recovery has readsFrom: 'pricevolume' and no workbook of its own. */
  check('it resolves to the owner\'s version',
    ctx.APP_getGen_('fuelsurcharge'), ctx.APP_getGen_('pricevolume'));

  state.mtime[PV_ID] = 7777;
  ctx.APP_forgetStamp_(null);
  check('and moves with it', ctx.APP_getGen_('fuelsurcharge'), ctx.APP_getGen_('pricevolume'));
}

console.log('\na page with no sheet of its own follows all of them:');
{
  const { ctx, state, PV_ID, RMX_ID } = load();
  /* The Overview reads Price & Volume, Ready-Mix and Segment. On its own id it
     resolves to no workbook at all — so without APP_EXTRA_SOURCES its version
     would be a constant, it would sit on stale figures forever, and Update
     from source would insist there was nothing to do. */
  const ov = ctx.APP_getGen_('overview');
  checkThat('it has a real version, not a constant', ov !== '0.' + ctx.APP_CODE_BUILD, ov);

  state.mtime[PV_ID] = 8888;
  ctx.APP_forgetStamp_(null);
  checkThat('Price & Volume moving moves it', ctx.APP_getGen_('overview') !== ov,
    ctx.APP_getGen_('overview'));

  const ov2 = ctx.APP_getGen_('overview');
  state.mtime[RMX_ID] = 9999;
  ctx.APP_forgetStamp_(null);
  checkThat('and so does Ready-Mix', ctx.APP_getGen_('overview') !== ov2,
    ctx.APP_getGen_('overview'));

  ctx.APP_forgetStamp_(null);
  check('an untouched set leaves it alone', ctx.APP_getGen_('overview'),
    ctx.APP_getGen_('overview'));

  /* And the button on that page must be able to act. */
  const have = ctx.APP_getGen_('overview');
  check('update from source sees no change when nothing moved',
    ctx.updateFromSource('overview', have).changed, false);
  state.mtime[RMX_ID] = 12345;
  check('and sees one when a source moves',
    ctx.updateFromSource('overview', have).changed, true);
}

console.log('\nthe Deck Builder is the same case, and has the same button:');
{
  const { ctx, state, PV_ID, RMX_ID } = load();
  /* It owns no workbook either — it photographs the other tools' blocks. On
     its own id it resolves to nothing, so its version would be a constant and
     ↻ Update from source would report "no change" however stale the deck was.
     That is the Overview's trap exactly; APP_EXTRA_SOURCES.deckbuilder is what
     keeps it out of it. */
  const db = ctx.APP_getGen_('deckbuilder');
  checkThat('it has a real version, not a constant',
    db !== '0.' + ctx.APP_CODE_BUILD, db);

  const have = ctx.APP_getGen_('deckbuilder');
  check('an untouched set means the button throws nothing away',
    ctx.updateFromSource('deckbuilder', have).changed, false);

  /* Every workbook behind a deck slide has to move it, or a Render after that
     sheet changed quietly reuses the figures already in the browser. */
  state.mtime[PV_ID] = 4242;
  ctx.APP_forgetStamp_(null);
  checkThat('Price & Volume moving moves it',
    ctx.APP_getGen_('deckbuilder') !== db, ctx.APP_getGen_('deckbuilder'));

  const db2 = ctx.APP_getGen_('deckbuilder');
  state.mtime[RMX_ID] = 4343;
  ctx.APP_forgetStamp_(null);
  checkThat('and so does Ready-Mix',
    ctx.APP_getGen_('deckbuilder') !== db2, ctx.APP_getGen_('deckbuilder'));
}

/* ======================================================================
 * 2. Asking is cheap — pages do it every few minutes
 * ==================================================================== */
console.log('\nasking repeatedly does not hammer Drive:');
{
  const { ctx, state } = load();
  ctx.APP_getGen_('pricevolume');
  const after1 = state.driveCalls;
  for (let i = 0; i < 20; i++) ctx.APP_getGen_('pricevolume');
  check('twenty more asks cost nothing', state.driveCalls, after1);

  ctx.APP_forgetStamp_('pricevolume');
  ctx.APP_getGen_('pricevolume');
  check('but forgetting it does read again', state.driveCalls, after1 + 1);
}

console.log('\na sheet it cannot reach does not take the page down:');
{
  const { ctx, PV_ID } = load();
  ctx._state.missing[PV_ID] = 1;
  ctx.APP_forgetStamp_(null);
  const g = ctx.APP_getGen_('pricevolume');
  checkThat('it still answers', typeof g === 'string' && g.length > 1, g);
  checkThat('with the build stamp, so a code fix still clears devices',
    g.indexOf('.') > 0, g);
}

/* ======================================================================
 * 3. ↻ Update from source
 * ==================================================================== */
console.log('\nupdate from source says so when there is nothing to do:');
{
  const { ctx, state, PV_ID } = load();
  const have = ctx.APP_getGen_('pricevolume');

  const same = ctx.updateFromSource('pricevolume', have);
  check('an unchanged sheet reports no change', same.changed, false);
  check('and hands back the same version', same.generation, have);

  state.mtime[PV_ID] = 4242;
  const moved = ctx.updateFromSource('pricevolume', have);
  check('a changed sheet reports a change', moved.changed, true);
  checkThat('with the new version', moved.generation !== have, moved.generation);

  /* A page that has no version yet (first ever load) must not be told
     "no change" — it has nothing to compare and needs the data. */
  check('no version to compare means treat it as changed',
    ctx.updateFromSource('pricevolume', '').changed, true);
}

console.log('\nit always reads Drive again rather than trusting the cached copy:');
{
  const { ctx, state, PV_ID } = load();
  ctx.APP_getGen_('pricevolume');
  const before = state.driveCalls;
  state.mtime[PV_ID] = 6000;                 /* changed a moment ago */
  const r = ctx.updateFromSource('pricevolume', '1000.x');
  check('Drive was asked', state.driveCalls, before + 1);
  check('so the change is seen straight away', r.changed, true);
}

/* ======================================================================
 * 4. The page backends agree with it
 * ==================================================================== */
console.log('\nPrice & Volume and Ready-Mix read the same stamp:');
{
  /* Each backend's own REGION of script.gs, not the whole file: these four checks
     are about PV and RMX agreeing with each other, and run against all eleven
     sections at once every one of them would pass as long as SOMETHING in the
     file matched — which is the opposite of what they are for. */
  const src = region('PV_Backend.gs');
  const rmx = region('RMX_Backend.gs');
  checkThat('PV takes its generation from the sheet',
    /APP_sourceStamp_\('pricevolume'\)/.test(src));
  checkThat('RMX takes its generation from the sheet',
    /APP_sourceStamp_\('rmx'\)/.test(rmx));
  checkThat('neither keeps a counter of its own',
    !/setProperty\('pv_cache_gen'/.test(src) && !/setProperty\('cache_gen'/.test(rmx),
    'a generation counter is back');
  checkThat('bumping just forgets the cached stamp',
    /APP_forgetStamp_\('pricevolume'\)/.test(src) && /APP_forgetStamp_\('rmx'\)/.test(rmx));
}

console.log('\nthe loading screen is full-screen, not a corner pill:');
{
  /* Shell.html and Styles.html were deleted at the cutover; these assertions are
     about the code they became, so they read app.html's §E and §A3 instead. */
  const shell = APPHTML.module('AmrProgress');
  const styles = APPHTML.styleBlock('A3');
  checkThat('AmrProgress builds the big one', /class = 'amr-load'|className = 'amr-load'/.test(shell));
  /* Every page with the button must ask before rebuilding for everyone. */
  ['Page_PriceVolume', 'Page_Rmx', 'Page_Segment', 'Page_Overview',
   'Page_FuelSurcharge', 'Page_RmxFuel'].forEach(function(f){
    /* the page is a region of app.html now, not a file */
    const src = APPHTML.pageOf(PAGE_ID[f]).tpl + APPHTML.pageOf(PAGE_ID[f]).js;
    if (!/id="syncBtn"/.test(src)) return;
    checkThat(f + ' asks before rebuilding', /AmrFresh\.ifChanged\(/.test(src),
      'the button rebuilds unconditionally');
  });
  checkThat('no pill is left in the shell', !/amr-pill/.test(shell), 'the pill is back');
  checkThat('and it covers the page', /\.amr-load\{position:fixed; inset:0/.test(styles));
  checkThat('the API pages already call is unchanged',
    /set: function\(key, o\)/.test(shell) && /done: function\(key/.test(shell) &&
    /fail: function\(key/.test(shell) && /clear: function\(key\)/.test(shell));
}

console.log(fails ? `\n${fails} failing check(s)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
