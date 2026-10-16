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
const complete = (extra = {}) => ({
  id: 't1',
  type: 'http',
  connection: 'c',
  description: 'Gets the bill when asked',
  request: { method: 'GET', path: '/x' },
  parameters: { type: 'object', properties: {} },
  ...extra,
});
const connections = { c: { type: 'http', base_url: 'https://api.example.com' } };

// Opens the form on a screen, named by its id (layout.js): 'tools', 'persona', 'defaults.models'…
async function open(config, screen) {
  const app = await mountForm(config);
  if (screen) await a.section(app.container, screen);
  return app;
}
const optionValue = (select, text) => [...select.options].find((o) => o.text === text)?.value;

// ---------------------------------------------------------------- choices (oneOf)

test('choosing another kind of tool keeps its id and description, and drops what only the old kind has', async () => {
  const app = await open(base({ tools: [complete()], connections }), 'tools');
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
  const app = await open(base({ tools: [incomplete], connections }), 'tools');
  assert.ok($(app.container, '.stTool[data-tool-kind="http"]'), 'the HTTP tool editor is drawn');
  assert.doesNotMatch(textOf(app.container), /doesn’t match any known kind/);
  const kind = byLabel(app.container, 'Kind');
  assert.equal(kind.options[kind.selectedIndex].text, 'HTTP');
  assert.deepEqual(app.config.tools[0], incomplete, 'drawing it changed nothing');
  await app.unmount();
});

test('an optional part that isn’t set (the direct delivery of a response) is not drawn as a missing required field', async () => {
  const app = await open(base({ tools: [complete()], connections }), 'tools');
  const block = $(app.container, '[data-path$="out_of_band"]');
  assert.ok(block, 'the optional direct delivery is offered');
  assert.doesNotMatch(textOf(block), /required, not set/);
  assert.doesNotMatch(block.className, /missing/);
  assert.match(textOf(block), /Set sent straight to the caller/i);
  // and when something really is required and absent, it still says so
  const app2 = await open(base({ agents: { items: [{ id: 'a', name: 'A', kind: 'standalone', instructions: { role: 'Help.' } }] } }), 'agents');
  assert.match(textOf(app2.container), /required, not set/);
  await app.unmount();
  await app2.unmount();
});

test('a voice channel on an agent with no speech models offers “Add default speech models”, once, and one click sets both', async () => {
  const phone = {
    id: 'phone',
    type: 'sip_voice',
    enabled: true,
    entry: { dnis: '+6561234567' },
    modalities: { input: ['audio'], output: ['audio'] },
    greeting: { say: 'Hi' },
  };
  const app = await open(base({ channels: [phone] }), 'channels');
  const notes = $(app.container, '.stChannelNotes');
  assert.ok(notes);
  assert.match(textOf(notes), /Audio in needs a speech-to-text model/);
  assert.match(textOf(notes), /Audio out needs a text-to-speech model/);
  const buttons = $$(notes, 'button').filter((b) => /Add default speech models/.test(textOf(b)));
  assert.equal(buttons.length, 1, 'one button for both notes');
  await a.click(buttons[0]);
  const models = app.config.defaults.models;
  assert.ok(models.stt.provider && models.stt.model, 'listening is set');
  assert.ok(models.tts.provider && models.tts.model, 'speaking is set');
  assert.equal(
    $(app.container, '.stChannelNotes') && /needs a speech-to-text/.test(textOf($(app.container, '.stChannelNotes'))),
    false,
    'the warnings are gone',
  );
  assert.match(textOf($(app.container, '.stFToast')), /Added default speech models/);
  await app.unmount();
});

