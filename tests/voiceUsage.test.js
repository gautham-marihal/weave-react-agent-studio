import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceUsage } from '../src/studio/voiceUsage.js';

const voices = [{ id: 'elevenlabs-rachel', provider: 'ElevenLabs', voiceId: 'RACHEL' }, { id: 'cartesia-blake', provider: 'Cartesia', voiceId: 'BLAKE' }];
const agents = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];

test('an agent uses a voice when its provider and voice id match, whatever the case of the provider', () => {
  const configs = {
    a: { defaults: { models: { tts: { provider: 'elevenlabs', voice_id: 'RACHEL' } } } },
    b: { defaults: { models: { tts: { provider: 'cartesia', voice_id: 'OTHER' } } } },
    c: { defaults: { models: { tts: { provider: 'cartesia', voice_id: 'BLAKE' } } } },
  };
  const usage = voiceUsage(voices, agents, configs);
  assert.deepEqual(Object.keys(usage), ['elevenlabs-rachel', 'cartesia-blake']);
  assert.deepEqual(usage['elevenlabs-rachel'].map((a) => a.id), ['a']);
  assert.deepEqual(usage['cartesia-blake'].map((a) => a.id), ['c']);
});

test('the same voice id under another provider is not a match; missing configs are skipped', () => {
  const usage = voiceUsage(voices, agents, { a: { defaults: { models: { tts: { provider: 'cartesia', voice_id: 'RACHEL' } } } }, b: null });
  assert.deepEqual(usage, {});
  assert.deepEqual(voiceUsage(voices, agents, undefined), {});
  assert.deepEqual(voiceUsage(undefined, undefined, {}), {});
});
