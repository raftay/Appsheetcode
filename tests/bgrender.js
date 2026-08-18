/* tests/bgrender.js — the render keeps going when the tab does not
 *
 *   npm install playwright
 *   node tests/bgrender.js
 *   CHROMIUM_PATH=/path/to/chrome node tests/bgrender.js
 *
 * WHY THIS EXISTS
 * Clicking onto another tab used to stop the Deck Builder dead on whatever
 * slide it was rendering, and there was nothing to see: no error, no red row,
 * the progress line just froze mid-deck. The cause is one line — a browser does
 * not fire `requestAnimationFrame` in a hidden tab at ALL, and `captureBare`
 * waited for two frames before photographing. Not late. Never.
 *
 * So the property under test is not "it is fast in the background", it is
 * "IT FINISHES WITH NO FRAMES AT ALL". That is exactly what a hidden tab is,
 * and it is testable without hiding anything: take requestAnimationFrame away
 * and see whether the capture still resolves. The pre-fix code hangs here
 * forever; the fix falls through to AmrTick, whose timer lives in a Worker
 * because main-thread timers are throttled to one a second in a hidden tab and
 * one a MINUTE after five minutes of it.
 *
 * html2canvas is stubbed — this is about the wait before it, not the picture.
 *
 * IT RUNS TWICE. The `legacy` side is SlideExport.html + Shell.html spliced
 * together; the `merged` side is app.html on the Deck Builder route, which is
 * the file the live app will serve. The merged side also checks the thing that
 * could ONLY break in the merge: every deck content module ends with an
 * AmrDeckSource.register() guarded by `if(!window.AmrDeckSource) return;`, so
 * if §E puts the registry below them they all fall through and the Deck
 * Builder opens with an empty source list and no error at all.
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');

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
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
function expand(src, depth) {
  return src.replace(/<\?!?=\s*include\('([^']+)'\)\s*\?>/g,
      (m, name) => (depth > 3 ? '' : expand(read(name + '.html'), (depth || 0) + 1)))
    .replace(/<\?[=!]?[\s\S]*?\?>/g, '');
}

/* html2canvas, minus the canvas. It resolves on its own timer, which is what
   the real one does too — the question is only whether anything ever calls it.

   The second half of the stub is for app.html: AmrLib injects a <script src>
   for Chart.js and html2canvas and AWAITS its onload before boot(). Off the
   network that promise never settles, the page never boots, and a live gate
   reads as a dead port. Resolving every injected script at once leaves the
   stub above in place, which is what the checks actually run against. */
const STUB = `
<script>
window.html2canvas = function(){
  return new Promise(function(res){
    setTimeout(function(){
      res({ width:800, height:450, toDataURL:function(){ return 'data:image/png;base64,AA'; } });
    }, 10);
  });
};
(function(){
  var create = document.createElement.bind(document);
  document.createElement = function(tag){
    var el = create(tag);
    if(String(tag).toLowerCase() === 'script'){
      var src = '';
      Object.defineProperty(el, 'src', {
        get:function(){ return src; },
        set:function(v){ src = v; setTimeout(function(){ el.onload && el.onload(); }, 0); }
      });
    }
    return el;
  };
})();
</script>`;

const LEGACY = `<!doctype html><html><body>${STUB}
${expand(read('SlideExport.html'), 0)}
${expand(read('Shell.html'), 0)}
</body></html>`;

/* app.html on the Deck Builder route. The three template variables doGet sets
   have to be FILLED, not stripped: an empty data-page mounts nothing, and the
   failure looks like a dead file rather than a missing value. And the stub goes
   after the REAL <body …> tag — app.html's <head> comment describes one in
   prose, so the first match in the file is inside a comment and the whole stub
   would land commented out. Search after </head>. */
function mergedPage() {
  const raw = expand(read('app.html'), 0)
    .replace(/<\?!?=\s*page\s*\?>/g, 'deckbuilder')
    .replace(/<\?!?=\s*appUrl\s*\?>/g, 'https://script.google.com/macros/s/TEST/exec')
    .replace(/<\?!?=\s*appMode\s*\?>/g, 'false');
  const head = raw.indexOf('</head>');
  if (head < 0) throw new Error('app.html: no </head>');
  const tag = raw.slice(head).match(/<body[^>]*>/);
  if (!tag) throw new Error('app.html: no <body> element after </head>');
  const at = head + tag.index + tag[0].length;
  return raw.slice(0, at) + STUB + raw.slice(at);
}

const SIDES = [
  { name: 'legacy', html: () => LEGACY },
  { name: 'merged', html: mergedPage, sources: true }
];
/* every adapter the four content modules register, in the order Deck_Recipe
   asks for them. An empty list here is the §E-ordering bug this exists for. */
