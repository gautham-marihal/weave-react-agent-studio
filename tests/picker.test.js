import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../src/studio/form/engine.js';
import { filterOptions, groupOptions, pickerFor } from '../src/studio/form/pickerOptions.js';

// The "Add…" cards: jobs, in plain words, matched to what the schema actually has. See pickerOptions.js.
const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const engine = createEngine(schema);
const toolBranches = engine.branchesOf(engine.flatten(schema.properties.tools.items));
const inputBranches = engine.branchesOf(
  engine.flatten(schema.properties.guardrails.properties?.input?.items || engine.flatten(schema.properties.guardrails).properties.input.items),
);
const outputBranches = engine.branchesOf(engine.flatten(engine.flatten(schema.properties.guardrails).properties.output.items));

const tools = pickerFor('tools', { engine, branches: toolBranches });
const typeOf = (branch) => engine.flatten(branch).properties?.type?.const;

test('every kind of tool the schema has can be added from the cards, named for the job it does', () => {
  assert.ok(tools.length >= toolBranches.length);
  const labels = tools.map((o) => o.label);
  [
    'Hand over to a person',
    'End the call',
    'Look something up in your systems',
    'Search your knowledge',
    'Show the caller a form',
    'Run your own code',
  ].forEach((label) => assert.ok(labels.includes(label), label));
  tools.forEach((o) => {
    assert.ok((o.label && !/[_]|HTTP|MCP|Built-in/.test(o.label)) || /MCP/.test(o.help), `${o.id}: a plain label`);
    assert.ok(o.help, `${o.id}: says what it is for`);
  });
  // every branch of the schema is reachable: a made item fits the branch it came from, or carries its marker
  toolBranches.forEach((branch) => {
    const kind = typeOf(branch);
    const option = tools.find((o) => {
      const made = o.make();
      return made && made.type === kind;
    });
    assert.ok(option, `the ${kind} branch can be added`);
  });
});

test('what the runtime can’t run yet says so on its card, and everything else doesn’t', () => {
  const flagged = tools
    .filter((o) => o.badge)
    .map((o) => o.id)
    .sort();
  assert.deepEqual(flagged, ['code', 'server'], 'task and keypad tools run now: only MCP servers and custom code are flagged');
  assert.ok(tools.filter((o) => o.badge).every((o) => /not available/i.test(o.badge)));
});

test('a made tool is the kind that was asked for, with a plain id and a description to start from', () => {
  const taken = ['end_call'];
  const list = pickerFor('tools', { engine, branches: toolBranches, takenIds: taken });
  const end = list.find((o) => o.id === 'end_call').make();
  assert.equal(end.type, 'builtin');
  assert.equal(end.builtin, 'end_call');
  assert.match(end.description, /goodbye/);
  assert.equal(end.id, 'end_call_1', 'the plain id was taken, so it is numbered');
  const hand = tools.find((o) => o.id === 'hand_over').make();
  assert.equal(hand.builtin, 'transfer_or_callback');
  assert.equal(hand.id, 'hand_over');
  const lookup = tools.find((o) => o.id === 'lookup').make();
  assert.equal(lookup.type, 'http');
  assert.equal(lookup.id, 'lookup');
  assert.equal(
    engine.fits(
      toolBranches.find((b) => typeOf(b) === 'builtin'),
      end,
    ),
    true,
    'a built-in tool fits the schema’s built-in branch',
  );
});

test('a kind the schema gains later is still offered, by the schema’s own name', () => {
  const extra = { title: 'Fax machine', type: 'object', required: ['id', 'type'], properties: { id: { type: 'string' }, type: { const: 'fax' } } };
  const list = pickerFor('tools', { engine, branches: [...toolBranches, extra] });
  const added = list.find((o) => o.label === 'Fax machine');
  assert.ok(added, 'offered');
  assert.equal(added.group, 'More');
  assert.equal(added.make().type, 'fax');
});

test('channels are offered as ways to be reached, grouped by voice and text, in the words of the Channels page’s switches', () => {
  const channels = pickerFor('channels', { engine, takenIds: ['phone'], botId: 'acme' });
  assert.deepEqual(
    channels.map((o) => o.label),
    ['Phone calls', 'Talk on your website', 'Chat on your website', 'WhatsApp', 'SMS', 'Email'],
  );
  assert.equal(channels[2].help, 'A chat box on your website that visitors type into.');
  assert.deepEqual(
    groupOptions(channels).map((g) => g.name),
    ['Voice', 'Text'],
  );
  const phone = channels[0].make();
  assert.equal(phone.type, 'sip_voice');
  assert.notEqual(phone.id, 'phone', 'the id is made unique');
  assert.equal(channels.find((o) => o.id === 'web_chat').make().entry.widget_id, 'acme-widget');
});

