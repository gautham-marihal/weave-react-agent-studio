import React, { useMemo, useState } from 'react';
import { ChevronDownIcon, CopyIcon, FileTextIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import type { AgentConfig } from '../../../../types/studio';
import { describeWhen, knowledgeBlocks, modelLines, onEnterLines, promptAdvice, stateLines, toolParameters, type Prompt } from '../../../../models/promptPreview';
import { copyInstructions, usePromptPreview, useWhatIf, type PromptAnswer, type WhatIfChoices } from './promptPreviewState';
import { Button } from '../../../ui/Button';
import { StatusChip } from '../../../ui/StatusChip';
import { cn, inputClass } from '../../../../utils/styles';

// ---- the bar of what-ifs ---------------------------------------------------------------------------------------------
const small = cn(inputClass, 'mt-1 py-1.5');

export function WhatIfBar({ config, what }: { config: AgentConfig; what: WhatIfChoices }) {
  const channels = (config.channels ?? []).filter((c) => c && c.id);
  const agents = (config.agents?.items ?? []).filter((a) => a && a.id);
  return (
    <div role="group" aria-label="Preview as" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-canvas/60 p-3">
      {agents.length > 1 &&
      <label className="block">
          <span className="block text-xs font-medium text-muted">Agent</span>
          <select className={cn(small, 'w-44')} value={what.agent} onChange={(e) => what.setAgent(e.target.value)} aria-label="Preview for agent">
            <option value="">The one callers meet first</option>
            {agents.map((a) =>
          <option key={a.id} value={a.id}>
                {a.name || a.id}
              </option>
          )}
          </select>
        </label>
      }
      {channels.length > 0 &&
      <label className="block">
          <span className="block text-xs font-medium text-muted">On channel</span>
          <select className={cn(small, 'w-44')} value={what.channel} onChange={(e) => what.setChannel(e.target.value)} aria-label="Preview on channel">
            <option value="">The first one switched on</option>
            {channels.map((c) =>
          <option key={c.id} value={c.id}>
                {c.id}
              </option>
          )}
          </select>
        </label>
      }
      <label className="block">
        <span className="block text-xs font-medium text-muted">Pretend it is</span>
        <input type="datetime-local" className={cn(small, 'w-52')} value={what.nowLocal} onChange={(e) => what.setNowLocal(e.target.value)} aria-label="Pretend it is this time" />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-muted">Caller’s number</span>
        <input type="text" inputMode="tel" maxLength={30} className={cn(small, 'w-40')} value={what.callerPhone} placeholder="as it comes" onChange={(e) => what.setCallerPhone(e.target.value)} aria-label="Pretend the caller’s number is" />
      </label>
      {what.variables.map((v) =>
      <label key={v.name} className="block">
          <span className="block text-xs font-medium text-muted">
            If <code className="font-mono">{v.name}</code> were
          </span>
          {v.type === 'boolean' ?
        <select className={cn(small, 'w-32')} value={what.typed[v.name] ?? ''} onChange={(e) => what.setTyped((old) => ({ ...old, [v.name]: e.target.value }))} aria-label={`What if ${v.name} were`}>
              <option value="">as it starts</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select> :

        <input
          className={cn(small, 'w-32')}
          type={v.type === 'number' || v.type === 'integer' ? 'number' : 'text'}
          value={what.typed[v.name] ?? ''}
          placeholder="as it starts"
          onChange={(e) => what.setTyped((old) => ({ ...old, [v.name]: e.target.value }))}
          aria-label={`What if ${v.name} were`} />
        }
        </label>
      )}
      {what.changed &&
      <button type="button" onClick={what.reset} className="mb-2 text-[13px] font-medium text-accent hover:underline">
          Reset
        </button>
      }
    </div>);

}

// ---- the answer ------------------------------------------------------------------------------------------------------
/** Placeholders the server left for what only exists during a call (‹args.x›) are marked. */
function Marked({ text }: { text: string }) {
  return (
    <>
      {text.split(/(‹[^›]*›)/).map((part, i) =>
      part.startsWith('‹') ?
      <mark key={i} className="rounded bg-warning-soft px-0.5 text-ink">
            {part}
          </mark> :

      <React.Fragment key={i}>{part}</React.Fragment>
      )}
    </>);

}

function Extra({ title, name, children }: { title: string; name: string; children: React.ReactNode }) {
  return (
    <details data-extra={name} className="rounded-lg border border-line bg-surface px-3 py-2">
      <summary className="cursor-pointer text-[13px] font-medium text-ink">{title}</summary>
      <div className="mt-2 text-[13px] text-ink-soft">{children}</div>
    </details>);

}

/** What runs when it takes over, what it searches, the models (secret names only), the state used, each tool's arguments. */
export function PromptExtras({ prompt }: { prompt: Prompt }) {
  const enter = onEnterLines(prompt.onEnter);
  const knowledge = knowledgeBlocks(prompt.knowledge);
  const models = modelLines(prompt.models);
  const state = stateLines(prompt.state);
  const params = toolParameters(prompt.tools);
  return (
    <div className="space-y-2">
      {enter.length > 0 &&
      <Extra title={`What runs when it takes over (${enter.length})`} name="on_enter">
          <ol className="list-decimal space-y-0.5 pl-5">
            {enter.map((line, i) =>
          <li key={i}>{line}</li>
          )}
          </ol>
        </Extra>
      }
      {knowledge.length > 0 &&
      <Extra title="What it searches" name="knowledge">
          {knowledge.map((block) =>
        <div key={block.heading} className="mb-1.5">
              <strong className="font-medium text-ink">{block.heading}</strong>
              <ul className="list-disc pl-5">
                {block.items.map((item, i) =>
            <li key={i}>{item}</li>
            )}
              </ul>
            </div>
        )}
        </Extra>
      }
      {models.length > 0 &&
      <Extra title="The models it would use" name="models">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            {models.map((line) =>
          <React.Fragment key={line.label}>
                <dt className="font-medium text-ink">{line.label}</dt>
                <dd className="break-words">{line.text}</dd>
              </React.Fragment>
          )}
          </dl>
          <p className="mt-2 text-xs text-muted">Only the names of secrets are shown, never their values.</p>
        </Extra>
      }
      {state.length > 0 &&
      <Extra title={`What it remembers at this point (${state.length})`} name="state">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            {state.map((line) =>
          <React.Fragment key={line.name}>
                <dt>
                  <code className="font-mono text-ink">{line.name}</code>
                </dt>
                <dd>
                  {line.text}
                  {line.masked && <small className="ml-1 text-muted">hidden: it is sensitive</small>}
                </dd>
              </React.Fragment>
          )}
          </dl>
        </Extra>
      }
      {params.length > 0 &&
      <Extra title="What it gives each tool" name="parameters">
          <ul className="space-y-1">
            {params.map((tool) =>
          <li key={tool.name}>
                <code className="font-mono text-ink">{tool.name}</code> <span className="text-muted">takes</span>{' '}
                {tool.params.map((p) =>
            <span key={p.name} className="mr-2 inline-block">
                    <code className="font-mono">{p.name}</code>
                    {p.type && <em className="text-muted"> {p.type}</em>}
                    {p.required && <b title="required"> *</b>}
                  </span>
            )}
              </li>
          )}
          </ul>
        </Extra>
      }
    </div>);

}

/** The server's answer laid out: numbers, advice, each block and whether it is in, first words, tools, extras, exact text. */
export function PromptPreviewBody({ answer, onCopy }: { answer: PromptAnswer; onCopy?: (text: string) => void }) {
  const prompt = answer.data;
  const advice = useMemo(() => promptAdvice(prompt), [prompt]);
  if (answer.error)
  return (
    <div role="alert" className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm">
        <p className="text-danger">The server could not build the preview: {answer.error}. Nothing is shown in its place, because only the server knows exactly what the model is told.</p>
        <Button size="sm" variant="secondary" onClick={answer.retry}>
          <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden />
          Try again
        </Button>
      </div>);

  if (!prompt)
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Asking the server">
        {[0, 1, 2].map((i) =>
      <div key={i} className="rounded-lg border border-line p-3">
            <div className="h-3 w-32 animate-pulse rounded bg-subtle" />
            <div className="mt-2 h-3 w-full animate-pulse rounded bg-subtle" />
          </div>
      )}
      </div>);

  return (
    <div className={cn('space-y-4 transition-opacity', answer.loading && 'opacity-60')} aria-busy={answer.loading}>
      <p role="status" data-total className="text-[13px] text-ink-soft">
        <strong className="text-ink">{prompt.stats.words.toLocaleString('en')}</strong> {prompt.stats.words === 1 ? 'word' : 'words'}
        {prompt.stats.tokens ?
        <>
            {' '}
            · about <strong className="text-ink">{prompt.stats.tokens.toLocaleString('en')}</strong> tokens
          </> :
        null}{' '}
        · <strong className="text-ink">{prompt.stats.toolsOffered}</strong> {prompt.stats.toolsOffered === 1 ? 'tool' : 'tools'} offered
        {prompt.agentName && <span className="text-muted"> · for {prompt.agentName}{prompt.channelId ? ` on ${prompt.channelId}` : ''}</span>}
        {answer.loading && <span className="text-muted"> · updating…</span>}
      </p>
      {prompt.note && <p className="rounded-md bg-info-soft px-3 py-2 text-[13px] text-ink-soft">{prompt.note}</p>}
      {[...prompt.warnings.map((text, i) => ({ id: `w${i}`, text })), ...advice].map((item) =>
      <p key={item.id} role="note" data-advice={item.id} className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-ink">
          <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
          {item.text}
        </p>
      )}

      {prompt.sections.length === 0 && <p className="text-[13px] text-muted">Nothing to show yet: this agent has no role or persona text.</p>}
      <ol className="space-y-2">
        {prompt.sections.map((s) =>
        <li key={s.id} data-section={s.kind} className={cn('rounded-lg border p-3', s.active ? 'border-line bg-surface' : 'border-dashed border-line bg-subtle/40')}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-ink" title={s.kind}>
                {s.label}
              </span>
              {s.active ?
            s.when && <span className="text-xs text-muted">in now · {describeWhen(s.when)}</span> :
            <StatusChip>Not in the prompt right now</StatusChip>}
              {!s.active && s.when && <span className="text-xs text-muted">only when {describeWhen(s.when)}</span>}
            </div>
            <p className={cn('mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed', s.active ? 'text-ink-soft' : 'text-muted')}>
              <Marked text={s.text} />
            </p>
          </li>
        )}
      </ol>

      {(prompt.greeting || prompt.opening) &&
      <section data-section="spoken" className="rounded-lg border border-line bg-surface p-3">
          <h4 className="text-xs font-semibold text-ink">
            What it says first <span className="font-normal text-muted">· not part of the instructions</span>
          </h4>
          {prompt.greeting && <p className="mt-1 text-[13px] text-ink-soft">Greeting: “{prompt.greeting}”</p>}
          {prompt.opening && <p className="mt-1 text-[13px] text-ink-soft">When it takes over: {prompt.opening}</p>}
        </section>
      }

      {prompt.tools.length > 0 &&
      <details className="rounded-lg border border-line bg-surface px-3 py-2">
          <summary className="cursor-pointer text-[13px] font-medium text-ink">
            The tools it is offered ({prompt.tools.filter((t) => t.offered).length}
            {prompt.tools.some((t) => !t.offered) ? ` of ${prompt.tools.length}` : ''})
          </summary>
          <ul className="mt-2 divide-y divide-line">
            {prompt.tools.map((t, i) =>
          <li key={`${t.name}-${i}`} className="py-1.5 text-[13px]">
                <code className="font-mono text-ink">{t.name}</code>
                {t.description && <span className="text-ink-soft"> {t.description}</span>}
                {!t.offered && <em className="not-italic text-warning"> · not offered{t.reason ? `: ${t.reason}` : ''}</em>}
              </li>
          )}
          </ul>
        </details>
      }

      <PromptExtras prompt={prompt} />

      <details className="rounded-lg border border-line bg-surface px-3 py-2">
        <summary className="cursor-pointer text-[13px] font-medium text-ink">The exact text the model receives</summary>
        <pre aria-label="The exact instructions" className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-canvas p-3 font-mono text-[12px] leading-relaxed text-ink-soft">
          {prompt.instructions}
        </pre>
        {onCopy &&
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => onCopy(prompt.instructions)}>
            <CopyIcon className="h-3.5 w-3.5" aria-hidden />
            Copy
          </Button>
        }
      </details>
    </div>);

}

/** The preview inside the Agent page, as a row that opens; the server is asked only while it is open. */
export function InlinePromptPreview({ config }: { config: AgentConfig }) {
  const [open, setOpen] = useState(false);
  const what = useWhatIf(config);
  const answer = usePromptPreview(config, what, open);
  return (
    <div className="rounded-lg border border-line bg-surface" data-prompt-preview>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40">
        <FileTextIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1">
          <strong className="block text-sm font-medium text-ink">Preview the prompt</strong>
          <small className="block text-[13px] text-muted">Everything the model is told, built by the server from what is in the editor now</small>
        </span>
        <ChevronDownIcon className={cn('h-4 w-4 shrink-0 text-muted transition-transform duration-150', open && 'rotate-180')} aria-hidden />
      </button>
      {open &&
      <div className="space-y-4 border-t border-line px-4 py-4">
          <WhatIfBar config={config} what={what} />
          <PromptPreviewBody answer={answer} onCopy={copyInstructions} />
        </div>
      }
    </div>);

}
