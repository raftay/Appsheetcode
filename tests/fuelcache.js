#!/usr/bin/env node
/* =============================================================================
 * tests/fuelcache.js — the fuel pages' device cache  (PLAN.md chunk 17)
 * -----------------------------------------------------------------------------
 *   npm install playwright
 *   node tests/fuelcache.js
 *   CHROMIUM_PATH=/path/to/chrome node tests/fuelcache.js
 *
 * WHY THIS EXISTS
 *
 * Chunk 17 wired AmrCache into AGG Fuel Recovery and RMX Fuel Recovery, so a
 * repeat visit paints from localStorage instead of waiting on the sheet. PLAN.md
 * §10 was explicit that this is **new behaviour, not a port** — which is exactly
 * why it was kept out of the merge — and it named the three things the chunk
 * must not guess at. All three are checks below, on BOTH pages:
 *
 *   1. THE UPLOADED WORKBOOK MUST NEVER BE CACHED. Both pages can run on a file
 *      the user dropped in. That is session-only by design and is not what the
 *      sheet holds; upOff() is the boundary. A cached upload would be the worst
 *      shape of bug this feature can have — the page would show numbers that are
 *      not in any sheet, on a later visit, with nothing on screen saying so.
 *   2. THE MONTH IS PART OF THE KEY. Both pages send {month} with every read and
 *      the payload differs per month. A cache keyed on the page alone would
 *      serve July's figures for May.
 *   3. A TYPED-OVER CELL IS NOT DATA. NUM_OV / TXT_OV are the user's own edits.
 *      Restoring a cached model must not resurrect them.
 *
 * Plus the two properties the feature is FOR, which are just as easy to get
 * wrong quietly: a cold visit reads the sheet, and a warm one does not.
 *
 * WHY IT DRIVES A BROWSER. localStorage, a real boot, a real upload through a
 * file input. jsdom would need every one of those stubbed, at which point the
 * harness is testing its own stubs.
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

/* Two markets and three months, so "which month is this" is answerable from the
   numbers alone — a fixture that answers the same thing for every month cannot
   fail a cache keyed on the page. Chunk 8's lesson, applied here. */
