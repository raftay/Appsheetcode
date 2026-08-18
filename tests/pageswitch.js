#!/usr/bin/env node
/* =============================================================================
 * tests/pageswitch.js — switching pages without a reload leaves nothing behind
 * -----------------------------------------------------------------------------
 *   npm install playwright
 *   node tests/pageswitch.js
 *   CHROMIUM_PATH=/path/to/chrome node tests/pageswitch.js
 *
 * WHY THIS EXISTS
 * Chunk 14 made the nav mount a page instead of reloading. The browser already
 * has every page, so the round trip was pure cost — but a reload used to be the
 * teardown, and taking it away means the previous page has to be taken apart by
 * hand. Emptying #appRoot does not do that:
 *
 *   · eleven listeners across the ten page registrations sit on document or
 *     window, and nothing removed them. rmx → segment → rmx would bind
 *     Ready-Mix's keydown twice and run it against a detached DOM.
 *   · AmrQlikGuide appends its aside and FAB to <body>, OUTSIDE #appRoot, which
 *     is exactly why emptying it misses them. So do the progress screen, the
 *     lightbox and the off-screen slide box.
 *   · AmrFresh polls every five minutes for the page it was started on.
 *
 * None of that shows up on the first switch. It shows up on the fifth, as a
 * page that has grown slow or a handler firing for a screen the user left —
 * which is the worst shape of bug to find in production and the easiest to
 * catch here. So the harness switches through every page TWICE and asserts the
 * document comes back to the same shape each time.
 *
 * IT ALSO CHECKS THE ONE INVARIANT THE WHOLE FILE RESTS ON: exactly one page in
 * the document. Pages share ids on purpose — the two fuel pages are the same
 * screen on different numbers — and that only holds while one is mounted.
 * ===========================================================================*/
'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const ROOT = path.join(__dirname, '..');
const URL_BASE = 'https://script.google.com/macros/s/TEST/exec';

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

/* The stub answers every server call with something shaped right enough to let
   boot() finish. What is under test is the SWITCH, not the data — but a page
   that dies in boot tears down cleanly by accident, so each one is checked to
   have actually mounted before it counts. */
