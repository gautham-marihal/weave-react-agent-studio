import { useEffect, useRef, useState } from 'react';
import { visibleCount } from '../studio/agents.js';
import { getCachedConfig, loadConfigs } from '../studio/configCache.js';
import { hasHumanHandoff } from '../studio/scenarios.js';
import { createPortal } from 'react-dom';
import { RANGE_MS, TELEPHONY_SECTIONS, formatShortDate, agentLifecycle, compactDateTime, formatDuration, getInitials, makeRecordId, normalizeTelephony } from './helpers.js';
import { HelpTip, Logo, ProfileMenu, SHORTCUT_LABEL, StatusBadge, ThemeToggle, helpText, openHelpDialog } from './shared.jsx';


// The Telephony pages are a local mock: everything here is kept in this browser and nothing is sent to any phone system.
// Said plainly on every section, so nobody believes a number or a trunk exists.
const TELEPHONY_PREVIEW_COPY = {
  calls: 'These calls are simulated in your browser to show how your rules would route a call. No real call is placed or received, and the sessions they add are kept in this browser only.',
  dispatch: 'Rules here are saved in this browser and route no real call. On the platform a call reaches an agent through a LiveKit SIP trunk and a dispatch rule that names the agent and its environment, which is set up with a command-line tool for now. Business hours, caller-prefix routing, priority, hold limits, hold messages and overflow to another agent are not features of the platform yet.',
  numbers: 'Nothing is bought or connected: “Get a number” only adds a row here. A real phone number is connected on the platform for now. A phone channel’s number field in the agent’s configuration is a description and doesn’t route calls either.',
  trunks: 'Nothing is created at a carrier: a trunk here is only a row in this browser. The platform’s SIP trunks are set up outside this app for now.',
};

function TelephonyPreviewBanner({ section }) {
  return (
    <div className="telephonyPreview" role="note">
      <b>Preview, not connected</b>
      <span>{TELEPHONY_PREVIEW_COPY[section] || TELEPHONY_PREVIEW_COPY.calls}</span>
    </div>
  );
}

export function TelephonyPage({ onRecordSession, telephony = normalizeTelephony(), onTelephonyChange, agents = [], onOpenSearch, profile, theme, onToggleTheme, onSignOut, onAccountOpen, workspaceName, initials, workspaces = [], currentWorkspaceId, workspaceOpen, setWorkspaceOpen, onSwitchWorkspace, onCreateWorkspace, onNavigate, section, onSectionChange }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const title = TELEPHONY_SECTIONS.find((item) => item.id === section)?.label || 'Calls';
  return (
    <div className={`dashboard telephonyDashboard ${sidebarCollapsed ? 'sidebarCollapsed' : ''}`}>
      <aside className="sidebar telephonySidebar">
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

        <div className="telephonySideTitle"><button type="button" aria-label="Back to workspace overview" title="Back to overview" onClick={() => onNavigate?.('home')}>←</button><strong>Telephony</strong><em className="telephonyPreviewTag">Preview</em></div>
        <nav className="telephonyNav" aria-label="Telephony">
          {TELEPHONY_SECTIONS.map((item) => (
            <button key={item.id} type="button" className={`telephonyNavItem ${section === item.id ? 'active' : ''}`} aria-label={item.label} aria-current={section === item.id ? 'page' : undefined} title={sidebarCollapsed ? item.label : undefined} onClick={() => onSectionChange?.(item.id)}>
              <span aria-hidden="true">{item.icon}</span><strong>{item.label}</strong>
            </button>
          ))}
        </nav>

        <div className="sideBottom">
          <button className="sideUtility" type="button" onClick={onOpenSearch}><span>⌕</span><span>Search</span><kbd>{SHORTCUT_LABEL}</kbd></button>
          <button className="sideUtility" type="button" onClick={openHelpDialog}><span>?</span><span>Help & docs</span><b className="buttonArrow">↗</b></button>
          <ProfileMenu profile={profile} initials={initials} onAccountOpen={onAccountOpen} onSignOut={onSignOut} />
        </div>
      </aside>

      <main className="dashMain telephonyMain">
        <div className="dashTopbar">
          <div className="topbarCrumb"><span>{workspaceName}</span><b>/</b><strong>Telephony</strong><b>/</b><strong>{title}</strong></div>
          <div className="topbarActions">
            <button className="quietButton" type="button" onClick={onOpenSearch}>⌕ <span>Search</span></button>
            <button className="quietButton" type="button" onClick={openHelpDialog}>? <span>Help</span></button>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <ProfileMenu profile={profile} initials={initials} compact onAccountOpen={onAccountOpen} onSignOut={onSignOut} />
          </div>
        </div>

        <div className="telephonyContent">
          <TelephonyPreviewBanner section={section} />
          {section === 'calls' && <TelephonyCallsPage telephony={telephony} onNavigateSection={onSectionChange} agents={agents} onChange={onTelephonyChange} onRecordSession={onRecordSession} onOpenSessions={() => onNavigate?.('sessions')} />}
          {section === 'dispatch' && <TelephonyDispatchPage telephony={telephony} onChange={onTelephonyChange} agents={agents} onNavigateSection={onSectionChange} onNavigate={onNavigate} />}
          {section === 'numbers' && <TelephonyNumbersPage telephony={telephony} onChange={onTelephonyChange} agents={agents} onNavigateSection={onSectionChange} />}
          {section === 'trunks' && <TelephonyTrunksPage telephony={telephony} onChange={onTelephonyChange} />}
        </div>
      </main>
    </div>
  );
}

const TELEPHONY_COUNTRIES = [
  { code: 'US', name: 'United States', dial: '+1', example: '415', area: /^[2-9]\d{2}$/, areaRule: 'Use a 3-digit US area code, such as 415.' },
  { code: 'GB', name: 'United Kingdom', dial: '+44', example: '20', area: /^\d{2,4}$/, areaRule: 'Use 2 to 4 digits, such as 20.' },
  { code: 'SG', name: 'Singapore', dial: '+65', example: '', area: null, areaRule: '' },
  { code: 'AU', name: 'Australia', dial: '+61', example: '2', area: /^[2378]$/, areaRule: 'Use one digit: 2, 3, 7 or 8.' },
  { code: 'IN', name: 'India', dial: '+91', example: '22', area: /^\d{2,4}$/, areaRule: 'Use 2 to 4 digits, such as 22.' },
];

const RULE_TYPES = {
  individual: { label: 'Individual', note: 'Each caller gets their own room with the agent.' },
  direct: { label: 'Direct', note: 'All callers join one shared room.' },
};

const makeTelephonyId = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;


const randomDigits = (count) => Array.from({ length: count }, () => Math.floor(Math.random() * 10)).join('');

// Builds a test number in the chosen country. US numbers use the 555-01xx range reserved for
// fictional use, so a generated number can never belong to a real subscriber.
function generateTestNumber(country, areaCode = '', existing = []) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let number;
    if (country.code === 'US') number = `+1 ${areaCode || country.example} 555 01${randomDigits(2)}`;
    else if (country.code === 'GB') number = `+44 ${areaCode || country.example} 7946 0${randomDigits(3)}`;
    else if (country.code === 'SG') number = `+65 6${randomDigits(3)} ${randomDigits(4)}`;
    else if (country.code === 'AU') number = `+61 ${areaCode || country.example} 5550 ${randomDigits(4)}`;
    else number = `${country.dial} ${areaCode || country.example} ${randomDigits(4)} ${randomDigits(4)}`;
    if (!existing.includes(number)) return number;
  }
  return `${country.dial} ${randomDigits(10)}`;
}

