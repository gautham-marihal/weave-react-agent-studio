import React, { useMemo, useState } from 'react';
import type { ManifestTool } from '../../api/gatewayTypes';
import { StatusChip } from '../ui/StatusChip';
import { ACCESS, EFFECT } from '../../utils/bankingFormat';
import { Segmented } from '../ui/Segmented';

/** Every banking tool the gateway offers, from its manifest: what it does, who may use it, and its legacy source. */
export function ToolLibrary({ tools }: { tools: ManifestTool[] }) {
  const agents = useMemo(() => [...new Set(tools.flatMap((t) => t.agents))], [tools]);
  const [agent, setAgent] = useState('all');
  const shown = agent === 'all' ? tools : tools.filter((t) => t.agents.includes(agent));
  return (
    <div className="space-y-4">
      <Segmented size="sm" label="Specialist agent" options={[{ value: 'all', label: 'All' }, ...agents.map((a) => ({ value: a, label: a }))]} value={agent} onChange={setAgent} />
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {shown.map((t) => {
          const params = Object.entries(t.parameters.properties ?? {});
          return (
            <li key={t.name} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-[13px] font-medium text-ink">{t.name}</code>
                <StatusChip tone={EFFECT[t.effect].tone} title={EFFECT[t.effect].help}>
                  {EFFECT[t.effect].label}
                </StatusChip>
                <StatusChip title={t.service ? `Service: ${t.service}` : undefined}>{ACCESS[t.access]}</StatusChip>
                <span className="text-xs text-muted">{t.agents.join(', ')}</span>
              </div>
              <p className="mt-1 text-[13px] text-ink-soft">{t.description}</p>
              <dl className="mt-1.5 grid gap-x-3 gap-y-0.5 text-[12px] sm:grid-cols-[auto_1fr]">
                <dt className="text-muted">Inputs</dt>
                <dd className="text-ink-soft">
                  {params.length === 0
                    ? 'None'
                    : params.map(([name, p]) => (
                        <span key={name} className="mr-3 inline-block">
                          <code className="font-mono">{name}</code>
                          {t.parameters.required?.includes(name) ? '' : ' (optional)'}
                          {p.description ? `: ${p.description}` : ''}
                        </span>
                      ))}
                </dd>
                <dt className="text-muted">The agent sees</dt>
                <dd className="font-mono text-ink-soft">{t.returns.join(', ') || 'status only'}</dd>
                <dt className="text-muted">Legacy IVR</dt>
                <dd className="text-ink-soft">{t.legacy}</dd>
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
