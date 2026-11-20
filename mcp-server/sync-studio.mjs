// Keeps the studio in step with the server:
//  1. inlines the shared modules (tz.js, schedparse.js, invite.js) into ../index.html between
//     "/* @inline <file> */" and "/* @end <file> */" (their import/export lines are dropped), and
//  2. copies ../index.html to flyer-studio.html (the copy the server serves and renders with).
// Run it after editing index.html or a shared module:   node sync-studio.mjs
// "node sync-studio.mjs --check" changes nothing and fails if anything is out of step (npm test runs it).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SHARED = ['tz.js', 'schedparse.js', 'invite.js'];
const INDEX = path.join(here, '..', 'index.html'), COPY = path.join(here, 'flyer-studio.html');

export function inlineBody(file) {
  return fs.readFileSync(path.join(here, file), 'utf8').split('\n')
    .filter((l) => !/^(export|import)\s/.test(l)).join('\n').replace(/\n+$/, '');
}
export function build(html) {
  for (const f of SHARED) {
    const a = `/* @inline ${f} */`, b = `/* @end ${f} */`, i = html.indexOf(a), j = html.indexOf(b);
    if (i < 0 || j < i) throw new Error(`index.html has no ${a} ... ${b} block`);
    html = html.slice(0, i + a.length) + '\n' + inlineBody(f) + '\n' + html.slice(j);
  }
  return html;
}
export function check() {
  const html = fs.readFileSync(INDEX, 'utf8'), want = build(html), problems = [];
  if (want !== html) problems.push('index.html does not contain the current shared modules');
  if (!fs.existsSync(COPY) || fs.readFileSync(COPY, 'utf8') !== html) problems.push('mcp-server/flyer-studio.html is not the same as index.html');
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const p = check();
    if (p.length) { console.error('Out of step: ' + p.join('; ') + '. Run: node mcp-server/sync-studio.mjs'); process.exit(1); }
    console.log('studio in step');
  } else {
    const html = build(fs.readFileSync(INDEX, 'utf8'));
    fs.writeFileSync(INDEX, html); fs.writeFileSync(COPY, html);
    console.log('index.html updated and copied to mcp-server/flyer-studio.html');
  }
}
