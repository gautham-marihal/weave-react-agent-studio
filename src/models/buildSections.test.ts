import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { addKnowledgeFile, setDetails, setHandOver, setReach } from './setup';
import { GUIDED_ORDER, buildSections } from './buildSections';

const byId = (config: AgentConfig, extra: Partial<Parameters<typeof buildSections>[0]> = {}) => Object.fromEntries(buildSections({ config, ...extra }).map((r) => [r.id, r]));

// The minimal draft POST /bots makes.
const fresh = (): AgentConfig => ({
  schema_version: '1.2',
  meta: { id: 'fresh', name: 'Fresh', version: '0.1.0', status: 'draft' },
  defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini' } } },
  persona: { name: 'Fresh' },
  channels: [{ id: 'web-chat', type: 'web_chat', enabled: true, greeting: { say: 'Hello! How can I help you today?' } }],
  agents: { entry: 'assistant', items: [{ id: 'assistant', name: 'Fresh', instructions: { role: '' }, tools: [] }] },
});

describe('the parts of Build on one page', () => {
  it('a fresh draft: the agent still to write, the optional parts said to be optional, one way to reach it', () => {
    const rows = buildSections({ config: fresh() });
    expect(rows.map((r) => r.id)).toEqual(GUIDED_ORDER);
    const s = byId(fresh());
    expect(s.agent.state).toBe('todo');
    expect(s.agent.status).toMatch(/^Still to choose: what it should do and its language\.$/);
    for (const id of ['knowledge', 'tools', 'guardrails', 'aftercall']) expect(s[id].state).toBe('optional');
    expect(s.workflow.status).toBe('One agent answers every conversation.');
    expect(s.channels.state).toBe('done');
    expect(rows.every((r) => r.purpose)).toBe(true);
  });

  it('a dental receptionist: what it says, what it can do, its documents and where it is reached', () => {
    let config: AgentConfig = {
      ...fresh(),
      defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini' } }, language: { primary: 'en-US', speaks: ['en', 'zh'] } },
      channels: [{ id: 'web-chat', type: 'web_chat', enabled: true, greeting: { say: 'Hello, this is Smile Dental. How can I help?' } }],
      agents: { entry: 'assistant', items: [{ id: 'assistant', name: 'Smile', instructions: { role: 'You book, move and cancel appointments for Smile Dental patients.' }, tools: [] }] },
    };
    config = setHandOver(config, true, { number: '+6561234567' });
    config = setDetails(config, true, { fields: ['name', 'phone'] });
    config = setReach(config, 'sip_voice', true).config;
    config = addKnowledgeFile(config, 'prices.txt');
    config = { ...config, defaults: { ...config.defaults, models: { ...config.defaults?.models, tts: { provider: 'cartesia', voice_id: 'x' } } } };
    const s = byId(config);
    expect(s.agent.state).toBe('done');
    expect(s.agent.status).toMatch(/^Says “Hello, this is Smile Dental/);
    expect(s.agent.status).toMatch(/English and Chinese/);
    expect(s.agent.status).toMatch(/voice chosen$/);
    expect(s.tools.status).toBe('Passes people to your team (+6561234567) · takes contact details.');
    expect(s.knowledge.status).toBe('1 document.');
    expect(s.channels.status).toMatch(/Chat on your website and phone calls\./);
  });

  it('documents not read yet need attention; problems the checks found put a part first in line', () => {
    const config = addKnowledgeFile(fresh(), 'faq.md');
    const knowledge = byId(config, { knowledgeRead: [{ id: 'knowledge', index: null, build: null }] }).knowledge;
    expect(knowledge.state).toBe('attention');
    expect(knowledge.status).toBe('1 document · its documents are not read yet.');
    expect(byId(config, { knowledgeRead: [{ id: 'knowledge', index: { chunks: 3 }, build: null }] }).knowledge.status).toMatch(/read and ready/);
    const withErrors = byId(fresh(), { errorsBySection: { channels: 2 } }).channels;
    expect(withErrors.state).toBe('attention');
    expect(withErrors.status).toMatch(/^2 problems to fix · /);
  });

  it('guardrails and after the call say what is set', () => {
    const config = fresh();
    config.guardrails = { topics: { allowed: ['appointments'], blocked: ['politics'] } };
    config.post_call = { summary: { enabled: true }, analysis: [{ id: 'solved', question: 'Was it solved?', type: 'boolean' }], recording: { retention_days: 30 } };
    const s = byId(config);
    expect(s.guardrails.status).toBe('Keeps to 1 topic · avoids 1 topic.');
    expect(s.aftercall.status).toBe('Writes a summary · answers 1 question · keeps recordings 30 days.');
  });
});
