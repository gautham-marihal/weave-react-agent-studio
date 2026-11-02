import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { unknownKeys } from '../test/schemaKeys';
import {
  PRESETS,
  addConnectionFor,
  addPreset,
  buildGraph,
  canConnect,
  clearPositions,
  connect,
  duplicateNode,
  nodeId,
  parseNodeId,
  removeEdge,
  removeNodes,
  targetOfPath,
  withPositions,
} from './workflow';

const agentsOf = (c: AgentConfig) => c.agents?.items ?? [];
const toolsOf = (c: AgentConfig) => c.tools ?? [];
const must = <T,>(v: T | undefined): T => {
  if (v === undefined) throw new Error("expected a value");
  return v;
};

// A two-agent bot: a greeter that hands off to billing, a goodbye tool, a knowledge base read on every turn.
const bot = (): AgentConfig => ({
  schema_version: '1.2',
  meta: { id: 'acme', name: 'Acme', version: '0.1.0', status: 'draft' },
  channels: [
    { id: 'web-chat', type: 'web_chat', enabled: true, entry: { widget_id: 'acme-widget' }, modalities: { input: ['text'], output: ['text'] }, greeting: { say: 'Hi!' } },
    { id: 'phone', type: 'sip_voice', enabled: true, entry: {}, modalities: { input: ['audio'], output: ['audio'] } },
  ],
  agents: {
    entry: 'greeter',
    items: [
      { id: 'greeter', name: 'Greeter', kind: 'router', instructions: { role: 'Find out what they need.' }, tools: ['end_call'], handoffs: [{ id: 'to_billing', tool: 'go_to_billing', description: 'Bills.', to: 'billing' }] },
      { id: 'billing', name: 'Billing', kind: 'specialist', instructions: { role: 'Answer bill questions.' }, tools: [], knowledge: ['manual'] },
      { id: 'orphan', name: 'Orphan', kind: 'specialist', instructions: { role: 'Never reached.' }, tools: [] },
    ],
  },
  tools: [
    { id: 'end_call', type: 'builtin', builtin: 'end_call', description: 'Ends it.' },
    { id: 'lookup', type: 'http', description: 'Looks up.', connection: 'crm', request: { method: 'GET', path: '/x' }, parameters: { type: 'object' } },
    { id: 'search', type: 'knowledge', description: 'Searches.', source: 'help' },
  ],
  knowledge: [
    { id: 'manual', type: 'vector_store', mode: 'inject', sources: [{ type: 'url', url: 'https://example.com' }] },
    { id: 'help', type: 'vector_store', sources: [{ type: 'url', url: 'https://example.com/help' }] },
  ],
  connections: { crm: { type: 'http', base_url: 'https://crm.example.com', auth: { type: 'bearer', token: { secret: 'CRM_TOKEN' } } } },
});

describe('buildGraph', () => {
  it('draws one block per channel, agent, tool and knowledge base, and the arrows the config holds', () => {
    const g = buildGraph(bot());
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['billing', 'channel::phone', 'channel::web-chat', 'greeter', 'kb::help', 'kb::manual', 'orphan', 'tool::end_call', 'tool::lookup', 'tool::search'].sort());
    const arrows = g.edges.map((e) => `${e.kind} ${e.source}>${e.target}`);
    expect(arrows).toEqual(
      expect.arrayContaining([
        'entry channel::web-chat>greeter',
        'entry channel::phone>greeter',
        'handoff greeter>billing',
        'uses greeter>tool::end_call',
        'reads billing>kb::manual',
        'searches tool::search>kb::help',
      ])
    );
    expect(g.entry).toBe('greeter');
    expect(g.autoLayout).toBe(true);
  });

  it('marks what nothing reaches or uses, and does not treat it as running', () => {
    const g = buildGraph(bot());
    const loose = Object.fromEntries(g.nodes.map((n) => [n.id, n.loose]));
    expect(loose.orphan).toMatch(/no call reaches it/);
    expect(loose.billing).toBe('');
    expect(loose['tool::lookup']).toMatch(/No agent uses it/);
    expect(loose['tool::end_call']).toBe('');
    // searched by a tool nobody uses: still "searched", the tool itself is the loose one
    expect(loose['kb::help']).toBe('');
  });

  it('lays out by how far a call has to go, and keeps saved places', () => {
    const g = buildGraph(bot());
    const x = (id: string) => g.nodes.find((n) => n.id === id)?.position.x ?? -1;
    expect(x('channel::web-chat')).toBeLessThan(x('greeter'));
    expect(x('greeter')).toBeLessThan(x('billing'));
    expect(x('billing')).toBeLessThan(x('orphan'));
    const placed = buildGraph(withPositions(bot(), { billing: { x: 12.4, y: 99.6 } }));
    expect(placed.nodes.find((n) => n.id === 'billing')?.position).toEqual({ x: 12, y: 100 });
    expect(placed.autoLayout).toBe(false);
  });

  it('wraps many tools into short columns, with knowledge bases after them', () => {
    const c = bot();
    c.tools = Array.from({ length: 27 }, (_, i) => ({ id: `t${i}`, type: 'builtin' as const, builtin: 'noop' }));
    const g = buildGraph(c);
    const tools = g.nodes.filter((n) => n.kind === 'tool');
    expect(new Set(tools.map((n) => n.position.x)).size).toBe(4);
    expect(Math.max(...tools.map((n) => n.position.y))).toBeLessThan(800);
    const kb = g.nodes.find((n) => n.kind === 'knowledge')?.position.x ?? 0;
    expect(kb).toBeGreaterThan(Math.max(...tools.map((n) => n.position.x)));
  });

  it('reaches an agent through a tool that hands off, and draws the way back', () => {
    const config = bot();
    config.tools?.push({ id: 'route', type: 'builtin', builtin: 'noop', effects: [{ when: { channel: 'phone' }, do: [{ type: 'handoff', to: 'orphan' }] }] });
    config.tools?.push({ id: 'back', type: 'builtin', builtin: 'return_to_entry' });
    config.agents?.items?.[1].tools?.push('route', 'back');
    const g = buildGraph(config);
    expect(g.nodes.find((n) => n.id === 'orphan')?.loose).toBe('');
    expect(g.edges.some((e) => e.kind === 'tool_handoff' && e.source === 'tool::route' && e.target === 'orphan')).toBe(true);
    expect(g.edges.find((e) => e.kind === 'returns')?.target).toBe('greeter');
  });
});

