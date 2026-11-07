// Every Build setting drives the agent (the 2026-11-07 "nothing hard-coded" review): what a control writes is what the
// agent uses, a shared line or a server-listed choice is never dropped, and settings that don't work together say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStarter } from '../src/studio/starters.ts';
import { minimalConfig } from '../src/demo/demoApi.js';
import { setPrimaryLanguage, channelGreetingTarget } from '../src/studio/simple/simpleModel.js';
import { SCHEDULES_START, agentZone } from '../src/studio/agent/pageLists.js';
import { searchToolsLost, passagesOf, setPassages, setBaseMode } from '../src/studio/setup/setupKnowledge.js';
import { lineOf, setLine, fixedLineNote } from '../src/studio/form/speechLine.js';
import { setTransferSay, transferSayOf } from '../src/studio/workflow/workflowOps.js';
import { inputCapabilities } from '../src/studio/preview/useDictation.js';
import { channelPictures } from '../src/studio/pictures/mediaModel.js';
import { modalityNotes, channelModels } from '../src/studio/form/presets.js';
import { toolNotRun } from '../src/studio/form/toolInfo.js';
import { seesPictures } from '../src/studio/models/catalog.js';
import { settingConflicts } from '../src/studio/agent/conflicts.js';
import { buildSections } from '../src/studio/agent/buildSections.js';
import { readinessSteps } from '../src/studio/agent/readiness.js';
import { readKnowledge } from '../src/studio/agent/detailed/knowledgeWorkspace/knowledgeWords.js';

const agent = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const clone = (v) => JSON.parse(JSON.stringify(v));

test('the language speech is heard in follows the main language, unless it was set to another on purpose', () => {
  const base = (stt, own) => ({
    defaults: { language: { primary: 'en-SG', speaks: ['en'] }, models: { llm: { provider: 'openai' }, stt: { provider: 'openai', language: stt } } },
    channels: [{ id: 'web', type: 'web_voice', overrides: { models: { stt: { language: own } } } }],
  });
  const ja = setPrimaryLanguage(base('en', 'en-SG'), 'ja-JP');
  assert.equal(ja.defaults.models.stt.language, 'ja', 'a base language stays a base language');
  assert.equal(ja.channels[0].overrides.models.stt.language, 'ja-JP', 'a locale stays a locale');
  const kept = setPrimaryLanguage(base('fr', 'en-US'), 'ja-JP');
  assert.equal(kept.defaults.models.stt.language, 'fr', 'another language chosen on purpose is kept');
  assert.equal(kept.channels[0].overrides.models.stt.language, 'en-US', 'and so is another locale of the old one');
});

test('new business hours are in the agent’s own time zone', () => {
  const c = { runtime: { timezone: 'Asia/Singapore' } };
  assert.equal(agentZone(c), 'Asia/Singapore');
  assert.equal(SCHEDULES_START.make(c).schedules.business_hours.timezone, 'Asia/Singapore');
  assert.ok(agentZone({}), 'without one, this computer’s');
});

test('a channel’s greeting field says when the line is shared, and an empty one waits', () => {
  const c = {
    channels: [
      { id: 'chat', type: 'web_chat', greeting: { say: 'Hi there' } },
      { id: 'voice', type: 'web_voice', greeting: { say: 'Hi there' } },
    ],
  };
  assert.equal(channelGreetingTarget(c, 0).length, 2, 'both channels say the line, so the field changes both (and says so)');
  const apart = clone(c);
  apart.channels[1].greeting.say = 'Hello';
  assert.equal(channelGreetingTarget(apart, 0).length, 1, 'a channel with its own line is its own');
});

test('a knowledge search’s number is the one it really uses, and switching to every turn says what it loses', () => {
  const c = {
    knowledge: [{ id: 'kb', type: 'vector_store', top_k: 4, sources: [] }],
    tools: [{ id: 'search_kb', type: 'knowledge', source: 'kb', top_k: 8, description: 'Look in the price list.' }],
    agents: { entry: 'a', items: [{ id: 'a', tools: ['search_kb'] }] },
  };
  assert.equal(passagesOf(c, 'kb'), 8, 'the search tool’s own number wins over its base’s');
  assert.equal(readKnowledge(c).topK, 8, 'and the sentence says it');
  const six = setPassages(c, 'kb', 6);
  assert.equal(six.knowledge[0].top_k, 6);
  assert.equal(six.tools[0].top_k, 6, 'set where it takes effect');
  assert.deepEqual(searchToolsLost(c, 'kb'), [{ id: 'search_kb', settings: ['its own description', 'top_k'] }]);
  assert.deepEqual(setBaseMode(c, 'kb', 'inject').tools, [], 'the server refuses a search tool on an every-turn base');
});

