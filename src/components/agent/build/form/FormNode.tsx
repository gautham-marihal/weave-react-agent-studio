import React, { useContext, useEffect, useId, useMemo, useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, PlusIcon, RotateCcwIcon, ShieldIcon, Trash2Icon, XIcon } from 'lucide-react';
import type { Path } from '../../../../types/studio';
import { humanize, isObj, type Json, type SchemaNode, type Shape } from '../../../../models/schemaForm/engine';
import { arrayStyle, carryOver, isComplex, matchesDiscriminator, summarize } from '../../../../models/schemaForm/cardLogic';
import { cardsThatMayOpen } from '../../../../models/schemaForm/cardSize';
import { hiddenParts } from '../../../../models/schemaForm/hiddenParts';
import { CREATABLE } from '../../../../models/schemaForm/inlineCreate';
import { describeSetting } from '../../../../models/schemaForm/plainLanguage';
import { enumLabels } from '../../../../models/schemaForm/plainEnums';
import { PLAIN_KIND } from '../../../../models/schemaForm/plainKinds';
import { COLLECTIONS, collectionAt, lockedIdCollection } from '../../../../models/schemaForm/references';
import { isUnder, keyOf, omit, orderedSet, singular, uniqueId } from '../../../../models/schemaForm/paths';
import { groupKeys, orderKeys, readXui, splitAdvanced } from '../../../../models/schemaForm/xui';
import { fieldId } from '../../../../utils/path';
import { cn } from '../../../../utils/styles';
import { DepthContext, OwnerContext, useForm, useOwner, type FormIssue } from './formContext';
import { CheckGroup, FreeValue, JsonInput, MultiPick, NumberInput, SecretInput, Select, StringList, Switch, TextInput } from './inputs';
import { IdChip } from './IdTools';
import { InlineCreate } from './InlineCreate';
import { TechName } from './TechName';

// The settings form, drawn from GET /schema: each value gets the control its schema asks for (a text, a number, a
// switch, a choice in words, a list of cards, a choice of kinds…). A change is handed up as a new value; the form
// writes the section it belongs to as one undoable edit.

type Change = (value: unknown, meta?: { deleted?: string }) => void;

// Where the things a field may point at are made, and what they are called, for a field with nothing to choose yet.
const REF_TARGET: Record<string, [string, string]> = {
  agents: ['agents', 'Agents'],
  tools: ['tools', 'Tools'],
  tool_names: ['tools', 'Tools'],
  tasks: ['tasks', 'Multi-step tasks'],
  knowledge: ['knowledge', 'Knowledge'],
  forms: ['forms', 'Forms'],
  wrapups: ['wrapups', 'Closing messages'],
  messages: ['messages', 'Fixed lines'],
  notifications: ['notifications', 'Messages it sends'],
  channels: ['channels', 'Channels'],
  transfers: ['telephony', 'Phone transfers'],
  input_guardrails: ['guardrails', 'Safety rules'],
  schedules: ['schedules', 'Business hours'],
  state_vars: ['state', 'Things it remembers'],
  http_connections: ['connections', 'Connections'],
  mcp_connections: ['connections', 'Connections'],
  notifiers: ['connections', 'Connections'],
};
const REF_WORD: Record<string, string> = {
  agents: 'agents',
  tools: 'tools',
  tool_names: 'tools',
  tasks: 'tasks',
  knowledge: 'knowledge bases',
  forms: 'forms',
  wrapups: 'closing messages',
  messages: 'fixed lines',
  notifications: 'messages to send',
  channels: 'channels',
  transfers: 'transfers',
  input_guardrails: 'safety rules',
  schedules: 'schedules',
  state_vars: 'remembered values',
  http_connections: 'HTTP connections',
  mcp_connections: 'tool servers',
  notifiers: 'text or email services',
};
// What "Add …" calls one item where its key's own word would read oddly.
const ADD_WORDS: Record<string, string> = {
  notifications: 'message to send',
  wrapups: 'closing message',
  messages: 'fixed line',
  artifacts: 'file to save',
  variables: 'variable',
  constants: 'fixed value',
};

const iconButton =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-40';
const linkButton =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] font-medium text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50';

// ---- words, help and problems ---------------------------------------------------------------------------------------

/** The words a setting is drawn with: the server's own hint when it sends one, else the catalogue, else a rule label. */
function useSettingWords(name: string, shape: Shape, label?: string) {
  const owner = useOwner();
  const hints = readXui(shape);
  const info = describeSetting(name, { owner, description: shape.description });
  return {
    title: label || hints.label || info.label,
    lead: hints.help || info.purpose,
    example: hints.example || info.example,
    level: hints.audience || info.level,
    full: typeof shape.description === 'string' ? shape.description.trim() : '',
  };
}

/** What a setting is for, in plain words with an example; the schema's own description one click away. */
function Help({ lead, example, full, technical }: { lead: string; example: string; full: string; technical: boolean }) {
  const [open, setOpen] = useState(false);
  const more = full && full !== lead ? full : '';
  const shown = technical ? !open : open;
  if (!lead && !example && !more) return null;
  return (
    <div className="mt-0.5 text-[13px] leading-relaxed text-muted">
      {lead && <span>{lead} </span>}
      {example && (
        <span>
          For example: <em className="not-italic text-ink-soft">{example}</em>{' '}
        </span>
      )}
      {more && (
        <button type="button" aria-expanded={shown} onClick={() => setOpen((v) => !v)} className="rounded text-[12px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          {shown ? 'Less' : 'More'}
        </button>
      )}
      {more && shown && <span className="mt-1 block whitespace-pre-line text-[12px] text-muted">{more}</span>}
    </div>
  );
}

