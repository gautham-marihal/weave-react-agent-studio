import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../src/studio/form/engine.js';
import { CHANNEL_PRESETS, ENTRY_FIELDS, buildChannel, changeChannelType, defaultsForType, modalityNotes } from '../src/studio/form/presets.js';

const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const engine = createEngine(schema);
const channelSchema = schema.$defs.channel;

test('every preset is a complete channel that satisfies the schema', () => {
  for (const preset of CHANNEL_PRESETS) {
    const channel = buildChannel(preset.id, { botId: 'acme' });
    assert.equal(channel.type, preset.type);
    assert.equal(channel.enabled, true);
    assert.ok(channel.modalities.input.length && channel.modalities.output.length, `${preset.id}: modalities`);
    assert.ok(engine.fits(channelSchema, channel), `${preset.id} does not fit the channel schema: ${JSON.stringify(channel)}`);
  }
});

test('a phone line has an entry, a web chat has its widget id, and neither starts with a made-up number', () => {
  const phone = buildChannel('phone', { botId: 'acme' });
  assert.deepEqual(phone.entry, {});
  assert.deepEqual(phone.capabilities, { dtmf: true, human_transfer: true });
  const chat = buildChannel('web_chat', { botId: 'acme' });
  assert.equal(chat.entry.widget_id, 'acme-widget');
  assert.equal(chat.greeting.say, 'Hi! How can I help you today?');
  assert.equal(buildChannel('web_chat').entry.widget_id, 'agent-widget');
  assert.equal(buildChannel('sms').greeting, undefined);
  assert.equal(buildChannel('email').entry, undefined);
});

test('ids come from the kind and a counter only when taken', () => {
  assert.equal(buildChannel('phone', { taken: [] }).id, 'phone');
  assert.equal(buildChannel('phone', { taken: ['phone'] }).id, 'phone_2');
  assert.equal(buildChannel('web_chat', { taken: ['phone', 'web_chat', 'web_chat_2'] }).id, 'web_chat_3');
});

test('changing the type clears the entry fields that belong to the old type and adds what the new one needs', () => {
  const phone = { ...buildChannel('phone', { botId: 'acme' }), entry: { dnis: '+15550100', sip_trunk: 'main' }, match: { participant_kind: ['sip'] } };
  const { channel, cleared } = changeChannelType(phone, 'web_chat', 'acme');
  assert.equal(channel.type, 'web_chat');
  assert.deepEqual(channel.entry, { widget_id: 'acme-widget' }); // the phone fields are gone, the widget id appears
  assert.deepEqual(cleared.sort(), ['entry.dnis', 'entry.sip_trunk', 'match']);
  assert.equal(channel.match, undefined);
  assert.deepEqual(channel.modalities, { input: ['text'], output: ['text'] }); // they were the phone's untouched defaults
  assert.deepEqual(channel.capabilities, { forms: true });
  assert.ok(engine.fits(channelSchema, channel));
});

test('changing the type keeps what the person set, and does not ask about empty values', () => {
  const custom = {
    ...buildChannel('web_chat', { botId: 'acme' }),
    modalities: { input: ['text', 'image'], output: ['text'] },
    greeting: { say: 'Welcome to Acme!' },
    entry: { widget_id: 'x', allowed_origins: [] },
  };
  const { channel, cleared } = changeChannelType(custom, 'web_voice', 'acme');
  assert.deepEqual(channel.modalities, custom.modalities); // customised, so left alone
  assert.equal(channel.greeting.say, 'Welcome to Acme!');
  assert.deepEqual(cleared, []); // the empty allowed_origins list is not "something lost"
  const toPhone = changeChannelType(custom, 'sip_voice', 'acme');
  assert.deepEqual(toPhone.channel.entry, {});
  // a phone line carries audio only, so a chat's text and image cannot come along: they are cleared (and named), and the kind's own default is used
  assert.deepEqual(toPhone.cleared.sort(), ['entry.widget_id', 'modalities']);
  assert.deepEqual(toPhone.channel.modalities, { input: ['audio'], output: ['audio'] });
  assert.ok(engine.fits(channelSchema, toPhone.channel));
});

test('each type says which entry fields apply, and none applies to sms or email', () => {
  assert.deepEqual(ENTRY_FIELDS.sip_voice, ['dnis', 'sip_trunk', 'dispatch_rule']);
  assert.deepEqual(ENTRY_FIELDS.web_chat, ['widget_id', 'allowed_origins']);
  assert.deepEqual(ENTRY_FIELDS.whatsapp, ['phone_number_id']);
  assert.deepEqual([ENTRY_FIELDS.sms, ENTRY_FIELDS.email], [[], []]);
  assert.equal(defaultsForType('custom').entry, undefined);
});

