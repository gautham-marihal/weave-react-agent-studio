// "Used by": the places in the agent that point at a tool, line, value or connection, so renames and deletes are safer.
// The costly walk over the whole config runs once per config and is shared by every card. Pure: no React, no DOM.

import { allReferences, findUsage, placeLabel, sameIds } from '../form/references.js';

const cache = new WeakMap(); // config object -> { engine, hits }

function referencesOf(engine, config) {
  if (!config || typeof config !== 'object') return [];
  const hit = cache.get(config);
  if (hit && hit.engine === engine) return hit.hits;
  const hits = allReferences(engine, config);
  cache.set(config, { engine, hits });
  return hits;
}

// [{ place: 'agent “billing”', path: ['agents', 'items', 1, 'tools', 0] }], one per place, in the order they appear.
export function usedBy(engine, config, collection, id) {
  if (!engine || !config || !id) return [];
  const group = sameIds(collection);
  const pointers = referencesOf(engine, config).filter((hit) => group.includes(hit.collection) && hit.value === id);
  // text mentions ({{state.name}}, {{const.name}}) need a text search; only these two collections can be named in text
  const text = ['state_vars', 'constants'].includes(collection) ? findUsage(engine, config, collection, id).filter((hit) => hit.type === 'template') : [];
  const out = [];
  const seen = new Set();
  [...pointers, ...text].forEach((hit) => {
    const place = placeLabel(config, hit.path);
    if (seen.has(place)) return;
    seen.add(place);
    out.push({ place, path: hit.path });
  });
  return out;
}
