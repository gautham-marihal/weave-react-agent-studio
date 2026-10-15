import { useCallback, useSyncExternalStore } from 'react';

// A choice one person makes about how the studio looks or behaves, kept in this browser (localStorage). Every part of the page that reads
// the same key sees a change at once, and so does another tab. When storage is blocked the choice still holds until the page is closed.
const listeners = new Set();
const memory = new Map();

function read(key, fallback) {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored !== null) return stored;
  } catch { /* storage unavailable */ }
  return memory.has(key) ? memory.get(key) : fallback;
}

export function setPref(key, value) {
  memory.set(key, value);
  try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener) => {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener); };
};

// [value, set] for a string preference.
export function usePref(key, fallback) {
  const value = useSyncExternalStore(subscribe, () => read(key, fallback), () => fallback);
  const set = useCallback((next) => setPref(key, next), [key]);
  return [value, set];
}

// "Show technical names": off, a customer sees plain labels only; on, every setting also shows the name the configuration file uses for it,
// and can copy its path or open it in the JSON.
export const TECHNICAL_NAMES_KEY = 'weave_tech_names';
export function useTechnicalNames() {
  const [value, set] = usePref(TECHNICAL_NAMES_KEY, '0');
  const setOn = useCallback((on) => set(on ? '1' : '0'), [set]);
  return [value === '1', setOn];
}

// Density: "comfortable" (the default) or "compact", for people who live in the tool all day. It is a preference of the person, kept in this browser, and
// applied as an attribute of the page so one set of tokens (tokens.css) changes the spacing everywhere.
export const DENSITY_KEY = 'weave_density';
export const DENSITIES = ['comfortable', 'compact'];
export function useDensity() {
  const [value, set] = usePref(DENSITY_KEY, 'comfortable');
  const density = DENSITIES.includes(value) ? value : 'comfortable';
  return [density, set];
}
