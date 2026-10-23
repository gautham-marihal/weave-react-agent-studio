import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { $, $$, actions, byLabel, byText, setupDom, teardownDom, textOf } from './component/dom.js';
import { applyStarter } from '../src/studio/starters.js';
import { minimalConfig } from '../src/demo/demoApi.js';

// The Workflow tab, mounted in jsdom with a draft in state: blocks are selected, added from the ＋ menu, edited in the panel, moved with the keyboard and
// taken away again, and the draft that comes out is read back. (Dragging with a mouse needs real layout; that is covered in the browser run.)
const { mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const agent = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const example = () => JSON.parse(readFileSync(new URL('./fixtures/agent-config.example.json', import.meta.url), 'utf8'));
const mount = (config = agent()) => mountScreen('workflow', config, { ready: '.wfTab' });
const node = (app, id) => $$(app.container, '.wfNode').find((el) => el.dataset.node === id);
// a block is selected by pressing and letting go of it without moving
const press = async (el) => {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 5, clientY: 5 }));
    el.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 5, clientY: 5 }));
  });
};
const key = async (el, k, shift = false) => {
  await act(async () => {
    el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true }));
  });
};
const plus = (app) => $$(app.container, '.wfPlus')[0];
const menuItem = (app, name) => $$(app.container, '.wfMenu [role=menuitem]').find((el) => new RegExp(`^${name}`).test(textOf(el)));

test('the Workflow shows where a call starts, the agent, and what it can do, each block named for a screen reader', async () => {
  const app = await mount();
  assert.ok(node(app, 'start'));
  const agentNode = $$(app.container, '.wfNode[data-type=agent]');
  assert.equal(agentNode.length, 1);
  assert.match(agentNode[0].getAttribute('aria-label'), /subagent, answers first/);
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
  assert.match(textOf($(app.container, '.wfInspector > header')), /Subagent/);
  await a.type($(app.container, `.wfInspector input[id$="-name"]`), 'Front desk');
  assert.equal(app.config.agents.items[0].name, 'Front desk');
  assert.match(node(app, id).getAttribute('aria-label'), /^Front desk,/);
  await a.choose($(app.container, '.wfInspector select[id$="-kind"]'), 'router');
  assert.equal(app.config.agents.items[0].kind, 'router');
  await a.type($(app.container, '.wfInspector textarea[id$="-role"]'), 'Greet the caller and find out what they need.');
  assert.equal(app.config.agents.items[0].instructions.role, 'Greet the caller and find out what they need.');
  await key(node(app, id), 'Enter');
  await app.unmount();
});

