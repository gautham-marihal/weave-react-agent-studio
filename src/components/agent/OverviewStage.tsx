import React, { useMemo } from 'react';
import type { DraftEditor } from '../../hooks/useDraftEditor';
import type { AgentReadiness } from '../../hooks/useReadiness';
import { Link } from 'react-router-dom';
import { AlertCircleIcon, CheckIcon, ChevronRightIcon } from 'lucide-react';
import { ProgressRing, ReadinessChecklist, ShipStrip } from './Readiness';
import { useSetupOpen } from '../../hooks/useStepLink';
import { readProgress } from '../../utils/setupProgress';
import { useMonitoring } from '../../hooks/useMonitoring';
import { analyse, callLength, changeWords } from '../../models/monitor';
import { seconds } from '../../models/speed';
import { buildParts, type PartState } from '../../models/overviewParts';
import { periodOf, newestFirst } from '../../models/callData';
import { targetPath } from '../../models/agentPages';
import { callChannel, callOutcome } from '../../utils/callRecords';
import { currentDeployments, environments, envLabel } from '../../utils/agentStatus';
import { agentPath, callPath } from '../../utils/routes';
import { timeAgo } from '../../utils/format';
import { cn } from '../../utils/styles';
import { StatusChip } from '../ui/StatusChip';
import { AgentAlerts } from '../insights/AgentAlerts';
import { Card, Skeleton, StatTile } from '../insights/parts';

interface OverviewStageProps {
  editor: DraftEditor;
  state: AgentReadiness;
  onPublish: () => void;
}

