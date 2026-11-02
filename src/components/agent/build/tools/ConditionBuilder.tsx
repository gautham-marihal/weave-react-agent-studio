import React, { useEffect, useState } from 'react';
import { CONDITION_OPERATORS, CONDITION_SOURCES, describeCondition, isSimpleCondition, readCondition, typedValue, valueText, writeCondition, type ConditionOperator, type ConditionSource } from '../../../../models/effects';
import { cn, inputClass } from '../../../../utils/styles';
import { IdSelect, Note } from './parts';
import { linkButton } from './keys';

type Json = Record<string, unknown>;

interface ConditionBuilderProps {
  value: unknown;
  onChange: (next: Json) => void;
  stateVars: string[];
  argNames: string[];
  disabled?: boolean;
  label: string;
}

/**
 * A simple condition ("the state verified is true", "the argument count is at least 3") as one row. A combined one
 * (all / any / not, a channel, business hours) is edited as JSON here, with the sentence it reads as.
 */
export function ConditionBuilder({ value, onChange, stateVars, argNames, disabled, label }: ConditionBuilderProps) {
  const simple = value === undefined || (typeof value === 'object' && value !== null && Object.keys(value).length === 0) || isSimpleCondition(value);
  const [advanced, setAdvanced] = useState(!simple);
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState('');
  const outside = JSON.stringify(value ?? {});
  useEffect(() => {
    try {
      if (JSON.stringify(JSON.parse(text)) === outside) return;
    } catch {
      /* replaced below */
    }
    setText(JSON.stringify(value ?? {}, null, 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outside]);

  if (advanced || !simple) {
    return (
      <div className="space-y-1.5">
        <p className="text-[13px] text-ink-soft">When {describeCondition(value)}</p>
        <textarea
          aria-label={`${label} as JSON`}
          rows={4}
          spellCheck={false}
          className={cn(inputClass, 'resize-y font-mono text-[13px]')}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            try {
              const next: unknown = JSON.parse(e.target.value);
              if (typeof next !== 'object' || next === null || Array.isArray(next)) throw new Error('A condition is a JSON object.');
              setError('');
              onChange(next as Json);
            } catch (err: unknown) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }} />
        {error && <Note tone="error" role="alert">Not valid yet: {error}</Note>}
        <Note>Combine conditions with {'{ "all": [...] }'}, {'{ "any": [...] }'} or {'{ "not": {...} }'}.</Note>
        {simple && !disabled &&
        <button type="button" className={cn(linkButton, 'text-xs')} onClick={() => setAdvanced(false)}>
            Back to the simple condition
          </button>
        }
      </div>);

  }

  const c = readCondition(value);
  const set = (change: Parameters<typeof writeCondition>[1]) => onChange(writeCondition(c, change));
  const subjectBox =
  c.source === 'state' ?
  <IdSelect label={`${label}: which state variable`} value={c.subject} options={stateVars} disabled={disabled} onChange={(v) => set({ subject: v })} placeholder="Choose a variable…" /> :
  c.source === 'arg' && argNames.length ?
  <IdSelect label={`${label}: which argument`} value={c.subject} options={argNames} disabled={disabled} onChange={(v) => set({ subject: v })} placeholder="Choose an argument…" /> :

  <input
    className={cn(inputClass, 'font-mono text-[13px]')}
    value={c.subject}
    spellCheck={false}
    disabled={disabled}
    aria-label={`${label}: ${c.source} name`}
    placeholder={c.source === 'result' ? '$.status' : c.source === 'arg' ? 'argument_name' : 'detail'}
    onChange={(e) => set({ subject: e.target.value })} />;


  return (
    <div className="space-y-1.5" data-condition>
      <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_8rem_minmax(0,1fr)]">
        <select className={inputClass} aria-label={`${label}: what to test`} value={c.source} disabled={disabled} onChange={(e) => set({ source: e.target.value as ConditionSource })}>
          {CONDITION_SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {subjectBox}
        <select className={inputClass} aria-label={`${label}: comparison`} value={c.operator} disabled={disabled} onChange={(e) => set({ operator: e.target.value as ConditionOperator })}>
          {CONDITION_OPERATORS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {c.operator === 'in' ?
        <input
          className={inputClass}
          aria-label={`${label}: values, separated by commas`}
          placeholder="a, b, c"
          disabled={disabled}
          value={Array.isArray(c.value) ? c.value.map(valueText).join(', ') : ''}
          onChange={(e) => set({ value: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).map(typedValue) })} /> :
        c.operator === 'gte' || c.operator === 'lte' ?
        <input
          type="number"
          step="any"
          className={inputClass}
          aria-label={`${label}: value`}
          disabled={disabled}
          value={typeof c.value === 'number' ? c.value : ''}
          onChange={(e) => e.target.value.trim() !== '' && Number.isFinite(Number(e.target.value)) && set({ value: Number(e.target.value) })} /> :

        <input className={inputClass} aria-label={`${label}: value`} placeholder="true, a number or text" disabled={disabled} value={valueText(c.value)} onChange={(e) => set({ value: typedValue(e.target.value) })} />
        }
      </div>
      <p className="text-xs text-muted">Reads as: when {describeCondition(writeCondition(c, {}))}. Type null with “is not” for “is set”.</p>
      {!disabled &&
      <button type="button" className={cn(linkButton, 'text-xs')} onClick={() => setAdvanced(true)}>
          Combine conditions (all / any / not)…
        </button>
      }
    </div>);

}
