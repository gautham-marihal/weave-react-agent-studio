import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { filterOptions, groupOptions } from './pickerOptions.js';
import Icon from '../../ui/Icon.jsx';
import { trapTab } from '../../ui/useDialogFocus.js';

// "Add…" as a choice of jobs rather than a drop-down of kinds: each choice is a card with a sentence on what it is for,
// grouped, with a search box when there are many, in a window over the page (so the page, or the panel the Add is in,
// stays where it was). It picks one and closes. A choice the runtime can't run yet says so on its card.
// Keyboard: Tab or the arrow keys move between cards, Enter picks, Escape closes and puts focus back on the button.
//   label: shorter words on the button where the heading beside it already says what is added ("Add a check"); its name stays the whole of it
//   intro: the line under the window's title
export default function AddPicker({ what, label, intro, options, disabled, onPick, className = '' }) {
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
    // the search takes the keyboard; with no search, the window itself (a ring on the first card would look as if it
    // were already chosen), and the arrow keys go on to the cards
    const box = panelRef.current;
    const target = searchable ? box?.querySelector('input[type=search]') : box;
    target?.focus({ preventScroll: true });
  }, [open, searchable]);

  const close = (refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) window.requestAnimationFrame(() => buttonRef.current?.focus());
  };
  const choose = (option) => {
    onPick(option, option.make());
    close(false);
    // what was added may take the keyboard itself (its card opens on its first box); when nothing does, it comes back
    // to the button, never to the page
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        const at = document.activeElement;
        if ((!at || at === document.body) && buttonRef.current?.isConnected) buttonRef.current.focus({ preventScroll: true });
      }),
    );
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
    if (at === -1 && (event.target.matches?.('input[type=search]') || event.target === panelRef.current) && event.key === 'ArrowDown' && cards[0]) {
      event.preventDefault();
      cards[0].focus();
      return;
    }
    if (at === -1) return;
    event.preventDefault();
    const next = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? Math.min(cards.length - 1, at + 1) : Math.max(0, at - 1);
    cards[next]?.focus();
  };

  const search = searchable && (
    <input
      className="stFInput small"
      type="search"
      value={query}
      placeholder="Search what it does"
      aria-label={`Search the choices for ${what}`}
      onChange={(event) => setQuery(event.target.value)}
    />
  );
  const nothing = shown.length === 0 && (
    <p className="stFEmpty" role="status">
      Nothing matches “{query}”.{' '}
      <button type="button" className="stLink" onClick={() => setQuery('')}>
        Show all {options.length}
      </button>
    </p>
  );

  return (
    <div className={`stPicker ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        className="stAddBtn"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label={label ? `Add ${what}` : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name="plus" size={14} /> {label || `Add ${what}`}
      </button>
      {open && (
        <PickDialog id={panelId} boxRef={panelRef} title={`Add ${what}`} intro={intro} onClose={() => close()} onKeys={move}>
          {search && (
            <div className="stPickSearch">
              <Icon name="search" size={16} />
              {search}
            </div>
          )}
          <div className="stPickBody">
            {groups.map((group) => (
              <section key={group.name} className="stPickGroup" aria-label={group.name}>
                <h3>{group.name}</h3>
                <ul>
                  {group.options.map((option) => (
                    <li key={option.id}>
                      <button
                        type="button"
                        className={`stPickCard withIcon ${option.unavailable ? 'unavailable' : ''}`}
                        data-option={option.id}
                        onClick={() => choose(option)}
                      >
                        <span className="stPickIcon" aria-hidden="true">
                          <Icon name={option.icon || 'plus'} size={18} />
                        </span>
                        <span className="stPickText">
                          <strong>{option.label}</strong>
                          {option.help && <span>{option.help}</span>}
                          {option.badge && <em className="stPickBadge">{option.badge}</em>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {nothing}
          </div>
        </PickDialog>
      )}
    </div>
  );
}

// The choices in a window over the page (and over a side panel, when the Add is in one): a title that says what is added, the search, and the cards,
// which scroll on their own under them. Escape, the close button and a click outside close it; the keys stay inside it, and none reach the panel
// behind it (so Escape closes the window, not the panel too).
function PickDialog({ id, boxRef, title, intro, onClose, onKeys, children }) {
  const titleId = useId();
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  return createPortal(
    <div
      className="createOverlay stPickOverlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        id={id}
        ref={boxRef}
        className="createModal stPickDialog"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          onKeys(event);
          if (event.key === 'Tab') trapTab(event, boxRef.current);
          event.stopPropagation();
        }}
      >
        <header className="stPickHead">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p>{intro || 'Pick one. Its details come next.'}</p>
          </div>
          <button type="button" className="modalClose" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}
