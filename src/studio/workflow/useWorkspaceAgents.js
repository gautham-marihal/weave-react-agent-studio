import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { api } from '../../api/client.ts';
import { useBots } from '../agents.js';

// The other agents of the workspace an agent can transfer a call to, each with the phone numbers the workspace gave it
// (GET /numbers). A call reaches another agent through one of its numbers: an "Agent transfer" is a transfer to that
// number. Read only; fetched once and shared, again when asked.
//   { agents: [{ id, name, numbers: [{ number, environment }] }], numbers: [{ number, bot }], loading, error, reload }

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
export function refreshNumbers() {
  if (inflight) return inflight;
  set({ loading: true });
  inflight = api
    .listNumbers()
    .then((data) => set({ data: Array.isArray(data) ? data : Array.isArray(data?.numbers) ? data.numbers : [], error: null, loading: false }))
    .catch((error) => set({ error, loading: false }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// a number's agent, whatever shape the list gives it ("voice-test" or { id: "voice-test" })
const botOf = (n) => (typeof n?.bot === 'string' ? n.bot : n?.bot?.id || n?.bot_id || '');
const envOf = (n) => (typeof n?.environment === 'string' ? n.environment : n?.environment?.name || '');

export function useWorkspaceAgents() {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  const { all } = useBots();
  useEffect(() => {
    if (!s.data && !s.loading && !s.error) refreshNumbers();
  }, [s.data, s.loading, s.error]);
  const numbers = useMemo(
    () => (s.data || []).filter((n) => n && typeof n.number === 'string' && botOf(n)).map((n) => ({ number: n.number, bot: botOf(n), environment: envOf(n) })),
    [s.data],
  );
  const agents = useMemo(
    () =>
      (all || []).map((b) => ({
        id: b.id,
        name: b.name || b.id,
        numbers: numbers.filter((n) => n.bot === b.id).map(({ number, environment }) => ({ number, environment })),
      })),
    [all, numbers],
  );
  return { agents, numbers, loading: s.loading && !s.data, error: s.error, reload: refreshNumbers };
}
