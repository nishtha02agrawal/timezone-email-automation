/**
 * ==================================================================
 *  TIMEZONE-AWARE EMAIL SEQUENCES  (Google Sheets + Gmail)
 * ==================================================================
 *  Sends each contact a 1-3 step email sequence ONLY during the
 *  contact's own working hours (default Mon-Fri, 9 AM - 5 PM local).
 *  Follow-ups go in the same Gmail thread. A contact's sequence stops
 *  automatically when they reply or the email bounces.
 *
 *  ONE-TIME SETUP
 *  1. Put your contact list in a Google Sheet. It needs an Email column
 *     and a Country column. Add a "State / City" column for US, Canada
 *     and Australia contacts.
 *  2. Extensions > Apps Script > delete the sample code > paste this
 *     whole file > Save.
 *  3. In the Apps Script left sidebar: Services (+) > Gmail API > Add.
 *  4. Reload the sheet. Use the new "Email Automation" menu:
 *       1. Set up sheets        (adds Templates / Settings / Log tabs)
 *       2. Fill timezones       (check the Notes column for flags)
 *       3. Send test emails to me
 *       Start automation        (checks every 15 min, 24x7, in the cloud)
 *
 *  PLACEHOLDERS in Templates: any column header in {{ }}, e.g.
 *  {{FirstName}}, {{Company}}. Add a fallback with a pipe:
 *  {{FirstName|there}}. A contact with missing data and no
 *  fallback is skipped and flagged in Notes. Nothing goes out with
 *  "Hi ," in it.
 * ==================================================================
 */

const SHEETS = { contacts: 'Contacts', templates: 'Templates', settings: 'Settings', log: 'Log' };

const COLUMNS = {
  email:   ['Email', 'E-mail', 'Email Address', 'Email ID', 'Mail'],
  name:    ['Name', 'Full Name', 'Contact Name', 'First Name'],
  company: ['Company', 'Company Name', 'Organisation', 'Organization', 'Brand'],
  country: ['Country', 'Country Name'],
  region:  ['State / City', 'State', 'City', 'Region', 'Location', 'Province'],
  tz:      ['Timezone', 'Time Zone', 'TZ'],
  status:  ['Status'],
  step:    ['Step'],
  last:    ['Last Sent'],
  next:    ['Next Due'],
  thread:  ['Thread ID'],
  msgids:  ['Message IDs'],
  notes:   ['Notes'],
};

const SETTINGS = [
  ['START_HOUR', 9, "Earliest send hour, in the CONTACT'S local time (24h)"],
  ['END_HOUR', 17, "Stop sending at this hour, contact's local time (17 = 5 PM)"],
  ['SKIP_WEEKENDS', true, "Skip the contact's weekend (Fri-Sat for Saudi, Qatar, Kuwait, Egypt, Israel...)"],
  ['DAILY_LIMIT', 80, 'Max emails per day in total. Free Gmail: keep at or below 100. Workspace: up to ~1,500'],
  ['PER_RUN', 5, 'Max emails per 15-minute check'],
  ['GAP_SECONDS', 30, 'Pause between two emails (randomised +/-30%)'],
  ['SENDER_NAME', '', 'Name shown in the From field (blank = your Gmail name)'],
  ['FOOTER', '', 'Optional line added to every email, e.g. "Not relevant? Just reply no and I won\'t follow up."'],
  ['PAUSED', false, 'TRUE = pause all sending without turning the automation off'],
];

const TEMPLATE_HEADERS = ['Step', 'Wait days (after previous email)', 'Subject (step 1 only - follow-ups reply in the same thread)', 'Body'];
const TEMPLATE_SAMPLE = [
  [1, 0, 'Quick question, {{FirstName|there}}',
    'Hi {{FirstName|there}},\n\n[Write your first email here. You can use {{Company|your team}} or any other column header.]\n\nBest,\n[Your name]'],
  [2, 3, '',
    'Hi {{FirstName|there}},\n\n[Write follow-up 1 here - short, adds one new reason to reply.]\n\nBest,\n[Your name]'],
  [3, 5, '',
    'Hi {{FirstName|there}},\n\n[Write your last follow-up here - an easy yes/no question.]\n\nBest,\n[Your name]'],
];

