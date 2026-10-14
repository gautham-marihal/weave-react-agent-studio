import React, { useEffect, useId, useMemo, useState } from 'react';
import { humanize, isObj } from './engine.js';
import { isUnder, keyOf, omit, orderedSet, singular, uniqueId, useForm } from './ctx.js';
import { CheckGroup, FreeValue, JsonInput, MultiPick, NumberInput, Select, StringList, Switch, TextInput } from './fields.jsx';
import ChannelBody from './ChannelBody.jsx';
import ConditionBuilder from './ConditionBuilder.jsx';
import MessageText from './MessageText.jsx';
import TemplateField from './TemplateField.jsx';
import { PathInput } from './RequestResponse.jsx';
import InlineCreate from './InlineCreate.jsx';
import ToolBody from './ToolBody.jsx';
import PromptPreview from './PromptPreview.jsx';
import { CREATABLE } from './inlineCreate.js';
import { UNSUPPORTED_BUILTINS, UNSUPPORTED_KINDS, unusedTools } from './toolInfo.js';
import { IdChip } from './IdTools.jsx';
import { CHANNEL_PRESETS, buildChannel } from './presets.js';
import { collectionAt, COLLECTIONS, lockedIdCollection } from './references.js';
import { arrayStyle, carryOver, isActionList, isComplex, isRuleList, matchesDiscriminator, summarize } from './cardLogic.js';
import EffectsEditor, { ActionSteps } from './EffectsEditor.jsx';
import { isPromptPath, isTemplateString, scopeAt } from './templates.js';
import { languageHint } from './messages.js';
import { groupKeys, looksLikePhone, looksLikeUrl, orderKeys, readXui, splitAdvanced } from './xui.js';

// What "this collection lives in" for the hint under an empty reference list, and where Go there leads.
const REF_TARGET = {
  agents: ['agents', 'Agents'], tools: ['tools', 'Tools'], tool_names: ['tools', 'Tools'], tasks: ['tasks', 'Tasks'], knowledge: ['knowledge', 'Knowledge'],
  forms: ['forms', 'Forms'], wrapups: ['wrapups', 'Wrap-ups'], messages: ['messages', 'Messages'], notifications: ['notifications', 'Notifications'],
  channels: ['channels', 'Channels'], transfers: ['telephony', 'Telephony'], schedules: ['schedules', 'Schedules'], state_vars: ['state', 'State'],
  http_connections: ['connections', 'Connections'], mcp_connections: ['connections', 'Connections'], notifiers: ['connections', 'Connections'],
};
const REF_WORD = {
  agents: 'agents', tools: 'tools', tool_names: 'tools', tasks: 'tasks', knowledge: 'knowledge bases', forms: 'forms', wrapups: 'wrap-ups', messages: 'messages',
  notifications: 'notifications', channels: 'channels', transfers: 'transfers', schedules: 'schedules', state_vars: 'state variables',
  http_connections: 'HTTP connections', mcp_connections: 'MCP connections', notifiers: 'SMS/email connections',
};

function Help({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > 170;
  return (
    <p className="stFHelp">
      {long && !open ? `${text.slice(0, 170)}… ` : `${text} `}
      {long && <button type="button" className="stLink" onClick={() => setOpen((v) => !v)}>{open ? 'Less' : 'More'}</button>}
    </p>
  );
}

function Issues({ pathKey, deep = false }) {
  const { exact, issuesUnder } = useForm();
  const list = deep ? issuesUnder(pathKey) : exact.get(pathKey);
  if (!list?.length) return null;
  return list.map((issue, index) => <small key={index} className={issue.severity === 'error' ? 'stFErr' : 'stFWarn'}>{issue.message}</small>);
}

function Group({ pathKey, title, hint, count, onRemove, defaultOpen = true, actions, children, flat = false }) {
  const { focus, countUnder } = useForm();
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { if (focus && isUnder(focus.key, pathKey)) setOpen(true); }, [focus, pathKey]);
  const c = countUnder(pathKey);
  return (
    <section className={`stFGroup ${c.errors ? 'hasErr' : ''} ${flat ? 'flat' : ''}`} data-path={pathKey}>
      <header>
        <button type="button" className="stFGroupToggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <i aria-hidden="true">{open ? '▾' : '▸'}</i>
          <strong>{title}</strong>
          {hint && <span className="stFHint">{hint}</span>}
          {count != null && <em>{count}</em>}
          {c.errors > 0 && <b className="stFDot err" title={`${c.errors} error${c.errors === 1 ? '' : 's'} inside`}>{c.errors}</b>}
          {c.errors === 0 && c.warnings > 0 && <b className="stFDot warn" title={`${c.warnings} warning${c.warnings === 1 ? '' : 's'} inside`}>{c.warnings}</b>}
        </button>
        <div className="stFGroupActions">
          {actions}
          {onRemove && <button type="button" className="stFDel" aria-label={`Delete ${title}`} onClick={onRemove}>Delete</button>}
        </div>
      </header>
      {open && <div className="stFGroupBody"><Issues pathKey={pathKey} />{children}</div>}
    </section>
  );
}

