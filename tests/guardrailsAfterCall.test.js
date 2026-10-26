import test from 'node:test';
import assert from 'node:assert/strict';
import { minimalConfig } from '../src/demo/minimalConfig.js';
import { applyStarter } from '../src/studio/starters.ts';
import {
  LIMITS,
  checkWords,
  endingTools,
  limitsOf,
  momentsOf,
  ruleWords,
  setLimit,
  setLimitSay,
  setMoment,
  setOffTopic,
  setTopics,
  topicsOf,
} from '../src/studio/agent/blocks/guardrailModel.js';
import {
  ASKED_ABOVE,
  addQuestion,
  afterCallOf,
  removeQuestion,
  setNotice,
  setQuestion,
  setRecording,
  setRedaction,
  setSummary,
} from '../src/studio/agent/blocks/afterCallModel.js';
import { PAGE_SECTIONS, locate } from '../src/studio/agent/pages.js';
import { rowName } from '../src/studio/agent/rowNames.js';

// The plain-words blocks of the Guardrails and After the call pages (src/studio/agent/blocks): what they read and write, and that what is left empty
// is taken out again, so nothing is written that was not chosen.
const bare = () => minimalConfig('acme', 'Acme');
const care = () => applyStarter(bare(), 'support');

test('guardrails: topics it keeps to and stays away from, tidied, and gone when emptied', () => {
  let c = setTopics(bare(), 'allowed', [' orders ', 'orders', '', 'deliveries']);
  c = setTopics(c, 'blocked', ['medical advice']);
  assert.deepEqual(topicsOf(c), { allowed: ['orders', 'deliveries'], blocked: ['medical advice'], offTopic: null });
  c = setTopics(c, 'allowed', []);
  c = setTopics(c, 'blocked', []);
  assert.equal(c.guardrails, undefined, 'nothing left: no guardrails written');
});

test('guardrails: going off topic ends in one of its tools, named in words; no tool, no rule', () => {
  const tools = endingTools(care());
  assert.deepEqual(
    tools.map((t) => t.label),
    ['End the conversation', 'Pass them to a person'],
  );
  let c = setOffTopic(care(), { strikes: '3', then: tools[0].id, say: 'Let me stop here. ' });
  assert.deepEqual(
    c.guardrails.topics.on_off_topic,
    { max_strikes: 3, then: tools[0].id, say: 'Let me stop here. ' },
    'kept as typed, so a space can be typed',
  );
  assert.deepEqual(topicsOf(c).offTopic, { strikes: 3, then: tools[0].id, say: 'Let me stop here. ', sayRef: '' });
  c = setOffTopic(c, { strikes: 0, then: tools[1].id, sayRef: 'goodbye' });
  assert.deepEqual(c.guardrails.topics.on_off_topic, { max_strikes: 1, then: tools[1].id, say: { message: 'goodbye' } }, 'a fixed line is kept as one');
  assert.equal(setOffTopic(c, null).guardrails, undefined);
  assert.equal(setOffTopic(bare(), { strikes: 2, then: '' }).guardrails, undefined, 'the schema needs a tool to run');
});

test('guardrails: limits as asked (minutes for a call), within what the schema allows, and their line kept until it is cleared', () => {
  let c = setLimit(bare(), 'max_call_duration_s', '10');
  assert.equal(c.guardrails.limits.max_call_duration_s, 600);
  c = setLimit(c, 'max_call_duration_s', '0.2');
  assert.equal(c.guardrails.limits.max_call_duration_s, 30, 'never under the schema’s 30 seconds');
  c = setLimit(c, 'max_silence_s', '45.6');
  assert.equal(c.guardrails.limits.max_silence_s, 46);
  c = setLimitSay(c, 'I have to go now.');
  assert.deepEqual(limitsOf(c).values, { max_call_duration_s: 30, max_silence_s: 46 });
  assert.equal(LIMITS[0].toInput(600), 10);
  c = setLimit(c, 'max_call_duration_s', '');
  c = setLimit(c, 'max_silence_s', 'abc');
  assert.deepEqual(c.guardrails.limits, { say: 'I have to go now.' }, 'no limit left: the line typed for one stays until it is cleared');
  c = setLimitSay(c, ' ');
  assert.equal(c.guardrails, undefined, 'nothing left: no guardrails written');
  const same = bare();
  assert.equal(setLimit(same, 'nonsense', '3'), same, 'an unknown limit changes nothing');
});

