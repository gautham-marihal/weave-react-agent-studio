import { useSyncExternalStore } from 'react';

// The passages the last "Ask it something" found, per knowledge base, so "How close a match" can place them on its
// scale. Kept for this page view only; nothing is saved.
const found = new Map();
const listeners = new Set();
export function setLastHits(baseId, hits) {
  found.set(baseId, hits);
  listeners.forEach((listener) => listener());
}
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const useLastHits = (baseId) =>
  useSyncExternalStore(
    subscribe,
    () => found.get(baseId) || null,
    () => null,
  );
