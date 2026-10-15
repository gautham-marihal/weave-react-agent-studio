import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../src/studio/form/engine.js';
import { applyStarter } from '../src/studio/starters.js';
import { createDemoApi, memoryStorage, minimalConfig } from '../src/demo/demoApi.js';
import { checksumOf, runScenarioDemo } from '../src/demo/demoTests.js';
import {
  EXPECT_KINDS, addMockTo, describeExpectation, freshScenarioId, isUnknownExpectation, mockProblem, newExpectation, newScenario, nowProblem, parseImport, parseObject,
  parseValue, regexProblem, scenarioFromConversation, scenarioProblems, showValue, stubMock,
} from '../src/studio/scenarios/model.js';
import { nextSteps, normalizeCheck, normalizeHeadline, normalizeResult, normalizeRun, normalizeScenarioList, resultSummary, testStatusOf } from '../src/studio/scenarios/runResults.js';

const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const support = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');

// a bot like the review's Nimbus: an HTTP tool, a handoff, state variables, web chat
function nimbus() {
  const config = minimalConfig('nimbus', 'Nimbus');
  config.state = { variables: { verified: { type: 'boolean', default: false }, ticket_id: { type: 'string', nullable: true, default: null } } };
  config.connections = { api: { type: 'http', base_url: 'https://api.example.com' } };
  config.tools = [
    { id: 'find_order', type: 'http', description: 'Looks up an order', connection: 'api', request: { method: 'GET', path: '/orders/{{args.order_id}}' }, parameters: { type: 'object', properties: { order_id: { type: 'string' } } }, result: { to_llm: ['found', 'summary'], to_state: { ticket_id: '$.ticket' } } },
    { id: 'open_ticket', type: 'http', description: 'Raises a ticket', connection: 'api', request: { method: 'POST', path: '/tickets', body: { order: '{{args.order_id}}' } }, parameters: { type: 'object', properties: { order_id: { type: 'string' } } } },
    { id: 'end_call', type: 'builtin', builtin: 'end_call', description: 'Ends the conversation', params: { say: 'Goodbye.' } },
  ];
  config.agents.items = [
    { id: 'front_desk', name: 'Front desk', kind: 'router', instructions: { role: 'Greet and route.' }, tools: ['end_call'], handoffs: [{ tool: 'go_billing', to: 'billing', description: 'Billing questions' }] },
    { id: 'billing', name: 'Billing', kind: 'specialist', instructions: { role: 'Handle billing.' }, tools: ['find_order', 'open_ticket', 'end_call'] },
  ];
  config.agents.entry = 'front_desk';
  return config;
}

test('the kinds of expectation are exactly the ones the schema allows (all nine)', () => {
  const engine = createEngine(schema);
  const items = engine.flatten(engine.flatten(engine.flatten(schema.properties.tests).items).properties.expect).items;
  const keys = engine.branchesOf(engine.flatten(items)).map((b) => Object.keys(engine.flatten(b).properties)[0]).sort();
  assert.equal(keys.length, 9);
  assert.deepEqual(EXPECT_KINDS.map((k) => k.key).sort(), keys);
  const props = engine.flatten(engine.flatten(schema.properties.tests).items).properties;
  ['description', 'now', 'state', 'http_mocks', 'model_script'].forEach((key) => assert.ok(key in props, `the schema has ${key}`));
});

test('a new scenario starts valid on the first enabled channel, and ids stay unique', () => {
  const config = support();
  const s = newScenario(config);
  assert.equal(s.channel, 'web-chat');
  assert.deepEqual(scenarioProblems(s, config), {});
  assert.equal(freshScenarioId([{ id: 'scenario' }, { id: 'scenario_2' }]), 'scenario_3');
  assert.equal(newScenario({ ...config, tests: [s] }).id, 'scenario_2');
});

