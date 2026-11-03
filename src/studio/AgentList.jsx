import React from 'react';
import Icon from '../ui/Icon.jsx';
import Menu from './manage/Menu.tsx';
import { formatWhen } from './format.js';
import { needsAttention } from './health/health.js';
import { seconds } from './speed/speedModel.ts';
import { navigate, routeHref } from './route.js';
import { isDemoSample } from '../demo/demoMode.js';

// The Agents list as its canvas design: a table (a box to pick each agent, where it runs with its version under it,
// health, calls this week with their line, answer time, owner with when its draft was saved under it, its menu) or a
// grid of cards with the same facts.
//   bots: the agents shown; known: id -> { health, owner } (read so far); activity: id -> { total, series };
//   answers: id -> answer time (ms, half the answers); alerts: id -> { count, critical };
//   picked: Set of ids; onPick(id); onPickAll(ids, on); menuItems(bot); pinned: ids; onPin(id)

const ENVS = [
  ['production', 'Production'],
  ['staging', 'Staging'],
  ['development', 'Development'],
];

// where it runs, as the table's status: the most public place it is live, or published, or a draft
// (place and version apart for the table's two lines, text with both for the cards)
export function statusOf(bot) {
  const live = ENVS.find(([env]) => bot.deployed?.[env]);
  if (live) {
    const version = `v${bot.deployed[live[0]]}`;
    return { text: `${live[1]} · ${version}`, place: live[1], version, tone: 'info' };
  }
  if (bot.latest_version) return { text: `Published · v${bot.latest_version}`, place: 'Published', version: `v${bot.latest_version}`, tone: 'neutral' };
  return { text: 'Draft', place: 'Draft', version: 'Not published yet', tone: 'neutral' };
}

// its health in a few words: what is wrong first, "Healthy", or still being checked
export function healthOf(health) {
  if (!health || health.state === 'unknown') return { text: 'Checking…', tone: 'neutral' };
  if (needsAttention(health)) {
    const bad = health.parts.filter((p) => p.tone === 'bad');
    const words = (bad[0] || health.parts[0])?.text || 'needs attention';
    return { text: words.charAt(0).toUpperCase() + words.slice(1), tone: 'warn' };
  }
  return { text: 'Healthy', tone: 'good' };
}

const initials = (name) =>
  String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

// a line through the days, in a 72 × 20 box
const spark = (series) => {
  const xs = (series || []).map((d) => d.calls);
  if (xs.length < 2) return '';
  const max = Math.max(1, ...xs);
  return xs.map((v, i) => `${((i * 72) / (xs.length - 1)).toFixed(1)},${(17 - (v / max) * 14).toFixed(1)}`).join(' ');
};

function Pills({ bot, health, alerts }) {
  const status = statusOf(bot);
  const well = healthOf(health);
  return (
    <>
      <span className={`cvPill ${status.tone}`}>{status.text}</span>
      <span className={`cvPill plain ${well.tone}`}>{well.text}</span>
      {alerts?.count > 0 && (
        <span className="cvPill bad" title={`${alerts.count} alert${alerts.count === 1 ? '' : 's'} on this agent`}>
          {alerts.count} alert{alerts.count === 1 ? '' : 's'}
        </span>
      )}
    </>
  );
}

function Name({ bot, pinned }) {
  const name = bot.name || bot.id;
  return (
    <span className="cvAgentCell">
      <span className="cvMark" aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="cvText">
        <span>
          <button type="button" className="cvAgentName" onClick={() => navigate(routeHref(bot.id), { guard: false })}>
            {name}
          </button>
          {pinned && (
            <span title="Pinned to the top">
              {' '}
              <Icon name="pin" size={12} />
              <span className="srOnly"> (pinned)</span>
            </span>
          )}
          {isDemoSample(bot.id) && <span className="cvPill plain cvSample">Sample</span>}
        </span>
        <code className="cvId">{bot.id}</code>
      </span>
    </span>
  );
}

// opens the agent (its name does too; this is the obvious way)
function OpenButton({ bot }) {
  return (
    <button
      type="button"
      className="cvBtn small cvOpen"
      onClick={() => navigate(routeHref(bot.id), { guard: false })}
      aria-label={`Open ${bot.name || bot.id}`}
    >
      Open
    </button>
  );
}

const menuFor = (bot, { menuItems, pinned, onPin }) => [
  { label: pinned.includes(bot.id) ? 'Unpin it' : 'Pin it to the top', onClick: () => onPin(bot.id) },
  { divider: true },
  ...menuItems(bot),
];

