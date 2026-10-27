import React, { useState } from 'react';
import { isObj } from './engine.js';
import { FreeValue, Select, StringList } from './fields.jsx';
import InlineCreate from './InlineCreate.jsx';
import { useConfigSelect, useForm } from './ctx.js';
import { argNamesOf } from './templates.ts';
import Icon from '../../ui/Icon.jsx';
import ChoiceBox from '../../ui/Select.tsx';

// A simple condition ("the caller is verified", "the argument is at least 3") as one readable row instead of a choice
// of nine object kinds. All / any / not, channels and business hours fall back to the full editor.

const SOURCES = [
  ['state', 'State variable'],
  ['arg', 'Tool argument'],
  ['result', 'Tool result'],
  ['event', 'Event detail'],
];
const OPERATORS = [
  ['equals', 'is'],
  ['not_equals', 'is not'],
  ['gte', 'is at least'],
  ['lte', 'is at most'],
  ['in', 'is one of'],
];
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

// The box keeps what is typed (empty, or a minus on its way to -3) but the condition only ever gets a number; leaving
// the box with a non-number puts the number back.
function NumberValue({ value, onChange, disabled }) {
  const shown = typeof value === 'number' ? String(value) : '';
  const [text, setText] = useState(shown);
  const [was, setWas] = useState(value);
  if (value !== was) {
    setWas(value);
    if (Number(text) !== value || text.trim() === '') setText(shown);
  }
  return (
    <input
      className="stFInput"
      type="number"
      step="any"
      value={text}
      disabled={disabled}
      aria-label="Value"
      onChange={(event) => {
        setText(event.target.value);
        const n = Number(event.target.value);
        if (event.target.value.trim() !== '' && Number.isFinite(n)) onChange(n);
      }}
      onBlur={() => setText(shown)}
    />
  );
}

export default function ConditionBuilder({ value, onChange, path, disabled, fallback }) {
  const ctx = useForm();
  const [creating, setCreating] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const empty = !isObj(value) || Object.keys(value).length === 0;
  // a hook, so it comes before any early return
  const toolIndex = path[0] === 'tools' && typeof path[1] === 'number' ? path[1] : null;
  const argNames = useConfigSelect((c) => (toolIndex !== null ? argNamesOf(c?.tools?.[toolIndex]) : []));
  if (advanced || (!empty && !isSimpleCondition(value))) {
    return (
      <div className="stCondition advanced">
        {advanced && (
          <button type="button" className="stLink" onClick={() => setAdvanced(false)}>
            Back to the simple condition
          </button>
        )}
        {fallback}
      </div>
    );
  }

  const obj = empty ? { state: '' } : value;
  const source = SOURCE_KEYS.find((key) => key in obj) || 'state';
  const operator = OPERATOR_KEYS.find((key) => key in obj) || 'equals';
  const subject = obj[source] ?? '';
  const operand = obj[operator];
  const stateVars = ctx.refOptions.state_vars || [];

  // the compared value is kept as is, null included: "is not
  // null" means "is set", and an empty text there would flip it
  const kept = operand === undefined ? '' : operand;
  const setSource = (nextSource) => onChange({ [nextSource]: '', [operator]: kept });
  const setSubject = (v) => onChange({ [source]: v, [operator]: kept });
  // "at least" and "at most" compare numbers: a number stays, numeric text becomes one, anything else starts at 0
  // (shown in the box, never a hidden "")
  const asNumber = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0);
  const setOperator = (nextOperator) => {
    const single = Array.isArray(operand) ? (operand[0] ?? '') : kept;
    onChange({
      [source]: subject,
      [nextOperator]:
        nextOperator === 'in' ? (Array.isArray(operand) ? operand : []) : nextOperator === 'gte' || nextOperator === 'lte' ? asNumber(single) : single,
    });
  };
  const setOperand = (v) => onChange({ [source]: subject, [operator]: v });

  const subjectControl = () => {
    if (source === 'state') {
      return (
        <>
          <Select value={subject} options={stateVars} onChange={setSubject} disabled={disabled} placeholder="Choose a variable…" />
          {!disabled && (
            <button type="button" className="stLink" onClick={() => setCreating((v) => !v)}>
              <Icon name="plus" size={14} /> New
            </button>
          )}
        </>
      );
    }
    if (source === 'arg' && toolIndex !== null && argNames.length)
      return <Select value={subject} options={argNames} onChange={setSubject} disabled={disabled} placeholder="Choose an argument…" />;
    return (
      <input
        className="stFInput mono"
        type="text"
        spellCheck={false}
        value={subject}
        disabled={disabled}
        aria-label={`${source} name`}
        placeholder={source === 'result' ? '$.status' : source === 'arg' ? 'argument_name' : 'detail'}
        onChange={(event) => setSubject(event.target.value)}
      />
    );
  };

  return (
    <div className="stCondition" data-condition>
      <div className="stCondRow">
        <ChoiceBox className="stFInput small" value={source} disabled={disabled} aria-label="What to test" onChange={(event) => setSource(event.target.value)}>
          {SOURCES.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </ChoiceBox>
        <div className="stCondSubject">{subjectControl()}</div>
        <ChoiceBox
          className="stFInput small"
          value={operator}
          disabled={disabled}
          aria-label="Comparison"
          onChange={(event) => setOperator(event.target.value)}
        >
          {OPERATORS.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </ChoiceBox>
        <div className="stCondValue">
          {operator === 'in' ? (
            <StringList values={Array.isArray(operand) ? operand : []} onChange={setOperand} disabled={disabled} placeholder="a value" addLabel="Add a value" />
          ) : operator === 'gte' || operator === 'lte' ? (
            <NumberValue value={operand} onChange={setOperand} disabled={disabled} />
          ) : (
            <FreeValue value={operand} onChange={setOperand} disabled={disabled} aria-label="Value" />
          )}
        </div>
      </div>
      {creating && source === 'state' && <InlineCreate collection="state_vars" target={[...path, 'state']} onClose={() => setCreating(false)} />}
      <button type="button" className="stLink stCondAdv" onClick={() => setAdvanced(true)}>
        Combine conditions (all / any / not)…
      </button>
    </div>
  );
}
