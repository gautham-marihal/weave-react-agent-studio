import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, PhoneForwardedIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import type { AgentConfig, AgentRole, Path } from '../../../../types/studio';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import { useProviders } from '../../../../hooks/useProviders';
import { useStudio } from '../../../../contexts/StudioContext';
import { api } from '../../../../api/client';
import {
  addPhoneTransfer,
  addSay,
  addTransferToAgent,
  addUpdateState,
  blankValue,
  defaultInterrupt,
  defaultLlm,
  defaultVoice,
  describeEnterStep,
  interruptChoice,
  llmChoice,
  llmOptions,
  moveEnterStep,
  removeEnterStep,
  replaceAgent,
  setInterrupt,
  setLlm,
  setVoice,
  voiceChoice,
  voiceOptions,
  workspaceAgents,
  type OverrideOption,
  type TransferEdit } from
'../../../../models/workflowExtras';
import type { EditResult } from '../../../../models/workflow';
import { numberProblem } from '../../../../models/setup';
import { Button } from '../../../ui/Button';
import { fieldId } from '../../../../utils/path';
import { cn, inputClass } from '../../../../utils/styles';

// More of an agent's settings in the Workflow panel: what it does as it takes over (on_enter: say a line, remember a
// value, in order), its own AI model, voice and interruption setting (overrides), and passing the call on to a phone
// number or to another agent of the workspace. Every change goes through the draft editor.

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T = unknown,>(v: unknown): T[] => Array.isArray(v) ? v as T[] : [];

interface Props {
  editor: DraftEditor;
  agent: AgentRole;
  index: number;
  disabled: boolean;
  /** Applies an edit on the canvas: new blocks get a free place, and what it is about is selected. */
  onApply: (result: EditResult) => void;
}

const Heading = ({ title, hint }: {title: string;hint?: string;}) =>
<div className="mb-2">
    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h4>
    {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
  </div>;


// ---- on_enter ---------------------------------------------------------------------------------------------------------
export function EnterSteps({ editor, agent, index, disabled }: Props) {
  const config = editor.config as AgentConfig;
  const steps = list<Json>(agent.on_enter);
  const base: Path = ['agents', 'items', index, 'on_enter'];
  const variables = isObj(config.state?.variables) ? config.state?.variables as Json : {};
  const apply = (next: AgentConfig) => next !== config && editor.replaceConfig(next);
  return (
    <section className="mt-6" aria-label="When it takes over" id={fieldId(base)}>
      <Heading title="When it takes over" hint="What this agent does first, in order, each time a call reaches it." />
      {steps.length === 0 && <p className="text-xs text-muted">Nothing yet: it starts by listening.</p>}
      <ol className="space-y-2">
        {steps.map((step, i) =>
        <li key={i} className="rounded-md border border-line p-2.5" data-enter-step={i}>
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 break-words text-[13px] text-ink"><span className="mr-1.5 font-mono text-xs text-muted">{i + 1}.</span>{describeEnterStep(step, config)}</p>
              <div className="flex shrink-0 gap-0.5">
                <IconButton label={`Move step ${i + 1} up`} disabled={disabled || i === 0} onClick={() => apply(moveEnterStep(config, agent.id, i, -1))}><ArrowUpIcon className="h-3.5 w-3.5" aria-hidden /></IconButton>
                <IconButton label={`Move step ${i + 1} down`} disabled={disabled || i === steps.length - 1} onClick={() => apply(moveEnterStep(config, agent.id, i, 1))}><ArrowDownIcon className="h-3.5 w-3.5" aria-hidden /></IconButton>
                <IconButton label={`Remove step ${i + 1}`} danger disabled={disabled} onClick={() => apply(removeEnterStep(config, agent.id, i))}><Trash2Icon className="h-3.5 w-3.5" aria-hidden /></IconButton>
              </div>
            </div>
            {step.type === 'say' && typeof step.text === 'string' &&
          <textarea
            aria-label={`What it says in step ${i + 1}`}
            rows={2}
            value={step.text}
            disabled={disabled}
            onChange={(e) => editor.update([...base, i, 'text'], e.target.value)}
            className={cn(inputClass, 'mt-2 resize-y text-[13px]')} />
          }
            {step.type === 'set_state' && <StateValues editor={editor} path={[...base, i, 'values']} values={isObj(step.values) ? step.values : {}} variables={variables} disabled={disabled} />}
          </li>
        )}
      </ol>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => apply(addSay(config, agent.id))}><PlusIcon className="h-3.5 w-3.5" aria-hidden />Say a line</Button>
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => apply(addUpdateState(config, agent.id))}><PlusIcon className="h-3.5 w-3.5" aria-hidden />Remember a value</Button>
      </div>
    </section>);

}

