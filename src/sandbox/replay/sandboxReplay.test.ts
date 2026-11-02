import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../../types/studio';
import { readCall } from '../../models/replayFacts';
import { SIMULATION_LABEL, playOnImitation, replayInBrowser } from './sandboxReplay';

// Ported from Weave React's tests/replay.test.js (playSimulated), on Studio's own reading of a call.
const config = {
  meta: { id: 'shop', name: 'Shop', version: '0.1.0' },
  channels: [{ id: 'web-chat', type: 'web_chat', greeting: { say: 'Hello, welcome to the shop.' } }],
  agents: {
    entry: 'assistant',
    items: [
      {
        id: 'assistant',
        name: 'Assistant',
        instructions: { role: 'You help customers.' },
        tools: ['lookup_order', 'end'],
        handoffs: [{ tool: 'to_billing', to: 'billing', description: 'billing and invoices questions' }],
      },
      { id: 'billing', name: 'Billing', instructions: { role: 'You handle billing.' }, tools: [] },
    ],
  },
  tools: [
    { id: 'lookup_order', name: 'lookup_order', description: 'Look up an order by its number' },
    { id: 'end', builtin: 'end_call' },
  ],
  state: { variables: { order_status: { type: 'string', default: null } } },
} as unknown as AgentConfig;

/** A call's records: the greeting, then each line said. */
function call(lines: [who: 'user' | 'agent', text: string][]) {
  let seq = 0;
  const rec = (event: string, fields: Record<string, unknown> = {}) => ({ seq: (seq += 1), elapsed_s: seq, event, ...fields });
  return [
    rec('call_started', { channel: { id: 'web-chat', type: 'web_chat' } }),
    rec('agent_entered', { agent: 'assistant', first: true }),
    rec('agent_said', { text: 'Hello, welcome to the shop.' }),
    ...lines.map(([who, text]) => rec(who === 'user' ? 'user_said' : 'agent_said', { text })),
    rec('call_ended', { duration_s: 30 }),
  ];
}

describe('a replay on Sandbox’s imitation', () => {
  it('answers the same turns, with the tools and hand-overs the configuration has', () => {
    const original = readCall(
      call([
        ['user', 'Where is my order'],
        ['agent', 'x'],
        ['user', 'a billing question'],
        ['agent', 'y'],
      ]),
    );
    const replay = playOnImitation(config, original);
    expect(replay.turns).toHaveLength(2);
    expect(replay.turns[0].tools[0].tool).toBe('lookup_order');
    expect(replay.turns[1].tools[0].handoff).toBe('billing');
    expect(replay.finalAgent).toBe('billing');
    expect(replay.channelId).toBe('web-chat');
  });

  it('does not reach the turns after the agent hangs up, and the comparison says so', () => {
    const original = readCall(
      call([
        ['user', 'bye'],
        ['agent', 'x'],
        ['user', 'one more thing'],
        ['agent', 'y'],
      ]),
    );
    const replay = playOnImitation(config, original);
    expect(replay.turns).toHaveLength(1);
    expect(replay.ended).toBe(true);
    const { comparison, sourceLabel } = replayInBrowser(config, original);
    expect(comparison.lines.some((l) => /not reached/.test(l))).toBe(true);
    expect(comparison.turns[1].reached).toBe(false);
    expect(sourceLabel).toBe(SIMULATION_LABEL);
    expect(SIMULATION_LABEL).toBe('This replay is a simulation.');
  });
});
