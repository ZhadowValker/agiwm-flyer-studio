// Connector tools and HTTP API against a local server (no rendering).
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { SERVER, IMGS, makeImages, CHROME } from './harness.mjs';
import { chromium } from 'playwright-core';
{ const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] }); await makeImages(b); await b.close(); }
const R = SERVER + '/';
const { Client } = await import(R + 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js');
const { StreamableHTTPClientTransport } = await import(R + 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-')), K = 'k3y', B = 'http://localhost:8121';
const srv = spawn('node', ['server.js'], { cwd: R, env: { ...process.env, PORT: '8121', MCP_SECRET: K, DATA_DIR: DATA }, stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise((r) => setTimeout(r, 1500));
let ok = true; const chk = (n, c, x) => { console.log(c ? 'PASS' : 'FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 300)); if (!c) ok = false; };
try {
  const c = new Client({ name: 't', version: '1' }); await c.connect(new StreamableHTTPClientTransport(new URL(`${B}/mcp/${K}`)));
  const call = async (name, args) => { const r = await c.callTool({ name, arguments: args }); return { err: !!r.isError, text: r.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n') }; };
  const tools = (await c.listTools()).tools; const by = Object.fromEntries(tools.map((t) => [t.name, t]));
  chk('schemas: fit, plan_id, upload documented', !!by.make_flyer.inputSchema.properties.left_speaker.properties.fit && !!by.publish_week.inputSchema.properties.plan_id && /api\/upload/.test(JSON.stringify(by.make_flyer.inputSchema)));
  const p1 = await call('plan_schedule', { text: 'Speakers for December 2026\n1st week Sis Ruth may lead\nWeek 2 - Dr Nirmala\n3rd week...... Pastor Elizabeth' });
  const id1 = /Plan id: (\w+)/.exec(p1.text)?.[1];
  chk('plan_schedule: December, US time from IST, plan id', !p1.err && /december 2026/i.test(p1.text) && /US 2026-12-04 8:00 PM EST/.test(p1.text) && !!id1, p1.text);
  const p2 = await call('plan_schedule', { text: 'Jan 9: Sis A\n16 Jan - Sis B' });
  const iv = await call('invite_text', { week: 2, plan_id: id1 });
  chk('invite_text with plan_id uses that plan (not the newest)', /Word: Dr Nirmala/.test(iv.text) && /12 Dec, 6:30 AM IST/.test(iv.text) && /11 Dec, 8:00 PM EST/.test(iv.text) && /Worship: To be announced/.test(iv.text), iv.text);
  const iv2 = await call('invite_text', { week: 2 });
  chk('invite_text without plan_id: newest plan (old behaviour)', /Word: Sis A/.test(iv2.text), iv2.text.split('\n')[2]);
  const rm = await call('remove_person', { name: 'Elizabeth' });
  chk('remove_person loose name refused', rm.err && /exactly/.test(rm.text), rm.text);
  const dr = await call('add_person', { name: 'Test', photo_url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view' });
  chk('add_person with a private Drive link: clear error', dr.err && /(Anyone with the link|Could not download|Drive)/.test(dr.text), dr.text);
  const g = await call('get_flyer', {});
  chk('get_flyer is short (no default styles)', !/"vis": true/.test(g.text), g.text.length);
  // HTTP API: header auth, upload, live token, schedule plan id, 409
  const H = { 'x-flyer-key': K };
  chk('API accepts the key in a header', (await fetch(B + '/api/state', { headers: H })).ok);
  chk('API still accepts ?k= (old clients)', (await fetch(B + '/api/state?k=' + K)).ok);
  chk('API refuses a wrong key', (await fetch(B + '/api/state', { headers: { 'x-flyer-key': 'nope' } })).status === 401);
  const up = await (await fetch(B + '/api/upload', { method: 'POST', headers: { ...H, 'Content-Type': 'image/png' }, body: fs.readFileSync(IMGS + '/palette.png') })).json();
  chk('upload returns a short-lived url', /\/u\/[\w-]{16,}$/.test(up.url) && /^upload:/.test(up.photo_url), up);
  chk('upload url serves the image', (await fetch(up.url)).headers.get('content-type') === 'image/png');
  const bad = await fetch(B + '/api/upload', { method: 'POST', headers: { ...H, 'Content-Type': 'image/jpeg' }, body: Buffer.from('<html>no</html>') });
  chk('upload refuses non-images', bad.status === 400, await bad.json());
  const tk = await (await fetch(B + '/api/live-token', { method: 'POST', headers: H })).json();
  const ac = new AbortController(); const es = await fetch(B + '/api/live?t=' + tk.token, { signal: ac.signal }); chk('event stream opens with a token', es.ok && /event-stream/.test(es.headers.get('content-type'))); ac.abort();
  chk('event stream refuses a bad token', (await fetch(B + '/api/live?t=bad')).status === 401);
  const s0 = await (await fetch(B + '/api/state', { headers: H })).json();
  const put = (bv) => fetch(B + '/api/state', { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ flyer: { heading: 'X' }, client: 'c', baseVersion: bv, text: 'heading' }) });
  chk('PUT with current baseVersion ok', (await put(s0.version)).ok);
  const r409 = await put(s0.version); const j409 = await r409.json();
  chk('PUT with old baseVersion -> 409 with the current flyer', r409.status === 409 && j409.version === s0.version + 1 && j409.flyer.heading === 'X');
  const sp = await (await fetch(B + '/api/schedule', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'March 2027\n2nd week Sis A\n3rd week Sis B' }) })).json();
  chk('API schedule returns plan_id and US times', !!sp.plan_id && sp.weeks[0].usTime === '8:00 PM EST' && sp.weeks[1].usTime === '9:00 PM EDT', sp.weeks);
  const t2 = await (await fetch(`${B}/api/schedule/2.txt?plan=${id1}`, { headers: H })).text();
  chk('API week text by plan id', /Dr Nirmala/.test(t2));
} catch (e) { console.log('ERR', e); ok = false; } finally { srv.kill(); console.log(ok ? 'ALL OK' : 'SOME FAILED'); process.exit(0); }
