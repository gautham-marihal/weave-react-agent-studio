import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createMockBank } from '../mock-bank/server.mjs';
import { buildAll } from '../mock-bank/agents/build.mjs';

// The mock bank API (mock-bank/server.mjs) and the six business-banking agents that call it (mock-bank/agents): the API answers as the design says,
// and every request an agent can make (its tools, hooks, task steps and hand-overs) reaches a route the API has, so nothing fails with a 404 in a call.
let server;
let base;
before(async () => {
  server = createMockBank();
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json() };
};

test('Singapore login: a phone code and PIN, with the host’s codes for a wrong code, a wrong PIN and a lock-out', async () => {
  assert.deepEqual((await call('POST', '/sg/as400/login', { phone_code: '9999999' })).json, { ok: false, code: 83, reason: 'invalid_phone_code' });
  assert.equal((await call('POST', '/sg/as400/login', { phone_code: '1234567' })).json.phone_code_valid, true);
  const ok = (await call('POST', '/sg/as400/login', { phone_code: '1234567', pin: '246810' })).json;
  assert.deepEqual(ok, { ok: true, code: 0, cif: 'SG0001001', user_type: 'business', access_level: 'P' });
  for (let i = 0; i < 2; i++) assert.equal((await call('POST', '/sg/as400/login', { phone_code: '2468024', pin: '000000' })).json.code, 53);
  assert.equal((await call('POST', '/sg/as400/login', { phone_code: '2468024', pin: '000000' })).json.code, 62, 'the third wrong PIN locks it');
});

test('Singapore account verification: a dormant account, a wrong NRIC, and the one-time password', async () => {
  assert.equal((await call('POST', '/sg/siebel/account-login', { account: '503000111222' })).json.dormant, true);
  assert.equal((await call('POST', '/sg/siebel/account-login', { account: '123' })).json.invalidAcct, 'Y');
  assert.equal((await call('POST', '/sg/siebel/verify-contact', { cif: 'SG0002002', nric_last4: '999Z' })).json.valid, false);
  assert.equal((await call('POST', '/sg/siebel/verify-contact', { cif: 'SG0002002', nric_last4: '321b' })).json.valid, true);
  assert.equal((await call('POST', '/sg/soa/otp/send', { cif: 'SG0002002' })).json.sent, true);
  assert.equal((await call('POST', '/sg/soa/otp/verify', { cif: 'SG0002002', otp: '000000' })).json.valid, false);
  assert.equal((await call('POST', '/sg/soa/otp/verify', { cif: 'SG0002002', otp: '123456' })).json.valid, true);
});

test('what an agent changes is kept and listed: a stopped cheque, a booking, a call-back, a payment', async () => {
  const stop = (await call('POST', '/sg/as400/cheques/501234567001/stop', { cheque_no: '000232', reason: 'lost' })).json;
  assert.equal(stop.ok, true);
  assert.equal((await call('GET', '/sg/as400/cheques/501234567001/000232')).json.status, 'stopped');
  assert.equal((await call('POST', '/sg/as400/cheques/501234567001/stop', { cheque_no: '000231' })).json.reason, 'already_paid');
  const booked = (await call('POST', '/sg/cmm/appointments', { slot_id: 'S1', type: 'foreign_worker', cif: 'SG0001001' })).json;
  assert.equal(booked.ok, true);
  assert.equal((await call('POST', '/sg/cmm/appointments', { slot_id: 'S1' })).json.reason, 'slot_not_available', 'a slot is booked once');
  assert.equal((await call('POST', '/sg/cmm/callbacks', { caller: '+6591234567', number: '12' })).json.reason, 'number_must_be_5_to_15_digits');
  assert.equal((await call('POST', '/sg/cmm/callbacks', { caller: '+6591234567', number: '+6591234567' })).json.ok, true);
  assert.equal((await call('GET', '/sg/cmm/callbacks/91234567')).json.open, true, 'a local number finds the call-back');
  const pay = (await call('POST', '/my/core/payments/loan', { from_account: '7011223344', reference: 'LN-5521', amount: 4200 })).json;
  assert.equal(pay.ok, true);
  assert.equal((await call('POST', '/my/core/payments/loan', { from_account: '7011223344', amount: Number.NaN })).json.reason, 'invalid_amount');
  const kinds = (await call('GET', '/activity')).json.items.map((a) => a.kind);
  for (const kind of ['cheque_stopped', 'appointment_booked', 'callback_requested', 'payment_loan']) assert.ok(kinds.includes(kind), kind);
});

