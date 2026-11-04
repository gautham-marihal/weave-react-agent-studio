// What the schema says about one place in the configuration, for the Detailed parts' rows: what kind of value it is,
// its choices, whether it is required, its limits and its plain label. Pure: no React, no DOM.

import { schemaAtPath } from '../schemaPath.js';
import { describeSetting } from '../../form/plainLanguage.js';
import { enumLabels } from '../../form/plainEnums.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// The facts for `path`, or null when the schema has no such place (or isn't loaded yet).
//   { kind, choices: [{ value, label }], required, min, max, integer, def, label, purpose, itemKind, itemChoices }
//   kind: 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object' | 'map' | 'ref' | 'secret' | 'json' | …
//   config: the draft, so a place inside a choice of shapes (a knowledge base) is found by the shape it has
export function factsAt(engine, schema, path, config) {
  if (!engine || !schema || !Array.isArray(path) || !path.length) return null;
  const node = schemaAtPath(engine, schema, path, config);
  if (!node) return null;
  const shape = engine.flatten(node);
  const name = [...path].reverse().find((part) => typeof part === 'string') || '';
  const parent = path.length > 1 ? schemaAtPath(engine, schema, path.slice(0, -1), config) : schema;
  const parentValue = path.slice(0, -1).reduce((at, part) => (at == null ? at : at[part]), config);
  let parentShape = parent ? (engine.resolveShape ? engine.resolveShape(parent, parentValue) : engine.flatten(parent)) : null;
  // the parent is itself a choice of shapes (a knowledge base): its required keys are the chosen shape's
  if (parentShape && engine.isPureUnion?.(parentShape)) {
    const branches = engine.branchesOf(parentShape);
    if (branches.length) parentShape = engine.resolveShape(branches[engine.pickBranch(branches, parentValue)], parentValue);
  }
  const key = path[path.length - 1];
  const required = typeof key === 'string' && Array.isArray(parentShape?.required) && parentShape.required.includes(key);
  const kind = engine.kindOf(shape);
  const said = describeSetting(name, { path, description: shape.description });
  const choicesOf = (values, word) => {
    const labels = enumLabels(word, values);
    return values.filter((v) => v !== null).map((value) => ({ value, label: labels[value] || String(value) }));
  };
  const items = kind === 'array' && shape.items ? engine.flatten(shape.items) : null;
  const itemKind = items ? engine.kindOf(items) : null;
  return {
    kind,
    shape,
    choices: Array.isArray(shape.enum) ? choicesOf(shape.enum, name) : [],
    itemKind,
    itemChoices: items && Array.isArray(items.enum) ? choicesOf(items.enum, name) : [],
    required,
    min: typeof shape.minimum === 'number' ? shape.minimum : undefined,
    max: typeof shape.maximum === 'number' ? shape.maximum : undefined,
    integer: [].concat(shape.type || []).includes('integer'),
    def: shape.default,
    label: said?.label || name,
    purpose: said?.purpose || '',
  };
}

// `root` with `value` at `path`, creating a list (not an object) where the next part is an index, and an object where
// it is a key. Arrays and objects are copied along the way; the rest is shared. `undefined` removes the key.
export function setPath(root, path, value) {
  if (!path.length) return value;
  const [head, ...rest] = path;
  const copy = Array.isArray(root) ? [...root] : typeof head === 'number' ? [] : { ...(isObj(root) ? root : {}) };
  const below = root == null ? undefined : root[head];
  const next = rest.length ? setPath(below === undefined && typeof rest[0] === 'number' ? [] : below, rest, value) : value;
  if (next === undefined && !Array.isArray(copy)) delete copy[head];
  else copy[head] = next;
  return copy;
}
