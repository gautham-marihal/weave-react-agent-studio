// Puts the banking gateway's generated config into an agent draft, and refreshes it later, without hand-copying JSON.
// Pure: the Build stage applies the result through the draft editor (one undo step) and the server validates it.
//
// What is "managed": tools whose connection is `banking_gateway`, that connection, the gateway's session start/end
// actions in `events`, and the `call_id` state variable. Running it twice changes nothing. A hand-written tool
// with a gateway tool's name is never overwritten: the whole change is refused and the clash is named.

import type { GeneratedAgentConfig } from '../../api/gatewayTypes.ts';

// The parts of a draft this module reads and writes. A draft is the editor's parsed JSON, so every part is optional
// and anything else in it is carried over untouched.
interface ToolDefinition {
  id: string;
  connection?: string;
  [key: string]: unknown;
}
interface AgentRole {
  id: string;
  tools?: string[];
  [key: string]: unknown;
}
export interface AgentConfig {
  constants?: Record<string, unknown>;
  connections?: Record<string, unknown>;
  tools?: ToolDefinition[];
  events?: unknown[];
  state?: Record<string, unknown>;
  agents?: { items?: AgentRole[] } & Record<string, unknown>;
  [key: string]: unknown;
}

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
  readonly rolesUpdated: readonly string[];
  /** Specialist roles the gateway expects that the draft does not have (they are not created automatically). */
  readonly rolesMissing: readonly string[];
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

const isGatewayAction = (action: Record<string, unknown>) =>
  action.connection === GATEWAY_CONNECTION && typeof action.path === 'string' && action.path.startsWith('/v1/sessions');

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
  if (!url && constants[GATEWAY_URL_CONSTANT] === undefined) {
    conflicts.push('Enter the address the agent runtime uses to reach the banking gateway (constant banking_gateway_url).');
  }

  const empty = {
    added: [],
    updated: [],
    unchanged: [],
    removed: [],
    rolesUpdated: [],
    rolesMissing: [],
    rolesOverLimit: [],
    connectionKept: false,
    changed: false,
  };
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
  const events = [...((config.events as Array<{ on: string; do?: Array<Record<string, unknown>> }> | undefined) ?? [])].map((e) => ({
    ...e,
    do: [...(e.do ?? [])],
  }));
  for (const wanted of generated.events) {
    const target = events.find((e) => e.on === wanted.on && !('when' in e));
    if (target) target.do = [...target.do.filter((a) => !isGatewayAction(a)), ...wanted.do];
    else events.push({ on: wanted.on, do: [...wanted.do] });
  }

  // State: declare call_id if the draft does not (the owner's own definition wins).
  const state = (config.state ?? { variables: {} }) as { variables?: Record<string, unknown> };
  const variables = { ...(state.variables ?? {}) };
  for (const [name, definition] of Object.entries(generated.state.variables)) if (!(name in variables)) variables[name] = definition;

  // Specialist roles: give each existing role its gateway tools; keep its other tools.
  const managedNames = new Set(generated.tools.map((t) => t.id));
  const items = (config.agents?.items ?? []) as AgentRole[];
  const rolesUpdated: string[] = [];
  const rolesOverLimit: string[] = [];
  const nextItems = items.map((role) => {
    const wanted = generated.agentTools[role.id];
    const current = role.tools ?? [];
    // Drop gateway tool names that no longer exist anywhere, and the ones this role should no longer have.
    const kept = current.filter((name) => !removed.includes(name) && (!managedNames.has(name) || wanted?.includes(name)));
    const next = wanted ? [...kept, ...wanted.filter((name) => !kept.includes(name))] : kept;
    if (next.length > MAX_AGENT_TOOLS) rolesOverLimit.push(role.id);
    if (stableJson(next) === stableJson(current)) return role;
    rolesUpdated.push(role.id);
    return { ...role, tools: next };
  });
  const rolesMissing = Object.keys(generated.agentTools).filter((id) => !items.some((r) => r.id === id));

  const nextConfig: AgentConfig = {
    ...config,
    constants: url ? { ...constants, [GATEWAY_URL_CONSTANT]: url } : config.constants,
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
    rolesUpdated,
    rolesMissing,
    rolesOverLimit,
    connectionKept: Boolean(existingConnection),
    changed,
  };
}
