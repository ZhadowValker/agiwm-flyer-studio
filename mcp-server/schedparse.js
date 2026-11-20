// Reads a pasted monthly speaker list. One source for two users: the connector imports it, and the
// studio inlines it (lines starting with "export" or "import" are stripped there; see sync-studio.mjs).
// Keep this file ASCII only and in plain ES5.
//
// Lines it understands (one speaker each; the name may also be on the next line):
//   1st week of November Rev Name      Week 1 - Name        2nd week...... Dr Name
//   Jan 10: Name    January 10th - Name    10 Jan - Name    10th of January: Name

var SCH_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
var SCH_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
var SCH_MON_RE = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)';
var SCH_SEP = '[\\s:\\-\\u2013\\u2014.,)]*';

function schMonth(w) {
  w = String(w || '').toLowerCase().replace(/\.$/, '');
  for (var i = 0; i < 12; i++) if (SCH_MONTHS[i] === w || (w.length >= 3 && SCH_MONTHS[i].indexOf(w) === 0)) return i;
  return -1;
}
function schTidy(n) {
  return String(n || '').replace(/[\u{1F000}-\u{1FFFF}\u2600-\u27bf\ufe0f\u200d]/gu, '').replace(/[*_~]/g, '')
    .replace(/^[\s.\u2026:\-\u2013\u2014,]+/, '').replace(/[\s.\u2026:\-\u2013\u2014,]+$/, '').replace(/\s+/g, ' ').slice(0, 60);
}
// The month the list is about: the first month named in the text. A small-letter "may" counts only
// next to a day number ("may 10", "10 may"), so "Sis Ruth may lead worship" does not make it May.
function schFindMonth(txt) {
  var re = new RegExp('\\b' + SCH_MON_RE + '\\b\\.?', 'gi'), m, best = -1;
  while ((m = re.exec(txt))) {
    var w = m[1], low = w.toLowerCase();
    if (low === 'may' && w !== 'May' && w !== 'MAY') {
      var before = txt.slice(Math.max(0, m.index - 6), m.index), after = txt.slice(m.index + w.length, m.index + w.length + 6);
      if (!/\d(st|nd|rd|th)?\s*(of\s*)?$/i.test(before) && !/^\s*\d/.test(after)) continue;
    }
    // three-letter words that are also ordinary words only count with a capital or next to a number
    if (/^(mar|jan|jun|dec|sep|oct|aug|nov|feb|apr|jul)$/.test(low) && w === low) {
      var b2 = txt.slice(Math.max(0, m.index - 6), m.index), a2 = txt.slice(m.index + w.length, m.index + w.length + 6);
      if (!/\d(st|nd|rd|th)?\s*(of\s*)?$/i.test(b2) && !/^\.?\s*\d/.test(a2)) continue;
    }
    best = schMonth(w); break;
  }
  return best;
}

function schParse(txt) {
  txt = String(txt || '');
  var lines = txt.replace(/\r/g, '').split('\n'), items = [];
  var ym = /\b(20\d\d)\b/.exec(txt);
  var reWeek = /^\W*(\d+)\s*(?:st|nd|rd|th)?\s*week(?:\s+of\s+[A-Za-z]+)?(.*)$/i;
  var reWeek2 = new RegExp('^\\W*week\\s*(?:no\\.?\\s*)?(\\d+)' + SCH_SEP + '(.*)$', 'i');
  var reMD = new RegExp('^\\W*' + SCH_MON_RE + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(20\\d\\d))?(?!\\d)' + SCH_SEP + '(.*)$', 'i');
  var reDM = new RegExp('^\\W*(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + SCH_MON_RE + '\\.?(?:,?\\s*(20\\d\\d))?' + SCH_SEP + '(.*)$', 'i');
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i].trim(), it = null, m;
    if ((m = reWeek.exec(ln))) it = { week: +m[1], rest: m[2] };
    else if ((m = reWeek2.exec(ln))) it = { week: +m[1], rest: m[2] };
    else if ((m = reMD.exec(ln))) it = { mon: schMonth(m[1]), day: +m[2], year: m[3] ? +m[3] : 0, rest: m[4] };
    else if ((m = reDM.exec(ln))) it = { mon: schMonth(m[2]), day: +m[1], year: m[3] ? +m[3] : 0, rest: m[4] };
    if (!it || it.week === 0 || it.week > 5 || it.day > 31) continue;
    var name = schTidy(it.rest);
    if (!name && lines[i + 1] && !reWeek.test(lines[i + 1].trim()) && !reWeek2.test(lines[i + 1].trim()) && !/\bweek\b/i.test(lines[i + 1])) { name = schTidy(lines[i + 1]); i++; }
    if (!name) continue;
    var o = { name: name };
    if (it.week) o.week = it.week; else { o.mon = it.mon; o.day = it.day; if (it.year) o.year = it.year; }
    items.push(o);
  }
  var mon = schFindMonth(txt);
  if (mon < 0) for (var j = 0; j < items.length; j++) if (items[j].mon !== undefined) { mon = items[j].mon; break; }
  return { mon: mon, year: ym ? +ym[1] : 0, items: items };
}

function schPad(n) { return (n < 10 ? '0' : '') + n; }
function schYmd(d) { return d.getFullYear() + '-' + schPad(d.getMonth() + 1) + '-' + schPad(d.getDate()); }
function schNth(y, mo, wd, n) { var add = (wd - new Date(y, mo, 1).getDay() + 7) % 7, d = new Date(y, mo, 1 + add + 7 * (n - 1)); return d.getMonth() === mo ? d : null; }
function schYear(mo, now) { return mo < now.getMonth() ? now.getFullYear() + 1 : now.getFullYear(); }

// Dates for a parsed list. opt: { weekday: 0-6 or 'saturday' (default Saturday), now: Date }
// -> { mon, year, weeks: [{ week, name, date: 'YYYY-MM-DD' }], skipped: [names], warnings: [text] }
function schDates(P, opt) {
  opt = opt || {};
  var now = opt.now || new Date(), wd = opt.weekday;
  if (typeof wd === 'string') wd = SCH_DAYS.indexOf(wd.toLowerCase());
  if (typeof wd !== 'number' || wd < 0 || wd > 6) wd = 6;
  var mo = P.mon >= 0 ? P.mon : (now.getMonth() + 1) % 12;
  var yr = P.year || schYear(mo, now);
  var weeks = [], skipped = [], warnings = [], today = schYmd(now);
  P.items.forEach(function (it) {
    var d;
    if (it.week) d = schNth(yr, mo, wd, it.week);
    else {
      var y = it.year || P.year || schYear(it.mon, now);
      d = new Date(y, it.mon, it.day);
      if (d.getMonth() !== it.mon) d = null;
    }
    if (!d) { skipped.push(it.name); return; }
    var w = it.week || Math.ceil(d.getDate() / 7), ds = schYmd(d);
    if (ds < today) warnings.push(it.name + ': ' + ds + ' is in the past.');
    weeks.push({ week: w, name: it.name, date: ds });
  });
  return { mon: mo, year: yr, weeks: weeks, skipped: skipped, warnings: warnings };
}

export { SCH_MONTHS, SCH_DAYS, schParse, schDates, schFindMonth, schYmd };
