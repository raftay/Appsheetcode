/*****************************************************************************
 * AMRIZE KPI WORKBOOKS — shared backend
 * ---------------------------------------------------------------------------
 * The two EBITDA workbooks (main "AGG & RMX EBITDA Report" + the
 * "Manitoba / Saskatchewan" one) feed the SAP/USGAAP KPI cards on the
 * Price & Volume, Product Segment and Overview pages.
 *
 * They used to live on each person's own device, so everybody had to
 * upload them separately. Now:
 *
 *   • the uploader's BROWSER parses the workbook and sends only the small
 *     set of numbers behind the cards (a few KB) — never the file contents;
 *   • those numbers are saved as ONE json file in the shared Drive folder,
 *     so every user on every device sees the same thing;
 *   • the raw .xlsx is archived beside it, purely so anyone can open Drive
 *     and see / download exactly which file is in use;
 *   • the numbers are cached on the server and on each device, keyed by a
 *     data version — the same pattern the report tables use. Uploading
 *     bumps the version, which instantly strands every old copy.
 *
 * ONE-TIME SETUP: Config.gs -> APP_CONFIG.KPI_FOLDER_ID must hold the id of
 * a Drive folder shared with the team as Editor.
 *****************************************************************************/
var KPI = (function () {

  var PK_JSON = 'KPI_VALUES_FILE';                    // Drive id of the values json
  var PK_FILE = { main: 'KPI_XLSX_MAIN', mbsk: 'KPI_XLSX_MBSK' };
  var FILE_LABEL = { main: 'AGG & RMX EBITDA Report', mbsk: 'Manitoba Saskatchewan' };

  function folder_() {
    var id = APP_CONFIG.KPI_FOLDER_ID;
    if (!id) throw new Error('The shared KPI folder isn\u2019t set up yet. Paste the folder id into ' +
      'Config.gs \u2192 KPI_FOLDER_ID.');
    try { return DriveApp.getFolderById(id); }
    catch (e) { throw new Error('Couldn\u2019t open the shared KPI folder. Check KPI_FOLDER_ID in ' +
      'Config.gs, and that the folder is shared with you.'); }
  }

  function trash_(id) { if (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} } }

  /* ok:false means the file EXISTS but this account couldn't read it
     (folder not shared with them) — treated differently from "nothing
     uploaded", and never cached. */
  function readValues_() {
    var id = PropertiesService.getScriptProperties().getProperty(PK_JSON);
    if (!id) return { values: null, ok: true };
    try { return { values: JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString()), ok: true }; }
    catch (e) { return { values: null, ok: false, err: (e && e.message ? e.message : String(e)) }; }
  }

  function writeValues_(values) {
    var props = PropertiesService.getScriptProperties();
    var f = folder_().createFile('KPI card values.json', JSON.stringify(values), 'application/json');
    trash_(props.getProperty(PK_JSON));
    props.setProperty(PK_JSON, f.getId());
  }

  /* read -> change -> write, all inside one lock, so two people replacing
     DIFFERENT workbooks at the same time can't overwrite each other. */
  function mutate_(fn) {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var r = readValues_();
      if (!r.ok) throw new Error('The shared KPI file couldn\u2019t be opened (' + r.err +
        '). Check that the shared folder is shared with you, then try again.');
      var values = r.values || {};
      fn(values);
      writeValues_(values);
      return values;
    } finally { lock.releaseLock(); }
  }

  /* ---------- what the pages call ---------- */

  /* knownGen = the version this device already holds. When it matches, the
     answer is 4 bytes instead of the whole payload. */
  function getKpiValues(knownGen) {
    var gen = APP_getGen_('kpi');
    if (knownGen && String(knownGen) === String(gen)) return { generation: gen, cached: true };

    var key = 'kpi|g' + gen + '|values';
    var hit = APP_cacheGet_(key);
    if (hit) return { generation: gen, values: hit.values };

    var r = readValues_();
    if (r.ok) APP_cachePut_(key, { values: r.values });   // never cache a failed read
    var out = { generation: gen, values: r.values };
    if (!r.ok) out.problem = 'The shared KPI numbers couldn\u2019t be opened for this account (' +
      r.err + ') \u2014 ask for access to the shared Drive folder.';
    return out;
  }

  /* Replace ONE workbook's slice of the numbers. The other book is left
     exactly as it was, so people can update either file on its own. */
  function saveKpiBook(book, sliceJson) {
    if (book !== 'main' && book !== 'mbsk') throw new Error('Unknown workbook \u201c' + book + '\u201d.');
    var slice;
    try { slice = JSON.parse(sliceJson); } catch (e) { slice = null; }
    if (!slice || !slice.plant || !slice.rmx)
      throw new Error('The workbook arrived incomplete \u2014 please try the upload again.');
    try { slice.by = Session.getActiveUser().getEmail() || ''; } catch (e) { slice.by = ''; }

    var values = mutate_(function (v) { v[book] = slice; });
    var gen = APP_bumpGen_('kpi');
    APP_cachePut_('kpi|g' + gen + '|values', { values: values });
    return { generation: gen, values: values };
  }

  /* Keep the actual .xlsx in the folder so anyone can see what is in use.
     Best effort: the cards already work without it. */
  function archiveKpiFile(book, fileName, b64) {
    if (book !== 'main' && book !== 'mbsk') return false;
    var bytes = Utilities.base64Decode(b64);
    var name = 'KPI \u2014 ' + FILE_LABEL[book] + ' (in use).xlsx';
    var blob = Utilities.newBlob(bytes,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name);
    var props = PropertiesService.getScriptProperties();
    var f = folder_().createFile(blob);
    trash_(props.getProperty(PK_FILE[book]));
    props.setProperty(PK_FILE[book], f.getId());
    return true;
  }

  /* Remove one workbook for everyone. */
  function clearKpiBook(book) {
    if (book !== 'main' && book !== 'mbsk') throw new Error('Unknown workbook \u201c' + book + '\u201d.');
    var values = mutate_(function (v) { delete v[book]; });
    var props = PropertiesService.getScriptProperties();
    trash_(props.getProperty(PK_FILE[book]));
    props.deleteProperty(PK_FILE[book]);
    var gen = APP_bumpGen_('kpi');
    APP_cachePut_('kpi|g' + gen + '|values', { values: values });
    return { generation: gen, values: values };
  }

  return { getKpiValues: getKpiValues, saveKpiBook: saveKpiBook,
           archiveKpiFile: archiveKpiFile, clearKpiBook: clearKpiBook };
})();

