import { useEffect, useState } from 'react';
import { loadCalls } from '../insights/callData.ts';
import { localDay, periodOf } from '../format.js';

// Each agent's calls per day over the last `days` days (oldest first, today last), from the list of its calls. Pure.
function dailyCalls(calls, botIds, { nowMs = Date.now(), days = 7 } = {}) {
  const out = {};
  const period = periodOf(nowMs, days);
  botIds.forEach((id) => {
    out[id] = { total: 0, series: period.days.map((day) => ({ day, calls: 0 })) };
  });
  const since = period.startMs;
  (calls || []).forEach((c) => {
    const row = out[c.bot];
    const at = Date.parse(c.started_at);
    if (!row || Number.isNaN(at) || at < since) return;
    const slot = row.series.find((d) => d.day === localDay(at));
    if (!slot) return;
    slot.calls += 1;
    row.total += 1;
  });
  return out;
}

// Each agent's calls per day over the last `days` days. Lists calls only (no records), a few agents at a time, and
// reads again when the agents shown change. -> { byBot: { id: { total, series } }, loading }
export function useAgentActivity(bots, { days = 7 } = {}) {
  const [state, setState] = useState({ byBot: {}, loading: true });
  const key = (bots || []).map((b) => b.id).join(',');
  useEffect(() => {
    if (!key) {
      setState({ byBot: {}, loading: false });
      return undefined;
    }
    const controller = new AbortController();
    const ids = key.split(',');
    const nowMs = Date.now();
    setState((s) => ({ ...s, loading: true }));
    loadCalls(ids, { sinceMs: periodOf(nowMs, days).startMs, maxPages: 3, signal: controller.signal })
      .then(({ calls }) => {
        if (!controller.signal.aborted) setState({ byBot: dailyCalls(calls, ids, { nowMs, days }), loading: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ byBot: {}, loading: false });
      });
    return () => controller.abort();
  }, [key, days]);
  return state;
}
