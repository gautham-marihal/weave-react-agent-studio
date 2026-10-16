import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { filterOptions, groupOptions } from './pickerOptions.js';

// "Add…" as a choice of jobs rather than a drop-down of kinds: each choice is a card with a sentence on what it is for, grouped, with a search
// box when there are many. It opens in place (no dialog), picks one, and closes. A choice the runtime can't run yet says so on its card.
// Keyboard: Tab or the arrow keys move between cards, Enter picks, Escape closes and puts focus back on the button.
export default function AddPicker({ what, options, disabled, onPick, className = '' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const panelId = useId();
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const searchable = options.length > 6;
  const shown = useMemo(() => filterOptions(options, query), [options, query]);
  const groups = useMemo(() => groupOptions(shown), [shown]);

  useEffect(() => {
    if (!open) return;
    const target = panelRef.current?.querySelector(searchable ? 'input[type=search]' : '.stPickCard');
    target?.focus();
  }, [open, searchable]);

  const close = (refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) window.requestAnimationFrame(() => buttonRef.current?.focus());
  };
  const choose = (option) => {
    onPick(option, option.make());
    close(false);
  };
  const move = (event) => {
    const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'];
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!keys.includes(event.key)) return;
    const cards = [...(panelRef.current?.querySelectorAll('.stPickCard') || [])];
    const at = cards.indexOf(document.activeElement);
    if (at === -1 && event.target.matches?.('input[type=search]') && event.key === 'ArrowDown' && cards[0]) {
      event.preventDefault();
      cards[0].focus();
      return;
    }
    if (at === -1) return;
    event.preventDefault();
    const next = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? Math.min(cards.length - 1, at + 1) : Math.max(0, at - 1);
    cards[next]?.focus();
  };

  return (
    <div className={`stPicker ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        className="stAddBtn"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        ＋ Add {what}
      </button>
      {open && (
        <section id={panelId} ref={panelRef} className="stPickPanel" aria-label={`Add ${what}`} onKeyDown={move}>
          <header>
            {searchable && (
              <input
                className="stFInput small"
                type="search"
                value={query}
                placeholder="Search what it does"
                aria-label={`Search the choices for ${what}`}
                onChange={(event) => setQuery(event.target.value)}
              />
            )}
            <button type="button" className="stLink" onClick={() => close()}>
              Cancel
            </button>
          </header>
          {groups.map((group) => (
            <div key={group.name} className="stPickGroup" role="group" aria-label={group.name}>
              <h6>{group.name}</h6>
              <ul>
                {group.options.map((option) => (
                  <li key={option.id}>
                    <button
                      type="button"
                      className={`stPickCard ${option.unavailable ? 'unavailable' : ''}`}
                      data-option={option.id}
                      onClick={() => choose(option)}
                    >
                      <strong>{option.label}</strong>
                      {option.help && <span>{option.help}</span>}
                      {option.badge && <em className="stPickBadge">{option.badge}</em>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {shown.length === 0 && (
            <p className="stFEmpty" role="status">
              Nothing matches “{query}”.{' '}
              <button type="button" className="stLink" onClick={() => setQuery('')}>
                Show all {options.length}
              </button>
            </p>
          )}
        </section>
      )}
    </div>
  );
}
