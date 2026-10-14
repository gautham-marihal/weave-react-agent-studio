// The Simple view reads and writes a handful of everyday settings out of the full agent configuration: who the agent is and what it does
// (Instructions), the language it speaks and its voice (Voice & Language), and what it is made with and connected to (AI Model,
// Connections). Everything it writes is an ordinary field of the configuration, so the full form, the JSON and the Simple view always
// agree. Each setter returns the same object when nothing would change, and never touches a field it doesn't own.
// Pure: no network, no DOM.

import { isObj } from '../form/engine.js';
import { baseOf, primaryOf } from '../form/messages.js';
import { speechText } from '../../demo/simulatedAgent.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const list = (v) => (Array.isArray(v) ? v : []);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Edits a copy; the same object comes back when nothing changed.
function edit(config, change) {
  const next = clone(config);
  change(next);
  return same(next, config) ? config : next;
}

export const entryAgentIndex = (config) => {
  const items = list(config?.agents?.items);
  const index = items.findIndex((agent) => agent?.id === config?.agents?.entry);
  return index >= 0 ? index : items.length ? 0 : -1;
};
export const entryAgent = (config) => list(config?.agents?.items)[entryAgentIndex(config)] || null;

// ---- the languages offered (a primary language is a locale; "also speaks" are base languages)
export const LANGUAGES = [
  ['en-US', 'English (United States)'], ['en-GB', 'English (United Kingdom)'], ['en-AU', 'English (Australia)'], ['en-IN', 'English (India)'], ['en-NG', 'English (Nigeria)'],
  ['es-ES', 'Spanish (Spain)'], ['es-MX', 'Spanish (Mexico)'], ['fr-FR', 'French (France)'], ['fr-CA', 'French (Canada)'], ['de-DE', 'German'], ['it-IT', 'Italian'],
  ['pt-BR', 'Portuguese (Brazil)'], ['pt-PT', 'Portuguese (Portugal)'], ['nl-NL', 'Dutch'], ['sv-SE', 'Swedish'], ['pl-PL', 'Polish'], ['tr-TR', 'Turkish'],
  ['ar-SA', 'Arabic'], ['hi-IN', 'Hindi'], ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'], ['zh-CN', 'Chinese (Mandarin)'], ['id-ID', 'Indonesian'], ['sw-KE', 'Swahili'],
];
export const languageName = (code) => LANGUAGES.find(([c]) => c === code)?.[1] || LANGUAGES.find(([c]) => baseOf(c) === baseOf(code))?.[1]?.replace(/ \(.*\)$/, '') || code || '';
// Base languages for the "also speaks" choices, one per language.
export const BASE_LANGUAGES = [...new Map(LANGUAGES.map(([code, name]) => [baseOf(code), name.replace(/ \(.*\)$/, '')]))].map(([code, name]) => ({ code, name }));

const CHANNEL_NAMES = { sip_voice: 'Phone', web_voice: 'Web voice', web_chat: 'Web chat', whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };
export const channelName = (type) => CHANNEL_NAMES[type] || String(type || 'Channel');

// ---- reading
export function readSimple(config) {
  const agent = entryAgent(config);
  const channels = list(config?.channels).filter((c) => isObj(c));
  const greetingChannel = channels.find((c) => c.greeting && c.greeting.say !== undefined) || null;
  const greetingSay = greetingChannel?.greeting?.say;
  const languages = isObj(config?.defaults?.language) ? config.defaults.language : {};
  const voiceChannel = channels.some((c) => c.enabled !== false && (['sip_voice', 'web_voice'].includes(c.type) || list(c.modalities?.output).includes('audio')));
  return {
    name: typeof config?.meta?.name === 'string' ? config.meta.name : '',
    persona: typeof config?.persona?.name === 'string' ? config.persona.name : '',
    role: typeof agent?.instructions?.role === 'string' ? agent.instructions.role : '',
    agentId: agent?.id || '',
    greeting: typeof greetingSay === 'string' ? greetingSay : speechText(greetingSay, config),
    greetingIsReference: isObj(greetingSay) && !!greetingSay.message,
    greetingChannels: channels.filter((c) => c.greeting && c.greeting.say !== undefined).length,
    tone: typeof config?.persona?.tone === 'string' ? config.persona.tone : '',
    styleRules: list(config?.persona?.style_rules).filter((r) => typeof r === 'string'),
    primaryLanguage: primaryOf(config),
    speaks: list(languages.speaks).filter((c) => typeof c === 'string'),
    voiceChannel,
    recordingNotice: typeof config?.persona?.disclosures?.recording_notice === 'string' ? config.persona.disclosures.recording_notice : '',
    channels: channels.map((c) => ({ id: c.id, type: c.type, name: channelName(c.type), enabled: c.enabled !== false })),
  };
}

