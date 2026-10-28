// Builds the WhatsApp invitation text from a flyer state, so the text and the image always match.
// One source for two users: the connector imports it, and the studio build inlines it
// (the "export" line at the bottom is stripped there). Keep this file ASCII only.

var INVITE_DEFAULTS = {
  title: 'AGIWM', script: 'Women\u2019s', heading: 'Prayer Meeting',
  left: { show: true, label: 'Word by', name: 'DR MANJULA CHARAN' },
  right: { show: true, label: 'Worship by', name: 'SIS SHANTA KUMARI & FAMILY' },
  d1: { show: true, flag: 'in', date: '2026-10-24', time: '6:30 AM IST' },
  d2: { show: true, flag: 'us', date: '2026-10-23', time: '9:00 PM EDT' },
  zoom: { show: true, id: '9969598014', pass: '202022' },
  yt: { show: true, handle: '@AGIMUSA' }
};
var INV_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var INV_FLAG = { 'in': '\u{1F1EE}\u{1F1F3}', us: '\u{1F1FA}\u{1F1F8}', uk: '\u{1F1EC}\u{1F1E7}', ca: '\u{1F1E8}\u{1F1E6}' };

function invSec(s, k) {
  var o = {}, d = INVITE_DEFAULTS[k], v = s && s[k], a;
  if (d) for (a in d) o[a] = d[a];
  if (v && typeof v === 'object') for (a in v) if (v[a] !== undefined && v[a] !== null) o[a] = v[a];
  return o;
}
function invStr(v, dflt) { return (v === undefined || v === null ? dflt : String(v)).replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim(); }
// Text typed all in capitals (or all in small letters) on the flyer reads badly in a chat, so
// "DR MANJULA CHARAN" and "prayer meeting" become "Dr Manjula Charan" and "Prayer Meeting".
function invCase(n) {
  n = invStr(n, '');
  if (n && n.toUpperCase() !== n.toLowerCase() && (n === n.toUpperCase() || n === n.toLowerCase()))
    n = n.toLowerCase().replace(/(^|[\s\-(])([a-z\u00c0-\u024f])/g, function (m, a, b) { return a + b.toUpperCase(); });
  return n;
}
var invName = invCase;
function invDate(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m && +m[2] >= 1 && +m[2] <= 12 ? (+m[3]) + ' ' + INV_MON[+m[2] - 1] : '';
}
function invGroup(d) {
  if (d.length === 10) return d.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3');
  if (d.length === 11) return d.replace(/(\d{3})(\d{4})(\d{4})/, '$1 $2 $3');
  if (d.length === 9) return d.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
  return d;
}

// s: a flyer state (full or partial; anything missing falls back to the AGIWM defaults).
// opt: { zoomLink: 'https://zoom.us/j/...?pwd=...' to use Zoom's own invite link, closing: 'last line' }
function buildInvite(s, opt) {
  opt = opt || {};
  var blocks = [], g;
  var title = [invStr(s && s.title, INVITE_DEFAULTS.title), invCase(s && s.script != null ? s.script : INVITE_DEFAULTS.script), invCase(s && s.heading != null ? s.heading : INVITE_DEFAULTS.heading)].filter(Boolean).join(' ');
  blocks.push('\u{1F64F} ' + title);

  var sp = [];
  [['left', '\u{1F4D6}', 'Word'], ['right', '\u{1F3B6}', 'Worship']].forEach(function (x) {
    var c = invSec(s, x[0]), nm = invName(c.name);
    if (c.show === false || !nm) return;
    var lb = invStr(c.label, '').replace(/\s*:?\s+by\s*:?$/i, '').replace(/:$/, '').trim() || x[2];
    sp.push(x[1] + ' ' + lb + ': ' + nm);
  });
  if (sp.length) blocks.push(sp.join('\n'));

  var ds = [];
  ['d1', 'd2'].forEach(function (k) {
    var c = invSec(s, k);
    if (c.show === false) return;
    var when = [invDate(c.date), invStr(c.time, '')].filter(Boolean).join(', ');
    if (when) ds.push((INV_FLAG[c.flag] || '\u{1F5D3}\ufe0f') + ' ' + when);
  });
  if (ds.length) blocks.push(ds.join('\n'));

  var z = invSec(s, 'zoom');
  if (z.show !== false) {
    var digits = String(z.id == null ? '' : z.id).replace(/\D/g, ''), pass = invStr(z.pass, '');
    var link = /^https:\/\/\S+$/.test(String(opt.zoomLink || '').trim()) ? String(opt.zoomLink).trim() : (digits.length >= 9 ? 'https://zoom.us/j/' + digits : '');
    var zl = [];
    if (link || digits) zl.push('\u{1F4BB} Zoom' + (link ? ': ' + link : ''));
    var idp = [];
    if (digits) idp.push('ID: ' + invGroup(digits));
    if (pass) idp.push('Passcode: ' + pass);
    if (idp.length) zl.push(idp.join(' | '));
    if (zl.length) blocks.push(zl.join('\n'));
  }

  var y = invSec(s, 'yt');
  if (y.show !== false) {
    var h = invStr(y.handle, '');
    if (h) blocks.push('\u25b6\ufe0f YouTube: ' + (/^https?:\/\//i.test(h) ? h : 'https://www.youtube.com/@' + h.replace(/^@/, '')));
  }

  var end = opt.closing === undefined ? 'Come and be Blessed! \u{1F64C}' : invStr(opt.closing, '');
  if (end) blocks.push(end);
  return blocks.join('\n\n');
}

export { buildInvite, INVITE_DEFAULTS };
