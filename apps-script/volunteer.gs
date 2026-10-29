/*
 * Friends of Green Lake Crew — Volunteer Sign-Up backend
 * ------------------------------------------------------
 * A Google Apps Script web app that sits between the public sign-up page
 * (volunteer/index.html on GitHub Pages) and the volunteer Google Sheet.
 * The sheet stays private: the web app runs as the sheet owner.
 *
 * Tabs (matched case-insensitively; created with headers if missing):
 *   slots       one row per job/shift that needs people
 *   volunteers  one row per person (upserted by email)
 *   signups     one row per person-in-a-slot (links slot_id + volunteer_id/email)
 *
 * Column headers are matched loosely (case, spaces and underscores ignored),
 * so "Slot ID", "slot_id" and "slotid" all work. See SCHEMA below for the
 * names each column may use. Columns the script writes are added if absent.
 *
 * slots columns:
 *   slot_id      optional — blank IDs are filled in automatically
 *   role         required — the job name; rows without one are ignored
 *   date         e.g. 11/8/2026 (or put full date+time in start/end)
 *   start, end   e.g. 9:00 AM / 11:30 AM
 *   spots        how many people are needed (default 1)
 *   location, description   optional, shown on the page
 *   active       optional — "no"/"false"/"hide" hides the slot
 *
 * To cancel someone, delete their signups row or set its status to "cancelled".
 *
 * SETUP (one time):
 *   1. In the sheet: Extensions → Apps Script. Replace Code.gs with this file.
 *   2. Run `setup` once (authorize when prompted) — it adds any missing headers.
 *   3. Deploy → New deployment → type "Web app".
 *        Execute as: Me        Who has access: Anyone
 *   4. Copy the web app URL (ends in /exec) into assets/volunteer-config.js.
 *   After editing this script later: Deploy → Manage deployments → edit →
 *   Version "New version" so the same /exec URL picks up the change.
 */

var CONFIG = {
  SPREADSHEET_ID: '1hjiUU5XY1xANeQrjqaALe68cfIlyUU8Ni_Z_icdRNpk',
  ORG_NAME: 'Friends of Green Lake Crew',
  SIGNUP_PAGE_URL: 'https://tootallted.github.io/friends-of-green-lake-crew/volunteer/',
  SEND_CONFIRMATION_EMAIL: true,
  HIDE_PAST_SLOTS: true,
  DEFAULT_SLOT_MINUTES: 60 // used when a slot has a start time but no end time
};

// First name in each list is the header written when the column is created.
var SCHEMA = {
  slots: {
    id: ['slot_id', 'slotid', 'id'],
    role: ['role', 'job', 'title', 'name', 'slot', 'position'],
    date: ['date', 'day'],
    start: ['start', 'start_time', 'starttime', 'from', 'begin'],
    end: ['end', 'end_time', 'endtime', 'to', 'finish'],
    capacity: ['spots', 'capacity', 'needed', 'volunteers_needed', 'quantity', 'qty', 'count', 'slots'],
    location: ['location', 'where', 'place'],
    description: ['description', 'details', 'notes', 'desc'],
    active: ['active', 'show', 'visible', 'open']
  },
  volunteers: {
    id: ['volunteer_id', 'volunteerid', 'id'],
    first: ['first_name', 'firstname', 'first'],
    last: ['last_name', 'lastname', 'last'],
    email: ['email', 'email_address', 'emailaddress'],
    phone: ['mobile_phone', 'phone', 'mobile', 'mobilephone', 'phone_number', 'phonenumber', 'cell', 'mobile_phone_number'],
    created: ['created_at', 'created', 'timestamp', 'date_added'],
    updated: ['updated_at', 'updated', 'last_updated']
  },
  signups: {
    id: ['signup_id', 'signupid', 'id'],
    slot: ['slot_id', 'slotid', 'slot'],
    volunteer: ['volunteer_id', 'volunteerid', 'volunteer'],
    email: ['email', 'email_address', 'emailaddress'],
    name: ['volunteer_name', 'name', 'full_name'],
    role: ['role', 'job', 'slot_name'],
    when: ['slot_time', 'when', 'time'],
    status: ['status'],
    created: ['created_at', 'created', 'timestamp', 'signed_up_at']
  }
};

