import type { Path } from '../types/studio';

type Indexable = Record<string | number, unknown>;

export function getAt(obj: unknown, path: Path): unknown {
  return path.reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== 'object') return undefined;
    return (acc as Indexable)[key];
  }, obj);
}

export function setAt<T>(obj: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path;
  const source = (obj ?? (typeof head === 'number' ? [] : {})) as unknown;
  const copy = (Array.isArray(source) ? [...source] : { ...(source as Indexable) }) as Indexable;
  copy[head] = setAt(copy[head], rest, value);
  return copy as unknown as T;
}

/** A copy of obj without the value at path (the key is removed, not set to undefined). Parents are left as they are. */
export function unsetAt<T>(obj: T, path: Path): T {
  if (path.length === 0 || obj === null || typeof obj !== 'object') return obj;
  const [head, ...rest] = path;
  const source = obj as unknown as Indexable;
  if (!(head in source)) return obj;
  if (rest.length === 0) {
    if (Array.isArray(obj)) return obj.filter((_, i) => i !== head) as unknown as T;
    const copy = { ...source };
    delete copy[head];
    return copy as unknown as T;
  }
  const child = unsetAt(source[head], rest);
  if (child === source[head]) return obj;
  const copy = (Array.isArray(obj) ? [...obj] : { ...source }) as Indexable;
  copy[head] = child;
  return copy as unknown as T;
}

/** setAt, except that undefined removes the setting (so the server's default applies). */
export const putAt = <T,>(obj: T, path: Path, value: unknown): T => (value === undefined ? unsetAt(obj, path) : setAt(obj, path, value));

export const pathKey = (path: Path): string => path.join('.');

export const parsePath = (key: string): Path => key.split('.').map((k) => /^\d+$/.test(k) ? Number(k) : k);

export const fieldId = (path: Path | string): string => `field-${typeof path === 'string' ? path : pathKey(path)}`;