// Build › Knowledge in plain words: what it answers from, when and how it searches, and what the shelf says about each
// document and page. Pure: no React, no DOM, so the tests run it in Node.
//
// Facts it relies on (FRONTEND_GUIDE 5, 10.2; agent-config-guide 1, 2.11 and 3.20; the schema):
// - a base is searched on every caller turn (`inject`) or when the model decides (`tool`, the schema's default; the
//   first document a new agent gets sets up an `inject` base); `top_k` is 4 unless set; with no `min_score` every
//   passage found is kept; a search gives up after 3 s and brings at most 4,000 characters unless set;
// - building is only started by a press, from what is saved; the last index keeps answering until a new one is ready.

import { baseReaders, knowledgeOf } from '../../../setup/setupKnowledge.js';
import { agentLabel } from '../../rowNames.js';
import { sinceRead } from '../../../knowledge/model.js';
import { docBase } from '../parts/knowledgeView.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const together = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

export const USUAL = { topK: 4, maxChars: 4000, timeout: 3 };
// the way a new agent's first document is searched (setupKnowledge.js makes an "inject" base)
const FIRST_MODE = 'inject';

// a search service of its own (rag_api), if it has one
const ragBase = (config) => list(config?.knowledge).find((b) => isObj(b) && b.type === 'rag_api') || null;

// held: how it will search, chosen before there is a base to keep it in (pendingSearch.js)
export function readKnowledge(config, held = null) {
  const base = docBase(config);
  const { files, pages, depths } = knowledgeOf(config);
  const r = isObj(base?.retrieval) ? base.retrieval : {};
  return {
    hasBase: !!base,
    baseId: base?.id || '',
    files,
    pages,
    depth: pages.length ? Math.max(...pages.map((u) => depths[u] || 0)) : 0,
    mode: base ? base.mode || 'tool' : held?.mode || FIRST_MODE,
    topK: num(base ? base.top_k : held?.top_k) ?? USUAL.topK,
    topKSet: num(base?.top_k) !== null,
    minScore: num(r.min_score),
    queryFrom: r.query_from === 'last_user' ? 'last_user' : 'last_exchange',
    maxChars: num(r.max_chars) ?? USUAL.maxChars,
    timeout: num(r.timeout_s) ?? USUAL.timeout,
    readers: base ? baseReaders(config, base.id) : [],
    rag: ragBase(config),
  };
}

// ---- the sentence -------------------------------------------------------------------------------------------------
const modeWords = (mode) => (mode === 'inject' ? 'on every caller turn' : 'when it decides it needs to');
const topKWords = (k) => (k === 1 ? 'the best passage' : `the ${k} best passages`);
export function sentenceParts(config, held = null) {
  const k = readKnowledge(config, held);
  return {
    docs: k.files.length ? plural(k.files.length, 'document') : '',
    pages: k.pages.length ? plural(k.pages.length, 'web page') : '',
    mode: modeWords(k.mode),
    topk: topKWords(k.topK),
  };
}

// ---- the chapters' lines --------------------------------------------------------------------------------------------
// what the server says about the files since the last build ({ changed, missing }), when it has said
function fileNews(config, knowledgeRead) {
  const base = docBase(config);
  const known = base && knowledgeRead ? list(knowledgeRead.bases).find((b) => b.id === base.id) : null;
  return known ? sinceRead(known) : { changed: [], missing: [] };
}

export function linesOf(config, knowledgeRead, held = null) {
  const k = readKnowledge(config, held);
  const news = fileNews(config, knowledgeRead);
  const docNote = news.missing.length
    ? `${plural(news.missing.length, 'file')} not uploaded`
    : news.changed.length
      ? `${news.changed.length} changed since the last build`
      : '';
  const readers = k.readers.map((id) => agentLabel(config, id));
  return {
    documents: { value: k.files.length ? plural(k.files.length, 'file') : 'None yet', note: docNote, empty: !k.files.length },
    pages: {
      value: k.pages.length ? plural(k.pages.length, 'address', 'addresses') : 'None yet',
      note: k.pages.length ? (k.depth ? `follows links ${plural(k.depth, 'level')} deep` : 'the pages alone') : '',
      empty: !k.pages.length,
    },
    readers: {
      value: readers.length ? together(readers) : k.hasBase ? 'No agent yet' : 'The agent that answers',
      note: k.hasBase ? modeWords(k.mode) : 'once there is something to read',
      empty: !readers.length,
    },
    when: {
      value: k.mode === 'inject' ? 'On every caller turn' : 'When it decides it needs to',
      note: k.mode === 'inject' ? `the caller waits up to ${k.timeout} s for it` : 'through a search tool',
    },
    // what is searched for is chosen only when it searches every turn; otherwise the AI writes each search itself
    from:
      k.mode === 'inject'
        ? k.queryFrom === 'last_user'
          ? { value: 'Only the caller’s newest words', note: 'a follow-up may lose its subject' }
          : { value: 'The last reply and the newest words', note: 'a follow-up keeps its subject' }
        : { value: 'What the AI asks for', note: 'it writes each search itself', fixed: true },
    many: { value: k.topK === 1 ? 'The best one' : `The ${k.topK} best`, note: `at most ${k.maxChars.toLocaleString('en-GB')} characters` },
    close:
      k.minScore === null
        ? { value: 'Every match', note: 'no line set', empty: true }
        : { value: matchName(k.minScore), note: `${k.minScore.toFixed(2)} and up` },
  };
}

// a line on the 0-to-1 score scale, in words (with the usual search model, related text scores about 0.5 to 0.75 and
// unrelated text below 0.25: FRONTEND_GUIDE 10.2)
export function matchName(score) {
  if (score >= 0.75) return 'Close matches only';
  if (score >= 0.5) return 'Related or closer';
  if (score >= 0.25) return 'Fair or better';
  return 'Almost every match';
}

// of the passages a try-out found, how many a line keeps
export const keptBy = (hits, line) => list(hits).filter((h) => typeof h?.score !== 'number' || line === null || h.score >= line).length;

// the hero's line under the name: what it reads and who reads it
export function summaryLine(config) {
  const k = readKnowledge(config);
  const parts = [k.files.length && plural(k.files.length, 'document'), k.pages.length && plural(k.pages.length, 'web page')].filter(Boolean);
  if (!parts.length) return k.rag ? 'Answers from your own search service' : 'Nothing to read yet';
  const readers = k.readers.map((id) => agentLabel(config, id));
  return `${parts.join(' · ')}${readers.length ? ` · read by ${together(readers)}` : ''}`;
}