test('the ＋ under an agent offers the seven kinds; Subagent adds a real agent, links it, and selects it', async () => {
  const app = await mount();
  const first = app.config.agents.items[0].id;
  await press(node(app, first));
  assert.equal($$(app.container, '.wfMenu').length, 0, 'closed until asked');
  await a.click(plus(app));
  assert.deepEqual($$(app.container, '.wfMenu [role=menuitem] strong').map(textOf), [
    'Subagent',
    'Say',
    'Update state',
    'Agent transfer',
    'Phone number transfer',
    'Tool',
    'End',
  ]);
  assert.equal(menuItem(app, 'Agent transfer').disabled, true, 'with one agent there is nobody to pass the caller to');
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
  await a.click(menuItem(app, 'Tool'));
  await a.click($$(app.container, '.wfMenu [role=menuitem]').find((el) => /lookup/.test(textOf(el))));
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

test('Agent transfer lists the other agents and links to the one chosen; an arrow can then be selected and say when it is taken', async () => {
  const app = await mount(example());
  await press(node(app, 'billing'));
  await a.click(plus(app));
  await a.click(menuItem(app, 'Agent transfer'));
  assert.deepEqual($$(app.container, '.wfMenu [role=menuitem] strong').map(textOf), ['Front Door', 'Technical Support', 'Live Safety Watch']);
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
  const tidy = byText(app.container, 'button', 'Tidy up');
  assert.equal(tidy.disabled, true, 'nothing to tidy yet');
  await key(el(), 'ArrowRight');
  const first = app.config.builder.ui.graph_positions[id];
  await key(el(), 'ArrowDown', true);
  const second = app.config.builder.ui.graph_positions[id];
  assert.deepEqual([second.x - first.x, second.y - first.y], [0, 32]);
  assert.equal(byText(app.container, 'button', 'Tidy up').disabled, false);
  await a.click(byText(app.container, 'button', 'Tidy up'));
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
  await a.click(byLabel(app.container, 'Delete End the call'));
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
  assert.equal(byText($(lone.container, '.wfInspector'), 'button', /Delete this agent/).disabled, true);
  await lone.unmount();
});

test('with no agents there is one thing to do: add the first', async () => {
  const config = agent();
  config.agents = { entry: '', items: [] };
  const app = await mount(config);
  assert.match(textOf($(app.container, '.wfEmpty')), /No agents yet/);
  await a.click(byText(app.container, 'button', /Add the first agent/));
  assert.equal(app.config.agents.items.length, 1);
  assert.equal(app.config.agents.entry, app.config.agents.items[0].id);
  await app.unmount();
});

test('the picture is also a list, for anyone who cannot use it: the call step by step, beside it while nothing is selected', async () => {
  const app = await mount(example());
  const items = $$(app.container, '.wfSteps li').map(textOf);
  assert.ok(items.includes('A call starts with Front Door.'));
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

// ---- the mouse: pressing, moving and letting go are replayed as pointer events at the zoom the person chose
const pointer = (el, type, x, y, extra = {}) =>
  act(async () => {
    el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...extra }));
  });
const place = (el) => [parseFloat(el.style.left), parseFloat(el.style.top)];

test('dragging a block with the mouse moves it by what the pointer moved (at the chosen zoom), saves only that block’s place, and the blocks that go with it follow', async () => {
  window.localStorage.setItem('weave_workflow_zoom', '1');
  const config = agent();
  const first = config.agents.items[0];
  first.on_enter = [{ type: 'say', text: 'Hello' }];
  const app = await mount(config);
  const id = first.id;
  const [x0, y0] = place(node(app, id));
  const [sx0, sy0] = place(node(app, `${id}::enter::0`));
  await pointer(node(app, id), 'pointerdown', 100, 100);
  await pointer(node(app, id), 'pointermove', 140, 130);
  assert.deepEqual(place(node(app, id)), [x0 + 40, y0 + 30], 'it follows the pointer while the button is down');
  assert.deepEqual(place(node(app, `${id}::enter::0`)), [sx0 + 40, sy0 + 30], 'and so does the step that goes with it');
  assert.equal(app.config.builder, undefined, 'nothing is written until it is let go');
  await pointer(node(app, id), 'pointerup', 140, 130);
  assert.deepEqual(Object.keys(app.config.builder.ui.graph_positions), [id], 'only the dragged block gets a place of its own');
  assert.deepEqual([app.config.builder.ui.graph_positions[id].x, app.config.builder.ui.graph_positions[id].y], [x0 + 40, y0 + 30]);
  assert.deepEqual(place(node(app, `${id}::enter::0`)), [sx0 + 40, sy0 + 30], 'the step stays beside it after the drop');
  assert.equal(node(app, id).getAttribute('aria-pressed'), 'false', 'dragging is not selecting');

  // at half size the same movement of the pointer is twice as far on the picture
  window.localStorage.setItem('weave_workflow_zoom', '0.5');
  await app.unmount();
  const half = await mount(JSON.parse(JSON.stringify(app.config)));
  const [hx, hy] = place(node(half, id));
  await pointer(node(half, id), 'pointerdown', 10, 10);
  await pointer(node(half, id), 'pointermove', 30, 30);
  await pointer(node(half, id), 'pointerup', 30, 30);
  assert.deepEqual([half.config.builder.ui.graph_positions[id].x, half.config.builder.ui.graph_positions[id].y], [hx + 40, hy + 40]);
  await half.unmount();
  window.localStorage.setItem('weave_workflow_zoom', '1');
});

test('a press that hardly moves selects the block; a drag that is cancelled, or goes off the top-left, drops nothing wrong; the empty space moves the view and deselects on a plain click', async () => {
  window.localStorage.setItem('weave_workflow_zoom', '1');
  const app = await mount(agent());
  const id = app.config.agents.items[0].id;
  await pointer(node(app, id), 'pointerdown', 50, 50);
  await pointer(node(app, id), 'pointermove', 52, 51);
  await pointer(node(app, id), 'pointerup', 52, 51);
  assert.equal(node(app, id).getAttribute('aria-pressed'), 'true', 'a shaky click still selects');
  assert.equal(app.config.builder, undefined, 'and moves nothing');

  const before = place(node(app, id));
  await pointer(node(app, id), 'pointerdown', 50, 50);
  await pointer(node(app, id), 'pointermove', 90, 90);
  await pointer(node(app, id), 'pointercancel', 90, 90);
  assert.deepEqual(place(node(app, id)), before, 'a drag the system cancelled puts the block back');
  assert.equal(app.config.builder, undefined);
  await pointer(node(app, id), 'pointermove', 150, 150);
  assert.deepEqual(place(node(app, id)), before, 'and the pointer moving on afterwards does nothing');

  await pointer(node(app, id), 'pointerdown', 50, 50);
  await pointer(node(app, id), 'pointermove', -5000, -5000);
  await pointer(node(app, id), 'pointerup', -5000, -5000);
  const saved = app.config.builder.ui.graph_positions[id];
  assert.ok(saved.x >= 8 && saved.y >= 8, 'a block cannot be dragged out of the picture');

  const scaler = $(app.container, '.wfScaler');
  await pointer(scaler, 'pointerdown', 5, 5);
  await pointer(scaler, 'pointerup', 5, 5);
  assert.equal(node(app, id).getAttribute('aria-pressed'), 'false', 'a click on the empty space deselects');
  await app.unmount();
});

test('a tool block shows when the tool is used and what it says, and sends you to its panel on the Tools page to change them (asked once)', async () => {
  const config = agent();
  const shown = [];
  const app = await mountScreen('workflow', config, { ready: '.wfTab', props: { onShowSetting: (path) => shown.push(path) } });
  const entry = app.config.agents.items[0];
  const endId = entry.tools.find((t) => app.config.tools.find((x) => x.id === t)?.builtin === 'end_call');
  assert.ok(endId, 'the starter can end the call');
  await press(node(app, `${entry.id}::tool::${endId}`));
  const panel = $(app.container, '.wfInspector');
  assert.equal($$(panel, 'textarea, input[type=text]').length, 0, 'nothing of the tool is typed here');
  assert.match(textOf($(panel, '.wfFacts')), /What it says before it hangs up/);
  assert.match(textOf($(panel, '.wfFacts')), /When it uses it/);
  await a.click(byText(panel, 'button', 'Change it on the Tools page'));
  const index = app.config.tools.findIndex((t) => t.id === endId);
  assert.deepEqual(shown.at(-1), ['tools', index]);
  await app.unmount();
});
