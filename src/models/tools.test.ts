import { describe, expect, it } from 'vitest';
import type { AgentConfig, ToolDefinition } from '../types/studio';
import { starters } from '../data/starters';
import { unknownKeys } from '../test/schemaKeys';
import { applyStarter, setEndCall, setHandOver } from './setup';
import { setMoment } from './guardrails';
import {
  BUILTIN_HELP,
  TOOL_CARDS,
  addTool,
  agentsUsingTool,
  deleteTool,
  describeAdvice,
  existingFor,
  firstSentence,
  freeToolId,
  kindOfTool,
  makeTool,
  modelNameOf,
  notAvailable,
  plainToolKind,
  setToolAgent,
  switchOf,
  timeoutAdvice,
  toolDoes,
  toolKindCounts,
  toolMatches,
  toolNamesOf,
  undeclaredTools,
  unusedTools,
  usedByText,
} from './tools';

const fresh = (): AgentConfig => ({
  schema_version: '1.2',
  meta: { id: 'acme', name: 'Acme', version: '0.1.0', status: 'draft' },
  defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini' } } },
  channels: [{ id: 'web-chat', type: 'web_chat', enabled: true, entry: { widget_id: 'acme-widget' }, greeting: { say: 'Hello!' } }],
  agents: { entry: 'assistant', items: [{ id: 'assistant', name: 'Acme', kind: 'standalone', instructions: { role: 'Help.' }, tools: [] }] },
});
const support = () => applyStarter(fresh(), { company: 'Acme', starter: starters[0] });
const card = (id: string) => TOOL_CARDS.find((c) => c.id === id) ?? TOOL_CARDS[0];
const handOverId = (c: AgentConfig) => (c.tools ?? []).find((t) => t.builtin === 'transfer_or_callback')?.id ?? '';

