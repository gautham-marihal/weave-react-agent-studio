import React, { useRef } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { ACCENTS, accentAfterKey, styleLabel } from '../../models/styles';
import { cn } from '../../utils/styles';

// The five colours of the style in use, as round swatches in a radio group: a click or the arrow keys pick one.
// Each style keeps its own colour.
export function AccentPicker() {
  const { style, accent, setAccent } = useTheme();
  const rowRef = useRef<HTMLDivElement>(null);
  const options = ACCENTS[style];
  const current = options.find((o) => o.id === accent) ?? options[0];

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const next = accentAfterKey(style, current.id, event.key);
    if (!next) return;
    event.preventDefault();
    setAccent(next);
    rowRef.current?.querySelector<HTMLButtonElement>(`[data-accent-option="${next}"]`)?.focus();
  };

  return (
    <div data-testid="accent-picker">
      <p className="flex items-baseline gap-2 text-[13px]" data-testid="accent-head">
        <span className="font-medium text-ink">Colour</span>
        <span className="text-muted">{current.label}</span>
      </p>
      <div ref={rowRef} role="radiogroup" aria-label={`Colour of ${styleLabel(style)}`} className="mt-2 flex flex-wrap items-center gap-2.5">
        {options.map((o) => {
          const on = o.id === current.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={o.label}
              title={o.label}
              tabIndex={on ? 0 : -1}
              data-accent-option={o.id}
              onClick={() => setAccent(o.id)}
              onKeyDown={onKeyDown}
              className={cn(
                'h-7 w-7 rounded-full border border-line-strong transition-[box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                on ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : 'hover:scale-105'
              )}
              style={{ background: `linear-gradient(135deg, ${o.swatch[0]} 0 50%, ${o.swatch[1]} 50% 100%)` }}
            />
          );
        })}
      </div>
    </div>
  );
}
