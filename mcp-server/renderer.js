import { chromium } from 'playwright-core';
import sparticuz from '@sparticuz/chromium';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = process.env.FLYER_HTML || path.join(here, 'flyer-studio.html');

let browserP = null;
const LAUNCH_ARGS = [...sparticuz.args, '--no-sandbox'];

// Some hosts mount /tmp noexec, so the bundled Chromium can't start from where it unpacks.
// Fall back to copying it (plus its GL libs and fonts) into a folder that allows execution.
async function launchBundled() {
  const tmpExe = await sparticuz.executablePath();
  if (!process.env.FORCE_COPY) {
    try { return await chromium.launch({ executablePath: tmpExe, args: LAUNCH_ARGS, headless: true }); }
    catch (e) { if (!/EACCES|ETXTBSY|Permission denied|spawn/i.test(String(e.message))) throw e; console.warn('Chromium would not start from', path.dirname(tmpExe), '- copying it to an executable folder'); }
  }
  const src = path.dirname(tmpExe);
  const dirs = [process.env.CHROMIUM_DIR, path.join(here, '.chromium'), path.join(os.homedir(), '.chromium'), path.join(os.tmpdir(), 'chromium-run')].filter(Boolean);
  const tried = [`direct from ${src}`];
  let lastErr;
  for (const dir of dirs) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const f of ['chromium', 'libEGL.so', 'libGLESv2.so', 'libvk_swiftshader.so', 'libvulkan.so.1', 'vk_swiftshader_icd.json']) {
        const from = path.join(src, f), to = path.join(dir, f);
        if (fs.existsSync(from) && (!fs.existsSync(to) || fs.statSync(to).size !== fs.statSync(from).size)) { fs.copyFileSync(from, to); fs.chmodSync(to, 0o755); }
      }
      if (fs.existsSync(path.join(src, 'fonts'))) fs.cpSync(path.join(src, 'fonts'), path.join(dir, 'fonts'), { recursive: true });
      process.env.FONTCONFIG_PATH = path.join(dir, 'fonts');
      process.env.HOME = process.env.HOME || dir;
      return await chromium.launch({ executablePath: path.join(dir, 'chromium'), args: LAUNCH_ARGS, headless: true });
    } catch (e) { lastErr = e; const m = String(e.message).split('\n').slice(0, 2).join(' | '); tried.push(`${dir}: ${m}`); console.warn('Could not run Chromium from', dir, '-', m); }
  }
  throw new Error('Chromium would not start. Tried -> ' + tried.join(' ;; '));
}

function browser() {
  if (!browserP) {
    browserP = process.env.CHROMIUM_PATH
      ? chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true })
      : launchBundled();
    browserP.then((b) => b.on('disconnected', () => { browserP = null; }), () => { browserP = null; });
  }
  return browserP;
}

// Serialise renders: html2canvas on a 2000x1125 stage is heavy.
let chain = Promise.resolve();
export function renderFlyer(flyer, { format = 'png', scale = 1, name = 'AGIWM flyers' } = {}) {
  const job = chain.then(() => doRender(flyer, { format, scale, name }));
  chain = job.catch(() => {});
  return job;
}

async function doRender(flyer, { format, scale, name }) {
  const b = await browser();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await ctx.newPage();
  try {
    const deck = JSON.stringify({ name, i: 0, flyers: [flyer] });
    await page.addInitScript((d) => { try { localStorage.setItem('agiwm-flyer-v2', d); } catch (e) {} }, deck);
    await page.goto(pathToFileURL(HTML).href, { waitUntil: 'load', timeout: 45000 });
    await page.waitForSelector('#stage', { timeout: 15000 });
    await page.waitForTimeout(600);
    // Choose export through the app's own Download menu so format/scale match the UI.
    await page.click('#dlBtn');
    const hint = format === 'jpg'
      ? (scale >= 1 ? 'JPG2000' : 'JPG1280')
      : scale >= 1 ? 'PNG2000' : scale >= 0.9 ? 'PNG1920' : 'PNG1280';
    const items = await page.$$('.pop button, .menu button, [role=menuitem]');
    const want = { PNG2000: /PNG.*2000/, PNG1920: /PNG.*1920/, PNG1280: /PNG.*1280/, JPG2000: /JPG.*2000/, JPG1280: /JPG.*1280/ }[hint];
    let target = null;
    for (const it of items) {
      const t = ((await it.innerText()) || '').replace(/\s+/g, '');
      if (want.test(t)) { target = it; break; }
    }
    if (!target) throw new Error('Could not find the export option in the studio page.');
    // The page downloads the finished image like any website; capture that download.
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), target.click()]);
    const file = await dl.path();
    if (!file) throw new Error('The studio did not produce an image.');
    return fs.readFileSync(file);
  } finally {
    await ctx.close();
  }
}

export async function closeBrowser() { if (browserP) { (await browserP).close(); browserP = null; } }

// Shrink an image (data URL) to at most `max` px on its long side, as JPEG, using the headless browser's canvas.
export async function shrinkImage(dataUrl, max = 1000) {
  const b = await browser();
  const ctx = await b.newContext();
  const page = await ctx.newPage();
  try {
    await page.setContent('<canvas id=c></canvas>');
    return await page.evaluate(async ([u, m]) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('That file is not a readable image.')); img.src = u; });
      const k = Math.min(1, m / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.getElementById('c');
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.88);
    }, [dataUrl, max]);
  } finally { await ctx.close(); }
}
