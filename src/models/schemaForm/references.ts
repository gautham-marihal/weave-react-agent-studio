// Where a config's ids are used, and how to rename or delete one without breaking the `x-ref` fields pointing at it.
// Walks the config by the schema (through the form engine, so $ref / allOf / oneOf resolve as in the form), at any
// depth. Pure: no network, no DOM.
import type { Path } from '../../types/studio';
import { isObj, type Json, type SchemaEngine, type SchemaNode } from './engine';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const getAt = (root: unknown, path: Path): unknown =>
  path.reduce<unknown>((node, part) => (node === null || node === undefined ? node : (node as Record<string | number, unknown>)[part]), root);

// A collection an `x-ref` can name, and every x-ref name that points into the same set of ids.
const SAME_IDS: Record<string, string[]> = {
  tools: ['tools', 'tool_names'],
  tool_names: ['tools', 'tool_names'],
  connections: ['http_connections', 'mcp_connections', 'notifiers'],
  http_connections: ['http_connections', 'mcp_connections', 'notifiers'],
  mcp_connections: ['http_connections', 'mcp_connections', 'notifiers'],
  notifiers: ['http_connections', 'mcp_connections', 'notifiers'],
};
export const sameIds = (collection: string): string[] => SAME_IDS[collection] || [collection];

// What a `{{root.name}}` template says about each collection, for rewriting the text that mentions a renamed id.
const TEMPLATE_ROOT: Record<string, string> = { state_vars: 'state', constants: 'const' };

export interface CollectionInfo {
  kind: 'list' | 'map';
  path: string[];
  word: string;
  pattern?: string;
}

/** The collections that can be renamed, and where their ids live: lists of objects with an `id`, or maps keyed by name. */
export const COLLECTIONS: Record<string, CollectionInfo> = {
  channels: { kind: 'list', path: ['channels'], word: 'channel' },
  agents: { kind: 'list', path: ['agents', 'items'], word: 'agent' },
  tools: { kind: 'list', path: ['tools'], word: 'tool' },
  tasks: { kind: 'list', path: ['tasks'], word: 'task' },
  knowledge: { kind: 'list', path: ['knowledge'], word: 'knowledge base' },
  forms: { kind: 'list', path: ['forms'], word: 'form' },
  wrapups: { kind: 'list', path: ['wrapups'], word: 'closing message' },
  messages: { kind: 'list', path: ['messages'], word: 'fixed line' },
  notifications: { kind: 'list', path: ['notifications'], word: 'message to send' },
  transfers: { kind: 'list', path: ['telephony', 'transfers'], word: 'transfer' },
  input_guardrails: { kind: 'list', path: ['guardrails', 'input'], word: 'safety rule' },
  schedules: { kind: 'map', path: ['schedules'], word: 'schedule' },
  state_vars: { kind: 'map', path: ['state', 'variables'], word: 'remembered value', pattern: '^[a-z][a-z0-9_]{0,63}$' },
  connections: { kind: 'map', path: ['connections'], word: 'connection' },
  constants: { kind: 'map', path: ['constants'], word: 'fixed value', pattern: '^[a-z][a-z0-9_]{0,63}$' },
};
export const ID_PATTERN = '^[a-z][a-z0-9_-]{0,63}$';

