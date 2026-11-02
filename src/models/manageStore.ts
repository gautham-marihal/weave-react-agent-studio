// Small values kept in this browser (localStorage) that several screens read at once: the workspaces, which agents are
// removed from the list, favourite voices. Each key is one store: a change is written to storage, told to every screen
// that listens, and (unless `sync` is off) picked up when another tab changes it. Nothing here is ever sent anywhere.

type Listener = () => void;

export interface BrowserStore<T> {
  get: () => T;
  set: (next: T) => void;
  update: (fn: (now: T) => T) => void;
  subscribe: (listener: Listener) => () => void;
  /** Forget what was read, so the next `get` reads storage again (another tab changed it; tests). */
  reload: () => void;
}

interface Options {
  /** Follow changes made in other tabs (default true). Off for what is each tab's own, such as the open workspace. */
  sync?: boolean;
}

/** This browser's storage, or null where there is none (tests, a locked-down browser). */
export function browserStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readJson(key: string): unknown {
  try {
    const raw = browserStorage()?.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

/** Writes a value; false when this browser could not keep it (storage full or switched off). */
export function writeJson(key: string, value: unknown): boolean {
  try {
    const storage = browserStorage();
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** A list of strings from storage: anything else saved under the key (an older shape, an edit by hand) reads as empty. */
export const stringList = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && !!x) : []);

/** A map of strings to strings from storage, dropping anything else. */
export function stringMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

export function browserStore<T>(key: string, parse: (raw: unknown) => T, { sync = true }: Options = {}): BrowserStore<T> {
  let value: T | undefined;
  let read = false;
  const listeners = new Set<Listener>();
  const notify = () => listeners.forEach((l) => l());

  const get = () => {
    if (!read) {
      value = parse(readJson(key));
      read = true;
    }
    return value as T;
  };
  const set = (next: T) => {
    value = next;
    read = true;
    writeJson(key, next);
    notify();
  };
  const reload = () => {
    read = false;
    notify();
  };

  if (sync && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', (event) => {
      if (event.key === key || event.key === null) reload();
    });
  }

  return {
    get,
    set,
    update: (fn) => set(fn(get())),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reload,
  };
}
