import React, { useMemo, useState } from 'react';
import { BotIcon, SearchIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import type { Agent } from '../../types/studio';
import { cn, inputClass } from '../../utils/styles';

/** "Which agent?" for something that starts on another page (use this voice, add this connection). */
export function AgentPickerDialog({
  title,
  description,
  agents,
  onPick,
  onClose,
  children,
  blocked
}: {
  title: string;
  description?: string;
  agents: Agent[];
  onPick: (agent: Agent) => void;
  onClose: () => void;
  /** Anything to ask before the agent is chosen (a connection's address), shown above the list. */
  children?: React.ReactNode;
  /** Why no agent can be chosen yet (what above the list still needs filling in). */
  blocked?: string;
}) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? agents.filter((a) => `${a.name} ${a.id}`.toLowerCase().includes(q)) : agents;
  }, [agents, query]);

  return (
    <Dialog open onClose={onClose} title={title} description={description} footer={<Button variant="ghost" onClick={onClose}>Cancel</Button>}>
      <div className="space-y-4">
        {children}
        {agents.length === 0 ?
        <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center">
            <p className="text-sm text-muted">There are no agents in this workspace yet.</p>
            <Link to="/agents" className="mt-2 inline-block text-sm font-medium text-accent hover:underline" onClick={onClose}>Go to Agents</Link>
          </div> :

        <div>
            {agents.length > 6 &&
          <div className="relative mb-2">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                <input className={cn(inputClass, 'pl-9')} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter agents" aria-label="Filter agents" />
              </div>
          }
            <p className="mb-1.5 text-sm font-medium text-ink">Choose the agent</p>
            {blocked && <p className="mb-2 text-[13px] text-muted">{blocked}</p>}
            <ul className="max-h-72 space-y-1 overflow-y-auto" aria-label="Agents">
              {shown.map((agent) =>
            <li key={agent.id}>
                  <button
                type="button"
                disabled={!!agent.loadError || !!blocked}
                title={agent.loadError ? 'Its draft could not be read' : blocked}
                onClick={() => onPick(agent)}
                className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft/40 text-accent">
                      <BotIcon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{agent.name}</span>
                      <span className="block truncate font-mono text-xs text-muted">{agent.id}</span>
                    </span>
                  </button>
                </li>
            )}
              {shown.length === 0 && <li className="px-1 py-2 text-sm text-muted">No agents match “{query.trim()}”.</li>}
            </ul>
          </div>
        }
      </div>
    </Dialog>);

}