test('guardrail checks are offered as jobs for each side of the conversation, and a made one fits the schema', () => {
  const input = pickerFor('guardrails.input', { engine, branches: inputBranches });
  const output = pickerFor('guardrails.output', { engine, branches: outputBranches });
  assert.ok(input.some((o) => /Refuse tricks/.test(o.label)));
  assert.ok(output.some((o) => /Keep secret fields out/.test(o.label)));
  [...input, ...output].forEach((o) => {
    const made = o.make();
    const branch = [...inputBranches, ...outputBranches].find((b) => typeOf(b) === made.type);
    assert.ok(branch, `${o.id}: a branch for ${made.type}`);
    // a rule that needs something typed (patterns, a field name, the sentence) isn't complete yet, which is expected: only the required keys it HAS must fit
    const flat = engine.flatten(branch);
    Object.keys(made).forEach((key) => assert.ok(key in flat.properties, `${o.id}: ${key} is a property of ${made.type}`));
  });
  assert.equal(input.find((o) => o.id === 'pii').make().entities[0], 'card_number');
});

test('the cards can be searched and grouped', () => {
  assert.deepEqual(
    filterOptions(tools, 'hand over').map((o) => o.id),
    ['hand_over'],
  );
  assert.ok(filterOptions(tools, 'form').some((o) => o.id === 'show_form'));
  assert.deepEqual(filterOptions(tools, 'zzz'), []);
  assert.equal(filterOptions(tools, '   ').length, tools.length);
  assert.ok(filterOptions(tools, 'keypad').length >= 2, 'matches the group name too');
  const names = groupOptions(tools).map((g) => g.name);
  assert.equal(names[0], 'Pass the caller on');
  assert.equal(new Set(names).size, names.length);
});

// FRONTEND_GUIDE 2.md: pronunciation rules are added by what they do, and the schema's newest kind (a word list) is among them.
const ruleBranches = engine.branchesOf(engine.flatten(schema.$defs.pronunciationRule));
const rules = pickerFor('pronunciation', { engine, branches: ruleBranches });

test('every kind of pronunciation rule the schema has can be added from the cards, in plain words', () => {
  assert.equal(rules.length, ruleBranches.length, 'one card for each rule kind and nothing under “More”');
  assert.ok(rules.every((o) => o.group !== 'More'));
  const labels = rules.map((o) => o.label);
  ['Say certain words a certain way', 'Say amounts of money in words', 'Say times of day aloud'].forEach((label) => assert.ok(labels.includes(label), label));
  rules.forEach((o) => {
    const made = o.make();
    const flat = engine.flatten(ruleBranches.find((b) => typeOf(b) === made.type));
    Object.keys(made).forEach((key) => assert.ok(key in flat.properties, `${o.id}: ${key} is a property of ${made.type}`));
  });
  assert.equal(rules.find((o) => o.id === 'say_money').make().major_unit, 'dollars', 'a money rule starts with the words it needs');
  assert.deepEqual(
    filterOptions(rules, 'money').map((o) => o.id),
    ['say_money'],
  );
});

test('a pronunciation rule kind the schema adds later is still offered, by the schema’s own name', () => {
  const extra = { type: 'object', required: ['type'], properties: { type: { const: 'whisper' } } };
  const more = pickerFor('pronunciation', { engine, branches: [...ruleBranches, extra] });
  assert.equal(more.length, ruleBranches.length + 1);
  assert.equal(more[more.length - 1].group, 'More');
});

test('Add on the agent’s side does not offer a check the runtime does not run there (a prompt-injection check reads the caller’s words)', () => {
  const output = pickerFor('guardrails.output', { engine, branches: outputBranches });
  assert.equal(
    output.some((o) => o.label === 'Prompt-injection detector' || /prompt.injection/i.test(o.id)),
    false,
    output.map((o) => o.label).join(' | '),
  );
  const input = pickerFor('guardrails.input', { engine, branches: inputBranches });
  assert.ok(input.some((o) => o.label === 'Refuse tricks to change its instructions'));
});
