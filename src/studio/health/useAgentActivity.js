import { useEffect, useState } from 'react';
import { loadCalls } from '../insights/callData.js';

const DAY = 24 * 3600 * 1000;
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

// Each agent's calls per day over the last `days` days (oldest first, today last), from the list of its calls. Pure.
export function dailyCalls(calls, botIds, { nowMs = Date.now(), days = 7 } = {}) {
  const out = {};
  botIds.forEach((id) => {
    out[id] = { total: 0, series: Array.from({ length: days }, (_, i) => ({ day: dayKey(nowMs - (days - 1 - i) * DAY), calls: 0 })) };
  });
  const since = nowMs - days * DAY;
  (calls || []).forEach((c) => {
    const row = out[c.bot];
    const at = Date.parse(c.started_at);
    if (!row || Number.isNaN(at) || at < since) return;
    const slot = row.series.find((d) => d.day === dayKey(at));
    if (!slot) return;
    slot.calls += 1;
    row.total += 1;
  });
  return out;
}

// For a list of agents: how many calls each had in the last `days` days, day by day. It only lists calls (no records), a few agents at a time, and
// reads again when the agents shown change. { byBot: { id: { total, series } }, loading }
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
    loadCalls(ids, { sinceMs: nowMs - days * DAY, maxPages: 3, signal: controller.signal })
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
