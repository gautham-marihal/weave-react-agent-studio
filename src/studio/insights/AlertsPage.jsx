import React, { useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { DemoNote } from '../../demo/DemoBadge.jsx';
import { formatWhen } from '../format.js';
import { routeHref } from '../route.js';
import { Notice } from '../ui.jsx';
import { alertAsText, effectiveRules, withStatus } from './alertsModel.js';
import { acknowledge, clearHistory, reopen, resetRules, setNotify, setRule, snooze, useInsights, useLiveAlerts } from './insightsStore.js';
import { CHECK_EVERY_MS, checkAlertsNow } from './useAlertWatcher.js';
import './insights.css';

const ACTION_LABEL = {
  tool: (a) => `Open “${a.action.tool}”`,
  rollback: (a) => `Roll back to v${a.action.version}…`,
  channels: () => 'Check its channels',
  calls: () => 'Open its calls',
};
const STATUS_TEXT = {
  new: () => 'New',
  seen: (a) => `On it${a.seenBy ? `: ${a.seenBy}` : ''}`,
  snoozed: (a) => `Snoozed until ${new Date(a.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
};

const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
function tomorrowMorning() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

// One alert: what is wrong, on which agent, since when; the one thing to do about it; the calls it rests on; and "I'm on it", snooze, copy.
export function AlertCard({ alert, onOpenAgent, onOpenCall, userName = '', compact = false }) {
  const [showCalls, setShowCalls] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const act = () => {
    const { action } = alert;
    if (action.kind === 'tool') onOpenAgent(alert.bot, 'tools', { tool: action.tool });
    else if (action.kind === 'rollback') onOpenAgent(alert.bot, 'deploy', { version: action.version });
    else if (action.kind === 'channels') onOpenAgent(alert.bot, 'channels');
    else onOpenAgent(alert.bot, 'calls');
  };
  const copy = async () => {
    const link = `${window.location.origin}${window.location.pathname}${routeHref(alert.bot, 'calls')}`;
    try {
      await navigator.clipboard.writeText(alertAsText(alert, link));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <article className={`inAlert ${alert.severity} ${alert.status}`} aria-label={`${alert.botName}: ${alert.title}`}>
      <span className="inSev" aria-hidden="true">
        <Icon name="alert" size={18} />
      </span>
      <div className="inAlertBody">
        <header>
          <h3>{alert.title}</h3>
          <span className="inAgent">{alert.botName}</span>
          <span className={`inStatus ${alert.status}`}>{STATUS_TEXT[alert.status](alert)}</span>
        </header>
        <p>{alert.detail}</p>
        <small className="inMeta">
          {alert.severity === 'critical' ? 'Critical' : 'Warning'}
          {alert.since ? ` · started ${formatWhen(alert.since)}` : ''}
          {!compact && ` · ${alert.why}`}
        </small>
        <div className="inActions">
          <button type="button" className="primaryCta compactCta" onClick={act}>
            {ACTION_LABEL[alert.action.kind](alert)}
          </button>
          {alert.callIds.length > 0 && (
            <button type="button" className="quietButton" aria-expanded={showCalls} onClick={() => setShowCalls((v) => !v)}>
              {showCalls ? 'Hide the calls' : `The ${alert.callIds.length === 1 ? 'call' : `${alert.callIds.length} calls`}`}
            </button>
          )}
          {alert.status === 'new' ? (
            <button type="button" className="quietButton" onClick={() => acknowledge(alert.key, userName)} title="Tell others you are looking into it">
              I’m on it
            </button>
          ) : (
            <button type="button" className="quietButton" onClick={() => reopen(alert.key)}>
              Mark as new
            </button>
          )}
          <div className="inSnooze">
            <button type="button" className="quietButton" aria-expanded={snoozeOpen} onClick={() => setSnoozeOpen((v) => !v)}>
              Snooze
            </button>
            {snoozeOpen && (
              <div className="inSnoozeMenu" role="menu" aria-label="Snooze until">
                {[
                  ['For an hour', () => inHours(1)],
                  ['For 4 hours', () => inHours(4)],
                  ['Until tomorrow, 9:00', tomorrowMorning],
                ].map(([label, until]) => (
                  <button
                    key={label}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      snooze(alert.key, until());
                      setSnoozeOpen(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {!compact && (
            <button type="button" className="quietButton" onClick={copy} title="Copy it to paste into a chat or an email">
              <Icon name={copied ? 'check' : 'copy'} size={15} /> {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
        {showCalls && (
          <ul className="inCalls">
            {alert.callIds.slice(0, 8).map((id) => (
              <li key={id}>
                <button type="button" className="linkButton" onClick={() => onOpenCall(alert.bot, id)}>
                  {id.replace(/^session-[^-]+(?:-[^-_]+)*?-/, '').slice(0, 40)}
                </button>
              </li>
            ))}
            {alert.callIds.length > 8 && <li className="stMuted">and {alert.callIds.length - 8} more in its Calls</li>}
          </ul>
        )}
      </div>
    </article>
  );
}

// A rule as its sentence, with the numbers in it as small boxes.
function RuleRow({ rule }) {
  const parts = rule.sentence.split(/(\{\w+\})/);
  return (
    <li className={`inRule ${rule.enabled ? '' : 'off'}`}>
      <label className="inRuleSwitch">
        <input type="checkbox" checked={rule.enabled} onChange={(event) => setRule(rule.id, { enabled: event.target.checked })} />
        <strong>{rule.label}</strong>
      </label>
      <p className="inRuleSentence">
        {parts.map((part, i) => {
          const m = part.match(/^\{(\w+)\}$/);
          if (!m) return <span key={i}>{part}</span>;
          const key = m[1];
          const field = rule.fields[key];
          return (
            <span key={i} className="inNum">
              <input
                type="number"
                className="stFInput small"
                min={field.min}
                max={field.max}
                value={rule.params[key]}
                disabled={!rule.enabled}
                aria-label={`${rule.label}: ${field.unit}`}
                onChange={(event) => {
                  const v = Number(event.target.value);
                  if (event.target.value !== '' && Number.isFinite(v)) setRule(rule.id, { params: { [key]: v } });
                }}
              />{' '}
              {field.unit === '%' ? '%' : field.unit}
            </span>
          );
        })}
      </p>
      <small className="stMuted">{rule.why}</small>
    </li>
  );
}

function Notifications() {
  const { notify } = useInsights();
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const [permission, setPermission] = useState(supported ? window.Notification.permission : 'unsupported');
  const [tested, setTested] = useState('');
  const turnOn = async (on) => {
    if (!on) {
      setNotify({ browser: false });
      return;
    }
    let p = permission;
    if (supported && p === 'default') p = await window.Notification.requestPermission();
    setPermission(p);
    setNotify({ browser: p === 'granted' });
  };
  const test = () => {
    try {
      new window.Notification('Weave: a test alert', { body: 'Alerts will look like this while the studio is open in a tab.' });
      setTested('Sent. If nothing appeared, check the notification settings of your browser and system.');
    } catch {
      setTested('Your browser would not show it.');
    }
  };
  return (
    <div className="inNotify">
      <label className="inRuleSwitch">
        <input
          type="checkbox"
          checked={!!notify.browser && permission === 'granted'}
          disabled={!supported || permission === 'denied'}
          onChange={(e) => turnOn(e.target.checked)}
        />
        <strong>Browser notifications</strong>
      </label>
      <p className="stMuted">
        {!supported
          ? 'This browser can’t show notifications.'
          : permission === 'denied'
            ? 'Notifications are blocked for this site. Allow them in the browser’s site settings, then turn this on.'
            : 'A notification for each new alert while the studio is open in a tab, even when you are on another one.'}
      </p>
      {notify.browser && permission === 'granted' && (
        <p>
          <button type="button" className="quietButton" onClick={test}>
            Send a test notification
          </button>{' '}
          {tested && <span className="stMuted">{tested}</span>}
        </p>
      )}
      <p className="inServerNote">
        <Icon name="info" size={15} />
        <span>
          <strong>Email, Slack and Teams</strong> need the Weave server to send them while nobody has the studio open, and it can’t do that yet. Until it can,
          use browser notifications, or “Copy” on an alert to share it.
        </span>
      </p>
    </div>
  );
}

// The Alerts page: what needs a look now, what happened before, what to watch for, and where alerts go.
export default function AlertsPage({ bots = [], onOpenAgent, onOpenCall, userName = '' }) {
  const insights = useInsights();
  const live = useLiveAlerts();
  const [tab, setTab] = useState('now');
  const rules = useMemo(() => effectiveRules(insights.rules), [insights.rules]);
  const alerts = withStatus(live.alerts, insights.acks, Date.now());
  const fresh = alerts.filter((a) => a.status === 'new');
  const handled = alerts.filter((a) => a.status !== 'new');
  const history = insights.history.filter((h) => h.clearedAt);
  const names = Object.fromEntries(bots.map((b) => [b.id, b.name || b.id]));
  const changedRules = Object.keys(insights.rules || {}).length > 0;

  return (
    <div className="inPage">
      <section className="welcomeBlock">
        <div>
          <h1>Alerts</h1>
          <p>Weave watches your agents’ calls and tells you when something breaks: a tool failing, calls cut off, nobody calling, slow answers.</p>
        </div>
        <div className="inCheck">
          <small className="stMuted" role="status">
            {live.checking
              ? 'Checking the calls…'
              : live.checkedAt
                ? `Checked ${formatWhen(live.checkedAt)} · ${live.watching} agent${live.watching === 1 ? '' : 's'}`
                : 'Not checked yet'}
          </small>
          <button type="button" className="quietButton" onClick={() => checkAlertsNow()} disabled={live.checking || !bots.length}>
            Check now
          </button>
        </div>
      </section>
      <DemoNote kind="calls">These calls are made-up examples, and so is what goes wrong in them. No real caller is involved.</DemoNote>
      {live.errors.map((e) => (
        <Notice
          key={e.botId || e.message}
          kind="error"
          title={e.botId ? `The calls of ${names[e.botId] || e.botId} couldn’t be read` : 'The check couldn’t run'}
        >
          {e.message}
        </Notice>
      ))}

      <div className="inTabs" role="tablist" aria-label="Alerts">
        {[
          ['now', `Right now${alerts.length ? ` (${alerts.length})` : ''}`],
          ['history', 'Earlier'],
          ['rules', 'What to watch for'],
          ['send', 'Where to send'],
        ].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'now' && (
        <section className="inList" aria-label="Alerts right now">
          {!live.checkedAt && live.checking && <p className="stMuted">Reading the recent calls of your agents…</p>}
          {live.checkedAt && alerts.length === 0 && (
            <div className="inAllClear">
              <span aria-hidden="true">
                <Icon name="check" size={22} />
              </span>
              <div>
                <strong>All clear</strong>
                <p>
                  Nothing needs a look right now. Weave checks every {Math.round(CHECK_EVERY_MS / 60000)} minutes while the studio is open, and when you come
                  back to it.
                </p>
              </div>
            </div>
          )}
          {fresh.map((a) => (
            <AlertCard key={a.key} alert={a} onOpenAgent={onOpenAgent} onOpenCall={onOpenCall} userName={userName} />
          ))}
          {handled.length > 0 && <h2 className="inSubhead">Being looked at, or snoozed</h2>}
          {handled.map((a) => (
            <AlertCard key={a.key} alert={a} onOpenAgent={onOpenAgent} onOpenCall={onOpenCall} userName={userName} />
          ))}
        </section>
      )}

      {tab === 'history' && (
        <section className="inList" aria-label="Earlier alerts">
          {history.length === 0 ? (
            <p className="stMuted">Nothing has gone wrong and cleared up again in the last 30 days.</p>
          ) : (
            <>
              <ul className="inHistory">
                {history.map((h) => (
                  <li key={`${h.key}@${h.firedAt}`}>
                    <span className={`inDot ${h.severity}`} aria-hidden="true" />
                    <div>
                      <strong>{h.title}</strong>
                      <span className="stMuted"> · {h.botName || names[h.bot] || h.bot}</span>
                      <small>
                        {h.detail} Started {formatWhen(h.firedAt)}, cleared {formatWhen(h.clearedAt)}.
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
              <p>
                <button type="button" className="quietButton" onClick={clearHistory}>
                  Clear this list
                </button>
              </p>
            </>
          )}
        </section>
      )}

      {tab === 'rules' && (
        <section className="inList" aria-label="What to watch for">
          <p className="stMuted">
            A spike is only raised over enough calls, and only when it is well above what is usual for that agent, so a quiet hour or an agent that always
            passes calls on does not cry wolf. These are your settings, kept in this browser.
          </p>
          <ul className="inRules">
            {rules.map((r) => (
              <RuleRow key={r.id} rule={r} />
            ))}
          </ul>
          {changedRules && (
            <p>
              <button type="button" className="quietButton" onClick={resetRules}>
                Back to the recommended settings
              </button>
            </p>
          )}
        </section>
      )}

      {tab === 'send' && (
        <section className="inList" aria-label="Where to send alerts">
          <Notifications />
        </section>
      )}
    </div>
  );
}
