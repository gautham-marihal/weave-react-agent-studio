import React from 'react';
import Icon from '../../ui/Icon.jsx';
import Tip from '../../ui/Tip.tsx';
import { withStatus } from './alertsModel.js';
import { useInsights, useLiveAlerts } from './insightsStore.js';
import './insights.css';

// How many alerts nobody has looked at yet (not acknowledged, not snoozed). The sidebar badge and the bell both show it.
export function useNewAlertCount() {
  const { acks } = useInsights();
  const { alerts } = useLiveAlerts();
  return withStatus(alerts, acks, Date.now()).filter((a) => a.status === 'new').length;
}

// The alerts that hold for each agent (not snoozed): { botId: { count, critical } }, for the lists of agents.
export function useAlertsByAgent() {
  const { acks } = useInsights();
  const { alerts } = useLiveAlerts();
  const out = {};
  withStatus(alerts, acks, Date.now())
    .filter((a) => a.status !== 'snoozed')
    .forEach((a) => {
      const row = out[a.bot] || { count: 0, critical: 0 };
      row.count += 1;
      if (a.severity === 'critical') row.critical += 1;
      out[a.bot] = row;
    });
  return out;
}

// Asks the workspace to show its Alerts page (from inside an agent, a notification, the bell).
export const openAlertsPage = () => window.dispatchEvent(new Event('weave-open-alerts'));

// The bell in the top bar: a count of the new alerts, and a way to them.
export default function AlertBell({ onOpen = openAlertsPage }) {
  const count = useNewAlertCount();
  const label = count ? `Alerts: ${count} new` : 'Alerts: nothing new';
  return (
    <Tip label={label}>
      <button type="button" className="inBell" onClick={onOpen} aria-label={label}>
        <Icon name="bell" size={18} />
        {count > 0 && <b aria-hidden="true">{count > 9 ? '9+' : count}</b>}
      </button>
    </Tip>
  );
}
