import React, { useEffect, useState } from 'react';
import { ArrowRightIcon, CopyIcon, ExternalLinkIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react';
import type { AgentConfig, AgentRole, Issue, Path } from '../../../../types/studio';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import type { BuildSection } from '../../../../models/agentPages';
import {
  AGENT_KIND_LABEL,
  CHANNEL_LABEL,
  addConnectionFor,
  connect,
  isInjected,
  pathOfNode,
  removeEdge,
  setEntry,
  type EditResult,
  type FlowEdge,
  type FlowGraph,
  type FlowNode,
} from '../../../../models/workflow';
import { numberProblem } from '../../../../models/setup';
import { EDGE_MEANING, KIND_TONE, captionOf, iconOf } from './look';
import { EnterSteps, OwnSettings, PassTheCallOn } from './AgentExtras';
import { UsedBy } from '../relations/UsedBy';
import { Toggle } from '../../../ui/Toggle';
import { Button } from '../../../ui/Button';
import { getAt, fieldId } from '../../../../utils/path';
import { issuesAt } from '../../../../utils/validate';
import { cn, inputClass, inputErrorClass } from '../../../../utils/styles';

// The settings of the selected block or arrow, beside the canvas. Every field writes the server's own config path through
// the draft editor (so Save, Undo and the server's checks apply as everywhere else); problems the server found at a field
// are shown under it. Fields have the same ids as elsewhere (fieldId), so a problem in the checks can focus its field.

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T = unknown,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

interface Ctx {
  editor: DraftEditor;
  config: AgentConfig;
  errors: Issue[];
  warnings: Issue[];
  disabled: boolean;
}

interface InspectorProps {
  editor: DraftEditor;
  graph: FlowGraph;
  node: FlowNode | null;
  edge: FlowEdge | null;
  selectedCount: number;
  onApply: (result: EditResult) => void;
  onSelect: (id: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
  onOpenSection: (section: BuildSection) => void;
  /** Show a place in the config (a “used by” button): its block, or where it is edited. */
  onShowPath?: (path: Path) => void;
}

export function Inspector({ editor, graph, node, edge, selectedCount, onApply, onSelect, onDuplicate, onDelete, onClose, onOpenSection, onShowPath }: InspectorProps) {
  const config = editor.config;
  if (!config) return null;
  const ctx: Ctx = { editor, config, errors: editor.validation?.errors ?? [], warnings: editor.validation?.warnings ?? [], disabled: !editor.canEdit };

  let title = 'Nothing selected';
  let caption = '';
  let body: React.ReactNode;
  let icon: React.ReactNode = null;
  if (selectedCount > 1) {
    title = `${selectedCount} items selected`;
    body = (
      <div className="space-y-3 text-[13px] text-ink-soft">
        <p>Move them together by dragging any one of them. Duplicate copies the agents and tools among them; Delete takes everything selected away (Ctrl+Z brings it back).</p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onDuplicate} disabled={ctx.disabled}><CopyIcon className="h-3.5 w-3.5" aria-hidden />Duplicate</Button>
          <Button size="sm" variant="danger" onClick={onDelete} disabled={ctx.disabled}><Trash2Icon className="h-3.5 w-3.5" aria-hidden />Delete</Button>
        </div>
      </div>);

  } else if (node) {
    const Icon = iconOf(node);
    icon = <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', KIND_TONE[node.kind])}><Icon className="h-4 w-4" aria-hidden /></span>;
    title = node.label;
    caption = captionOf(node);
    body =
    <>
        {node.loose && <p className="mb-4 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-warning">Not connected: {node.loose}</p>}
        {node.kind === 'agent' && <AgentSettings ctx={ctx} node={node} graph={graph} onApply={onApply} onSelect={onSelect} onOpenSection={onOpenSection} />}
        {node.kind === 'channel' && <ChannelSettings ctx={ctx} node={node} onOpenSection={onOpenSection} />}
        {node.kind === 'tool' && <ToolSettings ctx={ctx} node={node} onSelect={onSelect} onShowPath={onShowPath} />}
        {node.kind === 'knowledge' && <KnowledgeSettings ctx={ctx} node={node} graph={graph} onSelect={onSelect} onOpenSection={onOpenSection} />}
        <AdvancedJson ctx={ctx} path={pathOfNode(node)} keepId={node.ref} />
      </>;

  } else if (edge) {
    title = edgeTitle(edge, graph);
    caption = 'Connection';
    body = <EdgeSettings ctx={ctx} edge={edge} graph={graph} onApply={onApply} onSelect={onSelect} onOpenSection={onOpenSection} />;
  } else {
    body = <p className="text-[13px] text-muted">Select a block or an arrow to see its settings here.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-2.5 border-b border-line px-4 py-3">
        {icon}
        <div className="min-w-0 flex-1">
          {caption && <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{caption}</p>}
          <h3 className="break-words text-sm font-semibold text-ink">{title}</h3>
          {node && <p className="mt-0.5 break-all font-mono text-xs text-muted">{node.ref}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close the settings panel" className="rounded p-1 text-muted hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <XIcon className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{body}</div>
      {selectedCount === 1 && (node || edge && !edge.fixed) &&
      <div className="flex flex-wrap gap-2 border-t border-line px-4 py-2.5">
          {node && (node.kind === 'agent' || node.kind === 'tool') &&
        <Button size="sm" variant="secondary" onClick={onDuplicate} disabled={ctx.disabled}><CopyIcon className="h-3.5 w-3.5" aria-hidden />Duplicate</Button>
        }
          {(node && node.kind !== 'knowledge' || edge) &&
        <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={onDelete} disabled={ctx.disabled}>
              <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
              {edge ? 'Remove connection' : 'Delete'}
            </Button>
        }
        </div>
      }
    </div>);

}

const nameOf = (graph: FlowGraph, id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
function edgeTitle(edge: FlowEdge, graph: FlowGraph) {
  return `${nameOf(graph, edge.source)} → ${nameOf(graph, edge.target)}`;
}

// ---- fields --------------------------------------------------------------------------------------------------------
interface FieldProps {
  ctx: Ctx;
  path: Path;
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}

/** A labelled setting with the server's problems at its path under it. */
function Field({ ctx, path, label, hint, required, children }: FieldProps) {
  const errors = issuesAt(ctx.errors, path);
  const warnings = issuesAt(ctx.warnings, path);
  return (
    <div id={fieldId(path)} className="scroll-mt-4 rounded-md transition-[box-shadow] duration-200">
      <label htmlFor={`${fieldId(path)}-input`} className="flex items-baseline gap-1 text-[13px] font-medium text-ink-soft">
        {label}
        {required && <span className="text-danger" aria-hidden>*</span>}
        {required && <span className="sr-only">(required)</span>}
      </label>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-1.5">{children}</div>
      {errors.map((e, i) => <p key={`e${i}`} className="mt-1 break-words text-xs text-danger [overflow-wrap:anywhere]" role="alert">{e.message}</p>)}
      {warnings.map((w, i) => <p key={`w${i}`} className="mt-1 break-words text-xs text-warning [overflow-wrap:anywhere]">{w.message}</p>)}
    </div>);

}

const hasIssue = (ctx: Ctx, path: Path) => issuesAt(ctx.errors, path).length > 0;

function TextField({ ctx, path, label, hint, required, multiline, rows = 3, placeholder, emptyRemoves, mono }: Omit<FieldProps, 'children'> & { multiline?: boolean; rows?: number; placeholder?: string; emptyRemoves?: boolean; mono?: boolean }) {
  const value = getAt(ctx.config, path);
  const missing = required && (value === undefined || value === '');
  if (value !== undefined && typeof value !== 'string')
    return (
      <Field ctx={ctx} path={path} label={label} hint={hint} required={required}>
        <p className="rounded-md bg-subtle px-3 py-2 text-xs text-muted">Set in a form this panel doesn’t edit. Change it under Advanced JSON below.</p>
      </Field>);

  const props = {
    id: `${fieldId(path)}-input`,
    value: value ?? '',
    placeholder,
    disabled: ctx.disabled,
    'aria-required': required || undefined,
    'aria-invalid': hasIssue(ctx, path) || undefined,
    className: cn(inputClass, (hasIssue(ctx, path) || missing) && inputErrorClass, mono && 'font-mono text-[13px]', multiline && 'resize-y leading-relaxed'),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => ctx.editor.update(path, e.target.value === '' && emptyRemoves ? undefined : e.target.value),
  };
  return (
    <Field ctx={ctx} path={path} label={label} hint={hint} required={required}>
      {multiline ? <textarea rows={rows} {...props} /> : <input {...props} />}
      {missing && !hasIssue(ctx, path) && <p className="mt-1 text-xs text-danger">Required.</p>}
    </Field>);

}

function NumberField({ ctx, path, label, hint, min, max, step }: Omit<FieldProps, 'children'> & { min?: number; max?: number; step?: number }) {
  const value = getAt(ctx.config, path);
  return (
    <Field ctx={ctx} path={path} label={label} hint={hint}>
      <input
        id={`${fieldId(path)}-input`}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={typeof value === 'number' ? value : ''}
        placeholder="Server default"
        disabled={ctx.disabled}
        className={cn(inputClass, hasIssue(ctx, path) && inputErrorClass)}
        onChange={(e) => ctx.editor.update(path, e.target.value === '' || !Number.isFinite(Number(e.target.value)) ? undefined : Number(e.target.value))} />
    </Field>);

}

function SelectField({ ctx, path, label, hint, required, options, empty }: Omit<FieldProps, 'children'> & { options: { value: string; label: string }[]; empty?: string }) {
  const raw = getAt(ctx.config, path);
  const value = typeof raw === 'string' ? raw : '';
  const known = options.some((o) => o.value === value);
  return (
    <Field ctx={ctx} path={path} label={label} hint={hint} required={required}>
      <select
        id={`${fieldId(path)}-input`}
        value={value}
        disabled={ctx.disabled}
        aria-required={required || undefined}
        className={cn(inputClass, (hasIssue(ctx, path) || required && !value) && inputErrorClass)}
        onChange={(e) => ctx.editor.update(path, e.target.value === '' ? undefined : e.target.value)}>
        <option value="">{empty ?? (required ? 'Choose…' : 'Server default')}</option>
        {value && !known && <option value={value}>{value} (not found)</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>);

}

function ToggleField({ ctx, path, label, hint, fallback }: Omit<FieldProps, 'children'> & { fallback: boolean }) {
  const raw = getAt(ctx.config, path);
  const on = typeof raw === 'boolean' ? raw : fallback;
  return (
    <div id={fieldId(path)} className="flex items-start justify-between gap-3 rounded-md">
      <div>
        <p className="text-[13px] font-medium text-ink-soft">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
        {issuesAt(ctx.errors, path).map((e, i) => <p key={i} className="mt-1 text-xs text-danger" role="alert">{e.message}</p>)}
      </div>
      <Toggle id={`${fieldId(path)}-input`} checked={on} label={label} disabled={ctx.disabled} onChange={(v) => ctx.editor.update(path, v)} />
    </div>);

}

/** A list of strings, one per line. */
function LinesField({ ctx, path, label, hint, required }: Omit<FieldProps, 'children'>) {
  const raw = getAt(ctx.config, path);
  const [text, setText] = useState(() => list<string>(raw).join('\n'));
  const joined = list<string>(raw).join('\n');
  useEffect(() => {
    if (text.split('\n').map((s) => s.trim()).filter(Boolean).join('\n') !== joined) setText(joined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);
  return (
    <Field ctx={ctx} path={path} label={label} hint={hint} required={required}>
      <textarea
        id={`${fieldId(path)}-input`}
        rows={3}
        value={text}
        disabled={ctx.disabled}
        className={cn(inputClass, 'resize-y font-mono text-[13px]', hasIssue(ctx, path) && inputErrorClass)}
        onChange={(e) => {
          setText(e.target.value);
          const items = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
          ctx.editor.update(path, items.length || required ? items : undefined);
        }} />
    </Field>);

}

/** Edit any part of the block as JSON; applied when it parses, with its id kept (other settings refer to it). */
function AdvancedJson({ ctx, path, keepId, label = 'Advanced (JSON)' }: { ctx: Ctx; path: Path; keepId?: string; label?: string }) {
  const value = getAt(ctx.config, path);
  const pretty = JSON.stringify(value ?? {}, null, 2);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(pretty);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    setText(pretty);
    setProblem('');
  }, [pretty]);
  const apply = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setProblem(err instanceof Error ? `Not valid JSON: ${err.message}` : 'Not valid JSON.');
      return;
    }
    if (!isObj(parsed)) return setProblem('It has to be a JSON object: { … }.');
    if (keepId !== undefined && parsed.id !== keepId) return setProblem(`Keep "id": "${keepId}". Other settings refer to it by that id.`);
    setProblem('');
    ctx.editor.update(path, parsed);
  };
  return (
    <details className="mt-6 rounded-md border border-line" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer select-none px-3 py-2 text-[13px] font-medium text-ink-soft">{label}</summary>
      <div className="border-t border-line p-3">
        <p className="text-xs text-muted">Every setting of this block, as the server stores it. The server checks it like any other change.</p>
        <textarea
          aria-label={`${label} for ${keepId ?? 'this block'}`}
          rows={10}
          spellCheck={false}
          value={text}
          disabled={ctx.disabled}
          onChange={(e) => setText(e.target.value)}
          className={cn(inputClass, 'mt-2 resize-y font-mono text-xs leading-relaxed', problem && inputErrorClass)} />
        {problem && <p className="mt-1 break-words text-xs text-danger" role="alert">{problem}</p>}
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="secondary" onClick={apply} disabled={ctx.disabled || text === pretty}>Apply</Button>
          <Button size="sm" variant="ghost" onClick={() => setText(pretty)} disabled={text === pretty}>Reset</Button>
        </div>
      </div>
    </details>);

}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h4>
        {aside}
      </div>
      <div className="space-y-4">{children}</div>
    </section>);

}

