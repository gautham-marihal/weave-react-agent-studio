import React, { useMemo } from 'react';
import Stat from '../studio/newlayout/Stat.jsx';
import { analyse } from '../studio/monitoring/monitorModel.js';
import { useMonitoring } from '../studio/monitoring/useMonitoring.js';
import { useLiveCount } from '../studio/live/useLiveCount.js';
import { withStatus } from '../studio/insights/alertsModel.js';
import { useInsights, useLiveAlerts } from '../studio/insights/insightsStore.js';
import { useCostData } from '../studio/cost/useCostData.js';
import { money, summarize } from '../studio/cost/costModel.js';
import { mergePrices, usePrices } from '../studio/cost/prices.js';

const DAYS = 7;
const sumOf = (values) => values.reduce((a, b) => a + b, 0);

// Home's four numbers for the workspace: calls today (with the week by day), calls going on now, the alerts that hold, and what the week's calls cost.
// Each is worked out the way its own page works it out (Monitoring, Live, Alerts, Cost and speed) and opens that page. It only reads.
//   onOpen(pageId): 'sessions' | 'live' | 'alerts' | 'cost'
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

  const own = usePrices();
  const prices = useMemo(() => mergePrices(own), [own]);
  const costs = useCostData(agents, { days: DAYS, perAgent: 10 });
  const estimate = useMemo(
    () => summarize({ samples: costs.samples, totalCalls: sumOf(Object.values(costs.totals)), modelsByBot: costs.modelsByBot, prices, days: DAYS }),
    [costs.samples, costs.totals, costs.modelsByBot, prices],
  );
  const week = estimate.costPerCall !== null ? estimate.costPerCall * estimate.totalCalls : null;

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
        label={`Cost · last ${DAYS} days`}
        loading={costs.loading && !costs.samples.length}
        value={money(week)}
        sub={
          week !== null
            ? `About ${money(estimate.costPerCall)} a call${estimate.missing.length ? ' · some prices missing' : ''}`
            : estimate.totalCalls
              ? 'Add prices to estimate it'
              : 'No calls yet'
        }
        title="An estimate from each agent's newest calls and the prices on the Cost and speed page"
        onOpen={() => onOpen('cost')}
      />
    </section>
  );
}
