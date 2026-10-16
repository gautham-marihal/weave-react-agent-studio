import { useEffect, useMemo, useRef, useState } from 'react';
import SmartSelect from '../SmartSelect.jsx';
import { api } from '../../api/client.js';
import { DemoNote } from '../../demo/DemoBadge.jsx';
import { Notice } from '../ui.jsx';
import { formatWhen, slugify } from '../format.js';
import { navigate, routeHref } from '../route.js';
import { useBuilds, useKnowledge } from './useKnowledge.js';
import {
  ACCEPT_ATTRIBUTE, STATE_TEXT, addFileSource, applyMinScore, baseState, describeScore, fileTypeProblem, fixActionFor, formatBytes, isBuilding, knowledgeSummary, lastLog, normalizeSearch, settingsOf,
} from './model.js';
import './knowledge.css';

// Knowledge: the files and web pages an agent answers from. A "vector store" base is searched from an index built BEFORE calls, so this is
// where someone uploads the files, builds the index, and tries a search to see what the model would be shown and how well each passage
// scored (the scores are how `min_score` is chosen). It works from the SAVED draft: that is what the server builds and searches.

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
      const raw = await api.searchKnowledge(botId, base.id, { query: query.trim(), ...(topK ? { top_k: Number(topK) } : {}), ...(inject && previous.trim() ? { previous_reply: previous.trim() } : {}), ref: 'draft' });
      setState({ busy: false, error: '', answer: { ...normalizeSearch(raw), note: typeof raw?.note === 'string' ? raw.note : '' } });
    } catch (e) {
      setState({ busy: false, error: e?.message || 'The search failed.', answer: null });
    }
  };
  const hits = state.answer ? applyMinScore(state.answer.hits, settings.minScore) : [];
  const dropped = hits.filter((h) => !h.kept).length;
  return (
    <form className="kwSearch" onSubmit={run} aria-label={`Test a search of ${base.id}`}>
      <label><span>What a caller might say</span>
        <input className="stFInput" type="text" value={query} placeholder="e.g. how do I get a refund?" onChange={(event) => setQuery(event.target.value)} aria-label="Search text" maxLength={2000} />
      </label>
      <div className="kwSearchRow">
        <label><span>Passages to ask for</span>
          <input className="stFInput small" type="number" min="1" max="20" value={topK} placeholder={String(settings.topK ?? 4)} onChange={(event) => setTopK(event.target.value)} aria-label="Passages to ask for" />
        </label>
        {inject && (
          <label className="kwWide"><span>What the bot said just before <em>(optional: shows how a follow-up is searched)</em></span>
            <input className="stFInput small" type="text" value={previous} maxLength={4000} onChange={(event) => setPrevious(event.target.value)} aria-label="What the bot said just before" />
          </label>
        )}
        <button type="submit" className="primaryCta compactCta" disabled={state.busy || !query.trim()}>{state.busy ? 'Searching…' : 'Search'}</button>
      </div>
      {state.error && <p className="stFErr" role="alert">{state.error}</p>}
      {state.answer && (
        <div className="kwResults" role="status">
          {state.answer.note && <p className="stFWarn" role="note">{state.answer.note}</p>}
          <p className="stMuted">{hits.length} passage{hits.length === 1 ? '' : 's'}{state.answer.ms !== undefined ? ` in ${state.answer.ms} ms` : ''}{settings.minScore !== undefined ? ` · this base drops anything scoring under ${settings.minScore}${dropped ? ` (${dropped} of these)` : ''}` : ' · no minimum score is set, so every passage found is kept'}.</p>
          {hits.length === 0 && <p className="stFEmpty">Nothing matched. Either the index doesn’t have this, or the question is worded very differently from the material.</p>}
          <ol className="kwHits">
            {hits.map((hit, index) => (
              <li key={index} className={hit.kept ? '' : 'dropped'}>
                <header>
                  {hit.score !== undefined && <span className="kwScore" title={`${describeScore(hit.score)}. With the default embeddings, related text scores about 0.5 to 0.75 and unrelated text below 0.25.`}><i style={{ width: `${Math.round(Math.min(1, hit.score) * 100)}%` }} />{hit.score.toFixed(2)}</span>}
                  <small>{describeScore(hit.score)}{hit.source ? ` · ${hit.source}` : ''}{hit.kept ? '' : ' · dropped by min_score'}</small>
                </header>
                <p>{hit.text}</p>
              </li>
            ))}
          </ol>
          {state.answer.modelIsShown && <details className="kwShown"><summary>What the model is shown</summary><pre>{state.answer.modelIsShown}</pre></details>}
          <p className="stFHelp">Scores are how you choose <code>retrieval.min_score</code>: set it just under what a good answer scores and above what an unrelated one does. Other embeddings score differently.</p>
        </div>
      )}
    </form>
  );
}

