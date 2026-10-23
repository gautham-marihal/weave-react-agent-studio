// Knowledge: the files and web pages an agent answers from. A `vector_store` base is searched from an INDEX built before calls, so someone
// has to upload files, build the index and check a search; a `rag_api` base asks a search service that already exists, so there is nothing
// to build. This reads the API's answers (`GET /knowledge`, `.../status`, a build job, a search) into what the screen shows, tolerantly: a
// field that is missing or new is left out, never an error. Pure: no network, no DOM.

import { isObj } from '../form/engine.js';

const list = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

// The kinds of file a knowledge base can read (the API refuses others with a 400).
export const ACCEPTED_EXTENSIONS = ['.txt', '.md', '.markdown', '.html', '.htm', '.pdf', '.csv', '.json'];
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.join(',');
export const fileTypeProblem = (name) =>
  ACCEPTED_EXTENSIONS.some((ext) =>
    String(name || '')
      .toLowerCase()
      .endsWith(ext),
  )
    ? ''
    : `“${name}” isn’t a kind of file knowledge can read. Use text, markdown, HTML, PDF, CSV or JSON (${ACCEPTED_EXTENSIONS.join(', ')}).`;

export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ---- a build job ---------------------------------------------------------------------------------------------------------------------
export function normalizeBuild(raw) {
  if (!isObj(raw)) return null;
  const status = ['running', 'done', 'failed'].includes(raw.status) ? raw.status : raw.error ? 'failed' : raw.result ? 'done' : 'running';
  return {
    id: text(raw.id),
    status,
    log: list(raw.log).map(text).filter(Boolean),
    passages: typeof raw.result?.passages === 'number' ? raw.result.passages : typeof raw.passages === 'number' ? raw.passages : undefined,
    error: text(raw.error),
    startedAt: text(raw.started_at || raw.created_at),
    finishedAt: text(raw.finished_at || raw.ended_at),
  };
}
export const isBuilding = (build) => build?.status === 'running';

// ---- one base ------------------------------------------------------------------------------------------------------------------------
export function normalizeBase(raw, keyAvailable = true) {
  const b = isObj(raw) ? raw : {};
  const type = text(b.type);
  const index = isObj(b.index)
    ? {
        builtAt: text(b.index.built_at),
        passages: typeof b.index.passages === 'number' ? b.index.passages : 0,
        embedding: isObj(b.index.embedding) ? `${text(b.index.embedding.provider)} ${text(b.index.embedding.model)}`.trim() : text(b.index.embedding),
        documents: list(b.index.documents).map((d) =>
          typeof d === 'string'
            ? { name: d, passages: undefined }
            : { name: text(d?.name || d?.source || d?.file), passages: typeof d?.passages === 'number' ? d.passages : undefined },
        ),
      }
    : null;
  return {
    id: text(b.id),
    type,
    mode: text(b.mode) || 'tool',
    usedBy: { agents: list(b.used_by?.agents).map(text), tools: list(b.used_by?.tools).map(text) },
    sources: list(b.sources).map((s) =>
      s?.type === 'url'
        ? { kind: 'url', label: text(s.url), uploaded: undefined }
        : { kind: 'file', label: text(s?.file_id || s?.name), uploaded: typeof s?.uploaded === 'boolean' ? s.uploaded : undefined },
    ),
    index,
    build: normalizeBuild(b.build),
    problems: list(b.problems)
      .map((p) => (typeof p === 'string' ? { problem: p, fix: '' } : { problem: text(p?.problem), fix: text(p?.fix) }))
      .filter((p) => p.problem),
    keyAvailable: typeof b.embedding_key_available === 'boolean' ? b.embedding_key_available : keyAvailable,
    buildable: type === 'vector_store',
  };
}

// 'external' (a search service: nothing to build) | 'building' | 'not_built' | 'stale' | 'failed' | 'ready'
export function baseState(base) {
  if (!base.buildable) return 'external';
  if (isBuilding(base.build)) return 'building';
  if (!base.index) return base.build?.status === 'failed' ? 'failed' : 'not_built';
  if (base.problems.some((p) => /changed after|stale|out of date|not uploaded/i.test(p.problem))) return 'stale';
  return 'ready';
}

