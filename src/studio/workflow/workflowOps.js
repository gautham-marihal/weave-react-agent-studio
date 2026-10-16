// The edits the Workflow makes to the configuration: add an agent, link two agents, give an agent something to say, a number to transfer to, a tool, a way to
// end the call, and take each of them away again. Each one returns a new configuration (or the same one when there is nothing to do) and writes only fields the
// schema already has, so what comes out is an ordinary agent configuration that the form, the JSON and the runtime all read. Pure: no React, no DOM.

import { isObj } from '../form/engine.js';
import { freshId } from '../form/references.js';
import { createAndPoint } from '../form/inlineCreate.js';
import { parseNodeId } from './workflowModel.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const list = (v) => (Array.isArray(v) ? v : []);
const agentsOf = (config) => list(config?.agents?.items);
const agentAt = (config, id) => agentsOf(config).find((a) => isObj(a) && a.id === id);

// ---- where the blocks are drawn
const round = (n) => Math.round(n);
export function setPositions(config, positions) {
  const next = clone(config);
  const ui = { ...(isObj(next.builder?.ui) ? next.builder.ui : {}) };
  const graph = { ...(isObj(ui.graph_positions) ? ui.graph_positions : {}) };
  Object.entries(positions).forEach(([id, p]) => { graph[id] = { x: round(p.x), y: round(p.y) }; });
  next.builder = { ...(isObj(next.builder) ? next.builder : {}), ui: { ...ui, graph_positions: graph } };
  return next;
}
export function clearPositions(config) {
  if (!isObj(config?.builder?.ui?.graph_positions)) return config;
  const next = clone(config);
  delete next.builder.ui.graph_positions;
  if (!Object.keys(next.builder.ui).length) delete next.builder.ui;
  if (!Object.keys(next.builder).length) delete next.builder;
  return next;
}
const forgetPositions = (next, ids) => {
  const graph = next.builder?.ui?.graph_positions;
  if (!isObj(graph)) return;
  ids.forEach((id) => { delete graph[id]; });
};
export const hasSavedPositions = (config) => isObj(config?.builder?.ui?.graph_positions) && Object.keys(config.builder.ui.graph_positions).length > 0;

// ---- adding
export const DEFAULT_ROLE = 'Describe what this agent does for the caller, and how it should talk.';

// A new agent that the agent `fromId` can hand the caller to (when `when` holds). `at` is where to draw it, when other blocks have been moved.
export function addSubagent(config, fromId, { name = 'New subagent', when = '', at } = {}) {
  const next = clone(config);
  const items = agentsOf(next);
  const from = agentAt(next, fromId);
  const id = freshId(items.map((a) => a.id), name === 'New subagent' ? 'subagent' : name);
  const agent = { id, name, kind: 'specialist', instructions: { role: DEFAULT_ROLE }, tools: [] };
  next.agents = { ...(isObj(next.agents) ? next.agents : {}), items: [...items, agent] };
  if (!next.agents.entry) next.agents.entry = id;
  if (from) {
    if (from.kind === 'standalone') from.kind = 'router';
    addHandoffTo(next, from, id, when || `The caller needs ${name}.`);
  }
  const done = at ? setPositions(next, { [id]: at }) : next;
  return { config: done, id };
}

function addHandoffTo(next, from, toId, description) {
  const tools = new Set([...list(next.tools).map((t) => t?.id), ...agentsOf(next).flatMap((a) => list(a.handoffs).map((h) => h?.tool)), ...agentsOf(next).flatMap((a) => list(a.tools))]);
  const used = new Set(agentsOf(next).flatMap((a) => list(a.handoffs).map((h) => h?.id))); // the validator wants a hand-over id to be unique across the whole agent
  const id = freshId(used, `to_${toId}`);
  from.handoffs = [...list(from.handoffs), { id, tool: freshId(tools, `go_to_${toId.replace(/-/g, '_')}`), description, to: toId, carry_context: true }];
}

// "Agent transfer": an arrow from one existing agent to another.
export function addAgentTransfer(config, fromId, toId, description = '') {
  if (fromId === toId || !agentAt(config, fromId) || !agentAt(config, toId)) return config;
  const next = clone(config);
  const to = agentAt(next, toId);
  addHandoffTo(next, agentAt(next, fromId), toId, description || `The caller needs ${to.name || toId}.`);
  return next;
}

