// What the draft changes compared with the newest published version (or what one version changes compared with
// another), in plain words, grouped by part of the agent; and putting one part back as it was published. The same
// wording is used for the studio's own comparison and for the server's GET /diff (both name an item of an id-list as
// "id=billing"). Pure: no React, no network.
import type { AgentConfig } from '../types/studio';
import { diffConfigs, type Change } from '../utils/diff';
import { settingsCatalog } from '../data/settingsCatalog';
import { languageName } from './languages';

export type { Change };

/** Fields the server sets (publishing moves meta.version on) and the studio's own layout notes: real, but not what anyone came to review. */
const BOOKKEEPING = new Set(['version', 'status', 'created_at', 'updated_at']);
export const isBookkeeping = (c: Pick<Change, 'path'>): boolean =>
  c.path[0] === 'builder' || (c.path[0] === 'meta' && c.path.length === 2 && BOOKKEEPING.has(String(c.path[1])));

export interface PlainChange {
  verb: 'Added' | 'Removed' | 'Changed';
  /** One sentence, e.g. "Changed the greeting from “Hi” to “Hello”". */
  text: string;
  /** The place in technical form, for a tooltip. */
  where: string;
  /** The full before and after when they are long texts ("Show the wording"); null otherwise. */
  full: { before: string; after: string } | null;
}

export interface ChangeGroup {
  /** The top-level part of the config (persona, tools, ...): what "Put back as published" restores. */
  key: string;
  title: string;
  items: PlainChange[];
}

export interface ChangeSummary {
  total: number;
  groups: ChangeGroup[];
}

const SECTIONS: Record<string, string> = {
  meta: 'Name and details',
  persona: 'Personality',
  defaults: 'Language, voice and AI model',
  messages: 'Fixed lines',
  channels: 'Where people reach it',
  agents: 'What it does',
  tools: 'What it can do',
  connections: 'Connections',
  knowledge: 'What it knows',
  forms: 'Forms',
  notifications: 'Messages it sends',
  wrapups: 'Closing messages',
  guardrails: 'Guardrails',
  schedules: 'Business hours',
  telephony: 'Phone transfers',
  state: 'Things it remembers',
  constants: 'Fixed values',
  tasks: 'Multi-step tasks',
  events: 'Events',
  post_call: 'After the call',
  observability: 'Call logs',
  tests: 'Tests',
  identity: 'Caller identity',
  runtime: 'Engine',
  schema_version: 'Schema version',
};
export const sectionTitle = (key: string): string => SECTIONS[key] ?? key.replace(/_/g, ' ');

const NOUN: Record<string, string> = {
  agents: 'agent',
  tools: 'tool',
  channels: 'channel',
  messages: 'fixed line',
  knowledge: 'knowledge base',
  forms: 'form',
  notifications: 'message',
  wrapups: 'closing message',
  tasks: 'task',
  connections: 'connection',
  transfers: 'transfer',
  analysis: 'question',
  escalation: 'hand-over rule',
  input: 'check on what the caller says',
  output: 'check on what it says',
  style_rules: 'style rule',
  shared_rules: 'shared rule',
  allowed: 'allowed topic',
  blocked: 'blocked topic',
  speaks: 'language it answers in',
  entities: 'detail it hides',
};

