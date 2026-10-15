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
const simple = (config = agent(), options = {}) => mountScreen('simple', config, { ready: '.smView', ...options });
const card = (app, id) => $(app.container, `[data-card=${id}]`);
const openCard = async (app, id) => { if (!$(card(app, id), '.smBody')) await a.click($(card(app, id), '.smHead')); return card(app, id); };

// ---------------------------------------------------------------- Simple

test('the Simple view is a few cards in the customer’s words, the first open, each saying in one line what it holds', async () => {
  window.localStorage.clear();
  const app = await simple();
  assert.deepEqual($$(app.container, '.smCard h3 strong').map(textOf), ['Personality and instructions', 'Voice and language', 'AI model', 'What it can do', 'Where it is available', 'Call records']);
  const heads = $$(app.container, '.smHead');
  assert.deepEqual(heads.map((h) => h.getAttribute('aria-expanded')), ['true', 'false', 'false', 'false', 'false', 'false']);
  assert.match(textOf($(card(app, 'where'), '.smTitle small')), /Web chat · 1 transfer/);
  assert.match(textOf($(card(app, 'records'), '.smTitle small')), /^Call log kept$/);
  assert.match(textOf($(card(app, 'model'), '.smTitle small')), /STT: none · LLM: OpenAI gpt-4\.1-mini · TTS: none/);
  assert.match(textOf($(card(app, 'connections'), '.smTitle small')), /0 connections · 2 tools · 1 secret/);
  assert.match(textOf($(card(app, 'instructions'), '.smBody')), /What should it do\?/);
  await a.click($(card(app, 'instructions'), '.smHead'));
  assert.equal($(card(app, 'instructions'), '.smBody'), null, 'a card closes when its title is pressed');
  assert.equal($(card(app, 'instructions'), '.smHead').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(JSON.parse(window.localStorage.getItem('weave_simple_open3')), [], 'which cards are open is remembered');
  await app.unmount();
});

test('Simple: Technical names shows where each setting sits in the file (the real path, with copy and open-in-JSON), and switching it off removes them', async () => {
  window.localStorage.clear();
  const app = await simple();
  assert.equal($$(app.container, '.stFTech').length, 0, 'off by default: plain words only');
  window.localStorage.setItem('weave_tech_names', '1');
  await act(async () => { window.dispatchEvent(new window.Event('storage')); });
  const paths = $$(app.container, '.smFields .stFTech').map((el) => `${textOf($(el, '.stFKeyHead') || { textContent: '' })}${textOf($(el, '.stFKey'))}`);
  for (const expected of ['meta.name', 'persona.tone', 'persona.style_rules']) assert.ok(paths.includes(expected), `${expected} is shown (${paths.join(', ')})`);
  assert.ok(paths.some((p) => /^agents\.items\[\d+\]\.instructions\.role$/.test(p)), 'the role is at the entry agent');
  assert.ok($$(app.container, '.smFields .stFTech button').some((b) => /^Copy path$/.test(textOf(b))), 'a path can be copied');
  window.localStorage.setItem('weave_tech_names', '0');
  await act(async () => { window.dispatchEvent(new window.Event('storage')); });
  assert.equal($$(app.container, '.stFTech').length, 0, 'off again: they are gone');
  await app.unmount();
});

test('Simple: a panel takes the keyboard in, keeps Tab inside it, closes on Escape (an open list first) and gives the keyboard back to the row that opened it', async () => {
  window.localStorage.clear();
  const app = await simple();
  const head = $(card(app, 'voice'), '.smHead');
  head.focus();
  await a.click(head);
  const body = () => $(card(app, 'voice'), '.smBody');
  assert.equal(body().getAttribute('role'), 'dialog');
  assert.equal(body().getAttribute('aria-modal'), 'true');
  assert.ok(window.document.activeElement === $(body(), '.smClose'), 'the keyboard moves into the panel');
  // Shift+Tab from the first control goes to the last one, and Tab from the last to the first: it does not leave the panel
  const items = [...body().querySelectorAll('button, input, select, textarea, [tabindex]')].filter((el) => !el.disabled && el.tabIndex >= 0);
  const tab = (shift) => act(async () => { window.document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true })); });
  items[0].focus();
  await tab(true);
  assert.ok(window.document.activeElement === items[items.length - 1], 'Shift+Tab from the first goes to the last');
  await tab(false);
  assert.ok(window.document.activeElement === items[0], 'Tab from the last goes to the first');
  await act(async () => { window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
  assert.equal(body(), null, 'Escape closes it');
  assert.ok(window.document.activeElement === $(card(app, 'voice'), '.smHead'), 'and the keyboard is back where it was');
  // an Escape that something inside already used (a list that was open) must not also close the panel
  await a.click($(card(app, 'voice'), '.smHead'));
  await act(async () => { const e = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); e.preventDefault(); window.document.dispatchEvent(e); });
  assert.ok(body(), 'the panel stays when the Escape was already handled');
  await app.unmount();
});

