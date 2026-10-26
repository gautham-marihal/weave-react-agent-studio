import test from 'node:test';
import assert from 'node:assert/strict';
import { minimalConfig } from '../src/demo/minimalConfig.js';
import { buildChannel } from '../src/studio/form/presets.js';
import { FALLBACK, normalizeChannelTypes, FALLBACK_TYPES } from '../src/studio/form/channelTypes.js';
import { RECORDING_NOTICE, addChannel, firstLineOf, reachOf, setReach, shareFirstLine } from '../src/studio/setup/setupModel.js';
import { channelLabel, rowName } from '../src/studio/agent/rowNames.js';

// An agent's Channels page: the three reach choices at the top, Add a channel, and the rows of "All channels".
const fresh = () => minimalConfig('smile-dental', 'Smile Dental');
const PROVIDERS = [
  { name: 'deepgram', stages: ['stt'], installed: true, key_available: true },
  { name: 'cartesia', stages: ['stt', 'tts'], installed: true, key_available: true },
];
const withChannel = (config, presetId, extra = {}) => ({
  ...config,
  channels: [...config.channels, { ...buildChannel(presetId, { taken: config.channels.map((c) => c.id), botId: 'smile-dental' }), ...extra }],
});

test('channels: the last of the three choices can be switched off while a channel of another kind that runs is still on', () => {
  const kiosk = {
    ...fresh(),
    channels: [...fresh().channels, { id: 'kiosk', type: 'custom', enabled: true, modalities: { input: ['text'], output: ['text'] } }],
  };
  const result = setReach(kiosk, 'web_chat', false);
  assert.equal(result.refused, '');
  assert.deepEqual(reachOf(result.config), { web_chat: false, web_voice: false, sip_voice: false });
  assert.equal(result.config.channels.find((c) => c.id === 'kiosk').enabled, true);
});

test('channels: a channel of a kind that does not run yet does not count, and the refusal says why', () => {
  const whatsapp = withChannel(fresh(), 'whatsapp');
  const refused = setReach(whatsapp, 'web_chat', false);
  assert.equal(refused.config, whatsapp, 'unchanged');
  assert.equal(refused.refused, 'It needs at least one way for people to reach it, and WhatsApp can’t take conversations yet.');
  const two = withChannel(withChannel(fresh(), 'sms'), 'email');
  assert.match(setReach(two, 'web_chat', false).refused, /SMS and email can’t take conversations yet\.$/);
  // switched off by hand, it is not mentioned
  assert.equal(setReach(withChannel(fresh(), 'whatsapp', { enabled: false }), 'web_chat', false).refused, 'It needs at least one way for people to reach it.');
  // once the server says WhatsApp runs, it counts
  const running = normalizeChannelTypes(FALLBACK_TYPES.map((t) => (t.type === 'whatsapp' ? { ...t, runs_today: true } : t)));
  assert.equal(setReach(whatsapp, 'web_chat', false, { types: running }).refused, '');
  assert.equal(setReach(whatsapp, 'web_chat', false, { types: FALLBACK }).refused.length > 0, true);
});

test('channels: a channel added with Add says the agent’s first line, and a voice one brings speech models and the recording notice', () => {
  const config = fresh();
  const phone = addChannel(config, buildChannel('phone', { taken: ['web-chat'], botId: 'smile-dental' }), { providers: PROVIDERS });
  const line = phone.channels.at(-1);
  assert.equal(line.type, 'sip_voice');
  assert.equal(line.greeting.say, config.channels[0].greeting.say, 'the same first line as the others');
  assert.ok(phone.defaults.models.stt?.provider && phone.defaults.models.tts?.provider, 'speech models, so the configuration stays valid');
  assert.equal(phone.persona.disclosures.recording_notice, RECORDING_NOTICE);
  assert.equal(config.channels.length, 1, 'the configuration given is not changed');

  // a chat brings no speech models; a kind that waits for the person keeps waiting
  const chat = addChannel(config, buildChannel('web_chat', { taken: ['web-chat'] }), { providers: PROVIDERS });
  assert.equal(chat.defaults.models.stt, undefined);
  assert.equal(chat.persona.disclosures, undefined);
  assert.equal(chat.channels.at(-1).greeting.say, config.channels[0].greeting.say);
  assert.equal(addChannel(config, buildChannel('sms', { taken: ['web-chat'] })).channels.at(-1).greeting, undefined);

  // a recording notice already written is kept
  const noticed = { ...config, persona: { ...config.persona, disclosures: { recording_notice: 'Calls are recorded.' } } };
  assert.equal(addChannel(noticed, buildChannel('web_voice'), { providers: PROVIDERS }).persona.disclosures.recording_notice, 'Calls are recorded.');
});

