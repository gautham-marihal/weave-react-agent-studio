import { describe, expect, it } from 'vitest';
import type { AgentConfig, AgentRole } from '../types/studio';
import { KNOWLEDGE_ID, addKnowledgeFile, addKnowledgePage, cleanUrl, knowledgeOf, removeKnowledge } from './setup';
import { attachBase, readersInWords, readersOf } from './knowledge';

// What the agent's knowledge controls may and may not do to the rest of the draft: the simple "What it knows" list,
// and "Let <agent> use it" for a base nothing reads. Each case left the draft invalid, or changed something the person
// had set, in the app this was ported from.

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const care = (): AgentConfig => ({
  schema_version: '1.2',
  meta: { id: 'care', name: 'Care', version: '0.1.0' },
  persona: { name: 'Care' },
  channels: [{ id: 'web_chat', type: 'web_chat', enabled: true, greeting: { say: 'Hi! How can I help you today?' } }],
  tools: [{ id: 'end_call', type: 'builtin', builtin: 'end_call', description: 'Ends the conversation.' }],
  agents: { entry: 'assistant', items: [{ id: 'assistant', name: '', instructions: { role: 'You help the customers of Care.' }, tools: ['end_call'] } as AgentRole] },
});
const agentsOf = (config: AgentConfig): AgentRole[] => config.agents?.items ?? [];
const toolsOf = (config: AgentConfig) => config.tools ?? [];
const agentById = (config: AgentConfig, id: string) => agentsOf(config).find((a) => a.id === id);
// a second agent, billing, next to the one that answers
const withBilling = (config: AgentConfig, knowledge?: string[]) => {
  const next = clone(config);
  const billing: AgentRole = { ...clone(agentsOf(next)[0]), id: 'billing', name: 'Billing', tools: [] };
  if (knowledge) billing.knowledge = knowledge;
  else delete billing.knowledge;
  agentsOf(next).push(billing);
  return next;
};

describe('what it knows', () => {
  it('keeps the last document while another agent reads the base, and says why', () => {
    const config = withBilling(addKnowledgeFile(care(), 'faq.txt'), [KNOWLEDGE_ID]);
    const result = removeKnowledge(config, 'file', 'faq.txt');
    expect(result.config).toBe(config);
    expect(result.refused).toMatch(/^billing answers from these, so the last one can’t be removed/);
    // with another one added first, the old one goes, and billing keeps reading the base
    const after = removeKnowledge(addKnowledgePage(config, 'https://care.example/help'), 'file', 'faq.txt');
    expect(after.refused).toBe('');
    expect(knowledgeOf(after.config).files).toEqual([]);
    expect(agentById(after.config, 'billing')?.knowledge).toEqual([KNOWLEDGE_ID]);
  });

  it('keeps the last page while a knowledge tool searches the base', () => {
    const config = addKnowledgePage(care(), 'https://care.example/a');
    config.knowledge[0].mode = 'tool';
    delete agentsOf(config)[0].knowledge;
    config.tools = [...(config.tools ?? []), { id: 'search_docs', type: 'knowledge', source: KNOWLEDGE_ID, description: 'Search the docs' }];
    const result = removeKnowledge(config, 'url', 'https://care.example/a');
    expect(result.config).toBe(config);
    expect(result.refused).toMatch(/^The search_docs tool searches these/);
  });

  it('takes the base and the agent’s use of it away with the last document when only the answering agent reads it', () => {
    const result = removeKnowledge(addKnowledgeFile(care(), 'faq.txt'), 'file', 'faq.txt');
    expect(result.refused).toBe('');
    expect(result.config.knowledge).toBeUndefined();
    expect(result.config.agents?.items?.[0].knowledge).toBeUndefined();
  });

  it('keeps the last document of a base with its own search settings, so the settings are not lost by swapping documents', () => {
    const config = addKnowledgePage(care(), 'https://care.example/a');
    Object.assign(config.knowledge[0], { top_k: 8, retrieval: { min_score: 0.4 }, chunking: { size: 600, overlap: 50 }, refresh: 'weekly' });
    const result = removeKnowledge(config, 'url', 'https://care.example/a');
    expect(result.config).toBe(config);
    expect(result.refused).toMatch(/own search settings/);
    // the way to swap: add the new one, then take the old one out
    const swapped = removeKnowledge(addKnowledgePage(config, 'https://care.example/new'), 'url', 'https://care.example/a').config;
    const base = swapped.knowledge.find((b: { id: string }) => b.id === KNOWLEDGE_ID);
    expect(knowledgeOf(swapped).pages).toEqual(['https://care.example/new']);
    expect(base.top_k).toBe(8);
    expect(base.refresh).toBe('weekly');
  });

  it('leaves a base of another kind under the same id (your own search service) as it is', () => {
    const config = care();
    config.connections = { search: { type: 'http', base_url: 'https://search.example' } };
    config.knowledge = [{ id: KNOWLEDGE_ID, type: 'rag_api', mode: 'inject', connection: 'search', request: { method: 'POST', path: '/search' } }];
    agentsOf(config)[0].knowledge = [KNOWLEDGE_ID];
    expect(knowledgeOf(config).pages).toEqual([]);
    expect(addKnowledgePage(config, 'https://care.example/a')).toBe(config);
    expect(addKnowledgeFile(config, 'faq.txt')).toBe(config);
    expect(removeKnowledge(config, 'file', 'faq.txt').config).toBe(config);
  });

  it('with several agents, does not give a base another agent reads to the agent that answers too', () => {
    const config = withBilling(care(), [KNOWLEDGE_ID]);
    config.knowledge = [{ id: KNOWLEDGE_ID, type: 'vector_store', mode: 'inject', sources: [{ type: 'url', url: 'https://care.example/billing' }] }];
    const next = addKnowledgePage(config, 'https://care.example/refunds');
    expect(next.agents?.items?.[0].knowledge).toBeUndefined();
    expect(agentById(next, 'billing')?.knowledge).toEqual([KNOWLEDGE_ID]);
    // a base no agent reads yet goes to the agent that answers
    const fresh = addKnowledgePage(withBilling(care()), 'https://care.example/a');
    expect(fresh.agents?.items?.[0].knowledge).toEqual([KNOWLEDGE_ID]);
    expect(agentById(fresh, 'billing')?.knowledge).toBeUndefined();
  });

  it('lists a page once however it is typed, and a document listed twice once', () => {
    const config = addKnowledgePage(care(), 'https://care.example', { linked: true });
    config.knowledge[0].sources.push({ type: 'url', url: 'https://care.example/a' }, { type: 'url', url: 'https://care.example/a' });
    expect(knowledgeOf(config).pages).toEqual(['https://care.example', 'https://care.example/a']);
    // typed again as "care.example" (made whole as https://care.example/): the page takes the new choice, once
    const again = addKnowledgePage(config, cleanUrl('care.example'));
    expect(knowledgeOf(again).pages).toEqual(['https://care.example/a', 'https://care.example/']);
    expect(knowledgeOf(again).depths['https://care.example/']).toBe(0);
    // removing a page takes every copy of it
    const removed = removeKnowledge(again, 'url', 'https://care.example/a').config;
    expect(knowledgeOf(removed).pages).toEqual(['https://care.example/']);
    const twice = clone(removed);
    twice.knowledge[0].sources.push({ type: 'file', file_id: 'faq.txt' }, { type: 'file', file_id: 'faq.txt' });
    expect(knowledgeOf(twice).files).toEqual(['faq.txt']);
  });

  it('refuses a typed web address with a broken name', () => {
    for (const junk of ['https://.com', 'https://example..com', 'https://-.com', 'example-.com', '1.2', 'https://1.2.3', 'example.123']) expect(cleanUrl(junk), junk).toBe('');
    expect(cleanUrl('my-site.co.uk/help')).toBe('https://my-site.co.uk/help');
    expect(cleanUrl('bücher.de')).toBe('https://xn--bcher-kva.de/');
    expect(cleanUrl('smile.example/help')).toBe('https://smile.example/help');
  });
});