/** The values an “update state” step sets: one row per variable, typed by its kind. */
function StateValues({ editor, path, values, variables, disabled }: {editor: DraftEditor;path: Path;values: Json;variables: Json;disabled: boolean;}) {
  const names = Object.keys(variables);
  const free = names.filter((n) => !(n in values));
  if (!names.length) return <p className="mt-2 text-xs text-warning">There is nothing to remember yet. Add a value under Advanced → Things it remembers.</p>;
  const set = (next: Json) => editor.update(path, next);
  return (
    <div className="mt-2 space-y-1.5">
      {Object.entries(values).map(([name, value]) => {
        const variable = isObj(variables[name]) ? variables[name] as Json : {};
        return (
          <div key={name} className="flex items-center gap-2 text-[13px]">
            <span className="w-24 shrink-0 truncate font-mono text-xs text-ink-soft" title={name}>{name}</span>
            {variable.type === 'boolean' ?
            <select aria-label={`Value of ${name}`} disabled={disabled} value={String(value)} onChange={(e) => set({ ...values, [name]: e.target.value === 'true' })} className={cn(inputClass, 'h-8 py-0 text-[13px]')}>
                <option value="true">yes</option>
                <option value="false">no</option>
              </select> :
            variable.type === 'enum' ?
            <select aria-label={`Value of ${name}`} disabled={disabled} value={String(value)} onChange={(e) => set({ ...values, [name]: e.target.value })} className={cn(inputClass, 'h-8 py-0 text-[13px]')}>
                {list<string>(variable.values).map((v) => <option key={v} value={v}>{v}</option>)}
              </select> :
            typeof value === 'object' && value !== null ?
            <span className="text-xs text-muted">Set under Advanced JSON</span> :

            <input
              aria-label={`Value of ${name}`}
              disabled={disabled}
              value={String(value ?? '')}
              inputMode={variable.type === 'integer' || variable.type === 'number' ? 'decimal' : undefined}
              onChange={(e) => {
                const raw = e.target.value;
                const numeric = variable.type === 'integer' || variable.type === 'number';
                set({ ...values, [name]: numeric && raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw });
              }}
              className={cn(inputClass, 'h-8 text-[13px]')} />
            }
            <IconButton label={`Stop setting ${name}`} danger disabled={disabled} onClick={() => {
              const next = { ...values };
              delete next[name];
              set(next);
            }}><Trash2Icon className="h-3.5 w-3.5" aria-hidden /></IconButton>
          </div>);

      })}
      {free.length > 0 &&
      <select
        aria-label="Remember another value"
        disabled={disabled}
        value=""
        onChange={(e) => e.target.value && set({ ...values, [e.target.value]: blankValue(variables[e.target.value]) })}
        className={cn(inputClass, 'h-8 py-0 text-[13px]')}>
          <option value="">Also remember…</option>
          {free.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      }
    </div>);

}

// ---- the agent's own model, voice and interruptions ------------------------------------------------------------------
export function OwnSettings({ editor, agent, disabled }: Props) {
  const config = editor.config as AgentConfig;
  const { answer } = useProviders();
  const change = (next: AgentRole) => editor.replaceConfig(replaceAgent(config, next));
  const interrupt = interruptChoice(agent);
  const hasVoice = (config.channels ?? []).some((c) => c && c.type !== 'web_chat' && c.enabled !== false);
  return (
    <section className="mt-6" aria-label="Its own settings">
      <Heading title="Its own settings" hint="Leave these on the default to use what the whole agent uses." />
      <div className="space-y-3">
        <OverrideSelect
          id={`own-llm-${agent.id}`}
          label="AI model"
          value={llmChoice(agent, config)}
          fallback={`Use the default: ${defaultLlm(config)}`}
          options={llmOptions(agent, answer, config)}
          disabled={disabled}
          onChange={(v) => change(setLlm(agent, v, config, answer))} />
        {hasVoice &&
        <OverrideSelect
          id={`own-voice-${agent.id}`}
          label="Voice"
          value={voiceChoice(agent, config)}
          fallback={`Use the default: ${defaultVoice(config)}`}
          options={voiceOptions(agent, config)}
          disabled={disabled}
          onChange={(v) => change(setVoice(agent, v, config, answer))} />
        }
        <div>
          <label htmlFor={`own-interrupt-${agent.id}`} className="text-[13px] font-medium text-ink-soft">Callers can interrupt it</label>
          <select
            id={`own-interrupt-${agent.id}`}
            disabled={disabled}
            value={interrupt === undefined ? '' : String(interrupt)}
            onChange={(e) => change(setInterrupt(agent, e.target.value === '' ? undefined : e.target.value === 'true'))}
            className={cn(inputClass, 'mt-1.5')}>
            <option value="">Use the default ({defaultInterrupt(config) ? 'yes' : 'no'})</option>
            <option value="true">Yes</option>
            <option value="false">No, it finishes what it says</option>
          </select>
        </div>
      </div>
    </section>);

}

function OverrideSelect({ id, label, value, fallback, options, disabled, onChange }: {id: string;label: string;value: string;fallback: string;options: OverrideOption[];disabled: boolean;onChange: (v: string) => void;}) {
  const groups = [...new Set(options.map((o) => o.group))];
  return (
    <div>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-soft">{label}</label>
      <select id={id} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputClass, 'mt-1.5')}>
        <option value="">{fallback}</option>
        {groups.map((g) =>
        <optgroup key={g} label={g}>
            {options.filter((o) => o.group === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </optgroup>
        )}
      </select>
    </div>);

}

// ---- passing the call on ------------------------------------------------------------------------------------------------
// The workspace's numbers (GET /numbers): fetched once per page, again on request.
let numbersPromise: Promise<unknown> | null = null;
const loadNumbers = (fresh = false) => {
  if (fresh || !numbersPromise) numbersPromise = api.listNumbers().catch((error: unknown) => {
    numbersPromise = null;
    throw error;
  });
  return numbersPromise;
};

export function PassTheCallOn({ editor, agent, disabled, onApply }: Props) {
  const config = editor.config as AgentConfig;
  const { agents } = useStudio();
  const [number, setNumber] = useState('');
  const [other, setOther] = useState('');
  const [numbers, setNumbers] = useState<unknown>(null);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    let off = false;
    loadNumbers().then(
      (n) => !off && setNumbers(n),
      () => !off && setProblem('The workspace’s phone numbers could not be read, so other agents can’t be offered.')
    );
    return () => {
      off = true;
    };
  }, []);
  const others = useMemo(() => workspaceAgents(agents.map((a) => ({ id: a.id, name: a.name })), numbers, editor.agent?.id ?? ''), [agents, numbers, editor.agent?.id]);
  const reachable = others.filter((o) => o.numbers.length);
  const typedProblem = number.trim() ? numberProblem(number) : '';
  const done = (r: TransferEdit) => {
    onApply({ config: r.config, refused: '', select: r.toolId ? [`tool::${r.toolId}`] : undefined, note: r.note || undefined });
  };
  return (
    <section className="mt-6" aria-label="Pass the call on">
      <Heading title="Pass the call on" hint="A transfer the agent can make when the caller needs someone else. Callers hear a callback line if it can’t connect." />
      <div className="space-y-3">
        <form
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!number.trim() || typedProblem) return;
            done(addPhoneTransfer(config, agent.id, number));
            setNumber('');
          }}>
          <label htmlFor={`transfer-number-${agent.id}`} className="text-[13px] font-medium text-ink-soft">To a phone number</label>
          <div className="flex gap-2">
            <input id={`transfer-number-${agent.id}`} value={number} disabled={disabled} onChange={(e) => setNumber(e.target.value)} placeholder="+44 20 7946 0000" className={cn(inputClass, 'font-mono text-[13px]')} />
            <Button size="sm" variant="secondary" type="submit" className="h-9" disabled={disabled || !number.trim() || !!typedProblem}>
              <PhoneForwardedIcon className="h-3.5 w-3.5" aria-hidden />Add
            </Button>
          </div>
          {typedProblem && <p className="text-xs text-warning">{typedProblem}</p>}
        </form>
        <div className="space-y-1.5">
          <label htmlFor={`transfer-agent-${agent.id}`} className="text-[13px] font-medium text-ink-soft">To another agent in this workspace</label>
          <div className="flex gap-2">
            <select id={`transfer-agent-${agent.id}`} value={other} disabled={disabled || !reachable.length} onChange={(e) => setOther(e.target.value)} className={inputClass}>
              <option value="">{numbers === null && !problem ? 'Reading the phone numbers…' : reachable.length ? 'Choose an agent…' : 'No other agent has a phone number yet'}</option>
              {reachable.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.numbers[0].number})</option>)}
            </select>
            <Button
              size="sm"
              variant="secondary"
              className="h-9"
              disabled={disabled || !other}
              onClick={() => {
                const chosen = reachable.find((o) => o.id === other);
                if (chosen) done(addTransferToAgent(config, agent.id, chosen));
                setOther('');
              }}>
              <PlusIcon className="h-3.5 w-3.5" aria-hidden />Add
            </Button>
          </div>
          <p className="text-xs text-muted">A call reaches another agent through one of its phone numbers (Library → Phone numbers).</p>
          {problem && <p className="text-xs text-warning">{problem}</p>}
        </div>
      </div>
    </section>);

}

function IconButton({ label, onClick, disabled, danger, children }: {label: string;onClick: () => void;disabled?: boolean;danger?: boolean;children: React.ReactNode;}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn('rounded p-1 text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40', danger ? 'hover:bg-danger-soft hover:text-danger' : 'hover:bg-subtle hover:text-ink')}>
      {children}
    </button>);

}
