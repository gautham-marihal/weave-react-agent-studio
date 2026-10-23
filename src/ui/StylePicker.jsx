import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { ACCENTS, STYLES, useAccent, useStyle } from '../studio/usePref.js';

// The design styles as cards, each with a small picture of how it looks in the mode in use (light or dark). Picking one changes the whole site at once.
export function StyleCards({ onPicked }) {
  const [style, setStyle] = useStyle();
  return (
    <div className="stylePicker" role="group" aria-label="Design style">
      {STYLES.map((option) => (
        <button
          key={option.id}
          type="button"
          className="styleCard"
          data-style-preview={option.id}
          aria-pressed={style === option.id}
          title={option.description}
          onClick={() => {
            setStyle(option.id);
            onPicked?.(option.id);
          }}
        >
          <span className="styleSwatch" aria-hidden="true">
            <i />
            <span>
              <b />
              <b />
              <em />
            </span>
          </span>
          <strong>{option.label}</strong>
          <small>{option.description}</small>
        </button>
      ))}
      <ColourOptions style={style} />
    </div>
  );
}

// The five colours of the style in use, as round swatches (a radio group: arrow keys move between them).
function ColourOptions({ style }) {
  const [accent, setAccent] = useAccent(style);
  const options = ACCENTS[style] || ACCENTS.simple;
  const current = options.find((o) => o.id === accent) || options[0];
  const label = STYLES.find((s) => s.id === style)?.label || style;
  const move = (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const i = options.findIndex((o) => o.id === accent);
    const next = options[(i + step + options.length) % options.length];
    setAccent(next.id);
    event.currentTarget.parentElement?.querySelector(`[data-accent-option="${next.id}"]`)?.focus();
  };
  return (
    <div className="accentPicker">
      <div className="accentHead">
        <strong>Colour</strong>
        <span>{current.label}</span>
      </div>
      <div className="accentRow" data-style-row={style} role="radiogroup" aria-label={`Colour of ${label}`}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={o.id === current.id}
            tabIndex={o.id === current.id ? 0 : -1}
            aria-label={o.label}
            title={o.label}
            data-accent-option={o.id}
            className="accentDot"
            style={{ '--a': o.swatch[0], '--b': o.swatch[1] || o.swatch[0] }}
            onClick={() => setAccent(o.id)}
            onKeyDown={move}
          />
        ))}
      </div>
    </div>
  );
}

// The "Theme" button of the top bar, the one place for how the studio looks: light or dark, the design style and its colour, in one small panel.
export function StyleMenu({ theme, onToggleTheme }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const buttonRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const key = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="styleMenu" ref={ref}>
      <button
        type="button"
        ref={buttonRef}
        className="quietButton"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Change how the studio looks"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="sparkle" size={15} /> Theme
      </button>
      {open && (
        <section className="styleMenuPanel" role="dialog" aria-label="Theme">
          <header>
            <strong>Theme</strong>
            <div className="styleMenuModes" role="group" aria-label="Light or dark">
              {['light', 'dark'].map((mode) => (
                <button key={mode} type="button" aria-pressed={theme === mode} onClick={() => mode !== theme && onToggleTheme()}>
                  {mode === 'light' ? 'Light' : 'Dark'}
                </button>
              ))}
            </div>
          </header>
          {/* the light/dark switch stays put; the styles and colours scroll under it when the window is short */}
          <div className="styleMenuScroll">
            <StyleCards />
          </div>
        </section>
      )}
    </div>
  );
}
