import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDemoApi, memoryStorage, minimalConfig } from '../src/demo/demoApi.js';
import { diffConfigs } from '../src/demo/diff.js';
import { validateDemo } from '../src/demo/demoValidate.js';

const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const fresh = (options = {}) => createDemoApi({ storage: memoryStorage(), loadSchema: async () => schema, ...options });
const call = async (api, method, path, body) => api.handle(method, path, body);

test('the demo starts with a few agents, with some history to look at, and every seed is valid', async () => {
  const api = fresh();
  const { body: list } = await call(api, 'GET', '/bots');
  assert.deepEqual(list.map((b) => b.id).sort(), ['acme-support', 'bookings', 'front-desk']);
  const support = list.find((b) => b.id === 'acme-support');
  assert.equal(support.latest_version, '0.1.1');
  assert.deepEqual(support.deployed, { development: '0.1.1', staging: '0.1.0' });
  for (const bot of list) {
    const { body: draft } = await call(api, 'GET', `/bots/${bot.id}/draft`);
    const report = validateDemo(draft.config, bot.id);
    assert.equal(report.valid, true, `${bot.id}: ${JSON.stringify(report.errors)}`);
  }
});

test('creating an agent: pattern, reserved ids, duplicates', async () => {
  const api = fresh({ seed: false });
  assert.equal((await call(api, 'POST', '/bots', { id: 'Bad Id', name: 'x' })).status, 400);
  assert.equal((await call(api, 'POST', '/bots', { id: 'logs', name: 'x' })).status, 400);
  const created = await call(api, 'POST', '/bots', { id: 'new-one', name: 'New one' });
  assert.equal(created.status, 201);
  assert.equal(created.body.revision, 1);
  assert.equal(created.body.config.meta.id, 'new-one');
  assert.equal((await call(api, 'POST', '/bots', { id: 'new-one', name: 'again' })).status, 409);
});

test('saving a draft is revision-locked, saves even when invalid, and answers with a report', async () => {
  const api = fresh({ seed: false });
  await call(api, 'POST', '/bots', { id: 'a', name: 'A' });
  const { body: draft } = await call(api, 'GET', '/bots/a/draft');
  const broken = { ...draft.config, agents: { ...draft.config.agents, entry: 'nobody' } };
  const saved = await call(api, 'PUT', '/bots/a/draft', { config: broken, base_revision: draft.revision });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.draft.revision, draft.revision + 1);
  assert.equal(saved.body.validation.valid, false);
  assert.deepEqual(saved.body.validation.errors[0].path, ['agents', 'entry']);
  assert.equal((await call(api, 'PUT', '/bots/a/draft', { config: draft.config, base_revision: draft.revision })).status, 409, 'a stale revision is refused');
  assert.equal((await call(api, 'PUT', '/bots/a/draft', { config: draft.config })).status, 200, 'no revision overwrites');
});

test('publishing needs a valid draft, freezes it, and moves the draft on; bumps count from the latest', async () => {
  const api = fresh({ seed: false });
  await call(api, 'POST', '/bots', { id: 'a', name: 'A' });
  const { body: draft } = await call(api, 'GET', '/bots/a/draft');
  await call(api, 'PUT', '/bots/a/draft', { config: { ...draft.config, agents: { entry: 'x', items: [] } } });
  assert.equal((await call(api, 'POST', '/bots/a/publish', {})).status, 422);
  await call(api, 'PUT', '/bots/a/draft', { config: draft.config });
  assert.equal((await call(api, 'POST', '/bots/a/publish', { bump: 'minor' })).status, 400, 'nothing to count from yet');
  const first = await call(api, 'POST', '/bots/a/publish', {});
  assert.equal(first.status, 201);
  assert.equal(first.body.version, '0.1.0');
  assert.equal((await call(api, 'GET', '/bots/a/draft')).body.config.meta.version, '0.1.1', 'the draft moved on');
  assert.equal((await call(api, 'POST', '/bots/a/publish', { bump: 'minor' })).body.version, '0.2.0');
  assert.deepEqual((await call(api, 'GET', '/bots/a/versions')).body.map((v) => v.version), ['0.2.0', '0.1.0'], 'newest first');
  assert.equal((await call(api, 'GET', '/bots/a/versions/0.1.0')).body.config.meta.version, '0.1.0');
});

