import React from 'react';
import { useStudio } from '../contexts/StudioContext';
import { useInsightBots } from '../hooks/useInsightBots';
import { AnalyticsNav } from '../components/insights/AnalyticsNav';
import { SpeedView } from '../components/insights/SpeedView';
import { pageClass } from '../utils/styles';

/** Speed (/analytics/speed): how long callers wait for every agent's answers, and what would make them quicker. */
export function Speed() {
  const bots = useInsightBots();
  const { loading } = useStudio();
  return (
    <div className={pageClass}>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Analytics</h1>
      <AnalyticsNav />
      <div className="mt-6">{loading && !bots.length ? <p className="text-sm text-muted">Reading the agents…</p> : <SpeedView bots={bots} />}</div>
    </div>
  );
}
