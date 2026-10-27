import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../../api/client.ts';
import { FALLBACK, normalizeChannelTypes } from './channelTypes.js';

// The channel kinds and what each may carry (GET /channel-types), fetched once and shared so screens can't disagree. If
// the server can't be asked, screens use a copy of the answer and `live` says so.
let state = { data: null, error: null, loading: false, failedAt: 0 };
const RETRY_AFTER_MS = 30000; // after a failure the server is asked again, but not on every render
const listeners = new Set();
const set = (patch) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => state;

let inflight = null;
export function refreshChannelTypes() {
  if (inflight) return inflight;
  set({ loading: true });
  inflight = api
    .channelTypes()
    .then((raw) => {
      const data = normalizeChannelTypes(raw);
      set({ data: data.length ? data : null, error: null, loading: false });
    })
    .catch((error) => set({ error, loading: false, failedAt: Date.now() }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useChannelTypes() {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!s.data && !s.loading && (!s.error || Date.now() - s.failedAt > RETRY_AFTER_MS)) refreshChannelTypes();
  }, [s.data, s.loading, s.error, s.failedAt]);
  return { types: s.data || FALLBACK, live: !!s.data, loading: s.loading && !s.data, error: s.error };
}
