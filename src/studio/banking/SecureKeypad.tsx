import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react';
import Icon from '../../ui/Icon.jsx';
import Button from '../../ui/Button.tsx';
import type { KeypadView } from './useBankingChannel.ts';
import { cn, secureClass } from './ui.tsx';

const WARN_AT_S = 20;
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * The secure keypad for a PIN, NRIC digits or a one-time password. Drawn outside the conversation and styled as a
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
  /** null: the step needs a keypad but this device holds no token for it (expired, or opened before it connected). */
  keypad: KeypadView | null;
  busy: boolean;
  onSubmit: (value: string) => Promise<unknown>;
  onNewKeypad: () => void;
  footer?: ReactNode;
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

  // Cleared when it goes away (cancelled, signed out, conversation ended).
  useEffect(() => {
    const input = inputRef.current;
    return () => {
      if (input) input.value = '';
    };
  }, []);

  const remaining = keypad ? Math.max(0, Math.ceil((keypad.expiresAt - now) / 1000)) : 0;
  const expired = !keypad || remaining === 0;
  const max = keypad?.maxDigits ?? 6;
  const min = keypad?.minDigits ?? 6;
  const locked = busy || sent;

  const sync = () => {
    const input = inputRef.current;
    if (!input) return;
    const clean = input.value.replace(/\D/g, '').slice(0, max);
    if (clean !== input.value) input.value = clean;
    setCount(clean.length);
  };
  const press = (digit: string) => {
    const input = inputRef.current;
    if (!input || expired || locked) return;
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
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const input = inputRef.current;
    if (!input || expired || locked) return;
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
    <section aria-labelledby={`${id}-title`} className={secureClass}>
      <div className="tw-flex tw-items-center tw-gap-2">
        <span className="tw-flex tw-h-8 tw-w-8 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-bg-accent-soft tw-text-accent-ink">
          <Icon name="key" size={16} />
        </span>
        <div className="tw-min-w-0">
          <h3 id={`${id}-title`} className="tw-m-0 tw-text-md tw-font-semibold tw-text-ink">
            Secure keypad
          </h3>
          <p className="tw-m-0 tw-flex tw-items-center tw-gap-1 tw-text-xs tw-text-ink-soft">
            <span className="tw-text-success">
              <Icon name="shield" size={12} />
            </span>
            Goes straight to the bank. Not shown in the conversation or to the agent.
          </p>
        </div>
      </div>

      {expired ? (
        <div className="tw-mt-3 tw-space-y-2">
          <p className="tw-m-0 tw-text-sm tw-text-ink" role="status">
            {keypad ? 'This keypad has expired. Nothing you typed was sent.' : 'The next step needs the secure keypad.'}
          </p>
          <Button type="button" variant="primary" onClick={onNewKeypad} disabled={busy}>
            Open a new keypad
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="tw-mt-3 tw-space-y-3">
          <label htmlFor={id} className="tw-block tw-text-sm tw-font-medium tw-text-ink">
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
            disabled={locked}
            onInput={sync}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                clear();
              }
            }}
            className="tw-h-12 tw-w-full tw-rounded-control tw-border tw-border-solid tw-border-line-strong tw-bg-canvas tw-px-3 tw-text-center tw-font-mono tw-text-xl tw-tracking-[0.5em] tw-text-ink disabled:tw-opacity-60"
          />
          <div className="tw-flex tw-items-center tw-justify-between tw-text-xs">
            <span id={`${id}-count`} className="tw-text-ink-soft" aria-live="polite">
              {min === max ? `${count} of ${max} digits` : `${count} digits (${min} to ${max})`}
            </span>
            <span
              id={`${id}-time`}
              className={cn('tw-flex tw-items-center tw-gap-1', remaining <= WARN_AT_S ? 'tw-font-medium tw-text-warning' : 'tw-text-muted')}
            >
              <Icon name="timer" size={12} />
              {remaining}s left
            </span>
          </div>
          {remaining <= WARN_AT_S && (
            <p className="tw-m-0 tw-text-xs tw-text-warning" role="status">
              This keypad closes soon. If you need more time, open a new one; the conversation stays open.
            </p>
          )}

          <div className="tw-grid tw-grid-cols-3 tw-gap-2" role="group" aria-label="On-screen digits">
            {DIGITS.map((d) => (
              <KeyButton key={d} onClick={() => press(d)} disabled={locked}>
                {d}
              </KeyButton>
            ))}
            <KeyButton onClick={clear} disabled={locked} aria-label="Clear all digits" className="tw-text-sm">
              Clear
            </KeyButton>
            <KeyButton onClick={() => press('0')} disabled={locked}>
              0
            </KeyButton>
            <KeyButton onClick={backspace} disabled={locked} aria-label="Delete last digit">
              <Icon name="backspace" size={16} />
            </KeyButton>
          </div>

          <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
            <Button type="submit" variant="primary" className="tw-flex-1" disabled={!ready || locked}>
              {locked ? (
                <>
                  <Icon name="loader" size={16} className="tw-animate-spin motion-reduce:tw-animate-none" />
                  Checking…
                </>
              ) : (
                'Submit'
              )}
            </Button>
            {remaining <= WARN_AT_S && (
              <Button type="button" variant="secondary" onClick={onNewKeypad} disabled={busy}>
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

function KeyButton({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'tw-flex tw-h-11 tw-min-w-[44px] tw-items-center tw-justify-center tw-rounded-control tw-border tw-border-solid tw-border-line-strong tw-bg-subtle tw-font-mono tw-text-lg tw-text-ink tw-transition-colors hover:tw-bg-canvas disabled:tw-opacity-50 motion-reduce:tw-transition-none',
        className,
      )}
      {...rest}
    />
  );
}
