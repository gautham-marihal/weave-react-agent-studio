import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangleIcon, BellOffIcon, CheckIcon, ChevronDownIcon, CopyIcon, OctagonAlertIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { StatusChip } from '../ui/StatusChip';
import { alertAction, alertAsText, snoozeUntil, type AlertWithStatus } from '../../models/alerts';
import { acknowledge, reopen, snooze } from '../../hooks/useAlerts';
import { callPath } from '../../utils/routes';
import { timeAgo } from '../../utils/format';
import { cn } from '../../utils/styles';

// One alert: what is wrong, where and since when; the one thing to do; the calls behind it; "I'm on it", snooze, copy.

const SNOOZES: { id: 'hour' | 'four' | 'tomorrow'; label: string }[] = [
  { id: 'hour', label: 'For an hour' },
  { id: 'four', label: 'For 4 hours' },
  { id: 'tomorrow', label: 'Until tomorrow, 9:00' },
];

function statusText(a: AlertWithStatus): string {
  if (a.status === 'seen') return `On it${a.seenBy ? `: ${a.seenBy}` : ''}`;
  if (a.status === 'snoozed' && a.until) return `Snoozed until ${new Date(a.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return 'New';
}

/** "Snooze": a small menu of how long. */
function SnoozeMenu({ alertKey }: { alertKey: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="relative" ref={box}>
      <Button variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Snooze
        <ChevronDownIcon className="h-3.5 w-3.5" aria-hidden />
      </Button>
      {open && (
        <div role="menu" aria-label="Snooze until" className="absolute right-0 top-9 z-20 w-48 rounded-lg border border-line bg-surface p-1 shadow-overlay">
          {SNOOZES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitem"
              onClick={() => {
                snooze(alertKey, snoozeUntil(s.id, Date.now()));
                setOpen(false);
              }}
              className="block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AlertCard({ alert, userName = '' }: { alert: AlertWithStatus; userName?: string }) {
  const [showCalls, setShowCalls] = useState(false);
  const [copied, setCopied] = useState(false);
  const action = alertAction(alert);
  const critical = alert.severity === 'critical';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(alertAsText(alert, `${window.location.origin}${action.to}`));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  const Icon = critical ? OctagonAlertIcon : AlertTriangleIcon;
  return (
    <article
      aria-label={`${alert.botName}: ${alert.title}`}
      data-severity={alert.severity}
      data-status={alert.status}
      className={cn(
        'flex gap-3 rounded-xl border bg-surface p-4 shadow-panel',
        alert.status === 'new' ? (critical ? 'border-danger/40' : 'border-warning/40') : 'border-line opacity-90'
      )}
    >
      <span
        aria-hidden
        className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', critical ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning')}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold text-ink">{alert.title}</h3>
          <span className="text-xs text-muted">{alert.botName}</span>
          <StatusChip tone={alert.status === 'new' ? (critical ? 'danger' : 'warning') : 'neutral'} className="alert-status">
            {statusText(alert)}
          </StatusChip>
        </div>
        <p className="mt-1 text-sm text-ink-soft">{alert.detail}</p>
        <p className="mt-1 text-xs text-muted">
          {critical ? 'Critical' : 'Warning'}
          {alert.since ? ` · started ${timeAgo(alert.since)}` : ''} · {alert.why}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link
            to={action.to}
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[13px] font-medium text-primary-ink shadow-sm hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {action.label}
          </Link>
          {alert.callIds.length > 0 && (
            <Button variant="secondary" size="sm" aria-expanded={showCalls} onClick={() => setShowCalls((v) => !v)}>
              {showCalls ? 'Hide the calls' : `The ${alert.callIds.length === 1 ? 'call' : `${alert.callIds.length} calls`}`}
            </Button>
          )}
          {/* the housekeeping, quieter and to the right: who is on it, snoozing, sharing */}
          <span className="ml-auto flex flex-wrap items-center gap-1">
            {alert.status === 'new' ? (
              <Button variant="ghost" size="sm" onClick={() => acknowledge(alert.key, userName)} title="Tell others you are looking into it">
                <CheckIcon className="h-3.5 w-3.5" aria-hidden />
                I’m on it
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => reopen(alert.key)}>
                <BellOffIcon className="h-3.5 w-3.5" aria-hidden />
                Mark as new
              </Button>
            )}
            <SnoozeMenu alertKey={alert.key} />
            <Button variant="ghost" size="sm" onClick={() => void copy()} title="Copy it to paste into a chat or an email">
              {copied ? <CheckIcon className="h-3.5 w-3.5" aria-hidden /> : <CopyIcon className="h-3.5 w-3.5" aria-hidden />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </span>
        </div>
        {showCalls && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="The calls behind it">
            {alert.callIds.slice(0, 8).map((id) => (
              <li key={id}>
                <Link to={callPath(alert.bot, id)} className="inline-block max-w-[16rem] truncate rounded-md bg-subtle px-2 py-1 font-mono text-[11px] text-ink-soft hover:text-accent">
                  {id}
                </Link>
              </li>
            ))}
            {alert.callIds.length > 8 && <li className="py-1 text-xs text-muted">and {alert.callIds.length - 8} more in Calls</li>}
          </ul>
        )}
      </div>
    </article>
  );
}
