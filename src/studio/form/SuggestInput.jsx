import React, { useId, useMemo, useState } from 'react';
import '../smartSelect.css';
import Icon from '../../ui/Icon.jsx';
import { Input } from '../../ui/Input.tsx';

// A text box with suggestions: pick one or type anything; unlike SmartSelect, what is typed is saved.
// A WAI-ARIA combobox like SmartSelect (listbox, aria-activedescendant), with the same keys: arrows, Enter, Escape.
//   options: { value, label?, description? }[]; all shown until something is typed, then only the matches
export default function SuggestInput({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  id,
  disabled = false,
  invalid = false,
  footer = 'Or type any other value.',
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(-1);
  const text = value == null ? '' : String(value);
  const shown = useMemo(() => {
    const needle = text.trim().toLowerCase();
    if (!typed || !needle) return options;
    return options.filter((o) => `${o.value} ${o.label || ''} ${o.description || ''}`.toLowerCase().includes(needle));
  }, [options, text, typed]);

  const close = () => {
    setOpen(false);
    setTyped(false);
    setActive(-1);
  };
  const choose = (option) => {
    if (!option) return;
    onChange(option.value);
    close();
  };
  const move = (delta) => {
    if (!open) {
      setOpen(true);
      return;
    }
    if (!shown.length) return;
    setActive((at) => (at + delta + shown.length) % shown.length);
  };
  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      if (open && active >= 0 && shown[active]) {
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

  return (
    <div
      className={`stCombo ${disabled ? 'disabled' : ''}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <Input
        id={id}
        className="stComboInput"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={text}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          onChange(event.target.value);
          setTyped(true);
          setOpen(true);
          setActive(-1);
        }}
      />
      <button
        type="button"
        className="stComboChevron"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Show the choices"
        onMouseDown={(event) => {
          event.preventDefault();
          setTyped(false);
          setOpen((was) => !was);
        }}
      >
        <Icon name="chevronDown" size={15} />
      </button>
      {open && (
        <ul id={listId} role="listbox" aria-label={ariaLabel} className="stComboList">
          {shown.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.value === text}
              data-active={index === active}
              data-value={option.value}
              className={`stComboOption ${index === active ? 'active' : ''}`}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(option);
              }}
              onMouseMove={() => setActive(index)}
            >
              <span>{option.label || option.value}</span>
              {option.description && <small>{option.description}</small>}
            </li>
          ))}
          {shown.length === 0 && (
            <li role="status" className="stComboEmpty">
              Nothing in the list matches “{text}”. It is saved as typed.
            </li>
          )}
          {footer && shown.length > 0 && (
            <li role="presentation" className="stComboEmpty">
              {footer}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