test('what is wrong with a scenario is said where it is', () => {
  const config = support();
  const bad = { id: 'Bad Id', channel: 'ghost', turns: [{ say: '' }], expect: [{ tool_called: 'nope' }, { said_matches: '(' }, { state_equals: { state: 'nope', value: 1 } }, { judge: ' ' }, { agent_is: 'nobody' }] };
  const p = scenarioProblems(bad, config);
  assert.match(p.id, /lowercase/);
  assert.match(p.channel, /no channel “ghost”/);
  assert.match(p.turns, /Every turn needs some words/);
  assert.equal(p.expect.length, 5);
  assert.match(p.expect[0], /no tool “nope”/);
  assert.match(p.expect[1], /not a valid pattern/);
  assert.match(p.expect[2], /no state variable/);
  assert.match(p.expect[4], /no agent “nobody”/);
  assert.match(scenarioProblems({ ...newScenario(config), turns: [] }, config).turns, /at least one/);
  assert.match(scenarioProblems({ ...newScenario(config), expect: [] }, config).expect[0], /at least one/);
  assert.match(scenarioProblems({ id: 'a', channel: 'web-chat', turns: [{ say: 'x' }], expect: [{ said_matches: '.' }] }, config, [{ id: 'a' }, { id: 'a' }]).id, /Another scenario/);
  assert.equal(regexProblem('^ok$'), '');
  assert.notEqual(regexProblem('['), '');
});

test('the review’s scenario (newer expectations, mocks, a clock, a script) is valid and nothing about it blocks Save', () => {
  const config = nimbus();
  const scenario = {
    id: 'a_billing_question_opens_a_ticket', description: 'A caller with a billing question reaches billing and a ticket is raised.', channel: 'web-chat', now: '2026-10-14T03:00:00+08:00', state: { verified: true },
    http_mocks: [{ connection: 'api', method: 'GET', path: '/orders/*', status: 200, json: { found: true, summary: 'Order NB-1003, shipped', ticket: 'TK-5001' }, times: 1 }],
    model_script: [{ tool: 'go_billing' }, 'Let me check that.', { tool: 'find_order', args: { order_id: 'NB-1003' } }, 'It shipped.'],
    turns: [{ say: 'Where is my order NB-1003?' }],
    expect: [{ tool_called_with: { tool: 'find_order', args: { order_id: 'NB-1003' } } }, { agent_is: 'billing' }, { http_called: { method: 'GET', path: '/orders/*', times: 1 } }, { http_not_called: { method: 'POST', path: '/tickets' } }, { state_equals: { state: 'ticket_id', value: 'TK-5001' } }, { tool_called: 'find_order' }],
  };
  assert.deepEqual(scenarioProblems(scenario, config), {});
  scenario.expect.forEach((e) => assert.equal(isUnknownExpectation(e), false));
});

test('a kind of expectation the form does not know is kept and never an error (the schema grows)', () => {
  const config = nimbus();
  const future = { id: 'future', channel: 'web-chat', turns: [{ say: 'hi' }], expect: [{ tool_called: 'find_order' }, { sentiment_is: 'positive' }] };
  assert.deepEqual(scenarioProblems(future, config), {}, 'an unknown kind is not a problem');
  assert.equal(isUnknownExpectation(future.expect[1]), true);
  assert.match(describeExpectation(future.expect[1]), /something else is expected .*sentiment_is/);
});

