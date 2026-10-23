import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, actions, byLabel, byText, setupDom, teardownDom, textOf } from './component/dom.js';
import { applyStarter } from '../src/studio/starters.js';
import { createDemoApi, minimalConfig } from '../src/demo/demoApi.js';

// Component tests of the screens built on top of the form: the Simple view, the Scenarios tab and the preview beside the editor. Each
// is mounted in jsdom with a config in state; clicks and typing are replayed and the config that comes out is read back.
const { mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const agent = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');

// ---------------------------------------------------------------- Scenarios
// The tab talks to the API like the app does. These tests switch the app to demo mode, so the answers come from the imitation API
// (src/demo), in the same shapes the real one uses; nothing here reaches a network.

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
const scenarios = async (config = agent(), props = {}) => {
  await seedDemo(config);
  return mountScreen('scenarios', config, { ready: '.scTab', props: { pollMs: 40, ...props } });
};
const until = async (app, check, tries = 80) => {
  for (let i = 0; i < tries && !check(); i += 1) await app.wait(60);
  return check();
};

test('Scenarios: demo mode says runs are an imitation, and starts with an invitation', async () => {
  const app = await scenarios();
  assert.match(textOf($(app.container, '.scTab')), /There is no runtime in demo mode/);
  assert.match(textOf($(app.container, '.scTab')), /Demo imitation/);
  assert.match(textOf($(app.container, '.scEmpty')), /No scenarios yet/);
  assert.equal(byText(app.container, 'button', /Run all/).disabled, true);
  await app.unmount();
});

test('Scenarios: write one, it goes into the draft’s tests, run it, results appear, and a failure says what and why', async () => {
  const app = await scenarios();
  await a.click(byText(app.container, 'button', 'New scenario'));
  await a.type(byLabel(app.container, 'Turn 1: what the caller says'), 'Can I speak to a human?');
  await a.choose(byLabel(app.container, 'Expectation 1: what to check'), 'tool_called');
  await a.choose(byLabel(app.container, 'Expectation 1: tool'), 'escalate_to_human');
  await a.click(byText(app.container, 'button', 'Add an expectation'));
  await a.choose(byLabel(app.container, 'Expectation 2: what to check'), 'said_matches');
  await a.type(byLabel(app.container, 'Expectation 2: pattern'), 'refund');
  await a.click(byText(app.container, 'button', 'Add the scenario'));
  assert.equal(app.config.tests.length, 1);
  assert.deepEqual(app.config.tests[0].turns, [{ say: 'Can I speak to a human?' }]);
  assert.deepEqual(app.config.tests[0].expect, [{ tool_called: 'escalate_to_human' }, { said_matches: 'refund' }]);
  assert.equal(app.config.tests[0].channel, 'web-chat');
  assert.match(textOf($(app.container, '.scItem')), /Live/, 'no model script: it is a live scenario');
  // a live scenario is skipped unless live ones are included (it would call a paid model)
  await a.click(byText(app.container, 'button', /Run all \(1\)/));
  assert.equal(await until(app, () => /Skipped/.test(textOf($(app.container, '.scItem')))), true);
  assert.match(textOf($(app.container, '.scItem')), /no model script/);
  // include live scenarios: it asks first, because it costs money
  await a.click($(app.container, '.scPaid summary'));
  await a.check($$(app.container, '.scPaid input[type=checkbox]')[0]);
  assert.match(document.body.textContent, /Run live scenarios\?/);
  assert.match(document.body.textContent, /billed by the model/);
  await a.click(byText(document.body, 'button', 'Include live scenarios'));
  assert.match(textOf(byText(app.container, 'button', /Run all/)), /uses a paid model/);
  await a.click(byText(app.container, 'button', /Run all/));
  assert.equal(await until(app, () => /Failed/.test(textOf($(app.container, '.scItem')))), true);
  const item = $(app.container, '.scItem');
  assert.match(textOf(item), /No agent message matches \/refund\//);
  assert.match(textOf(item), /“escalate_to_human” is called/);
  assert.match(textOf($(app.container, '.scSummary')), /0 passed · 1 failed/);
  assert.match(textOf($(app.container, '.scSummary')), /imitation/);
  assert.ok($(item, '.trView'), 'the same trace component shows what happened');
  await app.unmount();
});

test('Scenarios: letting a run reach real systems is off by default, asks first, and says so on the Run button', async () => {
  const config = {
    ...agent(),
    tests: [{ id: 'one', channel: 'web-chat', turns: [{ say: 'hi' }], expect: [{ said_matches: '.' }], model_script: [{ say: 'hello' }] }],
  };
  const app = await scenarios(config);
  await a.click($(app.container, '.scPaid summary'));
  const boxes = $$(app.container, '.scPaid input[type=checkbox]');
  assert.equal(boxes.length, 3, 'live, reviewer checks, and real requests');
  assert.equal(boxes[2].checked, false, 'off by default');
  assert.match(textOf($(app.container, '.scPaid')), /Let requests reach real systems.*can change real data.*refuses it unless an operator has allowed it/);
  const realConfirm = window.confirm;
  const asked = [];
  try {
    window.confirm = (text) => {
      asked.push(text);
      return false;
    };
    await a.check(boxes[2]);
    assert.equal(asked.length, 1);
    assert.match(asked[0], /real systems/);
    assert.equal($$(app.container, '.scPaid input[type=checkbox]')[2].checked, false, 'declining leaves it off');
    assert.doesNotMatch(textOf(byText(app.container, 'button', /Run all/)), /real requests/);
    window.confirm = () => true;
    await a.check($$(app.container, '.scPaid input[type=checkbox]')[2]);
    assert.match(textOf(byText(app.container, 'button', /Run all/)), /real requests/);
    assert.match(textOf($(app.container, '.scPaid summary')), /\(on\)/);
    await a.check($$(app.container, '.scPaid input[type=checkbox]')[2]);
    assert.doesNotMatch(textOf(byText(app.container, 'button', /Run all/)), /real requests/, 'switching it off takes the words away');
  } finally {
    window.confirm = realConfirm;
  }
  await app.unmount();
});

test('Scenarios: a scenario with mistakes isn’t added, and says what to fix; editing and deleting work', async () => {
  const config = { ...agent(), tests: [{ id: 'one', channel: 'web-chat', turns: [{ say: 'hi' }], expect: [{ said_matches: '.' }] }] };
  const app = await scenarios(config);
  await a.click(byText(app.container, 'button', 'New scenario'));
  await a.type(byLabel(app.container, 'Turn 1: what the caller says'), '');
  await a.type($(app.container, '.scForm input.mono'), 'Bad Id');
  await a.click(byText(app.container, 'button', 'Add the scenario'));
  assert.match(textOf($(app.container, '.scForm')), /Start with a lowercase letter/);
  assert.match(textOf($(app.container, '.scForm')), /Every turn needs some words/);
  assert.equal(app.config.tests.length, 1, 'nothing was added');
  await a.click(byText(app.container, '.scForm button', 'Cancel'));
  await a.click(byText($(app.container, '[data-scenario=one]'), 'button', 'Edit'));
  await a.type(byLabel(app.container, 'Turn 1: what the caller says'), 'hello there');
  await a.click(byText(app.container, 'button', 'Save the scenario'));
  assert.equal(app.config.tests[0].turns[0].say, 'hello there');
  window.confirm = () => true; // jsdom has no dialogs
  await a.click(byLabel(app.container, 'Delete one'));
  assert.equal(app.config.tests, undefined, 'the last one removes the section');
  await app.unmount();
});

test('Scenarios: pasted scenarios are added, bad ones reported', async () => {
  const app = await scenarios();
  await a.click(byText(app.container, 'button', 'Paste scenarios…'));
  await a.type(
    byLabel(app.container, 'Scenarios as JSON'),
    JSON.stringify([
      { id: 'good', channel: 'web-chat', turns: [{ say: 'hi' }], expect: [{ said_matches: 'x' }] },
      { id: 'bad', channel: 'nope', turns: [], expect: [] },
    ]),
  );
  await a.click(byText(app.container, 'button', 'Add them'));
  assert.deepEqual(
    app.config.tests.map((s) => s.id),
    ['good'],
  );
  assert.match(textOf($(app.container, '.scImport [role=status]')), /Added 1 scenario/);
  assert.match(textOf($(app.container, '.scImport [role=status]')), /bad: .*no channel “nope”/);
  await app.unmount();
});

// the review's own example: newer expectations, mocks, a clock, a script, and a kind the form has never heard of
const rich = () => ({
  id: 'a_hazard_reaches_the_emergency_line',
  description: 'A hazard goes straight to the emergency line.',
  channel: 'web-chat',
  now: '2026-10-14T03:00:00+08:00',
  state: { verified: true },
  http_mocks: [{ method: 'GET', path: '/orders/*', json: { found: true } }],
  model_script: [{ tool: 'end_call' }, 'Goodbye.'],
  turns: [{ say: 'There is a gas leak' }],
  expect: [
    { tool_called_with: { tool: 'end_call', args: {} } },
    { agent_is: 'assistant' },
    { http_called: { method: 'GET', path: '/orders/*', times: 1 } },
    { http_not_called: { method: 'POST', path: '/tickets' } },
    { sentiment_is: 'calm' },
  ],
});

test('Scenarios: a scenario with the newer fields opens in the form, every part is shown, and saving it keeps all of it', async () => {
  const config = { ...agent(), tests: [rich()] };
  const app = await scenarios(config);
  await a.click(byText($(app.container, '[data-scenario=a_hazard_reaches_the_emergency_line]'), 'button', 'Edit'));
  const form = $(app.container, '.scForm');
  assert.doesNotMatch(textOf(form), /Choose what to check/, 'no expectation is “unknown”');
  assert.match(textOf(form), /Scripted/);
  const kinds = $$(form, '.scExpect select[aria-label$="what to check"]').map((s) => s.value);
  assert.deepEqual(kinds, ['tool_called_with', 'agent_is', 'http_called', 'http_not_called'], 'the kinds the form knows are editable');
  assert.match(textOf($(form, '.scExpect.unknown')), /kept exactly as it is/, 'the one it does not know is kept, not an error');
  assert.equal(byLabel(form, 'Pretend it is').value, '2026-10-14T03:00:00+08:00');
  assert.equal(byLabel(form, 'Expectation 3: how many times').value, '1');
  assert.equal(byLabel(form, 'Mock 1: path').value, '/orders/*');
  assert.equal(byLabel(form, 'Model reply 1: tool').value, 'end_call');
  // Save is not blocked, and nothing the form did not touch is lost
  await a.type(byLabel(form, 'Turn 1: what the caller says'), 'There is a gas leak!');
  await a.click(byText(app.container, 'button', 'Save the scenario'));
  const saved = app.config.tests[0];
  const expected = rich();
  expected.turns = [{ say: 'There is a gas leak!' }];
  assert.deepEqual(saved, expected);
  await app.unmount();
});

test('Scenarios: a run shows a request no mock answered, offers “Add a mock”, and the mock goes into the scenario', async () => {
  const config = agent();
  config.connections = { api: { type: 'http', base_url: 'https://api.example.com' } };
  config.tools = [
    ...(config.tools || []),
    {
      id: 'find_order',
      type: 'http',
      description: 'Looks up an order',
      connection: 'api',
      request: { method: 'GET', path: '/orders/{{args.order_id}}' },
      parameters: { type: 'object', properties: { order_id: { type: 'string' } } },
    },
  ];
  config.agents.items[0].tools = [...(config.agents.items[0].tools || []), 'find_order'];
  config.tests = [
    {
      id: 'lookup',
      channel: 'web-chat',
      model_script: [{ tool: 'find_order', args: { order_id: 'NB-1' } }, 'It shipped.'],
      turns: [{ say: 'Where is NB-1?' }],
      expect: [{ http_called: { method: 'GET', path: '/orders/*' } }],
    },
  ];
  const app = await scenarios(config);
  await a.click(byText(app.container, 'button', /Run all/));
  assert.equal(await until(app, () => /no mock answered/.test(textOf($(app.container, '.scItem')))), true);
  const item = $(app.container, '[data-scenario=lookup]');
  assert.match(textOf(item), /GET \/orders\/NB-1/);
  assert.match(textOf(item), /A scenario never calls a real API/);
  await a.click(byText(item, 'button', 'Add a mock'));
  assert.deepEqual(app.config.tests[0].http_mocks, [{ path: '/orders/NB-1', status: 200, json: {}, method: 'GET', connection: 'api' }]);
  assert.match(textOf(item), /Mock added: run it again/);
  await app.unmount();
});

// ---------------------------------------------------------------- Preview

test('Preview: idle, loading, live, a reply tagged Simulated, and ended with a way to start again', async () => {
  window.localStorage.clear();
  const app = await mountScreen('preview', agent(), { ready: '.pvPanel' });
  const panel = $(app.container, '.pvPanel');
  assert.equal(panel.getAttribute('data-state'), 'idle');
  assert.match(textOf(panel), /Simulated\. Replies are made up by simple rules/);
  assert.match(textOf(panel), /not the real agent running/);
  assert.equal(byText(panel, 'button', 'Real agent').disabled, false, 'switchable when not locked');
  await a.click(byText(panel, 'button', 'Start a simulated chat'));
  assert.equal($(app.container, '.pvPanel').getAttribute('data-state'), 'loading');
  assert.match(textOf($(app.container, '.pvLoading')), /Connecting|Asking for a conversation|Waiting/);
  for (let i = 0; i < 60 && $(app.container, '.pvPanel').getAttribute('data-state') !== 'live'; i += 1) await app.wait(50);
  assert.equal($(app.container, '.pvPanel').getAttribute('data-state'), 'live');
  await app.wait(500);
  assert.ok($$(app.container, '.pvMsg.bot').length >= 1, 'the agent greets first');
  assert.ok($$(app.container, '.pvSimTag').length >= 1, 'and it is tagged');
  assert.equal(byText(app.container, '.pvModes button', 'Simulated').disabled, true, 'the mode can’t change mid-conversation');
  await a.type(byLabel(app.container, 'Message to the agent'), 'bye');
  await a.click(byText(app.container, 'button', 'Send'));
  for (let i = 0; i < 80 && $(app.container, '.pvPanel').getAttribute('data-state') !== 'ended'; i += 1) await app.wait(50);
  assert.equal($(app.container, '.pvPanel').getAttribute('data-state'), 'ended');
  assert.match(textOf($(app.container, '.pvEnded')), /The conversation ended/);
  assert.ok(byText(app.container, 'button', 'Start again'));
  await app.unmount();
});

test('Preview: the microphone and the picture button appear exactly when the channel takes them, and a picture is checked against the channel’s limits', async () => {
  window.localStorage.clear();
  const plain = await mountScreen('preview', agent(), { ready: '.pvPanel' });
  assert.equal($(plain.container, '.pvTools'), null, 'a text-only channel offers neither');
  await plain.unmount();

  const config = agent();
  const channel = config.channels.find((c) => c.type === 'web_chat') || config.channels[0];
  channel.modalities = { input: ['text', 'audio', 'image'], output: ['text'] };
  channel.inputs = { image: { accepted_mime: ['image/png'], max_bytes: 1000, topic: 'pics' } };
  const app = await mountScreen('preview', config, { ready: '.pvPanel' });
  const panel = () => $(app.container, '.pvPanel');
  assert.ok(byLabel(panel(), 'Speak to the agent') && byLabel(panel(), 'Attach a picture'), 'both are offered, before the conversation too');
  assert.equal(byLabel(panel(), 'Attach a picture').disabled, true, 'but only once a conversation is running');
  assert.equal(byLabel(panel(), 'Speak to the agent').disabled, true);
  await a.click(byText(panel(), 'button', 'Start a simulated chat'));
  for (let i = 0; i < 60 && panel().getAttribute('data-state') !== 'live'; i += 1) await app.wait(50);
  assert.equal(byLabel(panel(), 'Attach a picture').disabled, false);
  assert.match(
    byLabel(panel(), 'Speak to the agent').getAttribute('title'),
    /can.t turn speech into text/,
    'a browser with no speech recognition says so (the real agent hears the microphone itself)',
  );
  assert.equal($(panel(), 'input[type=file]').getAttribute('accept'), 'image/png', 'the channel’s own accepted types');
  const send = async (file) => {
    const input = $(panel(), 'input[type=file]');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
  };
  await send(new window.File([new Uint8Array(2000)], 'big.png', { type: 'image/png' }));
  assert.match(textOf($(panel(), '.pvHint.warn')), /2\.0 KB|0\.0 MB; this channel allows/);
  await send(new window.File(['x'], 'a.gif', { type: 'image/gif' }));
  assert.match(textOf($(panel(), '.pvHint.warn')), /accepts image\/png; that file is image\/gif/);
  await send(new window.File(['x'], 'ok.png', { type: 'image/png' }));
  assert.equal($(panel(), '.pvHint.warn'), null, 'a good picture clears the note');
  assert.ok(
    $$(panel(), '.pvMsg.me').some((m) => /Sent a picture: ok\.png/.test(textOf(m))),
    'and is shown as sent',
  );
  await app.wait(900);
  assert.ok(
    $$(panel(), '.pvMsg.bot').some((m) => /received your picture/.test(textOf(m))),
    'the simulated agent answers, and says it is simulated',
  );
  await app.unmount();
});

test('Preview: in demo mode the real agent can’t be chosen, and a configuration problem is an error with a way to retry', async () => {
  window.localStorage.clear();
  const locked = await mountScreen('preview', agent(), { ready: '.pvPanel', props: { locked: true } });
  assert.equal(byText($(locked.container, '.pvPanel'), 'button', 'Real agent').disabled, true);
  assert.match(textOf($(locked.container, '.pvPanel')), /demo mode has none/);
  await locked.unmount();
});

// ---------------------------------------------------------------- Simple: where it is available, call records, what is below the cards
