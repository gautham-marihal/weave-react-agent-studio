// What the Sandbox telephony parts share (Weave React's telephonyParts.jsx, in Studio's look): a table with search,
// a choice of columns, row actions and an empty state; a stat card; a labelled field; the Sandbox note; a confirm box.

import React, { useEffect, useId, useRef, useState } from 'react';
import { CircleAlertIcon, Columns3Icon, FlaskConicalIcon, SearchIcon, XIcon } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { cn, inputClass } from '../../utils/styles';

export interface TableRow {
  id: string;
  cells: React.ReactNode[];
  /** What the row is called, for its buttons ("Edit Main support line"). */
  name?: string;
    /** What the search looks in (the cells' text when they are plain strings). */
  searchText?: string;
}

interface TableProps {
  title: string;
  columns: string[];
  rows: TableRow[];
  /** Columns that start hidden (one click away in the columns menu). */
  defaultHidden?: string[];
  empty: { icon: React.ComponentType<{ className?: string }>; title: string; text?: string; action?: { label: string; onClick: () => void } };
  onRowClick?: (id: string) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  /** "Delete" or "Release". */
  deleteLabel?: string;
  /** "dispatch rule", "phone number"… for the question asked before deleting. */
  itemLabel: string;
  /** More words for that question. */
  deleteWords?: (id: string) => string;
  /** The first column in a fixed-width font (ids, numbers). */
  monoFirst?: boolean;
}

