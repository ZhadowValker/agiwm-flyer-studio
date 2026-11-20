// Unit tests (no browser needed): node test.js   (npm test)
// The end-to-end render test is smoke.mjs; the studio browser tests are studio-test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flyer-test-'));
const tz = await import('./tz.js');
const { buildInvite, invCase } = await import('./invite.js');
const sp = await import('./schedparse.js');
const schedule = await import('./schedule.js');
const people = await import('./people.js');
const images = await import('./images.js');
const flyer = await import('./flyer.js');
const live = await import('./live.js');
const renderer = await import('./renderer.js');
const sync = await import('./sync-studio.mjs');

// ---------- issue 3: US time follows the India time ----------
test('IST -> US for the four reference dates', () => {
  assert.deepEqual(tz.istToUs('2026-11-21', '6:30 AM IST'), { date: '2026-11-20', time: '8:00 PM EST' });
  assert.deepEqual(tz.istToUs('2026-10-24', '6:30 AM IST'), { date: '2026-10-23', time: '9:00 PM EDT' });
  assert.deepEqual(tz.istToUs('2027-03-14', '5:30 AM IST'), { date: '2027-03-13', time: '7:00 PM EST' });
  assert.deepEqual(tz.istToUs('2027-03-20', '6:30 AM IST'), { date: '2027-03-19', time: '9:00 PM EDT' });
});
test('daylight saving dates are computed for any year', () => {
  // 2nd Sunday of March / 1st Sunday of November
  const prev = (d) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
  for (const [y, start, end] of [[2025, '2025-03-09', '2025-11-02'], [2026, '2026-03-08', '2026-11-01'], [2027, '2027-03-14', '2027-11-07'], [2031, '2031-03-09', '2031-11-02']]) {
    assert.equal(tz.tzUsDst(prev(start)), false, `${y} day before start`);
    assert.equal(tz.tzUsDst(start), true, `${y} start`);
    assert.equal(tz.tzUsDst(prev(end)), true, `${y} day before end`);
    assert.equal(tz.tzUsDst(end), false, `${y} end`);
  }
});
test('a wrong EDT/EST name keeps the moment (shifts the hour) instead of flipping the label only', () => {
  assert.deepEqual(tz.usFix('2026-11-20', '9:00 PM EDT'), { date: '2026-11-20', time: '8:00 PM EST' });
  assert.deepEqual(tz.usFix('2027-03-19', '8:00 PM EST'), { date: '2027-03-19', time: '9:00 PM EDT' });
  assert.deepEqual(tz.usFix('2026-11-20', '8:00 PM EST'), { date: '2026-11-20', time: '8:00 PM EST' });
  assert.deepEqual(tz.usFix('2026-11-20', '12:30 AM EDT'), { date: '2026-11-19', time: '11:30 PM EST' });
  assert.equal(tz.usTz('2026-11-20', 'evening'), 'evening');
});
test('tzFixFlyer: US box follows the India box; mismatch is reported', () => {
  const f = { d1: { date: '2026-11-21', time: '6:30 AM IST' }, d2: { date: '2026-10-23', time: '9:00 PM EDT' } };
  assert.equal(tz.tzSame(f), false);
  tz.tzFixFlyer(f, { anchor: 'ist' });
  assert.deepEqual(f.d2, { date: '2026-11-20', time: '8:00 PM EST' });
  assert.equal(tz.tzSame(f), true);
  const g = { d1: { date: '2026-11-21', time: '6:30 AM IST' }, d2: { date: '2026-11-13', time: '8:00 PM EST' } };
  const w = tz.tzFixFlyer(g);
  assert.equal(g.d2.date, '2026-11-13');
  assert.match(w[0], /not the same moment/);
  // stale label with an India box: the US box is worked out from India
  const h = { d1: { date: '2026-11-21', time: '6:30 AM IST' }, d2: { date: '2026-11-20', time: '9:00 PM EDT' } };
  assert.deepEqual(tz.tzFixFlyer(h), []);
  assert.deepEqual(h.d2, { date: '2026-11-20', time: '8:00 PM EST' });
});