test('the new fields are checked only for what is positively wrong', () => {
  const config = nimbus();
  const base = { id: 's', channel: 'web-chat', turns: [{ say: 'x' }], expect: [{ said_matches: '.' }] };
  assert.deepEqual(scenarioProblems({ ...base, now: '2026-10-14T03:00:00Z' }, config), {});
  assert.match(scenarioProblems({ ...base, now: 'tomorrow' }, config).now, /time zone/);
  assert.equal(nowProblem(''), '');
  assert.match(scenarioProblems({ ...base, state: [] }, config).state, /object/);
  assert.match(scenarioProblems({ ...base, http_mocks: [{ status: 200 }] }, config).mocks[0], /request path/);
  assert.match(mockProblem({ path: '/x', status: 700 }, 0), /100 to 599/);
  assert.match(mockProblem({ path: '/x', method: 'FETCH' }, 0), /method/);
  assert.match(mockProblem({ path: '/x', times: 0 }, 0), /times/);
  assert.equal(mockProblem({ path: '/x', method: 'GET', status: 404, text: 'nope', times: 2, query: { a: '1' }, body_contains: { b: 1 } }, 0), '');
  assert.match(scenarioProblems({ ...base, model_script: ['', { tool: 'x' }] }, config).script[0], /write what the model says/);
  assert.match(scenarioProblems({ ...base, model_script: [{ args: {} }] }, config).script[0], /choose the tool/);
  assert.match(scenarioProblems({ ...base, expect: [{ http_called: { path: '' } }] }, config).expect[0], /request path/);
  assert.match(scenarioProblems({ ...base, expect: [{ http_called: { path: '/x', times: 0 } }] }, config).expect[0], /times/);
  assert.match(scenarioProblems({ ...base, expect: [{ tool_called_with: { tool: 'nope', args: {} } }] }, config).expect[0], /no tool/);
  assert.deepEqual(parseObject(''), { value: undefined });
  assert.deepEqual(parseObject('{"a":1}'), { value: { a: 1 } });
  assert.match(parseObject('[1]').error, /object/);
  assert.match(parseObject('{').error, /Not valid JSON/);
});

test('a new expectation of every kind is filled in sensibly for this config', () => {
  const config = nimbus();
  assert.deepEqual(newExpectation('tool_called', config), { tool_called: 'find_order' });
  assert.deepEqual(newExpectation('tool_called_with', config), { tool_called_with: { tool: 'find_order', args: {} } });
  assert.deepEqual(newExpectation('state_equals', config), { state_equals: { state: 'verified', value: '' } });
  assert.deepEqual(newExpectation('agent_is', config), { agent_is: 'front_desk' });
  assert.deepEqual(newExpectation('http_called', config), { http_called: { method: 'GET', path: '' } });
  assert.deepEqual(newExpectation('http_not_called', config), { http_not_called: { method: 'POST', path: '' } });
  assert.equal(EXPECT_KINDS.every((k) => Object.keys(newExpectation(k.key, config)).includes(k.key)), true);
});

test('expectations read as sentences', () => {
  assert.equal(describeExpectation({ tool_called: 'end_call' }), 'the tool “end_call” is called');
  assert.equal(describeExpectation({ state_equals: { state: 'outcome', value: 'paid' } }), 'outcome ends up as "paid"');
  assert.equal(describeExpectation({ said_matches: 'bill' }), 'the agent says something matching /bill/');
  assert.equal(describeExpectation({ judge: 'it was polite' }), 'a reviewer agrees that it was polite');
  assert.equal(describeExpectation({ agent_is: 'billing' }), 'the conversation ends with the agent “billing”');
  assert.equal(describeExpectation({ tool_called_with: { tool: 'find_order', args: { order_id: 'x' } } }), 'the tool “find_order” is called with {"order_id":"x"}');
  assert.equal(describeExpectation({ http_called: { method: 'GET', path: '/orders/*', times: 2 } }), 'the bot calls GET /orders/* 2 times');
  assert.equal(describeExpectation({ http_not_called: { path: '/tickets' } }), 'the bot never calls /tickets');
  assert.equal(parseValue('true'), true);
  assert.equal(parseValue('3'), 3);
  assert.equal(parseValue('hello'), 'hello');
  assert.equal(showValue(false), 'false');
});

