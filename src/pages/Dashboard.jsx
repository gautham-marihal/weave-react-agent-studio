import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DropdownMenu, Popover } from 'radix-ui';
import { afterMenu, keepEscape } from '../ui/layer.ts';
import Tip from '../ui/Tip.tsx';
import { SidebarFolded } from '../ui/sidebarFolded.ts';
import { navigate as studioNavigate, routeHref, useRoute, whenLeaveConfirmed } from '../studio/route.js';
import { askConfirm, showNotice } from '../ui/dialogs.js';
import { setApiUser } from '../api/client.ts';
import { PageErrorBoundary } from '../ui/ErrorBoundary.jsx';
import NotFound from '../ui/NotFound.jsx';
import { ErrorState } from '../studio/ui.jsx';
import AiOrb from '../studio/preview/AiOrb.jsx';
import { OfflineBanner, ServerDownBanner, SkipToContent } from '../ui/Connectivity.jsx';
import { AGENT_SEARCH, PAGE_LABELS, capSameLabel, resolvePage, searchAgent, settingWhere } from '../studio/agent/pages.js';
import { bestFirst } from '../ui/match.ts';
import { whenPanelKept } from '../studio/agent/stagedPanel.js';
import { loadSchema } from '../studio/form/useSchema.js';
import { requestSettingFocus } from '../studio/settingFocus.js';
import { ownerOf, setWorkspaces as publishWorkspaces, toLegacyAgent, useBots, visibleCount } from '../studio/agents.js';
import AgentPicker from '../studio/AgentPicker.jsx';
import { queueChange } from '../studio/pendingChange.js';
import { Choice, OneOf } from '../ui/OneOf.tsx';
// The look of every page is loaded at once, in the order the pages' own imports gave it before their code was split off below (Home and the menu use
// these styles before any page is opened; a style loaded later would also come after themes.css and win where the two are as specific).
import '../studio/smartSelect.css';
import '../studio/preview/preview.css';
import '../studio/insights/insights.css';
import '../studio/models/models.css';
import '../studio/simple/simple.css';
import '../studio/changes/changes.css';
import '../studio/release/release.css';
import '../studio/agentRail.css';
import '../studio/trace/trace.css';
import '../studio/replay/replay.css';
import '../studio/fixcall/fixcall.css';
import '../studio/calls/calls.css';
import '../studio/monitoring/monitoring.css';
import '../studio/team/team.css';
import '../studio/callers/callers.css';
import '../studio/agent/pickers/pickers.css';
import '../studio/agent/agent.css';
import '../studio/studio.css';
import '../studio/form/form.css';
import '../studio/form/formLook.css';
import '../studio/live/live.css';
import '../studio/speed/speed.css';
import '../studio/setup/setup.css';
import { openTeam } from '../studio/team/useTeam.js';
import { isDemoMode } from '../demo/demoMode.js';
import { AgentTable } from '../studio/AgentTable.jsx';
import { describeHealth, useApiHealth } from '../studio/useApiHealth.js';
import AgentSwitcher from '../studio/agent/AgentSwitcher.jsx';
import AlertBell, { useNewAlertCount } from '../studio/insights/AlertBell.jsx';
import AgentAlerts from '../studio/insights/AgentAlerts.jsx';
import { useAlertWatcher } from '../studio/insights/useAlertWatcher.js';
import {
  LIBRARY_NAV,
  NAV,
  SETTINGS_NAV,
  TELEPHONY_SECTIONS,
  formatDuration,
  formatRelative,
  getInitials,
  isUnknownAddress,
  makeRecordId,
  normalizeTelephony,
  parseWorkspaceHash,
  sessionStats,
  sessionsInRange,
  workspaceHref,
} from './helpers.js';
import {
  Activity,
  Logo,
  Metric,
  NavItem,
  ProfileMenu,
  QuickAction,
  SHORTCUT_LABEL,
  searchKey,
  WorkspaceCreateModal,
  WorkspaceRenameModal,
  isTyping,
  openHelpDialog,
} from './shared.jsx';
import HomeJourney, { rememberAgent } from './HomeJourney.jsx';
import WorkspacePulse from './WorkspacePulse.jsx';
import './homeJourney.css';
import { StyleMenu } from '../ui/StylePicker.jsx';
import Icon from '../ui/Icon.jsx';
import { DemoSlot } from '../demo/DemoBadge.jsx';
import { SkeletonRows } from '../ui/Skeleton.jsx';
import { revealIn } from '../ui/scrollEdges.js';
import { randomTag } from '../studio/format.js';

// The search's code (cmdk) arrives the first time it is opened.
const SearchOverlay = lazy(() => import('./SearchPalette.jsx'));

// Each page's code arrives when the page is first opened, so the first screen loads only what Home needs.
const named = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const Studio = lazy(() => import('../studio/Studio.jsx'));
const SettingsPage = lazy(() => import('../studio/SettingsPage.jsx'));
const TeamPage = lazy(() => import('../studio/team/TeamPage.jsx'));
const MonitoringPage = lazy(() => import('../studio/monitoring/MonitoringPage.jsx'));
const AlertsPage = lazy(() => import('../studio/insights/AlertsPage.jsx'));
const LiveBoardPage = lazy(() => import('../studio/live/LiveBoardPage.jsx'));
const SpeedPage = lazy(() => import('../studio/speed/SpeedPage.jsx'));
const CallsPage = named(() => import('./Sessions.jsx'), 'CallsPage');
const TelephonyWorkspace = named(() => import('./Telephony.jsx'), 'TelephonyWorkspace');
const VoicesWorkspace = named(() => import('./Voices.jsx'), 'VoicesWorkspace');
const IntegrationsWorkspace = named(() => import('./Integrations.jsx'), 'IntegrationsWorkspace');

// while a page's code arrives: its title's place, then a few rows
function PageLoading() {
  return (
    <div className="pageLoading" aria-busy="true">
      <span className="skeleton" style={{ width: 220, height: 34 }} aria-hidden="true" />
      <span className="skeleton" style={{ width: '42%', height: 12 }} aria-hidden="true" />
      <SkeletonRows rows={4} label="Loading the page" />
    </div>
  );
}

const WORKSPACE_STORAGE_KEY = 'weave_workspaces';

const CURRENT_WORKSPACE_KEY = 'weave_current_workspace';

function makeWorkspaceId() {
  return `ws_${Date.now().toString(36)}_${randomTag(5)}`;
}

// Records saved with each workspace: test sessions, readiness-check runs (stored as `simulations`, the field's old name) and the activity log.
function normalizeList(value) {
  return Array.isArray(value) ? value.filter((item) => item && item.id) : [];
}

function loadWorkspaces(profile) {
  let stored = [];
  try {
    stored = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY) || '[]');
  } catch {}

  if (Array.isArray(stored) && stored.length) {
    return stored.map((ws) => ({
      id: ws.id || makeWorkspaceId(),
      name: ws.name || 'My workspace',
      createdAt: ws.createdAt || new Date().toISOString(),
      telephony: normalizeTelephony(ws.telephony),
      sessions: normalizeList(ws.sessions),
      simulations: normalizeList(ws.simulations),
      activity: normalizeList(ws.activity),
      settings: ws.settings && typeof ws.settings === 'object' ? ws.settings : {},
    }));
  }

  const first = {
    id: makeWorkspaceId(),
    name: profile?.workspaceName || 'My workspace',
    createdAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([first]));
  } catch {}
  try {
    localStorage.setItem(CURRENT_WORKSPACE_KEY, first.id);
  } catch {}
  return [first];
}

