// Maps friendly tool input onto the studio's flyer state.
import { z } from 'zod';
const STYLE_LAYERS = ['ttl','sub','loc','scr','hd','tags','tg0','tg1','tg2','lbL','nmL','plL','lbR','nmR','plR','d1dt','d1wd','d1tm','d2dt','d2wd','d2tm','zl','zid','zpw','yl','yh','jt','logo','left','right','d1','d2','zoom','yt','btn'];
import * as people from './people.js';
import { shrinkImage } from './renderer.js';
import { fetchImage } from './images.js';
import { tzFixFlyer, tzRoles } from './tz.js';
import { INVITE_DEFAULTS } from './invite.js';

export const FONTS = ['Montserrat','Poppins','Oswald','Bebas Neue','Anton','Playfair Display','Cinzel','Cormorant Garamond','Lora','Great Vibes','Allura','Dancing Script','Pacifico','Noto Sans Telugu','Noto Serif Telugu'];
export const FLAGS = ['none','in','us','uk','ca'];
export const BG_PRESETS = { blush:['#fde4ea','#f4b9c7'], peach:['#fff1e0','#f7c59f'], sunrise:['#ffe9a8','#f28c8c'], sage:['#eef5e4','#b9d3a5'], sky:['#e6f1ff','#b3cdf0'], lavender:['#f3e9ff','#cdb4ee'], gold:['#fff3cf','#e7b85a'], night:['#2b1d3a','#7a2e4d'] };
export const ACCENTS = { maroon:['#7d1226','#a63348'], royal:['#2a3a8c','#5b7be0'], emerald:['#0e5d4a','#2fa17f'], plum:['#5b1a6e','#c24b8a'], sunset:['#b0301c','#f08a24'], teal:['#0b4f6c','#27a7b8'], charcoal:['#2a2a2e','#5d5d66'] };

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'use a #RRGGBB colour');
const font = z.enum(FONTS).optional();
const photo = z.string().max(14000000).describe('https link to a JPG/PNG/WebP/GIF, a Google Drive share link (the file must be shared as "Anyone with the link"), a data:image URL, or an upload link from POST /api/upload (send the image bytes with the live key; the answer has a short-lived "url" to paste here)').optional();

const person = z.object({
  show: z.boolean().optional(), label: z.string().max(60).optional().describe('small script label, e.g. "Word by"'),
  person: z.string().max(80).optional().describe('someone in the photo library (e.g. "Pastor Elizabeth Amara"): fills their photo, and their name if you give none'),
  name: z.string().max(60).optional().describe('up to 60 characters; long names wrap onto two lines'), place: z.string().max(60).optional().describe('second line, e.g. "Hyderabad, India." Giving a new name without a place clears the old place.'),
  photo_url: photo, zoom: z.number().min(1).max(4).optional(),
  offset_x: z.number().min(-100).max(100).optional().describe('move the photo left/right in % of the card; with fit "cover" it is limited to (zoom-1)*50 so the photo always fills the card'),
  offset_y: z.number().min(-100).max(100).optional().describe('move the photo up/down in % of the card; same limit as offset_x'),
  fit: z.enum(['cover', 'contain']).optional().describe('"cover" (default) fills the card, cropping the photo; "contain" shows the whole photo with a blurred copy filling the empty space'), font,
}).optional();
const dateBox = z.object({
  show: z.boolean().optional(), flag: z.enum(FLAGS).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD; weekday and 24th style are automatic'),
  time: z.string().max(30).optional().describe('e.g. "6:30 AM IST" or "8:00 PM EST". US zones follow daylight saving: EDT from the 2nd Sunday of March to the 1st Sunday of November, otherwise EST; IST is 9.5h ahead of EDT, 10.5h ahead of EST. When you change only the India box, the US box is worked out from it (date and time). A US time whose EDT/EST name does not fit its date keeps its moment and gets the right name (9:00 PM EDT on 20 Nov 2026 becomes 8:00 PM EST).'), font,
}).optional();

