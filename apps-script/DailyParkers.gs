/**
 * YSR — Daily Parkers feed.
 * Gathers SpotHero confirmations ("SH Daily Parkers") and cancellations
 * ("SH Daily Parkers/Cancelled Bookings") from Gmail and serves them as JSON
 * for the All-in-One Tool's Daily Parkers tab.
 *
 * ONE-TIME SETUP
 *   1. script.google.com → New project → paste this whole file → Save.
 *   2. Run the function `setup` once → click "Review permissions" → Allow.
 *      (This stores the data sheet and installs a 10-minute auto-refresh.)
 *   3. Deploy → New deployment → type "Web app"
 *        Execute as: Me   |   Who has access: Anyone
 *      → Deploy → copy the Web app URL (ends in /exec).
 *   4. Paste that URL into the app's Daily Parkers tab.
 *
 * Optional privacy: set KEY below to any password and append "?key=YOURPASS"
 * to the URL you paste into the app.
 */

var LABEL_PARKERS = "SH Daily Parkers";
var LABEL_CANCELLED = "SH Daily Parkers/Cancelled Bookings";
var WINDOW_DAYS = 60;
var SHEET_NAME = "YSR Daily Parkers DB";
var KEY = ""; // optional shared secret; leave "" for none
var HEADER = [
  "reservationId", "facility", "bookingDate", "start", "end",
  "startMs", "endMs", "msgId",
];

function setup() {
  getSheet_("Parkers");
  getSheet_("Cancelled");
  var has = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === "refresh";
  });
  if (!has) {
    ScriptApp.newTrigger("refresh").timeBased().everyMinutes(10).create();
  }
  refresh();
}

function refresh() {
  syncLabel_(LABEL_PARKERS, "Parkers");
  syncLabel_(LABEL_CANCELLED, "Cancelled");
}

function doGet(e) {
  if (KEY && (!e || !e.parameter || e.parameter.key !== KEY)) {
    return json_({ error: "unauthorized" });
  }
  return json_({
    updatedAt: new Date().toISOString(),
    parkers: read_("Parkers"),
    cancelled: read_("Cancelled"),
  });
}

/* ----------------------------- internals ----------------------------- */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function getSheet_(tab) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("SSID");
  var ss = null;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (err) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(SHEET_NAME);
    props.setProperty("SSID", ss.getId());
  }
  var sh = ss.getSheetByName(tab);
  if (!sh) {
    sh = ss.insertSheet(tab);
    sh.appendRow(HEADER);
  }
  return sh;
}

function stripWd_(s) {
  return String(s).replace(/^\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s*/i, "").trim();
}

function parse_(body, dateObj) {
  var clean = String(body).replace(/\*/g, "").replace(/ /g, " ").replace(/\r/g, " ");
  var id = clean.match(/Rental ID#?:\s*(\d+)/i);
  if (!id) return null;
  var fac = clean.match(/reservation for\s+([\s\S]+?)\s+(?:is confirmed|has been cancel)/i);
  var start = clean.match(/Reservation Start:\s*([^\n*<]+?)(?:\s{2,}|\n|Reservation End|License|Rate|Phone|Total|$)/i);
  var end = clean.match(/Reservation End:\s*([^\n*<]+?)(?:\s{2,}|\n|License|Rate|Phone|Total|$)/i);
  var sR = start ? start[1].trim() : "";
  var eR = end ? end[1].trim() : "";
  return {
    reservationId: id[1],
    facility: fac ? fac[1].replace(/\s+/g, " ").trim() : "",
    bookingDate: dateObj.toISOString(),
    start: sR,
    end: eR,
    startMs: Date.parse(stripWd_(sR)) || "",
    endMs: Date.parse(stripWd_(eR)) || "",
  };
}

function syncLabel_(labelName, tab) {
  var sh = getSheet_(tab);
  var existing = sh.getDataRange().getValues();
  existing.shift(); // header
  var seen = {};
  existing.forEach(function (r) { seen[r[7]] = true; });

  var threads = GmailApp.search('label:"' + labelName + '" newer_than:' + WINDOW_DAYS + "d", 0, 300);
  var rows = [];
  threads.forEach(function (th) {
    th.getMessages().forEach(function (m) {
      var id = m.getId();
      if (seen[id]) return;
      seen[id] = true;
      var rec = parse_(m.getPlainBody(), m.getDate());
      if (rec) {
        rows.push([rec.reservationId, rec.facility, rec.bookingDate, rec.start, rec.end, rec.startMs, rec.endMs, id]);
      }
    });
  });
  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADER.length).setValues(rows);
  }
  pruneDedupe_(sh);
}

function pruneDedupe_(sh) {
  var data = sh.getDataRange().getValues();
  data.shift();
  var now = Date.now();
  var lo = now - 86400000;
  var hi = now + WINDOW_DAYS * 86400000;
  var byId = {};
  data.forEach(function (r) {
    var prev = byId[r[0]];
    if (!prev || String(r[2]) > String(prev[2])) byId[r[0]] = r;
  });
  var kept = [];
  Object.keys(byId).forEach(function (k) {
    var r = byId[k];
    var sMs = Number(r[5]);
    var eMs = Number(r[6]);
    if (!sMs && !eMs) { kept.push(r); return; }
    var e = eMs || sMs;
    var s = sMs || eMs;
    if (e >= lo && s <= hi) kept.push(r);
  });
  kept.sort(function (a, b) {
    return (Number(a[5]) || Infinity) - (Number(b[5]) || Infinity);
  });
  sh.clearContents();
  sh.appendRow(HEADER);
  if (kept.length) {
    sh.getRange(2, 1, kept.length, HEADER.length).setValues(kept);
  }
}

function read_(tab) {
  var data = getSheet_(tab).getDataRange().getValues();
  data.shift();
  return data.map(function (r) {
    return {
      reservationId: String(r[0]),
      facility: r[1],
      bookingDate: r[2],
      start: r[3],
      end: r[4],
    };
  });
}