// Columns the script itself writes; added to the sheet if missing.
var WRITES = {
  slots: ['id', 'role', 'date', 'start', 'end', 'capacity', 'location', 'description'],
  volunteers: ['id', 'first', 'last', 'email', 'phone', 'created', 'updated'],
  signups: ['id', 'slot', 'volunteer', 'email', 'name', 'role', 'when', 'created']
};

/* ---------- Web app entry points ---------- */

function doGet(e) {
  try {
    var ss = openSheet_();
    return json_({ ok: true, slots: publicSlots_(ss) });
  } catch (err) {
    return json_({ ok: false, error: 'Could not load slots: ' + err.message });
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Bad request.' });
  }
  try {
    if (body.action === 'lookup') return json_(lookup_(body));
    if (body.action === 'signup') return json_(signup_(body));
    return json_({ ok: false, error: 'Unknown action.' });
  } catch (err) {
    return json_({ ok: false, error: 'Something went wrong: ' + err.message });
  }
}

/* ---------- Actions ---------- */

function lookup_(body) {
  var email = normEmail_(body.email);
  if (!isEmail_(email)) return { ok: true, mySlotIds: [] };
  var ss = openSheet_();
  return { ok: true, mySlotIds: activeSignups_(ss).filter(function (s) { return s.email === email; }).map(function (s) { return s.slotId; }) };
}

