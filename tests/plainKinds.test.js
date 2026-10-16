import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILTIN_WORDS, PLAIN_KIND, plainKind, plainToolKind } from '../src/studio/form/plainKinds.js';
import { summarize } from '../src/studio/form/cardLogic.js';
import { createEngine } from '../src/studio/form/engine.js';

// The kind of a thing, in words: every kind the schema can name has a phrase, so a card's grey hint never reads "sip_voice" or "http".
const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const engine = createEngine(schema);

// every discriminator (`type` const) of the lists whose cards carry their kind as a hint
const kindsOf = (shape) =>
  engine
    .branchesOf(shape)
    .map((b) => engine.flatten(b).properties?.type?.const)
    .filter(Boolean);

test('every kind of tool, channel and safety rule the schema has is written in words', () => {
  const tools = kindsOf(engine.flatten(schema.properties.tools.items));
  assert.ok(tools.length >= 6);
  tools.forEach((k) => assert.ok(PLAIN_KIND[k], `tool kind ${k}`));
  engine.flatten(schema.properties.channels.items).properties.type.enum.forEach((k) => assert.ok(PLAIN_KIND[k], `channel type ${k}`));
  const guard = engine.flatten(schema.properties.guardrails);
  ['input', 'output'].forEach((side) => kindsOf(engine.flatten(guard.properties[side].items)).forEach((k) => assert.ok(PLAIN_KIND[k], `safety rule ${k}`)));
  const builtins = engine.flatten(
    engine.branchesOf(engine.flatten(schema.properties.tools.items)).find((b) => engine.flatten(b).properties.type?.const === 'builtin'),
  ).properties.builtin.enum;
  builtins.forEach((b) => assert.ok(BUILTIN_WORDS[b], `built-in ${b}`));
  ['router', 'specialist', 'standalone'].forEach((k) => assert.ok(PLAIN_KIND[k]));
});

test('a tool is named by what it does, a built-in by its action, an unknown kind as it is', () => {
  assert.equal(plainToolKind({ id: 'a', type: 'http' }), 'Looks something up');
  assert.equal(plainToolKind({ id: 'a', type: 'builtin', builtin: 'end_call' }), 'Ends the call');
  assert.equal(plainToolKind({ id: 'a', builtin: 'transfer_or_callback' }), 'Hands over to a person');
  assert.equal(plainToolKind({ id: 'a', type: 'wobble' }), 'wobble');
  assert.equal(plainToolKind(null), '');
  assert.equal(plainKind('sip_voice'), 'Phone line');
});

test('a card’s grey hint is the kind in words', () => {
  assert.deepEqual(summarize({ id: 'a', type: 'http' }, 2), { title: 'a', hint: 'Looks something up' });
  assert.deepEqual(summarize({ id: 'phone', type: 'sip_voice' }, 0), { title: 'phone', hint: 'Phone line' });
  assert.deepEqual(summarize({ id: 'end', type: 'builtin', builtin: 'end_call' }, 0), { title: 'end', hint: 'Ends the call' });
  assert.deepEqual(summarize({ id: 'g', type: 'pii_detect' }, 0), { title: 'g', hint: 'Hides personal details' });
  assert.deepEqual(summarize({ id: 'x', kind: 'specialist' }, 0), { title: 'x', hint: 'Does one job' });
  assert.deepEqual(summarize({ type: 'say', text: 'Hello' }, 1), { title: 'say', hint: 'Hello' }, 'a step titled by its type keeps its text as the hint');
});
