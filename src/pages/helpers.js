import { formatWhen } from '../studio/format.js';
// The sidebar holds workspace-level things only: Home, Agents and the Calls of every agent; then the Library (what agents share: voices, integrations,
// telephony) and Settings. Everything about ONE agent (building, testing, releasing, watching it) is inside that agent.
export const NAV = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'agents', label: 'Agents', icon: 'agent' },
  { id: 'sessions', label: 'Calls', icon: 'phone' },
  { id: 'live', label: 'Live', icon: 'live' },
  { id: 'monitoring', label: 'Monitoring', icon: 'monitor' },
  { id: 'cost', label: 'Cost and speed', icon: 'gauge' },
  { id: 'alerts', label: 'Alerts', icon: 'bell' },
];
export const LIBRARY_NAV = [
  { id: 'voices', label: 'Voices', icon: 'voice' },
  { id: 'integrations', label: 'Integrations', icon: 'plug' },
  { id: 'telephony', label: 'Telephony', icon: 'dial' },
];
export const SETTINGS_NAV = [
  { id: 'team', label: 'Team', icon: 'team' },
  { id: 'settings', label: 'Settings', icon: 'sliders' },
];

export function getInitials(name = '') {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || 'W'
  );
}

// Telephony records saved with each workspace: phone numbers, dispatch rules and SIP trunks.
export function normalizeTelephony(value) {
  const list = (items) => (Array.isArray(items) ? items.filter((item) => item && item.id) : []);
  return { numbers: list(value?.numbers), rules: list(value?.rules), trunks: list(value?.trunks), calls: list(value?.calls) };
}

// How long, the same way on every page: "10 s", "1 min 8 s", "1 h 5 min".
export function formatDuration(seconds = 0) {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function sessionsInRange(list = [], range = 'Past 7 days') {
  const since = Date.now() - (RANGE_MS[range] || RANGE_MS['Past 7 days']);
  return list.filter((item) => new Date(item.startedAt).getTime() >= since);
}

export function sessionStats(list = []) {
  const totalSec = list.reduce((sum, item) => sum + (Number(item.durationSec) || 0), 0);
  const agentsSeen = new Set(list.map((item) => item.agentId)).size;
  return {
    count: list.length,
    avgSec: list.length ? totalSec / list.length : 0,
    minutes: totalSec / 60,
    participants: list.length ? agentsSeen + 1 : 0, // you plus each agent you tested
    messages: list.reduce((sum, item) => sum + (Number(item.userMessages) || 0), 0),
  };
}

export function makeRecordId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const WORKSPACE_NAV = [...LIBRARY_NAV, ...SETTINGS_NAV];

export const TELEPHONY_SECTIONS = [
  { id: 'calls', label: 'Simulated calls', icon: 'phone' },
  { id: 'dispatch', label: 'Dispatch rules', icon: 'arrowRight' },
  { id: 'numbers', label: 'Phone numbers', icon: 'dial' },
  { id: 'trunks', label: 'SIP trunks', icon: 'plug' },
];

// The address of each workspace page, so a refresh, a bookmark and Back keep you on it: #/home, #/calls, #/live, #/telephony/numbers... (an agent has its
// own, #/bots/...). `id` is the page's id in NAV / LIBRARY_NAV / SETTINGS_NAV; Calls is `sessions` inside, "calls" in the address.
const PAGE_SLUGS = {
  home: 'home',
  sessions: 'calls',
  live: 'live',
  monitoring: 'monitoring',
  cost: 'cost',
  alerts: 'alerts',
  voices: 'voices',
  integrations: 'integrations',
  telephony: 'telephony',
  team: 'team',
  settings: 'settings',
};
export function workspaceHref(id, section) {
  const slug = PAGE_SLUGS[id] || 'home';
  return id === 'telephony' && TELEPHONY_SECTIONS.some((item) => item.id === section) ? `#/${slug}/${section}` : `#/${slug}`;
}
// { id, section? } for a workspace page's address, else null (an agent's address, or none)
export function parseWorkspaceHash(hash) {
  const parts = String(hash || '')
    .replace(/^#\/?/, '')
    .split('?')[0]
    .split('/')
    .filter(Boolean);
  const id = Object.keys(PAGE_SLUGS).find((key) => PAGE_SLUGS[key] === parts[0]);
  if (!id) return null;
  if (id !== 'telephony') return { id };
  return { id, section: TELEPHONY_SECTIONS.some((item) => item.id === parts[1]) ? parts[1] : 'calls' };
}

// An address that names no page (a mistyped or old link), so the workspace says "Page not found" instead of showing another page. No address
// at all is Home; an agent's address (#/bots/...) is the Agents area's to judge.
export const isUnknownAddress = (hash) => !!hash && !['#', '#/'].includes(hash) && !/^#\/bots/.test(hash) && !parseWorkspaceHash(hash);

export function compactDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' });
}

export function agentLifecycle(agent) {
  return AGENT_LIFECYCLE.find((item) => item.status === (agent?.status || 'draft')) || AGENT_LIFECYCLE[0];
}

// The same words as formatWhen (studio/format.js), at the start of a line: "Just now", "3 hours ago", "4 days ago", then the date after a week.
export function formatRelative(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '—';
  const text = formatWhen(value, { days: 7 });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const RANGE_MS = { 'Past 24 hours': 86400000, 'Past 7 days': 7 * 86400000, 'Past 30 days': 30 * 86400000, 'Past 90 days': 90 * 86400000 };

export const AGENT_LIFECYCLE = [
  { status: 'draft', label: 'Draft', environment: 'development', place: 'Development', note: 'Still being built and tested.', tone: 'draft' },
  { status: 'staging', label: 'In review', environment: 'staging', place: 'Staging', note: 'Being checked before it goes live.', tone: 'review' },
  { status: 'published', label: 'Live', environment: 'production', place: 'Production', note: 'Serving real callers.', tone: 'live' },
  { status: 'archived', label: 'Archived', environment: null, place: 'Retired', note: 'No longer in use.', tone: 'archived' },
];

export const formatShortDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};