function BaseCard({ botId, base, config, build, buildError, onBuild, onUpload, dirty }) {
  const [searching, setSearching] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const live = build || base.build;
  const state = baseState({ ...base, build: live });
  const info = STATE_TEXT[state];
  const building = isBuilding(live);
  const unused = base.usedBy.agents.length === 0 && base.usedBy.tools.length === 0;
  return (
    <section className={`stCard kwBase ${state}`} data-base={base.id} aria-label={`Knowledge base ${base.id}`}>
      <header className="kwHead">
        <div>
          <h3>{base.id}</h3>
          <p className="stMuted">{base.type === 'vector_store' ? 'Files and web pages, searched from an index' : 'An external search service you already run'} · {base.mode === 'inject' ? 'searched on every caller turn' : 'the model decides when to search'}</p>
        </div>
        <span className={`kwState ${info.tone}`} title={info.hint}>{info.label}</span>
      </header>

      <p className="kwUsed">
        {unused ? <span className="stFWarn">No agent or tool uses this base, so nothing reads it. Give an agent a knowledge tool for it, or list it under the agent’s knowledge.</span>
          : <>Used by {[...base.usedBy.agents.map((a) => `agent ${a}`), ...base.usedBy.tools.map((t) => `tool ${t}`)].join(', ')}.</>}
      </p>

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
              Index built {formatWhen(base.index.builtAt)}: <strong>{base.index.passages.toLocaleString()}</strong> passage{base.index.passages === 1 ? '' : 's'}{base.index.embedding ? ` with ${base.index.embedding}` : ''}.
              {base.index.documents.length > 0 && <> <button type="button" className="stLink" aria-expanded={showDocs} onClick={() => setShowDocs((v) => !v)}>{showDocs ? 'Hide' : 'Show'} the {base.index.documents.length} document{base.index.documents.length === 1 ? '' : 's'}</button></>}
            </p>
          ) : <p className="kwIndex stMuted">There is no index yet: searches find nothing until one is built.</p>}
          {showDocs && base.index && <ul className="kwDocs">{base.index.documents.map((d) => <li key={d.name}><code>{d.name}</code>{d.passages !== undefined ? <small> {d.passages} passage{d.passages === 1 ? '' : 's'}</small> : null}</li>)}</ul>}
        </>
      )}

      {base.problems.length > 0 && (
        <ul className="kwProblems" aria-label="Problems">
          {base.problems.map((p, i) => {
            const action = fixActionFor(p);
            return (
              <li key={i}>
                <strong>{p.problem}</strong>{p.fix && <span> {p.fix}</span>}
                {action === 'build' && base.buildable && !building && <button type="button" className="quietButton" onClick={() => onBuild(base.id)} disabled={!base.keyAvailable}>Build now</button>}
                {action === 'upload' && <button type="button" className="quietButton" onClick={onUpload}>Upload a file</button>}
              </li>
            );
          })}
        </ul>
      )}

      {building && (
        <div className="kwBuilding" role="status" aria-live="polite"><i className="pvSpin" aria-hidden="true" /><span><strong>Building the index…</strong> {lastLog(live)}</span></div>
      )}
      {live?.status === 'failed' && <Notice kind="error" title="The last build failed">{live.error || 'No reason was given.'} {base.index ? 'The previous index is still answering.' : ''}</Notice>}
      {live?.status === 'done' && live.passages !== undefined && !building && <p className="kwDone" role="status">Build finished: {live.passages.toLocaleString()} passages.</p>}
      {live?.log?.length > 1 && <details className="kwLog"><summary>Progress of the build ({live.log.length} lines)</summary><ol>{live.log.map((line, i) => <li key={i}>{line}</li>)}</ol></details>}
      {buildError && <p className="stFErr" role="alert">{buildError}</p>}
      {!base.keyAvailable && base.buildable && <p className="stFWarn">This server has no embedding key, so it can’t build indexes. An operator has to set it.</p>}

      <div className="kwActions">
        {base.buildable && <button type="button" className="primaryCta compactCta" disabled={building || !base.keyAvailable || base.sources.length === 0} onClick={() => onBuild(base.id)} title={dirty ? 'The server builds from the saved draft' : undefined}>{building ? 'Building…' : base.index ? 'Rebuild the index' : 'Build the index'}</button>}
        {base.buildable && <button type="button" className="quietButton" aria-expanded={searching} onClick={() => setSearching((v) => !v)} disabled={!base.index}>{searching ? 'Close the test' : 'Test a search'}</button>}
        {base.buildable && !base.index && <small className="stMuted">Build the index before testing a search.</small>}
      </div>
      {searching && base.index && <SearchPanel botId={botId} base={base} config={config} />}
    </section>
  );
}

