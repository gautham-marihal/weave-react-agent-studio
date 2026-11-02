// Puts the banking gateway's generated config into an agent draft, and refreshes it later, without hand-copying JSON.
// Pure: the Build stage applies the result through the draft editor (one undo step) and the server validates it.
//
// What is "managed": tools whose connection is `banking_gateway`, that connection, the gateway's session start/end
// actions in `events`, the state variables they write (`call_id`, ...) and the `banking_gateway_url` constant. Running
// it twice changes nothing; removeGatewayConfig takes it out again. A hand-written tool with a gateway tool's name is
// never overwritten: the whole change is refused and the clash is named.

import type { GeneratedAgentConfig } from '../api/gatewayTypes';
import type { AgentConfig, AgentRole, ToolDefinition } from '../types/studio';

export const GATEWAY_CONNECTION = 'banking_gateway';
export const GATEWAY_URL_CONSTANT = 'banking_gateway_url';
/** builder.lint: an agent may hold at most 8 tools (agent-config-guide §2). */
export const MAX_AGENT_TOOLS = 8;

export interface GatewayConfigChange {
  readonly ok: boolean;
  /** The new config when ok; the input unchanged when not. */
  readonly config: AgentConfig;
  readonly added: readonly string[];
  readonly updated: readonly string[];
  readonly unchanged: readonly string[];
  readonly removed: readonly string[];
  readonly conflicts: readonly string[];
  /** Roles over the 8-tool lint limit once their gateway tools are added (handoffs and built-ins may count too). */
  readonly rolesOverLimit: readonly string[];
  readonly connectionKept: boolean;
  readonly changed: boolean;
}

/** JSON with sorted keys, so two configs that differ only in key order compare equal. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const isGatewayAction = (action: Record<string, unknown>) => action.connection === GATEWAY_CONNECTION && typeof action.path === 'string' && action.path.startsWith('/v1/sessions');

/** Is this draft wired to the banking gateway? */
export const usesGateway = (config: AgentConfig | null | undefined): boolean =>
  Boolean(config?.connections?.[GATEWAY_CONNECTION]) || Boolean(config?.tools?.some((t) => t.connection === GATEWAY_CONNECTION));

export function applyGatewayConfig(config: AgentConfig, generated: GeneratedAgentConfig, gatewayUrl?: string): GatewayConfigChange {
  const conflicts: string[] = [];
  const tools = config.tools ?? [];
  const generatedIds = new Set(generated.tools.map((t) => t.id));

  for (const tool of tools) {
    if (generatedIds.has(tool.id) && tool.connection !== GATEWAY_CONNECTION) {
      conflicts.push(`The tool "${tool.id}" is hand-written but has the same name as a banking tool. Rename or remove it first.`);
    }
  }
  const existingConnection = config.connections?.[GATEWAY_CONNECTION] as Record<string, unknown> | undefined;
  if (existingConnection && existingConnection.type !== 'http') {
    conflicts.push(`The connection "${GATEWAY_CONNECTION}" exists but is not an http connection.`);
  }
  const constants = (config.constants ?? {}) as Record<string, unknown>;
  const url = gatewayUrl?.trim();
  if (url !== undefined && url !== '' && !/^https?:\/\/[^\s]+$/.test(url)) conflicts.push('The gateway address must start with http:// or https://.');

  const empty = { added: [], updated: [], unchanged: [], removed: [], rolesOverLimit: [], connectionKept: false, changed: false };
  if (conflicts.length) return { ok: false, config, conflicts, ...empty };

  // Tools: refresh managed ones in place, append new ones, drop managed ones the gateway no longer offers.
  const added: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  const removed: string[] = [];
  const byId = new Map(generated.tools.map((t) => [t.id, t as ToolDefinition]));
  const nextTools: ToolDefinition[] = [];
  for (const tool of tools) {
    if (tool.connection !== GATEWAY_CONNECTION) {
      nextTools.push(tool);
      continue;
    }
    const fresh = byId.get(tool.id);
    if (!fresh) {
      removed.push(tool.id);
      continue;
    }
    if (stableJson(fresh) === stableJson(tool)) unchanged.push(tool.id);
    else updated.push(tool.id);
    nextTools.push(fresh);
    byId.delete(tool.id);
  }
  for (const fresh of byId.values()) {
    added.push(fresh.id);
    nextTools.push(fresh);
  }

  // Connection: kept as the owner set it, if present (they may point it at another secret).
  const generatedConnection = generated.connections[GATEWAY_CONNECTION];
  const connections = { ...(config.connections ?? {}), [GATEWAY_CONNECTION]: existingConnection ?? generatedConnection };

  // Events: add the gateway's session actions to the matching event, replacing earlier gateway actions only.
  const events = [...((config.events as Array<{ on: string; do?: Array<Record<string, unknown>> }> | undefined) ?? [])].map((e) => ({ ...e, do: [...(e.do ?? [])] }));
  for (const wanted of generated.events) {
    const target = events.find((e) => e.on === wanted.on && !('when' in e));
    if (target) target.do = [...target.do.filter((a) => !isGatewayAction(a)), ...wanted.do];
    else events.push({ on: wanted.on, do: [...wanted.do] });
  }

  // State: declare call_id if the draft does not (the owner's own definition wins).
  const state = (config.state ?? { variables: {} }) as { variables?: Record<string, unknown> };
  const variables = { ...(state.variables ?? {}) };
  for (const [name, definition] of Object.entries(generated.state.variables)) if (!(name in variables)) variables[name] = definition;

  // Specialist roles (models/bankingAgent.ts makes them): give each its gateway tools; keep its other tools.
  const managedNames = new Set(generated.tools.map((t) => t.id));
  const items = (config.agents?.items ?? []) as AgentRole[];
  const rolesOverLimit: string[] = [];
  const nextItems = items.map((role) => {
    const wanted = generated.agentTools[role.id];
    const current = role.tools ?? [];
    // Drop gateway tool names that no longer exist anywhere, and the ones this role should no longer have.
    const kept = current.filter((name) => !removed.includes(name) && (!managedNames.has(name) || wanted?.includes(name)));
    const next = wanted ? [...kept, ...wanted.filter((name) => !kept.includes(name))] : kept;
    if (next.length > MAX_AGENT_TOOLS) rolesOverLimit.push(role.id);
    if (stableJson(next) === stableJson(current)) return role;
    return { ...role, tools: next };
  });

  const nextConfig: AgentConfig = {
    ...config,
    // The address the runtime uses: as typed, else what the draft has, else empty until someone enters it.
    constants: url ? { ...constants, [GATEWAY_URL_CONSTANT]: url } : constants[GATEWAY_URL_CONSTANT] === undefined ? { ...constants, [GATEWAY_URL_CONSTANT]: '' } : config.constants,
    connections,
    tools: nextTools,
    events,
    state: { ...state, variables },
    ...(config.agents ? { agents: { ...config.agents, items: nextItems } } : {}),
  };
  const changed = stableJson(nextConfig) !== stableJson(config);
  return {
    ok: true,
    config: changed ? nextConfig : config,
    added,
    updated,
    unchanged,
    removed,
    conflicts: [],
    rolesOverLimit,
    connectionKept: Boolean(existingConnection),
    changed,
  };
}

