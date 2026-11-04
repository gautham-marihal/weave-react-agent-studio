import React, { createContext, useContext } from 'react';
import { Handle, NodeResizer, Position, useViewport } from '@xyflow/react';
import Icon from '../../ui/Icon.jsx';
import { NOTE_SIZE } from './notes.js';

// What is drawn inside the workflow picture: blocks, plug-ins, arrows and sticky notes (React Flow node and edge
// types), their icons and accessible names, and the selected block's controls beside it.

const ICON = {
  start: 'flag',
  trigger: 'bolt',
  back: 'arrowLeft',
  model: 'sparkle',
  knowledge: 'book',
  agent: 'subagent',
  agentTransfer: 'userCog',
  say: 'quote',
  state: 'pencil',
  transfer: 'phoneTransfer',
  tool: 'tools',
  end: 'endCall',
  step: 'sliders',
};
export const KIND_WORDS = {
  start: 'Start',
  handoff: 'Hands over',
  tool: 'Through a tool',
  rule: 'Under a safety rule',
  return: 'Back to the start',
  enter: 'Runs first',
  exit: 'Can do',
  uses: 'Can use',
  plug: 'Uses',
};
// a channel's block shows what kind of channel it is
const CHANNEL_ICON = { sip_voice: 'phone', web_voice: 'mic', web_chat: 'chat', whatsapp: 'chat', sms: 'chat', email: 'mail', custom: 'plug' };
// where on a subagent's lower edge each kind of plug-in is connected (a share of its width), and the words under it
export const PORTS = [
  ['model', 'Model', 0.17],
  ['knowledge', 'Knowledge', 0.5],
  ['tool', 'Tools', 0.83],
];
// arrows drawn without a head: the lines to what is plugged in under a subagent
export const HEADLESS = new Set(['plug', 'uses']);

// A block's accessible name: what it shows (name and line), then its kind, then any problems.
const KIND_PHRASE = {
  start: () => ': where a call begins',
  trigger: (n) => (n.channel ? `: where a call comes in${n.off ? ', switched off' : ''}` : ': where a call begins'),
  agent: (n) =>
    `, subagent${n.entry ? ', answers first' : ''}${n.stranded ? ', cannot be reached from Start' : ''}${n.deadEnd ? ', cannot end the conversation or pass the caller on' : ''}`,
};
const blockName = (n, line, problems) =>
  `${[n.label, line].filter(Boolean).join(', ')}${KIND_PHRASE[n.type]?.(n) || ''}${problems ? `, ${problems} problem${problems === 1 ? '' : 's'} to fix` : ''}`;
// everything a block says, for its tooltip (each of its lines may end in "…")
const nodeTip = (n) => (n.type === 'start' ? 'Start: where a call begins' : [n.label, n.sub, n.type === 'agent' ? n.detail : ''].filter(Boolean).join('\n'));
const iconOf = (n) => (n.type === 'trigger' ? CHANNEL_ICON[n.channelType] || 'bolt' : ICON[n.type] || 'sliders');

// what blocks and arrows read from the picture, via context so they aren't redrawn on every move of a dragged block
export const Picture = createContext(null);

