// How the parts of an agent relate, for the pictures that show it: which agent hands the caller to which (the agent
// map), who can use which tool (the grid), and the places that point at a tool, a fixed line, a remembered value or a
// connection ("used by"). Pure: no React, no DOM.
import type { AgentConfig, AgentRole, Path } from '../types/studio';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T = unknown,>(v: unknown): T[] => Array.isArray(v) ? v as T[] : [];
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const humanize = (id: string) => {
  const t = id.replace(/[_-]+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : id;
};

// ---- the agent map ----------------------------------------------------------------------------------------------------
/** Box sizes; gapX leaves room for the words of an arrow beside the box it points to. */
export const MAP_NODE = { width: 176, height: 60, gapX: 150, gapY: 26, pad: 16 };

export type MapEdgeKind = 'handoff' | 'tool' | 'rule';
export interface MapEdge {
  kind: MapEdgeKind;
  from: string;
  to: string;
  /** The ids behind it (a hand-off id, a tool id, a rule id), for anything that needs them; never shown. */
  labels: string[];
  /** What it says on the picture: who it goes to, the tool, “Safety rule”. */
  words: string[];
  title: string;
  self?: boolean;
}
export interface MapNode {
  id: string;
  name: string;
  kind: string;
  entry: boolean;
  reachable: boolean;
  /** Its place in agents.items. */
  index: number;
  column: number;
  row: number;
  x: number;
  y: number;
}
export interface AgentMap {
  nodes: MapNode[];
  edges: MapEdge[];
  entry: string;
  unreachable: string[];
  width: number;
  height: number;
}

type RawEdge = {kind: MapEdgeKind;from: string;to: string;label: string;word: string;title: string;self?: boolean;};

function handoffSteps(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => handoffSteps(v, out));else
  if (isObj(value)) {
    if (value.type === 'handoff' && typeof value.to === 'string') out.push(value.to);
    Object.values(value).forEach((v) => handoffSteps(v, out));
  }
  return out;
}

