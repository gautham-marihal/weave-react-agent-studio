// Who can use which tool, as a grid. A per-agent list answers "which tools does this agent have"; the grid answers
// "who has this tool", showing unused tools and agents with none at a glance. Pure: no React, no DOM.

import { isObj } from '../form/engine.js';

const list = (v) => (Array.isArray(v) ? v : []);
const clone = (v) => JSON.parse(JSON.stringify(v));

export function buildToolGrid(config) {
  const agents = list(config?.agents?.items)
    .filter((a) => isObj(a) && typeof a.id === 'string' && a.id)
    .map((a) => ({ id: a.id, name: a.name || a.id, tools: new Set(list(a.tools)) }));
  const tools = list(config?.tools)
    .filter((t) => isObj(t) && typeof t.id === 'string' && t.id)
    .map((t) => ({
      id: t.id,
      kind: t.builtin || t.type || '',
      description: t.description || '',
      agents: agents.filter((a) => a.tools.has(t.id)).map((a) => a.id),
    }));
  const rows = tools.map((tool) => ({ ...tool, cells: agents.map((a) => a.tools.has(tool.id)) }));
  return {
    agents: agents.map(({ id, name }) => ({ id, name, count: tools.filter((t) => t.agents.includes(id)).length })),
    rows,
    unused: rows.filter((r) => r.agents.length === 0).map((r) => r.id),
    shared: rows.filter((r) => r.agents.length > 1).map((r) => r.id),
  };
}

// The config with `toolId` offered (or not) by `agentId`; an agent's tool order is kept and a new tool goes last.
export function setToolOffered(config, agentId, toolId, on) {
  const next = clone(config);
  const agent = list(next?.agents?.items).find((a) => isObj(a) && a.id === agentId);
  if (!agent) return config;
  const current = list(agent.tools);
  const has = current.includes(toolId);
  if (on && !has) agent.tools = [...current, toolId];
  else if (!on && has) {
    const rest = current.filter((t) => t !== toolId);
    if (rest.length) agent.tools = rest;
    else delete agent.tools;
  } else return config;
  return next;
}