// ---------------------------------------------------------------- the imitation runner (demo mode)
test('a scripted scenario runs the script: tools, a handoff, a mocked API, state from the answer, and every kind of check', () => {
  const config = nimbus();
  const scenario = {
    id: 'order', channel: 'web-chat', state: { verified: true },
    http_mocks: [{ method: 'GET', path: '/orders/*', json: { found: true, summary: 'Order NB-1003, shipped', ticket: 'TK-5001' } }],
    model_script: [{ tool: 'go_billing' }, { tool: 'find_order', args: { order_id: 'NB-1003' } }, 'It shipped.'],
    turns: [{ say: 'Where is my order NB-1003?' }],
    expect: [{ tool_called_with: { tool: 'find_order', args: { order_id: 'NB-1003' } } }, { agent_is: 'billing' }, { http_called: { method: 'GET', path: '/orders/*', times: 1 } }, { http_not_called: { path: '/tickets' } }, { state_equals: { state: 'ticket_id', value: 'TK-5001' } }, { state_equals: { state: 'verified', value: true } }, { said_matches: 'shipped' }, { judge: 'polite' }, { tool_not_called: 'end_call' }],
  };
  const result = runScenarioDemo(config, scenario);
  assert.equal(result.mode, 'scripted');
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.checks.map((c) => c.passed), [true, true, true, true, true, true, true, null, true]);
  assert.match(result.checks[7].detail, /model script/, 'a judge is never graded in a scripted scenario');
  assert.equal(result.final_agent, 'billing');
  assert.equal(result.http[0].path, '/orders/NB-1003');
  assert.equal(result.http[0].mocked, true);
  assert.deepEqual(result.unmocked, []);
  assert.ok(result.events.some((e) => e.event === 'http_request') && result.events.some((e) => e.event === 'tool_called'), 'the same records a call log holds');
  assert.match(result.notes.join(' '), /imitation/);
});

test('a request no mock answers is listed as unmocked (the most common reason a scenario fails), and a failed check says why', () => {
  const config = nimbus();
  const scenario = { id: 'ticket', channel: 'web-chat', model_script: [{ tool: 'go_billing' }, { tool: 'open_ticket', args: { order_id: 'NB-1' } }, 'Done.'], turns: [{ say: 'Open a ticket' }],
    expect: [{ http_not_called: { method: 'POST', path: '/tickets' } }, { tool_called: 'end_call' }] };
  const result = runScenarioDemo(config, scenario);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.unmocked.map((u) => `${u.method} ${u.path}`), ['POST /tickets']);
  assert.equal(result.http[0].status, 404);
  assert.match(result.checks[0].detail, /POST \/tickets/);
  assert.match(result.checks[1].detail, /not called; the model called: go_billing, open_ticket/);
  assert.equal(result.tools[1].error, 'HTTP 404');
  // a mock that answers `times` once is used up
  const once = { ...scenario, http_mocks: [{ method: 'POST', path: '/tickets', times: 1, json: { ok: true } }], model_script: [{ tool: 'open_ticket', args: {} }, { tool: 'open_ticket', args: {} }, 'Done.'] };
  assert.equal(runScenarioDemo(config, once).unmocked.length, 1);
});

test('a live scenario is skipped unless live scenarios are included, and then it is played by the imitation and says so', () => {
  const config = support();
  const scenario = { id: 'live_one', channel: 'web-chat', turns: [{ say: 'bye' }], expect: [{ tool_called: 'end_call' }, { judge: 'was polite' }] };
  const skipped = runScenarioDemo(config, scenario);
  assert.equal(skipped.mode, 'live');
  assert.equal(skipped.status, 'skipped');
  assert.match(skipped.reason, /live one/);
  const ran = runScenarioDemo(config, scenario, { live: true });
  assert.equal(ran.status, 'passed');
  assert.equal(ran.checks[1].passed, null);
  assert.match(ran.checks[1].detail, /Grading is off/);
  assert.match(runScenarioDemo(config, scenario, { live: true, judge: true }).checks[1].detail, /no model to grade/);
  assert.match(ran.notes.join(' '), /no real model was called/);
});

