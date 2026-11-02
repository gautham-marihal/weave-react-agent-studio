import React, { useEffect, useRef, useState } from 'react';
import { PaletteIcon } from 'lucide-react';
import { useTheme, type Theme } from '../../contexts/ThemeContext';
import { Segmented } from '../ui/Segmented';
import { StyleCards } from './StyleCards';
import { AccentPicker } from './AccentPicker';

// The top bar's "Theme" button: the one place for the studio's look, light/dark/system, style and colour.
// Focus starts on the current light/dark choice; Escape or a click outside closes it and returns focus to the button.
export function ThemePopover() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
    const onPointer = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Theme: light or dark, style and colour"
        aria-label="Theme"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <PaletteIcon className="h-[18px] w-[18px]" aria-hidden />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Theme"
          className="absolute right-0 top-10 z-50 flex max-h-[calc(100vh-5rem)] w-[min(92vw,24rem)] flex-col rounded-xl border border-line bg-surface shadow-overlay"
        >
          {/* the light/dark switch stays put; the styles and colours scroll under it when the window is short */}
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <span className="text-sm font-semibold text-ink">Theme</span>
            <Segmented<Theme>
              label="Light or dark"
              size="sm"
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'system', label: 'System' },
              ]}
              value={theme}
              onChange={setTheme}
            />
          </div>
          <div className="space-y-4 overflow-y-auto px-4 py-3">
            <StyleCards compact />
            <AccentPicker />
          </div>
          <p className="border-t border-line px-4 py-2 text-xs text-muted">Kept in this browser.</p>
        </div>
      )}
    </div>
  );
}
