import React from 'react';
import { useConfigSelect, useForm } from '../form/ctx.js';
import { usedBy } from './usedBy.js';

// "Used by": a button to each place in the agent that points at this item, so a person sees what else changes if
// this one does, and what nothing uses.
export default function UsedBy({ collection, id }) {
  const ctx = useForm();
  const uses = useConfigSelect((config) => usedBy(ctx.engine, config, collection, id));
  if (!id) return null;
  if (!uses.length) return <p className="rlUsed none">Nothing uses this yet.</p>;
  return (
    <p className="rlUsed">
      <span>Used by</span>
      {uses.map((use) => (
        <button type="button" key={use.place} className="rlChip" onClick={() => ctx.showPath?.(use.path)} title="Go there">
          {use.place}
        </button>
      ))}
    </p>
  );
}
