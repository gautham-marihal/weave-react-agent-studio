import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { MAP_NODE, buildAgentMap, buildToolGrid, describeEdges, placeLabel, setToolOffered, usedBy } from './relations';

// A front desk that hands off to billing and support, a tool whose rules hand over, a safety rule, a stranded agent.
const example = (): AgentConfig => ({
  messages: [{ id: 'goodbye', text: 'Bye!' }],
  state: { variables: { verified: { type: 'boolean' }, plan: { type: 'string' } } },
  connections: { billing_api: { type: 'http', base_url: 'https://billing.example.com' } },
  agents: {
    entry: 'front',
    items: [
    {
      id: 'front',
      name: 'Front desk',
      tools: ['end_call', 'escalate_to_human'],
      handoffs: [
      { id: 'to_billing', tool: 'go_to_billing', to: 'billing', description: 'when the caller asks about a bill' },
      { id: 'to_support', tool: 'go_to_support', to: 'support', description: '' }],

      instructions: { role: 'Greet. The caller is {{state.verified}}.' }
    },
    { id: 'billing', name: 'Billing', tools: ['lookup', 'end_call'], on_enter: [{ type: 'set_state', values: { plan: '' } }] },
    { id: 'support', name: 'Support', tools: ['end_call'] },
    { id: 'human', name: 'A person' },
    { id: 'lonely', name: 'Lonely' }]

  },
  tools: [
  { id: 'end_call', type: 'builtin', builtin: 'end_call', params: { say: { message: 'goodbye' } } },
  { id: 'lookup', type: 'http', connection: 'billing_api', description: 'Looks up a bill.' },
  { id: 'escalate_to_human', type: 'builtin', builtin: 'transfer_or_callback', effects: [{ steps: [{ type: 'handoff', to: 'human' }] }] },
  { id: 'spare', type: 'builtin', builtin: 'noop', description: 'Nothing uses this.' }],

  guardrails: { escalation: [{ id: 'abuse', action: 'handoff', to: 'human' }] },
  tests: [{ id: 'refund', expect: [{ tool_called: 'lookup' }] }]
});

describe('the agent map', () => {
  it('draws the agents in columns by distance from the one that answers first, with their hand-offs as arrows', () => {
    const map = buildAgentMap(example());
    expect(map.entry).toBe('front');
    expect(map.nodes).toHaveLength(5);
    const first = map.nodes.find((n) => n.entry);
    expect(first?.column).toBe(0);
    expect(first?.x).toBe(MAP_NODE.pad);
    expect(map.nodes.find((n) => n.id === 'billing')?.column).toBe(1);
    expect(map.edges.filter((e) => e.kind === 'handoff')).toHaveLength(2);
    const boxes = map.nodes.map((n) => `${n.x},${n.y}`);
    expect(new Set(boxes).size).toBe(boxes.length);
    expect(map.width).toBeGreaterThan(0);
  });

  it('shows an agent nothing can reach in a column of its own, called unreachable', () => {
    const map = buildAgentMap(example());
    expect(map.unreachable).toEqual(['lonely']);
    const lonely = map.nodes.find((n) => n.id === 'lonely');
    expect(lonely?.reachable).toBe(false);
    expect(lonely?.column).toBe(Math.max(...map.nodes.filter((n) => n.reachable).map((n) => n.column)) + 1);
  });

  it('draws a tool whose rules hand over and a safety rule as their own kinds of arrow; a hand-off to nobody is not drawn', () => {
    const c = example();
    (c.agents?.items?.[0].handoffs ?? []).push({ id: 'to_ghost', to: 'ghost' });
    const map = buildAgentMap(c);
    expect(map.edges.find((e) => e.kind === 'tool')).toMatchObject({ from: 'front', to: 'human' });
    expect(map.edges.find((e) => e.kind === 'rule')).toMatchObject({ from: 'front', to: 'human' });
    expect(map.edges.some((e) => e.to === 'ghost')).toBe(false);
  });

  it('merges arrows between the same two agents, and does not break on an empty or odd configuration', () => {
    const c = example();
    (c.agents?.items?.[0].handoffs ?? []).push({ id: 'to_billing_2', tool: 'billing_again', to: 'billing' });
    const map = buildAgentMap(c);
    const toBilling = map.edges.filter((e) => e.to === 'billing' && e.kind === 'handoff');
    expect(toBilling).toHaveLength(1);
    expect(toBilling[0].labels).toEqual(['to_billing', 'to_billing_2']);
    expect(buildAgentMap({}).nodes).toEqual([]);
    expect(buildAgentMap({ agents: { items: [null as never, { id: '' } as never] } }).nodes).toEqual([]);
  });

  it('labels arrows in plain words: the agent it goes to, the tool, “Safety rule”; the ids stay underneath', () => {
    const map = buildAgentMap(example());
    const edge = (to: string, kind: string) => map.edges.find((e) => e.to === to && e.kind === kind);
    expect(edge('billing', 'handoff')?.words).toEqual(['Billing']);
    expect(edge('billing', 'handoff')?.labels).toEqual(['to_billing']);
    expect(edge('human', 'tool')?.words).toEqual(['Escalate to human']);
    expect(edge('human', 'rule')?.words).toEqual(['Safety rule']);
    const sentences = describeEdges(map).join(' | ');
    expect(sentences).toMatch(/Front desk hands the caller to Billing \(when the caller asks about a bill\)\./);
    expect(sentences).toMatch(/Front desk hands the caller to Support\./);
    expect(sentences).toMatch(/Front desk can pass the caller to A person \(through Escalate to human\)\./);
    expect(sentences).not.toMatch(/to_billing|escalate_to_human|abuse/);
  });
});

