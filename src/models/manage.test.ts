import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { ApiError } from '../api/client';
import { agentNameProblem, configToText, exportFileName, partitionAgents, renameErrorWords, renamedConfig } from './manage';

// What the server creates for a new agent: a web chat and one assistant, nothing else.
const starter: AgentConfig = {
  schema_version: '1.1',
  meta: { id: 'x', name: 'X', version: '0.1.0', status: 'draft' },
  defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini' } } },
  persona: { name: 'X' },
  channels: [{ id: 'web-chat', type: 'web_chat', enabled: true, greeting: { say: 'Hello!' } }],
  agents: { entry: 'assistant', items: [{ id: 'assistant', name: 'X', kind: 'standalone', instructions: { role: 'Help.' }, tools: [] }] },
};

describe('rename and export', () => {
  it('a rename changes only the display name, and says what is wrong with a name', () => {
    const renamed = renamedConfig(starter, '  Acme Care ');
    expect(renamed.meta).toEqual({ ...starter.meta, name: 'Acme Care' });
    expect(renamed.agents).toBe(starter.agents);
    expect(agentNameProblem(' ')).toMatch(/Give the agent a name/);
    expect(agentNameProblem('x'.repeat(81))).toMatch(/80 characters/);
    expect(agentNameProblem('Fine')).toBe('');
  });

  it('a 409 is said plainly: someone saved in between, nothing was overwritten', () => {
    const conflict = renameErrorWords(new ApiError({ status: 409, kind: 'conflict', message: 'base_revision 3 is stale' }));
    expect(conflict.title).toBe('The draft changed while you were renaming');
    expect(conflict.text).toMatch(/Someone saved it a moment ago/);
    expect(conflict.text).not.toMatch(/revision|409/);
    expect(renameErrorWords(new Error('offline')).text).toBe('offline');
  });

  it('exported files are named safely and are readable JSON', () => {
    expect(exportFileName('ui-dev-sandbox', 'draft')).toBe('ui-dev-sandbox-draft.json');
    expect(exportFileName('a', '0.2.0')).toBe('a-0.2.0.json');
    expect(exportFileName('a', 'my draft/v2?')).toBe('a-my-draft-v2-.json');
    const text = configToText(starter);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(starter);
  });

  it('the list is split into shown, removed, and deleted from the removed list', () => {
    const agents = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(partitionAgents(agents, ['b', 'c'], ['c'])).toEqual({ visible: [{ id: 'a' }], removed: [{ id: 'b' }], dismissedIds: ['c'] });
    expect(partitionAgents(agents, [], ['a']).visible).toHaveLength(3);
  });
});