describe('tool facts', () => {
  it('says which kinds the runtime can’t run yet', () => {
    expect(notAvailable({ type: 'mcp' })).toBe('MCP server tools');
    expect(notAvailable({ type: 'task' })).toBeNull();
    expect(notAvailable({ type: 'knowledge' })).toBeNull();
    expect(notAvailable({ type: 'code' })).toBe('Custom code tools');
    expect(notAvailable({ type: 'builtin', builtin: 'send_dtmf' })).toBeNull();
    expect(notAvailable({ type: 'http' })).toBeNull();
    expect(kindOfTool({ builtin: 'end_call' })).toBe('builtin');
    expect(Object.keys(BUILTIN_HELP)).toHaveLength(7);
  });

  it('names a tool by the job it does, and an HTTP tool by whether it reads or sends', () => {
    expect(plainToolKind({ type: 'builtin', builtin: 'end_call' })).toBe('Ends the call');
    expect(plainToolKind({ type: 'http', request: { method: 'GET' } })).toBe('Looks something up');
    expect(plainToolKind({ type: 'http', request: { method: 'post' } })).toBe('Sends something to your systems');
    expect(plainToolKind({ type: 'knowledge' })).toBe('Searches your knowledge');
    expect(plainToolKind(null)).toBe('');
    expect(firstSentence('Use when the caller asks for a person. Say sorry first.')).toBe('Use when the caller asks for a person.');
    expect(firstSentence('No full stop')).toBe('No full stop');
  });

  it('says what a tool does: where it passes calls, what it asks', () => {
    const config: AgentConfig = {
      telephony: { transfers: [{ id: 'desk', target: '+6561234567' }, { id: 'none', target: '' }] },
      connections: { shop: { type: 'http', base_url: 'https://shop.example.com/api' } },
    };
    expect(toolDoes(config, { type: 'builtin', builtin: 'transfer_or_callback', params: { transfer: 'desk' } })).toBe('It passes calls to +6561234567.');
    expect(toolDoes(config, { type: 'builtin', builtin: 'transfer_or_callback', params: { transfer: 'none' } })).toMatch(/callback/);
    expect(toolDoes(config, { type: 'http', connection: 'shop', request: { method: 'GET', path: '/x' } })).toBe('It asks shop.example.com, through the “Shop” connection.');
    expect(toolDoes(config, { type: 'http', connection: 'shop', request: { method: 'POST', path: '/x' } })).toMatch(/^It sends to/);
    expect(toolDoes(config, { type: 'builtin', builtin: 'end_call' })).toBe('');
  });

  it('knows which agents use a tool, and which tools nobody uses', () => {
    const config: AgentConfig = { tools: [{ id: 'a', type: 'http' }, { id: 'b', type: 'http' }], agents: { items: [{ id: 'x', name: 'X', tools: ['a'] }] } };
    expect(agentsUsingTool(config, 'a')).toEqual(['x']);
    expect(agentsUsingTool(config, 'nope')).toEqual([]);
    expect(unusedTools(config)).toEqual(['b']);
    expect(unusedTools({})).toEqual([]);
  });

  it('does not call a tool a guardrail rule uses “not used”, even with no agent offering it', () => {
    const ruled = setMoment(support(), 'frustrated_to_person', true);
    const id = handOverId(ruled);
    const kept = setHandOver(ruled, false);
    expect(kept.tools?.some((t) => t.id === id)).toBe(true);
    expect(unusedTools(kept)).not.toContain(id);
    const plain = support();
    const first = plain.agents?.items?.[0];
    if (first) first.tools = (first.tools ?? []).filter((t) => t !== id);
    expect(unusedTools(plain)).toContain(id);
  });

  it('names the switch above that stands for a tool, and a tool made by hand has none', () => {
    const config = support();
    const end = (config.tools ?? []).find((t) => t.builtin === 'end_call')?.id ?? '';
    expect(switchOf(config, end)).toEqual({ id: 'end_call', label: 'End the conversation politely', on: true });
    expect(switchOf(config, handOverId(config))).toEqual({ id: 'hand_over', label: 'Pass people to a person on your team', on: true });
    const off = setEndCall(setMoment(config, 'abusive_end', true), false);
    expect(switchOf(off, end)?.on ?? false).toBe(false);
    const twice = { ...config, tools: [...(config.tools ?? []), { id: 'end_call_2', type: 'builtin', builtin: 'end_call' } as ToolDefinition] };
    expect(switchOf(twice, 'end_call_2')).toBeNull();
    expect(switchOf(config, 'nope')).toBeNull();
    expect(switchOf(config, '')).toBeNull();
  });

  it('gives advice on timeouts, retries and descriptions', () => {
    expect(timeoutAdvice({})[0]).toMatch(/default of 10 s/);
    expect(timeoutAdvice({ timeout_s: 6, retries: 1 })).toEqual([]);
    expect(timeoutAdvice({ timeout_s: 20, retries: 3 }).join(' ')).toMatch(/20 s[\s\S]*retry/);
    expect(describeAdvice('').level).toBe('warn');
    expect(describeAdvice('Gets the bill').level).toBe('warn');
    expect(describeAdvice('Fetches the current bill for the account number').level).toBe('hint');
    expect(describeAdvice('Use when the caller asks what they owe, to fetch their current bill.').level).toBe('ok');
  });

  it('finds a tool in a long list by words in any order, a kind, or only the unused', () => {
    const tools = [
      { id: 'find_order', type: 'http', description: 'Looks up an order by number' },
      { id: 'refund_order', type: 'http', description: 'Starts a refund' },
      { id: 'end_call', type: 'builtin', builtin: 'end_call', description: 'Ends the conversation' },
      { id: 'faq', type: 'knowledge', description: 'Searches the help centre' },
    ];
    const ids = (filter: Parameters<typeof toolMatches>[1], unused?: Set<string>) => tools.filter((t) => toolMatches(t, filter, unused)).map((t) => t.id);
    expect(ids({})).toEqual(['find_order', 'refund_order', 'end_call', 'faq']);
    expect(ids({ query: 'order' })).toEqual(['find_order', 'refund_order']);
    expect(ids({ query: 'number order' })).toEqual(['find_order']);
    expect(ids({ query: 'LOOKS' })).toEqual(['find_order']);
    expect(ids({ query: 'built-in' })).toEqual(['end_call']);
    expect(ids({ kind: 'http', query: 'refund' })).toEqual(['refund_order']);
    expect(ids({ unusedOnly: true }, new Set(['faq', 'end_call']))).toEqual(['end_call', 'faq']);
    expect(toolKindCounts(tools)).toEqual([
      { kind: 'http', label: 'HTTP', count: 2 },
      { kind: 'builtin', label: 'Built-in', count: 1 },
      { kind: 'knowledge', label: 'Knowledge', count: 1 },
    ]);
    expect(usedByText([])).toBe('not used by any agent');
    expect(usedByText(['billing', 'support'])).toBe('used by billing and support');
    expect(usedByText(['a', 'b', 'c', 'd'])).toBe('used by 4 agents');
  });

  it('names a tool by what the model calls it: its name, else its id', () => {
    const config: AgentConfig = {
      agents: { items: [{ id: 'main', name: 'Main', handoffs: [{ id: 'to_billing', tool: 'go_billing', to: 'billing' }] }] },
      tools: [
        { id: 'report_hazard_phone', type: 'http', name: 'report_hazard' },
        { id: 'report_hazard_chat', type: 'http', name: 'report_hazard' },
        { id: 'lookup', type: 'http' },
      ],
    };
    expect(modelNameOf(config.tools?.[0])).toBe('report_hazard');
    expect(modelNameOf(config.tools?.[2])).toBe('lookup');
    expect(modelNameOf(null)).toBe('');
    expect(toolNamesOf(config)).toEqual(['report_hazard', 'lookup', 'go_billing']);
  });
});

