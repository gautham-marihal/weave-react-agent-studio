import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Handle,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useReactFlow,
  useViewport,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import Icon from '../../ui/Icon.jsx';
import { routeEdge, sidesFor } from './geometry.js';
import { roundedPath } from './edgeLanes.js';
import { EDGE, LABEL, labelBox } from './workflowModel.js';
import { NOTE_SIZE } from './notes.js';

// The workflow picture (React Flow underneath): blocks for where a call starts, each subagent and what goes with it,
// and arrows for each way the caller moves on. It draws what it is given and reports what the person did; it never
// edits the configuration itself.
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
const KIND_WORDS = {
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
const PORT_X = Object.fromEntries(PORTS.map(([port, , x]) => [port, x]));
// the line to a plug-in starts under the port's words
const PORT_DROP = 26;
// arrows drawn without a head: the lines to what is plugged in under a subagent
const HEADLESS = new Set(['plug', 'uses']);
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1.6;
export const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));
// a press that moves less than this is a click, not a drag
const DRAG_FROM = 4;
// the overview in a corner: its size and its distance from the edges
const OVERVIEW = { w: 168, h: 112, margin: 12 };
// the toolbar floats over the top of the picture: room left above the blocks when the picture is fitted
const UNDER_TOOLBAR = 68;
// the room the toolbar takes now (in a narrow picture its buttons wrap to a second row), never less than UNDER_TOOLBAR
const toolbarRoom = (el) => {
  const bar = el?.closest('.wfCanvasBox')?.querySelector('.wfCanvasTools');
  return bar ? Math.max(UNDER_TOOLBAR, Math.round(bar.offsetTop + bar.offsetHeight + 12)) : UNDER_TOOLBAR;
};
// the zoom and Test button float over the picture's foot: room left below the blocks when the picture is fitted
const OVER_ZOOMBAR = 68;
// what a hand-over with nothing saying when it is taken shows on its arrow
const SAY_WHEN = 'Say when';

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
const overlaps = (r, b) => r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y;
const still = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// what blocks and arrows read from the picture, via context so they aren't redrawn on every move of a dragged block
const Picture = createContext(null);

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

const nodeTypes = { block: Block, note: Note };
const edgeTypes = { routed: Arrow };

