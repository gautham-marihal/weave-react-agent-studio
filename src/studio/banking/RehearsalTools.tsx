import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import Icon from '../../ui/Icon.jsx';
import Button from '../../ui/Button.tsx';
import { gateway, GatewayError } from '../../api/gateway.ts';
import type { ManifestTool, ToolResponse } from '../../api/gatewayTypes.ts';

import { guidanceFor } from './guidance.ts';
import { GuidanceNotice } from './Guidance.tsx';
import { EFFECT } from './format.ts';
import { Chip, cn, inputClass } from './ui.tsx';

// What staff can do beside a rehearsal, on the mock gateway only: read the mock SMS outbox, run a
// gateway tool as the agent runtime would, and make the next bank-system call fail or hang. The studio's proxy
// forwards these for rehearsal sessions only, never for a real call.

const SMS_POLL_MS = 3_000;
const FAULT_METHODS = [
  'loginWithPhoneCode',
  'verifyAccountAndNric',
  'otpSend',
  'getBalance',
  'incomingFunds',
  'recentTransactions',
  'chequebooks',
  'stopCheques',
  'requestStatement',
  'requestChequebook',
  'primeRate',
  'fxRate',
  'timeDepositRates',
];
const HANG_METHODS = new Set(['stopCheques', 'requestStatement', 'requestChequebook']);
const NO_ACTIONS = new Set<never>();
const message = (error: unknown, fallback: string) => (error instanceof GatewayError ? error.message : fallback);

