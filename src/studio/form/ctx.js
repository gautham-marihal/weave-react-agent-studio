import { createContext, useCallback, useContext, useRef, useState, useSyncExternalStore } from 'react';
import { formatPath } from '../format.js';

// Shared by every node of the form: the schema engine, ids that references may point at, issues by path, jump target.
// Stable while typing (else every card re-renders per keystroke); parts read the config with useConfigSelect instead.
export const FormCtx = createContext(null);
export const useForm = () => useContext(FormCtx);

// The schema property whose object a setting is inside ('inactivity' for `timeout_s`, '' at the top). plainLanguage.js
// needs it to tell same-named settings apart; a path can't, as map keys are the author's own.
export const OwnerCtx = createContext('');
export const useOwner = () => useContext(OwnerCtx);

// The config as a tiny store: `get()` is always the latest, `subscribe` hears each change. The editor puts one in
// `ctx.store`; a test or another screen can make its own.
export function createConfigStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set(next) {
      value = next;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify() {
      listeners.forEach((listener) => listener());
    },
  };
}

const sameJson = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

// Re-renders only when `selector(config)` changes (compared as JSON, so a selector may build new objects). Keep the
// selector cheap: it runs on every config change.
export function useConfigSelect(selector, equal = sameJson) {
  const { store } = useContext(FormCtx);
  const last = useRef(null);
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const getSnapshot = useCallback(() => {
    const next = selectorRef.current(store.get());
    if (last.current && equal(last.current.value, next)) return last.current.value;
    last.current = { value: next };
    return next;
  }, [store, equal]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

// The same function on every render, always running the latest `fn`, so a memoised child never sees a "new" prop.
export function useStableCallback(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args) => ref.current(...args), []);
}

// One stable handler per key, each running the latest `call(key, ...args)`,
// so unchanged list items get identical props and skip rendering.
export function useKeyedHandlers(call) {
  const latest = useRef(call);
  latest.current = call;
  const cache = useRef(new Map());
  return useCallback((key) => {
    let handler = cache.current.get(key);
    if (!handler) {
      handler = (...args) => latest.current(key, ...args);
      cache.current.set(key, handler);
    }
    return handler;
  }, []);
}

// React keys that follow list items, not places, so an item's open card, sheet and focus move and go with it. Same
// object or same content keeps the key; the rest pair up in order, so the item being typed in keeps its key too.
let keySeq = 0;
const newKey = () => {
  keySeq += 1;
  return `item-${keySeq}`;
};
export function useItemKeys(list) {
  const [state, setState] = useState(() => ({ items: list, keys: list.map(newKey) }));
  if (state.items === list || (state.items.length === list.length && state.items.every((item, i) => item === list[i]))) return state.keys;
  const used = new Set();
  const take = (same) => (item) => {
    const at = state.items.findIndex((old, i) => !used.has(i) && same(old, item));
    if (at === -1) return null;
    used.add(at);
    return state.keys[at];
  };
  const byObject = list.map((item) => (item !== null && typeof item === 'object' ? take((old, x) => old === x)(item) : null));
  const json = (v) => JSON.stringify(v);
  const byContent = byObject.map((key, i) => key ?? take((old, x) => json(old) === json(x))(list[i]));
  const left = state.keys.filter((_, i) => !used.has(i));
  const keys = byContent.map((key) => key ?? left.shift() ?? newKey());
  setState({ items: list, keys });
  return keys;
}

// Returns the previous value while the new one is the same JSON, so
// a value rebuilt on every change (the id lists) keeps one identity.
export function useStableValue(value) {
  const ref = useRef(value);
  if (!sameJson(ref.current, value)) ref.current = value;
  return ref.current;
}

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
  const clean =
    String(base || 'item')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^[^a-z]+/, '')
      .replace(/_+$/, '') || 'item';
  const set = new Set(taken);
  let n = 1;
  while (set.has(`${clean}_${n}`)) n += 1;
  return `${clean}_${n}`;
}

// Object with `key` set, keeping the schema's property order for new keys (existing keys keep their place).
export function orderedSet(obj, key, value, order) {
  if (key in obj) return { ...obj, [key]: value };
  const merged = { ...obj, [key]: value };
  const rank = (k) => {
    const i = order.indexOf(k);
    return i === -1 ? order.length + 1 : i;
  };
  const out = {};
  Object.keys(merged)
    .sort((a, b) => rank(a) - rank(b) || Object.keys(merged).indexOf(a) - Object.keys(merged).indexOf(b))
    .forEach((k) => {
      out[k] = merged[k];
    });
  return out;
}

export function omit(obj, key) {
  const { [key]: _removed, ...rest } = obj;
  return rest;
}
