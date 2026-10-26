import test from 'node:test';
import assert from 'node:assert/strict';
import { minimalConfig } from '../src/demo/minimalConfig.js';
import { applyStarter } from '../src/studio/starters.ts';
import { KNOWLEDGE_ID, addKnowledgeFile, addKnowledgePage, cleanUrl, knowledgeOf, removeKnowledge, whoReadsKnowledge } from '../src/studio/setup/setupModel.js';

// The Knowledge page's simple "What it knows" (and the setup's step of the same name): what it may and may not do to the rest of the configuration.
// Each case here left the configuration invalid, or changed something the person had set, before it was fixed.

const clone = (v) => JSON.parse(JSON.stringify(v));
const care = () => applyStarter(minimalConfig('care', 'Care'), 'support');
const agentById = (config, id) => config.agents.items.find((a) => a.id === id);
// a second agent, Billing, next to the one that answers
const withBilling = (config, knowledge) => {
  const next = clone(config);
  next.agents.items.push({ ...clone(next.agents.items[0]), id: 'billing', name: 'Billing', tools: [], ...(knowledge ? { knowledge } : {}) });
  if (!knowledge) delete next.agents.items[next.agents.items.length - 1].knowledge;
  return next;
};

test('knowledge: the last document stays while another agent reads the base, and says why', () => {
  const config = withBilling(addKnowledgeFile(care(), 'faq.txt'), [KNOWLEDGE_ID]);
  const result = removeKnowledge(config, 'file', 'faq.txt');
  assert.equal(result.config, config, 'nothing changes');
  assert.match(result.refused, /^Billing answers from these, so the last one can’t be removed/);
  // with another one added first, the old one goes, and Billing keeps reading the base
  const more = addKnowledgePage(config, 'https://care.example/help');
  const after = removeKnowledge(more, 'file', 'faq.txt');
  assert.equal(after.refused, '');
  assert.deepEqual(knowledgeOf(after.config).files, []);
  assert.deepEqual(agentById(after.config, 'billing').knowledge, [KNOWLEDGE_ID]);
});

test('knowledge: the last page stays while a knowledge tool searches the base', () => {
  const config = addKnowledgePage(care(), 'https://care.example/a');
  config.knowledge[0].mode = 'tool';
  delete config.agents.items[0].knowledge;
  config.tools = [...config.tools, { id: 'search_docs', type: 'knowledge', source: KNOWLEDGE_ID, description: 'Search the docs' }];
  const result = removeKnowledge(config, 'url', 'https://care.example/a');
  assert.equal(result.config, config);
  assert.match(result.refused, /^The Search docs tool searches these/);
});

test('knowledge: with only the answering agent reading it, the last one goes, with the base and the agent’s use of it', () => {
  const config = addKnowledgeFile(care(), 'faq.txt');
  const result = removeKnowledge(config, 'file', 'faq.txt');
  assert.equal(result.refused, '');
  assert.equal(result.config.knowledge, undefined);
  assert.equal(result.config.agents.items[0].knowledge, undefined);
});

test('knowledge: a base with its own search settings keeps its last document, so the settings are not lost by swapping the documents', () => {
  const config = addKnowledgePage(care(), 'https://care.example/a');
  Object.assign(config.knowledge[0], { top_k: 8, retrieval: { min_score: 0.4 }, chunking: { size: 600, overlap: 50 }, refresh: 'weekly' });
  const result = removeKnowledge(config, 'url', 'https://care.example/a');
  assert.equal(result.config, config);
  assert.match(result.refused, /own search settings/);
  // the way to swap: add the new one, then take the old one out
  const swapped = removeKnowledge(addKnowledgePage(config, 'https://care.example/new'), 'url', 'https://care.example/a').config;
  const base = swapped.knowledge.find((b) => b.id === KNOWLEDGE_ID);
  assert.deepEqual(knowledgeOf(swapped).pages, ['https://care.example/new']);
  assert.equal(base.top_k, 8);
  assert.equal(base.refresh, 'weekly');
});

