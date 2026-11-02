import React, { useMemo } from 'react';
import { useInsightBots } from '../../hooks/useInsightBots';
import { useMonitoring } from '../../hooks/useMonitoring';
import { useLiveCallCount } from '../../hooks/useLiveCallCount';
import { useAlertsNow, useLiveAlerts } from '../../hooks/useAlerts';
import { analyse } from '../../models/monitor';
import { seconds } from '../../models/speed';
import { StatTile } from './parts';

const DAYS = 7;

/**
 * Home's four workspace numbers: calls today, calls going on now, alerts, and answer time. Each is worked out as its own
 * page does it (Calls, Live, Alerts, Speed) and opens that page. Read-only.
 */
export function WorkspacePulse() {
  const bots = useInsightBots();
  // a couple of hundred calls' records in all, shared evenly, so a big workspace reads fewer per agent
  const watched = useMonitoring({ bots, days: DAYS, cap: 200 });
  const report = useMemo(
    () => analyse({ calls: watched.calls, samples: watched.samples, bots, nowMs: watched.nowMs, days: DAYS }),
    [watched.calls, watched.samples, bots, watched.nowMs]
  );
  const midnight = new Date(watched.nowMs);
  midnight.setHours(0, 0, 0, 0);
  const today = watched.calls.filter((c) => Date.parse(c.started_at) >= midnight.getTime()).length;
  const reading = watched.loading && !watched.calls.length;

  const live = useLiveCallCount(bots);

  const holding = useAlertsNow(bots.map((b) => b.id)).filter((a) => a.status !== 'snoozed');
  const { checkedAt } = useLiveAlerts();
  const fresh = holding.filter((a) => a.status === 'new').length;
  const critical = holding.filter((a) => a.severity === 'critical').length;

  // answer time uses Monitoring's and Speed's calls: records of some, spread over the days, are read after the list
  const timing = watched.sampling && report.totals.waitP50 === null;
  const { waitP50, waitP90 } = report.totals;
  if (!bots.length) return null;

  return (
    <section aria-label="The workspace now" className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="workspace-pulse">
      <StatTile
        label="Calls today"
        loading={reading}
        value={today}
        sub={`${report.totals.calls} in the last ${DAYS} days`}
        series={report.series}
        to="/calls"
      />
      <StatTile
        label="Going on now"
        loading={live.count === null}
        value={live.count ?? 0}
        sub={live.count ? `Call${live.count === 1 ? '' : 's'} in progress` : 'No calls right now'}
        to="/live"
      />
      <StatTile
        label="Alerts"
        loading={!checkedAt && !holding.length}
        value={holding.length}
        sub={holding.length ? `${fresh} new${critical ? ` · ${critical} critical` : ''}` : 'Nothing needs a look'}
        tone={critical ? 'danger' : holding.length ? 'warning' : undefined}
        to="/analytics/alerts"
      />
      <StatTile
        label={`Answer time · last ${DAYS} days`}
        loading={reading || timing}
        value={seconds(waitP50)}
        sub={waitP50 !== null ? `Half the answers; 1 in 10 over ${seconds(waitP90)}` : report.totals.calls ? 'No answers timed yet' : 'No calls yet'}
        title="How long callers waited for an answer, from the calls' records"
        to="/analytics/speed"
      />
    </section>
  );
}
