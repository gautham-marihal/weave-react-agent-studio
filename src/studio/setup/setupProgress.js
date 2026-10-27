import { useCallback, useSyncExternalStore } from 'react';

// Where a person is in an agent's setup, kept in this browser per agent: the step, whether they tried the agent, and
// whether setup is finished. "Continue setup" opens where they stopped; with no storage the setup just starts again.

const key = (botId) => `weave_setup_${botId}`;
const listeners = new Set();
const cache = new Map();
const EMPTY = Object.freeze({ step: '', tried: false, finished: false });

function read(botId) {
  if (!botId) return EMPTY;
  if (cache.has(botId)) return cache.get(botId);
  let value = EMPTY;
  try {
    const raw = JSON.parse(localStorage.getItem(key(botId)) || 'null');
    if (raw && typeof raw === 'object') value = { step: String(raw.step || ''), tried: raw.tried === true, finished: raw.finished === true, known: true };
  } catch {
    value = EMPTY;
  }
  cache.set(botId, value);
  return value;
}

export function saveProgress(botId, patch) {
  if (!botId) return;
  const next = { ...read(botId), ...patch, known: true };
  cache.set(botId, next);
  try {
    localStorage.setItem(key(botId), JSON.stringify({ step: next.step, tried: next.tried, finished: next.finished }));
  } catch {
    /* kept for this visit only */
  }
  listeners.forEach((listener) => listener());
}

// An agent made with the setup starts at its second step (the first, name and starting point, is the create dialog).
export const startSetup = (botId) => saveProgress(botId, { step: 'purpose', tried: false, finished: false });

// Whether an agent's next steps are done in the setup: while it is being set up here, or when it was never published.
// A published agent that wasn't set up here keeps its own pages for each step.
//   summary: the agent as listed (null while loading, which reads as no, so nothing jumps)
export const inSetup = (progress, summary) => !progress?.finished && (!!progress?.known || (!!summary && !summary.latest_version));

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// { step, tried, finished, known } for one agent, and a setter. `known`: setup was started for it in this browser.
export function useSetupProgress(botId) {
  const value = useSyncExternalStore(
    subscribe,
    () => read(botId),
    () => EMPTY,
  );
  const update = useCallback((patch) => saveProgress(botId, patch), [botId]);
  return [value, update];
}
