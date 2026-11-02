// Pins and the person's own order ("Your order") for the Agents list, kept in this browser. Pinned agents come first
// whatever the sort; each group then follows the sort chosen. A move never takes a pinned agent below an unpinned one.

import { sortItems, type ListItem } from './agentList';

export const OWN_ORDER = 'own';
export const ORDER_KEY = 'weave_agents_order';

/** The agents in the person's own order: placed ones as placed, then the rest by name. */
function inOwnOrder<T extends ListItem>(items: T[], order: string[]): T[] {
  const place = new Map(order.map((id, index) => [id, index]));
  const byName = sortItems(items, 'name');
  return [
    ...byName.filter((item) => place.has(item.id)).sort((a, b) => (place.get(a.id) ?? 0) - (place.get(b.id) ?? 0)),
    ...byName.filter((item) => !place.has(item.id)),
  ];
}

/** The list as it is shown: pinned first, each group in the sort chosen. */
export function arrange<T extends ListItem>(items: T[], { sort, pinned = [], order = [] }: { sort: string; pinned?: string[]; order?: string[] }): T[] {
  const sorted = sort === OWN_ORDER ? inOwnOrder(items, order) : sortItems(items, sort);
  return [...sorted.filter((item) => pinned.includes(item.id)), ...sorted.filter((item) => !pinned.includes(item.id))];
}

/**
 * The order of every agent after moving `id` to where `to` is (`all` is every agent as arranged, not just a page), or
 * null when the move can't be made: nowhere to go, or across the pinned/unpinned line.
 */
export function moveInOrder(all: { id: string }[], pinned: string[], id: string, to: string): string[] | null {
  const from = all.findIndex((item) => item.id === id);
  const target = all.findIndex((item) => item.id === to);
  if (from < 0 || target < 0 || from === target) return null;
  if (pinned.includes(id) !== pinned.includes(to)) return null;
  const next = all.map((item) => item.id);
  next.splice(from, 1);
  next.splice(target, 0, id);
  return next;
}

/** The agent just above (-1) or below (1) in the list shown, only within the same group (pinned or not). */
export function neighbour(shown: { id: string }[], pinned: string[], id: string, step: -1 | 1): string | null {
  const index = shown.findIndex((item) => item.id === id);
  const other = index < 0 ? undefined : shown[index + step];
  return other && pinned.includes(other.id) === pinned.includes(id) ? other.id : null;
}
