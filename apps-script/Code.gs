/**
 * PRONAĐI SVOJ PLES — prijem prijava sa forme u Google Sheets.
 * PROAM dance Serbia
 *
 * Postavljanje:
 *  1) Google Sheet → Extensions → Apps Script, nalepi ovaj fajl.
 *  2) Upiši svoj e-mail u NOTIFY_EMAIL (dole) da stižu obaveštenja.
 *  3) Pokreni funkciju setupSheet() jednom (odobri dozvole).
 *  4) Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 *  5) Posle SVAKE izmene ovog fajla: Deploy → Manage deployments → ✏️ → New version.
 */

/* ============ PODEŠAVANJA ============ */

/** Adresa na koju stiže obaveštenje o svakoj novoj prijavi. Prazno = bez mejlova.
 *  Može i više adresa, odvojene zarezom: 'ana@gmail.com, marko@gmail.com' */
var NOTIFY_EMAIL = '';

/** Telegram obaveštenja. Kako se dobija token i chat id — vidi README, sekcija Telegram.
 *  Ostavi prazno ako ne koristiš Telegram. */
var TELEGRAM_TOKEN = '';      // npr. '7812345678:AAH...'
/** Jedan ili više primalaca, odvojeni zarezom:
 *  '123456789'                  — jedna osoba
 *  '123456789, 987654321'       — dve osobe, svaka dobija svoju poruku
 *  '-1002345678901'             — grupa (svi u njoj vide prijave)
 *  Svaki primalac mora prvo sam da napiše botu, inače Telegram ne dozvoljava slanje. */
var TELEGRAM_CHAT  = '';

/** Jezik tabele: 'sr' (Datum, Ime, Ples…) ili 'en' (Date, Name, Direction…). */
var SHEET_LANG = 'sr';

/** Anti-spam. TOKEN mora da bude isti kao CONFIG.TOKEN u index.html. */
var TOKEN = 'psp-2026';
var MIN_SECONDS = 6;          // popunjeno brže od ovoga = bot
var DEDUP_SECONDS = 600;      // ista prijava dvaput u ovom roku = duplikat

var SHEET_NAME = 'Prijave';
var BLOCKED_SHEET = 'Blokirano';
var STATS_SHEET = 'Statistika';      // sirovi događaji
var DASH_SHEET = 'Pregled';          // sažetak sa grafikonima
var DASH_DAYS = 30;                  // koliko dana ulazi u pregled

/* ============ STRUKTURA TABELE ============ */

/** Redosled kolona. Ovo koristi kod — ne dirati. */
var KEYS = ['date','name','ig','email','phone','language','direction','format','level',
            'goal','location','time','frequency','priorities','source','status','notes'];

/** Ono što žena koja radi sa tabelom vidi u prvom redu. */
var LABELS = {
  sr: ['Datum', 'Ime', 'Instagram', 'Email', 'Telefon', 'Jezik', 'Ples', 'Format', 'Nivo',
       'Cilj', 'Deo grada', 'Termin', 'Koliko često', 'Najvažnije', 'Odakle', 'Status', 'Beleške'],
  en: ['Date', 'Name', 'IG', 'Email', 'Phone', 'Language', 'Direction', 'Format', 'Level',
       'Goal', 'Location', 'Time', 'Frequency', 'Priorities', 'Source', 'Status', 'Notes']
};

var STATUSES = {
  sr: ['Novo', 'Pregledano', 'Preporuka poslata', 'Povezano'],
  en: ['New', 'Reviewed', 'Recommendation sent', 'Connected']
};

var WIDTHS = [120, 150, 160, 190, 130, 70, 170, 105, 175, 200, 200, 150, 120, 200, 95, 165, 240];

function labels()   { return LABELS[SHEET_LANG] || LABELS.sr; }
function statuses() { return STATUSES[SHEET_LANG] || STATUSES.sr; }
function col(key)   { return KEYS.indexOf(key) + 1; }

/* ============ PRIJEM PRIJAVA ============ */

