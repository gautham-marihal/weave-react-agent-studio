import { useCallback, useSyncExternalStore } from 'react';

// Where a person is in an agent's setup, kept in this browser per agent: the step they were on, whether they have tried the agent, and whether the setup is
// finished (put live, or closed for good). Leaving the setup keeps it, so "Continue setup" opens where they stopped. Nothing here is needed to use the agent:
// with no storage the setup simply starts at the beginning again.

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

// An agent made with the setup starts it at its second step (the first, its name and starting point, is the create dialog).
export const startSetup = (botId) => saveProgress(botId, { step: 'purpose', tried: false, finished: false });

// Whether an agent's next steps are done in the setup: while it is being set up (started here and not finished), and for an agent that was never published
// (a new one, however it was made). An agent that is already published, and was not set up here, keeps its own pages and panels for each step.
//   summary: the agent as listed (null while it is read, and then the answer is no, so nothing jumps)
export const inSetup = (progress, summary) => !progress?.finished && (!!progress?.known || (!!summary && !summary.latest_version));

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// { step, tried, finished, known } for one agent, and a way to change it. `known`: the setup was started for this agent in this browser.
export function useSetupProgress(botId) {
  const value = useSyncExternalStore(
    subscribe,
    () => read(botId),
    () => EMPTY,
  );
  const update = useCallback((patch) => saveProgress(botId, patch), [botId]);
  return [value, update];
}
