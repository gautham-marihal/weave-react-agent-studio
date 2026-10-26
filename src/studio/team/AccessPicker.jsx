import React, { useId, useMemo, useState } from 'react';
import { ASSIGNABLE_ROLES, WHOLE_WORKSPACE, agentsScope, describeGrant, isWhole, roleOf, scopeAgents, scopeProblem } from './teamModel.js';
import './team.css';

// The two decisions of giving someone access, each as a choice of cards: WHAT they may do (the role) and WHERE (the
// whole workspace, or only the agents ticked). A line under them says what the choice gives, in a sentence, before
// anyone confirms it.
//   fixedAgent: the one agent a panel is about (then "where" is not asked: the access is to that agent)
export default function AccessPicker({ role, scope, agents, onChange, fixedAgent = null, roles = ASSIGNABLE_ROLES }) {
  const name = useId();
  const [query, setQuery] = useState('');
  const r = roleOf(role);
  const whole = isWhole(scope);
  const chosen = scopeAgents(scope);
  const shown = useMemo(() => agents.filter((a) => !query.trim() || `${a.name} ${a.id}`.toLowerCase().includes(query.trim().toLowerCase())), [agents, query]);
  const setRole = (next) => onChange({ role: next, scope: roleOf(next).workspaceOnly ? WHOLE_WORKSPACE : scope });
  const toggle = (id) => onChange({ role, scope: agentsScope(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]) });
  const problem = fixedAgent ? '' : scopeProblem(role, scope);

  return (
    <div className="tmAccess">
      <fieldset className="tmGroup">
        <legend>What can they do?</legend>
        <div className="tmCards" role="radiogroup" aria-label="Role">
          {roles.map((option) => (
            <label key={option.id} className={`tmCard ${role === option.id ? 'on' : ''}`}>
              <input
                type="radio"
                name={`${name}-role`}
                value={option.id}
                checked={role === option.id}
                onChange={() => setRole(option.id)}
                aria-label={option.label}
              />
              <span className="tmCardText">
                <strong>{option.label}</strong>
                <small>{option.blurb}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {!fixedAgent && (
        <fieldset className="tmGroup">
          <legend>Which agents?</legend>
          <div className="tmCards" role="radiogroup" aria-label="Access">
            <label className={`tmCard ${whole ? 'on' : ''}`}>
              <input
                type="radio"
                name={`${name}-scope`}
                checked={whole}
                onChange={() => onChange({ role, scope: WHOLE_WORKSPACE })}
                aria-label="The whole workspace"
              />
              <span className="tmCardText">
                <strong>The whole workspace</strong>
                <small>Every agent, including the ones made later.</small>
              </span>
            </label>
            <label className={`tmCard ${!whole ? 'on' : ''} ${r.workspaceOnly ? 'off' : ''}`}>
              <input
                type="radio"
                name={`${name}-scope`}
                checked={!whole}
                disabled={r.workspaceOnly}
                onChange={() => onChange({ role, scope: agentsScope(chosen) })}
                aria-label="Only some agents"
              />
              <span className="tmCardText">
                <strong>Only some agents</strong>
                <small>
                  {r.workspaceOnly
                    ? `${r.label}s run the whole workspace, so this is not available for them.`
                    : 'Pick the agents. Nothing else is visible to them.'}
                </small>
              </span>
            </label>
          </div>
          {!whole && !r.workspaceOnly && (
            <div className="tmAgents">
              {agents.length > 8 && (
                <input
                  className="stFInput"
                  type="search"
                  value={query}
                  placeholder="Search agents"
                  aria-label="Search agents"
                  onChange={(event) => setQuery(event.target.value)}
                />
              )}
              <div className="tmAgentTools">
                <button type="button" className="linkButton" onClick={() => onChange({ role, scope: agentsScope(agents.map((a) => a.id)) })}>
                  Select all
                </button>
                <button type="button" className="linkButton" onClick={() => onChange({ role, scope: agentsScope([]) })} disabled={chosen.length === 0}>
                  Clear
                </button>
                <span>
                  {chosen.length} of {agents.length} chosen
                </span>
              </div>
              <ul className="tmAgentList" aria-label="Agents">
                {shown.map((agent) => (
                  <li key={agent.id}>
                    <label>
                      <input type="checkbox" checked={chosen.includes(agent.id)} onChange={() => toggle(agent.id)} aria-label={agent.name} />
                      <span className="tmAgentAvatar" aria-hidden="true">
                        {String(agent.name).slice(0, 1).toUpperCase()}
                      </span>
                      <span>
                        {agent.name}
                        <small>{agent.id}</small>
                      </span>
                    </label>
                  </li>
                ))}
                {shown.length === 0 && (
                  <li className="tmNone">
                    {agents.length === 0 ? 'There are no agents yet. Choose “The whole workspace” to cover the ones you make later.' : 'No agent matches.'}
                  </li>
                )}
              </ul>
            </div>
          )}
        </fieldset>
      )}

      <p className={`tmGrant ${problem ? 'bad' : ''}`} role="status">
        {problem || describeGrant({ role, scope: fixedAgent ? agentsScope([fixedAgent.id]) : scope, agents: fixedAgent ? [fixedAgent] : agents })}
      </p>
    </div>
  );
}
