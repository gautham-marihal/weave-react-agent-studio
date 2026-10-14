import { HelpTooltip } from '../studio/builderUi.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AGENT_LIFECYCLE, agentLifecycle } from './helpers.js';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

export const SHORTCUT_LABEL = IS_MAC ? '⌘ K' : 'Ctrl K';

const HELP_COPY = {
  "SESSIONS": "Total number of conversation sessions recorded for the current workspace and time range.",
  "UNIQUE PARTICIPANTS": "Number of distinct participants seen in the selected time range.",
  "TOTAL ROOMS": "Number of rooms created or used during the selected time range.",
  "TOTAL CALLS": "Total phone calls handled during the selected time range.",
  "TOTAL CALL DURATION": "Combined duration of all phone calls in the selected time range.",
  "AVERAGE CALL DURATION": "Average duration of completed phone calls in the selected time range.",
  "ACTIVE CALLS": "Phone calls that are currently in progress.",
  "CALLS WITH ISSUES": "Calls where the system recorded an error, failure, or other issue.",
  "AGENT NAME": "The display name of this agent.",
  "AGENT ID": "The unique identifier used to reference this agent.",
  "CONCURRENT SESSIONS": "The number of sessions currently running at the same time for this agent.",
  "ENVIRONMENT": "Where this agent runs: Development while it’s built, Staging while it’s reviewed, Production when it’s live. It changes automatically with the status.",
  "STATUS": "Where this agent is in its life: Draft while you build it, In review while it’s tested in staging, Live when it serves real callers in production, or Archived when it’s retired.",
  "TOTAL SESSIONS": "Total sessions handled by this agent in the selected time range.",
  "AVG. LLM TOKENS / SESSION": "Average number of language-model tokens used per session.",
  "INTERRUPTED RATE": "Share of user turns that were interrupted before the agent finished responding.",
  "SESSIONS SERVED": "Session activity over the selected time range.",
  "LATENCY BREAKDOWN": "How response time is distributed across the agent's processing stages.",
  "RESPONSE LATENCY": "How quickly the agent starts and completes a response.",
  "TURNS": "The number of conversational turns recorded for this agent.",
  "INTERRUPTIONS": "How often an agent response was interrupted during a session.",
  "LLM TOKENS": "Language-model token usage attributed to this agent.",
  "MODEL USAGE": "Model usage and activity for this agent.",
  "AGENT UPTIME": "The amount of time this agent has been available to handle sessions.",
  "AGENT JOIN LATENCY": "Time from session start until the agent joins and is ready.",
  "AVERAGE LOAD": "Average runtime load measured for this agent.",
};

export function HelpTip({ text, className = 'helpDot' }) {
  // Shows on hover, focus and click, and stays inside the viewport.
  return <HelpTooltip text={text || 'More information'} className={className} />;
}

// App-wide notice dialog (help, features not available in this prototype). Any component can
// open it with openInfoDialog(); a single host rendered with the dashboard overlays shows it.
export function openInfoDialog(detail) {
  window.dispatchEvent(new CustomEvent('weave:info', { detail }));
}

export const openHelpDialog = () => openInfoDialog({ kind: 'help' });

