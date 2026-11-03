import React, { useEffect, useMemo, useRef, useState } from 'react';
import { analyse } from '../studio/monitoring/monitorModel.js';
import { useMonitoring } from '../studio/monitoring/useMonitoring.ts';
import { useLiveCount } from '../studio/live/useLiveCount.ts';
import { withStatus } from '../studio/insights/alertsModel.js';
import { useInsights, useLiveAlerts } from '../studio/insights/insightsStore.js';
import { seconds } from '../studio/speed/speedModel.ts';
import { useAgentHealth } from '../studio/health/useAgentHealth.js';
import { needsAttention } from '../studio/health/health.js';
import { downloadText } from '../studio/manage/exportConfig.js';
import Icon from '../ui/Icon.jsx';
import { Kpi, moved, sparkPoints } from './homeKpi.jsx';
import { useRiseInOnce } from '../ui/motion.ts';
import HomeJourney from './HomeJourney.jsx';

// Home's overview, as its canvas design: the head with the period, four numbers with how they moved, calls by day, the
// calls going on now, the agents that need attention, and the alerts with the next step. Every number is worked out as
// its own page does it (Monitoring, Speed, Live, Alerts, the Agents list), from the same reads, so the pages agree.
// Read-only, apart from Export (a file of the numbers).
//   days, onDays(days): the period (7, 14 or 30); onOpen(pageId); onOpenTab(botId, tab, params); onCreate()
//   connection: what Home says of the server (demo data, no answer), shown after the line under the title
//   notice: shown under the head (the sample agents)

export const HOME_PERIODS = [7, 14, 30];
const HEALTH_LIMIT = 40; // as the Agents page: health is read for every agent of a list this long

