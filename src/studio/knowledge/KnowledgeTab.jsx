import React, { useEffect, useMemo, useRef, useState } from 'react';
import SmartSelect from '../SmartSelect.jsx';
import { api } from '../../api/client.ts';
import { DemoNote } from '../../demo/DemoBadge.jsx';
import { Notice } from '../ui.jsx';
import { formatWhen, slugify } from '../format.js';
import { useBuilds, useKnowledge } from './useKnowledge.js';
import {
  ACCEPT_ATTRIBUTE,
  STATE_TEXT,
  addFileSource,
  applyMinScore,
  baseState,
  describeScore,
  fileTypeProblem,
  fixActionFor,
  readableFix,
  formatBytes,
  isBuilding,
  knowledgeSummary,
  lastLog,
  matchWords,
  normalizeSearch,
  readingState,
  refreshNote,
  settingsOf,
} from './model.js';
import { KNOWLEDGE_ID, addKnowledgeFile, attachBase, knowledgeOf, readersInWords, readersOf } from '../setup/setupModel.js';
import { entryAgentIndex } from '../simple/simpleModel.js';
import { agentLabel, humanize } from '../agent/rowNames.js';
import { Section } from '../agent/PageShell.jsx';
import Icon from '../../ui/Icon.jsx';
import './knowledge.css';
import { askConfirm } from '../../ui/dialogs.js';

// Knowledge: the files and web pages an agent answers from. A "vector store" base is searched from an index built
// BEFORE calls, so here someone uploads files, builds the index and tries a search to see passages and their scores
// (which guide `min_score`). It works from the SAVED draft, because that is what the server builds and searches.

function SearchPanel({ botId, base, config }) {
  const settings = settingsOf(config, base.id);
  const inject = base.mode === 'inject';
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState('');
  const [previous, setPrevious] = useState('');
  const [state, setState] = useState({ busy: false, error: '', answer: null });
  const run = async (event) => {
    event.preventDefault();
    if (!query.trim()) return;
    setState({ busy: true, error: '', answer: null });
    try {
      const raw = await api.searchKnowledge(botId, base.id, {
        query: query.trim(),
        ...(topK ? { top_k: Number(topK) } : {}),
        ...(inject && previous.trim() ? { previous_reply: previous.trim() } : {}),
        ref: 'draft',
      });
      setState({ busy: false, error: '', answer: { ...normalizeSearch(raw), note: typeof raw?.note === 'string' ? raw.note : '' } });
    } catch (e) {
      setState({ busy: false, error: e?.message || 'The search failed.', answer: null });
    }
  };
  const hits = state.answer ? applyMinScore(state.answer.hits, settings.minScore) : [];
  const dropped = hits.filter((h) => !h.kept).length;
  return (
    <form className="kwSearch" onSubmit={run} aria-label={`Test a search of ${base.id}`}>
      <label>
        <span>What a caller might say</span>
        <input
          className="stFInput"
          type="text"
          value={query}
          placeholder="e.g. how do I get a refund?"
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search text"
          maxLength={2000}
        />
      </label>
      <div className="kwSearchRow">
        <label>
          <span>Passages to ask for</span>
          <input
            className="stFInput small"
            type="number"
            min="1"
            max="20"
            value={topK}
            placeholder={String(settings.topK ?? 4)}
            onChange={(event) => setTopK(event.target.value)}
            aria-label="Passages to ask for"
          />
        </label>
        {inject && (
          <label className="kwWide">
            <span>
              What the bot said just before <em>(optional: shows how a follow-up is searched)</em>
            </span>
            <input
              className="stFInput small"
              type="text"
              value={previous}
              maxLength={4000}
              onChange={(event) => setPrevious(event.target.value)}
              aria-label="What the bot said just before"
            />
          </label>
        )}
        <button type="submit" className="primaryCta compactCta" disabled={state.busy || !query.trim()}>
          {state.busy ? 'Searching…' : 'Search'}
        </button>
      </div>
      {state.error && (
        <p className="stFErr" role="alert">
          {state.error}
        </p>
      )}
      {state.answer && (
        <div className="kwResults" role="status">
          {state.answer.note && (
            <p className="stFWarn" role="note">
              {state.answer.note}
            </p>
          )}
          <p className="stMuted">
            {hits.length} passage{hits.length === 1 ? '' : 's'}
            {state.answer.ms !== undefined ? ` in ${state.answer.ms} ms` : ''}
            {settings.minScore !== undefined
              ? ` · this base drops anything scoring under ${settings.minScore}${dropped ? ` (${dropped} of these)` : ''}`
              : ' · no minimum score is set, so every passage found is kept'}
            .
          </p>
          {hits.length === 0 && (
            <p className="stFEmpty">Nothing matched. Either the index doesn’t have this, or the question is worded very differently from the material.</p>
          )}
          <ol className="kwHits">
            {hits.map((hit, index) => (
              <li key={index} className={hit.kept ? '' : 'dropped'}>
                <header>
                  {hit.score !== undefined && (
                    <span
                      className="kwScore"
                      title={`${describeScore(hit.score)}. With the default embeddings, related text scores about 0.5 to 0.75 and unrelated text below 0.25.`}
                    >
                      <i style={{ width: `${Math.round(Math.min(1, hit.score) * 100)}%` }} />
                      {hit.score.toFixed(2)}
                    </span>
                  )}
                  <small>
                    {describeScore(hit.score)}
                    {hit.source ? ` · ${hit.source}` : ''}
                    {hit.kept ? '' : ' · dropped by min_score'}
                  </small>
                </header>
                <p>{hit.text}</p>
              </li>
            ))}
          </ol>
          {state.answer.modelIsShown && (
            <details className="kwShown">
              <summary>What the model is shown</summary>
              <pre>{state.answer.modelIsShown}</pre>
            </details>
          )}
          <p className="stFHelp">
            Scores are how you choose <code>retrieval.min_score</code>: set it just under what a good answer scores and above what an unrelated one does. Other
            embeddings score differently.
          </p>
        </div>
      )}
    </form>
  );
}

