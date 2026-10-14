export const NAV = [
  { id: 'home', label: 'Overview', icon: '⌂' },
  { id: 'agents', label: 'Agents', icon: '✦' },
  { id: 'sessions', label: 'Sessions', icon: '◫' },
  { id: 'readiness', label: 'Readiness checks', icon: '◉', badge: 'BETA' },
];

export function getInitials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'W';
}

// Telephony records saved with each workspace: phone numbers, dispatch rules and SIP trunks.
export function normalizeTelephony(value) {
  const list = (items) => (Array.isArray(items) ? items.filter((item) => item && item.id) : []);
  return { numbers: list(value?.numbers), rules: list(value?.rules), trunks: list(value?.trunks), calls: list(value?.calls) };
}

export function formatDuration(seconds = 0) {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} sec`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) return rest ? `${minutes} min ${rest} sec` : `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
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

export const WORKSPACE_NAV = [
  { id: 'voices', label: 'Voices', icon: '◒' },
  { id: 'telephony', label: 'Telephony', icon: '⌁' },
  { id: 'integrations', label: 'Integrations', icon: '⌘' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export const TELEPHONY_SECTIONS = [
  { id: 'calls', label: 'Calls', icon: '☎' },
  { id: 'dispatch', label: 'Dispatch rules', icon: '⇢' },
  { id: 'numbers', label: 'Phone numbers', icon: '#' },
  { id: 'trunks', label: 'SIP trunks', icon: '▤' },
];

export function compactDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' });
}

export function agentLifecycle(agent) {
  return AGENT_LIFECYCLE.find((item) => item.status === (agent?.status || 'draft')) || AGENT_LIFECYCLE[0];
}

export function formatRelative(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
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