describe('targetOfPath', () => {
  it('finds the block, and the hand-off arrow, a server problem is about', () => {
    const c = bot();
    expect(targetOfPath(['agents', 'items', 0, 'handoffs', 0, 'description'], c)).toEqual({ node: 'greeter', edge: 'handoff:greeter:0' });
    expect(targetOfPath(['tools', 1, 'connection'], c)).toEqual({ node: 'tool::lookup' });
    expect(targetOfPath(['channels', 1, 'greeting'], c)).toEqual({ node: 'channel::phone' });
    expect(targetOfPath(['knowledge', 0], c)).toEqual({ node: 'kb::manual' });
    expect(targetOfPath(['agents', 'entry'], c)).toEqual({ node: 'greeter' });
    expect(targetOfPath(['defaults', 'models'], c)).toBeNull();
    expect(targetOfPath(null, c)).toBeNull();
  });
});

describe('connecting', () => {
  it('refuses arrows the config has no place for, and says why', () => {
    const c = bot();
    expect(canConnect(c, 'greeter', 'greeter')).toMatch(/itself/);
    expect(canConnect(c, 'channel::phone', 'tool::lookup')).toMatch(/agent/);
    expect(canConnect(c, 'greeter', 'billing')).toMatch(/already hands off/);
    expect(canConnect(c, 'greeter', 'kb::help')).toMatch(/searched by a tool/);
    expect(canConnect(c, 'tool::search', 'kb::manual')).toMatch(/read on every turn/);
    expect(canConnect(c, 'tool::lookup', 'billing')).toMatch(/knowledge search or a conditional hand-off/);
    expect(canConnect(c, 'kb::help', 'greeter')).toMatch(/Nothing starts/);
    expect(connect(c, 'greeter', 'greeter').config).toBe(c);
  });

  it('a hand-off between agents gets unique ids and model-facing names, and a standalone agent becomes a router', () => {
    const c = bot();
    agentsOf(c)[1].kind = 'standalone';
    toolsOf(c).push({ id: 'go_to_orphan', type: 'builtin', builtin: 'noop' });
    const r = connect(c, 'billing', 'orphan');
    const billing = agentsOf(r.config)[1];
    expect(billing.kind).toBe('router');
    expect(billing.handoffs).toEqual([{ id: 'to_orphan', tool: 'go_to_orphan_2', description: 'The caller needs Orphan.', to: 'orphan', carry_context: true }]);
    expect(r.selectEdge).toBe('handoff:billing:0');
    expect(unknownKeys(r.config)).toEqual([]);
  });

  it('gives a tool, a knowledge base, a search source and a conditional hand-off', () => {
    let c = bot();
    c = connect(c, 'billing', 'tool::lookup').config;
    expect(agentsOf(c)[1].tools).toEqual(['lookup']);
    c.knowledge?.push({ id: 'faq', type: 'vector_store', sources: [{ type: 'url', url: 'https://example.com/faq' }] });
    c = connect(c, 'tool::search', 'kb::faq').config;
    expect(toolsOf(c)[2].source).toBe('faq');
    toolsOf(c).push({ id: 'route', type: 'builtin', builtin: 'noop' });
    c = connect(c, 'tool::route', 'orphan').config;
    expect(toolsOf(c)[3].effects).toEqual([{ do: [{ type: 'handoff', to: 'orphan' }] }]);
    expect(unknownKeys(c)).toEqual([]);
  });

  it('a channel connected to another agent makes it the one that answers first, for every channel', () => {
    const r = connect(bot(), 'channel::phone', 'billing');
    expect(r.config.agents?.entry).toBe('billing');
    expect(r.note).toMatch(/Every channel now starts with Billing/);
  });
});

