import { useMemo, useRef } from 'react';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import { buildToolGrid, setToolOffered } from '../../../../models/relations';
import { toast } from '../../../ui/Toast';
import { cn } from '../../../../utils/styles';

// Who can use which tool, as a grid (models/relations.ts). A tick gives the tool to that agent (agents.items[].tools)
// through the draft editor, so Undo takes it back. Closed until asked for; not drawn for one agent or one tool.
export function ToolGrid({ editor }: {editor: DraftEditor;}) {
  const config = editor.config;
  // The editor as it is now, for an Undo pressed on the toast after later renders.
  const latest = useRef(editor);
  latest.current = editor;
  const grid = useMemo(() => config ? buildToolGrid(config) : null, [config]);
  if (!config || !grid || grid.agents.length < 2 || grid.rows.length < 2) return null;
  const toggle = (agentId: string, agentName: string, toolId: string, toolName: string, on: boolean) => {
    const next = setToolOffered(config, agentId, toolId, on);
    if (next === config) return;
    editor.replaceConfig(next);
    toast.success(`${on ? 'Gave' : 'Took'} “${toolName}” ${on ? 'to' : 'from'} ${agentName}.`, { action: { label: 'Undo', onClick: () => latest.current.undo() } });
  };
  return (
    <details data-tool-grid className="mb-8 rounded-lg border border-line bg-surface shadow-panel">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-ink">
        Who can use which tool
        <span className="ml-2 text-[13px] font-normal text-muted">
          {grid.agents.length} agents · {grid.rows.length} tools{grid.unused.length ? ` · ${grid.unused.length} nobody has` : ''}
        </span>
      </summary>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full border-collapse text-[13px]">
          <caption className="sr-only">A tick means the agent can use the tool.</caption>
          <thead>
            <tr className="bg-canvas">
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">Tool</th>
              {grid.agents.map((a) =>
              <th key={a.id} scope="col" title={a.id} className="px-3 py-2 text-center font-medium text-ink-soft">
                  <span className="block max-w-[9rem] truncate">{a.name}</span>
                  <small className="font-normal text-muted">{a.count} tool{a.count === 1 ? '' : 's'}</small>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) =>
            <tr key={row.id} className={cn('border-t border-line', row.agents.length === 0 && 'bg-warning-soft/40')}>
                <th scope="row" title={row.description || undefined} className="px-3 py-2 text-left font-normal">
                  <span className="text-ink">{row.name}</span>
                  {row.agents.length === 0 && <small className="ml-2 text-warning">nobody has it</small>}
                </th>
                {grid.agents.map((a, i) =>
              <td key={a.id} className="px-3 py-2 text-center">
                    <input
                  type="checkbox"
                  className="h-4 w-4 accent-[rgb(var(--accent))]"
                  checked={row.cells[i]}
                  disabled={!editor.canEdit}
                  aria-label={`${a.name} can use ${row.name}`}
                  onChange={(e) => toggle(a.id, a.name, row.id, row.name, e.target.checked)} />
                  </td>
              )}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </details>);

}
