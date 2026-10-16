import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { confirmLeave, navigate as studioNavigate, routeHref, useRoute } from '../studio/route.js';
import { TAB_LABELS } from '../studio/journey.js';
import { loadSchema } from '../studio/form/useSchema.js';
import { requestSettingFocus } from '../studio/settingFocus.js';
import { ownerOf, setWorkspaces as publishWorkspaces, toLegacyAgent, useBots, visibleCount } from '../studio/agents.js';
import AgentPicker from '../studio/AgentPicker.jsx';
import { queueChange } from '../studio/pendingChange.js';
import Studio from '../studio/Studio.jsx';
import SettingsPage from '../studio/SettingsPage.jsx';
import { BotRow } from '../studio/BotsPage.jsx';
import { describeHealth, useApiHealth } from '../studio/useApiHealth.js';
import MonitoringPage from '../studio/monitoring/MonitoringPage.jsx';
import { LIBRARY_NAV, NAV, SETTINGS_NAV, TELEPHONY_SECTIONS, formatDuration, formatRelative, getInitials, makeRecordId, normalizeTelephony, sessionStats, sessionsInRange } from './helpers.js';
import { Activity, Logo, Metric, NavItem, ProfileMenu, QuickAction, SHORTCUT_LABEL, SearchOverlay, ThemeToggle, WorkspaceCreateModal, WorkspaceRenameModal, openHelpDialog } from './shared.jsx';
import { CallsPage } from './Sessions.jsx';
import HomeJourney, { rememberAgent } from './HomeJourney.jsx';
import './homeJourney.css';
import { TelephonyPage } from './Telephony.jsx';
import { VoicesWorkspace } from './Voices.jsx';
import { IntegrationsWorkspace } from './Integrations.jsx';

const WORKSPACE_STORAGE_KEY = 'weave_workspaces';

const CURRENT_WORKSPACE_KEY = 'weave_current_workspace';