test('Malaysia: a key code and TPIN, an own-account transfer in one currency only, and a card', async () => {
  assert.equal((await call('POST', '/my/core/login', { key_code: '12345678', tpin: '123456' })).json.cif, 'MY1001');
  assert.equal((await call('POST', '/my/core/login', { phone_code: '880101145678', tpin: '654321' })).json.cif, 'MY2002', 'an IC number logs in too');
  assert.equal(
    (await call('POST', '/my/core/transfers/own', { from_account: '7011223344', to_account: '7011223355', amount: 10 })).json.reason,
    'different_currencies',
  );
  assert.equal((await call('POST', '/my/core/cards/4321/activate')).json.status, 'active');
  assert.equal((await call('POST', '/my/core/cards/4321/activate')).json.reason, 'already_active');
});

test('an unknown path is a 404, and a body that is not JSON a 400', async () => {
  assert.equal((await call('GET', '/sg/nowhere')).status, 404);
  const res = await fetch(`${base}/sg/cmm/surveys`, { method: 'POST', body: '{nope' });
  assert.equal(res.status, 400);
});

test('with a key, the API answers only under /<key>, and the agents built for that address still reach every route', async () => {
  const keyed = createMockBank({ key: 'k3y' });
  await new Promise((resolve) => keyed.listen(0, resolve));
  const root = `http://localhost:${keyed.address().port}`;
  try {
    for (const path of ['/', '/activity', '/sg/cmm/promotions', '/wrong/sg/cmm/promotions', '/k3yx/sg/cmm/promotions'])
      assert.equal((await fetch(root + path)).status, 404, path);
    assert.equal((await fetch(`${root}/k3y`)).status, 200);
    assert.equal((await fetch(`${root}/k3y/activity`)).status, 200);
    assert.equal((await (await fetch(`${root}/k3y/sg/as400/rates/prime`)).json()).prime_rate_pct > 0, true);
    for (const config of buildAll(`${root}/k3y`)) {
      for (const [connection, method, path] of requestsOf(config)) {
        const url = config.connections[connection].base_url + path.replace(/\{\{[^}]+\}\}/g, '501234567001');
        const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
        assert.notEqual(res.status, 404, `${config.meta.id}: ${method} ${path}`);
      }
    }
  } finally {
    keyed.close();
  }
});

// every HTTP request in an agent configuration: [connection, method, path]
function requestsOf(config) {
  const out = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (node.type === 'http' && node.connection && node.method && node.path) out.push([node.connection, node.method, node.path]);
    if (node.type === 'http' && node.connection && node.request) out.push([node.connection, node.request.method, node.request.path]);
    if (node.method === 'http_request' && node.request) out.push([node.request.connection, node.request.method, node.request.path]);
    Object.values(node).forEach(walk);
  };
  walk(config);
  return out;
}

test('the six agents are built, and every request they can make reaches a route of the mock API', async () => {
  const configs = buildAll(base);
  assert.deepEqual(
    configs.map((c) => c.meta.id),
    ['sg-business-banking', 'sg-vip-desk', 'sg-investigations', 'sg-sm-survey', 'my-business-banking', 'my-consumer-banking'],
  );
  for (const config of configs) {
    const requests = requestsOf(config);
    assert.ok(requests.length > 0, config.meta.id);
    for (const [connection, method, path] of requests) {
      const prefix = config.connections[connection]?.base_url;
      assert.ok(prefix, `${config.meta.id}: connection ${connection}`);
      // fill every template with a plausible value: digits, which every route's parameters accept
      const filled = path.replace(/\{\{[^}]+\}\}/g, '501234567001');
      const res = await fetch(prefix + filled, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
      assert.notEqual(res.status, 404, `${config.meta.id}: ${method} ${connection}${path} has no route in the mock API`);
    }
  }
});

test('each agent offers only tools it declares, and hands off only to agents it has', () => {
  for (const config of buildAll('http://mock.test')) {
    const tools = new Set(config.tools.map((t) => t.id));
    const agents = new Set(config.agents.items.map((a) => a.id));
    for (const agent of config.agents.items) {
      for (const id of agent.tools) assert.ok(tools.has(id), `${config.meta.id}/${agent.id}: tool ${id}`);
      for (const h of agent.handoffs || []) assert.ok(agents.has(h.to), `${config.meta.id}/${agent.id}: hands off to ${h.to}`);
    }
    // the validator crashes on a tool parameter called "type" (found 2026-10-26): never use that name
    for (const t of config.tools) assert.ok(!t.parameters?.properties?.type, `${config.meta.id}: ${t.id} has a parameter named type`);
  }
});
