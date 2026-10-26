import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { $, $$, actions, byLabel, byText, setupDom, teardownDom, textOf } from './component/dom.js';
import { applyStarter } from '../src/studio/starters.ts';
import { minimalConfig } from '../src/demo/demoApi.js';
import * as ops from '../src/studio/workflow/workflowOps.js';

// The Workflow tab, mounted in jsdom with a draft in state: blocks are selected, added from the ＋ menu, edited in the panel, moved with the keyboard and
// taken away again, and the draft that comes out is read back. (Dragging with a mouse needs real layout; that is covered in e2e/workflow.mjs.)
const { mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const agent = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const example = () => JSON.parse(readFileSync(new URL('./fixtures/agent-config.example.json', import.meta.url), 'utf8'));
const mount = (config = agent()) => mountScreen('workflow', config, { ready: '.wfTab' });
const node = (app, id) => $$(app.container, '.wfNode').find((el) => el.dataset.node === id);
// a block is selected by a click on it (pressed and let go without moving)
const press = async (el) => {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 5, clientY: 5 }));
    el.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 5, clientY: 5 }));
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, button: 0, clientX: 5, clientY: 5 }));
  });
};
const key = async (el, k, shift = false) => {
  await act(async () => {
    el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true }));
  });
};
const plus = (app) => $$(app.container, '.wfPlus')[0];
// a part of the panel opens on the press of the mouse, as the browser's own tabs do
const openTab = async (app, name) => {
  const tab = $$(app.container, '.wfInspector [role=tab]').find((el) => textOf(el) === name);
  if (!tab) throw new Error(`no tab ${name}`);
  await act(async () => {
    tab.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  });
};
const menuItem = (app, name) => $$(app.container, '.wfMenu [role=menuitem]').find((el) => new RegExp(`^${name}`).test(textOf(el)));

test('the Workflow shows where a call starts, the agent, and what it can do, each block named for a screen reader', async () => {
  const app = await mount();
  const triggers = $$(app.container, '.wfNode[data-type=trigger]');
  assert.equal(triggers.length, app.config.channels.length, 'each channel is where a call comes in');
  assert.match(triggers[0].getAttribute('aria-label'), /: where a call comes in/);
  const agentNode = $$(app.container, '.wfNode[data-type=agent]');
  assert.equal(agentNode.length, 1);
  assert.match(agentNode[0].getAttribute('aria-label'), /subagent, answers first/);
  assert.ok(node(app, `${agentNode[0].dataset.node}::model`), 'its AI model is plugged in under it');
  assert.deepEqual($$(app.container, '.wfPort span').map(textOf), ['Model', 'Knowledge', 'Tools'], 'with a connector for each kind of plug-in');
  assert.equal(agentNode[0].getAttribute('role'), 'button');
  assert.equal(agentNode[0].getAttribute('aria-pressed'), 'false');
  assert.ok($(app.container, '.wfInspector'), 'with nothing selected the panel says how to use the picture');
  assert.match(textOf($(app.container, '.wfInspector')), /Using the picture/);
  assert.ok(byLabel(app.container, 'Zoom in') && byLabel(app.container, 'Zoom out') && byLabel(app.container, 'Fit to the window'));
  await app.unmount();
});

test('selecting an agent opens its panel; the name, kind and role are written to the draft as they are typed', async () => {
  const app = await mount();
  const id = app.config.agents.items[0].id;
  await press(node(app, id));
  assert.equal(node(app, id).getAttribute('aria-pressed'), 'true');
  assert.equal(textOf($(app.container, '.wfInspector header small')), 'Subagent', 'every agent of the workflow is a subagent (the agents are the workspace’s)');
  assert.deepEqual($$(app.container, '.wfInspector [role=tab]').map(textOf), ['General', 'Knowledge base', 'Tools', 'Tests', 'Edges'], 'its parts, as tabs');
  await a.type($(app.container, `.wfInspector input[id$="-name"]`), 'Front desk');
  assert.equal(app.config.agents.items[0].name, 'Front desk');
  assert.match(node(app, id).getAttribute('aria-label'), /^Front desk,/);
  await a.choose($(app.container, '.wfInspector .rxSelect[id$="-kind"]'), 'router');
  assert.equal(app.config.agents.items[0].kind, 'router');
  await a.type($(app.container, '.wfInspector textarea[id$="-role"]'), 'Greet the caller and find out what they need.');
  assert.equal(app.config.agents.items[0].instructions.role, 'Greet the caller and find out what they need.');
  await key(node(app, id), 'Enter');
  await app.unmount();
});

