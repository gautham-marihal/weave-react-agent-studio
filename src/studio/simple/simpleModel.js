// The everyday settings the agent's own pages read and write (Instructions, Voice & Language, AI Model, Connections),
// as ordinary config fields so the form, the JSON and these pages always agree. Each setter returns the same object
// when nothing changes and never touches a field it doesn't own. Pure: no network, no DOM.

import { isObj } from '../form/engine.js';
import { baseOf, primaryOf } from '../form/messages.ts';
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

// Whether a channel speaks first. An empty line is no greeting (the schema refuses it), so the channel waits.
const greets = (channel) => isObj(channel) && isObj(channel.greeting) && channel.greeting.say !== undefined && channel.greeting.say !== '';

export const entryAgentIndex = (config) => {
  const items = list(config?.agents?.items);
  const index = items.findIndex((agent) => isObj(agent) && typeof agent.id === 'string' && agent.id === config?.agents?.entry);
  // no (or an unknown) entry named: the first real agent, never a null or half-typed one that can't be written into
  return index >= 0 ? index : items.findIndex(isObj);
};
export const entryAgent = (config) => list(config?.agents?.items)[entryAgentIndex(config)] || null;

// ---- the languages offered (a primary language is a locale; "also speaks" are base languages)
export const LANGUAGES = [
  ['en-US', 'English (United States)'],
  ['en-GB', 'English (United Kingdom)'],
  ['en-AU', 'English (Australia)'],
  ['en-IN', 'English (India)'],
  ['en-NG', 'English (Nigeria)'],
  ['es-ES', 'Spanish (Spain)'],
  ['es-MX', 'Spanish (Mexico)'],
  ['fr-FR', 'French (France)'],
  ['fr-CA', 'French (Canada)'],
  ['de-DE', 'German'],
  ['it-IT', 'Italian'],
  ['pt-BR', 'Portuguese (Brazil)'],
  ['pt-PT', 'Portuguese (Portugal)'],
  ['nl-NL', 'Dutch'],
  ['sv-SE', 'Swedish'],
  ['pl-PL', 'Polish'],
  ['tr-TR', 'Turkish'],
  ['ar-SA', 'Arabic'],
  ['hi-IN', 'Hindi'],
  ['ja-JP', 'Japanese'],
  ['ko-KR', 'Korean'],
  ['zh-CN', 'Chinese (Mandarin)'],
  ['id-ID', 'Indonesian'],
  ['sw-KE', 'Swahili'],
];
export const languageName = (code) =>
  LANGUAGES.find(([c]) => c === code)?.[1] || LANGUAGES.find(([c]) => baseOf(c) === baseOf(code))?.[1]?.replace(/ \(.*\)$/, '') || code || '';
// Base languages for the "also speaks" choices, one per language.
export const BASE_LANGUAGES = [...new Map(LANGUAGES.map(([code, name]) => [baseOf(code), name.replace(/ \(.*\)$/, '')]))].map(([code, name]) => ({
  code,
  name,
}));

