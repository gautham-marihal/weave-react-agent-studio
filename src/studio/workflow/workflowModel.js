// The Workflow of an agent as a picture you can edit: where a call starts, each agent, and what happens around them. Everything here is read from the
// configuration (and written back to it by workflowOps.js); nothing is stored that the runtime doesn't already understand, apart from where each block
// is drawn, which has its own place in the file (builder.ui.graph_positions). Pure: no React, no DOM.
//
// What a block is, in the configuration's own terms:
//   start      where a call begins; it leads to the agent that answers first (agents.entry)
//   agent      an agent (agents.items[]), shown as a "Subagent"
//   say, state, step, end, transfer (before an agent)   the actions an agent runs when it takes over (agent.on_enter)
//   end, transfer, tool (after an agent)                what an agent is able to do: the tools it offers (agent.tools)
// And what an arrow is: a hand-over to another agent (agent.handoffs, or an on_enter or tool step that hands over), a tool's own hand-over, a safety
// rule's hand-over, "back to the first agent", or the plain link between an agent and one of its blocks.

import { isObj } from '../form/engine.js';
import { BUILTIN_WORDS, plainKind } from '../form/plainKinds.js';
import { speechText } from '../../demo/simulatedAgent.js';
import { buildAgentMap } from '../relations/agentMap.js';

const list = (v) => (Array.isArray(v) ? v : []);
export const SIZE = { start: { w: 236, h: 72 }, agent: { w: 236, h: 92 }, step: { w: 216, h: 60 } };
const GAP = { col: 56, row: 112, stack: 14 };
const PAD = 40;

export const enterId = (agentId, index) => `${agentId}::enter::${index}`;
export const toolNodeId = (agentId, toolId) => `${agentId}::tool::${toolId}`;
export function parseNodeId(id) {
  const parts = String(id).split('::');
  if (parts.length === 3 && parts[1] === 'enter') return { agent: parts[0], kind: 'enter', index: Number(parts[2]) };
  if (parts.length === 3 && parts[1] === 'tool') return { agent: parts[0], kind: 'tool', tool: parts[2] };
  if (id === 'start') return { kind: 'start' };
  return { kind: 'agent', agent: String(id) };
}

const humanize = (text) =>
  String(text || '')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
