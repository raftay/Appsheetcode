/* PULLING QlikView data, SHOWING it, and telling everyone while it happens.
 *
 * The pull used to end with syncAll(), which moves every page's data version.
 * That version is the only thing that ever clears a device's saved tables —
 * they have no expiry — so moving it mid-session meant:
 *
 *   · the page you were on kept its tables, because nothing re-checks the
 *     version mid-session, so the pull looked like it had done nothing;
 *   · leaving and coming back wiped the device copy against a cold server
 *     cache, so one page load had to rebuild 50k rows. Slow, and blank when
 *     it did not make it.
 *
 * The arrangement now: the pull records what it wrote, publishes it itself,
 * and every page is dimmed while that is going on and reloads when it ends.
 * What this harness pins:
 *
 *   RECORDED BEFORE PUBLISHED    a publish that throws leaves the note behind
 *   PUBLISHED PER PAGE           an AGG pull does not invalidate Ready-Mix
 *   HONEST WHEN IT FAILS         the page stays waiting, ok:false
 *   VISIBLE WHILE IT RUNS        a scrim on every page, from a polled flag
 *   THE FLAG CAN EXPIRE          a killed run must not dim the suite forever
 *   NO WAY PAST THE PROMPT       when it does appear, it is answered
 *
 * The Shell.html half is static checks, in the spirit of deckstatic.js: jsdom
 * is not vendored, so nothing here renders. They prove the wiring, not the
 * look — that still wants a real browser.
 *
 *   node tests/publish.js
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.resolve(__dirname, '..');

let fails = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) console.log(`         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`);
}
function checkThat(name, ok, detail) {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok && detail !== undefined) console.log(`         ${detail}`);
}

/* ======================================================================
 * Enough of the world for Code.gs + QlikSync.gs. The page backends are
 * stubbed at their generation-bumping edge, which is all publishing touches.
 * ==================================================================== */
function load({ pvThrows = false } = {}) {
  const PROPS = {};
  const bumped = [];

  const ctx = {
    JSON, Math, Object, Array, String, Number, RegExp, Error, Date, isNaN, parseInt, parseFloat,
    console: { log: () => {}, error: () => {}, warn: () => {} },
    Logger: { log: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in PROPS ? PROPS[k] : null),
        setProperty: (k, v) => { PROPS[k] = String(v); },
        deleteProperty: k => { delete PROPS[k]; },
      }),
    },
    CacheService: { getScriptCache: () => ({ get: () => null, getAll: () => ({}),
      put: () => {}, putAll: () => {}, remove: () => {}, removeAll: () => {} }) },
    SpreadsheetApp: { openById: () => ({ getSheets: () => [], getSheetByName: () => null }), flush: () => {} },
    Session: { getScriptTimeZone: () => 'America/Toronto' },
    Utilities: { formatDate: d => String(d) },
    ScriptApp: { getOAuthToken: () => 'tok' },
    UrlFetchApp: { fetch: () => { throw new Error('unused'); } },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    DriveApp: { getFolderById: () => ({ getFiles: () => ({ hasNext: () => false }) }),
                getFileById: () => ({ setTrashed: () => {} }) },
    MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
    _props: PROPS,
    _bumped: bumped,
  };
  ctx.global = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(`${REPO}/Config.gs`, 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(`${REPO}/Code.gs`, 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(`${REPO}/QlikSync.gs`, 'utf8'), ctx);

  /* The two page backends, at the only edge publishing uses. */
  ctx.PV = {
    clearCache: () => {
      if (pvThrows) throw new Error('PV is having a bad day');
      bumped.push('pricevolume'); ctx.APP_bumpGen_('pricevolume');
    },
  };
  ctx.RMX_NS = { bumpGeneration: () => { bumped.push('rmx'); ctx.APP_bumpGen_('rmx'); } };
  return ctx;
}

const gens = ctx => ['pricevolume', 'rmx', 'segment'].map(p => ctx.APP_getGen_(p));

/* ======================================================================
 * 1. A pull leaves every version exactly where it was
 * ==================================================================== */
console.log('pulling data does not publish it:');
{
  const ctx = load();
  const before = gens(ctx);

  /* Reach the recorder the way run() does, without a Drive folder to read. */
  ctx.eval = null;
  vm.runInContext(`
    var __probe = (function(){
      var P = PropertiesService.getScriptProperties();
      P.setProperty('QLIK_PENDING_UPDATE', JSON.stringify({
        since: new Date().toISOString(), at: new Date().toISOString(),
        pages: ['pricevolume'], files: ['AGG: export.xlsx']
      }));
      return true;
    })();
  `, ctx);

  check('no generation moved', gens(ctx), before);
  check('nothing was bumped', ctx._bumped, []);

  const p = ctx.getQlikPending();
  check('but the site knows something is waiting', p.pending, true);
  check('and which page it is for', p.pages, ['pricevolume']);
  check('by its proper name', p.labels, ['Price & Volume Analysis']);
}

