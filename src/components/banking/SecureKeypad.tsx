import React, { useEffect, useId, useRef, useState } from 'react';
import { DeleteIcon, KeyRoundIcon, LoaderCircleIcon, ShieldCheckIcon, TimerIcon } from 'lucide-react';
import type { KeypadView } from '../../hooks/useBankingChannel';
import { Button } from '../ui/Button';
import { cn } from '../../utils/styles';

const WARN_AT_S = 20;

/**
 * The secure keypad for a PIN, NRIC digits or a one-time password. Rendered outside the transcript and styled as a
 * system surface, so a chat message cannot imitate it.
 *
 * The input is uncontrolled and always masked (there is deliberately no eye button). React state holds only how many
 * digits were keyed; the value is read from the input on submit, handed to `onSubmit`, and the input is cleared
 * before the request goes out. Paste and SMS autofill are allowed (WCAG 3.3.8).
 */
export function SecureKeypad({
  keypad,
  busy,
  onSubmit,
  onNewKeypad,
  footer,
}: {
  keypad: KeypadView | null;
  /** The step needs a keypad but this device holds no token for it (expired, or opened before it connected). */
  busy: boolean;
  onSubmit: (value: string) => Promise<unknown>;
  onNewKeypad: () => void;
  footer?: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [sent, setSent] = useState(false);
  const id = useId();

  // A new keypad starts empty.
  useEffect(() => {
    if (inputRef.current) inputRef.current.value = '';
    setCount(0);
    setSent(false);
  }, [keypad?.id]);

  useEffect(() => {
    if (!keypad) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [keypad]);

  // Clear on unmount (cancelled, signed out, conversation ended).
  useEffect(
    () => () => {
      if (inputRef.current) inputRef.current.value = '';
    },
    []
  );

  const remaining = keypad ? Math.max(0, Math.ceil((keypad.expiresAt - now) / 1000)) : 0;
  const expired = !keypad || remaining === 0;
  const max = keypad?.maxDigits ?? 6;
  const min = keypad?.minDigits ?? 6;

  const sync = () => {
    const input = inputRef.current;
    if (!input) return;
    const clean = input.value.replace(/\D/g, '').slice(0, max);
    if (clean !== input.value) input.value = clean;
    setCount(clean.length);
  };

  const press = (digit: string) => {
    const input = inputRef.current;
    if (!input || expired || busy) return;
    if (input.value.length < max) input.value += digit;
    sync();
    input.focus();
  };

  const backspace = () => {
    const input = inputRef.current;
    if (!input) return;
    input.value = input.value.slice(0, -1);
    sync();
    input.focus();
  };

  const clear = () => {
    if (inputRef.current) inputRef.current.value = '';
    setCount(0);
    inputRef.current?.focus();
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const input = inputRef.current;
    if (!input || expired || busy || sent) return;
    const value = input.value.replace(/\D/g, '');
    if (value.length < min || value.length > max) return;
    input.value = '';
    setCount(0);
    setSent(true);
    await onSubmit(value);
  };

  const label = keypad?.label ?? 'secure entry';
  const ready = count >= min && count <= max;

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-xl border-2 border-primary/40 bg-surface p-4 shadow-panel">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-primary">
          <KeyRoundIcon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="text-sm font-semibold text-ink">
            Secure keypad
          </h3>
          <p className="flex items-center gap-1 text-[12px] text-ink-soft">
            <ShieldCheckIcon className="h-3 w-3 text-success" aria-hidden />
            Goes straight to the bank. Not shown in the chat or to the assistant.
          </p>
        </div>
      </div>

      {expired ? (
        <div className="mt-3 space-y-2">
          <p className="text-[13px] text-ink" role="status">
            {keypad ? 'This keypad has expired. Nothing you typed was sent.' : 'The next step needs the secure keypad.'}
          </p>
          <Button variant="primary" onClick={onNewKeypad} disabled={busy} className="h-11">
            Open a new keypad
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <label htmlFor={id} className="block text-sm font-medium text-ink">
            Key in your {label}
          </label>
          <input
            ref={inputRef}
            id={id}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={keypad?.purpose === 'otp' ? 'one-time-code' : 'off'}
            maxLength={max}
            aria-describedby={`${id}-count ${id}-time`}
            disabled={busy || sent}
            onInput={sync}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                clear();
              }
            }}
            className="h-12 w-full rounded-md border border-line-strong bg-canvas px-3 text-center font-mono text-xl tracking-[0.5em] text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
          />
          <div className="flex items-center justify-between text-[12px]">
            <span id={`${id}-count`} className="text-ink-soft" aria-live="polite">
              {min === max ? `${count} of ${max} digits` : `${count} digits (${min} to ${max})`}
            </span>
            <span id={`${id}-time`} className={cn('flex items-center gap-1', remaining <= WARN_AT_S ? 'font-medium text-warning' : 'text-muted')}>
              <TimerIcon className="h-3 w-3" aria-hidden />
              {remaining}s left
            </span>
          </div>
          {remaining <= WARN_AT_S && (
            <p className="text-[12px] text-warning" role="status">
              This keypad closes soon. If you need more time, open a new one; the conversation stays open.
            </p>
          )}

          <div className="grid grid-cols-3 gap-2" role="group" aria-label="On-screen digits">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <KeyButton key={d} onClick={() => press(d)} disabled={busy || sent}>
                {d}
              </KeyButton>
            ))}
            <KeyButton onClick={clear} disabled={busy || sent} aria-label="Clear all digits" className="text-[13px]">
              Clear
            </KeyButton>
            <KeyButton onClick={() => press('0')} disabled={busy || sent}>
              0
            </KeyButton>
            <KeyButton onClick={backspace} disabled={busy || sent} aria-label="Delete last digit">
              <DeleteIcon className="h-4 w-4" aria-hidden />
            </KeyButton>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" className="h-11 flex-1" disabled={!ready || busy || sent}>
              {busy || sent ? (
                <>
                  <LoaderCircleIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                  Checking…
                </>
              ) : (
                'Submit'
              )}
            </Button>
            {remaining <= WARN_AT_S && (
              <Button variant="secondary" className="h-11" onClick={onNewKeypad} disabled={busy}>
                I need more time
              </Button>
            )}
          </div>
        </form>
      )}
      {footer}
    </section>
  );
}

function KeyButton({ className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-11 min-w-[44px] items-center justify-center rounded-md border border-line-strong bg-subtle font-mono text-lg text-ink transition-colors hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 motion-reduce:transition-none',
        className
      )}
      {...rest}
    />
  );
}