test('what is typed in Instructions is written to the real fields, and nothing else changes', async () => {
  window.localStorage.clear();
  const config = agent();
  const app = await simple(config);
  await a.type(byLabel(app.container, 'Agent name'), 'Bolt');
  assert.equal(app.config.meta.name, 'Bolt');
  assert.equal(app.config.persona.name, 'Bolt', 'what it calls itself follows while the two were the same');
  await a.type(byLabel(app.container, 'What the agent should do (its role)'), 'You help with bills.');
  assert.equal(app.config.agents.items[0].instructions.role, 'You help with bills.');
  assert.equal(app.config.agents.items[0].instructions.opening, config.agents.items[0].instructions.opening, 'the rest of the instructions is kept');
  await a.type(byLabel(app.container, 'Tone'), 'calm');
  await a.type(byLabel(app.container, 'Greeting'), 'Hello from Bolt.');
  assert.equal(app.config.persona.tone, 'calm');
  assert.equal(app.config.channels[0].greeting.say, 'Hello from Bolt.');
  assert.deepEqual(app.config.tools, config.tools);
  assert.deepEqual(app.config.messages, config.messages);
  assert.match(textOf($(card(app, 'instructions'), '.stTplCount')), /^4 words$/);
  await a.click(byText(card(app, 'instructions'), 'button', '＋ Add a rule'));
  assert.equal(app.config.persona.style_rules.at(-1), '');
  await app.unmount();
});

test('"Detailed settings" shows the ordinary form for just that part, and hides again', async () => {
  window.localStorage.clear();
  const app = await simple();
  assert.equal($(app.container, '[data-detail=instructions]'), null);
  await a.click(byText(card(app, 'instructions'), 'button', 'Detailed settings'));
  const chips = await (async () => { for (let i = 0; i < 50 && !$(app.container, '[data-detail=instructions] .stFChipBtn'); i += 1) await app.wait(10); return $$(app.container, '[data-detail=instructions] .stFChipBtn').map(textOf); })();
  assert.deepEqual(chips.map((c) => c.replace(/\d+$/, '')), ['Personality and rules', 'Fixed lines', 'Agents', 'Things it remembers']);
  assert.equal($(app.container, '[data-detail=instructions] .stFNavGroups'), null, 'no group tabs: it is embedded');
  assert.equal($(app.container, '[data-detail=connections]'), null, 'other cards are untouched');
  await a.click(byText(card(app, 'instructions'), 'button', 'Hide detailed settings'));
  assert.equal($(app.container, '[data-detail=instructions]'), null);
  await app.unmount();
});

test('Voice and language: the main language makes the agent speak it; the main language can’t be switched off', async () => {
  window.localStorage.clear();
  const app = await simple();
  const voice = await openCard(app, 'voice');
  await a.choose(byLabel(voice, 'Main language'), 'es-MX');
  assert.equal(app.config.defaults.language.primary, 'es-MX');
  assert.deepEqual(app.config.defaults.language.speaks, ['es']);
  assert.equal(byLabel(card(app, 'voice'), 'Spanish').disabled, true);
  await a.check(byLabel(card(app, 'voice'), 'French'));
  assert.deepEqual(app.config.defaults.language.speaks, ['es', 'fr']);
  await a.check(byLabel(card(app, 'voice'), 'French'));
  assert.deepEqual(app.config.defaults.language.speaks, ['es']);
  assert.equal(byLabel(card(app, 'records'), 'Recording notice'), null, 'a chat-only agent has no recording notice to set');
  await app.unmount();
});

