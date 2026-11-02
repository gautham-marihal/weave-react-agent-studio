// The Workflow canvas: an agent's configuration drawn as a graph you can edit. Every block and arrow is something the
// runtime already reads (GET /schema), and every edit writes only those paths, so the form, the JSON and the runtime all
// see the same thing. The one thing kept for the canvas alone is where each block is drawn: builder.ui.graph_positions,
// which the runtime ignores. Agents are keyed by their bare id there (as the first studio did); the other blocks carry a
// prefix. Pure: no React, no DOM.
//
// Blocks:  channel    where a call starts (channels[]); every channel starts with the agent that answers first
//          agent      agents.items[]
//          tool       tools[]: one block per tool, however many agents use it
//          knowledge  knowledge[]
// Arrows:  entry         channel -> agents.entry
//          handoff       agent -> agent (agents.items[].handoffs[])
//          uses          agent -> tool (agents.items[].tools)
//          reads         agent -> knowledge base, read on every turn (agents.items[].knowledge)
//          searches      knowledge-search tool -> knowledge base (tools[].source)
//          tool_handoff  tool -> agent, a hand-off in the tool's effects (run after it succeeds)
//          returns       return_to_entry tool -> the agent that answers first
//          rule_handoff  a guardrail escalation rule that hands off (drawn from the agent that answers first)
import type { AgentConfig, AgentRole, Path, ToolDefinition } from '../types/studio';
import type { ProvidersAnswer } from '../api/types';
import { CALLBACK_MESSAGE, GOODBYE, freshId, setReach, type ReachType } from './setup';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T = unknown,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const clip = (text: unknown, n: number) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export type NodeKind = 'channel' | 'agent' | 'tool' | 'knowledge';
export type EdgeKind = 'entry' | 'handoff' | 'uses' | 'reads' | 'searches' | 'tool_handoff' | 'returns' | 'rule_handoff';
export interface Point {
  x: number;
  y: number;
}

export interface FlowNode {
  id: string;
  kind: NodeKind;
  /** The id in the config (channel id, agent id, tool id, knowledge base id). */
  ref: string;
  /** Its place in its list in the config. */
  index: number;
  label: string;
  sub: string;
  /** channel type, agent kind, tool type or knowledge base type. */
  type: string;
  builtin?: string;
  entry?: boolean;
  disabled?: boolean;
  /** Why nothing reaches or uses it ('' when connected): shown on the block, never treated as running. */
  loose: string;
  /** Can an arrow start / end here. */
  out: boolean;
  in: boolean;
  position: Point;
}

export interface FlowEdge {
  id: string;
  kind: EdgeKind;
  source: string;
  target: string;
  label: string;
  /** Why it can't be taken away here ('' when it can). */
  fixed: string;
  /** agents.items index and handoffs index, for a hand-off. */
  agentIndex?: number;
  handoffIndex?: number;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  entry: string;
  /** True when no block has a saved place yet (the layout is the automatic one). */
  autoLayout: boolean;
}

// ---- ids of blocks ------------------------------------------------------------------------------------------------
const PREFIX: Record<Exclude<NodeKind, 'agent'>, string> = { channel: 'channel::', tool: 'tool::', knowledge: 'kb::' };
export const nodeId = (kind: NodeKind, ref: string): string => (kind === 'agent' ? ref : `${PREFIX[kind]}${ref}`);
export function parseNodeId(id: string): { kind: NodeKind; ref: string } {
  for (const kind of ['channel', 'tool', 'knowledge'] as const) if (id.startsWith(PREFIX[kind])) return { kind, ref: id.slice(PREFIX[kind].length) };
  return { kind: 'agent', ref: id };
}

// ---- reading the config -----------------------------------------------------------------------------------------------
const agentsOf = (config: AgentConfig) => list<AgentRole>(config?.agents?.items).filter((a) => isObj(a) && typeof a.id === 'string' && a.id !== '');
const toolsOf = (config: AgentConfig) => list<ToolDefinition>(config?.tools).filter((t) => isObj(t) && typeof t.id === 'string' && t.id !== '');
const basesOf = (config: AgentConfig) => list<Json>(config?.knowledge).filter((k) => isObj(k) && typeof k.id === 'string' && k.id !== '');
const channelsOf = (config: AgentConfig) => list<Json>(config?.channels).filter((c) => isObj(c) && typeof c.id === 'string' && c.id !== '');
export const entryOf = (config: AgentConfig): string => {
  const ids = agentsOf(config).map((a) => a.id);
  return ids.includes(String(config?.agents?.entry)) ? String(config.agents?.entry) : ids[0] ?? '';
};
const isBuiltin = (tool: Json | undefined, name: string) => !!tool && tool.type === 'builtin' && tool.builtin === name;
/** A knowledge base read on every turn ('inject') rather than searched by a tool ('tool', the default). */
export const isInjected = (base: Json | undefined) => base?.mode === 'inject';

/** Every `{ type: 'handoff', to }` step anywhere inside a value. */
function handoffSteps(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => handoffSteps(v, out));
  else if (isObj(value)) {
    if (value.type === 'handoff' && typeof value.to === 'string') out.push(value.to);
    Object.values(value).forEach((v) => handoffSteps(v, out));
  }
  return out;
}

const speechWords = (say: unknown, config: AgentConfig): string => {
  if (typeof say === 'string') return say;
  if (isObj(say) && typeof say.message === 'string') {
    const line = list<Json>(config.messages).find((m) => isObj(m) && m.id === say.message);
    return typeof line?.text === 'string' ? line.text : '';
  }
  return '';
};

export const CHANNEL_LABEL: Record<string, string> = {
  web_chat: 'Web chat',
  web_voice: 'Website voice',
  sip_voice: 'Phone',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
  custom: 'Custom channel',
};
export const AGENT_KIND_LABEL: Record<string, string> = {
  router: 'Router: passes callers on',
  specialist: 'Specialist',
  standalone: 'Answers on its own',
};

