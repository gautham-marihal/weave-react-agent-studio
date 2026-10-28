import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { PartPanel, PartRow, Parts } from '../../ui/Parts.tsx';
import ChoiceMenu from '../../ui/ChoiceMenu.tsx';
import { DemoNote } from '../../demo/DemoBadge.jsx';
import { formatWhen } from '../format.js';
import { routeHref } from '../route.js';
import { Notice } from '../ui.jsx';
import { alertAsText, effectiveRules, withStatus } from './alertsModel.js';
import { acknowledge, clearHistory, reopen, resetRules, setNotify, setRule, snooze, useInsights, useLiveAlerts } from './insightsStore.js';
import { CHECK_EVERY_MS, checkAlertsNow } from './useAlertWatcher.js';
import { EmptyState } from '../agent/PageShell.jsx';
import './insights.css';
import Button from '../../ui/Button.tsx';
import { Input } from '../../ui/Input.tsx';

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

// One alert: what is wrong, where and since when; the one thing to do; the calls behind it; "I'm on it", snooze, copy.
export function AlertCard({ alert, onOpenAgent, onOpenCall, userName = '' }) {
  const [showCalls, setShowCalls] = useState(false);
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
          {` · ${alert.why}`}
        </small>
        <div className="inActions">
          <Button type="button" variant="primary" size="compact" onClick={act}>
            {ACTION_LABEL[alert.action.kind](alert)}
          </Button>
          {alert.callIds.length > 0 && (
            <Button type="button" aria-expanded={showCalls} onClick={() => setShowCalls((v) => !v)}>
              {showCalls ? 'Hide the calls' : `The ${alert.callIds.length === 1 ? 'call' : `${alert.callIds.length} calls`}`}
            </Button>
          )}
          {/* the housekeeping, quieter and to the right: who is on it, snoozing, sharing */}
          <span className="inMinor">
            {alert.status === 'new' ? (
              <Button type="button" onClick={() => acknowledge(alert.key, userName)} title="Tell others you are looking into it">
                I’m on it
              </Button>
            ) : (
              <Button type="button" onClick={() => reopen(alert.key)}>
                Mark as new
              </Button>
            )}
            <ChoiceMenu
              label="Snooze"
              menuLabel="Snooze until"
              choices={[
                ['For an hour', () => snooze(alert.key, inHours(1))],
                ['For 4 hours', () => snooze(alert.key, inHours(4))],
                ['Until tomorrow, 9:00', () => snooze(alert.key, tomorrowMorning())],
              ]}
            />
            <Button type="button" onClick={copy} title="Copy it to paste into a chat or an email">
              <Icon name={copied ? 'check' : 'copy'} size={15} /> {copied ? 'Copied' : 'Copy'}
            </Button>
          </span>
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

// A rule's number box keeps what is typed. A whole number within limits is taken at once; anything else is clamped
// when the box is left or Enter is pressed (clamping each key would turn 30, least 10, into 10 at the "3").
function RuleNumber({ rule, name, field }) {
  const value = rule.params[name];
  const [typed, setTyped] = useState(String(value));
  useEffect(() => setTyped(String(value)), [value]);
  const take = () => {
    const v = Number(typed);
    if (typed.trim() !== '' && Number.isFinite(v)) setRule(rule.id, { params: { [name]: v } });
    setTyped(String(value));
  };
  return (
    <Input
      type="number"
      size="small"
      min={field.min}
      max={field.max}
      value={typed}
      disabled={!rule.enabled}
      aria-label={`${rule.label}: ${field.unit}`}
      onChange={(event) => {
        const text = event.target.value;
        setTyped(text);
        // a number not yet in range (3 on its way to 30) waits for Enter or blur, so it never changes mid-typing
        const v = Number(text);
        if (text.trim() !== '' && Number.isInteger(v) && v >= field.min && v <= field.max) setRule(rule.id, { params: { [name]: v } });
      }}
      onBlur={take}
      onKeyDown={(event) => {
        if (event.key === 'Enter') take();
      }}
    />
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
              <RuleNumber rule={rule} name={key} field={field} /> {field.unit === '%' ? '%' : field.unit}
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
          <Button type="button" onClick={test}>
            Send a test notification
          </Button>{' '}
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
  // only this workspace's agents: another workspace's alerts and their history stay with it
  const names = Object.fromEntries(bots.map((b) => [b.id, b.name || b.id]));
  const alerts = withStatus(
    live.alerts.filter((a) => a.bot in names),
    insights.acks,
    Date.now(),
  );
  const fresh = alerts.filter((a) => a.status === 'new');
  const handled = alerts.filter((a) => a.status !== 'new');
  const history = insights.history.filter((h) => h.clearedAt && h.bot in names);
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
          <Button type="button" onClick={() => checkAlertsNow()} disabled={live.checking || !bots.length}>
            Check now
          </Button>
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

      <Parts value={tab} onChange={setTab}>
        <PartRow
          className="inTabs"
          label="Alerts"
          value={tab}
          items={[
            { id: 'now', label: `Right now${alerts.length ? ` (${alerts.length})` : ''}` },
            { id: 'history', label: 'Earlier' },
            { id: 'rules', label: 'What to watch for' },
            { id: 'send', label: 'Where to send' },
          ]}
        />
        <PartPanel value={tab}>
          {tab === 'now' && (
            <section className="inList" aria-label="Alerts right now">
              {bots.length === 0 && (
                <EmptyState
                  icon="bell"
                  title="No agents to watch yet"
                  text="Once you have an agent, Weave reads its calls and tells you here when something breaks: a tool failing, calls cut off, nobody calling, slow answers."
                />
              )}
              {bots.length > 0 && !live.checkedAt && !live.checking && (
                <EmptyState
                  icon="bell"
                  title="Not checked yet"
                  text="Weave checks your agents’ recent calls every few minutes while the studio is open."
                  action={
                    <Button type="button" variant="secondary" onClick={() => checkAlertsNow()}>
                      Check now
                    </Button>
                  }
                />
              )}
              {!live.checkedAt && live.checking && <p className="stMuted">Reading the recent calls of your agents…</p>}
              {live.checkedAt && alerts.length === 0 && (
                <div className="inAllClear">
                  <span aria-hidden="true">
                    <Icon name="check" size={22} />
                  </span>
                  <div>
                    <strong>All clear</strong>
                    <p>
                      Nothing needs a look right now. Weave checks every {Math.round(CHECK_EVERY_MS / 60000)} minutes while the studio is open, and when you
                      come back to it.
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
                    <Button type="button" onClick={clearHistory}>
                      Clear this list
                    </Button>
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
                  <Button type="button" onClick={resetRules}>
                    Back to the recommended settings
                  </Button>
                </p>
              )}
            </section>
          )}

          {tab === 'send' && (
            <section className="inList" aria-label="Where to send alerts">
              <Notifications />
            </section>
          )}
        </PartPanel>
      </Parts>
    </div>
  );
}
