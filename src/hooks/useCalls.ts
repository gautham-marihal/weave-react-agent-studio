import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { CallSummaryItem } from '../api/types';
import { ALL_AGENTS_LIMIT, PER_AGENT_PAGE, callsWithoutGaps, latestPages, queryFor, type AgentPage, type CallFilters } from '../models/calls';

// One agent's calls, or every agent's (the API lists calls per agent: one request each, a few at a time), paged by the
// server's cursor. A round asks the agents; "Load more" asks only those with more, from where each stopped. One
// agent's failure shows beside the others' calls, never hiding them. A filter change keeps the last list on screen
// (`refreshing`, so the page can dim it) until the new one arrives.

const AT_A_TIME = 4;
type Round = Record<string, AgentPage>;

async function fewAtATime<T, R>(items: T[], n: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += n) out.push(...(await Promise.all(items.slice(i, i + n).map(work))));
  return out;
}

const fetchPage = (id: string, filters: CallFilters, cursor: string | undefined, signal: AbortSignal): Promise<AgentPage> =>
  api
    .listCalls(id, { ...queryFor(filters, { limit: PER_AGENT_PAGE, cursor }) }, { signal })
    .then((answer) => ({ id, calls: Array.isArray(answer?.calls) ? answer.calls : [], next: answer?.next || null, error: null }))
    .catch((error: unknown) => {
      if (signal.aborted) throw error;
      return { id, calls: [], next: null, error: (error as Error)?.message || 'This agent’s calls could not be read.' };
    });

export interface UseCalls {
  /** Every call so far, newest first, with each call's agent in `bot`. */
  calls: CallSummaryItem[];
  /** The first list is being read and there is nothing to show yet. */
  loading: boolean;
  /** A new list is being read while the last one stays on screen. */
  refreshing: boolean;
  loadingMore: boolean;
  errors: Array<{ botId: string; message: string }>;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
  /** Agents left out of "All agents" (past ALL_AGENTS_LIMIT). */
  skipped: number;
}

export function useCalls({ agentIds, agentId = '', filters }: { agentIds: string[]; agentId?: string; filters: CallFilters }): UseCalls {
  const targets = useMemo(() => (agentId ? [agentId] : agentIds.slice(0, ALL_AGENTS_LIMIT)), [agentId, agentIds]);
  const targetsKey = targets.join(',');
  const filtersKey = JSON.stringify(filters);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloads, setReloads] = useState(0);
  const moreRef = useRef<AbortController | null>(null);
  const wantedKey = `${targetsKey}|${filtersKey}`;

  // the first round, again whenever the agents or the filters change (or on reload)
  useEffect(() => {
    const ids = targetsKey ? targetsKey.split(',') : [];
    const wanted: CallFilters = JSON.parse(filtersKey);
    const controller = new AbortController();
    moreRef.current?.abort();
    setLoadingMore(false);
    setBusy(true);
    fewAtATime(ids, AT_A_TIME, (id) => fetchPage(id, wanted, undefined, controller.signal))
      .then((pages) => {
        if (controller.signal.aborted) return;
        setRounds([Object.fromEntries(pages.map((p) => [p.id, p]))]);
        setShownKey(`${targetsKey}|${filtersKey}`);
        setBusy(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [targetsKey, filtersKey, reloads]);

  const latest = useMemo(() => latestPages(rounds), [rounds]);
  const withMore = useMemo(() => Object.values(latest).filter((p) => p.next), [latest]);

  const loadMore = useCallback(() => {
    if (!withMore.length || loadingMore) return;
    const controller = new AbortController();
    moreRef.current = controller;
    setLoadingMore(true);
    const wanted: CallFilters = JSON.parse(filtersKey);
    fewAtATime(withMore, AT_A_TIME, (p) => fetchPage(p.id, wanted, p.next ?? undefined, controller.signal))
      .then((pages) => {
        if (controller.signal.aborted) return;
        setRounds((old) => [...old, Object.fromEntries(pages.map((p) => [p.id, p]))]);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setLoadingMore(false);
      });
  }, [withMore, loadingMore, filtersKey]);

  // with no gap where an agent still has older calls to send
  const calls = useMemo(
    () =>
      callsWithoutGaps(
        rounds.flatMap((round) => Object.values(round)),
        withMore.map((p) => p.id)
      ),
    [rounds, withMore]
  );
  const errors = useMemo(
    () => Object.values(latest).filter((p) => p.error).map((p) => ({ botId: p.id, message: p.error as string })),
    [latest]
  );

  return {
    calls,
    loading: busy && shownKey === null,
    refreshing: busy && shownKey !== null,
    loadingMore,
    errors,
    hasMore: withMore.length > 0 && shownKey === wantedKey,
    loadMore,
    reload: () => setReloads((n) => n + 1),
    skipped: agentId ? 0 : Math.max(0, agentIds.length - targets.length),
  };
}