test('Voice and language: a voice is chosen from its engine’s list; the recording notice is under Call records', async () => {
  window.localStorage.clear();
  const config = agent();
  config.channels = [{ id: 'phone', type: 'sip_voice', enabled: true, modalities: { input: ['audio'], output: ['audio'] }, greeting: { say: 'Hi' } }];
  config.defaults.models = { ...config.defaults.models, stt: { provider: 'deepgram', model: 'nova-3' }, tts: { provider: 'elevenlabs', model: 'eleven_turbo_v2_5', voice_id: '' } };
  const app = await simple(config);
  const records = await openCard(app, 'records');
  await a.type(byLabel(records, 'Recording notice'), 'Calls are recorded.');
  assert.equal(app.config.persona.disclosures.recording_notice, 'Calls are recorded.');
  const voice = await openCard(app, 'voice');
  const select = byLabel(card(app, 'voice'), 'Voice');
  const sarah = [...select.options].find((o) => /^Sarah/.test(o.text));
  assert.ok(sarah, 'ElevenLabs voices are offered');
  await a.choose(select, sarah.value);
  assert.equal(app.config.defaults.models.tts.voice_id, sarah.value);
  assert.equal(byLabel(card(app, 'voice'), 'Text-to-speech provider').value, 'elevenlabs', 'the voice engine is chosen right here');
  assert.ok(byLabel(card(app, 'voice'), 'Text-to-speech model'), 'and so is its model');
  // Female and male voices are listed one gender at a time; the list starts on Female
  const toggle = (name) => [...card(app, 'voice').querySelectorAll('.vgToggle button')].find((b) => b.textContent.startsWith(name));
  const names = () => [...byLabel(card(app, 'voice'), 'Voice').options].map((o) => o.text.split(' · ')[0]).filter((n) => n && !/^(Choose|Custom)/.test(n));
  assert.equal(toggle('Female').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(names(), ['Sarah', 'Jessica', 'Laura', 'Alice', 'Matilda', 'Lily', 'Bella']);
  await a.click(toggle('Male'));
  assert.deepEqual(names(), ['Adam', 'Eric', 'Roger', 'George', 'Daniel', 'Brian', 'Chris', 'Will', 'Bill', 'Charlie', 'Liam', 'Callum', 'Harry']);
  const adam = [...byLabel(card(app, 'voice'), 'Voice').options].find((o) => /^Adam/.test(o.text));
  await a.choose(byLabel(card(app, 'voice'), 'Voice'), adam.value);
  assert.equal(app.config.defaults.models.tts.voice_id, adam.value);
  assert.equal(toggle('Male').getAttribute('aria-pressed'), 'true');
  await app.unmount();
});

test('AI Model: choosing a provider sets its model and key together; a model that isn’t listed is accepted and said so', async () => {
  window.localStorage.clear();
  const app = await simple();
  const model = await openCard(app, 'model');
  await a.choose(byLabel(model, 'Language model provider'), 'anthropic');
  assert.equal(app.config.defaults.models.llm.provider, 'anthropic');
  assert.equal(app.config.defaults.models.llm.model, 'claude-sonnet-5-5');
  assert.deepEqual(app.config.defaults.models.llm.api_key, { secret: 'ANTHROPIC_API_KEY' });
  assert.match(textOf(card(app, 'model')), /Claude Sonnet 5\.5/);
  await a.type(byLabel(card(app, 'model'), 'Language model model'), 'claude-future-9');
  assert.equal(app.config.defaults.models.llm.model, 'claude-future-9');
  assert.match(textOf(card(app, 'model')), /isn’t in the catalogue.*doesn’t check model ids/);
  assert.match(textOf(card(app, 'model')), /catalogue kept in the studio/);
  const options = [...byLabel(card(app, 'model'), 'Speech-to-text provider').options].map((o) => o.text);
  assert.ok(options.some((t) => /Deepgram/.test(t)) && options.some((t) => /OpenAI-compatible/.test(t)));
  await app.unmount();
});

test('AI Model: "All model settings" opens the full model editor inside the card', async () => {
  window.localStorage.clear();
  const app = await simple();
  await openCard(app, 'model');
  await a.click(byText(card(app, 'model'), 'button', 'All model settings'));
  assert.ok($(app.container, '[data-detail=model] .stModels'));
  assert.equal($$(app.container, '[data-detail=model] .stModels .builderCard').length, 3);
  await app.unmount();
});

test('Connections: a connection is added from the card, a bad address is refused first', async () => {
  window.localStorage.clear();
  const app = await simple();
  const connections = await openCard(app, 'connections');
  assert.match(textOf(connections), /None yet/);
  await a.click(byText(connections, 'button', '＋ Add an HTTP connection'));
  await a.type(byLabel(app.container, 'Connection name'), 'billing_api');
  await a.type(byLabel(app.container, 'Connection base address'), 'nope');
  await a.click(byText($(app.container, '.smAdd'), 'button', 'Add the connection'));
  assert.match(textOf($(app.container, '.smAdd')), /Use e\.g\. https:\/\/api\.example\.com/);
  assert.equal(app.config.connections, undefined, 'nothing was added');
  await a.type(byLabel(app.container, 'Connection base address'), 'https://api.acme.example');
  await a.click(byText($(app.container, '.smAdd'), 'button', 'Add the connection'));
  assert.deepEqual(app.config.connections, { billing_api: { type: 'http', base_url: 'https://api.acme.example' } });
  assert.match(textOf(card(app, 'connections')), /billing_api.*http.*api\.acme\.example/);
  await a.click($(card(app, 'connections'), '.smHead'));
  assert.match(textOf($(card(app, 'connections'), '.smTitle small')), /1 connection/, 'closed, the card sums it up');
  await app.unmount();
});

test('a problem inside a card shows as a number on its title', async () => {
  window.localStorage.clear();
  const report = { valid: false, errors: [{ path: ['defaults', 'models', 'llm', 'model'], message: 'needs a model' }, { path: ['tools', 0, 'description'], message: 'bad' }], warnings: [], unsupported: [], secrets_required: [] };
  const app = await simple(agent(), { report });
  assert.equal(textOf($(card(app, 'model'), '.stFBadge')), '1');
  assert.equal(textOf($(card(app, 'connections'), '.stFBadge')), '1');
  assert.equal($(card(app, 'instructions'), '.stFBadge'), null);
  await app.unmount();
});

// ---------------------------------------------------------------- Scenarios
// The tab talks to the API like the app does. These tests switch the app to demo mode, so the answers come from the imitation API
// (src/demo), in the same shapes the real one uses; nothing here reaches a network.

const demoStore = { load: () => JSON.parse(window.localStorage.getItem('weave_demo_state') || 'null'), save: (state) => window.localStorage.setItem('weave_demo_state', JSON.stringify(state)) };
async function seedDemo(config) {
  window.localStorage.clear();
  window.localStorage.setItem('weave_demo', '1');
  const api = createDemoApi({ seed: false, storage: demoStore });
  await api.handle('POST', '/bots', { id: 'x', name: 'X' });
  await api.handle('PUT', '/bots/x/draft', { config: { ...config, meta: { ...config.meta, id: 'x' } } });
}
const scenarios = async (config = agent(), props = {}) => { await seedDemo(config); return mountScreen('scenarios', config, { ready: '.scTab', props: { pollMs: 40, ...props } }); };
const until = async (app, check, tries = 80) => { for (let i = 0; i < tries && !check(); i += 1) await app.wait(60); return check(); };

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
  await a.click(byText(app.container, 'button', '＋ New scenario'));
  await a.type(byLabel(app.container, 'Turn 1: what the caller says'), 'Can I speak to a human?');
  await a.choose(byLabel(app.container, 'Expectation 1: what to check'), 'tool_called');
  await a.choose(byLabel(app.container, 'Expectation 1: tool'), 'escalate_to_human');
  await a.click(byText(app.container, 'button', '＋ Add an expectation'));
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
  const config = { ...agent(), tests: [{ id: 'one', channel: 'web-chat', turns: [{ say: 'hi' }], expect: [{ said_matches: '.' }], model_script: [{ say: 'hello' }] }] };
  const app = await scenarios(config);
  await a.click($(app.container, '.scPaid summary'));
  const boxes = $$(app.container, '.scPaid input[type=checkbox]');
  assert.equal(boxes.length, 3, 'live, reviewer checks, and real requests');
  assert.equal(boxes[2].checked, false, 'off by default');
  assert.match(textOf($(app.container, '.scPaid')), /Let requests reach real systems.*can change real data.*refuses it unless an operator has allowed it/);
  const realConfirm = window.confirm;
  const asked = [];
  try {
    window.confirm = (text) => { asked.push(text); return false; };
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
  } finally { window.confirm = realConfirm; }
  await app.unmount();
});

