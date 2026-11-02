import React, { useEffect, useId, useState } from 'react';
import { MessageSquareIcon, PlayIcon, SquareIcon, ZapIcon } from 'lucide-react';
import { bankingSourceLabel, followRoomTimeline, gateway, GatewayError, type BankingSource } from '../../api/gateway';
import type { ManifestTool, Rehearsal } from '../../api/gatewayTypes';
import { useBankingChannel } from '../../hooks/useBankingChannel';
import { useBankingSource } from '../../hooks/useBankingSource';
import type { TraceEvent } from '../../types/testConsole';
import { traceFromGateway } from '../../utils/gatewayTrace';
import { Button } from '../ui/Button';
import { cn, inputClass } from '../../utils/styles';
import { TracePanel } from '../agent/test/TracePanel';
import { AgentToolRunner } from './AgentToolRunner';
import { BankingSourceNotice } from './BankingSourceNotice';
import { CustomerChannelPanel } from './CustomerChannelPanel';

const FAULT_METHODS = ['loginWithPhoneCode', 'verifyAccountAndNric', 'otpSend', 'getBalance', 'incomingFunds', 'recentTransactions', 'transferOwn', 'chequebooks', 'stopCheques', 'requestStatement', 'requestChequebook', 'primeRate', 'fxRate', 'timeDepositRates'];
const HANG_METHODS = ['stopCheques', 'requestStatement', 'requestChequebook', 'transferOwn'];
const SMS_POLL_MS = 3_000;

/**
 * "Try a banking tool": runs any banking tool as the agent runtime would, against a test session (rehearsalSource():
 * in Live the gateway on the bank's real systems when it opens test sessions, else the mock bank, as a gateway server
 * or in this browser; in Sandbox the mock bank). On real systems there is no mock phone and no staged host faults. The person plays the caller (sign-in, secure keypad, confirmation card) and the agent (tool calls),
 * and sees the gateway's timeline.
 */
