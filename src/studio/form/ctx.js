import { createContext, useCallback, useContext, useRef, useSyncExternalStore } from 'react';
import { formatPath } from '../format.js';

// Shared by every node of the form: the schema engine, the ids that references may point at, the
// validation issues by path, and where the user last asked to jump to.
//
// What is in here is STABLE while a person types: it changes when the schema, the lists of ids, the issues or the focus change, never
// because one letter was typed. (If it carried the whole config, every keystroke would change it and every card of a big agent would
// re-render.) A component that needs something from the config asks for exactly that with useConfigSelect, below, and re-renders only
// when what it asked for changes.
export const FormCtx = createContext(null);
export const useForm = () => useContext(FormCtx);

// The schema property whose object a setting is drawn inside ('inactivity' for `timeout_s`, '' at the top). The plain-language catalogue
// needs it to tell the settings that share a name apart (see plainLanguage.js); a path can't say, because a map's keys are the author's own.
export const OwnerCtx = createContext('');
export const useOwner = () => useContext(OwnerCtx);

// The config as a tiny store: `get()` is always the latest, `subscribe` is told after each change. The editor keeps one and puts it in the
// context (`ctx.store`); a test or another screen can make its own with a fixed config.
export function createConfigStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set(next) { value = next; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    notify() { listeners.forEach((listener) => listener()); },
  };
}

const sameJson = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

// Reads something derived from the whole config (`(config) => value`) and re-renders only when that value changes (compared as JSON, so a
// selector may build a new list or object each time). Keep the selector cheap: it runs on every change of the config.
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

// A function that is the same function on every render but always runs the latest `fn`: for handing a callback to a memoised child without
// the child seeing a "new" prop each time.
export function useStableCallback(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args) => ref.current(...args), []);
}

// One stable handler per key, each running the latest `call(key, ...args)`: so a list can give every item its own onChange and the items
// that did not change get exactly the props they had, and can skip rendering.
export function useKeyedHandlers(call) {
  const latest = useRef(call);
  latest.current = call;
  const cache = useRef(new Map());
  return useCallback((key) => {
    let handler = cache.current.get(key);
    if (!handler) { handler = (...args) => latest.current(key, ...args); cache.current.set(key, handler); }
    return handler;
  }, []);
}

// Returns the previous value when the new one is the same JSON, so something rebuilt on every change (the lists of ids) keeps one identity
// until it really changes.
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
