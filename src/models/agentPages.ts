// The pages of an agent, which page a place in the config is edited on, and the links that open the exact page, panel
// and field ("show me"). Pure: no React, no DOM.
import type { Path, StageId } from '../types/studio';
import { SHOWN, matchScore } from '../utils/match';
import { parseSettingPath } from './schemaForm/paths';

/** The parts of Build, each a page with plain controls and, below them, every setting of that part. */
export type BuildSection = 'agent' | 'channels' | 'tools' | 'knowledge' | 'guardrails' | 'aftercall';

export const BUILD_SECTIONS: { id: BuildSection; label: string; description: string }[] = [
  { id: 'agent', label: 'Agent', description: 'What it does, how it sounds, its language and AI model.' },
  { id: 'channels', label: 'Channels', description: 'Where people reach it, and what it says first.' },
  { id: 'tools', label: 'Tools', description: 'What it can do during a conversation.' },
  { id: 'knowledge', label: 'Knowledge', description: 'Documents and web pages it answers from.' },
  { id: 'guardrails', label: 'Guardrails', description: 'What it talks about, when it hands over, and its limits.' },
  { id: 'aftercall', label: 'After the call', description: 'Summaries, questions answered, recordings and what is hidden.' },
];

export const STAGES: { id: StageId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'build', label: 'Build' },
  { id: 'test', label: 'Test' },
  { id: 'release', label: 'Release' },
  { id: 'monitor', label: 'Monitor' },
];

/** Build's other views of the whole agent. */
export type BuildView = 'all' | 'canvas' | 'json';

/** The panels of the Agent section, by the name a link uses (`?open=voice`). */
export type AgentPanel = 'voice' | 'language' | 'models' | 'behaviour' | 'persona' | 'messages';

/** Where something is done: a stage, for Build one of its sections or views; `focus` names the control to open there. */
export interface PageTarget {
  stage: StageId;
  section?: BuildSection;
  view?: BuildView;
  panel?: AgentPanel;
  focus?: string;
}

/** The address of a target, under the agent's own address. */
export function targetPath(agentId: string, target: PageTarget): string {
  const base = `/agents/${encodeURIComponent(agentId)}/${target.stage}`;
  const withSection = target.stage === 'build' && target.section ? `${base}/${target.section}` : base;
  const query = new URLSearchParams();
  if (target.stage === 'build' && target.view) query.set('view', target.view);
  if (target.focus) query.set('focus', target.focus);
  const q = query.toString();
  return q ? `${withSection}?${q}` : withSection;
}

/**
 * The top-level config sections each Build section edits, so every part of the schema has a home (a test checks it).
 * The section's "All settings for this part" shows these; `tests` is the Test stage's.
 */
export const SECTION_KEYS: Record<BuildSection, string[]> = {
  agent: ['meta', 'persona', 'messages', 'defaults', 'agents', 'state', 'events', 'runtime', 'constants', 'builder'],
  channels: ['channels', 'identity', 'schedules', 'telephony'],
  tools: ['tools', 'connections', 'forms', 'notifications', 'tasks'],
  knowledge: ['knowledge'],
  guardrails: ['guardrails'],
  aftercall: ['post_call', 'wrapups', 'observability'],
};

/** The Build section that edits a place in the config (for a problem the server found there). */
export function sectionOfPath(path: Path | null | undefined): BuildSection | null {
  const top = path?.[0];
  if (top === undefined) return null;
  const found = (Object.keys(SECTION_KEYS) as BuildSection[]).find((s) => SECTION_KEYS[s].includes(String(top)));
  return found ?? 'agent';
}

/** Server problems per Build section, for the numbers on the section menu. Problems with no place count nowhere. */
export function problemsBySection(errors: { path: Path | null }[]): Partial<Record<BuildSection, number>> {
  const out: Partial<Record<BuildSection, number>> = {};
  errors.forEach((e) => {
    const s = e.path && e.path[0] !== 'tests' ? sectionOfPath(e.path) : null;
    if (s) out[s] = (out[s] ?? 0) + 1;
  });
  return out;
}

/**
 * Where a config path is edited: the stage and Build section, the Agent section's panel if it is one of its blocks,
 * and the field (`focus`) when a page asks for it above its settings. Used by "Show me" and by deep links.
 */