describe('taking away', () => {
  it('takes away a hand-off, a tool use and a conditional hand-off; keeps the arrows that are fixed', () => {
    const c = bot();
    const g = buildGraph(c);
    const handoff = must(g.edges.find((e) => e.kind === 'handoff'));
    const r = removeEdge(c, handoff);
    expect(agentsOf(r.config)[0].handoffs).toBeUndefined();
    const uses = must(g.edges.find((e) => e.kind === 'uses'));
    expect(agentsOf(removeEdge(c, uses).config)[0].tools).toEqual([]);
    const entry = must(g.edges.find((e) => e.kind === 'entry'));
    expect(removeEdge(c, entry).refused).toMatch(/starts with the agent that answers first/);
    expect(removeEdge(c, must(g.edges.find((e) => e.kind === 'searches'))).refused).toMatch(/must search a base/);
  });

  it('deleting an agent takes the hand-offs to it, moves the first agent on, and forgets its place', () => {
    const c = withPositions(bot(), { greeter: { x: 1, y: 1 }, billing: { x: 2, y: 2 } });
    const r = removeNodes(c, ['greeter']);
    expect(r.refused).toBe('');
    expect(r.config.agents?.entry).toBe('billing');
    expect(r.config.agents?.items?.map((a) => a.id)).toEqual(['billing', 'orphan']);
    expect(r.config.builder?.ui?.graph_positions).toEqual({ billing: { x: 2, y: 2 } });
    const t = removeNodes(bot(), ['billing']);
    expect(agentsOf(t.config)[0].handoffs).toBeUndefined();
    expect(unknownKeys(t.config)).toEqual([]);
  });

  it('deleting a tool takes it from every agent; the last agent, the last channel and knowledge bases stay', () => {
    const r = removeNodes(bot(), ['tool::end_call']);
    expect(r.config.tools?.map((t) => t.id)).toEqual(['lookup', 'search']);
    expect(agentsOf(r.config)[0].tools).toEqual([]);
    const one = bot();
    one.agents = { entry: "greeter", items: agentsOf(one).slice(0, 1) };
    expect(removeNodes(one, ['greeter']).refused).toMatch(/at least one agent/);
    const r2 = removeNodes(bot(), ['channel::phone', 'channel::web-chat']);
    expect(r2.config.channels?.map((c) => c.id)).toEqual(['web-chat']);
    expect(r2.refused).toMatch(/at least one way/);
    expect(removeNodes(bot(), ['kb::manual']).refused).toMatch(/Knowledge page/);
  });

  it('says when other settings still name what was deleted', () => {
    const c = bot();
    c.guardrails = { escalation: [{ id: 'angry', when: { sentiment: 'abusive' }, action: 'tool', tool: 'lookup' }] };
    expect(removeNodes(c, ['tool::lookup']).note).toMatch(/still name the tool lookup/);
  });
});

describe('duplicating', () => {
  it('copies an agent with ids of its own, and a tool used by nobody yet', () => {
    const r = duplicateNode(bot(), 'greeter');
    const copy = must(agentsOf(r.config).at(-1));
    expect(copy.id).toBe('greeter_copy');
    expect(copy.name).toBe('Greeter (copy)');
    expect(copy.handoffs?.[0]).toMatchObject({ id: 'to_billing_copy', tool: 'go_to_billing_copy', to: 'billing' });
    expect(r.select).toEqual(['greeter_copy']);
    const t = duplicateNode(bot(), 'tool::lookup');
    expect(toolsOf(t.config).at(-1)).toMatchObject({ id: 'lookup_copy', type: 'http' });
    expect(duplicateNode(bot(), 'channel::phone').refused).toMatch(/one channel of each kind/);
  });
});