describe('who reads a base, and letting the agent use it', () => {
  const bases = () => {
    const config = care();
    config.knowledge = [
      { id: 'help_centre', type: 'vector_store', mode: 'inject', sources: [{ type: 'url', url: 'https://care.example' }] },
      { id: 'clinic_policies', type: 'vector_store', mode: 'tool', sources: [{ type: 'file', file_id: 'p.md' }] },
    ];
    return config;
  };

  it('says who reads a base, in words', () => {
    const config = bases();
    expect(readersOf(config, 'help_centre')).toEqual({ agents: [], tools: [] });
    expect(readersInWords(config, 'help_centre')).toBe('');
    toolsOf(config).push({ id: 'search_policies', type: 'knowledge', source: 'clinic_policies' });
    expect(readersInWords(config, 'clinic_policies')).toBe('Looked up with the “Search policies” tool (no agent has it yet).');
    expect(readersOf(config, 'clinic_policies')).toEqual({ agents: [], tools: ['search_policies'] });
  });

  it('puts a base read on every turn in the agent’s knowledge, and gives a looked-up one a tool (reused when one exists)', () => {
    const config = bases();
    const inject = attachBase(config, 'help_centre');
    expect(inject.agents?.items?.[0].knowledge).toEqual(['help_centre']);
    expect(attachBase(inject, 'help_centre')).toBe(inject); // once
    expect(readersInWords(inject, 'help_centre')).toBe('Read by Care in every conversation.');

    const tool = attachBase(config, 'clinic_policies');
    const made = toolsOf(tool).find((t) => t.type === 'knowledge');
    expect({ id: made?.id, source: made?.source }).toEqual({ id: 'search_clinic_policies', source: 'clinic_policies' });
    expect(tool.agents?.items?.[0].tools).toContain('search_clinic_policies');
    expect(attachBase(tool, 'clinic_policies')).toBe(tool); // once
    expect(readersOf(tool, 'clinic_policies')).toEqual({ agents: ['assistant'], tools: ['search_clinic_policies'] });

    // a tool that already searches it is given to the agent, not made twice
    const having = clone(config);
    toolsOf(having).push({ id: 'policies', type: 'knowledge', source: 'clinic_policies' });
    const reused = attachBase(having, 'clinic_policies');
    expect(toolsOf(reused).filter((t) => t.type === 'knowledge')).toHaveLength(1);
    expect(reused.agents?.items?.[0].tools).toContain('policies');
    // nothing to attach to
    expect(attachBase(config, 'nope')).toBe(config);
    expect(config.agents?.items?.[0].knowledge).toBeUndefined(); // the original is not changed
  });
});
