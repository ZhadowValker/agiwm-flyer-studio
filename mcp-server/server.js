import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { flyerShape, buildFlyer, describe, warningsOf, trimForDisplay, FONTS, FLAGS, BG_PRESETS, ACCENTS } from './flyer.js';
import { fetchImage, putUpload, getUpload, ImageError } from './images.js';
import { renderFlyer } from './renderer.js';
import * as live from './live.js';
import * as people from './people.js';
import * as schedule from './schedule.js';
import { buildInvite } from './invite.js';

const PORT = process.env.PORT || 8080;
const SECRET = process.env.MCP_SECRET || '';   // protects /mcp/<secret> and /api/*
const here = path.dirname(fileURLToPath(import.meta.url));
const STUDIO = process.env.STUDIO_FILE || path.join(here, 'flyer-studio.html');
const BUILD = 'live-sync+people+dst+textstyle+schedule2+layout+mcp-schedule+free-edit+invite+fixes-2026-11-20';   // shown at /healthz so you can tell which build is live

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: e.message || String(e) }] });
const sizeScale = (size) => (size === '2000x1125' || !size ? 1 : size === '1920x1080' ? 0.96 : 0.64);
const img = (buf, format, extra) => ({ content: [{ type: 'image', data: buf.toString('base64'), mimeType: format === 'jpg' ? 'image/jpeg' : 'image/png' }, { type: 'text', text: extra }] });
const inviteOpts = { with_invite: z.boolean().optional().describe('also return the WhatsApp invitation text with the picture (default true), so both can be sent together'), zoom_link: z.string().url().max(300).optional().describe("Zoom's own invite link for that text") };
const withInvite = (fl, extra, o) => (o.with_invite === false ? extra : extra + '\n\nWhatsApp invitation text (send it together with the picture):\n\n' + buildInvite(fl, { zoomLink: o.zoom_link }));
const warnText = (w) => (w && w.length ? '\n\nCheck: ' + w.join(' ') : '');
const planOpt = { plan_id: z.string().max(40).optional().describe('the plan id that plan_schedule / make_schedule returned; leave out to use the newest plan made on this server') };
const outOpts = { format: z.enum(['png', 'jpg']).optional(), size: z.enum(['2000x1125', '1920x1080', '1280x720']).optional() };

// One week of a plan plus the "common" fields of make_schedule (a right speaker in common replaces "To be announced").
function weekArgs(w, common = {}) {
  return { ...common, ...w.args,
    left_speaker: { ...(common.left_speaker || {}), ...w.args.left_speaker },
    right_speaker: common.right_speaker ? { ...(common.right_speaker.person ? {} : { place: '', photo_url: '' }), ...common.right_speaker } : w.args.right_speaker,
    date_left: { ...(common.date_left || {}), ...w.args.date_left }, date_right: { ...(common.date_right || {}), ...w.args.date_right } };
}