function CheckList({ items, disabled, onToggle, empty }: { items: { id: string; label: string; sub?: string; on: boolean }[]; disabled: boolean; onToggle: (id: string, on: boolean) => void; empty: string }) {
  if (!items.length) return <p className="text-xs text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line rounded-md border border-line">
      {items.map((it) =>
      <li key={it.id}>
          <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-subtle">
            <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]" checked={it.on} disabled={disabled} onChange={(e) => onToggle(it.id, e.target.checked)} />
            <span className="min-w-0">
              <span className="block break-words text-[13px] text-ink">{it.label}</span>
              {it.sub && <span className="block break-words text-xs text-muted">{it.sub}</span>}
            </span>
          </label>
        </li>
      )}
    </ul>);

}

function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      {children}
    </button>);

}

const toggleIn = (items: unknown, id: string, on: boolean) => {
  const current = list<string>(items);
  return on ? current.includes(id) ? current : [...current, id] : current.filter((x) => x !== id);
};

// ---- agent ---------------------------------------------------------------------------------------------------------
function AgentSettings({ ctx, node, graph, onApply, onSelect, onOpenSection }: { ctx: Ctx; node: FlowNode; graph: FlowGraph; onApply: (r: EditResult) => void; onSelect: (id: string) => void; onOpenSection: (s: BuildSection) => void }) {
  const { config } = ctx;
  const [handoffTo, setHandoffTo] = useState('');
  const base: Path = ['agents', 'items', node.index];
  const agent = list<AgentRole>(config.agents?.items)[node.index];
  if (!agent) return null;
  const others = list<AgentRole>(config.agents?.items).filter((a) => isObj(a) && a.id !== agent.id);
  const tools = list<Json>(config.tools).filter((t) => isObj(t) && typeof t.id === 'string');
  const injected = list<Json>(config.knowledge).filter((b) => isObj(b) && isInjected(b));
  const channels = list<Json>(config.channels).filter(isObj);
  const extras = { editor: ctx.editor, agent, index: node.index, disabled: ctx.disabled, onApply };

  return (
    <>
      <Section title="About">
        <TextField ctx={ctx} path={[...base, 'name']} label="Name" required />
        <SelectField
          ctx={ctx}
          path={[...base, 'kind']}
          label="Role"
          required
          options={Object.entries(AGENT_KIND_LABEL).map(([value, label]) => ({ value, label }))}
          hint="A router only works out what the person needs and hands off; a specialist does one job; a single agent that answers on its own ignores hand-offs." />
        {node.entry ?
        <p className="rounded-md bg-accent-soft px-3 py-2 text-xs text-accent">Answers first: every channel starts with this agent.</p> :

        <Button size="sm" variant="secondary" disabled={ctx.disabled} onClick={() => onApply({ config: setEntry(config, agent.id), refused: '', note: `Every channel now starts with ${agent.name || agent.id}.` })}>
            Make it answer first
          </Button>
        }
      </Section>

      <Section title="Instructions">
        <TextField ctx={ctx} path={[...base, 'instructions', 'role']} label="What it does" required multiline rows={6} hint="Its job, how it talks and what it must not do. The model reads this on every turn." />
        <TextField ctx={ctx} path={[...base, 'instructions', 'opening']} label="When it takes over" multiline rows={2} emptyRemoves hint="An extra instruction used once, when this agent starts talking." />
        <LinesField ctx={ctx} path={[...base, 'instructions', 'rules']} label="Rules" hint="One per line." />
      </Section>

      <Section title="Hand-offs">
        {list<Json>(agent.handoffs).length === 0 && <p className="text-xs text-muted">It doesn’t hand off to another agent. Drag from its right-hand dot to an agent, or choose one below.</p>}
        {list<Json>(agent.handoffs).map((h, i) =>
        <div key={i} className="rounded-md border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => typeof h?.to === 'string' && onSelect(h.to)} className="flex min-w-0 items-center gap-1 text-[13px] font-medium text-ink hover:text-accent">
                <ArrowRightIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{nameOf(graph, String(h?.to ?? ''))}</span>
              </button>
              <button
              type="button"
              disabled={ctx.disabled}
              onClick={() => onApply(removeEdge(config, { id: '', kind: 'handoff', source: agent.id, target: String(h?.to), label: '', fixed: '', agentIndex: node.index, handoffIndex: i }))}
              className="rounded p-1 text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-50"
              aria-label={`Remove the hand-off to ${nameOf(graph, String(h?.to ?? ''))}`}>
                <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <div className="mt-2">
              <TextField ctx={ctx} path={[...base, 'handoffs', i, 'description']} label="When to take it" required multiline rows={2} />
            </div>
          </div>
        )}
        {others.length > 0 &&
        <div className="flex gap-2">
            <label className="sr-only" htmlFor={`add-handoff-${agent.id}`}>Hand off to</label>
            <select id={`add-handoff-${agent.id}`} className={inputClass} value={handoffTo} disabled={ctx.disabled} onChange={(e) => setHandoffTo(e.target.value)}>
              <option value="">Add a hand-off to…</option>
              {others.filter((o) => !list<Json>(agent.handoffs).some((h) => h?.to === o.id)).map((o) => <option key={o.id} value={o.id}>{o.name || o.id}</option>)}
            </select>
            <Button size="sm" variant="secondary" className="h-9" disabled={ctx.disabled || !handoffTo} onClick={() => {
            onApply(connect(config, agent.id, handoffTo));
            setHandoffTo('');
          }}>
              <PlusIcon className="h-3.5 w-3.5" aria-hidden />Add
            </Button>
          </div>
        }
      </Section>

      <Section title="Tools it can use">
        <div id={fieldId([...base, 'tools'])} className="rounded-md">
          <CheckList
            items={tools.map((t) => ({ id: String(t.id), label: typeof t.name === 'string' && t.name ? t.name : String(t.id), sub: typeof t.description === 'string' ? t.description : undefined, on: list(agent.tools).includes(t.id) }))}
            disabled={ctx.disabled}
            empty="This bot has no tools yet. Add one from the blocks panel."
            onToggle={(id, on) => ctx.editor.update([...base, 'tools'], toggleIn(agent.tools, id, on))} />
          {issuesAt(ctx.errors, [...base, 'tools']).map((e, i) => <p key={i} className="mt-1 break-words text-xs text-danger" role="alert">{e.message}</p>)}
        </div>
      </Section>

      <Section title="Read on every turn">
        <div id={fieldId([...base, 'knowledge'])} className="rounded-md">
          <CheckList
            items={injected.map((b) => ({ id: String(b.id), label: String(b.id), on: list(agent.knowledge).includes(b.id) }))}
            disabled={ctx.disabled}
            empty="No knowledge base is set to be read on every turn. Bases that are searched are reached through a knowledge search tool."
            onToggle={(id, on) => {
              const next = toggleIn(agent.knowledge, id, on);
              ctx.editor.update([...base, 'knowledge'], next.length ? next : undefined);
            }} />
        </div>
      </Section>

      <Section title="Channels">
        <div id={fieldId([...base, 'channels'])} className="rounded-md">
          <p className="mb-2 text-xs text-muted">Leave all unticked for every channel.</p>
          <CheckList
            items={channels.map((c) => ({ id: String(c.id), label: CHANNEL_LABEL[String(c.type)] ?? String(c.type), sub: String(c.id), on: list(agent.channels).includes(c.id) }))}
            disabled={ctx.disabled}
            empty="No channels."
            onToggle={(id, on) => {
              const next = toggleIn(agent.channels, id, on);
              ctx.editor.update([...base, 'channels'], next.length ? next : undefined);
            }} />
        </div>
      </Section>

      <EnterSteps {...extras} />
      <OwnSettings {...extras} />
      <PassTheCallOn {...extras} />
      <div className="mt-4"><LinkButton onClick={() => onOpenSection('agent')}>Models and voice for the whole agent <ExternalLinkIcon className="h-3 w-3" aria-hidden /></LinkButton></div>
    </>);

}

