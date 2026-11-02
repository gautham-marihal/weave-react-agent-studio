import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import {
  STATE_TEXT,
  addBaseFromFile,
  addFileSource,
  applyMinScore,
  baseState,
  describeScore,
  fileTypeProblem,
  fixActionFor,
  howItSearches,
  knowledgeSummary,
  lastLog,
  matchWords,
  normalizeBase,
  normalizeBuild,
  normalizeKnowledge,
  normalizeSearch,
  readableFix,
  readingState,
  refreshNote,
  settingsOf,
  sinceRead,
  sizeInWords,
  usedByInWords,
} from './knowledge';

// The knowledge model: files, bases, builds and searches read from the server's answers, and what a base needs, in words.

describe('files', () => {
  it('says which files knowledge can read, and sizes in plain words', () => {
    expect(fileTypeProblem('faq.md')).toBe('');
    expect(fileTypeProblem('Policy.PDF')).toBe('');
    expect(fileTypeProblem('data.csv')).toBe('');
    expect(fileTypeProblem('photo.png')).toMatch(/isn’t a kind of file knowledge can read/);
    expect(fileTypeProblem('')).toMatch(/isn’t a kind/);
    expect(sizeInWords(512)).toBe('512 B');
    expect(sizeInWords(2048)).toBe('2.0 KB');
    expect(sizeInWords(204800)).toBe('200 KB');
    expect(sizeInWords(5 * 1048576)).toBe('5.0 MB');
    expect(sizeInWords(undefined)).toBe('');
  });

  it('names who reads something, whatever shape the server sends', () => {
    expect(usedByInWords(['faq', 'prices'])).toBe('faq, prices');
    expect(usedByInWords({ agents: ['front'], tools: ['search_faq'] })).toBe('front, search_faq');
    expect(usedByInWords([])).toBe('Nothing yet');
    expect(usedByInWords(undefined)).toBe('Nothing yet');
  });
});

describe('a base', () => {
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

  it('is read tolerantly, and its state says what to do', () => {
    const base = normalizeBase(raw);
    expect([base.id, base.type, base.mode, base.buildable]).toEqual(['faq', 'vector_store', 'inject', true]);
    expect(base.sources.map((s) => [s.kind, s.label, s.uploaded])).toEqual([
      ['file', 'faq.md', true],
      ['file', 'gone.md', false],
      ['url', 'https://x.example/help', undefined],
    ]);
    expect(base.index?.passages).toBe(42);
    expect(base.index?.embedding).toBe('openai text-embedding-3-small');
    expect(base.index?.documents).toEqual([
      { name: 'faq.md', passages: 40 },
      { name: 'old.md', passages: undefined },
    ]);
    expect(base.problems.map((p) => p.problem)).toEqual(['The file gone.md is not uploaded.', 'a bare string problem']);
    expect(baseState(base)).toBe('stale'); // a missing file makes the index out of date
    expect(baseState({ ...base, problems: [] })).toBe('ready');
    expect(baseState({ ...base, index: null, problems: [] })).toBe('not_built');
    expect(baseState({ ...base, index: null, build: normalizeBuild({ status: 'failed', error: 'x' }), problems: [] })).toBe('failed');
    // a failed build is said even with an older index
    expect(baseState({ ...base, build: normalizeBuild({ status: 'failed', error: 'x' }), problems: [] })).toBe('failed');
    expect(baseState({ ...base, build: normalizeBuild({ status: 'running' }) })).toBe('building');
    expect(baseState(normalizeBase({ id: 'api', type: 'rag_api' }))).toBe('external');
    expect(Object.values(STATE_TEXT).every((s) => s.label && s.hint)).toBe(true);
    expect(normalizeBase(null).id).toBe('');
  });

  it('reads a build job, and the last line of its log says what it is doing', () => {
    expect(normalizeBuild({ status: 'running', log: ['Reading', 'Embedding'] })?.status).toBe('running');
    expect(lastLog(normalizeBuild({ status: 'running', log: ['Reading', 'Embedding'] }))).toBe('Embedding');
    expect(normalizeBuild({ status: 'done', result: { passages: 7 } })?.passages).toBe(7);
    expect(normalizeBuild({ error: 'boom' })?.status).toBe('failed'); // a status is worked out when none is sent
    expect(normalizeBuild({ status: 'pending' })?.status).toBe('running'); // a job waiting to start is followed too
    expect(normalizeBuild(null)).toBeNull();
    expect(lastLog(null)).toBe('');
  });

  it('gives the problems the server names a button: build, or upload', () => {
    expect(fixActionFor({ problem: 'No index has been built for this base.', fix: 'Build the index.' })).toBe('build');
    expect(fixActionFor({ problem: 'The file a.md changed after the index was built.', fix: 'Rebuild the index.' })).toBe('build');
    expect(fixActionFor({ problem: 'The file a.md is not uploaded.', fix: 'Upload it.' })).toBe('upload');
    expect(fixActionFor({ problem: 'Something else.', fix: '' })).toBe('');
  });

  it('hides a fix that is a command line for an operator, and keeps plain advice', () => {
    expect(readableFix({ problem: 'p', fix: 'Upload it, or remove it from the sources.' })).toBe('Upload it, or remove it from the sources.');
    expect(readableFix({ problem: 'p', fix: 'Run `python -m weave.knowledge build faq`.' })).toBe('');
    expect(readableFix({ problem: 'p', fix: 'python -m weave.knowledge build faq' })).toBe('');
    expect(readableFix({ problem: 'p', fix: 'Run `python3 -m agent_runtime.knowledge_index build x`' })).toBe('');
    expect(readableFix({ problem: 'p', fix: 'Set `retrieval.min_score` lower.' })).toBe('Set `retrieval.min_score` lower.');
    expect(readableFix({ problem: 'p', fix: 'Check the node that holds the file.' })).toBe('Check the node that holds the file.');
    expect(readableFix({ problem: 'p', fix: '' })).toBe('');
    expect(readableFix({ problem: 'p' })).toBe('');
    expect(fixActionFor({ problem: 'No index has been built for this base.', fix: 'python -m weave.knowledge build faq' })).toBe('build');
  });
});

