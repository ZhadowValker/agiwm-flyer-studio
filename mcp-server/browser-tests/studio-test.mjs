// Studio behaviour (file://, offline): issues 7, 9, 15, 18, 19, 22 (touch drag), 24 (file names), 3 (warning)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { route, CHROME, SERVER, STUDIO, IMGS, makeImages } from './harness.mjs';
const html = process.argv[2] || STUDIO;
let ok = true; const chk = (n, c, x) => { console.log(c ? 'PASS' : 'FAIL', n, x === undefined ? '' : JSON.stringify(x)); if (!c) ok = false; };
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
await makeImages(b);
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, hasTouch: true }); await route(ctx);
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
await pg.goto('file://' + html); await pg.waitForTimeout(1200);
const deck = () => pg.evaluate(() => JSON.parse(localStorage.getItem('agiwm-flyer-v2')));
const L = async () => (await deck()).flyers[0].left;
const setField = (id, v) => pg.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); if (e.tagName === 'SELECT') e.dispatchEvent(new Event('input', { bubbles: true })); }, [id, v]);
const toastText = () => pg.evaluate(() => document.querySelector('#toast').textContent);
async function upload(file) {
  await pg.evaluate(() => { document.querySelector('#toast').textContent = ''; });
  const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.evaluate(() => document.querySelector('[data-pick="left.photo"]').click())]);
  await fc.setFiles(file); await pg.waitForTimeout(900);
}
// 18: framing kept for a similar photo, reset with Undo for a different shape
await upload(IMGS + '/portrait.jpg');
chk('photo set', !!(await L()).photo);
await setField('f_left_z', '1.5'); await setField('f_left_y', '20'); await pg.waitForTimeout(700);
chk('framing set', (await L()).z === 1.5 && (await L()).y === 20, await L().then((l) => [l.z, l.y]));
await upload(IMGS + '/portrait2.jpg');
chk('similar shape keeps zoom/position', (await L()).z === 1.5 && (await L()).y === 20, await L().then((l) => [l.z, l.y]));
await upload(IMGS + '/landscape.jpg');
chk('different shape resets with a message', (await L()).z === 1 && (await L()).y === 0 && /different shape/.test(await toastText()), await toastText());
await pg.evaluate(() => document.querySelector('#toast .tbtn').click()); await pg.waitForTimeout(700);
chk('Undo brings the framing back', (await L()).z === 1.5 && (await L()).y === 20, await L().then((l) => [l.z, l.y]));
// 19: clear messages
for (const [f, re] of [[IMGS + '/fake.heic', /HEIC/], [IMGS + '/empty.jpg', /empty/], [IMGS + '/corrupt.jpg', /damaged|not a picture/], [IMGS + '/small.jpg', /small \(200 x 200/]]) {
  await upload(f); chk('message for ' + f.split('/').pop(), re.test(await toastText()), await toastText());
}
// 9: clamp so the photo always covers the card; fit whole photo
await upload(IMGS + '/portrait.jpg');
await setField('f_left_z', '1.2'); await setField('f_left_x', '60'); await pg.waitForTimeout(600);
chk('offset clamped to (zoom-1)*50', (await L()).x === 10, (await L()).x);
await setField('f_left_z', '1'); await pg.waitForTimeout(600);
chk('zoom 1 leaves no room to move', (await L()).x === 0 && (await L()).y === 0, await L().then((l) => [l.x, l.y]));
const covers = await pg.evaluate(() => { const c = document.querySelector('#cardL .phw').getBoundingClientRect(), p = document.querySelector('#cardL .ph').getBoundingClientRect(); return p.left <= c.left + 0.5 && p.right >= c.right - 0.5 && p.top <= c.top + 0.5 && p.bottom >= c.bottom - 0.5; });
chk('photo covers the card', covers);
chk('focus slightly above centre', (await pg.evaluate(() => getComputedStyle(document.querySelector('#cardL .ph')).backgroundPosition)) === '50% 25%');
await setField('f_left_fit', 'contain'); await pg.waitForTimeout(900);
const fitInfo = await pg.evaluate(() => ({ size: getComputedStyle(document.querySelector('#cardL .ph')).backgroundSize, blur: document.querySelector('#cardL .phb').style.backgroundImage.slice(0, 30) }));
chk('fit whole photo: contain + blurred fill', fitInfo.size === 'contain' && /data:image\/jpeg/.test(fitInfo.blur), fitInfo);
await setField('f_left_fit', 'cover'); await pg.waitForTimeout(300);
// 22: touch drag moves the photo once the card is selected
await setField('f_left_z', '2'); await pg.waitForTimeout(400);
await pg.click('#cardL .plate .lb', { force: true }).catch(() => {});
await pg.evaluate(() => { window.__sel = document.querySelector('#cardL'); });
await pg.evaluate(() => document.querySelector('#cardL .phw').dispatchEvent(new MouseEvent('click', { bubbles: true })));
await pg.waitForTimeout(300);
const before = (await L()).y;
await pg.evaluate(() => {
  const w = document.querySelector('#cardL .phw'), r = w.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const ev = (t, dy) => w.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y + dy }));
  ev('pointerdown', 0); for (let i = 1; i <= 8; i++) ev('pointermove', i * 6); ev('pointerup', 48);
});
await pg.waitForTimeout(800);
chk('touch drag moves the photo', (await L()).y > before, [before, (await L()).y]);
// 7: long names wrap onto two lines instead of being cut off
const long = 'EVANGELIST SISTER RUTH JEREMIAH ABRAHAM KUMARI & FAMILY ONE'.slice(0, 60);
await setField('f_left_name', long + 'XXXXXXXXXX'); await pg.waitForTimeout(600);
chk('name limited to 60 characters', (await L()).name.length === 60, (await L()).name.length);
const nm = await pg.evaluate(() => { const e = document.querySelector('#cardL .nm'), cs = getComputedStyle(e); return { w: e.offsetWidth, h: e.offsetHeight, fs: parseFloat(cs.fontSize), lh: parseFloat(cs.lineHeight), sw: e.scrollWidth }; });
chk('long name fits the plate in at most two lines', nm.w <= 482 && nm.sw <= 482 && nm.h <= nm.lh * 2 + 2 && nm.fs >= 18, nm);
// 7: the title stays clear of the logo
await setField('f_title', 'AMAZING GOD WOMEN'); await pg.evaluate(() => { const d = JSON.parse(localStorage.getItem('agiwm-flyer-v2')); }); await pg.waitForTimeout(400);
const ov = await pg.evaluate(() => { const a = document.querySelector('#logo').getBoundingClientRect(), t = document.querySelector('#ttl').getBoundingClientRect(); return { logoR: Math.round(a.right), ttlL: Math.round(t.left), overlap: a.right > t.left && a.bottom > t.top }; });
chk('title clear of the logo', !ov.overlap, ov);
// 15: Telugu heading keeps letters together, no big-first-letter split
await setField('f_heading', 'ప్రార్థన సమావేశం'); await pg.waitForTimeout(400);
const hd = await pg.evaluate(() => { const h = document.getElementById('stage').querySelector('#hd'); return { text: h.textContent, c1: h.querySelectorAll('.c1').length, words: h.querySelectorAll('.w').length }; });
chk('Telugu heading is whole words, no first-letter split', hd.text === 'ప్రార్థనసమావేశం' && hd.c1 === 0 && hd.words === 2, hd);
await setField('f_heading', 'Prayer Meeting'); await pg.waitForTimeout(300);
// 3: warning when the boxes disagree, and the fix button
await setField('f_d1_date', '2026-11-21'); await pg.waitForTimeout(900);
let d = (await deck()).flyers[0];
chk('US box followed the India date', d.d2.date === '2026-11-20' && d.d2.time === '8:00 PM EST', d.d2);
await setField('f_d2_date', '2026-11-13'); await pg.waitForTimeout(400);
const warn = await pg.evaluate(() => [...document.querySelectorAll('.tzw')].filter((e) => e.style.display !== 'none').map((e) => e.textContent)[0] || '');
chk('warning shown when the boxes are not the same moment', /not the same moment|Check the times/.test(warn), warn.slice(0, 120));
await pg.evaluate(() => [...document.querySelectorAll('.tzw')].find((e) => e.style.display !== 'none').querySelector('button').click()); await pg.waitForTimeout(900);
d = (await deck()).flyers[0];
chk('fix button matches the US box to India', d.d2.date === '2026-11-20' && d.d2.time === '8:00 PM EST', d.d2);
// 24: file names carry the size
await pg.click('#dlBtn'); const items = await pg.$$('.pop button'); let t1280; for (const it of items) if (/PNG.*1280/.test((await it.innerText()).replace(/\s+/g, ''))) t1280 = it;
const [dl] = await Promise.all([pg.waitForEvent('download'), t1280.click()]);
chk('export file name has the size', /-1280x720\.png$/.test(dl.suggestedFilename()), dl.suggestedFilename());
chk('no page errors', errs.length === 0, errs);
await b.close(); console.log(ok ? 'ALL OK' : 'SOME FAILED');
