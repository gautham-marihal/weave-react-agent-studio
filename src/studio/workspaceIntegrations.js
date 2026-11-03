// What the Integrations page connects is part of every agent in the workspace: connecting (or editing) one saves it
// into each agent's draft, disconnecting takes it out again, and a new agent starts with all of them. Drafts only: an
// agent's live version changes when it is published. Each is an http connection under the integration's own id (its
// address, its headers, a secret header as its sign-in: connectionParts.js), so applying it twice changes nothing. An
// agent's tools that call it are made on its own Build › Tools page; disconnecting takes those out with it.

import { api } from '../api/client.ts';
import { agentConnection, connectionParts, isWebAddress } from './connectionParts.js';

const KEY = 'weave_integrations';

/** The connections saved on the Integrations page, by integration id ({ name, description, url, headers, connectedAt }; older ones { name, first, second }). */
export function readIntegrations() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

export function writeIntegrations(connections) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(connections));
  } catch {
    /* storage unavailable: lasts until reload */
  }
}

// only a web address can be called by an agent; anything else (a key with no address) stays on the page
export const reachable = (connection) => isWebAddress(connectionParts(connection).url);

/** The configuration with one integration in it. */
export function withIntegration(config, id, connection) {
  if (!config || !reachable(connection)) return config;
  return { ...config, connections: { ...(config.connections || {}), [id]: agentConnection(connectionParts(connection, id)) } };
}

const list = (value) => (Array.isArray(value) ? value : []);

/** The configuration without that integration, and without the tools that called it (a tool left without its connection would not validate). */
export function withoutIntegration(config, id) {
  if (!config) return config;
  if (!config.connections || !(id in config.connections)) return config;
  const connections = { ...config.connections };
  delete connections[id];
  const gone = new Set(
    list(config.tools)
      .filter((t) => t?.connection === id)
      .map((t) => t.id),
  );
  if (!gone.size) return { ...config, connections };
  const agents = config.agents && list(config.agents.items).length ? config.agents : null;
  return {
    ...config,
    connections,
    tools: list(config.tools).filter((t) => !gone.has(t?.id)),
    ...(agents ? { agents: { ...agents, items: agents.items.map((agent) => ({ ...agent, tools: list(agent.tools).filter((t) => !gone.has(t)) })) } } : {}),
  };
}

/** Whether an agent's configuration has the integration (its connection is there). */
export const hasIntegration = (config, id) => !!(config?.connections && typeof config.connections === 'object' && id in config.connections);

/**
 * Each agent's draft configuration, by id; an agent whose draft couldn't be read is left out (it shows as unknown).
 * @returns {Promise<Record<string, object>>}
 */
export async function readDrafts(botIds, client = api) {
  const results = await Promise.allSettled(botIds.map((id) => client.getDraft(id)));
  const out = {};
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') out[botIds[i]] = result.value.config;
  });
  return out;
}

/** The configuration with every saved integration in it: what a new agent starts with. */
export function withIntegrations(config, connections = readIntegrations()) {
  return Object.entries(connections).reduce((next, [id, connection]) => withIntegration(next, id, connection), config);
}

/**
 * Saves `change(config)` into each agent's draft, against the revision it read, so an edit saved in between is never
 * overwritten (that agent is reported as failed instead). An agent the change leaves as it is is not saved again.
 * @returns {Promise<{ updated: string[], unchanged: string[], failed: { id: string, message: string }[] }>}
 */
export async function applyToAgents(botIds, change, client = api) {
  const results = await Promise.allSettled(
    botIds.map(async (id) => {
      const draft = await client.getDraft(id);
      const next = change(draft.config);
      if (JSON.stringify(next) === JSON.stringify(draft.config)) return { id, saved: false };
      await client.saveDraft(id, next, draft.revision);
      return { id, saved: true };
    }),
  );
  const report = { updated: [], unchanged: [], failed: [] };
  results.forEach((result, i) => {
    if (result.status === 'rejected') report.failed.push({ id: botIds[i], message: result.reason?.message || String(result.reason) });
    else (result.value.saved ? report.updated : report.unchanged).push(result.value.id);
  });
  return report;
}

const agentsWord = (n) => `${n} ${n === 1 ? 'agent' : 'agents'}`;

/** One line for the page: what happened to the workspace's agents. mode: 'add' | 'remove' | 'update' (true means 'remove'). */
export function reportWords(report, mode = 'add') {
  const how = mode === true ? 'remove' : mode || 'add';
  const { updated, unchanged, failed } = report;
  const total = updated.length + unchanged.length + failed.length;
  if (!total) return 'There are no agents in this workspace yet. New agents start with it.';
  const parts = [];
  if (how === 'update')
    parts.push(
      updated.length ? `Updated in the drafts of ${agentsWord(updated.length)} that use it; publish them to put it live.` : 'No agent’s draft needed changing.',
    );
  else if (updated.length)
    parts.push(
      how === 'remove'
        ? `Taken off the drafts of ${agentsWord(updated.length)}; publish them to take it off the live versions.`
        : `Added to the drafts of ${agentsWord(updated.length)}; publish them to put it live.`,
    );
  if (how !== 'update' && unchanged.length) parts.push(`${agentsWord(unchanged.length)} already ${how === 'remove' ? 'had it off' : 'had it'}.`);
  if (failed.length) parts.push(`${agentsWord(failed.length)} could not be changed (${failed.map((f) => f.id).join(', ')}): try again.`);
  return parts.join(' ');
}
