import React, { useState } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import type { AgentConfig } from '../../../../../types/studio';
import { isObj, list, problemsUnder, tasksOf, usedBy, type Json } from '../../../../../models/toolsExtras';
import { STEP_KINDS, TASK_KINDS, addStep, addTask, describeTask, moveStep, removeStep, removeTask, setOutcome, setStep, setTask, stepSay, type StepKind } from '../../../../../models/toolsTasks';
import { Toggle } from '../../../../ui/Toggle';
import { Button } from '../../../../ui/Button';
import { StatusChip } from '../../../../ui/StatusChip';
import { cn, inputClass } from '../../../../../utils/styles';
import { TryTask } from '../../try/TryTask';
import { ActionsSummary, EmptyNote, IdField, ItemCard, Labeled, MoveButtons, NumberInput, Select, TextInput, type ExtraEditorProps } from './shared';

const OUTCOMES: { key: 'on_success' | 'on_failure' | 'on_decline'; label: string }[] = [
  { key: 'on_success', label: 'When it works' },
  { key: 'on_failure', label: 'If it fails' },
  { key: 'on_decline', label: 'If the caller declines' },
];

/** Multi-step tasks (tasks[]): each read step by step, its steps edited in order, and tried on the server. */
export function TasksEditor({ config, disabled, errors, apply, remove, onOpenJson }: ExtraEditorProps) {
  const tasks = tasksOf(config);
  const [open, setOpen] = useState<number | null>(tasks.length === 1 ? 0 : null);

  return (
    <div className="space-y-3">
      {tasks.length === 0 && <EmptyNote>No tasks yet. A task walks a caller through several steps, such as checking who they are, and each answer is checked in code.</EmptyNote>}
      <ul className="space-y-2">
        {tasks.map((t, i) => {
          const id = String(t.id ?? '');
          const reading = describeTask(t);
          return (
            <ItemCard
              key={`${id}-${i}`}
              title={<code className="font-mono text-[13px]">{id || `task ${i + 1}`}</code>}
              summary={String(t.description || '') || reading.summary}
              problems={problemsUnder(errors, 'tasks', i)}
              open={open === i}
              onToggle={() => setOpen(open === i ? null : i)}
              onDelete={() => remove(`Task “${id}” deleted.`, removeTask(config, i))}
              deleteLabel={`Delete the task ${id}`}
              disabled={disabled}>
              <TaskReading task={t} />
              <TaskFields config={config} task={t} index={i} disabled={disabled} apply={apply} onOpenJson={onOpenJson} taken={tasks.map((x) => String(x.id ?? ''))} />
              <TryTask config={config} taskId={id} />
            </ItemCard>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            const made = addTask(config, 'verification');
            apply(made.config);
            setOpen(made.index);
          }}>
          <PlusIcon className="h-3.5 w-3.5" aria-hidden />
          Add a task that checks who the caller is
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            const made = addTask(config, 'collect_fields');
            apply(made.config);
            setOpen(made.index);
          }}>
          <PlusIcon className="h-3.5 w-3.5" aria-hidden />
          Add a task that collects details
        </Button>
      </div>
    </div>
  );
}

