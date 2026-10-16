// Where the ids of a config are used, and how to change them safely.
//
// An `id` (a channel, an agent, a tool, ...) or a map key (a state variable, a connection, a schedule) is a machine key
// that other parts of the config point at: in the schema those fields say `x-ref: <collection>`. Renaming one without
// touching the pointers breaks the config, and deleting one leaves dangling pointers. This walks the config the way the
// schema describes it, so it finds every pointer, in any depth, without knowing about each section.
//
// Pure: no network, no DOM. Takes the form engine (form/engine.js) so $ref / allOf / oneOf are resolved the same way the
// form resolves them.

import { isObj } from './engine.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const getAt = (root, path) => path.reduce((node, part) => (node == null ? node : node[part]), root);

// A collection an `x-ref` can name, and every x-ref name that points into the same set of ids.
const SAME_IDS = {
  tools: ['tools', 'tool_names'],
  tool_names: ['tools', 'tool_names'],
  connections: ['http_connections', 'mcp_connections', 'notifiers'],
  http_connections: ['http_connections', 'mcp_connections', 'notifiers'],
  mcp_connections: ['http_connections', 'mcp_connections', 'notifiers'],
  notifiers: ['http_connections', 'mcp_connections', 'notifiers'],
};
export const sameIds = (collection) => SAME_IDS[collection] || [collection];

// What a `{{root.name}}` template says about each collection, for rewriting the text that mentions a renamed id.
const TEMPLATE_ROOT = { state_vars: 'state', constants: 'const' };

// The collections that can be renamed, and where their ids live: lists of objects with an `id`, or maps keyed by name.
export const COLLECTIONS = {
  channels: { kind: 'list', path: ['channels'], word: 'channel' },
  agents: { kind: 'list', path: ['agents', 'items'], word: 'agent' },
  tools: { kind: 'list', path: ['tools'], word: 'tool' },
  tasks: { kind: 'list', path: ['tasks'], word: 'task' },
  knowledge: { kind: 'list', path: ['knowledge'], word: 'knowledge base' },
  forms: { kind: 'list', path: ['forms'], word: 'form' },
  wrapups: { kind: 'list', path: ['wrapups'], word: 'wrap-up' },
  messages: { kind: 'list', path: ['messages'], word: 'message' },
  notifications: { kind: 'list', path: ['notifications'], word: 'notification' },
  transfers: { kind: 'list', path: ['telephony', 'transfers'], word: 'transfer' },
  input_guardrails: { kind: 'list', path: ['guardrails', 'input'], word: 'safety rule' },
  schedules: { kind: 'map', path: ['schedules'], word: 'schedule' },
  state_vars: { kind: 'map', path: ['state', 'variables'], word: 'state variable', pattern: '^[a-z][a-z0-9_]{0,63}$' },
  connections: { kind: 'map', path: ['connections'], word: 'connection' },
  constants: { kind: 'map', path: ['constants'], word: 'constant', pattern: '^[a-z][a-z0-9_]{0,63}$' },
};
export const ID_PATTERN = '^[a-z][a-z0-9_-]{0,63}$';

