// End-to-end: local server + studio in headless Chromium. Checks issues 1, 8, 24 (key not in URLs).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { route, CHROME, SERVER, STUDIO, IMGS, makeImages } from './harness.mjs';
const REPO = SERVER;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'live-'));
const PORT = 8111, B = `http://localhost:${PORT}`, K = 's3cret';
const srv = spawn('node', ['server.js'], { cwd: REPO, env: { ...process.env, PORT: String(PORT), MCP_SECRET: K, DATA_DIR: DATA, CHROMIUM_PATH: CHROME }, stdio: ['ignore', 'inherit', 'inherit'] });
await new Promise((r) => setTimeout(r, 1500));
let ok = true; const chk = (n, c, extra) => { console.log(c ? 'PASS' : 'FAIL', n, extra === undefined ? '' : JSON.stringify(extra)); if (!c) ok = false; };
const H = { 'x-flyer-key': K, 'Content-Type': 'application/json' };
const state = async () => (await fetch(B + '/api/state', { headers: H })).json();
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
try {
  // seed the server with a flyer, like production
  await fetch(B + '/api/patch', { method: 'POST', headers: H, body: JSON.stringify({ by: 'Seed', left_speaker: { name: 'SEED SPEAKER' }, date_left: { date: '2026-11-21', time: '6:30 AM IST' } }) });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await route(ctx);
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
  const puts = [], urls = [];
  pg.on('request', (r) => { urls.push(r.url()); if (r.method() === 'PUT' && r.url().includes('/api/state')) puts.push(JSON.parse(r.postData())); });
  // an existing deck with two flyers, the second selected (old decks have no liveId)
  await pg.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('agiwm-flyer-v2', JSON.stringify({ name: 'deck', i: 1, flyers: [{ id: 'aaaa1111', left: { name: 'FIRST' } }, { id: 'bbbb2222', left: { name: 'SECOND' } }] })); } });
  await pg.goto(B + '/#live=' + K); await pg.waitForTimeout(2500);
  chk('live pill', (await pg.innerText('#liveBtn')).includes('Live'));
  const d0 = await pg.evaluate(() => JSON.parse(localStorage.getItem('agiwm-flyer-v2')));
  chk('selected flyer became the live one', d0.liveId === 'bbbb2222', d0.liveId);
  chk('server flyer loaded into the live flyer only', d0.flyers[1].left.name === 'SEED SPEAKER' && d0.flyers[0].left.name === 'FIRST', [d0.flyers[0].left.name, d0.flyers[1].left.name]);
  chk('LIVE badge on flyer 2', (await pg.$$eval('#strip .tw', (t) => t.map((x) => !!x.querySelector('.tlive')))).join() === 'false,true');
  // switching, adding, duplicating, deleting flyers sends nothing
  puts.length = 0;
  await pg.evaluate(() => { document.querySelector('#prev').click(); });
  await pg.waitForTimeout(300);
  await pg.evaluate(() => { document.querySelector('#next').click(); document.querySelector('#prev').click(); });
  await pg.click('#addBtn'); await pg.click('.pop button:has-text("New flyer")');
  await pg.click('#addBtn'); await pg.click('.pop button:has-text("Duplicate this flyer")');
  await pg.waitForTimeout(400);
  await pg.evaluate(() => document.querySelectorAll('#strip .tw')[2].querySelector('.tact .danger').click());
  await pg.waitForTimeout(1800);
  chk('no PUT while switching / adding / duplicating / deleting flyers', puts.length === 0, puts.length);
  // edit a non-live flyer: still nothing
  const sel = await pg.evaluate(() => [...document.querySelectorAll('#strip .tw')].findIndex((t) => t.classList.contains('on')));
  await pg.evaluate(() => { const i = document.querySelector('#f_left_name'); i.value = 'EDITED NOT LIVE'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.waitForTimeout(1500);
  chk('editing a non-live flyer sends nothing', puts.length === 0 && (await state()).flyer.left.name === 'SEED SPEAKER', { sel, puts: puts.length });
  // a remote change lands in the live flyer, not in the one showing
  await fetch(B + '/api/patch', { method: 'POST', headers: H, body: JSON.stringify({ by: 'Claude', heading: 'Night of Prayer' }) });
  await pg.waitForTimeout(1200);
  const d1 = await pg.evaluate(() => JSON.parse(localStorage.getItem('agiwm-flyer-v2')));
  const live = d1.flyers.find((f) => f.id === d1.liveId), shown = d1.flyers[d1.i];
  chk('remote change went to the live flyer only', live.heading === 'Night of Prayer' && shown.id !== live.id && shown.heading !== 'Night of Prayer', [live.heading, shown.heading]);
  // go to the live flyer and edit it: one PUT with baseVersion and a summary; the feed says what changed
  await pg.evaluate((id) => { const i = JSON.parse(localStorage.getItem('agiwm-flyer-v2')).flyers.findIndex((f) => f.id === id); document.querySelectorAll('#strip .tw')[i].click(); }, d1.liveId);
  await pg.waitForTimeout(400); puts.length = 0;
  await pg.evaluate(() => { const i = document.querySelector('#f_left_name'); i.value = 'SIS RUTH'; i.dispatchEvent(new Event('input', { bubbles: true })); const r = document.querySelector('#f_right_name'); r.value = 'BRO JONAH'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.waitForTimeout(1500);
  let st = await state();
  chk('live edit reached the server with baseVersion', st.flyer.left.name === 'SIS RUTH' && puts.length === 1 && typeof puts[0].baseVersion === 'number', { n: puts.length, bv: puts[0]?.baseVersion });
  chk('feed has a summary of the hand edit', st.feed[0].by === 'Studio' && st.feed[0].text === 'left name, right name', st.feed[0]);
  // conflict: Claude changes the flyer while a studio edit is waiting -> both survive
  await pg.evaluate(() => { const i = document.querySelector('#f_zoom_id'); i.value = '111 222 3333'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  // simulate a server change the page has not heard about yet: bump the version behind its back
  const cur = await state();
  await fetch(B + '/api/state', { method: 'PUT', headers: H, body: JSON.stringify({ flyer: { ...cur.flyer, heading: 'Revival Night' }, client: 'other-studio', baseVersion: cur.version }) });
  await pg.waitForTimeout(2500);
  st = await state();
  chk('stale save was rebased: both changes kept', st.flyer.zoom?.id === '111 222 3333' && st.flyer.heading === 'Revival Night', { zoom: st.flyer.zoom?.id, heading: st.flyer.heading });
  const shownHd = await pg.evaluate(() => JSON.parse(localStorage.getItem('agiwm-flyer-v2')).flyers.find((f, _, a) => f.id === JSON.parse(localStorage.getItem('agiwm-flyer-v2')).liveId).heading);
  chk('studio shows the other change too', shownHd === 'Revival Night', shownHd);
  // photos are not resent once the server has them
  chk('server keeps photos with @keep (no photo bytes in saves)', puts.every((p) => !String(p.flyer.left.photo).startsWith('data:')));
  // US box follows an India date edit
  await pg.evaluate(() => { const i = document.querySelector('#f_d1_date'); i.value = '2027-03-20'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.waitForTimeout(1500); st = await state();
  chk('US box follows the India date', st.flyer.d2.date === '2027-03-19' && st.flyer.d2.time === '9:00 PM EDT', st.flyer.d2);
  // make another flyer live
  await pg.evaluate(() => document.querySelectorAll('#strip .tw')[0].click()); await pg.waitForTimeout(300);
  await pg.evaluate(() => document.querySelector('#strip .tw.on .mklive').click()); await pg.waitForTimeout(1500);
  st = await state();
  chk('Make live sends that flyer', st.flyer.left.name === 'FIRST', st.flyer.left.name);
  chk('LIVE badge moved', (await pg.$$eval('#strip .tw', (t) => t.findIndex((x) => !!x.querySelector('.tlive')))) === 0);
  // the key never travels in an address
  chk('no request carries the key in its address', !urls.some((u) => u.includes('k=' + K)), urls.filter((u) => u.includes('k=')));
  // forced 409: the first save after this claims an old base version, as if the page had missed a change
  const st409 = []; pg.on('response', (r) => { if (r.request().method() === 'PUT' && r.url().includes('/api/state')) st409.push(r.status()); });
  let once = true;
  await pg.route('**/api/state', async (r) => {
    if (r.request().method() === 'PUT' && once) { once = false; const body = JSON.parse(r.request().postData());
      // meanwhile someone else changes the location (the page will only learn it from the 409 answer)
      const c2 = await state(); await fetch(B + '/api/state', { method: 'PUT', headers: H, body: JSON.stringify({ flyer: { ...c2.flyer, loc: 'DALLAS USA' }, client: 'other', baseVersion: c2.version }) });
      body.baseVersion = c2.version; return r.continue({ postData: JSON.stringify(body) }); }
    return r.continue();
  });
  await pg.evaluate(() => { const i = document.querySelector('#f_sub'); i.value = 'NEW SUBTITLE'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.waitForTimeout(3000);
  st = await state();
  chk('409 then rebased save keeps both changes', st409.includes(409) && st.flyer.loc === 'DALLAS USA' && st.flyer.sub === 'NEW SUBTITLE', { statuses: st409, loc: st.flyer.loc, sub: st.flyer.sub });
  await pg.unroute('**/api/state');
  // reload: ids and the live flyer are remembered
  await pg.reload(); await pg.waitForTimeout(2000);
  const d2 = await pg.evaluate(() => JSON.parse(localStorage.getItem('agiwm-flyer-v2')));
  chk('live flyer remembered after reload', d2.liveId === d2.flyers[0].id && d2.flyers[0].id === 'aaaa1111', d2.liveId);
  console.log('page errors', errs);
  if (errs.length) ok = false;
  await ctx.close();
} catch (e) { console.log('ERR', e); ok = false; }
finally { await b.close(); srv.kill(); console.log(ok ? 'ALL OK' : 'SOME FAILED'); }