const pct = (r) => (typeof r === 'number' ? `${Math.round(r * 100)}%` : '—');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const utc = (day) => new Date(`${day}T12:00:00Z`);
const dayLong = (day) => utc(day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const dayShort = (day) => utc(day).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekday = (day) => utc(day).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

function HomeNumbers({ report, reading, timing, days, onOpen }) {
  const { totals, previous, series } = report;
  const handled = (t) => (typeof t.handoffRate === 'number' ? 1 - t.handoffRate : null);
  const hadPrevious = previous.calls > 0;
  const today = series[series.length - 1]?.calls || 0;
  const tiles = useRef(null);
  useRiseInOnce(tiles, true);
  return (
    <section className="cvKpis" aria-label="The workspace in numbers" ref={tiles}>
      <Kpi
        label={`Calls · last ${days} days`}
        loading={reading}
        value={totals.calls}
        note={totals.calls ? `${plural(today, 'call')} today` : 'No calls yet'}
        spark={sparkPoints(series.map((d) => d.calls))}
        change={hadPrevious ? moved(totals.calls, previous.calls, String, null) : null}
        onOpen={() => onOpen('monitoring')}
      />
      <Kpi
        label="Handled alone"
        title="Calls the agent finished without passing the caller to a person"
        loading={reading}
        value={pct(handled(totals))}
        note={totals.calls ? `${totals.calls - Math.round((totals.handoffRate || 0) * totals.calls)} of ${plural(totals.calls, 'call')}` : 'No calls yet'}
        spark={sparkPoints(series.map((d) => (d.calls ? 1 - d.handoffs / d.calls : null)))}
        change={hadPrevious ? moved(handled(totals), handled(previous), pct, 'up') : null}
        onOpen={() => onOpen('monitoring')}
      />
      <Kpi
        label={`Answer time · last ${days} days`}
        loading={reading || timing}
        value={seconds(totals.waitP50)}
        note={totals.waitP50 !== null ? `Half the answers; 1 in 10 over ${seconds(totals.waitP90)}` : totals.calls ? 'No answers timed yet' : 'No calls yet'}
        spark={sparkPoints(series.map((d) => d.waitP50).filter((v) => typeof v === 'number'))}
        change={previous.waitP50 !== null ? moved(totals.waitP50, previous.waitP50, seconds, 'down') : null}
        title="How long callers waited for an answer, from the calls' records"
        onOpen={() => onOpen('speed')}
      />
      <Kpi
        label="Tool calls that failed"
        loading={reading || timing}
        value={pct(totals.toolFailRate)}
        note={totals.toolCalls ? `Of ${plural(totals.toolCalls, 'tool call')} in the calls read` : 'No tool calls read yet'}
        spark={sparkPoints(series.map((d) => d.toolFailRate).filter((v) => typeof v === 'number'))}
        change={previous.toolCalls ? moved(totals.toolFailRate, previous.toolFailRate, pct, 'down') : null}
        onOpen={() => onOpen('monitoring')}
      />
    </section>
  );
}

// a round top for the axis: 4, or 1, 2, 5 × 10ⁿ at or above the highest day
const niceMax = (n) => {
  if (n <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 5, 10].map((m) => m * step).find((v) => v >= n);
};

// Calls by day, as stacked bars: handled by the agent, and passed to a person. Pointing at a day reads it out under the
// chart; the same numbers are a table for screen readers.
function CallsByDay({ series, loading, days }) {
  const [at, setAt] = useState(null);
  const top = niceMax(Math.max(0, ...series.map((d) => d.calls)));
  const shown = at !== null ? series[at] : null;
  const total = series.reduce((n, d) => n + d.calls, 0);
  const label = (i) => {
    if (i === series.length - 1) return 'Today';
    if (days <= 7) return weekday(series[i].day);
    return i === 0 || i === Math.floor(series.length / 2) ? dayShort(series[i].day) : '';
  };
  const columns = { gridTemplateColumns: `repeat(${series.length}, minmax(0, 1fr))` };
  return (
    <section className="cvCard cvChart" aria-labelledby="home-chart-title">
      <header>
        <h2 id="home-chart-title">Calls by day</h2>
        <span className="cvLegend" aria-hidden="true">
          <span>
            <i className="handled" />
            Handled by the agent
          </span>
          <span>
            <i className="person" />
            Passed to a person
          </span>
        </span>
      </header>
      {loading ? (
        <p className="cvQuiet" role="status">
          Reading the calls…
        </p>
      ) : (
        <>
          <div className="cvPlot" aria-hidden="true">
            <span className="cvAxis">
              <span>{top}</span>
              <span>{top / 2}</span>
              <span>0</span>
            </span>
            <span className="cvBars" style={columns} onMouseLeave={() => setAt(null)}>
              {series.map((d, i) => (
                <span key={d.day} className={`cvBar ${at === i ? 'on' : ''}`} onMouseEnter={() => setAt(i)}>
                  {d.handoffs > 0 && <i className="person" style={{ height: `${(d.handoffs / top) * 100}%` }} />}
                  {d.calls - d.handoffs > 0 && <i className="handled" style={{ height: `${((d.calls - d.handoffs) / top) * 100}%` }} />}
                </span>
              ))}
            </span>
            <span className="cvDays" style={columns}>
              {series.map((d, i) => (
                <span key={d.day} className={i === series.length - 1 ? 'today' : ''}>
                  {label(i)}
                </span>
              ))}
            </span>
          </div>
          <p className="cvReadout" aria-hidden="true">
            {shown
              ? `${dayLong(shown.day)}: ${plural(shown.calls, 'call')}, ${shown.calls - shown.handoffs} handled by the agent, ${shown.handoffs} passed to a person.`
              : `${plural(total, 'call')} in the last ${days} days. Point at a day for its numbers.`}
          </p>
          <table className="srOnly">
            <caption>Calls by day</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Handled by the agent</th>
                <th scope="col">Passed to a person</th>
              </tr>
            </thead>
            <tbody>
              {series.map((d) => (
                <tr key={d.day}>
                  <th scope="row">{dayLong(d.day)}</th>
                  <td>{d.calls - d.handoffs}</td>
                  <td>{d.handoffs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

const channelWords = (channel) => {
  const type = String((channel && typeof channel === 'object' ? channel.type : channel) || '');
  if (/sip|phone/.test(type)) return 'Phone call';
  if (/voice/.test(type)) return 'Voice on the website';
  if (/chat/.test(type)) return 'Chat';
  return 'Call';
};
const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// The calls going on now: which agent, how, and for how long (the Live page follows each one).
function LiveNow({ live, names, onOpen }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const going = live.calls.length > 0;
  useEffect(() => {
    if (!going) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [going]);
  const calls = [...live.calls].sort((a, b) => Date.parse(a.started_at || 0) - Date.parse(b.started_at || 0)).slice(0, 4);
  return (
    <section className="cvCard" aria-labelledby="home-live-title">
      <header>
        <h2 id="home-live-title">
          {going && <span className="cvLiveDot" aria-hidden="true" />}
          Live now {live.count !== null && <span className="cvCount">{live.count}</span>}
        </h2>
        <button type="button" className="cvLink" onClick={() => onOpen('live')}>
          Open board
        </button>
      </header>
      {live.count === null ? (
        <p className="cvQuiet" role="status">
          Looking for calls…
        </p>
      ) : !going ? (
        <p className="cvQuiet">No calls right now.</p>
      ) : (
        <ul className="cvList">
          {calls.map((c) => (
            <li key={`${c.bot}/${c.id}`}>
              <span className="cvText">
                <strong>{names[c.bot] || c.bot}</strong>
                <small>{channelWords(c.channel)}</small>
              </span>
              <span className="cvMono">{c.started_at ? clock(Math.max(0, (nowMs - Date.parse(c.started_at)) / 1000)) : ''}</span>
            </li>
          ))}
          {live.count > calls.length && <li className="cvMore">and {plural(live.count - calls.length, 'more call')}</li>}
        </ul>
      )}
    </section>
  );
}

// The agents that need attention: what the Agents list marks so (its health, since the draft was saved), and agents
// whose tool calls keep failing (since the first call of the period with a problem).
function NeedsAttention({ bots, report, onOpen, onOpenTab }) {
  const checked = useMemo(() => bots.slice(0, HEALTH_LIMIT), [bots]);
  const { meta } = useAgentHealth(checked);
  const rows = useMemo(() => {
    const out = new Map();
    checked.forEach((bot) => {
      const health = meta[bot.id]?.health;
      if (!needsAttention(health)) return;
      const bad = health.parts.filter((p) => p.tone === 'bad');
      out.set(bot.id, {
        bot,
        problems: (bad.length ? bad : health.parts).map((p) => p.text),
        tab: (bad[0] || health.parts[0])?.tab || 'config',
        since: bot.draft_saved_at,
      });
    });
    report.perAgent.forEach((a) => {
      if (a.toolCalls < 3 || typeof a.toolFailRate !== 'number' || a.toolFailRate < 0.25) return;
      const bot = bots.find((b) => b.id === a.bot);
      if (!bot) return;
      const first = report.attention
        .filter((x) => x.bot === a.bot)
        .map((x) => x.startedAt)
        .filter(Boolean)
        .sort()[0];
      const words = `${pct(a.toolFailRate)} of tool calls failed`;
      const row = out.get(bot.id);
      if (row) row.problems.push(words);
      else out.set(bot.id, { bot, problems: [words], tab: 'monitoring', since: first });
    });
    return [...out.values()];
  }, [checked, meta, report.perAgent, report.attention, bots]);
  const reading = checked.some((bot) => !meta[bot.id]);
  return (
    <section className="cvCard" aria-labelledby="home-attention-title">
      <header>
        <h2 id="home-attention-title">Needs your attention {rows.length > 0 && <span className="cvPill warn plain">{rows.length}</span>}</h2>
        <button type="button" className="cvLink" onClick={() => onOpen('agents')}>
          View all
        </button>
      </header>
      {rows.length === 0 ? (
        <p className="cvQuiet" role="status">
          {reading ? 'Checking the agents…' : 'Nothing needs you: every agent checked is fine.'}
        </p>
      ) : (
        <div className="cvTableWrap" data-scroll-edges>
          <table className="cvTable">
            <thead>
              <tr>
                <th scope="col">Agent</th>
                <th scope="col">Problem</th>
                <th scope="col">Since</th>
                <th scope="col">
                  <span className="srOnly">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 6).map((row) => (
                <tr key={row.bot.id}>
                  <th scope="row">{row.bot.name || row.bot.id}</th>
                  <td>{row.problems.join(' · ')}</td>
                  <td className="cvSince">{shortDate(row.since) || '—'}</td>
                  <td className="cvAct">
                    <button
                      type="button"
                      className="cvBtn small"
                      onClick={() => onOpenTab(row.bot.id, row.tab)}
                      aria-label={`Fix ${row.bot.name || row.bot.id}`}
                    >
                      Fix
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// The alerts that hold now, most serious first, with how ready the agent worked on last is underneath.
function AlertsNow({ bots, onOpen, onOpenTab }) {
  const { acks } = useInsights();
  const { alerts, checkedAt } = useLiveAlerts();
  const holding = withStatus(alerts, acks, Date.now())
    .filter((a) => a.status !== 'snoozed')
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));
  return (
    <section className="cvCard" aria-labelledby="home-alerts-title">
      <header>
        <h2 id="home-alerts-title">Alerts {holding.length > 0 && <span className="cvCount">{holding.length}</span>}</h2>
        <button type="button" className="cvLink" onClick={() => onOpen('alerts')}>
          All alerts
        </button>
      </header>
      {!checkedAt && !alerts.length ? (
        <p className="cvQuiet" role="status">
          Checking the calls…
        </p>
      ) : holding.length === 0 ? (
        <p className="cvQuiet">Nothing needs a look.</p>
      ) : (
        <ul className="cvList">
          {holding.slice(0, 3).map((a) => (
            <li key={a.key}>
              <span className={`cvTag ${a.severity === 'critical' ? 'bad' : 'warn'}`}>{a.severity === 'critical' ? 'Critical' : 'Warning'}</span>
              <span className="cvText">
                <strong>{a.title}</strong>
                <small>
                  {a.botName}
                  {a.status === 'new' ? ' · new' : ''}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
      <HomeJourney bots={bots} onOpenTab={onOpenTab} />
    </section>
  );
}

// the period's numbers as a file: calls by day, then each agent
function exportCsv(report, days, names) {
  const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [
    ['Day', 'Calls', 'Handled by the agent', 'Passed to a person'],
    ...report.series.map((d) => [d.day, d.calls, d.calls - d.handoffs, d.handoffs]),
    [],
    ['Agent', 'Calls', 'Answer time (half the answers)', 'Tool calls that failed'],
    ...report.perAgent.map((a) => [names[a.bot] || a.bot, a.calls, seconds(a.waitP50), pct(a.toolFailRate)]),
  ];
  downloadText(`workspace-last-${days}-days.csv`, `${lines.map((row) => row.map(cell).join(',')).join('\n')}\n`, 'text/csv');
}

export default function HomeOverview({ bots, days, onDays, onOpen, onOpenTab, onCreate, connection = null, notice = null }) {
  const agents = useMemo(() => bots.map((b) => ({ id: b.id, name: b.name || b.id, deployed: b.deployed || {} })), [bots]);
  const names = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.name])), [agents]);
  const watched = useMonitoring({ bots: agents, days });
  const report = useMemo(
    () => analyse({ calls: watched.calls, samples: watched.samples, bots: agents, nowMs: watched.nowMs, days }),
    [watched.calls, watched.samples, agents, watched.nowMs, days],
  );
  const reading = watched.loading && !watched.calls.length;
  // answer time uses Monitoring's and Speed's calls: records of some, spread over the days, are read after the list
  const timing = !watched.loading && watched.calls.length > 0 && Object.keys(watched.samples).length === 0;
  const live = useLiveCount(agents);
  const running = bots.filter((b) => Object.keys(b.deployed || {}).length).length;
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <section className="cvHead">
        <div>
          <h1>Overview</h1>
          <p>
            {today} · {plural(bots.length, 'agent')} · {running} live {connection}
          </p>
        </div>
        <div className="cvActions">
          <span className="cvSeg" role="group" aria-label="Period">
            {HOME_PERIODS.map((d) => (
              <button key={d} type="button" aria-pressed={days === d} onClick={() => onDays(d)}>
                {d} days
              </button>
            ))}
          </span>
          <button type="button" className="cvBtn" onClick={() => exportCsv(report, days, names)} disabled={reading}>
            Export
          </button>
          <button type="button" className="cvBtn primary" onClick={onCreate}>
            <Icon name="plus" size={14} /> New agent
          </button>
        </div>
      </section>
      {notice}
      <HomeNumbers report={report} reading={reading} timing={timing} days={days} onOpen={onOpen} />
      <div className="cvGrid">
        <CallsByDay series={report.series} loading={reading} days={days} />
        <LiveNow live={live} names={names} onOpen={onOpen} />
        <NeedsAttention bots={bots} report={report} onOpen={onOpen} onOpenTab={onOpenTab} />
        <AlertsNow bots={bots} onOpen={onOpen} onOpenTab={onOpenTab} />
      </div>
    </>
  );
}
