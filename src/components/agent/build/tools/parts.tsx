import React from 'react';
import { ChevronDownIcon, ChevronUpIcon, XIcon } from 'lucide-react';
import { cn, inputClass } from '../../../../utils/styles';

// Small pieces the tool panel is built from, so every part of it reads the same.

/** One part of a tool's panel, with its heading and a line on what it is for. */
export function Block({ title, lead, children, className }: { title: string; lead?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn('rounded-lg border border-line px-4 py-4', className)}>
      <h4 className="text-sm font-semibold text-ink">{title}</h4>
      {lead && <p className="mt-0.5 text-[13px] text-muted">{lead}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </section>);

}

/** A label above a control, with an optional line of help under it. */
export function Labelled({ label, help, htmlFor, children, aside }: { label: string; help?: React.ReactNode; htmlFor?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-soft">{label}</label>
        {aside}
      </div>
      {children}
      {help && <p className="mt-1 text-xs leading-relaxed text-muted">{help}</p>}
    </div>);

}

export type Tone = 'muted' | 'warn' | 'error' | 'ok';
const toneClass: Record<Tone, string> = { muted: 'text-muted', warn: 'text-warning', error: 'text-danger', ok: 'text-success' };

/** A short note under a control. */
export function Note({ tone = 'muted', children, role }: { tone?: Tone; children: React.ReactNode; role?: string }) {
  return <p role={role} className={cn('text-xs leading-relaxed', toneClass[tone])}>{children}</p>;
}

/** A choice of ids this config has; one that is set but missing is still shown, marked. */
export function IdSelect({ value, options, onChange, disabled, label, placeholder = 'Choose…', id, className }: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
  label: string;
  placeholder?: string;
  id?: string;
  className?: string;
}) {
  const missing = value && !options.includes(value);
  return (
    <select id={id} aria-label={label} className={cn(inputClass, className)} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{options.length ? placeholder : 'None yet'}</option>
      {missing && <option value={value}>{value} (not found)</option>}
      {options.map((o) =>
      <option key={o} value={o}>{o}</option>
      )}
    </select>);

}

/** Move up, move down and delete buttons for one item of an ordered list. */
export function OrderButtons({ index, count, name, onMove, onDelete, disabled }: {
  index: number;
  count: number;
  name: string;
  onMove: (to: number) => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  if (disabled) return null;
  const button = 'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 disabled:pointer-events-none';
  return (
    <span className="flex items-center gap-0.5">
      <button type="button" className={button} aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => onMove(index - 1)}>
        <ChevronUpIcon className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" className={button} aria-label={`Move ${name} down`} disabled={index === count - 1} onClick={() => onMove(index + 1)}>
        <ChevronDownIcon className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" className={cn(button, 'hover:bg-danger-soft hover:text-danger')} aria-label={`Delete ${name}`} onClick={onDelete}>
        <XIcon className="h-4 w-4" aria-hidden />
      </button>
    </span>);

}