// ---------- issues 5, 14, 17: invite text ----------
test('invite text uses the same corrected time as the image', () => {
  const t = buildInvite({ d1: { date: '2026-11-21', time: '6:30 AM IST' }, d2: { date: '2026-11-20', time: '9:00 PM EDT' } });
  assert.match(t, /21 Nov, 6:30 AM IST/);
  assert.match(t, /20 Nov, 8:00 PM EST/);
});
test('odd casing is tidied, normal mixed case is kept', () => {
  assert.equal(invCase('Prayer meetinG'), 'Prayer Meeting');
  assert.equal(invCase('DR MANJULA CHARAN'), 'Dr Manjula Charan');
  assert.equal(invCase('prayer meeting'), 'Prayer Meeting');
  assert.equal(invCase('Sis. Dolly & Bro. Jonah'), 'Sis. Dolly & Bro. Jonah');
  assert.equal(invCase('Pastor McDonald'), 'Pastor McDonald');
  assert.match(buildInvite({ heading: 'Prayer meetinG' }), /Women's Prayer Meeting/);
});
test('Telugu names pass through the invite unchanged', () => {
  assert.match(buildInvite({ left: { name: 'సిస్టర్ రూతు' } }), /Word: సిస్టర్ రూతు/);
});

// ---------- issue 13: schedule parsing ----------
const NOW = new Date(2026, 10, 20);
test('the first month named wins; small-letter "may" is not a month', () => {
  assert.equal(sp.schParse('Speakers for November\n1st week Sis Ruth may lead worship\n2nd week Dr X').mon, 10);
  assert.equal(sp.schParse('1st week Ruth (she may come)\n2nd week Dr X').mon, -1);
  assert.equal(sp.schParse('May 2027 speakers\n1st week A').mon, 4);
  assert.equal(sp.schParse('Schedule: 10 may - Sis A\n17 may - Sis B').mon, 4);
  assert.equal(sp.schParse('December and January\n1st week A').mon, 11);
});
test('accepts "Week 1 - Name", "Jan 10: Name", "10 Jan - Name"', () => {
  const a = sp.schParse('December 2026\nWeek 1 - Pastor A\nWeek 2: Dr B');
  assert.deepEqual(a.items.map((i) => [i.week, i.name]), [[1, 'Pastor A'], [2, 'Dr B']]);
  const b = sp.schParse('Jan 10: Sis C\n17 Jan – Bro D\nJanuary 24th - Rev E\n31st of January: F');
  assert.deepEqual(b.items.map((i) => [i.mon, i.day, i.name]), [[0, 10, 'Sis C'], [0, 17, 'Bro D'], [0, 24, 'Rev E'], [0, 31, 'F']]);
  const d = sp.schDates(b, { now: NOW });
  assert.deepEqual(d.weeks.map((w) => w.date), ['2027-01-10', '2027-01-17', '2027-01-24', '2027-01-31']);
  assert.equal(d.year, 2027);
});
test('old format and names on the next line still work; past dates are warned', () => {
  const t = 'Spkrs for November\n1st week of November Rev Rajakumari Ammagaru\n2nd week......\nDr Nirmala sathyanandam garu\n3rd week...... Ruth j Amma\n4th week...... ps Lilly Rose Ammagaru';
  const d = sp.schDates(sp.schParse(t), { now: NOW });
  assert.deepEqual(d.weeks.map((w) => w.date), ['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28']);
  assert.equal(d.weeks[1].name, 'Dr Nirmala sathyanandam garu');
  assert.equal(d.warnings.length, 2);
  assert.match(d.warnings[0], /2026-11-07 is in the past/);
});
test('plan: US date/time worked out from IST, To be announced worship, plan ids', async () => {
  const p = await schedule.plan('March 2027\n2nd week Sis A\n3rd week Sis B', { now: NOW });
  const [w2, w3] = p.weeks;
  assert.deepEqual([w2.args.date_left.date, w2.args.date_right.date, w2.args.date_right.time], ['2027-03-13', '2027-03-12', '8:00 PM EST']);
  assert.deepEqual([w3.args.date_left.date, w3.args.date_right.date, w3.args.date_right.time], ['2027-03-20', '2027-03-19', '9:00 PM EDT']);
  assert.equal(w2.args.right_speaker.name, schedule.TBA);
  const q = await schedule.plan('April 2027\n1st week Sis C', { now: NOW });
  assert.notEqual(p.id, q.id);
  assert.equal(schedule.getPlan(p.id).weeks[0].speaker, 'Sis A');   // an older plan is still reachable by id
  assert.equal(schedule.getPlan().id, q.id);                         // no id: newest (old behaviour)
  assert.throws(() => schedule.getPlan('nope'), /No plan with id/);
  const e = await schedule.plan('March 2027\n2nd week Sis A', { now: NOW, timeLeft: '5:30 AM IST' });
  assert.equal(e.weeks[0].args.date_right.time, '7:00 PM EST');
});

// ---------- issue 16: photo library ----------
const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
function fakeAdd(name, extra = {}) {
  // people.add needs the browser to shrink photos; write the files the same way it does
  const meta = JSON.parse(fs.existsSync(path.join(process.env.DATA_DIR, 'people.json')) ? fs.readFileSync(path.join(process.env.DATA_DIR, 'people.json'), 'utf8') : '{}');
  const key = extra.key || people.slug(name);
  fs.writeFileSync(path.join(process.env.DATA_DIR, 'photos', key + '.jpg'), Buffer.from(PNG1.split(',')[1], 'base64'));
  meta[key] = { name, aliases: extra.aliases || [], place: '' };
  fs.writeFileSync(path.join(process.env.DATA_DIR, 'people.json'), JSON.stringify(meta));
  return key;
}
test('Telugu names normalise and get their own file names', () => {
  assert.equal(people.norm('సిస్టర్ రూతు'), 'సిస్టర్ రూతు');
  assert.equal(people.slug('సిస్టర్ రూతు'), 'సిస్టర్-రూతు');
  assert.notEqual(people.slug('సిస్టర్ రూతు'), people.slug('బ్రదర్ యోహాను'));
  assert.equal(people.slug('Sis. Ruth Jeremiah'), 'sis-ruth-jeremiah');
  assert.equal(people.core('Pastor Elizabeth Amara'), 'elizabeth amara');
  fakeAdd('సిస్టర్ రూతు'); fakeAdd('Pastor Elizabeth Amara', { aliases: ['Pr Elizabeth'] }); fakeAdd('Elizabeth Rani');
  assert.equal(people.search('సిస్టర్ రూతు')[0].p.name, 'సిస్టర్ రూతు');
});
test('remove_person needs an exact name or alias and lists candidates', () => {
  assert.throws(() => people.remove('Elizabeth'), /No one is named exactly "Elizabeth".*Did you mean: .*Elizabeth/);
  assert.equal(people.list().length, 3);
  assert.equal(people.remove('pr. elizabeth'), 'Pastor Elizabeth Amara');   // alias, ignoring case and dots
  assert.equal(people.list().length, 2);
});

// ---------- issue 10: Drive links, magic bytes, uploads ----------
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0]);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(8)]);
const HTML = Buffer.from('<!DOCTYPE html><html><head><title>Google Drive</title></head></html>');
test('image types are read from the bytes', () => {
  assert.equal(images.sniff(JPG), 'image/jpeg');
  assert.equal(images.sniff(Buffer.from(PNG1.split(',')[1], 'base64')), 'image/png');
  assert.equal(images.sniff(HEIC), 'heic');
  assert.equal(images.sniff(HTML), 'html');
  assert.throws(() => images.bufToDataUrl(HEIC), /HEIC/);
  assert.throws(() => images.bufToDataUrl(Buffer.alloc(0)), /empty/);
  assert.throws(() => images.checkDataUrl('data:image/png;base64,' + HTML.toString('base64')), /web page/);
});
test('Google Drive share links are recognised', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  for (const u of [`https://drive.google.com/file/d/${id}/view?usp=sharing`, `https://drive.google.com/open?id=${id}`, `https://drive.google.com/uc?id=${id}&export=download`, `https://docs.google.com/uc?export=view&id=${id}`])
    assert.equal(images.driveId(u), id, u);
  assert.equal(images.driveId('https://example.com/file/d/xyz'), null);
});
test('Drive: tries the download addresses and gives a clear error for private files', async () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', seen = [];
  const fake = (body) => async (u) => { seen.push(u); return { ok: true, status: 200, arrayBuffer: async () => body(u) }; };
  const ok = await images.fetchImage(`https://drive.google.com/file/d/${id}/view`, { fetchImpl: fake((u) => (u.includes('usercontent') ? JPG : HTML)) });
  assert.match(ok, /^data:image\/jpeg;base64,/);
  assert.deepEqual(seen, images.driveCandidates(id));
  await assert.rejects(images.fetchImage(`https://drive.google.com/open?id=${id}`, { fetchImpl: fake(() => HTML) }), /Anyone with the link/);
  await assert.rejects(images.fetchImage('https://example.com/photo', { fetchImpl: fake(() => HTML) }), /web page, not an image/);
  // a server that calls a JPG "text/plain" is fine: the bytes decide
  assert.match(await images.fetchImage('https://example.com/p', { fetchImpl: fake(() => JPG) }), /^data:image\/jpeg/);
});
test('uploads give a short-lived link that works as photo_url', async () => {
  const u = images.putUpload(JPG);
  assert.match(await images.fetchImage(`https://flyers.example.org/u/${u.token}`), /^data:image\/jpeg/);
  assert.match(await images.fetchImage(`upload:${u.token}`), /^data:image\/jpeg/);
  await assert.rejects(images.fetchImage('upload:AAAAAAAAAAAAAAAAAAAAAA'), /expired or is unknown/);
  assert.throws(() => images.putUpload(HTML), /web page/);
});

