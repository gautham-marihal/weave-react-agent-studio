import React, { useLayoutEffect, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import { reachMap } from './connectionsWords.js';

// The picture of what an agent reaches (canvas board N1), drawn from its own configuration: the agent, the things that
// reach out (tools, transfers, forms, messages, tasks, reactions, a search service), and the systems they reach, with a
// line for each. The busiest come first and the rest are counted. A system set up but reached by nothing yet still has
// its line, dashed, through one "nothing uses it yet" node that leads to where something can use it (Tools). Each node
// opens its own page; lit: the system whose lines are drawn bold. The lines are measured from the nodes as laid out, so
// they fit any width.

const initialsOf = (name) =>
  (name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

const curve = (from, to) => {
  const mid = (from[0] + to[0]) / 2;
  return `M${from[0]} ${from[1]} C${mid} ${from[1]} ${mid} ${to[1]} ${to[0]} ${to[1]}`;
};

export default function ReachMap({ config, name, agentWords, lit = null, onSystem, onUser, onAdd, onIdle }) {
  const box = useRef(null);
  const [paths, setPaths] = useState([]);
  const map = reachMap(config);
  const idle = map.idle;
  const key = JSON.stringify([map.users.map((u) => u.key), map.systems.map((s) => s.id), map.edges, idle]);
  useLayoutEffect(() => {
    const draw = () => {
      const root = box.current;
      if (!root) return;
      const b = root.getBoundingClientRect();
      const at = (sel) => root.querySelector(sel)?.getBoundingClientRect();
      const right = (r) => [r.right - b.left, r.top + r.height / 2 - b.top];
      const left = (r) => [r.left - b.left, r.top + r.height / 2 - b.top];
      const agent = at('[data-node="agent"]');
      const next = [];
      // the agent to each thing that reaches out, and to the "nothing uses it yet" node
      map.users.forEach((u, i) => {
        const r = at(`[data-node="u${i}"]`);
        if (agent && r) next.push({ k: `a${i}`, d: curve(right(agent), left(r)), cls: 'quiet' });
      });
      const waiting = at('[data-node="idle"]');
      if (agent && waiting) next.push({ k: 'a-idle', d: curve(right(agent), left(waiting)), cls: 'idle' });
      // what reaches out to the systems it reaches
      map.edges.forEach(([ui, si]) => {
        const u = at(`[data-node="u${ui}"]`);
        const s = at(`[data-node="s${si}"]`);
        if (u && s) next.push({ k: `e${ui}-${si}`, d: curve(right(u), left(s)), cls: lit === map.systems[si].id ? 'lit' : '' });
      });
      // and the systems nothing reaches yet
      idle.forEach((si) => {
        const s = at(`[data-node="s${si}"]`);
        if (waiting && s) next.push({ k: `i${si}`, d: curve(right(waiting), left(s)), cls: lit === map.systems[si].id ? 'idle lit' : 'idle' });
      });
      setPaths(next);
    };
    draw();
    const ro = new ResizeObserver(draw);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [key, lit]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!map.systems.length)
    return (
      <div className="cxMap empty">
        <div className="cxNode agent" data-node="agent">
          <span className="cxAgent">
            <i aria-hidden="true">{initialsOf(name)}</i>
            {name}
          </span>
          <small>only talks, for now</small>
        </div>
        <span className="cxDash" aria-hidden="true" />
        <button type="button" className="cxNode more" onClick={onAdd}>
          <Icon name="plus" size={14} />
          Add a system it should reach
        </button>
      </div>
    );

  const idleWords =
    idle.length === map.systems.length
      ? idle.length === 1
        ? 'Nothing uses it yet'
        : 'Nothing uses them yet'
      : `Nothing uses ${idle.length === 1 ? '1' : idle.length} yet`;
  return (
    <figure className="cxFigure">
      <div className="cxMap" ref={box}>
        <svg className="cxLines" aria-hidden="true">
          {paths.map((p) => (
            <path key={p.k} className={p.cls} d={p.d} />
          ))}
        </svg>
        <div className="cxCol">
          <span className="cxColHead">Your agent</span>
          <div className="cxNode agent" data-node="agent">
            <span className="cxAgent">
              <i aria-hidden="true">{initialsOf(name)}</i>
              {name}
            </span>
            {agentWords && <small>{agentWords}</small>}
          </div>
        </div>
        <div className="cxCol">
          <span className="cxColHead">What reaches out</span>
          {map.users.map((u, i) => (
            <button key={`${u.list}:${u.key}`} type="button" className="cxNode" data-node={`u${i}`} onClick={() => onUser(u)}>
              <span className="cxIcon" aria-hidden="true">
                <Icon name={u.icon} size={14} />
              </span>
              <span className="cxText">
                <b>{u.name}</b>
                <small>{u.kind}</small>
              </span>
            </button>
          ))}
          {map.moreUsers > 0 && <span className="cxNode more quiet">+ {map.moreUsers} more that reach out</span>}
          {idle.length > 0 && (
            <button type="button" className="cxNode idle" data-node="idle" onClick={onIdle}>
              <span className="cxIcon" aria-hidden="true">
                <Icon name="plus" size={14} />
              </span>
              <span className="cxText">
                <b>{idleWords}</b>
                <small>give it to a tool or a step</small>
              </span>
            </button>
          )}
        </div>
        <div className="cxCol">
          <span className="cxColHead">Systems it reaches</span>
          {map.systems.map((s, i) => {
            const unused = idle.includes(i);
            const tone = unused && s.state.tone === 'good' ? 'idle' : s.state.tone;
            return (
              <button key={s.id} type="button" className={`cxNode ${lit === s.id ? 'lit' : ''} ${tone}`} data-node={`s${i}`} onClick={() => onSystem(s.id)}>
                <span className="cxIcon" aria-hidden="true">
                  <Icon name={s.icon} size={14} />
                </span>
                <span className="cxText">
                  <b>{s.name}</b>
                  <small>{s.meta}</small>
                </span>
                <i className={`cxDot ${tone}`} aria-hidden="true" />
                <span className="srOnly"> ({unused && s.state.tone === 'good' ? 'Ready, not used yet' : s.state.words})</span>
              </button>
            );
          })}
          {map.moreSystems > 0 && <span className="cxNode more quiet">+ {map.moreSystems} more systems</span>}
        </div>
      </div>
      <figcaption className="cxLegend">
        {map.edges.length > 0 && (
          <span>
            <i className="solid" aria-hidden="true" />
            reaches it
          </span>
        )}
        {idle.length > 0 && (
          <span>
            <i className="dashed" aria-hidden="true" />
            set up, but nothing reaches it yet
          </span>
        )}
        <span>
          <i className="dot good" aria-hidden="true" />
          ready
        </span>
        {idle.some((i) => map.systems[i].state.tone === 'good') && (
          <span>
            <i className="dot idle" aria-hidden="true" />
            ready, not used yet
          </span>
        )}
        {map.systems.some((s) => s.state.tone === 'bad') && (
          <span>
            <i className="dot bad" aria-hidden="true" />
            needs a look
          </span>
        )}
        {map.systems.some((s) => s.state.tone === 'warn') && (
          <span>
            <i className="dot warn" aria-hidden="true" />
            worth a look
          </span>
        )}
      </figcaption>
    </figure>
  );
}