const LOG_HEADERS = ['Sent at (your time)', 'Email', 'Step', 'Contact local time', 'Timezone', 'Result'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 864e5;

/* ================================================================
 *  COUNTRY -> TIMEZONE
 * ================================================================ */

// Countries with one business timezone (names and ISO codes)
const COUNTRY_TZ = {
  'india|in|bharat': 'Asia/Kolkata',
  'united kingdom|uk|gb|great britain|britain|england|scotland|wales|northern ireland': 'Europe/London',
  'ireland|ie|republic of ireland': 'Europe/Dublin',
  'germany|de|deutschland': 'Europe/Berlin',
  'france|fr': 'Europe/Paris',
  'spain|es|espana': 'Europe/Madrid',
  'italy|it|italia': 'Europe/Rome',
  'netherlands|the netherlands|nl|holland': 'Europe/Amsterdam',
  'belgium|be': 'Europe/Brussels',
  'switzerland|ch': 'Europe/Zurich',
  'austria|at': 'Europe/Vienna',
  'sweden|se': 'Europe/Stockholm',
  'norway|no': 'Europe/Oslo',
  'denmark|dk': 'Europe/Copenhagen',
  'finland|fi': 'Europe/Helsinki',
  'poland|pl': 'Europe/Warsaw',
  'czechia|czech republic|cz': 'Europe/Prague',
  'portugal|pt': 'Europe/Lisbon',
  'greece|gr': 'Europe/Athens',
  'hungary|hu': 'Europe/Budapest',
  'romania|ro': 'Europe/Bucharest',
  'bulgaria|bg': 'Europe/Sofia',
  'croatia|hr': 'Europe/Zagreb',
  'serbia|rs': 'Europe/Belgrade',
  'slovakia|sk': 'Europe/Bratislava',
  'slovenia|si': 'Europe/Ljubljana',
  'ukraine|ua': 'Europe/Kiev',
  'turkey|turkiye|tr': 'Europe/Istanbul',
  'estonia|ee': 'Europe/Tallinn',
  'latvia|lv': 'Europe/Riga',
  'lithuania|lt': 'Europe/Vilnius',
  'luxembourg|lu': 'Europe/Luxembourg',
  'iceland|is': 'Atlantic/Reykjavik',
  'malta|mt': 'Europe/Malta',
  'cyprus|cy': 'Asia/Nicosia',
  'united arab emirates|uae|ae|dubai|abu dhabi': 'Asia/Dubai',
  'saudi arabia|ksa|sa': 'Asia/Riyadh',
  'qatar|qa': 'Asia/Qatar',
  'kuwait|kw': 'Asia/Kuwait',
  'bahrain|bh': 'Asia/Bahrain',
  'oman|om': 'Asia/Muscat',
  'israel|il': 'Asia/Jerusalem',
  'jordan|jo': 'Asia/Amman',
  'egypt|eg': 'Africa/Cairo',
  'iraq|iq': 'Asia/Baghdad',
  'lebanon|lb': 'Asia/Beirut',
  'iran|ir': 'Asia/Tehran',
  'pakistan|pk': 'Asia/Karachi',
  'bangladesh|bd': 'Asia/Dhaka',
  'sri lanka|lk': 'Asia/Colombo',
  'nepal|np': 'Asia/Kathmandu',
  'singapore|sg': 'Asia/Singapore',
  'malaysia|my': 'Asia/Kuala_Lumpur',
  'thailand|th': 'Asia/Bangkok',
  'vietnam|viet nam|vn': 'Asia/Ho_Chi_Minh',
  'philippines|ph': 'Asia/Manila',
  'china|cn|prc': 'Asia/Shanghai',
  'hong kong|hk': 'Asia/Hong_Kong',
  'taiwan|tw': 'Asia/Taipei',
  'japan|jp': 'Asia/Tokyo',
  'south korea|korea|republic of korea|kr': 'Asia/Seoul',
  'new zealand|nz': 'Pacific/Auckland',
  'south africa|za': 'Africa/Johannesburg',
  'nigeria|ng': 'Africa/Lagos',
  'kenya|ke': 'Africa/Nairobi',
  'ghana|gh': 'Africa/Accra',
  'morocco|ma': 'Africa/Casablanca',
  'ethiopia|et': 'Africa/Addis_Ababa',
  'tanzania|tz': 'Africa/Dar_es_Salaam',
  'uganda|ug': 'Africa/Kampala',
  'rwanda|rw': 'Africa/Kigali',
  'argentina|ar': 'America/Argentina/Buenos_Aires',
  'chile|cl': 'America/Santiago',
  'colombia|co': 'America/Bogota',
  'peru|pe': 'America/Lima',
  'ecuador|ec': 'America/Guayaquil',
  'venezuela|ve': 'America/Caracas',
  'uruguay|uy': 'America/Montevideo',
  'costa rica|cr': 'America/Costa_Rica',
  'panama|pa': 'America/Panama',
  'guatemala|gt': 'America/Guatemala',
  'dominican republic|do': 'America/Santo_Domingo',
  'puerto rico|pr': 'America/Puerto_Rico',
  'jamaica|jm': 'America/Jamaica',
};

// Countries with several timezones: [region map key, default tz, flag if no region?]
const MULTI_TZ = {
  'united states|united states of america|usa|us|america': ['us', 'America/New_York', true],
  'canada|ca': ['ca', 'America/Toronto', true],
  'australia|au': ['au', 'Australia/Sydney', true],
  'brazil|brasil|br': ['br', 'America/Sao_Paulo', false],
  'mexico|mx': ['mx', 'America/Mexico_City', false],
  'russia|russian federation|ru': ['ru', 'Europe/Moscow', false],
  'indonesia|id': ['id', 'Asia/Jakarta', false],
};

const REGION_TZ = {
  us: {
    'America/New_York': 'ny|new york|nyc|new york city|manhattan|brooklyn|nj|new jersey|ct|connecticut|ma|massachusetts|boston|ri|rhode island|vt|vermont|nh|new hampshire|me|maine|pa|pennsylvania|philadelphia|pittsburgh|de|delaware|md|maryland|baltimore|dc|washington dc|washington d.c.|va|virginia|wv|west virginia|nc|north carolina|charlotte|raleigh|sc|south carolina|ga|georgia|atlanta|fl|florida|miami|orlando|tampa|oh|ohio|columbus|cleveland|mi|michigan|detroit|in|indiana|indianapolis|ky|kentucky',
    'America/Chicago': 'il|illinois|chicago|wi|wisconsin|milwaukee|mn|minnesota|minneapolis|ia|iowa|mo|missouri|st louis|kansas city|ar|arkansas|louisiana|new orleans|ms|mississippi|al|alabama|tn|tennessee|nashville|memphis|tx|texas|austin|dallas|houston|san antonio|ok|oklahoma|ks|kansas|ne|nebraska|omaha|sd|south dakota|nd|north dakota',
    'America/Denver': 'co|colorado|denver|boulder|ut|utah|salt lake city|nm|new mexico|albuquerque|wy|wyoming|mt|montana|id|idaho|boise',
    'America/Phoenix': 'az|arizona|phoenix|scottsdale|tucson',
    'America/Los_Angeles': 'ca|california|los angeles|san francisco|sf|bay area|silicon valley|san jose|san diego|palo alto|mountain view|wa|washington|seattle|redmond|bellevue|or|oregon|portland|nv|nevada|las vegas',
    'America/Anchorage': 'ak|alaska|anchorage',
    'Pacific/Honolulu': 'hi|hawaii|honolulu',
  },
  ca: {
    'America/Vancouver': 'bc|british columbia|vancouver|victoria',
    'America/Edmonton': 'ab|alberta|calgary|edmonton',
    'America/Regina': 'sk|saskatchewan|regina|saskatoon',
    'America/Winnipeg': 'mb|manitoba|winnipeg',
    'America/Toronto': 'on|ontario|toronto|ottawa|waterloo|mississauga|qc|quebec|montreal',
    'America/Halifax': 'ns|nova scotia|halifax|nb|new brunswick|pe|pei|prince edward island',
    'America/St_Johns': 'nl|newfoundland|st johns',
  },
  au: {
    'Australia/Sydney': 'nsw|new south wales|sydney|act|canberra',
    'Australia/Melbourne': 'vic|victoria|melbourne',
    'Australia/Hobart': 'tas|tasmania|hobart',
    'Australia/Brisbane': 'qld|queensland|brisbane|gold coast',
    'Australia/Adelaide': 'sa|south australia|adelaide',
    'Australia/Perth': 'wa|western australia|perth',
    'Australia/Darwin': 'nt|northern territory|darwin',
  },
  br: { 'America/Manaus': 'am|amazonas|manaus' },
  mx: { 'America/Tijuana': 'bc|baja california|tijuana|mexicali', 'America/Cancun': 'qroo|quintana roo|cancun' },
  ru: { 'Asia/Yekaterinburg': 'yekaterinburg|ekaterinburg', 'Asia/Novosibirsk': 'novosibirsk', 'Asia/Vladivostok': 'vladivostok' },
  id: { 'Asia/Makassar': 'bali|denpasar|makassar', 'Asia/Jayapura': 'papua|jayapura' },
};

// Weekend days by timezone (0 = Sun ... 6 = Sat). Everyone else: Sat + Sun.
const FRI_SAT = [5, 6];
const WEEKENDS = {
  'Asia/Riyadh': FRI_SAT, 'Asia/Qatar': FRI_SAT, 'Asia/Kuwait': FRI_SAT, 'Asia/Bahrain': FRI_SAT,
  'Asia/Muscat': FRI_SAT, 'Asia/Jerusalem': FRI_SAT, 'Asia/Amman': FRI_SAT, 'Africa/Cairo': FRI_SAT,
  'Asia/Baghdad': FRI_SAT, 'Asia/Dhaka': FRI_SAT, 'Asia/Tehran': [5], 'Asia/Kathmandu': [6],
};

/* ================================================================
 *  MENU
 * ================================================================ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Email Automation')
    .addItem('1. Set up sheets', 'setupSheets')
    .addItem('2. Fill timezones', 'fillTimezones')
    .addItem('3. Send test emails to me', 'sendTestToMe')
    .addSeparator()
    .addItem('Start automation', 'startAutomation')
    .addItem('Stop automation', 'stopAutomation')
    .addItem('Run once now', 'run')
    .addToUi();
}

function setupSheets() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEETS.contacts);
  if (!sh) {
    const active = ss.getActiveSheet();
    const hasEmail = findCol(headerIndex(active), COLUMNS.email) > -1;
    sh = hasEmail ? active.setName(SHEETS.contacts) : ss.insertSheet(SHEETS.contacts);
  }
  const idx = headerIndex(sh);
  const add = Object.keys(COLUMNS).filter(k => findCol(idx, COLUMNS[k]) < 0).map(k => COLUMNS[k][0]);
  if (add.length) sh.getRange(1, sh.getLastColumn() + 1, 1, add.length).setValues([add]);

  const c = cols(sh);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold');
  const rows = Math.max(sh.getMaxRows() - 1, 1);
  [c.last, c.next].forEach(i => sh.getRange(2, i + 1, rows, 1).setNumberFormat('dd MMM yyyy, HH:mm'));
  sh.hideColumns(c.msgids + 1);

  if (!ss.getSheetByName(SHEETS.templates)) {
    const t = ss.insertSheet(SHEETS.templates);
    t.getRange(1, 1, 1, 4).setValues([TEMPLATE_HEADERS]).setFontWeight('bold');
    t.getRange(2, 1, TEMPLATE_SAMPLE.length, 4).setValues(TEMPLATE_SAMPLE);
    t.setColumnWidth(2, 120).setColumnWidth(3, 280).setColumnWidth(4, 560);
    t.getRange('A:D').setWrap(true).setVerticalAlignment('top');
    t.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SHEETS.settings)) {
    const st = ss.insertSheet(SHEETS.settings);
    st.getRange(1, 1, 1, 3).setValues([['Setting', 'Value', 'What it does']]).setFontWeight('bold');
    st.getRange(2, 1, SETTINGS.length, 3).setValues(SETTINGS);
    st.setColumnWidth(1, 140).setColumnWidth(2, 200).setColumnWidth(3, 560);
    st.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SHEETS.log)) {
    const lg = ss.insertSheet(SHEETS.log);
    lg.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');
    lg.setFrozenRows(1);
  }

  const r = fillTimezones(true);
  SpreadsheetApp.getUi().alert(
    'Setup done.\n\n' +
    'Timezones filled: ' + r.filled + '\nNeed your attention: ' + r.flagged + ' (see Notes column)\n\n' +
    'Next: write your emails in the Templates tab, check Settings, then "Send test emails to me".');
}

function fillTimezones(silent) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.contacts);
  const c = cols(sh);
  const r = fillTz(sh, sh.getDataRange().getValues(), c);
  if (silent !== true) {
    SpreadsheetApp.getUi().alert('Timezones filled: ' + r.filled + '\nNeed your attention: ' + r.flagged + ' (see Notes column)');
  }
  return r;
}

function sendTestToMe() {
  const ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEETS.contacts), tpl = getTemplates(), s = getSettings();
  if (!sh || !tpl.length) return ui.alert('Run "Set up sheets" and fill the Templates tab first.');
  const c = cols(sh), data = sh.getDataRange().getValues();

  // Use the selected row if you're on Contacts, otherwise the first contact
  let r = ss.getActiveSheet().getName() === SHEETS.contacts ? sh.getActiveRange().getRow() - 1 : 0;
  if (r < 1 || r >= data.length || !String(data[r][c.email]).trim()) {
    r = data.findIndex((row, i) => i > 0 && String(row[c.email]).trim());
  }
  if (r < 1) return ui.alert('Add at least one contact first.');

  const me = Session.getEffectiveUser().getEmail(), row = data[r], d = rowData(row, c.idx);
  tpl.forEach((t, i) => {
    const m = compose(tpl, i, d, s);
    const info = 'TEST - email ' + (i + 1) + ' of ' + tpl.length + ' for ' + row[c.email] +
      (i ? ' (goes ' + t.wait + ' day(s) after the previous one, in the same thread)' : '') +
      (m.missing.length ? '\nMISSING DATA: ' + m.missing.join(', ') + ' - this contact would be skipped' : '') +
      '\n--------------------\n\n';
    const opts = { htmlBody: toHtml(info + m.body) };
    if (s.SENDER_NAME) opts.name = String(s.SENDER_NAME);
    GmailApp.sendEmail(me, '[TEST ' + (i + 1) + '/' + tpl.length + '] ' + m.subject, info + m.body, opts);
  });

  const tz = String(row[c.tz]).trim() || resolveTz(row[c.country], c.region > -1 ? row[c.region] : '').tz;
  const now = new Date();
  const when = tz && validTz(tz)
    ? 'Their local time right now: ' + localClock(tz, now).text + ' (' + tz + ') - ' +
      (inWorkHours(tz, now, s) ? 'INSIDE' : 'outside') + ' working hours.'
    : 'This contact has no valid timezone yet.';
  ui.alert('Sent ' + tpl.length + ' test email(s) to ' + me + ' using ' + row[c.email] + "'s data.\n\n" + when);
}

function startAutomation() {
  const ui = SpreadsheetApp.getUi();
  if (typeof Gmail === 'undefined') {
    return ui.alert('Turn on the Gmail API first:\nApps Script editor > Services (+) > Gmail API > Add.\nThen try again.');
  }
  const tpl = getTemplates();
  if (!tpl.length || !tpl[0].subject) return ui.alert('Add your emails in the Templates tab first (step 1 needs a subject).');
  if (tpl.some(t => /\[(write|your name)/i.test(t.body))) {
    return ui.alert('The Templates tab still has sample text in [brackets]. Replace it with your real emails first.');
  }
  stopAutomation(true);
  ScriptApp.newTrigger('run').timeBased().everyMinutes(15).create();
  ui.alert('Automation is ON.\n\nEvery 15 minutes it checks who is inside their working hours and sends what is due. ' +
    'You can close the sheet - it runs in Google\'s cloud.\n\nTo pause: set PAUSED = TRUE in Settings, or use "Stop automation".');
}

function stopAutomation(silent) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'run')
    .forEach(t => ScriptApp.deleteTrigger(t));
  if (silent !== true) SpreadsheetApp.getUi().alert('Automation stopped. Nothing will be sent until you start it again.');
}

/* ================================================================
 *  MAIN LOOP (runs every 15 minutes)
 * ================================================================ */

function run() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // a previous run is still going
  try { sendDueEmails(); } finally { lock.releaseLock(); }
}