test('a run fingerprints the config it tested, so a version can be compared with it', () => {
  const a = nimbus();
  assert.equal(checksumOf(a), checksumOf(JSON.parse(JSON.stringify(a))));
  assert.equal(checksumOf({ a: 1, b: 2 }), checksumOf({ b: 2, a: 1 }), 'key order does not matter');
  assert.notEqual(checksumOf({ a: 1 }), checksumOf({ a: 2 }));
});

// ---------------------------------------------------------------- the demo API's test endpoints
async function demoWithTests({ stepMs = 0, clock } = {}) {
  const config = nimbus();
  config.tests = [
    { id: 'passes', channel: 'web-chat', model_script: ['Hello there.'], turns: [{ say: 'hi' }], expect: [{ said_matches: 'hello' }] },
    { id: 'fails', channel: 'web-chat', model_script: ['Hello there.'], turns: [{ say: 'hi' }], expect: [{ said_matches: 'refund' }] },
    { id: 'live_one', channel: 'web-chat', turns: [{ say: 'hi' }], expect: [{ said_matches: '.' }] },
  ];
  const api = createDemoApi({ storage: memoryStorage(), seed: false, stepMs, ...(clock ? { now: clock } : {}) });
  await api.handle('POST', '/bots', { id: 'nimbus', name: 'Nimbus' });
  const draft = (await api.handle('GET', '/bots/nimbus/draft')).body;
  await api.handle('PUT', '/bots/nimbus/draft', { config: { ...config, meta: draft.config.meta }, base_revision: draft.revision });
  return api;
}

test('GET /tests lists the scenarios, POST /tests/run answers 202, and the run can be read to the end', async () => {
  const api = await demoWithTests();
  const before = (await api.handle('GET', '/bots/nimbus/tests')).body;
  assert.deepEqual(before.scenarios.map((s) => s.id), ['passes', 'fails', 'live_one']);
  assert.equal(before.scenarios.every((s) => !s.last), true, 'nothing has been run');
  const started = await api.handle('POST', '/bots/nimbus/tests/run', {});
  assert.equal(started.status, 202);
  const run = (await api.handle('GET', `/bots/nimbus/tests/runs/${started.body.id}`)).body;
  assert.equal(run.status, 'failed');
  assert.deepEqual(run.scenarios.map((s) => `${s.id}:${s.status}`), ['passes:passed', 'fails:failed', 'live_one:skipped']);
  assert.equal(run.ref, 'draft');
  const after = (await api.handle('GET', '/bots/nimbus/tests')).body;
  assert.equal(after.scenarios[1].last.status, 'failed');
  assert.equal(after.scenarios[1].last.run_id, run.id);
  const headlines = (await api.handle('GET', '/bots/nimbus/tests/runs')).body;
  assert.deepEqual(headlines[0].counts, { total: 3, passed: 1, failed: 1, error: 0, skipped: 1 });
  assert.equal(headlines[0].scenarios, undefined, 'headlines have no scenarios');
});

test('only the scenarios asked for run, live ones with live: true, and what is in the editor without saving it', async () => {
  const api = await demoWithTests();
  const one = (await api.handle('POST', '/bots/nimbus/tests/run', { scenarios: ['passes'] })).body;
  assert.deepEqual(one.scenarios.map((s) => s.id), ['passes']);
  const live = (await api.handle('POST', '/bots/nimbus/tests/run', { live: true })).body;
  assert.equal(live.scenarios.find((s) => s.id === 'live_one').status, 'passed');
  const edited = (await api.handle('GET', '/bots/nimbus/draft')).body.config;
  edited.tests = [edited.tests[0]];
  const unsaved = (await api.handle('POST', '/bots/nimbus/tests/run', { config: edited })).body;
  assert.equal(unsaved.ref, 'unsaved');
  assert.equal(unsaved.scenarios.length, 1);
  assert.equal((await api.handle('GET', '/bots/nimbus/draft')).body.config.tests.length, 3, 'the draft is untouched');
  assert.equal((await api.handle('POST', '/bots/nimbus/tests/run', { scenarios: ['ghost'] })).status, 400);
  assert.equal((await api.handle('POST', '/bots/nimbus/tests/run', { ref: '9.9.9' })).status, 404);
  const empty = await api.handle('POST', '/bots/nimbus/tests/run', { config: { ...edited, tests: [] } });
  assert.equal(empty.status, 400);
});

