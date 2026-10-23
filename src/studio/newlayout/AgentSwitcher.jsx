import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { navigate, routeHref } from '../route.js';
import StatePill from '../StatePill.jsx';
import { agentState } from '../status.js';

// At the top of an agent's menu: which agent this is, where it stands, and a list to move to another agent of the workspace (on the same page, so going
// from one agent's Tools to the next one's is one click), or to create one. A move is asked about first when there are unsaved edits (navigate's guard).
export default function AgentSwitcher({ botId, bots = [], tab = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const buttonRef = useRef(null);
  const current = bots.find((b) => b.id === botId) || { id: botId, name: botId };
  const name = current.name || current.id;

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const key = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const go = (href) => {
    setOpen(false);
    navigate(href);
  };
  const others = bots.filter((b) => b.id !== botId);

  return (
    <div className="agentSwitch" ref={ref}>
      <button
        type="button"
        ref={buttonRef}
        className="agentSideName agentSwitchButton"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch to another agent"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="agentRowAvatar" aria-hidden="true">
          {String(name).slice(0, 1).toUpperCase()}
        </span>
        <span className="agentSwitchText">
          <strong>{name}</strong>
          <StatePill state={agentState({ deployed: current.deployed || {} })} />
        </span>
        <Icon name="chevronDown" size={15} />
      </button>
      {open && (
        <div className="agentSwitchMenu" role="menu" aria-label="Agents">
          {others.length > 0 && <div className="agentSwitchLabel">Switch to</div>}
          {others.map((b) => (
            <button key={b.id} type="button" role="menuitem" onClick={() => go(routeHref(b.id, tab))}>
              <span className="agentRowAvatar" aria-hidden="true">
                {String(b.name || b.id)
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
              <span className="agentSwitchText">
                <strong>{b.name || b.id}</strong>
                <small>{agentState({ deployed: b.deployed || {} }).label}</small>
              </span>
            </button>
          ))}
          <div className="agentSwitchFoot">
            <button type="button" role="menuitem" onClick={() => go('#/bots')}>
              <Icon name="agent" size={15} /> All agents
            </button>
            <button type="button" role="menuitem" onClick={() => go('#/bots?new=1')}>
              <Icon name="plus" size={15} /> Create an agent
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