// ---- channel -------------------------------------------------------------------------------------------------------
function SpeechField({ ctx, path, label, hint }: { ctx: Ctx; path: Path; label: string; hint?: string }) {
  const say = getAt(ctx.config, path);
  if (isObj(say) && typeof say.message === 'string') {
    const i = list<Json>(ctx.config.messages).findIndex((m) => isObj(m) && m.id === say.message);
    if (i >= 0) return <TextField ctx={ctx} path={['messages', i, 'text']} label={label} multiline rows={2} hint={`A fixed line (${say.message}) from the agent’s list of lines: changing it changes it everywhere it is said.`} />;
  }
  return <TextField ctx={ctx} path={path} label={label} hint={hint} multiline rows={2} emptyRemoves />;
}

function ChannelSettings({ ctx, node, onOpenSection }: { ctx: Ctx; node: FlowNode; onOpenSection: (s: BuildSection) => void }) {
  const base: Path = ['channels', node.index];
  const channels = list<Json>(ctx.config.channels);
  const channel = channels[node.index];
  if (!isObj(channel)) return null;
  const voice = channel.type === 'sip_voice' || channel.type === 'web_voice';
  const othersOn = channels.some((c, i) => i !== node.index && isObj(c) && c.enabled !== false);
  return (
    <>
      <Section title="Channel">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium text-ink-soft">Switched on</p>
            <p className="mt-0.5 text-xs text-muted">{othersOn || channel.enabled === false ? 'People can reach it this way.' : 'It is the only way to reach it, so it stays on.'}</p>
          </div>
          <Toggle id={`${fieldId([...base, 'enabled'])}-input`} checked={channel.enabled !== false} label="Switched on" disabled={ctx.disabled || channel.enabled !== false && !othersOn} onChange={(v) => ctx.editor.update([...base, 'enabled'], v)} />
        </div>
        <p className="text-xs text-muted">Every channel starts with the agent that answers first. To change which agent that is, connect this channel to another agent.</p>
      </Section>
      <Section title="What it says">
        <SpeechField ctx={ctx} path={[...base, 'greeting', 'say']} label="First line" hint="Leave it empty to wait for the person to speak first." />
        {voice && <ToggleField ctx={ctx} path={[...base, 'greeting', 'allow_interruptions']} label="Can be interrupted" hint="The person can talk over the first line." fallback={true} />}
        <TextField ctx={ctx} path={[...base, 'instructions_append']} label="Extra instructions on this channel" multiline rows={2} emptyRemoves hint="Added to every agent’s instructions on this channel." />
      </Section>
      {channel.type === 'sip_voice' &&
      <Section title="Phone number">
          <p className="text-xs text-muted">A number is connected to this agent when it goes live, under Release.</p>
        </Section>
      }
      <div className="mt-4"><LinkButton onClick={() => onOpenSection('channels')}>All channel settings <ExternalLinkIcon className="h-3 w-3" aria-hidden /></LinkButton></div>
    </>);

}

