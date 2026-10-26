// The edits the Workflow makes to the configuration: add an agent, link two agents, give an agent something to say, a
// number to transfer to, a tool, a way to end the call, and take each of them away again. Each one returns a new
// configuration (or the same one when there is nothing to do) and writes only fields the schema already has, so what
// comes out is an ordinary agent configuration that the form, the JSON and the runtime all read. Pure: no React, no
// DOM.

import { isObj } from '../form/engine.js';
import { freshId } from '../form/references.js';
import { createAndPoint } from '../form/inlineCreate.js';
import { START_ID, parseNodeId } from './workflowModel.js';
import { toolNamedElsewhere } from '../form/toolInfo.js';
import { dropLines } from '../setup/setupModel.js';

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
  Object.entries(positions).forEach(([id, p]) => {
    graph[id] = { x: round(p.x), y: round(p.y) };
  });
  // the Start block's place under its old name goes once it is saved under its own (unless an agent has that id)
  if (positions[START_ID] && graph.start && !agentAt(next, 'start')) delete graph.start;
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
  ids.forEach((id) => {
    delete graph[id];
  });
};
export const hasSavedPositions = (config) => isObj(config?.builder?.ui?.graph_positions) && Object.keys(config.builder.ui.graph_positions).length > 0;

// ---- adding
export const DEFAULT_ROLE = 'Describe what this agent does for the caller, and how it should talk.';

// A new agent that the agent `fromId` can hand the caller to (when `when` holds). `at` is where to draw it, when other blocks have been moved.
export function addSubagent(config, fromId, { name = 'New subagent', when = '', at } = {}) {
  const next = clone(config);
  const items = agentsOf(next);
  const from = agentAt(next, fromId);
  const id = freshId(
    items.map((a) => a?.id),
    name === 'New subagent' ? 'subagent' : name,
  );
  const agent = { id, name, kind: 'specialist', instructions: { role: DEFAULT_ROLE }, tools: [] };
  next.agents = { ...(isObj(next.agents) ? next.agents : {}), items: [...items, agent] };
  if (!next.agents.entry) next.agents.entry = id;
  if (from) addHandoffTo(next, from, id, when || `The caller needs ${name}.`);
  const done = at ? setPositions(next, { [id]: at }) : next;
  return { config: done, id };
}

// An agent that "answers on its own" has its hand-overs ignored (the checks call the agent it hands to unreachable), so one that is given a hand-over
// passes callers on from then on, whichever way the hand-over was added.
function addHandoffTo(next, from, toId, description) {
  const tools = new Set([
    ...list(next.tools).map((t) => t?.id),
    ...agentsOf(next).flatMap((a) => list(a?.handoffs).map((h) => h?.tool)),
    ...agentsOf(next).flatMap((a) => list(a?.tools)),
  ]);
  const used = new Set(agentsOf(next).flatMap((a) => list(a?.handoffs).map((h) => h?.id))); // the validator wants a hand-over id to be unique across the whole agent
  const id = freshId(used, `to_${toId}`);
  if (from.kind === 'standalone') from.kind = 'router';
  from.handoffs = [...list(from.handoffs), { id, tool: freshId(tools, `go_to_${toId.replace(/-/g, '_')}`), description, to: toId, carry_context: true }];
}
// And back: the one agent left, passing callers on to nobody, answers on its own again.
function settleKind(next) {
  const items = agentsOf(next);
  if (items.length === 1 && isObj(items[0]) && items[0].kind === 'router' && !list(items[0].handoffs).length) items[0].kind = 'standalone';
}

// "Agent transfer": an arrow from one existing agent to another.
export function addAgentTransfer(config, fromId, toId, description = '') {
  if (fromId === toId || !agentAt(config, fromId) || !agentAt(config, toId)) return config;
  const next = clone(config);
  const to = agentAt(next, toId);
  addHandoffTo(next, agentAt(next, fromId), toId, description || `The caller needs ${to.name || toId}.`);
  return next;
}