function doPost(e) {
  try {
    var data = parseBody(e);
    if (!data) return json({ ok: false, error: 'empty body' });

    // statistika poseta — ne ide u Prijave
    if (data.kind === 'event') { logEvent(data); return json({ ok: true }); }

    // spam ne ide u glavnu tabelu, ali se pamti u "Blokirano" — da se vidi ako nekog pogrešno odbijemo
    var blocked = spamReason(data);
    if (blocked) {
      logBlocked(data, blocked);
      return json({ ok: true });          // botu ne otkrivamo šta ga je odalo
    }

    var sheet = getSheet();
    sheet.appendRow([
      now(),
      str(data.name), str(data.ig), str(data.email), str(data.phone), str(data.language),
      str(data.direction), str(data.format), str(data.level), str(data.goal),
      str(data.location), str(data.time), str(data.frequency), str(data.priorities),
      str(data.source), statuses()[0], ''
    ]);

    linkifyInstagram(sheet, sheet.getLastRow(), str(data.ig));
    notify(data);            // mejl
    notifyTelegram(data);    // Telegram
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/** Provera da li Web App radi: otvori URL u browseru. */
function doGet() {
  return json({ ok: true, service: 'Pronadji svoj ples' });
}

function parseBody(e) {
  if (!e) return null;
  if (e.postData && e.postData.contents) {                     // JSON iz forme
    try { return JSON.parse(e.postData.contents); } catch (ignore) {}
  }
  if (e.parameter && e.parameter.payload) {                    // rezervni put (skriveni iframe)
    try { return JSON.parse(e.parameter.payload); } catch (ignore) {}
  }
  if (e.parameter && e.parameter.name) return e.parameter;
  return null;
}

/** Instagram ćelija postaje klik — otvara profil direktno iz tabele. */
function linkifyInstagram(sheet, row, handle) {
  var h = handle.replace(/^@+/, '');
  if (!h) return;
  try {
    sheet.getRange(row, col('ig')).setRichTextValue(
      SpreadsheetApp.newRichTextValue()
        .setText('@' + h)
        .setLinkUrl('https://instagram.com/' + h)
        .build()
    );
  } catch (ignore) {}
}

/* ============ ANTI-SPAM ============ */

/** Vraća razlog blokiranja ili '' ako je prijava u redu. */
function spamReason(data) {
  if (str(data.hp)) return 'honeypot';
  if (str(data.token) !== TOKEN) return 'bad token';

  var el = Number(data.elapsed || 0);
  if (!el || el < MIN_SECONDS) return 'prebrzo (' + el + 's)';

  var cache = CacheService.getScriptCache();
  var key = 'psp_' + Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5,
      [str(data.name), str(data.ig), str(data.direction), str(data.goal), str(data.location)].join('|'))
  );
  if (cache.get(key)) return 'duplikat';
  cache.put(key, '1', DEDUP_SECONDS);

  return '';
}

function logBlocked(data, reason) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(BLOCKED_SHEET);
    if (!sh) {
      sh = ss.insertSheet(BLOCKED_SHEET);
      sh.getRange(1, 1, 1, 4).setValues([['Datum', 'Razlog', 'Ime / Instagram', 'Podaci']])
        .setFontWeight('bold').setBackground('#7A6156').setFontColor('#F2EAE0');
      sh.setFrozenRows(1);
      sh.setColumnWidth(1, 130); sh.setColumnWidth(2, 150);
      sh.setColumnWidth(3, 220); sh.setColumnWidth(4, 520);
    }
    sh.appendRow([now(), reason, str(data.name) + ' ' + str(data.ig), JSON.stringify(data).slice(0, 500)]);
  } catch (ignore) {}
}

/* ============ OBAVEŠTENJE NA MEJL ============ */