// ---- tool ----------------------------------------------------------------------------------------------------------
const connectionOptions = (config: AgentConfig, type: string) =>
Object.entries(isObj(config.connections) ? (config.connections as Json) : {}).
filter(([, c]) => isObj(c) && c.type === type).
map(([id, c]) => {
  const where = isObj(c) ? String(c.base_url ?? c.url ?? '') : '';
  return { value: id, label: where ? `${id} · ${where}` : id };
});

/** Declares a connection from its web address and points this tool at it, so a dropped HTTP or MCP block can be finished here. */
function NewConnection({ ctx, toolIndex, kind, first }: { ctx: Ctx; toolIndex: number; kind: 'http' | 'mcp'; first: boolean }) {
  const [open, setOpen] = useState(first);
  const [address, setAddress] = useState('');
  const [problem, setProblem] = useState('');
  useEffect(() => setOpen(first), [first, toolIndex]);
  if (ctx.disabled) return null;
  if (!open) {
    return (
      <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => setOpen(true)}>
        + New connection
      </button>
    );
  }
  const add = () => {
    const r = addConnectionFor(ctx.config, toolIndex, address);
    if (r.problem) return setProblem(r.problem);
    ctx.editor.replaceConfig(r.config);
    setAddress('');
    setProblem('');
    setOpen(false);
  };
  return (
    <div className="rounded-md border border-line bg-canvas p-2.5">
      <label className="text-xs font-medium text-ink" htmlFor={`new-connection-${toolIndex}`}>
        {first ? `This agent has no ${kind === 'http' ? 'HTTP' : 'MCP'} connection yet. ` : ''}Address of the {kind === 'http' ? 'API' : 'MCP server'}
      </label>
      <div className="mt-1.5 flex gap-1.5">
        <input
          id={`new-connection-${toolIndex}`}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder={kind === 'http' ? 'https://api.example.com' : 'https://mcp.example.com/mcp'}
          className={cn(problem ? inputErrorClass : inputClass, 'min-w-0 flex-1 font-mono text-xs')}
        />
        <Button size="sm" variant="secondary" onClick={add} disabled={!address.trim()}>
          Add
        </Button>
      </div>
      {problem ? (
        <p role="alert" className="mt-1 text-xs text-danger">{problem}</p>
      ) : (
        <p className="mt-1 text-xs text-muted">Sign-in details are secrets the server holds; set them in the JSON view under connections.</p>
      )}
    </div>
  );
}

