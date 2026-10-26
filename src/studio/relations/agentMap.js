// How the agents of an assistant hand a caller on, as a picture: each agent a box, each hand-over an arrow, the one that answers first marked.
// Three kinds of arrow, because a caller can be passed on in three ways: an agent's own hand-over (`handoffs`), a tool whose rules hand over,
// and a safety rule that passes the caller to someone. The layout is by distance from the agent that answers first (left to right); what can't
// be reached from there stands in a column of its own, so a stranded agent is visible. Pure: no React, no DOM.

import { humanize, isObj } from '../form/engine.js';

const list = (v) => (Array.isArray(v) ? v : []);
// gapX: room between two columns for the words of an arrow (up to 22 characters) beside the box it points to
export const NODE = { width: 176, height: 60, gapX: 150, gapY: 26, pad: 16 };

// Every `{ type: 'handoff', to }` step anywhere inside a value.
function handoffSteps(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => handoffSteps(v, out));
  else if (isObj(value)) {
    if (value.type === 'handoff' && typeof value.to === 'string') out.push(value.to);
    Object.values(value).forEach((v) => handoffSteps(v, out));
  }
  return out;
}

export function buildAgentMap(config) {
  const agents = list(config?.agents?.items).filter((a) => isObj(a) && typeof a.id === 'string' && a.id);
  const ids = new Set(agents.map((a) => a.id));
  const entry = ids.has(config?.agents?.entry) ? config.agents.entry : agents[0]?.id || '';
  const edges = [];
  const nameOf = (id) => agents.find((a) => a.id === id)?.name || id;
  const add = (edge) => {
    if (ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to) edges.push(edge);
    else if (ids.has(edge.from) && ids.has(edge.to)) edges.push({ ...edge, self: true });
  };

  agents.forEach((agent) =>
    list(agent.handoffs)
      .filter(isObj)
      .forEach((h) => {
        if (typeof h.to === 'string')
          add({ kind: 'handoff', from: agent.id, to: h.to, label: h.id || h.tool || '', word: nameOf(h.to), title: h.description || '' });
      }),
  );
  // a tool whose rules hand the caller on: drawn from every agent that offers the tool
  list(config?.tools)
    .filter(isObj)
    .forEach((tool) => {
      const targets = [...new Set(handoffSteps(tool.effects))];
      if (!targets.length) return;
      agents
        .filter((a) => list(a.tools).includes(tool.id))
        .forEach((agent) =>
          targets.forEach((to) => add({ kind: 'tool', from: agent.id, to, label: tool.id, word: humanize(tool.id), title: tool.description || '' })),
        );
    });
  // a safety rule that passes the caller to an agent: from whichever agent answers first (the rule applies to every call)
  list(config?.guardrails?.escalation)
    .filter(isObj)
    .forEach((rule) => {
      if (rule.action === 'handoff' && typeof rule.to === 'string')
        add({ kind: 'rule', from: entry, to: rule.to, label: rule.id || 'safety rule', word: 'Safety rule', title: '' });
    });
  // one arrow per pair and kind, with the labels together
  const merged = [];
  edges.forEach((edge) => {
    const found = merged.find((m) => m.from === edge.from && m.to === edge.to && m.kind === edge.kind);
    if (found) {
      if (edge.label && !found.labels.includes(edge.label)) found.labels.push(edge.label);
      if (edge.word && !found.words.includes(edge.word)) found.words.push(edge.word);
      if (!found.title && edge.title) found.title = edge.title;
    } else merged.push({ ...edge, labels: edge.label ? [edge.label] : [], words: edge.word ? [edge.word] : [] });
  });

  // layers by distance from the agent that answers first
  const layer = new Map();
  if (entry) {
    layer.set(entry, 0);
    const queue = [entry];
    while (queue.length) {
      const at = queue.shift();
      merged
        .filter((e) => e.from === at && !e.self && !layer.has(e.to))
        .forEach((e) => {
          layer.set(e.to, layer.get(at) + 1);
          queue.push(e.to);
        });
    }
  }
  const unreachable = agents.filter((a) => !layer.has(a.id)).map((a) => a.id);
  const lastLayer = Math.max(-1, ...layer.values());
  const columns = [];
  agents.forEach((a) => {
    if (layer.has(a.id)) {
      (columns[layer.get(a.id)] ||= []).push(a.id);
    }
  });
  if (unreachable.length) columns[lastLayer + 1] = unreachable;
  const cols = columns.filter(Boolean);
  const nodes = [];
  cols.forEach((ids2, c) =>
    ids2.forEach((id, r) => {
      const agent = agents.find((a) => a.id === id);
      nodes.push({
        id,
        name: agent.name || id,
        kind: agent.kind || '',
        entry: id === entry,
        reachable: !unreachable.includes(id),
        index: agents.indexOf(agent),
        column: c,
        row: r,
        x: NODE.pad + c * (NODE.width + NODE.gapX),
        y: NODE.pad + r * (NODE.height + NODE.gapY),
      });
    }),
  );
  const tallest = Math.max(1, ...cols.map((c) => c.length));
  return {
    nodes,
    edges: merged,
    entry,
    unreachable,
    width: NODE.pad * 2 + Math.max(1, cols.length) * NODE.width + Math.max(0, cols.length - 1) * NODE.gapX,
    height: NODE.pad * 2 + tallest * NODE.height + (tallest - 1) * NODE.gapY,
  };
}

// "Greeter passes the caller to Billing (when the caller asks about a bill)", one sentence per arrow, for the text version of the picture.
export function describeEdges(map) {
  const name = (id) => map.nodes.find((n) => n.id === id)?.name || id;
  const how = { handoff: 'hands the caller to', tool: 'can pass the caller to', rule: 'passes the caller, under a safety rule, to' };
  // the plain words only: what a hand-over is for (its own description), or which tool does it; never an id
  const extra = (e) => (e.kind === 'handoff' ? e.title : e.kind === 'tool' && e.words.length ? `through ${e.words.join(', ')}` : '');
  return map.edges.map((e) => `${name(e.from)} ${how[e.kind]} ${name(e.to)}${extra(e) ? ` (${extra(e)})` : ''}.`);
}