// What an agent does as it takes over: the blocks to the left of it.
function pushEnter(config, agentId, action) {
  if (!agentAt(config, agentId)) return { config, id: '' };
  const next = clone(config);
  const agent = agentAt(next, agentId);
  agent.on_enter = [...list(agent.on_enter), action];
  return { config: next, id: `${agentId}::enter::${agent.on_enter.length - 1}` };
}
export const addSay = (config, agentId, text = 'Hello! How can I help you today?') => pushEnter(config, agentId, { type: 'say', text });
// A value that suits a state variable's type, to start from.
export function blankValue(variable) {
  switch (variable?.type) {
    case 'integer': case 'number': return 0;
    case 'boolean': return false;
    case 'enum': return Array.isArray(variable.values) && variable.values.length ? variable.values[0] : '';
    case 'object': return {};
    case 'array': return [];
    default: return '';
  }
}
export function addUpdateState(config, agentId) {
  const first = Object.entries(isObj(config?.state?.variables) ? config.state.variables : {})[0];
  const values = first ? { [first[0]]: blankValue(first[1]) } : {};
  return pushEnter(config, agentId, { type: 'set_state', values });
}
export const addStateVariable = (config, name, kind) => createAndPoint(config, 'state_vars', { name, kind }).config;

// "Phone number transfer": a transfer to this number, and the tool that lets the agent use it.
export function addPhoneTransfer(config, agentId, number) {
  if (!agentAt(config, agentId) || !String(number || '').trim()) return { config, id: '' };
  const next = clone(config);
  const digits = String(number).replace(/[^0-9a-z]+/gi, '').toLowerCase();
  const transfers = list(next.telephony?.transfers);
  const transferId = freshId(transfers.map((t) => t?.id), `transfer_to_${digits || 'person'}`);
  next.telephony = { ...(isObj(next.telephony) ? next.telephony : {}), transfers: [...transfers, { id: transferId, description: 'Hand the caller to a person.', method: 'sip_refer', target: String(number).trim() }] };
  const toolId = freshId([...list(next.tools).map((t) => t?.id), ...agentsOf(next).flatMap((a) => list(a.tools))], `transfer_${digits || 'person'}`);
  next.tools = [...list(next.tools), { id: toolId, type: 'builtin', builtin: 'transfer_or_callback', description: 'The caller asks for a person, or you cannot help.', params: { transfer: transferId, fallback: [{ type: 'say', text: 'Sorry, I can’t put you through right now. Someone will call you back.' }] } }];
  const agent = agentAt(next, agentId);
  agent.tools = [...list(agent.tools), toolId];
  return { config: next, id: `${agentId}::tool::${toolId}` };
}

// "Tool": let the agent use a tool that already exists.
export function addTool(config, agentId, toolId) {
  const agent = agentAt(config, agentId);
  if (!agent || list(agent.tools).includes(toolId) || !list(config.tools).some((t) => t?.id === toolId)) return { config, id: '' };
  const next = clone(config);
  const target = agentAt(next, agentId);
  target.tools = [...list(target.tools), toolId];
  return { config: next, id: `${agentId}::tool::${toolId}` };
}

export const isBuiltin = (tool, name) => !!tool && (tool.type === 'builtin' || (!tool.type && tool.builtin)) && tool.builtin === name;

// "End": let the agent hang up, with the goodbye line the tool says.
export function addEnd(config, agentId) {
  const agent = agentAt(config, agentId);
  if (!agent) return { config, id: '' };
  const existing = list(config.tools).find((t) => isBuiltin(t, 'end_call'));
  if (existing && list(agent.tools).includes(existing.id)) return { config, id: `${agentId}::tool::${existing.id}` };
  const next = clone(config);
  const target = agentAt(next, agentId);
  let toolId = existing?.id;
  if (!toolId) {
    toolId = freshId([...list(next.tools).map((t) => t?.id), ...agentsOf(next).flatMap((a) => list(a.tools))], 'end_call');
    next.tools = [...list(next.tools), { id: toolId, type: 'builtin', builtin: 'end_call', description: 'The conversation is finished: the caller has nothing more to ask.', params: { say: 'Thanks for calling. Goodbye!' } }];
  }
  target.tools = [...list(target.tools), toolId];
  return { config: next, id: `${agentId}::tool::${toolId}` };
}

// ---- changing
export function setEntry(config, agentId) {
  if (!agentAt(config, agentId) || config.agents.entry === agentId) return config;
  const next = clone(config);
  next.agents.entry = agentId;
  return next;
}

