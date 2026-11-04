import React, { useMemo, useState } from 'react';
import { Modal } from './ui.jsx';
import { navigate, routeHref } from './route.js';
import Icon from '../ui/Icon.jsx';
import Button from '../ui/Button.tsx';

// "Which agent?" for actions that start on another page (use this voice, add this connection).
export default function AgentPicker({ title, subtitle, agents, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? agents.filter((bot) => `${bot.name} ${bot.id}`.toLowerCase().includes(q)) : agents;
  }, [agents, query]);

  return (
    <Modal
      eyebrow="CHOOSE AN AGENT"
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <button type="button" className="modalCancel" onClick={onClose}>
          Cancel
        </button>
      }
    >
      {agents.length === 0 ? (
        <div className="stPickEmpty">
          <p className="stMuted">There are no agents yet.</p>
          <Button
            type="button"
            variant="primary"
            size="compact"
            onClick={() => {
              onClose();
              navigate(routeHref(undefined, undefined, { new: '1' }), { guard: false });
            }}
          >
            Create an agent
          </Button>
        </div>
      ) : (
        <>
          {agents.length > 6 && (
            <label className="inlineSearch stPickSearch">
              <Icon name="search" size={16} />
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter agents" aria-label="Filter agents" />
            </label>
          )}
          <ul className="stPickList">
            {shown.map((bot) => (
              <li key={bot.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(bot.id);
                    onClose();
                  }}
                >
                  <span className="agentRowAvatar" aria-hidden="true">
                    {(bot.name || bot.id).slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{bot.name || bot.id}</strong>
                    <small>{bot.id}</small>
                  </span>
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="stMuted">No agents match “{query.trim()}”.</li>}
          </ul>
        </>
      )}
    </Modal>
  );
}
