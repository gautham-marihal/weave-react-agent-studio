import { useId, useMemo } from 'react';
import type { AgentConfig } from '../../../../types/studio';
import { MAP_NODE, buildAgentMap, describeEdges, type MapEdgeKind, type MapNode } from '../../../../models/relations';
import { cn } from '../../../../utils/styles';

// How callers move between an agent's agents, as a picture (models/relations.ts). Pressing a box opens that agent;
// “As a list” says the same in sentences for anyone who can't use the picture. Not drawn for a single agent.

const KIND_WORDS: Record<MapEdgeKind, string> = { handoff: 'Hands over', tool: 'Through a tool', rule: 'Under a safety rule' };
const STROKE: Record<MapEdgeKind, string> = { handoff: 'text-accent', tool: 'text-info', rule: 'text-warning' };

function edgePath(from: MapNode, to: MapNode): {d: string;lx: number;ly: number;anchor: 'start' | 'middle' | 'end';} {
  const { width: W, height: H } = MAP_NODE;
  if (to.column > from.column) {
    const x1 = from.x + W;
    const y1 = from.y + H / 2;
    const x2 = to.x;
    const y2 = to.y + H / 2;
    const dx = Math.max(36, (x2 - x1) / 2);
    return { d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2 - 2} ${y2}`, lx: x2 - 10, ly: y2 - 7, anchor: 'end' };
  }
  if (to.column === from.column && Math.abs(to.row - from.row) === 1) {
    const down = to.row > from.row;
    const x = from.x + W / 2;
    const y1 = down ? from.y + H : from.y;
    const y2 = down ? to.y : to.y + H;
    return { d: `M ${x} ${y1} L ${x} ${down ? y2 - 2 : y2 + 2}`, lx: x + 8, ly: (y1 + y2) / 2 + 4, anchor: 'start' };
  }
  // back to an earlier column, or further down the same one: out of one box's bottom and into the other's
  const x1 = from.x + W / 2;
  const y1 = from.y + H;
  const x2 = to.x + W / 2;
  const y2 = to.y + H;
  const drop = 34 + Math.abs(from.row - to.row) * 6;
  return { d: `M ${x1} ${y1} C ${x1} ${y1 + drop}, ${x2} ${y2 + drop}, ${x2} ${y2 + 2}`, lx: (x1 + x2) / 2, ly: Math.max(y1, y2) + drop * 0.75, anchor: 'middle' };
}

export function AgentMap({ config, onOpenAgent }: {config: AgentConfig;onOpenAgent?: (index: number, id: string) => void;}) {
  const map = useMemo(() => buildAgentMap(config), [config]);
  const marker = useId().replace(/:/g, '');
  if (map.nodes.length < 2) return null;
  const nodeOf = (id: string) => map.nodes.find((n) => n.id === id);
  const sentences = describeEdges(map);
  const drawn = map.edges.flatMap((edge) => {
    const from = nodeOf(edge.from);
    const to = nodeOf(edge.to);
    if (!from || !to) return [];
    const geometry = edge.self ?
    {
      d: `M ${from.x + MAP_NODE.width - 16} ${from.y} C ${from.x + MAP_NODE.width + 28} ${from.y - 26}, ${from.x + MAP_NODE.width + 28} ${from.y + 20}, ${from.x + MAP_NODE.width - 2} ${from.y + 14}`,
      lx: from.x + MAP_NODE.width + 6,
      ly: from.y - 16,
      anchor: 'start' as const
    } :
    edgePath(from, to);
    return [{ edge, from, to, geometry }];
  });
  const height = map.height + 36;
  return (
    <section aria-label="How callers move between agents" data-agent-map className="mb-8 rounded-lg border border-line bg-surface p-4 shadow-panel">
      <h3 className="text-sm font-semibold text-ink">How callers move between agents</h3>
      <p className="mt-0.5 text-[13px] text-muted">The agent that answers first has a thicker border. Press an agent to open it.</p>
      <div className="mt-3 overflow-x-auto">
        <div className="relative" style={{ width: map.width, height }}>
          <svg className="absolute inset-0" width={map.width} height={height} aria-hidden="true">
            <defs>
              <marker id={`${marker}-a`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
            </defs>
            {drawn.map(({ edge, from, to, geometry }, i) =>
            <g key={i} className={STROKE[edge.kind]} data-map-edge={edge.kind}>
                <path d={geometry.d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray={edge.kind === 'rule' ? '5 4' : edge.kind === 'tool' ? '2 3' : undefined} markerEnd={`url(#${marker}-a)`} />
                <title>{`${KIND_WORDS[edge.kind]}: ${from.name} to ${to.name}${edge.words.length ? ` (${edge.words.join(', ')})` : ''}`}</title>
              </g>
            )}
            {drawn.map(({ edge, geometry }, i) =>
            edge.words.length === 1 && edge.words[0].length <= 22 ?
            <text key={`t${i}`} x={geometry.lx} y={geometry.ly} textAnchor={geometry.anchor} className="fill-[rgb(var(--ink-soft))] text-[11px]">
                  {edge.words[0]}
                </text> :
            null
            )}
          </svg>
          {map.nodes.map((n) =>
          <button
            key={n.id}
            type="button"
            data-map-node={n.id}
            onClick={() => onOpenAgent?.(n.index, n.id)}
            aria-label={`${n.name}${n.entry ? ', answers first' : ''}${n.reachable ? '' : ', cannot be reached'}. Open it.`}
            style={{ left: n.x, top: n.y, width: MAP_NODE.width, height: MAP_NODE.height }}
            className={cn(
              'absolute flex flex-col items-start justify-center rounded-lg bg-surface px-3 text-left shadow-sm transition-colors duration-150 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              n.entry ? 'border-2 border-accent' : n.reachable ? 'border border-line-strong' : 'border border-dashed border-warning'
            )}>
              <strong className="w-full truncate text-[13px] font-semibold text-ink">{n.name}</strong>
              <small className={cn('text-xs', n.reachable ? 'text-muted' : 'text-warning')}>{n.entry ? 'Answers first' : n.reachable ? n.kind ? n.kind.replace(/_/g, ' ') : 'Agent' : 'Not reachable'}</small>
            </button>
          )}
        </div>
      </div>
      {map.unreachable.length > 0 &&
      <p role="note" className="mt-2 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-warning">
          {map.unreachable.map((id) => `“${map.nodes.find((n) => n.id === id)?.name ?? id}”`).join(', ')} can’t be reached: no hand-off leads to {map.unreachable.length === 1 ? 'it' : 'them'} from the agent that answers first.
        </p>
      }
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted" aria-hidden>
        {(Object.keys(KIND_WORDS) as MapEdgeKind[]).map((k) =>
        <span key={k} className="flex items-center gap-1.5">
            <svg width="22" height="6" className={STROKE[k]}><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="2" strokeDasharray={k === 'rule' ? '5 4' : k === 'tool' ? '2 3' : undefined} /></svg>
            {KIND_WORDS[k]}
          </span>
        )}
      </div>
      {sentences.length > 0 &&
      <details className="mt-2 text-[13px]">
          <summary className="cursor-pointer select-none text-ink-soft">As a list</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-soft">
            {sentences.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </details>
      }
    </section>);

}
