import React, { useState } from 'react';
import { api } from '../../../../api/client.ts';
import Button from '../../../../ui/Button.tsx';
import Fold from '../../../../ui/Fold.jsx';
import { Input, TextArea } from '../../../../ui/Input.tsx';
import { OneOf, Choice } from '../../../../ui/OneOf.tsx';
import { SCORE_BANDS, normalizeSearch, readingState, settingsOf } from '../../../knowledge/model.js';
import { humanize } from '../../../form/engine.js';
import { docBase, searchProblem, searchable } from './knowledgeView.js';
import './knowledge.css';

// Build › Knowledge › "Try a search" (FRONTEND_GUIDE 10.2, POST …/knowledge/{base}/search, a read): what a caller
// might ask, and what it would find. Every passage sits on one 0-to-1 scale beside where related and unrelated text
// usually score, with the saved "How closely a passage must match" line on it. Moving the line is a try-out only: the
// setting stays in "How it searches", and a link goes there. Any base can be searched; nothing is saved.
//   ctx: the Detailed page's (config, botId, knowledgeRead)

const list = (v) => (Array.isArray(v) ? v : []);
const pct = (v) => `${Math.max(0, Math.min(1, v)) * 100}%`;
const two = (v) => (typeof v === 'number' ? v.toFixed(2) : '');

// bring the saved setting into view, glowing, with the focus in it
function showSetting(field) {
  const row = document.querySelector(`[data-field="${field}"]`);
  if (!row) return;
  row.scrollIntoView({ block: 'center' });
  row.classList.remove('dtFlash');
  row.getBoundingClientRect();
  row.classList.add('dtFlash');
  row.querySelector('input, textarea, button, [tabindex]')?.focus({ preventScroll: true });
}

function Scale({ hits, line, saved }) {
  const marks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="kxScale" role="img" aria-label={`Scores of the passages found: ${hits.map((h, i) => `${i + 1} at ${two(h.score)}`).join(', ')}`}>
      {SCORE_BANDS.filter(([, , words]) => words === 'Unrelated' || words === 'Related').map(([from, to, words]) => (
        <React.Fragment key={words}>
          <span className={`kxBand ${words === 'Related' ? 'rel' : 'unrel'}`} style={{ left: pct(from), width: pct(to - from) }} />
          <span className="kxBandLab" style={{ left: pct((from + to) / 2) }}>
            usually {words.toLowerCase()}
          </span>
        </React.Fragment>
      ))}
      <span className="kxAxis" />
      {marks.map((t) => (
        <span key={t} className="kxTick" style={{ left: pct(t) }}>
          {t.toFixed(2)}
        </span>
      ))}
      {hits.map((h, i) => (
        <span key={i} className={`kxDot ${h.score < line ? 'drop' : ''}`} style={{ left: pct(h.score) }} title={`${h.source || 'A passage'}: ${two(h.score)}`}>
          {i + 1}
        </span>
      ))}
      {typeof saved === 'number' && line !== saved && <span className="kxLine saved" style={{ left: pct(saved) }} />}
      <span className="kxLine" style={{ left: pct(line) }}>
        <span>{two(line)}</span>
      </span>
    </div>
  );
}