test('a long list of tools can be searched, filtered by kind and narrowed to the unused, and each card says who uses it', async () => {
  const tools = Array.from({ length: 12 }, (_, i) => ({
    id: `lookup_${i}`,
    type: 'http',
    connection: 'c',
    description: `Gets record ${i} for the caller`,
    request: { method: 'GET', path: `/r/${i}` },
    parameters: { type: 'object', properties: {} },
  }));
  tools.push({ id: 'end_call', type: 'builtin', builtin: 'end_call', description: 'Ends it', params: { say: 'Bye' } });
  const config = base({
    tools,
    connections,
    agents: { entry: 'a', items: [{ id: 'a', name: 'A', instructions: { role: 'Help.' }, tools: ['lookup_0', 'lookup_1', 'end_call'] }] },
  });
  const app = await open(config, 'tools');
  const titles = () => $$(app.container, '.stFCards > .stFGroup .stFGroupToggle strong').map(textOf);
  assert.equal(titles().length, 13);
  assert.match(textOf($$(app.container, '.stFCards > .stFGroup')[0]), /used by a/, 'a card says which agent uses the tool');
  assert.match(textOf($$(app.container, '.stFCards > .stFGroup')[5]), /not used by any agent/);
  await a.type(byLabel(app.container, 'Find a tool'), 'record 7');
  assert.deepEqual(titles(), ['lookup_7']);
  assert.match(textOf($(app.container, '.stFFind [role=status]')), /Showing 1 of 13/);
  await a.type(byLabel(app.container, 'Find a tool'), 'zzz');
  assert.equal(titles().length, 0);
  assert.match(textOf($(app.container, '.stFFind [role=status]')), /Nothing matches/);
  await a.type(byLabel(app.container, 'Find a tool'), '');
  await a.click(byText($(app.container, '.stFFindKinds'), 'button', /^Built-in/));
  assert.deepEqual(titles(), ['end_call']);
  await a.click(byText($(app.container, '.stFFindKinds'), 'button', /^All/));
  await a.check($(app.container, '.stFFindUnused input'));
  assert.equal(titles().length, 10, '13 tools, 3 used: 10 are not');
  assert.ok(!titles().includes('lookup_0'));
  // deleting from the filtered list deletes the right tool, not the one at that position
  await a.type(byLabel(app.container, 'Find a tool'), 'record 5');
  window.confirm = () => true;
  await a.click(byLabel(app.container, 'Delete lookup_5'));
  assert.ok(!app.config.tools.some((t) => t.id === 'lookup_5') && app.config.tools.length === 12, 'lookup_5 was removed and nothing else');
  await app.unmount();
});

test('a value that matches no kind says so, and picking a kind recovers it without losing its id', async () => {
  const app = await open(base({ tools: [{ id: 'odd', type: 'wobble', note: 1 }] }), 'tools');
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
  const app = await open(base({ persona: { name: 'X', style_rules: ['One', 'Two', 'Three'] } }), 'persona');
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
  const messages = [
    { id: 'm1', text: 'One' },
    { id: 'm2', text: 'Two' },
    { id: 'm3', text: 'Three' },
  ];
  const app = await open(base({ messages }), 'messages');
  await a.click(byLabel(app.container, 'Move m1 down'));
  assert.deepEqual(
    app.config.messages.map((m) => m.id),
    ['m2', 'm1', 'm3'],
  );
  await a.click(byLabel(app.container, 'Move m3 up'));
  assert.deepEqual(
    app.config.messages.map((m) => m.id),
    ['m2', 'm3', 'm1'],
  );
  assert.equal(byLabel(app.container, 'Move m2 up').disabled, true, 'the first can’t move up');
  assert.equal(byLabel(app.container, 'Move m1 down').disabled, true, 'the last can’t move down');
  await a.click(byLabel(app.container, 'Delete m3'));
  assert.deepEqual(app.config.messages, [
    { id: 'm2', text: 'Two' },
    { id: 'm1', text: 'One' },
  ]);
  await app.unmount();
});

test('a list of ids picked from another list: add and remove, never a duplicate', async () => {
  const config = base({
    tools: [
      { id: 't1', type: 'builtin', builtin: 'end_call' },
      { id: 't2', type: 'builtin', builtin: 'noop' },
    ],
    agents: { entry: 'a', items: [{ id: 'a', name: 'A', instructions: { role: 'Help' }, tools: ['t1'] }] },
  });
  const app = await open(config, 'agents');
  const add = $$(app.container, 'select').find((el) => el.getAttribute('aria-label') === 'Add' && [...el.options].some((o) => o.text === 't2'));
  assert.deepEqual(
    [...add.options].map((o) => o.text),
    ['＋ Add…', 't2'],
    'what is already chosen is not offered again',
  );
  await a.choose(add, 't2');
  assert.deepEqual(app.config.agents.items[0].tools, ['t1', 't2']);
  await a.click(byLabel(app.container, 'Delete t1'));
  assert.deepEqual(app.config.agents.items[0].tools, ['t2']);
  await app.unmount();
});

// ---------------------------------------------------------------- values survive other changes

