import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.ts';
import { keys } from '../../api/queryClient.ts';

const AT_A_TIME = 4;

// How many calls are in progress across the agents, and which, for Home (read-only; the Live page follows each call).
// Re-asks every `everyMs` while the tab is on screen, and at once when it comes back.
//   { count, calls: [{ bot, id, started_at, channel }], loading, errors }
export type LiveSummary = { bot: string; id: string; started_at?: string; channel?: unknown };
async function countLive(ids: string[], signal: AbortSignal): Promise<{ count: number; errors: number; calls: LiveSummary[] }> {
  let count = 0;
  let errors = 0;
  const calls: LiveSummary[] = [];
  for (let i = 0; i < ids.length; i += AT_A_TIME) {
    await Promise.all(
      ids.slice(i, i + AT_A_TIME).map(async (id) => {
        try {
          const answer = await api.listCalls(id, { status: 'in_progress', limit: 100 }, { signal });
          // a server that does not filter by status still gives the right number
          const going = (Array.isArray(answer?.calls) ? answer.calls : []).filter((c) => c && c.status === 'in_progress');
          count += going.length;
          going.forEach((c) => calls.push({ bot: c.bot || id, id: c.id, started_at: c.started_at, channel: c.channel }));
        } catch (e) {
          if (signal.aborted) throw e;
          errors += 1;
        }
      }),
    );
  }
  return { count, errors, calls };
}

export function useLiveCount(bots: { id: string }[] | null | undefined, { everyMs = 20000 }: { everyMs?: number } = {}) {
  const key = (bots || []).map((b) => b.id).join(',');
  const query = useQuery({
    queryKey: keys.liveCount(key),
    queryFn: ({ signal }) => countLive(key.split(','), signal),
    enabled: !!key,
    staleTime: everyMs / 2,
    refetchInterval: everyMs,
    // not while the tab is hidden; at once when it comes back
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  if (!key) return { count: 0, calls: [] as LiveSummary[], loading: false, errors: 0 };
  return { count: query.data ? query.data.count : null, calls: query.data?.calls || [], loading: !query.data, errors: query.data?.errors || 0 };
}