test('the ⊕ at the end of a subagent opens Add a step, in groups, with a search; Subagent adds a real subagent, links it, and selects it', async () => {
  const app = await mount();
  const first = app.config.agents.items[0].id;
  await press(node(app, first));
  assert.equal($$(app.container, '.wfMenu').length, 0, 'closed until asked');
  await a.click(plus(app));
  assert.deepEqual($$(app.container, '.wfAddGroup h4').map(textOf), ['Subagents', 'Your agents', 'A person', 'As it takes over', 'Tools', 'Ending']);
  const names = $$(app.container, '.wfMenu [role=menuitem] strong').map(textOf);
  assert.ok(['Subagent', 'Phone number transfer', 'Say', 'Update state', 'End'].every((n) => names.includes(n)));
  assert.ok(!names.some((n) => /^Pass the caller to/.test(n)), 'with one subagent there is no other to pass the caller to');
  await a.type(byLabel(app.container, 'Search steps'), 'update');
  assert.deepEqual($$(app.container, '.wfMenu [role=menuitem] strong').map(textOf), ['Update state'], 'the search finds a step in any group');
  await a.type(byLabel(app.container, 'Search steps'), '');
  await a.click(menuItem(app, 'Subagent'));
  // its name and when it takes over are asked first, so nothing is left with stand-in words
  const pane = $(app.container, '.wfMenu form');
  await a.click(byText(pane, 'button', 'Add the subagent'));
  assert.equal(app.config.agents.items.length, 1, 'not added without a name and when');
  assert.match(textOf(pane), /Give it a name, and say when callers go to it/);
  const [name, when] = $$(pane, 'input');
  await a.type(name, 'Billing');
  await a.type(when, 'The caller asks about a bill');
  await a.click(byText(pane, 'button', 'Add the subagent'));
  assert.equal(app.config.agents.items.length, 2);
  const added = app.config.agents.items[1];
  assert.equal(added.name, 'Billing');
  assert.equal(app.config.agents.items[0].handoffs[0].to, added.id);
  assert.equal(app.config.agents.items[0].handoffs[0].when ?? app.config.agents.items[0].handoffs[0].description, 'The caller asks about a bill');
  assert.equal(node(app, added.id).getAttribute('aria-pressed'), 'true', 'the new block is the one selected');
  assert.equal($$(app.container, '.wfMenu').length, 0, 'the menu closes');
  assert.match($(app.container, '[role=status]').textContent, /Added Billing/);
  await app.unmount();
});

test('Say, Update state (with a new variable), a phone number (checked first), a tool and the end of the call are added to the agent', async () => {
  const config = agent();
  config.tools = [...(config.tools || []), { id: 'lookup', type: 'http', description: 'Look something up.' }];
  const app = await mount(config);
  const id = app.config.agents.items[0].id;
  const open = async () => {
    await press(node(app, id));
    await a.click(plus(app));
  };

  await open();
  await a.click(menuItem(app, 'Say'));
  await a.type($(app.container, '.wfInspector textarea'), 'Welcome back!');
  assert.deepEqual(app.config.agents.items[0].on_enter, [{ type: 'say', text: 'Welcome back!' }]);

  await open();
  await a.click(menuItem(app, 'Update state'));
  await a.click(byText(app.container, 'button', 'New variable'));
  await a.type(byLabel(app.container, 'Variable name'), 'caller_intent');
  await a.click(byText(app.container, 'button', 'Add it'));
  await a.type(byLabel(app.container, 'Value of caller_intent'), 'billing');
  assert.deepEqual(app.config.agents.items[0].on_enter[1], { type: 'set_state', values: { caller_intent: 'billing' } });
  assert.ok(app.config.state.variables.caller_intent);

  const transfersBefore = (app.config.telephony?.transfers || []).length;
  await open();
  await a.click(menuItem(app, 'Phone number transfer'));
  await a.click(byText(app.container, 'button', 'Add the transfer'));
  assert.match(textOf($(app.container, '.wfMenu')), /Type a number/, 'an empty number is refused with help');
  assert.equal((app.config.telephony?.transfers || []).length, transfersBefore, 'nothing is added without a number');
  await a.type($(app.container, '.wfMenu input[type=tel]'), '+1 800 555 0100');
  await a.click(byText(app.container, 'button', 'Add the transfer'));
  const transfer = app.config.telephony.transfers.at(-1);
  assert.equal(transfer.target, '+1 800 555 0100');
  assert.ok(app.config.agents.items[0].tools.some((t) => app.config.tools.find((x) => x.id === t)?.params?.transfer === transfer.id));

  await open();
  await a.click($$(app.container, '.wfMenu [role=menuitem]').find((el) => /Lookup/.test(textOf(el))));
  assert.ok(app.config.agents.items[0].tools.includes('lookup'));

  await open();
  await a.click(menuItem(app, 'End'));
  assert.ok(app.config.agents.items[0].tools.some((t) => app.config.tools.find((x) => x.id === t)?.builtin === 'end_call'));
  await open();
  assert.equal(menuItem(app, 'End').disabled, true, 'it can already end the call');
  await key($(app.container, '.wfMenu'), 'Escape');
  assert.equal($$(app.container, '.wfMenu').length, 0, 'Escape closes the menu');
  await app.unmount();
});

