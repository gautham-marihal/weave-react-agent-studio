// Find a setting by name or purpose ("silent", `timeout_s`) from anywhere. Built from the schema, catalogue and layout,
// so it knows every setting and where it lives ("How it talks › Conversation flow › …"). Pure: no network, no DOM.

import { isObj } from './form/engine.js';
import { describeSetting } from './form/plainLanguage.js';
import { SKIPPED_SECTIONS, layoutFor, viewForPath } from './form/layout.js';

// Set up by the platform when a phone number is added (Releases › Deploy), never asked for; offering them would lead to
// a field that isn't there.
const PLATFORM_SET = new Set(['channels.[].entry.dnis', 'channels.[].entry.sip_trunk', 'channels.[].entry.dispatch_rule']);

// Everyday words a part's own name doesn't use ("opening hours" for business hours), by path, so they find it too.
const ALSO = {
  schedules: 'opening hours office hours open closed holidays',
  'telephony.transfers': 'hand over handover human person escalate',
  knowledge: 'documents files faq website pages',
  guardrails: 'safety block blocked forbidden topics',
  post_call: 'summary wrap up',
  channels: 'phone chat website widget reach whatsapp sms',
  tools: 'actions abilities integrations lookup webhook',
  connections: 'api webhook endpoint integration',
  'defaults.language': 'languages multilingual',
  'defaults.models': 'llm gpt ai',
  tests: 'scenarios test cases',
};

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

// Every property in the schema, once per place. `trail` is the keys from the top, with '[]' for list items and '{}' for
// map entries; `jump` stops at the first of those, since an item can't be named before there is one.
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
  const entries = [...found.values()]
    .filter((entry) => !PLATFORM_SET.has(entry.trail.join('.')))
    .map((entry) => {
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
        also: ALSO[entry.trail.join('.')] || '',
        crumbs,
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

// Settings matching what was typed, best first. Every word must match somewhere; a match at the start of a label word
// counts most, then the label, technical name, purpose, or where it lives.
export function searchSettings(index, query, limit = 8) {
  const typed = wordsOf(query);
  if (!typed.length || typed.join('').length < 2) return [];
  const scored = [];
  for (const entry of index) {
    const label = norm(entry.label);
    const labelWords = wordsOf(entry.label);
    const nameWords = wordsOf(entry.name);
    const alsoWords = wordsOf(entry.also);
    const purpose = norm(entry.purpose);
    const where = norm(entry.where);
    let total = 0;
    let all = true;
    for (const word of typed) {
      let best = 0;
      if (labelWords.includes(word)) best = 10;
      else if (labelWords.some((w) => w.startsWith(word))) best = 8;
      else if (label.includes(word)) best = 6;
      else if (nameWords.some((w) => w === word) || alsoWords.includes(word)) best = 7;
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
    // a screen's own heading beats the same word deep inside; experts' settings come after
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
