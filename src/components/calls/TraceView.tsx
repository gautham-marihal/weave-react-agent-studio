import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangleIcon, CheckIcon, CopyIcon } from 'lucide-react';
import { GROUPS, filterRows, groupCounts, rowsAsText, summarizeRows, withoutCallerWords, type RowTone, type TraceRow } from '../../models/trace';
import { cn } from '../../utils/styles';

// What happened in a conversation: a real call, the Test stage's conversation, a scenario (all the same records).
// Rows in order, filters by kind, what went wrong marked, raw fields on request, copy as text. `live` follows a
// conversation in progress: new rows scroll into view unless the reader has scrolled up to read.

interface TraceViewProps {
  rows: TraceRow[];
  live?: boolean;
  title?: string;
  description?: string;
  emptyText?: string;
  /** A note under the header (what the records hold, why some are missing). */
  note?: React.ReactNode;
  /** Fills its parent's height and scrolls inside (the Test stage); else the list scrolls past a set height. */
  fill?: boolean;
  /** For a screen others can see: what callers said is hidden. */
  hideCaller?: boolean;
  className?: string;
}

const LABEL_TONE: Record<RowTone, string> = {
  plain: 'bg-subtle text-ink-soft',
  agent: 'bg-accent-soft text-accent',
  caller: 'bg-info-soft text-info',
  good: 'bg-success-soft text-success',
  bad: 'bg-danger-soft text-danger',
  muted: 'bg-subtle text-muted',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function TraceView({
  rows: allRows,
  live = false,
  title = 'What happened',
  description,
  emptyText = 'Nothing has been recorded yet.',
  note,
  fill = false,
  hideCaller = false,
  className,
}: TraceViewProps) {
  const rows = useMemo(() => (hideCaller ? withoutCallerWords(allRows) : allRows), [allRows, hideCaller]);
  const [active, setActive] = useState<string[]>([]);
  const [copied, setCopied] = useState<'' | 'yes' | 'no'>('');
  const [follow, setFollow] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const counts = useMemo(() => groupCounts(rows), [rows]);
  const summary = useMemo(() => summarizeRows(rows), [rows]);
  const shown = useMemo(() => filterRows(rows, active), [rows, active]);

  // following a conversation in progress: keep the newest row in view
  useEffect(() => {
    const el = listRef.current;
    if (live && follow && el) el.scrollTop = el.scrollHeight;
  }, [live, follow, shown.length]);

  // scrolling up to read stops following; back at the bottom starts it again
  const onScroll = () => {
    const el = listRef.current;
    if (!el || !live) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== follow) setFollow(atBottom);
  };

  const toggle = (id: string) => setActive((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(rowsAsText(shown));
      setCopied('yes');
    } catch {
      setCopied('no');
    }
    window.setTimeout(() => setCopied(''), 1800);
  };

  const chips = GROUPS.filter((g) => counts[g.id] > 0);

  return (
    <section aria-label={title} className={cn('flex min-h-0 flex-col rounded-xl border border-line bg-surface', className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description && <p className="text-xs text-muted">{description}</p>}
          {rows.length > 0 && (
            <p className="mt-0.5 text-xs text-muted" data-testid="trace-summary">
              {plural(summary.said, 'message')} · {plural(summary.tools, 'tool call')} · {plural(summary.requests, 'API request')}
              {summary.errors > 0 && (
                <>
                  {' · '}
                  <strong className="font-semibold text-danger">{plural(summary.errors, 'problem')}</strong>
                </>
              )}
              {summary.seconds > 0 && <> · {Math.round(summary.seconds)} s</>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {live && (
            <button
              type="button"
              onClick={() => setFollow((f) => !f)}
              aria-pressed={follow}
              title={follow ? 'New records scroll into view. Click to stop.' : 'Click to keep the newest record in view.'}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                follow ? 'bg-success-soft text-success' : 'bg-subtle text-muted hover:text-ink'
              )}
            >
              <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full bg-current', follow && 'animate-pulse')} />
              {follow ? 'Following live' : 'Follow live'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void copy()}
            disabled={!shown.length}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
          >
            {copied === 'yes' ? <CheckIcon className="h-3.5 w-3.5 text-success" aria-hidden /> : <CopyIcon className="h-3.5 w-3.5" aria-hidden />}
            {copied === 'yes' ? 'Copied' : copied === 'no' ? 'Copy blocked by the browser' : 'Copy as text'}
          </button>
        </div>
      </header>

      {note && (
        <div role="note" className="border-b border-line bg-canvas/60 px-4 py-2 text-xs text-ink-soft">
          {note}
        </div>
      )}

      {chips.length > 0 && (
        <div role="group" aria-label="Show only" className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2">
          {chips.map((g) => {
            const on = active.includes(g.id);
            const bad = g.id === 'errors';
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(g.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  on ? (bad ? 'border-danger bg-danger-soft text-danger' : 'border-accent bg-accent-soft text-accent') : bad ? 'border-danger/30 text-danger hover:bg-danger-soft' : 'border-line text-ink-soft hover:bg-subtle'
                )}
              >
                {g.label}
                <span className="tabular-nums opacity-70">{counts[g.id]}</span>
              </button>
            );
          })}
          {active.length > 0 && (
            <button type="button" onClick={() => setActive([])} className="text-xs font-medium text-accent hover:underline">
              Show all
            </button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-[13px] text-muted">{emptyText}</p>
      ) : shown.length === 0 ? (
        <p className="px-4 py-10 text-center text-[13px] text-muted">Nothing of that kind happened.</p>
      ) : (
        <div ref={listRef} onScroll={onScroll} className={cn('min-h-0 overflow-y-auto', fill ? 'flex-1' : 'max-h-[640px]')}>
          <ol aria-live={live ? 'polite' : undefined} aria-label="Records" className="divide-y divide-line">
            {shown.map((row) => (
              <li
                key={`${row.id}-${row.kind}`}
                data-kind={row.kind}
                data-problem={row.problem || undefined}
                className={cn('grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-3 px-4 py-2.5', row.problem && 'border-l-2 border-l-danger bg-danger-soft/40')}
              >
                <span className="pt-0.5 font-mono text-[11px] tabular-nums text-muted">{row.at || '—'}</span>
                <div className="min-w-0">
                  <div className="flex items-start gap-2">
                    <span className={cn('mt-px shrink-0 rounded px-1.5 py-px text-[11px] font-medium', LABEL_TONE[row.tone])}>{row.label}</span>
                    {row.problem && <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-label="Problem" />}
                    {row.text && <p className={cn('min-w-0 break-words text-[13px] leading-relaxed', row.tone === 'muted' ? 'text-ink-soft' : 'text-ink')}>{row.text}</p>}
                  </div>
                  {(row.facts.length > 0 || row.ms !== undefined) && (
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                      {row.facts.map(([k, v], i) => (
                        <span key={`${k}-${i}`} className="break-words">
                          {k && <em className="not-italic text-ink-soft">{k} </em>}
                          <span className={cn(k === 'failed' || k === 'error' ? 'text-danger' : '')}>{v}</span>
                        </span>
                      ))}
                      {row.ms !== undefined && (
                        <span>
                          <em className="not-italic text-ink-soft">took </em>
                          {row.ms} ms
                        </span>
                      )}
                    </p>
                  )}
                  <details className="group mt-1">
                    <summary className="cursor-pointer select-none text-[11px] font-medium text-muted hover:text-ink">Raw fields</summary>
                    <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-canvas p-2 font-mono text-[11px] leading-relaxed text-ink-soft">{JSON.stringify(row.raw, null, 2)}</pre>
                  </details>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
