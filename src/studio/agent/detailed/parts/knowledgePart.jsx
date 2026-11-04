import React, { useState, useSyncExternalStore } from 'react';
import { api } from '../../../../api/client.ts';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { Input } from '../../../../ui/Input.tsx';
import { ACCEPT_ATTRIBUTE, applyMinScore, fileTypeProblem, formatBytes, matchWords, normalizeSearch, settingsOf } from '../../../knowledge/model.js';
import { KNOWLEDGE_ID, addKnowledgeFile, addKnowledgePage, cleanUrl, knowledgeOf, removeKnowledge } from '../../../setup/setupKnowledge.js';
import { agentLabel } from '../../rowNames.js';
import { freshId } from '../../../form/references.js';
import { setPath } from '../schemaFacts.js';

// 3 · Knowledge: what it answers from. The documents and pages are the setup's base (setupKnowledge.js: uploading,
// pages, who reads it); how it searches is that base's settings; "your own search service" is a base of the other
// kind (rag_api). The try-out asks the server what it would find, without saving anything.
//   ctx extra: botId, latest() (the newest draft, for uploads that finish later), onUploaded()

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const bases = (config) => list(config?.knowledge).filter(isObj);
// the base the documents and search settings belong to: the setup's own, else the first document base
const docIndex = (config) => {
  const all = list(config?.knowledge);
  const own = all.findIndex((b) => isObj(b) && b.id === KNOWLEDGE_ID);
  return own >= 0 ? own : all.findIndex((b) => isObj(b) && b.type === 'vector_store');
};
const ragIndex = (config) => list(config?.knowledge).findIndex((b) => isObj(b) && b.type === 'rag_api');

// ---- documents and pages ----------------------------------------------------------------------------------------------

