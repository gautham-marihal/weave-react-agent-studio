import { describe, expect, it } from 'vitest';
import type { AgentConfig, ChannelDefinition } from '../types/studio';
import type { ProvidersAnswer } from '../api/types';
import { unknownKeys } from '../test/schemaKeys';
import { normalizeChannelTypes } from './channelTypes';
import { ANSWER } from './channels.test.data';
import { RECORDING_NOTICE, firstLineOf, setReach } from './setup';
import {
  CHANNEL_PRESETS,
  ENTRY_FIELDS,
  addChannel,
  changeChannelType,
  channelHint,
  channelTitle,
  defaultsForType,
  greetingNote,
  modalityNotes,
  modalityWords,
  phoneLineWords,
  presetChannel,
  presetChoices,
  readNumbers,
  removeChannel,
  setRecordingNotice,
  shareFirstLine,
} from './channels';

const TYPES = normalizeChannelTypes(ANSWER);
const chs = (c: AgentConfig): ChannelDefinition[] => c.channels ?? [];
const last = <T,>(items: T[] | undefined): T => (items ?? [])[(items ?? []).length - 1];
const fresh = (): AgentConfig => ({
  schema_version: '1.2',
  meta: { id: 'smile-dental', name: 'Smile Dental', version: '0.1.0', status: 'draft' },
  runtime: { engine: 'livekit-agents', provider_mode: 'plugins' },
  defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini' } }, conversation: {} },
  persona: { name: 'Smile Dental' },
  channels: [{ id: 'web-chat', type: 'web_chat', enabled: true, entry: { widget_id: 'smile-dental-widget' }, modalities: { input: ['text'], output: ['text'] }, greeting: { say: 'Hello! How can I help you today?' } }],
  agents: { entry: 'assistant', items: [{ id: 'assistant', name: 'Smile Dental', kind: 'standalone', instructions: { role: 'Help.' }, tools: [] }] },
});
const PROVIDERS = {
  providers: [
    { name: 'deepgram', stages: ['stt'], installed: true, key_available: true },
    { name: 'cartesia', stages: ['stt', 'tts'], installed: true, key_available: true },
  ],
} as unknown as ProvidersAnswer;
const withChannel = (config: AgentConfig, presetId: string, extra: Partial<ChannelDefinition> = {}): AgentConfig => ({
  ...config,
  channels: [...(config.channels ?? []), { ...presetChannel(presetId, { taken: (config.channels ?? []).map((c) => c.id), botId: 'smile-dental' }), ...extra }],
});

describe('presets (Add a channel)', () => {
  it('every preset is a complete channel the schema allows', () => {
    for (const preset of CHANNEL_PRESETS) {
      const channel = presetChannel(preset.id, { botId: 'acme' });
      expect(channel.type).toBe(preset.type);
      expect(channel.enabled).toBe(true);
      expect(channel.modalities.input.length && channel.modalities.output.length).toBeTruthy();
      expect(unknownKeys({ channels: [channel] })).toEqual([]);
    }
  });

  it('a phone line has an entry, a web chat its widget id, and neither starts with a made-up number', () => {
    const phone = presetChannel('phone', { botId: 'acme' });
    expect(phone.entry).toEqual({});
    expect(phone.capabilities).toEqual({ dtmf: true, human_transfer: true });
    const chat = presetChannel('web_chat', { botId: 'acme' });
    expect(chat.entry.widget_id).toBe('acme-widget');
    expect(presetChannel('web_chat').entry.widget_id).toBe('agent-widget');
    expect(presetChannel('sms').greeting).toBeUndefined();
    expect(presetChannel('email').entry).toBeUndefined();
  });

  it('ids come from the kind, with a counter only when taken, never reading the same as one there', () => {
    expect(presetChannel('phone', { taken: [] }).id).toBe('phone');
    expect(presetChannel('phone', { taken: ['phone'] }).id).toBe('phone_2');
    expect(presetChannel('web_chat', { taken: ['phone', 'web_chat', 'web_chat_2'] }).id).toBe('web_chat_3');
    expect(presetChannel('web_chat', { taken: ['web-chat'] }).id).toBe('web_chat_2');
  });

  it('cards follow the server’s list: a kind it does not run is marked, one the agent has says so', () => {
    const cards = presetChoices(fresh(), TYPES);
    expect(cards.find((c) => c.id === 'whatsapp')?.badge).toBe('Not available yet');
    expect(cards.find((c) => c.id === 'web_chat')?.badge).toBe('Already added');
    expect(cards.find((c) => c.id === 'phone')?.badge).toBe('');
    // a kind the server does not list is not offered; without the list, every preset is
    const fewer = normalizeChannelTypes({ types: ANSWER.types.filter((t) => t.type !== 'email') });
    expect(presetChoices(fresh(), fewer).some((c) => c.id === 'email')).toBe(false);
    expect(presetChoices(fresh(), null)).toHaveLength(CHANNEL_PRESETS.length);
  });

  it('each type says which entry fields apply, and none applies to sms or email', () => {
    expect(ENTRY_FIELDS.sip_voice).toEqual(['dnis', 'sip_trunk', 'dispatch_rule']);
    expect([ENTRY_FIELDS.sms, ENTRY_FIELDS.email]).toEqual([[], []]);
    expect(defaultsForType('custom').entry).toBeUndefined();
  });
});

