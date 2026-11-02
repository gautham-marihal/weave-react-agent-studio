import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightIcon } from 'lucide-react';
import type { Readiness } from '../../models/readiness';
import { useStepLink } from '../../hooks/useStepLink';
import { Button } from '../ui/Button';
import { StepIcon } from './Readiness';

/** The next step from the readiness model, at the foot of every page of the agent. */
export function NextStepBar({ agentId, readiness }: { agentId: string; readiness: Readiness }) {
  const navigate = useNavigate();
  const link = useStepLink(agentId);
  const next = readiness.next;
  return (
    <div className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-4 lg:px-10">
        {next ?
        <>
            <p className="flex min-w-0 items-start gap-2 text-sm text-ink-soft">
              <StepIcon state={next.state} className="mt-0.5" />
              <span><span className="font-medium text-ink">Next: {next.label}.</span> {next.text}</span>
            </p>
            <Button variant="secondary" onClick={() => navigate(link(next))}>
              Go there
              <ArrowRightIcon className="h-4 w-4" aria-hidden />
            </Button>
          </> :

        <p className="text-sm text-ink-soft">Every step is done: the newest version is live. Watch how real conversations go under Monitor.</p>
        }
      </div>
    </div>);

}
