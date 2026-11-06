import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { readSimple } from '../../../simple/simpleModel.js';
import { DetailedRow } from '../Detailed.jsx';
import { AllSettings, Line, More, Popover, Rows, Tok, ViewSwitch, reveal, rowsOf, useShownView } from '../workspaceKit.jsx';
import { makeViewStore } from '../workspaceView.js';
import { canSearch } from '../parts/knowledgeView.js';
import { LINES, MORE, SHELF, TOKENS } from './knowledgeLayout.js';
import { USUAL, linesOf, readKnowledge, sentenceParts, summaryLine } from './knowledgeWords.js';
import { ModeChoice } from './knowledgeEditors.jsx';
import { applySearch, holdSearch, takeSearch, useHeldSearch } from './pendingSearch.js';
import { NumberInput } from '../../../form/fields.jsx';
import { useRoute } from '../../../route.js';
import './knowledgeWorkspace.css';

// Build › Knowledge as a shelf you can see and a search you can try (design: canvas page "3 · Knowledge, redesigned").
// What it knows: one sentence says what it answers from, when it searches and how much it brings back, each part
// opening its editor in place (a part not set yet is a blank); under it, the shelf: the search index beside every
// document and page with its state; then three chapters: what it reads, how it searches, try it. All settings: every
// setting, searchable. Both views edit with the part's own rows (knowledgeForm), so each setting is the same control.

const VIEWS = makeViewStore('weave_knowledge_view', 'shelf');
// named for what it shows (the stage tabs already have an "Overview")
const FIRST = ['shelf', 'What it knows'];
const LABEL = 'How to see what it knows';

