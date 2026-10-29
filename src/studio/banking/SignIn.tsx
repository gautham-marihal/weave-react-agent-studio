import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Icon from '../../ui/Icon.jsx';
import Button from '../../ui/Button.tsx';
import type { AuthMethodId, AuthMethodView, ChannelState } from '../../api/gatewayTypes.ts';
import { methodOfState } from './format.ts';
import { HelpTopic } from './Guidance.tsx';
import { cn, inputClass, panelClass } from './ui.tsx';

type Identifier = { phone_code: string } | { account_number: string };

/**
 * Sign-in before verification: the methods the gateway offers on this channel, what each needs, and the identifier
 * step. Secrets are not entered here: the secure keypad takes them. During a step, a progress list shows where the
 * caller is, from the gateway's state.
 */
export function SignInPanel({
  state,
  busy,
  onIdentify,
  preferred = null,
}: {
  state: ChannelState;
  busy: boolean;
  onIdentify: (identifier: Identifier) => Promise<boolean>;
  /** A method chosen elsewhere (in the conversation): chosen here too, so the caller is not asked twice. */
  preferred?: AuthMethodId | null;
}) {
  const id = useId();
  const inProgress = methodOfState(state.auth.state);
  const usable = state.methods.filter((m) => m.available);
  const [chosen, setChosen] = useState<AuthMethodId | null>(usable.length === 1 ? (usable[0]?.id ?? null) : null);
  useEffect(() => {
    if (preferred && state.methods.some((m) => m.id === preferred && m.available)) setChosen(preferred);
  }, [preferred, state.methods]);
  const method = state.methods.find((m) => m.id === (inProgress ?? chosen));
  const identifierHelp = method ? state.help[method.identifier.help] : undefined;

  if (inProgress && method) return <Progress method={method} state={state} />;

  return (
    <section aria-labelledby={`${id}-title`} className="tw-space-y-3">
      <div>
        <h3 id={`${id}-title`} className="tw-m-0 tw-text-md tw-font-semibold tw-text-ink">
          How would you like to verify?
        </h3>
        <p className="tw-m-0 tw-text-sm tw-text-muted">Choose the details you have with you. You can switch before you finish.</p>
      </div>
      <div role="radiogroup" aria-labelledby={`${id}-title`} className="tw-grid tw-gap-2">
        {state.methods.map((m) => (
          <MethodCard key={m.id} method={m} selected={chosen === m.id} onSelect={() => setChosen(m.id)} />
        ))}
      </div>
      {method?.available && (
        <div className={panelClass}>
          <IdentifierField
            key={method.id}
            label={method.identifier.label}
            digits={method.identifier.digits}
            revealAllowed={method.identifier.reveal_allowed}
            busy={busy}
            onSubmit={(value) => onIdentify(method.identifier.field === 'phone_code' ? { phone_code: value } : { account_number: value })}
            help={identifierHelp && <HelpTopic entry={identifierHelp} />}
          />
        </div>
      )}
    </section>
  );
}

function MethodCard({ method, selected, onSelect }: { method: AuthMethodView; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={!method.available}
      onClick={() => method.available && onSelect()}
      className={cn(
        'tw-flex tw-min-h-[44px] tw-w-full tw-flex-col tw-items-start tw-gap-1 tw-rounded-control tw-border tw-border-solid tw-p-3 tw-text-left tw-transition-colors motion-reduce:tw-transition-none',
        selected ? 'tw-border-accent tw-bg-accent-soft' : 'tw-border-line tw-bg-surface hover:tw-bg-subtle',
        !method.available && 'tw-cursor-not-allowed tw-opacity-60',
      )}
    >
      <span className="tw-text-md tw-font-medium tw-text-ink">{method.label}</span>
      <span className="tw-text-xs tw-leading-relaxed tw-text-ink-soft">{method.summary}</span>
      <span className="tw-mt-1 tw-text-xs tw-text-muted">
        You’ll need: {method.identifier.label}
        {method.secure_steps.map((s) => `, ${s.label}`).join('')}
      </span>
      {!method.available && method.unavailable_reason && <span className="tw-mt-1 tw-text-xs tw-text-warning">{method.unavailable_reason}</span>}
    </button>
  );
}