describe('the tool grid', () => {
  it('says who has each tool, which tools nobody has, and which are shared', () => {
    const grid = buildToolGrid(example());
    expect(grid.agents.map((a) => [a.id, a.count])).toEqual([['front', 2], ['billing', 2], ['support', 1], ['human', 0], ['lonely', 0]]);
    expect(grid.unused).toEqual(['spare']);
    expect(grid.shared).toEqual(['end_call']);
    expect(grid.rows.find((r) => r.id === 'lookup')?.cells).toEqual([false, true, false, false, false]);
  });

  it('ticking a cell edits the agent’s own tools list and nothing else', () => {
    const c = example();
    const on = setToolOffered(c, 'support', 'spare', true);
    expect(on.agents?.items?.[2].tools).toEqual(['end_call', 'spare']);
    expect({ ...on, agents: undefined }).toEqual({ ...c, agents: undefined });
    const off = setToolOffered(on, 'support', 'end_call', false);
    expect(off.agents?.items?.[2].tools).toEqual(['spare']);
    expect(setToolOffered(c, 'support', 'end_call', true)).toBe(c);
    expect(setToolOffered(c, 'nobody', 'end_call', true)).toBe(c);
  });
});

describe('used by', () => {
  it('finds what uses a tool, one entry per place, each with a path to go to', () => {
    const uses = usedBy(example(), 'tools', 'end_call');
    expect(uses.map((u) => u.place)).toEqual(['agent “Front desk”', 'agent “Billing”', 'agent “Support”']);
    expect(uses[0].path).toEqual(['agents', 'items', 0, 'tools', 0]);
    expect(usedBy(example(), 'tools', 'lookup').map((u) => u.place)).toEqual(['agent “Billing”', 'test “refund”']);
    expect(usedBy(example(), 'tools', 'spare')).toEqual([]);
    expect(usedBy(null, 'tools', 'x')).toEqual([]);
  });

  it('finds a fixed line, a connection, a remembered value (in rules and in text) and an agent', () => {
    const c = example();
    expect(usedBy(c, 'messages', 'goodbye').map((u) => u.place)).toEqual(['tool “end_call”']);
    expect(usedBy(c, 'connections', 'billing_api').map((u) => u.place)).toEqual(['tool “lookup”']);
    expect(usedBy(c, 'state', 'verified').map((u) => u.place)).toEqual(['agent “Front desk”']);
    expect(usedBy(c, 'state', 'plan').map((u) => u.place)).toEqual(['agent “Billing”']);
    expect(usedBy(c, 'agents', 'human').map((u) => u.place)).toEqual(['tool “escalate_to_human”', 'safety rule “abuse”']);
    expect(usedBy(c, 'agents', 'front').map((u) => u.place)).toEqual(['which agent answers first']);
  });

  it('walks the same configuration once for every card, not once per card', () => {
    const c = example();
    const first = usedBy(c, 'tools', 'end_call');
    expect(usedBy(c, 'tools', 'end_call')).toBe(first);
  });

  it('names a place by the item it is inside', () => {
    const c = example();
    expect(placeLabel(c, ['telephony', 'transfers', 0, 'target'])).toBe('transfer “…”');
    expect(placeLabel(c, ['events', 0, 'do'])).toBe('event hook “1”');
    expect(placeLabel(c, ['post_call', 'summary'])).toBe('after the call');
  });
});
