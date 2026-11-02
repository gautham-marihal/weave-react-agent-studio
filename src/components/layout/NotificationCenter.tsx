import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangleIcon, BellIcon, CheckCheckIcon, CheckCircle2Icon, ExternalLinkIcon, InfoIcon, OctagonAlertIcon, ShieldAlertIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useStudio } from '../../contexts/StudioContext';
import { useInsightBots } from '../../hooks/useInsightBots';
import { useAlertsNow, useLiveAlerts } from '../../hooks/useAlerts';
import { useAlertWatcher } from '../../hooks/useAlertWatcher';
import { alertAction } from '../../models/alerts';
import { timeAgo } from '../../utils/format';
import { cn } from '../../utils/styles';
import type { JobNotification } from '../../types/studio';

/**
 * The bell in the top bar: background jobs (deployments, knowledge, tests) and alerts about the agents' calls. It also
 * runs the alert check while Studio is open, so the count is right on every page. The count is unread job updates plus
 * alerts nobody has looked at yet.
 */
export function NotificationCenter() {
  const { notifications, unreadCount, markNotificationRead, markAllNotificationsRead, clearNotifications } = useStudio();
  const bots = useInsightBots();
  const navigate = useNavigate();
  useAlertWatcher({ bots, onOpenAlert: (a) => navigate(alertAction(a).to) });
  const alerts = useAlertsNow(bots.map((b) => b.id)).filter((a) => a.status !== 'snoozed');
  const { checkedAt, checking } = useLiveAlerts();
  const freshAlerts = alerts.filter((a) => a.status === 'new').length;
  const total = unreadCount + freshAlerts;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const getIcon = (type: JobNotification['type'], status: JobNotification['status']) => {
    if (status === 'failed') return <ShieldAlertIcon className="h-4 w-4 text-danger shrink-0 mt-0.5" />;
    if (type === 'deploy') return <CheckCircle2Icon className="h-4 w-4 text-success shrink-0 mt-0.5" />;
    if (type === 'knowledge') return <InfoIcon className="h-4 w-4 text-accent shrink-0 mt-0.5" />;
    if (type === 'test') return <CheckCircle2Icon className="h-4 w-4 text-info shrink-0 mt-0.5" />;
    return <InfoIcon className="h-4 w-4 text-muted shrink-0 mt-0.5" />;
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        title="Notifications and alerts"
        aria-label={`Notifications, ${total} unread${freshAlerts ? `, ${freshAlerts} new alert${freshAlerts === 1 ? '' : 's'}` : ''}`}
        aria-expanded={open}
        data-testid="bell"
      >
        <BellIcon className="h-4 w-4" />
        {total > 0 && (
          <span
            data-testid="bell-count"
            className={cn(
              'absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white shadow-sm animate-in zoom-in-50',
              freshAlerts ? 'bg-danger' : 'bg-accent'
            )}
          >
            {total > 9 ? '9+' : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 sm:w-96 rounded-xl border border-line bg-surface shadow-xl animate-in fade-in-50 slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-ink">Notifications</span>
              {total > 0 && (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                  {total} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {notifications.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={markAllNotificationsRead}
                    className="flex items-center gap-1 text-[11px] font-medium text-muted hover:text-ink"
                    title="Mark all as read"
                  >
                    <CheckCheckIcon className="h-3 w-3" />
                    Read all
                  </button>
                  <button
                    type="button"
                    onClick={clearNotifications}
                    className="p-1 text-muted hover:text-danger rounded"
                    title="Clear all"
                  >
                    <Trash2Icon className="h-3 w-3" />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 text-muted hover:text-ink rounded"
                aria-label="Close notifications"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="max-h-[28rem] overflow-y-auto">
            {/* alerts about the agents' calls, worked out in this browser from the call records */}
            <section aria-label="Alerts" data-testid="bell-alerts" className="border-b border-line">
              <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Alerts</span>
                <Link to="/analytics/alerts" onClick={() => setOpen(false)} className="text-[11px] font-medium text-accent hover:underline">
                  All alerts
                </Link>
              </div>
              {alerts.length === 0 ? (
                <p className="px-4 pb-3 text-xs text-muted">
                  {checking && !checkedAt ? 'Checking the agents’ recent calls…' : checkedAt ? `Nothing needs a look. Checked ${timeAgo(checkedAt)}.` : 'Not checked yet.'}
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {alerts.slice(0, 5).map((a) => {
                    const Icon = a.severity === 'critical' ? OctagonAlertIcon : AlertTriangleIcon;
                    return (
                      <li key={a.key}>
                        <Link
                          to="/analytics/alerts"
                          onClick={() => setOpen(false)}
                          className={cn('flex gap-3 px-4 py-2.5 text-left transition-colors hover:bg-subtle/60', a.status === 'new' && 'bg-danger-soft/40')}
                        >
                          <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', a.severity === 'critical' ? 'text-danger' : 'text-warning')} aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-semibold text-ink">
                              {a.botName}: {a.title}
                            </span>
                            <span className="mt-0.5 block text-xs text-ink-soft line-clamp-2">{a.detail}</span>
                            {a.status === 'seen' && <span className="mt-0.5 block text-[11px] text-muted">Someone is on it{a.seenBy ? `: ${a.seenBy}` : ''}</span>}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                  {alerts.length > 5 && <li className="px-4 py-2 text-[11px] text-muted">and {alerts.length - 5} more</li>}
                </ul>
              )}
            </section>

            <div className="flex items-center px-4 pt-3 pb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Deployments and jobs</span>
            </div>
            <div className="divide-y divide-line">
              {notifications.length === 0 ? (
                <div className="px-4 pb-4 pt-1 text-xs text-muted">
                  No recent notifications or background job updates.
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => markNotificationRead(n.id)}
                    className={cn(
                      'p-3.5 transition-colors cursor-pointer flex gap-3 text-left',
                      n.read ? 'bg-surface hover:bg-subtle/50' : 'bg-accent-soft/30 hover:bg-accent-soft/50'
                    )}
                  >
                    {getIcon(n.type, n.status)}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn('text-xs font-medium', n.read ? 'text-ink-soft' : 'text-ink font-semibold')}>
                          {n.title}
                        </p>
                        <span className="text-[10px] text-muted shrink-0">{timeAgo(n.timestamp)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-soft line-clamp-2">{n.description}</p>
                      {n.link && (
                        <Link
                          to={n.link}
                          onClick={() => setOpen(false)}
                          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
                        >
                          View details
                          <ExternalLinkIcon className="h-2.5 w-2.5" />
                        </Link>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