test('modalities say what they need from the rest of the config', () => {
  const channel = { modalities: { input: ['audio', 'image'], output: ['audio'] } };
  const none = modalityNotes(channel, { defaults: { models: { llm: { provider: 'openai' } } } });
  assert.deepEqual(
    none.filter((n) => n.level === 'warn').map((n) => n.text.split(' ').slice(0, 2).join(' ')),
    ['Audio in', 'Audio out', 'Images and'],
  );
  const ready = modalityNotes(channel, {
    defaults: { models: { stt: { provider: 'openai' }, tts: { provider: 'openai' }, llm: { provider: 'openai', vision: true } } },
  });
  assert.deepEqual(
    ready.filter((n) => n.level === 'warn'),
    [],
  );
  assert.deepEqual(modalityNotes({ modalities: { input: ['text'], output: ['text'] } }, {}), []);
});

test('changing the kind also drops a keypad or a form the new kind cannot have, and keeps what it can', () => {
  const phone = { ...buildChannel('phone', { botId: 'acme' }), capabilities: { dtmf: true, human_transfer: false } };
  const chat = changeChannelType(phone, 'web_chat', 'acme');
  assert.equal(chat.channel.capabilities.dtmf, undefined, 'a web chat has no keypad');
  assert.equal(chat.channel.capabilities.human_transfer, false, 'what it can keep is kept');
  assert.ok(chat.cleared.includes('capabilities.dtmf'));
  const web = { ...buildChannel('web_chat', { botId: 'acme' }), capabilities: { forms: true } };
  const sms = changeChannelType(web, 'sms', 'acme');
  assert.equal(sms.channel.capabilities, undefined, 'sms has no screen for a form');
  const custom = changeChannelType(phone, 'custom', 'acme');
  assert.equal(custom.channel.capabilities.dtmf, true, 'a custom channel is not restricted');
});

test('changing the kind to one with no voice drops the voice-only settings, and to one with no pictures drops their settings', () => {
  const voice = {
    ...buildChannel('web_voice', { botId: 'acme' }),
    overrides: { conversation: { sounds: { ambient: {} }, inactivity: { timeout_s: 8 } }, models: { stt: { provider: 'deepgram' }, llm: { model: 'x' } } },
    inputs: { image: { max_bytes: 1000 }, video: { screen_share: true } },
  };
  const sms = changeChannelType(voice, 'sms', 'acme');
  assert.deepEqual(
    sms.channel.overrides,
    { conversation: { inactivity: { timeout_s: 8 } }, models: { llm: { model: 'x' } } },
    'what a text channel can use is kept',
  );
  assert.equal(sms.channel.inputs, undefined, 'an sms takes no pictures or video');
  ['conversation.sounds', 'models.stt', 'inputs.image', 'inputs.video'].forEach((n) => assert.ok(sms.cleared.includes(n), n));
  const chat = changeChannelType(voice, 'web_chat', 'acme');
  assert.ok(chat.channel.overrides.conversation.sounds, 'a web chat can carry audio, so its sounds stay (the guide: a kind with a voice)');
  assert.deepEqual(chat.channel.inputs, voice.inputs, 'a web chat can take pictures and video');
  const phone = changeChannelType({ ...voice, inputs: undefined }, 'sip_voice', 'acme');
  assert.ok(phone.channel.overrides.conversation.sounds, 'a phone line has a voice: its sounds stay');
});

test('a kind the server did not give limits for is not narrowed when the channel changes kind', () => {
  const rows = [
    {
      type: 'web_chat',
      label: 'Web chat',
      runsToday: true,
      input: null,
      output: null,
      voice: true,
      canKeypad: false,
      canForms: true,
      entryFields: [],
      defaultModalities: { input: [], output: [] },
    },
  ];
  const phone = { ...buildChannel('phone', { botId: 'acme' }), modalities: { input: ['audio', 'text'], output: ['audio'] } };
  const out = changeChannelType(phone, 'web_chat', 'acme', rows);
  assert.deepEqual(out.channel.modalities.input, ['audio', 'text'], 'nothing is dropped when nothing was restricted');
  assert.ok(out.channel.modalities.output.length >= 1, 'never an empty list (the schema needs one)');
});