test('Subagent transfer lists the other subagents and links to the one chosen; an arrow can then be selected and say when it is taken', async () => {
  const app = await mount(example());
  await press(node(app, 'billing'));
  await a.click(plus(app));
  assert.deepEqual(
    $$(app.container, '.wfMenu [role=menuitem] strong')
      .map(textOf)
      .filter((t) => /^Pass the caller to/.test(t)),
    ['Pass the caller to Front Door', 'Pass the caller to Technical Support', 'Pass the caller to Live Safety Watch'],
  );
  await a.click($$(app.container, '.wfMenu [role=menuitem]').find((el) => /Live Safety Watch/.test(textOf(el))));
  const billing = app.config.agents.items.find((x) => x.id === 'billing');
  assert.equal(billing.handoffs.at(-1).to, 'safety_watch');
  assert.match($(app.container, '.wfInspector > header').textContent, /Billing → Live Safety Watch/, 'the new arrow is selected');
  await a.type($(app.container, '.wfInspector textarea[id$="-when"]'), 'The caller reports a fault while talking about a bill.');
  assert.equal(app.config.agents.items.find((x) => x.id === 'billing').handoffs.at(-1).description, 'The caller reports a fault while talking about a bill.');
  await app.unmount();
});

test('blocks are moved with the arrow keys (Shift further), the place is kept in the draft, Tidy up forgets it, and Undo and Redo walk through it all', async () => {
  const config = agent();
  const app = await mount(config);
  const id = app.config.agents.items[0].id;
  await press(node(app, id));
  const el = () => node(app, id);
  assert.equal(app.config.builder, undefined, 'nothing placed by hand yet');
  await key(el(), 'ArrowRight');
  const first = app.config.builder.ui.graph_positions[id];
  await key(el(), 'ArrowDown', true);
  const second = app.config.builder.ui.graph_positions[id];
  assert.deepEqual([second.x - first.x, second.y - first.y], [0, 32]);
  await a.click(byLabel(app.container, 'Tidy up'));
  assert.equal(app.config.builder, undefined, 'the saved places go, and the empty parts with them');
  await a.click(byLabel(app.container, 'Undo'));
  assert.ok(app.config.builder.ui.graph_positions[id]);
  await a.click(byLabel(app.container, 'Redo'));
  assert.equal(app.config.builder, undefined);
  await app.unmount();
});

test('deleting: a step goes at once, an agent only after it is asked, and the last agent cannot go', async () => {
  const app = await mount(example());
  const greeter = app.config.agents.items.find((x) => x.id === 'greeter');
  assert.ok(greeter.tools.includes('end_call'));
  await press(node(app, 'greeter::tool::end_call'));
  await a.click(byLabel(app.container, 'Delete End'));
  assert.ok(!app.config.agents.items.find((x) => x.id === 'greeter').tools.includes('end_call'), 'the agent can no longer end the call');

  await press(node(app, 'billing'));
  await a.click(byLabel(app.container, 'Delete Billing'));
  assert.ok(
    app.config.agents.items.some((x) => x.id === 'billing'),
    'asked first',
  );
  assert.ok($(app.container, '[role=alertdialog]'));
  await a.click(byText($(app.container, '[role=alertdialog]'), 'button', 'Cancel'));
  assert.ok(app.config.agents.items.some((x) => x.id === 'billing'));
  await a.click(byLabel(app.container, 'Delete Billing'));
  await a.click(byText($(app.container, '[role=alertdialog]'), 'button', 'Delete'));
  assert.ok(!app.config.agents.items.some((x) => x.id === 'billing'));
  assert.ok(!app.config.agents.items.find((x) => x.id === 'greeter').handoffs.some((h) => h.to === 'billing'), 'the hand-over to it went too');
  await a.click(byLabel(app.container, 'Undo'));
  assert.ok(
    app.config.agents.items.some((x) => x.id === 'billing'),
    'Undo brings the agent back',
  );
  await app.unmount();

  const lone = await mount();
  await press(node(lone, lone.config.agents.items[0].id));
  assert.equal(byText($(lone.container, '.wfInspector'), 'button', /Delete this subagent/).disabled, true);
  await lone.unmount();
});

