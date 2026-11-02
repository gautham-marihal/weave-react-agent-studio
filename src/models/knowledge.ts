// Knowledge: the files and web pages an agent answers from. A `vector_store` base is searched from an INDEX built before
// calls (upload, build, check a search); a `rag_api` base asks a search service you already run (nothing to build).
// Reads the server's knowledge, status, build and search answers tolerantly (odd fields are skipped) and says in words
// what a base needs. Shared by the agent's Build › Knowledge and the workspace Knowledge page. Pure: no network, no DOM.
import type { AgentConfig, AgentRole, ToolDefinition } from '../types/studio';
import { entryIndex, freshId } from './setup';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T = unknown,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const text = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const num = (v: unknown): number | undefined => (typeof v === 'number' && !Number.isNaN(v) ? v : undefined);
const together = (words: string[]) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0] ?? '');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** An id in words: "clinic_policies" -> "Clinic policies". */
export function humanize(id: string): string {
  const words = String(id || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.\s]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : '';
}

/** An agent by its own name, else the agent's name when it is the only one, else its id in words. */
export function agentLabel(config: AgentConfig | null | undefined, id: string): string {
  const agents = list<AgentRole>(config?.agents?.items).filter(isObj);
  const agent = agents.find((a) => a.id === id);
  if (typeof agent?.name === 'string' && agent.name.trim()) return agent.name.trim();
  if (agent && agents.length === 1 && typeof config?.meta?.name === 'string' && config.meta.name.trim()) return config.meta.name.trim();
  return humanize(id);
}

// ---- files ------------------------------------------------------------------------------------------------------------
/** The kinds of file a knowledge base can read (the API refuses others with a 400). */
export const ACCEPTED_EXTENSIONS = ['.txt', '.md', '.markdown', '.html', '.htm', '.pdf', '.csv', '.json'];
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.join(',');

/** Why a file can't be read by knowledge ('' when it can). */
export const fileTypeProblem = (name: string): string =>
  ACCEPTED_EXTENSIONS.some((ext) => String(name || '').toLowerCase().endsWith(ext))
    ? ''
    : `“${name}” isn’t a kind of file knowledge can read. Use text, markdown, HTML, PDF, CSV or JSON (${ACCEPTED_EXTENSIONS.join(', ')}).`;

