import test from 'node:test';
import assert from 'node:assert/strict';
import { modelNameOf, newExpectation, scenarioProblems, toolChoices, toolNamesOf } from '../src/studio/scenarios/model.js';
import { runScenarioDemo } from '../src/demo/demoTests.js';
import { suggestions } from '../src/studio/callers/personas.js';

// A test says "the tool X is called" by the name the MODEL calls it: `name`, which defaults to the id. Two tools may share a name (a voice variant and a chat
// variant of the same tool), so the id is not what a check names (UI review 2.2). This is the shape of three of the six sample bots.
const config = () => ({
  meta: { id: 'bot', name: 'Bot' },
  channels: [
    { id: 'phone', type: 'sip_voice', enabled: true },
    { id: 'web-chat', type: 'web_chat', enabled: true },
  ],
  agents: {
    entry: 'main',
    items: [
      {
        id: 'main',
        name: 'Main',
        tools: ['report_hazard_phone', 'report_hazard_chat', 'lookup', 'end_call'],
        handoffs: [{ id: 'to_billing', tool: 'go_billing', to: 'billing' }],
      },
      { id: 'billing', name: 'Billing' },
    ],
  },
  tools: [
    {
      id: 'report_hazard_phone',
      type: 'http',
      name: 'report_hazard',
      channels: ['phone'],
      description: 'Reports a hazard.',
      connection: 'api',
      request: { method: 'POST', path: '/hazards' },
    },
    {
      id: 'report_hazard_chat',
      type: 'http',
      name: 'report_hazard',
      channels: ['web-chat'],
      description: 'Reports a hazard.',
      connection: 'api',
      request: { method: 'POST', path: '/hazards' },
    },
    { id: 'lookup', type: 'http', description: 'Looks something up.', connection: 'api', request: { method: 'GET', path: '/x' } },
    { id: 'end_call', builtin: 'end_call' },
  ],
  connections: { api: { type: 'http', base_url: 'https://example.test' } },
});
const scenario = (expect, extra = {}) => ({ id: 's', channel: 'phone', turns: [{ say: 'There is a hazard' }], expect, ...extra });

test('a tool is named by what the model calls it: its name, else its id', () => {
  const tools = config().tools;
  assert.equal(modelNameOf(tools[0]), 'report_hazard');
  assert.equal(modelNameOf(tools[2]), 'lookup');
  assert.equal(modelNameOf(null), '');
  assert.deepEqual(toolNamesOf(config()), ['report_hazard', 'lookup', 'end_call', 'go_billing'], 'each name once, handoff tools included');
});

test('the form offers names, once each, and says which tools stand behind a name that is not simply a tool’s id', () => {
  const choices = toolChoices(config());
  assert.deepEqual(
    choices.map((c) => c.value),
    ['report_hazard', 'lookup', 'end_call', 'go_billing'],
  );
  assert.equal(choices[0].description, 'the tools report_hazard_phone and report_hazard_chat');
  assert.equal(choices[1].description, undefined, 'a tool named by its id needs no explanation');
  assert.equal(newExpectation('tool_called', config()).tool_called, 'report_hazard');
});

test('a check on a tool whose name differs from its id is valid, and a check on its id is not (the runner would never match it)', () => {
  assert.deepEqual(scenarioProblems(scenario([{ tool_called: 'report_hazard' }]), config()), {}, 'the real runner passes this, so the form must accept it');
  assert.deepEqual(scenarioProblems(scenario([{ tool_called_with: { tool: 'report_hazard', args: {} } }]), config()), {});
  assert.deepEqual(scenarioProblems(scenario([{ tool_not_called: 'report_hazard' }]), config()), {});
  const byId = scenarioProblems(scenario([{ tool_called: 'report_hazard_phone' }]), config());
  assert.match(byId.expect[0], /there is no tool “report_hazard_phone”/);
  assert.deepEqual(scenarioProblems(scenario([{ tool_called: 'go_billing' }]), config()), {}, 'a handoff tool is still allowed');
});

test('the demo runner finds the tool by the name a script uses, and the variant of the scenario’s channel', () => {
  const run = (channel) =>
    runScenarioDemo(config(), scenario([{ tool_called: 'report_hazard' }], { channel, model_script: [{ tool: 'report_hazard', args: {} }, 'Thank you.'] }));
  const phone = run('phone');
  assert.equal(phone.status, 'passed');
  assert.equal(phone.tools[0].tool, 'report_hazard', 'what is recorded is the name the model used');
  assert.equal(run('web-chat').status, 'passed');
});

test('simulated callers check the name too, and one check per name when a voice and a chat variant share it', () => {
  const all = suggestions(config());
  const checks = all.filter((s) => s.group === 'check' && s.key.startsWith('check_tool_'));
  assert.deepEqual(
    checks.map((s) => s.name),
    ['It uses “report_hazard” when asked', 'It uses “lookup” when asked'],
  );
  checks.forEach((s) => assert.deepEqual(scenarioProblems(s.scenario, config()), {}, `${s.key} is a valid scenario`));
  assert.deepEqual(
    checks[0].scenario.expect.find((e) => e.tool_called),
    { tool_called: 'report_hazard' },
  );
});