/* ======================================================================
 * 2. Successive pulls accumulate
 * ==================================================================== */
console.log('\ntwo pulls before anyone publishes leave both waiting:');
{
  const ctx = load();
  vm.runInContext(`QLIKSYNC.__t = null;`, ctx);

  /* markPending_ is private; drive it through the property the same way two
     runs would, then assert the merge rule via getQlikPending. */
  const P = ctx.PropertiesService.getScriptProperties();
  P.setProperty('QLIK_PENDING_UPDATE', JSON.stringify({
    since: '2026-08-14T13:00:00.000Z', at: '2026-08-14T13:00:00.000Z',
    pages: ['pricevolume'], files: [],
  }));
  const first = ctx.getQlikPending().since;

  P.setProperty('QLIK_PENDING_UPDATE', JSON.stringify({
    since: first, at: '2026-08-14T14:00:00.000Z',
    pages: ['pricevolume', 'rmx'], files: [],
  }));

  const p = ctx.getQlikPending();
  check('both pages are listed', p.pages, ['pricevolume', 'rmx']);
  check('the FIRST pull is when this started', p.since, '2026-08-14T13:00:00.000Z');
  checkThat('and the latest is recorded too', p.at > p.since, `${p.at} vs ${p.since}`);
}

/* ======================================================================
 * 3. Publishing moves the versions — and only the ones that were waiting
 * ==================================================================== */
console.log('\npublishing takes the new data:');
{
  const ctx = load();
  ctx.PropertiesService.getScriptProperties().setProperty('QLIK_PENDING_UPDATE',
    JSON.stringify({ since: 'x', at: 'x', pages: ['pricevolume'], files: [] }));

  const segBefore = ctx.APP_getGen_('segment');
  const pvBefore  = ctx.APP_getGen_('pricevolume');

  const res = ctx.publishQlikData();
  check('it reports success', res.ok, true);
  check('it published the waiting page', res.published, ['pricevolume']);
  checkThat('that page\'s version moved', ctx.APP_getGen_('pricevolume') !== pvBefore,
    `${pvBefore} -> ${ctx.APP_getGen_('pricevolume')}`);
  check('a page nobody pulled is left alone', ctx.APP_getGen_('segment'), segBefore);
  check('and it is no longer waiting', ctx.getQlikPending().pending, false);
}

console.log('\npublishing twice does not move anything the second time:');
{
  const ctx = load();
  ctx.PropertiesService.getScriptProperties().setProperty('QLIK_PENDING_UPDATE',
    JSON.stringify({ since: 'x', at: 'x', pages: ['rmx'], files: [] }));
  ctx.publishQlikData();
  const after = gens(ctx);
  const again = ctx.publishQlikData();

  check('the second call is a no-op', again.published, []);
  check('it says so plainly', /nothing waiting|nothing was waiting/i.test(again.note || ''), true);
  check('no version moved again', gens(ctx), after);
}

/* ======================================================================
 * 4. A page that could not be published stays waiting
 * ==================================================================== */
console.log('\na page whose bump fails is not quietly forgotten:');
{
  const ctx = load({ pvThrows: true });
  ctx.PropertiesService.getScriptProperties().setProperty('QLIK_PENDING_UPDATE',
    JSON.stringify({ since: 'x', at: 'x', pages: ['pricevolume', 'rmx'], files: [] }));

  const res = ctx.publishQlikData();
  check('it does not claim success', res.ok, false);
  check('it published the one that worked', res.published, ['rmx']);
  check('and names the one that did not', res.stillWaiting, ['pricevolume']);
  checkThat('the pending note survives for a retry', ctx.getQlikPending().pending, true);
}

/* ======================================================================
 * 5. The page-open call carries the answer
 * ==================================================================== */
