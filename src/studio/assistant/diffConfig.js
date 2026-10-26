// What a new configuration changes, compared with the one it would replace: as a list of changes by place, and then in
// words. Items of a list that all have an id are matched by id, so a reordered or inserted agent does not look like
// everything changed. Pure: no React, no DOM.

import { isObj } from '../form/engine.js';
import { describeSetting } from '../form/plainLanguage.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const byId = (list) => Array.isArray(list) && list.length > 0 && list.every((x) => isObj(x) && typeof x.id === 'string');

export function diffConfigs(before, after, path = [], out = []) {
  if (same(before, after)) return out;
  if (isObj(before) && isObj(after)) {
    new Set([...Object.keys(before), ...Object.keys(after)]).forEach((key) => {
      if (!(key in before)) out.push({ path: [...path, key], kind: 'added', after: after[key] });
      else if (!(key in after)) out.push({ path: [...path, key], kind: 'removed', before: before[key] });
      else diffConfigs(before[key], after[key], [...path, key], out);
    });
    return out;
  }
  if (Array.isArray(before) && Array.isArray(after) && (byId(before) || before.length === 0) && (byId(after) || after.length === 0)) {
    // the same items in another order is a change of its own (a task's steps run in order, rules are tried in order)
    const orderOf = (list, other) => list.map((x) => x?.id).filter((id) => other.some((y) => y?.id === id));
    const was = orderOf(before, after);
    const now = orderOf(after, before);
    if (!same(was, now)) out.push({ path, kind: 'changed', order: true, before: was, after: now });
    const ids = new Set([...before.map((x) => x?.id), ...after.map((x) => x?.id)]);
    ids.forEach((id) => {
      const b = before.find((x) => x?.id === id);
      const a = after.find((x) => x?.id === id);
      const at = [...path, { id }];
      if (b === undefined) out.push({ path: at, kind: 'added', after: a });
      else if (a === undefined) out.push({ path: at, kind: 'removed', before: b });
      else diffConfigs(b, a, at, out);
    });
    return out;
  }
  out.push({ path, kind: 'changed', before, after });
  return out;
}

const SECTIONS = {
  meta: 'Name and details',
  persona: 'Personality',
  defaults: 'Defaults',
  messages: 'Fixed lines',
  channels: 'Channels',
  agents: 'Agents',
  tools: 'Tools',
  connections: 'Connections',
  knowledge: 'Knowledge',
  forms: 'Forms',
  notifications: 'Messages it sends',
  wrapups: 'Closing messages',
  guardrails: 'Safety rules',
  schedules: 'Business hours',
  telephony: 'Phone transfers',
  state: 'Things it remembers',
  tasks: 'Multi-step tasks',
  events: 'Events',
  post_call: 'After the call',
  observability: 'Records',
  tests: 'Test scenarios',
  identity: 'Caller identity',
  runtime: 'Engine',
  constants: 'Fixed values',
  builder: 'Studio notes',
  schema_version: 'Schema version',
};
export const sectionOf = (change) => SECTIONS[change.path[0]] || String(change.path[0] || 'Settings');

const label = (path) =>
  path
    .map((p, i) => (isObj(p) ? `“${p.id}”` : typeof p === 'number' ? `#${p + 1}` : i === 0 || p === 'items' ? '' : String(p).replace(/_/g, ' ')))
    .filter(Boolean)
    .join(' › ');