/** The agents as boxes in columns by distance from the one that answers first, and how callers move between them. */
export function buildAgentMap(config: AgentConfig): AgentMap {
  const all = list<AgentRole>(config?.agents?.items);
  const agents = all.filter((a) => isObj(a) && typeof a.id === 'string' && a.id !== '');
  const ids = new Set(agents.map((a) => a.id));
  const entry = ids.has(String(config?.agents?.entry)) ? String(config?.agents?.entry) : agents[0]?.id ?? '';
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name || id;
  const raw: RawEdge[] = [];
  const add = (edge: {kind: MapEdgeKind;from: string;to: string;label: string;word: string;title: string;}) => {
    if (!ids.has(edge.from) || !ids.has(edge.to)) return;
    raw.push(edge.from === edge.to ? { ...edge, self: true } : edge);
  };
  agents.forEach((agent) =>
  list<Json>(agent.handoffs).filter(isObj).forEach((h) => {
    if (typeof h.to === 'string') add({ kind: 'handoff', from: agent.id, to: h.to, label: String(h.id || h.tool || ''), word: nameOf(h.to), title: typeof h.description === 'string' ? h.description : '' });
  })
  );
  // A tool whose rules hand the caller on: drawn from every agent that offers the tool.
  list<Json>(config?.tools).filter(isObj).forEach((tool) => {
    const targets = [...new Set(handoffSteps(tool.effects))];
    if (!targets.length) return;
    agents.filter((a) => list(a.tools).includes(tool.id)).forEach((agent) =>
    targets.forEach((to) => add({ kind: 'tool', from: agent.id, to, label: String(tool.id), word: typeof tool.name === 'string' && tool.name ? tool.name : humanize(String(tool.id)), title: typeof tool.description === 'string' ? tool.description : '' }))
    );
  });
  // A safety rule that passes the caller on applies to every call: drawn from the agent that answers first.
  list<Json>(config?.guardrails?.escalation).filter(isObj).forEach((rule) => {
    if (rule.action === 'handoff' && typeof rule.to === 'string') add({ kind: 'rule', from: entry, to: rule.to, label: String(rule.id || 'safety rule'), word: 'Safety rule', title: '' });
  });
  // One arrow per pair and kind, with the words together.
  const edges: MapEdge[] = [];
  raw.forEach((e) => {
    const found = edges.find((m) => m.from === e.from && m.to === e.to && m.kind === e.kind);
    if (found) {
      if (e.label && !found.labels.includes(e.label)) found.labels.push(e.label);
      if (e.word && !found.words.includes(e.word)) found.words.push(e.word);
      if (!found.title && e.title) found.title = e.title;
    } else edges.push({ kind: e.kind, from: e.from, to: e.to, title: e.title, self: e.self, labels: e.label ? [e.label] : [], words: e.word ? [e.word] : [] });
  });

  const layer = new Map<string, number>();
  if (entry) {
    layer.set(entry, 0);
    const queue = [entry];
    while (queue.length) {
      const at = queue.shift() as string;
      edges.filter((e) => e.from === at && !e.self && !layer.has(e.to)).forEach((e) => {
        layer.set(e.to, (layer.get(at) ?? 0) + 1);
        queue.push(e.to);
      });
    }
  }
  const unreachable = agents.filter((a) => !layer.has(a.id)).map((a) => a.id);
  const columns: string[][] = [];
  agents.forEach((a) => {
    const l = layer.get(a.id);
    if (l !== undefined) (columns[l] ??= []).push(a.id);
  });
  const cols = columns.filter(Boolean);
  if (unreachable.length) cols.push(unreachable);
  const nodes: MapNode[] = [];
  cols.forEach((col, c) =>
  col.forEach((id, r) => {
    const agent = agents.find((a) => a.id === id) as AgentRole;
    nodes.push({
      id,
      name: agent.name || id,
      kind: String(agent.kind ?? ''),
      entry: id === entry,
      reachable: !unreachable.includes(id),
      index: all.indexOf(agent),
      column: c,
      row: r,
      x: MAP_NODE.pad + c * (MAP_NODE.width + MAP_NODE.gapX),
      y: MAP_NODE.pad + r * (MAP_NODE.height + MAP_NODE.gapY)
    });
  })
  );
  const tallest = Math.max(1, ...cols.map((c) => c.length));
  return {
    nodes,
    edges,
    entry,
    unreachable,
    width: MAP_NODE.pad * 2 + Math.max(1, cols.length) * MAP_NODE.width + Math.max(0, cols.length - 1) * MAP_NODE.gapX,
    height: MAP_NODE.pad * 2 + tallest * MAP_NODE.height + (tallest - 1) * MAP_NODE.gapY
  };
}

/** One sentence per arrow, in plain words (never an id): “Front desk hands the caller to Billing (when …).” */
export function describeEdges(map: AgentMap): string[] {
  const name = (id: string) => map.nodes.find((n) => n.id === id)?.name || id;
  const how: Record<MapEdgeKind, string> = { handoff: 'hands the caller to', tool: 'can pass the caller to', rule: 'passes the caller, under a safety rule, to' };
  const extra = (e: MapEdge) => e.kind === 'handoff' ? e.title : e.kind === 'tool' && e.words.length ? `through ${e.words.join(', ')}` : '';
  return map.edges.map((e) => `${name(e.from)} ${how[e.kind]} ${name(e.to)}${extra(e) ? ` (${extra(e)})` : ''}.`);
}

// ---- the tool grid ----------------------------------------------------------------------------------------------------
export interface ToolGrid {
  agents: {id: string;name: string;count: number;}[];
  rows: {id: string;name: string;kind: string;description: string;agents: string[];cells: boolean[];}[];
  unused: string[];
  shared: string[];
}

