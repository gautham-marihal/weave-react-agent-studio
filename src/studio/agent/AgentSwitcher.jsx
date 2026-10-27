import React from 'react';
import { DropdownMenu } from 'radix-ui';
import Icon from '../../ui/Icon.jsx';
import { afterMenu, keepEscape } from '../../ui/layer.ts';
import { navigate, routeHref } from '../route.js';
import StatePill from '../StatePill.jsx';
import { agentState } from '../status.js';

// The sidebar card inside an agent: which agent, its state, and a Radix menu to switch to another agent on the same
// page (or create one). Unsaved edits are asked about first (navigate's guard); Escape returns focus to the card.
export default function AgentSwitcher({ botId, bots = [], tab = '' }) {
  const current = bots.find((b) => b.id === botId) || { id: botId, name: botId };
  const name = current.name || current.id;
  const others = bots.filter((b) => b.id !== botId);
  const go = (href) => afterMenu(() => navigate(href));
  // Switching from the setup opens the other agent's overview, so it doesn't start a setup that agent never asked for.
  const sameTab = tab === 'setup' ? '' : tab;

  return (
    <div className="agentSwitch">
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="agentSideName agentSwitchButton" title="Switch to another agent">
            <span className="agentRowAvatar" aria-hidden="true">
              {String(name).slice(0, 1).toUpperCase()}
            </span>
            <span className="agentSwitchText">
              <strong>{name}</strong>
              <StatePill state={agentState({ deployed: current.deployed || {} })} />
            </span>
            <Icon name="chevronDown" size={15} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="agentSwitchMenu rxLayer"
            aria-label="Agents"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            onEscapeKeyDown={keepEscape}
          >
            {others.length > 0 && <div className="agentSwitchLabel">Switch to</div>}
            {others.map((b) => (
              <DropdownMenu.Item key={b.id} asChild onSelect={go(routeHref(b.id, sameTab))} textValue={b.name || b.id}>
                <button type="button">
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
              </DropdownMenu.Item>
            ))}
            <div className="agentSwitchFoot">
              <DropdownMenu.Item asChild onSelect={go('#/bots')}>
                <button type="button">
                  <Icon name="agent" size={15} /> All agents
                </button>
              </DropdownMenu.Item>
              <DropdownMenu.Item asChild onSelect={go('#/bots?new=1')}>
                <button type="button">
                  <Icon name="plus" size={15} /> Create an agent
                </button>
              </DropdownMenu.Item>
            </div>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
