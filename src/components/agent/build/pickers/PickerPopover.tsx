import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import type { PickOption } from '../../../../models/pickers';
import { cn } from '../../../../utils/styles';

interface PickerPopoverProps {
  options: PickOption[];
  selected?: string[];
  onPick: (value: string) => void;
  /** Several can be picked: the list stays open, each choice ticked. */
  multi?: boolean;
  /** What the button chooses: its accessible name is "label: what is chosen". */
  label: string;
  placeholder?: string;
  emptyText?: string;
  trigger: React.ReactNode;
  query: string;
  onQuery: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * A searchable list that opens under a button: pick one (it closes) or several (it stays open). The search box takes
 * the keyboard on open; arrows move, Enter picks, Escape closes and gives the keyboard back to the button.
 */
export function PickerPopover({ options, selected = [], onPick, multi = false, label, placeholder = 'Search', emptyText = 'Nothing matches', trigger, query, onQuery, disabled, className }: PickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const chosen = useMemo(() => new Set(selected), [selected]);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  useEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
    else onQuery('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId, open]);

  const close = () => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  };
  const pick = (option: PickOption) => {
    onPick(option.value);
    if (!multi) close();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (options[active]) pick(options[active]);
    }
  };

  return (
    <div ref={root} className={cn('relative', className)} data-picker-open={open ? 'true' : undefined}>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 rounded-md border border-line-strong bg-surface px-3 py-2 text-left text-sm text-ink transition-[border-color,box-shadow] duration-150 hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted">
        <span className="sr-only">{label}: </span>
        <span className="min-w-0 flex-1">{trigger}</span>
        <ChevronDownIcon className={cn('h-4 w-4 shrink-0 text-muted transition-transform duration-150', open && 'rotate-180')} aria-hidden />
      </button>
      {open &&
      <div role="presentation" onKeyDown={onKey} className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-lg border border-line bg-surface shadow-overlay">
          <div className="border-b border-line p-2">
            <input
            ref={input}
            type="search"
            value={query}
            placeholder={placeholder}
            aria-label={`${label}: search`}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
            onChange={(e) => onQuery(e.target.value)}
            className="w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <ul id={listId} role="listbox" aria-label={label} aria-multiselectable={multi || undefined} className="max-h-72 overflow-y-auto py-1">
            {options.length === 0 &&
          <li role="presentation" className="px-3 py-2 text-[13px] text-muted">
                {emptyText}
              </li>
          }
            {options.map((option, index) =>
          <li
            key={option.value}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={chosen.has(option.value)}
            onMouseEnter={() => setActive(index)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(option)}
            className={cn('flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm', index === active ? 'bg-subtle' : '', chosen.has(option.value) && 'text-accent')}>
                <span className="inline-flex h-5 min-w-[1.75rem] items-center justify-center rounded bg-subtle px-1 font-mono text-[10px] font-semibold text-ink-soft" aria-hidden>
                  {option.badge}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate font-medium text-ink">{option.label}</strong>
                </span>
                <small className="font-mono text-[11px] text-muted">{option.hint}</small>
                {chosen.has(option.value) && <CheckIcon className="h-4 w-4 shrink-0 text-accent" aria-hidden />}
              </li>
          )}
          </ul>
        </div>
      }
    </div>);

}
