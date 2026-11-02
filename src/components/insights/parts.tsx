import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangleIcon, InfoIcon } from 'lucide-react';
import { cn } from '../../utils/styles';

// The small pieces the insight pages share: a number tile, a sparkline, a card, a notice and placeholder shapes.

const dayName = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const callsText = (n: number) => `${n} call${n === 1 ? '' : 's'}`;

/** A grey shape where text will be, while it is read. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn('block animate-pulse rounded bg-subtle', className)} />;
}

/** Calls per day as small bars; the newest day stands out. Pointing at a bar says its day; screen readers hear words. */
export function Sparkline({
  series,
  onPoint,
  className,
}: {
  series: { day: string; calls: number }[];
  onPoint?: (index: number | null) => void;
  className?: string;
}) {
  const max = Math.max(1, ...series.map((d) => d.calls));
  return (
    <>
      <span aria-hidden className={cn('flex h-7 items-end gap-[3px]', className)} onMouseLeave={() => onPoint?.(null)}>
        {series.map((d, i) => (
          <i
            key={d.day}
            title={`${dayName(d.day)}: ${callsText(d.calls)}`}
            onMouseEnter={() => onPoint?.(i)}
            className={cn('block w-1.5 rounded-sm', i === series.length - 1 ? 'bg-accent' : d.calls ? 'bg-accent/40' : 'bg-line-strong/60')}
            style={{ height: `${Math.max(8, (d.calls / max) * 100)}%` }}
          />
        ))}
      </span>
      <span className="sr-only">{`By day: ${series.map((d) => `${dayName(d.day)} ${d.calls}`).join(', ')}.`}</span>
    </>
  );
}

/** One number, what it is above it and what it means under it; it opens the page that explains it. */
export function StatTile({
  label,
  value,
  sub,
  to,
  series,
  loading = false,
  title,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  to?: string;
  series?: { day: string; calls: number }[];
  loading?: boolean;
  title?: string;
  tone?: 'warning' | 'danger';
}) {
  const [at, setAt] = useState<number | null>(null);
  const pointed = at !== null && series ? series[at] : null;
  const body = (
    <>
      <span className="text-xs font-medium text-muted">{label}</span>
      {loading ? (
        <>
          <Skeleton className="mt-2 h-7 w-14" />
          <Skeleton className="mt-2 h-3 w-3/5" />
          <span className="sr-only">Loading</span>
        </>
      ) : (
        <>
          <span
            className={cn(
              'mt-1 block text-2xl font-semibold tracking-tight tabular-nums',
              tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-ink'
            )}
          >
            {value}
          </span>
          {(pointed || sub) && (
            <span className="mt-0.5 block text-xs text-muted" aria-live="polite">
              {pointed ? `${dayName(pointed.day)}: ${callsText(pointed.calls)}` : sub}
            </span>
          )}
        </>
      )}
      {!loading && series && series.length > 0 && <Sparkline series={series} onPoint={setAt} className="mt-3" />}
    </>
  );
  const box =
    'flex min-w-0 flex-col rounded-xl border border-line bg-surface px-4 py-3.5 text-left shadow-panel transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';
  return to ? (
    <Link to={to} title={title} aria-busy={loading || undefined} className={cn(box, 'hover:border-line-strong hover:bg-canvas')}>
      {body}
    </Link>
  ) : (
    <div title={title} aria-busy={loading || undefined} className={box}>
      {body}
    </div>
  );
}

/** A titled card on an insight page. */
export function Card({
  title,
  lead,
  action,
  children,
  className,
  id,
}: {
  title: string;
  lead?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const headingId = id ?? `card-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <section aria-labelledby={headingId} className={cn('rounded-xl border border-line bg-surface p-5 shadow-panel', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-semibold text-ink">
            {title}
          </h2>
          {lead && <p className="mt-0.5 text-xs text-muted">{lead}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A plain message above a page's numbers: something couldn't be read, or the numbers rest on part of the calls. */
export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warning' | 'danger'; title: string; children?: React.ReactNode }) {
  const Icon = tone === 'info' ? InfoIcon : AlertTriangleIcon;
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm',
        tone === 'danger' ? 'border-danger/30 bg-danger-soft' : tone === 'warning' ? 'border-warning/30 bg-warning-soft' : 'border-line bg-subtle/60'
      )}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-muted')} aria-hidden />
      <div className="min-w-0">
        <p className={cn('font-medium', tone === 'danger' ? 'text-danger' : 'text-ink')}>{title}</p>
        {children && <div className="mt-0.5 text-ink-soft">{children}</div>}
      </div>
    </div>
  );
}

/** A small select with a visible label, in Studio's input style. */
export function SmallSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
  srLabel,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  srLabel?: string;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-muted">
      <span>{label}</span>
      <select
        aria-label={srLabel ?? label}
        value={String(value)}
        onChange={(event) => {
          const picked = options.find((o) => String(o.value) === event.target.value);
          if (picked) onChange(picked.value);
        }}
        className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A table header cell in the insight tables' style. */
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn('px-3 py-2 text-left text-xs font-medium text-muted', className)}>
      {children}
    </th>
  );
}
