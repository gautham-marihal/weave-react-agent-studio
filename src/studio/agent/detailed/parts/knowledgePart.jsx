import React, { useState } from 'react';
import { api } from '../../../../api/client.ts';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { Input } from '../../../../ui/Input.tsx';
import { ACCEPT_ATTRIBUTE, fileTypeProblem, formatBytes } from '../../../knowledge/model.js';
import {
  KNOWLEDGE_ID,
  addKnowledgeFile,
  addKnowledgePage,
  baseReaders,
  cleanUrl,
  knowledgeOf,
  lookedUpWith,
  setBaseMode,
  setBaseReaders,
} from '../../../setup/setupKnowledge.js';
import { agentLabel } from '../../rowNames.js';
import { freshId } from '../../../form/references.js';
import { setPath } from '../schemaFacts.js';
import { refChoices } from '../../../form/engine.js';
import { IndexRow, SourceCards } from './KnowledgeIndex.jsx';
import KnowledgeSearch from './KnowledgeSearch.jsx';
import { notRunAt } from '../../../preflight.ts';
import { canSearch } from './knowledgeView.js';
import { KnowledgeGlance } from '../Glance.jsx';

// 3 · Knowledge: what it answers from. The documents and pages are the setup's base (setupKnowledge.js: uploading,
// pages, who reads it), and its search index is built and followed here (KnowledgeIndex.jsx); how it searches is that
// base's settings; "your own search service" is a base of the other kind (rag_api). The try-out (KnowledgeSearch.jsx)
// asks the server what it would find, without saving anything.
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

// which agents read the documents in every conversation (each agent's `knowledge` list)
// which agents read the documents, set the one way the base's mode allows (setupKnowledge.js, agent config guide 2.11)
const docBaseId = (config) => (docIndex(config) >= 0 ? config.knowledge[docIndex(config)].id : '');
const readersOfBase = (config) => (docBaseId(config) ? baseReaders(config, docBaseId(config)) : []);
const setReaders = (config, ids) => (docBaseId(config) ? setBaseReaders(config, docBaseId(config), ids) : config);

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
  question: 'The documents and web pages it answers from, and how it searches them.',
  // what is set here, at a glance, before the forms
  top: (ctx) => <KnowledgeGlance ctx={ctx} />,
  cols: [
    [
      {
        id: 'docs',
        title: 'Documents and pages',
        lead: 'What it answers from. Add files and pages, then build the index so it can search them.',
        rows: [
          {
            id: 'index',
            label: 'Search index',
            hint: 'Built before calls. The last index keeps answering until a new build is ready, so a failed build costs nothing.',
            render: (c) => (
              <div id={c.id}>
                <IndexRow ctx={c} />
              </div>
            ),
          },
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
          {
            id: 'read',
            label: 'What it has read',
            hint: 'Each file and page, and whether the index has it',
            errPath: ['knowledge'],
            render: (c) => <SourceCards ctx={c} id={c.id} />,
          },
          {
            id: 'readers',
            label: 'Which agents read it',
            hint: 'Agents search it on every turn; a tool searches when the model asks',
            kind: 'multi',
            // the knowledge tools that search it are set on Tools; said here so the whole picture is in one place
            note: (config) => (docIndex(config) < 0 ? '' : lookedUpWith(config, config.knowledge[docIndex(config)].id)),
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
        waiting: (c) => (canSearch(c.config) ? '' : 'Add a document or a web page above first, then try what a caller might ask.'),
        lead: 'What a caller might ask, and what it would find. Nothing is saved.',
        rows: [],
        body: (c) => <KnowledgeSearch ctx={c} />,
      },
    ],
    [
      {
        id: 'search',
        title: 'How it searches',
        waiting: (c) => (hasDocs(c.config) ? '' : 'Its search settings appear once it has a document or web page to search.'),
        rows: [
          {
            ...based(doc(['mode']), {
              id: 'mode',
              label: 'When it searches',
              kind: 'ch',
              options: [
                { value: 'tool', label: 'When the model decides' },
                { value: 'inject', label: 'On every caller turn' },
              ],
            }),
            // the agents that read it keep reading it, the way the new mode allows (a list of its own, or a search tool)
            put: (config, value) => (docBaseId(config) ? setBaseMode(config, docBaseId(config), value) : config),
          },
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
            // its own note says a timer does nothing; the server's words would say it twice
            serverNote: false,
            id: 'refresh',
            label: 'Rebuild it',
            kind: 'ch',
            // a timer chosen is told it does nothing while the server says so (its `unsupported`, FRONTEND_GUIDE 5: not
            // hard-coded); before the first check comes back, what the guide says today (section 8)
            note: (config, ctx) => {
              const at = doc(['refresh'])(config);
              const chosen = at ? at.reduce((v, k) => (v == null ? v : v[k]), config) : undefined;
              const every = { hourly: 'every hour', daily: 'every day', weekly: 'every week' }[chosen];
              if (!every) return '';
              const report = ctx?.editor?.report;
              if (report?.valid && !notRunAt(report.unsupported, at)) return '';
              return `Set to rebuild ${every}, but nothing rebuilds it on a timer yet: the index stays as it was last built. Press Build after the files change.`;
            },
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
            // the web-API connections set up on the Connections part: the schema's x-ref is http_connections, so an MCP
            // server or an SMS/email sender is not offered here (the guide, section 4)
            options: (config) => refChoices(config, 'http_connections'),
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
