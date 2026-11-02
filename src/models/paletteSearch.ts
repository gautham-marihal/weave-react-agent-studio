// What the search (Ctrl/⌘ K) lists: grouped results, the best match first, the recent picks while nothing is typed,
// and on an agent its own pages, tasks and settings. Pure: the palette hands in what it knows and draws the groups.
import { bestFirst } from '../utils/match';
import { AGENT_SEARCH, agentSearchHref, capSameLabel, searchAgent, searchTarget, settingHref, settingWhere, targetPath, type AgentSearchItem } from './agentPages';
import type { SettingEntry } from './schemaForm/settingsSearch';

export type PaletteKind = 'page' | 'action' | 'agent' | 'agentAction' | 'agentPage' | 'setting' | 'number' | 'call' | 'telephony';

export interface PaletteItem {
  kind: PaletteKind;
  id: string;
  title: string;
  description: string;
  /** More words it is found by (not shown). */
  words?: string;
  /** Where it leads. */
  href?: string;
  /** What it does instead of leading somewhere ('create', 'theme', 'help'…). */
  action?: string;
}

export interface PaletteGroup {
  group: string;
  items: PaletteItem[];
}

/** How a result is known, so the recent picks can find it again. */
export const searchKey = (item: Pick<PaletteItem, 'kind' | 'id'>): string => `${item.kind}:${item.id}`;

/** How many recent picks are kept (in this browser). */
export const RECENT_KEPT = 8;

/** The list of recent picks with this one first. */
export function rememberPick(recent: string[], key: string): string[] {
  return [key, ...recent.filter((k) => k !== key)].slice(0, RECENT_KEPT);
}

/** The workspace's own pages, each at its address in the app. */
export const WORKSPACE_PAGES: PaletteItem[] = [
  { kind: 'page', id: 'home', title: 'Home', description: 'What needs attention, and the next step', href: '/' },
  { kind: 'page', id: 'agents', title: 'Agents', description: 'Every agent, its state and its readiness', words: 'list bots', href: '/agents' },
  { kind: 'page', id: 'live', title: 'Live', description: 'Calls going on right now', words: 'now active monitoring', href: '/live' },
  { kind: 'page', id: 'calls', title: 'Calls', description: 'Every conversation your agents have had', words: 'transcripts sessions history', href: '/calls' },
  { kind: 'page', id: 'knowledge', title: 'Knowledge', description: 'Documents and web pages your agents answer from', words: 'documents files index', href: '/knowledge' },
  { kind: 'page', id: 'library', title: 'Library', description: 'Voices, integrations and phone numbers', words: 'voices integrations numbers providers', href: '/library' },
  { kind: 'page', id: 'telephony', title: 'Telephony', description: 'Phone numbers, dispatch rules and SIP trunks', words: 'phone numbers dispatch rules routing sip trunks carrier', href: '/telephony' },
  { kind: 'page', id: 'analytics', title: 'Analytics', description: 'Workspace analytics (not available yet)', words: 'monitoring stats', href: '/analytics' },
  { kind: 'page', id: 'settings', title: 'Settings', description: 'Your account, theme, density and technical names', words: 'preferences account', href: '/settings' },
];

export interface PaletteAgent {
  id: string;
  name: string;
  latest?: string | null;
}
export interface PaletteNumber {
  number: string;
  bot: string | null;
  environment: string | null;
}
/** A Sandbox telephony record (a test number, dispatch rule or trunk), opening its part of the Telephony page. */
export interface PaletteTelephony {
  id: string;
  section: 'numbers' | 'dispatch' | 'trunks' | 'calls';
  title: string;
  description: string;
  words?: string;
}
export interface PaletteCall {
  id: string;
  agentId: string;
  channel: string;
  when: string;
  duration: string;
}

export interface PaletteInput {
  query: string;
  actions: PaletteItem[];
  agents: PaletteAgent[];
  /** The agent whose pages are open, if any. */
  openAgentId: string | null;
  /** The open agent's draft (for where its instructions are edited). */
  openConfig?: { agents?: { items?: unknown } } | null;
  numbers: PaletteNumber[];
  calls: PaletteCall[];
  /** Sandbox only: the telephony kept in this browser (none in Live). */
  telephony?: PaletteTelephony[];
  /** The open agent's settings matching the query (settingsSearch). */
  settings: SettingEntry[];
  recent: string[];
}

// The things people come to do on any agent, offered for each agent by name.
const AGENT_TASKS = ['publish', 'try', 'deploy'];

/** A result for one of an agent's pages or tasks. */
function agentItem(agentId: string, item: AgentSearchItem, kind: PaletteKind, prefix = ''): PaletteItem {
  return { kind, id: `${prefix}${item.id}`, title: item.title, description: item.description, words: item.words, href: agentSearchHref(agentId, item) };
}

