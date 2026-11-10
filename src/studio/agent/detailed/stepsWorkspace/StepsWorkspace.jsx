import React, { Fragment, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import Select from '../../../../ui/Select.tsx';
import { Input, TextArea } from '../../../../ui/Input.tsx';
import { DragHandle, SortableItem, SortableList } from '../../../../ui/Sortable.jsx';
import { describeAction } from '../../../form/effects.js';
import { describeCondition } from '../../../form/promptPreview.js';
import { DropdownMenu } from 'radix-ui';
import { afterMenu, keepEscape } from '../../../../ui/layer.ts';
import { setPath } from '../schemaFacts.js';
import { makeViewStore } from '../workspaceView.js';
import { reveal } from '../workspaceKit.jsx';
import {
  GUIDED_START,
  SAY_START,
  STARTERS,
  addEnding,
  addGuided,
  addNewSubagent,
  addPass,
  addWayBack,
  applyStarter,
  applyWords,
  condition,
  countSteps,
  enterPath,
  insertAction,
  insertPhoto,
  isStarterText,
  lanesOf,
  lanesUsingTool,
  moveStep,
  numbered,
  parseWords,
  problemsOf,
  removePass,
  removeStep,
  setGoodbye,
  setGuided,
  setPassWhen,
  speechText,
  strandedLanes,
  wordsOf,
} from './stepsModel.js';
import './stepsWorkspace.css';

const FormEditor = lazy(() => import('../../../form/FormEditor.jsx'));

// Build › Steps (design: canvas "Build steps section"): the call, step by step, for any agent. Each subagent is a lane;
// each step reads as a sentence and opens its editor in place. "Every time" steps run as written (what the agent does as
// it takes over, and after a form); "Guided" steps are what it is told to do, in its own words. Every change is written
// where the agent already keeps it (stepsModel.js), so Workflow, Subagents and JSON show the same call. A second view
// takes the whole call as numbered lines and turns them into steps, shown before anything changes.

const VIEWS = makeViewStore('weave_steps_view', 'steps');
const list = (v) => (Array.isArray(v) ? v : []);
const clip = (t, n = 90) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const initialsOf = (name) =>
  (name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// each kind of step: its icon and tile colour
// a parsed line's kind ("pass" draws as a decision)
const drawn = (kind) => KIND[kind === 'pass' || kind === 'back' ? 'decide' : kind] || KIND.guided;
const KIND = {
  greet: { icon: 'chat', tone: 'every' },
  say: { icon: 'chat', tone: 'every' },
  form: { icon: 'list', tone: 'show' },
  photo: { icon: 'camera', tone: 'show' },
  check: { icon: 'scan', tone: 'show' },
  lookup: { icon: 'search', tone: 'show' },
  message: { icon: 'mail', tone: 'show' },
  person: { icon: 'user', tone: 'move' },
  pass: { icon: 'subagent', tone: 'move' },
  end: { icon: 'endCall', tone: 'plain' },
  guided: { icon: 'pencil', tone: 'guided' },
  decide: { icon: 'branch', tone: 'move' },
  other: { icon: 'bolt', tone: 'plain' },
};

// ---------------------------------------------------------------- what a step says
function StepWords({ step }) {
  const a = step.action;
  const P = ({ children }) => <span className="bsPart">{children}</span>;
  switch (step.kind) {
    case 'greet':
      return (
        <>
          Says the greeting <P>“{clip(step.text, 120)}”</P>
        </>
      );
    case 'say':
      if (a?.type === 'generate')
        return (
          <>
            Says, in its own words, <P>{clip(String(a.instructions || 'what you describe'), 110)}</P>
          </>
        );
      return speechText(a?.text) ? (
        <>
          Say <P>“{clip(speechText(a.text), 140)}”</P>
        </>
      ) : (
        <>
          Say the message <P>{a?.text?.message || 'not chosen yet'}</P>
        </>
      );
    case 'form':
      return (
        <>
          Show the form <P>{step.form?.title || a?.form || 'not chosen yet'}</P>
        </>
      );
    case 'lookup':
      return (
        <>
          Look up <P>{a?.path || 'something'}</P> on <P>{a?.connection || 'a system'}</P>
        </>
      );
    case 'message':
      return (
        <>
          Send the message <P>{a?.notification || 'not chosen yet'}</P>
        </>
      );
    case 'person':
      return (
        <>
          Put them through to a person <P>{a?.transfer || ''}</P>
        </>
      );
    case 'photo':
      return (
        <>
          {a?.kind === 'camera' ? 'Check them on camera' : 'Ask for a photo'}
          {a?.prompt ? (
            <>
              : <P>“{clip(a.prompt, 110)}”</P>
            </>
          ) : null}
        </>
      );
    case 'guided':
      return <P>{step.text || 'Describe what the agent should do.'}</P>;
    case 'decide':
      return <>Decide where they go</>;
    case 'end': {
      // the end-the-call tool's goodbye, or an end-the-call action's own line (in what it does as it takes over, or a form)
      const bye = step.section === 'end' ? step.text : speechText(a?.say);
      return bye ? (
        <>
          End with <P>“{clip(bye, 120)}”</P>
        </>
      ) : (
        <>End the call</>
      );
    }
    default: {
      const { when: _when, ...rest } = a || {};
      return <>{describeAction(rest)}</>;
    }
  }
}

// the grey line under a step: when it only runs, what it keeps, what a form holds
function StepSub({ step }) {
  const a = step.action;
  const bits = [];
  if (step.kind === 'greet') bits.push('On every way in. It is set on Agent.');
  if (step.kind === 'form' && step.form) {
    const fields = list(step.form.fields).length;
    bits.push(`${plural(fields, 'field')}${step.children?.length ? '; its steps follow' : ''}`);
  }
  if (step.kind === 'lookup' && a?.to_state && typeof a.to_state === 'object') bits.push(`Keeps the answer as ${Object.keys(a.to_state).join(', ')}`);
  if (step.kind === 'end' && step.section === 'end') bits.push('When they have nothing more');
  if (a?.when) bits.push(`Only when ${describeCondition(a.when)}`);
  if (step.hiddenChildren) bits.push(`${plural(step.hiddenChildren, 'step')} that only keep values are left out`);
  return bits.length ? <span className="bsSub">{bits.join(' · ')}</span> : null;
}

// ---------------------------------------------------------------- one step's editor, in place
function StepEditor({ step, lane, lanes, ctx, onDone, onRemove }) {
  const { config } = ctx;
  const a = step.action;
  const goPart = ctx.goPart || (() => {});
  const fullEditor = (
    <Suspense fallback={null}>
      <div className="dtForm bsFull">
        <FormEditor editor={ctx.editor} itemPath={step.path} subtree embedded />
      </div>
    </Suspense>
  );
  let body;
  if (step.kind === 'greet')
    body = (
      <p className="bsNote">
        The greeting is said on every way in, so it is set in one place, on Agent.{' '}
        <button type="button" className="stLink" onClick={() => goPart('agent')}>
          Change it on Agent
        </button>
      </p>
    );
  else if (step.kind === 'guided')
    body = (
      <label className="bsField">
        <span>What the agent should do</span>
        <TextArea rows={3} autoFocus value={step.text} onFocus={selectStarter} onChange={(event) => ctx.set(setGuided(config, step, event.target.value))} />
        <small>The agent reads it as step {lane.steps.filter((s) => s.kind === 'guided').indexOf(step) + 1} of its own and follows it in its own words.</small>
      </label>
    );
  else if (step.kind === 'say' && typeof a?.text === 'string')
    body = (
      <>
        <label className="bsField">
          <span>The line, word for word</span>
          <TextArea
            rows={2}
            autoFocus
            value={a.text}
            onFocus={selectStarter}
            onChange={(event) => ctx.set(setPathOf(config, [...step.path, 'text'], event.target.value))}
          />
        </label>
        <details className="bsMore">
          <summary>All its settings</summary>
          {fullEditor}
        </details>
      </>
    );
  else if (step.kind === 'form')
    body = (
      <>
        <label className="bsField">
          <span>The form</span>
          <Select value={a?.form || ''} onChange={(event) => ctx.set(setPathOf(config, [...step.path, 'form'], event.target.value))}>
            {!step.form && <option value={a?.form || ''}>{a?.form ? `${a.form} (not there any more)` : 'Choose a form'}</option>}
            {list(config.forms)
              .filter((f) => f && f.id)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title || f.id}
                </option>
              ))}
          </Select>
          <small>
            Its fields and what follows it are set with the form.{' '}
            {a?.form && step.form && (
              <button type="button" className="stLink" onClick={() => goPart('connections', { item: `forms:${a.form}` })}>
                Open the form
              </button>
            )}
          </small>
        </label>
        <details className="bsMore">
          <summary>All its settings</summary>
          {fullEditor}
        </details>
      </>
    );
  else if (step.kind === 'decide') body = <DecideEditor lane={lane} lanes={lanes} ctx={ctx} step={step} />;
  else if (step.kind === 'end' && step.section === 'end')
    body = (
      <label className="bsField">
        <span>The goodbye</span>
        <TextArea rows={2} autoFocus value={step.text} onChange={(event) => ctx.set(setGoodbye(config, step.toolId, event.target.value))} />
        {lanesUsingTool(config, step.toolId) > 1 && (
          <small>Every subagent that ends calls says this goodbye ({plural(lanesUsingTool(config, step.toolId), 'subagent')}).</small>
        )}
      </label>
    );
  else body = fullEditor;
  return (
    <div className="bsEditor">
      {body}
      <div className="bsEditorFoot">
        <span className="bsSaved">
          <Icon name="check" size={14} />
          Changes go {whereSaved(step, lane)} as you type
        </span>
        <span className="bsGrow" />
        {onRemove && (
          <Button type="button" variant="quiet" size="small" className="bsRemove" onClick={onRemove}>
            Remove step
          </Button>
        )}
        <Button type="button" variant="primary" size="small" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

const setPathOf = (config, path, value) => setPath(config, path, value);
// a new step's example words are selected, so typing replaces them
const selectStarter = (event) => {
  if (isStarterText(event.target.value)) event.target.select();
};

// where a step is kept, in words (the foot of its editor)
function whereSaved(step, lane) {
  if (step.section === 'greet') return 'to Agent';
  if (step.section === 'form') return 'into the form’s steps';
  if (step.section === 'rule') return `into ${lane.name}’s instructions`;
  if (step.section === 'decide') return `into ${lane.name}’s hand-overs`;
  if (step.section === 'end') return 'into its end-the-call tool';
  return `into what ${lane.name} does as it takes over`;
}

// where a lane passes callers: each hand-over with when, and the ways to add one
function DecideEditor({ lane, lanes, ctx, step }) {
  const { config } = ctx;
  const branches = step?.branches || [];
  // the subagents it doesn't pass callers to yet (one hand-over per subagent)
  const others = lanes.filter((l) => l.key !== lane.key && !branches.some((b) => b.kind === 'pass' && b.to === l.key));
  const [picked, setTo] = useState('');
  const to = others.some((l) => l.key === picked) ? picked : others[0]?.key || '';
  const [name, setName] = useState('');
  const canGoBack = lane.first || branches.some((b) => b.kind === 'back' || (b.kind === 'pass' && b.to === lanes[0]?.key));
  return (
    <div className="bsDecide">
      {branches.length === 0 && <p className="bsNote">{lane.name} doesn’t pass callers on yet.</p>}
      {branches.map((b, i) => (
        <div key={`${b.kind}-${b.handoff ?? b.toolId}-${i}`} className="bsBranch">
          <span className="bsBranchTo">
            <Icon name={b.kind === 'person' ? 'user' : b.kind === 'back' ? 'undo' : 'subagent'} size={14} />
            {b.kind === 'back' ? `Back to ${b.toName}` : b.kind === 'person' ? 'A person' : b.toName}
          </span>
          {b.kind === 'pass' ? (
            <>
              <Input
                aria-label={`When to pass callers to ${b.toName}`}
                value={b.when}
                placeholder="When, in a few words: “They want an appointment.”"
                onChange={(event) => ctx.set(setPassWhen(config, lane.key, b.handoff, event.target.value))}
              />
              <Button type="button" variant="quiet" size="small" onClick={() => ctx.set(removePass(config, lane.key, b.handoff))}>
                Remove<span className="srOnly"> the hand-over to {b.toName}</span>
              </Button>
            </>
          ) : (
            <span className="bsBranchWhen">
              {b.kind === 'back' ? 'When their request is done, or they need something else.' : condition(b.when) || 'When the agent judges it right.'}
            </span>
          )}
        </div>
      ))}
      <div className="bsAddRow">
        {others.length > 0 && (
          <>
            <Select aria-label="Pass callers to" value={to} onChange={(event) => setTo(event.target.value)}>
              {others.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.name}
                </option>
              ))}
            </Select>
            <Button type="button" variant="secondary" size="small" disabled={!to} onClick={() => ctx.set(addPass(config, lane.key, to))}>
              <Icon name="plus" size={14} />
              Pass to this subagent
            </Button>
          </>
        )}
      </div>
      <div className="bsAddRow">
        <Input aria-label="A new subagent’s name" value={name} placeholder="A new subagent, e.g. Billing" onChange={(event) => setName(event.target.value)} />
        <Button
          type="button"
          variant="secondary"
          size="small"
          disabled={!name.trim()}
          onClick={() => {
            ctx.set(addNewSubagent(config, lane.key, name.trim()).config);
            setName('');
          }}
        >
          <Icon name="plus" size={14} />
          Make it and pass to it
        </Button>
      </div>
      <p className="bsNote">
        {!canGoBack && (
          <>
            <button type="button" className="stLink" onClick={() => ctx.set(addWayBack(config, lane.key))}>
              Add a way back to {lanes[0]?.name}
            </button>
            {' · '}
          </>
        )}
        A person is set on Tools.{' '}
        <button type="button" className="stLink" onClick={() => (ctx.goPart ? ctx.goPart('tools') : null)}>
          Pass to a person
        </button>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- adding a step