function ToolSettings({ ctx, node, onSelect, onShowPath }: { ctx: Ctx; node: FlowNode; onSelect: (id: string) => void; onShowPath?: (path: Path) => void }) {
  const { config } = ctx;
  const base: Path = ['tools', node.index];
  const tool = list<Json>(config.tools)[node.index];
  if (!isObj(tool)) return null;
  const needsDescription = ['http', 'mcp', 'knowledge', 'code'].includes(String(tool.type));
  const agents = list<AgentRole>(config.agents?.items).filter(isObj);
  const channels = list<Json>(config.channels).filter(isObj);
  const connection = isObj(config.connections) && typeof tool.connection === 'string' ? (config.connections as Json)[tool.connection] : undefined;
  const builtin = tool.type === 'builtin' ? String(tool.builtin ?? '') : '';
  const transfers = list<Json>((config.telephony as Json | undefined)?.transfers);
  const params = isObj(tool.params) ? tool.params : {};
  const transferIndex = transfers.findIndex((t) => isObj(t) && t.id === params.transfer);
  const target = transferIndex >= 0 ? transfers[transferIndex].target : undefined;
  const stateVars = Object.keys(isObj(config.state) && isObj((config.state as Json).variables) ? ((config.state as Json).variables as Json) : {});

  return (
    <>
      <Section title="What it’s for">
        <TextField
          ctx={ctx}
          path={[...base, 'description']}
          label="When to use it"
          required={needsDescription}
          multiline
          rows={3}
          emptyRemoves={!needsDescription}
          hint="The model reads this to decide when to call the tool." />
        <SelectField ctx={ctx} path={[...base, 'reply']} label="After it runs" options={[{ value: 'model', label: 'The agent answers using its result' }, { value: 'none', label: 'Nothing more is said this turn' }]} />
      </Section>

      {tool.type === 'http' &&
      <Section title="Request">
          <SelectField ctx={ctx} path={[...base, 'connection']} label="Connection" required options={connectionOptions(config, 'http')} hint="Where the API is and how to sign in. Credentials are secrets the server holds; they never appear here." />
          {isObj(connection) && isObj(connection.auth) && <p className="text-xs text-muted">Signs in with a secret the server holds.</p>}
          <NewConnection ctx={ctx} toolIndex={node.index} kind="http" first={connectionOptions(config, 'http').length === 0} />
          <SelectField ctx={ctx} path={[...base, 'request', 'method']} label="Method" required options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m }))} />
          <TextField ctx={ctx} path={[...base, 'request', 'path']} label="Path" required mono placeholder="/orders/{{args.order_number}}" hint="Added to the connection’s address. {{args.NAME}} puts in what the model supplies." />
          <NumberField ctx={ctx} path={[...base, 'timeout_s']} label="Timeout (seconds)" min={0} step={0.5} />
          <NumberField ctx={ctx} path={[...base, 'retries']} label="Retries" min={0} step={1} />
          <TextField ctx={ctx} path={[...base, 'on_error', 'tool_error']} label="Told to the model when it fails" multiline rows={2} emptyRemoves />
          <AdvancedJson ctx={ctx} path={[...base, 'parameters']} label="What the model supplies (JSON Schema)" />
        </Section>
      }

      {tool.type === 'mcp' &&
      <Section title="MCP server">
          <SelectField ctx={ctx} path={[...base, 'server']} label="Server connection" required options={connectionOptions(config, 'mcp')} />
          <NewConnection ctx={ctx} toolIndex={node.index} kind="mcp" first={connectionOptions(config, 'mcp').length === 0} />
          <LinesField ctx={ctx} path={[...base, 'allow']} label="Tools it may use" required hint="One per line. Nothing else on the server is exposed." />
        </Section>
      }

      {tool.type === 'knowledge' &&
      <Section title="Search">
          <SelectField
          ctx={ctx}
          path={[...base, 'source']}
          label="Knowledge base"
          required
          options={list<Json>(config.knowledge).filter((b) => isObj(b) && !isInjected(b)).map((b) => ({ value: String(b.id), label: String(b.id) }))}
          hint="Only bases set to be searched by a tool are listed." />
          {!list<Json>(config.knowledge).some((b) => isObj(b) && !isInjected(b)) &&
          <p className="text-xs text-warning">This agent has no knowledge base to search yet. Add documents under Build → Knowledge, then pick it here.</p>
          }
          <NumberField ctx={ctx} path={[...base, 'top_k']} label="Passages per search" min={1} max={20} step={1} />
          <TextField ctx={ctx} path={[...base, 'on_error', 'tool_error']} label="Told to the model when the search fails" multiline rows={2} emptyRemoves />
        </Section>
      }

      {tool.type === 'code' &&
      <Section title="Code">
          <SelectField ctx={ctx} path={[...base, 'runtime']} label="Language" options={[{ value: 'python', label: 'Python' }, { value: 'javascript', label: 'JavaScript' }]} />
          <TextField ctx={ctx} path={[...base, 'handler']} label="Function" required mono placeholder="tools/lookup.py:run" />
          <NumberField ctx={ctx} path={[...base, 'sandbox', 'timeout_s']} label="Timeout (seconds)" min={0} step={0.5} />
          <ToggleField ctx={ctx} path={[...base, 'sandbox', 'network']} label="Network access" fallback={false} />
          <AdvancedJson ctx={ctx} path={[...base, 'parameters']} label="What the model supplies (JSON Schema)" />
        </Section>
      }

      {tool.type === 'task' &&
      <Section title="Task">
          <SelectField ctx={ctx} path={[...base, 'task']} label="Task" required options={list<Json>(config.tasks).filter(isObj).map((t) => ({ value: String(t.id), label: String(t.id) }))} />
        </Section>
      }

      {builtin === 'end_call' &&
      <Section title="Goodbye">
          <SpeechField ctx={ctx} path={[...base, 'params', 'say']} label="Said before it ends" hint="Said in full, then the conversation ends." />
        </Section>
      }

      {builtin === 'transfer_or_callback' &&
      <Section title="Transfer">
          <SelectField ctx={ctx} path={[...base, 'params', 'transfer']} label="Transfer" required options={transfers.filter(isObj).map((t) => ({ value: String(t.id), label: String(t.id) }))} />
          {transferIndex >= 0 && (target === undefined || typeof target === 'string') &&
        <>
              <TextField ctx={ctx} path={['telephony', 'transfers', transferIndex, 'target']} label="Number or SIP address" mono placeholder="+65 6123 4567" hint="With no number, callers hear the callback line instead." />
              {typeof target === 'string' && numberProblem(target) && <p className="text-xs text-warning">{numberProblem(target)}</p>}
            </>
        }
          {list(params.fallback).length > 0 && <p className="text-xs text-muted">When it can’t transfer, it runs {list(params.fallback).length} step{list(params.fallback).length === 1 ? '' : 's'} instead (see Advanced JSON).</p>}
        </Section>
      }

      {builtin === 'return_to_entry' &&
      <Section title="Going back">
          <ToggleField ctx={ctx} path={[...base, 'params', 'guard_loops']} label="Stop loops" hint="Only goes back once the person has spoken since this agent’s last tool call." fallback={true} />
        </Section>
      }

      {builtin === 'collect_dtmf' &&
      <Section title="Keypad">
          <NumberField ctx={ctx} path={[...base, 'params', 'num_digits']} label="Digits" min={1} step={1} />
          <NumberField ctx={ctx} path={[...base, 'params', 'timeout_s']} label="Wait (seconds)" min={0} step={0.5} />
          <SelectField ctx={ctx} path={[...base, 'params', 'into']} label="Keep the digits in" options={stateVars.map((v) => ({ value: v, label: v }))} empty="Give them to the model" hint="For a PIN, code or card number, keep them in a state variable so the model never sees them." />
        </Section>
      }

      {builtin === 'noop' && <ConditionalRules ctx={ctx} base={base} tool={tool} onSelect={onSelect} />}

      <Section title="Used by">
        <CheckList
          items={agents.map((a) => ({ id: a.id, label: a.name || a.id, sub: a.id, on: list(a.tools).includes(tool.id) }))}
          disabled={ctx.disabled}
          empty="No agents."
          onToggle={(id, on) => {
            const i = agents.findIndex((a) => a.id === id);
            if (i >= 0) ctx.editor.update(['agents', 'items', list(config.agents?.items).indexOf(agents[i]), 'tools'], toggleIn(agents[i].tools, String(tool.id), on));
          }} />
        <UsedBy config={config} collection="tools" id={String(tool.id)} onGo={onShowPath} label="Named in" />
        {typeof tool.connection === 'string' && tool.connection && <UsedBy config={config} collection="connections" id={tool.connection} onGo={onShowPath} label={`The connection “${tool.connection}” is used by`} />}
      </Section>

      <Section title="Channels">
        <div id={fieldId([...base, 'channels'])} className="rounded-md">
          <p className="mb-2 text-xs text-muted">Leave all unticked to offer it on every channel.</p>
          <CheckList
            items={channels.map((c) => ({ id: String(c.id), label: CHANNEL_LABEL[String(c.type)] ?? String(c.type), sub: String(c.id), on: list(tool.channels).includes(c.id) }))}
            disabled={ctx.disabled}
            empty="No channels."
            onToggle={(id, on) => {
              const next = toggleIn(tool.channels, id, on);
              ctx.editor.update([...base, 'channels'], next.length ? next : undefined);
            }} />
        </div>
      </Section>
    </>);

}

