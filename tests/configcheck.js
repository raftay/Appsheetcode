/* app.gs §1's sheet-resolution rules, run for real.  (Was Config.gs.)
 *
 * These are pure functions over APP_CONFIG plus a Script Properties lookup, so
 * they exercise without Google. The case that matters is a page with
 * `readsFrom` and a STALE override left from when it owned a workbook — Fuel
 * Recovery, which is exactly how "reading No longer needed FSC" survived a move
 * to the Price & Volume sheet.
 *
 * The other harnesses cover the deck; nothing else covers this, and it is the
 * kind of rule that looks obviously right and silently stops being true.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const { load: loadRegions } = require('./appgs.js');
const REPO = path.resolve(__dirname, '..');

const ctx = { Logger: { log: () => {} } };
ctx.global = ctx;

let PROPS = {};
ctx.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: k => (k in PROPS ? PROPS[k] : null),
    setProperty: (k, v) => { PROPS[k] = String(v); },
    deleteProperty: k => { delete PROPS[k]; },
  }),
};
ctx.SpreadsheetApp = {
  openById: id => ({ getName: () => 'BOOK<' + id + '>', getUrl: () => 'https://x/' + id }),
};
ctx.syncAll = () => {};

vm.createContext(ctx);
loadRegions(ctx, 'Config.gs');

const PV_ID = ctx.APP_CONFIG.PAGES.pricevolume.defaultSpreadsheetId;
const PREFIX = ctx.APP_CONFIG.PROP_PREFIX;
const DEAD = PREFIX + 'fuelsurcharge';
const LIVE = PREFIX + 'pricevolume';

let fails = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) console.log(`         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`);
}

console.log('a page with readsFrom owns no sheet of its own:');
check('fuelsurcharge is owned by pricevolume', ctx.APP_sheetOwner_('fuelsurcharge'), 'pricevolume');
check('a page that owns its sheet is its own owner', ctx.APP_sheetOwner_('pricevolume'), 'pricevolume');
check('every property key routes to the owner', ctx.APP_propKey_('fuelsurcharge'), LIVE);

console.log('\na retired workbook cannot come back through a stale property:');
PROPS = {}; PROPS[DEAD] = 'OLD_DEAD_FSC_BOOK';
check('fuelsurcharge still resolves to the Price & Volume sheet',
  ctx.getSpreadsheetIdForPage_('fuelsurcharge'), PV_ID);
check('...and the badge reflects the owner, not the orphan',
  ctx.spreadsheetSourceForPage_('fuelsurcharge'), 'code');

console.log('\nan override on the OWNING page still wins:');
PROPS[LIVE] = 'LIVE_PV_BOOK';
check('fuelsurcharge follows it', ctx.getSpreadsheetIdForPage_('fuelsurcharge'), 'LIVE_PV_BOOK');
check('badge says override', ctx.spreadsheetSourceForPage_('fuelsurcharge'), 'override');

console.log('\nthe Settings panel does not offer a sheet the page does not own:');
const panel = ctx.getSettingsFor('fuelsurcharge').map(s => s.page);
check('fuelsurcharge absent from its own panel', panel.indexOf('fuelsurcharge'), -1);
check('the sheets it actually reads are listed', panel, ['pricevolume', 'saskrates']);
check('nothing listed twice', panel.length, new Set(panel).size);

console.log('\nsaving through a readsFrom page addresses the OWNER, not a dead key:');
PROPS = {};
ctx.saveSpreadsheetId('https://docs.google.com/spreadsheets/d/NEWBOOK/edit', 'fuelsurcharge');
check('the owner property was written', PROPS[LIVE], 'NEWBOOK');
check('no orphan key was created', DEAD in PROPS, false);

console.log('\nthe retired-override cleanup removes exactly the dead key:');
PROPS = {}; PROPS[DEAD] = 'OLD_DEAD_FSC_BOOK'; PROPS[LIVE] = 'LIVE_PV_BOOK';
check('reports the dead key', ctx.clearRetiredOverrides().cleared, [DEAD]);
check('dead key gone', DEAD in PROPS, false);
check('live key untouched', PROPS[LIVE], 'LIVE_PV_BOOK');

console.log('\nconfig integrity:');
const dangling = Object.keys(ctx.APP_CONFIG.PAGES).filter(p => {
  const r = ctx.APP_CONFIG.PAGES[p].readsFrom;
  return r && !ctx.APP_CONFIG.PAGES[String(r).toLowerCase()];
});
check('no readsFrom points at a page that does not exist', dangling, []);
// a readsFrom cycle would hang the resolver without the seen-guard
check('every page resolves to an owner without looping',
  Object.keys(ctx.APP_CONFIG.PAGES).every(p => !!ctx.APP_sheetOwner_(p)), true);

console.log(`\n${fails ? fails + ' FAILURE(S).' : 'CONFIG RULES OK.'}`);
process.exit(fails ? 1 : 0);