// A copy of an agent, with its own id and its own hand-over tool names.
export function duplicateAgent(config, agentId, at) {
  const source = agentAt(config, agentId);
  if (!source) return { config, id: '' };
  const next = clone(config);
  const items = agentsOf(next);
  const id = freshId(items.map((a) => a?.id), `${agentId}_copy`);
  const copy = clone(source);
  copy.id = id;
  copy.name = `${source.name || agentId} (copy)`;
  const taken = new Set([...list(next.tools).map((t) => t?.id), ...items.flatMap((a) => list(a.handoffs).map((h) => h?.tool)), ...items.flatMap((a) => list(a.tools))]);
  const ids = new Set(items.flatMap((a) => list(a.handoffs).map((h) => h?.id)));
  copy.handoffs = list(copy.handoffs).filter(isObj).map((h) => { const tool = freshId(taken, `${h.tool || `go_to_${h.to || 'agent'}`}_copy`); taken.add(tool); const hid = freshId(ids, `${h.id || `to_${h.to || 'agent'}`}_copy`); ids.add(hid); return { ...h, id: hid, tool }; });
  if (!copy.handoffs.length) delete copy.handoffs;
  next.agents.items = [...items, copy];
  return { config: at ? setPositions(next, { [id]: at }) : next, id };
}

// A hand-over made by a tool's own rules (an `effects` step) or by a safety rule (guardrails.escalation): pointed somewhere else, or taken away.
const mapHandoffs = (value, fn) => {
  if (Array.isArray(value)) return value.map((v) => mapHandoffs(v, fn)).filter((v) => v !== undefined);
  if (isObj(value)) { if (value.type === 'handoff' && typeof value.to === 'string') return fn(value); return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapHandoffs(v, fn)])); }
  return value;
};
const tidyEffects = (tool) => {
  const effects = list(tool.effects).filter((rule) => !(isObj(rule) && Array.isArray(rule.do) && rule.do.length === 0));
  const next = { ...tool, effects };
  if (!effects.length) delete next.effects;
  return next;
};
export function retargetToolHandoff(config, toolId, from, to) {
  if (!agentAt(config, to)) return config;
  const next = clone(config);
  next.tools = list(next.tools).map((t) => (t?.id === toolId && Array.isArray(t.effects) ? { ...t, effects: mapHandoffs(t.effects, (x) => (x.to === from ? { ...x, to } : x)) } : t));
  return next;
}
export function removeToolHandoff(config, toolId, to) {
  const next = clone(config);
  next.tools = list(next.tools).map((t) => (t?.id === toolId && Array.isArray(t.effects) ? tidyEffects({ ...t, effects: mapHandoffs(t.effects, (x) => (x.to === to ? undefined : x)) }) : t));
  return next;
}
export function retargetRule(config, ruleId, to) {
  if (!agentAt(config, to) || !Array.isArray(config?.guardrails?.escalation)) return config;
  const next = clone(config);
  next.guardrails.escalation = next.guardrails.escalation.map((r) => (r?.id === ruleId && r.action === 'handoff' ? { ...r, to } : r));
  return next;
}
export function removeRule(config, ruleId) {
  if (!Array.isArray(config?.guardrails?.escalation)) return config;
  const next = clone(config);
  next.guardrails.escalation = next.guardrails.escalation.filter((r) => r?.id !== ruleId);
  return next;
}

// ---- taking away
// Every step anywhere in the configuration that hands the caller to this agent (an on_enter step, a tool's rules, a transfer's steps, a safety rule), taken out;
// a rule block left with nothing to do goes, and a list left empty is not kept (the schema wants at least one step in them).
const GONE = Symbol('gone');
const isHandoffTo = (v, id) => isObj(v) && v.to === id && (v.type === 'handoff' || v.action === 'handoff');
function dropHandoffsTo(value, id) {
  if (Array.isArray(value)) {
    const out = [];
    value.forEach((v) => { if (isHandoffTo(v, id)) return; const r = dropHandoffsTo(v, id); if (r !== GONE) out.push(r); });
    return out;
  }
  if (isObj(value)) {
    const out = {};
    let emptied = false;
    Object.entries(value).forEach(([k, v]) => {
      const r = dropHandoffsTo(v, id);
      if (Array.isArray(v) && v.length && Array.isArray(r) && r.length === 0) emptied = true; else out[k] = r;
    });
    if (emptied && 'do' in value && !('do' in out)) return GONE;
    return out;
  }
  return value;
}
const forgetEnterPositions = (next, agentId) => forgetPositions(next, Object.keys(next.builder?.ui?.graph_positions || {}).filter((k) => k.startsWith(`${agentId}::enter::`)));

