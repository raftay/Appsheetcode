#!/usr/bin/env node
/* =============================================================================
 * tests/cssparity.js — the merged page's CASCADE, not just its markup
 * -----------------------------------------------------------------------------
 *   npm install playwright
 *   node tests/cssparity.js
 *   CHROMIUM_PATH=/path/to/chrome node tests/cssparity.js
 *
 * WHY THIS EXISTS
 * `pageparity.js` proves the merged page emits the same HTML as the old one.
 * That is not the same as proving it LOOKS the same, and the gap is not
 * theoretical — it is a property of how the merge was done.
 *
 * Every page's style block was scoped by prefixing `body[data-page="x"] `.
 * That prefix does two things, and only one of them is the intended one:
 *
 *   1. it narrows what the selector matches      — intended
 *   2. it RAISES THE SELECTOR'S SPECIFICITY by one attribute selector
 *
 * (2) has no effect until a shared §A1–§A3 rule declares the same property on
 * the same element. Then the page rule, which used to lose, starts winning, and
 * the DOM is byte-identical while the pixels are not. Ready-Mix shipped exactly
 * that: `aside{}` at (0,0,1) lost to `.qlikGuide{display:none}` at (0,1,0);
 * scoped to (0,1,2) it won, and the QlikView guide opened on load and would not
 * close. Nothing in the suite could see it — see README §3.
 *
 * Ready-Mix is the page that needs this, because it is the only one whose §A4
 * block styles BARE ELEMENTS — `table`, `th`, `td`, `thead th`, `tfoot td`,
 * `tr.subtotal td`. Every other page anchors on its own classes, where the same
 * raise cannot reach a shared rule.
 *
 * HOW IT WORKS
 * Both pages are booted in real Chromium off the SAME model (`rmxfixture.js`),
 * so both render identical table markup — `pageparity.js` is what proves that,
 * and this harness asserts it again per element rather than assuming it. Then,
 * for every paired element inside the table hosts, it compares the computed
 * value of every property the §A4 Ready-Mix block declares. A difference there
 * is a cascade difference, because nothing else about the two elements differs.
 *
 * The property list is DERIVED FROM THE BLOCK, not hard-coded, and the harness
 * fails if the block declares a shorthand it does not know how to expand — a
 * list that silently stopped covering a new rule would be worse than no list.
 * ===========================================================================*/
