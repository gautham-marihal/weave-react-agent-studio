import test from 'node:test';
import assert from 'node:assert/strict';
import { minimalConfig } from '../src/demo/minimalConfig.js';
import { applyStarter } from '../src/studio/starters.ts';
import { readRecords } from '../src/studio/records/recordsModel.js';
import {
  ASKED_ABOVE,
  afterCallOf,
  askedAbove,
  notDoneYet,
  removeQuestion,
  setQuestion,
  setRecording,
  setRedaction,
} from '../src/studio/agent/blocks/afterCallModel.js';

// The After the call model (src/studio/agent/blocks/afterCallModel.js): what they write is valid, agrees with what
// the release checklist reads, and never loses what was typed or points at the wrong item.
const care = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const at11 = () => ({ ...care(), schema_version: '1.1' });

test('hiding sensitive details raises a schema 1.1 agent to 1.2, which it needs, and leaves the version alone when nothing is kept', () => {
  const ticked = setRedaction(at11(), { entities: ['card_number'] });
  assert.equal(ticked.schema_version, '1.2');
  assert.deepEqual(ticked.post_call.redaction, { entities: ['card_number'] });
  const on = setRedaction(at11(), { on: true });
  assert.equal(on.schema_version, '1.2');
  // switched on from nothing, it starts with what the agent handles (card numbers at least), never with nothing ticked
  assert.deepEqual(on.post_call.redaction, { enabled: true, entities: ['card_number'] });
  const off = setRedaction(on, { on: false });
  assert.equal(off.post_call, undefined, 'switched off with nothing else chosen, it is taken out');
  assert.equal(off.schema_version, '1.2', 'and the version is never lowered');
  assert.equal(setRedaction(at11(), { on: false }).schema_version, '1.1', 'off on an agent with none is no change');
  const noVersion = care();
  delete noVersion.schema_version;
  assert.equal(setRedaction(noVersion, { on: true }).schema_version, '1.2');
});

test('hiding sensitive details reads the same as the release checklist, for every shape of the setting', () => {
  const shapes = [undefined, {}, { enabled: true }, { enabled: false }, { entities: ['pin'] }, { enabled: false, entities: ['pin'] }, 'nonsense'];
  shapes.forEach((redaction) => {
    const config = care();
    if (redaction !== undefined) config.post_call = { redaction };
    assert.equal(afterCallOf(config).redaction.on, readRecords(config).redactionOn, JSON.stringify(redaction));
  });
  assert.equal(afterCallOf(care()).redaction.on, false, 'not set: nothing is hidden but the values marked sensitive');
  // switched off and on again, it is on for both readers
  const again = setRedaction(setRedaction(setRedaction(care(), { on: true }), { on: false }), { on: true });
  assert.equal(afterCallOf(again).redaction.on, true);
  assert.equal(readRecords(again).redactionOn, true);
});

test('hiding sensitive details keeps what was ticked while it is off, and stays on when the last kind is unticked', () => {
  let c = setRedaction(setRedaction(care(), { on: true }), { entities: ['pin', 'card_number'] });
  assert.deepEqual(c.post_call.redaction, { enabled: true, entities: ['card_number', 'pin'] });
  c = setRedaction(c, { on: false });
  assert.deepEqual(c.post_call.redaction, { enabled: false, entities: ['card_number', 'pin'] });
  c = setRedaction(c, { on: true });
  assert.deepEqual(afterCallOf(c).redaction, { on: true, entities: ['card_number', 'pin'] });
  // one made by hand, on because it is not switched off: unticking its last kind keeps it on
  const hand = care();
  hand.post_call = { redaction: { entities: ['pin'] } };
  const unticked = setRedaction(hand, { entities: [] });
  assert.equal(afterCallOf(unticked).redaction.on, true);
  assert.equal(readRecords(unticked).redactionOn, true);
});

