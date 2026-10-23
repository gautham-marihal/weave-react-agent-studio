import React, { useContext, useEffect, useId, useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import Sheet, { DepthCtx } from './Sheet.jsx';
import { cardsThatMayOpen } from './cardSize.js';
import { humanize, isObj } from './engine.js';
import { PLAIN_KIND } from './plainKinds.js';
import { keysNotOffered, modalityChoices } from './channelTypes.js';
import {
  OwnerCtx,
  isUnder,
  keyOf,
  omit,
  orderedSet,
  singular,
  uniqueId,
  useConfigSelect,
  useForm,
  useKeyedHandlers,
  useOwner,
  useStableCallback,
} from './ctx.js';
import { hiddenParts } from './hiddenParts.js';
import SmartSelect from '../SmartSelect.jsx';
import ModelField from './ModelField.jsx';
import { enumLabels } from './plainEnums.js';
import { modelStageOf } from './modelFields.js';
import { CheckGroup, FreeValue, JsonInput, MultiPick, NumberInput, RangeNumber, Select, StringList, Switch, TextInput } from './fields.jsx';
import ChannelBody from './ChannelBody.jsx';
import ConditionBuilder from './ConditionBuilder.jsx';
import MessageText from './MessageText.jsx';
import TemplateField from './TemplateField.jsx';
import { PathInput } from './RequestResponse.jsx';
import InlineCreate from './InlineCreate.jsx';
import ToolBody from './ToolBody.jsx';
import { PromptPreviewFromForm } from './PromptPreview.jsx';
import AddPicker from './AddPicker.jsx';
import { INTRO, WHAT, pickerFor, takenIdsAt } from './pickerOptions.js';
import { setRecordingNotice } from '../simple/simpleModel.js';
import RecordingNoticeOffer from '../records/RecordingNoticeOffer.jsx';
import ScheduleStrip from '../relations/ScheduleStrip.jsx';
import TaskSteps from '../relations/TaskSteps.jsx';
import { TryGuardrails, TryRedaction, TrySpeech, TryTask } from './TryPanels.jsx';
import UsedBy from '../relations/UsedBy.jsx';
import { CREATABLE } from './inlineCreate.js';
import { UNSUPPORTED_BUILTINS, UNSUPPORTED_KINDS, agentsUsingTool, toolKindCounts, toolMatches, unusedTools, usedByText } from './toolInfo.js';
import { IdChip } from './IdTools.jsx';
import { collectionAt, COLLECTIONS, lockedIdCollection } from './references.js';
import { arrayStyle, carryOver, isActionList, isComplex, isRuleList, matchesDiscriminator, summarize } from './cardLogic.js';
import EffectsEditor, { ActionSteps } from './EffectsEditor.jsx';
import { isPromptPath, isTemplateString, scopeAt, scopeSignature } from './templates.js';
import { languageHint } from './messages.js';
import { describeSetting } from './plainLanguage.js';
import { TechName } from './TechName.jsx';
import { groupKeys, looksLikePhone, looksLikeUrl, orderKeys, readXui, splitAdvanced } from './xui.js';

// What "this collection lives in" for the hint under an empty reference list, and where Go there leads.
const REF_TARGET = {
  agents: ['agents', 'Agents'],
  tools: ['tools', 'Tools'],
  tool_names: ['tools', 'Tools'],
  tasks: ['tasks', 'Tasks'],
  knowledge: ['knowledge', 'Knowledge'],
  forms: ['forms', 'Forms'],
  wrapups: ['wrapups', 'Wrap-ups'],
  messages: ['messages', 'Messages'],
  notifications: ['notifications', 'Notifications'],
  channels: ['channels', 'Channels'],
  transfers: ['telephony', 'Telephony'],
  input_guardrails: ['guardrails', 'Safety rules'],
  schedules: ['schedules', 'Schedules'],
  state_vars: ['state', 'State'],
  http_connections: ['connections', 'Connections'],
  mcp_connections: ['connections', 'Connections'],
  notifiers: ['connections', 'Connections'],
};
const REF_WORD = {
  agents: 'agents',
  tools: 'tools',
  tool_names: 'tools',
  tasks: 'tasks',
  knowledge: 'knowledge bases',
  forms: 'forms',
  wrapups: 'closing messages',
  messages: 'fixed lines',
  notifications: 'notifications',
  channels: 'channels',
  transfers: 'transfers',
  input_guardrails: 'safety rules',
  schedules: 'schedules',
  state_vars: 'state variables',
  http_connections: 'HTTP connections',
  mcp_connections: 'MCP connections',
  notifiers: 'SMS/email connections',
};

// What "Add …" calls one item of a list or map, where its key's own word would read oddly ("Add notification" for the messages it sends).
const ADD_WORDS = {
  notifications: 'message',
  wrapups: 'closing message',
  artifacts: 'file to save',
  variables: 'variable',
  constants: 'value',
  http: 'connection',
  mcp: 'MCP connection',
  notifiers: 'SMS or email connection',
};

// What a setting is for, in plain words, with an example when there is one. The schema's own description (the technical wording) is one click
// away, or open already when technical names are on. When there is no hand-written purpose the lead is the schema's first sentence.
// the last word of a text and the rest, so the "i" can be kept on the line of the last word
const lastWord = (text) => {
  const t = String(text).trimEnd();
  const i = t.lastIndexOf(' ');
  return i < 0 ? ['', t] : [t.slice(0, i + 1), t.slice(i + 1)];
};

// The "i" that shows a setting's technical detail. Drawn with CSS, not an SVG: there is one beside nearly every setting, and hundreds of SVGs slow typing
// on a long screen.
function InfoButton({ shown, onToggle, moreLabel = 'Technical detail' }) {
  return (
    <button
      type="button"
      className={`stFInfo ${shown ? 'on' : ''}`}
      aria-expanded={shown}
      aria-label={shown ? `Hide the ${moreLabel.toLowerCase()}` : moreLabel}
      title={shown ? 'Hide' : moreLabel}
      onClick={onToggle}
    >
      <span className="stFInfoMark" aria-hidden="true">
        i
      </span>
    </button>
  );
}
// the technical description of a setting, when it says more than the plain words
const moreOf = (words) => (words.full && words.full.trim() && words.full.trim() !== words.lead ? words.full.trim() : '');

//   shown: when given, the row draws the "i" beside the setting's name and says here whether the detail is open; else the "i" ends the help line.
function Help({ lead, example, full, moreLabel = 'Technical detail', open: startOpen = false, shown: shownFromRow }) {
  const [open, setOpen] = useState(false);
  const more = full && full.trim() && full.trim() !== lead ? full.trim() : '';
  const inline = shownFromRow === undefined;
  const shown = inline ? open || (startOpen && !!more) : shownFromRow;
  if (!lead && !example && !(more && (inline || shown))) return null;
  const info = more && inline ? <InfoButton shown={shown} onToggle={() => setOpen((v) => !v)} moreLabel={moreLabel} /> : null;
  // the "i" goes with the last word, in a piece that does not wrap, so it never sits alone on a line
  const [leadHead, leadLast] = lead ? lastWord(lead) : ['', ''];
  const [exHead, exLast] = example ? lastWord(example) : ['', ''];
  return (
    <p className="stFHelp">
      {lead &&
        (info && !example ? (
          <span>
            {leadHead}
            <span className="stFTail">
              {leadLast} {info}
            </span>
          </span>
        ) : (
          <span>{lead} </span>
        ))}
      {example && (
        <span className="stFExample">
          {info && exHead ? (
            <>
              For example: <em>{exHead}</em>
              <span className="stFTail">
                <em>{exLast}</em> {info}
              </span>
            </>
          ) : info ? (
            <span className="stFTail">
              For example: <em>{exLast}</em> {info}
            </span>
          ) : (
            <>
              For example: <em>{example}</em>
            </>
          )}{' '}
        </span>
      )}
      {!lead && !example && info}
      {more && shown && <span className="stFMore">{more}</span>}
    </p>
  );
}

// The words a setting is drawn with: the server's own hint when it sends one, else the catalogue, else a label made by rule.
function useSettingWords(name, shape, label) {
  const owner = useOwner();
  const hints = readXui(shape);
  const info = describeSetting(name, { owner, description: shape.description });
  return {
    title: label || hints.label || info.label,
    lead: hints.help || info.purpose,
    example: hints.example || info.example,
    level: hints.audience || info.level,
    full: shape.description,
    moreLabel: info.curated || hints.help ? 'Technical detail' : 'More',
  };
}

// What is wrong with a field, in plain words, with a button to fix it where one is certain. The server's own sentence is in the tooltip, and shown
// when technical names are on.
function Issues({ pathKey, deep = false }) {
  const { exact, issuesUnder, describe, applyFix, technical } = useForm();
  const list = deep ? issuesUnder(pathKey) : exact.get(pathKey);
  if (!list?.length) return null;
  return list.map((issue, index) => {
    const d = describe(issue);
    return (
      <small
        key={index}
        className={`stFIssue ${issue.severity === 'error' ? 'stFErr' : 'stFWarn'}`}
        title={d.recognised ? `The server said: ${issue.message}` : undefined}
      >
        {d.text}
        {technical && d.recognised && <span className="stFRawIssue"> ({issue.message})</span>}
        {d.fixes.map((fix) => (
          <button type="button" key={fix.id} className="vxFix small" onClick={() => applyFix(fix)}>
            {fix.label}
          </button>
        ))}
      </small>
    );
  });
}

// The bin button beside a setting or a group: an icon, with the words for a screen reader and a tooltip.
function DeleteButton({ what, onClick, disabled, small = false }) {
  return (
    <button
      type="button"
      className={`stFDel stFDelIcon ${small ? 'small' : ''}`}
      aria-label={`Delete ${what}`}
      title={`Delete ${what}`}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name="trash" size={small ? 15 : 16} />
    </button>
  );
}

// A focus request opens what holds it only while it is fresh: a sheet that was closed by hand does not open again when its screen is drawn again later.
const FRESH_FOCUS_MS = 2500;

// A group of settings. On the screen itself (depth 0) it is a section that folds; inside one (depth 1 and deeper) it is a row that opens a sheet, so boxes are
// never drawn inside boxes. `sub` is the line under a row's title when it has no hint of its own.
function Group({ pathKey, title, hint, sub, tooltip, count, onRemove, defaultOpen = true, actions, children, flat = false }) {
  const { focus, countUnder } = useForm();
  const depth = useContext(DepthCtx);
  const drill = !flat && depth >= 1;
  const [open, setOpen] = useState(drill ? false : defaultOpen);
  useEffect(() => {
    if (focus && isUnder(focus.key, pathKey) && (!drill || !focus.nonce || Date.now() - focus.nonce < FRESH_FOCUS_MS)) setOpen(true);
  }, [focus, pathKey, drill]);
  const c = countUnder(pathKey);
  // a problem inside is never left behind a closed section (a row that opens a sheet shows the count instead)
  useEffect(() => {
    if (!drill && c.errors > 0) setOpen(true);
  }, [c.errors, drill]);
  const dots = (
    <>
      {c.errors > 0 && (
        <b className="stFDot err" title={`${c.errors} error${c.errors === 1 ? '' : 's'} inside`}>
          {c.errors}
        </b>
      )}
      {c.errors === 0 && c.warnings > 0 && (
        <b className="stFDot warn" title={`${c.warnings} warning${c.warnings === 1 ? '' : 's'} inside`}>
          {c.warnings}
        </b>
      )}
    </>
  );
  const remove = onRemove ? <DeleteButton what={title} onClick={onRemove} /> : null;
  if (drill) {
    const line = hint || sub;
    return (
      <section className={`stFGroup drill ${c.errors ? 'hasErr' : ''}`} data-path={pathKey}>
        <header>
          <button
            type="button"
            className="stFGroupToggle"
            aria-expanded={open}
            aria-haspopup="dialog"
            title={tooltip || undefined}
            onClick={() => setOpen(true)}
          >
            <span className="stFDrillText">
              <strong>{title}</strong>
              {line && <span className="stFHint">{line}</span>}
            </span>
            {count != null && <em>{count}</em>}
            {dots}
            <Icon name="chevronRight" size={16} className="stFChev" />
          </button>
          {(actions || remove) && (
            <div className="stFGroupActions">
              {actions}
              {remove}
            </div>
          )}
        </header>
        {open && (
          <Sheet title={title} pathKey={pathKey} onClose={() => setOpen(false)} actions={remove}>
            <Issues pathKey={pathKey} />
            {children}
          </Sheet>
        )}
      </section>
    );
  }
  return (
    <section className={`stFGroup ${c.errors ? 'hasErr' : ''} ${flat ? 'flat' : ''} ${open ? 'open' : ''}`} data-path={pathKey}>
      <header>
        <button type="button" className="stFGroupToggle" aria-expanded={open} title={tooltip || undefined} onClick={() => setOpen((v) => !v)}>
          <Icon name="chevronRight" size={16} className="stFChev" />
          <strong>{title}</strong>
          {hint && <span className="stFHint">{hint}</span>}
          {count != null && <em>{count}</em>}
          {dots}
        </button>
        {(actions || remove) && (
          <div className="stFGroupActions">
            {actions}
            {remove}
          </div>
        )}
      </header>
      {(open || flat) && (
        <div className="stFGroupBody">
          <Issues pathKey={pathKey} />
          <DepthCtx.Provider value={flat ? depth : depth + 1}>{children}</DepthCtx.Provider>
        </div>
      )}
    </section>
  );
}

// ---- the recursive value editor --------------------------------------------------------------

const isChannelPath = (path) => path.length === 2 && path[0] === 'channels' && typeof path[1] === 'number';
const isToolPath = (path) => path.length === 2 && path[0] === 'tools' && typeof path[1] === 'number';
const isAgentPath = (path) => path.length === 3 && path[0] === 'agents' && path[1] === 'items' && typeof path[2] === 'number';

export default function Node({ schema, value, path, onChange, disabled, id, invalid }) {
  const ctx = useForm();
  const owner = useOwner();
  const { engine } = ctx;
  const shape = engine.resolveShape(schema, value);
  const kind = engine.kindOf(shape);
  const placeholder = Array.isArray(shape.examples) ? String(shape.examples[0]) : undefined;

  switch (kind) {
    case 'const':
      return <span className="stFConst">{String(shape.const)}</span>;
    case 'null':
      return <span className="stFConst">none</span>;
    case 'boolean':
      return <Switch id={id} checked={!!value} onChange={onChange} disabled={disabled} label={id ? undefined : shape.title || 'Setting'} />;
    case 'number': {
      const min = shape.minimum ?? (shape.exclusiveMinimum !== undefined ? shape.exclusiveMinimum : undefined);
      const max = shape.maximum;
      const integer = [].concat(shape.type).includes('integer');
      const ranged = typeof min === 'number' && typeof max === 'number' && max > min && max - min <= 100 && readXui(shape).widget !== 'duration';
      const Field = ranged ? RangeNumber : NumberInput;
      const input = (
        <Field
          id={id}
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          integer={integer}
          nullable={engine.isNullable(shape)}
          disabled={disabled}
          invalid={invalid}
          placeholder={value === undefined ? 'Not set' : undefined}
        />
      );
      return readXui(shape).widget === 'duration' ? (
        <span className="stFUnit">
          {input}
          <span className="stMuted">seconds</span>
        </span>
      ) : (
        input
      );
    }
    case 'enum': {
      // The choices are drawn in words (plainEnums.js); the stored value is unchanged. A tool kind the runtime can't run says so, and the schema's default is marked.
      const leaf = String(path[path.length - 1]);
      const values = shape.enum.map(String);
      const suffix =
        path[0] === 'tools' && leaf === 'builtin' ? Object.fromEntries(Object.keys(UNSUPPORTED_BUILTINS).map((name) => [name, '(not available yet)'])) : {};
      const labels = enumLabels(leaf, values, { technical: ctx.technical, suffix });
      const standard = shape.default !== undefined && shape.default !== null ? String(shape.default) : '';
      if (standard && values.includes(standard)) labels[standard] = `${labels[standard] || standard} (default)`;
      return <Select id={id} value={value} options={values} onChange={onChange} disabled={disabled} invalid={invalid} labels={labels} />;
    }
    case 'string': {
      const widget = readXui(shape).widget;
      const multiline = widget === 'textarea' || String(value ?? '').includes('\n') || String(value ?? '').length > 90;
      if (widget === 'jsonpath')
        return <PathInput value={value} onChange={onChange} disabled={disabled} label={describeSetting(String(path[path.length - 1]), { owner }).label} />;
      if (widget === 'phone' || widget === 'url')
        return <ContactInput kind={widget} id={id} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} invalid={invalid} />;
      if (isTemplateString(path, shape, value)) {
        const prompt = isPromptPath(path);
        return (
          <ScopedTemplateField
            id={id}
            value={value}
            onChange={onChange}
            path={path}
            multiline={multiline}
            placeholder={placeholder}
            disabled={disabled}
            invalid={invalid}
            mono={['path', 'uri_template', 'body'].includes(String(path[path.length - 1]))}
            showCount={prompt}
          />
        );
      }
      const modelStage = modelStageOf(path);
      if (modelStage)
        return (
          <ModelField
            stage={modelStage}
            leaf={String(path[path.length - 1])}
            path={path}
            id={id}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            disabled={disabled}
            invalid={invalid}
          />
        );
      return <TextInput id={id} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} multiline={multiline} invalid={invalid} />;
    }
    case 'ref':
      return <RefSelect shape={shape} value={value} onChange={onChange} disabled={disabled} id={id} invalid={invalid} path={path} />;
    case 'secret':
      return <SecretInput value={value} onChange={onChange} disabled={disabled} id={id} />;
    case 'object':
      if (isChannelPath(path)) return <ChannelBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />;
      if (isToolPath(path)) return <ToolBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />;
      if (isAgentPath(path)) {
        return (
          <>
            <ObjectBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />
            {isObj(value) && typeof value.id === 'string' && value.id && <PromptPreviewFromForm agentId={value.id} />}
          </>
        );
      }
      if (path.length === 2 && path[0] === 'schedules')
        return (
          <>
            <ScheduleStrip value={value} />
            <ObjectBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />
          </>
        );
      if (path.length === 2 && path[0] === 'tasks')
        return (
          <>
            <TaskSteps value={value} />
            <ObjectBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />
            {isObj(value) && typeof value.id === 'string' && value.id && <TryTask taskId={value.id} />}
          </>
        );
      // "Try a line" under the settings it answers for: how a line is said, what redaction hides, what the safety rules do
      if (path[path.length - 1] === 'speech' && shape.properties?.pronunciation)
        return (
          <>
            <ObjectBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />
            <TrySpeech path={path} />
          </>
        );
      // (not when what it hides is asked above the form, by After the call's card, which has its own)
      if (path.length === 2 && path[0] === 'post_call' && path[1] === 'redaction')
        return (
          <>
            <ObjectBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />
            {!ctx.hidden?.has('post_call.redaction.entities') && <TryRedaction />}
          </>
        );
      if (path.length === 1 && path[0] === 'guardrails')
        return (
          <>
            <ObjectBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />
            <TryGuardrails />
          </>
        );
      return <ObjectBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />;
    case 'array':
      return <ArrayBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />;
    case 'map':
      return <MapBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />;
    case 'union': {
      if (path[0] === 'messages' && path.length === 3 && path[2] === 'text')
        return <MessageText value={value} onChange={onChange} path={path} disabled={disabled} />;
      const generic = <UnionBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />;
      return shape.title === 'Condition' ? <ConditionBuilder value={value} path={path} onChange={onChange} disabled={disabled} fallback={generic} /> : generic;
    }
    default:
      return <JsonInput id={id} value={value} onChange={onChange} disabled={disabled} />;
  }
}