// ---------- issues 5, 9, 14, 24: building flyers ----------
test('make_flyer: dates settled, defaults do not leak, framing clamped', async () => {
  const f = await flyer.buildFlyer({ left_speaker: { name: 'SIS RUTH', offset_x: -100, offset_y: 40, zoom: 1.5 }, date_left: { date: '2026-11-21' } }, { fresh: true });
  assert.equal(f.left.place, '');
  assert.equal(f.right.name, flyer.TBA_NAME);
  assert.deepEqual(f.d2, { date: '2026-11-20', time: '8:00 PM EST' });   // worked out from the India box
  assert.deepEqual([f.left.x, f.left.y], [-25, 25]);                        // (1.5-1)*50
  assert.match(buildInvite(f), /20 Nov, 8:00 PM EST/);
  const g = await flyer.buildFlyer({ right_speaker: { fit: 'contain', offset_x: 80 } }, { fresh: true });
  assert.equal(g.right.fit, 'contain'); assert.equal(g.right.x, 50);
  assert.deepEqual(flyer.warningsOf(f), []);
});
test('get_flyer leaves out default styles', () => {
  const t = flyer.trimForDisplay({ left: { photo: 'data:x', name: 'A' }, logo: 'data:y', fonts: { title: '', heading: 'Poppins' },
    sty: { ttl: { col: '#123456', op: 1, sz: 1, ls: 0, dx: 0, dy: 0, rot: 0, vis: true, font: '', cs: '', wt: '' }, sub: { col: '', op: 1, sz: 1 }, logo: { op: 1, sz: 0.9, dx: 115 } } });
  assert.deepEqual(t, { left: { photo: '(set)', name: 'A' }, fonts: { heading: 'Poppins' }, sty: { ttl: { col: '#123456' }, logo: { sz: 0.9, dx: 115 } } });
});

