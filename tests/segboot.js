/* tests/segboot.js — the Ready-Mix pages' BOOT, in a real browser
 *
 *   npm install playwright
 *   node tests/segboot.js                 # checks
 *   node tests/segboot.js /tmp/shots      # …and a screenshot per page
 *   CHROMIUM_PATH=/path/to/chrome node tests/segboot.js
 *
 * WHY THIS EXISTS
 * Both Ready-Mix pages used to open by asking the server for one market at a
 * time, and every one of those calls began by pulling the whole 14 MB data
 * bundle back out of CacheService (tests/rmxcost.js has the sizes). On top of
 * that each page ran a background loop over every market × period, so opening
 * the page fired a dozen of those reads, serially, in front of anything the user
 * did next — and the loading screen went up and down once per call, which is
 * what the flicker was.
 *
 * RMX_prepare replaced all of it with one call. That is a boot-sequence change,
 * and a boot sequence is exactly the thing unit checks cannot see: the failure
 * modes are "the page fetches the same market twice", "the loading screen never
 * comes down", "switching market goes back to the server anyway". So this boots
 * the REAL page files with google.script.run stubbed, counts the calls, and
 * reads the progress overlay.
 *
 * It is not a data test — the payloads are synthetic. It is a wiring test.
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const SHOTS = process.argv[2] || '';

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  console.error('playwright is not installed where this script can see it.\n' +
    '  npm install playwright --prefix ' + REPO);
  process.exit(2);
}
function browserPath() {
  const env = process.env.CHROMIUM_PATH;
  if (env && fs.existsSync(env)) return env;
  for (const dir of ['/opt/pw-browsers', '/root/.cache/ms-playwright']) {
    if (!fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir)) {
      for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
        const p = path.join(dir, d, sub);
        if (/^chromium-/.test(d) && fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

/* app.html off disk, the deleted legacy files out of git — see apphtml.js. */
const read = require('./apphtml.js').source;
/* resolve <?!= include('X') ?> the way Apps Script does, then drop the rest */
function expand(src, depth) {
  return src.replace(/<\?!?=\s*include\('([^']+)'\)\s*\?>/g,
      (m, name) => (depth > 3 ? '' : expand(read(name + '.html'), (depth || 0) + 1)))
    .replace(/<\?[=!]?[\s\S]*?\?>/g, '');
}

const MARKETS = ['HNS_SW', 'Innocon', 'Manitoba', 'North', 'Saskatchewan'];