export function AgentTableView({ bots, known, activity, answers, alerts, picked, onPick, onPickAll, menuItems, pinned, onPin, footer }) {
  const everyPicked = bots.length > 0 && bots.every((bot) => picked.has(bot.id));
  return (
    <div className="cvTableBox agentTable" data-scroll-edges>
      <table className="cvAgents">
        <thead>
          <tr>
            <th scope="col" className="cvCheck">
              <input
                type="checkbox"
                checked={everyPicked}
                onChange={(event) =>
                  onPickAll(
                    bots.map((bot) => bot.id),
                    event.target.checked,
                  )
                }
                aria-label="Pick every agent shown"
              />
            </th>
            <th scope="col">Agent</th>
            <th scope="col">Status</th>
            <th scope="col">Health</th>
            <th scope="col">Calls · 7 days</th>
            <th scope="col" className="cvNum cvColAnswer">
              Answer time
            </th>
            <th scope="col" className="cvColOwner">
              Owner
            </th>
            <th scope="col">
              <span className="srOnly">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {bots.map((bot) => {
            const name = bot.name || bot.id;
            const meta = known[bot.id];
            const calls = activity[bot.id];
            const owner = meta?.owner || '';
            const status = statusOf(bot);
            return (
              <tr key={bot.id} className={picked.has(bot.id) ? 'selected' : ''}>
                <td className="cvCheck">
                  <input type="checkbox" checked={picked.has(bot.id)} onChange={() => onPick(bot.id)} aria-label={`Pick ${name}`} />
                </td>
                <td>
                  <Name bot={bot} pinned={pinned.includes(bot.id)} />
                </td>
                <td>
                  <span className="cvStack">
                    <span className={`cvPill ${status.tone}`}>{status.place}</span>
                    <small>{status.version}</small>
                  </span>
                </td>
                <td>
                  <span className="cvTilePills">
                    <span className={`cvPill plain ${healthOf(meta?.health).tone}`}>{healthOf(meta?.health).text}</span>
                    {alerts[bot.id]?.count > 0 && (
                      <span className="cvPill bad">
                        {alerts[bot.id].count} alert{alerts[bot.id].count === 1 ? '' : 's'}
                      </span>
                    )}
                  </span>
                </td>
                <td>
                  {calls ? (
                    <span className="cvCalls">
                      <svg className="cvSpark" width="72" height="20" viewBox="0 0 72 20" aria-hidden="true">
                        <polyline points={spark(calls.series)} />
                      </svg>
                      {calls.total}
                    </span>
                  ) : (
                    <span className="cvReading">Reading…</span>
                  )}
                </td>
                <td className="cvNum cvColAnswer" title={answers[bot.id] === undefined ? 'No answers timed in the last 7 days' : undefined}>
                  {answers[bot.id] !== undefined ? seconds(answers[bot.id]) : '—'}
                </td>
                <td className="cvColOwner">
                  <span className="cvOwner">
                    <span className={owner ? 'cvAvatar' : 'cvAvatar none'} aria-hidden="true">
                      {owner ? initials(owner) : ''}
                    </span>
                    <span className="cvStack">
                      <span className={owner ? '' : 'cvNone'}>{owner || 'No owner'}</span>
                      <small title={bot.draft_saved_at ? new Date(bot.draft_saved_at).toLocaleString() : undefined}>
                        {bot.draft_saved_at ? `Saved ${formatWhen(bot.draft_saved_at)}` : 'Never saved'}
                      </small>
                    </span>
                  </span>
                </td>
                <td className="cvMenu">
                  <span className="cvRowActions">
                    <OpenButton bot={bot} />
                    <Menu label={`Actions for ${name}`} items={menuFor(bot, { menuItems, pinned, onPin })} />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {footer}
    </div>
  );
}

export function AgentTilesView({ bots, known, activity, answers, alerts, menuItems, pinned, onPin }) {
  return (
    <ul className="cvTiles agentTable" aria-label="Agents">
      {bots.map((bot) => {
        const name = bot.name || bot.id;
        const calls = activity[bot.id];
        return (
          <li key={bot.id}>
            <article className="cvTile" aria-label={name}>
              <span className="cvAgentCell">
                <Name bot={bot} pinned={pinned.includes(bot.id)} />
                <OpenButton bot={bot} />
                <Menu label={`Actions for ${name}`} items={menuFor(bot, { menuItems, pinned, onPin })} />
              </span>
              <span className="cvTilePills">
                <Pills bot={bot} health={known[bot.id]?.health} alerts={alerts[bot.id]} />
              </span>
              <span className="cvTileNums">
                <span>
                  <small>Calls · 7 days</small>
                  <strong>{calls ? calls.total : <span className="cvReading">Reading…</span>}</strong>
                </span>
                <span>
                  <small>Answer time</small>
                  <strong title={answers[bot.id] === undefined ? 'No answers timed in the last 7 days' : undefined}>
                    {answers[bot.id] !== undefined ? seconds(answers[bot.id]) : '—'}
                  </strong>
                </span>
              </span>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