/** What is wrong with a place, in plain words, with a fix button where one is certain. */
function Issues({ pathKey, deep = false }: { pathKey: string; deep?: boolean }) {
  const { exact, issuesUnder, describe, applyFix, technical, disabled } = useForm();
  const list: FormIssue[] = deep ? issuesUnder(pathKey) : exact.get(pathKey) ?? [];
  if (!list.length) return null;
  return (
    <ul className="mt-1.5 space-y-1">
      {list.map((issue, index) => {
        const d = describe(issue);
        const error = issue.severity === 'error';
        return (
          <li key={index} className={cn('text-[13px]', error ? 'text-danger' : 'text-warning')} role={error ? 'alert' : undefined} title={d.recognised ? `The server said: ${issue.message}` : undefined}>
            {d.text}
            {technical && d.recognised && <span className="ml-1 font-mono text-[11px] text-muted">({issue.message})</span>}
            {!disabled &&
              d.fixes.map((fix) => (
                <button key={fix.id} type="button" onClick={() => applyFix(fix)} className="ml-2 rounded border border-line-strong bg-surface px-1.5 py-0.5 text-[12px] font-medium text-ink hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                  {fix.label}
                </button>
              ))}
          </li>
        );
      })}
    </ul>
  );
}

function Counts({ pathKey }: { pathKey: string }) {
  const { countUnder } = useForm();
  const c = countUnder(pathKey);
  if (c.errors > 0)
    return (
      <span className="rounded-full bg-danger-soft px-1.5 text-xs font-medium text-danger" title={`${c.errors} problem${c.errors === 1 ? '' : 's'} inside`}>
        {c.errors}
      </span>
    );
  if (c.warnings > 0)
    return (
      <span className="rounded-full bg-warning-soft px-1.5 text-xs font-medium text-warning" title={`${c.warnings} warning${c.warnings === 1 ? '' : 's'} inside`}>
        {c.warnings}
      </span>
    );
  return null;
}

// A focus request opens what holds it only while it is fresh: a group closed by hand stays closed later.
const FRESH_FOCUS_MS = 2500;

