import React from 'react';
import { useConfigSelect, useForm } from '../form/ctx.js';
import { buildToolGrid, setToolOffered } from './toolGrid.js';

// Who can use which tool: a row for each tool, a column for each agent, a tick where an agent offers the tool. Ticking edits the same `tools` list
// the agent's own card edits, and can be undone. It is closed until asked for, because a short list needs no grid, and it stays out of the way of the
// cards below it.
export default function ToolGrid() {
  const ctx = useForm();
  const grid = useConfigSelect(buildToolGrid);
  if (grid.agents.length < 2 || grid.rows.length < 2) return null;
  const toggle = (agent, row, on) => {
    const next = setToolOffered(ctx.store.get(), agent.id, row.id, on);
    ctx.applyConfig(next, `${on ? 'Gave' : 'Took'} “${row.id}” ${on ? 'to' : 'from'} the agent “${agent.id}”.`);
  };
  return (
    <details className="rlGrid">
      <summary>
        Who can use which tool{' '}
        <small>
          {grid.agents.length} agents · {grid.rows.length} tools{grid.unused.length ? ` · ${grid.unused.length} nobody has` : ''}
        </small>
      </summary>
      <div className="rlGridScroll">
        <table>
          <caption className="rlSr">A tick means the agent offers the tool to the model.</caption>
          <thead>
            <tr>
              <th scope="col" className="rlCorner">
                Tool
              </th>
              {grid.agents.map((agent) => (
                <th scope="col" key={agent.id} title={agent.id}>
                  <span>{agent.name}</span>
                  <small>{agent.count}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.id} className={row.agents.length === 0 ? 'unused' : ''}>
                <th scope="row" title={row.description || undefined}>
                  <span>{row.id}</span>
                  {row.agents.length === 0 && <small>nobody has it</small>}
                </th>
                {grid.agents.map((agent, i) => (
                  <td key={agent.id}>
                    <input
                      type="checkbox"
                      checked={row.cells[i]}
                      aria-label={`${agent.name} can use ${row.id}`}
                      onChange={(event) => toggle(agent, row, event.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
