import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents } from '../src/demo/demoCalls.js';
import { readCall, readTranscript } from '../src/studio/replay/callFacts.js';
import { configWithScenario, factsFromResult, playSimulated, scenarioForReplay } from '../src/studio/replay/replayRun.js';
import { compareReplay, similarity } from '../src/studio/replay/compareReplay.js';
import { addScenario, buildScenario, hasPersonalData, redact, suggestChecks, suggestTest, testProblems } from '../src/studio/replay/callToTest.js';

const config = {
  meta: { id: 'shop', name: 'Shop', version: '0.1.0' },
  channels: [{ id: 'web-chat', type: 'web_chat', greeting: { say: 'Hello, welcome to the shop.' } }],
  agents: { entry: 'assistant', items: [
    { id: 'assistant', name: 'Assistant', instructions: { role: 'You help customers.' }, tools: ['lookup_order', 'end'], handoffs: [{ tool: 'to_billing', to: 'billing', description: 'billing and invoices questions' }] },
    { id: 'billing', name: 'Billing', instructions: { role: 'You handle billing.' }, tools: [] },
  ] },
  tools: [{ id: 'lookup_order', name: 'lookup_order', description: 'Look up an order by its number' }, { id: 'end', builtin: 'end_call' }],
  state: { variables: { order_status: { type: 'string', default: null } } },
};

const call = (messages, extra = {}) => buildEvents({ botId: 'shop', room: 'r1', channel: { id: 'web-chat', type: 'web_chat' }, startedAt: '2026-10-10T10:00:00.000Z', messages, ...extra }).events;

test('a call is read as an opening, turns, tools, hand-overs and an end', () => {
  const events = call([
    { role: 'assistant', text: 'Hello, welcome to the shop.' },
    { role: 'user', text: 'Where is my order' },
    { role: 'assistant', text: 'Let me look.', tools: [{ tool: 'lookup_order', args: { n: '1' }, output: { status: 'shipped' } }] },
    { role: 'user', text: 'I have a billing question' },
    { role: 'assistant', text: 'Passing you to billing.', tools: [{ tool: 'to_billing', handoff: 'billing' }] },
  ], { state: { order_status: 'shipped' } });
  const f = readCall(events);
  assert.deepEqual(f.opening, ['Hello, welcome to the shop.']);
  assert.equal(f.turns.length, 2);
  assert.equal(f.turns[0].say, 'Where is my order');
  assert.equal(f.turns[0].tools[0].tool, 'lookup_order');
  assert.equal(f.turns[1].tools[0].handoff, 'billing');
  assert.equal(f.handoffs, 1);
  assert.equal(f.finalAgent, 'billing');
  assert.equal(f.finalState.order_status, 'shipped');
  assert.equal(f.ended, true);
  assert.equal(f.channelId, 'web-chat');
  assert.ok(f.turns[0].waitMs > 0, 'the wait for an answer is measured');
});

test('a failing tool is noted as a problem of the call', () => {
  const f = readCall(call([{ role: 'user', text: 'order 5' }, { role: 'assistant', text: 'Sorry.', tools: [{ tool: 'lookup_order', error: 'HTTP 500' }] }]));
  assert.equal(f.errors.length, 1); assert.match(f.errors[0], /lookup_order/);
});

test('a transcript with no raw records reads to the same kind of facts', () => {
  const f = readTranscript({ transcript: [{ role: 'assistant', text: 'Hi' }, { role: 'user', text: 'hello' }, { role: 'assistant', text: 'How can I help?' }], tools: [{ tool: 'lookup_order' }], finalAgent: 'assistant' });
  assert.deepEqual(f.opening, ['Hi']); assert.equal(f.turns[0].said[0], 'How can I help?'); assert.equal(f.turns[0].tools[0].tool, 'lookup_order');
});

test('the simulated replay answers the same turns, with the tools and hand-overs the configuration has', () => {
  const original = readCall(call([{ role: 'user', text: 'Where is my order' }, { role: 'assistant', text: 'x' }, { role: 'user', text: 'a billing question' }, { role: 'assistant', text: 'y' }]));
  const replay = playSimulated(config, original);
  assert.equal(replay.turns.length, 2);
  assert.equal(replay.turns[0].tools[0].tool, 'lookup_order');
  assert.equal(replay.turns[1].tools[0].handoff, 'billing');
  assert.equal(replay.finalAgent, 'billing');
  assert.equal(replay.source, 'simulated');
});

