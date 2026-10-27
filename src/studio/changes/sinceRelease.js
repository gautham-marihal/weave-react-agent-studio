// What the draft changes against the newest published version, by part, in plain words, and a way to put a part back.
// Pure: no React, no DOM.

import { diffConfigs, describeChange, sectionOf } from '../assistant/diffConfig.js';

// set by the server when a version is published, and the studio's own notes (where blocks sit in the Workflow): real,
// but not what anyone came to review
const BOOKKEEPING = new Set(['version', 'status', 'created_at', 'updated_at']);
const quiet = (change) => change.path[0] === 'builder' || (change.path[0] === 'meta' && change.path.length === 2 && BOOKKEEPING.has(change.path[1]));

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

// { total, groups: [{ key, section, items: [{ verb, where, text, detail }] }] }; groups keep the settings' order
export function changesSince(published, draft) {
  if (!published || !draft || typeof published !== 'object' || typeof draft !== 'object') return { total: 0, groups: [] };
  const groups = new Map();
  diffConfigs(published, draft)
    .filter((change) => !quiet(change))
    .forEach((change) => {
      const key = String(change.path[0] ?? '');
      if (!groups.has(key)) groups.set(key, { key, section: sectionOf(change), items: [] });
      groups.get(key).items.push(describeChange(change));
    });
  const list = [...groups.values()];
  return { total: list.reduce((n, g) => n + g.items.length, 0), groups: list };
}

// the draft with one top-level part (persona, tools, ...) as published; a part that didn't exist then is removed
export function revertSection(draft, published, key) {
  const next = clone(draft);
  if (published && Object.prototype.hasOwnProperty.call(published, key)) next[key] = clone(published[key]);
  else delete next[key];
  return next;
}
