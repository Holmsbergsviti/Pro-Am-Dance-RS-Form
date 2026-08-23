/**
 * PRONAĐI SVOJ PLES — prijem prijava sa forme u Google Sheets.
 * PROAM dance Serbia
 *
 * Postavljanje:
 *  1) Otvori Google Sheet → Extensions → Apps Script, nalepi ovaj fajl.
 *  2) Pokreni funkciju setupSheet() jednom (odobri dozvole).
 *  3) Deploy → New deployment → Web app
 *       Execute as: Me
 *       Who has access: Anyone
 *     Kopiraj URL i upiši ga u CONFIG.ENDPOINT u index.html.
 *  4) Posle svake izmene koda: Deploy → Manage deployments → Edit → New version.
 */

var SHEET_NAME = 'Leads';

/** Opciono: e-mail za obaveštenje o novoj prijavi. Ostavi '' da se ne šalje. */
var NOTIFY_EMAIL = '';

var HEADERS = [
  'Date', 'Name', 'IG', 'Email', 'Phone', 'Language',
  'Direction', 'Format', 'Level', 'Goal', 'Location', 'Time',
  'Frequency', 'Priorities', 'Source', 'Status', 'Notes'
];

var STATUSES = ['New', 'Reviewed', 'Recommendation sent', 'Connected'];

function doPost(e) {
  try {
    var data = parseBody(e);
    if (!data) return json({ ok: false, error: 'empty body' });

    var sheet = getSheet();
    var tz = Session.getScriptTimeZone() || 'Europe/Belgrade';

    sheet.appendRow([
      Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'),
      str(data.name),
      str(data.ig),
      str(data.email),
      str(data.phone),
      str(data.language),
      str(data.direction),
      str(data.format),
      str(data.level),
      str(data.goal),
      str(data.location),
      str(data.time),
      str(data.frequency),
      str(data.priorities),
      str(data.source),
      'New',
      ''
    ]);

    notify(data);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/** Provera da li je Web App živ: otvori URL u browseru. */
function doGet() {
  return json({ ok: true, service: 'Pronadji svoj ples' });
}

function parseBody(e) {
  if (!e) return null;
  // 1) JSON (fetch sa text/plain telom)
  if (e.postData && e.postData.contents) {
    try { return JSON.parse(e.postData.contents); } catch (ignore) {}
  }
  // 2) rezervni put: form POST sa poljem "payload"
  if (e.parameter && e.parameter.payload) {
    try { return JSON.parse(e.parameter.payload); } catch (ignore) {}
  }
  // 3) obična form polja
  if (e.parameter && e.parameter.name) return e.parameter;
  return null;
}

function str(v) {
  if (v === null || v === undefined) return '';
  return String(v).slice(0, 500);
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = setupSheet();
  return sheet;
}

function notify(data) {
  if (!NOTIFY_EMAIL) return;
  try {
    MailApp.sendEmail(
      NOTIFY_EMAIL,
      'Nova prijava: ' + str(data.name) + ' (' + str(data.ig) + ')',
      HEADERS.slice(1, 15).map(function (h, i) {
        var keys = ['name','ig','email','phone','language','direction','format','level','goal','location','time','frequency','priorities','source'];
        return h + ': ' + str(data[keys[i]]);
      }).join('\n')
    );
  } catch (ignore) {}
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Pokreni jednom: kreira tab, header, filter i padajuću listu za Status. */
function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold')
    .setBackground('#3B2D28')
    .setFontColor('#F1E9E1');
  sheet.setFrozenRows(1);

  var widths = [130, 140, 150, 190, 140, 80, 190, 110, 190, 220, 220, 160, 130, 220, 100, 150, 240];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);

  // telefon kao tekst — inače Sheets pojede "+" i vodeću nulu
  var phoneCol = HEADERS.indexOf('Phone') + 1;
  sheet.getRange(2, phoneCol, sheet.getMaxRows() - 1, 1).setNumberFormat('@');

  var statusCol = HEADERS.indexOf('Status') + 1;
  var range = sheet.getRange(2, statusCol, sheet.getMaxRows() - 1, 1);
  range.setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build()
  );

  var colors = ['#F6E2DC', '#FAF0D7', '#E4EEDD', '#D8E6F3'];
  var rules = STATUSES.map(function (s, i) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(s)
      .setBackground(colors[i])
      .setRanges([range])
      .build();
  });
  sheet.setConditionalFormatRules(rules);

  if (!sheet.getFilter()) sheet.getRange(1, 1, sheet.getMaxRows(), HEADERS.length).createFilter();
  return sheet;
}
