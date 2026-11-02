// Runs every browser suite in e2e/ one after another, each against its own fresh stand-in API and dev server, and
// prints a summary. `node e2e/run-all.mjs [name-filter]`. Exits non-zero if any suite fails.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const filter = process.argv[2] || '';
const suites = readdirSync(dir).filter((name) => name.endsWith('.mjs') && name !== 'run-all.mjs' && name.includes(filter)).sort();
const results = [];
for (const name of suites) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [`${dir}${name}`], { stdio: 'inherit', env: process.env });
  results.push({ name, ok: run.status === 0, seconds: Math.round((Date.now() - started) / 1000) });
}
console.log('\nSummary');
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name} (${r.seconds} s)`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} suites passed`);
process.exitCode = failed ? 1 : 0;
