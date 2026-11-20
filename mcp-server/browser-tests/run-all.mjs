// Runs every browser test in turn: CHROME_PATH=/path/to/chrome npm test
import { spawnSync } from 'node:child_process';
let failed = 0;
for (const t of ['mcp-test.mjs', 'studio-test.mjs', 'live-test.mjs', 'export-test.mjs', 'render-test.mjs']) {
  console.log(`\n== ${t}`);
  const r = spawnSync(process.execPath, [t], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', timeout: 300000 });
  process.stdout.write(r.stdout || '');
  if (r.status !== 0 && r.status !== null || !/ALL OK/.test(r.stdout || '')) failed++;
}
console.log(failed ? `\n${failed} test file(s) failed` : '\nall browser tests passed');
process.exit(failed ? 1 : 0);