function sendDueEmails() {
  const started = Date.now();
  const s = getSettings();
  if (s.PAUSED) return;
  const tpl = getTemplates();
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.contacts);
  if (!sh || !tpl.length) throw new Error('Run "Set up sheets" and fill the Templates tab first.');
  const c = cols(sh);
  ['email', 'tz', 'status', 'step', 'last', 'next', 'thread', 'msgids', 'notes'].forEach(k => {
    if (c[k] < 0) throw new Error('Missing column "' + COLUMNS[k][0] + '" - run "Set up sheets".');
  });

  const data = sh.getDataRange().getValues();
  fillTz(sh, data, c);
  const mine = myAddresses();
  checkInbox(sh, data, c, mine);

  // Build the queue of emails due right now
  const now = new Date(), seen = {}, queue = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const email = String(row[c.email]).trim().toLowerCase();
    if (!email) continue;
    const status = String(row[c.status]).trim();
    if (seen[email]) { if (!status) update(sh, data, c, r, { status: 'Duplicate' }); continue; }
    seen[email] = true;
    if (status && status !== 'Active') continue;          // Replied, Completed, Bounced, Skip...
    const step = Number(row[c.step]) || 0;
    if (step >= tpl.length) continue;
    if (!EMAIL_RE.test(email)) { update(sh, data, c, r, { status: 'Invalid email' }); continue; }
    const tz = String(row[c.tz]).trim();
    if (!tz || !validTz(tz)) continue;
    if (step > 0) {
      const last = row[c.last];
      if (!(last instanceof Date) || now - last < tpl[step].wait * DAY_MS) continue;
    }
    if (!inWorkHours(tz, now, s)) continue;
    queue.push({ r: r, step: step, email: email, tz: tz });
  }
  queue.sort((a, b) => b.step - a.step); // follow-ups before first emails

  const props = PropertiesService.getScriptProperties();
  const dayKey = 'sent_' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd');
  let sentToday = Number(props.getProperty(dayKey)) || 0, sentNow = 0;

  for (const q of queue) {
    if (sentNow >= s.PER_RUN || sentToday >= s.DAILY_LIMIT || Date.now() - started > 270000) break;
    const row = data[q.r];
    const tid = String(row[c.thread]).trim();

    // Last-second check: never follow up on someone who already replied
    if (q.step > 0 && tid) {
      const th = GmailApp.getThreadById(tid);
      const out = th && threadOutcome(th, mine);
      if (out) { update(sh, data, c, q.r, { status: out.status, next: '', notes: out.note }); continue; }
    }

    const mail = compose(tpl, q.step, rowData(row, c.idx), s);
    if (mail.missing.length) {
      const note = 'Fill in: ' + unique(mail.missing).join(', ') + ' (or add a fallback like {{Company|your team}})';
      if (row[c.notes] !== note) update(sh, data, c, q.r, { notes: note });
      continue;
    }

    if (sentNow) Utilities.sleep(Math.round(s.GAP_SECONDS * 1000 * (0.7 + Math.random() * 0.6)));
    try {
      const refs = String(row[c.msgids]).trim().split(/\s+/).filter(Boolean);
      const res = gmailSend(q.email, mail.subject, mail.body, s, q.step ? tid : '', q.step ? refs : []);
      const stepNo = q.step + 1, done = stepNo >= tpl.length, sentAt = new Date();
      update(sh, data, c, q.r, {
        status: done ? 'Completed' : 'Active',
        step: stepNo,
        last: sentAt,
        next: done ? '' : new Date(sentAt.getTime() + tpl[stepNo].wait * DAY_MS),
        thread: res.threadId,
        msgids: refs.concat(res.messageId ? [res.messageId] : []).join(' '),
        notes: '',
      });
      sentNow++; sentToday++;
      props.setProperty(dayKey, String(sentToday));
      log(q.email, stepNo, q.tz, 'Sent');
    } catch (e) {
      update(sh, data, c, q.r, { status: 'Error', notes: 'Send failed: ' + e.message + ' - clear Status to retry' });
      log(q.email, q.step + 1, q.tz, 'Error: ' + e.message);
      if (/limit|quota|too many/i.test(e.message)) break;
    }
  }
}