interface GroupProps {
  path: Path;
  title: string;
  hint?: string;
  count?: number | null;
  onRemove?: (() => void) | null;
  removeLabel?: string;
  defaultOpen?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/** A group of settings: a card that folds. Its parts are drawn only while it is open. */
function Group({ path, title, hint, count, onRemove, removeLabel, defaultOpen = true, actions, children }: GroupProps) {
  const { focus, countUnder } = useForm();
  const depth = useContext(DepthContext);
  const pathKey = keyOf(path);
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  useEffect(() => {
    if (focus && isUnder(focus.key, pathKey) && Date.now() - focus.nonce < FRESH_FOCUS_MS) setOpen(true);
  }, [focus, pathKey]);
  const errors = countUnder(pathKey).errors;
  useEffect(() => {
    if (errors > 0) setOpen(true);
  }, [errors]);
  return (
    <section
      id={fieldId(path)}
      data-path={pathKey}
      className={cn('scroll-mt-40 rounded-lg border transition-[box-shadow] duration-200', depth === 0 ? 'border-line bg-surface' : 'border-line/80 bg-canvas/40', errors > 0 && 'border-danger/40')}>
      <header className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <ChevronRightIcon className={cn('h-4 w-4 shrink-0 text-muted transition-transform duration-150', open && 'rotate-90')} aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink">{title}</span>
            {hint && <span className="block truncate text-[12px] text-muted">{hint}</span>}
          </span>
          {count !== null && count !== undefined && <span className="rounded-full bg-subtle px-1.5 text-xs text-muted">{count}</span>}
          <Counts pathKey={pathKey} />
        </button>
        {actions}
        {onRemove && (
          <button type="button" className={cn(iconButton, 'hover:text-danger')} aria-label={removeLabel ?? `Delete ${title}`} title={removeLabel ?? `Delete ${title}`} onClick={onRemove}>
            <Trash2Icon className="h-4 w-4" aria-hidden />
          </button>
        )}
      </header>
      {open && (
        <div id={bodyId} className="space-y-1 border-t border-line/70 px-3 pb-3 pt-2">
          <Issues pathKey={pathKey} />
          <DepthContext.Provider value={depth + 1}>{children}</DepthContext.Provider>
        </div>
      )}
    </section>
  );
}

// ---- the recursive value editor -------------------------------------------------------------------------------------

interface NodeProps {
  schema: SchemaNode;
  value: unknown;
  path: Path;
  onChange: Change;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
}

export function Node({ schema, value, path, onChange, disabled, id, invalid }: NodeProps) {
  const ctx = useForm();
  const { engine } = ctx;
  const shape = engine.resolveShape(schema, value);
  const kind = engine.kindOf(shape);
  const placeholder = Array.isArray(shape.examples) && shape.examples.length ? String(shape.examples[0]) : undefined;
  const leaf = String(path[path.length - 1]);

  switch (kind) {
    case 'const':
      return <span className="font-mono text-[13px] text-ink-soft">{String(shape.const)}</span>;
    case 'null':
      return <span className="text-[13px] text-muted">None</span>;
    case 'boolean':
      return <Switch id={id} checked={value === true} onChange={(v) => onChange(v)} disabled={disabled} label={describeSetting(leaf, { owner: '' }).label || 'Setting'} />;
    case 'number': {
      const min = shape.minimum ?? (typeof shape.exclusiveMinimum === 'number' ? shape.exclusiveMinimum : undefined);
      const types = Array.isArray(shape.type) ? shape.type : [shape.type];
      return (
        <NumberInput
          id={id}
          value={value}
          onChange={(v) => onChange(v)}
          min={min}
          max={shape.maximum}
          integer={types.includes('integer')}
          nullable={engine.isNullable(shape)}
          disabled={disabled}
          invalid={invalid}
          placeholder={value === undefined ? 'Not set' : undefined}
          unit={readXui(shape).widget === 'duration' ? 'seconds' : undefined}
        />
      );
    }
    case 'enum': {
      // the choices in words (the stored value is unchanged); the schema's default is marked
      const values = (shape.enum ?? []).map(String);
      const labels = enumLabels(leaf, values, { technical: ctx.technical });
      const standard = shape.default !== undefined && shape.default !== null ? String(shape.default) : '';
      if (standard && values.includes(standard)) labels[standard] = `${labels[standard] || standard} (default)`;
      return <Select id={id} value={value} options={values} onChange={(v) => onChange(v)} disabled={disabled} invalid={invalid} labels={labels} />;
    }
    case 'string': {
      const widget = readXui(shape).widget;
      const text = String(value ?? '');
      const multiline = widget === 'textarea' || widget === 'template' || text.includes('\n') || text.length > 90;
      const mono = widget === 'jsonpath' || ['path', 'uri_template', 'body', 'base_url', 'url'].includes(leaf);
      return <TextInput id={id} value={value} onChange={(v) => onChange(v)} placeholder={placeholder} disabled={disabled} multiline={multiline} invalid={invalid} mono={mono} />;
    }
    case 'ref':
      return <RefSelect shape={shape} value={value} onChange={onChange} disabled={disabled} id={id} invalid={invalid} path={path} />;
    case 'secret':
      return <SecretInput id={id} value={value} onChange={(v) => onChange(v)} disabled={disabled} names={ctx.secretNames} />;
    case 'object':
      return <ObjectBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />;
    case 'array':
      return <ArrayBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />;
    case 'map':
      return <MapBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />;
    case 'union':
      return <UnionBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />;
    default:
      return <JsonInput id={id} value={value} onChange={(v) => onChange(v)} disabled={disabled} />;
  }
}

/** What a field points at, by name: an agent by its name, anything else by its id in words. */
function refLabels(name: string, options: string[], config: Json): Record<string, string> {
  const agentsSection = isObj(config.agents) ? config.agents : {};
  const agents = (Array.isArray(agentsSection.items) ? agentsSection.items : []).filter(isObj);
  const words = (id: string) => {
    if (name === 'agents') {
      const agent = agents.find((a) => a.id === id);
      if (typeof agent?.name === 'string' && agent.name.trim()) return agent.name.trim();
    }
    return humanize(id);
  };
  const first = options.map(words);
  return Object.fromEntries(options.map((id, i) => [id, first.indexOf(first[i]) !== first.lastIndexOf(first[i]) ? `${first[i]} (${id})` : first[i]]));
}

function RefSelect({ shape, value, onChange, disabled, id, invalid, path }: { shape: Shape; value: unknown; onChange: Change; disabled?: boolean; id?: string; invalid?: boolean; path: Path }) {
  const { refOptions, goTo, technical, config } = useForm();
  const [creating, setCreating] = useState(false);
  const name = String(shape['x-ref']);
  const options = refOptions[name] || [];
  const labels = technical ? undefined : refLabels(name, options, config);
  const [target, label] = REF_TARGET[name] || [];
  // some things can be made right here: the new one is added and the field points at it
  const spec = !disabled ? CREATABLE[name] : null;
  const newButton = spec && (
    <button type="button" className={linkButton} onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
      <PlusIcon className="h-3.5 w-3.5" aria-hidden />
      New {spec.word}
    </button>
  );
  const form = creating && <InlineCreate collection={name} target={path} defaultKind={path[path.length - 1] === 'count_attempts_in' ? 'integer' : undefined} onClose={() => setCreating(false)} />;
  if (!options.length && !value)
    return (
      <div>
        <p className="text-[13px] text-muted">
          There are no {REF_WORD[name] || name} yet.{' '}
          {newButton ||
            (target && (
              <>
                Add one in{' '}
                <button type="button" className="font-medium text-accent hover:underline" onClick={() => goTo([target])}>
                  {label}
                </button>{' '}
                first.
              </>
            ))}
        </p>
        {form}
      </div>
    );
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[200px] flex-1">
          <Select id={id} value={value} options={options} labels={labels} onChange={(v) => onChange(v || undefined)} disabled={disabled} invalid={invalid} placeholder={`Choose from the ${REF_WORD[name] || name}…`} />
        </div>
        {newButton}
      </div>
      {form}
    </div>
  );
}

// ---- objects --------------------------------------------------------------------------------------------------------

interface ObjectBodyProps {
  shape: Shape;
  value: unknown;
  path: Path;
  onChange: Change;
  disabled?: boolean;
  /** Just these properties (a screen that is part of a section). */
  onlyKeys?: string[];
  /** Draw keys the schema doesn't name (false when another screen of the same section draws them). */
  showUnknown?: boolean;
}