export const STATE_TEXT = {
  external: { label: 'External search', tone: 'idle', hint: 'It asks a search service you already run. Nothing is built here.' },
  building: { label: 'Building…', tone: 'warn', hint: 'An index is being built. The old one keeps answering until the new one is ready.' },
  not_built: { label: 'Not built', tone: 'bad', hint: 'No index has been built, so searches find nothing.' },
  stale: { label: 'Needs rebuilding', tone: 'warn', hint: 'A file changed or is missing since the index was built.' },
  failed: { label: 'Build failed', tone: 'bad', hint: 'The last build failed. The old index (if there was one) keeps answering.' },
  ready: { label: 'Ready', tone: 'good', hint: 'The index is built and current.' },
};

// The server's `fix` is sometimes a command line for an operator (`python -m …`), which means nothing in a browser (UI review 3a). Such text is not shown;
// the problem stays, and the screen's own button (Build now, Upload a file) says what to do.
const COMMAND_LINE = /(^|[\s`'"(])(python3?|pip3?|npm|npx|curl|docker|\.\/\S+)\s+\S|^\s*\$\s|\s-m\s+[\w.]+/i;
export function readableFix(problem) {
  const fix = text(problem?.fix).trim();
  return fix && !COMMAND_LINE.test(fix) ? fix : '';
}

// What a problem's fix should be, so the screen can offer a button: build (re-)indexes, upload adds a file.
export function fixActionFor(problem) {
  const p = `${problem.problem} ${problem.fix}`.toLowerCase();
  if (/no index has been built|changed after|stale|rebuild|build the index/.test(p)) return 'build';
  if (/not uploaded|upload/.test(p)) return 'upload';
  return '';
}

// ---- the whole answer ----------------------------------------------------------------------------------------------------------------------
export function normalizeKnowledge(raw) {
  const keyAvailable = raw?.embedding_key_available === false ? false : true;
  const bases = list(raw?.bases).map((b) => normalizeBase(b, keyAvailable));
  const files = list(raw?.files)
    .map((f) => ({
      name: text(f?.name),
      size: typeof f?.size === 'number' ? f.size : undefined,
      modified: text(f?.modified),
      usedBy: list(f?.used_by).map(text),
    }))
    .filter((f) => f.name);
  return { ref: text(raw?.ref), bases, files, keyAvailable: keyAvailable && bases.every((b) => b.keyAvailable !== false) };
}

// How many bases need attention, for a one-line summary elsewhere (the Simple view, the release checklist).
export function knowledgeSummary(knowledge) {
  const bases = list(knowledge?.bases);
  const states = bases.map(baseState);
  return {
    total: bases.length,
    needsBuild: states.filter((s) => s === 'not_built' || s === 'stale' || s === 'failed').length,
    building: states.filter((s) => s === 'building').length,
    ready: states.filter((s) => s === 'ready' || s === 'external').length,
    problems: bases.reduce((n, b) => n + b.problems.length, 0),
  };
}

// ---- a search ------------------------------------------------------------------------------------------------------------------------
export function normalizeSearch(raw) {
  const r = isObj(raw) ? raw : {};
  return {
    hits: list(r.hits).map((h) => ({ text: text(h?.text), source: text(h?.source), score: typeof h?.score === 'number' ? h.score : undefined })),
    ms: typeof r.ms === 'number' ? r.ms : undefined,
    modelIsShown:
      typeof r.the_model_is_shown === 'string' ? r.the_model_is_shown : r.the_model_is_shown == null ? '' : JSON.stringify(r.the_model_is_shown, null, 2),
    query: text(r.query),
  };
}

// Which hits a `min_score` would keep. Scores only exist for sources that give one; a hit without a score is always kept.
export function applyMinScore(hits, minScore) {
  if (typeof minScore !== 'number') return hits.map((h) => ({ ...h, kept: true }));
  return hits.map((h) => ({ ...h, kept: h.score === undefined || h.score >= minScore }));
}

// Plain words for what a score means, from the guide: with the default embeddings related text scores about 0.5 to 0.75 and unrelated
// text below 0.25. Other embeddings differ, so this is a guide and says so.
export function describeScore(score) {
  if (typeof score !== 'number') return '';
  if (score >= 0.5) return 'related';
  if (score >= 0.25) return 'maybe related';
  return 'unrelated';
}

// The same in the words of the page's own check ("What would it find?"), with a tone for its badge.
export function matchWords(score) {
  if (typeof score !== 'number') return { text: '', tone: 'idle' };
  if (score >= 0.5) return { text: 'Close match', tone: 'good' };
  if (score >= 0.25) return { text: 'Might be related', tone: 'warn' };
  return { text: 'Not related', tone: 'idle' };
}

// What a base's index read, against what it lists now: the files added since (they are not in the index), the files the index still holds that were
// taken out, the ones that changed after it was read (the server says so in a problem), and the ones that are not on the server any more. Files only:
// the server names a web page's documents in its own way. With no documents from the server, or none named like a source, nothing is compared.
export function sinceRead(base) {
  const sources = list(base?.sources);
  const files = sources.filter((s) => s.kind === 'file').map((s) => s.label);
  const missing = sources.filter((s) => s.kind === 'file' && s.uploaded === false).map((s) => s.label);
  const changed = list(base?.problems)
    .map((p) => /^The file (.+?) changed after/i.exec(p.problem)?.[1])
    .filter(Boolean);
  const documents = list(base?.index?.documents).map((d) => d.name);
  const listed = new Set(sources.map((s) => s.label));
  const comparable = documents.some((name) => listed.has(name));
  const read = new Set(documents);
  return {
    added: comparable ? files.filter((name) => !read.has(name) && !missing.includes(name)) : [],
    removed: comparable ? documents.filter((name) => !listed.has(name) && !/^https?:\/\//i.test(name)) : [],
    changed,
    missing,
  };
}

const draftKey = (s) => (s?.type === 'url' ? `url:${s.url}` : `file:${s?.file_id}`);
const savedKey = (s) => `${s.kind === 'url' ? 'url' : 'file'}:${s.label}`;

// How far one base of documents and pages is from being something the agent answers from, for the Knowledge page's status line and "Getting it
// ready": { state, names }. state: 'unsaved' (the draft lists other sources than the saved one, or the server has no such base yet) | 'reading' |
// 'missing' (a file it lists is not on the server) | 'failed' | 'unread' (saved, never read) | 'changed' (read, but something changed since) |
// 'ready'. names: the files a 'missing' or 'changed' is about.
//   draftSources: the base's sources in the draft (left out, the saved ones are taken as they are); build: a build followed on this screen
export function readingState(base, { draftSources, build } = {}) {
  if (!base) return { state: 'unsaved', names: [] };
  if (draftSources) {
    const draft = [...new Set(list(draftSources).map(draftKey))].sort();
    const saved = [...new Set(base.sources.map(savedKey))].sort();
    if (draft.join('\n') !== saved.join('\n')) return { state: 'unsaved', names: [] };
  }
  const live = build || base.build;
  if (isBuilding(live)) return { state: 'reading', names: [] };
  const since = sinceRead(base);
  if (since.missing.length) return { state: 'missing', names: since.missing };
  if (live?.status === 'failed') return { state: 'failed', names: [] };
  if (!base.index) return { state: 'unread', names: [] };
  const changed = [...new Set([...since.changed, ...since.added, ...since.removed])];
  if (changed.length || baseState({ ...base, build: live }) === 'stale') return { state: 'changed', names: changed };
  return { state: 'ready', names: [] };
}

// What is set in the config for one base, so the screen can show it next to the scores.
export const settingsOf = (config, baseId) => {
  const base = list(config?.knowledge).find((b) => b?.id === baseId);
  return {
    minScore: typeof base?.retrieval?.min_score === 'number' ? base.retrieval.min_score : undefined,
    topK: typeof base?.top_k === 'number' ? base.top_k : undefined,
    mode: base?.mode || 'tool',
    refresh: typeof base?.refresh === 'string' ? base.refresh : 'manual',
  };
};

// A base set to rebuild on a timer: the server doesn't do that yet (FRONTEND_GUIDE 8 and 10.2), so the screen says so. '' when nothing needs saying.
const EVERY = { hourly: 'every hour', daily: 'every day', weekly: 'every week' };
export function refreshNote(refresh) {
  if (!refresh || refresh === 'manual') return '';
  return `It is set to rebuild ${EVERY[refresh] || `“${refresh}”`}, but the server doesn’t rebuild indexes on a timer yet: press Build after the files or pages change.`;
}

// Adds an uploaded file to a base's sources (once).
export function addFileSource(config, baseId, fileId) {
  const knowledge = list(config?.knowledge);
  const index = knowledge.findIndex((b) => b?.id === baseId);
  if (index < 0 || knowledge[index].type !== 'vector_store') return config;
  const sources = list(knowledge[index].sources);
  if (sources.some((s) => s?.type === 'file' && s.file_id === fileId)) return config;
  const next = knowledge.map((b, i) => (i === index ? { ...b, sources: [...sources, { type: 'file', file_id: fileId }] } : b));
  return { ...config, knowledge: next };
}

// The word for what a build is doing, from its log: the last line.
export const lastLog = (build) => (build?.log?.length ? build.log[build.log.length - 1] : '');