// What each connection is, in a few words.
export function readConnections(config) {
  return Object.entries(isObj(config?.connections) ? config.connections : {}).map(([id, c]) => ({
    id,
    type: isObj(c) ? c.type || 'connection' : 'connection',
    detail: isObj(c) ? c.base_url || c.url || c.server_url || c.provider || '' : '',
    secrets: isObj(c) ? JSON.stringify(c).match(/"secret":"([A-Z0-9_]+)"/g)?.map((m) => m.slice(10, -1)) || [] : [],
  }));
}

export function readTools(config) {
  const used = new Set(list(config?.agents?.items).flatMap((a) => list(a?.tools)));
  return list(config?.tools).filter((t) => isObj(t)).map((t) => ({ id: t.id, kind: t.type || (t.builtin ? 'builtin' : 'tool'), builtin: t.builtin || '', description: t.description || '', used: used.has(t.id) }));
}

// ---- writing
export function setAgentName(config, name) {
  const value = String(name ?? '');
  return edit(config, (next) => {
    next.meta = { ...(isObj(next.meta) ? next.meta : {}), name: value };
    // the name it calls itself follows the agent's name while the two were the same
    if (isObj(next.persona) && (next.persona.name === config.meta?.name || !next.persona.name)) next.persona.name = value || next.persona.name;
  });
}

export function setRole(config, text) {
  const index = entryAgentIndex(config);
  if (index < 0) return config;
  return edit(config, (next) => { next.agents.items[index].instructions = { ...(isObj(next.agents.items[index].instructions) ? next.agents.items[index].instructions : {}), role: String(text ?? '') }; });
}

// The first thing the agent says. A channel whose greeting points at a message gets that message's text changed; a channel without a
// greeting is left without one (adding a greeting where there was none is the full form's job).
export function setGreeting(config, text) {
  const value = String(text ?? '');
  return edit(config, (next) => {
    list(next.channels).forEach((channel) => {
      if (!isObj(channel) || !isObj(channel.greeting) || channel.greeting.say === undefined) return;
      const say = channel.greeting.say;
      if (typeof say === 'string') channel.greeting.say = value;
      else if (isObj(say) && say.message) {
        const message = list(next.messages).find((m) => m?.id === say.message);
        if (message) message.text = typeof message.text === 'string' || !isObj(message.text) ? value : { ...message.text, [Object.keys(message.text).find((k) => baseOf(k) === baseOf(primaryOf(next))) || Object.keys(message.text)[0]]: value };
      }
    });
  });
}

export function setTone(config, tone) {
  const value = String(tone ?? '');
  return edit(config, (next) => { next.persona = { ...(isObj(next.persona) ? next.persona : {}) }; if (value) next.persona.tone = value; else delete next.persona.tone; });
}

export function setStyleRules(config, rules) {
  const value = list(rules).map((r) => String(r ?? ''));
  return edit(config, (next) => { next.persona = { ...(isObj(next.persona) ? next.persona : {}) }; if (value.length) next.persona.style_rules = value; else delete next.persona.style_rules; });
}

export function setRecordingNotice(config, text) {
  const value = String(text ?? '');
  return edit(config, (next) => {
    next.persona = { ...(isObj(next.persona) ? next.persona : {}) };
    const disclosures = { ...(isObj(next.persona.disclosures) ? next.persona.disclosures : {}) };
    if (value) disclosures.recording_notice = value; else delete disclosures.recording_notice;
    if (Object.keys(disclosures).length) next.persona.disclosures = disclosures; else delete next.persona.disclosures;
  });
}

// The primary language is a locale; the agent also speaks its base language (en-US -> en), kept first in the list.
export function setPrimaryLanguage(config, code) {
  const value = String(code || '');
  return edit(config, (next) => {
    next.defaults = { ...(isObj(next.defaults) ? next.defaults : {}) };
    const language = { ...(isObj(next.defaults.language) ? next.defaults.language : {}) };
    if (value) {
      language.primary = value;
      const speaks = list(language.speaks).filter((c) => typeof c === 'string');
      language.speaks = [baseOf(value), ...speaks.filter((c) => baseOf(c) !== baseOf(value))];
    } else delete language.primary;
    next.defaults.language = language;
  });
}

export function toggleSpoken(config, base, on) {
  return edit(config, (next) => {
    next.defaults = { ...(isObj(next.defaults) ? next.defaults : {}) };
    const language = { ...(isObj(next.defaults.language) ? next.defaults.language : {}) };
    const speaks = list(language.speaks).filter((c) => typeof c === 'string');
    const primary = baseOf(primaryOf(next));
    const without = speaks.filter((c) => baseOf(c) !== base);
    language.speaks = on ? [...without, base] : (base === primary ? [...without, base] : without); // the primary language can't be switched off
    next.defaults.language = language;
  });
}
