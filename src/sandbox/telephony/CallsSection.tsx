// Sandbox: simulated calls (Weave React's TelephonyCallsPage, SimulateCallDialog and CallDetailDialog). A call is played
// through the dispatch rules, hold limits and agents in this browser, stage by stage; no real call is placed.

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClockIcon, PhoneIncomingIcon } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { StatusChip } from '../../components/ui/StatusChip';
import { Toggle } from '../../components/ui/Toggle';
import { toast } from '../../components/ui/Toast';
import type { TelephonySection } from '../../models/telephony';
import { formatShortDate } from '../../utils/format';
import { cn, inputClass } from '../../utils/styles';
import { FormField, SandboxNote, SectionHeader, Stat, StatGrid, TelephonyTable } from './parts';
import { fieldClass } from './styles';
import {
  addCall,
  answeredWords,
  BUSY_LEVELS,
  CALL_STATUS_TONE,
  callsInRange,
  callTag,
  formatDuration,
  isPhoneNumber,
  previewWords,
  RANGES,
  SANDBOX_COPY,
  sampleCaller,
  simulateCall,
  summarizeCalls,
  type BusyLevel,
  type Range,
  type SimulatedCall,
  type TelAgent,
  type TelephonyData,
} from './model';
import { updateTelephony } from './store';

