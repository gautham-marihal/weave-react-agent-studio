import React, { useId, useMemo, useState } from 'react';
import { PlayIcon } from 'lucide-react';
import { gateway, GatewayError } from '../../api/gateway';
import type { ManifestTool, ToolResponse } from '../../api/gatewayTypes';
import { guidanceFor, type GuidanceActionId } from '../../models/bankingGuidance';
import { Button } from '../ui/Button';
import { StatusChip } from '../ui/StatusChip';
import { cn, inputClass } from '../../utils/styles';
import { EFFECT } from '../../utils/bankingFormat';
import { GuidanceNotice } from './GuidanceNotice';

const NO_ACTIONS = new Set<GuidanceActionId>();

/**
 * The agent's side of a rehearsal: staff pick a gateway tool and its inputs and run it as the runtime would. The
 * response is exactly what the model would receive (the gateway's whitelist), with the guidance a caller would get.
 * Mock gateway only; the Studio proxy forwards tool calls for rehearsal sessions and nothing else.
 */
export function AgentToolRunner({ callId, tools, defaultAccountRef }: { callId: string; tools: ManifestTool[]; defaultAccountRef: string | null }) {
  const id = useId();
  const [name, setName] = useState('list_services');
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<ToolResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tool = tools.find((t) => t.name === name);
  const byAgent = useMemo(() => {
    const groups = new Map<string, ManifestTool[]>();
    for (const t of tools) {
      const key = t.agents[0] ?? 'other';
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    return [...groups.entries()];
  }, [tools]);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tool) return;
    const args: Record<string, unknown> = {};
    for (const key of Object.keys(tool.parameters.properties ?? {})) {
      const v = (values[key] ?? '').trim() || (key === 'account_ref' && defaultAccountRef ? defaultAccountRef : '');
      if (v) args[key] = v;
    }
    setRunning(true);
    setError(null);
    setResponse(null);
    try {
      setResponse(await gateway.rehearsal.runTool(callId, tool.name, args));
    } catch (err) {
      setError(err instanceof GatewayError ? err.message : 'The banking gateway did not answer.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-xl border border-line bg-surface p-4">
      <h3 id={`${id}-title`} className="text-sm font-semibold text-ink">
        Agent&apos;s side
      </h3>
      <p className="text-[12px] text-muted">Run a tool as the agent runtime would. The result is what the model would see.</p>
      <form onSubmit={run} className="mt-3 space-y-2">
        <label htmlFor={`${id}-tool`} className="block text-[13px] font-medium text-ink">
          Tool
        </label>
        <select
          id={`${id}-tool`}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
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
            <div className="flex flex-wrap gap-1.5">
              <StatusChip tone={EFFECT[tool.effect].tone}>{EFFECT[tool.effect].label}</StatusChip>
              <span className="text-[12px] text-muted">{tool.legacy}</span>
            </div>
            {Object.entries(tool.parameters.properties ?? {}).map(([key, p]) => (
              <div key={key}>
                <label htmlFor={`${id}-${key}`} className="block text-[12px] font-medium text-ink">
                  {key}
                  {tool.parameters.required?.includes(key) ? '' : ' (optional)'}
                </label>
                {p.enum ? (
                  <select id={`${id}-${key}`} value={values[key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} className={inputClass}>
                    <option value="">—</option>
                    {p.enum.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`${id}-${key}`}
                    value={values[key] ?? ''}
                    placeholder={key === 'account_ref' && defaultAccountRef ? `${defaultAccountRef} (from the profile)` : p.description}
                    onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                    className={cn(inputClass, 'font-mono')}
                    autoComplete="off"
                  />
                )}
              </div>
            ))}
          </>
        )}
        <Button type="submit" variant="primary" disabled={running || !tool}>
          <PlayIcon className="h-3.5 w-3.5" aria-hidden />
          Run as the agent
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {error}
        </p>
      )}
      {response && (
        <div className="mt-3 space-y-2">
          {!response.ok && <GuidanceNotice guidance={guidanceFor({ kind: 'tool', response }, NO_ACTIONS)} help={undefined} onAction={() => undefined} />}
          {typeof response.say === 'string' && (
            <p className="rounded-md bg-accent-soft px-3 py-2 text-[13px] text-ink">
              <span className="font-medium">The agent reads: </span>
              {response.say}
            </p>
          )}
          <pre className="max-h-64 overflow-auto rounded-md bg-subtle p-2 font-mono text-[11px] leading-relaxed text-ink-soft">{JSON.stringify(response, null, 2)}</pre>
        </div>
      )}
    </section>
  );
}