test('editing one field keeps the others, fields the schema doesn’t know, and the order of keys', async () => {
  const config = base({ persona: { name: 'X', company: 'Acme', x_note: 'keep me' }, x_top: { deep: [1, 2] } });
  const app = await open(config, 'persona');
  const name = $$(app.container, '.stFSection input').find((el) => el.value === 'X');
  await a.type(name, 'Sam');
  assert.deepEqual(app.config.persona, { name: 'Sam', company: 'Acme', x_note: 'keep me' });
  assert.deepEqual(Object.keys(app.config.persona), ['name', 'company', 'x_note']);
  assert.deepEqual(app.config.x_top, { deep: [1, 2] }, 'a section the form doesn’t draw is untouched');
  assert.deepEqual(app.config.meta, config.meta);
  await app.unmount();
});

test('what was typed is still there after visiting other sections and coming back', async () => {
  const app = await open(base({ messages: [{ id: 'm1', text: 'Hello' }] }), 'persona');
  await a.type(
    $$(app.container, '.stFSection input').find((el) => el.value === 'X'),
    'Sam',
  );
  await a.section(app.container, 'defaults.language');
  await a.section(app.container, 'messages');
  assert.equal(app.config.messages[0].text, 'Hello');
  await a.section(app.container, 'persona');
  assert.ok(
    $$(app.container, '.stFSection input').some((el) => el.value === 'Sam'),
    'the edit is shown again',
  );
  assert.equal(app.config.persona.name, 'Sam');
  await app.unmount();
});

// ---------------------------------------------------------------- the effects editor

test('effects: add a rule, change its step, add a condition and a second step, reorder, delete', async () => {
  const app = await open(base({ tools: [complete()], connections, state: { variables: { done: { type: 'boolean', default: false } } } }), 'tools');
  assert.match(textOf($(app.container, '.stEffects')), /Nothing happens after this tool succeeds/);
  await a.click(byText(app.container, 'button', '＋ Add a rule'));
  assert.deepEqual(app.config.tools[0].effects, [{ do: [{ type: 'say', text: '' }] }]);
  assert.match(textOf($(app.container, '.stRule')), /Always: say/);

  const step = byLabel(app.container, 'Step 1 of rule 1: what to do');
  await a.choose(step, 'end_call');
  assert.equal(app.config.tools[0].effects[0].do[0].type, 'end_call');
  assert.match(textOf($(app.container, '.stRuleSentence')), /Always: end the call\./);

  await a.choose(byLabel(app.container, 'Add a step to rule 1'), 'set_state');
  assert.deepEqual(
    app.config.tools[0].effects[0].do.map((s) => s.type),
    ['end_call', 'set_state'],
  );
  await a.click(byLabel(app.container, 'Move step 2 of rule 1 up'));
  assert.deepEqual(
    app.config.tools[0].effects[0].do.map((s) => s.type),
    ['set_state', 'end_call'],
  );

  await a.click(byText(app.container, '.stRuleWhen button', 'Only when…'));
  assert.ok('when' in app.config.tools[0].effects[0], 'a condition was added');
  assert.deepEqual(Object.keys(app.config.tools[0].effects[0]), ['when', 'do']);
  assert.match(textOf($(app.container, '.stRuleSentence')), /^When /);
  await a.click(byText(app.container, '.stRuleWhen button', /Remove the condition/));
  assert.ok(!('when' in app.config.tools[0].effects[0]));

  await a.click(byLabel(app.container, 'Delete step 1 of rule 1'));
  assert.deepEqual(
    app.config.tools[0].effects[0].do.map((s) => s.type),
    ['end_call'],
  );
  await a.click(byLabel(app.container, 'Delete rule 1'));
  assert.ok(!('effects' in app.config.tools[0]), 'with no rules left the key is gone');
  await a.click(byText($(app.container, '.stFToast'), 'button', 'Undo'));
  assert.equal(app.config.tools[0].effects.length, 1, 'Undo brings the rule back');
  await app.unmount();
});

// ---------------------------------------------------------------- the prompt preview

const promptConfig = () =>
  base({
    persona: { name: 'Sam', tone: 'warm' },
    state: { variables: { plan: { type: 'string', default: 'basic' }, verified: { type: 'boolean', default: false } } },
    channels: [
      { id: 'web-chat', type: 'web_chat', enabled: true },
      { id: 'phone', type: 'sip_voice', enabled: true },
    ],
    agents: {
      entry: 'a',
      items: [{ id: 'a', name: 'A', instructions: { role: 'Help with bills on the {{state.plan}} plan.', rules: ['Be brief.'] }, tools: [] }],
    },
  });
