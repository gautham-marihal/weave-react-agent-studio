import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCwIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { StatusChip } from '../ui/StatusChip';
import { useMonitoring } from '../../hooks/useMonitoring';
import { analyse, callLength, changeWords, pct, type DayRow } from '../../models/monitor';
import { seconds } from '../../models/speed';
import { callPath, agentPath } from '../../utils/routes';
import { formatShortDate } from '../../utils/format';
import { cn } from '../../utils/styles';
import { Card, Notice, SmallSelect, Skeleton, Th } from './parts';
import { AgentAlerts } from './AgentAlerts';
import { SandboxNoteSlot } from '../../sandbox/test/SandboxNoteSlot';

// Monitoring: how the agents' calls went over a period: the numbers, calls per day, what needs attention, what goes
// wrong most, per agent and per version. With `agentOnly` it is that one agent's (inside the agent). Read-only.

const PERIODS = [
  { value: 7, label: 'Past 7 days' },
  { value: 14, label: 'Past 14 days' },
  { value: 30, label: 'Past 30 days' },
];

/** A round number to end the axis on: 1, 2, 4, 5, 10, 20, 40, 50, 100 ... */
function niceMax(max: number): number {
  if (max <= 4) return Math.max(2, max % 2 ? max + 1 : max);
  const mag = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 4, 5, 10].map((m) => m * mag).find((m) => m >= max) || max;
}
const dayLabel = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Calls per day: a column per day, cut-off calls in red. Each column's title holds its numbers in words. */
function DayBars({ series }: { series: DayRow[] }) {
  const top = niceMax(Math.max(1, ...series.map((d) => d.calls)));
  const every = series.length > 16 ? 5 : series.length > 8 ? 2 : 1;
  const total = series.reduce((n, d) => n + d.calls, 0);
  const busiest = series.reduce((best, d, i) => (d.calls > series[best].calls ? i : best), 0);
  return (
    <div className="flex gap-2" role="img" aria-label={`Calls per day over the past ${series.length} days: ${total} in all`}>
      <div className="flex h-40 flex-col justify-between pb-5 text-right text-[11px] tabular-nums text-muted" aria-hidden>
        <span>{top}</span>
        <span>{top / 2}</span>
        <span>0</span>
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[140px] flex-col justify-between" aria-hidden>
          <i className="block border-t border-dashed border-line" />
          <i className="block border-t border-dashed border-line" />
          <i className="block border-t border-line-strong" />
        </div>
        <div className="grid h-40 items-end gap-1" style={{ gridTemplateColumns: `repeat(${series.length}, minmax(0, 1fr))` }}>
          {series.map((d, i) => {
            const h = (d.calls / top) * 100;
            const cut = d.calls ? (d.cutOff / d.calls) * 100 : 0;
            return (
              <div
                key={d.day}
                className="flex h-full min-w-0 flex-col items-center justify-end"
                title={`${dayLabel(d.day)}: ${d.calls} ${d.calls === 1 ? 'call' : 'calls'}${d.cutOff ? `, ${d.cutOff} cut off` : ''}${d.handoffs ? `, ${d.handoffs} handed over` : ''}`}
              >
                <div className="relative flex h-[140px] w-full items-end justify-center">
                  {d.calls > 0 && series.length <= 16 && (i === busiest || i === series.length - 1) && (
                    <b className="absolute text-[11px] font-semibold tabular-nums text-ink-soft" style={{ bottom: `calc(${h}% + 2px)` }}>
                      {d.calls}
                    </b>
                  )}
                  {d.calls > 0 && (
                    <div className="flex w-full max-w-[28px] flex-col-reverse overflow-hidden rounded-t bg-accent/70" style={{ height: `${h}%` }}>
                      {cut > 0 && <span className="block w-full bg-danger" style={{ height: `${cut}%` }} />}
                    </div>
                  )}
                </div>
                <span className="mt-1 h-4 truncate text-[10px] text-muted">{i % every === 0 || i === series.length - 1 ? dayLabel(d.day) : ' '}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, note, tone, title }: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: 'bad' | 'warn'; title?: string }) {
  return (
    <div className="min-w-0 px-5 py-4" title={title}>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-1">
        <span className={cn('text-2xl font-semibold tracking-tight tabular-nums', tone === 'bad' ? 'text-danger' : tone === 'warn' ? 'text-warning' : 'text-ink')}>{value}</span>
        {note && <span className="mt-0.5 block text-xs text-muted">{note}</span>}
      </dd>
    </div>
  );
}

export function MonitoringView({ bots, agentOnly = false }: { bots: { id: string; name: string }[]; agentOnly?: boolean }) {
  const [days, setDays] = useState(14);
  // no cap, so it reads the same calls as Speed and the answer time matches Speed's for the period
  const data = useMonitoring({ bots, days });
  const report = useMemo(() => analyse({ calls: data.calls, samples: data.samples, bots, nowMs: data.nowMs, days }), [data.calls, data.samples, bots, data.nowMs, days]);
  const { totals, previous } = report;
  const names: Record<string, string> = Object.fromEntries(bots.map((b) => [b.id, b.name || b.id]));
  const one = agentOnly ? bots[0] : null;
  const empty = !data.loading && data.calls.length === 0 && data.errors.length === 0;
  const reading = data.sampling;
  const agentLink = (id: string, page = '') => agentPath(id, page);

  return (
    <div aria-busy={data.loading || data.refreshing || undefined}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {one ? `How ${one.name} is doing, from the calls it has had.` : 'How your agents are doing, from the calls they have had.'} Everything here is read from the calls; nothing is
          changed.
        </p>
        <div className="flex items-center gap-2">
          <SmallSelect label="Period" value={days} options={PERIODS} onChange={setDays} />
          <Button variant="ghost" size="sm" onClick={data.reload} disabled={data.loading || data.refreshing}>
            <RefreshCwIcon className={cn('h-3.5 w-3.5', (data.loading || data.refreshing) && 'animate-spin')} aria-hidden />
            {data.loading || data.refreshing ? 'Reading…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {!agentOnly && <AgentAlerts />}
        {data.errors.map((e) => (
          <Notice key={e.botId || e.message} tone="danger" title={e.botId ? `The calls of ${names[e.botId] || e.botId} couldn’t be read` : 'The calls couldn’t be read'}>
            {e.message}
          </Notice>
        ))}
        {data.truncated && (
          <Notice title={agentOnly ? 'This agent has more calls than were read' : 'Some agents have more calls than were read'}>
            {agentOnly ? 'The numbers rest on its newest calls.' : 'The numbers rest on the newest calls of each agent.'}
          </Notice>
        )}
        {report.alerts.map((a) => (
          <div key={`${a.bot}/${a.version}`} role="alert" className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-ink">{a.text}</p>
              <ul className="mt-1 list-disc pl-5 text-ink-soft">
                {a.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted">
                Based on {a.calls} calls of v{a.version} and {a.previousCalls} of v{a.previousVersion}. It is a pattern in the numbers, not a verdict: look at the calls.
              </p>
            </div>
            <Link to={`${agentLink(a.bot, 'release')}?deploy=${encodeURIComponent(a.previousVersion)}`} className="text-sm font-medium text-accent hover:underline">
              Roll back to v{a.previousVersion}…
            </Link>
          </div>
        ))}
      </div>

      {data.loading && data.calls.length === 0 && (
        <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3 xl:grid-cols-6" role="status" aria-label="Reading the calls">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-surface px-5 py-4">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="mt-2 h-7 w-16" />
              <Skeleton className="mt-2 h-3 w-3/4" />
            </div>
          ))}
        </div>
      )}

      {empty && (
        <div className="mt-6 rounded-xl border border-line bg-surface px-6 py-14 text-center">
          <p className="text-base font-medium text-ink">No calls to look at yet</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-muted">
            Once {one ? one.name : 'an agent'} has had calls, this shows how many, how they went, and where to look when something is off. A conversation in Test is a call too.
          </p>
          {bots[0] && (
            <Link to={agentLink(bots[0].id, 'test')} className="mt-4 inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-4 text-sm font-medium text-ink shadow-sm hover:bg-subtle">
              Test {bots[0].name}
            </Link>
          )}
        </div>
      )}

      {!empty && data.calls.length > 0 && (
        <div className={cn('mt-6 space-y-6 transition-opacity', data.refreshing && 'opacity-60')}>
          <section aria-label="The numbers" className="rounded-xl border border-line bg-surface shadow-panel">
            <dl className="grid grid-cols-2 divide-line md:grid-cols-3 xl:grid-cols-6 xl:divide-x">
              <Kpi label="Calls" value={totals.calls} note={changeWords(totals.calls, previous.calls) || `in ${days} days`} />
              <Kpi
                label="Handed over"
                value={pct(totals.handoffRate)}
                note="of calls went to another agent or a person"
                title="The share of calls in which the agent handed the caller to another agent or a person."
              />
              <Kpi label="Cut off" value={pct(totals.cutOffRate)} tone={(totals.cutOffRate ?? 0) > 0.1 ? 'bad' : undefined} note={`${totals.cutOff} ${totals.cutOff === 1 ? 'call' : 'calls'} with no ending`} />
              <Kpi
                label="Time to answer"
                value={seconds(totals.waitP50)}
                note={totals.waitP90 !== null ? `slowest tenth: ${seconds(totals.waitP90)}` : reading ? 'reading the calls…' : 'not enough calls read'}
                tone={(totals.waitP90 ?? 0) > 8000 ? 'warn' : undefined}
              />
              <Kpi
                label="Tools that failed"
                value={pct(totals.toolFailRate)}
                tone={(totals.toolFailRate ?? 0) > 0.1 ? 'bad' : undefined}
                note={totals.toolCalls ? `of ${totals.toolCalls} tool calls` : reading ? 'reading the calls…' : 'no tool calls read'}
              />
              <Kpi label="Average call" value={callLength(totals.avgDurationS) || '—'} note={totals.avgTurns !== null ? `${totals.avgTurns.toFixed(1)} caller turns` : ''} />
            </dl>
          </section>
          <p className="-mt-3 text-xs text-muted">
            Time to answer and failed tools come from {report.sampled} calls whose records were read, spread over the period; the other numbers are from all {totals.calls} calls of the
            period.
          </p>

          <Card
            title="Calls per day"
            action={
              <span className="flex items-center gap-3 text-xs text-muted" aria-hidden>
                <span className="flex items-center gap-1.5">
                  <i className="h-2.5 w-2.5 rounded-sm bg-accent/70" /> Calls
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="h-2.5 w-2.5 rounded-sm bg-danger" /> Cut off
                </span>
              </span>
            }
          >
            <DayBars series={report.series} />
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Needs attention" action={<span className="text-xs text-muted">{report.attention.length} {report.attention.length === 1 ? 'call' : 'calls'}</span>}>
              {report.attention.length === 0 ? (
                <p className="text-sm text-muted">
                  Nothing stands out in {reading ? 'the calls read so far' : 'these calls'}. {reading ? 'Still reading their records…' : ''}
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {report.attention.slice(0, 8).map((a) => (
                    <li key={`${a.bot}/${a.callId}`} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="text-sm">
                          <span className="font-medium text-ink">{a.name}</span>{' '}
                          <span className="text-xs text-muted">
                            {formatShortDate(a.startedAt)}
                            {a.version && a.version !== 'draft' ? ` · v${a.version}` : ''}
                          </span>
                        </p>
                        <ul className="mt-0.5 space-y-0.5 text-xs text-ink-soft">
                          {a.reasons.map((r, i) => (
                            <li key={i} className="flex gap-1.5">
                              <span aria-hidden className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', r.severity >= 3 ? 'bg-danger' : r.severity === 2 ? 'bg-warning' : 'bg-muted')} />
                              {r.text}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <Link to={callPath(a.bot, a.callId)} className="shrink-0 text-xs font-medium text-accent hover:underline">
                        Open
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="What goes wrong most">
              {report.issues.length === 0 ? (
                <p className="text-sm text-muted">No pattern yet.</p>
              ) : (
                <ul className="space-y-3">
                  {report.issues.map((i) => (
                    <li key={i.kind}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-ink">{i.label}</span>
                        <StatusChip tone={i.severity >= 3 ? 'danger' : i.severity === 2 ? 'warning' : 'neutral'}>{i.count}</StatusChip>
                      </div>
                      {i.examples.map((e) => (
                        <p key={e.callId} className="mt-1 text-xs text-ink-soft">
                          <Link to={callPath(e.bot, e.callId)} className="font-medium text-accent hover:underline">
                            {e.name}, {formatShortDate(e.startedAt)}
                          </Link>{' '}
                          {e.detail}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {!agentOnly && (
            <Card title="Agents">
              <div className="-mx-2 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <Th>Agent</Th>
                      <Th>Calls</Th>
                      <Th>Handed over</Th>
                      <Th>Cut off</Th>
                      <Th>Time to answer</Th>
                      <Th>Tools failed</Th>
                      <Th>
                        <span className="sr-only">Open</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.perAgent.map((p) => (
                      <tr key={p.bot} className="border-b border-line last:border-0">
                        <td className="px-3 py-2.5 font-medium text-ink">{p.name}</td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {p.calls}
                          {p.previousCalls && p.previousCalls !== p.calls ? (
                            <span className="ml-1 text-xs text-muted" title={changeWords(p.calls, p.previousCalls)}>
                              was {p.previousCalls}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">{pct(p.handoffRate)}</td>
                        <td className={cn('px-3 py-2.5 tabular-nums', (p.cutOffRate ?? 0) > 0.1 && 'font-medium text-danger')}>{pct(p.cutOffRate)}</td>
                        <td className="px-3 py-2.5 tabular-nums">{seconds(p.waitP50)}</td>
                        <td className={cn('px-3 py-2.5 tabular-nums', (p.toolFailRate ?? 0) > 0.1 && 'font-medium text-danger')}>{pct(p.toolFailRate)}</td>
                        <td className="px-3 py-2.5 text-right">
                          <Link to={agentLink(p.bot, 'monitor/health')} className="text-xs font-medium text-accent hover:underline">
                            Open<span className="sr-only"> {p.name}</span>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {report.versions.length > 0 && (
            <Card title="By version" lead="Newest first; a version needs a few calls before it is compared.">
              <div className="space-y-5">
                {report.versions.map((v) => (
                  <div key={v.bot}>
                    {!agentOnly && <h3 className="mb-1 text-xs font-semibold text-ink-soft">{v.name}</h3>}
                    <div className="-mx-2 overflow-x-auto">
                      <table className="w-full min-w-[560px] text-sm">
                        <thead>
                          <tr className="border-b border-line">
                            <Th>Version</Th>
                            <Th>Calls</Th>
                            <Th>Handed over</Th>
                            <Th>Cut off</Th>
                            <Th>Tools failed</Th>
                            <Th>Last call</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {v.rows.map((r) => (
                            <tr key={r.version} className="border-b border-line last:border-0">
                              <td className="px-3 py-2 font-mono text-[13px] text-ink">v{r.version}</td>
                              <td className="px-3 py-2 tabular-nums">{r.calls}</td>
                              <td className="px-3 py-2 tabular-nums">{pct(r.handoffRate)}</td>
                              <td className={cn('px-3 py-2 tabular-nums', (r.cutOffRate ?? 0) > 0.1 && 'font-medium text-danger')}>{pct(r.cutOffRate)}</td>
                              <td className={cn('px-3 py-2 tabular-nums', (r.toolFailRate ?? 0) > 0.1 && 'font-medium text-danger')}>{pct(r.toolFailRate)}</td>
                              <td className="px-3 py-2 text-muted">{formatShortDate(r.lastSeen)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
      {!empty && data.calls.length > 0 && <SandboxNoteSlot kind="monitoring" className="mt-6" />}
    </div>
  );
}
