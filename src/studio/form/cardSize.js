// How big a card of a list is, and so which cards of a list may open by themselves. Pure: no React, no DOM.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// About how many inputs a card opens with, counted from what is in it: each plain value is one input, a list of plain
// values is one (a chip list), and anything nested counts its parts. It is a size, not an exact count; it only has to
// tell a card of three fields from a card of thirty.
export function sizeOf(value) {
  if (Array.isArray(value)) return value.every((v) => !isObj(v) && !Array.isArray(v)) ? 1 : value.reduce((n, v) => n + sizeOf(v), 0);
  if (isObj(value)) return Object.values(value).reduce((n, v) => n + sizeOf(v), 0);
  return 1;
}
// A screen should not open with dozens of inputs. Cards of a short list open by themselves (see CardItem), but several
// big ones would open a wall of fields, so a card opens by itself only while the cards before it, with it, stay within
// this many inputs. The first card always may.
export const OPEN_BUDGET = 24;
export function cardsThatMayOpen(list) {
  let used = 0;
  return list.map((item, index) => {
    used += sizeOf(item);
    return index === 0 || used <= OPEN_BUDGET;
  });
}
