// Managing an agent from its "⋯" menu: rename, export, remove from the list. The API has no delete endpoint, so
// "Remove from my list" only hides an agent in this browser, and "Delete from list" only forgets it here: the agent,
// its versions and deployments stay on the server. Pure apart from the two browser stores at the end.

import type { AgentConfig } from '../types/studio';
import { ApiError } from '../api/client';
import { browserStore, stringList } from './manageStore';
import { isSandbox } from '../sandbox/mode';

// Sandbox keeps lists of its own, so hiding a sample agent there never hides a real agent with the same id in Live
const ownKey = (key: string): string => (isSandbox() ? key.replace(/^weave_/, 'weave_sandbox_') : key);
export const HIDDEN_KEY = ownKey('weave_hidden_agents');
export const DISMISSED_KEY = ownKey('weave_dismissed_agents');
export const MAX_AGENT_NAME = 80;

// ---- rename ------------------------------------------------------------------------------------------------------------

/** What is wrong with a new name ('' when nothing). */
export function agentNameProblem(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Give the agent a name.';
  if (trimmed.length > MAX_AGENT_NAME) return `Keep it to ${MAX_AGENT_NAME} characters or fewer.`;
  return '';
}

/** The draft with only its display name (meta.name) changed. The id never changes: links and calls use it. */
export const renamedConfig = (config: AgentConfig, name: string): AgentConfig => ({ ...config, meta: { ...(config.meta ?? {}), name: name.trim() } });

/** A rename the server refused with 409: someone saved the draft between reading it and saving the new name. */
export const RENAME_CONFLICT = { title: 'The draft changed while you were renaming', text: 'Someone saved it a moment ago. Try again: nothing was overwritten.' };

/** A failed rename in plain words: a 409 means someone saved the draft in between. */
export function renameErrorWords(error: unknown): { title: string; text: string } {
  if (error instanceof ApiError && error.kind === 'conflict') return RENAME_CONFLICT;
  return { title: 'Couldn’t rename', text: error instanceof Error ? error.message : 'The server did not save the new name.' };
}

// ---- export ------------------------------------------------------------------------------------------------------------

/** A safe file name for an exported configuration: "acme-support-draft.json", "acme-support-0.2.0.json". */
export function exportFileName(agentId: string, label: string): string {
  const part = String(label || 'draft').replace(/[^A-Za-z0-9._-]+/g, '-');
  return `${agentId}-${part}.json`;
}

/** A configuration as the text of a file: readable JSON ending with a new line. */
export const configToText = (config: unknown): string => `${JSON.stringify(config, null, 2)}\n`;

// ---- removed from the list ---------------------------------------------------------------------------------------------

/** The list with the id added once. */
export const withId = (ids: string[], id: string): string[] => (ids.includes(id) ? ids : [...ids, id]);

/** The list without the given ids (all of them when none are given). */
export const withoutIds = (ids: string[], drop?: string[]): string[] => (drop ? ids.filter((id) => !drop.includes(id)) : []);

/**
 * The agents as the list shows them: `visible` (not removed), `removed` (waiting under "Removed from your list") and
 * the ids deleted from that list (still on the server; "Bring them back" returns them to it).
 */
export function partitionAgents<T extends { id: string }>(agents: T[], hidden: string[], dismissed: string[]) {
  const visible = agents.filter((a) => !hidden.includes(a.id));
  const removed = agents.filter((a) => hidden.includes(a.id) && !dismissed.includes(a.id));
  const dismissedIds = agents.filter((a) => hidden.includes(a.id) && dismissed.includes(a.id)).map((a) => a.id);
  return { visible, removed, dismissedIds };
}

export const hiddenStore = browserStore(HIDDEN_KEY, stringList);
export const dismissedStore = browserStore(DISMISSED_KEY, stringList);

export const hideAgent = (id: string) => hiddenStore.update((ids) => withId(ids, id));
export const restoreAgent = (id: string) => hiddenStore.update((ids) => withoutIds(ids, [id]));
/** Forget a removed agent in this list. It stays removed (hidden) and stays on the server. */
export const dismissAgent = (id: string) => dismissedStore.update((ids) => withId(ids, id));
/** "Bring them back": the deleted agents return to "Removed from your list" (all of them, or only `ids`). */
export const undoDismissed = (ids?: string[]) => dismissedStore.update((now) => withoutIds(now, ids));
