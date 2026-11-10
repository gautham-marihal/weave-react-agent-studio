import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { getPref, setPref, usePref } from '../usePref.js';
import { demoTeam, ownerFrom } from './teamModel.js';

// The open workspace's team, kept in localStorage until the server can hold it (docs/COLLABORATION_API.md). Every
// reader sees a change at once, so the Team page and an agent's Share panel agree. The dashboard picks the workspace.
// the open team, this tab's own (each tab keeps its own workspace): kept in sessionStorage, which other tabs don't share
const ACTIVE = 'weave_team_active';
let memory = 'default'; // when storage is blocked
const listeners = new Set();
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const activeNow = () => {
  try {
    return window.sessionStorage.getItem(ACTIVE) || memory;
  } catch {
    return memory;
  }
};
const keyOf = (workspaceId) => `weave_team_${workspaceId}`;

const parse = (raw) => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v?.members) ? v.members : null;
  } catch {
    return null;
  }
};
const profileNow = () => {
  try {
    return JSON.parse(window.localStorage.getItem('weave_profile') || 'null');
  } catch {
    return null;
  }
};

// Opens a workspace's team; the first time it is just the owner (plus a few people to try it with, in demo mode).
export function openTeam({ workspaceId, profile, demo = false, agentIds = [] }) {
  const id = String(workspaceId || 'default');
  if (activeNow() !== id) {
    memory = id;
    try {
      window.sessionStorage.setItem(ACTIVE, id);
    } catch {
      /* blocked storage: this page remembers it */
    }
    listeners.forEach((listener) => listener());
  }
  if (parse(getPref(keyOf(id), '')) === null) setPref(keyOf(id), JSON.stringify({ v: 1, members: demo ? demoTeam(profile, agentIds) : [ownerFrom(profile)] }));
}

// { members, update(fn) } where fn gets the list and returns the new one
export function useTeam() {
  const open = useSyncExternalStore(subscribe, activeNow, activeNow);
  const raw = usePref(keyOf(open), '')[0];
  const stored = useMemo(() => parse(raw), [raw]);
  const members = useMemo(() => stored || [ownerFrom(profileNow())], [stored]);
  const update = useCallback(
    (change) => {
      const current = parse(getPref(keyOf(open), '')) || [ownerFrom(profileNow())];
      const next = change(current);
      if (next && next !== current) setPref(keyOf(open), JSON.stringify({ v: 1, members: next }));
    },
    [open],
  );
  return { members, update };
}