test('with no agents there is one thing to do: add the first', async () => {
  const config = agent();
  config.agents = { entry: '', items: [] };
  const app = await mount(config);
  assert.match(textOf($(app.container, '.wfEmpty')), /No subagents yet/);
  await a.click(byText(app.container, 'button', /Add the first subagent/));
  assert.equal(app.config.agents.items.length, 1);
  assert.equal(app.config.agents.entry, app.config.agents.items[0].id);
  await app.unmount();
});

test('the picture is also a list, for anyone who cannot use it: the call step by step, beside it while nothing is selected', async () => {
  const app = await mount(example());
  const items = $$(app.container, '.wfSteps li').map(textOf);
  assert.ok(items.includes('Phone calls: Front Door answers.'));
  assert.ok(items.some((s) => /^Front Door hands the caller to Billing/.test(s)));
  await app.unmount();
});

test('every block says where it lives in the configuration, shows that JSON as it is now (it follows what is typed), and can be opened in its settings or the file', async () => {
  const app = await mount(example());
  await press(node(app, 'billing'));
  const where = $(app.container, '.wfWhere');
  assert.match(textOf(where), /agents\.items\[1\]/);
  const code = () => JSON.parse($(where, '.wfCode pre').textContent);
  assert.equal(code().name, 'Billing');
  await a.type($(app.container, '.wfInspector input[id$="-name"]'), 'Billing desk');
  assert.equal(
    JSON.parse($(app.container, '.wfWhere .wfCode pre').textContent).name,
    'Billing desk',
    'a change made here is in the JSON shown, and in the draft',
  );
  assert.equal(app.config.agents.items[1].name, 'Billing desk');
  assert.ok(byText($(app.container, '.wfWhere'), 'button', 'Open its settings') && byText($(app.container, '.wfWhere'), 'button', 'Open in JSON'));
  await press(node(app, 'greeter::tool::end_call'));
  assert.match(textOf($(app.container, '.wfWhere')), /tools\[\d+\]/);
  await app.unmount();
});

// ---- the mouse: dragging a block (by exactly what the pointer moved, at the zoom), the blocks that go with it, a press that hardly moves, the edges of the
// picture, the empty space, the overview and drawing an arrow from one agent to another are measured in a real browser: e2e/workflow.mjs (React Flow
// needs real layout and real pointer events)

test('a tool block’s panel changes what it says and when it is used, in place (the same tool as on the Tools page, where the rest of its settings are)', async () => {
  const config = agent();
  const shown = [];
  const app = await mountScreen('workflow', config, { ready: '.wfTab', props: { onShowSetting: (path) => shown.push(path) } });
  const entry = app.config.agents.items[0];
  const endId = entry.tools.find((t) => app.config.tools.find((x) => x.id === t)?.builtin === 'end_call');
  assert.ok(endId, 'the starter can end the call');
  const index = app.config.tools.findIndex((t) => t.id === endId);
  const tool = () => app.config.tools[index];
  await press(node(app, `${entry.id}::tool::${endId}`));
  const panel = () => $(app.container, '.wfInspector');
  const [goodbye, when] = $$(panel(), 'textarea');
  assert.equal(goodbye.id.endsWith('-goodbye') && when.id.endsWith('-when'), true, 'what it says before it hangs up, then when it uses it');
  assert.equal(when.value, tool().description || '');
  await a.type(when, 'When the caller says goodbye.');
  assert.equal(tool().description, 'When the caller says goodbye.');
  await a.type($(panel(), 'textarea[id$="-goodbye"]'), 'Thanks for calling. Bye!');
  assert.equal(tool().params.say, 'Thanks for calling. Bye!');
  // emptied, the call ends without a goodbye: the line is taken away, not left empty
  await a.type($(panel(), 'textarea[id$="-goodbye"]'), '');
  assert.equal('say' in (tool().params || {}), false);
  assert.match(textOf($(panel(), 'textarea[id$="-goodbye"]').closest('.wfField')), /ends without a goodbye/);
  await a.click(byText(panel(), 'button', 'All its settings on the Tools page'));
  assert.deepEqual(shown.at(-1), ['tools', index]);
  await app.unmount();
});

