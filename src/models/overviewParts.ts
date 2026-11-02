// The parts of Build as the agent's Overview lists them: each part's state and a line saying what is in it, read from
// the draft. It informs and never blocks; readiness.ts stays the one answer to "can it go live?". Pure: no React.

import type { AgentConfig, Path } from '../types/studio';
import { BUILD_SECTIONS, problemsBySection, type BuildSection } from './agentPages';
import { entryAgent, firstGreeting, hasVoiceChannel } from './readiness';
import { languageName } from './languages';
import { REACH, reachOf } from './setup';
import { momentsOf, topicsOf } from './guardrails';
import { afterCallOf } from './afterCall';

export type PartState = 'done' | 'todo' | 'attention' | 'optional';

export interface BuildPart {
  id: BuildSection;
  label: string;
  purpose: string;
  state: PartState;
  status: string;
}

const list = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const words = (text: unknown) => (typeof text === 'string' ? text.match(/\S+/g)?.length ?? 0 : 0);
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);
const joinAnd = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0] || '');
const sentence = (parts: (string | false | 0 | null | undefined)[]) => {
  const text = parts.filter(Boolean).join(' · ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
};

function agentPart(config: AgentConfig): Pick<BuildPart, 'state' | 'status'> {
  const greeting = firstGreeting(config);
  const primary = config.defaults?.language?.primary;
  const voice = hasVoiceChannel(config);
  // the same rules as readiness.ts: instructions, a greeting, a language, and a voice when it talks
  const missing = [
    words(entryAgent(config)?.instructions?.role) < 8 && 'what it should do',
    !greeting && 'what it says first',
    !primary && 'its language',
    voice && !config.defaults?.models?.tts?.voice_id && 'its voice',
  ].filter((m): m is string => !!m);
  if (missing.length) return { state: 'todo', status: `Still to choose: ${joinAnd(missing)}.` };
  return {
    state: 'done',
    status: [`Says “${clip(greeting, 48)}”`, primary ? languageName(primary) : '', voice ? 'voice chosen' : ''].filter(Boolean).join(' · '),
  };
}

function channelsPart(config: AgentConfig): Pick<BuildPart, 'state' | 'status'> {
  const on = reachOf(config);
  const named = REACH.filter((r) => on[r.type]).map((r, i) => (i ? `${r.label.charAt(0).toLowerCase()}${r.label.slice(1)}` : r.label));
  const others = list(config.channels).filter((c) => isObj(c) && c.enabled !== false && !(String(c.type) in on)).length;
  const all = [...named, others ? plural(others, 'other channel') : ''].filter(Boolean);
  if (!all.length) return { state: 'attention', status: 'No way to reach it is switched on.' };
  return { state: 'done', status: `${joinAnd(all)}.` };
}

function toolsPart(config: AgentConfig): Pick<BuildPart, 'state' | 'status'> {
  const tools = list<Record<string, unknown>>(config.tools).filter(isObj);
  const connections = list(config.connections).filter(isObj).length;
  if (!tools.length) return { state: 'optional', status: 'Nothing switched on: it can only talk.' };
  return { state: 'done', status: sentence([plural(tools.length, 'tool'), connections && plural(connections, 'connection')]) };
}

function knowledgePart(config: AgentConfig): Pick<BuildPart, 'state' | 'status'> {
  const bases = list<Record<string, unknown>>(config.knowledge).filter(isObj);
  const sources = bases.flatMap((b) => list<Record<string, unknown>>(b.sources).filter(isObj));
  if (!bases.length) return { state: 'optional', status: 'No documents yet: it answers from its instructions only.' };
  const files = sources.filter((s) => s.type === 'file').length;
  const pages = sources.length - files;
  const what = [files && plural(files, 'document'), pages && plural(pages, 'web page')].filter(Boolean).join(' and ');
  return { state: 'done', status: what ? `${what} in ${plural(bases.length, 'knowledge base')}.` : `${plural(bases.length, 'knowledge base')}, no documents in it yet.` };
}

function guardrailsPart(config: AgentConfig): Pick<BuildPart, 'state' | 'status'> {
  const topics = topicsOf(config);
  const moments = Object.values(momentsOf(config)).filter((m) => m?.on).length;
  const checks = list(config.guardrails?.input).length + list(config.guardrails?.output).length;
  const parts = [
    topics.allowed.length && `keeps to ${plural(topics.allowed.length, 'topic')}`,
    topics.blocked.length && `avoids ${plural(topics.blocked.length, 'topic')}`,
    moments && `${plural(moments, 'moment')} it acts on`,
    checks && plural(checks, 'safety check'),
  ];
  if (!parts.some(Boolean)) return { state: 'optional', status: 'None set: it follows its instructions.' };
  return { state: 'done', status: sentence(parts) };
}

function afterCallPart(config: AgentConfig): Pick<BuildPart, 'state' | 'status'> {
  const after = afterCallOf(config);
  const parts = [
    after.summary.on === true ? 'writes a summary' : after.summary.on === false ? 'no summary' : '',
    after.questions.length && `answers ${plural(after.questions.length, 'question')}`,
    after.recording.days && `keeps recordings ${after.recording.days} days`,
  ];
  if (!parts.some(Boolean)) return { state: 'optional', status: 'Nothing set: the server’s defaults apply.' };
  return { state: 'done', status: sentence(parts) };
}

const READERS: Record<BuildSection, (c: AgentConfig) => Pick<BuildPart, 'state' | 'status'>> = {
  agent: agentPart,
  channels: channelsPart,
  tools: toolsPart,
  knowledge: knowledgePart,
  guardrails: guardrailsPart,
  aftercall: afterCallPart,
};

/** Build's parts in its menu's order; a part where the server's checks found problems needs attention. */
export function buildParts(config: AgentConfig | null | undefined, errors: { path: Path | null }[] = []): BuildPart[] {
  if (!isObj(config)) return [];
  const problems = problemsBySection(errors);
  return BUILD_SECTIONS.map((s) => {
    const part = READERS[s.id](config);
    const found = problems[s.id] ?? 0;
    return {
      id: s.id,
      label: s.label,
      purpose: s.description,
      ...part,
      ...(found ? { state: 'attention' as const, status: `${plural(found, 'problem')} to fix · ${part.status}` } : {}),
    };
  });
}
