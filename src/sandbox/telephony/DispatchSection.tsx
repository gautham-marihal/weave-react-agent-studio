// Sandbox: dispatch rules (Weave React's TelephonyDispatchPage and DispatchRuleDialog): which calls a rule handles, who
// answers, and what happens while callers wait. Kept in this browser; they route only simulated calls.

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightLeftIcon, PlusIcon } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Segmented } from '../../components/ui/Segmented';
import { StatusChip } from '../../components/ui/StatusChip';
import { toast } from '../../components/ui/Toast';
import type { TelephonySection } from '../../models/telephony';
import { cn } from '../../utils/styles';
import { Callout, FormField, SandboxNote, SectionHeader, Stat, StatGrid, TelephonyTable } from './parts';
import { fieldClass } from './styles';
import {
  deleteRule,
  describeRuleHours,
  describeRuleRouting,
  formatDuration,
  hasErrors,
  OVERFLOW_OPTIONS,
  routingLabel,
  RULE_HOURS,
  RULE_TYPES,
  ruleCallStats,
  ruleErrors,
  ruleForm,
  ruleFromForm,
  ruleHoursParts,
  rulesNotLive,
  ruleSettings,
  SANDBOX_COPY,
  saveRule,
  WEEKDAYS,
  type DispatchRule,
  type Overflow,
  type RuleForm,
  type RuleHours,
  type RuleType,
  type TelAgent,
  type TelephonyData,
} from './model';
import { updateTelephony } from './store';