// The page's own check under "What it knows": a question a caller might ask and the passages it would answer from, by
// document and closeness (score in the tooltip). Search settings (passage count, lowest score kept) are under Settings.
function FindPanel({ botId, base, config }) {
  const settings = settingsOf(config, base.id);
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ busy: false, error: '', answer: null });
  const run = async (event) => {
    event.preventDefault();
    if (!query.trim()) return;
    setState({ busy: true, error: '', answer: null });
    try {
      const raw = await api.searchKnowledge(botId, base.id, { query: query.trim(), ref: 'draft' });
      // demo mode's note says what the page's demo note already does
      const note = typeof raw?.note === 'string' && raw?.demo !== true ? raw.note : '';
      setState({ busy: false, error: '', answer: { ...normalizeSearch(raw), note } });
    } catch (e) {
      setState({ busy: false, error: e?.message || 'The search failed.', answer: null });
    }
  };
  const hits = state.answer ? applyMinScore(state.answer.hits, settings.minScore) : [];
  const kept = hits.filter((h) => h.kept).length;
  const left = hits.length - kept;
  return (
    <Section title="What would it find?" lead="Ask something a caller might ask, and see the passages it would answer from.">
      <form className="kwFind" onSubmit={run} role="search" aria-label="What would it find?">
        <input
          className="stFInput"
          type="text"
          value={query}
          placeholder="For example: how do I get a refund?"
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Something a caller might ask"
          maxLength={2000}
        />
        <button type="submit" className="quietButton" disabled={state.busy || !query.trim()}>
          {state.busy ? 'Looking…' : 'Find answers'}
        </button>
      </form>
      {state.error && (
        <p className="stFErr" role="alert">
          {state.error}
        </p>
      )}
      {state.answer && (
        <div className="kwFound" role="status">
          {state.answer.note && (
            <p className="stFWarn" role="note">
              {state.answer.note}
            </p>
          )}
          <p className="stMuted">
            {kept === 0
              ? 'Nothing it has read matches this, so it would answer from its instructions alone.'
              : `It would answer from ${kept} passage${kept === 1 ? '' : 's'}${left ? `, and leave out ${left} as too far from the question` : ''}.`}
          </p>
          {hits.length > 0 && (
            <ol>
              {hits.map((hit, index) => {
                const match = matchWords(hit.score);
                return (
                  <li key={index} className={hit.kept ? '' : 'left'}>
                    <header>
                      <strong title={hit.source || undefined}>{hit.source || `Passage ${index + 1}`}</strong>
                      {hit.kept ? (
                        match.text && (
                          <span className={`nlPill kwMatch ${match.tone}`} title={`Score ${hit.score.toFixed(2)}`}>
                            {match.text}
                          </span>
                        )
                      ) : (
                        <span className="nlPill kwMatch" title={`Score ${hit.score?.toFixed(2)}, under the lowest it keeps (${settings.minScore})`}>
                          Left out
                        </span>
                      )}
                    </header>
                    <p>{hit.text}</p>
                  </li>
                );
              })}
            </ol>
          )}
          {state.answer.modelIsShown && (
            <details className="kwShown">
              <summary>What the agent is shown</summary>
              <pre>{state.answer.modelIsShown}</pre>
            </details>
          )}
        </div>
      )}
    </Section>
  );
}