describe('changing a channel’s kind', () => {
  it('clears the entry fields of the old kind and adds what the new one needs', () => {
    const phone = { ...presetChannel('phone', { botId: 'acme' }), entry: { dnis: '+15550100', sip_trunk: 'main' }, match: { participant_kind: ['sip'] } };
    const { channel, cleared } = changeChannelType(phone, 'web_chat', 'acme', TYPES);
    expect(channel.entry).toEqual({ widget_id: 'acme-widget' });
    expect(cleared.sort()).toEqual(['entry.dnis', 'entry.sip_trunk', 'match']);
    expect(channel.modalities).toEqual({ input: ['text'], output: ['text'] });
    expect(channel.capabilities).toEqual({ forms: true });
    expect(unknownKeys({ channels: [channel] })).toEqual([]);
  });

  it('keeps what the person set, and a phone line drops what it cannot carry', () => {
    const custom = { ...presetChannel('web_chat', { botId: 'acme' }), modalities: { input: ['text', 'image'], output: ['text'] }, greeting: { say: 'Welcome to Acme!' }, entry: { widget_id: 'x', allowed_origins: [] } };
    const { channel, cleared } = changeChannelType(custom, 'web_voice', 'acme', TYPES);
    expect(channel.modalities).toEqual(custom.modalities);
    expect(channel.greeting?.say).toBe('Welcome to Acme!');
    expect(cleared).toEqual([]);
    const toPhone = changeChannelType(custom, 'sip_voice', 'acme', TYPES);
    expect(toPhone.channel.entry).toEqual({});
    expect(toPhone.cleared.sort()).toEqual(['entry.widget_id', 'modalities']);
    expect(toPhone.channel.modalities).toEqual({ input: ['audio'], output: ['audio'] });
  });

  it('drops a keypad or a form the new kind cannot have, and keeps what it can', () => {
    const phone = { ...presetChannel('phone', { botId: 'acme' }), capabilities: { dtmf: true, human_transfer: false } };
    const chat = changeChannelType(phone, 'web_chat', 'acme', TYPES);
    expect(chat.channel.capabilities?.dtmf).toBeUndefined();
    expect(chat.channel.capabilities?.human_transfer).toBe(false);
    expect(chat.cleared).toContain('capabilities.dtmf');
    expect(changeChannelType({ ...presetChannel('web_chat'), capabilities: { forms: true } }, 'sms', 'acme', TYPES).channel.capabilities).toBeUndefined();
    expect(changeChannelType(phone, 'custom', 'acme', TYPES).channel.capabilities?.dtmf).toBe(true);
  });

  it('to a kind with no voice drops voice-only settings, and to one with no pictures their settings', () => {
    const voice = {
      ...presetChannel('web_voice', { botId: 'acme' }),
      overrides: { conversation: { sounds: { ambient: {} }, inactivity: { timeout_s: 8 } }, models: { stt: { provider: 'deepgram' }, llm: { model: 'x' } } },
      inputs: { image: { max_bytes: 1000 }, video: { screen_share: true } },
    };
    const sms = changeChannelType(voice, 'sms', 'acme', TYPES);
    expect(sms.channel.overrides).toEqual({ conversation: { inactivity: { timeout_s: 8 } }, models: { llm: { model: 'x' } } });
    expect(sms.channel.inputs).toBeUndefined();
    ['conversation.sounds', 'models.stt', 'inputs.image', 'inputs.video'].forEach((n) => expect(sms.cleared).toContain(n));
    expect(changeChannelType(voice, 'web_chat', 'acme', TYPES).channel.inputs).toEqual(voice.inputs);
  });

  it('a kind the server gave no limits for (or no list at all) is not narrowed', () => {
    const loose = normalizeChannelTypes({ types: [{ type: 'web_chat', label: 'Web chat' }] });
    const phone = { ...presetChannel('phone', { botId: 'acme' }), modalities: { input: ['audio', 'text'], output: ['audio'] } };
    expect(changeChannelType(phone, 'web_chat', 'acme', loose).channel.modalities.input).toEqual(['audio', 'text']);
    expect(changeChannelType(phone, 'web_chat', 'acme', null).channel.modalities.input).toEqual(['audio', 'text']);
  });
});