const openPrompt = async (app) => {
  const details = $(app.container, '.stPromptPreview');
  assert.ok(details);
  assert.equal($(details, '.stPromptBody'), null, 'closed until asked for');
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new window.Event('toggle'));
  });
  return details;
};

test('the prompt preview asks the server: its exact text, which blocks are in now, how big it is, and advice', async () => {
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/preview/prompt')) {
      asked.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({
          instructions: 'You are Sam.\n\nHelp with bills on the basic plan.',
          opening: 'Say hi once.',
          greeting: 'Hello from Sam',
          sections: [
            { kind: 'persona', label: 'Who the agent is', text: 'You are Sam.', active: true },
            { kind: 'role', label: 'Its role', text: 'Help with bills on the basic plan.', active: true },
            { kind: 'conditional', label: 'After hours', text: 'It is closed.', active: false, when: 'the office is closed' },
          ],
          tools: [
            { name: 'lookup', description: 'Looks things up', offered: true },
            { name: 'run_code', description: 'Runs code', offered: false, reason: 'custom code tools can’t run yet' },
          ],
          stats: { words: 2100, approx_tokens: 2800, tools_offered: 18 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return real(url, init);
  };
  try {
    const app = await open(promptConfig(), 'agents');
    const details = await openPrompt(app);
    await app.wait(700);
    assert.match(textOf($(details, 'summary')), /exact/);
    assert.deepEqual(
      $$(details, '.stPromptSection[data-section]')
        .map((el) => el.getAttribute('data-section'))
        .slice(0, 3),
      ['persona', 'role', 'conditional'],
    );
    assert.match(textOf($(details, '[data-section="role"] pre')), /Help with bills on the basic plan\./);
    assert.match(textOf($(details, '[data-section="conditional"] header')), /not in right now · only the office is closed/);
    assert.match(textOf($(details, '[data-section="role"] header')), /in the prompt/);
    assert.match(textOf($(details, '.stPromptTotal')), /2,100 words · about 2,800 tokens · 18 tools offered/);
    assert.ok(
      $(details, '[data-advice="long"]') && $(details, '[data-advice="tools"]') && $(details, '[data-advice="dropped"]'),
      'too long, too many tools, a tool dropped',
    );
    assert.match(textOf($(details, '[data-advice="dropped"]')), /run_code \(custom code tools can’t run yet\)/);
    assert.match(textOf(details), /Greeting: Hello from Sam/);
    assert.equal($(details, '.stPromptExact pre').textContent, 'You are Sam.\n\nHelp with bills on the basic plan.');
    assert.equal(asked.length, 1);
    assert.equal(asked[0].agent, 'a');
    assert.equal(asked[0].config.agents.items[0].id, 'a', 'what is in the editor is sent');
    assert.ok(!('channel' in asked[0]) && !('state' in asked[0]) && !('now' in asked[0]), 'only what was chosen is sent');
    // "Preview as…": a channel, a what-if value and a time are sent, and Reset clears them
    await a.choose(byLabel(details, 'Preview on channel'), 'phone');
    await a.choose(byLabel(details, 'What if verified were'), 'true');
    await a.type(byLabel(details, 'What if plan were'), 'pro');
    await a.type(byLabel(details, 'Pretend it is this time'), '2026-10-14T03:00');
    await app.wait(700);
    const last = asked[asked.length - 1];
    assert.equal(last.channel, 'phone');
    assert.deepEqual(last.state, { verified: true, plan: 'pro' });
    assert.match(last.now, /^2026-10-14T03:00:00[+-]\d{2}:\d{2}$/);
    await a.click(byText(details, 'button', 'Reset'));
    await app.wait(700);
    assert.ok(!('state' in asked[asked.length - 1]));
    await app.unmount();
  } finally {
    globalThis.fetch = real;
  }
});

test('when the server can’t be asked, the prompt preview is built here, labelled approximate, and still follows the fields', async () => {
  const app = await open(promptConfig(), 'agents');
  const details = await openPrompt(app);
  await app.wait(700);
  assert.match(textOf($(details, 'summary')), /approximate/);
  assert.match(textOf(details), /couldn’t be asked/);
  const sections = $$(details, '.stPromptSection').map((el) => el.getAttribute('data-section'));
  assert.deepEqual(sections, ['persona', 'role', 'rules']);
  assert.match(textOf($(details, '[data-section="role"] pre')), /Help with bills on the basic plan\./);
  // editing the role changes the preview
  const role = $$(app.container, 'textarea').find((el) => /Help with bills/.test(el.value));
  await a.type(role, 'Only greet.');
  await app.wait(700);
  assert.match(textOf($(app.container, '.stPromptPreview [data-section="role"] pre')), /^Only greet\.$/);
  await app.unmount();
});

// ---------------------------------------------------------------- steps wherever actions are asked for

test('an agent’s on-enter actions are numbered steps with a plain-language menu', async () => {
  const config = base({
    messages: [{ id: 'hi', text: 'Hi' }],
    agents: { entry: 'a', items: [{ id: 'a', name: 'A', instructions: { role: 'Help' }, tools: [], on_enter: [{ type: 'say', text: 'Welcome' }] }] },
  });
  const app = await open(config, 'agents');
  const step = byLabel(app.container, 'Step 1 of the list: what to do');
  assert.ok(step, 'the step has a kind menu');
  assert.equal(step.getAttribute('role'), 'combobox', 'more than eight kinds of step: a searchable list, not a long dropdown');
  assert.equal(step.value, 'Say a line', 'it shows the kind in words');
  assert.deepEqual((await a.options(step)).slice(0, 3), ['Say a line', 'Say something the model writes', 'Change state']);
  assert.match(textOf($(app.container, '.stActionSentence')), /^Say “Welcome”$/);
  await a.choose(byLabel(app.container, 'Add a step to the list'), 'end_call');
  assert.deepEqual(
    app.config.agents.items[0].on_enter.map((s) => s.type),
    ['say', 'end_call'],
  );
  await a.click(byLabel(app.container, 'Move step 2 of the list up'));
  assert.deepEqual(
    app.config.agents.items[0].on_enter.map((s) => s.type),
    ['end_call', 'say'],
  );
  await a.choose(byLabel(app.container, 'Step 1 of the list: what to do'), 'handoff');
  assert.equal(app.config.agents.items[0].on_enter[0].type, 'handoff');
  assert.equal(app.config.agents.items[0].on_enter[1].text, 'Welcome', 'the other step is untouched');
  await app.unmount();
});

test('an event keeps its own fields and gets steps for what it does', async () => {
  const app = await open(base({ events: [{ on: 'call_started', do: [{ type: 'log', message: 'started' }] }] }), 'events');
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
      const name = chip.getAttribute('data-section');
      seen.push(name);
      assert.ok($(app.container, '.stFSection'), `${name}: the section is drawn`);
      assert.ok(textOf($(app.container, '.stFSectionHead')).length > 0, `${name}: it has a heading`);
      const notes = $$(app.container, '.stFSectionNote').map(textOf).join(' ');
      if (name === 'tests') assert.match(notes, /Scenarios tab writes and runs them/);
      if (name === 'tasks') assert.match(notes, /Try this task/);
      if (name === 'tasks') assert.doesNotMatch(notes, /does not run tasks|no effect on a call/, 'the runtime runs tasks now: no sentence says it does not');
      if (name === 'telephony') assert.match(notes, /set up under Telephony/);
    }
  }
  [
    'meta',
    'persona',
    'defaults.language',
    'defaults.models',
    'defaults.conversation',
    'channels',
    'agents',
    'tasks',
    'tools',
    'messages',
    'state',
    'connections',
    'telephony',
    'guardrails',
    'events',
    'tests',
  ].forEach((name) => assert.ok(seen.includes(name), `${name} was visited`));
  assert.deepEqual(app.config, config, 'looking at everything changed nothing');
  await app.unmount();
});

