import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { routeEdge } from './geometry.js';

// The picture itself: a block for where a call starts, for each agent and for what goes with it, an arrow for each way the caller moves on. Blocks are
// dragged to where they read best (or moved with the arrow keys), the way an arrow runs follows them, and the empty space is dragged to move the view.
// It draws what it is given and reports what the person did; it never edits the configuration itself.
const ICON = { start: 'flag', agent: 'subagent', say: 'quote', state: 'pencil', transfer: 'phoneTransfer', tool: 'tools', end: 'endCall', step: 'sliders' };
const KIND_WORDS = {
  start: 'Start',
  handoff: 'Hands over',
  tool: 'Through a tool',
  rule: 'Under a safety rule',
  return: 'Back to the start',
  enter: 'Runs first',
  exit: 'Can do',
  uses: 'Can use',
};
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.6;
export const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));

const nodeWords = (n) => {
  if (n.type === 'start') return 'Start: where a call begins';
  if (n.type === 'agent') return `${n.label}, subagent${n.entry ? ', answers first' : ''}${n.stranded ? ', cannot be reached from Start' : ''}`;
  return `${n.label}${n.sub ? `: ${n.sub}` : ''}`;
};

export default function WorkflowCanvas({ flow, selected, onSelect, onMove, zoom, onZoom, badges, overlay, onDeleteKey, viewportRef }) {
  const [live, setLiveState] = useState(null);
  const liveRef = useRef(null); // the latest places while dragging, readable the moment the button is let go (state may not have caught up)
  const setLive = (value) => {
    liveRef.current = value;
    setLiveState(value);
  };
  const drag = useRef(null);
  const pan = useRef(null);
  const scroller = useRef(null);
  const markerId = useId().replace(/:/g, '');

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

  // ctrl + wheel zooms; the listener is not passive because it has to stop the page from zooming as well
  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const onWheel = (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        onZoom(clampZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1)));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, onZoom]);

  const followers = (node) => (node.type === 'agent' ? flow.nodes.filter((n) => n.agent === node.id && !n.moved) : []);

  const startDrag = (event, node) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      id: node.id,
      sx: event.clientX,
      sy: event.clientY,
      ox: node.x,
      oy: node.y,
      moved: false,
      follow: followers(node).map((n) => ({ id: n.id, x: n.x, y: n.y })),
    };
  };
  const moveDrag = (event) => {
    const d = drag.current;
    if (!d) return;
    const dx = (event.clientX - d.sx) / zoom;
    const dy = (event.clientY - d.sy) / zoom;
    if (!d.moved && Math.hypot(dx, dy) * zoom < 4) return;
    d.moved = true;
    const x = Math.max(8, d.ox + dx);
    const y = Math.max(8, d.oy + dy);
    const next = { [d.id]: { x, y } };
    d.follow.forEach((f) => {
      next[f.id] = { x: Math.max(8, f.x + (x - d.ox)), y: Math.max(8, f.y + (y - d.oy)) };
    });
    setLive(next);
  };
  const endDrag = (event, node) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    // only the block that was dragged gets a place of its own; the blocks that went with it follow it from where it now is
    const last = liveRef.current;
    if (d.moved && last && last[d.id]) {
      onMove({ [d.id]: last[d.id] });
      setLive(null);
    } else {
      setLive(null);
      onSelect({ type: 'node', id: node.id });
    }
  };
  // the system took the pointer away (a touch turned into a scroll, the window lost focus): nothing was dropped, so nothing moves
  const cancelDrag = (event) => {
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setLive(null);
  };

  const startPan = (event) => {
    if (event.button !== 0 || event.target.closest('.wfNode, .wfOverlayItem, .wfEdgeHit, .wfEdgeLabel')) return;
    pan.current = { x: event.clientX, y: event.clientY, left: scroller.current.scrollLeft, top: scroller.current.scrollTop, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const movePan = (event) => {
    const p = pan.current;
    if (!p) return;
    const dx = event.clientX - p.x;
    const dy = event.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < 4) return;
    p.moved = true;
    scroller.current.scrollLeft = p.left - dx;
    scroller.current.scrollTop = p.top - dy;
  };
  const endPan = () => {
    const p = pan.current;
    pan.current = null;
    if (p && !p.moved) onSelect(null);
  };

  const onNodeKey = (event, node) => {
    const step = event.shiftKey ? 32 : 8;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect({ type: 'node', id: node.id });
      return;
    }
    if (arrows[event.key] && selected?.type === 'node' && selected.id === node.id) {
      event.preventDefault();
      const [dx, dy] = arrows[event.key];
      onMove({ [node.id]: { x: Math.max(8, node.x + dx), y: Math.max(8, node.y + dy) } }, { group: `key:${node.id}` });
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && node.type !== 'start') {
      event.preventDefault();
      onDeleteKey(node.id);
    }
  };

  const selectedEdge = selected?.type === 'edge' ? selected.id : '';
  return (
    <div
      className="wfScroll"
      ref={(el) => {
        scroller.current = el;
        if (viewportRef) viewportRef.current = el;
      }}
      data-testid="workflow-canvas"
    >
      <div
        className="wfScaler"
        style={{ width: bounds.w * zoom, height: bounds.h * zoom }}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={() => {
          pan.current = null;
        }}
      >
        {/* the controls of the selected block are drawn at their own size, outside the scaled picture, and come first in the tab order */}
        {overlay && overlay({ nodes: byId, zoom })}
        <div className="wfStage" style={{ width: bounds.w, height: bounds.h, transform: `scale(${zoom})` }}>
          <svg className="wfEdges" width={bounds.w} height={bounds.h} role="presentation" aria-hidden="true">
            <defs>
              {Object.keys(KIND_WORDS).map((kind) => (
                <marker key={kind} id={`${markerId}-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                  <path className={`wfArrow ${kind}`} d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
              ))}
            </defs>
            {flow.edges.map((edge) => {
              const a = byId.get(edge.from);
              const b = byId.get(edge.to);
              if (!a || !b) return null;
              const g = routeEdge(a, b, { ...lanes.get(edge.id), kind: edge.kind });
              const on = selectedEdge === edge.id;
              return (
                <g key={edge.id} className={`wfEdge ${edge.kind} ${on ? 'sel' : ''}`}>
                  <path className="wfEdgeLine" d={g.d} fill="none" markerEnd={`url(#${markerId}-${edge.kind})`} />
                  <path
                    className="wfEdgeHit"
                    d={g.d}
                    fill="none"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect({ type: 'edge', id: edge.id });
                    }}
                  >
                    <title>{`${KIND_WORDS[edge.kind]}${edge.full || edge.label ? `: ${edge.full || edge.label}` : ''}`}</title>
                  </path>
                </g>
              );
            })}
          </svg>
          {nodes.map((n) => {
            const on = selected?.type === 'node' && selected.id === n.id;
            const problems = badges?.get(n.id) || 0;
            return (
              <div
                key={n.id}
                className={`wfNode ${n.type} ${on ? 'sel' : ''} ${n.entry ? 'entry' : ''} ${n.missing ? 'missing' : ''} ${n.stranded ? 'stranded' : ''} ${live && live[n.id] ? 'dragging' : ''}`}
                style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                aria-label={nodeWords(n)}
                data-node={n.id}
                data-type={n.type}
                onPointerDown={(event) => startDrag(event, n)}
                onPointerMove={moveDrag}
                onPointerUp={(event) => endDrag(event, n)}
                onPointerCancel={cancelDrag}
                onKeyDown={(event) => onNodeKey(event, n)}
              >
                <span className="wfIcon" aria-hidden="true">
                  <Icon name={ICON[n.type] || 'sliders'} size={n.type === 'agent' ? 20 : 18} />
                </span>
                <span className="wfText">
                  <strong>{n.label}</strong>
                  {n.type !== 'start' && n.sub && <small>{n.sub}</small>}
                  {n.type === 'agent' && (
                    <small className="wfMeta">
                      {n.entry ? <b>Answers first</b> : null}
                      {n.stranded ? <b className="wfWarnText">Not reachable from Start</b> : null}
                      {n.entry || n.stranded ? ' · ' : ''}
                      {n.detail}
                    </small>
                  )}
                </span>
                {problems > 0 && (
                  <b className="wfBadge" title={`${problems} problem${problems === 1 ? '' : 's'} to fix`}>
                    {problems}
                  </b>
                )}
              </div>
            );
          })}
          {/* the words on the arrows are drawn above the blocks, so a block never hides them */}
          <svg className="wfLabels" width={bounds.w} height={bounds.h} role="presentation" aria-hidden="true">
            {flow.edges.map((edge) => {
              const a = byId.get(edge.from);
              const b = byId.get(edge.to);
              const label = edge.label && edge.kind !== 'start' ? edge.label : '';
              if (!a || !b || !label) return null;
              const g = routeEdge(a, b, { ...lanes.get(edge.id), kind: edge.kind });
              return (
                <g key={edge.id} className={`wfEdge ${edge.kind} ${selectedEdge === edge.id ? 'sel' : ''}`}>
                  <g
                    className="wfEdgeLabel"
                    transform={`translate(${g.lx} ${g.ly})`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect({ type: 'edge', id: edge.id });
                    }}
                  >
                    <rect x={-(label.length * 3.3 + 8)} y="-10" width={label.length * 6.6 + 16} height="20" rx="10" />
                    <text textAnchor="middle" dy="4">
                      {label}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