function notify(data) {
  if (!NOTIFY_EMAIL) return;
  try {
    var ime = str(data.name) || 'bez imena';
    var handle = str(data.ig).replace(/^@+/, '');
    var url = SpreadsheetApp.getActiveSpreadsheet().getUrl();

    var red = function (naslov, vrednost) {
      if (!vrednost) return '';
      return '<tr>' +
        '<td style="padding:9px 14px 9px 0;color:#7A6156;font-size:13px;white-space:nowrap;vertical-align:top">' + naslov + '</td>' +
        '<td style="padding:9px 0;color:#3B2D28;font-size:15px">' + escapeHtml(vrednost) + '</td></tr>';
    };

    var L = labels();
    var html =
      '<div style="background:#F2EAE0;padding:26px 18px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">' +
        '<div style="max-width:560px;margin:0 auto;background:#FBF6F1;border:1px solid #DCCFC3;border-radius:16px;padding:24px 26px">' +
          '<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#7A6156">Nova prijava</div>' +
          '<div style="font-family:Georgia,serif;font-size:26px;color:#3B2D28;margin:6px 0 2px">' + escapeHtml(ime) + '</div>' +
          (handle ? '<a href="https://instagram.com/' + encodeURIComponent(handle) + '" style="color:#7A6156;font-size:15px">@' + escapeHtml(handle) + '</a>' : '') +
          '<table style="width:100%;border-collapse:collapse;margin:18px 0 22px">' +
            red(L[3],  str(data.email)) +
            red(L[4],  str(data.phone)) +
            red(L[6],  str(data.direction)) +
            red(L[7],  str(data.format)) +
            red(L[8],  str(data.level)) +
            red(L[9],  str(data.goal)) +
            red(L[10], str(data.location)) +
            red(L[11], str(data.time)) +
            red(L[12], str(data.frequency)) +
            red(L[13], str(data.priorities)) +
            red(L[5],  str(data.language)) +
            red(L[14], str(data.source)) +
            red(L[0],  now()) +
          '</table>' +
          (handle
            ? '<a href="https://instagram.com/' + encodeURIComponent(handle) + '" style="display:inline-block;background:#3B2D28;color:#F2EAE0;text-decoration:none;padding:13px 22px;border-radius:99px;font-size:15px">Otvori Instagram profil</a>&nbsp;&nbsp;'
            : '') +
          '<a href="' + url + '" style="display:inline-block;color:#7A6156;text-decoration:underline;padding:13px 0;font-size:14px">Otvori tabelu</a>' +
        '</div>' +
      '</div>';

    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: 'Nova prijava: ' + ime + (handle ? ' (@' + handle + ')' : ''),
      htmlBody: html,
      body: plainText(data)
    });
  } catch (ignore) {}
}

function plainText(data) {
  var L = labels();
  var out = [];
  for (var i = 1; i < KEYS.length - 2; i++) {
    var v = str(data[KEYS[i]]);
    if (v) out.push(L[i] + ': ' + v);
  }
  return out.join('\n');
}

function escapeHtml(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ============ OBAVEŠTENJE NA TELEGRAM ============ */

function notifyTelegram(data) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return;
  try {
    var L = labels();
    var handle = str(data.ig).replace(/^@+/, '');
    var linija = function (naslov, vrednost) {
      return vrednost ? '\n' + naslov + ': <b>' + escapeHtml(vrednost) + '</b>' : '';
    };

    var text = '✨ <b>Nova prijava</b>\n' +
      '<b>' + escapeHtml(str(data.name) || 'bez imena') + '</b>' +
      (handle ? ' · @' + escapeHtml(handle) : '') + '\n' +
      linija(L[6],  str(data.direction)) +
      linija(L[8],  str(data.level)) +
      linija(L[7],  str(data.format)) +
      linija(L[9],  str(data.goal)) +
      linija(L[10], str(data.location)) +
      linija(L[11], str(data.time)) +
      linija(L[12], str(data.frequency)) +
      linija(L[13], str(data.priorities)) +
      linija(L[4],  str(data.phone)) +
      linija(L[3],  str(data.email)) +
      '\n\n<i>' + now() + ' · ' + escapeHtml(str(data.language)) + ' · ' + escapeHtml(str(data.source)) + '</i>';

    var dugmad = [];
    if (handle) dugmad.push({ text: '📷 Instagram', url: 'https://instagram.com/' + handle });
    dugmad.push({ text: '📋 Tabela', url: SpreadsheetApp.getActiveSpreadsheet().getUrl() });

    // svakom primaocu posebno — greška kod jednog ne sme da zaustavi ostale
    TELEGRAM_CHAT.split(',').forEach(function (chat) {
      var id = chat.trim();
      if (!id) return;
      try {
        telegramCall('sendMessage', {
          chat_id: id,
          text: text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: [dugmad] }
        });
      } catch (ignore) {}
    });
  } catch (ignore) {}
}