function signup_(body) {
  // Honeypot: bots fill hidden fields. Pretend success, write nothing.
  if (body.website) return { ok: true, signedUp: [], mySlotIds: [] };

  var first = clean_(body.firstName, 60);
  var last = clean_(body.lastName, 60);
  var email = normEmail_(body.email);
  var phone = formatPhone_(body.phone);
  var slotIds = (Array.isArray(body.slotIds) ? body.slotIds : []).map(String).filter(unique_);

  if (!first || !last) return fail_('Please enter your first and last name.');
  if (!isEmail_(email)) return fail_('Please enter a valid email address.');
  if (!phone) return fail_('Please enter a valid mobile phone number.');
  if (!slotIds.length) return fail_('Please pick at least one slot.');
  if (slotIds.length > 20) return fail_('That is a lot of slots! Please pick 20 or fewer at a time.');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return fail_('The sign-up sheet is busy. Please try again in a moment.');
  try {
    var ss = openSheet_();
    var slots = readSlots_(ss);
    var byId = {};
    slots.forEach(function (s) { byId[s.id] = s; });

    var signups = activeSignups_(ss);
    var counts = countBySlot_(signups);
    var mine = signups.filter(function (s) { return s.email === email; })
      .map(function (s) { return byId[s.slotId]; })
      .filter(Boolean);
    var mineIds = mine.map(function (s) { return s.id; });

    var picked = [];
    for (var i = 0; i < slotIds.length; i++) {
      var slot = byId[slotIds[i]];
      if (!slot || !slot.visible) return fail_('One of the slots you picked is no longer available. Please refresh and try again.', true);
      if (mineIds.indexOf(slot.id) !== -1) return fail_('You are already signed up for ' + label_(slot) + '.', true);
      if ((counts[slot.id] || 0) >= slot.capacity) return fail_(label_(slot) + ' just filled up. Please pick another slot.', true);
      var clash = mine.concat(picked).filter(function (o) { return overlaps_(o, slot); })[0];
      if (clash) return fail_(label_(slot) + ' overlaps with ' + label_(clash) + '. You can only be in one place at a time!', true);
      picked.push(slot);
    }

    var volunteer = upsertVolunteer_(ss, { first: first, last: last, email: email, phone: phone });

    var t = table_(ss, 'signups');
    var now = new Date();
    var rows = picked.map(function (slot) {
      return rowFor_(t, {
        id: newId_('U'),
        slot: slot.id,
        volunteer: volunteer.id,
        email: email,
        name: first + ' ' + last,
        role: slot.role,
        when: slot.dateLabel + ' ' + slot.timeLabel,
        created: now
      });
    });
    t.sheet.getRange(t.sheet.getLastRow() + 1, 1, rows.length, t.width).setValues(rows);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  if (CONFIG.SEND_CONFIRMATION_EMAIL) {
    try { sendConfirmation_(email, first, picked); } catch (err) { console.warn('Email failed: ' + err.message); }
  }

  return {
    ok: true,
    signedUp: picked.map(publicSlot_),
    mySlotIds: mineIds.concat(picked.map(function (s) { return s.id; })),
    slots: publicSlots_(ss)
  };
}

/* ---------- Sheet access ---------- */

function openSheet_() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function norm_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Returns { sheet, width, col: {field: index}, rows, display } for a tab.
function table_(ss, name) {
  var schema = SCHEMA[name];
  var sheet = ss.getSheets().filter(function (s) { return norm_(s.getName()) === name; })[0];
  if (!sheet) sheet = ss.insertSheet(name);

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var normHeaders = headers.map(norm_);
  var col = {};
  Object.keys(schema).forEach(function (field) {
    var aliases = schema[field].map(norm_);
    for (var a = 0; a < aliases.length; a++) {
      var idx = normHeaders.indexOf(aliases[a]);
      if (idx !== -1 && !isTaken_(col, idx)) { col[field] = idx; break; }
    }
  });

  // Append any columns we need to write that the tab doesn't have yet.
  var width = normHeaders.filter(String).length ? lastCol : 0;
  WRITES[name].forEach(function (field) {
    if (col[field] === undefined) {
      sheet.getRange(1, width + 1).setValue(schema[field][0]).setFontWeight('bold');
      col[field] = width;
      width++;
    }
  });
  if (sheet.getFrozenRows() === 0) sheet.setFrozenRows(1);

  var n = sheet.getLastRow() - 1;
  var range = n > 0 ? sheet.getRange(2, 1, n, width) : null;
  return {
    sheet: sheet,
    width: width,
    col: col,
    rows: range ? range.getValues() : [],
    display: range ? range.getDisplayValues() : []
  };
}

function isTaken_(col, idx) {
  return Object.keys(col).some(function (k) { return col[k] === idx; });
}

function cell_(t, row, field) {
  return t.col[field] === undefined ? '' : row[t.col[field]];
}

function rowFor_(t, obj) {
  var row = [];
  for (var i = 0; i < t.width; i++) row.push('');
  Object.keys(obj).forEach(function (field) {
    if (t.col[field] !== undefined) row[t.col[field]] = obj[field];
  });
  return row;
}

/* ---------- Slots ---------- */

function readSlots_(ss) {
  var tz = ss.getSpreadsheetTimeZone();
  var t = table_(ss, 'slots');
  var now = Date.now();
  var slots = [];

  t.rows.forEach(function (row, i) {
    var disp = t.display[i];
    var role = String(cell_(t, row, 'role')).trim();
    if (!role) return;

    var id = String(cell_(t, row, 'id')).trim();
    if (!id) {
      id = newId_('S');
      t.sheet.getRange(i + 2, t.col.id + 1).setValue(id);
    }

    var dateDisp = cell_(t, disp, 'date');
    var dateRaw = cell_(t, row, 'date');
    var start = toDateTime_(cell_(t, disp, 'start'), cell_(t, row, 'start'), dateDisp, dateRaw, tz);
    var end = toDateTime_(cell_(t, disp, 'end'), cell_(t, row, 'end'), dateDisp, dateRaw, tz);
    var allDay = false;
    if (!start) {
      var d = parseDateParts_(dateDisp, dateRaw, tz);
      if (!d) return; // no date at all — can't schedule it
      start = build_(d, { h: 0, mi: 0 }, tz);
      end = new Date(start.getTime() + 24 * 3600 * 1000);
      allDay = true;
    }
    if (!end || end <= start) end = new Date(start.getTime() + CONFIG.DEFAULT_SLOT_MINUTES * 60000);

    var active = norm_(cell_(t, row, 'active'));
    var cap = parseInt(cell_(t, row, 'capacity'), 10);

    slots.push({
      id: id,
      role: role,
      start: start,
      end: end,
      allDay: allDay,
      capacity: isNaN(cap) ? 1 : Math.max(cap, 0),
      location: String(cell_(t, disp, 'location')).trim(),
      description: String(cell_(t, disp, 'description')).trim(),
      dateKey: Utilities.formatDate(start, tz, 'yyyy-MM-dd'),
      dateLabel: Utilities.formatDate(start, tz, 'EEEE, MMMM d'),
      timeLabel: allDay ? 'All day' : timeRange_(start, end, tz),
      visible: ['no', 'n', 'false', 'hide', 'hidden', '0'].indexOf(active) === -1 &&
        !(CONFIG.HIDE_PAST_SLOTS && end.getTime() < now)
    });
  });

  slots.sort(function (a, b) { return a.start - b.start || a.role.localeCompare(b.role); });
  return slots;
}

function publicSlots_(ss) {
  var counts = countBySlot_(activeSignups_(ss));
  return readSlots_(ss).filter(function (s) { return s.visible; }).map(function (s) {
    var p = publicSlot_(s);
    p.filled = counts[s.id] || 0;
    p.remaining = Math.max(s.capacity - p.filled, 0);
    return p;
  });
}

function publicSlot_(s) {
  return {
    id: s.id,
    role: s.role,
    startMs: s.start.getTime(),
    endMs: s.end.getTime(),
    dateKey: s.dateKey,
    dateLabel: s.dateLabel,
    timeLabel: s.timeLabel,
    capacity: s.capacity,
    location: s.location,
    description: s.description
  };
}

function label_(s) {
  return s.role + ' (' + s.dateLabel + ', ' + s.timeLabel + ')';
}

function overlaps_(a, b) {
  return a.start < b.end && b.start < a.end;
}

function timeRange_(start, end, tz) {
  var fmt = function (d) { return Utilities.formatDate(d, tz, 'h:mm a').replace(':00 ', ' '); };
  return fmt(start) + ' – ' + fmt(end);
}

/* ---------- Date/time parsing ----------
 * Display strings are preferred over raw values: time-only cells come back
 * as 1899-12-30 dates whose historical timezone offsets skew the minutes. */

function toDateTime_(timeDisp, timeRaw, dateDisp, dateRaw, tz) {
  var tm = parseTimeParts_(timeDisp);
  if (!tm) return null;
  var d = parseDateParts_(timeDisp, timeRaw, tz) || parseDateParts_(dateDisp, dateRaw, tz);
  return d ? build_(d, tm, tz) : null;
}

function parseDateParts_(disp, raw, tz) {
  if (raw instanceof Date && raw.getFullYear() > 1900) {
    var p = Utilities.formatDate(raw, tz, 'yyyy-M-d').split('-');
    return { y: +p[0], m: +p[1], d: +p[2] };
  }
  var s = String(disp || '').trim();
  var m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return { y: m[3].length === 2 ? 2000 + +m[3] : +m[3], m: +m[1], d: +m[2] };
  if (!/[a-z]{3}/i.test(s)) return null;
  var parsed = new Date(s.replace(/\d{1,2}:\d{2}.*$/, ''));
  if (isNaN(parsed) || parsed.getFullYear() < 2000) return null;
  return { y: parsed.getFullYear(), m: parsed.getMonth() + 1, d: parsed.getDate() };
}

function parseTimeParts_(disp) {
  var s = String(disp || '').toLowerCase();
  var m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?\s*m?/) || s.match(/\b(\d{1,2})()\s*([ap])\.?\s*m\b/);
  if (!m) return null;
  var h = +m[1];
  var mi = m[2] ? +m[2] : 0;
  if (m[3] === 'p' && h < 12) h += 12;
  if (m[3] === 'a' && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return { h: h, mi: mi };
}

function build_(d, tm, tz) {
  var str = d.y + '-' + pad_(d.m) + '-' + pad_(d.d) + ' ' + pad_(tm.h) + ':' + pad_(tm.mi);
  return Utilities.parseDate(str, tz, 'yyyy-MM-dd HH:mm');
}

function pad_(n) {
  return (n < 10 ? '0' : '') + n;
}

/* ---------- Signups & volunteers ---------- */

function activeSignups_(ss) {
  var t = table_(ss, 'signups');
  return t.rows.map(function (row) {
    return {
      slotId: String(cell_(t, row, 'slot')).trim(),
      email: normEmail_(cell_(t, row, 'email')),
      status: norm_(cell_(t, row, 'status'))
    };
  }).filter(function (s) {
    return s.slotId && s.status.indexOf('cancel') === -1 && s.status !== 'removed';
  });
}

function countBySlot_(signups) {
  var counts = {};
  signups.forEach(function (s) { counts[s.slotId] = (counts[s.slotId] || 0) + 1; });
  return counts;
}

function upsertVolunteer_(ss, v) {
  var t = table_(ss, 'volunteers');
  var now = new Date();
  for (var i = 0; i < t.rows.length; i++) {
    if (normEmail_(cell_(t, t.rows[i], 'email')) !== v.email) continue;
    var r = i + 2;
    var id = String(cell_(t, t.rows[i], 'id')).trim();
    if (!id) {
      id = newId_('V');
      t.sheet.getRange(r, t.col.id + 1).setValue(id);
    }
    t.sheet.getRange(r, t.col.first + 1).setValue(v.first);
    t.sheet.getRange(r, t.col.last + 1).setValue(v.last);
    t.sheet.getRange(r, t.col.phone + 1).setValue("'" + v.phone);
    t.sheet.getRange(r, t.col.updated + 1).setValue(now);
    return { id: id };
  }
  var newId = newId_('V');
  t.sheet.appendRow(rowFor_(t, {
    id: newId, first: v.first, last: v.last, email: v.email,
    phone: "'" + v.phone, created: now, updated: now
  }));
  return { id: newId };
}

/* ---------- Email ---------- */

function sendConfirmation_(email, first, slots) {
  if (!slots.length) return;
  var items = slots.map(function (s) {
    return '<li><strong>' + esc_(s.role) + '</strong> — ' + esc_(s.dateLabel) + ', ' + esc_(s.timeLabel) +
      (s.location ? ' · ' + esc_(s.location) : '') + '</li>';
  }).join('');
  MailApp.sendEmail({
    to: email,
    name: CONFIG.ORG_NAME,
    subject: 'You\'re signed up to volunteer — ' + (slots.length === 1 ? slots[0].role + ', ' + slots[0].dateLabel : slots.length + ' slots'),
    htmlBody:
      '<p>Hi ' + esc_(first) + ',</p>' +
      '<p>Thanks for volunteering with ' + esc_(CONFIG.ORG_NAME) + '! You\'re signed up for:</p>' +
      '<ul>' + items + '</ul>' +
      '<p>Need to change something? Just reply to this email.</p>' +
      '<p>Want to grab another slot? <a href="' + CONFIG.SIGNUP_PAGE_URL + '">' + CONFIG.SIGNUP_PAGE_URL + '</a></p>'
  });
}

/* ---------- Helpers ---------- */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(msg, refresh) {
  return { ok: false, error: msg, refresh: !!refresh };
}

function clean_(s, max) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normEmail_(s) {
  return String(s || '').trim().toLowerCase();
}

function isEmail_(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254;
}

function formatPhone_(s) {
  var digits = String(s || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
  if (digits.length === 10) return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
  if (digits.length >= 7 && digits.length <= 15) return '+' + digits;
  return '';
}

function newId_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}

function unique_(v, i, arr) {
  return arr.indexOf(v) === i;
}

function esc_(s) {
  return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}

/* ---------- Sheet menu & one-time setup ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Volunteer sign-up')
    .addItem('Set up tabs & fill missing slot IDs', 'setup')
    .addToUi();
}

// Run once from the Apps Script editor: adds missing headers to all three tabs
// and fills in IDs for any slots that don't have one.
function setup() {
  var ss = openSheet_();
  ['slots', 'volunteers', 'signups'].forEach(function (name) { table_(ss, name); });
  var slots = readSlots_(ss);
  console.log('Ready. ' + slots.length + ' slot(s) found, ' + slots.filter(function (s) { return s.visible; }).length + ' visible.');
}
