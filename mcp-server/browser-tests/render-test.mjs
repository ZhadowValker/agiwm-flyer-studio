// Renders through mcp-server/renderer.js (bundled Chromium unless CHROMIUM_PATH is set): palette PNG, Telugu,
// several queued jobs, then the browser is killed and the next render must recover (issues 2, 4, 23).
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execSync } from 'node:child_process';
import { SERVER, IMGS, makeImages, route, CHROME } from './harness.mjs';
import { chromium } from 'playwright-core';
{ const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] }); await makeImages(b); await b.close(); }
process.env.FLYER_HTML = SERVER + '/flyer-studio.html'; process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-'));
const renderer = await import(SERVER + '/renderer.js');
renderer.setContextHook(route);
let ok = true; const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'renders-'));
const t0 = Date.now(); const r = async (n, f) => { const t = Date.now(); try { const b = await renderer.renderFlyer(f || { left: { name: 'R' + n } }, { scale: 0.64 }); fs.writeFileSync(path.join(OUT, n + '.png'), b); console.log('render', n, 'ok', Date.now() - t, 'ms'); } catch (e) { ok = false; console.log('render', n, 'FAILED', e.message.slice(0, 150)); } };
const pal = 'data:image/png;base64,' + fs.readFileSync(path.join(IMGS, 'palette.png')).toString('base64');
// three at once (queued), plus a shrink in between
await Promise.all([r('palette', { left: { photo: pal, name: 'PALETTE PNG' } }), r('telugu', { heading: '\u0c2a\u0c4d\u0c30\u0c3e\u0c30\u0c4d\u0c25\u0c28', left: { name: '\u0c38\u0c3f\u0c38\u0c4d\u0c1f\u0c30\u0c4d \u0c30\u0c42\u0c24\u0c41' } }), renderer.shrinkImage('data:image/png;base64,' + fs.readFileSync(IMGS + '/palette.png').toString('base64'), 200).then((u) => console.log('shrink ok', u.slice(0, 30))), r(3)]);
// kill the renderer's browser (only processes that are children of this test)
const pids = execSync(`ps -eo pid=,ppid=,args=`).toString().split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length > 2 && +p[1] === process.pid && /chrom|headless_shell/i.test(p.slice(2).join(' '))).map((p) => +p[0]);
console.log('browser processes started by this test:', pids.length, '- killing them');
for (const p of pids) try { process.kill(p, 'SIGKILL'); } catch {}
await new Promise((x) => setTimeout(x, 500));
await r(4); await r(5);
console.log('total', Date.now() - t0, 'ms; pictures in', OUT); await renderer.closeBrowser(); console.log(ok ? 'ALL OK' : 'SOME FAILED'); process.exit(0);
