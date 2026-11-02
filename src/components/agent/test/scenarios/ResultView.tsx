import React from 'react';
import { CheckIcon, MinusIcon, XIcon } from 'lucide-react';
import { Button } from '../../../ui/Button';
import { cn } from '../../../../utils/styles';
import { describeExpectation, type Obj, type RequestSeen } from '../../../../models/scenario';
import { nextSteps, resultSummary, tokenWords, tokensOf, type ScenarioResult } from '../../../../models/scenarioRuns';
import { traceFromRecord } from '../../../../utils/testSession';
import { Notice } from './parts';

// What one scenario did in a run: the verdict, each check and why, what to do next (a request no mock answered gets
// "Add a mock"), the API requests and tool uses, and the trace. Everything here comes from the server's answer.

const requestKey = (r: RequestSeen) => `${r.method ?? ''} ${r.path}`.trim();

interface ResultViewProps {
  result: ScenarioResult;
  scenario?: Obj | null;
  /** Adds a starting mock for a request nothing answered; absent when the scenario can't be changed from here. */
  onAddMock?: ((request: RequestSeen) => void) | null;
  /** Requests a mock was added for since this run ("GET /x"). */
  mockAdded?: string[];
  onEdit?: () => void;
}

function Mark({ passed }: { passed: boolean | null }) {
  const Icon = passed === true ? CheckIcon : passed === false ? XIcon : MinusIcon;
  return (
    <span
      aria-hidden
      className={cn(
        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
        passed === true ? 'bg-success-soft text-success' : passed === false ? 'bg-danger-soft text-danger' : 'bg-subtle text-muted',
      )}
    >
      <Icon className="h-3 w-3" />
    </span>
  );
}

