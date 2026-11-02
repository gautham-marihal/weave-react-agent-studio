// The Agent page: its name, what the agent that answers first should do (its role), what it says first on every
// channel, its tone, and the sentence about where conversations are processed. Each is an ordinary config field, so
// this page, the full settings and the JSON always agree. Every setter returns the same object when nothing changes
// and never touches a field it doesn't own. Pure: no React, no network.
import type { AgentConfig } from '../types/studio';
import { baseOf } from './languages';
import { providerLabel } from '../data/providers';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T = unknown,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Edits a copy; the same object comes back when nothing changed.
function edit(config: AgentConfig, change: (next: Json) => void): AgentConfig {
  const next = clone(config) as Json;
  change(next);
  return same(next, config) ? config : (next as AgentConfig);
}

/** "Web chat", "Web chat and Phone", "Web chat, Phone and SMS" (each name once). */
export function inWords(names: string[]): string {
  const each = [...new Set(names)];
  return each.length > 1 ? `${each.slice(0, -1).join(', ')} and ${each[each.length - 1]}` : each[0] ?? '';
}

/** The agent that answers first: agents.entry, else the first real agent (never a null or half-typed item). -1 if none. */
export function entryAgentIndex(config: AgentConfig | null | undefined): number {
  const items = list(config?.agents?.items);
  const index = items.findIndex((a) => isObj(a) && typeof a.id === 'string' && a.id === config?.agents?.entry);
  return index >= 0 ? index : items.findIndex(isObj);
}