describe('adding a channel', () => {
  it('says the agent’s first line, and a voice one brings speech models and offers (does not write) the recording notice', () => {
    const config = fresh();
    const phone = addChannel(config, presetChannel('phone', { taken: ['web-chat'], botId: 'smile-dental' }), { providers: PROVIDERS, types: TYPES });
    const line = last(phone.config.channels);
    expect(line.type).toBe('sip_voice');
    expect(line.greeting?.say).toBe(chs(config)[0].greeting?.say);
    expect(phone.config.defaults?.models?.stt?.provider && phone.config.defaults?.models?.tts?.provider).toBeTruthy();
    expect(phone.config.persona?.disclosures?.recording_notice).toBeUndefined();
    expect(phone.offerNotice).toBe(true);
    expect(phone.added.join(' ')).not.toMatch(/recording/);
    expect(config.channels).toHaveLength(1);

    const chat = addChannel(config, presetChannel('web_chat', { taken: ['web-chat'] }), { providers: PROVIDERS, types: TYPES });
    expect(chat.config.defaults?.models?.stt).toBeUndefined();
    expect(chat.offerNotice).toBe(false);
    expect(last(addChannel(config, presetChannel('sms', { taken: ['web-chat'] })).config.channels).greeting).toBeUndefined();
  });

  it('does not offer the notice when one is written, or when nothing is recorded', () => {
    const noticed = setRecordingNotice(fresh(), 'Calls are recorded.');
    const kept = addChannel(noticed, presetChannel('web_voice'), { providers: PROVIDERS, types: TYPES });
    expect(kept.config.persona?.disclosures?.recording_notice).toBe('Calls are recorded.');
    expect(kept.offerNotice).toBe(false);
    const quiet = { ...fresh(), post_call: { recording: { audio: false, transcript: false } } };
    expect(addChannel(quiet, presetChannel('web_voice'), { providers: PROVIDERS, types: TYPES }).offerNotice).toBe(false);
    expect(setRecordingNotice(fresh()).persona?.disclosures?.recording_notice).toBe(RECORDING_NOTICE);
  });

  it('takes a channel away by its place', () => {
    const two = withChannel(fresh(), 'phone');
    expect(chs(removeChannel(two, 0)).map((c) => c.id)).toEqual(['phone']);
    expect(two.channels).toHaveLength(2);
  });
});