export const flyerShape = {
  title: z.string().max(40).optional().describe('big title, default AGIWM'),
  subtitle: z.string().max(110).optional(), location: z.string().max(60).optional(),
  script_word: z.string().max(30).optional().describe('big script word, default Women’s'),
  heading: z.string().max(40).optional().describe('default "Prayer Meeting"'),
  tags: z.array(z.string().max(30)).max(3).optional().describe('three small taglines'),
  left_speaker: person, right_speaker: person, date_left: dateBox, date_right: dateBox,
  zoom: z.object({ show: z.boolean().optional(), label: z.string().max(40).optional(), meeting_id: z.string().max(30).optional(), passcode: z.string().max(30).optional() }).optional(),
  youtube: z.object({ show: z.boolean().optional(), label: z.string().max(40).optional(), handle: z.string().max(40).optional() }).optional(),
  join_button: z.object({ show: z.boolean().optional(), text: z.string().max(20).optional() }).optional(),
  background: z.object({
    preset: z.enum(Object.keys(BG_PRESETS)).optional().describe('named gradient'),
    color: hex.optional().describe('solid colour (turns gradient off)'),
    gradient: z.object({ from: hex, to: hex, angle: z.number().min(0).max(360).optional() }).optional(),
    image_url: photo, lighten: z.number().min(0).max(1).optional(), glow: z.number().min(0).max(1).optional(),
  }).optional(),
  accent: z.object({ preset: z.enum(Object.keys(ACCENTS)).optional(), color: hex.optional(), color2: hex.optional(), gold: hex.optional(), ink: hex.optional() }).optional().describe('plate / pill / button colours'),
  fonts: z.object({ title: font, subtitle: font, location: font, script_word: font, heading: font, tags: font, zoom: font, youtube: font, button: font }).optional(),
  text_styles: z.record(z.enum(STYLE_LAYERS), z.object({
    color: z.union([hex, z.literal('')]).optional().describe('#rrggbb, or "" for the original colour'),
    opacity: z.number().min(0).max(1).optional(),
    size: z.number().min(0.4).max(2.5).optional().describe('size multiplier, 1 = normal'),
    spacing: z.number().min(-3).max(30).optional().describe('extra letter spacing in px'),
    text: z.string().max(40).optional().describe('only for d1dt, d1wd, d2dt, d2wd: replaces the automatic date/weekday text'),
    font: z.union([font, z.literal('')]).optional().describe('font for this one text only ("" = follow the group font)'),
    weight: z.enum(['', '400', '500', '600', '700', '800', '900']).optional().describe('font weight'),
    capitals: z.enum(['', 'none', 'uppercase', 'lowercase', 'capitalize']).optional().describe('text case'),
    move_x: z.number().min(-600).max(600).optional().describe('px to move right (negative = left)'),
    move_y: z.number().min(-400).max(400).optional().describe('px to move down (negative = up)'),
    rotate: z.number().min(-180).max(180).optional().describe('degrees'),
    visible: z.boolean().optional().describe('false hides this text'),
  })).optional().describe('Every text and object can be styled on its own. Text layers: ttl title, sub subtitle, loc location, scr script word, hd heading, tg0/tg1/tg2 the three taglines (tags = all three), lbL/nmL/plL left label/name/second line, lbR/nmR/plR right, d1dt/d1wd/d1tm and d2dt/d2wd/d2tm date, weekday, time, zl zoom heading, zid meeting-id line, zpw password line, yl youtube heading, yh handle, jt button text. Object layers (only opacity, size as scale, move_x, move_y, rotate): logo, left, right (speaker cards), d1, d2 (time boxes), zoom, yt, btn')
};

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

async function toDataUrl(src) {
  if (!src) return '';
  const raw = await fetchImage(src);
  return raw.length > 470 * 1024 ? await shrinkImage(raw, 1000) : raw;
}

// The photo always covers its card with fit "cover": it can move at most (zoom-1)*50 % each way.
export function maxOffset(p) { return p && p.fit === 'contain' ? 50 : Math.max(0, ((+p?.z || 1) - 1) * 50); }
export function clampFraming(p) {
  if (!p || typeof p !== 'object') return p;
  const m = maxOffset(p), c = (v) => Math.round(Math.max(-m, Math.min(m, +v || 0)) * 10) / 10;
  if (p.x !== undefined) p.x = c(p.x);
  if (p.y !== undefined) p.y = c(p.y);
  return p;
}

