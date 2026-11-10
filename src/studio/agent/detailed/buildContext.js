import { createContext, useContext, useSyncExternalStore } from 'react';

// What Build's parts share beside the draft: each part's state (buildSections.js, given by AgentLayout), so a part's
// header says the same as the side list, and the person's choice to show every advanced setting at once.

export const BuildSectionsContext = createContext(null);
// a part's state ({ state: 'done' | 'todo' | 'attention' | 'optional', status }), or null outside an agent
export const useBuildSection = (id) => useContext(BuildSectionsContext)?.find((s) => s.id === id) || null;

// The words for a part's state, the same in the side list and the part's header
export const STATE_WORDS = { done: 'Set up', todo: 'To do', attention: 'Needs attention', optional: 'Optional' };

// "Show advanced settings": one choice per person, remembered in this browser, followed by every part at once
const KEY = 'weave_build_advanced';
const listeners = new Set();
const stored = () => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};
let showAll = stored();
export function setShowAdvanced(next) {
  showAll = !!next;
  try {
    localStorage.setItem(KEY, showAll ? '1' : '0');
  } catch {
    /* a browser that keeps nothing: the choice lasts until the page closes */
  }
  listeners.forEach((listener) => listener());
}
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const useShowAdvanced = () =>
  useSyncExternalStore(
    subscribe,
    () => showAll,
    () => false,
  );
