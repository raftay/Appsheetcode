#!/usr/bin/env node
/* =============================================================================
 * tests/reopen.js — opening a page a SECOND time
 * -----------------------------------------------------------------------------
 *   npm install playwright
 *   node tests/reopen.js
 *   CHROMIUM_PATH=/path/to/chrome node tests/reopen.js
 *
 * WHY THIS EXISTS
 *
 * Every check in `fuelcache.js` and `segboot.js` was passing while three pages
 * were, in the field, "loading again every time you open them". Both harnesses
 * were asking the right question of the wrong moment: fuelcache proves a repeat
 * visit does not RE-READ THE SHEET, and it does not — it just waited a full
 * round trip for permission to paint what it already had. segboot proves the
 * Ready-Mix pages open with ONE pull rather than twelve, and they do — the one
 * was RMX_prepare, the most expensive call in the suite, on every single open,
 * to be handed back what was already on the device. Neither harness could see
 * the cost, because in both cases the call really was doing its job.
 *
 * So this one measures the SECOND open, and it measures the two things that
 * actually decide whether a page feels loaded or loading:
 *
 *   1. WAS ANYTHING EXPENSIVE ASKED FOR AT ALL? A page whose device store can
 *      answer must not send the heavy call. Counted by name, not by total.
 *   2. DID THE PAGE PAINT BEFORE THE SERVER ANSWERED? This is the one a call
 *      count cannot see. The stub holds every reply for LATENCY ms and counts
 *      what is OUTSTANDING per call name, so "there is a table on screen while
 *      the version call has not come back yet" is a thing the harness can
 *      assert. Revert the fix and it fails: the table arrives after the reply.
 *
 * And one more, from the same family and the same root — a page that outlives
 * its own module state:
 *
 *   3. COMING BACK TO A CUBE PAGE MUST NOT STRAND ITS LOADING SCREEN. AmrCube
 *      is a §E singleton and §D mounts every page into ONE document, so the
 *      second visit's AmrCube.on() listener met a cube that had already
 *      finished and would never emit again. Price & Volume hangs AmrBoot's
 *      'month history' step on that event and AmrProgress's screen is modal, so
 *      the AGG page sat under a loading screen until the tab was reloaded.
 *      pageswitch.js could not catch it: its fixture answers CUBE_getManifest
 *      with ok:false, and the error path DOES emit.
 *
 * WHY IT DRIVES A BROWSER. localStorage, IndexedDB, a real boot, real timing.
 * jsdom would need all four stubbed, at which point the harness tests its stubs.
 *
 * MUTATION-TESTED TWO WAYS, and the point of recording it is that each mutation
 * failed only the checks it should:
 *   · AmrCache.warm() made a no-op — the store cannot be read before the server
 *     confirms, which is the shipped behaviour these three pages had — six
 *     failures, every one of them a cache check, cube checks untouched.
 *   · AmrCube.on() stripped of its replay — one failure, `cube-reopen`, naming
 *     the screen and the step, cache checks untouched.
 * ===========================================================================*/
'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const ROOT = path.join(__dirname, '..');
const URL_BASE = 'https://script.google.com/macros/s/TEST/exec';

/* Long enough that "painted before the reply" is unambiguous on a loaded
   machine, short enough that the whole run stays under a minute. */
const LATENCY = 800;

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  console.error('playwright is not installed where this script can see it.\n' +
    '  npm install playwright --prefix ' + ROOT);
  process.exit(2);
}
function browserPath() {
  const env = process.env.CHROMIUM_PATH;
  if (env && fs.existsSync(env)) return env;
  for (const dir of ['/opt/pw-browsers', '/root/.cache/ms-playwright']) {
    if (!fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir))
      for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
        const p = path.join(dir, d, sub);
        if (/^chromium-/.test(d) && fs.existsSync(p)) return p;
      }
  }
  return null;
}

let failures = 0;
const fail = (what, msg) => { failures++; console.log(`  ✗ ${what}: ${msg}`); };
const pass = (what, msg) => console.log(`  ✓ ${what}${msg ? ': ' + msg : ''}`);

