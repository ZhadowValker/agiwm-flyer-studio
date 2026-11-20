import { chromium } from 'playwright-core';
import sparticuz from '@sparticuz/chromium';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = process.env.FLYER_HTML || path.join(here, 'flyer-studio.html');

let browserP = null;
// --single-process / --no-zygote made Chromium fall over when a page context was closed (the
// next render then got a dead browser). Run it with its normal processes. Set
// CHROMIUM_SINGLE_PROCESS=1 to go back to the old arguments on a host that limits processes.
const DROP = process.env.CHROMIUM_SINGLE_PROCESS === '1' ? [] : ['--single-process', '--no-zygote'];
export const LAUNCH_ARGS = [...sparticuz.args.filter((a) => !DROP.includes(a)), '--no-sandbox', '--disable-dev-shm-usage'];
const LAUNCH_MS = +process.env.RENDER_LAUNCH_TIMEOUT_MS || 60000;
const STEP_MS = +process.env.RENDER_TIMEOUT_MS || 60000;
const QUEUE_CAP = +process.env.RENDER_QUEUE_CAP || 6;

export class RenderTimeout extends Error {}
// Reject when a step takes too long, so one stuck render cannot block every later one.
export function withTimeout(p, ms, what) {
  let t; const to = new Promise((_, rej) => { t = setTimeout(() => rej(new RenderTimeout(`${what} took longer than ${Math.round(ms / 1000)} s.`)), ms); });
  return Promise.race([p, to]).finally(() => clearTimeout(t));
}
// Errors that mean "the browser (or this page) went away": relaunch and try once more.
export const isClosedError = (e) => e instanceof RenderTimeout || /Target (page, context or browser )?(has been )?closed|has been closed|Browser closed|browser has disconnected|Connection closed|Protocol error.*(closed|Target)|crashed/i.test(String(e && e.message));

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

function launch() {
  const p = process.env.CHROMIUM_PATH
    ? chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true })
    : launchBundled();
  return withTimeout(p, LAUNCH_MS, 'Starting the browser');
}
async function browser() {
  if (browserP) {
    const b = await browserP.catch(() => null);
    if (b && b.isConnected()) return b;
    browserP = null;
  }
  const p = launch();
  browserP = p;
  p.then((b) => b.on('disconnected', () => { if (browserP === p) browserP = null; }), () => { if (browserP === p) browserP = null; });
  return p;
}
async function dropBrowser() {
  const p = browserP; browserP = null;
  if (p) { try { const b = await p; await withTimeout(b.close(), 10000, 'Closing the browser'); } catch {} }
}

// Run fn(browser) with a fresh context; if the browser died (or a step timed out), relaunch once and retry.
export async function withRetry(fn, { attempts = 2, onFail = dropBrowser } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) { last = e; if (!isClosedError(e) || i === attempts - 1) break; await onFail(e); }
  }
  throw last;
}

// Serialise renders (html2canvas on a 2000x1125 stage is heavy), with a cap on waiting jobs.
export function makeQueue(cap = QUEUE_CAP) {
  let chain = Promise.resolve(), waiting = 0;
  return function enqueue(job) {
    if (waiting >= cap) return Promise.reject(new Error(`The renderer is busy (${waiting} images waiting). Try again in a minute.`));
    waiting++;
    const p = chain.then(job);
    chain = p.catch(() => {}).finally(() => { waiting--; });
    return p;
  };
}
const queue = makeQueue();

// Test hook: called with every new browser context (tests use it to serve fonts and scripts offline).
let contextHook = null;
export function setContextHook(fn) { contextHook = fn; }

async function newContext(opts) {
  const b = await browser();
  const ctx = await withTimeout(b.newContext(opts), STEP_MS, 'Opening a page');
  if (contextHook) await contextHook(ctx);
  return ctx;
}
async function closeContext(ctx) { try { await withTimeout(ctx.close(), 10000, 'Closing the page'); } catch {} }

export function renderFlyer(flyer, { format = 'png', scale = 1, name = 'AGIWM flyers' } = {}) {
  return queue(() => withRetry(() => doRender(flyer, { format, scale, name })));
}

async function doRender(flyer, { format, scale, name }) {
  const ctx = await newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
  try {
    return await withTimeout(renderIn(ctx, flyer, { format, scale, name }), STEP_MS + 30000, 'Rendering the flyer');
  } finally { await closeContext(ctx); }
}

async function renderIn(ctx, flyer, { format, scale, name }) {
  const page = await ctx.newPage();
  const deck = JSON.stringify({ name, i: 0, flyers: [flyer] });
  await page.addInitScript((d) => { try { localStorage.setItem('agiwm-flyer-v2', d); } catch (e) {} }, deck);
  await page.goto(pathToFileURL(HTML).href, { waitUntil: 'load', timeout: 45000 });
  await page.waitForSelector('#stage', { timeout: 15000 });
  // web fonts used by the flyer (Telugu ones included) must be in before the picture is taken
  await page.evaluate(() => (window.__flyerFontsReady ? window.__flyerFontsReady() : document.fonts && document.fonts.ready)).catch(() => {});
  await page.waitForTimeout(300);
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
}

export async function closeBrowser() { await dropBrowser(); }

// Shrink an image (data URL) to at most `max` px on its long side, as JPEG, using the headless browser's canvas.
export function shrinkImage(dataUrl, max = 1000) {
  return queue(() => withRetry(() => shrinkIn(dataUrl, max)));
}
async function shrinkIn(dataUrl, max) {
  const ctx = await newContext({});
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
  } finally { await closeContext(ctx); }
}