test('turns after the agent hangs up are not reached', () => {
  const original = readCall(call([{ role: 'user', text: 'bye' }, { role: 'assistant', text: 'x' }, { role: 'user', text: 'one more thing' }, { role: 'assistant', text: 'y' }]));
  const replay = playSimulated(config, original);
  assert.equal(replay.turns.length, 1); assert.equal(replay.notReached, 1); assert.equal(replay.ended, true);
  const cmp = compareReplay(original, replay);
  assert.ok(cmp.lines.some((l) => /not reached/.test(l)));
});

test('similarity: the same words are 1, nothing in common is 0, partial is between', () => {
  assert.equal(similarity('Hello there', 'hello, there!'), 1);
  assert.equal(similarity('apples', 'oranges'), 0);
  const s = similarity('please wait while I check your order', 'please wait while I look at your order');
  assert.ok(s > 0.5 && s < 1);
  assert.equal(similarity('', ''), 1);
});

test('an unchanged agent compares as the same', () => {
  const original = readCall(call([{ role: 'assistant', text: 'Hello, welcome to the shop.' }, { role: 'user', text: 'Where is my order' }, { role: 'assistant', text: 'ok', tools: [{ tool: 'lookup_order' }] }]));
  const copy = JSON.parse(JSON.stringify(original));
  const cmp = compareReplay(original, copy);
  assert.equal(cmp.verdict, 'same'); assert.deepEqual(cmp.lines, []); assert.equal(cmp.changed, 0);
});

test('a dropped tool, a changed hand-over and a changed end are each said in words', () => {
  const original = readCall(call([{ role: 'user', text: 'Where is my order' }, { role: 'assistant', text: 'Looking.', tools: [{ tool: 'lookup_order' }] }, { role: 'user', text: 'billing' }, { role: 'assistant', text: 'To billing.', tools: [{ tool: 'to_billing', handoff: 'billing' }] }], { state: { order_status: 'shipped' } }));
  const replay = JSON.parse(JSON.stringify(original));
  replay.turns[0].tools = [];
  replay.turns[1].tools = [];
  replay.finalAgent = 'assistant'; replay.finalState = {}; replay.ended = false;
  const cmp = compareReplay(original, replay);
  assert.equal(cmp.verdict, 'different');
  const text = cmp.lines.join(' ');
  assert.match(text, /no longer calls “lookup_order”/);
  assert.match(text, /no longer hands over/);
  assert.match(text, /ends with “assistant” in charge, not “billing”/);
  assert.match(text, /Memory at the end differs/);
  assert.ok(cmp.turns[0].changed && cmp.turns[1].changed);
});

test('a replay scenario is for the runner and never clashes with a saved test', () => {
  const original = readCall(call([{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'hi' }]));
  const withTests = { ...config, tests: [{ id: 'replay', channel: 'web-chat', turns: [{ say: 'x' }], expect: [{ said_matches: '.' }] }] };
  const s = scenarioForReplay(withTests, original);
  assert.notEqual(s.id, 'replay'); assert.equal(s.channel, 'web-chat'); assert.deepEqual(s.turns, [{ say: 'hello' }]);
  assert.equal(configWithScenario(withTests, s).tests.length, 2);
  assert.equal(withTests.tests.length, 1, 'the draft is not changed');
});

test('a runner result is read into facts, from its records when it has them', () => {
  const events = call([{ role: 'assistant', text: 'Hi' }, { role: 'user', text: 'hello' }, { role: 'assistant', text: 'Hey', tools: [{ tool: 'lookup_order' }] }]);
  const f = factsFromResult({ events, final_agent: 'assistant', final_state: {}, transcript: [] });
  assert.equal(f.source, 'runner'); assert.equal(f.turns[0].tools[0].tool, 'lookup_order');
  const g = factsFromResult({ transcript: [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'Hey' }], final_agent: 'billing' });
  assert.equal(g.finalAgent, 'billing'); assert.equal(g.turns[0].said[0], 'Hey');
  assert.equal(factsFromResult(null), null);
});

test('redaction hides numbers and addresses and leaves other words alone', () => {
  assert.equal(redact('call me on +65 9123 4567 or mail jo@example.com'), 'call me on [number] or mail [email]');
  assert.equal(redact('I want 2 apples'), 'I want 2 apples');
  assert.equal(redact('on 2026-10-10 at 10:30'), 'on 2026-10-10 at 10:30', 'a date is not a number to hide');
  assert.equal(hasPersonalData('my order is 12345678'), true);
  assert.equal(hasPersonalData('hello'), false);
});

