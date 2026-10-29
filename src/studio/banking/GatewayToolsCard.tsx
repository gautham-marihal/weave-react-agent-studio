import { useEffect, useId, useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import Button from '../../ui/Button.tsx';
import { gateway, GatewayError } from '../../api/gateway.ts';
import type { GatewayHealth, GeneratedAgentConfig, ManifestTool } from '../../api/gatewayTypes.ts';
import { applyGatewayConfig, GATEWAY_URL_CONSTANT, usesGateway, type AgentConfig, type GatewayConfigChange } from './gatewayConfig.ts';
import { ACCESS, EFFECT } from './format.ts';
import { Chip, cn, inputClass, panelClass, toneBox } from './ui.tsx';

/**
 * On the Banking page: adds the banking gateway's tools to the draft, or refreshes them, from the gateway's own
 * generated config (never hand-copied JSON), and lists every tool it offers. The change is an ordinary edit of the
 * draft (undo works, the server validates it); nothing is saved, published or deployed here. Without a gateway it
 * says how to set one up.
 */
export default function GatewayToolsCard({ config, onChange }: { config: AgentConfig; onChange?: (next: AgentConfig) => void }) {
  const id = useId();
  const [health, setHealth] = useState<GatewayHealth | null>(null);
  const [healthError, setHealthError] = useState<GatewayError | null>(null);
  const [url, setUrl] = useState(() => String(config.constants?.[GATEWAY_URL_CONSTANT] ?? ''));
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<{ change: GatewayConfigChange; generated: GeneratedAgentConfig } | null>(null);
  const [error, setError] = useState('');
  const wired = usesGateway(config);

  useEffect(() => {
    const controller = new AbortController();
    gateway
      .health(controller.signal)
      .then(setHealth)
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setHealthError(err instanceof GatewayError ? err : new GatewayError(0, 'server', 'The banking gateway did not answer.'));
      });
    return () => controller.abort();
  }, []);

  const apply = async () => {
    if (!onChange) return;
    setWorking(true);
    setError('');
    setResult(null);
    try {
      const generated = await gateway.agentConfig();
      const change = applyGatewayConfig(config, generated, url.trim() || undefined);
      if (change.ok && change.changed) onChange(change.config);
      setResult({ change, generated });
    } catch (err) {
      setError(err instanceof GatewayError ? err.message : 'The banking gateway did not answer.');
    } finally {
      setWorking(false);
    }
  };

  const notConfigured = healthError?.kind === 'not_configured';

  return (
    <section aria-labelledby={`${id}-title`} className={panelClass}>
      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
        <h3 id={`${id}-title`} className="tw-m-0 tw-flex tw-items-center tw-gap-2 tw-text-md tw-font-semibold tw-text-ink">
          <Icon name="bank" size={16} />
          Banking gateway tools
        </h3>
        <div className="tw-flex tw-flex-wrap tw-gap-1.5">
          {wired && <Chip tone="accent">In this draft</Chip>}
          {health && (
            <Chip tone={health.hosts === 'mock' ? 'warning' : 'success'}>{health.hosts === 'mock' ? 'Gateway · test environment' : 'Gateway reachable'}</Chip>
          )}
          {health && !health.policy_approved && <Chip>Rules not yet approved</Chip>}
        </div>
      </div>
      <p className="tw-mb-0 tw-mt-1 tw-text-sm tw-text-ink-soft">
        Sign-in, balances, cheques, rates and appointments run in the bank’s gateway, which enforces verification, entitlements and confirmations in code. These
        tools let the agent call it. Try them on Tests → Banking, by chat or voice.
      </p>

      {notConfigured ? (
        <p className="tw-mb-0 tw-mt-3 tw-rounded-control tw-bg-subtle tw-px-3 tw-py-2 tw-text-sm tw-text-ink-soft">
          No banking gateway is set up for this studio. Set <code>BANKING_GATEWAY_URL</code> and <code>BANKING_GATEWAY_TOKEN</code> for the studio server (see
          .env.example).
        </p>
      ) : healthError ? (
        <p className="tw-mb-0 tw-mt-3 tw-text-sm tw-text-danger" role="alert">
          {healthError.message}
        </p>
      ) : (
        <div className="tw-mt-3 tw-space-y-2">
          <label htmlFor={`${id}-url`} className="tw-block tw-text-sm tw-font-medium tw-text-ink">
            Gateway address the agent runtime uses
          </label>
          <p id={`${id}-url-hint`} className="tw-m-0 tw-text-xs tw-text-muted">
            Kept as the constant <code>{GATEWAY_URL_CONSTANT}</code>. It must be reachable from the runtime, not just from this computer.
          </p>
          <div className="tw-flex tw-flex-wrap tw-gap-2">
            <input
              id={`${id}-url`}
              type="url"
              value={url}
              disabled={!onChange || working}
              aria-describedby={`${id}-url-hint`}
              placeholder="https://"
              onChange={(event) => setUrl(event.target.value)}
              className={cn(inputClass, 'tw-min-w-[220px] tw-flex-1')}
            />
            <Button type="button" variant="primary" size="compact" onClick={apply} disabled={!onChange || working || !health}>
              <Icon name={working ? 'loader' : 'refresh'} size={14} className={working ? 'tw-animate-spin motion-reduce:tw-animate-none' : undefined} />
              {wired ? 'Refresh banking tools' : 'Add banking tools'}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="tw-mb-0 tw-mt-3 tw-text-sm tw-text-danger" role="alert">
          {error}
        </p>
      )}
      {result && <ChangeReport change={result.change} generated={result.generated} />}
      {health && <ToolCatalogue />}
    </section>
  );
}