// ---------------------------------------------------------------- the add pickers
test('adding a tool is a choice of jobs: search, pick, and the tool is in the draft with the right kind', async () => {
  const app = await open(base({ tools: [] }), 'tools');
  assert.equal($(app.container, '.stPickPanel'), null, 'the cards are closed until asked for');
  await a.click(byText(app.container, 'button.stAddBtn', /^＋ Add a tool/));
  const panel = $(app.container, '.stPickPanel');
  assert.ok(panel, 'the cards opened in place');
  assert.ok($$(panel, '.stPickCard').length >= 9, 'every kind is a card');
  assert.match(textOf(panel), /Hand over to a person/);
  assert.match(textOf(byText(panel, '.stPickCard', /^Run your own code/)), /Not available in the runtime yet/);
  await a.type($(panel, 'input[type=search]'), 'hand over');
  assert.deepEqual(
    $$(app.container, '.stPickCard').map((c) => c.getAttribute('data-option')),
    ['hand_over'],
  );
  await a.type($(panel, 'input[type=search]'), 'zzz');
  assert.match(textOf($(app.container, '.stPickPanel')), /Nothing matches “zzz”/);
  await a.type($(app.container, '.stPickPanel input[type=search]'), '');
  await a.click($(app.container, '.stPickCard[data-option="end_call"]'));
  assert.equal($(app.container, '.stPickPanel'), null, 'the cards close once one is picked');
  assert.equal(app.config.tools.length, 1);
  assert.deepEqual(
    { id: app.config.tools[0].id, type: app.config.tools[0].type, builtin: app.config.tools[0].builtin },
    { id: 'end_call', type: 'builtin', builtin: 'end_call' },
  );
  await app.unmount();
});

