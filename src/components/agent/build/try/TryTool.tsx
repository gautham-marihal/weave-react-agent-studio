import React, { useState } from 'react';
import { LoaderCircleIcon, PlayIcon } from 'lucide-react';
import { api, ApiError } from '../../../../api/client';
import type { AgentConfig } from '../../../../types/studio';
import { normalizeResultPreview, readJson, resultPreviewBody, sampleArgs, taskWords, type ResultPreview } from '../../../../models/toolsPreview';
import { Button } from '../../../ui/Button';
import { cn, inputClass } from '../../../../utils/styles';

interface TryToolProps {
  config: AgentConfig;
  toolId: string;
  parameters: unknown;
  /** For a web request: the sample answer typed in the panel (shared with the response's path checks). */
  answerText?: string;
  onAnswerText?: (text: string) => void;
}

const Json = ({ value }: { value: unknown }) => <code className="break-all font-mono text-[12px] text-ink">{typeof value === 'string' ? value : JSON.stringify(value)}</code>;

/**
 * "Try it" for one tool, answered by the server (POST /preview/result): type the arguments the model would give and,
 * for a web request, a sample answer; see the request that would go out, what the model would be shown, what is kept
 * and which rules run. Nothing is called or spent, and the sample is never saved. Uses the tool as it is in the editor.
 */
export function TryTool({ config, toolId, parameters, answerText, onAnswerText }: TryToolProps) {
  const [argsText, setArgsText] = useState(() => JSON.stringify(sampleArgs(parameters), null, 2));
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<ResultPreview | null>(null);
  const [error, setError] = useState('');
  const args = readJson(argsText, { object: true });
  const answer = onAnswerText ? readJson(answerText ?? '') : {};

  const run = async () => {
    if (args.error || answer.error) return;
    setBusy(true);
    setError('');
    try {
      const raw = await api.previewResult(resultPreviewBody(config, toolId, (args.value ?? {}) as Record<string, unknown>, answer.value));
      setView(normalizeResultPreview(raw));
    } catch (err: unknown) {
      setView(null);
      const message = err instanceof Error ? err.message : 'The server could not try it.';
      setError(err instanceof ApiError && err.kind === 'not_found' ? `${message} Check the tool’s id, or save the draft first.` : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" aria-label="Try this tool">
      <p className="text-[13px] text-muted">Nothing is called and nothing is spent: the server shows what would go out and what the model would be shown. It uses the tool as it is here, saved or not.</p>
      <div className={cn('grid gap-3', onAnswerText && 'sm:grid-cols-2')}>
        <label className="block">
          <span className="text-[13px] font-medium text-ink-soft">The arguments the model gives</span>
          <textarea rows={4} spellCheck={false} aria-label="Sample arguments" aria-invalid={!!args.error || undefined} className={cn(inputClass, 'mt-1 resize-y font-mono text-[13px]')} value={argsText} onChange={(e) => setArgsText(e.target.value)} />
          {args.error && <span className="mt-1 block text-xs text-danger">{args.error}</span>}
        </label>
        {onAnswerText &&
        <label className="block">
            <span className="text-[13px] font-medium text-ink-soft">A sample answer from the API (optional)</span>
            <textarea
            rows={4}
            spellCheck={false}
            aria-label="A sample answer"
            placeholder={'{ "balance": 42.5, "customer": { "name": "Asha" } }'}
            className={cn(inputClass, 'mt-1 resize-y font-mono text-[13px]')}
            value={answerText}
            onChange={(e) => onAnswerText(e.target.value)} />
            {answer.error ? <span className="mt-1 block text-xs text-danger">{answer.error}</span> : <span className="mt-1 block text-xs text-muted">Never saved. It also checks the paths under “The response”. Don’t paste real customer data.</span>}
          </label>
        }
      </div>
      <Button variant="secondary" size="sm" onClick={() => void run()} disabled={busy || !!args.error || !!answer.error}>
        {busy ? <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <PlayIcon className="h-3.5 w-3.5" aria-hidden />}
        Try it
      </Button>
      {error && <p role="alert" className="text-[13px] text-danger">The server couldn’t build this preview: {error}</p>}
      {view &&
      <div className="space-y-3 rounded-lg bg-subtle px-4 py-3 text-[13px] text-ink-soft" aria-live="polite" data-try-result>
          {view.note && <p className="text-xs text-muted">The server says: {view.note}</p>}
          {view.argsProblems.length > 0 &&
        <ul className="space-y-0.5 text-warning">
              {view.argsProblems.map((p) => <li key={p}>{p}</li>)}
            </ul>
        }
          {view.preconditions && !view.preconditions.holds && <p className="text-warning">Its preconditions don’t hold with these values, so the model would be told: “{view.preconditions.message || 'no message'}”.</p>}
          {view.preconditions?.holds && <p>Its preconditions hold.</p>}
          {view.task && <p>{taskWords(view.task)}</p>}
          {view.request &&
        <div data-block="request">
              <p className="font-medium text-ink">The request that would be sent</p>
              <p className="mt-1"><code className="break-all font-mono text-[12px] text-ink">{view.request.method} {view.request.url}</code></p>
              {Object.keys(view.request.query).length > 0 && <p>query <Json value={view.request.query} /></p>}
              {Object.keys(view.request.headers).length > 0 && <p>headers <Json value={view.request.headers} /></p>}
              {view.request.body !== null && <p>body <Json value={view.request.body} /></p>}
              {view.request.auth && view.request.auth.type !== 'none' && <p>signed with {view.request.auth.type}{view.request.auth.secrets.length ? ` using ${view.request.auth.secrets.join(', ')}` : ''}</p>}
            </div>
        }
          {view.hasAnswer ?
        <div data-block="answer">
              <p className="font-medium text-ink">What the model would read of that answer</p>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface px-2 py-1.5 font-mono text-[12px] text-ink" aria-label="What the model reads">{view.modelSeesText || '(nothing)'}</pre>
              {Object.keys(view.storedInState).length > 0 &&
          <p className="mt-1">Kept in state: {Object.entries(view.storedInState).map(([k, v]) => <span key={k} className="mr-2"><code className="font-mono">{k}</code> = <Json value={v} /></span>)}</p>
          }
              {view.keptFromModel.length > 0 && <p className="mt-1">Sent straight to the caller, not shown to the model: {view.keptFromModel.join(', ')}</p>}
              {view.effects.length > 0 ?
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {view.effects.map((e, i) => <li key={i}>{e}</li>)}
                </ul> :

          <p className="mt-1 text-muted">No rules run.</p>
          }
            </div> :
        onAnswerText ?
        <p className="text-muted">Add a sample answer above to also see what the model would be shown of it.</p> :
        null}
        </div>
      }
    </div>);

}
