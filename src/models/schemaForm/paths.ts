// Small helpers the settings form shares: how a place in the config is written, and how objects are changed without
// losing the schema's order. Pure: no React, no DOM.
import type { Path } from '../../types/studio';
import type { Json } from './engine';

/** ['channels', 0, 'modalities'] -> "channels[0].modalities": the way a developer writes a place in the file. */
export function formatPath(path: Path | null | undefined): string {
  if (!Array.isArray(path) || !path.length) return '';
  return path.reduce<string>((out, part) => (typeof part === 'number' ? `${out}[${part}]` : out ? `${out}.${part}` : String(part)), '');
}

/** The key a place is known by inside the form (issues, focus, data-path). */
export const keyOf = (path: Path): string => formatPath(path);

/** Is `key` the place `parent`, or inside it? */
export const isUnder = (key: string, parent: string): boolean => key === parent || key.startsWith(`${parent}.`) || key.startsWith(`${parent}[`);

/** "tools" -> "tool", "agents" -> "agent": a base for the id of a new list item. */
export function singular(word: unknown): string {
  const w = String(word || 'item');
  if (w === 'analysis' || w === 'knowledge') return w;
  if (/ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

/** "tool_1", "tool_2"…: the first free name with a counter. */
export function uniqueId(taken: Iterable<unknown>, base: unknown): string {
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

/** The object with `key` set, a new key placed in the schema's order (existing keys keep their place). */
export function orderedSet(obj: Json, key: string, value: unknown, order: string[]): Json {
  if (key in obj) return { ...obj, [key]: value };
  const merged: Json = { ...obj, [key]: value };
  const keys = Object.keys(merged);
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i === -1 ? order.length + 1 : i;
  };
  const out: Json = {};
  [...keys]
    .sort((a, b) => rank(a) - rank(b) || keys.indexOf(a) - keys.indexOf(b))
    .forEach((k) => {
      out[k] = merged[k];
    });
  return out;
}

/** The object without `key`. */
export function omit(obj: Json, key: string): Json {
  const rest = { ...obj };
  delete rest[key];
  return rest;
}

/** "channels[0].modalities" or "channels.0.modalities" -> ['channels', 0, 'modalities'] (a deep link's setting). */
export function parseSettingPath(text: string | null | undefined): Path {
  const raw = String(text ?? '').trim();
  if (!raw) return [];
  const out: Path = [];
  raw
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .forEach((part) => out.push(/^\d+$/.test(part) ? Number(part) : part));
  return out;
}
