import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_KINDS, describeAction, describeRule, kindLabel, moveItem } from '../src/studio/form/effects.js';
import { readFileSync } from 'node:fs';
import { createEngine } from '../src/studio/form/engine.js';

test('every kind of action the schema allows has a plain name, and no name is invented', () => {
  const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
  const engine = createEngine(schema);
  const types = engine
    .branchesOf(engine.flatten(schema.$defs.action))
    .map((branch) => engine.flatten(branch).properties.type.const)
    .sort();
  assert.deepEqual(ACTION_KINDS.map((kind) => kind.type).sort(), types);
  assert.equal(new Set(ACTION_KINDS.map((kind) => kind.label)).size, ACTION_KINDS.length);
  assert.equal(kindLabel('end_call'), 'End the call');
  assert.equal(kindLabel('mystery'), 'mystery');
});

test('an action is written as a short sentence', () => {
  assert.equal(describeAction({ type: 'say', text: 'Done!' }), 'Say “Done!”');
  assert.equal(describeAction({ type: 'say', text: { message: 'bye' } }), 'Say the message “bye”');
  assert.equal(describeAction({ type: 'set_state', values: { outcome: 'paid', tries: 2 } }), 'Set outcome to “paid”, tries to 2');
  assert.equal(describeAction({ type: 'handoff', to: 'billing' }), 'Hand off to billing');
  assert.equal(describeAction({ type: 'end_call', say: 'Goodbye' }), 'Say “Goodbye”, then end the call');
  assert.equal(describeAction({ type: 'end_call' }), 'End the call');
  assert.equal(describeAction({ type: 'handoff' }), 'Hand off to an agent (none chosen yet)');
  assert.equal(describeAction({ type: 'http', connection: 'api', method: 'POST', path: '/x' }), 'Call POST /x on api');
  assert.equal(describeAction(null), 'Do something');
});

test('a rule is one sentence: when it applies, then its steps in order', () => {
  assert.equal(describeRule({ do: [{ type: 'say', text: 'Hi' }, { type: 'end_call' }] }), 'Always: say “Hi”, then end the call.');
  assert.equal(
    describeRule({ when: { result: '$.status', equals: 'ok' }, do: [{ type: 'set_state', values: { paid: true } }] }),
    'When the result $.status is “ok”: set paid to true.',
  );
  assert.equal(describeRule({ do: [] }), 'Always: nothing yet');
});

test('moving an item', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 1), ['a', 'c', 'b']);
  const same = ['a', 'b'];
  assert.equal(moveItem(same, 0, -1), same);
  assert.equal(moveItem(same, 1, 2), same);
});
