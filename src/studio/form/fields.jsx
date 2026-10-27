import React, { useEffect, useId, useRef, useState } from 'react';
import SmartSelect from '../SmartSelect.jsx';
import { prettyJson } from '../format.js';
import { parseJsonStrict } from '../jsonDuplicates.js';
import Icon from '../../ui/Icon.jsx';

// The form's basic inputs: text, numbers (and a range), a switch, a choice from a list, a list of texts, several
// choices, raw JSON, and a free value that may be text or JSON. Each takes `value` and calls `onChange(next)`.

export function TextInput({ value, onChange, placeholder, disabled, multiline, invalid, id, mono }) {
  const common = {
    id,
    value: value ?? '',
    disabled,
    placeholder,
    spellCheck: false,
    'aria-invalid': invalid || undefined,
    onChange: (event) => onChange(event.target.value),
  };
  if (multiline) {
    const rows = Math.min(14, Math.max(3, String(value ?? '').split('\n').length + 1));
    return <textarea className={`stFInput ${mono ? 'mono' : ''}`} rows={rows} {...common} />;
  }
  return <input className={`stFInput ${mono ? 'mono' : ''}`} type="text" {...common} />;
}

// Keeps what you type ("1.", "-") while the stored value is a number.
export function NumberInput({ value, onChange, min, max, integer, nullable, disabled, invalid, id, placeholder }) {
  const toText = (v) => (v === null || v === undefined ? '' : String(v));
  const [text, setText] = useState(toText(value));
  useEffect(() => {
    const incoming = toText(value);
    setText((current) => (Number(current) === Number(incoming) && (current === '') === (incoming === '') ? current : incoming));
  }, [value]);
  return (
    <input
      id={id}
      className="stFInput"
      type="number"
      inputMode={integer ? 'numeric' : 'decimal'}
      step={integer ? 1 : 'any'}
      min={min}
      max={max}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      value={text}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        // Clearing the box never deletes the field (the × button does that): a nullable number becomes null,
        // any other keeps its last value until a new number is typed, and is shown again on blur.
        if (raw.trim() === '') {
          if (nullable) onChange(null);
          return;
        }
        const n = Number(raw);
        if (!Number.isNaN(n)) onChange(n);
      }}
      onBlur={() => setText(toText(value))}
    />
  );
}

