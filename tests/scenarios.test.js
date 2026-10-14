import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../src/studio/form/engine.js';
import { applyStarter } from '../src/studio/starters.js';
import { minimalConfig } from '../src/demo/demoApi.js';
import { EXPECT_KINDS, describeExpectation, freshScenarioId, newScenario, parseImport, parseValue, regexProblem, scenarioProblems, showValue } from '../src/studio/scenarios/model.js';
import { RUNNERS, runAll, runScenario } from '../src/studio/scenarios/runner.js';
import { MAX_RUNS, clearRuns, latestStatuses, loadRuns, saveRun } from '../src/studio/scenarios/history.js';

const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const support = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const memoryStore = () => { const data = new Map(); return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) }; };

test('the kinds of expectation are exactly the ones the schema allows', () => {
  const engine = createEngine(schema);
  const items = engine.flatten(engine.flatten(engine.flatten(schema.properties.tests).items).properties.expect).items;
  const keys = engine.branchesOf(engine.flatten(items)).map((b) => Object.keys(engine.flatten(b).properties)[0]).sort();
  assert.deepEqual(EXPECT_KINDS.map((k) => k.key).sort(), keys);
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
  const bad = { id: 'Bad Id', channel: 'ghost', turns: [{ say: '' }], expect: [{ tool_called: 'nope' }, { said_matches: '(' }, { state_equals: { state: 'nope', value: 1 } }, { judge: ' ' }, {}] };
  const p = scenarioProblems(bad, config);
  assert.match(p.id, /lowercase/);
  assert.match(p.channel, /no channel “ghost”/);
  assert.match(p.turns, /Every turn needs some words/);
  assert.equal(p.expect.length, 5);
  assert.match(p.expect[0], /no tool “nope”/);
  assert.match(p.expect[1], /not a valid pattern/);
  assert.match(p.expect[2], /no state variable/);
  assert.match(scenarioProblems({ ...newScenario(config), turns: [] }, config).turns, /at least one/);
  assert.match(scenarioProblems({ ...newScenario(config), expect: [] }, config).expect[0], /at least one/);
  assert.match(scenarioProblems({ id: 'a', channel: 'web-chat', turns: [{ say: 'x' }], expect: [{ said_matches: '.' }] }, config, [{ id: 'a' }, { id: 'a' }]).id, /Another scenario/);
  assert.equal(regexProblem('^ok$'), '');
  assert.notEqual(regexProblem('['), '');
});

test('expectations read as sentences', () => {
  assert.equal(describeExpectation({ tool_called: 'end_call' }), 'the tool “end_call” is called');
  assert.equal(describeExpectation({ state_equals: { state: 'outcome', value: 'paid' } }), 'outcome ends up as "paid"');
  assert.equal(describeExpectation({ said_matches: 'bill' }), 'the agent says something matching /bill/');
  assert.equal(describeExpectation({ judge: 'it was polite' }), 'a reviewer agrees that it was polite');
  assert.equal(parseValue('true'), true);
  assert.equal(parseValue('3'), 3);
  assert.equal(parseValue('hello'), 'hello');
  assert.equal(showValue(false), 'false');
});

