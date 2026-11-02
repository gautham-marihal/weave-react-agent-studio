import React from 'react';
import { ArrowRightLeftIcon, CircleCheckIcon } from 'lucide-react';
import type { ReplayComparison } from '../../models/replayCompare';
import type { ToolUse } from '../../models/replayFacts';
import { StatusChip } from '../ui/StatusChip';
import { cn } from '../../utils/styles';

function Said({ lines, empty = 'Said nothing' }: { lines: string[]; empty?: string }) {
  if (!lines.length) return <p className="text-[13px] italic text-muted">{empty}</p>;
  return (
    <>
      {lines.map((text, i) => <p key={i} className="text-[13px] leading-relaxed text-ink">{text}</p>)}
    </>);
}

function Tools({ tools, was }: { tools: ToolUse[]; was?: ToolUse[] }) {
  if (!tools.length) return null;
  const before = was ? new Set(was.map((t) => t.tool)) : null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Tools used">
      {tools.map((t, i) =>
      <li
        key={i}
        className={cn(
          'rounded-md border px-1.5 py-0.5 font-mono text-[11px]',
          t.error ? 'border-danger/30 bg-danger-soft text-danger' : before && !before.has(t.tool) ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line text-ink-soft'
        )}>
          {t.tool}
          {t.handoff && <span className="font-sans"> → hands over to {t.handoff}</span>}
          {t.error && <span className="font-sans"> failed: {t.error}</span>}
        </li>
      )}
    </ul>);
}

/** The call and its replay, turn against turn, with what changed in words above it. */
export function ReplayCompare({ cmp, targetLabel, sourceLabel }: { cmp: ReplayComparison; targetLabel: string; /** Says what played it, when not the runtime. */ sourceLabel?: string }) {
  const same = cmp.verdict === 'same';
  return (
    <div className="space-y-4" data-verdict={cmp.verdict}>
      <section role="status" aria-label="What changed" className={cn('rounded-lg border p-3', same ? 'border-success/30 bg-success-soft/40' : 'border-warning/40 bg-warning-soft/60')}>
        <h4 className="flex items-center gap-2 text-sm font-medium text-ink">
          {same ? <CircleCheckIcon className="h-4 w-4 text-success" aria-hidden /> : <ArrowRightLeftIcon className="h-4 w-4 text-warning" aria-hidden />}
          {same ? 'Nothing changed: the agent does the same things' : `${cmp.lines.length} ${cmp.lines.length === 1 ? 'difference' : 'differences'} from the call`}
        </h4>
        {cmp.lines.length > 0 &&
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px] text-ink-soft">
            {cmp.lines.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        }
        {sourceLabel && <p className="mt-1.5 text-[13px] font-medium text-warning" data-replay-source>{sourceLabel}</p>}
        <p className="mt-1.5 text-xs text-muted">Compared on what the agent did (tools, hand-overs, how it ended) and, more loosely, on what it said: a model never words things the same way twice.</p>
      </section>

      <div role="table" aria-label="The call and its replay" className="overflow-hidden rounded-lg border border-line">
        <div role="row" className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b border-line bg-subtle px-3 py-2 text-xs font-medium text-muted sm:grid">
          <span role="columnheader">The caller</span>
          <span role="columnheader">The call</span>
          <span role="columnheader">{targetLabel}</span>
        </div>
        {(cmp.opening.was.length > 0 || cmp.opening.now.length > 0) &&
        <div role="row" className={cn('grid gap-3 border-b border-line px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]', !cmp.opening.sameWords && 'bg-warning-soft/30')}>
            <p role="cell" className="text-xs italic text-muted">Before the caller speaks</p>
            <div role="cell"><Said lines={cmp.opening.was} /></div>
            <div role="cell"><Said lines={cmp.opening.now} /></div>
          </div>
        }
        {cmp.turns.map((t) =>
        <div key={t.index} role="row" data-turn={t.index + 1} className={cn('grid gap-3 border-b border-line px-3 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]', t.changed && 'bg-warning-soft/30', !t.reached && 'opacity-70')}>
            <div role="cell" className="text-[13px] text-ink">
              <span className="font-medium">Caller:</span> {t.say}
              {t.changed && <StatusChip tone="warning" className="ml-1.5">changed</StatusChip>}
            </div>
            <div role="cell">
              <Said lines={t.original.said} />
              <Tools tools={t.original.tools} />
            </div>
            <div role="cell">
              {t.replay ?
            <>
                  <Said lines={t.replay.said} />
                  <Tools tools={t.replay.tools} was={t.original.tools} />
                </> :
            <p className="text-[13px] italic text-muted">Not reached: the agent had already ended the conversation</p>
            }
            </div>
          </div>
        )}
        <div role="row" className="grid gap-3 border-t border-line bg-subtle/60 px-3 py-2.5 text-[13px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <p role="cell" className="font-medium text-ink">How it ended</p>
          <p role="cell" className="text-ink-soft">{cmp.agent.was ? `“${cmp.agent.was}” in charge` : '—'}{cmp.ended.was ? ', the call ended' : ''}</p>
          <p role="cell" className={cn('text-ink-soft', (cmp.agent.changed || cmp.ended.changed) && 'font-medium text-warning')}>
            {cmp.agent.now ? `“${cmp.agent.now}” in charge` : '—'}{cmp.ended.now ? ', the conversation ended' : ''}
          </p>
        </div>
        {cmp.state.length > 0 &&
        <div role="row" className="grid gap-3 border-t border-line px-3 py-2.5 text-[13px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <p role="cell" className="font-medium text-ink">What it remembered</p>
            <p role="cell" className="break-words font-mono text-xs text-ink-soft">{cmp.state.map((s) => `${s.name} = ${JSON.stringify(s.was ?? null)}`).join(', ')}</p>
            <p role="cell" className="break-words font-mono text-xs text-warning">{cmp.state.map((s) => `${s.name} = ${JSON.stringify(s.now ?? null)}`).join(', ')}</p>
          </div>
        }
      </div>
    </div>);
}
