import React from 'react';
import Icon from '../../ui/Icon.jsx';
import { withStatus } from './alertsModel.js';
import { useInsights, useLiveAlerts } from './insightsStore.js';
import './insights.css';

// How many alerts nobody has looked at yet (not acknowledged, not snoozed). The sidebar badge and the bell both show it.
export function useNewAlertCount() {
  const { acks } = useInsights();
  const { alerts } = useLiveAlerts();
  return withStatus(alerts, acks, Date.now()).filter((a) => a.status === 'new').length;
}

// Asks the workspace to show its Alerts page (from inside an agent, a notification, the bell).
export const openAlertsPage = () => window.dispatchEvent(new Event('weave-open-alerts'));

// The bell in the top bar: a count of the new alerts, and a way to them.
export default function AlertBell({ onOpen = openAlertsPage }) {
  const count = useNewAlertCount();
  const label = count ? `Alerts: ${count} new` : 'Alerts: nothing new';
  return (
    <button type="button" className="inBell" onClick={onOpen} title={label} aria-label={label}>
      <Icon name="bell" size={18} />
      {count > 0 && <b aria-hidden="true">{count > 9 ? '9+' : count}</b>}
    </button>
  );
}
