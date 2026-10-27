import React from 'react';
import Icon from '../ui/Icon.jsx';
import Tip from '../ui/Tip.tsx';
import { formatWhen } from './format.js';
import { healthTitle } from './health/health.js';
import { useAgentActivity } from './health/useAgentActivity.js';
import { useAlertsByAgent } from './insights/AlertBell.jsx';
import Menu from './manage/Menu.tsx';
import { navigate, routeHref } from './route.js';
import StatePill from './StatePill.jsx';
import StatusChip from '../ui/StatusChip.tsx';
import { stateFromHealth } from './status.js';
import { EnvSlots } from './ui.jsx';
import { isDemoSample } from '../demo/demoMode.js';
import { DragHandle } from '../ui/Sortable.jsx';

// The agents table: every agent on the Agents page (BotRow), and a few on Home (AgentTable).

// One agent as a table row that opens it.
//   activity: recent calls, { total, series } from useAgentActivity
//   alerts: { count, critical } for this agent
//   menuItems(bot): the "⋯" menu (Rename, Export, Remove)
//   compact: Home's short table, without the id and tags
//   pinned, onPin(id): the pin that keeps it at the top of the list
//   movable: show a drag handle (the list is in the person's own order)
export function BotRow({ bot, menuItems, onOpen, health, tags, activity, alerts, compact = false, pinned = false, onPin = null, movable = false }) {
  const state = stateFromHealth(bot, health);
  // Home passes onOpen so it can switch to the Agents area too; a hash change alone wouldn't.
  const open = () => (onOpen ? onOpen(bot) : navigate(routeHref(bot.id), { guard: false }));
  const name = bot.name || bot.id;
  const max = Math.max(1, ...(activity?.series || []).map((d) => d.calls));
  return (
    <div className={`agentRow stAgentRow ${menuItems ? 'withMenu' : ''} ${compact ? 'compact' : ''}`}>
      {/* no aria-label: screen readers read the visible text, name first */}
      <button type="button" className="agentRowMain" onClick={open}>
        <span className="agentRowAvatar" aria-hidden="true">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="agentRowCopy">
          {/* a long name ends in "…" (full name on hover) so the state stays on the same line */}
          <span className="stRowTitle">
            <strong title={name}>{name}</strong>
            <StatePill state={state} />
            {/* Home's short table says this once, above the table */}
            {!compact && isDemoSample(bot.id) && (
              <StatusChip tone="draft" title="An example that comes with demo mode, with made-up calls. Hide the samples from Home.">
                Sample
              </StatusChip>
            )}
          </span>
          {!compact && (
            <small>
              <code>{bot.id}</code>
              {tags?.length > 0 &&
                tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="stAgentTag">
                    {tag}
                  </span>
                ))}
            </small>
          )}
          {/* only problems are listed; a healthy agent shows nothing here */}
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
      {onPin && (
        <span className="agentRowTools">
          {movable && <DragHandle label={`Drag ${name}`} />}
          <Tip label={pinned ? 'Unpin it' : 'Pin it to the top'}>
            <button
              type="button"
              className={`agentRowPin ${pinned ? 'on' : ''}`}
              aria-pressed={pinned}
              aria-label={pinned ? `Unpin ${name}` : `Pin ${name} to the top`}
              onClick={() => onPin(bot.id)}
            >
              <Icon name="pin" size={15} />
            </button>
          </Tip>
        </span>
      )}
      {menuItems && <Menu label={`Actions for ${name}`} items={menuItems(bot)} className="agentRowMenu" />}
    </div>
  );
}

// Home's "Your agents": a few agents in the same table, with their calls and alerts.
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
        <BotRow key={bot.id} bot={bot} onOpen={onOpen} activity={activity.byBot[bot.id]} alerts={alertsByAgent[bot.id]} compact />
      ))}
    </div>
  );
}