function Upload({ ctx, id }) {
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [problems, setProblems] = useState([]);
  const upload = async (picked) => {
    const chosen = [...picked];
    if (!chosen.length) return;
    setBusy(true);
    const found = [];
    const added = [];
    for (const file of chosen) {
      const bad = fileTypeProblem(file.name);
      if (bad) {
        found.push(bad);
        continue;
      }
      try {
        await api.uploadKnowledgeFile(ctx.botId, file.name, file);
        added.push(file.name);
      } catch (e) {
        found.push(
          e?.status === 413
            ? `“${file.name}” is too big (${formatBytes(file.size)}).`
            : `“${file.name}” didn’t upload: ${e?.message || 'something went wrong'}.`,
        );
      }
    }
    // the newest draft, so files added while others uploaded are kept
    if (added.length) ctx.set(added.reduce((c, name) => addKnowledgeFile(c, name), ctx.latest ? ctx.latest() : ctx.config));
    setProblems(found);
    setBusy(false);
    if (added.length) ctx.onUploaded?.();
  };
  return (
    <>
      <label
        className={`dtDrop ${over ? 'over' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          upload(event.dataTransfer.files);
        }}
      >
        <input
          id={id}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="srOnly"
          disabled={busy}
          onChange={(event) => {
            upload(event.target.files);
            event.target.value = '';
          }}
        />
        <Icon name="paperclip" size={16} />
        <span>{busy ? 'Adding…' : 'Drop files · PDF, text, markdown, HTML, CSV, JSON'}</span>
      </label>
      {problems.map((p) => (
        <small key={p} className="stFieldError" role="alert">
          {p}
        </small>
      ))}
    </>
  );
}

// how far pages are followed (0: the page alone); the same for every page of the base, and for the next one added
const depthOf = (config) => {
  const { pages, depths } = knowledgeOf(config);
  return pages.length ? Math.max(...pages.map((url) => depths[url] || 0)) : 0;
};
function setDepth(config, depth) {
  const at = docIndex(config);
  if (at < 0) return config;
  const sources = list(config.knowledge[at].sources).map((s) => (isObj(s) && s.type === 'url' ? { ...s, crawl_depth: depth } : s));
  return setPath(config, ['knowledge', at, 'sources'], sources);
}

function PageAdd({ ctx, id }) {
  const [page, setPage] = useState('');
  const [problem, setProblem] = useState('');
  const add = () => {
    const url = cleanUrl(page);
    if (!url) {
      setProblem('Type a web address, for example www.example.com/help.');
      return;
    }
    setProblem('');
    ctx.set(setDepth(addKnowledgePage(ctx.config, url), depthOf(ctx.config)));
    setPage('');
  };
  return (
    <>
      <span className="dtInline">
        <Input
          id={id}
          value={page}
          placeholder="https://www.example.com/help"
          onChange={(event) => setPage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" size="small" onClick={add} disabled={!page.trim()}>
          Add
        </Button>
      </span>
      {problem && <small className="stFieldError">{problem}</small>}
    </>
  );
}

function WhatItRead({ ctx, id }) {
  const { files, pages } = knowledgeOf(ctx.config);
  const [refused, setRefused] = useState('');
  const read = ctx.knowledgeRead;
  const stateOf = (name) => {
    const doc = list(read?.files || read?.documents).find((f) => f && (f.name === name || f.file_id === name || f.url === name));
    return doc?.status ? ` · ${String(doc.status).replace(/_/g, ' ')}` : '';
  };
  const remove = (kind, value) => {
    const result = removeKnowledge(ctx.config, kind, value);
    setRefused(result.refused);
    if (!result.refused) ctx.set(result.config);
  };
  if (!files.length && !pages.length) return <span className="dtNote">Nothing yet: until you add some, it answers only from its instructions.</span>;
  return (
    <>
      <div className="dtChips" id={id}>
        <ul aria-label="What it has read">
          {[...files.map((v) => ['file', v]), ...pages.map((v) => ['url', v])].map(([kind, value]) => (
            <li key={`${kind}:${value}`}>
              <span>
                {value}
                {stateOf(value)}
              </span>
              <button type="button" aria-label={`Remove ${value}`} onClick={() => remove(kind, value)}>
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      {refused && (
        <small className="stFieldError" role="alert">
          {refused}
        </small>
      )}
    </>
  );
}

// which agents read the documents in every conversation (each agent's `knowledge` list)
const readersOfBase = (config) => {
  const at = docIndex(config);
  const id = at >= 0 ? config.knowledge[at].id : KNOWLEDGE_ID;
  return list(config?.agents?.items)
    .filter((a) => isObj(a) && list(a.knowledge).includes(id))
    .map((a) => a.id);
};
function setReaders(config, ids) {
  const at = docIndex(config);
  if (at < 0) return config;
  const baseId = config.knowledge[at].id;
  const items = list(config?.agents?.items).map((a) => {
    if (!isObj(a)) return a;
    const has = list(a.knowledge).includes(baseId);
    const want = ids.includes(a.id);
    if (has === want) return a;
    const knowledge = want ? [...list(a.knowledge), baseId] : list(a.knowledge).filter((k) => k !== baseId);
    const next = { ...a, knowledge };
    if (!knowledge.length) delete next.knowledge;
    return next;
  });
  return setPath(config, ['agents', 'items'], items);
}

// ---- the try-out: what it would find ----------------------------------------------------------------------------------
// The question and the passage count are two rows; they share this small store.
let tryState = { query: '', topK: '' };
const listeners = new Set();
const setTry = (change) => {
  tryState = { ...tryState, ...change };
  listeners.forEach((l) => l());
};
const useTry = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => tryState,
  );

function TrySearch({ ctx, id }) {
  const state = useTry();
  const [answer, setAnswer] = useState({ busy: false, error: '', hits: null });
  const at = docIndex(ctx.config);
  const base = at >= 0 ? ctx.config.knowledge[at] : null;
  const run = async (event) => {
    event.preventDefault();
    if (!base || !state.query.trim()) return;
    setAnswer({ busy: true, error: '', hits: null });
    try {
      const raw = await api.searchKnowledge(ctx.botId, base.id, {
        query: state.query.trim(),
        ...(state.topK ? { top_k: Number(state.topK) } : {}),
        ref: 'draft',
      });
      const found = applyMinScore(normalizeSearch(raw).hits, settingsOf(ctx.config, base.id).minScore);
      setAnswer({ busy: false, error: '', hits: found });
    } catch (e) {
      setAnswer({ busy: false, error: e?.message || 'The search failed.', hits: null });
    }
  };
  if (!base) return <span className="dtNote">Add a document or page first.</span>;
  return (
    <>
      <form className="dtInline" onSubmit={run} role="search" aria-label="What would it find?">
        <Input
          id={id}
          value={state.query}
          placeholder="Do you open on Saturdays?"
          onChange={(event) => setTry({ query: event.target.value })}
          maxLength={2000}
        />
        <Button type="submit" size="small" disabled={answer.busy || !state.query.trim()}>
          {answer.busy ? 'Looking…' : 'Find'}
        </Button>
      </form>
      {answer.error && (
        <small className="stFieldError" role="alert">
          {answer.error}
        </small>
      )}
      {answer.hits && (
        <ol className="dtFound" role="status">
          {answer.hits.length === 0 && <li>Nothing it has read matches this.</li>}
          {answer.hits.map((hit, n) => (
            <li key={n} className={hit.kept ? '' : 'left'}>
              <strong>{hit.source || `Passage ${n + 1}`}</strong> <span className="dtNote">{hit.kept ? matchWords(hit.score).text : 'Left out'}</span>
              <p>{hit.text}</p>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
function TryCount({ id }) {
  const state = useTry();
  return (
    <Input
      id={id}
      size="small"
      type="number"
      min="1"
      max="20"
      value={state.topK}
      placeholder="4"
      className="dtNarrow"
      onChange={(event) => setTry({ topK: event.target.value })}
    />
  );
}

// it has something to search: a document or a page
const hasDocs = (config) => {
  const { files, pages } = knowledgeOf(config);
  return files.length + pages.length > 0;
};

// ---- your own search service ------------------------------------------------------------------------------------------
function addSearchService(config) {
  const id = freshId(
    bases(config).map((b) => b.id),
    'search_service',
  );
  return setPath(config, ['knowledge'], [...list(config?.knowledge), { id, type: 'rag_api', connection: '', request: { method: 'POST', path: '/search' } }]);
}
// where a base's setting is in the draft, or null while there is no such base
const doc = (key) => (config) => (docIndex(config) < 0 ? null : ['knowledge', docIndex(config), ...key]);
const rag = (key) => (config) => (ragIndex(config) < 0 ? null : ['knowledge', ragIndex(config), ...key]);
// a row whose path depends on the draft (which base it is): read and written there, and disabled with no base
const based = (where, row) => ({
  ...row,
  pathFor: where,
  disabled: (config) => !where(config),
  get: (config) => (where(config) || []).reduce((v, k) => (v == null ? v : v[k]), where(config) ? config : undefined),
  put: (config, value) => (where(config) ? setPath(config, where(config), value === '' ? undefined : value) : config),
});

export const knowledgePart = {
  id: 'knowledge',
  num: '3',
  title: 'Knowledge',
  question: 'What does it know? Documents and pages first; how it searches is one card, not a separate tab.',
  cols: [
    [
      {
        id: 'docs',
        title: 'Documents and pages',
        lead: 'What it answers from. Uploading starts reading at once.',
        rows: [
          { id: 'upload', label: 'Upload documents', render: (c) => <Upload ctx={c} id={c.id} /> },
          { id: 'page', label: 'A web page', render: (c) => <PageAdd ctx={c} id={c.id} /> },
          {
            id: 'depth',
            label: 'Follow links on the page',
            kind: 'num',
            unit: 'levels, 0 to 5',
            min: 0,
            max: 5,
            integer: true,
            get: depthOf,
            put: (c, v) => setDepth(c, v ?? 0),
          },
          { id: 'read', label: 'What it has read', hint: 'Remove any of them here', errPath: ['knowledge'], render: (c) => <WhatItRead ctx={c} id={c.id} /> },
          {
            id: 'readers',
            label: 'Which agents read it',
            hint: 'Was set from each subagent',
            kind: 'multi',
            options: (config) =>
              list(config?.agents?.items)
                .filter(isObj)
                .map((a) => ({ value: a.id, label: agentLabel(config, a.id) })),
            get: readersOfBase,
            put: setReaders,
          },
        ],
      },
      {
        id: 'try',
        title: 'Try a search',
        waiting: (c) => (hasDocs(c.config) ? '' : 'Add a document or a web page above first, then try what a caller might ask.'),
        lead: 'See what it would find before a caller asks.',
        rows: [
          {
            id: 'ask',
            label: 'Something a caller might ask',
            hint: 'Shows the passages it would find',
            tags: 'p',
            render: (c) => <TrySearch ctx={c} id={c.id} />,
          },
          { id: 'count', label: 'Passages to ask for', tags: 'p', render: (c) => <TryCount id={c.id} /> },
        ],
      },
    ],
    [
      {
        id: 'search',
        title: 'How it searches',
        waiting: (c) => (hasDocs(c.config) ? '' : 'Its search settings appear once it has a document or web page to search.'),
        rows: [
          based(doc(['mode']), {
            id: 'mode',
            label: 'When it searches',
            kind: 'ch',
            options: [
              { value: 'tool', label: 'When the model decides' },
              { value: 'inject', label: 'On every caller turn' },
            ],
          }),
          based(doc(['top_k']), { id: 'topk', label: 'How many results', kind: 'num', unit: '1 to 20', min: 1, max: 20, integer: true }),
          based(doc(['retrieval', 'query_from']), {
            id: 'from',
            label: 'What is searched for',
            kind: 'ch',
            options: [
              { value: 'last_exchange', label: 'The last reply and the newest words' },
              { value: 'last_user', label: 'Only the caller’s newest words' },
            ],
          }),
          based(doc(['retrieval', 'min_score']), { id: 'score', label: 'How closely a passage must match', kind: 'num' }),
          based(doc(['retrieval', 'max_chars']), { id: 'chars', label: 'Most text per search', kind: 'num', unit: 'characters', integer: true }),
          based(doc(['retrieval', 'timeout_s']), { id: 'timeout', label: 'Give up after', kind: 'num', unit: 'seconds, up to 30', max: 30 }),
          based(doc(['retrieval', 'strip_markdown']), { id: 'strip', label: 'Remove formatting symbols', kind: 'sw' }),
          based(doc(['refresh']), {
            id: 'refresh',
            label: 'Rebuild it',
            kind: 'ch',
            options: [
              { value: 'manual', label: 'Only when I rebuild it' },
              { value: 'hourly', label: 'Every hour' },
              { value: 'daily', label: 'Every day' },
              { value: 'weekly', label: 'Every week' },
            ],
          }),
        ],
        adv: [
          based(doc(['retrieval', 'role']), {
            id: 'role',
            label: 'How passages are shown',
            kind: 'ch',
            options: [
              { value: 'system', label: 'As an instruction' },
              { value: 'assistant', label: 'As the bot’s own earlier note' },
            ],
          }),
          based(doc(['retrieval', 'instruction']), { id: 'lead', label: 'Lead-in sentence', kind: 'long', rows: 2 }),
          based(doc(['chunking', 'size']), { id: 'size', label: 'Passage length', kind: 'num', unit: '200 to 4000', integer: true }),
          based(doc(['chunking', 'overlap']), { id: 'overlap', label: 'Overlap', kind: 'num', integer: true }),
          based(doc(['embedding', 'model']), { id: 'embed', label: 'Search model', kind: 'text' }),
        ],
      },
      {
        id: 'rag',
        title: 'Or your own search service',
        lead: 'Instead of documents here: a search API you already run.',
        body: (c) =>
          ragIndex(c.config) < 0 ? (
            <div className="dtCardAction">
              <Button type="button" size="small" variant="secondary" onClick={() => c.set(addSearchService(c.config))}>
                Use a search service
              </Button>
            </div>
          ) : null,
        rows: [
          based(rag(['connection']), {
            id: 'connection',
            label: 'Connection',
            tags: 'r',
            kind: 'pick',
            // the connections set up on the Connections part
            options: (config) => Object.keys(isObj(config?.connections) ? config.connections : {}).map((k) => ({ value: k, label: k })),
            placeholder: 'Choose a connection…',
          }),
          based(rag(['collection']), { id: 'collection', label: 'Collection', kind: 'text' }),
          based(rag(['request']), { id: 'request', label: 'The request', hint: 'Method, path, query, headers, body', tags: 'r', kind: 'form' }),
        ],
        adv: [based(rag(['response']), { id: 'response', label: 'Reading the answer: items, text, source, score', kind: 'form' })],
      },
    ],
  ],
};
