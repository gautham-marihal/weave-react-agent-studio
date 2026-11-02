import { beforeAll, describe, expect, it } from 'vitest';
import type { GeneratedAgentConfig } from '../api/gatewayTypes';
import type { AgentConfig, AgentRole } from '../types/studio';
import { createBrowserGateway } from '../sandbox/banking/gatewayInBrowser.js';
import { BANKING_ENTRY, BANKING_ROLE_IDS, BANKING_ROLES, BANKING_RULES, BANKING_WRITE_RULE, bankingRolesOf, handoffClashes, isBankingAgent, makeBankingAgent, newBankingAssistant, removeBankingAgent, withBankingChannels } from './bankingAgent';
import { stableJson } from './bankingTools';
import { reachOf } from './setup';

// The gateway's own generated config (the same code the gateway server runs), so the roles are checked against the
// real 33 tools and the real per-agent lists.
let generated: GeneratedAgentConfig;
beforeAll(async () => {
  const answer = await createBrowserGateway().request({ method: 'GET', path: '/v1/agent-config' });
  generated = JSON.parse(answer.body) as GeneratedAgentConfig;
});

/** An ordinary agent, as the server and a starter make it. */
const plain = (): AgentConfig => ({
  schema_version: '1.2',
  meta: { id: 'shop', name: 'Shop', version: '0.1.0', status: 'draft' },
  persona: { name: 'Ada' },
  channels: [{ id: 'web-chat', type: 'web_chat', enabled: true, entry: { widget_id: 'shop-widget' }, modalities: { input: ['text'], output: ['text'] }, greeting: { say: 'Hello!' } }],
  messages: [{ id: 'goodbye', text: 'Thank you for getting in touch. Goodbye!' }],
  tools: [{ id: 'end_call', type: 'builtin', builtin: 'end_call', description: 'Ends the conversation.', params: { say: { message: 'goodbye' } } }],
  agents: { entry: 'assistant', items: [{ id: 'assistant', name: 'Shop', kind: 'standalone', instructions: { role: 'Help with orders.' }, tools: ['end_call'] }] },
});
const role = (config: AgentConfig, id: string) => (config.agents?.items as AgentRole[]).find((r) => r.id === id);

