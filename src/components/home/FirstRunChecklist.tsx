import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightIcon, CheckCircle2Icon, CircleAlertIcon, CircleIcon, SparklesIcon, XIcon } from 'lucide-react';
import type { Agent } from '../../types/studio';
import type { AgentReadiness } from '../../hooks/useReadiness';
import { useAuth } from '../../contexts/AuthContext';
import { currentDeployments } from '../../utils/agentStatus';
import { cn } from '../../utils/styles';

interface FirstRunChecklistProps {
  /** The most recently edited agent and its readiness; left out when there is no agent yet. */
  agent?: Agent;
  state?: AgentReadiness;
  onOpenCreate: () => void;
  onDismiss: () => void;
}

/** Create, test, publish, deploy: four cards for the focus agent, read from the same readiness model as its own pages. */
export function FirstRunChecklist({ agent, state, onOpenCreate, onDismiss }: FirstRunChecklistProps) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const go = (stage: string) => agent && navigate(`/agents/${encodeURIComponent(agent.id)}/${stage}`);

  const tested = state?.ship.steps.find((s) => s.id === 'tested');
  const testBlocked = tested?.state === 'blocked';
  const hasPublished = !!agent && agent.versions.length > 0;
  const hasDeployed = !!agent && Object.values(currentDeployments(agent)).some(Boolean);

  const steps = [
    {
      id: 'create',
      title: '1. Create an agent',
      desc: 'Start from a ready-made agent, or describe what you need in your own words.',
      completed: !!agent,
      blocked: false,
      cta: 'Create agent',
      action: onOpenCreate,
    },
    {
      id: 'test',
      title: '2. Have a test conversation',
      desc: testBlocked && tested ? tested.text : 'Talk to the draft by chat or voice, and see each step it takes.',
      completed: tested?.state === 'done',
      blocked: testBlocked,
      cta: 'Open Test',
      action: () => go('test'),
    },
    {
      id: 'publish',
      title: '3. Publish a version',
      desc: 'Keep the draft as a numbered version that can’t change, once its checks pass.',
      completed: hasPublished,
      blocked: false,
      cta: 'Publish',
      action: () => go('release'),
    },
    {
      id: 'deploy',
      title: '4. Put it live',
      desc: 'Deploy a version to Development, Staging or Production, and roll back in one step.',
      completed: hasDeployed,
      blocked: false,
      cta: 'Deploy to Staging',
      action: () => go('release'),
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  const percent = Math.round((completedCount / steps.length) * 100);

  return (
    <section
      aria-labelledby="first-run-heading"
      className="relative rounded-xl border border-line bg-surface p-6 shadow-sm"
    >
      <button
        type="button"
        onClick={onDismiss}
        className="absolute top-4 right-4 p-1 text-muted hover:text-ink rounded-lg transition-colors"
        title="Hide checklist"
        aria-label="Hide onboarding checklist"
      >
        <XIcon className="h-4 w-4" />
      </button>

      <div className="flex flex-wrap items-center justify-between gap-4 pr-8">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white">
              <SparklesIcon className="h-3 w-3" aria-hidden />
            </span>
            <h2 id="first-run-heading" className="text-base font-semibold text-ink">
              Getting started
            </h2>
          </div>
          <p className="mt-1 text-xs text-ink-soft">
            Four steps to create, test and release your first agent.
          </p>
        </div>

        <div className="text-right">
          <span className="text-xs font-semibold text-ink">
            {completedCount} of {steps.length} completed
          </span>
          <div className="mt-1 h-2 w-32 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-accent transition-all duration-300" style={{ width: `${percent}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step) => (
          <div
            key={step.id}
            className={cn(
              'flex flex-col justify-between rounded-lg border p-3.5 transition-colors',
              step.completed
                ? 'border-success/30 bg-success-soft/30'
                : step.blocked
                  ? 'border-danger/30 bg-surface'
                  : 'border-line bg-surface hover:border-line-strong'
            )}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ink">{step.title}</span>
                {step.completed ? (
                  <CheckCircle2Icon className="h-4 w-4 shrink-0 text-success" aria-label="Done" />
                ) : step.blocked ? (
                  <CircleAlertIcon className="h-4 w-4 shrink-0 text-danger" aria-label="Needs fixing" />
                ) : (
                  <CircleIcon className="h-4 w-4 shrink-0 text-muted" aria-label="To do" />
                )}
              </div>
              <p className={cn('mt-1 text-[11px] leading-relaxed', step.blocked ? 'text-danger' : 'text-ink-soft')}>{step.desc}</p>
            </div>

            <div className="mt-3 border-t border-line/60 pt-2">
              <button
                type="button"
                onClick={step.action}
                disabled={!can('edit') || (step.id !== 'create' && !agent)}
                className="flex items-center gap-1 text-xs font-medium text-accent hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
              >
                {step.cta}
                <ArrowRightIcon className="h-3 w-3" aria-hidden />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
