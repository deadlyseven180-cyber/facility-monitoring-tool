/**
 * Facility Monitoring Tool — database (Google Sheet in Drive), GENERIC v2.
 *
 * Sheet-agnostic storage: the tool can read/append to ANY tab by name, so new
 * data types never require re-deploying this script again. Tabs are auto-created
 * with a header row from the columns provided.
 *
 * Tabs used by the tool:
 *   • Complaints        — one row per SpotHero complaint
 *   • UploadLog         — one row per upload
 *   • SpotHeroRows      — raw SpotHero reservation rows (rental id, net remit, refund, state…)
 *   • FacilityFinancials— per-facility financial summary per upload (net remit, refunds, reservations…)
 *
 * SETUP / RE-DEPLOY
 *  1. Open the "Facility Monitoring Tool Data Base" sheet → Extensions → Apps Script.
 *  2. Replace everything with this file (TOKEN below must match the tool's GSHEET_TOKEN).
 *  3. Deploy → Manage deployments → edit the existing Web app deployment → Deploy
 *     (keeps the same /exec URL). Access must be "Anyone".
 */

var TOKEN = 'fmt-2f9c1b7a5e'; // shared secret — must match the tool's GSHEET_TOKEN

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Read a tab into an array of {header: value} objects (empty if missing). */
function readSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) return [];
  var last = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (last < 2 || lastCol < 1) return [];
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var values = sh.getRange(2, 1, last - 1, lastCol).getValues();
  return values.map(function (row) {
    var o = {};
    headers.forEach(function (h, i) { if (h !== '' && h != null) o[h] = row[i]; });
    return o;
  });
}

/** Append rows (array of objects) to a tab, creating it (with header) if new. */
function appendSheet_(name, rows, columns) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!columns || !columns.length) {
    var set = {};
    rows.forEach(function (r) { for (var k in r) set[k] = true; });
    columns = Object.keys(set);
  }
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, sh.getMaxRows(), columns.length).setNumberFormat('@'); // keep as text
    sh.appendRow(columns);
  }
  if (sh.getLastRow() === 0) sh.appendRow(columns);
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var data = rows.map(function (r) {
    return header.map(function (c) { return r[c] == null ? '' : r[c]; });
  });
  if (data.length) sh.getRange(sh.getLastRow() + 1, 1, data.length, header.length).setValues(data);
  return data.length;
}

function doGet(e) {
  if (TOKEN && (!e || !e.parameter || e.parameter.token !== TOKEN)) return json_({ ok: false, error: 'unauthorized' });
  var sheet = e && e.parameter ? e.parameter.sheet : '';
  if (sheet) return json_({ ok: true, rows: readSheet_(sheet) });
  // Back-compat + convenience: the two core tabs the tool always needs.
  return json_({ ok: true, complaints: readSheet_('Complaints'), uploads: readSheet_('UploadLog') });
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  if (TOKEN && body.token !== TOKEN) return json_({ ok: false, error: 'unauthorized' });

  // Generic: { sheet, rows:[{...}], columns?:[...] }
  if (body.sheet && Array.isArray(body.rows)) {
    var added = appendSheet_(body.sheet, body.rows, body.columns);
    return json_({ ok: true, added: added });
  }

  // Back-compat with the original protocol.
  if (body.type === 'complaints') {
    var COLS = ['rentalId', 'facilityName', 'facilityId', 'complaintType', 'complaintDate', 'source', 'resolutionStatus', 'uploadDate', 'reportingYear', 'reportingMonth', 'reportingBiweekly', 'uploadedBy', 'fileName'];
    return json_({ ok: true, added: appendSheet_('Complaints', body.rows || [], COLS) });
  }
  if (body.type === 'upload') {
    var UCOLS = ['id', 'fileName', 'uploadDate', 'uploadedBy', 'totalRecords', 'newRecordsAdded', 'duplicateRecordsSkipped'];
    return json_({ ok: true, added: appendSheet_('UploadLog', [body.row || {}], UCOLS) });
  }

  return json_({ ok: false, error: 'unknown request' });
}
