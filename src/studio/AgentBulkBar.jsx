import React, { useState } from 'react';
import Menu from './manage/Menu.tsx';
import { assignBot, hideBot, useWorkspaces } from './agents.js';
import { applyToAgents, reachable, readIntegrations, reportWords, withIntegration } from './workspaceIntegrations.js';

// What can be done to several agents at once, picked by their boxes in the Agents table: give them a connected
// integration (saved into each draft, as "Choose agents" on the Integrations page does), move them to another workspace,
// or take them off this browser's list (they can be brought back below the list). Each says what it did through
// onDone(words), which also clears the pick.
//   ids: the picked agents; names: id -> name

const agentsWord = (n) => `${n} ${n === 1 ? 'agent' : 'agents'}`;

export default function AgentBulkBar({ ids, names, onDone, onClear }) {
  const { spaces, current } = useWorkspaces();
  const [busy, setBusy] = useState(false);
  const integrations = Object.entries(readIntegrations()).filter(([, connection]) => reachable(connection));
  const others = spaces.filter((space) => space.id !== current);
  const who = ids.length === 1 ? names[ids[0]] || ids[0] : agentsWord(ids.length);

  const addIntegration = async (id, connection) => {
    setBusy(true);
    const report = await applyToAgents(ids, (config) => withIntegration(config, id, connection));
    setBusy(false);
    onDone(`${connection.name}: ${reportWords(report)}`);
  };

  return (
    <div className="cvBulk" role="region" aria-label="Actions for the picked agents">
      <strong>{ids.length} picked</strong>
      <span className="cvDivider" aria-hidden="true" />
      <span className="cvActions">
        <Menu
          text={busy ? 'Adding…' : 'Add an integration'}
          label="Add an integration"
          className="cvBtn small"
          items={
            integrations.length
              ? integrations.map(([id, connection]) => ({ label: connection.name || id, onClick: () => addIntegration(id, connection) }))
              : [{ label: 'Nothing is connected yet', disabled: true, hint: 'Connect one on the Integrations page first.' }]
          }
        />
        <Menu
          text="Move to workspace"
          label="Move to workspace"
          className="cvBtn small"
          items={
            others.length
              ? others.map((space) => ({
                  label: space.name,
                  onClick: () => {
                    ids.forEach((id) => assignBot(id, space.id));
                    onDone(`Moved ${who} to ${space.name}.`);
                  },
                }))
              : [{ label: 'There is no other workspace', disabled: true }]
          }
        />
        <button
          type="button"
          className="cvBtn small"
          onClick={() => {
            ids.forEach((id) => hideBot(id));
            onDone(`Took ${who} off your list. ${ids.length === 1 ? 'It is' : 'They are'} under “Removed from your list” below, to bring back.`);
          }}
        >
          Remove from your list
        </button>
      </span>
      <span className="cvGap" />
      <button type="button" className="cvBtn small" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
