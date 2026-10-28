import React, { useEffect, useState } from 'react';
import Icon from '../../../ui/Icon.jsx';
import SmartSelect from '../../SmartSelect.jsx';
import { Input } from '../../../ui/Input.tsx';

// Adding a key to a map and renaming one in place.

export function AddKey({ existing, onAdd, pattern, options, disabled, label = 'entry' }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const taken = new Set(existing);
  const commit = (raw) => {
    const key = raw.trim();
    if (!key) return;
    if (taken.has(key)) {
      setError(`“${key}” already exists.`);
      return;
    }
    if (pattern && !new RegExp(pattern).test(key)) {
      setError(`Use the form ${pattern}`);
      return;
    }
    setError('');
    setText('');
    onAdd(key);
  };
  if (options) {
    const left = options.filter((o) => !taken.has(o));
    return (
      <SmartSelect
        action
        className="stFInput small"
        disabled={disabled || left.length === 0}
        ariaLabel={`Add ${label}`}
        placeholder={left.length ? `Add ${label}…` : `No more ${label}s to add`}
        options={left}
        onChange={(o) => {
          if (o) onAdd(o);
        }}
      />
    );
  }
  return (
    <div className="stFAddKey">
      <Input
        size="small"
        type="text"
        spellCheck={false}
        value={text}
        disabled={disabled}
        placeholder={`New ${label} name`}
        aria-label={`New ${label} name`}
        onChange={(event) => {
          setText(event.target.value);
          setError('');
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(text);
          }
        }}
      />
      <button type="button" className="stAddBtn" disabled={disabled || !text.trim()} onClick={() => commit(text)}>
        <Icon name="plus" size={14} /> Add
      </button>
      {error && <small className="stFErr">{error}</small>}
    </div>
  );
}

// A key that is renamed when you leave the box, so typing doesn't re-key the object on every letter.
export function KeyInput({ value, taken, pattern, onRename, disabled }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState('');
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const key = text.trim();
    if (key === value) {
      setError('');
      return;
    }
    if (!key) {
      setText(value);
      return;
    }
    if (taken.includes(key)) {
      setError(`“${key}” already exists.`);
      return;
    }
    if (pattern && !new RegExp(pattern).test(key)) {
      setError(`Use the form ${pattern}`);
      return;
    }
    setError('');
    onRename(key);
  };
  return (
    <div className="stFKeyBox">
      <Input
        mono
        type="text"
        spellCheck={false}
        value={text}
        disabled={disabled}
        aria-label={value ? `Name of “${value}”` : 'Name'}
        aria-invalid={!!error || undefined}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.target.blur();
          }
        }}
      />
      {error && <small className="stFErr">{error}</small>}
    </div>
  );
}
