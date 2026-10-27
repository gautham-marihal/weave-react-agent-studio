// Re-parsing the draft makes every object new, so one keystroke would re-render every card. shareStructure(previous,
// next) reuses `previous`'s objects wherever equal (same JSON, same key order), so `===` means unchanged. Pure.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function shareStructure(previous, next) {
  if (previous === next) return next;
  if (Array.isArray(next) && Array.isArray(previous)) {
    let same = previous.length === next.length;
    const out = next.map((item, i) => {
      const shared = shareStructure(previous[i], item);
      if (shared !== previous[i]) same = false;
      return shared;
    });
    return same ? previous : out;
  }
  if (isObj(next) && isObj(previous)) {
    const keys = Object.keys(next);
    const before = Object.keys(previous);
    let same = keys.length === before.length;
    const out = {};
    keys.forEach((key, i) => {
      const shared = shareStructure(previous[key], next[key]);
      out[key] = shared;
      if (shared !== previous[key] || before[i] !== key) same = false;
    });
    return same ? previous : out;
  }
  return next;
}
