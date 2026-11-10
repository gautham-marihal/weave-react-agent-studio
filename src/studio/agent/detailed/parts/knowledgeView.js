import { humanize } from '../../../form/engine.js';
import { KNOWLEDGE_ID } from '../../../setup/setupKnowledge.js';

// The pure helpers of Build › Knowledge's index and search (KnowledgeIndex.jsx, KnowledgeSearch.jsx): no React, no
// network, so the tests read them directly.

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// the base the documents belong to: the setup's own, else the first document base
export const docBase = (config) => {
  const all = list(config?.knowledge);
  const own = all.find((b) => isObj(b) && b.id === KNOWLEDGE_ID);
  return own || all.find((b) => isObj(b) && b.type === 'vector_store') || null;
};
// which of the four steps (read, cut, embed, switch in) a build is on: the furthest any log line names. The server's
// words differ ("Indexing the passages", "Embedded 231 passages"); the order doesn't. A step's words are tried from
// the last step back, so "Indexing the passages" is embedding, not cutting.
const STEP_WORDS = [
  [3, /switch|writ|swap|saving the index/],
  [2, /embed|vector|indexing/],
  [1, /passage|chunk|cut|split/],
];
export function buildStep(build) {
  return list(build?.log).reduce((most, line) => {
    const words = String(line).toLowerCase();
    const step = STEP_WORDS.find(([, test]) => test.test(words))?.[0] || 0;
    return Math.max(most, step);
  }, 0);
}

// the bases a search can ask: document bases and search services
export const searchable = (config) => list(config?.knowledge).filter((b) => isObj(b) && b.id && (b.type === 'vector_store' || b.type === 'rag_api'));

// the passages it can search exist: a document base with a file or page, or a search service
export const canSearch = (config) => searchable(config).some((b) => b.type === 'rag_api' || list(b.sources).some((s) => isObj(s) && (s.file_id || s.url)));

// the server's answer, in words that say what to do (its own words otherwise)
export function searchProblem(e, base) {
  if (e?.status === 409 || e?.kind === 'conflict') return 'This base has no index yet, so a search finds nothing. Build it first.';
  if (e?.status === 404 || e?.kind === 'not_found')
    return `Save the draft first: the server searches what is saved, and it doesn’t have “${humanize(base)}” yet.`;
  return e?.message || 'The search didn’t work.';
}
