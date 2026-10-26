import { api } from '../api/client.js';

// Saved draft configurations, fetched when a page needs to look inside several agents at once (the telephony
// simulator checking handoff, for example). Entries are kept for the session and refreshed after 2 minutes, or as soon as the caller knows of a newer
// revision (the agent list's draft_revision, which changes with every save).
const TTL_MS = 120000;
const cache = new Map(); // id -> { config, revision, at }
const inflight = new Map();

export function getCachedConfig(id) {
  const hit = cache.get(id);
  return hit ? hit.config : undefined;
}

export function forgetConfig(id) {
  cache.delete(id);
}

export async function loadConfig(id, revision) {
  const hit = cache.get(id);
  const current = revision === undefined || revision === null || hit?.revision === revision;
  if (hit && current && Date.now() - hit.at < TTL_MS) return hit.config;
  if (inflight.has(id)) return inflight.get(id);
  const request = api
    .getDraft(id)
    .then((draft) => {
      cache.set(id, { config: draft.config, revision: draft.revision, at: Date.now() });
      return draft.config;
    })
    .catch(() => (hit ? hit.config : null))
    .finally(() => inflight.delete(id));
  inflight.set(id, request);
  return request;
}

// revisions: the draft revision of each, when known (a cached copy of another revision is read again)
export function loadConfigs(ids, revisions = []) {
  return Promise.all(ids.map((id, i) => loadConfig(id, revisions[i])));
}