function makeWorkspaceId() {
  return `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
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

  try { localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([first])); } catch {}
  try { localStorage.setItem(CURRENT_WORKSPACE_KEY, first.id); } catch {}
  return [first];
}

function loadCurrentWorkspaceId(workspaces) {
  try {
    const current = localStorage.getItem(CURRENT_WORKSPACE_KEY);
    if (current && workspaces.some((ws) => ws.id === current)) return current;
  } catch {}
  return workspaces[0]?.id || null;
}

function saveWorkspaceState(workspaces, currentId) {
  try { localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspaces)); } catch {}
  try { if (currentId) localStorage.setItem(CURRENT_WORKSPACE_KEY, currentId); } catch {}
}

export function Dashboard({ profile, theme, onToggleTheme, onSignOut, onAccountOpen }) {
  const displayName = profile?.fullName || 'there';
  const firstName = displayName.split(' ')[0];
  const initials = getInitials(displayName);
  // An agent link (#/bots/...) opens the Agents area, so refreshes and shared links land on the agent.
  const [active, setActive] = useState(() => (/^#\/bots/.test(window.location.hash) ? 'agents' : 'home'));
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [picker, setPicker] = useState(null); // 'which agent?' for voices and integrations
  const goToAgent = (botId) => { setActive('agents'); studioNavigate(`#/bots/${botId}`); };
  const [workspaceCreateOpen, setWorkspaceCreateOpen] = useState(false);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('');
  const [workspaceActionOpenId, setWorkspaceActionOpenId] = useState(null);
  const [workspaceRenameOpen, setWorkspaceRenameOpen] = useState(false);
  const [workspaceRenameId, setWorkspaceRenameId] = useState(null);
  const [workspaceRenameDraft, setWorkspaceRenameDraft] = useState('');
  const [range, setRange] = useState('Past 7 days');
  const [telephonySection, setTelephonySection] = useState('calls');
  const [workspaces, setWorkspaces] = useState(() => loadWorkspaces(profile));
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(null);

  const currentWorkspace = workspaces.find((ws) => ws.id === currentWorkspaceId) || workspaces[0] || null;
  const workspaceName = currentWorkspace?.name || 'My workspace';
  // Agents are the Agent Builder API's. Which workspace an agent is in is kept in this browser (see studio/agents.js),
  // so this is the open workspace's agents. The older pages read them in their own shape.
  const { bots, removed: removedBots, all: allBots, refresh: refreshAgents } = useBots();
  const botList = bots || [];
  const agents = useMemo(() => botList.map(toLegacyAgent), [bots]);
  const telephony = normalizeTelephony(currentWorkspace?.telephony);
  const sessions = normalizeList(currentWorkspace?.sessions);
  const readinessRuns = normalizeList(currentWorkspace?.simulations);
  const activityLog = normalizeList(currentWorkspace?.activity);
  const withActivity = (ws, entry) => (entry
    ? { ...ws, activity: [{ id: makeRecordId('ACT'), at: new Date().toISOString(), ...entry }, ...normalizeList(ws.activity)].slice(0, 120) }
    : ws);
  // Records go to the workspace you are in (a test conversation can finish after you switch pages).
  const workspaceIdRef = useRef(null);
  workspaceIdRef.current = currentWorkspaceId;
  const updateWorkspaceOfAgent = (_agentId, updater) => {
    setWorkspaces((items) => items.map((ws) => (ws.id === workspaceIdRef.current ? updater(ws) : ws)));
  };
  const updateTelephony = (updater, activity) => {
    if (!currentWorkspace) return;
    setWorkspaces((items) => items.map((ws) => (ws.id === currentWorkspace.id ? withActivity({ ...ws, telephony: updater(normalizeTelephony(ws.telephony)) }, activity) : ws)));
  };
  const recordSession = (session) => {
    if (!session?.agentId) return;
    updateWorkspaceOfAgent(session.agentId, (ws) => withActivity(
      { ...ws, sessions: [session, ...normalizeList(ws.sessions)].slice(0, 500) },
      String(session.channel || '').startsWith('Phone')
        ? { kind: 'session', icon: 'phone', title: `${session.agentName} answered a simulated call`, detail: `${formatDuration(session.durationSec)} talk time after ${formatDuration(session.holdSec || 0)} on hold.` }
        : { kind: 'session', icon: 'test', title: `${session.agentName} had a test conversation`, detail: `${formatDuration(session.durationSec)} on ${session.versionLabel}, ${session.userMessages} message${session.userMessages === 1 ? '' : 's'}.` },
    ));
  };
  const recordReadinessRun = (run) => {
    if (!run?.agentId) return;
    updateWorkspaceOfAgent(run.agentId, (ws) => withActivity(
      { ...ws, simulations: [run, ...normalizeList(ws.simulations)].slice(0, 200) },
      { kind: 'readiness', icon: 'check', title: `Readiness checks for ${run.agentName}`, detail: `${run.versionLabel}: passed ${run.passed} of ${run.total} checks.` },
    ));
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

  // The agent store needs to know the workspaces to say which agents belong to the open one.
  useLayoutEffect(() => {
    publishWorkspaces(workspaces, currentWorkspace?.id || null, (workspaceId) => switchWorkspace(workspaceId));
  });

  // A link to an agent that belongs to another workspace (a bookmark, a shared link) opens that workspace.
  const route = useRoute();
  const inAgentView = active === 'agents' && route.view === 'bot'; // inside an agent the sidebar shows that agent's menu
  useEffect(() => { if (route.view === 'bot') rememberAgent(route.botId); }, [route.view, route.botId]);
  // An agent link opened while the app is already running (back/forward, pasted link) switches to Agents.
  useEffect(() => {
    if (/^#\/bots/.test(window.location.hash)) setActive((value) => (value === 'agents' ? value : 'agents'));
  }, [route]);
  useEffect(() => {
    if (route.view !== 'bot' || !currentWorkspace || !allBots) return;
    if (!allBots.some((bot) => bot.id === route.botId)) return;
    const owner = ownerOf(route.botId);
    if (owner && owner !== currentWorkspace.id) setCurrentWorkspaceId(owner);
  // Only a new link or a fresh agent list triggers this, never a workspace switch: that goes back to the list first.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.view, route.botId, allBots]);

  // Close the workspace switcher (and its row menus) on outside click or Escape.
  useEffect(() => {
    if (!workspaceOpen && !workspaceActionOpenId) return undefined;
    const onPointerDown = (event) => {
      if (event.target.closest?.('.workspaceMenu, .workspaceSwitch')) return;
      setWorkspaceOpen(false);
      setWorkspaceActionOpenId(null);
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setWorkspaceOpen(false);
      setWorkspaceActionOpenId(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [workspaceOpen, workspaceActionOpenId]);

  useEffect(() => {
    if (!workspaceOpen) setWorkspaceActionOpenId(null);
  }, [workspaceOpen]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  // Landing on the Overview or the Agents page asks for a fresh list.
  useEffect(() => { if (active === 'home' || active === 'agents') refreshAgents(); }, [active]);
  const agentCount = botList.length;
  const configuredCount = botList.filter((bot) => bot.latest_version).length;
  const health = describeHealth(useApiHealth());

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
    list.push({ key: 'workspace', title: 'Workspace created', detail: `${workspaceName} is ready to use.`, time: formatRelative(currentWorkspace?.createdAt), icon: 'home', muted: list.length > 0 });
    return list;
  }, [bots, workspaceName, currentWorkspace?.createdAt, activityLog]);

  const openSearch = () => {
    setWorkspaceOpen(false);
    setSearchQuery('');
    setSearchOpen(true);
  };

  const closeSearch = () => setSearchOpen(false);

  // The settings of the agent that is open can be searched by name (what they are called, what they are for, the key the file uses). The index is built
  // from the schema the first time search is opened on an agent, and not before.
  const [settingsIndex, setSettingsIndex] = useState(null);
  const agentOpen = route.view === 'bot';
  useEffect(() => {
    if (!searchOpen || !agentOpen || settingsIndex) return undefined;
    let off = false;
    Promise.all([import('../studio/settingsSearch.js'), loadSchema()]).then(([module, schema]) => { if (!off) setSettingsIndex({ search: module.searchSettings, entries: module.buildSettingsIndex(schema) }); }).catch(() => {});
    return () => { off = true; };
  }, [searchOpen, agentOpen, settingsIndex]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const pages = [
      { type: 'page', id: 'home', title: 'Home', description: 'What needs attention, and the next step', icon: 'home' },
      { type: 'page', id: 'agents', title: 'Agents', description: `${botList.length} agent${botList.length === 1 ? '' : 's'}`, icon: 'agent' },
      { type: 'page', id: 'sessions', title: 'Calls', description: 'Every conversation your agents have had', icon: 'phone' },
      { type: 'page', id: 'monitoring', title: 'Monitoring', description: 'How your agents are doing, and what needs attention', icon: 'monitor' },
      { type: 'page', id: 'voices', title: 'Voices', description: 'Hear and choose a voice', icon: 'voice' },
      { type: 'page', id: 'integrations', title: 'Integrations', description: 'Connect your stack', icon: 'plug' },
      { type: 'page', id: 'telephony', title: 'Telephony', description: 'Phone numbers, dispatch rules and SIP trunks', icon: 'dial' },
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
    const numberResults = tel.numbers.map((item) => ({ type: 'telephony', section: 'numbers', id: item.id, title: item.number, description: item.label ? `Phone number, ${item.label}` : 'Phone number', icon: '#' }));
    const ruleResults = tel.rules.map((item) => ({ type: 'telephony', section: 'dispatch', id: item.id, title: item.name, description: `Dispatch rule to ${nameOf(item.agentId)}`, icon: '⇢' }));
    const sessionResults = normalizeList(currentWorkspace?.sessions).slice(0, 50).map((item) => ({ type: 'session', id: item.id, title: `${item.agentName} session`, description: `${item.versionLabel}, ${formatRelative(item.startedAt).toLowerCase()}, ${formatDuration(item.durationSec)}`, icon: '◷' }));
    const groups = [
      { group: 'Navigate', items: pages },
      { group: 'Workspaces', items: workspaceResults },
      { group: 'Agents', items: agentResults },
      ...(q ? [
        { group: 'Phone numbers', items: numberResults },
        { group: 'Dispatch rules', items: ruleResults },
        { group: 'Calls', items: sessionResults },
      ] : []),
    ];
    if (!q) return groups.filter((group) => group.items.length);
    const matching = groups.map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${item.title} ${item.description}`.toLowerCase().includes(q)
      ),
    })).filter((group) => group.items.length);
    const settings = agentOpen && settingsIndex ? settingsIndex.search(settingsIndex.entries, searchQuery, 8).map((entry) => ({ type: 'setting', id: entry.trail.join('.'), title: entry.label, description: `${entry.where}${entry.level === 'expert' ? ' · advanced' : ''}`, icon: 'sliders', entry })) : [];
    return settings.length ? [...matching, { group: 'Settings of this agent', items: settings }] : matching;
  }, [bots, searchQuery, workspaces, currentWorkspace, settingsIndex, agentOpen]);

  const selectSearchResult = (result) => {
    setSearchOpen(false);
    setSearchQuery('');
    if (result.type === 'setting') {
      if (route.view === 'bot') { requestSettingFocus(route.botId, result.entry.jump); studioNavigate(routeHref(route.botId, 'config'), { guard: false }); }
      return;
    }
    if (result.type === 'workspace') {
      switchWorkspace(result.id);
      setActive('home');
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
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, []);

  const activate = (id, { section } = {}) => {
    if (!confirmLeave()) return; // unsaved edits in an open agent
    // Leaving the Agents area drops its address, so a refresh reopens this page rather than an old agent.
    if (id !== 'agents' && /^#\/bots/.test(window.location.hash)) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    setActive(id);
    if (id === 'agents') {
      // Agents live on the Agent Builder API; the sidebar entry always shows the list.
      studioNavigate('#/bots');
      return;
    }
    if (id === 'telephony') {
      // Telephony always opens on Simulated calls, unless a search result named another part (a number, a dispatch rule)
      setTelephonySection(TELEPHONY_SECTIONS.some((item) => item.id === section) ? section : 'calls');
    }
  };

  // Creating an agent happens in the Studio (POST /bots); this just takes you to its dialog.
  const openCreateAssistant = () => {
    if (!confirmLeave()) return;
    setActive('agents');
    studioNavigate('#/bots?new=1');
  };

  const openCreateWorkspace = () => {
    setWorkspaceOpen(false);
    setWorkspaceNameDraft('');
    setWorkspaceCreateOpen(true);
  };

  const switchWorkspace = (workspaceId) => {
    if (workspaceId === currentWorkspaceId) {
      setWorkspaceOpen(false);
      return;
    }
    // An open agent belongs to the workspace you are leaving: go back to the list first (and honour unsaved edits).
    if (/^#\/bots\/[^/?]+/.test(window.location.hash) && !studioNavigate('#/bots')) { setWorkspaceOpen(false); return; }
    setCurrentWorkspaceId(workspaceId);
    setWorkspaceOpen(false);
  };

  const createWorkspace = () => {
    const nextName = workspaceNameDraft.trim();
    if (!nextName) return;
    if (/^#\/bots\/[^/?]+/.test(window.location.hash) && !studioNavigate('#/bots')) return;

    const nextWorkspace = {
      id: makeWorkspaceId(),
      name: nextName,
      createdAt: new Date().toISOString(),
    };

    const nextWorkspaces = [...workspaces, nextWorkspace];
    setWorkspaces(nextWorkspaces);
    setCurrentWorkspaceId(nextWorkspace.id);
    setWorkspaceCreateOpen(false);
    setWorkspaceNameDraft('');
  };

  const openRenameWorkspace = (workspace) => {
    setWorkspaceActionOpenId(null);
    setWorkspaceRenameId(workspace.id);
    setWorkspaceRenameDraft(workspace.name);
    setWorkspaceRenameOpen(true);
  };

  const renameWorkspace = () => {
    const nextName = workspaceRenameDraft.trim();
    if (!nextName || !workspaceRenameId) return;
    setWorkspaces((items) => items.map((ws) => ws.id === workspaceRenameId ? { ...ws, name: nextName } : ws));
    setWorkspaceRenameOpen(false);
    setWorkspaceRenameId(null);
    setWorkspaceRenameDraft('');
  };

  const deleteWorkspace = (workspace, confirmedAlready = false) => {
    setWorkspaceActionOpenId(null);
    if (workspaces.length <= 1) return;
    const confirmed = confirmedAlready || window.confirm(`Delete the workspace "${workspace.name}"? Its sessions, readiness-check runs and telephony settings are removed from this browser, and its agents move to ${workspaces.find((ws) => ws.id !== workspace.id)?.name || 'another workspace'}. Nothing is deleted on the server.`);
    if (!confirmed) return;
    const remaining = workspaces.filter((ws) => ws.id !== workspace.id);
    setWorkspaces(remaining);
    if (workspace.id === currentWorkspaceId) {
      setCurrentWorkspaceId(remaining[0]?.id || null);
      setActive('home');
    }
  };

  const sharedOverlays = (
    <>
        {workspaceCreateOpen && (
          <WorkspaceCreateModal
            value={workspaceNameDraft}
            onChange={setWorkspaceNameDraft}
            onClose={() => setWorkspaceCreateOpen(false)}
            onCreate={createWorkspace}
          />
        )}

        {workspaceRenameOpen && (
          <WorkspaceRenameModal
            value={workspaceRenameDraft}
            onChange={setWorkspaceRenameDraft}
            onClose={() => setWorkspaceRenameOpen(false)}
            onRename={renameWorkspace}
          />
        )}

        {picker && <AgentPicker title={picker.title} subtitle={picker.subtitle} agents={botList} onPick={picker.onPick} onClose={() => setPicker(null)} />}
        {searchOpen && (
          <SearchOverlay
            query={searchQuery}
            onQueryChange={setSearchQuery}
            groups={searchResults}
            onSelect={selectSearchResult}
            onClose={closeSearch}
          />
        )}
    </>
  );
  const withOverlays = (node) => <>{node}{sharedOverlays}</>;

  if (active === 'telephony') {
    return withOverlays(
      <TelephonyPage
        profile={profile}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onSignOut={onSignOut}
        onAccountOpen={() => onAccountOpen?.(workspaceName)}
        workspaceName={workspaceName}
        initials={initials}
        workspaces={workspaces}
        currentWorkspaceId={currentWorkspaceId}
        workspaceOpen={workspaceOpen}
        setWorkspaceOpen={setWorkspaceOpen}
        onSwitchWorkspace={switchWorkspace}
        onCreateWorkspace={openCreateWorkspace}
        onNavigate={activate}
        onOpenSearch={openSearch}
        section={telephonySection}
        onSectionChange={setTelephonySection}
        telephony={telephony}
        onTelephonyChange={updateTelephony}
        onRecordSession={recordSession}
        agents={agents}
      />
    );
  }

  return (
    <div className={`dashboard ${sidebarCollapsed ? 'sidebarCollapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sideBrand">
          <Logo />
          <button className="collapse" type="button" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((value) => !value)}>◫</button>
        </div>

        <button type="button" className="workspaceSwitch" onClick={() => setWorkspaceOpen((value) => !value)} aria-expanded={workspaceOpen}>
          <span className="workspaceAvatar">{getInitials(workspaceName).slice(0, 1)}</span>
          <span className="workspaceCopy"><small>WORKSPACE</small><strong>{workspaceName}</strong></span>
          <b className="buttonChevron">{workspaceOpen ? '⌃' : '⌄'}</b>
        </button>
        {workspaceOpen && (
          <div className="workspaceMenu" role="menu">
            <div className="workspaceMenuLabel">YOUR WORKSPACES</div>
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
                    <span className="workspaceOptionMeta">{visibleCount(workspace.id)} {visibleCount(workspace.id) === 1 ? 'agent' : 'agents'}</span>
                    {workspace.id === currentWorkspaceId && <span className="workspaceCheck">✓</span>}
                  </button>
                  <button
                    type="button"
                    className="workspaceActionTrigger"
                    aria-label={`Actions for ${workspace.name}`}
                    aria-expanded={workspaceActionOpenId === workspace.id}
                    onClick={(event) => { event.stopPropagation(); setWorkspaceActionOpenId((value) => value === workspace.id ? null : workspace.id); }}
                  >⋯</button>
                  {workspaceActionOpenId === workspace.id && (
                    <div className="workspaceRowMenu" role="menu">
                      <button type="button" onClick={() => openRenameWorkspace(workspace)}>Rename workspace</button>
                      <button type="button" className="danger" disabled={workspaces.length <= 1} onClick={() => deleteWorkspace(workspace)}>Delete workspace</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="workspaceMenuNote">Workspaces group agents in this browser. They don’t control who can see an agent.</p>
            <button type="button" className="workspaceMenuAction" onClick={openCreateWorkspace}><span className="tinyDot" /> Create workspace <b>＋</b></button>
          </div>
        )}

        {inAgentView && (
          <nav className="sideNav agentSideNav" aria-label="This agent">
            <button type="button" className="agentBack" title="Back to workspace" onClick={() => studioNavigate('#/bots')}><span aria-hidden="true">‹</span><span className="agentBackText"> Back to workspace</span></button>
            <div className="agentSideName"><span className="agentRowAvatar" aria-hidden="true">{String((allBots || []).find((bot) => bot.id === route.botId)?.name || route.botId).slice(0, 1).toUpperCase()}</span><strong>{(allBots || []).find((bot) => bot.id === route.botId)?.name || route.botId}</strong></div>
            <div id="agentNavSlot" />
          </nav>
        )}
        <nav className={`sideNav${inAgentView ? ' sideNavWorkspace' : ''}`}>
          <div className="navLabel">WORKSPACE</div>
          {NAV.map((item) => (
            <NavItem key={item.id} item={item} active={active === item.id} onClick={() => activate(item.id)} />
          ))}
          <div className="sideDivider" />
          <div className="navLabel">LIBRARY</div>
          {LIBRARY_NAV.map((item) => (
            <NavItem key={item.id} item={item} active={active === item.id} onClick={() => activate(item.id)} />
          ))}
          <div className="sideDivider" />
          {SETTINGS_NAV.map((item) => (
            <NavItem key={item.id} item={item} active={active === item.id} onClick={() => activate(item.id)} />
          ))}
        </nav>

        <div className="sideBottom">
          <button className="sideUtility" type="button" onClick={openSearch}><span>⌕</span><span>Search</span><kbd>{SHORTCUT_LABEL}</kbd></button>
          <button className="sideUtility" type="button" onClick={openHelpDialog}><span>?</span><span>Help & docs</span><b className="buttonArrow">↗</b></button>
          <ProfileMenu profile={profile} initials={initials} onAccountOpen={() => onAccountOpen?.(workspaceName)} onSignOut={onSignOut} />
        </div>
      </aside>

      <main className="dashMain">
        <div className="dashTopbar">
          <div className="topbarCrumb">
            <span>{workspaceName}</span><b>/</b>
            {active === 'agents' && route.view === 'bot' ? (
              <>
                <button type="button" className="crumbLink" onClick={() => studioNavigate('#/bots')}>Agents</button><b>/</b>
                <button type="button" className="crumbLink" onClick={() => studioNavigate(`#/bots/${route.botId}`, { guard: false })}>{(allBots || []).find((bot) => bot.id === route.botId)?.name || route.botId}</button><b>/</b>
                <strong>{TAB_LABELS[route.tab] || 'Config'}</strong>
              </>
            ) : (
              <strong>{[...NAV, ...LIBRARY_NAV, ...SETTINGS_NAV].find((item) => item.id === active)?.label || 'Home'}</strong>
            )}
          </div>
          <div className="topbarActions">
            <button className="quietButton" type="button" onClick={openSearch}>⌕ <span>Search</span></button>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <ProfileMenu profile={profile} initials={initials} compact onAccountOpen={() => onAccountOpen?.(workspaceName)} onSignOut={onSignOut} />
          </div>
        </div>

        <div className="dashContent">
          {active === 'voices' ? (
            <VoicesWorkspace
              agents={agents}
              onAgents={() => activate('agents')}
              onUseVoice={(voice) => {
                if (!voice || typeof voice !== 'object' || !voice.name) { activate('agents'); return; }
                setPicker({ title: `Use ${voice.name} in an agent`, subtitle: 'The voice is set on the agent’s draft. You review it and save.', onPick: (botId) => { queueChange(botId, { kind: 'voice', provider: String(voice.provider || '').toLowerCase(), providerLabel: voice.provider, name: voice.name, voiceId: voice.voiceId || '' }); goToAgent(botId); } });
              }}
            />
          ) : active === 'integrations' ? (
            <IntegrationsWorkspace onAddToAgent={(connection) => {
              if (!/^https?:\/\//i.test(connection.first || '')) { window.alert('This connection needs a web address (https://…) before it can be added to an agent. Use Edit to add one.'); return; }
              setPicker({ title: `Add ${connection.name} to an agent`, subtitle: 'It is added to the agent’s draft as a connection. You review it and save.', onPick: (botId) => { queueChange(botId, { kind: 'connection', name: connection.name, url: connection.first }); goToAgent(botId); } });
            }} />
          ) : active === 'monitoring' ? (
            <MonitoringPage
              bots={botList}
              onOpenAgent={(botId, tab, params) => { if (!confirmLeave()) return; setActive('agents'); studioNavigate(routeHref(botId, tab, params)); }}
              onOpenCall={(botId, callId, view) => { if (!confirmLeave()) return; setActive('agents'); studioNavigate(routeHref(botId, 'calls', { call: callId, ...(view && view !== 'trace' ? { view } : {}) })); }}
            />
          ) : active === 'sessions' ? (
            <CallsPage bots={botList} onOpenAgent={(id) => { setActive('agents'); studioNavigate(routeHref(id, 'test')); }} />
          ) : active === 'agents' ? (
            <Studio profile={profile} onRecordSession={recordSession} readinessRuns={readinessRuns} onRecordReadiness={recordReadinessRun} />
          ) : active === 'settings' ? (
            <SettingsPage
              workspace={currentWorkspace}
              workspaceCount={workspaces.length}
              bots={botList}
              removedCount={removedBots.length}
              sessions={sessions}
              onRename={(name) => setWorkspaces((items) => items.map((ws) => (ws.id === currentWorkspace.id ? { ...ws, name } : ws)))}
              onDelete={() => deleteWorkspace(currentWorkspace, true)}
              onOpenAgents={() => { setActive('agents'); }}
            />
          ) : (
          <>
          <section className="welcomeBlock">
            <div>
              <h1>{greeting}, {firstName}<span>.</span></h1>
              <p>{agentCount === 0 ? 'Your workspace is ready. Start by creating an agent.' : `${agentCount} agent${agentCount === 1 ? '' : 's'} in ${workspaceName}.`}</p>
            </div>
            <button className="primaryCta createButton" type="button" onClick={openCreateAssistant}>＋ Create agent</button>
          </section>

          <section className="healthStrip">
            <div className="healthLead" title={health.note}><span className={`healthSignal ${health.tone}`} /><div><small>Studio connection</small><strong>{health.title}</strong></div></div>
            <div className="healthStats"><span><b>{agentCount}</b> {agentCount === 1 ? 'agent' : 'agents'}</span><span><b>{configuredCount}</b> published</span></div>
          </section>

          <section className="overviewGrid">
            <div className="mainColumn">
              {bots === null ? (
                <p className="stMuted" role="status">Loading agents…</p>
              ) : agentCount === 0 ? (
                <>
                  <div className="sectionHeader"><div><h2>Start with your first agent</h2></div></div>
                  <div className="starterCard">
                    <div className="starterVisual" aria-hidden="true">
                      <div className="starterGlow" />
                      <div className="starterIcon">✦</div>
                      <div className="starterOrbit orbitA" />
                      <div className="starterOrbit orbitB" />
                    </div>
                    <div className="starterCopy">
                      <span className="cardTag">Recommended</span>
                      <h3>Build an agent from an idea</h3>
                      <p>Pick a starting point, name your agent, and refine its voice, tools and handoff rules in its config.</p>
                      <div className="starterActions">
                        <button className="primaryCta compactCta" type="button" onClick={openCreateAssistant}>Start building</button>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="sectionHeader"><div><h2>Your agents</h2></div><button className="linkButton" type="button" onClick={() => activate('agents')}>View all</button></div>
                  <div className="agentRowList">
                    {botList.slice(0, 4).map((bot) => <BotRow key={bot.id} bot={bot} onOpen={() => goToAgent(bot.id)} />)}
                    {botList.length > 4 && <button type="button" className="agentRowMore" onClick={() => activate('agents')}>Show all {botList.length} agents</button>}
                  </div>
                </>
              )}

              <div className="sectionHeader activityHeader"><div><h2>Recent activity</h2></div><button className="linkButton" type="button" onClick={() => activate('sessions')}>Open calls</button></div>
              <div className="activityCard">
                {recentActivity.map((item) => (
                  <Activity key={item.key} title={item.title} detail={item.detail} time={item.time} icon={item.icon} muted={item.muted} />
                ))}
              </div>
            </div>

            <div className="sideColumn">
              <div className="sectionHeader"><div><h2>Next step</h2></div></div>
              <HomeJourney bots={bots === null ? null : botList} onCreate={openCreateAssistant} onOpenTab={(botId, tab) => { if (!confirmLeave()) return; setActive('agents'); studioNavigate(routeHref(botId, tab)); }} />

              <div className="sectionHeader quickHeader"><div><h2>Workspace tools</h2></div></div>
              <div className="quickCard">
                <QuickAction icon="voice" title="Explore voices" subtitle="Find a voice that fits" onClick={() => activate('voices')} />
                <QuickAction icon="dial" title="Telephony" subtitle="Numbers, routing and trunks" onClick={() => activate('telephony')} />
                <QuickAction icon="plug" title="View integrations" subtitle="Connect your stack" onClick={() => activate('integrations')} />
              </div>
            </div>
          </section>

          <section className="insightsSection">
            <div className="sectionHeader"><div><h2>Performance snapshot</h2></div>
              <div className="segmented" role="group" aria-label="Time range">
                {['Past 7 days', 'Past 30 days'].map((option) => (
                  <button key={option} type="button" aria-pressed={range === option} className={range === option ? 'active' : ''} onClick={() => setRange(option)}>{option}</button>
                ))}
              </div>
            </div>
            <div className="insightGrid">
              {(() => { const st = sessionStats(sessionsInRange(sessions, range)); const when = range.toLowerCase(); return (<>
                <Metric title="SESSIONS" value={String(st.count)} note={st.count ? `Test conversations in the ${when.replace('past ', 'past ')}` : 'No sessions yet'} />
                <Metric title="AVG. SESSION" value={st.count ? formatDuration(st.avgSec) : '—'} note={st.count ? 'Average length' : 'Awaiting your first run'} />
                <Metric title="SESSION MINUTES" value={st.minutes >= 10 ? String(Math.round(st.minutes)) : st.minutes.toFixed(1).replace(/\.0$/, '')} note={st.count ? `${st.messages} message${st.messages === 1 ? '' : 's'} sent` : 'No live usage yet'} />
                <Metric title="PARTICIPANTS" value={String(st.participants)} note={st.count ? 'You and the agents you tested' : 'No participants yet'} />
              </>); })()}
            </div>
          </section>
          </>
          )}
        </div>
      </main>

      {sharedOverlays}
    </div>
  );
}
