// The Channels page: the kinds a new channel starts from (complete and valid, never blank), changing a channel's kind,
// what a channel says first, how its row is named, and the phone numbers a phone line is reached on. What a kind may
// carry comes from GET /channel-types (channelTypes.ts). Pure: no React, no network.
import type { AgentConfig, ChannelDefinition } from '../types/studio';
import type { ProvidersAnswer } from '../api/types';
import { firstLineOf, freshId, readyForVoice, RECORDING_NOTICE } from './setup';
import { speechText } from './messages';
import { infoOf, isVoiceChannel, stripVoiceOnly, type Kinds } from './channelTypes';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T = unknown,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** "web_chat" -> "Web chat" */
export function humanize(id: unknown): string {
  const words = String(id ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.\s]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : '';
}

/** Which `entry` fields mean something for each kind (for reference only: the runtime reads none of them). */
export const ENTRY_FIELDS: Record<string, string[]> = {
  sip_voice: ['dnis', 'sip_trunk', 'dispatch_rule'],
  web_voice: ['widget_id', 'allowed_origins'],
  web_chat: ['widget_id', 'allowed_origins'],
  whatsapp: ['phone_number_id'],
  sms: [],
  email: [],
};
/** Each entry field: its label, what it is, and an example of its form. */
export const ENTRY_LABELS: Record<string, [string, string, string]> = {
  dnis: ['Phone number', 'The number callers dial, for reference. It doesn’t connect a number.', '+15550100'],
  sip_trunk: ['Phone line it arrives on', 'The line from your phone provider that the number arrives on, for reference.', 'trunk-main'],
  dispatch_rule: ['Routing rule', 'The rule in your phone system that sends the call to this agent, for reference.', 'my-agent-inbound'],
  widget_id: ['Widget id', 'The id of the chat or voice widget this channel serves.', 'my-agent-widget'],
  allowed_origins: ['Allowed websites', 'The websites the widget may be placed on, for reference.', 'https://example.com'],
  phone_number_id: ['WhatsApp phone number id', 'The WhatsApp Business phone number id, for reference.', '1234567890'],
};
/** Phone routing is the platform's job (adding a number sets up the line and its rule); older values are only notes. */
export const PLATFORM_ROUTE = ['dnis', 'sip_trunk', 'dispatch_rule'];

export const CHANNEL_TYPES = ['sip_voice', 'web_voice', 'web_chat', 'whatsapp', 'sms', 'email', 'custom'];
/** The kinds in the Channels page's words (the reach switches use the same three). */
export const TYPE_LABELS: Record<string, string> = {
  sip_voice: 'Phone calls',
  web_voice: 'Talk on your website',
  web_chat: 'Chat on your website',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
  custom: 'Custom',
};
export const typeLabel = (type: unknown): string => TYPE_LABELS[String(type)] ?? humanize(type);

const GREETING_VOICE = 'Hello, thanks for calling. How can I help you today?';
const GREETING_CHAT = 'Hi! How can I help you today?';

export interface ChannelPreset {
  id: string;
  type: string;
  label: string;
  help: string;
  group: 'Voice' | 'Text';
  base: string;
}
/** The starting points "Add a channel" offers. */
export const CHANNEL_PRESETS: ChannelPreset[] = [
  { id: 'phone', type: 'sip_voice', label: TYPE_LABELS.sip_voice, help: 'People ring a phone number. You add the number when it goes live.', group: 'Voice', base: 'phone' },
  { id: 'web_voice', type: 'web_voice', label: TYPE_LABELS.web_voice, help: 'Visitors talk to it from the browser, with their microphone.', group: 'Voice', base: 'web_voice' },
  { id: 'web_chat', type: 'web_chat', label: TYPE_LABELS.web_chat, help: 'A chat box on your website that visitors type into.', group: 'Text', base: 'web_chat' },
  { id: 'whatsapp', type: 'whatsapp', label: 'WhatsApp', help: 'People message the agent on WhatsApp.', group: 'Text', base: 'whatsapp' },
  { id: 'sms', type: 'sms', label: 'SMS', help: 'People text the agent.', group: 'Text', base: 'sms' },
  { id: 'email', type: 'email', label: 'Email', help: 'People write to the agent by email.', group: 'Text', base: 'email' },
];

