// India / US meeting times. One source for two users: the connector imports it, and the studio
// inlines it (lines starting with "export" or "import" are stripped there; see sync-studio.mjs).
// Keep this file ASCII only and in plain ES5 so it runs in every browser.
//
// The meeting is anchored to the India time (IST, UTC+5:30, no daylight saving). The US box shows
// the same moment in US time: EDT (UTC-4) from the 2nd Sunday of March to the 1st Sunday of
// November, otherwise EST (UTC-5). So 6:30 AM IST is 9:00 PM EDT or 8:00 PM EST the day before.

var TZ_OFF = { IST: 330, EDT: -240, EST: -300, CDT: -300, CST: -360, MDT: -360, MST: -420, PDT: -420, PST: -480 };

function tzNth(y, mon, n) { var f = new Date(Date.UTC(y, mon, 1)).getUTCDay(); return 1 + ((7 - f) % 7) + (n - 1) * 7; }
// true when the given US calendar date (YYYY-MM-DD) falls in daylight saving time
function tzUsDst(date) {
  var d = String(date || '').split('-').map(Number);
  if (d.length !== 3 || !d[0] || !d[1] || !d[2]) return null;
  var t = Date.UTC(d[0], d[1] - 1, d[2]);
  return t >= Date.UTC(d[0], 2, tzNth(d[0], 2, 2)) && t < Date.UTC(d[0], 10, tzNth(d[0], 10, 1));
}
// "6:30 AM IST" -> { h: 6, m: 30, zone: 'IST' } (h is 0-23); null when it cannot be read
function tzParse(time) {
  var m = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*([AaPp])\.?\s*[Mm]\.?\s*([A-Za-z]{3})?\s*$/.exec(String(time || ''));
  if (!m) return null;
  var h = +m[1], mi = m[2] ? +m[2] : 0;
  if (h < 1 || h > 12 || mi > 59) return null;
  h = h % 12 + (/[Pp]/.test(m[3]) ? 12 : 0);
  var z = (m[4] || '').toUpperCase();
  return { h: h, m: mi, zone: TZ_OFF[z] !== undefined ? z : '' };
}
function tzFmt(h, m, zone) {
  var ap = h >= 12 ? 'PM' : 'AM', hh = h % 12 || 12;
  return hh + ':' + (m < 10 ? '0' : '') + m + ' ' + ap + (zone ? ' ' + zone : '');
}
function tzYmd(t) { var d = new Date(t); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
// the UTC instant (ms) of a date + time with a known zone, or null
function tzInstant(date, time) {
  var p = tzParse(time), d = String(date || '').split('-').map(Number);
  if (!p || !p.zone || d.length !== 3 || !d[0]) return null;
  return Date.UTC(d[0], d[1] - 1, d[2], p.h, p.m) - TZ_OFF[p.zone] * 60000;
}
// the US letter (E, C, M, P) of a US zone name, or ''
function tzUsLetter(zone) { var m = /^([ECMP])[DS]T$/.exec(zone || ''); return m ? m[1] : ''; }
// One moment shown in US time: picks EDT/EST (or C/M/P) by the US date. -> { date, time }
function tzToUs(t, letter) {
  letter = letter || 'E';
  var dz = letter + 'DT', sz = letter + 'ST', loc = t + TZ_OFF[dz] * 60000;
  var zone = tzUsDst(tzYmd(loc)) ? dz : sz;
  loc = t + TZ_OFF[zone] * 60000;
  var d = new Date(loc);
  return { date: tzYmd(loc), time: tzFmt(d.getUTCHours(), d.getUTCMinutes(), zone) };
}
function tzToIst(t) { var loc = t + TZ_OFF.IST * 60000, d = new Date(loc); return { date: tzYmd(loc), time: tzFmt(d.getUTCHours(), d.getUTCMinutes(), 'IST') }; }
// The India date + time shown in US time. istToUs('2026-11-21', '6:30 AM IST') -> { date: '2026-11-20', time: '8:00 PM EST' }
function istToUs(date, time, letter) { var t = tzInstant(date, time); return t === null ? null : tzToUs(t, letter); }

// A US time whose EDT/EST name is wrong for its date: keep the same moment and give it the right
// name, so "9:00 PM EDT" on 20 Nov 2026 becomes "8:00 PM EST" (not "9:00 PM EST", an hour off).
// Returns { date, time } (the date can move when the hour crosses midnight); anything it cannot
// read is returned unchanged.
function usFix(date, time) {
  var p = tzParse(time), l = p && tzUsLetter(p.zone);
  if (!l) return { date: date, time: time };
  var dst = tzUsDst(date);
  if (dst === null || (p.zone.charAt(1) === 'D') === dst) return { date: date, time: time };
  return tzToUs(tzInstant(date, time), l);
}
// Old name kept for callers that only want the time text.
function usTz(date, time) { return usFix(date, time).time; }

// Which of the two date boxes is India and which is US: { ist: 'd1', us: 'd2' } (either may be null).
function tzRoles(f) {
  var r = { ist: null, us: null };
  ['d1', 'd2'].forEach(function (k) {
    var p = f && f[k] && tzParse(f[k].time);
    if (!p) return;
    if (p.zone === 'IST' && !r.ist) r.ist = k;
    else if (tzUsLetter(p.zone) && !r.us) r.us = k;
  });
  return r;
}
// Do the two boxes describe the same moment? true / false, or null when they cannot be compared
// (a box hidden, a time without a zone, ...).
function tzSame(f) {
  var r = tzRoles(f);
  if (!r.ist || !r.us) return null;
  if (f[r.ist].show === false || f[r.us].show === false) return null;
  var a = tzInstant(f[r.ist].date, f[r.ist].time), b = tzInstant(f[r.us].date, f[r.us].time);
  if (a === null || b === null) return null;
  return a === b;
}
// The US box that matches the India box: { key: 'd2', date, time } or null.
function tzMatchUs(f) {
  var r = tzRoles(f);
  if (!r.ist || !r.us) return null;
  var u = istToUs(f[r.ist].date, f[r.ist].time, tzUsLetter(tzParse(f[r.us].time).zone));
  return u ? { key: r.us, date: u.date, time: u.time } : null;
}
// Make a (full) flyer's date boxes consistent, in place. opt.anchor: 'ist' = the India box was
// just changed, so the US box follows it; otherwise a US time whose EDT/EST name no longer fits its
// date keeps its moment (and when an India box is there, the US box follows the India box).
// Returns a list of short warnings (empty when everything agrees).
function tzFixFlyer(f, opt) {
  opt = opt || {};
  var warn = [], r = tzRoles(f);
  if (r.us) {
    var b = f[r.us], p = tzParse(b.time), dst = tzUsDst(b.date);
    var wrongName = p && dst !== null && (p.zone.charAt(1) === 'D') !== dst;
    var m = tzMatchUs(f);
    if (m && (opt.anchor === 'ist' || wrongName)) { b.date = m.date; b.time = m.time; }
    else if (wrongName) { var u = usFix(b.date, b.time); b.date = u.date; b.time = u.time; }
  }
  if (tzSame(f) === false) {
    var m2 = tzMatchUs(f);
    warn.push('The two time boxes are not the same moment: ' + f[r.ist].time + ' on ' + f[r.ist].date + ' is ' + m2.time + ' on ' + m2.date + ' in the US, but the US box says ' + f[r.us].time + ' on ' + f[r.us].date + '.');
  }
  return warn;
}

export { TZ_OFF, tzParse, tzFmt, tzUsDst, tzInstant, tzToUs, tzToIst, istToUs, usFix, usTz, tzRoles, tzSame, tzMatchUs, tzFixFlyer };
