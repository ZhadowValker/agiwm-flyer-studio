import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { flyerShape, buildFlyer, describe, FONTS, FLAGS, BG_PRESETS, ACCENTS } from './flyer.js';
import { renderFlyer } from './renderer.js';
import * as live from './live.js';
import * as people from './people.js';

const PORT = process.env.PORT || 8080;
const SECRET = process.env.MCP_SECRET || '';   // protects /mcp/<secret> and /api/*
const here = path.dirname(fileURLToPath(import.meta.url));
const STUDIO = process.env.STUDIO_FILE || path.join(here, 'flyer-studio.html');
const BUILD = 'live-sync+people';   // shown at /healthz so you can tell which build is live

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: e.message || String(e) }] });
const sizeScale = (size) => (size === '2000x1125' || !size ? 1 : size === '1920x1080' ? 0.96 : 0.64);
const img = (buf, format, extra) => ({ content: [{ type: 'image', data: buf.toString('base64'), mimeType: format === 'jpg' ? 'image/jpeg' : 'image/png' }, { type: 'text', text: extra }] });
const outOpts = { format: z.enum(['png', 'jpg']).optional(), size: z.enum(['2000x1125', '1920x1080', '1280x720']).optional() };

function makeServer() {
  const s = new McpServer({ name: 'agiwm-flyer-studio', version: '2.0.0' });

  s.registerTool('make_flyer', {
    title: 'Make AGIWM flyer',
    description: 'Render a one-off AGIWM Women’s Prayer Meeting flyer (2000x1125) from the fixed template. Every field is optional; anything left out keeps the AGIWM default. This does NOT touch the live flyer shown in the studio; use update_flyer for that.',
    inputSchema: { ...flyerShape, ...outOpts },
  }, async (args) => {
    try {
      const { format = 'png', size = '2000x1125', ...rest } = args;
      const buf = await renderFlyer(await buildFlyer(rest), { format, scale: sizeScale(size) });
      return img(buf, format, `Flyer rendered (${size} ${format.toUpperCase()}, ${(buf.length / 1024).toFixed(0)} KB).`);
    } catch (e) { return fail(new Error('Could not make the flyer: ' + e.message)); }
  });

  s.registerTool('update_flyer', {
    title: 'Update the live flyer',
    description: 'Change the live flyer that is open in the studio at the website. Only the fields you pass change; earlier changes stay, so you can build the flyer up over several messages. Anyone with the studio open sees it update immediately, and the instruction appears in its Live feed. Use "person" on a speaker to pull a photo from the photo library. Set preview=true to also get the rendered image back.',
    inputSchema: { ...flyerShape, by: z.string().max(30).optional().describe('who is asking, shown in the feed (default Claude)'), preview: z.boolean().optional(), ...outOpts },
  }, async (args) => {
    try {
      const { by = 'Claude', preview = false, format = 'png', size = '1280x720', ...rest } = args;
      const v = live.patch(await buildFlyer(rest), { by, text: describe(rest) });
      if (!preview) return text(`Live flyer updated (version ${v}). It is now showing in the studio: ${describe(rest)}.`);
      const buf = await renderFlyer(live.get().flyer, { format, scale: sizeScale(size) });
      return img(buf, format, `Live flyer updated (version ${v}).`);
    } catch (e) { return fail(new Error('Could not update the flyer: ' + e.message)); }
  });

  s.registerTool('get_flyer', {
    title: 'Get the live flyer',
    description: 'Show what the live flyer currently contains (photos are shown only as set / not set), plus the latest feed entries, including edits made by hand in the studio.',
    inputSchema: {},
  }, async () => {
    const { version, flyer, feed } = live.get(), f = JSON.parse(JSON.stringify(flyer));
    for (const [p, k] of [['left', 'photo'], ['right', 'photo'], ['bg', 'img']]) if (f[p]?.[k]) f[p][k] = '(set)';
    delete f.logo;
    return text(JSON.stringify({ version, flyer: Object.keys(f).length ? f : '(untouched: the AGIWM defaults)', recent: feed.slice(0, 8).map((e) => `${new Date(e.t).toISOString()} ${e.by}: ${e.text}`) }, null, 2));
  });

  s.registerTool('reset_flyer', { title: 'Reset the live flyer', description: 'Put the live flyer back to the original AGIWM defaults.', inputSchema: {} }, async () => text(`Live flyer reset (version ${live.reset('Claude')}).`));

  s.registerTool('render_current_flyer', {
    title: 'Render the live flyer', description: 'Render the live flyer exactly as it stands now (including hand edits in the studio) and return the image.', inputSchema: outOpts,
  }, async ({ format = 'png', size = '2000x1125' }) => {
    try { const buf = await renderFlyer(live.get().flyer, { format, scale: sizeScale(size) }); return img(buf, format, `Live flyer (version ${live.get().version}).`); }
    catch (e) { return fail(e); }
  });

  s.registerTool('list_people', { title: 'List photo library', description: 'People in the photo library, with the names update_flyer / make_flyer accept in "person".', inputSchema: { search: z.string().optional() } },
    async ({ search }) => { const l = search ? people.search(search).map((h) => h.p) : people.list(); return text(l.length ? l.map((p) => `${p.name}${p.aliases.length ? ' (also: ' + p.aliases.join(', ') + ')' : ''}${p.place ? ' - ' + p.place : ''}`).join('\n') : 'No one found. Add photos with add_person, or put image files named after the person in the server\'s data/photos folder.'); });

  s.registerTool('add_person', { title: 'Add a person to the photo library', description: 'Save a photo for a person so flyers can use them by name.',
    inputSchema: { name: z.string().max(80), photo_url: z.string().describe('https URL or data:image URL'), aliases: z.array(z.string().max(60)).max(6).optional(), place: z.string().max(60).optional() } },
    async ({ name, photo_url, aliases, place }) => {
      try {
        let u = photo_url;
        if (!u.startsWith('data:image/')) {
          if (!/^https:\/\//i.test(u)) throw new Error('Photo must be an https URL or a data:image URL.');
          const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`Could not download the photo (${r.status}).`);
          const type = (r.headers.get('content-type') || '').split(';')[0]; if (!/^image\//.test(type)) throw new Error('That link is not an image.');
          u = `data:${type};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
        }
        const p = await people.add({ name, aliases, place, dataUrl: u }); return text(`Saved ${p.name} to the photo library.`);
      } catch (e) { return fail(e); }
    });

  s.registerTool('remove_person', { title: 'Remove from photo library', description: 'Delete a person\'s photo from the library.', inputSchema: { name: z.string() } },
    async ({ name }) => { try { return text(`Removed ${people.remove(name)}.`); } catch (e) { return fail(e); } });

  s.registerTool('flyer_options', { title: 'Flyer options', description: 'List the fonts, flags, background gradients and accent colour presets the tools accept, and the defaults.', inputSchema: {} },
    async () => text(JSON.stringify({ fonts: FONTS, flags: FLAGS, background_presets: Object.keys(BG_PRESETS), accent_presets: Object.keys(ACCENTS),
      defaults: { title: 'AGIWM', subtitle: 'AMAZING GOD INTERNATIONAL WOMEN’S MINISTRIES', location: 'MARYLAND USA', script_word: 'Women’s', heading: 'Prayer Meeting', tags: ['Pray', 'Be Encouraged', 'Grow Together'],
        left_speaker: { label: 'Word by', name: 'DR MANJULA CHARAN', place: 'Hyderabad, India.' }, right_speaker: { label: 'Worship by', name: 'SIS SHANTA KUMARI & FAMILY' },
        date_left: { flag: 'in', date: '2026-10-24', time: '6:30 AM IST' }, date_right: { flag: 'us', date: '2026-10-23', time: '9:00 PM EDT' },
        zoom: { meeting_id: '9969598014', passcode: '202022' }, youtube: { handle: '@AGIMUSA' }, join_button: { text: 'Join Now' } } }, null, 2)));

  return s;
}

const app = express();
app.use(express.json({ limit: '30mb' }));
app.get(['/', '/index.html'], (_req, res) => res.sendFile(STUDIO));
app.get('/healthz', (_req, res) => res.type('text').send('ok ' + BUILD));

// ---- live flyer API (used by the studio page now, and by a WhatsApp bot later) ----
const authed = (req, res, next) => {
  const k = req.query.k || req.get('x-flyer-key') || '';
  if (SECRET && k !== SECRET) return res.status(401).json({ error: 'Wrong or missing key.' });
  next();
};
app.get('/api/state', authed, (_req, res) => res.json(live.get()));
app.get('/api/live', authed, (req, res) => live.subscribe(req, res));
app.put('/api/state', authed, (req, res) => {
  const { flyer, client } = req.body || {};
  if (!flyer || typeof flyer !== 'object') return res.status(400).json({ error: 'flyer is required' });
  res.json({ version: live.replace(flyer, client, { text: req.body.text }) });
});
// Friendly patch, same fields as the update_flyer tool. For bots: POST {"left_speaker":{"person":"Pastor Elizabeth"},"by":"WhatsApp"}
app.post('/api/patch', authed, async (req, res) => {
  try { const { by = 'API', ...rest } = req.body || {}; res.json({ version: live.patch(await buildFlyer(rest), { by, text: describe(rest) }) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/render.png', authed, async (req, res) => {
  try { const buf = await renderFlyer(live.get().flyer, { format: 'png', scale: sizeScale(req.query.size) }); res.type('png').send(buf); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/people', authed, (_req, res) => res.json(people.list()));

// ---- MCP ----
const mcpPath = SECRET ? `/mcp/${SECRET}` : '/mcp';
app.post(mcpPath, async (req, res) => {
  const server = makeServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
  catch (e) { if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }); }
});
const no = (_req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
app.get(mcpPath, no); app.delete(mcpPath, no);

app.listen(PORT, () => console.log(`AGIWM flyer MCP listening on :${PORT}${mcpPath}`));