// The first-time setup's workspace, named by the person who just set up (another person may have used this browser before): it opens, made first
// when there is none by that name. Done once, as the setup finishes (on every load it would make it again after a rename).
export function openWorkspaceNamed(name) {
  const wanted = String(name || '').trim();
  if (!wanted) return;
  let stored = [];
  try {
    stored = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY) || '[]');
  } catch {}
  if (!Array.isArray(stored) || !stored.length) return; // the first load makes it, with this name
  let found = stored.find((ws) => ws && ws.name === wanted);
  try {
    if (!found) {
      found = { id: makeWorkspaceId(), name: wanted, createdAt: new Date().toISOString() };
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([...stored, found]));
    }
    localStorage.setItem(CURRENT_WORKSPACE_KEY, found.id);
  } catch {}
}

function loadCurrentWorkspaceId(workspaces) {
  try {
    const current = localStorage.getItem(CURRENT_WORKSPACE_KEY);
    if (current && workspaces.some((ws) => ws.id === current)) return current;
  } catch {}
  return workspaces[0]?.id || null;
}

function saveWorkspaceState(workspaces, currentId) {
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspaces));
  } catch {}
  try {
    if (currentId) localStorage.setItem(CURRENT_WORKSPACE_KEY, currentId);
  } catch {}
}

const RECENT_KEY = 'weave_search_recent';
const RECENT_KEPT = 8;

