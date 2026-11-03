import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../src/studio/form/engine.js';
import { factsAt, setPath } from '../src/studio/agent/detailed/schemaFacts.js';

// What the Detailed parts' rows learn from the schema (src/studio/agent/detailed/schemaFacts.js): the kind of value, its choices, whether it
// is required, its limits; and how a row writes its value into the draft without breaking a list on the way.
const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const engine = createEngine(schema);
const facts = (path, config = {}) => factsAt(engine, schema, path, config);

test('a value is written at its place, a list made where the next step is a number, and nothing else is changed', () => {
  const before = { meta: { id: 'a', name: 'A' }, tools: [{ id: 'x' }] };
  const after = setPath(before, ['tools', 1, 'id'], 'y');
  assert.deepEqual(after.tools, [{ id: 'x' }, { id: 'y' }]);
  assert.equal(after.meta, before.meta, 'what was not on the way is shared');
  assert.deepEqual(before.tools, [{ id: 'x' }], 'the draft it was given is untouched');
  assert.ok(Array.isArray(setPath({}, ['guardrails', 'input', 0, 'type'], 'pii').guardrails.input), 'a list, not an object keyed "0"');
  assert.deepEqual(setPath({ a: { b: 1, c: 2 } }, ['a', 'b'], undefined), { a: { c: 2 } }, 'nothing at a place removes the key');
  assert.deepEqual(setPath({ s: {} }, ['s', 'office', 'timezone'], 'UTC'), { s: { office: { timezone: 'UTC' } } }, 'a name makes an object');
});

test('the schema says what a place holds: its kind, its choices in plain words, whether it is required, its limits', () => {
  const name = facts(['meta', 'name']);
  assert.equal(name.kind, 'string');
  assert.equal(name.required, true, 'an agent must have a name');
  assert.ok(!facts(['meta', 'description'])?.required, 'a description is optional');
  const level = facts(['observability', 'log_level']);
  assert.ok(level.choices.length > 1, 'a choice lists its values');
  assert.ok(level.choices.every((c) => c.label && c.value !== null));
  assert.equal(facts(['nonsense', 'here']), null, 'no such place: no facts');
  assert.equal(facts([]), null);
  assert.equal(factsAt(null, schema, ['meta', 'name']), null, 'no schema loaded yet: no facts');
});

test('a place inside a list item or a named entry is found, and an item of a choice of shapes is read by the shape it has', () => {
  assert.ok(facts(['tools', 0, 'id']), 'an item of a list');
  assert.ok(facts(['schedules', '_', 'timezone']), 'an entry of a map, by any name');
  assert.ok(facts(['telephony', 'transfers', 0, 'schedule']), 'a transfer’s business hours');
  const config = { knowledge: [{ id: 'docs', type: 'vector_store', mode: 'inject' }] };
  assert.ok(facts(['knowledge', 0, 'mode'], config), 'a knowledge base’s field, found through the shape it has');
});
