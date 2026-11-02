import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon, SparklesIcon, Undo2Icon } from 'lucide-react';
import type { AgentConfig } from '../../types/studio';
import type { DraftEditor } from '../../hooks/useDraftEditor';
import { api } from '../../api/client';
import { askAssistant, loadStatus, postToModel, type LlmStatus, type Proposal, type Step } from '../../models/assistant';
import { changesSince, type ChangeSummary } from '../../models/changes';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { StatusChip } from '../ui/StatusChip';
import { toast } from '../ui/Toast';
import { cn, inputClass } from '../../utils/styles';
import { isSandbox } from '../../sandbox/mode';

// Sandbox: built-in rules make the draft instead of an AI model (src/sandbox/rulesAssistant.ts, loaded only in Sandbox)
type RulesKit = typeof import('../../sandbox/rulesAssistant');
// Whose checks read the proposal: Sandbox's are simple rules in this browser, not the server's
const checksName = (): string => (isSandbox() ? 'The checks in this browser' : 'The server’s checks');

// "Describe it": say in words what to change, and an AI model proposes a whole new configuration. Nothing changes
// behind anyone's back: the proposal is checked by the server (POST /validate), shown as changes in words, and enters
// the draft only on Apply, through the draft editor (so Undo, Save and the checks work as everywhere else). It needs an
// AI model on the Studio server (/llm, ANTHROPIC_API_KEY); without one it says so plainly and does nothing else.
// In Sandbox nothing leaves the browser, so no AI model is asked: simple built-in rules make a first draft instead, and
// the panel says plainly that they are not AI.

const CONSENT_KEY = 'weave_ai_consent';
const MODEL_KEY = 'weave_ai_model';
const readPref = (key: string) => {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};
const writePref = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage switched off: asked again next time
  }
};