/* ================================================================
 *  REPLIES & BOUNCES
 * ================================================================ */

function myAddresses() {
  return [Session.getEffectiveUser().getEmail()].concat(GmailApp.getAliases()).map(a => a.toLowerCase());
}

function threadOutcome(thread, mine) {
  for (const m of thread.getMessages()) {
    const from = m.getFrom().toLowerCase();
    if (mine.some(a => from.indexOf(a) > -1)) continue;
    if (/mailer-daemon|postmaster|mail delivery/.test(from)) return { status: 'Bounced', note: 'Bounce: ' + m.getSubject() };
    const auto = /out of (the )?office|auto(matic)?[- ]?reply|autoreply|away from/i.test(m.getSubject());
    return { status: 'Replied', note: auto ? 'Looks like an auto-reply - set Status back to Active to continue the sequence' : '' };
  }
  return null;
}

function checkInbox(sh, data, c, mine) {
  const byThread = {}, byEmail = {};
  for (let r = 1; r < data.length; r++) {
    const st = String(data[r][c.status]).trim();
    if (st !== 'Active' && st !== 'Completed') continue;
    const t = String(data[r][c.thread]).trim();
    if (t) byThread[t] = r;
    byEmail[String(data[r][c.email]).trim().toLowerCase()] = r;
  }
  if (!Object.keys(byThread).length) return;

  // Replies (and bounces Gmail threads into the original conversation)
  GmailApp.search('newer_than:2d -from:me', 0, 300).forEach(th => {
    const r = byThread[th.getId()];
    if (r === undefined) return;
    const out = threadOutcome(th, mine);
    if (out) update(sh, data, c, r, { status: out.status, next: '', notes: out.note });
  });

  // Bounces that arrive as a separate conversation
  GmailApp.search('newer_than:2d from:(mailer-daemon OR postmaster)', 0, 50).forEach(th => {
    th.getMessages().forEach(m => {
      (m.getPlainBody().match(/[\w.+'-]+@[\w-]+(\.[\w-]+)+/g) || []).forEach(e => {
        const r = byEmail[e.toLowerCase()];
        if (r !== undefined && data[r][c.status] !== 'Bounced') {
          update(sh, data, c, r, { status: 'Bounced', next: '', notes: 'Bounce: ' + m.getSubject() });
        }
      });
    });
  });
}

/* ================================================================
 *  SENDING (Gmail API - keeps follow-ups in the same thread)
 * ================================================================ */

function gmailSend(to, subject, body, s, threadId, refs) {
  const me = Session.getEffectiveUser().getEmail();
  const from = s.SENDER_NAME ? encWord(String(s.SENDER_NAME)) + ' <' + me + '>' : me;
  const resource = { raw: Utilities.base64EncodeWebSafe(buildMime(from, to, subject, body, refs)) };
  if (threadId) resource.threadId = threadId;
  const sent = Gmail.Users.Messages.send(resource, 'me');
  let messageId = '';
  try {
    const meta = Gmail.Users.Messages.get('me', sent.id, { format: 'metadata', metadataHeaders: ['Message-ID'] });
    const h = ((meta.payload && meta.payload.headers) || []).filter(x => x.name.toLowerCase() === 'message-id')[0];
    messageId = h ? h.value : '';
  } catch (e) { /* threading still works via threadId */ }
  return { threadId: sent.threadId, messageId: messageId };
}

function encWord(t) {
  return '=?UTF-8?B?' + Utilities.base64Encode(t, Utilities.Charset.UTF_8) + '?=';
}

function buildMime(from, to, subject, body, refs) {
  const b64 = t => Utilities.base64Encode(t, Utilities.Charset.UTF_8).replace(/.{76}(?=.)/g, '$&\r\n');
  const b = 'part_' + Utilities.getUuid().replace(/-/g, '');
  const h = ['From: ' + from, 'To: ' + to, 'Subject: ' + encWord(subject), 'MIME-Version: 1.0'];
  if (refs && refs.length) h.push('In-Reply-To: ' + refs[refs.length - 1], 'References: ' + refs.join(' '));
  h.push('Content-Type: multipart/alternative; boundary="' + b + '"');
  return h.join('\r\n') + '\r\n\r\n' +
    '--' + b + '\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + b64(body) + '\r\n' +
    '--' + b + '\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + b64(toHtml(body)) + '\r\n' +
    '--' + b + '--';
}

function toHtml(t) {
  return '<div dir="ltr">' + String(t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\r?\n/g, '<br>') + '</div>';
}

/* ================================================================
 *  TEMPLATES
 * ================================================================ */

function compose(tpl, stepIdx, data, s) {
  const missing = [];
  const subject = render(tpl[0].subject, data, missing);
  let body = render(tpl[stepIdx].body, data, missing);
  if (s.FOOTER) body += '\n\n' + s.FOOTER;
  return { subject: stepIdx && !/^re:/i.test(subject) ? 'Re: ' + subject : subject, body: body, missing: missing };
}

function render(text, data, missing) {
  return String(text || '').replace(/\{\{\s*([^}|]+?)\s*(?:\|([^}]*))?\}\}/g, (m, key, fallback) => {
    const v = data[norm(key)];
    const val = v instanceof Date
      ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'd MMM yyyy')
      : String(v == null ? '' : v).trim();
    if (val) return val;
    if (fallback !== undefined) return fallback;
    if (missing) missing.push(key.trim());
    return '';
  });
}

