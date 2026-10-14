import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, actions, byLabel, byText, setupDom, teardownDom, textOf } from './component/dom.js';

// Component tests of the form renderer (Node.jsx and the editors it hands objects to): the real FormEditor is mounted in jsdom
// against the real schema, a person's clicks and typing are replayed, and the config that comes out is checked. They cover the
// things pure helper tests can't: switching between the kinds of a choice, editing nested lists, and keeping values safe while
// other parts of the config change.
const { mountForm, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const base = (extra = {}) => ({
  schema_version: '1.2',
  meta: { id: 'x', name: 'X', version: '0.1.0', status: 'draft' },
  persona: { name: 'X' },
  ...extra,
});
const complete = (extra = {}) => ({ id: 't1', type: 'http', connection: 'c', description: 'Gets the bill when asked', request: { method: 'GET', path: '/x' }, parameters: { type: 'object', properties: {} }, ...extra });
const connections = { c: { type: 'http', base_url: 'https://api.example.com' } };

async function open(config, group, chip) {
  const app = await mountForm(config);
  if (group) await a.click(byText(app.container, '.stFNavGroups [role=tab]', new RegExp(`^${group}`)));
  if (chip) await a.click(byText(app.container, '.stFChipBtn', new RegExp(`^${chip}`)));
  return app;
}
const optionValue = (select, text) => [...select.options].find((o) => o.text === text)?.value;

// ---------------------------------------------------------------- choices (oneOf)

test('choosing another kind of tool keeps its id and description, and drops what only the old kind has', async () => {
  const app = await open(base({ tools: [complete()], connections }), 'Conversation', 'Tools');
  const kind = byLabel(app.container, 'Kind');
  assert.equal(kind.options[kind.selectedIndex].text, 'HTTP');
  await a.choose(kind, optionValue(kind, 'Built-in'));
  let tool = app.config.tools[0];
  assert.equal(tool.type, 'builtin');
  assert.equal(tool.id, 't1');
  assert.equal(tool.description, 'Gets the bill when asked');
  assert.ok(!('request' in tool) && !('connection' in tool));
  assert.equal(byLabel(app.container, 'Kind').options[byLabel(app.container, 'Kind').selectedIndex].text, 'Built-in');
  await a.choose(byLabel(app.container, 'Kind'), optionValue(byLabel(app.container, 'Kind'), 'HTTP'));
  tool = app.config.tools[0];
  assert.equal(tool.type, 'http');
  assert.equal(tool.id, 't1');
  assert.equal(tool.description, 'Gets the bill when asked');
  await app.unmount();
});

test('an HTTP tool that lacks a required field still gets the tool editor, not raw JSON', async () => {
  const incomplete = complete();
  delete incomplete.parameters;
  const app = await open(base({ tools: [incomplete], connections }), 'Conversation', 'Tools');
  assert.ok($(app.container, '.stTool[data-tool-kind="http"]'), 'the HTTP tool editor is drawn');
  assert.doesNotMatch(textOf(app.container), /doesn’t match any known kind/);
  const kind = byLabel(app.container, 'Kind');
  assert.equal(kind.options[kind.selectedIndex].text, 'HTTP');
  assert.deepEqual(app.config.tools[0], incomplete, 'drawing it changed nothing');
  await app.unmount();
});

test('a value that matches no kind says so, and picking a kind recovers it without losing its id', async () => {
  const app = await open(base({ tools: [{ id: 'odd', type: 'wobble', note: 1 }] }), 'Conversation', 'Tools');
  assert.match(textOf(app.container), /doesn’t match any known kind/);
  const kind = byLabel(app.container, 'Kind');
  await a.choose(kind, optionValue(kind, 'Built-in'));
  assert.equal(app.config.tools[0].type, 'builtin');
  assert.equal(app.config.tools[0].id, 'odd');
  assert.doesNotMatch(textOf(app.container), /doesn’t match any known kind/);
  await app.unmount();
});

// ---------------------------------------------------------------- nested lists

test('a list of texts: edit one, add one, delete one, and Undo puts the list back', async () => {
  const app = await open(base({ persona: { name: 'X', style_rules: ['One', 'Two', 'Three'] } }), 'Basics', 'Persona');
  await a.type(byLabel(app.container, 'Item 2'), 'Deux');
  assert.deepEqual(app.config.persona.style_rules, ['One', 'Deux', 'Three']);
  await a.click(byText(app.container, 'button', '＋ Add'));
  assert.deepEqual(app.config.persona.style_rules, ['One', 'Deux', 'Three', '']);
  await a.type(byLabel(app.container, 'Item 4'), 'Four');
  await a.click(byLabel(app.container, 'Delete item 1'));
  assert.deepEqual(app.config.persona.style_rules, ['Deux', 'Three', 'Four']);
  assert.match(textOf($(app.container, '.stFToast')), /Deleted/);
  await a.click(byText($(app.container, '.stFToast'), 'button', 'Undo'));
  assert.deepEqual(app.config.persona.style_rules, ['One', 'Deux', 'Three', 'Four']);
  assert.equal($(app.container, '.stFToast'), null, 'the Undo bar goes away');
  await app.unmount();
});

test('a list of cards: reorder with the arrows, delete one, and the others keep their values', async () => {
  const messages = [{ id: 'm1', text: 'One' }, { id: 'm2', text: 'Two' }, { id: 'm3', text: 'Three' }];
  const app = await open(base({ messages }), 'Conversation', 'Messages');
  await a.click(byLabel(app.container, 'Move m1 down'));
  assert.deepEqual(app.config.messages.map((m) => m.id), ['m2', 'm1', 'm3']);
  await a.click(byLabel(app.container, 'Move m3 up'));
  assert.deepEqual(app.config.messages.map((m) => m.id), ['m2', 'm3', 'm1']);
  assert.equal(byLabel(app.container, 'Move m2 up').disabled, true, 'the first can’t move up');
  assert.equal(byLabel(app.container, 'Move m1 down').disabled, true, 'the last can’t move down');
  await a.click(byLabel(app.container, 'Delete m3'));
  assert.deepEqual(app.config.messages, [{ id: 'm2', text: 'Two' }, { id: 'm1', text: 'One' }]);
  await app.unmount();
});

test('a list of ids picked from another list: add and remove, never a duplicate', async () => {
  const config = base({
    tools: [{ id: 't1', type: 'builtin', builtin: 'end_call' }, { id: 't2', type: 'builtin', builtin: 'noop' }],
    agents: { entry: 'a', items: [{ id: 'a', name: 'A', instructions: { role: 'Help' }, tools: ['t1'] }] },
  });
  const app = await open(config, 'Conversation', 'Agents');
  const add = $$(app.container, 'select').find((el) => el.getAttribute('aria-label') === 'Add' && [...el.options].some((o) => o.text === 't2'));
  assert.deepEqual([...add.options].map((o) => o.text), ['＋ Add…', 't2'], 'what is already chosen is not offered again');
  await a.choose(add, 't2');
  assert.deepEqual(app.config.agents.items[0].tools, ['t1', 't2']);
  await a.click(byLabel(app.container, 'Delete t1'));
  assert.deepEqual(app.config.agents.items[0].tools, ['t2']);
  await app.unmount();
});

// ---------------------------------------------------------------- values survive other changes

test('editing one field keeps the others, fields the schema doesn’t know, and the order of keys', async () => {
  const config = base({ persona: { name: 'X', company: 'Acme', x_note: 'keep me' }, x_top: { deep: [1, 2] } });
  const app = await open(config, 'Basics', 'Persona');
  const name = $$(app.container, '.stFSection input').find((el) => el.value === 'X');
  await a.type(name, 'Sam');
  assert.deepEqual(app.config.persona, { name: 'Sam', company: 'Acme', x_note: 'keep me' });
  assert.deepEqual(Object.keys(app.config.persona), ['name', 'company', 'x_note']);
  assert.deepEqual(app.config.x_top, { deep: [1, 2] }, 'a section the form doesn’t draw is untouched');
  assert.deepEqual(app.config.meta, config.meta);
  await app.unmount();
});

test('what was typed is still there after visiting other sections and coming back', async () => {
  const app = await open(base({ messages: [{ id: 'm1', text: 'Hello' }] }), 'Basics', 'Persona');
  await a.type($$(app.container, '.stFSection input').find((el) => el.value === 'X'), 'Sam');
  await a.click(byText(app.container, '.stFChipBtn', /^Defaults/));
  await a.click(byText(app.container, '.stFNavGroups [role=tab]', /^Conversation/));
  await a.click(byText(app.container, '.stFChipBtn', /^Messages/));
  assert.equal(app.config.messages[0].text, 'Hello');
  await a.click(byText(app.container, '.stFNavGroups [role=tab]', /^Basics/));
  await a.click(byText(app.container, '.stFChipBtn', /^Persona/));
  assert.ok($$(app.container, '.stFSection input').some((el) => el.value === 'Sam'), 'the edit is shown again');
  assert.equal(app.config.persona.name, 'Sam');
  await app.unmount();
});

// ---------------------------------------------------------------- the effects editor

test('effects: add a rule, change its step, add a condition and a second step, reorder, delete', async () => {
  const app = await open(base({ tools: [complete()], connections, state: { variables: { done: { type: 'boolean', default: false } } } }), 'Conversation', 'Tools');
  assert.match(textOf($(app.container, '.stEffects')), /Nothing happens after this tool succeeds/);
  await a.click(byText(app.container, 'button', '＋ Add a rule'));
  assert.deepEqual(app.config.tools[0].effects, [{ do: [{ type: 'say', text: '' }] }]);
  assert.match(textOf($(app.container, '.stRule')), /Always: say/);

  const step = byLabel(app.container, 'Step 1 of rule 1: what to do');
  await a.choose(step, 'end_call');
  assert.equal(app.config.tools[0].effects[0].do[0].type, 'end_call');
  assert.match(textOf($(app.container, '.stRuleSentence')), /Always: end the call\./);

  await a.choose(byLabel(app.container, 'Add a step to rule 1'), 'set_state');
  assert.deepEqual(app.config.tools[0].effects[0].do.map((s) => s.type), ['end_call', 'set_state']);
  await a.click(byLabel(app.container, 'Move step 2 of rule 1 up'));
  assert.deepEqual(app.config.tools[0].effects[0].do.map((s) => s.type), ['set_state', 'end_call']);

  await a.click(byText(app.container, '.stRuleWhen button', 'Only when…'));
  assert.ok('when' in app.config.tools[0].effects[0], 'a condition was added');
  assert.deepEqual(Object.keys(app.config.tools[0].effects[0]), ['when', 'do']);
  assert.match(textOf($(app.container, '.stRuleSentence')), /^When /);
  await a.click(byText(app.container, '.stRuleWhen button', /Remove the condition/));
  assert.ok(!('when' in app.config.tools[0].effects[0]));

  await a.click(byLabel(app.container, 'Delete step 1 of rule 1'));
  assert.deepEqual(app.config.tools[0].effects[0].do.map((s) => s.type), ['end_call']);
  await a.click(byLabel(app.container, 'Delete rule 1'));
  assert.ok(!('effects' in app.config.tools[0]), 'with no rules left the key is gone');
  await a.click(byText($(app.container, '.stFToast'), 'button', 'Undo'));
  assert.equal(app.config.tools[0].effects.length, 1, 'Undo brings the rule back');
  await app.unmount();
});

// ---------------------------------------------------------------- the prompt preview

test('the prompt preview shows the pieces in order, built from the fields as they are now', async () => {
  const config = base({
    persona: { name: 'Sam', tone: 'warm' },
    state: { variables: { plan: { type: 'string', default: 'basic' } } },
    agents: { entry: 'a', items: [{ id: 'a', name: 'A', instructions: { role: 'Help with bills on the {{state.plan}} plan.', rules: ['Be brief.'] }, tools: [] }] },
  });
  const app = await open(config, 'Conversation', 'Agents');
  const details = $(app.container, '.stPromptPreview');
  assert.ok(details);
  assert.equal($(details, '.stPromptBody'), null, 'closed until asked for');
  await act(async () => { details.open = true; details.dispatchEvent(new window.Event('toggle')); });
  const sections = $$(details, '.stPromptSection').map((el) => el.getAttribute('data-section'));
  assert.deepEqual(sections, ['persona', 'role', 'rules']);
  assert.match(textOf($(details, '[data-section="role"] pre')), /Help with bills on the basic plan\./);
  assert.match(textOf(details), /approximate/i);
  assert.match(textOf($(details, '.stPromptTotal')), /words? that always apply/);
  // editing the role changes the preview
  const role = $$(app.container, 'textarea').find((el) => /Help with bills/.test(el.value));
  await a.type(role, 'Only greet.');
  assert.match(textOf($(app.container, '.stPromptPreview [data-section="role"] pre')), /^Only greet\.$/);
  await app.unmount();
});

// ---------------------------------------------------------------- steps wherever actions are asked for

test('an agent’s on-enter actions are numbered steps with a plain-language menu', async () => {
  const config = base({
    messages: [{ id: 'hi', text: 'Hi' }],
    agents: { entry: 'a', items: [{ id: 'a', name: 'A', instructions: { role: 'Help' }, tools: [], on_enter: [{ type: 'say', text: 'Welcome' }] }] },
  });
  const app = await open(config, 'Conversation', 'Agents');
  const step = byLabel(app.container, 'Step 1 of the list: what to do');
  assert.ok(step, 'the step has a kind menu');
  assert.equal(step.value, 'say');
  assert.deepEqual([...step.options].map((o) => o.text).slice(0, 3), ['Say a line', 'Say something the model writes', 'Change state']);
  assert.match(textOf($(app.container, '.stActionSentence')), /^Say “Welcome”$/);
  await a.choose(byLabel(app.container, 'Add a step to the list'), 'end_call');
  assert.deepEqual(app.config.agents.items[0].on_enter.map((s) => s.type), ['say', 'end_call']);
  await a.click(byLabel(app.container, 'Move step 2 of the list up'));
  assert.deepEqual(app.config.agents.items[0].on_enter.map((s) => s.type), ['end_call', 'say']);
  await a.choose(byLabel(app.container, 'Step 1 of the list: what to do'), 'handoff');
  assert.equal(app.config.agents.items[0].on_enter[0].type, 'handoff');
  assert.equal(app.config.agents.items[0].on_enter[1].text, 'Welcome', 'the other step is untouched');
  await app.unmount();
});

test('an event keeps its own fields and gets steps for what it does', async () => {
  const app = await open(base({ events: [{ on: 'call_started', do: [{ type: 'log', message: 'started' }] }] }), 'Rules and events', 'Events');
  assert.ok(byLabel(app.container, 'Step 1 of the list: what to do'));
  assert.equal(app.config.events[0].on, 'call_started');
  await a.click(byLabel(app.container, 'Delete step 1 of the list'));
  assert.deepEqual(app.config.events[0].do, [], 'the list is empty, and the card says a step is needed');
  assert.match(textOf(app.container), /Needs at least one step/);
  await app.unmount();
});

// ---------------------------------------------------------------- every section draws, with the notes the API's guide asks for

import { readFileSync } from 'node:fs';
import { createEngine } from '../src/studio/form/engine.js';

test('every section of a full configuration draws without breaking, and the sections that wait on the runtime say so', async () => {
  const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
  const engine = createEngine(schema);
  const example = JSON.parse(readFileSync(new URL('./fixtures/agent-config.example.json', import.meta.url), 'utf8'));
  const config = { ...example, schema_version: '1.2' };
  if (!Array.isArray(config.tasks) || !config.tasks.length) config.tasks = [{ ...engine.defaultFor(schema.properties.tasks.items), id: 'activate' }];
  const app = await mountForm(config);
  const seen = [];
  for (const group of $$(app.container, '.stFNavGroups [role=tab]')) {
    await a.click(group);
    for (const chip of $$(app.container, '.stFChipBtn')) {
      await a.click(chip);
      const name = textOf(chip).replace(/\d+$/, '').trim();
      seen.push(name);
      assert.ok($(app.container, '.stFSection'), `${name}: the section is drawn`);
      assert.ok(textOf($(app.container, '.stFSectionHead')).length > 0, `${name}: it has a heading`);
      const notes = $$(app.container, '.stFSectionNote').map(textOf).join(' ');
      if (/^Tests/.test(name)) assert.match(notes, /not run by anything yet/);
      if (/^Tasks/.test(name)) assert.match(notes, /does not run tasks/);
      if (/^Telephony/.test(name)) assert.match(notes, /not connected from the studio yet/);
    }
  }
  ['Meta', 'Persona', 'Defaults', 'Channels', 'Agents', 'Tasks', 'Tools', 'Messages', 'State', 'Connections', 'Telephony', 'Guardrails', 'Events', 'Tests'].forEach((name) => assert.ok(seen.some((s) => s.startsWith(name)), `${name} was visited`));
  assert.deepEqual(app.config, config, 'looking at everything changed nothing');
  await app.unmount();
});
