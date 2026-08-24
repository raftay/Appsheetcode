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
  /* WHAT IS STILL PENDING. AmrFresh reschedules its five-minute poll with
     setTimeout, not setInterval, so "did the poll die with the page" is not a
     question the runtime's own bookkeeping can answer — and waiting five
     minutes is not an option. Tracking live timers by delay makes it one. */
  var realST = window.setTimeout, realCT = window.clearTimeout;
  window.__timers = {};
  window.setTimeout = function(fn, ms){
    var id = realST(function(){ delete window.__timers[id];
                                fn && fn.apply(this, arguments); }, ms);
    window.__timers[id] = ms || 0;
    return id;
  };
  window.clearTimeout = function(id){ delete window.__timers[id]; return realCT(id); };
  window.__longTimers = function(min){
    var out = []; for (var k in window.__timers) if (window.__timers[k] >= min) out.push(window.__timers[k]);
    return out;
  };
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
  function answer(name, args){
    /* PER PAGE, because APP_getGen_ is: a source stamp for THAT page plus the
       code build. A fixture that answers the same version for every page cannot
       fail when a watch started on one page keeps asking on another — which is
       precisely the bug this harness now gates. */
    if (name === 'getDataVersion')  return { generation:'gen-' + ((args && args[0]) || '?') };
    if (name === 'getKpiValues')    return { generation:'g1', cached:false, values:{ main:null, mbsk:null } };
    if (name === 'getGuideImages')  return [];
    if (name === 'getLogo')         return '';
    if (name === 'getSettingsFor' || name === 'getAllSettings') return [];
    if (name === 'DECK_readTemplate') return { layouts:[], slots:{} };
    /* The Arrange stage reads all five of these off one answer. An empty
       recipe is still a real one — the page has to mount and leave the stage
       disabled rather than throw on a missing key, which is precisely what a
       switch-away-and-back would turn into a page that never comes up. */
    if (name === 'DECK_getRecipe')  return { ok:true, rows:[], problems:[],
      overrides:{}, overrideCount:0, plan:{ v:1, order:[], off:[], on:[],
      drop:[], rows:{}, add:[] }, tables:{ v:1, scopes:{} }, naturalOrder:[],
      deleted:[], markets:[], planned:false, scopeCount:0 };
    if (name === 'DECK_setPlan')     return { plan:{ v:1, order:[], off:[], on:[],
      drop:[], rows:{}, add:[] } };
    if (name === 'DECK_resetPlan')   return { plan:{ v:1, order:[], off:[], on:[],
      drop:[], rows:{}, add:[] } };
    if (name === 'DECK_setTables')   return { scope:'', entry:null, map:{ v:1, scopes:{} } };
    if (name === 'DECK_resetTables') return { map:{ v:1, scopes:{} } };
    if (name === 'IR_getSettings')  return { configured:false };
    if (name === 'TP_getRecipients') return { ok:true, rows:[] };
    if (name === 'CUBE_getManifest') return { ok:false, blocks:[] };
    /* THE FUEL PAGES TAKE months AS AN ARRAY, and PV takes it as
       { all, cy }. One envelope for every call cannot tell which question was
       asked — the same lesson ovperiod.js learned in chunk 8 — and here it hid
       a real throw: buildMonthPicker() does list.forEach, the stub handed it an
       object, and the stub's own catch turned the crash into a quiet call to
       the page's failure handler. It looked like a page that had failed to
       load, which on a fixture is exactly what you expect to see. */
    /* THE OVERVIEW READS STATE.data.pv / .rmx / .seg AS MAPS and indexes them
       without checking. EMPTY has none of those keys, so every market lookup
       was "cannot read properties of undefined" — and the stub's own catch
       turned that into a quiet failure-handler call too. Empty maps are a
       legitimate answer (a period with no markets) and are enough to boot;
       ovperiod.js is where the Overview's real model lives. */
    if (name === 'getOverview')
      return Object.assign({}, EMPTY, { pv:{}, rmx:{}, seg:{}, aggAll:null,
              bridges:{}, errors:[], unmatched:[], markets:[] });
    if (/^get(Fsc|RmxFuel)Data/.test(name))
      return Object.assign({}, EMPTY, { months:[1,2,7], monthNames:['Jan','Feb','Mar','Apr','May',
              'Jun','Jul','Aug','Sep','Oct','Nov','Dec'], defaultMonth:7 });
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
        var args = [].slice.call(arguments);
        window.__calls.push(prop);
        setTimeout(function(){
          try { ok && ok(answer(prop, args)); }
          catch(e){
            /* A RENDER THAT THROWS IS A BUG, NOT A SERVER FAILURE. Calling the
               page's failure handler and saying nothing else is how this stub
               hid a fixture mismatch on both fuel pages: the page looked like
               it had merely failed to load. Surface it as a real page error
               too, so the pageerror check below can see it. */
            setTimeout(function(){ throw e; }, 0);
            bad && bad(e);
          }
        }, 0);
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
  /* The loading screen is deliberately NOT removed on a switch (§D's
     KEEP_ON_SWITCH), so whether it is SHOWING is the only thing that says
     the job behind it went with its page. */
  overlay:    !!document.querySelector('#amrLoad.show'),
  /* Anything still scheduled far enough out to be a poll rather than a beat. */
  longTimers: window.__longTimers(60000).length,
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
  async function countOn(expr) {
    const { result } = await cdp.send('Runtime.evaluate', { expression: expr });
    if (!result.objectId) return 0;
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners',
                                         { objectId: result.objectId });
    return listeners.length;
  }
  async function realListeners() {
    let total = 0;
    for (const expr of ['document', 'window']) total += await countOn(expr);
    return total;
  }
  /* DOCUMENT AND WINDOW ARE NOT THE WHOLE SURFACE, and believing they were hid
     a leak for a whole chunk. The shared modal shells sit on <body>, OUTSIDE
     #appRoot — that is the entire reason they survive a page swap — so a
     per-mount addEventListener on one of them is neither recorded by §D's
     capture (it wraps document and window only) nor removed by teardown. It
     stacked one duplicate handler on #amrSetList per switch, and six identical
     handlers means one click on Save sends six writes. */
  async function shellListeners() {
    const n = await pg.evaluate(() => document.body.children.length);
    const parts = [];
    for (let i = 0; i < n; i++) {
      const c = await countOn(`document.body.children[${i}]`);
      if (!c) continue;
      const name = await pg.evaluate(
        j => { const e = document.body.children[j]; return e.id || e.tagName.toLowerCase(); }, i);
      parts.push(`${name}=${c}`);
    }
    /* Named, not totalled. "23 where there were 13" sends you looking;
       "appRoot=12 where it was 2" is the bug. */
    return parts.join(' ');
  }
  /* Attribute an error to the page that was mounted when it happened; "one of
     twenty-one switches threw" is not a report anybody can act on. */
  let current = 'landing';
  const errs = [];
  /* THE STACK, NOT JUST THE MESSAGE. "Cannot read properties of null (reading
     'style')" names neither the page that threw nor the line, and this check
     has produced exactly that twice — under a full-suite run, where the machine
     is loaded and the timing moves — and then refused to reproduce in twenty
     runs on its own. A message with no stack is a report nobody can act on. */
  pg.on('pageerror', e => errs.push(current + ': ' + e.message + '\n        ' +
    String(e.stack || '').split('\n').slice(1, 6).join('\n        ')));

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
      s.real  = await realListeners();
      s.shell = await shellListeners();
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
    /* `overlay` is deliberately NOT compared lap to lap: whether a boot screen
       happens to be painted when the snapshot is taken is a race with the grace
       period, not a leak. The stranded-overlay probe below is the gate for it. */
    for (const k of ['bodyKids', 'bodyIds', 'guides', 'openModals', 'longTimers']) {
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
    if (a.s.shell !== b.s.shell) {
      leaks++;
      fail('no-leak', `${id}: <body>-level nodes hold [${b.s.shell}] on the second visit and ` +
                      `held [${a.s.shell}] on the first. These outlive the mount — #appRoot ` +
                      `keeps its own listeners when innerHTML is replaced, and the shared modal ` +
                      `shells are outside it entirely — so anything bound to one per mount ` +
                      `stacks unless §D's capture records that target.`);
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

  /* ---------------------------------------------------------------- the poll
     AmrFresh watches whether the data behind THIS page has moved. It
     reschedules with setTimeout, so §D's setInterval hook never saw it, and
     leaving it running is not a stray timer — it is a wrong answer. `mine` is
     the version of the page that started the watch; page() reads
     window.APP_PAGE, which the switch has already moved; APP_getGen_ is per
     page. So the next poll compares two different pages' versions, never
     matches, and greys out a page that is perfectly current — then show()
     clears the timer, so freshness checking is dead for the rest of the
     session. AmrFresh.stop(), called from teardown, is the fix. */
  const polls = await pg.evaluate(() => window.__longTimers(60000));
  if (polls.length) {
    fail('stale-poll', `${polls.length} timer(s) of 60s or more are still pending ` +
      `(${polls.join(', ')}ms) after switching away from the page that started them. A watch ` +
      `that outlives its page asks for the NEW page's data version and compares it with the ` +
      `OLD page's — they are per page, so it never matches and the "out of date" grey-out ` +
      `covers a page that is fine.`);
  } else pass('stale-poll', 'no five-minute watch outlives the page that started it');

  /* ----------------------------------------------------------- the overlay
     #amrLoad is deliberately kept across a switch (§D's KEEP_ON_SWITCH): the
     module caches `mounted` and `host`, so detaching it leaves the flag true
     and the screen unable to appear again. But keeping the node while keeping
     the JOBS strands it — the callback that would have cleared the job belongs
     to the page that has gone and the stale guard drops it by design, so the
     new page sits under the old page's loading screen until a full reload.
     Raised here on purpose: switching while something is loading is exactly
     when a real user clicks away. */
  await pg.evaluate(() => window.AmrProgress.set('pageswitch-probe',
                          { text: 'Loading the sheet\u2026', now: true }));
  await pg.waitForTimeout(120);
  const overlayUp = await pg.evaluate(() => !!document.querySelector('#amrLoad.show'));
  await pg.evaluate(() => window.AMR.nav.go('segment'));
  await pg.waitForTimeout(300);
  const overlayStuck = await pg.evaluate(() => !!document.querySelector('#amrLoad.show'));
  if (!overlayUp) {
    fail('stranded-overlay', 'the probe never raised the loading screen, so the check below ' +
                             'proves nothing — fix the probe rather than trusting the pass');
  } else if (overlayStuck) {
    fail('stranded-overlay', 'the loading screen raised by the previous page is still covering ' +
      'the new one. AmrProgress keeps the job, its clearing callback was dropped with the page ' +
      'that registered it, and nothing else removes it: the app is under a dead overlay until a ' +
      'full reload.');
  } else pass('stranded-overlay', 'the loading screen comes down with the page that raised it');

  /* -------------------------------------------------------------- the boot
     THE SAME TRAP ONE LAYER UP, and it outlived the fix above. AmrProgress
     forgets its JOBS on a switch, but AmrBoot is the refcount that raises the
     'boot' job, and it is a §E singleton over ten pages in ONE document. Two
     halves, and the harness has to see both:

       ITS STEPS. A page switched away from mid-boot leaves its steps in
       `pending`, and §D's stale guard drops the callbacks that would have
       reported them — by design. The next page adds a step and answers it, the
       count never reaches zero, and the new page sits under a MODAL screen
       naming a step from a page that is gone, until the 150s watchdog.

       ITS `over` FLAG. One-way on purpose — "boot is finished; never re-raise
       it" is what stops a later fetch throwing the opening screen back up. Left
       set across a switch it stops the NEXT page raising one AT ALL, so every
       page after the first pulled from Sheets behind no screen whatsoever. That
       is the half a job count cannot see: nothing is stuck, nothing leaks, and
       the app simply stops telling anyone it is working. */
  /* STAGED IN THE MOUNT'S OWN TICK. A page's boot() runs synchronously and
     raises its steps there; what answers them are server callbacks, which the
     stub resolves on a later turn. So this is the one moment a page is reliably
     mid-boot — and it is the moment a real user clicks away in, which is the
     whole reason the bug is worth a gate. Raising it AFTER the page had settled
     found `over` already true and need() a no-op, which reads as "the probe
     never raised" rather than as the failure it is. */
  const bootBefore = await pg.evaluate(() => {
    window.AMR.nav.go('overview');
    const wasOver = window.AmrBoot.finished();
    window.AmrBoot.need('probe-step');
    return { wasOver: wasOver,
             up: !!document.querySelector('#amrLoad.show'),
             waiting: window.AmrBoot.waiting() };
  });
  /* Read in the NEXT mount's own tick, for the same reason it was staged in one.
     A page's own boot() runs only once §D has loaded its libs, so nothing of the
     new page's has happened yet here — which is exactly what makes this a clean
     read of what the switch CARRIED over. */
  const bootAfter = await pg.evaluate(() => {
    window.AMR.nav.go('pricevolume');
    return { waiting: window.AmrBoot.waiting(),
             finished: window.AmrBoot.finished(),
             overlay: !!document.querySelector('#amrLoad.show'),
             /* THE WATCHDOG IS A setTimeout AND installCapture RECORDS
                setInterval, so nothing in §D unwinds it — read here, before the
                new page's own boot arms a fresh one. */
             timers: window.__longTimers(120000) };
  });

  /* THE OTHER HALF, AND THE COMMON ONE: the page you leave has FINISHED
     booting. Nothing is stuck and nothing leaks — `over` is simply still set,
     so the next page's need() is a no-op and it pulls from Sheets behind no
     screen at all. Let this page settle first, so the flag is set the way it is
     set on any ordinary visit, then drive the refcount by hand on the next
     mount: whether the SCREEN is up there depends on when §D finishes loading
     that page's libs, and this check is about the module, not the timing. */
  await pg.waitForTimeout(400);
  const settled = await pg.evaluate(() => window.AmrBoot.finished());
  const nextPage = await pg.evaluate(() => {
    window.AMR.nav.go('rmx');
    const o = { finished: window.AmrBoot.finished() };
    window.AmrBoot.need('next-page-step');
    o.raises = !!document.querySelector('#amrLoad.show');
    o.waiting = window.AmrBoot.waiting();
    window.AmrBoot.done('next-page-step');
    /* Usable, not merely quiet — the check a deleted module would also pass. */
    o.comesDown = !document.querySelector('#amrLoad.show');
    return o;
  });

  if (bootBefore.wasOver) {
    /* NOT A BROKEN PROBE — the bug, caught one step earlier than the checks
       below aim at. A page has just been mounted and boot is ALREADY over,
       carried from a page visited earlier in this lap, so need() is a no-op and
       this page has no opening screen to raise. The staging failing is the
       symptom. */
    fail('boot-refcount', 'a page had only just mounted and boot was already marked over, ' +
      'carried from an earlier page in this lap. AmrBoot.need() is a no-op from here on, so ' +
      'every page after the first pulls from Sheets behind no screen at all. `over` is one-way ' +
      'by design and has to be cleared with the page.');
  } else if (!bootBefore.up || bootBefore.waiting.indexOf('probe-step') === -1) {
    fail('boot-refcount', 'the probe never raised the opening screen, so the checks below ' +
      'prove nothing — fix the probe rather than trusting the pass ' +
      `(up=${bootBefore.up}, waiting=[${bootBefore.waiting}])`);
  } else if (bootAfter.waiting.indexOf('probe-step') !== -1) {
    fail('boot-refcount', `the previous page's boot step is still outstanding after the switch ` +
      `(waiting=[${bootAfter.waiting}]). Nothing will ever report it — the stale guard dropped ` +
      'its callback with the page — so the new page cannot get the count to zero and sits under ' +
      'a modal screen naming a step it never asked for, until the watchdog trips.');
  } else if (bootAfter.overlay) {
    fail('boot-refcount', 'the previous page\'s opening screen is still covering the new one.');
  } else if (bootAfter.timers.length) {
    fail('boot-refcount', `the abandoned boot's watchdog is still pending ` +
      `(${bootAfter.timers.join(', ')}ms) after the switch. It fires on whichever page is ` +
      'mounted by then and paints a failure naming a step that page never asked for — the ' +
      'reset has to clear its timers, because §D records setInterval only.');
  } else if (!settled) {
    fail('boot-refcount', 'the probe never let a page finish booting, so the check below ' +
                          'proves nothing — fix the probe rather than trusting the pass');
  } else if (nextPage.finished || !nextPage.raises || !nextPage.waiting.length ||
             !nextPage.comesDown) {
    fail('boot-refcount', 'the page before this one finished booting and left boot marked over, ' +
      'so AmrBoot.need() is a no-op for the page that just mounted: it pulls from Sheets behind ' +
      `no screen at all (finished=${nextPage.finished}, need() raised the screen=` +
      `${nextPage.raises}, waiting=[${nextPage.waiting}], done() took it down=` +
      `${nextPage.comesDown}). \`over\` is one-way by design and has to be cleared with the page.`);
  } else {
    pass('boot-refcount', 'the opening screen belongs to the page that raised it, and the next ' +
                          'page still gets one of its own');
  }

  /* --------------------------------------------------------- the slow open
     THE OTHER HALF OF "LOADING IS BROKEN", and the one nothing client-side can
     actually fix. Apps Script runs one user's calls end to end, so a tab
     reloaded MID-LOAD leaves its call RUNNING on the server — the browser let
     go, the execution did not — and the reloaded page's first call does not
     start until that one finishes. Reloading again only lengthens the queue.

     The screen said nothing about that for 150 seconds and then printed a bug
     report ("a step is missing its AmrBoot.done()"), which is the wrong
     diagnosis and reads as the app being broken. It is not: the abandoned
     execution is filling the very caches this page is about to read, which is
     why the wait happens once. Saying so is the whole fix available here. */
  const slowOpen = await pg.evaluate(() => new Promise(res => {
    window.AmrBoot.reset();
    window.AmrBoot.slow(40);
    window.AmrBoot.need('slow-probe');
    const note = () => ((document.querySelector('#amrLoad .amr-load-sub') || {}).textContent || '');
    const early = note();
    setTimeout(() => {
      const late = note();
      window.AmrBoot.done('slow-probe');
      window.AmrBoot.slow(12000);
      res({ early: early, late: late });
    }, 200);
  }));
  if (!/slow-probe/.test(slowOpen.early)) {
    fail('slow-open', 'the opening screen does not name what it is waiting for at all ' +
                      `(note was "${slowOpen.early}") — fix the probe rather than trusting ` +
                      'the check below');
  } else if (!/still finishing on the server/.test(slowOpen.late)) {
    fail('slow-open', 'an open that has run long says nothing about why. The overwhelmingly ' +
      'common cause is a reload during a load — the previous call is still running on the ' +
      'server and this one is queued behind it — and a screen that only ever says "Waiting for ' +
      `data" for 150s reads as a broken app (note was "${slowOpen.late}").`);
  } else if (/reload/i.test(slowOpen.late) && !/adds to the queue/.test(slowOpen.late)) {
    fail('slow-open', 'the screen tells the user to reload while it is waiting on an execution ' +
      'a reload cannot cancel. That is the one action that makes it worse.');
  } else {
    pass('slow-open', 'a long open explains that it is queued behind the last one, and does ' +
                      'not tell the user to reload into it');
  }

  /* An unregistered page must not silently do nothing. NOTE THE POSITION: go()
     falls back by clicking a target=_top anchor, which really does navigate the
     tab, so every check that needs this document has to have run already. */
  const refused = await pg.evaluate(() => window.AMR.nav.go('nosuchpage'));
  if (refused !== false) fail('fallback', 'go() to an unknown page did not refuse');
  else pass('fallback', 'an unknown page falls back to a full navigation');

  /* ------------------------------------------------------------ the back button
     README claims Back returns to the previous page. It only does if the entry
     the tab was OPENED on carries state: popstate reads e.state.amrPage, and
     the record the browser creates on load has none, so the handler fell
     through to "the page I am already on" and did nothing. That made the first
     Back after the first switch a no-op, every time. start() stamps the entry
     record with replaceState now. Run on a fresh load so the 20-odd pushes
     above cannot mask it. */
  const tmpBack = path.join(os.tmpdir(), 'amr_pageswitch_back.html');
  fs.writeFileSync(tmpBack, pageHtml('landing'));
  await pg.goto('file://' + tmpBack, { waitUntil: 'load' });
  await pg.waitForTimeout(400);
  await pg.evaluate(() => window.AMR.nav.go('rmx'));
  await pg.waitForTimeout(300);
  const reached = await pg.evaluate(() => document.body.getAttribute('data-page'));
  await pg.goBack();
  await pg.waitForTimeout(400);
  const back = await pg.evaluate(() => document.body.getAttribute('data-page'));
  if (reached !== 'rmx') {
    fail('back-button', `never reached rmx (data-page is "${reached}"), so Back proves nothing`);
  } else if (back !== 'landing') {
    fail('back-button', `Back left the app on "${back}", not "landing". The entry history ` +
      `record carries no amrPage, so popstate falls through to the page it is already on and ` +
      `does nothing.`);
  } else pass('back-button', 'Back returns to the page the tab was opened on');

  if (errs.length) {
    /* Page code writes to the console on purpose; only real throws land here. */
    errs.slice(0, 4).forEach(m => fail('pageerror', m.slice(0, 900)));
  } else pass('pageerror', 'no uncaught errors across 21 switches');

  await browser.close();
  console.log(failures ? `\n${failures} failure(s)`
                       : '\npageswitch.js: switching leaves nothing behind');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
