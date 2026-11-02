import React, { useState } from 'react';
import { ChevronRightIcon, EyeOffIcon } from 'lucide-react';
import type { Agent } from '../../types/studio';
import { Button } from '../ui/Button';
import { currentDeployments } from '../../utils/agentStatus';
import { dismissAgent, restoreAgent, undoDismissed } from '../../models/manage';
import { cn } from '../../utils/styles';

/**
 * "Removed from your list": agents hidden in this browser, each with Restore, or Delete (forget it in this list; it stays
 * on the server). "Bring them back" undoes the deletes. The API cannot delete an agent, and this says so.
 */
export function RemovedAgents({ removed, dismissedIds }: { removed: Agent[]; dismissedIds: string[] }) {
  const [open, setOpen] = useState(false);
  if (!removed.length && !dismissedIds.length) return null;
  const running = removed.some((a) => Object.keys(currentDeployments(a)).length > 0);
  return (
    <section className="mt-8 rounded-xl border border-line bg-surface" aria-labelledby="removed-agents-title">
      <h2 id="removed-agents-title">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left text-sm font-medium text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <ChevronRightIcon className={cn('h-4 w-4 text-muted transition-transform', open && 'rotate-90')} aria-hidden />
          <EyeOffIcon className="h-4 w-4 text-muted" aria-hidden />
          Removed from your list ({removed.length})
          <span className="ml-auto text-xs font-normal text-muted">Kept in this browser</span>
        </button>
      </h2>
      {open &&
      <div className="border-t border-line px-4 py-3">
          <p className="text-[13px] text-muted">
            These are hidden in this browser only. They still exist on the server{running ? ', and the ones that are deployed keep running' : ''}.
          </p>
          {removed.length === 0 && <p className="mt-2 text-[13px] text-muted">Nothing is waiting here.</p>}
          <ul className="mt-2 divide-y divide-line">
            {removed.map((agent) => <RemovedRow key={agent.id} agent={agent} />)}
          </ul>
          {dismissedIds.length > 0 &&
        <p className="mt-3 text-[13px] text-muted" role="status">
              {dismissedIds.length} deleted from this list.{' '}
              <button type="button" className="font-medium text-accent hover:underline" onClick={() => undoDismissed(dismissedIds)}>
                Bring {dismissedIds.length === 1 ? 'it' : 'them'} back
              </button>
            </p>
        }
        </div>
      }
    </section>);

}

function RemovedRow({ agent }: { agent: Agent }) {
  const [asking, setAsking] = useState(false);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <span className="min-w-0">
        <span className="text-sm font-medium text-ink">{agent.name}</span> <code className="font-mono text-xs text-muted">{agent.id}</code>
      </span>
      {asking ?
      <span role="group" aria-label={`Delete ${agent.name} from this list?`} className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Delete from this list? It stays on the server.</span>
          <Button size="sm" variant="danger" onClick={() => dismissAgent(agent.id)}>Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
        </span> :

      <span className="flex items-center gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => restoreAgent(agent.id)}>Restore</Button>
          <Button size="sm" variant="ghost" aria-label={`Delete ${agent.name} from this list`} onClick={() => setAsking(true)}>Delete</Button>
        </span>
      }
    </li>);

}
