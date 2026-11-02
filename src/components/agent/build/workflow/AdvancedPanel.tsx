import { useEffect, useState } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import type { AgentConfig, AgentRole, Path } from '../../../../types/studio';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import { AGENT_KIND_LABEL, setEntry } from '../../../../models/workflow';
import { EVENT_KINDS, STATE_TYPES, addEvent, addStateVariable, describeEnterStep, removeStateVariable, stateNameProblem } from '../../../../models/workflowExtras';
import { Dialog } from '../../../ui/Dialog';
import { Button } from '../../../ui/Button';
import { Segmented } from '../../../ui/Segmented';
import { Toggle } from '../../../ui/Toggle';
import { UsedBy } from '../relations/UsedBy';
import { issuesAt } from '../../../../utils/validate';
import { cn, inputClass, inputErrorClass } from '../../../../utils/styles';

// “Advanced”: the parts of the workflow that aren't blocks on the canvas: every agent at once (which answers first,
// names and roles), the values a call remembers (state.variables), and what runs on events (events[]). Each field writes
// the server's own path through the draft editor; the server's problems are shown at the field they are about.

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T = unknown,>(v: unknown): T[] => Array.isArray(v) ? v as T[] : [];

export type AdvancedTab = 'agents' | 'state' | 'events';

interface Props {
  editor: DraftEditor;
  open: boolean;
  tab: AdvancedTab;
  onTab: (tab: AdvancedTab) => void;
  onClose: () => void;
  /** Select an agent's block on the canvas. */
  onShowAgent: (id: string) => void;
  onShowPath: (path: Path) => void;
}

export function AdvancedPanel({ editor, open, tab, onTab, onClose, onShowAgent, onShowPath }: Props) {
  const config = editor.config;
  if (!config) return null;
  const disabled = !editor.canEdit;
  return (
    <Dialog open={open} onClose={onClose} size="xl" title="Advanced" description="Every agent at once, the values a call remembers, and what runs when something happens during a call.">
      <Segmented<AdvancedTab>
        label="Part"
        value={tab}
        onChange={onTab}
        options={[{ value: 'agents', label: 'Agents' }, { value: 'state', label: 'Things it remembers' }, { value: 'events', label: 'Events' }]} />
      <div className="mt-5">
        {tab === 'agents' && <AgentsPart editor={editor} config={config} disabled={disabled} onShowAgent={(id) => {
          onClose();
          onShowAgent(id);
        }} />}
        {tab === 'state' && <StatePart editor={editor} config={config} disabled={disabled} onShowPath={(p) => {
          onClose();
          onShowPath(p);
        }} />}
        {tab === 'events' && <EventsPart editor={editor} config={config} disabled={disabled} />}
      </div>
    </Dialog>);

}

const Problems = ({ editor, path }: {editor: DraftEditor;path: Path;}) =>
<>
    {issuesAt(editor.validation?.errors ?? [], path).map((e, i) => <p key={i} role="alert" className="mt-1 text-xs text-danger">{e.message}</p>)}
  </>;


// ---- agents -----------------------------------------------------------------------------------------------------------
function AgentsPart({ editor, config, disabled, onShowAgent }: {editor: DraftEditor;config: AgentConfig;disabled: boolean;onShowAgent: (id: string) => void;}) {
  const items = list<AgentRole>(config.agents?.items);
  const agents = items.filter((a) => isObj(a) && typeof a.id === 'string');
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="advanced-entry" className="text-[13px] font-medium text-ink-soft">Answers first</label>
        <select
          id="advanced-entry"
          disabled={disabled}
          value={String(config.agents?.entry ?? '')}
          onChange={(e) => editor.replaceConfig(setEntry(config, e.target.value))}
          className={cn(inputClass, 'mt-1.5 max-w-sm')}>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
        </select>
        <Problems editor={editor} path={['agents', 'entry']} />
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
            <th className="py-2 pr-3 font-semibold">Name</th>
            <th className="py-2 pr-3 font-semibold">Role</th>
            <th className="py-2 pr-3 font-semibold">Takes over by</th>
            <th className="py-2 font-semibold"><span className="sr-only">Show</span></th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => {
            const i = items.indexOf(a);
            return (
              <tr key={a.id} className="border-b border-line align-top">
                <td className="py-2 pr-3">
                  <input aria-label={`Name of ${a.id}`} disabled={disabled} value={a.name ?? ''} onChange={(e) => editor.update(['agents', 'items', i, 'name'], e.target.value)} className={cn(inputClass, 'h-8 text-[13px]')} />
                  <p className="mt-0.5 font-mono text-xs text-muted">{a.id}</p>
                  <Problems editor={editor} path={['agents', 'items', i, 'name']} />
                </td>
                <td className="py-2 pr-3">
                  <select aria-label={`Role of ${a.name || a.id}`} disabled={disabled} value={String(a.kind ?? '')} onChange={(e) => editor.update(['agents', 'items', i, 'kind'], e.target.value || undefined)} className={cn(inputClass, 'h-8 py-0 text-[13px]')}>
                    <option value="">Server default</option>
                    {Object.entries(AGENT_KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </td>
                <td className="py-2 pr-3 text-xs text-ink-soft">
                  {list(a.on_enter).length ? list(a.on_enter).map((s, k) => <p key={k}>{describeEnterStep(s, config)}</p>) : <span className="text-muted">Listening</span>}
                </td>
                <td className="py-2 text-right">
                  <Button size="sm" variant="ghost" onClick={() => onShowAgent(a.id)}>Show</Button>
                </td>
              </tr>);

          })}
        </tbody>
      </table>
    </div>);

}