const STUB = `<script>
(function(){
  var LATENCY = ${LATENCY};
  /* THE GENERATION HAS TO SURVIVE A RELOAD or the "version moved" check tests
     nothing: goto() builds a fresh document and a window property goes with the
     old one. localStorage does survive, and AmrCache only wipes its own
     amrCache: prefix. Same device, same trick, as fuelcache.js. */
  function gen(){ try { return localStorage.getItem('__testGen') || 'g1'; }
                  catch(e){ return 'g1'; } }

  window.__calls = [];        // every call name, in order
  window.__out   = {};        // how many of each are OUTSTANDING right now
  window.__count = function(name){
    return window.__calls.filter(function(c){ return c === name; }).length;
  };

  var ZERO = { cyVol:0, pyVol:0, cyRev:0, pyRev:0, revPct:0, volPct:0,
               aspCY:0, aspPY:0, aspPct:0, aspChg:0, cyShare:0, pyShare:0 };
  var MARKETS = ['HNS_SW','Innocon','North'];
  var MONTHS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  /* ---- Product Segment ------------------------------------------------- */
  /* month 7, deliberately NOT the 0 the picker opens on: the payloads are filed
     under the month the BACKEND resolves to, so a warm read that looked under
     m0 would miss forever while the store sat there full. */
  function slide(mk, per){
    return { ok:true, market:mk, period:per, markets:MARKETS, allMarkets:'__ALL__',
             segment:{ total:ZERO, rows:[{ label:'ICI', cyVol:33341, cyShare:.4,
               pyVol:21718, pyShare:.3, volPct:.54, aspCY:196.71, aspPY:190.97, aspPct:.03 }] },
             extras:{ extras:[], vap:[], byTypeExtras:[], byTypeVap:[], total:ZERO,
                      byTypeTotal:ZERO, byTypeExtrasTotal:ZERO, byTypeVapTotal:ZERO },
             rowCount:1, month:7, latestMonth:7, months:{all:[5,6,7],cy:[5,6,7]},
             cyYear:2026, pyYear:2025, build:'b1', generation:gen() };
  }
  function prepare(){
    var pl = {};
    ['MTD','YTD'].forEach(function(per){
      ['__ALL__'].concat(MARKETS).forEach(function(mk){ pl['slide|'+mk+'|'+per] = slide(mk, per); });
    });
    return { ok:true, warmed:1, want:'slide', markets:MARKETS, allMarkets:'__ALL__',
             breakdowns:[], month:7, latestMonth:7, months:{all:[5,6,7],cy:[5,6,7]},
             cyYear:2026, pyYear:2025, build:'b1', generation:gen(),
             payloads:pl, payload:pl['slide|__ALL__|MTD'] };
  }

  /* ---- the fuel pages -------------------------------------------------- */
  function fuel(month){
    var m = month || 7;
    return { ok:true, month:m, latestMonth:m, defaultMonth:7, months:[5,6,7],
             monthNames:MONTHS, markets:['Manitoba','Ontario'], rows:[], sections:[],
             byMonth:{}, exec:{ MTD:{all:[],applied:[]}, YTD:{all:[],applied:[]} },
             summary:{ MTD:[], YTD:[] } };
  }

  /* ---- Price & Volume ---------------------------------------------------
     The extras renderer and both waterfalls dereference these straight off the
     payload without checking, so a fixture without them throws on ".pyRev of
     undefined" — which reads as a page that is broken rather than a fixture
     that is thin. pageswitch.js carries the same envelope for the same reason.
     (No backticks in here: this whole stub is one template literal.) */
  function pv(){
    return { ok:true, rows:[], sections:[], months:{all:[7],cy:[7]}, month:7, latestMonth:7,
             markets:['HNS_SW'], allMarkets:'__ALL__', build:'b1', generation:gen(),
             breakdowns:[], keys:[], plants:[], ppi:{total:{w:1,f:0}},
             byTypeExtras:[], byTypeVap:[], extras:[], vap:[], blocks:[],
             total:ZERO, byTypeTotal:ZERO, byTypeExtrasTotal:ZERO, byTypeVapTotal:ZERO,
             revenueBridge:{ pyRev:0, cyRev:0, volImpact:0, priceImpact:0 },
             priceBridge:{ ppi:0, totalAsp:0, items:[] },
             segment:{ total:ZERO, rows:[] },
             cust:{ MTD:{rows:[],total:null}, YTD:{rows:[],total:null} },
             exec:{ MTD:{all:[],applied:[]}, YTD:{all:[],applied:[]} },
             summary:{ MTD:[], YTD:[] }, byMonth:{} };
  }

  function answer(name, args){
    var a = (args && args[0]) || {};
    if (name === 'getDataVersion')  return { generation:'v-' + (args && args[0]) + '-' + gen() };
    if (name === 'getKpiValues')    return { generation:gen(), cached:false, values:{ main:null, mbsk:null } };
    if (name === 'getGuideImages')  return [];
    if (name === 'getLogo')         return '';
    if (name === 'getSettingsFor' || name === 'getAllSettings') return [];
    if (name === 'RMX_getStamp')    return { ok:true, generation:gen(), build:'b1' };
    if (name === 'RMX_prepare')     return prepare();
    if (name === 'RMX_getSlideTables') return slide(a.market || '__ALL__', a.period || 'MTD');
    if (name === 'getFscData' || name === 'getRmxFuelData') return fuel(a.month);
    /* ok:true, with month blocks the cube can settle on — the ok:false answer
       is the one that hid the re-entry bug, because the error path emits. */
    if (name === 'CUBE_getManifest')
      return { ok:true, gen:gen(), lines:{ agg:{ chunks:[], dict:{}, unmapped:null, ym:[] },
                                           rmx:{ chunks:[], dict:{}, unmapped:null, ym:[] } } };
    return pv();
  }

  function runner(){
    var ok=null, bad=null;
    var proxy = new Proxy({}, { get:function(t,prop){
      if(prop==='withSuccessHandler') return function(f){ ok=f; return proxy; };
      if(prop==='withFailureHandler') return function(f){ bad=f; return proxy; };
      if(typeof prop!=='string') return undefined;
      return function(){
        var args=[].slice.call(arguments);
        window.__calls.push(prop);
        window.__out[prop] = (window.__out[prop] || 0) + 1;
        setTimeout(function(){
          window.__out[prop]--;
          try { ok && ok(answer(prop,args)); }
          /* a render throw is a bug, not a server failure — pageswitch.js's note */
          catch(e){ setTimeout(function(){ throw e; },0); bad && bad(e); }
        }, LATENCY);
      };
    }});
    return proxy;
  }
  window.google = { script:{ get run(){ return runner(); },
                             host:{ setHeight:function(){}, editor:{} } } };
  window.Chart = function(c,cfg){ this.config=cfg; this.data=cfg&&cfg.data;
    this.options=(cfg&&cfg.options)||{}; this.canvas=c; this.ctx=null;
    this.update=function(){}; this.destroy=function(){}; this.resize=function(){};
    this.render=function(){}; this.stop=function(){}; this.reset=function(){};
    this.toBase64Image=function(){return '';}; this.getDatasetMeta=function(){return {data:[]};}; };
  window.Chart.register=function(){};
  window.Chart.defaults={ font:{}, plugins:{legend:{},tooltip:{},title:{}}, scale:{},
                          scales:{}, animation:{}, animations:{}, elements:{},
                          datasets:{}, layout:{}, interaction:{}, transitions:{} };
  window.html2canvas=function(){ return Promise.resolve({ width:8,height:8,
    toDataURL:function(){ return 'data:image/png;base64,AA'; } }); };
  window.XLSX = { read:function(){ return { SheetNames:['S'], Sheets:{ S:{} } }; },
                  utils:{ sheet_to_json:function(){ return [['MARKET','VOL'],['Manitoba',1]]; } } };
  var create=document.createElement.bind(document);
  document.createElement=function(tag){
    var el=create(tag);
    if(String(tag).toLowerCase()==='script'){ var src='';
      Object.defineProperty(el,'src',{get:function(){return src;},
        set:function(v){src=v; setTimeout(function(){ el.onload&&el.onload(); },0);}}); }
    return el;
  };
})();
</script>`;