export function Dashboard({ profile, theme, onToggleTheme, onSignOut, onAccountOpen }) {
  // who is signed in, sent with every request as X-User (every page, not only an agent's: phone-number changes are
  // written to an audit file with it). Set during render, before any child sends its first request.
  setApiUser(profile?.fullName, profile?.email);
  const displayName = profile?.fullName || 'there';
  const firstName = displayName.split(' ')[0];
  const initials = getInitials(displayName);
  // Every page has an address: an agent's (#/bots/...) opens the Agents area, a workspace page's (#/calls,
  // #/telephony/numbers...) opens that page, so refreshes, bookmarks and Back land where you were.
  const [active, setActive] = useState(() => (/^#\/bots/.test(window.location.hash) ? 'agents' : parseWorkspaceHash(window.location.hash)?.id || 'home'));
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [picker, setPicker] = useState(null); // 'which agent?' for voices and integrations
  const goToAgent = (botId) => {
    setActive('agents');
    studioNavigate(`#/bots/${botId}`);
  };
  const [workspaceCreateOpen, setWorkspaceCreateOpen] = useState(false);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('');
  const [workspaceRenameOpen, setWorkspaceRenameOpen] = useState(false);
  const [workspaceRenameId, setWorkspaceRenameId] = useState(null);
  const [workspaceRenameDraft, setWorkspaceRenameDraft] = useState('');
  const [range, setRange] = useState('Past 7 days');
  const [telephonySection, setTelephonySection] = useState(() => parseWorkspaceHash(window.location.hash)?.section || 'calls');
  const [workspaces, setWorkspaces] = useState(() => loadWorkspaces(profile));
  // the workspace open last time, from the first render (not the first in the list for a moment, which an open agent's
  // address would be checked against)
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(() => loadCurrentWorkspaceId(workspaces));

  const currentWorkspace = workspaces.find((ws) => ws.id === currentWorkspaceId) || workspaces[0] || null;
  const workspaceName = currentWorkspace?.name || 'My workspace';
  // Agents are the Agent Builder API's. Which workspace an agent is in is kept in this browser (see studio/agents.js),
  // so this is the open workspace's agents. The older pages read them in their own shape.
  const { bots, removed: removedBots, all: allBots, refresh: refreshAgents, error: agentsError } = useBots();
  const botList = useMemo(() => bots || [], [bots]);
  // the team of this workspace is opened here, so the Team page and an agent's Share panel read the same one; "Open the
  // Team page" in a Share panel asks for it
  useEffect(() => {
    if (currentWorkspace?.id) openTeam({ workspaceId: currentWorkspace.id, profile, demo: isDemoMode(), agentIds: botList.map((b) => b.id) });
  }, [currentWorkspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const open = () => activate('team');
    window.addEventListener('weave-open-team', open);
    return () => window.removeEventListener('weave-open-team', open);
  });
  useEffect(() => {
    const open = () => activate('alerts');
    window.addEventListener('weave-open-alerts', open);
    return () => window.removeEventListener('weave-open-alerts', open);
  });
  // Alerts: the recent calls of every agent of this workspace are checked while the studio is open (it only reads them)
  useAlertWatcher({ bots: botList, onOpenAlert: () => window.dispatchEvent(new Event('weave-open-alerts')) });
  const newAlerts = useNewAlertCount();
  const workspaceNav = NAV.map((item) => (item.id === 'alerts' && newAlerts ? { ...item, badge: String(newAlerts), badgeTone: 'bad' } : item));
  const agents = useMemo(() => botList.map(toLegacyAgent), [botList]);
  const telephony = normalizeTelephony(currentWorkspace?.telephony);
  const sessions = normalizeList(currentWorkspace?.sessions);
  const readinessRuns = normalizeList(currentWorkspace?.simulations);
  const activityLog = normalizeList(currentWorkspace?.activity);
  const withActivity = (ws, entry) =>
    entry ? { ...ws, activity: [{ id: makeRecordId('ACT'), at: new Date().toISOString(), ...entry }, ...normalizeList(ws.activity)].slice(0, 120) } : ws;
  // Records go to the workspace you are in (a test conversation can finish after you switch pages).
  const workspaceIdRef = useRef(null);
  workspaceIdRef.current = currentWorkspaceId;
  // the workspace the agent is in (not the one open now: a conversation that ends as another workspace opens is still its agent's)
  const updateWorkspaceOfAgent = (agentId, updater) => {
    const owner = ownerOf(agentId) || workspaceIdRef.current;
    setWorkspaces((items) => items.map((ws) => (ws.id === owner ? updater(ws) : ws)));
  };
  const updateTelephony = (updater, activity) => {
    if (!currentWorkspace) return;
    setWorkspaces((items) =>
      items.map((ws) => (ws.id === currentWorkspace.id ? withActivity({ ...ws, telephony: updater(normalizeTelephony(ws.telephony)) }, activity) : ws)),
    );
  };
  const recordSession = (session) => {
    if (!session?.agentId) return;
    updateWorkspaceOfAgent(session.agentId, (ws) =>
      withActivity(
        { ...ws, sessions: [session, ...normalizeList(ws.sessions)].slice(0, 500) },
        String(session.channel || '').startsWith('Phone')
          ? {
              kind: 'session',
              icon: 'phone',
              title: `${session.agentName} answered a simulated call`,
              detail: `${formatDuration(session.durationSec)} talk time after ${formatDuration(session.holdSec || 0)} on hold.`,
            }
          : {
              kind: 'session',
              icon: 'test',
              title: `${session.agentName} had a test conversation`,
              detail: `${formatDuration(session.durationSec)} on ${session.versionLabel}, ${session.userMessages} message${session.userMessages === 1 ? '' : 's'}.`,
            },
      ),
    );
  };
  const recordReadinessRun = (run) => {
    if (!run?.agentId) return;
    updateWorkspaceOfAgent(run.agentId, (ws) =>
      withActivity(
        { ...ws, simulations: [run, ...normalizeList(ws.simulations)].slice(0, 200) },
        {
          kind: 'readiness',
          icon: 'check',
          title: `Readiness checks for ${run.agentName}`,
          detail: `${run.versionLabel}: passed ${run.passed} of ${run.total} checks.`,
        },
      ),
    );
  };
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  useEffect(() => {
    if (currentWorkspaceId && workspaces.some((ws) => ws.id === currentWorkspaceId)) return;
    const nextId = loadCurrentWorkspaceId(workspaces);
    setCurrentWorkspaceId(nextId);
  }, [workspaces, currentWorkspaceId]);

  useEffect(() => {
    if (currentWorkspaceId) saveWorkspaceState(workspaces, currentWorkspaceId);
  }, [workspaces, currentWorkspaceId]);
  // the workspaces changed in another tab (one made, renamed, deleted, a test session recorded): taken up here, so this tab's next change doesn't put
  // back what it had before (the workspace open in this tab stays this tab's own)
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== WORKSPACE_STORAGE_KEY || !event.newValue) return;
      try {
        const next = JSON.parse(event.newValue);
        if (Array.isArray(next) && next.length) setWorkspaces((now) => (JSON.stringify(now) === event.newValue ? now : next));
      } catch {
        /* not ours to read: left as it is */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // The agent store needs to know the workspaces to say which agents belong to the open one.
  useLayoutEffect(() => {
    publishWorkspaces(workspaces, currentWorkspace?.id || null, (workspaceId) => switchWorkspace(workspaceId));
  });

  // A link to an agent that belongs to another workspace (a bookmark, a shared link) opens that workspace.
  const route = useRoute();
  const inAgentView = active === 'agents' && route.view === 'bot'; // inside an agent the sidebar shows that agent's menu
  useEffect(() => {
    if (route.view === 'bot') rememberAgent(route.botId);
  }, [route.view, route.botId]);
  // An address opened while the app is already running (back/forward, a pasted link) opens its page: an agent's switches to Agents.
  useEffect(() => {
    if (/^#\/bots/.test(window.location.hash)) {
      setActive('agents');
      return;
    }
    const page = parseWorkspaceHash(window.location.hash);
    if (!page) {
      // an address that names no page leaves the Agents area, so the "not found" page shows (in place of the workspace's pages)
      if (isUnknownAddress(window.location.hash)) setActive((value) => (value === 'agents' ? 'home' : value));
      return;
    }
    setActive(page.id);
    if (page.section) setTelephonySection(page.section);
  }, [route]);
  // ...and the address follows the page when it changes by other means (switching workspace goes Home): replaced, so Back does not stop on it twice
  useEffect(() => {
    if (active === 'agents' || isUnknownAddress(window.location.hash)) return;
    const want = workspaceHref(active, active === 'telephony' ? telephonySection : undefined);
    if (window.location.hash === want) return;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${want}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, [active, telephonySection]);
  useEffect(() => {
    if (route.view !== 'bot' || !currentWorkspace || !allBots) return;
    if (!allBots.some((bot) => bot.id === route.botId)) return;
    const owner = ownerOf(route.botId);
    if (owner && owner !== currentWorkspace.id) setCurrentWorkspaceId(owner);
    // Only a new link or a fresh agent list triggers this, never a workspace switch: that goes back to the list first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.view, route.botId, allBots]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  // Landing on the Overview or the Agents page asks for a fresh list.
  useEffect(() => {
    if (active === 'home' || active === 'agents') refreshAgents();
  }, [active, refreshAgents]); // refreshAgents is one function for the life of the page
  const agentCount = botList.length;
  const configuredCount = botList.filter((bot) => bot.latest_version).length;
  const apiHealth = useApiHealth();
  const health = describeHealth(apiHealth.state);

  const recentActivity = useMemo(() => {
    const events = [];
    botList.forEach((bot) => {
      if (bot.draft_saved_at) {
        const envs = Object.entries(bot.deployed || {}).map(([env, version]) => `${env} v${version}`);
        events.push({
          key: `${bot.id}:draft`,
          at: bot.draft_saved_at,
          title: `${bot.name || bot.id} draft saved`,
          detail: `${bot.latest_version ? `Latest version ${bot.latest_version}` : 'Not published yet'}${envs.length ? `, running in ${envs.join(', ')}` : ''}.`,
          icon: 'pencil',
        });
      }
    });
    activityLog.forEach((entry) => events.push({ key: entry.id, at: entry.at, title: entry.title, detail: entry.detail, icon: entry.icon || 'info' }));
    events.sort((a, b) => new Date(b.at) - new Date(a.at));
    const list = events.slice(0, 6).map((event) => ({ ...event, time: formatRelative(event.at) }));
    list.push({
      key: 'workspace',
      title: 'Workspace created',
      detail: `${workspaceName} is ready to use.`,
      time: formatRelative(currentWorkspace?.createdAt),
      icon: 'home',
      muted: list.length > 0,
    });
    return list;
  }, [botList, workspaceName, currentWorkspace?.createdAt, activityLog]);

  const openSearch = () => {
    setWorkspaceOpen(false);
    setSearchQuery('');
    setSearchOpen(true);
  };

  const closeSearch = () => setSearchOpen(false);

  // the results opened lately (kept in this browser, the newest first), for the search with nothing typed
  const [recentSearches, setRecentSearches] = useState(() => {
    try {
      const kept = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(kept) ? kept.filter((k) => typeof k === 'string').slice(0, RECENT_KEPT) : [];
    } catch {
      return [];
    }
  });
  const rememberSearch = (key) =>
    setRecentSearches((old) => {
      const next = [key, ...old.filter((k) => k !== key)].slice(0, RECENT_KEPT);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // a browser that keeps nothing still opens the result
      }
      return next;
    });

  // The settings of the agent that is open can be searched by name (what they are called, what they are for, the key
  // the file uses). The index is built from the schema the first time search is opened on an agent, and not before.
  const [settingsIndex, setSettingsIndex] = useState(null);
  const agentOpen = route.view === 'bot';
  useEffect(() => {
    if (!searchOpen || !agentOpen || settingsIndex) return undefined;
    let off = false;
    Promise.all([import('../studio/settingsSearch.js'), loadSchema()])
      .then(([module, schema]) => {
        if (!off) setSettingsIndex({ search: module.searchSettings, entries: module.buildSettingsIndex(schema) });
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [searchOpen, agentOpen, settingsIndex]);

  const searchResults = useMemo(() => {
    // only signs ("+" before a phone number, a "#"): nothing to look for yet, as the matching ignores them (else every
    // action, number and call is listed)
    const typed = searchQuery.trim().toLowerCase();
    const q = /[\p{L}\p{N}]/u.test(typed) ? typed : '';
    const pages = [
      { type: 'page', id: 'home', title: 'Home', description: 'What needs attention, and the next step', icon: 'home' },
      { type: 'page', id: 'agents', title: 'Agents', description: `${botList.length} agent${botList.length === 1 ? '' : 's'}`, icon: 'agent' },
      { type: 'page', id: 'sessions', title: 'Calls', description: 'Every conversation your agents have had', icon: 'phone' },
      { type: 'page', id: 'live', title: 'Live', description: 'Calls going on right now, as they happen', icon: 'live' },
      { type: 'page', id: 'monitoring', title: 'Monitoring', description: 'How your agents are doing, and what needs attention', icon: 'monitor' },
      { type: 'page', id: 'speed', title: 'Speed', description: 'How fast your agents answer, and where the time goes', icon: 'gauge' },
      { type: 'page', id: 'alerts', title: 'Alerts', description: 'When something breaks: failing tools, cut-off calls, no calls, slow answers', icon: 'bell' },
      { type: 'page', id: 'voices', title: 'Voices', description: 'Hear and choose a voice', icon: 'voice' },
      { type: 'page', id: 'integrations', title: 'Integrations', description: 'Connect your stack', icon: 'plug' },
      { type: 'page', id: 'telephony', title: 'Telephony', description: 'Phone numbers, dispatch rules and SIP trunks', icon: 'dial' },
      { type: 'page', id: 'team', title: 'Team', description: 'Who can work here, and on which agents', icon: 'team' },
      { type: 'page', id: 'settings', title: 'Settings', description: 'Workspace name and what is kept in this browser', icon: 'sliders' },
    ];
    const workspaceResults = workspaces.map((ws) => ({
      type: 'workspace',
      id: ws.id,
      title: ws.name,
      description: `${visibleCount(ws.id)} ${visibleCount(ws.id) === 1 ? 'agent' : 'agents'}`,
      icon: getInitials(ws.name).slice(0, 1),
    }));
    const agentResults = botList.map((bot) => ({
      type: 'agent',
      id: bot.id,
      title: bot.name || bot.id,
      description: `Agent ${bot.id}${bot.latest_version ? `, version ${bot.latest_version}` : ', not published'}`,
      icon: getInitials(bot.name || bot.id).slice(0, 1),
    }));
    const tel = normalizeTelephony(currentWorkspace?.telephony);
    const nameOf = (id) => botList.find((item) => item.id === id)?.name || 'Deleted agent';
    const numberResults = tel.numbers.map((item) => ({
      type: 'telephony',
      section: 'numbers',
      id: item.id,
      title: item.number,
      description: item.label ? `Phone number, ${item.label}` : 'Phone number',
      icon: 'dial',
    }));
    const ruleResults = tel.rules.map((item) => ({
      type: 'telephony',
      section: 'dispatch',
      id: item.id,
      title: item.name,
      description: `Dispatch rule to ${nameOf(item.agentId)}`,
      icon: 'arrowRight',
    }));
    const sessionResults = normalizeList(currentWorkspace?.sessions)
      .slice(0, 50)
      .map((item) => ({
        type: 'session',
        id: item.id,
        title: `${item.agentName} session`,
        description: `${item.versionLabel}, ${formatRelative(item.startedAt).toLowerCase()}, ${formatDuration(item.durationSec)}`,
        icon: 'clock',
      }));
    // things to do from anywhere, and, for each agent (but the one open, whose own come first), the ones people come to do most
    const actions = [
      {
        type: 'action',
        id: 'create-agent',
        title: 'Create an agent',
        description: 'Start from a template, or from a blank agent',
        words: 'new add make agent',
        icon: 'plus',
      },
      {
        type: 'action',
        id: 'theme',
        title: theme === 'dark' ? 'Light' : 'Dark',
        description: 'Theme',
        words: 'theme mode appearance light dark night',
        icon: theme === 'dark' ? 'sun' : 'moon',
      },
      { type: 'action', id: 'help', title: 'Help & shortcuts', description: 'Keyboard shortcuts', words: 'help keyboard keys shortcuts docs', icon: 'help' },
    ];
    const todo = AGENT_SEARCH.filter((item) => ['publish', 'test', 'deploy', 'page-calls'].includes(item.id));
    const agentActions = botList
      .filter((bot) => !(agentOpen && bot.id === route.botId))
      .flatMap((bot) =>
        todo.map((item) => ({
          type: 'agentAction',
          id: `${bot.id}:${item.id}`,
          title: item.title,
          description: `${bot.name || bot.id} · ${item.description}`,
          words: `${bot.name || ''} ${bot.id} ${item.words}`,
          icon: item.icon,
          botId: bot.id,
          item,
        })),
      );
    const find = (items) => bestFirst(items, searchQuery, (item) => [item.title, `${item.description} ${item.words || ''}`]);
    const groups = [
      { group: 'Navigate', items: pages },
      { group: 'Actions', items: actions },
      { group: 'Workspaces', items: workspaceResults },
      { group: 'Agents', items: agentResults },
      ...(q
        ? [
            { group: 'Actions on an agent', items: agentActions },
            { group: 'Phone numbers', items: numberResults },
            { group: 'Dispatch rules', items: ruleResults },
            { group: 'Calls', items: sessionResults },
          ]
        : []),
    ];
    const matching = groups.map((group) => ({ ...group, items: find(group.items) })).filter((group) => group.items.length);
    const settings =
      agentOpen && settingsIndex
        ? capSameLabel(settingsIndex.search(settingsIndex.entries, searchQuery, 24), 2)
            .slice(0, 8)
            .map((entry) => ({
              type: 'setting',
              id: entry.trail.join('.'),
              title: entry.label,
              // where it is, in the words of the agent's pages and panels
              description: `${settingWhere(entry)}${entry.level === 'expert' ? ' · advanced' : ''}`,
              icon: 'sliders',
              entry,
            }))
        : [];
    // the agent's own pages and the things people come to do (publish, put live, add a number...), first
    const agentItems = agentOpen
      ? searchAgent(searchQuery).map((item) => ({ type: 'agentPage', id: item.id, title: item.title, description: item.description, icon: item.icon, item }))
      : [];
    // what was opened lately, first, while nothing is typed (the ones that are still there)
    const known = new Map([...pages, ...actions, ...workspaceResults, ...agentResults, ...agentActions, ...agentItems].map((item) => [searchKey(item), item]));
    const recent = recentSearches
      .map((key) => known.get(key))
      .filter(Boolean)
      .slice(0, 5);
    const recentGroup = recent.length ? [{ group: 'Recent', key: 'recent:', items: recent }] : [];
    const withAgent = agentItems.length ? [{ group: 'This agent', items: agentItems }, ...(q ? matching : groups.filter((g) => g.items.length))] : null;
    if (!q) return [...recentGroup, ...(withAgent || groups.filter((group) => group.items.length))];
    const base = withAgent || matching;
    return settings.length ? [...base, { group: 'Settings of this agent', items: settings }] : base;
  }, [botList, searchQuery, workspaces, currentWorkspace, settingsIndex, agentOpen, route.botId, theme, recentSearches]);

  const selectSearchResult = (result) => {
    setSearchOpen(false);
    setSearchQuery('');
    if (result.type !== 'setting') rememberSearch(searchKey(result));
    // a side panel of an agent's page with changes not yet put in (no Done pressed) is asked about before a result
    // replaces it, whatever the result opens
    whenPanelKept(() => openSearchResult(result));
  };
  const openSearchResult = (result) => {
    if (result.type === 'setting') {
      if (route.view === 'bot') {
        // the agent's workspace takes the request and opens the page and panel that hold it
        requestSettingFocus(route.botId, result.entry.jump, { trail: result.entry.trail });
      }
      return;
    }
    if (result.type === 'agentPage') {
      if (route.view === 'bot') studioNavigate(routeHref(route.botId, result.item.tab, result.item.params), { guard: false });
      return;
    }
    if (result.type === 'workspace') {
      switchWorkspace(result.id, { home: true });
      return;
    }
    if (result.type === 'agentAction') {
      setActive('agents');
      studioNavigate(routeHref(result.botId, result.item.tab, result.item.params));
      return;
    }
    if (result.type === 'action') {
      if (result.id === 'create-agent') openCreateAssistant();
      else if (result.id === 'theme') onToggleTheme();
      else if (result.id === 'help') openHelpDialog();
      return;
    }
    if (result.type === 'agent') {
      setActive('agents');
      setWorkspaceOpen(false);
      studioNavigate(`#/bots/${result.id}`);
      return;
    }
    if (result.type === 'telephony') {
      activate('telephony', { section: result.section });
      return;
    }
    if (result.type === 'session') {
      activate('sessions');
      return;
    }
    activate(result.id);
  };

  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setWorkspaceOpen(false);
        setSearchQuery('');
        setSearchOpen(true);
      }
      if (event.key === 'Escape') setSearchOpen(false);
      // "?" shows the shortcuts and where things are, unless you are typing
      if (event.key === '?' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTyping(event.target)) {
        event.preventDefault();
        openHelpDialog();
      }
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, []);

  const activate = (id, { section } = {}) =>
    whenLeaveConfirmed(() => {
      setActive(id);
      if (id === 'agents') {
        // Agents live on the Agent Builder API; the sidebar entry always shows the list.
        studioNavigate('#/bots');
        return;
      }
      // Telephony opens on Simulated calls, unless a search result named another part (a number, a dispatch rule)
      const part = id === 'telephony' ? (TELEPHONY_SECTIONS.some((item) => item.id === section) ? section : 'calls') : undefined;
      if (part) setTelephonySection(part);
      // the page's own address, as a step in the history (Back returns to the page before)
      const href = workspaceHref(id, part);
      if (window.location.hash !== href) window.location.hash = href;
    });
  // a part of Telephony is a step in the history too
  const openTelephonySection = (part) => {
    setTelephonySection(part);
    const href = workspaceHref('telephony', part);
    if (window.location.hash !== href) window.location.hash = href;
  };

  // Creating an agent happens in the Studio (POST /bots); this just takes you to its dialog.
  const openCreateAssistant = () =>
    whenLeaveConfirmed(() => {
      setActive('agents');
      studioNavigate('#/bots?new=1');
    });

  // The workspace dialogs are opened from the workspace menu, which has closed by the time they close: the keyboard goes back to the workspace button
  // (only when it would otherwise be on nothing)
  const backToSwitcher = () =>
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        document.querySelector('.workspaceSwitch')?.focus({ preventScroll: true });
      }),
    );
  const openCreateWorkspace = () => {
    setWorkspaceOpen(false);
    setWorkspaceNameDraft('');
    setWorkspaceCreateOpen(true);
  };

  //   home: open the workspace's Home (from search) rather than staying on the page you are on
  const switchWorkspace = (workspaceId, { home = false } = {}) => {
    setWorkspaceOpen(false);
    if (workspaceId === currentWorkspaceId && !home) return;
    // An open agent belongs to the workspace you are leaving: leave it first, after asking when it has unsaved edits. Nothing moves before the
    // answer, so Stay keeps everything as it was.
    whenLeaveConfirmed(() => {
      setCurrentWorkspaceId(workspaceId);
      if (home) {
        setActive('home');
        if (window.location.hash !== workspaceHref('home')) window.location.hash = workspaceHref('home');
      } else if (/^#\/bots\/[^/?]+/.test(window.location.hash)) studioNavigate('#/bots');
    });
  };

  const createWorkspace = () => {
    const nextName = workspaceNameDraft.trim();
    if (!nextName) return;
    // the new workspace opens, so an open agent is left (after asking, when it has unsaved edits)
    whenLeaveConfirmed(() => {
      if (/^#\/bots\/[^/?]+/.test(window.location.hash)) studioNavigate('#/bots');
      const nextWorkspace = {
        id: makeWorkspaceId(),
        name: nextName,
        createdAt: new Date().toISOString(),
      };
      setWorkspaces((items) => [...items, nextWorkspace]);
      setCurrentWorkspaceId(nextWorkspace.id);
      setWorkspaceCreateOpen(false);
      backToSwitcher();
      setWorkspaceNameDraft('');
    });
  };

  const openRenameWorkspace = (workspace) => {
    setWorkspaceRenameId(workspace.id);
    setWorkspaceRenameDraft(workspace.name);
    setWorkspaceRenameOpen(true);
  };

  const renameWorkspace = () => {
    const nextName = workspaceRenameDraft.trim();
    if (!nextName || !workspaceRenameId) return;
    setWorkspaces((items) => items.map((ws) => (ws.id === workspaceRenameId ? { ...ws, name: nextName } : ws)));
    setWorkspaceRenameOpen(false);
    backToSwitcher();
    setWorkspaceRenameId(null);
    setWorkspaceRenameDraft('');
  };

  const deleteWorkspace = async (workspace, confirmedAlready = false) => {
    if (workspaces.length <= 1) return;
    const confirmed =
      confirmedAlready ||
      (await askConfirm({
        title: `Delete the workspace “${workspace.name}”?`,
        body: `Its call records, readiness-check runs and telephony settings are removed, and its agents move to ${workspaces.find((ws) => ws.id !== workspace.id)?.name || 'another workspace'}. The agents themselves are not deleted.`,
        confirmLabel: 'Delete workspace',
        tone: 'danger',
      }));
    backToSwitcher();
    if (!confirmed) return;
    const remaining = workspaces.filter((ws) => ws.id !== workspace.id);
    setWorkspaces(remaining);
    if (workspace.id === currentWorkspaceId) {
      setCurrentWorkspaceId(remaining[0]?.id || null);
      setActive('home');
      if (isUnknownAddress(window.location.hash)) window.location.hash = workspaceHref('home');
    }
  };

  const sharedOverlays = (
    <>
      {workspaceCreateOpen && (
        <WorkspaceCreateModal
          value={workspaceNameDraft}
          onChange={setWorkspaceNameDraft}
          onClose={() => {
            setWorkspaceCreateOpen(false);
            backToSwitcher();
          }}
          onCreate={createWorkspace}
        />
      )}

      {workspaceRenameOpen && (
        <WorkspaceRenameModal
          value={workspaceRenameDraft}
          onChange={setWorkspaceRenameDraft}
          onClose={() => {
            setWorkspaceRenameOpen(false);
            backToSwitcher();
          }}
          onRename={renameWorkspace}
        />
      )}

      {picker && <AgentPicker title={picker.title} subtitle={picker.subtitle} agents={botList} onPick={picker.onPick} onClose={() => setPicker(null)} />}
      {searchOpen && (
        <Suspense fallback={null}>
          <SearchOverlay query={searchQuery} onQueryChange={setSearchQuery} groups={searchResults} onSelect={selectSearchResult} onClose={closeSearch} />
        </Suspense>
      )}
    </>
  );
  // where you are, for the bar across the top and the browser tab: the page, the agent it belongs to, the part of Telephony
  const lostAddress = active !== 'agents' && isUnknownAddress(window.location.hash);
  const missingAgent = inAgentView && !!allBots && !allBots.some((bot) => bot.id === route.botId);
  const agentName = inAgentView && !missingAgent ? (allBots || []).find((bot) => bot.id === route.botId)?.name || route.botId : '';
  const pageLabel = lostAddress
    ? 'Page not found'
    : missingAgent
      ? 'Agent not found'
      : inAgentView
        ? PAGE_LABELS[resolvePage(route.tab, { bare: route.bare }).page]
        : [...NAV, ...LIBRARY_NAV, ...SETTINGS_NAV].find((item) => item.id === active)?.label || 'Home';
  const sectionLabel = active === 'telephony' && !lostAddress ? TELEPHONY_SECTIONS.find((item) => item.id === telephonySection)?.label : '';
  // most specific first, so a row of tabs still tells them apart: "Tools · Acme Support · Weave", "Phone numbers · Telephony · Weave"
  const tabTitle = [sectionLabel, pageLabel, agentName, 'Weave'].filter(Boolean).join(' · ');
  useEffect(() => {
    document.title = tabTitle;
  }, [tabTitle]);
  // in a short window the menu scrolls: the page that is open is brought into view in it
  useEffect(() => {
    revealIn(document.querySelector('.dashboard > .sidebar > .sideNav:not(.agentSideNav)'), '.sideLink.selected');
  }, [active, lostAddress]);
  return (
    <SidebarFolded.Provider value={sidebarCollapsed}>
      <div className={`dashboard ${sidebarCollapsed ? 'sidebarCollapsed' : ''} ${inAgentView ? 'inAgent' : ''}`}>
        <SkipToContent target="pageContent" />
        <aside className="sidebar">
          <div className="sideBrand">
            <Logo />
            <Tip label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right">
              <button
                className="collapse"
                type="button"
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-expanded={!sidebarCollapsed}
                onClick={() => setSidebarCollapsed((value) => !value)}
              >
                <Icon name="sidebar" size={18} />
              </button>
            </Tip>
          </div>

          {/* inside an agent the agent is the context: the workspace switch gives way to the agent's own switcher, below. The switcher is a Radix pop-over
            as wide as the switch, with the keyboard on the workspace in use; each workspace's actions are a Radix menu in it (Escape closes the menu
            first, then the switcher, and gives the keyboard back to what opened each) */}
          {!inAgentView && (
            <Popover.Root open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
              <Popover.Trigger asChild>
                <button type="button" className="workspaceSwitch">
                  <span className="workspaceAvatar">{getInitials(workspaceName).slice(0, 1)}</span>
                  <span className="workspaceCopy">
                    <small>Workspace</small>
                    <strong>{workspaceName}</strong>
                  </span>
                  <b className="buttonChevron" aria-hidden="true">
                    <Icon name={workspaceOpen ? 'chevronUp' : 'chevronDown'} size={16} />
                  </b>
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  className="workspaceMenu rxLayer"
                  aria-label="Your workspaces"
                  align="start"
                  sideOffset={6}
                  collisionPadding={12}
                  onEscapeKeyDown={keepEscape}
                  onOpenAutoFocus={(event) => {
                    const current = event.currentTarget?.querySelector?.('.workspaceOption.current, .workspaceOption');
                    if (current) {
                      event.preventDefault();
                      current.focus({ preventScroll: true });
                    }
                  }}
                >
                  <div className="workspaceMenuLabel">Your workspaces</div>
                  <div className="workspaceMenuList">
                    {workspaces.map((workspace) => (
                      <div key={workspace.id} className="workspaceOptionRow">
                        <button
                          type="button"
                          className={`workspaceOption ${workspace.id === currentWorkspaceId ? 'current' : ''}`}
                          onClick={() => switchWorkspace(workspace.id)}
                        >
                          <span className={`tinyDot ${workspace.id === currentWorkspaceId ? 'green' : ''}`} />
                          <span className="workspaceOptionName">{workspace.name}</span>
                          <span className="workspaceOptionMeta">
                            {visibleCount(workspace.id)} {visibleCount(workspace.id) === 1 ? 'agent' : 'agents'}
                          </span>
                          {workspace.id === currentWorkspaceId && <Icon name="check" size={15} className="workspaceCheck" />}
                        </button>
                        <DropdownMenu.Root modal={false}>
                          <DropdownMenu.Trigger asChild>
                            <button type="button" className="workspaceActionTrigger" aria-label={`Actions for ${workspace.name}`}>
                              <Icon name="more" size={16} />
                            </button>
                          </DropdownMenu.Trigger>
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content
                              className="workspaceRowMenu rxLayer"
                              aria-label={`Actions for ${workspace.name}`}
                              align="end"
                              sideOffset={4}
                              collisionPadding={12}
                              onEscapeKeyDown={keepEscape}
                            >
                              <DropdownMenu.Item asChild onSelect={afterMenu(() => openRenameWorkspace(workspace))}>
                                <button type="button">Rename workspace</button>
                              </DropdownMenu.Item>
                              <DropdownMenu.Item asChild disabled={workspaces.length <= 1} onSelect={afterMenu(() => deleteWorkspace(workspace))}>
                                <button type="button" className="danger">
                                  Delete workspace
                                </button>
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu.Root>
                      </div>
                    ))}
                  </div>
                  <p className="workspaceMenuNote">Workspaces group agents in this browser. They don’t control who can see an agent.</p>
                  <button type="button" className="workspaceMenuAction" onClick={openCreateWorkspace}>
                    <span className="tinyDot" /> Create workspace <Icon name="plus" size={15} />
                  </button>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          )}

          {inAgentView && (
            <nav className="sideNav agentSideNav" aria-label="This agent">
              <Tip label={sidebarCollapsed ? 'All agents' : null} side="right">
                <button type="button" className="agentBack" onClick={() => studioNavigate('#/bots')}>
                  <Icon name="chevronLeft" size={15} />
                  <span className="agentBackText">All agents</span>
                </button>
              </Tip>
              {/* the workspace's agents to switch between (all of them, when this agent is listed in another workspace) */}
              {/* not for an agent that isn't there (the page says so): it would show a made-up card for it */}
              {!missingAgent && (
                <AgentSwitcher botId={route.botId} bots={botList.some((b) => b.id === route.botId) ? botList : allBots || botList} tab={route.tab} />
              )}
              <div id="agentNavSlot" />
            </nav>
          )}
          {/* on an address that leads nowhere, no page is marked as the one open */}
          <nav className={`sideNav${inAgentView ? ' sideNavWorkspace' : ''}`}>
            <div className="navLabel">Workspace</div>
            {workspaceNav.map((item) => (
              <NavItem key={item.id} item={item} active={!lostAddress && active === item.id} onClick={() => activate(item.id)} />
            ))}
            <div className="sideDivider" />
            <div className="navLabel">Library</div>
            {LIBRARY_NAV.map((item) => (
              <NavItem key={item.id} item={item} active={!lostAddress && active === item.id} onClick={() => activate(item.id)} />
            ))}
            <div className="sideDivider" />
            {SETTINGS_NAV.map((item) => (
              <NavItem key={item.id} item={item} active={!lostAddress && active === item.id} onClick={() => activate(item.id)} />
            ))}
          </nav>

          <div className="sideBottom">
            <Tip label={`Search (${SHORTCUT_LABEL})`} side="top">
              <button className="sideUtility" type="button" onClick={openSearch} aria-label="Search">
                <Icon name="search" size={17} />
                <span>Search</span>
                <kbd>{SHORTCUT_LABEL}</kbd>
              </button>
            </Tip>
            <Tip label="Help and docs" side="top">
              <button className="sideUtility" type="button" onClick={openHelpDialog} aria-label="Help and docs">
                <Icon name="help" size={17} />
                <span>Help & docs</span>
                <Icon name="external" size={13} />
              </button>
            </Tip>
            <ProfileMenu profile={profile} initials={initials} onAccountOpen={() => onAccountOpen?.(workspaceName)} onSignOut={onSignOut} />
          </div>
        </aside>

        <main className="dashMain">
          <div className="dashTopbar">
            <div className="topbarCrumb">
              <span>{workspaceName}</span>
              <b>/</b>
              {inAgentView ? (
                <>
                  <button type="button" className="crumbLink" onClick={() => studioNavigate('#/bots')}>
                    Agents
                  </button>
                  <b>/</b>
                  {!missingAgent && (
                    <>
                      <button type="button" className="crumbLink" onClick={() => studioNavigate(`#/bots/${route.botId}`, { guard: false })}>
                        {agentName}
                      </button>
                      <b>/</b>
                    </>
                  )}
                  <strong>{pageLabel}</strong>
                </>
              ) : (
                <>
                  <strong>{pageLabel}</strong>
                  {sectionLabel && (
                    <>
                      <b>/</b>
                      <strong>{sectionLabel}</strong>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="topbarActions">
              <DemoSlot />
              {/* a search field, not a button: it says what it finds and how to reach it from the keyboard (its words are its name, as seen) */}
              <button className="topSearch" type="button" onClick={openSearch}>
                <Icon name="search" size={15} />
                <span>Search agents, pages, settings…</span>
                <kbd>{SHORTCUT_LABEL}</kbd>
              </button>
              <AlertBell onOpen={() => activate('alerts')} />
              <StyleMenu theme={theme} onToggleTheme={onToggleTheme} />
              <ProfileMenu profile={profile} initials={initials} compact onAccountOpen={() => onAccountOpen?.(workspaceName)} onSignOut={onSignOut} />
            </div>
          </div>

          <OfflineBanner />
          <ServerDownBanner
            down={apiHealth.state === 'down'}
            onRetry={() => {
              apiHealth.recheck();
              refreshAgents();
            }}
          />
          <div className="dashContent" id="pageContent">
            {/* a page that breaks says so on its own; the menu and the bar above keep working, and opening another page starts afresh */}
            <PageErrorBoundary resetKey={`${active}|${route.view}|${route.botId || ''}|${route.tab || ''}`}>
              <Suspense fallback={<PageLoading />}>
                {bots === null && !agentsError && ['sessions', 'live', 'monitoring', 'speed', 'alerts'].includes(active) ? (
                  // these pages are about the agents' calls: until the agents are known they can't say "none yet"
                  <PageLoading />
                ) : bots === null && agentsError && ['sessions', 'live', 'monitoring', 'speed', 'alerts'].includes(active) ? (
                  <div className="agentsUnavailable">
                    <section className="welcomeBlock">
                      <div>
                        <h1>{pageLabel}</h1>
                      </div>
                    </section>
                    <ErrorState error={agentsError} onRetry={refreshAgents} what="your agents" />
                  </div>
                ) : lostAddress ? (
                  <NotFound
                    title="Page not found"
                    text="This address doesn’t lead to a page in Weave. The link may be mistyped or out of date."
                    actionLabel="Go to Home"
                    onAction={() => activate('home')}
                  />
                ) : active === 'telephony' ? (
                  <TelephonyWorkspace
                    section={telephonySection}
                    onSectionChange={openTelephonySection}
                    onNavigate={activate}
                    telephony={telephony}
                    onTelephonyChange={updateTelephony}
                    onRecordSession={recordSession}
                    agents={agents}
                  />
                ) : active === 'voices' ? (
                  <VoicesWorkspace
                    agents={agents}
                    onAgents={() => activate('agents')}
                    onUseVoice={(voice) => {
                      if (!voice || typeof voice !== 'object' || !voice.name) {
                        activate('agents');
                        return;
                      }
                      setPicker({
                        title: `Use ${voice.name} in an agent`,
                        subtitle: 'The voice is set on the agent’s draft. You review it and save.',
                        onPick: (botId) => {
                          queueChange(botId, {
                            kind: 'voice',
                            provider: String(voice.provider || '').toLowerCase(),
                            providerLabel: voice.provider,
                            name: voice.name,
                            voiceId: voice.voiceId || '',
                          });
                          goToAgent(botId);
                        },
                      });
                    }}
                  />
                ) : active === 'integrations' ? (
                  <IntegrationsWorkspace
                    onAddToAgent={(connection) => {
                      if (!/^https?:\/\//i.test(connection.first || '')) {
                        showNotice({
                          title: 'This connection needs a web address',
                          body: 'Add its address (https://…) with Edit, then add it to an agent.',
                        });
                        return;
                      }
                      setPicker({
                        title: `Add ${connection.name} to an agent`,
                        subtitle: 'It is added to the agent’s draft as a connection. You review it and save.',
                        onPick: (botId) => {
                          queueChange(botId, { kind: 'connection', name: connection.name, url: connection.first });
                          goToAgent(botId);
                        },
                      });
                    }}
                  />
                ) : active === 'monitoring' ? (
                  <MonitoringPage
                    bots={botList}
                    top={<AgentAlerts />}
                    onOpenAgent={(botId, tab, params) =>
                      whenLeaveConfirmed(() => {
                        setActive('agents');
                        studioNavigate(routeHref(botId, tab, params));
                      })
                    }
                    onOpenCall={(botId, callId, view) =>
                      whenLeaveConfirmed(() => {
                        setActive('agents');
                        studioNavigate(routeHref(botId, 'calls', { call: callId, ...(view && view !== 'trace' ? { view } : {}) }));
                      })
                    }
                  />
                ) : active === 'live' ? (
                  <LiveBoardPage
                    bots={botList}
                    onOpenCall={(botId, callId) =>
                      whenLeaveConfirmed(() => {
                        setActive('agents');
                        studioNavigate(routeHref(botId, 'calls', { call: callId }));
                      })
                    }
                  />
                ) : active === 'speed' ? (
                  <SpeedPage
                    bots={botList}
                    onOpenAgent={(botId, tab, params) =>
                      whenLeaveConfirmed(() => {
                        setActive('agents');
                        studioNavigate(routeHref(botId, tab, params));
                      })
                    }
                    onOpenCall={(botId, callId) =>
                      whenLeaveConfirmed(() => {
                        setActive('agents');
                        studioNavigate(routeHref(botId, 'calls', { call: callId }));
                      })
                    }
                  />
                ) : active === 'alerts' ? (
                  <AlertsPage
                    bots={botList}
                    userName={profile?.fullName || ''}
                    onOpenAgent={(botId, tab, params) =>
                      whenLeaveConfirmed(() => {
                        setActive('agents');
                        studioNavigate(routeHref(botId, tab, params));
                      })
                    }
                    onOpenCall={(botId, callId) =>
                      whenLeaveConfirmed(() => {
                        setActive('agents');
                        studioNavigate(routeHref(botId, 'calls', { call: callId }));
                      })
                    }
                  />
                ) : active === 'sessions' ? (
                  <CallsPage
                    bots={botList}
                    onOpenAgent={(id) => {
                      setActive('agents');
                      studioNavigate(routeHref(id, 'test'));
                    }}
                  />
                ) : active === 'agents' ? (
                  <Studio profile={profile} onRecordSession={recordSession} readinessRuns={readinessRuns} onRecordReadiness={recordReadinessRun} />
                ) : active === 'team' ? (
                  <TeamPage
                    agents={botList.map((b) => ({ id: b.id, name: b.name || b.id }))}
                    agentsLoaded={bots !== null}
                    workspaceName={workspaceName}
                    profile={profile}
                  />
                ) : active === 'settings' ? (
                  <SettingsPage
                    workspace={currentWorkspace}
                    workspaceCount={workspaces.length}
                    bots={botList}
                    removedCount={removedBots.length}
                    sessions={sessions}
                    onRename={(name) => setWorkspaces((items) => items.map((ws) => (ws.id === currentWorkspace.id ? { ...ws, name } : ws)))}
                    onDelete={() => deleteWorkspace(currentWorkspace, true)}
                    onOpenAgents={() => {
                      setActive('agents');
                    }}
                  />
                ) : (
                  <>
                    <section className="welcomeBlock">
                      <div>
                        <h1>
                          {greeting}, {firstName}
                          <span>.</span>
                        </h1>
                        <p>
                          {bots === null
                            ? ''
                            : agentCount === 0
                              ? 'Your workspace is ready. Start by creating an agent.'
                              : `${agentCount} agent${agentCount === 1 ? '' : 's'} in ${workspaceName}, ${configuredCount} published.`}{' '}
                          {/* said only when there is something to know: the demo's data, or a server that doesn't answer (a working one goes unsaid) */}
                          {health.show && (
                            <span className="homeConnection" title={health.note}>
                              <span className={`healthSignal ${health.tone}`} aria-hidden="true" />
                              {health.title}
                            </span>
                          )}
                        </p>
                      </div>
                      <button className="primaryCta createButton" type="button" onClick={openCreateAssistant}>
                        <Icon name="plus" size={16} /> Create agent
                      </button>
                    </section>

                    {agentCount > 0 && <WorkspacePulse bots={botList} onOpen={activate} />}

                    <section className="overviewGrid">
                      <div className="mainColumn">
                        {bots === null && agentsError ? (
                          // the list couldn't be read: say so and offer to try again (not "loading" for ever)
                          <ErrorState error={agentsError} onRetry={refreshAgents} what="your agents" />
                        ) : bots === null ? (
                          <p className="stMuted" role="status">
                            Loading agents…
                          </p>
                        ) : agentCount === 0 ? (
                          <>
                            <div className="sectionHeader">
                              <div>
                                <h2>Start with your first agent</h2>
                              </div>
                            </div>
                            <div className="starterCard">
                              {/* the studio's own orb (the one a test conversation shows), in the style's colours */}
                              <div className="starterVisual" aria-hidden="true">
                                <AiOrb size={136} />
                              </div>
                              <div className="starterCopy">
                                <span className="cardTag">Recommended</span>
                                <h3>Build an agent from an idea</h3>
                                <p>Pick a starting point, name your agent, and refine its voice, tools and handoff rules in its config.</p>
                                <div className="starterActions">
                                  {/* quiet: "Create agent" above is the page's one strong button, and does the same */}
                                  <button className="quietButton compactCta" type="button" onClick={openCreateAssistant}>
                                    Start building
                                  </button>
                                </div>
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="sectionHeader">
                              <div>
                                <h2>Your agents</h2>
                              </div>
                              <button className="linkButton" type="button" onClick={() => activate('agents')}>
                                View all
                              </button>
                            </div>
                            <AgentTable bots={botList.slice(0, 4)} onOpen={(bot) => goToAgent(bot.id)} />
                            {botList.length > 4 && (
                              <button type="button" className="agentRowMore" onClick={() => activate('agents')}>
                                Show all {botList.length} agents
                              </button>
                            )}
                          </>
                        )}

                        <div className="sectionHeader activityHeader">
                          <div>
                            <h2>Recent activity</h2>
                          </div>
                          <button className="linkButton" type="button" onClick={() => activate('sessions')}>
                            Open calls
                          </button>
                        </div>
                        <div className="activityCard">
                          {recentActivity.map((item) => (
                            <Activity key={item.key} title={item.title} detail={item.detail} time={item.time} icon={item.icon} muted={item.muted} />
                          ))}
                        </div>
                      </div>

                      <div className="sideColumn">
                        {!(bots === null && agentsError) && (
                          <div className="sectionHeader">
                            <div>
                              <h2>Next step</h2>
                            </div>
                          </div>
                        )}
                        {/* without the list of agents there is no next step to name; the error beside it says why */}
                        {!(bots === null && agentsError) && (
                          <HomeJourney
                            bots={bots}
                            onCreate={openCreateAssistant}
                            onOpenTab={(botId, tab, params) =>
                              whenLeaveConfirmed(() => {
                                setActive('agents');
                                studioNavigate(routeHref(botId, tab, params));
                              })
                            }
                          />
                        )}

                        <div className="sectionHeader quickHeader">
                          <div>
                            <h2>Workspace tools</h2>
                          </div>
                        </div>
                        <div className="quickCard">
                          <QuickAction icon="voice" title="Explore voices" subtitle="Find a voice that fits" onClick={() => activate('voices')} />
                          <QuickAction icon="dial" title="Telephony" subtitle="Numbers, routing and trunks" onClick={() => activate('telephony')} />
                          <QuickAction icon="plug" title="View integrations" subtitle="Connect your stack" onClick={() => activate('integrations')} />
                        </div>
                      </div>
                    </section>

                    {/* the conversations had in the studio's own test panel (the calls themselves are in the numbers at the top): only once there are some,
                      and named for what they are, so they are never read as the agents' traffic */}
                    {sessions.length > 0 && (
                      <section className="insightsSection">
                        <div className="sectionHeader">
                          <div>
                            <h2>Your test conversations</h2>
                          </div>
                          <OneOf className="segmented" label="Time range" value={range} onChange={setRange}>
                            {['Past 7 days', 'Past 30 days'].map((option) => (
                              <Choice key={option} value={option} className={range === option ? 'active' : ''}>
                                {option}
                              </Choice>
                            ))}
                          </OneOf>
                        </div>
                        <div className="insightGrid">
                          {(() => {
                            const st = sessionStats(sessionsInRange(sessions, range));
                            const when = range.toLowerCase();
                            return (
                              <>
                                <Metric title="Conversations" value={String(st.count)} note={st.count ? `In the ${when}` : `None in the ${when}`} />
                                <Metric
                                  title="Average length"
                                  value={st.count ? formatDuration(st.avgSec) : '—'}
                                  note={st.count ? 'From start to end' : 'No conversation yet'}
                                />
                                <Metric
                                  title="Minutes"
                                  value={st.minutes >= 10 ? String(Math.round(st.minutes)) : st.minutes.toFixed(1).replace(/\.0$/, '')}
                                  note="Talking with your agents"
                                />
                                <Metric title="Messages" value={String(st.messages)} note="What you said or typed" />
                              </>
                            );
                          })()}
                        </div>
                      </section>
                    )}
                  </>
                )}
              </Suspense>
            </PageErrorBoundary>
          </div>
        </main>

        {sharedOverlays}
      </div>
    </SidebarFolded.Provider>
  );
}
