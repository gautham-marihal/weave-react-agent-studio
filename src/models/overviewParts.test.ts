import { describe, expect, it } from 'vitest';
import { buildParts } from './overviewParts';
import type { AgentConfig } from '../types/studio';

const ready: AgentConfig = {
  defaults: { language: { primary: 'en-GB' }, models: { tts: { provider: 'cartesia', model: 'sonic', voice_id: 'v1' } } },
  channels: [
    { id: 'web-chat', type: 'web_chat', enabled: true, greeting: { say: 'Hello, how can I help?' } },
    { id: 'phone', type: 'sip_voice', enabled: true },
  ],
  agents: { entry: 'front', items: [{ id: 'front', instructions: { role: 'Help callers with their orders, deliveries and returns, kindly.' } }] },
  tools: [{ id: 'end_call', type: 'builtin', builtin: 'end_call' }],
} as AgentConfig;

describe('the build parts on an agent’s Overview', () => {
  it('lists every part in Build’s order, with what is in it', () => {
    const parts = buildParts(ready);
    expect(parts.map((p) => p.id)).toEqual(['agent', 'channels', 'tools', 'knowledge', 'guardrails', 'aftercall']);
    expect(parts[0]).toMatchObject({ state: 'done' });
    expect(parts[0].status).toMatch(/^Says “Hello, how can I help\?” · .* · voice chosen$/);
    expect(parts[1]).toMatchObject({ state: 'done', status: 'Chat on your website and phone calls.' });
    expect(parts[2]).toMatchObject({ state: 'done', status: '1 tool.' });
    expect(parts[3].state).toBe('optional');
    expect(parts[5].state).toBe('optional');
  });

  it('says what an unfinished part still needs, and marks a part the checks found problems in', () => {
    const bare = buildParts({ channels: [] } as AgentConfig);
    expect(bare[0]).toMatchObject({ state: 'todo', status: 'Still to choose: what it should do, what it says first and its language.' });
    expect(bare[1]).toMatchObject({ state: 'attention', status: 'No way to reach it is switched on.' });
    const checked = buildParts(ready, [{ path: ['tools', 0, 'id'] }, { path: ['tools', 1] }]);
    expect(checked[2]).toMatchObject({ state: 'attention', status: '2 problems to fix · 1 tool.' });
    expect(buildParts(null)).toEqual([]);
  });
});
