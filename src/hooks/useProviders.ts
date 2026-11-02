import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { api } from '../api/client';
import type { ProvidersAnswer } from '../api/types';
import { secretKeys } from '../utils/providerOptions';

// GET /providers, fetched once and shared by every screen that offers a provider or warns about a key, so they agree.
// There is no fallback list: if the server cannot be asked, pickers say so and keep the current value.

interface State {
  data: ProvidersAnswer | null;
  error: string | null;
  loading: boolean;
}

let state: State = { data: null, error: null, loading: false };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};

export function refreshProviders(): Promise<void> {
  if (inflight) return inflight;
  set({ loading: true });
  inflight = api
    .providers()
    .then((data) => set({ data, error: null, loading: false }))
    .catch((err: unknown) => set({ error: err instanceof Error ? err.message : 'Could not load the provider list.', loading: false }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useProviders() {
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    if (!s.data && !s.loading && !s.error) void refreshProviders();
  }, [s.data, s.loading, s.error]);
  return { answer: s.data, error: s.error, loading: s.loading && !s.data, reload: refreshProviders };
}

/** Secret name -> whether the server has it, for the secrets the server reports on. */
export function useSecretKeys(): Record<string, boolean> {
  const { answer } = useProviders();
  return useMemo(() => secretKeys(answer), [answer]);
}
