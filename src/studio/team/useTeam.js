import { useCallback, useMemo } from 'react';
import { getPref, setPref, usePref } from '../usePref.js';
import { demoTeam, ownerFrom } from './teamModel.js';

// The open workspace's team, kept in localStorage until the server can hold it (docs/COLLABORATION_API.md). Every
// reader sees a change at once, so the Team page and an agent's Share panel agree. The dashboard picks the workspace.
const ACTIVE = 'weave_team_active';
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
  if (getPref(ACTIVE, '') !== id) setPref(ACTIVE, id);
  if (parse(getPref(keyOf(id), '')) === null) setPref(keyOf(id), JSON.stringify({ v: 1, members: demo ? demoTeam(profile, agentIds) : [ownerFrom(profile)] }));
}

// { members, update(fn) } where fn gets the list and returns the new one
export function useTeam() {
  const active = usePref(ACTIVE, 'default')[0];
  const raw = usePref(keyOf(active), '')[0];
  const stored = useMemo(() => parse(raw), [raw]);
  const members = useMemo(() => stored || [ownerFrom(profileNow())], [stored]);
  const update = useCallback(
    (change) => {
      const current = parse(getPref(keyOf(active), '')) || [ownerFrom(profileNow())];
      const next = change(current);
      if (next && next !== current) setPref(keyOf(active), JSON.stringify({ v: 1, members: next }));
    },
    [active],
  );
  return { members, update };
}