/** Who can use which tool: unused tools and agents with none at a glance. */
export function buildToolGrid(config: AgentConfig): ToolGrid {
  const agents = list<AgentRole>(config?.agents?.items).
  filter((a) => isObj(a) && typeof a.id === 'string' && a.id !== '').
  map((a) => ({ id: a.id, name: a.name || a.id, tools: new Set(list<string>(a.tools)) }));
  const rows = list<Json>(config?.tools).
  filter((t) => isObj(t) && typeof t.id === 'string' && t.id !== '').
  map((t) => {
    const id = String(t.id);
    const users = agents.filter((a) => a.tools.has(id)).map((a) => a.id);
    return {
      id,
      name: typeof t.name === 'string' && t.name ? t.name : humanize(id),
      kind: String(t.builtin || t.type || ''),
      description: typeof t.description === 'string' ? t.description : '',
      agents: users,
      cells: agents.map((a) => a.tools.has(id))
    };
  });
  return {
    agents: agents.map(({ id, name }) => ({ id, name, count: rows.filter((r) => r.agents.includes(id)).length })),
    rows,
    unused: rows.filter((r) => r.agents.length === 0).map((r) => r.id),
    shared: rows.filter((r) => r.agents.length > 1).map((r) => r.id)
  };
}

/** The config with `toolId` offered (or not) by `agentId`; the agent's order is kept and a new tool goes last. */
export function setToolOffered(config: AgentConfig, agentId: string, toolId: string, on: boolean): AgentConfig {
  const next = clone(config);
  const agent = list<AgentRole>(next?.agents?.items).find((a) => isObj(a) && a.id === agentId);
  if (!agent) return config;
  const current = list<string>(agent.tools);
  const has = current.includes(toolId);
  if (on && !has) agent.tools = [...current, toolId];else
  if (!on && has) agent.tools = current.filter((t) => t !== toolId);else
  return config;
  return next;
}

// ---- used by ------------------------------------------------------------------------------------------------------------
export type Collection = 'tools' | 'messages' | 'state' | 'connections' | 'agents' | 'transfers' | 'knowledge' | 'channels';

/**
 * The settings that point at an id of each collection, by key, as the server's schema marks them (x-ref): `key` for a
 * value, `key[]` for an item of a list, `key{}` for a key of an object.
 */
const REFERENCES: Record<Collection, string[]> = {
  tools: ['tools[]', 'tool', 'tool_called', 'tool_not_called', 'then'],
  messages: ['message'],
  state: ['state', 'to_state{}', 'into', 'values{}', 'success', 'sent_by', 'store_in_state', 'set_state{}', 'store_in', 'pending_request_into', 'count_attempts_in'],
  connections: ['connection', 'server', 'via'],
  agents: ['entry', 'agent_is', 'to'],
  transfers: ['transfer'],
  knowledge: ['knowledge[]', 'source'],
  channels: ['channel', 'channel[]', 'channels[]']
};
// Where each collection's own items are: their `id` is the item itself, not a use of it.
const HOME: Record<Collection, (path: Path) => boolean> = {
  tools: (p) => p.length === 3 && p[0] === 'tools' && p[2] === 'id',
  messages: (p) => p.length === 3 && p[0] === 'messages' && p[2] === 'id',
  state: () => false,
  connections: () => false,
  agents: (p) => p.length === 4 && p[0] === 'agents' && p[1] === 'items' && p[3] === 'id',
  transfers: (p) => p[0] === 'telephony' && p[1] === 'transfers' && p[3] === 'id',
  knowledge: (p) => p.length === 3 && p[0] === 'knowledge' && p[2] === 'id',
  channels: (p) => p.length === 3 && p[0] === 'channels' && p[2] === 'id'
};

export interface Use {
  /** Where, in words: “agent “Billing””, “tool “lookup””, “test “refund””. */
  place: string;
  path: Path;
}

const ITEM_WORD: Record<string, string> = {
  tools: 'tool',
  channels: 'channel',
  tasks: 'task',
  tests: 'test',
  knowledge: 'knowledge base',
  forms: 'form',
  notifications: 'message it sends',
  wrapups: 'closing message',
  events: 'event hook',
  messages: 'fixed line'
};
const SECTION_WORD: Record<string, string> = {
  agents: 'which agent answers first',
  guardrails: 'guardrails',
  telephony: 'phone transfers',
  post_call: 'after the call',
  defaults: 'defaults',
  persona: 'personality',
  state: 'things it remembers',
  identity: 'caller identity',
  connections: 'connections'
};

