import { describe, expect, it } from 'vitest';
import { OWN_ORDER, arrange, moveInOrder, neighbour } from './agentOrder';
import type { ListItem } from './agentList';

// The Agents list as the person arranges it: pinned first whatever the sort, and their own order, moved one agent at a
// time without a pinned agent ever going below one that isn't.
const item = (id: string, savedAt: string): ListItem => ({ id, name: id[0].toUpperCase() + id.slice(1), savedAt, deployed: {} });
const items = [item('bravo', '2026-10-03'), item('alpha', '2026-10-01'), item('delta', '2026-10-04'), item('charlie', '2026-10-02')];
const idsOf = (list: { id: string }[]) => list.map((b) => b.id);

describe('agent order (ported from Weave React agentOrder)', () => {
  it('pinned agents come first in every sort, each group in the sort chosen', () => {
    expect(idsOf(arrange(items, { sort: 'name', pinned: ['delta'] }))).toEqual(['delta', 'alpha', 'bravo', 'charlie']);
    expect(idsOf(arrange(items, { sort: 'recent', pinned: ['alpha', 'charlie'] }))).toEqual(['charlie', 'alpha', 'delta', 'bravo']);
  });

  it('the own order: placed agents as placed, any not placed yet after them by name', () => {
    expect(idsOf(arrange(items, { sort: OWN_ORDER, order: ['delta', 'bravo'] }))).toEqual(['delta', 'bravo', 'alpha', 'charlie']);
    expect(idsOf(arrange(items, { sort: OWN_ORDER, order: [], pinned: ['charlie'] }))).toEqual(['charlie', 'alpha', 'bravo', 'delta']);
  });

  it('a move puts the agent where the other one was, keeps every other agent, and stays inside its group', () => {
    const all = arrange(items, { sort: OWN_ORDER, order: ['alpha', 'bravo', 'charlie', 'delta'], pinned: ['alpha'] });
    expect(moveInOrder(all, ['alpha'], 'delta', 'bravo')).toEqual(['alpha', 'delta', 'bravo', 'charlie']);
    expect(moveInOrder(all, ['alpha'], 'bravo', 'alpha')).toBeNull();
    expect(moveInOrder(all, ['alpha'], 'bravo', 'bravo')).toBeNull();
    expect(moveInOrder(all, ['alpha'], 'nobody', 'bravo')).toBeNull();
  });

  it('Move up / Move down find the neighbour in the same group only', () => {
    const shown = arrange(items, { sort: OWN_ORDER, order: ['alpha', 'bravo', 'charlie', 'delta'], pinned: ['alpha'] });
    expect(neighbour(shown, ['alpha'], 'charlie', -1)).toBe('bravo');
    expect(neighbour(shown, ['alpha'], 'charlie', 1)).toBe('delta');
    expect(neighbour(shown, ['alpha'], 'bravo', -1)).toBeNull();
    expect(neighbour(shown, ['alpha'], 'delta', 1)).toBeNull();
    expect(neighbour(shown, ['alpha'], 'nobody', 1)).toBeNull();
  });
});
