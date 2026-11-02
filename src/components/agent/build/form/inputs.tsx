import React, { useEffect, useId, useRef, useState } from 'react';
import { KeyRoundIcon, PlusIcon, XIcon } from 'lucide-react';
import { Toggle } from '../../../ui/Toggle';
import { parseJsonStrict, readFreeValue, showFreeValue } from '../../../../models/schemaForm/freeValue';
import { cn, inputClass, inputErrorClass } from '../../../../utils/styles';

// The controls the settings form draws a value with. Each takes the value and says the new one; none writes to the
// draft itself.

const box = (invalid?: boolean, extra?: string | false) => cn(inputClass, invalid && inputErrorClass, extra);

interface BaseProps {
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
}

export function TextInput({ id, value, onChange, placeholder, disabled, multiline, invalid, mono }: BaseProps & {
  value: unknown;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  mono?: boolean;
}) {
  const text = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
  if (multiline)
    return (
      <textarea
        id={id}
        rows={Math.min(10, Math.max(3, text.split('\n').length + 1))}
        className={box(invalid, cn('resize-y leading-relaxed', mono && 'font-mono text-[13px]'))}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  return (
    <input
      id={id}
      type="text"
      className={box(invalid, mono && 'font-mono text-[13px]')}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      spellCheck={mono ? false : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * A number. Clearing the box never deletes the setting (Reset does that): a nullable number becomes null, any other
 * keeps its last value until a new number is typed, and shows it again on leaving the box.
 */
export function NumberInput({ id, value, onChange, min, max, integer, nullable, disabled, invalid, placeholder, unit }: BaseProps & {
  value: unknown;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  nullable?: boolean;
  placeholder?: string;
  unit?: string;
}) {
  const toText = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  const [text, setText] = useState(toText(value));
  useEffect(() => {
    const incoming = toText(value);
    setText((current) => (Number(current) === Number(incoming) && (current === '') === (incoming === '') ? current : incoming));
  }, [value]);
  return (
    <span className="flex items-center gap-2">
      <input
        id={id}
        type="number"
        className={box(invalid, 'w-40')}
        inputMode={integer ? 'numeric' : 'decimal'}
        step={integer ? 1 : 'any'}
        min={min}
        max={max}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (raw.trim() === '') {
            if (nullable) onChange(null);
            return;
          }
          const n = Number(raw);
          if (!Number.isNaN(n)) onChange(integer ? Math.round(n) : n);
        }}
        onBlur={() => setText(toText(value))}
      />
      {unit && <span className="text-[13px] text-muted">{unit}</span>}
    </span>
  );
}

export function Switch({ id, checked, onChange, disabled, label }: { id?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <Toggle id={id} checked={checked} onChange={onChange} label={label} disabled={disabled} />
      <span className="text-[13px] text-ink-soft" aria-hidden>
        {checked ? 'On' : 'Off'}
      </span>
    </span>
  );
}

/** One of a few choices, each in words (`labels`), the stored value unchanged. */
export function Select({ id, value, options, onChange, disabled, placeholder, invalid, labels }: BaseProps & {
  value: unknown;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
  labels?: Record<string, string>;
}) {
  const current = value === undefined || value === null ? '' : String(value);
  const known = current === '' || options.includes(current);
  return (
    <select id={id} className={box(invalid)} value={current} disabled={disabled} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)}>
      {current === '' && <option value="">{placeholder || 'Choose…'}</option>}
      {!known && <option value={current}>{current} (not in the list)</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? o}
        </option>
      ))}
    </select>
  );
}

/** A list of texts, one box each, with Add and a remove button per line. */
export function StringList({ values, onChange, placeholder, disabled, label }: {
  values: string[];
  onChange: (v: string[], meta?: { deleted?: string }) => void;
  placeholder?: string;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="space-y-1.5">
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="text"
            className={inputClass}
            value={v}
            placeholder={placeholder}
            disabled={disabled}
            aria-label={`${label}, line ${i + 1}`}
            onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button
            type="button"
            disabled={disabled}
            aria-label={`Remove line ${i + 1}`}
            title="Remove"
            onClick={() => onChange(values.filter((_, j) => j !== i), { deleted: `“${v || 'empty line'}”` })}
            className="rounded-md p-1.5 text-muted hover:bg-subtle hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50">
            <XIcon className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...values, ''])}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] font-medium text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50">
        <PlusIcon className="h-3.5 w-3.5" aria-hidden />
        Add a line
      </button>
    </div>
  );
}