const KINDS_TO_ADD = [
  { group: 'Talk', id: 'say', icon: 'chat', name: 'Say something', help: 'A fixed line, word for word.', every: true },
  { group: 'Talk', id: 'ask', icon: 'help', name: 'Ask for something', help: 'One thing it needs from them; it asks in its own words.', every: false },
  {
    group: 'Talk',
    id: 'guided',
    icon: 'pencil',
    name: 'Let the agent handle it',
    help: 'Describe it in your words; the agent does it its own way.',
    every: false,
  },
  {
    group: 'Show on screen',
    id: 'form',
    icon: 'list',
    name: 'Show a form',
    help: 'Several details at once; on a call the agent asks for them one by one.',
    every: true,
  },
  { group: 'Show on screen', id: 'photo', icon: 'camera', name: 'Ask for a photo', help: 'A card or a document, from a file or the camera.', every: true },
  { group: 'Do', id: 'lookup', icon: 'search', name: 'Look something up', help: 'Ask one of its systems and keep the answer for later steps.', every: true },
  { group: 'Do', id: 'yes', icon: 'check', name: 'Do something after a yes', help: 'Read it back, wait for a clear yes, then act.', every: false },
  { group: 'Do', id: 'message', icon: 'mail', name: 'Send a message', help: 'An SMS or e-mail from its messages.', every: true },
  {
    group: 'Move the call',
    id: 'decide',
    icon: 'branch',
    name: 'Decide where they go',
    help: 'Pass callers to a subagent when it fits, or to a person.',
    every: false,
  },
  { group: 'Move the call', id: 'end', icon: 'endCall', name: 'End the call', help: 'With a goodbye line.', every: false },
];