test('results appear one by one, only one run at a time, and a published version’s checksum matches the run that tested it', async () => {
  let t = Date.parse('2026-10-14T10:00:00Z');
  const api = await demoWithTests({ stepMs: 1000, clock: () => new Date(t).toISOString() });
  const started = (await api.handle('POST', '/bots/nimbus/tests/run', {})).body;
  assert.equal(started.status, 'running');
  assert.equal(started.scenarios.length, 0);
  assert.equal((await api.handle('POST', '/bots/nimbus/tests/run', {})).status, 409, 'one run per agent at a time');
  t += 1500;
  const part = (await api.handle('GET', `/bots/nimbus/tests/runs/${started.id}`)).body;
  assert.equal(part.status, 'running');
  assert.deepEqual(part.scenarios.map((s) => s.id), ['passes']);
  t += 5000;
  const done = (await api.handle('GET', `/bots/nimbus/tests/runs/${started.id}`)).body;
  assert.equal(done.status, 'failed');
  assert.equal(done.scenarios.length, 3);
  // publish, then test that exact version: the run's checksum is the version's
  const published = (await api.handle('POST', '/bots/nimbus/publish', {})).body;
  const again = (await api.handle('POST', '/bots/nimbus/tests/run', { ref: published.version })).body;
  assert.equal(again.config_checksum, published.checksum, 'testing a version tests that exact version');
  const draftRun = (await api.handle('POST', '/bots/nimbus/tests/run', { ref: 'draft' }).catch?.(() => null)) || null;
  void draftRun;
});

// ---------------------------------------------------------------- reading what the API answers
test('a run, a result and a check are read tolerantly: a missing field is left out, never an error', () => {
  assert.deepEqual(normalizeCheck({ kind: 'tool_called', expect: { tool_called: 'x' }, passed: false, detail: 'not called' }), { kind: 'tool_called', expect: { tool_called: 'x' }, passed: false, detail: 'not called' });
  assert.equal(normalizeCheck({ passed: undefined }).passed, null, 'passed: null/missing means “could not be checked here”');
  const empty = normalizeResult({});
  assert.equal(empty.status, 'skipped');
  assert.deepEqual([empty.checks, empty.unmocked, empty.events], [[], [], []]);
  const run = normalizeRun({ id: 'r1', status: 'running', config_checksum: 'abc', scenarios: [{ id: 'a', status: 'passed', checks: [{ passed: true }] }] });
  assert.equal(run.status, 'running');
  assert.equal(run.checksum, 'abc');
  assert.equal(run.passed, 1);
  assert.equal(normalizeRun(null).status, 'running');
  assert.equal(normalizeRun({ scenarios: [{ id: 'a', checks: [{ passed: false }] }] }).status, 'failed', 'a status is worked out when the API sends none');
  assert.deepEqual(normalizeResult({ unmocked: ['GET /orders/1', { method: 'post', path: '/x' }] }).unmocked, [{ method: 'GET', path: '/orders/1' }, { method: 'POST', path: '/x' }]);
  const head = normalizeHeadline({ id: 'r', status: 'failed', counts: { total: 4, passed: 2, failed: 1, error: 0, skipped: 1 } });
  assert.deepEqual([head.total, head.passed, head.failed, head.skipped], [4, 2, 1, 1]);
});