test('adding a voice channel asks whether callers should be told they may be recorded, once, and a click writes the notice', async () => {
  const app = await open(base({ channels: [], persona: { name: 'X' } }), 'channels');
  await a.click(byText(app.container, 'button.stAddBtn', /^＋ Add a channel/));
  await a.click($(app.container, '.stPickCard[data-option="phone"]'));
  assert.equal(app.config.channels.length, 1);
  assert.equal(app.config.channels[0].type, 'sip_voice');
  const offer = $(app.container, '.stFOffer');
  assert.ok(offer, 'the question is asked');
  assert.match(textOf(offer), /Tell callers they may be recorded/);
  await a.click(byText(offer, 'button', 'Add a notice'));
  assert.match(app.config.persona.disclosures.recording_notice, /may be recorded/);
  assert.equal($(app.container, '.stFOffer'), null, 'and it is not asked again');
  await app.unmount();
});

test('a text channel does not ask about recording, and “Not now” leaves the notice unset', async () => {
  const app = await open(base({ channels: [], persona: { name: 'X' } }), 'channels');
  await a.click(byText(app.container, 'button.stAddBtn', /^＋ Add a channel/));
  await a.click($(app.container, '.stPickCard[data-option="web_chat"]'));
  assert.equal($(app.container, '.stFOffer'), null, 'chat is not a recorded call');
  await a.click(byText(app.container, 'button.stAddBtn', /^＋ Add a channel/));
  await a.click($(app.container, '.stPickCard[data-option="web_voice"]'));
  assert.ok($(app.container, '.stFOffer'));
  await a.click(byText($(app.container, '.stFOffer'), 'button', 'Not now'));
  assert.equal($(app.container, '.stFOffer'), null);
  assert.equal(app.config.persona.disclosures, undefined, 'nothing was written');
  await app.unmount();
});

test('a voice channel does not ask when callers are already told', async () => {
  const app = await open(base({ channels: [], persona: { name: 'X', disclosures: { recording_notice: 'Calls are recorded.' } } }), 'channels');
  await a.click(byText(app.container, 'button.stAddBtn', /^＋ Add a channel/));
  await a.click($(app.container, '.stPickCard[data-option="phone"]'));
  assert.equal($(app.container, '.stFOffer'), null);
  await app.unmount();
});

