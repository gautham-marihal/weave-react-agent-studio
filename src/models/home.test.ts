import { describe, expect, it } from 'vitest';
import type { CallSummaryItem } from '../api/types';
import { focusAgent, greetingFor, isTestConversation, minutesText, testConversationStats, workspaceLine } from './home';

const NOW = Date.parse('2026-10-30T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const call = (over: Partial<CallSummaryItem>): CallSummaryItem => ({
  id: 'c',
  room: 'r',
  channel: 'web_chat',
  caller: 'x',
  started_at: daysAgo(1),
  status: 'ended',
  duration_s: 60,
  version: 'draft',
  ref: 'draft',
  caller_turns: 3,
  ...over,
});

describe('Home', () => {
  it('greets by the time of day', () => {
    expect(greetingFor(6)).toBe('Good morning');
    expect(greetingFor(11)).toBe('Good morning');
    expect(greetingFor(12)).toBe('Good afternoon');
    expect(greetingFor(17)).toBe('Good afternoon');
    expect(greetingFor(18)).toBe('Good evening');
  });

  it('says how many agents there are and how many are published', () => {
    expect(workspaceLine({ agents: 0, published: 0 })).toBe('Your workspace is ready. Start by creating an agent.');
    expect(workspaceLine({ agents: 1, published: 0 })).toBe('1 agent, 0 published.');
    expect(workspaceLine({ agents: 3, published: 2, workspaceName: 'Harbour' })).toBe('3 agents in Harbour, 2 published.');
  });

  it('picks the agent for "Next step": chosen, then opened last, then saved last', () => {
    const agents = [
      { id: 'a', savedAt: '2026-10-01T00:00:00Z' },
      { id: 'b', savedAt: '2026-10-20T00:00:00Z' },
      { id: 'c', savedAt: '2026-10-10T00:00:00Z' },
    ];
    expect(focusAgent(agents, 'c', 'a')?.id).toBe('c');
    expect(focusAgent(agents, '', 'a')?.id).toBe('a');
    expect(focusAgent(agents, 'gone', 'gone too')?.id).toBe('b');
    expect(focusAgent([], '', '')).toBeUndefined();
  });

  it('counts only the draft’s conversations, in the time asked', () => {
    expect(isTestConversation({ ref: 'draft' })).toBe(true);
    expect(isTestConversation({ ref: undefined })).toBe(true);
    expect(isTestConversation({ ref: 'production' })).toBe(false);
    expect(isTestConversation({ ref: '1.0.0' })).toBe(false);
    const calls = [
      call({ duration_s: 60, caller_turns: 2 }),
      call({ duration_s: 120, caller_turns: 4, started_at: daysAgo(5) }),
      call({ duration_s: 600, caller_turns: 9, started_at: daysAgo(20) }),
      call({ ref: 'production', duration_s: 999, caller_turns: 99 }),
      call({ started_at: daysAgo(40) }),
    ];
    expect(testConversationStats(calls, 7, NOW)).toEqual({ count: 2, avgSec: 90, minutes: 3, messages: 6 });
    expect(testConversationStats(calls, 30, NOW)).toEqual({ count: 3, avgSec: 260, minutes: 13, messages: 15 });
    expect(testConversationStats([], 7, NOW)).toEqual({ count: 0, avgSec: 0, minutes: 0, messages: 0 });
  });

  it('writes minutes short', () => {
    expect(minutesText(0)).toBe('0');
    expect(minutesText(0.5)).toBe('0.5');
    expect(minutesText(3)).toBe('3');
    expect(minutesText(12.6)).toBe('13');
  });
});
