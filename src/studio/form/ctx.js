import { createContext, useContext } from 'react';
import { formatPath } from '../format.js';

// Shared by every node of the form: the schema engine, the ids that references may point at, the
// validation issues by path, and where the user last asked to jump to.
export const FormCtx = createContext(null);
export const useForm = () => useContext(FormCtx);

export const keyOf = (path) => formatPath(path);

export const isUnder = (key, parent) => key === parent || key.startsWith(`${parent}.`) || key.startsWith(`${parent}[`);

// "tools" -> "tool", "agents" -> "agent": a base for the id of a new list item.
export function singular(word) {
  const w = String(word || 'item');
  if (w === 'analysis') return 'analysis';
  if (w === 'knowledge') return 'knowledge';
  if (/ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

export function uniqueId(taken, base) {
  const clean = String(base || 'item').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '').replace(/_+$/, '') || 'item';
  const set = new Set(taken);
  let n = 1;
  while (set.has(`${clean}_${n}`)) n += 1;
  return `${clean}_${n}`;
}

// Object with `key` set, keeping the schema's property order for new keys (existing keys keep their place).
export function orderedSet(obj, key, value, order) {
  if (key in obj) return { ...obj, [key]: value };
  const merged = { ...obj, [key]: value };
  const rank = (k) => { const i = order.indexOf(k); return i === -1 ? order.length + 1 : i; };
  const out = {};
  Object.keys(merged).sort((a, b) => rank(a) - rank(b) || Object.keys(merged).indexOf(a) - Object.keys(merged).indexOf(b)).forEach((k) => { out[k] = merged[k]; });
  return out;
}

export function omit(obj, key) {
  const { [key]: _removed, ...rest } = obj;
  return rest;
}
