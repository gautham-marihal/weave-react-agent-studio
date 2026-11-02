import { describe, expect, it } from 'vitest';
import { describePath } from './validate';

const config = { channels: [{ id: 'web', type: 'web_chat' as const, enabled: true }], agents: { entry: 'a', items: [{ id: 'a', name: 'Front desk' }] } };

describe('a problem the server found, named by its plain label', () => {
  it('a setting in the catalogue by its label', () => {
    expect(describePath(['persona', 'disclosures', 'recording_notice'], config)).toBe('What callers hear about recording');
    expect(describePath(['defaults', 'conversation', 'turn_handling', 'interruption', 'enabled'], config)).toBe('Let callers interrupt');
  });

  it('a guardrails or after-the-call place by its name on those pages, list positions ignored', () => {
    expect(describePath(['guardrails', 'limits', 'max_call_duration_s'], config)).toBe('Guardrails › Longest call');
    expect(describePath(['guardrails', 'escalation', 2, 'when'], config)).toBe('Guardrails › A hand-over or ending rule');
    expect(describePath(['post_call', 'analysis', 0, 'values'], config)).toBe('After the call › Questions about each call');
    expect(describePath(['defaults', 'models', 'tts'], config)).toBe('Voice');
  });

  it('channels and agents by their own names', () => {
    expect(describePath(['channels', 0, 'greeting'], config)).toBe('Web chat › Greeting');
    expect(describePath(['agents', 'items', 0, 'instructions'], config)).toBe('Front desk › Instructions');
  });
});
