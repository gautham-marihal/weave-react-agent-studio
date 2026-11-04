import React, { useState } from 'react';
import { Notice } from '../ui.jsx';
import { formatWhen } from '../format.js';
import { STATE_TEXT, baseState, fixActionFor, readableFix, isBuilding, lastLog, refreshNote, settingsOf } from './model.js';
import { KNOWLEDGE_ID, readersInWords, readersOf } from '../setup/setupModel.js';
import { entryAgentIndex } from '../simple/simpleModel.js';
import { agentLabel, humanize } from '../agent/rowNames.js';
import Button from '../../ui/Button.tsx';
import { SearchPanel } from './SearchPanels.jsx';

// The card for one knowledge base of the agent's own: who reads it, its sources, index and search.
// A base of the agent's own (beyond the page's "What it knows"), in words: name, kind, when and by whom it is read,
// sources, index and needs. A base nothing reads offers to give it to the agent that answers.
export default function BaseCard({ botId, base, config, build, buildError, onBuild, onUpload, onAttach, dirty }) {
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
              <Button type="button" size="small" onClick={() => onAttach(base.id)}>
                Let {agentLabel(config, entry.id)} use it
              </Button>
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
                  <Button type="button" onClick={onUpload}>
                    Upload a file
                  </Button>
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
          <Button
            type="button"
            disabled={building || !base.keyAvailable || base.sources.length === 0}
            onClick={() => onBuild(base.id)}
            title={dirty ? 'The server builds from the saved draft' : undefined}
          >
            {building ? 'Building…' : base.index ? 'Rebuild the index' : 'Build the index'}
          </Button>
        )}
        {base.buildable && (
          <Button type="button" aria-expanded={searching} onClick={() => setSearching((v) => !v)} disabled={!base.index}>
            {searching ? 'Close the test' : 'Test a search'}
          </Button>
        )}
        {base.buildable && !base.index && <small className="stMuted">Build the index before testing a search.</small>}
      </div>
      {searching && base.index && <SearchPanel botId={botId} base={base} config={config} />}
    </section>
  );
}
