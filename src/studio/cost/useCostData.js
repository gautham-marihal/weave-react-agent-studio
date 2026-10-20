import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { loadCalls, newestFirst } from '../insights/callData.js';
import { modelsOf, sampleOf } from './costModel.js';

// The calls the Cost and speed page rests on, and only reads: each agent's calls in the period (to count them), the records of its newest PER_AGENT
// finished ones (their model use and timings), and, on the workspace page, each agent's draft (which speech models it uses). A finished call does not
// change, so its records are read once per page load.

export const PER_AGENT = 40;
const pages = new Map(); // 'bot/id' → GET /calls/{id}

async function inChunks(items, size, work) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  return out;
}

// configs: { botId: config } when they are known (an agent's own page passes its draft, unsaved edits included); otherwise each draft is read.
// perAgent: how many of each agent's newest calls are read for their model use (fewer for the estimate on Home).
export function useCostData(bots, { days = 14, configs = null, perAgent = PER_AGENT } = {}) {
  const [state, setState] = useState({ loading: true, errors: [], samples: [], totals: {}, modelsByBot: {}, failed: 0, at: null });
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const key = bots.map((b) => b.id).join(',');
  const configKey = configs ? JSON.stringify(Object.fromEntries(Object.entries(configs).map(([id, c]) => [id, modelsOf(c)]))) : '';

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
      const wanted = ids.flatMap((id) => finished.filter((c) => c.bot === id).slice(0, perAgent));
      let failed = 0;
      const samples = (
        await inChunks(wanted, 4, async (c) => {
          const k = `${c.bot}/${c.id}`;
          try {
            if (!pages.has(k)) pages.set(k, await api.getCall(c.bot, c.id, { limit: 500 }, { signal }));
            return sampleOf(c, pages.get(k));
          } catch {
            if (!signal.aborted) failed += 1;
            return null;
          }
        })
      ).filter(Boolean);
      if (signal.aborted) return;
      const modelsByBot = {};
      if (configs) Object.entries(configs).forEach(([id, config]) => (modelsByBot[id] = modelsOf(config)));
      else
        await inChunks(ids, 4, async (id) => {
          try {
            const draft = await api.getDraft(id, { signal });
            modelsByBot[id] = modelsOf(draft?.config);
          } catch {
            modelsByBot[id] = modelsOf(null);
          }
        });
      if (signal.aborted) return;
      setState({ loading: false, errors, samples, totals, modelsByBot, failed, at: new Date().toISOString() });
    })().catch((e) => {
      if (!signal.aborted) setState((s) => ({ ...s, loading: false, errors: [{ botId: '', message: e?.message || 'The calls could not be read.' }] }));
    });
    return () => controller.abort();
  }, [key, days, nonce, configKey, perAgent]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...state, refresh };
}