function rowData(row, idx) {
  const d = {};
  for (const k in idx) d[k] = row[idx[k]];
  if (!String(d.firstname || '').trim()) {
    const n = String(d.name || d.fullname || d.contactname || '').trim().split(/\s+/)[0] || '';
    d.firstname = n ? n.charAt(0).toUpperCase() + n.slice(1) : '';
  }
  return d;
}

function getTemplates() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.templates);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .filter(r => String(r[3]).trim())
    .map(r => ({ step: Number(r[0]) || 0, wait: Number(r[1]) || 0, subject: String(r[2]).trim(), body: String(r[3]) }))
    .sort((a, b) => a.step - b.step);
}

function getSettings() {
  const s = {};
  SETTINGS.forEach(r => { s[r[0]] = r[1]; });
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.settings);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
      const k = String(r[0]).trim();
      if (k in s && r[1] !== '') s[k] = r[1];
    });
  }
  ['START_HOUR', 'END_HOUR', 'DAILY_LIMIT', 'PER_RUN', 'GAP_SECONDS'].forEach(k => { s[k] = Number(s[k]); });
  s.SKIP_WEEKENDS = toBool(s.SKIP_WEEKENDS);
  s.PAUSED = toBool(s.PAUSED);
  return s;
}

/* ================================================================
 *  TIMEZONES
 * ================================================================ */