export function ObjectBody({ shape, value, path, onChange, disabled, onlyKeys, showUnknown = true }: ObjectBodyProps) {
  const { engine, markDelete, issuesUnder, expertHome, hidden } = useForm();
  const owner = useOwner();
  const ownId = useId();
  const obj: Json = isObj(value) ? value : {};
  const order = Object.keys(shape.properties);
  const flatOf = (k: string) => engine.flatten(shape.properties[k]);
  const visible = order.filter((k) => flatOf(k).const === undefined && (!onlyKeys || onlyKeys.includes(k)) && !hidden.has([...path, k].join('.')));
  const required = shape.required || [];
  // Expert settings sit under "Advanced" (the server's hints, else the catalogue's level), unless the screen is for them.
  const wordsOf = (k: string) => describeSetting(k, { owner, description: flatOf(k).description });
  const hintsOf = (k: string) => {
    const h = readXui(flatOf(k));
    return { ...h, advanced: h.advanced || (!expertHome && (h.audience || wordsOf(k).level) === 'expert') };
  };
  // Every setting is on the screen, unset ones too, showing the default the agent uses. A deprecated one only while set.
  const unsetShown = (k: string) => !(k in obj) && !required.includes(k) && !flatOf(k).deprecated;
  const rows = orderKeys(
    visible.filter((k) => k in obj || required.includes(k) || unsetShown(k)),
    hintsOf,
  );
  const { main, advanced } = splitAdvanced(rows, hintsOf);
  const sections = groupKeys(main, hintsOf);
  const unknown = showUnknown ? Object.keys(obj).filter((k) => !(k in shape.properties)) : [];
  const extra = isObj(shape.additionalProperties) ? shape.additionalProperties : null;
  const openExtra = shape.additionalProperties === undefined && shape.unevaluatedProperties === undefined;

  const setProp = (key: string, v: unknown) => onChange(v === undefined ? omit(obj, key) : orderedSet(obj, key, v, order));
  // Deleting a row takes out what it shows; parts asked for elsewhere on the page stay.
  const keptOf = (key: string) => hiddenParts(obj[key], [...path, key].join('.'), hidden);
  const onlyHidden = (key: string) => {
    const kept = keptOf(key);
    return kept !== undefined && JSON.stringify(kept) === JSON.stringify(obj[key]);
  };
  const del = (key: string, label?: string) => {
    markDelete(label || wordsOf(key).label);
    setProp(key, keptOf(key));
  };
  const renderRow = (key: string) => (
    <FieldRow
      key={key}
      name={key}
      schema={shape.properties[key]}
      value={obj[key]}
      path={[...path, key]}
      required={required.includes(key)}
      missing={!(key in obj) && required.includes(key)}
      unset={unsetShown(key)}
      disabled={disabled}
      sole={rows.length === 1}
      onChange={(v) => setProp(key, v)}
      onAdd={() => setProp(key, engine.defaultFor(shape.properties[key]))}
      onRemove={!required.includes(key) && !onlyHidden(key) ? () => del(key) : null}
    />
  );

  return (
    <div className="space-y-1">
      {sections.map((section) => (
        <div key={section.group || '_'} className="divide-y divide-line/60">
          {section.group && <h5 className="pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">{section.group}</h5>}
          {section.keys.map(renderRow)}
        </div>
      ))}
      {advanced.length > 0 && (
        <details className="group rounded-lg border border-line/70 px-3 py-1" open={advanced.some((key) => issuesUnder(keyOf([...path, key])).length > 0) || undefined}>
          <summary className="cursor-pointer select-none py-1.5 text-[13px] font-medium text-ink-soft hover:text-ink">
            Advanced settings <span className="ml-1 rounded-full bg-subtle px-1.5 text-xs text-muted">{advanced.length}</span>
          </summary>
          <div className="divide-y divide-line/60">{advanced.map(renderRow)}</div>
        </details>
      )}
      {unknown.map((key) =>
        extra ? (
          <FieldRow key={key} name={key} label={key} schema={extra} value={obj[key]} path={[...path, key]} disabled={disabled} onChange={(v) => setProp(key, v)} onRemove={() => del(key, `“${key}”`)} />
        ) : (
          <div key={key} id={fieldId([...path, key])} data-path={keyOf([...path, key])} className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`${ownId}-${key}`} className="font-mono text-[13px] text-ink">
                {key}
              </label>
              <span className={cn('rounded px-1.5 text-[11px] font-medium', openExtra ? 'bg-subtle text-muted' : 'bg-danger-soft text-danger')}>{openExtra ? 'Your own setting' : 'Not a setting the server knows'}</span>
              <button type="button" className={cn(iconButton, 'hover:text-danger')} aria-label={`Delete ${key}`} disabled={disabled} onClick={() => del(key, `“${key}”`)}>
                <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <div className="mt-1.5">
              <FreeValue id={`${ownId}-${key}`} value={obj[key]} onChange={(v) => setProp(key, v)} disabled={disabled} />
            </div>
            <Issues pathKey={keyOf([...path, key])} />
          </div>
        ),
      )}
      {(extra || openExtra) && <AddKey existing={Object.keys(obj)} disabled={disabled} label="setting of your own" onAdd={(k) => setProp(k, extra ? engine.defaultFor(extra) : '')} />}
      {rows.length === 0 && unknown.length === 0 && !extra && !openExtra && <p className="py-2 text-[13px] text-muted">Nothing to set here.</p>}
    </div>
  );
}

// ---- one labelled property of an object -----------------------------------------------------------------------------

interface FieldRowProps {
  name: string;
  schema: SchemaNode;
  value: unknown;
  path: Path;
  required?: boolean;
  missing?: boolean;
  unset?: boolean;
  disabled?: boolean;
  sole?: boolean;
  label?: string;
  onChange: Change;
  onAdd?: () => void;
  onRemove?: (() => void) | null;
}

/**
 * One setting. An optional one not in the config is drawn like any other with its default and "Default" beside its
 * name; the first real change sets it. A required one that is missing says so.
 */
