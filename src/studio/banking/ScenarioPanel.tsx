import { useEffect, useId, useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import Button from '../../ui/Button.tsx';
import { Choice, OneOf } from '../../ui/OneOf.tsx';
import { gateway, GatewayError } from '../../api/gateway.ts';
import type { TestLogin } from '../../api/gatewayTypes.ts';
import { evaluate, SCENARIOS, type RunEvent, type ScenarioStatus } from './scenarios.ts';
import { cn, panelClass, segmentClass, toneText, type Tone } from './ui.tsx';

const STATUS: Record<ScenarioStatus, { label: string; icon: string; tone: Tone }> = {
  passed: { label: 'Passed', icon: 'done', tone: 'success' },
  in_progress: { label: 'In progress', icon: 'pending', tone: 'warning' },
  not_run: { label: 'Not run', icon: 'pending', tone: 'neutral' },
};

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
      className="tw-inline-flex tw-items-center tw-gap-1 tw-rounded-control tw-border-0 tw-bg-transparent tw-px-1 tw-font-mono tw-text-xs tw-text-ink hover:tw-bg-subtle"
      aria-label={`Copy ${label} ${value}`}
    >
      {value}
      <span className={done ? 'tw-text-success' : 'tw-text-muted'}>
        <Icon name={done ? 'check' : 'copy'} size={12} />
      </span>
    </button>
  );
}

/**
 * The guide for a rehearsal: the documented mock test logins, and scenarios that pass only on what the gateway
 * actually did in this page's sessions (never on what was typed).
 */
export default function ScenarioPanel({ events, onReset }: { events: readonly RunEvent[]; onReset: () => void }) {
  const id = useId();
  const [tab, setTab] = useState<'scenarios' | 'logins'>('scenarios');
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

  const results = useMemo(() => Object.fromEntries(SCENARIOS.map((s) => [s.id, evaluate(s.id, events)])), [events]);
  const passed = Object.values(results).filter((r) => r.status === 'passed').length;

  return (
    <section aria-labelledby={`${id}-title`} className={panelClass}>
      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
        <h3 id={`${id}-title`} className="tw-m-0 tw-flex tw-items-center tw-gap-2 tw-text-md tw-font-semibold tw-text-ink">
          <Icon name="list" size={16} />
          Test accounts and scenarios
        </h3>
        <OneOf className={segmentClass} label="Guide view" value={tab} onChange={(v) => setTab(v as 'scenarios' | 'logins')}>
          <Choice value="scenarios">
            Scenarios {passed}/{SCENARIOS.length}
          </Choice>
          <Choice value="logins">Test logins</Choice>
        </OneOf>
      </div>

      {tab === 'logins' ? (
        <div className="tw-mt-3 tw-space-y-3">
          {error && (
            <p role="alert" className="tw-m-0 tw-text-sm tw-text-danger">
              {error}
            </p>
          )}
          {!logins && !error && <p className="tw-m-0 tw-text-sm tw-text-muted">Loading the test logins…</p>}
          {logins && (
            <div className="tw-overflow-x-auto tw-rounded-control tw-border tw-border-solid tw-border-line">
              <table className="tw-w-full tw-min-w-[360px] tw-border-collapse tw-text-left tw-text-sm">
                <thead className="tw-bg-subtle tw-text-xs tw-text-muted">
                  <tr>
                    <th className="tw-px-3 tw-py-2 tw-font-medium">Test login</th>
                    <th className="tw-px-3 tw-py-2 tw-font-medium">Identify with</th>
                    <th className="tw-px-3 tw-py-2 tw-font-medium">Then key in</th>
                  </tr>
                </thead>
                <tbody>
                  {logins.map((l) => (
                    <tr key={l.id} className="tw-border-0 tw-border-t tw-border-solid tw-border-line tw-align-top">
                      <td className="tw-px-3 tw-py-2">
                        <span className="tw-block tw-font-medium tw-text-ink">{l.label}</span>
                        <span className="tw-block tw-text-xs tw-text-muted">
                          {METHOD_LABEL[l.method]} · {l.exercises}
                        </span>
                      </td>
                      <td className="tw-px-3 tw-py-2">
                        <span className="tw-block tw-text-xs tw-text-muted">{l.method === 'phonecode_pin' ? 'Phone Code' : 'Account number'}</span>
                        <Copy value={l.identifier} label={l.method === 'phonecode_pin' ? 'Phone Code' : 'account number'} />
                      </td>
                      <td className="tw-px-3 tw-py-2">
                        <span className="tw-block tw-text-xs tw-text-muted">{l.method === 'phonecode_pin' ? 'Phone PIN' : 'NRIC digits'}</span>
                        <Copy value={l.secret} label={l.method === 'phonecode_pin' ? 'PIN' : 'NRIC digits'} />
                        {l.otp && <span className="tw-block tw-text-xs tw-text-muted">then the OTP from the Phone (SMS codes) panel</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="tw-m-0 tw-text-xs tw-text-ink-soft">
            <span className="tw-font-medium tw-text-ink">One-time passwords:</span>{' '}
            {otpSource || 'shown in the Phone (SMS codes) panel and printed in the gateway console.'} These are test logins with test data in the gateway’s test
            environment; no real account or SMS is involved.
          </p>
        </div>
      ) : (
        <div className="tw-mt-3">
          <ol className="tw-m-0 tw-list-none tw-space-y-2 tw-p-0">
            {SCENARIOS.map((s, i) => {
              const r = results[s.id] ?? { status: 'not_run' as const, note: '' };
              const st = STATUS[r.status];
              return (
                <li key={s.id}>
                  <details className="tw-rounded-control tw-border tw-border-solid tw-border-line tw-px-3 tw-py-2 open:tw-bg-subtle">
                    <summary className="tw-flex tw-cursor-pointer tw-list-none tw-items-center tw-gap-2 tw-text-sm">
                      <span className={cn('tw-shrink-0', toneText[st.tone])}>
                        <Icon name={st.icon} size={16} />
                      </span>
                      <span className="tw-min-w-0 tw-flex-1 tw-text-ink">
                        {i + 1}. {s.title}
                      </span>
                      <span className={cn('tw-shrink-0 tw-text-xs', toneText[st.tone])}>{st.label}</span>
                    </summary>
                    <ol className="tw-mb-0 tw-mt-2 tw-space-y-0.5 tw-pl-10 tw-text-xs tw-text-ink-soft">
                      {s.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                    {s.login && (
                      <p className="tw-mb-0 tw-mt-1 tw-pl-6 tw-text-xs tw-text-muted">
                        Login: {METHOD_LABEL[s.login as TestLogin['method']]} (see Test logins)
                      </p>
                    )}
                    <p className="tw-mb-0 tw-mt-1 tw-pl-6 tw-text-xs tw-text-ink">{r.note}</p>
                  </details>
                </li>
              );
            })}
          </ol>
          <div className="tw-mt-3 tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
            <p className="tw-m-0 tw-text-xs tw-text-muted">A scenario passes only when the gateway did it in a session on this page.</p>
            <Button type="button" size="compact" onClick={onReset} disabled={events.length === 0}>
              <Icon name="undo" size={14} />
              Reset results
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