/** A place in the config in words, by the item it is inside. */
export function placeLabel(config: AgentConfig, path: Path): string {
  const [top, i, field] = path;
  const at = (items: unknown, k: unknown) => typeof k === 'number' ? list<Json>(items)[k] : undefined;
  if (top === 'agents' && i === 'items') {
    const a = at(config.agents?.items, field);
    return `agent “${String(a?.name || a?.id || '…')}”`;
  }
  if (top === 'telephony' && i === 'transfers') return `transfer “${String(at((config.telephony as Json | undefined)?.transfers, field)?.id ?? '…')}”`;
  if (top === 'guardrails' && typeof i === 'string' && typeof field === 'number') {
    const rule = at((config.guardrails as Json | undefined)?.[i], field);
    return `safety rule “${String(rule?.id ?? field + 1)}”`;
  }
  if (top === 'events' && typeof i === 'number') return `event hook “${String(at(config.events, i)?.on ?? i + 1)}”`;
  if (typeof top === 'string' && ITEM_WORD[top] && typeof i === 'number') {
    const item = at((config as Json)[top], i);
    return `${ITEM_WORD[top]} “${String(item?.id ?? item?.name ?? i + 1)}”`;
  }
  if (typeof top === 'string' && top === 'connections' && typeof i === 'string') return `connection “${i}”`;
  if (typeof top === 'string' && ITEM_WORD[top] && typeof i === 'string') return `${ITEM_WORD[top]} “${i}”`;
  return SECTION_WORD[String(top)] ?? String(top ?? 'settings').replace(/_/g, ' ');
}

const usesCache = new WeakMap<object, Map<string, Use[]>>();

/** Every place that points at an id of a collection (one per place, in config order); text mentions count for state. */
export function usedBy(config: AgentConfig | null | undefined, collection: Collection, id: string): Use[] {
  if (!config || typeof config !== 'object' || !id) return [];
  const key = `${collection}\u0000${id}`;
  const cached = usesCache.get(config)?.get(key);
  if (cached) return cached;
  const keys = REFERENCES[collection];
  const hits: Path[] = [];
  const mention = collection === 'state' ? new RegExp(`\\{\\{\\s*state\\.${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`) : null;
  const walk = (value: unknown, path: Path, parentKey: string) => {
    if (path[0] === 'builder') return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (typeof v === 'string' && v === id && keys.includes(`${parentKey}[]`) && !HOME[collection]([...path, i])) hits.push([...path, i]);else
        walk(v, [...path, i], parentKey);
      });
      return;
    }
    if (isObj(value)) {
      Object.entries(value).forEach(([k, v]) => {
        const at = [...path, k];
        if (k === id && keys.includes(`${parentKey}{}`)) hits.push(at);
        if (typeof v === 'string') {
          if (v === id && keys.includes(k) && !HOME[collection](at)) hits.push(at);else
          if (mention?.test(v)) hits.push(at);
        } else walk(v, at, k);
      });
      return;
    }
  };
  walk(config, [], '');
  // "to" names an agent only in a hand-off ({ type: handoff, to } or a hand-off entry), not an email "to".
  const kept = collection === 'agents' ? hits.filter((p) => p[p.length - 1] !== 'to' || isHandoffPlace(config, p)) : hits;
  const out: Use[] = [];
  const seen = new Set<string>();
  kept.forEach((path) => {
    const place = placeLabel(config, path);
    if (seen.has(place)) return;
    seen.add(place);
    out.push({ place, path });
  });
  const byConfig = usesCache.get(config) ?? new Map<string, Use[]>();
  byConfig.set(key, out);
  usesCache.set(config, byConfig);
  return out;
}

function isHandoffPlace(config: AgentConfig, path: Path): boolean {
  const owner = path.slice(0, -1).reduce<unknown>((node, part) => isObj(node) || Array.isArray(node) ? (node as Json)[part as string] : undefined, config);
  return isObj(owner) && (owner.type === 'handoff' || owner.action === 'handoff' || path.includes('handoffs'));
}
