import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import Icon from '../../../ui/Icon.jsx';
import { useDropPlace } from '../../../ui/dropPlace.js';

// A searchable list that opens under a button: pick one (it closes) or several (it stays open, each choice ticked).
// The search box takes focus on open; arrows move, Enter picks, Escape closes and returns focus to the button.
// It opens below or above the button, whichever has more room, no taller than that room (ui/dropPlace.js).
//   options: [{ value, label, hint?, badge? }]; selected: the values ticked
//   query, onQuery(text): set when the caller narrows the list itself
const MENU_MAX = 336; // px, as .pkMenu's max-height in pickers.css

export default function PickerPopover({
  options,
  selected = [],
  onPick,
  multi = false,
  label,
  placeholder = 'Search',
  emptyText = 'Nothing matches',
  trigger,
  className = '',
  query: controlled,
  onQuery,
}) {
  const [open, setOpen] = useState(false);
  const [own, setOwn] = useState('');
  const query = controlled !== undefined ? controlled : own;
  const setQuery = (text) => {
    if (onQuery) onQuery(text);
    else setOwn(text);
  };
  const [active, setActive] = useState(0);
  const root = useRef(null);
  const button = useRef(null);
  const input = useRef(null);
  const menu = useRef(null);
  const listId = useId();
  const chosen = useMemo(() => new Set(selected), [selected]);
  const shown = options;
  // the menu's full height (search box plus the whole list), capped at its max-height in pickers.css
  const place = useDropPlace(button, menu, open, (box) => {
    const list = box.querySelector('.pkList');
    return Math.min(MENU_MAX, box.offsetHeight - (list?.clientHeight || 0) + (list?.scrollHeight || 0));
  });

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (root.current && !root.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  useEffect(() => {
    if (open) {
      input.current?.focus({ preventScroll: true });
      root.current?.scrollIntoView({ block: 'nearest' });
    } else setQuery('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setActive(0);
  }, [query]);
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  const close = () => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  };
  const pick = (option) => {
    onPick(option.value, option);
    if (!multi) close();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (shown[active]) pick(shown[active]);
    }
  };

  return (
    <div className={`pkPop ${className}`} ref={root}>
      <button type="button" className="pkTrigger" ref={button} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {/* accessible name like "Main language: English (United Kingdom)": the label, then the visible choice */}
        <span className="srOnly">{label}: </span>
        {trigger}
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div
          className={`pkMenu ${place.up ? 'up' : ''}`}
          ref={menu}
          role="presentation"
          style={place.room != null ? { '--dropRoom': `${place.room}px` } : undefined}
          onKeyDown={onKey}
        >
          <input
            ref={input}
            className="pkSearch"
            type="search"
            value={query}
            placeholder={placeholder}
            aria-label={`${label}: search`}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul className="pkList" id={listId} role="listbox" aria-label={label} aria-multiselectable={multi || undefined}>
            {shown.length === 0 && (
              <li className="pkNone" role="presentation">
                {emptyText}
              </li>
            )}
            {shown.map((option, index) => (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={chosen.has(option.value)}
                className={`${index === active ? 'active' : ''} ${chosen.has(option.value) ? 'on' : ''}`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(option)}
              >
                {option.badge && (
                  <span className="pkBadge" aria-hidden="true">
                    {option.badge}
                  </span>
                )}
                <span className="pkOptText">
                  <strong>{option.label}</strong>
                  {option.hint ? <small>{option.hint}</small> : null}
                </span>
                {chosen.has(option.value) && <Icon name="check" size={16} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