console.log('\nfinding out costs no extra round trip:');
{
  const ctx = load();
  const clean = ctx.getDataVersion('pricevolume');
  check('a normal open says nothing is waiting', clean.pendingUpdate.pending, false);
  checkThat('and still carries the generation', !!clean.generation, clean.generation);

  ctx.PropertiesService.getScriptProperties().setProperty('QLIK_PENDING_UPDATE',
    JSON.stringify({ since: 'x', at: 'x', pages: ['rmx'], files: [] }));

  check('an open after a pull says so', ctx.getDataVersion('rmx').pendingUpdate.pending, true);
  check('the multi-page call too', ctx.getDataVersions(['pricevolume', 'rmx']).pendingUpdate.pending, true);
}

/* ======================================================================
 * 6. syncAll still exists and still does the whole thing
 * ==================================================================== */
console.log('\nthe old all-at-once path is untouched:');
{
  const ctx = load();
  const before = gens(ctx);
  ctx.syncAll();
  const after = gens(ctx);
  checkThat('syncAll still moves every page', after.every((g, i) => g !== before[i]),
    `${before} -> ${after}`);
}

/* ======================================================================
 * 7. The pull no longer calls it
 * ==================================================================== */
console.log('\nthe pull is wired to the recorder, not to syncAll:');
{
  const src = fs.readFileSync(`${REPO}/QlikSync.gs`, 'utf8');
  const runBody = src.slice(src.indexOf('function run(scope)'), src.indexOf('return { run: run'));
  checkThat('run() does not publish', !/syncAll\(\)/.test(runBody),
    'syncAll() is back inside run()');
  checkThat('run() records what is waiting instead', /markPending_\(/.test(runBody));
  checkThat('and reports it to the caller', /awaitingPublish/.test(runBody));

  const shell = fs.readFileSync(`${REPO}/Shell.html`, 'utf8');
  checkThat('the pull button no longer reloads on a timer',
    !/location\.reload\(\);\s*\},\s*600\)/.test(shell),
    'the blind 600ms reload is back in AmrQlik');
  checkThat('it reloads on what the publish actually returned',
    /\(res\.published \|\| \[\]\)\.length/.test(shell));
}

/* ======================================================================
 * 8. One job's popover body cannot be stolen by another
 * ==================================================================== */
