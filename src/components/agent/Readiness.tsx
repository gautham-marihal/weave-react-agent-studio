import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightIcon, CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, CircleIcon } from 'lucide-react';
import type { Readiness, ReadinessStep, StepState } from '../../models/readiness';
import type { ShipAction, ShipFlow } from '../../models/shipFlow';
import { targetPath, type PageTarget } from '../../models/agentPages';
import { Button } from '../ui/Button';
import { useStepLink } from '../../hooks/useStepLink';
import { cn } from '../../utils/styles';

/** A ring that fills as steps are done. */
export function ProgressRing({ done, total, size = 36, label }: { done: number; total: number; size?: number; label?: string }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const part = total ? done / total : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `${done} of ${total} done`} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-line" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${c * part} ${c}`}
        className={cn('transition-[stroke-dasharray] duration-300', part === 1 ? 'stroke-success' : 'stroke-accent')} />
    </svg>);

}

const STATE_WORDS: Record<StepState, string> = { done: 'Done', todo: 'To do', blocked: 'Needs fixing', optional: 'Optional' };

export function StepIcon({ state, className }: { state: StepState; className?: string }) {
  const cls = cn('h-4 w-4 shrink-0', className);
  if (state === 'done') return <CircleCheckIcon className={cn(cls, 'text-success')} aria-label={STATE_WORDS.done} />;
  if (state === 'blocked') return <CircleAlertIcon className={cn(cls, 'text-danger')} aria-label={STATE_WORDS.blocked} />;
  if (state === 'optional') return <CircleDashedIcon className={cn(cls, 'text-muted')} aria-label={STATE_WORDS.optional} />;
  return <CircleIcon className={cn(cls, 'text-muted')} aria-label={STATE_WORDS.todo} />;
}

function useGo(agentId: string) {
  const navigate = useNavigate();
  const link = useStepLink(agentId);
  return { step: (s: ReadinessStep) => navigate(link(s)), target: (t: PageTarget) => navigate(targetPath(agentId, t)) };
}

/** "Getting it ready": the progress ring and the one next step (the agent header's card). */
export function ReadinessCard({ agentId, readiness }: { agentId: string; readiness: Readiness }) {
  const go = useGo(agentId);
  const { next, done, total } = readiness;
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
      <ProgressRing done={done} total={total} size={30} label={`Getting it ready: ${done} of ${total} done`} />
      <div className="min-w-0">
        <p className="text-[12px] text-muted">Getting it ready · {done} of {total}</p>
        {next ?
        <button
          type="button"
          onClick={() => go.step(next)}
          className={cn('flex max-w-[260px] items-center gap-1 truncate text-left text-[13px] font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded', next.state === 'blocked' ? 'text-danger' : 'text-accent')}
          title={next.text}>
            <span className="truncate">Next: {next.label}</span>
            <ArrowRightIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </button> :

        <p className="text-[13px] font-medium text-success">Ready and live</p>
        }
      </div>
    </div>);

}

/** Every step, with what is known about it and a way to where it is done (Overview, Home). */
export function ReadinessChecklist({ agentId, readiness, compact = false }: { agentId: string; readiness: Readiness; compact?: boolean }) {
  const go = useGo(agentId);
  return (
    <ol className="divide-y divide-line rounded-xl border border-line bg-surface">
      {readiness.steps.map((step) =>
      <ChecklistRow key={step.id} step={step} isNext={readiness.next?.id === step.id} compact={compact} onGo={() => go.step(step)} />
      )}
    </ol>);

}

function ChecklistRow({ step, isNext, compact, onGo }: { step: ReadinessStep; isNext: boolean; compact: boolean; onGo: () => void }) {
  return (
    <li className={cn('flex items-start gap-3 px-4', compact ? 'py-2.5' : 'py-3.5', isNext && 'bg-accent-soft/30')}>
      <StepIcon state={step.state} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
          {step.label}
          {step.state === 'optional' && <span className="text-xs font-normal text-muted">Optional</span>}
          {isNext && <span className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-white">Next</span>}
        </p>
        {!compact && <p className={cn('mt-0.5 text-[13px]', step.state === 'blocked' ? 'text-danger' : 'text-muted')}>{step.text}</p>}
      </div>
      <Button size="sm" variant={isNext ? 'primary' : 'ghost'} onClick={onGo} aria-label={`${step.label}: open`}>
        {step.state === 'done' ? 'View' : 'Open'}
      </Button>
    </li>);

}

/** Saved -> Valid -> Tested -> Published -> Deployed, and the one button for what to do next (Release, Overview). */
export function ShipStrip({ agentId, ship, onSave, onPublish }: { agentId: string; ship: ShipFlow; onSave: () => void; onPublish: () => void }) {
  const go = useGo(agentId);
  const run = (a: ShipAction) => a.kind === 'save' ? onSave() : a.kind === 'publish' ? onPublish() : go.target(a.target);
  return (
    <section aria-labelledby="ship-title" className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ship-title" className="text-sm font-semibold text-ink">On the way to live · {ship.done} of {ship.total}</h2>
        {ship.next?.action ?
        <Button size="sm" variant={ship.next.state === 'blocked' ? 'danger' : 'primary'} onClick={() => ship.next?.action && run(ship.next.action)}>
            {ship.next.action.label}
            <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden />
          </Button> :
        ship.ready ? <span className="text-[13px] font-medium text-success">The newest version is live</span> : null}
      </div>
      <ol className="mt-3 grid gap-2 sm:grid-cols-5">
        {ship.steps.map((s) =>
        <li key={s.id} className={cn('rounded-lg border px-3 py-2.5', ship.next?.id === s.id ? 'border-accent/50 bg-accent-soft/30' : 'border-line')}>
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <StepIcon state={s.state} className="h-3.5 w-3.5" />
              {s.label}
            </p>
            <p className={cn('mt-1 text-xs leading-snug', s.state === 'blocked' ? 'text-danger' : 'text-muted')}>{s.text}</p>
          </li>
        )}
      </ol>
    </section>);

}