/* Top-level wrappers the pages call via google.script.run. */
function getKpiValues(knownGen) {
  try {
    var out = KPI.getKpiValues(knownGen);
    console.log('[KPI] getKpiValues: gen ' + out.generation + (out.cached ? ' \u00b7 unchanged' : ' \u00b7 sent'));
    return out;
  } catch (err) {
    console.error('[KPI] getKpiValues failed: ' + (err && err.message ? err.message : err));
    throw err;
  }
}
function saveKpiBook(book, sliceJson) {
  try {
    console.log('[KPI] saveKpiBook: ' + book + ' \u00b7 ' + (sliceJson ? sliceJson.length : 0) + ' chars');
    var out = KPI.saveKpiBook(book, sliceJson);
    console.log('[KPI] saveKpiBook: shared with everyone \u00b7 gen ' + out.generation);
    return out;
  } catch (err) {
    console.error('[KPI] saveKpiBook failed: ' + (err && err.message ? err.message : err));
    throw err;
  }
}
function archiveKpiFile(book, fileName, b64) {
  try {
    var ok = KPI.archiveKpiFile(book, fileName, b64);
    console.log('[KPI] archiveKpiFile: ' + book + ' stored in the shared folder');
    return ok;
  } catch (err) {
    console.error('[KPI] archiveKpiFile failed: ' + (err && err.message ? err.message : err));
    throw err;
  }
}
function clearKpiBook(book) {
  try {
    var out = KPI.clearKpiBook(book);
    console.log('[KPI] clearKpiBook: ' + book + ' removed for everyone \u00b7 gen ' + out.generation);
    return out;
  } catch (err) {
    console.error('[KPI] clearKpiBook failed: ' + (err && err.message ? err.message : err));
    throw err;
  }
}