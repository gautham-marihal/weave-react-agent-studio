import { describe, expect, it } from 'vitest';
import type { GeneratedAgentConfig } from '../api/gatewayTypes';
import type { AgentConfig } from '../types/studio';
import { applyGatewayConfig, gatewayAddressOf, removeGatewayConfig, stableJson, usesGateway } from './bankingTools';

const tool = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'http', connection: 'banking_gateway', description: `${id} tool`, request: { method: 'POST', path: `/v1/tools/${id}` }, ...extra });

const generated = (): GeneratedAgentConfig => ({
  tools: [tool('get_auth_status'), tool('get_balance'), tool('list_accounts')],
  connections: { banking_gateway: { type: 'http', base_url: '{{const.banking_gateway_url}}', auth: { type: 'bearer', token: { secret: 'BANKING_GATEWAY_TOKEN' } } } },
  events: [
    { on: 'call_started', do: [{ type: 'http', connection: 'banking_gateway', method: 'POST', path: '/v1/sessions', body: { call_id: '{{state.call_id}}' } }] },
    { on: 'call_ended', do: [{ type: 'http', connection: 'banking_gateway', method: 'POST', path: '/v1/sessions/end', body: { call_id: '{{state.call_id}}' } }] },
  ],
  state: { variables: { call_id: { type: 'string', source: { generate: { kind: 'epoch_hex' } } } } },
  agentTools: { greeter: ['get_auth_status'], accounts: ['list_accounts', 'get_balance'], cheques: ['list_accounts'] },
  requiredConstants: ['banking_gateway_url'],
  runtimeDependencies: [],
});

const base = (): AgentConfig => ({
  constants: { payment_url: 'https://pay.example' },
  tools: [{ id: 'end_call', type: 'builtin', builtin: 'end_call' }],
  events: [{ on: 'call_started', do: [{ type: 'log', level: 'info', message: 'hello' }] }],
  agents: { entry: 'greeter', items: [{ id: 'greeter', name: 'Greeter', tools: ['end_call'] }, { id: 'accounts', name: 'Accounts', tools: [] }] },
});

describe('applyGatewayConfig', () => {
  it('adds tools, connection, session events, call_id and the URL constant, keeping the owner\'s own entries', () => {
    const r = applyGatewayConfig(base(), generated(), 'https://gateway.bank.example');
    expect(r.ok).toBe(true);
    expect(r.added).toEqual(['get_auth_status', 'get_balance', 'list_accounts']);
    expect(r.config.tools?.map((t) => t.id)).toEqual(['end_call', 'get_auth_status', 'get_balance', 'list_accounts']);
    expect(r.config.constants).toEqual({ payment_url: 'https://pay.example', banking_gateway_url: 'https://gateway.bank.example' });
    expect(r.config.events[0].do.map((a: { type: string; path?: string }) => a.path ?? a.type)).toEqual(['log', '/v1/sessions']);
    expect(r.config.events[1].on).toBe('call_ended');
    expect(r.config.state.variables.call_id).toBeDefined();
    expect(r.config.agents?.items?.find((a) => a.id === 'greeter')?.tools).toEqual(['end_call', 'get_auth_status']);
    expect(r.config.agents?.items?.find((a) => a.id === 'accounts')?.tools).toEqual(['list_accounts', 'get_balance']);
  });

  it('is idempotent: a second run changes nothing', () => {
    const first = applyGatewayConfig(base(), generated(), 'https://gateway.bank.example');
    const second = applyGatewayConfig(first.config, generated());
    expect(second.ok).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.config).toBe(first.config);
    expect(second.unchanged).toEqual(['get_auth_status', 'get_balance', 'list_accounts']);
    expect(second.config.events[0].do).toHaveLength(2);
  });

  it('refreshes changed gateway tools and removes ones the gateway dropped, from tools and roles', () => {
    const first = applyGatewayConfig(base(), generated(), 'https://gateway.bank.example').config;
    const next = generated();
    next.tools = [tool('get_auth_status', { description: 'new words' }), tool('get_balance')];
    next.agentTools = { greeter: ['get_auth_status'], accounts: ['get_balance'] };
    const r = applyGatewayConfig(first, next);
    expect(r.updated).toEqual(['get_auth_status']);
    expect(r.removed).toEqual(['list_accounts']);
    expect(r.config.agents?.items?.find((a) => a.id === 'accounts')?.tools).toEqual(['get_balance']);
  });

  it('refuses to overwrite a hand-written tool with a gateway tool\'s name, and changes nothing', () => {
    const config = base();
    config.tools = [...(config.tools ?? []), { id: 'get_balance', type: 'http', connection: 'core_banking' }];
    const r = applyGatewayConfig(config, generated(), 'https://gateway.bank.example');
    expect(r.ok).toBe(false);
    expect(r.conflicts[0]).toMatch(/"get_balance" is hand-written/);
    expect(r.config).toBe(config);
  });

  it('leaves the gateway address empty until someone enters it, and checks its form', () => {
    const r = applyGatewayConfig(base(), generated());
    expect(r.ok).toBe(true);
    expect(gatewayAddressOf(r.config)).toBe('');
    expect(r.config.constants?.banking_gateway_url).toBe('');
    expect(applyGatewayConfig(base(), generated(), 'gateway.bank.example').ok).toBe(false);
    expect(gatewayAddressOf(applyGatewayConfig(r.config, generated(), 'https://g.example').config)).toBe('https://g.example');
  });

  it('keeps a connection the owner already set up', () => {
    const config = { ...base(), connections: { banking_gateway: { type: 'http', base_url: '{{const.banking_gateway_url}}', auth: { type: 'bearer', token: { secret: 'OTHER_SECRET' } } } } };
    const r = applyGatewayConfig(config, generated(), 'https://gateway.bank.example');
    expect(r.connectionKept).toBe(true);
    expect(r.config.connections?.banking_gateway.auth.token.secret).toBe('OTHER_SECRET');
  });

  it('flags roles that would go over the 8-tool lint limit', () => {
    const many = generated();
    many.tools = Array.from({ length: 9 }, (_, i) => tool(`t${i}`));
    many.agentTools = { accounts: many.tools.map((t) => t.id) };
    expect(applyGatewayConfig(base(), many, 'https://g.example').rolesOverLimit).toEqual(['accounts']);
  });
});

describe('removeGatewayConfig', () => {
  it('takes out everything applyGatewayConfig put in, and nothing else', () => {
    const start = base();
    const applied = applyGatewayConfig(start, generated(), 'https://g.example').config;
    expect(stableJson(removeGatewayConfig(applied))).toBe(stableJson(start));
  });

  it('keeps a state variable the owner’s own config still uses', () => {
    const applied = applyGatewayConfig(base(), generated(), 'https://g.example').config;
    applied.persona = { shared_rules: ['Quote {{state.call_id}} when asked.'] };
    expect(removeGatewayConfig(applied).state?.variables?.call_id).toBeDefined();
  });
});

describe('helpers', () => {
  it('stableJson ignores key order', () => {
    expect(stableJson({ a: 1, b: [{ c: 2, d: 3 }] })).toBe(stableJson({ b: [{ d: 3, c: 2 }], a: 1 }));
  });
  it('usesGateway', () => {
    expect(usesGateway(base())).toBe(false);
    expect(usesGateway(applyGatewayConfig(base(), generated(), 'https://g.example').config)).toBe(true);
  });
});