function telegramCall(method, payload) {
  // JSON + eksplicitan charset — inače Apps Script pošalje formu bez kodiranja
  // i Telegram pokvari č, ć, š, ž i emoji
  return UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/' + method, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

/** KORAK 1: napiši botu bilo šta u Telegramu, pa pokreni ovu funkciju.
 *  U Execution log-u ispisuje chat id koji treba upisati u TELEGRAM_CHAT. */
function telegramChatId() {
  if (!TELEGRAM_TOKEN) { Logger.log('Prvo upiši TELEGRAM_TOKEN.'); return; }
  var res = JSON.parse(telegramCall('getUpdates', {}).getContentText());
  if (!res.ok) { Logger.log('Greška: ' + JSON.stringify(res)); return; }
  if (!res.result.length) { Logger.log('Nema poruka. Napiši botu bilo šta u Telegramu pa pokreni ponovo.'); return; }
  res.result.forEach(function (u) {
    var c = (u.message || u.channel_post || {}).chat;
    if (c) Logger.log('chat_id: ' + c.id + '   (' + (c.title || c.first_name || '') + ', tip: ' + c.type + ')');
  });
}

/** KORAK 2: provera da poruka stvarno stiže — svim primaocima iz TELEGRAM_CHAT. */
function testTelegram() {
  Logger.log('Šaljem na: ' + TELEGRAM_CHAT);
  notifyTelegram({
    name: 'PROBA', ig: '@proba', phone: '060 111 2233', language: 'SR', source: 'test',
    direction: 'Salsa / Bachata', format: 'Grupni', level: 'Početnik',
    goal: 'Hobi', location: 'Vračar', time: 'Veče', frequency: '2x nedeljno', priorities: 'Trener'
  });
}

/* ============ STATISTIKA ============ */

/** Događaji: view (otvorio stranicu), start (kliknuo Počni),
 *  exit (otišao — beležimo do kog je pitanja stigao), submit (poslao prijavu). */
function logEvent(data) {
  if (str(data.token) !== TOKEN) return;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(STATS_SHEET) || createStatsSheet(ss);
    var d = new Date();
    sh.appendRow([
      d,
      Number(Utilities.formatDate(d, tz(), 'H')),
      str(data.session),
      str(data.event),
      data.step === '' || data.step === undefined ? '' : Number(data.step),
      str(data.language),
      str(data.source)
    ]);
  } catch (ignore) {}
}

function createStatsSheet(ss) {
  var sh = ss.insertSheet(STATS_SHEET);
  sh.getRange(1, 1, 1, 7).setValues([['Vreme', 'Sat', 'Sesija', 'Događaj', 'Korak', 'Jezik', 'Odakle']])
    .setFontWeight('bold').setBackground('#7A6156').setFontColor('#F2EAE0');
  sh.setFrozenRows(1);
  sh.getRange('A2:A').setNumberFormat('dd.MM.yyyy HH:mm');
  [140, 50, 90, 90, 60, 60, 110].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  return sh;
}

/** Prepravlja list "Pregled". Pokreće se sam na sat vremena (vidi ukljuciStatistiku),
 *  a može i ručno kad god zatreba svež broj. */