const clip = (text, n) => {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// One action of an agent's "when it takes over" list, as a block (or null when it is really a hand-over, which is an arrow).
function enterBlock(action, config) {
  if (!isObj(action)) return null;
  switch (action.type) {
    case 'say':
      return { type: 'say', label: 'Say', sub: clip(speechText(action.text, config), 70) || 'Nothing to say yet' };
    case 'generate':
      return { type: 'say', label: 'Say (written by the AI)', sub: clip(action.instructions, 70) };
    case 'set_state': {
      const pairs = Object.entries(isObj(action.values) ? action.values : {}).map(([k, v]) => `${k} = ${typeof v === 'string' ? v : JSON.stringify(v)}`);
      return { type: 'state', label: 'Update state', sub: clip(pairs.join(', '), 70) || 'Choose what to set' };
    }
    case 'end_call':
      return { type: 'end', label: 'End the call', sub: clip(speechText(action.say, config), 60) };
    case 'transfer': {
      const transfer = list(config?.telephony?.transfers).find((t) => isObj(t) && t.id === action.transfer);
      return { type: 'transfer', label: 'Phone number transfer', ...numberWords(transfer) };
    }
    case 'send_form':
      return { type: 'step', label: 'Show a form', sub: action.form || '' };
    case 'notify':
      return { type: 'step', label: 'Send a message', sub: action.notification || '' };
    case 'wrapup':
      return { type: 'step', label: 'Wrap up the call', sub: action.wrapup || '' };
    case 'http':
      return { type: 'step', label: 'Ask another system', sub: action.path || '' };
    case 'play_sound':
      return { type: 'step', label: 'Play a sound', sub: '' };
    case 'log':
      return { type: 'step', label: 'Write to the log', sub: '' };
    default:
      return { type: 'step', label: humanize(action.type || 'Step'), sub: '' };
  }
}

// How a number or lookup reads on a transfer block.
function targetWords(target) {
  if (typeof target === 'string') return target.trim();
  if (isObj(target) && target.secret) return `from the secret ${target.secret}`;
  if (isObj(target) && target.lookup) return 'chosen by what the caller wants';
  return '';
}
// A transfer block's line: where calls go, or (with no number yet) what callers get instead, marked so the block can say it needs one.
const NO_NUMBER = 'No number yet: callers are offered a callback';
function numberWords(transfer) {
  const words = clip(targetWords(transfer?.target), 40);
  return words ? { sub: words } : { sub: NO_NUMBER, noNumber: true };
}

export function buildWorkflow(config, { tools = true } = {}) {
  const agents = list(config?.agents?.items).filter((a) => isObj(a) && typeof a.id === 'string' && a.id);
  const empty = agents.length === 0;
  const ids = new Set(agents.map((a) => a.id));
  const entry = ids.has(config?.agents?.entry) ? config.agents.entry : agents[0]?.id || '';
  const toolsById = new Map(
    list(config?.tools)
      .filter(isObj)
      .map((t) => [t.id, t]),
  );
  const transfersById = new Map(
    list(config?.telephony?.transfers)
      .filter(isObj)
      .map((t) => [t.id, t]),
  );
  const saved = isObj(config?.builder?.ui?.graph_positions) ? config.builder.ui.graph_positions : {};
  const greeting = list(config?.channels).find((c) => isObj(c) && c.greeting && c.greeting.say !== undefined);

  const nodes = [];
  const edges = [];
  const edgeIds = new Set();
  const addEdge = (edge) => {
    let id = edge.id;
    for (let n = 2; edgeIds.has(id); n += 1) id = `${edge.id}#${n}`;
    edgeIds.add(id);
    edges.push({ ...edge, id });
  };

  // what it says first, on the block (in full in its tooltip)
  const first = greeting ? speechText(greeting.greeting.say, config) : '';
  nodes.push({
    id: 'start',
    type: 'start',
    label: 'Start',
    sub: first ? `Says “${clip(first, 54)}”` : 'Waits for the caller to speak first',
    full: first,
    ...SIZE.start,
  });
  if (entry) addEdge({ id: `start->${entry}`, from: 'start', to: entry, kind: 'start', label: '' });

  // the built-in tools that let a call leave an agent: hanging up, passing to a person, going back to the agent that answers first
  const LEAVING = ['end_call', 'transfer_or_callback', 'return_to_entry'];
  const leavesBy = (toolId) => {
    const tool = list(config?.tools).find((t) => isObj(t) && t.id === toolId);
    return !!tool && (tool.type === 'builtin' || (!tool.type && tool.builtin)) && LEAVING.includes(tool.builtin);
  };
  agents.forEach((agent, index) => {
    const offered = list(agent.tools).filter((t) => typeof t === 'string');
    // a subagent a call can reach but never leave: it can't hang up, hand over or pass the caller back (the one that answers first is left alone: a
    // caller can always end a call it starts)
    const deadEnd =
      agent.id !== entry &&
      !list(agent.handoffs).some((h) => isObj(h) && h.to) &&
      !list(agent.on_enter).some((a) => isObj(a) && (a.type === 'handoff' || a.type === 'return_to_entry')) &&
      !offered.some(leavesBy);
    nodes.push({
      id: agent.id,
      type: 'agent',
      label: agent.name || agent.id,
      sub: plainKind(agent.kind) || 'Agent',
      kind: agent.kind || '',
      index,
      entry: agent.id === entry,
      detail: `${offered.length} tool${offered.length === 1 ? '' : 's'}`,
      deadEnd,
      ...SIZE.agent,
    });

    // what it does as it takes over
    list(agent.on_enter).forEach((action, i) => {
      if (isObj(action) && action.type === 'handoff' && typeof action.to === 'string') {
        addEdge({
          id: `${agent.id}->${action.to}::enter${i}`,
          from: agent.id,
          to: action.to,
          kind: 'handoff',
          label: 'as soon as it takes over',
          ref: { agent: agent.id, enter: i },
        });
        return;
      }
      if (isObj(action) && action.type === 'return_to_entry') {
        addEdge({
          id: `${agent.id}->${entry}::enter${i}`,
          from: agent.id,
          to: entry,
          kind: 'return',
          label: 'back to the start',
          ref: { agent: agent.id, enter: i },
        });
        return;
      }
      const block = enterBlock(action, config);
      if (!block) return;
      const id = enterId(agent.id, i);
      nodes.push({ id, agent: agent.id, role: 'enter', index: i, ...block, ...SIZE.step });
      addEdge({ id: `${id}->${agent.id}`, from: id, to: agent.id, kind: 'enter', label: '' });
    });

    // what it can do
    offered.forEach((toolId) => {
      const tool = toolsById.get(toolId);
      const builtin = tool && (tool.type === 'builtin' || (!tool.type && tool.builtin)) ? tool.builtin : '';
      if (builtin === 'return_to_entry') {
        if (entry && entry !== agent.id)
          addEdge({
            id: `${agent.id}->${entry}::back:${toolId}`,
            from: agent.id,
            to: entry,
            kind: 'return',
            label: 'back to the start',
            ref: { agent: agent.id, tool: toolId },
          });
        return;
      }
      const type = builtin === 'end_call' ? 'end' : builtin === 'transfer_or_callback' ? 'transfer' : 'tool';
      if (type === 'tool' && !tools) return;
      const transfer = type === 'transfer' ? transfersById.get(tool?.params?.transfer) : null;
      const number = type === 'transfer' ? numberWords(transfer) : null;
      const id = toolNodeId(agent.id, toolId);
      nodes.push({
        id,
        agent: agent.id,
        role: 'exit',
        type,
        tool: toolId,
        shared: agents.filter((a) => list(a.tools).includes(toolId)).length,
        label: type === 'end' ? 'End the call' : type === 'transfer' ? 'Phone number transfer' : tool?.name || toolId,
        sub:
          type === 'end'
            ? clip(speechText(tool?.params?.say, config), 60) || 'Says goodbye, then hangs up'
            : type === 'transfer'
              ? number.sub
              : tool
                ? BUILTIN_WORDS[builtin] || plainKind(tool.type)
                : 'Missing tool',
        missing: !tool,
        noNumber: !!number?.noNumber,
        ...SIZE.step,
      });
      addEdge({ id: `${agent.id}->${id}`, from: agent.id, to: id, kind: type === 'tool' ? 'uses' : 'exit', label: '' });
    });
  });

  // hand-overs between agents
  agents.forEach((agent) =>
    list(agent.handoffs).forEach((h, i) => {
      if (isObj(h) && typeof h.to === 'string' && ids.has(h.to))
        addEdge({
          id: `${agent.id}->${h.to}::h${i}`,
          from: agent.id,
          to: h.to,
          kind: 'handoff',
          label: clip(h.description, 38),
          full: h.description || '',
          ref: { agent: agent.id, handoff: i },
        });
    }),
  );
  // a tool or a safety rule that hands over: the same arrows the agent map draws
  buildAgentMap(config)
    .edges.filter((e) => e.kind !== 'handoff')
    .forEach((e) =>
      addEdge({
        id: `${e.from}->${e.to}::${e.kind}`,
        from: e.from,
        to: e.to,
        kind: e.kind,
        label: e.labels.length === 1 ? e.labels[0] : e.labels.length ? `${e.labels.length} ways` : '',
        full: e.labels.join(', '),
        ref: { derived: e.kind, ids: e.labels, to: e.to, from: e.from },
      }),
    );

  const displaced = layout(nodes, edges, { entry, saved });
  const right = Math.max(0, ...nodes.map((n) => n.x + n.w));
  const bottom = Math.max(0, ...nodes.map((n) => n.y + n.h));
  const stranded = nodes.filter((n) => n.type === 'agent' && n.stranded);
  return {
    nodes,
    edges,
    entry,
    empty,
    stranded: stranded.map((n) => n.label),
    strandedIds: stranded.map((n) => n.id),
    crowded: displaced >= 3,
    bounds: { w: right + PAD, h: bottom + PAD },
    toolBlocks: tools ? nodes.filter((n) => n.type === 'tool').length : toolBlockCount(config),
  };
}

export function toolBlockCount(config) {
  const toolsById = new Map(
    list(config?.tools)
      .filter(isObj)
      .map((t) => [t.id, t]),
  );
  return list(config?.agents?.items)
    .filter(isObj)
    .reduce(
      (sum, a) =>
        sum +
        list(a.tools).filter((id) => {
          const t = toolsById.get(id);
          const b = t && (t.type === 'builtin' || (!t.type && t.builtin)) ? t.builtin : '';
          return !['end_call', 'transfer_or_callback', 'return_to_entry'].includes(b);
        }).length,
      0,
    );
}

// Where each block goes when nobody has moved it: the agent that answers first at the top, the agents it hands over to below it, row by row, with what an
// agent does as it takes over on its left and what it can do on its right. A block somebody dragged keeps the place saved for it; the blocks of an agent that
// was dragged and have no place of their own follow it.
function layout(nodes, edges, { entry, saved }) {
  const crowded = { count: 0 };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const agentNodes = nodes.filter((n) => n.type === 'agent');
  const layer = new Map();
  if (entry) {
    layer.set(entry, 0);
    const queue = [entry];
    while (queue.length) {
      const at = queue.shift();
      edges
        .filter((e) => e.from === at && byId.get(e.to)?.type === 'agent' && e.to !== at && e.kind !== 'return' && !layer.has(e.to))
        .forEach((e) => {
          layer.set(e.to, layer.get(at) + 1);
          queue.push(e.to);
        });
    }
  }
  const last = Math.max(-1, ...layer.values());
  // an agent that no hand-over leads to from where a call starts can never be reached
  agentNodes.forEach((n) => {
    n.stranded = !layer.has(n.id);
  });
  agentNodes.forEach((n) => {
    if (!layer.has(n.id)) layer.set(n.id, last + 1);
  });
  const rows = [];
  agentNodes.forEach((n) => {
    (rows[layer.get(n.id)] ||= []).push(n);
  });

  const stackH = (count) => (count ? count * SIZE.step.h + (count - 1) * GAP.stack : 0);
  const defaults = new Map();
  let y = PAD + SIZE.start.h + GAP.row;
  rows.filter(Boolean).forEach((row) => {
    let x = PAD;
    let blockH = 0;
    row.forEach((agent) => {
      const enters = nodes.filter((n) => n.agent === agent.id && n.role === 'enter');
      const exits = nodes.filter((n) => n.agent === agent.id && n.role === 'exit');
      const leftW = enters.length ? SIZE.step.w + GAP.col : 0;
      const rightW = exits.length ? GAP.col + SIZE.step.w : 0;
      const h = Math.max(SIZE.agent.h, stackH(enters.length), stackH(exits.length));
      defaults.set(agent.id, { x: x + leftW, y: y + (h - SIZE.agent.h) / 2 });
      enters.forEach((n, i) => defaults.set(n.id, { x, y: y + (h - stackH(enters.length)) / 2 + i * (SIZE.step.h + GAP.stack) }));
      exits.forEach((n, i) =>
        defaults.set(n.id, { x: x + leftW + SIZE.agent.w + GAP.col, y: y + (h - stackH(exits.length)) / 2 + i * (SIZE.step.h + GAP.stack) }),
      );
      x += leftW + SIZE.agent.w + rightW + GAP.col * 2;
      blockH = Math.max(blockH, h);
    });
    y += blockH + GAP.row;
  });
  const entryAt = defaults.get(entry);
  defaults.set('start', { x: entryAt ? entryAt.x + SIZE.agent.w / 2 - SIZE.start.w / 2 : PAD, y: PAD });

  const place = (id) => {
    const s = saved[id];
    return isObj(s) && Number.isFinite(s.x) && Number.isFinite(s.y) ? { x: s.x, y: s.y } : null;
  };
  // blocks with a place of their own first; then the rest where they would go, moved aside only as far as needed so nothing lies on top of anything else
  // (a layout saved by another tool knows only the agents, not what goes with them)
  const taken = [];
  const free = (x, y, n) => !taken.some((t) => x < t.x + t.w + 16 && x + n.w + 16 > t.x && y < t.y + t.h + 16 && y + n.h + 16 > t.y);
  const settle = (n, want) => {
    let at = want;
    if (!free(want.x, want.y, n)) {
      search: for (let k = 1; k < 60; k += 1) {
        const dy = k * (n.h + 20);
        for (const [cx, cy] of [
          [0, dy],
          [0, -dy],
          [k * (n.w + 20), 0],
          [-k * (n.w + 20), 0],
          [k * (n.w + 20), dy],
          [-k * (n.w + 20), dy],
        ]) {
          const x = want.x + cx;
          const y = want.y + cy;
          if (x >= 8 && y >= 8 && free(x, y, n)) {
            at = { x, y };
            break search;
          }
        }
      }
    }
    if (at !== want) crowded.count += 1;
    n.x = at.x;
    n.y = at.y;
    taken.push(n);
  };
  const own = nodes.filter((n) => place(n.id));
  own.forEach((n) => {
    const p = place(n.id);
    n.x = p.x;
    n.y = p.y;
    n.moved = true;
    taken.push(n);
  });
  const rest = nodes.filter((n) => !place(n.id));
  // agents and the start block before the blocks that go with them
  [...rest.filter((n) => !n.role), ...rest.filter((n) => n.role)].forEach((n) => {
    const base = defaults.get(n.id) || { x: PAD, y: PAD };
    const owner = n.agent && n.role ? byId.get(n.agent) : null;
    if (owner) {
      const at = defaults.get(owner.id);
      settle(n, { x: owner.x + (base.x - at.x), y: owner.y + (base.y - at.y) });
    } else settle(n, base);
  });
  return crowded.count;
}

// A readable sentence for each way a caller can get from one block to another, for the list under the picture.
export function describeWorkflow(flow) {
  return describeItems(flow).map((i) => i.text);
}

// The same sentences, each with the arrow it describes, so the list can be used to pick one.
export function describeItems(flow) {
  const name = (id) => flow.nodes.find((n) => n.id === id)?.label || id;
  const how = {
    handoff: 'hands the caller to',
    tool: 'can pass the caller to',
    rule: 'passes the caller, under a safety rule, to',
    return: 'sends the caller back to',
  };
  return flow.edges.map((e) => ({ id: e.id, text: sentence(e) }));
  function sentence(e) {
    if (e.kind === 'start') return `A call starts with ${name(e.to)}.`;
    if (e.kind === 'enter') return `${name(e.from)}: when ${name(e.to)} takes over (${flow.nodes.find((n) => n.id === e.from)?.sub || 'no details yet'}).`;
    if (e.kind === 'exit') {
      const to = flow.nodes.find((n) => n.id === e.to);
      if (to?.type !== 'transfer') return `${name(e.from)} can end the call.`;
      return to.noNumber
        ? `${name(e.from)} can pass the caller to a person, but has no number yet: callers are offered a callback.`
        : `${name(e.from)} can pass the caller to a person (${to.sub}).`;
    }
    if (e.kind === 'uses') return `${name(e.from)} can use ${name(e.to)}.`;
    // the arrow's own words end with the sentence's full stop, not one of their own inside the brackets
    return `${name(e.from)} ${how[e.kind]} ${name(e.to)}${e.label ? ` (${(e.full || e.label).replace(/[.\s]+$/, '')})` : ''}.`;
  }
}