test('a line that is one of the agent’s fixed lines is shown in its words; typing makes it its own words and leaves the fixed line as it is', async () => {
  const config = agent();
  const entry = config.agents.items[0];
  const endId = entry.tools.find((t) => config.tools.find((x) => x.id === t)?.builtin === 'end_call');
  const tool = config.tools.find((t) => t.id === endId);
  config.messages = [...(config.messages || []), { id: 'bye', text: 'Goodbye from Acme.' }];
  tool.params = { ...(tool.params || {}), say: { message: 'bye' } };
  const app = await mount(config);
  await press(node(app, `${entry.id}::tool::${endId}`));
  const box = () => $(app.container, '.wfInspector textarea[id$="-goodbye"]');
  assert.equal(box().value, 'Goodbye from Acme.');
  assert.match(textOf(box().closest('.wfField')), /One of its fixed lines/);
  await a.type(box(), 'Goodbye from Acme, take care.');
  assert.equal(app.config.tools.find((t) => t.id === endId).params.say, 'Goodbye from Acme, take care.');
  assert.equal(app.config.messages.find((m) => m.id === 'bye').text, 'Goodbye from Acme.', 'the fixed line itself is unchanged');
  await app.unmount();
});

test('an agent can have its own AI model, voice and interruptions; each says it uses the default until changed, and goes back to it', async () => {
  const app = await mount(example());
  await press(node(app, 'billing'));
  const panel = () => $(app.container, '.wfInspector');
  const own = () => $$(panel(), '.wfOwn').map((el) => textOf($(el, '.wfOwnHead')));
  assert.deepEqual(own(), ['AI modelUsing default', 'VoiceUsing default', 'Callers can interrupt itUsing default']);
  const billing = () => app.config.agents.items.find((x) => x.id === 'billing');
  await a.choose($(panel(), '.rxSelect[id$="-llm"]'), 'openai|gpt-4.1');
  assert.deepEqual(billing().overrides.models.llm, { model: 'gpt-4.1' }, 'the default’s provider: the model alone');
  assert.match(own()[0], /Use the default/);
  await a.click(byText(panel(), 'button', 'Use the default'));
  assert.equal(billing().overrides?.models?.llm, undefined, 'back to the default: the override goes, and the empty parts with it');
  const interrupt = $(panel(), 'input[id$="-interrupt"]');
  await a.click(interrupt);
  assert.equal(billing().overrides.conversation.turn_handling.interruption.enabled, false);
  await app.unmount();
});

test('the Knowledge base and Tools parts choose what the subagent reads and can use; Edges lists both ways and adds one', async () => {
  const config = example();
  config.knowledge = [
    { id: 'faq', name: 'FAQ', mode: 'inject', description: 'Common questions' },
    { id: 'manuals', name: 'Manuals', mode: 'tool' },
  ];
  const app = await mount(config);
  const billing = () => app.config.agents.items.find((x) => x.id === 'billing');
  await press(node(app, 'billing'));
  await openTab(app, 'Knowledge base');
  const panel = () => $(app.container, '.wfInspector');
  assert.deepEqual(
    $$(panel(), '.wfToggleRow strong').map(textOf),
    ['Faq'],
    'the knowledge read on every turn (a base reached through a tool is a tool), named as on its page',
  );
  await a.click($(panel(), '.wfToggleRow [role=switch]'));
  assert.ok(billing().knowledge.includes('faq'));

  await openTab(app, 'Tools');
  const names = $$(panel(), '.wfToggleRow strong').map(textOf);
  assert.ok(names.includes('End') && names.includes('Verify caller'), 'built-in tools and your tools, named as their blocks are');
  const before = billing().tools.length;
  const off = $$(panel(), '.wfToggleRow [role=switch]').find((el) => el.getAttribute('aria-checked') === 'false' && !el.disabled);
  await a.click(off);
  assert.equal(billing().tools.length, before + 1);

  await openTab(app, 'Edges');
  assert.match(textOf(panel()), /Where it can send the caller/);
  assert.match(textOf(panel()), /Callers come from/);
  assert.ok(
    $$(panel(), '.wfList li').some((li) => /Front Door/.test(textOf(li))),
    'the agent that passes callers to it',
  );
  const handoffs = (billing().handoffs || []).length;
  await a.choose(byLabel(panel(), 'Pass the caller to a subagent'), 'safety_watch');
  assert.equal(billing().handoffs.length, handoffs + 1);
  assert.equal(billing().handoffs.at(-1).to, 'safety_watch');
  assert.match($(app.container, '.wfInspector header').textContent, /Billing → Live Safety Watch/, 'the new hand-over is selected, to say when');
  await app.unmount();
});

test('a hand-over that nothing says when to take is drawn with a warning on its arrow', async () => {
  const config = example();
  const billing = config.agents.items.find((x) => x.id === 'billing');
  billing.handoffs = [...(billing.handoffs || []), { id: 'to_safety', to: 'safety_watch', description: '' }];
  const app = await mount(config);
  const chips = $$(app.container, '.wfEdgeLabel.missing');
  assert.equal(chips.length, 1);
  assert.match(textOf(chips[0]), /Say when/);
  await app.unmount();
});