'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { rmxModel } = require('./rmxfixture');
const { legacy: legacyFile } = require('./apphtml.js');

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
    for (const d of fs.readdirSync(dir)) {
      for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
        const p = path.join(dir, d, sub);
        if (/^chromium-/.test(d) && fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let failures = 0;
const fail = (what, msg) => { failures++; console.log(`  ✗ ${what}: ${msg}`); };
const pass = (what, msg) => console.log(`  ✓ ${what}${msg ? ': ' + msg : ''}`);

/* ------------------------------------------- what the §A4 block declares */
/* Shorthands a computed style cannot be read back from directly. Anything the
   block declares that is not here stops the run: under-covering is the one
   failure mode this harness cannot report on itself. */
const EXPAND = {
  font:          ['font-style', 'font-weight', 'font-size', 'line-height', 'font-family'],
  padding:       ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  margin:        ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  border:        ['border-top-width', 'border-top-style', 'border-top-color',
                  'border-right-width', 'border-right-style', 'border-right-color',
                  'border-bottom-width', 'border-bottom-style', 'border-bottom-color',
                  'border-left-width', 'border-left-style', 'border-left-color'],
  'border-top':    ['border-top-width', 'border-top-style', 'border-top-color'],
  'border-bottom': ['border-bottom-width', 'border-bottom-style', 'border-bottom-color'],
  'border-left':   ['border-left-width', 'border-left-style', 'border-left-color'],
  'border-right':  ['border-right-width', 'border-right-style', 'border-right-color'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius',
                    'border-bottom-right-radius', 'border-bottom-left-radius'],
  background:    ['background-color', 'background-image'],
  flex:          ['flex-grow', 'flex-shrink', 'flex-basis'],
  gap:           ['row-gap', 'column-gap'],
  inset:         ['top', 'right', 'bottom', 'left'],
  transition:    ['transition-duration'],
  overflow:      ['overflow-x', 'overflow-y'],
};
/* Longhands that read back as themselves. */
const SELF = new Set([
  'display', 'position', 'top', 'right', 'bottom', 'left', 'color', 'width', 'height',
  'min-width', 'max-width', 'min-height', 'max-height', 'text-align', 'vertical-align',
  'white-space', 'text-transform', 'letter-spacing', 'line-height', 'font-size',
  'font-weight', 'font-family', 'font-style', 'background-color', 'opacity', 'z-index',
  'flex-direction', 'align-items', 'justify-content', 'flex-wrap', 'row-gap', 'column-gap',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border-top-width', 'border-bottom-width', 'border-collapse', 'box-sizing',
  'text-decoration-line', 'cursor', 'visibility', 'flex-grow', 'flex-shrink', 'flex-basis',
  'overflow-x', 'overflow-y', 'word-break', 'text-overflow',
]);

function auditedProperties() {
  const src = read('app.html').replace(/<!--[\s\S]*?-->/g, '');
  const block = [...src.matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map(m => m[1]).find(b => /§A4\s+PAGE CSS/.test(b));
  if (!block) { fail('setup', 'no §A4 style block in app.html'); return null; }
  const css = block.replace(/\/\*[\s\S]*?\*\//g, '');

  const props = new Set(), unknown = new Set();
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = rule[1].trim();
    if (!/body\[data-page="rmx"\]/.test(sel)) continue;
    for (const decl of rule[2].split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const name = decl.slice(0, i).trim().toLowerCase();
      if (!name || name.startsWith('--')) continue;
      if (EXPAND[name]) EXPAND[name].forEach(p => props.add(p));
      else if (SELF.has(name)) props.add(name);
      else unknown.add(name);
    }
  }
  if (unknown.size) {
    fail('property-coverage',
         `the Ready-Mix §A4 block declares ${[...unknown].join(', ')}, which this harness ` +
         `cannot read back from a computed style. Add it to SELF or EXPAND — a list that ` +
         `stops covering a rule makes this harness unable to fail.`);
    return null;
  }
  return [...props].sort();
}

/* ------------------------------------------------------------ page sources */
function fillVars(src, vars) {
  return src.replace(/<\?!?=\s*(\w+)\s*\?>/g, (all, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : all);
}
/* Page_Rmx.html and its includes were deleted at the cutover and come out of
   git — this harness IS the comparison, so it needs the side that is gone. See
   apphtml.js for when the legacy half retires. */
function legacySource() {
  let src = legacyFile('Page_Rmx.html');
  src = src.replace(/<\?!?=\s*include\('([\w-]+)'\)\s*\?>/g, (_, name) => legacyFile(name + '.html'));
  return fillVars(src, { page: 'rmx', appUrl: URL_BASE, appMode: 'false' });
}
function mergedSource() {
  return fillVars(read('app.html'), { page: 'rmx', appUrl: URL_BASE, appMode: 'false' });
}

/* The browser-side stub. Same answers as pageparity's, off the same model, so
   the two harnesses cannot disagree about what the page was shown. */
function stubScript() {
  const model = JSON.stringify(rmxModel());
  return `<script>
(function(){
  var MODEL = ${model};
  var STUBS = {
    RMX_prepare:        function(){ return MODEL; },
    RMX_getKeys:        function(){ return MODEL.payload || MODEL; },
    RMX_getExtras:      function(o){ return { ok:true, market:o&&o.market, period:o&&o.period,
                                              byTypeExtras:[], byTypeVap:[], extras:[], vap:[] }; },
    RMX_getUnmapped:    function(){ return { ok:true, sections:[] }; },
    RMX_getSlideTables: function(){ return MODEL; },
    RMX_uploadData:     function(){ return { ok:true, token:'tok' }; },
    RMX_getSuggestions: function(){ return { ok:true, sections:[] }; },
    getLogo:            function(){ return ''; },
    getGuideImages:     function(ids){ return (ids||[]).map(function(){ return ''; }); },
    getDataVersion:     function(){ return { generation:'test-gen-1' }; },
    getSettingsFor:     function(){ return []; },
    getAllSettings:     function(){ return []; },
    getKpiValues:       function(){ return null; }
  };
  window.__unstubbed = [];
  function runner(){
    var ok=null, bad=null;
    var proxy = new Proxy({}, { get:function(t,prop){
      if(prop==='withSuccessHandler') return function(f){ ok=f; return proxy; };
      if(prop==='withFailureHandler') return function(f){ bad=f; return proxy; };
      if(typeof prop!=='string') return undefined;
      return function(){
        var args=[].slice.call(arguments);
        setTimeout(function(){
          if(!STUBS[prop]){ window.__unstubbed.push(prop); bad && bad(new Error('no stub')); return; }
          try { ok && ok(STUBS[prop].apply(null,args)); } catch(e){ bad && bad(e); }
        },0);
      };
    }});
    return proxy;
  }
  window.google = { script: { get run(){ return runner(); },
                              host:{ setHeight:function(){}, editor:{} } } };

  /* Chart.js and html2canvas never arrive off the network. Without a stub the
     page throws inside its chart pass and stops BEFORE the tables — and two
     pages that both died would compare as identical. */
  window.Chart = function(ctx,cfg){ this.config=cfg; this.data=cfg&&cfg.data;
    this.update=function(){}; this.destroy=function(){}; this.resize=function(){};
    this.toBase64Image=function(){ return ''; };
    this.getDatasetMeta=function(){ return { data:[] }; }; };
  window.Chart.register=function(){};
  window.Chart.defaults={ font:{}, plugins:{ legend:{}, tooltip:{} }, scale:{} };
  window.html2canvas=function(){ return Promise.resolve({ width:8, height:8,
    toDataURL:function(){ return 'data:image/png;base64,AA'; } }); };

  /* AmrLib awaits onload on an injected <script src>; off the network that
     promise never settles and boot() never runs. */
  var create=document.createElement.bind(document);
  document.createElement=function(tag){
    var el=create(tag);
    if(String(tag).toLowerCase()==='script'){
      var src='';
      Object.defineProperty(el,'src',{ get:function(){ return src; },
        set:function(v){ src=v; setTimeout(function(){ el.onload && el.onload(); },0); } });
    }
    return el;
  };
})();
</script>`;
}

/* The stub must land INSIDE <body> and before the page's own scripts. app.html
   describes a <body …> tag in a head comment, so the first match in the file is
   prose — search after </head>, the same way bgrender.js has to. */
function withStub(html) {
  const head = html.indexOf('</head>');
  if (head < 0) throw new Error('no </head>');
  const tag = html.slice(head).match(/<body[^>]*>/);
  if (!tag) throw new Error('no <body> after </head>');
  const at = head + tag.index + tag[0].length;
  return html.slice(0, at) + stubScript() + html.slice(at);
}

/* ---------------------------------------------------------------- the run */
/* The regions pageparity already proves are byte-identical HTML. Pairing inside
   them is therefore safe by construction, and they are where every audited
   selector applies. */
const HOSTS = ['tablesHost', 'extrasHost'];

/* DIFFERENCES THAT ARE DELIBERATE, each with the reason it is not a bug.
 * An entry here is not a tolerance — it is a claim, and the run FAILS if the
 * difference it describes has stopped happening. A silenced check that no
 * longer applies is how an allow-list turns into a blindfold. */
const KNOWN = [
  { tag: 'button', cls: 'amr-qm', prop: 'font-family',
    legacy: 'Inter, sans-serif', merged: 'Inter',
    why: 'Shell.html was the only file in the suite that wrote a fallback after ' +
         'Inter — 4 declarations out of roughly 200, every other one bare. §A3 ' +
         'normalised it on the way in. The difference is real but it is the ' +
         'outlier being brought into line, not the port losing something.' },
];
const knownHit = new Array(KNOWN.length).fill(0);
function isKnown(tag, cls, prop, legacy, merged) {
  const classes = cls.split(/\s+/);
  const i = KNOWN.findIndex(k => k.tag === tag && classes.includes(k.cls) &&
                                 k.prop === prop && k.legacy === legacy && k.merged === merged);
  if (i < 0) return false;
  knownHit[i]++;
  return true;
}

async function side(browser, html, label, props) {
  const pg = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(`${label}: ${e.message}`));
  const tmp = path.join(os.tmpdir(), 'amr_cssparity_' + label + '.html');
  fs.writeFileSync(tmp, html);
  await pg.goto('file://' + tmp, { waitUntil: 'load' });

  /* Wait for the tables rather than for a timeout: a fixed sleep that is a
     little too short reads as "no differences" — the worst possible pass. */
  try {
    await pg.waitForFunction(() => {
      const h = document.getElementById('tablesHost');
      return h && h.querySelectorAll('table').length > 0;
    }, null, { timeout: 20000 });
  } catch (e) {
    fail(label, 'no table ever rendered in #tablesHost — the page did not boot' +
                (errs.length ? ` (${errs[0]})` : ''));
    return null;
  }

  const shot = await pg.evaluate(({ hosts, props }) => {
    const out = [];
    for (const id of hosts) {
      const host = document.getElementById(id);
      if (!host) { out.push({ host: id, missing: true }); continue; }
      const els = [host, ...host.querySelectorAll('*')];
      out.push({
        host: id,
        nodes: els.map(el => {
          const cs = getComputedStyle(el);
          const styles = {};
          for (const p of props) styles[p] = cs.getPropertyValue(p);
          return {
            tag: el.tagName.toLowerCase(),
            cls: (el.getAttribute('class') || '').trim(),
            text: (el.textContent || '').trim().slice(0, 30),
            styles,
          };
        }),
      });
    }
    return out;
  }, { hosts: HOSTS, props });

  const unstubbed = await pg.evaluate(() => window.__unstubbed || []);
  await pg.close();
  return { shot, errs, unstubbed };
}

(async () => {
  const props = auditedProperties();
  if (!props) { console.log('\n1 failure(s)'); process.exit(1); }
  console.log(`  · comparing ${props.length} computed properties, derived from the ` +
              `Ready-Mix §A4 block`);

  const exe = browserPath();
  if (!exe) { console.error('no Chromium found (set CHROMIUM_PATH)'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: exe });

  const A = await side(browser, withStub(legacySource()), 'legacy', props);
  const B = await side(browser, withStub(mergedSource()), 'merged', props);
  await browser.close();
  if (!A || !B) { console.log(`\n${failures} failure(s)`); process.exit(1); }

  for (const s of [A, B]) {
    if (s.unstubbed.length) fail('stubs', `unstubbed server call(s): ${[...new Set(s.unstubbed)].join(', ')}`);
  }

  let compared = 0, diffs = 0;
  for (let h = 0; h < HOSTS.length; h++) {
    const a = A.shot[h], b = B.shot[h];
    if (a.missing || b.missing) { fail('hosts', `#${HOSTS[h]} missing on one side`); continue; }
    if (a.nodes.length !== b.nodes.length) {
      fail('pairing', `#${HOSTS[h]}: ${a.nodes.length} elements on legacy, ${b.nodes.length} on ` +
                      `merged — pageparity should have caught this first`);
      continue;
    }
    for (let i = 0; i < a.nodes.length; i++) {
      const x = a.nodes[i], y = b.nodes[i];
      if (x.tag !== y.tag) {
        fail('pairing', `#${HOSTS[h]}[${i}]: <${x.tag}> vs <${y.tag}>`);
        break;
      }
      for (const p of props) {
        compared++;
        if (x.styles[p] === y.styles[p]) continue;
        if (isKnown(y.tag, y.cls, p, x.styles[p], y.styles[p])) continue;
        diffs++;
        fail('cascade',
             `#${HOSTS[h]} <${y.tag}${y.cls ? '.' + y.cls.split(/\s+/).join('.') : ''}>` +
             (y.text ? ` "${y.text}"` : '') +
             `  ${p}: legacy "${x.styles[p]}" → merged "${y.styles[p]}"`);
      }
    }
  }

  KNOWN.forEach((k, i) => {
    if (knownHit[i]) {
      console.log(`  · known: <${k.tag}.${k.cls}> ${k.prop} "${k.legacy}" → "${k.merged}" ` +
                  `(${knownHit[i]}×) — ${k.why}`);
    } else {
      fail('known-differences',
           `the allowed difference on <${k.tag}.${k.cls}> ${k.prop} no longer happens. ` +
           `Delete the entry rather than leaving a check that cannot fire.`);
    }
  });
  if (!diffs) pass('cascade', `${compared} computed values identical across both pages` +
                              (knownHit.some(Boolean) ? ', bar the known differences above' : ''));
  console.log(failures ? `\n${failures} failure(s)` +
                         `\nCASCADE DRIFT — the merged page renders the same HTML differently.`
                       : `\ncssparity.js: the merged page's cascade matches the old page's`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
