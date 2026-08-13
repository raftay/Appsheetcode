/*****************************************************************************
 * TP01-ZIPR Transfer Price Tool — backend
 * ---------------------------------------------------------------------------
 * Three small functions:
 *   TP_sendMarketEmail  : the page builds the per-market Excel in the browser
 *                         (SheetJS, base64) and sends it here to be mailed.
 *   TP_getRecipients    : market → email map for the CURRENT user.
 *   TP_saveRecipient    : save/update one market's recipient for that user.
 *
 * Recipients live in USER Properties, so each person keeps their own list
 * (unlike the suite's sheet settings, which use shared Script Properties).
 *
 * SENDER IDENTITY: mail goes out as whoever the web app EXECUTES AS.
 * On the main deployment (execute as: Me) that is the owner. To send as the
 * person using the tool, serve ?page=tp01 from a second deployment set to
 * "Execute as: User accessing the web app". Note: with execute-as-Me, User
 * Properties are the OWNER's too — everyone would share one recipient list.
 * With execute-as-user, each person gets their own list, which is the intent.
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