test('guardrails: handing over and ending by itself, as switches, and each rule in words', () => {
  const noTransfer = momentsOf(bare());
  assert.equal(noTransfer.frustrated_to_person.possible, true, 'it can be switched on');
  assert.equal(noTransfer.frustrated_to_person.needsHandOver, true, 'and says it needs the hand-over, which the page switches on with it');
  assert.equal(noTransfer.abusive_end.needsHandOver, false);
  assert.equal(setMoment(bare(), 'frustrated_to_person', true).guardrails, undefined, 'the rule alone is not written without the hand-over');

  let c = setMoment(care(), 'frustrated_to_person', true);
  c = setMoment(c, 'asks_for_person', true, { keywords: ['manager', 'refund', 'manager'] });
  c = setMoment(c, 'abusive_end', true);
  const state = momentsOf(c);
  assert.ok(state.frustrated_to_person.on && state.asks_for_person.on && state.abusive_end.on);
  assert.deepEqual(state.asks_for_person.keywords, ['manager', 'refund']);
  const [frustrated, asks, abusive] = c.guardrails.escalation;
  assert.match(ruleWords(frustrated, c), /^When the caller sounds frustrated \(2 turns in a row\): pass them to a person$/);
  assert.equal(ruleWords(asks, c), 'When they say “manager” or “refund”: pass them to a person');
  assert.equal(ruleWords(abusive, c), 'When the caller is abusive: end the call');
  assert.equal(rowName('escalation', abusive, 2, c).title, 'End the call when someone is abusive', 'a switched-on rule is named as its switch');
  assert.equal(rowName('escalation', { id: 'vip_line', when: { intent: 'cancel_plan' }, action: 'handoff', to: 'retention' }, 3, c).title, 'Vip line');
  assert.equal(
    ruleWords({ id: 'x', when: { intent: 'cancel_plan' }, action: 'handoff', to: 'retention' }, c),
    'When they want to cancel plan: pass them to Retention',
  );
  // an agent is named as it is called, not by its id
  const entry = c.agents.items[0];
  const named = { ...c, agents: { ...c.agents, items: [{ ...entry, name: 'Front Desk' }, ...c.agents.items.slice(1)] } };
  assert.equal(
    ruleWords({ id: 'x', when: { sentiment: 'negative' }, action: 'handoff', to: entry.id }, named),
    'When the caller is unhappy: pass them to Front Desk',
  );
  c = setMoment(c, 'frustrated_to_person', false);
  c = setMoment(c, 'asks_for_person', false);
  c = setMoment(c, 'abusive_end', false);
  assert.equal(c.guardrails, undefined);
});

test('after the call: a summary, what it covers, and nothing claimed about what the server does by default', () => {
  assert.equal(afterCallOf(bare()).summary.on, null, 'not set: the server decides');
  let c = setSummary(bare(), { on: true });
  c = setSummary(c, { prompt: 'Why they called.' });
  assert.deepEqual(c.post_call.summary, { enabled: true, prompt: 'Why they called.' });
  c = setSummary(c, { prompt: '  ' });
  assert.deepEqual(c.post_call.summary, { enabled: true });
  assert.equal(setSummary(c, { on: false }).post_call.summary.enabled, false);
});