// ---- the recursive value editor --------------------------------------------------------------

const isChannelPath = (path) => path.length === 2 && path[0] === 'channels' && typeof path[1] === 'number';
const isToolPath = (path) => path.length === 2 && path[0] === 'tools' && typeof path[1] === 'number';
const isAgentPath = (path) => path.length === 3 && path[0] === 'agents' && path[1] === 'items' && typeof path[2] === 'number';

export default function Node({ schema, value, path, onChange, disabled, id, invalid }) {
  const ctx = useForm();
  const { engine } = ctx;
  const shape = engine.resolveShape(schema, value);
  const kind = engine.kindOf(shape);
  const placeholder = Array.isArray(shape.examples) ? String(shape.examples[0]) : undefined;

  switch (kind) {
    case 'const': return <span className="stFConst">{String(shape.const)}</span>;
    case 'null': return <span className="stFConst">none</span>;
    case 'boolean': return <Switch checked={!!value} onChange={onChange} disabled={disabled} label={shape.title || 'Setting'} />;
    case 'number': {
      const input = <NumberInput id={id} value={value} onChange={onChange} min={shape.minimum ?? (shape.exclusiveMinimum !== undefined ? shape.exclusiveMinimum : undefined)} max={shape.maximum}
        integer={([].concat(shape.type)).includes('integer')} nullable={engine.isNullable(shape)} disabled={disabled} invalid={invalid} />;
      return readXui(shape).widget === 'duration' ? <span className="stFUnit">{input}<span className="stMuted">seconds</span></span> : input;
    }
    case 'enum': return <Select id={id} value={value} options={shape.enum.map(String)} onChange={onChange} disabled={disabled} invalid={invalid}
      labels={path[0] === 'tools' && path[path.length - 1] === 'builtin' ? Object.fromEntries(Object.keys(UNSUPPORTED_BUILTINS).map((name) => [name, `${name} (not available yet)`])) : undefined} />;
    case 'string': {
      const widget = readXui(shape).widget;
      const multiline = widget === 'textarea' || String(value ?? '').includes('\n') || String(value ?? '').length > 90;
      if (widget === 'jsonpath') return <PathInput value={value} onChange={onChange} disabled={disabled} label={humanize(String(path[path.length - 1]))} />;
      if (widget === 'phone' || widget === 'url') return <ContactInput kind={widget} id={id} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} invalid={invalid} />;
      if (isTemplateString(path, shape, value)) {
        const prompt = isPromptPath(path);
        return <TemplateField id={id} value={value} onChange={onChange} scope={scopeAt(ctx.config, path)} multiline={multiline} placeholder={placeholder} disabled={disabled} invalid={invalid}
          mono={['path', 'uri_template', 'body'].includes(String(path[path.length - 1]))} showCount={prompt} />;
      }
      return <TextInput id={id} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} multiline={multiline} invalid={invalid} />;
    }
    case 'ref': return <RefSelect shape={shape} value={value} onChange={onChange} disabled={disabled} id={id} invalid={invalid} path={path} />;
    case 'secret': return <SecretInput value={value} onChange={onChange} disabled={disabled} id={id} />;
    case 'object':
      if (isChannelPath(path)) return <ChannelBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />;
      if (isToolPath(path)) return <ToolBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />;
      if (isAgentPath(path)) {
        return (
          <>
            <ObjectBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />
            {isObj(value) && typeof value.id === 'string' && value.id && <PromptPreview agentId={value.id} />}
          </>
        );
      }
      return <ObjectBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />;
    case 'array': return <ArrayBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />;
    case 'map': return <MapBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />;
    case 'union': {
      if (path[0] === 'messages' && path.length === 3 && path[2] === 'text') return <MessageText value={value} onChange={onChange} path={path} disabled={disabled} />;
      const generic = <UnionBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />;
      return shape.title === 'Condition' ? <ConditionBuilder value={value} path={path} onChange={onChange} disabled={disabled} fallback={generic} /> : generic;
    }
    default: return <JsonInput id={id} value={value} onChange={onChange} disabled={disabled} />;
  }
}

