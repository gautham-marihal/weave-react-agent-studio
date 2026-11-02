import React, { useId, useState } from 'react';
import { ChevronDownIcon, CircleHelpIcon } from 'lucide-react';
import type { HelpEntry } from '../../api/gatewayTypes';
import { cn } from '../../utils/styles';

/**
 * One help question from the gateway, as a disclosure next to the step it belongs to. When the bank's procedure is
 * unknown the gateway sends no answer; the fallback (a safe route to a person) is shown and the gap is stated.
 */
export function HelpTopic({ entry, defaultOpen = false, className }: { entry: HelpEntry; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <div className={cn('rounded-md', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md text-left text-[13px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <CircleHelpIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {entry.question}
        <ChevronDownIcon className={cn('h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div id={panelId} className="mt-1.5 rounded-md border border-line bg-subtle px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
          {entry.answer ? <p>{entry.answer}</p> : <p className="text-ink">We don&apos;t have confirmed instructions for this.</p>}
          <p className={cn(entry.answer && 'mt-1.5')}>{entry.fallback}</p>
          {!entry.approved && <p className="mt-1.5 text-[11px] text-muted">Wording awaiting the bank&apos;s approval.</p>}
        </div>
      )}
    </div>
  );
}
