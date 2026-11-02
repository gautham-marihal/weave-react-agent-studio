import { describe, expect, it } from 'vitest';
import { countLive } from './useLiveCallCount';

// Home's "Going on now" tile: calls in progress across the agents.
describe('calls going on now', () => {
  it('counts calls in progress across agents, even from a server that does not filter by status', async () => {
    const lists: Record<string, { status: string }[]> = {
      a: [{ status: 'in_progress' }, { status: 'in_progress' }],
      b: [{ status: 'in_progress' }, { status: 'ended' }],
      c: [],
    };
    expect(await countLive(['a', 'b', 'c'], async (id) => ({ calls: lists[id] }))).toEqual({ count: 3, errors: 0 });
  });

  it('counts the others when one agent’s calls can’t be read, and says how many could not', async () => {
    const answer = await countLive(['a', 'broken'], async (id) => {
      if (id === 'broken') throw new Error('HTTP 503');
      return { calls: [{ status: 'in_progress' }] };
    });
    expect(answer).toEqual({ count: 1, errors: 1 });
    expect(await countLive([], async () => ({ calls: [] }))).toEqual({ count: 0, errors: 0 });
  });
});
