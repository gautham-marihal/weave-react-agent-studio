import React, { createContext, useContext, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { isObj } from '../form/engine.js';
import { getAt, setAt } from '../form/inlineCreate.js';
import { formatPath } from '../format.js';
import { speechText } from '../../demo/simulatedAgent.js';
import {
  addEnd,
  addStateVariable,
  blankValue,
  removeHandoff,
  removeRule,
  removeToolHandoff,
  retargetRule,
  retargetToolHandoff,
  setEntry,
} from './workflowOps.js';
import { describeItems, parseNodeId } from './workflowModel.js';
import { channelName } from '../simple/simpleModel.js';

// The panel beside the picture: what the selected block or arrow is, in plain words, with the few settings that belong to it. Everything it changes is a
// field of the configuration; "All settings" has the rest. With nothing selected it tells the call step by step (each step picks its arrow), with how to
// use the picture folded under it.
const list = (v) => (Array.isArray(v) ? v : []);
const KINDS = [
  ['router', 'Passes callers on'],
  ['specialist', 'Does one job'],
  ['standalone', 'Answers on its own'],
];

function Field({ label, hint, children, id }) {
  return (
    <div className="wfField">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}
const Text = ({ id, value, onChange, placeholder, multiline, rows = 4, mono }) =>
  multiline ? (
    <textarea
      id={id}
      className={`stFInput ${mono ? 'mono' : ''}`}
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  ) : (
    <input
      id={id}
      className={`stFInput ${mono ? 'mono' : ''}`}
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );

// Where what is selected lives in the configuration: the path, the JSON as it is right now, and a way to open it in its settings or in the file. Whatever is
// changed here is written to that place at once, and whatever is changed there is what this panel and the picture show.
const WhereCtx = createContext(null);
export function placesFor(selected, config) {
  if (!selected) return [];
  const agents = list(config?.agents?.items);
  const ai = (id) => agents.findIndex((a) => a?.id === id);
  const tools = list(config?.tools);
  const out = [];
  const add = (label, path) => {
    if (path.every((p) => p !== -1) && getAt(config, path) !== undefined) out.push({ label, path });
  };
  if (selected.type === 'node') {
    const at = parseNodeId(selected.id);
    if (at.kind === 'start') add('Who answers first', ['agents', 'entry']);
    else if (at.kind === 'agent') add('This agent', ['agents', 'items', ai(at.agent)]);
    else if (at.kind === 'enter') add('This step', ['agents', 'items', ai(at.agent), 'on_enter', at.index]);
    else {
      const ti = tools.findIndex((t) => t?.id === at.tool);
      add('This tool', ['tools', ti]);
      const transfer = tools[ti]?.params?.transfer;
      if (transfer) add('Its transfer', ['telephony', 'transfers', list(config?.telephony?.transfers).findIndex((t) => t?.id === transfer)]);
    }
    if (getAt(config, ['builder', 'ui', 'graph_positions', selected.id]))
      out.push({ label: 'Where it is drawn', path: ['builder', 'ui', 'graph_positions', selected.id], quiet: true });
  }
  return out;
}
function derivedPlaces(ref, config) {
  if (ref.derived === 'tool')
    return (ref.ids || [])
      .map((id) => ({ label: `Tool ${id}`, path: ['tools', list(config?.tools).findIndex((t) => t?.id === id)] }))
      .filter((p) => p.path[1] >= 0);
  if (ref.derived === 'rule')
    return (ref.ids || [])
      .map((id) => ({ label: `Safety rule ${id}`, path: ['guardrails', 'escalation', list(config?.guardrails?.escalation).findIndex((r) => r?.id === id)] }))
      .filter((p) => p.path[2] >= 0);
  return [];
}

export function edgePlaces(edge, config) {
  const ref = edge?.ref || {};
  const agents = list(config?.agents?.items);
  const ai = agents.findIndex((a) => a?.id === ref.agent);
  if (ref.derived) return derivedPlaces(ref, config);
  if (ai < 0) return edge?.kind === 'start' ? [{ label: 'Who answers first', path: ['agents', 'entry'] }] : [];
  if (ref.handoff !== undefined) return [{ label: 'This hand-over', path: ['agents', 'items', ai, 'handoffs', ref.handoff] }];
  if (ref.enter !== undefined) return [{ label: 'This step', path: ['agents', 'items', ai, 'on_enter', ref.enter] }];
  if (ref.tool) {
    const ti = list(config?.tools).findIndex((t) => t?.id === ref.tool);
    return ti >= 0 ? [{ label: 'The tool', path: ['tools', ti] }] : [];
  }
  return [];
}

function Where() {
  const ctx = useContext(WhereCtx);
  if (!ctx || !ctx.places.length) return null;
  const main = ctx.places[0];
  return (
    <section className="wfSection wfWhere">
      <h4>In the configuration</h4>
      <p className="wfMuted">
        What you change here is written to <code>{formatPath(main.path)}</code> at once, and what you change there shows here.
      </p>
      <div className="wfRow">
        <button type="button" className="quietButton" onClick={() => ctx.onOpenSettings(main.path)}>
          Open its settings
        </button>
        <button type="button" className="quietButton" onClick={() => ctx.onOpenJson(main.path)}>
          Open in JSON
        </button>
      </div>
      {ctx.places.map((place) => (
        <details key={formatPath(place.path)} className="wfCode">
          <summary>
            {place.label} <code>{formatPath(place.path)}</code>
          </summary>
          <pre>{JSON.stringify(getAt(ctx.config, place.path), null, 2)}</pre>
        </details>
      ))}
    </section>
  );
}

export default function Inspector(props) {
  const places =
    props.selected?.type === 'edge'
      ? edgePlaces(
          props.flow.edges.find((e) => e.id === props.selected.id),
          props.config,
        )
      : placesFor(props.selected, props.config);
  return (
    <WhereCtx.Provider value={{ places, config: props.config, onOpenSettings: props.onOpenSettings, onOpenJson: props.onOpenJson || props.onOpenSettings }}>
      {/* a new selection starts a new panel: a question half-asked about one block is not carried to the next */}
      <InspectorBody key={props.selected ? `${props.selected.type}:${props.selected.id}` : 'none'} {...props} />
    </WhereCtx.Provider>
  );
}

function InspectorBody({ flow, config, selected, apply, onSelect, onOpenSettings, onRemove, onShowRole, onShowGreeting }) {
  const agents = list(config?.agents?.items);
  const agentOf = (id) => agents.find((a) => a?.id === id);
  const indexOf = (id) => agents.findIndex((a) => a?.id === id);
  const set = (path, value, group) => apply(setAt(config, path, value), { group: group || `edit:${path.join('.')}` });
  const node = selected?.type === 'node' ? flow.nodes.find((n) => n.id === selected.id) : null;
  const edge = selected?.type === 'edge' ? flow.edges.find((e) => e.id === selected.id) : null;

  if (!node && !edge) return <Overview flow={flow} config={config} apply={apply} onSelect={onSelect} />;
  if (edge)
    return (
      <EdgeView
        edge={edge}
        flow={flow}
        config={config}
        agents={agents}
        set={set}
        apply={apply}
        onSelect={onSelect}
        onOpenSettings={onOpenSettings}
        indexOf={indexOf}
      />
    );

  const at = parseNodeId(node.id);
  if (node.type === 'start') return <StartView flow={flow} config={config} apply={apply} onClose={() => onSelect(null)} onShowGreeting={onShowGreeting} />;
  if (node.type === 'agent') {
    const i = indexOf(node.id);
    const agent = agents[i];
    const id = `wf-agent-${node.id}`;
    const handoffs = list(agent.handoffs);
    return (
      <Shell icon="subagent" title={agent.name || agent.id} kicker="Subagent" onClose={() => onSelect(null)}>
        <Field label="Name" id={`${id}-name`}>
          <Text id={`${id}-name`} value={agent.name || ''} onChange={(v) => set(['agents', 'items', i, 'name'], v)} />
        </Field>
        <Field label="What kind of agent" id={`${id}-kind`}>
          <select
            id={`${id}-kind`}
            className="stFInput"
            value={agent.kind || 'specialist'}
            onChange={(event) => set(['agents', 'items', i, 'kind'], event.target.value, `kind:${node.id}`)}
          >
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {onShowRole && flow.entry === node.id ? (
          // the agent that answers first: its instructions are asked on the Agent page, and shown here
          <Field label="What it does" id={`${id}-role`} hint="It answers first, so its instructions are the ones on the Agent page.">
            <p className="wfRoleRead" id={`${id}-role`} title={agent.instructions?.role || undefined}>
              {agent.instructions?.role?.trim() || 'No instructions yet.'}
            </p>
            <button type="button" className="quietButton" onClick={onShowRole}>
              Change them on the Agent page
            </button>
          </Field>
        ) : (
          <Field label="What it does" id={`${id}-role`} hint="Written to the agent, as you would brief a person.">
            <Text
              id={`${id}-role`}
              multiline
              rows={6}
              value={agent.instructions?.role || ''}
              onChange={(v) => set(['agents', 'items', i, 'instructions', 'role'], v)}
            />
          </Field>
        )}
        <div className="wfRow">
          {flow.entry === node.id ? (
            <span className="wfTag good">
              <Icon name="check" size={14} /> Answers first
            </span>
          ) : (
            <button type="button" className="quietButton" onClick={() => apply(setEntry(config, node.id))}>
              Make it answer first
            </button>
          )}
          <button type="button" className="quietButton" onClick={() => onOpenSettings(['agents', 'items', i])}>
            All settings for this agent
          </button>
        </div>
        {node.deadEnd && (
          // a caller passed to it would stay there: one click gives it a way to finish
          <section className="wfSection">
            <p className="wfWarnText">A caller passed to it can’t leave: it can’t end the call, hand over to a person or pass them back.</p>
            <div className="wfRow">
              <button type="button" className="quietButton" onClick={() => apply(addEnd(config, node.id).config)}>
                Let it end the call
              </button>
            </div>
            <p className="wfMuted">Or press ＋ under the block to pass callers on from it.</p>
          </section>
        )}
        <section className="wfSection">
          <h4>Where it can send the caller</h4>
          {handoffs.length === 0 ? (
            <p className="wfMuted">Nowhere yet. Press ＋ under the block and choose Subagent or Agent transfer.</p>
          ) : (
            <ul className="wfList">
              {handoffs.map((h, k) => {
                if (!isObj(h)) return null;
                const edgeId = flow.edges.find((e) => e.ref?.agent === node.id && e.ref?.handoff === k)?.id;
                return (
                  <li key={k}>
                    <button type="button" className="wfLink" onClick={() => edgeId && onSelect({ type: 'edge', id: edgeId })}>
                      <Icon name="swap" size={15} />
                      <span>
                        <strong>{agentOf(h.to)?.name || h.to}</strong>
                        <small>{h.description}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="wfSection">
          <h4>Delete</h4>
          <DeleteButton
            label="Delete this agent"
            disabled={agents.length <= 1}
            why={agents.length <= 1 ? 'An assistant needs at least one agent.' : 'Callers can no longer be passed to it. Its hand-overs are removed too.'}
            onConfirm={() => onRemove(node.id)}
          />
        </section>
      </Shell>
    );
  }

  const agent = agentOf(at.agent);
  const ai = indexOf(at.agent);
  const owner = agent?.name || at.agent;
  if (at.kind === 'enter')
    return (
      <EnterView
        node={node}
        agent={agent}
        ai={ai}
        owner={owner}
        config={config}
        set={set}
        apply={apply}
        onSelect={onSelect}
        onRemove={onRemove}
        onOpenSettings={onOpenSettings}
      />
    );
  return (
    <ToolView
      node={node}
      agent={agent}
      ai={ai}
      owner={owner}
      config={config}
      set={set}
      onSelect={onSelect}
      onRemove={onRemove}
      onOpenSettings={onOpenSettings}
    />
  );
}

function Shell({ icon, title, kicker, children, onClose }) {
  return (
    <aside className="wfInspector" aria-label={`${kicker}: ${title}`}>
      <header>
        <span className="wfIcon" aria-hidden="true">
          <Icon name={icon} size={20} />
        </span>
        <span>
          <small>{kicker}</small>
          <strong>{title}</strong>
        </span>
        <button type="button" className="smClose" aria-label="Close this panel" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </header>
      <div className="wfInspectorBody">
        {children}
        <Where />
      </div>
    </aside>
  );
}

// A delete that asks once, in the panel, and says what it takes with it.
function DeleteButton({ label, why, onConfirm, disabled }) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <div className="wfConfirm" role="group" aria-label={label}>
        <p>{why}</p>
        <div className="wfRow">
          <button
            type="button"
            className="dangerButton"
            onClick={() => {
              setAsking(false);
              onConfirm();
            }}
          >
            {label}
          </button>
          <button type="button" className="quietButton" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <button type="button" className="quietButton wfDanger" disabled={disabled} title={disabled ? why : undefined} onClick={() => setAsking(true)}>
      <Icon name="trash" size={15} /> {label}
    </button>
  );
}

// ---- nothing selected
function Overview({ flow, config, apply, onSelect }) {
  const agents = list(config?.agents?.items);
  const counts = { agents: agents.length, hand: flow.edges.filter((e) => e.kind === 'handoff').length };
  // the call in sentences, in the order the picture is read; each one picks its arrow
  const steps = describeItems(flow);
  return (
    <aside className="wfInspector" aria-label="About the workflow">
      <header>
        <span className="wfIcon" aria-hidden="true">
          <Icon name="flag" size={20} />
        </span>
        <span>
          <small>Workflow</small>
          <strong>How a call moves</strong>
        </span>
      </header>
      <div className="wfInspectorBody">
        <p className="wfMuted">
          {counts.agents === 1
            ? 'One agent answers every call.'
            : `${counts.agents} agents, ${counts.hand} way${counts.hand === 1 ? '' : 's'} to pass a caller between them.`}{' '}
          Pick a block or an arrow to change it.
        </p>
        {agents.length > 1 && (
          <Field label="Who answers first" id="wf-entry">
            <select id="wf-entry" className="stFInput" value={flow.entry} onChange={(event) => apply(setEntry(config, event.target.value))}>
              {agents
                .filter((a) => a && a.id)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || a.id}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {steps.length > 0 && (
          <section className="wfSection">
            <h4>This call, step by step</h4>
            <ol className="wfSteps">
              {steps.map((step) => (
                <li key={step.id}>
                  <button type="button" className="wfListItem" onClick={() => onSelect({ type: 'edge', id: step.id })}>
                    {step.text}
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}
        <details className="wfSection wfHelp">
          <summary>Using the picture</summary>
          <ul className="wfTips">
            <li>
              <b>Move</b> a block by dragging it, or with the arrow keys once it is selected (Shift moves further).
            </li>
            <li>
              <b>Add</b> by selecting an agent and pressing ＋ under it: a subagent, a line to say, a number to transfer to, a tool, the end of the call.
            </li>
            <li>
              <b>Change</b> what an arrow means by selecting it: when the agent should pass the caller on.
            </li>
            <li>
              <b>Zoom</b> with the buttons above, or Ctrl and the mouse wheel. Drag the empty space to move around.
            </li>
          </ul>
          <h4>Arrows</h4>
          <dl className="wfLegend">
            <div>
              <dt>
                <i className="wfKey handoff" />
                Hands over
              </dt>
              <dd>The agent passes the caller to another agent.</dd>
            </div>
            <div>
              <dt>
                <i className="wfKey uses" />
                Can use
              </dt>
              <dd>A tool the agent can call.</dd>
            </div>
            <div>
              <dt>
                <i className="wfKey tool" />
                Through a tool
              </dt>
              <dd>A tool whose rules pass the caller on.</dd>
            </div>
            <div>
              <dt>
                <i className="wfKey rule" />
                Under a safety rule
              </dt>
              <dd>A safety rule that passes the caller on.</dd>
            </div>
            <div>
              <dt>
                <i className="wfKey return" />
                Back to the start
              </dt>
              <dd>The caller is sent back to the first agent.</dd>
            </div>
          </dl>
        </details>
      </div>
    </aside>
  );
}

function StartView({ flow, config, apply, onClose, onShowGreeting }) {
  const agents = list(config?.agents?.items);
  // what each channel says first (the same line on most, so each different line is said once, with the channels that say it)
  const lines = [];
  list(config?.channels)
    .filter((c) => isObj(c) && c.enabled !== false)
    .forEach((c) => {
      const text = c.greeting?.say !== undefined ? speechText(c.greeting.say, config) || '…' : '';
      const same = lines.find((l) => l.text === text);
      if (same) same.channels.push(channelName(c.type));
      else lines.push({ text, channels: [channelName(c.type)] });
    });
  return (
    <Shell icon="flag" title="Start" kicker="Where a call begins" onClose={onClose}>
      <p className="wfMuted">A call or a chat begins here: the channel says its first line, then the agent below takes over.</p>
      {lines.length > 0 && (
        <section className="wfSection">
          <h4>What it says first</h4>
          <ul className="wfFirstLines">
            {lines.map((l) => (
              <li key={l.text || '(none)'}>
                <small>{l.channels.join(', ')}</small>
                <span>{l.text ? `“${l.text}”` : 'Nothing: it waits for the caller to speak first.'}</span>
              </li>
            ))}
          </ul>
          {onShowGreeting && (
            <button type="button" className="quietButton" onClick={onShowGreeting}>
              Change it on the Agent page
            </button>
          )}
        </section>
      )}
      <Field label="Who answers first" id="wf-start-entry">
        <select id="wf-start-entry" className="stFInput" value={flow.entry} onChange={(event) => apply(setEntry(config, event.target.value))}>
          {agents
            .filter((a) => a && a.id)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.id}
              </option>
            ))}
        </select>
      </Field>
    </Shell>
  );
}

// ---- what an agent does as it takes over
function EnterView({ node, agent, ai, owner, config, set, apply, onSelect, onRemove, onOpenSettings }) {
  const index = parseNodeId(node.id).index;
  const action = list(agent?.on_enter)[index];
  const base = ['agents', 'items', ai, 'on_enter', index];
  const id = `wf-${node.id}`;
  const variables = isObj(config?.state?.variables) ? config.state.variables : {};
  return (
    <Shell
      icon={node.type === 'say' ? 'quote' : node.type === 'state' ? 'pencil' : 'sliders'}
      title={node.label}
      kicker={`Runs first when ${owner} takes over`}
      onClose={() => onSelect(null)}
    >
      {action?.type === 'say' &&
        (typeof action.text === 'string' || action.text === undefined ? (
          <Field label="What it says" id={`${id}-text`} hint="Spoken, or written in a chat, as soon as this agent takes over.">
            <Text id={`${id}-text`} multiline rows={4} value={action.text || ''} onChange={(v) => set([...base, 'text'], v)} />
          </Field>
        ) : (
          <p className="wfMuted">It says the saved message “{action.text.message}”. Change the message under Agent › Fixed lines.</p>
        ))}
      {action?.type === 'set_state' && (
        <StateRows values={isObj(action.values) ? action.values : {}} variables={variables} config={config} apply={apply} path={[...base, 'values']} />
      )}
      {action?.type === 'transfer' && (
        <Field label="Transfer" id={`${id}-transfer`}>
          <select id={`${id}-transfer`} className="stFInput" value={action.transfer || ''} onChange={(event) => set([...base, 'transfer'], event.target.value)}>
            {list(config?.telephony?.transfers).map((t) => (
              <option key={t.id} value={t.id}>
                {t.id}
              </option>
            ))}
          </select>
        </Field>
      )}
      {!['say', 'set_state', 'transfer'].includes(action?.type) && (
        <p className="wfMuted">
          {node.label}
          {node.sub ? `: ${node.sub}` : ''}. Its details are in its settings.
        </p>
      )}
      <div className="wfRow">
        <button type="button" className="quietButton" onClick={() => onOpenSettings(['agents', 'items', ai, 'on_enter'])}>
          Open its settings
        </button>
      </div>
      <section className="wfSection">
        <h4>Delete</h4>
        <DeleteButton label="Delete this step" why="The agent stops doing this when it takes over." onConfirm={() => onRemove(node.id)} />
      </section>
    </Shell>
  );
}

// "Update state": the call's variables this agent sets as it takes over.
function StateRows({ values, variables, config, apply, path }) {
  const names = Object.keys(variables);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', kind: 'string' });
  const entries = Object.entries(values);
  const write = (next) => apply(setAt(config, path, next), { group: `state:${path.join('.')}` });
  const typed = (name, text) => {
    const t = variables[name]?.type;
    return t === 'integer'
      ? text === ''
        ? 0
        : Math.trunc(Number(text))
      : t === 'number'
        ? text === ''
          ? 0
          : Number(text)
        : t === 'boolean'
          ? text === 'true'
          : text;
  };
  const free = names.filter((n) => !(n in values));
  return (
    <section className="wfSection">
      <h4>What it remembers</h4>
      {entries.length === 0 && (
        <p className="wfMuted">{names.length ? 'Choose a variable and what it becomes.' : 'The call has no variables yet. Add one below.'}</p>
      )}
      <ul className="wfList">
        {entries.map(([name, value]) => (
          <li key={name} className="wfPair">
            <span className="wfPairName">{name}</span>
            {['object', 'array'].includes(variables[name]?.type) ? (
              <code className="wfPairName" title="Change this one in its settings">
                {JSON.stringify(value)}
              </code>
            ) : variables[name]?.type === 'enum' ? (
              <select
                className="stFInput"
                aria-label={`Value of ${name}`}
                value={value ?? ''}
                onChange={(event) => write({ ...values, [name]: event.target.value })}
              >
                {(variables[name].values || []).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ) : variables[name]?.type === 'boolean' ? (
              <select
                className="stFInput"
                aria-label={`Value of ${name}`}
                value={String(!!value)}
                onChange={(event) => write({ ...values, [name]: typed(name, event.target.value) })}
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : (
              <input
                className="stFInput"
                aria-label={`Value of ${name}`}
                type={['integer', 'number'].includes(variables[name]?.type) ? 'number' : 'text'}
                value={value ?? ''}
                onChange={(event) => write({ ...values, [name]: typed(name, event.target.value) })}
              />
            )}
            <button
              type="button"
              className="stFDel small"
              aria-label={`Stop setting ${name}`}
              onClick={() => {
                const next = { ...values };
                delete next[name];
                write(next);
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {free.length > 0 && (
        <select
          className="stFInput"
          aria-label="Set another variable"
          value=""
          onChange={(event) => {
            const name = event.target.value;
            if (name) write({ ...values, [name]: blankValue(variables[name]) });
          }}
        >
          <option value="">Set a variable…</option>
          {free.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      )}
      {adding ? (
        <form
          className="wfInline"
          onSubmit={(event) => {
            event.preventDefault();
            if (/^[a-z][a-z0-9_]{0,63}$/.test(draft.name) && !(draft.name in variables)) {
              const next = addStateVariable(config, draft.name, draft.kind);
              apply(setAt(next, path, { ...values, [draft.name]: draft.kind === 'integer' ? 0 : draft.kind === 'boolean' ? false : '' }), { group: '' });
              setAdding(false);
              setDraft({ name: '', kind: 'string' });
            }
          }}
        >
          <input
            className="stFInput mono"
            aria-label="Variable name"
            placeholder="caller_intent"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value.toLowerCase() })}
          />
          <select className="stFInput" aria-label="It holds" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value })}>
            <option value="string">Text</option>
            <option value="integer">A number</option>
            <option value="boolean">Yes / no</option>
          </select>
          <button type="submit" className="primaryCta compactCta" disabled={!/^[a-z][a-z0-9_]{0,63}$/.test(draft.name) || draft.name in variables}>
            Add it
          </button>
          <button type="button" className="quietButton" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" className="stAddBtn" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> New variable
        </button>
      )}
    </section>
  );
}

// ---- what an agent can do: its tools
// A tool block: what the tool does here, in words. Its settings (when it is used, what it says before it hangs up, the number it passes calls to) are asked
// once, in its panel on the Tools page (the transfer's number in Phone transfers): shown here, with the way there.
function ToolView({ node, owner, config, onSelect, onRemove, onOpenSettings }) {
  const toolId = parseNodeId(node.id).tool;
  const ti = list(config?.tools).findIndex((t) => t?.id === toolId);
  const tool = list(config?.tools)[ti];
  const transfer = node.type === 'transfer' ? list(config?.telephony?.transfers).find((t) => t?.id === tool?.params?.transfer) : null;
  const ti2 = transfer ? list(config.telephony.transfers).indexOf(transfer) : -1;
  const shared =
    node.shared > 1 ? (
      <p className="wfNote">
        {node.shared} agents use this {node.type === 'end' ? 'way of ending the call' : node.type === 'transfer' ? 'transfer' : 'tool'}: changing it changes it
        for all of them.
      </p>
    ) : null;
  const when = typeof tool?.description === 'string' ? tool.description.trim() : '';
  const goodbye = node.type === 'end' && tool ? speechText(tool.params?.say, config) : '';
  return (
    <Shell
      icon={node.type === 'end' ? 'endCall' : node.type === 'transfer' ? 'phoneTransfer' : 'tools'}
      title={node.label}
      kicker={`${owner} can use this`}
      onClose={() => onSelect(null)}
    >
      {!tool && <p className="wfWarn">This agent offers “{toolId}”, but there is no such tool. Delete this block, or create the tool on the Tools page.</p>}
      {node.type === 'tool' && tool && <p className="wfMuted">{node.sub}.</p>}
      {node.type === 'transfer' && tool && (
        <p className={node.noNumber ? 'wfWarnText wfNumber' : 'wfMuted wfNumber'}>
          {!transfer
            ? 'This transfer is not set up yet.'
            : node.noNumber
              ? 'No number yet: callers are offered a callback instead of being passed to a person.'
              : typeof transfer.target === 'string'
                ? `Passes calls to ${transfer.target.trim()}.`
                : `The number is ${node.sub}.`}{' '}
          {transfer && (
            <button type="button" className="linkButton" onClick={() => onOpenSettings(['telephony', 'transfers', ti2])}>
              {node.noNumber ? 'Add the number' : 'Change it'}
            </button>
          )}
        </p>
      )}
      {tool && (
        <dl className="wfFacts">
          {node.type === 'end' && (
            <div>
              <dt>What it says before it hangs up</dt>
              <dd>
                {goodbye ? `“${goodbye}”` : <span className="wfWarnText">Nothing yet: the call ends without a goodbye.</span>}
                {goodbye && isObj(tool.params?.say) && <small> One of its fixed lines (Agent page › Fixed lines).</small>}
              </dd>
            </div>
          )}
          <div>
            <dt>When it uses it</dt>
            <dd>{when ? `“${when}”` : <span className="wfWarnText">Not said yet, so the agent may not know when to use it.</span>}</dd>
          </div>
        </dl>
      )}
      {shared}
      {tool && (
        <div className="wfRow">
          <button type="button" className="quietButton" onClick={() => onOpenSettings(['tools', ti])}>
            Change it on the Tools page
          </button>
        </div>
      )}
      <section className="wfSection">
        <h4>Delete</h4>
        <DeleteButton
          label={node.shared > 1 ? `Stop offering it to ${owner}` : 'Delete this block'}
          why={
            node.shared > 1
              ? `Other agents keep it. ${owner} can no longer do this.`
              : node.type === 'tool'
                ? `${owner} can no longer use the tool. The tool stays on the Tools page.`
                : `${owner} can no longer do this.`
          }
          onConfirm={() => onRemove(node.id)}
        />
      </section>
    </Shell>
  );
}

// ---- an arrow
function EdgeView({ edge, flow, config, agents, set, apply, onSelect, onOpenSettings, indexOf }) {
  const from = flow.nodes.find((n) => n.id === edge.from);
  const to = flow.nodes.find((n) => n.id === edge.to);
  const ref = edge.ref || {};
  const id = `wf-${edge.id}`;
  const ai = indexOf(ref.agent);
  const kicker =
    edge.kind === 'handoff'
      ? 'Hand-over'
      : edge.kind === 'return'
        ? 'Back to the start'
        : edge.kind === 'tool'
          ? 'Hand-over through a tool'
          : edge.kind === 'rule'
            ? 'Hand-over under a safety rule'
            : edge.kind === 'start'
              ? 'Where a call begins'
              : 'Link';
  const title = `${from?.label || edge.from} → ${to?.label || edge.to}`;
  if (edge.kind === 'handoff' && ref.handoff !== undefined) {
    const h = list(agents[ai]?.handoffs)[ref.handoff] || {};
    const base = ['agents', 'items', ai, 'handoffs', ref.handoff];
    return (
      <Shell icon="swap" title={title} kicker={kicker} onClose={() => onSelect(null)}>
        <Field
          label="When should it pass the caller on?"
          id={`${id}-when`}
          hint="The agent reads this to decide. Say what the caller wants, not what the agent does."
        >
          <Text id={`${id}-when`} multiline rows={4} value={h.description || ''} onChange={(v) => set([...base, 'description'], v)} />
        </Field>
        <Field label="Where to" id={`${id}-to`}>
          <select
            id={`${id}-to`}
            className="stFInput"
            value={h.to}
            onChange={(event) => {
              const next = event.target.value;
              set([...base, 'to'], next, `to:${edge.id}`);
              onSelect({ type: 'edge', id: `${ref.agent}->${next}::h${ref.handoff}` });
            }}
          >
            {agents
              .filter((a) => a && a.id && a.id !== ref.agent)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.id}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Say while handing over" id={`${id}-say`} hint="Optional. Spoken while the next agent gets ready.">
          <Text
            id={`${id}-say`}
            value={typeof h.announce === 'string' ? h.announce : ''}
            placeholder="One moment, I’ll put you through."
            onChange={(v) => {
              const next = { ...h };
              if (v) next.announce = v;
              else delete next.announce;
              set(base, next);
            }}
          />
        </Field>
        <label className="wfCheck">
          <input type="checkbox" checked={h.carry_context !== false} onChange={(event) => set([...base, 'carry_context'], event.target.checked, '')} /> The next
          agent knows what has been said so far
        </label>
        <section className="wfSection">
          <h4>Delete</h4>
          <DeleteButton
            label="Remove this hand-over"
            why="The agent can no longer pass the caller on this way."
            onConfirm={() => {
              apply(removeHandoff(config, ref.agent, { handoff: ref.handoff }), { group: '' });
              onSelect(null);
            }}
          />
        </section>
      </Shell>
    );
  }
  if (ref.enter !== undefined || (edge.kind === 'return' && ref.tool)) {
    const stop = () => {
      apply(removeHandoff(config, ref.agent, ref.enter !== undefined ? { enter: ref.enter } : { tool: ref.tool }), { group: '' });
      onSelect(null);
    };
    return (
      <Shell icon="swap" title={title} kicker={kicker} onClose={() => onSelect(null)}>
        <p className="wfMuted">
          {ref.enter !== undefined
            ? `As soon as ${from?.label} takes over, it passes the caller on.`
            : `${from?.label} can send the caller back to ${to?.label}${ref.tool ? ` with the tool “${ref.tool}”` : ''}.`}
        </p>
        <section className="wfSection">
          <h4>Delete</h4>
          <DeleteButton
            label={ref.enter !== undefined ? 'Remove this hand-over' : 'Stop offering it'}
            why="The agent can no longer do this."
            onConfirm={stop}
          />
        </section>
      </Shell>
    );
  }
  if (edge.kind === 'tool' || edge.kind === 'rule') {
    const isTool = edge.kind === 'tool';
    return (
      <Shell icon="swap" title={title} kicker={kicker} onClose={() => onSelect(null)}>
        <p className="wfMuted">
          {isTool
            ? `${from?.label} can pass the caller to ${to?.label} with a tool whose rules hand over.`
            : `A safety rule passes the caller to ${to?.label}.`}{' '}
          Point it somewhere else, or take it away.
        </p>
        {(ref.ids || []).map((rid) => (
          <section className="wfSection" key={rid}>
            <h4>{isTool ? `Tool “${rid}”` : `Safety rule “${rid}”`}</h4>
            <Field label="Passes the caller to" id={`${id}-${rid}-to`}>
              <select
                id={`${id}-${rid}-to`}
                className="stFInput"
                value={edge.to}
                onChange={(event) => {
                  const next = event.target.value;
                  apply(isTool ? retargetToolHandoff(config, rid, edge.to, next) : retargetRule(config, rid, next), { group: '' });
                  onSelect({ type: 'edge', id: `${edge.from}->${next}::${edge.kind}` });
                }}
              >
                {agents
                  .filter((a) => a && a.id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name || a.id}
                    </option>
                  ))}
              </select>
            </Field>
            <DeleteButton
              label={isTool ? 'Stop it handing over' : 'Delete this safety rule'}
              why={
                isTool
                  ? `The tool “${rid}” stays, but no longer passes the caller to ${to?.label}.`
                  : `The safety rule “${rid}” is deleted: it no longer does anything.`
              }
              onConfirm={() => {
                apply(isTool ? removeToolHandoff(config, rid, edge.to) : removeRule(config, rid), { group: '' });
                onSelect(null);
              }}
            />
          </section>
        ))}
      </Shell>
    );
  }
  const words = {
    start: `Every call begins with ${to?.label}. Change who answers first from the Start block.`,
    tool: `${from?.label} can pass the caller to ${to?.label} through ${edge.full || 'a tool'}. These rules are part of the tool.`,
    rule: `A safety rule (${edge.full || 'a rule'}) passes the caller to ${to?.label}.`,
    exit: 'The agent can do this.',
    uses: 'The agent can use this tool.',
    enter: 'This runs first, when the agent takes over.',
  };
  return (
    <Shell icon="swap" title={title} kicker={kicker} onClose={() => onSelect(null)}>
      <p className="wfMuted">{words[edge.kind] || ''}</p>
      {(edge.kind === 'tool' || edge.kind === 'rule') && (
        <div className="wfRow">
          <button type="button" className="quietButton" onClick={() => onOpenSettings(edge.kind === 'tool' ? ['tools'] : ['guardrails'])}>
            {edge.kind === 'tool' ? 'Open the tools' : 'Open the safety rules'}
          </button>
        </div>
      )}
    </Shell>
  );
}
