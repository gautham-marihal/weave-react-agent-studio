import { useMemo, useSyncExternalStore } from 'react';
import { TAB_IDS } from './journey.js';
import { EXTRA_PAGE_IDS } from './agent/pages.js';
import { askConfirm } from '../ui/dialogs.js';

// Hash routes, so a bot has a link and a refresh keeps you where you were:
//   #/bots                 the list      (#/bots?new=1 opens the create dialog)
//   #/bots/{id}            a bot, on its Home
//   #/bots/{id}/{tab}      config | knowledge | test | ... (the journey's stages, see journey.js)
export const TABS = [...TAB_IDS, ...EXTRA_PAGE_IDS];
// Renamed pages, so an old link still opens them (Cost and speed became Speed when costs were removed).
const OLD_TABS = { cost: 'speed' };

export function parseRoute(hash) {
  const [pathPart, query = ''] = String(hash || '')
    .replace(/^#/, '')
    .split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(query));
  if (parts[0] !== 'bots' || !parts[1]) return { view: 'list', params };
  const named = OLD_TABS[parts[2]] || parts[2];
  const tab = TABS.includes(named) ? named : 'config';
  // `bare`: no page was named (opened from a list), so it opens on Home.
  return { view: 'bot', botId: parts[1], tab, bare: !parts[2], params };
}

export function routeHref(botId, tab, params) {
  const query = params && Object.keys(params).length ? `?${new URLSearchParams(params)}` : '';
  if (!botId) return `#/bots${query}`;
  return `#/bots/${botId}${tab ? `/${tab}` : ''}${query}`;
}

// A page with unsaved work registers a guard: a function saying what leaving would lose, or '' when nothing.
// In-app navigation asks before leaving.
let leaveGuard = null;
export const setLeaveGuard = (guard) => {
  leaveGuard = guard;
};
let agreed = false;
// when the person last agreed to leave, so the address change that follows a moment later isn't asked about again
let agreedAt = 0;
// Runs `then` once leaving is fine: at once if nothing would be lost, else after the person agrees in a dialog.
// Whatever `then` navigates to is already agreed, so it isn't asked twice.
export function whenLeaveConfirmed(then) {
  const lost = !agreed && leaveGuard ? leaveGuard() : '';
  if (!lost) {
    then();
    return;
  }
  askConfirm({ title: 'Leave this agent?', body: lost, confirmLabel: 'Leave', cancelLabel: 'Stay', tone: 'danger' }).then((ok) => {
    if (!ok) return;
    agreed = true;
    agreedAt = Date.now();
    try {
      then();
    } finally {
      agreed = false;
    }
  });
}

// The agent an address is in ('' outside every agent).
const agentOf = (hash) => {
  const r = parseRoute(hash);
  return r.view === 'bot' ? r.botId : '';
};
// Back/Forward or a typed address that would leave an agent with unsaved work: the change is held and undone, then the
// person is asked. Pages of the same agent are not asked about. Added before any page's listener, so it hears first.
let here = typeof window !== 'undefined' ? window.location.hash : '';
let restoring = false;
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('hashchange', (event) => {
    const next = window.location.hash;
    if (restoring) {
      restoring = false;
      here = next;
      return;
    }
    const lost = !leaveGuard || agreed || Date.now() - agreedAt < 1500 || !agentOf(here) || agentOf(next) === agentOf(here) ? '' : leaveGuard();
    if (!lost) {
      here = next;
      return;
    }
    event.stopImmediatePropagation();
    const leavingTo = next;
    restoring = true;
    window.location.hash = here;
    askConfirm({ title: 'Leave this agent?', body: lost, confirmLabel: 'Leave', cancelLabel: 'Stay', tone: 'danger' }).then((ok) => {
      if (!ok) return;
      agreedAt = Date.now();
      window.location.hash = leavingTo;
    });
  });
}

// Moves inside one agent (tab to tab) pass { guard: false }: its edits live above the tabs.
export function navigate(href, { guard = true } = {}) {
  const go = () => {
    window.location.hash = href;
  };
  if (guard) whenLeaveConfirmed(go);
  else go();
}

// Changes the address without a history entry (Back skips it): for a position within a page (the setup's step) or a
// dialog that closed. The app follows it like any other change.
export function replaceRoute(href) {
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${href}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
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
