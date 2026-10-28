// The shared "current flyer": Claude (MCP), the studio page(s) and later the WhatsApp bot all read and change it here.
import fs from 'node:fs';
import path from 'node:path';

const DATA = process.env.DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), 'data');
const FILE = path.join(DATA, 'live-flyer.json');
fs.mkdirSync(DATA, { recursive: true });

let st = { version: 0, flyer: {}, feed: [] };
try { st = { ...st, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
const clients = new Set();

// US zone names follow daylight saving by date (EDT from the 2nd Sunday of March to the 1st Sunday of November, else EST).
export function usTz(date, time) {
  const m = /^(.*?)(\s*)\b([ECMP])[DS]T\s*$/i.exec(time || ''), d = String(date || '').split('-').map(Number);
  if (!m || d.length !== 3 || !d[0]) return time;
  const nth = (y, mon, n) => 1 + ((7 - new Date(Date.UTC(y, mon, 1)).getUTCDay()) % 7) + (n - 1) * 7;
  const t = Date.UTC(d[0], d[1] - 1, d[2]);
  const dst = t >= Date.UTC(d[0], 2, nth(d[0], 2, 2)) && t < Date.UTC(d[0], 10, nth(d[0], 10, 1));
  return m[1] + m[2] + m[3].toUpperCase() + (dst ? 'D' : 'S') + 'T';
}
function fixZones(f) { for (const k of ['d1', 'd2']) if (f[k]?.time && f[k]?.date) f[k].time = usTz(f[k].date, f[k].time); return f; }

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export function deepMerge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) out[k] = isObj(b[k]) && isObj(a[k]) ? deepMerge(a[k], b[k]) : b[k];
  return out;
}
function save() { try { fs.writeFileSync(FILE, JSON.stringify(st)); } catch (e) { console.warn('could not save live flyer:', e.message); } }
function emit(origin, entry) {
  const data = JSON.stringify({ version: st.version, flyer: st.flyer, entry, origin });
  for (const c of clients) c.write(`data: ${data}\n\n`);
}
function note(by, text) {
  const entry = { t: Date.now(), by, text: String(text).slice(0, 300) };
  st.feed = [entry, ...st.feed].slice(0, 40); return entry;
}

export const get = () => ({ version: st.version, flyer: st.flyer, feed: st.feed.slice(0, 20) });

// A change from Claude / a bot: merge the named fields into the current flyer.
export function patch(appShapePartial, { by = 'Claude', text = 'Updated the flyer' } = {}) {
  st.flyer = fixZones(deepMerge(st.flyer, appShapePartial)); st.version++;
  const e = note(by, text); save(); emit('server', e); return st.version;
}
// The studio page sent its whole flyer. '@keep' means "keep the photo you already have".
export function replace(flyer, client, { by = 'Studio', text } = {}) {
  const f = JSON.parse(JSON.stringify(flyer || {}));
  for (const [p, k] of [['left', 'photo'], ['right', 'photo'], ['bg', 'img']]) if (f[p] && f[p][k] === '@keep') f[p][k] = st.flyer[p]?.[k] ?? '';
  st.flyer = f; st.version++;
  const e = text ? note(by, text) : null; save(); emit(client || 'unknown', e); return st.version;
}
export function reset(by = 'Claude') { st.flyer = {}; st.version++; const e = note(by, 'Reset the flyer to the original layout'); save(); emit('server', e); return st.version; }

export function subscribe(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  clients.add(res);
  const ka = setInterval(() => res.write(': keep-alive\n\n'), 20000);
  req.on('close', () => { clearInterval(ka); clients.delete(res); });
}