function Progress({ method, state }: { method: AuthMethodView; state: ChannelState }) {
  const steps = [{ key: 'identifier', label: method.identifier.label }, ...method.secure_steps.map((s) => ({ key: s.purpose, label: s.label }))];
  const current = state.auth.state === 'awaiting_pin' || state.auth.state === 'awaiting_nric' ? 1 : state.auth.state === 'awaiting_otp' ? 2 : 0;
  const stepHelpId = method.secure_steps[current - 1]?.help;
  const stepHelp = stepHelpId ? state.help[stepHelpId] : undefined;
  return (
    <section aria-label="Verification progress" className="tw-space-y-2">
      <p className="tw-m-0 tw-text-md tw-font-semibold tw-text-ink">{method.label}</p>
      <ol className="tw-m-0 tw-list-none tw-space-y-1 tw-p-0">
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li
              key={s.key}
              className={cn('tw-flex tw-items-center tw-gap-2 tw-text-sm', done ? 'tw-text-success' : active ? 'tw-font-medium tw-text-ink' : 'tw-text-muted')}
              aria-current={active ? 'step' : undefined}
            >
              <Icon
                name={done ? 'done' : active ? 'loader' : 'pending'}
                size={14}
                className={active ? 'tw-animate-spin motion-reduce:tw-animate-none [animation-duration:2.5s]' : undefined}
              />
              {s.label}
              {done && <span className="srOnly">(done)</span>}
              {active && <span className="srOnly">(current step)</span>}
            </li>
          );
        })}
      </ol>
      {stepHelp && <HelpTopic entry={stepHelp} />}
      {state.help.why_not_spoken && <HelpTopic entry={state.help.why_not_spoken} />}
    </section>
  );
}

/**
 * The Phone Code or account number. Masked by default; the eye button shows it only when the gateway's policy allows
 * (`revealAllowed`). The field is uncontrolled: React holds how many digits were typed, never the digits, and the
 * input is cleared as soon as it is submitted.
 */
function IdentifierField({
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
  onSubmit: (value: string) => Promise<unknown>;
  help?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const digitsIn = () => (inputRef.current?.value ?? '').replace(/[\s-]/g, '');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
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
    <form onSubmit={submit} noValidate className="tw-space-y-2">
      <label htmlFor={id} className="tw-block tw-text-md tw-font-medium tw-text-ink">
        {label}
      </label>
      <p id={hintId} className="tw-m-0 tw-text-sm tw-text-muted">
        {digits} digits. Spaces and dashes are fine.
      </p>
      <div className="tw-flex tw-gap-2">
        <div className="tw-relative tw-flex-1">
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
            className={cn(inputClass, 'tw-h-11 tw-font-mono tw-tracking-widest', revealAllowed && 'tw-pr-11', problem && 'tw-border-danger')}
          />
          {revealAllowed && (
            <button
              type="button"
              aria-controls={id}
              aria-pressed={revealed}
              aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
              onClick={() => setRevealed((v) => !v)}
              className="tw-absolute tw-inset-y-0 tw-right-0 tw-flex tw-w-11 tw-items-center tw-justify-center tw-border-0 tw-bg-transparent tw-text-muted hover:tw-text-ink"
            >
              <Icon name={revealed ? 'eyeOff' : 'eye'} size={16} />
            </button>
          )}
        </div>
        <Button type="submit" variant="primary" disabled={busy}>
          Continue
        </Button>
      </div>
      <p className="tw-m-0 tw-min-h-4 tw-text-xs tw-text-muted" aria-live="polite">
        {count > 0 && count !== digits ? `${count} of ${digits} digits` : count === digits ? `${digits} digits entered` : ''}
      </p>
      {problem && (
        <p id={errorId} role="alert" className="tw-m-0 tw-text-sm tw-text-danger">
          {problem}
        </p>
      )}
      {help}
    </form>
  );
}