/** A preset as a card: offered only when the server lists the kind (when the list could be read), marked when it doesn't run yet or the agent has one. */
export function presetChoices(config: AgentConfig, types: Kinds): (ChannelPreset & { badge: string; note: string })[] {
  const known = Array.isArray(types) && types.length ? types : null;
  return CHANNEL_PRESETS.filter((p) => !known || !!infoOf(known, p.type)).map((p) => {
    const kind = infoOf(known, p.type);
    const has = list<Json>(config?.channels).some((c) => isObj(c) && c.type === p.type);
    return {
      ...p,
      badge: kind && !kind.runsToday ? 'Not available yet' : has ? 'Already added' : '',
      note: has ? 'It has one already: this adds a second.' : '',
    };
  });
}

/** What a channel of this type starts with: modalities, greeting, capabilities. */
export function defaultsForType(type: string, botId = ''): Json {
  const widget = `${botId || 'agent'}-widget`;
  switch (type) {
    case 'sip_voice':
      return { entry: {}, modalities: { input: ['audio'], output: ['audio'] }, greeting: { say: GREETING_VOICE }, capabilities: { dtmf: true, human_transfer: true } };
    case 'web_voice':
      return { entry: { widget_id: widget }, modalities: { input: ['audio'], output: ['audio'] }, greeting: { say: GREETING_VOICE }, capabilities: { forms: true } };
    case 'web_chat':
      return { entry: { widget_id: widget }, modalities: { input: ['text'], output: ['text'] }, greeting: { say: GREETING_CHAT }, capabilities: { forms: true } };
    case 'whatsapp':
      return { entry: {}, modalities: { input: ['text'], output: ['text'] }, greeting: { say: GREETING_CHAT }, capabilities: { forms: false } };
    default:
      return { modalities: { input: ['text'], output: ['text'] } };
  }
}

/** A complete new channel from a preset. Its id does not read the same as one taken ("web-chat" and "web_chat"). */
export function presetChannel(presetId: string, { taken = [], botId = '' }: { taken?: string[]; botId?: string } = {}): ChannelDefinition {
  const preset = CHANNEL_PRESETS.find((p) => p.id === presetId) ?? CHANNEL_PRESETS[0];
  const lookalikes = taken.map((id) => String(id).replace(/-/g, '_'));
  return { id: freshId([...taken, ...lookalikes], preset.base), type: preset.type, enabled: true, ...defaultsForType(preset.type, botId) } as ChannelDefinition;
}

/** Does the agent keep a record of its calls (audio or transcript), unless both are switched off? */
export const recordsCalls = (config: AgentConfig): boolean => !(config?.post_call?.recording?.audio === false && config?.post_call?.recording?.transcript === false);
const hasNotice = (config: AgentConfig) => !!String(config?.persona?.disclosures?.recording_notice ?? '').trim();

/**
 * Adds a channel as the reach switches do: saying the agent's first line, and for voice, speech models when none are
 * set. The recording notice is not written behind the person's back: `offerNotice` says to ask.
 */
export function addChannel(config: AgentConfig, channel: ChannelDefinition, { providers = null }: { providers?: ProvidersAnswer | null; types?: Kinds } = {}): { config: AgentConfig; added: string[]; offerNotice: boolean } {
  let next = clone(config);
  const added = clone(channel);
  const say = firstLineOf(next);
  if (say !== undefined && isObj(added.greeting)) added.greeting = { ...added.greeting, say: clone(say) };
  next.channels = [...list<ChannelDefinition>(next.channels), added];
  // it talks when its own modalities carry audio (a web chat could, but this one does not)
  const voice = ['input', 'output'].some((way) => list(added.modalities?.[way]).includes('audio'));
  const words: string[] = [];
  if (voice) {
    const ready = readyForVoice(next, providers);
    next = ready.config;
    words.push(...ready.added.filter((w) => !/recording notice/.test(w)));
    // readyForVoice writes the notice; it is offered instead
    if (!hasNotice(config) && next.persona?.disclosures) {
      const disclosures = { ...next.persona.disclosures } as Json;
      delete disclosures.recording_notice;
      const persona = { ...next.persona } as Json;
      if (Object.keys(disclosures).length) persona.disclosures = disclosures;
      else delete persona.disclosures;
      if (Object.keys(persona).length) next.persona = persona as AgentConfig['persona'];
      else delete next.persona;
    }
  }
  return { config: next, added: words, offerNotice: voice && !hasNotice(next) && recordsCalls(next) };
}

