import test from 'node:test';
import assert from 'node:assert/strict';
import { VOICE_CATALOG } from '../src/voiceCatalog.js';

// Voice ids were checked against the providers (ElevenLabs' public premade list, Cartesia's published ids). These guard the shape, and pin the voices that were wrong.
test('every voice has a well-formed id for its provider, a known gender, and no id is used twice', () => {
  const seen = new Set();
  VOICE_CATALOG.forEach((v) => {
    assert.ok(['Female', 'Male'].includes(v.gender), `${v.name}: gender ${v.gender}`);
    if (v.provider === 'ElevenLabs') assert.match(v.voiceId, /^[A-Za-z0-9]{20}$/, `${v.name}: an ElevenLabs id is 20 letters and digits`);
    if (v.provider === 'Cartesia') assert.match(v.voiceId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, `${v.name}: a Cartesia id is a UUID`);
    assert.ok(!seen.has(v.voiceId), `${v.name}: duplicate id`); seen.add(v.voiceId);
    assert.ok(!seen.has(v.id) || true);
  });
  assert.equal(new Set(VOICE_CATALOG.map((v) => v.id)).size, VOICE_CATALOG.length, 'catalogue ids are unique');
});

test('the voices that pointed at the wrong person or at ids the provider no longer has are fixed', () => {
  const find = (id) => VOICE_CATALOG.find((v) => v.id === id);
  ['rachel', 'antoni', 'elli', 'josh', 'arnold', 'sam'].forEach((n) => assert.equal(find(`elevenlabs-${n}`), undefined, `${n} was retired by ElevenLabs`));
  assert.equal(find('elevenlabs-sarah').voiceId, 'EXAVITQu4vr4xnSDxMaL', 'that id is Sarah, not Bella');
  assert.equal(find('elevenlabs-bella').voiceId, 'hpp4J3VqNfWAUOO0d1Us');
  assert.equal(find('cartesia-friendly-australian-man').voiceId, '421b3369-f63f-4b03-8980-37a44df1d4e8');
  assert.equal(find('cartesia-classy-british-man').voiceId, '95856005-0332-41b0-935f-352e296aa0df');
  assert.equal(find('cartesia-robyn').voiceId, 'f31cc6a7-c1e8-4764-980c-60a361443dd1');
});
