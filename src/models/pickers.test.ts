import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { BASE_LANGUAGES, languageName } from './languages';
import {
  engineSwitchNote,
  extraLanguageOptions,
  filterVoices,
  languageBadge,
  mainLanguageOptions,
  readLanguages,
  setLanguageField,
  setMainLanguage,
  spokenChips,
  toggleSpoken,
  voiceFilters,
  voiceHue,
  voiceInUse,
} from './pickers';

const agent = (): AgentConfig => ({ defaults: { language: { primary: 'en-US', speaks: ['en'] } }, persona: { name: 'Acme' } });

describe('language picker', () => {
  it('the main language is searched among the locales, by name or code', () => {
    expect(mainLanguageOptions('span').map((o) => o.label)).toEqual(['Spanish (Spain)', 'Spanish (Mexico)']);
    expect(mainLanguageOptions('pt-').map((o) => o.value)).toEqual(['pt-BR', 'pt-PT']);
    expect(mainLanguageOptions('').length).toBeGreaterThan(20);
    expect(languageBadge('en-US')).toBe('EN');
  });

  it('choosing the main language writes it, and its base language is spoken too, first', () => {
    const es = setMainLanguage(agent(), 'es-MX');
    expect(es.defaults?.language).toEqual({ primary: 'es-MX', speaks: ['es', 'en'] });
    expect(setMainLanguage(es, 'es-MX')).toBe(es);
    expect(setMainLanguage(toggleSpoken(es, 'fr', true), 'fr-FR').defaults?.language?.speaks).toEqual(['fr', 'es', 'en']);
  });

  it('other languages are added and taken away; the main one can’t be taken away, and one added isn’t offered again', () => {
    const more = toggleSpoken(toggleSpoken(agent(), 'fr', true), 'de', true);
    expect(more.defaults?.language?.speaks).toEqual(['en', 'fr', 'de']);
    expect(toggleSpoken(more, 'fr', false).defaults?.language?.speaks).toEqual(['en', 'de']);
    expect(toggleSpoken(more, 'en', false).defaults?.language?.speaks).toEqual(['fr', 'de', 'en']);
    const offered = extraLanguageOptions({ primary: 'en-US', speaks: ['en', 'fr', 'de'] }).map((o) => o.value);
    expect(offered).not.toContain('fr');
    expect(offered).not.toContain('en');
    expect(offered).toContain('ja');
    expect(extraLanguageOptions({ primary: 'en-US', speaks: [], query: 'jap' }).map((o) => o.label)).toEqual(['Japanese']);
  });

  it('the chips name each language once, the main one first and marked', () => {
    expect(spokenChips({ primary: 'en-US', speaks: ['en', 'es', 'en-GB'] })).toEqual([
      { code: 'en', name: 'English', main: true },
      { code: 'es', name: 'Spanish', main: false },
    ]);
    expect(spokenChips({})).toEqual([]);
    expect(BASE_LANGUAGES.filter((l) => l.code === 'en')).toHaveLength(1);
    expect(languageName('es-CO')).toBe('Spanish');
  });

  it('detecting the caller’s language and the languages it only recognises: an empty list or false is not written', () => {
    const on = setLanguageField(agent(), 'auto_detect', true);
    expect(readLanguages(on).autoDetect).toBe(true);
    const ja = setLanguageField(on, 'also_understands', ['ja']);
    expect(ja.defaults?.language?.also_understands).toEqual(['ja']);
    expect(setLanguageField(ja, 'also_understands', []).defaults?.language?.also_understands).toBeUndefined();
    expect(setLanguageField(ja, 'auto_detect', false).defaults?.language?.auto_detect).toBeUndefined();
    expect(setLanguageField(agent(), 'auto_detect', false)).toEqual(agent());
  });
});

describe('voice picker', () => {
  it('a search narrows the voices; the filters combine', () => {
    expect(filterVoices({ query: 'sarah' }).map((v) => v.name)).toEqual(['Sarah']);
    const male = filterVoices({ engine: 'cartesia', gender: 'Male' });
    expect(male.length).toBeGreaterThan(0);
    expect(male.every((v) => v.engine === 'cartesia' && v.gender === 'Male')).toBe(true);
    expect(filterVoices({ query: 'zzzz' })).toEqual([]);
    const spanish = filterVoices({ language: 'Spanish (Mexico)' });
    expect(spanish.every((v) => v.language === 'Spanish (Mexico)')).toBe(true);
  });

  it('the voice in use comes first, then its engine’s voices', () => {
    const list = filterVoices({ current: { provider: 'cartesia', voiceId: '9b67072c-d46c-465d-87dc-f7a1c6db2bf3' } });
    expect(list[0].name).toBe('Ramon');
    const firstOther = list.findIndex((v) => v.engine !== 'cartesia');
    expect(list.slice(0, firstOther).every((v) => v.engine === 'cartesia')).toBe(true);
  });

  it('the voice in use is found by engine and id; a voice of your own is not in the catalogue', () => {
    expect(voiceInUse({ provider: 'elevenlabs', voiceId: 'EXAVITQu4vr4xnSDxMaL' })?.name).toBe('Sarah');
    expect(voiceInUse({ provider: 'cartesia', voiceId: 'EXAVITQu4vr4xnSDxMaL' })).toBeNull();
    expect(voiceInUse({ provider: 'elevenlabs', voiceId: 'my-own-voice' })).toBeNull();
  });

  it('every voice plays its own recorded sample, and the filters come from the catalogue', () => {
    expect(filterVoices({}).every((v) => /^https:\/\//.test(v.previewUrl))).toBe(true);
    const filters = voiceFilters();
    expect(filters.engines.map((e) => e.value).sort()).toEqual(['cartesia', 'elevenlabs']);
    expect(filters.genders.sort()).toEqual(['Female', 'Male']);
    expect(voiceHue('Sarah')).toBe(voiceHue('Sarah'));
  });

  it('a pick that changes the engine says so', () => {
    const sarah = filterVoices({ query: 'sarah' })[0];
    expect(engineSwitchNote(sarah, 'cartesia')).toBe('Sarah is an ElevenLabs voice, so the voice engine is now ElevenLabs.');
    expect(engineSwitchNote(sarah, 'elevenlabs')).toBe('');
  });
});
