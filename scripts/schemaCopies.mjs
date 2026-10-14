// The agent-config schema lives in several places, and they must not drift apart:
//
//   tests/fixtures/agent-config.schema.json   the source of truth in this repo (what the server served; the engine's tests run on it)
//   public/config/agent-config.schema.json    the copy people download from the landing page (shipped as /config/... in the build)
//   src/api/agentConfig.d.ts                  the TypeScript declarations the editor uses, generated from it
//
// `npm run sync-fixtures` fetches the server's schema and then calls writeCopies(); `npm run sync-public` (this file run
// directly) propagates what is already in tests/fixtures without asking the server. dist/ is a build output: `npm run build`
// refreshes it from public/.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateTypes } from './schemaTypes.mjs';

const FIXTURE = new URL('../tests/fixtures/agent-config.schema.json', import.meta.url);
const PUBLIC = new URL('../public/config/agent-config.schema.json', import.meta.url);
const TYPES = new URL('../src/api/agentConfig.d.ts', import.meta.url);

// The fixture is kept compact; the public copy is for reading, so it is indented.
export function writeCopies(schema) {
  writeFileSync(FIXTURE, JSON.stringify(schema));
  writeFileSync(PUBLIC, `${JSON.stringify(schema, null, 2)}\n`);
  writeFileSync(TYPES, generateTypes(schema));
  return [FIXTURE, PUBLIC, TYPES].map((url) => fileURLToPath(url));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const schema = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  writeCopies(schema).forEach((file) => console.log(`Wrote ${file}`));
}
