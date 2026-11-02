import { describe, expect, it } from 'vitest';
import type { ProvidersAnswer } from '../api/types';
import type { CatalogVoice } from '../data/voiceCatalog';
import { missingProviderKey, missingSecrets, providersFor, secretKeys, secretState, voicesFor } from './providerOptions';

// Shaped like a real GET /providers answer.
const answer: ProvidersAnswer = {
  providers: [
    { name: 'openai', stages: ['stt', 'llm', 'tts', 'realtime'], installed: true, default_secret: 'OPENAI_API_KEY', key_available: true },
    { name: 'anthropic', stages: ['llm'], installed: true, default_secret: 'ANTHROPIC_API_KEY', key_available: false },
    { name: 'google', stages: ['stt', 'llm', 'tts'], installed: false, default_secret: 'GOOGLE_API_KEY', key_available: false },
    { name: 'elevenlabs', stages: ['stt', 'tts'], installed: true, default_secret: 'ELEVEN_API_KEY', key_available: true },
    { name: 'cartesia', stages: ['stt', 'tts'], installed: true, default_secret: 'CARTESIA_API_KEY', key_available: false },
    { name: 'silero', stages: ['vad'], installed: true, default_secret: null },
  ],
  stages: {},
  turn_detectors: [],
};

const voice = (provider: string, name: string): CatalogVoice => ({
  id: `${provider}-${name}`,
  name,
  provider,
  language: 'English (United States)',
  locale: 'en-US',
  gender: 'Female',
  style: '',
  voiceId: `${name}-id`,
  previewUrl: '',
  tags: [],
});

describe('providersFor', () => {
  it('lists only installed providers that can run the stage', () => {
    expect(providersFor('llm', answer).map((p) => p.value)).toEqual(['openai', 'anthropic']);
    expect(providersFor('tts', answer).map((p) => p.value)).toEqual(['openai', 'elevenlabs', 'cartesia']);
  });

  it('carries whether the key is set', () => {
    expect(providersFor('llm', answer).find((p) => p.value === 'anthropic')).toMatchObject({ keyAvailable: false, secret: 'ANTHROPIC_API_KEY' });
  });

  it('keeps the current provider visible when the server did not list it', () => {
    const list = providersFor('llm', answer, 'google');
    expect(list.at(-1)).toMatchObject({ value: 'google', unlisted: true });
  });

  it('offers nothing invented when the list could not be fetched', () => {
    expect(providersFor('llm', null)).toEqual([]);
    expect(providersFor('llm', null, 'openai')).toEqual([expect.objectContaining({ value: 'openai', unlisted: true })]);
  });
});

describe('voicesFor', () => {
  const catalog = [voice('ElevenLabs', 'Sarah'), voice('Cartesia', 'Skylar')];
  it('matches the config provider id to the catalogue provider name', () => {
    expect(voicesFor('elevenlabs', catalog).map((v) => v.name)).toEqual(['Sarah']);
    expect(voicesFor('cartesia', catalog).map((v) => v.name)).toEqual(['Skylar']);
  });
  it('has no voices for a provider the catalogue does not cover', () => {
    expect(voicesFor('openai', catalog)).toEqual([]);
    expect(voicesFor(undefined, catalog)).toEqual([]);
  });
});

describe('secrets', () => {
  const keys = secretKeys(answer);
  it('knows only the keys the server reports on', () => {
    expect(keys).toEqual({ OPENAI_API_KEY: true, ANTHROPIC_API_KEY: false, GOOGLE_API_KEY: false, ELEVEN_API_KEY: true, CARTESIA_API_KEY: false });
  });
  it('says unknown, not missing, for a secret the server did not report on', () => {
    expect(secretState('CRM_API_TOKEN', keys)).toBe('unknown');
    expect(secretState('OPENAI_API_KEY', keys)).toBe('found');
    expect(secretState('CARTESIA_API_KEY', keys)).toBe('missing');
  });
  it('lists only the secrets known to be missing', () => {
    expect(missingSecrets(['OPENAI_API_KEY', 'CARTESIA_API_KEY', 'CRM_API_TOKEN'], keys)).toEqual(['CARTESIA_API_KEY']);
  });
  it('reports a provider key only when the server says it is not set', () => {
    expect(missingProviderKey('cartesia', answer)).toBe('CARTESIA_API_KEY');
    expect(missingProviderKey('openai', answer)).toBeNull();
    expect(missingProviderKey('unknown', answer)).toBeNull();
    expect(missingProviderKey('cartesia', null)).toBeNull();
  });
});