export function locate(path: Path | null | undefined): PageTarget {
  const [key, sub, third, fourth] = Array.isArray(path) ? path : [];
  // the recording notice lives beside the recording settings (After the call)
  if (key === 'persona' && sub === 'disclosures') return { stage: 'build', section: 'aftercall', focus: 'notice' };
  if (key === 'persona' && (sub === 'tone' || sub === 'style_rules')) return { stage: 'build', section: 'agent', panel: 'behaviour' };
  if (key === 'persona') return { stage: 'build', section: 'agent', panel: 'persona' };
  if (key === 'messages') return { stage: 'build', section: 'agent', panel: 'messages' };
  // each channel's first words are asked on Channels
  if (key === 'channels' && sub !== undefined && third === 'greeting') return { stage: 'build', section: 'channels', focus: 'greeting' };
  if (key === 'defaults' && sub === 'language') return { stage: 'build', section: 'agent', panel: 'language' };
  if (key === 'defaults' && sub === 'models') {
    if (third === 'tts' && fourth === 'voice_id') return { stage: 'build', section: 'agent', panel: 'voice' };
    if (third === undefined || (['stt', 'llm', 'tts'].includes(String(third)) && [undefined, 'provider', 'model'].includes(fourth as string | undefined)))
      return { stage: 'build', section: 'agent', panel: 'models' };
    return { stage: 'build', section: 'agent' };
  }
  if (key === 'tests') return { stage: 'test', focus: 'scenarios' };
  if (key === undefined) return { stage: 'build', section: 'agent' };
  return { stage: 'build', section: sectionOfPath([key]) ?? 'agent' };
}

// ---- deep links: ?setting=, ?tool=, ?open=, ?show= ------------------------------------------------------------------

/** What each `?open=` panel name opens: a setting in it, so the same flow finds the page and the field. */
export const PANEL_PATHS: Record<AgentPanel, Path> = {
  voice: ['defaults', 'models', 'tts', 'voice_id'],
  language: ['defaults', 'language', 'primary'],
  models: ['defaults', 'models', 'llm', 'model'],
  behaviour: ['persona', 'tone'],
  persona: ['persona', 'company'],
  messages: ['messages'],
};

/** The block on the Agent section that holds a panel (Studio's guided blocks), for opening it. */
export const PANEL_ELEMENT: Record<AgentPanel, string | null> = {
  voice: 'g-voice',
  language: 'g-voice',
  models: 'g-model',
  behaviour: 'g-personality',
  persona: 'g-personality',
  messages: null,
};

const PANELS = Object.keys(PANEL_PATHS) as AgentPanel[];
// The panel names Weave React's links used, so an old link still opens.
const PANEL_ALIASES: Record<string, AgentPanel> = { model: 'models', ai: 'models', tone: 'behaviour', style: 'behaviour', personality: 'persona', lines: 'messages' };

/** What a deep link asks for, read from the address. */
export interface DeepLink {
  /** The place in the config to open and flash. */
  path: Path | null;
  target: PageTarget | null;
  /** `?show=problems`: the server's checks. */
  problems: boolean;
  /** The parameters to take off the address once handled. */
  consumed: string[];
}

interface ConfigLike {
  tools?: unknown;
}

/**
 * The page, field and panel a link asks for: `?setting=defaults.conversation.inactivity` (a config path, `[0]` or `.0`
 * for list items), `?tool=lookup_order` (a tool by id), `?open=voice` (a panel of the Agent section) and
 * `?show=problems` or `?show=json`. Null when the address asks for none of them.
 */
export function readDeepLink(params: URLSearchParams, config: ConfigLike | null | undefined): DeepLink | null {
  const setting = params.get('setting');
  const tool = params.get('tool');
  const open = params.get('open');
  const show = params.get('show');
  if (!setting && !tool && !open && !show) return null;
  const consumed = ['setting', 'tool', 'open', 'show'].filter((k) => params.has(k));
  let path: Path | null = null;
  let target: PageTarget | null = null;
  if (setting) {
    path = parseSettingPath(setting);
    if (!path.length) path = null;
  } else if (tool) {
    const tools = Array.isArray(config?.tools) ? (config?.tools as unknown[]) : [];
    const index = tools.findIndex((t) => !!t && typeof t === 'object' && (t as { id?: unknown }).id === tool);
    path = index >= 0 ? ['tools', index] : ['tools'];
  } else if (open) {
    const name = (PANELS.includes(open as AgentPanel) ? open : PANEL_ALIASES[open]) as AgentPanel | undefined;
    if (name) {
      path = PANEL_PATHS[name];
      target = { ...locate(path), panel: name };
    }
  }
  if (path && !target) target = locate(path);
  if (show === 'json') target = { ...(target ?? { stage: 'build', section: 'agent' }), stage: 'build', view: 'json' };
  return { path, target, problems: show === 'problems', consumed };
}