/** The recording notice callers hear first. */
export function setRecordingNotice(config: AgentConfig, text = RECORDING_NOTICE): AgentConfig {
  const next = clone(config);
  next.persona = { ...(next.persona ?? {}), disclosures: { ...(next.persona?.disclosures ?? {}), recording_notice: text } };
  return next;
}

/** Takes the channel at `index` away. */
export function removeChannel(config: AgentConfig, index: number): AgentConfig {
  const next = clone(config);
  next.channels = list<ChannelDefinition>(next.channels).filter((_, i) => i !== index);
  return next;
}

/** Gives the channel at `index` the agent's first line, so a channel waiting for the person can say it too. */
export function shareFirstLine(config: AgentConfig, index: number): AgentConfig {
  const say = firstLineOf(config);
  const channel = list<ChannelDefinition>(config?.channels)[index];
  if (say === undefined || !isObj(channel)) return config;
  const next = clone(config);
  next.channels = list<ChannelDefinition>(next.channels).map((c, i) => (i === index ? { ...c, greeting: { ...(isObj(channel.greeting) ? channel.greeting : {}), say: clone(say) } } : c));
  return next;
}

/** What a channel says first, in words, and whether the agent's first line can be given to it. */
export function greetingNote(config: AgentConfig, index: number): { text: string; share: '' | 'instead' | 'too' } {
  const channels = list<ChannelDefinition>(config?.channels);
  const channel = channels[index];
  if (!isObj(channel)) return { text: '', share: '' };
  const line = firstLineOf(config);
  const say = isObj(channel.greeting) ? channel.greeting.say : undefined;
  if (say !== undefined) {
    const own = speechText(say, config).trim();
    if (line !== undefined && own && !same(line, say)) return { text: `This channel says its own first line: “${own}”.`, share: 'instead' };
    const every = channels.filter(isObj).every((c) => isObj(c.greeting) && c.greeting.say !== undefined && same(c.greeting.say, say));
    return { text: `${every ? 'What it says first is the same on every channel' : 'What it says first is the agent’s first line'}${own ? `: “${own}”` : ''}. Change it on the Agent page.`, share: '' };
  }
  const greets = isObj(defaultsForType(String(channel.type)).greeting);
  return {
    text: line === undefined ? 'This channel waits for the person to start. What it says first is set on the Agent page.' : 'This channel waits for the person to start.',
    share: line !== undefined && greets ? 'too' : '',
  };
}

/**
 * A row's title: its kind, as the reach switches say it. Two of one kind are told apart by id in words ("Phone calls ·
 * Sales line"), or by number when the ids say nothing more than the kind ("… 2").
 */
export function channelTitle(config: AgentConfig, index: number): string {
  const channels = list<ChannelDefinition>(config?.channels);
  const item = channels[index];
  if (!isObj(item)) return 'Channel';
  const id = typeof item.id === 'string' ? item.id : '';
  const sameKind = channels.filter((c) => isObj(c) && c.type === item.type);
  const kindTitle = typeLabel(item.type);
  const plainId = (c: ChannelDefinition) => {
    const w = humanize(c?.id).toLowerCase();
    return !w || [typeLabel(c.type), String(c.type)].some((name) => w.startsWith(humanize(name).toLowerCase()));
  };
  const words = humanize(id);
  const lookalike = sameKind.some((c) => typeof c.id === 'string' && c.id !== id && humanize(c.id) === words);
  const position = sameKind.indexOf(item) + 1;
  if (sameKind.length < 2 || !id) return kindTitle;
  return plainId(item) || lookalike ? `${kindTitle}${position > 1 ? ` ${position}` : ''}` : `${kindTitle} · ${words}`;
}

