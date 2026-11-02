import React, { useState } from 'react';
import { SearchIcon } from 'lucide-react';
import type { AgentConfig } from '../../../../types/studio';
import { TOOL_CARDS, existingFor, type ToolCard } from '../../../../models/tools';
import { Dialog } from '../../../ui/Dialog';
import { StatusChip } from '../../../ui/StatusChip';
import { cn, inputClass } from '../../../../utils/styles';

interface AddToolDialogProps {
  open: boolean;
  config: AgentConfig;
  onClose: () => void;
  onPick: (card: ToolCard) => void;
}

/** "Add a tool": cards named by the job they do, in groups; ones the runtime can't run yet say so. */
export function AddToolDialog({ open, config, onClose, onPick }: AddToolDialogProps) {
  const [query, setQuery] = useState('');
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = TOOL_CARDS.filter((c) => words.every((w) => `${c.label} ${c.help} ${c.group}`.toLowerCase().includes(w)));
  const groups = shown.reduce<{ name: string; cards: ToolCard[] }[]>((acc, card) => {
    const group = acc.find((g) => g.name === card.group);
    if (group) group.cards.push(card);
    else acc.push({ name: card.group, cards: [card] });
    return acc;
  }, []);

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Add a tool" description="Pick what it should be able to do. Its details come next.">
      <label className="relative mb-4 block">
        <span className="sr-only">Find a kind of tool</span>
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <input className={cn(inputClass, 'pl-9')} placeholder="Find: hand over, look up, form…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {groups.length === 0 && <p className="text-[13px] text-muted">Nothing matches “{query}”.</p>}
      <div className="space-y-5">
        {groups.map((g) =>
        <section key={g.name} aria-label={g.name}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{g.name}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {g.cards.map((card) => {
              const has = existingFor(config, card) >= 0;
              return (
                <button
                  key={card.id}
                  type="button"
                  data-card={card.id}
                  onClick={() => onPick(card)}
                  className="rounded-lg border border-line px-3 py-2.5 text-left transition-[border-color,background-color] duration-150 hover:border-accent hover:bg-accent-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                      {card.label}
                      {card.unavailable && <StatusChip tone="warning">Not available yet</StatusChip>}
                      {has && <StatusChip>Already added</StatusChip>}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {card.help}
                      {has ? ' It has one already: this opens it.' : ''}
                    </span>
                  </button>);

            })}
            </div>
          </section>
        )}
      </div>
    </Dialog>);

}
