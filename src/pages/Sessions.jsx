import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { visibleCount } from '../studio/agents.js';
import { NAV, WORKSPACE_NAV, compactDateTime, formatDuration, formatShortDate, getInitials, sessionStats, sessionsInRange } from './helpers.js';
import { HelpTip, Logo, NavItem, ProfileMenu, SHORTCUT_LABEL, ThemeToggle, helpText, openHelpDialog } from './shared.jsx';

function SessionDetailDialog({ session, onClose }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="createOverlay statusDialogOverlay" role="dialog" aria-modal="true" aria-labelledby="session-detail-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="createModal statusDialog sessionDetailDialog">
        <div className="createModalHeader">
          <div><span className="createEyebrow">SESSION</span><h2 id="session-detail-title">{session.agentName} on {session.versionLabel}</h2><p>{formatShortDate(session.startedAt)}, {formatDuration(session.durationSec)}, {session.channel}</p></div>
          <button type="button" className="modalClose" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <dl className="statusTransition">
          <div><dt>Session ID</dt><dd><code>{session.id}</code></dd></div>
          <div><dt>Room</dt><dd><code>{session.room}</code></dd></div>
          <div><dt>Messages</dt><dd>{session.userMessages} from you</dd></div>
        </dl>
        <div className="sessionTranscript">
          <h3>Transcript</h3>
          {(session.transcript || []).length ? (
            <ol>{session.transcript.map((line, index) => <li key={index} className={line.role}><strong>{line.role === 'user' ? 'You' : session.agentName}</strong><span>{line.text}</span></li>)}</ol>
          ) : <p className="sessionTranscriptEmpty">No messages were exchanged. This was a voice-only session.</p>}
        </div>
        <div className="createModalFooter"><button type="button" className="modalCreate" onClick={onClose}>Done</button></div>
      </section>
    </div>,
    document.body
  );
}

