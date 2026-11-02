import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangleIcon, ArrowRightIcon, CheckCircle2Icon, ClockIcon, RefreshCwIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { useSpeedData, PER_AGENT } from '../../hooks/useMonitoring';
import { groupAdvice, mainPart, seconds, settingTarget, summarize, timeRange } from '../../models/speed';
import { humanize } from '../../models/callData';
import { targetPath } from '../../models/agentPages';
import { agentPath, callPath } from '../../utils/routes';
import { cn } from '../../utils/styles';
import { Card, Notice, SmallSelect, Skeleton, Th } from './parts';
import { DayChart, StageBars } from './SpeedCharts';
import { STAGE_COLOUR } from './stageColours';

// Speed: how long callers wait for answers, where the time goes and what would make it quicker, from the calls. The
// workspace compares agents; an agent's own page (`agentOnly`) shows that one. Read-only; suggestions open the setting.

const PERIODS = [
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
];
const TARGETS = [1, 1.5, 2, 3, 4, 5];
const TARGET_KEY = 'weave_speed_target';
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`);
const clip = (text: string, n = 72) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

const VERDICT = {
  good: { Icon: CheckCircle2Icon, title: 'Callers are answered quickly', tone: 'text-success bg-success-soft' },
  ok: { Icon: ClockIcon, title: 'Most callers are answered quickly', tone: 'text-info bg-info-soft' },
  slow: { Icon: AlertTriangleIcon, title: 'Callers often wait longer than your target', tone: 'text-warning bg-warning-soft' },
  few: { Icon: ClockIcon, title: 'Too few answers to judge yet', tone: 'text-muted bg-subtle' },
} as const;

function readTarget(): number {
  try {
    const v = Number(window.localStorage.getItem(TARGET_KEY) || '2');
    return TARGETS.includes(v) ? v : 2;
  } catch {
    return 2;
  }
}

function Figure({ value, label, sub, tone }: { value: string; label: string; sub?: string; tone?: 'warn' }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5 shadow-panel" data-testid="speed-figure">
      <span className="text-xs font-medium text-muted">{label}</span>
      <strong className={cn('mt-1 block text-2xl font-semibold tracking-tight tabular-nums', tone === 'warn' ? 'text-warning' : 'text-ink')}>{value}</strong>
      {sub && <span className="mt-0.5 block text-xs text-muted">{sub}</span>}
    </div>
  );
}

export function SpeedView({ bots, agentOnly = false }: { bots: { id: string; name: string }[]; agentOnly?: boolean }) {
  const [days, setDays] = useState(14);
  const [target, setTargetState] = useState(readTarget);
  const setTarget = (v: number) => {
    setTargetState(v);
    try {
      window.localStorage.setItem(TARGET_KEY, String(v));
    } catch {
      /* kept for this page only */
    }
  };
  const targetMs = target * 1000;
  const data = useSpeedData(bots, { days });
  const names: Record<string, string> = Object.fromEntries(bots.map((b) => [b.id, b.name || b.id]));

  const all = useMemo(
    () => summarize({ samples: data.samples, totalCalls: Object.values(data.totals).reduce((a, b) => a + b, 0), targetMs, days, nowMs: data.at }),
    [data.samples, data.totals, targetMs, days, data.at]
  );
  const perAgent = useMemo(
    () => bots.map((b) => ({ bot: b, summary: summarize({ samples: data.samples.filter((s) => s.bot === b.id), totalCalls: data.totals[b.id] || 0, targetMs }) })),
    [bots, data.samples, data.totals, targetMs]
  );
  // what would help, biggest first; on the workspace each is said once, with the agents it concerns listed under it
  const advice = useMemo(
    () => groupAdvice(agentOnly ? [{ bot: bots[0]?.id ?? '', advice: all.advice }] : perAgent.map(({ bot, summary }) => ({ bot: bot.id, advice: summary.advice }))),
    [agentOnly, bots, all, perAgent]
  );
  const settingLink = (botId: string, path: string[]) => targetPath(botId, settingTarget(path));

  const empty = !data.loading && all.sampled === 0;
  const period = (PERIODS.find((p) => p.value === days)?.label ?? '').toLowerCase();
  const verdict = VERDICT[all.verdict];
  const s = all.speed;
  const subject = agentOnly ? bots[0]?.name || 'This agent' : 'Your agents';
  const hasStages = Object.keys(all.stages).length > 0;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          How long callers wait for {agentOnly ? `${bots[0]?.name || 'this agent'}’s` : 'your agents’'} answers, where the time goes, and what would make them quicker. Worked out from
          the calls; nothing is changed.
        </p>
        <div className="flex flex-wrap items-center gap-3" role="group" aria-label="What to show">
          <SmallSelect label="Period" value={days} options={PERIODS} onChange={setDays} />
          <span title="An answer within this many seconds counts as quick. Kept in this browser.">
            <SmallSelect
              label="Target"
              srLabel="Target answer time, in seconds"
              value={target}
              options={TARGETS.map((t) => ({ value: t, label: `Within ${t} s` }))}
              onChange={setTarget}
            />
          </span>
          <Button variant="ghost" size="sm" onClick={data.refresh} disabled={data.loading}>
            <RefreshCwIcon className={cn('h-3.5 w-3.5', data.loading && 'animate-spin')} aria-hidden />
            {data.loading ? 'Reading…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {data.errors.map((e) => (
          <Notice key={e.botId || e.message} tone="danger" title={e.botId ? `The calls of ${names[e.botId] || e.botId} couldn’t be read` : 'The calls couldn’t be read'}>
            {e.message}
          </Notice>
        ))}
        {/* calls whose records the server wouldn't give are left out, and said, so the numbers aren't taken for all */}
        {data.failed > 0 && !data.loading && (
          <Notice tone="warning" title={`${data.failed} call${data.failed === 1 ? '' : 's'} couldn’t be read`}>
            {all.sampled ? 'They are left out of the numbers below.' : 'So there is nothing to time yet.'} Refresh to try again.
          </Notice>
        )}
      </div>

      {data.first ? (
        // the page's own shape while the calls are read, so nothing jumps when the numbers arrive
        <div className="mt-4 space-y-4" role="status" aria-label="Reading the calls">
          <div className="flex items-center gap-4 rounded-xl border border-line bg-surface p-5">
            <Skeleton className="h-10 w-10 rounded-full" />
            <span className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-4/5" />
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-line bg-surface p-4">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="mt-2 h-6 w-1/3" />
              </div>
            ))}
          </div>
        </div>
      ) : empty && data.failed ? null : empty ? (
        <div className="mt-4 rounded-xl border border-line bg-surface px-6 py-14 text-center">
          <ClockIcon className="mx-auto h-6 w-6 text-muted" aria-hidden />
          <p className="mt-2 text-base font-medium text-ink">No calls to work it out from</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-muted">
            Once {agentOnly ? 'this agent has' : 'your agents have'} had calls in the {period}, this shows how long callers wait for answers. A conversation in Test is a call too.
          </p>
        </div>
      ) : (
        // while the calls are read again the page keeps what it showed, dimmed
        <div className={cn('mt-4 space-y-6 transition-opacity', data.loading && 'opacity-60')} aria-busy={data.loading || undefined} data-testid="speed-body" data-reading={data.loading ? 'yes' : 'no'}>
          <section aria-label="How quickly callers are answered" className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-surface p-5 shadow-panel" data-testid="speed-verdict">
            <span aria-hidden className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', verdict.tone)}>
              <verdict.Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-ink">{verdict.title}</h2>
              <p className="mt-0.5 text-sm text-ink-soft">
                {all.verdict === 'few'
                  ? `${s.answers ? `Only ${s.answers} answer${s.answers === 1 ? ' was' : 's were'} timed` : 'No answers were timed'} in the ${period}. The more calls ${agentOnly ? 'it has' : 'they have'}, the surer this is.`
                  : `${pct(s.within)} of answers came within your ${target} s target. Callers usually waited about ${seconds(s.p50)}, and 9 out of 10 answers came within ${seconds(s.p90)}.`}
              </p>
              <p className="mt-1 text-xs text-muted">
                {subject}, {all.sampled} call{all.sampled === 1 ? '' : 's'} and {s.answers} answer{s.answers === 1 ? '' : 's'} in the {period}
                {all.totalCalls > all.sampled + data.failed ? ` (${PER_AGENT} calls of each agent, spread over the days, out of ${all.totalCalls})` : ''}.
              </p>
            </div>
            {s.within !== null && (
              <div className="w-40 shrink-0" role="img" aria-label={`${pct(s.within)} of answers within ${target} seconds`}>
                <strong className="block text-2xl font-semibold tabular-nums text-ink" data-testid="speed-within">
                  {pct(s.within)}
                </strong>
                <span className="mt-1 block h-2 overflow-hidden rounded-full bg-subtle">
                  <i className={cn('block h-full rounded-full', all.verdict === 'slow' ? 'bg-warning' : 'bg-success')} style={{ width: `${Math.round(s.within * 100)}%` }} />
                </span>
                <span className="mt-1 block text-xs text-muted">within {target} s</span>
              </div>
            )}
          </section>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Figure value={seconds(s.p50)} label="Typical wait" sub="how long a caller usually waits" />
            <Figure value={seconds(s.p90)} label="9 out of 10 answers within" sub="the rest took longer than this" tone={s.p90 !== null && s.p90 > targetMs ? 'warn' : undefined} />
            <Figure value={seconds(s.max)} label="Longest wait" sub={s.slowest[0]?.say ? `answering “${clip(s.slowest[0].say, 34)}”` : 'the slowest answer'} />
            <Figure value={seconds(s.ttftP50)} label="AI model starts in" sub={s.ttftP50 !== null ? 'how long the AI usually takes to begin an answer' : 'these calls don’t record it'} />
          </div>

          <Card title="Day by day" lead="How long callers usually waited each day, compared with your target. Point at a day to see its numbers.">
            {all.days.some((d) => d.n) ? <DayChart days={all.days} targetMs={targetMs} /> : <p className="text-sm text-muted">No answers to show day by day.</p>}
          </Card>

          <Card title="Where the wait goes" lead="An answer’s wait, part by part, on average. Voice calls have more parts than chats: the caller has to finish speaking, and the answer is spoken.">
            {hasStages ? <StageBars stages={all.stages} /> : <p className="text-sm text-muted">These calls don’t record the parts of their waits.</p>}
          </Card>

          <Card title="What would make answers quicker" lead="Based on where the wait goes. Each suggestion opens the setting to change.">
            {advice.length ? (
              <ul className="divide-y divide-line" data-testid="speed-advice">
                {advice.map((a) => {
                  const one = a.agents.length === 1 ? a.agents[0] : null;
                  return (
                    <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink">
                          {!agentOnly && one && <span className="mr-1.5 text-xs font-normal text-muted">{names[one.bot] || one.bot}</span>}
                          {one ? a.title : `${a.lead} ${timeRange(a.agents.map((g) => g.ms))}${a.tail}`}
                        </p>
                        <p className="mt-0.5 text-sm text-ink-soft">{one ? a.why : a.whyAll || a.why}</p>
                        {!one && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                            <span>{a.action}:</span>
                            {a.agents.map((g) => (
                              <Link
                                key={g.bot}
                                to={settingLink(g.bot, g.path)}
                                aria-label={`${a.action} for ${names[g.bot] || g.bot}`}
                                className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-medium text-ink hover:bg-subtle"
                              >
                                {names[g.bot] || g.bot}
                                <span className="tabular-nums text-muted">{seconds(g.ms)}</span>
                                <ArrowRightIcon className="h-3 w-3" aria-hidden />
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                      {one && (
                        <Link
                          to={settingLink(one.bot, one.path)}
                          aria-label={agentOnly ? a.action : `${a.action} for ${names[one.bot] || one.bot}`}
                          className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-accent hover:underline"
                        >
                          {a.action}
                          <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden />
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : all.verdict === 'good' && hasStages ? (
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2Icon className="h-4 w-4" aria-hidden />
                Nothing stands out: each part of the wait is within the usual range.
              </p>
            ) : (
              <p className="text-sm text-muted">
                {all.verdict === 'few'
                  ? 'Too few answers to suggest a change yet.'
                  : !hasStages
                    ? 'These calls don’t record the parts of their waits, so there is nothing to point at yet.'
                    : 'No one part stands out enough to suggest a change. The slowest answers below show where their time went.'}
              </p>
            )}
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="The slowest answers" lead="What the caller had said, and the part that took longest.">
              {s.slowest.length ? (
                <ul className="divide-y divide-line" data-testid="speed-slowest">
                  {s.slowest.map((w) => (
                    <li key={`${w.callId}|${w.ms}|${w.say}`} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                      <b className={cn('w-14 shrink-0 text-sm font-semibold tabular-nums', w.ms > targetMs ? 'text-warning' : 'text-ink')}>{seconds(w.ms)}</b>
                      <span className="min-w-0 flex-1 text-sm text-ink-soft">
                        “{clip(w.say || '…')}”
                        <span className="mt-0.5 block text-xs text-muted">
                          {[!agentOnly && (names[w.bot] || w.bot), w.voice ? 'Voice call' : 'Chat', w.cause && `mostly ${w.cause.label.toLowerCase()}`].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <Link to={callPath(w.bot, w.callId)} className="shrink-0 text-xs font-medium text-accent hover:underline">
                        Open the call
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">None of these calls has an answer to time yet.</p>
              )}
            </Card>

            <Card title="Tools and your systems" lead="What the agent waited on while answering: how often, how long it took, and how often it failed.">
              {all.systems.length ? (
                <div className="-mx-2 overflow-x-auto">
                  <table className="w-full min-w-[440px] text-sm">
                    <thead>
                      <tr className="border-b border-line">
                        <Th>Name</Th>
                        <Th>Uses</Th>
                        <Th>Typical time</Th>
                        <Th>Longest</Th>
                        <Th>Failed</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {all.systems.slice(0, 8).map((t) => (
                        <tr key={`${t.kind}:${t.name}`} className="border-b border-line last:border-0">
                          <td className="px-3 py-2">
                            <span className="block font-medium text-ink" title={t.name}>
                              {humanize(t.name) || t.name}
                            </span>
                            <span className="block text-xs text-muted">{t.kind === 'request' ? 'your system' : 'tool'}</span>
                          </td>
                          <td className="px-3 py-2 tabular-nums">{t.n}</td>
                          <td className={cn('px-3 py-2 tabular-nums', t.p50 >= 700 && 'font-medium text-warning')}>{seconds(t.p50)}</td>
                          <td className="px-3 py-2 tabular-nums">{seconds(t.max)}</td>
                          <td className={cn('px-3 py-2 tabular-nums', t.failed ? 'font-medium text-danger' : 'text-muted')}>
                            {t.failed ? `${t.failed} of ${t.n}` : 'none'}
                            {t.retried ? <span className="block text-xs font-normal text-muted">{t.retried} retried</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted">No tools or requests to your systems in these calls.</p>
              )}
            </Card>
          </div>

          {!agentOnly && (
            <Card title="By agent" lead="The agent that keeps callers waiting most comes first." id="speed-agents">
              <div className="-mx-2 overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <Th>Agent</Th>
                      <Th>Calls</Th>
                      <Th>Typical wait</Th>
                      <Th>9 out of 10 within</Th>
                      <Th>On target ({target} s)</Th>
                      <Th>Longest part</Th>
                      <Th>
                        <span className="sr-only">Open</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...perAgent]
                      .sort((a, b) => (a.summary.speed.within ?? 2) - (b.summary.speed.within ?? 2) || (b.summary.speed.p50 ?? -1) - (a.summary.speed.p50 ?? -1))
                      .map(({ bot, summary }) => {
                        const w = summary.speed.within;
                        const part = mainPart(summary.stages);
                        return (
                          <tr key={bot.id} className="border-b border-line last:border-0">
                            <td className="px-3 py-2.5 font-medium text-ink">{bot.name || bot.id}</td>
                            <td className="px-3 py-2.5 tabular-nums">{data.totals[bot.id] || 0}</td>
                            <td className="px-3 py-2.5 tabular-nums">{seconds(summary.speed.p50)}</td>
                            <td className={cn('px-3 py-2.5 tabular-nums', summary.speed.p90 !== null && summary.speed.p90 > targetMs && 'font-medium text-warning')}>
                              {seconds(summary.speed.p90)}
                            </td>
                            <td className="px-3 py-2.5">
                              {w === null ? (
                                <span className="text-muted">–</span>
                              ) : (
                                <span className="flex items-center gap-2 tabular-nums">
                                  <span aria-hidden className="block h-1.5 w-16 overflow-hidden rounded-full bg-subtle">
                                    <i className={cn('block h-full', summary.verdict === 'slow' ? 'bg-warning' : 'bg-success')} style={{ width: `${Math.round(w * 100)}%` }} />
                                  </span>
                                  {pct(w)}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              {part ? (
                                <span className="flex items-center gap-1.5 text-ink-soft">
                                  <i aria-hidden className={cn('h-2.5 w-2.5 rounded-sm', STAGE_COLOUR[part.id])} />
                                  {part.label}
                                </span>
                              ) : (
                                <span className="text-muted">–</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <Link to={agentPath(bot.id, 'monitor/speed')} className="text-xs font-medium text-accent hover:underline">
                                Open<span className="sr-only"> {bot.name}</span>
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