test('a fixed line is shown in its words and changed in place; emptied, it goes from that place only', () => {
  const c = {
    messages: [{ id: 'bye', text: { en: 'Goodbye.', es: 'Adiós.' } }],
    defaults: { language: { primary: 'en-GB' } },
    tools: [{ params: { say: { message: 'bye' } } }],
    x: { say: { message: 'bye' } },
  };
  assert.equal(lineOf(c, c.tools[0].params.say).text, 'Goodbye.');
  const changed = setLine(c, ['tools', 0, 'params', 'say'], 'Bye now.');
  assert.deepEqual(changed.messages[0].text, { en: 'Bye now.', es: 'Adiós.' }, 'its main language changes, its translations stay');
  assert.deepEqual(changed.tools[0].params.say, { message: 'bye' }, 'and the link');
  const emptied = setLine(c, ['tools', 0, 'params', 'say'], '');
  assert.equal(emptied.tools[0].params.say, undefined, 'emptied, this place says nothing');
  assert.deepEqual(emptied.messages[0].text, c.messages[0].text, 'and the fixed line is untouched for the others');
  assert.match(fixedLineNote(c, { message: 'bye' }), /used in 2 places/);
  assert.equal(setLine(c, ['y'], 'Plain.').y, 'Plain.', 'plain text is written where it stands');
});

test('the transfer’s line changes only that line; the other steps before it stay', () => {
  const c = {
    tools: [{ id: 'to_desk', type: 'builtin', builtin: 'transfer_or_callback', params: { transfer: 'desk' } }],
    telephony: {
      transfers: [
        {
          id: 'desk',
          before: [
            { type: 'say', text: 'One moment.' },
            { type: 'say', text: 'Connecting.' },
            { type: 'webhook', url: 'x' },
          ],
        },
      ],
    },
  };
  const next = setTransferSay(c, 'to_desk', 'Hold on.');
  assert.deepEqual(next.telephony.transfers[0].before, [
    { type: 'say', text: 'Hold on.' },
    { type: 'say', text: 'Connecting.' },
    { type: 'webhook', url: 'x' },
  ]);
  assert.equal(transferSayOf(next, 'to_desk'), 'Hold on.');
  assert.equal(setTransferSay(c, 'to_desk', '').telephony.transfers[0].before.length, 2, 'emptied, only its first line goes');
});

test('a channel whose camera is switched off offers no camera; unset limits are the ones the Media page says', () => {
  const channel = { id: 'w', type: 'web_chat', enabled: true, modalities: { input: ['text', 'image', 'video'] }, inputs: { video: { camera: false } } };
  const can = inputCapabilities({ channels: [channel] }, { id: 'w' });
  assert.equal(can.video, false);
  assert.deepEqual(can.image.acceptedMime, ['image/jpeg', 'image/png', 'image/webp']);
  assert.equal(can.image.maxBytes, 8 * 1024 * 1024);
  assert.equal(channelPictures({ channels: [channel] })[0].camera, false);
  const camera = clone(channel);
  delete camera.inputs;
  assert.equal(inputCapabilities({ channels: [camera] }, { id: 'w' }).video, true, 'unset, a channel that takes video has the camera');
});

test('a channel’s speech warnings use its own models', () => {
  const config = { defaults: { models: { llm: { provider: 'openai' }, stt: { provider: 'openai' }, tts: { provider: 'elevenlabs' } } } };
  const off = { modalities: { input: ['audio'], output: ['audio'] }, overrides: { models: { stt: null } } };
  assert.match(modalityNotes(off, config)[0].text, /this channel switches it off/);
  const own = { modalities: { input: ['audio'], output: ['audio'] }, overrides: { models: { tts: { provider: 'cartesia' } } } };
  assert.equal(
    modalityNotes(own, { defaults: { models: { llm: {}, stt: { provider: 'openai' } } } }).filter((n) => n.level === 'warn').length,
    0,
    'its own speaking model counts',
  );
  const rt = { modalities: { input: ['audio'], output: ['audio'] } };
  assert.equal(
    modalityNotes(rt, { defaults: { models: { realtime: { provider: 'openai', model: 'gpt-realtime' } } } }).filter((n) => n.level === 'warn').length,
    0,
    'a speech-to-speech model hears and speaks',
  );
  assert.equal(channelModels(off, config).stt, null);
});