// ---- state ------------------------------------------------------------------------------------------------------------
function StatePart({ editor, config, disabled, onShowPath }: {editor: DraftEditor;config: AgentConfig;disabled: boolean;onShowPath: (p: Path) => void;}) {
  const variables = isObj(config.state?.variables) ? config.state?.variables as Json : {};
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('string');
  const problem = name ? stateNameProblem(config, name) : '';
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">Values a call remembers: tools and steps set them, and instructions can use them as {'{{state.name}}'}.</p>
      {Object.keys(variables).length === 0 && <p className="text-[13px] text-muted">Nothing yet.</p>}
      <ul className="space-y-3">
        {Object.entries(variables).map(([key, raw]) => {
          const v = isObj(raw) ? raw : {};
          const base: Path = ['state', 'variables', key];
          return (
            <li key={key} data-state-variable={key} className="rounded-md border border-line p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-[13px] font-medium text-ink">{key}</span>
                <select aria-label={`Kind of ${key}`} disabled={disabled} value={String(v.type ?? 'string')} onChange={(e) => editor.update([...base, 'type'], e.target.value)} className={cn(inputClass, 'h-8 w-36 py-0 text-[13px]')}>
                  {STATE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <label className="flex items-center gap-2 text-xs text-ink-soft">
                  <Toggle checked={v.sensitive === true} disabled={disabled} label={`${key} is sensitive`} onChange={(on) => editor.update([...base, 'sensitive'], on || undefined)} />
                  Sensitive (a PIN, a card number)
                </label>
                <button type="button" aria-label={`Remove ${key}`} disabled={disabled} onClick={() => editor.replaceConfig(removeStateVariable(config, key))} className="ml-auto rounded p-1 text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-40">
                  <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
              {v.type === 'enum' &&
              <ListInput
                label={`Values of ${key}`}
                value={list<string>(v.values)}
                disabled={disabled}
                onChange={(next) => editor.update([...base, 'values'], next)} />
              }
              <input
                aria-label={`What ${key} is for`}
                placeholder="What it is for (optional)"
                disabled={disabled}
                value={typeof v.description === 'string' ? v.description : ''}
                onChange={(e) => editor.update([...base, 'description'], e.target.value || undefined)}
                className={cn(inputClass, 'mt-2 h-8 text-[13px]')} />
              <Problems editor={editor} path={base} />
              <div className="mt-2"><UsedBy config={config} collection="state" id={key} onGo={onShowPath} /></div>
            </li>);

        })}
      </ul>
      <form
        className="flex flex-wrap items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name || problem) return;
          editor.replaceConfig(addStateVariable(config, name, type));
          setName('');
        }}>
        <div>
          <label htmlFor="new-state-name" className="sr-only">Name of the new value</label>
          <input id="new-state-name" value={name} disabled={disabled} onChange={(e) => setName(e.target.value.trim())} placeholder="new_value_name" className={cn(inputClass, 'h-8 w-52 font-mono text-[13px]', problem && inputErrorClass)} />
          {problem && <p className="mt-1 text-xs text-danger">{problem}</p>}
        </div>
        <label htmlFor="new-state-type" className="sr-only">Kind of the new value</label>
        <select id="new-state-type" value={type} disabled={disabled} onChange={(e) => setType(e.target.value)} className={cn(inputClass, 'h-8 w-36 py-0 text-[13px]')}>
          {STATE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <Button size="sm" variant="secondary" type="submit" disabled={disabled || !name || !!problem}><PlusIcon className="h-3.5 w-3.5" aria-hidden />Add a value</Button>
      </form>
    </div>);

}

