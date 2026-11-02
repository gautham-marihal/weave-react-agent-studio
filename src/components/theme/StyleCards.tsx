import React from 'react';
import { CheckIcon } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { PREVIEWS, STYLES, type StyleId } from '../../models/styles';
import { cn } from '../../utils/styles';

interface StyleCardsProps {
  // smaller cards for the top bar's Theme pop-over
  compact?: boolean;
  onPicked?: (style: StyleId) => void;
}

// The design styles as cards, each drawn in the current light or dark mode. Picking one restyles the whole studio.
export function StyleCards({ compact = false, onPicked }: StyleCardsProps) {
  const { style, setStyle, resolvedTheme } = useTheme();
  return (
    <div
      role="group"
      aria-label="Design style"
      data-testid="style-cards"
      className={cn('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}
    >
      {STYLES.map((option) => {
        const on = style === option.id;
        const p = PREVIEWS[option.id][resolvedTheme];
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={on}
            data-style-preview={option.id}
            title={option.description}
            onClick={() => {
              setStyle(option.id);
              onPicked?.(option.id);
            }}
            className={cn(
              'group relative flex flex-col gap-2 rounded-lg border bg-surface p-2 text-left transition-[border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              on ? 'border-accent shadow-sm ring-1 ring-accent' : 'border-line hover:border-line-strong'
            )}
          >
            {/* a small drawing of the style: its page, a menu strip, a card with two lines and a button */}
            <span
              aria-hidden
              className={cn('flex w-full overflow-hidden rounded-md border', compact ? 'h-10' : 'h-16')}
              style={{ background: p.page, borderColor: p.line }}
            >
              <span className="w-1/5 border-r" style={{ background: p.panel, borderColor: p.line }} />
              <span className="flex flex-1 items-center p-1.5">
                <span className="flex h-full w-full flex-col justify-center gap-1 rounded-sm border px-1.5" style={{ background: p.panel, borderColor: p.line }}>
                  <span className="h-1 w-3/5 rounded-full" style={{ background: p.text }} />
                  <span className="h-1 w-2/5 rounded-full opacity-60" style={{ background: p.text }} />
                  {!compact && <span className="mt-0.5 h-2 w-1/4 rounded-sm" style={{ background: p.primary }} />}
                </span>
              </span>
            </span>
            <span className="flex items-center justify-between gap-2 px-0.5">
              <span className="text-[13px] font-semibold text-ink" style={{ fontFamily: option.displayFont }}>
                {option.label}
              </span>
              {on && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />}
            </span>
            {!compact && <span className="px-0.5 text-xs leading-snug text-muted">{option.description}</span>}
          </button>
        );
      })}
    </div>
  );
}