function TelephonyRangeControls({ range: controlledRange, onRangeChange }) {
  const [refresh, setRefresh] = useState('Off');
  const [localRange, setLocalRange] = useState('Past 24 hours');
  const range = controlledRange || localRange;
  const setRange = onRangeChange || setLocalRange;
  return (
    <div className="telephonyHeaderActions">
      <label className="selectButton">
        <span className="buttonIcon" aria-hidden="true">↻</span>
        <select value={refresh} onChange={(event) => setRefresh(event.target.value)} aria-label="Auto-refresh">
          {['Off', 'Every 30 seconds', 'Every minute', 'Every 5 minutes'].map((option) => <option key={option} value={option}>{option === 'Off' ? 'Auto-refresh off' : `Refresh: ${option.toLowerCase()}`}</option>)}
        </select>
      </label>
      <label className="selectButton">
        <span className="buttonIcon" aria-hidden="true">◷</span>
        <select value={range} onChange={(event) => setRange(event.target.value)} aria-label="Time range">
          {['Past 24 hours', 'Past 7 days', 'Past 30 days', 'Past 90 days'].map((option) => <option key={option}>{option}</option>)}
        </select>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dispatch rule behaviour, routing and simulated calls
// ---------------------------------------------------------------------------
const RULE_DEFAULTS = { hours: 'any', days: [1, 2, 3, 4, 5], openTime: '09:00', closeTime: '17:00', callerPrefix: '', priority: 5, maxHold: 30, holdMessage: '', overflow: 'person', overflowAgentId: '' };

const RULE_HOURS = { any: 'Any time', business: 'Business hours', after: 'After hours' };

const OVERFLOW_OPTIONS = {
  person: { label: 'Hand off to a person', short: 'Hand to a person' },
  agent: { label: 'Send to another agent', short: 'Send to another agent' },
  end: { label: 'Play the exit message and end the call', short: 'End the call' },
  wait: { label: 'Keep waiting', short: 'Keep waiting' },
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const ruleSettings = (rule) => ({ ...RULE_DEFAULTS, ...(rule || {}) });

function describeRuleHours(rule) {
  const r = ruleSettings(rule);
  if (r.hours === 'any') return 'Any time';
  const days = [...r.days].sort();
  const dayText = days.join(',') === '1,2,3,4,5' ? 'Mon–Fri' : days.join(',') === '0,1,2,3,4,5,6' ? 'Every day' : days.map((d) => WEEKDAYS[d]).join(', ');
  return `${r.hours === 'business' ? '' : 'Outside '}${dayText} ${r.openTime}–${r.closeTime}`.trim();
}

// Two-line schedule for tables: days on top, hours underneath.
function RuleHoursCell({ rule }) {
  const r = ruleSettings(rule);
  if (r.hours === 'any') return <span className="whenCell"><span>Any time</span></span>;
  const full = describeRuleHours(rule);
  const days = full.replace(` ${r.openTime}–${r.closeTime}`, '');
  return <span className="whenCell"><span>{days}</span><small>{r.openTime}–{r.closeTime}</small></span>;
}

function ruleAppliesAt(rule, date) {
  const r = ruleSettings(rule);
  if (r.hours === 'any') return true;
  const minutes = date.getHours() * 60 + date.getMinutes();
  const [oh, om] = r.openTime.split(':').map(Number); const [ch, cm] = r.closeTime.split(':').map(Number);
  const inside = r.days.includes(date.getDay()) && minutes >= oh * 60 + om && minutes < ch * 60 + cm;
  return r.hours === 'business' ? inside : !inside;
}

// Rules that handle this call, best first (lowest priority number wins, then oldest rule).
function matchingRules(telephony, numberId, caller, date) {
  const digits = (value) => String(value || '').replace(/[^\d+]/g, '');
  return (telephony.rules || [])
    .filter((rule) => rule.routing === 'all' || rule.routing === numberId)
    .filter((rule) => ruleAppliesAt(rule, date))
    .filter((rule) => { const prefix = digits(ruleSettings(rule).callerPrefix); return !prefix || digits(caller).startsWith(prefix); })
    .sort((a, b) => ruleSettings(a).priority - ruleSettings(b).priority || new Date(a.createdAt) - new Date(b.createdAt));
}

const randomBetween = (min, max) => Math.round(min + Math.random() * (max - min));

const BUSY_LEVELS = { quiet: { label: 'Quiet', wait: [0, 6] }, busy: { label: 'Busy', wait: [15, 45] }, overloaded: { label: 'Overloaded', wait: [60, 120] } };

// Plays a call through every stage using the real dispatch rules. Hold time only counts the
// stages where the caller is waiting: for the agent, a fallback agent, or a person.
function simulateCall({ telephony, agents, numberId, caller, when, busy = 'quiet', wantsPerson = false }) {
  const number = (telephony.numbers || []).find((item) => item.id === numberId);
  const stages = [];
  let cursor = when.getTime();
  const push = (key, label, detail, seconds = 0, hold = false, agentWait = false) => { stages.push({ key, label, detail, at: new Date(cursor).toISOString(), durationSec: seconds, hold, agentWait }); cursor += seconds * 1000; };
  const lifecycleNote = (agent) => (agentLifecycle(agent).status === 'published' ? '' : ` ${agent.name} is ${agentLifecycle(agent).label}, not Live.`);
  const issues = [];
  let status = 'Completed'; let answeredBy = null; let rule = null; let conversationStart = null; let conversationSec = 0;

  push('incoming', 'Incoming call', `${caller} called ${number?.number || 'your number'}.`, 2);
  const matches = matchingRules(telephony, numberId, caller, when);
  if (!matches.length) {
    push('nomatch', 'No rule matched', 'No dispatch rule handles this number, caller and time, so no agent answered.', 1);
    status = 'No match'; issues.push('No dispatch rule matched this call.');
  } else {
    rule = matches[0];
    const r = ruleSettings(rule);
    const agent = agents.find((item) => item.id === rule.agentId);
    push('matched', `Matched “${rule.name}”`, `${describeRuleHours(rule)}${r.callerPrefix ? `, callers starting ${r.callerPrefix}` : ''}.${matches.length > 1 ? ` Chosen over ${matches.length - 1} other matching rule${matches.length === 2 ? '' : 's'} by priority ${r.priority}.` : ''}`, 1);
    const wait = randomBetween(...BUSY_LEVELS[busy].wait);
    const holdNote = r.holdMessage ? ` They heard: “${r.holdMessage}”` : '';
    if (!agent) {
      push('failed', 'Agent missing', 'The rule points to an agent that no longer exists.', 1);
      status = 'Failed'; issues.push('The rule’s agent was deleted.');
    } else if (wait > r.maxHold && r.overflow !== 'wait') {
      push('hold', `On hold for ${agent.name}`, `No answer within the ${r.maxHold}-second limit.${holdNote}`, r.maxHold, true, true);
      if (r.overflow === 'agent') {
        const fallback = agents.find((item) => item.id === r.overflowAgentId);
        if (fallback) {
          push('overflow', `Sent to ${fallback.name}`, `The rule sends unanswered calls to ${fallback.name}.`, 1);
          push('hold', `On hold for ${fallback.name}`, 'Waiting for the fallback agent.', randomBetween(2, 8), true);
          answeredBy = fallback; status = 'Overflowed';
        } else {
          push('failed', 'Fallback agent missing', 'The fallback agent no longer exists.', 1); status = 'Failed'; issues.push('The fallback agent was deleted.');
        }
      } else if (r.overflow === 'person') {
        push('hold', 'Waiting for a person', `No agent answered in time, so the call went to the human queue.`, randomBetween(10, 40), true);
        conversationStart = cursor; conversationSec = randomBetween(60, 180);
        push('handoff', 'Answered by a person', 'A member of your team took the call.', conversationSec);
        status = 'Handed to a person';
      } else {
        push('exit', 'Exit message played', 'No one answered in time, so the call ended politely.', 4);
        status = 'Ended early'; issues.push(`No one answered within ${r.maxHold} seconds.`);
      }
    } else if (wait > 120) {
      push('hold', `On hold for ${agent.name}`, `Past the ${r.maxHold}-second limit; the rule keeps callers waiting.${holdNote}`, 120, true, true);
      push('abandoned', 'Caller hung up', 'The caller gave up after two minutes on hold.', 0);
      status = 'Abandoned'; issues.push('The caller hung up while on hold.');
    } else {
      if (wait > 0) push('hold', `On hold for ${agent.name}`, wait > r.maxHold ? `Past the ${r.maxHold}-second limit; the rule keeps callers waiting.${holdNote}` : `Waiting for the agent.${holdNote}`, wait, true, true);
      answeredBy = agent;
    }
    if (answeredBy) {
      const note = lifecycleNote(answeredBy);
      if (note) issues.push(note.trim());
      conversationStart = cursor; conversationSec = randomBetween(45, 240);
      push('answered', `Answered by ${answeredBy.name}`, `Version ${answeredBy.version || '0.1.0'}.${note}`, conversationSec);
      if (wantsPerson) {
        const cached = getCachedConfig(answeredBy.id);
        const canHandOff = cached ? hasHumanHandoff(cached) : null;
        if (canHandOff) {
          push('hold', 'Waiting for a person', `The caller asked for a person, so ${answeredBy.name} handed off.`, randomBetween(10, 40), true);
          push('handoff', 'Answered by a person', 'A member of your team took over.', randomBetween(60, 180));
          status = 'Handed to a person';
        } else if (canHandOff === false) {
          issues.push(`The caller asked for a person, but ${answeredBy.name} has no transfer, callback tool or escalation rule.`);
        } else {
          issues.push(`The caller asked for a person, but ${answeredBy.name}’s configuration couldn’t be read to check handoff.`);
        }
      }
    }
    const agentWait = stages.filter((stage) => stage.agentWait).reduce((sum, stage) => sum + stage.durationSec, 0);
    if (agentWait > r.maxHold) issues.push(`The caller waited ${formatDuration(agentWait)} for ${agent?.name || 'the agent'}, over the rule’s ${r.maxHold}-second limit.`);
  }
  push('ended', 'Call ended', '', 0);
  const holdSec = stages.filter((stage) => stage.hold).reduce((sum, stage) => sum + stage.durationSec, 0);
  const agentWaitSec = stages.filter((stage) => stage.agentWait).reduce((sum, stage) => sum + stage.durationSec, 0);
  const overLimit = !!rule && agentWaitSec > ruleSettings(rule).maxHold;
  const durationSec = Math.round((cursor - when.getTime()) / 1000);
  return {
    id: makeRecordId('CA'), simulated: true, direction: 'Inbound', from: caller, to: number?.number || '—', numberId,
    ruleId: rule?.id || '', ruleName: rule?.name || '', maxHold: rule ? ruleSettings(rule).maxHold : null,
    agentId: answeredBy?.id || rule?.agentId || '', agentName: answeredBy?.name || (rule ? (agents.find((item) => item.id === rule.agentId)?.name || 'Deleted agent') : ''),
    answeredBy: answeredBy ? { id: answeredBy.id, name: answeredBy.name, version: answeredBy.version || '0.1.0' } : null,
    startedAt: when.toISOString(), endedAt: new Date(cursor).toISOString(), durationSec, holdSec, agentWaitSec, overLimit, connectedSec: Math.max(0, durationSec - holdSec),
    conversationStart: conversationStart ? new Date(conversationStart).toISOString() : null, conversationSec,
    status, issues, stages, busy, wantsPerson,
  };
}

function callsInRange(calls = [], range = 'Past 24 hours') {
  const since = Date.now() - (RANGE_MS[range] || RANGE_MS['Past 24 hours']);
  return calls.filter((call) => new Date(call.startedAt).getTime() >= since);
}

const CALL_STATUS_TONE = { Completed: 'good', 'Handed to a person': 'good', Overflowed: 'warn', 'Ended early': 'warn', Abandoned: 'bad', 'No match': 'bad', Failed: 'bad' };

function CallDetailDialog({ call, onClose, onOpenSessions }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const overLimit = !!call.overLimit;
  return createPortal(
    <div className="createOverlay statusDialogOverlay" role="dialog" aria-modal="true" aria-labelledby="call-detail-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="createModal statusDialog callDetailDialog">
        <div className="createModalHeader">
          <div><span className="createEyebrow">{call.simulated ? 'SIMULATED CALL' : 'CALL'}</span><h2 id="call-detail-title">Call #{call.id.slice(-6).toUpperCase()}</h2><p>{call.from} to {call.to}, {formatShortDate(call.startedAt)}{call.ruleName ? `, rule “${call.ruleName}”` : ''}</p></div>
          <button type="button" className="modalClose" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <dl className="callFacts">
          <div><dt>Status</dt><dd><span className={`callStatusChip ${CALL_STATUS_TONE[call.status] || 'warn'}`}>{call.status}</span></dd></div>
          <div><dt>Hold time</dt><dd className={overLimit ? 'isOver' : ''}>{formatDuration(call.holdSec)}{call.maxHold != null && <small>{(call.agentWaitSec || 0) !== call.holdSec ? `${formatDuration(call.agentWaitSec || 0)} for the agent, ` : ''}limit {call.maxHold} sec</small>}</dd></div>
          <div><dt>Talk time</dt><dd>{formatDuration(call.connectedSec)}</dd></div>
          <div><dt>Total</dt><dd>{formatDuration(call.durationSec)}</dd></div>
        </dl>
        {call.issues?.length > 0 && <div className="statusBlocked" role="note"><strong>{call.issues.length === 1 ? 'Something to check' : `${call.issues.length} things to check`}</strong><ul className="statusRuleList">{call.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
        <div className="statusConsequences"><h3>Call stages</h3></div>
        <ol className="callStages">
          {call.stages.map((stage, index) => (
            <li key={index} className={`${stage.hold ? 'isHold' : ''} stage-${stage.key}`}>
              <span className="callStageDot" aria-hidden="true" />
              <div className="callStageBody">
                <div className="callStageHead"><strong>{stage.label}</strong><time>{new Date(stage.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</time></div>
                {stage.detail && <p>{stage.detail}</p>}
                {stage.durationSec > 0 && <span className={`callStageDuration ${stage.hold ? 'hold' : ''}`}>{stage.hold ? 'On hold ' : ''}{formatDuration(stage.durationSec)}</span>}
              </div>
            </li>
          ))}
        </ol>
        <div className="createModalFooter">
          {call.answeredBy && <button type="button" className="textAction createImportLink" onClick={() => { onClose(); onOpenSessions?.(); }}>View the session</button>}
          <button type="button" className="modalCreate" onClick={onClose}>Done</button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function SimulateCallDialog({ telephony, agents, onClose, onSimulate }) {
  const [numberId, setNumberId] = useState(telephony.numbers[0]?.id || '');
  const [caller, setCaller] = useState(`+1 415 555 01${String(randomBetween(10, 99))}`);
  const [whenMode, setWhenMode] = useState('now');
  const [whenValue, setWhenValue] = useState(() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); });
  const [busy, setBusy] = useState('quiet');
  const [wantsPerson, setWantsPerson] = useState(false);
  const when = whenMode === 'now' ? new Date() : new Date(whenValue);
  const preview = numberId ? matchingRules(telephony, numberId, caller, when) : [];
  const callerError = !/^\+?[\d\s-]{6,20}$/.test(caller.trim()) ? 'Enter a phone number, such as +1 415 555 0100.' : '';
  const [submitted, setSubmitted] = useState(false);
  return (
    <TelephonyDialog
      eyebrow="SIMULATE A CALL"
      title="Simulate an inbound call"
      subtitle="Runs a call through your dispatch rules, hold limits and agents. No real call is placed."
      onClose={onClose}
      onSubmit={() => { setSubmitted(true); if (callerError || !numberId) return; onSimulate({ numberId, caller: caller.trim(), when: Number.isNaN(when.getTime()) ? new Date() : when, busy, wantsPerson }); }}
      footer={<><button type="button" className="modalCancel" onClick={onClose}>Cancel</button><button type="submit" className="modalCreate" disabled={!numberId}>Simulate call</button></>}
    >
      <div className="telephonyFieldRow">
        <DialogField label="Number called"><select value={numberId} onChange={(event) => setNumberId(event.target.value)}>{telephony.numbers.map((item) => <option key={item.id} value={item.id}>{item.number}{item.label ? ` (${item.label})` : ''}</option>)}</select></DialogField>
        <DialogField label="Caller’s number" error={submitted && callerError}><input value={caller} onChange={(event) => setCaller(event.target.value)} /></DialogField>
      </div>
      <div className="telephonyFieldRow">
        <DialogField label="When">
          <select value={whenMode} onChange={(event) => setWhenMode(event.target.value)}><option value="now">Right now</option><option value="custom">Pick a date and time</option></select>
        </DialogField>
        <DialogField label="How busy is the agent?" hint={`Typical wait: ${BUSY_LEVELS[busy].wait[0]}–${BUSY_LEVELS[busy].wait[1]} seconds.`}>
          <select value={busy} onChange={(event) => setBusy(event.target.value)}>{Object.entries(BUSY_LEVELS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select>
        </DialogField>
      </div>
      {whenMode === 'custom' && <DialogField label="Date and time"><input type="datetime-local" value={whenValue} onChange={(event) => setWhenValue(event.target.value)} /></DialogField>}
      <label className="settingsToggle"><input type="checkbox" checked={wantsPerson} onChange={(event) => setWantsPerson(event.target.checked)} /><span><strong>The caller asks for a person</strong><small>Tests the agent’s voice handoff.</small></span></label>
      <p className="telephonyDialogNote">{preview.length ? `This call would match “${preview[0].name}” and go to ${agents.find((agent) => agent.id === preview[0].agentId)?.name || 'a deleted agent'} (hold limit ${ruleSettings(preview[0]).maxHold} sec).` : 'No dispatch rule matches this number, caller and time, so the call won’t be answered.'}</p>
    </TelephonyDialog>
  );
}

function TelephonyCallsPage({ telephony, onNavigateSection, agents = [], onChange, onRecordSession, onOpenSessions }) {
  const [range, setRange] = useState('Past 24 hours');
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [openCall, setOpenCall] = useState(null);
  const calls = callsInRange(telephony.calls || [], range);
  const held = calls.filter((call) => call.ruleId);
  const avgHold = held.length ? held.reduce((sum, call) => sum + call.holdSec, 0) / held.length : 0;
  const longest = held.reduce((max, call) => (call.holdSec > (max?.holdSec ?? -1) ? call : max), null);
  const overLimit = held.filter((call) => call.overLimit).length;
  const connected = calls.filter((call) => call.connectedSec > 0);
  const totalConnected = connected.reduce((sum, call) => sum + call.connectedSec, 0);
  const withIssues = calls.filter((call) => call.issues?.length).length;
  const runSimulation = async (options) => {
    await loadConfigs(agents.map((item) => item.id)); // handoff is checked against each agent's saved configuration
    const call = simulateCall({ telephony, agents, ...options });
    let sessionId = '';
    if (call.answeredBy && call.conversationStart) {
      sessionId = makeRecordId('SES');
      const agent = agents.find((item) => item.id === call.answeredBy.id);
      onRecordSession?.({ id: sessionId, agentId: call.answeredBy.id, agentName: call.answeredBy.name, versionKey: call.answeredBy.version, versionLabel: `Version ${call.answeredBy.version}`, room: call.id, startedAt: call.conversationStart, endedAt: new Date(new Date(call.conversationStart).getTime() + call.conversationSec * 1000).toISOString(), durationSec: call.conversationSec, channel: 'Phone (simulated)', participants: 2, status: 'Completed', userMessages: 0, transcript: [], callId: call.id, holdSec: call.holdSec, agentStatus: agent ? agentLifecycle(agent).label : '' });
    }
    const record = { ...call, sessionId };
    onChange((current) => ({ ...current, calls: [record, ...(current.calls || [])].slice(0, 500) }), call.issues.length ? { kind: 'telephony', icon: '☎', title: `Simulated call: ${call.status.toLowerCase()}`, detail: call.issues[0] } : null);
    setSimulateOpen(false);
    setOpenCall(record);
  };
  const rows = calls.map((call) => ({
    id: call.id,
    cells: [
      `#${call.id.slice(-6).toUpperCase()}`,
      <span key="from" className="nowrap">{call.from}</span>,
      <span key="to" className="nowrap">{call.to}</span>,
      call.ruleName || '—',
      call.answeredBy?.name || (call.status === 'Handed to a person' ? 'A person' : '—'),
      <span key="started" className="nowrap">{compactDateTime(call.startedAt)}</span>,
      <span key="hold" className={`holdCell ${call.overLimit ? 'isOver' : ''}`} title={call.maxHold != null ? `Total time on hold. Waited ${formatDuration(call.agentWaitSec || 0)} for the agent; rule limit ${call.maxHold} sec.` : ''}>{call.ruleId ? formatDuration(call.holdSec) : '—'}{call.overLimit && <small>over limit</small>}</span>,
      <span key="duration" className="nowrap">{formatDuration(call.durationSec)}</span>,
      <span key="status" className="callStatusCell"><span className={`callStatusChip ${CALL_STATUS_TONE[call.status] || 'warn'}`}>{call.status}</span>{call.issues?.length ? <span className="callIssueFlag" title={call.issues.join(' ')}>{call.issues.length} issue{call.issues.length === 1 ? '' : 's'}</span> : null}</span>,
    ],
    searchText: `${call.id} ${call.from} ${call.to} ${call.ruleName} ${call.agentName} ${call.status}`,
  }));
  const ready = telephony.rules.length > 0 && telephony.numbers.length > 0;
  return (
    <>
      <section className="telephonyPageHeader">
        <div><h1>Calls</h1><p>Monitor inbound calling activity, hold times and where calls went.</p></div>
        <div className="telephonyHeaderActions">
          <TelephonyRangeControls range={range} onRangeChange={setRange} />
          <button type="button" className="primaryCta compactCta" disabled={!telephony.numbers.length} title={telephony.numbers.length ? 'Run a call through your dispatch rules' : 'Get a phone number first'} onClick={() => setSimulateOpen(true)}>Simulate a call</button>
        </div>
      </section>
      <section className="telephonyStatsGrid three">
        <TelephonyStat label="TOTAL CALLS" value={String(calls.length)} note={calls.length ? `${connected.length} connected in the ${range.toLowerCase()}` : 'Across the selected time range'} />
        <TelephonyStat label="TOTAL CALL DURATION" value={formatDuration(totalConnected)} note="Combined talk time, not counting hold" />
        <TelephonyStat label="AVERAGE CALL DURATION" value={formatDuration(connected.length ? totalConnected / connected.length : 0)} note="Talk time per connected call" />
      </section>
      <section className="telephonyStatsGrid three">
        <TelephonyStat label="AVERAGE HOLD TIME" value={formatDuration(avgHold)} note={longest ? `Longest ${formatDuration(longest.holdSec)}${overLimit ? `, ${overLimit} over the rule limit` : ''}` : 'Time callers spend waiting'} accent />
        <TelephonyStat label="ACTIVE CALLS" value="0" note="No active calls right now" accent />
        <TelephonyStat label="CALLS WITH ISSUES" value={String(withIssues)} note={withIssues ? 'Open a call to see what happened' : 'No call issues detected'} accent />
      </section>
      <TelephonyTablePanel
        title="Calls"
        emptyIcon="☎"
        emptyTitle="No calls yet"
        emptyText={ready
          ? 'Your routing is set up. Simulate a call to see how it’s handled, stage by stage.'
          : 'Calls appear here once a dispatch rule routes callers from a number or trunk to one of your agents.'}
        emptyAction={ready ? { label: 'Simulate a call', onClick: () => setSimulateOpen(true) } : { label: 'Set up routing', onClick: () => onNavigateSection?.(telephony.numbers.length || telephony.trunks.length ? 'dispatch' : 'numbers') }}
        columns={['CALL ID', 'FROM', 'TO', 'RULE', 'ANSWERED BY', 'STARTED', 'HOLD TIME', 'DURATION', 'STATUS']}
        defaultHidden={['TO']}
        rows={rows}
        onRowClick={(id) => setOpenCall((telephony.calls || []).find((call) => call.id === id))}
      />
      {simulateOpen && <SimulateCallDialog telephony={telephony} agents={agents} onClose={() => setSimulateOpen(false)} onSimulate={runSimulation} />}
      {openCall && <CallDetailDialog call={openCall} onClose={() => setOpenCall(null)} onOpenSessions={onOpenSessions} />}
    </>
  );
}

function TelephonyDispatchPage({ telephony, onChange, agents, onNavigateSection, onNavigate }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const callStats = (ruleId) => {
    const list = (telephony.calls || []).filter((call) => call.ruleId === ruleId);
    return { count: list.length, avgHold: list.length ? list.reduce((sum, call) => sum + call.holdSec, 0) / list.length : 0, over: list.filter((call) => call.overLimit).length };
  };
  const agentName = (id) => agents.find((agent) => agent.id === id)?.name || 'Deleted agent';
  const agentCell = (id) => {
    const target = agents.find((agent) => agent.id === id);
    if (!target) return <span className="ruleAgentCell"><span>Deleted agent</span><span className="ruleWarn">No agent will answer</span></span>;
    return <span className="ruleAgentCell"><span>{target.name}</span><StatusBadge agent={target} size="xs" /></span>;
  };
  const notLive = telephony.rules.filter((rule) => { const target = agents.find((agent) => agent.id === rule.agentId); return !target || agentLifecycle(target).status !== 'published'; });
  const routingLabel = (rule) => {
    if (rule.routing === 'all') return 'All inbound numbers';
    const number = telephony.numbers.find((item) => item.id === rule.routing);
    if (number) return number.number;
    const trunk = telephony.trunks.find((item) => item.id === rule.routing);
    return trunk ? `Trunk: ${trunk.name}` : 'Unassigned';
  };
  const rows = telephony.rules.map((rule) => {
    const r = ruleSettings(rule);
    const stats = callStats(rule.id);
    const fallback = r.overflow === 'agent' ? agents.find((agent) => agent.id === r.overflowAgentId)?.name : '';
    return {
    id: rule.id,
    cells: [rule.name, routingLabel(rule), <RuleHoursCell key="hours" rule={rule} />, agentCell(rule.agentId), `${r.maxHold} sec`, r.overflow === 'agent' ? `Send to ${fallback || 'a deleted agent'}` : OVERFLOW_OPTIONS[r.overflow].short, String(r.priority), stats.count ? String(stats.count) : '—', stats.count ? <span className={stats.over ? 'holdCell isOver' : 'holdCell'} title={stats.over ? `${stats.over} call${stats.over === 1 ? '' : 's'} waited past the limit` : ''}>{formatDuration(stats.avgHold)}{stats.over ? <small>{stats.over} over limit</small> : null}</span> : '—'],
    searchText: `${rule.id} ${rule.name} ${routingLabel(rule)} ${agentName(rule.agentId)} ${describeRuleHours(rule)} ${OVERFLOW_OPTIONS[r.overflow].short}`,
  };
  });
  return (
    <>
      <section className="telephonyPageHeader">
        <div><h1>Dispatch rules</h1><p>Control how inbound calls are routed to agents.</p></div>
        <button className="primaryCta compactCta" type="button" onClick={() => setDialogOpen(true)}>＋ Create dispatch rule</button>
      </section>
      <section className="telephonyStatsGrid two">
        <TelephonyStat label="TOTAL DISPATCH RULES" value={String(telephony.rules.length)} note={telephony.rules.length ? `${telephony.rules.length} routing rule${telephony.rules.length === 1 ? '' : 's'} configured` : 'No routing rules configured'} />
        <TelephonyStat label="SIP URI" value="Not connected" note="This preview creates no SIP endpoint" />
      </section>
      {notLive.length > 0 && (
        <div className="telephonyCallout">
          <span>{notLive.length === 1 ? '1 rule sends' : `${notLive.length} rules send`} callers to an agent that isn’t Live. Callers may reach an agent that’s still being built or has been archived.</span>
        </div>
      )}
      <TelephonyTablePanel
        title="Dispatch rules"
        emptyIcon="⇢"
        emptyTitle="No dispatch rules yet"
        emptyText="Create a rule to decide which agent answers inbound calls."
        emptyAction={{ label: 'Create dispatch rule', onClick: () => setDialogOpen(true) }}
        columns={['RULE NAME', 'INBOUND ROUTING', 'WHEN', 'AGENT', 'MAX HOLD', 'IF NO ANSWER', 'PRIORITY', 'CALLS', 'AVG HOLD']}
        defaultHidden={['PRIORITY']}
        monoFirst={false}
        rows={rows}
        onEdit={(id) => setEditing(telephony.rules.find((rule) => rule.id === id))}
        itemLabel="dispatch rule"
        onDelete={(id) => { const rule = telephony.rules.find((item) => item.id === id); onChange((current) => ({ ...current, rules: current.rules.filter((item) => item.id !== id) }), { kind: 'telephony', icon: '⇢', title: `Dispatch rule “${rule?.name || id}” deleted`, detail: 'Calls it routed are no longer handled.' }); }}
      />
      {editing && (
        <DispatchRuleDialog
          telephony={telephony}
          agents={agents}
          initial={editing}
          onClose={() => setEditing(null)}
          onGoTo={(target) => { setEditing(null); if (target === 'agents') onNavigate?.('agents'); else onNavigateSection?.(target); }}
          onCreate={(rule) => { onChange((current) => ({ ...current, rules: current.rules.map((item) => (item.id === rule.id ? rule : item)) }), { kind: 'telephony', icon: '⇢', title: `Dispatch rule “${rule.name}” updated`, detail: `${describeRuleHours(rule)}, hold limit ${ruleSettings(rule).maxHold} sec.` }); setEditing(null); }}
        />
      )}
      {dialogOpen && (
        <DispatchRuleDialog
          telephony={telephony}
          agents={agents}
          onClose={() => setDialogOpen(false)}
          onGoTo={(target) => { setDialogOpen(false); if (target === 'agents') onNavigate?.('agents'); else onNavigateSection?.(target); }}
          onCreate={(rule) => { onChange((current) => ({ ...current, rules: [...current.rules, rule] }), { kind: 'telephony', icon: '⇢', title: `Dispatch rule “${rule.name}” created`, detail: `Sends callers from ${describeRuleRouting(telephony, rule)} to ${agentName(rule.agentId)}.` }); setDialogOpen(false); }}
        />
      )}
    </>
  );
}

function TelephonyNumbersPage({ telephony, onChange, agents, onNavigateSection }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const ruleFor = (numberId) => telephony.rules.find((rule) => rule.routing === numberId) || telephony.rules.find((rule) => rule.routing === 'all');
  const rows = telephony.numbers.map((item) => {
    const rule = ruleFor(item.id);
    const agent = rule ? agents.find((entry) => entry.id === rule.agentId) : null;
    return {
      id: item.id,
      cells: [item.number, item.label || '—', TELEPHONY_COUNTRIES.find((country) => country.code === item.country)?.name || item.country, rule ? `${rule.name}${agent ? ` (${agent.name})` : ''}` : 'Not routed', formatShortDate(item.createdAt)],
    };
  });
  const releaseNumber = (id) => onChange((current) => ({
    ...current,
    numbers: current.numbers.filter((item) => item.id !== id),
    // Rules that pointed at this number no longer have a source; keep them but mark them unassigned.
    rules: current.rules.map((rule) => (rule.routing === id ? { ...rule, routing: '', updatedAt: new Date().toISOString() } : rule)),
  }), { kind: 'telephony', icon: '#', title: `Phone number ${telephony.numbers.find((item) => item.id === id)?.number || ''} released`, detail: 'Any rule that used it is now unassigned.' });
  return (
    <>
      <section className="telephonyPageHeader">
        <div><h1>Phone numbers</h1><p>Give your agents a phone number people can call.</p></div>
        <button className="primaryCta compactCta" type="button" onClick={() => setDialogOpen(true)}>＋ Get a number</button>
      </section>
      {telephony.numbers.length === 0 ? (
        <section className="telephonyEmptyHero">
          <div className="telephonyHeroIcon">#</div>
          <h2>No phone numbers yet</h2>
          <p>Get a number to start receiving inbound calls. You can add more numbers later as your workspace grows.</p>
          <button className="primaryCta compactCta" type="button" onClick={() => setDialogOpen(true)}>＋ Get a phone number</button>
        </section>
      ) : (
        <>
          {telephony.rules.length === 0 && (
            <div className="telephonyCallout">
              <span>These numbers aren’t routed to an agent yet. Add a dispatch rule so calls reach one of your agents.</span>
              <button type="button" className="secondaryCta" onClick={() => onNavigateSection?.('dispatch')}>Create dispatch rule</button>
            </div>
          )}
          <TelephonyTablePanel
            title="Phone numbers"
            columns={['NUMBER', 'LABEL', 'COUNTRY', 'DISPATCH RULE', 'ADDED']}
            rows={rows}
            itemLabel="phone number"
            deleteLabel="Release"
            onDelete={releaseNumber}
          />
        </>
      )}
      {dialogOpen && (
        <PhoneNumberDialog
          existing={telephony.numbers.map((item) => item.number)}
          onClose={() => setDialogOpen(false)}
          onCreate={(number) => { onChange((current) => ({ ...current, numbers: [...current.numbers, number] }), { kind: 'telephony', icon: '#', title: `Phone number ${number.number} added`, detail: number.label ? `Labelled “${number.label}”.` : 'Add a dispatch rule to route its calls.' }); setDialogOpen(false); }}
        />
      )}
    </>
  );
}

function TelephonyTrunksPage({ telephony, onChange }) {
  const [dialog, setDialog] = useState(null);
  const inbound = telephony.trunks.filter((trunk) => trunk.direction === 'inbound');
  const outbound = telephony.trunks.filter((trunk) => trunk.direction === 'outbound');
  const deleteTrunk = (id) => onChange((current) => ({
    ...current,
    trunks: current.trunks.filter((trunk) => trunk.id !== id),
    rules: current.rules.map((rule) => (rule.routing === id ? { ...rule, routing: '', updatedAt: new Date().toISOString() } : rule)),
  }), { kind: 'telephony', icon: '⇄', title: `SIP trunk “${telephony.trunks.find((item) => item.id === id)?.name || id}” deleted`, detail: 'Any rule that used it is now unassigned.' });
  return (
    <>
      <section className="telephonyPageHeader">
        <div><h1>SIP trunks</h1><p>Manage the SIP connections that carry calls into and out of Weave.</p></div>
        <button className="primaryCta compactCta" type="button" onClick={() => setDialog('inbound')}>＋ Create SIP trunk</button>
      </section>
      <section className="telephonyStatsGrid three">
        <TelephonyStat label="TOTAL INBOUND TRUNKS" value={String(inbound.length)} note={inbound.length ? 'Bringing calls into Weave' : 'No inbound trunks connected'} />
        <TelephonyStat label="TOTAL OUTBOUND TRUNKS" value={String(outbound.length)} note={outbound.length ? 'Placing calls through your carrier' : 'No outbound trunks connected'} />
        <TelephonyStat label="SIP URI" value="Not connected" note="This preview creates no SIP endpoint" />
      </section>
      <div className="telephonySectionTitle"><span>↙</span><h2>Inbound</h2></div>
      <TelephonyTablePanel
        title="Inbound trunks"
        emptyIcon="↙"
        emptyTitle="No inbound trunks"
        emptyText="Inbound trunks bring calls from your carrier into Weave."
        emptyAction={{ label: 'Create inbound trunk', onClick: () => setDialog('inbound') }}
        columns={['TRUNK ID', 'TRUNK NAME', 'NUMBERS', 'CREATED']}
        rows={inbound.map((trunk) => ({ id: trunk.id, cells: [trunk.id, trunk.name, trunk.numbers.join(', ') || 'Any number', formatShortDate(trunk.createdAt)] }))}
        itemLabel="trunk"
        onDelete={deleteTrunk}
        compact
      />
      <div className="telephonySectionTitle"><span>↗</span><h2>Outbound</h2></div>
      <TelephonyTablePanel
        title="Outbound trunks"
        emptyIcon="↗"
        emptyTitle="No outbound trunks"
        emptyText="Outbound trunks let agents place calls through your carrier."
        emptyAction={{ label: 'Create outbound trunk', onClick: () => setDialog('outbound') }}
        columns={['TRUNK ID', 'TRUNK NAME', 'NUMBERS', 'SIP URI', 'CREATED']}
        rows={outbound.map((trunk) => ({ id: trunk.id, cells: [trunk.id, trunk.name, trunk.numbers.join(', ') || '—', trunk.address, formatShortDate(trunk.createdAt)] }))}
        itemLabel="trunk"
        onDelete={deleteTrunk}
        compact
      />
      {dialog && (
        <SipTrunkDialog
          initialDirection={dialog}
          existingNames={telephony.trunks.map((trunk) => trunk.name.toLowerCase())}
          onClose={() => setDialog(null)}
          onCreate={(trunk) => { onChange((current) => ({ ...current, trunks: [...current.trunks, trunk] }), { kind: 'telephony', icon: '⇄', title: `${trunk.direction === 'outbound' ? 'Outbound' : 'Inbound'} SIP trunk “${trunk.name}” created`, detail: trunk.numbers.length ? `Carries ${trunk.numbers.length} number${trunk.numbers.length === 1 ? '' : 's'}.` : 'Accepts calls to any number.' }); setDialog(null); }}
        />
      )}
    </>
  );
}

function TelephonyStat({ label, value, note, accent, mono }) {
  return (
    <div className="telephonyStatCard">
      <div className="telephonyStatLabel">{label}<HelpTip text={helpText(label)} /></div>
      <strong className={`${accent ? 'accentValue' : ''} ${mono ? 'monoValue' : ''}`}>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

// Table with working search (⌕), column visibility (⌘), row deletion and an empty state.
function TelephonyTablePanel({ title, columns, rows = [], compact = false, emptyIcon = '◫', emptyTitle = 'Nothing here yet', emptyText = '', emptyAction = null, onDelete, onEdit, onRowClick, itemLabel = 'item', deleteLabel = 'Delete', defaultHidden = [], monoFirst = true }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Columns listed in defaultHidden start hidden; they stay one click away in the columns menu.
  const [hidden, setHidden] = useState(() => defaultHidden.map((name) => columns.indexOf(name)).filter((index) => index >= 0));
  const toolsRef = useRef(null);

  useEffect(() => {
    if (!columnsOpen) return undefined;
    const onDown = (event) => { if (!toolsRef.current?.contains(event.target)) setColumnsOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setColumnsOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [columnsOpen]);

  const visibleIndexes = columns.map((_, index) => index).filter((index) => !hidden.includes(index));
  const needle = query.trim().toLowerCase();
  const filtered = needle ? rows.filter((row) => (row.searchText ?? row.cells.join(' ')).toLowerCase().includes(needle)) : rows;
  const hasActions = !!(onDelete || onEdit);
  const colSpan = visibleIndexes.length + (hasActions ? 1 : 0);

  const toggleColumn = (index) => setHidden((current) => {
    if (current.includes(index)) return current.filter((value) => value !== index);
    if (columns.length - current.length <= 1) return current; // always keep one column visible
    return [...current, index];
  });

  return (
    <section className={`telephonyTablePanel ${compact ? 'compactTablePanel' : ''}`}>
      <div className="telephonyTableHeader">
        <div className="telephonyTableTitle">
          <h2>{title}</h2>
          <span className="tableCount">{needle ? `${filtered.length} of ${rows.length}` : `${rows.length} ${rows.length === 1 ? 'item' : 'items'}`}</span>
        </div>
        <div className="tableTools" ref={toolsRef}>
          {searchOpen && (
            <input
              className="tableSearchInput"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); setSearchOpen(false); } }}
              placeholder={`Search ${title.toLowerCase()}`}
              aria-label={`Search ${title.toLowerCase()}`}
            />
          )}
          <button type="button" className={`quietButton iconOnly ${searchOpen ? 'isActive' : ''}`} aria-label={searchOpen ? 'Close search' : `Search ${title.toLowerCase()}`} aria-pressed={searchOpen} title="Search" onClick={() => { setSearchOpen((value) => !value); if (searchOpen) setQuery(''); setColumnsOpen(false); }}>⌕</button>
          <button type="button" className={`quietButton iconOnly ${columnsOpen ? 'isActive' : ''}`} aria-label="Choose columns" aria-expanded={columnsOpen} title="Columns" onClick={() => setColumnsOpen((value) => !value)}>⌘</button>
          {columnsOpen && (
            <div className="tableColumnsMenu" role="dialog" aria-label="Visible columns">
              <div className="tableColumnsTitle">Visible columns</div>
              {columns.map((column, index) => (
                <label key={column}>
                  <input type="checkbox" checked={!hidden.includes(index)} disabled={!hidden.includes(index) && columns.length - hidden.length <= 1} onChange={() => toggleColumn(index)} />
                  <span>{column.charAt(0) + column.slice(1).toLowerCase()}</span>
                </label>
              ))}
              {hidden.length > 0 && <button type="button" className="tableColumnsReset" onClick={() => setHidden([])}>Show all columns</button>}
            </div>
          )}
        </div>
      </div>
      <div className="telephonyTableWrap">
        <table className="telephonyTable">
          <thead><tr>{visibleIndexes.map((index) => <th key={columns[index]}>{columns[index]}</th>)}{hasActions && <th className="actionsCol"><span className="srOnly">Actions</span></th>}</tr></thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className={onRowClick ? 'isClickable' : ''} tabIndex={onRowClick ? 0 : undefined} onClick={onRowClick ? () => onRowClick(row.id) : undefined} onKeyDown={onRowClick ? (event) => { if (event.key === 'Enter') onRowClick(row.id); } : undefined}>
                {visibleIndexes.map((index) => <td key={columns[index]} className={index === 0 && monoFirst ? 'monoCell' : index === 0 ? 'primaryCell' : ''}>{row.cells[index]}</td>)}
                {hasActions && (
                  <td className="actionsCol" onClick={(event) => event.stopPropagation()}>
                    {onEdit && <button type="button" className="tableRowEdit" onClick={() => onEdit(row.id)}>Edit</button>}
                    {onDelete && <button type="button" className="tableRowDelete" onClick={() => { if (window.confirm(`${deleteLabel} this ${itemLabel}? This can’t be undone.`)) onDelete(row.id); }}>{deleteLabel}</button>}
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={colSpan}>
                <div className="telephonyNoResults">
                  <span className="telephonyNoResultsIcon" aria-hidden="true">{needle ? '⌕' : emptyIcon}</span>
                  <strong>{needle ? `No matches for “${query.trim()}”` : emptyTitle}</strong>
                  {needle ? <span>Try a different search, or clear it to see everything.</span> : emptyText && <span>{emptyText}</span>}
                  {!needle && emptyAction && <button type="button" className="secondaryCta compactSecondary" onClick={emptyAction.onClick}>{emptyAction.label}</button>}
                  {needle && <button type="button" className="secondaryCta compactSecondary" onClick={() => setQuery('')}>Clear search</button>}
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Shared shell for the telephony create dialogs (Escape closes, click outside closes).
function TelephonyDialog({ eyebrow, title, subtitle, onClose, children, footer, onSubmit }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="createOverlay telephonyDialogOverlay" role="dialog" aria-modal="true" aria-labelledby="telephony-dialog-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="createModal telephonyDialog" noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <div className="createModalHeader">
          <div><span className="createEyebrow">{eyebrow}</span><h2 id="telephony-dialog-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <button type="button" className="modalClose" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p className="telephonyPreview inDialog" role="note"><b>Preview</b><span>Saved in this browser only. Nothing real is created or routed.</span></p>
        <div className="telephonyDialogBody">{children}</div>
        <div className="createModalFooter">{footer}</div>
      </form>
    </div>,
    document.body
  );
}

function DialogField({ label, hint, error, children }) {
  return (
    <label className={`telephonyField ${error ? 'hasError' : ''}`}>
      <span className="telephonyFieldLabel">{label}</span>
      {children}
      {error ? <em className="telephonyFieldError">{error}</em> : hint && <small className="telephonyFieldHint">{hint}</small>}
    </label>
  );
}

function DispatchRuleDialog({ telephony, agents, onClose, onCreate, onGoTo, initial = null }) {
  const start = ruleSettings(initial || {});
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState(initial?.type || 'individual');
  const [routing, setRouting] = useState(initial ? initial.routing || 'all' : (telephony.numbers[0]?.id || telephony.trunks.find((trunk) => trunk.direction === 'inbound')?.id || 'all'));
  const [agentId, setAgentId] = useState(initial?.agentId || agents[0]?.id || '');
  const [roomPrefix, setRoomPrefix] = useState(initial?.roomPrefix || 'call-');
  const [hours, setHours] = useState(start.hours);
  const [days, setDays] = useState(start.days);
  const [openTime, setOpenTime] = useState(start.openTime);
  const [closeTime, setCloseTime] = useState(start.closeTime);
  const [callerPrefix, setCallerPrefix] = useState(start.callerPrefix);
  const [priority, setPriority] = useState(String(start.priority));
  const [maxHold, setMaxHold] = useState(String(start.maxHold));
  const [holdMessage, setHoldMessage] = useState(start.holdMessage);
  const [overflow, setOverflow] = useState(start.overflow);
  const [overflowAgentId, setOverflowAgentId] = useState(start.overflowAgentId || agents.find((agent) => agent.id !== (initial?.agentId || agents[0]?.id))?.id || '');
  const [submitted, setSubmitted] = useState(false);
  const inboundTrunks = telephony.trunks.filter((trunk) => trunk.direction === 'inbound');
  const duplicate = telephony.rules.some((rule) => rule.id !== initial?.id && rule.name.trim().toLowerCase() === name.trim().toLowerCase());
  const holdNumber = Number(maxHold);
  const priorityNumber = Number(priority);
  const errors = {
    name: !name.trim() ? 'Give the rule a name.' : duplicate ? 'A rule with this name already exists.' : '',
    agent: !agentId ? 'Choose the agent that answers these calls.' : '',
    prefix: roomPrefix && !/^[a-z0-9-_]+$/i.test(roomPrefix) ? 'Use letters, numbers, hyphens or underscores.' : '',
    days: hours !== 'any' && !days.length ? 'Pick at least one day.' : '',
    times: hours !== 'any' && openTime >= closeTime ? 'The closing time must be after the opening time.' : '',
    callerPrefix: callerPrefix && !/^\+?\d{1,6}$/.test(callerPrefix.replace(/\s/g, '')) ? 'Use up to 6 digits, optionally starting with +, e.g. +91.' : '',
    priority: !Number.isInteger(priorityNumber) || priorityNumber < 1 || priorityNumber > 10 ? 'Use a whole number from 1 to 10.' : '',
    maxHold: !Number.isFinite(holdNumber) || holdNumber < 5 || holdNumber > 600 ? 'Use 5 to 600 seconds.' : '',
    overflowAgent: overflow === 'agent' && (!overflowAgentId || overflowAgentId === agentId) ? 'Choose a different agent to send calls to.' : '',
  };
  const valid = Object.values(errors).every((value) => !value);
  const submit = () => {
    setSubmitted(true);
    if (!valid) return;
    const now = new Date().toISOString();
    onCreate({
      ...(initial || {}),
      id: initial?.id || makeTelephonyId('SDR'), name: name.trim(), type, routing, agentId, roomPrefix: roomPrefix || 'call-',
      hours, days: [...days].sort(), openTime, closeTime, callerPrefix: callerPrefix.replace(/\s/g, ''), priority: priorityNumber,
      maxHold: Math.round(holdNumber), holdMessage: holdMessage.trim(), overflow, overflowAgentId: overflow === 'agent' ? overflowAgentId : '',
      createdAt: initial?.createdAt || now, updatedAt: now,
    });
  };
  const toggleDay = (day) => setDays((value) => (value.includes(day) ? value.filter((d) => d !== day) : [...value, day]));
  return (
    <TelephonyDialog
      eyebrow="DISPATCH RULE"
      title={initial ? `Edit “${initial.name}”` : 'Create a dispatch rule'}
      subtitle="Choose which calls this rule handles, who answers, and what happens while callers wait."
      onClose={onClose}
      onSubmit={submit}
      footer={<><button type="button" className="modalCancel" onClick={onClose}>Cancel</button><button type="submit" className="modalCreate">{initial ? 'Save changes' : 'Create rule'}</button></>}
    >
      <fieldset className="ruleSection">
        <legend>Calls and agent</legend>
        <DialogField label="Rule name" error={submitted && errors.name}>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Main support line" maxLength={60} />
        </DialogField>
        <div className="telephonyFieldRow">
          <DialogField label="Inbound routing" hint={telephony.numbers.length || inboundTrunks.length ? 'Calls arriving here use this rule.' : 'No numbers yet, so this applies to all inbound calls.'}>
            <select value={routing} onChange={(event) => setRouting(event.target.value)}>
              <option value="all">All inbound numbers</option>
              {telephony.numbers.length > 0 && <optgroup label="Phone numbers">{telephony.numbers.map((item) => <option key={item.id} value={item.id}>{item.number}{item.label ? ` (${item.label})` : ''}</option>)}</optgroup>}
              {inboundTrunks.length > 0 && <optgroup label="Inbound trunks">{inboundTrunks.map((trunk) => <option key={trunk.id} value={trunk.id}>{trunk.name}</option>)}</optgroup>}
            </select>
          </DialogField>
          <DialogField label="Agent" error={submitted && errors.agent} hint={agents.length ? '' : 'This workspace has no agents yet.'}>
            <select value={agentId} onChange={(event) => setAgentId(event.target.value)} disabled={!agents.length}>
              {!agents.length && <option value="">No agents available</option>}
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} ({agentLifecycle(agent).label})</option>)}
            </select>
          </DialogField>
        </div>
        {!telephony.numbers.length && <button type="button" className="inlineLink" onClick={() => onGoTo('numbers')}>Get a phone number first</button>}
        {!agents.length && <button type="button" className="inlineLink" onClick={() => onGoTo('agents')}>Create an agent</button>}
      </fieldset>

      <fieldset className="ruleSection">
        <legend>When it applies</legend>
        <div className="segmentedChoice three" role="radiogroup" aria-label="When the rule applies">
          {Object.entries(RULE_HOURS).map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={hours === key} className={hours === key ? 'active' : ''} onClick={() => setHours(key)}><strong>{label}</strong></button>
          ))}
        </div>
        {hours !== 'any' && (
          <>
            <div className="dayPicker" role="group" aria-label="Business days">
              {WEEKDAYS.map((label, day) => <button key={label} type="button" aria-pressed={days.includes(day)} className={days.includes(day) ? 'active' : ''} onClick={() => toggleDay(day)}>{label}</button>)}
            </div>
            {submitted && errors.days && <em className="telephonyFieldError">{errors.days}</em>}
            <div className="telephonyFieldRow">
              <DialogField label="Opens"><input type="time" value={openTime} onChange={(event) => setOpenTime(event.target.value)} /></DialogField>
              <DialogField label="Closes" error={submitted && errors.times}><input type="time" value={closeTime} onChange={(event) => setCloseTime(event.target.value)} /></DialogField>
            </div>
            <p className="ruleHint">{hours === 'business' ? 'Calls outside these hours fall through to other rules.' : 'This rule only handles calls outside these hours, e.g. an after-hours agent.'}</p>
          </>
        )}
        <div className="telephonyFieldRow">
          <DialogField label={<>Caller prefix <em className="fieldNeed optional">Optional</em></>} error={submitted && errors.callerPrefix} hint="Only callers whose number starts with this, e.g. +91.">
            <input value={callerPrefix} onChange={(event) => setCallerPrefix(event.target.value)} placeholder="Any caller" maxLength={8} />
          </DialogField>
          <DialogField label="Priority" error={submitted && errors.priority} hint="1 is checked first when several rules match.">
            <input type="number" min={1} max={10} value={priority} onChange={(event) => setPriority(event.target.value)} />
          </DialogField>
        </div>
      </fieldset>

      <fieldset className="ruleSection">
        <legend>While callers wait</legend>
        <div className="telephonyFieldRow">
          <DialogField label="Maximum hold time (seconds)" error={submitted && errors.maxHold} hint="How long a caller waits for the agent before the fallback below.">
            <input type="number" min={5} max={600} value={maxHold} onChange={(event) => setMaxHold(event.target.value)} />
          </DialogField>
          <DialogField label="If no one answers in time">
            <select value={overflow} onChange={(event) => setOverflow(event.target.value)}>{Object.entries(OVERFLOW_OPTIONS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select>
          </DialogField>
        </div>
        {overflow === 'agent' && (
          <DialogField label="Send to" error={submitted && errors.overflowAgent}>
            <select value={overflowAgentId} onChange={(event) => setOverflowAgentId(event.target.value)}>
              <option value="">Choose an agent</option>
              {agents.filter((agent) => agent.id !== agentId).map((agent) => <option key={agent.id} value={agent.id}>{agent.name} ({agentLifecycle(agent).label})</option>)}
            </select>
          </DialogField>
        )}
        {overflow === 'wait' && <p className="ruleHint">Callers keep waiting past the limit; many hang up after about two minutes.</p>}
        <DialogField label="Hold message (optional)" hint="Played to callers while they wait.">
          <input value={holdMessage} onChange={(event) => setHoldMessage(event.target.value)} placeholder="e.g. Thanks for waiting, we’ll be with you shortly." maxLength={160} />
        </DialogField>
      </fieldset>

      <details className="ruleSection ruleAdvanced">
        <summary>Advanced</summary>
        <div className="telephonyFieldRow">
          <DialogField label="Rule type" hint={RULE_TYPES[type].note}>
            <select value={type} onChange={(event) => setType(event.target.value)}>
              {Object.entries(RULE_TYPES).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
            </select>
          </DialogField>
          <DialogField label="Room name prefix" error={submitted && errors.prefix} hint="Rooms are named like call-1234.">
            <input value={roomPrefix} onChange={(event) => setRoomPrefix(event.target.value.trim())} placeholder="call-" maxLength={24} />
          </DialogField>
        </div>
      </details>
    </TelephonyDialog>
  );
}

function PhoneNumberDialog({ existing, onClose, onCreate }) {
  const [countryCode, setCountryCode] = useState('US');
  const [areaCode, setAreaCode] = useState('');
  const [label, setLabel] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const country = TELEPHONY_COUNTRIES.find((item) => item.code === countryCode) || TELEPHONY_COUNTRIES[0];
  const areaError = areaCode && country.area && !country.area.test(areaCode) ? country.areaRule : '';
  const submit = () => {
    setSubmitted(true);
    if (areaError) return;
    onCreate({ id: makeTelephonyId('PN'), number: generateTestNumber(country, areaCode, existing), country: country.code, label: label.trim(), createdAt: new Date().toISOString() });
  };
  return (
    <TelephonyDialog
      eyebrow="PHONE NUMBER"
      title="Get a phone number"
      subtitle="Pick a country and, optionally, an area code."
      onClose={onClose}
      onSubmit={submit}
      footer={<><button type="button" className="modalCancel" onClick={onClose}>Cancel</button><button type="submit" className="modalCreate">Get number</button></>}
    >
      <div className="telephonyFieldRow">
        <DialogField label="Country">
          <select autoFocus value={countryCode} onChange={(event) => { setCountryCode(event.target.value); setAreaCode(''); }}>
            {TELEPHONY_COUNTRIES.map((item) => <option key={item.code} value={item.code}>{item.name} ({item.dial})</option>)}
          </select>
        </DialogField>
        <DialogField label="Area code (optional)" error={submitted && areaError} hint={country.example ? `e.g. ${country.example}` : 'Not used for this country'}>
          <input inputMode="numeric" value={areaCode} onChange={(event) => setAreaCode(event.target.value.trim())} placeholder={country.example || '—'} disabled={!country.example} maxLength={4} />
        </DialogField>
      </div>
      <DialogField label="Label (optional)" hint="Helps your team recognise what the number is for.">
        <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Support hotline" maxLength={40} />
      </DialogField>
      <p className="telephonyDialogNote">This prototype assigns a test number from a range reserved for fictional use. It is saved with this workspace but can’t receive real calls.</p>
    </TelephonyDialog>
  );
}

function SipTrunkDialog({ initialDirection = 'inbound', existingNames, onClose, onCreate }) {
  const [direction, setDirection] = useState(initialDirection);
  const [name, setName] = useState('');
  const [numbers, setNumbers] = useState('');
  const [address, setAddress] = useState('');
  const [username, setUsername] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const numberList = numbers.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
  const badNumber = numberList.find((item) => !/^\+?[\d\s-]{6,20}$/.test(item));
  const errors = {
    name: !name.trim() ? 'Give the trunk a name.' : existingNames.includes(name.trim().toLowerCase()) ? 'A trunk with this name already exists.' : '',
    numbers: badNumber ? `“${badNumber}” isn’t a valid phone number.` : direction === 'outbound' && !numberList.length ? 'Add at least one number to call from.' : '',
    address: direction === 'outbound' && !address.trim() ? 'Enter your carrier’s SIP address.' : address.trim() && !/^(sips?:)?[\w.-]+(:\d+)?$/i.test(address.trim()) ? 'Use a host name such as sip.carrier.com.' : '',
  };
  const valid = !errors.name && !errors.numbers && !errors.address;
  const submit = () => {
    setSubmitted(true);
    if (!valid) return;
    onCreate({ id: makeTelephonyId('ST'), direction, name: name.trim(), numbers: numberList, address: address.trim(), username: username.trim(), createdAt: new Date().toISOString() });
  };
  return (
    <TelephonyDialog
      eyebrow="SIP TRUNK"
      title="Create a SIP trunk"
      subtitle="Connect your carrier so calls can flow into or out of Weave."
      onClose={onClose}
      onSubmit={submit}
      footer={<><button type="button" className="modalCancel" onClick={onClose}>Cancel</button><button type="submit" className="modalCreate">Create trunk</button></>}
    >
      <div className="segmentedChoice" role="radiogroup" aria-label="Direction">
        {[['inbound', 'Inbound', 'Receive calls from your carrier'], ['outbound', 'Outbound', 'Place calls through your carrier']].map(([value, title, note]) => (
          <button key={value} type="button" role="radio" aria-checked={direction === value} className={direction === value ? 'active' : ''} onClick={() => setDirection(value)}>
            <strong>{title}</strong><small>{note}</small>
          </button>
        ))}
      </div>
      <DialogField label="Trunk name" error={submitted && errors.name}>
        <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Twilio production" maxLength={60} />
      </DialogField>
      <DialogField label={direction === 'outbound' ? 'Numbers to call from' : 'Numbers (optional)'} error={submitted && errors.numbers} hint={direction === 'outbound' ? 'Separate numbers with commas.' : 'Leave empty to accept calls to any number on this trunk.'}>
        <input value={numbers} onChange={(event) => setNumbers(event.target.value)} placeholder="+1 415 555 0100, +1 415 555 0101" />
      </DialogField>
      <div className="telephonyFieldRow">
        <DialogField label={direction === 'outbound' ? 'Carrier SIP address' : 'Carrier SIP address (optional)'} error={submitted && errors.address}>
          <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="sip.carrier.com" />
        </DialogField>
        <DialogField label="Auth username (optional)">
          <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="e.g. weave-trunk" autoComplete="off" />
        </DialogField>
      </div>
    </TelephonyDialog>
  );
}

function describeRuleRouting(telephony, rule) {
  if (!rule.routing) return 'no number';
  if (rule.routing === 'all') return 'all inbound numbers';
  const number = (telephony?.numbers || []).find((item) => item.id === rule.routing);
  if (number) return number.number;
  const trunk = (telephony?.trunks || []).find((item) => item.id === rule.routing);
  return trunk ? `the ${trunk.name} trunk` : 'no number';
}
