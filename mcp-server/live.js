// The shared "current flyer": Claude (MCP), the studio page(s) and later the WhatsApp bot all read and change it here.
import fs from 'node:fs';
import path from 'node:path';

const DATA = process.env.DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), 'data');
const FILE = path.join(DATA, 'live-flyer.json');
fs.mkdirSync(DATA, { recursive: true });

let st = { version: 0, flyer: {}, feed: [] };
try { st = { ...st, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
const clients = new Set();

// Dates and photo framing are settled by flyer.js (shared with make_flyer). usTz stays exported
// for old callers.
export { usTz } from './tz.js';
import { settle } from './flyer.js';

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
  // the studio sends while someone types: one entry per burst instead of one per keystroke
  const top = st.feed[0];
  if (top && top.by === entry.by && top.text === entry.text && entry.t - top.t < 120000) { top.t = entry.t; return top; }
  st.feed = [entry, ...st.feed].slice(0, 40); return entry;
}

export const get = () => ({ version: st.version, flyer: st.flyer, feed: st.feed.slice(0, 20) });

// A change from Claude / a bot: merge the named fields into the current flyer.
// Returns the new version; warnings (e.g. time boxes that disagree) are put in `out.warnings`.
export function patch(appShapePartial, { by = 'Claude', text = 'Updated the flyer', out } = {}) {
  const f = deepMerge(st.flyer, appShapePartial), w = settle(f, appShapePartial);
  st.flyer = f; st.version++;
  if (out) out.warnings = w;
  const e = note(by, text); save(); emit('server', e); return st.version;
}
export class Conflict extends Error { constructor() { super('The live flyer changed since this edit was made.'); this.status = 409; } }
// The studio page sent its whole flyer. '@keep' means "keep the photo you already have".
// baseVersion: the version the studio's edit was made on; if the flyer has changed since (Claude or
// another studio), the edit is refused (Conflict) so it cannot silently undo the other change. The
// studio then fetches the new flyer, puts its own change on top and sends again. Old clients that do
// not send baseVersion keep the old last-write-wins behaviour.
export function replace(flyer, client, { by = 'Studio', text, baseVersion } = {}) {
  if (baseVersion !== undefined && baseVersion !== null && +baseVersion !== st.version) throw new Conflict();
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
