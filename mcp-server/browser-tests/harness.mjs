// Offline helpers for loading the studio in headless Chromium: html2canvas and Google Fonts are
// served from local npm packages (the container blocks cdnjs and Google Fonts).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const NM = path.join(path.dirname(new URL(import.meta.url).pathname), 'node_modules');
export const CHROME = process.env.CHROME_PATH || process.env.CHROMIUM_PATH;
if (!CHROME) { console.error('Set CHROME_PATH to a Chrome or Chromium executable.'); process.exit(2); }
export const HERE = path.dirname(new URL(import.meta.url).pathname);
export const SERVER = path.join(HERE, '..');
export const STUDIO = path.join(SERVER, '..', 'index.html');
export const IMGS = path.join(HERE, '.images');
// Test pictures, drawn on a canvas in the browser (portrait, landscape, small, palette PNG, bad files).
export async function makeImages(browser) {
  if (fs.existsSync(path.join(IMGS, 'palette.png'))) return IMGS;
  fs.mkdirSync(IMGS, { recursive: true });
  const pg = await browser.newPage();
  const out = await pg.evaluate(() => {
    const mk = (w, h, c, type) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
      g.fillStyle = c; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 20) { g.fillStyle = `rgb(${y * 255 / h | 0},100,${200 - y * 150 / h | 0})`; g.fillRect(0, y, w, 8); }
      g.fillStyle = '#fadcbe'; g.beginPath(); g.ellipse(w / 2, h / 4, w / 5, h / 7, 0, 0, 7); g.fill(); return cv.toDataURL(type || 'image/jpeg', 0.9); };
    return { 'portrait.jpg': mk(600, 900, '#c87850'), 'portrait2.jpg': mk(620, 920, '#5078c8'), 'landscape.jpg': mk(900, 600, '#50c878'), 'small.jpg': mk(200, 200, '#b4b428') };
  });
  for (const [n, u] of Object.entries(out)) fs.writeFileSync(path.join(IMGS, n), Buffer.from(u.split(',')[1], 'base64'));
  await pg.close();
  fs.writeFileSync(path.join(IMGS, 'palette.png'), palettePng());
  fs.writeFileSync(path.join(IMGS, 'fake.heic'), Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(200)]));
  fs.writeFileSync(path.join(IMGS, 'empty.jpg'), Buffer.alloc(0));
  fs.writeFileSync(path.join(IMGS, 'corrupt.jpg'), Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 7919) & 255)));
  return IMGS;
}
// A 600x800 indexed-colour (palette) PNG with a transparent background, written by hand.
function palettePng() {
  const zlib = require('node:zlib'), W = 600, H = 800, rows = [];
  for (let y = 0; y < H; y++) { const r = Buffer.alloc(W + 1); for (let x = 0; x < W; x++) { const e = ((x - 300) / 200) ** 2 + ((y - 400) / 300) ** 2 <= 1; r[x + 1] = x >= 250 && x < 350 ? 2 : e ? 1 : 0; } rows.push(r); }
  const crc = (b) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 3;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('PLTE', Buffer.from([255, 255, 255, 200, 30, 60, 20, 90, 200])), chunk('tRNS', Buffer.from([0])), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

function fontCss(url) {
  const u = new URL(url), out = [];
  for (const fam of u.searchParams.getAll('family')) {
    const name = fam.split(':')[0].replace(/\+/g, ' ');
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    const dir = path.join(NM, '@fontsource', slug);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!/^\d00\.css$/.test(f)) continue;
      out.push(fs.readFileSync(path.join(dir, f), 'utf8').replace(/url\(\.\/files\//g, `url(https://fonts.gstatic.com/fs/${slug}/files/`));
    }
  }
  return out.join('\n');
}
export let blocked = [];
export async function route(ctx) {
  await ctx.route('**/*', async (r) => {
    const url = r.request().url();
    if (/^https:\/\/cdnjs\.cloudflare\.com\/.*html2canvas/.test(url)) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(NM, 'html2canvas/dist/html2canvas.min.js')) });
    if (url.startsWith('https://fonts.googleapis.com/css2')) return r.fulfill({ contentType: 'text/css', body: fontCss(url), headers: { 'Access-Control-Allow-Origin': '*' } });
    let m;
    if ((m = /^https:\/\/fonts\.gstatic\.com\/fs\/([^/]+)\/files\/(.+)$/.exec(url))) return r.fulfill({ contentType: 'font/woff2', body: fs.readFileSync(path.join(NM, '@fontsource', m[1], 'files', m[2])), headers: { 'Access-Control-Allow-Origin': '*' } });
    if (/^https?:\/\/(localhost|127\.0\.0\.1)|^file:|^data:|^blob:/.test(url)) return r.continue();
    blocked.push(url);
    return r.abort();
  });
}
