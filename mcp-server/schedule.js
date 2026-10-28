// Turns a pasted monthly speaker list ("1st week of November Rev Name ...") into one flyer plan per week.
import * as people from './people.js';

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const SCHEME = [['royal','sky'],['emerald','sage'],['plum','lavender'],['sunset','peach'],['teal','gold'],['maroon','blush']];
const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

const tidy = (n) => n.replace(/[\u{1F000}-\u{1FFFF}☀-➿️‍]/gu, '').replace(/[*_~]/g, '')
  .replace(/^[\s.…:\-–—,]+/, '').replace(/[\s.…:\-–—,]+$/, '').replace(/\s+/g, ' ').slice(0, 60);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parse(txt) {
  const lines = String(txt || '').replace(/\r/g, '').split('\n'), low = String(txt || '').toLowerCase();
  let mon = -1; MONTHS.forEach((m, i) => { if (mon < 0 && new RegExp('\\b' + m + '\\b').test(low)) mon = i; });
  const ym = /\b(20\d\d)\b/.exec(txt || ''), items = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\W*(\d+)\s*(?:st|nd|rd|th)?\s*week(?:\s+of\s+[A-Za-z]+)?(.*)$/i.exec(lines[i].trim());
    if (!m) continue;
    let name = tidy(m[2]);
    if (!name && lines[i + 1] && !/week/i.test(lines[i + 1])) { name = tidy(lines[i + 1]); i++; }
    if (name) items.push({ week: +m[1], name });
  }
  return { mon, year: ym ? +ym[1] : 0, items };
}

const nthWeekday = (y, mo, wd, n) => { const add = (wd - new Date(y, mo, 1).getDay() + 7) % 7; const d = new Date(y, mo, 1 + add + 7 * (n - 1)); return d.getMonth() === mo ? d : null; };

// opts: weekday ('saturday'), timeLeft, timeRight, usDaysBefore (1), colourSets (true)
export async function plan(txt, opts = {}) {
  const P = parse(txt); if (!P.items.length) throw new Error('No lines like "1st week ... Name" were found.');
  const now = new Date(), mo = P.mon >= 0 ? P.mon : (now.getMonth() + 1) % 12;
  const yr = P.year || (mo < now.getMonth() ? now.getFullYear() + 1 : now.getFullYear());
  const wd = Math.max(0, DAYS.indexOf(String(opts.weekday || 'saturday').toLowerCase()));
  const before = opts.usDaysBefore ?? 1, out = [], skipped = [];
  for (const it of P.items) {
    const d = nthWeekday(yr, mo, wd, it.week); if (!d) { skipped.push(it.name); continue; }
    const k = out.length, us = new Date(d.getFullYear(), d.getMonth(), d.getDate() - before);
    const args = {
      left_speaker: { name: it.name.toUpperCase(), place: '' },
      date_left: { date: ymd(d), time: opts.timeLeft || '6:30 AM IST' },
      date_right: { date: ymd(us), time: opts.timeRight || '9:00 PM EDT' },
    };
    let photo = false;
    try { const h = people.search(it.name)[0]; if (h && h.s >= 60) { args.left_speaker.person = h.p.name; args.left_speaker.name = it.name.toUpperCase(); photo = true; } } catch {}
    if (opts.colourSets !== false) { const c = SCHEME[k % SCHEME.length]; args.accent = { preset: c[0] }; args.background = { preset: c[1] }; }
    out.push({ week: it.week, speaker: it.name, date: ymd(d), usDate: ymd(us), photo, args });
  }
  if (!out.length) throw new Error('None of those weeks fall inside that month.');
  last = { month: MONTHS[mo], year: yr, weeks: out, skipped };
  return last;
}
let last = null;
export const lastPlan = () => last;