export function InfoDialogHost() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    const onInfo = (event) => setInfo(event.detail || null);
    window.addEventListener('weave:info', onInfo);
    return () => window.removeEventListener('weave:info', onInfo);
  }, []);
  useEffect(() => {
    if (!info) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setInfo(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [info]);
  if (!info) return null;
  const close = () => setInfo(null);
  const isHelp = info.kind === 'help';
  return createPortal(
    <div className="createOverlay infoDialogOverlay" role="dialog" aria-modal="true" aria-labelledby="info-dialog-title" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="createModal infoDialog">
        <div className="createModalHeader">
          <div>
            <span className="createEyebrow">{isHelp ? 'HELP' : (info.eyebrow || 'NOT AVAILABLE YET')}</span>
            <h2 id="info-dialog-title">{isHelp ? 'Help & shortcuts' : info.title}</h2>
            {!isHelp && info.body && <p>{info.body}</p>}
          </div>
          <button type="button" className="modalClose" aria-label="Close" onClick={close}>×</button>
        </div>
        {isHelp ? (
          <div className="infoDialogBody">
            <div className="infoDialogGroup">
              <h3>Keyboard shortcuts</h3>
              <dl className="infoShortcuts">
                <div><dt><kbd>{SHORTCUT_LABEL}</kbd></dt><dd>Search agents, workspaces and pages</dd></div>
                <div><dt><kbd>Esc</kbd></dt><dd>Close a dialog, menu or search</dd></div>
                <div><dt><kbd>↑</kbd><kbd>↓</kbd><kbd>Enter</kbd></dt><dd>Move through and open search results</dd></div>
                <div><dt><kbd>Enter</kbd></dt><dd>Send a message in an agent’s Test tab</dd></div>
              </dl>
            </div>
            <div className="infoDialogGroup">
              <h3>Where things live</h3>
              <ul className="infoGuide">
                <li><strong>Config</strong><span>Edit an agent as a form or as JSON. Errors are flagged as you type. Save keeps your draft.</span></li>
                <li><strong>Versions and Deploy</strong><span>Publish freezes the draft as a version. Deploy puts a version in Development, Staging or Production.</span></li>
                <li><strong>Test</strong><span>Talk or type to an agent for real, in your browser.</span></li>
                <li><strong>Help icons</strong><span>Hover, focus or click any <b className="infoHelpDot">?</b> for a short explanation.</span></li>
              </ul>
            </div>
          </div>
        ) : (
          info.detail && <div className="infoDialogBody"><p className="infoDialogNote">{info.detail}</p></div>
        )}
        <div className="createModalFooter"><button type="button" className="modalCreate" onClick={close}>{isHelp ? 'Done' : 'Got it'}</button></div>
      </section>
    </div>,
    document.body
  );
}

export function helpText(label) {
  return HELP_COPY[label] || `More information about ${label.toLowerCase()}.`;
}

export function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === 'dark';
  return (
    <button className="themeToggle" onClick={onToggle} type="button" aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}>
      <span className="themeIcon">{isDark ? '☼' : '☾'}</span>
      <span>{isDark ? 'Light' : 'Dark'}</span>
    </button>
  );
}

export function Logo({ compact = false }) {
  return (
    <div className={`logo ${compact ? 'compact' : ''}`} aria-label="Weave">
      <span className="logoMark"><span /></span>
      {!compact && <span className="logoWord">weave</span>}
    </div>
  );
}

function placeDropdown(anchorRect, { width = 220, height = 180, avoidRect = null } = {}) {
  const gap = 10;
  const margin = 12;
  const belowTop = anchorRect.bottom + gap;
  const preferredLeft = Math.min(window.innerWidth - width - margin, Math.max(margin, anchorRect.right - width));
  const candidates = [
    { left: preferredLeft, top: belowTop },
    { left: Math.max(margin, anchorRect.left), top: belowTop },
  ];

  if (avoidRect) {
    candidates.push(
      { left: Math.max(margin, avoidRect.left - width - gap), top: belowTop },
      { left: Math.min(window.innerWidth - width - margin, avoidRect.right + gap), top: belowTop },
    );
  }

  candidates.push(
    { left: preferredLeft, top: Math.max(margin, anchorRect.top - height - gap) },
    { left: Math.max(margin, anchorRect.left - width - gap), top: anchorRect.top },
  );

  const intersects = (left, top, rect) => {
    if (!rect) return false;
    return !(left + width <= rect.left || left >= rect.right || top + height <= rect.top || top >= rect.bottom);
  };

  const fits = (left, top) =>
    left >= margin && left + width <= window.innerWidth - margin &&
    top >= margin && top + height <= window.innerHeight - margin &&
    !intersects(left, top, avoidRect);

  const chosen = candidates.find(({ left, top }) => fits(left, top)) || candidates[0];
  const left = Math.min(window.innerWidth - width - margin, Math.max(margin, chosen.left));
  const top = Math.min(window.innerHeight - height - margin, Math.max(margin, chosen.top));
  return { left, top };
}

