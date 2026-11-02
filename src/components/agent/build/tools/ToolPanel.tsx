import React, { useId, useState } from 'react';
import { BracesIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import type { AgentConfig, Issue, Path, ToolDefinition } from '../../../../types/studio';
import {
  BUILTIN_HELP,
  ON_ERROR_HELP,
  ON_ERROR_SEARCH_HELP,
  REPLY_CHOICES,
  agentName,
  agentsUsingTool,
  describeAdvice,
  notAvailable,
  plainToolKind,
  refIds,
  switchOf,
  timeoutAdvice,
  toolDoes,
  withKey,
} from '../../../../models/tools';
import { argNamesOf, readParams } from '../../../../models/toolsParams';
import { templateScope } from '../../../../models/toolsPaths';
import { readJson } from '../../../../models/toolsPreview';
import { speechText } from '../../../../models/messages';
import { pathKey } from '../../../../utils/path';
import { Dialog } from '../../../ui/Dialog';
import { Button } from '../../../ui/Button';
import { cn, inputClass, inputErrorClass } from '../../../../utils/styles';
import { Block, IdSelect, Labelled, Note } from './parts';
import { linkButton } from './keys';
import { ParamsEditor } from './ParamsEditor';
import { RequestEditor, ResponsePanel } from './RequestEditor';
import { EffectsEditor } from './EffectsEditor';
import { TryTool } from '../try/TryTool';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

interface ToolPanelProps {
  config: AgentConfig;
  index: number;
  /** True for a tool just added from a card (its title says so). */
  isNew?: boolean;
  disabled: boolean;
  errors: Issue[];
  update: (path: Path, value: unknown) => void;
  onDelete: () => void;
  onClose: () => void;
  onOpenJson: () => void;
}

/** One tool's settings, drawn for what it is. Every change is an ordinary edit of the draft (undo takes it back). */
export function ToolPanel({ config, index, isNew, disabled, errors, update, onDelete, onClose, onOpenJson }: ToolPanelProps) {
  const own = useId();
  const tool = (config.tools ?? [])[index] as (ToolDefinition & Json) | undefined;
  const [answerText, setAnswerText] = useState('');
  const [naming, setNaming] = useState(false);
  if (!tool) return null;
  const at = (...rest: Path): Path => ['tools', index, ...rest];
  const set = (key: string, value: unknown) => update(at(), withKey(tool, key, value));
  const setParam = (key: string, value: unknown) => {
    const params = withKey(isObj(tool.params) ? tool.params : {}, key, value);
    update(at(), withKey(tool, 'params', Object.keys(params).length ? params : undefined));
  };
  const problemAt = (...rest: Path) => errors.find((e) => e.path && pathKey(e.path) === pathKey(at(...rest)))?.message;
  const own_problems = errors.filter((e) => e.path && e.path[0] === 'tools' && e.path[1] === index);

  const kind = String(tool.type ?? '');
  const isHttp = kind === 'http';
  const builtin = typeof tool.builtin === 'string' ? tool.builtin : '';
  const params = (isObj(tool.params) ? tool.params : {}) as Json;
  const toggle = switchOf(config, tool.id);
  const unavailable = notAvailable(tool);
  const advice = describeAdvice(tool.description);
  const descProblem = problemAt('description');
  const agents = (config.agents?.items ?? []).filter((a) => isObj(a) && typeof a.id === 'string');
  const users = agentsUsingTool(config, tool.id);
  const argNames = argNamesOf(tool);
  const scope = templateScope(config, { argNames });
  const paramRows = readParams(tool.parameters).rows;
  const connections = refIds(config, 'http_connections');
  const connection = typeof tool.connection === 'string' ? tool.connection : '';
  const baseUrl = String((isObj(config.connections) ? (config.connections[connection] as Json | undefined)?.base_url : '') ?? '');
  const answer = readJson(answerText);
  const say = params.say;
  const showName = tool.name !== undefined && (tool.name !== tool.id || naming);
  const hasParameters = isHttp || kind === 'code' || tool.parameters !== undefined;
  const title = isNew ? 'New tool' : `Tool “${tool.id}”`;

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={title}
      description={<span><span className="font-medium text-ink-soft">{plainToolKind(tool) || 'A tool'}.</span> {toolDoes(config, tool)}</span>}
      footer={
      <>
          <Button variant="ghost" size="sm" className="mr-auto" onClick={onOpenJson}>
            <BracesIcon className="h-3.5 w-3.5" aria-hidden />
            Open the JSON view
          </Button>
          {!disabled &&
        <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={onDelete}>
              <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
              Delete this tool
            </Button>
        }
          <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
        </>
      }>
      <div className="space-y-4" data-tool-panel={tool.id}>
        {unavailable &&
        <p role="note" className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-ink">
            <TriangleAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            {unavailable} aren’t available in the runtime yet. This tool is saved with the agent but does nothing until they are.
          </p>
        }
        {own_problems.length > 0 &&
        <div role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">
            <p className="font-medium">The server’s checks found {own_problems.length === 1 ? 'a problem' : `${own_problems.length} problems`} in this tool</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {own_problems.slice(0, 5).map((p, i) => <li key={i}>{p.message}</li>)}
            </ul>
          </div>
        }
        {builtin && BUILTIN_HELP[builtin] && <p className="text-[13px] text-muted">{BUILTIN_HELP[builtin]}</p>}
        {toggle &&
        <p className="text-[13px] text-muted">
            {toggle.on ? `It is the switch “${toggle.label}” above: switch that off to take it away.` : `The switch “${toggle.label}” above gives it to the agent that answers.`}
          </p>
        }

        {agents.length > 0 &&
        <fieldset className="rounded-lg border border-line px-4 py-3">
            <legend className="px-1 text-[13px] font-medium text-ink-soft">{agents.length > 1 ? 'Which agents can use it' : 'Can the agent use it?'}</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {agents.map((a) =>
            <label key={a.id} className="flex items-center gap-2 text-[13px] text-ink">
                  <input
                type="checkbox"
                checked={(a.tools ?? []).includes(tool.id)}
                disabled={disabled}
                onChange={(e) => {
                  const k = (config.agents?.items ?? []).indexOf(a);
                  const tools = (a.tools ?? []).filter((t) => t !== tool.id);
                  update(['agents', 'items', k, 'tools'], e.target.checked ? [...tools, tool.id] : tools);
                }} />
                  {agentName(config, a.id)}
                </label>
            )}
            </div>
            {!users.length && <Note tone="warn">Nothing can use it until an agent is ticked.</Note>}
          </fieldset>
        }

        <Labelled
          label="When it uses it"
          htmlFor={`${own}-desc`}
          help={descProblem ? undefined : 'The agent reads this to decide when to use the tool. One or two sentences that say when.'}
          aside={<span className="text-xs text-muted">{String(tool.description ?? '').length} characters</span>}>
          <textarea
            id={`${own}-desc`}
            rows={3}
            className={cn(inputClass, 'resize-y', descProblem && inputErrorClass)}
            value={String(tool.description ?? '')}
            placeholder="For example: Use when the caller asks for a person, or you can’t help them."
            aria-invalid={descProblem ? true : undefined}
            disabled={disabled}
            onChange={(e) => set('description', e.target.value)} />
          {descProblem ? <Note tone="error" role="alert">{descProblem}</Note> : advice.text && <Note tone={advice.level === 'warn' ? 'warn' : 'muted'}>{advice.text}</Note>}
        </Labelled>

        {builtin === 'end_call' && (
        typeof say === 'string' || say === undefined ?
        <Labelled label="What it says before it hangs up" htmlFor={`${own}-bye`} help="Said in full, then the call ends.">
              <textarea id={`${own}-bye`} rows={2} className={cn(inputClass, 'resize-y')} value={say ?? ''} placeholder="Thank you for calling. Goodbye!" disabled={disabled} onChange={(e) => setParam('say', e.target.value || undefined)} />
            </Labelled> :

        <p className="text-[13px] text-ink-soft">
              Before it hangs up it says {speechText(say, config) ? `“${speechText(say, config)}”, ` : ''}one of its fixed lines. Change it under Fixed lines on the Agent page.{' '}
              {!disabled && <button type="button" className={cn(linkButton, 'text-[13px]')} onClick={() => setParam('say', speechText(say, config) || undefined)}>Use its own words here instead</button>}
            </p>)
        }

        <div className="text-[13px]">
          {showName ?
          <Labelled label="Name the model sees" htmlFor={`${own}-name`} help="Lowercase letters, digits and _." aside={!disabled && <button type="button" className={cn(linkButton, 'text-xs')} onClick={() => { setNaming(false); set('name', undefined); }}>Use its id</button>}>
              <input id={`${own}-name`} className={cn(inputClass, 'font-mono text-[13px]')} value={String(tool.name ?? '')} spellCheck={false} disabled={disabled} onChange={(e) => set('name', e.target.value)} />
            </Labelled> :

          <p className="text-muted">
              The model sees this tool as <code className="font-mono text-ink-soft">{tool.id}</code>.{' '}
              {!disabled &&
            <button
              type="button"
              className={linkButton}
              onClick={() => {
                setNaming(true);
                set('name', tool.id.toLowerCase().replace(/[^a-z0-9_]+/g, '_'));
              }}>
                  Use a different name…
                </button>
            }
            </p>
          }
        </div>

        {builtin === 'transfer_or_callback' &&
        <Labelled label="Which phone transfer" htmlFor={`${own}-transfer`} help="Where calls go: set the number under Phone transfers on this page.">
            <IdSelect id={`${own}-transfer`} label="Which phone transfer" value={String(params.transfer ?? '')} options={refIds(config, 'transfers')} disabled={disabled} onChange={(v) => setParam('transfer', v)} />
          </Labelled>
        }
        {builtin === 'send_form' &&
        <Labelled label="Which form" htmlFor={`${own}-form`} help="Forms are listed with the other extras on this page.">
            <IdSelect id={`${own}-form`} label="Which form" value={String(params.form ?? '')} options={refIds(config, 'forms')} disabled={disabled} onChange={(v) => setParam('form', v)} />
          </Labelled>
        }
        {builtin === 'collect_dtmf' &&
        <Labelled label="Keep the digits in" htmlFor={`${own}-into`} help="Kept in this state variable and only said to be collected: never give a PIN or card number to the model.">
            <IdSelect id={`${own}-into`} label="Keep the digits in" value={String(params.into ?? '')} options={refIds(config, 'state_vars')} disabled={disabled} onChange={(v) => setParam('into', v || undefined)} placeholder="Give them to the model (not for PINs)" />
          </Labelled>
        }
        {kind === 'knowledge' &&
        <Labelled label="What it searches" htmlFor={`${own}-source`} help="A knowledge base from the Knowledge page.">
            <IdSelect id={`${own}-source`} label="What it searches" value={String(tool.source ?? '')} options={refIds(config, 'knowledge')} disabled={disabled} onChange={(v) => set('source', v)} />
          </Labelled>
        }
        {kind === 'task' &&
        <Labelled label="Which task it starts" htmlFor={`${own}-task`} help="Tasks are listed with the other extras on this page.">
            <IdSelect id={`${own}-task`} label="Which task it starts" value={String(tool.task ?? '')} options={refIds(config, 'tasks')} disabled={disabled} onChange={(v) => set('task', v)} />
          </Labelled>
        }

        {hasParameters &&
        <Block title="What the model fills in" lead="The details the model gives when it uses the tool.">
            <ParamsEditor value={tool.parameters} toolName={String(tool.name || tool.id)} description={String(tool.description ?? '')} disabled={disabled} onChange={(schema) => set('parameters', schema)} />
          </Block>
        }

        {isHttp &&
        <Block title="The request" lead="What is sent to your system. Put what the model fills in as {{args.NAME}}.">
            <RequestEditor
            request={tool.request}
            connection={connection}
            connections={connections}
            baseUrl={baseUrl}
            onConnection={(v) => set('connection', v)}
            onChange={(req) => set('request', req)}
            scope={scope}
            paramRows={paramRows}
            disabled={disabled} />
          </Block>
        }
        {isHttp &&
        <Block title="The response" lead="What the model is shown of the answer, and what is kept for later.">
            <ResponsePanel result={tool.result} onChange={(r) => set('result', r)} stateVars={refIds(config, 'state_vars')} sample={answer.error ? undefined : answer.value} disabled={disabled} />
          </Block>
        }

        <Block title="After it succeeds" lead="Who speaks next, and the rules that run, in order.">
          <div role="radiogroup" aria-label="Who speaks after the tool runs" className="grid gap-2 sm:grid-cols-2">
            {REPLY_CHOICES.map((choice) => {
              const checked = (tool.reply ?? 'model') === choice.value;
              return (
                <label key={choice.value} className={cn('flex cursor-pointer gap-2 rounded-md border px-3 py-2.5', checked ? 'border-accent bg-accent-soft/50' : 'border-line hover:border-line-strong')}>
                  <input type="radio" className="mt-1" name={`${own}-reply`} checked={checked} disabled={disabled} onChange={() => set('reply', choice.value === 'model' ? undefined : choice.value)} />
                  <span>
                    <span className="block text-[13px] font-medium text-ink">{choice.label}</span>
                    <span className="block text-xs text-muted">{choice.help}</span>
                    <span className="mt-1 block text-xs italic text-muted">{choice.example}</span>
                  </span>
                </label>);

            })}
          </div>
          <EffectsEditor value={tool.effects} onChange={(rules) => set('effects', rules)} config={config} argNames={argNames} disabled={disabled} />
        </Block>

        {(isHttp || kind === 'knowledge') &&
        <Block title="When it goes wrong">
            <Labelled label="Message for the model" htmlFor={`${own}-err`} help={isHttp ? ON_ERROR_HELP : ON_ERROR_SEARCH_HELP}>
              <textarea
              id={`${own}-err`}
              rows={2}
              className={cn(inputClass, 'resize-y')}
              value={String(isObj(tool.on_error) ? tool.on_error.tool_error ?? '' : '')}
              placeholder={isHttp ? 'Tell the caller you could not fetch the bill and offer a callback.' : 'Say you can’t look that up right now and offer to take a message.'}
              disabled={disabled}
              onChange={(e) => set('on_error', e.target.value ? { ...(isObj(tool.on_error) ? tool.on_error : {}), tool_error: e.target.value } : undefined)} />
            </Labelled>
            {isHttp &&
          <div className="grid gap-3 sm:grid-cols-2">
                <Labelled label="Give up after (seconds)" htmlFor={`${own}-timeout`}>
                  <input id={`${own}-timeout`} type="number" min={0.1} step="any" className={inputClass} placeholder="10 if left empty" value={typeof tool.timeout_s === 'number' ? tool.timeout_s : ''} disabled={disabled} onChange={(e) => set('timeout_s', e.target.value === '' ? undefined : Number(e.target.value))} />
                </Labelled>
                <Labelled label="Retries" htmlFor={`${own}-retries`}>
                  <input id={`${own}-retries`} type="number" min={0} step={1} className={inputClass} placeholder="0 if left empty" value={typeof tool.retries === 'number' ? tool.retries : ''} disabled={disabled} onChange={(e) => set('retries', e.target.value === '' ? undefined : Math.max(0, Math.round(Number(e.target.value))))} />
                </Labelled>
              </div>
          }
            {isHttp && timeoutAdvice(tool).map((n) => <Note key={n}>{n}</Note>)}
          </Block>
        }

        <Block title="Try it" lead="Ask the server what this tool would do.">
          <TryTool config={config} toolId={tool.id} parameters={tool.parameters} answerText={isHttp ? answerText : undefined} onAnswerText={isHttp ? setAnswerText : undefined} />
        </Block>
      </div>
    </Dialog>);

}