// A conditional hand-off: a tool that does nothing itself; its effects hand off, each when its condition holds. The
// conditions this form edits are "always", "on a channel" and "a state value equals"; anything else stays as it is.
type RuleShape = { kind: 'always' } | { kind: 'channel'; channel: string } | { kind: 'state'; state: string; equals: string } | { kind: 'other' };
function shapeOf(rule: Json): { when: RuleShape; to: string } | null {
  const steps = list<Json>(rule.do);
  if (steps.length !== 1 || !isObj(steps[0]) || steps[0].type !== 'handoff' || typeof steps[0].to !== 'string') return null;
  const w = rule.when;
  let when: RuleShape = { kind: 'other' };
  if (w === undefined) when = { kind: 'always' };
  else if (isObj(w) && Object.keys(w).length === 1 && typeof w.channel === 'string') when = { kind: 'channel', channel: w.channel };
  else if (isObj(w) && Object.keys(w).length === 2 && typeof w.state === 'string' && ['string', 'number', 'boolean'].includes(typeof w.equals)) when = { kind: 'state', state: w.state, equals: String(w.equals) };
  return { when, to: steps[0].to };
}

function ConditionalRules({ ctx, base, tool, onSelect }: { ctx: Ctx; base: Path; tool: Json; onSelect: (id: string) => void }) {
  const { config } = ctx;
  const rules = list<Json>(tool.effects);
  const agents = list<AgentRole>(config.agents?.items).filter(isObj);
  const channels = list<Json>(config.channels).filter(isObj);
  const variables = isObj(config.state) && isObj((config.state as Json).variables) ? ((config.state as Json).variables as Json) : {};
  const write = (i: number, when: RuleShape, to: string) => {
    const rule: Json = { do: [{ type: 'handoff', to }] };
    if (when.kind === 'channel') rule.when = { channel: when.channel };
    if (when.kind === 'state') {
      const type = isObj(variables[when.state]) ? (variables[when.state] as Json).type : 'string';
      const equals = type === 'boolean' ? when.equals === 'true' : type === 'integer' || type === 'number' ? Number(when.equals) : when.equals;
      rule.when = { state: when.state, equals };
    }
    ctx.editor.update([...base, 'effects', i], rule);
  };
  return (
    <Section
      title="Rules"
      aside={
      <Button size="sm" variant="ghost" disabled={ctx.disabled || agents.length === 0} onClick={() => ctx.editor.update([...base, 'effects'], [...rules, { do: [{ type: 'handoff', to: agents[0]?.id }] }])}>
          <PlusIcon className="h-3.5 w-3.5" aria-hidden />Add rule
        </Button>
      }>
      <p className="text-xs text-muted">When an agent calls this tool, each rule whose condition holds runs, in order. Connect it to an agent on the canvas to add an unconditional hand-off.</p>
      {rules.length === 0 && <p className="text-xs text-warning">No rules yet: calling it does nothing.</p>}
      {rules.map((rule, i) => {
        const shape = isObj(rule) ? shapeOf(rule) : null;
        const path: Path = [...base, 'effects', i];
        if (!shape || shape.when.kind === 'other')
          return (
            <div key={i} id={fieldId(path)} className="rounded-md border border-line px-3 py-2 text-xs text-muted">
              Rule {i + 1} does more than a hand-off this form edits. Change it under Advanced JSON.
            </div>);

        const { when, to } = shape;
        return (
          <div key={i} id={fieldId(path)} className="space-y-2 rounded-md border border-line p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-ink-soft">Rule {i + 1}</p>
              <button type="button" disabled={ctx.disabled} onClick={() => ctx.editor.update([...base, 'effects'], rules.filter((_, k) => k !== i))} className="rounded p-1 text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-50" aria-label={`Remove rule ${i + 1}`}>
                <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <label className="block text-xs text-muted">
              When
              <select
                className={cn(inputClass, 'mt-1')}
                value={when.kind}
                disabled={ctx.disabled}
                onChange={(e) => {
                  const kind = e.target.value;
                  if (kind === 'channel') write(i, { kind: 'channel', channel: String(channels[0]?.id ?? '') }, to);else
                  if (kind === 'state') write(i, { kind: 'state', state: Object.keys(variables)[0] ?? '', equals: '' }, to);else
                  write(i, { kind: 'always' }, to);
                }}>
                <option value="always">Always</option>
                <option value="channel">The conversation is on a channel</option>
                <option value="state" disabled={Object.keys(variables).length === 0}>A state value equals{Object.keys(variables).length === 0 ? ' (no state variables)' : ''}</option>
              </select>
            </label>
            {when.kind === 'channel' &&
            <select aria-label="Channel" className={inputClass} value={when.channel} disabled={ctx.disabled} onChange={(e) => write(i, { kind: 'channel', channel: e.target.value }, to)}>
                {channels.map((c) => <option key={String(c.id)} value={String(c.id)}>{CHANNEL_LABEL[String(c.type)] ?? String(c.type)} ({String(c.id)})</option>)}
              </select>
            }
            {when.kind === 'state' &&
            <div className="flex gap-2">
                <select aria-label="State variable" className={inputClass} value={when.state} disabled={ctx.disabled} onChange={(e) => write(i, { ...when, state: e.target.value }, to)}>
                  {Object.keys(variables).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                <input aria-label="Equals" className={inputClass} value={when.equals} placeholder="value" disabled={ctx.disabled} onChange={(e) => write(i, { ...when, equals: e.target.value }, to)} />
              </div>
            }
            <label className="block text-xs text-muted">
              Hand off to
              <select className={cn(inputClass, 'mt-1')} value={to} disabled={ctx.disabled} onChange={(e) => write(i, when, e.target.value)}>
                {!agents.some((a) => a.id === to) && <option value={to}>{to} (not found)</option>}
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
              </select>
            </label>
            <LinkButton onClick={() => onSelect(to)}>Show {agents.find((a) => a.id === to)?.name ?? to}</LinkButton>
            {issuesAt(ctx.errors, path).map((e, k) => <p key={k} className="break-words text-xs text-danger" role="alert">{e.message}</p>)}
          </div>);

      })}
    </Section>);

}

// ---- knowledge base ------------------------------------------------------------------------------------------------
function KnowledgeSettings({ ctx, node, graph, onSelect, onOpenSection }: { ctx: Ctx; node: FlowNode; graph: FlowGraph; onSelect: (id: string) => void; onOpenSection: (s: BuildSection) => void }) {
  const base: Path = ['knowledge', node.index];
  const kb = list<Json>(ctx.config.knowledge)[node.index];
  if (!isObj(kb)) return null;
  const users = graph.edges.filter((e) => e.target === node.id && (e.kind === 'reads' || e.kind === 'searches'));
  return (
    <>
      <Section title="How it’s used">
        <SelectField
          ctx={ctx}
          path={[...base, 'mode']}
          label="Mode"
          options={[{ value: 'tool', label: 'Searched by a tool, when the agent decides' }, { value: 'inject', label: 'Read on every turn' }]}
          empty="Searched by a tool (server default)"
          hint="Changing it changes how agents reach it: searched bases go through a knowledge search tool, read-every-turn bases are ticked on the agent. The checks say if a connection no longer fits." />
        <NumberField ctx={ctx} path={[...base, 'top_k']} label="Passages per search" min={1} max={20} step={1} />
      </Section>
      <Section title="Reached by">
        {users.length === 0 ? <p className="text-xs text-muted">Nothing reaches it yet.</p> :
        <ul className="space-y-1">
            {users.map((e) =>
          <li key={e.id}>
                <LinkButton onClick={() => onSelect(e.source)}>{nameOf(graph, e.source)}</LinkButton>
                <span className="text-xs text-muted"> · {e.kind === 'reads' ? 'reads it every turn' : 'searches it'}</span>
              </li>
          )}
          </ul>
        }
      </Section>
      <Section title="Documents">
        <p className="text-xs text-muted">{kb.type === 'vector_store' ? `${list(kb.sources).length} source${list(kb.sources).length === 1 ? '' : 's'}.` : 'An external search service.'} Documents are uploaded and indexed on the Knowledge page.</p>
        <LinkButton onClick={() => onOpenSection('knowledge')}>Manage documents <ExternalLinkIcon className="h-3 w-3" aria-hidden /></LinkButton>
      </Section>
    </>);

}

// ---- arrows --------------------------------------------------------------------------------------------------------
function EdgeSettings({ ctx, edge, graph, onApply, onSelect, onOpenSection }: { ctx: Ctx; edge: FlowEdge; graph: FlowGraph; onApply: (r: EditResult) => void; onSelect: (id: string) => void; onOpenSection: (s: BuildSection) => void }) {
  const { config } = ctx;
  const agents = list<AgentRole>(config.agents?.items).filter(isObj);
  return (
    <>
      <p className="text-[13px] text-ink-soft">{EDGE_MEANING[edge.kind]}.</p>
      <p className="mt-2 flex flex-wrap items-center gap-1 text-xs">
        <LinkButton onClick={() => onSelect(edge.source)}>{nameOf(graph, edge.source)}</LinkButton>
        <ArrowRightIcon className="h-3 w-3 text-muted" aria-hidden />
        <LinkButton onClick={() => onSelect(edge.target)}>{nameOf(graph, edge.target)}</LinkButton>
      </p>
      {edge.kind === 'handoff' && edge.agentIndex !== undefined && edge.handoffIndex !== undefined &&
      <div className="mt-5 space-y-4">
          <TextField ctx={ctx} path={['agents', 'items', edge.agentIndex, 'handoffs', edge.handoffIndex, 'description']} label="When to take it" required multiline rows={3} hint="The model reads this to decide when to hand off." />
          <TextField ctx={ctx} path={['agents', 'items', edge.agentIndex, 'handoffs', edge.handoffIndex, 'tool']} label="Name the model sees" required mono hint="Lowercase letters, digits and underscores. Must differ from every tool’s name." />
          <ToggleField ctx={ctx} path={['agents', 'items', edge.agentIndex, 'handoffs', edge.handoffIndex, 'carry_context']} label="Pass the conversation so far" fallback={true} />
          <SpeechField ctx={ctx} path={['agents', 'items', edge.agentIndex, 'handoffs', edge.handoffIndex, 'announce']} label="Said while handing off" hint="Optional. Covers the moment the next agent takes to start." />
        </div>
      }
      {edge.kind === 'entry' &&
      <div className="mt-5">
          <label htmlFor="entry-agent" className="text-[13px] font-medium text-ink-soft">Agent that answers first</label>
          <select id="entry-agent" className={cn(inputClass, 'mt-1.5')} value={graph.entry} disabled={ctx.disabled} onChange={(e) => onApply({ config: setEntry(config, e.target.value), refused: '', note: 'Every channel now starts with that agent.' })}>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
          </select>
          <p className="mt-1 text-xs text-muted">A bot has one agent that answers first, for every channel.</p>
        </div>
      }
      {edge.fixed && edge.kind !== 'entry' && <p className="mt-4 rounded-md bg-subtle px-3 py-2 text-xs text-muted">{edge.fixed}</p>}
      {edge.kind === 'rule_handoff' && <div className="mt-2"><LinkButton onClick={() => onOpenSection('guardrails')}>Open Guardrails <ExternalLinkIcon className="h-3 w-3" aria-hidden /></LinkButton></div>}
      {edge.kind === 'tool_handoff' && <p className="mt-4 text-xs text-muted">Its conditions are edited on the tool. <LinkButton onClick={() => onSelect(edge.source)}>Open the tool</LinkButton></p>}
      {edge.kind === 'uses' && <p className="mt-4 text-xs text-muted">Removing the connection keeps the tool; the agent just can’t call it.</p>}
      {edge.kind === 'searches' && <p className="mt-4 text-xs text-muted">Connect the tool to another knowledge base to search that one instead.</p>}
    </>);

}
