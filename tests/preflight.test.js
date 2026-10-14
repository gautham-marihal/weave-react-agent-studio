import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTION_WORD, isSecurity, mayDeploy, secretsStatus, splitUnsupported } from '../src/studio/preflight.js';

const items = [
  { feature: 'MCP server tools', where: 'tools[3]' },
  { feature: 'sensitive variable pin', where: 'state.variables.pin', severity: 'security' },
  { feature: 'post_call.redaction', where: 'post_call.redaction', severity: 'security' },
  { feature: 'Task tools', where: 'tools[1]', severity: 'advice' },
];

test('security items are split from ordinary advice, and nothing is lost', () => {
  const { security, advice } = splitUnsupported(items);
  assert.deepEqual(security.map((i) => i.where), ['state.variables.pin', 'post_call.redaction']);
  assert.deepEqual(advice.map((i) => i.where), ['tools[3]', 'tools[1]']);
  assert.equal(security.length + advice.length, items.length);
  assert.equal(isSecurity(items[1]), true);
  assert.equal(isSecurity(items[0]), false);
});

test('missing or odd input is treated as nothing to report', () => {
  for (const input of [undefined, null, 'x', {}, []]) assert.deepEqual(splitUnsupported(input), { security: [], advice: [] });
});

test('a production deploy needs the word typed while a security item stands; other environments never do', () => {
  const security = [items[1]];
  assert.equal(mayDeploy({ environment: 'production', security: [], typed: '' }), true);
  assert.equal(mayDeploy({ environment: 'production', security, typed: '' }), false);
  assert.equal(mayDeploy({ environment: 'production', security, typed: 'prod' }), false);
  assert.equal(mayDeploy({ environment: 'production', security, typed: PRODUCTION_WORD }), true);
  assert.equal(mayDeploy({ environment: 'production', security, typed: '  Production ' }), true);
  assert.equal(mayDeploy({ environment: 'staging', security, typed: '' }), true);
  assert.equal(mayDeploy({ environment: 'development', security, typed: '' }), true);
});

test('secrets: a key the server says is not set is marked, one it can’t know about is just listed', () => {
  const providers = [{ name: 'openai', default_secret: 'OPENAI_API_KEY', key_available: true }, { name: 'anthropic', default_secret: 'ANTHROPIC_API_KEY', key_available: false }];
  assert.deepEqual(secretsStatus(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CRM_TOKEN'], providers), [
    { name: 'OPENAI_API_KEY', missing: false, known: true },
    { name: 'ANTHROPIC_API_KEY', missing: true, known: true },
    { name: 'CRM_TOKEN', missing: false, known: false },
  ]);
  assert.deepEqual(secretsStatus(undefined, providers), []);
  assert.deepEqual(secretsStatus(['X'], undefined), [{ name: 'X', missing: false, known: false }]);
});

test('rollback target: the version this environment ran before, if any', async () => {
  const { rollbackTarget } = await import('../src/studio/preflight.js');
  const data = {
    current: { production: { id: 'd3', version: '1.2.0' }, staging: { id: 'd1', version: '1.0.0' } },
    history: [{ id: 'd1', version: '1.0.0', environment: 'staging', previous_version: null }, { id: 'd2', version: '1.1.0', environment: 'production', previous_version: null }, { id: 'd3', version: '1.2.0', environment: 'production', previous_version: '1.1.0' }],
  };
  assert.equal(rollbackTarget(data, 'production'), '1.1.0');
  assert.equal(rollbackTarget(data, 'staging'), null);
  assert.equal(rollbackTarget(data, 'development'), null);
  assert.equal(rollbackTarget({ current: { production: { id: 'x', version: '2.0.0', previous_version: '2.0.0' } }, history: [] }, 'production'), null);
  assert.equal(rollbackTarget(null, 'production'), null);
});