const preview = (value) => {
  if (value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
};

const NOUN = {
  agents: 'agent',
  tools: 'tool',
  channels: 'channel',
  messages: 'fixed line',
  knowledge: 'knowledge base',
  forms: 'form',
  notifications: 'message',
  wrapups: 'closing message',
  tasks: 'task',
  transfers: 'transfer',
  guardrails: 'safety rule',
};
const plainList = (v) => Array.isArray(v) && v.every((x) => ['string', 'number', 'boolean'].includes(typeof x));
// A value as a person would read it: text as it is, a short list joined, a number or yes/no plainly. Anything bigger is not quoted (null).
const quote = (v) => {
  if (typeof v === 'string') return `“${v.length > 70 ? `${v.slice(0, 69)}…` : v}”`;
  if (typeof v === 'number' || typeof v === 'boolean') return `“${v}”`;
  if (plainList(v)) {
    const t = v.join('; ');
    return `“${t.length > 70 ? `${t.slice(0, 69)}…` : t}”`;
  }
  return null;
};

// One change as a sentence for a person: "Added the agent “Billing”", "Changed “Tone” from “warm” to “formal”".
function sentence(change) {
  const { path } = change;
  if (change.order) {
    const owner = [...path].reverse().find((p) => isObj(p));
    const leaf = path[path.length - 1];
    const parentKey = [...path].reverse().find((p, i) => i > 0 && typeof p === 'string');
    const what = path.length === 1 ? SECTIONS[leaf] || String(leaf) : describeSetting(String(leaf), { owner: parentKey || path[0] }).label;
    const named = /^The /.test(what) ? what.replace(/^The /, 'the ') : `“${what}”`; // "the agents", or a setting's name
    return `Changed the order of ${named}${owner ? ` of the ${NOUN[path[0]] || 'item'} “${owner.id}”` : ''}`;
  }
  const lastIsItem = isObj(path[path.length - 1]);
  const owner = [...path].reverse().find((p) => isObj(p));
  const noun = NOUN[path[0]] || 'item';
  const ownerPhrase = owner && !lastIsItem ? ` of the ${noun} “${owner.id}”` : '';
  const leaf = path[path.length - 1];
  const parentKey = [...path].reverse().find((p, i) => i > 0 && typeof p === 'string');
  const label = lastIsItem ? '' : describeSetting(String(leaf), { owner: parentKey || path[0] }).label;
  const named = (v) => (isObj(v) && (v.name || v.id) ? String(v.name || v.id) : '');
  if (change.kind === 'added') {
    if (lastIsItem) return `Added the ${noun} ${quote(named(change.after) || leaf.id)}`;
    return quote(change.after) === null ? `Added “${label}”${ownerPhrase}` : `Set “${label}”${ownerPhrase} to ${quote(change.after)}`;
  }
  if (change.kind === 'removed') return lastIsItem ? `Removed the ${noun} ${quote(named(change.before) || leaf.id)}` : `Removed “${label}”${ownerPhrase}`;
  const from = quote(change.before);
  const to = quote(change.after);
  return from !== null && to !== null
    ? `Changed “${label}”${ownerPhrase} from ${from} to ${to}`
    : `Changed “${label}”${ownerPhrase} (open it in the settings to see how)`;
}

// "Added Agents › “billing”", "Changed Personality › tone: friendly → calm"; `text` is the same as a sentence.
export function describeChange(change) {
  const where = [sectionOf(change), label(change.path)].filter(Boolean).join(' › ');
  const text = sentence(change);
  if (change.kind === 'added') return { verb: 'Added', where, text, detail: isObj(change.after) || Array.isArray(change.after) ? '' : preview(change.after) };
  if (change.kind === 'removed') return { verb: 'Removed', where, text, detail: '' };
  if (change.order) return { verb: 'Changed', where, text, detail: `${preview(change.before.join(', '))} → ${preview(change.after.join(', '))}` };
  return { verb: 'Changed', where, text, detail: `${preview(change.before)} → ${preview(change.after)}` };
}

// The changes without the studio's own notes, grouped by the part of the agent they belong to.
export function groupChanges(changes) {
  const groups = new Map();
  changes
    .filter((c) => c.path[0] !== 'builder')
    .forEach((c) => {
      const key = sectionOf(c);
      groups.set(key, [...(groups.get(key) || []), describeChange(c)]);
    });
  return [...groups].map(([section, items]) => ({ section, items }));
}

// How many were added, changed and removed, for a one-line summary.
export function countChanges(groups) {
  const out = { added: 0, changed: 0, removed: 0, total: 0 };
  groups.forEach((g) =>
    g.items.forEach((i) => {
      out[i.verb.toLowerCase()] += 1;
      out.total += 1;
    }),
  );
  return out;
}
