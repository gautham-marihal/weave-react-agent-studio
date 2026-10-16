import test from 'node:test';
import assert from 'node:assert/strict';
import { CALLERS, autoChecks, contextOf, suggestions, topicOf } from '../src/studio/callers/personas.js';
import { scenarioProblems } from '../src/studio/scenarios/model.js';

// Scripted callers and the tests made from what an agent has: they are scenarios in the same shape a person writes, so they run on the same runner.
const config = () => ({
  meta: { id: 'a', name: 'Acme' },
  persona: { name: 'Ava' },
  channels: [{ id: 'phone', type: 'sip_voice', greeting: { say: 'Hi, this is Acme. How can I help?' } }],
  defaults: { language: { primary: 'en-US', speaks: ['en', 'fr'] } },
  tools: [
    { id: 'lookup_order', description: 'Looks up the status of an order.', type: 'http' },
    { id: 'create_ticket', description: 'Creates a support ticket for the caller.', type: 'http' },
    { id: 'end_call', builtin: 'end_call' },
    { id: 'transfer', builtin: 'transfer_or_callback' },
  ],
  agents: { entry: 'main', items: [{ id: 'main', name: 'Main', tools: ['lookup_order', 'end_call', 'transfer'] }] },
});

test('what a caller asks for is worded from a tool’s own description', () => {
  assert.deepEqual(topicOf({ description: 'Looks up the status of an order.' }), { phrase: 'look up the status of an order', verb: true });
  assert.deepEqual(topicOf({ description: 'Creates a support ticket for the caller.' }), { phrase: 'create a support ticket for the caller', verb: true });
  assert.deepEqual(topicOf({ description: 'Checks the weather' }), { phrase: 'check the weather', verb: true });
  assert.deepEqual(topicOf({ description: 'Order lookup' }), { phrase: 'order lookup', verb: false });
  assert.deepEqual(topicOf({ id: 'refund_status' }), { phrase: 'refund status', verb: false });
});

test('the agent’s tools, channel, person and languages are read once for the callers to use', () => {
  const c = contextOf(config());
  assert.equal(c.channel, 'phone');
  assert.equal(c.main.id, 'lookup_order');
  assert.equal(c.transfer, 'transfer');
  assert.equal(c.endCall, 'end_call');
  assert.deepEqual(c.others, ['fr']);
  assert.equal(c.name, 'Ava');
});

test('every caller and check is a scenario the runner accepts, on the agent’s channel, with something to check', () => {
  const all = suggestions(config());
  assert.equal(all.filter((s) => s.group === 'caller').length, CALLERS.length);
  assert.ok(all.filter((s) => s.group === 'check').length >= 4);
  const ids = all.map((s) => s.scenario.id);
  assert.equal(new Set(ids).size, ids.length, 'each has an id of its own');
  all.forEach((s) => {
    assert.equal(s.scenario.channel, 'phone');
    assert.ok(s.scenario.turns.length >= 1 && s.scenario.turns.every((t) => t.say.trim()), s.key);
    assert.ok(s.scenario.expect.length >= 1, s.key);
    assert.deepEqual(scenarioProblems(s.scenario, config()), {}, `${s.key} is a valid scenario`);
  });
});

test('callers are written from this agent’s tools, and use the person and the hang-up when it has them', () => {
  const all = Object.fromEntries(suggestions(config()).map((s) => [s.key, s]));
  assert.match(all.caller_direct.scenario.turns[0].say, /look up the status of an order/);
  assert.deepEqual(
    all.caller_direct.scenario.expect.find((e) => e.tool_called),
    { tool_called: 'lookup_order' },
  );
  assert.deepEqual(
    all.caller_wants_person.scenario.expect.find((e) => e.tool_called),
    { tool_called: 'transfer' },
  );
  assert.match(all.caller_other_language.scenario.turns[0].say, /Bonjour/, 'a language the agent speaks is used');
  assert.ok(all.check_tool_create_ticket && all.check_tool_lookup_order && all.check_person && all.check_hangs_up && all.check_greets);
  assert.deepEqual(
    all.check_hangs_up.scenario.expect.find((e) => e.tool_called),
    { tool_called: 'end_call' },
  );
});

test('a caller says which of its checks needs a reviewer (the live model), and which are plain', () => {
  const all = suggestions(config());
  assert.ok(all.filter((s) => s.group === 'caller').every((s) => s.needsJudge && s.scenario.expect.some((e) => e.judge)));
  assert.ok(all.filter((s) => s.group === 'check').every((s) => !s.needsJudge && !s.scenario.expect.some((e) => e.judge)));
});

test('an agent with no tools still gets callers, and no checks for tools it does not have', () => {
  const bare = { meta: { id: 'b', name: 'B' }, channels: [{ id: 'chat', type: 'web_chat' }], tools: [] };
  const all = suggestions(bare);
  assert.equal(all.filter((s) => s.group === 'caller').length, CALLERS.length);
  assert.deepEqual(
    all.filter((s) => s.group === 'check').map((s) => s.key),
    ['check_greets'],
  );
  assert.ok(all.every((s) => s.scenario.expect.every((e) => !('tool_called' in e))));
});

test('one that was already kept is recognised, and a new one never takes the id of an existing test', () => {
  const kept = {
    ...config(),
    tests: [
      { id: 'caller_frustrated', description: 'Simulated caller: Frustrated', channel: 'phone', turns: [{ say: 'x' }], expect: [{ said_matches: '.' }] },
      { id: 'caller_direct', description: 'my own', channel: 'phone', turns: [{ say: 'x' }], expect: [{ said_matches: '.' }] },
    ],
  };
  const all = Object.fromEntries(suggestions(kept).map((s) => [s.key, s]));
  assert.equal(all.caller_frustrated.kept, true);
  assert.equal(all.caller_frustrated.scenario.id, 'caller_frustrated');
  assert.equal(all.caller_direct.kept, false, 'a test of the same name that is not ours is not ours');
  assert.notEqual(all.caller_direct.scenario.id, 'caller_direct');
  assert.equal(autoChecks(config()).length, suggestions(config()).filter((s) => s.group === 'check').length);
});

test('the greeting check matches the first words of the greeting whatever punctuation is between them', () => {
  const greets = suggestions(config()).find((s) => s.key === 'check_greets');
  const pattern = greets.scenario.expect.find((e) => e.said_matches && e.said_matches !== '.+')?.said_matches;
  assert.ok(pattern, 'a pattern for the greeting');
  const re = new RegExp(pattern, 'i');
  assert.ok(re.test('Hi, this is Acme. How can I help?'));
  assert.ok(re.test('hi this is acme'), 'case and punctuation do not matter');
  assert.ok(!re.test('Good morning, Acme speaking'));
  const noGreeting = { ...config(), channels: [{ id: 'phone', type: 'sip_voice' }] };
  assert.deepEqual(suggestions(noGreeting).find((s) => s.key === 'check_greets').scenario.expect, [{ said_matches: '.+' }]);
});
