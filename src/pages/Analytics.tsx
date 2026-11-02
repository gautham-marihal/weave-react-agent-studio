import React from 'react';
import { useParams } from 'react-router-dom';
import { useStudio } from '../contexts/StudioContext';
import { useInsightBots } from '../hooks/useInsightBots';
import { AnalyticsNav } from '../components/insights/AnalyticsNav';
import { MonitoringView } from '../components/insights/MonitoringView';
import { Speed } from './Speed';
import { Alerts } from './Alerts';
import { pageClass } from '../utils/styles';

/**
 * Analytics: how the workspace's agents are doing, worked out from their call records. Three pages under one address:
 * Monitoring (/analytics), Speed (/analytics/speed) and Alerts (/analytics/alerts).
 */
export function Analytics() {
  const page = (useParams()['*'] ?? '').split('/')[0];
  if (page === 'speed') return <Speed />;
  if (page === 'alerts') return <Alerts />;
  return <Monitoring />;
}

function Monitoring() {
  const bots = useInsightBots();
  const { loading } = useStudio();
  return (
    <div className={pageClass}>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Analytics</h1>
      <AnalyticsNav />
      <div className="mt-6">{loading && !bots.length ? <p className="text-sm text-muted">Reading the agents…</p> : <MonitoringView bots={bots} />}</div>
    </div>
  );
}
