// How it will search, chosen before it has anything to read. A knowledge base needs at least one document or page
// (the schema: sources, at least one), so until then the choice is held here, per agent, for this visit, and written
// into the base the moment the first document or page makes it (KnowledgeWorkspace applies it). The editor says so.

import { useSyncExternalStore } from 'react';
import { KNOWLEDGE_ID, setBaseMode } from '../../../setup/setupKnowledge.js';
import { setPath } from '../schemaFacts.js';

const held = new Map(); // agent id -> { mode?, top_k? }
const subs = new Set();
const tell = () => subs.forEach((l) => l());

export function holdSearch(agentId, patch) {
  held.set(agentId, { ...(held.get(agentId) || {}), ...patch });
  tell();
}
export function takeSearch(agentId) {
  const choice = held.get(agentId) || null;
  held.delete(agentId);
  if (choice) tell();
  return choice;
}
export function useHeldSearch(agentId) {
  return useSyncExternalStore(
    (l) => {
      subs.add(l);
      return () => subs.delete(l);
    },
    () => held.get(agentId) || null,
  );
}

// the config with the held choice written into the setup's base (left as it is when there is no such base)
export function applySearch(config, choice) {
  const list = Array.isArray(config?.knowledge) ? config.knowledge : [];
  const at = list.findIndex((b) => b && b.id === KNOWLEDGE_ID && b.type === 'vector_store');
  if (at < 0 || !choice) return config;
  let next = config;
  if (choice.mode && choice.mode !== list[at].mode) next = setBaseMode(next, KNOWLEDGE_ID, choice.mode);
  if (typeof choice.top_k === 'number') next = setPath(next, ['knowledge', at, 'top_k'], choice.top_k);
  return next;
}
