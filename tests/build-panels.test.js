import test from 'node:test';
import assert from 'node:assert/strict';
import { hiddenParts } from '../src/studio/form/hiddenParts.js';
import { subscribeDialogs } from '../src/ui/dialogs.js';
import { holdStagedPanel, stagedPanel, whenPanelKept } from '../src/studio/agent/stagedPanel.js';

// A side panel of an agent's page with changes not yet put in (no Done pressed): what replaces it (a search result opening another panel) asks first.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('with no panel waiting, what was asked for happens at once', () => {
  let ran = 0;
  whenPanelKept(() => (ran += 1));
  assert.equal(ran, 1);
});

test('a panel with changes waiting is asked about: Keep puts them in and goes on, Stay leaves it as it was', async () => {
  let open = null;
  const stop = subscribeDialogs((dialog) => (open = dialog));
  let done = 0;
  let refocused = 0;
  let ran = 0;
  const release = holdStagedPanel({ title: 'Voice', done: () => (done += 1), refocus: () => (refocused += 1) });
  assert.equal(stagedPanel().title, 'Voice');

  whenPanelKept(() => (ran += 1));
  assert.match(open.title, /Keep your changes to “Voice”/);
  open.resolve(false);
  await settle();
  assert.deepEqual([done, ran, refocused], [0, 0, 1], 'Stay: nothing put in, nothing opened, the panel has the keyboard again');
  assert.ok(stagedPanel(), 'and its changes are still waiting');

  whenPanelKept(() => (ran += 1));
  open.resolve(true);
  await settle();
  assert.deepEqual([done, ran], [1, 1], 'Keep and go on: the changes go in, then the new panel opens');
  assert.equal(stagedPanel(), null, 'and it is not asked about again');
  release();
  stop();
});

test('a panel that is put in or closed stops being asked about', () => {
  const release = holdStagedPanel({ title: 'Language', done() {} });
  release();
  assert.equal(stagedPanel(), null);
  let ran = 0;
  whenPanelKept(() => (ran += 1));
  assert.equal(ran, 1);
});

test('a row deleted below a card keeps what the card asks: only the parts the form shows go', () => {
  const hidden = new Set(['post_call.redaction.enabled', 'post_call.redaction.entities', 'post_call.summary.enabled', 'post_call.summary.prompt']);
  const redaction = { enabled: true, entities: ['card_number'], patterns: ['ORD-\\d+'], replacement: '[hidden]' };
  assert.deepEqual(hiddenParts(redaction, 'post_call.redaction', hidden), { enabled: true, entities: ['card_number'] });
  // nothing the card asks is set: the whole row goes
  assert.equal(hiddenParts({ patterns: ['x'] }, 'post_call.redaction', hidden), undefined);
  // nothing is hidden under this path
  assert.equal(hiddenParts({ audio: true }, 'post_call.recording', hidden), undefined);
  assert.equal(hiddenParts(redaction, 'post_call.redaction', null), undefined);
  // deeper paths keep their place
  assert.deepEqual(hiddenParts({ session_log: { enabled: false, detail: 'full' } }, 'observability', new Set(['observability.session_log.enabled'])), {
    session_log: { enabled: false },
  });
  // what is kept is a copy
  const kept = hiddenParts(redaction, 'post_call.redaction', hidden);
  kept.entities.push('pin');
  assert.deepEqual(redaction.entities, ['card_number']);
});
