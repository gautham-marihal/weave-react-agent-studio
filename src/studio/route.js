import { useMemo, useSyncExternalStore } from 'react';
import { TAB_IDS } from './journey.js';
import { EXTRA_PAGE_IDS } from './newlayout/pages.js';
import { isNewLayout } from './newlayout/layoutPref.js';

// Hash routes, so a bot has a link and a refresh keeps you where you were:
//   #/bots                 the list      (#/bots?new=1 opens the create dialog)
//   #/bots/{id}            a bot, on its Config tab
//   #/bots/{id}/{tab}      config | knowledge | test | scenarios | checks | versions | deploy | calls   (the stages of the journey, see journey.js)
export const TABS = [...TAB_IDS, ...EXTRA_PAGE_IDS];

export function parseRoute(hash) {
  const [pathPart, query = ''] = String(hash || '')
    .replace(/^#/, '')
    .split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(query));
  if (parts[0] !== 'bots' || !parts[1]) return { view: 'list', params };
  const tab = TABS.includes(parts[2]) ? parts[2] : 'config';
  // `bare`: no page was named (an agent opened from a list). The new layout opens its Home then; the classic one its Config.
  return { view: 'bot', botId: parts[1], tab, bare: !parts[2], params };
}

export function routeHref(botId, tab, params) {
  const query = params && Object.keys(params).length ? `?${new URLSearchParams(params)}` : '';
  if (!botId) return `#/bots${query}`;
  // In the new layout the Config tab is a page like any other, so it is named; an address with no page opens the agent's Home.
  return `#/bots/${botId}${tab && (tab !== 'config' || isNewLayout()) ? `/${tab}` : ''}${query}`;
}

// A page with unsaved work registers a guard; in-app navigation asks it before leaving.
let leaveGuard = null;
export const setLeaveGuard = (guard) => {
  leaveGuard = guard;
};
export const confirmLeave = () => (leaveGuard ? leaveGuard() : true);

// Moves inside one agent (tab to tab) pass { guard: false }: its edits live above the tabs.
export function navigate(href, { guard = true } = {}) {
  if (guard && !confirmLeave()) return false;
  window.location.hash = href;
  return true;
}

const subscribe = (callback) => {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
};
const snapshot = () => window.location.hash;

export function useRoute() {
  const hash = useSyncExternalStore(subscribe, snapshot, () => '');
  // Same object until the hash changes, so effects keyed on parts of the route don't re-fire every render.
  return useMemo(() => parseRoute(hash), [hash]);
}