// which kinds this place can take (hide, don't grey out)
function kindsHere(config, lane, point) {
  const httpConnections = Object.entries(config.connections || {}).filter(([, c]) => c && c.type === 'http');
  const hasEnd = lane.steps.some((s) => s.kind === 'end');
  return KINDS_TO_ADD.filter((k) => {
    // a form's steps run as written after it is sent: no guided steps, decisions or ending there
    if (point.inForm && !['say', 'photo', 'lookup', 'message'].includes(k.id)) return false;
    if (k.id === 'photo') return !!point.inForm;
    if (k.id === 'form') return list(config.forms).some((f) => f && f.id) && !point.inForm;
    if (k.id === 'lookup') return httpConnections.length > 0;
    if (k.id === 'message') return list(config.notifications).some((n) => n && n.id);
    if (k.id === 'end') return !hasEnd;
    return true;
  });
}

// the step a kind adds, at a place -> { config, open } (open: the new step's key, to open its editor)
function addKind(config, lane, point, kind) {
  const at = point.listPath;
  const newKey = (path, i) => [...path, i].join('.');
  const place = (path, index) => Math.min(index ?? list(getIn(config, path)).length, list(getIn(config, path)).length);
  if (kind === 'say') return { config: insertAction(config, at, point.index, { type: 'say', text: SAY_START }), open: newKey(at, place(at, point.index)) };
  if (kind === 'form') {
    const form = list(config.forms).find((f) => f && f.id);
    return { config: insertAction(config, at, point.index, { type: 'send_form', form: form.id }), open: newKey(at, place(at, point.index)) };
  }
  if (kind === 'photo') return { config: insertPhoto(config, at, point.index), open: newKey(at, place(at, point.index)) };
  if (kind === 'lookup') {
    const [name] = Object.entries(config.connections || {}).find(([, c]) => c && c.type === 'http');
    return {
      config: insertAction(config, at, point.index, { type: 'http', connection: name, method: 'GET', path: '/' }),
      open: newKey(at, place(at, point.index)),
    };
  }
  if (kind === 'message') {
    const n = list(config.notifications).find((x) => x && x.id);
    return { config: insertAction(config, at, point.index, { type: 'notify', notification: n.id }), open: newKey(at, place(at, point.index)) };
  }
  if (kind === 'decide') return { config, open: `${lane.key}.decide` };
  if (kind === 'end') return { config: addEnding(config, lane.key), open: `${lane.key}.end` };
  // a guided step, at its place among the lane's guided steps
  const next = addGuided(config, lane.key, GUIDED_START[kind] || GUIDED_START.guided, point.guidedAt);
  const added = lanesOf(next)
    .find((l) => l.key === lane.key)
    ?.steps.filter((s) => s.kind === 'guided');
  const pos = Math.min(point.guidedAt ?? Infinity, (added?.length || 1) - 1);
  return { config: next, open: added?.[pos]?.key || null };
}
const getIn = (config, path) => path.reduce((v, k) => (v == null ? v : v[k]), config);

