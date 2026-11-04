import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DemoNote } from '../../demo/DemoBadge.jsx';
import { Notice } from '../ui.jsx';
import { useBuilds, useKnowledge } from './useKnowledge.js';
import { isBuilding, knowledgeSummary, lastLog, readingState } from './model.js';
import { KNOWLEDGE_ID, attachBase, knowledgeOf } from '../setup/setupModel.js';
import Icon from '../../ui/Icon.jsx';
import './knowledge.css';
import Button from '../../ui/Button.tsx';
import { FindPanel } from './SearchPanels.jsx';
import BaseCard from './BaseCard.jsx';
import FilesCard from './FilesCard.jsx';

// Knowledge: the files and web pages an agent answers from. A "vector store" base is searched from an index built
// BEFORE calls, so here someone uploads files, builds the index and tries a search to see passages and their scores
// (which guide `min_score`). It works from the SAVED draft, because that is what the server builds and searches.

// The page's own "What it knows" in one line: how far its documents and pages are from being usable (not saved, not
// read yet, being read, ready, failed), with the one button that moves them on. It replaces scattered notes below.
const quoted = (names) => {
  const q = names.map((n) => `“${n}”`);
  return q.length > 1 ? `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}` : q[0] || '';
};
// a server's message ends with its own full stop; the sentence it goes into adds one
const unstopped = (text) => String(text || '').replace(/[.\s]+$/, '');

