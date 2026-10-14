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
  const custom = { ...buildChannel('web_chat', { botId: 'acme' }), modalities: { input: ['text', 'image'], output: ['text'] }, greeting: { say: 'Welcome to Acme!' }, entry: { widget_id: 'x', allowed_origins: [] } };
  const { channel, cleared } = changeChannelType(custom, 'web_voice', 'acme');
  assert.deepEqual(channel.modalities, custom.modalities); // customised, so left alone
  assert.equal(channel.greeting.say, 'Welcome to Acme!');
  assert.deepEqual(cleared, []); // the empty allowed_origins list is not "something lost"
  const toPhone = changeChannelType(custom, 'sip_voice', 'acme');
  assert.deepEqual(toPhone.channel.entry, {});
  assert.deepEqual(toPhone.cleared, ['entry.widget_id']);
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
  assert.deepEqual(none.filter((n) => n.level === 'warn').map((n) => n.text.split(' ').slice(0, 2).join(' ')), ['Audio in', 'Audio out', 'Images and']);
  const ready = modalityNotes(channel, { defaults: { models: { stt: { provider: 'openai' }, tts: { provider: 'openai' }, llm: { provider: 'openai', vision: true } } } });
  assert.deepEqual(ready.filter((n) => n.level === 'warn'), []);
  assert.deepEqual(modalityNotes({ modalities: { input: ['text'], output: ['text'] } }, {}), []);
});
