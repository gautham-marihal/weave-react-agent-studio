// The guided setup and the simple controls on the agent's own pages: what each step reads from the config and how each
// choice changes it. Every change is complete on its own (a tool is given to the agent that answers, a knowledge base is
// read by it, a voice channel gets speech models), and writes only the server's real config paths (GET /schema).
// Pure: no React, no network.
import type { AgentConfig, AgentRole, ToolDefinition } from '../types/studio';
import type { ProvidersAnswer } from '../api/types';
import type { Starter } from '../data/starters';
import { sttProviders, ttsProviders, type ProviderOption } from '../data/providers';
import { VOICE_CATALOG, type CatalogVoice } from '../data/voiceCatalog';
import { baseOf, defaultLanguage } from './languages';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T = unknown,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const together = (words: string[]) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0] ?? '');

/** An id not taken yet: the base, else base_2, base_3... */
export function freshId(taken: Array<string | undefined>, base: string): string {
  const used = new Set(taken.filter(Boolean));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** The index of the agent that answers first (agents.entry, else the first), or -1 when there is none. */
export function entryIndex(config: AgentConfig): number {
  const items = list<AgentRole>(config?.agents?.items);
  if (!items.length) return -1;
  return Math.max(0, items.findIndex((a) => a?.id === config.agents?.entry));
}

function withEntry(config: AgentConfig, change: (agent: AgentRole, next: AgentConfig) => void): AgentConfig {
  const i = entryIndex(config);
  if (i < 0) return config;
  const next = clone(config);
  change((next.agents?.items as AgentRole[])[i], next);
  return next;
}
const entryOf = (config: AgentConfig): AgentRole | null => (entryIndex(config) < 0 ? null : list<AgentRole>(config.agents?.items)[entryIndex(config)]);

// ---- the steps --------------------------------------------------------------------------------------------------------------------------------------
export type StepId = 'start' | 'purpose' | 'reach' | 'voice' | 'knowledge' | 'actions' | 'try' | 'live';
export const STEPS: { id: StepId; label: string; title: string; lead: string; optional?: boolean }[] = [
  { id: 'start', label: 'Name and starting point', title: 'Name and starting point', lead: 'Its name, and a starter to begin from.' },
  { id: 'purpose', label: 'What it does', title: 'What should it do?', lead: 'Tell it what its job is, as you would brief a new colleague.' },
  { id: 'reach', label: 'Where people reach it', title: 'Where will people reach it?', lead: 'Choose one or more. You can change this later.' },
  { id: 'voice', label: 'Language and voice', title: 'Which language, and which voice?', lead: 'The language it speaks and understands, and, when people talk to it, how it sounds.' },
  { id: 'knowledge', label: 'What it knows', title: 'What should it know?', lead: 'Add your documents or web pages. It looks the answer up there whenever someone asks.', optional: true },
  { id: 'actions', label: 'What it can do', title: 'What can it do for people?', lead: 'Switch on what it may do during a conversation. Each one works straight away.', optional: true },
  { id: 'try', label: 'Try it', title: 'Try it out', lead: 'Have a conversation with it, as a customer would. Change anything, then try again.' },
  { id: 'live', label: 'Go live', title: 'Put it live', lead: 'One step: it is published and put live, ready for people to use.' },
];
export const STEP_IDS = STEPS.map((s) => s.id);
export const stepIndex = (id: string): number => Math.max(0, STEP_IDS.indexOf(id as StepId));

// ---- where people reach it --------------------------------------------------------------------------------------------------------------------------
export type ReachType = 'web_chat' | 'web_voice' | 'sip_voice';
export const REACH: { type: ReachType; label: string; text: string }[] = [
  { type: 'web_chat', label: 'Chat on your website', text: 'A chat box on your website that visitors type into.' },
  { type: 'web_voice', label: 'Talk on your website', text: 'Visitors talk to it from the browser, with their microphone.' },
  { type: 'sip_voice', label: 'Phone calls', text: 'People ring a phone number. You add the number when it goes live.' },
];
const VOICE_TYPES: ReachType[] = ['web_voice', 'sip_voice'];
export const RECORDING_NOTICE = 'This call may be recorded to improve our service.';

export function reachOf(config: AgentConfig): Record<ReachType, boolean> {
  const on: Record<ReachType, boolean> = { web_chat: false, web_voice: false, sip_voice: false };
  list<Json>(config?.channels).forEach((c) => {
    if (isObj(c) && c.enabled !== false && typeof c.type === 'string' && c.type in on) on[c.type as ReachType] = true;
  });
  return on;
}

/** A new channel of a type, as the server's own drafts make them. */
export function buildChannel(type: ReachType, { taken = [], botId = '' }: { taken?: string[]; botId?: string } = {}) {
  const lookalikes = taken.map((id) => id.replace(/-/g, '_'));
  const base = type === 'web_chat' ? 'web_chat' : type === 'web_voice' ? 'web_voice' : 'phone';
  const id = freshId([...taken, ...lookalikes], base);
  const widget = `${botId || 'agent'}-widget`;
  if (type === 'sip_voice') return { id, type, enabled: true, entry: {}, modalities: { input: ['audio'], output: ['audio'] }, greeting: { say: 'Hello, thanks for calling. How can I help you today?' } };
  if (type === 'web_voice') return { id, type, enabled: true, entry: { widget_id: widget }, modalities: { input: ['audio'], output: ['audio'] }, greeting: { say: 'Hello, thanks for calling. How can I help you today?' } };
  return { id, type, enabled: true, entry: { widget_id: widget }, modalities: { input: ['text'], output: ['text'] }, greeting: { say: 'Hi! How can I help you today?' } };
}

const saysSomething = (say: unknown) => (typeof say === 'string' && say.trim() !== '') || (isObj(say) && typeof say.message === 'string' && say.message !== '');
/** The first line the agent already says (text or a fixed line), from the first channel that says one. */
export function firstLineOf(config: AgentConfig): unknown {
  const channel = list<Json>(config?.channels).find((c) => isObj(c) && isObj(c.greeting) && saysSomething((c.greeting as Json).say));
  return channel ? (channel.greeting as Json).say : undefined;
}

/** A provider for a speech stage: installed, key set and with a catalogue model first. */
function bestProvider(stage: 'stt' | 'tts', providers: ProvidersAnswer | null | undefined): { name: string; model?: string } | null {
  const catalog: ProviderOption[] = stage === 'stt' ? sttProviders : ttsProviders;
  const ranked = (providers?.providers ?? [])
    .filter((p) => p.installed && p.stages.includes(stage))
    .map((p) => ({ name: p.name, key: p.key_available === true, model: catalog.find((c) => c.id === p.name)?.models[0]?.id }))
    .sort((a, b) => Number(b.key) - Number(a.key) || Number(!!b.model) - Number(!!a.model));
  return ranked[0] ?? null;
}

/** The catalogue voices of a provider that speak a language (by language, region not required). */
export function voicesFor(provider: string | undefined, language: string | undefined, catalog: CatalogVoice[] = VOICE_CATALOG): CatalogVoice[] {
  if (!provider) return [];
  const own = catalog.filter((v) => v.provider.toLowerCase() === provider.toLowerCase());
  return language ? own.filter((v) => baseOf(v.locale) === baseOf(language)) : own;
}

/**
 * What a channel people talk to needs: speech models when none are set (a provider the server reports, with its key set
 * when there is one) and the recording notice callers hear first when there is none. `added` says what came with it.
 */
export function readyForVoice(config: AgentConfig, providers: ProvidersAnswer | null | undefined): { config: AgentConfig; added: string[] } {
  const next = clone(config);
  const added: string[] = [];
  const models = { ...(next.defaults?.models ?? {}) };
  (['stt', 'tts'] as const).forEach((stage) => {
    if (models[stage]?.provider) return;
    const p = bestProvider(stage, providers);
    if (!p) return;
    const m: Json = { provider: p.name };
    if (p.model) m.model = p.model;
    if (stage === 'tts') {
      const voice = voicesFor(p.name, next.defaults?.language?.primary)[0] ?? voicesFor(p.name, undefined)[0];
      if (voice) m.voice_id = voice.voiceId;
    }
    models[stage] = m;
    added.push(stage === 'stt' ? `speech recognition (${p.name})` : `a voice (${p.name})`);
  });
  if (added.length) next.defaults = { ...(next.defaults ?? {}), models };
  if (!next.persona?.disclosures?.recording_notice) {
    next.persona = { ...(next.persona ?? {}), disclosures: { ...(next.persona?.disclosures ?? {}), recording_notice: RECORDING_NOTICE } };
    added.push('a recording notice callers hear first');
  }
  return { config: next, added };
}

export interface ReachResult {
  config: AgentConfig;
  /** Why it was not switched off (the last way to reach it stays); '' when it was. */
  refused: string;
  /** What came with switching it on, in words. */
  added: string[];
}

/** Switches one way of reaching it on or off. The last one that is on stays on: an agent needs one. */
export function setReach(config: AgentConfig, type: ReachType, on: boolean, { providers = null, botId = '' }: { providers?: ProvidersAnswer | null; botId?: string } = {}): ReachResult {
  if (!on && reachOf(config)[type]) {
    const others = list<Json>(config?.channels).filter((c) => isObj(c) && c.enabled !== false && c.type !== type);
    if (!others.length) return { config, refused: 'It needs at least one way for people to reach it.', added: [] };
  }
  let next = clone(config);
  const channels = list<Json>(next.channels);
  const mine = channels.filter((c) => isObj(c) && c.type === type);
  if (!on) {
    mine.forEach((c) => (c.enabled = false));
    return { config: next, refused: '', added: [] };
  }
  const added: string[] = [];
  if (mine.length) mine.forEach((c) => (c.enabled = true));
  else {
    const channel = buildChannel(type, { taken: channels.map((c) => String(c?.id ?? '')).filter(Boolean), botId });
    const say = firstLineOf(next);
    if (say !== undefined) channel.greeting = { say: clone(say) as string };
    next.channels = [...channels, channel] as AgentConfig['channels'];
    added.push(`the ${REACH.find((r) => r.type === type)?.label.toLowerCase()} channel`);
  }
  if (VOICE_TYPES.includes(type)) {
    const voice = readyForVoice(next, providers);
    next = voice.config;
    added.push(...voice.added);
  }
  return { config: next, refused: '', added };
}

// ---- language -------------------------------------------------------------------------------------------------------------------------------------
export function setPrimaryLanguage(config: AgentConfig, code: string): AgentConfig {
  const next = clone(config);
  const language = { ...(next.defaults?.language ?? {}) };
  language.primary = code;
  if (!language.speaks?.length) language.speaks = [baseOf(code)];
  next.defaults = { ...(next.defaults ?? {}), language };
  return next;
}

/** An agent with no main language is given the person's own (the browser's); one that has one keeps it (same object). */
export const withMainLanguage = (config: AgentConfig, preferred: readonly string[] = []): AgentConfig =>
  config.defaults?.language?.primary ? config : setPrimaryLanguage(config, defaultLanguage(preferred));

// ---- what it knows ----------------------------------------------------------------------------------------------------------------------------------
/** The setup's knowledge base: read on every turn ("inject") by the agent that answers, so nothing else needs setting. */
export const KNOWLEDGE_ID = 'knowledge';
interface Source { type: 'file' | 'url'; file_id?: string; url?: string; crawl_depth?: number }
interface Base { id: string; type: string; mode?: string; sources?: Source[]; [key: string]: unknown }

const knowledgeBase = (config: AgentConfig) => list<Base>(config?.knowledge).find((b) => isObj(b) && b.id === KNOWLEDGE_ID) ?? null;
const ownBase = (config: AgentConfig) => {
  const base = knowledgeBase(config);
  return base?.type === 'vector_store' ? base : null;
};
const pageKey = (url: string) => {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
};
const isPage = (s: Source) => isObj(s) && s.type === 'url' && typeof s.url === 'string' && s.url !== '';
const sameSource = (kind: 'file' | 'url', value: string) => (s: Source) =>
  isObj(s) && (kind === 'file' ? s.type === 'file' && s.file_id === value : isPage(s) && pageKey(String(s.url)) === pageKey(value));

export function knowledgeOf(config: AgentConfig) {
  const sources = list<Source>(ownBase(config)?.sources).filter(isObj);
  const pages = sources.filter(isPage).filter((s, i, all) => all.findIndex((o) => pageKey(String(o.url)) === pageKey(String(s.url))) === i);
  return {
    files: Array.from(new Set(sources.filter((s) => s.type === 'file' && s.file_id).map((s) => String(s.file_id)))),
    pages: pages.map((s) => String(s.url)),
    depths: Object.fromEntries(pages.map((s) => [String(s.url), Number(s.crawl_depth) || 0])) as Record<string, number>,
    attached: list<string>(entryOf(config)?.knowledge).includes(KNOWLEDGE_ID),
  };
}

const readersOf = (config: AgentConfig) =>
  list<AgentRole>(config?.agents?.items).filter((a) => isObj(a) && list<string>(a.knowledge).includes(KNOWLEDGE_ID)).map((a) => a.id);
const searchersOf = (config: AgentConfig) =>
  list<ToolDefinition>(config?.tools).filter((t) => isObj(t) && String(t.type) === 'knowledge' && (t as unknown as Json).source === KNOWLEDGE_ID).map((t) => t.id);

function setSources(config: AgentConfig, change: (s: Source[]) => Source[]): AgentConfig {
  if (knowledgeBase(config) && !ownBase(config)) return config; // the id is taken by a base of another kind
  const next = clone(config);
  const all = list<Base>(next.knowledge);
  let base = ownBase(next);
  if (!base) {
    base = { id: KNOWLEDGE_ID, type: 'vector_store', mode: 'inject', sources: [] };
    all.push(base);
  }
  base.sources = change(list<Source>(base.sources));
  const agent = entryIndex(next) >= 0 ? (next.agents?.items as AgentRole[])[entryIndex(next)] : null;
  if (base.sources.length) {
    next.knowledge = all;
    if (agent && base.mode === 'inject' && !readersOf(next).length) agent.knowledge = [...list<string>(agent.knowledge), KNOWLEDGE_ID];
  } else {
    next.knowledge = all.filter((b) => b !== base);
    if (!(next.knowledge as unknown[]).length) delete next.knowledge;
    if (agent && Array.isArray(agent.knowledge)) {
      agent.knowledge = (agent.knowledge as string[]).filter((id) => id !== KNOWLEDGE_ID);
      if (!(agent.knowledge as string[]).length) delete agent.knowledge;
    }
  }
  return next;
}

export const addKnowledgeFile = (config: AgentConfig, name: string) =>
  setSources(config, (s) => (s.some(sameSource('file', name)) ? s : [...s, { type: 'file', file_id: name }]));
/** linked: also read the pages it links to (one step away). Added again, the page takes the new choice. */
export const addKnowledgePage = (config: AgentConfig, url: string, { linked = false } = {}) =>
  setSources(config, (s) => [...s.filter((x) => !sameSource('url', url)(x)), { type: 'url', url, crawl_depth: linked ? 1 : 0 }]);

/** Takes a document or page out. With none left the base goes too, unless something else needs it (`refused` says why). */
export function removeKnowledge(config: AgentConfig, kind: 'file' | 'url', value: string): { config: AgentConfig; refused: string } {
  const match = sameSource(kind, value);
  const base = ownBase(config);
  if (base && list<Source>(base.sources).every(match)) {
    const entryId = entryOf(config)?.id;
    const others = readersOf(config).filter((id) => id !== entryId);
    const tools = searchersOf(config);
    const refused = others.length
      ? `${together(others)} ${others.length === 1 ? 'answers' : 'answer'} from these, so the last one can’t be removed: add another first.`
      : tools.length
        ? `The ${together(tools)} tool${tools.length === 1 ? ' searches' : 's search'} these, so the last one can’t be removed: add another first.`
        : Object.keys(base).some((k) => !['id', 'type', 'mode', 'sources'].includes(k))
          ? 'These have their own search settings, so the last one can’t be removed: add another first.'
          : '';
    if (refused) return { config, refused };
  }
  return { config: setSources(config, (s) => s.filter((x) => !match(x))), refused: '' };
}

/** A web address a person typed, made whole ("example.com/help" -> "https://example.com/help"), or '' when it isn't one. */
export function cleanUrl(value: string): string {
  const typed = String(value ?? '').trim();
  if (!typed) return '';
  const withScheme = /^https?:\/\//i.test(typed) ? typed : `https://${typed}`;
  try {
    const url = new URL(withScheme);
    const host = url.hostname.replace(/\.$/, '');
    const parts = host.split('.');
    const named = parts.length > 1 && parts.every((p) => /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?$/i.test(p)) && /[a-z]/i.test(parts[parts.length - 1]);
    return named ? url.href : '';
  } catch {
    return '';
  }
}

// ---- what it can do ---------------------------------------------------------------------------------------------------------------------------------
export type ActionId = 'end_call' | 'hand_over' | 'details' | 'lookup';
export const ACTIONS: { id: ActionId; label: string; text: string }[] = [
  { id: 'end_call', label: 'End the conversation politely', text: 'It says goodbye and ends the conversation when the person has nothing more to ask.' },
  { id: 'hand_over', label: 'Pass people to a person on your team', text: 'When someone asks for a person, or it can’t help.' },
  { id: 'details', label: 'Take people’s contact details', text: 'A short form in chat; on the phone it asks for them in conversation.' },
  { id: 'lookup', label: 'Look something up in your own system', text: 'For example an order’s status, from a web address your system answers on.' },
];
export const DETAIL_FIELDS = [
  { name: 'name', label: 'Name', type: 'text' },
  { name: 'phone', label: 'Phone number', type: 'phone' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'message', label: 'Message', type: 'textarea' },
] as const;

const IDS: Record<ActionId, string> = { end_call: 'end_call', hand_over: 'escalate_to_human', details: 'collect_details', lookup: 'look_up' };
const TRANSFER_ID = 'human_support';
const FORM_ID = 'contact_details';
const CONNECTION_ID = 'your_system';
export const GOODBYE = { id: 'goodbye', text: 'Thank you for getting in touch. Goodbye!' };
export const CALLBACK_MESSAGE = { id: 'callback_line', text: 'I’m sorry, I can’t put you through to a person from here right now. Please get in touch with us again a little later.' };

type Tool = Json & { id: string; type: string };
const tools = (config: AgentConfig) => list<Tool>(config?.tools).filter((t) => isObj(t) && typeof t.id === 'string');
const isOwn = (id: unknown, base: string) => typeof id === 'string' && (id === base || new RegExp(`^${base}_\\d+$`).test(id));
const IS_TOOL: Record<ActionId, (t: Tool) => boolean> = {
  end_call: (t) => t.type === 'builtin' && t.builtin === 'end_call',
  hand_over: (t) => t.type === 'builtin' && t.builtin === 'transfer_or_callback',
  details: (t) => t.type === 'builtin' && t.builtin === 'send_form' && isOwn((t.params as Json | undefined)?.form, FORM_ID),
  lookup: (t) => t.type === 'http' && isOwn(t.id, IDS.lookup),
};
function toolsFor(config: AgentConfig, action: ActionId): Tool[] {
  const has = list<string>(entryOf(config)?.tools);
  const rank = (t: Tool) => (has.includes(t.id) ? 0 : isOwn(t.id, IDS[action]) ? 1 : 2);
  return tools(config).filter(IS_TOOL[action]).sort((a, b) => rank(a) - rank(b));
}
const offered = (config: AgentConfig, id: string | undefined) => !!id && list<string>(entryOf(config)?.tools).includes(id);

/** Whether anything other than the answering agent's own list of tools uses an id (another agent, a guardrail rule, a test...). */
function usedElsewhere(config: AgentConfig, id: string): boolean {
  const rest = clone(config) as Json;
  delete rest.tools;
  const i = entryIndex(config);
  if (i >= 0) ((rest.agents as Json).items as Json[])[i].tools = [];
  let found = false;
  const visit = (node: unknown, key: string) => {
    if (found) return;
    if (Array.isArray(node)) {
      if (key === 'tools' && node.includes(id)) found = true;
      node.forEach((x) => visit(x, key));
    } else if (isObj(node)) {
      Object.entries(node).forEach(([k, v]) => {
        if (typeof v === 'string') {
          if (['tool', 'then', 'tool_called', 'tool_not_called', 'transfer'].includes(k) && v === id) found = true;
        } else visit(v, k);
      });
    }
  };
  visit(rest, '');
  return found;
}

export interface ActionsState {
  end_call: { on: boolean };
  hand_over: { on: boolean; number: string };
  details: { on: boolean; fields: string[] };
  lookup: { on: boolean; url: string; finds: string; needs: string };
}

export function actionsOf(config: AgentConfig): ActionsState {
  const [end, hand, form, lookup] = (['end_call', 'hand_over', 'details', 'lookup'] as ActionId[]).map((a) => toolsFor(config, a)[0] ?? null);
  const transferId = (hand?.params as Json | undefined)?.transfer;
  const transfer = list<Json>((config.telephony as Json | undefined)?.transfers).find((t) => isObj(t) && t.id === transferId);
  const formId = (form?.params as Json | undefined)?.form ?? FORM_ID;
  const formDef = list<Json>(config.forms).find((f) => isObj(f) && f.id === formId);
  return {
    end_call: { on: offered(config, end?.id) },
    hand_over: { on: offered(config, hand?.id), number: typeof transfer?.target === 'string' ? transfer.target : '' },
    details: { on: offered(config, form?.id), fields: list<Json>(formDef?.fields).map((f) => String(f?.name ?? '')).filter(Boolean) },
    lookup: { on: offered(config, lookup?.id), ...readLookup(config, lookup) },
  };
}

/** Takes the switch's tools from the agent that answers; one the switch made goes from the config once nothing uses it. */
function dropTools(config: AgentConfig, action: ActionId, extra: (next: AgentConfig, tool: Tool) => void = () => undefined): AgentConfig {
  const ids = toolsFor(config, action).map((t) => t.id);
  if (!ids.length) return config;
  return withEntry(config, (agent, next) => {
    agent.tools = list<string>(agent.tools).filter((id) => !ids.includes(id));
    ids
      .filter((id) => isOwn(id, IDS[action]) && !usedElsewhere(next, id))
      .forEach((id) => {
        const tool = tools(next).find((t) => t.id === id);
        if (!tool) return;
        next.tools = list<ToolDefinition>(next.tools).filter((t) => t.id !== id);
        if (!(next.tools as unknown[]).length) delete next.tools;
        dropLines(next, tool);
        extra(next, tool);
      });
  });
}
const giveTool = (config: AgentConfig, id: string) =>
  withEntry(config, (agent) => {
    if (!list<string>(agent.tools).includes(id)) agent.tools = [...list<string>(agent.tools), id];
  });

/** The fixed lines a removed tool said go with it, while nothing else says them and they still read as the studio wrote them. */
function dropLines(next: AgentConfig, tool: Tool) {
  const ids: string[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (isObj(node)) Object.entries(node).forEach(([k, v]) => (k === 'message' && typeof v === 'string' ? ids.push(v) : visit(v)));
  };
  visit(tool);
  const studio = [GOODBYE.text, CALLBACK_MESSAGE.text];
  ids.forEach((id) => {
    const line = list<Json>(next.messages).find((m) => isObj(m) && m.id === id);
    if (!line || Object.keys(line).some((k) => k !== 'id' && k !== 'text') || !studio.includes(String(line.text))) return;
    const said = JSON.stringify({ ...next, messages: undefined }).includes(`"message":"${id}"`);
    if (said) return;
    next.messages = list<Json>(next.messages).filter((m) => m !== line);
    if (!(next.messages as unknown[]).length) delete next.messages;
  });
}

const addMessage = (next: AgentConfig, line: { id: string; text: string }) => {
  if (!list<Json>(next.messages).some((m) => m?.id === line.id)) next.messages = [...list<Json>(next.messages), { ...line }];
};

export function setEndCall(config: AgentConfig, on: boolean): AgentConfig {
  if (!on) return dropTools(config, 'end_call');
  const existing = toolsFor(config, 'end_call')[0];
  if (existing) return giveTool(config, existing.id);
  const next = clone(config);
  addMessage(next, GOODBYE);
  const id = freshId(tools(next).map((t) => t.id), IDS.end_call);
  next.tools = [...list<ToolDefinition>(next.tools), { id, type: 'builtin', builtin: 'end_call', description: 'Ends the conversation. Use it after saying goodbye, when the person has nothing more to ask.', params: { say: { message: GOODBYE.id } } } as unknown as ToolDefinition];
  return giveTool(next, id);
}

/** What is wrong with a number to pass calls to ('' when it looks dialable): with its country code, or a SIP address. */
export function numberProblem(typed: string): string {
  const value = String(typed ?? '').trim();
  if (!value || /^sips?:\S+@\S+$/i.test(value)) return '';
  const digits = value.replace(/[\s().-]/g, '');
  if (/^\+[1-9]\d{6,14}$/.test(digits)) return '';
  return digits.startsWith('+') ? 'This doesn’t look like a whole number: check the digits after the country code.' : 'Write it with the country code, for example +65 6123 4567, or calls can’t be passed on.';
}

/** The number goes on the transfer the hand-over uses; with none it still works and says the callback line instead. */
export function setHandOver(config: AgentConfig, on: boolean, { number }: { number?: string } = {}): AgentConfig {
  if (!on)
    return dropTools(config, 'hand_over', (next, tool) => {
      const transfer = (tool.params as Json | undefined)?.transfer;
      const telephony = next.telephony as Json | undefined;
      if (!isOwn(transfer, TRANSFER_ID) || !isObj(telephony) || usedElsewhere(next, String(transfer))) return;
      telephony.transfers = list<Json>(telephony.transfers).filter((t) => t?.id !== transfer);
      if (!(telephony.transfers as unknown[]).length) delete telephony.transfers;
      if (!Object.keys(telephony).length) delete next.telephony;
    });
  const next = clone(config);
  let tool = toolsFor(next, 'hand_over')[0];
  if (!tool) {
    addMessage(next, CALLBACK_MESSAGE);
    tool = {
      id: freshId(tools(next).map((t) => t.id), IDS.hand_over),
      type: 'builtin',
      builtin: 'transfer_or_callback',
      description: 'Use when the caller asks for a person, or you cannot help them.',
      params: { transfer: TRANSFER_ID, fallback: [{ type: 'say', text: { message: CALLBACK_MESSAGE.id } }] },
    };
    next.tools = [...list<ToolDefinition>(next.tools), tool as unknown as ToolDefinition];
  }
  const params = (isObj(tool.params) ? tool.params : (tool.params = {})) as Json;
  if (!params.transfer) params.transfer = TRANSFER_ID;
  const telephony = (isObj(next.telephony) ? next.telephony : {}) as Json;
  let transfer = list<Json>(telephony.transfers).find((t) => isObj(t) && t.id === params.transfer);
  if (!transfer) {
    transfer = { id: params.transfer, description: 'A person to take over. Until a number is set, callers hear the callback line.', method: 'sip_refer', target: '' };
    telephony.transfers = [...list<Json>(telephony.transfers), transfer];
    next.telephony = telephony;
  }
  if (number !== undefined && (transfer.target == null || typeof transfer.target === 'string')) transfer.target = String(number).trim();
  return giveTool(next, tool.id);
}

const askInWords = (fields: Array<{ label?: unknown; name?: unknown }>) =>
  `Could you tell me your ${together(fields.map((f) => String(f.label ?? f.name).toLowerCase()))}?`;
const detailField = (f: (typeof DETAIL_FIELDS)[number]) => ({ name: f.name, label: f.label, type: f.type, ...(f.name === 'name' ? { required: true } : {}) });

/** Contact details: a form and the tool that shows it. On the phone (no screen) it asks for them in words. */
export function setDetails(config: AgentConfig, on: boolean, { fields }: { fields?: string[] } = {}): AgentConfig {
  if (!on)
    return dropTools(config, 'details', (next, tool) => {
      const formId = (tool.params as Json | undefined)?.form;
      if (!isOwn(formId, FORM_ID)) return;
      next.forms = list<Json>(next.forms).filter((f) => f?.id !== formId);
      if (!(next.forms as unknown[]).length) delete next.forms;
    });
  const existing = toolsFor(config, 'details')[0];
  const next = clone(config);
  const formId = String((existing?.params as Json | undefined)?.form ?? FORM_ID);
  const form = list<Json>(next.forms).find((f) => isObj(f) && f.id === formId);
  if (!form) {
    const chosen = DETAIL_FIELDS.filter((f) => (fields?.length ? fields : ['name', 'phone']).includes(f.name));
    next.forms = [...list<Json>(next.forms), { id: formId, title: 'Your details', fields: chosen.map(detailField), submit_label: 'Send', otherwise: [{ type: 'say', text: askInWords(chosen) }] }];
  } else if (fields?.length) {
    const had = list<Json>(form.fields).filter(isObj);
    const known = DETAIL_FIELDS.map((f) => f.name as string);
    const kept = had.filter((f) => !known.includes(String(f.name)) || fields.includes(String(f.name)));
    const added = DETAIL_FIELDS.filter((f) => fields.includes(f.name) && !had.some((h) => h.name === f.name)).map(detailField);
    if (kept.length + added.length) {
      const said = list<Json>(form.otherwise);
      if (said.length === 1 && said[0]?.type === 'say' && said[0]?.text === askInWords(had)) form.otherwise = [{ ...said[0], text: askInWords([...kept, ...added]) }];
      form.fields = [...kept, ...added];
    }
  }
  let id = existing?.id;
  if (!id) {
    id = freshId(tools(next).map((t) => t.id), IDS.details);
    next.tools = [...list<ToolDefinition>(next.tools), { id, type: 'builtin', builtin: 'send_form', description: 'Use when you need the person’s contact details, for example to arrange a callback.', params: { form: formId } } as unknown as ToolDefinition];
  }
  return giveTool(next, id);
}

const paramName = (words: string) =>
  String(words ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '').slice(0, 40) || 'value';

/** The lookup as the setup asks for it, read back from the tool and its connection. */
function readLookup(config: AgentConfig, tool: Tool | null): { url: string; finds: string; needs: string } {
  if (!tool) return { url: '', finds: '', needs: '' };
  const connection = isObj(config.connections) ? (config.connections as Json)[String(tool.connection)] as Json | undefined : undefined;
  const props = ((tool.parameters as Json | undefined)?.properties ?? {}) as Record<string, Json>;
  const param = Object.keys(props)[0] ?? '';
  const needs = String(props[param]?.description ?? param).replace(/^The /, '');
  const slot = (text: string) => (param ? text.replace(new RegExp(`\\{\\{\\s*args\\.${param}\\s*\\}\\}`, 'g'), `{${needs}}`) : text);
  const request = (tool.request ?? {}) as Json;
  const base = String(connection?.base_url ?? '').replace(/\/$/, '');
  const query = Object.entries(isObj(request.query) ? (request.query as Json) : {}).filter(([k, v]) => !(k === param && String(v).trim() === `{{args.${param}}}`));
  const search = query.map(([k, v]) => `${k}=${slot(String(v))}`).join('&');
  const finds = String(tool.description ?? '').match(/^Looks up (.*?)\. /)?.[1] ?? '';
  return { url: `${base}${slot(String(request.path ?? ''))}${search ? `?${search}` : ''}`, finds, needs };
}

/**
 * "https://shop.example.com/orders/{order number}" -> connection base https://shop.example.com and a tool calling
 * /orders/{{args.order_number}}. With no {curly brackets}, the answer is sent as a query value. `problem` is set (and the
 * config unchanged) when the address or the answers cannot be used.
 */
export function setLookup(config: AgentConfig, on: boolean, { url = '', finds = '', needs = '' }: { url?: string; finds?: string; needs?: string } = {}): { config: AgentConfig; problem: string } {
  if (!on)
    return {
      config: dropTools(config, 'lookup', (next, tool) => {
        const id = String(tool.connection ?? '');
        const connections = next.connections as Json | undefined;
        if (!isOwn(id, CONNECTION_ID) || !isObj(connections)) return;
        if (tools(next).some((t) => t.connection === id)) return;
        delete connections[id];
        if (!Object.keys(connections).length) delete next.connections;
      }),
      problem: '',
    };
  const existing = toolsFor(config, 'lookup')[0] ?? null;
  const was = readLookup(config, existing);
  const same = (a: string, b: string) => a.trim() === b.trim();
  if (existing && same(url, was.url) && same(finds, was.finds) && same(needs, was.needs)) return { config: giveTool(config, existing.id), problem: '' };
  if (!needs.trim()) return { config, problem: 'Say what it needs from the person, for example “order number”.' };
  const param = paramName(needs);
  const typed = url.trim();
  const hasSlot = /\{[^{}]*\}/.test(typed);
  const marked = typed.replace(/\{[^{}]*\}/g, `__${param}__`);
  if (!cleanUrl(marked)) return { config, problem: 'Type the web address your system answers on, starting with https://.' };
  const parsed = new URL(/^https?:\/\//i.test(marked) ? marked : `https://${marked}`);
  if (parsed.origin.includes(`__${param}__`)) return { config, problem: 'Put the curly brackets after the site’s name, for example https://shop.example.com/orders/{order number}.' };
  const restore = (text: string) => text.split(`__${param}__`).join(`{{args.${param}}}`);
  let pathname: string;
  try {
    pathname = decodeURI(parsed.pathname);
  } catch {
    return { config, problem: 'There is a stray “%” in the web address. Check it and try again.' };
  }
  const query: Record<string, string> = Object.fromEntries([...parsed.searchParams.entries()].map(([k, v]) => [restore(k), restore(v)]));
  if (!hasSlot) query[param] = `{{args.${param}}}`;

  const next = clone(config);
  const connections = (isObj(next.connections) ? next.connections : {}) as Json;
  const toolRef = existing ? tools(next).find((t) => t.id === existing.id) : null;
  const connectionId = toolRef && isOwn(toolRef.connection, CONNECTION_ID) ? String(toolRef.connection) : freshId(Object.keys(connections), CONNECTION_ID);
  connections[connectionId] = { ...(isObj(connections[connectionId]) ? (connections[connectionId] as Json) : {}), type: 'http', base_url: parsed.origin };
  next.connections = connections;
  const tool: Tool = toolRef ?? { id: freshId(tools(next).map((t) => t.id), IDS.lookup), type: 'http' };
  tool.connection = connectionId;
  tool.request = { ...(isObj(tool.request) ? (tool.request as Json) : {}), method: (tool.request as Json | undefined)?.method ?? 'GET', path: restore(pathname) || '/', ...(Object.keys(query).length ? { query } : {}) };
  if (!Object.keys(query).length) delete (tool.request as Json).query;
  tool.description = `Looks up ${finds.trim() || 'what the person asks about'}. Use it when the person asks, once you have their ${needs.trim()}.`;
  tool.parameters = { type: 'object', required: [param], properties: { [param]: { type: 'string', description: `The ${needs.trim()}` } } };
  if (!toolRef) next.tools = [...list<ToolDefinition>(next.tools), tool as unknown as ToolDefinition];
  return { config: giveTool(next, tool.id), problem: '' };
}

// ---- tools in an old shape ----------------------------------------------------------------------------------------------------------------------
// Drafts saved by earlier versions of the studio can hold tools the server's schema refuses: `type: "end_call"` and
// `type: "transfer"` (now built-ins), and web lookups with no request or address. The first two are rewritten in place under
// the same id, so every agent, test and hook that names them still does. A lookup with no request has nothing to rebuild
// from, so it is taken off (with every agent's list) unless something else still uses it.

const TOOL_TYPES = ['builtin', 'code', 'http', 'knowledge', 'mcp', 'task'];

export interface OldTool {
  id: string;
  description: string;
  fix: 'end_call' | 'hand_over' | 'remove' | 'add_parameters' | 'manual';
  /** In plain words, what the repair does with it. */
  change: string;
}

/** The tools a repair would change, and how. Empty when every tool already has a shape the server accepts. */
export function oldToolsOf(config: AgentConfig): OldTool[] {
  const declared = isObj(config.connections) ? Object.keys(config.connections as Json) : [];
  return tools(config).flatMap((t): OldTool[] => {
    const description = typeof t.description === 'string' ? t.description : '';
    const name = `“${t.id}”`;
    if (t.type === 'end_call') return [{ id: t.id, description, fix: 'end_call', change: `${name} becomes the built-in end-the-conversation action.` }];
    if (t.type === 'transfer') {
      return [{ id: t.id, description, fix: 'hand_over', change: `${name} becomes the built-in pass-to-a-person action. Until a number is set, callers hear a callback line.` }];
    }
    if (t.type === 'http' && !isObj(t.request)) {
      return usedElsewhereThanAgents(config, t.id)
        ? [{ id: t.id, description, fix: 'manual', change: `${name} has no web address and something besides the agents uses it. Give it a request, or remove it, by hand.` }]
        : [{ id: t.id, description, fix: 'remove', change: `${name} has no web address to call, so it is removed. Add it again under “Look something up”.` }];
    }
    if (t.type === 'http' && typeof t.connection === 'string' && !declared.includes(t.connection)) {
      return [{ id: t.id, description, fix: 'manual', change: `${name} uses the connection “${t.connection}”, which is not declared. Declare it or pick another, by hand.` }];
    }
    if (t.type === 'http' && !isObj(t.parameters)) return [{ id: t.id, description, fix: 'add_parameters', change: `${name} gets an empty list of inputs, which the server requires.` }];
    if (!TOOL_TYPES.includes(t.type)) return [{ id: t.id, description, fix: 'manual', change: `${name} has the type “${t.type}”, which the server does not know. Change it by hand.` }];
    return [];
  });
}

/** Whether anything but the agents' own tool lists names a tool (a test, a hook, a guardrail...). */
function usedElsewhereThanAgents(config: AgentConfig, id: string): boolean {
  const rest = clone(config) as Json;
  delete rest.tools;
  list<Json>((rest.agents as Json | undefined)?.items).forEach((a) => {
    if (isObj(a)) a.tools = [];
  });
  let found = false;
  const visit = (node: unknown, key: string) => {
    if (found) return;
    if (Array.isArray(node)) {
      if (key === 'tools' && node.includes(id)) found = true;
      node.forEach((x) => visit(x, key));
    } else if (isObj(node)) {
      Object.entries(node).forEach(([k, v]) => {
        if (typeof v === 'string') {
          if (['tool', 'then', 'tool_called', 'tool_not_called'].includes(k) && v === id) found = true;
        } else visit(v, k);
      });
    }
  };
  visit(rest, '');
  return found;
}

/** Applies every automatic fix oldToolsOf lists; `manual` ones are left as they are. */
export function repairOldTools(config: AgentConfig): AgentConfig {
  const found = oldToolsOf(config).filter((o) => o.fix !== 'manual');
  if (!found.length) return config;
  const next = clone(config);
  const byId = new Map(found.map((o) => [o.id, o]));
  const removed = found.filter((o) => o.fix === 'remove').map((o) => o.id);

  next.tools = list<Tool>(next.tools).flatMap((t) => {
    const fix = isObj(t) ? byId.get(t.id)?.fix : undefined;
    if (!fix) return [t];
    if (fix === 'remove') return [];
    if (fix === 'add_parameters') return [{ ...t, parameters: { type: 'object', properties: {} } }];
    if (fix === 'end_call') {
      addMessage(next, GOODBYE);
      return [{ id: t.id, type: 'builtin', builtin: 'end_call', description: t.description || 'Ends the conversation. Use it after saying goodbye, when the person has nothing more to ask.', params: { say: { message: GOODBYE.id } } }];
    }
    // hand_over: the transfer the old tool stood for, with whatever number it carried.
    addMessage(next, CALLBACK_MESSAGE);
    const telephony = (isObj(next.telephony) ? next.telephony : {}) as Json;
    const transferId = freshId(list<Json>(telephony.transfers).map((x) => String(x?.id ?? '')), TRANSFER_ID);
    const target = [t.target, t.number, t.to].find((v) => typeof v === 'string' && v.trim()) ?? '';
    telephony.transfers = [...list<Json>(telephony.transfers), { id: transferId, description: 'A person to take over. Until a number is set, callers hear the callback line.', method: 'sip_refer', target }];
    next.telephony = telephony;
    return [
      {
        id: t.id,
        type: 'builtin',
        builtin: 'transfer_or_callback',
        description: t.description || 'Use when the caller asks for a person, or you cannot help them.',
        params: { transfer: transferId, fallback: [{ type: 'say', text: { message: CALLBACK_MESSAGE.id } }] },
      },
    ];
  }) as unknown as ToolDefinition[];
  if (!(next.tools as unknown[]).length) delete next.tools;

  if (removed.length) {
    list<AgentRole>(next.agents?.items).forEach((agent) => {
      if (Array.isArray(agent.tools)) agent.tools = agent.tools.filter((id) => !removed.includes(id));
    });
  }
  return next;
}

// ---- starters -----------------------------------------------------------------------------------------------------------------------------------
/**
 * A new agent's draft: the minimal draft the server made for it (POST /bots), with the starter's content laid on top
 * (who it is, what it says first, what it does, the actions it switches on) and the main language the person's own. The
 * server's models and runtime are kept. Applying it twice changes nothing more.
 */
export function applyStarter(base: AgentConfig, { company, starter, languages = [] }: { company: string; starter: Starter; languages?: readonly string[] }): AgentConfig {
  let config = clone(base);
  if (starter.id !== 'blank') {
    const greeting = starter.greeting.replace('{company}', company.trim() || 'us').replace('{persona}', starter.personaName);
    config.persona = { ...config.persona, name: starter.personaName || config.persona?.name, tone: starter.tone, ...(company.trim() ? { company: company.trim() } : {}), ...(starter.rules ? { style_rules: [starter.rules] } : {}) };
    if (starter.summary && !config.meta?.description) config.meta = { ...config.meta, description: starter.summary };
    if (greeting) config.channels = list<Json>(config.channels).map((ch) => ({ ...ch, greeting: { ...(isObj(ch.greeting) ? ch.greeting : {}), say: greeting } })) as AgentConfig['channels'];
    if (starter.instructions) config = withEntry(config, (agent) => (agent.instructions = { ...agent.instructions, role: starter.instructions }));
    if (starter.actions.endCall) config = setEndCall(config, true);
    if (starter.actions.handOver) config = setHandOver(config, true);
    if (starter.actions.details) config = setDetails(config, true);
  }
  return withMainLanguage(config, languages);
}

/** Whether the instructions are still a starter's own words, untouched: they say nothing about this business yet. */
export const isStarterRole = (role: string, all: Starter[]): boolean => {
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
  return !!norm(role) && all.some((s) => s.instructions && norm(s.instructions) === norm(role));
};

// ---- where each step stands ----------------------------------------------------------------------------------------------------------------
const DEFAULT_ROLE = /^You are a helpful assistant\. Answer briefly and politely\.$/;
export type SetupState = 'done' | 'todo' | 'optional';

/** Each step's state. tried: a test conversation happened in the setup; deployed: environment -> version. */
export function stepStates(config: AgentConfig, { tried = false, deployed = {}, starters = [] }: { tried?: boolean; deployed?: Record<string, string>; starters?: Starter[] } = {}): Record<StepId, SetupState> {
  const role = String(entryOf(config)?.instructions?.role ?? '').trim();
  const reach = reachOf(config);
  const voice = reach.web_voice || reach.sip_voice;
  const k = knowledgeOf(config);
  const a = actionsOf(config);
  return {
    start: 'done',
    purpose: role.length >= 20 && !DEFAULT_ROLE.test(role) && !isStarterRole(role, starters) ? 'done' : 'todo',
    reach: Object.values(reach).some(Boolean) ? 'done' : 'todo',
    voice: config.defaults?.language?.primary && (!voice || config.defaults?.models?.tts?.voice_id) ? 'done' : 'todo',
    knowledge: k.files.length || k.pages.length ? 'done' : 'optional',
    actions: Object.values(a).some((x) => x.on) ? 'done' : 'optional',
    try: tried ? 'done' : 'todo',
    live: Object.values(deployed).some(Boolean) ? 'done' : 'todo',
  };
}

/** The step a problem the server found belongs to, by where it is; '' when no step asks for it. */
export function stepForPath(path: Array<string | number> | null | undefined): StepId | '' {
  const [key, sub] = Array.isArray(path) ? path : [];
  if (key === 'agents' && (sub === 'items' || sub === undefined)) return 'purpose';
  if (key === 'persona' || key === 'messages') return 'purpose';
  if (key === 'channels') return 'reach';
  if (key === 'defaults' && (sub === 'language' || sub === 'models')) return 'voice';
  if (key === 'knowledge') return 'knowledge';
  if (key === 'tools' || key === 'forms' || key === 'connections' || key === 'telephony') return 'actions';
  return '';
}

/** An id for a new agent from its name, free among the ids taken ("Smile Dental" -> "smile-dental", then "smile-dental-2"). */
export function freeBotId(name: string, taken: string[]): string {
  const base = (String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '') || 'agent').slice(0, 60);
  const reserved = new Set(['transcripts', 'metrics', 'logs', 'sessions', 'tmp', ...taken]);
  if (!reserved.has(base)) return base;
  for (let n = 2; ; n++) if (!reserved.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** What is wrong with an id typed under Advanced ('' when it is fine). */
export function botIdProblem(id: string, taken: string[]): string {
  if (!id) return 'Give it an id.';
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id)) return 'Use lowercase letters, digits, - and _, starting with a letter (64 at most).';
  if (['transcripts', 'metrics', 'logs', 'sessions', 'tmp'].includes(id)) return 'That id is reserved by the server.';
  if (taken.includes(id)) return 'Another agent has this id.';
  return '';
}

/** The setup step where a readiness step is done, when the setup has one ('' otherwise: its own page). */
export function setupStepForReadiness(readinessId: string): StepId | '' {
  const map: Record<string, StepId> = { prompt: 'purpose', hello: 'purpose', voice: 'voice', abilities: 'actions', knowledge: 'knowledge', publish: 'live', deploy: 'live' };
  return map[readinessId] ?? '';
}
