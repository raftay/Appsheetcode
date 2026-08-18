#!/usr/bin/env node
/* =============================================================================
 * tests/settings.js — the Settings modal, and the Saskatchewan readout (ch. 19)
 * -----------------------------------------------------------------------------
 *   npm install playwright
 *   node tests/settings.js
 *
 * WHY THIS EXISTS
 *
 * getSaskRatesStatus had existed since before the merge with NOTHING CALLING IT.
 * Its own comment said it was there "so the Settings screen (and a quick manual
 * run) can check the sheet" — the manual run was real and is why chunk 12 kept
 * it, but the Settings half of that sentence was untrue for its whole life.
 * Chunk 19 wired it, which is what made the sentence true.
 *
 * A feature nothing calls is exactly what this repo keeps finding, so the point
 * of this harness is that the wiring cannot quietly come undone again — and the
 * failure mode it guards against is not an error, it is SILENCE.
 *
 * IT ALSO PINS THE RULE THE WIRING FOLLOWS. The readout attaches to the
 * `saskrates` row, and which pages have that row is decided by
 * APP_EXTRA_SOURCES in app.gs — not by a list in app.html. So a page that reads
 * the Saskatchewan sheet gets the readout automatically, and a page that does
 * not must not ask for it at all. Both directions are checked, because "it
 * appears everywhere" and "it appears where it should" look identical from one
 * page.
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

/* getSettingsFor's answer is taken from app.gs's own APP_EXTRA_SOURCES, so the
   fixture models the real thing: AGG Fuel Recovery reads its own sheet, Price &
   Volume's, and saskrates. RMX Fuel Recovery reads none of them. */
