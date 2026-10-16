import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addFileSource,
  applyMinScore,
  baseState,
  describeScore,
  fileTypeProblem,
  fixActionFor,
  formatBytes,
  readableFix,
  knowledgeSummary,
  lastLog,
  normalizeBase,
  normalizeBuild,
  normalizeKnowledge,
  normalizeSearch,
  settingsOf,
  STATE_TEXT,
} from '../src/studio/knowledge/model.js';
import { chunk } from '../src/demo/demoKnowledge.js';
import { createDemoApi, memoryStorage } from '../src/demo/demoApi.js';

test('which files knowledge can read, and sizes in plain words', () => {
  assert.equal(fileTypeProblem('faq.md'), '');
  assert.equal(fileTypeProblem('Policy.PDF'), '');
  assert.equal(fileTypeProblem('data.csv'), '');
  assert.match(fileTypeProblem('photo.png'), /isn’t a kind of file knowledge can read/);
  assert.match(fileTypeProblem(''), /isn’t a kind/);
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(204800), '200 KB');
  assert.equal(formatBytes(5 * 1048576), '5.0 MB');
  assert.equal(formatBytes(undefined), '');
});

test('a base is read tolerantly, and its state says what to do', () => {
  const raw = {
    id: 'faq',
    type: 'vector_store',
    mode: 'inject',
    used_by: { agents: ['front'], tools: [] },
    sources: [
      { type: 'file', file_id: 'faq.md', uploaded: true },
      { type: 'file', file_id: 'gone.md', uploaded: false },
      { type: 'url', url: 'https://x.example/help' },
    ],
    index: {
      built_at: '2026-10-14T10:00:00Z',
      passages: 42,
      embedding: { provider: 'openai', model: 'text-embedding-3-small' },
      documents: [{ name: 'faq.md', passages: 40 }, 'old.md'],
    },
    build: { id: 'b1', status: 'done', result: { passages: 42 }, log: ['a', 'b'] },
    problems: [{ problem: 'The file gone.md is not uploaded.', fix: 'Upload it.' }, 'a bare string problem'],
  };
  const base = normalizeBase(raw);
  assert.deepEqual([base.id, base.type, base.mode, base.buildable], ['faq', 'vector_store', 'inject', true]);
  assert.deepEqual(
    base.sources.map((s) => [s.kind, s.label, s.uploaded]),
    [
      ['file', 'faq.md', true],
      ['file', 'gone.md', false],
      ['url', 'https://x.example/help', undefined],
    ],
  );
  assert.equal(base.index.passages, 42);
  assert.equal(base.index.embedding, 'openai text-embedding-3-small');
  assert.deepEqual(base.index.documents, [
    { name: 'faq.md', passages: 40 },
    { name: 'old.md', passages: undefined },
  ]);
  assert.deepEqual(
    base.problems.map((p) => p.problem),
    ['The file gone.md is not uploaded.', 'a bare string problem'],
  );
  assert.equal(baseState(base), 'stale', 'a missing file makes the index out of date');
  assert.equal(baseState({ ...base, problems: [] }), 'ready');
  assert.equal(baseState({ ...base, index: null, problems: [] }), 'not_built');
  assert.equal(baseState({ ...base, index: null, build: normalizeBuild({ status: 'failed', error: 'x' }), problems: [] }), 'failed');
  assert.equal(baseState({ ...base, build: normalizeBuild({ status: 'running' }) }), 'building');
  assert.equal(baseState(normalizeBase({ id: 'api', type: 'rag_api' })), 'external');
  assert.ok(
    Object.keys(STATE_TEXT).every((k) => STATE_TEXT[k].label && STATE_TEXT[k].hint),
    'every state has words',
  );
  assert.equal(normalizeBase(null).id, '');
});

test('a build job is read, and the last line of its log says what it is doing', () => {
  assert.equal(normalizeBuild({ status: 'running', log: ['Reading', 'Embedding'] }).status, 'running');
  assert.equal(lastLog(normalizeBuild({ status: 'running', log: ['Reading', 'Embedding'] })), 'Embedding');
  assert.equal(normalizeBuild({ status: 'done', result: { passages: 7 } }).passages, 7);
  assert.equal(normalizeBuild({ error: 'boom' }).status, 'failed', 'a status is worked out when none is sent');
  assert.equal(normalizeBuild(null), null);
  assert.equal(lastLog(null), '');
});

test('the problems the server names get a button: build, or upload', () => {
  assert.equal(fixActionFor({ problem: 'No index has been built for this base.', fix: 'Build the index.' }), 'build');
  assert.equal(fixActionFor({ problem: 'The file a.md changed after the index was built.', fix: 'Rebuild the index.' }), 'build');
  assert.equal(fixActionFor({ problem: 'The file a.md is not uploaded.', fix: 'Upload it.' }), 'upload');
  assert.equal(fixActionFor({ problem: 'Something else.', fix: '' }), '');
});