export function RehearsalConsole({ tools, source: given }: { tools: ManifestTool[]; source?: BankingSource | null }) {
  const found = useBankingSource(true, 'rehearsal');
  const source = given === undefined ? found : given;
  const [rehearsal, setRehearsal] = useState<Rehearsal | null>(null);
  const [startError, setStartError] = useState<GatewayError | null>(null);
  const [starting, setStarting] = useState(false);
  const [timeline, setTimeline] = useState<TraceEvent[]>([]);
  const [sms, setSms] = useState<string[]>([]);
  const channel = useBankingChannel(rehearsal?.channel_token ?? null);

  // The gateway's timeline for this test session.
  useEffect(() => {
    if (!rehearsal) return;
    const controller = new AbortController();
    const startedAt = Date.now();
    let n = 0;
    setTimeline([]);
    followRoomTimeline(rehearsal.room, (e) => setTimeline((prev) => [...prev, traceFromGateway(e, startedAt, `r${(n += 1)}`)]), () => undefined, controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [rehearsal]);

  // The test customer's phone: SMS one-time passwords sent in this session.
  useEffect(() => {
    if (!rehearsal) return;
    const controller = new AbortController();
    const poll = () =>
      gateway.rehearsal
        .sms(rehearsal.call_id, controller.signal)
        .then((messages) => setSms(messages.map((m) => m.text)))
        .catch(() => undefined);
    void poll();
    const timer = window.setInterval(poll, SMS_POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [rehearsal]);

  // Leaving ends the session at the gateway.
  useEffect(() => {
    if (!rehearsal) return;
    return () => void gateway.rehearsal.end(rehearsal.call_id).catch(() => undefined);
  }, [rehearsal]);

  const start = async () => {
    setStarting(true);
    setStartError(null);
    setSms([]);
    try {
      setRehearsal(await gateway.rehearsal.start('web_chat'));
    } catch (e) {
      setStartError(e instanceof GatewayError ? e : new GatewayError(0, 'server', 'The test session could not start.'));
    } finally {
      setStarting(false);
    }
  };

  // The account the caller picked on their screen becomes the agent's default account_ref, as in a conversation.
  const [pickedAccount, setPickedAccount] = useState<string | null>(null);
  const accounts = channel.state?.profile?.accounts ?? [];
  const defaultAccountRef = accounts.length === 1 ? (accounts[0]?.account_ref ?? null) : accounts.some((a) => a.account_ref === pickedAccount) ? pickedAccount : null;

  if (!source) return <BankingSourceNotice source={source} />;

  if (!rehearsal) {
    return (
      <div className="space-y-3">
        <p className="max-w-2xl text-[13px] text-ink-soft">
          Run any banking tool as the agent would, against a test session: sign in as the caller on the secure keypad, then run tools and see exactly what the model would receive. The gateway&apos;s state machine, keypad and
          confirmations decide every outcome; no language model is involved.
        </p>
        {given === undefined && <BankingSourceNotice source={source} />}
        <Button variant="primary" onClick={start} disabled={starting}>
          <PlayIcon className="h-4 w-4" aria-hidden />
          Start a test session
        </Button>
        {startError && (
          <p role="alert" className="text-[13px] text-danger">
            {startError.kind === 'refused' || startError.kind === 'not_found'
              ? 'This banking gateway does not open test sessions (it needs BANKING_GATEWAY_REHEARSALS=on for the Studio server).'
              : startError.message}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-subtle px-4 py-2 text-[13px]">
        <span className="text-ink">
          Test session · {bankingSourceLabel(source)} · <code className="font-mono text-[12px]">{rehearsal.call_id.slice(0, 18)}…</code>
        </span>
        <Button size="sm" variant="secondary" onClick={() => setRehearsal(null)}>
          <SquareIcon className="h-3.5 w-3.5" aria-hidden />
          End the test session
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-canvas p-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted">The caller&apos;s screen</p>
          <CustomerChannelPanel token={rehearsal.channel_token} channel={channel} onUseAccount={(a) => setPickedAccount(a.account_ref)} />
        </div>
        <AgentToolRunner callId={rehearsal.call_id} tools={tools} defaultAccountRef={defaultAccountRef} />
      </div>
      {source.hosts !== 'live' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <MockPhone messages={sms} />
          <HostFaults callId={rehearsal.call_id} />
        </div>
      )}
      <div className="max-h-[480px]">
        <TracePanel trace={timeline} />
      </div>
    </div>
  );
}

export function MockPhone({ messages }: { messages: string[] }) {
  return (
    <section aria-label="Mock phone" className="rounded-xl border border-dashed border-line-strong bg-surface p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <MessageSquareIcon className="h-4 w-4 text-muted" aria-hidden />
        Mock phone
      </h3>
      <p className="text-[12px] text-muted">Stands in for the customer&apos;s mobile: SMS from the mock OTP service.</p>
      {messages.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted">No messages.</p>
      ) : (
        <ul className="mt-2 space-y-1.5" aria-live="polite">
          {messages.map((m, i) => (
            <li key={i} className="rounded-md bg-subtle px-3 py-1.5 font-mono text-[12px] text-ink">
              {m}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function HostFaults({ callId }: { callId: string }) {
  const id = useId();
  const [method, setMethod] = useState('stopCheques');
  const [kind, setKind] = useState<'error' | 'hang'>('error');
  const [code, setCode] = useState('196');
  const [note, setNote] = useState<string | null>(null);
  const arm = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await gateway.rehearsal.hostFault(callId, { method, kind, code: kind === 'error' ? code : undefined });
      setNote(kind === 'hang' ? `The next ${method} call will not answer (the gateway times it out).` : `The next ${method} call will fail with host code ${code}.`);
    } catch (err) {
      setNote(err instanceof GatewayError ? err.message : 'Could not arm the fault.');
    }
  };
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-xl border border-line bg-surface p-4">
      <h3 id={`${id}-title`} className="flex items-center gap-2 text-sm font-semibold text-ink">
        <ZapIcon className="h-4 w-4 text-muted" aria-hidden />
        Break the next host call
      </h3>
      <form onSubmit={arm} className="mt-2 grid grid-cols-2 gap-2">
        <label className="col-span-2 text-[12px] text-ink">
          Bank system call
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={cn(inputClass, 'mt-0.5')}>
            {FAULT_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-ink">
          How
          <select value={kind} onChange={(e) => setKind(e.target.value as 'error' | 'hang')} className={cn(inputClass, 'mt-0.5')}>
            <option value="error">Error code</option>
            <option value="hang" disabled={!HANG_METHODS.includes(method)}>
              No answer
            </option>
          </select>
        </label>
        {kind === 'error' && (
          <label className="text-[12px] text-ink">
            Code
            <input value={code} onChange={(e) => setCode(e.target.value)} className={cn(inputClass, 'mt-0.5 font-mono')} />
          </label>
        )}
        <Button type="submit" variant="secondary" className="col-span-2">
          Arm
        </Button>
      </form>
      {note && (
        <p className="mt-2 text-[12px] text-ink-soft" role="status">
          {note}
        </p>
      )}
    </section>
  );
}