// Words for places that are not settings in the catalogue (or need a shorter name in a sentence).
const WORDS: Record<string, string> = {
  'agents.instructions.role': 'the instructions',
  'agents.instructions.opening': 'what it does on taking over',
  'agents.instructions': 'the instructions',
  'agents.name': 'the name',
  'agents.tools': 'the tools it can use',
  'agents.handoffs': 'who it can pass to',
  'agents.entry': 'who answers first',
  'channels.greeting.say': 'the greeting',
  'channels.greeting': 'the greeting',
  'channels.enabled': 'whether it is on',
  'defaults.models.llm.model': 'the AI model',
  'defaults.models.llm.provider': 'the AI model provider',
  'defaults.models.tts.voice_id': 'the voice',
  'defaults.models.tts.provider': 'the voice provider',
  'defaults.models.tts.model': 'the voice model',
  'defaults.models.stt.model': 'the speech recognition model',
  'defaults.models.stt.provider': 'the speech recognition provider',
  'defaults.language.primary': 'the main language',
  'defaults.language.speaks': 'the languages it answers in',
  'meta.name': 'the name',
  'meta.description': 'the description',
  'persona.name': 'the name it calls itself',
  'persona.company': 'the company name',
  'persona.tone': 'the tone',
  'tools.description': 'the description',
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const itemId = (seg: string | number | undefined): string | null => (typeof seg === 'string' && seg.startsWith('id=') ? seg.slice(3) : null);

/** The path with items and indexes taken out ("agents.items.id=a.instructions.role" -> "agents.instructions.role"). */
function shape(path: Array<string | number>): string {
  return path.filter((p) => typeof p === 'string' && !itemId(p) && p !== 'items').join('.');
}

function settingWords(path: Array<string | number>): string {
  const key = shape(path);
  if (WORDS[key]) return WORDS[key];
  const def = settingsCatalog.find((s) => s.path === key);
  if (def) return `“${def.label}”`;
  const leaf = [...path].reverse().find((p) => typeof p === 'string' && !itemId(p) && p !== 'items');
  return leaf ? `“${String(leaf).replace(/_/g, ' ')}”` : 'a setting';
}

const SHORT = 70;
const isLanguagePath = (path: Array<string | number>) => shape(path).startsWith('defaults.language');
function quote(v: unknown, path: Array<string | number>): string | null {
  const lang = isLanguagePath(path);
  if (typeof v === 'string') {
    const t = lang ? languageName(v) : v;
    return `“${t.length > SHORT ? `${t.slice(0, SHORT - 1)}…` : t}”`;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return `“${typeof v === 'boolean' ? (v ? 'on' : 'off') : v}”`;
  if (Array.isArray(v) && v.every((x) => ['string', 'number', 'boolean'].includes(typeof x))) {
    const t = v.map((x) => (lang && typeof x === 'string' ? languageName(x) : String(x))).join(', ');
    return `“${t.length > SHORT ? `${t.slice(0, SHORT - 1)}…` : t}”`;
  }
  return null;
}

const named = (v: unknown, fallback: string) => (isObj(v) && typeof v.name === 'string' && v.name ? v.name : fallback);

/** One change as a sentence a person would say. */
export function describeChange(c: Change): PlainChange {
  const path = c.path;
  const last = path[path.length - 1];
  const lastItem = itemId(last);
  const verb = c.op === 'add' ? 'Added' : c.op === 'remove' ? 'Removed' : 'Changed';
  const where = path.join('.');
  const full = typeof c.before === 'string' && typeof c.after === 'string' && (c.before.length > SHORT || c.after.length > SHORT) ? { before: c.before, after: c.after } : null;

  // An item of an id-list: "Added the tool “Look up an order”".
  if (lastItem !== null) {
    const listKey = [...path].reverse().find((p, i) => i > 0 && typeof p === 'string' && p !== 'items' && !itemId(p));
    const noun = NOUN[String(listKey ?? path[0])] ?? NOUN[String(path[0])] ?? 'item';
    const name = named(c.op === 'remove' ? c.before : c.after, lastItem);
    if (c.op !== 'change') return { verb, text: `${verb} the ${noun} “${name}”`, where, full: null };
  }
  // An entry of a plain list (style rules, topics): named by what it says, not by its place.
  if (typeof last === 'number') {
    const noun = NOUN[String(path[path.length - 2])] ?? 'entry';
    const before = quote(c.before, path);
    const after = quote(c.after, path);
    if (c.op === 'add') return { verb, text: `Added the ${noun} ${after ?? ''}`.trim(), where, full: null };
    if (c.op === 'remove') return { verb, text: `Removed the ${noun} ${before ?? ''}`.trim(), where, full: null };
    return { verb, text: before && after ? `Changed the ${noun} from ${before} to ${after}` : `Changed a ${noun}`, where, full };
  }

  // A setting, maybe of a named item ("of the tool “transfer”").
  const owner = [...path].reverse().map(itemId).find((x) => x !== null);
  const ownerNoun = NOUN[String(path[0])] ?? 'item';
  const of = owner ? ` of the ${ownerNoun} “${owner}”` : '';
  const what = settingWords(path);
  const before = quote(c.before, path);
  const after = quote(c.after, path);
  if (c.op === 'add') return { verb, text: after ? `Set ${what}${of} to ${after}` : `Added ${what}${of}`, where, full: null };
  if (c.op === 'remove') return { verb, text: `Removed ${what}${of}`, where, full: null };
  return {
    verb,
    text: before && after && !full ? `Changed ${what}${of} from ${before} to ${after}` : `Changed ${what}${of}`,
    where,
    full,
  };
}

/** Changes grouped by part of the agent, in the order the parts come, bookkeeping left out. */
export function plainChanges(changes: Change[]): ChangeSummary {
  const groups = new Map<string, ChangeGroup>();
  changes
    .filter((c) => !isBookkeeping(c))
    .forEach((c) => {
      const key = String(c.path[0] ?? '');
      if (!groups.has(key)) groups.set(key, { key, title: sectionTitle(key), items: [] });
      groups.get(key)?.items.push(describeChange(c));
    });
  const list = Array.from(groups.values());
  return { total: list.reduce((n, g) => n + g.items.length, 0), groups: list };
}

/** What the draft changes compared with the published config; nothing when either is missing. */
export function changesSince(published: AgentConfig | null | undefined, draft: AgentConfig | null | undefined): ChangeSummary {
  if (!isObj(published) || !isObj(draft)) return { total: 0, groups: [] };
  return plainChanges(diffConfigs(published, draft));
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The draft's own bookkeeping fields, put on a meta taken from somewhere else (so the next publish does not collide). */
function keepBookkeeping(meta: unknown, draftMeta: unknown): Record<string, unknown> {
  const next = isObj(meta) ? { ...meta } : {};
  const own = isObj(draftMeta) ? draftMeta : {};
  BOOKKEEPING.forEach((k) => {
    if (k in own) next[k] = own[k];
    else delete next[k];
  });
  return next;
}

/**
 * The draft with one top-level part (persona, tools, ...) as it was published; a part that did not exist then is
 * removed. Putting back "meta" keeps the draft's version, status and dates.
 */
export function revertSection(draft: AgentConfig, published: AgentConfig | null | undefined, key: string): AgentConfig {
  const next = clone(draft) as Record<string, unknown>;
  if (isObj(published) && Object.prototype.hasOwnProperty.call(published, key)) {
    next[key] = key === 'meta' ? keepBookkeeping(clone(published.meta), draft.meta) : clone(published[key]);
  } else {
    delete next[key];
  }
  return next as AgentConfig;
}

/** A version's config to put in the editor as the draft: everything from the version, the draft's own bookkeeping kept. */
export function restoreAsDraft(draft: AgentConfig, version: AgentConfig): AgentConfig {
  const next = clone(version);
  next.meta = keepBookkeeping(next.meta, draft.meta);
  return next;
}
