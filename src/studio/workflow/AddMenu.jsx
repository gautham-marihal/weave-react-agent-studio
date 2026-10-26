import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import Tip from '../../ui/Tip.tsx';
import { matchScore, SHOWN } from '../../ui/match.ts';
import { isBuiltin } from './workflowOps.js';
import { toolName, toolTitle } from './workflowModel.js';

// "Add a step after <subagent>", in the side panel: every step there is, in groups (subagents, your other agents, a
// person's number, what it does as it takes over, tools, ending the call), with a search over all of them. Most are
// added at once; a new subagent and a phone number ask one small thing first, in the same panel, with a way back.
export const PHONE_PATTERN = /^(\+?\d[\d\s().-]{2,}|sips?:\S+)$/i;

// workspace: the other agents of the workspace and their numbers (useWorkspaceAgents); botId: this agent, which is not offered
export default function AddMenu({ agentId, flow, config, onPick, onClose, workspace = null, botId = '' }) {
  const [view, setView] = useState('menu');
  const [query, setQuery] = useState('');
  const [number, setNumber] = useState('');
  // a new subagent's name and when it takes over, asked as it is added (rather than a "New subagent" with stand-in words to find and change later)
  const [helper, setHelper] = useState({ name: '', when: '' });
  const [tried, setTried] = useState(false);
  const root = useRef(null);
  const agent = (config?.agents?.items || []).find((a) => a?.id === agentId);
  const name = agent?.name || agentId;
  const others = useMemo(() => (config?.agents?.items || []).filter((a) => a?.id && a.id !== agentId), [config, agentId]);
  const linked = useMemo(() => new Set(flow.edges.filter((e) => e.from === agentId && e.kind === 'handoff').map((e) => e.to)), [flow, agentId]);
  const offered = new Set(agent?.tools || []);
  const tools = (config?.tools || []).filter(
    (t) => t?.id && !offered.has(t.id) && !isBuiltin(t, 'end_call') && !isBuiltin(t, 'transfer_or_callback') && !isBuiltin(t, 'return_to_entry'),
  );
  const canEnd = !flow.nodes.some((n) => n.agent === agentId && n.role === 'exit' && n.type === 'end');
  const goesBack = (config?.tools || []).some((t) => isBuiltin(t, 'return_to_entry') && offered.has(t.id));
  // the other agents of the workspace (not this one); one with no number can't be reached yet
  const agents = (workspace?.agents || []).filter((a) => a.id !== botId);
  const reaches = new Set(flow.nodes.filter((n) => n.agent === agentId && n.type === 'agentTransfer').map((n) => n.bot));

  // every step, in its group: { id, icon, label, hint, off (why it can't be added), go () }
  const groups = [
    {
      title: 'Subagents',
      items: [
        { id: 'subagent', icon: 'subagent', label: 'Subagent', hint: 'A new subagent the caller can be passed to', go: () => setView('subagent') },
        ...others.map((a) => ({
          id: `to:${a.id}`,
          icon: 'swap',
          label: `Pass the caller to ${a.name || a.id}`,
          hint: linked.has(a.id) ? 'Already linked: adds another way to reach it' : flow.nodes.find((n) => n.id === a.id)?.brief || 'Subagent transfer',
          go: () => onPick('agent', { to: a.id }),
        })),
      ],
    },
    {
      title: 'Your agents',
      empty: workspace?.loading ? 'Looking for your agents…' : 'You have no other agents yet.',
      items: agents.map((a) => ({
        id: `agent:${a.id}`,
        icon: 'userCog',
        label: `Transfer to ${a.name}`,
        hint: !a.numbers.length
          ? 'No phone number yet: give it one on its Numbers page to transfer calls to it'
          : reaches.has(a.id)
            ? 'Already offered: adds another way to reach it'
            : `Agent transfer · reached on ${a.numbers[0].number}`,
        off: !a.numbers.length,
        go: () => onPick('agentTransfer', { agent: a }),
      })),
    },
    {
      title: 'A person',
      items: [
        { id: 'phone', icon: 'phoneTransfer', label: 'Phone number transfer', hint: 'Hand the caller to a person on this number', go: () => setView('phone') },
      ],
    },
    {
      title: 'As it takes over',
      items: [
        { id: 'say', icon: 'quote', label: 'Say', hint: 'A line it says as soon as it takes over', go: () => onPick('say', {}) },
        { id: 'state', icon: 'pencil', label: 'Update state', hint: 'Remember something about the call', go: () => onPick('state', {}) },
      ],
    },
    {
      title: 'Tools',
      empty: 'Every tool you have is already offered.',
      items: [
        ...(flow.entry !== agentId && !goesBack
          ? [
              {
                id: 'back',
                icon: 'arrowLeft',
                label: 'Back to the first subagent',
                hint: 'Passes the caller back to the one that answers first',
                go: () => onPick('back', {}),
              },
            ]
          : []),
        ...tools.map((t) => ({
          id: `tool:${t.id}`,
          icon: 'tools',
          label: toolName(t.id),
          hint: t.description || toolTitle(t, config).sub || t.type,
          go: () => onPick('tool', { tool: t.id }),
        })),
      ],
    },
    {
      title: 'Ending',
      items: [
        {
          id: 'end',
          icon: 'endCall',
          label: 'End',
          hint: canEnd ? 'Say goodbye and end the conversation' : 'It can already end the conversation',
          off: !canEnd,
          go: () => onPick('end', {}),
        },
      ],
    },
  ];
  const shown = query.trim()
    ? groups.map((g) => ({ ...g, items: g.items.filter((i) => matchScore(query.trim(), i.label, i.hint) >= SHOWN) })).filter((g) => g.items.length)
    : groups;

  useEffect(() => {
    root.current?.querySelector(view === 'menu' ? '.wfAddSearch input' : 'form input')?.focus({ preventScroll: true });
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
  const submitHelper = (event) => {
    event.preventDefault();
    setTried(true);
    if (helper.name.trim() && helper.when.trim()) onPick('subagent', { name: helper.name.trim(), when: helper.when.trim() });
  };
  const submitPhone = (event) => {
    event.preventDefault();
    setTried(true);
    if (PHONE_PATTERN.test(number.trim())) onPick('phone', { number: number.trim() });
  };
  const back = (
    <button type="button" className="wfBack" onClick={() => setView('menu')} aria-label="Back">
      <Icon name="chevronLeft" size={15} />
    </button>
  );

  return (
    <aside className="wfInspector wfAddPanel wfMenu" ref={root} aria-label={`Add a step after ${name}`} onKeyDown={onKey}>
      <header>
        <span className="wfIcon" aria-hidden="true">
          <Icon name="plus" size={20} />
        </span>
        <span>
          <small>Add a step</small>
          <strong>After {name}</strong>
        </span>
        <Tip label="Close">
          <button type="button" className="smClose" aria-label="Close this panel" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </Tip>
      </header>
      <div className="wfInspectorBody">
        {view === 'menu' && (
          <>
            <label className="wfAddSearch">
              <Icon name="search" size={15} />
              <input type="search" value={query} placeholder="Search steps…" aria-label="Search steps" onChange={(event) => setQuery(event.target.value)} />
            </label>
            {shown.length === 0 && <p className="wfMuted">Nothing matches “{query.trim()}”.</p>}
            {shown.map((g) => (
              <section key={g.title} className="wfAddGroup">
                <h4>{g.title}</h4>
                {g.items.length === 0 ? (
                  <p className="wfMuted">{g.empty}</p>
                ) : (
                  <div role="menu" aria-label={g.title}>
                    {g.items.map((item) => (
                      <button key={item.id} type="button" role="menuitem" className="wfMenuItem" disabled={!!item.off} title={item.hint} onClick={item.go}>
                        <span className="wfMenuIcon" aria-hidden="true">
                          <Icon name={item.icon} size={17} />
                        </span>
                        <span>
                          <strong>{item.label}</strong>
                          <small>{item.hint}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </>
        )}
        {view === 'subagent' && (
          <form className="wfMenuPane" onSubmit={submitHelper} noValidate>
            <header>
              {back}
              <strong>A new subagent</strong>
            </header>
            <label className="wfField">
              <span>Its name</span>
              <input
                value={helper.name}
                placeholder="Billing"
                aria-invalid={tried && !helper.name.trim()}
                onChange={(event) => setHelper({ ...helper, name: event.target.value })}
              />
            </label>
            <label className="wfField">
              <span>When should {name} pass callers to it?</span>
              <input
                value={helper.when}
                placeholder="The caller asks about a bill or a refund"
                aria-invalid={tried && !helper.when.trim()}
                onChange={(event) => setHelper({ ...helper, when: event.target.value })}
              />
            </label>
            <small className={tried && (!helper.name.trim() || !helper.when.trim()) ? 'bad' : ''}>
              {tried && (!helper.name.trim() || !helper.when.trim())
                ? 'Give it a name, and say when callers go to it.'
                : 'Then write what it should do in the panel beside the picture.'}
            </small>
            <div className="wfMenuActions">
              <button type="submit" className="primaryCta compactCta">
                Add the subagent
              </button>
              <button type="button" className="quietButton" onClick={() => setView('menu')}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {view === 'phone' && (
          <form className="wfMenuPane" onSubmit={submitPhone} noValidate>
            <header>
              {back}
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
                : 'The subagent can hand the caller to this number when they ask for a person.'}
            </small>
            <div className="wfMenuActions">
              <button type="submit" className="primaryCta compactCta">
                Add the transfer
              </button>
              <button type="button" className="quietButton" onClick={() => setView('menu')}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </aside>
  );
}