// A template box whose scope (the names a template may use here) comes from the config in the form's store, so it only re-renders when
// those names change, not on every keystroke elsewhere.
function ScopedTemplateField({ path, ...props }) {
  const { store } = useForm();
  const signature = useConfigSelect((c) => scopeSignature(c, path), Object.is);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the scope changes exactly when its signature does
  const scope = useMemo(() => scopeAt(store.get(), path), [signature, keyOf(path), store]);
  // text written to the agent about a channel (its extra instructions) gets the plain menu, as the Agent page's instructions do
  const plain = path[0] === 'channels' && path[path.length - 1] === 'instructions_append';
  return <TemplateField {...props} scope={scope} plain={plain} />;
}

// What a field points at, by name: an agent by its own name, anything else by its id in words ("escalate_to_human" → "Escalate to human"); two that
// would read the same keep their ids beside them. With technical names on, the ids.
function refLabels(name, options, config) {
  const agents = Array.isArray(config?.agents?.items) ? config.agents.items.filter(isObj) : [];
  const words = (id) => {
    if (name === 'agents') {
      const agent = agents.find((a) => a.id === id);
      if (typeof agent?.name === 'string' && agent.name.trim()) return agent.name.trim();
      if (agent && agents.length === 1 && typeof config?.meta?.name === 'string' && config.meta.name.trim()) return config.meta.name.trim();
    }
    return humanize(String(id));
  };
  const first = options.map(words);
  return Object.fromEntries(options.map((id, i) => [id, first.indexOf(first[i]) !== first.lastIndexOf(first[i]) ? `${first[i]} (${id})` : first[i]]));
}

