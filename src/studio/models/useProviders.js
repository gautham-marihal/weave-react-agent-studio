import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../../api/client.ts';
import { FALLBACK_PROVIDERS, FALLBACK_TURN_DETECTORS } from './catalog.js';

// The model providers the runtime can run (GET /providers), fetched once and shared by every screen that offers a
// choice, so they can't disagree. If the server can't be asked, the screens fall back to the providers the server image
// ships with and say that the list could not be checked.

let state = { data: null, error: null, loading: false };
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
function refreshProviders() {
  if (inflight) return inflight;
  set({ loading: true });
  inflight = api
    .providers()
    .then((data) => set({ data, error: null, loading: false }))
    .catch((error) => set({ error, loading: false }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useProviders() {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!s.data && !s.loading && !s.error) refreshProviders();
  }, [s.data, s.loading, s.error]);
  return {
    providers: s.data?.providers || FALLBACK_PROVIDERS,
    // the turn detectors the runtime can run, for defaults.models.turn_detector.provider
    turnDetectors: Array.isArray(s.data?.turn_detectors) ? s.data.turn_detectors : FALLBACK_TURN_DETECTORS,
    note: s.data?.note || '',
    live: !!s.data, // false: the fallback list, because the server could not be asked
    loading: s.loading && !s.data,
    error: s.error,
    reload: refreshProviders,
  };
}
