import React, { useEffect, useState } from 'react';
import { CopyIcon, KeyRoundIcon } from 'lucide-react';
import { gateway, GatewayError } from '../../api/gateway';
import type { TestLogin } from '../../api/gatewayTypes';
import { cn } from '../../utils/styles';

const METHOD_LABEL: Record<TestLogin['method'], string> = { phonecode_pin: 'Phone Code + PIN', account_nric_otp: 'Account + NRIC + OTP' };

function Copy({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1200);
        });
      }}
      className="inline-flex items-center gap-1 rounded px-1 font-mono text-[12px] text-ink hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      aria-label={`Copy ${label} ${value}`}
    >
      {value}
      <CopyIcon className={cn('h-3 w-3', done ? 'text-success' : 'text-muted')} aria-hidden />
    </button>
  );
}

/**
 * The mock bank's documented test logins (services/banking-gateway/README.md "Test logins"), as the gateway lists
 * them. On the bank's real systems (`realBank`) there are none: the gateway says how its customers sign in instead.
 */
export function TestLogins({ realBank = false }: { realBank?: boolean }) {
  const [logins, setLogins] = useState<TestLogin[] | null>(null);
  const [otpSource, setOtpSource] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    gateway.rehearsal
      .testLogins(controller.signal)
      .then((r) => {
        setLogins(r.logins);
        setOtpSource(r.otp_source);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof GatewayError ? e.message : 'The test logins could not be loaded.');
      });
    return () => controller.abort();
  }, []);

  return (
    <details className="group rounded-xl border border-line bg-surface p-4" aria-label="Test logins">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink">
        <KeyRoundIcon className="h-4 w-4 text-muted" aria-hidden />
        {realBank ? 'Signing in' : 'Test logins'}
        <span className="ml-auto text-[12px] font-normal text-muted group-open:hidden">Show</span>
      </summary>
      <p className="mt-1 text-[12px] text-muted">
        {realBank
          ? 'The bank’s real systems: no test logins, real customers only. Key the secret on the secure keypad, never in the conversation.'
          : 'Mock bank systems, test data only. Key the secret on the secure keypad, never in the conversation.'}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      )}
      {!logins && !error && <p className="mt-2 text-[13px] text-muted">Loading the test logins…</p>}
      {logins && logins.length > 0 && (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
          {logins.map((l) => (
            <li key={l.id} className="space-y-1 px-3 py-2 text-[13px]">
              <span className="block font-medium text-ink">{l.label}</span>
              <span className="block text-[12px] text-muted">
                {METHOD_LABEL[l.method]} · {l.exercises}
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-soft">
                <span>
                  {l.method === 'phonecode_pin' ? 'Phone Code' : 'Account'} <Copy value={l.identifier} label={l.method === 'phonecode_pin' ? 'Phone Code' : 'account number'} />
                </span>
                <span>
                  {l.method === 'phonecode_pin' ? 'PIN' : 'NRIC'} <Copy value={l.secret} label={l.method === 'phonecode_pin' ? 'PIN' : 'NRIC digits'} />
                </span>
                {l.otp && <span className="text-muted">then the SMS code on the phone below</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {otpSource && <p className="mt-2 text-[11px] text-muted">{realBank ? otpSource : `One-time passwords: ${otpSource}`}</p>}
    </details>
  );
}
