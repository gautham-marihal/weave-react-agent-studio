import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { SEARCH_AFTER, filterOptions, normalizeOptions } from './selectOptions.js';
import './smartSelect.css';

// One selector for every list of choices. A short list (8 or fewer) is the browser's own <select>: nothing to learn and it works everywhere.
// A longer list (tools, state variables, agents, versions, languages…) is a combobox: type to narrow it, arrows to move, Enter to pick, Escape
// to close, with a description under each choice and headings for groups. It is built to the WAI-ARIA combobox pattern (role=combobox on the
// input, a listbox of options, aria-activedescendant for the highlighted one), so a screen reader hears the same thing a sighted person sees.
//
//   options: strings, or { value, label?, description?, group?, disabled? }
//   action:  true for a "＋ Add…" control: it picks something and then goes back to showing its placeholder (the value stays empty)

export { SEARCH_AFTER, filterOptions, normalizeOptions };
const MAX_SHOWN = 200;

function Native({ value, options, onChange, placeholder, ariaLabel, id, disabled, invalid, action, className }) {
  const grouped = options.some((o) => o.group);
  const groups = grouped ? [...new Set(options.map((o) => o.group || ''))] : [''];
  const known = options.some((o) => o.value === String(value ?? ''));
  return (
    <select
      id={id}
      className={className}
      value={action ? '' : (value ?? '')}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
    >
      {(action || !known) && <option value="">{placeholder}</option>}
      {!action && !known && value ? <option value={value}>{value}</option> : null}
      {groups.map((group) => {
        const items = options.filter((o) => (grouped ? (o.group || '') === group : true));
        const rendered = items.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
            {o.description ? ` — ${o.description}` : ''}
          </option>
        ));
        return group ? (
          <optgroup key={group} label={group}>
            {rendered}
          </optgroup>
        ) : (
          rendered
        );
      })}
    </select>
  );
}

function Combo({ value, options, onChange, placeholder, ariaLabel, id, disabled, invalid, action, className, emptyText }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const selected = options.find((o) => o.value === String(value ?? ''));
  const matches = useMemo(() => filterOptions(options, query), [options, query]);
  const shown = matches.slice(0, MAX_SHOWN);
  const enabled = shown.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);

  useEffect(() => {
    setActive(
      Math.max(
        0,
        shown.findIndex((o) => !o.disabled),
      ),
    );
  }, [query, open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open) listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const choose = (option) => {
    if (!option || option.disabled) return;
    onChange(option.value);
    close();
  };
  const move = (delta) => {
    if (!open) {
      setOpen(true);
      return;
    }
    if (!enabled.length) return;
    const at = enabled.indexOf(active);
    setActive(enabled[(at + delta + enabled.length) % enabled.length]);
  };
  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Home' && open) {
      event.preventDefault();
      setActive(enabled[0] ?? 0);
    } else if (event.key === 'End' && open) {
      event.preventDefault();
      setActive(enabled[enabled.length - 1] ?? 0);
    } else if (event.key === 'Enter') {
      if (open) {
        event.preventDefault();
        choose(shown[active]);
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        close();
      }
    } else if (event.key === 'Tab') close();
  };

  const shownValue = open ? query : action ? '' : (selected?.label ?? (value ? String(value) : ''));
  let lastGroup = null;
  return (
    <div
      className={`stCombo ${disabled ? 'disabled' : ''}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <input
        ref={inputRef}
        id={id}
        className={`${className} stComboInput`}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={shownValue}
        placeholder={placeholder}
        data-count={options.length}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      <span className="stComboChevron" aria-hidden="true">
        ▾
      </span>
      {open && (
        <ul id={listId} ref={listRef} role="listbox" aria-label={ariaLabel} className="stComboList">
          {shown.map((option, index) => {
            const heading = option.group && option.group !== lastGroup ? option.group : null;
            if (option.group) lastGroup = option.group;
            return (
              <React.Fragment key={option.value}>
                {heading && (
                  <li role="presentation" className="stComboGroup">
                    {heading}
                  </li>
                )}
                <li
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={!action && option.value === String(value ?? '')}
                  aria-disabled={option.disabled || undefined}
                  data-active={index === active}
                  data-value={option.value}
                  className={`stComboOption ${index === active ? 'active' : ''} ${option.disabled ? 'off' : ''}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                  onMouseMove={() => {
                    if (!option.disabled) setActive(index);
                  }}
                >
                  <span>{option.label}</span>
                  {option.description && <small>{option.description}</small>}
                </li>
              </React.Fragment>
            );
          })}
          {shown.length === 0 && (
            <li role="status" className="stComboEmpty">
              {emptyText || `Nothing matches “${query}”.`}
            </li>
          )}
          {matches.length > MAX_SHOWN && (
            <li role="status" className="stComboEmpty">
              {matches.length - MAX_SHOWN} more: keep typing to narrow the list.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function SmartSelect({
  value,
  onChange,
  options,
  placeholder = 'Choose…',
  ariaLabel,
  id,
  disabled = false,
  invalid = false,
  action = false,
  className = 'stFInput',
  searchAfter = SEARCH_AFTER,
  emptyText,
}) {
  const list = useMemo(() => normalizeOptions(options), [options]);
  const common = { value, options: list, onChange, placeholder, ariaLabel, id, disabled, invalid, action, className, emptyText };
  return list.length > searchAfter ? <Combo {...common} /> : <Native {...common} />;
}