const clip = (s: string, max = 60) => (s.length > max ? `${s.slice(0, max)}…` : s);
/** What a channel says first, in a few words, for its row. */
export function channelHint(config: AgentConfig, channel: ChannelDefinition): string {
  const say = isObj(channel?.greeting) ? channel.greeting.say : undefined;
  if (typeof say === 'string' && say.trim()) return `Says “${clip(say.trim())}”`;
  if (isObj(say)) {
    const text = speechText(say, config).trim();
    return text ? `Says “${clip(text)}”` : 'Says one of its fixed lines first';
  }
  return 'Waits for the person to start';
}

const WORDS: Record<string, string> = { audio: 'voice', text: 'text', image: 'pictures', video: 'video' };
const together = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0] ?? '');
/** "text in and out", "voice and text in, voice out". */
export function modalityWords(modalities: unknown): string {
  const m = isObj(modalities) ? modalities : {};
  const input = list<string>(m.input).map((x) => WORDS[x] ?? x);
  const output = list<string>(m.output).map((x) => WORDS[x] ?? x);
  if (!input.length && !output.length) return '';
  if (input.join() === output.join()) return `${together(input)} in and out`;
  return [input.length ? `${together(input)} in` : '', output.length ? `${together(output)} out` : ''].filter(Boolean).join(', ');
}

/** What each capability means, and what it is when nobody has said. */
export const CAPABILITIES: { key: 'dtmf' | 'human_transfer' | 'forms'; label: string; help: string; fallback: (type: string) => boolean }[] = [
  { key: 'dtmf', label: 'Keypad tones', help: 'Callers can press keys and the agent can send tones. Only a phone line has a keypad.', fallback: () => false },
  { key: 'human_transfer', label: 'Hand over to a person', help: 'Off: a transfer skips the hand-over on this channel and runs its fallback straight away.', fallback: () => true },
  { key: 'forms', label: 'Show forms', help: 'Where it can’t, a form runs its “otherwise” actions instead.', fallback: (type) => type === 'web_chat' || type === 'web_voice' },
];

/**
 * Changing a channel's kind: entry fields it lacks go, the ones it needs come, and modalities / greeting / capabilities
 * are reset only while still the old kind's defaults. What the new kind cannot carry goes too (when the server said what
 * it can). `cleared` names what was dropped, so the person can be asked first.
 */
