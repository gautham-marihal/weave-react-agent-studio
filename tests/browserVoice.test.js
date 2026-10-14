import test from 'node:test';
import assert from 'node:assert/strict';
import { genderOfBrowserVoice, pickBrowserVoice } from '../src/pages/browserVoice.js';
import { VOICE_CATALOG } from '../src/voiceCatalog.js';

const v = (name, lang, localService = true) => ({ name, lang, localService });
// what a Windows machine with the English packs installed typically offers, the default (David) first
const WINDOWS = [v('Microsoft David - English (United States)', 'en-US'), v('Microsoft Zira - English (United States)', 'en-US'), v('Microsoft Mark - English (United States)', 'en-US'), v('Microsoft Hazel - English (United Kingdom)', 'en-GB'), v('Microsoft George - English (United Kingdom)', 'en-GB')];

test('a browser voice’s gender is read from its name, and left unknown when the name does not say', () => {
  assert.equal(genderOfBrowserVoice(v('Microsoft Zira - English (United States)')), 'female');
  assert.equal(genderOfBrowserVoice(v('Microsoft David - English (United States)')), 'male');
  assert.equal(genderOfBrowserVoice(v('Google UK English Female')), 'female');
  assert.equal(genderOfBrowserVoice(v('Google UK English Male')), 'male');
  assert.equal(genderOfBrowserVoice(v('Google US English')), '');
  assert.equal(genderOfBrowserVoice(null), '');
});

test('a female voice is previewed with a female browser voice, not the default male one', () => {
  const rachel = VOICE_CATALOG.find((x) => x.name === 'Rachel');
  const pick = pickBrowserVoice(WINDOWS, rachel);
  assert.equal(pick.voice.name, 'Microsoft Zira - English (United States)');
  assert.equal(pick.certain, true);
  assert.equal(pick.pitch, 1);
});

test('a male voice is previewed with a male browser voice, and the locale decides between voices of the same gender', () => {
  const adam = VOICE_CATALOG.find((x) => x.name === 'Adam');
  assert.match(pickBrowserVoice(WINDOWS, adam).voice.name, /David|Mark/);
  const british = VOICE_CATALOG.find((x) => x.locale === 'en-GB' && x.gender === 'Female');
  assert.equal(pickBrowserVoice(WINDOWS, british).voice.name, 'Microsoft Hazel - English (United Kingdom)');
  const australianMan = VOICE_CATALOG.find((x) => x.locale === 'en-AU');
  assert.equal(pickBrowserVoice(WINDOWS, australianMan).certain, true, 'another English voice of the right gender stands in for en-AU');
});

test('when the browser has no voice of that gender, it is not claimed to be one: an unnamed voice is pitch-shifted and the preview is flagged', () => {
  const onlyUnnamed = [v('Google US English', 'en-US', false)];
  const female = pickBrowserVoice(onlyUnnamed, { locale: 'en-US', gender: 'Female' });
  assert.equal(female.voice.name, 'Google US English');
  assert.equal(female.certain, false);
  assert.ok(female.pitch > 1);
  const male = pickBrowserVoice(onlyUnnamed, { locale: 'en-US', gender: 'Male' });
  assert.ok(male.pitch < 1 && male.certain === false);
  const onlyMen = pickBrowserVoice([v('Microsoft David', 'en-US')], { locale: 'en-US', gender: 'Female' });
  assert.equal(onlyMen.certain, false);
  assert.ok(onlyMen.pitch > 1);
});

test('no browser voices at all, or none in the language, leaves the choice to the browser and flags it', () => {
  assert.deepEqual(pickBrowserVoice([], { locale: 'en-US', gender: 'Female' }), { voice: null, certain: false, pitch: 1.25 });
  assert.equal(pickBrowserVoice(undefined, { locale: 'es-MX', gender: 'Male' }).voice, null);
  assert.equal(pickBrowserVoice(WINDOWS, { locale: 'es-MX', gender: 'Female' }).voice, null);
});
