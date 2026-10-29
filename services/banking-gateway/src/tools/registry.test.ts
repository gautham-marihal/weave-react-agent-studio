import { describe, expect, it } from 'vitest';
import { FIREWALL_FIELDS } from '../security/redact.ts';
import { empty, object, string } from '../schema/schema.ts';
import { defineTool, ok } from './define.ts';
import { ALL_TOOLS, buildRegistry, manifest, MAX_TOOLS_PER_AGENT, toAgentConfigTools } from './registry.ts';

describe('tool registry', () => {
  const registry = buildRegistry();

  it('builds, with unique snake_case names and every agent within the runtime limit', () => {
    expect(registry.size).toBe(ALL_TOOLS.length);
    const { agentTools } = toAgentConfigTools(registry);
    for (const [agent, tools] of Object.entries(agentTools)) {
      expect(tools.length, agent).toBeGreaterThan(0);
      expect(tools.length, agent).toBeLessThanOrEqual(MAX_TOOLS_PER_AGENT);
    }
  });

  it('no tool takes a secret as a model argument or returns a firewalled field to the model', () => {
    for (const tool of registry.values()) {
      for (const field of [...Object.keys(tool.params.properties), ...tool.llmFields]) expect(FIREWALL_FIELDS.has(field), `${tool.name}.${field}`).toBe(false);
    }
  });

  it('every write is two-phase: prepare_* tools prepare, only confirm_transaction commits', () => {
    for (const tool of registry.values()) {
      if (tool.name.startsWith('prepare_') && tool.name !== 'prepare_agent_transfer') expect(tool.effect, tool.name).toBe('prepare');
      if (tool.effect === 'commit') expect(tool.name).toBe('confirm_transaction');
    }
  });

  it('refuses a tool that would take a PIN from the model', () => {
    const bad = defineTool({ name: 'bad_tool', agents: ['greeter'], description: 'x', access: 'public', service: null, effect: 'read', params: object({ pin: string({ maxLength: 6 }) }), llmFields: [], timeoutMs: 1, legacy: '', handler: async () => ok({}) });
    expect(() => buildRegistry([bad])).toThrow(/secure capture/);
  });

  it('refuses an agent with too many tools', () => {
    const many = Array.from({ length: MAX_TOOLS_PER_AGENT + 1 }, (_, i) =>
      defineTool({ name: `tool_${i}`, agents: ['greeter'], description: 'x', access: 'public', service: null, effect: 'read', params: empty(), llmFields: [], timeoutMs: 1, legacy: '', handler: async () => ok({}) }),
    );
    expect(() => buildRegistry(many)).toThrow(/limit/);
  });

  it('generates agent-config http tools that call the gateway with the call id and a closed schema', () => {
    const { tools, connections } = toAgentConfigTools(registry);
    const balance = tools.find((t) => t.id === 'get_balance')!;
    expect(balance).toMatchObject({
      type: 'http',
      connection: 'banking_gateway',
      request: { method: 'POST', path: '/v1/tools/get_balance', headers: { 'X-Call-Id': '{{state.call_id}}' }, body: { account_ref: '{{args.account_ref}}', currency: '{{args.currency}}' } },
      parameters: { type: 'object', additionalProperties: false },
      retries: 1,
    });
    expect(balance.result.to_llm).toEqual(expect.arrayContaining(['ok', 'say', 'error_code', 'next']));
    expect(tools.find((t) => t.id === 'confirm_transaction')!.retries).toBe(0);
    expect(connections.banking_gateway?.auth.token).toEqual({ secret: 'BANKING_GATEWAY_TOKEN' });
  });

  it('publishes a manifest without handlers', () => {
    const m = manifest(registry);
    expect(m[0]).not.toHaveProperty('handler');
    expect(m.every((t) => typeof t.legacy === 'string' && t.legacy.length > 0)).toBe(true);
  });
});

describe('generated agent config: session lifecycle', () => {
  it('opens and closes the gateway session with the call, keyed by the runtime-generated state.call_id', () => {
    const generated = toAgentConfigTools(buildRegistry());
    expect(generated.state.variables.call_id.source?.generate.kind).toBe('epoch_hex');
    // Found by the live validator: state written by tools (transfer route, SR number) must be declared.
    for (const tool of generated.tools) for (const name of Object.keys(tool.result.to_state ?? {})) expect(generated.state.variables).toHaveProperty(name);
    expect(generated.state.variables).toHaveProperty('transfer_route');
    expect(generated.events.map((e) => [e.on, e.do[0]?.path])).toEqual([
      ['call_started', '/v1/sessions'],
      ['call_ended', '/v1/sessions/end'],
    ]);
    expect(generated.events[0]?.do[0]?.body.call_id).toBe('{{state.call_id}}');
    expect(generated.tools.every((t) => t.request.headers['X-Call-Id'] === '{{state.call_id}}')).toBe(true);
    expect(generated.requiredConstants).toEqual(['banking_gateway_url']);
    // Placeholders the runtime has not been shown to fill are declared, not assumed.
    expect(generated.runtimeDependencies.map((d) => d.placeholder)).toEqual(['{{call.room}}', '{{channel.type}}']);
  });
});