const warnings = new WeakMap();
export const warningsOf = (f) => warnings.get(f) || [];

// After a change (`partial`) has been merged into `full`: make the two date boxes agree (the US box
// follows the India box when only the India box changed) and keep photo framing inside the card.
// Defaults are filled in only for boxes that end up changed. Returns warnings.
export function settle(full, partial = {}) {
  const f = { d1: { ...INVITE_DEFAULTS.d1, ...(full.d1 || {}) }, d2: { ...INVITE_DEFAULTS.d2, ...(full.d2 || {}) } };
  const r = tzRoles(f), touched = (k) => !!(k && partial[k] && (partial[k].date !== undefined || partial[k].time !== undefined));
  const warn = tzFixFlyer(f, { anchor: touched(r.ist) && !touched(r.us) ? 'ist' : '' });
  for (const k of ['d1', 'd2']) {
    const before = { ...INVITE_DEFAULTS[k], ...(full[k] || {}) };
    if (before.date !== f[k].date || before.time !== f[k].time) full[k] = { ...(full[k] || {}), date: f[k].date, time: f[k].time };
  }
  for (const k of ['left', 'right']) if (full[k]) clampFraming(full[k]);
  return warn;
}

// a: tool input. opt.fresh: a one-off flyer (make_flyer / schedules), so speakers that are not
// given show "To be announced" instead of the template's sample names.
export async function buildFlyer(a, opt = {}) {
  const f = {};
  Object.assign(f, clean({ title: a.title, sub: a.subtitle, loc: a.location, script: a.script_word, heading: a.heading }));
  if (a.tags) f.tags = [0, 1, 2].map((i) => a.tags[i] ?? ['Pray', 'Be Encouraged', 'Grow Together'][i]);
  for (const [key, src] of [['left', a.left_speaker], ['right', a.right_speaker]]) {
    if (!src) continue;
    const o = clean({ show: src.show, label: src.label, name: src.name, place: src.place, z: src.zoom, x: src.offset_x, y: src.offset_y, fit: src.fit });
    if (src.name !== undefined && src.place === undefined && !src.person) o.place = '';
    if (src.person) {
      const p = await people.find(src.person);
      o.photo = p.dataUrl; o.z = o.z ?? 1; o.x = o.x ?? 0; o.y = o.y ?? 0;
      if (src.name === undefined) o.name = p.name.toUpperCase();
      if (src.place === undefined) o.place = p.place || '';
    }
    if (src.photo_url !== undefined) o.photo = await toDataUrl(src.photo_url);
    f[key] = o;
  }
  if (a.date_left) f.d1 = clean(a.date_left);
  if (a.date_right) f.d2 = clean(a.date_right);
  if (a.zoom) f.zoom = clean({ show: a.zoom.show, label: a.zoom.label, id: a.zoom.meeting_id, pass: a.zoom.passcode });
  if (a.youtube) f.yt = clean(a.youtube);
  if (a.join_button) f.btn = clean(a.join_button);
  if (a.background) {
    const b = a.background, o = {};
    if (b.preset) Object.assign(o, { grad: true, g1: BG_PRESETS[b.preset][0], g2: BG_PRESETS[b.preset][1] });
    if (b.gradient) Object.assign(o, { grad: true, g1: b.gradient.from, g2: b.gradient.to, ang: b.gradient.angle ?? 135 });
    if (b.color) Object.assign(o, { grad: false, base: b.color });
    if (b.image_url !== undefined) o.img = await toDataUrl(b.image_url);
    Object.assign(o, clean({ lighten: b.lighten, glow: b.glow }));
    f.bg = o;
  }
  if (a.accent) {
    const c = {};
    if (a.accent.preset) Object.assign(c, { maroon: ACCENTS[a.accent.preset][0], accent2: ACCENTS[a.accent.preset][1], accentGrad: true });
    if (a.accent.color) c.maroon = a.accent.color;
    if (a.accent.color2) Object.assign(c, { accent2: a.accent.color2, accentGrad: true });
    Object.assign(c, clean({ gold: a.accent.gold, ink: a.accent.ink }));
    f.col = c;
  }
  const fo = {};
  const F = a.fonts || {};
  Object.assign(fo, clean({ title: F.title, sub: F.subtitle, loc: F.location, script: F.script_word, heading: F.heading, tags: F.tags, zoom: F.zoom, yt: F.youtube, btn: F.button,
    left: a.left_speaker?.font, right: a.right_speaker?.font, d1: a.date_left?.font, d2: a.date_right?.font }));
  if (Object.keys(fo).length) f.fonts = fo;
  if (a.text_styles) {
    const sty = {};
    for (const [k, v] of Object.entries(a.text_styles)) {
      const o = clean({ col: v.color, op: v.opacity, sz: v.size, ls: v.spacing, tx: v.text, font: v.font, wt: v.weight, cs: v.capitals, dx: v.move_x, dy: v.move_y, rot: v.rotate, vis: v.visible });
      if (!Object.keys(o).length) continue;
      for (const t of (k === 'tags' ? ['tg0', 'tg1', 'tg2'] : [k])) sty[t] = { ...(sty[t] || {}), ...o };
    }
    if (Object.keys(sty).length) f.sty = sty;
  }
  if (opt.fresh) {
    for (const k of ['left', 'right']) if (!f[k] || (f[k].name === undefined && !(k === 'left' ? a.left_speaker : a.right_speaker)?.person)) f[k] = { place: '', ...(f[k] || {}), name: TBA_NAME };
  }
  // The page's own sanitiser fills every missing field from the AGIWM defaults.
  if (f.d1) delete f.d1.font; if (f.d2) delete f.d2.font;
  for (const k of ['left', 'right']) if (f[k]) delete f[k].font;
  // One-off flyers are complete now, so their dates can be settled here; changes to the live flyer
  // are settled by live.patch after merging.
  if (opt.fresh) warnings.set(f, settle(f, f));
  return f;
}
export const TBA_NAME = 'TO BE ANNOUNCED';

