// Starts the server and calls make_flyer over MCP HTTP. Set FLYER_HTML / CHROMIUM_PATH if needed.
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fs from 'node:fs';

const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: '8099' }, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 1500));
try {
  const c = new Client({ name: 'test', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL('http://localhost:8099/mcp')));
  console.log('tools:', (await c.listTools()).tools.map((t) => t.name));
  const res = await c.callTool({ name: 'make_flyer', arguments: {
    left_speaker: { name: 'PASTOR ELIZABETH AMARA', place: 'Maryland, USA', label: 'Word by' },
    date_left: { date: '2026-11-07', time: '7:00 AM IST' }, date_right: { date: '2026-11-06', time: '8:30 PM EDT' },
    zoom: { meeting_id: '123 456 7890', passcode: '2026' },
    background: { preset: 'sage' }, accent: { preset: 'emerald' }, fonts: { heading: 'Cinzel' }, size: '1280x720',
  } });
  const img = res.content.find((x) => x.type === 'image');
  console.log(res.isError ? res.content : res.content.find((x) => x.type === 'text').text);
  if (img) fs.writeFileSync(process.env.OUT || 'out.png', Buffer.from(img.data, 'base64'));
  const bad = await c.callTool({ name: 'make_flyer', arguments: { left_speaker: { photo_url: 'http://x' } } });
  console.log('bad input ->', bad.isError, bad.content[0].text);
} finally { srv.kill(); }
