/**
 * Facility Monitoring Tool — SpotHero complaint storage (Google Sheet in Drive).
 *
 * Stores uploaded SpotHero complaints + an upload log in THIS spreadsheet, in
 * two auto-created tabs ("Complaints" and "UploadLog"). The Facility Monitoring
 * Tool reads/writes it through this Web App, which runs as YOU — so it uses your
 * own Google Drive with no extra credentials.
 *
 * SETUP
 *  1. Create a new Google Sheet in your Drive (any name).
 *  2. Extensions → Apps Script. Delete the sample, paste this whole file.
 *  3. Set TOKEN below to the shared secret the tool will use (keep it secret).
 *  4. Deploy → New deployment → type "Web app" →
 *        Execute as: Me   |   Who has access: Anyone with the link  → Deploy.
 *  5. Copy the Web app URL (ends with /exec) and send it to the tool setup,
 *     along with the TOKEN value.
 */

var TOKEN = 'fmt-2f9c1b7a5e'; // shared secret — must match the tool's GSHEET_TOKEN

var COMPLAINT_COLS = ['rentalId', 'facilityName', 'facilityId', 'complaintType', 'complaintDate', 'source', 'resolutionStatus', 'uploadDate', 'reportingYear', 'reportingMonth', 'reportingBiweekly', 'uploadedBy', 'fileName'];
var UPLOAD_COLS = ['id', 'fileName', 'uploadDate', 'uploadedBy', 'totalRecords', 'newRecordsAdded', 'duplicateRecordsSkipped'];

function sheet_(name, cols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    // Keep everything as plain text so dates/IDs are never auto-reformatted.
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.appendRow(cols);
  }
  if (sh.getLastRow() === 0) sh.appendRow(cols);
  return sh;
}

function readAll_(name, cols) {
  var sh = sheet_(name, cols);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, cols.length).getValues();
  return values.map(function (row) {
    var o = {};
    cols.forEach(function (c, i) { o[c] = row[i]; });
    return o;
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  if (TOKEN && (!e || !e.parameter || e.parameter.token !== TOKEN)) return json_({ ok: false, error: 'unauthorized' });
  return json_({ ok: true, complaints: readAll_('Complaints', COMPLAINT_COLS), uploads: readAll_('UploadLog', UPLOAD_COLS) });
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  if (TOKEN && body.token !== TOKEN) return json_({ ok: false, error: 'unauthorized' });

  if (body.type === 'complaints') {
    var sh = sheet_('Complaints', COMPLAINT_COLS);
    var rows = (body.rows || []).map(function (r) {
      return COMPLAINT_COLS.map(function (c) { return r[c] == null ? '' : r[c]; });
    });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, COMPLAINT_COLS.length).setValues(rows);
    return json_({ ok: true, added: rows.length });
  }

  if (body.type === 'upload') {
    var su = sheet_('UploadLog', UPLOAD_COLS);
    var r = body.row || {};
    su.appendRow(UPLOAD_COLS.map(function (c) { return r[c] == null ? '' : r[c]; }));
    return json_({ ok: true });
  }

  return json_({ ok: false, error: 'unknown type' });
}