function makeServer() {
  const s = new McpServer({ name: 'agiwm-flyer-studio', version: '2.0.0' });

  s.registerTool('make_flyer', {
    title: 'Make AGIWM flyer',
    description: 'Render a one-off AGIWM Women’s Prayer Meeting flyer (2000x1125) from the fixed template. Every field is optional; anything left out keeps the AGIWM default. This does NOT touch the live flyer shown in the studio; use update_flyer for that.',
    inputSchema: { ...flyerShape, ...outOpts, ...inviteOpts },
  }, async (args) => {
    try {
      const { format = 'png', size = '2000x1125', with_invite, zoom_link, ...rest } = args;
      const fl = await buildFlyer(rest, { fresh: true }), buf = await renderFlyer(fl, { format, scale: sizeScale(size) });
      return img(buf, format, withInvite(fl, `Flyer rendered (${size} ${format.toUpperCase()}, ${(buf.length / 1024).toFixed(0)} KB).` + warnText(warningsOf(fl)), { with_invite, zoom_link }));
    } catch (e) { return fail(new Error('Could not make the flyer: ' + e.message)); }
  });

  s.registerTool('update_flyer', {
    title: 'Update the live flyer',
    description: 'Change the live flyer that is open in the studio at the website. Only the fields you pass change; earlier changes stay, so you can build the flyer up over several messages. Anyone with the studio open sees it update immediately, and the instruction appears in its Live feed. Use "person" on a speaker to pull a photo from the photo library. Set preview=true to also get the rendered image back.',
    inputSchema: { ...flyerShape, by: z.string().max(30).optional().describe('who is asking, shown in the feed (default Claude)'), preview: z.boolean().optional(), ...outOpts, ...inviteOpts },
  }, async (args) => {
    try {
      const { by = 'Claude', preview = false, format = 'png', size = '1280x720', with_invite, zoom_link, ...rest } = args;
      const out = {}, v = live.patch(await buildFlyer(rest), { by, text: describe(rest), out });
      if (!preview) return text(`Live flyer updated (version ${v}). It is now showing in the studio: ${describe(rest)}.` + warnText(out.warnings));
      const buf = await renderFlyer(live.get().flyer, { format, scale: sizeScale(size) });
      return img(buf, format, withInvite(live.get().flyer, `Live flyer updated (version ${v}).` + warnText(out.warnings), { with_invite, zoom_link }));
    } catch (e) { return fail(new Error('Could not update the flyer: ' + e.message)); }
  });

  s.registerTool('get_flyer', {
    title: 'Get the live flyer',
    description: 'Show what the live flyer currently contains (photos are shown only as set / not set; text styles and fonts left at their defaults are not listed), plus the latest feed entries, including edits made by hand in the studio.',
    inputSchema: {},
  }, async () => {
    const { version, flyer, feed } = live.get(), f = trimForDisplay(flyer);
    return text(JSON.stringify({ version, flyer: Object.keys(f).length ? f : '(untouched: the AGIWM defaults)', recent: feed.slice(0, 8).map((e) => `${new Date(e.t).toISOString()} ${e.by}: ${e.text}`) }, null, 2));
  });

  s.registerTool('reset_flyer', { title: 'Reset the live flyer', description: 'Put the live flyer back to the original AGIWM defaults.', inputSchema: {} }, async () => text(`Live flyer reset (version ${live.reset('Claude')}).`));

  s.registerTool('render_current_flyer', {
    title: 'Render the live flyer', description: 'Render the live flyer exactly as it stands now (including hand edits in the studio) and return the image together with its WhatsApp invitation text, ready to send as one post.', inputSchema: { ...outOpts, ...inviteOpts },
  }, async ({ format = 'png', size = '2000x1125', with_invite, zoom_link }) => {
    try { const buf = await renderFlyer(live.get().flyer, { format, scale: sizeScale(size) }); return img(buf, format, withInvite(live.get().flyer, `Live flyer (version ${live.get().version}).`, { with_invite, zoom_link })); }
    catch (e) { return fail(e); }
  });

  s.registerTool('list_people', { title: 'List photo library', description: 'People in the photo library, with the names update_flyer / make_flyer accept in "person".', inputSchema: { search: z.string().optional() } },
    async ({ search }) => { const l = search ? people.search(search).map((h) => h.p) : people.list(); return text(l.length ? l.map((p) => `${p.name}${p.aliases.length ? ' (also: ' + p.aliases.join(', ') + ')' : ''}${p.place ? ' - ' + p.place : ''}`).join('\n') : 'No one found. Add photos with add_person, or put image files named after the person in the server\'s data/photos folder.'); });

  s.registerTool('add_person', { title: 'Add a person to the photo library', description: 'Save a photo for a person so flyers can use them by name. Names in any script (Telugu too) work. photo_url: an https link to the image, a Google Drive share link (shared as "Anyone with the link"), a data:image URL, or the "url" returned by POST /api/upload (send the image bytes there with the live key).',
    inputSchema: { name: z.string().max(60), photo_url: z.string().max(14000000).describe('https link, Google Drive share link, data:image URL or upload link'), aliases: z.array(z.string().max(60)).max(6).optional(), place: z.string().max(60).optional() } },
    async ({ name, photo_url, aliases, place }) => {
      try {
        const u = await fetchImage(photo_url);
        const p = await people.add({ name, aliases, place, dataUrl: u }); return text(`Saved ${p.name} to the photo library.`);
      } catch (e) { return fail(e); }
    });

  s.registerTool('remove_person', { title: 'Remove from photo library', description: 'Delete a person\'s photo from the library. The name must match a listed name or alias exactly (capitals, dots and extra spaces do not matter); otherwise nothing is removed and the closest names are listed.', inputSchema: { name: z.string().max(80) } },
    async ({ name }) => { try { return text(`Removed ${people.remove(name)}.`); } catch (e) { return fail(e); } });


  s.registerTool('plan_schedule', {
    title: 'Plan flyers from a monthly schedule',
    description: 'Paste a monthly speaker list and get one planned flyer per week: speaker, India date (default Saturdays), the same moment in US time (worked out from the India time, EDT or EST by date), and a different colour set for each. Lines may look like "1st week of November Rev Name", "Week 1 - Name", "Jan 10: Name" or "10 Jan - Name". The month is the first month named in the text. The worship card says "To be announced" unless make_schedule gets a right_speaker in "common". People found in the photo library get their photo automatically. Nothing is rendered; use make_schedule for images or publish_week to load one week into the live studio flyer. The answer includes a plan id: pass it to publish_week / invite_text so that someone else planning at the same time cannot change which plan you get.',
    inputSchema: { text: z.string().max(4000), weekday: z.enum(['sunday','monday','tuesday','wednesday','thursday','friday','saturday']).optional(), time_left: z.string().max(30).optional().describe('India time, default "6:30 AM IST"'), time_right: z.string().max(30).optional().describe('leave out: the US time is worked out from the India time') },
  }, async ({ text: t, weekday, time_left, time_right }) => {
    try {
      const p = await schedule.plan(t, { weekday, timeLeft: time_left, timeRight: time_right });
      return text(`Plan id: ${p.id}\nPlanned ${p.weeks.length} flyers for ${p.month} ${p.year}:\n` + p.weeks.map((w) => `Week ${w.week}: ${w.speaker} - India ${w.date} ${w.args.date_left.time}, US ${w.usDate} ${w.usTime}, ${w.args.accent?.preset || 'default'} on ${w.args.background?.preset || 'default'}${w.photo ? ', photo from library' : ', no photo yet'}`).join('\n') + (p.skipped.length ? `\nSkipped (no such week): ${p.skipped.join(', ')}` : '') + (p.warnings.length ? `\nCheck: ${p.warnings.join(' ')}` : ''));
    } catch (e) { return fail(e); }
  });

  s.registerTool('make_schedule', {
    title: 'Make all flyers for a monthly schedule',
    description: 'Like plan_schedule, then renders every week as an image (one-off flyers; the live studio flyer is not touched). Add anything shared by all weeks in "common" (zoom details, right speaker, fonts...). Best for sending the month to a WhatsApp group.',
    inputSchema: { text: z.string().max(4000), weekday: z.enum(['sunday','monday','tuesday','wednesday','thursday','friday','saturday']).optional(), time_left: z.string().max(30).optional(), time_right: z.string().max(30).optional(),
      common: z.object(flyerShape).partial().optional(), invite_text: z.boolean().optional().describe('also write the WhatsApp invitation text for each week (default true)'), zoom_link: z.string().url().max(300).optional().describe('Zoom invite link to use in the invitation texts'), ...outOpts },
  }, async ({ text: t, weekday, time_left, time_right, common = {}, invite_text = true, zoom_link, format = 'jpg', size = '1280x720' }) => {
    try {
      const p = await schedule.plan(t, { weekday, timeLeft: time_left, timeRight: time_right });
      const content = [{ type: 'text', text: `Plan id: ${p.id}\nRendered ${p.weeks.length} flyers for ${p.month} ${p.year}: ` + p.weeks.map((w) => `week ${w.week} ${w.speaker} (${w.date})`).join('; ') + (p.weeks.some((w) => !w.photo) ? '. No photo in the library for: ' + p.weeks.filter((w) => !w.photo).map((w) => w.speaker).join(', ') + '.' : '.') + (p.warnings.length ? ` Check: ${p.warnings.join(' ')}` : '') }];
      for (const w of p.weeks) {
        const args = weekArgs(w, common);
        const fl = await buildFlyer(args, { fresh: true }), buf = await renderFlyer(fl, { format, scale: sizeScale(size) });
        content.push({ type: 'text', text: `Week ${w.week}: ${w.speaker}, ${w.date}` + (invite_text ? '\n\nWhatsApp invitation text for this week:\n\n' + buildInvite(fl, { zoomLink: zoom_link }) : '') }, { type: 'image', data: buf.toString('base64'), mimeType: format === 'jpg' ? 'image/jpeg' : 'image/png' });
      }
      return { content };
    } catch (e) { return fail(new Error('Could not make the schedule: ' + e.message)); }
  });

  s.registerTool('invite_text', {
    title: 'WhatsApp invitation text',
    description: 'Write the WhatsApp invitation message (emoji text with speakers, India and US times, Zoom and YouTube) from the flyer, so the text always matches the image. By default it uses the live flyer open in the studio, hand edits included; give "week" to use a week of the last plan_schedule instead.',
    inputSchema: { week: z.number().int().min(1).max(5).optional().describe('week of the plan; leave out to use the live flyer'), ...planOpt,
      zoom_link: z.string().url().max(300).optional().describe("Zoom's own invite link, if you have it; otherwise a plain link is made from the meeting ID"),
      closing: z.string().max(120).optional().describe('last line; default "Come and be Blessed!"; empty string for none') },
  }, async ({ week, plan_id, zoom_link, closing }) => {
    try {
      let src;
      if (week) src = await buildFlyer(schedule.weekOf(schedule.getPlan(plan_id), week).args, { fresh: true });
      else src = live.get().flyer;
      return text(buildInvite(src, { zoomLink: zoom_link, closing }));
    } catch (e) { return fail(e); }
  });

  s.registerTool('publish_week', {
    title: 'Load one planned week into the live flyer',
    description: 'After plan_schedule or make_schedule, put week N (1, 2, 3...) into the live flyer open in the studio, so it can be edited by hand.',
    inputSchema: { week: z.number().int().min(1).max(5), ...planOpt, by: z.string().max(30).optional() },
  }, async ({ week, plan_id, by = 'Claude' }) => {
    try {
      const w = schedule.weekOf(schedule.getPlan(plan_id), week);
      const v = live.patch(await buildFlyer(w.args), { by, text: `Loaded week ${w.week}: ${w.speaker}, ${w.date}` });
      return text(`Live flyer now shows week ${w.week}: ${w.speaker} (${w.date}), version ${v}.`);
    } catch (e) { return fail(e); }
  });

  s.registerTool('flyer_options', { title: 'Flyer options', description: 'List the fonts, flags, background gradients and accent colour presets the tools accept, and the defaults.', inputSchema: {} },
    async () => text(JSON.stringify({ fonts: FONTS, flags: FLAGS, background_presets: Object.keys(BG_PRESETS), accent_presets: Object.keys(ACCENTS),
      defaults: { title: 'AGIWM', subtitle: 'AMAZING GOD INTERNATIONAL WOMEN’S MINISTRIES', location: 'MARYLAND USA', script_word: 'Women’s', heading: 'Prayer Meeting', tags: ['Pray', 'Be Encouraged', 'Grow Together'],
        left_speaker: { label: 'Word by', name: 'DR MANJULA CHARAN', place: 'Hyderabad, India.' }, right_speaker: { label: 'Worship by', name: 'SIS SHANTA KUMARI & FAMILY' },
        date_left: { flag: 'in', date: '2026-10-24', time: '6:30 AM IST' }, date_right: { flag: 'us', date: '2026-10-23', time: '9:00 PM EDT' },
        zoom: { meeting_id: '9969598014', passcode: '202022' }, youtube: { handle: '@AGIMUSA' }, join_button: { text: 'Join Now' } } }, null, 2)));

  return s;
}

