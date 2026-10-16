// Finding a SETTING by what it is called or what it is for ("silent", "timeout", "voice"), from anywhere in the studio. The index is built from the
// schema the form is drawn from, the plain-language catalogue and the layout, so it knows every setting the schema has, says where each lives
// ("How it talks › Conversation flow › When the caller goes quiet"), and finds technical names too (`timeout_s`). Pure: no network, no DOM.

import { isObj } from './form/engine.js';
import { describeSetting } from './form/plainLanguage.js';
import { SKIPPED_SECTIONS, layoutFor, viewForPath } from './form/layout.js';

const deref = (schema, node) => {
  let n = node;
  for (let i = 0; i < 24 && isObj(n) && n.$ref; i += 1) {
    const { $ref, ...rest } = n;
    const target = $ref
      .replace(/^#\/?/, '')
      .split('/')
      .filter(Boolean)
      .reduce((x, k) => x?.[decodeURIComponent(k)], schema);
    n = { ...(target || {}), ...rest };
  }
  return isObj(n) ? n : {};
};

// Every property of every object the schema describes, once per place it lives. `trail` is the names from the top ('defaults', 'conversation',
// 'inactivity', 'timeout_s'), with '[]' for the items of a list and '{}' for the entries of a map; `jump` is the part of it that can be opened
// (up to the first '[]' or '{}'), because a particular item can't be named before there is one.
export function buildSettingsIndex(schema) {
  if (!isObj(schema?.properties)) return [];
  const sectionKeys = Object.keys(schema.properties).filter((k) => !SKIPPED_SECTIONS.has(k));
  const groups = layoutFor(sectionKeys, (key) => Object.keys(deref(schema, schema.properties[key]).properties || {}));
  const found = new Map(); // trail text -> entry
  const walk = (node, trail, owner, stack) => {
    if (!isObj(node)) return;
    let here = stack;
    if (node.$ref) {
      if (stack.includes(node.$ref)) return;
      here = [...stack, node.$ref];
    }
    const n = deref(schema, node);
    Object.entries(n.properties || {}).forEach(([name, sub]) => {
      const next = [...trail, name];
      const flat = deref(schema, sub);
      const key = next.join('.');
      if (!found.has(key)) {
        const words = describeSetting(name, { owner, description: flat.description });
        const stop = next.findIndex((part) => part === '[]' || part === '{}');
        found.set(key, {
          name,
          trail: next,
          jump: stop === -1 ? next : next.slice(0, stop),
          label: words.label,
          purpose: words.purpose,
          level: flat['x-ui']?.audience || words.level,
          example: words.example,
        });
      }
      walk(sub, next, name, here);
    });
    ['oneOf', 'anyOf', 'allOf'].forEach((k) => (n[k] || []).forEach((branch) => walk(branch, trail, owner, here)));
    if (isObj(n.items)) walk(n.items, [...trail, '[]'], owner, here);
    if (isObj(n.additionalProperties)) walk(n.additionalProperties, [...trail, '{}'], owner, here);
    ['then', 'else'].forEach((k) => walk(n[k], trail, owner, here));
  };
  sectionKeys.forEach((key) => {
    const flat = deref(schema, schema.properties[key]);
    const words = describeSetting(key, { owner: '', description: flat.description });
    found.set(key, { name: key, trail: [key], jump: [key], label: words.label, purpose: words.purpose, level: words.level, example: words.example });
    walk(schema.properties[key], [key], key, []);
  });
  const entries = [...found.values()].map((entry) => {
    const view = viewForPath(groups, entry.jump);
    const group = groups.find((g) => g.id === view?.group);
    // where it is: the group and screen, then the labels of the containers above it
    const containers = entry.trail.slice(0, -1).filter((p) => p !== '[]' && p !== '{}');
    const crumbs = [];
    let owner = '';
    containers.forEach((name, i) => {
      if (i === 0 && view && !view.only) return;
      if (i === 0 && view?.only) return;
      crumbs.push(describeSetting(name, { owner }).label);
      owner = name;
    });
    return {
      ...entry,
      screen: view ? { id: view.id, label: view.label } : null,
      group: group ? { id: group.id, label: group.label, advanced: !!group.advanced } : null,
      where: [group?.label, view?.label, ...crumbs].filter(Boolean).join(' › '),
    };
  });
  return entries;
}

const norm = (text) => String(text || '').toLowerCase();
const wordsOf = (text) =>
  norm(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

// Settings matching what was typed, best first. Every typed word must match somewhere; a word that starts a word of the label counts most, then
// one in the label, the technical name, the purpose, or where the setting lives.
export function searchSettings(index, query, limit = 8) {
  const typed = wordsOf(query);
  if (!typed.length || typed.join('').length < 2) return [];
  const scored = [];
  for (const entry of index) {
    const label = norm(entry.label);
    const labelWords = wordsOf(entry.label);
    const nameWords = wordsOf(entry.name);
    const purpose = norm(entry.purpose);
    const where = norm(entry.where);
    let total = 0;
    let all = true;
    for (const word of typed) {
      let best = 0;
      if (labelWords.includes(word)) best = 10;
      else if (labelWords.some((w) => w.startsWith(word))) best = 8;
      else if (label.includes(word)) best = 6;
      else if (nameWords.some((w) => w === word)) best = 7;
      else if (nameWords.some((w) => w.startsWith(word)) || norm(entry.name).includes(word)) best = 5;
      else if (purpose.includes(word)) best = 3;
      else if (where.includes(word)) best = 2;
      if (!best) {
        all = false;
        break;
      }
      total += best;
    }
    if (!all) continue;
    // a setting that is a screen's own heading is a better answer than the same word deep inside; experts' settings come after
    const depth = entry.trail.length;
    scored.push({ entry, score: total * 10 - depth + (entry.level === 'expert' ? -15 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || a.entry.where.localeCompare(b.entry.where));
  // one per label and place: a list item's property is the same setting for every item
  const seen = new Set();
  const out = [];
  for (const { entry } of scored) {
    const key = `${entry.label}|${entry.where}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}
