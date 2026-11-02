import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The stores read this browser's storage when first asked, so the storage has to exist first.
const store = new Map<string, string>([
  ['weave_hidden_agents', JSON.stringify(['a', 'b'])],
  ['weave_dismissed_agents', JSON.stringify(['old', 7])],
]);
beforeAll(() => {
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
});
afterAll(() => vi.unstubAllGlobals());

const saved = (key: string) => JSON.parse(store.get(key) ?? 'null');

describe('removed from my list (ported from Weave React dismissedAgents)', () => {
  it('deleting from the removed list is remembered in this browser, once per agent, and keeps what was already deleted', async () => {
    const { dismissAgent } = await import('./manage');
    dismissAgent('a');
    dismissAgent('a');
    expect(saved('weave_dismissed_agents')).toEqual(['old', 'a']);
    expect(saved('weave_hidden_agents')).toEqual(['a', 'b']);
  });

  it('“Bring them back” undoes every delete and returns the agents to the removed list (still hidden)', async () => {
    const { undoDismissed } = await import('./manage');
    undoDismissed();
    expect(saved('weave_dismissed_agents')).toEqual([]);
    expect(saved('weave_hidden_agents')).toEqual(['a', 'b']);
  });

  it('restoring and removing still work beside it', async () => {
    const { hideAgent, restoreAgent } = await import('./manage');
    restoreAgent('a');
    hideAgent('c');
    hideAgent('c');
    expect(saved('weave_hidden_agents')).toEqual(['b', 'c']);
  });

  it('bringing back deleted agents can be limited to the ones the page shows', async () => {
    const { dismissAgent, undoDismissed } = await import('./manage');
    dismissAgent('x');
    dismissAgent('y');
    dismissAgent('z');
    undoDismissed(['x', 'z']);
    expect(saved('weave_dismissed_agents')).toEqual(['y']);
    undoDismissed();
    expect(saved('weave_dismissed_agents')).toEqual([]);
  });

  it('a change made in another tab is read again', async () => {
    const { hiddenStore } = await import('./manage');
    store.set('weave_hidden_agents', JSON.stringify(['from-another-tab']));
    hiddenStore.reload();
    expect(hiddenStore.get()).toEqual(['from-another-tab']);
  });
});