/** A size in plain words: "512 B", "2.0 KB", "200 KB", "5.0 MB" ('' when unknown). */
export function sizeInWords(bytes: unknown): string {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** Who reads something, as the server says it (`used_by`: a list, or `{ agents, tools }`), in words. */
export function usedByInWords(usedBy: unknown): string {
  const names = Array.isArray(usedBy)
    ? usedBy.map(text)
    : isObj(usedBy)
      ? [...list(usedBy.agents), ...list(usedBy.tools)].map(text)
      : typeof usedBy === 'string' && usedBy.trim()
        ? [usedBy]
        : [];
  return names.filter(Boolean).join(', ') || 'Nothing yet';
}

// ---- a build job -------------------------------------------------------------------------------------------------------
export type BuildStatus = 'running' | 'done' | 'failed';
export interface KnowledgeBuild {
  id: string;
  status: BuildStatus;
  log: string[];
  passages?: number;
  error: string;
  startedAt: string;
  finishedAt: string;
}

export function normalizeBuild(raw: unknown): KnowledgeBuild | null {
  if (!isObj(raw)) return null;
  const result = isObj(raw.result) ? raw.result : null;
  const status: BuildStatus = raw.status === 'running' || raw.status === 'done' || raw.status === 'failed' ? raw.status : raw.error ? 'failed' : result ? 'done' : 'running';
  return {
    id: text(raw.id),
    status,
    log: list(raw.log).map(text).filter(Boolean),
    passages: num(result?.passages) ?? num(raw.passages),
    error: text(raw.error),
    startedAt: text(raw.started_at || raw.created_at),
    finishedAt: text(raw.finished_at || raw.ended_at),
  };
}
export const isBuilding = (build: KnowledgeBuild | null | undefined): boolean => build?.status === 'running';
/** What a build is doing, from its log: the last line. */
export const lastLog = (build: KnowledgeBuild | null | undefined): string => (build?.log.length ? build.log[build.log.length - 1] : '');

// ---- one base ----------------------------------------------------------------------------------------------------------
export interface KnowledgeSource {
  kind: 'file' | 'url';
  label: string;
  uploaded?: boolean;
}
export interface KnowledgeIndex {
  builtAt: string;
  passages: number;
  embedding: string;
  documents: { name: string; passages?: number }[];
}
export interface KnowledgeProblem {
  problem: string;
  fix: string;
}
export interface KnowledgeBaseView {
  id: string;
  type: string;
  mode: string;
  usedBy: { agents: string[]; tools: string[] };
  sources: KnowledgeSource[];
  index: KnowledgeIndex | null;
  build: KnowledgeBuild | null;
  problems: KnowledgeProblem[];
  keyAvailable: boolean;
  buildable: boolean;
}

export function normalizeBase(raw: unknown, keyAvailable = true): KnowledgeBaseView {
  const b = isObj(raw) ? raw : {};
  const type = text(b.type);
  const idx = isObj(b.index) ? b.index : null;
  const embedding = idx && isObj(idx.embedding) ? `${text(idx.embedding.provider)} ${text(idx.embedding.model)}`.trim() : text(idx?.embedding);
  const usedBy = isObj(b.used_by) ? b.used_by : {};
  return {
    id: text(b.id),
    type,
    mode: text(b.mode) || 'tool',
    usedBy: { agents: list(usedBy.agents).map(text), tools: list(usedBy.tools).map(text) },
    sources: list(b.sources).map((s): KnowledgeSource => {
      const src = isObj(s) ? s : {};
      if (src.type === 'url') return { kind: 'url', label: text(src.url) };
      return { kind: 'file', label: typeof s === 'string' ? s : text(src.file_id || src.name), uploaded: typeof src.uploaded === 'boolean' ? src.uploaded : undefined };
    }),
    index: idx
      ? {
          builtAt: text(idx.built_at),
          passages: num(idx.passages) ?? 0,
          embedding,
          documents: list(idx.documents).map((d) =>
            typeof d === 'string' ? { name: d, passages: undefined } : { name: text(isObj(d) ? d.name || d.source || d.file : ''), passages: isObj(d) ? num(d.passages) : undefined }
          ),
        }
      : null,
    build: normalizeBuild(b.build),
    problems: list(b.problems)
      .map((p) => (typeof p === 'string' ? { problem: p, fix: '' } : { problem: text(isObj(p) ? p.problem : ''), fix: text(isObj(p) ? p.fix : '') }))
      .filter((p) => p.problem),
    keyAvailable: typeof b.embedding_key_available === 'boolean' ? b.embedding_key_available : keyAvailable,
    buildable: type === 'vector_store',
  };
}

export type BaseState = 'external' | 'building' | 'not_built' | 'stale' | 'failed' | 'ready';

/** Where a base stands: nothing to build (external), building, never built, out of date, last build failed, ready. */
export function baseState(base: KnowledgeBaseView): BaseState {
  if (!base.buildable) return 'external';
  if (isBuilding(base.build)) return 'building';
  // the last build failed: said even when an older index still answers, never "Ready"
  if (base.build?.status === 'failed') return 'failed';
  if (!base.index) return 'not_built';
  if (base.problems.some((p) => /changed after|stale|out of date|not uploaded/i.test(p.problem))) return 'stale';
  return 'ready';
}

export const STATE_TEXT: Record<BaseState, { label: string; tone: 'neutral' | 'info' | 'warning' | 'danger' | 'success'; hint: string }> = {
  external: { label: 'Your own search', tone: 'neutral', hint: 'It asks a search service you already run. Nothing is built here.' },
  building: { label: 'Building', tone: 'info', hint: 'An index is being built. The old one keeps answering until the new one is ready.' },
  not_built: { label: 'Not built', tone: 'danger', hint: 'No index has been built, so searches find nothing.' },
  stale: { label: 'Needs rebuilding', tone: 'warning', hint: 'A file changed or is missing since the index was built.' },
  failed: { label: 'Build failed', tone: 'danger', hint: 'The last build failed. The old index (if there was one) keeps answering.' },
  ready: { label: 'Ready', tone: 'success', hint: 'The index is built and current.' },
};

// The server's `fix` is sometimes an operator command line (`python -m …`), meaningless in a browser: it is hidden; the
// problem stays, and the screen's own button (Build, Upload) says what to do.
const COMMAND_LINE = /(^|[\s`'"(])(python3?|pip3?|npm|npx|curl|docker|\.\/\S+)\s+\S|^\s*\$\s|\s-m\s+[\w.]+/i;
export function readableFix(problem: Partial<KnowledgeProblem> | null | undefined): string {
  const fix = text(problem?.fix).trim();
  return fix && !COMMAND_LINE.test(fix) ? fix : '';
}

/** The button a problem's fix calls for: build (re-)indexes, upload adds a file, '' for none. */
export function fixActionFor(problem: KnowledgeProblem): 'build' | 'upload' | '' {
  const p = `${problem.problem} ${problem.fix}`.toLowerCase();
  if (/no index has been built|changed after|stale|rebuild|build the index/.test(p)) return 'build';
  if (/not uploaded|upload/.test(p)) return 'upload';
  return '';
}

// ---- the whole answer --------------------------------------------------------------------------------------------------
export interface KnowledgeFileView {
  name: string;
  size?: number;
  modified: string;
  usedBy: string[];
}
export interface KnowledgeRead {
  ref: string;
  bases: KnowledgeBaseView[];
  files: KnowledgeFileView[];
  keyAvailable: boolean;
}

export const normalizeFiles = (raw: unknown): KnowledgeFileView[] =>
  list(raw)
    .filter(isObj)
    .map((f) => ({ name: text(f.name), size: num(f.size), modified: text(f.modified), usedBy: list(f.used_by).map(text) }))
    .filter((f) => f.name);

/** GET /bots/{id}/knowledge: `{ bases, files }` or a bare list of bases. */
export function normalizeKnowledge(raw: unknown): KnowledgeRead {
  const r: Json = Array.isArray(raw) ? { bases: raw } : isObj(raw) ? raw : {};
  const keyAvailable = r.embedding_key_available !== false;
  const bases = list(r.bases).map((b) => normalizeBase(b, keyAvailable));
  return { ref: text(r.ref), bases, files: normalizeFiles(r.files), keyAvailable: keyAvailable && bases.every((b) => b.keyAvailable !== false) };
}

/** How many bases need attention, for one-line summaries. */
export function knowledgeSummary(knowledge: Pick<KnowledgeRead, 'bases'> | null | undefined) {
  const bases = list<KnowledgeBaseView>(knowledge?.bases);
  const states = bases.map(baseState);
  return {
    total: bases.length,
    needsBuild: states.filter((s) => s === 'not_built' || s === 'stale' || s === 'failed').length,
    building: states.filter((s) => s === 'building').length,
    ready: states.filter((s) => s === 'ready' || s === 'external').length,
    problems: bases.reduce((n, b) => n + b.problems.length, 0),
  };
}

// ---- a search ----------------------------------------------------------------------------------------------------------
export interface SearchHit {
  text: string;
  source: string;
  score?: number;
}
export interface SearchAnswer {
  hits: SearchHit[];
  ms?: number;
  modelIsShown: string;
  query: string;
}

export function normalizeSearch(raw: unknown): SearchAnswer {
  const r = isObj(raw) ? raw : {};
  const shown = r.the_model_is_shown;
  return {
    hits: list(r.hits).map((h) => ({ text: text(isObj(h) ? h.text : h), source: text(isObj(h) ? h.source : ''), score: isObj(h) ? num(h.score) : undefined })),
    ms: num(r.ms),
    modelIsShown: typeof shown === 'string' ? shown : shown === null || shown === undefined ? '' : JSON.stringify(shown, null, 2),
    query: text(r.query_used ?? r.query),
  };
}

/** Which hits a `min_score` would keep. Only some sources give scores; a hit without a score is always kept. */
export function applyMinScore<T extends SearchHit>(hits: T[], minScore: number | undefined): (T & { kept: boolean })[] {
  if (typeof minScore !== 'number') return hits.map((h) => ({ ...h, kept: true }));
  return hits.map((h) => ({ ...h, kept: h.score === undefined || h.score >= minScore }));
}

// With the default embeddings related text scores about 0.5–0.75 and unrelated below 0.25. Other embeddings differ, so
// this is a guide and says so.
export function describeScore(score: number | undefined): string {
  if (typeof score !== 'number') return '';
  if (score >= 0.5) return 'related';
  if (score >= 0.25) return 'maybe related';
  return 'unrelated';
}
export function matchWords(score: number | undefined): { text: string; tone: 'good' | 'warn' | 'idle' } {
  if (typeof score !== 'number') return { text: '', tone: 'idle' };
  if (score >= 0.5) return { text: 'Close match', tone: 'good' };
  if (score >= 0.25) return { text: 'Might be related', tone: 'warn' };
  return { text: 'Not related', tone: 'idle' };
}

// ---- what changed since a base was read --------------------------------------------------------------------------------
/** Files added since the index was read, ones it still holds that were taken out, ones changed or gone from the server. */
export function sinceRead(base: KnowledgeBaseView | null | undefined) {
  const sources = list<KnowledgeSource>(base?.sources);
  const files = sources.filter((s) => s.kind === 'file').map((s) => s.label);
  const missing = sources.filter((s) => s.kind === 'file' && s.uploaded === false).map((s) => s.label);
  const changed = list<KnowledgeProblem>(base?.problems)
    .map((p) => /^The file (.+?) changed after/i.exec(p.problem)?.[1])
    .filter((n): n is string => !!n);
  const documents = list<{ name: string }>(base?.index?.documents).map((d) => d.name);
  const listed = new Set(sources.map((s) => s.label));
  // documents the server names its own way are not compared (no false "changed")
  const comparable = documents.some((name) => listed.has(name));
  const read = new Set(documents);
  return {
    added: comparable ? files.filter((name) => !read.has(name) && !missing.includes(name)) : [],
    removed: comparable ? documents.filter((name) => !listed.has(name) && !/^https?:\/\//i.test(name)) : [],
    changed,
    missing,
  };
}

export type ReadingState = 'unsaved' | 'reading' | 'missing' | 'failed' | 'unread' | 'changed' | 'ready';
const draftKey = (s: unknown) => (isObj(s) && s.type === 'url' ? `url:${text(s.url)}` : `file:${text(isObj(s) ? s.file_id : '')}`);
const savedKey = (s: KnowledgeSource) => `${s.kind}:${s.label}`;

/**
 * How far one base is from being answerable: { state, names }. 'unsaved' when the draft lists other sources than the
 * saved base (or the server has no such base); `names` are the files a 'missing' or 'changed' is about.
 *   draftSources: the base's sources in the editor; build: a build followed on this screen (wins over the server's)
 */
export function readingState(
  base: KnowledgeBaseView | null | undefined,
  { draftSources, build }: { draftSources?: unknown[]; build?: KnowledgeBuild | null } = {}
): { state: ReadingState; names: string[] } {
  if (!base) return { state: 'unsaved', names: [] };
  if (draftSources) {
    const draft = [...new Set(draftSources.map(draftKey))].sort();
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

// ---- the base's settings in the draft ----------------------------------------------------------------------------------
interface DraftBase {
  id?: string;
  type?: string;
  mode?: string;
  top_k?: number;
  refresh?: string;
  retrieval?: { min_score?: number; query_from?: string; instruction?: string };
  sources?: unknown[];
  [key: string]: unknown;
}
const draftBases = (config: AgentConfig | null | undefined) => list<DraftBase>(config?.knowledge).filter((b): b is DraftBase => isObj(b));
export const draftBase = (config: AgentConfig | null | undefined, baseId: string) => draftBases(config).find((b) => b.id === baseId);

/** What is set in the draft for one base, so the screen can show it next to the scores. */
export function settingsOf(config: AgentConfig | null | undefined, baseId: string) {
  const base = draftBase(config, baseId);
  return {
    minScore: num(base?.retrieval?.min_score),
    topK: num(base?.top_k),
    mode: base?.mode || 'tool',
    refresh: typeof base?.refresh === 'string' ? base.refresh : 'manual',
  };
}

/** A base set to rebuild on a timer: the server can't yet, so the screen says so; '' otherwise. */
const EVERY: Record<string, string> = { hourly: 'every hour', daily: 'every day', weekly: 'every week' };
export function refreshNote(refresh: string | undefined): string {
  if (!refresh || refresh === 'manual') return '';
  return `It is set to rebuild ${EVERY[refresh] || `“${refresh}”`}, but the server doesn’t rebuild indexes on a timer yet: build again after the files or pages change.`;
}

// ---- who reads a base --------------------------------------------------------------------------------------------------
/** The agents that read a base (in their knowledge, or through a knowledge tool) and the tools that search it. */
export function readersOf(config: AgentConfig | null | undefined, baseId: string): { agents: string[]; tools: string[] } {
  const toolIds = list<ToolDefinition>(config?.tools)
    .filter((t) => isObj(t) && String(t.type) === 'knowledge' && (t as Json).source === baseId)
    .map((t) => t.id);
  return {
    agents: list<AgentRole>(config?.agents?.items)
      .filter((a) => isObj(a) && (list(a.knowledge).includes(baseId) || list<string>(a.tools).some((id) => toolIds.includes(id))))
      .map((a) => a.id),
    tools: toolIds,
  };
}

/** readersOf in a sentence, e.g. "Read by Billing in every conversation." ('' when nothing uses it). */
export function readersInWords(config: AgentConfig | null | undefined, baseId: string): string {
  const { tools } = readersOf(config, baseId);
  const agents = list<AgentRole>(config?.agents?.items).filter(isObj);
  const every = agents.filter((a) => list(a.knowledge).includes(baseId)).map((a) => agentLabel(config, a.id));
  const toolWords = tools.map((id) => {
    const users = agents.filter((a) => list(a.tools).includes(id));
    const by = users.length ? ` (${together(users.map((a) => agentLabel(config, a.id)))})` : ' (no agent has it yet)';
    return `the “${humanize(id)}” tool${by}`;
  });
  return [every.length ? `Read by ${together(every)} in every conversation.` : '', toolWords.length ? `Looked up with ${together(toolWords)}.` : '']
    .filter(Boolean)
    .join(' ');
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * "Let <agent> use it": gives a base to the agent that answers first. A base read on every turn ("inject") goes in its
 * knowledge; one looked up ("tool") gets a knowledge tool (reusing one that already searches it). Unchanged when it is
 * already read, or there is no such base or agent.
 */
export function attachBase(config: AgentConfig, baseId: string): AgentConfig {
  const base = draftBase(config, baseId);
  const index = entryIndex(config);
  if (!base || index < 0 || !isObj(config.agents?.items?.[index])) return config;
  const next = clone(config);
  const agent = (next.agents?.items as AgentRole[])[index];
  if ((base.mode || 'tool') === 'inject') {
    if (list(agent.knowledge).includes(baseId)) return config;
    agent.knowledge = [...list<string>(agent.knowledge), baseId];
    return next;
  }
  let tool = list<ToolDefinition>(next.tools).find((t) => isObj(t) && String(t.type) === 'knowledge' && (t as Json).source === baseId);
  if (!tool) {
    const taken = [...list<ToolDefinition>(next.tools).map((t) => t?.id), ...list<AgentRole>(next.agents?.items).flatMap((a) => list<string>(a?.tools))];
    tool = {
      id: freshId(taken, `search_${baseId}`),
      type: 'knowledge' as ToolDefinition['type'],
      source: baseId,
      description: `Search ${humanize(baseId).toLowerCase()} when the caller asks something it may answer.`,
    };
    next.tools = [...list<ToolDefinition>(next.tools), tool];
  }
  if (list(agent.tools).includes(tool.id)) return config;
  agent.tools = [...list<string>(agent.tools), tool.id];
  return next;
}

/** Adds an uploaded file to a base's sources (once). */
export function addFileSource(config: AgentConfig, baseId: string, fileId: string): AgentConfig {
  const knowledge = list<DraftBase>(config?.knowledge);
  const index = knowledge.findIndex((b) => b?.id === baseId);
  if (index < 0 || knowledge[index].type !== 'vector_store') return config;
  const sources = list(knowledge[index].sources);
  if (sources.some((s) => isObj(s) && s.type === 'file' && s.file_id === fileId)) return config;
  return { ...config, knowledge: knowledge.map((b, i) => (i === index ? { ...b, sources: [...sources, { type: 'file', file_id: fileId }] } : b)) };
}

/** A new base (looked up when needed) made from one uploaded file, with an id from the file's name. -> { config, id } */
export function addBaseFromFile(config: AgentConfig, fileName: string): { config: AgentConfig; id: string } {
  const slug =
    fileName
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'knowledge';
  const id = freshId(draftBases(config).map((b) => b.id), slug);
  const base = { id, type: 'vector_store', mode: 'tool', sources: [{ type: 'file', file_id: fileName }] };
  return { config: { ...config, knowledge: [...list(config?.knowledge), base] }, id };
}

// ---- how it searches ---------------------------------------------------------------------------------------------------
/**
 * How a base is searched, in sentences: when (before every reply, or when the model asks through a tool), how many
 * passages, which scores are dropped, and how follow-up questions are searched. From the draft.
 */
export function howItSearches(config: AgentConfig | null | undefined, baseId: string): string[] {
  const base = draftBase(config, baseId);
  if (!base) return ['This base is not in the draft any more, so nothing searches it once the draft is saved.'];
  const external = base.type !== 'vector_store';
  const s = settingsOf(config, baseId);
  const lines: string[] = [];
  lines.push(
    s.mode === 'inject'
      ? 'It is searched before every reply, with what the caller just said, and the passages found are given to the model with its instructions.'
      : 'It is searched only when the model decides to look something up, through a knowledge tool given to the agent.'
  );
  lines.push(
    external
      ? 'It asks your own search service, which decides how many results come back and how they are scored.'
      : `It asks for ${s.topK !== undefined ? plural(s.topK, 'passage') : 'the server’s usual number of passages (4)'} each time.`
  );
  if (!external)
    lines.push(
      s.minScore !== undefined
        ? `Passages scoring under ${s.minScore} are dropped, so a weak match is never shown to the model.`
        : 'No minimum score is set, so every passage found is given to the model, however weak.'
    );
  if (s.mode === 'inject' && base.retrieval?.query_from === 'last_user') lines.push('Only the caller’s last words are searched, not the agent’s reply before them.');
  else if (s.mode === 'inject') lines.push('A short follow-up (“how much is that?”) is searched together with the agent’s last reply, so it keeps its subject.');
  return lines;
}