let _countryLookup, _multiLookup;
const _regionLookup = {}, _tzValid = {};

function aliasMap(obj) {
  const out = {};
  for (const k in obj) k.split('|').forEach(a => { out[norm(a)] = obj[k]; });
  return out;
}

function resolveTz(country, region) {
  const cn = norm(country);
  if (!cn) return { tz: '', note: 'TZ: No country - add one, or type a timezone like Europe/Berlin' };
  _multiLookup = _multiLookup || aliasMap(MULTI_TZ);
  _countryLookup = _countryLookup || aliasMap(COUNTRY_TZ);

  const multi = _multiLookup[cn];
  if (multi) {
    const code = multi[0], def = multi[1], warn = multi[2];
    if (!_regionLookup[code]) {
      const m = {};
      for (const tz in REGION_TZ[code]) REGION_TZ[code][tz].split('|').forEach(a => { m[norm(a)] = tz; });
      _regionLookup[code] = m;
    }
    const map = _regionLookup[code];
    const raw = String(region || '');
    const parts = [norm(raw)].concat(raw.split(/[,/;|]/).map(norm)).filter(Boolean);
    for (const p of parts) if (map[p]) return { tz: map[p], note: '' };
    const keys = Object.keys(map).filter(k => k.length >= 4).sort((a, b) => b.length - a.length);
    for (const p of parts) for (const k of keys) if (p.indexOf(k) > -1) return { tz: map[k], note: '' };
    return { tz: def, note: warn ? 'TZ: ' + country + ' has several timezones - used ' + def + '. Add State/City or type the right timezone to fix.' : '' };
  }
  const tz = _countryLookup[cn];
  return tz ? { tz: tz, note: '' } : { tz: '', note: 'TZ: Unknown country "' + country + '" - type a timezone like Europe/Berlin in the Timezone column' };
}

