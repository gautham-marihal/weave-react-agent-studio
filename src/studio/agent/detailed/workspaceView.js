import { useSyncExternalStore } from 'react';

// How a person sees a Build part that has two views: its story (Agent's profile, Conversation's overview) or 'all'
// (every setting in one searchable list). One choice per person and part, remembered in this browser.
// makeViewStore(key, first) -> { set(view), use() }: `first` is the story view's name, the one shown until 'all' is picked.
export function makeViewStore(key, first) {
  const listeners = new Set();
  const stored = () => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(key) === 'all' ? 'all' : first;
    } catch {
      return first;
    }
  };
  let view = stored();
  const set = (next) => {
    view = next === 'all' ? 'all' : first;
    try {
      localStorage.setItem(key, view);
    } catch {
      /* a browser that keeps nothing: the choice lasts until the page closes */
    }
    listeners.forEach((listener) => listener());
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const use = () =>
    useSyncExternalStore(
      subscribe,
      () => view,
      () => first,
    );
  return { set, use };
}