/* One synthetic payload per shape, plus the manifest prepare returns. */
const SEG_ROWS = [
  { label:'ICI',             cyVol:33341, cyShare:.40, pyVol:21718, pyShare:.30, volPct:.54,  aspCY:196.71, aspPY:190.97, aspPct:.030 },
  { label:'Res - High Rise', cyVol:22940, cyShare:.28, pyVol:30004, pyShare:.41, volPct:-.24, aspCY:256.25, aspPY:259.21, aspPct:-.011 },
  { label:'Civil',           cyVol:13989, cyShare:.17, pyVol:8356,  pyShare:.11, volPct:.67,  aspCY:312.62, aspPY:261.51, aspPct:.195 }
];
const STUB = `
<script>
window.__CALLS = [];
window.google = { script: { run: (function(){
  function slide(o){
    return { ok:true, market:o.market, period:o.period, month:7, latestMonth:7,
      months:{ all:[1,2,3,4,5,6,7], cy:[1,2,3,4,5,6,7] },
      markets:${JSON.stringify(MARKETS)}, allMarkets:'__ALL__',
      build:'b1', generation:'g1',
      segment:{ total:{ cyVol:83324, pyVol:73398, volPct:.14, aspCY:229.07, aspPY:222.43, aspPct:.03 },
                rows:${JSON.stringify(SEG_ROWS)} },
      extras:{ byTypeExtras:[{ label:'Cooling', cyRev:2195484, pyRev:1415233, revPct:.55, aspCY:26.35, aspPY:19.28, aspChg:7.07 }],
               byTypeExtrasTotal:{ cyRev:2195484, pyRev:1415233, revPct:.55, aspCY:26.35, aspPY:19.28, aspChg:7.07 },
               byTypeVap:[{ label:'Other VAP', cyRev:547078, pyRev:341295, revPct:.60, aspCY:6.57, aspPY:4.65, aspChg:1.92 }],
               byTypeVapTotal:{ cyRev:547078, pyRev:341295, revPct:.60, aspCY:6.57, aspPY:4.65, aspChg:1.92 },
               byTypeTotal:{ cyRev:2742562, pyRev:1756528, revPct:.56, aspCY:32.92, aspPY:23.93, aspChg:8.99 },
               extras:[], vap:[] },
      rowCount:1000 };
  }
  function keys(o){
    return { ok:true, market:o.market || 'Innocon', period:o.period || 'YTD',
      month:7, latestMonth:7, months:{ all:[1,2,3,4,5,6,7], cy:[1,2,3,4,5,6,7] },
      markets:${JSON.stringify(MARKETS)}, allMarkets:'__ALL__',
      build:'b1', generation:'g1',
      breakdowns:[{key:'SUBMARKET',label:'Submarket'},{key:'STRENGTH',label:'Strength Class'},
                  {key:'PLANT',label:'Top 10 Plants'},{key:'PROD_CLASS',label:'Product Class'}],
      keys:[{ dims:{submarket:'SM1',segment:'ICI',app:'Slab',cls:'Standard',strength:'25 MPa'},
              pyVol:1000, cyVol:1200, baseCY:240000, basePY:190000 }],
      ppi:{ total:{w:1,f:0.02}, SUBMARKET:{SM1:{w:1,f:0.02}}, STRENGTH:{'25 MPa':{w:1,f:0.02}},
            PROD_CLASS:{Standard:{w:1,f:0.02}}, PLANT:{P100:{w:1,f:0.02}} },
      plants:[{ label:'P100', pyVol:1000, cyVol:1200, baseCY:240000, basePY:190000 }] };
  }
  function make(h){
    function reply(name, fn){
      return function(o){ window.__CALLS.push([name, o]);
        var r = fn(o || {}); setTimeout(function(){ h.s && h.s(r); }, 0); };
    }
    return {
      withSuccessHandler:function(f){ return make({s:f, f:h.f}); },
      withFailureHandler:function(f){ return make({s:h.s, f:f}); },
      RMX_prepare: reply('RMX_prepare', function(o){
        var man = { ok:true, warmed:26, want:o.want, markets:${JSON.stringify(MARKETS)},
          allMarkets:'__ALL__', month:7, latestMonth:7,
          months:{ all:[1,2,3,4,5,6,7], cy:[1,2,3,4,5,6,7] },
          breakdowns:keys({}).breakdowns, build:'b1', generation:'g1', ms:9000 };
        /* every market x period, the way the real prepare answers - this is what
           makes a market switch cost no call at all */
        var kind = (o.want === 'slide') ? 'slide' : 'keys';
        var mk = ['__ALL__'].concat(${JSON.stringify(MARKETS)});
        man.payloads = {};
        ['MTD','YTD'].forEach(function(per){
          mk.forEach(function(m){
            var spec = { market:m, period:per };
            man.payloads[kind+'|'+m+'|'+per] = (kind === 'slide') ? slide(spec) : keys(spec);
          });
        });
        man.payload = man.payloads[kind+'|'+(o.market||'__ALL__')+'|'+(o.period||'MTD')] || null;
        return man; }),
      RMX_getSlideTables: reply('RMX_getSlideTables', slide),
      RMX_getKeys:        reply('RMX_getKeys', keys),
      RMX_getExtras:      reply('RMX_getExtras', function(o){
        return { ok:true, market:o.market, period:o.period, byTypeExtras:[], byTypeVap:[],
                 extras:[], vap:[], generation:'g1' }; }),
      RMX_getMarkets:     reply('RMX_getMarkets', function(){ return keys({}); }),
      RMX_getUnmapped:    reply('RMX_getUnmapped', function(){
        return { ok:true, product:[], extras:[], flag:[], total:0, generation:'g1' }; }),
      RMX_syncData:       reply('RMX_syncData', function(){ return { ok:true, generation:'g1' }; }),
      getLogo:            reply('getLogo', function(){ return ''; }),
      getGuideImages:     reply('getGuideImages', function(){ return []; }),
      getDataVersions:    reply('getDataVersions', function(){ return {}; }),
      getKpiValues:       reply('getKpiValues', function(){ return { generation:'k1', values:{ok:1} }; })
    };
  }
  return make({});
})() } };
/* the EBITDA workbook, without the Drive round trip */
document.addEventListener('DOMContentLoaded', function(){
  if(!window.AmrKpi) return;
  AmrKpi.load = function(cb){ cb && cb({ok:1}); };
  AmrKpi.files = function(){ return { main:{name:'EBITDA.xlsx', ts:1}, mbsk:null }; };
  AmrKpi.rmx = function(vals, mkt){
    if(!vals || mkt === '__ALL__') return null;
    return { tab:'RMX Summary', units:{ cy:83.12, py:71.88 },
             rev:{ cy:18972, py:15989, cyU:228.26, pyU:222.44 },
             conc:{ cy:18972, py:15985, cyU:228.26, pyU:222.40 },
             raw:{ cy:12278, py:9934, cyU:147.72, pyU:138.21 } };
  };
  AmrKpi.rmxHeaders = function(){ return ['Innocon  RMX']; };
});
</script>`;

