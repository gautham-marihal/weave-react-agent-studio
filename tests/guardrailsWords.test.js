import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStarter } from '../src/studio/starters.ts';
import { minimalConfig } from '../src/demo/demoApi.js';
import { setMoment } from '../src/studio/agent/blocks/guardrailModel.js';
import {
  checksIn,
  doesShort,
  doesWhat,
  gapOf,
  limitsIn,
  looksFor,
  notRunOf,
  ownRules,
  sentenceOf,
  summaryLine,
  together,
  whenWords,
} from '../src/studio/agent/detailed/guardrailsWorkspace/guardrailsWords.js';

// Build › Guardrails in plain words (guardrailsWords.js), for any agent: each check with what really happens to it,
// the moments and rules of its own, the limits, and the gaps a check plainly has.

const agent = () => {
  const config = applyStarter(minimalConfig('acme', 'Acme'), 'support');
  delete config.guardrails;
  return config;
};
const guarded = () => {
  const config = agent();
  config.guardrails = {
    input: [
      { id: 'tricks', type: 'prompt_injection', enforcement: 'both', on_trigger: { action: 'deflect' } },
      { id: 'cards', type: 'pii_detect', entities: ['card_number', 'national_id'], enforcement: 'code', on_trigger: { action: 'redact_in_logs' } },
    ],
    output: [
      { id: 'no_promises', type: 'statement', text: 'Never promise a refund.', enforcement: 'prompt' },
      { id: 'secret_fields', type: 'field_firewall', fields: ['otp', 'token'], enforcement: 'code' },
    ],
    topics: { allowed: ['orders'], blocked: ['legal advice'] },
    limits: { max_call_duration_s: 900, max_silence_s: 45 },
    escalation: [{ id: 'failed_checks', when: { state: 'verify_attempts', gte: 3 }, action: 'end_call' }],
  };
  return config;
};

test('nothing set: no checks, no rules, no limits, and the line under the name says so', () => {
  const config = agent();
  assert.deepEqual(checksIn(config), []);
  assert.deepEqual(ownRules(config), []);
  assert.deepEqual(limitsIn(config), []);
  assert.equal(summaryLine(config), 'Nothing checked yet');
  assert.deepEqual(notRunOf(config), { topics: false, escalation: false, output: [] });
});

test('each check says where it acts, what it does, and what really happens to it', () => {
  const checks = checksIn(guarded());
  assert.deepEqual(
    checks.map((c) => [c.list, c.key, c.how]),
    [
      ['input', 'tricks', 'run'],
      ['input', 'cards', 'run'],
      ['output', 'no_promises', 'told'],
      ['output', 'secret_fields', 'kept'],
    ],
    'before the server has answered, the guide says which are not run',
  );
  assert.equal(checks[0].alsoTold, true, 'checked in code, and the agent is told too');
  assert.equal(checks[1].looks, 'card numbers and national ids');
  assert.equal(checks[1].does, 'Hides it in the log');
  assert.equal(checks[3].does, 'Keeps them out of what it sees and says');
  assert.equal(checks[3].short, 'kept out');
  assert.deepEqual(checks[0].base, ['guardrails', 'input', 0]);
});

test('what is not run comes from the server’s own report once it has answered', () => {
  const config = guarded();
  const report = [{ feature: 'topic limits', where: 'guardrails.topics' }];
  assert.deepEqual(notRunOf(config, report), { topics: true, escalation: false, output: [] });
  assert.equal(checksIn(config, report).find((c) => c.key === 'secret_fields').how, 'run', 'the server says it runs it now');
  assert.deepEqual(notRunOf(config), { topics: true, escalation: true, output: [1] });
});

test('a check in words: what it looks for, what it does, and in two or three words', () => {
  assert.equal(looksFor({ type: 'regex_block', patterns: ['a', 'b'] }), '2 patterns');
  assert.equal(looksFor({ type: 'statement', text: 'Be kind.' }), '“Be kind.”');
  assert.equal(looksFor({ type: 'pii_detect', entities: [] }), 'nothing chosen yet');
  assert.equal(doesWhat({ type: 'regex_block', on_trigger: { action: 'end_call' } }), 'Ends the call');
  assert.equal(doesWhat({ type: 'statement' }), 'Told to the agent');
  assert.equal(doesShort({ type: 'pii_detect', on_trigger: { action: 'rewrite' } }), 'rewritten');
});

test('a check plainly missing something says what, and blocking in silence matters only where it talks', () => {
  const config = agent();
  assert.match(gapOf({ type: 'pii_detect', entities: [] }, config), /looks for nothing/);
  assert.match(gapOf({ type: 'regex_block' }, config), /No patterns/);
  assert.match(gapOf({ type: 'field_firewall', fields: [] }, config), /No fields/);
  assert.match(gapOf({ type: 'statement', text: ' ' }, config), /No words/);
  const blocks = { type: 'regex_block', patterns: ['x'], on_trigger: { action: 'block' } };
  const voice = { ...config, channels: [{ id: 'web', type: 'web_voice' }] };
  const chat = { ...config, channels: [{ id: 'chat', type: 'web_chat' }] };
  assert.match(gapOf(blocks, voice), /silence on a call/);
  assert.equal(gapOf(blocks, chat), '');
  assert.equal(gapOf({ ...blocks, on_trigger: { action: 'block', say: 'No.' } }, voice), '');
});

test('rules of its own leave out the ready-made switches, and say when and then', () => {
  let config = guarded();
  config = setMoment(config, 'abusive_end', true);
  const rules = ownRules(config);
  assert.deepEqual(
    rules.map((r) => r.key),
    ['failed_checks'],
    'the abusive switch is not a rule of its own',
  );
  assert.equal(rules[0].when, 'it remembers verify_attempts is at least 3');
  assert.equal(rules[0].then, 'end the call');
  assert.equal(rules[0].gap, '');
  assert.equal(whenWords({ when: { intent: 'asks_for_human', consecutive_turns: 2 } }), 'what they want is “asks for human” (2 turns in a row)');
  assert.equal(whenWords({ when: {} }), '');
});

test('the sentence’s parts and the line under the name', () => {
  let config = guarded();
  config = setMoment(config, 'frustrated_to_person', true);
  const s = sentenceOf(config);
  assert.equal(s.input.length, 2);
  assert.equal(s.output.length, 2);
  assert.deepEqual(
    s.person.map((m) => m.id),
    ['frustrated_to_person'],
  );
  assert.equal(s.limit.key, 'max_call_duration_s');
  assert.deepEqual(
    limitsIn(config).map((l) => l.words),
    ['15 minutes', '45 seconds'],
  );
  assert.equal(summaryLine(config), '4 checks · 1 topic · 2 rules · 2 limits');
  assert.equal(summaryLine(config, undefined, 2), '4 checks · 1 topic · 2 rules · 2 limits · 2 need a look');
  assert.equal(together(['a', 'b', 'c'], 'or'), 'a, b or c');
});
