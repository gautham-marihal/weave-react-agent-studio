// What the Agent page's language and voice pickers show and write: languages left to add, the languages it speaks as
// chips, voices matching a search and filters. Language settings are ordinary fields of defaults.language. Pure: no
// React, no DOM.
import type { AgentConfig } from '../types/studio';
import { BASE_LANGUAGES, LANGUAGES, baseOf, languageName } from './languages';
import { VOICE_CATALOG, type CatalogVoice } from '../data/voiceCatalog';
import { matches } from './pickersModels';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

// ---- languages ------------------------------------------------------------------------------------------------------
/** The badge beside a language: its base code in capitals ("en-US" -> "EN"). */
export const languageBadge = (code: string): string => baseOf(code).toUpperCase();

export interface PickOption {
  value: string;
  label: string;
  badge: string;
  hint: string;
}

/** The main language is one of the locales ("English (United States)"). */
export function mainLanguageOptions(query = ''): PickOption[] {
  return LANGUAGES.filter(([code, label]) => matches(query, label, code)).map(([code, label]) => ({ value: code, label, badge: languageBadge(code), hint: code }));
}

/** The languages that can still be added: not the main one, not one already there. */
export function extraLanguageOptions({ primary = '', speaks = [], query = '' }: { primary?: string; speaks?: string[]; query?: string } = {}): PickOption[] {
  const taken = new Set([baseOf(primary), ...speaks.map((c) => baseOf(c))]);
  return BASE_LANGUAGES.filter((l) => !taken.has(l.code) && matches(query, l.name, l.code)).map((l) => ({ value: l.code, label: l.name, badge: languageBadge(l.code), hint: l.code }));
}

/** Chips for the languages it speaks, the main one first and marked (en-US and en count once). */
export function spokenChips({ primary = '', speaks = [] }: { primary?: string; speaks?: string[] } = {}): { code: string; name: string; main: boolean }[] {
  const main = baseOf(primary);
  const seen = new Set<string>();
  const chips: { code: string; name: string; main: boolean }[] = [];
  [main, ...speaks.map((c) => baseOf(c))].forEach((code) => {
    if (!code || seen.has(code)) return;
    seen.add(code);
    chips.push({ code, name: BASE_LANGUAGES.find((l) => l.code === code)?.name ?? languageName(code), main: code === main });
  });
  return chips;
}

/** The language settings as they are written. */
export function readLanguages(config: AgentConfig | null | undefined) {
  const lang: Json = isObj(config?.defaults?.language) ? (config?.defaults?.language as Json) : {};
  const speaks = strings(lang.speaks);
  const primary = typeof lang.primary === 'string' && lang.primary ? lang.primary : speaks[0] ?? '';
  return { primary, speaks, alsoUnderstands: strings(lang.also_understands), autoDetect: lang.auto_detect === true };
}

function editLanguage(config: AgentConfig, change: (language: Json) => void): AgentConfig {
  const next = clone(config ?? {}) as AgentConfig;
  const defaults: Json = isObj(next.defaults) ? (next.defaults as Json) : {};
  const language: Json = { ...(isObj(defaults.language) ? (defaults.language as Json) : {}) };
  change(language);
  next.defaults = { ...defaults, language };
  return same(next, config) ? config : next;
}

/** The main language is a locale; it also speaks that locale's base language, kept first in the list. */
export function setMainLanguage(config: AgentConfig, code: string): AgentConfig {
  const value = String(code || '');
  return editLanguage(config, (language) => {
    if (!value) {
      delete language.primary;
      return;
    }
    language.primary = value;
    const speaks = strings(language.speaks);
    language.speaks = [baseOf(value), ...speaks.filter((c) => baseOf(c) !== baseOf(value))];
  });
}

/** Adds or takes away a language it speaks; the main language can't be taken away. */
export function toggleSpoken(config: AgentConfig, base: string, on: boolean): AgentConfig {
  return editLanguage(config, (language) => {
    const speaks = strings(language.speaks);
    const primary = baseOf(typeof language.primary === 'string' ? language.primary : speaks[0] ?? '');
    const without = speaks.filter((c) => baseOf(c) !== base);
    language.speaks = on || base === primary ? [...without, base] : without;
  });
}

/** A language setting that has no screen of its own (`also_understands`, `auto_detect`); an empty list or false removes it. */
export function setLanguageField(config: AgentConfig, key: 'also_understands' | 'auto_detect', value: string[] | boolean): AgentConfig {
  return editLanguage(config, (language) => {
    const empty = value === false || (Array.isArray(value) && value.length === 0);
    if (empty) delete language[key];
    else language[key] = value;
  });
}

// ---- voices ---------------------------------------------------------------------------------------------------------
export interface PickerVoice extends CatalogVoice {
  /** The provider id the config uses ("elevenlabs"); the catalogue names it ("ElevenLabs"). */
  engine: string;
  engineName: string;
}

export const allVoices = (catalog: CatalogVoice[] = VOICE_CATALOG): PickerVoice[] => catalog.map((v) => ({ ...v, engine: v.provider.toLowerCase(), engineName: v.provider }));

/** The choices of the three filters, from the catalogue. */
export function voiceFilters(catalog: CatalogVoice[] = VOICE_CATALOG) {
  const voices = allVoices(catalog);
  return {
    engines: [...new Set(voices.map((v) => v.engine))].map((e) => ({ value: e, label: voices.find((v) => v.engine === e)?.engineName ?? e })),
    languages: [...new Set(voices.map((v) => v.language))].sort((a, b) => a.localeCompare(b)),
    genders: [...new Set(voices.map((v) => v.gender))],
  };
}

/** The voices matching a search and filters: the one in use first, then its engine's voices, then the rest by name. */
export function filterVoices(
  { query = '', gender = '', engine = '', language = '', current = { provider: '', voiceId: '' } }: { query?: string; gender?: string; engine?: string; language?: string; current?: { provider: string; voiceId: string } },
  catalog: CatalogVoice[] = VOICE_CATALOG,
): PickerVoice[] {
  const engineNow = String(current.provider || '').toLowerCase();
  const list = allVoices(catalog).filter(
    (v) => (!gender || v.gender === gender) && (!engine || v.engine === engine) && (!language || v.language === language) && matches(query, v.name, v.style, v.language, v.engineName, v.tags.join(' ')),
  );
  const rank = (v: PickerVoice) => (v.voiceId === current.voiceId && v.engine === engineNow ? 0 : v.engine === engineNow ? 1 : 2);
  return list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The catalogue voice in use, or null when the voice in use is not from the catalogue (a voice of your own). */
export const voiceInUse = ({ provider = '', voiceId = '' }: { provider?: string; voiceId?: string }, catalog: CatalogVoice[] = VOICE_CATALOG): PickerVoice | null =>
  allVoices(catalog).find((v) => v.voiceId === voiceId && v.engine === String(provider).toLowerCase()) ?? null;

/** A steady colour for a voice's initial, from its name (never random). */
export function voiceHue(name: string): number {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** The note under the list after a pick that changed the engine. */
export const engineSwitchNote = (voice: PickerVoice, before: string): string =>
  voice.engine !== String(before || '').toLowerCase() ? `${voice.name} is ${/^[AEIOU]/i.test(voice.engineName) ? 'an' : 'a'} ${voice.engineName} voice, so the voice engine is now ${voice.engineName}.` : '';