test('Templates add a ready-made piece in one step of Undo; one that would add nothing says why', async () => {
  const app = await mount();
  const menu = byText(app.container, 'button', /Templates/);
  await a.open(menu);
  const items = () => $$(document.body, '.wfTemplateMenu [role=menuitem]');
  assert.deepEqual(
    items().map((el) => textOf($(el, 'strong'))),
    ['Front desk with specialists', 'Back to the first subagent', 'Every subagent can end the conversation'],
  );
  const back = items().find((el) => /Back to the first subagent/.test(textOf(el)));
  assert.equal(back.getAttribute('aria-disabled'), 'true');
  assert.match(textOf(back), /There is only one subagent/);
  await a.click(items()[0]);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(app.config.agents.items.map((x) => x.name).slice(1), ['Sales', 'Support']);
  assert.equal(app.config.agents.items[0].handoffs.length, 2);
  await a.click(byLabel(app.container, 'Undo'));
  assert.equal(app.config.agents.items.length, 1, 'one Undo takes the whole template away');
  await app.unmount();
});

test('the panel can be hidden, giving the picture the whole width, and shown again', async () => {
  const app = await mount();
  await a.click(byLabel(app.container, 'Hide the panel'));
  assert.equal($(app.container, '.wfInspector'), null);
  assert.ok($(app.container, '.wfWork.wide'));
  await a.click(byLabel(app.container, 'Show the panel'));
  assert.ok($(app.container, '.wfInspector'));
  await app.unmount();
});

test('an agent something else needs cannot be deleted from the panel either, and the panel says why', async () => {
  const config = example();
  config.defaults.conversation = { ...(config.defaults.conversation || {}), inactivity: { on_exhausted: { do: [{ type: 'handoff', to: 'billing' }] } } };
  const app = await mount(config);
  await press(node(app, 'billing'));
  const del = byText($(app.container, '.wfInspector'), 'button', /Delete this subagent/);
  assert.equal(del.disabled, true);
  assert.match(textOf($(app.container, '.wfInspector')), /Callers who stay quiet too long are passed to it\. Change that first\./);
  await app.unmount();
});

test('taking a tool away in the Tools part does what deleting its block does; two changes there are two steps of Undo', async () => {
  const before = example();
  const app = await mount(example());
  await press(node(app, 'greeter'));
  await openTab(app, 'Tools');
  const box = (name) =>
    $(
      $$(app.container, '.wfToggleRow').find((el) => textOf($(el, 'strong')) === name),
      '[role=switch]',
    );
  await a.click(box('End'));
  assert.deepEqual(app.config, ops.removeNode(before, 'greeter::tool::end_call'), 'the way to end the call nobody else offers goes with it');
  await a.click(box('Verify caller'));
  assert.ok(app.config.agents.items[0].tools.includes('verify_caller'));
  await a.click(byLabel(app.container, 'Undo'));
  assert.ok(!app.config.agents.items[0].tools.includes('verify_caller'));
  assert.ok(!app.config.agents.items[0].tools.includes('end_call'), 'one Undo takes back only the last change');
  await app.unmount();
});

test('the Edges part lists a hand-over to a subagent that is gone, and takes it away', async () => {
  const config = example();
  config.agents.items.find((x) => x.id === 'billing').handoffs = [{ id: 'to_gone', tool: 'go_to_gone', description: 'x', to: 'gone' }];
  const app = await mount(config);
  await press(node(app, 'billing'));
  await openTab(app, 'Edges');
  assert.match(textOf($(app.container, '.wfBroken')), /A hand-over to “gone”, which is not a subagent\./);
  await a.click(byText($(app.container, '.wfBroken'), 'button', 'Remove this hand-over'));
  assert.equal(app.config.agents.items.find((x) => x.id === 'billing').handoffs, undefined);
  await app.unmount();
});

test('an agent that talks through a realtime model says so instead of offering a chat model and a voice', async () => {
  const app = await mount(example());
  await press(node(app, 'safety_watch'));
  const panel = $(app.container, '.wfInspector');
  assert.match(textOf(panel), /It talks through a realtime model \(gpt-realtime\)/);
  assert.equal($(panel, '.rxSelect[id$="-llm"]'), null);
  await app.unmount();
});

