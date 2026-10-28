// Maps friendly tool input onto the studio's flyer state.
import { z } from 'zod';
import * as people from './people.js';
import { shrinkImage } from './renderer.js';

export const FONTS = ['Montserrat','Poppins','Oswald','Bebas Neue','Anton','Playfair Display','Cinzel','Cormorant Garamond','Lora','Great Vibes','Allura','Dancing Script','Pacifico','Noto Sans Telugu','Noto Serif Telugu'];
export const FLAGS = ['none','in','us','uk','ca'];
export const BG_PRESETS = { blush:['#fde4ea','#f4b9c7'], peach:['#fff1e0','#f7c59f'], sunrise:['#ffe9a8','#f28c8c'], sage:['#eef5e4','#b9d3a5'], sky:['#e6f1ff','#b3cdf0'], lavender:['#f3e9ff','#cdb4ee'], gold:['#fff3cf','#e7b85a'], night:['#2b1d3a','#7a2e4d'] };
export const ACCENTS = { maroon:['#7d1226','#a63348'], royal:['#2a3a8c','#5b7be0'], emerald:['#0e5d4a','#2fa17f'], plum:['#5b1a6e','#c24b8a'], sunset:['#b0301c','#f08a24'], teal:['#0b4f6c','#27a7b8'], charcoal:['#2a2a2e','#5d5d66'] };

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'use a #RRGGBB colour');
const font = z.enum(FONTS).optional();
const photo = z.string().describe('https URL or data:image URL of the photo').optional();

const person = z.object({
  show: z.boolean().optional(), label: z.string().max(60).optional().describe('small script label, e.g. "Word by"'),
  person: z.string().max(80).optional().describe('someone in the photo library (e.g. "Pastor Elizabeth Amara"): fills their photo, and their name if you give none'),
  name: z.string().max(60).optional(), place: z.string().max(60).optional().describe('second line, e.g. "Hyderabad, India."'),
  photo_url: photo, zoom: z.number().min(1).max(4).optional(), offset_x: z.number().min(-100).max(100).optional(), offset_y: z.number().min(-100).max(100).optional(), font,
}).optional();
const dateBox = z.object({
  show: z.boolean().optional(), flag: z.enum(FLAGS).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD; weekday and 24th style are automatic'),
  time: z.string().max(30).optional().describe('e.g. "6:30 AM IST"'), font,
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
};

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

async function toDataUrl(src) {
  if (!src) return '';
  if (src.startsWith('data:image/')) return src;
  if (!/^https:\/\//i.test(src)) throw new Error('Photos must be https URLs or data:image URLs.');
  const r = await fetch(src, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Could not download ${src} (${r.status}).`);
  const type = (r.headers.get('content-type') || '').split(';')[0];
  if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) throw new Error(`${src} is not a PNG, JPG, WebP or GIF image.`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) throw new Error('Photo is over 8 MB.');
  const raw = `data:${type};base64,${buf.toString('base64')}`;
  return buf.length > 350 * 1024 ? await shrinkImage(raw, 1000) : raw;
}

export async function buildFlyer(a) {
  const f = {};
  Object.assign(f, clean({ title: a.title, sub: a.subtitle, loc: a.location, script: a.script_word, heading: a.heading }));
  if (a.tags) f.tags = [0, 1, 2].map((i) => a.tags[i] ?? ['Pray', 'Be Encouraged', 'Grow Together'][i]);
  for (const [key, src] of [['left', a.left_speaker], ['right', a.right_speaker]]) {
    if (!src) continue;
    const o = clean({ show: src.show, label: src.label, name: src.name, place: src.place, z: src.zoom, x: src.offset_x, y: src.offset_y });
    if (src.person) {
      const p = await people.find(src.person);
      o.photo = p.dataUrl; o.z = o.z ?? 1; o.x = o.x ?? 0; o.y = o.y ?? 0;
      if (src.name === undefined) o.name = p.name.toUpperCase();
      if (src.place === undefined && p.place) o.place = p.place;
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
  // The page's own sanitiser fills every missing field from the AGIWM defaults.
  if (f.d1) delete f.d1.font; if (f.d2) delete f.d2.font;
  for (const k of ['left', 'right']) if (f[k]) delete f[k].font;
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
