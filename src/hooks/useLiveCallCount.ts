import { api } from '../api/client';
import { fewAtATime } from '../models/callData';
import { useReading } from './useMonitoringReading';

// How many calls are in progress across some agents, for Home's tile (read-only; the Live page follows each call).
// Asks again every `everyMs` while the tab is on screen, and at once when it comes back.

/** In-progress calls across the agents; an agent whose calls can't be read is counted in `errors`. */
export async function countLive(
  ids: string[],
  list: (id: string) => Promise<{ calls?: { status?: string }[] } | null | undefined>,
): Promise<{ count: number; errors: number }> {
  let errors = 0;
  const counts = await fewAtATime(ids, 4, async (id) => {
    try {
      const answer = await list(id);
      // a server that does not filter by status still gives the right number
      return (Array.isArray(answer?.calls) ? answer.calls : []).filter((c) => c && c.status === 'in_progress').length;
    } catch {
      errors += 1;
      return 0;
    }
  });
  return { count: counts.reduce((a, b) => a + b, 0), errors };
}

export function useLiveCallCount(bots: { id: string }[], { everyMs = 20_000 }: { everyMs?: number } = {}) {
  const idKey = bots.map((b) => b.id).join(',');
  const reading = useReading(
    idKey ? `live-count|${idKey}` : '',
    (signal) => countLive(idKey.split(','), (id) => api.listCalls(id, { status: 'in_progress', limit: 100 }, { signal })),
    { staleMs: everyMs / 2, everyMs },
  );
  if (!idKey) return { count: 0 as number | null, errors: 0 };
  return { count: reading.data ? reading.data.count : null, errors: reading.data?.errors ?? 0 };
}
