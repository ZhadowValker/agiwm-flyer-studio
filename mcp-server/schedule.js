// Turns a pasted monthly speaker list ("1st week of November Rev Name ...") into one flyer plan per week.
import crypto from 'node:crypto';
import * as people from './people.js';
import { schParse, schDates, SCH_MONTHS } from './schedparse.js';
import { istToUs, tzParse, usFix } from './tz.js';

const SCHEME = [['royal','sky'],['emerald','sage'],['plum','lavender'],['sunset','peach'],['teal','gold'],['maroon','blush']];
export const TBA = 'TO BE ANNOUNCED';

export function parse(txt) { return schParse(txt); }

const plans = new Map();   // plan id -> plan; the newest few are kept
let last = null;           // the newest plan, for callers that do not pass a plan id (old behaviour)
const KEEP = 50;

// opts: weekday ('saturday'), timeLeft ('6:30 AM IST'), timeRight (leave out: worked out from the India time), colourSets (true), now (Date)
export async function plan(txt, opts = {}) {
  const P = schParse(txt);
  if (!P.items.length) throw new Error('No lines like "1st week ... Name", "Week 1 - Name" or "Jan 10: Name" were found.');
  const D = schDates(P, { weekday: opts.weekday || 'saturday', now: opts.now });
  const timeLeft = opts.timeLeft || '6:30 AM IST', out = [];
  for (const it of D.weeks) {
    let us;
    if (opts.timeRight) {
      // an explicit US time: same moment as given, with the right EDT/EST name for its date
      const [y, m, d] = it.date.split('-').map(Number), ud = new Date(y, m - 1, d - (opts.usDaysBefore ?? 1));
      const date = `${ud.getFullYear()}-${String(ud.getMonth() + 1).padStart(2, '0')}-${String(ud.getDate()).padStart(2, '0')}`;
      us = usFix(date, opts.timeRight);
    } else {
      us = istToUs(it.date, timeLeft) || (() => { throw new Error(`Could not read the India time "${timeLeft}" (use a form like "6:30 AM IST").`); })();
    }
    const k = out.length;
    const args = {
      // photo_url '' so that loading a week into the live flyer does not keep last week's photos
      left_speaker: { name: it.name.toUpperCase(), place: '', photo_url: '', zoom: 1, offset_x: 0, offset_y: 0 },
      right_speaker: { name: TBA, place: '', photo_url: '', zoom: 1, offset_x: 0, offset_y: 0 },
      date_left: { date: it.date, time: timeLeft },
      date_right: { date: us.date, time: us.time },
    };
    let photo = false;
    try { const h = people.search(it.name)[0]; if (h && h.s >= 60) { args.left_speaker.person = h.p.name; delete args.left_speaker.photo_url; photo = true; } } catch {}
    if (opts.colourSets !== false) { const c = SCHEME[k % SCHEME.length]; args.accent = { preset: c[0] }; args.background = { preset: c[1] }; }
    out.push({ week: it.week, speaker: it.name, date: it.date, usDate: us.date, usTime: us.time, photo, args });
  }
  if (!out.length) throw new Error('None of those weeks fall inside that month.');
  if (!tzParse(timeLeft)) throw new Error(`Could not read the time "${timeLeft}".`);
  const id = crypto.randomBytes(5).toString('hex');
  const p = { id, month: SCH_MONTHS[D.mon], year: D.year, weeks: out, skipped: D.skipped, warnings: D.warnings, created: Date.now() };
  plans.set(id, p); while (plans.size > KEEP) plans.delete(plans.keys().next().value);
  last = p;
  return p;
}
export const lastPlan = () => last;
// A plan by id; without an id, the newest plan (kept for old callers).
export function getPlan(id) {
  if (id) { const p = plans.get(String(id)); if (!p) throw new Error(`No plan with id "${id}" (plans are kept while the server runs; make it again with plan_schedule).`); return p; }
  if (!last) throw new Error('Plan a schedule first (plan_schedule).');
  return last;
}
export function weekOf(p, week) {
  const w = p.weeks.find((x) => x.week === week);
  if (!w) throw new Error(`Week ${week} is not in the plan (planned: ${p.weeks.map((x) => x.week).join(', ')}).`);
  return w;
}
