import React from 'react';
import Icon from '../ui/Icon.jsx';
import { formatWhen } from './format.js';
import { healthTitle } from './health/health.js';
import { useAgentActivity } from './health/useAgentActivity.js';
import { useAlertsByAgent } from './insights/AlertBell.jsx';
import Menu from './manage/Menu.jsx';
import { navigate, routeHref } from './route.js';
import StatePill from './StatePill.jsx';
import { stateFromHealth } from './status.js';
import { EnvSlots } from './ui.jsx';

// The agents as one table: the Agents page lists every agent with it (BotRow, with filters and a menu per row), and Home shows a few (AgentTable).

// One agent in a list, as a row that opens it: name and id, where it runs (one slot per environment), its calls of the last days (`activity`: { total,
// series } from useAgentActivity) with the alerts that hold for it (`alerts`: { count, critical }), and its latest published version and when the draft was
// last saved. `menuItems` adds the "⋯" menu (Rename, Export, Remove). Also used on Home.
export function BotRow({ bot, menuItems, onOpen, health, tags, activity, alerts }) {
  const state = stateFromHealth(bot, health);
  // Another page (Home) passes onOpen so it can switch to the Agents area too; a hash change alone wouldn't.
  const open = () => (onOpen ? onOpen(bot) : navigate(routeHref(bot.id), { guard: false }));
  const name = bot.name || bot.id;
  const max = Math.max(1, ...(activity?.series || []).map((d) => d.calls));
  return (
    <div className={`agentRow stAgentRow ${menuItems ? 'withMenu' : ''}`}>
      <button type="button" className="agentRowMain" onClick={open} aria-label={`Open ${name}`}>
        <span className="agentRowAvatar" aria-hidden="true">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="agentRowCopy">
          <span className="stRowTitle">
            <strong>{name}</strong>
            <StatePill state={state} />
          </span>
          <small>
            <code>{bot.id}</code>
            {tags?.length > 0 &&
              tags.slice(0, 3).map((tag) => (
                <span key={tag} className="stAgentTag">
                  {tag}
                </span>
              ))}
          </small>
          {/* only what needs a look; an agent with nothing wrong says nothing */}
          {health && health.state !== 'unknown' && health.parts.length > 0 && (
            <span className={`stHealth ${health.state}`} title={healthTitle(health)} data-health={health.state}>
              {health.parts.slice(0, 3).map((part) => (
                <span key={part.id} className={`stHealthPart ${part.tone}`}>
                  {part.text}
                </span>
              ))}
            </span>
          )}
        </span>
        <EnvSlots deployed={bot.deployed} compact />
        <span className="stRowCalls">
          {activity ? (
            <>
              <strong>{activity.total}</strong>
              <span className="stRowSpark" aria-hidden="true">
                {activity.series.map((d, i) => (
                  <i key={d.day} className={i === activity.series.length - 1 ? 'today' : ''} style={{ height: `${Math.max(8, (d.calls / max) * 100)}%` }} />
                ))}
              </span>
              <span className="srOnly">calls in the last {activity.series.length} days</span>
            </>
          ) : (
            <small className="stMuted">…</small>
          )}
          {alerts?.count > 0 && (
            <b className={`stRowAlert ${alerts.critical ? 'critical' : ''}`} title={`${alerts.count} alert${alerts.count === 1 ? '' : 's'} on this agent`}>
              <Icon name="alert" size={12} /> {alerts.count}
              <span className="srOnly"> alert{alerts.count === 1 ? '' : 's'}</span>
            </b>
          )}
        </span>
        <span className="stRowFacts">
          <span className={bot.latest_version ? 'stRowVersion' : 'stRowVersion none'}>{bot.latest_version ? `v${bot.latest_version}` : 'Not published'}</span>
          <small title={bot.draft_saved_at ? new Date(bot.draft_saved_at).toLocaleString() : ''}>Draft saved {formatWhen(bot.draft_saved_at) || 'never'}</small>
        </span>
        <Icon name="chevronRight" size={16} />
      </button>
      {menuItems && <Menu label={`Actions for ${name}`} items={menuItems(bot)} className="agentRowMenu" />}
    </div>
  );
}

// A few agents as the same table as the Agents page, with their calls and alerts (Home's "Your agents").
export function AgentTable({ bots, onOpen }) {
  const activity = useAgentActivity(bots);
  const alertsByAgent = useAlertsByAgent();
  return (
    <div className="agentRowList agentTable">
      <div className="stAgentHead" aria-hidden="true">
        <span>Agent</span>
        <span>Where it runs</span>
        <span>Calls · 7 days</span>
        <span>Latest version</span>
      </div>
      {bots.map((bot) => (
        <BotRow key={bot.id} bot={bot} onOpen={onOpen} activity={activity.byBot[bot.id]} alerts={alertsByAgent[bot.id]} />
      ))}
    </div>
  );
}
