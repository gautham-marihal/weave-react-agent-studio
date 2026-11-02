import React from 'react';
import { useInsightBots } from '../hooks/useInsightBots';
import { AnalyticsNav } from '../components/insights/AnalyticsNav';
import { AlertsView } from '../components/insights/AlertsView';
import { pageClass } from '../utils/styles';

/** Alerts (/analytics/alerts): what is going wrong with the agents now, what went wrong before, and the rules. */
export function Alerts() {
  const bots = useInsightBots();
  return (
    <div className={pageClass}>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Analytics</h1>
      <AnalyticsNav />
      <div className="mt-6">
        <AlertsView bots={bots} />
      </div>
    </div>
  );
}