test('once the draft is checked, the server’s word decides whether a tool runs', () => {
  const tool = { id: 'm', type: 'mcp' };
  const c = { tools: [tool] };
  assert.ok(toolNotRun(c, tool, null), 'not checked yet: the known list');
  assert.equal(toolNotRun(c, tool, []), null, 'checked, and nothing said: it runs');
  assert.equal(toolNotRun(c, tool, [{ feature: 'MCP tools', where: 'tools[0]' }]), 'MCP tools');
});

test('which listed models read pictures', () => {
  assert.equal(seesPictures('openai', 'gpt-4.1-mini'), true);
  assert.equal(seesPictures('groq', 'llama-3.3-70b-versatile'), false);
  assert.equal(seesPictures('openai_compatible', 'my-model'), null, 'one the list doesn’t know: not guessed');
});

test('settings that don’t work together are named, on the part to look at', () => {
  const c = agent();
  c.defaults.language = { primary: 'ja-JP', speaks: ['ja'], auto_detect: true };
  c.defaults.models.stt = { ...c.defaults.models.stt, language: 'ja' };
  c.defaults.conversation = { inactivity: { enabled: true, timeout_s: 30, max_nudges: 2, nudges: [] } };
  c.guardrails = { ...c.guardrails, limits: { max_silence_s: 20 } };
  c.channels = [
    ...c.channels,
    { id: 'phone', type: 'sip_voice', enabled: true, modalities: { input: ['audio'], output: ['audio'] } },
    { id: 'shots', type: 'web_chat', enabled: true, modalities: { input: ['text', 'image'], output: ['text'] }, inputs: { video: { screen_share: true } } },
  ];
  c.forms = [{ id: 'book', title: 'Book', fields: [] }];
  c.agents.items[0].on_enter = [{ type: 'send_form', form: 'book' }];
  c.agents.items.push({ id: 'solo', name: 'Solo', kind: 'standalone', handoffs: [{ id: 'h', to: c.agents.items[0].id }] });
  c.defaults.models.llm = { provider: 'groq', model: 'llama-3.3-70b-versatile' };
  c.channels[0].greeting = { say: 'Hello, thank you for calling. How can I help you?' };
  const found = settingConflicts(c);
  const on = (part, re) =>
    assert.ok(
      found.some((f) => f.part === part && re.test(f.text)),
      `${part}: ${re}`,
    );
  on('agent', /in English, but it speaks Japanese/);
  on('agent', /detects the caller’s language, but listening is fixed/);
  on('conversation', /silence limit \(20 s\) ends the call before its first check-in \(30 s\)/);
  on('connections', /can’t show forms, and “Book” has nothing to do instead/);
  on('subagents', /Solo answers on its own/);
  on('media', /can’t read them/);
  on('media', /Screen sharing is on for “shots”/);
  const sections = buildSections({ config: c });
  assert.equal(sections.find((s) => s.id === 'conversation').state, 'attention', 'and the side list marks the part');
  assert.deepEqual(settingConflicts(agent()), [], 'a starter has none');
});

test('models taken from LiveKit Inference are flagged: the lists offered use your own providers’ names', () => {
  const c = agent();
  c.runtime = { ...c.runtime, provider_mode: 'inference' };
  assert.ok(settingConflicts(c).some((f) => f.part === 'agent' && /LiveKit Inference/.test(f.text)));
});

test('a speech-to-speech model needs no speaking voice', () => {
  const c = agent();
  c.channels = [{ id: 'v', type: 'web_voice', enabled: true, modalities: { input: ['audio'], output: ['audio'] } }];
  delete c.defaults.models.tts;
  c.defaults.models.realtime = { provider: 'openai', model: 'gpt-realtime' };
  c.defaults.language = { primary: 'en-GB', speaks: ['en'] };
  assert.equal(readinessSteps({ config: c }).steps.find((s) => s.id === 'voice').state, 'done');
  assert.doesNotMatch(buildSections({ config: c }).find((s) => s.id === 'agent').status, /its voice/);
});