export function FieldRow({ name, schema, value: given, path, required, missing: missingGiven, unset: unsetOptional = false, disabled, sole, label, onChange: change, onAdd, onRemove: remove }: FieldRowProps) {
  const ctx = useForm();
  const { engine } = ctx;
  const unset = unsetOptional || !!missingGiven;
  const missing = !!missingGiven && !!required;
  const key = keyOf(path);
  const inputId = `${fieldId(path)}-input`;
  const declared = engine.resolveShape(schema, given);
  const kindUnset = engine.kindOf(declared);
  const styleUnset = kindUnset === 'array' ? arrayStyle(engine, declared) : null;
  const groupedUnset = kindUnset === 'object' || kindUnset === 'map' || (kindUnset === 'array' && styleUnset === 'cards');
  // what an unset setting shows: its default (a group shows the defaults of its parts); a yes/no with none is "no"
  const shownDefault = !unset
    ? given
    : groupedUnset
      ? engine.defaultFor(schema)
      : declared.default !== undefined
        ? declared.default
        : kindUnset === 'boolean'
          ? false
          : kindUnset === 'array'
            ? []
            : undefined;
  // an emptied text box showing its default stays empty while focused, and shows the default again when left
  const [emptied, setEmptied] = useState(false);
  const value = unset && emptied && kindUnset === 'string' ? '' : shownDefault;
  // an unset setting is set by a real change only: clearing an empty box leaves it unset
  const onChange: Change =
    unset && kindUnset !== 'union'
      ? (v, meta) => {
          if (v === '' || v === undefined || v === null) {
            if (v === '' && kindUnset === 'string') setEmptied(true);
            return;
          }
          setEmptied(false);
          change(v, meta);
        }
      : change;
  const onRemove = unset ? null : remove;
  const shape = unset ? engine.resolveShape(schema, value) : declared;
  const kind = engine.kindOf(shape);
  const readOnly = ctx.readOnly.has(path.join('.'));
  const words = useSettingWords(name, shape, label);
  const hasDefault = declared.default !== undefined;
  const technical = ctx.technical;
  const lockedIn = name === 'id' && !missing && typeof value === 'string' && value ? lockedIdCollection(path) : null;
  if (lockedIn)
    return (
      <div id={fieldId(path)} data-path={key} className="scroll-mt-40 py-3">
        <IdChip id={String(value)} disabled={disabled} onRename={() => ctx.requestRename(lockedIn, String(value))} />
        {technical && (
          <div className="mt-1">
            <TechName path={path} onOpenJson={ctx.openInJson} />
          </div>
        )}
        <Issues pathKey={key} />
      </div>
    );
  const tech = technical ? <TechName path={path} onOpenJson={ctx.openInJson} /> : null;
  const tags = (
    <>
      {required && (
        <abbr title="Required" className="text-danger no-underline">
          *
        </abbr>
      )}
      {shape.deprecated && <span className="rounded bg-warning-soft px-1.5 text-[11px] font-medium text-warning">Old setting</span>}
      {readOnly && <span className="rounded bg-subtle px-1.5 text-[11px] font-medium text-muted">Set by the server</span>}
      {missing && <span className="rounded bg-danger-soft px-1.5 text-[11px] font-medium text-danger">Needed, not set</span>}
      {unsetOptional && hasDefault && <span className="rounded bg-subtle px-1.5 text-[11px] font-medium text-muted">Default</span>}
    </>
  );

  // a kind with no plain control (raw JSON, a fixed value): one button sets it
  if (unset && ['json', 'const', 'null'].includes(kind)) {
    return (
      <div id={fieldId(path)} data-path={key} className="scroll-mt-40 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">{words.title}</span>
          {tags}
          {!required && <span className="text-[12px] text-muted">Not set</span>}
        </div>
        <Help lead={words.lead} example={words.example} full={words.full} technical={technical} />
        {tech}
        <button type="button" className={cn(linkButton, 'mt-1')} disabled={disabled} onClick={onAdd}>
          <PlusIcon className="h-3.5 w-3.5" aria-hidden />
          Set {words.title.toLowerCase()}
        </button>
        <Issues pathKey={key} />
      </div>
    );
  }

  const style = kind === 'array' ? arrayStyle(engine, shape) : null;
  const grouped = kind === 'object' || kind === 'map' || (kind === 'array' && style === 'cards');
  if (grouped) {
    const count = kind === 'array' ? (Array.isArray(value) ? value.length : 0) : kind === 'map' ? Object.keys(isObj(value) ? value : {}).length : null;
    // the only setting of a screen: its parts are the screen, with no box around them
    if (sole && !onRemove && kind !== 'array' && path.length <= 2)
      return (
        <div id={fieldId(path)} data-path={key} className="scroll-mt-40 py-2">
          {tech}
          <OwnerContext.Provider value={name}>
            <Node schema={schema} value={value} path={path} onChange={onChange} disabled={disabled || readOnly} />
          </OwnerContext.Provider>
        </div>
      );
    return (
      <div className="py-2">
        <Group
          path={path}
          title={words.title}
          hint={missing ? 'Needed: not set yet' : unset ? 'Using the defaults' : words.lead}
          count={unset ? null : count}
          onRemove={onRemove && !disabled ? onRemove : null}
          removeLabel={`Take out ${words.title}`}
          defaultOpen={missing ? true : unset && !sole ? false : kind === 'array' ? Array.isArray(value) && value.length <= 4 : !!sole || words.level === 'guided'}>
          {(unset || missing) && <Help lead={words.lead} example={words.example} full={words.full} technical={technical} />}
          {tech}
          <OwnerContext.Provider value={name}>
            <Node schema={schema} value={value} path={path} onChange={onChange} disabled={disabled || readOnly} />
          </OwnerContext.Provider>
        </Group>
      </div>
    );
  }

  // a single control takes the label; a list, a choice of kinds or a fixed value is a group named by it
  const takesId = !['const', 'null', 'object', 'array', 'map', 'union'].includes(kind);
  const labelId = `${inputId}-label`;
  const invalid = (ctx.exact.get(key) || []).some((i) => i.severity === 'error');
  const toggle = kind === 'boolean';
  return (
    <div id={fieldId(path)} data-path={key} className="scroll-mt-40 rounded-md py-3 transition-[box-shadow] duration-200">
      <div className={cn('flex gap-4', toggle ? 'items-start justify-between' : 'flex-col gap-0')}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <label htmlFor={takesId ? inputId : undefined} id={labelId} className="text-sm font-medium text-ink">
              {words.title}
            </label>
            {tags}
            {onRemove && !readOnly && !disabled && (
              <button
                type="button"
                onClick={onRemove}
                aria-label={hasDefault ? `Reset ${words.title} to its default` : `Clear ${words.title}`}
                title={hasDefault ? 'Back to the default' : 'Take this setting out'}
                className="inline-flex items-center gap-1 rounded px-1 text-[12px] font-medium text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <RotateCcwIcon className="h-3 w-3" aria-hidden />
                {hasDefault ? 'Reset' : 'Clear'}
              </button>
            )}
          </div>
          <Help lead={words.lead} example={words.example} full={words.full} technical={technical} />
          {tech && <div className="mt-1">{tech}</div>}
        </div>
        <div className={cn(toggle ? 'shrink-0 pt-0.5' : 'mt-1.5')} role={takesId ? undefined : 'group'} aria-labelledby={takesId ? undefined : labelId} onBlur={emptied ? () => setEmptied(false) : undefined}>
          <OwnerContext.Provider value={name}>
            <Node schema={schema} value={value} path={path} onChange={onChange} disabled={disabled || readOnly} id={inputId} invalid={invalid} />
          </OwnerContext.Provider>
        </div>
      </div>
      <Issues pathKey={key} deep={kind === 'array' || kind === 'json'} />
      <FieldNote path={path} value={value} />
    </div>
  );
}

