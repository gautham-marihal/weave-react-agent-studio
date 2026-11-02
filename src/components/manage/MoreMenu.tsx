import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontalIcon } from 'lucide-react';
import { cn } from '../../utils/styles';

export type MenuItem =
  | { divider: true }
  | {
      divider?: false;
      label: string;
      onSelect: () => void;
      icon?: React.ElementType;
      disabled?: boolean;
      /** Why it is off (shown as its tooltip), or a short note under it when it is on. */
      hint?: string;
      danger?: boolean;
    };

interface MoreMenuProps {
  /** The button's accessible name, e.g. "More actions for Acme Support". */
  label: string;
  items: MenuItem[];
  className?: string;
  /** Text beside the icon (the agent header says "More"). */
  text?: string;
  size?: 'sm' | 'md';
}

/**
 * A "⋯" menu. Drawn above the page beside its button (so a table that scrolls sideways never clips it). Arrow keys move
 * between items, Escape closes it and gives the keyboard back to the button, and an item that opens a dialog does so
 * after the menu has closed.
 */
export function MoreMenu({ label, items, className, text, size = 'md' }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; right: number; up: boolean } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const up = rect.bottom + 320 > window.innerHeight && rect.top > 320;
    setPlace({ top: up ? rect.top - 6 : rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right), up });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])');
    first?.focus();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close(false);
    };
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, place, close]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    const all = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      all[(at + 1) % all.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      all[(at - 1 + all.length) % all.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      all[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      all[all.length - 1]?.focus();
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          text ? (size === 'sm' ? 'h-8 px-2.5 text-[13px] font-medium text-ink-soft' : 'h-9 px-3 text-sm font-medium text-ink-soft') : 'h-8 w-8',
          open && 'bg-subtle text-ink',
          className
        )}>
        <MoreHorizontalIcon className="h-4 w-4" aria-hidden />
        {text}
      </button>
      {open &&
      place &&
      createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          onClick={(e) => e.stopPropagation()}
          style={{ top: place.top, right: place.right, transform: place.up ? 'translateY(-100%)' : undefined }}
          className="fixed z-[60] w-64 rounded-xl border border-line-strong/50 bg-surface p-1.5 shadow-overlay">
          {items.map((item, i) =>
          item.divider ?
          <div key={`d${i}`} role="separator" className="my-1 h-px bg-line" /> :

          <button
            key={item.label}
            type="button"
            role="menuitem"
            aria-disabled={item.disabled || undefined}
            title={item.disabled ? item.hint : undefined}
            onClick={() => {
              if (item.disabled) return;
              close(true);
              // after the menu has closed and the button has the keyboard back
              window.setTimeout(item.onSelect, 0);
            }}
            className={cn(
              'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors focus-visible:outline-none',
              item.disabled ? 'cursor-not-allowed text-muted/70' : item.danger ? 'text-danger hover:bg-danger-soft focus-visible:bg-danger-soft' : 'text-ink hover:bg-subtle focus-visible:bg-subtle'
            )}>
                {item.icon && <item.icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
                <span className="min-w-0">
                  <span className="block font-medium">{item.label}</span>
                  {item.hint && <span className="block text-[11px] text-muted">{item.hint}</span>}
                </span>
              </button>
          )}
        </div>,
        document.body
      )}
    </>);

}
