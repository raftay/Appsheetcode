/*****************************************************************************
 * TP01-ZIPR Transfer Price Tool — backend
 * ---------------------------------------------------------------------------
 * Three small functions:
 *   TP_sendMarketEmail  : the page builds the per-market Excel in the browser
 *                         (SheetJS, base64) and sends it here to be mailed.
 *   TP_getRecipients    : the shared market → email map (see below).
 *   TP_saveRecipient    : save/update one market's recipient in that map.
 *
 * SENDER IDENTITY: mail goes out as whoever the web app EXECUTES AS, and
 * appsscript.json pins that to "executeAs": "USER_DEPLOYING" - so every
 * TP01 email is sent by the account that DEPLOYED the app.
 *
 * That also makes getUserProperties() the deployer's for everybody, so the
 * market -> email map below is ONE shared list: editing a market's recipient
 * changes it for everyone.
 *****************************************************************************/

var TP_RECIP_KEY = 'TP01_RECIPIENTS';

function TP_getRecipients() {
  try {
    var raw = PropertiesService.getUserProperties().getProperty(TP_RECIP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

function TP_saveRecipient(market, email) {
  var props = PropertiesService.getUserProperties();
  var map;
  try { map = JSON.parse(props.getProperty(TP_RECIP_KEY) || '{}'); } catch (e) { map = {}; }
  market = String(market || '').trim();
  email  = String(email  || '').trim();
  if (!market) throw new Error('Missing market name.');
  if (email) map[market] = email;
  else       delete map[market];          // cleared box = forget it
  props.setProperty(TP_RECIP_KEY, JSON.stringify(map));
  return { ok: true };
}

function TP_sendMarketEmail(o) {
  if (!o || !o.to || !o.xlsxB64) throw new Error('Missing recipient or file.');
  var blob = Utilities.newBlob(
    Utilities.base64Decode(o.xlsxB64),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    o.filename || 'Transfer_Price_Report.xlsx'
  );
  MailApp.sendEmail({
    to: String(o.to),
    subject: String(o.subject || 'Transfer Price Report'),
    htmlBody: String(o.htmlBody || ''),
    attachments: [blob]
  });
  return { ok: true };
}

function TP_sendCombinedEmail(o) {
  if (!o || !o.to || !o.files || !o.files.length) throw new Error('Missing recipient or files.');
  var mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  var blobs = o.files.map(function (f) {
    return Utilities.newBlob(Utilities.base64Decode(f.xlsxB64), mime,
                             f.filename || 'Transfer_Price_Report.xlsx');
  });
  MailApp.sendEmail({
    to: String(o.to),
    subject: String(o.subject || 'Transfer Price Report'),
    htmlBody: String(o.htmlBody || ''),
    attachments: blobs
  });
  return { ok: true };
}