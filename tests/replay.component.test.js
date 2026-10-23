import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, actions, byText, setupDom, teardownDom, textOf } from './component/dom.js';
import { applyStarter } from '../src/studio/starters.js';
import { createDemoApi, minimalConfig } from '../src/demo/demoApi.js';

// A call replayed against the draft and kept as a test, and the monitoring page over the same calls. Demo mode: the answers come from the imitation API.
const { mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const demoStore = {
  load: () => JSON.parse(window.localStorage.getItem('weave_demo_state') || 'null'),
  save: (state) => window.localStorage.setItem('weave_demo_state', JSON.stringify(state)),
};
async function seedDemo(config) {
  window.localStorage.clear();
  window.localStorage.setItem('weave_demo', '1');
  const api = createDemoApi({ seed: false, storage: demoStore });
  await api.handle('POST', '/bots', { id: 'x', name: 'X' });
  await api.handle('PUT', '/bots/x/draft', { config: { ...config, meta: { ...config.meta, id: 'x' } } });
  return api;
}
const until = async (app, check, tries = 100) => {
  for (let i = 0; i < tries && !check(); i += 1) await app.wait(60);
  return check();
};
const agent = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const nameField = () => document.body.querySelector('[aria-label="Test name"]');

async function openFirstCall(app) {
  assert.equal(await until(app, () => $$(app.container, '.clRow').length > 0), true);
  await a.click($$(app.container, '.clRow')[0]);
  assert.equal(await until(app, () => !!byText(app.container, '.clViews button', 'Replay')), true);
}

test('a call is replayed against the draft, turn by turn, beside what happened', async () => {
  await seedDemo(agent());
  const app = await mountScreen('calls', agent(), { ready: '.clView', props: { fixedBotId: 'x', withEditor: true } });
  await openFirstCall(app);
  assert.equal(await until(app, () => !!byText(app.container, 'button', 'Keep as a test')), true, 'a finished call can be kept as a test');
  await a.click(byText(app.container, '.clViews button', 'Replay'));
  assert.match(textOf($(app.container, '.rpView')), /Play this call again/);
  assert.match(textOf($(app.container, '.rpNote')), /simulation/i, 'it says plainly that the browser replay is a simulation');
  await a.click(byText(app.container, 'button', 'Replay in the browser'));
  assert.equal(await until(app, () => !!$(app.container, '.rpCompare')), true);
  assert.ok($$(app.container, '.rpTurn').length >= 2, 'one row per caller turn');
  assert.ok($(app.container, '.rpVerdict h4'), 'what changed is said first');
  assert.match(textOf($(app.container, '.rpHead')), /The call.*Replay: The draft/);
  await app.unmount();
});

test('keeping a call as a test adds it to the draft, is refused while it is not valid, and can be undone', async () => {
  await seedDemo(agent());
  const app = await mountScreen('calls', agent(), { ready: '.clView', props: { fixedBotId: 'x', withEditor: true } });
  await openFirstCall(app);
  assert.equal(await until(app, () => !!byText(app.container, 'button', 'Keep as a test')), true);
  await a.click(byText(app.container, 'button', 'Keep as a test'));
  assert.equal(await until(app, () => !!$(document.body, '.rpDialog')), true);
  const add = () => byText(document.body, 'button', 'Add the test to the draft');
  assert.equal(add().disabled, false, 'a call with facts starts valid');
  await a.type(nameField(), 'Not Valid');
  assert.equal(add().disabled, true, 'a bad name is refused');
  assert.match(textOf($(document.body, '.rpProblems')), /must start with a letter/);
  await a.type(nameField(), 'from_a_call');
  assert.equal(add().disabled, false);
  await a.click(add());
  assert.equal(await until(app, () => Array.isArray(app.config.tests) && app.config.tests.length === 1), true, 'the test is in the draft');
  const kept = app.config.tests[0];
  assert.equal(kept.id, 'from_a_call');
  assert.ok(kept.turns.length >= 1 && kept.turns.every((t) => typeof t.say === 'string' && t.say), 'the caller’s words');
  assert.ok(kept.expect.length >= 1, 'at least one check');
  assert.match(textOf(app.container), /Added the test “from_a_call” to the draft, not saved yet/);
  await a.click(byText(app.container, 'button', 'Undo'));
  assert.equal(await until(app, () => !app.config.tests || app.config.tests.length === 0), true, 'undo takes it out again');
  await app.unmount();
});

test('without the agent’s draft open, a call offers to open it in the agent instead of replaying', async () => {
  await seedDemo(agent());
  const app = await mountScreen('calls', agent(), { ready: '.clView', props: { fixedBotId: 'x' } });
  await openFirstCall(app);
  assert.ok(!byText(app.container, 'button', 'Keep as a test'), 'no way to keep it without a draft');
  await a.click(byText(app.container, '.clViews button', 'Replay'));
  assert.equal(await until(app, () => /Open this call from the agent’s own Calls page/.test(textOf(app.container))), true);
  await app.unmount();
});

test('the monitoring page counts the calls, names what needs attention and links each to its agent', async () => {
  await seedDemo(agent());
  const opened = [];
  const app = await mountScreen('monitoring', agent(), {
    ready: '.mnPage',
    props: { bots: [{ id: 'x', name: 'X' }], onOpenCall: (...args) => opened.push(args) },
  });
  assert.equal(await until(app, () => $$(app.container, '.mnKpi').length === 6), true);
  assert.equal(await until(app, () => Number(textOf($(app.container, '.mnKpi strong'))) > 5), true, 'the calls are counted');
  assert.equal(await until(app, () => $$(app.container, '.mnList > li').length > 0), true, 'calls with something wrong are listed');
  assert.ok($$(app.container, '.mnBar, .mnBarCut').length > 3, 'a bar for each day with calls');
  assert.match(textOf($(app.container, '.mnBasis')), /calls whose records were read, spread over the period/);
  await a.click(byText($(app.container, '.mnList'), 'button', 'Replay'));
  assert.equal(opened.length, 1);
  assert.equal(opened[0][0], 'x');
  assert.equal(opened[0][2], 'replay', 'Replay opens that call on its replay');
  await app.unmount();
});