function ListInput({ label, value, disabled, onChange }: {label: string;value: string[];disabled: boolean;onChange: (v: string[]) => void;}) {
  const joined = value.join(', ');
  const [text, setText] = useState(joined);
  useEffect(() => setText(joined), [joined]);
  return (
    <input
      aria-label={label}
      value={text}
      disabled={disabled}
      placeholder="first, second, third"
      onChange={(e) => {
        setText(e.target.value);
        const items = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
        if (items.length) onChange(items);
      }}
      className={cn(inputClass, 'mt-2 h-8 text-[13px]')} />);

}

// ---- events -----------------------------------------------------------------------------------------------------------
function EventsPart({ editor, config, disabled }: {editor: DraftEditor;config: AgentConfig;disabled: boolean;}) {
  const events = list<Json>(config.events);
  const [on, setOn] = useState(EVENT_KINDS[0].value);
  const kindLabel = (v: unknown) => EVENT_KINDS.find((k) => k.value === v)?.label ?? String(v);
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">Steps that run when something happens during a call, whichever agent is talking: a call starts or ends, a transfer fails, a value changes.</p>
      {events.length === 0 && <p className="text-[13px] text-muted">Nothing runs on events yet.</p>}
      <ul className="space-y-3">
        {events.map((ev, i) =>
        <li key={i} data-event={i} className="rounded-md border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label={`Event ${i + 1}`} disabled={disabled} value={String(ev.on ?? '')} onChange={(e) => editor.update(['events', i, 'on'], e.target.value)} className={cn(inputClass, 'h-8 w-64 py-0 text-[13px]')}>
                {!EVENT_KINDS.some((k) => k.value === ev.on) && <option value={String(ev.on ?? '')}>{kindLabel(ev.on)}</option>}
                {EVENT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              {ev.when !== undefined && <span className="text-xs text-muted">only when a condition holds</span>}
              <button
              type="button"
              aria-label={`Remove event ${i + 1}`}
              disabled={disabled}
              onClick={() => {
                const rest = events.filter((_, k) => k !== i);
                editor.update(['events'], rest.length ? rest : undefined);
              }}
              className="ml-auto rounded p-1 text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-40">
                <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[13px] text-ink-soft">
              {list(ev.do).length ? list(ev.do).map((s, k) => <li key={k}>{describeEnterStep(s, config)}</li>) : <li className="list-none text-warning">No steps yet: add them below.</li>}
            </ol>
            <StepsJson editor={editor} path={['events', i, 'do']} value={ev.do} disabled={disabled} />
            <Problems editor={editor} path={['events', i]} />
          </li>
        )}
      </ul>
      <div className="flex flex-wrap gap-2">
        <label htmlFor="new-event" className="sr-only">When</label>
        <select id="new-event" value={on} disabled={disabled} onChange={(e) => setOn(e.target.value)} className={cn(inputClass, 'h-8 w-64 py-0 text-[13px]')}>
          {EVENT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => editor.replaceConfig(addEvent(config, on))}><PlusIcon className="h-3.5 w-3.5" aria-hidden />Add an event</Button>
      </div>
    </div>);

}

/** An event's steps as JSON, applied when they parse to a list. */
function StepsJson({ editor, path, value, disabled }: {editor: DraftEditor;path: Path;value: unknown;disabled: boolean;}) {
  const pretty = JSON.stringify(Array.isArray(value) ? value : [], null, 2);
  const [text, setText] = useState(pretty);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    setText(pretty);
    setProblem('');
  }, [pretty]);
  const apply = () => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) return setProblem('The steps are a list: [ … ].');
      setProblem('');
      editor.update(path, parsed);
    } catch (e) {
      setProblem(e instanceof Error ? `Not valid JSON: ${e.message}` : 'Not valid JSON.');
    }
  };
  return (
    <details className="mt-2">
      <summary className="cursor-pointer select-none text-xs font-medium text-ink-soft">Edit the steps (JSON)</summary>
      <textarea aria-label="Steps as JSON" rows={6} spellCheck={false} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} className={cn(inputClass, 'mt-2 resize-y font-mono text-xs', problem && inputErrorClass)} />
      {problem && <p role="alert" className="mt-1 text-xs text-danger">{problem}</p>}
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="secondary" disabled={disabled || text === pretty} onClick={apply}>Apply</Button>
        <Button size="sm" variant="ghost" disabled={text === pretty} onClick={() => setText(pretty)}>Reset</Button>
      </div>
    </details>);

}