test('the whole answer is read: bases, files, whether the server can build, and a summary of what needs attention', () => {
  const k = normalizeKnowledge({
    ref: 'draft',
    embedding_key_available: false,
    bases: [
      { id: 'a', type: 'vector_store', index: { passages: 3 } },
      { id: 'b', type: 'vector_store', problems: [{ problem: 'No index has been built.' }] },
      { id: 'c', type: 'rag_api' },
      { id: 'd', type: 'vector_store', build: { status: 'running' } },
    ],
    files: [{ name: 'x.md', size: 10, modified: '2026-10-14T10:00:00Z', used_by: ['a'] }, { size: 1 }],
  });
  assert.equal(k.keyAvailable, false);
  assert.deepEqual(
    k.files.map((f) => f.name),
    ['x.md'],
    'a file without a name is left out',
  );
  assert.deepEqual(knowledgeSummary(k), { total: 4, needsBuild: 1, building: 1, ready: 2, problems: 1 });
  assert.equal(normalizeKnowledge({ bases: [] }).keyAvailable, true);
  assert.deepEqual(knowledgeSummary(null), { total: 0, needsBuild: 0, building: 0, ready: 0, problems: 0 });
});

test('a search answer is read, scores are put in words, and min_score shows what it would drop', () => {
  const answer = normalizeSearch({
    hits: [
      { text: 'Refunds take 5 days', source: 'faq.md', score: 0.71 },
      { text: 'Opening hours', source: 'faq.md', score: 0.31 },
      { text: 'Unrelated', score: 0.1 },
      { text: 'No score' },
    ],
    ms: 35,
    the_model_is_shown: 'Reference information:\n- Refunds take 5 days',
  });
  assert.equal(answer.hits.length, 4);
  assert.equal(answer.ms, 35);
  assert.match(answer.modelIsShown, /Reference information/);
  assert.deepEqual(
    answer.hits.map((h) => describeScore(h.score)),
    ['related', 'maybe related', 'unrelated', ''],
  );
  assert.deepEqual(
    applyMinScore(answer.hits, 0.5).map((h) => h.kept),
    [true, false, false, true],
    'a passage with no score is never dropped',
  );
  assert.deepEqual(
    applyMinScore(answer.hits, undefined).map((h) => h.kept),
    [true, true, true, true],
  );
  assert.equal(normalizeSearch(null).hits.length, 0);
  assert.equal(normalizeSearch({ the_model_is_shown: { results: ['a'] } }).modelIsShown.includes('results'), true, 'a tool’s answer is shown as JSON');
});

test('the settings that matter to a search are read from the config, and a file is added to a base once', () => {
  const config = {
    knowledge: [
      { id: 'faq', type: 'vector_store', mode: 'inject', top_k: 6, retrieval: { min_score: 0.4 }, sources: [{ type: 'file', file_id: 'a.md' }] },
      { id: 'api', type: 'rag_api' },
    ],
  };
  assert.deepEqual(settingsOf(config, 'faq'), { minScore: 0.4, topK: 6, mode: 'inject' });
  assert.deepEqual(settingsOf(config, 'api'), { minScore: undefined, topK: undefined, mode: 'tool' });
  assert.deepEqual(settingsOf(config, 'ghost'), { minScore: undefined, topK: undefined, mode: 'tool' });
  const next = addFileSource(config, 'faq', 'b.md');
  assert.deepEqual(next.knowledge[0].sources, [
    { type: 'file', file_id: 'a.md' },
    { type: 'file', file_id: 'b.md' },
  ]);
  assert.equal(config.knowledge[0].sources.length, 1, 'the original is not changed');
  assert.equal(addFileSource(next, 'faq', 'b.md'), next, 'the same file is not added twice');
  assert.equal(addFileSource(config, 'api', 'b.md'), config, 'an external base has no files');
  assert.equal(addFileSource(config, 'ghost', 'b.md'), config);
});

// ---------------------------------------------------------------- the demo API's knowledge
const FAQ =
  'Refunds are paid back within five working days to the original card. To get a refund, ask the support team and give your order number.\n\nOur opening hours are nine to five on weekdays. We are closed at weekends and on public holidays.\n\nDelivery usually takes three days. Express delivery takes one day and costs extra.';