const app = express();
app.set('trust proxy', true);   // behind the host's proxy: links made by /api/upload use https
app.use(express.json({ limit: '30mb' }));
app.get(['/', '/index.html'], (_req, res) => res.sendFile(STUDIO));
app.get(['/privacy', '/privacy.html'], (_req, res) => res.sendFile(path.join(here, 'privacy.html')));   // linked from the Google sign-in screen
app.get('/healthz', (_req, res) => res.type('text').send('ok ' + BUILD));

// ---- live flyer API (used by the studio page now, and by a WhatsApp bot later) ----
// The key goes in the x-flyer-key header. ?k= still works for old clients and bots.
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const authed = (req, res, next) => {
  const k = req.get('x-flyer-key') || req.query.k || '';
  if (SECRET && !safeEq(k, SECRET)) return res.status(401).json({ error: 'Wrong or missing key.' });
  next();
};
// EventSource cannot send headers, so the studio asks for a short-lived token (header auth) and
// opens /api/live?t=<token> instead of putting the key in the address.
const liveTokens = new Map();
const LIVE_TOKEN_TTL = 10 * 60 * 1000;
app.post('/api/live-token', authed, (_req, res) => {
  for (const [k, v] of liveTokens) if (v < Date.now()) liveTokens.delete(k);
  const t = crypto.randomBytes(18).toString('base64url'); liveTokens.set(t, Date.now() + LIVE_TOKEN_TTL);
  res.json({ token: t, expires: new Date(Date.now() + LIVE_TOKEN_TTL).toISOString() });
});
const liveAuthed = (req, res, next) => {
  const t = req.query.t; if (t && (liveTokens.get(String(t)) || 0) > Date.now()) return next();
  return authed(req, res, next);
};
app.get('/api/state', authed, (_req, res) => res.json(live.get()));
app.get('/api/live', liveAuthed, (req, res) => live.subscribe(req, res));
app.put('/api/state', authed, (req, res) => {
  const { flyer, client, baseVersion } = req.body || {};
  if (!flyer || typeof flyer !== 'object') return res.status(400).json({ error: 'flyer is required' });
  const t = typeof req.body.text === 'string' ? req.body.text.slice(0, 200) : null;
  try { res.json({ version: live.replace(flyer, client, { text: t || null, baseVersion }) }); }
  catch (e) { if (e instanceof live.Conflict) return res.status(409).json({ error: e.message, ...live.get() }); throw e; }
});
// Upload a photo (raw image bytes with an image/* content type, or JSON {"dataUrl": "data:image/..."}).
// Answers {url, token, expires}; the url (or "upload:<token>") works as photo_url in the tools for 2 hours.
app.post('/api/upload', authed, express.raw({ type: ['image/*', 'application/octet-stream'], limit: '13mb' }), (req, res) => {
  try {
    const buf = Buffer.isBuffer(req.body) ? req.body : req.body && typeof req.body.dataUrl === 'string' ? Buffer.from(req.body.dataUrl.replace(/^data:[^,]*;base64,/, ''), 'base64') : null;
    if (!buf) return res.status(400).json({ error: 'Send the image bytes (Content-Type: image/jpeg ...) or JSON {"dataUrl": "data:image/...;base64,..."}.' });
    const u = putUpload(buf), host = `${req.protocol}://${req.get('host')}`;
    res.json({ url: `${host}/u/${u.token}`, token: u.token, photo_url: `upload:${u.token}`, expires: u.expires });
  } catch (e) { res.status(e instanceof ImageError ? 400 : 500).json({ error: e.message }); }
});
app.get('/u/:token', (req, res) => { const u = getUpload(req.params.token); if (!u) return res.status(404).json({ error: 'Unknown or expired upload.' }); res.type(u.type).set('Cache-Control', 'private, max-age=600').send(u.buf); });
// Friendly patch, same fields as the update_flyer tool. For bots: POST {"left_speaker":{"person":"Pastor Elizabeth"},"by":"WhatsApp"}
app.post('/api/patch', authed, async (req, res) => {
  try { const { by = 'API', ...rest } = req.body || {}; res.json({ version: live.patch(await buildFlyer(rest), { by, text: describe(rest) }) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/render.png', authed, async (req, res) => {
  try { const buf = await renderFlyer(live.get().flyer, { format: 'png', scale: sizeScale(req.query.size) }); res.type('png').send(buf); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Bot/API: POST {"text":"1st week of November ...","weekday":"saturday"} -> plan; GET /api/schedule/2.png renders week 2 of the last plan.
app.post('/api/schedule', authed, async (req, res) => {
  try { const { text: t, weekday, time_left, time_right } = req.body || {}; const p = await schedule.plan(t, { weekday, timeLeft: time_left, timeRight: time_right }); res.json({ plan_id: p.id, month: p.month, year: p.year, weeks: p.weeks.map(({ week, speaker, date, usDate, usTime, photo }) => ({ week, speaker, date, usDate, usTime, photo })), skipped: p.skipped, warnings: p.warnings }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/invite', authed, (req, res) => res.type('text').send(buildInvite(live.get().flyer, { zoomLink: req.query.zoom, closing: req.query.closing })));   // WhatsApp invitation text for the live flyer
app.get('/api/schedule/:n.:ext', authed, async (req, res) => {
  try {
    let w; try { w = schedule.weekOf(schedule.getPlan(req.query.plan), +req.params.n); } catch (e) { return res.status(404).json({ error: e.message }); }
    if (req.params.ext === 'txt') return res.type('text').send(buildInvite(await buildFlyer(w.args, { fresh: true }), { zoomLink: req.query.zoom, closing: req.query.closing }));
    const fmt = req.params.ext === 'jpg' ? 'jpg' : 'png'; const buf = await renderFlyer(await buildFlyer(w.args, { fresh: true }), { format: fmt, scale: sizeScale(req.query.size || '1280x720') });
    res.type(fmt === 'jpg' ? 'jpeg' : 'png').send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/people', authed, (_req, res) => res.json(people.list()));
// Studio: save a speaker's photo to the library, and look one up by name (exact name or alias only).
app.post('/api/people', authed, async (req, res) => {
  try { const { name, place = '', dataUrl } = req.body || {};
    if (!name || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(dataUrl || '')) return res.status(400).json({ error: 'name and an image dataUrl are required' });
    const hit = people.exactMatches(name)[0];
    res.json(await people.add({ name: hit ? hit.name : name, aliases: hit ? hit.aliases : [], place: place || (hit ? hit.place : ''), dataUrl: await fetchImage(dataUrl) }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/people/photo', authed, async (req, res) => {
  try { const hit = people.exactMatches(req.query.name || '')[0] || (people.search(req.query.name || '').filter((h) => h.s === 100).length === 1 ? people.search(req.query.name || '')[0].p : null); if (!hit) return res.status(404).json({ error: 'not found' });
    res.json({ name: hit.name, aliases: hit.aliases, place: hit.place, dataUrl: await people.photoOf(hit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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
