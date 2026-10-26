// What the language, voice and model pickers of the Agent page show, worked out from the draft and the catalogues:
// which languages are left to add, which voices match a search and the filters, which models are offered for a part of
// the call. Pure: no React, no DOM.

import { BASE_LANGUAGES, LANGUAGES, languageName } from '../../simple/simpleModel.js';
import { VOICE_CATALOG } from '../../../voiceCatalog.js';
import { isRecommendedModel, modelsFor, providerLabel, providersForStage } from '../../models/catalog.js';

const norm = (text) =>
  String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
const matches = (query, ...parts) => {
  const q = norm(query).trim();
  return !q || parts.some((p) => norm(p).includes(q));
};
const baseOf = (code) =>
  String(code || '')
    .split('-')[0]
    .toLowerCase();

// ---- languages
// The small badge beside a language: its code, upper case ("en-US" → "EN").
export const languageBadge = (code) => baseOf(code).toUpperCase();

// The main language is one of the locales ("English (United States)"); the others are languages without a region.
export function mainLanguageOptions(query = '') {
  return LANGUAGES.filter(([code, label]) => matches(query, label, code)).map(([code, label]) => ({
    value: code,
    label,
    badge: languageBadge(code),
    hint: code,
  }));
}
// The languages that can still be added: not the main one, not one already spoken.
export function extraLanguageOptions({ primary = '', speaks = [], query = '' } = {}) {
  const taken = new Set([baseOf(primary), ...speaks.map(baseOf)]);
  return BASE_LANGUAGES.filter((l) => !taken.has(l.code) && matches(query, l.name, l.code)).map((l) => ({
    value: l.code,
    label: l.name,
    badge: languageBadge(l.code),
    hint: l.code,
  }));
}
// The chips of the languages the agent speaks, the main one first and marked.
export function spokenChips({ primary = '', speaks = [] } = {}) {
  const main = baseOf(primary);
  const seen = new Set();
  const chips = [];
  [main, ...speaks.map(baseOf)].forEach((code) => {
    if (!code || seen.has(code)) return;
    seen.add(code);
    chips.push({ code, name: BASE_LANGUAGES.find((l) => l.code === code)?.name || languageName(code), main: code === main });
  });
  return chips;
}

// ---- voices
const accentOf = (name) => {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};
export const voiceHue = accentOf;

export function allVoices() {
  return VOICE_CATALOG.map((v) => ({ ...v, engine: v.provider.toLowerCase(), engineName: v.provider }));
}
export const voiceFilters = () => {
  const voices = allVoices();
  return {
    engines: [...new Set(voices.map((v) => v.engine))].map((e) => ({ value: e, label: voices.find((v) => v.engine === e).engineName })),
    languages: [...new Set(voices.map((v) => v.language))],
    genders: [...new Set(voices.map((v) => v.gender))],
  };
};
// The voices that match a search and the filters; the one in use first, then the ones of the engine in use, then the rest by name.
export function filterVoices({ query = '', gender = '', engine = '', language = '', current = {} } = {}) {
  const list = allVoices().filter(
    (v) =>
      (!gender || v.gender === gender) &&
      (!engine || v.engine === engine) &&
      (!language || v.language === language) &&
      matches(query, v.name, v.style, v.language, v.engineName, (v.tags || []).join(' ')),
  );
  const rank = (v) =>
    v.voiceId === current.voiceId && v.engine === String(current.provider || '').toLowerCase()
      ? 0
      : v.engine === String(current.provider || '').toLowerCase()
        ? 1
        : 2;
  return list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
// The catalogue voice that is the one in use, if it is one of them.
export const voiceInUse = ({ provider = '', voiceId = '' } = {}) =>
  allVoices().find((v) => v.voiceId === voiceId && v.engine === String(provider).toLowerCase()) || null;

// ---- models
// What is offered for a part of the call (stage 'llm' | 'stt' | 'tts'): the catalogue's models of every provider the server can run for it, matched
// against a search and a provider filter; the model in use first.
export function modelRows({ stage, providers, query = '', provider = '', current = {} } = {}) {
  const offered = providersForStage(providers, stage);
  const rows = [];
  offered.forEach((p) => {
    if (provider && p.name !== provider) return;
    modelsFor(stage, p.name).forEach((m) => {
      if (!matches(query, m.label, m.id, m.note, providerLabel(p.name), (m.tags || []).join(' '))) return;
      rows.push({
        provider: p.name,
        providerName: providerLabel(p.name),
        id: m.id,
        label: m.label,
        note: m.note,
        tags: m.tags || [],
        recommended: isRecommendedModel(stage, p.name, m.id),
        installed: p.installed !== false,
        keyMissing: p.default_secret && p.key_available === false ? p.default_secret : '',
        selected: p.name === current.provider && m.id === current.model,
      });
    });
  });
  return rows.sort((a, b) => Number(b.selected) - Number(a.selected) || Number(b.installed) - Number(a.installed));
}
// The providers to filter by, each with how many models it offers for this part of the call.
export function providerChips({ stage, providers } = {}) {
  return providersForStage(providers, stage)
    .map((p) => ({ value: p.name, label: providerLabel(p.name), count: modelsFor(stage, p.name).length, installed: p.installed !== false }))
    .filter((p) => p.count > 0);
}

// A copy of the config with one of the language settings that has no screen of its own set (`also_understands`,
// `auto_detect`); an empty list or false is not written.
export function setLanguageField(config, key, value) {
  const next = JSON.parse(JSON.stringify(config || {}));
  next.defaults = next.defaults && typeof next.defaults === 'object' ? next.defaults : {};
  const language = next.defaults.language && typeof next.defaults.language === 'object' ? next.defaults.language : {};
  const empty = value === false || value === undefined || (Array.isArray(value) && value.length === 0);
  if (empty) delete language[key];
  else language[key] = value;
  next.defaults.language = language;
  return JSON.stringify(next) === JSON.stringify(config) ? config : next;
}