// Deletes an agent and every hand-over that led to it; the agent that answers first moves on to the next one when it was the one deleted.
export function removeAgent(config, agentId) {
  const items = agentsOf(config);
  if (!agentAt(config, agentId) || items.length <= 1) return config;
  const next = clone(config);
  next.agents.items = items.filter((a) => isObj(a) && a.id !== agentId);
  next.agents.items.forEach((a) => {
    if (Array.isArray(a.handoffs)) { a.handoffs = a.handoffs.filter((h) => !(isObj(h) && h.to === agentId)); if (!a.handoffs.length) delete a.handoffs; }
  });
  const before = new Map(next.agents.items.map((a) => [a.id, JSON.stringify(a.on_enter)]));
  Object.keys(next).forEach((key) => { if (key !== 'agents') next[key] = dropHandoffsTo(next[key], agentId); });
  next.agents.items = next.agents.items.map((a) => { const r = dropHandoffsTo({ on_enter: a.on_enter }, agentId); const copy = { ...a }; if (Array.isArray(r.on_enter) && r.on_enter.length) copy.on_enter = r.on_enter; else delete copy.on_enter; return copy; });
  next.agents.items.forEach((a) => { if (JSON.stringify(a.on_enter) !== before.get(a.id)) forgetEnterPositions(next, a.id); });
  // a test that expected this agent to be the one in charge at the end no longer has anything to point at
  const clearExpectations = (value) => { if (Array.isArray(value)) value.forEach(clearExpectations); else if (isObj(value)) { if (value.agent_is === agentId) delete value.agent_is; Object.values(value).forEach(clearExpectations); } };
  clearExpectations(next.tests);
  if (next.agents.entry === agentId) next.agents.entry = next.agents.items[0].id;
  forgetPositions(next, [agentId, ...Object.keys(next.builder?.ui?.graph_positions || {}).filter((k) => k.startsWith(`${agentId}::`))]);
  return next;
}

// Takes back one hand-over (an entry of an agent's handoffs, or the on_enter step that hands over).
export function removeHandoff(config, agentId, ref) {
  if (!agentAt(config, agentId)) return config;
  const next = clone(config);
  const agent = agentAt(next, agentId);
  if (ref.handoff !== undefined && Array.isArray(agent.handoffs)) { agent.handoffs.splice(ref.handoff, 1); if (!agent.handoffs.length) delete agent.handoffs; }
  else if (ref.enter !== undefined && Array.isArray(agent.on_enter)) { agent.on_enter.splice(ref.enter, 1); if (!agent.on_enter.length) delete agent.on_enter; forgetEnterPositions(next, agentId); }
  else if (ref.tool) agent.tools = list(agent.tools).filter((t) => t !== ref.tool);
  return next;
}

// A tool nobody offers any more goes too when it was only ever a way to end the call or to hand over to a person: leaving it would leave something unused in
// the settings that the person just took away here.
function dropIfOrphan(next, toolId) {
  if (agentsOf(next).some((a) => list(a.tools).includes(toolId))) return;
  const tool = list(next.tools).find((t) => t?.id === toolId);
  if (!tool || !(isBuiltin(tool, 'end_call') || isBuiltin(tool, 'transfer_or_callback'))) return;
  next.tools = list(next.tools).filter((t) => t?.id !== toolId);
  const transferId = tool.params?.transfer;
  // the transfer goes with it only when nothing else in the configuration names it (another tool, an on_enter step…)
  if (transferId && Array.isArray(next.telephony?.transfers)) {
    const rest = next.telephony.transfers.filter((t) => t?.id !== transferId);
    if (!JSON.stringify({ ...next, telephony: { ...next.telephony, transfers: rest } }).includes(`"${transferId}"`)) next.telephony.transfers = rest;
  }
}

// Deletes whatever a block stands for.
export function removeNode(config, nodeId) {
  const at = parseNodeId(nodeId);
  if (at.kind === 'agent') return removeAgent(config, at.agent);
  if (at.kind === 'start') return config;
  if (!agentAt(config, at.agent)) return config;
  const next = clone(config);
  const agent = agentAt(next, at.agent);
  if (at.kind === 'enter') { agent.on_enter = list(agent.on_enter).filter((_, i) => i !== at.index); if (!agent.on_enter.length) delete agent.on_enter; }
  else { agent.tools = list(agent.tools).filter((t) => t !== at.tool); dropIfOrphan(next, at.tool); }
  // the blocks after a removed on-enter step change number, so their saved places go with them
  forgetPositions(next, Object.keys(next.builder?.ui?.graph_positions || {}).filter((k) => k === nodeId || (at.kind === 'enter' && k.startsWith(`${at.agent}::enter::`))));
  return next;
}

// The nearest place to `near`, going down and then sideways, where a block of this size fits without covering another.
export function freeSpot(flow, near, size = { w: 236, h: 92 }, gap = 28) {
  const hit = (x, y) => flow.nodes.some((n) => x < n.x + n.w + gap && x + size.w + gap > n.x && y < n.y + n.h + gap && y + size.h + gap > n.y);
  for (let row = 0; row < 40; row += 1) {
    const y = near.y + row * (size.h + gap + 20);
    for (let k = 0; k < 12; k += 1) {
      const x = near.x + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * (size.w + gap);
      if (x >= 20 && !hit(x, y)) return { x, y };
    }
  }
  return near;
}