describe('what a channel says first', () => {
  it('a fixed line is shared as that line; a channel waiting for the person can be given the agent’s first line', () => {
    const config = setReach(fresh(), 'sip_voice', true, { providers: PROVIDERS }).config;
    delete chs(config)[1].greeting;
    expect(firstLineOf(config)).toBe('Hello! How can I help you today?');
    expect(chs(shareFirstLine(config, 1))[1].greeting).toEqual({ say: 'Hello! How can I help you today?' });
    expect(chs(config)[1].greeting).toBeUndefined();
    chs(config)[1].greeting = { allow_interruptions: false };
    expect(chs(shareFirstLine(config, 1))[1].greeting).toEqual({ allow_interruptions: false, say: 'Hello! How can I help you today?' });
    const silent = fresh();
    delete chs(silent)[0].greeting;
    expect(shareFirstLine(silent, 0)).toBe(silent);
  });

  it('says whether a channel shares the first line, has its own, or waits', () => {
    const config = withChannel(fresh(), 'phone');
    expect(greetingNote(config, 1).text).toMatch(/its own first line/);
    expect(greetingNote(config, 1).share).toBe('instead');
    const shared = shareFirstLine(config, 1);
    expect(greetingNote(shared, 1).text).toMatch(/^What it says first is the same on every channel/);
    expect(greetingNote(shared, 1).share).toBe('');
    delete chs(shared)[1].greeting;
    expect(greetingNote(shared, 1)).toEqual({ text: 'This channel waits for the person to start.', share: 'too' });
    const sms = withChannel(fresh(), 'sms');
    expect(greetingNote(sms, 1).share).toBe('', );
    const fixed = { ...fresh(), messages: [{ id: 'hello', text: { en: 'Hello there' } }] };
    chs(fixed)[0].greeting = { say: { message: 'hello' } };
    expect(channelHint(fixed, chs(fixed)[0])).toBe('Says “Hello there”');
  });
});

describe('rows', () => {
  it('names a row by its kind; two of a kind are told apart by id in words, or by number', () => {
    expect(channelTitle(fresh(), 0)).toBe('Chat on your website');
    const twin = withChannel(fresh(), 'web_chat');
    expect(new Set(chs(twin).map((_, i) => channelTitle(twin, i))).size).toBe(2);
    const old = { ...fresh(), channels: [...chs(fresh()), { ...presetChannel('web_chat'), id: 'web_chat' }] };
    expect(chs(old).map((_, i) => channelTitle(old, i))).toEqual(['Chat on your website', 'Chat on your website 2']);
    const two = { ...fresh(), channels: [...chs(fresh()), { ...presetChannel('web_chat'), id: 'support_site' }] };
    expect(channelTitle(two, 1)).toBe('Chat on your website · Support site');
  });

  it('says what a channel carries, and what its modalities need', () => {
    expect(modalityWords({ input: ['text'], output: ['text'] })).toBe('text in and out');
    expect(modalityWords({ input: ['audio', 'text'], output: ['audio'] })).toBe('voice and text in, voice out');
    const notes = modalityNotes({ modalities: { input: ['audio', 'image'], output: ['audio'] } } as ChannelDefinition, { defaults: { models: { llm: { provider: 'openai' } } } });
    expect(notes.filter((n) => n.level === 'warn').map((n) => n.text.split(' ').slice(0, 2).join(' '))).toEqual(['Audio in', 'Audio out', 'Images and']);
    expect(modalityNotes({ modalities: { input: ['text'], output: ['text'] } } as ChannelDefinition, {})).toEqual([]);
  });

  it('reads a phone line’s numbers however they come, and says them', () => {
    expect(readNumbers([{ number: '+15550100', environment: 'production' }])).toEqual([{ number: '+15550100', environment: 'production' }]);
    expect(readNumbers({ numbers: [{ number: '+15550100' }, { nope: 1 }] })).toEqual([{ number: '+15550100', environment: '' }]);
    expect(readNumbers(null)).toEqual([]);
    expect(phoneLineWords([])).toMatch(/^No number yet/);
    expect(phoneLineWords([{ number: '+15550100', environment: 'production' }])).toBe('Callers dial +15550100 (production)');
  });
});
