import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangleIcon } from 'lucide-react';
import { alertAction } from '../../models/alerts';
import { useAlertsNow } from '../../hooks/useAlerts';
import { cn } from '../../utils/styles';

// What is wrong right now, as a strip above a page: for one agent (on its own pages) with the one thing to do, or for
// every agent (Monitoring) leading to the Alerts page. Snoozed alerts are left out. Nothing shows when all is well.

export function AgentAlerts({ botId = '' }: { botId?: string }) {
  const mine = useAlertsNow(botId ? [botId] : undefined).filter((a) => a.status !== 'snoozed');
  if (!mine.length) return null;
  const [first, ...rest] = mine;
  const action = alertAction(first);
  const critical = mine.some((a) => a.severity === 'critical');
  return (
    <div
      role="status"
      data-testid="agent-alerts"
      className={cn(
        'flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 text-sm',
        critical ? 'border-danger/30 bg-danger-soft' : 'border-warning/30 bg-warning-soft'
      )}
    >
      <AlertTriangleIcon className={cn('mt-0.5 h-4 w-4 shrink-0', critical ? 'text-danger' : 'text-warning')} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">
          {botId ? '' : `${first.botName}: `}
          {first.title}
          {first.status === 'seen' && <span className="font-normal text-muted"> · someone is on it{first.seenBy ? `: ${first.seenBy}` : ''}</span>}
        </p>
        <p className="mt-0.5 text-ink-soft">
          {first.detail}
          {rest.length > 0 && ` And ${rest.length} more alert${rest.length === 1 ? '' : 's'}${botId ? ' on this agent' : ''}.`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {botId && (
          <Link to={action.to} className="text-sm font-medium text-accent hover:underline">
            {action.label}
          </Link>
        )}
        <Link to={botId ? `/agents/${encodeURIComponent(botId)}/monitor/alerts` : '/analytics/alerts'} className="text-sm font-medium text-accent hover:underline">
          {botId ? 'Its alerts' : 'See the alerts'}
        </Link>
      </div>
    </div>
  );
}
