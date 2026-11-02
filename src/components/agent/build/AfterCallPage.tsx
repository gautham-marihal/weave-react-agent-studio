import React, { useState } from 'react';
import { LoaderCircleIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import type { DraftEditor } from '../../../hooks/useDraftEditor';
import { useRedactionEntities } from '../../../hooks/useRedactionEntities';
import {
  ANSWER_KINDS,
  QUESTION_IDEAS,
  addQuestion,
  afterCallOf,
  entityLabel,
  notDoneYet,
  readRedactionPreview,
  recordsInWords,
  removeQuestion,
  setLog,
  setNotice,
  setQuestion,
  setRecording,
  setRedaction,
  setSummary,
  type AnswerKind,
} from '../../../models/afterCall';
import { api } from '../../../api/client';
import { AfterCallMore } from './messages/AfterCallMore';
import { Segmented } from '../../ui/Segmented';
import { Button } from '../../ui/Button';
import { Toggle } from '../../ui/Toggle';
import { cn, inputClass } from '../../../utils/styles';

/**
 * After the call in plain words: a summary, questions answered about each call, what is recorded and for how long, what
 * callers hear first, and what is hidden in what is kept (kinds from GET /redaction/entities), with "What this means" and
 * a box to try a line (POST /preview/redaction). A setting the config does not set shows "Server's default".
 */
export function AfterCallPage({ editor }: { editor: DraftEditor }) {
  const config = editor.config;
  if (!config) return null;
  const disabled = !editor.canEdit;
  const apply = editor.replaceConfig;
  const a = afterCallOf(config);
  const not = notDoneYet(editor.validationView.report?.unsupported);

  return (
    <div className="space-y-8">
      <Card title="A summary of each call" notYet={not.summary && a.summary.on === true}>
        <TriState label="Write a summary" value={a.summary.on} disabled={disabled} onChange={(v) => apply(setSummary(config, { on: v }))} defaultLocked={!!a.summary.prompt} />
        {a.summary.on === true &&
        <label className="mt-3 block">
            <span className="text-[13px] font-medium text-ink-soft">What it should cover</span>
            <textarea rows={3} className={cn(inputClass, 'mt-1 resize-y')} value={a.summary.prompt} placeholder="Server’s default. For example: why they called, what was agreed, what happens next." disabled={disabled} onChange={(e) => apply(setSummary(config, { prompt: e.target.value }))} />
          </label>
        }
      </Card>

      <Card title="Questions answered about each call" text="Answered from the conversation once it ends, and kept with the call." notYet={not.questions && a.questions.length > 0}>
        <ul className="space-y-3">
          {a.questions.map((q) =>
          <li key={`${q.id}-${q.index}`} className="rounded-lg border border-line px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <input className={cn(inputClass, 'min-w-[220px] flex-1')} value={q.question} disabled={disabled} aria-label="Question" onChange={(e) => apply(setQuestion(config, q.index, { question: e.target.value }))} />
                <select className={cn(inputClass, 'w-44')} value={q.type} disabled={disabled} aria-label="Kind of answer" onChange={(e) => apply(setQuestion(config, q.index, { type: e.target.value as AnswerKind }))}>
                  {!q.type && <option value="">Choose…</option>}
                  {ANSWER_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
                <Button size="sm" variant="ghost" onClick={() => apply(removeQuestion(config, q.index))} disabled={disabled} aria-label={`Remove “${q.question}”`}><Trash2Icon className="h-3.5 w-3.5" aria-hidden /></Button>
              </div>
              {q.type === 'enum' &&
            <label className="mt-2 block">
                  <span className="text-xs text-muted">Answers to choose from, one per line</span>
                  <textarea rows={Math.max(2, q.values.length)} className={cn(inputClass, 'mt-1 resize-y')} value={q.values.join('\n')} disabled={disabled} onChange={(e) => apply(setQuestion(config, q.index, { values: e.target.value.split('\n') }))} />
                </label>
            }
            </li>
          )}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => apply(addQuestion(config, { question: 'New question', type: 'boolean' }))} disabled={disabled}><PlusIcon className="h-3.5 w-3.5" aria-hidden />Add a question</Button>
          {QUESTION_IDEAS.filter((idea) => !a.questions.some((q) => q.question === idea.question)).map((idea) =>
          <Button key={idea.question} size="sm" variant="ghost" onClick={() => apply(addQuestion(config, idea))} disabled={disabled}>+ {idea.question}</Button>
          )}
        </div>
      </Card>

      <Card title="Recording" notYet={not.recording && (a.recording.audio === true || a.recording.transcript === true)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TriState label="Keep a log of each call" value={a.log.on} disabled={disabled} onChange={(v) => apply(setLog(config, { on: v }))} />
          <Days label="Keep call logs for" value={a.log.days} disabled={disabled} onChange={(d) => apply(setLog(config, { days: d }))} />
          <TriState label="Keep the audio" value={a.recording.audio} disabled={disabled} onChange={(v) => apply(setRecording(config, { audio: v }))} />
          <TriState label="Keep the transcript" value={a.recording.transcript} disabled={disabled} onChange={(v) => apply(setRecording(config, { transcript: v }))} />
          <Days label="Keep audio and transcripts for" value={a.recording.days} disabled={disabled} onChange={(d) => apply(setRecording(config, { days: d }))} />
        </div>
        <label className="mt-4 block">
          <span className="text-sm font-medium text-ink">What callers hear first</span>
          <span className="mt-0.5 block text-[13px] text-muted">Said at the start of the call. Leave empty to say nothing.</span>
          <input className={cn(inputClass, 'mt-2')} value={a.notice} placeholder="This call may be recorded to improve our service." disabled={disabled} onChange={(e) => apply(setNotice(config, e.target.value))} />
        </label>
        <div className="mt-4 rounded-lg bg-subtle px-4 py-3">
          <p className="text-[13px] font-medium text-ink">What this means</p>
          <ul className="mt-1 space-y-0.5 text-[13px] text-ink-soft">
            {recordsInWords(a, editor.validationView.report?.unsupported).map((l) => <li key={l}>{l}</li>)}
          </ul>
        </div>
      </Card>

      <Hiding editor={editor} notYet={not.redaction} />

      <AfterCallMore editor={editor} />
    </div>);

}

function Card({ title, text, notYet, children }: { title: string; text?: string; notYet?: boolean; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border border-line bg-surface p-5">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {text && <p className="mt-0.5 text-[13px] text-muted">{text}</p>}
      {notYet && <p className="mt-2 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-ink">The server says it does not do this yet: it is kept in the config but not applied on calls.</p>}
      <div className="mt-4">{children}</div>
    </section>);

}

type Tri = boolean | null;
/** On / Off / the server's default (not set). */
function TriState({ label, value, onChange, disabled, defaultLocked = false }: { label: string; value: Tri; onChange: (v: Tri) => void; disabled: boolean; defaultLocked?: boolean }) {
  const options = [
    ...(defaultLocked ? [] : [{ value: 'default', label: 'Server’s default' }]),
    { value: 'on', label: 'On' },
    { value: 'off', label: 'Off' },
  ];
  const current = value === true ? 'on' : value === false ? 'off' : 'default';
  return (
    <div>
      <p className="text-sm font-medium text-ink">{label}</p>
      <div className="mt-2">
        <Segmented size="sm" label={label} options={options} value={current} onChange={(v) => !disabled && onChange(v === 'on' ? true : v === 'off' ? false : null)} />
      </div>
    </div>);

}

function Days({ label, value, onChange, disabled }: { label: string; value: number | null; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      <span className="mt-2 flex items-center gap-2">
        <input type="number" min={1} className={cn(inputClass, 'w-32')} value={value ?? ''} placeholder="Server’s default" disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        <span className="text-sm text-muted">days</span>
      </span>
    </label>);

}

function Hiding({ editor, notYet }: { editor: DraftEditor; notYet: boolean }) {
  const { entities, error, retry, loading } = useRedactionEntities();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReturnType<typeof readRedactionPreview> | null>(null);
  const [tryError, setTryError] = useState<string | null>(null);
  const config = editor.config;
  if (!config) return null;
  const a = afterCallOf(config);
  const known = entities?.map((e) => e.kind) ?? [];
  const run = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setTryError(null);
    try {
      setResult(readRedactionPreview(await api.previewRedaction({ config, text })));
    } catch (err: unknown) {
      setResult(null);
      setTryError(err instanceof Error ? err.message : 'The server could not try it.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Hiding sensitive details in what is kept" text="Replaced in saved transcripts, logs and anything sent after the call. It never changes what the agent hears." notYet={notYet && a.redaction.on}>
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium text-ink">Hide them</p>
        <Toggle checked={a.redaction.on} onChange={(v) => editor.replaceConfig(setRedaction(config, { on: v }, known))} label="Hide sensitive details" disabled={!editor.canEdit || !entities} />
      </div>
      {loading && !entities && <div className="mt-3 h-5 w-2/3 animate-pulse rounded bg-subtle" aria-label="Reading the kinds of detail" />}
      {error && <p className="mt-2 text-[13px] text-warning">The kinds of detail could not be read from the server ({error}). <button type="button" onClick={retry} className="font-medium text-accent hover:underline">Try again</button></p>}
      {a.redaction.on && entities &&
      <fieldset className="mt-3 grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Kinds of detail</legend>
          {entities.map((e) =>
        <label key={e.kind} className="flex items-start gap-2 text-[13px] text-ink-soft">
              <input type="checkbox" className="mt-0.5" checked={a.redaction.entities.includes(e.kind)} disabled={!editor.canEdit} onChange={(ev) => editor.replaceConfig(setRedaction(config, { entities: ev.target.checked ? [...a.redaction.entities, e.kind] : a.redaction.entities.filter((k) => k !== e.kind) }, known))} />
              <span><span className="font-medium text-ink">{entityLabel(e.kind)}</span><span className="block text-xs text-muted">{e.how}</span></span>
            </label>
        )}
        </fieldset>
      }
      <div className="mt-4 flex flex-wrap gap-2">
        <input className={cn(inputClass, 'min-w-[240px] flex-1')} value={text} onChange={(e) => setText(e.target.value)} placeholder="Try a line: my email is ada@example.com" onKeyDown={(e) => e.key === 'Enter' && void run()} />
        <Button variant="secondary" onClick={() => void run()} disabled={busy || !text.trim()}>{busy ? <LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden /> : null}Try it</Button>
      </div>
      {tryError && <p role="alert" className="mt-2 text-[13px] text-danger">{tryError}</p>}
      {result &&
      <div className="mt-3 space-y-1 rounded-lg bg-subtle px-4 py-3 text-[13px] text-ink-soft" aria-live="polite">
          <p><span className="font-medium text-ink">Kept as:</span> “{result.redacted}”</p>
          <p>{result.found.length ? `Found: ${result.found.map((f) => `${entityLabel(f.kind).toLowerCase()} (${f.text})`).join(', ')}.` : 'Nothing in this line is hidden.'}</p>
          {result.appliesTo.length > 0 && <p className="text-xs text-muted">Applies to {result.appliesTo.join('; ')}.</p>}
          {result.modelSees && <p className="text-xs text-muted">{result.modelSees}</p>}
        </div>
      }
    </Card>);

}