// One of the things an agent does as it takes over, run earlier (delta -1) or later (+1): the order matters (a line said before a hand-over, say).
export function moveEnterStep(config, agentId, index, delta) {
  const steps = list(agentAt(config, agentId)?.on_enter);
  const to = index + delta;
  if (index < 0 || index >= steps.length || to < 0 || to >= steps.length) return { config, id: '' };
  const next = clone(config);
  const agent = agentAt(next, agentId);
  const [step] = agent.on_enter.splice(index, 1);
  agent.on_enter.splice(to, 0, step);
  forgetEnterPositions(next, agentId);
  return { config: next, id: `${agentId}::enter::${to}` };
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
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'enum':
      return Array.isArray(variable.values) && variable.values.length ? variable.values[0] : '';
    case 'object':
      return {};
    case 'array':
      return [];
    default:
      return '';
  }
}
export function addUpdateState(config, agentId) {
  const first = Object.entries(isObj(config?.state?.variables) ? config.state.variables : {})[0];
  const values = first ? { [first[0]]: blankValue(first[1]) } : {};
  return pushEnter(config, agentId, { type: 'set_state', values });
}
export const addStateVariable = (config, name, kind) => createAndPoint(config, 'state_vars', { name, kind }).config;

// "Phone number transfer": a transfer to this number, and the tool that lets the agent use it. The agent's own way to
// hand over to a person comes first: the same number again is the block it already has, and one still waiting for its
// number (every starter has one, and only this agent uses it) is given this number, rather than a second hand-over
// beside it that the Tools page's switch would not know about.
const sameNumber = (a, b) =>
  String(a ?? '')
    .replace(/[^0-9a-z]+/gi, '')
    .toLowerCase() ===
  String(b ?? '')
    .replace(/[^0-9a-z]+/gi, '')
    .toLowerCase();
