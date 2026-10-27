import React from 'react';
import Icon from '../../ui/Icon.jsx';
import { navigate, routeHref } from '../route.js';
import { openAlertsPage } from './AlertBell.jsx';
import { withStatus } from './alertsModel.js';
import { useInsights, useLiveAlerts } from './insightsStore.js';
import './insights.css';

const ACTION = {
  tool: (a) => [`Open “${a.action.tool}”`, routeHref(a.bot, 'tools', { tool: a.action.tool })],
  rollback: (a) => [`Roll back to v${a.action.version}…`, routeHref(a.bot, 'deploy', { version: a.action.version })],
  channels: (a) => ['Check its channels', routeHref(a.bot, 'channels')],
  calls: (a) => ['Open its calls', routeHref(a.bot, 'calls')],
};

// On an agent's own pages: what is wrong with this agent now (alerts not snoozed) and the one thing to do. Without
// `botId` (the workspace's Monitoring page) it sums up every agent's alerts and leads to the Alerts page.
export default function AgentAlerts({ botId = '' }) {
  const { acks } = useInsights();
  const { alerts } = useLiveAlerts();
  const mine = withStatus(alerts, acks, Date.now()).filter((a) => (!botId || a.bot === botId) && a.status !== 'snoozed');
  if (!mine.length) return null;
  const [first, ...rest] = mine;
  const [label, href] = ACTION[first.action.kind](first);
  const critical = mine.some((a) => a.severity === 'critical');
  return (
    <div className={`inBanner ${critical ? 'critical' : first.severity}`} role="status">
      <Icon name="alert" size={18} />
      <div>
        <strong>
          {botId ? '' : `${first.botName}: `}
          {first.title}
        </strong>
        {first.status === 'seen' && <span className="stMuted"> · someone is on it{first.seenBy ? `: ${first.seenBy}` : ''}</span>}
        <p>
          {first.detail}
          {rest.length > 0 && ` And ${rest.length} more alert${rest.length === 1 ? '' : 's'}${botId ? ' on this agent' : ''}.`}
        </p>
      </div>
      {botId && (
        <button type="button" className="primaryCta compactCta" onClick={() => navigate(href, { guard: false })}>
          {label}
        </button>
      )}
      <button type="button" className={botId ? 'quietButton' : 'primaryCta compactCta'} onClick={openAlertsPage}>
        {botId ? 'All alerts' : 'See the alerts'}
      </button>
    </div>
  );
}