const DAYS = 7;
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`);
const callWord = (n: number) => `${n} call${n === 1 ? '' : 's'}`;
const OUTCOME_WORDS = { resolved: 'Resolved', handed_over: 'Handed over', cut_off: 'Cut off', in_progress: 'In progress' } as const;
const CHANNEL_WORDS = { phone: 'Phone', web_chat: 'Web chat', web_voice: 'Web voice' } as const;

// This week's calls against the week before, in words ("Down from 12 the week before"), never a bare "-4".
const comparedWithBefore = (now: number, before: number) => changeWords(now, before, 'the week before') || (now ? 'None the week before' : 'None the week before either');

// Calls passed to a person, as a count: two rounded percentages (88% handled, 13% passed on) may not add up to 100.
function passedOnText(calls: number, handoffRate: number | null) {
  const passed = Math.round((handoffRate || 0) * calls);
  if (!passed) return 'None passed to a person';
  return `${passed} of ${callWord(calls)} passed to a person`;
}

const PART_MARK: Record<PartState, { className: string; label: string }> = {
  done: { className: 'bg-success-soft text-success', label: 'Set up' },
  todo: { className: 'bg-subtle text-muted', label: 'To do' },
  attention: { className: 'bg-danger-soft text-danger', label: 'Needs a look' },
  optional: { className: 'bg-subtle text-muted', label: 'Optional' },
};

/** The agent's first page: how far it is from live, every step, its week in numbers, where it runs and its latest calls. */
export function OverviewStage({ editor, state, onPublish }: OverviewStageProps) {
  const agent = editor.agent;
  const setupOpen = useSetupOpen(agent?.id ?? '');
  const agentId = agent?.id ?? '';
  const bots = useMemo(() => (agentId ? [{ id: agentId, name: agent?.name ?? agentId }] : []), [agentId, agent?.name]);
  const data = useMonitoring({ bots, days: DAYS, cap: 200 });
  const report = useMemo(() => analyse({ calls: data.calls, samples: data.samples, bots, nowMs: data.nowMs, days: DAYS }), [data.calls, data.samples, bots, data.nowMs]);
  const recent = useMemo(() => newestFirst(data.calls.filter((c) => Date.parse(c.started_at) >= periodOf(data.nowMs, DAYS).startMs)).slice(0, 5), [data.calls, data.nowMs]);
  const parts = useMemo(() => buildParts(editor.config, editor.validationView.report?.errors ?? []), [editor.config, editor.validationView.report]);
  if (!agent) return null;
  const { readiness, ship } = state;
  const checking = editor.validationView.status !== 'checked' || state.facts?.loading || !state.facts;
  const current = currentDeployments(agent);
  const live = Object.keys(current).length > 0;
  const { totals, previous, series } = report;
  const reading = data.loading && !data.calls.length;
  const partsDone = parts.filter((p) => p.state === 'done').length;

  const stats = (
    <section aria-label={`The last ${DAYS} days`} className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="overview-stats">
      <StatTile
        label={`Calls · last ${DAYS} days`}
        loading={reading}
        value={totals.calls}
        sub={comparedWithBefore(totals.calls, previous.calls)}
        series={series}
        to={agentPath(agent.id, 'monitor')}
      />
      <StatTile
        label="Handled without a person"
        loading={reading}
        value={totals.calls ? pct(1 - (totals.handoffRate || 0)) : '–'}
        sub={totals.calls ? passedOnText(totals.calls, totals.handoffRate) : 'No calls yet'}
        to={agentPath(agent.id, 'monitor/health')}
      />
      <StatTile
        label="Typical answer time"
        loading={reading || (data.sampling && totals.waitP50 === null)}
        value={seconds(totals.waitP50)}
        sub={totals.waitP90 !== null ? `1 in 10 over ${seconds(totals.waitP90)}` : 'No answers timed yet'}
        to={agentPath(agent.id, 'monitor/speed')}
      />
      <StatTile
        label="Cut off"
        loading={reading}
        value={totals.calls ? pct(totals.cutOffRate) : '–'}
        sub={totals.calls ? (totals.cutOff ? `${callWord(totals.cutOff)} stopped without an ending` : 'None stopped without an ending') : 'No calls yet'}
        tone={(totals.cutOffRate ?? 0) > 0.1 ? 'danger' : undefined}
        to={agentPath(agent.id, 'monitor/health')}
      />
    </section>
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6 lg:px-10">
      <section aria-labelledby="ready-title" className="flex flex-wrap items-center gap-5">
        <ProgressRing done={readiness.done} total={readiness.total} size={64} label={`${readiness.done} of ${readiness.total} steps done`} />
        <div className="min-w-0 flex-1">
          {setupOpen &&
          <Link to={`/agents/${encodeURIComponent(agent.id)}/setup/${readProgress(agent.id).step || 'purpose'}`} className="float-right inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              {readProgress(agent.id).known ? 'Continue setup' : 'Set it up step by step'}
            </Link>
          }
          <h2 id="ready-title" className="text-lg font-semibold tracking-tight text-ink">Getting it ready</h2>
          <p className="mt-0.5 text-sm text-muted">
            {readiness.done} of {readiness.total} steps done.{' '}
            {readiness.next ? <>Next: <span className="font-medium text-ink">{readiness.next.label}</span>.</> : 'Everything is done.'}
            {checking && <span className="ml-1 text-xs">Still reading the checks and tests from the server…</span>}
          </p>
        </div>
      </section>

      <div className="mt-6 empty:hidden">
        <AgentAlerts botId={agent.id} />
      </div>

      {/* once it is live the numbers lead; until then the build comes first (an agent nobody can reach has no numbers worth reading) */}
      {live && <div className="mt-6">{stats}</div>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <ReadinessChecklist agentId={agent.id} readiness={readiness} />

          {parts.length > 0 && (
            <Card title="Build" lead={`${partsDone} of ${parts.length} parts set up. The optional ones can wait; open any part to change it.`}>
              <ol className="divide-y divide-line" data-testid="overview-build-parts">
                {parts.map((part) => (
                  <li key={part.id} data-part={part.id} data-state={part.state}>
                    <Link
                      to={targetPath(agent.id, { stage: 'build', section: part.id })}
                      title={part.purpose}
                      className="group flex items-center gap-3 py-2.5 first:pt-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    >
                      <span aria-hidden className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', PART_MARK[part.state].className)}>
                        {part.state === 'done' ? <CheckIcon className="h-3.5 w-3.5" /> : part.state === 'attention' ? <AlertCircleIcon className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-medium text-ink group-hover:text-accent">
                          {part.label}
                          {part.state === 'optional' && <span className="text-xs font-normal text-muted">optional</span>}
                          <span className="sr-only">: {PART_MARK[part.state].label}</span>
                        </span>
                        <span className="block truncate text-xs text-muted">{part.status}</span>
                      </span>
                      <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          <Card
            title="Where it runs"
            action={
              <Link to={agentPath(agent.id, 'release')} className="text-xs font-medium text-accent hover:underline">
                Releases
              </Link>
            }
          >
            <ul className="space-y-2" data-testid="overview-where">
              {environments.map((env) => (
                <li key={env} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-ink-soft">{envLabel(env)}</span>
                  {current[env] ? (
                    <StatusChip tone={env === 'production' ? 'accent' : 'success'} dot>
                      <span className="font-mono">v{current[env]?.version}</span>
                    </StatusChip>
                  ) : (
                    <span className="text-xs text-muted">Not running</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">{agent.versions[0] ? `The newest published version is v${agent.versions[0].version}.` : 'Nothing is published yet.'}</p>
          </Card>

          <Card
            title="Latest calls"
            action={
              <Link to={agentPath(agent.id, 'monitor')} className="text-xs font-medium text-accent hover:underline">
                All calls
              </Link>
            }
          >
            {!recent.length && data.loading ? (
              <div className="space-y-3" role="status" aria-label="Reading the calls">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : recent.length ? (
              <ul className="divide-y divide-line" data-testid="overview-calls">
                {recent.map((c) => {
                  const outcome = OUTCOME_WORDS[callOutcome(c.status, c.handoffs || 0)];
                  return (
                    <li key={c.id}>
                      <Link to={callPath(c.bot, c.id)} className="flex items-center gap-3 py-2 text-sm first:pt-0 hover:text-accent">
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-ink">{CHANNEL_WORDS[callChannel(c.channel)]}</span>
                          <span className="block text-xs text-muted">
                            {outcome} · {callLength(c.duration_s) || '–'}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted">{timeAgo(c.started_at)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                No calls in the last {DAYS} days.{' '}
                <Link to={agentPath(agent.id, 'test')} className="font-medium text-accent hover:underline">
                  Test it
                </Link>{' '}
                and the conversation shows up here.
              </p>
            )}
          </Card>
        </div>
      </div>

      {!live && <div className="mt-6">{stats}</div>}

      <div className="mt-8">
        <ShipStrip agentId={agent.id} ship={ship} onSave={() => void editor.save()} onPublish={onPublish} />
      </div>
    </div>);

}
