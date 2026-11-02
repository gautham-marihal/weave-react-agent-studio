import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { unknownKeys } from '../test/schemaKeys';
import { oldToolsOf, repairOldTools } from './setup';

// The tools of a real draft saved by an earlier studio (bot "test", revision 3), which POST /validate refused with 4 errors.
const old = (): AgentConfig =>
  ({
    agents: {
      entry: 'assistant',
      items: [{ id: 'assistant', name: 'Test', kind: 'standalone', instructions: { role: 'Help callers.' }, tools: ['lookup_account', 'check_outages', 'transfer_to_human', 'end_call'] }],
    },
    tools: [
      { id: 'lookup_account', type: 'http', description: 'Find the caller’s account and latest bill', connection: 'crm' },
      { id: 'check_outages', type: 'http', description: 'Check for outages at a postcode', connection: 'crm' },
      { id: 'transfer_to_human', type: 'transfer', description: 'Transfer the call to the care team queue' },
      { id: 'end_call', type: 'end_call', description: 'End the conversation politely' },
    ],
  }) as unknown as AgentConfig;

describe('oldToolsOf', () => {
  it('lists each old tool with what the repair does', () => {
    expect(oldToolsOf(old()).map((o) => [o.id, o.fix])).toEqual([
      ['lookup_account', 'remove'],
      ['check_outages', 'remove'],
      ['transfer_to_human', 'hand_over'],
      ['end_call', 'end_call'],
    ]);
  });

  it('finds nothing in a draft whose tools the server accepts', () => {
    expect(oldToolsOf(repairOldTools(old()))).toEqual([]);
  });

  it('leaves a lookup with no request alone when a test still names it', () => {
    const config = { ...old(), tests: { scenarios: [{ id: 's', expect: [{ tool_called: 'lookup_account' }] }] } } as unknown as AgentConfig;
    expect(oldToolsOf(config).find((o) => o.id === 'lookup_account')?.fix).toBe('manual');
    expect((repairOldTools(config).tools as { id: string }[]).map((t) => t.id)).toContain('lookup_account');
  });
});

describe('repairOldTools', () => {
  const fixed = repairOldTools(old()) as unknown as Record<string, any>;

  it('rewrites end_call and transfer as built-ins under the same ids', () => {
    expect(fixed.tools).toEqual([
      expect.objectContaining({ id: 'transfer_to_human', type: 'builtin', builtin: 'transfer_or_callback', params: expect.objectContaining({ transfer: 'human_support' }) }),
      expect.objectContaining({ id: 'end_call', type: 'builtin', builtin: 'end_call', params: { say: { message: 'goodbye' } } }),
    ]);
    expect(fixed.telephony.transfers).toEqual([expect.objectContaining({ id: 'human_support', method: 'sip_refer', target: '' })]);
    expect(fixed.messages.map((m: { id: string }) => m.id)).toEqual(['callback_line', 'goodbye']);
  });

  it('takes the lookups with no address off the tools and the agent', () => {
    expect(fixed.agents.items[0].tools).toEqual(['transfer_to_human', 'end_call']);
  });

  it('writes only keys the schema knows, and changes nothing the second time', () => {
    expect(unknownKeys(fixed as AgentConfig)).toEqual([]);
    expect(repairOldTools(fixed as AgentConfig)).toBe(fixed);
  });
});
