import test from 'node:test';
import assert from 'node:assert/strict';
import { minimalConfig } from '../src/demo/minimalConfig.js';
import { applyStarter } from '../src/studio/starters.js';
import { matchWords, normalizeBase, normalizeKnowledge, readingState, sinceRead } from '../src/studio/knowledge/model.js';
import { KNOWLEDGE_ID, addKnowledgeFile, attachBase, readersInWords, readersOf } from '../src/studio/setup/setupModel.js';
import { readinessSteps } from '../src/studio/newlayout/readiness.js';
import { overview, settle, startBuild, upload } from '../src/demo/demoKnowledge.js';

// How far the agent's documents are from being something it answers from (the Knowledge page's status line and the menu's "Getting it ready"), and the
// page's "Let <agent> use it" for a base nothing reads.

const clone = (v) => JSON.parse(JSON.stringify(v));
const care = () => applyStarter(minimalConfig('care', 'Care'), 'support');
const saved = (raw) =>
  normalizeBase({
    id: KNOWLEDGE_ID,
    type: 'vector_store',
    mode: 'inject',
    used_by: { agents: [], tools: [] },
    sources: [{ type: 'file', file_id: 'faq.md', uploaded: true }],
    index: null,
    build: null,
    problems: [],
    ...raw,
  });
const draft = [{ type: 'file', file_id: 'faq.md' }];
const indexOf = (names) => ({ built_at: '2026-10-23T09:00:00Z', passages: 4, documents: names.map((name) => ({ name, passages: 2 })) });

test('reading: a draft that lists other documents than the saved one is not saved yet; no base on the server is the same', () => {
  assert.equal(readingState(null).state, 'unsaved');
  assert.equal(readingState(saved(), { draftSources: [...draft, { type: 'url', url: 'https://care.example/help' }] }).state, 'unsaved');
  // the same documents in another order, or one listed twice, are the same
  assert.equal(readingState(saved(), { draftSources: [draft[0], draft[0]] }).state, 'unread');
});

test('reading: saved and never read, being read, failed, ready', () => {
  assert.equal(readingState(saved(), { draftSources: draft }).state, 'unread');
  assert.equal(readingState(saved({ build: { status: 'running' } })).state, 'reading');
  assert.equal(readingState(saved({ build: { status: 'failed', error: 'No text.' } })).state, 'failed');
  // a build followed on the screen wins over the one the server last reported
  assert.equal(readingState(saved({ build: { status: 'failed' } }), { build: { status: 'running', log: [] } }).state, 'reading');
  assert.equal(readingState(saved({ index: indexOf(['faq.md']) })).state, 'ready');
});

test('reading: a file the server no longer has is named, before anything else is said about it', () => {
  const base = saved({ sources: [{ type: 'file', file_id: 'faq.md', uploaded: false }], index: indexOf(['faq.md']) });
  assert.deepEqual(readingState(base), { state: 'missing', names: ['faq.md'] });
});

test('reading: a file replaced, added or taken out since the index was read makes it "changed", with the files named', () => {
  const replaced = saved({
    index: indexOf(['faq.md']),
    problems: [{ problem: 'The file faq.md changed after the index was built.', fix: 'Rebuild the index.' }],
  });
  assert.deepEqual(readingState(replaced), { state: 'changed', names: ['faq.md'] });
  const added = saved({
    sources: [
      { type: 'file', file_id: 'faq.md', uploaded: true },
      { type: 'file', file_id: 'prices.md', uploaded: true },
    ],
    index: indexOf(['faq.md']),
  });
  assert.deepEqual(readingState(added).names, ['prices.md']);
  const removed = saved({ index: indexOf(['faq.md', 'old.md']) });
  assert.deepEqual(readingState(removed), { state: 'changed', names: ['old.md'] });
});

test('reading: documents the server names in its own way are not compared (no false "changed")', () => {
  const base = saved({ index: indexOf(['documents/0001', 'documents/0002']) });
  assert.deepEqual(sinceRead(base), { added: [], removed: [], changed: [], missing: [] });
  assert.equal(readingState(base).state, 'ready');
  // a web page's document is never called taken out
  const page = saved({
    sources: [
      { type: 'file', file_id: 'faq.md', uploaded: true },
      { type: 'url', url: 'https://care.example/help' },
    ],
    index: indexOf(['faq.md', 'https://care.example/help/contact']),
  });
  assert.equal(readingState(page).state, 'ready');
});

test('reading: the demo marks a replaced file as changed, and the page says so', () => {
  const config = addKnowledgeFile(care(), 'faq.md');
  const bot = { id: 'care' };
  upload(bot, 'faq.md', 'Refunds within 30 days.', 24, '2026-10-23T09:00:00.000Z');
  startBuild(bot, config, KNOWLEDGE_ID, 0, 0);
  settle(bot, 1);
  const read = () => normalizeKnowledge(overview(bot, config, 'draft', 2)).bases[0];
  assert.equal(readingState(read(), { draftSources: config.knowledge[0].sources }).state, 'ready');
  upload(bot, 'faq.md', 'Refunds within 14 days.', 24, '2026-10-23T10:00:00.000Z');
  assert.deepEqual(readingState(read(), { draftSources: config.knowledge[0].sources }), { state: 'changed', names: ['faq.md'] });
});