test('channels: a first line that is one of the fixed lines is shared as that line, so its translations come too; an empty one is not copied', () => {
  const config = fresh();
  config.messages = [{ id: 'hello', text: { 'en-US': 'Hello there', 'es-ES': 'Hola' } }];
  config.channels[0].greeting = { say: { message: 'hello' } };
  const phone = setReach(config, 'sip_voice', true, { providers: PROVIDERS }).config;
  assert.deepEqual(phone.channels.at(-1).greeting.say, { message: 'hello' });

  const blank = fresh();
  blank.channels[0].greeting = { say: '' };
  const voice = setReach(blank, 'web_voice', true, { providers: PROVIDERS }).config;
  assert.ok(voice.channels.at(-1).greeting.say.trim(), 'the new channel keeps its own line rather than an empty one');
});

test('channels: switching the reach choices still works as before (off keeps the channel, on again does not add a second)', () => {
  let config = setReach(fresh(), 'sip_voice', true, { providers: PROVIDERS }).config;
  assert.equal(config.channels.find((c) => c.type === 'sip_voice').id, 'phone');
  config = setReach(config, 'sip_voice', false).config;
  assert.equal(config.channels.find((c) => c.type === 'sip_voice').enabled, false);
  const back = setReach(config, 'sip_voice', true, { providers: PROVIDERS }).config;
  assert.equal(back.channels.filter((c) => c.type === 'sip_voice').length, 1);
  assert.equal(back.channels.find((c) => c.type === 'sip_voice').enabled, true);
  // the only channel that runs, switched off, is refused
  assert.match(setReach(fresh(), 'web_chat', false).refused, /^It needs at least one way/);
});

test('channels: a second channel of one kind gets an id that does not read the same as the first, and look-alike rows are told apart', () => {
  // minimalConfig's chat is "web-chat"; a second chat used to be "web_chat", and both rows read "Web chat · Web chat"
  assert.equal(buildChannel('web_chat', { taken: ['web-chat'] }).id, 'web_chat_2');
  assert.equal(buildChannel('phone', { taken: ['web-chat'] }).id, 'phone');
  const config = withChannel(fresh(), 'web_chat');
  const titles = config.channels.map((c, i) => rowName('channels', c, i, config).title);
  assert.equal(new Set(titles).size, 2, titles.join(' / '));

  // a configuration that already has both look-alikes: their ids say nothing more than the kind, so they are numbered
  const old = { ...fresh(), channels: [...fresh().channels, { ...buildChannel('web_chat'), id: 'web_chat' }] };
  assert.deepEqual(
    old.channels.map((c, i) => rowName('channels', c, i, old).title),
    ['Chat on your website', 'Chat on your website 2'],
  );
  // ids that do say something are kept beside the kind
  const two = { ...fresh(), channels: [...fresh().channels, { ...buildChannel('web_chat'), id: 'support_site' }] };
  assert.equal(rowName('channels', two.channels[1], 1, two).title, 'Chat on your website · Support site');
  // one of a kind is named by its kind alone (the switches' words), a custom one too
  assert.equal(rowName('channels', fresh().channels[0], 0, fresh()).title, 'Chat on your website');
  const kiosk = { id: 'kiosk', type: 'custom', enabled: true, modalities: { input: ['text'], output: ['text'] } };
  assert.equal(rowName('channels', kiosk, 1, { channels: [fresh().channels[0], kiosk] }).title, 'Custom');
});

test('channels: elsewhere (a scenario’s channel) a channel is named as its row is; an id the agent does not have stays as written', () => {
  const two = { ...fresh(), channels: [...fresh().channels, { ...buildChannel('web_chat'), id: 'support_site' }] };
  assert.equal(channelLabel(fresh(), 'web-chat'), 'Chat on your website');
  assert.equal(channelLabel(two, 'support_site'), 'Chat on your website · Support site');
  assert.equal(channelLabel(two, 'kiosk'), 'kiosk');
  assert.equal(channelLabel({}, undefined), '');
});

test('channels: a channel left waiting for the person to start can be given the agent’s first line again', () => {
  const config = setReach(fresh(), 'sip_voice', true, { providers: PROVIDERS }).config;
  delete config.channels[1].greeting; // its first line deleted in its panel
  assert.equal(firstLineOf(config), 'Hello! How can I help you today?');
  const shared = shareFirstLine(config, 1);
  assert.deepEqual(shared.channels[1].greeting, { say: 'Hello! How can I help you today?' });
  assert.equal(config.channels[1].greeting, undefined, 'the configuration given is not changed');
  // what else its greeting has is kept
  config.channels[1].greeting = { allow_interruptions: false };
  assert.deepEqual(shareFirstLine(config, 1).channels[1].greeting, { allow_interruptions: false, say: 'Hello! How can I help you today?' });
  // with no first line anywhere there is nothing to give
  const silent = fresh();
  delete silent.channels[0].greeting;
  assert.equal(firstLineOf(silent), undefined);
  assert.equal(shareFirstLine(silent, 0), silent);
});