test('deploying points an environment at a published version and remembers what it replaced', async () => {
  const api = fresh({ seed: false });
  await call(api, 'POST', '/bots', { id: 'a', name: 'A' });
  await call(api, 'POST', '/bots/a/publish', {});
  await call(api, 'POST', '/bots/a/publish', { bump: 'patch' });
  assert.equal((await call(api, 'POST', '/bots/a/deploy', { version: '9.9.9', environment: 'production' })).status, 404);
  assert.equal((await call(api, 'POST', '/bots/a/deploy', { version: '0.1.0', environment: 'moon' })).status, 400);
  const one = await call(api, 'POST', '/bots/a/deploy', { version: '0.1.0', environment: 'production', note: 'first' });
  assert.equal(one.body.deployment.status, 'active');
  assert.equal(one.body.deployment.previous_version, null);
  const two = await call(api, 'POST', '/bots/a/deploy', { version: '0.1.1', environment: 'production' });
  assert.equal(two.body.deployment.previous_version, '0.1.0');
  const { body } = await call(api, 'GET', '/bots/a/deployments');
  assert.equal(body.current.production.version, '0.1.1');
  assert.equal(body.history.length, 2);
  assert.equal((await call(api, 'GET', `/bots/a/deployments/${two.body.deployment.id}`)).body.version, '0.1.1');
  assert.equal((await call(api, 'GET', '/bots')).body[0].deployed.production, '0.1.1');
});

test('there is no real conversation in the demo, and the answer says why', async () => {
  const api = fresh();
  const answer = await call(api, 'POST', '/bots/acme-support/sessions', {});
  assert.equal(answer.status, 503);
  assert.match(answer.body.detail, /simulated preview/);
});

test('the diff addresses id lists by id, like the API', () => {
  const a = { persona: { name: 'A', tone: 'warm' }, tools: [{ id: 'x', description: 'one' }, { id: 'y' }], tags: ['a'] };
  const b = { persona: { name: 'A', tone: 'calm' }, tools: [{ id: 'x', description: 'two' }, { id: 'z' }], tags: ['a', 'b'] };
  const changes = diffConfigs(a, b);
  assert.deepEqual(changes.find((c) => c.path.join('.') === 'persona.tone'), { op: 'change', path: ['persona', 'tone'], before: 'warm', after: 'calm' });
  assert.deepEqual(changes.find((c) => c.path.join('.') === 'tools.id=x.description'), { op: 'change', path: ['tools', 'id=x', 'description'], before: 'one', after: 'two' });
  assert.equal(changes.find((c) => c.path.join('.') === 'tools.id=y').op, 'remove');
  assert.equal(changes.find((c) => c.path.join('.') === 'tools.id=z').op, 'add');
  assert.deepEqual(changes.find((c) => c.path.join('.') === 'tags.1'), { op: 'add', path: ['tags', 1], after: 'b' });
  assert.deepEqual(diffConfigs(a, a), []);
});

test('the demo validator says it is a demo, and catches the cheap mistakes the real one would', () => {
  const ok = validateDemo(minimalConfig('a', 'A'), 'a');
  assert.equal(ok.valid, true);
  assert.match(ok.warnings[0].message, /not by the real validator/);
  assert.equal(validateDemo(minimalConfig('a', 'A'), 'other').errors[0].path.join('.'), 'meta.id');
  const dup = minimalConfig('a', 'A');
  dup.tools = [{ id: 't', type: 'builtin', builtin: 'noop' }, { id: 't', type: 'builtin', builtin: 'noop' }];
  dup.agents.items[0].tools = ['t', 'ghost'];
  const report = validateDemo(dup, 'a');
  assert.ok(report.errors.some((e) => /duplicate tool id 't'/.test(e.message)));
  assert.ok(report.errors.some((e) => e.path.join('.') === 'agents.items.0.tools.1'));
  const bad = minimalConfig('a', 'A');
  bad.defaults.models.llm = { provider: 'whisper', model: '' };
  assert.ok(validateDemo(bad, 'a').errors.some((e) => /not known to the runtime/.test(e.message)));
  const sensitive = minimalConfig('a', 'A');
  sensitive.schema_version = '1.1';
  sensitive.state = { variables: { pin: { type: 'string', sensitive: true } } };
  assert.ok(validateDemo(sensitive, 'a').errors.some((e) => e.path[0] === 'schema_version'));
  sensitive.schema_version = '1.2';
  const r2 = validateDemo(sensitive, 'a');
  assert.equal(r2.valid, true);
  assert.equal(r2.unsupported[0].severity, 'security');
  assert.deepEqual(r2.secrets_required, ['OPENAI_API_KEY']);
  assert.equal(validateDemo([], 'a').valid, false);
});
