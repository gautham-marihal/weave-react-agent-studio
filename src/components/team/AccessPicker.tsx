import React, { useId, useMemo, useState } from 'react';
import {
  ASSIGNABLE_ROLES,
  WHOLE_WORKSPACE,
  agentsScope,
  describeGrant,
  isWhole,
  roleOf,
  scopeAgents,
  scopeProblem,
  type Scope,
  type TeamAgent,
  type TeamRole,
} from '../../models/team';
import { cn, inputClass } from '../../utils/styles';

// Giving access as two choices: what they may do (the role) and where (the whole workspace, or the agents ticked),
// with a sentence saying what the choice gives before anyone confirms it.

interface AccessPickerProps {
  role: TeamRole;
  scope: Scope;
  agents: TeamAgent[];
  onChange: (next: { role: TeamRole; scope: Scope }) => void;
}

const card = (on: boolean, off = false) =>
  cn(
    'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors',
    on ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface hover:border-line-strong',
    off && 'cursor-not-allowed opacity-60 hover:border-line'
  );

export function AccessPicker({ role, scope, agents, onChange }: AccessPickerProps) {
  const name = useId();
  const [query, setQuery] = useState('');
  const r = roleOf(role);
  const whole = isWhole(scope);
  const chosen = scopeAgents(scope);
  const shown = useMemo(
    () => agents.filter((a) => !query.trim() || `${a.name} ${a.id}`.toLowerCase().includes(query.trim().toLowerCase())),
    [agents, query]
  );
  const setRole = (next: TeamRole) => onChange({ role: next, scope: roleOf(next).workspaceOnly ? WHOLE_WORKSPACE : scope });
  const toggle = (id: string) => onChange({ role, scope: agentsScope(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]) });
  const problem = scopeProblem(role, scope);

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">What can they do?</legend>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Role">
          {ASSIGNABLE_ROLES.map((option) => (
            <label key={option.id} className={card(role === option.id)}>
              <input
                type="radio"
                name={`${name}-role`}
                value={option.id}
                checked={role === option.id}
                onChange={() => setRole(option.id)}
                aria-label={option.label}
                className="mt-0.5 accent-[rgb(var(--accent))]"
              />
              <span>
                <span className="block text-sm font-semibold text-ink">{option.label}</span>
                <span className="block text-xs leading-relaxed text-muted">{option.blurb}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">Which agents?</legend>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Access">
          <label className={card(whole)}>
            <input
              type="radio"
              name={`${name}-scope`}
              checked={whole}
              onChange={() => onChange({ role, scope: WHOLE_WORKSPACE })}
              aria-label="The whole workspace"
              className="mt-0.5 accent-[rgb(var(--accent))]"
            />
            <span>
              <span className="block text-sm font-semibold text-ink">The whole workspace</span>
              <span className="block text-xs text-muted">Every agent, including the ones made later.</span>
            </span>
          </label>
          <label className={card(!whole, r.workspaceOnly)}>
            <input
              type="radio"
              name={`${name}-scope`}
              checked={!whole}
              disabled={r.workspaceOnly}
              onChange={() => onChange({ role, scope: agentsScope(chosen) })}
              aria-label="Only some agents"
              className="mt-0.5 accent-[rgb(var(--accent))]"
            />
            <span>
              <span className="block text-sm font-semibold text-ink">Only some agents</span>
              <span className="block text-xs text-muted">
                {r.workspaceOnly ? `${r.label}s run the whole workspace, so this is not available for them.` : 'Pick the agents. Nothing else is visible to them.'}
              </span>
            </span>
          </label>
        </div>

        {!whole && !r.workspaceOnly && (
          <div className="mt-3 rounded-lg border border-line bg-canvas/60 p-3">
            {agents.length > 8 && (
              <input
                type="search"
                value={query}
                placeholder="Search agents"
                aria-label="Search agents"
                onChange={(e) => setQuery(e.target.value)}
                className={cn(inputClass, 'mb-2 h-8 py-1 text-[13px]')}
              />
            )}
            <div className="mb-2 flex items-center gap-3 text-xs">
              <button type="button" className="font-medium text-accent hover:underline" onClick={() => onChange({ role, scope: agentsScope(agents.map((a) => a.id)) })}>
                Select all
              </button>
              <button
                type="button"
                className="font-medium text-accent hover:underline disabled:text-muted disabled:no-underline"
                onClick={() => onChange({ role, scope: agentsScope([]) })}
                disabled={chosen.length === 0}
              >
                Clear
              </button>
              <span className="ml-auto text-muted">
                {chosen.length} of {agents.length} chosen
              </span>
            </div>
            <ul className="max-h-48 space-y-1 overflow-y-auto" aria-label="Agents">
              {shown.map((agent) => (
                <li key={agent.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-subtle">
                    <input
                      type="checkbox"
                      checked={chosen.includes(agent.id)}
                      onChange={() => toggle(agent.id)}
                      aria-label={agent.name}
                      className="accent-[rgb(var(--accent))]"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-ink">{agent.name}</span>
                      <span className="block truncate font-mono text-[11px] text-muted">{agent.id}</span>
                    </span>
                  </label>
                </li>
              ))}
              {shown.length === 0 && (
                <li className="px-2 py-1.5 text-xs text-muted">
                  {agents.length === 0 ? 'There are no agents yet. Choose “The whole workspace” to cover the ones you make later.' : 'No agent matches.'}
                </li>
              )}
            </ul>
          </div>
        )}
      </fieldset>

      <p className={cn('rounded-lg px-3 py-2 text-[13px]', problem ? 'bg-danger-soft text-danger' : 'bg-subtle text-ink-soft')} role="status" data-testid="team-grant">
        {problem || describeGrant({ role, scope, agents })}
      </p>
    </div>
  );
}
