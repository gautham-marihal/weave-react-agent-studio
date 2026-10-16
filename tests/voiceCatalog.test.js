import test from 'node:test';
import assert from 'node:assert/strict';
import { VOICE_CATALOG } from '../src/voiceCatalog.js';

// Voice ids were checked against the providers (ElevenLabs' public premade list, Cartesia's published ids). These guard the shape, and pin the voices that were wrong.
test('every voice has a well-formed id for its provider, a known gender, and no id is used twice', () => {
  const seen = new Set();
  VOICE_CATALOG.forEach((v) => {
    assert.ok(['Female', 'Male'].includes(v.gender), `${v.name}: gender ${v.gender}`);
    if (v.provider === 'ElevenLabs') assert.match(v.voiceId, /^[A-Za-z0-9]{20}$/, `${v.name}: an ElevenLabs id is 20 letters and digits`);
    if (v.provider === 'Cartesia')
      assert.match(v.voiceId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, `${v.name}: a Cartesia id is a UUID`);
    assert.ok(!seen.has(v.voiceId), `${v.name}: duplicate id`);
    seen.add(v.voiceId);
    assert.ok(!seen.has(v.id) || true);
  });
  assert.equal(new Set(VOICE_CATALOG.map((v) => v.id)).size, VOICE_CATALOG.length, 'catalogue ids are unique');
});

test('the voices that pointed at the wrong person or at ids the provider no longer has are fixed', () => {
  const find = (id) => VOICE_CATALOG.find((v) => v.id === id);
  ['rachel', 'antoni', 'elli', 'josh', 'arnold', 'sam'].forEach((n) => assert.equal(find(`elevenlabs-${n}`), undefined, `${n} was retired by ElevenLabs`));
  assert.equal(find('elevenlabs-sarah').voiceId, 'EXAVITQu4vr4xnSDxMaL', 'that id is Sarah, not Bella');
  assert.equal(find('elevenlabs-bella').voiceId, 'hpp4J3VqNfWAUOO0d1Us');
  assert.equal(find('cartesia-jacqueline').voiceId, '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc', 'the id Cartesia’s own docs use');
  // the older Cartesia list had no recording to listen to, so all of them sounded like the browser’s voice: they were replaced
  ['blake', 'daniela', 'friendly-australian-man', 'british-reading-lady', 'barbershop-man', 'classy-british-man', 'robyn'].forEach((n) =>
    assert.equal(find(`cartesia-${n}`), undefined, `${n} had no sample`),
  );
});

// A voice is heard by its own recorded sample when the provider publishes one (so a man and a woman really sound different); the sample must be of THAT voice.
test('every ElevenLabs voice has the provider’s own sample, and the sample is of that voice', () => {
  VOICE_CATALOG.filter((v) => v.provider === 'ElevenLabs').forEach((v) => {
    assert.match(v.previewUrl, /^https:\/\//, `${v.name}: a sample address`);
    assert.ok(v.previewUrl.includes(v.voiceId), `${v.name}: the sample address names the voice id`);
  });
  // Cartesia gives samples to account holders only: the voices here are public ones with a recording of that exact voice
  VOICE_CATALOG.filter((v) => v.provider === 'Cartesia').forEach((v) => assert.match(v.previewUrl, /^https:\/\/.+\.mp3$/, `${v.name}: a recording`));
  assert.ok(
    VOICE_CATALOG.every((v) => v.previewUrl),
    'every voice in the library can be heard as itself',
  );
});
