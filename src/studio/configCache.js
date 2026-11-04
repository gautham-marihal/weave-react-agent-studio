import { api } from '../api/client.ts';

// Saved drafts, for pages that look inside several agents at once (e.g. the telephony simulator checking handoff).
// Kept for the session, refreshed after 2 minutes or when the list's draft_revision shows a newer save.
const TTL_MS = 120000;
const cache = new Map(); // id -> { config, revision, at }
const inflight = new Map();

export function getCachedConfig(id) {
  const hit = cache.get(id);
  return hit ? hit.config : undefined;
}

async function loadConfig(id, revision) {
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
