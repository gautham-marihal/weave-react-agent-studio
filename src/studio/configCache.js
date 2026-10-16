import { api } from '../api/client.js';

// Saved draft configurations, fetched when a page needs to look inside several agents at once (the telephony
// simulator checking handoff, for example). Entries are kept for the session and refreshed after 2 minutes.
const TTL_MS = 120000;
const cache = new Map(); // id -> { config, at }
const inflight = new Map();

export function getCachedConfig(id) {
  const hit = cache.get(id);
  return hit ? hit.config : undefined;
}

export function forgetConfig(id) {
  cache.delete(id);
}

export async function loadConfig(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.config;
  if (inflight.has(id)) return inflight.get(id);
  const request = api
    .getDraft(id)
    .then((draft) => {
      cache.set(id, { config: draft.config, at: Date.now() });
      return draft.config;
    })
    .catch(() => (hit ? hit.config : null))
    .finally(() => inflight.delete(id));
  inflight.set(id, request);
  return request;
}

export function loadConfigs(ids) {
  return Promise.all(ids.map(loadConfig));
}