describe('makeBankingAgent', () => {
  it('adds the six roles, the front desk first, each with its tools from the gateway and at most 8', () => {
    const r = makeBankingAgent(plain(), generated);
    expect(r.ok).toBe(true);
    expect(r.rolesAdded).toEqual([...BANKING_ROLE_IDS]);
    expect(r.config.agents?.entry).toBe(BANKING_ENTRY);
    for (const id of BANKING_ROLE_IDS) {
      const tools = role(r.config, id)?.tools ?? [];
      for (const name of generated.agentTools[id] ?? []) expect(tools).toContain(name);
      expect(tools.length).toBeLessThanOrEqual(8);
    }
    expect(role(r.config, 'greeter')?.tools).toContain('end_call');
    expect(bankingRolesOf(r.config).every((x) => x.withinLimit)).toBe(true);
    expect(r.config.tools?.filter((t) => t.connection === 'banking_gateway')).toHaveLength(generated.tools.length);
  });

  it('adds the connection, the call_started and call_ended events and the state variable', () => {
    const { config } = makeBankingAgent(plain(), generated);
    expect(config.connections?.banking_gateway).toEqual(generated.connections.banking_gateway);
    expect(config.events.map((e: { on: string }) => e.on)).toEqual(['call_started', 'call_ended']);
    expect(config.state.variables.call_id).toBeDefined();
    expect(config.constants.banking_gateway_url).toBe('');
    expect(isBankingAgent(config)).toBe(true);
  });

  it('wires the hand-offs: the front desk to every specialist and to the agent’s own role, and back', () => {
    const { config, ownRole } = makeBankingAgent(plain(), generated);
    expect(ownRole).toBe('assistant');
    const greeter = role(config, 'greeter')?.handoffs?.map((h: { to: string }) => h.to);
    expect(greeter).toEqual(['authenticator', 'accounts', 'cheques', 'rates_info', 'appointments', 'payments', 'assistant']);
    expect(role(config, 'assistant')?.handoffs?.map((h: { to: string }) => h.to)).toEqual(['greeter']);
    for (const id of BANKING_ROLE_IDS.filter((x) => x !== 'greeter' && x !== 'rates_info')) expect(role(config, id)?.handoffs?.map((h: { to: string }) => h.to)).toContain('greeter');
    // every hand-off points at a role that exists
    const ids = (config.agents?.items as AgentRole[]).map((r) => r.id);
    for (const r of config.agents?.items as AgentRole[]) for (const h of (r.handoffs ?? []) as Array<{ to: string }>) expect(ids).toContain(h.to);
  });

  it('gives every role the design rules, and the two-step rule to the roles that change things', () => {
    const { config } = makeBankingAgent(plain(), generated);
    for (const spec of BANKING_ROLES) {
      const rules = role(config, spec.id)?.instructions?.rules ?? [];
      for (const rule of BANKING_RULES) expect(rules).toContain(rule);
      expect(rules.includes(BANKING_WRITE_RULE)).toBe((role(config, spec.id)?.tools ?? []).includes('confirm_transaction'));
    }
    const all = BANKING_RULES.join(' ');
    expect(all).toMatch(/follow next|Do what next says/);
    expect(all).toMatch(/read it to the caller as given/);
    expect(all).toMatch(/Never ask for a PIN, NRIC, one-time password/);
    expect(all).toMatch(/account ref/);
    expect(BANKING_WRITE_RULE).toMatch(/prepare_ tool, then confirm_transaction/);
  });

  it('is idempotent: applying twice changes nothing', () => {
    const first = makeBankingAgent(plain(), generated);
    const second = makeBankingAgent(first.config, generated);
    expect(second.ok).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.config).toBe(first.config);
    expect(second.rolesAdded).toEqual([]);
  });

  it('keeps the address the runtime uses when one is given', () => {
    const { config } = makeBankingAgent(plain(), generated, { gatewayUrl: 'https://gateway.bank.example' });
    expect(config.constants.banking_gateway_url).toBe('https://gateway.bank.example');
    expect(makeBankingAgent(config, generated).changed).toBe(false);
  });

  it('refuses when the agent has its own role with a banking role’s id, and changes nothing', () => {
    const config = plain();
    (config.agents?.items as AgentRole[]).push({ id: 'accounts', name: 'Accounts payable', instructions: { role: 'Pay suppliers.' }, tools: [] });
    const r = makeBankingAgent(config, generated);
    expect(r.ok).toBe(false);
    expect(r.conflicts[0]).toMatch(/own role "accounts"/);
    expect(r.config).toBe(config);
  });

  it('creates an end_call tool for the front desk when the agent has none', () => {
    const config = plain();
    config.tools = [];
    config.messages = [];
    config.agents = { entry: 'assistant', items: [{ id: 'assistant', name: 'Shop', tools: [] }] };
    const made = makeBankingAgent(config, generated).config;
    expect(made.tools?.some((t) => t.builtin === 'end_call')).toBe(true);
    expect(role(made, 'greeter')?.tools).toContain('end_call');
  });
});

describe('removeBankingAgent', () => {
  it('restores the agent it was made from', () => {
    const bare: AgentConfig = { ...plain(), tools: [], agents: { entry: 'assistant', items: [{ id: 'assistant', name: 'Shop', instructions: { role: 'Help.' }, tools: [] }] } };
    delete bare.messages;
    for (const start of [plain(), bare]) {
      const made = makeBankingAgent(start, generated).config;
      const removed = removeBankingAgent(made);
      expect(removed.ok).toBe(true);
      expect(stableJson(removed.config)).toBe(stableJson(start));
      expect(isBankingAgent(removed.config)).toBe(false);
    }
  });

  it('keeps what the owner added meanwhile', () => {
    const made = makeBankingAgent(plain(), generated).config;
    made.constants = { ...made.constants, payment_url: 'https://pay.example' };
    const removed = removeBankingAgent(made).config;
    expect(removed.constants).toEqual({ payment_url: 'https://pay.example' });
    expect(removed.agents?.entry).toBe('assistant');
  });

  it('refuses when no role of the agent’s own is left to answer', () => {
    const made = makeBankingAgent({ ...plain(), agents: { items: [] } }, generated).config;
    const r = removeBankingAgent(made);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no role of its own/);
  });
});