function pageHtml(startPage) {
  const raw = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8')
    .replace(/<\?!?=\s*(\w+)\s*\?>/g, (all, name) =>
      ({ page: startPage, appUrl: URL_BASE })[name] ?? '');
  const head = raw.indexOf('</head>');
  const tag = raw.slice(head).match(/<body[^>]*>/);
  const at = head + tag.index + tag[0].length;
  return raw.slice(0, at) + STUB + raw.slice(at);
}

/* Each page's three facts: what its EXPENSIVE call is named, what its cheap
   revalidation is named, and what on the page counts as "there is something to
   look at". The selector is deliberately the rendered payload and not a shell
   node — an empty page and a loaded one must not read the same, which is how
   pageparity's first run "passed". */
const PAGES = [
  { id: 'segment',       heavy: 'RMX_prepare',    light: 'RMX_getStamp',
    painted: '#previewHost table, #previewHost .seg-tbl' },
  { id: 'fuelsurcharge', heavy: 'getFscData',     light: 'getDataVersion',
    painted: '#tablesHost table' },
  { id: 'rmxfuel',       heavy: 'getRmxFuelData', light: 'getDataVersion',
    painted: '#tablesHost table' },
];

(async () => {
  const exe = browserPath();
  if (!exe) { console.error('no Chromium found (set CHROMIUM_PATH)'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: exe });

  for (const P of PAGES) {
    console.log(`\n  ${P.id}`);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pg  = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(e.message));

    const tmp = path.join(os.tmpdir(), 'amr_reopen_' + P.id + '.html');
    fs.writeFileSync(tmp, pageHtml(P.id));

    const open = async () => {
      await pg.goto('file://' + tmp, { waitUntil: 'load' });
      /* Long enough for the cold open's whole chain of replies to land. */
      await pg.waitForTimeout(LATENCY * 3 + 600);
    };
    const count = name => pg.evaluate(n => window.__count(n), name);

    /* ---------------------------------------------------------------- cold */
    await open();
    const cold = await count(P.heavy);
    const drew = await pg.$(P.painted);
    if (cold !== 1)
      fail('cold', `${P.id}: a first visit called ${P.heavy} ${cold} time(s), expected exactly 1`);
    else if (!drew)
      fail('cold', `${P.id}: a first visit rendered nothing — every reading below ` +
                   `would compare empty to empty and pass`);
    else pass('cold', `a first visit pulls once (${P.heavy}) and renders`);

    /* --------------------------------------------------------------- reopen
       THE TWO READINGS THAT MATTER, TAKEN AT THE SAME INSTANT: something is on
       screen, AND the revalidation call has not come back yet. Either alone is
       satisfied by the old behaviour — the page did eventually paint, and it
       did eventually stop calling — so both are asserted together. */
    await pg.goto('file://' + tmp, { waitUntil: 'load' });
    let early = true;
    try {
      await pg.waitForFunction(
        ([sel, light]) => !!document.querySelector(sel) && (window.__out[light] || 0) > 0,
        [P.painted, P.light], { timeout: LATENCY - 200, polling: 16 });
    } catch (e) { early = false; }
    await pg.waitForTimeout(LATENCY * 3 + 600);

    const warmHeavy = await count(P.heavy);
    const warmLight = await count(P.light);
    if (warmHeavy !== 0)
      fail('reopen', `${P.id}: a repeat visit still called ${P.heavy} ${warmHeavy} time(s). ` +
                     `The device already holds this answer — that call is the whole cost.`);
    else if (!early)
      fail('reopen', `${P.id}: a repeat visit asked nothing expensive, but nothing was on ` +
                     `screen while ${P.light} was still outstanding — so the page is still ` +
                     `waiting a round trip for permission to paint what it already has`);
    else if (warmLight < 1)
      fail('reopen', `${P.id}: a repeat visit painted from the device and never confirmed ` +
                     `the version with ${P.light}. A store nothing revalidates is a page ` +
                     `that cannot be told its numbers have been replaced.`);
    else pass('reopen', `paints from the device before ${P.light} answers, and no ${P.heavy}`);

    /* --------------------------------------------------- the version moved */
    await pg.evaluate(() => { try { localStorage.setItem('__testGen', 'g2'); } catch(e){} });
    await open();
    const moved = await count(P.heavy);
    if (moved < 1)
      fail('version-moved', `${P.id}: the data version moved and the page never re-read. ` +
                            `A warm paint is only honest if what is behind it is checked.`);
    else pass('version-moved', `a moved version re-reads (${moved} × ${P.heavy})`);

    /* ...and settles again, rather than re-reading for ever. */
    await open();
    const settled = await count(P.heavy);
    if (settled !== 0)
      fail('version-moved', `${P.id}: the open after the re-read called ${P.heavy} again. ` +
                            `The new payloads were not stored under the new version — that is ` +
                            `a cache that recomputes every time while every log line looks fine.`);
    else pass('version-moved', 'the open after it is warm again');

    if (errs.length) fail('pageerror', `${P.id}: ${errs.slice(0, 2).join(' | ').slice(0, 240)}`);
    else pass('pageerror', 'no uncaught errors');

    await ctx.close();
  }

  /* ======================================================================
     COMING BACK TO A CUBE PAGE
     ====================================================================== */
  console.log('\n  coming back');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pg  = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(e.message));
    const tmp = path.join(os.tmpdir(), 'amr_reopen_pv.html');
    fs.writeFileSync(tmp, pageHtml('pricevolume'));
    await pg.goto('file://' + tmp, { waitUntil: 'load' });
    await pg.waitForTimeout(LATENCY * 3 + 600);

    const first = await pg.evaluate(() => !!document.querySelector('#amrLoad.show'));
    if (first) fail('cube-first', 'Price & Volume never lifted its opening screen even once — ' +
                                  'nothing below distinguishes the re-entry bug from that');
    else pass('cube-first', 'the AGG page opens and its screen comes down');

    /* Away and back, twice. Once is the bug; twice is the listener leak. */
    for (const p of ['landing', 'pricevolume', 'landing', 'pricevolume']) {
      await pg.evaluate(x => window.AMR.nav.go(x), p);
      await pg.waitForTimeout(700);
    }
    await pg.waitForTimeout(LATENCY * 2);
    const stuck = await pg.evaluate(() => ({
      overlay: !!document.querySelector('#amrLoad.show'),
      text: (document.querySelector('#amrLoad .amr-load-text') || {}).textContent || '',
      note: (document.querySelector('#amrLoad .amr-load-sub')  || {}).textContent || '',
    }));
    if (stuck.overlay)
      fail('cube-reopen', `coming back to the AGG page left a loading screen up ` +
                          `("${stuck.text}" / "${stuck.note}"). AmrCube had already settled, so ` +
                          `the listener this visit registered was never told anything and the ` +
                          `step that lifts the screen was never answered.`);
    else pass('cube-reopen', 'coming back to the AGG page leaves no screen behind');

    /* The other half of the same root: the listeners themselves. Two visits
       must not leave two of this page's repaints wired to the cube. */
    const held = await pg.evaluate(() => {
      let n = 0;
      const seen = AmrCube.on(function(){ n++; });
      /* on() replays the settled event to exactly ONE new listener; anything
         else counting up here is a page that has gone. */
      return typeof seen === 'function';
    });
    if (!held) fail('cube-reopen', 'AmrCube.on() no longer returns an unsubscribe — teardown ' +
                                   'has nothing to call and every visit leaves its listener behind');
    else pass('cube-reopen', 'AmrCube.on() hands back an unsubscribe for teardown to use');

    if (errs.length) fail('pageerror', `pricevolume: ${errs.slice(0, 2).join(' | ').slice(0, 240)}`);
    else pass('pageerror', 'no uncaught errors');
    await ctx.close();
  }

  await browser.close();
  console.log(failures
    ? `\n${failures} failure(s)`
    : '\nreopen.js: the second open comes off the device, and comes back clean');
  process.exit(failures ? 1 : 0);
})();
