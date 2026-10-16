import React, { useMemo, useState } from 'react';
import { isDemoMode } from '../../demo/demoMode.js';
import { DemoNote } from '../../demo/DemoBadge.jsx';
import { Notice, Spinner } from '../ui.jsx';
import { formatWhen } from '../format.js';
import { formatSeconds } from '../calls/callModel.js';
import { analyse, deltaOf, pct, seconds } from './monitorModel.js';
import { useMonitoring } from './useMonitoring.js';
import './monitoring.css';

const PERIODS = [{ days: 7, label: 'Past 7 days' }, { days: 14, label: 'Past 14 days' }, { days: 30, label: 'Past 30 days' }];

function Kpi({ label, value, note, tone = '', title }) {
  return (
    <div className={`mnKpi ${tone}`} title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

// A round number to end the axis on: 1, 2, 4, 5, 10, 20, 40, 50, 100 ...
export function niceMax(max) {
  if (max <= 4) return Math.max(2, max % 2 ? max + 1 : max);
  const mag = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 4, 5, 10].map((m) => m * mag).find((m) => m >= max) || max;
}
const dayLabel = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

// Calls per day: a column for every day, the part that was cut off in red, the number on top while there is room, a few gridlines to read it against.
// Plain HTML, so the labels are never stretched; every column has its numbers in its title for anyone who cannot see the colours.
function DayBars({ series }) {
  const top = niceMax(Math.max(1, ...series.map((d) => d.calls)));
  const every = series.length > 16 ? 5 : series.length > 8 ? 2 : 1;
  const counts = series.length <= 16;
  const total = series.reduce((n, d) => n + d.calls, 0);
  return (
    <div className="mnChart" role="img" aria-label={`Calls per day over the past ${series.length} days: ${total} in all`}>
      <div className="mnY" aria-hidden="true"><span>{top}</span><span>{top / 2}</span><span>0</span></div>
      <div className="mnPlot">
        <div className="mnGrid" aria-hidden="true"><i /><i /><i /></div>
        <div className="mnCols" style={{ gridTemplateColumns: `repeat(${series.length}, minmax(0, 1fr))` }}>
          {series.map((d, i) => {
            const h = (d.calls / top) * 100;
            const cut = d.calls ? (d.cutOff / d.calls) * h : 0;
            return (
              <div key={d.day} className="mnCol" title={`${dayLabel(d.day)}: ${d.calls} ${d.calls === 1 ? 'call' : 'calls'}${d.cutOff ? `, ${d.cutOff} cut off` : ''}${d.handoffs ? `, ${d.handoffs} handed over` : ''}`}>
                <div className="mnStack">
                  {d.calls > 0 && counts && <b className="mnNum">{d.calls}</b>}
                  {d.calls === 0 && <i className="mnZero" />}
                  {d.calls > 0 && <div className="mnBar" style={{ height: `${h}%` }}>{cut > 0 && <span className="mnBarCut" style={{ height: `${(cut / h) * 100}%` }} />}</div>}
                </div>
                <span className="mnDay">{i % every === 0 || i === series.length - 1 ? dayLabel(d.day) : ' '}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function MonitoringPage({ bots = [], onOpenCall, onOpenAgent }) {
  const [days, setDays] = useState(14);
  const data = useMonitoring({ bots, days });
  const report = useMemo(() => analyse({ calls: data.calls, samples: data.samples, bots, nowMs: data.nowMs, days }), [data.calls, data.samples, bots, data.nowMs, days]);
  const { totals, previous } = report;
  const names = Object.fromEntries(bots.map((b) => [b.id, b.name || b.id]));
  const empty = !data.loading && data.calls.length === 0 && data.errors.length === 0;
  const samplesPending = !data.loading && data.calls.length > 0 && Object.keys(data.samples).length === 0;

  return (
    <div className="mnPage">
      <section className="welcomeBlock">
        <div>
          <h1>Monitoring</h1>
          <p>How your agents are doing, from the calls they have had. Everything here is read from the calls; nothing is changed.</p>
        </div>
        <div className="mnControls">
          <label><span className="srOnly">Period</span>
            <select className="stFInput small" value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label="Period">{PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}</select>
          </label>
          <button type="button" className="quietButton" onClick={data.reload} disabled={data.loading}>{data.loading ? 'Reading…' : 'Refresh'}</button>
        </div>
      </section>

      <DemoNote kind="calls">These calls are made-up examples, plus the conversations you had in the preview. No real caller is involved.</DemoNote>
      {data.errors.map((e) => <Notice key={e.botId} kind="error" title={`The calls of ${names[e.botId] || e.botId} couldn’t be read`}>{e.message}</Notice>)}
      {data.truncated && <Notice kind="info" title="Some agents have more calls than were read">The numbers rest on the newest calls of each agent.</Notice>}
      {data.loading && data.calls.length === 0 && <Spinner label="Reading the calls" />}

      {empty && (
        <section className="mnEmpty">
          <h2>No calls to look at yet</h2>
          <p>Once an agent has had calls in the last {days * 2} days, this page shows how many, how they went, and where to look when something is off. A conversation from an agent’s Test tab is a call too.</p>
          {bots[0] && <button type="button" className="primaryCta compactCta" onClick={() => onOpenAgent(bots[0].id, 'test')}>Test {bots[0].name || bots[0].id}</button>}
        </section>
      )}

      {report.alerts.length > 0 && (
        <section className="mnAlerts" aria-label="Alerts">
          {report.alerts.map((a) => (
            <article key={`${a.bot}/${a.version}`} className="mnAlert" role="alert">
              <div>
                <h3>{a.text}</h3>
                <ul>{a.details.map((d) => <li key={d}>{d}</li>)}</ul>
                <small>Based on {a.calls} calls of v{a.version} and {a.previousCalls} of v{a.previousVersion}. It is a pattern in the numbers, not a verdict: look at the calls.</small>
              </div>
              <div className="mnAlertActions">
                <button type="button" className="quietButton" onClick={() => onOpenAgent(a.bot, 'calls')}>See the calls</button>
                <button type="button" className="secondaryCta" onClick={() => onOpenAgent(a.bot, 'deploy', { version: a.previousVersion })}>Roll back to v{a.previousVersion}…</button>
              </div>
            </article>
          ))}
        </section>
      )}

      {!empty && (
        <>
          <section className="mnKpis" aria-label="The numbers">
            <Kpi label="Calls" value={totals.calls} note={deltaOf(totals.calls, previous.calls) ? `${deltaOf(totals.calls, previous.calls)} on the period before` : `in ${days} days`} />
            <Kpi label="Handed over" value={pct(totals.handoffRate)} note="of calls went to another agent or a person" title="The share of calls in which the agent handed the caller to another agent." />
            <Kpi label="Cut off" value={pct(totals.cutOffRate)} tone={totals.cutOffRate > 0.1 ? 'bad' : ''} note={`${totals.cutOff} ${totals.cutOff === 1 ? 'call' : 'calls'} with no ending`} />
            <Kpi label="Time to answer" value={seconds(totals.waitP50)} note={totals.waitP90 !== null ? `slowest tenth: ${seconds(totals.waitP90)}` : samplesPending ? 'reading the calls…' : 'not enough calls read'} tone={totals.waitP90 > 8000 ? 'warn' : ''} />
            <Kpi label="Tools that failed" value={pct(totals.toolFailRate)} tone={totals.toolFailRate > 0.1 ? 'bad' : ''} note={totals.toolCalls ? `of ${totals.toolCalls} tool calls` : samplesPending ? 'reading the calls…' : 'no tool calls read'} />
            <Kpi label="Average call" value={formatSeconds(totals.avgDurationS) || '—'} note={totals.avgTurns !== null ? `${totals.avgTurns.toFixed(1)} caller turns` : ''} />
          </section>
          <p className="mnBasis">Time to answer and failed tools come from the newest {report.sampled} calls whose records were read; the other numbers are from all {totals.calls} calls of the period.</p>

          <section className="mnCard" aria-label="Calls per day">
            <header><h2>Calls per day</h2><span className="mnLegend"><i className="a" /> ended <i className="b" /> cut off</span></header>
            <DayBars series={report.series} />
          </section>

          <div className="mnTwo">
            <section className="mnCard" aria-label="Needs attention">
              <header><h2>Needs attention</h2><small>{report.attention.length} {report.attention.length === 1 ? 'call' : 'calls'}</small></header>
              {report.attention.length === 0 ? <p className="mnNone">Nothing stands out in {samplesPending ? 'the calls read so far' : 'these calls'}. {samplesPending ? 'Still reading their records…' : ''}</p> : (
                <ul className="mnList">
                  {report.attention.slice(0, 8).map((a) => (
                    <li key={`${a.bot}/${a.callId}`} className={`s${a.severity}`}>
                      <div>
                        <b>{a.name}</b> <span className="mnWhen">{formatWhen(a.startedAt)}{a.version ? ` · v${a.version}` : ''}</span>
                        <ul>{a.reasons.map((r, i) => <li key={i}>{r.text}</li>)}</ul>
                      </div>
                      <div className="mnRowActions">
                        <button type="button" className="quietButton small" onClick={() => onOpenCall(a.bot, a.callId, 'trace')}>Open</button>
                        <button type="button" className="quietButton small" onClick={() => onOpenCall(a.bot, a.callId, 'replay')} title="Play the caller’s words to the draft and see what changed">Replay</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mnCard" aria-label="Where callers get stuck">
              <header><h2>What goes wrong most</h2></header>
              {report.issues.length === 0 ? <p className="mnNone">No pattern yet.</p> : (
                <ul className="mnIssues">
                  {report.issues.map((i) => (
                    <li key={i.kind}>
                      <div className="mnIssueHead"><b>{i.label}</b><span className="mnCount">{i.count}</span></div>
                      {i.examples.map((e) => <p key={e.callId}><button type="button" className="linkButton" onClick={() => onOpenCall(e.bot, e.callId, 'trace')}>{e.name}, {formatWhen(e.startedAt)}</button> {e.detail}</p>)}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="mnCard" aria-label="Agents">
            <header><h2>Agents</h2></header>
            <table className="mnTable">
              <thead><tr><th>Agent</th><th>Calls</th><th>Handed over</th><th>Cut off</th><th>Time to answer</th><th>Tools failed</th><th /></tr></thead>
              <tbody>
                {report.perAgent.map((p) => (
                  <tr key={p.bot}>
                    <td><b>{p.name}</b></td>
                    <td>{p.calls}{deltaOf(p.calls, p.previousCalls) ? <small className="mnDelta"> {deltaOf(p.calls, p.previousCalls)}</small> : null}</td>
                    <td>{pct(p.handoffRate)}</td>
                    <td className={p.cutOffRate > 0.1 ? 'bad' : ''}>{pct(p.cutOffRate)}</td>
                    <td>{seconds(p.waitP50)}</td>
                    <td className={p.toolFailRate > 0.1 ? 'bad' : ''}>{pct(p.toolFailRate)}</td>
                    <td><button type="button" className="quietButton small" onClick={() => onOpenAgent(p.bot, 'calls')}>Calls</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {report.versions.length > 0 && (
            <section className="mnCard" aria-label="Versions">
              <header><h2>By version</h2><small>newest first; a version needs a few calls before it is compared</small></header>
              {report.versions.map((v) => (
                <div key={v.bot} className="mnVersions">
                  <h3>{v.name}</h3>
                  <table className="mnTable">
                    <thead><tr><th>Version</th><th>Calls</th><th>Handed over</th><th>Cut off</th><th>Tools failed</th><th>Last call</th></tr></thead>
                    <tbody>{v.rows.map((r) => (
                      <tr key={r.version}><td><b>v{r.version}</b></td><td>{r.calls}</td><td>{pct(r.handoffRate)}</td><td className={r.cutOffRate > 0.1 ? 'bad' : ''}>{pct(r.cutOffRate)}</td><td className={r.toolFailRate > 0.1 ? 'bad' : ''}>{pct(r.toolFailRate)}</td><td>{formatWhen(r.lastSeen)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              ))}
            </section>
          )}
        </>
      )}
      {isDemoMode() && !empty && <p className="mnBasis">In demo mode the calls are generated, so the numbers show what the page does, not how a real agent performs.</p>}
    </div>
  );
}
