import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangleIcon } from 'lucide-react';
import { useReading } from '../../hooks/useMonitoringReading';
import { useAlertsNow } from '../../hooks/useAlerts';
import { localDay, periodOf } from '../../models/callData';
import { loadCalls } from '../../utils/callDataLoad';
import { cn } from '../../utils/styles';
import { Sparkline } from './parts';

const DAYS = 7;

/** An agent's calls per day over the last week (read-only; read again after a minute). */
function useAgentActivity(agentId: string) {
  const reading = useReading(`activity|${agentId}`, async (signal) => {
    const nowMs = Date.now();
    const period = periodOf(nowMs, DAYS);
    const { calls, errors } = await loadCalls([agentId], { sinceMs: period.startMs, maxPages: 3, signal });
    if (errors.length) throw new Error(errors[0].message);
    const counts = new Map(period.days.map((day) => [day, 0]));
    calls.forEach((c) => {
      const day = localDay(Date.parse(c.started_at));
      if (counts.has(day)) counts.set(day, (counts.get(day) ?? 0) + 1);
    });
    return [...counts.entries()].map(([day, n]) => ({ day, calls: n }));
  });
  return reading;
}

/**
 * On a row of the agents list: the agent's calls per day over the last week as a small chart, and how many alerts
 * hold for it (not snoozed), which opens its alerts.
 */
export function AgentRowActivity({ agentId, className }: { agentId: string; className?: string }) {
  const activity = useAgentActivity(agentId);
  const alerts = useAlertsNow([agentId]).filter((a) => a.status !== 'snoozed');
  const critical = alerts.some((a) => a.severity === 'critical');
  const series = activity.data;
  const total = useMemo(() => (series ? series.reduce((n, d) => n + d.calls, 0) : 0), [series]);
  return (
    <span className={cn('inline-flex items-center gap-2', className)} data-testid="agent-activity" onClick={(e) => e.stopPropagation()}>
      {series ? (
        <span className="inline-flex items-center gap-1.5" title={`${total} call${total === 1 ? '' : 's'} in the last ${DAYS} days`}>
          <Sparkline series={series} className="h-5" />
          <span className="text-xs tabular-nums text-muted">{total}</span>
        </span>
      ) : activity.error ? (
        <span className="text-xs text-muted" title={activity.error}>
          Calls unavailable
        </span>
      ) : (
        <span aria-hidden className="block h-5 w-16 animate-pulse rounded bg-subtle" />
      )}
      {alerts.length > 0 && (
        <Link
          to={`/agents/${encodeURIComponent(agentId)}/monitor/alerts`}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
            critical ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'
          )}
          title={alerts.map((a) => a.title).join('; ')}
        >
          <AlertTriangleIcon className="h-3 w-3" aria-hidden />
          {alerts.length} alert{alerts.length === 1 ? '' : 's'}
        </Link>
      )}
    </span>
  );
}