export function DispatchSection({ data, agents, onSection }: { data: TelephonyData; agents: TelAgent[]; onSection: (s: TelephonySection) => void }) {
  const [editing, setEditing] = useState<DispatchRule | 'new' | null>(null);
  const navigate = useNavigate();
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name || 'Deleted agent';
  const notLive = rulesNotLive(data, agents);
  const rows = data.rules.map((rule) => {
    const r = ruleSettings(rule);
    const stats = ruleCallStats(data.calls, rule.id);
    const target = agents.find((a) => a.id === rule.agentId);
    const hours = ruleHoursParts(rule);
    const fallback = r.overflow === 'agent' ? agents.find((a) => a.id === r.overflowAgentId)?.name : '';
    return {
      id: rule.id,
      name: rule.name,
      cells: [
        rule.name,
        <span key="routing" className="whitespace-nowrap">{routingLabel(data, rule)}</span>,
        <span key="when" className="block">
          <span className="block whitespace-nowrap">{hours.days}</span>
          {hours.hours && <span className="block text-xs text-muted">{hours.hours}</span>}
        </span>,
        target ? (
          <span key="agent" className="block">
            <span className="block text-ink">{target.name}</span>
            <StatusChip tone={target.live ? 'success' : 'neutral'} className="mt-0.5">
              {target.where}
            </StatusChip>
          </span>
        ) : (
          <span key="agent" className="block">
            <span className="block">Deleted agent</span>
            <span className="text-xs text-danger">No agent will answer</span>
          </span>
        ),
        `${r.maxHold} s`,
        r.overflow === 'agent' ? `Send to ${fallback || 'a deleted agent'}` : OVERFLOW_OPTIONS[r.overflow].short,
        String(r.priority),
        stats.count ? String(stats.count) : '—',
        stats.count ? (
          <span key="hold" className={cn('whitespace-nowrap', stats.over > 0 && 'text-warning')} title={stats.over ? `${stats.over} call${stats.over === 1 ? '' : 's'} waited past the limit` : undefined}>
            {formatDuration(stats.avgHoldSec)}
            {stats.over > 0 && <span className="block text-xs">{stats.over} over limit</span>}
          </span>
        ) : (
          '—'
        ),
      ],
      searchText: `${rule.id} ${rule.name} ${routingLabel(data, rule)} ${nameOf(rule.agentId)} ${describeRuleHours(rule)} ${OVERFLOW_OPTIONS[r.overflow].short}`,
    };
  });
  return (
    <div className="space-y-5">
      <SectionHeader title="Dispatch rules" text="Control how inbound calls are routed to agents.">
        <Button variant="primary" size="sm" onClick={() => setEditing('new')}>
          <PlusIcon className="h-4 w-4" aria-hidden />
          Create dispatch rule
        </Button>
      </SectionHeader>
      <SandboxNote>{SANDBOX_COPY.dispatch}</SandboxNote>
      <StatGrid columns={2}>
        <Stat
          label="Dispatch rules"
          value={String(data.rules.length)}
          note={data.rules.length ? `${data.rules.length} routing rule${data.rules.length === 1 ? '' : 's'} set up` : 'No routing rules set up'}
        />
        <Stat label="SIP URI" value="Not connected" note="Sandbox creates no SIP endpoint" />
      </StatGrid>
      {notLive.length > 0 && (
        <Callout>
          {notLive.length === 1 ? '1 rule sends' : `${notLive.length} rules send`} callers to an agent that isn’t live in Production. Callers may reach an agent that’s
          still being built, or none.
        </Callout>
      )}
      <TelephonyTable
        title="Dispatch rules"
        columns={['Rule name', 'Inbound routing', 'When', 'Agent', 'Max hold', 'If no answer', 'Priority', 'Calls', 'Avg hold']}
        defaultHidden={['Priority']}
        rows={rows}
        itemLabel="dispatch rule"
        deleteWords={(id) => `“${data.rules.find((r) => r.id === id)?.name ?? id}” is removed from this browser; the calls it routed are no longer handled. This can’t be undone.`}
        onEdit={(id) => setEditing(data.rules.find((r) => r.id === id) ?? null)}
        onDelete={(id) => {
          const rule = data.rules.find((r) => r.id === id);
          updateTelephony((d) => deleteRule(d, id));
          toast.success(`Dispatch rule “${rule?.name ?? id}” deleted`, { description: 'Calls it routed are no longer handled.' });
        }}
        empty={{ icon: ArrowRightLeftIcon, title: 'No dispatch rules yet', text: 'Create a rule to decide which agent answers inbound calls.', action: { label: 'Create dispatch rule', onClick: () => setEditing('new') } }}
      />
      {editing && (
        <RuleDialog
          data={data}
          agents={agents}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onGoTo={(target) => {
            setEditing(null);
            if (target === 'agents') navigate('/agents');
            else onSection(target);
          }}
          onSave={(rule) => {
            const isNew = editing === 'new';
            updateTelephony((d) => saveRule(d, rule));
            toast.success(isNew ? `Dispatch rule “${rule.name}” created` : `Dispatch rule “${rule.name}” updated`, {
              description: isNew
                ? `Sends callers from ${describeRuleRouting(data, rule)} to ${nameOf(rule.agentId)}.`
                : `${describeRuleHours(rule)}, hold limit ${rule.maxHold} s.`,
            });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function Fieldset({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-4 rounded-lg border border-line p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">{legend}</legend>
      {children}
    </fieldset>
  );
}

function RuleDialog({
  data,
  agents,
  initial,
  onClose,
  onSave,
  onGoTo,
}: {
  data: TelephonyData;
  agents: TelAgent[];
  initial: DispatchRule | null;
  onClose: () => void;
  onSave: (rule: DispatchRule) => void;
  onGoTo: (target: 'numbers' | 'agents') => void;
}) {
  const [form, setForm] = useState<RuleForm>(() => ruleForm(data, agents, initial));
  const [sent, setSent] = useState(false);
  const errors = ruleErrors(form, data, initial?.id);
  const set = (patch: Partial<RuleForm>) => setForm((old) => ({ ...old, ...patch }));
  const inboundTrunks = data.trunks.filter((t) => t.direction === 'inbound');
  const toggleDay = (day: number) => set({ days: form.days.includes(day) ? form.days.filter((d) => d !== day) : [...form.days, day] });
  const err = (key: keyof typeof errors) => sent && errors[key];
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSent(true);
    if (!hasErrors(errors)) onSave(ruleFromForm(form, initial, new Date()));
  };
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={initial ? `Edit “${initial.name}”` : 'Create a dispatch rule'}
      description="Choose which calls this rule handles, who answers, and what happens while callers wait."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="sandbox-rule-form">
            {initial ? 'Save changes' : 'Create rule'}
          </Button>
        </>
      }
    >
      <form id="sandbox-rule-form" noValidate onSubmit={submit} className="space-y-4">
        <SandboxNote title="Sandbox">{SANDBOX_COPY.dialog}</SandboxNote>
        <Fieldset legend="Calls and agent">
          <FormField label="Rule name" error={err('name')}>
            <input autoFocus className={fieldClass(err('name'))} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Main support line" maxLength={60} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Inbound routing" hint={data.numbers.length || inboundTrunks.length ? 'Calls arriving here use this rule.' : 'No numbers yet, so this applies to all inbound calls.'}>
              <select className={fieldClass()} value={form.routing} onChange={(e) => set({ routing: e.target.value })}>
                <option value="all">All inbound numbers</option>
                {data.numbers.length > 0 && (
                  <optgroup label="Test numbers">
                    {data.numbers.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.number}
                        {n.label ? ` (${n.label})` : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                {inboundTrunks.length > 0 && (
                  <optgroup label="Inbound trunks">
                    {inboundTrunks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {form.routing === '' && <option value="">Unassigned</option>}
              </select>
            </FormField>
            <FormField label="Agent" error={err('agent')} hint={agents.length ? '' : 'This workspace has no agents yet.'}>
              <select className={fieldClass(err('agent'))} value={form.agentId} onChange={(e) => set({ agentId: e.target.value })} disabled={!agents.length}>
                {!agents.length && <option value="">No agents available</option>}
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.where})
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          {(!data.numbers.length || !agents.length) && (
            <div className="flex flex-wrap gap-3 text-[13px]">
              {!data.numbers.length && (
                <button type="button" className="font-medium text-accent hover:underline" onClick={() => onGoTo('numbers')}>
                  Get a test number first
                </button>
              )}
              {!agents.length && (
                <button type="button" className="font-medium text-accent hover:underline" onClick={() => onGoTo('agents')}>
                  Create an agent
                </button>
              )}
            </div>
          )}
        </Fieldset>

        <Fieldset legend="When it applies">
          <Segmented<RuleHours> label="When the rule applies" value={form.hours} onChange={(hours) => set({ hours })} options={(Object.keys(RULE_HOURS) as RuleHours[]).map((k) => ({ value: k, label: RULE_HOURS[k] }))} />
          {form.hours !== 'any' && (
            <>
              <div role="group" aria-label="Days" className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((label, day) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={form.days.includes(day)}
                    onClick={() => toggleDay(day)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                      form.days.includes(day) ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:text-ink'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {err('days') && (
                <p className="text-[13px] text-danger" role="alert">
                  {errors.days}
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Opens">
                  <input type="time" className={fieldClass()} value={form.openTime} onChange={(e) => set({ openTime: e.target.value })} />
                </FormField>
                <FormField label="Closes" error={err('times')}>
                  <input type="time" className={fieldClass(err('times'))} value={form.closeTime} onChange={(e) => set({ closeTime: e.target.value })} />
                </FormField>
              </div>
              <p className="text-[13px] text-muted">
                {form.hours === 'business' ? 'Calls outside these hours fall through to other rules.' : 'This rule only handles calls outside these hours, e.g. an after-hours agent.'}
              </p>
            </>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Caller prefix (optional)" error={err('callerPrefix')} hint="Only callers whose number starts with this, e.g. +91.">
              <input className={fieldClass(err('callerPrefix'))} value={form.callerPrefix} onChange={(e) => set({ callerPrefix: e.target.value })} placeholder="Any caller" maxLength={8} />
            </FormField>
            <FormField label="Priority" error={err('priority')} hint="1 is checked first when several rules match.">
              <input type="number" min={1} max={10} className={fieldClass(err('priority'))} value={form.priority} onChange={(e) => set({ priority: e.target.value })} />
            </FormField>
          </div>
        </Fieldset>

        <Fieldset legend="While callers wait">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Maximum hold time (seconds)" error={err('maxHold')} hint="How long a caller waits for the agent before the fallback below.">
              <input type="number" min={5} max={600} className={fieldClass(err('maxHold'))} value={form.maxHold} onChange={(e) => set({ maxHold: e.target.value })} />
            </FormField>
            <FormField label="If no one answers in time">
              <select className={fieldClass()} value={form.overflow} onChange={(e) => set({ overflow: e.target.value as Overflow })}>
                {(Object.keys(OVERFLOW_OPTIONS) as Overflow[]).map((k) => (
                  <option key={k} value={k}>
                    {OVERFLOW_OPTIONS[k].label}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          {form.overflow === 'agent' && (
            <FormField label="Send to" error={err('overflowAgent')}>
              <select className={fieldClass(err('overflowAgent'))} value={form.overflowAgentId} onChange={(e) => set({ overflowAgentId: e.target.value })}>
                <option value="">Choose an agent</option>
                {agents
                  .filter((a) => a.id !== form.agentId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.where})
                    </option>
                  ))}
              </select>
            </FormField>
          )}
          {form.overflow === 'wait' && <p className="text-[13px] text-muted">Callers keep waiting past the limit; many hang up after about two minutes.</p>}
          <FormField label="Hold message (optional)" hint="Played to callers while they wait.">
            <input className={fieldClass()} value={form.holdMessage} onChange={(e) => set({ holdMessage: e.target.value })} placeholder="e.g. Thanks for waiting, we’ll be with you shortly." maxLength={160} />
          </FormField>
        </Fieldset>

        <details className="rounded-lg border border-line p-4">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted">Advanced</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormField label="Rule type" hint={RULE_TYPES[form.type].note}>
              <select className={fieldClass()} value={form.type} onChange={(e) => set({ type: e.target.value as RuleType })}>
                {(Object.keys(RULE_TYPES) as RuleType[]).map((k) => (
                  <option key={k} value={k}>
                    {RULE_TYPES[k].label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Room name prefix" error={err('prefix')} hint="Rooms are named like call-1234.">
              <input className={fieldClass(err('prefix'))} value={form.roomPrefix} onChange={(e) => set({ roomPrefix: e.target.value.trim() })} placeholder="call-" maxLength={24} />
            </FormField>
          </div>
        </details>
      </form>
    </Dialog>
  );
}
