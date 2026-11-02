import { describe, expect, it } from 'vitest';
import { fixMojibake, humanize, localDay, newestFirst, periodOf, readCall, similarity } from './callData';

describe('a call’s records read as facts', () => {
  it('reads the turns, answers, tools, hand-overs, errors and how it ended', () => {
    const facts = readCall([
      { seq: 1, elapsed_s: 0, event: 'call_started', channel: { id: 'web-chat', type: 'web_chat' } },
      { seq: 2, elapsed_s: 0.1, event: 'agent_entered', agent: 'front', first: true },
      { seq: 3, elapsed_s: 0.2, event: 'agent_said', text: 'Hello!' },
      { seq: 4, elapsed_s: 2, event: 'user_said', text: 'Where is my order?' },
      { seq: 5, elapsed_s: 2.5, event: 'tool_called', tool: 'find_order', args: { id: 1 }, error: 'HTTP 503' },
      { seq: 6, elapsed_s: 3.2, event: 'agent_said', text: 'Sorry, I can’t check that now.' },
      { seq: 7, elapsed_s: 4, event: 'user_said', text: 'A person, please.' },
      { seq: 8, elapsed_s: 4.2, event: 'tool_called', tool: 'transfer' },
      { seq: 9, elapsed_s: 4.3, event: 'agent_entered', agent: 'people', first: false },
      { seq: 10, elapsed_s: 5, event: 'error', message: 'The model timed out' },
      { seq: 11, elapsed_s: 6, event: 'call_ended', state: { done: true } },
    ]);
    expect(facts.channelId).toBe('web-chat');
    expect(facts.opening).toEqual(['Hello!']);
    expect(facts.turns.map((t) => t.say)).toEqual(['Where is my order?', 'A person, please.']);
    expect(facts.turns[0].waitMs).toBe(1200);
    expect(facts.turns[0].tools[0].error).toBe('HTTP 503');
    expect(facts.handoffs).toBe(1);
    expect(facts.finalAgent).toBe('people');
    expect(facts.errors).toEqual(['The tool “find_order” failed: HTTP 503', 'The model timed out']);
    expect(facts.ended).toBe(true);
    expect(facts.finalState).toEqual({ done: true });
  });

  it('reads records in their order, and anything that is not a list as no records', () => {
    const facts = readCall([
      { seq: 2, elapsed_s: 1.5, event: 'agent_said', text: 'Hi there.' },
      { seq: 1, elapsed_s: 1, event: 'user_said', text: 'Hi' },
    ]);
    expect(facts.turns[0].waitMs).toBe(500);
    expect(readCall(null).turns).toEqual([]);
  });

  it('repairs text read back in the wrong encoding, and leaves correct text alone', () => {
    expect(fixMojibake('Iâ€™m here')).toBe('I’m here');
    expect(fixMojibake('I’m here')).toBe('I’m here');
    expect(fixMojibake('Café')).toBe('Café');
  });

  it('names, word overlap, days and the newest first', () => {
    expect(humanize('escalate_to_human')).toBe('Escalate to human');
    expect(humanize('lookupOrder')).toBe('Lookup order');
    expect(similarity('where is my order', 'where is my order')).toBe(1);
    expect(similarity('', 'x')).toBe(0);
    expect(localDay(new Date(2026, 9, 25, 23, 30).getTime())).toBe('2026-10-25');
    const p = periodOf(new Date(2026, 9, 25, 10).getTime(), 3);
    expect(p.days).toEqual(['2026-10-23', '2026-10-24', '2026-10-25']);
    expect(p.startMs).toBe(new Date(2026, 9, 23).getTime());
    expect(newestFirst([{ started_at: '2026-01-01T00:00:00Z' }, { started_at: '2026-02-01T00:00:00Z' }])[0].started_at).toBe('2026-02-01T00:00:00Z');
  });
});
