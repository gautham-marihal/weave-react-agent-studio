import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenarioDemo } from '../src/demo/demoTests.js';
import {
  describeExpectation,
  describeTurn,
  isKeysTurn,
  kindOfExpectation,
  newExpectation,
  outcomeNamesOf,
  scenarioProblems,
} from '../src/studio/scenarios/model.js';

// FRONTEND_GUIDE 2.md section 10.4: a scenario turn may be keys pressed on the phone, and four more kinds of check (task_outcome, guardrail_triggered,
// guardrail_not_triggered, limit_reached). The form must open, validate and save all of them unchanged.
const config = () => ({
  meta: { id: 'bot', name: 'Bot' },
  channels: [
    { id: 'phone', type: 'sip_voice', enabled: true },
    { id: 'web-chat', type: 'web_chat', enabled: true },
  ],
  agents: { entry: 'main', items: [{ id: 'main', name: 'Main' }] },
  tasks: [{ id: 'verify', on_success: { outcome: 'identity_checked' } }, { id: 'activate' }],
  guardrails: {
    input: [
      { id: 'no_injection', type: 'prompt_injection', enforcement: 'code', on_trigger: { action: 'deflect' } },
      { id: 'no_cards', type: 'pii_detect', entities: ['card_number'], enforcement: 'code', on_trigger: { action: 'redact_in_logs' } },
    ],
  },
});
const scenario = (turns, expect, extra = {}) => ({ id: 's', channel: 'phone', turns, expect, ...extra });

test('a turn of keys is a turn: it is read, described and validated, and never mistaken for words', () => {
  assert.equal(isKeysTurn({ keys: '4821#' }), true);
  assert.equal(isKeysTurn({ say: 'hello' }), false);
  assert.equal(describeTurn({ keys: '4821#' }), 'presses keys on the keypad', 'the digits are not repeated: they may be a PIN');
  assert.equal(describeTurn({ say: 'hello' }), '“hello”');
  assert.deepEqual(scenarioProblems(scenario([{ say: 'My PIN is next' }, { keys: '4821#' }], [{ said_matches: '.' }]), config()), {});
  assert.match(scenarioProblems(scenario([{ keys: '48x' }], [{ said_matches: '.' }]), config()).turns, /keys/, 'only digits, * # and A to D');
  assert.match(scenarioProblems(scenario([{ keys: '' }], [{ said_matches: '.' }]), config()).turns, /keys/, 'an empty turn of keys is not a turn');
});

test('keys can only be pressed on a phone line', () => {
  const onChat = scenario([{ keys: '4821#' }], [{ said_matches: '.' }], { channel: 'web-chat' });
  assert.match(scenarioProblems(onChat, config()).turns, /phone line/);
  assert.deepEqual(scenarioProblems({ ...onChat, channel: 'phone' }, config()), {});
  const noChannel = scenarioProblems({ ...onChat, channel: 'nowhere' }, config());
  assert.ok(noChannel.channel, 'a missing channel is reported once, on the channel');
  assert.equal(noChannel.turns, undefined);
});

test('the four new kinds of check are known, written as sentences, and filled in from this agent', () => {
  const found = ['task_outcome', 'guardrail_triggered', 'guardrail_not_triggered', 'limit_reached'].map((kind) => newExpectation(kind, config()));
  assert.deepEqual(found, [
    { task_outcome: { task: 'verify' } },
    { guardrail_triggered: { rule: 'no_injection' } },
    { guardrail_not_triggered: 'no_injection' },
    { limit_reached: 'max_tool_calls_per_call' },
  ]);
  found.forEach((e) => assert.ok(kindOfExpectation(e), `${JSON.stringify(e)} is a kind the form knows`));
  assert.equal(describeExpectation({ task_outcome: { task: 'verify', outcome: 'verified' } }), 'the task “verify” ends as “verified”');
  assert.equal(describeExpectation({ task_outcome: { task: 'verify' } }), 'the task “verify” ends in any way');
  assert.match(
    describeExpectation({ guardrail_triggered: { rule: 'no_injection', action: 'deflect' } }),
    /“no_injection” catches what the caller says \(declined/,
  );
  assert.equal(describeExpectation({ guardrail_not_triggered: 'no_cards' }), 'the safety rule “no_cards” does not match');
  assert.match(describeExpectation({ limit_reached: 'max_handoffs_per_call' }), /too many hand-overs/);
});

test('the four new kinds are valid when they name something real, and say what is wrong when they do not', () => {
  const ok = [
    { task_outcome: { task: 'verify', outcome: 'identity_checked' } },
    { guardrail_triggered: { rule: 'no_cards', action: 'redact_in_logs' } },
    { guardrail_not_triggered: 'no_injection' },
    { limit_reached: 'max_silence_s' },
  ];
  assert.deepEqual(scenarioProblems(scenario([{ say: 'hi' }], ok), config()), {});
  const bad = scenarioProblems(
    scenario(
      [{ say: 'hi' }],
      [
        { task_outcome: { task: 'nope' } },
        { guardrail_triggered: { rule: 'nope' } },
        { guardrail_triggered: { rule: 'no_cards', action: 'explode' } },
        { guardrail_not_triggered: 'nope' },
        { limit_reached: 'max_nothing' },
      ],
    ),
    config(),
  );
  assert.equal(bad.expect.length, 5);
  assert.match(bad.expect[0], /there is no task “nope”/);
  assert.match(bad.expect[1], /there is no check on what the caller says called “nope”/);
  assert.match(bad.expect[2], /not something a safety rule does/);
  assert.match(bad.expect[3], /called “nope”/);
  assert.match(bad.expect[4], /choose which limit/);
});

test('a task offers verified, failed, declined and the names its own endings give', () => {
  assert.deepEqual(outcomeNamesOf(config(), 'verify'), ['verified', 'failed', 'declined', 'identity_checked']);
  assert.deepEqual(outcomeNamesOf(config(), 'activate'), ['verified', 'failed', 'declined']);
  assert.deepEqual(outcomeNamesOf(config(), 'missing'), ['verified', 'failed', 'declined']);
});

test('the demo runner takes keys without writing them down, and says honestly what it cannot check', () => {
  const run = runScenarioDemo(
    config(),
    scenario(
      [{ say: 'Activate my card' }, { keys: '4821#' }],
      [{ said_matches: 'ok' }, { task_outcome: { task: 'verify' } }, { guardrail_triggered: { rule: 'no_cards' } }, { limit_reached: 'max_silence_s' }],
      { model_script: ['What is your PIN?', 'ok, done'] },
    ),
  );
  assert.equal(JSON.stringify(run).includes('4821'), false, 'the digits are nowhere in the result');
  assert.deepEqual(
    run.transcript.map((m) => m.role),
    ['assistant', 'user', 'assistant', 'assistant'],
    'a turn of keys adds no line from the caller',
  );
  assert.equal(run.status, 'passed', 'checks the demo cannot make are not failures');
  const unchecked = run.checks.filter((c) => c.passed === null);
  assert.equal(unchecked.length, 3);
  unchecked.forEach((c) => assert.match(c.detail, /cannot be checked here/));
});

test('a check with an odd value is still written as a sentence, never an error', () => {
  assert.doesNotThrow(() => describeExpectation({ limit_reached: null }));
  assert.doesNotThrow(() => describeExpectation({ limit_reached: 42 }));
  assert.doesNotThrow(() => describeExpectation({ guardrail_triggered: { rule: 'x', action: 7 } }));
  assert.doesNotThrow(() => describeExpectation({ task_outcome: null }));
});
