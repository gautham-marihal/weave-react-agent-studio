import { ACCOUNT_TOOLS } from './account-tools.ts';
import { APPOINTMENT_TOOLS } from './appointment-tools.ts';
import { AUTH_TOOLS } from './auth-tools.ts';
import { CHEQUE_TOOLS } from './cheque-tools.ts';
import type { AgentGroup, ToolDefinition } from './define.ts';
import { GREETER_TOOLS } from './greeter-tools.ts';
import { INFO_TOOLS } from './info-tools.ts';
import { TRANSACTION_TOOLS } from './transaction-tools.ts';

// The tool registry: the single source of truth for what the agent can do. Weave Studio's agent config is
// generated from it (toAgentConfigTools), so the model-facing schema and the server-side validation can never drift.

export const ALL_TOOLS: readonly ToolDefinition[] = [...AUTH_TOOLS, ...GREETER_TOOLS, ...ACCOUNT_TOOLS, ...CHEQUE_TOOLS, ...INFO_TOOLS, ...APPOINTMENT_TOOLS, ...TRANSACTION_TOOLS];

/** The runtime's builder.lint limit (agent-config-guide §2.1). Handoffs and built-ins also count; keep headroom. */
export const MAX_TOOLS_PER_AGENT = 8;

export function buildRegistry(tools: readonly ToolDefinition[] = ALL_TOOLS): ReadonlyMap<string, ToolDefinition> {
  const map = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    if (!/^[a-z][a-z0-9_]{2,48}$/.test(tool.name)) throw new Error(`Tool name "${tool.name}" must be snake_case`);
    if (map.has(tool.name)) throw new Error(`Duplicate tool name "${tool.name}"`);
    if (tool.access === 'entitled' && tool.service === null) throw new Error(`Tool "${tool.name}": entitled tools need a service`);
    const declared = Object.keys(tool.params.properties);
    for (const field of Object.keys(tool.stateFields ?? {})) {
      if (/pin|otp|nric|token|password/i.test(field)) throw new Error(`Tool "${tool.name}" would copy a secret-looking field "${field}" into call state`);
    }
    if (declared.some((k) => /^(pin|otp|nric|password|tpin)$/i.test(k))) throw new Error(`Tool "${tool.name}" takes a secret as a model argument; use secure capture`);
    map.set(tool.name, tool);
  }
  const perAgent = new Map<AgentGroup, number>();
  for (const tool of tools) for (const agent of tool.agents) perAgent.set(agent, (perAgent.get(agent) ?? 0) + 1);
  for (const [agent, count] of perAgent) {
    if (count > MAX_TOOLS_PER_AGENT) throw new Error(`Agent "${agent}" has ${count} tools; the limit is ${MAX_TOOLS_PER_AGENT}. Split it.`);
  }
  return map;
}

/** Public manifest for Weave Studio (node library, inspector, docs). No handlers, no internals. */
export function manifest(registry: ReadonlyMap<string, ToolDefinition>) {
  return [...registry.values()].map((t) => ({
    name: t.name,
    agents: t.agents,
    description: t.description,
    access: t.access,
    service: t.service,
    effect: t.effect,
    parameters: t.params.toJson(),
    returns: t.llmFields,
    timeout_ms: t.timeoutMs,
    legacy: t.legacy,
  }));
}

/**
 * The `tools` and `connections` entries of an Agent Builder config (agent-config-guide §3.18/§3.19). Every tool is an
 * `http` tool on one connection; preconditions are left to the gateway, which enforces them in code. The result
 * whitelist (`to_llm`) mirrors the gateway's own, so the model sees the same fields either way.
 */
export function toAgentConfigTools(registry: ReadonlyMap<string, ToolDefinition>, connectionId = 'banking_gateway') {
  const tools = [...registry.values()].map((t) => ({
    id: t.name,
    type: 'http',
    description: t.description,
    connection: connectionId,
    request: {
      method: 'POST',
      path: `/v1/tools/${t.name}`,
      // state.call_id, not call.id: the runtime fills state placeholders; call.* is specified but not run yet (guide §2).
      headers: { 'X-Call-Id': '{{state.call_id}}' },
      // Each argument is forwarded as given; the gateway validates it again.
      body: Object.fromEntries(Object.keys(t.params.properties).map((k) => [k, `{{args.${k}}}`])),
    },
    parameters: t.params.toJson(),
    result: {
      to_llm: ['ok', ...t.llmFields, 'error_code', 'error_message', 'next'],
      ...(t.stateFields ? { to_state: t.stateFields } : {}),
    },
    timeout_s: Math.ceil(t.timeoutMs / 1000) + 1,
    retries: t.effect === 'read' ? 1 : 0,
    on_error: { tool_error: 'The banking service did not respond. Apologise and offer a Service Manager or a callback.' },
  }));
  const connections = {
    [connectionId]: { type: 'http', base_url: '{{const.banking_gateway_url}}', auth: { type: 'bearer', token: { secret: 'BANKING_GATEWAY_TOKEN' } } },
  };
  // The gateway session lives as long as the call: opened on call_started, closed on call_ended (WS-BANK-001 §3.5).
  const session = (path: string, body: Record<string, string>) => ({ type: 'http', connection: connectionId, method: 'POST', path, body });
  const events = [
    { on: 'call_started', do: [session('/v1/sessions', { call_id: '{{state.call_id}}', room: '{{call.room}}', channel: '{{channel.type}}', language: 'en' })] },
    { on: 'call_ended', do: [session('/v1/sessions/end', { call_id: '{{state.call_id}}' })] },
  ];
  // Every state variable a tool writes (result.to_state) must be declared, or the validator refuses the config.
  const written = [...new Set([...registry.values()].flatMap((t) => Object.keys(t.stateFields ?? {})))];
  const state = {
    variables: {
      call_id: { type: 'string', source: { generate: { kind: 'epoch_hex', max_length: 16, uppercase: true } } },
      ...Object.fromEntries(written.map((name) => [name, { type: 'string', nullable: true, default: null }])),
    },
  };
  const agents = Object.fromEntries(
    (['greeter', 'authenticator', 'accounts', 'cheques', 'rates_info', 'appointments'] as const).map((a) => [a, [...registry.values()].filter((t) => t.agents.includes(a)).map((t) => t.name)]),
  );
  return {
    tools,
    connections,
    events,
    state,
    agentTools: agents,
    /** Constants the config must declare; their values depend on where the gateway runs. */
    requiredConstants: ['banking_gateway_url'],
    /**
     * What this config needs from the runtime that nothing has verified yet. The agent-config guide lists call.* and
     * channel.* as template roots that are specified but that "nothing checks or runs yet". Without call.room the
     * caller's device cannot find its session (channel routes); without channel.type session start is refused.
     */
    runtimeDependencies: [
      { placeholder: '{{call.room}}', used_in: 'events.call_started body.room', needed_for: "binding the caller's device (secure keypad, confirmation card) to the call" },
      { placeholder: '{{channel.type}}', used_in: 'events.call_started body.channel', needed_for: 'starting the gateway session with the right channel' },
    ],
  };
}