// The schema is the same for every agent: fetched once per page.
let schemaPromise: Promise<unknown> | null = null;
const loadSchema = () => {
  schemaPromise ??= api.schema().catch((error: unknown) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
};

const STEP_WORDS: Record<Step, string> = {
  thinking: 'Writing a proposal…',
  checking: 'Checking it with the server…',
  fixing: 'Fixing what the checks found…'
};

const EXAMPLES = [
'Make it sound more formal, and add a rule: never promise a refund.',
'Add a billing specialist the first agent passes bill questions to.',
'Let every agent end the call politely when the caller has nothing else.'];


interface Turn {
  id: number;
  request: string;
  state: 'working' | 'done' | 'error' | 'stopped';
  step?: Step;
  error?: string;
  before?: AgentConfig;
  proposal?: Proposal;
  changes?: ChangeSummary;
  model?: string;
  outcome?: 'applied' | 'dismissed' | 'undone';
}

/**
 * The button for the agent header: opens the panel. Hidden for people who can't edit the draft. `?describe=` in the
 * address opens it at once (the Create dialog sends people here), with what they wrote already in the box.
 */
export function DescribeItButton({ editor }: {editor: DraftEditor;}) {
  const [params, setParams] = useSearchParams();
  const asked = params.get('describe');
  const [open, setOpen] = useState(asked !== null);
  const [start] = useState(() => asked && asked !== '1' ? asked : '');
  useEffect(() => {
    if (asked === null) return;
    setOpen(true);
    const next = new URLSearchParams(params);
    next.delete('describe');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);
  if (!editor.canEdit || !editor.config) return null;
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        title={isSandbox() ? 'Say in words what the agent should do; built-in rules (not AI) make a first draft and you choose whether to apply it' : 'Say in words what to change; an AI model proposes it and you choose whether to apply it'}>
        <SparklesIcon className="h-4 w-4 text-accent" aria-hidden />
        Describe it
      </Button>
      <DescribeItPanel editor={editor} open={open} onClose={() => setOpen(false)} initialText={start} />
    </>);

}

let turnCounter = 0;

export function DescribeItPanel({ editor, open, onClose, initialText = '' }: {editor: DraftEditor;open: boolean;onClose: () => void;initialText?: string;}) {
  const rules = isSandbox();
  const [kit, setKit] = useState<RulesKit | null>(null);
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [consent, setConsent] = useState(() => readPref(CONSENT_KEY) === '1');
  const [modelPref, setModelPref] = useState(() => readPref(MODEL_KEY));
  const [text, setText] = useState(initialText);
  const [turns, setTurns] = useState<Turn[]>([]);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let off = false;
    if (rules) {
      void import('../../sandbox/rulesAssistant').then((m) => {
        if (!off) {
          setKit(m);
          setStatus({ configured: true });
        }
      });
      return () => {
        off = true;
      };
    }
    void loadStatus().then((s) => {
      if (!off) setStatus(s);
    });
    return () => {
      off = true;
    };
  }, [open, rules]);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns]);
  useEffect(() => () => abort.current?.abort(), []);

  const models = status?.models ?? [];
  const model = models.includes(modelPref) ? modelPref : status?.model ?? models[0] ?? '';
  const busy = turns.some((t) => t.state === 'working');
  const config = editor.config;
  const blocked = editor.parseError ? 'The JSON view has text that is not valid JSON. Fix it there first.' : !editor.canEdit ? 'Viewers can’t change the draft.' : '';
  const minLength = rules ? kit?.MIN_DESCRIPTION ?? 15 : 4;
  // the rules send nothing anywhere, so there is nothing to agree to first
  const agreed = rules || consent;
  const canSend = !!status?.configured && agreed && !busy && !blocked && !!config && text.trim().length >= minLength;

  const patch = useCallback((id: number, change: Partial<Turn>) => setTurns((all) => all.map((t) => t.id === id ? { ...t, ...change } : t)), []);

  const send = async () => {
    if (!canSend || !config) return;
    const request = text.trim();
    const id = ++turnCounter;
    const earlier = turns.map((t) => t.request);
    const before = config;
    setTurns((all) => [...all, { id, request, state: 'working', step: 'thinking', before, model: rules ? kit?.RULES_BADGE : model }]);
    setText('');
    const controller = new AbortController();
    abort.current = controller;
    try {
      if (rules && kit) {
        patch(id, { step: 'checking' });
        const proposal = await kit.proposeWithRules(request, before, { validate: (c, signal) => api.validate(c, { signal }), signal: controller.signal });
        patch(id, { state: 'done', proposal, changes: changesSince(before, proposal.config) });
        return;
      }
      const schema = await loadSchema();
      const proposal = await askAssistant({
        request,
        config: before,
        schema,
        model,
        earlier,
        signal: controller.signal,
        onStep: (step) => patch(id, { step }),
        post: (body, signal) => postToModel(body, signal),
        validate: (c, signal) => api.validate(c, { signal })
      });
      patch(id, { state: 'done', proposal, changes: changesSince(before, proposal.config) });
    } catch (error) {
      const aborted = (error as {name?: string;})?.name === 'AbortError';
      patch(id, { state: aborted ? 'stopped' : 'error', error: aborted ? '' : error instanceof Error ? error.message : 'Something went wrong.' });
    } finally {
      abort.current = null;
    }
  };

  const apply = (turn: Turn) => {
    if (!turn.proposal) return;
    editor.replaceConfig(turn.proposal.config);
    patch(turn.id, { outcome: 'applied' });
    toast.success('Applied to the draft. Save keeps it.');
  };
  const undo = (turn: Turn) => {
    if (!turn.before) return;
    editor.replaceConfig(turn.before);
    patch(turn.id, { outcome: 'undone' });
  };
  const lastApplied = [...turns].reverse().find((t) => t.outcome === 'applied');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title="Describe it"
      description={
        rules
          ? 'Say in words what this agent should do. In Sandbox, simple built-in rules (not an AI model) make a first draft, it is checked, and nothing changes until you press Apply.'
          : 'Say in words what this agent should do differently. An AI model proposes the change, the server checks it, and nothing changes until you press Apply.'
      }>
      {status === null ?
      <p className="flex items-center gap-2 text-sm text-muted"><LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden />{rules ? 'Loading…' : 'Checking whether an AI model is set up…'}</p> :
      !status.configured ?
      <div role="status" className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-ink-soft">
          <p className="font-medium text-ink">No AI model is set up on this Studio server</p>
          <p className="mt-1">Describe it needs one to propose changes, so it can’t be used here yet. Everything else works as usual: make the change in Build, or in the JSON.</p>
          <p className="mt-2 text-xs text-muted">For whoever runs Studio: add ANTHROPIC_API_KEY to the server’s environment (see .env.example) and restart it. The key stays on the server and is never sent to the browser.</p>
        </div> :

      <div className="space-y-4">
          {rules && kit &&
        <div role="note" data-rules-note className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-ink-soft">
              <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                {kit.RULES_TITLE}
                <StatusChip tone="warning">{kit.RULES_BADGE}</StatusChip>
              </p>
              <p className="mt-1">{kit.RULES_NOTE}</p>
            </div>
        }
          {!agreed &&
        <div className="rounded-lg border border-info/30 bg-info-soft px-4 py-3 text-sm text-ink-soft">
              <p className="font-medium text-ink">Before you use it</p>
              <p className="mt-1">What you write, and this agent’s draft, are sent to the AI service ({status.provider ?? 'Anthropic'}) with the key kept on the Studio server. A draft holds only the names of secrets, never their values, but don’t type passwords or personal details into the box.</p>
              <Button
            size="sm"
            variant="primary"
            className="mt-3"
            onClick={() => {
              writePref(CONSENT_KEY, '1');
              setConsent(true);
            }}>
                I understand, continue
              </Button>
              <p className="mt-2 text-xs text-muted">Kept in this browser.</p>
            </div>
        }
          {blocked && <p className="rounded-md bg-warning-soft px-3 py-2 text-[13px] text-warning">{blocked}</p>}

          <div role="log" aria-label="Requests and proposals" className="space-y-4">
            {turns.length === 0 &&
          <div className="rounded-lg border border-dashed border-line px-4 py-3">
                <p className="text-[13px] text-muted">For example:</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {(rules && kit ? kit.RULES_EXAMPLES : EXAMPLES).map((e) =>
              <li key={e}>
                      <button type="button" onClick={() => setText(e)} className="rounded-full border border-line px-2.5 py-1 text-left text-xs text-ink-soft hover:border-accent/40 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                        {e}
                      </button>
                    </li>
              )}
                </ul>
              </div>
          }
            {turns.map((turn) =>
          <TurnView
            key={turn.id}
            turn={turn}
            draftChanged={!!turn.proposal && editor.config !== turn.before && turn.outcome !== 'applied'}
            canUndo={lastApplied?.id === turn.id && editor.config === turn.proposal?.config}
            disabled={!!blocked}
            onApply={() => apply(turn)}
            onDismiss={() => patch(turn.id, { outcome: 'dismissed' })}
            onUndo={() => undo(turn)}
            onStop={() => abort.current?.abort()} />
          )}
            <div ref={endRef} />
          </div>

          <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="space-y-2">
            <label htmlFor="describe-it-input" className="text-[13px] font-medium text-ink-soft">What should change?</label>
            <textarea
            id="describe-it-input"
            rows={3}
            value={text}
            disabled={busy || !agreed}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={rules ? 'e.g. A friendly phone agent for a dental clinic that books appointments…' : turns.length ? 'Ask for another change…' : 'e.g. Add a Spanish greeting and let it transfer to a person'}
            className={cn(inputClass, 'resize-y leading-relaxed')} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              {rules ?
            <p className="text-xs text-muted">Read by simple rules in this browser; the draft they make replaces what is there. Ctrl+Enter sends.</p> :
            <div className="flex items-center gap-2 text-xs text-muted">
                <label htmlFor="describe-it-model">AI model</label>
                <select
                id="describe-it-model"
                value={model}
                disabled={busy || models.length < 2}
                onChange={(e) => {
                  setModelPref(e.target.value);
                  writePref(MODEL_KEY, e.target.value);
                }}
                className={cn(inputClass, 'h-8 w-auto py-0 text-xs')}>
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <span>Ctrl+Enter sends.</span>
              </div>
            }
              <Button type="submit" variant="primary" size="sm" disabled={!canSend}>
                {busy ? <LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden /> : <SparklesIcon className="h-4 w-4" aria-hidden />}
                {rules ? 'Make a first draft' : 'Propose a change'}
              </Button>
            </div>
          </form>
        </div>
      }
    </Dialog>);

}