const initialsOf = (name) =>
  (name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

function Shelf({ ctx, rows, k, s, lit }) {
  const add = () => s.openToken('docs');
  if (!k.hasBase)
    return (
      <div className={`kwShelf empty ${lit ? 'lit' : ''}`}>
        <span className="kwEmptyIcon" aria-hidden="true">
          <Icon name="upload" size={20} />
        </span>
        <span className="kwEmptyText">
          <b>Nothing to read yet</b>
          <small>It answers from its brief until you give it documents or web pages. They are read when you build its search index.</small>
        </span>
        <span className="kwEmptyActs">
          <Button type="button" size="small" variant="primary" onClick={add}>
            Add files
          </Button>
          <Button type="button" size="small" onClick={() => s.openToken('pages')}>
            Add a web page
          </Button>
        </span>
      </div>
    );
  return (
    <div className={`kwShelf ${lit ? 'lit' : ''}`}>
      {SHELF.map((id) => rows[id] && <DetailedRow key={id} row={rows[id]} ctx={ctx} partId="knowledge" />)}
      <button type="button" className="kwAdd" onClick={add}>
        <Icon name="plus" size={14} />
        Add files or a web page
      </button>
    </div>
  );
}

// How it will search, before it has anything to read: the same choices, held until the first document or page makes
// its base (the schema needs one before a base can exist), then written there
function HeldSearch({ part, config, agentId, held }) {
  const k = readKnowledge(config, held);
  return (
    <div className="apRows kwHeld">
      {part === 'mode' ? (
        <ModeChoice config={config} id="kw-held-mode" value={k.mode} onChange={(mode) => holdSearch(agentId, { mode })} />
      ) : (
        <label className="kwHeldNum">
          <span>The best ones it finds, each time</span>
          <span className="dtNum2">
            <NumberInput
              id="kw-held-topk"
              value={held?.top_k ?? null}
              placeholder={String(USUAL.topK)}
              nullable
              min={1}
              max={20}
              integer
              aria-label="How many passages"
              onChange={(n) => holdSearch(agentId, { top_k: n === null ? undefined : n })}
            />
            <span className="dtUnit">passages (1 to 20)</span>
          </span>
        </label>
      )}
      <p className="kwHeldNote">
        <Icon name="info" size={14} />
        Kept for when it has something to read: it is saved with the first document or web page you add.
      </p>
    </div>
  );
}

function Shelfside({ ctx, form, view }) {
  const rows = useMemo(() => rowsOf(form), [form]);
  const hero = useRef(null);
  const anchors = useRef({});
  const [open, setOpen] = useState(null);
  const close = useCallback(() => setOpen(null), []);
  const openToken = (key) => {
    setOpen({ token: key });
    reveal(hero.current);
  };
  const config = ctx.config;
  const simple = readSimple(config);
  const name = simple.persona || simple.name || 'It';
  const route = useRoute();
  const agentId = route.botId || config?.meta?.id || '';
  const held = useHeldSearch(agentId);
  const k = readKnowledge(config, held);
  const parts = sentenceParts(config, held);
  const lines = linesOf(config, ctx.knowledgeRead, held);
  // the first document or page made the base: what was chosen before is written into it now
  const { set } = ctx;
  useEffect(() => {
    if (k.hasBase && held) set(applySearch(config, takeSearch(agentId)));
  }, [k.hasBase]); // eslint-disable-line react-hooks/exhaustive-deps
  const searchable = canSearch(config);
  const filled = { docs: parts.docs, pages: parts.pages, mode: parts.mode, topk: parts.topk };
  const s = { open, setOpen, openToken, close, rows, ctx, filled, anchors, tokens: TOKENS, partId: 'knowledge' };
  const lit = open?.token === 'docs' || open?.token === 'pages';
  // a link elsewhere on the page ("change it under How it searches") opens the line that holds the setting
  useEffect(() => {
    const show = (event) => {
      if (event.detail === 'knowledge.score') setOpen({ line: 'close' });
    };
    window.addEventListener('detailed:show', show);
    return () => window.removeEventListener('detailed:show', show);
  }, []);
  const ask = () => {
    setOpen({ line: 'ask' });
    requestAnimationFrame(() => reveal(document.querySelector('.kwWrap [data-line="ask"]')));
  };

  return (
    <section className="dtPart apWrap kwWrap" data-part="knowledge" aria-labelledby="dt-knowledge-title">
      <header className="apTop">
        <div className="apTopText">
          <h1 id="dt-knowledge-title">Knowledge</h1>
          <p className="dtQuestion">{form.question}</p>
        </div>
        <ViewSwitch view={view} onChoose={VIEWS.set} first={FIRST} label={LABEL} />
      </header>

      <section ref={hero} className="apHero kwHero" aria-label="What it knows">
        <div className="apId">
          <span className="apAvatar kwAvatar" aria-hidden="true">
            {initialsOf(name)}
          </span>
          <div className="apName">
            <h2>What {name} knows</h2>
            <p>{summaryLine(config)}</p>
          </div>
          <div className="apActs">
            <Button type="button" variant="primary" className="apInk" onClick={ask} disabled={!searchable}>
              <Icon name="search" size={15} />
              Ask it something
            </Button>
          </div>
        </div>
        <p className="apSentence kwSentence">
          {name} answers from <Tok s={s} k="docs" /> and <Tok s={s} k="pages" />, searched <Tok s={s} k="mode" /> for <Tok s={s} k="topk" />.
        </p>
        <p className="apHint">Click any part to change it.</p>
        <Shelf ctx={ctx} rows={rows} k={k} s={s} lit={lit} />
        {open?.token && (
          <Popover
            key={open.token}
            anchor={anchors.current[open.token]}
            box={hero}
            title={TOKENS[open.token].title}
            onClose={close}
            width={TOKENS[open.token].width}
          >
            {!k.hasBase && (open.token === 'mode' || open.token === 'topk') ? (
              <HeldSearch part={open.token} config={config} agentId={agentId} held={held} />
            ) : (
              <Rows ids={TOKENS[open.token].ids} rows={rows} ctx={ctx} partId="knowledge" />
            )}
          </Popover>
        )}
      </section>

      <section className="apCh" aria-labelledby="kw-reads">
        <div className="apChHead">
          <span className="apChNum">01</span>
          <h2 id="kw-reads">What it reads</h2>
          <span className="apChSub">Documents and web pages, and the agents that read them</span>
        </div>
        <div className="apDoc lines">
          <Line
            s={s}
            k="docs"
            icon="records"
            label="Documents"
            token="docs"
            action={lines.documents.empty ? 'Add files' : 'Change'}
            muted={lines.documents.empty}
          >
            {lines.documents.value}
            {lines.documents.note && <span className="apDim"> · {lines.documents.note}</span>}
          </Line>
          <Line s={s} k="pages" icon="globe" label="Web pages" token="pages" action={lines.pages.empty ? 'Add a page' : 'Change'} muted={lines.pages.empty}>
            {lines.pages.value}
            {lines.pages.note && <span className="apDim"> · {lines.pages.note}</span>}
          </Line>
          <Line s={s} k="readers" icon="team" label="Who reads it" ids={LINES.readers} locked={!k.hasBase} muted={lines.readers.empty}>
            {lines.readers.value}
            <span className="apDim"> · {lines.readers.note}</span>
          </Line>
        </div>
        <More s={s} k="readsMore" ids={MORE.reads} />
      </section>

      <section className="apCh" aria-labelledby="kw-search">
        <div className="apChHead">
          <span className="apChNum">02</span>
          <h2 id="kw-search">How it searches</h2>
          <span className="apChSub">{k.hasBase ? 'When, how much, and how close a match must be' : 'What it starts with, once it has something to read'}</span>
        </div>
        <div className="apDoc lines">
          <Line s={s} k="mode" icon="clock" label="When it searches" token="mode">
            {lines.when.value}
            <span className="apDim"> · {lines.when.note}</span>
          </Line>
          <Line s={s} k="topk" icon="list" label="How many passages" token="topk">
            {lines.many.value}
            <span className="apDim"> · {lines.many.note}</span>
          </Line>
          <Line s={s} k="close" icon="gauge" label="How close a match" ids={LINES.close} locked={!k.hasBase} muted={lines.close.empty}>
            {lines.close.value}
            <span className="apDim"> · {lines.close.note}</span>
          </Line>
          <Line s={s} k="from" icon="chat" label="What it searches for" ids={LINES.from} locked={!k.hasBase || lines.from.fixed} muted={lines.from.fixed}>
            {lines.from.value}
            <span className="apDim"> · {lines.from.note}</span>
          </Line>
        </div>
        {k.hasBase && <More s={s} k="searchMore" ids={MORE.search} />}
      </section>

      <section className="apCh" aria-labelledby="kw-try">
        <div className="apChHead">
          <span className="apChNum">03</span>
          <h2 id="kw-try">Try it</h2>
          <span className="apChSub">Ask what a caller might ask, and see what it would find</span>
        </div>
        <div className="apDoc lines" data-line="ask">
          <Line s={s} k="ask" icon="search" label="Ask it something" ids={LINES.ask} action="Try a question" locked={!searchable} muted={!searchable}>
            {searchable ? 'What would it find for a caller’s question?' : 'Give it something to read first'}
            <span className="apDim"> · nothing is saved</span>
          </Line>
        </div>
      </section>
    </section>
  );
}

export default function KnowledgeWorkspace({ ctx, form }) {
  const { view, choose } = useShownView(ctx, VIEWS);
  if (view === 'all')
    return (
      <AllSettings
        ctx={ctx}
        form={form}
        searchLabel="Search the knowledge settings"
        switcher={<ViewSwitch view="all" onChoose={choose} first={FIRST} label={LABEL} />}
      />
    );
  return <Shelfside ctx={ctx} form={form} view={view} />;
}
