// How the form draws a list or an object: as a titled card, as chips, or as a plain list of texts. Pure: no DOM.
import { isObj, type Json, type SchemaEngine, type SchemaNode, type Shape } from './engine';
import { plainKind, plainToolKind } from './plainKinds';

const TITLE_KEYS = ['id', 'name', 'title', 'label'];
const ALT_KEYS = ['type', 'on', 'tool', 'via', 'state', 'arg', 'result', 'event', 'from', 'channel', 'schedule', 'kind', 'to'];

/** The title and the grey hint of a card, from what the item says about itself. */
export function summarize(item: unknown, index: number): { title: string; hint: string } {
  if (!isObj(item)) return { title: `#${index + 1}`, hint: item === null ? 'none' : String(JSON.stringify(item)).slice(0, 60) };
  const text = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const titled = TITLE_KEYS.map((k) => text(item[k])).find(Boolean);
  const alt = ALT_KEYS.map((k) => text(item[k])).find(Boolean);
  const title = titled || alt || `Item ${index + 1}`;
  let hint = '';
  if (alt && alt !== title)
    hint = (item.type === 'builtin' && item.builtin) || (item.type === 'http' && isObj(item.request)) ? plainToolKind(item) : plainKind(alt);
  else {
    const inner = (v: unknown, key: string) => (isObj(v) ? text(v[key]) : null);
    const note =
      text(item.description) ||
      text(item.text) ||
      inner(item.text, 'message') ||
      text(item.ask) ||
      text(item.instructions) ||
      inner(item.instructions, 'role') ||
      text(item.to);
    if (note) hint = note.length > 70 ? `${note.slice(0, 70)}…` : note;
  }
  return { title, hint };
}

/** Does a value of this schema need a card of its own (an object, a map, a list of cards, or a choice of objects)? */
export function isComplex(engine: SchemaEngine, schema: SchemaNode): boolean {
  const shape = engine.resolveShape(schema, undefined);
  const kind = engine.kindOf(shape);
  if (kind === 'object' || kind === 'map') return true;
  if (kind === 'array') return arrayStyle(engine, shape) === 'cards';
  if (kind === 'union') return engine.branchesOf(shape).some((b) => ['object', 'map'].includes(engine.kindOf(engine.flatten(b))));
  return false;
}

export type ArrayStyle = 'pick' | 'checks' | 'strings' | 'cards';

/** 'pick' (ids chosen from another list), 'checks' (a few fixed values), 'strings' (free texts) or 'cards' (objects). */
export function arrayStyle(engine: SchemaEngine, shape: Shape): ArrayStyle {
  const items = engine.flatten(shape.items);
  const kind = engine.kindOf(items);
  if (kind === 'ref') return 'pick';
  if (kind === 'enum') return 'checks';
  if (kind === 'string') return 'strings';
  return 'cards';
}

/** A value carrying a branch's fixed marker (`type: "http"`) means that branch, even with required fields missing. */
export function matchesDiscriminator(engine: SchemaEngine, branch: SchemaNode, value: unknown): boolean {
  if (!isObj(value)) return false;
  const properties = engine.flatten(branch).properties || {};
  const markers = Object.entries(properties).filter(([, schema]) => engine.flatten(schema).const !== undefined);
  return markers.length > 0 && markers.every(([key, schema]) => value[key] === engine.flatten(schema).const);
}

/**
 * Switching kind starts from the new kind's defaults but keeps shared fields (id, description, channels…) in its
 * order. A field pointing at another collection is dropped: what it names may not exist there.
 */
export function carryOver(engine: SchemaEngine, previous: unknown, branch: SchemaNode, fresh: unknown): unknown {
  if (!isObj(previous) || !isObj(fresh)) return fresh;
  const properties = engine.flatten(branch).properties || {};
  const merged: Json = { ...fresh };
  Object.entries(previous).forEach(([key, value]) => {
    const schema = properties[key];
    if (!schema || value === undefined || value === '') return;
    const flat = engine.flatten(schema);
    if (flat.const !== undefined || flat['x-ref']) return;
    merged[key] = value;
  });
  const ordered: Json = {};
  Object.keys(properties).forEach((key) => {
    if (key in merged) ordered[key] = merged[key];
  });
  Object.keys(merged).forEach((key) => {
    if (!(key in ordered)) ordered[key] = merged[key];
  });
  return ordered;
}

/** A list of actions (say, generate, set state, hand off, end the call…)? */
export function isActionList(engine: SchemaEngine, shape: SchemaNode): boolean {
  const s = engine.flatten(shape);
  if (engine.kindOf(s) !== 'array' || !s.items) return false;
  const items = engine.flatten(s.items);
  if (engine.kindOf(items) !== 'union') return false;
  const types = engine.branchesOf(items).map((branch) => {
    const type = engine.flatten(branch).properties.type;
    return isObj(type) ? type.const : undefined;
  });
  return types.length > 0 && types.every((type) => typeof type === 'string') && types.includes('say');
}

/** A list of rules (`when` and `do`, where `do` is a list of actions)? */
export function isRuleList(engine: SchemaEngine, shape: SchemaNode): boolean {
  const s = engine.flatten(shape);
  if (engine.kindOf(s) !== 'array' || !s.items) return false;
  const items = engine.flatten(s.items);
  const keys = Object.keys(items.properties || {});
  return keys.length > 0 && keys.every((key) => key === 'when' || key === 'do') && keys.includes('do') && isActionList(engine, items.properties.do);
}
