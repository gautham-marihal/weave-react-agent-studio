import React, { useState } from 'react';
import { isObj } from './engine.js';
import { FreeValue, Select, StringList } from './fields.jsx';
import InlineCreate from './InlineCreate.jsx';
import { useConfigSelect, useForm } from './ctx.js';
import { argNamesOf } from './templates.js';

// A condition ("when the caller is verified", "when the argument is at least 3") as one readable row instead of a
// choice between nine kinds of object. Combining conditions (all / any / not), channels and business hours still use the
// full editor, which this falls back to; it only takes over for the plain "this thing is / isn't / at least … that" case.

const SOURCES = [['state', 'State variable'], ['arg', 'Tool argument'], ['result', 'Tool result'], ['event', 'Event detail']];
const OPERATORS = [['equals', 'is'], ['not_equals', 'is not'], ['gte', 'is at least'], ['lte', 'is at most'], ['in', 'is one of']];
const SOURCE_KEYS = SOURCES.map(([key]) => key);
const OPERATOR_KEYS = OPERATORS.map(([key]) => key);

// Exactly one thing being tested and one comparison (or nothing chosen yet: a fresh condition).
export function isSimpleCondition(value) {
  if (!isObj(value)) return false;
  const keys = Object.keys(value);
  const sources = keys.filter((key) => SOURCE_KEYS.includes(key));
  const operators = keys.filter((key) => OPERATOR_KEYS.includes(key));
  return sources.length === 1 && operators.length <= 1 && keys.length === sources.length + operators.length;
}

export default function ConditionBuilder({ value, onChange, path, disabled, fallback }) {
  const ctx = useForm();
  const [creating, setCreating] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const empty = !isObj(value) || Object.keys(value).length === 0;
  if (advanced || (!empty && !isSimpleCondition(value))) {
    return (
      <div className="stCondition advanced">
        {advanced && <button type="button" className="stLink" onClick={() => setAdvanced(false)}>Back to the simple condition</button>}
        {fallback}
      </div>
    );
  }

  const obj = empty ? { state: '' } : value;
  const source = SOURCE_KEYS.find((key) => key in obj) || 'state';
  const operator = OPERATOR_KEYS.find((key) => key in obj) || 'equals';
  const subject = obj[source] ?? '';
  const operand = obj[operator];
  const toolIndex = path[0] === 'tools' && typeof path[1] === 'number' ? path[1] : null;
  const argNames = useConfigSelect((c) => (toolIndex !== null ? argNamesOf(c?.tools?.[toolIndex]) : []));
  const stateVars = ctx.refOptions.state_vars || [];

  const write = (next) => onChange(next);
  const setSource = (nextSource) => write({ [nextSource]: '', [operator]: operand ?? '' });
  const setSubject = (v) => write({ [source]: v, [operator]: operand ?? '' });
  const setOperator = (nextOperator) => write({ [source]: subject, [nextOperator]: nextOperator === 'in' ? (Array.isArray(operand) ? operand : []) : (Array.isArray(operand) ? operand[0] ?? '' : operand ?? '') });
  const setOperand = (v) => write({ [source]: subject, [operator]: v });

  const subjectControl = () => {
    if (source === 'state') {
      return (
        <>
          <Select value={subject} options={stateVars} onChange={setSubject} disabled={disabled} placeholder="Choose a variable…" />
          {!disabled && <button type="button" className="stLink" onClick={() => setCreating((v) => !v)}>＋ New</button>}
        </>
      );
    }
    if (source === 'arg' && toolIndex !== null && argNames.length) return <Select value={subject} options={argNames} onChange={setSubject} disabled={disabled} placeholder="Choose an argument…" />;
    return <input className="stFInput mono" type="text" spellCheck={false} value={subject} disabled={disabled} aria-label={`${source} name`} placeholder={source === 'result' ? '$.status' : source === 'arg' ? 'argument_name' : 'detail'} onChange={(event) => setSubject(event.target.value)} />;
  };

  return (
    <div className="stCondition" data-condition>
      <div className="stCondRow">
        <select className="stFInput small" value={source} disabled={disabled} aria-label="What to test" onChange={(event) => setSource(event.target.value)}>
          {SOURCES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <div className="stCondSubject">{subjectControl()}</div>
        <select className="stFInput small" value={operator} disabled={disabled} aria-label="Comparison" onChange={(event) => setOperator(event.target.value)}>
          {OPERATORS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <div className="stCondValue">
          {operator === 'in'
            ? <StringList values={Array.isArray(operand) ? operand : []} onChange={setOperand} disabled={disabled} placeholder="a value" addLabel="Add a value" />
            : operator === 'gte' || operator === 'lte'
              ? <input className="stFInput" type="number" step="any" value={typeof operand === 'number' ? operand : ''} disabled={disabled} aria-label="Value" onChange={(event) => setOperand(event.target.value === '' ? '' : Number(event.target.value))} />
              : <FreeValue value={operand ?? ''} onChange={setOperand} disabled={disabled} />}
        </div>
      </div>
      {creating && source === 'state' && <InlineCreate collection="state_vars" target={[...path, 'state']} onClose={() => setCreating(false)} />}
      <button type="button" className="stLink stCondAdv" onClick={() => setAdvanced(true)}>Combine conditions (all / any / not)…</button>
    </div>
  );
}
