import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../api/client';
import { normalizeChannelTypes, type ChannelKind } from '../models/channelTypes';

// GET /channel-types, fetched once and shared so every screen offers the same choices for a channel. There is no copy
// to fall back on: if the server cannot be asked, `types` is null, nothing is narrowed, and the page says so.

interface State {
  data: ChannelKind[] | null;
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

export function refreshChannelTypes(): Promise<void> {
  if (inflight) return inflight;
  set({ loading: true });
  inflight = api
    .channelTypes()
    .then((raw) => {
      const data = normalizeChannelTypes(raw);
      set(data.length ? { data, error: null, loading: false } : { data: null, error: 'The server listed no kinds of channel.', loading: false });
    })
    .catch((err: unknown) => set({ error: err instanceof Error ? err.message : 'Could not read the kinds of channel.', loading: false }))
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

/** The kinds of channel the server describes (null until read, or when it could not be). */
export function useChannelTypes() {
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    if (!s.data && !s.loading && !s.error) void refreshChannelTypes();
  }, [s.data, s.loading, s.error]);
  return { types: s.data, error: s.error, loading: s.loading && !s.data, reload: refreshChannelTypes };
}
