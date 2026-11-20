// Getting photos into the server: https links (including Google Drive share links), data: URLs and
// short-lived upload links (POST /api/upload). Image types are recognised from the file's first
// bytes, not from what the other server says it is (Drive answers sign-in pages as "200 OK").
import crypto from 'node:crypto';

export const MAX_BYTES = 12 * 1024 * 1024;

// -> 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'heic' | 'html' | null
export function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  const b = buf, s = (a, z) => b.subarray(a, z).toString('latin1');
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && s(1, 4) === 'PNG') return 'image/png';
  if (s(0, 4) === 'GIF8') return 'image/gif';
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return 'image/webp';
  if (s(4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)/.test(s(8, 12))) return s(8, 12) === 'avif' ? 'avif' : 'heic';
  const head = s(0, 512).replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (head.startsWith('<')) return head.includes('<svg') && !head.includes('<html') ? 'svg' : 'html';
  return null;
}

// Google Drive share links -> the file id, or null.
export function driveId(u) {
  let url; try { url = new URL(u); } catch { return null; }
  if (!/(^|\.)(drive|docs)\.google\.com$|^drive\.usercontent\.google\.com$/.test(url.hostname)) return null;
  const m = /\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname) || /\/d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname);
  if (m) return m[1];
  const id = url.searchParams.get('id');
  return id && /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : null;
}
export function driveCandidates(id) {
  return [`https://drive.google.com/uc?export=download&id=${id}`, `https://drive.usercontent.google.com/download?id=${id}&export=download`];
}

const DRIVE_HELP = 'Google Drive did not give the picture. In Drive, Share the file as "Anyone with the link" (Viewer) and send that link again, or open the studio and use "From Drive" on the speaker card.';
const HEIC_HELP = 'That is an iPhone HEIC photo, which browsers cannot show. Export it as JPG first (on the iPhone: Share > Save as JPEG, or Settings > Camera > Formats > Most Compatible), then send it again.';

export class ImageError extends Error {}

function typeError(kind, src) {
  if (kind === 'heic') return new ImageError(HEIC_HELP);
  if (kind === 'avif') return new ImageError('That is an AVIF image. Save it as JPG or PNG first.');
  if (kind === 'svg') return new ImageError('SVG drawings are not supported for photos. Use a JPG or PNG.');
  if (kind === 'html') return new ImageError(/^https?:/.test(src) ? `${src} is a web page, not an image. Use a direct link to the picture (it should open just the image).` : `${src} is not an image (it looks like a web page).`);
  return new ImageError(`${src} is not a JPG, PNG, WebP or GIF image.`);
}

// Check a buffer and turn it into a data URL; throws a clear ImageError otherwise.
export function bufToDataUrl(buf, src = 'That file') {
  if (!buf || !buf.length) throw new ImageError(`${src} is empty.`);
  if (buf.length > MAX_BYTES) throw new ImageError(`${src} is over ${MAX_BYTES / 1024 / 1024} MB.`);
  const t = sniff(buf);
  if (!t || !t.startsWith('image/')) throw typeError(t, src);
  return `data:${t};base64,${buf.toString('base64')}`;
}

export function checkDataUrl(u) {
  // Re-encoded from its bytes: line breaks in the base64, extra parameters (";name=x") or a wrong type
  // used to reach the studio as-is, which then dropped the photo and showed an empty card.
  const m = /^data:([^,]*),(.*)$/s.exec(String(u || '').trim());
  if (!m) throw new ImageError('That data: URL could not be read.');
  const buf = /;base64\s*$/i.test(m[1]) || /;base64;/i.test(m[1]) ? Buffer.from(m[2].replace(/\s+/g, ''), 'base64') : Buffer.from(decodeURIComponent(m[2]), 'latin1');
  return bufToDataUrl(buf, 'That data: image');
}

async function get(url, fetchImpl) {
  const r = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'Mozilla/5.0 (flyer-studio)', Accept: 'image/*,*/*;q=0.5' } });
  const buf = Buffer.from(await r.arrayBuffer());
  return { ok: r.ok, status: r.status, buf };
}

// ---- short-lived uploads ----
const uploads = new Map();   // token -> { buf, type, exp }
const UPLOAD_TTL = 2 * 60 * 60 * 1000;
export function putUpload(buf) {
  const dataUrl = bufToDataUrl(buf, 'The upload');
  for (const [k, v] of uploads) if (v.exp < Date.now()) uploads.delete(k);
  while (uploads.size >= 100) uploads.delete(uploads.keys().next().value);
  const token = crypto.randomBytes(16).toString('base64url');
  uploads.set(token, { buf, type: dataUrl.slice(5, dataUrl.indexOf(';')), exp: Date.now() + UPLOAD_TTL });
  return { token, expires: new Date(Date.now() + UPLOAD_TTL).toISOString() };
}
export function getUpload(token) { const u = uploads.get(String(token || '')); if (!u || u.exp < Date.now()) return null; return u; }
// "upload:<token>" or any https://.../u/<token> link made by POST /api/upload
export function uploadToken(src) {
  const m = /^upload:([A-Za-z0-9_-]{16,})$/.exec(src) || /^https?:\/\/[^/]+\/u\/([A-Za-z0-9_-]{16,})(?:[?#].*)?$/.exec(src);
  return m && uploads.has(m[1]) ? m[1] : null;
}

// Any accepted photo source -> data URL (not yet shrunk).
export async function fetchImage(src, { fetchImpl = fetch } = {}) {
  src = String(src || '').trim();
  if (!src) return '';
  if (src.startsWith('data:')) return checkDataUrl(src);
  const tok = uploadToken(src);
  if (tok) { const u = getUpload(tok); return bufToDataUrl(u.buf, 'The upload'); }
  if (/^upload:/.test(src) || /\/u\/[A-Za-z0-9_-]{16,}/.test(src) && /flyers?\./.test(src)) throw new ImageError('That upload link has expired or is unknown. Upload the photo again (uploads are kept for 2 hours).');
  if (!/^https:\/\//i.test(src)) throw new ImageError('Photos must be https links, data:image URLs or upload links from /api/upload.');
  const id = driveId(src);
  if (id) {
    for (const u of driveCandidates(id)) {
      try {
        const r = await get(u, fetchImpl);
        if (r.ok && sniff(r.buf)?.startsWith('image/')) return bufToDataUrl(r.buf, 'The Drive file');
        if (r.ok && sniff(r.buf) === 'heic') throw new ImageError(HEIC_HELP);
      } catch (e) { if (e instanceof ImageError) throw e; }
    }
    throw new ImageError(DRIVE_HELP);
  }
  let r;
  try { r = await get(src, fetchImpl); } catch (e) { throw new ImageError(`Could not download ${src} (${e.name === 'TimeoutError' ? 'it took too long' : e.message}).`); }
  if (!r.ok) throw new ImageError(`Could not download ${src} (${r.status}).`);
  return bufToDataUrl(r.buf, src);
}