/** A note under a field that needs more than its description says. */
function FieldNote({ path, value }: { path: Path; value: unknown }) {
  if (path[0] !== 'state' || path[path.length - 1] !== 'sensitive') return null;
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-muted">
      <ShieldIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      {value
        ? 'Meant to be kept out of prompts, spoken lines and logs. The runtime does not enforce this yet, so don’t rely on it for real PINs or card numbers.'
        : 'Turn this on for a PIN, one-time code or card number. It is then meant to be kept out of prompts and logs (the runtime doesn’t enforce that yet).'}
    </p>
  );
}

// ---- unions (a choice of kinds) -------------------------------------------------------------------------------------

const isCheckPath = (path: Path) => path.length === 3 && path[0] === 'guardrails' && (path[1] === 'input' || path[1] === 'output') && typeof path[2] === 'number';

function UnionBody({ shape, value, path, onChange, disabled }: { shape: Shape; value: unknown; path: Path; onChange: Change; disabled?: boolean }) {
  const { engine, technical } = useForm();
  const branches = useMemo(() => engine.branchesOf(shape), [engine, shape]);
  const picked = engine.pickBranch(branches, value);
  // the kind is clear when the value fits it, or carries its marker with some required fields still missing
  const fitsBranch = value !== undefined && (engine.fits(branches[picked], value) || matchesDiscriminator(engine, branches[picked], value));
  const labels = branches.map((b, i) => {
    const type = engine.flatten(b).properties.type;
    const kind = isObj(type) ? type.const : undefined;
    return isCheckPath(path) && !technical && typeof kind === 'string' && PLAIN_KIND[kind] ? PLAIN_KIND[kind] : engine.branchLabel(b, i);
  });
  const segmented = branches.length <= 4 && labels.join('').length <= 48;
  const choose = (index: number) => {
    if (index !== picked || !fitsBranch) onChange(carryOver(engine, value, branches[index], engine.defaultFor(branches[index])));
  };
  if (value === undefined && branches.length === 1) return <Node schema={branches[0]} value={engine.defaultFor(branches[0])} path={path} onChange={onChange} disabled={disabled} />;
  const chooser =
    branches.length > 1 &&
    (segmented ? (
      <div role="group" aria-label="Kind" className="inline-flex flex-wrap rounded-lg border border-line bg-subtle p-0.5">
        {labels.map((text, i) => {
          const on = fitsBranch && i === picked;
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => choose(i)}
              className={cn('whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40', on ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>
              {text}
            </button>
          );
        })}
      </div>
    ) : (
      <select
        aria-label="Kind"
        disabled={disabled}
        value={fitsBranch ? String(picked) : ''}
        onChange={(e) => e.target.value !== '' && choose(Number(e.target.value))}
        className="rounded-md border border-line-strong bg-surface px-2 py-1 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/20">
        <option value="">{value === undefined ? 'Choose…' : 'Choose a kind…'}</option>
        {labels.map((text, i) => (
          <option key={i} value={i}>
            {text}
          </option>
        ))}
      </select>
    ));
  if (value === undefined) return <div>{chooser}</div>;
  return (
    <div className="space-y-2">
      {chooser}
      {fitsBranch ? (
        <Node schema={branches[picked]} value={value} path={path} onChange={onChange} disabled={disabled} />
      ) : (
        <div>
          <p className="mb-1 text-[13px] text-warning">This value doesn’t match any kind the server knows. Pick a kind above to start again, or edit it as JSON.</p>
          <JsonInput value={value} onChange={(v) => onChange(v)} disabled={disabled} />
        </div>
      )}
    </div>
  );
}

// ---- lists ----------------------------------------------------------------------------------------------------------

function ArrayBody({ shape, value, path, onChange, disabled }: { shape: Shape; value: unknown; path: Path; onChange: Change; disabled?: boolean }) {
  const { engine, refOptions, goTo, markDelete, technical, config } = useForm();
  const list = Array.isArray(value) ? value : [];
  const style = arrayStyle(engine, shape);
  const items = engine.flatten(shape.items);
  const leaf = String(path[path.length - 1]);
  const label = describeSetting(leaf, { owner: '' }).label;
  // the deleted entry is named, so the Undo bar can say it
  const changed = (next: unknown, meta?: { deleted?: string }) => {
    if (meta?.deleted) markDelete(meta.deleted);
    onChange(next);
  };
  if (style === 'strings')
    return <StringList values={list.map((v) => String(v ?? ''))} onChange={changed} disabled={disabled} label={label} placeholder={Array.isArray(items.examples) ? String(items.examples[0]) : undefined} />;
  if (style === 'checks') {
    const options = (items.enum ?? []).map(String);
    return <CheckGroup options={options} values={list} onChange={changed} disabled={disabled} labels={enumLabels(leaf, options, { technical })} />;
  }
  if (style === 'pick') {
    const name = String(items['x-ref']);
    const options = refOptions[name] || [];
    const [target, where] = REF_TARGET[name] || [];
    return (
      <div>
        <MultiPick options={options} values={list.map(String)} onChange={changed} disabled={disabled} emptyText={`No ${REF_WORD[name] || name} chosen`} labels={technical ? undefined : refLabels(name, options, config)} label={label} />
        {options.length === 0 && list.length === 0 && target && (
          <p className="mt-1 text-[13px] text-muted">
            There are no {REF_WORD[name] || name} yet. Add some in{' '}
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => goTo([target])}>
              {where}
            </button>{' '}
            first.
          </p>
        )}
      </div>
    );
  }
  return <CardList shape={shape} list={list} path={path} onChange={onChange} disabled={disabled} />;
}