test('a simulated run plays the turns, checks each expectation, and says what failed and why', () => {
  const config = support();
  const scenario = { id: 'asks_for_person', channel: 'web-chat', turns: [{ say: 'Hi' }, { say: 'Can I speak to a human?' }, { say: 'ok, bye' }],
    expect: [{ tool_called: 'escalate_to_human' }, { tool_called: 'end_call' }, { tool_not_called: 'lookup' }, { said_matches: 'Thanks for getting in touch' }, { said_matches: 'refund' }, { judge: 'The agent was kind' }] };
  const run = runScenario(config, scenario);
  assert.equal(run.runner, 'simulated');
  assert.deepEqual(run.results.map((r) => r.status), ['passed', 'passed', 'passed', 'passed', 'failed', 'unchecked']);
  assert.match(run.results[4].detail, /No agent message matches \/refund\//);
  assert.match(run.results[5].detail, /language model/);
  assert.equal(run.status, 'failed');
  assert.deepEqual(run.transcript.filter((m) => m.role === 'user').map((m) => m.text), ['Hi', 'Can I speak to a human?', 'ok, bye']);
  assert.ok(run.transcript[0].role === 'assistant', 'the greeting comes first');
  const ok = runScenario(config, { ...scenario, expect: scenario.expect.slice(0, 4) });
  assert.equal(ok.status, 'passed');
  assert.equal(runScenario(config, { ...scenario, expect: [{ judge: 'x' }] }).status, 'unchecked');
  assert.equal(runScenario(config, { ...scenario, expect: [{ said_matches: '(' }] }).status, 'error');
});

test('state expectations read what the simulated tools set', () => {
  const config = minimalConfig('a', 'A');
  config.state = { variables: { outcome: { type: 'string', nullable: true, default: null } } };
  config.tools = [{ id: 'get_bill', type: 'http', description: 'Looks up the bill balance', connection: 'c', request: { method: 'GET', path: '/b' }, parameters: { type: 'object', properties: {} }, effects: [{ do: [{ type: 'set_state', values: { outcome: 'billed' } }] }] }];
  config.agents.items[0].tools = ['get_bill'];
  const s = { id: 's', channel: 'web-chat', turns: [{ say: 'what is my bill' }], expect: [{ state_equals: { state: 'outcome', value: 'billed' } }, { state_equals: { state: 'outcome', value: 'other' } }] };
  assert.deepEqual(runScenario(config, s).results.map((r) => r.status), ['passed', 'failed']);
});

test('a real run is not available, and asking for one says why instead of pretending', () => {
  assert.equal(RUNNERS.live.available, false);
  assert.match(RUNNERS.live.reason, /no endpoint/);
  assert.throws(() => runScenario(support(), newScenario(support()), 'live'), /no endpoint/);
  const batch = runAll(support(), [newScenario(support())], 'live');
  assert.equal(batch.errors, 1, 'one that can’t run is an error, not silently dropped');
  assert.equal(batch.scenarios.length, 1);
});

test('a batch counts passed, failed, unchecked and broken, and records when and with what', () => {
  const config = support();
  const good = { id: 'good', channel: 'web-chat', turns: [{ say: 'bye' }], expect: [{ tool_called: 'end_call' }] };
  const bad = { id: 'bad', channel: 'web-chat', turns: [{ say: 'hello' }], expect: [{ tool_called: 'end_call' }] };
  const judged = { id: 'judged', channel: 'web-chat', turns: [{ say: 'hello' }], expect: [{ judge: 'polite' }] };
  const run = runAll(config, [good, bad, judged], 'simulated', () => '2026-10-14T10:00:00Z');
  assert.deepEqual([run.total, run.passed, run.failed, run.unchecked, run.errors], [3, 1, 1, 1, 0]);
  assert.equal(run.runner, 'simulated');
  assert.equal(run.ranAt, '2026-10-14T10:00:00Z');
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
});

test('run history is kept per agent, newest first, trimmed, and the latest status of each scenario is easy to find', () => {
  const store = memoryStore();
  const config = support();
  const make = (expect) => runAll(config, [{ id: 'a', channel: 'web-chat', turns: [{ say: 'hello' }], expect }], 'simulated', () => new Date().toISOString());
  saveRun('x', make([{ tool_called: 'end_call' }]), store);
  saveRun('x', make([{ said_matches: '.' }]), store);
  const runs = loadRuns('x', store);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].passed, 1, 'the newest is first');
  assert.equal(latestStatuses(runs).a.status, 'passed');
  assert.deepEqual(loadRuns('other', store), []);
  for (let i = 0; i < MAX_RUNS + 5; i += 1) saveRun('y', make([{ said_matches: '.' }]), store);
  assert.equal(loadRuns('y', store).length, MAX_RUNS);
  assert.deepEqual(clearRuns('x', store), []);
  assert.deepEqual(loadRuns('x', store), []);
  assert.deepEqual(loadRuns('z', { getItem: () => { throw new Error('no storage'); } }), []);
});
