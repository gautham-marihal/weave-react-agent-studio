// @ts-check
// Messages: one fixed line, or the same line in several languages. The primary language is required when there is more than one
// (the validator says so); every language the agent speaks should be there too, or a caller in that language hears the wrong one.
// Pure: no network, no DOM.

import { isObj } from './engine.js';

export const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]+)?$/;

// "en-US" -> "en"
export const baseOf = (code) => String(code || '').split('-')[0].toLowerCase();

// The language the agent mainly speaks, as it is written in the config ('' when none is set).
export const primaryOf = (config) => {
  const language = config?.defaults?.language;
  if (typeof language?.primary === 'string' && language.primary) return language.primary;
  const first = Array.isArray(language?.speaks) ? language.speaks.find((code) => typeof code === 'string' && code) : '';
  return first || '';
};

// Every language a message should cover, in order: the primary first, then the rest the agent speaks. Duplicates by base language
// (en and en-US) count once, because a text written for "en" serves "en-US".
export function wantedLanguages(config) {
  const primary = primaryOf(config);
  const speaks = Array.isArray(config?.defaults?.language?.speaks) ? config.defaults.language.speaks : [];
  const out = [];
  [primary, ...speaks].forEach((code) => {
    if (typeof code === 'string' && code && !out.some((have) => baseOf(have) === baseOf(code))) out.push(code);
  });
  return out;
}

// Does a text map have an entry for this language (an exact code, or one with the same base)?
export const hasLanguage = (map, code) => isObj(map) && Object.keys(map).some((key) => baseOf(key) === baseOf(code));

// What a message's text covers: { kind: 'plain' | 'languages', have: [codes], missing: [codes], primaryMissing: bool }.
export function languageStatus(text, config) {
  const wanted = wantedLanguages(config);
  if (!isObj(text)) return { kind: 'plain', have: [], missing: [], primaryMissing: false };
  const have = Object.keys(text);
  const missing = wanted.filter((code) => !hasLanguage(text, code));
  const primary = primaryOf(config);
  return { kind: 'languages', have, missing, primaryMissing: !!primary && !hasLanguage(text, primary) };
}

// One text for everyone -> per language, starting with what is there under the primary language (written as its base, "en",
// the way the example configuration does: a text for "en" serves "en-US").
export function toLanguages(text, config) {
  if (isObj(text)) return text;
  return { [baseOf(primaryOf(config)) || 'en']: typeof text === 'string' ? text : '' };
}

// Per language -> one text (the primary language's, else the first that has any).
export function toPlain(text, config) {
  if (!isObj(text)) return typeof text === 'string' ? text : '';
  const primary = primaryOf(config);
  const key = Object.keys(text).find((code) => primary && baseOf(code) === baseOf(primary)) || Object.keys(text)[0];
  return key ? String(text[key] ?? '') : '';
}

// The languages a card should name in its header: "en, es · missing fr", or '' for a plain text.
export function languageHint(message, config) {
  if (!isObj(message) || !isObj(message.text)) return '';
  const status = languageStatus(message.text, config);
  const missing = status.missing.length ? ` · missing ${status.missing.join(', ')}` : '';
  return `${status.have.join(', ')}${missing}`;
}

// A language code that is fit to add: pattern, and not there already.
export function languageProblem(code, map) {
  const text = String(code || '').trim();
  if (!text) return 'Type a language code, such as fr or pt-BR.';
  if (!LANGUAGE_PATTERN.test(text)) return 'Use a language code such as fr, es or pt-BR.';
  if (isObj(map) && text in map) return `“${text}” is already there.`;
  return '';
}
