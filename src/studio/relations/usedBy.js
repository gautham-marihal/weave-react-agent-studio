// "Used by": for a tool, a fixed line, a remembered value, a connection and the rest, the places in the agent that point at it, each with
// somewhere to jump to. Deleting or renaming something is safer when its uses are in sight, and an item nothing uses is easy to spot. The
// expensive part (walking the whole configuration for every pointer in it) is done once per configuration and shared by every card.
// Pure: no React, no DOM.

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
  // plain-text mentions ({{state.name}}, {{const.name}}) are found by a text search, only for the two collections that can be named in text
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