function RefSelect({ shape, value, onChange, disabled, id, invalid, path }) {
  const { refOptions, goTo } = useForm();
  const [creating, setCreating] = useState(false);
  const name = shape['x-ref'];
  const options = refOptions[name] || [];
  const [target, label] = REF_TARGET[name] || [];
  // Some of what a field points at can be made right here: the new thing is added and the field points at it.
  const spec = !disabled ? CREATABLE[name] : null;
  const newButton = spec && <button type="button" className="stLink stNewBtn" onClick={() => setCreating((v) => !v)}>＋ New {spec.word}</button>;
  const form = creating && <InlineCreate collection={name} target={path} defaultKind={path && path[path.length - 1] === 'count_attempts_in' ? 'integer' : undefined} onClose={() => setCreating(false)} />;
  if (!options.length && !value) {
    return (
      <div className="stFRefRow">
        <p className="stFEmpty">
          There are no {REF_WORD[name] || name} yet.{newButton ? <> {newButton}</> : target && <> Add one in <button type="button" className="stLink" onClick={() => goTo(target)}>{label}</button> first.</>}
        </p>
        {form}
      </div>
    );
  }
  return (
    <div className="stFRefRow">
      <Select id={id} value={value} options={options} onChange={onChange} disabled={disabled} invalid={invalid} placeholder={`Choose from ${REF_WORD[name] || name}…`} />
      {newButton}
      {form}
    </div>
  );
}

// A phone number or a web address: an ordinary box that says so when what is typed doesn't look like one (it isn't refused).
function ContactInput({ kind, id, value, onChange, placeholder, disabled, invalid }) {
  const text = typeof value === 'string' ? value : '';
  const ok = !text || (kind === 'phone' ? looksLikePhone(text) : looksLikeUrl(text));
  return (
    <>
      <input id={id} className="stFInput mono" type={kind === 'phone' ? 'tel' : 'url'} inputMode={kind === 'phone' ? 'tel' : 'url'} spellCheck={false} value={text} disabled={disabled}
        placeholder={placeholder || (kind === 'phone' ? '+14155550100' : 'https://…')} aria-invalid={invalid || !ok || undefined} onChange={(event) => onChange(event.target.value)} />
      {!ok && <small className="stFWarn">{kind === 'phone' ? 'This doesn’t look like a phone number. Use digits, with a + and the country code.' : 'This doesn’t look like a web address. Start it with https://'}</small>}
    </>
  );
}

function ShieldIcon() {
  return <svg className="stShieldIcon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>;
}

// A note under a field that needs more than the schema's description says.
function FieldNote({ path, value }) {
  const ctx = useForm();
  if (path[0] === 'state' && path[path.length - 1] === 'sensitive') {
    return (
      <p className={`stFNote ${value ? 'shield' : ''}`}>
        <ShieldIcon />{' '}
        {value
          ? 'Kept out of prompts, spoken lines and logs, and meant to be entered by keypad. The runtime doesn’t enforce this yet, so don’t rely on it for real PINs or card numbers.'
          : 'Turn this on for a PIN, one-time code or card number. It is then meant to be kept out of prompts and logs and entered by keypad (the runtime doesn’t enforce that yet).'}
        {value === true && ctx.raiseVersion && <> Sensitive variables need schema version 1.2. <button type="button" className="stLink" onClick={ctx.raiseVersion}>Use 1.2</button></>}
      </p>
    );
  }
  return null;
}

