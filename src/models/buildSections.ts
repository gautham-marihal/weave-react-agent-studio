// The parts of Build, each with what it is for and where it stands in the draft, for the one-page Build view. It
// informs and never blocks; readiness.ts stays the one answer to "can it go live?". Pure: no React, no network.
import type { AgentConfig } from '../types/studio';
import type { BuildSection } from './agentPages';
import { readingOf, type KnowledgeBaseState, type KnowledgeReading } from './readiness';
import { ACTIONS, REACH, actionsOf, reachOf } from './setup';
import { momentsOf, topicsOf } from './guardrails';
import { afterCallOf } from './afterCall';
import { readAgentPage } from './agentPage';
import { readModels } from './pickersModels';
import { readLanguages } from './pickers';
import { languageName } from './languages';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T = unknown,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const words = (text: string) => (text.match(/\S+/g) ?? []).length;
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);
const joinAnd = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0] ?? '');
const sentence = (parts: string[]) => {
  const text = parts.join(' · ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
};

/** The parts in build order, as the one-page view shows them; `workflow` is the canvas view, not a section. */
export type GuidedPartId = BuildSection | 'workflow';
export type PartState = 'done' | 'todo' | 'attention' | 'optional';

/** What each part is for, in a sentence a newcomer can act on. */
export const PURPOSE: Record<GuidedPartId, string> = {
  agent: 'Who it is, what it should do, what it says first, and its language and voice.',
  knowledge: 'The documents and web pages it answers from.',
  tools: 'What it can do besides talk, like taking requests or passing people to your team.',
  workflow: 'Who answers first, and how a conversation moves between agents.',
  channels: 'Where people reach it: by phone, or by chat or talk on your website.',
  guardrails: 'Topics it keeps to or avoids, and when it hands over or ends the call.',
  aftercall: 'What happens when a conversation ends: a summary, questions about it, what is kept.',
};

const READING_WORDS: Partial<Record<KnowledgeReading, string>> = {
  failed: 'reading its documents failed',
  changed: 'its documents changed since they were read',
  unread: 'its documents are not read yet',
  reading: 'its documents are being read',
};

function agentPart(config: AgentConfig): { state: PartState; status: string } {
  const read = readAgentPage(config);
  const languages = readLanguages(config);
  const voice = readModels(config).tts.voiceId;
  // the same things readiness asks for: instructions, a greeting, a language, and a voice when it talks
  const missing = [
    words(read.role) < 8 && 'what it should do',
    !read.greeting && 'what it says first',
    !languages.primary && 'its language',
    read.voiceChannel && !voice && 'its voice',
  ].filter((x): x is string => !!x);
  if (missing.length) return { state: 'todo', status: `Still to choose: ${joinAnd(missing)}.` };
  const spoken = [...new Set([languages.primary, ...languages.speaks].filter(Boolean).map((c) => languageName(c).replace(/ \(.*\)$/, '')))];
  return { state: 'done', status: [`Says “${clip(read.greeting, 48)}”`, joinAnd(spoken), read.voiceChannel ? 'voice chosen' : ''].filter(Boolean).join(' · ') };
}

function knowledgePart(config: AgentConfig, knowledgeRead: KnowledgeBaseState[] | null): { state: PartState; status: string } {
  const bases = list<Json>(config?.knowledge).filter((b) => isObj(b) && b.type === 'vector_store');
  const sources = bases.flatMap((b) => list<Json>(b.sources).filter(isObj));
  const searches = list<Json>(config?.knowledge).filter((b) => isObj(b) && b.type !== 'vector_store').length;
  if (!sources.length && !searches) return { state: 'optional', status: 'No documents yet: it answers from its instructions only.' };
  const files = sources.filter((s) => s.type === 'file').length;
  const pages = sources.length - files;
  const what = [files ? plural(files, 'document') : '', pages ? plural(pages, 'web page') : '', searches ? plural(searches, 'search service') : ''].filter(Boolean).join(' and ');
  if (!knowledgeRead) return { state: 'done', status: `${what}.` };
  const states = bases.map((b) => readingOf(knowledgeRead.find((s) => s.id === b.id)));
  const worst = (['failed', 'changed', 'unread', 'reading'] as KnowledgeReading[]).find((s) => states.includes(s));
  if (worst) return { state: worst === 'reading' ? 'done' : 'attention', status: `${what} · ${READING_WORDS[worst]}.` };
  return { state: 'done', status: `${what} · read and ready to answer from.` };
}

function toolsPart(config: AgentConfig): { state: PartState; status: string } {
  const actions = actionsOf(config);
  const said: Record<string, string> = {
    end_call: 'ends politely',
    hand_over: actions.hand_over.number ? `passes people to your team (${actions.hand_over.number})` : 'passes people to your team (no number yet)',
    details: 'takes contact details',
    lookup: 'looks things up in your system',
  };
  const on = ACTIONS.map((a) => a.id).filter((id) => actions[id]?.on);
  const total = list(config?.tools).filter(isObj).length;
  const others = Math.max(0, total - on.length);
  const parts = [...on.map((id) => said[id]), others ? plural(others, 'other tool') : ''].filter(Boolean);
  if (!parts.length) return { state: 'optional', status: 'Nothing switched on: it can only talk.' };
  return { state: 'done', status: sentence(parts) };
}

function workflowPart(config: AgentConfig): { state: PartState; status: string } {
  const agents = list<Json>(config?.agents?.items).filter(isObj);
  if (agents.length <= 1) return { state: 'done', status: 'One agent answers every conversation.' };
  const entry = agents.find((a) => a.id === config.agents?.entry) ?? agents[0];
  const handoffs = list(entry.handoffs).filter(isObj).length;
  const name = typeof entry.name === 'string' && entry.name ? entry.name : String(entry.id ?? 'The first agent');
  return { state: 'done', status: `${agents.length} agents · ${name} answers first${handoffs ? ` and hands over to ${handoffs}` : ''}.` };
}

function channelsPart(config: AgentConfig): { state: PartState; status: string } {
  const on = reachOf(config);
  const named = REACH.filter((r) => on[r.type]).map((r, i) => (i ? `${r.label.charAt(0).toLowerCase()}${r.label.slice(1)}` : r.label));
  const others = list<Json>(config?.channels).filter((c) => isObj(c) && c.enabled !== false && !(String(c.type) in on)).length;
  const all = [...named, others ? plural(others, 'other channel') : ''].filter(Boolean);
  if (!all.length) return { state: 'attention', status: 'No way to reach it is switched on.' };
  return { state: 'done', status: `${joinAnd(all)}.` };
}

function guardrailsPart(config: AgentConfig): { state: PartState; status: string } {
  const topics = topicsOf(config);
  const moments = Object.values(momentsOf(config)).filter((m) => m?.on).length;
  const checks = list(config?.guardrails?.input).length + list(config?.guardrails?.output).length;
  const parts = [
    topics.allowed.length ? `keeps to ${plural(topics.allowed.length, 'topic')}` : '',
    topics.blocked.length ? `avoids ${plural(topics.blocked.length, 'topic')}` : '',
    moments ? `${plural(moments, 'moment')} it acts on` : '',
    checks ? plural(checks, 'safety check') : '',
  ].filter(Boolean);
  if (!parts.length) return { state: 'optional', status: 'None set: it follows its instructions.' };
  return { state: 'done', status: sentence(parts) };
}

function afterCallPart(config: AgentConfig): { state: PartState; status: string } {
  const after = afterCallOf(config);
  const parts = [
    after.summary.on === true ? 'writes a summary' : after.summary.on === false ? 'no summary' : '',
    after.questions.length ? `answers ${plural(after.questions.length, 'question')}` : '',
    after.recording.days ? `keeps recordings ${after.recording.days} days` : '',
  ].filter(Boolean);
  if (!parts.length) return { state: 'optional', status: 'Nothing set: the server’s defaults apply.' };
  return { state: 'done', status: sentence(parts) };
}

export interface PartRow {
  id: GuidedPartId;
  purpose: string;
  state: PartState;
  status: string;
}

export const GUIDED_ORDER: GuidedPartId[] = ['agent', 'knowledge', 'tools', 'workflow', 'channels', 'guardrails', 'aftercall'];

/**
 * Where each part stands, in build order.
 *   errorsBySection: what the server's checks found, per section (a part with errors needs attention, whatever it holds)
 *   knowledgeRead: what the server has read of the documents (GET /knowledge); null when not known
 */
export function buildSections({ config, errorsBySection = {}, knowledgeRead = null }: { config: AgentConfig | null | undefined; errorsBySection?: Partial<Record<GuidedPartId, number>>; knowledgeRead?: KnowledgeBaseState[] | null }): PartRow[] {
  if (!isObj(config)) return [];
  const c = config as AgentConfig;
  const readers: Record<GuidedPartId, () => { state: PartState; status: string }> = {
    agent: () => agentPart(c),
    knowledge: () => knowledgePart(c, knowledgeRead),
    tools: () => toolsPart(c),
    workflow: () => workflowPart(c),
    channels: () => channelsPart(c),
    guardrails: () => guardrailsPart(c),
    aftercall: () => afterCallPart(c),
  };
  return GUIDED_ORDER.map((id) => {
    const part = readers[id]();
    const errors = errorsBySection[id] ?? 0;
    return { id, purpose: PURPOSE[id], ...part, ...(errors ? { state: 'attention' as const, status: `${plural(errors, 'problem')} to fix · ${part.status}` } : {}) };
  });
}
