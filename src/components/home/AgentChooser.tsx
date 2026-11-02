import React from 'react';
import type { Agent } from '../../types/studio';
import { cn, inputClass } from '../../utils/styles';

/** Which agent Home's "Next step" is about, when there is more than one. */
export function AgentChooser({ agents, value, onChange }: { agents: Agent[]; value: string; onChange: (id: string) => void }) {
  if (agents.length < 2) return null;
  return (
    <label className="flex items-center gap-2 text-[13px] text-muted">
      <span className="sr-only sm:not-sr-only">Agent</span>
      <select
        aria-label="Which agent"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputClass, 'h-8 w-auto max-w-[16rem] py-0 pr-8 text-[13px]')}
      >
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name || a.id}
          </option>
        ))}
      </select>
    </label>
  );
}