const CHANNEL_NAMES: Record<string, string> = { sip_voice: 'Phone', web_voice: 'Web voice', web_chat: 'Web chat', whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email', custom: 'Custom' };
export const channelName = (type: unknown): string => CHANNEL_NAMES[String(type)] ?? String(type || 'Channel');

// A channel speaks first when it has a line; an empty one is refused by the schema, so the channel waits instead.
const greets = (channel: unknown): channel is Json & { greeting: Json } => isObj(channel) && isObj(channel.greeting) && channel.greeting.say !== undefined && channel.greeting.say !== '';

/** The language the agent mainly speaks, as written ('' when none is). */
const primaryOf = (config: unknown): string => {
  const language = isObj(config) && isObj(config.defaults) && isObj(config.defaults.language) ? config.defaults.language : {};
  if (typeof language.primary === 'string' && language.primary) return language.primary;
  return list<unknown>(language.speaks).find((c): c is string => typeof c === 'string' && !!c) ?? '';
};

/** A fixed line's words: its text, or for a line in several languages the main language's (else the first). */
function messageText(message: unknown, config: unknown): string {
  if (!isObj(message)) return '';
  const text = message.text;
  if (typeof text === 'string') return text;
  if (!isObj(text)) return '';
  const primary = primaryOf(config);
  const key = Object.keys(text).find((code) => primary && baseOf(code) === baseOf(primary)) ?? Object.keys(text)[0];
  return key ? String(text[key] ?? '') : '';
}

/** What a greeting says in words: its text, or the words of the fixed line it points at. */
export function speechText(say: unknown, config: unknown): string {
  if (typeof say === 'string') return say;
  if (isObj(say) && typeof say.message === 'string') {
    const messages = isObj(config) ? list(config.messages) : [];
    return messageText(
      messages.find((m) => isObj(m) && m.id === say.message),
      config,
    );
  }
  return '';
}

// ---- reading --------------------------------------------------------------------------------------------------------
export function readAgentPage(config: AgentConfig | null | undefined) {
  const agent = list<Json>(config?.agents?.items)[entryAgentIndex(config)] ?? null;
  const channels = list<Json>(config?.channels).filter(isObj);
  const instructions = isObj(agent?.instructions) ? agent.instructions : {};
  const greetingSay = channels.find(greets)?.greeting.say;
  return {
    name: typeof config?.meta?.name === 'string' ? config.meta.name : '',
    persona: typeof config?.persona?.name === 'string' ? config.persona.name : '',
    company: typeof config?.persona?.company === 'string' ? config.persona.company : '',
    role: typeof instructions.role === 'string' ? instructions.role : '',
    agentId: typeof agent?.id === 'string' ? agent.id : '',
    greeting: speechText(greetingSay, config),
    greetingIsReference: isObj(greetingSay) && !!greetingSay.message,
    tone: typeof config?.persona?.tone === 'string' ? config.persona.tone : '',
    styleRules: list(config?.persona?.style_rules).filter((r): r is string => typeof r === 'string'),
    sharedRules: list(config?.persona?.shared_rules).filter((r): r is string => typeof r === 'string'),
    // it talks somewhere: a phone line, talking on the website, or a channel that answers in audio
    voiceChannel: channels.some((c) => c.enabled !== false && (['sip_voice', 'web_voice'].includes(String(c.type)) || list(isObj(c.modalities) ? c.modalities.output : null).includes('audio'))),
    channels: channels.map((c) => ({ id: String(c.id ?? ''), type: String(c.type ?? ''), name: channelName(c.type), enabled: c.enabled !== false })),
  };
}

// ---- writing --------------------------------------------------------------------------------------------------------
/**
 * The agent's name (meta.name). The name it introduces itself by (persona.name) follows while the two were the same;
 * emptied, it empties too so the next name typed is still followed. A name of its own is kept.
 */
export function setAgentName(config: AgentConfig, name: string): AgentConfig {
  const value = String(name ?? '');
  return edit(config, (next) => {
    next.meta = { ...(isObj(next.meta) ? next.meta : {}), name: value };
    const persona = next.persona;
    if (isObj(persona) && (persona.name === config.meta?.name || !persona.name) && (value || persona.name)) persona.name = value;
  });
}

/** What the agent that answers first should do (instructions.role); the rest of its instructions is kept. */
export function setRole(config: AgentConfig, text: string): AgentConfig {
  const index = entryAgentIndex(config);
  if (index < 0) return config;
  return edit(config, (next) => {
    const items = list<Json>((next.agents as Json).items);
    const agent = items[index];
    agent.instructions = { ...(isObj(agent.instructions) ? agent.instructions : {}), role: String(text ?? '') };
  });
}

/** persona.tone, persona.style_rules, persona.name, persona.company, persona.shared_rules; emptied, they go. */
export function setPersona(config: AgentConfig, key: 'tone' | 'name' | 'company' | 'style_rules' | 'shared_rules', value: string | string[]): AgentConfig {
  return edit(config, (next) => {
    const persona: Json = { ...(isObj(next.persona) ? next.persona : {}) };
    const empty = Array.isArray(value) ? value.length === 0 : !String(value ?? '');
    if (empty) delete persona[key];
    else persona[key] = Array.isArray(value) ? value.map((r) => String(r ?? '')) : String(value);
    next.persona = persona;
  });
}

// ---- what it says first ---------------------------------------------------------------------------------------------
/** A channel the greeting field writes to, and what it said when the field started (to point at it again). */
export interface GreetingPlace {
  id: string | undefined;
  index: number;
  say: unknown;
}

const placeOf = (channel: Json, index: number): GreetingPlace => ({ id: typeof channel.id === 'string' ? channel.id : undefined, index, say: greets(channel) ? clone(channel.greeting.say) : undefined });

/**
 * The channels the greeting field writes to: every channel saying the same as the first one with a greeting (every
 * channel while none has one). A channel that says something else keeps it. A page holds on to this while its field
 * is edited, so emptying and retyping writes to the same channels.
 */
export function greetingTarget(config: AgentConfig): GreetingPlace[] {
  const channels = list<Json>(config?.channels);
  const first = channels.find(greets);
  return channels.flatMap((c, index) => (isObj(c) && (!first || (greets(c) && same(c.greeting.say, first.greeting.say))) ? [placeOf(c, index)] : []));
}

function everyGreeting(config: Json): GreetingPlace[] {
  const channels = list<Json>(config.channels);
  const any = channels.some(greets);
  return channels.flatMap((c, index) => (isObj(c) && (!any || greets(c)) ? [placeOf(c, index)] : []));
}

// The target's channels still there (by id, or by place without one). `sameLine`: only those saying the same as the
// first one with a greeting, or nothing; one changed meanwhile to say something else is left alone.
function targetIn(channels: Json[], target: GreetingPlace[], sameLine: boolean): { place: GreetingPlace; channel: Json }[] {
  const found = target.flatMap((place) => {
    const channel = place.id ? channels.find((c) => isObj(c) && c.id === place.id) : channels[place.index];
    return isObj(channel) ? [{ place, channel }] : [];
  });
  const first = found.find(({ channel }) => greets(channel));
  return sameLine && first ? found.filter(({ channel }) => !greets(channel) || same(channel.greeting.say, (first.channel.greeting as Json).say)) : found;
}

function fieldChannels(config: AgentConfig, target: GreetingPlace[] | null) {
  const channels = list<Json>(config?.channels);
  const given = target ? targetIn(channels, target, true) : [];
  return given.length ? given : targetIn(channels, greetingTarget(config), true);
}

/**
 * The first thing the agent says, on the target's channels (default: every channel with a greeting, or all while none
 * has one). A greeting pointing at a fixed line changes that line (the main language's text). An empty line removes
 * the greeting, so the channel waits for the caller; the line it pointed at is kept and pointed at again when typed.
 */
export function setGreeting(config: AgentConfig, text: string, target: GreetingPlace[] | null = null): AgentConfig {
  const value = String(text ?? '');
  return edit(config, (next) => {
    const places = target ? fieldChannels(next as AgentConfig, target) : targetIn(list<Json>(next.channels), everyGreeting(next), false);
    places.forEach(({ place, channel }) => {
      const greeting: Json = isObj(channel.greeting) ? channel.greeting : {};
      if (!value) {
        if (greeting.say === undefined) return;
        delete greeting.say;
        if (Object.keys(greeting).length) channel.greeting = greeting;
        else delete channel.greeting;
        return;
      }
      const say = greets(channel) ? greeting.say : place.say;
      const message = isObj(say) && say.message ? list<Json>(next.messages).find((m) => isObj(m) && m.id === say.message) : null;
      channel.greeting = { ...greeting, say: message ? { message: (say as Json).message } : value };
      if (message) {
        const words = message.text;
        if (typeof words === 'string' || !isObj(words)) message.text = value;
        else {
          const key = Object.keys(words).find((k) => baseOf(k) === baseOf(primaryOf(next))) ?? Object.keys(words)[0];
          message.text = { ...words, [key]: value };
        }
      }
    });
  });
}

export interface GreetingView {
  text: string;
  /** The line is one of the agent's fixed lines; changing it changes that line. */
  reference: boolean;
  saying: string[];
  waiting: string[];
  others: { name: string; text: string }[];
  every: boolean;
}

/** What the greeting field shows for a target: the line, who says it, who waits, what the other channels say instead. */
export function greetingOf(config: AgentConfig, target: GreetingPlace[] | null = null): GreetingView {
  const channels = list<Json>(config?.channels);
  const mine = fieldChannels(config, target);
  const say = mine.map(({ channel }) => channel).find(greets)?.greeting.say;
  const inMine = new Set(mine.map(({ channel }) => channel));
  return {
    text: say === undefined ? '' : speechText(say, config),
    reference: isObj(say) && !!say.message,
    saying: mine.filter(({ channel }) => greets(channel)).map(({ channel }) => channelName(channel.type)),
    waiting: mine.filter(({ channel }) => !greets(channel)).map(({ channel }) => channelName(channel.type)),
    others: channels.filter((c) => greets(c) && !inMine.has(c)).map((c) => ({ name: channelName(c.type), text: speechText((c.greeting as Json).say, config) })),
    every: inMine.size === channels.filter(isObj).length,
  };
}

/** Every channel that says something else first is given the target's line ("Say this on Phone too"). Waiting ones stay waiting. */
export function shareGreeting(config: AgentConfig, target: GreetingPlace[] | null = null): AgentConfig {
  const say = fieldChannels(config, target)
    .map(({ channel }) => channel)
    .find(greets)?.greeting.say;
  if (say === undefined) return config;
  return edit(config, (next) =>
    list<Json>(next.channels).forEach((channel) => {
      if (greets(channel)) channel.greeting.say = clone(say);
    }),
  );
}

const says = (names: string[], verb: string) => `${inWords(names)} ${new Set(names).size === 1 ? `${verb}s` : verb}`;

/** The line under the greeting: which channels say it (or wait for the caller), and what other channels say instead. */
export function greetingHint(greeting: GreetingView): string {
  const others = greeting.others.map((o) => `${o.name} says “${o.text}”.`).join(' ');
  if (!greeting.text) {
    if (!others && greeting.every) return 'Not set yet: type one and every channel will say it.';
    const waiting = greeting.waiting.length ? `${says(greeting.waiting, 'wait')} for the caller to start until you type a line here. ` : '';
    return `${waiting}${others}`.trim();
  }
  const reference = greeting.reference ? 'This greeting is one of the agent’s fixed lines; changing it changes that line.' : '';
  if (!others) return reference || `Used on ${greeting.saying.length} channel${greeting.saying.length === 1 ? '' : 's'}.`;
  return `${says(greeting.saying, 'say')} this. ${others} ${reference}`.trim();
}

// ---- after a rename -------------------------------------------------------------------------------------------------
export interface StalePart {
  words: string;
  plural?: boolean;
  change: (config: AgentConfig) => AgentConfig;
}

/**
 * After the name changed from `from` to `to`, the places that still say the old name: what it says first, the name it
 * introduces itself by, its instructions. Offered once the name box is left; never changed unasked.
 */
export function staleNameParts(config: AgentConfig, from: string, to: string, target: GreetingPlace[] | null = null): StalePart[] {
  if (!from || !to || from === to) return [];
  const read = readAgentPage(config);
  const greeting = greetingOf(config, target);
  const swap = (text: string) => text.split(from).join(to);
  const parts: StalePart[] = [];
  if (greeting.text.includes(from)) parts.push({ words: 'what it says first', change: (c) => setGreeting(c, swap(greeting.text), target ?? greetingTarget(c)) });
  if (read.persona.trim() === from) parts.push({ words: 'the name it introduces itself by', change: (c) => setPersona(c, 'name', to) });
  if (read.role.includes(from)) parts.push({ words: 'its instructions', plural: true, change: (c) => setRole(c, swap(read.role)) });
  return parts;
}

/** "What it says first and its instructions still say “Acme”." */
export function staleSentence(parts: StalePart[], from: string): string {
  const words = inWords(parts.map((p) => p.words));
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} still ${parts.length === 1 && !parts[0].plural ? 'says' : 'say'} “${from}”.`;
}

// ---- where conversations are processed ------------------------------------------------------------------------------
const STAGE_WORDS: Record<string, string> = { stt: 'Listening', llm: 'Thinking', tts: 'Speaking', realtime: 'Speech-to-speech' };

/**
 * The AI services a conversation passes through, named, and a sentence about them. A stage with no provider uses the
 * server's default, which is said, not hidden.
 */
export function readDataFlow(config: AgentConfig | null | undefined) {
  const models: Json = isObj(config?.defaults?.models) ? (config?.defaults?.models as Json) : {};
  const stages: { stage: string; words: string; provider: string; providerName: string; model: string }[] = [];
  ['stt', 'llm', 'tts', 'realtime'].forEach((stage) => {
    const slot = isObj(models[stage]) ? (models[stage] as Json) : null;
    const provider = typeof slot?.provider === 'string' ? slot.provider : '';
    if (!provider) return;
    stages.push({ stage, words: STAGE_WORDS[stage], provider, providerName: providerLabel(provider), model: typeof slot?.model === 'string' ? slot.model : '' });
  });
  const summary = isObj(config?.post_call?.summary) ? (config?.post_call?.summary as Json) : null;
  const summaryLlm = summary && summary.enabled === true && isObj(summary.llm) && typeof summary.llm.provider === 'string' && summary.llm.provider ? summary.llm : null;
  if (summaryLlm)
    stages.push({ stage: 'summary', words: 'Call summaries', provider: String(summaryLlm.provider), providerName: providerLabel(String(summaryLlm.provider)), model: typeof summaryLlm.model === 'string' ? summaryLlm.model : '' });
  const names = [...new Set(stages.map((s) => s.providerName))];
  const lines = stages.map((s) => `${s.words}: ${s.providerName}${s.model ? ` (${s.model})` : ''}`);
  if (!stages.length) return { stages, names, lines, chosen: false, sentence: 'No AI services are chosen yet, so the server’s defaults would be used. Choose them under AI models.' };
  return { stages, names, lines, chosen: true, sentence: `Conversations are processed by ${inWords(names)}.` };
}
