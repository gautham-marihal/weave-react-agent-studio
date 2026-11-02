// Refreshes src/test/fixtures/agent-config.schema.json from the live GET /schema (a read). The tests that prove the
// forms write real config paths run against this copy, so they need no network. Uses AGENT_BUILDER_URL and
// AGENT_BUILDER_API_KEY from the environment or .env, like the dev proxy.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const env = { ...process.env };
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2];
  }
}
const base = env.AGENT_BUILDER_URL;
if (!base) {
  console.error('Set AGENT_BUILDER_URL (and AGENT_BUILDER_API_KEY) first.');
  process.exit(1);
}
const res = await fetch(`${base.replace(/\/$/, '')}/schema`, {
  headers: env.AGENT_BUILDER_API_KEY ? { Authorization: `Bearer ${env.AGENT_BUILDER_API_KEY}` } : {},
});
if (!res.ok) {
  console.error(`GET /schema answered ${res.status}`);
  process.exit(1);
}
const schema = await res.json();
writeFileSync('src/test/fixtures/agent-config.schema.json', `${JSON.stringify(schema, null, 1)}\n`);
console.log('Saved src/test/fixtures/agent-config.schema.json');