function CardList({ shape, list, path, onChange, disabled }: { shape: Shape; list: unknown[]; path: Path; onChange: Change; disabled?: boolean }) {
  const { engine, markDelete, requestDelete } = useForm();
  const collection = collectionAt(path);
  const named = collection && COLLECTIONS[collection].kind === 'list' ? collection : null;
  const [fresh, setFresh] = useState(-1);
  const items = engine.flatten(shape.items);
  const isUnion = engine.kindOf(items) === 'union';
  const branches = isUnion ? engine.branchesOf(items) : [];
  const lastKey = String(path[path.length - 1]);
  const base = singular(lastKey === 'items' ? path[path.length - 2] : lastKey);
  const word = ADD_WORDS[lastKey] || base.replace(/_/g, ' ');
  const takenIds = list.filter(isObj).map((item) => item.id).filter((id): id is string => typeof id === 'string');
  const make = (branch?: SchemaNode) => {
    const made = engine.defaultFor(branch ?? shape.items);
    if (isObj(made) && 'id' in made && made.id === '') made.id = uniqueId(takenIds, base);
    return made;
  };
  const add = (branch?: SchemaNode) => {
    onChange([...list, make(branch)]);
    setFresh(list.length);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length) return;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };
  const removeItem = (index: number) => {
    const item = list[index];
    const { title } = summarize(item, index);
    const remove = () => {
      markDelete(title);
      onChange(list.filter((_, i) => i !== index));
    };
    if (named && isObj(item) && typeof item.id === 'string') requestDelete(named, item.id, remove);
    else remove();
  };
  const roomy = cardsThatMayOpen(list);
  return (
    <div className="space-y-2">
      {list.map((item, index) => {
        const { title, hint } = summarize(item, index);
        const itemPath = [...path, index];
        return (
          <Group
            key={`${index}-${isObj(item) && typeof item.id === 'string' ? item.id : ''}`}
            path={itemPath}
            title={title}
            hint={hint}
            defaultOpen={index === fresh || (roomy[index] && (path.length > 1 ? index === 0 && list.length <= 3 : list.length <= 3))}
            onRemove={disabled ? null : () => removeItem(index)}
            removeLabel={`Delete ${title}`}
            actions={
              !disabled && list.length > 1 ? (
                <>
                  <button type="button" className={iconButton} aria-label={`Move ${title} up`} disabled={index === 0} onClick={() => move(index, index - 1)}>
                    <ArrowUpIcon className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button type="button" className={iconButton} aria-label={`Move ${title} down`} disabled={index === list.length - 1} onClick={() => move(index, index + 1)}>
                    <ArrowDownIcon className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </>
              ) : null
            }>
            <Node schema={shape.items} value={item} path={itemPath} onChange={(v) => onChange(list.map((x, i) => (i === index ? v : x)))} disabled={disabled} />
          </Group>
        );
      })}
      {list.length === 0 && <p className="text-[13px] text-muted">None yet.</p>}
      {!disabled &&
        (isUnion ? (
          <select
            aria-label={`Add ${word}`}
            value=""
            onChange={(e) => e.target.value !== '' && add(branches[Number(e.target.value)])}
            className="rounded-md border border-dashed border-line-strong bg-surface px-2 py-1.5 text-[13px] font-medium text-accent focus:outline-none focus:ring-2 focus:ring-accent/20">
            <option value="">Add {word}…</option>
            {branches.map((b, i) => (
              <option key={i} value={i}>
                {engine.branchLabel(b, i)}
              </option>
            ))}
          </select>
        ) : (
          <button type="button" className={linkButton} onClick={() => add()}>
            <PlusIcon className="h-3.5 w-3.5" aria-hidden />
            Add {word}
          </button>
        ))}
    </div>
  );
}

// ---- maps (entries named by the author) -----------------------------------------------------------------------------

function AddKey({ existing, onAdd, pattern, options, disabled, label = 'entry' }: { existing: string[]; onAdd: (key: string) => void; pattern?: string; options?: string[] | null; disabled?: boolean; label?: string }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  if (disabled) return null;
  const taken = new Set(existing);
  const commit = (raw: string) => {
    const key = raw.trim();
    if (!key) return;
    if (taken.has(key)) {
      setError(`“${key}” already exists.`);
      return;
    }
    if (pattern && !new RegExp(pattern).test(key)) {
      setError('Use lowercase letters, digits and _, starting with a letter.');
      return;
    }
    setError('');
    setText('');
    onAdd(key);
  };
  if (options) {
    const left = options.filter((o) => !taken.has(o));
    return (
      <select
        aria-label={`Add ${label}`}
        value=""
        disabled={left.length === 0}
        onChange={(e) => e.target.value && onAdd(e.target.value)}
        className="rounded-md border border-dashed border-line-strong bg-surface px-2 py-1.5 text-[13px] font-medium text-accent focus:outline-none focus:ring-2 focus:ring-accent/20">
        <option value="">{left.length ? `Add ${label}…` : `Nothing more to add`}</option>
        {left.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div className="pt-1">
      <div className="flex items-center gap-2">
        <input
          type="text"
          spellCheck={false}
          value={text}
          placeholder={`Name of the new ${label}`}
          aria-label={`Name of the new ${label}`}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(text);
            }
          }}
          className="w-56 rounded-md border border-line-strong bg-surface px-2 py-1 font-mono text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <button type="button" className={linkButton} disabled={!text.trim()} onClick={() => commit(text)}>
          <PlusIcon className="h-3.5 w-3.5" aria-hidden />
          Add
        </button>
      </div>
      {error && <p className="mt-1 text-[13px] text-danger">{error}</p>}
    </div>
  );
}

