import React, { useMemo, useState } from 'react';
import { DemoNote } from '../../demo/DemoBadge.jsx';
import Icon from '../../ui/Icon.jsx';
import Select from '../../ui/Select.tsx';
import { Skeleton } from '../../ui/Skeleton.jsx';
import { Notice } from '../ui.jsx';
import { usePref } from '../usePref.js';
import { STAGES, seconds, summarize } from './speedModel.ts';
import { PER_AGENT, useSpeedData } from './useSpeedData.ts';
import { DayChart, StageBars } from './SpeedCharts.jsx';
import { humanize } from '../agent/rowNames.js';
import './speed.css';

const PERIODS = [
  [7, 'Last 7 days'],
  [14, 'Last 14 days'],
  [30, 'Last 30 days'],
];
const TARGETS = [1, 1.5, 2, 3, 4, 5];
const TARGET_KEY = 'weave_speed_target';
const pct = (v) => (v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`);
const clip = (text, n = 72) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

// What the calls say, in one sentence a person can act on, by how they did against the target.
const VERDICT = {
  good: { icon: 'check', title: 'Callers are answered quickly' },
  ok: { icon: 'clock', title: 'Most callers are answered quickly' },
  slow: { icon: 'alert', title: 'Callers often wait longer than your target' },
  few: { icon: 'clock', title: 'Too few answers to judge yet' },
};

// One number, what it is above it and what it means under it (the same tile as Home's).
function Stat({ value, label, sub, tone = '' }) {
  return (
    <div className={`csStat ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
      {sub && <small>{sub}</small>}
    </div>
  );
}

// The part of an agent's waits that takes longest on average (both kinds of call together), for the table of agents.
function mainPart(stages) {
  const total = {};
  Object.values(stages || {}).forEach((k) =>
    Object.entries(k.avg).forEach(([id, v]) => {
      total[id] = (total[id] || 0) + v.ms * v.n;
    }),
  );
  const [id] = Object.entries(total).sort((a, b) => b[1] - a[1])[0] || [];
  return STAGES.find((s) => s.id === id) || null;
}

