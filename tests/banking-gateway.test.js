import test from 'node:test';
import assert from 'node:assert/strict';
import { gatewayRoute } from '../src/studio/banking/gatewayRoute.ts';
import { applyGatewayConfig, stableJson, usesGateway } from '../src/studio/banking/gatewayConfig.ts';

// The banking gateway, from the studio's side: which requests the dev server forwards (and with which credential), and
// how the gateway's generated tools are put into a draft.

const REHEARSAL = `rehearsal_${'a'.repeat(32)}`;

test('the runtime token is added only to the read-only routes the studio needs', () => {
  for (const path of [
    '/v1/tools',
    '/v1/agent-config',
    '/v1/rooms/room-1/timeline',
    '/v1/sessions/call-1/timeline',
    '/health',
    '/gateway/v1/tools',
    '/v1/tools/',
  ]) {
    assert.equal(gatewayRoute('GET', path, undefined, false), 'runtime', path);
  }
});

test('the caller’s channel routes pass with the browser’s own room token; other methods on them are refused', () => {
  assert.equal(gatewayRoute('GET', '/v1/channel/events', undefined, false), 'channel');
  assert.equal(gatewayRoute('POST', '/v1/channel/capture', undefined, false), 'channel');
  assert.equal(gatewayRoute('DELETE', '/v1/channel/capture', undefined, false), 'deny');
});

test('the browser can never start a session, or run a tool for a real call, even with rehearsals on', () => {
  assert.equal(gatewayRoute('POST', '/v1/sessions', undefined, true), 'deny');
  assert.equal(gatewayRoute('POST', '/v1/sessions/end', undefined, true), 'deny');
  assert.equal(gatewayRoute('POST', '/v1/tools/get_balance', 'call-123', true), 'deny');
  assert.equal(gatewayRoute('POST', '/v1/tools/get_balance', undefined, true), 'deny');
  assert.equal(gatewayRoute('GET', '/v1/../v1/tools', undefined, false), 'deny', 'no path tricks');
  assert.equal(gatewayRoute('GET', '/v1//tools', undefined, false), 'deny', 'no path tricks');
});

test('rehearsal routes, test logins and rehearsal tool calls pass only when rehearsals are on, and only for a rehearsal', () => {
  assert.equal(gatewayRoute('POST', '/dev/rehearsals', undefined, false), 'deny');
  assert.equal(gatewayRoute('POST', '/v1/tools/get_balance', REHEARSAL, false), 'deny');
  assert.equal(gatewayRoute('GET', '/dev/test-logins', undefined, false), 'deny');
  assert.equal(gatewayRoute('POST', '/dev/rehearsals', undefined, true), 'runtime');
  assert.equal(gatewayRoute('POST', '/v1/tools/get_balance', REHEARSAL, true), 'runtime');
  assert.equal(gatewayRoute('GET', `/dev/rehearsals/${REHEARSAL}/sms`, undefined, true), 'runtime');
  assert.equal(gatewayRoute('POST', `/dev/rehearsals/${REHEARSAL}/end`, undefined, true), 'runtime');
  assert.equal(gatewayRoute('GET', '/dev/test-logins', undefined, true), 'runtime');
  assert.equal(gatewayRoute('GET', '/dev/rehearsals/call-1/sms', undefined, true), 'deny', 'not a rehearsal id');
  assert.equal(gatewayRoute('POST', '/dev/test-logins', undefined, true), 'deny');
});

// ---- the generated config in a draft

const tool = (id, extra = {}) => ({
  id,
  type: 'http',
  connection: 'banking_gateway',
  description: `${id} tool`,
  request: { method: 'POST', path: `/v1/tools/${id}` },
  ...extra,
});
const generated = () => ({
  tools: [tool('get_auth_status'), tool('get_balance'), tool('list_accounts')],
  connections: {
    banking_gateway: { type: 'http', base_url: '{{const.banking_gateway_url}}', auth: { type: 'bearer', token: { secret: 'BANKING_GATEWAY_TOKEN' } } },
  },
  events: [
    { on: 'call_started', do: [{ type: 'http', connection: 'banking_gateway', method: 'POST', path: '/v1/sessions', body: { call_id: '{{state.call_id}}' } }] },
    {
      on: 'call_ended',
      do: [{ type: 'http', connection: 'banking_gateway', method: 'POST', path: '/v1/sessions/end', body: { call_id: '{{state.call_id}}' } }],
    },
  ],
  state: { variables: { call_id: { type: 'string', source: { generate: { kind: 'epoch_hex' } } } } },
  agentTools: { greeter: ['get_auth_status'], accounts: ['list_accounts', 'get_balance'], cheques: ['list_accounts'] },
  requiredConstants: ['banking_gateway_url'],
  runtimeDependencies: [],
});
const base = () => ({
  constants: { payment_url: 'https://pay.example' },
  tools: [{ id: 'end_call', type: 'builtin', builtin: 'end_call' }],
  events: [{ on: 'call_started', do: [{ type: 'log', level: 'info', message: 'hello' }] }],
  agents: {
    entry: 'greeter',
    items: [
      { id: 'greeter', name: 'Greeter', tools: ['end_call'] },
      { id: 'accounts', name: 'Accounts' },
    ],
  },
});
const role = (config, id) => config.agents.items.find((a) => a.id === id);

