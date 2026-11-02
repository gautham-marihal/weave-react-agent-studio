import React from 'react';
import type { ConversationLine } from '../../models/trace';
import { hiddenWords } from '../../models/live';
import { formatOffset } from '../../utils/format';
import { cn } from '../../utils/styles';

// A call as a conversation only: who said what, in order. The trace beside it shows everything else.
export function ConversationView({
  lines,
  agentName = 'Agent',
  callerName = 'Caller',
  hideCaller = false,
  emptyText = 'Nobody said anything in this call.',
}: {
  lines: ConversationLine[];
  agentName?: string;
  callerName?: string;
  /** For a screen others can see: what callers said is hidden. */
  hideCaller?: boolean;
  emptyText?: string;
}) {
  if (!lines.length) return <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-muted">{emptyText}</div>;
  return (
    <ol aria-label="The conversation" className="space-y-4">
      {lines.map((line) => {
        const isAgent = line.role === 'agent';
        return (
          <li key={line.seq} className={cn('flex gap-3', isAgent ? 'justify-start' : 'justify-end')}>
            {isAgent && (
              <div aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                {agentName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className={cn('max-w-[80%] rounded-xl px-4 py-2.5 text-sm', isAgent ? 'border border-line bg-surface text-ink' : 'bg-accent text-accent-ink')}>
              <div className="flex items-center justify-between gap-3 text-xs opacity-70">
                <span className="font-medium">{isAgent ? agentName : callerName}</span>
                {line.atS !== undefined && <span>{formatOffset(Math.round(line.atS))}</span>}
              </div>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed">{!isAgent && hideCaller ? <i>{hiddenWords(line)}</i> : line.text}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