describe('the whole answer', () => {
  it('reads bases, files, whether the server can build, and a summary of what needs attention', () => {
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
    expect(k.keyAvailable).toBe(false);
    expect(k.files.map((f) => f.name)).toEqual(['x.md']); // a file without a name is left out
    expect(knowledgeSummary(k)).toEqual({ total: 4, needsBuild: 1, building: 1, ready: 2, problems: 1 });
    expect(normalizeKnowledge({ bases: [] }).keyAvailable).toBe(true);
    expect(knowledgeSummary(null)).toEqual({ total: 0, needsBuild: 0, building: 0, ready: 0, problems: 0 });
    expect(normalizeKnowledge([{ id: 'only', type: 'vector_store' }]).bases.map((b) => b.id)).toEqual(['only']); // a bare list of bases
  });
});

describe('a search', () => {
  it('reads the answer, puts scores in words, and shows what min_score would drop', () => {
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
    expect(answer.hits).toHaveLength(4);
    expect(answer.ms).toBe(35);
    expect(answer.modelIsShown).toMatch(/Reference information/);
    expect(answer.hits.map((h) => describeScore(h.score))).toEqual(['related', 'maybe related', 'unrelated', '']);
    expect(applyMinScore(answer.hits, 0.5).map((h) => h.kept)).toEqual([true, false, false, true]); // no score: never dropped
    expect(applyMinScore(answer.hits, undefined).map((h) => h.kept)).toEqual([true, true, true, true]);
    expect(normalizeSearch(null).hits).toHaveLength(0);
    expect(normalizeSearch({ the_model_is_shown: { results: ['a'] } }).modelIsShown).toContain('results'); // a tool's answer, as JSON
  });

  it('says how close a passage is, in words, with a tone', () => {
    expect(matchWords(0.72)).toEqual({ text: 'Close match', tone: 'good' });
    expect(matchWords(0.3)).toEqual({ text: 'Might be related', tone: 'warn' });
    expect(matchWords(0.1)).toEqual({ text: 'Not related', tone: 'idle' });
    expect(matchWords(undefined)).toEqual({ text: '', tone: 'idle' });
  });
});