test('after the call: questions with ids made once from their words, and kinds of answer', () => {
  let c = addQuestion(bare(), { question: 'Was the problem solved?', type: 'boolean' });
  c = addQuestion(c, { question: 'Was the problem solved?', type: 'boolean' });
  c = addQuestion(c, { question: 'Why did they call?', type: 'enum', values: ['A question', 'A problem'] });
  assert.deepEqual(
    c.post_call.analysis.map((q) => q.id),
    ['was_the_problem_solved', 'was_the_problem_solved_2', 'why_did_they_call'],
  );
  c = setQuestion(c, 0, { question: 'Was it solved?' });
  assert.equal(c.post_call.analysis[0].id, 'was_the_problem_solved', 'the id stays when the words change');
  c = setQuestion(c, 2, { values: ['A booking', ' ', 'A complaint '] });
  assert.deepEqual(c.post_call.analysis[2].values, ['A booking', 'A complaint']);
  c = setQuestion(c, 2, { type: 'number' });
  assert.equal(c.post_call.analysis[2].values, undefined, 'a list of answers only with “One of a list”');
  c = setQuestion(c, 1, { type: 'enum' });
  assert.deepEqual(c.post_call.analysis[1].values, ['Yes', 'No']);
  c = removeQuestion(removeQuestion(removeQuestion(c, 2), 1), 0);
  assert.equal(c.post_call, undefined);
});

test('after the call: what is recorded, for how long, and the recording notice, which is asked here once', () => {
  let c = setRecording(bare(), { transcript: true, days: '30' });
  assert.deepEqual(c.post_call.recording, { transcript: true, retention_days: 30 });
  assert.equal(afterCallOf(c).recording.audio, null);
  c = setRecording(c, { days: '' });
  assert.deepEqual(c.post_call.recording, { transcript: true });
  c = setNotice(c, 'This call is recorded.');
  assert.equal(afterCallOf(c).notice, 'This call is recorded.');
  assert.equal(c.persona.disclosures.recording_notice, 'This call is recorded.');
  const kept = setNotice(care(), '');
  assert.equal(kept.persona.disclosures, undefined, 'an empty notice is taken out');
  assert.equal(kept.persona.tone, care().persona.tone, 'and nothing else of the personality');
});

test('after the call: hiding sensitive details is on once it is set and not switched off, with what it looks for', () => {
  assert.equal(afterCallOf(bare()).redaction.on, false, 'not set: nothing is hidden but the values marked sensitive');
  let c = setRedaction(bare(), { entities: ['pin', 'card_number', 'nonsense'] });
  assert.deepEqual(c.post_call.redaction, { entities: ['card_number', 'pin'] });
  c = setRedaction(c, { on: false });
  assert.equal(c.post_call.redaction.enabled, false);
  c = setRedaction(c, { on: true, entities: [] });
  assert.deepEqual(c.post_call.redaction, { enabled: true });
  assert.equal(setRedaction(c, { on: false }).post_call, undefined);
  assert.ok(ASKED_ABOVE.some((p) => p.join('.') === 'post_call.recording'));
});

test('each input in one place: phone transfers are on Tools, beside the hand-over that uses them', () => {
  assert.ok(PAGE_SECTIONS.tools.includes('telephony'));
  assert.ok(!PAGE_SECTIONS.channels.includes('telephony'));
  assert.equal(locate(['telephony', 'transfers', 0, 'target']).page, 'tools');
});

test('a check on what is said, in words: what it does when it finds something, and how it is enforced', () => {
  assert.deepEqual(checkWords({ type: 'prompt_injection', enforcement: 'both', on_trigger: { action: 'deflect' } }), {
    then: 'politely declines',
    how: 'Checked in code, and the agent is told too.',
  });
  assert.equal(checkWords({ type: 'pii_detect', enforcement: 'code', on_trigger: { action: 'redact_in_logs' } }).then, 'hides it in the call log');
  assert.equal(checkWords({ type: 'field_firewall', enforcement: 'code' }).then, 'keeps them out');
  assert.deepEqual(checkWords({ type: 'statement', enforcement: 'prompt' }), { then: '', how: 'Told to the agent as advice: not checked.' });
  assert.deepEqual(checkWords(null), { then: '', how: '' });
});
