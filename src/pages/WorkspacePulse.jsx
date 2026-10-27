import React, { useMemo } from 'react';
import Stat from '../studio/agent/Stat.jsx';
import { analyse } from '../studio/monitoring/monitorModel.js';
import { useMonitoring } from '../studio/monitoring/useMonitoring.ts';
import { useLiveCount } from '../studio/live/useLiveCount.ts';
import { withStatus } from '../studio/insights/alertsModel.js';
import { useInsights, useLiveAlerts } from '../studio/insights/insightsStore.js';
import { seconds } from '../studio/speed/speedModel.ts';

const DAYS = 7;

// Home's four workspace numbers: calls today, calls now, alerts, and answer speed. Each is worked out as its own page
// does it (Monitoring, Live, Alerts, Speed) and opens that page. Read-only.
//   onOpen(pageId): 'sessions' | 'live' | 'alerts' | 'speed'
export default function WorkspacePulse({ bots, onOpen }) {
  const agents = useMemo(() => bots.map((b) => ({ id: b.id, name: b.name || b.id, deployed: b.deployed || {} })), [bots]);

  const watched = useMonitoring({ bots: agents, days: DAYS });
  const report = useMemo(
    () => analyse({ calls: watched.calls, samples: watched.samples, bots: agents, nowMs: watched.nowMs, days: DAYS }),
    [watched.calls, watched.samples, agents, watched.nowMs],
  );
  const midnight = new Date(watched.nowMs);
  midnight.setHours(0, 0, 0, 0);
  const today = watched.calls.filter((c) => Date.parse(c.started_at) >= midnight.getTime()).length;
  const reading = watched.loading && !watched.calls.length;

  const live = useLiveCount(agents);

  const { acks } = useInsights();
  const { alerts, checkedAt } = useLiveAlerts();
  const holding = withStatus(alerts, acks, Date.now()).filter((a) => a.status !== 'snoozed');
  const fresh = holding.filter((a) => a.status === 'new').length;
  const critical = holding.filter((a) => a.severity === 'critical').length;

  // answer time uses Monitoring's and Speed's calls: records of some, spread over the days, are read after the list
  const timing = !watched.loading && watched.calls.length > 0 && Object.keys(watched.samples).length === 0;
  const { waitP50, waitP90 } = report.totals;

  return (
    <section className="ovStats wsPulse" aria-label="The workspace now">
      <Stat
        label="Calls today"
        loading={reading}
        value={today}
        sub={`${report.totals.calls} in the last ${DAYS} days`}
        series={report.series}
        onOpen={() => onOpen('sessions')}
      />
      <Stat
        label="Going on now"
        loading={live.count === null}
        value={live.count}
        sub={live.count ? `Call${live.count === 1 ? '' : 's'} in progress` : 'No calls right now'}
        onOpen={() => onOpen('live')}
      />
      <Stat
        label="Alerts"
        loading={!checkedAt && !alerts.length}
        value={holding.length}
        sub={holding.length ? `${fresh} new${critical ? ` · ${critical} critical` : ''}` : 'Nothing needs a look'}
        onOpen={() => onOpen('alerts')}
      />
      <Stat
        label={`Answer time · last ${DAYS} days`}
        loading={reading || timing}
        value={seconds(waitP50)}
        sub={waitP50 !== null ? `Half the answers; 1 in 10 over ${seconds(waitP90)}` : report.totals.calls ? 'No answers timed yet' : 'No calls yet'}
        title="How long callers waited for an answer, from the calls' records"
        onOpen={() => onOpen('speed')}
      />
    </section>
  );
}