function KnowledgeStatus({ config, editor, data, build, buildError, onSaveAndBuild, busy }) {
  const { files, pages } = knowledgeOf(config);
  const count = files.length + pages.length;
  if (!count || !data) return null;
  const base = data.bases.find((b) => b.id === KNOWLEDGE_ID) || null;
  const draftSources = (Array.isArray(config?.knowledge) ? config.knowledge : []).find((b) => b?.id === KNOWLEDGE_ID)?.sources;
  const live = build || base?.build || null;
  const { state, names } = readingState(base, { draftSources, build });
  const them = count === 1 ? 'it' : 'them';
  const starting = busy ? 'Starting…' : null;
  let tone = 'warn';
  let text;
  let action = null;
  if (!data.keyAvailable) {
    text = 'This server can’t read documents yet (whoever runs it has to add the key for it). They are kept, and used as soon as it can.';
  } else if (state === 'reading') {
    tone = 'busy';
    text = `Reading ${them} so it can answer from ${them}… ${lastLog(live) || ''}`.trim();
  } else if (state === 'unsaved' && editor.dirty) {
    text = `Not saved yet: it can’t answer from ${count === 1 ? 'this' : 'these'} until ${count === 1 ? 'it is' : 'they are'} saved and read.`;
    action = editor.saving || busy ? 'Saving…' : 'Save and build';
  } else if (state === 'missing') {
    text = `${quoted(names)} ${names.length === 1 ? 'isn’t' : 'aren’t'} on the server any more: add ${names.length === 1 ? 'it' : 'them'} again above, or remove ${names.length === 1 ? 'it' : 'them'} from the list.`;
  } else if (state === 'failed') {
    tone = 'bad';
    text = `Reading ${them} failed: ${unstopped(live?.error) || 'no reason was given'}.${base?.index ? ' It still answers from what it read before.' : ''}`;
    action = starting || 'Try again';
  } else if (state === 'changed') {
    text = `${names.length ? `What it knows changed since it was last read (${quoted(names)})` : 'What it knows changed since it was last read'}: build again so it answers from the latest.`;
    action = starting || 'Build again';
  } else if (state === 'ready') {
    tone = 'good';
    text = `Ready: it answers from ${base.index.passages.toLocaleString()} passage${base.index.passages === 1 ? '' : 's'} of what it read.`;
  } else {
    // saved but never read (or saved a moment ago, before the server's answer caught up): building reads what is saved
    text = `Saved, but not read yet: it can’t answer from ${them} until ${count === 1 ? 'it is' : 'they are'}.`;
    action = starting || 'Build now';
  }
  return (
    <>
      <div className={`kwNext ${tone}`} role="status">
        {tone === 'busy' ? <i className="pvSpin" aria-hidden="true" /> : <Icon name={tone === 'good' ? 'check' : 'info'} size={16} />}
        <span>{text}</span>
        {action && (
          <Button type="button" variant="primary" size="compact" disabled={busy || editor.saving} onClick={onSaveAndBuild}>
            {action}
          </Button>
        )}
        {buildError && <small className="stFErr">{buildError}</small>}
      </div>
      {state === 'failed' && live?.log?.length > 1 && (
        <details className="kwNextLog">
          <summary>What happened</summary>
          <ol>
            {live.log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}

// The Knowledge tab: the agent's bases, uploaded files and builds.
//   top: drawn first (the simple "What it knows" block), or a function given { reload } to re-read the knowledge
//   simple: the block above adds documents (no second upload below); a first base made here goes to the answering agent
//   knowledge: as read by the surrounding page (useKnowledge), so "Getting it ready" follows builds; else read here
export default function KnowledgeTab({ botId, name, editor, pollMs, top = null, simple = false, knowledge: given = null }) {
  const config = editor.parsed.value;
  const ready = editor.status === 'ready' && editor.isObject && !editor.parsed.error;
  const own = useKnowledge(given ? null : botId);
  const knowledge = given || own;
  const inputRef = useRef(null);
  const { builds, errors, start, follow } = useBuilds(botId, { onChange: () => knowledge.reload(), pollMs });
  // read again when the draft is saved (anywhere: top bar, Ctrl+S) or its knowledge changes (an upload above is on the
  // server at once), so bases, files and builds follow without a page reload
  const savedAt = editor.meta?.savedAt || '';
  const sources = JSON.stringify(Array.isArray(config?.knowledge) ? config.knowledge.map((b) => b?.sources) : []);
  const reloadKnowledge = knowledge.reload;
  const seen = useRef(null);
  useEffect(() => {
    const key = `${savedAt}|${sources}`;
    if (seen.current !== null && seen.current !== key) reloadKnowledge();
    seen.current = key;
  }, [savedAt, sources, reloadKnowledge]);
  const data = knowledge.data;
  const summary = useMemo(() => knowledgeSummary(data), [data]);
  // "Save and build": the draft is saved (the server reads what is saved), then the setup's base is read
  const [busy, setBusy] = useState(false);
  const saveAndBuild = async () => {
    setBusy(true);
    try {
      const saved = editor.dirty ? await editor.save() : true;
      if (saved) await start(KNOWLEDGE_ID);
    } finally {
      setBusy(false);
    }
  };
  // a base that was already building when the screen opened (or in another tab) is followed too
  useEffect(() => {
    (data?.bases || []).forEach((base) => {
      if (isBuilding(base.build) && !builds[base.id]) follow(base.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!ready)
    return (
      <Notice kind="warn" title="The draft can’t be read right now">
        Fix its JSON in the agent’s settings first.
      </Notice>
    );

  const unsavedBases = JSON.stringify((config?.knowledge || []).map((b) => b?.id)) !== JSON.stringify((data?.bases || []).map((b) => b.id));
  const attach = (baseId) => editor.setValue(attachBase(editor.parsed.value, baseId));
  // the simple view's own base is covered by the status line and "What would it find?"; any other base keeps its card
  const ownBase = simple ? data?.bases.find((b) => b.id === KNOWLEDGE_ID) : null;
  const cards = (data?.bases || []).filter((b) => b !== ownBase);
  return (
    <div className="kwTab">
      {typeof top === 'function' ? top({ reload: knowledge.reload }) : top}
      {simple && (
        <KnowledgeStatus
          config={config}
          editor={editor}
          data={data}
          build={builds[KNOWLEDGE_ID]}
          buildError={errors[KNOWLEDGE_ID]}
          onSaveAndBuild={saveAndBuild}
          busy={busy}
        />
      )}
      {!simple && (
        <section className="stCard kwIntro">
          <h3>{top ? 'Bases and their index' : 'Knowledge'}</h3>
          <p className="stMuted">
            What {name} can look things up in. A base made of <strong>files and web pages</strong> is searched from an index that has to be built before calls;
            a base that asks <strong>your own search service</strong> has nothing to build. Here you upload files, build the index, and try a search to see what
            the model would be shown.
          </p>
        </section>
      )}

      <DemoNote kind="knowledge">
        There is no embedding model in demo mode: the index is a plain word index in this browser, and the scores come from shared words. Real scores will
        differ.
      </DemoNote>
      {data && !data.keyAvailable && (
        <Notice kind="warn" title="This server can’t build indexes yet">
          It has no key for the embedding model, so building will be refused. An operator has to set it; searching an index that is already built still works.
        </Notice>
      )}
      {!simple && (editor.dirty || unsavedBases) && (
        <Notice
          kind="info"
          title="Knowledge works from the saved draft"
          actions={
            <Button type="button" onClick={() => editor.save()} disabled={editor.saving}>
              {editor.saving ? 'Saving…' : 'Save draft'}
            </Button>
          }
        >
          The server builds and searches what is saved, not what is in the editor. Save to include your latest changes to the bases.
        </Notice>
      )}
      {knowledge.error && (
        <Notice
          kind="error"
          title="Knowledge couldn’t be read"
          actions={
            <Button type="button" onClick={knowledge.reload}>
              Try again
            </Button>
          }
        >
          {knowledge.error.message}
        </Notice>
      )}
      {knowledge.loading && !data && (
        <p className="stMuted" role="status">
          Loading knowledge…
        </p>
      )}

      {data && summary.total > 0 && !simple && (
        <p className="kwSummary" role="status">
          {summary.total} base{summary.total === 1 ? '' : 's'}: <b className="ok">{summary.ready} ready</b>
          {summary.needsBuild > 0 && (
            <>
              ,{' '}
              <b className="bad">
                {summary.needsBuild} need{summary.needsBuild === 1 ? 's' : ''} building
              </b>
            </>
          )}
          {summary.building > 0 && <>, {summary.building} building</>}.
        </p>
      )}

      {ownBase?.index && !isBuilding(builds[KNOWLEDGE_ID] || ownBase.build) && <FindPanel botId={botId} base={ownBase} config={config} />}

      {cards.map((base) => (
        <BaseCard
          key={base.id}
          botId={botId}
          base={base}
          config={config}
          build={builds[base.id]}
          buildError={errors[base.id]}
          dirty={editor.dirty}
          onBuild={start}
          onAttach={attach}
          onUpload={() => inputRef.current?.click()}
        />
      ))}

      {data && data.bases.length === 0 && !knowledge.loading && !top && (
        <section className="stCard kwEmpty">
          <strong>This agent has no knowledge bases yet</strong>
          <p className="stMuted">Upload a file below and it becomes this agent’s knowledge base. Save the draft, then build the index.</p>
        </section>
      )}

      {data && simple && data.files.length > 0 && (
        // the server's files, for the few who need them: folded, as "What it knows" above is where documents are kept
        <details className="kwAllFiles">
          <summary>All uploaded files ({data.files.length})</summary>
          <FilesCard
            botId={botId}
            files={data.files}
            bases={data.bases}
            editor={editor}
            inputRef={inputRef}
            onChanged={knowledge.reload}
            uploads={false}
            attachFirst={!!top}
          />
        </details>
      )}
      {data && !simple && (!top || data.files.length > 0 || data.bases.length > 0) && (
        <FilesCard
          botId={botId}
          files={data.files}
          bases={data.bases}
          editor={editor}
          inputRef={inputRef}
          onChanged={knowledge.reload}
          uploads={!simple}
          attachFirst={!!top}
        />
      )}
    </div>
  );
}
