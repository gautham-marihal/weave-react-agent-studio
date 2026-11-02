import React, { useEffect, useMemo, useState } from 'react';
import { BellIcon, CheckCircle2Icon, InfoIcon, RefreshCwIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Toggle';
import { useAuth } from '../../contexts/AuthContext';
import { effectiveRules, sentenceParts, type EffectiveRule, type RuleField } from '../../models/alerts';
import { clearHistory, resetRules, setBrowserNotifications, setRule, useAlertsNow, useAlertsState, useLiveAlerts } from '../../hooks/useAlerts';
import { CHECK_EVERY_MS, checkAlertsNow, notificationPermission } from '../../hooks/useAlertWatcher';
import { timeAgo } from '../../utils/format';
import { cn } from '../../utils/styles';
import { AlertCard } from './AlertCard';
import { Notice } from './parts';

// The Alerts page: what needs a look now, what happened before, what to watch for, and where alerts go. With `botId`
// it is that agent's own (inside the agent). The rules, "I'm on it", snoozes and history are kept in this browser.

type Tab = 'now' | 'history' | 'rules' | 'send';

/**
 * A rule's number box keeps what is typed. A whole number within limits is taken at once; anything else is held to the
 * limits when the box is left or Enter is pressed (holding each key would turn 30, least 10, into 10 at the "3").
 */
function RuleNumber({ rule, name, field }: { rule: EffectiveRule; name: string; field: RuleField }) {
  const value = rule.params[name];
  const [typed, setTyped] = useState(String(value));
  useEffect(() => setTyped(String(value)), [value]);
  const take = () => {
    const v = Number(typed);
    if (typed.trim() !== '' && Number.isFinite(v)) setRule(rule.id, { params: { [name]: v } });
    setTyped(String(value));
  };
  return (
    <input
      type="number"
      min={field.min}
      max={field.max}
      value={typed}
      disabled={!rule.enabled}
      aria-label={`${rule.label}: ${field.unit}`}
      onChange={(event) => {
        const text = event.target.value;
        setTyped(text);
        const v = Number(text);
        if (text.trim() !== '' && Number.isInteger(v) && v >= field.min && v <= field.max) setRule(rule.id, { params: { [name]: v } });
      }}
      onBlur={take}
      onKeyDown={(event) => {
        if (event.key === 'Enter') take();
      }}
      className="mx-0.5 h-7 w-16 rounded-md border border-line-strong bg-surface px-1.5 text-center text-[13px] tabular-nums text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
    />
  );
}

/** A rule as its sentence, with the numbers in it as small boxes. */
function RuleRow({ rule }: { rule: EffectiveRule }) {
  return (
    <li className={cn('rounded-lg border border-line p-4', !rule.enabled && 'bg-subtle/50')}>
      <div className="flex items-center gap-3">
        <Toggle checked={rule.enabled} onChange={(on) => setRule(rule.id, { enabled: on })} label={rule.label} />
        <span className="text-sm font-medium text-ink">{rule.label}</span>
      </div>
      <p className={cn('mt-2 text-sm leading-8', rule.enabled ? 'text-ink-soft' : 'text-muted')}>
        {sentenceParts(rule.sentence).map((part, i) =>
          'text' in part ? (
            <span key={i}>{part.text}</span>
          ) : (
            <span key={i} className="whitespace-nowrap">
              <RuleNumber rule={rule} name={part.field} field={rule.fields[part.field]} />
              {rule.fields[part.field].unit === '%' ? '%' : ` ${rule.fields[part.field].unit}`}
            </span>
          )
        )}
      </p>
      <p className="mt-1 text-xs text-muted">{rule.why}</p>
    </li>
  );
}

/** Browser notifications: off until the person turns them on and the browser allows them. */
function SendTo() {
  const { notify } = useAlertsState();
  const [permission, setPermission] = useState(notificationPermission());
  const [tested, setTested] = useState('');
  const supported = permission !== 'unsupported';
  const on = notify.browser && permission === 'granted';
  const turn = async (want: boolean) => {
    if (!want) {
      setBrowserNotifications(false);
      return;
    }
    let p = permission;
    if (supported && p === 'default') p = await window.Notification.requestPermission();
    setPermission(p);
    setBrowserNotifications(p === 'granted');
  };
  const test = () => {
    try {
      new window.Notification('Weave: a test alert', { body: 'Alerts will look like this while Studio is open in a tab.' });
      setTested('Sent. If nothing appeared, check the notification settings of your browser and system.');
    } catch {
      setTested('Your browser would not show it.');
    }
  };
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line p-4">
        <div className="flex items-center gap-3">
          <Toggle checked={on} onChange={(v) => void turn(v)} label="Browser notifications" disabled={!supported || permission === 'denied'} />
          <span className="text-sm font-medium text-ink">Browser notifications</span>
        </div>
        <p className="mt-2 text-sm text-muted">
          {!supported
            ? 'This browser can’t show notifications.'
            : permission === 'denied'
              ? 'Notifications are blocked for this site. Allow them in the browser’s site settings, then turn this on.'
              : 'A notification for each new alert while Studio is open in a tab, even when you are on another one. Off until you turn it on; this browser asks you first.'}
        </p>
        {on && (
          <p className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={test}>
              Send a test notification
            </Button>
            {tested && <span className="text-xs text-muted">{tested}</span>}
          </p>
        )}
      </div>
      <p className="flex items-start gap-2 rounded-lg bg-subtle/60 px-4 py-3 text-sm text-ink-soft" data-testid="server-note">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
        <span>
          <strong className="font-medium text-ink">Email, Slack and Teams</strong> need the Weave server to send them while nobody has Studio open, and it can’t do that yet. Until it can,
          use browser notifications, or “Copy” on an alert to share it.
        </span>
      </p>
    </div>
  );
}