function TurnView({ turn, draftChanged, canUndo, disabled, onApply, onDismiss, onUndo, onStop }: {turn: Turn;draftChanged: boolean;canUndo: boolean;disabled: boolean;onApply: () => void;onDismiss: () => void;onUndo: () => void;onStop: () => void;}) {
  const p = turn.proposal;
  const errors = p?.issues.errors ?? [];
  const warnings = p?.issues.warnings ?? [];
  const nothing = turn.changes?.total === 0;
  const changes = turn.changes;
  const counts = useMemo(() => {
    const items = changes?.groups.flatMap((g) => g.items) ?? [];
    return { added: items.filter((i) => i.verb === 'Added').length, changed: items.filter((i) => i.verb === 'Changed').length, removed: items.filter((i) => i.verb === 'Removed').length };
  }, [changes]);
  return (
    <div className="space-y-2">
      <div className="ml-auto max-w-[85%] rounded-lg bg-accent-soft px-3 py-2 text-[13px] text-ink">
        <span className="sr-only">You asked: </span>
        {turn.request}
      </div>
      <section aria-label="Proposal" className={cn('rounded-lg border px-4 py-3', turn.state === 'error' ? 'border-danger/40 bg-danger-soft/40' : 'border-line bg-surface')}>
        {turn.state === 'working' &&
        <div className="flex items-center justify-between gap-2 text-[13px] text-muted">
            <span className="flex items-center gap-2"><LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden />{STEP_WORDS[turn.step ?? 'thinking']}</span>
            <Button size="sm" variant="ghost" onClick={onStop}>Stop</Button>
          </div>
        }
        {turn.state === 'stopped' && <p className="text-[13px] text-muted">Stopped. Nothing was changed.</p>}
        {turn.state === 'error' && <p role="alert" className="flex items-start gap-2 text-[13px] text-danger"><CircleAlertIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{turn.error}</p>}
        {turn.state === 'done' && p &&
        <div className="space-y-3 text-[13px]">
            {p.summary && <p className="text-ink">{p.summary}</p>}
            {nothing ?
          <p className="text-muted">It proposes no change to the draft.</p> :

          <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  What it would change
                  <span className="ml-2 font-normal normal-case tracking-normal">{[counts.added && `${counts.added} added`, counts.changed && `${counts.changed} changed`, counts.removed && `${counts.removed} removed`].filter(Boolean).join(', ')}</span>
                </h4>
                <ul className="mt-1.5 space-y-2">
                  {changes?.groups.map((g) =>
              <li key={g.key}>
                      <p className="font-medium text-ink-soft">{g.title}</p>
                      <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-ink-soft">
                        {g.items.slice(0, 12).map((item, i) => <li key={i} title={item.where}>{item.text}</li>)}
                        {g.items.length > 12 && <li className="text-muted">and {g.items.length - 12} more</li>}
                      </ul>
                    </li>
              )}
                </ul>
              </div>
          }
            {p.assumptions.length > 0 &&
          <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">It assumed</h4>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-soft">{p.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
              </div>
          }
            {p.questions.length > 0 &&
          <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Still to decide</h4>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-soft">{p.questions.map((q) => <li key={q}>{q}</li>)}</ul>
              </div>
          }
            {errors.length ?
          <div className="rounded-md bg-danger-soft px-3 py-2 text-ink-soft">
                <p className="font-medium text-danger">{checksName()} still find {errors.length} problem{errors.length === 1 ? '' : 's'}{p.repairs ? ` after ${p.repairs} attempt${p.repairs === 1 ? '' : 's'} to fix them` : ''}:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">{errors.slice(0, 6).map((e, i) => <li key={i}>{e.message}</li>)}</ul>
                <p className="mt-1 text-xs text-muted">You can still apply it and fix these in Build; the draft can’t be published until they are.</p>
              </div> :

          <p className="flex items-center gap-1.5 text-success"><CircleCheckIcon className="h-4 w-4" aria-hidden />{checksName()} pass{warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : ''}.</p>
          }
            {draftChanged && <p className="text-xs text-warning">The draft has changed since this was proposed. Applying it replaces those changes.</p>}
            <div className="flex flex-wrap items-center gap-2">
              {turn.outcome === 'applied' ?
            <>
                  <StatusChip tone="success" dot>Applied to the draft</StatusChip>
                  {canUndo && <Button size="sm" variant="ghost" onClick={onUndo}><Undo2Icon className="h-3.5 w-3.5" aria-hidden />Undo</Button>}
                </> :
            turn.outcome === 'dismissed' ?
            <StatusChip tone="neutral">Not applied</StatusChip> :
            turn.outcome === 'undone' ?
            <StatusChip tone="neutral">Undone</StatusChip> :

            <>
                  <Button size="sm" variant="primary" onClick={onApply} disabled={disabled || nothing}>Apply</Button>
                  <Button size="sm" variant="ghost" onClick={onDismiss}>Not this</Button>
                </>
            }
              {turn.model && <span className="ml-auto text-xs text-muted">{turn.model}</span>}
            </div>
          </div>
        }
      </section>
    </div>);

}
