// The Workflow of an agent as a picture you can edit: where a call starts, each agent, and what happens around them.
// Everything here is read from the configuration (and written back to it by workflowOps.js); nothing is stored that the
// runtime doesn't already understand, apart from where each block is drawn, which has its own place in the file
// (builder.ui.graph_positions). Pure: no React, no DOM.
//
// It reads left to right, as a call goes. What a block is, in the configuration's own terms:
//   trigger    a channel a call or a chat comes in on (channels[]), with what
//              it says first; it leads to the subagent that answers first (agents.entry).
//              With no channel, one "Start".
//   agent      a subagent (agents.items[]): the parts of this agent's workflow
//   (the agents themselves are the workspace's: Voice test, Support Agent…)
//   say, state, step, end, transfer (left of a subagent)   what it does as it takes over (agent.on_enter)
//   end, transfer, agentTransfer (right of a subagent)     where it can send the caller: hang up, a person's number, another of your agents
//   model, knowledge, tool (plugged in under a subagent)   what it uses: its AI model, the knowledge it reads, its tools
// And what an arrow is: a hand-over to another agent (agent.handoffs, or an on_enter or tool step that hands over), a tool's own hand-over, a safety
// rule's hand-over, "back to the first agent", or the plain link between an agent and one of its blocks.

import { isObj } from '../form/engine.js';
import { BUILTIN_WORDS, plainKind, plainToolKind } from '../form/plainKinds.js';
import { speechText } from '../../demo/simulatedAgent.js';
import { buildAgentMap } from '../relations/agentMap.js';
import { channelLabel, humanize } from '../agent/rowNames.js';
import { readModels } from '../models/config.js';
import { modelLabel } from '../models/catalog.js';
import { KNOWLEDGE_ID } from '../setup/setupModel.js';
import dagre from '@dagrejs/dagre';
import { textWidth, wrapText } from './textMeasure.js';
import { planLanes } from './edgeLanes.js';

const list = (v) => (Array.isArray(v) ? v : []);
// a block is its icon, its name and one grey line (the rest is in its tooltip and its panel); a plug-in is a round icon with its name under it
export const SIZE = { start: { w: 196, h: 60 }, trigger: { w: 196, h: 60 }, agent: { w: 256, h: 76 }, step: { w: 208, h: 60 }, plug: { w: 84, h: 88 } };
// plug: a subagent and what is plugged in under it; plugs: one plug-in and the next
const GAP = { plug: 56, plugs: 16 };
// no line leaves or reaches a block nearer its top or bottom than this
const PORT_INSET = 10;
const PAD = 40;
// the nearest a block comes to the picture's top and left edges (the canvas keeps a dragged block there too)
export const EDGE = 8;

// the Start block's id (an agent with no channel): never an agent's (agent ids have no colon, and a subagent named "Start" has the id "start")
export const START_ID = '::start';
export const triggerId = (channelId) => `::channel::${channelId}`;
export const enterId = (agentId, index) => `${agentId}::enter::${index}`;
export const toolNodeId = (agentId, toolId) => `${agentId}::tool::${toolId}`;
export const modelNodeId = (agentId) => `${agentId}::model`;
export const knowledgeNodeId = (agentId, baseId) => `${agentId}::knowledge::${baseId}`;
export function parseNodeId(id) {
  const text = String(id);
  if (text === START_ID) return { kind: 'start' };
  if (text.startsWith('::channel::')) return { kind: 'trigger', channel: text.slice('::channel::'.length) };
  const parts = text.split('::');
  if (parts.length === 3 && parts[1] === 'enter') return { agent: parts[0], kind: 'enter', index: Number(parts[2]) };
  if (parts.length === 3 && parts[1] === 'tool') return { agent: parts[0], kind: 'tool', tool: parts[2] };
  if (parts.length === 3 && parts[1] === 'knowledge') return { agent: parts[0], kind: 'knowledge', base: parts[2] };
  if (parts.length === 2 && parts[1] === 'model') return { agent: parts[0], kind: 'model' };
  if (parts.length === 3 && parts[1] === 'back') return { agent: parts[0], kind: 'back', ref: parts[2] };
  return { kind: 'agent', agent: text };
}
// where a call begins: a channel's block, or Start
export const isTriggerId = (id) => id === START_ID || String(id).startsWith('::channel::');