function AddStep({ lane, lanes, point, ctx, onAdded, onClose }) {
  const { config } = ctx;
  const [said, setSaid] = useState('');
  const [preview, setPreview] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    reveal(ref.current);
    ref.current?.querySelector('input')?.focus();
  }, []);
  useEffect(() => {
    const key = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  const kinds = kindsHere(config, lane, point);
  const groups = [...new Set(kinds.map((k) => k.group))];
  const pick = (id) => {
    const made = addKind(config, lane, point, id);
    ctx.set(made.config);
    onAdded(made.open);
  };
  const understand = () => {
    const [p] = parseWords(config, said, { lane: lane.key });
    setPreview(p?.kind === 'keep' ? { ...p, note: `${lane.name} already takes this step every time.` } : p || null);
  };
  const addPreview = () => {
    if (!preview) return;
    let next = config;
    let open = null;
    if (preview.kind === 'guided') {
      next = addGuided(config, lane.key, preview.text, point.guidedAt);
      const g = lanesOf(next)
        .find((l) => l.key === lane.key)
        ?.steps.filter((s) => s.kind === 'guided');
      open = g?.[Math.min(point.guidedAt ?? Infinity, g.length - 1)]?.key || null;
    } else if (preview.kind === 'pass') {
      const to = lanes.find((l) => l.name === preview.to);
      if (to) next = addPass(config, lane.key, to.key, preview.when ? `${preview.when.charAt(0).toUpperCase()}${preview.when.slice(1)}.` : '');
      open = `${lane.key}.decide`;
    } else if (preview.kind === 'back') {
      next = addWayBack(config, lane.key);
      open = `${lane.key}.decide`;
    } else if (preview.kind === 'end') {
      next = addEnding(config, lane.key);
      open = `${lane.key}.end`;
    } else if (preview.kind === 'form' || preview.kind === 'message' || preview.kind === 'say') {
      const action =
        preview.kind === 'form'
          ? { type: 'send_form', form: preview.form }
          : preview.kind === 'message'
            ? { type: 'notify', notification: preview.message }
            : { type: 'say', text: preview.quote };
      next = insertAction(config, point.listPath, point.index, action);
      // its editor opens, as when the kind is picked
      const n = list(getIn(config, point.listPath)).length;
      open = [...point.listPath, Math.min(point.index ?? n, n)].join('.');
    }
    ctx.set(next);
    onAdded(open);
  };
  return (
    <div ref={ref} className="bsAdd" role="group" aria-label={`Add a step to ${lane.name}`}>
      <form
        className="bsAddSay"
        onSubmit={(event) => {
          event.preventDefault();
          if (said.trim()) understand();
        }}
      >
        <Icon name="sparkle" size={16} />
        <Input
          aria-label="Say what should happen"
          value={said}
          placeholder="Say what should happen, e.g. “check they are a patient before booking”"
          onChange={(event) => {
            setSaid(event.target.value);
            setPreview(null);
          }}
        />
        <Button type="submit" variant="primary" size="small" disabled={!said.trim()}>
          Make it a step
        </Button>
      </form>
      {preview && (
        <div className="bsPreview">
          <span className={`bsKind t-${drawn(preview.kind).tone}`}>
            <Icon name={drawn(preview.kind).icon} size={15} />
          </span>
          <span className="bsPreviewText">
            {preview.kind === 'pass'
              ? `Pass to ${preview.to}${preview.when ? ` when ${preview.when}` : ''}`
              : preview.kind === 'back'
                ? `Pass back to ${preview.to}`
                : preview.text}
            {preview.note && <small>{preview.note}</small>}
          </span>
          <Pill every={preview.every} />
          {!['greet', 'keep'].includes(preview.kind) && (
            <Button type="button" variant="secondary" size="small" onClick={addPreview}>
              Add it
            </Button>
          )}
        </div>
      )}
      <p className="bsAddHelp">Or pick a kind of step:</p>
      <div className="bsKinds">
        {groups.map((g) => (
          <div key={g} className="bsKindGroup" role="group" aria-label={g}>
            <p>{g}</p>
            {kinds
              .filter((k) => k.group === g)
              .map((k) => (
                <button key={k.id} type="button" className="bsKindBtn" onClick={() => pick(k.id)}>
                  <span
                    className={`bsKind t-${k.every ? (k.id === 'say' ? 'every' : 'show') : k.id === 'decide' ? 'move' : k.id === 'end' ? 'plain' : 'guided'}`}
                  >
                    <Icon name={k.icon} size={15} />
                  </span>
                  <span className="bsKindText">
                    <b>
                      {k.name}
                      {k.id !== 'decide' && k.id !== 'end' && <Pill every={k.every} />}
                    </b>
                    <small>{k.help}</small>
                  </span>
                </button>
              ))}
          </div>
        ))}
      </div>
      <div className="bsAddFoot">
        <span>Every-time steps run as written; guided steps come after them, in the agent’s own words.</span>
        <Button type="button" variant="quiet" size="small" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

const Pill = ({ every }) => <span className={`stPill ${every ? 'good' : 'bsGuided'}`}>{every ? 'Every time' : 'Guided'}</span>;

// a step's short menu (Radix): change, move, remove; it focuses its first choice, Escape gives focus back
function StepMenu({ number, choices }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="bsMenuBtn" aria-label={`More for ${number ? `step ${number}` : 'the new step'}`}>
          <Icon name="more" size={16} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="inSnoozeMenu rxLayer"
          aria-label={number ? `Step ${number}` : 'The new step'}
          align="end"
          sideOffset={4}
          collisionPadding={12}
          onEscapeKeyDown={keepEscape}
        >
          {choices.map(([words, pick]) => (
            <DropdownMenu.Item key={words} asChild onSelect={afterMenu(pick)}>
              <button type="button">{words}</button>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ---------------------------------------------------------------- one step's row
function StepRow({ step, number, lane, lanes, ctx, open, setOpen, problems, movable, onMove }) {
  const k = KIND[step.kind] || KIND.other;
  const isOpen = open === step.key;
  const canRemove = !['greet', 'decide'].includes(step.section);
  const remove = () => {
    const previous = ctx.config;
    ctx.set(removeStep(ctx.config, step));
    ctx.deleted?.(`Step ${number} removed`, previous);
    setOpen(null);
  };
  const menu = [
    [isOpen ? 'Close' : 'Change', () => setOpen(isOpen ? null : step.key)],
    ...(movable
      ? [
          ['Move up', () => onMove(-1)],
          ['Move down', () => onMove(1)],
        ]
      : []),
    ...(canRemove ? [['Remove', remove]] : []),
  ];
  return (
    <div className={`bsStep ${isOpen ? 'open' : ''} ${problems.some((p) => p.level === 'danger') ? 'bad' : ''}`} data-step={step.key}>
      <div className="bsRow">
        {movable ? <DragHandle label={`Drag step ${number}`} /> : <span className="bsNoDrag" aria-hidden="true" />}
        <span className="bsNum">{number}</span>
        <span className={`bsKind t-${k.tone}`} aria-hidden="true">
          <Icon name={k.icon} size={15} />
        </span>
        <button type="button" className="bsWords" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : step.key)}>
          <span className="bsSay">
            <StepWords step={step} />
          </span>
          <StepSub step={step} />
          {step.kind === 'decide' && (
            <span className="bsBranches">
              {step.branches.map((b, i) => (
                <span key={i} className="bsBranchLine">
                  {b.kind === 'back' ? 'When they need something else' : b.when ? `If ${condition(b.when)}` : 'When it fits'}
                  <Icon name="arrowRight" size={13} />
                  {b.kind === 'person' ? 'a person' : b.kind === 'back' ? `back to ${b.toName}` : <span className="bsPart">{b.toName}</span>}
                </span>
              ))}
            </span>
          )}
        </button>
        {step.kind !== 'decide' && <Pill every={step.every} />}
        {step.kind === 'decide' && <Pill every={false} />}
        <StepMenu number={number} choices={menu} />
      </div>
      {problems.map((p, i) => (
        <div key={i} className={`bsProblem ${p.level}`}>
          <Icon name={p.level === 'danger' ? 'alert' : 'info'} size={14} />
          <span>{p.text}</span>
          {p.fix === 'edit' && (
            <button type="button" className="stLink" onClick={() => setOpen(step.key)}>
              Fix it
            </button>
          )}
          {p.fix === 'up' && movable && (
            <button type="button" className="stLink" onClick={() => onMove(-1)}>
              Move it up
            </button>
          )}
          {p.fix === 'media' && ctx.goPart && (
            <button type="button" className="stLink" onClick={() => ctx.goPart('media')}>
              Images &amp; Videos
            </button>
          )}
        </div>
      ))}
      {isOpen && (
        <StepEditor
          step={step}
          lane={lane}
          lanes={lanes}
          ctx={ctx}
          onDone={() => {
            // focus goes back to the step's words, which opened it
            setOpen(null);
            requestAnimationFrame(() => document.querySelector(`[data-step="${CSS.escape(step.key)}"] .bsWords`)?.focus());
          }}
          onRemove={canRemove ? remove : null}
        />
      )}
    </div>
  );
}

// the line between two steps that opens "add a step" there
function AddHere({ adding, here, onOpen, label }) {
  if (adding) return null;
  return (
    <button type="button" className="bsAddHere" data-add={`${here.lane}:${here.id}`} onClick={() => onOpen(here)}>
      <span className="bsAddLine" aria-hidden="true" />
      <span className="bsAddWord">
        <Icon name="plus" size={13} />
        {label || 'Add a step here'}
      </span>
      <span className="bsAddLine" aria-hidden="true" />
    </button>
  );
}

// ---------------------------------------------------------------- a lane
function Lane({ lane, lanes, ctx, numbers, open, setOpen, adding, setAdding, problems }) {
  const { config } = ctx;
  const enterSteps = lane.steps.filter((s) => s.section === 'enter');
  const guided = lane.steps.filter((s) => s.section === 'rule');
  const greet = lane.steps.find((s) => s.section === 'greet');
  const decide = lane.steps.find((s) => s.section === 'decide');
  const end = lane.steps.find((s) => s.section === 'end');
  const ePath = enterPath(config, lane.key);
  const stranded = strandedLanes(config).some((a) => a.id === lane.key);
  const addingHere = (id) => adding && adding.lane === lane.key && adding.id === id;
  const point = (id, p) => ({ ...p, id, lane: lane.key });
  const addAt = (id, p) =>
    addingHere(id) ? (
      <AddStep
        lane={lane}
        lanes={lanes}
        point={adding}
        ctx={ctx}
        onClose={() => {
          // focus goes back to the line that opened it
          const at = `${lane.key}:${adding.id}`;
          setAdding(null);
          requestAnimationFrame(() => document.querySelector(`[data-add="${CSS.escape(at)}"]`)?.focus());
        }}
        onAdded={(key) => {
          setAdding(null);
          if (key) setOpen(key);
        }}
      />
    ) : (
      <AddHere adding={!!adding} here={point(id, p)} onOpen={setAdding} label={p.label} />
    );
  const row = (step, movable = false, onMove = () => {}) => (
    <StepRow
      step={step}
      number={numbers.get(step.key)}
      lane={lane}
      lanes={lanes}
      ctx={ctx}
      open={open}
      setOpen={setOpen}
      problems={problems.get(step.key) || []}
      movable={movable}
      onMove={onMove}
    />
  );
  // a sortable list of steps of one kind (what it does as it takes over, a form's steps, its guided steps)
  const sortable = (steps, label, toPlace, render) => (
    <SortableList
      ids={steps.map((s) => s.key)}
      nameOf={(id) => `step ${numbers.get(id)}`}
      label={label}
      onMove={(from, to) => {
        setOpen(null);
        ctx.set(moveStep(config, steps[from], toPlace(steps, to)));
      }}
    >
      {steps.map((s, i) => (
        <SortableItem key={s.key} id={s.key} className="bsItem">
          {render(s, i)}
        </SortableItem>
      ))}
    </SortableList>
  );
  const byIndex = (steps, to) => steps[to].index;
  const byPosition = (_steps, to) => to;
  // Move up / Move down: past the next step shown (steps that only keep a value are skipped), the editor closed
  //   the keyboard stays with the moved step: its menu button at its new place (which: that kind of step in a lane)
  const moveBy = (steps, i, d, toPlace, which) => {
    if (!steps[i + d]) return;
    setOpen(null);
    const next = moveStep(config, steps[i], toPlace(steps, i + d));
    ctx.set(next);
    const moved = which(lanesOf(next).find((l) => l.key === lane.key))?.[i + d];
    if (moved) requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector(`[data-step="${CSS.escape(moved.key)}"] .bsMenuBtn`)?.focus()));
  };
  const enterOf = (l) => l?.steps.filter((s) => s.section === 'enter');
  const guidedOf = (l) => l?.steps.filter((s) => s.section === 'rule');
  const formStepsOf = (formIndex) => (l) => enterOf(l)?.find((s) => s.formIndex === formIndex)?.children;
  return (
    <section className="bsLane" aria-label={lane.name}>
      <div className="bsLaneHead">
        <span className="bsAvatar" aria-hidden="true">
          {initialsOf(lane.name)}
        </span>
        <h2>{lane.name}</h2>
        <span className="bsLaneSub">{lane.first ? 'answers first' : lane.from.length ? `from ${lane.from.join(', ')}` : 'nobody passes callers here yet'}</span>
      </div>
      {stranded && (
        <div className="bsProblem info bsLaneNote">
          <Icon name="info" size={14} />
          <span>{lane.name} can’t pass callers back, so a caller who then asks for something else stays here.</span>
          <button type="button" className="stLink" onClick={() => ctx.set(addWayBack(config, lane.key))}>
            Add a way back
          </button>
        </div>
      )}
      <div className="bsSteps">
        {greet && row(greet)}
        {greet && addAt('greet', { listPath: ePath, index: 0, guidedAt: 0 })}
        {sortable(enterSteps, `what ${lane.name} does as it takes over`, byIndex, (s, i) => (
          <>
            {row(s, true, (d) => moveBy(enterSteps, i, d, byIndex, enterOf))}
            {s.kind === 'form' && s.formIndex >= 0 && (
              <div className="bsChildren" aria-label={`The steps of ${s.form?.title || s.action?.form}`}>
                {s.children.length > 0 &&
                  sortable(s.children, `the steps of ${s.form?.title || s.action?.form}`, byIndex, (c, j) => (
                    <>
                      {row(c, true, (d) => moveBy(s.children, j, d, byIndex, formStepsOf(s.formIndex)))}
                      {addAt(`form-${s.formIndex}-${j}`, { listPath: ['forms', s.formIndex, 'on_submit'], index: c.index + 1, inForm: true, guidedAt: 0 })}
                    </>
                  ))}
                {s.children.length === 0 &&
                  addAt(`form-${s.formIndex}-start`, { listPath: ['forms', s.formIndex, 'on_submit'], index: 0, inForm: true, guidedAt: 0 })}
              </div>
            )}
            {addAt(`enter-${i}`, { listPath: ePath, index: s.index + 1, guidedAt: 0 })}
          </>
        ))}
        {sortable(guided, `${lane.name}’s guided steps`, byPosition, (s, i) => (
          <>
            {row(s, true, (d) => moveBy(guided, i, d, byPosition, guidedOf))}
            {(i < guided.length - 1 || decide || end) && addAt(`rule-${i}`, { listPath: ePath, index: undefined, guidedAt: i + 1 })}
          </>
        ))}
        {(decide || open === `${lane.key}.decide`) &&
          row(decide || { key: `${lane.key}.decide`, lane: lane.key, kind: 'decide', every: false, section: 'decide', branches: [] })}
        {decide && end && addAt('decide', { listPath: ePath, index: undefined, guidedAt: Infinity })}
        {end && row(end)}
        {addAt('last', { listPath: ePath, index: undefined, guidedAt: Infinity, label: 'Add a step' })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- the call in words
function InWords({ ctx, onDone, empty = false }) {
  const { config } = ctx;
  const [text, setText] = useState(() => (empty ? '' : wordsOf(config)));
  const [parsed, setParsed] = useState(null);
  const lanes = lanesOf(config);
  const laneName = (key) => lanes.find((l) => l.key === key)?.name || key;
  const use = () => {
    const previous = config;
    ctx.set(applyWords(config, parsed));
    ctx.deleted?.('Steps updated from your words', previous);
    setParsed(null);
    onDone?.();
  };
  // lines left as they were are the steps it already takes every time: counted, not listed again
  const shown = parsed ? parsed.filter((p) => p.kind !== 'keep') : [];
  const keptN = parsed ? parsed.length - shown.length : 0;
  const changes = shown.filter((p) => p.kind !== 'greet').length;
  const groups = [...new Set(shown.map((p) => p.lane))];
  const needs = shown.filter((p) => p.note).length;
  const isHeader = (line) => lanes.some((l) => line.toLowerCase() === `${l.name.toLowerCase()}:`);
  const lineCount = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter((l) => l && !isHeader(l)).length;
  return (
    <div className={`bsWords2 ${empty ? 'compact' : ''}`}>
      <div className="bsWordsIn">
        <label className="bsField">
          <span>{empty ? 'In your words, a line per step' : 'The call, in your words'}</span>
          <TextArea
            rows={empty ? 6 : 16}
            value={text}
            placeholder={
              '1. Greet them and find out what they need.\n2. If they want to book, take their name and the day they want.\n3. Offer three times, then book the one they pick.\n4. Say goodbye.'
            }
            onChange={(event) => {
              setText(event.target.value);
              setParsed(null);
            }}
          />
          {lanes.length > 1 && <small>Start a line with a subagent’s name (“{lanes[1].name}:”) to give it the lines after.</small>}
        </label>
        <div className="bsWordsActions">
          <Button type="button" variant={parsed ? 'secondary' : 'primary'} disabled={!text.trim()} onClick={() => setParsed(parseWords(config, text))}>
            <Icon name="sparkle" size={15} />
            Turn into steps
          </Button>
          {!empty && (
            <Button type="button" variant="quiet" onClick={() => setText(wordsOf(config))}>
              Start again from the steps
            </Button>
          )}
        </div>
      </div>
      {parsed && (
        <div className="bsWordsOut" aria-live="polite">
          <p className="bsWordsSum">
            <b>
              {plural(lineCount, 'line')} became {plural(shown.length, 'step')}
            </b>
            {keptN > 0 && (
              <span>
                {plural(keptN, 'line')} already {keptN === 1 ? 'is a step' : 'are steps'} it takes every time, kept as they are
              </span>
            )}
            {needs > 0 && <span className="stPill bsWarn">{needs} need something</span>}
          </p>
          {groups.map((key) => (
            <Fragment key={key}>
              <p className="bsWordsLane">{laneName(key)}</p>
              <ol className="bsWordsList">
                {shown
                  .filter((p) => p.lane === key)
                  .map((p, i) => (
                    <li key={i} className={p.note ? 'note' : ''}>
                      <span className={`bsKind t-${drawn(p.kind).tone}`} aria-hidden="true">
                        <Icon name={p.note ? 'alert' : drawn(p.kind).icon} size={14} />
                      </span>
                      <span className="bsWordsText">
                        {p.kind === 'pass'
                          ? `Pass to ${p.to}${p.when ? ` when ${p.when}` : ''}`
                          : p.kind === 'back'
                            ? `Pass back to ${p.to}`
                            : p.kind === 'form'
                              ? `Show the form ${p.formName}`
                              : p.text}
                        {p.note && <small>{p.note}</small>}
                      </span>
                      {!['pass', 'back', 'greet'].includes(p.kind) && <Pill every={p.every} />}
                    </li>
                  ))}
              </ol>
            </Fragment>
          ))}
          <div className="bsWordsActions">
            <Button type="button" variant="primary" onClick={use} disabled={changes === 0}>
              {changes ? `Use these ${plural(changes, 'step')}` : 'Nothing to change'}
            </Button>
            <Button type="button" variant="quiet" onClick={() => setParsed(null)}>
              Keep my old steps
            </Button>
          </div>
          <p className="bsFine">
            Each line is matched to a kind of step; a line it can’t place becomes a guided step, which the agent follows in its own words. Steps it takes every
            time that your lines don’t name are kept, and subagents your lines don’t mention keep all their steps. You can undo this right after.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- no steps yet
function NoSteps({ ctx, lanes, setAdding }) {
  return (
    <section className="bsEmpty" aria-label="No steps yet">
      <div className="bsEmptyHead">
        <span className="bsEmptyIcon" aria-hidden="true">
          <Icon name="steps" size={22} />
        </span>
        <div>
          <h2>Write the call the way it should go</h2>
          <p>No steps yet: the agent answers from its role on Agent, in its own order.</p>
        </div>
      </div>
      <InWords ctx={ctx} empty />
      <div className="bsEmptyOr">
        <Button
          type="button"
          variant="secondary"
          onClick={() => setAdding({ id: 'last', lane: lanes[0].key, listPath: enterPath(ctx.config, lanes[0].key), index: undefined, guidedAt: Infinity })}
        >
          <Icon name="plus" size={15} />
          Add the first step
        </Button>
      </div>
      <p className="bsEmptyLabel">Or start from a common call</p>
      <div className="bsStarters">
        {STARTERS.map((s) => (
          <button key={s.id} type="button" className="bsStarter" onClick={() => ctx.set(applyStarter(ctx.config, s.id))}>
            <b>{s.name}</b>
            <span>{s.line}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- the page
export default function StepsWorkspace({ ctx }) {
  const view = VIEWS.use();
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(null);
  const top = useRef(null);
  const { config } = ctx;
  const lanes = useMemo(() => lanesOf(config), [config]);
  const rows = useMemo(() => numbered(lanes), [lanes]);
  const numbers = useMemo(() => new Map(rows.map((r) => [r.step.key, r.number])), [rows]);
  const problems = useMemo(() => new Map(rows.map((r) => [r.step.key, problemsOf(config, r.step)]).filter(([, p]) => p.length)), [rows, config]);
  // steps, not problems: a step with two problems is one step that can't run
  const each = [...problems.values()];
  const broken = each.filter((ps) => ps.some((p) => p.level === 'danger')).length;
  const limited = each.filter((ps) => !ps.some((p) => p.level === 'danger') && ps.some((p) => p.level === 'warn')).length;
  const real = rows.filter((r) => r.step.kind !== 'greet').length;
  const total = countSteps(lanes);
  const firstProblem = () => {
    const key = [...problems.keys()][0];
    const el = top.current?.closest('.dtPage')?.querySelector(`[data-step="${CSS.escape(key)}"]`);
    if (el) reveal(el);
  };
  const passesTo = lanes.slice(1).map((l) => l.name);
  return (
    <section className="dtPart apWrap bsWrap" data-part="steps" aria-labelledby="dt-steps-title" ref={top}>
      <div className="apTop">
        <div className="apTopText">
          <h1 id="dt-steps-title">Steps</h1>
          <p className="dtQuestion">
            What happens on a call, in order. <b className="bsEveryWord">Every time</b> steps run exactly as written; <b className="bsGuidedWord">guided</b>{' '}
            steps are what the agent is told to do, in its own words.
          </p>
        </div>
        <div className="apSeg segmented" role="group" aria-label="How to see the steps">
          <button type="button" aria-pressed={view !== 'all'} className={view !== 'all' ? 'on' : ''} onClick={() => VIEWS.set('steps')}>
            Step by step
          </button>
          <button type="button" aria-pressed={view === 'all'} className={view === 'all' ? 'on' : ''} onClick={() => VIEWS.set('all')}>
            In your words
          </button>
        </div>
      </div>

      {!lanes.length && <p className="bsNote">This agent has no subagent yet: add one on Subagents and hand-overs.</p>}

      {lanes.length > 0 && view === 'all' && <InWords ctx={ctx} onDone={() => VIEWS.set('steps')} />}

      {lanes.length > 0 && view !== 'all' && real === 0 && !adding && <NoSteps ctx={ctx} lanes={lanes} setAdding={setAdding} />}

      {lanes.length > 0 && view !== 'all' && (real > 0 || adding) && (
        <>
          <div className="bsSummary">
            <p>
              A call has <span className="bsPart">{plural(total, 'step')}</span>
              {lanes.length > 1 ? (
                <>
                  {' '}
                  across <span className="bsPart">{plural(lanes.length, 'subagent')}</span>: <span className="bsPart">{lanes[0].name}</span> answers first and
                  passes callers to <span className="bsPart">{passesTo.length > 2 ? plural(passesTo.length, 'subagent') : passesTo.join(' and ')}</span>.
                </>
              ) : (
                <>
                  , all with <span className="bsPart">{lanes[0].name}</span>.
                </>
              )}
            </p>
            {ctx.onTest && (
              <Button type="button" variant="primary" onClick={ctx.onTest}>
                <Icon name="play" size={15} />
                Try these steps
              </Button>
            )}
          </div>
          {(broken > 0 || limited > 0) && (
            <div className="bsBanner" role="status">
              <Icon name="alert" size={16} />
              <span>
                {broken > 0 && <b>{plural(broken, 'step')} can’t run as written</b>}
                {broken > 0 && limited > 0 && ', and '}
                {limited > 0 && `${plural(limited, 'step works', 'steps work')} with a limit`}.
              </span>
              <button type="button" className="stLink" onClick={firstProblem}>
                Show the first
              </button>
            </div>
          )}
          {lanes.map((lane) => (
            <Lane
              key={lane.key}
              lane={lane}
              lanes={lanes}
              ctx={ctx}
              numbers={numbers}
              open={open}
              setOpen={setOpen}
              adding={adding}
              setAdding={setAdding}
              problems={problems}
            />
          ))}
          <p className="bsFoot">Drag a step by its handle to move it. The Workflow drawing and Subagents show these same steps.</p>
        </>
      )}
    </section>
  );
}