const CHANNEL_NAMES = { sip_voice: 'Phone', web_voice: 'Web voice', web_chat: 'Web chat', whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email', custom: 'Custom' };
export const channelName = (type) => CHANNEL_NAMES[type] || String(type || 'Channel');

// ---- reading
export function readSimple(config) {
  const agent = entryAgent(config);
  const channels = list(config?.channels).filter((c) => isObj(c));
  const greetingChannel = channels.find(greets) || null;
  const greetingSay = greetingChannel?.greeting?.say;
  const languages = isObj(config?.defaults?.language) ? config.defaults.language : {};
  const voiceChannel = channels.some(
    (c) => c.enabled !== false && (['sip_voice', 'web_voice'].includes(c.type) || list(c.modalities?.output).includes('audio')),
  );
  return {
    name: typeof config?.meta?.name === 'string' ? config.meta.name : '',
    persona: typeof config?.persona?.name === 'string' ? config.persona.name : '',
    role: typeof agent?.instructions?.role === 'string' ? agent.instructions.role : '',
    agentId: agent?.id || '',
    greeting: typeof greetingSay === 'string' ? greetingSay : speechText(greetingSay, config),
    greetingIsReference: isObj(greetingSay) && !!greetingSay.message,
    greetingChannels: channels.filter(greets).length,
    tone: typeof config?.persona?.tone === 'string' ? config.persona.tone : '',
    styleRules: list(config?.persona?.style_rules).filter((r) => typeof r === 'string'),
    primaryLanguage: primaryOf(config),
    speaks: list(languages.speaks).filter((c) => typeof c === 'string'),
    voiceChannel,
    recordingNotice: typeof config?.persona?.disclosures?.recording_notice === 'string' ? config.persona.disclosures.recording_notice : '',
    channels: channels.map((c) => ({ id: c.id, type: c.type, name: channelName(c.type), enabled: c.enabled !== false })),
  };
}

// ---- writing
export function setAgentName(config, name) {
  const value = String(name ?? '');
  return edit(config, (next) => {
    next.meta = { ...(isObj(next.meta) ? next.meta : {}), name: value };
    // persona.name follows the agent's name while they matched. Emptied, it empties too, so the next name typed is
    // still followed; kept, it would no longer match and the old name would stay.
    if (isObj(next.persona) && (next.persona.name === config.meta?.name || !next.persona.name) && (value || next.persona.name)) next.persona.name = value;
  });
}

export function setRole(config, text) {
  const index = entryAgentIndex(config);
  if (index < 0) return config;
  return edit(config, (next) => {
    next.agents.items[index].instructions = {
      ...(isObj(next.agents.items[index].instructions) ? next.agents.items[index].instructions : {}),
      role: String(text ?? ''),
    };
  });
}

// ---- what it says first
// The channels a greeting is written to, each with what it said: { id, index, say }. A page passes the same target
// while its field is edited, so emptying and retyping writes to the same channels (and re-points a message reference).
// greetingTarget: channels saying the same as the first with a greeting (every channel while none has one); a channel
// that says something else keeps it.
const placeOf = (channel, index) => ({ id: channel.id, index, say: greets(channel) ? clone(channel.greeting.say) : undefined });
export function greetingTarget(config) {
  const channels = list(config?.channels);
  const first = channels.find(greets);
  return channels.flatMap((c, index) => (isObj(c) && (!first || (greets(c) && same(c.greeting.say, first.greeting.say))) ? [placeOf(c, index)] : []));
}
// the channels one channel's own greeting field writes to (the Workflow's channel panel): it, and every other channel
// that says the same line, so a line several channels share stays one line; just it while it says nothing
export function channelGreetingTarget(config, index) {
  const channels = list(config?.channels);
  const mine = channels[index];
  if (!isObj(mine)) return [];
  return channels.flatMap((c, i) => (i === index || (greets(mine) && greets(c) && same(c.greeting.say, mine.greeting.say)) ? [placeOf(c, i)] : []));
}
// every channel with a greeting, or every channel while none has one: what is written to when no channels are given
function everyGreeting(config) {
  const channels = list(config?.channels);
  const any = channels.some(greets);
  return channels.flatMap((c, index) => (isObj(c) && (!any || greets(c)) ? [placeOf(c, index)] : []));
}
// The target's channels still there (by id, or by place without one). `sameLine`: only those saying the same as the
// first with a greeting, or nothing; one changed meanwhile to say something else is left alone.
function targetIn(channels, target, sameLine) {
  const found = list(target).flatMap((place) => {
    const channel = typeof place?.id === 'string' && place.id ? channels.find((c) => isObj(c) && c.id === place.id) : channels[place?.index];
    return isObj(channel) ? [{ place, channel }] : [];
  });
  const first = found.find(({ channel }) => greets(channel));
  return sameLine && first ? found.filter(({ channel }) => !greets(channel) || same(channel.greeting.say, first.channel.greeting.say)) : found;
}
// the channels a page's field is for: its target's, or greetingTarget's when none is left (or it has none yet)
function fieldChannels(config, target) {
  const channels = list(config?.channels);
  const given = target ? targetIn(channels, target, true) : [];
  return given.length ? given : targetIn(channels, greetingTarget(config), true);
}

// The first thing the agent says, on the given channels (default: every channel with a greeting, or all while none has
// one; greeting only some channels is the full form's job). A greeting pointing at a message changes that message.
// An empty line removes the greeting (an empty one is refused) so the channel waits for the caller; the message it
// pointed at is kept, and pointed at again when a line is typed for the same channels.
//   target: from greetingTarget, kept by a page while its field is edited
export function setGreeting(config, text, target = null) {
  const value = String(text ?? '');
  return edit(config, (next) => {
    const places = target ? fieldChannels(next, target) : targetIn(list(next.channels), everyGreeting(next), false);
    places.forEach(({ place, channel }) => {
      const greeting = isObj(channel.greeting) ? channel.greeting : {};
      if (!value) {
        if (greeting.say === undefined) return;
        delete greeting.say;
        if (Object.keys(greeting).length) channel.greeting = greeting;
        else delete channel.greeting;
        return;
      }
      // what it says now, or what it said before its field was emptied
      const say = greets(channel) ? greeting.say : place.say;
      const message = isObj(say) && say.message ? list(next.messages).find((m) => isObj(m) && m.id === say.message) : null;
      channel.greeting = { ...greeting, say: message ? { message: say.message } : value };
      if (message)
        message.text =
          typeof message.text === 'string' || !isObj(message.text)
            ? value
            : { ...message.text, [Object.keys(message.text).find((k) => baseOf(k) === baseOf(primaryOf(next))) || Object.keys(message.text)[0]]: value };
    });
  });
}

// What a greeting field shows for a target: the line of its first channel that has one ('' while none has), whether
// that line is a message, who says it, who waits, what the others say instead, and whether it is every channel.
//   { text, reference, saying: [name], waiting: [name], others: [{ name, text }], every }
export function greetingOf(config, target = null) {
  const channels = list(config?.channels);
  const mine = fieldChannels(config, target);
  const say = mine.map(({ channel }) => channel).find(greets)?.greeting.say;
  const inMine = new Set(mine.map(({ channel }) => channel));
  const words = (s) => (typeof s === 'string' ? s : speechText(s, config));
  return {
    text: say === undefined ? '' : words(say),
    reference: isObj(say) && !!say.message,
    saying: mine.filter(({ channel }) => greets(channel)).map(({ channel }) => channelName(channel.type)),
    waiting: mine.filter(({ channel }) => !greets(channel)).map(({ channel }) => channelName(channel.type)),
    others: channels.filter((c) => greets(c) && !inMine.has(c)).map((c) => ({ name: channelName(c.type), text: words(c.greeting.say) })),
    every: inMine.size === channels.filter(isObj).length,
  };
}

// Gives every channel that says something else first the target's line (asked for: "Say this on Phone too").
// Channels that wait for the caller are left waiting.
export function shareGreeting(config, target = null) {
  const say = fieldChannels(config, target)
    .map(({ channel }) => channel)
    .find(greets)?.greeting.say;
  if (say === undefined) return config;
  return edit(config, (next) =>
    list(next.channels).forEach((channel) => {
      if (greets(channel)) channel.greeting.say = clone(say);
    }),
  );
}

// persona.name (the name it calls itself) or persona.company (the business it speaks for); emptied, it goes.
export function setPersonaField(config, key, text) {
  const value = String(text ?? '');
  return edit(config, (next) => {
    next.persona = { ...(isObj(next.persona) ? next.persona : {}) };
    if (value) next.persona[key] = value;
    else delete next.persona[key];
  });
}

export function setTone(config, tone) {
  const value = String(tone ?? '');
  return edit(config, (next) => {
    next.persona = { ...(isObj(next.persona) ? next.persona : {}) };
    if (value) next.persona.tone = value;
    else delete next.persona.tone;
  });
}

export function setStyleRules(config, rules) {
  const value = list(rules).map((r) => String(r ?? ''));
  return edit(config, (next) => {
    next.persona = { ...(isObj(next.persona) ? next.persona : {}) };
    if (value.length) next.persona.style_rules = value;
    else delete next.persona.style_rules;
  });
}

export function setRecordingNotice(config, text) {
  const value = String(text ?? '');
  return edit(config, (next) => {
    next.persona = { ...(isObj(next.persona) ? next.persona : {}) };
    const disclosures = { ...(isObj(next.persona.disclosures) ? next.persona.disclosures : {}) };
    if (value) disclosures.recording_notice = value;
    else delete disclosures.recording_notice;
    if (Object.keys(disclosures).length) next.persona.disclosures = disclosures;
    else delete next.persona.disclosures;
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
    language.speaks = on ? [...without, base] : base === primary ? [...without, base] : without; // the primary language can't be switched off
    next.defaults.language = language;
  });
}
