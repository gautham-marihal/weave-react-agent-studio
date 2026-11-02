import { describe, expect, it } from 'vitest';
import { genderOfBrowserVoice, pickBrowserVoice } from './sandboxEngine.js';
import { browserVoiceNote } from './browserVoicePreview';
import { VOICE_CATALOG } from '../data/voiceCatalog';

// Ported from Weave React's tests/browserVoice.test.js: which browser voice reads a library voice aloud in Sandbox.
const v = (name: string, lang?: string, localService = true) => ({ name, lang, localService }) as unknown as SpeechSynthesisVoice;
// what a Windows machine with the English packs installed typically offers, the default (David) first
const WINDOWS = [
  v('Microsoft David - English (United States)', 'en-US'),
  v('Microsoft Zira - English (United States)', 'en-US'),
  v('Microsoft Mark - English (United States)', 'en-US'),
  v('Microsoft Hazel - English (United Kingdom)', 'en-GB'),
  v('Microsoft George - English (United Kingdom)', 'en-GB'),
];
const voice = (find: (x: (typeof VOICE_CATALOG)[number]) => boolean) => {
  const found = VOICE_CATALOG.find(find);
  if (!found) throw new Error('no such voice in the catalogue');
  return found;
};

describe('the browser voice', () => {
  it('has its gender read from its name, left unknown when the name does not say', () => {
    expect(genderOfBrowserVoice(v('Microsoft Zira - English (United States)'))).toBe('female');
    expect(genderOfBrowserVoice(v('Microsoft David - English (United States)'))).toBe('male');
    expect(genderOfBrowserVoice(v('Google UK English Female'))).toBe('female');
    expect(genderOfBrowserVoice(v('Google UK English Male'))).toBe('male');
    expect(genderOfBrowserVoice(v('Google US English')) || '').toBe('');
  });

  it('for a female voice is a female one, not the default male one', () => {
    const pick = pickBrowserVoice(WINDOWS, voice((x) => x.name === 'Sarah'));
    expect(pick.voice?.name).toBe('Microsoft Zira - English (United States)');
    expect(pick.certain).toBe(true);
    expect(pick.pitch).toBe(1);
  });

  it('for a male voice is a male one, and the locale decides between voices of the same gender', () => {
    expect(pickBrowserVoice(WINDOWS, voice((x) => x.name === 'Adam')).voice?.name).toMatch(/David|Mark/);
    expect(pickBrowserVoice(WINDOWS, voice((x) => x.locale === 'en-GB' && x.gender === 'Female')).voice?.name).toBe('Microsoft Hazel - English (United Kingdom)');
  });

  it('is not claimed to be of that gender when the browser has none: it is pitch-shifted and flagged', () => {
    const onlyUnnamed = [v('Google US English', 'en-US', false)];
    const female = pickBrowserVoice(onlyUnnamed, { locale: 'en-US', gender: 'Female' });
    expect(female.voice?.name).toBe('Google US English');
    expect(female.certain).toBe(false);
    expect(female.pitch).toBeGreaterThan(1);
    const male = pickBrowserVoice(onlyUnnamed, { locale: 'en-US', gender: 'Male' });
    expect(male.certain).toBe(false);
    expect(male.pitch).toBeLessThan(1);
  });

  it('is left to the browser, and flagged, when there is none in the language', () => {
    expect(pickBrowserVoice([], { locale: 'en-US', gender: 'Female' })).toEqual({ voice: null, certain: false, pitch: 1.25 });
    expect(pickBrowserVoice(WINDOWS, { locale: 'es-MX', gender: 'Female' }).voice).toBeNull();
  });
});

describe('the note under it', () => {
  const sarah = { name: 'Sarah', provider: 'ElevenLabs', gender: 'Female', language: 'English (US)', locale: 'en-US' };
  it('says it is the browser’s own voice, not the real one, and why', () => {
    const note = browserVoiceNote(sarah, { certain: true, hadSample: false });
    expect(note).toMatch(/no recorded sample of Sarah/);
    expect(note).toMatch(/your browser’s own voice reading it, not Sarah/);
    expect(note).toMatch(/the real voice is ElevenLabs’s/);
    expect(browserVoiceNote(sarah, { certain: true, hadSample: true })).toMatch(/recording of Sarah couldn’t be loaded/);
  });
  it('says when it is only a rough approximation', () => {
    expect(browserVoiceNote(sarah, { certain: false, hadSample: false })).toMatch(/no female English \(US\) voice either, so this is only a rough approximation/);
  });
});