export function CallsSection({ data, agents, onSection }: { data: TelephonyData; agents: TelAgent[]; onSection: (s: TelephonySection) => void }) {
  const [range, setRange] = useState<Range>('Past 24 hours');
  const [simulating, setSimulating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const calls = callsInRange(data.calls, range);
  const sum = summarizeCalls(calls);
  const ready = data.rules.length > 0 && data.numbers.length > 0;
  const open = data.calls.find((c) => c.id === openId) ?? null;

  const run = (options: { numberId: string; caller: string; when: Date; busy: BusyLevel; wantsPerson: boolean }) => {
    const call = simulateCall({ data, agents, ...options });
    updateTelephony((d) => addCall(d, call));
    if (call.issues.length) toast.warning(`Simulated call: ${call.status.toLowerCase()}`, { description: call.issues[0] });
    else toast.success(`Simulated call: ${call.status.toLowerCase()}`, { description: `${call.from} to ${call.to}.` });
    setSimulating(false);
    setOpenId(call.id);
  };

  const rows = calls.map((c) => ({
    id: c.id,
    name: `call ${callTag(c.id)}`,
    cells: [
      callTag(c.id),
      <span key="from" className="whitespace-nowrap">{c.from}</span>,
      <span key="to" className="whitespace-nowrap">{c.to}</span>,
      c.ruleName || '—',
      answeredWords(c),
      <span key="started" className="whitespace-nowrap">{formatShortDate(c.startedAt)}</span>,
      <span key="hold" className={cn('whitespace-nowrap', c.overLimit && 'text-warning')} title={c.maxHold != null ? `Total time on hold. Waited ${formatDuration(c.agentWaitSec)} for the agent; rule limit ${c.maxHold} s.` : undefined}>
        {c.ruleId ? formatDuration(c.holdSec) : '—'}
        {c.overLimit && <span className="block text-xs">over limit</span>}
      </span>,
      <span key="length" className="whitespace-nowrap">{formatDuration(c.durationSec)}</span>,
      <span key="status" className="flex flex-wrap items-center gap-1.5">
        <StatusChip tone={CALL_STATUS_TONE[c.status]}>{c.status}</StatusChip>
        {c.issues.length > 0 && (
          <span className="text-xs text-warning" title={c.issues.join(' ')}>
            {c.issues.length} issue{c.issues.length === 1 ? '' : 's'}
          </span>
        )}
      </span>,
    ],
    searchText: `${c.id} ${c.from} ${c.to} ${c.ruleName} ${c.agentName} ${c.status}`,
  }));

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Simulated calls"
        text={
          <>
            Calls you simulate here, to see how your dispatch rules would route them and how long callers would wait. Calls from callers and from tests are on the{' '}
            <Link to="/calls" className="font-medium text-accent hover:underline">
              Calls
            </Link>{' '}
            page.
          </>
        }
      >
        <label className="relative flex items-center">
          <ClockIcon className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted" aria-hidden />
          <select value={range} onChange={(e) => setRange(e.target.value as Range)} aria-label="Time range" className={cn(inputClass, 'h-8 w-auto py-1 pl-8 pr-8 text-[13px]')}>
            {RANGES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <Button variant="primary" size="sm" disabled={!data.numbers.length} title={data.numbers.length ? 'Run a call through your dispatch rules' : 'Get a test number first'} onClick={() => setSimulating(true)}>
          <PhoneIncomingIcon className="h-4 w-4" aria-hidden />
          Simulate a call
        </Button>
      </SectionHeader>
      <SandboxNote title="Sandbox, simulated">{SANDBOX_COPY.calls}</SandboxNote>
      {data.calls.length > 0 && (
        <>
          <StatGrid>
            <Stat label="Simulated calls" value={String(sum.count)} note={sum.count ? `In the ${range.toLowerCase()}` : 'None simulated in this time range'} />
            <Stat label="Total talk time" value={formatDuration(sum.totalTalkSec)} note="Combined, not counting hold" />
            <Stat label="Average talk time" value={formatDuration(sum.avgTalkSec)} note="Per connected call" />
            <Stat
              label="Average hold time"
              value={formatDuration(sum.avgHoldSec)}
              note={sum.longestHoldSec !== null ? `Longest ${formatDuration(sum.longestHoldSec)}${sum.overLimit ? `, ${sum.overLimit} over the rule limit` : ''}` : 'Time callers spend waiting'}
              accent
            />
            <Stat label="Answered by an agent" value={String(sum.answered)} note={sum.count ? `${sum.answeredShare}% of the simulated calls` : 'No simulated calls yet'} accent />
            <Stat label="Calls with issues" value={String(sum.withIssues)} note={sum.withIssues ? 'Open a call to see what happened' : 'No call issues found'} accent />
          </StatGrid>
        </>
      )}
      <TelephonyTable
        title="Calls"
        columns={['Call', 'From', 'To', 'Rule', 'Answered by', 'Started', 'Hold time', 'Length', 'Status']}
        defaultHidden={['To']}
        rows={rows}
        monoFirst
        itemLabel="call"
        onRowClick={setOpenId}
        empty={{
          icon: PhoneIncomingIcon,
          title: 'No simulated calls yet',
          text: ready
            ? 'Your routing is set up. Simulate a call to see how it’s handled, stage by stage.'
            : 'Calls appear here once a dispatch rule routes callers from a number or trunk to one of your agents.',
          action: ready
            ? { label: 'Simulate a call', onClick: () => setSimulating(true) }
            : { label: 'Set up routing', onClick: () => onSection(data.numbers.length || data.trunks.length ? 'dispatch' : 'numbers') },
        }}
      />
      {simulating && <SimulateDialog data={data} agents={agents} onClose={() => setSimulating(false)} onRun={run} />}
      {open && <CallDialog call={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** "2026-11-02T09:30" for a datetime-local field, in this browser's time zone. */
const localInputValue = (d: Date): string => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function SimulateDialog({
  data,
  agents,
  onClose,
  onRun,
}: {
  data: TelephonyData;
  agents: TelAgent[];
  onClose: () => void;
  onRun: (o: { numberId: string; caller: string; when: Date; busy: BusyLevel; wantsPerson: boolean }) => void;
}) {
  const [numberId, setNumberId] = useState(data.numbers[0]?.id ?? '');
  const [caller, setCaller] = useState(() => sampleCaller());
  const [whenMode, setWhenMode] = useState<'now' | 'custom'>('now');
  const [whenValue, setWhenValue] = useState(() => localInputValue(new Date()));
  const [busy, setBusy] = useState<BusyLevel>('quiet');
  const [wantsPerson, setWantsPerson] = useState(false);
  const [sent, setSent] = useState(false);
  const when = useMemo(() => (whenMode === 'now' ? new Date() : new Date(whenValue)), [whenMode, whenValue]);
  const callerError = isPhoneNumber(caller) ? '' : 'Enter a phone number, such as +1 415 555 0100.';
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSent(true);
    if (callerError || !numberId) return;
    onRun({ numberId, caller: caller.trim(), when: Number.isNaN(when.getTime()) ? new Date() : when, busy, wantsPerson });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Simulate an inbound call"
      description="Runs a call through your dispatch rules, hold limits and agents. No real call is placed."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="sandbox-call-form" disabled={!numberId}>
            Simulate call
          </Button>
        </>
      }
    >
      <form id="sandbox-call-form" noValidate onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Number called">
            <select className={fieldClass()} value={numberId} onChange={(e) => setNumberId(e.target.value)}>
              {data.numbers.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.number}
                  {n.label ? ` (${n.label})` : ''}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Caller’s number" error={sent && callerError}>
            <input className={fieldClass(sent && callerError)} value={caller} onChange={(e) => setCaller(e.target.value)} />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="When">
            <select className={fieldClass()} value={whenMode} onChange={(e) => setWhenMode(e.target.value as 'now' | 'custom')}>
              <option value="now">Right now</option>
              <option value="custom">Pick a date and time</option>
            </select>
          </FormField>
          <FormField label="How busy is the agent?" hint={`Typical wait: ${BUSY_LEVELS[busy].wait[0]}–${BUSY_LEVELS[busy].wait[1]} seconds.`}>
            <select className={fieldClass()} value={busy} onChange={(e) => setBusy(e.target.value as BusyLevel)}>
              {(Object.keys(BUSY_LEVELS) as BusyLevel[]).map((k) => (
                <option key={k} value={k}>
                  {BUSY_LEVELS[k].label}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        {whenMode === 'custom' && (
          <FormField label="Date and time">
            <input type="datetime-local" className={fieldClass()} value={whenValue} onChange={(e) => setWhenValue(e.target.value)} />
          </FormField>
        )}
        <div className="flex items-start justify-between gap-4 rounded-lg border border-line px-3.5 py-3">
          <div>
            <p className="text-sm font-medium text-ink">The caller asks for a person</p>
            <p className="text-[13px] text-muted">Tests the agent’s voice handoff.</p>
          </div>
          <Toggle checked={wantsPerson} onChange={setWantsPerson} label="The caller asks for a person" />
        </div>
        <p className="rounded-lg bg-canvas px-3.5 py-2.5 text-[13px] text-ink-soft" data-testid="call-preview" aria-live="polite">
          {previewWords(data, agents, numberId, caller, when)}
        </p>
      </form>
    </Dialog>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

function CallDialog({ call, onClose }: { call: SimulatedCall; onClose: () => void }) {
  const facts: { label: string; value: React.ReactNode; warn?: boolean }[] = [
    { label: 'Status', value: <StatusChip tone={CALL_STATUS_TONE[call.status]}>{call.status}</StatusChip> },
    {
      label: 'Hold time',
      value: (
        <>
          {formatDuration(call.holdSec)}
          {call.maxHold != null && (
            <span className="block text-xs font-normal text-muted">
              {call.agentWaitSec !== call.holdSec ? `${formatDuration(call.agentWaitSec)} for the agent, ` : ''}limit {call.maxHold} s
            </span>
          )}
        </>
      ),
      warn: call.overLimit,
    },
    { label: 'Talk time', value: formatDuration(call.connectedSec) },
    { label: 'Total', value: formatDuration(call.durationSec) },
  ];
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={`Simulated call ${callTag(call.id)}`}
      description={`${call.from} to ${call.to}, ${formatShortDate(call.startedAt)}${call.ruleName ? `, rule “${call.ruleName}”` : ''}`}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-5" data-testid="call-detail">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {facts.map((f) => (
            <div key={f.label} className="rounded-lg border border-line px-3 py-2">
              <dt className="text-xs text-muted">{f.label}</dt>
              <dd className={cn('mt-0.5 text-sm font-semibold text-ink', f.warn && 'text-warning')}>{f.value}</dd>
            </div>
          ))}
        </dl>
        {call.issues.length > 0 && (
          <div role="note" className="rounded-lg border border-warning/30 bg-warning-soft/60 px-3.5 py-2.5 text-[13px] text-ink-soft">
            <p className="font-semibold text-warning">{call.issues.length === 1 ? 'Something to check' : `${call.issues.length} things to check`}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {call.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <h3 className="text-sm font-semibold text-ink">Call stages</h3>
          <ol className="mt-3 space-y-0" aria-label="Call stages">
            {call.stages.map((s, i) => (
              <li key={i} className="relative flex gap-3 pb-4 last:pb-0" data-stage={s.key}>
                <span aria-hidden className="flex flex-col items-center">
                  <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', s.hold ? 'bg-warning' : s.key === 'ended' ? 'bg-line-strong' : 'bg-accent')} />
                  {i < call.stages.length - 1 && <span className="mt-1 w-px flex-1 bg-line" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-sm font-medium text-ink">{s.label}</p>
                    <time className="text-xs tabular-nums text-muted">{time(s.at)}</time>
                  </div>
                  {s.detail && <p className="mt-0.5 text-[13px] text-ink-soft">{s.detail}</p>}
                  {s.durationSec > 0 && (
                    <span className={cn('mt-1 inline-block rounded-full px-2 py-0.5 text-xs', s.hold ? 'bg-warning-soft text-warning' : 'bg-subtle text-ink-soft')}>
                      {s.hold ? 'On hold ' : ''}
                      {formatDuration(s.durationSec)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Dialog>
  );
}
