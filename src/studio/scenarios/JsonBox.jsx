import React, { useEffect, useId, useRef, useState } from 'react';
import { parseObject, parseValue, showValue } from './model.js';
import { TextArea } from '../../ui/Input.tsx';

// The scenario editor's typed-value boxes: a JSON object/value box and a state value box.
// A box for a JSON object or value: keeps what is typed, passes up only what parses, and says what is wrong if not.
export function JsonBox({ value, onChange, label, rows = 3, placeholder, objectOnly = true, className = '', onValid = null }) {
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)));
  const [error, setError] = useState('');
  const boxId = useId();
  const mine = useRef(JSON.stringify(value));
  // tell the form when this box doesn't parse, so Save can say so instead of silently keeping the old value
  useEffect(() => {
    onValid?.(boxId, !error);
    return () => onValid?.(boxId, true);
  }, [error, boxId, onValid]);
  useEffect(() => {
    // the value changed from somewhere else (another mock, a reset): show it, unless it is what was just typed
    if (JSON.stringify(value) !== mine.current) {
      mine.current = JSON.stringify(value);
      setText(value === undefined ? '' : JSON.stringify(value, null, 2));
      setError('');
    }
  }, [value]);
  const change = (next) => {
    setText(next);
    if (!next.trim()) {
      setError('');
      mine.current = JSON.stringify(undefined);
      onChange(undefined);
      return;
    }
    if (objectOnly) {
      const parsed = parseObject(next);
      if (parsed.error) {
        setError(parsed.error);
        return;
      }
      setError('');
      mine.current = JSON.stringify(parsed.value);
      onChange(parsed.value);
    } else {
      try {
        const parsed = JSON.parse(next);
        setError('');
        mine.current = JSON.stringify(parsed);
        onChange(parsed);
      } catch (e) {
        setError(`Not valid JSON (${e.message}).`);
      }
    }
  };
  return (
    <span className="scField">
      <TextArea
        size="small"
        mono
        className={`${className}`}
        rows={rows}
        value={text}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={!!error || undefined}
        spellCheck={false}
        onChange={(event) => change(event.target.value)}
      />
      {error && <small className="stFErr">{error}</small>}
    </span>
  );
}

// A state value box that keeps the typed text ("not paid") and passes up what it means (true, 3, "not paid"). Only
// overwritten when the value changes from somewhere else.
export function ValueBox({ value, onChange, ...rest }) {
  const shown = (v) => (v === undefined ? '' : showValue(v));
  const [text, setText] = useState(() => shown(value));
  const mine = useRef(JSON.stringify(value));
  useEffect(() => {
    if (JSON.stringify(value) !== mine.current) {
      mine.current = JSON.stringify(value);
      setText(shown(value));
    }
  }, [value]);
  return (
    <input
      {...rest}
      type="text"
      value={text}
      onChange={(event) => {
        const parsed = parseValue(event.target.value);
        setText(event.target.value);
        mine.current = JSON.stringify(parsed);
        onChange(parsed);
      }}
    />
  );
}
