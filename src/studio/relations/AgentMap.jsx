import React, { useId } from 'react';
import { useConfigSelect } from '../form/ctx.js';
import { NODE, buildAgentMap, describeEdges } from './agentMap.js';

// The agents of an assistant as a picture: a box for each, an arrow for each hand-over, the one that answers first marked. Clicking a box opens that
// agent in the form. It reads the configuration through a selector, so typing in a text box elsewhere doesn't redraw it; only a change to who hands
// over to whom does. The same information is available as sentences under "As a list", for anyone who can't use the picture.
const KIND_WORDS = { handoff: 'Hands over', tool: 'Through a tool', rule: 'Under a safety rule' };

function edgePath(from, to) {
  const forward = to.column > from.column;
  if (forward) {
    const x1 = from.x + NODE.width; const y1 = from.y + NODE.height / 2; const x2 = to.x; const y2 = to.y + NODE.height / 2;
    const dx = Math.max(36, (x2 - x1) / 2);
    return { d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2 - 2} ${y2}`, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2 - 5 };
  }
  // back to an earlier column, or down the same one: out of the bottom of one box and into the bottom of the other
  const x1 = from.x + NODE.width / 2; const y1 = from.y + NODE.height; const x2 = to.x + NODE.width / 2; const y2 = to.y + NODE.height;
  const drop = 34 + Math.abs(from.row - to.row) * 6;
  return { d: `M ${x1} ${y1} C ${x1} ${y1 + drop}, ${x2} ${y2 + drop}, ${x2} ${y2 + 2}`, lx: (x1 + x2) / 2, ly: Math.max(y1, y2) + drop * 0.75 };
}

export default function AgentMap({ onOpenAgent }) {
  const map = useConfigSelect(buildAgentMap);
  const markerId = useId().replace(/:/g, '');
  if (map.nodes.length < 2) return null;
  const nodeOf = (id) => map.nodes.find((n) => n.id === id);
  const sentences = describeEdges(map);
  return (
    <section className="rlMap" aria-label="How callers move between agents">
      <header>
        <h4>How callers move between agents</h4>
        <p>The agent that answers first has a bold border. Pick an agent to open it.</p>
      </header>
      <div className="rlMapScroll">
        <div className="rlMapStage" style={{ width: map.width, height: map.height + 36 }}>
          <svg className="rlMapEdges" width={map.width} height={map.height + 36} role="presentation" aria-hidden="true">
            <defs>
              <marker id={`${markerId}-a`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker>
            </defs>
            {map.edges.map((edge, i) => {
              const from = nodeOf(edge.from); const to = nodeOf(edge.to);
              if (!from || !to) return null;
              const geometry = edge.self ? { d: `M ${from.x + NODE.width - 16} ${from.y} C ${from.x + NODE.width + 28} ${from.y - 26}, ${from.x + NODE.width + 28} ${from.y + 20}, ${from.x + NODE.width - 2} ${from.y + 14}`, lx: from.x + NODE.width + 6, ly: from.y - 16 } : edgePath(from, to);
              return (
                <g key={i} className={`rlEdge ${edge.kind}`}>
                  <path d={geometry.d} fill="none" strokeWidth="1.6" markerEnd={`url(#${markerId}-a)`} />
                  {edge.labels.length === 1 && edge.labels[0].length <= 22 && <text x={geometry.lx} y={geometry.ly} textAnchor="middle">{edge.labels[0]}</text>}
                  <title>{`${KIND_WORDS[edge.kind]}: ${edge.from} to ${edge.to}${edge.labels.length ? ` (${edge.labels.join(', ')})` : ''}`}</title>
                </g>
              );
            })}
          </svg>
          {map.nodes.map((n) => (
            <button key={n.id} type="button" className={`rlNode ${n.entry ? 'entry' : ''} ${n.reachable ? '' : 'stranded'}`} style={{ left: n.x, top: n.y, width: NODE.width, height: NODE.height }}
              aria-label={`${n.name}${n.entry ? ', answers first' : ''}${n.reachable ? '' : ', cannot be reached'}. Open it.`} onClick={() => onOpenAgent?.(n.index, n.id)}>
              <strong>{n.name}</strong>
              <small>{n.entry ? 'Answers first' : n.reachable ? (n.kind || 'Agent') : 'Not reachable'}</small>
            </button>
          ))}
        </div>
      </div>
      {map.unreachable.length > 0 && <p className="stFWarn" role="note">{map.unreachable.length === 1 ? `“${map.unreachable[0]}” can’t be reached` : `${map.unreachable.map((id) => `“${id}”`).join(', ')} can’t be reached`}: no hand-over leads to {map.unreachable.length === 1 ? 'it' : 'them'} from the agent that answers first.</p>}
      <div className="rlKey" aria-hidden="true"><span className="handoff">Hands over</span><span className="tool">Through a tool</span><span className="rule">Under a safety rule</span></div>
      {sentences.length > 0 && (
        <details className="rlList">
          <summary>As a list</summary>
          <ul>{sentences.map((s) => <li key={s}>{s}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
