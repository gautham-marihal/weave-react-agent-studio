import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../api/client';
import type { Entity } from '../models/afterCall';

// The kinds of detail the server can find (GET /redaction/entities), read once and shared. Nothing is listed while it is
// not known: the studio has no list of its own.
let state: { entities: Entity[] | null; error: string | null; loading: boolean } = { entities: null, error: null, loading: false };
const listeners = new Set<() => void>();
const set = (next: typeof state) => {
  state = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function loadRedactionEntities() {
  if (state.loading) return;
  set({ ...state, loading: true, error: null });
  api
    .redactionEntities()
    .then((r) => set({ entities: Array.isArray(r?.entities) ? r.entities.filter((e) => typeof e?.kind === 'string') : [], error: null, loading: false }))
    .catch((err: unknown) => set({ entities: null, error: err instanceof Error ? err.message : 'The list could not be read.', loading: false }));
}

export function useRedactionEntities() {
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    if (!s.entities && !s.loading && !s.error) loadRedactionEntities();
  }, [s.entities, s.loading, s.error]);
  return { ...s, retry: loadRedactionEntities };
}
