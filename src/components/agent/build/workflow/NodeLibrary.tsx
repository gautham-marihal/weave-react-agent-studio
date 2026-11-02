import React, { useMemo, useState } from 'react';
import { BookOpenIcon, ChevronDownIcon, PanelLeftIcon, SearchIcon } from 'lucide-react';
import { PRESETS, type PresetCategory, type PresetId } from '../../../../models/workflow';
import { PRESET_ICON } from './look';
import { cn } from '../../../../utils/styles';

/** The type a library item is dragged as (its preset id is the payload). */
export const DRAG_TYPE = 'application/x-weave-block';

const CATEGORIES: { id: PresetCategory; text: string }[] = [
  { id: 'Triggers', text: 'Where a conversation starts' },
  { id: 'Agents', text: 'Who talks to the person' },
  { id: 'Logic', text: 'Routing and hand-offs' },
  { id: 'Tools', text: 'What an agent can call' },
  { id: 'Actions', text: 'Ways a conversation ends or moves on' },
];
const TONE: Record<PresetCategory, string> = {
  Triggers: 'bg-info-soft text-info',
  Agents: 'bg-accent-soft text-accent',
  Logic: 'bg-accent-soft text-accent',
  Tools: 'bg-subtle text-ink-soft',
  Actions: 'bg-warning-soft text-warning',
};

interface NodeLibraryProps {
  disabled: boolean;
  onAdd: (preset: PresetId) => void;
  onClose: () => void;
  onOpenKnowledge: () => void;
  className?: string;
}

/** The blocks that can be added: drag one onto the canvas (onto an agent to connect it), or press it to add it in view. */
export function NodeLibrary({ disabled, onAdd, onClose, onOpenKnowledge, className }: NodeLibraryProps) {
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Set<PresetCategory>>(new Set());
  const q = query.trim().toLowerCase();
  const found = useMemo(() => PRESETS.filter((p) => !q || `${p.label} ${p.text} ${p.category}`.toLowerCase().includes(q)), [q]);

  return (
    <aside aria-label="Blocks you can add" className={cn('flex min-h-0 flex-col bg-surface', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h3 className="text-[13px] font-semibold text-ink">Blocks</h3>
        <button type="button" onClick={onClose} className="rounded p-1 text-muted hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" aria-label="Hide the blocks panel">
          <PanelLeftIcon className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="border-b border-line p-2">
        <label className="relative block">
          <span className="sr-only">Search blocks</span>
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search blocks"
            className="h-8 w-full rounded-md border border-line-strong bg-surface pl-8 pr-2 text-[13px] text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        {disabled && <p className="mb-2 rounded-md bg-subtle px-2.5 py-2 text-xs text-muted">You can look, but your role can’t change this agent.</p>}
        {CATEGORIES.map((cat) => {
          const items = found.filter((p) => p.category === cat.id);
          if (!items.length) return null;
          const open = q !== '' || !closed.has(cat.id);
          return (
            <section key={cat.id} className="mb-1">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setClosed((s) => {
                  const next = new Set(s);
                  if (next.has(cat.id)) next.delete(cat.id);else next.add(cat.id);
                  return next;
                })}
                className="flex w-full items-center justify-between rounded px-1.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <span>
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted">{cat.id}</span>
                  <span className="block text-[11px] text-muted/80">{cat.text}</span>
                </span>
                <ChevronDownIcon className={cn('h-3.5 w-3.5 text-muted transition-transform', !open && '-rotate-90')} aria-hidden />
              </button>
              {open &&
              <ul className="mt-0.5 space-y-1">
                  {items.map((p) => {
                  const Icon = PRESET_ICON[p.id];
                  return (
                    <li key={p.id}>
                        <button
                        type="button"
                        draggable={!disabled}
                        disabled={disabled}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(DRAG_TYPE, p.id);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => onAdd(p.id)}
                        title={`${p.text} Drag onto the canvas, or press to add it.`}
                        className="flex w-full cursor-grab items-start gap-2.5 rounded-md border border-line bg-surface px-2.5 py-2 text-left transition-[border-color,background-color] duration-150 hover:border-accent/40 hover:bg-accent-soft/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-60">
                          <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded', TONE[p.category])}>
                            <Icon className="h-3.5 w-3.5" aria-hidden />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13px] font-medium text-ink">{p.label}</span>
                            <span className="block text-xs leading-snug text-muted">{p.text}</span>
                          </span>
                        </button>
                      </li>);

                })}
                </ul>
              }
            </section>);

        })}
        {(!q || 'knowledge base documents'.includes(q)) &&
        <section className="mt-2 border-t border-line pt-2">
            <p className="px-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Knowledge</p>
            <button
            type="button"
            onClick={onOpenKnowledge}
            className="mt-1 flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-success-soft text-success">
                <BookOpenIcon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">Knowledge bases</span>
                <span className="block text-xs leading-snug text-muted">Added on the Knowledge page, where their documents are uploaded. They appear here once added.</span>
              </span>
            </button>
          </section>
        }
        {found.length === 0 && q && <p className="px-2 py-6 text-center text-xs text-muted">No block matches “{query}”.</p>}
      </div>
      <p className="border-t border-line px-3 py-2 text-[11px] leading-snug text-muted">Drop a tool on an agent to connect it. Connect blocks by dragging from the dot on the right of one to another.</p>
    </aside>);

}