async function withBase({ stepMs = 0, mode = 'tool', extra = {} } = {}) {
  const api = createDemoApi({ storage: memoryStorage(), seed: false, stepMs });
  await api.handle('POST', '/bots', { id: 'k', name: 'K' });
  const draft = (await api.handle('GET', '/bots/k/draft')).body;
  const config = {
    ...draft.config,
    knowledge: [
      { id: 'faq', type: 'vector_store', mode, sources: [{ type: 'file', file_id: 'faq.md' }], ...extra },
      { id: 'live', type: 'rag_api', connection: 'c', request: { method: 'GET', path: '/s' } },
    ],
  };
  await api.handle('PUT', '/bots/k/draft', { config });
  return api;
}

test('upload, list, build, status and search: the whole flow, with the same shapes as the real API', async () => {
  const api = await withBase();
  let overview = (await api.handle('GET', '/bots/k/knowledge')).body;
  assert.deepEqual(
    overview.bases.map((b) => b.id),
    ['faq', 'live'],
  );
  assert.equal(overview.bases[0].index, null);
  assert.deepEqual(overview.bases[0].sources, [{ type: 'file', file_id: 'faq.md', uploaded: false }]);
  assert.deepEqual(overview.bases[0].problems.map((p) => p.problem).sort(), ['No index has been built for this base.', 'The file faq.md is not uploaded.']);
  assert.equal(overview.embedding_key_available, true);
  // upload (the body IS the file)
  const up = await api.handle('PUT', '/bots/k/knowledge/files/faq.md', { __file: FAQ });
  assert.equal(up.status, 201);
  assert.deepEqual([up.body.name, up.body.size], ['faq.md', FAQ.length]);
  assert.equal((await api.handle('GET', '/bots/k/knowledge/files')).body[0].name, 'faq.md');
  overview = (await api.handle('GET', '/bots/k/knowledge')).body;
  assert.equal(overview.bases[0].sources[0].uploaded, true);
  assert.deepEqual(overview.files[0].used_by, ['faq']);
  // build: 202 with a job, then done with passages
  const job = await api.handle('POST', '/bots/k/knowledge/faq/build', {});
  assert.equal(job.status, 202);
  assert.equal(job.body.status, 'running');
  const status = (await api.handle('GET', '/bots/k/knowledge/faq/status')).body;
  assert.equal(status.build.status, 'done');
  assert.ok(status.build.result.passages >= 1);
  assert.equal(status.index.passages, status.build.result.passages);
  assert.deepEqual(status.problems, []);
  assert.deepEqual(
    status.index.documents.map((d) => d.name),
    ['faq.md'],
  );
  // search: scored, best first, with what the model would be shown
  const found = (await api.handle('POST', '/bots/k/knowledge/faq/search', { query: 'how do I get a refund' })).body;
  assert.ok(found.hits.length >= 1);
  assert.match(found.hits[0].text, /Refunds/);
  assert.ok(found.hits[0].score > 0 && found.hits.every((h, i, l) => i === 0 || l[i - 1].score >= h.score));
  assert.match(found.the_model_is_shown, /results/, 'a tool-mode base returns a tool result');
  assert.match(found.note, /no embedding model/);
  assert.equal((await api.handle('POST', '/bots/k/knowledge/faq/search', { query: '' })).status, 422);
  assert.equal((await api.handle('POST', '/bots/k/knowledge/ghost/search', { query: 'x' })).status, 404);
});

test('what the API refuses: other file kinds, a second build, an external base, a search before a build, a file a base reads', async () => {
  const api = await withBase({ stepMs: 1000, clock: undefined });
  assert.equal((await api.handle('PUT', '/bots/k/knowledge/files/photo.png', { __file: 'x' })).status, 400);
  assert.equal((await api.handle('POST', '/bots/k/knowledge/faq/search', { query: 'refund' })).status, 409, 'no index yet');
  await api.handle('PUT', '/bots/k/knowledge/files/faq.md', { __file: FAQ });
  assert.equal((await api.handle('POST', '/bots/k/knowledge/live/build', {})).status, 400, 'nothing to build for an external service');
  assert.equal((await api.handle('POST', '/bots/k/knowledge/ghost/build', {})).status, 404);
  const first = await api.handle('POST', '/bots/k/knowledge/faq/build', {});
  assert.equal(first.status, 202);
  assert.equal((await api.handle('POST', '/bots/k/knowledge/faq/build', {})).status, 409, 'one build per base at a time');
  const running = (await api.handle('GET', '/bots/k/knowledge/faq/status')).body;
  assert.equal(running.build.status, 'running');
  assert.ok(running.build.log.length >= 1, 'a progress log');
  // deleting a file a base reads
  const refused = await api.handle('DELETE', '/bots/k/knowledge/files/faq.md');
  assert.equal(refused.status, 409);
  assert.match(refused.body.detail, /read by the knowledge base 'faq'/);
  assert.equal((await api.handle('DELETE', '/bots/k/knowledge/files/faq.md?force=true')).status, 204);
  assert.equal((await api.handle('GET', '/bots/k/knowledge/files')).body.length, 0);
  assert.equal((await api.handle('DELETE', '/bots/k/knowledge/files/faq.md')).status, 404);
});