// A number with both ends known: a slider beside the box. The slider is a second way to change the same number, so it
// is out of the tab order (screen readers announce the box).
export function RangeNumber({ value, onChange, min, max, integer, disabled, invalid, id, placeholder, nullable }) {
  const step = integer ? 1 : Math.max((max - min) / 100, 0.01);
  const shown = typeof value === 'number' ? value : min;
  return (
    <div className={`stFRange ${typeof value === 'number' ? '' : 'unset'}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => onChange(integer ? Math.round(Number(event.target.value)) : Math.round(Number(event.target.value) * 100) / 100)}
      />
      <NumberInput
        id={id}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        integer={integer}
        nullable={nullable}
        disabled={disabled}
        invalid={invalid}
        placeholder={placeholder}
      />
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label, id }) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      className={`stSwitch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <i aria-hidden="true" />
      <span>{checked ? 'On' : 'Off'}</span>
    </button>
  );
}

// A choice from a list: the browser's own select for a few, a searchable list for many (see SmartSelect). A value that
// is no longer in the list is still shown, marked "(not found)", so it is never silently changed.
export function Select({ value, options, onChange, disabled, placeholder, invalid, id, labels }) {
  const known = options.includes(value);
  const list = [
    ...(!known && value !== '' && value !== undefined ? [{ value, label: `${String(value)} (not found)` }] : []),
    ...options.map((option) => ({ value: option, label: labels?.[option] || option })),
  ];
  return (
    <SmartSelect id={id} value={value ?? ''} options={list} onChange={onChange} placeholder={placeholder || 'Choose…'} disabled={disabled} invalid={invalid} />
  );
}

// A list of plain strings, one row each.
export function StringList({ values, onChange, placeholder, disabled, addLabel = 'Add' }) {
  const list = Array.isArray(values) ? values : [];
  return (
    <div className="stFList">
      {list.map((item, index) => (
        <div className="stFListRow" key={index}>
          <input
            className="stFInput"
            type="text"
            spellCheck={false}
            value={item}
            placeholder={placeholder}
            disabled={disabled}
            aria-label={`Item ${index + 1}`}
            onChange={(event) => onChange(list.map((v, i) => (i === index ? event.target.value : v)))}
          />
          <button
            type="button"
            className="stIconBtn danger"
            title="Delete this item"
            aria-label={`Delete item ${index + 1}`}
            disabled={disabled}
            onClick={() =>
              onChange(
                list.filter((_, i) => i !== index),
                { deleted: `item ${index + 1}` },
              )
            }
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="stAddBtn" disabled={disabled} onClick={() => onChange([...list, ''])}>
        <Icon name="plus" size={14} /> {addLabel}
      </button>
    </div>
  );
}

// Pick several of a known set (ids of other things, or an enum). Order is the order of picking.
export function MultiPick({ options, values, onChange, disabled, emptyText }) {
  const list = Array.isArray(values) ? values : [];
  const left = options.filter((option) => !list.includes(option));
  return (
    <div className="stFPick">
      <div className="stFChips">
        {list.length === 0 && <span className="stFNone">{emptyText}</span>}
        {list.map((item) => (
          <span key={item} className={`stFChip ${options.includes(item) ? '' : 'bad'}`}>
            {item}
            {!options.includes(item) && ' (not found)'}
            <button
              type="button"
              title="Delete"
              aria-label={`Delete ${item}`}
              disabled={disabled}
              onClick={() =>
                onChange(
                  list.filter((v) => v !== item),
                  { deleted: item },
                )
              }
            >
              <Icon name="close" size={14} />
            </button>
          </span>
        ))}
      </div>
      {left.length > 0 && (
        <SmartSelect
          action
          className="stFInput small"
          ariaLabel="Add"
          placeholder="Add…"
          disabled={disabled}
          options={left.map((option) => ({ value: option, label: option }))}
          onChange={(chosen) => {
            if (chosen) onChange([...list, chosen]);
          }}
        />
      )}
    </div>
  );
}

// Ticks for a set of choices. A value the choices lack (from the JSON view or an older schema) stays shown, ticked and
// marked "(not found)" like the drop-downs; unticking it is the way to remove it.
export function CheckGroup({ options, values, onChange, disabled, labels }) {
  const list = Array.isArray(values) ? values : [];
  const unknown = list.filter((v) => !options.includes(v));
  const id = useId();
  return (
    <div className="stFChecks" role="group">
      {[...options, ...unknown].map((option, i) => (
        <label key={`${i}:${String(option)}`} htmlFor={`${id}-${i}`} className={list.includes(option) ? 'on' : ''}>
          <input
            id={`${id}-${i}`}
            type="checkbox"
            disabled={disabled}
            checked={list.includes(option)}
            onChange={(event) =>
              onChange(event.target.checked ? [...options.filter((o) => list.includes(o) || o === option), ...unknown] : list.filter((v) => v !== option))
            }
          />
          {labels?.[option] || String(option)}
          {!options.includes(option) && ' (not found)'}
        </label>
      ))}
    </div>
  );
}

// Raw JSON for values the schema leaves open. Commits only when the text parses.
// (null is shown as null, a value of its own, not as an empty {})
export function JsonInput({ value, onChange, disabled, id }) {
  const [text, setText] = useState(() => prettyJson(value === undefined ? {} : value));
  const [error, setError] = useState('');
  const lastCommitted = useRef(value);
  useEffect(() => {
    if (JSON.stringify(value) !== JSON.stringify(lastCommitted.current)) {
      lastCommitted.current = value;
      setText(prettyJson(value === undefined ? {} : value));
      setError('');
    }
  }, [value]);
  return (
    <div className="stFJson">
      <textarea
        id={id}
        className="stFInput mono"
        rows={Math.min(14, Math.max(3, text.split('\n').length + 1))}
        spellCheck={false}
        value={text}
        disabled={disabled}
        aria-invalid={!!error || undefined}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          try {
            const parsed = parseJsonStrict(raw);
            lastCommitted.current = parsed;
            setError('');
            onChange(parsed);
          } catch (e) {
            setError(e.message);
          }
        }}
        onBlur={() => {
          if (!error) setText(prettyJson(lastCommitted.current === undefined ? {} : lastCommitted.current));
        }}
      />
      {error && <small className="stFErr">Not valid JSON yet, so this isn’t applied: {error}</small>}
    </div>
  );
}

// Any JSON value typed as text: plain text stays a string; true, 12, null, [..] and {..} read as JSON. Quoted text
// ("1", "true") stays a string and shows quoted, so keypad digits never become numbers.
const READS_AS_JSON = /^(true|false|null|-?\d+(\.\d+)?)$/;
const readsAsSomethingElse = (text) => {
  const t = text.trim();
  if (READS_AS_JSON.test(t)) return true;
  if (!/^[[{]/.test(t) && !/^".*"$/.test(t)) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
};
// What read() returns for JSON with a repeated key: a symbol key no
// typed JSON can have (a plain { repeated } could be a real value).
const REPEATED = Symbol('repeated');

export function FreeValue({ value, onChange, disabled, id, 'aria-label': ariaLabel }) {
  const show = (v) => (v === undefined ? '' : typeof v === 'string' ? (readsAsSomethingElse(v) ? JSON.stringify(v) : v) : JSON.stringify(v));
  const [text, setText] = useState(show(value));
  const [problem, setProblem] = useState('');
  const lastSent = useRef(value);
  useEffect(() => {
    if (JSON.stringify(value) !== JSON.stringify(lastSent.current)) {
      lastSent.current = value;
      setText(show(value));
    }
  }, [value]);
  const read = (raw) => {
    const t = raw.trim();
    if (READS_AS_JSON.test(t) || /^[[{]/.test(t) || /^".*"$/.test(t)) {
      try {
        return parseJsonStrict(t);
      } catch (e) {
        return /appears twice/.test(e.message) ? { [REPEATED]: e.message } : raw;
      }
    }
    return raw;
  };
  return (
    <>
      <input
        id={id}
        className="stFInput"
        type="text"
        spellCheck={false}
        disabled={disabled}
        value={text}
        aria-label={ariaLabel}
        aria-invalid={!!problem || undefined}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          const v = read(raw);
          // A repeated key is not applied (it would silently lose a value); the text stays as typed until it is fixed.
          if (v && typeof v === 'object' && REPEATED in v) {
            setProblem(v[REPEATED]);
            return;
          }
          setProblem('');
          lastSent.current = v;
          onChange(v);
        }}
      />
      {problem && <small className="stFErr">Not applied: {problem}</small>}
    </>
  );
}
