import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FALLBACK,
  FALLBACK_TYPES,
  allowedModalities,
  browserChannels,
  canForms,
  canKeypad,
  entryFieldsFor,
  findVoiceOnly,
  stripVoiceOnly,
  plainSetting,
  withArticle,
  infoOf,
  isVoiceChannel,
  keysNotOffered,
  mislabelledChat,
  modalityChoices,
  normalizeChannelTypes,
  notRunningYet,
} from '../src/studio/form/channelTypes.js';
import { drawsVoice } from '../src/studio/test/channels.js';
import { createDemoApi, memoryStorage } from '../src/demo/demoApi.js';

// FRONTEND_GUIDE 3.md, "Options that depend on the channel": a screen offers only what a kind of channel can have. The table is GET /channel-types; the fallback is a copy
// of what the real server answered on 2026-10-17.
const config = () => ({
  channels: [
    { id: 'phone', type: 'sip_voice', enabled: true, modalities: { input: ['audio'], output: ['audio'] } },
    { id: 'chat', type: 'web_chat', enabled: true, modalities: { input: ['text'], output: ['text'] } },
    { id: 'talk', type: 'web_voice', enabled: true, modalities: { input: ['audio'], output: ['audio'] } },
    { id: 'off', type: 'web_voice', enabled: false },
    { id: 'text', type: 'sms', enabled: true, modalities: { input: ['text'], output: ['text'] } },
  ],
});

test('the server’s answer is read as it comes ({ types }), and an odd one is read too', () => {
  const rows = normalizeChannelTypes({ types: FALLBACK_TYPES, note: 'x' });
  assert.equal(rows.length, 7);
  const phone = infoOf(rows, 'sip_voice');
  assert.deepEqual([phone.canKeypad, phone.canForms, phone.voice, phone.runsToday], [true, false, true, true]);
  assert.deepEqual(phone.entryFields, ['dnis', 'sip_trunk', 'dispatch_rule']);
  assert.equal(infoOf(rows, 'custom').entryFields, null, 'null means any');
  assert.equal(normalizeChannelTypes(FALLBACK_TYPES).length, 7, 'a bare list is read too');
  assert.deepEqual(normalizeChannelTypes({ types: [{ nothing: true }, null] }), [], 'a row with no kind is dropped');
  assert.deepEqual(normalizeChannelTypes(null), []);
  assert.equal(FALLBACK.length, 7);
});

test('a phone line is audio only with a keypad and no screen; a web channel is the other way round', () => {
  assert.deepEqual(allowedModalities(FALLBACK, 'sip_voice', 'input'), ['audio']);
  assert.deepEqual(allowedModalities(FALLBACK, 'web_chat', 'input'), ['audio', 'text', 'image', 'video']);
  assert.deepEqual(allowedModalities(FALLBACK, 'web_chat', 'output'), ['audio', 'text']);
  assert.deepEqual(allowedModalities(FALLBACK, 'sms', 'input'), ['text']);
  assert.equal(allowedModalities(FALLBACK, 'mystery', 'input'), null, 'a kind this studio has not met is not restricted');
  assert.equal(canKeypad(FALLBACK, 'sip_voice'), true);
  assert.equal(canKeypad(FALLBACK, 'web_chat'), false);
  assert.equal(canForms(FALLBACK, 'sip_voice'), false);
  assert.equal(canForms(FALLBACK, 'web_voice'), true);
  assert.equal(canKeypad(FALLBACK, 'custom'), true, 'a custom channel is not restricted');
  assert.equal(canKeypad(FALLBACK, 'mystery'), true);
  assert.deepEqual(entryFieldsFor(FALLBACK, 'sms'), []);
  assert.equal(entryFieldsFor(FALLBACK, 'custom'), null);
});

test('kinds nothing connects to the runtime yet are known', () => {
  ['whatsapp', 'sms', 'email'].forEach((t) => assert.equal(notRunningYet(FALLBACK, t), true, t));
  ['sip_voice', 'web_voice', 'web_chat', 'custom'].forEach((t) => assert.equal(notRunningYet(FALLBACK, t), false, t));
  assert.equal(notRunningYet(null, 'sms'), false, 'nothing is claimed without the table');
});

