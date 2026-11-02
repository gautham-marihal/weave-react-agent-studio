import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, STATUSES, collectFacets, filterAgents, metaOfConfig, paginate, sortItems, stageRank, statusCounts, type ListItem } from './agentList';

// 300 agents, the way a big organisation has them: a few teams, a few tags, most in development, some live.
const TEAMS = ['support', 'sales', 'billing', 'onboarding'];
const items: ListItem[] = Array.from({ length: 300 }, (_, i) => ({
  id: `agent-${String(i).padStart(3, '0')}`,
  name: `${['Care', 'Booking', 'Billing', 'Welcome'][i % 4]} agent ${i}`,
  savedAt: new Date(Date.UTC(2026, 9, 1) + i * 3600 * 1000).toISOString(),
  latestVersion: i % 3 === 0 ? `1.${i % 7}.0` : null,
  deployed: i % 10 === 0 ? { production: '1.0.0', development: '1.0.0' } : i % 3 === 0 ? { development: '1.0.0' } : {},
  attention: i % 9 === 0 || i % 5 === 0,
  meta: { tags: [TEAMS[i % 4], ...(i % 7 === 0 ? ['voice'] : [])], owner: `team-${i % 3}` },
}));

describe('the Agents list (ported from Weave React agentList)', () => {
  it('300 agents are searched by words in the name or id, in any order, and nothing is lost', () => {
    expect(filterAgents(items).matched).toHaveLength(300);
    expect(filterAgents(items, { query: 'agent 17' }).matched).toHaveLength(13);
    expect(filterAgents(items, { query: '17 agent' }).matched).toHaveLength(13);
    expect(filterAgents(items, { query: 'BILLING' }).matched).toHaveLength(75);
    expect(filterAgents(items, { query: 'agent-042' }).matched[0].id).toBe('agent-042');
    expect(filterAgents(items, { query: 'zzz' }).matched).toHaveLength(0);
  });

  it('tag and owner narrow the list, and agents whose draft was not read are counted, not silently dropped', () => {
    expect(filterAgents(items, { tag: 'voice' }).matched).toHaveLength(Math.ceil(300 / 7));
    expect(filterAgents(items, { owner: 'team-1' }).matched).toHaveLength(100);
    const both = filterAgents(items, { tag: 'support', owner: 'team-0' }).matched;
    expect(both.length).toBeGreaterThan(0);
    expect(both.every((b) => b.meta?.tags.includes('support') && b.meta.owner === 'team-0')).toBe(true);
    const partial = items.map((item, i) => (i < 100 ? item : { ...item, meta: null }));
    const result = filterAgents(partial, { tag: 'voice' });
    expect(result.unknown).toBe(200);
    expect(result.matched.every((b) => b.meta)).toBe(true);
    expect(filterAgents(partial, { query: 'agent 1' }).unknown).toBe(0);
  });

  it('the status filter: needs attention, draft only, published, live; draft + published cover every agent', () => {
    const count = (status: string) => filterAgents(items, { status }).matched.length;
    expect(Object.keys(STATUSES)).toEqual(['all', 'attention', 'draft', 'published', 'live']);
    expect(count('all')).toBe(300);
    expect(count('attention')).toBe(items.filter((b) => b.attention).length);
    expect(count('draft')).toBe(200);
    expect(count('published')).toBe(100);
    expect(count('live')).toBe(items.filter((_, i) => i % 10 === 0 || i % 3 === 0).length);
    expect(filterAgents(items, { status: 'live' }).unknown).toBe(0);
    const unchecked = items.map((item) => ({ ...item, attention: null }));
    expect(filterAgents(unchecked, { status: 'attention' }).unknown).toBe(300);
    expect(count('nonsense')).toBe(300);
  });

  it('the count beside each status filter follows the search', () => {
    const counts = statusCounts(items);
    expect(counts.all).toBe(300);
    expect(counts.draft + counts.published).toBe(300);
    const billing = statusCounts(items, { query: 'billing' });
    expect(billing.all).toBe(75);
    expect(billing.live).toBe(filterAgents(items, { query: 'billing', status: 'live' }).matched.length);
  });

  it('facets list each tag and owner with how many agents have it, the most common first', () => {
    const facets = collectFacets(items);
    expect(facets.tags.slice(0, 4).map((t) => t.value).sort()).toEqual(['billing', 'onboarding', 'sales', 'support']);
    expect(facets.tags.find((t) => t.value === 'support')?.count).toBe(75);
    expect(facets.tags.find((t) => t.value === 'voice')?.count).toBe(43);
    expect(facets.owners.map((o) => o.value).sort()).toEqual(['team-0', 'team-1', 'team-2']);
    expect(collectFacets(items.map((i) => ({ ...i, meta: null })))).toEqual({ tags: [], owners: [] });
  });

  it('sorting by name, recently edited, latest version and furthest along is stable and complete', () => {
    const byName = sortItems(items, 'name');
    expect(byName).toHaveLength(300);
    expect(byName.every((b, i, l) => i === 0 || l[i - 1].name.localeCompare(b.name, undefined, { sensitivity: 'base' }) <= 0)).toBe(true);
    expect(sortItems(items, 'recent')[0].id).toBe('agent-299');
    const furthest = sortItems(items, 'stage');
    expect(Object.keys(furthest[0].deployed)).toContain('production');
    expect(furthest[furthest.length - 1].latestVersion).toBeNull();
    expect(sortItems(items, 'version')[0].latestVersion).toBe('1.6.0');
    expect(items.slice(0, 2).map((b) => b.id)).toEqual(['agent-000', 'agent-001']);
    expect(sortItems(items, 'nonsense')[0].id).toBe('agent-299');
  });

  it('furthest along ranks production, staging, development, published, draft', () => {
    expect(stageRank({ deployed: { production: '1.0.0' }, latestVersion: '1.0.0' })).toBe(4);
    expect(stageRank({ deployed: { staging: '1.0.0' }, latestVersion: '1.0.0' })).toBe(3);
    expect(stageRank({ deployed: { development: '1.0.0' }, latestVersion: '1.0.0' })).toBe(2);
    expect(stageRank({ deployed: {}, latestVersion: '0.1.0' })).toBe(1);
    expect(stageRank({ deployed: {}, latestVersion: null })).toBe(0);
  });

  it('pages: 25 at a time, the last page is short, and a page past the end is the last one', () => {
    expect(PAGE_SIZE).toBe(25);
    const first = paginate(items, 1);
    expect([first.rows.length, first.page, first.pages, first.from, first.to, first.total]).toEqual([25, 1, 12, 1, 25, 300]);
    expect(paginate(items, 99).page).toBe(12);
    expect(paginate(items, 0).page).toBe(1);
    const short = paginate(items.slice(0, 60), 3);
    expect([short.rows.length, short.from, short.to]).toEqual([10, 51, 60]);
    expect(paginate([], 1)).toEqual({ rows: [], page: 1, pages: 1, from: 0, to: 0, total: 0 });
    const seen = new Set<string>();
    for (let p = 1; p <= 12; p += 1) paginate(items, p).rows.forEach((b) => seen.add(b.id));
    expect(seen.size).toBe(300);
  });

  it('300 agents are filtered, sorted and paged in a blink', () => {
    const started = performance.now();
    for (let i = 0; i < 100; i += 1) paginate(sortItems(filterAgents(items, { query: 'care', tag: 'support', status: i % 2 ? 'all' : 'attention' }).matched, 'name'), 2);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('tags and owner are read from the draft’s meta, and only what is really there', () => {
    expect(metaOfConfig({ meta: { tags: ['voice', '', 7, 'support'], owner: 'team-x' } })).toEqual({ tags: ['voice', 'support'], owner: 'team-x' });
    expect(metaOfConfig({ meta: {} })).toEqual({ tags: [], owner: '' });
    expect(metaOfConfig(null)).toEqual({ tags: [], owner: '' });
  });
});