describe('the library', () => {
  it('every item adds only what the schema allows', () => {
    PRESETS.forEach((p) => {
      const r = addPreset(bot(), p.id, { botId: 'acme' });
      expect(unknownKeys(r.config), p.id).toEqual([]);
    });
  });

  it('adds a new agent and a new tool unconnected, selected, with fresh ids', () => {
    const a = addPreset(bot(), 'agent');
    expect(agentsOf(a.config).at(-1)).toEqual({ id: 'agent', name: 'New agent', kind: 'specialist', instructions: { role: '' }, tools: [] });
    expect(a.select).toEqual(['agent']);
    const twice = addPreset(a.config, 'agent');
    expect(agentsOf(twice.config).at(-1)).toMatchObject({ id: 'agent_2', name: 'New agent 2' });
    const h = addPreset(bot(), 'http');
    expect(toolsOf(h.config).at(-1)).toMatchObject({ id: 'http_request', type: 'http', connection: 'crm' });
    expect(buildGraph(h.config).nodes.find((n) => n.id === 'tool::http_request')?.loose).toMatch(/No agent uses it/);
  });

  it('a transfer brings its own transfer entry and callback line', () => {
    const r = addPreset(bot(), 'transfer');
    const tool = must(toolsOf(r.config).at(-1));
    expect(tool).toMatchObject({ type: 'builtin', builtin: 'transfer_or_callback', params: { transfer: 'human_support' } });
    expect((r.config.telephony as { transfers: unknown[] }).transfers).toEqual([expect.objectContaining({ id: 'human_support', method: 'sip_refer', target: '' })]);
    expect(r.config.messages).toEqual([expect.objectContaining({ id: 'callback_line' })]);
  });

  it('refuses a second channel of a kind, or a second goodbye, and points at the one there is', () => {
    const r = addPreset(bot(), 'web_chat');
    expect(r.refused).toMatch(/already has a web chat channel/);
    expect(r.select).toEqual(['channel::web-chat']);
    expect(addPreset(bot(), 'end_call').select).toEqual(['tool::end_call']);
    const voice = addPreset(bot(), 'web_voice', { botId: 'acme' });
    expect(voice.config.channels?.map((c) => c.type)).toEqual(['web_chat', 'sip_voice', 'web_voice']);
  });
});

describe('places', () => {
  it('keeps places it does not know about, and forgets them all when tidied', () => {
    const c = withPositions(bot(), { 'someone::else': { x: 5, y: 5 } });
    const moved = withPositions(c, { greeter: { x: 1, y: 2 } });
    expect(moved.builder?.ui?.graph_positions).toEqual({ 'someone::else': { x: 5, y: 5 }, greeter: { x: 1, y: 2 } });
    expect(clearPositions(moved).builder).toBeUndefined();
    expect(unknownKeys(moved)).toEqual([]);
  });

  it('block ids round-trip', () => {
    expect(parseNodeId(nodeId('tool', 'x'))).toEqual({ kind: 'tool', ref: 'x' });
    expect(parseNodeId(nodeId('knowledge', 'x'))).toEqual({ kind: 'knowledge', ref: 'x' });
    expect(parseNodeId(nodeId('channel', 'web-chat'))).toEqual({ kind: 'channel', ref: 'web-chat' });
    expect(parseNodeId('greeter')).toEqual({ kind: 'agent', ref: 'greeter' });
  });
});

describe('addConnectionFor', () => {
  const withTool = (type: 'http' | 'mcp') => addPreset({ agents: { entry: 'a', items: [{ id: 'a', name: 'A', instructions: { role: 'x' }, tools: [] }] } } as unknown as AgentConfig, type).config;

  it('declares an HTTP connection from the address and points the tool at it', () => {
    const r = addConnectionFor(withTool('http'), 0, 'https://api.example.com/v1/');
    expect(r.problem).toBe('');
    expect(r.config.connections).toEqual({ api: { type: 'http', base_url: 'https://api.example.com/v1' } });
    expect((r.config.tools as Record<string, unknown>[])[0].connection).toBe('api');
    expect(unknownKeys(r.config)).toEqual([]);
  });

  it('declares an MCP server for an MCP tool, with a fresh id when the name is taken', () => {
    const first = addConnectionFor(withTool('mcp'), 0, 'mcp.example.com/mcp').config;
    const again = addConnectionFor(first, 0, 'https://mcp.other.com').config;
    expect(again.connections).toEqual({ mcp: { type: 'mcp', url: 'https://mcp.example.com/mcp' }, mcp_2: { type: 'mcp', url: 'https://mcp.other.com' } });
    expect((again.tools as Record<string, unknown>[])[0].server).toBe('mcp_2');
  });

  it('refuses an address it cannot use, and a tool that takes no connection', () => {
    const http = withTool('http');
    expect(addConnectionFor(http, 0, 'not a url')).toEqual({ config: http, problem: expect.stringMatching(/address it answers on/) });
    expect(addConnectionFor(http, 0, 'ftp://files.example.com').problem).not.toBe('');
    expect(addConnectionFor(http, 5, 'https://api.example.com').problem).toMatch(/Only HTTP and MCP/);
  });
});