function SecretInput({ value, onChange, disabled, id }) {
  const { secretNames } = useForm();
  const listId = useId();
  const name = isObj(value) && typeof value.secret === 'string' ? value.secret : '';
  return (
    <div className="stFSecret">
      <span aria-hidden="true">🔑</span>
      <input id={id} className="stFInput mono" type="text" spellCheck={false} list={listId} value={name} disabled={disabled} placeholder="SECRET_NAME"
        onChange={(event) => onChange({ secret: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} />
      <datalist id={listId}>{secretNames.map((n) => <option key={n} value={n} />)}</datalist>
    </div>
  );
}

// ---- objects ---------------------------------------------------------------------------------

export function ObjectBody({ shape, value, path, onChange, disabled, collapsedKeys }) {
  const { engine, markDelete, issuesUnder } = useForm();
  const obj = isObj(value) ? value : {};
  const order = Object.keys(shape.properties);
  const flatOf = (k) => engine.flatten(shape.properties[k]);
  const visible = order.filter((k) => flatOf(k).const === undefined);
  const required = shape.required || [];
  const hintsOf = (k) => readXui(flatOf(k));
  const rows = orderKeys(visible.filter((k) => k in obj || required.includes(k)), hintsOf);
  const { main, advanced } = splitAdvanced(rows, hintsOf);
  const sections = groupKeys(main, hintsOf);
  const addable = visible.filter((k) => !(k in obj) && !required.includes(k) && !flatOf(k).deprecated);
  const unknown = Object.keys(obj).filter((k) => !(k in shape.properties));
  const extra = isObj(shape.additionalProperties) ? shape.additionalProperties : null;
  const openExtra = shape.additionalProperties === undefined && shape.unevaluatedProperties === undefined;

  const setProp = (key, v) => onChange(v === undefined ? omit(obj, key) : orderedSet(obj, key, v, order));
  const del = (key, label) => { markDelete(label || humanize(key)); setProp(key, undefined); };
  // Fields that are set and optional can be deleted; required ones are always part of the object.
  const deletable = rows.filter((k) => k in obj && !required.includes(k));
  const renderRow = (key) => (
    <FieldRow key={key} name={key} schema={shape.properties[key]} value={obj[key]} path={[...path, key]}
      required={required.includes(key)} missing={!(key in obj)} disabled={disabled} collapsed={collapsedKeys?.has(key)}
      onChange={(v) => setProp(key, v)} onAdd={() => setProp(key, engine.defaultFor(shape.properties[key]))}
      onRemove={!required.includes(key) ? () => del(key) : null} />
  );

  return (
    <div className="stFObject">
      {sections.map((section) => (
        <div className="stFGrid" key={section.group || '_'}>
          {section.group && <h5 className="stFSectionLabel">{section.group}</h5>}
          {section.keys.map(renderRow)}
        </div>
      ))}
      {advanced.length > 0 && (
        <details className="stFAdvanced" open={advanced.some((key) => issuesUnder(keyOf([...path, key])).length > 0) || undefined}>
          <summary>Advanced ({advanced.length})</summary>
          <div className="stFGrid">{advanced.map(renderRow)}</div>
        </details>
      )}
      {unknown.map((key) => (
        extra
          ? <FieldRow key={key} name={key} schema={extra} value={obj[key]} path={[...path, key]} disabled={disabled} onChange={(v) => setProp(key, v)} onRemove={() => del(key, key)} />
          : (
            <div className="stFRow wide" key={key} data-path={keyOf([...path, key])}>
              <div className="stFLabel"><label>{key}</label><span className={`stFTag ${openExtra ? '' : 'bad'}`}>{openExtra ? 'custom field' : 'not in the schema'}</span>
                <button type="button" className="stFDel small" aria-label={`Delete ${key}`} disabled={disabled} onClick={() => del(key, key)}>Delete</button></div>
              <FreeValue value={obj[key]} onChange={(v) => setProp(key, v)} disabled={disabled} />
              <Issues pathKey={keyOf([...path, key])} />
            </div>
          )
      ))}
      {(addable.length > 0 || deletable.length > 0 || extra || openExtra) && (
        <div className="stFAddRow">
          {addable.length > 0 && (
            <select className="stFInput small" value="" disabled={disabled} aria-label="Add a field" onChange={(event) => { const k = event.target.value; if (k) setProp(k, engine.defaultFor(shape.properties[k])); }}>
              <option value="">＋ Add a field…</option>
              {addable.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
            </select>
          )}
          {deletable.length > 0 && (
            <select className="stFInput small del" value="" disabled={disabled} aria-label="Delete a field" onChange={(event) => { const k = event.target.value; if (k) del(k); }}>
              <option value="">− Delete a field…</option>
              {deletable.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
            </select>
          )}
          {(extra || openExtra) && <AddKey existing={Object.keys(obj)} disabled={disabled} label="custom field" onAdd={(k) => setProp(k, extra ? engine.defaultFor(extra) : '')} />}
        </div>
      )}
      {rows.length === 0 && unknown.length === 0 && addable.length === 0 && !extra && <p className="stFEmpty">Nothing to set here.</p>}
    </div>
  );
}

// ---- one labelled property of an object ------------------------------------------------------

export function FieldRow({ name, schema, value, path, required, missing, disabled, onChange, onAdd, onRemove, label, collapsed }) {
  const ctx = useForm();
  const { engine } = ctx;
  const key = keyOf(path);
  const inputId = useId();
  const shape = engine.resolveShape(schema, value);
  const kind = engine.kindOf(shape);
  const readOnly = ctx.readOnly.has(key);
  const lockedIn = name === 'id' && !missing && typeof value === 'string' && value ? lockedIdCollection(path) : null;
  if (lockedIn) return <div data-path={key}><IdChip id={value} disabled={disabled} onRename={() => ctx.requestRename(lockedIn, value)} /></div>;
  const hints = readXui(shape);
  const title = label || hints.label || humanize(name);
  const showKey = title.toLowerCase() !== String(name).toLowerCase();
  const tags = (
    <>
      {required && <abbr title="Required" className="stFReq">*</abbr>}
      {shape.deprecated && <span className="stFTag warn">deprecated</span>}
      {readOnly && <span className="stFTag">set by the server</span>}
      {showKey && <code className="stFKey">{name}</code>}
    </>
  );

  if (missing) {
    return (
      <div className="stFRow wide missing" data-path={key}>
        <div className="stFLabel"><label>{title}</label>{tags}<span className="stFTag bad">required, not set</span></div>
        <button type="button" className="stAddBtn" disabled={disabled} onClick={onAdd}>＋ Set {title.toLowerCase()}</button>
        <Issues pathKey={key} />
        <Help text={shape.description} />
      </div>
    );
  }

  const style = kind === 'array' ? arrayStyle(engine, shape) : null;
  const grouped = kind === 'object' || kind === 'map' || (kind === 'array' && style === 'cards');
  if (grouped) {
    const count = kind === 'array' ? (Array.isArray(value) ? value.length : 0) : kind === 'map' ? Object.keys(isObj(value) ? value : {}).length : null;
    return (
      <div className="stFRow wide" data-grouprow={key}>
        <Group pathKey={key} title={title} hint={showKey ? name : undefined} count={count} onRemove={onRemove} defaultOpen={collapsed ? false : kind !== 'array' || (Array.isArray(value) && value.length <= 4)}>
          <Help text={shape.description} />
          {hints.help && <p className="stFHelp">{hints.help}</p>}
          <Node schema={schema} value={value} path={path} onChange={onChange} disabled={disabled || readOnly} />
        </Group>
      </div>
    );
  }

  const wide = kind === 'union' || kind === 'json' || kind === 'array' || (kind === 'string' && (shape['x-ui']?.widget === 'textarea' || String(value ?? '').length > 60)) || kind === 'secret';
  const deepIssues = kind === 'array' || kind === 'json';
  return (
    <div className={`stFRow ${wide ? 'wide' : ''} ${readOnly ? 'ro' : ''}`} data-path={key}>
      <div className="stFLabel">
        <label htmlFor={inputId}>{title}</label>
        {tags}
        {onRemove && !readOnly && <button type="button" className="stFDel small" aria-label={`Delete ${title}`} disabled={disabled} onClick={onRemove}>Delete</button>}
      </div>
      <Node schema={schema} value={value} path={path} onChange={onChange} disabled={disabled || readOnly} id={inputId} invalid={(ctx.exact.get(key) || []).some((i) => i.severity === 'error')} />
      <Issues pathKey={key} deep={deepIssues} />
      <Help text={shape.description} />
      {hints.help && <p className="stFHelp">{hints.help}</p>}
      <FieldNote path={path} value={value} />
    </div>
  );
}

// ---- unions ----------------------------------------------------------------------------------

function UnionBody({ shape, value, path, onChange, disabled }) {
  const { engine } = useForm();
  const branches = useMemo(() => engine.branchesOf(shape), [engine, shape]);
  const picked = engine.pickBranch(branches, value);
  // The kind is clear when the value fits it, or carries its marker (`type: "http"`) with some required fields still missing: then
  // that kind's editor is shown with what is missing marked, instead of raw JSON.
  const fitsBranch = engine.fits(branches[picked], value) || matchesDiscriminator(engine, branches[picked], value);
  const labels = branches.map((b, i) => engine.branchLabel(b, i));
  const segmented = branches.length <= 4 && labels.join('').length <= 48;
  const choose = (index) => { if (index !== picked || !fitsBranch) onChange(carryOver(engine, value, branches[index], engine.defaultFor(branches[index]))); };

  return (
    <div className="stFUnion">
      {branches.length > 1 && (segmented ? (
        <div className="stFSeg" role="group" aria-label="Kind">
          {labels.map((text, i) => (
            <button key={i} type="button" disabled={disabled} className={fitsBranch && i === picked ? 'on' : ''} aria-pressed={fitsBranch && i === picked} onClick={() => choose(i)}>{text}</button>
          ))}
        </div>
      ) : (
        <select className="stFInput small" disabled={disabled} aria-label="Kind" value={fitsBranch ? picked : ''} onChange={(event) => { if (event.target.value !== '') choose(Number(event.target.value)); }}>
          {!fitsBranch && <option value="">Choose a kind…</option>}
          {labels.map((text, i) => <option key={i} value={i}>{text}</option>)}
        </select>
      ))}
      {fitsBranch ? (
        <Node schema={branches[picked]} value={value} path={path} onChange={onChange} disabled={disabled} />
      ) : (
        <div className="stFUnknown">
          <small className="stFWarn">This value doesn’t match any known kind. Pick a kind above to start over, or edit it as JSON.</small>
          <JsonInput value={value} onChange={onChange} disabled={disabled} />
        </div>
      )}
    </div>
  );
}

// ---- arrays ----------------------------------------------------------------------------------

function ArrayBody({ shape, value, path, onChange: setValue, disabled }) {
  const { engine, refOptions, goTo, markDelete } = useForm();
  // StringList and MultiPick say what was deleted so the Undo bar can name it.
  const onChange = (next, meta) => { if (meta?.deleted) markDelete(meta.deleted); setValue(next); };
  const list = Array.isArray(value) ? value : [];
  const style = arrayStyle(engine, shape);
  const items = engine.flatten(shape.items);

  // Lists of actions and of rules read as steps wherever they occur (on-enter steps, fallbacks, what to do when a caller goes quiet…).
  if (isActionList(engine, shape)) return <ActionSteps shape={shape} value={list} path={path} onChange={setValue} disabled={disabled} label="the list" />;
  if (isRuleList(engine, shape)) return <EffectsEditor shape={shape} value={list} path={path} onChange={setValue} disabled={disabled} />;
  if (style === 'strings') return <StringList values={list} onChange={onChange} disabled={disabled} placeholder={Array.isArray(items.examples) ? String(items.examples[0]) : undefined} />;
  if (style === 'checks') return <CheckGroup options={items.enum.map(String)} values={list} onChange={onChange} disabled={disabled} />;
  if (style === 'pick') {
    const name = items['x-ref'];
    const options = refOptions[name] || [];
    const [target, label] = REF_TARGET[name] || [];
    return (
      <>
        <MultiPick options={options} values={list} onChange={onChange} disabled={disabled} emptyText={`No ${REF_WORD[name] || name} chosen`} />
        {options.length === 0 && list.length === 0 && target && <p className="stFEmpty">There are no {REF_WORD[name] || name} yet. Add some in <button type="button" className="stLink" onClick={() => goTo(target)}>{label}</button> first.</p>}
      </>
    );
  }
  return <CardList shape={shape} items={items} list={list} path={path} onChange={setValue} disabled={disabled} />;
}

function CardList({ shape, items, list, path, onChange, disabled }) {
  const ctx = useForm();
  const { engine, markDelete, requestDelete } = ctx;
  const collection = collectionAt(path);
  const unused = collection === 'tools' ? new Set(unusedTools(ctx.config)) : null;
  const named = collection && COLLECTIONS[collection].kind === 'list' ? collection : null;
  const [fresh, setFresh] = useState(-1);
  const isUnion = engine.kindOf(items) === 'union';
  const branches = isUnion ? engine.branchesOf(items) : null;
  const lastKey = path[path.length - 1];
  const base = singular(lastKey === 'items' ? path[path.length - 2] : lastKey);
  const takenIds = list.filter(isObj).map((item) => item.id).filter((id) => typeof id === 'string');

  const make = (branch) => {
    const made = engine.defaultFor(branch || shape.items);
    if (isObj(made) && 'id' in made && made.id === '') made.id = uniqueId(takenIds, base);
    return made;
  };
  const add = (branch) => { onChange([...list, make(branch)]); setFresh(list.length); };
  const move = (from, to) => { if (to < 0 || to >= list.length) return; const next = [...list]; const [item] = next.splice(from, 1); next.splice(to, 0, item); onChange(next); };

  return (
    <div className="stFCards">
      {list.map((item, index) => {
        const { title, hint: summary } = summarize(item, index);
        const baseHint = collection === 'messages' && isObj(item) && isObj(item.text) ? languageHint(item, ctx.config) : summary;
        const hint = unused && isObj(item) && unused.has(item.id) ? [baseHint, 'not used by any agent'].filter(Boolean).join(' · ') : baseHint;
        return (
          <Group key={index} pathKey={keyOf([...path, index])} title={title} hint={hint} defaultOpen={list.length <= 3 || index === fresh}
            onRemove={disabled ? null : () => {
              const remove = () => { markDelete(title); onChange(list.filter((_, i) => i !== index)); };
              if (named && isObj(item) && typeof item.id === 'string') requestDelete(named, item.id, remove); else remove();
            }}
            actions={!disabled && list.length > 1 ? (
              <>
                {list.length > 1 && <button type="button" className="stIconBtn" aria-label={`Move ${title} up`} disabled={index === 0} onClick={() => move(index, index - 1)}>↑</button>}
                {list.length > 1 && <button type="button" className="stIconBtn" aria-label={`Move ${title} down`} disabled={index === list.length - 1} onClick={() => move(index, index + 1)}>↓</button>}
              </>
            ) : null}>
            <Node schema={shape.items} value={item} path={[...path, index]} onChange={(v) => onChange(list.map((x, i) => (i === index ? v : x)))} disabled={disabled} />
          </Group>
        );
      })}
      {list.length === 0 && <p className="stFEmpty">{collection === 'tools' ? 'No tools yet. Handing a caller over to another agent isn’t a tool: it is set up under the agent’s Handoffs.' : 'Nothing here yet.'}</p>}
      {named === 'channels' ? (
        <select className="stFInput small" value="" disabled={disabled} aria-label="Add channel" onChange={(event) => { if (event.target.value) { onChange([...list, buildChannel(event.target.value, { taken: takenIds, botId: ctx.config?.meta?.id || '' })]); setFresh(list.length); } }}>
          <option value="">＋ Add channel…</option>
          {CHANNEL_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label} — {preset.note}</option>)}
        </select>
      ) : isUnion ? (
        <select className="stFInput small" value="" disabled={disabled} aria-label={`Add ${base}`} onChange={(event) => { if (event.target.value !== '') add(branches[Number(event.target.value)]); }}>
          <option value="">＋ Add {base}…</option>
          {branches.map((b, i) => {
            const kind = engine.flatten(b).properties?.type?.const;
            const missing = collection === 'tools' && UNSUPPORTED_KINDS[kind];
            return <option key={i} value={i}>{engine.branchLabel(b, i)}{missing ? ' (not available yet)' : ''}</option>;
          })}
        </select>
      ) : (
        <button type="button" className="stAddBtn" disabled={disabled} onClick={() => add()}>＋ Add {base}</button>
      )}
    </div>
  );
}

// ---- maps ------------------------------------------------------------------------------------

function AddKey({ existing, onAdd, pattern, options, disabled, label = 'entry' }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const taken = new Set(existing);
  const commit = (raw) => {
    const key = raw.trim();
    if (!key) return;
    if (taken.has(key)) { setError(`“${key}” already exists.`); return; }
    if (pattern && !new RegExp(pattern).test(key)) { setError(`Use the form ${pattern}`); return; }
    setError(''); setText(''); onAdd(key);
  };
  if (options) {
    const left = options.filter((o) => !taken.has(o));
    return (
      <select className="stFInput small" value="" disabled={disabled || left.length === 0} aria-label={`Add ${label}`} onChange={(event) => { if (event.target.value) onAdd(event.target.value); }}>
        <option value="">{left.length ? `＋ Add ${label}…` : `No more ${label}s to add`}</option>
        {left.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <div className="stFAddKey">
      <input className="stFInput small" type="text" spellCheck={false} value={text} disabled={disabled} placeholder={`New ${label} name`} aria-label={`New ${label} name`}
        onChange={(event) => { setText(event.target.value); setError(''); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(text); } }} />
      <button type="button" className="stAddBtn" disabled={disabled || !text.trim()} onClick={() => commit(text)}>＋ Add</button>
      {error && <small className="stFErr">{error}</small>}
    </div>
  );
}

// A key that is renamed when you leave the box, so typing doesn't re-key the object on every letter.
function KeyInput({ value, taken, pattern, onRename, disabled }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState('');
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const key = text.trim();
    if (key === value) { setError(''); return; }
    if (!key) { setText(value); return; }
    if (taken.includes(key)) { setError(`“${key}” already exists.`); return; }
    if (pattern && !new RegExp(pattern).test(key)) { setError(`Use the form ${pattern}`); return; }
    setError(''); onRename(key);
  };
  return (
    <div className="stFKeyBox">
      <input className="stFInput mono" type="text" spellCheck={false} value={text} disabled={disabled} aria-label="Name" aria-invalid={!!error || undefined}
        onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.target.blur(); } }} />
      {error && <small className="stFErr">{error}</small>}
    </div>
  );
}