/** Ids picked from another list: chips with a remove button, and the ones not yet picked to add. */
export function MultiPick({ options, values, onChange, disabled, emptyText, labels, label }: {
  options: string[];
  values: string[];
  onChange: (v: string[], meta?: { deleted?: string }) => void;
  disabled?: boolean;
  emptyText: string;
  labels?: Record<string, string>;
  label: string;
}) {
  const left = options.filter((o) => !values.includes(o));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {values.length === 0 && <span className="text-[13px] text-muted">{emptyText}</span>}
      {values.map((v, i) => (
        <span key={`${v}-${i}`} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[13px]', options.includes(v) ? 'border-line bg-subtle text-ink' : 'border-danger/40 bg-danger-soft text-danger')}>
          {labels?.[v] ?? v}
          {!options.includes(v) && <span className="sr-only">(does not exist)</span>}
          <button
            type="button"
            disabled={disabled}
            aria-label={`Remove ${labels?.[v] ?? v}`}
            onClick={() => onChange(values.filter((x) => x !== v), { deleted: `“${v}”` })}
            className="rounded-full text-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <XIcon className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      {left.length > 0 && (
        <select
          aria-label={`Add to ${label}`}
          disabled={disabled}
          value=""
          onChange={(e) => e.target.value && onChange([...values, e.target.value])}
          className="rounded-md border border-dashed border-line-strong bg-surface px-2 py-0.5 text-[13px] text-accent focus:outline-none focus:ring-2 focus:ring-accent/20">
          <option value="">Add…</option>
          {left.map((o) => (
            <option key={o} value={o}>
              {labels?.[o] ?? o}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** A few fixed values, ticked on or off. */
export function CheckGroup({ options, values, onChange, disabled, labels }: {
  options: string[];
  values: unknown[];
  onChange: (v: string[], meta?: { deleted?: string }) => void;
  disabled?: boolean;
  labels?: Record<string, string>;
}) {
  const on = values.map(String);
  const shown = [...options, ...on.filter((v) => !options.includes(v))];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {shown.map((o) => (
        <label key={o} className="inline-flex items-center gap-1.5 text-[13px] text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-line-strong accent-accent"
            checked={on.includes(o)}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked ? [...on, o] : on.filter((x) => x !== o), e.target.checked ? undefined : { deleted: `“${labels?.[o] ?? o}”` })}
          />
          {labels?.[o] ?? o}
        </label>
      ))}
    </div>
  );
}

/** A value the form has no plain control for, as JSON. Applied only while it is valid JSON. */
export function JsonInput({ id, value, onChange, disabled }: { id?: string; value: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  const pretty = (v: unknown) => JSON.stringify(v === undefined ? {} : v, null, 2);
  const [text, setText] = useState(() => pretty(value));
  const [error, setError] = useState('');
  const last = useRef(value);
  useEffect(() => {
    if (JSON.stringify(value) !== JSON.stringify(last.current)) {
      last.current = value;
      setText(pretty(value));
      setError('');
    }
  }, [value]);
  return (
    <div>
      <textarea
        id={id}
        className={box(!!error, 'resize-y font-mono text-[13px] leading-relaxed')}
        rows={Math.min(14, Math.max(3, text.split('\n').length + 1))}
        spellCheck={false}
        value={text}
        disabled={disabled}
        aria-invalid={!!error || undefined}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          try {
            const parsed = parseJsonStrict(raw);
            last.current = parsed;
            setError('');
            onChange(parsed);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Not valid JSON');
          }
        }}
        onBlur={() => {
          if (!error) setText(pretty(last.current));
        }}
      />
      {error && <p className="mt-1 text-[13px] text-danger">Not valid JSON yet, so this isn’t applied: {error}</p>}
    </div>
  );
}

/** A value of any kind in one line: JSON when it reads as JSON, else text. A key written twice is held back. */
export function FreeValue({ id, value, onChange, disabled, label }: { id?: string; value: unknown; onChange: (v: unknown) => void; disabled?: boolean; label?: string }) {
  const [text, setText] = useState(showFreeValue(value));
  const [problem, setProblem] = useState('');
  const last = useRef(value);
  useEffect(() => {
    if (JSON.stringify(value) !== JSON.stringify(last.current)) {
      last.current = value;
      setText(showFreeValue(value));
    }
  }, [value]);
  return (
    <div>
      <input
        id={id}
        type="text"
        className={box(!!problem)}
        spellCheck={false}
        disabled={disabled}
        value={text}
        aria-label={label}
        aria-invalid={!!problem || undefined}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          const read = readFreeValue(raw);
          if ('problem' in read) {
            setProblem(read.problem);
            return;
          }
          setProblem('');
          last.current = read.value;
          onChange(read.value);
        }}
      />
      {problem && <p className="mt-1 text-[13px] text-danger">Not applied: {problem}</p>}
    </div>
  );
}

/** The name of a secret the server keeps ({ "secret": NAME }): never a value. Names in the draft are suggested. */
export function SecretInput({ id, value, onChange, disabled, names }: { id?: string; value: unknown; onChange: (v: { secret: string }) => void; disabled?: boolean; names: string[] }) {
  const listId = useId();
  const name = value && typeof value === 'object' && typeof (value as { secret?: unknown }).secret === 'string' ? String((value as { secret: string }).secret) : '';
  return (
    <div>
      <div className="relative">
        <KeyRoundIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
        <input
          id={id}
          type="text"
          className={cn(inputClass, 'pl-8 font-mono text-[13px]')}
          spellCheck={false}
          list={listId}
          value={name}
          disabled={disabled}
          placeholder="SECRET_NAME"
          onChange={(e) => onChange({ secret: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
        />
        <datalist id={listId}>
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </div>
      <p className="mt-1 text-[12px] text-muted">The name of a secret kept on the server. Admins set its value there; Studio never sees it.</p>
    </div>
  );
}
