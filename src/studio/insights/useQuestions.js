import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCalls, loadFacts, newestFirst } from './callData.js';
import { collectQuestions, groupQuestions } from './questionsModel.js';

// The questions one agent's callers asked that it did not answer, from its calls of the last few days. Only reads: the list of calls, then the record of
// each finished one (the newest MAX_CALLS of them). A finished call does not change, so its record is read once per page load.

export const MAX_CALLS = 150;
const factsCache = {};
const lastResult = new Map(); // `${botId}|${days}` → the last result, shown at once on coming back while it is read again

export function useQuestions(botId, { days = 14, nowMs } = {}) {
  const [state, setState] = useState(() => ({
    ...(lastResult.get(`${botId}|${days}`) || { error: '', groups: [], read: 0, total: 0, truncated: false, failed: 0, at: null }),
    loading: true,
  }));
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const nowRef = useRef(nowMs);
  nowRef.current = nowMs;

  useEffect(() => {
    if (!botId) return undefined;
    const controller = new AbortController();
    const cacheKey = `${botId}|${days}`;
    setState((s) => ({ ...(lastResult.get(cacheKey) || { ...s, groups: [], read: 0, total: 0, at: null }), loading: true, error: '' }));
    (async () => {
      const now = nowRef.current ?? Date.now();
      const { calls, errors, truncated } = await loadCalls([botId], { sinceMs: now - days * 24 * 3600 * 1000, maxPages: 5, signal: controller.signal });
      if (controller.signal.aborted) return;
      const finished = newestFirst(calls.filter((c) => c.status !== 'in_progress'));
      const wanted = finished.slice(0, MAX_CALLS);
      const { facts, failed } = await loadFacts(wanted, { known: factsCache, signal: controller.signal });
      if (controller.signal.aborted) return;
      Object.assign(factsCache, facts);
      const result = {
        error: errors[0]?.message || '',
        groups: groupQuestions(collectQuestions(wanted, facts)),
        read: wanted.length,
        total: finished.length,
        truncated: truncated || finished.length > wanted.length,
        failed,
        at: new Date().toISOString(),
      };
      lastResult.set(cacheKey, result);
      setState({ ...result, loading: false });
    })().catch((e) => {
      if (!controller.signal.aborted) setState((s) => ({ ...s, loading: false, error: e?.message || 'The calls could not be read.' }));
    });
    return () => controller.abort();
  }, [botId, days, nonce]);

  return { ...state, refresh };
}
