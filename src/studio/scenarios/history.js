// The outcomes of scenario runs, kept in this browser per agent (the API has nowhere to record them yet). The newest first, a few dozen at
// most, each with its transcripts trimmed so the store stays small. A run says which runner made it, and a simulated one is never
// presented as a real result.
// Pure apart from `storage` (localStorage in the browser, anything with getItem/setItem in tests).

const keyFor = (botId) => `weave_scenario_runs:${botId}`;
export const MAX_RUNS = 25;
const trim = (run) => ({ ...run, scenarios: run.scenarios.map((s) => ({ ...s, transcript: (s.transcript || []).slice(0, 40).map((m) => ({ ...m, text: String(m.text || '').slice(0, 400) })) })) });

const defaultStorage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

export function loadRuns(botId, storage = defaultStorage()) {
  try { const raw = storage?.getItem(keyFor(botId)); const list = raw ? JSON.parse(raw) : []; return Array.isArray(list) ? list : []; } catch { return []; }
}

export function saveRun(botId, run, storage = defaultStorage()) {
  const runs = [trim(run), ...loadRuns(botId, storage)].slice(0, MAX_RUNS);
  try { storage?.setItem(keyFor(botId), JSON.stringify(runs)); } catch { /* storage full or unavailable: the run is still shown this time */ }
  return runs;
}

export function clearRuns(botId, storage = defaultStorage()) {
  try { storage?.removeItem(keyFor(botId)); } catch { /* nothing to do */ }
  return [];
}

// The latest status of each scenario id across the saved runs (newest first), for the chip on its card.
export function latestStatuses(runs) {
  const out = {};
  [...(runs || [])].reverse().forEach((run) => run.scenarios.forEach((s) => { out[s.id] = { status: s.status, ranAt: run.ranAt, runner: run.runner }; }));
  return out;
}