/** A key that is renamed when you leave the box, so typing doesn't re-key the object on every letter. */
function KeyInput({ value, taken, pattern, onRename, disabled }: { value: string; taken: string[]; pattern?: string; onRename: (to: string) => void; disabled?: boolean }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState('');
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const key = text.trim();
    if (key === value) {
      setError('');
      return;
    }
    if (!key) {
      setText(value);
      return;
    }
    if (taken.includes(key)) {
      setError(`“${key}” already exists.`);
      return;
    }
    if (pattern && !new RegExp(pattern).test(key)) {
      setError('Use lowercase letters, digits and _, starting with a letter.');
      return;
    }
    setError('');
    onRename(key);
  };
  return (
    <div>
      <input
        type="text"
        spellCheck={false}
        value={text}
        disabled={disabled}
        aria-label={`Name of “${value}”`}
        aria-invalid={!!error || undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 font-mono text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-subtle"
      />
      {error && <p className="mt-1 text-[13px] text-danger">{error}</p>}
    </div>
  );
}

function MapBody({ shape, value, path, onChange, disabled }: { shape: Shape; value: unknown; path: Path; onChange: Change; disabled?: boolean }) {
  const { engine, refOptions, markDelete, requestDelete, renameDirect } = useForm();
  const mapId = useId();
  const collectionName = collectionAt(path);
  const named = collectionName && COLLECTIONS[collectionName].kind === 'map' ? collectionName : null;
  const obj: Json = isObj(value) ? value : {};
  const keys = Object.keys(obj);
  const valueSchema = isObj(shape.additionalProperties) ? shape.additionalProperties : null;
  const names = engine.deref(shape.propertyNames || {});
  const refName = typeof names['x-ref'] === 'string' ? names['x-ref'] : null;
  const pattern = typeof names.pattern === 'string' ? names.pattern : undefined;
  const complex = !!valueSchema && isComplex(engine, valueSchema);

  const rename = (from: string, to: string) => {
    if (named) {
      renameDirect(named, from, to);
      return;
    }
    const out: Json = {};
    Object.keys(obj).forEach((k) => {
      out[k === from ? to : k] = obj[k];
    });
    onChange(out);
  };
  const setEntry = (k: string, v: unknown) => onChange({ ...obj, [k]: v });
  const removeEntry = (k: string) => {
    const remove = () => {
      markDelete(`“${k}”`);
      onChange(omit(obj, k));
    };
    if (named) requestDelete(named, k, remove);
    else remove();
  };
  const add = (key: string) => onChange({ ...obj, [key]: valueSchema ? engine.defaultFor(valueSchema) : '' });
  const leaf = String(path[path.length - 1]);
  const word = ADD_WORDS[leaf] || singular(leaf).replace(/_/g, ' ');
  const madeKey = refName ? null : uniqueId(keys, word);
  const autoKey = madeKey && (!pattern || new RegExp(pattern).test(madeKey)) ? madeKey : null;

  return (
    <div className="space-y-2">
      {keys.map((key, i) => {
        const entryPath = [...path, key];
        const valueId = `${mapId}-${i}`;
        const control = valueSchema ? (
          <Node schema={valueSchema} value={obj[key]} path={entryPath} onChange={(v) => setEntry(key, v)} disabled={disabled} id={valueId} />
        ) : (
          <FreeValue id={valueId} value={obj[key]} onChange={(v) => setEntry(key, v)} disabled={disabled} label={`Value of “${key}”`} />
        );
        if (complex) {
          const sensitive = named === 'state_vars' && isObj(obj[key]) && (obj[key] as Json).sensitive === true;
          return (
            <Group key={key} path={entryPath} title={key} hint={sensitive ? 'Sensitive' : undefined} defaultOpen={keys.length <= 3} onRemove={disabled ? null : () => removeEntry(key)} removeLabel={`Delete ${key}`}>
              {!refName && (
                <div className="py-2">
                  <span className="text-sm font-medium text-ink">Name</span>
                  <div className="mt-1 max-w-sm">
                    <KeyInput value={key} taken={keys.filter((k) => k !== key)} pattern={pattern} onRename={(to) => rename(key, to)} disabled={disabled} />
                  </div>
                </div>
              )}
              {control}
            </Group>
          );
        }
        return (
          <div key={key} id={fieldId(entryPath)} data-path={keyOf(entryPath)} className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] items-start gap-2">
            {refName ? <code className="pt-2 font-mono text-[13px] text-ink">{key}</code> : <KeyInput value={key} taken={keys.filter((k) => k !== key)} pattern={pattern} onRename={(to) => rename(key, to)} disabled={disabled} />}
            <div className="min-w-0">
              <label htmlFor={valueId} className="sr-only">
                Value of “{key}”
              </label>
              {control}
              <Issues pathKey={keyOf(entryPath)} deep />
            </div>
            <button type="button" className={cn(iconButton, 'mt-1 hover:text-danger')} aria-label={`Delete ${key}`} disabled={disabled} onClick={() => removeEntry(key)}>
              <XIcon className="h-4 w-4" aria-hidden />
            </button>
          </div>
        );
      })}
      {keys.length === 0 && <p className="text-[13px] text-muted">None yet.</p>}
      {!disabled &&
        (autoKey ? (
          <button type="button" className={linkButton} onClick={() => add(autoKey)}>
            <PlusIcon className="h-3.5 w-3.5" aria-hidden />
            Add {word}
          </button>
        ) : (
          <AddKey existing={keys} pattern={pattern} options={refName ? refOptions[refName] || [] : null} disabled={disabled} label={refName ? (REF_WORD[refName] || 'entry').replace(/s$/, '') : word} onAdd={add} />
        ))}
    </div>
  );
}
