import React, { useEffect, useRef, useState } from 'react';
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { StatusChip } from '../../../ui/StatusChip';
import { cn, inputClass, inputErrorClass } from '../../../../utils/styles';
import { monoInput, smallInput } from './inputStyles';
import { parseObject, parseValue, showValue, type Choice } from '../../../../models/scenario';

// Small pieces the scenario, caller and check panels share: a calm notice, status chips, compact inputs and a JSON box.

type Tone = 'info' | 'warning' | 'danger' | 'success';
const toneBox: Record<Tone, string> = {
  info: 'border-info/30 bg-info-soft/40',
  warning: 'border-warning/30 bg-warning-soft/40',
  danger: 'border-danger/30 bg-danger-soft/40',
  success: 'border-success/30 bg-success-soft/40',
};
const toneIcon: Record<Tone, React.ReactNode> = {
  info: <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />,
  warning: <TriangleAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />,
  danger: <CircleAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />,
  success: <CircleCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />,
};

/** A boxed message with a title, some words and optional buttons. */
export function Notice({
  tone = 'info',
  title,
  children,
  actions,
  className,
  role,
}: {
  tone?: Tone;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  role?: 'status' | 'alert' | 'note';
}) {
  return (
    <div
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
      className={cn('flex flex-wrap items-start justify-between gap-3 rounded-xl border px-4 py-3', toneBox[tone], className)}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {toneIcon[tone]}
        <div className="min-w-0 text-[13px] leading-relaxed text-ink-soft">
          <p className="font-medium text-ink">{title}</p>
          {children && <div className="mt-0.5">{children}</div>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const STATUS: Record<string, [string, 'success' | 'danger' | 'neutral' | 'info']> = {
  passed: ['Passed', 'success'],
  failed: ['Failed', 'danger'],
  error: ['Broke', 'danger'],
  skipped: ['Skipped', 'neutral'],
  running: ['Running…', 'info'],
};

/** A scenario's or run's status as a chip; nothing yet reads "Not run". */
export function RunChip({ status, title }: { status?: string | null; title?: string }) {
  const [text, tone] = (status && STATUS[status]) || ['Not run', 'neutral'];
  return (
    <StatusChip tone={tone} dot={!!status} title={title}>
      {text}
    </StatusChip>
  );
}

/** Scripted (free, the same every time) or live (a real model: costs money). */
export function ModeChip({ mode }: { mode: 'live' | 'scripted' }) {
  return mode === 'live' ? (
    <StatusChip tone="warning" title="Uses a real language model when run: costs money, and can differ from run to run">
      Live
    </StatusChip>
  ) : (
    <StatusChip title="Runs the real runtime with a scripted model: free and the same every time">Scripted</StatusChip>
  );
}

/** A native select in Studio's input style. */
export function Select({
  value,
  onChange,
  label,
  options,
  placeholder,
  invalid,
  className,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: Array<Choice | string>;
  placeholder?: string;
  invalid?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  const items = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const known = items.some((o) => o.value === value);
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)}
      className={cn(smallInput, 'pr-7', invalid && inputErrorClass, className)}
    >
      {(placeholder !== undefined || !known) && <option value="">{placeholder ?? 'Choose…'}</option>}
      {!known && value && <option value={value}>{value} (not in this agent)</option>}
      {items.map((o) => (
        <option key={o.value} value={o.value} title={o.description}>
          {o.description ? `${o.label} (${o.description})` : o.label}
        </option>
      ))}
    </select>
  );
}

/** A small round button with only an icon (its words are its label). */
export function IconButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40"
    >
      <XIcon className="h-4 w-4" aria-hidden />
    </button>
  );
}

/** An error line under a field. */
export const FieldError = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-1 flex items-start gap-1.5 text-xs text-danger">
    <CircleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
    <span>{children}</span>
  </p>
);

/**
 * A box for a JSON object or value: keeps what is typed, passes up only what parses, and says what is wrong if not.
 * `onValid` tells the form when the box holds something that does not parse, so Save can say so.
 */
export function JsonBox({
  value,
  onChange,
  label,
  rows = 3,
  placeholder,
  objectOnly = true,
  onValid,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  label: string;
  rows?: number;
  placeholder?: string;
  objectOnly?: boolean;
  onValid?: (id: string, ok: boolean) => void;
}) {
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)));
  const [error, setError] = useState('');
  const id = React.useId();
  const mine = useRef(JSON.stringify(value));
  useEffect(() => {
    onValid?.(id, !error);
    return () => onValid?.(id, true);
  }, [error, id, onValid]);
  useEffect(() => {
    // The value changed from somewhere else (another mock, a reset): show it, unless it is what was just typed.
    if (JSON.stringify(value) !== mine.current) {
      mine.current = JSON.stringify(value);
      setText(value === undefined ? '' : JSON.stringify(value, null, 2));
      setError('');
    }
  }, [value]);
  const change = (next: string) => {
    setText(next);
    if (!next.trim()) {
      setError('');
      mine.current = JSON.stringify(undefined);
      onChange(undefined);
      return;
    }
    if (objectOnly) {
      const parsed = parseObject(next);
      if (parsed.error) return setError(parsed.error);
      setError('');
      mine.current = JSON.stringify(parsed.value);
      onChange(parsed.value);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(next);
      setError('');
      mine.current = JSON.stringify(parsed);
      onChange(parsed);
    } catch (e) {
      setError(`Not valid JSON (${e instanceof Error ? e.message : String(e)}).`);
    }
  };
  return (
    <span className="block min-w-0 flex-1">
      <textarea
        className={cn(inputClass, 'px-2.5 py-1.5 font-mono text-xs', error && inputErrorClass)}
        rows={rows}
        value={text}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={!!error || undefined}
        spellCheck={false}
        onChange={(e) => change(e.target.value)}
      />
      {error && <FieldError>{error}</FieldError>}
    </span>
  );
}

/** A state value box that keeps the typed text ("not paid") and passes up what it means (true, 3, "not paid"). */
export function ValueBox({ value, onChange, label, placeholder }: { value: unknown; onChange: (v: unknown) => void; label: string; placeholder?: string }) {
  const shown = (v: unknown) => (v === undefined ? '' : showValue(v));
  const [text, setText] = useState(() => shown(value));
  const mine = useRef(JSON.stringify(value));
  useEffect(() => {
    if (JSON.stringify(value) !== mine.current) {
      mine.current = JSON.stringify(value);
      setText(shown(value));
    }
  }, [value]);
  return (
    <input
      type="text"
      className={monoInput}
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const parsed = parseValue(e.target.value);
        setText(e.target.value);
        mine.current = JSON.stringify(parsed);
        onChange(parsed);
      }}
    />
  );
}

/** A labelled block inside a card. */
export function Section({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-line p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</legend>
      {hint && <p className="mb-2 text-xs leading-relaxed text-muted">{hint}</p>}
      {children}
    </fieldset>
  );
}
