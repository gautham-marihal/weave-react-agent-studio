/** One difference; an item of an id-list is named "id=<id>" in the path, as GET /diff names it. */
export interface Change {
  op: 'add' | 'remove' | 'change';
  path: Array<string | number>;
  before?: unknown;
  after?: unknown;
}

export interface DiffOptions {
  /** Compare a list without ids item by item (a rule added to a list of rules reads as one rule added), instead of as
   *  one value as GET /diff does. */
  listsByPosition?: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function diffConfigs(a: unknown, b: unknown, path: Array<string | number> = [], options: DiffOptions = {}): Change[] {
  if (same(a, b)) return [];
  if (Array.isArray(a) && Array.isArray(b)) {
    const idList = [...a, ...b].length > 0 && [...a, ...b].every((x) => isObj(x) && typeof x.id === 'string');
    if (!idList) {
      if (!options.listsByPosition) return [{ op: 'change', path, before: a, after: b }];
      const out: Change[] = [];
      for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        if (i >= b.length) out.push({ op: 'remove', path: [...path, i], before: a[i] });
        else if (i >= a.length) out.push({ op: 'add', path: [...path, i], after: b[i] });
        else out.push(...diffConfigs(a[i], b[i], [...path, i], options));
      }
      return out;
    }
    const byId = (arr: unknown[]) => new Map(arr.map((x) => [String((x as Record<string, unknown>).id), x]));
    const ma = byId(a);
    const mb = byId(b);
    const out: Change[] = [];
    ma.forEach((val, id) => {
      if (!mb.has(id)) out.push({ op: 'remove', path: [...path, `id=${id}`], before: val });else
      out.push(...diffConfigs(val, mb.get(id), [...path, `id=${id}`], options));
    });
    mb.forEach((val, id) => {
      if (!ma.has(id)) out.push({ op: 'add', path: [...path, `id=${id}`], after: val });
    });
    return out;
  }
  if (isObj(a) && isObj(b)) {
    const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
    return keys.flatMap((k) => {
      if (!(k in a)) return [{ op: 'add' as const, path: [...path, k], after: b[k] }];
      if (!(k in b)) return [{ op: 'remove' as const, path: [...path, k], before: a[k] }];
      return diffConfigs(a[k], b[k], [...path, k], options);
    });
  }
  return [{ op: 'change', path, before: a, after: b }];
}
