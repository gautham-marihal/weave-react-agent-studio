// How the form decides to draw a list or an object: as a card with a title, as chips, as a plain list of texts. Pure: no DOM.

import { isObj } from './engine.js';
import { plainKind, plainToolKind } from './plainKinds.js';

const TITLE_KEYS = ['id', 'name', 'title', 'label'];
const ALT_KEYS = ['type', 'on', 'tool', 'via', 'state', 'arg', 'result', 'event', 'from', 'channel', 'schedule', 'kind', 'to'];

// The title and the grey hint of a card, from what the item says about itself.
export function summarize(item, index) {
  if (!isObj(item)) return { title: `#${index + 1}`, hint: item === null ? 'none' : String(JSON.stringify(item)).slice(0, 60) };
  const text = (v) => (typeof v === 'string' && v ? v : null);
  let title = TITLE_KEYS.map((k) => text(item[k])).find(Boolean);
  const alt = ALT_KEYS.map((k) => text(item[k])).find(Boolean);
  title = title || alt || `Item ${index + 1}`;
  let hint = '';
  if (alt && alt !== title) hint = item.type === 'builtin' && item.builtin ? plainToolKind(item) : plainKind(alt);
  else {
    const note =
      text(item.description) ||
      text(item.text) ||
      text(item.text?.message) ||
      text(item.ask) ||
      text(item.instructions) ||
      text(item.instructions?.role) ||
      text(item.to);
    if (note) hint = note.length > 70 ? `${note.slice(0, 70)}…` : note;
  }
  return { title, hint };
}

// Does a value of this schema need a card of its own (an object, a map, a list of cards, or a choice of objects)?
export function isComplex(engine, schema) {
  const shape = engine.resolveShape(schema, undefined);
  const kind = engine.kindOf(shape);
  if (kind === 'object' || kind === 'map') return true;
  if (kind === 'array') return arrayStyle(engine, shape) === 'cards';
  if (kind === 'union') return engine.branchesOf(shape).some((b) => ['object', 'map'].includes(engine.kindOf(engine.flatten(b))));
  return false;
}

// 'pick' (ids chosen from another list), 'checks' (a few fixed values), 'strings' (free texts) or 'cards' (objects).
export function arrayStyle(engine, shape) {
  const items = engine.flatten(shape.items);
  const kind = engine.kindOf(items);
  if (kind === 'ref') return 'pick';
  if (kind === 'enum') return 'checks';
  if (kind === 'string') return 'strings';
  return 'cards';
}

// A branch of a choice is plainly the one meant when the value carries the branch's fixed marker (`type: "http"`), even if other
// required fields are still missing. Then the form should show that branch's editor, with what is missing marked, not give up and
// show raw JSON.
export function matchesDiscriminator(engine, branch, value) {
  if (!isObj(value)) return false;
  const properties = engine.flatten(branch).properties || {};
  const markers = Object.entries(properties).filter(([, schema]) => engine.flatten(schema).const !== undefined);
  return markers.length > 0 && markers.every(([key, schema]) => value[key] === engine.flatten(schema).const);
}

// Switching an object to another kind of the same choice starts from that kind's defaults but keeps what the two share (an id, a
// description, the channels it is offered on…), in the new kind's field order. A field that points at another collection is not
// carried: what it names may not exist there (an HTTP connection is not an MCP one).
export function carryOver(engine, previous, branch, fresh) {
  if (!isObj(previous) || !isObj(fresh)) return fresh;
  const properties = engine.flatten(branch).properties || {};
  const merged = { ...fresh };
  Object.entries(previous).forEach(([key, value]) => {
    const schema = properties[key];
    if (!schema || value === undefined || value === '') return;
    const flat = engine.flatten(schema);
    if (flat.const !== undefined || flat['x-ref']) return;
    merged[key] = value;
  });
  const ordered = {};
  Object.keys(properties).forEach((key) => {
    if (key in merged) ordered[key] = merged[key];
  });
  Object.keys(merged).forEach((key) => {
    if (!(key in ordered)) ordered[key] = merged[key];
  });
  return ordered;
}

// Is this array a list of actions (each one of say, generate, set state, hand off, end the call…)? Then it is drawn as numbered steps.
export function isActionList(engine, shape) {
  if (engine.kindOf(shape) !== 'array' || !shape.items) return false;
  const items = engine.flatten(shape.items);
  if (engine.kindOf(items) !== 'union') return false;
  const types = engine.branchesOf(items).map((branch) => engine.flatten(branch).properties?.type?.const);
  return types.length > 0 && types.every((type) => typeof type === 'string') && types.includes('say');
}

// Is this array a list of rules (`when` and `do`, where `do` is a list of actions)? Then it is drawn as rules with steps.
export function isRuleList(engine, shape) {
  if (engine.kindOf(shape) !== 'array' || !shape.items) return false;
  const items = engine.flatten(shape.items);
  const keys = Object.keys(items.properties || {});
  // only rules made of exactly `when` and `do`: an item with more to show (an event also has `on`) keeps its ordinary card
  return keys.length > 0 && keys.every((key) => key === 'when' || key === 'do') && keys.includes('do') && isActionList(engine, items.properties.do);
}
