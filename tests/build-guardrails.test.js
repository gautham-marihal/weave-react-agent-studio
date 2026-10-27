import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { minimalConfig } from '../src/demo/minimalConfig.js';
import { applyStarter } from '../src/studio/starters.ts';
import { createEngine } from '../src/studio/form/engine.js';
import { pickerFor, takenIdsAt } from '../src/studio/form/pickerOptions.js';
import { describeSetting } from '../src/studio/form/plainLanguage.js';
import {
  limitsOf,
  momentOf,
  momentsOf,
  setLimit,
  setLimitSay,
  setMoment,
  setMomentWords,
  setOffTopic,
  setTopics,
  topicsOf,
} from '../src/studio/agent/blocks/guardrailModel.js';
import { rowName } from '../src/studio/agent/rowNames.js';

// An agent's Guardrails page: what its plain-words blocks keep while someone types, what they leave alone that was changed elsewhere, and
// the ids a new check is given (one set across the three guardrail lists, as the server checks them).
const care = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const engine = createEngine(schema);
const branchesOf = (part) => engine.branchesOf(engine.flatten(engine.flatten(engine.flatten(schema.properties.guardrails).properties[part].items)));

// a box bound to the draft, typed into key by key: each key hands on what the box shows plus that key, as the page does
const typed = (config, text, read, write) => [...text].reduce((c, key) => write(c, read(c) + key), config);

test('guardrails: a space typed in what it says is kept, so a sentence can be typed key by key', () => {
  const end = care().tools.find((t) => t.builtin === 'end_call').id;
  let c = setOffTopic(care(), { strikes: 3, then: end });
  c = typed(
    c,
    'I can only help with orders.',
    (cc) => topicsOf(cc).offTopic.say,
    (cc, text) => setOffTopic(cc, { ...topicsOf(cc).offTopic, say: text, sayRef: '' }),
  );
  assert.equal(topicsOf(c).offTopic.say, 'I can only help with orders.');
  c = setLimit(c, 'max_call_duration_s', '5');
  c = typed(
    c,
    'Sorry, time is up.',
    (cc) => limitsOf(cc).say,
    (cc, text) => setLimitSay(cc, text),
  );
  assert.equal(limitsOf(c).say, 'Sorry, time is up.');
  assert.equal(setLimitSay(c, '   ').guardrails.limits.say, undefined, 'nothing but spaces takes it away');
});

test('guardrails: retyping the only limit keeps what it says when a limit ends the call', () => {
  let c = setLimitSay(setLimit(care(), 'max_call_duration_s', '5'), 'Sorry, time is up.');
  c = setLimit(c, 'max_call_duration_s', ''); // Backspace empties the box for a moment
  assert.equal(limitsOf(c).say, 'Sorry, time is up.', 'still there, and shown, while no limit is set');
  c = setLimit(c, 'max_call_duration_s', '10');
  assert.deepEqual(c.guardrails.limits, { max_call_duration_s: 600, say: 'Sorry, time is up.' });
});

test('guardrails: a topic written twice is shown once, and removing it removes it', () => {
  const c = setTopics(care(), 'allowed', ['billing']);
  c.guardrails.topics.allowed = ['billing', 'billing', ' orders'];
  assert.deepEqual(topicsOf(c).allowed, ['billing', 'orders'], 'no two chips with the same text');
  assert.deepEqual(setTopics(c, 'allowed', ['orders']).guardrails.topics.allowed, ['orders']);
});

test('guardrails: an off-topic rule made by hand without a tool is kept when its tries change, and shown with no tool chosen', () => {
  const c = care();
  c.guardrails = { topics: { allowed: ['billing'], on_off_topic: { max_strikes: 2, say: { message: 'goodbye' } } } };
  const off = topicsOf(c).offTopic;
  assert.equal(off.then, '', 'nothing chosen');
  const next = setOffTopic(c, { ...off, strikes: '4' });
  assert.deepEqual(next.guardrails.topics.on_off_topic, { max_strikes: 4, say: { message: 'goodbye' } }, 'kept, with its fixed line');
  const end = c.tools.find((t) => t.builtin === 'end_call').id;
  assert.deepEqual(setOffTopic(next, { ...topicsOf(next).offTopic, then: end }).guardrails.topics.on_off_topic, {
    max_strikes: 4,
    then: end,
    say: { message: 'goodbye' },
  });
  assert.equal(setOffTopic(next, null).guardrails.topics.on_off_topic, undefined, 'switching it off still takes it away');
});

