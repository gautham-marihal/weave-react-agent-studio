import { HelpTooltip } from '../studio/builderUi.jsx';
import { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { agentLifecycle, getInitials } from './helpers.js';
import Icon, { ICON_NAMES } from '../ui/Icon.jsx';
import FocusBox from '../ui/FocusBox.jsx';
import { sentenceCase } from '../ui/text.js';
import { whenLeaveConfirmed } from '../studio/route.js';
import { Dialog, DropdownMenu } from 'radix-ui';
import { afterMenu, backTo, keepEscape } from '../ui/layer.ts';
import Tip from '../ui/Tip.tsx';
import { Input } from '../ui/Input.tsx';
import Button from '../ui/Button.tsx';
import Select from '../ui/Select.tsx';
import { askConfirm } from '../ui/dialogs.js';
import { ASSIGNABLE_ROLES } from '../studio/team/teamModel.js';
import { useMyMembership } from '../studio/team/useMyMembership.js';
import { SidebarFolded } from '../ui/sidebarFolded.ts';

// What the workspace pages share: the logo, profile menu and account dialog, help and shortcuts, "?" tips,
// sidebar links, Home's cards (Metric, Activity, QuickAction), and the create/rename workspace dialogs.

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

export const SHORTCUT_LABEL = IS_MAC ? '⌘ K' : 'Ctrl K';
const MOD = IS_MAC ? '⌘' : 'Ctrl';
export const SAVE_LABEL = `${MOD} S`;

// "?" opens the list of shortcuts, unless the keyboard is busy typing somewhere
export function isTyping(target) {
  const el = target instanceof Element ? target : null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

const HELP_COPY = {
  // Home's "Your test conversations": the ones had in the studio's test panel, not the agents' calls
  Conversations: 'Conversations you had with your agents in the studio’s test panel, in the selected time range. Real calls are counted at the top of Home.',
  'Average length': 'How long a test conversation lasted on average, from start to end.',
  Minutes: 'The time spent in test conversations, added up.',
  Messages: 'What you said or typed to your agents in test conversations.',
  'TOTAL CALL DURATION': 'Combined duration of all phone calls in the selected time range.',
  'AVERAGE CALL DURATION': 'Average duration of completed phone calls in the selected time range.',
  'CALLS WITH ISSUES': 'Calls where the system recorded an error, failure, or other issue.',
};

export function HelpTip({ text, className = 'helpDot' }) {
  // Shows on hover, focus and click, and stays inside the viewport.
  return <HelpTooltip text={text || 'More information'} className={className} />;
}

// App-wide notice dialog (help, features not available in this prototype). Any component can
// open it with openInfoDialog(); a single host rendered with the dashboard overlays shows it.
function openInfoDialog(detail) {
  window.dispatchEvent(new CustomEvent('weave:info', { detail }));
}

export const openHelpDialog = () => openInfoDialog({ kind: 'help' });

// The help (and "not available yet") Radix Dialog: it traps focus, Escape or an outside click closes only it (a panel
// it was opened from stays open), and closing gives focus back to what opened it.
export function InfoDialogHost() {
  const [info, setInfo] = useState(null);
  // what had focus when it opened, to give it back to
  const opener = useRef(null);
  useEffect(() => {
    const onInfo = (event) => {
      opener.current = document.activeElement;
      setInfo(event.detail || null);
    };
    window.addEventListener('weave:info', onInfo);
    return () => window.removeEventListener('weave:info', onInfo);
  }, []);
  if (!info) return null;
  const close = () => setInfo(null);
  const isHelp = info.kind === 'help';
  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="createOverlay infoDialogOverlay">
          <Dialog.Content
            className="createModal infoDialog"
            aria-modal="true"
            {...(!isHelp && info.body ? {} : { 'aria-describedby': undefined })}
            onKeyDown={(event) => {
              // Tab and Escape stay here: a dialog or panel under it listens to the page and must not act on them
              if (event.key === 'Tab' || event.key === 'Escape') event.stopPropagation();
            }}
            onEscapeKeyDown={(event) => event.stopPropagation()}
            onCloseAutoFocus={(event) => backTo(opener.current)(event)}
          >
            <div className="createModalHeader">
              <div>
                <span className="createEyebrow">{isHelp ? 'Help' : sentenceCase(info.eyebrow || 'Not available yet')}</span>
                <Dialog.Title asChild>
                  <h2 id="info-dialog-title">{isHelp ? 'Help & shortcuts' : info.title}</h2>
                </Dialog.Title>
                {!isHelp && info.body && (
                  <Dialog.Description asChild>
                    <p>{info.body}</p>
                  </Dialog.Description>
                )}
              </div>
              <Dialog.Close asChild>
                <button type="button" className="modalClose" aria-label="Close">
                  <Icon name="close" size={18} />
                </button>
              </Dialog.Close>
            </div>
            {isHelp ? (
              <div className="infoDialogBody">
                <div className="infoDialogGroup">
                  <h3>Keyboard shortcuts</h3>
                  <dl className="infoShortcuts">
                    <div>
                      <dt>
                        <kbd>{SHORTCUT_LABEL}</kbd>
                      </dt>
                      <dd>Search agents, pages and settings</dd>
                    </div>
                    <div>
                      <dt>
                        <kbd>{SAVE_LABEL}</kbd>
                      </dt>
                      <dd>Save the agent’s draft, from any of its pages</dd>
                    </div>
                    <div>
                      <dt>
                        <kbd>Esc</kbd>
                      </dt>
                      <dd>Close a panel, a dialog, a menu or the search</dd>
                    </div>
                    <div>
                      <dt>
                        <kbd>↑</kbd>
                        <kbd>↓</kbd>
                        <kbd>Enter</kbd>
                      </dt>
                      <dd>Move through and open search results</dd>
                    </div>
                    <div>
                      <dt>
                        <kbd>Enter</kbd>
                      </dt>
                      <dd>Send a message in the Test panel (Shift Enter for a new line)</dd>
                    </div>
                    <div>
                      <dt>
                        <kbd>{MOD} Z</kbd>
                        <kbd>{MOD} Y</kbd>
                      </dt>
                      <dd>Undo and redo on the Workflow canvas</dd>
                    </div>
                    <div>
                      <dt>
                        <kbd>?</kbd>
                      </dt>
                      <dd>This list, from anywhere</dd>
                    </div>
                  </dl>
                </div>
                <div className="infoDialogGroup">
                  <h3>Where things live</h3>
                  <ul className="infoGuide">
                    <li>
                      <strong>An agent’s menu</strong>
                      <span>
                        Overview, then Build (what it says and does), Test and launch, Monitor, and Settings. The card at the top says how far it is from ready
                        and opens the next step.
                      </span>
                    </li>
                    <li>
                      <strong>Test</strong>
                      <span>In the bar at the top of every page of an agent: talk or type to it while you change it.</span>
                    </li>
                    <li>
                      <strong>Publish and Releases</strong>
                      <span>Publish freezes the draft as a version. Releases puts a version in Development, Staging or Production, or rolls one back.</span>
                    </li>
                    <li>
                      <strong>Help icons</strong>
                      <span>
                        Hover, focus or click any <b className="infoHelpDot">?</b> or <b className="infoHelpDot">i</b> for a short explanation.
                      </span>
                    </li>
                  </ul>
                </div>
              </div>
            ) : (
              info.detail && (
                <div className="infoDialogBody">
                  <p className="infoDialogNote">{info.detail}</p>
                </div>
              )
            )}
            <div className="createModalFooter">
              <button type="button" className="modalCreate" onClick={close}>
                {isHelp ? 'Done' : 'Got it'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function helpText(label) {
  return HELP_COPY[label] || `More information about ${label.toLowerCase()}.`;
}

// The mark (public/weave-studio.png) and name. In the workspace a light on the mark shows whether the API answers
// (`health`: describeHealth's { tone, title, note }): green, amber if slow, red if down, grey while asking or in demo.
export function Logo({ health = null }) {
  return (
    <div className="logo">
      <span className="logoMark">
        <img src={`${import.meta.env.BASE_URL}weave-studio.png`} alt="" />
        {health && (
          <Tip label={health.note ? `${health.title}. ${health.note}` : health.title} side="right">
            <span className={`logoLight ${health.tone}`} role="img" aria-label={`API: ${health.title}`} />
          </Tip>
        )}
      </span>
      <span className="logoWord">Weave Studio</span>
    </div>
  );
}

// The person's menu (Radix DropdownMenu): who is signed in, their account, sign out. Opens up from the sidebar name,
// down from the small avatar. An item opens its dialog after the menu returns focus, so the dialog returns it there.
export function ProfileMenu({ profile, initials, compact = false, onAccountOpen, onSignOut }) {
  const displayName = profile?.fullName || 'Workspace user';
  // the role the team gives them (Owner, Admin…), so it reads as on the Team page
  const role = useMyMembership(profile).role?.label || profile?.role || 'Workspace admin';
  return (
    <div className={`profileMenuRoot ${compact ? 'compact' : ''}`}>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          {compact ? (
            // the top bar's: who is signed in and their role, beside the avatar
            <button className="profilePill" type="button">
              <span className="profilePillAvatar">{initials}</span>
              <span className="profilePillText">
                <strong>{displayName}</strong>
                <small>{role}</small>
              </span>
              <Icon name="chevronDown" size={16} className="profilePillChevron" />
            </button>
          ) : (
            <button className="userMenu" type="button">
              <span className="avatar">{initials}</span>
              <span className="userInfo">
                <strong>{displayName}</strong>
                <small>{role}</small>
              </span>
              <span className="dots" aria-hidden="true">
                <Icon name="more" size={16} />
              </span>
            </button>
          )}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={`profilePopover rxLayer ${compact ? 'compactPopover profilePopoverPortal' : 'profilePopoverWide'}`}
            aria-label={displayName}
            side={compact ? 'bottom' : 'top'}
            align={compact ? 'end' : 'start'}
            sideOffset={compact ? 8 : 10}
            collisionPadding={12}
            onEscapeKeyDown={keepEscape}
          >
            <div className="profilePopoverIdentity">
              <span className="profilePopoverAvatar">{initials}</span>
              <div>
                <strong>{displayName}</strong>
                <small>{profile?.email || 'No email on file'}</small>
              </div>
            </div>
            <div className="profilePopoverRule" />
            <DropdownMenu.Item asChild onSelect={afterMenu(onAccountOpen)}>
              <button className="profilePopoverItem" type="button">
                <span className="profilePopoverIcon" aria-hidden="true">
                  <Icon name="user" size={15} />
                </span>
                <span>
                  <strong>Account</strong>
                  {!compact && <small>Profile and workspace details</small>}
                </span>
                <Icon name="chevronRight" size={16} />
              </button>
            </DropdownMenu.Item>
            {/* signing out leaves an open agent too, so unsaved edits are asked about first */}
            {onSignOut && (
              <DropdownMenu.Item asChild onSelect={afterMenu(() => whenLeaveConfirmed(() => onSignOut()))}>
                <button className="profilePopoverItem" type="button">
                  <span className="profilePopoverIcon" aria-hidden="true">
                    <Icon name="signOut" size={15} />
                  </span>
                  <span>
                    <strong>Sign out</strong>
                  </span>
                </button>
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

//   onSave(nextProfile): keeps a changed name or role (the email and workspace are not changed here)
export function AccountDialog({ profile, workspaceName: workspaceNameProp, onClose, onSave, onSignOut }) {
  const fullName = profile?.fullName || 'Workspace user';
  const workspace = workspaceNameProp || profile?.workspaceName || 'My workspace';
  // the role lives in the workspace's team, so a change here shows on the Team page and back; the owner's is fixed
  const { role: teamRole, isOwner, changeRole, rename } = useMyMembership(profile);
  const roleNow = teamRole?.id || ASSIGNABLE_ROLES.find((option) => option.label === profile?.role)?.id || '';
  const [nameDraft, setNameDraft] = useState(profile?.fullName || '');
  const [roleDraft, setRoleDraft] = useState(roleNow);
  const [status, setStatus] = useState('');
  const changed = nameDraft.trim() !== (profile?.fullName || '') || (!isOwner && roleDraft !== roleNow);
  const canSave = changed && nameDraft.trim() !== '';
  const initials = getInitials(nameDraft.trim() || fullName);
  const chosenRole = ASSIGNABLE_ROLES.find((option) => option.id === roleDraft);
  // a different role is confirmed before it is chosen; Save then keeps it
  const chooseRole = async (next) => {
    if (!next || next === roleDraft) return;
    const option = ASSIGNABLE_ROLES.find((candidate) => candidate.id === next);
    const confirmed = await askConfirm({
      title: `Change your role to ${option.label}?`,
      body: `${option.blurb}${chosenRole ? ` You are ${chosenRole.label} now.` : ''}`,
      confirmLabel: `Change to ${option.label}`,
    });
    if (!confirmed) return;
    setRoleDraft(next);
    setStatus('');
  };
  const save = () => {
    if (!canSave) return;
    const name = nameDraft.trim();
    if (!isOwner && roleDraft !== roleNow && teamRole) {
      const problem = changeRole(roleDraft);
      if (problem) {
        setStatus(problem);
        return;
      }
    }
    if (name !== (profile?.fullName || '')) rename(name);
    const label = isOwner ? teamRole.label : chosenRole?.label || profile?.role || '';
    onSave?.({ ...profile, fullName: name, role: label });
    setStatus('Saved.');
  };

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
    <div
      className="accountOverlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="accountTitle"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <FocusBox className="accountPanel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="accountPanelHeader">
          <div>
            <span className="eyebrow cyan">Account</span>
            <h2 id="accountTitle">Your account</h2>
            <p>Profile and workspace details for your Weave account.</p>
          </div>
          <button className="modalClose" type="button" onClick={onClose} aria-label="Close account">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="accountProfileHero">
          <span className="accountHeroAvatar">{initials}</span>
          <div>
            <strong>{fullName}</strong>
            <span>{profile?.email || 'No email on file'}</span>
          </div>
        </div>

        <form
          className="accountDetails"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label className="accountDetail accountField">
            <small>Full name</small>
            <Input
              value={nameDraft}
              onChange={(event) => {
                setNameDraft(event.target.value);
                setStatus('');
              }}
              autoComplete="name"
              aria-invalid={nameDraft.trim() === '' || undefined}
            />
          </label>
          <div className="accountDetail">
            <small>Email</small>
            <strong>{profile?.email || '—'}</strong>
          </div>
          <div className="accountDetail">
            <small>Workspace</small>
            <strong>{workspace}</strong>
          </div>
          <div className="accountDetail accountField">
            <small id="accountRoleLabel">Role</small>
            {isOwner ? (
              <>
                <strong>{teamRole.label}</strong>
                <p className="accountRoleNote">You own this workspace, so your role can’t be changed.</p>
              </>
            ) : (
              <>
                <Select
                  className="stFInput"
                  value={chosenRole ? roleDraft : ''}
                  onChange={(event) => chooseRole(event.target.value)}
                  aria-labelledby="accountRoleLabel"
                >
                  {!chosenRole && <option value="">Choose a role</option>}
                  {ASSIGNABLE_ROLES.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <p className="accountRoleNote">{chosenRole ? chosenRole.blurb : `Now: ${profile?.role || 'no role'}. Choose Admin, Editor or Viewer.`}</p>
              </>
            )}
          </div>
          <div className="accountSaveRow">
            <span role="status" className="accountSaveNote">
              {nameDraft.trim() === '' ? 'Enter your name to save.' : status}
            </span>
            <Button variant="primary" size="compact" type="submit" disabled={!canSave}>
              Save
            </Button>
          </div>
        </form>

        <div className="accountPanelFooter accountActionsFooter">
          <div>
            <span className="accountFooterLabel">Account actions</span>
            <p>Sign out of this Weave workspace.</p>
          </div>
          <button className="accountSignout" type="button" onClick={onSignOut}>
            Sign out <Icon name="arrowRight" size={15} />
          </button>
        </div>
      </FocusBox>
    </div>,
    document.body,
  );
}

// how a search result is known (the workspace remembers the recent ones by it)
export const searchKey = (item) => `${item.type}:${item.section || ''}:${item.id}`;

export function WorkspaceCreateModal({ value, onChange, onClose, onCreate }) {
  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return createPortal(
    <div
      className="workspaceOverlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspaceCreateTitle"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <FocusBox className="workspaceModal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="workspaceModalHeader">
          <div>
            <span className="createEyebrow">New workspace</span>
            <h2 id="workspaceCreateTitle">Create a workspace</h2>
            <p>A workspace groups agents in this browser. It doesn’t control who can see them.</p>
          </div>
          <button className="modalClose" type="button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>

        <label className="workspaceField">
          <span>Workspace name</span>
          <small>This is what you’ll see across Weave.</small>
          <input
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onCreate?.();
            }}
            placeholder="e.g. Customer Support"
          />
        </label>

        <div className="workspaceModalFooter">
          <button type="button" className="modalCancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="modalCreate" disabled={!value.trim()} onClick={onCreate}>
            Create workspace
          </button>
        </div>
      </FocusBox>
    </div>,
    document.body,
  );
}

export function WorkspaceRenameModal({ value, onChange, onClose, onRename }) {
  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return createPortal(
    <div
      className="workspaceOverlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspaceRenameTitle"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <FocusBox className="workspaceModal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="workspaceModalHeader">
          <div>
            <span className="createEyebrow">Workspace</span>
            <h2 id="workspaceRenameTitle">Rename workspace</h2>
            <p>Choose a name that your team will recognize.</p>
          </div>
          <button className="modalClose" type="button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <label className="workspaceField">
          <span>Workspace name</span>
          <small>Used across your Weave workspace.</small>
          <input
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onRename?.();
            }}
            placeholder="e.g. Customer Support"
          />
        </label>
        <div className="workspaceModalFooter">
          <button type="button" className="modalCancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="modalCreate" disabled={!value.trim()} onClick={onRename}>
            Save changes
          </button>
        </div>
      </FocusBox>
    </div>,
    document.body,
  );
}

// Each status implies where the agent runs, so saved status and environment always agree.
// Archived keeps whatever environment it had.

// Lifecycle status: a tinted pill with the status name, so it never relies on colour alone.
export function StatusBadge({ agent, size = 'md' }) {
  const item = agentLifecycle(agent);
  return (
    <span className={`statusBadge ${item.tone} ${size}`} title={`Status: ${item.label}. ${item.note}`}>
      <i aria-hidden="true" />
      {item.label}
    </span>
  );
}

// An icon name is drawn from the studio's icon set; any other text (an old saved glyph, an initial) is shown as it is.
// Symbols older activity entries were saved with (still in the browser's log), drawn as the icon each stood for.
const OLD_SYMBOLS = { '⇢': 'arrowRight', '#': 'dial', '⇄': 'plug', '☎': 'phone' };
export function Glyph({ icon, size = 18 }) {
  const name = OLD_SYMBOLS[icon] || icon;
  return ICON_NAMES.includes(name) ? <Icon name={name} size={size} /> : <>{icon}</>;
}

export function NavItem({ item, active, onClick }) {
  const folded = useContext(SidebarFolded);
  return (
    <Tip label={folded ? item.label : null} side="right">
      <button
        type="button"
        className={`sideLink ${active ? 'selected' : ''}`}
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        aria-label={folded ? item.label : undefined}
      >
        <i>
          <Glyph icon={item.icon} />
        </i>
        <span>{item.label}</span>
        {item.badge ? <em className={item.badgeTone || undefined}>{item.badge}</em> : null}
      </button>
    </Tip>
  );
}

export function Activity({ title, detail, time, icon, muted = false }) {
  return (
    <div className={`activityRow ${muted ? 'muted' : ''}`}>
      <span className="activityIcon">
        <Glyph icon={icon} size={16} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <time>{time}</time>
    </div>
  );
}

export function QuickAction({ icon, title, subtitle, onClick }) {
  return (
    <button className="quickAction" type="button" onClick={onClick}>
      <span className="quickIcon">
        <Glyph icon={icon} size={18} />
      </span>
      <span>
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
      <Icon name="arrowRight" size={16} />
    </button>
  );
}

export function Metric({ title, value, note }) {
  return (
    <div className="metricCard">
      <div className="metricTop">
        <span>{sentenceCase(title)}</span>
        <HelpTip className="metricHelp" text={helpText(title)} />
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
