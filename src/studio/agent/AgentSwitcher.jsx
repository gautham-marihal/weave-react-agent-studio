import React from 'react';
import { DropdownMenu } from 'radix-ui';
import Icon from '../../ui/Icon.jsx';
import { afterMenu, keepEscape } from '../../ui/layer.ts';
import { navigate, routeHref } from '../route.js';
import StatePill from '../StatePill.jsx';
import { agentState } from '../status.js';

// At the top of an agent's menu: which agent this is, where it stands, and a list to move to another agent of the
// workspace (on the same page, so going from one agent's Tools to the next one's is one click), or to create one. A
// move is asked about first when there are unsaved edits (navigate's guard). The list is a Radix menu as wide as the
// card: the arrows move, a letter jumps to an agent, Escape closes it and gives the keyboard back to the card.
export default function AgentSwitcher({ botId, bots = [], tab = '' }) {
  const current = bots.find((b) => b.id === botId) || { id: botId, name: botId };
  const name = current.name || current.id;
  const others = bots.filter((b) => b.id !== botId);
  const go = (href) => afterMenu(() => navigate(href));
  // the setup is one agent's own steps: moving from it opens the other agent's overview (which offers its own setup
  // when it is being set up), and does not start a setup it never asked for
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
