import React, { useMemo, useState } from 'react';
import Fold from '../../ui/Fold.jsx';
import { useConfigSelect } from './ctx.js';
import { useResultPreview } from './usePreview.js';
import { sampleArgs, taskWords } from './serverPreview.js';
import WhatIfBar, { useWhatIf } from './WhatIfBar.jsx';
import { PREVIEW_SOURCE } from './tryPanels.js';

// "Try it" for one tool, answered by the server: type the arguments the model would give, paste an answer the API might send, and see the
// request that would go out (the address, query, body, which secrets it would use), whether the tool's preconditions hold, what the
// model would be shown of the answer (exactly as it reads it), what is kept in state, what goes straight to the caller, and which effects
// fire. Nothing is called and nothing is spent. It reads what is in the editor, saved or not. The sample answer is never saved.

function Json({ value }) {
  return <code className="stTryJson">{typeof value === 'string' ? value : JSON.stringify(value)}</code>;
}

export default function TryIt({ toolId, parameters, sample, sampleError, hasSample }) {
  const config = useConfigSelect((c) => c, Object.is);
  const [argsText, setArgsText] = useState(() => JSON.stringify(sampleArgs(parameters), null, 2));
  const parsed = useMemo(() => {
    try {
      const v = JSON.parse(argsText || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? { args: v } : { error: 'The arguments must be a JSON object.' };
    } catch (e) {
      return { error: `Not valid JSON (${e.message}).` };
    }
  }, [argsText]);
  const what = useWhatIf(config);
  const result = useResultPreview({
    config,
    tool: toolId,
    args: parsed.args,
    response: hasSample && !sampleError ? sample : undefined,
    state: what.state,
    channel: what.channel,
    nowLocal: what.nowLocal,
    enabled: !!toolId && !parsed.error,
  });
  const view = result.data;

  return (
    <section className="stTryIt" aria-label="Try this tool">
      <h5>Try it {result.source && <span className={`stTag ${result.source === 'server' ? 'good' : ''}`}>{PREVIEW_SOURCE[result.source]}</span>}</h5>
      <p className="stFHelp">
        Nothing is called and nothing is spent: the server shows what <em>would</em> go out and what the model <em>would</em> be shown.
      </p>
      <label className="stTryArgs">
        <span>The arguments the model gives</span>
        <textarea
          className="stFInput mono"
          rows={3}
          spellCheck={false}
          value={argsText}
          aria-label="Sample arguments"
          aria-invalid={!!parsed.error || undefined}
          onChange={(event) => setArgsText(event.target.value)}
        />
        {parsed.error && <small className="stFErr">{parsed.error}</small>}
      </label>
      <Fold className="stTryWhatIf" open={what.changed}>
        <summary>What if… {what.changed && <span className="stTag">changed</span>}</summary>
        <p className="stFHelp">A tool can depend on the time, the channel or what has been remembered so far. Change them to see how this tool would behave.</p>
        <WhatIfBar config={config} what={what} phone={false} />
      </Fold>
      {!hasSample && <p className="stMuted">Paste a sample answer above to also see what the model would be shown of it.</p>}
      {result.note && (
        <p className="stFWarn" role="note">
          {result.note}
        </p>
      )}
      {result.loading && !view && (
        <p className="stMuted" role="status">
          Asking the server…
        </p>
      )}
      {result.error && (
        <p className="stFErr" role="alert">
          The server couldn’t build this preview: {result.error.message}
          {result.error.kind === 'not_found' ? ' (save the draft, or check the tool’s id)' : ''}
        </p>
      )}

      {view && (
        <div className="stTryOut">
          {view.argsProblems.length > 0 && (
            <ul className="stTryProblems">
              {view.argsProblems.map((p) => (
                <li key={p} className="stFWarn">
                  {p}
                </li>
              ))}
            </ul>
          )}
          {view.preconditions && !view.preconditions.holds && (
            <p className="stFWarn">
              The tool’s preconditions don’t hold with these values, so the model would be told: <em>{view.preconditions.message || 'no message'}</em>
            </p>
          )}
          {view.preconditions?.holds && <p className="stFOk">The tool’s preconditions hold.</p>}
          {view.task && (
            <p className="stFHelp" data-block="task">
              {taskWords(view.task)}
            </p>
          )}
          {view.request && (
            <div className="stTryBlock" data-block="request">
              <strong>The request that would be sent</strong>
              <p>
                <code className="stTryCall">
                  {view.request.method} {view.request.url}
                </code>
              </p>
              {Object.keys(view.request.query).length > 0 && (
                <p>
                  <em>query</em> <Json value={view.request.query} />
                </p>
              )}
              {Object.keys(view.request.headers).length > 0 && (
                <p>
                  <em>headers</em> <Json value={view.request.headers} />
                </p>
              )}
              {view.request.body !== null && (
                <p>
                  <em>body</em> <Json value={view.request.body} />
                </p>
              )}
              {view.request.auth && view.request.auth.type !== 'none' && (
                <p>
                  <em>signed with</em> {view.request.auth.type}
                  {view.request.auth.secrets.length ? (
                    <>
                      {' '}
                      using the secret{view.request.auth.secrets.length === 1 ? '' : 's'}{' '}
                      {view.request.auth.secrets.map((s) => (
                        <code key={s}>{s}</code>
                      ))}
                    </>
                  ) : null}
                </p>
              )}
            </div>
          )}
          {view.hasAnswer && (
            <div className="stTryBlock" data-block="answer">
              <strong>What the model would read of that answer</strong>
              <pre className="stTryRead" aria-label="What the model reads">
                {view.modelSeesText || '(nothing)'}
              </pre>
              {Object.keys(view.storedInState).length > 0 && (
                <p>
                  <em>kept in state</em>{' '}
                  {Object.entries(view.storedInState).map(([k, v]) => (
                    <span key={k}>
                      <code>{k}</code> = <Json value={v} />{' '}
                    </span>
                  ))}
                </p>
              )}
              {view.keptFromModel.length > 0 && (
                <p>
                  <em>sent straight to the caller, not shown to the model</em>{' '}
                  {view.keptFromModel.map((f) => (
                    <code key={f}>{f}</code>
                  ))}
                </p>
              )}
              {view.effects.length > 0 ? (
                <ul className="stTryEffects">
                  {view.effects.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              ) : (
                <p className="stMuted">No effects fire.</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
