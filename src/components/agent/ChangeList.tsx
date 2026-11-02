import React, { useState } from 'react';
import { Undo2Icon } from 'lucide-react';
import type { ChangeSummary, PlainChange } from '../../models/changes';
import { StatusChip } from '../ui/StatusChip';
import { Button } from '../ui/Button';

interface ChangeListProps {
  summary: ChangeSummary;
  emptyText?: string;
  /** When given, each part gets "Put back as published" (an ordinary, undoable edit). */
  onPutBack?: (key: string) => void;
  disabled?: boolean;
}

const tone = { Added: 'success', Removed: 'danger', Changed: 'info' } as const;

/** Changes in plain words, grouped by part of the agent. */
export function ChangeList({ summary, emptyText = 'No differences.', onPutBack, disabled }: ChangeListProps) {
  if (summary.total === 0) return <p className="py-6 text-center text-sm text-muted">{emptyText}</p>;
  return (
    <div className="space-y-6">
      {summary.groups.map((g) =>
      <section key={g.key} aria-label={g.title}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="flex items-baseline gap-2 text-sm font-semibold text-ink">
              {g.title}
              <span className="text-xs font-normal text-muted">{g.items.length} {g.items.length === 1 ? 'change' : 'changes'}</span>
            </h3>
            {onPutBack &&
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onPutBack(g.key)} title={`Make “${g.title}” what it was in the published version. Nothing is saved until you press Save; Undo takes it back.`}>
                <Undo2Icon className="h-3.5 w-3.5" aria-hidden />
                Put back as published
              </Button>
          }
          </div>
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
            {g.items.map((c, i) => <ChangeRow key={`${c.where}-${i}`} change={c} />)}
          </ul>
        </section>
      )}
    </div>);

}

function ChangeRow({ change }: { change: PlainChange }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-2">
        <StatusChip tone={tone[change.verb]}>{change.verb}</StatusChip>
        <span className="min-w-0 flex-1 text-[13px] text-ink" title={change.where}>{change.text}</span>
        {change.full &&
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded">
            {open ? 'Hide the wording' : 'Show the wording'}
          </button>
        }
      </div>
      {open && change.full &&
      <div className="mt-2 grid gap-1.5 text-[13px] sm:grid-cols-2">
          <p className="whitespace-pre-wrap break-words rounded bg-danger-soft/70 px-2 py-1 text-ink-soft"><span className="sr-only">Before: </span>{change.full.before}</p>
          <p className="whitespace-pre-wrap break-words rounded bg-success-soft/80 px-2 py-1 text-ink"><span className="sr-only">After: </span>{change.full.after}</p>
        </div>
      }
    </li>);

}