function validTz(tz) {
  if (tz in _tzValid) return _tzValid[tz];
  let ok = true;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date()); }
  catch (e) { ok = !(e && e.name === 'RangeError'); }
  _tzValid[tz] = ok;
  return ok;
}

function localClock(tz, now) {
  const p = Utilities.formatDate(now, tz, 'yyyy-MM-dd-HH-mm').split('-').map(Number);
  return {
    hour: p[3],
    dow: new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(),
    text: Utilities.formatDate(now, tz, 'EEE d MMM, HH:mm'),
  };
}

function inWorkHours(tz, now, s) {
  const c = localClock(tz, now);
  if (s.SKIP_WEEKENDS && (WEEKENDS[tz] || [0, 6]).indexOf(c.dow) > -1) return false;
  return c.hour >= s.START_HOUR && c.hour < s.END_HOUR;
}

function fillTz(sh, data, c) {
  let filled = 0, flagged = 0, changed = false;
  for (let r = 1; r < data.length; r++) {
    if (!String(data[r][c.email]).trim()) continue;
    const cur = String(data[r][c.tz]).trim();
    const oldNote = String(data[r][c.notes]);
    let note = '';
    if (cur) {
      if (!validTz(cur)) note = 'TZ: Invalid timezone "' + cur + '" - use names like Europe/Berlin or America/Chicago';
    } else {
      const res = resolveTz(data[r][c.country], c.region > -1 ? data[r][c.region] : '');
      if (res.tz) { data[r][c.tz] = res.tz; filled++; changed = true; }
      note = res.note;
    }
    if (note) {
      flagged++;
      if (oldNote !== note) { data[r][c.notes] = note; changed = true; }
    } else if (oldNote.indexOf('TZ: ') === 0) {
      data[r][c.notes] = ''; changed = true;
    }
  }
  if (changed) {
    sh.getRange(1, c.tz + 1, data.length, 1).setValues(data.map(r => [r[c.tz]]));
    sh.getRange(1, c.notes + 1, data.length, 1).setValues(data.map(r => [r[c.notes]]));
  }
  return { filled: filled, flagged: flagged };
}

