import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../src/studio/form/engine.js';
import { COLLECTIONS, collectionAt, deleteItem, describeUsage, findReferences, findUsage, freshId, removePointers, renameEverywhere, sameIds } from '../src/studio/form/references.js';

const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const example = () => JSON.parse(readFileSync(new URL('./fixtures/agent-config.example.json', import.meta.url), 'utf8'));
const engine = createEngine(schema);
const usage = (config, collection, id) => findUsage(engine, config, collection, id);
const text = (config) => JSON.stringify(config);

test('references are found wherever the schema says a field points at an id, at any depth', () => {
  const config = example();
  const places = describeUsage(config, usage(config, 'channels', 'phone'));
  assert.deepEqual(places, ['tool “report_hazard”', 'test “billing_happy_path”']);
  assert.deepEqual(describeUsage(config, usage(config, 'agents', 'billing')), ['agent “greeter”']); // the handoff
  assert.deepEqual(describeUsage(config, usage(config, 'messages', 'greeting')), ['channel “phone”']);
  assert.ok(usage(config, 'state_vars', 'intent').length >= 4);
  assert.deepEqual(usage(config, 'tools', 'no_such_tool'), []);
});

test('an id that nothing points at has no usage', () => {
  const config = example();
  config.channels.push({ id: 'spare', type: 'web_chat', enabled: false, entry: { widget_id: 'w' }, modalities: { input: ['text'], output: ['text'] } });
  assert.deepEqual(usage(config, 'channels', 'spare'), []);
});

test('renaming a channel changes the item and every pointer, and nothing else', () => {
  const config = example();
  const next = renameEverywhere(engine, config, 'channels', 'phone', 'main_phone');
  assert.ok(next.channels.some((c) => c.id === 'main_phone'));
  assert.ok(!next.channels.some((c) => c.id === 'phone'));
  assert.deepEqual(usage(next, 'channels', 'phone'), []);
  assert.equal(usage(next, 'channels', 'main_phone').length, 2);
  assert.equal(text(config).includes('"phone"'), true); // the input was not modified
  // renaming back gives exactly what we started with
  assert.deepEqual(renameEverywhere(engine, next, 'channels', 'main_phone', 'phone'), config);
});

test('renaming an agent updates the entry agent and the handoffs that lead to it', () => {
  const config = example();
  const next = renameEverywhere(engine, config, 'agents', 'billing', 'bills');
  assert.ok(next.agents.items.some((a) => a.id === 'bills'));
  assert.equal(next.agents.items[0].handoffs[0].to, 'bills');
  const entry = renameEverywhere(engine, config, 'agents', 'greeter', 'front_desk');
  assert.equal(entry.agents.entry, 'front_desk');
  assert.deepEqual(renameEverywhere(engine, entry, 'agents', 'front_desk', 'greeter'), config);
});

test('renaming a tool also changes the tool names a test expects', () => {
  const config = example();
  assert.ok(sameIds('tools').includes('tool_names'));
  const next = renameEverywhere(engine, config, 'tools', 'verify_caller', 'check_caller');
  assert.ok(next.tools.some((t) => t.id === 'check_caller'));
  assert.ok(next.agents.items[1].tools.includes('check_caller'));
  assert.equal(next.tests[0].expect[0].tool_called, 'check_caller');
  assert.deepEqual(usage(next, 'tools', 'verify_caller'), []);
});

test('renaming a state variable renames the key, the fields that name it, and the {{state.…}} text that mentions it', () => {
  const config = example();
  config.messages.push({ id: 'intent_line', text: { en: 'You asked about {{state.intent | default("billing")}} and {{ state.intent }}. Not {{state.intent_other}}.' } });
  const next = renameEverywhere(engine, config, 'state_vars', 'intent', 'topic');
  assert.ok('topic' in next.state.variables && !('intent' in next.state.variables));
  assert.equal(next.telephony.transfers[0].target.lookup.state, 'topic');
  const line = next.messages.find((m) => m.id === 'intent_line').text.en;
  assert.equal(line, 'You asked about {{state.topic | default("billing")}} and {{ state.topic }}. Not {{state.intent_other}}.'); // a longer name is not touched
  assert.deepEqual(usage(next, 'state_vars', 'intent'), []);
  assert.deepEqual(renameEverywhere(engine, next, 'state_vars', 'topic', 'intent'), config);
});

test('renaming a connection changes every kind of pointer into it', () => {
  const config = example();
  const next = renameEverywhere(engine, config, 'connections', 'billing_api', 'billing');
  assert.ok('billing' in next.connections && !('billing_api' in next.connections));
  assert.equal(next.tools[5].connection, 'billing');
  assert.deepEqual(usage(next, 'connections', 'billing_api'), []);
});

test('renaming a message or a schedule', () => {
  const config = example();
  const msg = renameEverywhere(engine, config, 'messages', 'greeting', 'hello');
  assert.ok(msg.messages.some((m) => m.id === 'hello'));
  assert.equal(msg.channels[0].greeting.say.message, 'hello');
  const sched = renameEverywhere(engine, config, 'schedules', 'support_hours', 'open_hours');
  assert.ok('open_hours' in sched.schedules);
  assert.equal(sched.telephony.transfers[0].schedule, 'open_hours');
});

test('renaming to the same name changes nothing', () => {
  const config = example();
  assert.equal(renameEverywhere(engine, config, 'channels', 'phone', 'phone'), config);
});

test('removing the pointers: list entries go, optional fields are deleted, required ones are reported', () => {
  const config = example();
  const before = usage(config, 'tools', 'escalate_to_human').length;
  assert.ok(before >= 2);
  const { config: next, left } = removePointers(engine, config, 'tools', 'escalate_to_human');
  assert.ok(!next.agents.items[0].tools.includes('escalate_to_human'));
  assert.equal(next.agents.items[0].tools.includes('end_call'), true); // the others stay
  assert.equal(findReferences(engine, next, 'tools', 'escalate_to_human').length, left.length);
  const handoff = removePointers(engine, config, 'agents', 'billing'); // handoffs[].to is required: it can't be removed
  assert.ok(handoff.left.length >= 1);
  assert.equal(handoff.config.agents.items[0].handoffs[0].to, 'billing');
});

test('deleting an item removes it from a list or a map', () => {
  const config = example();
  const without = deleteItem(config, 'channels', 'phone');
  assert.ok(!without.channels.some((c) => c.id === 'phone'));
  assert.equal(without.channels.length, config.channels.length - 1);
  const noVar = deleteItem(config, 'state_vars', 'intent');
  assert.ok(!('intent' in noVar.state.variables));
  assert.equal(deleteItem(config, 'agents', 'nobody').agents.items.length, config.agents.items.length);
});

test('which collection a list or map is, from its path', () => {
  assert.equal(collectionAt(['channels']), 'channels');
  assert.equal(collectionAt(['agents', 'items']), 'agents');
  assert.equal(collectionAt(['telephony', 'transfers']), 'transfers');
  assert.equal(collectionAt(['state', 'variables']), 'state_vars');
  assert.equal(collectionAt(['defaults']), null);
  assert.ok(Object.keys(COLLECTIONS).length >= 14);
});

test('new ids: the base first, a counter only when it is taken', () => {
  assert.equal(freshId([], 'phone'), 'phone');
  assert.equal(freshId(['phone'], 'phone'), 'phone_2');
  assert.equal(freshId(['phone', 'phone_2'], 'phone'), 'phone_3');
  assert.equal(freshId([], 'Web Chat!'), 'web_chat');
  assert.equal(freshId([], '9x'), 'x');
  assert.equal(freshId(['item'], ''), 'item_2');
});
