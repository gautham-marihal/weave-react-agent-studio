// How big a list's card is, and so which cards may open by themselves. Pure: no React, no DOM.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Roughly how many inputs a card opens with: a plain value is one, a list of plain values is one (chips), nested parts
// add up. It only has to tell three fields from thirty.
export function sizeOf(value) {
  if (Array.isArray(value)) return value.every((v) => !isObj(v) && !Array.isArray(v)) ? 1 : value.reduce((n, v) => n + sizeOf(v), 0);
  if (isObj(value)) return Object.values(value).reduce((n, v) => n + sizeOf(v), 0);
  return 1;
}
// Cards of a short list open by themselves (see CardItem), but only while this card and those before it stay within
// this many inputs, so a screen never opens on a wall of fields. The first card always may.
export const OPEN_BUDGET = 24;
export function cardsThatMayOpen(list) {
  let used = 0;
  return list.map((item, index) => {
    used += sizeOf(item);
    return index === 0 || used <= OPEN_BUDGET;
  });
}