const STUB = ok => `<script>
(function(){
  window.__calls = [];
  var ROWS = {
    fuelsurcharge: [
      { page:'fuelsurcharge', label:'AGG Fuel Recovery', configured:true, name:'FSC sheet', source:'default' },
      { page:'pricevolume',   label:'Price & Volume',    configured:true, name:'PV sheet',  source:'default' },
      { page:'saskrates',     label:'Saskatchewan rates',configured:true, name:'SK sheet',  source:'default' }
    ],
    rmxfuel: [
      { page:'rmxfuel', label:'RMX Fuel Recovery', configured:true, name:'RFSC sheet', source:'default' }
    ]
  };
  function answer(name, args){
    if (name === 'getSettingsFor') return ROWS[args[0]] || [];
    if (name === 'getAllSettings') return ROWS.fuelsurcharge;
    if (name === 'getSaskRatesStatus') return ${ok};
    if (name === 'getDataVersion')  return { generation:'g1' };
    if (name === 'getGuideImages')  return [];
    if (name === 'getLogo')         return '';
    return { ok:true, markets:['Manitoba'], months:[7], monthNames:['Jan','Feb','Mar','Apr','May',
             'Jun','Jul','Aug','Sep','Oct','Nov','Dec'], latestMonth:7, defaultMonth:7,
             rows:[], sections:[], byMonth:{}, exec:{MTD:{all:[],applied:[]},YTD:{all:[],applied:[]}},
             summary:{MTD:[],YTD:[]} };
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
          var a; try { a = answer(prop, args); } catch(e){ bad && bad(e); return; }
          if (a && a.__fail) { bad && bad(new Error('boom')); return; }
          try { ok && ok(a); } catch(e){ setTimeout(function(){ throw e; },0); bad && bad(e); }
        },0);
      };
    }});
    return proxy;
  }
  window.google = { script:{ get run(){ return runner(); }, host:{ setHeight:function(){}, editor:{} } } };
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

function pageHtml(startPage, stub) {
  const raw = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8')
    .replace(/<\?!?=\s*(\w+)\s*\?>/g, (all, name) =>
      ({ page: startPage, appUrl: URL_BASE })[name] ?? '');
  const head = raw.indexOf('</head>');
  const tag = raw.slice(head).match(/<body[^>]*>/);
  const at = head + tag.index + tag[0].length;
  return raw.slice(0, at) + stub + raw.slice(at);
}

const GOOD = `{ configured:true, ok:true, market:'Saskatchewan', customers:12, matched:10,
                unmatched:['ACME CONCRETE','BOREAL AGGREGATE'], duplicates:[] }`;
const CLEAN = `{ configured:true, ok:true, market:'Saskatchewan', customers:12, matched:12,
                 unmatched:[], duplicates:[] }`;
const NONE  = `{ configured:false, ok:false, market:'', customers:0, matched:0,
                 unmatched:[], duplicates:[] }`;
const BOOM  = `{ __fail:true }`;

(async () => {
  const exe = browserPath();
  if (!exe) { console.error('no Chromium found (set CHROMIUM_PATH)'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: exe });

  async function open(page, answer) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pg  = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(e.message));
    const tmp = path.join(os.tmpdir(), 'amr_settings_' + page + '.html');
    fs.writeFileSync(tmp, pageHtml(page, STUB(answer)));
    await pg.goto('file://' + tmp, { waitUntil: 'load' });
    await pg.waitForTimeout(400);
    await pg.evaluate(() => window.AMR.openSettings());
    await pg.waitForTimeout(500);
    return { ctx, pg, errs,
      row:   () => pg.evaluate(() => {
        const r = document.querySelector('.amr-set-row[data-page="saskrates"]');
        return r ? r.textContent.replace(/\s+/g, ' ').trim() : null;
      }),
      asked: () => pg.evaluate(() => window.__calls.filter(c => c === 'getSaskRatesStatus').length),
      saveable: () => pg.evaluate(() =>
        document.querySelectorAll('.amr-set-row .amr-save-btn').length),
    };
  }

  /* 1 — the readout appears, and says what the table actually holds */
  {
    const t = await open('fuelsurcharge', GOOD);
    const txt = await t.row();
    if (!txt) fail('appears', 'there is no saskrates row at all — the fixture or getSettingsFor changed');
    else if (await t.asked() !== 1)
      fail('appears', `getSaskRatesStatus was called ${await t.asked()} times, expected exactly 1`);
    else if (/Checking the rate table/.test(txt))
      fail('appears', 'the readout is still on "Checking the rate table…" — the answer never landed');
    else if (!/12 customers/.test(txt) || !/10 matched/.test(txt))
      fail('appears', `the readout does not carry the counts the server sent: "${txt.slice(0, 150)}"`);
    else pass('appears', 'the saskrates row carries the customer and matched counts');

    /* 2 — an unmatched customer is NAMED, because "2 unmatched" only tells you
           to go and open the sheet. This is the whole value of the readout: an
           unmatched name is a rate that silently never applies. */
    if (txt && !/ACME CONCRETE/.test(txt))
      fail('names-the-gap', `the unmatched customers are counted but not named: "${txt.slice(0, 150)}"`);
    else if (txt) pass('names-the-gap', 'customers with no rate applied are named, not just counted');
    if (t.errs.length) fail('pageerror', t.errs[0].slice(0, 140));
    await t.ctx.close();
  }

  /* 3 — a table with nothing wrong says so without shouting */
  {
    const t = await open('fuelsurcharge', CLEAN);
    const txt = await t.row();
    if (!/12 matched/.test(txt || ''))
      fail('clean', `a fully matched table does not report itself: "${(txt || '').slice(0, 120)}"`);
    else if (/No rate applied for/.test(txt))
      fail('clean', 'a fully matched table is still listing customers with no rate');
    else pass('clean', 'a fully matched table reports clean');
    await t.ctx.close();
  }

  /* 4 — no sheet configured is a real answer, not an error */
  {
    const t = await open('fuelsurcharge', NONE);
    const txt = await t.row();
    if (!/not being applied/.test(txt || ''))
      fail('unconfigured', `an unconfigured rate sheet does not say the increase is not applied: ` +
                           `"${(txt || '').slice(0, 120)}"`);
    else pass('unconfigured', 'no rate sheet says the increase is not being applied at all');
    await t.ctx.close();
  }

  /* 5 — THE READOUT MUST NEVER BE THE REASON SETTINGS BREAKS. It is a
         best-effort extra on a screen whose actual job is repointing a sheet. */
  {
    const t = await open('fuelsurcharge', BOOM);
    const txt = await t.row();
    const saves = await t.saveable();
    if (saves !== 3)
      fail('never-fatal', `the rate-table call failed and the modal lost its rows — ${saves} Save ` +
                          `buttons, expected 3. Repointing a sheet must not depend on a readout.`);
    else if (/Checking the rate table/.test(txt || ''))
      fail('never-fatal', 'the failure left the readout spinning forever');
    else pass('never-fatal', 'a failed readout leaves every sheet still repointable');
    await t.ctx.close();
  }

  /* 6 — and it must NOT be asked for where the page has no such source.
         Which pages those are is APP_EXTRA_SOURCES' decision, in app.gs; if
         this ever starts asking everywhere, a second list has grown. */
  {
    const t = await open('rmxfuel', GOOD);
    const asked = await t.asked();
    const row = await t.row();
    if (row) fail('follows-the-sources', 'RMX Fuel Recovery has a saskrates row and should not — ' +
                                         'Saskatchewan is an Aggregates concern (README §7)');
    else if (asked !== 0)
      fail('follows-the-sources', `getSaskRatesStatus was called ${asked} time(s) on a page with no ` +
                                  `saskrates source. The readout follows APP_EXTRA_SOURCES; asking ` +
                                  `anyway means a second page list has grown in app.html.`);
    else pass('follows-the-sources', 'a page without the source neither shows nor asks');
    await t.ctx.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} failure(s)`
                       : '\nsettings.js: the Saskatchewan rate table is read out, and only where it is read');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
