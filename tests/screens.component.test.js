import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, actions, byLabel, byText, setupDom, teardownDom, textOf } from './component/dom.js';
import { applyStarter } from '../src/studio/starters.js';
import { minimalConfig } from '../src/demo/demoApi.js';

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

test('the Simple view is four cards, the first open, each saying in one line what it holds', async () => {
  window.localStorage.clear();
  const app = await simple();
  assert.deepEqual($$(app.container, '.smCard h3 strong').map(textOf), ['Instructions', 'Voice & Language', 'AI Model', 'Connections']);
  const heads = $$(app.container, '.smHead');
  assert.deepEqual(heads.map((h) => h.getAttribute('aria-expanded')), ['true', 'false', 'false', 'false']);
  assert.match(textOf($(card(app, 'model'), '.smTitle small')), /STT: none · LLM: OpenAI gpt-4\.1-mini · TTS: none/);
  assert.match(textOf($(card(app, 'connections'), '.smTitle small')), /0 connections · 2 tools · 1 secret/);
  assert.match(textOf($(card(app, 'instructions'), '.smBody')), /What should it do\?/);
  await a.click($(card(app, 'instructions'), '.smHead'));
  assert.equal($(card(app, 'instructions'), '.smBody'), null, 'a card closes when its title is pressed');
  assert.equal($(card(app, 'instructions'), '.smHead').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(JSON.parse(window.localStorage.getItem('weave_simple_open')), [], 'which cards are open is remembered');
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
  assert.deepEqual(chips.map((c) => c.replace(/\d+$/, '')), ['Persona', 'Agents', 'Messages', 'State']);
  assert.equal($(app.container, '[data-detail=instructions] .stFNavGroups'), null, 'no group tabs: it is embedded');
  assert.equal($(app.container, '[data-detail=connections]'), null, 'other cards are untouched');
  await a.click(byText(card(app, 'instructions'), 'button', 'Hide detailed settings'));
  assert.equal($(app.container, '[data-detail=instructions]'), null);
  await app.unmount();
});

test('Voice & Language: the main language makes the agent speak it; the main language can’t be switched off', async () => {
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
  assert.equal(byLabel(card(app, 'voice'), 'Recording notice'), null, 'a chat-only agent has no recording notice to set');
  await app.unmount();
});

test('Voice & Language: a voice agent asks for its recording notice, and a voice is chosen from its engine’s list', async () => {
  window.localStorage.clear();
  const config = agent();
  config.channels = [{ id: 'phone', type: 'sip_voice', enabled: true, modalities: { input: ['audio'], output: ['audio'] }, greeting: { say: 'Hi' } }];
  config.defaults.models = { ...config.defaults.models, stt: { provider: 'deepgram', model: 'nova-3' }, tts: { provider: 'elevenlabs', model: 'eleven_turbo_v2_5', voice_id: '' } };
  const app = await simple(config);
  const voice = await openCard(app, 'voice');
  await a.type(byLabel(voice, 'Recording notice'), 'Calls are recorded.');
  assert.equal(app.config.persona.disclosures.recording_notice, 'Calls are recorded.');
  const select = byLabel(card(app, 'voice'), 'Voice');
  const rachel = [...select.options].find((o) => /^Rachel/.test(o.text));
  assert.ok(rachel, 'ElevenLabs voices are offered');
  await a.choose(select, rachel.value);
  assert.equal(app.config.defaults.models.tts.voice_id, rachel.value);
  assert.match(textOf(card(app, 'voice')), /Voice engine: ElevenLabs/);
  // Female and male voices are listed one gender at a time; the list starts on Female
  const toggle = (name) => [...card(app, 'voice').querySelectorAll('.vgToggle button')].find((b) => b.textContent.startsWith(name));
  const names = () => [...byLabel(card(app, 'voice'), 'Voice').options].map((o) => o.text.split(' · ')[0]).filter((n) => n && !/^(Choose|Custom)/.test(n));
  assert.equal(toggle('Female').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(names(), ['Rachel', 'Bella', 'Elli']);
  await a.click(toggle('Male'));
  assert.deepEqual(names(), ['Adam', 'Antoni', 'Josh', 'Arnold', 'Sam']);
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

const scenarios = (config = agent(), props = {}) => mountScreen('scenarios', config, { ready: '.scTab', props });

test('Scenarios: it says runs are simulated, offers no real runner, and starts with an invitation', async () => {
  window.localStorage.clear();
  const app = await scenarios();
  assert.match(textOf($(app.container, '.scTab')), /Simulated runs\./);
  assert.match(textOf($(app.container, '.scTab')), /Real runs aren’t available yet/);
  assert.equal(byText($(app.container, '.scRunner'), 'button', 'Real agent').disabled, true);
  assert.match(textOf($(app.container, '.scEmpty')), /No scenarios yet/);
  assert.equal(byText(app.container, 'button', /Run all/).disabled, true);
  await app.unmount();
});

test('Scenarios: write one, it goes into the draft’s tests, run it, see what failed and why; the run is recorded', async () => {
  window.localStorage.clear();
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
  await a.click(byText(app.container, 'button', /Run all \(1\)/));
  const item = $(app.container, '.scItem');
  assert.match(textOf(item), /Failed/);
  assert.match(textOf(item), /No agent message matches \/refund\//);
  assert.match(textOf(item), /“escalate_to_human” is called/);
  assert.match(textOf($(app.container, '.scSummary')), /1 passed.*1 failed|0 passed · 1 failed/);
  assert.match(textOf($(app.container, '.scSummary')), /simulated/);
  assert.equal($$(app.container, '.scHistory li').length, 1);
  assert.equal(JSON.parse(window.localStorage.getItem('weave_scenario_runs:x')).length, 1, 'kept per agent in this browser');
  await app.unmount();
});

test('Scenarios: a scenario with mistakes isn’t added, and says what to fix; editing and deleting work', async () => {
  window.localStorage.clear();
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
  window.localStorage.clear();
  const app = await scenarios();
  await a.click(byText(app.container, 'button', 'Paste scenarios…'));
  await a.type(byLabel(app.container, 'Scenarios as JSON'), JSON.stringify([{ id: 'good', channel: 'web-chat', turns: [{ say: 'hi' }], expect: [{ said_matches: 'x' }] }, { id: 'bad', channel: 'nope', turns: [], expect: [] }]));
  await a.click(byText(app.container, 'button', 'Add them'));
  assert.deepEqual(app.config.tests.map((s) => s.id), ['good']);
  assert.match(textOf($(app.container, '.scImport [role=status]')), /Added 1 scenario/);
  assert.match(textOf($(app.container, '.scImport [role=status]')), /bad: .*no channel “nope”/);
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

test('Preview: in demo mode the real agent can’t be chosen, and a configuration problem is an error with a way to retry', async () => {
  window.localStorage.clear();
  const locked = await mountScreen('preview', agent(), { ready: '.pvPanel', props: { locked: true } });
  assert.equal(byText($(locked.container, '.pvPanel'), 'button', 'Real agent').disabled, true);
  assert.match(textOf($(locked.container, '.pvPanel')), /demo mode has none/);
  await locked.unmount();
});