function FilesCard({ botId, files, bases, editor, onChanged, inputRef }) {
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState([]);
  const [over, setOver] = useState(false);
  const [added, setAdded] = useState(null);

  const upload = async (picked) => {
    const chosen = [...picked];
    if (!chosen.length) return;
    setBusy(true);
    const found = [];
    for (const file of chosen) {
      const bad = fileTypeProblem(file.name);
      if (bad) { found.push(bad); continue; }
      try {
        await api.uploadKnowledgeFile(botId, file.name, file);
      } catch (e) {
        found.push(e?.status === 413 ? `“${file.name}” is too big for this server (${formatBytes(file.size)}).` : e?.status === 400 ? `“${file.name}”: ${e.message}` : `“${file.name}” didn’t upload: ${e?.message || 'something went wrong'}.`);
      }
    }
    setProblems(found);
    setBusy(false);
    onChanged();
  };
  const remove = async (name, force = false) => {
    try { await api.deleteKnowledgeFile(botId, name, force); setProblems([]); onChanged(); } catch (e) {
      if (e?.status === 409 && !force) { if (window.confirm(`${e.message}\n\nDelete it anyway? The index keeps what it had until it is rebuilt, and the base will say the file is missing.`)) remove(name, true); return; }
      setProblems([`“${name}” wasn’t deleted: ${e?.message || 'something went wrong'}.`]);
    }
  };
  const addTo = (file, baseId) => {
    const config = editor.parsed.value;
    if (baseId === '__new') {
      const id = slugify(file.name.replace(/\.[^.]+$/, '')).slice(0, 40) || 'knowledge';
      const taken = new Set((Array.isArray(config.knowledge) ? config.knowledge : []).map((b) => b?.id));
      let unique = id; let n = 2;
      while (taken.has(unique)) { unique = `${id}_${n}`; n += 1; }
      editor.setValue({ ...config, knowledge: [...(Array.isArray(config.knowledge) ? config.knowledge : []), { id: unique, type: 'vector_store', mode: 'tool', sources: [{ type: 'file', file_id: file.name }] }] });
      setAdded(`Made the base “${unique}” from ${file.name}.`);
    } else {
      editor.setValue(addFileSource(config, baseId, file.name));
      setAdded(`Added ${file.name} to “${baseId}”.`);
    }
  };

  return (
    <section className="stCard kwFiles" aria-label="Files">
      <h3>Files</h3>
      <p className="stMuted">Text, markdown, HTML, PDF, CSV or JSON. A file does nothing until a base lists it as a source; replacing a file makes any index built from it out of date.</p>
      <div className={`kwDrop ${over ? 'over' : ''}`} onDragOver={(event) => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(event) => { event.preventDefault(); setOver(false); upload(event.dataTransfer.files); }}>
        <button type="button" className="primaryCta compactCta" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? 'Uploading…' : 'Upload files'}</button>
        <span className="stMuted">or drop them here</span>
        <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTRIBUTE} hidden aria-label="Choose files to upload" onChange={(event) => { upload(event.target.files); event.target.value = ''; }} />
      </div>
      {problems.length > 0 && <ul className="kwProblemsList" role="alert">{problems.map((p) => <li key={p} className="stFErr">{p}</li>)}</ul>}
      {added && <p className="kwDone" role="status">{added} It is in the draft but not saved: the server builds from the saved draft. {editor.dirty && <button type="button" className="stLink" onClick={() => editor.save()} disabled={editor.saving}>{editor.saving ? 'Saving…' : 'Save the draft'}</button>}</p>}
      {files.length === 0 ? <p className="stFEmpty">No files uploaded yet.</p> : (
        <table className="kwTable">
          <thead><tr><th>Name</th><th>Size</th><th>Updated</th><th>Read by</th><th /></tr></thead>
          <tbody>
            {files.map((file) => {
              const free = bases.filter((b) => b.buildable && !file.usedBy.includes(b.id));
              return (
                <tr key={file.name}>
                  <td><code>{file.name}</code></td>
                  <td>{formatBytes(file.size)}</td>
                  <td>{formatWhen(file.modified)}</td>
                  <td>{file.usedBy.length ? file.usedBy.join(', ') : <span className="stMuted">no base</span>}</td>
                  <td className="kwRowActions">
                    <SmartSelect action className="stFInput small" ariaLabel={`Use ${file.name} in a base`} placeholder="Use in…" options={[...free.map((b) => b.id), { value: '__new', label: 'a new base' }]} onChange={(chosen) => { if (chosen) addTo(file, chosen); }} />
                    <button type="button" className="stFDel small" aria-label={`Delete ${file.name}`} onClick={() => remove(file.name)}>Delete</button>
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

export default function KnowledgeTab({ botId, name, editor, pollMs }) {
  const config = editor.parsed.value;
  const ready = editor.status === 'ready' && editor.isObject && !editor.parsed.error;
  const knowledge = useKnowledge(botId);
  const inputRef = useRef(null);
  const { builds, errors, start, follow } = useBuilds(botId, { onChange: () => knowledge.reload(), pollMs });
  const data = knowledge.data;
  const summary = useMemo(() => knowledgeSummary(data), [data]);
  // a base that was already building when the screen opened (or in another tab) is followed too
  useEffect(() => {
    (data?.bases || []).forEach((base) => { if (isBuilding(base.build) && !builds[base.id]) follow(base.id); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!ready) return <Notice kind="warn" title="The draft can’t be read right now">Fix the JSON on the Config tab first.</Notice>;

  const unsavedBases = JSON.stringify((config?.knowledge || []).map((b) => b?.id)) !== JSON.stringify((data?.bases || []).map((b) => b.id));
  return (
    <div className="kwTab">
      <section className="stCard kwIntro">
        <h3>Knowledge</h3>
        <p className="stMuted">What {name} can look things up in. A base made of <strong>files and web pages</strong> is searched from an index that has to be built before calls; a base that asks <strong>your own search service</strong> has nothing to build. Here you upload files, build the index, and try a search to see what the model would be shown.</p>
      </section>

      <DemoNote kind="knowledge">There is no embedding model in demo mode: the index is a plain word index in this browser, and the scores come from shared words. Real scores will differ.</DemoNote>
      {data && !data.keyAvailable && <Notice kind="warn" title="This server can’t build indexes yet">It has no key for the embedding model, so building will be refused. An operator has to set it; searching an index that is already built still works.</Notice>}
      {(editor.dirty || unsavedBases) && (
        <Notice kind="info" title="Knowledge works from the saved draft" actions={<button type="button" className="quietButton" onClick={() => editor.save()} disabled={editor.saving}>{editor.saving ? 'Saving…' : 'Save draft'}</button>}>
          The server builds and searches what is saved, not what is in the editor. Save to include your latest changes to the bases.
        </Notice>
      )}
      {knowledge.error && <Notice kind="error" title="Knowledge couldn’t be read" actions={<button type="button" className="quietButton" onClick={knowledge.reload}>Try again</button>}>{knowledge.error.message}</Notice>}
      {knowledge.loading && !data && <p className="stMuted" role="status">Loading knowledge…</p>}

      {data && summary.total > 0 && (
        <p className="kwSummary" role="status">
          {summary.total} base{summary.total === 1 ? '' : 's'}: <b className="ok">{summary.ready} ready</b>{summary.needsBuild > 0 && <>, <b className="bad">{summary.needsBuild} need{summary.needsBuild === 1 ? 's' : ''} building</b></>}{summary.building > 0 && <>, {summary.building} building</>}.
        </p>
      )}

      {data && data.bases.map((base) => (
        <BaseCard key={base.id} botId={botId} base={base} config={config} build={builds[base.id]} buildError={errors[base.id]} dirty={editor.dirty} onBuild={start} onUpload={() => inputRef.current?.click()} />
      ))}

      {data && data.bases.length === 0 && !knowledge.loading && (
        <section className="stCard kwEmpty">
          <strong>This agent has no knowledge bases yet</strong>
          <p className="stMuted">Upload a file below, then use “Use in… a new base”. Or add one by hand in Config → Knowledge. A base is only read by an agent that has a knowledge tool for it, or lists it under its own knowledge.</p>
          <button type="button" className="quietButton" onClick={() => navigate(routeHref(botId, 'config'), { guard: false })}>Open Config</button>
        </section>
      )}

      {data && <FilesCard botId={botId} files={data.files} bases={data.bases} editor={editor} inputRef={inputRef} onChanged={knowledge.reload} />}
    </div>
  );
}
