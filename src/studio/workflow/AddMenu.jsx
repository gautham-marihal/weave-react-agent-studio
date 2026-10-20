import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { isBuiltin } from './workflowOps.js';

// The "＋" under a block: what can be added next to this agent. Some choices are made on the spot (a new subagent, a line to say, the end of the call); the
// others ask one small thing first (which agent, which number, which tool) in the same little window, with a way back.
export const PHONE_PATTERN = /^(\+?[0-9][0-9\s().-]{2,}|sips?:\S+)$/i;

const ITEMS = [
  { id: 'subagent', icon: 'subagent', label: 'Subagent', hint: 'A new agent the caller can be passed to' },
  { id: 'say', icon: 'quote', label: 'Say', hint: 'A line it says as soon as it takes over' },
  { id: 'state', icon: 'pencil', label: 'Update state', hint: 'Remember something about the call' },
  { id: 'agent', icon: 'swap', label: 'Agent transfer', hint: 'Pass the caller to an agent you already have' },
  { id: 'phone', icon: 'phoneTransfer', label: 'Phone number transfer', hint: 'Hand the caller to a person on this number' },
  { id: 'tool', icon: 'tools', label: 'Tool', hint: 'Let it use a tool you have set up' },
  { id: 'end', icon: 'endCall', label: 'End', hint: 'Let it end the call' },
];

export default function AddMenu({ agentId, flow, config, onPick, onClose }) {
  const [view, setView] = useState('menu');
  const [number, setNumber] = useState('');
  const [tried, setTried] = useState(false);
  const root = useRef(null);
  const agent = (config?.agents?.items || []).find((a) => a?.id === agentId);
  const others = useMemo(() => (config?.agents?.items || []).filter((a) => a?.id && a.id !== agentId), [config, agentId]);
  const linked = useMemo(() => new Set(flow.edges.filter((e) => e.from === agentId && e.kind === 'handoff').map((e) => e.to)), [flow, agentId]);
  const tools = useMemo(() => {
    const offered = new Set(agent?.tools || []);
    return (config?.tools || []).filter(
      (t) => t?.id && !offered.has(t.id) && !isBuiltin(t, 'end_call') && !isBuiltin(t, 'transfer_or_callback') && !isBuiltin(t, 'return_to_entry'),
    );
  }, [config, agent]);
  const canEnd = !flow.nodes.some((n) => n.agent === agentId && n.role === 'exit' && n.type === 'end');
  const blocked = {
    agent: others.length === 0 ? 'You need a second agent first' : '',
    tool: tools.length === 0 ? 'Every tool you have is already offered' : '',
    end: canEnd ? '' : 'It can already end the call',
  };

  useEffect(() => {
    root.current?.querySelector('input, button:not(:disabled)')?.focus({ preventScroll: true });
    root.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [view]);
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (view === 'menu') onClose();
      else setView('menu');
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...root.current.querySelectorAll('[role=menuitem]:not(:disabled)')];
    if (!buttons.length) return;
    event.preventDefault();
    const at = buttons.indexOf(document.activeElement);
    buttons[(at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
  };

  const pick = (id) => {
    if (id === 'agent' || id === 'phone' || id === 'tool') {
      setView(id);
      return;
    }
    onPick(id, {});
  };
  const submitPhone = (event) => {
    event.preventDefault();
    setTried(true);
    if (PHONE_PATTERN.test(number.trim())) onPick('phone', { number: number.trim() });
  };

  return (
    <div
      className="wfMenu"
      ref={root}
      role="dialog"
      aria-label={`Add to ${agent?.name || agentId}`}
      onKeyDown={onKey}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {view === 'menu' && (
        <div role="menu" aria-label="What to add">
          {ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="wfMenuItem"
              disabled={!!blocked[item.id]}
              title={blocked[item.id] || item.hint}
              onClick={() => pick(item.id)}
            >
              <Icon name={item.icon} size={18} />
              <span>
                <strong>{item.label}</strong>
                <small>{blocked[item.id] || item.hint}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {view === 'agent' && (
        <div className="wfMenuPane">
          <header>
            <button type="button" className="wfBack" onClick={() => setView('menu')} aria-label="Back">
              <Icon name="chevronLeft" size={15} />
            </button>
            <strong>Pass the caller to…</strong>
          </header>
          <ul role="menu" aria-label="Agents">
            {others.map((a) => (
              <li key={a.id}>
                <button type="button" role="menuitem" className="wfMenuItem" onClick={() => onPick('agent', { to: a.id })}>
                  <Icon name="subagent" size={18} />
                  <span>
                    <strong>{a.name || a.id}</strong>
                    <small>{linked.has(a.id) ? 'Already linked: adds another way to reach it' : a.id}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {view === 'tool' && (
        <div className="wfMenuPane">
          <header>
            <button type="button" className="wfBack" onClick={() => setView('menu')} aria-label="Back">
              <Icon name="chevronLeft" size={15} />
            </button>
            <strong>Let it use…</strong>
          </header>
          <ul role="menu" aria-label="Tools">
            {tools.map((t) => (
              <li key={t.id}>
                <button type="button" role="menuitem" className="wfMenuItem" onClick={() => onPick('tool', { tool: t.id })}>
                  <Icon name="tools" size={18} />
                  <span>
                    <strong>{t.name || t.id}</strong>
                    <small>{t.description || t.type}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {view === 'phone' && (
        <form className="wfMenuPane" onSubmit={submitPhone} noValidate>
          <header>
            <button type="button" className="wfBack" onClick={() => setView('menu')} aria-label="Back">
              <Icon name="chevronLeft" size={15} />
            </button>
            <strong>Transfer to a number</strong>
          </header>
          <label className="wfField">
            <span>Phone number or SIP address</span>
            <input
              type="tel"
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              placeholder="+1 800 555 0100"
              aria-invalid={tried && !PHONE_PATTERN.test(number.trim())}
              aria-describedby="wf-phone-help"
            />
          </label>
          <small id="wf-phone-help" className={tried && !PHONE_PATTERN.test(number.trim()) ? 'bad' : ''}>
            {tried && !PHONE_PATTERN.test(number.trim())
              ? 'Type a number such as +1 800 555 0100, or a SIP address such as sip:desk@example.com.'
              : 'The agent can hand the caller to this number when they ask for a person.'}
          </small>
          <div className="wfMenuActions">
            <button type="submit" className="primaryCta compactCta">
              Add the transfer
            </button>
            <button type="button" className="quietButton" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
