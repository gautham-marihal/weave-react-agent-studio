// Search, filter, sort and paging for the Agents list (an organisation can have hundreds). Pure: no network, no DOM.
// `meta` (tags, owner, health) is read lazily, so a tag filter covers only agents whose draft is read, and says so.

import { compareVersions, currentStage } from './format.js';
import { needsAttention } from './health/health.js';

export const PAGE_SIZE = 25;

const STAGE_RANK = { production: 4, staging: 3, development: 2 };
const stageRank = (bot) => {
  const stage = currentStage(bot);
  return stage.kind === 'env' ? STAGE_RANK[stage.env] || 1 : stage.kind === 'published' ? 1 : 0;
};
export const SORTS = {
  recent: { label: 'Recently saved', compare: (a, b) => String(b.draft_saved_at || '').localeCompare(String(a.draft_saved_at || '')) },
  name: { label: 'Name', compare: (a, b) => (a.name || a.id).localeCompare(b.name || b.id, undefined, { sensitivity: 'base' }) },
  stage: {
    label: 'Furthest along',
    compare: (a, b) => stageRank(b) - stageRank(a) || compareVersions(b.latest_version || '0.0.0', a.latest_version || '0.0.0'),
  },
  // the person's own order (agentOrder.js arranges it; nothing is compared)
  own: { label: 'Your order', compare: () => 0 },
};

// The tags and owners found so far, each with how many agents have it: [{ value, count }], the most common first.
export function collectFacets(bots, meta) {
  const count = (pick) => {
    const counts = new Map();
    bots.forEach((bot) => pick(meta[bot.id] || {}).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1)));
    return [...counts.entries()].map(([value, n]) => ({ value, count: n })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };
  return { tags: count((m) => m.tags || []), owners: count((m) => (m.owner ? [m.owner] : [])) };
}

// The status filter, in the order it is offered.
export const STATUSES = { all: 'All', attention: 'Needs attention', draft: 'Draft only', published: 'Published', live: 'Live' };
const IN_STATUS = {
  draft: (bot) => !bot.latest_version,
  published: (bot) => Boolean(bot.latest_version),
  live: (bot) => Object.values(bot.deployed || {}).some(Boolean),
};

// The agents left after the search (words in name or id, any order), tag, owner and status. An agent whose draft isn't
// read yet is left out only by a filter that needs its meta; `unknown` counts those so the screen can say so.
export function filterBots(bots, { query = '', tag = '', owner = '', status = 'all', attention = status === 'attention' } = {}, meta = {}) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const matched = bots.filter((bot) => {
    if (words.length) {
      const text = `${bot.name || ''} ${bot.id}`.toLowerCase();
      if (!words.every((w) => text.includes(w))) return false;
    }
    const m = meta[bot.id];
    if (tag && !(m?.tags || []).includes(tag)) return false;
    if (owner && m?.owner !== owner) return false;
    if (attention && !needsAttention(m?.health)) return false;
    if (IN_STATUS[status] && !IN_STATUS[status](bot)) return false;
    return true;
  });
  const unknown = tag || owner || attention ? bots.filter((bot) => !meta[bot.id]).length : 0;
  return { matched, unknown };
}

export function paginate(items, page = 1, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * size;
  return {
    rows: items.slice(start, start + size),
    page: current,
    pages,
    from: items.length ? start + 1 : 0,
    to: Math.min(items.length, start + size),
    total: items.length,
  };
}

export const sortBots = (bots, sort) => [...bots].sort((SORTS[sort] || SORTS.recent).compare);

// The tags and owner of an agent, from its draft's `meta`.
export function metaOfConfig(config) {
  const tags = Array.isArray(config?.meta?.tags) ? config.meta.tags.filter((t) => typeof t === 'string' && t) : [];
  const owner = typeof config?.meta?.owner === 'string' ? config.meta.owner : '';
  return { tags, owner };
}
