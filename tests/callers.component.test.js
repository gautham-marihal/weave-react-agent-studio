import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, actions, byText, setupDom, teardownDom, textOf } from './component/dom.js';
import { applyStarter } from '../src/studio/starters.ts';
import { createDemoApi, minimalConfig } from '../src/demo/demoApi.js';

// "Fix this call", the simulated callers, and the switch that holds publishing until the tests pass, mounted in jsdom. The callers run on the demo's imitation of
// the test runner (nothing real is called).
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
const until = async (app, check, tries = 150) => {
  for (let i = 0; i < tries && !check(); i += 1) await app.wait(60);
  return check();
};
const agent = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const tools = (config) => (Array.isArray(config.tools) ? config.tools : []);

const failedCall = {
  channelId: '',
  turns: [
    { say: 'Where is my order?', said: ['Let me check.'], tools: [{ tool: 'lookup_order', error: 'HTTP 500', args: {} }], waitMs: 6500 },
    { say: 'Hello?', said: [], tools: [], waitMs: null },
  ],
};

test('Fix this call: lists what went wrong with the evidence, suggests changes as sentences, and changes nothing until the button', async () => {
  const app = await mountScreen('fixcall', agent(), { ready: '.fxBody', props: { facts: failedCall, call: { status: 'ended' } } });
  const titles = $$(document.body, '.fxFinding strong').map(textOf);
  assert.deepEqual(titles, ['The tool “lookup_order” failed', 'The agent said nothing at turn 2', 'A 6.5 s wait at turn 1']);
  assert.match(textOf($(document.body, '.fxFinding small')), /HTTP 500/);
  assert.match(textOf($(document.body, '.fxBlock[aria-label="Suggested changes"] header p')), /not by an AI/);
  assert.ok($(document.body, '.primaryCta').disabled, 'nothing is chosen, so nothing can be put in the draft');
  const before = JSON.stringify(app.config);
  await a.click($(document.body, '.fxFix input'));
  assert.match(textOf($(document.body, '.fxFix em')), /^Add this rule under Tone and style: “If the “lookup_order” tool fails/);
  assert.match(textOf($(document.body, '.fxChanges')), /Added the style rule “If the “lookup_order” tool fails/);
  assert.match(textOf($(document.body, '.fxHonest')), /cannot show a change of wording/);
  assert.equal(JSON.stringify(app.config), before, 'ticking it does not change the draft');
  await a.click($(document.body, '.primaryCta'));
  assert.ok(
    app.config.persona.style_rules.some((r) => /lookup_order/.test(r)),
    'the rule is in the draft',
  );
  await app.unmount();
});

test('Fix this call: choosing another finding gives its own suggestions, and a call with nothing wrong says so', async () => {
  const app = await mountScreen('fixcall', agent(), { ready: '.fxBody', props: { facts: failedCall, call: { status: 'ended' } } });
  await a.click($$(document.body, '.fxFinding input')[2]);
  const fixes = $$(document.body, '.fxFix strong').map(textOf);
  assert.ok(fixes.includes('Keep answers short'), fixes.join(' | '));
  await app.unmount();
  const quiet = await mountScreen('fixcall', agent(), {
    ready: '.fxBody',
    props: { facts: { turns: [{ say: 'Hi', said: ['Hello.'], tools: [], waitMs: 400 }] }, call: { status: 'ended' } },
  });
  assert.match(textOf($(document.body, '.fxNone')), /still felt wrong/);
  assert.equal($(document.body, '.fxFinding'), null);
  await quiet.unmount();
});

test('Simulated callers: pick, run on the draft, see who passed, and keep the good ones as tests', async () => {
  await seedDemo(agent());
  const app = await mountScreen('callers', agent(), { ready: '.cpPanel' });
  const rows = () => $$(app.container, '.cpList > li');
  assert.ok(rows().length >= 12, 'callers and checks to choose from');
  const picked = rows().filter((li) => $(li, 'input').checked).length;
  assert.match(textOf($(app.container, '.cpCount')), new RegExp(`${picked} of ${rows().length} chosen`));
  await a.click($(app.container, '.cpRun .primaryCta'));
  assert.equal(await until(app, () => !!$(app.container, '.cpSummary')), true, 'the run finishes');
  assert.ok($$(app.container, '.cpResult').length >= 5, 'each one that ran has a result');
  assert.equal(tools(app.config).length, tools(agent()).length, 'running changed nothing in the draft');
  assert.equal((app.config.tests || []).length, 0, 'and kept no tests');
  // a caller whose only real check is the reviewer's is not called "Passed" when the reviewer did not grade it
  const direct = $(app.container, '.cpList > li[data-key="caller_direct"]');
  assert.match(textOf($(direct, '.cpResult')), /Basic checks passed/);
  await a.click($(direct, 'button[aria-expanded]'));
  assert.ok($(direct, '.cpDetail ol li'), 'what the caller says');
  assert.match(textOf($(direct, '.cpDetail')), /a reviewer agrees that/);
  await a.click(byText(app.container, 'button', /Keep the ones that passed as tests/));
  assert.ok((app.config.tests || []).length >= 4);
  assert.ok(app.config.tests.every((t) => /^Simulated caller: |^Made by the studio: /.test(t.description)));
  assert.match(textOf($(app.container, '.cpDone')), /not saved yet/);
  assert.ok($$(app.container, '.cpKept').length >= 4, 'they are marked as tests');
  await app.unmount();
});

test('Simulated callers: one caller can be kept without running it, and the selection can be cleared and filled', async () => {
  await seedDemo(agent());
  const app = await mountScreen('callers', agent(), { ready: '.cpPanel' });
  await a.click(byText(app.container, 'button', 'Clear'));
  assert.match(textOf($(app.container, '.cpCount')), /^0 of/);
  assert.ok($(app.container, '.cpRun .primaryCta').disabled);
  await a.click(byText(app.container, 'button', 'Select all'));
  assert.match(textOf($(app.container, '.cpCount')), /^(\d+) of \1 chosen/);
  await a.click(byText(app.container, 'button', 'Keep as a test: Frustrated'));
  assert.deepEqual(
    app.config.tests.map((t) => t.id),
    ['caller_frustrated'],
  );
  assert.equal(byText(app.container, 'button', 'Keep as a test: Frustrated'), null, 'once kept it is not offered again');
  await app.unmount();
});

test('the gate: a switch for the agent, and what it says about the tests now', async () => {
  await seedDemo(agent());
  const app = await mountScreen('gatestrip', agent(), { ready: '.gateStrip' });
  assert.match(textOf($(app.container, '.gateStrip')), /Off: the tests inform, and nothing stops a publish/);
  await a.click($(app.container, 'input[aria-label="Tests must pass before publishing"]'));
  assert.equal(await until(app, () => /Publishing is held/.test(textOf($(app.container, '.gateStrip')))), true);
  assert.match(textOf($(app.container, '.gateStrip')), /no tests yet/);
  assert.equal(window.localStorage.getItem('weave_gate_x'), '1', 'kept for this agent in this browser');
  await a.click($(app.container, 'input[aria-label="Tests must pass before publishing"]'));
  assert.match(textOf($(app.container, '.gateStrip')), /Off:/);
  await app.unmount();
});