test('GET /tests is read whichever way the last result is named, and a scripted or live mode is worked out', () => {
  const list = normalizeScenarioList({ ref: 'draft', network_allowed: false, scenarios: [
    { id: 'a', model_script: ['hi'], last: { status: 'passed', checks: [], run_id: 'r1', ran_at: '2026-10-14T10:00:00Z' } },
    { id: 'b', last_result: { status: 'failed', checks: [{ passed: false, kind: 'tool_called', detail: 'no' }] } },
    { id: 'c' },
  ] });
  assert.deepEqual(list.items.map((i) => i.result?.status ?? null), ['passed', 'failed', null]);
  assert.equal(list.items[0].result.mode, 'scripted');
  assert.equal(list.items[1].result.mode, 'live');
  assert.equal(list.items[0].runId, 'r1');
  assert.equal(list.networkAllowed, false);
  assert.deepEqual(normalizeScenarioList(null).items, []);
});

test('a result says in one line what happened, and what to do next', () => {
  const failed = normalizeResult({ status: 'failed', checks: [{ passed: false, kind: 'http_not_called', detail: 'made it' }, { passed: null, kind: 'judge', detail: 'skipped' }], unmocked: ['GET /orders/9'] });
  assert.match(resultSummary(failed), /1 check failed, and 1 request was not answered by any mock/);
  const steps = nextSteps(failed, { id: 'x', model_script: ['a'] });
  assert.deepEqual(steps.map((s) => s.kind), ['mock', 'http', 'live']);
  assert.match(steps[0].text, /GET \/orders\/9 and nothing answered it/);
  assert.match(resultSummary(normalizeResult({ status: 'skipped', reason: 'live' })), /live/);
  assert.match(resultSummary(normalizeResult({ status: 'error', detail: 'it broke' })), /it broke/);
  assert.match(resultSummary(normalizeResult({ status: 'passed', checks: [{ passed: true }, { passed: null }] })), /Passed\. 1 check was not checked here/);
  assert.equal(resultSummary(normalizeResult({ status: 'passed', checks: [{ passed: true }] })), 'Passed.');
  const live = nextSteps(normalizeResult({ status: 'skipped' }), { id: 'x' });
  assert.equal(live[0].kind, 'live');
});

test('“this exact version passed”: a run counts for a version only when its checksum is the version’s', () => {
  const runs = [
    { id: 'r3', status: 'failed', checksum: 'bbb' },
    { id: 'r2', status: 'passed', checksum: 'aaa' },
    { id: 'r1', status: 'running', checksum: 'ccc' },
  ];
  assert.equal(testStatusOf({ version: '0.1.0', checksum: 'aaa' }, runs).state, 'passed');
  assert.equal(testStatusOf({ version: '0.2.0', checksum: 'bbb' }, runs).state, 'failed');
  assert.equal(testStatusOf({ version: '0.3.0', checksum: 'ccc' }, runs).state, 'none', 'a run still going proves nothing');
  assert.equal(testStatusOf({ version: '0.4.0', checksum: 'zzz' }, runs).state, 'none');
  assert.equal(testStatusOf({ version: '0.5.0' }, runs).state, 'none');
  assert.equal(testStatusOf({ version: '0.1.0', checksum: 'aaa' }, []).text, 'Not run');
});

test('an unanswered request becomes a starting mock in the scenario, never twice', () => {
  const mock = stubMock({ method: 'get', path: '/orders/NB-1', connection: 'api', query: { a: '1' } });
  assert.deepEqual(mock, { path: '/orders/NB-1', status: 200, json: {}, method: 'GET', connection: 'api', query: { a: '1' } });
  const scenario = { id: 's', http_mocks: [] };
  const once = addMockTo(scenario, { method: 'GET', path: '/x' });
  assert.equal(once.http_mocks.length, 1);
  assert.equal(addMockTo(once, { method: 'GET', path: '/x' }), once, 'the same mock is not added again');
  assert.equal(scenario.http_mocks.length, 0, 'the original is not changed');
});

