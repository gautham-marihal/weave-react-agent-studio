import { describe, expect, it } from 'vitest';
import {
  allowedModalities,
  browserChannels,
  canForms,
  canKeypad,
  entryFieldsFor,
  findVoiceOnly,
  infoOf,
  isVoiceChannel,
  keysNotOffered,
  mislabelledChat,
  modalityChoices,
  normalizeChannelTypes,
  notRunningYet,
  plainSetting,
  stripVoiceOnly,
  withArticle,
} from './channelTypes';

import { ANSWER, WEB_IN } from './channels.test.data';

const TYPES = normalizeChannelTypes(ANSWER);

const config = () => ({
  channels: [
    { id: 'phone', type: 'sip_voice', enabled: true, modalities: { input: ['audio'], output: ['audio'] } },
    { id: 'chat', type: 'web_chat', enabled: true, modalities: { input: ['text'], output: ['text'] } },
    { id: 'talk', type: 'web_voice', enabled: true, modalities: { input: ['audio'], output: ['audio'] } },
    { id: 'off', type: 'web_voice', enabled: false },
    { id: 'text', type: 'sms', enabled: true, modalities: { input: ['text'], output: ['text'] } },
  ],
});

describe('channel kinds (GET /channel-types)', () => {
  it('reads the server’s answer as it comes ({ types }), and an odd one too', () => {
    expect(TYPES).toHaveLength(7);
    const phone = infoOf(TYPES, 'sip_voice');
    expect([phone?.canKeypad, phone?.canForms, phone?.voice, phone?.runsToday]).toEqual([true, false, true, true]);
    expect(phone?.entryFields).toEqual(['dnis', 'sip_trunk', 'dispatch_rule']);
    expect(infoOf(TYPES, 'custom')?.entryFields).toBeNull();
    expect(normalizeChannelTypes(ANSWER.types)).toHaveLength(7);
    expect(normalizeChannelTypes({ types: [{ nothing: true }, null] })).toEqual([]);
    expect(normalizeChannelTypes(null)).toEqual([]);
  });

  it('a phone line is audio only with a keypad and no screen; a web channel is the other way round', () => {
    expect(allowedModalities(TYPES, 'sip_voice', 'input')).toEqual(['audio']);
    expect(allowedModalities(TYPES, 'web_chat', 'input')).toEqual(WEB_IN);
    expect(allowedModalities(TYPES, 'web_chat', 'output')).toEqual(['audio', 'text']);
    expect(allowedModalities(TYPES, 'sms', 'input')).toEqual(['text']);
    expect(allowedModalities(TYPES, 'mystery', 'input')).toBeNull();
    expect(canKeypad(TYPES, 'sip_voice')).toBe(true);
    expect(canKeypad(TYPES, 'web_chat')).toBe(false);
    expect(canForms(TYPES, 'sip_voice')).toBe(false);
    expect(canForms(TYPES, 'web_voice')).toBe(true);
    expect(canKeypad(TYPES, 'custom')).toBe(true);
    expect(canKeypad(TYPES, 'mystery')).toBe(true);
    expect(entryFieldsFor(TYPES, 'sms')).toEqual([]);
    expect(entryFieldsFor(TYPES, 'custom')).toBeNull();
  });

  it('without the server’s list nothing is narrowed and nothing is claimed', () => {
    expect(allowedModalities(null, 'sip_voice', 'input')).toBeNull();
    expect(canForms(null, 'sip_voice')).toBe(true);
    expect(notRunningYet(null, 'sms')).toBe(false);
  });

  it('knows the kinds nothing connects to the runtime yet', () => {
    ['whatsapp', 'sms', 'email'].forEach((t) => expect(notRunningYet(TYPES, t)).toBe(true));
    ['sip_voice', 'web_voice', 'web_chat', 'custom'].forEach((t) => expect(notRunningYet(TYPES, t)).toBe(false));
  });

  it('a channel has a voice by what it carries, not only by its kind', () => {
    const c = config().channels;
    expect(isVoiceChannel(c[0], TYPES)).toBe(true);
    expect(isVoiceChannel(c[1], TYPES)).toBe(true);
    expect(isVoiceChannel(c[4], TYPES)).toBe(false);
    expect(isVoiceChannel({ type: 'mystery', modalities: { input: ['text'], output: ['text'] } }, TYPES)).toBe(false);
    expect(isVoiceChannel({ type: 'mystery', modalities: { input: ['audio'], output: ['text'] } }, TYPES)).toBe(true);
  });

  it('does not offer voice-only settings on a channel with no voice', () => {
    const c = config();
    expect(keysNotOffered(c, TYPES, ['channels', 4, 'overrides', 'conversation'])).toEqual(['sounds', 'speech', 'noise_cancellation', 'ivr_detection']);
    expect(keysNotOffered(c, TYPES, ['channels', 4, 'overrides', 'models'])).toEqual(['stt', 'tts', 'realtime', 'vad', 'turn_detector']);
    expect(keysNotOffered(c, TYPES, ['channels', 0, 'overrides', 'conversation'])).toEqual([]);
    expect(keysNotOffered(c, TYPES, ['defaults', 'conversation'])).toEqual([]);
  });

  it('a channel’s tick boxes are the kind’s own; a ticked value it cannot carry is kept, to be removed', () => {
    const c = config();
    expect(modalityChoices(c, TYPES, ['channels', 0, 'modalities', 'input'], ['audio', 'text'])).toEqual({ allowed: ['audio'], extra: ['text'] });
    expect(modalityChoices(c, TYPES, ['channels', 1, 'modalities', 'output'], ['text'])?.allowed).toEqual(['audio', 'text']);
    expect(modalityChoices(c, TYPES, ['channels', 1, 'greeting'], [])).toBeNull();
    const loose = normalizeChannelTypes({ types: [{ type: 'web_chat' }] });
    expect(modalityChoices({ channels: [{ type: 'web_chat' }] }, loose, ['channels', 0, 'modalities', 'input'], ['text'])).toBeNull();
  });

  it('a web chat that carries audio is a web voice channel by another name', () => {
    expect(mislabelledChat({ type: 'web_chat', modalities: { input: ['text', 'audio'], output: ['text'] } })).toBe(true);
    expect(mislabelledChat({ type: 'web_chat', modalities: { input: ['text'], output: ['text'] } })).toBe(false);
    expect(mislabelledChat({ type: 'web_voice', modalities: { input: ['audio'], output: ['audio'] } })).toBe(false);
  });

  it('lists the enabled web channels a browser can try, in order', () => {
    expect(browserChannels(config()).map((c) => [c.id, c.type])).toEqual([
      ['chat', 'web_chat'],
      ['talk', 'web_voice'],
    ]);
    expect(browserChannels(null)).toEqual([]);
  });

  it('names and takes out the voice-only settings, keeping a component switched off (null)', () => {
    expect(findVoiceOnly({ conversation: { sounds: {}, inactivity: {} }, models: { stt: {}, llm: {} } })).toEqual(['conversation.sounds', 'models.stt']);
    expect(findVoiceOnly({ models: { tts: null } })).toEqual([]);
    const both = { conversation: { sounds: {}, inactivity: { timeout_s: 8 } }, models: { stt: {}, llm: { model: 'x' } } };
    expect(stripVoiceOnly(both)).toEqual({ overrides: { conversation: { inactivity: { timeout_s: 8 } }, models: { llm: { model: 'x' } } }, removed: ['conversation.sounds', 'models.stt'] });
    expect(stripVoiceOnly({ conversation: { sounds: {} } })).toEqual({ overrides: undefined, removed: ['conversation.sounds'] });
    expect(stripVoiceOnly(undefined)).toEqual({ overrides: undefined, removed: [] });
    expect(JSON.stringify(both)).toContain('sounds');
  });

  it('names settings in words and puts “an” before a vowel', () => {
    expect(plainSetting('conversation.sounds')).toBe('background and waiting sounds');
    expect(plainSetting('entry.sip_trunk')).toBe('the sip trunk field');
    expect(withArticle('ElevenLabs')).toBe('an ElevenLabs');
  });
});