export function ProfileMenu({ profile, initials, compact = false, onAccountOpen, onSignOut }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const ref = useRef(null);
  const triggerRef = useRef(null);
  const portalRef = useRef(null);
  const displayName = profile?.fullName || 'Workspace user';
  const role = profile?.role || 'Workspace admin';

  useEffect(() => {
    const handlePointerDown = (event) => {
      const insideTrigger = ref.current?.contains(event.target);
      const insidePortal = portalRef.current?.contains(event.target);
      if (!insideTrigger && !insidePortal) setOpen(false);
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const reposition = () => {
      if (!open || !compact || !triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition(placeDropdown(rect, { width: 232, height: 106 }));
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    reposition();
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [compact, open]);

  const handleAccount = () => {
    setOpen(false);
    onAccountOpen?.();
  };

  return (
    <div className={`profileMenuRoot ${compact ? 'compact' : ''}`} ref={ref}>
      <button
        ref={triggerRef}
        className={compact ? 'profileDot profileTrigger' : 'userMenu'}
        onClick={() => {
          setOpen((value) => {
            const next = !value;
            if (next && compact && triggerRef.current) {
              const rect = triggerRef.current.getBoundingClientRect();
              setPosition(placeDropdown(rect, { width: 232, height: 106 }));
            }
            return next;
          });
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        type="button"
        title={displayName}
      >
        <span className="avatar">{initials}</span>
        {!compact && (
          <span className="userInfo">
            <strong>{displayName}</strong>
            <small>{role}</small>
          </span>
        )}
        {!compact && <span className="dots">•••</span>}
      </button>

      {open && (
        compact ? createPortal(
          <div ref={portalRef} className="profilePopover compactPopover profilePopoverPortal" role="menu" style={{ left: position.left, top: position.top }}>
            <div className="profilePopoverIdentity">
              <span className="profilePopoverAvatar">{initials}</span>
              <div>
                <strong>{displayName}</strong>
                <small>{profile?.email || 'No email on file'}</small>
              </div>
            </div>
            <div className="profilePopoverRule" />
            <button className="profilePopoverItem" type="button" onClick={handleAccount}>
              <span className="profilePopoverIcon">◉</span>
              <span><strong>Account</strong></span>
              <b>›</b>
            </button>
          </div>,
          document.body
        ) : (
          <div className="profilePopover" role="menu">
            <div className="profilePopoverIdentity">
              <span className="profilePopoverAvatar">{initials}</span>
              <div>
                <strong>{displayName}</strong>
                <small>{profile?.email || 'No email on file'}</small>
              </div>
            </div>
            <div className="profilePopoverRule" />
            <button className="profilePopoverItem" type="button" onClick={handleAccount}>
              <span className="profilePopoverIcon">◉</span>
              <span>
                <strong>Account</strong>
                <small>Profile and workspace details</small>
              </span>
              <b>›</b>
            </button>
          </div>
        )
      )}
    </div>
  );
}

export function AccountDialog({ profile, workspaceName: workspaceNameProp, onClose, onSignOut }) {
  const fullName = profile?.fullName || 'Workspace user';
  const initials = fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'W';
  const role = profile?.role || 'Workspace admin';
  const workspace = workspaceNameProp || profile?.workspaceName || 'My workspace';

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleEscape = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return createPortal(
    <div className="accountOverlay" role="dialog" aria-modal="true" aria-labelledby="accountTitle" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <section className="accountPanel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="accountPanelHeader">
          <div>
            <span className="eyebrow cyan">ACCOUNT</span>
            <h2 id="accountTitle">Your account</h2>
            <p>Profile and workspace details for your Weave account.</p>
          </div>
          <button className="modalClose" type="button" onClick={onClose} aria-label="Close account">×</button>
        </div>

        <div className="accountProfileHero">
          <span className="accountHeroAvatar">{initials}</span>
          <div>
            <strong>{fullName}</strong>
            <span>{profile?.email || 'No email on file'}</span>
          </div>
        </div>

        <div className="accountDetails">
          <div className="accountDetail"><small>FULL NAME</small><strong>{fullName}</strong></div>
          <div className="accountDetail"><small>EMAIL</small><strong>{profile?.email || '—'}</strong></div>
          <div className="accountDetail"><small>WORKSPACE</small><strong>{workspace}</strong></div>
          <div className="accountDetail"><small>ROLE</small><strong>{role}</strong></div>
        </div>

        <div className="accountPanelFooter accountActionsFooter">
          <div>
            <span className="accountFooterLabel">ACCOUNT ACTIONS</span>
            <p>Sign out of this Weave workspace.</p>
          </div>
          <button className="accountSignout" type="button" onClick={onSignOut}>Sign out <span className="buttonArrow">→</span></button>
        </div>
      </section>
    </div>,
    document.body
  );
}

export function SearchOverlay({ query, onQueryChange, groups, onSelect, onClose }) {
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (flat.length) setActiveIndex((value) => (value + 1) % flat.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (flat.length) setActiveIndex((value) => (value - 1 + flat.length) % flat.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (flat[activeIndex]) onSelect?.(flat[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
    }
  };

  let runningIndex = -1;
  return createPortal(
    <div
      className="searchOverlay"
      role="dialog"
      aria-modal="true"
      aria-label="Search Weave"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section className="searchPanel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="searchHeader">
          <div className="searchFieldWrap">
            <span aria-hidden="true">⌕</span>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => onQueryChange?.(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search workspaces, agents, or pages…"
              aria-label="Search workspaces, agents, or pages"
              role="combobox"
              aria-expanded="true"
              aria-controls="weave-search-results"
              aria-activedescendant={flat[activeIndex] ? `search-option-${activeIndex}` : undefined}
            />
            <button type="button" className="searchEsc" onClick={onClose}>Esc</button>
          </div>
        </div>
        <div className="searchResults" id="weave-search-results" role="listbox" ref={listRef}>
          {groups.length === 0 ? (
            <div className="searchNoResults">
              <div className="searchNoIcon" aria-hidden="true">⌕</div>
              <strong>No matches for “{query.trim()}”</strong>
              <p>Search by agent name, workspace name, or a page such as Sessions.</p>
            </div>
          ) : groups.map((group) => (
            <div key={group.group} className="searchGroup" role="group" aria-label={group.group}>
              <div className="searchGroupLabel">{group.group}</div>
              <div className="searchGroupItems">
                {group.items.map((item) => {
                  runningIndex += 1;
                  const index = runningIndex;
                  const isActive = index === activeIndex;
                  return (
                    <button
                      key={`${item.type}:${item.id}`}
                      id={`search-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      data-active={isActive}
                      className={`searchResult ${isActive ? 'active' : ''}`}
                      onMouseMove={() => { if (!isActive) setActiveIndex(index); }}
                      onClick={() => onSelect?.(item)}
                    >
                      <span className="searchResultIcon" aria-hidden="true">{item.icon}</span>
                      <span className="searchResultText">
                        <strong>{item.title}</strong>
                        <small>{item.description}</small>
                      </span>
                      <span className="searchResultArrow" aria-hidden="true">↵</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="searchFooter">
          <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
          <span><kbd>Enter</kbd> Open</span>
          <span><kbd>Esc</kbd> Close</span>
        </div>
      </section>
    </div>,
    document.body
  );
}

export function WorkspaceCreateModal({ value, onChange, onClose, onCreate }) {
  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return createPortal(
    <div className="workspaceOverlay" role="dialog" aria-modal="true" aria-labelledby="workspaceCreateTitle" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <section className="workspaceModal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="workspaceModalHeader">
          <div>
            <span className="createEyebrow">NEW WORKSPACE</span>
            <h2 id="workspaceCreateTitle">Create a workspace</h2>
            <p>A workspace groups agents in this browser. It doesn’t control who can see them.</p>
          </div>
          <button className="modalClose" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        <label className="workspaceField">
          <span>Workspace name</span>
          <small>This is what you’ll see across Weave.</small>
          <input
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') onCreate?.(); }}
            placeholder="e.g. Customer Support"
          />
        </label>

        <div className="workspaceModalFooter">
          <button type="button" className="modalCancel" onClick={onClose}>Cancel</button>
          <button type="button" className="modalCreate" disabled={!value.trim()} onClick={onCreate}>Create workspace</button>
        </div>
      </section>
    </div>,
    document.body
  );
}

export function WorkspaceRenameModal({ value, onChange, onClose, onRename }) {
  useEffect(() => {
    const handleEscape = (event) => { if (event.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return createPortal(
    <div className="workspaceOverlay" role="dialog" aria-modal="true" aria-labelledby="workspaceRenameTitle" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <section className="workspaceModal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="workspaceModalHeader">
          <div>
            <span className="createEyebrow">WORKSPACE</span>
            <h2 id="workspaceRenameTitle">Rename workspace</h2>
            <p>Choose a name that your team will recognize.</p>
          </div>
          <button className="modalClose" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <label className="workspaceField">
          <span>Workspace name</span>
          <small>Used across your Weave workspace.</small>
          <input autoFocus value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onRename?.(); }} placeholder="e.g. Customer Support" />
        </label>
        <div className="workspaceModalFooter">
          <button type="button" className="modalCancel" onClick={onClose}>Cancel</button>
          <button type="button" className="modalCreate" disabled={!value.trim()} onClick={onRename}>Save changes</button>
        </div>
      </section>
    </div>,
    document.body
  );
}

// One status for the agent. Each status implies where the agent runs, so the saved
// status and environment always agree. Archived keeps whatever environment it had.

// Lifecycle status: a tinted pill with the status name, so it never relies on colour alone.
export function StatusBadge({ agent, status, size = 'md', title }) {
  const item = status ? (AGENT_LIFECYCLE.find((entry) => entry.status === status) || AGENT_LIFECYCLE[0]) : agentLifecycle(agent);
  return (
    <span className={`statusBadge ${item.tone} ${size}`} title={title || `Status: ${item.label}. ${item.note}`}>
      <i aria-hidden="true" />{item.label}
    </span>
  );
}

export function NavItem({ item, active, onClick }) {
  return (
    <button type="button" className={`sideLink ${active ? 'selected' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined} title={item.label}>
      <i>{item.icon}</i><span>{item.label}</span>{item.badge && <em>{item.badge}</em>}
    </button>
  );
}

export function Activity({ title, detail, time, icon, muted = false }) {
  return (
    <div className={`activityRow ${muted ? 'muted' : ''}`}>
      <span className="activityIcon">{icon}</span>
      <div><strong>{title}</strong><p>{detail}</p></div>
      <time>{time}</time>
    </div>
  );
}

export function ProgressItem({ index, title, done = false, active = false, onClick }) {
  return (
    <button type="button" className={`progressItem ${done ? 'done' : ''} ${active ? 'active' : ''}`} onClick={onClick} disabled={!done && !active}>
      <span className="progressIndex">{done ? '✓' : index}</span>
      <span>{title}</span>
      <b>{done ? 'Done' : active ? 'Start' : 'Later'}</b>
    </button>
  );
}

export function QuickAction({ icon, title, subtitle, onClick }) {
  return (
    <button className="quickAction" type="button" onClick={onClick}>
      <span className="quickIcon">{icon}</span>
      <span><strong>{title}</strong><small>{subtitle}</small></span>
      <b className="buttonArrow">→</b>
    </button>
  );
}

export function Metric({ title, value, note }) {
  return (
    <div className="metricCard">
      <div className="metricTop"><span>{title}</span><HelpTip className="metricHelp" text={helpText(title)} /></div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
