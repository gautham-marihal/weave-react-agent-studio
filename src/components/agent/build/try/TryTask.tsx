import React, { useState } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import type { AgentConfig } from '../../../../types/studio';
import { api, ApiError } from '../../../../api/client';
import { STEP_WORDS, askProblem, checkedWords, endingWords, normalizeTask, stepState, taskPreviewBody, type TaskPreview } from '../../../../models/toolsTasks';
import { list } from '../../../../models/toolsExtras';
import { Button } from '../../../ui/Button';
import { StatusChip } from '../../../ui/StatusChip';
import { cn, inputClass, inputErrorClass } from '../../../../utils/styles';

/**
 * "Try this task": the server reads the task as it is in the editor (POST /preview/task) and says, step by step, what
 * each question tells the AI, how an answer is checked, what would be skipped for a caller and what each ending does.
 * Nothing runs, nothing is called, nothing is saved.
 */
export function TryTask({ config, taskId }: { config: AgentConfig; taskId: string }) {
  const channels = list<{ id?: string }>(config.channels).filter((c) => c?.id);
  const [stateText, setStateText] = useState('');
  const [channel, setChannel] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<TaskPreview | null>(null);
  const [error, setError] = useState('');
  const built = taskPreviewBody(config, taskId, stateText, channel);
  const bad = 'error' in built ? built.error : '';

  const run = async () => {
    if ('error' in built) return;
    setBusy(true);
    setError('');
    try {
      setView(normalizeTask(await api.previewTask(built.body)));
    } catch (err: unknown) {
      setView(null);
      setError(err instanceof ApiError ? askProblem(err) : askProblem({ message: err instanceof Error ? err.message : '' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Try this task" className="rounded-lg border border-line bg-canvas px-4 py-4">
      <h4 className="text-sm font-semibold text-ink">Try this task</h4>
      <p className="mt-0.5 text-[13px] text-muted">The server reads the task as it is here, saved or not, and shows it step by step. Nothing runs and nothing is called.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="text-[13px] font-medium text-ink-soft">What if these were already remembered (optional)</span>
          <textarea
            rows={2}
            className={cn(inputClass, 'mt-1 resize-y font-mono text-[13px]', bad && inputErrorClass)}
            value={stateText}
            placeholder='{"verified": true}'
            spellCheck={false}
            aria-invalid={!!bad || undefined}
            onChange={(e) => setStateText(e.target.value)}
          />
          {bad && <span role="alert" className="mt-1 block text-[13px] text-danger">{bad}</span>}
        </label>
        {channels.length > 1 && (
          <label className="block">
            <span className="text-[13px] font-medium text-ink-soft">On which channel</span>
            <select className={cn(inputClass, 'mt-1')} value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="On which channel">
              <option value="">Any</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <Button className="mt-3" size="sm" variant="secondary" onClick={() => void run()} disabled={busy || !!bad || !taskId}>
        {busy && <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" aria-hidden />}
        Show the steps
      </Button>
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {error}
        </p>
      )}
      {view && (
        <div className="mt-4 space-y-3" aria-live="polite">
          {view.skippedNow && <p className="rounded-md bg-warning-soft px-3 py-2 text-[13px] text-ink">With these values the whole task is already done: it ends at once as a success and asks nothing.</p>}
          {view.problems.map((p) => (
            <p key={p} className="text-[13px] text-warning">
              {p}
            </p>
          ))}
          <ol className="space-y-2" aria-label="Steps">
            {view.steps.map((s) => {
              const st = stepState(s);
              const checked = checkedWords(s);
              return (
                <li key={`${s.id}-${s.index}`} data-step={s.id} className={cn('rounded-md border border-line bg-surface px-3 py-2.5', st.tag !== 'runs' && 'opacity-80')}>
                  <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink">
                    {s.index}. {STEP_WORDS[s.type] || s.type} <code className="font-mono text-xs text-muted">{s.id}</code>
                    {st.tag === 'skipped' && <StatusChip tone="info">Skipped</StatusChip>}
                    {st.tag === 'held' && <StatusChip tone="warning">Held back</StatusChip>}
                  </p>
                  {st.words && <p className="mt-0.5 text-[13px] text-ink-soft">{st.words}</p>}
                  {s.instructions && <p className="mt-0.5 text-[13px] text-ink-soft">{s.instructions}</p>}
                  {s.type === 'collect' && (
                    <p className="mt-0.5 text-xs text-muted">
                      {s.answerMode === 'keypad'
                        ? `The caller presses keys${s.keypad?.numDigits ? ` (${s.keypad.numDigits} digits)` : ''}${s.keypad?.terminator ? `, ended with ${s.keypad.terminator}` : ''}. The AI never sees the digits.`
                        : checked
                          ? `The answer is checked ${checked}.`
                          : 'Nothing checks the answer: any answer is accepted.'}
                      {s.attempts ? ` ${s.attempts} ${s.attempts === 1 ? 'attempt' : 'attempts'}.` : ''}
                    </p>
                  )}
                  {s.actions.map((a, i) => (
                    <p key={i} className="mt-0.5 text-xs text-muted">
                      {a}
                    </p>
                  ))}
                  {s.problems.map((p) => (
                    <p key={p} className="mt-0.5 text-[13px] text-warning">
                      {p}
                    </p>
                  ))}
                </li>
              );
            })}
          </ol>
          {view.attempts && (
            <p className="text-xs text-muted">
              Wrong answers are counted {view.attempts.counted === 'task' ? 'across the whole task' : 'on each step'}
              {view.attempts.limit ? `, up to ${view.attempts.limit}` : ''}.
            </p>
          )}
          {view.endings.length > 0 && (
            <div>
              <p className="text-[13px] font-medium text-ink">How it can end</p>
              <ul className="mt-1 space-y-1 text-[13px] text-ink-soft">
                {view.endings.map((e) => (
                  <li key={e.name}>{endingWords(e)}</li>
                ))}
              </ul>
            </div>
          )}
          {view.offeredBy.length > 0 && <p className="text-xs text-muted">Started by the tool{view.offeredBy.length > 1 ? 's' : ''} {view.offeredBy.join(', ')}.</p>}
        </div>
      )}
    </section>
  );
}