test('a build that has nothing to read fails with a reason, a changed file makes the index out of date, and a rebuild fixes it', async () => {
  const api = await withBase();
  const failed = await api.handle('POST', '/bots/k/knowledge/faq/build', {});
  assert.equal(failed.status, 202);
  const status = (await api.handle('GET', '/bots/k/knowledge/faq/status')).body;
  assert.equal(status.build.status, 'failed');
  assert.match(status.build.error, /None of the sources gave any text/);
  assert.equal(status.index, null);
  await api.handle('PUT', '/bots/k/knowledge/files/faq.md', { __file: FAQ });
  await api.handle('POST', '/bots/k/knowledge/faq/build', {});
  assert.equal((await api.handle('GET', '/bots/k/knowledge/faq/status')).body.problems.length, 0);
  // replacing the file after the build
  await new Promise((r) => {
    setTimeout(r, 5);
  });
  await api.handle('PUT', '/bots/k/knowledge/files/faq.md', { __file: `${FAQ} New paragraph.` });
  const stale = (await api.handle('GET', '/bots/k/knowledge/faq/status')).body;
  assert.match(stale.problems[0].problem, /changed after the index was built/);
  assert.equal(fixActionFor(stale.problems[0]), 'build');
  await api.handle('POST', '/bots/k/knowledge/faq/build', {});
  assert.equal((await api.handle('GET', '/bots/k/knowledge/faq/status')).body.problems.length, 0);
});

test('an inject base searches with the bot’s previous reply, and min_score drops the weak passages', async () => {
  const api = await withBase({ mode: 'inject', extra: { retrieval: { min_score: 0.5, instruction: 'Use this:' }, top_k: 5 } });
  await api.handle('PUT', '/bots/k/knowledge/files/faq.md', { __file: FAQ });
  await api.handle('POST', '/bots/k/knowledge/faq/build', {});
  const plain = (await api.handle('POST', '/bots/k/knowledge/faq/search', { query: 'how much does it cost' })).body;
  assert.equal(plain.query_used, 'how much does it cost');
  const followUp = (
    await api.handle('POST', '/bots/k/knowledge/faq/search', { query: 'how much does that cost', previous_reply: 'Express delivery takes one day.' })
  ).body;
  assert.match(followUp.query_used, /Express delivery takes one day\. how much does that cost/, 'a follow-up carries its subject');
  assert.match(followUp.hits[0].text, /Express delivery/);
  assert.match(followUp.the_model_is_shown, /^Use this:\n- /, 'inject mode shows the instruction and the passages');
  assert.ok(
    followUp.hits.every((h) => h.score >= 0.5),
    'the minimum score is applied',
  );
});

test('text is cut into passages with the overlap the base asks for', () => {
  assert.deepEqual(chunk('', 200), []);
  const text = 'a'.repeat(500);
  const parts = chunk(text, 200, 50);
  assert.equal(parts[0].length, 200);
  assert.equal(parts.length, 3);
  assert.equal(chunk('short', 1200, 150).length, 1);
});

test('a fix that is a command line for an operator is not shown, plain advice is (UI review 3a)', () => {
  assert.equal(readableFix({ problem: 'p', fix: 'Upload it, or remove it from the sources.' }), 'Upload it, or remove it from the sources.');
  assert.equal(readableFix({ problem: 'p', fix: 'Run `python -m weave.knowledge build faq`.' }), '');
  assert.equal(readableFix({ problem: 'p', fix: 'python -m weave.knowledge build faq' }), '');
  assert.equal(readableFix({ problem: 'p', fix: 'Run `python3 -m agent_runtime.knowledge_index build x`' }), '', 'also right after a backtick');
  assert.equal(
    readableFix({ problem: 'p', fix: 'Set `retrieval.min_score` lower.' }),
    'Set `retrieval.min_score` lower.',
    'advice that mentions a setting is kept',
  );
  assert.equal(
    readableFix({ problem: 'p', fix: 'Check the node that holds the file.' }),
    'Check the node that holds the file.',
    'an ordinary word is not a command',
  );
  assert.equal(readableFix({ problem: 'p', fix: '' }), '');
  assert.equal(readableFix({ problem: 'p' }), '');
  assert.equal(
    fixActionFor({ problem: 'No index has been built for this base.', fix: 'python -m weave.knowledge build faq' }),
    'build',
    'the button still shows',
  );
});
