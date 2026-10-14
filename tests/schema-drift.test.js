import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchSchema, readEnv } from '../scripts/apiSchema.mjs';

// The engine's tests run against a saved copy of the server's schema. If the server's schema moves on and the copy
// doesn't, the tests keep passing against something the app will never see. This asks the server; it is skipped when
// there is no server to ask (no key, offline), and run `npm run sync-fixtures` to bring the copy up to date.
const env = readEnv();
const reachable = !!env.AGENT_BUILDER_API_KEY || /localhost|127\.0\.0\.1/.test(env.AGENT_BUILDER_URL || 'http://localhost:8100');

test('the saved schema matches what the server serves', { skip: !reachable && 'no Agent Builder API to compare with' }, async (t) => {
  let live;
  try { live = await fetchSchema(env); } catch (error) { t.skip(`the server couldn’t be reached (${error.message})`); return; }
  const saved = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(saved, live, 'tests/fixtures/agent-config.schema.json is out of date: run `npm run sync-fixtures`');
});
