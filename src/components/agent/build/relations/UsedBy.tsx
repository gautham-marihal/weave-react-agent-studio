import { useMemo } from 'react';
import type { AgentConfig, Path } from '../../../../types/studio';
import { usedBy, type Collection } from '../../../../models/relations';

// “Used by”: a button for each place that points at this item (a tool, a fixed line, a remembered value, a connection),
// so a person sees what else changes when this one does, and that nothing uses it.
export function UsedBy({ config, collection, id, onGo, label = 'Used by' }: {config: AgentConfig;collection: Collection;id: string;onGo?: (path: Path) => void;label?: string;}) {
  const uses = useMemo(() => usedBy(config, collection, id), [config, collection, id]);
  if (!id) return null;
  if (!uses.length) return <p data-used-by="none" className="text-xs text-muted">Nothing uses this yet.</p>;
  return (
    <p data-used-by className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
      <span>{label}</span>
      {uses.map((use) =>
      <button
        key={use.place}
        type="button"
        title="Go there"
        onClick={() => onGo?.(use.path)}
        className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-ink-soft hover:border-accent/40 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          {use.place}
        </button>
      )}
    </p>);

}