test('adding the banking tools keeps everything the owner wrote and adds the tools, session events, call_id and address', () => {
  const r = applyGatewayConfig(base(), generated(), 'https://gateway.bank.example');
  assert.equal(r.ok, true);
  assert.deepEqual(r.added, ['get_auth_status', 'get_balance', 'list_accounts']);
  assert.deepEqual(
    r.config.tools.map((t) => t.id),
    ['end_call', 'get_auth_status', 'get_balance', 'list_accounts'],
  );
  assert.deepEqual(r.config.constants, { payment_url: 'https://pay.example', banking_gateway_url: 'https://gateway.bank.example' });
  assert.deepEqual(
    r.config.events[0].do.map((a) => a.path ?? a.type),
    ['log', '/v1/sessions'],
  );
  assert.equal(r.config.events[1].on, 'call_ended');
  assert.ok(r.config.state.variables.call_id);
  assert.deepEqual(role(r.config, 'greeter').tools, ['end_call', 'get_auth_status']);
  assert.deepEqual(role(r.config, 'accounts').tools, ['list_accounts', 'get_balance']);
  assert.deepEqual(r.rolesMissing, ['cheques'], 'a specialist the draft lacks is named, not made up');
  assert.equal(usesGateway(r.config), true);
  assert.equal(usesGateway(base()), false);
});

test('a second run changes nothing; a later one refreshes changed tools and drops the ones the gateway dropped', () => {
  const first = applyGatewayConfig(base(), generated(), 'https://gateway.bank.example');
  const again = applyGatewayConfig(first.config, generated());
  assert.equal(again.changed, false);
  assert.equal(again.config, first.config);
  assert.equal(again.config.events[0].do.length, 2);

  const next = generated();
  next.tools = [tool('get_auth_status', { description: 'new words' }), tool('get_balance')];
  next.agentTools = { greeter: ['get_auth_status'], accounts: ['get_balance'] };
  const r = applyGatewayConfig(first.config, next);
  assert.deepEqual(r.updated, ['get_auth_status']);
  assert.deepEqual(r.removed, ['list_accounts']);
  assert.deepEqual(role(r.config, 'accounts').tools, ['get_balance']);
});

test('nothing changes when a hand-written tool has a banking tool’s name, or the address is missing or not a web address', () => {
  const config = base();
  config.tools.push({ id: 'get_balance', type: 'http', connection: 'core_banking' });
  const clash = applyGatewayConfig(config, generated(), 'https://gateway.bank.example');
  assert.equal(clash.ok, false);
  assert.match(clash.conflicts[0], /"get_balance" is hand-written/);
  assert.equal(clash.config, config);
  assert.match(applyGatewayConfig(base(), generated()).conflicts[0], /banking_gateway_url/);
  assert.equal(applyGatewayConfig(base(), generated(), 'gateway.bank.example').ok, false);
});

test('a connection the owner set up is kept, and a role over the 8-tool limit is named', () => {
  const owned = {
    ...base(),
    connections: { banking_gateway: { type: 'http', base_url: '{{const.banking_gateway_url}}', auth: { type: 'bearer', token: { secret: 'OTHER_SECRET' } } } },
  };
  const r = applyGatewayConfig(owned, generated(), 'https://gateway.bank.example');
  assert.equal(r.connectionKept, true);
  assert.equal(r.config.connections.banking_gateway.auth.token.secret, 'OTHER_SECRET');

  const many = generated();
  many.tools = Array.from({ length: 9 }, (_, i) => tool(`t${i}`));
  many.agentTools = { accounts: many.tools.map((t) => t.id) };
  assert.deepEqual(applyGatewayConfig(base(), many, 'https://g.example').rolesOverLimit, ['accounts']);
});

test('stableJson ignores key order', () => {
  assert.equal(stableJson({ a: 1, b: [{ c: 2, d: 3 }] }), stableJson({ b: [{ d: 3, c: 2 }], a: 1 }));
});
