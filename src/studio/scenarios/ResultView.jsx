import React from 'react';
import { Notice } from '../ui.jsx';
import TraceView from '../trace/TraceView.jsx';
import { describeExpectation } from './model.js';
import { nextSteps, resultSummary, tokenWords, tokensOf } from './runResults.js';
import Icon from '../../ui/Icon.jsx';

// What one scenario did in a run: the verdict in a line, each check with why, what to do about it (an unanswered API request gets an
// "Add a mock" button), the requests and tool calls, and the trace of what happened. Everything here comes from the server's answer.

const MARK = { true: 'check', false: 'close', null: 'minus' };
const checkClass = (passed) => (passed === true ? 'passed' : passed === false ? 'failed' : 'unchecked');

export default function ResultView({ result, scenario, onAddMock, mockAdded = [], onEdit }) {
  const steps = nextSteps(result, scenario);
  const unmocked = result.unmocked;
  return (
    <div className="scOutcome">
      <p className="scVerdict">{resultSummary(result)}</p>
      {(() => {
        const tokens = tokensOf(result);
        return tokens ? <p className="stMuted scUsage">The model used {tokenWords(tokens)}.</p> : null;
      })()}

      {unmocked.length > 0 && (
        <Notice
          kind="warn"
          title={unmocked.length === 1 ? 'The bot made a request that no mock answered' : `The bot made ${unmocked.length} requests that no mock answered`}
        >
          <p>A scenario never calls a real API. A request no mock matches is answered with a 404, which is the most common reason a scenario fails.</p>
          <ul className="scUnmocked">
            {unmocked.map((request, i) => {
              const key = `${request.method || ''} ${request.path}`;
              const added = mockAdded.includes(key);
              return (
                <li key={`${key}-${i}`}>
                  <code>{key.trim()}</code>
                  {onAddMock && (
                    <button type="button" className="quietButton" disabled={added} onClick={() => onAddMock(request)}>
                      {added ? 'Mock added: run it again' : 'Add a mock'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </Notice>
      )}

      {result.checks.length > 0 && (
        <ul className="scResults" aria-label="Checks">
          {result.checks.map((c, i) => (
            <li key={i} className={checkClass(c.passed)}>
              <b aria-hidden="true">
                <Icon name={MARK[String(c.passed)] || 'minus'} size={14} />
              </b>
              <span>
                <strong>{describeExpectation(c.expect)}</strong>
                <small>{c.passed === null ? `Not checked here. ${c.detail}` : c.detail}</small>
              </span>
            </li>
          ))}
        </ul>
      )}

      {steps.filter((s) => s.kind !== 'mock').length > 0 && (
        <ul className="scNext" aria-label="What to do next">
          {steps
            .filter((s) => s.kind !== 'mock')
            .map((s, i) => (
              <li key={i}>{s.text}</li>
            ))}
          {onEdit && (
            <li>
              <button type="button" className="stLink" onClick={onEdit}>
                Edit this scenario
              </button>
            </li>
          )}
        </ul>
      )}

      {result.notes.length > 0 && (
        <ul className="scNotes">
          {result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {(result.final_agent || Object.keys(result.final_state).length > 0) && (
        <p className="scFinal">
          {result.final_agent && (
            <>
              Ended with <strong>{result.final_agent}</strong> in charge.{' '}
            </>
          )}
          {Object.keys(result.final_state).length > 0 && (
            <>
              Final state: <code>{JSON.stringify(result.final_state)}</code>
            </>
          )}
        </p>
      )}

      {result.http.length > 0 && (
        <details className="scDetail">
          <summary>API requests ({result.http.length})</summary>
          <table className="scTable">
            <thead>
              <tr>
                <th>Request</th>
                <th>Status</th>
                <th>Answered by</th>
              </tr>
            </thead>
            <tbody>
              {result.http.map((h, i) => (
                <tr key={i} className={h.status >= 400 ? 'bad' : ''}>
                  <td>
                    <code>
                      {h.method} {h.path}
                    </code>
                  </td>
                  <td>{h.status}</td>
                  <td>{h.mocked ? 'a mock' : 'nothing'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {result.tools.length > 0 && (
        <details className="scDetail">
          <summary>Tool calls ({result.tools.length})</summary>
          <ul className="scTools">
            {result.tools.map((t, i) => (
              <li key={i}>
                <code>
                  {t.tool}({t.args && Object.keys(t.args).length ? JSON.stringify(t.args) : ''})
                </code>
                {t.error ? (
                  <span className="scErr"> failed: {String(t.error)}</span>
                ) : t.output != null ? (
                  <small> → {JSON.stringify(t.output).slice(0, 120)}</small>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      )}

      {result.events.length > 0 ? (
        <details className="scDetail" open={result.status === 'failed' || result.status === 'error' || undefined}>
          <summary>The trace ({result.events.length} records)</summary>
          <TraceView records={result.events} compact title="What the runner did" />
        </details>
      ) : (
        result.transcript.length > 0 && (
          <details className="scDetail">
            <summary>The conversation ({result.transcript.length} messages)</summary>
            <ol className="scTranscriptList">
              {result.transcript.map((m, i) => (
                <li key={i} className={m.role}>
                  <b>{m.role === 'user' || m.role === 'caller' ? 'Caller' : 'Agent'}</b> {m.text}
                </li>
              ))}
            </ol>
          </details>
        )
      )}
    </div>
  );
}