export default function KnowledgeSearch({ ctx }) {
  const bases = searchable(ctx.config);
  const own = docBase(ctx.config);
  const [chosen, setChosen] = useState('');
  const base = bases.find((b) => b.id === chosen) || own || bases[0];
  const [query, setQuery] = useState('');
  const [before, setBefore] = useState('');
  const [count, setCount] = useState('');
  const [answer, setAnswer] = useState({ busy: false, problem: '', found: null, base: '' });
  const settings = base ? settingsOf(ctx.config, base.id) : {};
  const [line, setLine] = useState(null);
  if (!base) return null;
  const saved = settings.minScore;
  const at = line ?? saved ?? 0;
  const known = ctx.knowledgeRead ? list(ctx.knowledgeRead.bases).find((b) => b.id === base.id) : null;
  const unsaved = !!ctx.knowledgeRead && readingState(known, { draftSources: base.type === 'vector_store' ? base.sources : undefined }).state === 'unsaved';
  const run = async (event) => {
    event.preventDefault();
    if (!query.trim()) return;
    setAnswer({ busy: true, problem: '', found: null, base: base.id });
    try {
      const raw = await api.searchKnowledge(ctx.botId, base.id, {
        query: query.trim(),
        ...(count ? { top_k: Number(count) } : {}),
        ...(before.trim() ? { previous_reply: before.trim() } : {}),
        ref: 'draft',
      });
      setAnswer({ busy: false, problem: '', found: normalizeSearch(raw), base: base.id });
    } catch (e) {
      setAnswer({ busy: false, problem: searchProblem(e, base.id), found: null, base: base.id });
    }
  };
  const found = answer.base === base.id ? answer.found : null;
  const problem = answer.base === base.id ? answer.problem : '';
  const hits = list(found?.hits);
  const scored = hits.filter((h) => typeof h.score === 'number');
  const kept = hits.filter((h) => typeof h.score !== 'number' || h.score >= at);
  const inject = (base.mode || 'tool') === 'inject';
  const setting = base.id === own?.id ? 'knowledge.score' : '';

  return (
    <div className="kxSearch">
      {bases.length > 1 && (
        <OneOf
          className="kxSeg"
          label="Search in"
          value={base.id}
          onChange={(id) => {
            setChosen(id);
            setLine(null);
          }}
        >
          {bases.map((b) => (
            <Choice key={b.id} value={b.id}>
              {b.id === own?.id ? 'Documents and pages' : `${humanize(b.id)} · your service`}
            </Choice>
          ))}
        </OneOf>
      )}
      {unsaved && (
        <p className="kxNote" role="note">
          The server searches what is saved: save the draft to search what you see here.
        </p>
      )}
      <form className="kxAsk" onSubmit={run} role="search" aria-label="Try a search">
        <Fold className="kxFollow" open={!!before}>
          <summary>A follow-up: after the agent said…</summary>
          <label className="srOnly" htmlFor="kx-before">
            What the agent said before
          </label>
          <TextArea
            id="kx-before"
            rows={2}
            value={before}
            maxLength={2000}
            placeholder="Our routers come with a 2-year warranty."
            onChange={(event) => setBefore(event.target.value)}
          />
          <small className="dtNote">
            {!inject
              ? 'When the model searches, it writes what to search for itself, so this changes nothing here.'
              : base.retrieval?.query_from === 'last_user'
                ? 'It searches for the caller’s newest words only, so this changes nothing here.'
                : 'It searches for this reply and the newest words together, as on a call.'}
          </small>
        </Fold>
        <div className="kxAskLine">
          <label className="srOnly" htmlFor="kx-query">
            Something a caller might ask
          </label>
          <Input id="kx-query" value={query} maxLength={2000} placeholder="Do you open on Saturdays?" onChange={(event) => setQuery(event.target.value)} />
          <label className="kxCount">
            <span>Passages</span>
            <Input
              size="small"
              type="number"
              min="1"
              max="20"
              value={count}
              placeholder={String(settings.topK || 4)}
              aria-label="How many passages to ask for"
              onChange={(event) => setCount(event.target.value)}
            />
          </label>
          <Button type="submit" variant="primary" size="compact" disabled={answer.busy || !query.trim() || !ctx.botId}>
            {answer.busy ? 'Searching…' : 'Search'}
          </Button>
        </div>
      </form>
      {problem && (
        <p className="stFieldError" role="alert">
          {problem}
        </p>
      )}
      {found && (
        <div className="kxMeter" role="status">
          <div className="kxMeterTop">
            <span>
              {hits.length ? (
                <>
                  <b>
                    {hits.length} passage{hits.length === 1 ? '' : 's'}
                  </b>{' '}
                  found, <b>{kept.length}</b> given to the agent
                </>
              ) : (
                'Nothing it has read matches this.'
              )}
            </span>
            {typeof found.ms === 'number' && <span>{found.ms} ms</span>}
          </div>
          {found.queryUsed && found.queryUsed !== query.trim() && (
            <p className="dtNote">
              Searched for: <q>{found.queryUsed}</q>
            </p>
          )}
          {scored.length > 0 && (
            <>
              <Scale hits={hits.filter((h) => typeof h.score === 'number')} line={at} saved={saved} />
              <div className="kxSlider">
                <label htmlFor="kx-line">What if the line were at</label>
                <input id="kx-line" type="range" min="0" max="1" step="0.01" value={at} onChange={(event) => setLine(Number(event.target.value))} />
                <output htmlFor="kx-line">{two(at)}</output>
              </div>
              <p className="dtNote">
                {typeof saved === 'number' ? `Saved: ${two(saved)}` : 'Nothing is saved, so every passage found is given'}
                {setting && (
                  <>
                    {' · '}
                    <button type="button" className="kxLink" onClick={() => showSetting(setting)}>
                      change it under How it searches
                    </button>
                  </>
                )}
                {typeof saved === 'number' && at < saved && ' · The server leaves out passages under the saved line, so a lower line shows nothing new here.'}
              </p>
            </>
          )}
          {hits.length > 0 && (
            <ol className="kxHits">
              {hits.map((h, i) => {
                const drop = typeof h.score === 'number' && h.score < at;
                return (
                  <li key={i} className={`kxHit ${drop ? 'drop' : ''}`}>
                    <span className="kxN" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span>
                      <p>{h.text}</p>
                      <small>
                        {h.source || `Passage ${i + 1}`}
                        {drop ? ' · dropped: under the line' : ''}
                      </small>
                    </span>
                    {typeof h.score === 'number' && <span className="kxSc">{two(h.score)}</span>}
                  </li>
                );
              })}
            </ol>
          )}
          {found.modelIsShown && (
            <>
              <div className="kxSeesHead">
                <span>What the agent is given{line !== null && line !== saved ? ', with the saved setting' : ''}</span>
                <span className="kxPill grey">
                  <i aria-hidden="true" />
                  {inject ? 'Before every reply' : 'When the model searches'}
                </span>
              </div>
              <pre className="kxSees">{found.modelIsShown}</pre>
            </>
          )}
          {found.note && <p className="dtNote">{found.note}</p>}
        </div>
      )}
    </div>
  );
}