// ---------- issue 8: concurrent edits ----------
test('live: stale studio PUTs are refused; patches settle dates', () => {
  const v0 = live.get().version;
  const v1 = live.replace({ heading: 'A' }, 'c1', { baseVersion: v0, text: 'heading' });
  assert.equal(v1, v0 + 1);
  assert.throws(() => live.replace({ heading: 'B' }, 'c2', { baseVersion: v0 }), live.Conflict);
  assert.equal(live.get().flyer.heading, 'A');
  live.replace({ heading: 'C' }, 'old-client');   // no baseVersion: old behaviour
  const out = {};
  live.patch({ d1: { date: '2026-11-21', time: '6:30 AM IST' } }, { by: 'Test', text: 'date', out });
  assert.deepEqual(live.get().flyer.d2, { date: '2026-11-20', time: '8:00 PM EST' });
  assert.deepEqual(out.warnings, []);
  live.replace({ heading: 'D' }, 'c1', { text: 'heading' }); live.replace({ heading: 'E' }, 'c1', { text: 'heading' });
  assert.deepEqual(live.get().feed.slice(0, 3).map((e) => e.text), ['heading', 'date', 'heading']);   // a typing burst is one feed entry
});

// ---------- issue 2: renderer queue / retry ----------
test('renderer: a stuck job times out and the queue carries on; the queue is capped', async () => {
  const q = renderer.makeQueue(2);
  const stuck = q(() => renderer.withTimeout(new Promise(() => {}), 50, 'Rendering'));
  const next = q(async () => 'ok');
  await assert.rejects(stuck, /took longer/);
  assert.equal(await next, 'ok');
  await new Promise((r) => setTimeout(r, 10));
  const a = q(() => new Promise((r) => setTimeout(r, 30))), b = q(async () => 1);
  await assert.rejects(q(async () => 2), /busy/);
  await a; await b;
});
test('renderer: "Target closed" relaunches once and retries', async () => {
  let n = 0, drops = 0;
  const r = await renderer.withRetry(async () => { if (n++ === 0) throw new Error('page.goto: Target page, context or browser has been closed'); return 'png'; }, { onFail: async () => { drops++; } });
  assert.deepEqual([r, n, drops], ['png', 2, 1]);
  n = 0;
  await assert.rejects(renderer.withRetry(async () => { n++; throw new Error('Could not find the export option'); }, { onFail: async () => {} }), /export option/);
  assert.equal(n, 1);   // other errors are not retried
  assert.ok(!renderer.LAUNCH_ARGS.includes('--single-process') && !renderer.LAUNCH_ARGS.includes('--no-zygote'));
});

// ---------- the studio carries the same shared code ----------
test('index.html and mcp-server/flyer-studio.html are identical and up to date', () => {
  assert.deepEqual(sync.check(), []);
});
