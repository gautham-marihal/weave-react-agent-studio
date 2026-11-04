import React from 'react';
import SmartSelect from '../SmartSelect.jsx';
import Icon from '../../ui/Icon.jsx';
import {
  EXPECT_KINDS,
  GUARDRAIL_ACTION_CHOICES,
  HTTP_METHODS,
  LIMIT_CHOICES,
  inputRuleIdsOf,
  isUnknownExpectation,
  kindOfExpectation,
  newExpectation,
  outcomeNamesOf,
  regexProblem,
  taskIdsOf,
  toolChoices,
} from './model.js';
import Select from '../../ui/Select.tsx';
import { Input, TextArea } from '../../ui/Input.tsx';
import { JsonBox, ValueBox } from './JsonBox.jsx';

// One expectation row of the scenario editor: picks its kind and edits that kind's fields.
export default function ExpectRow({ value, onChange, onRemove, index, config, reportBox }) {
  const kind = kindOfExpectation(value);
  const tools = toolChoices(config);
  const states = Object.keys(config?.state?.variables || {});
  const agents = (Array.isArray(config?.agents?.items) ? config.agents.items : []).map((a) => a?.id).filter(Boolean);
  const label = (what) => `Expectation ${index + 1}: ${what}`;
  const unknown = isUnknownExpectation(value);

  if (unknown || !value || typeof value !== 'object') {
    return (
      <li className="scExpect unknown">
        <span className="scField">
          <small className="stMuted">This check isn’t one the form can edit, so it is kept exactly as it is. Use “Edit as JSON” to change it.</small>
          <code className="scUnknownCode">{JSON.stringify(value)}</code>
        </span>
        <button type="button" className="stIconBtn danger" aria-label={`Delete expectation ${index + 1}`} onClick={onRemove}>
          <Icon name="close" size={14} />
        </button>
      </li>
    );
  }

  const pickTool = (key, current) => (
    <SmartSelect
      className="stFInput small"
      value={current || ''}
      placeholder="Choose a tool…"
      ariaLabel={label('tool')}
      options={tools}
      onChange={(chosen) => onChange(key === 'tool_called_with' ? { tool_called_with: { ...value.tool_called_with, tool: chosen } } : { [key]: chosen })}
    />
  );
  const http = value[kind] || {};
  const setHttp = (patch) => {
    const next = { ...http, ...patch };
    Object.keys(next).forEach((k) => {
      if (next[k] === '' || next[k] === undefined) delete next[k];
    });
    onChange({ [kind]: next });
  };

  return (
    <li className="scExpect">
      <Select
        className="stFInput small"
        value={kind}
        onChange={(event) => {
          if (event.target.value !== kind) onChange(newExpectation(event.target.value, config));
        }}
        aria-label={label('what to check')}
      >
        {EXPECT_KINDS.map((k) => (
          <option key={k.key} value={k.key}>
            {k.label}
          </option>
        ))}
      </Select>

      {(kind === 'tool_called' || kind === 'tool_not_called') && pickTool(kind, value[kind])}

      {kind === 'tool_called_with' && (
        <>
          {pickTool('tool_called_with', value.tool_called_with?.tool)}
          <JsonBox
            onValid={reportBox}
            value={value.tool_called_with?.args ?? {}}
            label={label('arguments it must include')}
            rows={2}
            placeholder='{ "order_id": "NB-1003" }'
            onChange={(args) => onChange({ tool_called_with: { ...value.tool_called_with, args: args ?? {} } })}
          />
        </>
      )}

      {kind === 'state_equals' && (
        <>
          <SmartSelect
            className="stFInput small"
            value={value.state_equals?.state || ''}
            placeholder="Choose a variable…"
            ariaLabel={label('state variable')}
            options={states}
            onChange={(chosen) => onChange({ state_equals: { ...value.state_equals, state: chosen } })}
          />
          <ValueBox
            className="stFInput small mono"
            value={value.state_equals?.value}
            placeholder="value, e.g. true, 3 or paid"
            aria-label={label('value')}
            onChange={(parsed) => onChange({ state_equals: { ...value.state_equals, value: parsed } })}
          />
        </>
      )}

      {kind === 'said_matches' && (
        <span className="scField">
          <Input
            size="small"
            mono
            type="text"
            value={value.said_matches || ''}
            placeholder="a pattern, e.g. refund|money back"
            aria-label={label('pattern')}
            aria-invalid={!!regexProblem(value.said_matches || '') || undefined}
            onChange={(event) => onChange({ said_matches: event.target.value })}
          />
          {regexProblem(value.said_matches || '') && <small className="stFErr">Not a valid pattern: {regexProblem(value.said_matches)}</small>}
        </span>
      )}

      {kind === 'agent_is' && (
        <SmartSelect
          className="stFInput small"
          value={value.agent_is || ''}
          placeholder="Choose an agent…"
          ariaLabel={label('agent')}
          options={agents}
          onChange={(chosen) => onChange({ agent_is: chosen })}
        />
      )}

      {(kind === 'http_called' || kind === 'http_not_called') && (
        <>
          <Select
            className="stFInput small"
            value={http.method || ''}
            onChange={(event) => setHttp({ method: event.target.value })}
            aria-label={label('method')}
          >
            <option value="">Any method</option>
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
          <Input
            size="small"
            mono
            type="text"
            value={http.path || ''}
            placeholder="/orders/* (a * matches anything)"
            aria-label={label('path')}
            onChange={(event) => setHttp({ path: event.target.value })}
          />
          {kind === 'http_called' && (
            <Input
              size="small"
              type="number"
              min="1"
              step="1"
              value={http.times ?? ''}
              placeholder="times (empty: at least once)"
              aria-label={label('how many times')}
              onChange={(event) => setHttp({ times: event.target.value === '' ? undefined : Number(event.target.value) })}
            />
          )}
        </>
      )}

      {kind === 'task_outcome' && (
        <>
          <SmartSelect
            className="stFInput small"
            value={value.task_outcome?.task || ''}
            placeholder="Choose a task…"
            ariaLabel={label('task')}
            options={taskIdsOf(config)}
            onChange={(chosen) => onChange({ task_outcome: { ...value.task_outcome, task: chosen } })}
          />
          <Select
            className="stFInput small"
            value={value.task_outcome?.outcome || ''}
            onChange={(event) => {
              const next = { ...value.task_outcome };
              if (event.target.value) next.outcome = event.target.value;
              else delete next.outcome;
              onChange({ task_outcome: next });
            }}
            aria-label={label('how it ended')}
          >
            <option value="">Any way it ends</option>
            {[...new Set([...outcomeNamesOf(config, value.task_outcome?.task), ...(value.task_outcome?.outcome ? [value.task_outcome.outcome] : [])])].map(
              (name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ),
            )}
          </Select>
        </>
      )}

      {kind === 'guardrail_triggered' && (
        <>
          <SmartSelect
            className="stFInput small"
            value={value.guardrail_triggered?.rule || ''}
            placeholder="Choose a safety rule…"
            ariaLabel={label('safety rule')}
            options={inputRuleIdsOf(config)}
            onChange={(chosen) => onChange({ guardrail_triggered: { ...value.guardrail_triggered, rule: chosen } })}
          />
          <Select
            className="stFInput small"
            value={value.guardrail_triggered?.action || ''}
            onChange={(event) => {
              const next = { ...value.guardrail_triggered };
              if (event.target.value) next.action = event.target.value;
              else delete next.action;
              onChange({ guardrail_triggered: next });
            }}
            aria-label={label('what the rule did')}
          >
            <option value="">Whatever it did</option>
            {GUARDRAIL_ACTION_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </>
      )}

      {kind === 'guardrail_not_triggered' && (
        <SmartSelect
          className="stFInput small"
          value={value.guardrail_not_triggered || ''}
          placeholder="Choose a safety rule…"
          ariaLabel={label('safety rule')}
          options={inputRuleIdsOf(config)}
          onChange={(chosen) => onChange({ guardrail_not_triggered: chosen })}
        />
      )}

      {kind === 'limit_reached' && (
        <Select
          className="stFInput small"
          value={value.limit_reached || ''}
          onChange={(event) => onChange({ limit_reached: event.target.value })}
          aria-label={label('which limit')}
        >
          {!LIMIT_CHOICES.some((c) => c.value === value.limit_reached) && <option value="">Choose a limit…</option>}
          {LIMIT_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      )}

      {kind === 'judge' && (
        <TextArea
          size="small"
          rows={2}
          value={value.judge || ''}
          placeholder="e.g. the agent stays polite and does not promise a refund"
          aria-label={label('criterion')}
          onChange={(event) => onChange({ judge: event.target.value })}
        />
      )}
      <button type="button" className="stIconBtn danger" aria-label={`Delete expectation ${index + 1}`} onClick={onRemove}>
        <Icon name="close" size={14} />
      </button>
    </li>
  );
}
