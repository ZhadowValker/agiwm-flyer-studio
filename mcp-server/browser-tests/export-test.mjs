// node export-test.mjs [html] [n] [size]   exports n times in one page load; the first export must match the later ones (issue 6)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { route, CHROME, SERVER, STUDIO, IMGS, makeImages } from './harness.mjs';
import os from 'node:os'; import path from 'node:path';
const [html = STUDIO, n = '3', sizeHint = 'PNG.*1280'] = process.argv.slice(2), out = path.join(os.tmpdir(), 'export-test');
const flyer = JSON.parse(fs.readFileSync(new URL('./sample-flyer.json', import.meta.url)));
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
await route(ctx);
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.addInitScript((d) => { localStorage.setItem('agiwm-flyer-v2', d); }, JSON.stringify({ name: 'AGIWM flyers', i: 0, flyers: [flyer] }));
await page.goto('file://' + html, { waitUntil: 'load' });
await page.waitForTimeout(400);
const files = [];
for (let i = 0; i < +n; i++) {
  await page.click('#dlBtn');
  const items = await page.$$('.pop button');
  let t; for (const it of items) if (new RegExp(sizeHint).test((await it.innerText()).replace(/\s+/g, ''))) { t = it; break; }
  const [dl] = await Promise.all([page.waitForEvent('download'), t.click()]);
  const f = `${out}-${i}.png`; fs.copyFileSync(await dl.path(), f); files.push(f);
  if (i === 0) console.log('download name:', dl.suggestedFilename());
  await page.waitForTimeout(300);
}
const imgs = files.map((f) => PNG.sync.read(fs.readFileSync(f)));
function diff(a, c) { let d = 0, minY = 1e9, maxY = -1; for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) { const k = (y * a.width + x) * 4; if (Math.abs(a.data[k] - c.data[k]) + Math.abs(a.data[k + 1] - c.data[k + 1]) + Math.abs(a.data[k + 2] - c.data[k + 2]) > 30) { d++; minY = Math.min(minY, y); maxY = Math.max(maxY, y); } } return { pixels: d, rows: d ? [minY, maxY] : null }; }
let ok = errs.length === 0;
for (let i = 1; i < imgs.length; i++) { const d = diff(imgs[0], imgs[i]); console.log(`export 0 vs ${i}:`, JSON.stringify(d)); if (d.pixels) ok = false; }
console.log('errors', errs);
await b.close(); console.log(ok ? 'ALL OK' : 'SOME FAILED');