test('a channel has a voice by what it carries, not only by its kind', () => {
  const c = config().channels;
  assert.equal(isVoiceChannel(c[0], FALLBACK), true);
  // the guide: "`voice` is true for the type, or its modalities list audio"
  assert.equal(isVoiceChannel(c[1], FALLBACK), true, 'a web chat can carry audio, so its kind has a voice');
  assert.equal(isVoiceChannel(c[4], FALLBACK), false, 'an sms never does');
  assert.equal(isVoiceChannel({ type: 'custom', modalities: { input: ['text'], output: ['text'] } }, FALLBACK), true, 'a custom channel is not restricted');
  assert.equal(isVoiceChannel({ type: 'web_voice', modalities: { input: ['text'], output: ['text'] } }, FALLBACK), true);
  assert.equal(
    isVoiceChannel({ type: 'mystery', modalities: { input: ['text'], output: ['text'] } }, FALLBACK),
    false,
    'an unknown kind has a voice only if it says so',
  );
  assert.equal(isVoiceChannel({ type: 'mystery', modalities: { input: ['audio'], output: ['text'] } }, FALLBACK), true);
  assert.equal(isVoiceChannel({ type: 'web_chat', modalities: { input: ['text'], output: ['audio'] } }, FALLBACK), true);
});

test('voice-only settings are not offered on a channel with no voice, and are on one that has', () => {
  const c = config();
  assert.deepEqual(keysNotOffered(c, FALLBACK, ['channels', 4, 'overrides', 'conversation']), ['sounds', 'speech', 'noise_cancellation', 'ivr_detection']);
  assert.deepEqual(keysNotOffered(c, FALLBACK, ['channels', 4, 'overrides', 'models']), ['stt', 'tts', 'realtime', 'vad', 'turn_detector']);
  assert.deepEqual(keysNotOffered(c, FALLBACK, ['channels', 0, 'overrides', 'conversation']), [], 'a phone line has a voice');
  assert.deepEqual(keysNotOffered(c, FALLBACK, ['channels', 1, 'overrides', 'conversation']), [], 'a web chat can carry audio, so it is offered them');
  assert.deepEqual(keysNotOffered(c, FALLBACK, ['defaults', 'conversation']), [], 'only a channel’s overrides');
  assert.deepEqual(keysNotOffered(c, FALLBACK, ['channels', 4, 'overrides']), []);
});

test('a channel’s tick boxes are the kind’s own; a ticked value it cannot carry is kept, to be seen and removed', () => {
  const c = config();
  assert.deepEqual(modalityChoices(c, FALLBACK, ['channels', 0, 'modalities', 'input'], ['audio']), { allowed: ['audio'], extra: [] });
  assert.deepEqual(modalityChoices(c, FALLBACK, ['channels', 0, 'modalities', 'input'], ['audio', 'text']), { allowed: ['audio'], extra: ['text'] });
  assert.deepEqual(modalityChoices(c, FALLBACK, ['channels', 1, 'modalities', 'output'], ['text']).allowed, ['audio', 'text']);
  assert.equal(modalityChoices(c, FALLBACK, ['channels', 1, 'greeting'], []), null, 'any other path is not one');
  assert.equal(modalityChoices(c, FALLBACK, ['agents', 0, 'modalities', 'input'], []), null);
});

test('a web chat that carries audio is a web voice channel by another name', () => {
  assert.equal(mislabelledChat({ type: 'web_chat', modalities: { input: ['text', 'audio'], output: ['text'] } }), true);
  assert.equal(mislabelledChat({ type: 'web_chat', modalities: { input: ['text'], output: ['audio'] } }), true);
  assert.equal(mislabelledChat({ type: 'web_chat', modalities: { input: ['text'], output: ['text'] } }), false);
  assert.equal(mislabelledChat({ type: 'web_voice', modalities: { input: ['audio'], output: ['audio'] } }), false);
});

test('the Test tab offers every enabled web channel, in order, and draws the widget by what the session carries', () => {
  assert.deepEqual(
    browserChannels(config()).map((c) => [c.id, c.type]),
    [
      ['chat', 'web_chat'],
      ['talk', 'web_voice'],
    ],
    'a phone line and a switched-off channel are not offered',
  );
  assert.deepEqual(browserChannels(null), []);
  assert.equal(drawsVoice({ type: 'web_voice', input: ['audio'] }), true);
  assert.equal(drawsVoice({ type: 'web_chat', input: ['text', 'audio'], output: ['text'] }), true, 'a chat that carries audio gets the microphone');
  assert.equal(drawsVoice({ type: 'web_chat', input: ['text'], output: ['text'] }), false);
  assert.equal(drawsVoice(null), false);
});

