import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ownerFrom, readTeam, type Member } from '../models/team';
import { isSandbox } from '../sandbox/mode';

// The team, kept in this browser until the server can hold it (there is no team API). The person signed in is its
// owner the first time; nobody else is added until they invite someone. Other tabs see a change when it is saved.

// Sandbox keeps its own team (it starts with sample people), so nothing made up there shows in Live
const TEAM_KEY = isSandbox() ? 'weave_sandbox_team' : 'weave_team';

const load = (): Member[] | null => {
  try {
    return readTeam(localStorage.getItem(TEAM_KEY));
  } catch {
    return null;
  }
};

/** The team; `fresh`: nothing is stored yet (the team is just the person signed in). */
export function useTeam(): { members: Member[]; fresh: boolean; update: (change: (current: Member[]) => Member[]) => void } {
  const { user } = useAuth();
  const [stored, setStored] = useState<Member[] | null>(load);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TEAM_KEY) setStored(load());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const fallback = useMemo(() => [ownerFrom({ name: user?.name, email: user?.email })], [user?.name, user?.email]);
  const members = stored ?? fallback;

  const update = useCallback(
    (change: (current: Member[]) => Member[]) => {
      const current = load() ?? fallback;
      const next = change(current);
      if (next === current) return;
      try {
        localStorage.setItem(TEAM_KEY, JSON.stringify({ v: 1, members: next }));
      } catch {
        // storage unavailable: the change lasts until the page is left
      }
      setStored(next);
    },
    [fallback]
  );

  return { members, fresh: stored === null, update };
}