describe('adding and deleting tools', () => {
  it('makes a new tool from each card that only uses the server’s own keys', () => {
    TOOL_CARDS.forEach((card) => {
      const tool = makeTool(card, []);
      expect(tool.type).toBe(card.kind);
      expect(unknownKeys({ tools: [tool] })).toEqual([]);
    });
    expect(freeToolId(['end_call'], 'end_call')).toBe('end_call_2');
    expect(freeToolId(['end_call', 'end_call_2'], 'end_call')).toBe('end_call_3');
    expect(freeToolId([], 'Look Up!')).toBe('look_up');
  });

  it('opens the existing tool for “End the call” and “Hand over”, rather than adding a second', () => {
    const config = support();
    const end = card('end_call');
    const lookup = card('lookup');
    expect(existingFor(config, end)).toBe((config.tools ?? []).findIndex((t) => t.builtin === 'end_call'));
    expect(existingFor(config, lookup)).toBe(-1);
    expect(existingFor(fresh(), end)).toBe(-1);
  });

  it('a new tool goes to the agent that answers first; a deleted one leaves every agent’s list', () => {
    const lookup = card('lookup');
    const { config, index } = addTool(fresh(), makeTool(lookup, []));
    expect(config.tools?.[index].id).toBe('lookup');
    expect(config.agents?.items?.[0].tools).toEqual(['lookup']);
    const gone = deleteTool(config, index);
    expect(gone.tools).toEqual([]);
    expect(gone.agents?.items?.[0].tools).toEqual([]);
    expect(deleteTool(config, 9)).toBe(config);
  });

  it('gives a tool to an agent and takes it away', () => {
    const base: AgentConfig = { tools: [{ id: 't', type: 'http' }], agents: { items: [{ id: 'a', name: 'A', tools: [] }, { id: 'b', name: 'B' }] } };
    const on = setToolAgent(base, 't', 'b', true);
    expect(on.agents?.items?.[1].tools).toEqual(['t']);
    expect(setToolAgent(on, 't', 'b', false).agents?.items?.[1].tools).toEqual([]);
  });

  it('lists ids the answering agent offers that no tool has', () => {
    const config: AgentConfig = { tools: [{ id: 'a', type: 'http' }], agents: { entry: 'x', items: [{ id: 'x', name: 'X', tools: ['a', 'gone'] }] } };
    expect(undeclaredTools(config)).toEqual(['gone']);
  });
});