/** The runner's records in order, in the same plain words as a call's trace. */
export function RecordList({ records }: { records: Obj[] }) {
  const items = records.map(traceFromRecord).filter((x): x is NonNullable<ReturnType<typeof traceFromRecord>> => !!x);
  if (!items.length) return <p className="text-xs text-muted">Nothing was recorded.</p>;
  return (
    <ol className="max-h-80 space-y-1 overflow-y-auto pr-1" aria-label="What the runner did">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-xs">
          <span
            className={cn(
              'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
              item.status === 'error' ? 'bg-danger' : item.status === 'ok' ? 'bg-success' : 'bg-line-strong',
            )}
            aria-hidden
          />
          <span className="min-w-0">
            <span className="font-medium text-ink">{item.label}</span>
            {item.detail && <span className="ml-1.5 break-words text-muted">{item.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

const Fold = ({ title, open, children }: { title: string; open?: boolean; children: React.ReactNode }) => (
  <details open={open} className="rounded-lg border border-line">
    <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-ink-soft">{title}</summary>
    <div className="border-t border-line p-3">{children}</div>
  </details>
);

export function ResultView({ result, scenario, onAddMock, mockAdded = [], onEdit }: ResultViewProps) {
  const steps = nextSteps(result, scenario).filter((s) => s.kind !== 'mock');
  const tokens = tokensOf(result);
  const failing = result.status === 'failed' || result.status === 'error';
  return (
    <div className="space-y-3" data-result={result.status}>
      <p className="text-[13px] font-medium text-ink">{resultSummary(result)}</p>
      {tokens && <p className="text-xs text-muted">The model used {tokenWords(tokens)}.</p>}

      {result.unmocked.length > 0 && (
        <Notice
          tone="warning"
          title={
            result.unmocked.length === 1
              ? 'The agent made a request that no mock answered'
              : `The agent made ${result.unmocked.length} requests that no mock answered`
          }
        >
          <p>A scenario never calls a real API. A request no mock matches is answered with a 404, which is the most common reason a scenario fails.</p>
          <ul className="mt-2 space-y-1.5">
            {result.unmocked.map((request, i) => {
              const key = requestKey(request);
              const added = mockAdded.includes(key);
              return (
                <li key={`${key}-${i}`} className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs text-ink">{key}</code>
                  {onAddMock && (
                    <Button size="sm" variant="secondary" disabled={added} onClick={() => onAddMock(request)}>
                      {added ? 'Mock added: run it again' : 'Add a mock'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Notice>
      )}

      {result.checks.length > 0 && (
        <ul className="space-y-1.5" aria-label="Checks">
          {result.checks.map((c, i) => (
            <li key={i} className="flex items-start gap-2" data-passed={String(c.passed)}>
              <Mark passed={c.passed} />
              <span className="min-w-0 text-[13px]">
                <span className="font-medium text-ink">{describeExpectation(c.expect)}</span>
                {(c.detail || c.passed === null) && (
                  <span className="block text-xs text-muted">{c.passed === null ? `Not checked here. ${c.detail}` : c.detail}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {(steps.length > 0 || onEdit) && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-ink-soft" aria-label="What to do next">
          {steps.map((s, i) => (
            <li key={i}>{s.text}</li>
          ))}
          {onEdit && (
            <li className="list-none -ml-5">
              <Button size="sm" variant="ghost" onClick={onEdit}>
                Edit this scenario
              </Button>
            </li>
          )}
        </ul>
      )}

      {result.notes.length > 0 && (
        <ul className="space-y-1 text-xs text-muted">
          {result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {(result.final_agent || Object.keys(result.final_state).length > 0) && (
        <p className="text-xs text-ink-soft">
          {result.final_agent && (
            <>
              Ended with <strong className="text-ink">{result.final_agent}</strong> in charge.{' '}
            </>
          )}
          {Object.keys(result.final_state).length > 0 && (
            <>
              State at the end: <code className="font-mono">{JSON.stringify(result.final_state)}</code>
            </>
          )}
        </p>
      )}

      {result.http.length > 0 && (
        <Fold title={`API requests (${result.http.length})`}>
          <table className="w-full text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-1 font-medium">Request</th>
                <th className="py-1 font-medium">Status</th>
                <th className="py-1 font-medium">Answered by</th>
              </tr>
            </thead>
            <tbody>
              {result.http.map((h, i) => (
                <tr key={i} className={cn('border-t border-line', typeof h.status === 'number' && h.status >= 400 && 'text-danger')}>
                  <td className="py-1 font-mono">
                    {h.method} {h.path}
                  </td>
                  <td className="py-1">{h.status}</td>
                  <td className="py-1">{h.mocked ? 'a mock' : 'nothing'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Fold>
      )}

      {result.tools.length > 0 && (
        <Fold title={`Tool uses (${result.tools.length})`}>
          <ul className="space-y-1 text-xs">
            {result.tools.map((t, i) => (
              <li key={i} className="break-words">
                <code className="font-mono text-ink">
                  {String(t.tool ?? '')}({t.args && typeof t.args === 'object' && Object.keys(t.args).length ? JSON.stringify(t.args) : ''})
                </code>
                {t.error ? (
                  <span className="text-danger"> failed: {String(t.error)}</span>
                ) : t.output !== undefined && t.output !== null ? (
                  <span className="text-muted"> → {(JSON.stringify(t.output) ?? '').slice(0, 120)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {result.events.length > 0 ? (
        <Fold title={`The trace (${result.events.length} records)`} open={failing}>
          <RecordList records={result.events} />
        </Fold>
      ) : (
        result.transcript.length > 0 && (
          <Fold title={`The conversation (${result.transcript.length} messages)`}>
            <ol className="space-y-1 text-xs">
              {result.transcript.map((m, i) => (
                <li key={i}>
                  <strong className="text-ink">{m.role === 'user' || m.role === 'caller' ? 'Caller' : 'Agent'}</strong>{' '}
                  <span className="text-ink-soft">{m.text}</span>
                </li>
              ))}
            </ol>
          </Fold>
        )
      )}
    </div>
  );
}
