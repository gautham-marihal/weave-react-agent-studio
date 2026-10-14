import React, { useEffect, useId, useRef, useState } from 'react';
import { prettyJson } from '../format.js';
import { parseJsonStrict } from '../jsonDuplicates.js';

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
export function NumberInput({ value, onChange, min, max, integer, nullable, disabled, invalid, id }) {
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
      value={text}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        // Clearing the box never deletes the field (the × button does that): a nullable number becomes null,
        // any other keeps its last value until a new number is typed, and is shown again on blur.
        if (raw.trim() === '') { if (nullable) onChange(null); return; }
        const n = Number(raw);
        if (!Number.isNaN(n)) onChange(n);
      }}
      onBlur={() => setText(toText(value))}
    />
  );
}

export function Switch({ checked, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} aria-label={label} disabled={disabled} className={`stSwitch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <i aria-hidden="true" />
      <span>{checked ? 'On' : 'Off'}</span>
    </button>
  );
}

export function Select({ value, options, onChange, disabled, placeholder, invalid, id, labels }) {
  const known = options.includes(value);
  return (
    <select id={id} className="stFInput" value={value ?? ''} disabled={disabled} aria-invalid={invalid || undefined} onChange={(event) => onChange(event.target.value)}>
      {(!known || value === '' || value === undefined) && <option value="">{placeholder || 'Choose…'}</option>}
      {!known && value !== '' && value !== undefined && <option value={value}>{String(value)} (not found)</option>}
      {options.map((option) => <option key={option} value={option}>{labels?.[option] || option}</option>)}
    </select>
  );
}

// A list of plain strings, one row each.
export function StringList({ values, onChange, placeholder, disabled, addLabel = 'Add' }) {
  const list = Array.isArray(values) ? values : [];
  return (
    <div className="stFList">
      {list.map((item, index) => (
        <div className="stFListRow" key={index}>
          <input className="stFInput" type="text" spellCheck={false} value={item} placeholder={placeholder} disabled={disabled} aria-label={`Item ${index + 1}`}
            onChange={(event) => onChange(list.map((v, i) => (i === index ? event.target.value : v)))} />
          <button type="button" className="stIconBtn danger" title="Delete this item" aria-label={`Delete item ${index + 1}`} disabled={disabled} onClick={() => onChange(list.filter((_, i) => i !== index), { deleted: `item ${index + 1}` })}>×</button>
        </div>
      ))}
      <button type="button" className="stAddBtn" disabled={disabled} onClick={() => onChange([...list, ''])}>＋ {addLabel}</button>
    </div>
  );
}

// Pick several of a known set (ids of other things, or an enum). Order is the order of picking.
export function MultiPick({ options, values, onChange, disabled, emptyText, labels }) {
  const list = Array.isArray(values) ? values : [];
  const left = options.filter((option) => !list.includes(option));
  return (
    <div className="stFPick">
      <div className="stFChips">
        {list.length === 0 && <span className="stFNone">{emptyText || 'None selected'}</span>}
        {list.map((item) => (
          <span key={item} className={`stFChip ${options.includes(item) ? '' : 'bad'}`}>
            {labels?.[item] || item}{!options.includes(item) && ' (not found)'}
            <button type="button" title="Delete" aria-label={`Delete ${item}`} disabled={disabled} onClick={() => onChange(list.filter((v) => v !== item), { deleted: item })}>×</button>
          </span>
        ))}
      </div>
      {left.length > 0 && (
        <select className="stFInput small" value="" disabled={disabled} aria-label="Add" onChange={(event) => { if (event.target.value) onChange([...list, event.target.value]); }}>
          <option value="">＋ Add…</option>
          {left.map((option) => <option key={option} value={option}>{labels?.[option] || option}</option>)}
        </select>
      )}
    </div>
  );
}

export function CheckGroup({ options, values, onChange, disabled }) {
  const list = Array.isArray(values) ? values : [];
  const id = useId();
  return (
    <div className="stFChecks" role="group">
      {options.map((option) => (
        <label key={option} htmlFor={`${id}-${option}`} className={list.includes(option) ? 'on' : ''}>
          <input id={`${id}-${option}`} type="checkbox" disabled={disabled} checked={list.includes(option)}
            onChange={(event) => onChange(event.target.checked ? options.filter((o) => list.includes(o) || o === option) : list.filter((v) => v !== option))} />
          {option}
        </label>
      ))}
    </div>
  );
}

// Raw JSON for values the schema leaves open. Commits only when the text parses.
export function JsonInput({ value, onChange, disabled, id }) {
  const [text, setText] = useState(() => prettyJson(value ?? {}));
  const [error, setError] = useState('');
  const lastCommitted = useRef(value);
  useEffect(() => {
    if (JSON.stringify(value) !== JSON.stringify(lastCommitted.current)) { lastCommitted.current = value; setText(prettyJson(value ?? {})); setError(''); }
  }, [value]);
  return (
    <div className="stFJson">
      <textarea id={id} className="stFInput mono" rows={Math.min(14, Math.max(3, text.split('\n').length + 1))} spellCheck={false} value={text} disabled={disabled} aria-invalid={!!error || undefined}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          try { const parsed = parseJsonStrict(raw); lastCommitted.current = parsed; setError(''); onChange(parsed); } catch (e) { setError(e.message); }
        }}
        onBlur={() => { if (!error) setText(prettyJson(lastCommitted.current ?? {})); }} />
      {error && <small className="stFErr">Not valid JSON yet, so this isn’t applied: {error}</small>}
    </div>
  );
}

// A value that may be any JSON scalar or structure, typed as text: plain text stays a string; true, 12,
// null, [..] and {..} are read as JSON.
export function FreeValue({ value, onChange, disabled, id }) {
  const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  const [text, setText] = useState(show(value));
  const [problem, setProblem] = useState('');
  const lastSent = useRef(value);
  useEffect(() => {
    if (JSON.stringify(value) !== JSON.stringify(lastSent.current)) { lastSent.current = value; setText(show(value)); }
  }, [value]);
  const read = (raw) => {
    const t = raw.trim();
    if (/^(true|false|null|-?\d+(\.\d+)?)$/.test(t) || /^[[{]/.test(t)) {
      try { return parseJsonStrict(t); } catch (e) { return /appears twice/.test(e.message) ? { repeated: e.message } : raw; }
    }
    return raw;
  };
  return (
    <>
      <input id={id} className="stFInput" type="text" spellCheck={false} disabled={disabled} value={text} aria-invalid={!!problem || undefined}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          const v = read(raw);
          // A repeated key is not applied (it would silently lose a value); the text stays as typed until it is fixed.
          if (v && typeof v === 'object' && 'repeated' in v && Object.keys(v).length === 1) { setProblem(v.repeated); return; }
          setProblem('');
          lastSent.current = v;
          onChange(v);
        }} />
      {problem && <small className="stFErr">Not applied: {problem}</small>}
    </>
  );
}