// Default text / object styles, as the studio has them (used to trim get_flyer's answer).
const TEXT_STY = { col: '', op: 1, sz: 1, ls: 0, dx: 0, dy: 0, rot: 0, vis: true, font: '', cs: '', wt: '', tx: '' };
const OBJ_STY = { op: 1, sz: 1, dx: 0, dy: 0, rot: 0 };
const OBJ_LAYERS = new Set(['logo', 'left', 'right', 'd1', 'd2', 'zoom', 'yt', 'btn']);
// A copy for showing to Claude: photos as "(set)", and styles / fonts that are just the defaults left out.
export function trimForDisplay(flyer) {
  const f = JSON.parse(JSON.stringify(flyer || {}));
  for (const [p, k] of [['left', 'photo'], ['right', 'photo'], ['bg', 'img']]) if (f[p] && f[p][k]) f[p][k] = '(set)';
  delete f.logo; delete f.id;
  if (f.sty) {
    for (const [k, v] of Object.entries(f.sty)) {
      const d = OBJ_LAYERS.has(k) ? OBJ_STY : TEXT_STY;
      for (const [kk, vv] of Object.entries(v || {})) if (d[kk] === vv) delete v[kk];
      if (!v || !Object.keys(v).length) delete f.sty[k];
    }
    if (!Object.keys(f.sty).length) delete f.sty;
  }
  if (f.fonts) { for (const k of Object.keys(f.fonts)) if (!f.fonts[k]) delete f.fonts[k]; if (!Object.keys(f.fonts).length) delete f.fonts; }
  return f;
}

// One short line for the live feed, e.g. "left speaker: name=PASTOR X; dates".
export function describe(a) {
  const bits = [];
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined || ['format', 'size', 'preview', 'by'].includes(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = Object.entries(v).filter(([ik, iv]) => iv !== undefined && !/photo_url|image_url/.test(ik)).map(([ik, iv]) => `${ik}=${typeof iv === 'object' ? '...' : String(iv).slice(0, 40)}`).join(', ');
      bits.push(`${k.replace(/_/g, ' ')}: ${inner}`);
    } else bits.push(`${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(' / ') : String(v).slice(0, 60)}`);
  }
  return bits.join('; ') || 'no changes';
}
