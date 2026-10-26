import { useMemo } from 'react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../api/client.ts';
import { keys } from '../../api/queryClient.ts';
import type { CallSummary } from '../../api/types.ts';
import { fewAtATime } from '../insights/callData.ts';
import { ALL_AGENTS_LIMIT, PER_AGENT_PAGE, callsWithoutGaps, queryFor } from './callModel.js';

// Loads the calls of one agent, or of every agent (one request each, a few at a time, because the API lists calls per
// agent), and pages through them. Reading calls never changes anything. A failure for one agent is kept next to the
// others' calls, not allowed to hide them. Read through the shared cache (an infinite query): a page of the list is one
// round of asking every agent that has more, so "Load more" asks only those; changing a filter keeps the last list on
// screen, dimmed, until the new one is in; the list opened again shows at once and refreshes.
const AT_A_TIME = 4;

type AgentPage = { id: string; calls: CallSummary[]; next: string | null; error: string | null };
type Round = Record<string, AgentPage>;
type Cursors = Record<string, string> | null;
type Filters = { range?: string; caller?: string; channel?: string; status?: string };

// callModel.js's queryFor, with the types TypeScript can't read from its defaults
const listQuery = queryFor as (filters: Filters, page: { limit?: number; cursor?: string }) => Parameters<typeof api.listCalls>[1];

const fetchPage = (id: string, filters: Filters, cursor: string | undefined, signal: AbortSignal): Promise<AgentPage> =>
  api
    .listCalls(id, listQuery(filters, { limit: PER_AGENT_PAGE, cursor }), { signal })
    .then((answer) => ({ id, calls: Array.isArray(answer?.calls) ? answer.calls : [], next: answer?.next || null, error: null }))
    .catch((error) => {
      if (signal.aborted) throw error;
      return { id, calls: [], next: null, error: (error as Error)?.message || 'This agent’s calls could not be read.' };
    });

// each agent's newest page so far: the one whose `next` says whether it has more, and whose error (if any) is the one to show
function latestOf(rounds: Round[]): Round {
  const latest: Round = {};
  rounds.forEach((round) => Object.values(round).forEach((page) => (latest[page.id] = page)));
  return latest;
}

export function useCalls({ bots = [], botId = '', filters, refreshMs = 0 }: { bots?: { id: string }[]; botId?: string; filters: Filters; refreshMs?: number }) {
  const targetsKey = botId
    ? botId
    : bots
        .slice(0, ALL_AGENTS_LIMIT)
        .map((b) => b.id)
        .join(',');
  const filtersKey = JSON.stringify(filters);
  const query = useInfiniteQuery({
    queryKey: keys.callList(targetsKey, filtersKey),
    initialPageParam: null as Cursors,
    queryFn: async ({ pageParam, signal }): Promise<Round> => {
      const targets = targetsKey ? targetsKey.split(',') : [];
      // the first round asks every agent; a later one only those with more, from where each stopped
      const asked = pageParam ? targets.filter((id) => pageParam[id]) : targets;
      const pages = await fewAtATime(asked, AT_A_TIME, (id) => fetchPage(id, filters, pageParam?.[id], signal));
      return Object.fromEntries(pages.map((p) => [p.id, p]));
    },
    getNextPageParam: (_last, rounds): Cursors | undefined => {
      const cursors = Object.fromEntries(
        Object.values(latestOf(rounds))
          .filter((p) => p.next)
          .map((p) => [p.id, p.next as string]),
      );
      return Object.keys(cursors).length ? cursors : undefined;
    },
    placeholderData: keepPreviousData,
    refetchInterval: refreshMs || false,
    staleTime: 15_000,
  });
  const rounds = useMemo(() => query.data?.pages || [], [query.data]);
  // with no gap where an agent still has older calls to send (callModel.js)
  const calls = useMemo(
    () =>
      callsWithoutGaps(
        rounds.flatMap((round) => Object.values(round)),
        Object.values(latestOf(rounds))
          .filter((p) => p.next)
          .map((p) => p.id),
      ),
    [rounds],
  );
  const errors = useMemo(
    () =>
      Object.values(latestOf(rounds))
        .filter((p) => p.error)
        .map((p) => ({ botId: p.id, message: p.error as string })),
    [rounds],
  );
  return {
    calls,
    loading: query.isFetching && !query.data,
    // the last list is shown while another is read (a filter changed); a refresh of the same list (Refresh, every 10 s) only updates it in place
    refreshing: query.isPlaceholderData,
    busy: query.isFetching && !query.isFetchingNextPage,
    loadingMore: query.isFetchingNextPage,
    errors,
    hasMore: !!query.hasNextPage,
    loadMore: () => {
      query.fetchNextPage();
    },
    reload: () => {
      query.refetch();
    },
    skipped: Math.max(0, (botId ? 0 : bots.length) - (targetsKey ? targetsKey.split(',').length : 0)),
  };
}
