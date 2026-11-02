import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { CALLERS, CALLER_MARK, CHECK_MARK, autoChecks, configWithScenarios, contextOf, suggestions, topicOf } from './callers';
import { scenarioProblems } from './scenario';

// Scripted callers and the checks made from what an agent has: scenarios in the same shape a person writes.
const config = (): AgentConfig => ({
  meta: { id: 'a', name: 'Acme' },
  persona: { name: 'Ava' },
  channels: [{ id: 'phone', type: 'sip_voice', enabled: true, greeting: { say: 'Hi, this is Acme. How can I help?' } }],
  defaults: { language: { primary: 'en-US', speaks: ['en', 'fr'] } },
  tools: [
    { id: 'lookup_order', description: 'Looks up the status of an order.', type: 'http' },
    { id: 'create_ticket', description: 'Creates a support ticket for the caller.', type: 'http' },
    { id: 'end_call', type: 'builtin', builtin: 'end_call' },
    { id: 'transfer', type: 'builtin', builtin: 'transfer_or_callback' },
  ],
  agents: { entry: 'main', items: [{ id: 'main', name: 'Main', tools: ['lookup_order', 'end_call', 'transfer'] }] },
});

describe('scripted callers', () => {
  it('word what a caller asks for from a tool’s own description', () => {
    expect(topicOf({ description: 'Looks up the status of an order.' })).toEqual({ phrase: 'look up the status of an order', verb: true });
    expect(topicOf({ description: 'Creates a support ticket for the caller.' })).toEqual({ phrase: 'create a support ticket for the caller', verb: true });
    expect(topicOf({ description: 'Checks the weather' })).toEqual({ phrase: 'check the weather', verb: true });
    expect(topicOf({ description: 'Order lookup' })).toEqual({ phrase: 'order lookup', verb: false });
    expect(topicOf({ id: 'refund_status' })).toEqual({ phrase: 'refund status', verb: false });
  });

  it('read the agent’s tools, channel, name and languages once', () => {
    const c = contextOf(config());
    expect(c.channel).toBe('phone');
    expect(c.main?.id).toBe('lookup_order');
    expect(c.transfer).toBe('transfer');
    expect(c.endCall).toBe('end_call');
    expect(c.others).toEqual(['fr']);
    expect(c.name).toBe('Ava');
  });

  it('are each a scenario the runner accepts, on the agent’s channel, with something to check', () => {
    const all = suggestions(config());
    expect(all.filter((s) => s.group === 'caller')).toHaveLength(CALLERS.length);
    expect(all.filter((s) => s.group === 'check').length).toBeGreaterThanOrEqual(4);
    const ids = all.map((s) => s.scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    all.forEach((s) => {
      expect(s.scenario.channel).toBe('phone');
      expect(s.scenario.turns.length >= 1 && s.scenario.turns.every((t) => String(t.say).trim())).toBe(true);
      expect(s.scenario.expect.length).toBeGreaterThanOrEqual(1);
      expect(scenarioProblems(s.scenario, config())).toEqual({});
    });
  });

  it('are written from this agent’s tools, and use the person and the hang-up when it has them', () => {
    const all = Object.fromEntries(suggestions(config()).map((s) => [s.key, s]));
    expect(all.caller_direct.scenario.turns[0].say).toMatch(/look up the status of an order/);
    expect(all.caller_direct.scenario.expect.find((e) => e.tool_called)).toEqual({ tool_called: 'lookup_order' });
    expect(all.caller_wants_person.scenario.expect.find((e) => e.tool_called)).toEqual({ tool_called: 'transfer' });
    expect(all.caller_other_language.scenario.turns[0].say).toMatch(/Bonjour/);
    expect(all.check_tool_create_ticket && all.check_tool_lookup_order && all.check_person && all.check_hangs_up && all.check_greets).toBeTruthy();
    expect(all.check_hangs_up.scenario.expect.find((e) => e.tool_called)).toEqual({ tool_called: 'end_call' });
  });

  it('say which checks need a reviewer (the live model), and which are plain', () => {
    const all = suggestions(config());
    expect(all.filter((s) => s.group === 'caller').every((s) => s.needsJudge && s.scenario.expect.some((e) => e.judge))).toBe(true);
    expect(all.filter((s) => s.group === 'check').every((s) => !s.needsJudge && !s.scenario.expect.some((e) => e.judge))).toBe(true);
  });

  it('are offered to an agent with no tools, with no checks for tools it does not have', () => {
    const bare: AgentConfig = { meta: { id: 'b', name: 'B' }, channels: [{ id: 'chat', type: 'web_chat', enabled: true }], tools: [] };
    const all = suggestions(bare);
    expect(all.filter((s) => s.group === 'caller')).toHaveLength(CALLERS.length);
    expect(all.filter((s) => s.group === 'check').map((s) => s.key)).toEqual(['check_greets']);
    expect(all.every((s) => s.scenario.expect.every((e) => !('tool_called' in e)))).toBe(true);
  });

  it('recognise one already kept, and never take the id of a test of someone else’s', () => {
    const kept = {
      ...config(),
      tests: [
        { id: 'caller_frustrated', description: `${CALLER_MARK}Frustrated`, channel: 'phone', turns: [{ say: 'x' }], expect: [{ said_matches: '.' }] },
        { id: 'caller_direct', description: 'my own', channel: 'phone', turns: [{ say: 'x' }], expect: [{ said_matches: '.' }] },
      ],
    };
    const all = Object.fromEntries(suggestions(kept).map((s) => [s.key, s]));
    expect(all.caller_frustrated.kept).toBe(true);
    expect(all.caller_frustrated.scenario.id).toBe('caller_frustrated');
    expect(all.caller_direct.kept).toBe(false);
    expect(all.caller_direct.scenario.id).not.toBe('caller_direct');
    expect(autoChecks(config())).toHaveLength(suggestions(config()).filter((s) => s.group === 'check').length);
  });

  it('mark what they make plainly, and never say the word for imitation', () => {
    const descriptions = suggestions(config()).map((s) => s.scenario.description ?? '');
    expect(descriptions.every((d) => d.startsWith(CALLER_MARK) || d.startsWith(CHECK_MARK))).toBe(true);
    expect(descriptions.join(' ')).not.toMatch(/simulat/i);
  });

  it('match the first words of the greeting whatever punctuation is between them', () => {
    const greets = suggestions(config()).find((s) => s.key === 'check_greets');
    const pattern = greets?.scenario.expect.find((e) => e.said_matches && e.said_matches !== '.+')?.said_matches;
    expect(pattern).toBeTruthy();
    const re = new RegExp(String(pattern), 'i');
    expect(re.test('Hi, this is Acme. How can I help?')).toBe(true);
    expect(re.test('hi this is acme')).toBe(true);
    expect(re.test('Good morning, Acme speaking')).toBe(false);
    const noGreeting = { ...config(), channels: [{ id: 'phone', type: 'sip_voice' as const, enabled: true }] };
    expect(suggestions(noGreeting).find((s) => s.key === 'check_greets')?.scenario.expect).toEqual([{ said_matches: '.+' }]);
  });

  it('are tried with the editor’s config plus themselves, leaving the draft as it was', () => {
    const base = { ...config(), tests: [{ id: 'mine', channel: 'phone', turns: [{ say: 'x' }], expect: [{ said_matches: '.' }] }] };
    const picked = suggestions(base)
      .slice(0, 2)
      .map((s) => s.scenario);
    const sent = configWithScenarios(base, picked);
    expect((sent.tests as Array<{ id: string }>).map((t) => t.id)).toEqual(['mine', ...picked.map((s) => s.id)]);
    expect(base.tests).toHaveLength(1);
  });
});
