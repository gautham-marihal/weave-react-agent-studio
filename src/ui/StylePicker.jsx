import React from 'react';
import Icon from './Icon.jsx';
import { Popover } from 'radix-ui';
import { keepEscape } from './layer.ts';
import Tip from './Tip.tsx';
import { Choice, OneOf } from './OneOf.tsx';
import { ACCENTS, STYLES, useAccent, useStyle } from '../studio/usePref.js';

// The design styles as cards, each previewed in the current mode (light or dark). Picking one restyles the whole site.
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

// The top bar's "Theme" button, the one place for the studio's look: light/dark, style and colour in a Radix pop-over.
// Focus starts on the current light/dark choice; Escape or an outside click closes it and returns focus to the button.
export function StyleMenu({ theme, onToggleTheme }) {
  return (
    <div className="styleMenu">
      <Popover.Root>
        <Tip label="Change how the studio looks" hoverOnly>
          <Popover.Trigger asChild>
            <button type="button" className="quietButton">
              <Icon name="sparkle" size={15} /> Theme
            </button>
          </Popover.Trigger>
        </Tip>
        <Popover.Portal>
          <Popover.Content
            className="styleMenuPanel rxLayer"
            aria-label="Theme"
            align="end"
            sideOffset={8}
            collisionPadding={12}
            onEscapeKeyDown={keepEscape}
            onOpenAutoFocus={(event) => {
              const pressed = event.currentTarget instanceof HTMLElement ? event.currentTarget.querySelector('.styleMenuModes [aria-checked="true"]') : null;
              if (pressed) {
                event.preventDefault();
                pressed.focus({ preventScroll: true });
              }
            }}
          >
            <header>
              <strong>Theme</strong>
              <OneOf className="styleMenuModes" label="Light or dark" value={theme} onChange={(mode) => mode !== theme && onToggleTheme()}>
                {['light', 'dark'].map((mode) => (
                  <Choice key={mode} value={mode}>
                    {mode === 'light' ? 'Light' : 'Dark'}
                  </Choice>
                ))}
              </OneOf>
            </header>
            {/* the light/dark switch stays put; the styles and colours scroll under it when the window is short */}
            <div className="styleMenuScroll">
              <StyleCards />
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