test('a question row writes to its own item when something in the list is not a question, and a missing kind is not shown as one', () => {
  const hand = care();
  hand.post_call = {
    analysis: [null, { id: 'q1', question: 'Q1', type: 'boolean' }, { id: 'q2', question: 'Q2' }, { id: 'q3', question: 'Q3', type: 'date' }],
  };
  const shown = afterCallOf(hand).questions;
  assert.deepEqual(
    shown.map((q) => [q.index, q.id, q.type]),
    [
      [1, 'q1', 'boolean'],
      [2, 'q2', ''],
      [3, 'q3', ''],
    ],
  );
  const changed = setQuestion(hand, shown[0].index, { question: 'Changed' });
  assert.equal(changed.post_call.analysis[1].question, 'Changed');
  assert.equal(changed.post_call.analysis[0], null, 'what is not a question is left as it is');
  const removed = removeQuestion(hand, shown[0].index);
  assert.deepEqual(
    removed.post_call.analysis.map((q) => q?.id ?? null),
    [null, 'q2', 'q3'],
  );
  assert.equal(setQuestion(hand, shown[1].index, { type: 'number' }).post_call.analysis[2].type, 'number', 'choosing a kind writes it');
});

test('recordings: part of a day is one day, never “no limit”', () => {
  const kept = (days) => setRecording(setRecording(care(), { audio: true, days: '7' }), { days }).post_call.recording.retention_days;
  assert.equal(kept('0.4'), 1);
  assert.equal(kept('0.5'), 1);
  assert.equal(kept(0.01), 1);
  assert.equal(kept('1.5'), 2);
  assert.equal(kept('30'), 30);
  assert.equal(kept(''), undefined, 'emptied: kept until someone deletes them');
  assert.equal(kept(null), undefined);
  assert.equal(kept('0'), undefined);
});

test('the form below shows the summary’s model only once summaries are on, so changing it cannot switch them off', () => {
  const hidesSummary = (config) => askedAbove(config).some((p) => p.join('.') === 'post_call.summary');
  assert.ok(hidesSummary(care()), 'not set');
  assert.ok(hidesSummary({ post_call: { summary: { enabled: false } } }), 'off');
  assert.ok(!hidesSummary({ post_call: { summary: { enabled: true } } }), 'on');
  assert.ok(!hidesSummary({ post_call: { summary: { enabled: false, llm: { provider: 'anthropic' } } } }), 'a model already chosen stays in reach');
  [care(), { post_call: { summary: { enabled: true } } }].forEach((config) =>
    ASKED_ABOVE.forEach((p) => assert.ok(askedAbove(config).includes(p), `${p.join('.')} is always asked above`)),
  );
});

test('hiding switched on starts with the kinds the agent already handles: its Guardrails checks, and PINs it keeps sensitive', () => {
  const config = care();
  config.guardrails = { ...(config.guardrails || {}), input: [{ id: 'pii', type: 'pii_detect', entities: ['email', 'phone_number'], action: 'mask' }] };
  config.state = { variables: { account_pin: { type: 'string', sensitive: true } } };
  const on = setRedaction(config, { on: true });
  assert.deepEqual(on.post_call.redaction.entities, ['card_number', 'phone_number', 'email', 'pin']);
  // one already set keeps what it has
  const kept = setRedaction({ ...config, post_call: { redaction: { enabled: false, entities: ['otp'] } } }, { on: true });
  assert.deepEqual(kept.post_call.redaction, { enabled: true, entities: ['otp'] });
});

test('a card says the server doesn’t do its part yet only when the validator says so', () => {
  assert.deepEqual(notDoneYet([]), { summary: false, questions: false, recording: false, redaction: false });
  assert.deepEqual(notDoneYet(undefined), { summary: false, questions: false, recording: false, redaction: false });
  const listed = notDoneYet([
    { feature: 'post-call summary', where: 'post_call.summary' },
    { feature: 'call recording settings', where: 'post_call.recording' },
  ]);
  assert.deepEqual(listed, { summary: true, questions: false, recording: true, redaction: false });
});

test('the call log is asked on the Recording card, so the settings below no longer ask it', () => {
  const asked = askedAbove(care()).map((p) => p.join('.'));
  assert.ok(asked.includes('observability.session_log.enabled'));
  assert.ok(asked.includes('observability.session_log.retention_days'));
});