test('the picker closes on Escape and the arrow keys move between the cards', async () => {
  const app = await open(base({ tools: [] }), 'tools');
  await a.click(byText(app.container, 'button.stAddBtn', /^＋ Add a tool/));
  const first = $(app.container, '.stPickCard');
  first.focus();
  await act(async () => {
    first.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  });
  assert.notEqual(window.document.activeElement, first, 'focus moved to the next card');
  assert.ok(window.document.activeElement.classList.contains('stPickCard'));
  await act(async () => {
    window.document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
  assert.equal($(app.container, '.stPickPanel'), null);
  await app.unmount();
});

// ---------------------------------------------------------------- the rest of the server's previews (guide section 10.1)

test('the prompt preview also shows what runs on taking over, what is searched, the models and secret names, what is remembered (masked) and each tool’s parameters; a caller’s number can be pretended', async () => {
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/preview/prompt')) {
      asked.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({
          instructions: 'You are Sam.',
          sections: [{ kind: 'persona', label: 'Who the agent is', text: 'You are Sam.', active: true }],
          on_enter: [{ type: 'say', text: 'Welcome back' }],
          knowledge: { before_each_reply: [{ base: 'faq', top_k: 3 }], tools: [{ tool: 'search_help', base: 'faq' }] },
          models: { llm: { provider: 'openai', model: 'gpt-4.1-mini', api_key: { secret: 'OPENAI_API_KEY' } } },
          state: { verified: false, pin: '•••' },
          tools: [
            {
              name: 'lookup',
              description: 'Looks things up',
              offered: true,
              parameters: { type: 'object', properties: { order_id: { type: 'string' }, days: { type: 'integer' } }, required: ['order_id'] },
            },
          ],
          stats: { words: 3, approx_tokens: 4, tools_offered: 1 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return real(url, init);
  };
  try {
    const app = await open(promptConfig(), 'agents');
    const details = await openPrompt(app);
    await app.wait(700);
    assert.match(textOf($(details, '[data-extra="on_enter"]')), /What runs when it takes over \(1\).*Welcome back/);
    const knowledge = textOf($(details, '[data-extra="knowledge"]'));
    assert.match(knowledge, /Searched before every reply.*faq \(top k 3\)/);
    assert.match(knowledge, /Searched when the model asks.*search_help \(base faq\)/);
    const models = textOf($(details, '[data-extra="models"]'));
    assert.match(models, /Thinking.*openai gpt-4\.1-mini.*uses the secret OPENAI_API_KEY/);
    assert.match(models, /never their values/);
    assert.equal($$(details, '[data-extra="state"] dd')[1].classList.contains('masked'), true, 'a sensitive value stays masked');
    assert.match(textOf($(details, '[data-extra="state"]')), /hidden: it is sensitive/);
    assert.match(textOf($(details, '[data-extra="parameters"]')), /lookup takes order_id string \*\s*days integer/);
    // a caller's number is a what-if too
    assert.ok(!('caller_phone' in asked[0]));
    await a.type(byLabel(details, 'Pretend the caller’s number is'), '+91 98765 43210');
    await app.wait(700);
    assert.equal(asked[asked.length - 1].caller_phone, '+91 98765 43210');
    await a.click(byText(details, 'button', 'Reset'));
    await app.wait(700);
    assert.ok(!('caller_phone' in asked[asked.length - 1]), 'Reset clears it');
    await app.unmount();
  } finally {
    globalThis.fetch = real;
  }
});

test('a tool’s Try it takes the same what-ifs (channel, time, state), sends them, and shows the request’s headers', async () => {
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/preview/result')) {
      asked.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({
          request: {
            method: 'GET',
            url: 'https://api.example.com/x',
            query: {},
            headers: { 'X-Trace': 'abc' },
            body: null,
            auth: { type: 'none', secrets: [] },
          },
          preconditions: { holds: true, message: '' },
          args_problems: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return real(url, init);
  };
  try {
    const config = base({
      connections,
      tools: [complete()],
      state: { variables: { verified: { type: 'boolean', default: false } } },
      channels: [
        { id: 'web-chat', type: 'web_chat', enabled: true },
        { id: 'phone', type: 'sip_voice', enabled: true },
      ],
    });
    const app = await open(config, 'tools');
    const fold = $$(app.container, 'details.stFold.sample')[0];
    assert.ok(fold, 'the sample fold');
    await act(async () => {
      fold.open = true;
      fold.dispatchEvent(new window.Event('toggle'));
    });
    await app.wait(700);
    assert.match(textOf($(fold, '[data-block="request"]')), /headers.*X-Trace/, 'the request’s headers are shown');
    assert.ok(
      !('state' in asked[asked.length - 1]) && !('channel' in asked[asked.length - 1]) && !('now' in asked[asked.length - 1]),
      'nothing chosen, nothing sent',
    );
    await a.choose(byLabel(fold, 'Preview on channel'), 'phone');
    await a.choose(byLabel(fold, 'What if verified were'), 'true');
    await a.type(byLabel(fold, 'Pretend it is this time'), '2026-10-14T03:00');
    await app.wait(700);
    const last = asked[asked.length - 1];
    assert.equal(last.channel, 'phone');
    assert.deepEqual(last.state, { verified: true });
    assert.match(last.now, /^2026-10-14T03:00:00[+-]\d{2}:\d{2}$/);
    assert.equal(byLabel(fold, 'Pretend the caller’s number is'), null, 'a tool has no caller’s number to pretend');
    await app.unmount();
  } finally {
    globalThis.fetch = real;
  }
});