const facts = () => readCall(call([
  { role: 'assistant', text: 'Hello, welcome to the shop.' },
  { role: 'user', text: 'Where is order 77?' },
  { role: 'assistant', text: 'Your order has shipped and is on its way.', tools: [{ tool: 'lookup_order', args: { n: '77' }, output: {} }] },
  { role: 'user', text: 'I need billing help, call +65 9123 4567' },
  { role: 'assistant', text: 'Passing you to billing now.', tools: [{ tool: 'to_billing', handoff: 'billing' }] },
], { state: { order_status: 'shipped' } }));

test('a test is suggested from what the agent did, with the plain facts ticked', () => {
  const s = suggestTest(facts(), config, { callId: 'r1_2026', startedAt: '2026-10-10T10:00:00.000Z' });
  assert.equal(s.channel, 'web-chat');
  assert.match(s.id, /^[a-z][a-z0-9_-]*$/);
  assert.equal(s.turns.length, 2);
  assert.match(s.turns[1], /\[number\]/, 'a phone number is hidden');
  assert.ok(s.warnings.some((w) => /number or an address/.test(w)));
  const ids = s.checks.map((c) => c.id);
  assert.ok(ids.includes('tool:lookup_order')); assert.ok(ids.includes('agent')); assert.ok(ids.includes('state:order_status'));
  assert.equal(s.checks.find((c) => c.id === 'tool:lookup_order').checked, true);
  assert.equal(s.checks.find((c) => c.id === 'said').checked, false, 'wording is offered but not ticked');
});

test('a tool that failed is offered unticked, with why', () => {
  const f = readCall(call([{ role: 'user', text: 'order 5' }, { role: 'assistant', text: 'Sorry.', tools: [{ tool: 'lookup_order', error: 'HTTP 500' }] }]));
  const c = suggestChecks(f, config).find((x) => x.id === 'failed:lookup_order');
  assert.ok(c); assert.equal(c.checked, false); assert.match(c.why, /HTTP 500/);
});

test('a channel the draft no longer has is replaced, and said', () => {
  const f = { ...facts(), channelId: 'old-channel' };
  const s = suggestTest(f, config, {});
  assert.equal(s.channel, 'web-chat'); assert.ok(s.warnings.some((w) => /old-channel/.test(w)));
});

test('a test is built from the ticked checks, what should have happened, and tools that must not run', () => {
  const s = suggestTest(facts(), config, {});
  const built = buildScenario({ ...s, expectedText: 'The agent offers a refund', toolsNeverCalled: ['end'] });
  assert.deepEqual(built.turns.map((t) => Object.keys(t)), [['say'], ['say']]);
  assert.ok(built.expect.some((e) => e.tool_called === 'lookup_order'));
  assert.ok(built.expect.some((e) => e.judge === 'The agent offers a refund'));
  assert.ok(built.expect.some((e) => e.tool_not_called === 'end'));
  assert.ok(!built.expect.some((e) => 'said_matches' in e), 'an unticked check is left out');
});

test('what is wrong with a test is said, and a good one has no problems', () => {
  const s = suggestTest(facts(), config, {});
  assert.deepEqual(testProblems(s, config), []);
  assert.match(testProblems({ ...s, id: 'Bad Id' }, config)[0], /must start with a letter/);
  assert.ok(testProblems({ ...s, turns: ['  '] }, config).some((p) => /at least one thing/.test(p)));
  assert.ok(testProblems({ ...s, checks: s.checks.map((c) => ({ ...c, checked: false })) }, config).some((p) => /at least one check/.test(p)));
  const withTests = addScenario(config, buildScenario(s));
  assert.ok(testProblems(s, withTests).some((p) => /already has a test/.test(p)));
});

test('adding a test leaves the rest of the draft as it was', () => {
  const s = suggestTest(facts(), config, {});
  const next = addScenario(config, buildScenario(s));
  assert.equal(next.tests.length, 1); assert.equal(next.meta.name, 'Shop'); assert.equal(config.tests, undefined);
});

test('a call with no caller words warns and cannot be kept', () => {
  const f = readCall(call([{ role: 'assistant', text: 'Hello' }]));
  const s = suggestTest(f, config, {});
  assert.ok(s.warnings.some((w) => /nothing to replay/.test(w)));
  assert.ok(testProblems(s, config).some((p) => /at least one thing/.test(p)));
});
