import React, { useState } from 'react';
import { LoaderCircleIcon, XIcon } from 'lucide-react';
import type { DraftEditor } from '../../../hooks/useDraftEditor';
import { useRedactionEntities } from '../../../hooks/useRedactionEntities';
import { entityLabel } from '../../../models/afterCall';
import {
  LIMITS,
  MOMENTS,
  endingTools,
  limitsOf,
  momentsOf,
  personalDetailsOf,
  previewWords,
  readGuardrailPreview,
  setLimit,
  setLimitSay,
  setMoment,
  setMomentWords,
  setOffTopic,
  setPersonalDetails,
  setTopics,
  topicsOf,
  type GuardrailPreview,
} from '../../../models/guardrails';
import { api } from '../../../api/client';
import { CheckList, RuleList } from './guardrails/GuardrailLists';
import { Toggle } from '../../ui/Toggle';
import { Button } from '../../ui/Button';
import { cn, inputClass } from '../../../utils/styles';

/**
 * Guardrails in plain words first (topics, when it hands over or ends the call, checks on what is said, limits), every
 * rule written out below, and a box to try a line (POST /preview/guardrails). Every control writes the server's own
 * guardrails paths, which the JSON view shows as they are.
 */
export function GuardrailsPage({ editor, onOpenJson }: { editor: DraftEditor; onOpenJson: () => void }) {
  const config = editor.config;
  if (!config) return null;
  const disabled = !editor.canEdit;
  const apply = editor.replaceConfig;
  const topics = topicsOf(config);
  const tools = endingTools(config);
  const moments = momentsOf(config);
  const limits = limitsOf(config);

  return (
    <div className="space-y-8">
      <Card title="Topics" text="What it talks about, and what it stays away from. Left empty, the server’s default: no topic rules.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TopicList label="It talks about" items={topics.allowed} disabled={disabled} onChange={(items) => apply(setTopics(config, 'allowed', items))} placeholder="orders" />
          <TopicList label="It must not talk about" items={topics.blocked} disabled={disabled} onChange={(items) => apply(setTopics(config, 'blocked', items))} placeholder="medical advice" />
        </div>
        <div className="mt-4 rounded-lg bg-subtle px-4 py-3">
          <p className="text-[13px] font-medium text-ink">When someone keeps going off topic</p>
          {tools.length === 0 ?
          <p className="mt-1 text-[13px] text-muted">It needs a tool to end the conversation or pass people on. Switch one on under Tools first.</p> :

          <div className="mt-2 flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="text-xs text-muted">After this many tries</span>
                <input type="number" min={1} className={cn(inputClass, 'mt-1 w-24')} value={topics.offTopic?.strikes ?? ''} placeholder="Off" disabled={disabled} onChange={(e) => apply(setOffTopic(config, e.target.value === '' ? null : { ...(topics.offTopic ?? {}), strikes: Number(e.target.value), then: topics.offTopic?.then || tools[0].id }))} />
              </label>
              <label className="block">
                <span className="text-xs text-muted">it</span>
                <select className={cn(inputClass, 'mt-1')} value={topics.offTopic?.then ?? ''} disabled={disabled} onChange={(e) => apply(setOffTopic(config, e.target.value ? { ...(topics.offTopic ?? { strikes: 2 }), then: e.target.value } : null))}>
                  <option value="">Does nothing more (off)</option>
                  {tools.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </label>
              {topics.offTopic &&
            <label className="block min-w-[240px] flex-1">
                  <span className="text-xs text-muted">saying first</span>
                  <input className={cn(inputClass, 'mt-1')} value={topics.offTopic.say} placeholder={topics.offTopic.sayRef ? `The fixed line “${topics.offTopic.sayRef}”` : 'Nothing: the server’s default'} disabled={disabled} onChange={(e) => apply(setOffTopic(config, { ...topics.offTopic, say: e.target.value }))} />
                </label>
            }
            </div>
          }
        </div>
      </Card>

      <Card title="When it hands over or ends the call" text="Rules it follows by itself during a conversation.">
        <div className="space-y-2">
          {MOMENTS.map((m) => {
            const s = moments[m.id];
            return (
              <div key={m.id} className="rounded-lg border border-line px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-ink">{m.label}</p>
                    <p className="mt-0.5 text-[13px] text-muted">{s.changed || m.text}</p>
                    {!s.possible && !s.on && <p className="mt-1 text-[13px] text-warning">{s.why}</p>}
                  </div>
                  <Toggle checked={s.on} onChange={(v) => apply(setMoment(config, m.id, v))} label={m.label} disabled={disabled || (!s.on && !s.possible)} />
                </div>
                {s.on && s.keywords &&
                <Words
                  label="Words it listens for"
                  items={s.keywords}
                  disabled={disabled}
                  onChange={(items) => {
                    const r = setMomentWords(config, m.id, items);
                    if (!r.refused) apply(r.config);
                  }} />
                }
              </div>);

          })}
        </div>
        <div className="mt-5">
          <p className="mb-2 text-[13px] font-medium text-ink">All its hand-over and ending rules</p>
          <RuleList editor={editor} />
        </div>
      </Card>

      <Card title="Checks on what is said" text="Looked for in each line before the agent answers, or before what it says is spoken.">
        <PersonalDetails editor={editor} />
        <div className="mt-5">
          <p className="mb-2 text-[13px] font-medium text-ink">On what the caller says</p>
          <CheckList editor={editor} side="input" />
        </div>
        <div className="mt-5">
          <p className="mb-2 text-[13px] font-medium text-ink">On what the agent says</p>
          <CheckList editor={editor} side="output" />
        </div>
        <p className="mt-4 text-[13px] text-muted">Every check is also in the <button type="button" onClick={onOpenJson} className="font-medium text-accent hover:underline">JSON view</button>, as the server keeps it.</p>
      </Card>

      <Card title="Limits" text="Left empty: the server’s default (no limit).">
        <div className="grid gap-4 sm:grid-cols-2">
          {LIMITS.map((l) =>
          <label key={l.key} className="block">
              <span className="text-sm font-medium text-ink">{l.label}</span>
              <span className="mt-0.5 block text-[13px] text-muted">{l.help}</span>
              <span className="mt-2 flex items-center gap-2">
                <input type="number" min={0} className={cn(inputClass, 'w-32')} value={l.toInput(limits.values[l.key])} placeholder="Server’s default" disabled={disabled} onChange={(e) => apply(setLimit(config, l.key, e.target.value))} />
                {l.unit && <span className="text-sm text-muted">{l.unit}</span>}
              </span>
            </label>
          )}
        </div>
        <label className="mt-4 block">
          <span className="text-sm font-medium text-ink">What it says when a limit ends the call</span>
          <input className={cn(inputClass, 'mt-2')} value={limits.say} placeholder={limits.sayRef ? `The fixed line “${limits.sayRef}”` : 'Server’s default: an English goodbye'} disabled={disabled} onChange={(e) => apply(setLimitSay(config, e.target.value))} />
        </label>
      </Card>

      <TryGuardrails editor={editor} />
    </div>);

}

function Card({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border border-line bg-surface p-5">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-0.5 text-[13px] text-muted">{text}</p>
      <div className="mt-4">{children}</div>
    </section>);

}

function TopicList({ label, items, onChange, disabled, placeholder }: { label: string; items: string[]; onChange: (items: string[]) => void; disabled: boolean; placeholder: string }) {
  return <Words label={label} items={items} onChange={onChange} disabled={disabled} placeholder={placeholder} />;
}

/** A short list of words or topics: chips, and a box to add one (Enter). */
function Words({ label, items, onChange, disabled, placeholder }: { label: string; items: string[]; onChange: (items: string[]) => void; disabled: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    if (draft.trim()) onChange([...items, draft.trim()]);
    setDraft('');
  };
  return (
    <div className="mt-2">
      <p className="text-[13px] font-medium text-ink-soft">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {items.map((w) =>
        <span key={w} className="inline-flex items-center gap-1 rounded-md bg-subtle px-2 py-1 text-[13px] text-ink">
            {w}
            <button type="button" disabled={disabled} onClick={() => onChange(items.filter((x) => x !== w))} aria-label={`Remove ${w}`} className="rounded p-0.5 hover:bg-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><XIcon className="h-3 w-3" aria-hidden /></button>
          </span>
        )}
        <input
          className={cn(inputClass, 'h-8 w-40 py-1 text-[13px]')}
          value={draft}
          placeholder={placeholder ?? 'Add…'}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          aria-label={`Add to ${label}`} />
      </div>
    </div>);

}

function PersonalDetails({ editor }: { editor: DraftEditor }) {
  const { entities, error, retry } = useRedactionEntities();
  const config = editor.config;
  if (!config) return null;
  const state = personalDetailsOf(config);
  const kinds = entities?.map((e) => e.kind) ?? [];
  const chosen = state.on ? state.entities : [];
  return (
    <div className="rounded-lg border border-line px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink">Hide personal details the caller says</p>
          <p className="mt-0.5 text-[13px] text-muted">The agent still hears them; they are hidden in what is saved.</p>
        </div>
        <Toggle checked={state.on} onChange={(v) => editor.replaceConfig(setPersonalDetails(config, v, v ? kinds.filter((k) => ['card_number', 'bank_account', 'national_id'].includes(k)) : []))} label="Hide personal details the caller says" disabled={!editor.canEdit || !entities?.length} />
      </div>
      {error && <p className="mt-2 text-[13px] text-warning">The kinds of detail could not be read from the server ({error}). <button type="button" onClick={retry} className="font-medium text-accent hover:underline">Try again</button></p>}
      {state.on && entities &&
      <fieldset className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          <legend className="sr-only">Kinds of detail</legend>
          {entities.map((e) =>
        <label key={e.kind} className="flex items-center gap-2 text-[13px] text-ink-soft" title={e.how}>
              <input type="checkbox" checked={chosen.includes(e.kind)} disabled={!editor.canEdit || (chosen.length === 1 && chosen.includes(e.kind))} onChange={(ev) => editor.replaceConfig(setPersonalDetails(config, true, ev.target.checked ? [...chosen, e.kind] : chosen.filter((k) => k !== e.kind)))} />
              {entityLabel(e.kind)}
            </label>
        )}
        </fieldset>
      }
    </div>);

}

/** Try a line against the guardrails as they are in the editor (POST /preview/guardrails; nothing is called or saved). */
function TryGuardrails({ editor }: { editor: DraftEditor }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GuardrailPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (!text.trim() || !editor.config) return;
    setBusy(true);
    setError(null);
    try {
      setResult(readGuardrailPreview(await api.previewGuardrails({ config: editor.config, text })));
    } catch (err: unknown) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'The server could not try it.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Try a line" text="What its checks would do with something a caller might say. Uses the guardrails in the editor, saved or not.">
      <div className="flex flex-wrap gap-2">
        <input className={cn(inputClass, 'min-w-[240px] flex-1')} value={text} onChange={(e) => setText(e.target.value)} placeholder="My card number is 4111 1111 1111 1111" onKeyDown={(e) => e.key === 'Enter' && void run()} />
        <Button variant="secondary" onClick={() => void run()} disabled={busy || !text.trim()}>{busy ? <LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden /> : null}Try it</Button>
      </div>
      {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      {result &&
      <div className="mt-3 space-y-1 rounded-lg bg-subtle px-4 py-3 text-[13px] text-ink-soft" aria-live="polite">
          <p className="font-medium text-ink">{previewWords(result)}</p>
          {result.says && <p>It says instead: “{result.says}”</p>}
          {result.savedAs && <p>Saved as: “{result.savedAs}”</p>}
          {result.notChecked.length > 0 && <p>Told to the agent but not checked in code: {result.notChecked.join(', ')}</p>}
          <p className="text-xs text-muted">Hand-over and ending rules depend on the conversation, so they are not tried here.</p>
        </div>
      }
    </Card>);

}
