import React from 'react';
import { ArrowRightIcon } from 'lucide-react';
import { StatusChip } from '../../ui/StatusChip';

interface GuidedSectionProps {
  id: string;
  title: string;
  description: string;
  onMore?: () => void;
  /** The words of the "more" link (default "More settings for this"). */
  moreLabel?: string;
  /** Where this part stands, under its description (the one-page Build view). */
  status?: { state: 'done' | 'todo' | 'attention' | 'optional'; text: string } | null;
  children: React.ReactNode;
}

const TONE = { done: 'success', todo: 'warning', attention: 'danger', optional: 'neutral' } as const;
const WORD = { done: 'Set', todo: 'To do', attention: 'Needs a look', optional: 'Optional' } as const;

export function GuidedSection({ id, title, description, onMore, moreLabel = 'More settings for this', status, children }: GuidedSectionProps) {
  return (
    <section aria-labelledby={id} className="grid gap-6 border-b border-line py-8 first:pt-2 last:border-0 md:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
      <div>
        <h2 id={id} className="text-[15px] font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>
        {status &&
        <div data-part-status className="mt-3 space-y-1">
            <StatusChip tone={TONE[status.state]} dot>
              {WORD[status.state]}
            </StatusChip>
            <p className="text-xs leading-relaxed text-ink-soft">{status.text}</p>
          </div>
        }
        {onMore &&
        <button
          type="button"
          onClick={onMore}
          className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">

            {moreLabel}
            <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden />
          </button>
        }
      </div>
      <div className="min-w-0 space-y-5">{children}</div>
    </section>);

}