const STUB = `<script>
(function(){
  window.__calls = [];
  /* The data version has to SURVIVE A RELOAD, or the version-bump check tests
     nothing: goto() builds a fresh document and any window property set from
     the harness goes with the old one. localStorage does survive, and
     AmrCache only ever wipes keys under its own amrCache: prefix. */
  function gen(){ try { return localStorage.getItem('__testGen') || 'gen-1'; }
                  catch(e){ return 'gen-1'; } }
  function payload(month, tag){
    var m = month || 7;
    return { ok:true, source:tag, month:m, latestMonth:m, defaultMonth:7,
             months:[5,6,7], monthNames:['Jan','Feb','Mar','Apr','May','Jun','Jul',
                                         'Aug','Sep','Oct','Nov','Dec'],
             markets:['Manitoba','Ontario'],
             /* the number that identifies this answer */
             stamp: tag + ':m' + m,
             rows:[], sections:[], byMonth:{}, exec:{ MTD:{all:[],applied:[]},
             YTD:{all:[],applied:[]} }, summary:{ MTD:[], YTD:[] } };
  }
  function answer(name, args){
    var a = args && args[0] || {};
    if (name === 'getDataVersion') return { generation: gen() };
    if (name === 'getFscData' || name === 'getRmxFuelData')  return payload(a.month, 'sheet');
    if (name === 'getFscDataFromUpload' || name === 'getRmxFuelDataFromUpload')
      return payload(a.month, 'upload');
    if (name === 'getGuideImages') return [];
    if (name === 'getLogo') return '';
    if (name === 'getGeneration') return gen();
    return { ok:true };
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
        setTimeout(function(){
          try { ok && ok(answer(prop,args)); }
          /* surface a render throw rather than passing it off as a server
             failure — see the same note in pageswitch.js */
          catch(e){ setTimeout(function(){ throw e; },0); bad && bad(e); }
        },0);
      };
    }});
    return proxy;
  }
  window.google = { script:{ get run(){ return runner(); },
                             host:{ setHeight:function(){}, editor:{} } } };
  window.html2canvas=function(){ return Promise.resolve({ width:8,height:8,
    toDataURL:function(){ return 'data:image/png;base64,AA'; } }); };
  /* The upload path parses a workbook with SheetJS. What is under test is the
     CACHE, not the parser, so it answers a plausible sheet at once. */
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

const PAGES = [
  { id: 'fuelsurcharge', read: 'getFscData',     inputs: ['upComb', 'upOther'] },
  { id: 'rmxfuel',       read: 'getRmxFuelData', inputs: ['upMain'] },
];

(async () => {
  const exe = browserPath();
  if (!exe) { console.error('no Chromium found (set CHROMIUM_PATH)'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: exe });

  /* A real file for the upload inputs. Its contents never matter — XLSX is
     stubbed — but a file input will not accept anything else. */
  const dummy = path.join(os.tmpdir(), 'amr_fuelcache_dummy.xlsx');
  fs.writeFileSync(dummy, 'not a workbook; XLSX is stubbed');

  for (const P of PAGES) {
    console.log(`\n  ${P.id}`);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pg  = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(e.message));

    const tmp = path.join(os.tmpdir(), 'amr_fuelcache_' + P.id + '.html');
    fs.writeFileSync(tmp, pageHtml(P.id));
    const open = async () => {
      await pg.goto('file://' + tmp, { waitUntil: 'load' });
      await pg.waitForTimeout(500);
    };
    const calls   = () => pg.evaluate(() => window.__calls.slice());
    const store   = () => pg.evaluate(() => {
      const o = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.indexOf('amrCache') === 0) o[k] = localStorage.getItem(k);
      }
      return o;
    });
    const stamp = () => pg.evaluate(() => {
      const s = document.getElementById('loadStat');
      return s ? s.textContent : '';
    });

    /* ---------------------------------------------------------------- cold */
    await open();
    let c = await calls();
    const cold = c.filter(x => x === P.read).length;
    let st = await store();
    const keys1 = Object.keys(st).filter(k => k.indexOf('amrCache:') === 0);
    if (cold !== 1)
      fail('cold', `${P.id}: a first visit called ${P.read} ${cold} times, expected exactly 1`);
    else if (keys1.length !== 1)
      fail('cold', `${P.id}: a first visit left ${keys1.length} payload(s) on the device, ` +
                   `expected 1 — [${keys1.join(', ')}]`);
    else if (!/m0$|m\d+$/.test(keys1[0]))
      fail('cold', `${P.id}: the stored key "${keys1[0]}" does not end in a month. The month ` +
                   `rides in every read and the payload differs per month, so a key without ` +
                   `one serves July's figures for May.`);
    else pass('cold', `reads the sheet once and stores one payload (${keys1[0]})`);

    /* ---------------------------------------------------------------- warm */
    await open();
    c = await calls();
    const warm = c.filter(x => x === P.read).length;
    if (warm !== 0)
      fail('warm', `${P.id}: a repeat visit still called ${P.read} ${warm} time(s). The point ` +
                   `of the chunk is that it does not — AmrCache.boot has already confirmed the ` +
                   `data version, so a hit is current by construction.`);
    else if (!/Loaded/.test(await stamp()))
      fail('warm', `${P.id}: a repeat visit made no server read AND painted nothing — that is ` +
                   `not a cache hit, that is a page that failed to boot`);
    else pass('warm', 'a repeat visit paints from the device with no sheet read');

    /* -------------------------------------------------------- month keyed */
    await pg.selectOption('#fscMonthSel', '5');
    await pg.waitForTimeout(400);
    c = await calls();
    const afterMay = c.filter(x => x === P.read).length;
    st = await store();
    const keys2 = Object.keys(st).filter(k => k.indexOf('amrCache:') === 0);
    if (afterMay !== 1)
      fail('month-keyed', `${P.id}: picking a different month made ${afterMay} sheet read(s), ` +
                          `expected 1 — a cache that answered from another month's payload ` +
                          `would make none`);
    else if (keys2.length !== 2)
      fail('month-keyed', `${P.id}: after two months the device holds ${keys2.length} ` +
                          `payload(s), expected 2 — [${keys2.join(', ')}]`);
    else pass('month-keyed', `each month is its own entry (${keys2.length} on the device)`);

    /* going back to the first month must be a hit */
    await pg.selectOption('#fscMonthSel', '0');
    await pg.waitForTimeout(400);
    c = await calls();
    if (c.filter(x => x === P.read).length !== afterMay)
      fail('month-keyed', `${P.id}: going back to the first month read the sheet again — the ` +
                          `entry stored for it is not being found`);
    else pass('month-keyed', 'going back to a month already seen costs no sheet read');

    /* -------------------------------------------------- typed cells are not data */
    const before = JSON.stringify(await store());
    await pg.evaluate(() => {
      /* Type into the first editable cell exactly as a user would: the pages
         capture edits from an `input` event delegated on #tablesHost. */
      const cell = document.querySelector('#tablesHost .fsc-in');
      if (!cell) return;
      cell.textContent = '99999';
      cell.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await pg.waitForTimeout(300);
    const after = JSON.stringify(await store());
    if (after !== before)
      fail('typed-not-data', `${P.id}: typing into a cell changed what is stored on the device. ` +
                             `NUM_OV / TXT_OV are the user's edits, not the sheet's data — a ` +
                             `cached model that restores them is showing figures nobody can ` +
                             `trace back to a source.`);
    else pass('typed-not-data', 'a typed-over cell never reaches the device store');

    /* ------------------------------------------------ the upload is never cached */
    const beforeUpload = await store();
    for (const id of P.inputs) await pg.setInputFiles('#' + id, dummy);
    /* The upload panel lives inside the QlikView guide, which is closed — so the
       button is in the document but not visible, and a real click cannot reach
       it. The handler is an ordinary listener; dispatching the click is the same
       code path and does not pretend the panel was open. */
    await pg.evaluate(() => document.getElementById('upGo').click());
    await pg.waitForTimeout(700);
    const afterUpload = await store();
    const grew = Object.keys(afterUpload).filter(k => !(k in beforeUpload));
    const changed = Object.keys(afterUpload).filter(k => beforeUpload[k] !== undefined &&
                                                         beforeUpload[k] !== afterUpload[k]);
    /* The fixture stamps every payload with where it came from, so "did an
       upload get stored" is answerable from the store itself rather than
       inferred from a count. */
    const storedHasUpload = Object.values(afterUpload).some(v => /"source":"upload"/.test(v));

    if (grew.length || changed.length)
      fail('upload-not-cached', `${P.id}: running on an uploaded workbook wrote to the device ` +
        `(${grew.length} new, ${changed.length} changed). That data is session-only by design ` +
        `and is not what the sheet holds — a later visit would paint numbers that are in no sheet.`);
    else if (storedHasUpload)
      fail('upload-not-cached', `${P.id}: an uploaded payload is sitting in the device store`);
    else pass('upload-not-cached', 'an uploaded workbook writes nothing to the device');

    /* and leaving upload mode must put the page back on sheet data */
    await pg.evaluate(() => document.getElementById('upReset').click());
    await pg.waitForTimeout(500);
    if (!/Loaded/.test(await stamp()))
      fail('upload-not-cached', `${P.id}: Back to sheet data left the page without data`);
    else pass('upload-boundary', 'Back to sheet data returns to the sheet, cached or not');

    /* -------------------------------------------------- a version bump wipes */
    await pg.evaluate(() => localStorage.setItem('__testGen', 'gen-2'));
    await open();
    c = await calls();
    if (c.filter(x => x === P.read).length !== 1)
      fail('version-bump', `${P.id}: the data version moved and the page did NOT re-read the ` +
                           `sheet — the device store is being served past the data it describes`);
    else pass('version-bump', 'a new data version wipes the device store and re-reads');

    if (errs.length) fail('pageerror', `${P.id}: ${errs.slice(0, 2).join(' | ').slice(0, 200)}`);
    else pass('pageerror', 'no uncaught errors');

    await ctx.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} failure(s)`
                       : '\nfuelcache.js: both fuel pages cache the sheet, and only the sheet');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