/** The address the agent runtime uses to reach the gateway ('' when not entered yet). */
export const gatewayAddressOf = (config: AgentConfig | null | undefined): string => {
  const value = (config?.constants as Record<string, unknown> | undefined)?.[GATEWAY_URL_CONSTANT];
  return typeof value === 'string' ? value.trim() : '';
};

/** Whether a value mentions a state variable (as {{state.name}}, or as a to_state / set_state key). */
const mentions = (value: unknown, name: string): boolean => {
  const text = stableJson(value);
  return text.includes(`state.${name}`) || text.includes(`${JSON.stringify(name)}:`);
};

const without = (record: Record<string, unknown>, key: string): Record<string, unknown> => Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

/**
 * Takes the managed part out again: gateway tools (and their names in every role), the connection, the gateway's
 * session actions (an event left with nothing to do goes too), the URL constant, and the state variables the gateway
 * tools write when nothing else mentions them. Everything else is kept as it is.
 */
export function removeGatewayConfig(config: AgentConfig): AgentConfig {
  const tools = config.tools ?? [];
  const gatewayTools = tools.filter((t) => t.connection === GATEWAY_CONNECTION);
  const names = new Set(gatewayTools.map((t) => t.id));
  const written = new Set<string>(['call_id']);
  for (const t of gatewayTools) {
    const toState = (t.result as { to_state?: Record<string, unknown> } | undefined)?.to_state ?? {};
    for (const key of Object.keys(toState)) written.add(key);
  }

  const next: AgentConfig = { ...config, tools: tools.filter((t) => !names.has(t.id)) };
  if (config.connections) {
    const rest = without(config.connections as Record<string, unknown>, GATEWAY_CONNECTION);
    if (Object.keys(rest).length) next.connections = rest;
    else delete next.connections;
  }
  if (config.constants) {
    const rest = without(config.constants as Record<string, unknown>, GATEWAY_URL_CONSTANT);
    if (Object.keys(rest).length) next.constants = rest;
    else delete next.constants;
  }
  if (Array.isArray(config.events)) {
    const events = (config.events as Array<{ on: string; do?: Array<Record<string, unknown>> }>)
      .map((e) => ({ ...e, do: (e.do ?? []).filter((a) => !isGatewayAction(a)) }))
      .filter((e) => e.do.length > 0);
    if (events.length) next.events = events;
    else delete next.events;
  }
  if (config.agents?.items) {
    const items = (config.agents.items as AgentRole[]).map((r) => (r.tools?.some((n) => names.has(n)) ? { ...r, tools: r.tools.filter((n) => !names.has(n)) } : r));
    next.agents = { ...config.agents, items };
  }
  const state = config.state as { variables?: Record<string, unknown> } | undefined;
  if (state?.variables) {
    const elsewhere = { ...next, state: undefined };
    const variables = Object.fromEntries(Object.entries(state.variables).filter(([name]) => !written.has(name) || mentions(elsewhere, name)));
    if (Object.keys(variables).length || Object.keys(state).length > 1) next.state = { ...state, variables };
    else delete next.state;
  }
  return next;
}
