import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { flyerShape, buildFlyer, FONTS, FLAGS, BG_PRESETS, ACCENTS } from './flyer.js';
import { renderFlyer } from './renderer.js';

const PORT = process.env.PORT || 8080;
const SECRET = process.env.MCP_SECRET || '';   // optional: serve at /mcp/<secret>

function makeServer() {
  const s = new McpServer({ name: 'agiwm-flyer-studio', version: '1.0.0' });

  s.registerTool('make_flyer', {
    title: 'Make AGIWM flyer',
    description: 'Render the AGIWM Women’s Prayer Meeting flyer (2000x1125) from the fixed template. Every field is optional; anything left out keeps the AGIWM default, so pass only what changes (names, dates, times, Zoom details, photos, background, colours, fonts). Returns the finished image.',
    inputSchema: { ...flyerShape, format: z.enum(['png', 'jpg']).optional(), size: z.enum(['2000x1125', '1920x1080', '1280x720']).optional() },
  }, async (args) => {
    try {
      const { format = 'png', size = '2000x1125', ...rest } = args;
      const flyer = await buildFlyer(rest);
      const scale = size === '2000x1125' ? 1 : size === '1920x1080' ? 0.96 : 0.64;
      const buf = await renderFlyer(flyer, { format, scale });
      return { content: [
        { type: 'image', data: buf.toString('base64'), mimeType: format === 'jpg' ? 'image/jpeg' : 'image/png' },
        { type: 'text', text: `Flyer rendered (${size} ${format.toUpperCase()}, ${(buf.length / 1024).toFixed(0)} KB).` },
      ] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Could not make the flyer: ${e.message}` }] };
    }
  });

  s.registerTool('flyer_options', {
    title: 'Flyer options',
    description: 'List the fonts, flags, background gradients and accent colour presets that make_flyer accepts.',
    inputSchema: {},
  }, async () => ({ content: [{ type: 'text', text: JSON.stringify({ fonts: FONTS, flags: FLAGS, background_presets: Object.keys(BG_PRESETS), accent_presets: Object.keys(ACCENTS),
    defaults: { title: 'AGIWM', subtitle: 'AMAZING GOD INTERNATIONAL WOMEN’S MINISTRIES', location: 'MARYLAND USA', script_word: 'Women’s', heading: 'Prayer Meeting', tags: ['Pray', 'Be Encouraged', 'Grow Together'],
      left_speaker: { label: 'Word by', name: 'DR MANJULA CHARAN', place: 'Hyderabad, India.' }, right_speaker: { label: 'Worship by', name: 'SIS SHANTA KUMARI & FAMILY' },
      date_left: { flag: 'in', date: '2026-10-24', time: '6:30 AM IST' }, date_right: { flag: 'us', date: '2026-10-23', time: '9:00 PM EDT' },
      zoom: { meeting_id: '9969598014', passcode: '202022' }, youtube: { handle: '@AGIMUSA' }, join_button: { text: 'Join Now' } } }, null, 2) }] }));

  return s;
}

const app = express();
app.use(express.json({ limit: '25mb' }));
const here = path.dirname(fileURLToPath(import.meta.url));
const BUILD = 'studio-ui+chromium-fallback';   // shown at /healthz so you can tell which build is live
// The studio itself (the flyer maker UI) is served at the site root.
app.get(['/', '/index.html'], (_req, res) => res.sendFile(path.join(here, 'flyer-studio.html')));
app.get('/healthz', (_req, res) => res.type('text').send('ok ' + BUILD));

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
