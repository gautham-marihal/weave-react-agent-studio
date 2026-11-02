// The Agents list's row cells: open the agent's workspace (with its stages), the server's checks, and how far it is
// from ready with its next step.
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2Icon, ChevronDownIcon, ExternalLinkIcon, EyeIcon, PlayIcon, RocketIcon, WrenchIcon } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Tooltip } from '../ui/Tooltip';
import { ProgressRing } from '../agent/Readiness';
import { useStepLink } from '../../hooks/useStepLink';
import type { Readiness } from '../../models/readiness';
import type { ValidationView } from '../../utils/serverValidation';
import { cn } from '../../utils/styles';

export function WorkspaceAction({ agentId, agentName }: { agentId: string; agentName: string }) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const stages = [
    { label: 'Build', path: `/agents/${agentId}/build`, icon: WrenchIcon, description: 'Prompts, tools & models' },
    { label: 'Test', path: `/agents/${agentId}/test`, icon: PlayIcon, description: 'Test conversations & scenario runs' },
    { label: 'Release', path: `/agents/${agentId}/release`, icon: RocketIcon, description: 'Deployments & environments' },
    { label: 'Monitor', path: `/agents/${agentId}/monitor`, icon: EyeIcon, description: 'Traces, latency & costs' },
  ];

  return (
    <div
      ref={containerRef}
      className="relative inline-flex items-center"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="inline-flex h-8 items-stretch rounded-lg border border-accent/30 bg-accent-soft/25 p-0.5 shadow-xs transition-colors hover:border-accent/50 hover:bg-accent-soft/40 focus-within:ring-2 focus-within:ring-accent/40">
        <Tooltip content="Open workspace builder" position="top">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/agents/${agentId}`);
            }}
            className="flex h-full items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-accent dark:text-accent-strong transition-colors hover:bg-accent hover:text-white dark:hover:bg-accent dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={`Open ${agentName} workspace`}
          >
            <ExternalLinkIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Workspace</span>
          </button>
        </Tooltip>

        <span className="my-1 w-px bg-accent/20" />

        <Tooltip content="Workspace stages menu" position="top">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen((prev) => !prev);
            }}
            aria-expanded={isOpen}
            aria-haspopup="menu"
            className="flex h-full w-7 items-center justify-center rounded-md text-accent dark:text-accent-strong transition-colors hover:bg-accent hover:text-white dark:hover:bg-accent dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Toggle workspace stages menu"
          >
            <ChevronDownIcon className={cn('h-3 w-3 transition-transform duration-150', isOpen && 'rotate-180')} />
          </button>
        </Tooltip>
      </div>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 w-52 rounded-xl border border-line-strong/40 bg-surface p-1.5 shadow-overlay backdrop-blur"
        >
          <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
            Workspace Stages
          </div>
          {stages.map((st) => {
            const Icon = st.icon;
            return (
              <button
                key={st.label}
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(false);
                  navigate(st.path);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-subtle hover:text-ink focus-visible:bg-subtle focus-visible:outline-none text-ink/90"
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft/30 text-accent">
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div>
                  <div className="font-medium text-ink">{st.label}</div>
                  <div className="text-[10px] text-muted">{st.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** What the server's checks say about an agent's saved draft, as a badge. */
export function ChecksBadge({ view, className }: { view: ValidationView | undefined; className?: string }) {
  if (view?.status === 'checked' && view.report) {
    return view.report.valid ?
    <Badge variant="success" dot className={className}>Checks pass</Badge> :

    <Badge variant="danger" dot className={className}>
        {view.report.errors.length} {view.report.errors.length === 1 ? 'problem' : 'problems'}
      </Badge>;

  }
  if (view?.status === 'failed') return <Badge variant="warning" className={className} title={view.error ?? undefined}>Not checked</Badge>;
  return <Badge variant="neutral" className={className}>Checking…</Badge>;
}

/** Small, visually consistent readiness completion indicator with an accessible tooltip */
export function ReadinessIndicator({ readiness }: { readiness: Readiness }) {
  const { done, total, next } = readiness;
  const percent = total > 0 ? Math.round((done / total) * 100) : 100;
  const isComplete = total > 0 && done >= total;
  const remaining = Math.max(0, total - done);

  return (
    <Tooltip
      position="top"
      content={
        <div className="p-1 max-w-[240px] text-left space-y-1.5">
          <div className="flex items-center justify-between gap-3 font-semibold text-xs border-b border-line/50 pb-1 text-ink">
            <span>Readiness Checklist</span>
            <span className="font-mono text-accent">{percent}%</span>
          </div>
          <div className="text-[11px] text-muted">
            {done} of {total} checks passed
            {remaining > 0 ? ` · ${remaining} task${remaining === 1 ? '' : 's'} remaining` : ' · Ready for launch'}
          </div>
          {next && (
            <div className="pt-1 border-t border-line/30 text-[11px]">
              <span className="text-muted">Next task: </span>
              <span className={cn('font-medium', next.state === 'blocked' ? 'text-danger' : 'text-accent')}>
                {next.label}
              </span>
              <p className="text-[10px] text-muted leading-tight mt-0.5">{next.text}</p>
            </div>
          )}
        </div>
      }
    >
      <div
        tabIndex={0}
        role="status"
        aria-label={`Readiness: ${percent}% complete, ${done} of ${total} checks passed.${next ? ` Next task: ${next.label}.` : ''}`}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full cursor-default inline-flex shrink-0"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {isComplete ? (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-success-soft text-success border border-success/30 h-6 select-none">
            <CheckCircle2Icon className="h-3 w-3 shrink-0" />
            <span>Ready</span>
          </span>
        ) : next?.state === 'blocked' ? (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-danger-soft/70 text-danger border border-danger/30 h-6 select-none">
            <span className="h-1.5 w-1.5 rounded-full bg-danger shrink-0" />
            <span className="font-mono text-[11px]">{percent}%</span>
            <span className="text-[10px] uppercase tracking-wider font-semibold">Blocked</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-subtle text-ink-soft border border-line h-6 select-none">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent/40 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
            </span>
            <span className="font-mono text-[11px] font-medium">{percent}%</span>
            <span className="text-[10px] text-muted">({done}/{total})</span>
          </span>
        )}
      </div>
    </Tooltip>
  );
}

/** How far an agent is from live, and its next step (the readiness model), as a link to where it is done. */
export function NextStepCell({ agentId, readiness }: { agentId: string; readiness: Readiness }) {
  const link = useStepLink(agentId);
  const next = readiness.next;
  return (
    <div className="flex items-center gap-2">
      <ProgressRing done={readiness.done} total={readiness.total} size={22} />
      {next ?
      <Link
        to={link(next)}
        onClick={(e) => e.stopPropagation()}
        title={next.text}
        className={cn('truncate text-[13px] font-medium hover:underline', next.state === 'blocked' ? 'text-danger' : 'text-accent')}>
          {next.label}
        </Link> :

      <span className="text-[13px] font-medium text-success">Live</span>
      }
    </div>);

}
