import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, actions, byLabel, byText, setupDom, teardownDom, textOf } from './component/dom.js';
import { applyStarter } from '../src/studio/starters.js';
import { createDemoApi, minimalConfig } from '../src/demo/demoApi.js';

// UI review 2.2 in the form itself: a scenario whose check names a tool by what the model calls it (a name that is not any tool's id) opens, validates and saves
// unchanged. The scenario and the tools are the review's own case: a voice and a chat variant of one tool, both called report_hazard.
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
}
const hazard = (id, channel) => ({
  id,
  type: 'http',
  name: 'report_hazard',
  channels: [channel],
  description: 'Reports a hazard.',
  connection: 'api',
  request: { method: 'POST', path: '/hazards' },
});
const agent = () => {
  const config = applyStarter(minimalConfig('acme', 'Acme'), 'support');
  config.connections = { ...(config.connections || {}), api: { type: 'http', base_url: 'https://api.example.com' } };
  config.tools = [...(config.tools || []), hazard('report_hazard_phone', 'phone'), hazard('report_hazard_chat', 'web-chat')];
  config.channels = [...config.channels, { id: 'phone', type: 'sip_voice', enabled: true, modalities: { input: ['audio'], output: ['audio'] } }];
  config.tests = [
    {
      id: 'a_hazard_reaches_the_emergency_line',
      channel: 'phone',
      turns: [{ say: 'I can smell gas' }],
      expect: [{ tool_called: 'report_hazard' }, { said_matches: '.+' }],
    },
  ];
  return config;
};
const scenarios = async (config) => {
  await seedDemo(config);
  return mountScreen('scenarios', config, { ready: '.scTab', props: { pollMs: 40 } });
};

test('a scenario that checks a tool by its model name opens without a complaint, and Save is not blocked', async () => {
  const app = await scenarios(agent());
  await a.click(byText($(app.container, '[data-scenario=a_hazard_reaches_the_emergency_line]'), 'button', 'Edit'));
  const form = $(app.container, '.scForm');
  assert.doesNotMatch(textOf(form), /there is no tool/, 'no “there is no tool report_hazard”');
  assert.equal(byLabel(form, 'Expectation 1: tool').value || textOf(byLabel(form, 'Expectation 1: tool')), 'report_hazard');
  const save = byText(app.container, 'button', 'Save the scenario');
  assert.equal(save.disabled, false, 'Save is not blocked');
  const before = JSON.stringify(app.config.tests[0]);
  await a.click(save);
  assert.equal(JSON.stringify(app.config.tests[0]), before, 'saved unchanged');
  await app.unmount();
});

test('the tool picker offers the name once, with the tools behind it, and not the two ids', async () => {
  const app = await scenarios(agent());
  await a.click(byText($(app.container, '[data-scenario=a_hazard_reaches_the_emergency_line]'), 'button', 'Edit'));
  const picker = byLabel($(app.container, '.scForm'), 'Expectation 1: tool');
  const choices = await a.options(picker);
  assert.ok(
    choices.some((c) => /^report_hazard/.test(c) && /report_hazard_phone/.test(c) && /report_hazard_chat/.test(c)),
    `the name stands for both tools: ${choices.join(' | ')}`,
  );
  assert.equal(choices.filter((c) => /^report_hazard/.test(c)).length, 1, 'it is offered once');
  await app.unmount();
});

test('a check written against a tool’s id is flagged, because the runner records the name and would never match it', async () => {
  const config = agent();
  config.tests[0].expect = [{ tool_called: 'report_hazard_phone' }];
  const app = await scenarios(config);
  await a.click(byText($(app.container, '[data-scenario=a_hazard_reaches_the_emergency_line]'), 'button', 'Edit'));
  await a.click(byText(app.container, 'button', 'Save the scenario'));
  assert.match(textOf($(app.container, '.scForm')), /there is no tool “report_hazard_phone”/, 'the form says so when it is saved');
  assert.deepEqual(app.config.tests[0].expect, [{ tool_called: 'report_hazard_phone' }], 'and nothing is changed behind the author’s back');
  await app.unmount();
});
