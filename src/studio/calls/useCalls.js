import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { ALL_AGENTS_LIMIT, PER_AGENT_PAGE, mergeCalls, queryFor } from './callModel.js';

// Loads the calls of one agent, or of every agent (one request each, a few at a time, because the API lists calls per agent), and pages
// through them. Reading calls never changes anything. A failure for one agent is kept next to the others' calls, not allowed to hide them.
const AT_A_TIME = 4;

async function inChunks(items, size, work) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  return out;
}

export function useCalls({ bots = [], botId = '', filters, refreshMs = 0 }) {
  const asked = useMemo(() => (botId ? [botId] : bots.slice(0, ALL_AGENTS_LIMIT).map((b) => b.id)), [botId, bots]);
  const targetsKey = asked.join(',');
  // the same list while the ids are the same, so a parent that makes a new array each render does not make the calls load again
  const targets = useMemo(() => (targetsKey ? targetsKey.split(',') : []), [targetsKey]);
  const filtersKey = JSON.stringify(filters);
  const [pages, setPages] = useState({}); // botId -> { calls, next, error }
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const generation = useRef(0);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  const fetchPage = useCallback(
    (id, cursor) =>
      api
        .listCalls(id, queryFor(filters, { limit: PER_AGENT_PAGE, cursor }))
        .then((answer) => ({ id, calls: Array.isArray(answer?.calls) ? answer.calls : [], next: answer?.next || null, error: null }))
        .catch((error) => ({ id, calls: [], next: null, error: error?.message || 'This agent’s calls could not be read.' })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtersKey],
  );

  const load = useCallback(
    async (quiet = false) => {
      generation.current += 1;
      const mine = generation.current;
      if (!quiet) setLoading(true);
      const results = await inChunks(targets, AT_A_TIME, (id) => fetchPage(id));
      if (mine !== generation.current) return;
      setPages(Object.fromEntries(results.map((r) => [r.id, r])));
      setLoading(false);
    },
    [targets, fetchPage],
  );

  useEffect(() => {
    load();
    return () => {
      generation.current += 1;
    };
  }, [load]);
  useEffect(() => {
    if (!refreshMs) return undefined;
    const timer = setInterval(() => load(true), refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs, load]);

  const loadMore = useCallback(async () => {
    const mine = generation.current;
    setMore(true);
    const current = pagesRef.current;
    const wanted = targets.filter((id) => current[id]?.next);
    const results = await inChunks(wanted, AT_A_TIME, (id) => fetchPage(id, current[id].next));
    if (mine !== generation.current) return;
    setPages((old) => {
      const next = { ...old };
      results.forEach((r) => {
        next[r.id] = { ...r, calls: [...(old[r.id]?.calls || []), ...r.calls] };
      });
      return next;
    });
    setMore(false);
  }, [targets, fetchPage]);

  const calls = useMemo(() => mergeCalls(Object.values(pages)), [pages]);
  const errors = useMemo(
    () =>
      Object.values(pages)
        .filter((p) => p.error)
        .map((p) => ({ botId: p.id, message: p.error })),
    [pages],
  );
  const hasMore = Object.values(pages).some((p) => p.next);
  return {
    calls,
    loading,
    loadingMore: more,
    errors,
    hasMore,
    loadMore,
    reload: () => load(),
    skipped: Math.max(0, (botId ? 0 : bots.length) - targets.length),
  };
}
