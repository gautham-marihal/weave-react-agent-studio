import { useCallback, useMemo } from 'react';
import { usePref } from './usePref.js';
import { sortBots } from './agentList.js';

// Pins and the person's own order ("Your order") for the Agents list, kept in this browser.
// Pinned agents come first whatever the sort; each group then follows the chosen sort.

const PINS_KEY = 'weave_pinned_agents';
const ORDER_KEY = 'weave_agent_order';
export const OWN_ORDER = 'own';

const ids = (raw) => {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

// The agents in the person's own order: placed ones as placed, then the rest by name.
function inOwnOrder(bots, order) {
  const place = new Map(order.map((id, index) => [id, index]));
  const byName = sortBots(bots, 'name');
  return [...byName.filter((bot) => place.has(bot.id)).sort((a, b) => place.get(a.id) - place.get(b.id)), ...byName.filter((bot) => !place.has(bot.id))];
}

// The list as it is shown: pinned first, each group in the sort chosen.
export function arrange(bots, { sort, pinned = [], order = [] }) {
  const sorted = sort === OWN_ORDER ? inOwnOrder(bots, order) : sortBots(bots, sort);
  return [...sorted.filter((bot) => pinned.includes(bot.id)), ...sorted.filter((bot) => !pinned.includes(bot.id))];
}

// The new order of every agent after moving `id` to where `to` is (`all` is every agent in own order, not just a page),
// or null if the move can't be made. A move stays in its group, since a pinned agent can't go below an unpinned one.
export function moveInOrder(all, pinned, id, to) {
  const from = all.findIndex((bot) => bot.id === id);
  const target = all.findIndex((bot) => bot.id === to);
  if (from < 0 || target < 0 || from === target) return null;
  if (pinned.includes(id) !== pinned.includes(to)) return null;
  const next = all.map((bot) => bot.id);
  next.splice(from, 1);
  next.splice(target, 0, id);
  return next;
}

// -> { pinned, order, togglePin(id), setOrder(ids) }
export function useAgentOrder() {
  const [pinsRaw, setPins] = usePref(PINS_KEY, '[]');
  const [orderRaw, setOrderRaw] = usePref(ORDER_KEY, '[]');
  const pinned = useMemo(() => ids(pinsRaw), [pinsRaw]);
  const order = useMemo(() => ids(orderRaw), [orderRaw]);
  const togglePin = useCallback((id) => setPins(JSON.stringify(pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id])), [pinned, setPins]);
  const setOrder = useCallback((next) => setOrderRaw(JSON.stringify(next)), [setOrderRaw]);
  return { pinned, order, togglePin, setOrder };
}
