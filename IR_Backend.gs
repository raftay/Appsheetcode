/*****************************************************************************
 * INVENTORY REPORT — backend (namespaced IR)
 * ---------------------------------------------------------------------------
 * The Inventory Report page displays a PDF stored on Google Drive.
 * Which file to show is stored in Script Properties (same persistent store
 * as the data-sheet setting), so it is shared by every user of the app and
 * survives reloads/redeploys.
 *
 * NOTE: the backend deliberately does NOT touch DriveApp — the viewer's own
 * browser loads the file through Drive's /preview endpoint, so no Drive
 * OAuth scope is needed here. We only parse, store, and return the file ID
 * plus the derived URLs.
 *****************************************************************************/
var IR = (function () {

  var PROP_KEY = 'INVENTORY_REPORT_SOURCE';   // JSON: { fileId, label, savedAt }

  /* Accepts a Drive link in any common shape, or a bare file ID:
   *   https://drive.google.com/file/d/<ID>/view?usp=sharing
   *   https://drive.google.com/file/d/<ID>/preview
   *   https://drive.google.com/open?id=<ID>
   *   https://drive.google.com/uc?id=<ID>
   *   <ID>
   */
  function extractFileId_(input) {
    var s = String(input == null ? '' : input).trim();
    if (!s) return '';
    var m = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
    return '';
  }

  /* Build the UI payload from a stored record. */
  function payload_(rec) {
    return {
      configured:  true,
      fileId:      rec.fileId,
      label:       rec.label || '',
      savedAt:     rec.savedAt || '',
      previewUrl:  'https://drive.google.com/file/d/' + rec.fileId + '/preview',
      viewUrl:     'https://drive.google.com/file/d/' + rec.fileId + '/view',
      downloadUrl: 'https://drive.google.com/uc?export=download&id=' + rec.fileId
    };
  }

  function getSettings() {
    var raw = PropertiesService.getScriptProperties().getProperty(PROP_KEY) || '';
    if (!raw) return { configured: false };
    var rec;
    try { rec = JSON.parse(raw); } catch (e) { rec = null; }
    if (!rec || !rec.fileId) return { configured: false };
    return payload_(rec);
  }

  /* Save a new source (link/ID + optional display label). */
  function saveSource(input, label) {
    var id = extractFileId_(input);
    if (!id) throw new Error('That doesn\u2019t look like a Google Drive link or file ID. In Drive, right-click the PDF \u2192 Share \u2192 Copy link, and paste it here.');

    var rec = {
      fileId:  id,
      label:   String(label == null ? '' : label).trim(),
      savedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d, yyyy HH:mm')
    };
    PropertiesService.getScriptProperties().setProperty(PROP_KEY, JSON.stringify(rec));
    return payload_(rec);
  }

  return { getSettings: getSettings, saveSource: saveSource };
})();

/* ---- top-level wrappers for google.script.run ---- */
function IR_getSettings()             { return IR.getSettings(); }
function IR_saveSource(input, label)  { return IR.saveSource(input, label); }