/** The task read top to bottom (describeTask), above the fields that change it. */
export function TaskReading({ task }: { task: unknown }) {
  const reading = describeTask(task);
  if (!reading.steps.length) return null;
  return (
    <section aria-label="The task step by step" className="rounded-lg bg-subtle px-4 py-3">
      <p className="text-[13px] font-medium text-ink">{reading.summary}</p>
      <ol className="mt-2 space-y-1.5">
        {reading.steps.map((s) => (
          <li key={`${s.id}-${s.number}`} className="flex gap-2 text-[13px]">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-medium text-ink-soft">{s.number}</span>
            <span className="min-w-0">
              <span className="block text-ink">{s.ask || s.id}</span>
              {s.notes.length > 0 && <span className="block text-xs text-muted">{s.notes.join(' · ')}</span>}
            </span>
          </li>
        ))}
      </ol>
      {reading.outcomes.length > 0 && (
        <dl className="mt-3 grid gap-x-3 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr]">
          {reading.outcomes.map((o) => (
            <React.Fragment key={o.key}>
              <dt className="font-medium text-ink-soft">{o.label}</dt>
              <dd className="text-ink-soft">{o.text}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </section>
  );
}

function TaskFields({ config, task, index, disabled, apply, onOpenJson, taken }: { config: AgentConfig; task: Json; index: number; disabled: boolean; apply: (next: AgentConfig) => void; onOpenJson: () => void; taken: string[] }) {
  const id = String(task.id ?? '');
  const steps = list<Json>(task.steps);
  const set = (changes: Json) => apply(setTask(config, index, changes));
  const tools = list<Json>(config.tools).map((t) => String(t?.id ?? '')).filter(Boolean);
  const stateVars = Object.keys(isObj(config.state?.variables) ? config.state.variables : {});
  const otherTasks = taken.filter((t) => t && t !== id);

  return (
    <>
      <IdField id={id} taken={taken} users={usedBy(config, 'tasks', id)} disabled={disabled} onRename={(v) => set({ id: v })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Labeled label="What it does">
          <Select label="What it does" value={String(task.kind ?? 'custom')} disabled={disabled} options={TASK_KINDS.map((k) => ({ value: k.kind, label: k.label }))} onChange={(v) => set({ kind: v })} />
        </Labeled>
        <Labeled label="What it is for">
          <TextInput value={String(task.description ?? '')} onChange={(v) => set({ description: v })} disabled={disabled} placeholder="Confirm who the caller is before account details are shared." label="What it is for" />
        </Labeled>
      </div>
      <Labeled label="Instructions for the task" help="What the AI is told while this task runs, on top of each step’s question.">
        <TextInput value={String(task.instructions ?? '')} onChange={(v) => set({ instructions: v })} disabled={disabled} multiline placeholder="Check every answer with the matching tool. Never reveal account details." label="Instructions for the task" />
      </Labeled>
      <div className="grid gap-3 sm:grid-cols-2">
        <Labeled label="Wrong answers allowed" help="Left empty: the runtime’s default.">
          <NumberInput value={task.max_attempts} onChange={(v) => set({ max_attempts: v && v >= 1 ? Math.round(v) : undefined })} disabled={disabled} min={1} label="Wrong answers allowed" />
        </Labeled>
        <Labeled label="Counted">
          <Select
            label="Counted"
            value={task.attempts_scope === 'task' ? 'task' : 'step'}
            disabled={disabled}
            options={[
              { value: 'step', label: 'On each step' },
              { value: 'task', label: 'Across the whole task' },
            ]}
            onChange={(v) => set({ attempts_scope: v === 'task' ? 'task' : undefined })}
          />
        </Labeled>
      </div>

      <fieldset>
        <legend className="text-[13px] font-medium text-ink-soft">Steps, in order</legend>
        <p className="text-xs text-muted">A later step is reached only once the ones before it have passed: the runtime makes sure, not the AI.</p>
        <ol className="mt-2 space-y-2">
          {steps.map((s, n) => (
            <StepRow
              key={`${String(s?.id)}-${n}`}
              step={s}
              number={n + 1}
              count={steps.length}
              disabled={disabled}
              tools={tools}
              stateVars={stateVars}
              config={config}
              onOpenJson={onOpenJson}
              onChange={(changes) => apply(setStep(config, index, n, changes))}
              onMove={(to) => apply(moveStep(config, index, n, to))}
              onRemove={() => apply(removeStep(config, index, n))}
            />
          ))}
        </ol>
        <div className="mt-2 flex flex-wrap gap-1">
          {STEP_KINDS.map((k) => (
            <Button key={k.kind} size="sm" variant="ghost" disabled={disabled} title={k.help} onClick={() => apply(addStep(config, index, k.kind))}>
              <PlusIcon className="h-3.5 w-3.5" aria-hidden />
              {k.label}
            </Button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-[13px] font-medium text-ink-soft">How it ends</legend>
        <div className="mt-2 space-y-2">
          {OUTCOMES.map(({ key, label }) => {
            const o = (isObj(task[key]) ? task[key] : {}) as Json;
            const change = (changes: Json) => apply(setOutcome(config, index, key, changes));
            return (
              <div key={key} className="rounded-md border border-line px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[13px] font-medium text-ink">{label}</p>
                  <label className="flex items-center gap-2 text-[13px] text-ink-soft">
                    Says nothing and carries on
                    <Toggle checked={o.silent === true} onChange={(v) => change({ silent: v })} label={`${label}: says nothing and carries on`} disabled={disabled} />
                  </label>
                </div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <Labeled label="Then">
                    <Select
                      label={`${label}: then`}
                      value={o.next ? `task:${String(o.next)}` : String(o.resume ?? '')}
                      disabled={disabled}
                      options={[
                        { value: '', label: 'The runtime’s default' },
                        { value: 'caller', label: 'Back to the agent that started it' },
                        { value: 'entry', label: 'Back to the first agent' },
                        ...otherTasks.map((t) => ({ value: `task:${t}`, label: `Start the task “${t}”` })),
                      ]}
                      onChange={(v) => change(v.startsWith('task:') ? { next: v.slice(5), resume: undefined } : { resume: v || undefined, next: undefined })}
                    />
                  </Labeled>
                  <Labeled label="The agent is told">
                    <TextInput value={String(o.tell_model ?? '')} onChange={(v) => change({ tell_model: v })} disabled={disabled} placeholder="The caller is verified. Carry on." label={`${label}: the agent is told`} />
                  </Labeled>
                </div>
                <ActionsSummary label="It also" actions={o.do} config={config} onOpenJson={onOpenJson} />
              </div>
            );
          })}
        </div>
      </fieldset>
    </>
  );
}

function StepRow({
  step,
  number,
  count,
  disabled,
  tools,
  stateVars,
  config,
  onOpenJson,
  onChange,
  onMove,
  onRemove,
}: {
  step: Json;
  number: number;
  count: number;
  disabled: boolean;
  tools: string[];
  stateVars: string[];
  config: AgentConfig;
  onOpenJson: () => void;
  onChange: (changes: Json) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const kind = (String(step.type ?? '') || 'collect') as StepKind;
  const id = String(step.id ?? '');
  const validate = isObj(step.validate) ? step.validate : null;
  const checkBy = validate?.type === 'tool' ? 'tool' : validate?.type === 'regex' ? 'regex' : '';
  const say = stepSay(step);
  const dtmf = isObj(step.dtmf) ? step.dtmf : {};
  return (
    <li className="rounded-md border border-line px-3 py-3" data-step-row={id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-subtle text-xs font-medium text-ink-soft">{number}</span>
        <select className={cn(inputClass, 'w-44')} value={kind} disabled={disabled} aria-label={`Step ${number} kind`} onChange={(e) => onChange({ type: e.target.value })}>
          {STEP_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
        <input className={cn(inputClass, 'w-36 font-mono text-[13px]')} value={id} disabled={disabled} aria-label={`Step ${number} id`} spellCheck={false} onChange={(e) => onChange({ id: e.target.value })} />
        <span className="flex-1" />
        <MoveButtons index={number - 1} count={count} onMove={onMove} disabled={disabled} what={`step ${id || number}`} />
        <Button size="sm" variant="ghost" aria-label={`Remove step ${id || number}`} disabled={disabled || count < 2} title={count < 2 ? 'A task needs one step at least.' : undefined} onClick={onRemove}>
          <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
      {kind === 'collect' && (
        <div className="mt-3 space-y-3">
          <Labeled label="What it asks">
            <TextInput value={String(step.ask ?? '')} onChange={(v) => onChange({ ask: v })} disabled={disabled} placeholder="Ask for the account number." label={`Step ${number}: what it asks`} />
          </Labeled>
          <div className="grid gap-3 sm:grid-cols-3">
            <Labeled label="The caller answers">
              <Select
                label={`Step ${number}: the caller answers`}
                value={step.input === 'dtmf' ? 'dtmf' : 'speech'}
                disabled={disabled}
                options={[
                  { value: 'speech', label: 'By speaking' },
                  { value: 'dtmf', label: 'On the keypad' },
                ]}
                onChange={(v) => onChange({ input: v })}
              />
            </Labeled>
            <Labeled label="Checked">
              <Select
                label={`Step ${number}: checked`}
                value={checkBy}
                disabled={disabled}
                options={[
                  { value: '', label: 'Not checked' },
                  { value: 'tool', label: 'By a tool' },
                  { value: 'regex', label: 'By a pattern' },
                ]}
                onChange={(v) => onChange({ validate: v === 'tool' ? { type: 'tool', tool: tools[0] ?? '' } : v === 'regex' ? { type: 'regex', pattern: '^\\d+$' } : undefined })}
              />
            </Labeled>
            <Labeled label="Tries on this step" help="Left empty: the task’s.">
              <NumberInput value={step.max_attempts} onChange={(v) => onChange({ max_attempts: v && v >= 1 ? Math.round(v) : undefined })} disabled={disabled} min={1} label={`Step ${number}: tries`} />
            </Labeled>
          </div>
          {checkBy === 'tool' && validate && (
            <Labeled label="The tool that checks it">
              <Select label={`Step ${number}: the tool that checks it`} value={String(validate.tool ?? '')} disabled={disabled} options={[{ value: '', label: 'Choose…' }, ...tools.map((t) => ({ value: t, label: t }))]} onChange={(v) => onChange({ validate: { ...validate, tool: v } })} className="max-w-xs" />
            </Labeled>
          )}
          {checkBy === 'regex' && validate && (
            <Labeled label="Pattern the answer must match">
              <TextInput value={String(validate.pattern ?? '')} onChange={(v) => onChange({ validate: { ...validate, pattern: v } })} disabled={disabled} mono label={`Step ${number}: pattern`} />
            </Labeled>
          )}
          {(step.input === 'dtmf' || step.store_in !== undefined) && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Labeled label="Keep the answer as" help={step.input === 'dtmf' ? 'Needed for a keypad answer. Mark it sensitive for a PIN.' : undefined}>
                <Select label={`Step ${number}: keep the answer as`} value={String(step.store_in ?? '')} disabled={disabled} options={[{ value: '', label: 'Not kept' }, ...[...stateVars, ...(step.store_in && !stateVars.includes(String(step.store_in)) ? [String(step.store_in)] : [])].map((v) => ({ value: v, label: v }))]} onChange={(v) => onChange({ store_in: v })} />
              </Labeled>
              {step.input === 'dtmf' && (
                <>
                  <Labeled label="Digits">
                    <NumberInput value={dtmf.num_digits} onChange={(v) => onChange({ dtmf: { ...dtmf, num_digits: v && v >= 1 ? Math.round(v) : undefined } })} disabled={disabled} min={1} label={`Step ${number}: digits`} />
                  </Labeled>
                  <Labeled label="Ended with">
                    <TextInput value={String(dtmf.terminator ?? '')} onChange={(v) => onChange({ dtmf: { ...dtmf, terminator: v.slice(0, 1) || undefined } })} disabled={disabled} placeholder="#" label={`Step ${number}: ended with`} />
                  </Labeled>
                </>
              )}
            </div>
          )}
          {step.input === 'dtmf' && <StatusChip tone="info">Phone calls only</StatusChip>}
        </div>
      )}
      {kind === 'say' && say !== null && (
        <div className="mt-3">
          <Labeled label="What it says">
            <TextInput value={say} onChange={(v) => onChange({ do: [{ type: 'say', text: v }] })} disabled={disabled} label={`Step ${number}: what it says`} />
          </Labeled>
        </div>
      )}
      {(kind === 'call' || (kind === 'say' && say === null)) && (
        <div className="mt-3">
          <ActionsSummary label="It runs" actions={step.do} config={config} onOpenJson={onOpenJson} />
        </div>
      )}
      {(step.skip_if !== undefined || step.requires !== undefined) && (
        <p className="mt-2 text-xs text-muted">
          {[step.skip_if !== undefined ? 'It has a rule for when it is skipped' : '', step.requires !== undefined ? 'a rule for when it is reached' : ''].filter(Boolean).join(' and ')}:{' '}
          <button type="button" onClick={onOpenJson} className="font-medium text-accent hover:underline">change in the JSON view</button>.
        </p>
      )}
    </li>
  );
}