// "Speed": how fast an agent answers, where the time goes and what would make it quicker, from its calls. The
// workspace compares agents; an agent's own page (agentOnly) shows that one. Read-only; suggestions open their setting.
//   onOpenAgent(botId, tab, params): opens an agent's page
//   onShowSetting(path): on an agent's own page, opens one of its settings
export default function SpeedPage({ bots = [], agentOnly = false, onOpenCall, onOpenAgent, onShowSetting }) {
  const [days, setDays] = useState(14);
  const [targetPref, setTargetPref] = usePref(TARGET_KEY, '2');
  const target = TARGETS.includes(Number(targetPref)) ? Number(targetPref) : Math.min(5, Math.max(1, Number(targetPref) || 2));
  const targetMs = target * 1000;
  const data = useSpeedData(bots, { days });
  const names = Object.fromEntries(bots.map((b) => [b.id, b.name || b.id]));

  const all = useMemo(
    () =>
      summarize({ samples: data.samples, totalCalls: Object.values(data.totals).reduce((a, b) => a + b, 0), targetMs, days, nowMs: Date.parse(data.at || '') }),
    [data.samples, data.totals, targetMs, days, data.at],
  );
  const perAgent = useMemo(
    () =>
      bots.map((b) => ({
        bot: b,
        summary: summarize({ samples: data.samples.filter((s) => s.bot === b.id), totalCalls: data.totals[b.id] || 0, targetMs }),
      })),
    [bots, data.samples, data.totals, targetMs],
  );
  // what would help, biggest first; on the workspace each is said once, with the agents it concerns listed under it
  const advice = useMemo(() => {
    const groups = new Map();
    (agentOnly ? [{ bot: bots[0], summary: all }] : perAgent).forEach(({ bot, summary }) =>
      summary.advice.forEach((a) => {
        const g = groups.get(a.id) || { ...a, agents: [] };
        g.agents.push({ bot: bot?.id, ms: a.ms, path: a.path });
        g.ms = Math.max(g.ms, a.ms);
        groups.set(a.id, g);
      }),
    );
    return [...groups.values()].sort((a, b) => b.ms - a.ms).slice(0, 5);
  }, [agentOnly, bots, all, perAgent]);
  // "1.1–1.3 s": the times of the agents a suggestion is about
  const range = (agents) => {
    const times = agents.map((a) => a.ms);
    const lo = Math.min(...times);
    const hi = Math.max(...times);
    if (seconds(lo) === seconds(hi)) return seconds(hi);
    return lo >= 1000 && hi < 10000 ? `${(lo / 1000).toFixed(1)}–${seconds(hi)}` : `${seconds(lo)} to ${seconds(hi)}`;
  };
  const openSetting = (botId, path) => {
    if (agentOnly && onShowSetting) onShowSetting(path);
    else onOpenAgent?.(botId, 'home', { setting: path.join('.') });
  };

  const empty = !data.loading && all.sampled === 0;
  const period = PERIODS.find((p) => p[0] === days)[1].toLowerCase();
  const verdict = VERDICT[all.verdict];
  const s = all.speed;
  const subject = agentOnly ? bots[0]?.name || 'This agent' : 'Your agents';

  return (
    <div className="csPage">
      <section className="welcomeBlock">
        <div>
          <h1>Speed</h1>
          <p>
            How long callers wait for {agentOnly ? `${bots[0]?.name || 'this agent'}’s` : 'your agents’'} answers, where the time goes, and what would make them
            quicker. Worked out from the calls; nothing is changed.
          </p>
        </div>
      </section>

      <div className="csControls" role="group" aria-label="What to show">
        <label>
          <span>Period</span>
          <Select className="stFInput small" value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label="Period">
            {PERIODS.map(([d, label]) => (
              <option key={d} value={d}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label title="An answer within this many seconds counts as quick. Kept in this browser.">
          <span>Target</span>
          <Select className="stFInput small" value={target} onChange={(event) => setTargetPref(event.target.value)} aria-label="Target answer time, in seconds">
            {TARGETS.map((t) => (
              <option key={t} value={t}>
                Within {t} s
              </option>
            ))}
          </Select>
        </label>
        <button type="button" className="quietButton" onClick={data.refresh} disabled={data.loading}>
          {data.loading ? 'Reading…' : 'Refresh'}
        </button>
      </div>

      <DemoNote kind="calls">The calls are made up, and so are their timings.</DemoNote>
      {data.errors.map((e) => (
        <Notice
          key={e.botId || e.message}
          kind="error"
          title={e.botId ? `The calls of ${names[e.botId] || e.botId} couldn’t be read` : 'The calls couldn’t be read'}
        >
          {e.message}
        </Notice>
      ))}
      {/* calls whose records the server wouldn't give are left out, and said, so the numbers aren't taken for all */}
      {data.failed > 0 && !data.loading && (
        <Notice kind="warn" title={`${data.failed} call${data.failed === 1 ? '' : 's'} couldn’t be read`}>
          {all.sampled ? 'They are left out of the numbers below.' : 'So there is nothing to time yet.'} Refresh to try again.
        </Notice>
      )}

      {data.loading && !data.at ? (
        // the page's own shape while the calls are read, so nothing jumps when the numbers arrive
        <div className="csBody" role="status" aria-label="Reading the calls">
          <div className="csVerdict">
            <Skeleton width={40} height={40} round />
            <span className="csSkelLines">
              <Skeleton width="42%" height={16} />
              <Skeleton width="78%" />
              <Skeleton width="36%" height={10} />
            </span>
          </div>
          <div className="csStats">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="csStat">
                <Skeleton width="44%" height={10} />
                <Skeleton width="34%" height={22} />
                <Skeleton width="70%" height={10} />
              </div>
            ))}
          </div>
          <div className="csSection">
            <Skeleton width="22%" height={14} />
            <Skeleton width="100%" height={160} />
          </div>
        </div>
      ) : empty && data.failed ? null : empty ? (
        <div className="csEmpty">
          <Icon name="clock" size={22} />
          <strong>No calls to work it out from</strong>
          <p>
            Once {agentOnly ? 'this agent has' : 'your agents have'} had calls in the {period}, this page shows how long callers wait for answers. A
            conversation in Test is a call too.
          </p>
        </div>
      ) : (
        // while the calls are read again the page keeps what it showed, dimmed
        <div className={`csBody ${data.loading ? 'reading' : ''}`} aria-busy={data.loading || undefined}>
          <section className={`csVerdict ${all.verdict}`} aria-label="How quickly callers are answered">
            <span className="csVerdictIcon" aria-hidden="true">
              <Icon name={verdict.icon} size={20} />
            </span>
            <div className="csVerdictText">
              <h2>{verdict.title}</h2>
              <p>
                {all.verdict === 'few'
                  ? `${s.answers ? `Only ${s.answers} answer${s.answers === 1 ? ' was' : 's were'} timed` : 'No answers were timed'} in the ${period}. The more calls ${agentOnly ? 'it has' : 'they have'}, the surer this page is.`
                  : `${pct(s.within)} of answers came within your ${target} s target. Callers usually waited about ${seconds(s.p50)}, and 9 out of 10 answers came within ${seconds(s.p90)}.`}
              </p>
              <small>
                {subject}, {all.sampled} call{all.sampled === 1 ? '' : 's'} and {s.answers} answer{s.answers === 1 ? '' : 's'} in the {period}
                {all.totalCalls > all.sampled + data.failed ? ` (${PER_AGENT} calls of each agent, spread over the days, out of ${all.totalCalls})` : ''}.
              </small>
            </div>
            {s.within !== null && (
              <div className="csMeter" role="img" aria-label={`${pct(s.within)} of answers within ${target} seconds`}>
                <strong>{pct(s.within)}</strong>
                <span className="csMeterTrack">
                  <i style={{ width: `${Math.round(s.within * 100)}%` }} />
                </span>
                <small>within {target} s</small>
              </div>
            )}
          </section>

          <div className="csStats">
            <Stat value={seconds(s.p50)} label="Typical wait" sub="how long a caller usually waits" />
            <Stat
              value={seconds(s.p90)}
              label="9 out of 10 answers within"
              sub="the rest took longer than this"
              tone={s.p90 !== null && s.p90 > targetMs ? 'warn' : ''}
            />
            <Stat value={seconds(s.max)} label="Longest wait" sub={s.slowest[0]?.say ? `answering “${clip(s.slowest[0].say, 34)}”` : 'the slowest answer'} />
            <Stat
              value={seconds(s.ttftP50)}
              label="AI model starts in"
              sub={s.ttftP50 !== null ? 'how long the AI usually takes to begin an answer' : 'these calls don’t record it'}
            />
          </div>

          <section className="csSection" aria-labelledby="csDays">
            <header className="csSectionHead">
              <h2 id="csDays">Day by day</h2>
              <p>How long callers usually waited each day, compared with your target. Point at a day to see its numbers.</p>
            </header>
            {all.days.some((d) => d.n) ? <DayChart days={all.days} targetMs={targetMs} /> : <p className="stMuted">No answers to show day by day.</p>}
          </section>

          <section className="csSection" aria-labelledby="csParts">
            <header className="csSectionHead">
              <h2 id="csParts">Where the wait goes</h2>
              <p>
                An answer’s wait, part by part, on average. Voice calls have more parts than chats: the caller has to finish speaking, and the answer is spoken.
              </p>
            </header>
            {Object.keys(all.stages).length ? <StageBars stages={all.stages} /> : <p className="stMuted">These calls don’t record the parts of their waits.</p>}
          </section>

          <section className="csSection" aria-labelledby="csAdvice">
            <header className="csSectionHead">
              <h2 id="csAdvice">What would make answers quicker</h2>
              <p>Based on where the wait goes. Each suggestion opens the setting to change.</p>
            </header>
            {advice.length ? (
              <ul className="csAdvice">
                {advice.map((a) => {
                  const one = a.agents.length === 1 ? a.agents[0] : null;
                  return (
                    <li key={a.id} className={`csAdviceItem csAdvice-${a.id.split(':')[0]} ${one ? '' : 'several'}`}>
                      <span className="csAdviceMark" aria-hidden="true" />
                      <div>
                        <strong>
                          {!agentOnly && one && <span className="csAgentName">{names[one.bot] || one.bot}</span>}
                          {one ? a.title : `${a.lead} ${range(a.agents)}${a.tail}`}
                        </strong>
                        <p>{one ? a.why : a.whyAll || a.why}</p>
                        {!one && (
                          <div className="csAdviceAgents">
                            <span>{a.action}:</span>
                            {a.agents.map((g) => (
                              <button key={g.bot} type="button" className="quietButton" onClick={() => openSetting(g.bot, g.path)}>
                                {/* named "Choose a faster model for Front Desk 2.4 s": action, then what's seen */}
                                <span className="srOnly">{a.action} for </span>
                                {names[g.bot] || g.bot}
                                <small>{seconds(g.ms)}</small>
                                <Icon name="arrowRight" size={13} />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {one && (
                        <button type="button" className="quietButton" onClick={() => openSetting(one.bot, one.path)}>
                          {a.action}
                          <Icon name="arrowRight" size={14} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : all.verdict === 'good' && Object.keys(all.stages).length ? (
              <p className="csAllGood">
                <Icon name="check" size={15} />
                Nothing stands out: each part of the wait is within the usual range.
              </p>
            ) : (
              <p className="stMuted">
                {all.verdict === 'few'
                  ? 'Too few answers to suggest a change yet.'
                  : !Object.keys(all.stages).length
                    ? 'These calls don’t record the parts of their waits, so there is nothing to point at yet.'
                    : 'No one part stands out enough to suggest a change. The slowest answers below show where their time went.'}
              </p>
            )}
          </section>

          <div className="csTwo">
            <section className="csSection" aria-labelledby="csSlowest">
              <header className="csSectionHead">
                <h2 id="csSlowest">The slowest answers</h2>
                <p>What the caller had said, and the part that took longest.</p>
              </header>
              {s.slowest.length ? (
                <ul className="csSlow">
                  {s.slowest.map((w) => (
                    <li key={`${w.callId}|${w.ms}|${w.say}`}>
                      <b className={w.ms > targetMs ? 'csWarnText' : ''}>{seconds(w.ms)}</b>
                      <span>
                        “{clip(w.say || '…')}”
                        <small>
                          {[!agentOnly && (names[w.bot] || w.bot), w.voice ? 'Voice call' : 'Chat', w.cause && `mostly ${w.cause.label.toLowerCase()}`]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      </span>
                      {onOpenCall && (
                        <button type="button" className="linkButton" onClick={() => onOpenCall(w.bot, w.callId)}>
                          Open the call
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="stMuted">None of these calls has an answer to time yet.</p>
              )}
            </section>

            <section className="csSection" aria-labelledby="csSystems">
              <header className="csSectionHead">
                <h2 id="csSystems">Tools and your systems</h2>
                <p>What the agent waited on while answering: how often, how long it took, and how often it failed.</p>
              </header>
              {all.systems.length ? (
                <table className="csTable">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Uses</th>
                      <th scope="col">Typical time</th>
                      <th scope="col">Longest</th>
                      <th scope="col">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {all.systems.slice(0, 8).map((t) => (
                      <tr key={`${t.kind}:${t.name}`}>
                        <td>
                          <b title={t.name}>{humanize(t.name) || t.name}</b>
                          <small className="csKind">{t.kind === 'request' ? 'your system' : 'tool'}</small>
                        </td>
                        <td>{t.n}</td>
                        <td className={t.p50 >= 700 ? 'csWarnText' : ''}>{seconds(t.p50)}</td>
                        <td>{seconds(t.max)}</td>
                        <td className={t.failed ? 'csBadText' : 'stMuted'}>
                          {t.failed ? `${t.failed} of ${t.n}` : 'none'}
                          {t.retried ? <small className="csKind">{t.retried} retried</small> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="stMuted">No tools or requests to your systems in these calls.</p>
              )}
            </section>
          </div>

          {!agentOnly && (
            <section className="csSection" aria-labelledby="csAgents">
              <header className="csSectionHead">
                <h2 id="csAgents">By agent</h2>
                <p>The agent that keeps callers waiting most comes first.</p>
              </header>
              <table className="csTable">
                <thead>
                  <tr>
                    <th scope="col">Agent</th>
                    <th scope="col">Calls</th>
                    <th scope="col">Typical wait</th>
                    <th scope="col">9 out of 10 within</th>
                    <th scope="col">On target ({target} s)</th>
                    <th scope="col">Longest part</th>
                    <th scope="col">
                      <span className="srOnly">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...perAgent]
                    .sort((a, b) => (a.summary.speed.within ?? 2) - (b.summary.speed.within ?? 2) || (b.summary.speed.p50 ?? -1) - (a.summary.speed.p50 ?? -1))
                    .map(({ bot, summary }) => {
                      const w = summary.speed.within;
                      const part = mainPart(summary.stages);
                      return (
                        <tr key={bot.id}>
                          <td>
                            <b>{bot.name || bot.id}</b>
                          </td>
                          <td>{data.totals[bot.id] || 0}</td>
                          <td>{seconds(summary.speed.p50)}</td>
                          <td className={summary.speed.p90 !== null && summary.speed.p90 > targetMs ? 'csWarnText' : ''}>{seconds(summary.speed.p90)}</td>
                          <td>
                            {w === null ? (
                              <span className="stMuted">–</span>
                            ) : (
                              <span className={`csMini ${summary.verdict}`}>
                                <span className="csMeterTrack" aria-hidden="true">
                                  <i style={{ width: `${Math.round(w * 100)}%` }} />
                                </span>
                                {pct(w)}
                              </span>
                            )}
                          </td>
                          <td>
                            {part ? (
                              <span className="csStageName">
                                <i className={`csSwatch csSeg-${part.id}`} aria-hidden="true" />
                                {part.label}
                              </span>
                            ) : (
                              <span className="stMuted">–</span>
                            )}
                          </td>
                          <td>
                            {onOpenAgent && (
                              <button type="button" className="linkButton" onClick={() => onOpenAgent(bot.id, 'speed')}>
                                Open
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
