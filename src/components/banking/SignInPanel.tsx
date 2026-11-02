import React, { useId, useState } from 'react';
import { CircleCheckIcon, CircleDashedIcon, LoaderCircleIcon } from 'lucide-react';
import type { AuthMethodId, AuthMethodView, ChannelState } from '../../api/gatewayTypes';
import { cn } from '../../utils/styles';
import { methodOfState } from '../../utils/bankingFormat';
import { HelpTopic } from './HelpTopic';
import { IdentifierField } from './IdentifierField';

/**
 * Sign-in before verification: the methods the gateway offers on this channel, what each needs, and the identifier
 * step. Secrets are not entered here: the secure keypad takes them. During a step, a progress list shows where the
 * caller is, from the gateway's state.
 */
export function SignInPanel({
  state,
  busy,
  onIdentify,
}: {
  state: ChannelState;
  busy: boolean;
  onIdentify: (identifier: { phone_code: string } | { account_number: string }) => Promise<boolean>;
}) {
  const id = useId();
  const inProgress = methodOfState(state.auth.state);
  const usable = state.methods.filter((m) => m.available);
  const [chosen, setChosen] = useState<AuthMethodId | null>(usable.length === 1 ? (usable[0]?.id ?? null) : null);
  const method = state.methods.find((m) => m.id === (inProgress ?? chosen));
  const identifierHelp = method ? state.help[method.identifier.help] : undefined;

  if (inProgress && method) return <Progress method={method} state={state} />;

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <div>
        <h3 id={`${id}-title`} className="text-sm font-semibold text-ink">
          How would you like to verify?
        </h3>
        <p className="text-[13px] text-muted">Choose the details you have with you. You can switch before you finish.</p>
      </div>
      <div role="radiogroup" aria-labelledby={`${id}-title`} className="grid gap-2 sm:grid-cols-2">
        {state.methods.map((m) => (
          <MethodCard key={m.id} method={m} selected={chosen === m.id} onSelect={() => setChosen(m.id)} />
        ))}
      </div>
      {method && method.available && (
        <div className="rounded-lg border border-line bg-surface p-3">
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
        'flex min-h-[44px] flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none',
        selected ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:bg-subtle',
        !method.available && 'cursor-not-allowed opacity-60 hover:bg-surface'
      )}
    >
      <span className="text-sm font-medium text-ink">{method.label}</span>
      <span className="text-[12px] leading-relaxed text-ink-soft">{method.summary}</span>
      <span className="mt-1 text-[11px] text-muted">
        You&apos;ll need: {method.identifier.label}
        {method.secure_steps.map((s) => `, ${s.label}`).join('')}
      </span>
      {!method.available && method.unavailable_reason && <span className="mt-1 text-[12px] text-warning">{method.unavailable_reason}</span>}
    </button>
  );
}

function Progress({ method, state }: { method: AuthMethodView; state: ChannelState }) {
  const steps = [{ key: 'identifier', label: method.identifier.label }, ...method.secure_steps.map((s) => ({ key: s.purpose, label: s.label }))];
  const current = state.auth.state === 'awaiting_pin' || state.auth.state === 'awaiting_nric' ? 1 : state.auth.state === 'awaiting_otp' ? 2 : 0;
  const stepHelpId = method.secure_steps[current - 1]?.help;
  const stepHelp = stepHelpId ? state.help[stepHelpId] : undefined;
  return (
    <section aria-label="Verification progress" className="space-y-2">
      <p className="text-sm font-semibold text-ink">{method.label}</p>
      <ol className="space-y-1">
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          const Icon = done ? CircleCheckIcon : active ? LoaderCircleIcon : CircleDashedIcon;
          return (
            <li key={s.key} className={cn('flex items-center gap-2 text-[13px]', done ? 'text-success' : active ? 'font-medium text-ink' : 'text-muted')} aria-current={active ? 'step' : undefined}>
              <Icon className={cn('h-3.5 w-3.5', active && 'animate-spin motion-reduce:animate-none [animation-duration:2.5s]')} aria-hidden />
              {s.label}
              {done && <span className="sr-only">(done)</span>}
              {active && <span className="sr-only">(current step)</span>}
            </li>
          );
        })}
      </ol>
      {stepHelp && <HelpTopic entry={stepHelp} />}
      {state.help.why_not_spoken && <HelpTopic entry={state.help.why_not_spoken} />}
    </section>
  );
}