// ---- layout -------------------------------------------------------------------------------------------------------
export const NODE_SIZE: Record<NodeKind, { w: number; h: number }> = {
  channel: { w: 224, h: 76 },
  agent: { w: 248, h: 96 },
  tool: { w: 224, h: 72 },
  knowledge: { w: 224, h: 72 },
};
const COL = 320;
const TOOL_COL = 256;
const GAP_Y = 40;

const savedPositions = (config: AgentConfig): Record<string, Point> => {
  const raw = config?.builder?.ui?.graph_positions;
  if (!isObj(raw)) return {};
  const out: Record<string, Point> = {};
  Object.entries(raw).forEach(([k, v]) => {
    if (isObj(v) && Number.isFinite(v.x) && Number.isFinite(v.y)) out[k] = { x: Number(v.x), y: Number(v.y) };
  });
  return out;
};

/** The graph of a config: its blocks (where saved, else laid out left to right by how a call moves) and its arrows. */
export function buildGraph(config: AgentConfig): FlowGraph {
  const agents = agentsOf(config);
  const tools = toolsOf(config);
  const bases = basesOf(config);
  const channels = channelsOf(config);
  const entry = entryOf(config);
  const agentIds = new Set(agents.map((a) => a.id));
  const toolById = new Map(tools.map((t) => [t.id, t as Json]));
  const baseById = new Map(bases.map((b) => [String(b.id), b]));

  const edges: FlowEdge[] = [];
  const ids = new Set<string>();
  const add = (edge: FlowEdge) => {
    let id = edge.id;
    for (let n = 2; ids.has(id); n++) id = `${edge.id}#${n}`;
    ids.add(id);
    edges.push({ ...edge, id });
  };

  if (entry)
    channels.forEach((c) =>
      add({ id: `entry:${c.id}`, kind: 'entry', source: nodeId('channel', String(c.id)), target: entry, label: '', fixed: 'Every call starts with the agent that answers first. Connect the channel to another agent to change which one that is.' })
    );
  const rawAgents = list<AgentRole>(config?.agents?.items);
  rawAgents.forEach((agent, agentIndex) => {
    if (!isObj(agent) || !agentIds.has(agent.id)) return;
    list<Json>(agent.handoffs).forEach((h, handoffIndex) => {
      if (isObj(h) && typeof h.to === 'string' && agentIds.has(h.to))
        add({ id: `handoff:${agent.id}:${handoffIndex}`, kind: 'handoff', source: agent.id, target: h.to, label: clip(h.description, 40), fixed: '', agentIndex, handoffIndex });
    });
    list<string>(agent.tools).forEach((t) => {
      if (toolById.has(t)) add({ id: `uses:${agent.id}:${t}`, kind: 'uses', source: agent.id, target: nodeId('tool', t), label: '', fixed: '' });
    });
    list<string>(agent.knowledge).forEach((k) => {
      if (baseById.has(k)) add({ id: `reads:${agent.id}:${k}`, kind: 'reads', source: agent.id, target: nodeId('knowledge', k), label: 'every turn', fixed: '' });
    });
  });
  tools.forEach((tool) => {
    const t = tool as Json;
    if (t.type === 'knowledge' && typeof t.source === 'string' && baseById.has(t.source))
      add({ id: `searches:${t.id}`, kind: 'searches', source: nodeId('tool', tool.id), target: nodeId('knowledge', t.source), label: '', fixed: 'A knowledge search must search a base. Connect it to another one, or delete the tool.' });
    [...new Set(handoffSteps(t.effects))].filter((to) => agentIds.has(to)).forEach((to) =>
      add({ id: `toolhandoff:${tool.id}:${to}`, kind: 'tool_handoff', source: nodeId('tool', tool.id), target: to, label: 'hands off', fixed: '' })
    );
    if (isBuiltin(t, 'return_to_entry') && entry)
      add({ id: `returns:${tool.id}`, kind: 'returns', source: nodeId('tool', tool.id), target: entry, label: 'back to the start', fixed: 'This tool always goes back to the agent that answers first.' });
  });
  list<Json>(config?.guardrails?.escalation).forEach((rule) => {
    if (isObj(rule) && rule.action === 'handoff' && typeof rule.to === 'string' && agentIds.has(rule.to) && entry)
      add({ id: `rule:${String(rule.id ?? rule.to)}`, kind: 'rule_handoff', source: entry, target: rule.to, label: `safety rule${rule.id ? ` ${String(rule.id)}` : ''}`, fixed: 'This hand-off is a safety rule. Change it on the Guardrails page.' });
  });

  // Which agents a call can reach: from the one that answers first, along hand-offs and the tools that hand off.
  const reach = new Map<string, number>();
  if (entry) {
    reach.set(entry, 0);
    const queue = [entry];
    while (queue.length) {
      const at = queue.shift() as string;
      const next = edges.flatMap((e) => {
        if ((e.kind === 'handoff' || e.kind === 'rule_handoff') && e.source === at) return [e.target];
        if (e.kind === 'uses' && e.source === at) return edges.filter((x) => x.source === e.target && (x.kind === 'tool_handoff' || x.kind === 'returns')).map((x) => x.target);
        return [];
      });
      next.forEach((to) => {
        if (!reach.has(to)) {
          reach.set(to, (reach.get(at) ?? 0) + 1);
          queue.push(to);
        }
      });
    }
  }
  const usedTools = new Set(edges.filter((e) => e.kind === 'uses').map((e) => e.target));
  const readBases = new Set(edges.filter((e) => e.kind === 'reads' || e.kind === 'searches').map((e) => e.target));

  const nodes: FlowNode[] = [];
  channels.forEach((c) => {
    const say = speechWords(isObj(c.greeting) ? c.greeting.say : undefined, config);
    nodes.push({
      id: nodeId('channel', String(c.id)),
      kind: 'channel',
      ref: String(c.id),
      index: list(config.channels).indexOf(c),
      label: CHANNEL_LABEL[String(c.type)] ?? String(c.type),
      sub: say ? `“${clip(say, 60)}”` : 'Waits for the person to speak first',
      type: String(c.type),
      disabled: c.enabled === false,
      loose: '',
      out: true,
      in: false,
      position: { x: 0, y: 0 },
    });
  });
  rawAgents.forEach((agent, index) => {
    if (!isObj(agent) || !agentIds.has(agent.id)) return;
    const toolCount = list(agent.tools).length;
    const handoffCount = list(agent.handoffs).length;
    nodes.push({
      id: agent.id,
      kind: 'agent',
      ref: agent.id,
      index,
      label: agent.name || agent.id,
      sub: [AGENT_KIND_LABEL[String(agent.kind)] ?? 'Agent', `${toolCount} tool${toolCount === 1 ? '' : 's'}`, handoffCount ? `${handoffCount} hand-off${handoffCount === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '),
      type: String(agent.kind ?? ''),
      entry: agent.id === entry,
      loose: reach.has(agent.id) ? '' : 'No hand-off leads here, so no call reaches it.',
      out: true,
      in: true,
      position: { x: 0, y: 0 },
    });
  });
  list<Json>(config?.tools).forEach((t, index) => {
    if (!isObj(t) || !toolById.has(String(t.id))) return;
    nodes.push({
      id: nodeId('tool', String(t.id)),
      kind: 'tool',
      ref: String(t.id),
      index,
      label: typeof t.name === 'string' && t.name ? t.name : String(t.id),
      sub: clip(t.description, 70),
      type: String(t.type ?? ''),
      builtin: typeof t.builtin === 'string' ? t.builtin : undefined,
      loose: usedTools.has(nodeId('tool', String(t.id))) ? '' : 'No agent uses it, so it never runs.',
      out: t.type === 'knowledge' || isBuiltin(t, 'noop') || handoffSteps(t.effects).length > 0 || isBuiltin(t, 'return_to_entry'),
      in: true,
      position: { x: 0, y: 0 },
    });
  });
  list<Json>(config?.knowledge).forEach((b, index) => {
    if (!isObj(b) || !baseById.has(String(b.id))) return;
    const sources = list(b.sources).length;
    nodes.push({
      id: nodeId('knowledge', String(b.id)),
      kind: 'knowledge',
      ref: String(b.id),
      index,
      label: String(b.id),
      sub: `${isInjected(b) ? 'Read on every turn' : 'Searched by a tool'}${b.type === 'vector_store' ? ` · ${sources} source${sources === 1 ? '' : 's'}` : ''}`,
      type: String(b.type ?? ''),
      loose: readBases.has(nodeId('knowledge', String(b.id))) ? '' : 'Nothing reads or searches it.',
      out: false,
      in: true,
      position: { x: 0, y: 0 },
    });
  });

  // Where each block goes when nobody has placed it: channels, then agents by how many hand-offs from the start (the
  // ones no call reaches after them), then tools in the order their agents come, then knowledge bases.
  const deepest = Math.max(0, ...reach.values());
  const agentCol = (n: FlowNode) => 1 + (reach.get(n.ref) ?? deepest + 1);
  const lastAgentCol = Math.max(1, ...nodes.filter((n) => n.kind === 'agent').map(agentCol));
  const firstUser = (n: FlowNode) => {
    const users = edges.filter((e) => e.target === n.id && e.kind === 'uses').map((e) => agents.findIndex((a) => a.id === e.source));
    return users.length ? Math.min(...users) : Number.MAX_SAFE_INTEGER;
  };
  const column = (n: FlowNode) => (n.kind === 'channel' ? 0 : n.kind === 'agent' ? agentCol(n) : n.kind === 'tool' ? lastAgentCol + 1 : lastAgentCol + 2);
  const columns = new Map<number, FlowNode[]>();
  nodes.forEach((n) => columns.set(column(n), [...(columns.get(column(n)) ?? []), n]));
  const stack = (col: FlowNode[], x: number) => {
    let y = 0;
    col.forEach((n) => {
      n.position = { x, y };
      y += NODE_SIZE[n.kind].h + GAP_Y;
    });
  };
  [...columns.entries()].filter(([c]) => c <= lastAgentCol).forEach(([c, col]) => stack(col, c * COL));
  // Many tools wrap into short columns side by side, so the whole graph still fits on screen at a readable size.
  const toolBlocks = (columns.get(lastAgentCol + 1) ?? []).sort((a, b) => firstUser(a) - firstUser(b) || a.index - b.index);
  const rows = Math.max(6, Math.ceil(Math.sqrt(toolBlocks.length * 1.5)));
  const toolX = (lastAgentCol + 1) * COL;
  for (let k = 0; k * rows < toolBlocks.length; k++) stack(toolBlocks.slice(k * rows, (k + 1) * rows), toolX + k * TOOL_COL);
  stack(columns.get(lastAgentCol + 2) ?? [], toolX + Math.max(1, Math.ceil(toolBlocks.length / rows)) * TOOL_COL + (COL - TOOL_COL));
  const saved = savedPositions(config);
  let placed = 0;
  nodes.forEach((n) => {
    if (saved[n.id]) {
      n.position = saved[n.id];
      placed += 1;
    }
  });
  return { nodes, edges, entry, autoLayout: placed === 0 };
}

/** The block (and hand-off arrow) a problem the server found is about, by where it is in the config. */
export function targetOfPath(path: Path | null | undefined, config: AgentConfig): { node: string; edge?: string } | null {
  if (!path?.length) return null;
  const [top, i, field] = path;
  const at = <T,>(items: unknown, k: unknown): T | undefined => (typeof k === 'number' ? (list<T>(items)[k] as T | undefined) : undefined);
  if (top === 'channels') {
    const c = at<Json>(config.channels, i);
    return c && typeof c.id === 'string' ? { node: nodeId('channel', c.id) } : null;
  }
  if (top === 'agents') {
    if (i === 'entry') return entryOf(config) ? { node: entryOf(config) } : null;
    const a = i === 'items' ? at<AgentRole>(config.agents?.items, field) : undefined;
    if (!a || typeof a.id !== 'string') return null;
    if (path[3] === 'handoffs' && typeof path[4] === 'number') return { node: a.id, edge: `handoff:${a.id}:${path[4]}` };
    return { node: a.id };
  }
  if (top === 'tools') {
    const t = at<Json>(config.tools, i);
    return t && typeof t.id === 'string' ? { node: nodeId('tool', t.id) } : null;
  }
  if (top === 'knowledge') {
    const b = at<Json>(config.knowledge, i);
    return b && typeof b.id === 'string' ? { node: nodeId('knowledge', b.id) } : null;
  }
  return null;
}

/**
 * A plain next step for a problem the server found, read from the shape of its message ('' when there is nothing to
 * add). The server's message is always shown too; this never replaces it.
 */
export function remedyFor(message: string): string {
  if (/is a required property/.test(message)) return 'Fill it in: the server needs it.';
  if (/is not a declared \S+ id/.test(message)) return 'Point it at something that exists, or add what it names first.';
  if (/is too short|should be non-empty|is not allowed to be empty|minLength/i.test(message)) return 'It can’t be left empty.';
  if (/does not match/.test(message)) return 'Use lowercase letters, digits and underscores, starting with a letter.';
  if (/is not one of/.test(message)) return 'Choose one of the values the message lists.';
  if (/unreachable|never reached|not reachable|can't be reached|cannot be reached/i.test(message)) return 'Add a hand-off to it from an agent a call reaches, or delete it.';
  if (/unused|nothing uses|not used|never used/i.test(message)) return 'Connect an agent to it, or delete it.';
  return '';
}

/** Where in the config a block's own settings are. */
export function pathOfNode(node: Pick<FlowNode, 'kind' | 'index'>): Path {
  if (node.kind === 'channel') return ['channels', node.index];
  if (node.kind === 'agent') return ['agents', 'items', node.index];
  if (node.kind === 'tool') return ['tools', node.index];
  return ['knowledge', node.index];
}

// ---- edits ------------------------------------------------------------------------------------------------------
export interface EditResult {
  config: AgentConfig;
  /** Why nothing was changed ('' when it was). */
  refused: string;
  /** Something worth saying about what changed (or what it left). */
  note?: string;
  /** Blocks to select after the edit (a new one, the one it is about). */
  select?: string[];
  /** An arrow to select after the edit (a new hand-off, so it can be described). */
  selectEdge?: string;
}
const done = (config: AgentConfig, extra: Partial<EditResult> = {}): EditResult => ({ config, refused: '', ...extra });
const refuse = (config: AgentConfig, refused: string, extra: Partial<EditResult> = {}): EditResult => ({ config, refused, ...extra });

const findAgent = (config: AgentConfig, id: string) => list<AgentRole>(config?.agents?.items).find((a) => isObj(a) && a.id === id);
const findTool = (config: AgentConfig, id: string) => list<Json>(config?.tools).find((t) => isObj(t) && t.id === id);
const findBase = (config: AgentConfig, id: string) => list<Json>(config?.knowledge).find((b) => isObj(b) && b.id === id);

/** Every block's place, rounded, kept with any other places already saved. */
export function withPositions(config: AgentConfig, positions: Record<string, Point>): AgentConfig {
  const next = clone(config);
  const builder = isObj(next.builder) ? (next.builder as Json) : {};
  const ui = isObj(builder.ui) ? (builder.ui as Json) : {};
  const graph = { ...(isObj(ui.graph_positions) ? (ui.graph_positions as Json) : {}) };
  Object.entries(positions).forEach(([id, p]) => {
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) graph[id] = { x: Math.round(p.x), y: Math.round(p.y) };
  });
  next.builder = { ...builder, ui: { ...ui, graph_positions: graph } };
  return next;
}

/** Forgets every saved place, so the automatic layout applies again. */
export function clearPositions(config: AgentConfig): AgentConfig {
  if (!isObj(config?.builder?.ui?.graph_positions)) return config;
  const next = clone(config);
  const builder = next.builder as Json;
  const ui = builder.ui as Json;
  delete ui.graph_positions;
  if (!Object.keys(ui).length) delete builder.ui;
  if (!Object.keys(builder).length) delete next.builder;
  return next;
}

const forget = (next: AgentConfig, ids: string[]) => {
  const graph = next.builder?.ui?.graph_positions;
  if (isObj(graph)) ids.forEach((id) => delete (graph as Json)[id]);
};

/** Whether any setting other than the canvas's own places still names an id (a test, a guardrail, an event...). */
function stillNamed(config: AgentConfig, id: string): boolean {
  const rest = { ...config, builder: undefined };
  return JSON.stringify(rest).includes(`"${id}"`);
}

// An agent that answers on its own has its hand-offs ignored, so one that is given a hand-off passes callers on from
// then on; and the one agent left passing callers to nobody answers on its own again.
function settleKind(next: AgentConfig) {
  const items = list<AgentRole>(next.agents?.items);
  if (items.length === 1 && isObj(items[0]) && items[0].kind === 'router' && !list(items[0].handoffs).length) items[0].kind = 'standalone';
}

/** Tool names the model sees, taken by a tool or a hand-off (a hand-off is a tool to the model). */
const takenToolNames = (config: AgentConfig) => [
  ...list<Json>(config.tools).flatMap((t) => [t?.id, t?.name].filter((x): x is string => typeof x === 'string')),
  ...list<AgentRole>(config.agents?.items).flatMap((a) => list<Json>(a?.handoffs).map((h) => String(h?.tool ?? ''))),
];

function addHandoff(next: AgentConfig, from: AgentRole, to: AgentRole) {
  const handoffIds = list<AgentRole>(next.agents?.items).flatMap((a) => list<Json>(a?.handoffs).map((h) => String(h?.id ?? '')));
  const id = freshId(handoffIds, `to_${to.id}`);
  if (from.kind === 'standalone') from.kind = 'router';
  from.handoffs = [...list(from.handoffs), { id, tool: freshId(takenToolNames(next), `go_to_${to.id.replace(/-/g, '_')}`), description: `The caller needs ${to.name || to.id}.`, to: to.id, carry_context: true }];
}

/** Why an arrow from one block to another can't be drawn ('' when it can). */
export function canConnect(config: AgentConfig, source: string, target: string): string {
  if (source === target) return 'A block can’t connect to itself.';
  const s = parseNodeId(source);
  const t = parseNodeId(target);
  if (s.kind === 'channel') {
    if (t.kind !== 'agent') return 'A channel connects to the agent that answers first.';
    return findAgent(config, t.ref) ? '' : 'That agent no longer exists.';
  }
  if (s.kind === 'agent') {
    const agent = findAgent(config, s.ref);
    if (!agent) return 'That agent no longer exists.';
    if (t.kind === 'agent') {
      if (!findAgent(config, t.ref)) return 'That agent no longer exists.';
      if (list<Json>(agent.handoffs).some((h) => h?.to === t.ref)) return `${agent.name || agent.id} already hands off to that agent.`;
      return '';
    }
    if (t.kind === 'tool') {
      const tool = findTool(config, t.ref);
      if (!tool) return 'That tool no longer exists.';
      if (list(agent.tools).includes(t.ref)) return `${agent.name || agent.id} already uses that tool.`;
      if (isBuiltin(tool, 'return_to_entry') && entryOf(config) === agent.id) return 'The agent that answers first can’t go back to itself.';
      return '';
    }
    if (t.kind === 'knowledge') {
      const base = findBase(config, t.ref);
      if (!base) return 'That knowledge base no longer exists.';
      if (!isInjected(base)) return 'This knowledge base is searched by a tool. Connect the agent to a knowledge search tool, or set the base to be read on every turn.';
      if (list(agent.knowledge).includes(t.ref)) return `${agent.name || agent.id} already reads that knowledge base.`;
      return '';
    }
    return 'An agent connects to another agent, a tool or a knowledge base.';
  }
  if (s.kind === 'tool') {
    const tool = findTool(config, s.ref);
    if (!tool) return 'That tool no longer exists.';
    if (tool.type === 'knowledge') {
      if (t.kind !== 'knowledge') return 'A knowledge search connects to the knowledge base it searches.';
      const base = findBase(config, t.ref);
      if (!base) return 'That knowledge base no longer exists.';
      if (isInjected(base)) return 'This knowledge base is read on every turn, not searched. Set it to be searched by a tool first.';
      return tool.source === t.ref ? 'It already searches that knowledge base.' : '';
    }
    if (isBuiltin(tool, 'noop')) {
      if (t.kind !== 'agent') return 'A conditional hand-off connects to the agent it hands off to.';
      return handoffSteps(tool.effects).includes(t.ref) ? 'It already hands off to that agent.' : '';
    }
    return 'Arrows from a tool are for a knowledge search or a conditional hand-off.';
  }
  return 'Nothing starts from a knowledge base.';
}

/** Draws an arrow: sets the agent that answers first, adds a hand-off, gives a tool or a knowledge base, points a search. */
export function connect(config: AgentConfig, source: string, target: string): EditResult {
  const why = canConnect(config, source, target);
  if (why) return refuse(config, why);
  const s = parseNodeId(source);
  const t = parseNodeId(target);
  const next = clone(config);
  if (s.kind === 'channel') {
    if (entryOf(config) === t.ref) return done(config);
    next.agents = { ...(next.agents ?? {}), entry: t.ref };
    const name = findAgent(next, t.ref)?.name || t.ref;
    return done(next, { note: `Every channel now starts with ${name}: a bot has one agent that answers first.` });
  }
  if (s.kind === 'agent') {
    const agent = findAgent(next, s.ref) as AgentRole;
    if (t.kind === 'agent') {
      addHandoff(next, agent, findAgent(next, t.ref) as AgentRole);
      return done(next, { selectEdge: `handoff:${agent.id}:${list(agent.handoffs).length - 1}` });
    }
    if (t.kind === 'tool') agent.tools = [...list<string>(agent.tools), t.ref];
    else agent.knowledge = [...list<string>(agent.knowledge), t.ref];
    return done(next);
  }
  const tool = findTool(next, s.ref) as Json;
  if (tool.type === 'knowledge') tool.source = t.ref;
  else tool.effects = [...list(tool.effects), { do: [{ type: 'handoff', to: t.ref }] }];
  return done(next);
}

/** Takes an arrow away (what it stands for in the config), or says why it stays. */
export function removeEdge(config: AgentConfig, edge: FlowEdge): EditResult {
  if (edge.fixed) return refuse(config, edge.fixed);
  const next = clone(config);
  const source = parseNodeId(edge.source);
  const target = parseNodeId(edge.target);
  if (edge.kind === 'handoff') {
    const agent = list<AgentRole>(next.agents?.items)[edge.agentIndex ?? -1];
    if (!agent || !Array.isArray(agent.handoffs)) return refuse(config, 'That hand-off no longer exists.');
    agent.handoffs.splice(edge.handoffIndex ?? -1, 1);
    if (!agent.handoffs.length) delete agent.handoffs;
    settleKind(next);
    return done(next);
  }
  if (edge.kind === 'uses' || edge.kind === 'reads') {
    const agent = findAgent(next, source.ref);
    if (!agent) return refuse(config, 'That agent no longer exists.');
    const key = edge.kind === 'uses' ? 'tools' : 'knowledge';
    agent[key] = list<string>(agent[key]).filter((x) => x !== target.ref);
    if (key === 'knowledge' && !list(agent.knowledge).length) delete agent.knowledge;
    return done(next);
  }
  if (edge.kind === 'tool_handoff') {
    const tool = findTool(next, source.ref);
    if (!tool) return refuse(config, 'That tool no longer exists.');
    tool.effects = dropHandoffSteps(tool.effects, target.ref);
    if (!list(tool.effects).length) delete tool.effects;
    return done(next);
  }
  return refuse(config, 'This arrow can’t be taken away here.');
}

/** The steps without the hand-offs to an agent; a rule left with nothing to do goes too. */
function dropHandoffSteps(value: unknown, to: string): unknown {
  if (Array.isArray(value))
    return value
      .filter((v) => !(isObj(v) && v.type === 'handoff' && v.to === to))
      .map((v) => dropHandoffSteps(v, to))
      .filter((v) => !(isObj(v) && Array.isArray(v.do) && v.do.length === 0));
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, dropHandoffSteps(v, to)]));
  return value;
}

/** Deletes what blocks stand for. Each one refused says why; the rest go. */
export function removeNodes(config: AgentConfig, ids: string[]): EditResult {
  let next = config;
  const refused: string[] = [];
  const named: string[] = [];
  ids.forEach((id) => {
    const r = removeNode(next, id);
    if (r.refused) refused.push(r.refused);
    else {
      next = r.config;
      if (r.note) named.push(r.note);
    }
  });
  if (next === config && refused.length) return refuse(config, refused.join(' '));
  return { config: next, refused: refused.join(' '), note: named.join(' ') || undefined, select: [] };
}

function removeNode(config: AgentConfig, id: string): EditResult {
  const { kind, ref } = parseNodeId(id);
  if (kind === 'knowledge') return refuse(config, `Knowledge bases are added and removed on the Knowledge page, where their documents are managed (${ref}).`);
  const next = clone(config);
  if (kind === 'channel') {
    const channels = list<Json>(next.channels);
    const channel = channels.find((c) => isObj(c) && c.id === ref);
    if (!channel) return refuse(config, 'That channel no longer exists.');
    if (channel.enabled !== false && !channels.some((c) => c !== channel && isObj(c) && c.enabled !== false)) return refuse(config, 'It needs at least one way for people to reach it.');
    next.channels = channels.filter((c) => c !== channel) as AgentConfig['channels'];
    [...list<Json>(next.agents?.items), ...list<Json>(next.tools)].forEach((x) => {
      if (!Array.isArray(x?.channels)) return;
      x.channels = (x.channels as string[]).filter((c) => c !== ref);
      if (!(x.channels as string[]).length) delete x.channels;
    });
    forget(next, [id]);
    return done(next, stillNamed(next, ref) ? { note: `Other settings still name the channel ${ref}: the checks list where.` } : {});
  }
  if (kind === 'agent') {
    const items = list<AgentRole>(next.agents?.items);
    if (!findAgent(next, ref)) return refuse(config, 'That agent no longer exists.');
    if (items.length <= 1) return refuse(config, 'A bot needs at least one agent.');
    next.agents = {
      ...(next.agents ?? {}),
      items: items
        .filter((a) => a.id !== ref)
        .map((a) => {
          if (!Array.isArray(a.handoffs)) return a;
          const copy: AgentRole = { ...a, handoffs: a.handoffs.filter((h) => !(isObj(h) && h.to === ref)) };
          if (!list(copy.handoffs).length) delete copy.handoffs;
          return copy;
        }),
    };
    if (next.agents.entry === ref || !next.agents.entry) next.agents.entry = next.agents.items?.[0]?.id;
    next.tools = list<Json>(next.tools).map((t) => {
      if (!handoffSteps(t?.effects).includes(ref)) return t;
      const copy = { ...t, effects: dropHandoffSteps(t.effects, ref) };
      if (!list(copy.effects).length) delete copy.effects;
      return copy;
    }) as AgentConfig['tools'];
    if (!list(next.tools).length && !config.tools) delete next.tools;
    settleKind(next);
    forget(next, [id]);
    return done(next, stillNamed(next, ref) ? { note: `Other settings still name the agent ${ref}: the checks list where.` } : {});
  }
  const tools = list<Json>(next.tools);
  if (!tools.some((t) => t?.id === ref)) return refuse(config, 'That tool no longer exists.');
  next.tools = tools.filter((t) => t?.id !== ref) as AgentConfig['tools'];
  list<AgentRole>(next.agents?.items).forEach((a) => {
    if (Array.isArray(a?.tools)) a.tools = a.tools.filter((t) => t !== ref);
  });
  forget(next, [id]);
  return done(next, stillNamed(next, ref) ? { note: `Other settings still name the tool ${ref}: the checks list where.` } : {});
}

/** A copy of an agent or a tool, with ids of its own; the copy is selected. */
export function duplicateNode(config: AgentConfig, id: string): EditResult {
  const { kind, ref } = parseNodeId(id);
  if (kind === 'channel') return refuse(config, 'A bot has one channel of each kind, so a channel can’t be copied.');
  if (kind === 'knowledge') return refuse(config, 'Knowledge bases are copied on the Knowledge page.');
  const next = clone(config);
  if (kind === 'agent') {
    const source = findAgent(config, ref);
    if (!source) return refuse(config, 'That agent no longer exists.');
    const items = list<AgentRole>(next.agents?.items);
    const copy = clone(source);
    copy.id = freshId(items.map((a) => a?.id), `${ref}_copy`);
    copy.name = `${source.name || ref} (copy)`;
    const names = takenToolNames(next);
    const handoffIds = items.flatMap((a) => list<Json>(a?.handoffs).map((h) => String(h?.id ?? '')));
    copy.handoffs = list<Json>(copy.handoffs)
      .filter(isObj)
      .map((h) => {
        const tool = freshId(names, `${String(h.tool || 'go_to')}_copy`);
        names.push(tool);
        const hid = freshId(handoffIds, `${String(h.id || 'to')}_copy`);
        handoffIds.push(hid);
        return { ...h, id: hid, tool };
      });
    if (!copy.handoffs.length) delete copy.handoffs;
    next.agents = { ...(next.agents ?? {}), items: [...items, copy] };
    return done(next, { select: [copy.id] });
  }
  const tool = findTool(config, ref);
  if (!tool) return refuse(config, 'That tool no longer exists.');
  const copy = clone(tool);
  copy.id = freshId(takenToolNames(next), `${ref.replace(/-/g, '_')}_copy`);
  // Two tools may share the name the model sees only on channels that don't overlap.
  delete copy.name;
  next.tools = [...list<ToolDefinition>(next.tools), copy as ToolDefinition];
  return done(next, { select: [nodeId('tool', String(copy.id))], note: 'The copy isn’t used by any agent yet: connect an agent to it.' });
}

/** Makes an agent the one that answers first. */
export function setEntry(config: AgentConfig, agentId: string): AgentConfig {
  if (!findAgent(config, agentId) || config.agents?.entry === agentId) return config;
  const next = clone(config);
  next.agents = { ...(next.agents ?? {}), entry: agentId };
  return next;
}

// ---- the node library -----------------------------------------------------------------------------------------------
export type PresetCategory = 'Triggers' | 'Agents' | 'Logic' | 'Tools' | 'Actions';
export type PresetId =
  | 'web_chat'
  | 'web_voice'
  | 'sip_voice'
  | 'agent'
  | 'router'
  | 'conditional_handoff'
  | 'return_to_entry'
  | 'http'
  | 'code'
  | 'mcp'
  | 'knowledge_search'
  | 'transfer'
  | 'end_call'
  | 'collect_dtmf';

export interface Preset {
  id: PresetId;
  category: PresetCategory;
  label: string;
  text: string;
}

/** What can be added: only kinds the server's schema accepts and the editor writes in full. */
export const PRESETS: Preset[] = [
  { id: 'web_chat', category: 'Triggers', label: 'Web chat', text: 'A chat box on your website that visitors type into.' },
  { id: 'web_voice', category: 'Triggers', label: 'Website voice', text: 'Visitors talk to it from the browser, with their microphone.' },
  { id: 'sip_voice', category: 'Triggers', label: 'Phone', text: 'People ring a phone number. The number is connected when it goes live.' },
  { id: 'agent', category: 'Agents', label: 'AI agent', text: 'A specialist with its own instructions and tools. Only one agent talks at a time.' },
  { id: 'router', category: 'Logic', label: 'Router', text: 'A front-door agent that only works out what the person needs and hands off.' },
  { id: 'conditional_handoff', category: 'Logic', label: 'Conditional hand-off', text: 'A tool the agent calls; it hands off only when a condition holds (a channel, a state value).' },
  { id: 'return_to_entry', category: 'Logic', label: 'Back to the first agent', text: 'Lets a specialist pass the person back to the agent that answers first.' },
  { id: 'http', category: 'Tools', label: 'HTTP request', text: 'Calls a web API through a connection set up for this bot.' },
  { id: 'knowledge_search', category: 'Tools', label: 'Knowledge search', text: 'Searches a knowledge base when the agent decides it needs to.' },
  { id: 'mcp', category: 'Tools', label: 'MCP server tools', text: 'Exposes the tools you allow from an MCP server connection.' },
  { id: 'code', category: 'Tools', label: 'Code function', text: 'Runs a small function you wrote, in a sandbox.' },
  { id: 'transfer', category: 'Actions', label: 'Transfer to a person', text: 'Passes the call to your team; offers a callback when it can’t.' },
  { id: 'end_call', category: 'Actions', label: 'End conversation', text: 'Says goodbye, then ends the conversation.' },
  { id: 'collect_dtmf', category: 'Actions', label: 'Read keypad digits', text: 'On a phone call, reads digits the caller types on the keypad.' },
];

const firstConnection = (config: AgentConfig, type: string) => Object.entries(isObj(config.connections) ? (config.connections as Json) : {}).find(([, c]) => isObj(c) && c.type === type)?.[0];

const addLine = (next: AgentConfig, line: { id: string; text: string }) => {
  if (!list<Json>(next.messages).some((m) => m?.id === line.id)) next.messages = [...list<Json>(next.messages), { ...line }];
};

/**
 * Declares a connection from a typed web address and points a tool at it: an HTTP tool's `connection` (base_url), or an
 * MCP tool's `server` (url). Lets a dropped HTTP or MCP block be finished on the canvas. `problem` is set, and the config
 * unchanged, when the address cannot be used.
 */
export function addConnectionFor(config: AgentConfig, toolIndex: number, address: string): { config: AgentConfig; problem: string } {
  const tool = list<Json>(config.tools)[toolIndex];
  if (!isObj(tool) || (tool.type !== 'http' && tool.type !== 'mcp')) return { config, problem: 'Only HTTP and MCP tools use a connection.' };
  const typed = address.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`);
  } catch {
    return { config, problem: 'Type the address it answers on, for example https://api.example.com.' };
  }
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.') && url.hostname !== 'localhost') {
    return { config, problem: 'Type the address it answers on, for example https://api.example.com.' };
  }
  const next = clone(config);
  const connections = (isObj(next.connections) ? next.connections : {}) as Json;
  const isHttp = tool.type === 'http';
  const host = url.hostname.replace(/^www\./, '').split('.')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const id = freshId(Object.keys(connections), /^[a-z]/.test(host) ? host : isHttp ? 'api' : 'mcp_server');
  const where = `${url.origin}${url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')}`;
  connections[id] = isHttp ? { type: 'http', base_url: where } : { type: 'mcp', url: where };
  next.connections = connections;
  (list<Json>(next.tools)[toolIndex] as Json)[isHttp ? 'connection' : 'server'] = id;
  return { config: next, problem: '' };
}

/** Adds what a library item stands for. New tools are used by nobody until an agent is connected to them. */
export function addPreset(config: AgentConfig, preset: PresetId, { providers = null, botId = '' }: { providers?: ProvidersAnswer | null; botId?: string } = {}): EditResult {
  if (preset === 'web_chat' || preset === 'web_voice' || preset === 'sip_voice') {
    const type: ReachType = preset;
    const existing = channelsOf(config).find((c) => c.type === type);
    if (existing && existing.enabled !== false) return refuse(config, `It already has a ${CHANNEL_LABEL[type].toLowerCase()} channel.`, { select: [nodeId('channel', String(existing.id))] });
    const r = setReach(config, type, true, { providers, botId });
    const channel = channelsOf(r.config).find((c) => c.type === type);
    return done(r.config, { select: channel ? [nodeId('channel', String(channel.id))] : [], note: r.added.length ? `Added ${r.added.join(', ')}.` : undefined });
  }
  const next = clone(config);
  if (preset === 'agent' || preset === 'router') {
    const items = list<AgentRole>(next.agents?.items);
    const id = freshId(items.map((a) => a?.id), preset === 'router' ? 'router' : 'agent');
    const names = items.map((a) => a?.name);
    const base = preset === 'router' ? 'Router' : 'New agent';
    let name = base;
    for (let n = 2; names.includes(name); n++) name = `${base} ${n}`;
    const agent: AgentRole = { id, name, kind: preset === 'router' ? 'router' : 'specialist', instructions: { role: '' }, tools: [] };
    next.agents = { ...(next.agents ?? {}), items: [...items, agent] };
    if (!next.agents.entry) next.agents.entry = id;
    return done(next, { select: [id], note: 'Write what it does under Instructions: the server won’t publish an agent without them.' });
  }
  const tools = list<ToolDefinition>(next.tools);
  const fresh = (base: string) => freshId(takenToolNames(next), base);
  let tool: Json;
  switch (preset) {
    case 'conditional_handoff':
      tool = { id: fresh('route_on_condition'), type: 'builtin', builtin: 'noop', description: '', effects: [] };
      break;
    case 'return_to_entry':
      tool = { id: fresh('back_to_start'), type: 'builtin', builtin: 'return_to_entry', description: 'Use when the person needs something you don’t handle, to pass them back to the first agent.' };
      break;
    case 'http': {
      const connection = firstConnection(next, 'http');
      tool = { id: fresh('http_request'), type: 'http', description: '', ...(connection ? { connection } : {}), request: { method: 'GET', path: '/' }, parameters: { type: 'object', properties: {} } };
      break;
    }
    case 'code':
      tool = { id: fresh('code_function'), type: 'code', runtime: 'python', description: '', parameters: { type: 'object', properties: {} } };
      break;
    case 'mcp': {
      const server = firstConnection(next, 'mcp');
      tool = { id: fresh('mcp_tools'), type: 'mcp', description: '', ...(server ? { server } : {}), allow: [] };
      break;
    }
    case 'knowledge_search': {
      const base = basesOf(next).find((b) => !isInjected(b));
      tool = { id: fresh('search_knowledge'), type: 'knowledge', description: '', ...(base ? { source: base.id } : {}) };
      break;
    }
    case 'transfer': {
      addLine(next, CALLBACK_MESSAGE);
      const telephony = (isObj(next.telephony) ? next.telephony : {}) as Json;
      const transfers = list<Json>(telephony.transfers);
      const transferId = freshId(transfers.map((t) => String(t?.id ?? '')), 'human_support');
      telephony.transfers = [...transfers, { id: transferId, description: 'A person to take over. Until a number is set, callers hear the callback line.', method: 'sip_refer', target: '' }];
      next.telephony = telephony;
      tool = {
        id: fresh('escalate_to_human'),
        type: 'builtin',
        builtin: 'transfer_or_callback',
        description: 'Use when the caller asks for a person, or you cannot help them.',
        params: { transfer: transferId, fallback: [{ type: 'say', text: { message: CALLBACK_MESSAGE.id } }] },
      };
      break;
    }
    case 'end_call': {
      const existing = toolsOf(config).find((t) => isBuiltin(t as Json, 'end_call'));
      if (existing) return refuse(config, 'It already has a way to end the conversation: connect more agents to it.', { select: [nodeId('tool', existing.id)] });
      addLine(next, GOODBYE);
      tool = { id: fresh('end_call'), type: 'builtin', builtin: 'end_call', description: 'Ends the conversation. Use it after saying goodbye, when the person has nothing more to ask.', params: { say: { message: GOODBYE.id } } };
      break;
    }
    case 'collect_dtmf':
      tool = { id: fresh('read_keypad'), type: 'builtin', builtin: 'collect_dtmf', description: 'Use when you need the caller to type digits on their phone keypad.', params: {} };
      break;
    default:
      return refuse(config, 'That block can’t be added.');
  }
  next.tools = [...tools, tool as unknown as ToolDefinition];
  return done(next, { select: [nodeId('tool', String(tool.id))] });
}