function MapBody({ shape, value, path, onChange, disabled }) {
  const { engine, refOptions, markDelete, requestDelete, renameDirect } = useForm();
  const collectionName = collectionAt(path);
  const named = collectionName && COLLECTIONS[collectionName].kind === 'map' ? collectionName : null;
  const obj = isObj(value) ? value : {};
  const keys = Object.keys(obj);
  const valueSchema = isObj(shape.additionalProperties) ? shape.additionalProperties : null;
  const names = engine.deref(shape.propertyNames || {});
  const refName = names['x-ref'];
  const pattern = names.pattern;
  const fixedKeys = !!refName;
  const complex = !!valueSchema && isComplex(engine, valueSchema);

  const rename = (from, to) => {
    if (named) { renameDirect(named, from, to); return; }
    const out = {};
    Object.keys(obj).forEach((k) => { out[k === from ? to : k] = obj[k]; });
    onChange(out);
  };
  const setEntry = (k, v) => onChange({ ...obj, [k]: v });
  const removeEntry = (k) => {
    const remove = () => { markDelete(k); onChange(omit(obj, k)); };
    if (named) requestDelete(named, k, remove); else remove();
  };
  const add = (key) => onChange({ ...obj, [key]: valueSchema ? engine.defaultFor(valueSchema) : '' });

  return (
    <div className="stFMap">
      {keys.map((key) => {
        const entryPath = [...path, key];
        const pk = keyOf(entryPath);
        const control = valueSchema
          ? <Node schema={valueSchema} value={obj[key]} path={entryPath} onChange={(v) => setEntry(key, v)} disabled={disabled} />
          : <FreeValue value={obj[key]} onChange={(v) => setEntry(key, v)} disabled={disabled} />;
        if (complex) {
          return (
            <Group key={key} pathKey={pk} title={key} hint={named === 'state_vars' && isObj(obj[key]) && obj[key].sensitive === true ? <span className="stShield"><ShieldIcon /> sensitive</span> : undefined} defaultOpen={keys.length <= 3} onRemove={disabled ? null : () => removeEntry(key)}>
              {!fixedKeys && <div className="stFRow"><div className="stFLabel"><label>Name</label></div><KeyInput value={key} taken={keys.filter((k) => k !== key)} pattern={pattern} onRename={(to) => rename(key, to)} disabled={disabled} /></div>}
              {control}
            </Group>
          );
        }
        return (
          <div className="stFMapRow" key={key} data-path={pk}>
            {fixedKeys ? <code className="stFMapKey">{key}</code> : <KeyInput value={key} taken={keys.filter((k) => k !== key)} pattern={pattern} onRename={(to) => rename(key, to)} disabled={disabled} />}
            <div className="stFMapValue">{control}<Issues pathKey={pk} deep /></div>
            <button type="button" className="stIconBtn danger" title="Delete this entry" aria-label={`Delete ${key}`} disabled={disabled} onClick={() => removeEntry(key)}>×</button>
          </div>
        );
      })}
      {keys.length === 0 && <p className="stFEmpty">Nothing here yet.</p>}
      <AddKey existing={keys} pattern={pattern} options={fixedKeys ? (refOptions[refName] || []) : null} disabled={disabled} label={fixedKeys ? (REF_WORD[refName] || 'entry').replace(/s$/, '') : 'entry'} onAdd={add} />
    </div>
  );
}
