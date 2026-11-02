// Search, filters, sorts and pages for the Agents list (an organisation can have hundreds). Pure: no network, no DOM.
// Tags and owner come from each draft's `meta`; an agent whose draft could not be read, or whose server checks have not
// answered yet, is counted as "not checked yet" by the filters that need them, never silently dropped.

import type { AgentConfig } from '../types/studio';

export const PAGE_SIZE = 25;

/** The tags and owner of an agent, from its draft's `meta`. */
export interface AgentMeta {
  tags: string[];
  owner: string;
}

/** One agent as the list filters and sorts it. */
export interface ListItem {
  id: string;
  name: string;
  /** When the draft was last saved (ISO). */
  savedAt: string;
  latestVersion?: string | null;
  /** environment -> the version deployed there */
  deployed: Record<string, string | undefined>;
  /** Needs attention (problems, a failed check, a missing secret); null while the server's checks have not answered. */
  attention?: boolean | null;
  /** Tags and owner; null when the draft could not be read. */
  meta?: AgentMeta | null;
}

export type SortKey = 'recent' | 'name' | 'version' | 'stage' | 'own';
export type StatusKey = 'all' | 'attention' | 'draft' | 'published' | 'live';

/** Compares two x.y.z versions (numbers, not letters: 0.10.0 is after 0.9.0). */
export function compareVersions(a: string, b: string): number {
  const pa = String(a || '0.0.0').split('.').map((n) => Number(n) || 0);
  const pb = String(b || '0.0.0').split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const STAGE_RANK: Record<string, number> = { production: 4, staging: 3, development: 2 };
/** How far along an agent is: live in production, staging, development, published, or a draft only. */
export function stageRank(item: Pick<ListItem, 'deployed' | 'latestVersion'>): number {
  const live = Object.entries(item.deployed).filter(([, v]) => !!v).map(([env]) => STAGE_RANK[env] ?? 1);
  if (live.length) return Math.max(...live);
  return item.latestVersion ? 1 : 0;
}

const byName = (a: ListItem, b: ListItem) => (a.name || a.id).localeCompare(b.name || b.id, undefined, { sensitivity: 'base' });

export const SORTS: Record<SortKey, { label: string; compare: (a: ListItem, b: ListItem) => number }> = {
  recent: { label: 'Recently edited', compare: (a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')) },
  name: { label: 'Name', compare: byName },
  version: { label: 'Latest version', compare: (a, b) => compareVersions(b.latestVersion || '', a.latestVersion || '') },
  stage: { label: 'Furthest along', compare: (a, b) => stageRank(b) - stageRank(a) || compareVersions(b.latestVersion || '0.0.0', a.latestVersion || '0.0.0') },
  // the person's own order (agentOrder.ts arranges it; nothing is compared)
  own: { label: 'Your order', compare: () => 0 },
};

export const isSortKey = (value: unknown): value is SortKey => typeof value === 'string' && value in SORTS;

/** A sorted copy (the input is not reordered). An unknown sort falls back to recently edited. */
export const sortItems = <T extends ListItem>(items: T[], sort: string): T[] => [...items].sort((isSortKey(sort) ? SORTS[sort] : SORTS.recent).compare);

/** The status filter, in the order it is offered. */
export const STATUSES: Record<StatusKey, string> = { all: 'All', attention: 'Needs attention', draft: 'Draft only', published: 'Published', live: 'Live' };
export const isStatusKey = (value: unknown): value is StatusKey => typeof value === 'string' && value in STATUSES;

const IN_STATUS: Partial<Record<StatusKey, (item: ListItem) => boolean>> = {
  attention: (item) => item.attention === true,
  draft: (item) => !item.latestVersion,
  published: (item) => !!item.latestVersion,
  live: (item) => Object.values(item.deployed).some(Boolean),
};

export interface ListFilters {
  query?: string;
  tag?: string;
  owner?: string;
  status?: string;
}

/**
 * The agents left after the search (words of the name or id, in any order), tag, owner and status. `unknown` counts the
 * agents a filter could not judge: tags/owner when the draft wasn't read, "needs attention" while the checks run.
 */
export function filterAgents<T extends ListItem>(items: T[], { query = '', tag = '', owner = '', status = 'all' }: ListFilters = {}): { matched: T[]; unknown: number } {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const test = isStatusKey(status) ? IN_STATUS[status] : undefined;
  let unknown = 0;
  const matched = items.filter((item) => {
    if (words.length) {
      const text = `${item.name || ''} ${item.id}`.toLowerCase();
      if (!words.every((w) => text.includes(w))) return false;
    }
    const metaUnknown = (tag || owner) && !item.meta;
    const checkUnknown = status === 'attention' && (item.attention === null || item.attention === undefined);
    if (metaUnknown || checkUnknown) {
      unknown += 1;
      return false;
    }
    if (tag && !(item.meta?.tags ?? []).includes(tag)) return false;
    if (owner && item.meta?.owner !== owner) return false;
    if (test && !test(item)) return false;
    return true;
  });
  return { matched, unknown };
}

/** The count beside each status filter (with the other filters applied). */
export function statusCounts(items: ListItem[], filters: Omit<ListFilters, 'status'> = {}): Record<StatusKey, number> {
  return Object.fromEntries((Object.keys(STATUSES) as StatusKey[]).map((key) => [key, filterAgents(items, { ...filters, status: key }).matched.length])) as Record<StatusKey, number>;
}

/** The tags and owners found, each with how many agents have it, the most common first. */
export function collectFacets(items: ListItem[]): { tags: { value: string; count: number }[]; owners: { value: string; count: number }[] } {
  const count = (pick: (m: AgentMeta) => string[]) => {
    const counts = new Map<string, number>();
    items.forEach((item) => (item.meta ? pick(item.meta) : []).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1)));
    return [...counts.entries()].map(([value, n]) => ({ value, count: n })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };
  return { tags: count((m) => m.tags), owners: count((m) => (m.owner ? [m.owner] : [])) };
}

/** Tags and owner from a draft's `meta`, and only what is really there. */
export function metaOfConfig(config: AgentConfig | null | undefined): AgentMeta {
  const meta = config?.meta as Record<string, unknown> | undefined;
  const tags = Array.isArray(meta?.tags) ? meta.tags.filter((t): t is string => typeof t === 'string' && !!t) : [];
  const owner = typeof meta?.owner === 'string' ? meta.owner : '';
  return { tags, owner };
}

/** One page of a list: its rows, which page it really is, and "from–to of total". A page past the end is the last. */
export function paginate<T>(items: T[], page = 1, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * size;
  return { rows: items.slice(start, start + size), page: current, pages, from: items.length ? start + 1 : 0, to: Math.min(items.length, start + size), total: items.length };
}