const STUB = `<script>
(function(){
  var ZERO = { cyVol:0, pyVol:0, cyRev:0, pyRev:0, revPct:0, volPct:0,
               aspCY:0, aspPY:0, aspPct:0, aspChg:0, cyShare:0, pyShare:0 };
  var EMPTY = { ok:true, rows:[], sections:[], months:{all:[7],cy:[7]}, month:7, latestMonth:7,
                markets:['HNS_SW'], allMarkets:'__ALL__', build:'b1', generation:'g1',
                breakdowns:[], keys:[], plants:[], ppi:{total:{w:1,f:0}},
                byTypeExtras:[], byTypeVap:[], extras:[], vap:[], blocks:[],
                /* the totals the extras renderer dereferences without checking —
                   without them Price & Volume throws on .pyRev of undefined, which
                   is a fixture gap and not a switching bug, but it makes every
                   pageerror after it unreadable */
                total:ZERO, byTypeTotal:ZERO, byTypeExtrasTotal:ZERO, byTypeVapTotal:ZERO,
                /* the two waterfall inputs AmrPvSlide.renderCharts dereferences
                   straight off the payload — the real server always sends them */
                revenueBridge:{ pyRev:0, cyRev:0, volImpact:0, priceImpact:0 },
                priceBridge:{ ppi:0, totalAsp:0, items:[] },
                segment:{ total:ZERO, rows:[] }, cust:{ MTD:{rows:[],total:null}, YTD:{rows:[],total:null} },
                exec:{MTD:{all:[],applied:[]},YTD:{all:[],applied:[]}}, summary:{MTD:[],YTD:[]}, byMonth:{} };
  function answer(name){
    if (name === 'getDataVersion')  return { generation:'g1' };
    if (name === 'getKpiValues')    return { generation:'g1', cached:false, values:{ main:null, mbsk:null } };
    if (name === 'getGuideImages')  return [];
    if (name === 'getLogo')         return '';
    if (name === 'getSettingsFor' || name === 'getAllSettings') return [];
    if (name === 'DECK_readTemplate') return { layouts:[], slots:{} };
    if (name === 'DECK_getRecipe')  return { ok:true, rows:[] };
    if (name === 'IR_getSettings')  return { configured:false };
    if (name === 'TP_getRecipients') return { ok:true, rows:[] };
    if (name === 'CUBE_getManifest') return { ok:false, blocks:[] };
    return EMPTY;
  }
  window.__calls = [];
  function runner(){
    var ok=null, bad=null;
    var proxy = new Proxy({}, { get:function(t,prop){
      if(prop==='withSuccessHandler') return function(f){ ok=f; return proxy; };
      if(prop==='withFailureHandler') return function(f){ bad=f; return proxy; };
      if(typeof prop!=='string') return undefined;
      return function(){
        window.__calls.push(prop);
        setTimeout(function(){ try { ok && ok(answer(prop)); } catch(e){ bad && bad(e); } }, 0);
      };
    }});
    return proxy;
  }
  window.google = { script: { get run(){ return runner(); },
                              host:{ setHeight:function(){}, editor:{} } } };
  /* A Chart instance the page can poke at. options matters: the PNG export
     saves and restores ch.options.animation around a capture, and a stub
     without it throws there rather than anywhere near the switch. */
  window.Chart = function(c,cfg){ this.config=cfg; this.data=cfg&&cfg.data;
    this.options=(cfg&&cfg.options)||{}; this.canvas=c; this.ctx=null;
    this.update=function(){}; this.destroy=function(){}; this.resize=function(){};
    this.render=function(){}; this.stop=function(){}; this.reset=function(){};
    this.toBase64Image=function(){return '';}; this.getDatasetMeta=function(){return {data:[]};}; };
  window.Chart.register=function(){};
  /* Page code writes into these before constructing anything; a bare object
     throws on the first defaults.animation.duration = 0. */
  window.Chart.defaults={ font:{}, plugins:{legend:{},tooltip:{},title:{}}, scale:{},
                          scales:{}, animation:{}, animations:{}, elements:{},
                          datasets:{}, layout:{}, interaction:{}, transitions:{} };
  window.html2canvas=function(){ return Promise.resolve({ width:8,height:8,
    toDataURL:function(){ return 'data:image/png;base64,AA'; } }); };
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
  /* after </head>: app.html describes a <body …> tag in a head comment, so the
     first match in the file is prose. bgrender.js has the same note. */
  const head = raw.indexOf('</head>');
  const tag = raw.slice(head).match(/<body[^>]*>/);
  const at = head + tag.index + tag[0].length;
  return raw.slice(0, at) + STUB + raw.slice(at);
}

const ORDER = ['overview', 'pricevolume', 'rmx', 'segment', 'fuelsurcharge',
               'rmxfuel', 'tp01', 'inventoryreport', 'deckbuilder', 'landing'];

/* What the document looks like right now, as numbers a leak would move. */
const SNAPSHOT = () => ({
  page:       document.body.getAttribute('data-page'),
  appPage:    window.APP_PAGE,
  rootKids:   document.getElementById('appRoot').children.length,
  bodyKids:   document.body.children.length,
  bodyIds:    [].map.call(document.body.children, e => e.id || e.tagName).sort().join(','),
  guides:     document.querySelectorAll('#qlikGuide, .qgFab, .qgLightbox').length,
  templates:  document.querySelectorAll('template').length,
  openModals: document.querySelectorAll('.amr-open').length,
  /* THE ONE A DOM DIFF CANNOT SEE. Eleven stacked keydown handlers look exactly
     like one from the outside, so the runtime reports what it is holding. */
  held:       window.AMR.nav.held(),
  /* the invariant the whole single-file design rests on */
  dupIds:     (function(){
    const seen = {}, dup = [];
    [].forEach.call(document.querySelectorAll('[id]'), function(el){
      if (el.closest('template')) return;
      if (seen[el.id]) dup.push(el.id); else seen[el.id] = 1;
    });
    return dup.join(',');
  })(),
});

(async () => {
  const exe = browserPath();
  if (!exe) { console.error('no Chromium found (set CHROMIUM_PATH)'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: exe });
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  /* THE MEASUREMENT THAT COUNTS. AMR.nav.held() reports what the runtime
     RECORDED, which is exactly the wrong thing to gate on: a teardown that
     forgets to call removeEventListener but still empties its own array reports
     zero either way. So ask Chromium what is actually attached, through CDP.
     Mutation-tested against precisely that mistake. */
  const cdp = await pg.context().newCDPSession(pg);
  await cdp.send('DOM.enable'); await cdp.send('Runtime.enable');
  async function realListeners() {
    let total = 0;
    for (const expr of ['document', 'window']) {
      const { result } = await cdp.send('Runtime.evaluate', { expression: expr });
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners',
                                           { objectId: result.objectId });
      total += listeners.length;
    }
    return total;
  }
  /* Attribute an error to the page that was mounted when it happened; "one of
     twenty-one switches threw" is not a report anybody can act on. */
  let current = 'landing';
  const errs = [];
  pg.on('pageerror', e => errs.push(current + ': ' + e.message));

  const tmp = path.join(os.tmpdir(), 'amr_pageswitch.html');
  fs.writeFileSync(tmp, pageHtml('landing'));
  await pg.goto('file://' + tmp, { waitUntil: 'load' });
  await pg.waitForTimeout(400);

  const base = await pg.evaluate(SNAPSHOT);
  if (base.page !== 'landing' || !base.rootKids) {
    fail('setup', 'the landing page never mounted — nothing below means anything');
    console.log(`\n${failures} failure(s)`); process.exit(1);
  }
  pass('setup', `landing mounted, ${base.bodyKids} body children is the baseline`);

  /* Two full laps. One would not find a leak that needs a repeat visit, which
     is the whole class of bug this exists for. */
  const seen = [];
  for (let lap = 1; lap <= 2; lap++) {
    for (const id of ORDER) {
      current = id;
      const ok = await pg.evaluate(p => window.AMR.nav.go(p), id);
      await pg.waitForTimeout(260);
      const s = await pg.evaluate(SNAPSHOT);
      s.real = await realListeners();
      seen.push({ lap, id, ok, s });

      if (!ok) { fail('switch', `lap ${lap}: AMR.nav.go('${id}') refused`); continue; }
      if (s.page !== id)    fail('switch', `lap ${lap}: body[data-page] is "${s.page}" after going to ${id}`);
      if (s.appPage !== id) fail('switch', `lap ${lap}: window.APP_PAGE is "${s.appPage}" after going to ${id}`);
      if (!s.rootKids)      fail('switch', `lap ${lap}: ${id} mounted nothing into #appRoot`);
      if (s.dupIds)         fail('one-page', `lap ${lap}: ${id} — id declared twice in the live document: ${s.dupIds}`);
      if (s.templates !== base.templates)
        fail('templates', `lap ${lap}: ${id} — ${s.templates} templates, expected ${base.templates}`);
    }
  }

  /* THE LEAK CHECK. Lap 2 must look exactly like lap 1, page for page. A
     listener that stacks, an aside that is never removed, a modal left open —
     all of them show up as lap 2 differing from lap 1 for the same page. */
  let leaks = 0;
  for (const id of ORDER) {
    const a = seen.find(x => x.lap === 1 && x.id === id);
    const b = seen.find(x => x.lap === 2 && x.id === id);
    if (!a || !b) continue;
    for (const k of ['bodyKids', 'bodyIds', 'guides', 'openModals']) {
      if (String(a.s[k]) !== String(b.s[k])) {
        leaks++;
        fail('no-leak', `${id}: ${k} was ${JSON.stringify(a.s[k])} on the first visit and ` +
                        `${JSON.stringify(b.s[k])} on the second — the previous page left something behind`);
      }
    }
  }
  /* Listener and timer counts, compared the same way. Kept separate because the
     message has to name the number, not the JSON. */
  for (const id of ORDER) {
    const a = seen.find(x => x.lap === 1 && x.id === id);
    const b = seen.find(x => x.lap === 2 && x.id === id);
    if (!a || !b) continue;
    for (const k of ['listeners', 'intervals']) {
      if (a.s.held[k] !== b.s.held[k]) {
        leaks++;
        fail('no-leak', `${id}: the runtime holds ${b.s.held[k]} ${k} on the second visit ` +
                        `and held ${a.s.held[k]} on the first — teardown is not removing them`);
      }
    }
    if (a.s.real !== b.s.real) {
      leaks++;
      fail('no-leak', `${id}: document+window carry ${b.s.real} listeners on the second visit ` +
                      `and carried ${a.s.real} on the first — ${b.s.real - a.s.real} were added ` +
                      `and never removed. This is Chromium's count, not the runtime's.`);
    }
  }
  if (!leaks) {
    const worst = seen.reduce((m, x) => Math.max(m, x.s.real), 0);
    pass('no-leak', `every page looks the same on its second visit as its first ` +
                    `(peak ${worst} real listeners on document+window, returned each time)`);
  }

  /* Back where we started. Compared against the FIRST landing visit rather than
     the pre-switch snapshot: #amrLoad is a module singleton built lazily on the
     first page that shows a loading screen, and it is meant to survive — the
     baseline predates it existing. Comparing landing to landing keeps the check
     about what a round trip through nine pages left behind. */
  await pg.evaluate(() => window.AMR.nav.go('rmx'));
  await pg.waitForTimeout(200);
  await pg.evaluate(() => window.AMR.nav.go('landing'));
  await pg.waitForTimeout(300);
  const end = await pg.evaluate(SNAPSHOT);
  const firstLanding = seen.find(x => x.lap === 1 && x.id === 'landing').s;
  if (end.bodyIds !== firstLanding.bodyIds) {
    fail('back-to-base', `body children are [${end.bodyIds}], ` +
                         `first visit to landing had [${firstLanding.bodyIds}]`);
  } else {
    pass('back-to-base', 'a round trip through every page leaves the shell as it found it');
  }

  /* An unregistered page must not silently do nothing. */
  const refused = await pg.evaluate(() => window.AMR.nav.go('nosuchpage'));
  if (refused !== false) fail('fallback', 'go() to an unknown page did not refuse');
  else pass('fallback', 'an unknown page falls back to a full navigation');

  if (errs.length) {
    /* Page code writes to the console on purpose; only real throws land here. */
    errs.slice(0, 4).forEach(m => fail('pageerror', m.slice(0, 160)));
  } else pass('pageerror', 'no uncaught errors across 21 switches');

  await browser.close();
  console.log(failures ? `\n${failures} failure(s)`
                       : '\npageswitch.js: switching leaves nothing behind');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