test('guardrails: changing the words of a switch keeps the rest of its rule, where it is', () => {
  let c = setMoment(care(), 'frustrated_to_person', true);
  c = setMoment(c, 'asks_for_person', true);
  c = setMoment(c, 'abusive_end', true);
  const asks = c.guardrails.escalation[1];
  asks.say = 'Sure, one moment please.';
  asks.when.consecutive_turns = 1;
  const { config, refused } = setMomentWords(c, 'asks_for_person', ['manager', 'complaint', 'supervisor', 'refund']);
  assert.equal(refused, '');
  assert.deepEqual(
    config.guardrails.escalation.map((r) => r.id),
    ['frustrated_to_person', 'asks_for_person', 'abusive_end'],
    'same place in the list',
  );
  assert.deepEqual(config.guardrails.escalation[1], {
    ...asks,
    when: { keywords: ['manager', 'complaint', 'supervisor', 'refund'], consecutive_turns: 1 },
  });
  assert.deepEqual(momentsOf(config).asks_for_person.keywords, ['manager', 'complaint', 'supervisor', 'refund']);
  assert.equal(setMoment(config, 'asks_for_person', true), config, 'switching on what is already on changes nothing');
});

test('guardrails: the last word of a switch is kept, and says why', () => {
  let c = setMoment(care(), 'asks_for_person', true, { keywords: ['refund'] });
  const result = setMomentWords(c, 'asks_for_person', []);
  assert.equal(result.config, c, 'nothing changed');
  assert.match(result.refused, /at least one word/);
  c = setMoment(c, 'asks_for_person', false);
  assert.equal(c.guardrails, undefined, 'switching it off is the way to stop it');
});

test('guardrails: a switched-on rule changed in the list is shown as changed, not as its switch', () => {
  let c = setMoment(care(), 'frustrated_to_person', true);
  c.guardrails.escalation[0].action = 'end_call';
  delete c.guardrails.escalation[0].tool;
  const state = momentsOf(c).frustrated_to_person;
  assert.equal(state.on, true, 'still on: switching it off takes it away');
  assert.equal(state.changed, 'Changed in the list below. When the caller sounds frustrated (2 turns in a row): end the call.');
  assert.equal(momentOf(c.guardrails.escalation[0], c), null);
  assert.equal(rowName('escalation', c.guardrails.escalation[0], 0, c).title, 'Frustrated to person', 'named by its id, not as the switch');

  // a rule that listens for what the caller wants, not for words: its words are not made up
  const transfer = care().tools.find((t) => t.builtin === 'transfer_or_callback').id;
  c = care();
  c.guardrails = { escalation: [{ id: 'asks_for_person', when: { intent: 'asks_for_human' }, action: 'tool', tool: transfer, say: 'Right away.' }] };
  assert.deepEqual(momentsOf(c).asks_for_person.keywords, []);
  assert.match(momentsOf(c).asks_for_person.changed, /they want to asks for human/);

  // what it says, or a second hand-over tool, is not a change of what the switch does
  c = setMoment(care(), 'asks_for_person', true);
  c.guardrails.escalation[0].say = 'One moment.';
  assert.equal(momentsOf(c).asks_for_person.changed, '');
  assert.equal(rowName('escalation', c.guardrails.escalation[0], 0, c).title, 'Pass people who ask for a manager or to complain');
});

test('guardrails: a switch whose id a check already has is not switched on (the server would refuse the second)', () => {
  const c = care();
  c.guardrails = { input: [{ id: 'abusive_end', type: 'statement', text: 'Be kind.', enforcement: 'prompt' }] };
  const state = momentsOf(c).abusive_end;
  assert.equal(state.possible, false);
  assert.match(state.why, /already has the id “abusive_end”/);
  assert.equal(setMoment(c, 'abusive_end', true), c);
});

test('guardrails: a new check is named clear of the ids on all three guardrail lists', () => {
  const c = care();
  c.guardrails = {
    input: [{ id: 'personal_details', type: 'pii_detect', entities: ['card_number'], enforcement: 'code', on_trigger: { action: 'redact_in_logs' } }],
    escalation: [{ id: 'rule', when: { sentiment: 'abusive' }, action: 'end_call' }],
  };
  const taken = takenIdsAt(c, ['guardrails', 'output']);
  assert.deepEqual(taken.sort(), ['personal_details', 'rule']);
  const output = pickerFor('guardrails.output', { engine, branches: branchesOf('output'), takenIds: taken });
  const pii = output.find((o) => o.id === 'pii').make();
  const statement = output.find((o) => o.id === 'statement').make();
  assert.notEqual(pii.id, 'personal_details');
  assert.notEqual(statement.id, 'rule');
  assert.deepEqual(
    takenIdsAt(c, ['tools']),
    c.tools.map((t) => t.id),
    'any other list: its own ids',
  );
  assert.deepEqual(takenIdsAt({}, ['guardrails', 'input']), []);
});

test('guardrails: the check and rule panels describe their own fields', () => {
  assert.equal(describeSetting('patterns', { owner: 'input' }).label, 'Patterns to look for');
  assert.doesNotMatch(describeSetting('patterns', { owner: 'output' }).purpose, /replaced/);
  assert.equal(describeSetting('entities', { owner: 'input' }).label, 'Kinds of detail to look for');
  assert.equal(describeSetting('to', { owner: 'escalation' }).label, 'Hand over to');
  assert.equal(describeSetting('patterns', { owner: 'redaction' }).label, 'Extra patterns to hide', 'the redaction keeps its own words');
});