export function changeChannelType(channel: ChannelDefinition, nextType: string, botId = '', types: Kinds = null): { channel: ChannelDefinition; cleared: string[] } {
  const old = defaultsForType(String(channel.type), botId);
  const fresh = defaultsForType(nextType, botId);
  const keep = ENTRY_FIELDS[nextType];
  const entry: Json = { ...(isObj(channel.entry) ? channel.entry : {}) };
  const cleared: string[] = [];
  if (keep)
    Object.keys(entry).forEach((key) => {
      if (!keep.includes(key)) {
        if (entry[key] !== '' && !(Array.isArray(entry[key]) && !(entry[key] as unknown[]).length)) cleared.push(`entry.${key}`);
        delete entry[key];
      }
    });
  if (nextType === 'web_chat' && !entry.widget_id) entry.widget_id = (fresh.entry as Json).widget_id;
  const next: Json = { ...clone(channel), type: nextType };
  if (fresh.entry !== undefined || Object.keys(entry).length) next.entry = entry;
  else delete next.entry;
  if (nextType === 'sip_voice' && !next.entry) next.entry = {};
  if (same(channel.modalities, old.modalities)) next.modalities = fresh.modalities;
  if (channel.greeting && same(channel.greeting, old.greeting) && fresh.greeting) next.greeting = fresh.greeting;
  if (channel.capabilities && same(channel.capabilities, old.capabilities)) {
    if (fresh.capabilities) next.capabilities = fresh.capabilities;
    else delete next.capabilities;
  }
  if (isObj(channel.match) && Object.keys(channel.match).length) {
    cleared.push('match');
    delete next.match;
  }
  const kind = infoOf(types, nextType);
  if (kind && isObj(next.modalities)) {
    const fit = (given: unknown, allowed: string[] | null, fallback: string[]) => {
      const values = list<string>(given);
      if (!allowed) return { values, lost: false };
      const kept = values.filter((v) => allowed.includes(v));
      return { values: kept.length ? kept : fallback.length ? fallback : values, lost: kept.length !== values.length };
    };
    const input = fit(next.modalities.input, kind.input, kind.defaultModalities.input);
    const output = fit(next.modalities.output, kind.output, kind.defaultModalities.output);
    if (input.lost || output.lost) cleared.push('modalities');
    next.modalities = { input: input.values, output: output.values };
  }
  if (kind && isObj(next.capabilities)) {
    const caps: Json = { ...next.capabilities };
    if (!kind.canKeypad && caps.dtmf === true) {
      delete caps.dtmf;
      cleared.push('capabilities.dtmf');
    }
    if (!kind.canForms && caps.forms === true) {
      delete caps.forms;
      cleared.push('capabilities.forms');
    }
    if (Object.keys(caps).length) next.capabilities = caps;
    else delete next.capabilities;
  }
  if (kind && isObj(next.overrides) && !isVoiceChannel(next as ChannelDefinition, types)) {
    const { overrides, removed } = stripVoiceOnly(next.overrides);
    cleared.push(...removed);
    if (overrides) next.overrides = overrides;
    else delete next.overrides;
  }
  if (kind && isObj(next.inputs)) {
    const inputs: Json = { ...next.inputs };
    ['image', 'video'].forEach((key) => {
      if (key in inputs && kind.input && !kind.input.includes(key)) {
        delete inputs[key];
        cleared.push(`inputs.${key}`);
      }
    });
    if (Object.keys(inputs).length) next.inputs = inputs;
    else delete next.inputs;
  }
  return { channel: next as ChannelDefinition, cleared: Array.from(new Set(cleared)) };
}

/** What a channel's modalities need from the rest of the config, as sentences (the validator says so only afterwards). */
export function modalityNotes(channel: ChannelDefinition | null | undefined, config: AgentConfig): { level: 'warn' | 'info'; text: string }[] {
  const models = (config?.defaults?.models ?? {}) as Json;
  const input = list<string>(channel?.modalities?.input);
  const output = list<string>(channel?.modalities?.output);
  const provider = (stage: string) => (isObj(models[stage]) ? (models[stage] as Json).provider : undefined);
  const notes: { level: 'warn' | 'info'; text: string }[] = [];
  if (input.includes('audio') && !provider('stt')) notes.push({ level: 'warn', text: 'Audio in needs a speech-to-text model. None is set yet.' });
  if (output.includes('audio') && !provider('tts')) notes.push({ level: 'warn', text: 'Audio out needs a text-to-speech model. None is set yet.' });
  if ((input.includes('image') || input.includes('video')) && !(isObj(models.llm) && (models.llm as Json).vision === true))
    notes.push({ level: 'warn', text: 'Images and video are only understood by a language model with vision. Turn on “vision” for the model.' });
  if (input.includes('audio') || output.includes('audio')) notes.push({ level: 'info', text: 'Audio channels also use voice detection and the turn-taking settings in the agent’s defaults.' });
  return notes;
}

// ---- the numbers a phone line is reached on ----------------------------------------------------------------------------------------------------
/** The numbers in GET /bots/{id}/numbers, read tolerantly (a bare list or { numbers }). */
export function readNumbers(raw: unknown): { number: string; environment: string }[] {
  const rows = Array.isArray(raw) ? raw : isObj(raw) ? list(raw.numbers) : [];
  return rows
    .filter(isObj)
    .map((r) => ({ number: typeof r.number === 'string' ? r.number : '', environment: typeof r.environment === 'string' ? r.environment : '' }))
    .filter((r) => r.number);
}

/** A phone line's numbers in words. */
export function phoneLineWords(numbers: { number: string; environment: string }[]): string {
  if (!numbers.length) return 'No number yet: add one when it goes live';
  return `Callers dial ${numbers.map((n) => (n.environment ? `${n.number} (${n.environment})` : n.number)).join(', ')}`;
}