describe('the draft', () => {
  const config = {
    knowledge: [
      { id: 'faq', type: 'vector_store', mode: 'inject', top_k: 6, retrieval: { min_score: 0.4 }, sources: [{ type: 'file', file_id: 'a.md' }] },
      { id: 'api', type: 'rag_api' },
    ],
  } as AgentConfig;

  it('reads the settings that matter to a search, and adds a file to a base once', () => {
    expect(settingsOf(config, 'faq')).toEqual({ minScore: 0.4, topK: 6, mode: 'inject', refresh: 'manual' });
    expect(settingsOf(config, 'api')).toEqual({ minScore: undefined, topK: undefined, mode: 'tool', refresh: 'manual' });
    expect(settingsOf(config, 'ghost')).toEqual({ minScore: undefined, topK: undefined, mode: 'tool', refresh: 'manual' });
    const next = addFileSource(config, 'faq', 'b.md');
    expect(next.knowledge[0].sources).toEqual([
      { type: 'file', file_id: 'a.md' },
      { type: 'file', file_id: 'b.md' },
    ]);
    expect(config.knowledge[0].sources).toHaveLength(1); // the original is not changed
    expect(addFileSource(next, 'faq', 'b.md')).toBe(next); // the same file is not added twice
    expect(addFileSource(config, 'api', 'b.md')).toBe(config); // an external base has no files
    expect(addFileSource(config, 'ghost', 'b.md')).toBe(config);
  });

  it('makes a new base from a file, with a free id', () => {
    const one = addBaseFromFile(config, 'FAQ for Callers.md');
    expect(one.id).toBe('faq_for_callers');
    expect(one.config.knowledge.at(-1)).toEqual({ id: 'faq_for_callers', type: 'vector_store', mode: 'tool', sources: [{ type: 'file', file_id: 'FAQ for Callers.md' }] });
    expect(addBaseFromFile(config, 'faq.txt').id).toBe('faq_2'); // the id is taken
    expect(config.knowledge).toHaveLength(2);
  });

  it('says how a base is searched, from its settings', () => {
    const inject = howItSearches(config, 'faq').join(' ');
    expect(inject).toMatch(/before every reply/);
    expect(inject).toMatch(/6 passages/);
    expect(inject).toMatch(/under 0\.4 are dropped/);
    expect(inject).toMatch(/follow-up/);
    const tool = howItSearches({ knowledge: [{ id: 't', type: 'vector_store', mode: 'tool' }] } as AgentConfig, 't').join(' ');
    expect(tool).toMatch(/only when the model decides/);
    expect(tool).toMatch(/usual number of passages \(4\)/);
    expect(tool).toMatch(/No minimum score/);
    expect(howItSearches(config, 'api').join(' ')).toMatch(/your own search service/);
    expect(howItSearches(config, 'ghost')[0]).toMatch(/not in the draft/);
  });

  it('says plainly that the server does not rebuild on a timer', () => {
    expect(refreshNote('manual')).toBe('');
    expect(refreshNote(undefined)).toBe('');
    expect(refreshNote('daily')).toMatch(/every day, but the server doesn’t rebuild/);
  });
});

// How far a base's documents are from being something it answers from.
const saved = (raw: Record<string, unknown> = {}) =>
  normalizeBase({
    id: 'knowledge',
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
const indexOf = (names: string[]) => ({ built_at: '2026-10-23T09:00:00Z', passages: 4, documents: names.map((name) => ({ name, passages: 2 })) });

describe('reading state', () => {
  it('is unsaved when the draft lists other documents than the saved base, or there is no base on the server', () => {
    expect(readingState(null).state).toBe('unsaved');
    expect(readingState(saved(), { draftSources: [...draft, { type: 'url', url: 'https://care.example/help' }] }).state).toBe('unsaved');
    // the same documents listed twice are the same
    expect(readingState(saved(), { draftSources: [draft[0], draft[0]] }).state).toBe('unread');
  });

  it('is unread, being read, failed or ready', () => {
    expect(readingState(saved(), { draftSources: draft }).state).toBe('unread');
    expect(readingState(saved({ build: { status: 'running' } })).state).toBe('reading');
    expect(readingState(saved({ build: { status: 'failed', error: 'No text.' } })).state).toBe('failed');
    // a build followed on the screen wins over the one the server last reported
    expect(readingState(saved({ build: { status: 'failed' } }), { build: normalizeBuild({ status: 'running', log: [] }) }).state).toBe('reading');
    expect(readingState(saved({ index: indexOf(['faq.md']) })).state).toBe('ready');
  });

  it('names a file the server no longer has, before anything else', () => {
    const base = saved({ sources: [{ type: 'file', file_id: 'faq.md', uploaded: false }], index: indexOf(['faq.md']) });
    expect(readingState(base)).toEqual({ state: 'missing', names: ['faq.md'] });
  });

  it('is changed when a file was replaced, added or taken out since the index was read, with the files named', () => {
    const replaced = saved({ index: indexOf(['faq.md']), problems: [{ problem: 'The file faq.md changed after the index was built.', fix: 'Rebuild the index.' }] });
    expect(readingState(replaced)).toEqual({ state: 'changed', names: ['faq.md'] });
    const added = saved({
      sources: [
        { type: 'file', file_id: 'faq.md', uploaded: true },
        { type: 'file', file_id: 'prices.md', uploaded: true },
      ],
      index: indexOf(['faq.md']),
    });
    expect(readingState(added).names).toEqual(['prices.md']);
    expect(readingState(saved({ index: indexOf(['faq.md', 'old.md']) }))).toEqual({ state: 'changed', names: ['old.md'] });
  });

  it('does not compare documents the server names its own way (no false "changed")', () => {
    const base = saved({ index: indexOf(['documents/0001', 'documents/0002']) });
    expect(sinceRead(base)).toEqual({ added: [], removed: [], changed: [], missing: [] });
    expect(readingState(base).state).toBe('ready');
    // a web page's document is never called taken out
    const page = saved({
      sources: [
        { type: 'file', file_id: 'faq.md', uploaded: true },
        { type: 'url', url: 'https://care.example/help' },
      ],
      index: indexOf(['faq.md', 'https://care.example/help/contact']),
    });
    expect(readingState(page).state).toBe('ready');
  });
});