// The collection a list or map at this path is, if it is one.
export function collectionAt(path) {
  const flat = path.map((part) => (typeof part === 'number' ? '#' : part)).join('.');
  const entry = Object.entries(COLLECTIONS).find(([, info]) => info.path.join('.') === flat.replace(/\.#$/, ''));
  return entry ? entry[0] : null;
}

// ---- finding every pointer -------------------------------------------------------------------------------------

// visit({ path, collection, value, type: 'value' | 'key', parent: { path, kind: 'object'|'array'|'map', key|index, required } })
function walk(engine, schema, value, path, parent, visit, depth = 0) {
  if (depth > 40 || value === undefined) return;
  let shape;
  try {
    shape = engine.resolveShape(schema, value);
  } catch {
    return;
  }
  const kind = engine.kindOf(shape);
  if (kind === 'ref') {
    if (typeof value === 'string') visit({ path, collection: shape['x-ref'], value, type: 'value', parent });
    return;
  }
  if (kind === 'union') {
    const branches = engine.branchesOf(shape);
    if (!branches.length) return;
    walk(engine, branches[engine.pickBranch(branches, value)], value, path, parent, visit, depth + 1);
    return;
  }
  if (kind === 'object' && isObj(value)) {
    Object.keys(value).forEach((key) => {
      const sub = shape.properties[key] || (isObj(shape.additionalProperties) ? shape.additionalProperties : null);
      if (sub) walk(engine, sub, value[key], [...path, key], { path, kind: 'object', key, required: (shape.required || []).includes(key) }, visit, depth + 1);
    });
    return;
  }
  if (kind === 'map' && isObj(value)) {
    const names = engine.deref(shape.propertyNames || {});
    Object.keys(value).forEach((key) => {
      if (names['x-ref']) visit({ path: [...path, key], collection: names['x-ref'], value: key, type: 'key', parent: { path, kind: 'map', key } });
      if (isObj(shape.additionalProperties)) walk(engine, shape.additionalProperties, value[key], [...path, key], { path, kind: 'map', key }, visit, depth + 1);
    });
    return;
  }
  if (kind === 'array' && Array.isArray(value) && shape.items) {
    value.forEach((item, index) => walk(engine, shape.items, item, [...path, index], { path, kind: 'array', index }, visit, depth + 1));
  }
}

export function allReferences(engine, config) {
  const hits = [];
  if (!isObj(config)) return hits;
  Object.keys(config).forEach((key) => {
    const sub = engine.root.properties?.[key];
    if (sub) walk(engine, sub, config[key], [key], { path: [], kind: 'object', key, required: false }, (hit) => hits.push(hit));
  });
  return hits;
}

// Every place that points at `id` of this collection.
export function findReferences(engine, config, collection, id) {
  const group = sameIds(collection);
  return allReferences(engine, config).filter((hit) => group.includes(hit.collection) && hit.value === id);
}

// Plain-text mentions: `{{state.name}}` for a state variable, `{{const.name}}` for a constant.
function templateHits(config, collection, id) {
  const root = TEMPLATE_ROOT[collection];
  if (!root) return [];
  const pattern = new RegExp(`\\b${root}\\.${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`);
  const hits = [];
  const visit = (node, path) => {
    if (typeof node === 'string') {
      const blocks = node.match(/\{\{[^}]*\}\}/g) || [];
      if (blocks.some((block) => pattern.test(block))) hits.push({ path, type: 'template' });
    } else if (Array.isArray(node)) node.forEach((item, index) => visit(item, [...path, index]));
    else if (isObj(node)) Object.keys(node).forEach((key) => visit(node[key], [...path, key]));
  };
  visit(config, []);
  return hits;
}

export function findUsage(engine, config, collection, id) {
  return [...findReferences(engine, config, collection, id), ...templateHits(config, collection, id)];
}

// ---- describing a place ---------------------------------------------------------------------------------------

const wordFor = (section) =>
  ({
    agents: 'agent',
    tools: 'tool',
    channels: 'channel',
    tasks: 'task',
    forms: 'form',
    messages: 'message',
    wrapups: 'wrap-up',
    notifications: 'notification',
    knowledge: 'knowledge base',
    guardrails: 'guardrail',
    events: 'event',
    schedules: 'schedule',
    state: 'state',
    connections: 'connection',
    telephony: 'transfer',
    tests: 'test',
    post_call: 'post-call',
  })[section] || section;

// "tool “lookup”" for a path inside the tools list, "agent “billing”" for one inside an agent, and so on: the nearest
// item with a name, so a person can find the place.
export function placeLabel(config, path) {
  const section = path[0];
  for (let i = 1; i < path.length; i += 1) {
    if (typeof path[i] !== 'number') continue;
    const item = getAt(config, path.slice(0, i + 1));
    if (isObj(item) && typeof item.id === 'string') {
      const word = section === 'agents' ? 'agent' : section === 'telephony' ? 'transfer' : wordFor(section);
      return `${word} “${item.id}”`;
    }
  }
  if (section === 'state' && path[2]) return `state variable “${path[2]}”`;
  if (['connections', 'schedules', 'constants'].includes(section) && path[1]) return `${wordFor(section)} “${path[1]}”`;
  return path.slice(0, 3).map(String).join(' › ');
}

export function describeUsage(config, hits) {
  const places = [];
  const seen = new Set();
  hits.forEach((hit) => {
    const text = placeLabel(config, hit.path);
    if (!seen.has(text)) {
      seen.add(text);
      places.push(text);
    }
  });
  return places;
}

// ---- changing ----------------------------------------------------------------------------------------------------

function renameKey(parent, from, to) {
  const out = {};
  Object.keys(parent).forEach((key) => {
    out[key === from ? to : key] = parent[key];
  });
  return out;
}

function rewriteTemplates(node, root, from, to) {
  const pattern = new RegExp(`\\b${root}\\.${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'g');
  const visit = (value) => {
    if (typeof value === 'string') return value.replace(/\{\{[^}]*\}\}/g, (block) => block.replace(pattern, `${root}.${to}`));
    if (Array.isArray(value)) return value.map(visit);
    if (isObj(value)) {
      const out = {};
      Object.keys(value).forEach((key) => {
        out[key] = visit(value[key]);
      });
      return out;
    }
    return value;
  };
  return visit(node);
}

// A copy of the config where `from` of this collection is called `to` everywhere: the item itself and every pointer.
export function renameEverywhere(engine, config, collection, from, to) {
  if (from === to) return config;
  const info = COLLECTIONS[collection];
  let next = clone(config);
  // the pointers first (they are found by value, so the item must still carry the old name)
  const hits = findReferences(engine, next, collection, from).filter((hit) => hit.type === 'value');
  hits.forEach((hit) => {
    const holder = getAt(next, hit.path.slice(0, -1));
    holder[hit.path[hit.path.length - 1]] = to;
  });
  // keys that are pointers themselves (a map keyed by an id), outermost last so paths stay valid
  findReferences(engine, next, collection, from)
    .filter((hit) => hit.type === 'key')
    .forEach((hit) => {
      const parentPath = hit.path.slice(0, -1);
      const parent = getAt(next, parentPath);
      const renamed = renameKey(parent, from, to);
      if (parentPath.length) getAt(next, parentPath.slice(0, -1))[parentPath[parentPath.length - 1]] = renamed;
      else next = renamed;
    });
  // then the item itself
  if (info?.kind === 'list') {
    const list = getAt(next, info.path);
    if (Array.isArray(list))
      list.forEach((item) => {
        if (isObj(item) && item.id === from) item.id = to;
      });
  } else if (info?.kind === 'map') {
    const holder = getAt(next, info.path);
    if (isObj(holder) && from in holder) {
      const renamed = renameKey(holder, from, to);
      const parentPath = info.path.slice(0, -1);
      if (parentPath.length) getAt(next, parentPath)[info.path[info.path.length - 1]] = renamed;
      else next[info.path[0]] = renamed;
    }
  }
  // finally the text that mentions it
  const root = TEMPLATE_ROOT[collection];
  if (root) next = rewriteTemplates(next, root, from, to);
  return next;
}

// A copy of the config without the pointers at `id` (list entries are removed, optional fields are deleted). A pointer
// in a field the schema requires can't be removed without leaving the config invalid; those are returned in `left`.
export function removePointers(engine, config, collection, id) {
  const next = clone(config);
  const hits = findReferences(engine, next, collection, id).filter((hit) => hit.type === 'value');
  const left = [];
  // arrays: remove from the highest index down so earlier indexes stay valid
  hits
    .filter((hit) => hit.parent.kind === 'array')
    .sort((a, b) => b.parent.index - a.parent.index)
    .forEach((hit) => {
      const list = getAt(next, hit.parent.path);
      if (Array.isArray(list) && list[hit.parent.index] === id) list.splice(hit.parent.index, 1);
    });
  hits
    .filter((hit) => hit.parent.kind !== 'array')
    .forEach((hit) => {
      const holder = getAt(next, hit.parent.path);
      if (hit.parent.required || !isObj(holder)) {
        left.push(hit);
        return;
      }
      delete holder[hit.parent.key];
    });
  return { config: next, left };
}

// A copy with the item itself removed (and, for a list of objects, nothing else).
export function deleteItem(config, collection, id) {
  const info = COLLECTIONS[collection];
  const next = clone(config);
  if (info?.kind === 'list') {
    const list = getAt(next, info.path);
    if (Array.isArray(list)) {
      const at = list.findIndex((item) => isObj(item) && item.id === id);
      if (at >= 0) list.splice(at, 1);
    }
  } else if (info?.kind === 'map') {
    const holder = getAt(next, info.path);
    if (isObj(holder)) delete holder[id];
  }
  return next;
}

// ---- new ids -----------------------------------------------------------------------------------------------------

// "phone", then "phone_2", "phone_3": a base, then a counter only when the base is taken.
export function freshId(taken, base) {
  const clean =
    String(base || 'item')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^[^a-z]+/, '')
      .replace(/_+$/, '') || 'item';
  const set = new Set(taken);
  if (!set.has(clean)) return clean;
  let n = 2;
  while (set.has(`${clean}_${n}`)) n += 1;
  return `${clean}_${n}`;
}

// If this path is the `id` of an item in one of the lists above (channels[2].id, agents.items[0].id, ...), that list's
// collection. Those ids are permanent keys: the form shows them as a chip with Rename…, not as a text box.
export function lockedIdCollection(path) {
  if (!Array.isArray(path) || path.length < 3 || path[path.length - 1] !== 'id' || typeof path[path.length - 2] !== 'number') return null;
  const collection = collectionAt(path.slice(0, -2));
  return collection && COLLECTIONS[collection].kind === 'list' ? collection : null;
}