/* ================================================================
 *  SHEET HELPERS
 * ================================================================ */

function norm(v) { return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function toBool(v) { return v === true || /^(true|yes|y|1)$/i.test(String(v).trim()); }
function unique(a) { return a.filter((x, i) => a.indexOf(x) === i); }

function headerIndex(sh) {
  const n = sh.getLastColumn(), idx = {};
  if (!n) return idx;
  sh.getRange(1, 1, 1, n).getValues()[0].forEach((h, i) => {
    const k = norm(h);
    if (k && !(k in idx)) idx[k] = i;
  });
  return idx;
}

function findCol(idx, names) {
  for (const n of names) { const k = norm(n); if (k in idx) return idx[k]; }
  return -1;
}

function cols(sh) {
  const idx = headerIndex(sh), c = { idx: idx };
  for (const k in COLUMNS) c[k] = findCol(idx, COLUMNS[k]);
  return c;
}

function update(sh, data, c, r, vals) {
  for (const k in vals) {
    if (c[k] < 0) continue;
    data[r][c[k]] = vals[k];
    sh.getRange(r + 1, c[k] + 1).setValue(vals[k]);
  }
}

function log(email, step, tz, result) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.log);
  if (!sh) return;
  sh.appendRow([new Date(), email, step, tz ? localClock(tz, new Date()).text : '', tz, result]);
}