// A base of the agent's own (beyond the page's "What it knows"), in words: name, kind, when and by whom it is read,
// sources, index and needs. A base nothing reads offers to give it to the agent that answers.
function BaseCard({ botId, base, config, build, buildError, onBuild, onUpload, onAttach, dirty }) {
  const [searching, setSearching] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const live = build || base.build;
  const state = baseState({ ...base, build: live });
  const info = STATE_TEXT[state];
  const building = isBuilding(live);
  const inDraft = (Array.isArray(config?.knowledge) ? config.knowledge : []).some((b) => b?.id === base.id);
  const readers = inDraft ? readersInWords(config, base.id) : '';
  const entryIndex = entryAgentIndex(config);
  const entry = entryIndex >= 0 ? config.agents.items[entryIndex] : null;
  const title = base.id === KNOWLEDGE_ID ? 'What it knows' : humanize(base.id);
  // the index line already says there is none and the card's Build button builds, so that problem is not said twice
  const problems = base.problems.filter((p) => !/no index has been built/i.test(p.problem));
  return (
    <section className={`stCard kwBase ${state}`} data-base={base.id} aria-label={`Knowledge: ${title}`}>
      <header className="kwHead">
        <div>
          <h3 title={base.id}>{title}</h3>
          <p className="stMuted">
            {base.type === 'vector_store' ? 'Your documents and web pages' : 'Your own search service'} ·{' '}
            {base.mode === 'inject' ? 'read in every conversation' : 'looked up when it needs to'}
          </p>
        </div>
        <span className={`kwState ${info.tone}`} title={info.hint}>
          {info.label}
        </span>
      </header>

      <p className="kwUsed">
        {!inDraft ? (
          <span className="stMuted">Taken out of the draft: it goes when the draft is saved.</span>
        ) : readers && readersOf(config, base.id).agents.length ? (
          readers
        ) : (
          <>
            <span className="stFWarn">{readers || 'Nothing reads it yet, so no agent answers from it.'}</span>{' '}
            {entry && (
              <button type="button" className="quietButton small" onClick={() => onAttach(base.id)}>
                Let {agentLabel(config, entry.id)} use it
              </button>
            )}
          </>
        )}
      </p>
      {base.buildable && refreshNote(settingsOf(config, base.id).refresh) && (
        <p className="stFWarn" role="note" data-note="refresh">
          {refreshNote(settingsOf(config, base.id).refresh)}
        </p>
      )}

      {base.buildable && (
        <>
          <ul className="kwSources" aria-label="Sources">
            {base.sources.map((s, i) => (
              <li key={i} className={s.uploaded === false ? 'missing' : ''}>
                <span className="kwKind">{s.kind === 'url' ? 'web page' : 'file'}</span> <code>{s.label}</code>
                {s.kind === 'file' && (s.uploaded === false ? <em> not uploaded</em> : s.uploaded === true ? <em className="ok"> uploaded</em> : null)}
              </li>
            ))}
            {base.sources.length === 0 && <li className="stMuted">No sources yet.</li>}
          </ul>

          {base.index ? (
            <p className="kwIndex">
              Index built {formatWhen(base.index.builtAt)}: <strong>{base.index.passages.toLocaleString()}</strong> passage
              {base.index.passages === 1 ? '' : 's'}
              {base.index.embedding ? ` with ${base.index.embedding}` : ''}.
              {base.index.documents.length > 0 && (
                <>
                  {' '}
                  <button type="button" className="stLink" aria-expanded={showDocs} onClick={() => setShowDocs((v) => !v)}>
                    {showDocs ? 'Hide' : 'Show'} the {base.index.documents.length} document{base.index.documents.length === 1 ? '' : 's'}
                  </button>
                </>
              )}
            </p>
          ) : (
            <p className="kwIndex stMuted">There is no index yet: searches find nothing until one is built.</p>
          )}
          {showDocs && base.index && (
            <ul className="kwDocs">
              {base.index.documents.map((d) => (
                <li key={d.name}>
                  <code>{d.name}</code>
                  {d.passages !== undefined ? (
                    <small>
                      {' '}
                      {d.passages} passage{d.passages === 1 ? '' : 's'}
                    </small>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {problems.length > 0 && (
        <ul className="kwProblems" aria-label="Problems">
          {problems.map((p, i) => {
            const action = fixActionFor(p);
            return (
              <li key={i}>
                <strong>{p.problem}</strong>
                {readableFix(p) && <span> {readableFix(p)}</span>}
                {action === 'upload' && (
                  <button type="button" className="quietButton" onClick={onUpload}>
                    Upload a file
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {building && (
        <div className="kwBuilding" role="status" aria-live="polite">
          <i className="pvSpin" aria-hidden="true" />
          <span>
            <strong>Building the index…</strong> {lastLog(live)}
          </span>
        </div>
      )}
      {live?.status === 'failed' && (
        <Notice kind="error" title="The last build failed">
          {live.error || 'No reason was given.'} {base.index ? 'The previous index is still answering.' : ''}
        </Notice>
      )}
      {live?.status === 'done' && live.passages !== undefined && !building && (
        <p className="kwDone" role="status">
          Build finished: {live.passages.toLocaleString()} passages.
        </p>
      )}
      {live?.log?.length > 1 && (
        <details className="kwLog">
          <summary>Progress of the build ({live.log.length} lines)</summary>
          <ol>
            {live.log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </details>
      )}
      {buildError && (
        <p className="stFErr" role="alert">
          {buildError}
        </p>
      )}
      {!base.keyAvailable && base.buildable && (
        <p className="stFWarn">This server has no embedding key, so it can’t build indexes. An operator has to set it.</p>
      )}

      <div className="kwActions">
        {base.buildable && (
          // a quiet button: the page's main one is the top bar's Save or Publish
          <button
            type="button"
            className="quietButton"
            disabled={building || !base.keyAvailable || base.sources.length === 0}
            onClick={() => onBuild(base.id)}
            title={dirty ? 'The server builds from the saved draft' : undefined}
          >
            {building ? 'Building…' : base.index ? 'Rebuild the index' : 'Build the index'}
          </button>
        )}
        {base.buildable && (
          <button type="button" className="quietButton" aria-expanded={searching} onClick={() => setSearching((v) => !v)} disabled={!base.index}>
            {searching ? 'Close the test' : 'Test a search'}
          </button>
        )}
        {base.buildable && !base.index && <small className="stMuted">Build the index before testing a search.</small>}
      </div>
      {searching && base.index && <SearchPanel botId={botId} base={base} config={config} />}
    </section>
  );
}

//   uploads: offer to upload here (off when the page has its own place to add documents above)
//   attachFirst: a first base made from an upload is read by the answering agent every turn, so no other step is needed
function FilesCard({ botId, files, bases, editor, onChanged, inputRef, uploads = true, attachFirst = false }) {
  const [uploading, setUploading] = useState(0); // uploads in progress (a drop during one starts another)
  const busy = uploading > 0;
  const [problems, setProblems] = useState([]);
  const [over, setOver] = useState(false);
  // what was just added, and the save it followed: the "not saved yet" note goes once the draft is saved from anywhere
  const savedAt = editor.meta?.savedAt || '';
  const [added, setAddedNote] = useState(null);
  const setAdded = (text) => setAddedNote(text ? { text, savedAt } : null);
  // an upload takes a while: what it adds goes into the draft as it is when the upload ends (with anything typed or
  // uploaded meanwhile), not as it was when the upload began
  const latest = useRef({ editor, files, bases });
  latest.current = { editor, files, bases };

  const upload = async (picked) => {
    const chosen = [...picked];
    if (!chosen.length) return;
    setUploading((n) => n + 1);
    const found = [];
    const uploaded = [];
    for (const file of chosen) {
      const bad = fileTypeProblem(file.name);
      if (bad) {
        found.push(bad);
        continue;
      }
      try {
        await api.uploadKnowledgeFile(botId, file.name, file);
        uploaded.push(file.name);
      } catch (e) {
        found.push(
          e?.status === 413
            ? `“${file.name}” is too big for this server (${formatBytes(file.size)}).`
            : e?.status === 400
              ? `“${file.name}”: ${e.message}`
              : `“${file.name}” didn’t upload: ${e?.message || 'something went wrong'}.`,
        );
      }
    }
    setProblems(found);
    setUploading((n) => n - 1);
    placeUploaded(uploaded);
    onChanged();
  };
  // A file only counts once a base lists it, so a new file goes where it obviously belongs: a new base when the agent
  // has none, the only base when it has one. With several, it waits for "Use in…", since only the author knows which.
  const placeUploaded = (names) => {
    const { editor, files, bases } = latest.current;
    const fresh = names.filter((name) => !files.some((f) => f.name === name && f.usedBy.length));
    if (!fresh.length) return;
    const config = editor.parsed.value;
    if (!config || typeof config !== 'object') return;
    const buildable = bases.filter((b) => b.buildable);
    const list = Array.isArray(config.knowledge) ? config.knowledge : [];
    if (list.length === 0 && attachFirst) {
      editor.setValue(fresh.reduce((c, name) => addKnowledgeFile(c, name), config));
      setAdded(`Added ${fresh.join(', ')} to what it knows: the agent that answers reads it in every conversation. Save the draft, then build the index.`);
    } else if (list.length === 0) {
      editor.setValue({
        ...config,
        knowledge: [{ id: 'knowledge', type: 'vector_store', mode: 'tool', sources: fresh.map((name) => ({ type: 'file', file_id: name })) }],
      });
      setAdded(`Made the knowledge base “knowledge” from ${fresh.join(', ')}. Save the draft, then build its index.`);
    } else if (buildable.length === 1) {
      editor.setValue(fresh.reduce((c, name) => addFileSource(c, buildable[0].id, name), config));
      setAdded(`Added ${fresh.join(', ')} to “${buildable[0].id}”. Save the draft, then rebuild its index.`);
    }
  };
  const remove = async (name, force = false) => {
    try {
      await api.deleteKnowledgeFile(botId, name, force);
      setProblems([]);
      onChanged();
    } catch (e) {
      if (e?.status === 409 && !force) {
        const anyway = await askConfirm({
          title: `Delete “${name}” anyway?`,
          body: `${e.message}\n\nThe index keeps what it had until it is rebuilt, and the base will say the file is missing.`,
          confirmLabel: 'Delete anyway',
          tone: 'danger',
        });
        if (anyway) remove(name, true);
        return;
      }
      setProblems([`“${name}” wasn’t deleted: ${e?.message || 'something went wrong'}.`]);
    }
  };
  const addTo = (file, baseId) => {
    const config = editor.parsed.value;
    if (baseId === '__new') {
      const id = slugify(file.name.replace(/\.[^.]+$/, '')).slice(0, 40) || 'knowledge';
      const taken = new Set((Array.isArray(config.knowledge) ? config.knowledge : []).map((b) => b?.id));
      let unique = id;
      let n = 2;
      while (taken.has(unique)) {
        unique = `${id}_${n}`;
        n += 1;
      }
      editor.setValue({
        ...config,
        knowledge: [
          ...(Array.isArray(config.knowledge) ? config.knowledge : []),
          { id: unique, type: 'vector_store', mode: 'tool', sources: [{ type: 'file', file_id: file.name }] },
        ],
      });
      setAdded(`Made the base “${unique}” from ${file.name}.`);
    } else {
      editor.setValue(addFileSource(config, baseId, file.name));
      setAdded(`Added ${file.name} to “${baseId}”.`);
    }
  };
  // the documents of the page's "What it knows" (in the draft, so one added a moment ago counts)
  const inDraft = attachFirst ? knowledgeOf(editor.parsed.value).files : [];
  // the status line above says what to do next (save, then build)
  const addToWhatItKnows = (file) => {
    editor.setValue(addKnowledgeFile(editor.parsed.value, file.name));
    setAdded(`Added ${file.name} to what it knows.`);
  };
  // who reads a file, in words: the page's "What it knows" (and whether that is saved yet), and any other base by name
  const readBy = (file) => {
    const others = file.usedBy.filter((id) => id !== KNOWLEDGE_ID).map((id) => humanize(id));
    const saved = file.usedBy.includes(KNOWLEDGE_ID);
    const mine = inDraft.includes(file.name) ? (saved ? 'What it knows' : 'What it knows, once saved') : saved ? 'Nothing, once saved' : '';
    return [mine, ...others].filter(Boolean).join(', ');
  };

  return (
    <section className="stCard kwFiles" aria-label="Files">
      <h3>{uploads ? 'Files' : 'Files on the server'}</h3>
      <p className="stMuted">
        {uploads
          ? 'Text, markdown, HTML, PDF, CSV or JSON. A file does nothing until a base lists it as a source; replacing a file makes any index built from it out of date.'
          : 'Every document uploaded for this agent. Remove one from “What it knows” above to stop it being read; delete it here to take it off the server.'}
      </p>
      {uploads && (
        <div
          className={`kwDrop ${over ? 'over' : ''}`}
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
          <button type="button" className="quietButton" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? 'Uploading…' : 'Upload files'}
          </button>
          <span className="stMuted">or drop them here</span>
        </div>
      )}
      {/* always here: a base's own "Upload" opens it, also when this card does not offer to upload */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        hidden
        aria-label="Choose files to upload"
        onChange={(event) => {
          upload(event.target.files);
          event.target.value = '';
        }}
      />
      {problems.length > 0 && (
        <ul className="kwProblemsList" role="alert">
          {problems.map((p) => (
            <li key={p} className="stFErr">
              {p}
            </li>
          ))}
        </ul>
      )}
      {added && added.savedAt === savedAt && attachFirst && (
        <p className="kwDone" role="status">
          {added.text}
        </p>
      )}
      {added && added.savedAt === savedAt && !attachFirst && (
        <p className="kwDone" role="status">
          {added.text} It is in the draft but not saved: the server builds from the saved draft.{' '}
          {editor.dirty && (
            <button type="button" className="stLink" onClick={() => editor.save()} disabled={editor.saving}>
              {editor.saving ? 'Saving…' : 'Save the draft'}
            </button>
          )}
        </p>
      )}
      {files.length === 0 ? (
        <p className="stFEmpty">No files uploaded yet.</p>
      ) : (
        <table className="kwTable">
          <thead>
            <tr>
              <th>Name</th>
              <th>Size</th>
              <th>Updated</th>
              <th>Read by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {files.map((file) => {
              const free = bases.filter((b) => b.buildable && !file.usedBy.includes(b.id));
              return (
                <tr key={file.name}>
                  <td>
                    <code>{file.name}</code>
                  </td>
                  <td>{formatBytes(file.size)}</td>
                  <td>{formatWhen(file.modified)}</td>
                  <td>
                    {attachFirst ? (
                      readBy(file) || <span className="stMuted">Nothing</span>
                    ) : file.usedBy.length ? (
                      file.usedBy.map((id) => humanize(id)).join(', ')
                    ) : (
                      <span className="stMuted">Nothing</span>
                    )}
                  </td>
                  <td className="kwRowActions">
                    {attachFirst ? (
                      // "What it knows" holds the documents: add the file there, not to a new base nothing reads
                      !inDraft.includes(file.name) && (
                        <button type="button" className="quietButton small" onClick={() => addToWhatItKnows(file)}>
                          Add to what it knows
                        </button>
                      )
                    ) : (
                      <SmartSelect
                        action
                        className="stFInput small"
                        ariaLabel={`Use ${file.name} in a base`}
                        placeholder="Use in…"
                        options={[...free.map((b) => ({ value: b.id, label: humanize(b.id) })), { value: '__new', label: 'a new base' }]}
                        onChange={(chosen) => {
                          if (chosen) addTo(file, chosen);
                        }}
                      />
                    )}
                    <button type="button" className="stFDel small" aria-label={`Delete ${file.name}`} onClick={() => remove(file.name)}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

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
          <button type="button" className="primaryCta compactCta" disabled={busy || editor.saving} onClick={onSaveAndBuild}>
            {action}
          </button>
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
            <button type="button" className="quietButton" onClick={() => editor.save()} disabled={editor.saving}>
              {editor.saving ? 'Saving…' : 'Save draft'}
            </button>
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
            <button type="button" className="quietButton" onClick={knowledge.reload}>
              Try again
            </button>
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
