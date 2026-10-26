import { useCallback, useEffect, useState } from 'react';
import { loadCalls, newestFirst, readFinishedCall } from '../insights/callData.js';
import { sampleOf, spreadPick } from './speedModel.js';

// The calls the Speed page rests on, and only reads: each agent's calls in the period (to count them) and the records of PER_AGENT of its finished
// ones, spread over the days of the period (their timings). Monitoring and Home read the same ones (useMonitoring), so the pages say the same.

export const PER_AGENT = 40;

async function inChunks(items, size, work) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  return out;
}

// perAgent: how many of each agent's newest calls are read for their timings (fewer for the number on Home).
export function useSpeedData(bots, { days = 14, perAgent = PER_AGENT } = {}) {
  const [state, setState] = useState({ loading: true, errors: [], samples: [], totals: {}, failed: 0, at: null });
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const key = bots.map((b) => b.id).join(',');

  useEffect(() => {
    if (!key) {
      setState((s) => ({ ...s, loading: false }));
      return undefined;
    }
    const controller = new AbortController();
    const { signal } = controller;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      const ids = key.split(',');
      const nowMs = Date.now();
      const { calls, errors } = await loadCalls(ids, { sinceMs: nowMs - days * 24 * 3600 * 1000, maxPages: 5, signal });
      if (signal.aborted) return;
      const finished = newestFirst(calls.filter((c) => c.status !== 'in_progress'));
      const totals = {};
      finished.forEach((c) => {
        totals[c.bot] = (totals[c.bot] || 0) + 1;
      });
      const wanted = ids.flatMap((id) =>
        spreadPick(
          finished.filter((c) => c.bot === id),
          perAgent,
        ),
      );
      let failed = 0;
      const samples = (
        await inChunks(wanted, 4, async (c) => {
          try {
            return sampleOf(c, await readFinishedCall(c, { signal }));
          } catch {
            if (!signal.aborted) failed += 1;
            return null;
          }
        })
      ).filter(Boolean);
      if (signal.aborted) return;
      setState({ loading: false, errors, samples, totals, failed, at: new Date().toISOString() });
    })().catch((e) => {
      if (!signal.aborted) setState((s) => ({ ...s, loading: false, errors: [{ botId: '', message: e?.message || 'The calls could not be read.' }] }));
    });
    return () => controller.abort();
  }, [key, days, nonce, perAgent]);

  return { ...state, refresh };
}