function osveziPregled() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var st = ss.getSheetByName(STATS_SHEET);
  if (!st || st.getLastRow() < 2) return;

  var rows = st.getRange(2, 1, st.getLastRow() - 1, 7).getValues();
  var granica = new Date();
  granica.setDate(granica.getDate() - DASH_DAYS);

  var poDanu = {}, poSatu = {}, sesije = {}, izvori = {};
  for (var h = 0; h < 24; h++) poSatu[h] = {};

  rows.forEach(function (r) {
    var d = r[0];
    if (!(d instanceof Date) || d < granica) return;
    var dan = Utilities.formatDate(d, tz(), 'dd.MM.yyyy');
    var sesija = r[2], dogadjaj = r[3], korak = r[4];

    if (!sesije[sesija]) sesije[sesija] = { dan: dan, sat: r[1], poceo: false, zavrsio: false, korak: -1, izvor: r[6] };
    var s = sesije[sesija];
    if (dogadjaj === 'start')  s.poceo = true;
    if (dogadjaj === 'submit') { s.zavrsio = true; s.korak = 99; }
    if (korak !== '' && Number(korak) > s.korak) s.korak = Number(korak);

    poDanu[dan] = poDanu[dan] || { posete: {}, zavrseno: 0 };
    poSatu[r[1]] = poSatu[r[1]] || {};
  });

  var ukupno = 0, poceli = 0, zavrsili = 0, doKoraka = [];
  for (var i = 0; i <= 9; i++) doKoraka[i] = 0;

  Object.keys(sesije).forEach(function (k) {
    var s = sesije[k];
    ukupno++;
    if (s.poceo) poceli++;
    if (s.zavrsio) zavrsili++;
    poDanu[s.dan].posete[k] = 1;
    if (s.zavrsio) poDanu[s.dan].zavrseno++;
    poSatu[s.sat][k] = 1;
    izvori[s.izvor || '—'] = (izvori[s.izvor || '—'] || 0) + 1;
    for (var i = 0; i <= 9; i++) if (s.korak >= i) doKoraka[i]++;
  });

  /* --- crtanje lista --- */
  var sh = ss.getSheetByName(DASH_SHEET) || ss.insertSheet(DASH_SHEET);
  sh.clear();
  sh.getCharts().forEach(function (c) { sh.removeChart(c); });

  sh.getRange('A1').setValue('Pregled — Pronađi svoj ples')
    .setFontSize(16).setFontWeight('bold').setFontColor('#3B2D28');
  sh.getRange('A2').setValue('Poslednjih ' + DASH_DAYS + ' dana · osveženo ' + now())
    .setFontColor('#7A6156').setFontSize(10);

  var konverzija = ukupno ? Math.round(zavrsili / ukupno * 100) : 0;
  sh.getRange('A4:D4').setValues([['Otvorilo stranicu', 'Počelo da popunjava', 'Poslalo prijavu', 'Konverzija']])
    .setFontWeight('bold').setBackground('#3B2D28').setFontColor('#F2EAE0');
  sh.getRange('A5:D5').setValues([[ukupno, poceli, zavrsili, konverzija + '%']])
    .setFontSize(20).setFontColor('#3B2D28');

  // po danima
  var dani = Object.keys(poDanu).sort(function (a, b) { return kljucDana(a) - kljucDana(b); });
  sh.getRange('A7').setValue('Po danima').setFontWeight('bold');
  sh.getRange('A8:C8').setValues([['Datum', 'Posetilaca', 'Poslato']])
    .setFontWeight('bold').setBackground('#DCCFC3');
  if (dani.length) {
    sh.getRange(9, 1, dani.length, 3).setValues(dani.map(function (d) {
      return [d, Object.keys(poDanu[d].posete).length, poDanu[d].zavrseno];
    }));
  }

  // po satima
  sh.getRange('E7').setValue('Po satima (kada dolaze)').setFontWeight('bold');
  sh.getRange('E8:F8').setValues([['Sat', 'Posetilaca']])
    .setFontWeight('bold').setBackground('#DCCFC3');
  var satRedovi = [];
  for (var h2 = 0; h2 < 24; h2++) satRedovi.push([h2 + ':00', Object.keys(poSatu[h2] || {}).length]);
  sh.getRange(9, 5, 24, 2).setValues(satRedovi);

  // levak
  var pitanja = ['Otvorili', 'Počeli'].concat(
    ['1. ples', '2. format', '3. nivo', '4. cilj', '5. deo grada', '6. termin', '7. koliko često', '8. najvažnije', '9. kontakt']);
  sh.getRange('H7').setValue('Dokle stižu').setFontWeight('bold');
  sh.getRange('H8:I8').setValues([['Korak', 'Ljudi']])
    .setFontWeight('bold').setBackground('#DCCFC3');
  var levak = [[pitanja[0], ukupno], [pitanja[1], poceli]];
  for (var i2 = 0; i2 <= 8; i2++) levak.push([pitanja[i2 + 2], doKoraka[i2]]);
  sh.getRange(9, 8, levak.length, 2).setValues(levak);

  // odakle dolaze
  var izvorKljuc = Object.keys(izvori).sort(function (a, b) { return izvori[b] - izvori[a]; });
  sh.getRange('K7').setValue('Odakle dolaze').setFontWeight('bold');
  sh.getRange('K8:L8').setValues([['Izvor', 'Posetilaca']])
    .setFontWeight('bold').setBackground('#DCCFC3');
  if (izvorKljuc.length) {
    sh.getRange(9, 11, izvorKljuc.length, 2).setValues(izvorKljuc.map(function (k) { return [k, izvori[k]]; }));
  }

  [110, 100, 90, 30, 80, 100, 30, 130, 80, 30, 120, 100].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  // grafikoni
  if (dani.length) {
    sh.insertChart(sh.newChart().setChartType(Charts.ChartType.COLUMN)
      .addRange(sh.getRange(8, 1, dani.length + 1, 3))
      .setOption('title', 'Posete i prijave po danima')
      .setOption('colors', ['#7A6156', '#3B2D28'])
      .setOption('legend', { position: 'bottom' })
      .setPosition(Math.max(11, dani.length + 12), 1, 0, 0).setNumHeaders(1).build());
  }
  sh.insertChart(sh.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(sh.getRange(8, 5, 25, 2))
    .setOption('title', 'Posete po satima')
    .setOption('colors', ['#7A6156'])
    .setOption('legend', { position: 'none' })
    .setPosition(Math.max(11, dani.length + 12), 6, 0, 0).setNumHeaders(1).build());

  ss.setActiveSheet(sh);
}

