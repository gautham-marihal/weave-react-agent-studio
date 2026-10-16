// The Agents list at scale: an organisation can have hundreds of agents, so the list is searched, filtered by tag, owner and "needs
// attention", sorted and shown a page at a time. Pure: no network, no DOM.
//
// `meta` is what is known about each agent beyond the list the API gives: its tags and owner (from its draft's `meta`), and its health. It is
// read lazily (see health/useAgentHealth.js), so a filter by tag only covers the agents whose draft has been read, and says so.

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

// What is left after the search (words in the name or id, any order), the tag, the owner and "needs attention". An agent whose draft hasn't
// been read yet has no tags or health: it is left out only by a filter that needs them, and `unknown` counts them so the screen can say so.
export function filterBots(bots, { query = '', tag = '', owner = '', attention = false } = {}, meta = {}) {
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
