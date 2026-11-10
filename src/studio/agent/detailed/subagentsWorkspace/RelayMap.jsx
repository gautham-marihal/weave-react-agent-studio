import React, { useLayoutEffect, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import { relayOf } from './subagentsWords.js';

// The relay of an agent's team (canvas board S1), drawn from its own configuration: the agent that answers first, its
// subagents, and who is beyond this agent (another agent of the workspace, a person). A line for each hand-over; a
// subagent's hand-over to another goes round the right of the column; the ways back to the first are dashed; a line
// leaving the agent arcs over the top, so it never crosses a subagent. One agent alone shows the way to add one.
// The lines are measured from the nodes as laid out, so they fit any width.

const initialsOf = (name) =>
  (name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

export default function RelayMap({ config, workspace, name, onAgent, onBeyond, onAdd }) {
  const box = useRef(null);
  const [paths, setPaths] = useState([]);
  const relay = relayOf(config, workspace);
  const key = JSON.stringify([relay.subs.map((s) => s.key), relay.lines, relay.back, relay.beyond.map((b) => b.key)]);
  useLayoutEffect(() => {
    const draw = () => {
      const root = box.current;
      if (!root) return;
      const b = root.getBoundingClientRect();
      const at = (id) => root.querySelector(`[data-node="${id}"]`)?.getBoundingClientRect();
      const x = (v) => v - b.left;
      const y = (v) => v - b.top;
      const next = [];
      relay.lines.forEach((l) => {
        const from = at(l.from);
        const to = at(l.to);
        if (!from || !to) return;
        if (l.from === 'first') {
          const a = [x(from.right), y(from.top + from.height / 2)];
          const z = [x(to.left), y(to.top + to.height / 2)];
          const mid = (a[0] + z[0]) / 2;
          next.push({ k: l.key, d: `M${a[0]} ${a[1]} C${mid} ${a[1]} ${mid} ${z[1]} ${z[0]} ${z[1]}`, cls: 'on' });
        } else {
          // between two subagents: round the right of the column
          const a = [x(from.right), y(from.top + from.height / 2)];
          const z = [x(to.right), y(to.top + to.height / 2)];
          const out = Math.max(a[0], z[0]) + 34;
          next.push({ k: l.key, d: `M${a[0]} ${a[1]} C${out} ${a[1]} ${out} ${z[1]} ${z[0] + 2} ${z[1]}`, cls: 'on' });
        }
      });
      const first = at('first');
      relay.back.forEach((id) => {
        const from = at(id);
        if (!from || !first) return;
        const a = [x(from.left), y(from.top + from.height * 0.72)];
        const z = [x(first.right), y(first.top + first.height * 0.78)];
        const mid = (a[0] + z[0]) / 2;
        next.push({ k: `back-${id}`, d: `M${a[0]} ${a[1]} C${mid} ${a[1]} ${mid} ${z[1]} ${z[0]} ${z[1]}`, cls: 'back' });
      });
      relay.beyond.forEach((o) => {
        const from = at(o.fromNode);
        const to = at(o.node);
        if (!from || !to) return;
        // over the top of everything between them
        const top = 6;
        const a = [x(from.left + from.width * 0.8), y(from.top)];
        const z = [x(to.left), y(to.top + to.height / 2)];
        next.push({
          k: `out-${o.key}`,
          d: `M${a[0]} ${a[1]} C${a[0]} ${top} ${z[0] - 60} ${top} ${z[0] - 30} ${top + 16} S${z[0] - 18} ${z[1]} ${z[0]} ${z[1]}`,
          cls: 'out',
        });
      });
      setPaths(next);
    };
    draw();
    const ro = new ResizeObserver(draw);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const firstNode = (
    <button type="button" className="saNode first" data-node="first" onClick={() => relay.first && onAgent(relay.first.key)}>
      <span className="saAvatar" aria-hidden="true">
        {initialsOf(relay.first?.name || name)}
      </span>
      <span className="cxText">
        <b>{relay.first?.name || name}</b>
        <small>{relay.subs.length ? 'answers first' : 'answers every call itself'}</small>
      </span>
    </button>
  );
  if (!relay.subs.length)
    return (
      <div className="saRelay alone">
        {firstNode}
        <span className="cxDash" aria-hidden="true" />
        <button type="button" className="cxNode more" onClick={onAdd}>
          <Icon name="plus" size={14} />
          Add a subagent to pass callers to
        </button>
      </div>
    );
  return (
    <figure className="cxFigure">
      <div className="saRelay" ref={box}>
        <svg className="cxLines saLines" aria-hidden="true">
          <defs>
            <marker id="sa-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0L8 4L0 8z" />
            </marker>
          </defs>
          {paths.map((p) => (
            <path key={p.k} className={p.cls} d={p.d} markerEnd={p.cls === 'back' ? undefined : 'url(#sa-arrow)'} />
          ))}
        </svg>
        <div className="cxCol">
          <span className="cxColHead">Answers first</span>
          {firstNode}
        </div>
        <div className="cxCol">
          <span className="cxColHead">Its subagents</span>
          {relay.subs.map((s, i) => (
            <button key={s.key} type="button" className={`cxNode ${s.state ? 'bad' : ''}`} data-node={`s${i}`} onClick={() => onAgent(s.key)}>
              <span className="cxIcon" aria-hidden="true">
                <Icon name="subagent" size={14} />
              </span>
              <span className="cxText">
                <b>{s.name}</b>
                <small>{s.state ? s.state.why : `${s.kind.toLowerCase()} · ${s.tools ? `${s.tools} ${s.tools === 1 ? 'tool' : 'tools'}` : 'no tools'}`}</small>
              </span>
              <i className={`cxDot ${s.state ? 'bad' : 'good'}`} aria-hidden="true" />
              {s.state && <span className="srOnly"> (needs a look)</span>}
            </button>
          ))}
          {relay.more > 0 && <span className="cxNode more quiet">+ {relay.more} more subagents</span>}
        </div>
        <div className="cxCol">
          <span className="cxColHead">Beyond this agent</span>
          {relay.beyond.map((o) => (
            <button key={o.key} type="button" className="cxNode out" data-node={o.node} onClick={() => onBeyond(o)}>
              <span className="cxIcon" aria-hidden="true">
                <Icon name={o.to === 'agent' ? 'phoneTransfer' : 'user'} size={14} />
              </span>
              <span className="cxText">
                <b>{o.toName}</b>
                <small>{o.to === 'agent' ? 'another agent · its number' : 'set on Tools · Pass to a person'}</small>
              </span>
            </button>
          ))}
          {!relay.beyond.length && <span className="cxNode more quiet">Nobody beyond it yet</span>}
        </div>
      </div>
      <figcaption className="cxLegend">
        {relay.lines.length > 0 && (
          <span>
            <i className="solid" aria-hidden="true" />
            passes callers on
          </span>
        )}
        {relay.back.length > 0 && (
          <span>
            <i className="dashed" aria-hidden="true" />
            sends them back to the first
          </span>
        )}
        {relay.beyond.length > 0 && (
          <span>
            <i className="solid ext" aria-hidden="true" />
            leaves this agent
          </span>
        )}
      </figcaption>
    </figure>
  );
}
