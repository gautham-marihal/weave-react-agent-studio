// When the draft's JSON text changes it is parsed again, and every object and list in the result is brand new even if only one field
// differs. That makes every card of a big agent look "changed" to React, so a keystroke in one tool re-renders all of them. This puts the
// old parts back wherever the new value is the same: `shareStructure(previous, next)` returns `next`'s content, reusing `previous`'s
// objects and lists for every part that is equal (so `===` means "nothing changed in here"). Equal means the same JSON, keys in the same
// order. Neither argument is changed. Pure.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function shareStructure(previous, next) {
  if (previous === next) return next;
  if (Array.isArray(next) && Array.isArray(previous)) {
    let same = previous.length === next.length;
    const out = next.map((item, i) => { const shared = shareStructure(previous[i], item); if (shared !== previous[i]) same = false; return shared; });
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