export function AlertsView({ bots, botId = '' }: { bots: { id: string; name: string }[]; botId?: string }) {
  const state = useAlertsState();
  const live = useLiveAlerts();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('now');
  const rules = useMemo(() => effectiveRules(state.rules), [state.rules]);
  // only these agents: other agents' alerts and their history stay as they are
  const ids = botId ? [botId] : bots.map((b) => b.id);
  const names: Record<string, string> = Object.fromEntries(bots.map((b) => [b.id, b.name || b.id]));
  const alerts = useAlertsNow(ids);
  const fresh = alerts.filter((a) => a.status === 'new');
  const handled = alerts.filter((a) => a.status !== 'new');
  const history = state.history.filter((h) => h.clearedAt && ids.includes(h.bot));
  const changedRules = Object.keys(state.rules || {}).length > 0;
  const errors = live.errors.filter((e) => !e.botId || ids.includes(e.botId));
  const tabs: { id: Tab; label: string }[] = [
    { id: 'now', label: `Right now${alerts.length ? ` (${alerts.length})` : ''}` },
    { id: 'history', label: 'Earlier' },
    { id: 'rules', label: 'What to watch for' },
    { id: 'send', label: 'Where to send' },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          Weave watches {botId ? 'this agent’s' : 'your agents’'} calls while Studio is open and tells you when something breaks: a tool failing, calls cut off, nobody calling, slow
          answers.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted" role="status" data-testid="alerts-checked">
            {live.checking
              ? 'Checking the calls…'
              : live.checkedAt
                ? `Checked ${timeAgo(live.checkedAt)} · ${live.watching} agent${live.watching === 1 ? '' : 's'}`
                : 'Not checked yet'}
          </span>
          <Button variant="ghost" size="sm" onClick={() => void checkAlertsNow()} disabled={live.checking || !bots.length}>
            <RefreshCwIcon className={cn('h-3.5 w-3.5', live.checking && 'animate-spin')} aria-hidden />
            Check now
          </Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">Your rules, “I’m on it”, snoozes and the history are kept in this browser, not on the server: other people don’t see them.</p>

      {errors.length > 0 && (
        <div className="mt-4 space-y-2">
          {errors.map((e) => (
            <Notice key={e.botId || e.message} tone="danger" title={e.botId ? `The calls of ${names[e.botId] || e.botId} couldn’t be read` : 'The check couldn’t run'}>
              {e.message}
            </Notice>
          ))}
        </div>
      )}

      <div role="tablist" aria-label="Alerts" className="mt-5 flex flex-wrap gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`alerts-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`alerts-panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              tab === t.id ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`alerts-panel-${tab}`} aria-labelledby={`alerts-tab-${tab}`} className="mt-5">
        {tab === 'now' && (
          <section aria-label="Alerts right now" className="space-y-3">
            {bots.length === 0 && (
              <div className="rounded-xl border border-line bg-surface px-6 py-12 text-center">
                <BellIcon className="mx-auto h-6 w-6 text-muted" aria-hidden />
                <p className="mt-2 text-sm font-medium text-ink">No agents to watch yet</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted">Once you have an agent, Weave reads its calls and tells you here when something breaks.</p>
              </div>
            )}
            {bots.length > 0 && !live.checkedAt && !live.checking && (
              <div className="rounded-xl border border-line bg-surface px-6 py-12 text-center">
                <BellIcon className="mx-auto h-6 w-6 text-muted" aria-hidden />
                <p className="mt-2 text-sm font-medium text-ink">Not checked yet</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted">Weave checks the recent calls every few minutes while Studio is open.</p>
                <Button variant="secondary" className="mt-4" onClick={() => void checkAlertsNow()}>
                  Check now
                </Button>
              </div>
            )}
            {!live.checkedAt && live.checking && <p className="text-sm text-muted">Reading the recent calls…</p>}
            {live.checkedAt && alerts.length === 0 && (
              <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success-soft px-5 py-4">
                <CheckCircle2Icon className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
                <div>
                  <p className="text-sm font-medium text-ink">All clear</p>
                  <p className="mt-0.5 text-sm text-ink-soft">
                    Nothing needs a look right now. Weave checks every {Math.round(CHECK_EVERY_MS / 60000)} minutes while Studio is open, and when you come back to it.
                  </p>
                </div>
              </div>
            )}
            {fresh.map((a) => (
              <AlertCard key={a.key} alert={a} userName={user?.name ?? ''} />
            ))}
            {handled.length > 0 && <h2 className="pt-3 text-xs font-semibold uppercase tracking-wide text-muted">Being looked at, or snoozed</h2>}
            {handled.map((a) => (
              <AlertCard key={a.key} alert={a} userName={user?.name ?? ''} />
            ))}
          </section>
        )}

        {tab === 'history' && (
          <section aria-label="Earlier alerts">
            {history.length === 0 ? (
              <p className="text-sm text-muted">Nothing has gone wrong and cleared up again in the last 30 days.</p>
            ) : (
              <>
                <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                  {history.map((h) => (
                    <li key={`${h.key}@${h.firedAt}`} className="flex gap-3 px-4 py-3">
                      <span aria-hidden className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', h.severity === 'critical' ? 'bg-danger' : 'bg-warning')} />
                      <div className="min-w-0 text-sm">
                        <p>
                          <span className="font-medium text-ink">{h.title}</span>
                          <span className="text-muted"> · {h.botName || names[h.bot] || h.bot}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {h.detail} Started {timeAgo(h.firedAt)}, cleared {h.clearedAt ? timeAgo(h.clearedAt) : ''}.
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
                <Button variant="ghost" size="sm" className="mt-3" onClick={clearHistory}>
                  Clear this list
                </Button>
              </>
            )}
          </section>
        )}

        {tab === 'rules' && (
          <section aria-label="What to watch for">
            <p className="text-sm text-muted">
              A spike is only raised over enough calls, and only when it is well above what is usual for that agent, so a quiet hour or an agent that always passes calls on does not
              cry wolf. These settings apply to every agent and are kept in this browser.
            </p>
            <ul className="mt-4 space-y-3">
              {rules.map((r) => (
                <RuleRow key={r.id} rule={r} />
              ))}
            </ul>
            {changedRules && (
              <Button variant="secondary" size="sm" className="mt-4" onClick={resetRules}>
                Back to the recommended settings
              </Button>
            )}
          </section>
        )}

        {tab === 'send' && (
          <section aria-label="Where to send alerts">
            <SendTo />
          </section>
        )}
      </div>
    </div>
  );
}