// the selected block's controls at their own size beside it (outside the zoomed picture), first in the tab order
function Controls({ overlay, nodes }) {
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

function Canvas({
  flow,
  selected,
  onSelect,
  onMove,
  zoom,
  autoFit,
  onZoom,
  badges,
  overlay,
  onDeleteKey,
  onConnectAgents,
  viewportRef,
  onPort,
  showPlugs,
  notes = [],
  onNoteChange,
  onOpen,
}) {
  const rf = useReactFlow();
  // the page's latest onOpen (the picture's handlers are kept from one render to the next)
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  // the latest onNoteChange: the picture is kept while only notes change, and a resize must not write back stale notes
  const noteChangeRef = useRef(onNoteChange);
  noteChangeRef.current = onNoteChange;
  // the box the picture is shown in, to know whether all of it is in sight
  const box = useRef(null);
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let width = el.clientWidth;
    const watch = new ResizeObserver(() => {
      // when the box width changes (panel hidden or shown, window resized), keep what was mid-view in the middle
      const change = el.clientWidth - width;
      width = el.clientWidth;
      if (change && width && width !== change) {
        const { x, y, zoom } = rf.getViewport();
        rf.setViewport({ x: Math.round(x + change / 2), y, zoom });
      }
      setBoxSize({ w: el.clientWidth, h: el.clientHeight });
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [rf]);
  const markerId = useId().replace(/:/g, '');
  // the dragged blocks' places as they move; the configuration gets only the dragged block's place, on release
  const [live, setLive] = useState(null);
  // an arrow being drawn from an agent: the other agents show where it can go
  const [connecting, setConnecting] = useState(false);
  const liveRef = useRef(null);
  const drag = useRef(null);
  const setLiveNow = (value) => {
    liveRef.current = value;
    setLive(value);
  };

  const nodes = useMemo(() => flow.nodes.map((n) => (live && live[n.id] ? { ...n, ...live[n.id] } : n)), [flow, live]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const bounds = useMemo(
    () => ({ w: Math.max(flow.bounds.w, ...nodes.map((n) => n.x + n.w + 40)), h: Math.max(flow.bounds.h, ...nodes.map((n) => n.y + n.h + 40)) }),
    [flow, nodes],
  );

  // arrows that join the same two blocks are laid side by side
  const lanes = useMemo(() => {
    const groups = new Map();
    flow.edges.forEach((e) => {
      const key = [e.from, e.to].sort().join('|');
      groups.set(key, [...(groups.get(key) || []), e.id]);
    });
    return new Map(
      flow.edges.map((e) => {
        const ids = groups.get([e.from, e.to].sort().join('|'));
        return [e.id, { lane: ids.indexOf(e.id), lanes: ids.length }];
      }),
    );
  }, [flow]);

  // which ports of each subagent have something plugged in
  const plugged = useMemo(() => {
    const out = new Map();
    flow.nodes.forEach((n) => {
      if (n.role === 'plug') out.set(`${n.agent}|${n.port}`, true);
    });
    return out;
  }, [flow]);

  // each way out of a subagent's right side leaves from its own point, ordered top to bottom by target, so arrows never
  // start on top of one another (the layout's own routes already have theirs)
  const fromShift = useMemo(() => {
    const outs = new Map();
    flow.edges.forEach((edge) => {
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      if (!a || !b || edge.points || a.type !== 'agent' || HEADLESS.has(edge.kind) || sidesFor(a, b, edge.kind)[0] !== 'right') return;
      if (!outs.has(a.id)) outs.set(a.id, []);
      outs.get(a.id).push({ id: edge.id, y: b.y + b.h / 2 });
    });
    const shift = new Map();
    outs.forEach((list, id) => {
      const a = byId.get(id);
      list.sort((p, q) => p.y - q.y);
      const step = list.length > 1 ? Math.min(16, (a.h - 28) / (list.length - 1)) : 0;
      list.forEach((o, i) => shift.set(o.id, (i - (list.length - 1) / 2) * step));
    });
    return shift;
  }, [flow, byId]);

  // each arrow's route, around the other blocks. While a block is dragged, arrows take plain curves (cheap on every
  // move) and route round again on release. A plug-in hangs from its port under the subagent.
  const dragging = !!live;
  const routes = useMemo(() => {
    const out = new Map();
    flow.edges.forEach((edge) => {
      if (edge.hidden) return;
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      if (!a || !b) return;
      if (HEADLESS.has(edge.kind)) {
        const sx = a.x + a.w * (PORT_X[edge.port] ?? 0.5);
        const sy = a.y + a.h + PORT_DROP;
        const ex = b.x + b.w / 2;
        const ey = b.y;
        const k = Math.max(20, Math.abs(ey - sy) / 2);
        out.set(edge.id, { d: `M ${sx} ${sy} C ${sx} ${sy + k}, ${ex} ${ey - k}, ${ex} ${ey}`, lx: (sx + ex) / 2, ly: (sy + ey) / 2 });
        return;
      }
      // the layout's own lane route, while both blocks are still where the layout put them
      if (edge.points?.length >= 2 && !(live && (live[edge.from] || live[edge.to]))) {
        const [start, end] = [edge.points[0], edge.points.at(-1)];
        out.set(edge.id, { d: roundedPath(edge.points), lx: edge.labelAt?.x ?? (start.x + end.x) / 2, ly: edge.labelAt?.y ?? (start.y + end.y) / 2 });
        return;
      }
      out.set(edge.id, routeEdge(a, b, { ...lanes.get(edge.id), kind: edge.kind, obstacles: dragging ? [] : nodes, fromShift: fromShift.get(edge.id) }));
    });
    return out;
  }, [flow, nodes, byId, lanes, dragging, fromShift, live]);

  // each arrow's words go on the arrow unless they would cover a block or other words; then the nearest free spot up,
  // down or beside it (with no room near, on the arrow as before)
  const spots = useMemo(() => {
    const blocks = nodes.map((n) => ({ x: n.x - 6, y: n.y - 6, w: n.w + 12, h: n.h + 12 }));
    const placed = [];
    const out = new Map();
    flow.edges.forEach((edge) => {
      if (edge.hidden) return;
      const label = edge.missing ? SAY_WHEN : edge.label && edge.kind !== 'start' ? edge.full || edge.label : '';
      const g = routes.get(edge.id);
      if (!label || !g) return;
      const lb = labelBox(label);
      const w = lb.width + (edge.missing ? 18 : 0);
      const h = lb.height;
      // the place the layout kept for them, while the arrow is the layout's own
      if (edge.labelAt && edge.points && !(live && (live[edge.from] || live[edge.to]))) {
        placed.push({ x: edge.labelAt.x - w / 2, y: edge.labelAt.y - h / 2, w, h });
        out.set(edge.id, { x: edge.labelAt.x, y: edge.labelAt.y, label, lines: lb.lines, w, h, missing: !!edge.missing });
        return;
      }
      const box = ([dx, dy]) => ({ x: g.lx + dx - w / 2 - 2, y: g.ly + dy - h / 2, w: w + 4, h });
      // up or down the arrow first, then beside it, then both; the nearest free spot wins
      const tries = [];
      for (const dx of [0, w / 2 + 14, -(w / 2 + 14), w + 28, -(w + 28)]) for (let k = -8; k <= 8; k += 1) tries.push([dx, k * 14]);
      tries.sort((p, q) => Math.hypot(p[0], p[1] * 1.6) - Math.hypot(q[0], q[1] * 1.6));
      // never past the picture's edge, where the words would be cut off
      const onCanvas = (t) => {
        const r = box(t);
        return r.x >= 2 && r.y >= 2 && r.x + r.w <= bounds.w - 2 && r.y + r.h <= bounds.h - 2;
      };
      const clear = tries.find((t) => onCanvas(t) && !blocks.some((r) => overlaps(box(t), r)) && !placed.some((r) => overlaps(box(t), r)));
      const offBlocks = clear || tries.find((t) => onCanvas(t) && !blocks.some((r) => overlaps(box(t), r))) || [0, 0];
      placed.push(box(offBlocks));
      out.set(edge.id, { x: g.lx + offBlocks[0], y: g.ly + offBlocks[1], label, lines: lb.lines, w, h, missing: !!edge.missing });
    });
    return out;
  }, [flow, nodes, routes, bounds, live]);

  // React Flow's own lists: built per render, not per move (a dragged block's place comes from `live`)
  const rfNodes = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: 'block',
        position: { x: n.x, y: n.y },
        width: n.w,
        height: n.h,
        // its size is known, so React Flow treats it as measured and a block can be dragged as soon as it is drawn
        measured: { width: n.w, height: n.h },
        data: { n },
        connectable: n.type === 'agent',
        zIndex: live && live[n.id] ? 6 : 0,
      })),
    [nodes, live],
  );
  // a note being resized: its size as it changes (written when it is let go)
  const [sizing, setSizing] = useState(null);
  const noteNodes = useMemo(
    () =>
      notes.map((note) => {
        const at = { ...note, ...(live && live[note.id]), ...(sizing && sizing.id === note.id ? sizing : {}) };
        return {
          id: note.id,
          type: 'note',
          position: { x: at.x, y: at.y },
          width: at.w,
          height: at.h,
          measured: { width: at.w, height: at.h },
          data: { note },
          connectable: false,
          zIndex: -1,
        };
      }),
    [notes, live, sizing],
  );
  const allNodes = useMemo(() => [...noteNodes, ...rfNodes], [noteNodes, rfNodes]);
  const rfEdges = useMemo(
    () =>
      flow.edges
        .filter((edge) => !edge.hidden)
        .map((edge) => ({ id: edge.id, source: edge.from, target: edge.to, type: 'routed', data: { edge }, focusable: false })),
    [flow],
  );
  const agents = useMemo(() => new Set(flow.nodes.filter((n) => n.type === 'agent').map((n) => n.id)), [flow]);

  // A dragged block follows the pointer from where it was pressed, by exactly what the pointer moved (at the
  // zoom), once past the drag threshold; React Flow says when that is.
  const press = useRef(null);
  const followers = (node) => (node.type === 'agent' ? flow.nodes.filter((n) => n.agent === node.id && !n.moved) : []);
  const onNodeDragStart = (event, rfNode) => {
    const note = notes.find((n) => n.id === rfNode.id);
    if (note) {
      drag.current = { id: note.id, ox: note.x, oy: note.y, sx: event.clientX, sy: event.clientY, follow: [], note: true };
      return;
    }
    const node = flow.nodes.find((n) => n.id === rfNode.id);
    if (!node) return;
    const from = press.current?.id === node.id ? press.current : { x: event.clientX, y: event.clientY };
    drag.current = { id: node.id, ox: node.x, oy: node.y, sx: from.x, sy: from.y, follow: followers(node).map((n) => ({ id: n.id, x: n.x, y: n.y })) };
  };
  const onNodeDrag = (event) => {
    const d = drag.current;
    if (!d) return;
    const z = rf.getZoom();
    // whole pixels: the place is kept in the draft
    const x = Math.max(EDGE, Math.round(d.ox + (event.clientX - d.sx) / z));
    const y = Math.max(EDGE, Math.round(d.oy + (event.clientY - d.sy) / z));
    const next = { [d.id]: { x, y } };
    d.follow.forEach((f) => {
      next[f.id] = { x: Math.max(EDGE, f.x + (x - d.ox)), y: Math.max(EDGE, f.y + (y - d.oy)) };
    });
    setLiveNow(next);
  };
  const onNodeDragStop = () => {
    const d = drag.current;
    drag.current = null;
    const last = liveRef.current;
    setLiveNow(null);
    if (!d || !last || !last[d.id] || (last[d.id].x === d.ox && last[d.id].y === d.oy)) return;
    // a note keeps its place in this browser
    if (d.note) {
      onNoteChange?.(d.id, last[d.id]);
      return;
    }
    // only the dragged block gets a saved place; the blocks that went with it follow it from its new place
    onMove({ [d.id]: last[d.id] });
  };

  const onNodeKey = (event, node) => {
    const step = event.shiftKey ? 32 : 8;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      // Enter on the selected block opens it to change it; Enter or Space on another selects it
      if (event.key === 'Enter' && selected?.type === 'node' && selected.id === node.id) openRef.current?.(node.id);
      else onSelect({ type: 'node', id: node.id });
      return;
    }
    // from the selected block, Tab goes to its own controls (copy, delete, ＋) before the next block
    if (event.key === 'Tab' && !event.shiftKey && selected?.type === 'node' && selected.id === node.id) {
      const first = document.querySelector('.wfOverlayLayer .wfNodeTools button, .wfOverlayLayer .wfPlus');
      if (first) {
        event.preventDefault();
        // the controls know the keyboard came from their block (Tab from the last goes on to the block after it)
        first.closest('.wfOverlayLayer').dataset.from = node.id;
        first.focus({ preventScroll: true });
      }
      return;
    }
    if (arrows[event.key] && selected?.type === 'node' && selected.id === node.id) {
      event.preventDefault();
      const [dx, dy] = arrows[event.key];
      onMove({ [node.id]: { x: Math.max(EDGE, node.x + dx), y: Math.max(EDGE, node.y + dy) } }, { group: `key:${node.id}` });
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !['start', 'trigger', 'model'].includes(node.type)) {
      event.preventDefault();
      onDeleteKey(node.id);
    }
  };

  // a zoom the page asks for (its buttons, a saved value): the view zooms about its middle
  const shown = useRef(zoom);
  useEffect(() => {
    if (Math.abs(zoom - shown.current) < 0.005) return;
    shown.current = zoom;
    rf.zoomTo(zoom, { duration: still() ? 0 : 160 });
  }, [zoom, rf]);
  // Fits the whole picture, as large as fits (at most 100%, at least `smallest`). One that still can't fit starts at
  // its top-left, where a call starts, as a page does; the overview shows the rest. Returns the zoom it reached.
  const showAll = useCallback(
    async (smallest, duration) => {
      const under = toolbarRoom(box.current);
      await rf.fitView({
        padding: { top: `${under}px`, right: '24px', bottom: `${OVER_ZOOMBAR}px`, left: '24px' },
        minZoom: smallest,
        maxZoom: 1,
        duration,
      });
      const z = rf.getZoom();
      const all = rf.getNodes();
      const el = box.current;
      if (!all.length || !el) return clampZoom(z);
      const left = Math.min(...all.map((n) => n.position.x));
      const top = Math.min(...all.map((n) => n.position.y));
      const right = Math.max(...all.map((n) => n.position.x + (n.width || 0)));
      const bottom = Math.max(...all.map((n) => n.position.y + (n.height || 0)));
      if ((right - left) * z > el.clientWidth - 48 || (bottom - top) * z > el.clientHeight - under - OVER_ZOOMBAR)
        await rf.setViewport({ x: 24 - left * z, y: under - top * z, zoom: z }, { duration });
      return clampZoom(z);
    },
    [rf],
  );

  // what the page can ask of the view
  useEffect(() => {
    if (!viewportRef) return undefined;
    viewportRef.current = {
      // everything in sight (at most 100%); returns the zoom it reached
      fit: async () => {
        shown.current = await showAll(MIN_ZOOM, still() ? 0 : 200);
        return shown.current;
      },
      // the middle of what is in sight, in the picture's own measure (where a new note goes)
      center: () => {
        const box = document.querySelector('.wfScroll')?.getBoundingClientRect();
        return box ? rf.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 }) : { x: 200, y: 200 };
      },
      // bring a block into sight (one just added), moving the view only as far as needed
      reveal: (id) => {
        const n = rf.getNode(id);
        const box = document.querySelector('.wfScroll')?.getBoundingClientRect();
        if (!n || !box) return;
        const { x, y, zoom: z } = rf.getViewport();
        const w = (n.width || 0) * z;
        const h = (n.height || 0) * z;
        const left = n.position.x * z + x;
        const top = n.position.y * z + y;
        if (left >= 0 && top >= 0 && left + w <= box.width && top + h <= box.height) return;
        rf.setCenter(n.position.x + (n.width || 0) / 2, n.position.y + (n.height || 0) / 2, { zoom: z, duration: still() ? 0 : 200 });
      },
      // bring something drawn over the picture (the ＋ menu, the delete question) wholly into sight, moving as little
      // as needed and clear of the toolbar; one larger than the box starts at its top-left
      keepInSight: (el) => {
        const scroll = document.querySelector('.wfScroll');
        const box = scroll?.getBoundingClientRect();
        if (!box || !el?.getBoundingClientRect().width) return;
        const room = { left: box.left + 12, right: box.right - 12, top: box.top + toolbarRoom(scroll) - 8, bottom: box.bottom - 12 };
        // one taller than the box scrolls inside (a long list of tools in a short window)
        if (el.scrollHeight > room.bottom - room.top) el.style.maxHeight = `${Math.max(160, Math.floor(room.bottom - room.top))}px`;
        const r = el.getBoundingClientRect();
        const dx = r.left < room.left || r.width > room.right - room.left ? room.left - r.left : r.right > room.right ? room.right - r.right : 0;
        const dy = r.top < room.top || r.height > room.bottom - room.top ? room.top - r.top : r.bottom > room.bottom ? room.bottom - r.bottom : 0;
        if (!dx && !dy) return;
        const { x, y, zoom: z } = rf.getViewport();
        rf.setViewport({ x: Math.round(x + dx), y: Math.round(y + dy), zoom: z }, { duration: still() ? 0 : 160 });
      },
    };
    return () => {
      viewportRef.current = null;
    };
  }, [rf, viewportRef, showAll]);

  // The overview shows only while part of the picture is out of sight (otherwise it would just cover a block), in a
  // corner clear of blocks, re-chosen when the view stops so it doesn't jump about; none if every corner is taken.
  const [overview, setOverview] = useState(null);
  const placeOverview = useCallback(() => {
    const { w, h } = boxSize;
    if (!w) return;
    const { x, y, zoom: z } = rf.getViewport();
    const blocks = nodes.map((n) => ({ x: n.x * z + x, y: n.y * z + y, w: n.w * z, h: n.h * z }));
    if (blocks.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h)) {
      setOverview(null);
      return;
    }
    const mw = OVERVIEW.w + 2 * OVERVIEW.margin;
    const mh = OVERVIEW.h + 2 * OVERVIEW.margin;
    const corners = { 'bottom-right': [w - mw, h - mh], 'top-right': [w - mw, 0], 'bottom-left': [0, h - mh] };
    const free = Object.entries(corners).find(([, [cx, cy]]) => !blocks.some((r) => overlaps(r, { x: cx, y: cy, w: mw, h: mh })));
    setOverview(free ? free[0] : null);
  }, [boxSize, nodes, rf]);
  useEffect(placeOverview, [placeOverview]);

  const picture = useMemo(
    () => ({
      selected,
      badges,
      routes,
      markerId,
      onNodeKey,
      onOpen: (id) => openRef.current?.(id),
      onNodeFocus: (id) => viewportRef?.current?.reveal?.(id),
      onPort: (agentId, port) => onPort?.(agentId, port),
      onNoteEdit: (id) => onSelect({ type: 'note', id, edit: true }),
      onNoteResize: (id, p, done) => {
        const size = { id, x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) };
        if (!done) setSizing(size);
        else {
          setSizing(null);
          noteChangeRef.current?.(id, { x: size.x, y: size.y, w: size.w, h: size.h });
        }
      },
      plugged,
      showPlugs,
      onPress: (event, n) => {
        if (event.button === 0) press.current = { id: n.id, x: event.clientX, y: event.clientY };
      },
      dragging: live ? Object.keys(live)[0] : '',
    }),
    // onNodeKey reads `selected`, which is in the list
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, badges, routes, markerId, live, plugged, showPlugs],
  );

  return (
    <Picture.Provider value={picture}>
      <div className="wfScroll" data-testid="workflow-canvas" data-overview={overview || undefined} ref={box}>
        <Controls overlay={overlay} nodes={byId} />
        <svg className="wfMarkers" width="0" height="0" aria-hidden="true">
          <defs>
            {Object.keys(KIND_WORDS).map((kind) => (
              <marker
                key={kind}
                id={`${markerId}-${kind}`}
                viewBox="0 0 12 12"
                refX="10"
                refY="6"
                markerWidth="12"
                markerHeight="12"
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path className={`wfArrow ${kind}`} d="M 2 2 L 10 6 L 2 10" fill="none" />
              </marker>
            ))}
          </defs>
        </svg>
        <ReactFlow
          nodes={allNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={(event, n) => onSelect({ type: n.type === 'note' ? 'note' : 'node', id: n.id })}
          onEdgeClick={(event, e) => onSelect({ type: 'edge', id: e.id })}
          onPaneClick={() => onSelect(null)}
          className={connecting ? 'wfConnecting' : ''}
          onConnectStart={() => setConnecting(true)}
          onConnectEnd={() => setConnecting(false)}
          onConnect={({ source, target }) => source && target && source !== target && onConnectAgents?.(source, target)}
          isValidConnection={({ source, target }) => source !== target && agents.has(source) && agents.has(target)}
          // report zooms the person made (pinch, Ctrl and wheel, overview); the page already knows its own
          onMoveEnd={(event, viewport) => {
            placeOverview();
            if (!event) return;
            shown.current = clampZoom(viewport.zoom);
            onZoom?.(shown.current, true);
          }}
          // first visit: fit the picture to the window (never below a readable size); after that, the zoom is kept
          onInit={async () => {
            if (!autoFit) return;
            shown.current = await showAll(0.75, 0);
            onZoom?.(shown.current, false);
            placeOverview();
          }}
          defaultViewport={{ x: 24, y: UNDER_TOOLBAR, zoom }}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          nodeExtent={[
            [EDGE, EDGE],
            [Infinity, Infinity],
          ]}
          nodeDragThreshold={DRAG_FROM}
          nodeClickDistance={DRAG_FROM}
          paneClickDistance={DRAG_FROM}
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          disableKeyboardA11y
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          panActivationKeyCode={null}
          zoomActivationKeyCode={null}
          connectionRadius={36}
          // the React Flow link sits lower right, clear of the zoom and Test the agent (above the overview if shown)
          attributionPosition="bottom-right"
          aria-label="The workflow: where a call starts, the agents, and the ways a caller moves on"
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--line2)" />
          {overview && (
            <MiniMap
              className="wfMiniMap"
              position={overview}
              style={{ width: OVERVIEW.w, height: OVERVIEW.h }}
              pannable
              zoomable
              ariaLabel="Overview of the whole workflow"
              nodeBorderRadius={6}
              nodeClassName={(n) => `wfMiniNode ${n.data?.n?.type || ''}`}
            />
          )}
          <ViewportPortal>
            {/* the words on the arrows are drawn above the blocks, so a block never hides them */}
            <svg className="wfLabels" width={bounds.w} height={bounds.h} role="presentation" aria-hidden="true">
              {flow.edges.map((edge) => {
                const spot = spots.get(edge.id);
                if (!spot) return null;
                const { label, lines, w, h, missing } = spot;
                return (
                  <g key={edge.id} className={`wfEdge ${edge.kind} ${selected?.type === 'edge' && selected.id === edge.id ? 'sel' : ''}`}>
                    <g
                      className={`wfEdgeLabel ${missing ? 'missing' : ''}`}
                      transform={`translate(${spot.x} ${spot.y})`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect({ type: 'edge', id: edge.id });
                      }}
                    >
                      <title>{missing ? 'Nothing says when the agent passes the caller on: select it to say when.' : edge.full || label}</title>
                      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={lines.length > 1 ? 9 : h / 2} />
                      {missing && (
                        <g className="wfEdgeFlag" transform={`translate(${-w / 2 + 13} 0)`}>
                          <circle r="6.5" />
                          <path d="M0 -3.2V0.8M0 3.1v0.1" />
                        </g>
                      )}
                      <text textAnchor="middle" dx={missing ? 9 : 0}>
                        {(missing ? [label] : lines).map((line, i, all) => (
                          <tspan key={i} x={missing ? 9 : 0} y={(i - (all.length - 1) / 2) * LABEL.line + 4}>
                            {line}
                          </tspan>
                        ))}
                      </text>
                    </g>
                  </g>
                );
              })}
            </svg>
          </ViewportPortal>
        </ReactFlow>
      </div>
    </Picture.Provider>
  );
}

export default function WorkflowCanvas(props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