test('reading: the demo says plainly that it can’t fetch web pages', () => {
  const config = clone(care());
  config.knowledge = [{ id: KNOWLEDGE_ID, type: 'vector_store', mode: 'inject', sources: [{ type: 'url', url: 'https://care.example/help' }] }];
  const bot = { id: 'care' };
  startBuild(bot, config, KNOWLEDGE_ID, 0, 0);
  settle(bot, 1);
  const base = normalizeKnowledge(overview(bot, config, 'draft', 2)).bases[0];
  assert.equal(readingState(base).state, 'failed');
  assert.match(base.build.error, /^Demo mode can’t fetch web pages/);
});

test('match words: how close a passage is, in words, with a tone', () => {
  assert.deepEqual(matchWords(0.72), { text: 'Close match', tone: 'good' });
  assert.deepEqual(matchWords(0.3), { text: 'Might be related', tone: 'warn' });
  assert.deepEqual(matchWords(0.1), { text: 'Not related', tone: 'idle' });
  assert.deepEqual(matchWords(undefined), { text: '', tone: 'idle' });
});

test('getting ready: a step about the documents while they need reading, and none for an agent without any', () => {
  const none = readinessSteps({ config: care() });
  assert.equal(
    none.steps.some((s) => s.id === 'knowledge'),
    false,
  );
  const config = addKnowledgeFile(care(), 'faq.md');
  const sourcesSaved = { bases: [saved()] };
  const step = (knowledgeRead) => readinessSteps({ config, knowledgeRead }).steps.find((s) => s.id === 'knowledge');
  assert.deepEqual(
    { state: step(sourcesSaved).state, text: step(sourcesSaved).text, page: step(sourcesSaved).page },
    { state: 'todo', text: 'Its documents are saved but not read yet.', page: 'knowledge' },
  );
  assert.equal(step({ bases: [] }).text, 'Its documents are not saved yet.');
  assert.equal(step({ bases: [saved({ build: { status: 'failed' } })] }).text, 'Reading its documents failed.');
  assert.equal(step({ bases: [saved({ index: indexOf(['faq.md']) })] }).state, 'done');
  // not known (another page that did not read it): counted, and not claimed to need anything
  assert.equal(step(null).state, 'done');
  // the step is counted, so the menu's "n of m" includes it
  const plan = readinessSteps({ config, knowledgeRead: sourcesSaved });
  assert.equal(plan.total, plan.steps.filter((s) => s.id !== 'knowledge' && s.state !== 'optional').length + 1);
});

test('readers: who reads a base, in words', () => {
  const config = clone(care());
  config.knowledge = [
    { id: 'help_centre', type: 'vector_store', mode: 'inject', sources: [{ type: 'url', url: 'https://care.example' }] },
    { id: 'clinic_policies', type: 'vector_store', mode: 'tool', sources: [{ type: 'file', file_id: 'p.md' }] },
  ];
  assert.deepEqual(readersOf(config, 'help_centre'), { agents: [], tools: [] });
  assert.equal(readersInWords(config, 'help_centre'), '');
  config.tools.push({ id: 'search_policies', type: 'knowledge', source: 'clinic_policies' });
  assert.equal(readersInWords(config, 'clinic_policies'), 'Looked up with the “Search policies” tool (no agent has it yet).');
  assert.deepEqual(readersOf(config, 'clinic_policies'), { agents: [], tools: ['search_policies'] });
});

test('let it use it: a base read on every turn goes in the agent’s knowledge; one looked up gets a tool (reused when one exists)', () => {
  const config = clone(care());
  const entry = config.agents.items[0].id;
  config.knowledge = [
    { id: 'help_centre', type: 'vector_store', mode: 'inject', sources: [{ type: 'url', url: 'https://care.example' }] },
    { id: 'clinic_policies', type: 'vector_store', mode: 'tool', sources: [{ type: 'file', file_id: 'p.md' }] },
  ];
  const inject = attachBase(config, 'help_centre');
  assert.deepEqual(inject.agents.items[0].knowledge, ['help_centre']);
  assert.equal(attachBase(inject, 'help_centre'), inject, 'once');
  assert.equal(readersInWords(inject, 'help_centre'), 'Read by Care in every conversation.');

  const tool = attachBase(config, 'clinic_policies');
  const made = tool.tools.find((t) => t.type === 'knowledge');
  assert.deepEqual({ id: made.id, source: made.source }, { id: 'search_clinic_policies', source: 'clinic_policies' });
  assert.ok(tool.agents.items[0].tools.includes('search_clinic_policies'));
  assert.equal(attachBase(tool, 'clinic_policies'), tool, 'once');
  assert.deepEqual(readersOf(tool, 'clinic_policies'), { agents: [entry], tools: ['search_clinic_policies'] });

  // a tool that already searches it is given to the agent, not made twice
  const having = clone(config);
  having.tools.push({ id: 'policies', type: 'knowledge', source: 'clinic_policies' });
  const reused = attachBase(having, 'clinic_policies');
  assert.equal(reused.tools.filter((t) => t.type === 'knowledge').length, 1);
  assert.ok(reused.agents.items[0].tools.includes('policies'));
  // nothing to attach to
  assert.equal(attachBase(config, 'nope'), config);
});
