// The difference between two configs in the API's diff shape:
//   [{ op: 'add' | 'remove' | 'change', path, before?, after? }]
// List items that all have an `id` are addressed by it ("id=billing"), as the API does; other lists by position. Pure.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isIdList = (list) => Array.isArray(list) && list.length > 0 && list.every((item) => isObj(item) && typeof item.id === 'string');

export function diffConfigs(before, after, path = []) {
  const out = [];
  if (sameJson(before, after)) return out;
  if (isObj(before) && isObj(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    keys.forEach((key) => {
      if (!(key in after)) out.push({ op: 'remove', path: [...path, key], before: before[key] });
      else if (!(key in before)) out.push({ op: 'add', path: [...path, key], after: after[key] });
      else out.push(...diffConfigs(before[key], after[key], [...path, key]));
    });
    return out;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    if (isIdList(before) && isIdList(after)) {
      const ids = [...new Set([...before.map((i) => i.id), ...after.map((i) => i.id)])];
      ids.forEach((id) => {
        const a = before.find((i) => i.id === id);
        const b = after.find((i) => i.id === id);
        const where = [...path, `id=${id}`];
        if (!b) out.push({ op: 'remove', path: where, before: a });
        else if (!a) out.push({ op: 'add', path: where, after: b });
        else out.push(...diffConfigs(a, b, where));
      });
      return out;
    }
    const length = Math.max(before.length, after.length);
    for (let i = 0; i < length; i += 1) {
      if (i >= after.length) out.push({ op: 'remove', path: [...path, i], before: before[i] });
      else if (i >= before.length) out.push({ op: 'add', path: [...path, i], after: after[i] });
      else out.push(...diffConfigs(before[i], after[i], [...path, i]));
    }
    return out;
  }
  out.push({ op: 'change', path, before, after });
  return out;
}
