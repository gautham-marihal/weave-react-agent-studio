import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyToAgents,
  hasIntegration,
  readDrafts,
  reportWords,
  withIntegration,
  withIntegrations,
  withoutIntegration,
} from '../src/studio/workspaceIntegrations.js';

// What the Integrations page connects goes into every agent of the workspace (src/studio/workspaceIntegrations.js).

const agent = () => ({ meta: { name: 'Desk' }, tools: [{ id: 'end_call', type: 'builtin', builtin: 'end_call' }] });
// saved the way the page saves them now, and (old*) the way it used to: the address first, the REST API's one header second
const rest = { name: 'Orders API', url: 'https://api.example.test', headers: [{ name: 'Region', value: 'DB2', secret: false }] };
const hooks = { name: 'Hooks', url: 'https://hooks.example.test', headers: [] };
const oldRest = { name: 'Orders API', first: 'https://api.example.test', second: 'DB2' };
const oldHooks = { name: 'Hooks', first: 'https://hooks.example.test', second: 'secret' };

test('an integration goes in once, under its own id, and comes out again', () => {
  const once = withIntegration(agent(), 'webhook', hooks);
  assert.deepEqual(once.connections, { webhook: { type: 'http', base_url: 'https://hooks.example.test', timeout_s: 10 } });
  assert.deepEqual(withIntegration(once, 'webhook', hooks), once, 'applying it again changes nothing');
  assert.deepEqual(withIntegration(agent(), 'webhook', oldHooks), once, 'one saved the old way is the same connection');
  assert.equal(JSON.stringify(withIntegration(agent(), 'webhook', oldHooks)).includes('secret'), false, 'its old key box never reaches an agent');
  assert.deepEqual(withoutIntegration(once, 'webhook').connections, {});
  const plain = agent();
  assert.equal(withoutIntegration(plain, 'webhook'), plain);
});

test('the REST API is a connection only: no tools come with it, and an agent’s own tools that call it go with it', () => {
  const withRest = withIntegration(agent(), 'crm', rest);
  assert.deepEqual(withRest.connections.crm, { type: 'http', base_url: 'https://api.example.test', headers: { Region: 'DB2' }, timeout_s: 10 });
  assert.deepEqual(withRest.tools, agent().tools, 'connecting adds no tools');
  assert.deepEqual(withIntegration(agent(), 'crm', oldRest), withRest, 'one saved the old way keeps its header');
  const withTool = {
    ...withRest,
    tools: [...withRest.tools, { id: 'find_order', type: 'http', connection: 'crm', request: { method: 'GET', path: '/orders' } }],
  };
  const without = withoutIntegration(withTool, 'crm');
  assert.deepEqual(
    without.tools.map((t) => t.id),
    ['end_call'],
  );
  assert.equal(without.connections.crm, undefined);
});

test('taking a connection out also takes out the tools that called it, so the draft still validates', () => {
  const config = {
    ...withIntegration(agent(), 'webhook', hooks),
    tools: [
      { id: 'end_call', type: 'builtin', builtin: 'end_call' },
      { id: 'notify', type: 'http', connection: 'webhook', request: { method: 'POST', path: '/' } },
    ],
    agents: { entry: 'desk', items: [{ id: 'desk', tools: ['end_call', 'notify'] }] },
  };
  const out = withoutIntegration(config, 'webhook');
  assert.deepEqual(
    out.tools.map((t) => t.id),
    ['end_call'],
  );
  assert.deepEqual(out.agents.items[0].tools, ['end_call']);
});

test('a connection with no web address is not given to agents', () => {
  const plain = agent();
  assert.equal(withIntegration(plain, 'ticketing', { name: 'Tickets', url: 'acme', headers: [] }), plain);
  assert.equal(withIntegration(plain, 'ticketing', { name: 'Tickets', first: 'acme', second: 'key' }), plain);
});

test('a new agent starts with every connected integration', () => {
  const made = withIntegrations(agent(), { crm: rest, webhook: hooks });
  assert.deepEqual(Object.keys(made.connections).sort(), ['crm', 'webhook']);
});

test('every agent is saved against the revision it was read at; one that fails is named, the rest still change', async () => {
  const drafts = {
    a: { revision: 3, config: agent() },
    b: { revision: 1, config: withIntegration(agent(), 'webhook', hooks) },
    c: { revision: 7, config: agent() },
  };
  const saved = [];
  const client = {
    getDraft: async (id) => structuredClone(drafts[id]),
    saveDraft: async (id, config, revision) => {
      if (id === 'c') throw new Error('409 conflict');
      saved.push({ id, revision, has: 'webhook' in config.connections });
    },
  };
  const report = await applyToAgents(['a', 'b', 'c'], (config) => withIntegration(config, 'webhook', hooks), client);
  assert.deepEqual(saved, [{ id: 'a', revision: 3, has: true }]);
  assert.deepEqual(report, { updated: ['a'], unchanged: ['b'], failed: [{ id: 'c', message: '409 conflict' }] });
  assert.match(reportWords(report), /drafts of 1 agent;.*1 agent already had it.*\(c\)/);
  assert.match(reportWords({ updated: [], unchanged: [], failed: [] }), /no agents/);
  assert.match(reportWords({ updated: ['a', 'b'], unchanged: [], failed: [] }, true), /Taken off the drafts of 2 agents/);
});

test('which agents use a connection is read from their drafts; one that cannot be read is left out', async () => {
  const client = {
    getDraft: async (id) => {
      if (id === 'gone') throw new Error('404');
      return { revision: 1, config: id === 'a' ? withIntegration(agent(), 'webhook', hooks) : agent() };
    },
  };
  const drafts = await readDrafts(['a', 'b', 'gone'], client);
  assert.deepEqual(Object.keys(drafts), ['a', 'b']);
  assert.equal(hasIntegration(drafts.a, 'webhook'), true);
  assert.equal(hasIntegration(drafts.b, 'webhook'), false);
  assert.equal(hasIntegration(null, 'webhook'), false);
});

test('editing a connection updates only the agents that use it, and says so', async () => {
  const drafts = { a: { revision: 1, config: withIntegration(agent(), 'webhook', hooks) }, b: { revision: 1, config: agent() } };
  const saved = {};
  const client = { getDraft: async (id) => structuredClone(drafts[id]), saveDraft: async (id, config) => (saved[id] = config) };
  const moved = { ...hooks, url: 'https://new.example.test' };
  const report = await applyToAgents(['a', 'b'], (config) => (hasIntegration(config, 'webhook') ? withIntegration(config, 'webhook', moved) : config), client);
  assert.deepEqual(report.updated, ['a']);
  assert.equal(saved.a.connections.webhook.base_url, 'https://new.example.test');
  assert.equal(saved.b, undefined, 'an agent switched off stays off');
  assert.match(reportWords(report, 'update'), /^Updated in the drafts of 1 agent that use it/);
  assert.equal(reportWords({ updated: [], unchanged: ['b'], failed: [] }, 'update'), 'No agent’s draft needed changing.');
});
