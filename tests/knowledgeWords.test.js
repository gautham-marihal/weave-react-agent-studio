import test from 'node:test';
import assert from 'node:assert/strict';
import { keptBy, linesOf, matchName, readKnowledge, sentenceParts, summaryLine } from '../src/studio/agent/detailed/knowledgeWorkspace/knowledgeWords.js';

// Build › Knowledge in words (src/studio/agent/detailed/knowledgeWorkspace/knowledgeWords.js): what the sentence, the
// lines and the shelf say, against FRONTEND_GUIDE 10.2, agent-config-guide 2.11 / 3.20 and the schema's defaults.
const agentWith = (knowledge, extra = {}) => ({
  agents: { entry: 'main', items: [{ id: 'main', name: 'Main', knowledge: ['knowledge'] }] },
  knowledge,
  ...extra,
});
const docs = (base = {}) =>
  agentWith([
    {
      id: 'knowledge',
      type: 'vector_store',
      mode: 'inject',
      sources: [
        { type: 'file', file_id: 'rates.pdf' },
        { type: 'file', file_id: 'faq.md' },
        { type: 'url', url: 'https://example.com/help', crawl_depth: 1 },
      ],
      ...base,
    },
  ]);

test('a new agent: nothing to read, and what its first document will start with', () => {
  const k = readKnowledge({});
  assert.equal(k.hasBase, false);
  assert.equal(k.mode, 'inject', 'the first document sets up a base searched on every turn');
  assert.equal(k.topK, 4, 'the schema: 4 passages unless set');
  assert.deepEqual(sentenceParts({}), { docs: '', pages: '', mode: 'on every caller turn', topk: 'the 4 best passages' });
  assert.equal(summaryLine({}), 'Nothing to read yet');
});

test('with documents and pages: the sentence, the lines and the summary', () => {
  const config = docs({ top_k: 3, retrieval: { min_score: 0.4 } });
  assert.deepEqual(sentenceParts(config), { docs: '2 documents', pages: '1 web page', mode: 'on every caller turn', topk: 'the 3 best passages' });
  const lines = linesOf(config, null);
  assert.equal(lines.documents.value, '2 files');
  assert.deepEqual([lines.pages.value, lines.pages.note], ['1 address', 'follows links 1 level deep']);
  assert.equal(lines.readers.value, 'Main');
  assert.equal(lines.when.note, 'the caller waits up to 3 s for it');
  assert.equal(lines.from.note, 'a follow-up keeps its subject');
  assert.deepEqual([lines.many.value, lines.many.note], ['The 3 best', 'at most 4,000 characters']);
  assert.deepEqual([lines.close.value, lines.close.note], ['Fair or better', '0.40 and up']);
  assert.equal(summaryLine(config), '2 documents · 1 web page · read by Main');
  // a base searched when the model decides; every match kept when no line is set
  const tool = linesOf(docs({ mode: 'tool' }), null);
  assert.equal(tool.when.value, 'When it decides it needs to');
  assert.deepEqual([tool.close.value, tool.close.empty], ['Every match', true]);
});

test('what the server says since the last build shows on the documents line', () => {
  const config = docs();
  const read = {
    bases: [
      {
        id: 'knowledge',
        index: { builtAt: '2026-11-06T09:00:00Z', documents: [] },
        problems: [{ problem: 'The file faq.md changed after the index was built.' }],
      },
    ],
  };
  assert.equal(linesOf(config, read).documents.note, '1 changed since the last build');
  const missing = { bases: [{ id: 'knowledge', sources: [{ kind: 'file', label: 'faq.md', uploaded: false }] }] };
  assert.equal(linesOf(config, missing).documents.note, '1 file not uploaded', 'a file not on the server is said first');
  assert.equal(linesOf(config, null).documents.note, '', 'before the server has said: nothing made up');
});

test('the match line in words, and how many of a try-out’s passages it keeps', () => {
  assert.deepEqual([0.8, 0.6, 0.3, 0.1].map(matchName), ['Close matches only', 'Related or closer', 'Fair or better', 'Almost every match']);
  const hits = [{ score: 0.71 }, { score: 0.52 }, { score: 0.34 }];
  assert.equal(keptBy(hits, 0.4), 2);
  assert.equal(keptBy(hits, null), 3, 'no line: every passage');
});