export function SessionsPage({ sessions = [], onOpenSearch, profile, theme, onToggleTheme, onSignOut, onAccountOpen, workspaceName, initials, workspaces = [], currentWorkspaceId, workspaceOpen, setWorkspaceOpen, onSwitchWorkspace, onCreateWorkspace, onNavigate }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [range, setRange] = useState('Past 24 hours');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All statuses');
  const [displayOpen, setDisplayOpen] = useState(false);
  // Room and participants are technical details; they're one click away in Display options.
  const [hiddenColumns, setHiddenColumns] = useState(['ROOM', 'PARTICIPANTS']);
  const SESSION_COLUMNS = ['SESSION ID', 'AGENT', 'VERSION', 'ROOM', 'STARTED', 'ENDED', 'DURATION', 'PARTICIPANTS', 'CHANNEL', 'STATUS'];
  const [openSession, setOpenSession] = useState(null);
  const visibleColumns = SESSION_COLUMNS.filter((column) => !hiddenColumns.includes(column));
  const toggleColumn = (column) => setHiddenColumns((current) => (current.includes(column)
    ? current.filter((item) => item !== column)
    : (SESSION_COLUMNS.length - current.length <= 1 ? current : [...current, column])));

  const inRange = sessionsInRange(sessions, range);
  const needle = search.trim().toLowerCase();
  const rows = inRange.filter((item) => (statusFilter === 'All statuses' || item.status === statusFilter)
    && (!needle || `${item.id} ${item.agentName} ${item.versionLabel} ${item.room} ${item.channel}`.toLowerCase().includes(needle)));
  const stats = sessionStats(inRange);
  const empty = rows.length === 0;
  const cellFor = (item, column) => ({
    'SESSION ID': <code>{item.id}</code>,
    AGENT: item.agentName,
    VERSION: item.versionLabel,
    ROOM: <code>{item.room}</code>,
    STARTED: <span title={formatShortDate(item.startedAt)}>{compactDateTime(item.startedAt)}</span>,
    ENDED: <span title={formatShortDate(item.endedAt)}>{new Date(item.endedAt).toDateString() === new Date(item.startedAt).toDateString() ? new Date(item.endedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : compactDateTime(item.endedAt)}</span>,
    DURATION: formatDuration(item.durationSec),
    PARTICIPANTS: item.participants,
    CHANNEL: item.channel,
    STATUS: <span className={`sessionStatusChip ${String(item.status).toLowerCase()}`}>{item.status}</span>,
  }[column]);
  const closePopovers = () => { setSearchOpen(false); setFilterOpen(false); setDisplayOpen(false); };

  return (
    <div className={`dashboard sessionsDashboard ${sidebarCollapsed ? 'sidebarCollapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sideBrand">
          <Logo />
          <button className="collapse" type="button" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((value) => !value)}>◫</button>
        </div>

        <button className="workspaceSwitch" type="button" aria-label="Current workspace" aria-expanded={workspaceOpen} onClick={() => setWorkspaceOpen?.((value) => !value)}>
          <span className="workspaceAvatar">{getInitials(workspaceName).slice(0, 1)}</span>
          <span className="workspaceCopy"><small>WORKSPACE</small><strong>{workspaceName}</strong></span>
          <b className="buttonChevron">{workspaceOpen ? '⌃' : '⌄'}</b>
        </button>
        {workspaceOpen && (
          <div className="workspaceMenu" role="menu">
            <div className="workspaceMenuLabel">YOUR WORKSPACES</div>
            <div className="workspaceMenuList">
              {workspaces.map((workspace) => (
                <button key={workspace.id} type="button" className={`workspaceOption ${workspace.id === currentWorkspaceId ? 'current' : ''}`} onClick={() => onSwitchWorkspace?.(workspace.id)}>
                  <span className={`tinyDot ${workspace.id === currentWorkspaceId ? 'green' : ''}`} />
                  <span className="workspaceOptionName">{workspace.name}</span>
                  <span className="workspaceOptionMeta">{visibleCount(workspace.id)} {visibleCount(workspace.id) === 1 ? 'agent' : 'agents'}</span>
                  {workspace.id === currentWorkspaceId && <span className="workspaceCheck">✓</span>}
                </button>
              ))}
            </div>
            <p className="workspaceMenuNote">Workspaces group agents in this browser. They don’t control who can see an agent.</p>
            <button type="button" className="workspaceMenuAction" onClick={onCreateWorkspace}><span className="tinyDot" /> Create workspace <b>＋</b></button>
          </div>
        )}

        <nav className="sideNav">
          <div className="navLabel">WORKSPACE</div>
          <NavItem item={NAV[0]} active={false} onClick={() => onNavigate?.('home')} />
          <NavItem item={NAV[1]} active={false} onClick={() => onNavigate?.('agents')} />
          <NavItem item={NAV[2]} active onClick={() => {}} />
          <NavItem item={NAV[3]} active={false} onClick={() => onNavigate?.('readiness')} />
          <div className="sideDivider" />
          <div className="navLabel">CONFIGURATION</div>
          {WORKSPACE_NAV.map((item) => (
            <NavItem key={item.id} item={item} active={false} onClick={() => onNavigate?.(item.id)} />
          ))}
        </nav>

        <div className="sideBottom">
          <button className="sideUtility" type="button" onClick={onOpenSearch}><span>⌕</span><span>Search</span><kbd>{SHORTCUT_LABEL}</kbd></button>
          <button className="sideUtility" type="button" onClick={openHelpDialog}><span>?</span><span>Help & docs</span><b className="buttonArrow">↗</b></button>
          <ProfileMenu profile={profile} initials={initials} onAccountOpen={onAccountOpen} onSignOut={onSignOut} />
        </div>
      </aside>

      <main className="dashMain" onClick={(event) => {
        if (event.target.closest('.sessionsToolbarPopover') || event.target.closest('.sessionToolbarButton')) return;
        if (searchOpen || filterOpen || displayOpen) closePopovers();
      }}>
        <div className="dashTopbar sessionsTopbar">
          <div className="topbarCrumb"><span>{workspaceName}</span><b>/</b><strong>Sessions</strong></div>
          <div className="topbarActions">
            <button className={`quietButton sessionToolbarButton ${autoRefresh ? 'sessionButtonActive' : ''}`} type="button" onClick={() => setAutoRefresh((value) => !value)}><span className="buttonIcon">↻</span><span>Auto-refresh {autoRefresh ? 'on' : 'off'}</span><span className="buttonChevron">⌄</span></button>
            <button className="quietButton sessionToolbarButton" type="button" onClick={() => setRange(range === 'Past 24 hours' ? 'Past 7 days' : 'Past 24 hours')}><span className="buttonIcon">◷</span><span>{range}</span><span className="buttonChevron">⌄</span></button>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <ProfileMenu profile={profile} initials={initials} compact onAccountOpen={onAccountOpen} onSignOut={onSignOut} />
          </div>
        </div>

        <div className="sessionsContent">
          <section className="sessionsSummaryGrid">
            <SummaryStat label="UNIQUE PARTICIPANTS" value={String(stats.participants)} note={stats.count ? `You and ${stats.participants - 1} agent${stats.participants === 2 ? '' : 's'} in ${range.toLowerCase()}` : 'Across the selected time range'} />
            <SummaryStat label="TOTAL ROOMS" value={String(stats.count)} note={stats.count ? `${formatDuration(stats.minutes * 60)} in total` : 'Conversation rooms created'} />
          </section>

          <section className="sessionsTablePanel">
            <div className="sessionsPanelHeader">
              <div>
                <h2>Sessions</h2>
                <p>Review the test conversations started from this browser. Calls from real callers aren’t listed here yet: the runtime keeps its own record of them on the server, and the studio can’t read it yet.</p>
              </div>
              <div className="sessionsToolbar">
                <button className={`sessionToolbarButton quietButton ${filterOpen ? 'sessionButtonActive' : ''}`} type="button" onClick={() => { setFilterOpen((value) => !value); setSearchOpen(false); setDisplayOpen(false); }}>
                  <span>☷</span> Filters
                </button>
                <button className={`sessionToolbarButton iconOnly quietButton ${searchOpen ? 'sessionButtonActive' : ''}`} type="button" aria-label="Search sessions" onClick={() => { setSearchOpen((value) => !value); setFilterOpen(false); setDisplayOpen(false); }}>
                  ⌕
                </button>
                <button className={`sessionToolbarButton iconOnly quietButton ${displayOpen ? 'sessionButtonActive' : ''}`} type="button" aria-label="Display options" aria-expanded={displayOpen} onClick={() => { setDisplayOpen((value) => !value); setFilterOpen(false); setSearchOpen(false); }}>⌘</button>
                {displayOpen && (
                  <div className="sessionsToolbarPopover displayPopover" role="dialog" aria-label="Display options">
                    <div className="popoverTitle">Visible columns</div>
                    <div className="displayColumns">
                      {SESSION_COLUMNS.map((column) => (
                        <label key={column}>
                          <input type="checkbox" checked={!hiddenColumns.includes(column)} disabled={!hiddenColumns.includes(column) && visibleColumns.length <= 1} onChange={() => toggleColumn(column)} />
                          <span>{column.charAt(0) + column.slice(1).toLowerCase()}</span>
                        </label>
                      ))}
                    </div>
                    {hiddenColumns.length > 0 && <button type="button" className="tableColumnsReset" onClick={() => setHiddenColumns([])}>Show all columns</button>}
                  </div>
                )}

                {filterOpen && (
                  <div className="sessionsToolbarPopover filterPopover" role="dialog">
                    <div className="popoverTitle">Filter sessions</div>
                    <label><span>Status</span><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option>All statuses</option><option>Completed</option><option>Active</option><option>Failed</option></select></label>
                    <div className="popoverHint">Filters will apply automatically as session data arrives.</div>
                  </div>
                )}

                {searchOpen && (
                  <div className="sessionsToolbarPopover searchPopover" role="dialog">
                    <input autoFocus placeholder="Search by session or room…" value={search} onChange={(e) => setSearch(e.target.value)} />
                    <span>{search ? `Searching for “${search}”` : 'Search is ready'}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="sessionsTableWrap">
              <table className="sessionsTable">
                <thead>
                  <tr>{visibleColumns.map((column) => <th key={column}>{column}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((item) => (
                    <tr key={item.id} className="sessionRow" tabIndex={0} onClick={() => setOpenSession(item)} onKeyDown={(event) => { if (event.key === 'Enter') setOpenSession(item); }}>
                      {visibleColumns.map((column) => <td key={column}>{cellFor(item, column)}</td>)}
                    </tr>
                  ))}
                  {empty && (
                    <tr className="sessionsEmptyRow">
                      <td colSpan={visibleColumns.length}>
                        <div className="sessionsEmptyState">
                          <div className="sessionsEmptyIcon">◫</div>
                          <strong>{sessions.length ? 'No sessions match' : 'No sessions yet'}</strong>
                          <p>{sessions.length ? 'Try a longer time range, another status or a different search.' : 'Start a conversation from an agent’s Test tab and it will appear here.'}</p>
                          <button type="button" className="secondaryCta" onClick={() => onNavigate?.('agents')}>Test an agent</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
      {openSession && <SessionDetailDialog session={openSession} onClose={() => setOpenSession(null)} />}
    </div>
  );
}

function SummaryStat({ label, value, note }) {
  return (
    <div className="sessionSummaryCard">
      <div className="sessionSummaryLabel">{label}<HelpTip text={helpText(label)} /></div>
      <strong>{value}</strong>
      <small>{note}</small>
      <div className="sessionSummaryLine" />
    </div>
  );
}