/** The groups of results for what was typed, the best first in each. */
export function paletteGroups(input: PaletteInput): PaletteGroup[] {
  const { query, agents, openAgentId } = input;
  // only signs typed ("+", "#"): nothing to look for yet, as the matching ignores them
  const q = /[\p{L}\p{N}]/u.test(query) ? query.trim() : '';
  const nameOf = (id: string | null) => agents.find((a) => a.id === id)?.name || id || '';
  const agentResults: PaletteItem[] = agents.map((a) => ({
    kind: 'agent',
    id: a.id,
    title: a.name || a.id,
    description: `Agent ${a.id}${a.latest ? `, version ${a.latest}` : ', not published yet'}`,
    href: `/agents/${encodeURIComponent(a.id)}`,
  }));
  // each agent's common tasks (the open agent's own are under "This agent")
  const tasks = AGENT_SEARCH.filter((i) => AGENT_TASKS.includes(i.id));
  const agentActions: PaletteItem[] = agents
    .filter((a) => a.id !== openAgentId)
    .flatMap((a) => [
      ...tasks.map((t) => ({ ...agentItem(a.id, t, 'agentAction', `${a.id}:`), description: `${a.name || a.id} · ${t.description}`, words: `${a.name} ${a.id} ${t.words}` })),
      {
        kind: 'agentAction' as const,
        id: `${a.id}:calls`,
        title: 'Calls',
        description: `${a.name || a.id} · Every conversation this agent has had`,
        words: `${a.name} ${a.id} conversations transcripts history`,
        href: `/calls?agent=${encodeURIComponent(a.id)}`,
      },
    ]);
  const numberResults: PaletteItem[] = input.numbers.map((n) => ({
    kind: 'number',
    id: n.number,
    title: n.number,
    description: n.bot ? `Phone number for ${nameOf(n.bot)}${n.environment ? ` in ${n.environment}` : ''}` : 'Phone number, not connected to an agent',
    words: `${n.number.replace(/\D/g, '')} phone number ${nameOf(n.bot)}`,
    href: '/library',
  }));
  const callResults: PaletteItem[] = input.calls.map((c) => ({
    kind: 'call',
    id: `${c.agentId}:${c.id}`,
    title: `${nameOf(c.agentId)} call`,
    description: `${c.channel}, ${c.when}, ${c.duration}`,
    words: `${c.id} call conversation`,
    href: `/calls/${encodeURIComponent(c.id)}?agent=${encodeURIComponent(c.agentId)}`,
  }));
  const telephonyResults: PaletteItem[] = (input.telephony ?? []).map((t) => ({
    kind: 'telephony',
    id: `${t.section}:${t.id}`,
    title: t.title,
    description: t.description,
    words: t.words,
    href: `/telephony/${t.section}`,
  }));
  const find = (items: PaletteItem[]) => bestFirst(items, query, (item) => [item.title, `${item.description} ${item.words || ''}`]);
  const groups: PaletteGroup[] = [
    { group: 'Navigate', items: WORKSPACE_PAGES },
    { group: 'Actions', items: input.actions },
    { group: 'Agents', items: agentResults },
    ...(q
      ? [
          { group: 'Actions on an agent', items: agentActions },
          { group: 'Phone numbers', items: numberResults },
          { group: 'Telephony', items: telephonyResults },
          { group: 'Calls', items: callResults },
        ]
      : []),
  ];
  const matching = groups.map((g) => ({ ...g, items: find(g.items) })).filter((g) => g.items.length);
  // the open agent's pages and tasks first
  const agentItems = openAgentId ? searchAgent(query).map((i) => agentItem(openAgentId, i, 'agentPage')) : [];
  const settings: PaletteItem[] = openAgentId
    ? capSameLabel(input.settings, 2)
        .slice(0, 8)
        .map((entry) => {
          const target = searchTarget(entry, input.openConfig ?? null);
          const href = target.focus || target.view ? targetPath(openAgentId, target) : settingHref(openAgentId, target.path);
          return {
            kind: 'setting',
            id: entry.trail.join('.'),
            title: entry.label,
            description: `${settingWhere(entry, input.openConfig ?? null)}${entry.level === 'expert' ? ' · advanced' : ''}`,
            href,
          };
        })
    : [];
  // what was picked lately, while nothing is typed (the ones that are still there)
  const known = new Map([...WORKSPACE_PAGES, ...input.actions, ...agentResults, ...agentActions, ...agentItems].map((item) => [searchKey(item), item]));
  const recent = input.recent
    .map((k) => known.get(k))
    .filter((item): item is PaletteItem => !!item)
    .slice(0, RECENT_KEPT);
  const recentGroup = recent.length ? [{ group: 'Recent', items: recent }] : [];
  const withAgent = agentItems.length ? [{ group: 'This agent', items: agentItems }, ...(q ? matching : groups.filter((g) => g.items.length))] : null;
  if (!q) return [...recentGroup, ...(withAgent || groups.filter((g) => g.items.length))];
  const base = withAgent || matching;
  return settings.length ? [...base, { group: 'Settings of this agent', items: settings }] : base;
}