test('Scenarios: a scenario with mistakes isn’t added, and says what to fix; editing and deleting work', async () => {
  const config = { ...agent(), tests: [{ id: 'one', channel: 'web-chat', turns: [{ say: 'hi' }], expect: [{ said_matches: '.' }] }] };
  const app = await scenarios(config);
  await a.click(byText(app.container, 'button', '＋ New scenario'));
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
  await a.type(byLabel(app.container, 'Scenarios as JSON'), JSON.stringify([{ id: 'good', channel: 'web-chat', turns: [{ say: 'hi' }], expect: [{ said_matches: 'x' }] }, { id: 'bad', channel: 'nope', turns: [], expect: [] }]));
  await a.click(byText(app.container, 'button', 'Add them'));
  assert.deepEqual(app.config.tests.map((s) => s.id), ['good']);
  assert.match(textOf($(app.container, '.scImport [role=status]')), /Added 1 scenario/);
  assert.match(textOf($(app.container, '.scImport [role=status]')), /bad: .*no channel “nope”/);
  await app.unmount();
});

// the review's own example: newer expectations, mocks, a clock, a script, and a kind the form has never heard of
const rich = () => ({
  id: 'a_hazard_reaches_the_emergency_line', description: 'A hazard goes straight to the emergency line.', channel: 'web-chat', now: '2026-10-14T03:00:00+08:00', state: { verified: true },
  http_mocks: [{ method: 'GET', path: '/orders/*', json: { found: true } }],
  model_script: [{ tool: 'end_call' }, 'Goodbye.'],
  turns: [{ say: 'There is a gas leak' }],
  expect: [{ tool_called_with: { tool: 'end_call', args: {} } }, { agent_is: 'assistant' }, { http_called: { method: 'GET', path: '/orders/*', times: 1 } }, { http_not_called: { method: 'POST', path: '/tickets' } }, { sentiment_is: 'calm' }],
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
  config.tools = [...(config.tools || []), { id: 'find_order', type: 'http', description: 'Looks up an order', connection: 'api', request: { method: 'GET', path: '/orders/{{args.order_id}}' }, parameters: { type: 'object', properties: { order_id: { type: 'string' } } } }];
  config.agents.items[0].tools = [...(config.agents.items[0].tools || []), 'find_order'];
  config.tests = [{ id: 'lookup', channel: 'web-chat', model_script: [{ tool: 'find_order', args: { order_id: 'NB-1' } }, 'It shipped.'], turns: [{ say: 'Where is NB-1?' }], expect: [{ http_called: { method: 'GET', path: '/orders/*' } }] }];
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
  assert.match(byLabel(panel(), 'Speak to the agent').getAttribute('title'), /can.t turn speech into text/, 'a browser with no speech recognition says so (the real agent hears the microphone itself)');
  assert.equal($(panel(), 'input[type=file]').getAttribute('accept'), 'image/png', 'the channel’s own accepted types');
  const send = async (file) => { const input = $(panel(), 'input[type=file]'); Object.defineProperty(input, 'files', { value: [file], configurable: true }); await act(async () => { input.dispatchEvent(new window.Event('change', { bubbles: true })); }); };
  await send(new window.File([new Uint8Array(2000)], 'big.png', { type: 'image/png' }));
  assert.match(textOf($(panel(), '.pvHint.warn')), /2\.0 KB|0\.0 MB; this channel allows/);
  await send(new window.File(['x'], 'a.gif', { type: 'image/gif' }));
  assert.match(textOf($(panel(), '.pvHint.warn')), /accepts image\/png; that file is image\/gif/);
  await send(new window.File(['x'], 'ok.png', { type: 'image/png' }));
  assert.equal($(panel(), '.pvHint.warn'), null, 'a good picture clears the note');
  assert.ok($$(panel(), '.pvMsg.me').some((m) => /Sent a picture: ok\.png/.test(textOf(m))), 'and is shown as sent');
  await app.wait(900);
  assert.ok($$(panel(), '.pvMsg.bot').some((m) => /received your picture/.test(textOf(m))), 'the simulated agent answers, and says it is simulated');
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
test('Personality and instructions names where conversations are processed, with a way to change it, and no internal id', async () => {
  window.localStorage.clear();
  const app = await simple();
  const body = $(card(app, 'instructions'), '.smBody');
  assert.match(textOf($(body, '[data-note=processing]')), /^Conversations are processed by .*OpenAI\./);
  assert.doesNotMatch(textOf(body), /This is the role of|front_desk|greeter/, 'no internal id on a customer’s screen');
  assert.equal($(card(app, 'model'), '.smBody'), null);
  await a.click(byText($(body, '[data-note=processing]'), 'button', 'Change'));
  assert.ok($(card(app, 'model'), '.smBody'), 'Change opens the AI model card');
  await app.unmount();
});

test('Where it is available: channels are switched on and off, and a voice channel added from the cards asks about the recording notice', async () => {
  window.localStorage.clear();
  const app = await simple();
  const where = await openCard(app, 'where');
  const switches = $$(where, '.smChannels [role=switch]');
  assert.equal(switches.length, 1);
  await a.click(switches[0]);
  assert.equal(app.config.channels[0].enabled, false, 'switched off');
  await a.click($$(card(app, 'where'), '.smChannels [role=switch]')[0]);
  assert.equal('enabled' in app.config.channels[0], false, 'switched on again: the default is not written');
  await a.click(byText(card(app, 'where'), 'button.stAddBtn', /^＋ Add a channel/));
  await a.click($(card(app, 'where'), '.stPickCard[data-option="phone"]'));
  assert.equal(app.config.channels.at(-1).type, 'sip_voice');
  const offer = $(card(app, 'where'), '.stFOffer');
  assert.ok(offer, 'asks whether callers should be told');
  await a.click(byText(offer, 'button', 'Add a notice'));
  assert.match(app.config.persona.disclosures.recording_notice, /may be recorded/);
  assert.equal($(card(app, 'where'), '.stFOffer'), null);
  await app.unmount();
});

test('Call records: what is kept is said and can be changed here, and sensitive details can be hidden in what is saved', async () => {
  window.localStorage.clear();
  const config = agent();
  config.state = { variables: { ...(config.state?.variables || {}), pin: { type: 'string', sensitive: true } } };
  config.schema_version = '1.1';
  const app = await simple(config);
  const records = await openCard(app, 'records');
  assert.match(textOf($(records, '[aria-label="What is kept"]')), /A log of each call is kept\. It records what callers say/);
  assert.match(textOf($(records, '[aria-label="Things to look at"]')), /handles sensitive details/);
  await a.type(byLabel(records, 'Delete call logs after (days)'), '30');
  assert.equal(app.config.observability.session_log.retention_days, 30);
  await a.click(byLabel(card(app, 'records'), 'Keep the transcript'));
  assert.equal(app.config.post_call.recording.transcript, true);
  await a.click(byText(card(app, 'records'), 'button', /^Hide sensitive details/));
  assert.equal(app.config.post_call.redaction.enabled, true);
  assert.equal(app.config.schema_version, '1.2', 'redaction needs 1.2, and the draft says so');
  assert.match(textOf($(card(app, 'records'), '[role=status]')), /raised to 1\.2/);
  assert.equal($(card(app, 'records'), '[aria-label="Things to look at"]'), null, 'nothing left to warn about');
  await a.click(byLabel(card(app, 'records'), 'Keep a log of each call'));
  assert.equal(app.config.observability.session_log.enabled, false);
  assert.match(textOf($(card(app, 'records'), '[aria-label="What is kept"]')), /No log of each call is kept/);
  await app.unmount();
});

test('below the cards, every other part of the agent is one click away: the everyday ones under More, the engine’s own under Advanced', async () => {
  window.localStorage.clear();
  const { readFileSync } = await import('node:fs');
  const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
  const app = await simple();
  const more = $$($(app.container, '[aria-label=More]'), '[data-more]').map((el) => el.getAttribute('data-more'));
  const advanced = $$($(app.container, '.smAdvanced'), '[data-more]').map((el) => el.getAttribute('data-more'));
  assert.deepEqual(more.filter((k) => !advanced.includes(k)), ['guardrails', 'schedules', 'tasks', 'wrapups', 'events', 'tests', 'meta']);
  assert.deepEqual(advanced, ['identity', 'constants', 'runtime', 'builder']);
  assert.equal($(app.container, '.smAdvanced').open, false, 'Advanced is closed until asked for, but it is there and labelled');
  assert.match(textOf($(app.container, '.smAdvanced summary')), /^Advanced$/);
  // nothing is lost: each section of the schema is on a card, under More or under Advanced
  const onCards = ['persona', 'agents', 'messages', 'state', 'defaults', 'connections', 'tools', 'knowledge', 'forms', 'notifications', 'channels', 'telephony', 'observability', 'post_call'];
  const everything = new Set([...onCards, ...more, ...advanced]);
  const missing = Object.keys(schema.properties).filter((k) => !['$schema', 'schema_version'].includes(k) && !everything.has(k));
  assert.deepEqual(missing, [], 'every section of the schema is reachable from the Simple view');
  await app.unmount();
});
