import React, { useEffect, useId, useState } from 'react';
import { LandmarkIcon, LoaderCircleIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { gateway, GatewayError, runtimeAddress } from '../../../api/gateway';
import type { GeneratedAgentConfig, ManifestTool } from '../../../api/gatewayTypes';
import { useBankingSource } from '../../../hooks/useBankingSource';
import { BANKING_ENTRY, BANKING_ROLES, bankingRolesOf, handoffClashes, isBankingAgent, makeBankingAgent, removeBankingAgent, type BankingAgentChange } from '../../../models/bankingAgent';
import { bankingStatus } from '../../../models/bankingStatus';
import { GATEWAY_CONNECTION, MAX_AGENT_TOOLS } from '../../../models/bankingTools';
import type { AgentConfig, AgentRole } from '../../../types/studio';
import { Button } from '../../ui/Button';
import { StatusChip } from '../../ui/StatusChip';
import { BankingSourceNotice } from '../../banking/BankingSourceNotice';
import { RehearsalConsole } from '../../banking/RehearsalConsole';
import { ToolLibrary } from '../../banking/ToolLibrary';
import { cn } from '../../../utils/styles';

/**
 * Banking for this agent: makes it a complete banking agent in one step (the gateway's generated config, six specialist
 * roles with their instructions and hand-offs, and the gateway address the runtime calls, filled in from this Studio
 * server so nobody types it), refreshes it, or takes it out again; and "Try a banking tool" against a test session. Every change goes through the draft editor as one undo step;
 * nothing is saved, published or deployed here. Where answers come from is said plainly (bankingSource).
 */
export function BankingToolsSection({ config, disabled, replaceConfig }: { config: AgentConfig; disabled: boolean; replaceConfig?: (next: AgentConfig) => void }) {
  const id = useId();
  const source = useBankingSource();
  const status = source ? bankingStatus(source) : null;
  const wired = isBankingAgent(config);
  // hand-offs that share a name: the server refuses the agent until they are repaired
  const clashes = handoffClashes(config);
  const readOnly = disabled || !replaceConfig;
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<{ change: BankingAgentChange; generated: GeneratedAgentConfig; refresh: boolean } | null>(null);
  const [note, setNote] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [tools, setTools] = useState<ManifestTool[]>([]);
  const roles = bankingRolesOf(config);
  const gatewayTools = (config.tools ?? []).filter((t) => t.connection === GATEWAY_CONNECTION).length;
  const own = ((config.agents?.items ?? []) as AgentRole[]).find((r) => !BANKING_ROLES.some((s) => s.id === r.id));

  // The gateway's tools, for "Try a banking tool" and the list of every tool (once it is known where they come from).
  const found = status !== null;
  useEffect(() => {
    if (!wired || !found) return;
    const controller = new AbortController();
    gateway
      .manifest(controller.signal)
      .then(setTools)
      .catch(() => undefined);
    return () => controller.abort();
  }, [wired, found]);

  const apply = async (refresh: boolean) => {
    if (!replaceConfig) return;
    setWorking(true);
    setNote(null);
    setResult(null);
    try {
      const [generated, address] = await Promise.all([gateway.agentConfig(), runtimeAddress()]);
      const change = makeBankingAgent(config, generated, { gatewayUrl: address || undefined });
      if (change.ok && change.changed) replaceConfig(change.config);
      setResult({ change, generated, refresh });
    } catch (e) {
      setNote({ tone: 'danger', text: e instanceof GatewayError ? e.message : 'The banking gateway did not answer.' });
    } finally {
      setWorking(false);
    }
  };

  const remove = () => {
    if (!replaceConfig) return;
    setConfirmRemove(false);
    setResult(null);
    const r = removeBankingAgent(config);
    if (!r.ok) {
      setNote({ tone: 'danger', text: r.reason });
      return;
    }
    replaceConfig(r.config);
    setNote({ tone: 'info', text: 'Banking removed from your draft (undo is available). Save when ready.' });
  };

  return (
    <section aria-labelledby={`${id}-title`} data-banking={wired ? 'on' : 'off'} className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-title`} className="flex items-center gap-2 text-sm font-semibold text-ink">
          <LandmarkIcon className="h-4 w-4 text-muted" aria-hidden />
          Banking
        </h3>
        {wired && <StatusChip tone="accent">Banking agent</StatusChip>}
      </div>
      <p className="mt-1 text-[13px] text-ink-soft">
        {wired
          ? 'This agent answers business banking through the bank’s gateway, which enforces sign-in, entitlements and confirmations in code.'
          : 'Make this agent a banking agent: sign-in on a secure keypad, balances, transactions, cheques, rates and appointments, through the bank’s gateway.'}
      </p>
      <BankingSourceNotice source={source} className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-soft" />

      {wired && clashes.length > 0 && (
        <div role="alert" data-banking-repair className="mt-3 rounded-lg border border-danger/30 bg-danger-soft/40 px-3 py-2.5 text-[13px] text-ink">
          <p className="font-medium">The server refuses this agent: hand-offs share a name ({clashes.slice(0, 3).join(', ')}{clashes.length > 3 ? '…' : ''}).</p>
          <p className="mt-0.5 text-ink-soft">An older Studio gave several banking roles the same hand-off, so tests can’t start and it can’t be published. Repair gives each its own name; then save.</p>
          <Button size="sm" variant="primary" className="mt-2" onClick={() => apply(true)} disabled={readOnly || working || !status}>
            {working ? <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden />}
            Repair banking hand-offs
          </Button>
        </div>
      )}

      {wired && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-[13px] text-ink">
              {roles.length} banking {roles.length === 1 ? 'role' : 'roles'}, {gatewayTools} banking tools.
              {config.agents?.entry === BANKING_ENTRY ? ' The banking front desk answers first.' : ''}
              {own ? ` ${own.name || own.id} takes questions that are not banking.` : ''}
            </p>
            <ul aria-label="Banking roles" className="mt-1.5 flex flex-wrap gap-1.5">
              {roles.map((r) => (
                <li key={r.id}>
                  <StatusChip tone={r.withinLimit ? 'neutral' : 'warning'} title={`${r.tools} of at most ${MAX_AGENT_TOOLS} tools`}>
                    {r.name} · {r.tools} tools
                  </StatusChip>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {wired ? (
          <>
            <Button variant="secondary" onClick={() => apply(true)} disabled={readOnly || working || !status}>
              {working ? <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden />}
              Refresh banking tools
            </Button>
            {confirmRemove ? (
              <span role="group" aria-label="Remove banking from this agent?" className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
                Remove the banking roles and tools{own ? `; ${own.name || own.id} answers first again` : ''}?
                <Button size="sm" variant="danger" onClick={remove}>
                  Remove
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                  Keep
                </Button>
              </span>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmRemove(true)} disabled={readOnly}>
                <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
                Remove banking
              </Button>
            )}
          </>
        ) : (
          <Button variant="primary" onClick={() => apply(false)} disabled={readOnly || working || !status}>
            {working ? <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <LandmarkIcon className="h-3.5 w-3.5" aria-hidden />}
            Make this a banking agent
          </Button>
        )}
      </div>
      {readOnly && <p className="mt-2 text-[12px] text-muted">You can view this draft but not change it.</p>}

      {note && (
        <p role={note.tone === 'danger' ? 'alert' : 'status'} className={cn('mt-3 text-[13px]', note.tone === 'danger' ? 'text-danger' : 'text-ink-soft')}>
          {note.text}
        </p>
      )}
      {result && <ChangeReport {...result} />}

      {wired && (
        <>
          <details className="group mt-4 rounded-lg border border-line" data-banking-try>
            <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-ink">Try a banking tool</summary>
            <div className="border-t border-line p-3">
              <RehearsalConsole tools={tools} />
            </div>
          </details>
          {tools.length > 0 && (
            <details className="mt-2 rounded-lg border border-line">
              <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-ink">Every banking tool ({tools.length})</summary>
              <div className="border-t border-line p-3">
                <ToolLibrary tools={tools} />
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function ChangeReport({ change, generated, refresh }: { change: BankingAgentChange; generated: GeneratedAgentConfig; refresh: boolean }) {
  if (!change.ok) {
    return (
      <div role="alert" className="mt-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px]">
        <p className="font-medium text-ink">Nothing was changed.</p>
        <ul className="mt-1 list-inside list-disc text-ink-soft">
          {change.conflicts.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    );
  }
  const g = change.gateway;
  const counts = g
    ? [g.added.length && `${g.added.length} tools added`, g.updated.length && `${g.updated.length} updated`, g.removed.length && `${g.removed.length} removed`, change.rolesAdded.length && `${change.rolesAdded.length} roles added`].filter(Boolean)
    : [];
  return (
    <div role="status" className="mt-3 space-y-2 rounded-md border border-line bg-subtle px-3 py-2 text-[13px] text-ink-soft">
      <p className="font-medium text-ink">
        {!change.changed ? 'The draft already has the current banking roles and tools. Nothing changed.' : refresh ? `Draft updated: ${counts.join(', ')}.` : `This is now a banking agent: ${counts.join(', ')}.`}
      </p>
      {change.changed && <p>Edited in your draft only (undo is available). Check the server&apos;s validation, then save when ready.</p>}
      {g?.connectionKept && <p>The existing banking_gateway connection was kept as you set it.</p>}
      {g && g.rolesOverLimit.length > 0 && <p className="text-warning">Over the {MAX_AGENT_TOOLS}-tool limit: {g.rolesOverLimit.join(', ')}.</p>}
      {generated.runtimeDependencies.length > 0 && (
        <div>
          <p className="font-medium text-ink">Not yet verified with the agent runtime</p>
          <ul className="mt-0.5 list-inside list-disc">
            {generated.runtimeDependencies.map((d) => (
              <li key={d.placeholder}>
                <code className="font-mono">{d.placeholder}</code> in {d.used_in}: needed for {d.needed_for}.
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