// words as they are, on one line of text (spaces and line ends made one); never cut: a block grows to hold them
const clip = (text) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .trim();

// One action of an agent's "when it takes over" list, as a block (or null when it is really a hand-over, which is an arrow).
function enterBlock(action, config) {
  if (!isObj(action)) return null;
  switch (action.type) {
    case 'say':
      return { type: 'say', label: 'Say', sub: clip(speechText(action.text, config)) || 'Nothing to say yet' };
    case 'generate':
      return { type: 'say', label: 'Say (written by the AI)', sub: clip(action.instructions) };
    case 'set_state': {
      const pairs = Object.entries(isObj(action.values) ? action.values : {}).map(([k, v]) => `${k} = ${typeof v === 'string' ? v : JSON.stringify(v)}`);
      return { type: 'state', label: 'Update state', sub: clip(pairs.join(', ')) || 'Choose what to set' };
    }
    case 'end_call':
      return { type: 'end', label: 'End', sub: clip(speechText(action.say, config)) };
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
  const words = clip(targetWords(transfer?.target));
  return words ? { sub: words } : { sub: NO_NUMBER, noNumber: true };
}

// The other agent of the workspace a number reaches (workspace: { agents: [{ id, name, numbers: [{ number }] }] }), or null. Numbers are compared by
// their digits and letters only ("+1 (800) 555-0100" is "18005550100"); a SIP address names its number before the "@".
const plainNumber = (v) =>
  String(v ?? '')
    .replace(/^(sips?|tel):/i, '')
    .replace(/@.*$/, '')
    .replace(/[^0-9a-z]+/gi, '')
    .toLowerCase();
export function agentByNumber(target, workspace) {
  const wanted = typeof target === 'string' ? plainNumber(target) : '';
  if (!wanted) return null;
  return list(workspace?.agents).find((a) => list(a.numbers).some((n) => plainNumber(n.number) === wanted)) || null;
}

// A tool by the name its row has on the Tools page (its id in words: "Verify caller"); its `name` is what the AI calls
// it, and two tools may share one.
export const toolName = (toolId) => humanize(toolId) || String(toolId || '');
// A tool's name and its line, as its block shows them (and the agent's list of tools in the panel).
export function toolTitle(tool, config = null, workspace = null) {
  const builtin = tool && (tool.type === 'builtin' || (!tool.type && tool.builtin)) ? tool.builtin : '';
  if (builtin === 'end_call') return { label: 'End', sub: 'Says goodbye, then ends the conversation' };
  if (builtin === 'transfer_or_callback') {
    const transfer = list(config?.telephony?.transfers).find((t) => isObj(t) && t.id === tool.params?.transfer);
    const reached = agentByNumber(transfer?.target, workspace);
    if (reached) return { label: `Transfer to ${reached.name}`, sub: 'Agent transfer', agent: reached.id };
    return { label: 'Phone number transfer', sub: config ? numberWords(transfer).sub : BUILTIN_WORDS[builtin] || '' };
  }
  return { label: toolName(tool?.id), sub: plainToolKind(tool) || '' };
}

// The AI model a subagent talks with: its own, the default, or a realtime model (which listens and speaks itself).
function modelOf(agent, config) {
  const own = isObj(agent.overrides?.models) ? agent.overrides.models : {};
  const realtime = isObj(own.realtime)
    ? own.realtime
    : own.realtime === undefined && isObj(config?.defaults?.models?.realtime)
      ? config.defaults.models.realtime
      : null;
  if (realtime) return { label: realtime.model || 'Realtime model', sub: 'Realtime model', own: isObj(own.realtime) };
  const defaults = readModels(config).llm;
  const mine = isObj(own.llm) && own.llm.model ? own.llm : null;
  const provider = (mine && mine.provider) || defaults.provider;
  const model = mine ? mine.model : defaults.model;
  return { label: model ? modelLabel('llm', provider, model) : 'No model yet', sub: mine ? 'Its own model' : 'Default model', own: !!mine, missing: !model };
}

// workspace: the other agents and their numbers (useWorkspaceAgents), so a transfer to one of them is drawn as an Agent transfer
export function buildWorkflow(config, { tools = true, workspace = null } = {}) {
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
  const savedAll = isObj(config?.builder?.ui?.graph_positions) ? config.builder.ui.graph_positions : {};
  // the Start block's place was once saved as "start": still read, unless an agent has that id
  const saved = !savedAll[START_ID] && savedAll.start && !ids.has('start') ? { ...savedAll, [START_ID]: savedAll.start } : savedAll;

  const nodes = [];
  const edges = [];
  const edgeIds = new Set();
  const addEdge = (edge) => {
    let id = edge.id;
    let n = 2;
    while (edgeIds.has(id)) {
      id = `${edge.id}#${n}`;
      n += 1;
    }
    edgeIds.add(id);
    edges.push({ ...edge, id });
  };

  // where a call comes in: each channel, with what it says first (one switched off is drawn faint); with no channel, Start
  // (`channelIndex` is the channel's place in config.channels itself, which the panel reads and writes, not its place among the ones drawn)
  const channels = list(config?.channels)
    .map((c, at) => ({ c, at }))
    .filter(({ c }) => isObj(c) && typeof c.id === 'string' && c.id);
  const triggers = channels.length
    ? channels.map(({ c, at }) => {
        const first = c.greeting?.say !== undefined ? speechText(c.greeting.say, config) : '';
        return {
          id: triggerId(c.id),
          type: 'trigger',
          role: 'trigger',
          channel: c.id,
          channelType: c.type,
          channelIndex: at,
          label: channelLabel(config, c.id),
          sub: c.enabled === false ? 'Switched off' : first ? `Says “${clip(first)}”` : 'Waits for the caller to speak first',
          full: first,
          off: c.enabled === false,
          ...SIZE.trigger,
        };
      })
    : [{ id: START_ID, type: 'trigger', role: 'trigger', label: 'Start', sub: 'No channel yet', full: '', ...SIZE.trigger }];
  triggers.forEach((t) => {
    nodes.push(t);
    if (entry) addEdge({ id: `${t.id}->${entry}`, from: t.id, to: entry, kind: 'start', off: !!t.off, label: '' });
  });

  // A way back to the subagent that answers first: its arrow is kept (the lists and the checks read it) but drawn as a
  // small block beside the subagent, "Back to <first subagent>", so no line runs back across the whole picture.
  const entryName = agents.find((a) => a.id === entry)?.name || entry;
  const backTo = (agent, edgeId, ref, nodeId) => {
    addEdge({ id: edgeId, from: agent.id, to: entry, kind: 'return', label: 'back to the start', ref, hidden: true });
    nodes.push({
      id: nodeId,
      agent: agent.id,
      role: 'exit',
      type: 'back',
      label: `Back to ${entryName}`,
      sub: 'Passes the caller back',
      edge: edgeId,
      ...SIZE.step,
    });
    addEdge({ id: `${agent.id}->${nodeId}`, from: agent.id, to: nodeId, kind: 'exit', stub: true, label: '', ref });
  };

  // the built-in tools that let a call leave an agent: hanging up, passing to a person, going back to the agent that answers first
  const LEAVING = ['end_call', 'transfer_or_callback', 'return_to_entry'];
  // a step that takes the call away from the agent: hanging up, a transfer, going back, or a hand-over to an agent that is there
  const leavesWith = (action) =>
    isObj(action) && (['end_call', 'transfer', 'return_to_entry'].includes(action.type) || (action.type === 'handoff' && ids.has(action.to)));
  const leavesBy = (toolId) => {
    const tool = list(config?.tools).find((t) => isObj(t) && t.id === toolId);
    if (!tool) return false;
    if ((tool.type === 'builtin' || (!tool.type && tool.builtin)) && LEAVING.includes(tool.builtin)) return true;
    // any tool whose effects hand over, hang up or transfer (the canvas draws its arrow)
    return list(tool.effects).some((rule) => isObj(rule) && list(rule.do).some(leavesWith));
  };
  agents.forEach((agent, index) => {
    const offered = list(agent.tools).filter((t) => typeof t === 'string');
    // a subagent a call can reach but never leave: it can't hang up, hand over or pass the caller back (the one that answers first is left alone: a
    // caller can always end a call it starts)
    const deadEnd =
      agent.id !== entry && !list(agent.handoffs).some((h) => isObj(h) && ids.has(h.to)) && !list(agent.on_enter).some(leavesWith) && !offered.some(leavesBy);
    nodes.push({
      id: agent.id,
      type: 'agent',
      label: agent.name || agent.id,
      sub: plainKind(agent.kind) || 'Agent',
      kind: agent.kind || '',
      index,
      entry: agent.id === entry,
      detail: `${offered.length} tool${offered.length === 1 ? '' : 's'}`,
      // the start of what it is told to do, the grey line of its block
      brief: clip(String(agent.instructions?.role || '').split(/(?<=[.!?])\s/)[0]),
      deadEnd,
      // hand-overs to an agent that no longer exists: no arrow, listed in its panel to be taken away
      broken: [
        ...list(agent.handoffs).flatMap((h, i) => (isObj(h) && typeof h.to === 'string' && !ids.has(h.to) ? [{ handoff: i, to: h.to }] : [])),
        ...list(agent.on_enter).flatMap((a, i) =>
          isObj(a) && a.type === 'handoff' && typeof a.to === 'string' && !ids.has(a.to) ? [{ enter: i, to: a.to }] : [],
        ),
      ],
      ...SIZE.agent,
    });

    // plugged in underneath: its AI model, and the knowledge it reads on every turn
    if (tools) {
      const model = modelOf(agent, config);
      nodes.push({ id: modelNodeId(agent.id), agent: agent.id, role: 'plug', port: 'model', type: 'model', ...model, ...SIZE.plug });
      addEdge({ id: `${agent.id}->${modelNodeId(agent.id)}`, from: agent.id, to: modelNodeId(agent.id), kind: 'plug', port: 'model', label: '' });
      list(agent.knowledge)
        .filter((k) => typeof k === 'string' && k)
        .forEach((baseId) => {
          const base = list(config?.knowledge).find((b) => isObj(b) && b.id === baseId);
          const id = knowledgeNodeId(agent.id, baseId);
          nodes.push({
            id,
            agent: agent.id,
            role: 'plug',
            port: 'knowledge',
            type: 'knowledge',
            base: baseId,
            label: baseId === KNOWLEDGE_ID ? 'What it knows' : humanize(baseId),
            sub: base ? 'Knowledge' : 'Missing knowledge',
            missing: !base,
            ...SIZE.plug,
          });
          addEdge({ id: `${agent.id}->${id}`, from: agent.id, to: id, kind: 'plug', port: 'knowledge', label: '' });
        });
    }

    // what it does as it takes over
    list(agent.on_enter).forEach((action, i) => {
      if (isObj(action) && action.type === 'handoff' && typeof action.to === 'string') {
        if (!ids.has(action.to)) return;
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
        if (entry && entry !== agent.id) backTo(agent, `${agent.id}->${entry}::enter${i}`, { agent: agent.id, enter: i }, `${agent.id}::back::enter${i}`);
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
          backTo(agent, `${agent.id}->${entry}::back:${toolId}`, { agent: agent.id, tool: toolId }, `${agent.id}::back::${toolId}`);
        return;
      }
      const type = builtin === 'end_call' ? 'end' : builtin === 'transfer_or_callback' ? 'transfer' : 'tool';
      if (type === 'tool' && !tools) return;
      const transfer = type === 'transfer' ? transfersById.get(tool?.params?.transfer) : null;
      const reached = type === 'transfer' ? agentByNumber(transfer?.target, workspace) : null;
      const number = type === 'transfer' && !reached ? numberWords(transfer) : null;
      const id = toolNodeId(agent.id, toolId);
      const kind = reached ? 'agentTransfer' : type;
      nodes.push({
        id,
        agent: agent.id,
        role: kind === 'tool' ? 'plug' : 'exit',
        ...(kind === 'tool' ? { port: 'tool' } : {}),
        type: kind,
        tool: toolId,
        // an Agent transfer: the agent it reaches, and the number it reaches it on
        ...(reached ? { bot: reached.id, number: transfer.target } : {}),
        shared: agents.filter((a) => list(a.tools).includes(toolId)).length,
        label: kind === 'end' ? 'End' : kind === 'agentTransfer' ? reached.name : kind === 'transfer' ? 'Phone number transfer' : toolName(toolId),
        sub:
          kind === 'end'
            ? clip(speechText(tool?.params?.say, config)) || 'Says goodbye, then ends the conversation'
            : kind === 'agentTransfer'
              ? 'Agent transfer'
              : kind === 'transfer'
                ? number.sub
                : tool
                  ? plainToolKind(tool)
                  : 'Missing tool',
        missing: !tool,
        noNumber: !!number?.noNumber,
        ...(kind === 'tool' ? SIZE.plug : SIZE.step),
      });
      // a transfer's arrow says when it is taken (the tool's own words), as a hand-over's does
      const when = type === 'transfer' && typeof tool?.description === 'string' ? tool.description.trim() : '';
      addEdge({
        id: `${agent.id}->${id}`,
        from: agent.id,
        to: id,
        kind: type === 'tool' ? 'uses' : 'exit',
        ...(type === 'tool' ? { port: 'tool' } : {}),
        label: type === 'transfer' ? clip(when) : '',
        full: when,
        missing: type === 'transfer' && !!tool && !when,
      });
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
          label: clip(h.description),
          full: h.description || '',
          // nothing says when it is taken: the agent can't know when to hand over
          missing: !String(h.description || '').trim(),
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
        label: e.labels.length === 1 ? toolName(e.labels[0]) : e.labels.length ? `${e.labels.length} ways` : '',
        full: e.labels.map(toolName).join(', '),
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
    crowded: displaced > 0,
    // "who answers first" names no agent: the first is used, and the panel asks for one
    entryUnset: !empty && !ids.has(config?.agents?.entry),
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

// Every block as big as its words (none is cut): a fixed width, as tall as its name and its line wrap to.
const FONTS = { name: { size: 13, weight: 600 }, line: { size: 12, weight: 400 }, plug: { size: 12, weight: 600 }, label: { size: 12, weight: 500 } };
const LINE = { name: 17, line: 16, plug: 15 };
function sizeBlocks(nodes) {
  nodes.forEach((n) => {
    if (n.role === 'plug') {
      n.w = SIZE.plug.w;
      // a little narrower than the plug-in, so a font a hair wider than measured still fits
      const nameLines = wrapText(n.label, n.w - 8, FONTS.plug).length || 1;
      const subLines = n.sub ? wrapText(n.sub, n.w - 8, FONTS.line).length : 0;
      n.h = 48 + 6 + nameLines * LINE.plug + subLines * LINE.plug + 10;
      return;
    }
    const base = n.type === 'agent' ? SIZE.agent : n.role === 'trigger' ? SIZE.trigger : SIZE.step;
    n.w = base.w;
    // the words' width: the block less its padding, its icon and the gap after it
    const room = n.w - 24 - 32 - 10 - (n.role === 'trigger' ? 8 : 0) - 4;
    const nameLines = wrapText(n.label, room, FONTS.name).length || 1;
    const line = n.type === 'agent' ? n.brief || n.sub : n.sub;
    const lineLines = line ? wrapText(line, room, FONTS.line).length : 0;
    n.h = Math.max(base.h, 20 + nameLines * LINE.name + (lineLines ? 2 + lineLines * LINE.line : 0) + 20);
  });
}
// the words on an arrow, wrapped into a chip no wider than this
export const LABEL = { width: 200, line: 16, pad: { x: 10, y: 6 } };
export function labelLines(text) {
  return wrapText(text, LABEL.width - 2 * LABEL.pad.x, FONTS.label);
}
export function labelBox(text) {
  const lines = labelLines(text);
  const width = Math.min(LABEL.width, Math.max(...lines.map((l) => textWidth(l, FONTS.label)), 0) + 2 * LABEL.pad.x + 2);
  return { lines, width: Math.ceil(width), height: lines.length * LABEL.line + 2 * LABEL.pad.y };
}

// Where each block goes when nobody has moved it: in columns, left to right as a call goes (the channels, the subagent
// that answers first, those it passes callers to…), placed so that the arrows cross as little as can be, run between
// the blocks and never through one, and the words on each arrow have a place of their own. Each subagent keeps what it
// uses plugged in under it (the two take one place). A block somebody dragged keeps the place saved for it, and the
// blocks of a subagent that was dragged follow it; an arrow to or from a block that is not where the layout put it
// finds its own way (geometry.js).
function layout(nodes, edges, { entry, saved }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // a subagent no hand-over leads to from where a call starts can never be reached
  const reach = new Set(entry ? [entry] : []);
  const queue = entry ? [entry] : [];
  while (queue.length) {
    const at = queue.shift();
    edges
      .filter((e) => e.from === at && byId.get(e.to)?.type === 'agent' && e.kind !== 'return' && !reach.has(e.to))
      .forEach((e) => {
        reach.add(e.to);
        queue.push(e.to);
      });
  }
  nodes
    .filter((n) => n.type === 'agent')
    .forEach((n) => {
      n.stranded = !reach.has(n.id);
    });

  sizeBlocks(nodes);
  const drawn = edges.filter((e) => !e.hidden && e.kind !== 'plug' && e.kind !== 'uses' && byId.has(e.from) && byId.has(e.to));
  // a block with many lines leaving (or reaching) it is made tall enough for each to have a point of its own on its side, 8px or more apart
  nodes
    .filter((n) => n.role !== 'plug')
    .forEach((n) => {
      const most = Math.max(drawn.filter((e) => e.from === n.id).length, drawn.filter((e) => e.to === n.id).length);
      n.h = Math.max(n.h, (most - 1) * 8 + 2 * PORT_INSET);
    });
  const plugsOf = new Map();
  nodes.filter((n) => n.role === 'plug').forEach((n) => plugsOf.set(n.agent, [...(plugsOf.get(n.agent) || []), n]));
  // a subagent and what is plugged in under it: one place in the layout
  const box = (n) => {
    if (n.type !== 'agent') return { w: n.w, h: n.h };
    const plugs = plugsOf.get(n.id) || [];
    const rowW = plugs.reduce((sum, p) => sum + p.w, 0) + Math.max(0, plugs.length - 1) * GAP.plugs;
    const rowH = plugs.length ? Math.max(...plugs.map((p) => p.h)) : 0;
    return { w: Math.max(n.w, rowW), h: n.h + (plugs.length ? GAP.plug + rowH : 0), rowW };
  };
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 70, edgesep: 18, marginx: PAD, marginy: PAD });
  g.setDefaultEdgeLabel(() => ({}));
  const main = nodes.filter((n) => n.role !== 'plug');
  main.forEach((n) => {
    const b = box(n);
    g.setNode(n.id, { width: b.w, height: b.h });
  });
  drawn.forEach((e) => {
    const words = e.missing ? 'Say when' : e.label && e.kind !== 'start' ? e.full || e.label : '';
    const lb = words ? labelBox(words) : null;
    g.setEdge(e.from, e.to, lb ? { width: lb.width, height: lb.height, labelpos: 'c' } : {}, e.id);
  });
  dagre.layout(g);
  // each line on a lane of its own between the columns, the columns moved apart where the lanes need the room (edgeLanes.js)
  const lanes = planLanes(
    new Map(
      main.map((n) => {
        const at = g.node(n.id);
        const b = box(n);
        const top = Math.round(at.y - b.h / 2);
        const inset = Math.min(PORT_INSET, n.h / 2);
        return [n.id, { cx: at.x, cy: top + n.h / 2, half: n.w / 2, boxHalf: b.w / 2, lo: top + inset, hi: top + n.h - inset }];
      }),
    ),
    drawn.map((e) => {
      const route = g.edge({ v: e.from, w: e.to, name: e.id }) || {};
      const label = route.x !== undefined && route.width ? { x: route.x, y: route.y, w: route.width } : null;
      return { id: e.id, from: e.from, to: e.to, via: (route.points || []).slice(1, -1), label };
    }),
  );

  // the places the layout gives: a subagent at the top of its place, what it uses in a row under it
  const defaults = new Map();
  main.forEach((n) => {
    const at = g.node(n.id);
    const b = box(n);
    const left = Math.round(at.x + lanes.shift.get(n.id) - b.w / 2);
    const top = Math.round(at.y - b.h / 2);
    if (n.type !== 'agent') {
      defaults.set(n.id, { x: left, y: top });
      return;
    }
    const ax = left + Math.round((b.w - n.w) / 2);
    defaults.set(n.id, { x: ax, y: top });
    let px = left + Math.round((b.w - b.rowW) / 2);
    (plugsOf.get(n.id) || []).forEach((p) => {
      defaults.set(p.id, { x: px, y: top + n.h + GAP.plug });
      px += p.w + GAP.plugs;
    });
  });

  // a place somebody saved (never past the picture's top or left edge); the blocks of a moved subagent follow it
  const inside = ({ x, y }) => ({ x: Math.max(EDGE, Math.round(x)), y: Math.max(EDGE, Math.round(y)) });
  const own = (id) => {
    const p = saved[id];
    return isObj(p) && Number.isFinite(p.x) && Number.isFinite(p.y) ? inside(p) : null;
  };
  // blocks with a place of their own first; then the rest where the layout (or their moved subagent) puts them, moved aside only as far as needed so
  // nothing lies on top of anything else
  const taken = [];
  let nudged = 0;
  const free = (x, y, n) => !taken.some((t) => x < t.x + t.w + 16 && x + n.w + 16 > t.x && y < t.y + t.h + 16 && y + n.h + 16 > t.y);
  const settle = (n, want) => {
    let at = want;
    if (!free(want.x, want.y, n)) {
      search: for (let k = 1; k < 80; k += 1) {
        for (const [cx, cy] of [
          [0, k * 24],
          [0, -k * 24],
          [k * 24, 0],
          [-k * 24, 0],
          [k * 24, k * 24],
          [-k * 24, k * 24],
        ]) {
          if (want.x + cx >= EDGE && want.y + cy >= EDGE && free(want.x + cx, want.y + cy, n)) {
            at = { x: want.x + cx, y: want.y + cy };
            break search;
          }
        }
      }
    }
    if (at !== want) nudged += 1;
    n.x = at.x;
    n.y = at.y;
    taken.push(n);
  };
  const wanted = (n) => {
    const base = defaults.get(n.id) || { x: PAD, y: PAD };
    const owner = n.agent && n.role ? byId.get(n.agent) : null;
    const ownerPlace = owner ? own(owner.id) : null;
    return ownerPlace ? inside({ x: base.x + ownerPlace.x - defaults.get(owner.id).x, y: base.y + ownerPlace.y - defaults.get(owner.id).y }) : inside(base);
  };
  nodes.forEach((n) => {
    const mine = own(n.id);
    if (!mine) return;
    n.x = mine.x;
    n.y = mine.y;
    n.moved = true;
    taken.push(n);
  });
  // subagents and channels before what goes with them
  const rest = nodes.filter((n) => !own(n.id));
  [...rest.filter((n) => !n.role || n.role === 'trigger'), ...rest.filter((n) => n.role && n.role !== 'trigger')].forEach((n) => {
    n.moved = false;
    settle(n, wanted(n));
  });
  nodes.forEach((n) => {
    const base = defaults.get(n.id) || { x: PAD, y: PAD };
    n.placed = n.x !== Math.max(EDGE, base.x) || n.y !== Math.max(EDGE, base.y);
  });
  // the route on its lanes for each arrow whose two blocks are where the layout put them (else the arrow finds its own
  // way), and the place of its words; its two ends exactly on the sides of its blocks
  drawn.forEach((e) => {
    const route = lanes.routes.get(e.id);
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!route || a.placed || b.placed) return;
    const points = route.points.map((p) => ({ ...p }));
    points[0].x = route.out === 'right' ? a.x + a.w : a.x;
    points[points.length - 1].x = route.in === 'left' ? b.x : b.x + b.w;
    e.points = points;
    if (route.labelAt) e.labelAt = route.labelAt;
  });
  // blocks that had to be moved aside (a saved layout with no room for them): counted, for the page to offer Tidy up
  return nudged;
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
  // in the order the picture is read: where a call starts, then agent by agent (in the order of the list), what it does
  // as it takes over, where it can send the caller, then what else it can do
  const agentOrder = new Map(flow.nodes.filter((n) => n.type === 'agent').map((n, i) => [n.id, i]));
  const ownerOf = (id) => flow.nodes.find((n) => n.id === id)?.agent || id;
  const owner = (e) => (e.kind === 'start' ? -1 : (agentOrder.get(e.kind === 'enter' ? ownerOf(e.to) : ownerOf(e.from)) ?? agentOrder.size));
  const RANK = { start: 0, enter: 1, handoff: 2, tool: 3, rule: 4, return: 5, exit: 6, uses: 7 };
  const ordered = flow.edges.map((e, i) => ({ e, i })).sort((a, b) => owner(a.e) - owner(b.e) || (RANK[a.e.kind] ?? 9) - (RANK[b.e.kind] ?? 9) || a.i - b.i);
  return ordered.filter(({ e }) => e.kind !== 'plug' && !e.stub).map(({ e }) => ({ id: e.id, text: sentence(e) }));
  function sentence(e) {
    if (e.kind === 'start') {
      const from = flow.nodes.find((n) => n.id === e.from);
      if (from?.channel) return `${from.label}${from.off ? ' (switched off)' : ''}: ${name(e.to)} answers.`;
      return `A call starts with ${name(e.to)}.`;
    }
    if (e.kind === 'enter') return `${name(e.from)}: when ${name(e.to)} takes over (${flow.nodes.find((n) => n.id === e.from)?.sub || 'no details yet'}).`;
    if (e.kind === 'exit') {
      const to = flow.nodes.find((n) => n.id === e.to);
      if (to?.type === 'agentTransfer')
        return `${name(e.from)} can transfer the caller to ${to.label}, another of your agents${e.full ? ` (${e.full.replace(/[.\s]+$/, '')})` : ''}.`;
      if (to?.type !== 'transfer') return `${name(e.from)} can end the conversation.`;
      return to.noNumber
        ? `${name(e.from)} can pass the caller to a person, but has no number yet: callers are offered a callback.`
        : `${name(e.from)} can pass the caller to a person (${to.sub}).`;
    }
    if (e.kind === 'uses') return `${name(e.from)} can use “${name(e.to)}”.`;
    // the arrow's own words end with the sentence's full stop, not one of their own inside the brackets
    return `${name(e.from)} ${how[e.kind]} ${name(e.to)}${e.label ? ` (${(e.full || e.label).replace(/[.\s]+$/, '')})` : ''}.`;
  }
}