test('the demo API answers the table in the server’s shape', async () => {
  const api = createDemoApi({ seed: false, storage: memoryStorage() });
  const answer = await api.handle('GET', '/channel-types');
  assert.equal(answer.status, 200);
  assert.equal(normalizeChannelTypes(answer.body).length, 7);
});

test('the voice-only settings found on a channel are named, so a text channel can say they do nothing', () => {
  assert.deepEqual(findVoiceOnly({ conversation: { sounds: {}, inactivity: {} }, models: { stt: {}, llm: {} } }), ['conversation.sounds', 'models.stt']);
  assert.deepEqual(findVoiceOnly({ conversation: { inactivity: {} } }), []);
  assert.deepEqual(findVoiceOnly(undefined), []);
});

// With CONFORMANCE_SERVER=1 (and AGENT_BUILDER_URL / AGENT_BUILDER_API_KEY) the built-in copy is held against what the server really answers, so it cannot drift.
const askServer = process.env.CONFORMANCE_SERVER === '1';
test(
  'the built-in table of channel kinds equals what the server answers',
  { skip: !askServer && 'set CONFORMANCE_SERVER=1 (and AGENT_BUILDER_URL, AGENT_BUILDER_API_KEY) to ask the server' },
  async () => {
    const base = process.env.AGENT_BUILDER_URL || 'http://localhost:8100';
    const headers = process.env.AGENT_BUILDER_API_KEY ? { Authorization: `Bearer ${process.env.AGENT_BUILDER_API_KEY}` } : {};
    const real = normalizeChannelTypes(await (await fetch(`${base}/channel-types`, { headers })).json());
    assert.deepEqual(real, FALLBACK, 'update FALLBACK_TYPES in channelTypes.js to match the server');
  },
);

test('the voice-only settings can be taken out of a channel’s overrides, leaving the rest', () => {
  const both = { conversation: { sounds: {}, inactivity: { timeout_s: 8 } }, models: { stt: {}, llm: { model: 'x' } } };
  assert.deepEqual(stripVoiceOnly(both), {
    overrides: { conversation: { inactivity: { timeout_s: 8 } }, models: { llm: { model: 'x' } } },
    removed: ['conversation.sounds', 'models.stt'],
  });
  assert.deepEqual(
    stripVoiceOnly({ conversation: { sounds: {} } }),
    { overrides: undefined, removed: ['conversation.sounds'] },
    'nothing left, so no overrides at all',
  );
  assert.deepEqual(stripVoiceOnly({ conversation: { inactivity: {} } }), { overrides: { conversation: { inactivity: {} } }, removed: [] });
  assert.deepEqual(stripVoiceOnly(undefined), { overrides: undefined, removed: [] });
  assert.equal(JSON.stringify(both).includes('sounds'), true, 'the argument is not changed');
});

test('a component switched off on a text channel (null) is not a voice-only setting at work', () => {
  assert.deepEqual(findVoiceOnly({ models: { tts: null, stt: null } }), [], 'null is how a text channel has no text-to-speech');
  assert.deepEqual(stripVoiceOnly({ models: { tts: null, stt: { provider: 'x' } } }), { overrides: { models: { tts: null } }, removed: ['models.stt'] });
});

test('a server row that leaves out a list does not empty the channel, and nothing narrows what it did not restrict', () => {
  const rows = normalizeChannelTypes({ types: [{ type: 'web_chat' }] });
  assert.equal(rows[0].input, null);
  assert.equal(allowedModalities(rows, 'web_chat', 'input'), null, 'not restricted');
  const c = { channels: [{ type: 'web_chat', modalities: { input: ['text'], output: ['text'] } }] };
  assert.equal(modalityChoices(c, rows, ['channels', 0, 'modalities', 'input'], ['text']), null, 'every box stays');
});

test('settings are named the way the form draws them, and “an” goes before a vowel', () => {
  assert.equal(plainSetting('conversation.sounds'), 'background and waiting sounds');
  assert.equal(plainSetting('entry.sip_trunk'), 'the sip trunk field');
  assert.equal(plainSetting('something.new'), 'something.new');
  assert.equal(withArticle('Cartesia'), 'a Cartesia');
  assert.equal(withArticle('ElevenLabs'), 'an ElevenLabs');
});
