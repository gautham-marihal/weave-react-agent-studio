import React, { useId, useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import type { AgentConfig, Issue } from '../../../../../types/studio';
import { actionWords, headersFrom, idProblem, isObj, list, secretNameProblem, secretRef, secretName } from '../../../../../models/toolsExtras';
import { StatusChip } from '../../../../ui/StatusChip';
import { Button } from '../../../../ui/Button';
import { cn, inputClass, inputErrorClass } from '../../../../../utils/styles';

/** What every extras editor gets: the draft, how to change it, and how to delete with Undo. */
export interface ExtraEditorProps {
  config: AgentConfig;
  disabled: boolean;
  errors: Issue[];
  /** One edit of the draft (one undo step). */
  apply: (next: AgentConfig) => void;
  /** Deletes something: the page offers it back with Undo. */
  remove: (label: string, next: AgentConfig) => void;
  onOpenJson: () => void;
}

/** One item of a list: a row that opens to its settings. A new item opens at once. */
export function ItemCard({
  title,
  summary,
  problems,
  open,
  onToggle,
  onDelete,
  deleteLabel,
  disabled,
  children,
}: {
  title: React.ReactNode;
  summary?: string;
  problems: number;
  open: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleteLabel: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const bodyId = useId();
  return (
    <li className="rounded-lg border border-line bg-surface">
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-start gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <ChevronDownIcon className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted transition-transform duration-150', !open && '-rotate-90')} aria-hidden />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">{title}</span>
            {summary && <span className="mt-0.5 block text-[13px] text-muted">{summary}</span>}
          </span>
        </button>
        {problems > 0 && <StatusChip tone="danger" dot>{problems} to fix</StatusChip>}
        <Button size="sm" variant="ghost" onClick={onDelete} disabled={disabled} aria-label={deleteLabel} title={deleteLabel}>
          <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
      {open && (
        <div id={bodyId} className="space-y-4 border-t border-line px-4 py-4">
          {children}
        </div>
      )}
    </li>
  );
}

/** A labelled box. */
export function Labeled({ label, help, error, children, className }: { label: string; help?: React.ReactNode; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="text-[13px] font-medium text-ink-soft">{label}</span>
      <span className="mt-1 block">{children}</span>
      {error ? <span role="alert" className="mt-1 block text-[13px] text-danger">{error}</span> : help ? <span className="mt-1 block text-xs text-muted">{help}</span> : null}
    </label>
  );
}

export function TextInput({ value, onChange, disabled, placeholder, mono, invalid, label, multiline, rows = 3, type = 'text' }: { value: string; onChange: (v: string) => void; disabled: boolean; placeholder?: string; mono?: boolean; invalid?: boolean; label?: string; multiline?: boolean; rows?: number; type?: string }) {
  const cls = cn(inputClass, mono && 'font-mono text-[13px]', invalid && inputErrorClass, multiline && 'resize-y');
  return multiline ? (
    <textarea className={cls} rows={rows} value={value} disabled={disabled} placeholder={placeholder} aria-label={label} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input type={type} className={cls} value={value} disabled={disabled} placeholder={placeholder} aria-label={label} aria-invalid={invalid || undefined} spellCheck={mono ? false : undefined} onChange={(e) => onChange(e.target.value)} />
  );
}

/** A number box: '' takes the value away. */
export function NumberInput({ value, onChange, disabled, placeholder, min, step, label }: { value: unknown; onChange: (v: number | undefined) => void; disabled: boolean; placeholder?: string; min?: number; step?: number; label?: string }) {
  return (
    <input
      type="number"
      className={cn(inputClass, 'w-32')}
      value={typeof value === 'number' ? value : ''}
      min={min}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(e.target.value === '' || !Number.isFinite(Number(e.target.value)) ? undefined : Number(e.target.value))}
    />
  );
}

/**
 * An item's id. While nothing uses it, it can be changed (checked against the ids taken); once something uses it, it
 * is shown as it is, with what uses it.
 */
export function IdField({ id, taken, users, disabled, onRename }: { id: string; taken: string[]; users: string[]; disabled: boolean; onRename: (next: string) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  const problem = typed !== null ? idProblem(typed, taken.filter((t) => t !== id)) : '';
  if (users.length)
    return (
      <p className="text-[13px] text-muted">
        Id <code className="font-mono text-ink">{id}</code> · used by {users.join(', ')}.
      </p>
    );
  return (
    <Labeled label="Id" help="How tools and rules refer to it. Nothing uses it yet." error={problem}>
      <input
        className={cn(inputClass, 'max-w-xs font-mono text-[13px]', problem && inputErrorClass)}
        value={typed ?? id}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => {
          const v = e.target.value;
          setTyped(v);
          if (!idProblem(v, taken.filter((t) => t !== id))) onRename(v);
        }}
        onBlur={() => setTyped(null)}
      />
    </Labeled>
  );
}

/** A list of actions in words (before, closed, on_submit…), changed in the JSON view. */
export function ActionsSummary({ label, actions, config, onOpenJson, empty }: { label: string; actions: unknown; config: AgentConfig; onOpenJson: () => void; empty?: string }) {
  const items = list(actions);
  if (!items.length && !empty) return null;
  return (
    <div>
      <p className="text-[13px] font-medium text-ink-soft">{label}</p>
      {items.length ? (
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[13px] text-ink-soft">
          {items.map((a, i) => (
            <li key={i}>{actionWords(a, config)}</li>
          ))}
        </ol>
      ) : (
        <p className="mt-1 text-[13px] text-muted">{empty}</p>
      )}
      <button type="button" onClick={onOpenJson} className="mt-1 text-xs font-medium text-accent hover:underline">
        Change these in the JSON view
      </button>
    </div>
  );
}

/** A secret's name (never its value): capitals, digits and _. */
export function SecretInput({ label, value, onChange, disabled }: { label: string; value: unknown; onChange: (ref: { secret: string }) => void; disabled: boolean }) {
  const name = secretName(value);
  const problem = secretNameProblem(name);
  return (
    <Labeled label={label} help="The name of a secret kept on the server, such as BILLING_API_TOKEN. Never the value itself." error={problem}>
      <input
        className={cn(inputClass, 'max-w-sm font-mono text-[13px]', problem && inputErrorClass)}
        value={name}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        placeholder="SECRET_NAME"
        onChange={(e) => onChange(secretRef(e.target.value))}
      />
    </Labeled>
  );
}

/** Name: value rows (headers). */
export function PairsEditor({ label, value, onChange, disabled, keyPlaceholder, valuePlaceholder }: { label: string; value: unknown; onChange: (next: Record<string, string> | undefined) => void; disabled: boolean; keyPlaceholder: string; valuePlaceholder: string }) {
  const rows: [string, string][] = Object.entries(isObj(value) ? value : {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]);
  const [extra, setExtra] = useState(false);
  const shown: [string, string][] = extra ? [...rows, ['', '']] : rows;
  return (
    <fieldset>
      <legend className="text-[13px] font-medium text-ink-soft">{label}</legend>
      <div className="mt-1 space-y-1.5">
        {shown.map(([k, v], i) => (
          <div key={i} className="flex gap-2">
            <input
              className={cn(inputClass, 'w-48 font-mono text-[13px]')}
              value={k}
              aria-label={`${label}: name ${i + 1}`}
              placeholder={keyPlaceholder}
              disabled={disabled}
              onChange={(e) => {
                const next = shown.map((r, n): [string, string] => (n === i ? [e.target.value, r[1]] : r));
                if (i >= rows.length) setExtra(false);
                onChange(headersFrom(next));
              }}
            />
            <input
              className={cn(inputClass, 'min-w-0 flex-1 font-mono text-[13px]')}
              value={v}
              aria-label={`${label}: value ${i + 1}`}
              placeholder={valuePlaceholder}
              disabled={disabled || !k}
              onChange={(e) => onChange(headersFrom(shown.map((r, n): [string, string] => (n === i ? [r[0], e.target.value] : r))))}
            />
            <Button size="sm" variant="ghost" aria-label={`Remove ${k || 'row'}`} disabled={disabled} onClick={() => (i >= rows.length ? setExtra(false) : onChange(headersFrom(rows.filter((_, n) => n !== i))))}>
              <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        ))}
      </div>
      <Button size="sm" variant="ghost" className="mt-1" disabled={disabled || extra} onClick={() => setExtra(true)}>
        <PlusIcon className="h-3.5 w-3.5" aria-hidden />
        Add a row
      </Button>
    </fieldset>
  );
}

/** Move up / Move down buttons for one row of an ordered list. */
export function MoveButtons({ index, count, onMove, disabled, what }: { index: number; count: number; onMove: (to: number) => void; disabled: boolean; what: string }) {
  return (
    <span className="flex">
      <Button size="sm" variant="ghost" className="px-2" aria-label={`Move ${what} up`} disabled={disabled || index === 0} onClick={() => onMove(index - 1)}>
        <ArrowUpIcon className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <Button size="sm" variant="ghost" className="px-2" aria-label={`Move ${what} down`} disabled={disabled || index >= count - 1} onClick={() => onMove(index + 1)}>
        <ArrowDownIcon className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </span>
  );
}

/** A plain select. */
export function Select({ value, onChange, options, disabled, label, className }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; disabled: boolean; label: string; className?: string }) {
  return (
    <select className={cn(inputClass, className)} value={value} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** An empty list's message, with what to do. */
export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-subtle px-4 py-3 text-[13px] text-ink-soft">{children}</p>;
}

/** A short list typed with commas; kept as typed while it stands for the same list. */
export function ListInput({ value, onChange, disabled, label, placeholder }: { value: string[]; onChange: (v: string[]) => void; disabled: boolean; label: string; placeholder?: string }) {
  const split = (t: string) => t.split(',').map((x) => x.trim()).filter(Boolean);
  const [typed, setTyped] = useState(value.join(', '));
  const shown = split(typed).join('|') === value.join('|') ? typed : value.join(', ');
  return (
    <input
      className={inputClass}
      value={shown}
      disabled={disabled}
      aria-label={label}
      placeholder={placeholder}
      onChange={(e) => {
        setTyped(e.target.value);
        onChange(split(e.target.value));
      }}
    />
  );
}
