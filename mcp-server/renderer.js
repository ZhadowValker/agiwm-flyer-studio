import { chromium } from 'playwright-core';
import sparticuz from '@sparticuz/chromium';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = process.env.FLYER_HTML || path.join(here, 'flyer-studio.html');

let browserP = null;
function browser() {
  if (!browserP) {
    browserP = (async () => {
      // CHROMIUM_PATH lets Docker/local use a system Chrome; otherwise use the bundled build (works on locked-down hosts).
      const executablePath = process.env.CHROMIUM_PATH || await sparticuz.executablePath();
      const args = process.env.CHROMIUM_PATH ? ['--no-sandbox', '--disable-dev-shm-usage'] : [...sparticuz.args, '--no-sandbox'];
      return chromium.launch({ executablePath, args, headless: true });
    })();
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
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
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
    let clicked = false;
    for (const it of items) {
      const t = ((await it.innerText()) || '').replace(/\s+/g, '');
      const want = { PNG2000: /PNG.*2000/, PNG1920: /PNG.*1920/, PNG1280: /PNG.*1280/, JPG2000: /JPG.*2000/, JPG1280: /JPG.*1280/ }[hint];
      if (want.test(t)) { await it.click(); clicked = true; break; }
    }
    if (!clicked) throw new Error('Could not find the export option in the studio page.');
    await page.waitForFunction(() => { const o = document.querySelector('#ov'); return o && !o.hidden && document.querySelector('#ovimg').src.startsWith('blob:'); }, null, { timeout: 60000 });
    const b64 = await page.evaluate(async () => {
      const blob = await (await fetch(document.querySelector('#ovimg').src)).blob();
      return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
    });
    return Buffer.from(b64, 'base64');
  } finally {
    await ctx.close();
  }
}

export async function closeBrowser() { if (browserP) { (await browserP).close(); browserP = null; } }
