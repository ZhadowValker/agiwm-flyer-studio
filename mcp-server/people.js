// Photo library: people the flyer bot/Claude can look up by name.
// Files live in DATA_DIR/photos (any .jpg/.png/.webp; the file name is the person's name),
// plus DATA_DIR/people.json for extra details (aliases, place).
import fs from 'node:fs';
import path from 'node:path';
import { shrinkImage } from './renderer.js';

const DATA = process.env.DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), 'data');
const PHOTOS = path.join(DATA, 'photos');
const META = path.join(DATA, 'people.json');
const EXT = /\.(jpe?g|png|webp|gif)$/i;
const TITLES = /\b(pastor|pr|ps|sis|sister|bro|brother|dr|mrs|mr|ms|rev|evangelist|prophetess|and|family|amp)\b/g;

fs.mkdirSync(PHOTOS, { recursive: true });
const norm = (s) => String(s || '').toLowerCase().replace(/[_\-.]+/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const core = (s) => norm(s).replace(TITLES, ' ').replace(/\s+/g, ' ').trim();
const slug = (s) => norm(s).replace(/ /g, '-').slice(0, 60) || 'person';
const cache = new Map();

function readMeta() { try { return JSON.parse(fs.readFileSync(META, 'utf8')); } catch { return {}; } }
function writeMeta(m) { fs.writeFileSync(META, JSON.stringify(m, null, 2)); }

export function list() {
  const meta = readMeta(), out = [];
  for (const f of fs.readdirSync(PHOTOS)) {
    if (!EXT.test(f)) continue;
    const key = f.replace(EXT, ''), m = meta[key] || {};
    out.push({ key, file: f, name: m.name || key.replace(/[_\-]+/g, ' '), aliases: m.aliases || [], place: m.place || '' });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function search(q) {
  const want = core(q); if (!want) return [];
  const toks = want.split(' ');
  const scored = list().map((p) => {
    const names = [p.name, ...p.aliases].map(core);
    let s = 0;
    for (const n of names) {
      if (n === want) s = Math.max(s, 100);
      else if (n.includes(want) || want.includes(n)) s = Math.max(s, 70);
      else { const nt = n.split(' '); const hit = toks.filter((t) => nt.includes(t) || nt.some((x) => x.startsWith(t) && t.length > 2)).length; if (hit) s = Math.max(s, 20 + 40 * hit / Math.max(toks.length, nt.length)); }
    }
    return { p, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  return scored;
}

export async function photoOf(p) {
  const file = path.join(PHOTOS, p.file), st = fs.statSync(file), ck = file + st.mtimeMs;
  if (cache.has(ck)) return cache.get(ck);
  const mime = /png$/i.test(file) ? 'image/png' : /webp$/i.test(file) ? 'image/webp' : /gif$/i.test(file) ? 'image/gif' : 'image/jpeg';
  const raw = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  const url = st.size > 350 * 1024 ? await shrinkImage(raw, 1000) : raw;
  cache.set(ck, url); return url;
}

// Resolve a name to one person, or explain why not.
export async function find(name) {
  const hits = search(name);
  if (!hits.length) throw new Error(`No one named "${name}" in the photo library. Known: ${list().map((p) => p.name).slice(0, 25).join(', ') || '(library is empty)'}.`);
  if (hits[0].s < 100 && hits[1] && hits[1].s === hits[0].s) throw new Error(`"${name}" matches several people: ${hits.slice(0, 5).map((h) => h.p.name).join(', ')}. Use the full name.`);
  const p = hits[0].p;
  return { ...p, dataUrl: await photoOf(p) };
}

export async function add({ name, aliases = [], place = '', dataUrl }) {
  if (!name) throw new Error('A name is required.');
  const small = await shrinkImage(dataUrl, 1000);
  const key = slug(name);
  fs.writeFileSync(path.join(PHOTOS, key + '.jpg'), Buffer.from(small.split(',')[1], 'base64'));
  const meta = readMeta(); meta[key] = { name, aliases, place }; writeMeta(meta);
  return { key, name };
}

export function remove(name) {
  const hits = search(name); if (!hits.length) throw new Error(`No one named "${name}".`);
  const p = hits[0].p; fs.unlinkSync(path.join(PHOTOS, p.file));
  const meta = readMeta(); delete meta[p.key]; writeMeta(meta); return p.name;
}
