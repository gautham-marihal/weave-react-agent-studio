import { describe, expect, it } from 'vitest';
import { voiceUsage } from './voiceUsage';
import { VOICE_CATALOG } from '../data/voiceCatalog';

const voices = [
  { id: 'elevenlabs-rachel', provider: 'ElevenLabs', voiceId: 'RACHEL' },
  { id: 'cartesia-blake', provider: 'Cartesia', voiceId: 'BLAKE' },
];
const agents = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
];

describe('which agents use a voice (ported from Weave React voiceUsage)', () => {
  it('an agent uses a voice when its provider and voice id match, whatever the case of the provider', () => {
    const usage = voiceUsage(voices, agents, {
      a: { defaults: { models: { tts: { provider: 'elevenlabs', voice_id: 'RACHEL' } } } },
      b: { defaults: { models: { tts: { provider: 'cartesia', voice_id: 'OTHER' } } } },
      c: { defaults: { models: { tts: { provider: 'cartesia', voice_id: 'BLAKE' } } } },
    });
    expect(Object.keys(usage)).toEqual(['elevenlabs-rachel', 'cartesia-blake']);
    expect(usage['elevenlabs-rachel'].map((a) => a.id)).toEqual(['a']);
    expect(usage['cartesia-blake'].map((a) => a.id)).toEqual(['c']);
  });

  it('the same voice id under another provider is not a match; missing configs are skipped', () => {
    expect(voiceUsage(voices, agents, { a: { defaults: { models: { tts: { provider: 'cartesia', voice_id: 'RACHEL' } } } }, b: null })).toEqual({});
    expect(voiceUsage(voices, agents, undefined)).toEqual({});
    expect(voiceUsage(undefined, undefined, {})).toEqual({});
  });
});

// Ported from Weave React voiceCatalog: the shape of Studio's own catalogue (data/voiceCatalog.ts).
describe('the voice catalogue', () => {
  it('every voice has a well-formed id for its provider, a known gender, and no id is used twice', () => {
    const seen = new Set<string>();
    VOICE_CATALOG.forEach((v) => {
      expect(['Female', 'Male']).toContain(v.gender);
      if (v.provider === 'ElevenLabs') expect(v.voiceId).toMatch(/^[A-Za-z0-9]{20}$/);
      if (v.provider === 'Cartesia') expect(v.voiceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(seen.has(v.voiceId)).toBe(false);
      seen.add(v.voiceId);
    });
    expect(new Set(VOICE_CATALOG.map((v) => v.id)).size).toBe(VOICE_CATALOG.length);
  });

  it('the voices that pointed at the wrong person or at retired ids are not offered', () => {
    const find = (id: string) => VOICE_CATALOG.find((v) => v.id === id);
    ['rachel', 'antoni', 'elli', 'josh', 'arnold', 'sam'].forEach((n) => expect(find(`elevenlabs-${n}`)).toBeUndefined());
    expect(find('elevenlabs-sarah')?.voiceId).toBe('EXAVITQu4vr4xnSDxMaL');
    expect(find('elevenlabs-bella')?.voiceId).toBe('hpp4J3VqNfWAUOO0d1Us');
    expect(find('cartesia-jacqueline')?.voiceId).toBe('9626c31c-bec5-4cca-baa8-f8ba9e84c8bc');
  });

  it('every voice has its own recorded sample, so only real recordings are played', () => {
    VOICE_CATALOG.filter((v) => v.provider === 'ElevenLabs').forEach((v) => {
      expect(v.previewUrl).toMatch(/^https:\/\//);
      expect(v.previewUrl.includes(v.voiceId)).toBe(true);
    });
    VOICE_CATALOG.filter((v) => v.provider === 'Cartesia').forEach((v) => expect(v.previewUrl).toMatch(/^https:\/\/.+\.mp3$/));
    expect(VOICE_CATALOG.every((v) => v.previewUrl)).toBe(true);
  });
});
