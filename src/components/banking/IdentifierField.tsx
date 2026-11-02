import React, { useId, useRef, useState } from 'react';
import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { cn, inputClass, inputErrorClass } from '../../utils/styles';

/**
 * The Phone Code or account number. Masked by default; the eye button shows it only when the gateway's policy allows
 * (`revealAllowed`). The field is uncontrolled: React holds how many digits were typed, never the digits, and the
 * input is cleared as soon as it is submitted.
 */
export function IdentifierField({
  label,
  digits,
  revealAllowed,
  busy,
  onSubmit,
  help,
}: {
  label: string;
  digits: number;
  revealAllowed: boolean;
  busy: boolean;
  onSubmit: (value: string) => Promise<unknown> | void;
  help?: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const digitsIn = () => (inputRef.current?.value ?? '').replace(/[\s-]/g, '');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = digitsIn();
    if (!/^\d+$/.test(value)) {
      setProblem(`Use digits only. Your ${label} has ${digits} digits.`);
      inputRef.current?.focus();
      return;
    }
    if (value.length !== digits) {
      setProblem(`Your ${label} has ${digits} digits; you entered ${value.length}.`);
      inputRef.current?.focus();
      return;
    }
    setProblem(null);
    if (inputRef.current) inputRef.current.value = '';
    setCount(0);
    setRevealed(false);
    await onSubmit(value);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <p id={hintId} className="text-[13px] text-muted">
        {digits} digits. Spaces and dashes are fine.
      </p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            id={id}
            name="banking-identifier"
            type={revealed ? 'text' : 'password'}
            inputMode="numeric"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={digits + 4}
            aria-describedby={problem ? `${hintId} ${errorId}` : hintId}
            aria-invalid={problem ? true : undefined}
            disabled={busy}
            onInput={() => {
              setCount(digitsIn().replace(/\D/g, '').length);
              if (problem) setProblem(null);
            }}
            className={cn(inputClass, 'h-11 font-mono tracking-widest', revealAllowed && 'pr-11', problem && inputErrorClass)}
          />
          {revealAllowed && (
            <button
              type="button"
              aria-controls={id}
              aria-pressed={revealed}
              aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
              onClick={() => setRevealed((v) => !v)}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {revealed ? <EyeOffIcon className="h-4 w-4" aria-hidden /> : <EyeIcon className="h-4 w-4" aria-hidden />}
            </button>
          )}
        </div>
        <Button type="submit" variant="primary" className="h-11" disabled={busy}>
          Continue
        </Button>
      </div>
      <p className="text-[12px] text-muted" aria-live="polite">
        {count > 0 && count !== digits ? `${count} of ${digits} digits` : count === digits ? `${digits} digits entered` : ''}
      </p>
      {problem && (
        <p id={errorId} role="alert" className="text-[13px] text-danger">
          {problem}
        </p>
      )}
      {help}
    </form>
  );
}