export function addPhoneTransfer(config, agentId, number) {
  const agent = agentAt(config, agentId);
  const target = String(number || '').trim();
  if (!agent || !target) return { config, id: '' };
  const transferOf = (tool) => list(config.telephony?.transfers).find((t) => isObj(t) && t.id === tool?.params?.transfer);
  const own = list(agent.tools)
    .map((toolId) => list(config.tools).find((t) => t?.id === toolId))
    .filter((t) => isBuiltin(t, 'transfer_or_callback'));
  const same = own.find((t) => typeof transferOf(t)?.target === 'string' && sameNumber(transferOf(t).target, target));
  if (same) return { config, id: `${agentId}::tool::${same.id}` };
  const waiting = own.find((t) => {
    const transfer = transferOf(t);
    const blank = transfer?.target === undefined || (typeof transfer?.target === 'string' && !transfer.target.trim());
    return (
      transfer?.method === 'sip_refer' &&
      blank &&
      agentsOf(config).filter((a) => list(a?.tools).includes(t.id)).length === 1 &&
      list(config.tools).filter((x) => x?.params?.transfer === transfer.id).length === 1
    );
  });
  if (waiting) {
    const next = clone(config);
    list(next.telephony.transfers).find((t) => isObj(t) && t.id === waiting.params.transfer).target = target;
    return { config: next, id: `${agentId}::tool::${waiting.id}` };
  }
  const next = clone(config);
  const digits = String(number)
    .replace(/[^0-9a-z]+/gi, '')
    .toLowerCase();
  const transfers = list(next.telephony?.transfers);
  const transferId = freshId(
    transfers.map((t) => t?.id),
    `transfer_to_${digits || 'person'}`,
  );
  next.telephony = {
    ...(isObj(next.telephony) ? next.telephony : {}),
    transfers: [...transfers, { id: transferId, description: 'Hand the caller to a person.', method: 'sip_refer', target: String(number).trim() }],
  };
  const toolId = freshId([...list(next.tools).map((t) => t?.id), ...agentsOf(next).flatMap((a) => list(a?.tools))], `transfer_${digits || 'person'}`);
  next.tools = [
    ...list(next.tools),
    {
      id: toolId,
      type: 'builtin',
      builtin: 'transfer_or_callback',
      description: 'The caller asks for a person, or you cannot help.',
      params: { transfer: transferId, fallback: [{ type: 'say', text: 'Sorry, I can’t put you through right now. Someone will call you back.' }] },
    },
  ];
  const giver = agentAt(next, agentId);
  giver.tools = [...list(giver.tools), toolId];
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

// ---- another agent of the workspace: a call reaches it through one of its numbers, so an "Agent transfer" is a
// transfer to that number (and the tool that lets the subagent use it). agent: { id, name, numbers: [{ number }] }.
const FALLBACK = [{ type: 'say', text: 'Sorry, I can’t put you through right now. Someone will call you back.' }];
export function addTransferToAgent(config, subagentId, agent) {
  const number = agent?.numbers?.[0]?.number;
  if (!agentAt(config, subagentId) || !number) return { config, id: '' };
  const next = clone(config);
  const transfers = list(next.telephony?.transfers);
  const transferId = freshId(
    transfers.map((t) => t?.id),
    `to_${agent.id}`,
  );
  next.telephony = {
    ...(isObj(next.telephony) ? next.telephony : {}),
    transfers: [...transfers, { id: transferId, description: `Transfer to ${agent.name}.`, method: 'sip_refer', target: number }],
  };
  const toolId = freshId([...list(next.tools).map((t) => t?.id), ...agentsOf(next).flatMap((a) => list(a?.tools))], `transfer_to_${agent.id}`);
  next.tools = [
    ...list(next.tools),
    {
      id: toolId,
      type: 'builtin',
      builtin: 'transfer_or_callback',
      description: `The caller needs ${agent.name}.`,
      params: { transfer: transferId, fallback: FALLBACK },
    },
  ];
  const target = agentAt(next, subagentId);
  target.tools = [...list(target.tools), toolId];
  return { config: next, id: `${subagentId}::tool::${toolId}` };
}
// The transfer a transfer tool uses, and its index in telephony.transfers (-1 when it has none).
export function transferOf(config, toolId) {
  const tool = list(config?.tools).find((t) => t?.id === toolId);
  const index = list(config?.telephony?.transfers).findIndex((t) => isObj(t) && t.id === tool?.params?.transfer);
  return { tool, transfer: index < 0 ? null : config.telephony.transfers[index], index };
}
const editTransfer = (config, toolId, change) => {
  const { index } = transferOf(config, toolId);
  if (index < 0) return config;
  const next = clone(config);
  change(next.telephony.transfers[index]);
  return JSON.stringify(next) === JSON.stringify(config) ? config : next;
};
// Point an Agent transfer at another agent: its number, and the words that say where it goes.
export const setTransferAgent = (config, toolId, agent) =>
  agent?.numbers?.[0]?.number
    ? editTransfer(config, toolId, (t) => {
        t.target = agent.numbers[0].number;
        t.description = `Transfer to ${agent.name}.`;
      })
    : config;
// What it says while the transfer is made (said before it), '' for nothing.
export const setTransferSay = (config, toolId, text) =>
  editTransfer(config, toolId, (t) => {
    const rest = list(t.before).filter((a) => !(isObj(a) && a.type === 'say'));
    const before = text ? [{ type: 'say', text }, ...rest] : rest;
    if (before.length) t.before = before;
    else delete t.before;
  });
// How long to wait before the transfer is made, in seconds (0 or less: no wait).
export const setTransferDelay = (config, toolId, seconds) =>
  editTransfer(config, toolId, (t) => {
    const n = Number(seconds);
    if (Number.isFinite(n) && n > 0) t.delay_s = n;
    else delete t.delay_s;
  });

// "Back to the first subagent": the built-in tool that passes the caller back to the one that answers first (one shared
// by every subagent that has it).
export function addBackToStart(config, agentId) {
  const agent = agentAt(config, agentId);
  if (!agent) return { config, id: '' };
  const existing = list(config.tools).find((t) => isBuiltin(t, 'return_to_entry'));
  if (existing && list(agent.tools).includes(existing.id)) return { config, id: '' };
  const next = clone(config);
  let toolId = existing?.id;
  if (!toolId) {
    toolId = freshId([...list(next.tools).map((t) => t?.id), ...agentsOf(next).flatMap((a) => list(a?.tools))], 'back_to_start');
    next.tools = [
      ...list(next.tools),
      { id: toolId, type: 'builtin', builtin: 'return_to_entry', description: 'The caller needs something this subagent can’t help with.' },
    ];
  }
  const target = agentAt(next, agentId);
  target.tools = [...list(target.tools), toolId];
  return { config: next, id: '' };
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
    toolId = freshId([...list(next.tools).map((t) => t?.id), ...agentsOf(next).flatMap((a) => list(a?.tools))], 'end_call');
    next.tools = [
      ...list(next.tools),
      {
        id: toolId,
        type: 'builtin',
        builtin: 'end_call',
        description: 'The conversation is finished: the caller has nothing more to ask.',
        params: { say: 'Thanks for calling. Goodbye!' },
      },
    ];
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
  const id = freshId(
    items.map((a) => a?.id),
    `${agentId}_copy`,
  );
  const copy = clone(source);
  copy.id = id;
  copy.name = `${source.name || agentId} (copy)`;
  const taken = new Set([
    ...list(next.tools).map((t) => t?.id),
    ...items.flatMap((a) => list(a?.handoffs).map((h) => h?.tool)),
    ...items.flatMap((a) => list(a?.tools)),
  ]);
  const ids = new Set(items.flatMap((a) => list(a?.handoffs).map((h) => h?.id)));
  copy.handoffs = list(copy.handoffs)
    .filter(isObj)
    .map((h) => {
      const tool = freshId(taken, `${h.tool || `go_to_${h.to || 'agent'}`}_copy`);
      taken.add(tool);
      const hid = freshId(ids, `${h.id || `to_${h.to || 'agent'}`}_copy`);
      ids.add(hid);
      return { ...h, id: hid, tool };
    });
  if (!copy.handoffs.length) delete copy.handoffs;
  next.agents.items = [...items, copy];
  return { config: at ? setPositions(next, { [id]: at }) : next, id };
}

// A hand-over made by a tool's own rules (an `effects` step) or by a safety rule (guardrails.escalation): pointed somewhere else, or taken away.
const mapHandoffs = (value, fn) => {
  if (Array.isArray(value)) return value.map((v) => mapHandoffs(v, fn)).filter((v) => v !== undefined);
  if (isObj(value)) {
    if (value.type === 'handoff' && typeof value.to === 'string') return fn(value);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapHandoffs(v, fn)]));
  }
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
  next.tools = list(next.tools).map((t) =>
    t?.id === toolId && Array.isArray(t.effects) ? { ...t, effects: mapHandoffs(t.effects, (x) => (x.to === from ? { ...x, to } : x)) } : t,
  );
  return next;
}
export function removeToolHandoff(config, toolId, to) {
  const next = clone(config);
  next.tools = list(next.tools).map((t) =>
    t?.id === toolId && Array.isArray(t.effects) ? tidyEffects({ ...t, effects: mapHandoffs(t.effects, (x) => (x.to === to ? undefined : x)) }) : t,
  );
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

// ---- taking away Every step anywhere in the configuration that hands the caller to this agent (an on_enter step, a
// tool's rules, a transfer's steps, a safety rule, what ends a silence), taken out. A list left with no steps is left
// out, and a tool's rule or an event left with nothing to do goes. A list that must keep a step, held by something that
// can't simply go with it (what a wrap-up does when the caller stays quiet, what ends a silence, a task step's
// actions), is kept as it was and its place is added to `stuck`: then the agent is not deleted, and whyKeepAgent says
// why.
const GONE = Symbol('gone');
const isHandoffTo = (v, id) => isObj(v) && v.to === id && (v.type === 'handoff' || v.action === 'handoff');
const goesWhole = (path) => path.at(-1) === 'do' && typeof path.at(-2) === 'number' && ['effects', 'events'].includes(path.at(-3));
const mustKeep = (path) => path.at(-1) === 'on_silence' || (path.at(-1) === 'do' && (path.at(-2) === 'on_exhausted' || path.at(-3) === 'steps'));
function dropHandoffsTo(value, id, stuck = [], path = []) {
  if (Array.isArray(value)) {
    const out = [];
    value.forEach((v, i) => {
      if (isHandoffTo(v, id)) return;
      const r = dropHandoffsTo(v, id, stuck, [...path, i]);
      if (r !== GONE) out.push(r);
    });
    return out;
  }
  if (isObj(value)) {
    const out = {};
    let gone = false;
    Object.entries(value).forEach(([k, v]) => {
      const at = [...path, k];
      const r = dropHandoffsTo(v, id, stuck, at);
      if (!(Array.isArray(v) && v.length && Array.isArray(r) && r.length === 0)) out[k] = r;
      else if (goesWhole(at)) gone = true;
      else if (mustKeep(at)) {
        stuck.push(at);
        out[k] = v;
      }
    });
    return gone ? GONE : out;
  }
  return value;
}
// The checks of the tests that are about the agent: that a call ends with it, or that a hand-over to or from it was (or
// wasn't) used. They go with it; a test left with nothing to check is `stuck` instead (deleting a test is the person's
// call).
function dropChecks(tests, agentId, toolNames, stuck) {
  return tests.map((test, i) => {
    if (!isObj(test) || !Array.isArray(test.expect)) return test;
    const about = (e) =>
      isObj(e) && (e.agent_is === agentId || toolNames.has(e.tool_called) || toolNames.has(e.tool_not_called) || toolNames.has(e.tool_called_with?.tool));
    const expect = test.expect.filter((e) => !about(e));
    if (expect.length === test.expect.length) return test;
    if (!expect.length) {
      stuck.push(['tests', i]);
      return test;
    }
    return { ...test, expect };
  });
}
// an on-enter step's block is placed by its number (`::enter::2`, or `::back::enter2` for a "Back to …" step), so when
// the numbers change, the places go
const forgetEnterPositions = (next, agentId) =>
  forgetPositions(
    next,
    Object.keys(next.builder?.ui?.graph_positions || {}).filter((k) => k.startsWith(`${agentId}::enter::`) || k.startsWith(`${agentId}::back::enter`)),
  );

// The configuration without the agent, and the places that would be left with nothing to do (`stuck`).
function withoutAgent(config, agentId) {
  const stuck = [];
  const items = agentsOf(config);
  // the hand-over tools that go with it: the ones that lead to it, and its own
  const toolNames = new Set(
    items
      .flatMap((a) => list(a?.handoffs).filter((h) => isObj(h) && (h.to === agentId || a.id === agentId)))
      .map((h) => h.tool)
      .filter(Boolean),
  );
  const start = clone(config);
  start.agents.items = items
    .filter((a) => !(isObj(a) && a.id === agentId))
    .map((a) => {
      if (!isObj(a) || !Array.isArray(a.handoffs)) return a;
      const copy = { ...a, handoffs: a.handoffs.filter((h) => !(isObj(h) && h.to === agentId)) };
      if (!copy.handoffs.length) delete copy.handoffs;
      return copy;
    });
  const next = dropHandoffsTo(start, agentId, stuck);
  if (Array.isArray(next.tests)) next.tests = dropChecks(next.tests, agentId, toolNames, stuck);
  return { next, stuck };
}

// Why an agent can't be deleted, in a sentence ('' when it can): an assistant needs an agent, and deleting one must not
// leave something else with nothing to do, or delete it as well.
export function whyKeepAgent(config, agentId) {
  if (!agentAt(config, agentId)) return '';
  if (agentsOf(config).length <= 1) return 'An agent needs at least one subagent.';
  const [first] = withoutAgent(config, agentId).stuck;
  if (!first) return '';
  const at = (path) => path.reduce((node, part) => (node == null ? node : node[part]), config);
  const name = (path, fallback) => `“${at([...path, 'id']) || fallback}”`;
  if (first[0] === 'tests') return `Everything the test ${name(first, 'without a name')} checks is about it. Change or delete that test first.`;
  if (first[0] === 'wrapups')
    return `Callers who stay quiet after the wrap-up ${name(first.slice(0, 2), 'without a name')} are passed to it. Change that first.`;
  if (first[0] === 'tasks' && first[2] === 'steps')
    return `The step ${name(first.slice(0, 4), 'without a name')} of the task ${name(first.slice(0, 2), 'without a name')} passes callers to it. Change that first.`;
  return 'Callers who stay quiet too long are passed to it. Change that first.';
}

// Deletes an agent and every hand-over that led to it; the agent that answers first moves on to the next one when it
// was the one deleted. When that would leave something with nothing to do (whyKeepAgent), nothing changes.
export function removeAgent(config, agentId) {
  const items = agentsOf(config);
  if (!agentAt(config, agentId) || items.length <= 1) return config;
  const { next, stuck } = withoutAgent(config, agentId);
  if (stuck.length) return config;
  next.agents.items.forEach((a) => {
    if (isObj(a) && JSON.stringify(a.on_enter) !== JSON.stringify(agentAt(config, a.id)?.on_enter)) forgetEnterPositions(next, a.id);
  });
  // (the next one that is an agent: a half-typed null in the list is not one)
  if (next.agents.entry === agentId) next.agents.entry = list(next.agents.items).find((a) => isObj(a) && typeof a.id === 'string')?.id;
  // what only it could do goes with it, as when those blocks are deleted: its way to end the call, its transfers to a person
  list(agentAt(config, agentId).tools).forEach((toolId) => dropIfOrphan(next, toolId));
  settleKind(next);
  forgetPositions(next, [agentId, ...Object.keys(next.builder?.ui?.graph_positions || {}).filter((k) => k.startsWith(`${agentId}::`))]);
  return next;
}

// Takes back one hand-over (an entry of an agent's handoffs, or the on_enter step that hands over).
export function removeHandoff(config, agentId, ref) {
  if (!agentAt(config, agentId)) return config;
  const next = clone(config);
  const agent = agentAt(next, agentId);
  if (ref.handoff !== undefined && Array.isArray(agent.handoffs)) {
    agent.handoffs.splice(ref.handoff, 1);
    if (!agent.handoffs.length) delete agent.handoffs;
  } else if (ref.enter !== undefined && Array.isArray(agent.on_enter)) {
    agent.on_enter.splice(ref.enter, 1);
    if (!agent.on_enter.length) delete agent.on_enter;
    forgetEnterPositions(next, agentId);
  } else if (ref.tool) agent.tools = list(agent.tools).filter((t) => t !== ref.tool);
  settleKind(next);
  return next;
}

// A tool nobody offers any more goes too when it was only ever a way to end the call, to go back to the first agent or
// to hand over to a person: leaving it would leave something unused in the settings that the person just took away
// here. One that something else still names (a safety rule, a task, a test) stays.
function dropIfOrphan(next, toolId) {
  if (agentsOf(next).some((a) => list(a?.tools).includes(toolId))) return;
  const tool = list(next.tools).find((t) => t?.id === toolId);
  if (
    !tool ||
    !(isBuiltin(tool, 'end_call') || isBuiltin(tool, 'transfer_or_callback') || isBuiltin(tool, 'return_to_entry')) ||
    toolNamedElsewhere(next, toolId)
  )
    return;
  next.tools = list(next.tools).filter((t) => t?.id !== toolId);
  // and the fixed lines only it said, while they read as the studio wrote them (a goodbye, a callback line)
  dropLines(next, tool);
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
  // a channel and a subagent's model are not taken away from the picture (a channel is on the Channels page; a model can only change)
  if (at.kind === 'start' || at.kind === 'trigger' || at.kind === 'model') return config;
  if (!agentAt(config, at.agent)) return config;
  const next = clone(config);
  const agent = agentAt(next, at.agent);
  // "Back to …" is an on-enter step (`back::enter2`) or a tool the agent offers (`back::back_to_menu`)
  const backStep = at.kind === 'back' && /^enter\d+$/.test(at.ref) ? Number(at.ref.slice(5)) : -1;
  const enterIndex = at.kind === 'enter' ? at.index : backStep >= 0 && list(agent.on_enter)[backStep]?.type === 'return_to_entry' ? backStep : -1;
  if (enterIndex >= 0) {
    agent.on_enter = list(agent.on_enter).filter((_, i) => i !== enterIndex);
    if (!agent.on_enter.length) delete agent.on_enter;
    forgetEnterPositions(next, at.agent);
  } else if (at.kind === 'back') {
    if (!list(agent.tools).includes(at.ref)) return config;
    agent.tools = list(agent.tools).filter((t) => t !== at.ref);
    dropIfOrphan(next, at.ref);
  } else if (at.kind === 'knowledge') {
    agent.knowledge = list(agent.knowledge).filter((k) => k !== at.base);
    if (!agent.knowledge.length) delete agent.knowledge;
  } else {
    agent.tools = list(agent.tools).filter((t) => t !== at.tool);
    dropIfOrphan(next, at.tool);
  }
  // the block's own saved place goes with it (the blocks after a removed on-enter step changed number, and were forgotten above)
  forgetPositions(next, [nodeId]);
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