test('a step as an agent takes over can run earlier or later, and stays selected', async () => {
  const config = agent();
  const first = config.agents.items[0];
  first.on_enter = [
    { type: 'say', text: 'First line' },
    { type: 'say', text: 'Second line' },
  ];
  const app = await mount(config);
  await press(node(app, `${first.id}::enter::1`));
  assert.match(textOf($(app.container, '.wfInspector')), /Step 2 of 2/);
  await a.click(byText($(app.container, '.wfInspector'), 'button', 'Run it earlier'));
  assert.deepEqual(
    app.config.agents.items[0].on_enter.map((s) => s.text),
    ['Second line', 'First line'],
  );
  assert.equal(node(app, `${first.id}::enter::0`).getAttribute('aria-pressed'), 'true');
  await app.unmount();
});

test('the line between an agent and one of its blocks leads to either end, and can take the block away', async () => {
  const app = await mount();
  const id = app.config.agents.items[0].id;
  const item = $$(app.container, '.wfSteps .wfListItem').find((el) => /can end the conversation/.test(textOf(el)));
  await a.click(item);
  const panel = () => $(app.container, '.wfInspector');
  assert.ok(byText(panel(), 'button', /^Go to /));
  await a.click(byText(panel(), 'button', /Delete this block/));
  await a.click(byText($(panel(), '.wfConfirm'), 'button', /Delete this block/));
  assert.ok(!app.config.agents.items.find((x) => x.id === id).tools.some((t) => app.config.tools.find((x) => x.id === t)?.builtin === 'end_call'));
  await app.unmount();
});

test('a channel is where a call comes in: what it says first is changed in its panel, on every channel that says the same line (as on the Agent page), and who answers; a subagent is a subagent', async () => {
  const config = agent();
  config.channels.forEach((c) => {
    c.greeting = { say: 'Hello, you have reached Acme.' };
  });
  // a phone line that says the same, and text messages that say something else
  config.channels.push({ id: 'phone', type: 'sip_voice', greeting: { say: 'Hello, you have reached Acme.' } });
  config.channels.push({ id: 'texts', type: 'sms', greeting: { say: 'Text HELP for help.' } });
  const app = await mountScreen('workflow', config, { ready: '.wfTab' });
  await press($(app.container, '.wfNode[data-type=trigger]'));
  const panel = () => $(app.container, '.wfInspector');
  assert.equal(textOf($(panel(), 'header small')), 'Where a call comes in');
  const box = $(panel(), 'textarea');
  assert.equal(box.value, 'Hello, you have reached Acme.');
  assert.match(textOf(panel()), /2 channels say this line, so it changes on all of them\./);
  await a.type(box, 'Hi, Acme here.');
  assert.deepEqual(
    app.config.channels.map((c) => c.greeting?.say),
    ['Hi, Acme here.', 'Hi, Acme here.', 'Text HELP for help.'],
    'the channels that said the same line say the new one; the one that said something else keeps it',
  );
  // emptied, it waits for the caller; typed again, it is written to the same two
  await a.type($(panel(), 'textarea'), '');
  assert.deepEqual(
    app.config.channels.map((c) => c.greeting?.say),
    [undefined, undefined, 'Text HELP for help.'],
  );
  await a.type($(panel(), 'textarea'), 'Good morning.');
  assert.deepEqual(
    app.config.channels.map((c) => c.greeting?.say),
    ['Good morning.', 'Good morning.', 'Text HELP for help.'],
  );
  await press(node(app, app.config.agents.items[0].id));
  assert.doesNotMatch(textOf(panel()), /What it says first/, 'not in the subagent’s panel');
  await a.click(byLabel(app.container, `Add a step after ${app.config.agents.items[0].name}`));
  await a.click(menuItem(app, 'Subagent'));
  const [name, when] = $$($(app.container, '.wfMenu form'), 'input');
  await a.type(name, 'Billing');
  await a.type(when, 'Bills');
  await a.click(byText($(app.container, '.wfMenu form'), 'button', 'Add the subagent'));
  assert.equal(textOf($(app.container, '.wfInspector header small')), 'Subagent');
  await app.unmount();
});