describe('withBankingChannels', () => {
  it('switches on chat and talking on the website', () => {
    const on = reachOf(withBankingChannels(plain(), { botId: 'shop' }));
    expect(on.web_chat).toBe(true);
    expect(on.web_voice).toBe(true);
  });
});

describe('newBankingAssistant', () => {
  it('is a banking agent reached by web chat and web voice', () => {
    const r = newBankingAssistant(plain(), generated, { botId: 'shop' });
    expect(r.ok).toBe(true);
    expect(isBankingAgent(r.config)).toBe(true);
    expect(r.config.agents?.entry).toBe('greeter');
    expect(reachOf(r.config)).toMatchObject({ web_chat: true, web_voice: true });
  });
});

// The Agent Builder server refuses an agent (and will not start a test session, 422) when two hand-offs share an id or
// a tool name anywhere in it: "duplicate handoff tool name 'go_to_sign_in' (4 times)".
describe('hand-offs the Agent Builder server accepts', () => {
  const handoffsIn = (config: AgentConfig) => (config.agents?.items as AgentRole[]).flatMap((r) => (r.handoffs ?? []) as Array<{ id: string; tool: string; to: string }>);
  const duplicates = (values: string[]) => [...new Set(values.filter((v, i) => values.indexOf(v) !== i))];
  const toolIds = (config: AgentConfig) => (config.tools ?? []).map((t) => t.id as string);

  it('every hand-off id and every hand-off tool name is unique in the agent, and no tool has a hand-off’s name', () => {
    for (const config of [makeBankingAgent(plain(), generated).config, newBankingAssistant(plain(), generated).config]) {
      const all = handoffsIn(config);
      expect(all.length).toBeGreaterThan(10);
      expect(duplicates(all.map((h) => h.id))).toEqual([]);
      expect(duplicates(all.map((h) => h.tool))).toEqual([]);
      expect(all.filter((h) => toolIds(config).includes(h.tool))).toEqual([]);
    }
  });

  it('names say both ends: accounts hands over to sign-in as accounts_to_authenticator / go_to_sign_in_from_accounts', () => {
    const accounts = role(makeBankingAgent(plain(), generated).config, 'accounts');
    expect(accounts?.handoffs).toContainEqual(expect.objectContaining({ id: 'accounts_to_authenticator', tool: 'go_to_sign_in_from_accounts', to: 'authenticator' }));
  });

  it('refreshing a banking agent made by an older Studio (the same hand-off in several roles) repairs it, keeping the owner’s own hand-offs', () => {
    const made = makeBankingAgent(plain(), generated).config;
    const old = (to: string, tool: string) => ({ id: `to_${to}`, tool, description: 'old', to, carry_context: true });
    const owners = { id: 'to_complaints_desk', tool: 'escalate', description: 'mine', to: 'assistant' };
    const broken: AgentConfig = {
      ...made,
      agents: {
        ...made.agents,
        items: (made.agents?.items as AgentRole[]).map((r) =>
          r.id === 'accounts' || r.id === 'cheques' || r.id === 'appointments'
            ? { ...r, handoffs: [old('authenticator', 'go_to_sign_in'), old('greeter', 'back_to_menu'), ...(r.id === 'cheques' ? [owners] : [])] }
            : r
        ),
      },
    };
    expect(duplicates(handoffsIn(broken).map((h) => h.tool)).length).toBeGreaterThan(0);
    expect(handoffClashes(broken)).toEqual(expect.arrayContaining(['to_authenticator', 'go_to_sign_in', 'back_to_menu']));
    expect(handoffClashes(makeBankingAgent(plain(), generated).config)).toEqual([]);
    const repaired = makeBankingAgent(broken, generated);
    expect(repaired.ok && repaired.changed).toBe(true);
    expect(duplicates(handoffsIn(repaired.config).map((h) => h.id))).toEqual([]);
    expect(duplicates(handoffsIn(repaired.config).map((h) => h.tool))).toEqual([]);
    expect(handoffClashes(repaired.config)).toEqual([]);
    expect(handoffsIn(repaired.config).some((h) => h.id.startsWith('to_') && h.id !== 'to_banking')).toBe(false);
    // the one the owner added to cheques (to their own role) is managed, so it is replaced; nothing is duplicated
    expect(stableJson(makeBankingAgent(repaired.config, generated).config)).toBe(stableJson(repaired.config));
  });
});