function kljucDana(s) {
  var d = s.split('.');
  return new Date(Number(d[2]), Number(d[1]) - 1, Number(d[0])).getTime();
}

/** Pokreni jednom: pregled se od tada osvežava sam, na svaki sat. */
function ukljuciStatistiku() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'osveziPregled') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('osveziPregled').timeBased().everyHours(1).create();
  osveziPregled();
}

/* ============ POMOĆNE ============ */

function str(v) {
  if (v === null || v === undefined) return '';
  return String(v).slice(0, 500);
}

function tz() {
  return Session.getScriptTimeZone() || 'Europe/Belgrade';
}

function now() {
  return Utilities.formatDate(new Date(), tz(), 'dd.MM.yyyy HH:mm');
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || renameOldSheet(ss) || setupSheet();
}

/** Ako tabela još ima stari naziv "Leads", samo je preimenujemo — podaci ostaju. */
function renameOldSheet(ss) {
  var old = ss.getSheetByName('Leads');
  if (!old) return null;
  old.setName(SHEET_NAME);
  return old;
}

/* ============ PRIPREMA TABELE (pokrenuti jednom) ============ */

function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || renameOldSheet(ss) || ss.insertSheet(SHEET_NAME);
  var L = labels();
  var rows = sheet.getMaxRows();

  // zaglavlje
  sheet.getRange(1, 1, 1, L.length).setValues([L])
    .setFontWeight('bold').setFontSize(11)
    .setBackground('#3B2D28').setFontColor('#F2EAE0')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);                       // Datum i Ime ostaju vidljivi pri skrolovanju

  for (var i = 0; i < WIDTHS.length; i++) sheet.setColumnWidth(i + 1, WIDTHS[i]);

  // tekst se ne prelama u više redova — jedan red = jedna prijava
  sheet.getRange(1, 1, rows, L.length)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP)
    .setVerticalAlignment('middle');

  // telefon kao tekst, inače Sheets pojede "+" i vodeću nulu
  sheet.getRange(2, col('phone'), rows - 1, 1).setNumberFormat('@');

  // Status: padajuća lista + boje
  var st = statuses();
  var statusRange = sheet.getRange(2, col('status'), rows - 1, 1);
  statusRange.setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(st, true).setAllowInvalid(false).build()
  );
  var colors = ['#F6E2DC', '#FAF0D7', '#E4EEDD', '#D8E6F3'];
  sheet.setConditionalFormatRules(st.map(function (s, i) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(s).setBackground(colors[i]).setRanges([statusRange]).build();
  }));

  // naizmenične trake — lakše se prati red pogledom
  sheet.getBandings().forEach(function (b) { b.remove(); });
  sheet.getRange(2, 1, rows - 1, L.length)          // bez zaglavlja — da ostane tamno braon
    .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);

  if (!sheet.getFilter()) sheet.getRange(1, 1, rows, L.length).createFilter();

  // stare prijave: Instagram ćelije postaju klikabilne
  var last = sheet.getLastRow();
  for (var r = 2; r <= last; r++) {
    linkifyInstagram(sheet, r, String(sheet.getRange(r, col('ig')).getValue() || ''));
  }

  ss.setActiveSheet(sheet);
  return sheet;
}

/** Test bez forme: pokreni i pogledaj da li je stigao mejl i da li se pojavio red. */
function testPrijava() {
  doPost({ postData: { contents: JSON.stringify({
    name: 'PROBA — obrišite ovaj red', ig: '@proba', email: 'proba@mail.com', phone: '060 111 2233',
    language: 'SR', direction: 'Salsa / Bachata', format: 'Grupni', level: 'Početnik',
    goal: 'Hobi, Druženje', location: 'Vračar', time: 'Veče', frequency: '2x nedeljno',
    priorities: 'Trener, Cena', source: 'test', token: TOKEN, hp: '', elapsed: 42
  })}});
}