function ChangeReport({ change, generated }: { change: GatewayConfigChange; generated: GeneratedAgentConfig }) {
  if (!change.ok) {
    return (
      <div role="alert" className={cn('tw-mt-3 tw-rounded-control tw-border tw-border-solid tw-px-3 tw-py-2 tw-text-sm', toneBox.danger)}>
        <p className="tw-m-0 tw-font-medium tw-text-ink">Nothing was changed.</p>
        <ul className="tw-mb-0 tw-mt-1 tw-pl-5 tw-text-ink-soft">
          {change.conflicts.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    );
  }
  const counts = [
    change.added.length && `${change.added.length} added`,
    change.updated.length && `${change.updated.length} updated`,
    change.removed.length && `${change.removed.length} removed`,
    change.unchanged.length && `${change.unchanged.length} already up to date`,
  ].filter(Boolean);
  return (
    <div
      role="status"
      className="tw-mt-3 tw-space-y-2 tw-rounded-control tw-border tw-border-solid tw-border-line tw-bg-subtle tw-px-3 tw-py-2 tw-text-sm tw-text-ink-soft"
    >
      <p className="tw-m-0 tw-font-medium tw-text-ink">
        {change.changed ? `Draft updated: ${counts.join(', ')}.` : 'The draft already has the current banking tools. Nothing changed.'}
      </p>
      {change.changed && <p className="tw-m-0">Changed in your draft only (undo works). Check the problems list, then save when ready.</p>}
      {change.connectionKept && <p className="tw-m-0">The existing banking_gateway connection was kept as you set it.</p>}
      {change.rolesUpdated.length > 0 && <p className="tw-m-0">Tools given to: {change.rolesUpdated.join(', ')}.</p>}
      {change.rolesMissing.length > 0 && (
        <p className="tw-m-0">
          These specialist agents aren’t in the draft, so their banking tools aren’t given to anyone yet:{' '}
          <strong className="tw-font-medium tw-text-ink">{change.rolesMissing.join(', ')}</strong>. Add them, with instructions, then refresh.
        </p>
      )}
      {change.rolesOverLimit.length > 0 && <p className="tw-m-0 tw-text-warning">Over the 8-tool limit: {change.rolesOverLimit.join(', ')}.</p>}
      {generated.runtimeDependencies.length > 0 && (
        <div>
          <p className="tw-m-0 tw-font-medium tw-text-ink">Not yet verified with the runtime</p>
          <ul className="tw-mb-0 tw-mt-0.5 tw-pl-5">
            {generated.runtimeDependencies.map((d) => (
              <li key={d.placeholder}>
                <code>{d.placeholder}</code> in {d.used_in}: needed for {d.needed_for}.
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Every banking tool the gateway offers, from its manifest: what it does, who may use it, what the agent sees. */
function ToolCatalogue() {
  const [tools, setTools] = useState<ManifestTool[] | null>(null);
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState('all');
  useEffect(() => {
    if (!open || tools) return;
    const controller = new AbortController();
    gateway
      .manifest(controller.signal)
      .then(setTools)
      .catch(() => {
        if (!controller.signal.aborted) setTools([]);
      });
    return () => controller.abort();
  }, [open, tools]);
  const agents = useMemo(() => [...new Set((tools ?? []).flatMap((t) => t.agents))], [tools]);
  const shown = (tools ?? []).filter((t) => agent === 'all' || t.agents.includes(agent));

  return (
    <details className="tw-mt-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="tw-cursor-pointer tw-text-sm tw-font-medium tw-text-accent-ink">See every banking tool{tools ? ` (${tools.length})` : ''}</summary>
      {!tools ? (
        <p className="tw-mb-0 tw-mt-2 tw-text-sm tw-text-muted">Loading…</p>
      ) : tools.length === 0 ? (
        <p className="tw-mb-0 tw-mt-2 tw-text-sm tw-text-muted">The gateway listed no tools.</p>
      ) : (
        <div className="tw-mt-2 tw-space-y-2">
          <label className="tw-flex tw-items-center tw-gap-2 tw-text-sm tw-text-ink-soft">
            Specialist
            <select value={agent} onChange={(event) => setAgent(event.target.value)} className={cn(inputClass, 'tw-w-auto')}>
              <option value="all">All</option>
              {agents.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <ul className="tw-m-0 tw-list-none tw-rounded-control tw-border tw-border-solid tw-border-line tw-p-0">
            {shown.map((t) => {
              const params = Object.entries(t.parameters.properties ?? {});
              return (
                <li key={t.name} className="tw-border-0 tw-border-b tw-border-solid tw-border-line tw-px-3 tw-py-2.5 last:tw-border-b-0">
                  <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
                    <code className="tw-text-sm tw-font-medium tw-text-ink">{t.name}</code>
                    <Chip tone={EFFECT[t.effect].tone} title={EFFECT[t.effect].help}>
                      {EFFECT[t.effect].label}
                    </Chip>
                    <Chip title={t.service ? `Service: ${t.service}` : undefined}>{ACCESS[t.access]}</Chip>
                  </div>
                  <p className="tw-mb-0 tw-mt-1 tw-text-sm tw-text-ink-soft">{t.description}</p>
                  <p className="tw-mb-0 tw-mt-1 tw-text-xs tw-text-muted">
                    Inputs: {params.length ? params.map(([name]) => `${name}${t.parameters.required?.includes(name) ? '' : ' (optional)'}`).join(', ') : 'none'}{' '}
                    · The agent sees: {t.returns.join(', ') || 'status only'}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </details>
  );
}