/** Stands in for the customer's mobile: the SMS one-time passwords the gateway's OTP service sent in this conversation. */
function MockPhoneBody({ callId }: { callId: string }) {
  const [messages, setMessages] = useState<string[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    const poll = () =>
      gateway.rehearsal
        .sms(callId, controller.signal)
        .then((list) => setMessages(list.map((m) => m.text)))
        .catch(() => undefined);
    void poll();
    const timer = window.setInterval(poll, SMS_POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [callId]);
  return messages.length === 0 ? (
    <p className="tw-m-0 tw-text-sm tw-text-muted">No messages yet.</p>
  ) : (
    <ul className="tw-m-0 tw-list-none tw-space-y-1.5 tw-p-0" aria-live="polite">
      {messages.map((text, i) => (
        <li key={i} className="tw-rounded-control tw-bg-subtle tw-px-3 tw-py-1.5 tw-font-mono tw-text-xs tw-text-ink">
          {text}
        </li>
      ))}
    </ul>
  );
}

/** Runs a gateway tool as the agent runtime would. The result is exactly what the model would receive. */
function ToolRunnerBody({ callId, defaultAccountRef }: { callId: string; defaultAccountRef: string | null }) {
  const id = useId();
  const [tools, setTools] = useState<ManifestTool[]>([]);
  const [name, setName] = useState('list_services');
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<ToolResponse | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    gateway
      .manifest(controller.signal)
      .then(setTools)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(message(err, 'The banking tools could not be read.'));
      });
    return () => controller.abort();
  }, []);
  const tool = tools.find((t) => t.name === name);
  const byAgent = useMemo(() => {
    const groups = new Map<string, ManifestTool[]>();
    for (const t of tools) {
      const key = t.agents[0] ?? 'other';
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    return [...groups.entries()];
  }, [tools]);

  const run = async (event: FormEvent) => {
    event.preventDefault();
    if (!tool) return;
    const args: Record<string, unknown> = {};
    for (const key of Object.keys(tool.parameters.properties ?? {})) {
      const value = (values[key] ?? '').trim() || (key === 'account_ref' && defaultAccountRef ? defaultAccountRef : '');
      if (value) args[key] = value;
    }
    setRunning(true);
    setError('');
    setResponse(null);
    try {
      setResponse(await gateway.rehearsal.runTool(callId, tool.name, args));
    } catch (err) {
      setError(message(err, 'The banking gateway did not answer.'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <form onSubmit={run} className="tw-space-y-2">
      <label htmlFor={`${id}-tool`} className="tw-block tw-text-sm tw-font-medium tw-text-ink">
        Tool
      </label>
      <select
        id={`${id}-tool`}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setValues({});
          setResponse(null);
        }}
        className={inputClass}
      >
        {byAgent.map(([agent, list]) => (
          <optgroup key={agent} label={agent}>
            {list.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {tool && (
        <>
          <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-1.5">
            <Chip tone={EFFECT[tool.effect].tone} title={EFFECT[tool.effect].help}>
              {EFFECT[tool.effect].label}
            </Chip>
            <span className="tw-text-xs tw-text-muted">{tool.description}</span>
          </div>
          {Object.entries(tool.parameters.properties ?? {}).map(([key, p]) => (
            <div key={key}>
              <label htmlFor={`${id}-${key}`} className="tw-block tw-text-xs tw-font-medium tw-text-ink">
                {key}
                {tool.parameters.required?.includes(key) ? '' : ' (optional)'}
              </label>
              {p.enum ? (
                <select
                  id={`${id}-${key}`}
                  value={values[key] ?? ''}
                  onChange={(event) => setValues((v) => ({ ...v, [key]: event.target.value }))}
                  className={inputClass}
                >
                  <option value="">—</option>
                  {p.enum.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  id={`${id}-${key}`}
                  value={values[key] ?? ''}
                  placeholder={key === 'account_ref' && defaultAccountRef ? `${defaultAccountRef} (the caller’s account)` : p.description}
                  onChange={(event) => setValues((v) => ({ ...v, [key]: event.target.value }))}
                  className={cn(inputClass, 'tw-font-mono')}
                  autoComplete="off"
                />
              )}
            </div>
          ))}
        </>
      )}
      <Button type="submit" variant="secondary" size="compact" disabled={running || !tool}>
        <Icon name="play" size={14} />
        Run as the agent
      </Button>
      {error && (
        <p role="alert" className="tw-m-0 tw-text-sm tw-text-danger">
          {error}
        </p>
      )}
      {response && (
        <div className="tw-space-y-2">
          {!response.ok && <GuidanceNotice guidance={guidanceFor({ kind: 'tool', response }, NO_ACTIONS)} help={undefined} onAction={() => undefined} />}
          {typeof response.say === 'string' && (
            <p className="tw-m-0 tw-rounded-control tw-bg-accent-soft tw-px-3 tw-py-2 tw-text-sm tw-text-ink">
              <span className="tw-font-medium">The agent reads: </span>
              {response.say}
            </p>
          )}
          <pre className="tw-m-0 tw-max-h-64 tw-overflow-auto tw-rounded-control tw-bg-subtle tw-p-2 tw-font-mono tw-text-xs tw-leading-relaxed tw-text-ink-soft">
            {JSON.stringify(response, null, 2)}
          </pre>
        </div>
      )}
    </form>
  );
}

/** Makes the next call to one bank system fail with a host code, or not answer (the gateway times it out). */
function HostFaultsBody({ callId }: { callId: string }) {
  const id = useId();
  const [method, setMethod] = useState('stopCheques');
  const [kind, setKind] = useState<'error' | 'hang'>('error');
  const [code, setCode] = useState('196');
  const [note, setNote] = useState('');
  const arm = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await gateway.rehearsal.hostFault(callId, { method, kind, code: kind === 'error' ? code : undefined });
      setNote(kind === 'hang' ? `The next ${method} call will not answer.` : `The next ${method} call will fail with host code ${code}.`);
    } catch (err) {
      setNote(message(err, 'Could not arm the fault.'));
    }
  };
  return (
    <form onSubmit={arm} className="tw-grid tw-grid-cols-2 tw-gap-2">
      <label htmlFor={`${id}-method`} className="tw-col-span-2 tw-text-xs tw-text-ink">
        Bank system call
        <select
          id={`${id}-method`}
          value={method}
          onChange={(event) => {
            setMethod(event.target.value);
            if (!HANG_METHODS.has(event.target.value)) setKind('error');
          }}
          className={cn(inputClass, 'tw-mt-0.5')}
        >
          {FAULT_METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-kind`} className="tw-text-xs tw-text-ink">
        How
        <select id={`${id}-kind`} value={kind} onChange={(event) => setKind(event.target.value as 'error' | 'hang')} className={cn(inputClass, 'tw-mt-0.5')}>
          <option value="error">Error code</option>
          <option value="hang" disabled={!HANG_METHODS.has(method)}>
            No answer
          </option>
        </select>
      </label>
      {kind === 'error' && (
        <label htmlFor={`${id}-code`} className="tw-text-xs tw-text-ink">
          Code
          <input id={`${id}-code`} value={code} onChange={(event) => setCode(event.target.value)} className={cn(inputClass, 'tw-mt-0.5 tw-font-mono')} />
        </label>
      )}
      <Button type="submit" variant="secondary" size="compact" className="tw-col-span-2">
        Arm
      </Button>
      {note && (
        <p className="tw-col-span-2 tw-m-0 tw-text-xs tw-text-ink-soft" role="status">
          {note}
        </p>
      )}
    </form>
  );
}

function Panel({ title, icon, lead, dashed = false, children }: { title: string; icon: string; lead: string; dashed?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn(
        'tw-space-y-2 tw-rounded-card tw-border tw-bg-surface tw-p-4',
        dashed ? 'tw-border-dashed tw-border-line-strong' : 'tw-border-solid tw-border-line',
      )}
    >
      <div>
        <h3 id={`${id}-title`} className="tw-m-0 tw-flex tw-items-center tw-gap-2 tw-text-md tw-font-semibold tw-text-ink">
          <Icon name={icon} size={16} />
          {title}
        </h3>
        <p className="tw-m-0 tw-text-xs tw-text-muted">{lead}</p>
      </div>
      {children}
    </section>
  );
}

export function MockPhone({ callId }: { callId: string }) {
  return (
    <Panel title="Phone (SMS codes)" icon="chat" lead="Stands in for the customer’s mobile: the one-time passwords the bank sends by SMS." dashed>
      <MockPhoneBody callId={callId} />
    </Panel>
  );
}

export function ToolRunner({ callId, defaultAccountRef }: { callId: string; defaultAccountRef: string | null }) {
  return (
    <Panel title="Agent’s side" icon="tools" lead="Run a tool as the agent runtime would. The result is what the model would see.">
      <ToolRunnerBody callId={callId} defaultAccountRef={defaultAccountRef} />
    </Panel>
  );
}

export function HostFaults({ callId }: { callId: string }) {
  return (
    <Panel title="Break the next host call" icon="bolt" lead="Make the next call to one bank system fail with a host code, or not answer.">
      <HostFaultsBody callId={callId} />
    </Panel>
  );
}