console.log('\na shared module cannot take the popover away from a page:');
{
  const shell = fs.readFileSync(`${REPO}/Shell.html`, 'utf8');
  /* detail() was one page-wide registration, so the last caller won and the
     Overview's month history lost its body to whatever registered after it. */
  checkThat('AmrProgress keys detail bodies by job', /details\[j\.key\]/.test(shell));
  checkThat('a job\'s own body wins over the page fallback',
    /details\[j\.key\] \|\| detail/.test(shell));
  checkThat('the single-argument form still works for a page',
    /typeof a === 'string'/.test(shell));
  checkThat('and clearing a job takes its body with it',
    /delete details\[key\]/.test(shell));

  /* Page_Overview registers the fallback form; it must keep working. */
  const ov = fs.readFileSync(`${REPO}/Page_Overview.html`, 'utf8');
  checkThat('the Overview still registers its month history',
    /AmrProgress\.detail\(\{/.test(ov));
}

/* ======================================================================
 * 9. The pull publishes itself, and everyone is told while it runs
 * ==================================================================== */
console.log('\nthe pull runs the update-from-source itself:');
{
  const ctx = load();
  const before = ctx.APP_getGen_('pricevolume');

  /* run() calls APP_publishPages_ directly; drive that seam. */
  const did = ctx.APP_publishPages_(['pricevolume']);
  check('the pages it wrote get published', did, ['pricevolume']);
  checkThat('the version moved without anyone clicking',
    ctx.APP_getGen_('pricevolume') !== before);

  const src = fs.readFileSync(`${REPO}/QlikSync.gs`, 'utf8');
  const runBody = src.slice(src.indexOf('function run(scope)'), src.indexOf('return { run: run'));
  checkThat('run() publishes what it touched', /APP_publishPages_\(pages\)/.test(runBody));
  checkThat('...after recording it as pending, not before',
    runBody.indexOf('markPending_(') < runBody.indexOf('APP_publishPages_('));
  checkThat('...and only forgets it once it went through',
    /published\.length === pages\.length\) clearPending\(\)/.test(runBody));
  checkThat('awaitingPublish now means the publish FAILED',
    /awaitingPublish: pages\.length > 0 && published\.length < pages\.length/.test(runBody));
}

console.log('\na running pull is visible to every page:');
{
  const ctx = load();
  const P = ctx.PropertiesService.getScriptProperties();

  check('nothing running to begin with', ctx.getQlikStatus('rmx').running, false);

  P.setProperty('QLIK_SYNC_RUNNING', JSON.stringify({ since: new Date().toISOString(), scope: 'all' }));
  const live = ctx.getQlikStatus('rmx');
  check('a pull in flight is reported', live.running, true);
  check('with the scope', live.scope, 'all');
  checkThat('and the generation, so a poll can see the data move', !!live.generation);

  /* A run killed at the runtime limit never reaches its finally, so the flag
     would otherwise dim every page in the suite forever. */
  const old = new Date(Date.now() - 30 * 60000).toISOString();
  P.setProperty('QLIK_SYNC_RUNNING', JSON.stringify({ since: old, scope: 'all' }));
  check('a flag left behind by a killed run expires', ctx.getQlikStatus('rmx').running, false);
  checkThat('and is cleaned up', !P.getProperty('QLIK_SYNC_RUNNING'),
    P.getProperty('QLIK_SYNC_RUNNING'));

  P.setProperty('QLIK_SYNC_RUNNING', JSON.stringify({ since: 'not a date', scope: 'all' }));
  check('so does a corrupt one', ctx.getQlikStatus('rmx').running, false);
}

/* ======================================================================
 * 10. The screen says so, everywhere, and there is no way past the prompt
 * ==================================================================== */
console.log('\nevery page dims while a pull is running:');
{
  const shell = fs.readFileSync(`${REPO}/Shell.html`, 'utf8');

  checkThat('there is a scrim in the shell every page includes',
    /id="amrScrim"/.test(shell));
  checkThat('it blurs what is behind it', /backdrop-filter:blur/.test(shell));
  checkThat('it carries no dismiss control',
    !/id="amrScrim"[\s\S]{0,600}data-close/.test(shell));
  checkThat('a watcher polls for it', /AmrSyncWatch/.test(shell));
  checkThat('the pull raises it immediately rather than waiting for a poll',
    /AmrSyncWatch\.hold\(/.test(shell));

  const watch = shell.slice(shell.indexOf('window.AmrSyncWatch = (function'),
                            shell.indexOf('window.AmrUpdate = (function'));
  checkThat('polling stops while the tab is hidden', /document\.hidden/.test(watch), watch.slice(0, 200));
  checkThat('it polls faster while a pull is in flight', /BUSY\s*=\s*\d+/.test(watch));
  checkThat('a finished pull reloads the page into the new figures',
    /location\.reload\(\)/.test(watch));
  checkThat('a moved generation does too, even if we missed the run',
    /st\.generation !== gen/.test(watch));
  checkThat('a failed poll does not put the scrim up', /withFailureHandler/.test(watch));
}

console.log('\narriving on a page with data waiting is forced too:');
{
  const shell = fs.readFileSync(`${REPO}/Shell.html`, 'utf8');
  const boot = shell.slice(shell.indexOf('boot: function(done)'), shell.indexOf('get: function(key)'));
  checkThat('page open forces the prompt', /AmrUpdate\.require\(/.test(boot), boot);
  checkThat('it is not merely offered', !/AmrUpdate\.offer\(/.test(shell),
    'the optional pill path is back');
  checkThat('the watcher forces it as well, not just the first load',
    /st\.pending && window\.AmrUpdate[\s\S]{0,160}AmrUpdate\.require\(/.test(shell));

  /* The modal still has to be inescapable. */
  checkThat('the modal is marked locked', /id="amrQlikModal"[^>]*data-locked/.test(shell));
  checkThat('click-outside skips locked modals',
    /querySelectorAll\('\.amr-modal:not\(\[data-locked\]\)'\)/.test(shell));
  const escAt = shell.indexOf("if(e.key==='Escape')");
  checkThat('Escape skips them too',
    /:not\(\[data-locked\]\)/.test(shell.slice(escAt, escAt + 220)));
  const card = shell.slice(shell.indexOf('id="amrQlikModal"'), shell.indexOf('id="amrQlikModal"') + 700);
  checkThat('the card has no close button', !/amr-x/.test(card), card);

  const render = shell.slice(shell.indexOf('function render()'), shell.indexOf('function finish('));
  const actsInRender = [...new Set(render.match(/act:'[a-z]+'/g) || [])];
  check('the forced prompt offers only publishing', actsInRender, ["act:'publish'"]);
  checkThat('with no Later', !/'later'/.test(render), render);

  const pf = shell.slice(shell.indexOf('function publishFailed('), shell.indexOf('function act('));
  checkThat('a failed publish offers a retry', /act:'publish'/.test(pf), pf);
  checkThat('...and does not trap the tab', /act:'close'/.test(pf), pf);
}

console.log(fails ? `\n${fails} failing check(s)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
