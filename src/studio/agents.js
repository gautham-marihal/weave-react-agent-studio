import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { api } from '../api/client.js';

// One list of agents for the whole app: the Agents page, the Overview, search, Settings, Telephony and
// Readiness checks all read it, so they can never disagree. It is the Agent Builder API's list (GET /bots) plus two
// per-browser things the API has no place for:
//   - a "removed from my list" set (the API has no delete endpoint, so removing only hides an agent here), and
//   - which workspace each agent belongs to. A workspace is a label kept in this browser, so the owner of an agent
//     is too. An agent nobody has assigned yet belongs to the first workspace; a new agent belongs to the
//     workspace it was created in; "Move to workspace" changes it.

const HIDDEN_KEY = 'weave_hidden_agents';
const OWNERS_KEY = 'weave_agent_workspaces';
const DISMISSED_KEY = 'weave_dismissed_agents';

function readHidden() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HIDDEN_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
function writeHidden(ids) {
  try {
    window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable: the choice lasts until reload */
  }
}

// Ids of agents deleted from the “Removed from your list” section: still on the server (the API cannot delete), but no longer listed anywhere here.
function readDismissed() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISMISSED_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
function writeDismissed(ids) {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable: lasts until reload */
  }
}

function readOwners() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OWNERS_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function writeOwners(owners) {
  try {
    window.localStorage.setItem(OWNERS_KEY, JSON.stringify(owners));
  } catch {
    /* storage unavailable: lasts until reload */
  }
}

const browser = typeof window !== 'undefined';
let state = {
  bots: null,
  error: null,
  loading: false,
  hidden: browser ? readHidden() : [],
  dismissed: browser ? readDismissed() : [],
  owners: browser ? readOwners() : {},
  spaces: [], // [{ id, name }] in the order the workspace menu shows them
  current: null, // the open workspace's id
};
const listeners = new Set();
const set = (patch) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => state;

let inflight = null;
export function refreshBots() {
  if (inflight) return inflight;
  set({ loading: true });
  inflight = api
    .listBots()
    .then((bots) => set({ bots, error: null, loading: false }))
    .catch((error) => set({ error, loading: false }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// The workspace an agent belongs to: the one it was assigned, else the first workspace. Until the workspaces are
// known (the first moments of a page load) there is nothing to say.
export function ownerOfIn(owners, spaces, botId) {
  if (!spaces.length) return null;
  const assigned = owners[botId];
  return assigned && spaces.some((space) => space.id === assigned) ? assigned : spaces[0].id;
}
export const ownerOf = (botId) => ownerOfIn(state.owners, state.spaces, botId);

const inScope = (bot, workspaceId) => {
  const owner = ownerOf(bot.id);
  return owner === null || owner === workspaceId;
};

let switcher = null;
// Called by the page that owns the workspaces, whenever they change. `switchTo` opens another workspace.
export function setWorkspaces(spaces, current, switchTo) {
  switcher = switchTo || switcher;
  const clean = spaces.map(({ id, name }) => ({ id, name }));
  if (JSON.stringify(clean) === JSON.stringify(state.spaces) && current === state.current) return;
  set({ spaces: clean, current });
}
export const switchWorkspace = (workspaceId) => {
  if (switcher) switcher(workspaceId);
};

export function assignBot(botId, workspaceId) {
  const owners = { ...state.owners, [botId]: workspaceId };
  writeOwners(owners);
  set({ owners });
}

// Show a change at once (a rename, a publish) without waiting for the next refresh.
export function patchBot(id, patch) {
  if (!state.bots) return;
  set({ bots: state.bots.map((bot) => (bot.id === id ? { ...bot, ...patch } : bot)) });
}

export function hideBot(id) {
  if (state.hidden.includes(id)) return;
  const hidden = [...state.hidden, id];
  writeHidden(hidden);
  set({ hidden });
}
export function restoreBot(id) {
  const hidden = state.hidden.filter((item) => item !== id);
  writeHidden(hidden);
  set({ hidden });
}

// Delete from the removed list: the agent stays on the server and is only forgotten here. Undone together by `undoDismissed`, which puts them back in the removed list.
export function dismissBot(id) {
  if (state.dismissed.includes(id)) return;
  const dismissed = [...state.dismissed, id];
  writeDismissed(dismissed);
  set({ dismissed });
}
export function undoDismissed(ids) {
  const dismissed = Array.isArray(ids) ? state.dismissed.filter((id) => !ids.includes(id)) : [];
  writeDismissed(dismissed);
  set({ dismissed });
}

// For code that renders outside React's hook flow (a count in a menu): the agents a workspace shows right now.
export const visibleCount = (workspaceId = state.current) =>
  (state.bots || []).filter((bot) => !state.hidden.includes(bot.id) && inScope(bot, workspaceId)).length;

// The agents of the open workspace. `all` is every agent the API has, whichever workspace it is in.
export function useBots() {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (s.bots === null && !s.loading && !s.error) refreshBots();
  }, [s.bots, s.loading, s.error]);
  const { bots: all, owners, spaces, current } = s;
  const mine = useMemo(
    () =>
      all
        ? all.filter((bot) => {
            const owner = ownerOfIn(owners, spaces, bot.id);
            return owner === null || owner === current;
          })
        : null,
    [all, owners, spaces, current],
  );
  const visible = useMemo(() => (mine ? mine.filter((bot) => !s.hidden.includes(bot.id)) : null), [mine, s.hidden]);
  const removed = useMemo(() => (mine ? mine.filter((bot) => s.hidden.includes(bot.id) && !s.dismissed.includes(bot.id)) : []), [mine, s.hidden, s.dismissed]);
  const dismissedIds = useMemo(
    () => (mine ? mine.filter((bot) => s.hidden.includes(bot.id) && s.dismissed.includes(bot.id)).map((bot) => bot.id) : []),
    [mine, s.hidden, s.dismissed],
  );
  return { bots: visible, removed, dismissedCount: dismissedIds.length, dismissedIds, all: s.bots, error: s.error, loading: s.loading, refresh: refreshBots };
}

// The workspaces to choose from when moving an agent, and where an agent is now.
export function useWorkspaces() {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { spaces: s.spaces, current: s.current, owners: s.owners, ownerOf: (botId) => ownerOfIn(s.owners, s.spaces, botId) };
}

// The shape the older pages (Telephony, Readiness checks, Settings) were written against.
export function toLegacyAgent(bot) {
  const deployed = bot.deployed || {};
  const environment = deployed.production ? 'production' : deployed.staging ? 'staging' : 'development';
  const status = deployed.production ? 'published' : deployed.staging ? 'staging' : 'draft';
  const version = bot.latest_version || '0.1.0';
  return {
    id: bot.id,
    name: bot.name || bot.id,
    useCase: 'custom',
    status,
    environment,
    version,
    versions: bot.latest_version ? [{ version, configured: true, createdAt: bot.draft_saved_at }] : [],
    configuration: { format: 'json' },
    createdAt: bot.draft_saved_at,
    // which save of the draft this is: a page that keeps agents' configurations (Voices) reads one again when it changes
    draftRevision: bot.draft_revision ?? null,
    sessions: 0,
    deployed,
  };
}