// a block, with the points arrows leave from and arrive at (an agent's can be drawn from, to pass callers to another)
function Block({ id, data }) {
  const pic = useContext(Picture);
  const n = data.n;
  const on = pic.selected?.type === 'node' && pic.selected.id === id;
  const problems = pic.badges?.get(id) || 0;
  const agent = n.type === 'agent';
  if (n.role === 'plug') return <Plug n={n} on={on} problems={problems} />;
  // its one line: its instructions (an agent) or what it says or does (the rest); a problem instead, when it has one
  const warn = agent ? (n.stranded ? 'Not reachable from Start' : n.deadEnd ? 'Can’t end the conversation' : '') : n.noNumber ? n.sub : '';
  const line = warn || (agent ? n.brief || n.sub : n.sub);
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={agent} className={`wfHandle ${agent ? 'can' : ''}`} />
      <div
        className={`wfNode ${n.type} ${on ? 'sel' : ''} ${n.entry ? 'entry' : ''} ${n.missing ? 'missing' : ''} ${n.stranded ? 'stranded' : ''} ${n.off ? 'off' : ''} ${pic.dragging === id ? 'dragging' : ''}`}
        role="button"
        tabIndex={0}
        aria-pressed={on}
        aria-label={blockName(n, line, problems)}
        title={nodeTip(n)}
        data-node={n.id}
        data-type={n.type}
        onKeyDown={(event) => pic.onNodeKey(event, n)}
        // brought into sight when reached by keyboard (not by a pointer press, which would move the view under it)
        onFocus={(event) => event.currentTarget.matches(':focus-visible') && pic.onNodeFocus(n.id)}
        onPointerDown={(event) => pic.onPress(event, n)}
        onDoubleClick={() => pic.onOpen(n.id)}
      >
        <span className="wfIcon" aria-hidden="true">
          <Icon name={iconOf(n)} size={18} />
        </span>
        <span className="wfText">
          {/* a space between the two lines, so screen readers say "Billing You are…", not "BillingYou are…" */}
          <strong>{n.label}</strong> {line && <small className={warn ? 'wfWarnText' : undefined}>{line}</small>}
        </span>
        {n.type === 'trigger' && (
          <span className="wfBolt" aria-hidden="true">
            <Icon name="bolt" size={11} />
          </span>
        )}
        {problems > 0 && (
          <b className="wfBadge" title={`${problems} problem${problems === 1 ? '' : 's'} to fix`}>
            {problems}
          </b>
        )}
      </div>
      {agent && pic.showPlugs && (
        // a connector for each kind of plug-in under it; one with nothing plugged in offers to add
        <div className="wfPorts">
          {PORTS.map(([port, words, x]) => {
            const used = pic.plugged.get(`${n.id}|${port}`);
            return (
              <button
                key={port}
                type="button"
                tabIndex={-1}
                className={`wfPort ${used ? 'used' : 'empty'}`}
                style={{ left: `${x * 100}%` }}
                title={used ? `${words} of ${n.label}` : `Add ${words.toLowerCase()} to ${n.label}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  pic.onPort(n.id, port);
                }}
              >
                <i aria-hidden="true">{used ? null : <Icon name="plus" size={9} />}</i>
                <span>{words}</span>
              </button>
            );
          })}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={agent}
        className={`wfHandle ${agent ? 'can' : ''}`}
        title={agent ? `Draw an arrow to another agent to let ${n.label} pass callers to it` : undefined}
      />
    </>
  );
}

// something a subagent uses, plugged in under it: a round icon with its name and kind under it
function Plug({ n, on, problems }) {
  const pic = useContext(Picture);
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} className="wfHandle" />
      <div
        className={`wfNode wfPlug ${n.type} ${on ? 'sel' : ''} ${n.missing ? 'missing' : ''} ${n.own ? 'own' : ''} ${pic.dragging === n.id ? 'dragging' : ''}`}
        role="button"
        tabIndex={0}
        aria-pressed={on}
        aria-label={blockName(n, n.sub, problems)}
        title={[n.label, n.sub].filter(Boolean).join('\n')}
        data-node={n.id}
        data-type={n.type}
        onKeyDown={(event) => pic.onNodeKey(event, n)}
        onFocus={(event) => event.currentTarget.matches(':focus-visible') && pic.onNodeFocus(n.id)}
        onPointerDown={(event) => pic.onPress(event, n)}
        onDoubleClick={() => pic.onOpen(n.id)}
      >
        <span className="wfPlugIcon" aria-hidden="true">
          <Icon name={iconOf(n)} size={18} />
        </span>
        <strong>{n.label}</strong> <small className={n.missing ? 'wfWarnText' : undefined}>{n.sub}</small>
        {problems > 0 && <b className="wfBadge">{problems}</b>}
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="wfHandle" />
    </>
  );
}

// an arrow, routed round the blocks and drawn under them; its words are drawn above them (the labels layer below)
function Arrow({ id, data }) {
  const pic = useContext(Picture);
  const g = pic.routes.get(id);
  if (!g) return null;
  const edge = data.edge;
  return (
    <g className={`wfEdge ${edge.kind} ${edge.off ? 'off' : ''} ${pic.selected?.type === 'edge' && pic.selected.id === id ? 'sel' : ''}`}>
      <path className="wfEdgeLine" d={g.d} fill="none" markerEnd={HEADLESS.has(edge.kind) ? undefined : `url(#${pic.markerId}-${edge.kind})`} />
      <path className="wfEdgeHit" d={g.d} fill="none">
        <title>{`${KIND_WORDS[edge.kind]}${edge.full || edge.label ? `: ${edge.full || edge.label}` : ''}`}</title>
      </path>
    </g>
  );
}

// a sticky note: under the blocks and arrows, its words as written; selected, it can be resized from its edges
function Note({ id, data, selected: _ }) {
  const pic = useContext(Picture);
  const note = data.note;
  const on = pic.selected?.type === 'note' && pic.selected.id === id;
  return (
    <>
      <NodeResizer
        isVisible={on}
        minWidth={NOTE_SIZE.minW}
        minHeight={NOTE_SIZE.minH}
        lineClassName="wfNoteResize"
        handleClassName="wfNoteHandle"
        onResize={(event, p) => pic.onNoteResize(id, p, false)}
        onResizeEnd={(event, p) => pic.onNoteResize(id, p, true)}
      />
      <div
        className={`wfSticky ${note.color || 'yellow'} ${on ? 'sel' : ''}`}
        role="button"
        tabIndex={0}
        aria-pressed={on}
        aria-label={note.text ? `Note: ${note.text}` : 'Empty note'}
        data-note={id}
        onDoubleClick={() => pic.onNoteEdit(id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            pic.onNoteEdit(id);
          }
        }}
      >
        {note.text ? <p>{note.text}</p> : <p className="wfNoteEmpty">Double-click to write a note</p>}
      </div>
    </>
  );
}

export const nodeTypes = { block: Block, note: Note };
export const edgeTypes = { routed: Arrow };

// the selected block's controls at their own size beside it (outside the zoomed picture), first in the tab order
export function Controls({ overlay, nodes }) {
  const { x, y, zoom } = useViewport();
  if (!overlay) return null;
  return (
    <div
      className="wfOverlayLayer"
      style={{ transform: `translate(${x}px, ${y}px)` }}
      // once focus leaves, the next visit to the controls follows the page's order again
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) delete event.currentTarget.dataset.from;
      }}
    >
      {overlay({ nodes, zoom })}
    </div>
  );
}
