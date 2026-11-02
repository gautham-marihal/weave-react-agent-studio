// Workspaces: named groups of agents, kept in this browser. The Agent Builder API has no workspaces, so a workspace is a
// label here: it decides where an agent is listed in this browser, not who can see it, and nothing on the server
// changes when an agent moves. An agent nobody placed belongs to the first workspace.

import { browserStore, stringMap } from './manageStore';
import { randomHex } from '../utils/format';

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
}

export const WORKSPACES_KEY = 'weave_workspaces';
export const CURRENT_WORKSPACE_KEY = 'weave_current_workspace';
export const AGENT_WORKSPACES_KEY = 'weave_agent_workspaces';
export const DEFAULT_WORKSPACE_NAME = 'My workspace';
export const MAX_WORKSPACE_NAME = 60;

// ---- pure ----------------------------------------------------------------------------------------------------------

/** Workspaces read from storage: each needs an id and a name; anything else is dropped. */
export function parseWorkspaces(raw: unknown): Workspace[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { id, name, createdAt } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !id || seen.has(id) || typeof name !== 'string' || !name.trim()) return [];
    seen.add(id);
    return [{ id, name: name.trim(), createdAt: typeof createdAt === 'string' ? createdAt : '' }];
  });
}

/** The workspace an agent belongs to: the one it was placed in, else the first. Null when there are none yet. */
export function ownerOfIn(owners: Record<string, string>, spaces: Pick<Workspace, 'id'>[], agentId: string): string | null {
  if (!spaces.length) return null;
  const placed = owners[agentId];
  return placed && spaces.some((s) => s.id === placed) ? placed : spaces[0].id;
}

/** The agents listed in one workspace. */
export function agentsInWorkspace<T extends { id: string }>(agents: T[], owners: Record<string, string>, spaces: Pick<Workspace, 'id'>[], workspaceId: string | null): T[] {
  if (!workspaceId || !spaces.length) return agents;
  return agents.filter((a) => ownerOfIn(owners, spaces, a.id) === workspaceId);
}

/** How many of the agents each workspace has. */
export function countByWorkspace(agents: { id: string }[], owners: Record<string, string>, spaces: Pick<Workspace, 'id'>[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(spaces.map((s) => [s.id, 0]));
  agents.forEach((a) => {
    const owner = ownerOfIn(owners, spaces, a.id);
    if (owner) counts[owner] = (counts[owner] ?? 0) + 1;
  });
  return counts;
}

/** What is wrong with a name typed for a workspace ('' when nothing). `exceptId`: the workspace being renamed. */
export function workspaceNameProblem(name: string, spaces: Workspace[], exceptId = ''): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Give the workspace a name.';
  if (trimmed.length > MAX_WORKSPACE_NAME) return `Keep it to ${MAX_WORKSPACE_NAME} characters or fewer.`;
  if (spaces.some((s) => s.id !== exceptId && s.name.toLowerCase() === trimmed.toLowerCase())) return 'There is already a workspace with that name.';
  return '';
}

export const withWorkspace = (spaces: Workspace[], space: Workspace): Workspace[] => [...spaces, space];

export const renamedWorkspace = (spaces: Workspace[], id: string, name: string): Workspace[] =>
  spaces.map((s) => (s.id === id ? { ...s, name: name.trim() } : s));

/**
 * The workspaces and placements after deleting one: its agents move to the first workspace left. The last workspace
 * can't be deleted (null).
 */
export function withoutWorkspace(
  spaces: Workspace[],
  owners: Record<string, string>,
  id: string,
): { spaces: Workspace[]; owners: Record<string, string>; movedTo: Workspace } | null {
  const left = spaces.filter((s) => s.id !== id);
  if (!left.length || left.length === spaces.length) return null;
  const movedTo = left[0];
  const next = Object.fromEntries(Object.entries(owners).map(([agent, ws]) => [agent, ws === id ? movedTo.id : ws]));
  return { spaces: left, owners: next, movedTo };
}

// ---- kept in this browser --------------------------------------------------------------------------------------------

const newWorkspace = (name: string): Workspace => ({ id: `ws_${randomHex(8)}`, name: name.trim(), createdAt: new Date().toISOString() });

export const workspacesStore = browserStore(WORKSPACES_KEY, parseWorkspaces);
export const ownersStore = browserStore(AGENT_WORKSPACES_KEY, stringMap);
// The open workspace is each tab's own: another tab switching does not switch this one.
export const currentStore = browserStore(CURRENT_WORKSPACE_KEY, (raw) => (typeof raw === 'string' ? raw : ''), { sync: false });

/** The workspaces, making the first one ("My workspace") when this browser has none yet. */
export function ensureWorkspaces(): Workspace[] {
  const spaces = workspacesStore.get();
  if (spaces.length) return spaces;
  const first = [newWorkspace(DEFAULT_WORKSPACE_NAME)];
  workspacesStore.set(first);
  return first;
}

/** The open workspace's id: the one chosen in this tab, else the first. */
export function currentWorkspaceId(spaces: Workspace[] = workspacesStore.get(), chosen: string = currentStore.get()): string | null {
  if (!spaces.length) return null;
  return spaces.some((s) => s.id === chosen) ? chosen : spaces[0].id;
}

export function switchWorkspace(id: string): void {
  if (workspacesStore.get().some((s) => s.id === id) && currentStore.get() !== id) currentStore.set(id);
}

/** Makes a workspace and opens it. Throws with the problem when the name can't be used. */
export function createWorkspace(name: string): Workspace {
  const spaces = ensureWorkspaces();
  const problem = workspaceNameProblem(name, spaces);
  if (problem) throw new Error(problem);
  const space = newWorkspace(name);
  workspacesStore.set(withWorkspace(spaces, space));
  currentStore.set(space.id);
  return space;
}

export function renameWorkspace(id: string, name: string): void {
  const spaces = workspacesStore.get();
  const problem = workspaceNameProblem(name, spaces, id);
  if (problem) throw new Error(problem);
  workspacesStore.set(renamedWorkspace(spaces, id, name));
}

/** Deletes a workspace; its agents move to the first one left. Returns where they went, or null for the last one. */
export function deleteWorkspace(id: string): Workspace | null {
  // read placements again: another tab may have moved an agent since
  ownersStore.reload();
  const result = withoutWorkspace(workspacesStore.get(), ownersStore.get(), id);
  if (!result) return null;
  workspacesStore.set(result.spaces);
  ownersStore.set(result.owners);
  if (currentStore.get() === id) currentStore.set(result.movedTo.id);
  return result.movedTo;
}

/** Puts an agent in a workspace (where it is listed in this browser). */
export function assignAgent(agentId: string, workspaceId: string): void {
  ownersStore.reload();
  ownersStore.set({ ...ownersStore.get(), [agentId]: workspaceId });
}

export const ownerOf = (agentId: string): string | null => ownerOfIn(ownersStore.get(), workspacesStore.get(), agentId);
