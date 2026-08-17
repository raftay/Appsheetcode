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
   the real one does too — the question is only whether anything ever calls it. */
const PAGE = `<!doctype html><html><body>
<script>
window.html2canvas = function(){
  return new Promise(function(res){
    setTimeout(function(){
      res({ width:800, height:450, toDataURL:function(){ return 'data:image/png;base64,AA'; } });
    }, 10);
  });
};
</script>
${expand(read('SlideExport.html'), 0)}
${expand(read('Shell.html'), 0)}
</body></html>`;

(async () => {
  const exe = browserPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const pg = await browser.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  const tmp = path.join(require('os').tmpdir(), 'amr_bgrender.html');
  fs.writeFileSync(tmp, PAGE);
  await pg.goto('file://' + tmp, { waitUntil: 'load' });
  await pg.waitForTimeout(200);

  const fails = [];
  const bad = m => fails.push(m);

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

  await browser.close();
  if (errs.length) fails.unshift('page errors: ' + JSON.stringify(errs.slice(0, 3)));
  if (fails.length) {
    console.error('\nbgrender: ' + fails.length + ' problem(s)\n');
    fails.forEach(f => console.error('  ✗ ' + f));
    process.exit(1);
  }
  console.log('bgrender: ok — the capture finishes with no animation frames at all, '
    + 'on a worker-backed timer.');
})();