test('knowledge: a base of another kind under the same id (your own search service) is left as it is', () => {
  const config = care();
  config.connections = { ...(config.connections || {}), search: { type: 'http', base_url: 'https://search.example' } };
  config.knowledge = [{ id: KNOWLEDGE_ID, type: 'rag_api', mode: 'inject', connection: 'search', request: { method: 'POST', path: '/search' } }];
  config.agents.items[0].knowledge = [KNOWLEDGE_ID];
  assert.deepEqual(knowledgeOf(config).pages, []);
  assert.equal(addKnowledgePage(config, 'https://care.example/a'), config, 'no sources are written onto it');
  assert.equal(addKnowledgeFile(config, 'faq.txt'), config);
  assert.equal(removeKnowledge(config, 'file', 'faq.txt').config, config);
});

test('knowledge: with several agents, adding to a base another agent reads does not give it to the agent that answers too', () => {
  const config = withBilling(care(), [KNOWLEDGE_ID]);
  config.knowledge = [{ id: KNOWLEDGE_ID, type: 'vector_store', mode: 'inject', sources: [{ type: 'url', url: 'https://care.example/billing' }] }];
  assert.equal(whoReadsKnowledge(config), 'Billing reads them in every conversation.');
  const next = addKnowledgePage(config, 'https://care.example/refunds');
  assert.equal(next.agents.items[0].knowledge, undefined, 'the agent that answers is unchanged');
  assert.deepEqual(agentById(next, 'billing').knowledge, [KNOWLEDGE_ID]);
  // a base no agent reads yet goes to the agent that answers, as in the setup
  const fresh = addKnowledgePage(withBilling(care()), 'https://care.example/a');
  assert.deepEqual(fresh.agents.items[0].knowledge, [KNOWLEDGE_ID]);
  assert.equal(agentById(fresh, 'billing').knowledge, undefined);
  assert.equal(whoReadsKnowledge(fresh), 'The agent that answers reads them in every conversation.');
  assert.equal(whoReadsKnowledge(care()), 'The agent that answers reads them in every conversation.', 'before there are any');
  const both = clone(next);
  both.agents.items[0].knowledge = [KNOWLEDGE_ID];
  assert.equal(whoReadsKnowledge(both), 'The agent that answers and Billing read them in every conversation.');
});

test('knowledge: a page is the same page however it is typed, and is listed once', () => {
  const config = addKnowledgePage(care(), 'https://care.example', { linked: true });
  config.knowledge[0].sources.push({ type: 'url', url: 'https://care.example/a' }, { type: 'url', url: 'https://care.example/a' });
  assert.deepEqual(knowledgeOf(config).pages, ['https://care.example', 'https://care.example/a'], 'each page once (the list is keyed by it)');
  // typed again as "care.example" (made whole as https://care.example/): the page takes the new choice, once
  const again = addKnowledgePage(config, cleanUrl('care.example'));
  assert.deepEqual(knowledgeOf(again).pages, ['https://care.example/a', 'https://care.example/']);
  assert.equal(knowledgeOf(again).depths['https://care.example/'], 0);
  // removing a page takes every copy of it
  const removed = removeKnowledge(again, 'url', 'https://care.example/a').config;
  assert.deepEqual(knowledgeOf(removed).pages, ['https://care.example/']);
  // a document listed twice is listed once
  const twice = clone(removed);
  twice.knowledge[0].sources.push({ type: 'file', file_id: 'faq.txt' }, { type: 'file', file_id: 'faq.txt' });
  assert.deepEqual(knowledgeOf(twice).files, ['faq.txt']);
});

test('knowledge: a typed web address with a broken name is refused; a numeric one only when typed in full', () => {
  for (const junk of ['https://.com', 'https://example..com', 'https://-.com', 'example-.com', '1.2', 'https://1.2.3', 'example.123'])
    assert.equal(cleanUrl(junk), '', junk);
  assert.equal(cleanUrl('10.0.0.5/docs'), 'https://10.0.0.5/docs');
  assert.equal(cleanUrl('my-site.co.uk/help'), 'https://my-site.co.uk/help');
  assert.equal(cleanUrl('bücher.de'), 'https://xn--bcher-kva.de/');
  assert.equal(cleanUrl('smile.example/help'), 'https://smile.example/help');
});
