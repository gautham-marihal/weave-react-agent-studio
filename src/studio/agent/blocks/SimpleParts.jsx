import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../ui/Icon.jsx';
import { Switch } from '../../form/fields.jsx';

// Small parts shared by the plain-words blocks (Guardrails, After the call), in the setup's look (setup.css).

// A card with an icon, title, line and an optional switch; its children go underneath.
//   on: true | false | null (null: not set, the server decides — said under the line)
//   pending: a line for what the server says it doesn't do yet (shown in the warning tone)
export function Card({ icon, title, text, on, onToggle, unset = '', pending = '', children, label }) {
  return (
    <section className={`suAction ${on ? 'on' : ''}`} aria-label={label || title}>
      <div className="suActionHead">
        <span className="suChoiceIcon" aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
        <span className="suChoiceText">
          <strong>{title}</strong>
          <small>{text}</small>
          {on === null && unset && <small className="smUnset">{unset}</small>}
          {pending && (
            <small className="smPending" role="note">
              {pending}
            </small>
          )}
        </span>
        {onToggle && <Switch checked={on === true} onChange={() => onToggle(on !== true)} label={title} />}
      </div>
      {children && <div className="suActionMore">{children}</div>}
    </section>
  );
}

// Words in a row, each with its own ×, and a box to add one (Enter adds it).
export function Chips({ label, items, onChange, placeholder, help }) {
  const [typed, setTyped] = useState('');
  const add = () => {
    const word = typed.trim();
    if (!word) return;
    if (!items.some((i) => i.toLowerCase() === word.toLowerCase())) onChange([...items, word]);
    setTyped('');
  };
  return (
    <div className="suField smChips">
      <span>{label}</span>
      {help && <small>{help}</small>}
      {items.length > 0 && (
        <ul className="smChipList" aria-label={label}>
          {items.map((item) => (
            <li key={item}>
              <span>{item}</span>
              <button type="button" aria-label={`Remove “${item}”`} onClick={() => onChange(items.filter((i) => i !== item))}>
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="suInline">
        <input
          className="stFInput"
          value={typed}
          placeholder={placeholder}
          aria-label={`Add to “${label}”`}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="quietButton" onClick={add} disabled={!typed.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}

// A number box that keeps partial input ("0.", empty) while typing and hands on a number, or '' when emptied. It
// follows the draft again when not being typed in.
export function NumberBox({ value, onChange, className = 'stFInput smNumber', ...rest }) {
  const shown = value === null || value === undefined ? '' : String(value);
  const [text, setText] = useState(shown);
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) setText(shown);
  }, [shown]);
  return (
    <input
      {...rest}
      className={className}
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={() => {
        typing.current = true;
      }}
      onBlur={() => {
        typing.current = false;
        setText(shown);
      }}
      onChange={(event) => {
        const next = event.target.value;
        if (!/^\d*\.?\d*$/.test(next)) return; // digits and one point only
        setText(next);
        if (next === '') onChange('');
        else if (Number(next) > 0) onChange(next);
      }}
    />
  );
}

// Comma-separated words ("Happy, Neutral, Unhappy"), kept as typed while focused, handed on as a list on each change.
export function ListBox({ values, onChange, ...rest }) {
  const shown = values.join(', ');
  const [text, setText] = useState(shown);
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) setText(shown);
  }, [shown]);
  return (
    <input
      {...rest}
      value={text}
      onFocus={() => {
        typing.current = true;
      }}
      onBlur={() => {
        typing.current = false;
        setText(shown);
      }}
      onChange={(event) => {
        setText(event.target.value);
        onChange(event.target.value.split(','));
      }}
    />
  );
}

// A line the agent says; when the config points at a fixed message instead, the box names it and typing replaces it.
export function SayField({ label, help, value, refId, onChange, placeholder }) {
  return (
    <label className="suField">
      <span>{label}</span>
      {help && <small>{help}</small>}
      <input
        className="stFInput"
        value={value}
        placeholder={refId ? `Says its fixed line “${refId}”` : placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