/** The address that opens one setting of an agent: its Build section with `?setting=`. */
export function settingHref(agentId: string, path: Path): string {
  const target = locate(path);
  const base = targetPath(agentId, { stage: target.stage, section: target.section });
  const dotted = path.map(String).join('.');
  return `${base}?setting=${encodeURIComponent(dotted)}`;
}

// ---- the search (Ctrl/⌘ K) on an agent's pages ----------------------------------------------------------------------

export const PANEL_LABELS: Record<AgentPanel, string> = {
  voice: 'Voice',
  language: 'Language',
  models: 'AI model',
  behaviour: 'Tone and style',
  persona: 'Personality and instructions',
  messages: 'Fixed lines',
};

/** What a setting from the search index is: where it is and how far it can be opened. */
export interface SearchEntryLike {
  trail?: string[];
  jump?: string[];
  screen?: { label: string } | null;
  crumbs?: string[];
}

export type SearchTarget = PageTarget & { path: Path };

/**
 * Where a search result is shown: `locate` for its openable path, or the field that asks for it. An agent's
 * instructions are the Agent section's field only with one agent; with several they are in the Workflow.
 */
export function searchTarget(entry: SearchEntryLike = {}, config: { agents?: { items?: unknown } } | null = null): SearchTarget {
  const t = Array.isArray(entry.trail) ? entry.trail : [];
  const items = config?.agents?.items;
  const several = Array.isArray(items) && items.length > 1;
  const greeting = t.indexOf('greeting');
  if (t[0] === 'channels' && greeting > 0) return { stage: 'build', section: 'channels', focus: 'greeting', path: ['channels'] };
  if (t[0] === 'agents' && t.includes('instructions') && t[t.length - 1] === 'role')
    return several ? { stage: 'build', view: 'canvas', path: ['agents'] } : { stage: 'build', section: 'agent', focus: 'instructions', path: ['agents'] };
  const path: Path = Array.isArray(entry.jump) && entry.jump.length ? entry.jump : t.slice(0, 1);
  return { ...locate(path), path };
}

const FIELD_NAMES: Record<string, string> = { greeting: 'What it says first', instructions: 'Instructions', notice: 'Recording notice', scenarios: 'Scenarios' };
const STAGE_LABELS: Record<string, string> = { overview: 'Overview', build: 'Build', test: 'Test', release: 'Release', monitor: 'Monitor' };
const VIEW_LABELS: Record<BuildView, string> = { all: 'All settings', canvas: 'Workflow', json: 'JSON' };

/** The name of a page: a Build section or view by its own name, any other stage by the stage's. */
export function pageLabel(target: PageTarget): string {
  if (target.stage === 'build') {
    if (target.view) return VIEW_LABELS[target.view];
    return BUILD_SECTIONS.find((s) => s.id === target.section)?.label ?? 'Build';
  }
  return STAGE_LABELS[target.stage] ?? target.stage;
}

/** Where a setting lives, in the pages' own words ("Channels › Business hours › Opening times", "Agent › Voice"). */
export function settingWhere(entry: SearchEntryLike = {}, config: { agents?: { items?: unknown } } | null = null): string {
  const target = searchTarget(entry, config);
  const page = pageLabel(target);
  if (target.focus) return `${page} › ${FIELD_NAMES[target.focus] ?? target.focus}`;
  if (target.panel) return `${page} › ${PANEL_LABELS[target.panel]}`;
  const parts = [page, entry.screen?.label || '', ...(Array.isArray(entry.crumbs) ? entry.crumbs : [])].filter(Boolean);
  return parts.filter((p, i) => i === 0 || p !== parts[i - 1]).join(' › ');
}

/** A setting found in many places under one name is shown at most `max` times, best first, so others still fit. */
export function capSameLabel<T extends { label: string }>(entries: T[], max = 2): T[] {
  const seen = new Map<string, number>();
  return entries.filter((entry) => {
    const n = (seen.get(entry.label) || 0) + 1;
    seen.set(entry.label, n);
    return n <= max;
  });
}

/** Something to open on an agent: a page or a common task, found by the words people would type. */
export interface AgentSearchItem {
  id: string;
  title: string;
  description: string;
  words: string;
  target: PageTarget;
  /** More of the address (`publish=1` opens the publish dialog). */
  params?: Record<string, string>;
}

const page = (id: string, title: string, description: string, words: string, target: PageTarget): AgentSearchItem => ({
  id: `page-${id}`,
  title,
  description,
  words,
  target,
});

