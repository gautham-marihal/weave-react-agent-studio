import React, { useState } from 'react';
import { api } from '../../api/client.ts';
import { applyMinScore, describeScore, matchWords, normalizeSearch, settingsOf } from './model.js';
import { Section } from '../agent/PageShell.jsx';
import Button from '../../ui/Button.tsx';
import { Input } from '../../ui/Input.tsx';

// The Knowledge page's two search checks: a test search inside one base, and the page's own "find" under What it knows.
export function SearchPanel({ botId, base, config }) {
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
        <Input
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
          <Input
            size="small"
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
            <Input
              size="small"
              type="text"
              value={previous}
              maxLength={4000}
              onChange={(event) => setPrevious(event.target.value)}
              aria-label="What the bot said just before"
            />
          </label>
        )}
        <Button type="submit" variant="primary" size="compact" disabled={state.busy || !query.trim()}>
          {state.busy ? 'Searching…' : 'Search'}
        </Button>
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
export function FindPanel({ botId, base, config }) {
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
        <Input
          type="text"
          value={query}
          placeholder="For example: how do I get a refund?"
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Something a caller might ask"
          maxLength={2000}
        />
        <Button type="submit" disabled={state.busy || !query.trim()}>
          {state.busy ? 'Looking…' : 'Find answers'}
        </Button>
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