/** A table with working search, a choice of visible columns, row edit/delete and an empty state. */
export function TelephonyTable({ title, columns, rows, defaultHidden = [], empty, onRowClick, onEdit, onDelete, deleteLabel = 'Delete', itemLabel, deleteWords, monoFirst = false }: TableProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState<number[]>(() => defaultHidden.map((name) => columns.indexOf(name)).filter((i) => i >= 0));
  const [asking, setAsking] = useState<string | null>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!columnsOpen) return undefined;
    const onDown = (e: MouseEvent) => {
      if (!toolsRef.current?.contains(e.target as Node)) setColumnsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setColumnsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [columnsOpen]);

  const visible = columns.map((_, i) => i).filter((i) => !hidden.includes(i));
  const needle = query.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => (r.searchText ?? r.cells.filter((c) => typeof c === 'string').join(' ')).toLowerCase().includes(needle)) : rows;
  const hasActions = !!(onEdit || onDelete);
  const toggleColumn = (i: number) =>
    setHidden((old) => (old.includes(i) ? old.filter((x) => x !== i) : columns.length - old.length <= 1 ? old : [...old, i]));
  const EmptyIcon = needle ? SearchIcon : empty.icon;

  return (
    <section className="rounded-xl border border-line bg-surface" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <span className="text-xs tabular-nums text-muted" data-testid="table-count">
            {needle ? `${shown.length} of ${rows.length}` : `${rows.length} ${rows.length === 1 ? 'item' : 'items'}`}
          </span>
        </div>
        <div ref={toolsRef} className="relative flex items-center gap-1">
          {searchOpen && (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQuery('');
                  setSearchOpen(false);
                }
              }}
              placeholder={`Search ${title.toLowerCase()}`}
              aria-label={`Search ${title.toLowerCase()}`}
              className={cn(inputClass, 'h-8 w-44 py-1 text-[13px] sm:w-56')}
            />
          )}
          <button
            type="button"
            aria-label={searchOpen ? 'Close search' : `Search ${title.toLowerCase()}`}
            aria-pressed={searchOpen}
            onClick={() => {
              if (searchOpen) setQuery('');
              setSearchOpen(!searchOpen);
              setColumnsOpen(false);
            }}
            className={cn('rounded-md p-1.5 text-muted transition-colors hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40', searchOpen && 'bg-subtle text-ink')}
          >
            {searchOpen ? <XIcon className="h-4 w-4" aria-hidden /> : <SearchIcon className="h-4 w-4" aria-hidden />}
          </button>
          <button
            type="button"
            aria-label="Choose columns"
            aria-expanded={columnsOpen}
            aria-controls={menuId}
            onClick={() => setColumnsOpen(!columnsOpen)}
            className={cn('rounded-md p-1.5 text-muted transition-colors hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40', columnsOpen && 'bg-subtle text-ink')}
          >
            <Columns3Icon className="h-4 w-4" aria-hidden />
          </button>
          {columnsOpen && (
            <div id={menuId} role="group" aria-label="Visible columns" className="absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border border-line bg-surface p-2 shadow-overlay">
              <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Visible columns</p>
              {columns.map((c, i) => (
                <label key={c} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[13px] text-ink hover:bg-subtle">
                  <input type="checkbox" checked={!hidden.includes(i)} disabled={!hidden.includes(i) && columns.length - hidden.length <= 1} onChange={() => toggleColumn(i)} />
                  {c}
                </label>
              ))}
              {hidden.length > 0 && (
                <button type="button" onClick={() => setHidden([])} className="mt-1 w-full rounded px-1 py-1 text-left text-[13px] font-medium text-accent hover:bg-subtle">
                  Show all columns
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {/* relative: the screen-reader-only header stays inside the scroll box, not past the page edge */}
      {shown.length > 0 ? (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                {visible.map((i) => (
                  <th key={columns[i]} scope="col" className="whitespace-nowrap px-4 py-2.5 font-medium">
                    {columns[i]}
                  </th>
                ))}
                {hasActions && (
                  <th scope="col" className="px-4 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr
                  key={row.id}
                  data-row={row.id}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row.id) : undefined}
                  onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row.id) : undefined}
                  className={cn('border-b border-line align-top last:border-0', onRowClick && 'cursor-pointer transition-colors duration-150 hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none')}
                >
                  {visible.map((i) => (
                    <td key={columns[i]} className={cn('px-4 py-3 text-ink-soft', i === 0 && 'font-medium text-ink', i === 0 && monoFirst && 'whitespace-nowrap font-mono text-[13px]')}>
                      {row.cells[i]}
                    </td>
                  ))}
                  {hasActions && (
                    <td className="whitespace-nowrap px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      {onEdit && (
                        <Button size="sm" variant="ghost" onClick={() => onEdit(row.id)} aria-label={`Edit ${row.name ?? row.id}`}>
                          Edit
                        </Button>
                      )}
                      {onDelete && (
                        <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => setAsking(row.id)} aria-label={`${deleteLabel} ${row.name ?? row.id}`}>
                          {deleteLabel}
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-10 text-center">
          <EmptyIcon className="mx-auto h-6 w-6 text-muted" aria-hidden />
          <p className="mt-2 text-sm font-medium text-ink">{needle ? `No matches for “${query.trim()}”` : empty.title}</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted">{needle ? 'Try a different search, or clear it to see everything.' : empty.text}</p>
          {needle ? (
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => setQuery('')}>
              Clear search
            </Button>
          ) : (
            empty.action && (
              <Button size="sm" variant="secondary" className="mt-3" onClick={empty.action.onClick}>
                {empty.action.label}
              </Button>
            )
          )}
        </div>
      )}
      <Dialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        title={`${deleteLabel} this ${itemLabel}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAsking(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (asking) onDelete?.(asking);
                setAsking(null);
              }}
            >
              {deleteLabel}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">{(asking && deleteWords?.(asking)) || 'This can’t be undone.'}</p>
      </Dialog>
    </section>
  );
}

/** One number above a table: its name, its value and a line under it. */
export function Stat({ label, value, note, accent = false }: { label: string; value: string; note: string; accent?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-3 py-3 sm:px-4" data-stat={label}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn('mt-0.5 text-lg font-semibold tabular-nums text-ink', accent && 'text-accent')}>{value}</dd>
      <dd className="mt-0.5 text-xs text-muted">{note}</dd>
    </div>
  );
}

export function StatGrid({ children, columns = 3 }: { children: React.ReactNode; columns?: 2 | 3 }) {
  return <dl className={cn('grid grid-cols-2 gap-3', columns === 3 && 'sm:grid-cols-3')}>{children}</dl>;
}

/** A labelled form field with a hint, or its error once the form was sent. The control (the one child) is named by the
 * label alone and described by the hint or error. */
export function FormField({ label, hint, error, children, className }: { label: React.ReactNode; hint?: string; error?: string | false; children: React.ReactElement; className?: string }) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error || hint;
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      {React.cloneElement(children as React.ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>, {
        id,
        'aria-describedby': note ? noteId : undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {error ? (
        <p id={noteId} className="mt-1.5 flex items-start gap-1.5 text-[13px] text-danger" role="alert">
          <CircleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : (
        hint && (
          <p id={noteId} className="mt-1.5 text-[13px] leading-relaxed text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** What a part of Sandbox telephony is, said plainly at its top. */
export function SandboxNote({ children, title = 'Sandbox, not connected' }: { children: React.ReactNode; title?: string }) {
  return (
    <div role="note" className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning-soft/60 px-3.5 py-2.5 text-[13px] text-ink-soft" data-testid="sandbox-note">
      <FlaskConicalIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <p>
        <span className="font-semibold text-warning">{title}.</span> {children}
      </p>
    </div>
  );
}

/** A part's heading with its main button. */
export function SectionHeader({ title, text, children }: { title: string; text: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        <p className="mt-0.5 max-w-2xl text-[13px] text-muted">{text}</p>
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** A warning line with an optional action (rules sending callers to an agent that isn't live…). */
export function Callout({ children, action }: { children: React.ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-canvas px-3.5 py-2.5 text-[13px] text-ink-soft sm:flex-row sm:items-center sm:justify-between" role="status">
      <span>{children}</span>
      {action && (
        <Button size="sm" variant="secondary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
