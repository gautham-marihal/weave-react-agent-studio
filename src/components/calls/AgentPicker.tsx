import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, SearchIcon } from 'lucide-react';
import { cn, inputClass } from '../../utils/styles';

// Choose one agent, or all, by typing part of its name or id: a workspace with many agents is not a long menu.
// Keyboard: arrows move, Enter picks, Escape closes.

interface AgentOption {
  id: string;
  name: string;
  /** A count or note beside the name ("2 live"). */
  note?: string;
}

interface AgentPickerProps {
  agents: AgentOption[];
  value: string;
  onChange: (id: string) => void;
  /** The words of the "everyone" choice. */
  allLabel?: string;
  className?: string;
}

export function AgentPicker({ agents, value, onChange, allLabel = 'All agents', className }: AgentPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const options = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = agents.filter((a) => !needle || a.name.toLowerCase().includes(needle) || a.id.toLowerCase().includes(needle));
    return [...(needle ? [] : [{ id: '', name: allLabel }]), ...matched] as AgentOption[];
  }, [agents, query, allLabel]);

  const current = agents.find((a) => a.id === value);
  const shown = value ? (current?.name ?? value) : allLabel;

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.id === value)));
    window.setTimeout(() => inputRef.current?.focus(), 0);
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
    // only when it opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery('');
    buttonRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = options[active];
      if (chosen) pick(chosen.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
      buttonRef.current?.focus();
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Agent: ${shown}`}
        onClick={() => setOpen((o) => !o)}
        className={cn(inputClass, 'flex w-auto min-w-[11rem] max-w-[16rem] items-center justify-between gap-2 py-1.5 text-left')}
      >
        <span className="truncate">{shown}</span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-72 rounded-lg border border-line bg-surface p-1.5 shadow-overlay">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
            <input
              ref={inputRef}
              type="search"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
              aria-label="Find an agent"
              placeholder="Find an agent"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
              className={cn(inputClass, 'py-1.5 pl-8 text-[13px]')}
            />
          </div>
          <ul id={listId} role="listbox" aria-label="Agents" className="mt-1 max-h-64 overflow-y-auto">
            {options.length === 0 && <li className="px-2.5 py-2 text-xs text-muted">No agent matches “{query}”.</li>}
            {options.map((o, i) => (
              <li
                key={o.id || '__all'}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.id === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o.id)}
                onMouseEnter={() => setActive(i)}
                className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]', i === active ? 'bg-subtle text-ink' : 'text-ink-soft')}
              >
                <CheckIcon className={cn('h-3.5 w-3.5 shrink-0 text-accent', o.id !== value && 'invisible')} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                {o.note && <span className="shrink-0 text-xs text-muted">{o.note}</span>}
                {o.id && o.id !== o.name && <span className="max-w-[7rem] shrink-0 truncate font-mono text-[11px] text-muted">{o.id}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
