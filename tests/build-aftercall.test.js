import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { minimalConfig } from '../src/demo/minimalConfig.js';
import { applyStarter } from '../src/studio/starters.js';
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
} from '../src/studio/newlayout/simple/afterCallModel.js';
import { $, $$, actions, byLabel, byText, setupDom, teardownDom, textOf } from './component/dom.js';

// The After the call page's blocks (src/studio/newlayout/simple/afterCallModel.js and AfterCallBlocks.jsx): what they write is valid, agrees with what
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
  let c = setRedaction(setRedaction(care(), { on: true }), { entities: ['pin', 'card_number', 'nonsense'] });
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

// ---- the blocks, in a DOM -----------------------------------------------------------------------------------------------------------------------
let mod;
let act;
let ui;
before(async () => {
  await setupDom();
  const dir = join(tmpdir(), 'weave-component-tests');
  mkdirSync(dir, { recursive: true });
  const outfile = join(dir, `aftercall-${process.pid}-${Date.now()}.mjs`);
  await build({
    stdin: {
      contents: `
        import React, { act, useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { QuestionsBlock } from '../src/studio/newlayout/simple/AfterCallBlocks.jsx';
        function Host({ initial, onConfig }) {
          const [config, setConfig] = useState(initial);
          return <QuestionsBlock config={config} set={(next) => { setConfig(next); onConfig(next); }} />;
        }
        export async function mount(initial) {
          const container = document.createElement('div');
          document.body.appendChild(container);
          const root = createRoot(container);
          const state = { config: initial };
          await act(async () => root.render(<Host initial={initial} onConfig={(next) => { state.config = next; }} />));
          return {
            container,
            get config() { return state.config; },
            async unmount() { await act(async () => root.unmount()); container.remove(); },
          };
        }
        export { act };
      `,
      resolveDir: fileURLToPath(new URL('.', import.meta.url)),
      loader: 'jsx',
    },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    logLevel: 'error',
    loader: { '.css': 'empty' },
    define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' },
  });
  mod = await import(pathToFileURL(outfile).href);
  act = mod.act;
  ui = actions(act);
});
after(() => teardownDom());

const withQuestions = (analysis) => {
  const config = care();
  config.post_call = { analysis };
  return config;
};

test('blocks: switching a question away from “One of a list” and back keeps its answers to choose from', async () => {
  const app = await mod.mount(withQuestions([{ id: 'feel', type: 'enum', question: 'How did they feel?', values: ['Happy', 'Neutral', 'Unhappy'] }]));
  const kind = () => byLabel(app.container, 'The answer to question 1');
  await ui.choose(kind(), 'number');
  assert.equal(app.config.post_call.analysis[0].values, undefined, 'the configuration keeps a list only with “One of a list”');
  await ui.choose(kind(), 'enum');
  assert.deepEqual(app.config.post_call.analysis[0].values, ['Happy', 'Neutral', 'Unhappy']);
  await app.unmount();
});

test('blocks: rows write to their own item, a missing kind shows “Choose…”, and repeated ids draw no React key error', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const app = await mod.mount(
      withQuestions([
        null,
        { id: 'kindless', question: 'No kind' },
        { id: 'dup', type: 'enum', question: 'Third', values: ['Red', 'Green'] },
        { id: 'dup', type: 'enum', question: 'Fourth', values: ['Cat', 'Dog'] },
      ]),
    );
    assert.equal($$(app.container, '.smQuestions > li').length, 3);
    const kind = byLabel(app.container, 'The answer to question 1');
    assert.equal(kind.value, '');
    assert.equal(textOf(kind.selectedOptions[0]), 'Choose…');
    await ui.choose(kind, 'string');
    assert.equal(app.config.post_call.analysis[1].type, 'string', 'the first row shown is the second item');
    assert.equal(app.config.post_call.analysis[0], null);
    await ui.click(byText(app.container, '.smQuestions > li:nth-child(2) button', 'Remove'));
    assert.deepEqual(
      app.config.post_call.analysis.map((q) => q?.question ?? null),
      [null, 'No kind', 'Fourth'],
    );
    await app.unmount();
  } finally {
    console.error = original;
  }
  assert.deepEqual(
    errors.filter((e) => /same key/i.test(e)),
    [],
  );
});

test('blocks: the focus goes to the new question when one is added, and to the next row or “Add a question” when one is removed', async () => {
  const app = await mod.mount(care());
  await ui.click(byText(app.container, 'button.suChip', 'Why did they get in touch?'));
  assert.equal(document.activeElement, byLabel(app.container, 'Question 1'));
  await ui.click(byText(app.container, 'button', 'Add a question'));
  assert.equal(document.activeElement, byLabel(app.container, 'Question 2'));
  await ui.click(byText(app.container, '.smQuestions > li:nth-child(1) button', 'Remove'));
  assert.equal(document.activeElement, byLabel(app.container, 'Question 1'), 'the row that took its place');
  await ui.click(byText(app.container, '.smQuestions > li:nth-child(1) button', 'Remove'));
  assert.equal(document.activeElement, byText(app.container, 'button', 'Add a question'));
  assert.equal($(app.container, '.smQuestions'), null);
  await app.unmount();
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
