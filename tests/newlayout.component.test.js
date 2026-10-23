import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, actions, byText, setupDom, teardownDom, textOf } from './component/dom.js';
import { applyStarter } from '../src/studio/starters.js';
import { minimalConfig } from '../src/demo/demoApi.js';
import { humanize } from '../src/studio/newlayout/rowNames.js';

// The pages of the new layout, mounted in jsdom with a config in state: the Agent page (text on the page, choices in panels that work on a copy), a list page
// (rows, a picker to add, a panel for one item), the Home checklist and the menu. Clicks and typing are replayed and the config that comes out is read back.
const { mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const agent = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const until = async (app, check, tries = 100) => {
  for (let i = 0; i < tries && !check(); i += 1) await app.wait(60);
  return check();
};
const drawer = () => $(document.body, '.nlDrawer');
const TOOL_LISTS = [
  { id: 'tools', path: ['tools'], kind: 'tools', word: 'tool', pickerKey: 'tools', empty: { title: 'No tools yet', text: 'Tools let the agent do things.' } },
];

test('the menu is in the order of the work, the current page marked, with a number where something is to fix', async () => {
  const app = await mountScreen('agentnav', agent(), { ready: '.nlNav', props: { page: 'tools', counts: { agent: 2 }, dots: { tests: true } } });
  assert.deepEqual($$(app.container, '.nlNavHead').map(textOf), ['Build', 'Test and launch', 'Monitor']);
  assert.deepEqual(
    $$(app.container, '.nlNav button').map((b) => b.getAttribute('data-page')),
    [
      'home',
      'agent',
      'knowledge',
      'tools',
      'workflow',
      'channels',
      'guardrails',
      'aftercall',
      'tests',
      'releases',
      'calls',
      'monitoring',
      'questions',
      'speed',
      'settings',
    ],
  );
  assert.equal($$(app.container, '.nlNav button[aria-current="page"]').length, 1);
  assert.equal($(app.container, '.nlNav button[aria-current="page"]').getAttribute('data-page'), 'tools');
  assert.equal(textOf($(app.container, '.nlNav button[data-page="agent"] .nlNavCount')), '2');
  assert.ok($(app.container, '.nlNav button[data-page="tests"] .nlNavDot'), 'a running test is marked');
  await app.unmount();
});

test('the Agent page: the text is on the page, the choices are rows, and a change on the page goes straight into the draft', async () => {
  const app = await mountScreen('agentpage', agent(), { ready: '.nlPage' });
  assert.deepEqual($$(app.container, '.nlSection h2').map(textOf), [
    'Name',
    'What it should do',
    'What it says first',
    'How it sounds',
    'What it runs on',
    'More',
  ]);
  assert.deepEqual($$(app.container, '.nlRow strong').map(textOf), [
    'Voice',
    'Language',
    'Tone and style',
    'AI models',
    'Personality and rules',
    'Fixed lines',
  ]);
  const nameInput = $(app.container, 'input[aria-label="Agent name"]');
  assert.ok(nameInput, 'the name is a field on the page');
  await a.type(nameInput, 'Renamed agent');
  assert.equal(app.config.meta.name, 'Renamed agent');
  await app.unmount();
});

test('a panel works on a copy: Cancel and Escape leave the draft alone, Done puts the change in', async () => {
  const app = await mountScreen('agentpage', agent(), { ready: '.nlPage' });
  const before = app.config.persona?.tone;
  await a.click(byText(app.container, '.nlRow', /^Tone and style/));
  assert.ok(drawer(), 'the panel opens');
  assert.equal(textOf($(drawer(), '.nlDrawerHead h2')), 'Tone and style');
  await a.type($(drawer(), 'input[aria-label="Tone"]'), 'curt and formal');
  assert.equal(app.config.persona?.tone, before, 'nothing has gone into the draft yet');
  await a.click(byText(drawer(), 'button', 'Cancel'));
  assert.equal(drawer(), null, 'Cancel closes it');
  assert.equal(app.config.persona?.tone, before, 'and the draft is as it was');
  await a.click(byText(app.container, '.nlRow', /^Tone and style/));
  await a.type($(drawer(), 'input[aria-label="Tone"]'), 'curt and formal');
  await act(async () => {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await app.wait(50);
  assert.equal(drawer(), null, 'Escape closes it');
  assert.equal(app.config.persona?.tone, before, 'and the draft is still as it was');
  await a.click(byText(app.container, '.nlRow', /^Tone and style/));
  await a.type($(drawer(), 'input[aria-label="Tone"]'), 'curt and formal');
  await a.click(byText(drawer(), 'button', 'Done'));
  assert.equal(drawer(), null);
  assert.equal(app.config.persona.tone, 'curt and formal', 'Done puts the change into the draft');
  assert.match(textOf(byText(app.container, '.nlRow', /^Tone and style/)), /curt and formal/, 'and the row shows it');
  await app.unmount();
});

test('a panel keeps the keyboard: it goes to the close button, and back to the row when the panel closes', async () => {
  const app = await mountScreen('agentpage', agent(), { ready: '.nlPage' });
  const row = byText(app.container, '.nlRow', /^Language/);
  row.focus();
  await a.click(row);
  assert.equal(document.activeElement, $(drawer(), '.nlDrawerClose'));
  await a.click($(drawer(), '.nlDrawerClose'));
  assert.equal(document.activeElement, row);
  await app.unmount();
});

test('a list page shows each item as a row, says what is used or not, and has one place to add', async () => {
  const app = await mountScreen('listpage', agent(), { ready: '.nlPage', props: { lists: TOOL_LISTS } });
  assert.equal(await until(app, () => $$(app.container, '.nlRow').length >= 2), true, 'a row for each tool');
  assert.ok($(app.container, '.nlPageActions .stAddBtn'), 'one Add, in the page header');
  assert.equal($$(app.container, '.nlPageActions .stAddBtn').length, 1);
  // a readable name; the tooltip has what the row says in full (a narrow row cuts it short) and the id. A tool a switch above stands for says so.
  // With one agent, no "used by" (it is that agent's), and an unused tool says so
  const first = app.config.tools[0];
  assert.equal(textOf($(app.container, '.nlRow strong')), humanize(first.id));
  assert.equal($(app.container, '.nlRow small').textContent, 'Ends the call · switched on above');
  assert.equal($(app.container, '.nlRow').getAttribute('title'), `Ends the call · switched on above\nId: ${first.id}`);
  assert.doesNotMatch(textOf($(app.container, '.nlRow')), /used by/i);
  await app.unmount();
});

test('with several agents, a tool row says which use it, by name', async () => {
  const config = agent();
  const toolId = config.tools[0].id;
  config.agents.items.push({ id: 'billing', name: 'Billing desk', instructions: { role: 'You answer billing questions.' }, tools: [toolId] });
  const app = await mountScreen('listpage', config, { ready: '.nlPage', props: { lists: TOOL_LISTS } });
  assert.equal(await until(app, () => $$(app.container, '.nlRow').length >= 2), true);
  assert.match(textOf($(app.container, '.nlRow')), /used by .*Billing desk/);
  await app.unmount();
});

test('a list page opens one item in a panel, and its edits wait for Done', async () => {
  const app = await mountScreen('listpage', agent(), { ready: '.nlPage', props: { lists: TOOL_LISTS } });
  assert.equal(await until(app, () => $$(app.container, '.nlRow').length >= 2), true);
  const first = app.config.tools[0];
  await a.click($$(app.container, '.nlRow')[0]);
  assert.match(textOf($(drawer(), '.nlDrawerHead h2')), new RegExp(humanize(first.id)), 'the panel is named as the row is');
  assert.equal(await until(app, () => !!$(drawer(), 'textarea')), true, 'the item’s own settings load');
  await a.type($(drawer(), 'textarea'), 'A new description for this tool.');
  assert.equal(app.config.tools[0].description, first.description, 'not in the draft yet');
  await a.click(byText(drawer(), 'button', 'Done'));
  assert.equal(app.config.tools[0].description, 'A new description for this tool.');
  assert.equal(app.config.tools.length, 2, 'and nothing else changed');
  await app.unmount();
});

test('adding picks a kind, opens a new item in a panel, and Cancel adds nothing while Done does', async () => {
  const app = await mountScreen('listpage', agent(), { ready: '.nlPage', props: { lists: TOOL_LISTS } });
  assert.equal(await until(app, () => !!$(app.container, '.nlPageActions .stAddBtn')), true);
  const before = app.config.tools.length;
  await a.click($(app.container, '.nlPageActions .stAddBtn'));
  const dialog = $(document.body, '.stPickDialog[role="dialog"]');
  assert.ok(dialog, 'the choices open in a window over the page');
  assert.equal($(app.container, '.stPickPanel'), null, 'not in place, where they would push the page down');
  assert.match(textOf($(dialog, 'h2')), /^Add a tool/);
  assert.ok($$(dialog, '.stPickCard .stPickIcon').length >= 9, 'each choice has its picture');
  await a.click($(document.body, '.stPickCard[data-option="rules_only"]'));
  assert.equal($(document.body, '.stPickDialog'), null, 'the window closes once one is picked');
  assert.match(textOf($(drawer(), '.nlDrawerHead h2')), /^New tool/);
  await a.click(byText(drawer(), 'button', 'Cancel'));
  assert.equal(app.config.tools.length, before, 'Cancel adds nothing');
  await a.click($(app.container, '.nlPageActions .stAddBtn'));
  await a.click($(document.body, '.stPickCard[data-option="rules_only"]'));
  await a.click(byText(drawer(), 'button', 'Done'));
  assert.equal(app.config.tools.length, before + 1, 'Done adds it');
  assert.equal(new Set(app.config.tools.map((t) => t.id)).size, before + 1, 'with an id of its own');
  await app.unmount();
});

test('a kind an agent needs only one of (ending the call) opens the one it has, rather than adding a second that nothing would use', async () => {
  const app = await mountScreen('listpage', agent(), { ready: '.nlPage', props: { lists: TOOL_LISTS } });
  assert.equal(await until(app, () => !!$(app.container, '.nlPageActions .stAddBtn')), true);
  const before = app.config.tools.length;
  await a.click($(app.container, '.nlPageActions .stAddBtn'));
  assert.match(textOf($(document.body, '.stPickCard[data-option="end_call"]')), /It has one already/);
  await a.click($(document.body, '.stPickCard[data-option="end_call"]'));
  assert.match(textOf($(drawer(), '.nlDrawerHead h2')), /^Tool “End call”/, 'its own panel opens');
  await a.click(byText(drawer(), 'button', 'Close'));
  assert.equal(app.config.tools.length, before, 'and nothing is added');
  await app.unmount();
});

test('a new tool is given to the agent that answers first, and its panel asks which agents can use it', async () => {
  const app = await mountScreen('listpage', agent(), { ready: '.nlPage', props: { lists: TOOL_LISTS } });
  assert.equal(await until(app, () => !!$(app.container, '.nlPageActions .stAddBtn')), true);
  await a.click($(app.container, '.nlPageActions .stAddBtn'));
  await a.click($(document.body, '.stPickCard[data-option="rules_only"]'));
  const box = $(drawer(), '.nlToolAgents input[type=checkbox]');
  assert.ok(box && box.checked, 'ticked for the agent that answers');
  await a.click(byText(drawer(), 'button', 'Done'));
  const made = app.config.tools.at(-1).id;
  assert.ok(app.config.agents.items[0].tools.includes(made), 'and in the draft, it can use it');
  await app.unmount();
});

test('the choices window keeps the keyboard: Escape closes it alone (not a panel behind it) and the keyboard goes back to Add', async () => {
  const app = await mountScreen('listpage', agent(), { ready: '.nlPage', props: { lists: TOOL_LISTS } });
  assert.equal(await until(app, () => !!$(app.container, '.nlPageActions .stAddBtn')), true);
  const add = $(app.container, '.nlPageActions .stAddBtn');
  await a.click(add);
  const dialog = $(document.body, '.stPickDialog');
  assert.equal(document.activeElement, $(dialog, 'input[type=search]'), 'the search takes the keyboard');
  let reached = 0;
  const behind = () => {
    reached += 1;
  };
  document.addEventListener('keydown', behind);
  await act(async () => {
    document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  });
  assert.ok(document.activeElement.classList.contains('stPickCard'), 'the arrow keys go on to the cards');
  await act(async () => {
    document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 30));
  });
  document.removeEventListener('keydown', behind);
  assert.equal($(document.body, '.stPickDialog'), null, 'Escape closes the window');
  assert.equal(reached, 0, 'no key reaches what is behind it, so a panel there stays open');
  assert.equal(document.activeElement, add, 'and the keyboard is back on Add');
  await app.unmount();
});

test('deleting an item from its panel removes it and closes the panel, and Cancel afterwards is not needed', async () => {
  const app = await mountScreen('listpage', agent(), { ready: '.nlPage', props: { lists: TOOL_LISTS } });
  assert.equal(await until(app, () => $$(app.container, '.nlRow').length >= 2), true);
  await a.click($(app.container, '.nlPageActions .stAddBtn'));
  await a.click($(document.body, '.stPickCard[data-option="rules_only"]'));
  await a.click(byText(drawer(), 'button', 'Done'));
  const added = app.config.tools.length;
  await a.click($$(app.container, '.nlRow')[added - 1]);
  assert.equal(await until(app, () => !!byText(drawer(), 'button', /Delete this tool/)), true);
  await a.click(byText(drawer(), 'button', /Delete this tool/));
  // the agent offers it (a new tool is given to the agent that answers), so it asks first
  assert.equal(await until(app, () => !!byText(document.body, 'button', 'Delete and remove those references')), true);
  await a.click(byText(document.body, 'button', 'Delete and remove those references'));
  assert.equal(await until(app, () => app.config.tools.length === added - 1), true, 'the tool is gone from the draft');
  assert.ok(!app.config.agents.items[0].tools.some((t) => !app.config.tools.some((x) => x.id === t)), 'and from the agent’s tools');
  assert.equal(await until(app, () => !drawer()), true, 'and the panel has closed');
  // and it can be put back
  assert.equal(await until(app, () => !!byText(app.container, 'button', 'Undo')), true, 'an Undo is offered');
  await a.click(byText(app.container, 'button', 'Undo'));
  assert.equal(app.config.tools.length, added, 'Undo puts it back');
  await app.unmount();
});

test('an empty list says so in one sentence, with the one way to add', async () => {
  const config = { ...agent(), tools: [] };
  const app = await mountScreen('listpage', config, { ready: '.nlPage', props: { lists: TOOL_LISTS } });
  assert.equal(textOf($(app.container, '.nlEmpty strong')), 'No tools yet');
  assert.ok($(app.container, '.nlPageActions .stAddBtn'));
  await app.unmount();
});

test('the Home checklist names the next step, and a step that is done reads as done', async () => {
  const app = await mountScreen('homepage', agent(), { ready: '.nlPage', props: { summary: {} } });
  const steps = $$(app.container, '.nlSteps li');
  assert.ok(steps.length >= 6);
  assert.equal(steps.filter((s) => s.className.includes('next')).length, 1, 'exactly one is the next step');
  assert.ok($(app.container, '.nlSteps li[data-step="prompt"][data-state="done"]'), 'the starter has instructions');
  assert.match(textOf($(app.container, '.nlSection h2')), /Getting it ready/);
  await app.unmount();
});

test('while the agent is not ready, the menu says how far along it is and opens the next step; a page with a step to do is marked', async () => {
  const steps = [
    { id: 'prompt', label: 'Say what it should do', state: 'done', page: 'agent' },
    { id: 'voice', label: 'Pick its language', state: 'todo', page: 'agent', target: { open: 'language' } },
    { id: 'publish', label: 'Publish a version', state: 'todo', page: 'releases' },
    { id: 'abilities', label: 'Give it tools', state: 'optional', page: 'tools' },
  ];
  const opened = [];
  const plan = { steps, next: steps[1], done: 1, total: 3 };
  const app = await mountScreen('agentnav', agent(), { ready: '.nlNav', props: { page: 'home', plan, onStep: (step) => opened.push(step.id) } });
  const card = $(app.container, '.nlSetup');
  assert.match(textOf(card), /Getting it ready\s*1 of 3/);
  assert.match(textOf(card), /Next: Pick its language/);
  assert.equal($(app.container, '.nlSetupBar').getAttribute('aria-valuenow'), '1');
  await a.click(card);
  assert.deepEqual(opened, ['voice'], 'the card opens the next step');
  assert.ok($(app.container, '.nlNav button[data-page="agent"] .nlNavTodo'), 'a step to do on the Agent page');
  assert.ok($(app.container, '.nlNav button[data-page="releases"] .nlNavTodo'));
  assert.ok(!$(app.container, '.nlNav button[data-page="tools"] .nlNavTodo'), 'an optional step is not marked');
  await app.unmount();
  const ready = await mountScreen('agentnav', agent(), { ready: '.nlNav', props: { page: 'home', plan: { steps: [], next: null, done: 3, total: 3 } } });
  assert.equal($(ready.container, '.nlSetup'), null, 'a ready agent has no progress card');
  await ready.unmount();
});

test('the top bar: Publish is the main action, Save shows only when there is something to save, problems show as a chip, the rest is in More', async () => {
  const opened = [];
  const app = await mountScreen('topbar', agent(), { ready: '.nlBar', props: { problems: 0, changes: 3, onChanges: () => opened.push('changes') } });
  const buttons = () => $$(app.container, '.nlBarActions > button:not(.stMenuBtn)').map(textOf);
  assert.deepEqual(buttons(), ['Describe', 'Test', 'Publish'], 'saved: no Save button, no chip');
  assert.ok($(app.container, '.nlBarActions .primaryCta') && textOf($(app.container, '.nlBarActions .primaryCta')) === 'Publish');
  await a.click(byText(app.container, '.nlChanges', /3 changes not published/));
  assert.deepEqual(opened, ['changes']);
  await a.click($(app.container, '.nlBarActions .stMenuBtn'));
  const more = $$(document.body, '.stMenu [role="menuitem"]').map(textOf);
  ['Run the checks', 'What changed since publishing (3)', 'Share…', 'Publish a new version…', 'Deploy a version…', 'Roll back…', 'All versions'].forEach(
    (item) => assert.ok(more.includes(item), `${item} is in More`),
  );
  await app.unmount();

  const dirty = await mountScreen('topbar', agent(), { ready: '.nlBar', props: { dirty: true, problems: 2 } });
  assert.deepEqual($$(dirty.container, '.nlBarActions > button:not(.stMenuBtn)').map(textOf), ['2 problems', 'Describe', 'Test', 'Save', 'Publish']);
  assert.equal(textOf($(dirty.container, '.nlBarActions .primaryCta')), 'Save', 'with unsaved edits Save is the main action');
  assert.match(textOf($(dirty.container, '.nlSaveState')), /Unsaved changes/);
  await dirty.unmount();

  const testing = await mountScreen('topbar', agent(), { ready: '.nlBar', props: { testOpen: true } });
  assert.equal(byText(testing.container, '.nlBarActions button', 'Test').getAttribute('aria-pressed'), 'true', 'Test shows the panel is open');
  await testing.unmount();
});

test('the agent switcher lists the other agents and opens one on the same page; it also leads to all agents and to creating one', async () => {
  window.location.hash = '#/bots/a/tools';
  const bots = [
    { id: 'a', name: 'Acme', deployed: { staging: '0.1.0' } },
    { id: 'b', name: 'Bookings', deployed: {} },
  ];
  const app = await mountScreen('agentswitch', agent(), { ready: '.agentSwitch', props: { bots, tab: 'tools' } });
  assert.match(textOf($(app.container, '.agentSwitchButton')), /Acme\s*Live in Staging/);
  await a.click($(app.container, '.agentSwitchButton'));
  const items = $$(app.container, '.agentSwitchMenu [role="menuitem"]').map(textOf);
  assert.deepEqual(items, ['BBookingsDraft', 'All agents', 'Create an agent']);
  await a.click($$(app.container, '.agentSwitchMenu [role="menuitem"]')[0]);
  assert.equal(window.location.hash, '#/bots/b/tools', 'the same page of the other agent');
  assert.equal($(app.container, '.agentSwitchMenu'), null, 'and the list closes');
  await app.unmount();
});