/** The collection a list or map at this path is, if it is one. */
export function collectionAt(path: Path): string | null {
  const flat = path.map((part) => (typeof part === 'number' ? '#' : part)).join('.');
  const entry = Object.entries(COLLECTIONS).find(([, info]) => info.path.join('.') === flat.replace(/\.#$/, ''));
  return entry ? entry[0] : null;
}

// ---- finding every pointer ------------------------------------------------------------------------------------------

export interface RefParent {
  path: Path;
  kind: 'object' | 'array' | 'map';
  key?: string;
  index?: number;
  required?: boolean;
}
export interface RefHit {
  path: Path;
  collection?: string;
  value?: string;
  type: 'value' | 'key' | 'template';
  parent?: RefParent;
}

function walk(engine: SchemaEngine, schema: SchemaNode, value: unknown, path: Path, parent: RefParent, visit: (hit: RefHit) => void, depth = 0): void {
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
      if (sub) walk(engine, sub, value[key], [...path, key], { path, kind: 'object', key, required: shape.required.includes(key) }, visit, depth + 1);
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

/** Every pointer in the config: each field that names an id of another collection. */
export function allReferences(engine: SchemaEngine, config: unknown): RefHit[] {
  const hits: RefHit[] = [];
  const c = isObj(config) ? config : {};
  Object.keys(c).forEach((key) => {
    const sub = engine.root.properties?.[key];
    if (sub) walk(engine, sub, c[key], [key], { path: [], kind: 'object', key, required: false }, (hit) => hits.push(hit));
  });
  return hits;
}

/** Every place that points at `id` of this collection. */
export function findReferences(engine: SchemaEngine, config: unknown, collection: string, id: string): RefHit[] {
  const group = sameIds(collection);
  return allReferences(engine, config).filter((hit) => !!hit.collection && group.includes(hit.collection) && hit.value === id);
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Plain-text mentions: `{{state.name}}` for a state variable, `{{const.name}}` for a constant.
function templateHits(config: unknown, collection: string, id: string): RefHit[] {
  const root = TEMPLATE_ROOT[collection];
  if (!root) return [];
  const pattern = new RegExp(`\\b${root}\\.${escape(id)}(?![A-Za-z0-9_])`);
  const hits: RefHit[] = [];
  const visit = (node: unknown, path: Path) => {
    if (typeof node === 'string') {
      const blocks = node.match(/\{\{[^}]*\}\}/g) || [];
      if (blocks.some((block) => pattern.test(block))) hits.push({ path, type: 'template' });
    } else if (Array.isArray(node)) node.forEach((item, index) => visit(item, [...path, index]));
    else if (isObj(node)) Object.keys(node).forEach((key) => visit(node[key], [...path, key]));
  };
  visit(config, []);
  return hits;
}

/** Every pointer at `id`, and the text that mentions it. */
export function findUsage(engine: SchemaEngine, config: unknown, collection: string, id: string): RefHit[] {
  return [...findReferences(engine, config, collection, id), ...templateHits(config, collection, id)];
}

// ---- describing a place ---------------------------------------------------------------------------------------------

const WORDS: Record<string, string> = {
  agents: 'agent',
  tools: 'tool',
  channels: 'channel',
  tasks: 'task',
  forms: 'form',
  messages: 'fixed line',
  wrapups: 'closing message',
  notifications: 'message to send',
  knowledge: 'knowledge base',
  guardrails: 'safety rule',
  events: 'event',
  schedules: 'schedule',
  state: 'state',
  connections: 'connection',
  constants: 'fixed value',
  telephony: 'transfer',
  tests: 'test',
  post_call: 'after-the-call setting',
};
const wordFor = (section: string) => WORDS[section] || section;

/** "tool “lookup”" for a path inside the tools list, "agent “billing”" inside an agent: the nearest named item. */
export function placeLabel(config: unknown, path: Path): string {
  const section = String(path[0]);
  for (let i = 1; i < path.length; i += 1) {
    if (typeof path[i] !== 'number') continue;
    const item = getAt(config, path.slice(0, i + 1));
    if (isObj(item) && typeof item.id === 'string') return `${wordFor(section)} “${item.id}”`;
  }
  if (section === 'state' && path[2]) return `remembered value “${path[2]}”`;
  if (['connections', 'schedules', 'constants'].includes(section) && path[1]) return `${wordFor(section)} “${path[1]}”`;
  return path.slice(0, 3).map(String).join(' › ');
}

/** The places a set of hits are in, once each. */
export function describeUsage(config: unknown, hits: RefHit[]): string[] {
  const places: string[] = [];
  const seen = new Set<string>();
  hits.forEach((hit) => {
    const text = placeLabel(config, hit.path);
    if (!seen.has(text)) {
      seen.add(text);
      places.push(text);
    }
  });
  return places;
}

// ---- changing -------------------------------------------------------------------------------------------------------

function renameKey(parent: Json, from: string, to: string): Json {
  const out: Json = {};
  Object.keys(parent).forEach((key) => {
    out[key === from ? to : key] = parent[key];
  });
  return out;
}

function rewriteTemplates(node: unknown, root: string, from: string, to: string): unknown {
  const pattern = new RegExp(`\\b${root}\\.${escape(from)}(?![A-Za-z0-9_])`, 'g');
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') return value.replace(/\{\{[^}]*\}\}/g, (block) => block.replace(pattern, `${root}.${to}`));
    if (Array.isArray(value)) return value.map(visit);
    if (isObj(value)) {
      const out: Json = {};
      Object.keys(value).forEach((key) => {
        out[key] = visit(value[key]);
      });
      return out;
    }
    return value;
  };
  return visit(node);
}

const lastOf = (path: Path) => path[path.length - 1];

/** A copy of the config where `from` of this collection is called `to` everywhere: the item and every pointer. */
export function renameEverywhere<T>(engine: SchemaEngine, config: T, collection: string, from: string, to: string): T {
  if (from === to) return config;
  const info = COLLECTIONS[collection];
  let next = clone(config) as unknown as Json;
  // the pointers first (they are found by value, so the item must still carry the old name)
  findReferences(engine, next, collection, from)
    .filter((hit) => hit.type === 'value')
    .forEach((hit) => {
      const holder = getAt(next, hit.path.slice(0, -1)) as Record<string | number, unknown>;
      holder[lastOf(hit.path)] = to;
    });
  // keys that are pointers themselves (a map keyed by an id)
  findReferences(engine, next, collection, from)
    .filter((hit) => hit.type === 'key')
    .forEach((hit) => {
      const parentPath = hit.path.slice(0, -1);
      const parent = getAt(next, parentPath) as Json;
      const renamed = renameKey(parent, from, to);
      if (parentPath.length) (getAt(next, parentPath.slice(0, -1)) as Record<string | number, unknown>)[lastOf(parentPath)] = renamed;
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
      if (parentPath.length) (getAt(next, parentPath) as Json)[info.path[info.path.length - 1]] = renamed;
      else next[info.path[0]] = renamed;
    }
  }
  // finally the text that mentions it
  const root = TEMPLATE_ROOT[collection];
  if (root) next = rewriteTemplates(next, root, from, to) as Json;
  return next as unknown as T;
}

/**
 * A copy of the config without the pointers at `id` (list entries are removed, optional fields deleted). A pointer
 * in a field the schema requires can't be removed without leaving the config invalid; those come back in `left`.
 */
export function removePointers<T>(engine: SchemaEngine, config: T, collection: string, id: string): { config: T; left: RefHit[] } {
  const next = clone(config);
  const hits = findReferences(engine, next, collection, id).filter((hit) => hit.type === 'value');
  const left: RefHit[] = [];
  // arrays: remove from the highest index down so earlier indexes stay valid
  hits
    .filter((hit) => hit.parent?.kind === 'array')
    .sort((a, b) => (b.parent?.index ?? 0) - (a.parent?.index ?? 0))
    .forEach((hit) => {
      const list = getAt(next, hit.parent?.path ?? []);
      const index = hit.parent?.index ?? -1;
      if (Array.isArray(list) && list[index] === id) list.splice(index, 1);
    });
  hits
    .filter((hit) => hit.parent?.kind !== 'array')
    .forEach((hit) => {
      const holder = getAt(next, hit.parent?.path ?? []);
      if (hit.parent?.required || !isObj(holder) || hit.parent?.key === undefined) {
        left.push(hit);
        return;
      }
      delete holder[hit.parent.key];
    });
  return { config: next, left };
}

/** A copy with the item itself removed, and nothing else. */
export function deleteItem<T>(config: T, collection: string, id: string): T {
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

// ---- new ids --------------------------------------------------------------------------------------------------------

const ID_MAX = 64;

/** "phone", then "phone_2", "phone_3": a counter only when the base is taken. Long bases are cut to leave room. */
export function freshId(taken: Iterable<unknown>, base: unknown): string {
  const clean =
    String(base || 'item')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^[^a-z]+/, '')
      .replace(/_+$/, '') || 'item';
  const fit = (tail = '') => `${clean.slice(0, ID_MAX - tail.length).replace(/_+$/, '')}${tail}`;
  const set = new Set(taken);
  if (!set.has(fit())) return fit();
  let n = 2;
  while (set.has(fit(`_${n}`))) n += 1;
  return fit(`_${n}`);
}

/**
 * If this path is the `id` of an item in one of the lists above (channels[2].id, agents.items[0].id…), that list's
 * collection. Those ids are permanent keys: the form shows them as a chip with Rename, not as a text box.
 */
export function lockedIdCollection(path: Path): string | null {
  if (path.length < 3 || path[path.length - 1] !== 'id' || typeof path[path.length - 2] !== 'number') return null;
  const collection = collectionAt(path.slice(0, -2));
  return collection && COLLECTIONS[collection].kind === 'list' ? collection : null;
}