const WANT_SOURCES = ['cust', 'fsc', 'pv', 'rfsc', 'rmx', 'seg'];

async function run(side, browser, allFails) {
  const pg = await browser.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  const tmp = path.join(require('os').tmpdir(), 'amr_bgrender_' + side.name + '.html');
  fs.writeFileSync(tmp, side.html());
  await pg.goto('file://' + tmp, { waitUntil: 'load' });
  await pg.waitForTimeout(side.sources ? 600 : 200);

  const fails = [];
  const bad = m => fails.push(side.name + ': ' + m);

  /* The registry, on the merged side only — the synthetic legacy page includes
     no content modules, so there is nothing there to register. */
  if (side.sources) {
    const got = await pg.evaluate(() =>
      window.AmrDeckSource ? window.AmrDeckSource.list().slice().sort() : null);
    if (!got) bad('AmrDeckSource is missing from §E');
    else {
      const missing = WANT_SOURCES.filter(x => got.indexOf(x) === -1);
      if (missing.length) {
        bad('the deck sources [' + missing.join(', ') + '] did not register — §E has ' +
            'AmrDeckSource BELOW a module that registers into it, so its guard fell ' +
            'through. Registered: [' + got.join(', ') + ']');
      }
    }
  }

  const has = await pg.evaluate(() => ({
    tick: typeof window.AmrTick,
    frames: !!(window.AmrTick && window.AmrTick.frames),
    slide: typeof window.AmrSlide
  }));
  if (has.tick !== 'function') bad('AmrTick is not defined — Shell.html did not load it');
  if (!has.frames) bad('AmrTick.frames is missing — captureBare has nothing to fall back to');
  if (has.slide !== 'object') bad('AmrSlide is not defined');

  /* the timer must be the worker's, not the main thread's — a main-thread
     timer is throttled in exactly the situation this exists for */
  if (has.tick === 'function') {
    const worker = await pg.evaluate(() => {
      const h = window.AmrTick(5, function(){});
      const kind = (h && h.w != null) ? 'worker' : 'setTimeout';
      window.AmrTick.clear(h);
      return kind;
    });
    if (worker !== 'worker') bad('AmrTick fell back to setTimeout — the Worker never started');
  }

  /* THE CHECK. No frames, ever. */
  const out = await pg.evaluate(() => new Promise(resolve => {
    window.requestAnimationFrame = function(){ return 0; };   // a hidden tab
    const t0 = Date.now();
    const content = document.createElement('div');
    content.innerHTML = '<table><tr><td>a slide</td></tr></table>';
    const timer = setTimeout(() => resolve({ ok:false, ms:Date.now() - t0 }), 8000);
    AmrSlide.captureBare(content, { width:1600, height:900, capturePx:800 })
      .then(cap => { clearTimeout(timer);
        resolve({ ok:true, ms:Date.now() - t0, url:(cap && cap.dataUrl || '').slice(0, 14) }); })
      .catch(e => { clearTimeout(timer);
        resolve({ ok:false, err:String(e && e.message || e), ms:Date.now() - t0 }); });
  }));
  if (!out.ok) {
    bad('captureBare never finished with requestAnimationFrame disabled'
      + (out.err ? (' — ' + out.err) : ' (this is the background-tab hang)')
      + ' after ' + out.ms + 'ms');
  } else if (!/^data:image\/png/.test(out.url || '')) {
    bad('captureBare resolved without a PNG: ' + JSON.stringify(out));
  }

  /* and nothing is left pinned off-screen when it does */
  const leftovers = await pg.evaluate(() => document.querySelectorAll('.slide-bare').length);
  if (leftovers) bad(leftovers + ' capture frame(s) left attached to the page');

  await pg.close();
  if (errs.length) fails.unshift(side.name + ': page errors: ' + JSON.stringify(errs.slice(0, 3)));
  allFails.push.apply(allFails, fails);
}

(async () => {
  const exe = browserPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const fails = [];
  for (const side of SIDES) await run(side, browser, fails);
  await browser.close();
  if (fails.length) {
    console.error('\nbgrender: ' + fails.length + ' problem(s)\n');
    fails.forEach(f => console.error('  ✗ ' + f));
    process.exit(1);
  }
  console.log('bgrender: ok on both sides (' + SIDES.map(s => s.name).join(' + ')
    + ') — the capture finishes with no animation frames at all, on a worker-backed '
    + 'timer, and all ' + WANT_SOURCES.length + ' deck sources are registered.');
})();