function RefSelect({ shape, value, onChange, disabled, id, invalid, path }) {
  const { refOptions, goTo, technical, store } = useForm();
  const [creating, setCreating] = useState(false);
  const name = shape['x-ref'];
  const options = refOptions[name] || [];
  const labels = technical ? undefined : refLabels(name, options, store.get());
  const [target, label] = REF_TARGET[name] || [];
  // Some of what a field points at can be made right here: the new thing is added and the field points at it.
  const spec = !disabled ? CREATABLE[name] : null;
  const newButton = spec && (
    <button type="button" className="stLink stNewBtn" onClick={() => setCreating((v) => !v)}>
      <Icon name="plus" size={14} /> New {spec.word}
    </button>
  );
  const form = creating && (
    <InlineCreate
      collection={name}
      target={path}
      defaultKind={path && path[path.length - 1] === 'count_attempts_in' ? 'integer' : undefined}
      onClose={() => setCreating(false)}
    />
  );
  if (!options.length && !value) {
    return (
      <div className="stFRefRow">
        <p className="stFEmpty">
          There are no {REF_WORD[name] || name} yet.
          {newButton ? (
            <> {newButton}</>
          ) : (
            target && (
              <>
                {' '}
                Add one in{' '}
                <button type="button" className="stLink" onClick={() => goTo(target)}>
                  {label}
                </button>{' '}
                first.
              </>
            )
          )}
        </p>
        {form}
      </div>
    );
  }
  return (
    <div className="stFRefRow">
      <Select
        id={id}
        value={value}
        options={options}
        labels={labels}
        onChange={onChange}
        disabled={disabled}
        invalid={invalid}
        placeholder={`Choose from ${REF_WORD[name] || name}…`}
      />
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
      <input
        id={id}
        className="stFInput mono"
        type={kind === 'phone' ? 'tel' : 'url'}
        inputMode={kind === 'phone' ? 'tel' : 'url'}
        spellCheck={false}
        value={text}
        disabled={disabled}
        placeholder={placeholder || (kind === 'phone' ? '+14155550100' : 'https://…')}
        aria-invalid={invalid || !ok || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {!ok && (
        <small className="stFWarn">
          {kind === 'phone'
            ? 'This doesn’t look like a phone number. Use digits, with a + and the country code.'
            : 'This doesn’t look like a web address. Start it with https://'}
        </small>
      )}
    </>
  );
}

function ShieldIcon() {
  return (
    <svg className="stShieldIcon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
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
        {value === true && ctx.raiseVersion && (
          <>
            {' '}
            Sensitive variables need schema version 1.2.{' '}
            <button type="button" className="stLink" onClick={ctx.raiseVersion}>
              Use 1.2
            </button>
          </>
        )}
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
      <input
        id={id}
        className="stFInput mono"
        type="text"
        spellCheck={false}
        list={listId}
        value={name}
        disabled={disabled}
        placeholder="SECRET_NAME"
        onChange={(event) => onChange({ secret: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
      />
      <datalist id={listId}>
        {secretNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </div>
  );
}

// ---- objects ---------------------------------------------------------------------------------

// `onlyKeys` shows just those properties (a screen that is part of a section, see layout.js), and `showUnknown: false` leaves the keys the schema
// doesn't know to another part of the same section.
export function ObjectBody({ shape, value, path, onChange, disabled, collapsedKeys, onlyKeys, showUnknown = true }) {
  const { engine, markDelete, issuesUnder, expertHome, hidden, store, channelTypes } = useForm();
  const owner = useOwner();
  const obj = isObj(value) ? value : {};
  const order = Object.keys(shape.properties);
  const flatOf = (k) => engine.flatten(shape.properties[k]);
  const visible = order.filter((k) => flatOf(k).const === undefined && (!onlyKeys || onlyKeys.includes(k)) && !(hidden && hidden.has([...path, k].join('.'))));
  const required = shape.required || [];
  // A setting meant for experts or operators sits under "Advanced" (the server's `advanced`/`audience` hints, else the catalogue's level), unless
  // this whole screen is the place for them.
  const wordsOf = (k) => describeSetting(k, { owner, description: flatOf(k).description });
  const hintsOf = (k) => {
    const h = readXui(flatOf(k));
    return { ...h, advanced: h.advanced || (!expertHome && (h.audience || wordsOf(k).level) === 'expert') };
  };
  // a channel with no voice is not offered the settings only a voice channel has (what is already set stays, and the channel says so)
  const notOffered = channelTypes ? keysNotOffered(store.get(), channelTypes, path) : [];
  // Every setting is on the screen, the ones not set too: those show the value the agent uses anyway (the default), and changing it sets it. Nothing is
  // hidden behind an "add" menu. A deprecated one, or one this kind of channel can't use, is shown only while it is set.
  const unsetShown = (k) => !(k in obj) && !required.includes(k) && !flatOf(k).deprecated && !notOffered.includes(k);
  const rows = orderKeys(
    visible.filter((k) => k in obj || required.includes(k) || unsetShown(k)),
    hintsOf,
  );
  const { main, advanced } = splitAdvanced(rows, hintsOf);
  const sections = groupKeys(main, hintsOf);
  const unknown = showUnknown ? Object.keys(obj).filter((k) => !(k in shape.properties)) : [];
  const extra = isObj(shape.additionalProperties) ? shape.additionalProperties : null;
  const openExtra = shape.additionalProperties === undefined && shape.unevaluatedProperties === undefined;

  const setProp = (key, v) => onChange(v === undefined ? omit(obj, key) : orderedSet(obj, key, v, order));
  // Deleting a row takes out what the row shows. The parts the page asks for elsewhere (a card above the form: After the call's switches and ticks) stay,
  // and a row holding nothing but those has no Delete.
  const keptOf = (key) => hiddenParts(obj[key], [...path, key].join('.'), hidden);
  const onlyHidden = (key) => {
    const kept = keptOf(key);
    return kept !== undefined && JSON.stringify(kept) === JSON.stringify(obj[key]);
  };
  const del = (key, label) => {
    markDelete(label || wordsOf(key).label);
    setProp(key, keptOf(key));
  };
  // Fields that are set and optional can be deleted; required ones are always part of the object.
  const renderRow = (key) => (
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
      collapsed={collapsedKeys?.has(key)}
      sole={rows.length === 1}
      onChange={(v) => setProp(key, v)}
      onAdd={() => setProp(key, engine.defaultFor(shape.properties[key]))}
      onRemove={!required.includes(key) && !onlyHidden(key) ? () => del(key) : null}
    />
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
          <summary>
            Advanced settings <span className="stFCount">{advanced.length}</span>
          </summary>
          <div className="stFGrid">{advanced.map(renderRow)}</div>
        </details>
      )}
      {unknown.map((key) =>
        extra ? (
          <FieldRow
            key={key}
            name={key}
            schema={extra}
            value={obj[key]}
            path={[...path, key]}
            disabled={disabled}
            onChange={(v) => setProp(key, v)}
            onRemove={() => del(key, key)}
          />
        ) : (
          <div className="stFRow wide" key={key} data-path={keyOf([...path, key])}>
            <div className="stFLabel">
              <label>{key}</label>
              <span className={`stFTag ${openExtra ? '' : 'bad'}`}>{openExtra ? 'custom field' : 'not in the schema'}</span>
              <DeleteButton small what={key} disabled={disabled} onClick={() => del(key, key)} />
            </div>
            <FreeValue value={obj[key]} onChange={(v) => setProp(key, v)} disabled={disabled} />
            <Issues pathKey={keyOf([...path, key])} />
          </div>
        ),
      )}
      {(extra || openExtra) && (
        <div className="stFAddRow">
          <AddKey existing={Object.keys(obj)} disabled={disabled} label="custom field" onAdd={(k) => setProp(k, extra ? engine.defaultFor(extra) : '')} />
        </div>
      )}
      {rows.length === 0 && unknown.length === 0 && !extra && <p className="stFEmpty">Nothing to set here.</p>}
    </div>
  );
}

// ---- one labelled property of an object ------------------------------------------------------

// `unset`: an optional setting that is not in the configuration. It is drawn like any other, with the value the agent uses anyway (the schema's
// default) and "Default" beside its name; the first change sets it. It is the same markup as a set row, so typing into it keeps the cursor.
export function FieldRow({
  name,
  schema,
  value: given,
  path,
  required,
  missing,
  unset: unsetOptional = false,
  disabled,
  onChange: change,
  onAdd,
  onRemove: remove,
  label,
  collapsed,
  sole,
}) {
  // a setting that isn't in the configuration, optional or required: it is drawn with its control (and its default) all the same, so filling it in is
  // one step; a required one is also marked as needing a value
  const unset = unsetOptional || !!missing;
  missing = !!missing && !!required; // an optional part a caller marks as absent is just not set
  const ctx = useForm();
  const { engine } = ctx;
  const key = keyOf(path);
  const inputId = useId();
  const [infoToggled, setInfoToggled] = useState(false);
  const declared = engine.resolveShape(schema, given);
  const kindUnset = engine.kindOf(declared);
  const styleUnset = kindUnset === 'array' ? arrayStyle(engine, declared) : null;
  const groupedUnset = kindUnset === 'object' || kindUnset === 'map' || (kindUnset === 'array' && styleUnset === 'cards');
  // what an unset setting shows: its default (a group shows the defaults of its parts); a yes/no with no default is "no"
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
  const value = shownDefault;
  // an unset setting is set by a real change only: clearing an empty box leaves it unset
  // (a choice of kinds is a real change even when the chosen kind starts empty)
  const onChange = unset && kindUnset !== 'union' ? (v) => (v === '' || v === undefined || v === null ? undefined : change(v)) : change;
  const onRemove = unset ? null : remove;
  const shape = unset ? engine.resolveShape(schema, value) : declared;
  const kind = engine.kindOf(shape);
  const readOnly = ctx.readOnly.has(key);
  const words = useSettingWords(name, shape, label);
  const hasDefault = declared.default !== undefined;
  const lockedIn = name === 'id' && !missing && typeof value === 'string' && value ? lockedIdCollection(path) : null;
  if (lockedIn)
    return (
      <div data-path={key}>
        <IdChip id={value} disabled={disabled} onRename={() => ctx.requestRename(lockedIn, value)} />
      </div>
    );
  const { title } = words;
  const technical = ctx.technical;
  // the technical detail opens from an "i" beside the setting's name (open from the start when technical names are on)
  const more = moreOf(words);
  const infoShown = !!more && (technical ? !infoToggled : infoToggled);
  const infoButton = more ? <InfoButton shown={infoShown} onToggle={() => setInfoToggled((v) => !v)} moreLabel={words.moreLabel} /> : null;
  const helpLine = <Help lead={words.lead} example={words.example} full={words.full} moreLabel={words.moreLabel} open={technical} />;
  const rowHelp = <Help lead={words.lead} example={words.example} full={words.full} moreLabel={words.moreLabel} shown={infoShown} />;
  const tags = (
    <>
      {required && (
        <abbr title="Required" className="stFReq">
          *
        </abbr>
      )}
      {infoButton}
      {shape.deprecated && <span className="stFTag warn">deprecated</span>}
      {readOnly && <span className="stFTag">set by the server</span>}
      {technical && <TechName name={name} path={path} />}
    </>
  );

  // a kind with no plain control to show (raw JSON, a fixed value): one button sets it
  if (unset && ['json', 'const', 'null'].includes(kind)) {
    return (
      <div className={`stFRow ${required ? 'missing' : ''}`} data-path={key}>
        <div className="stFLabel">
          <label title={words.lead || undefined}>{title}</label>
          {tags}
          {required && <span className="stFTag bad">required, not set</span>}
          {!required && <span className="stFDefault">Not set</span>}
        </div>
        {rowHelp}
        <div className="stFRowCtl">
          <button type="button" className="stAddBtn" disabled={disabled} onClick={onAdd}>
            <Icon name="plus" size={14} /> Set {title.toLowerCase()}
          </button>
          <Issues pathKey={key} />
        </div>
      </div>
    );
  }

  const style = kind === 'array' ? arrayStyle(engine, shape) : null;
  const grouped = kind === 'object' || kind === 'map' || (kind === 'array' && style === 'cards');
  if (grouped) {
    const count = kind === 'array' ? (Array.isArray(value) ? value.length : 0) : kind === 'map' ? Object.keys(isObj(value) ? value : {}).length : null;
    return (
      <div className="stFRow wide" data-grouprow={key}>
        <Group
          pathKey={key}
          title={title}
          tooltip={words.lead}
          sub={words.lead}
          actions={technical ? <TechName name={name} path={path} /> : null}
          count={unset ? null : count}
          hint={missing ? 'Needed: not set yet' : unset ? 'Using the defaults' : undefined}
          onRemove={onRemove}
          flat={sole && !onRemove && kind !== 'array' && path.length <= 2}
          defaultOpen={
            missing
              ? true
              : collapsed || (unset && !sole)
                ? false
                : kind === 'array'
                  ? Array.isArray(value) && value.length <= 4
                  : sole || words.level === 'guided'
          }
        >
          {helpLine}
          <OwnerCtx.Provider value={name}>
            <Node schema={schema} value={value} path={path} onChange={onChange} disabled={disabled || readOnly} />
          </OwnerCtx.Provider>
        </Group>
      </div>
    );
  }

  const wide =
    kind === 'union' ||
    kind === 'json' ||
    kind === 'array' ||
    (kind === 'string' && (shape['x-ui']?.widget === 'textarea' || String(value ?? '').length > 60)) ||
    kind === 'secret';
  const deepIssues = kind === 'array' || kind === 'json';
  // a single control takes the label (clicking the name focuses it); a list, a choice of kinds or a fixed value is a group named by it instead
  const takesId = !['const', 'null', 'object', 'array', 'map', 'union'].includes(kind) && !(kind === 'string' && readXui(shape).widget === 'jsonpath');
  const labelId = `${inputId}-name`;
  return (
    <div className={`stFRow ${wide ? 'wide' : ''} ${readOnly ? 'ro' : ''} ${kind === 'boolean' ? 'toggle' : ''} ${missing ? 'missing' : ''}`} data-path={key}>
      <div className="stFLabel">
        <label htmlFor={takesId ? inputId : undefined} id={labelId} title={words.lead || undefined}>
          {title}
        </label>
        {tags}
        {missing && <span className="stFTag bad">required, not set</span>}
        {unsetOptional && hasDefault && <span className="stFDefault">Default</span>}
        {onRemove && !readOnly && (
          <button
            type="button"
            className="stFReset"
            disabled={disabled}
            aria-label={hasDefault ? `Reset ${title} to its default` : `Clear ${title}`}
            title={hasDefault ? 'Back to the default' : 'Take this setting out'}
            onClick={onRemove}
          >
            <Icon name="undo" size={14} />
            {hasDefault ? 'Reset' : 'Clear'}
          </button>
        )}
      </div>
      {rowHelp}
      <div className="stFRowCtl" role={takesId ? undefined : 'group'} aria-labelledby={takesId ? undefined : labelId}>
        <OwnerCtx.Provider value={name}>
          <Node
            schema={schema}
            value={value}
            path={path}
            onChange={onChange}
            disabled={disabled || readOnly}
            id={inputId}
            invalid={(ctx.exact.get(key) || []).some((i) => i.severity === 'error')}
          />
        </OwnerCtx.Provider>
        <Issues pathKey={key} deep={deepIssues} />
        <FieldNote path={path} value={value} />
      </div>
    </div>
  );
}

// ---- unions ----------------------------------------------------------------------------------

// A check on what is said is chosen by what it does ("Refuses tricks to change its instructions"), as Add names it, not by the schema's title
// ("Prompt-injection detector"); with technical names on, the schema's own.
const isCheckPath = (path) => path.length === 3 && path[0] === 'guardrails' && (path[1] === 'input' || path[1] === 'output') && typeof path[2] === 'number';

function UnionBody({ shape, value, path, onChange, disabled }) {
  const { engine, technical } = useForm();
  const branches = useMemo(() => engine.branchesOf(shape), [engine, shape]);
  const picked = engine.pickBranch(branches, value);
  // The kind is clear when the value fits it, or carries its marker (`type: "http"`) with some required fields still missing: then
  // that kind's editor is shown with what is missing marked, instead of raw JSON.
  const fitsBranch = engine.fits(branches[picked], value) || matchesDiscriminator(engine, branches[picked], value);
  const labels = branches.map((b, i) => {
    const kind = engine.flatten(b).properties?.type?.const;
    return isCheckPath(path) && !technical && PLAIN_KIND[kind] ? PLAIN_KIND[kind] : engine.branchLabel(b, i);
  });
  const segmented = branches.length <= 4 && labels.join('').length <= 48;
  const choose = (index) => {
    if (index !== picked || !fitsBranch) onChange(carryOver(engine, value, branches[index], engine.defaultFor(branches[index])));
  };
  // not set yet: the choice of kinds, and nothing chosen (a single kind is simply drawn, with its defaults)
  if (value === undefined) {
    if (branches.length === 1) return <Node schema={branches[0]} value={engine.defaultFor(branches[0])} path={path} onChange={onChange} disabled={disabled} />;
    return (
      <div className="stFUnion">
        {segmented ? (
          <div className="stFSeg" role="group" aria-label="Kind">
            {labels.map((text, i) => (
              <button key={i} type="button" disabled={disabled} aria-pressed={false} onClick={() => choose(i)}>
                {text}
              </button>
            ))}
          </div>
        ) : (
          <SmartSelect
            className="stFInput small"
            disabled={disabled}
            ariaLabel="Kind"
            value=""
            placeholder="Choose…"
            options={labels.map((text, i) => ({ value: String(i), label: text }))}
            onChange={(v) => {
              if (v !== '') choose(Number(v));
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="stFUnion">
      {branches.length > 1 &&
        (segmented ? (
          <div className="stFSeg" role="group" aria-label="Kind">
            {labels.map((text, i) => (
              <button
                key={i}
                type="button"
                disabled={disabled}
                className={fitsBranch && i === picked ? 'on' : ''}
                aria-pressed={fitsBranch && i === picked}
                onClick={() => choose(i)}
              >
                {text}
              </button>
            ))}
          </div>
        ) : (
          <SmartSelect
            className="stFInput small"
            disabled={disabled}
            ariaLabel="Kind"
            value={fitsBranch ? String(picked) : ''}
            placeholder="Choose a kind…"
            options={labels.map((text, i) => ({ value: String(i), label: text }))}
            onChange={(v) => {
              if (v !== '') choose(Number(v));
            }}
          />
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
  const { engine, refOptions, goTo, markDelete, technical, store, channelTypes } = useForm();
  // StringList and MultiPick say what was deleted so the Undo bar can name it.
  const onChange = (next, meta) => {
    if (meta?.deleted) markDelete(meta.deleted);
    setValue(next);
  };
  const list = Array.isArray(value) ? value : [];
  const style = arrayStyle(engine, shape);
  const items = engine.flatten(shape.items);

  // Lists of actions and of rules read as steps wherever they occur (on-enter steps, fallbacks, what to do when a caller goes quiet…).
  if (isActionList(engine, shape)) return <ActionSteps shape={shape} value={list} path={path} onChange={setValue} disabled={disabled} label="the list" />;
  if (isRuleList(engine, shape)) return <EffectsEditor shape={shape} value={list} path={path} onChange={setValue} disabled={disabled} />;
  if (style === 'strings')
    return (
      <StringList values={list} onChange={onChange} disabled={disabled} placeholder={Array.isArray(items.examples) ? String(items.examples[0]) : undefined} />
    );
  if (style === 'checks') {
    // what a channel carries is limited by its kind: only what the kind can carry is offered, and a ticked value it cannot carry stays, marked, so it can be removed
    const limit = channelTypes ? modalityChoices(store.get(), channelTypes, path, list) : null;
    const options = items.enum.map(String).filter((o) => !limit || limit.allowed.includes(o) || limit.extra.includes(o));
    const labels = enumLabels(String(path[path.length - 1]), items.enum.map(String), { technical });
    const marked = limit ? Object.fromEntries(limit.extra.map((o) => [o, `${labels[o] || o} (this kind of channel can't carry it)`])) : {};
    return <CheckGroup options={options} values={list} onChange={onChange} disabled={disabled} labels={{ ...labels, ...marked }} />;
  }
  if (style === 'pick') {
    const name = items['x-ref'];
    const options = refOptions[name] || [];
    const [target, label] = REF_TARGET[name] || [];
    return (
      <>
        <MultiPick options={options} values={list} onChange={onChange} disabled={disabled} emptyText={`No ${REF_WORD[name] || name} chosen`} />
        {options.length === 0 && list.length === 0 && target && (
          <p className="stFEmpty">
            There are no {REF_WORD[name] || name} yet. Add some in{' '}
            <button type="button" className="stLink" onClick={() => goTo(target)}>
              {label}
            </button>{' '}
            first.
          </p>
        )}
      </>
    );
  }
  return <CardList shape={shape} items={items} list={list} path={path} onChange={setValue} disabled={disabled} />;
}

// One card of a list. It is memoised: an edit in another card gives it exactly the props it had (the list's items keep their identity, see
// shareStructure, and the handlers are stable), so it does not render. It reads the few things it needs from the config itself.
const sameCard = (a, b) => keyOf(a.basePath) === keyOf(b.basePath) && Object.keys(a).every((k) => k === 'basePath' || a[k] === b[k]);

const CardItem = React.memo(function CardItem({
  item,
  index,
  count,
  basePath,
  itemSchema,
  disabled,
  named,
  collection,
  fresh,
  roomy = true,
  onItemChange,
  onRemoveItem,
  onMoveItem,
}) {
  const { title, hint: summary } = summarize(item, index);
  const wantsLanguages = collection === 'messages' && isObj(item) && isObj(item.text);
  const languages = useConfigSelect((c) => (wantsLanguages ? languageHint(item, c) : ''));
  const baseHint = wantsLanguages ? languages : summary;
  // a tool says which agents offer it (the data is in the config), so a long list can be read at a glance
  const usedBy = useConfigSelect((c) => (collection === 'tools' && isObj(item) && item.id ? agentsUsingTool(c, item.id) : null));
  const hint = usedBy ? [baseHint, usedByText(usedBy)].filter(Boolean).join(' · ') : baseHint;
  const path = useMemo(() => [...basePath, index], [basePath, index]);
  return (
    <Group
      pathKey={keyOf(path)}
      title={title}
      hint={hint}
      defaultOpen={fresh || (roomy && (basePath.length > 1 ? index === 0 && count <= 3 : count <= 3))}
      onRemove={disabled ? null : () => onRemoveItem(index)}
      actions={
        !disabled && count > 1 ? (
          <>
            <button type="button" className="stIconBtn" aria-label={`Move ${title} up`} disabled={index === 0} onClick={() => onMoveItem(index, index - 1)}>
              <Icon name="chevronUp" size={14} />
            </button>
            <button
              type="button"
              className="stIconBtn"
              aria-label={`Move ${title} down`}
              disabled={index === count - 1}
              onClick={() => onMoveItem(index, index + 1)}
            >
              <Icon name="chevronDown" size={14} />
            </button>
          </>
        ) : null
      }
    >
      {named && isObj(item) && typeof item.id === 'string' && item.id && <UsedBy collection={named} id={item.id} />}
      <Node schema={itemSchema} value={item} path={path} onChange={onItemChange} disabled={disabled} />
    </Group>
  );
}, sameCard);

// The question about a recording notice, asked in the form: it writes through the form's own undoable change.
function NoticeOffer({ onDone }) {
  const ctx = useForm();
  const has = useConfigSelect((c) => !!(isObj(c?.persona?.disclosures) && c.persona.disclosures.recording_notice));
  if (has) return null;
  return (
    <RecordingNoticeOffer
      onDone={onDone}
      onAdd={(text) =>
        ctx.applyConfig(
          setRecordingNotice(ctx.store.get(), text),
          'Added a recording notice. You can change it under Personality and rules › What callers are told.',
        )
      }
    />
  );
}

function CardList({ shape, items, list, path, onChange, disabled }) {
  const ctx = useForm();
  const { engine, markDelete, requestDelete } = ctx;
  const collection = collectionAt(path);
  const unusedIds = useConfigSelect((c) => (collection === 'tools' ? unusedTools(c) : []));
  const unused = useMemo(() => new Set(unusedIds), [unusedIds]);
  const named = collection && COLLECTIONS[collection].kind === 'list' ? collection : null;
  const [fresh, setFresh] = useState(-1);
  const [offerNotice, setOfferNotice] = useState(false);
  const [find, setFind] = useState({ query: '', kind: '', unusedOnly: false });
  const isUnion = engine.kindOf(items) === 'union';
  const branches = isUnion ? engine.branchesOf(items) : null;
  const lastKey = path[path.length - 1];
  const base = singular(lastKey === 'items' ? path[path.length - 2] : lastKey);
  const word = ADD_WORDS[lastKey] || base.replace(/_/g, ' '); // what "Add …" calls one of them
  const ownIds = list
    .filter(isObj)
    .map((item) => item.id)
    .filter((id) => typeof id === 'string');
  // a list of guardrails shares its ids with the other two (takenIdsAt), so a new check is named clear of all three
  const takenIds = path[0] === 'guardrails' ? [...new Set([...ownIds, ...takenIdsAt(ctx.store.get(), path)])] : ownIds;
  // Some lists are added to by choosing a job from cards (tools, channels, guardrails), not a kind from a drop-down.
  const pickerKey =
    collection === 'tools'
      ? 'tools'
      : named === 'channels'
        ? 'channels'
        : path.length === 2 && path[0] === 'guardrails' && ['input', 'output'].includes(path[1])
          ? path.join('.')
          : lastKey === 'pronunciation'
            ? 'pronunciation'
            : null;
  const picker = pickerKey
    ? pickerFor(pickerKey, { engine, branches, takenIds, botId: ctx.store.get()?.meta?.id || '', channelTypes: ctx.channelTypes })
    : null;

  const make = (branch) => {
    const made = engine.defaultFor(branch || shape.items);
    if (isObj(made) && 'id' in made && made.id === '') made.id = uniqueId(takenIds, base);
    return made;
  };
  const add = (branch) => {
    onChange([...list, make(branch)]);
    setFresh(list.length);
  };
  const move = (from, to) => {
    if (to < 0 || to >= list.length) return;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };
  // handlers that never change identity but always act on the latest list: so a card that did not change gets the same props and skips rendering
  const itemChange = useKeyedHandlers((index, v) => onChange(list.map((x, i) => (i === index ? v : x))));
  const removeItem = useStableCallback((index) => {
    const item = list[index];
    const { title } = summarize(item, index);
    const remove = () => {
      markDelete(title);
      onChange(list.filter((_, i) => i !== index));
    };
    if (named && isObj(item) && typeof item.id === 'string') requestDelete(named, item.id, remove);
    else remove();
  });
  const moveItem = useStableCallback(move);

  // A long list of tools needs finding things in: search, a filter by kind, and "only the ones no agent uses".
  const searchable = collection === 'tools' && list.length > 6;
  const filtering = searchable && (!!find.query.trim() || !!find.kind || find.unusedOnly);
  const kinds = useMemo(() => (searchable ? toolKindCounts(list) : []), [searchable, list]);
  const shown = list.map((item, index) => index).filter((index) => !filtering || toolMatches(list[index], find, unused));
  const roomyCards = useMemo(() => cardsThatMayOpen(list), [list]);

  return (
    <div className="stFCards">
      {searchable && (
        <div className="stFFind" role="search" aria-label="Search the tools">
          <input
            className="stFInput small"
            type="search"
            value={find.query}
            placeholder="Find a tool by name or what it does"
            aria-label="Find a tool"
            onChange={(event) => setFind((old) => ({ ...old, query: event.target.value }))}
          />
          <div className="stFFindKinds" role="group" aria-label="Kind of tool">
            <button
              type="button"
              className={find.kind === '' ? 'on' : ''}
              aria-pressed={find.kind === ''}
              onClick={() => setFind((old) => ({ ...old, kind: '' }))}
            >
              All {list.length}
            </button>
            {kinds.map((k) => (
              <button
                type="button"
                key={k.kind}
                className={find.kind === k.kind ? 'on' : ''}
                aria-pressed={find.kind === k.kind}
                onClick={() => setFind((old) => ({ ...old, kind: old.kind === k.kind ? '' : k.kind }))}
              >
                {k.label} {k.count}
              </button>
            ))}
            <label className="stFFindUnused">
              <input type="checkbox" checked={find.unusedOnly} onChange={(event) => setFind((old) => ({ ...old, unusedOnly: event.target.checked }))} /> Not
              used by any agent ({unusedIds.length})
            </label>
          </div>
          {filtering && (
            <small className="stMuted" role="status">
              Showing {shown.length} of {list.length}.{shown.length === 0 && ' Nothing matches: clear the search or a filter.'}
            </small>
          )}
        </div>
      )}
      {shown.map((index) => (
        <CardItem
          key={index}
          item={list[index]}
          index={index}
          count={list.length}
          basePath={path}
          itemSchema={shape.items}
          disabled={disabled}
          named={named}
          collection={collection}
          fresh={index === fresh}
          roomy={roomyCards[index]}
          onItemChange={itemChange(index)}
          onRemoveItem={removeItem}
          onMoveItem={moveItem}
        />
      ))}
      {/* an empty list is just its "Add" (a line saying it is empty would only repeat that) */}
      {list.length === 0 && (collection === 'tools' || disabled) && (
        <p className="stFEmpty">
          {collection === 'tools'
            ? 'No tools yet. Handing a caller over to another agent isn’t a tool: it is set up under the agent’s Handoffs.'
            : 'Nothing here yet.'}
        </p>
      )}
      {picker ? (
        <AddPicker
          what={WHAT[pickerKey]}
          intro={INTRO[pickerKey]}
          options={picker}
          disabled={disabled}
          onPick={(option, made) => {
            onChange([...list, made]);
            setFresh(list.length);
            if (pickerKey === 'channels' && (option.type === 'sip_voice' || option.type === 'web_voice')) setOfferNotice(true);
          }}
        />
      ) : isUnion ? (
        <SmartSelect
          action
          className="stFInput small"
          disabled={disabled}
          ariaLabel={`Add ${word}`}
          placeholder={`Add ${word}…`}
          options={branches.map((b, i) => {
            const kind = engine.flatten(b).properties?.type?.const;
            const missing = collection === 'tools' && UNSUPPORTED_KINDS[kind];
            return { value: String(i), label: `${engine.branchLabel(b, i)}${missing ? ' (not available yet)' : ''}` };
          })}
          onChange={(v) => {
            if (v !== '') add(branches[Number(v)]);
          }}
        />
      ) : (
        <button type="button" className="stAddBtn" disabled={disabled} onClick={() => add()}>
          <Icon name="plus" size={14} /> Add {word}
        </button>
      )}
      {offerNotice && !disabled && <NoticeOffer onDone={() => setOfferNotice(false)} />}
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
    if (taken.has(key)) {
      setError(`“${key}” already exists.`);
      return;
    }
    if (pattern && !new RegExp(pattern).test(key)) {
      setError(`Use the form ${pattern}`);
      return;
    }
    setError('');
    setText('');
    onAdd(key);
  };
  if (options) {
    const left = options.filter((o) => !taken.has(o));
    return (
      <SmartSelect
        action
        className="stFInput small"
        disabled={disabled || left.length === 0}
        ariaLabel={`Add ${label}`}
        placeholder={left.length ? `Add ${label}…` : `No more ${label}s to add`}
        options={left}
        onChange={(o) => {
          if (o) onAdd(o);
        }}
      />
    );
  }
  return (
    <div className="stFAddKey">
      <input
        className="stFInput small"
        type="text"
        spellCheck={false}
        value={text}
        disabled={disabled}
        placeholder={`New ${label} name`}
        aria-label={`New ${label} name`}
        onChange={(event) => {
          setText(event.target.value);
          setError('');
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(text);
          }
        }}
      />
      <button type="button" className="stAddBtn" disabled={disabled || !text.trim()} onClick={() => commit(text)}>
        <Icon name="plus" size={14} /> Add
      </button>
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
      setError(`Use the form ${pattern}`);
      return;
    }
    setError('');
    onRename(key);
  };
  return (
    <div className="stFKeyBox">
      <input
        className="stFInput mono"
        type="text"
        spellCheck={false}
        value={text}
        disabled={disabled}
        aria-label="Name"
        aria-invalid={!!error || undefined}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.target.blur();
          }
        }}
      />
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
    if (named) {
      renameDirect(named, from, to);
      return;
    }
    const out = {};
    Object.keys(obj).forEach((k) => {
      out[k === from ? to : k] = obj[k];
    });
    onChange(out);
  };
  const setEntry = (k, v) => onChange({ ...obj, [k]: v });
  const removeEntry = (k) => {
    const remove = () => {
      markDelete(k);
      onChange(omit(obj, k));
    };
    if (named) requestDelete(named, k, remove);
    else remove();
  };
  const add = (key) => onChange({ ...obj, [key]: valueSchema ? engine.defaultFor(valueSchema) : '' });
  const word = ADD_WORDS[String(path[path.length - 1])] || singular(String(path[path.length - 1])).replace(/_/g, ' ');
  const madeKey = fixedKeys ? null : uniqueId(keys, word);
  const autoKey = madeKey && (!pattern || new RegExp(pattern).test(madeKey)) ? madeKey : null;

  return (
    <div className="stFMap">
      {keys.map((key) => {
        const entryPath = [...path, key];
        const pk = keyOf(entryPath);
        const control = valueSchema ? (
          <Node schema={valueSchema} value={obj[key]} path={entryPath} onChange={(v) => setEntry(key, v)} disabled={disabled} />
        ) : (
          <FreeValue value={obj[key]} onChange={(v) => setEntry(key, v)} disabled={disabled} />
        );
        if (complex) {
          return (
            <Group
              key={key}
              pathKey={pk}
              title={key}
              hint={
                named === 'state_vars' && isObj(obj[key]) && obj[key].sensitive === true ? (
                  <span className="stShield">
                    <ShieldIcon /> sensitive
                  </span>
                ) : undefined
              }
              defaultOpen={keys.length <= 3}
              onRemove={disabled ? null : () => removeEntry(key)}
            >
              {named && <UsedBy collection={named} id={key} />}
              {!fixedKeys && (
                <div className="stFRow">
                  <div className="stFLabel">
                    <label>Name</label>
                  </div>
                  <KeyInput value={key} taken={keys.filter((k) => k !== key)} pattern={pattern} onRename={(to) => rename(key, to)} disabled={disabled} />
                </div>
              )}
              {control}
            </Group>
          );
        }
        return (
          <div className="stFMapRow" key={key} data-path={pk}>
            {fixedKeys ? (
              <code className="stFMapKey">{key}</code>
            ) : (
              <KeyInput value={key} taken={keys.filter((k) => k !== key)} pattern={pattern} onRename={(to) => rename(key, to)} disabled={disabled} />
            )}
            <div className="stFMapValue">
              {control}
              <Issues pathKey={pk} deep />
            </div>
            <button
              type="button"
              className="stIconBtn danger"
              title="Delete this entry"
              aria-label={`Delete ${key}`}
              disabled={disabled}
              onClick={() => removeEntry(key)}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        );
      })}
      {keys.length === 0 && disabled && <p className="stFEmpty">Nothing here yet.</p>}
      {autoKey ? (
        // one click adds one, with a name made up for it that can be changed in place (no name to type before it exists)
        <button type="button" className="stAddBtn" disabled={disabled} onClick={() => add(autoKey)}>
          <Icon name="plus" size={14} /> Add {word}
        </button>
      ) : (
        <AddKey
          existing={keys}
          pattern={pattern}
          options={fixedKeys ? refOptions[refName] || [] : null}
          disabled={disabled}
          label={fixedKeys ? (REF_WORD[refName] || 'entry').replace(/s$/, '') : word}
          onAdd={add}
        />
      )}
    </div>
  );
}