/** What search offers on an agent besides settings: its pages, then the things people come to do. */
export const AGENT_SEARCH: AgentSearchItem[] = [
  page('overview', 'Overview', 'How it is doing, and what to do next', 'overview home dashboard status ready next', { stage: 'overview' }),
  page('agent', 'Agent', 'Who it is, what it should do, and how it sounds', 'instructions prompt role voice language model persona name tone', {
    stage: 'build',
    section: 'agent',
  }),
  page('channels', 'Channels', 'Where people reach it, and what it says first', 'phone chat website widget reach greeting hello business hours opening hours whatsapp sms', {
    stage: 'build',
    section: 'channels',
  }),
  page('tools', 'Tools', 'What it can do during a conversation', 'actions abilities lookup hand over end call integrations api forms connections', {
    stage: 'build',
    section: 'tools',
  }),
  page('knowledge', 'Knowledge', 'Documents and web pages it answers from', 'documents files faq website pages answers sources', { stage: 'build', section: 'knowledge' }),
  page('guardrails', 'Guardrails', 'What it talks about, when it hands over, and its limits', 'safety block blocked topics rules limits', {
    stage: 'build',
    section: 'guardrails',
  }),
  page('aftercall', 'After the call', 'Summaries, recordings and what is hidden', 'summary recording redaction wrap up analysis', { stage: 'build', section: 'aftercall' }),
  page('all', 'All settings', 'Every setting of this agent, grouped by what it is for', 'settings advanced engine description owner tags reliability', {
    stage: 'build',
    view: 'all',
  }),
  page('workflow', 'Workflow', 'Who answers first, and how a call moves from one agent to another', 'agents handover hand-off canvas flow specialist multi', {
    stage: 'build',
    view: 'canvas',
  }),
  page('json', 'JSON', 'The whole configuration as a file', 'json code raw file config', { stage: 'build', view: 'json' }),
  page('test', 'Test', 'Talk to it, run its scenarios and readiness checks', 'try chat preview talk call scenarios checks scripted', { stage: 'test' }),
  page('release', 'Release', 'Publish a version, and choose what is live where', 'publish deploy versions live rollback roll back', { stage: 'release' }),
  page('monitor', 'Monitor', 'How this agent is doing, from its calls', 'health dashboard stats calls handoffs cut off', { stage: 'monitor' }),
  {
    id: 'setup',
    title: 'Set it up step by step',
    description: 'The guided setup: what it does, where people reach it, its voice, what it knows and can do',
    words: 'wizard guide start onboarding',
    target: { stage: 'setup' },
  },
  {
    id: 'problems',
    title: 'Problems the server found',
    description: 'The server’s checks on the draft, with fixes',
    words: 'errors warnings checks validation issues fix',
    target: { stage: 'build', section: 'agent' },
    params: { show: 'problems' },
  },
  { id: 'try', title: 'Test it', description: 'Talk to it the way a customer would', words: 'try chat preview talk call', target: { stage: 'test' } },
  {
    id: 'publish',
    title: 'Publish a version',
    description: 'Freeze the saved draft as a version you can put live',
    words: 'release save version',
    target: { stage: 'release' },
    params: { publish: '1' },
  },
  {
    id: 'deploy',
    title: 'Put a version live',
    description: 'Choose which version people reach in each environment',
    words: 'deploy go live launch environment production staging development',
    target: { stage: 'release', focus: 'deploy' },
  },
  { id: 'rollback', title: 'Roll back', description: 'Put an earlier version live again', words: 'undo revert previous restore older', target: { stage: 'release' } },
];

/** The address of a search item on an agent. */
export function agentSearchHref(agentId: string, item: AgentSearchItem): string {
  const base = targetPath(agentId, item.target);
  if (!item.params) return base;
  const query = new URLSearchParams(item.params).toString();
  return `${base}${base.includes('?') ? '&' : '?'}${query}`;
}

/**
 * AGENT_SEARCH entries matching the query (fuzzy) on title or words, not the description. Ranked: title starts with
 * it, title has it, tasks, pages. With nothing typed, the pages.
 */
export function searchAgent(query: string): AgentSearchItem[] {
  const phrase = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
  if (!phrase) return AGENT_SEARCH.filter((item) => item.id.startsWith('page-'));
  const rank = (item: AgentSearchItem) => {
    const title = item.title.toLowerCase();
    return title.startsWith(phrase) ? 0 : title.includes(phrase) ? 1 : item.id.startsWith('page-') ? 3 : 2;
  };
  return AGENT_SEARCH.map((item, i) => ({ item, i, r: rank(item), score: matchScore(phrase, item.title, item.words) }))
    .filter((m) => m.score >= SHOWN)
    .sort((a, b) => a.r - b.r || b.score - a.score || a.i - b.i)
    .map(({ item }) => item);
}