test('an Agent transfer passes the caller to another agent of the workspace through its number: chosen from the ＋, drawn as that agent, set in its panel', async () => {
  const config = agent();
  const first = config.agents.items[0];
  // the workspace's agents and their numbers (GET /bots, GET /numbers): this one is "x"
  const workspace = {
    agents: [
      { id: 'x', name: 'This one', numbers: [] },
      { id: 'voice-test', name: 'Voice test', numbers: [{ number: '90004', environment: 'development' }] },
      { id: 'sales', name: 'Sales line', numbers: [] },
    ],
  };
  const app = await mountScreen('workflow', config, { ready: '.wfTab', props: { workspace } });
  await press(node(app, first.id));
  await a.click(plus(app));
  const yours = $$(app.container, '.wfAddGroup').find((g) => textOf($(g, 'h4')) === 'Your agents');
  const items = $$(yours, '[role=menuitem]');
  assert.deepEqual(
    items.map((el) => textOf($(el, 'strong'))),
    ['Transfer to Voice test', 'Transfer to Sales line'],
    'the other agents (not this one)',
  );
  assert.equal(items[1].disabled, true, 'one with no number can’t be reached yet');
  await a.click(items[0]);
  const tool = app.config.tools.find((t) => t.id === app.config.agents.items[0].tools.at(-1));
  const transfer = app.config.telephony.transfers.find((t) => t.id === tool.params.transfer);
  assert.deepEqual([tool.builtin, transfer.method, transfer.target], ['transfer_or_callback', 'sip_refer', '90004']);
  const block = node(app, `${first.id}::tool::${tool.id}`);
  assert.equal(block.dataset.type, 'agentTransfer');
  assert.equal(block.getAttribute('aria-label'), 'Voice test, Agent transfer', 'named by what it shows');
  const panel = () => $(app.container, '.wfInspector');
  assert.equal(textOf($(panel(), 'header small')), 'Agent transfer');
  assert.deepEqual($$(panel(), '[role=tab]').map(textOf), ['General', 'Edges']);
  await a.type(byLabel(panel(), 'Say while transferring') || $(panel(), 'textarea[id$="-say"]'), 'Putting you through.');
  await a.type($(panel(), 'input[id$="-delay"]'), '2');
  const now = app.config.telephony.transfers.find((t) => t.id === tool.params.transfer);
  assert.deepEqual(now.before, [{ type: 'say', text: 'Putting you through.' }]);
  assert.equal(now.delay_s, 2);
  await app.unmount();
});

test('the Tests part lists the tests that check a call ends with this subagent, and adds one', async () => {
  const config = example();
  config.tests = [
    {
      id: 'bill_q',
      description: 'A bill question reaches billing',
      channel: config.channels[0].id,
      turns: [{ say: 'My bill is wrong' }],
      expect: [{ agent_is: 'billing' }],
    },
  ];
  const shown = [];
  const app = await mountScreen('workflow', config, { ready: '.wfTab', props: { onShowSetting: (path) => shown.push(path) } });
  await press(node(app, 'billing'));
  await openTab(app, 'Tests');
  const panel = () => $(app.container, '.wfInspector');
  assert.match(textOf(panel()), /A bill question reaches billing/);
  await a.click(byText(panel(), 'button', 'Add test'));
  const added = app.config.tests.at(-1);
  assert.deepEqual(added.expect, [{ agent_is: 'billing' }]);
  assert.deepEqual(shown.at(-1), ['tests', 1], 'it opens on the Tests page');
  await app.unmount();
});

test('under a subagent: its model, knowledge and tools are plugged in; a connector opens that part of its panel, a plug-in opens its own', async () => {
  const config = example();
  const app = await mount(config);
  const panel = () => $(app.container, '.wfInspector');
  // the Tools connector of Billing: its panel, at Tools
  const ports = $$(app.container, '.react-flow__node').find((n) => n.dataset.id === 'billing');
  await a.click($$(ports, '.wfPort').find((p) => textOf(p) === 'Tools'));
  assert.equal(textOf($(panel(), '[role=tab][aria-selected=true]')), 'Tools');
  // its model: the AI model, the voice, interruptions
  await press(node(app, 'billing::model'));
  assert.equal(textOf($(panel(), 'header small')), 'AI model of Billing');
  assert.ok($(panel(), '.rxSelect[id$="-llm"]'));
  // knowledge it reads: stop reading it
  await press(node(app, 'tech_support::knowledge::product_manual'));
  assert.equal(textOf($(panel(), 'header small')), 'Knowledge Technical Support reads');
  await a.click(byText(panel(), 'button', /Stop Technical Support reading it/));
  await a.click(byText($(panel(), '.wfConfirm'), 'button', /Stop Technical Support reading it/));
  assert.ok(!(app.config.agents.items.find((x) => x.id === 'tech_support').knowledge || []).includes('product_manual'));
  await app.unmount();
});

test('Add a step offers a way back to the first subagent to one that has none, and adds it', async () => {
  const config = example();
  config.agents.items.find((x) => x.id === 'billing').tools = ['get_bill_summary'];
  const app = await mount(config);
  await press(node(app, 'billing'));
  await a.click(plus(app));
  await a.click(menuItem(app, 'Back to the first subagent'));
  const billing = app.config.agents.items.find((x) => x.id === 'billing');
  assert.ok(billing.tools.some((t) => app.config.tools.find((x) => x.id === t)?.builtin === 'return_to_entry'));
  await app.unmount();
});