function pageHtml(file) {
  return expand(read(file), 0).replace('<body>', '<body>' + STUB);
}

const CASES = [
  { file:'Page_Segment.html', want:'slide', select:'#marketSel', to:'Innocon',
    tables:'#tablesHost table.gt' },
  { file:'Page_Rmx.html',     want:'keys',  select:'#market',    to:'Innocon',
    tables:'#tablesHost table.rtbl' }
];

(async () => {
  const exe = browserPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  let bad = 0;
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  for (const c of CASES) {
    const pg = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const errs = [];
    pg.on('pageerror', e => errs.push(e.message));
    const tmp = path.join(require('os').tmpdir(), 'amr_' + c.file);
    fs.writeFileSync(tmp, pageHtml(c.file));
    await pg.goto('file://' + tmp, { waitUntil: 'load' });
    await pg.evaluate(() => document.fonts.ready);
    await pg.waitForTimeout(700);

    const boot = await pg.evaluate(() => ({
      calls: window.__CALLS.map(c => c[0]),
      overlay: !!document.querySelector('.amr-load.show'),
      jobs: document.querySelectorAll('.amr-load-jobs li').length,
      text: (document.querySelector('.amr-load-text') || {}).textContent || '',
      bootOver: !!(window.AmrBoot && window.AmrBoot.finished()),
      waiting: (window.AmrBoot && window.AmrBoot.waiting()) || []
    }));
    const fail = [];
    const n = f => boot.calls.filter(x => x === f).length;

    if (n('RMX_prepare') !== 1) fail.push('expected exactly 1 RMX_prepare, got ' + n('RMX_prepare'));
    if (n('RMX_getMarkets')) fail.push('still calls RMX_getMarkets (an 18-second call to fill a dropdown)');
    /* the payload prepare already returned must be USED, not re-fetched */
    const perMarket = n('RMX_getSlideTables') + n('RMX_getKeys');
    if (perMarket) fail.push('re-fetched the opening market ' + perMarket +
      'x — prepare already handed that payload back');
    if (boot.overlay) fail.push('the loading screen is still up after the tables rendered');
    if (!boot.bootOver) fail.push('AmrBoot never finished — still waiting for ' +
      JSON.stringify(boot.waiting) + ' (a step is missing its done())');
    if (boot.jobs) fail.push(boot.jobs + ' other progress job(s) stacked underneath — that is the flicker');

    /* switching market: prepare warmed it server-side, so ONE small call, and
       switching back is free */
    await pg.selectOption(c.select, c.to);
    await pg.waitForTimeout(700);
    const afterSwitch = await pg.evaluate(() => window.__CALLS.map(c => c[0]));
    const switchCalls = afterSwitch.length - boot.calls.length;
    /* THE POINT OF RETURNING EVERY MARKET. Aggregates' opening call carries all
       of them, so switching is instant; warming only the server cache still left
       a round trip per market. Zero is the requirement, not "few". */
    if (switchCalls !== 0) fail.push('a market switch cost ' + switchCalls +
      ' server call(s) — prepare already handed that market back, so it should '
      + 'be a memory hit');

    const tables = await pg.evaluate(s => document.querySelectorAll(s).length, c.tables);
    if (!tables) fail.push('no tables rendered');

    if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, c.file + '.png'), fullPage: false });
    if (errs.length) fail.push('page errors: ' + errs.join(' | '));

    console.log((fail.length ? 'FAIL ' : 'ok   ') + c.file.padEnd(20) +
      ' boot=[' + boot.calls.join(',') + '] switch=+' + switchCalls +
      ' tables=' + tables + ' overlay=' + boot.overlay);
    if (fail.length) { bad++; console.log('       ' + fail.join('\n       ')); }
    await pg.close();
  }

  /* ---- AmrBoot / AmrProgress on their own ------------------------------
     The two bugs this found are both in the SHELL, not the pages, and both
     showed as "a loading screen over a finished page":
       - the grace gate returned early without hiding an overlay that was
         already up, so the previous job's wording sat there;
       - clear() stopped repainting once nothing was left, so the last job
         never took its own screen down.
     Neither is visible from a page test that happens to end in a good state,
     so they get their own checks. */
  {
    const pg = await browser.newPage();
    await pg.goto('file://' + path.join(require('os').tmpdir(), 'amr_Page_Segment.html'),
      { waitUntil: 'load' });
    await pg.waitForTimeout(700);
    const shown = () => pg.evaluate(() => !!document.querySelector('.amr-load.show'));
    const t = [];
    const ck = (label, got, want) => { t.push([label, got === want, got]); };

    /* boot is over by now, and the screen is down */
    ck('boot finished after load', await pg.evaluate(() => AmrBoot.finished()), true);
    ck('no screen once boot is done', await shown(), false);

    /* a job that resolves inside the grace period never paints at all */
    await pg.evaluate(() => { AmrProgress.grace(400); AmrProgress.set('q', { text:'quick' }); });
    ck('a quick job paints nothing', await shown(), false);
    await pg.evaluate(() => AmrProgress.clear('q'));
    await pg.waitForTimeout(600);
    ck('...and never appears afterwards', await shown(), false);

    /* one that outlives it does paint, and hides again when cleared */
    await pg.evaluate(() => AmrProgress.set('slow', { text:'slow' }));
    await pg.waitForTimeout(600);
    ck('a slow job does paint', await shown(), true);
    await pg.evaluate(() => AmrProgress.clear('slow'));
    ck('and hides the moment it is cleared', await shown(), false);

    /* a failure is never delayed */
    await pg.evaluate(() => AmrProgress.fail('bad', 'nope'));
    ck('a failure paints immediately', await shown(), true);
    await pg.evaluate(() => AmrProgress.clear('bad'));

    /* boot cannot be re-raised once it is over */
    await pg.evaluate(() => AmrBoot.need('late'));
    ck('AmrBoot.need after boot is ignored', await shown(), false);

    const failed = t.filter(x => !x[1]);
    console.log((failed.length ? 'FAIL ' : 'ok   ') + 'loading screen'.padEnd(20) +
      ' ' + t.length + ' checks');
    failed.forEach(x => console.log('       ' + x[0] + ' -> ' + JSON.stringify(x[2])));
    if (failed.length) bad++;
    await pg.close();
  }

  await browser.close();
  console.log(bad ? '\n' + bad + ' page(s) FAILED' : '\nBOOT OK — one pull, one screen, no re-fetch.');
  process.exit(bad ? 1 : 0);
})();