test('a finished test conversation becomes a starting scenario made only of what it showed', () => {
  const config = nimbus();
  const made = scenarioFromConversation(config, { channel: 'web-chat', messages: [{ role: 'assistant', text: 'Hi' }, { role: 'user', text: 'Where is NB-1003?' }, { role: 'assistant', text: 'Shipped' }, { role: 'user', text: ' Thanks ' }], tools: ['find_order', 'find_order', 'end_call'], finalState: { verified: true, ticket_id: null, ghost: 1 } });
  assert.deepEqual(made.turns, [{ say: 'Where is NB-1003?' }, { say: 'Thanks' }]);
  assert.deepEqual(made.expect, [{ tool_called: 'find_order' }, { tool_called: 'end_call' }, { state_equals: { state: 'verified', value: true } }]);
  assert.deepEqual(scenarioProblems(made, config), {}, 'it starts valid');
  assert.equal(made.channel, 'web-chat');
  const bare = scenarioFromConversation(config, { messages: [] });
  assert.deepEqual(scenarioProblems(bare, config), {});
});

test('pasted scenarios are checked, clashing ids renamed, and bad ones reported', () => {
  const config = { ...support(), tests: [{ id: 'one', channel: 'web-chat', turns: [{ say: 'x' }], expect: [{ said_matches: '.' }] }] };
  const text = JSON.stringify([{ id: 'one', channel: 'web-chat', turns: [{ say: 'a' }], expect: [{ said_matches: 'a' }] }, { id: 'broken', channel: 'nope', turns: [], expect: [] }, 'x']);
  const { scenarios, problems } = parseImport(text, config);
  assert.deepEqual(scenarios.map((s) => s.id), ['one_2']);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /broken: .*no channel “nope”/);
  assert.match(parseImport('not json', config).problems[0], /isn’t valid JSON/);
  assert.equal(parseImport(JSON.stringify({ tests: [newScenario(support(), 'fresh')] }), support()).scenarios.length, 1);
  assert.match(parseImport('42', config).problems[0], /Paste a list/);
  // a pasted scenario with the newer fields comes through whole
  const rich = { id: 'rich', channel: 'web-chat', now: '2026-10-14T03:00Z', http_mocks: [{ path: '/x' }], turns: [{ say: 'a' }], expect: [{ http_called: { path: '/x' } }] };
  assert.deepEqual(parseImport(JSON.stringify([rich]), support()).scenarios[0], rich);
});

// ---- what a live run cost: only what the server reports -----------------------------------------------------------------------------------------
import { runTokens, tokenWords, tokensOf } from '../src/studio/scenarios/runResults.js';

test('model use is read from a result’s usage or its call_ended record, summed per run, and is null when nothing is reported', () => {
  assert.equal(tokensOf({ usage: [], events: [] }), null, 'a scripted run reports none');
  assert.equal(tokensOf(undefined), null);
  assert.deepEqual(tokensOf({ usage: [{ input_tokens: 100, output_tokens: 20 }, { input_tokens: 50, output_tokens: 5 }] }), { input: 150, output: 25 });
  assert.deepEqual(tokensOf({ events: [{ event: 'user_said' }, { event: 'call_ended', usage: [{ type: 'llm_usage', input_tokens: 1200, output_tokens: 300 }] }] }), { input: 1200, output: 300 });
  assert.equal(tokensOf({ usage: [{ model: 'x' }] }), null, 'an entry with no token counts says nothing');
  assert.deepEqual(runTokens({ scenarios: [{ usage: [{ input_tokens: 10, output_tokens: 2 }] }, { usage: [] }, { usage: [{ input_tokens: 5, output_tokens: 1 }] }] }), { input: 15, output: 3 });
  assert.equal(runTokens({ scenarios: [{ usage: [] }] }), null);
  assert.equal(tokenWords({ input: 1234, output: 56 }), '1,234 tokens in and 56 out');
});
