import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { BrowserStore } from '../models/manageStore';
import { agentsInWorkspace, currentStore, currentWorkspaceId, ensureWorkspaces, ownerOfIn, ownersStore, workspacesStore } from '../models/workspaces';
import { dismissedStore, hiddenStore } from '../models/manage';
import { useStudio } from '../contexts/StudioContext';

/** A value kept in this browser, re-rendering when it changes (here, or in another tab). */
export function useBrowserStore<T>(store: BrowserStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** The workspaces (kept in this browser), the open one, and where each agent belongs. */
export function useWorkspaces() {
  const spaces = useBrowserStore(workspacesStore);
  const owners = useBrowserStore(ownersStore);
  const chosen = useBrowserStore(currentStore);
  // the first workspace is made the first time any page asks
  useEffect(() => {
    if (!spaces.length) ensureWorkspaces();
  }, [spaces.length]);
  const current = currentWorkspaceId(spaces, chosen);
  return useMemo(
    () => ({
      spaces,
      owners,
      current,
      currentSpace: spaces.find((s) => s.id === current) ?? null,
      ownerOf: (agentId: string) => ownerOfIn(owners, spaces, agentId),
    }),
    [spaces, owners, current],
  );
}

/** Agents removed from the list in this browser, and the ones deleted from that list. */
export function useRemovedAgents() {
  const hidden = useBrowserStore(hiddenStore);
  const dismissed = useBrowserStore(dismissedStore);
  return { hidden, dismissed };
}

/** The agents of the open workspace that are on the list (not removed): the ones other pages offer to choose from. */
export function useWorkspaceAgents() {
  const { agents } = useStudio();
  const { spaces, owners, current } = useWorkspaces();
  const { hidden } = useRemovedAgents();
  return useMemo(() => agentsInWorkspace(agents, owners, spaces, current).filter((a) => !hidden.includes(a.id)), [agents, owners, spaces, current, hidden]);
}
