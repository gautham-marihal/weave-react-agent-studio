import { useConfigSelect, useForm } from '../form/ctx.js';
import { usedBy } from './usedBy.js';

// "Used by": the places in the agent that point at this tool, line, value or connection, each one a button that goes there. It tells a person what
// else changes if this one does, and shows what nothing uses. (A tool also says "not used by any agent" on its card.)
export default function UsedBy({ collection, id }) {
  const ctx = useForm();
  const uses = useConfigSelect((config) => usedBy(ctx.engine, config, collection, id));
  if (!id) return null;
  if (!uses.length) return <p className="rlUsed none">Nothing uses this yet.</p>;
  return (
    <p className="rlUsed">
      <span>Used by</span>
      {uses.map((use) => <button type="button" key={use.place} className="rlChip" onClick={() => ctx.showPath?.(use.path)} title="Go there">{use.place}</button>)}
    </p>
  );
}
