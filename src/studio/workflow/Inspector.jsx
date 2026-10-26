import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { isObj } from '../form/engine.js';
import { getAt, setAt } from '../form/inlineCreate.js';
import { formatPath } from '../format.js';
import { speechText } from '../../demo/simulatedAgent.js';
import {
  addBackToStart,
  addEnd,
  addStateVariable,
  addTool,
  blankValue,
  removeHandoff,
  removeNode,
  removeRule,
  removeToolHandoff,
  retargetRule,
  retargetToolHandoff,
  isBuiltin,
  setEntry,
  setTransferAgent,
  setTransferDelay,
  setTransferSay,
  transferOf,
  whyKeepAgent,
} from './workflowOps.js';
import { Switch } from '../form/fields.jsx';
import { NOTE_COLORS } from './notes.js';
import { freshScenarioId, newScenario } from '../scenarios/model.js';
import { describeItems, isTriggerId, parseNodeId, toolName, toolNodeId, toolTitle } from './workflowModel.js';
import { humanize } from '../agent/rowNames.js';
import { channelGreetingTarget, greetingOf, setGreeting } from '../simple/simpleModel.js';
import { KNOWLEDGE_ID } from '../setup/setupModel.js';
import {
  defaultInterrupt,
  defaultLlm,
  defaultVoice,
  interruptChoice,
  llmChoice,
  llmOptions,
  setInterrupt,
  setLlm,
  setVoice,
  voiceChoice,
  voiceOptions,
} from './agentOverrides.js';
import { useProviders } from '../models/useProviders.js';
import { PartPanel, PartRow, Parts } from '../../ui/Parts.tsx';
import Tip from '../../ui/Tip.tsx';
import Select from '../../ui/Select.tsx';
import { agentsUsingTool } from '../form/toolInfo.js';

// The panel beside the picture: what the selected block or arrow is, in plain words, with the few settings that belong
// to it. Everything it changes is a field of the configuration; "All settings" has the rest. With nothing selected it
// tells the call step by step (each step picks its arrow), with how to use the picture folded under it.
const list = (v) => (Array.isArray(v) ? v : []);
// the configuration without the value at a path (a field emptied leaves nothing behind)
const unsetAt = (root, path) => {
  const parent = getAt(root, path.slice(0, -1));
  if (!isObj(parent) || !(path.at(-1) in parent)) return root;
  const rest = { ...parent };
  delete rest[path.at(-1)];
  return setAt(root, path.slice(0, -1), rest);
};
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

// Where what is selected lives in the configuration: the path, the JSON as it is right now, and a way to open it in its
// settings or in the file. Whatever is changed here is written to that place at once, and whatever is changed there is
// what this panel and the picture show.
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
    else if (at.kind === 'trigger') {
      add('This channel', ['channels', list(config?.channels).findIndex((c) => c?.id === at.channel)]);
      add('Who answers first', ['agents', 'entry']);
    } else if (at.kind === 'model') {
      add('Its own model', ['agents', 'items', ai(at.agent), 'overrides', 'models']);
      add('The default model', ['defaults', 'models', 'llm']);
    } else if (at.kind === 'knowledge') add('This knowledge', ['knowledge', list(config?.knowledge).findIndex((b) => b?.id === at.base)]);
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
    <WhereCtx.Provider value={{ places, config: props.config, onOpenSettings: props.onOpenSettings, onOpenJson: props.onOpenJson, onHide: props.onHide }}>
      {/* a new selection starts a new panel: a question half-asked about one block is not carried to the next */}
      <InspectorBody key={props.selected ? `${props.selected.type}:${props.selected.id}:${props.selected.tab || ''}` : 'none'} {...props} />
    </WhereCtx.Provider>
  );
}

function InspectorBody({
  flow,
  config,
  selected,
  apply,
  onSelect,
  onOpenSettings,
  onRemove,
  onAddHandoff,
  onMoveStep,
  onDeleted,
  workspace,
  botId,
  notes = [],
  onNoteChange,
  onNoteDelete,
}) {
  const agents = list(config?.agents?.items);
  const agentOf = (id) => agents.find((a) => a?.id === id);
  const indexOf = (id) => agents.findIndex((a) => a?.id === id);
  const set = (path, value, group) => apply(setAt(config, path, value), { group: group ?? `edit:${path.join('.')}` });
  const node = selected?.type === 'node' ? flow.nodes.find((n) => n.id === selected.id) : null;
  const edge = selected?.type === 'edge' ? flow.edges.find((e) => e.id === selected.id) : null;

  if (selected?.type === 'note') {
    const note = notes.find((n) => n.id === selected.id);
    if (note) return <NoteView note={note} edit={!!selected.edit} onChange={onNoteChange} onDelete={onNoteDelete} onClose={() => onSelect(null)} />;
  }
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
        onRemove={onRemove}
        onDeleted={onDeleted}
        indexOf={indexOf}
      />
    );

  const at = parseNodeId(node.id);
  // a way back to the first subagent: its block says what its arrow says
  if (node.type === 'back') {
    const back = flow.edges.find((e) => e.id === node.edge);
    if (back)
      return (
        <EdgeView
          edge={back}
          flow={flow}
          config={config}
          agents={agents}
          set={set}
          apply={apply}
          onSelect={onSelect}
          onRemove={onRemove}
          onDeleted={onDeleted}
          indexOf={indexOf}
        />
      );
  }
  if (node.type === 'trigger')
    return <ChannelView node={node} flow={flow} config={config} apply={apply} onClose={() => onSelect(null)} onOpenSettings={onOpenSettings} />;
  if (node.type === 'model' || node.type === 'knowledge') {
    const ai = indexOf(at.agent);
    const Plugged = node.type === 'model' ? ModelView : KnowledgePlugView;
    return <Plugged node={node} agent={agents[ai]} i={ai} config={config} apply={apply} onSelect={onSelect} onOpenSettings={onOpenSettings} />;
  }
  if (node.type === 'agent') {
    const i = indexOf(node.id);
    return (
      <AgentView
        node={node}
        agent={agents[i]}
        i={i}
        flow={flow}
        config={config}
        agents={agents}
        set={set}
        apply={apply}
        onSelect={onSelect}
        onOpenSettings={onOpenSettings}
        onRemove={onRemove}
        onAddHandoff={onAddHandoff}
        workspace={workspace}
        initialTab={selected.tab}
      />
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
        onMoveStep={onMoveStep}
        onOpenSettings={onOpenSettings}
      />
    );
  if (node.type === 'agentTransfer')
    return (
      <AgentTransferView
        node={node}
        owner={owner}
        config={config}
        flow={flow}
        workspace={workspace}
        botId={botId}
        apply={apply}
        onSelect={onSelect}
        onRemove={onRemove}
        onOpenSettings={onOpenSettings}
      />
    );
  return <ToolView node={node} owner={owner} config={config} set={set} apply={apply} onSelect={onSelect} onRemove={onRemove} onOpenSettings={onOpenSettings} />;
}

// A line it says, which may be one of the agent's fixed lines: shown in its words, and typing makes them its own words
// here (the fixed line stays as it is for whatever else says it).
// required: the words can't be left empty (the settings need at least one letter there), so an empty box says so rather than being taken as it is
function LineField({ id, label, value, config, onChange, hint, placeholder, rows = 3, required = '' }) {
  const fixed = isObj(value);
  const words = typeof value === 'string' ? value : fixed ? speechText(value, config) : '';
  return (
    <Field label={label} id={id} hint={fixed ? 'One of its fixed lines. Typing here makes it its own words; the fixed line stays as it is.' : hint}>
      <Text id={id} multiline rows={rows} value={words} placeholder={placeholder} onChange={onChange} />
      {required && !words.trim() && <p className="wfWarnText">{required}</p>}
    </Field>
  );
}

// ---- a subagent: what it is and how it talks (General), what it reads (Knowledge base), what it can do (Tools), the
// tests that check a call reaches it (Tests), and where it sends callers and who sends them to it (Edges)
const AGENT_TABS = [
  { id: 'general', label: 'General' },
  { id: 'knowledge', label: 'Knowledge base' },
  { id: 'tools', label: 'Tools' },
  { id: 'tests', label: 'Tests' },
  { id: 'edges', label: 'Edges' },
];

function AgentView({ node, agent, i, flow, config, agents, set, apply, onSelect, onOpenSettings, onRemove, onAddHandoff, workspace, initialTab }) {
  const [tab, setTab] = useState(AGENT_TABS.some((t) => t.id === initialTab) ? initialTab : 'general');
  const id = `wf-agent-${node.id}`;
  const path = ['agents', 'items', i];
  const write = (next, group) => apply(setAt(config, path, next), { group: group ?? `agent:${node.id}` });
  // what keeps it (the only agent; a test, a wrap-up or a task step that needs it): said, rather than a Delete that does nothing
  const keep = whyKeepAgent(config, node.id);
  return (
    <Shell
      icon="subagent"
      title={agent.name || agent.id}
      kicker="Subagent"
      onClose={() => onSelect(null)}
      tabs={{ items: AGENT_TABS, value: tab, onChange: setTab }}
    >
      {tab === 'general' && (
        <>
          <Field label="Name" id={`${id}-name`}>
            <Text id={`${id}-name`} value={agent.name || ''} onChange={(v) => set([...path, 'name'], v)} />
          </Field>
          <Field label="What kind of subagent" id={`${id}-kind`}>
            <Select
              id={`${id}-kind`}
              className="stFInput"
              value={agent.kind || 'specialist'}
              onChange={(event) => set([...path, 'kind'], event.target.value, `kind:${node.id}`)}
            >
              {KINDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            {agent.kind === 'standalone' && list(agent.handoffs).length > 0 && (
              // an agent that answers on its own has its hand-overs ignored
              <p className="wfWarnText">It answers on its own, so its hand-overs are not used. Choose “Passes callers on” to use them.</p>
            )}
          </Field>
          <Field
            label="What it does"
            id={`${id}-role`}
            hint={
              flow.entry === node.id
                ? 'It answers first, so these are also its instructions on the Agent page.'
                : 'Written to the agent, as you would brief a person.'
            }
          >
            <Text id={`${id}-role`} multiline rows={6} value={agent.instructions?.role || ''} onChange={(v) => set([...path, 'instructions', 'role'], v)} />
            {!String(agent.instructions?.role || '').trim() && (
              <p className="wfWarnText">It needs at least a line on what it does: the checks report it until there is one.</p>
            )}
          </Field>
          <AgentOverrides id={id} agent={agent} config={config} write={write} />
          <div className="wfRow">
            {config?.agents?.entry === node.id ? (
              <span className="wfTag good">
                <Icon name="check" size={14} /> Answers first
              </span>
            ) : (
              <button type="button" className="quietButton" onClick={() => apply(setEntry(config, node.id))}>
                Make it answer first
              </button>
            )}
            <button type="button" className="quietButton" onClick={() => onOpenSettings(path)}>
              All settings for this subagent
            </button>
          </div>
          {node.deadEnd && (
            // a caller passed to it would stay there: one click gives it a way to finish
            <section className="wfSection">
              <p className="wfWarnText">A caller passed to it can’t leave: it can’t end the conversation, hand over to a person or pass them back.</p>
              <div className="wfRow">
                <button type="button" className="quietButton" onClick={() => apply(addEnd(config, node.id).config)}>
                  Let it end the conversation
                </button>
              </div>
              <p className="wfMuted">
                Or press <Icon name="plus" size={13} className="wfInlineIcon" /> beside the block to pass callers on from it.
              </p>
            </section>
          )}
          <section className="wfSection">
            <h4>Delete</h4>
            <DeleteButton
              label="Delete this subagent"
              disabled={!!keep}
              why={keep || 'Callers can no longer be passed to it. Its hand-overs are removed too.'}
              onConfirm={() => onRemove(node.id)}
            />
          </section>
          <Where />
        </>
      )}
      {tab === 'knowledge' && <AgentKnowledge agent={agent} config={config} write={write} onOpenSettings={onOpenSettings} />}
      {tab === 'tools' && (
        <AgentTools agent={agent} config={config} workspace={workspace} apply={apply} onOpenSettings={onOpenSettings} isEntry={flow.entry === node.id} />
      )}
      {tab === 'tests' && <AgentTests agent={agent} config={config} apply={apply} onOpenSettings={onOpenSettings} />}
      {tab === 'edges' && <AgentEdges node={node} flow={flow} config={config} agents={agents} apply={apply} onSelect={onSelect} onAddHandoff={onAddHandoff} />}
    </Shell>
  );
}

// a setting the agent may have of its own: what it is, and whether it uses the default (with the way back to it when it doesn't)
function OwnSetting({ label, id, mine, onDefault, children }) {
  return (
    <div className="wfField wfOwn">
      <div className="wfOwnHead">
        <label htmlFor={id}>{label}</label>
        {mine ? (
          <button type="button" className="linkButton" onClick={onDefault}>
            Use the default
          </button>
        ) : (
          <small>Using default</small>
        )}
      </div>
      {children}
    </div>
  );
}

const grouped = (options) => {
  const groups = new Map();
  options.forEach((o) => groups.set(o.group, [...(groups.get(o.group) || []), o]));
  return [...groups.entries()];
};

// its own AI model, voice and whether it can be interrupted; each uses the default until it is changed here
function AgentOverrides({ id, agent, config, write }) {
  const { providers } = useProviders();
  const llm = llmChoice(agent, config);
  const voice = voiceChoice(agent, config);
  const interrupt = interruptChoice(agent);
  const own = isObj(agent.overrides?.models) ? agent.overrides.models : {};
  const realtime = isObj(own.realtime)
    ? own.realtime
    : own.realtime === undefined && isObj(config?.defaults?.models?.realtime)
      ? config.defaults.models.realtime
      : null;
  const special = realtime || own.llm === null || own.tts === null;
  return (
    <section className="wfSection wfOwnSet">
      <h4>How it talks</h4>
      {special ? (
        <p className="wfMuted">
          {realtime
            ? `It talks through a realtime model${realtime.model ? ` (${realtime.model})` : ''}, so its AI model and voice are set in All settings for this subagent.`
            : 'Its AI model and voice are set in All settings for this subagent.'}
        </p>
      ) : (
        <>
          <OwnSetting label="AI model" id={`${id}-llm`} mine={!!llm} onDefault={() => write(setLlm(agent, '', config))}>
            <Select id={`${id}-llm`} className="stFInput" value={llm} onChange={(event) => write(setLlm(agent, event.target.value, config, providers))}>
              <option value="">Default: {defaultLlm(config)}</option>
              {grouped(llmOptions(agent, providers, config)).map(([group, options]) => (
                <optgroup key={group} label={group}>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </OwnSetting>
          <OwnSetting label="Voice" id={`${id}-voice`} mine={!!voice} onDefault={() => write(setVoice(agent, '', config))}>
            <Select id={`${id}-voice`} className="stFInput" value={voice} onChange={(event) => write(setVoice(agent, event.target.value, config, providers))}>
              <option value="">Default: {defaultVoice(config)}</option>
              {grouped(voiceOptions(agent, config)).map(([group, options]) => (
                <optgroup key={group} label={group}>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </OwnSetting>
        </>
      )}
      <OwnSetting
        label="Callers can interrupt it"
        id={`${id}-interrupt`}
        mine={interrupt !== undefined}
        onDefault={() => write(setInterrupt(agent, undefined))}
      >
        <label className="wfCheck">
          <input
            id={`${id}-interrupt`}
            type="checkbox"
            checked={interrupt ?? defaultInterrupt(config)}
            onChange={(event) => write(setInterrupt(agent, event.target.checked), '')}
          />{' '}
          It stops talking when the caller starts
        </label>
      </OwnSetting>
    </section>
  );
}

// a row of a list with a switch at its end: a name, a line under it, and whether it is on
function ToggleRow({ label, sub, warn, checked, onChange, disabled, title }) {
  return (
    <li className="wfToggleRow" title={title}>
      <span>
        <strong>{label}</strong>
        {sub && <small className={warn ? 'wfWarnText' : undefined}>{sub}</small>}
      </span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </li>
  );
}

// ---- Knowledge base: what the subagent reads in every conversation (a base it looks up when it needs to is reached
// through a tool, so it is one of its tools); a base it is given that is not read that way is still listed, to be taken
// away
function AgentKnowledge({ agent, config, write, onOpenSettings }) {
  const reads = list(agent.knowledge);
  const all = list(config?.knowledge).filter((b) => isObj(b) && b.id);
  const bases = all.filter((b) => b.mode === 'inject' || reads.includes(b.id));
  const lookedUp = all.length - bases.length;
  const toggle = (baseId, on) => write({ ...agent, knowledge: on ? [...reads, baseId] : reads.filter((k) => k !== baseId) }, '');
  return (
    <section className="wfSection">
      <h4>Read in every conversation</h4>
      {bases.length === 0 ? (
        <p className="wfMuted">No knowledge yet.</p>
      ) : (
        <ul className="wfToggles">
          {bases.map((b) => (
            <ToggleRow
              key={b.id}
              label={b.id === KNOWLEDGE_ID ? 'What it knows' : humanize(b.id)}
              sub={b.description || ''}
              checked={reads.includes(b.id)}
              onChange={(on) => toggle(b.id, on)}
            />
          ))}
        </ul>
      )}
      {lookedUp > 0 && <p className="wfMuted">Knowledge it looks up when it needs to is one of its tools.</p>}
      <div className="wfRow">
        <button type="button" className="quietButton" onClick={() => onOpenSettings(['knowledge'])}>
          Add knowledge
        </button>
      </div>
    </section>
  );
}

// ---- Tools: the built-in ones (ending the call, going back, transfers to a number or to another agent, keypad tones,
// forms), then the tools set up on the Tools page. On: the subagent may use it. Off: what deleting its block does (a
// way to end the call or a transfer nobody else offers goes with it).
const isBuiltinTool = (t) => isObj(t) && (t.type === 'builtin' || (!t.type && t.builtin));
function AgentTools({ agent, config, workspace, apply, onOpenSettings, isEntry }) {
  const defined = list(config?.tools).filter((t) => isObj(t) && t.id);
  const offered = list(agent.tools).filter((t) => typeof t === 'string');
  const offers = (id) => offered.includes(id);
  // several at once in one change (an agent can offer two End tools, one for calls and one for chats): one after another from the same config would
  // each undo the one before
  const offAll = (toolIds) =>
    apply(
      toolIds.reduce((c, toolId) => removeNode(c, toolNodeId(agent.id, toolId)), config),
      { group: '' },
    );
  const off = (toolId) => offAll([toolId]);
  const on = (toolId) => apply(addTool(config, agent.id, toolId).config, { group: '' });
  const end = defined.filter((t) => isBuiltin(t, 'end_call'));
  const back = defined.filter((t) => isBuiltin(t, 'return_to_entry'));
  const transfers = defined.filter((t) => isBuiltin(t, 'transfer_or_callback'));
  const otherBuiltins = defined.filter((t) => isBuiltinTool(t) && !['end_call', 'return_to_entry', 'transfer_or_callback'].includes(t.builtin));
  const yours = defined.filter((t) => !isBuiltinTool(t));
  const missing = offered.filter((id) => !defined.some((t) => t.id === id));
  const endOn = end.some((t) => offers(t.id));
  const backOn = back.some((t) => offers(t.id));
  return (
    <>
      <section className="wfSection">
        <h4>Built-in tools</h4>
        <ul className="wfToggles">
          <ToggleRow
            label="End"
            sub="Says goodbye, then ends the conversation"
            checked={endOn}
            onChange={(next) => (next ? apply(addEnd(config, agent.id).config, { group: '' }) : offAll(end.filter((t) => offers(t.id)).map((t) => t.id)))}
          />
          <ToggleRow
            label="Back to the first subagent"
            sub={isEntry ? 'It answers first, so there is nowhere to go back to' : 'Passes the caller back to the one that answers first'}
            checked={backOn}
            disabled={isEntry && !backOn}
            onChange={(next) =>
              next ? apply(addBackToStart(config, agent.id).config, { group: '' }) : offAll(back.filter((t) => offers(t.id)).map((t) => t.id))
            }
          />
          {transfers.map((t) => {
            const { label, sub } = toolTitle(t, config, workspace);
            return <ToggleRow key={t.id} label={label} sub={sub} checked={offers(t.id)} onChange={(next) => (next ? on(t.id) : off(t.id))} />;
          })}
          {otherBuiltins.map((t) => (
            <ToggleRow
              key={t.id}
              label={toolName(t.id)}
              sub={toolTitle(t, config).sub}
              checked={offers(t.id)}
              onChange={(next) => (next ? on(t.id) : off(t.id))}
            />
          ))}
        </ul>
        <p className="wfMuted">
          Add a transfer to a number or to another of your agents with <Icon name="plus" size={13} className="wfInlineIcon" /> beside the block.
        </p>
      </section>
      <section className="wfSection">
        <h4>Your tools</h4>
        {yours.length + missing.length === 0 ? (
          <p className="wfMuted">No tools yet.</p>
        ) : (
          <ul className="wfToggles">
            {yours.map((t) => (
              <ToggleRow
                key={t.id}
                label={toolName(t.id)}
                sub={toolTitle(t, config).sub}
                checked={offers(t.id)}
                onChange={(next) => (next ? on(t.id) : off(t.id))}
              />
            ))}
            {missing.map((id) => (
              <ToggleRow key={id} label={toolName(id)} sub="Missing tool" warn checked onChange={() => off(id)} />
            ))}
          </ul>
        )}
        <div className="wfRow">
          <button type="button" className="quietButton" onClick={() => onOpenSettings(['tools'])}>
            Add tool
          </button>
        </div>
      </section>
    </>
  );
}

// ---- Tests: the tests that check a call ends with this subagent in charge (agent_is). "Add test" adds one, with a
// first caller line to change, and opens it on the Tests page.
function AgentTests({ agent, config, apply, onOpenSettings }) {
  const tests = list(config?.tests)
    .map((t, index) => ({ t, index }))
    .filter(({ t }) => isObj(t) && list(t.expect).some((e) => isObj(e) && e.agent_is === agent.id));
  const add = () => {
    const made = newScenario(config, freshScenarioId(config?.tests, `reaches_${agent.id}`));
    const test = { ...made, description: `A call reaches ${agent.name || agent.id}.`, expect: [{ agent_is: agent.id }] };
    const index = list(config?.tests).length;
    apply({ ...config, tests: [...list(config?.tests), test] }, { group: '' });
    onOpenSettings(['tests', index]);
  };
  return (
    <section className="wfSection wfTests">
      <div className="wfTestsHead">
        <h3>Tests</h3>
        <button type="button" className="quietButton" onClick={add}>
          Add test
        </button>
      </div>
      {tests.length === 0 ? (
        <div className="wfEmptyCard">
          <span className="wfIcon" aria-hidden="true">
            <Icon name="test" size={18} />
          </span>
          <strong>No tests yet</strong>
          <p>A test here checks that a call ends with this subagent in charge.</p>
          <button type="button" className="quietButton" onClick={add}>
            Add test
          </button>
        </div>
      ) : (
        <ul className="wfList">
          {tests.map(({ t, index }) => (
            <li key={`${t.id}-${index}`}>
              <button type="button" className="wfLink" onClick={() => onOpenSettings(['tests', index])}>
                <Icon name="test" size={15} />
                <span>
                  <strong>{t.description || humanize(t.id)}</strong>
                  <small>
                    {list(t.turns).length} caller turn{list(t.turns).length === 1 ? '' : 's'} · ends with this subagent
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- Edges: where the subagent can send the caller (other subagents, other agents), who sends callers to it, and a new hand-over to a subagent
function AgentEdges({ node, flow, config, agents, apply, onSelect, onAddHandoff }) {
  const nameOf = (agentId) => agents.find((a) => a?.id === agentId)?.name || agentId;
  const isAgent = (id) => agents.some((a) => a?.id === id);
  const target = (id) => flow.nodes.find((n) => n.id === id);
  const out = flow.edges.filter(
    (e) => e.from === node.id && ((['handoff', 'tool', 'return'].includes(e.kind) && isAgent(e.to)) || target(e.to)?.type === 'agentTransfer'),
  );
  const into = flow.edges.filter((e) => e.to === node.id && (isTriggerId(e.from) || isAgent(e.from)));
  const others = agents.filter((a) => a && a.id && a.id !== node.id);
  const row = (e, who, icon = 'swap') => (
    <li key={e.id}>
      <button type="button" className="wfLink" onClick={() => onSelect({ type: 'edge', id: e.id })}>
        <Icon name={icon} size={15} />
        <span>
          <strong>{who}</strong>
          <small className={e.missing ? 'wfWarnText' : undefined}>{e.missing ? 'Nothing says when yet.' : e.full || e.label}</small>
        </span>
      </button>
    </li>
  );
  return (
    <>
      <section className="wfSection">
        <h4>Where it can send the caller</h4>
        {out.length === 0 ? (
          <p className="wfMuted">
            Nowhere yet. Press <Icon name="plus" size={13} className="wfInlineIcon" /> beside the block and choose a subagent or a transfer.
          </p>
        ) : (
          <ul className="wfList">
            {out.map((e) =>
              target(e.to)?.type === 'agentTransfer' ? row(e, `${target(e.to).label} (agent transfer)`, 'userCog') : row(e, nameOf(e.to), 'subagent'),
            )}
          </ul>
        )}
        {(node.broken || []).length > 0 && (
          <ul className="wfList">
            {node.broken.map((b) => (
              <li key={b.handoff !== undefined ? `h${b.handoff}` : `e${b.enter}`} className="wfBroken">
                <span className="wfWarnText">A hand-over to “{b.to}”, which is not a subagent.</span>
                <button
                  type="button"
                  className="quietButton"
                  onClick={() => apply(removeHandoff(config, node.id, b.handoff !== undefined ? { handoff: b.handoff } : { enter: b.enter }), { group: '' })}
                >
                  Remove this hand-over
                </button>
              </li>
            ))}
          </ul>
        )}
        {others.length > 0 && (
          <Select
            className="stFInput"
            aria-label="Pass the caller to a subagent"
            value=""
            onChange={(event) => event.target.value && onAddHandoff?.(node.id, event.target.value)}
          >
            <option value="" disabled>
              Pass the caller to a subagent…
            </option>
            {others.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.id}
              </option>
            ))}
          </Select>
        )}
      </section>
      <section className="wfSection">
        <h4>Callers come from</h4>
        {into.length === 0 ? (
          <p className="wfMuted">Nobody passes callers to it yet.</p>
        ) : (
          <ul className="wfList">
            {into.map((e) => (isTriggerId(e.from) ? row(e, target(e.from)?.label || 'Start', 'bolt') : row(e, nameOf(e.from), 'subagent')))}
          </ul>
        )}
      </section>
    </>
  );
}

// ---- an Agent transfer: the call goes on to another agent of the workspace, through one of its numbers. Which agent,
// when the subagent makes it (the tool's own words, as on the Tools page), what is said while the transfer is made and
// how long to wait first.
const TRANSFER_TABS = [
  { id: 'general', label: 'General' },
  { id: 'edges', label: 'Edges' },
];
function AgentTransferView({ node, owner, config, flow, workspace, botId, apply, onSelect, onRemove, onOpenSettings }) {
  const [tab, setTab] = useState('general');
  const toolId = parseNodeId(node.id).tool;
  const { tool, transfer, index } = transferOf(config, toolId);
  const ti = list(config?.tools).findIndex((t) => t?.id === toolId);
  const id = `wf-${node.id}`;
  const agents = list(workspace?.agents).filter((a) => a.id !== botId);
  const chosen = agents.find((a) => a.id === node.bot);
  const say = list(transfer?.before).find((a) => isObj(a) && a.type === 'say')?.text;
  const when = typeof tool?.description === 'string' ? tool.description.trim() : '';
  const into = flow.edges.filter((e) => e.to === node.id);
  const group = (what) => ({ group: `transfer:${toolId}:${what}` });
  return (
    <Shell
      icon="userCog"
      title={node.label}
      kicker="Agent transfer"
      onClose={() => onSelect(null)}
      tabs={{ items: TRANSFER_TABS, value: tab, onChange: setTab }}
    >
      {tab === 'general' && (
        <>
          <Field label="Transfer to" id={`${id}-to`} hint={chosen ? `It reaches ${chosen.name} on ${node.number}.` : undefined}>
            <Select
              id={`${id}-to`}
              className="stFInput"
              value={node.bot || ''}
              onChange={(event) => {
                const next = agents.find((a) => a.id === event.target.value);
                if (next) apply(setTransferAgent(config, toolId, next), { group: '' });
              }}
            >
              {!chosen && (
                <option value={node.bot || ''} disabled>
                  {node.label}
                </option>
              )}
              {agents.map((a) => (
                <option key={a.id} value={a.id} disabled={!a.numbers.length} data-description={a.numbers.length ? a.numbers[0].number : 'No phone number yet'}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          {tool && (
            <Field
              label="When it transfers"
              id={`${id}-when`}
              hint={when ? 'The subagent reads this to decide when to transfer.' : 'Not said yet, so the subagent may not know when to transfer.'}
            >
              <Text
                id={`${id}-when`}
                multiline
                rows={3}
                value={typeof tool.description === 'string' ? tool.description : ''}
                placeholder="When the caller asks for billing."
                onChange={(v) => apply(setAt(config, ['tools', ti, 'description'], v), group('when'))}
              />
            </Field>
          )}
          <Field label="Say while transferring" id={`${id}-say`} hint="Optional. Said just before the call moves.">
            <Text
              id={`${id}-say`}
              multiline
              rows={3}
              value={typeof say === 'string' ? say : ''}
              placeholder="One moment, I’ll put you through."
              onChange={(v) => apply(setTransferSay(config, toolId, v), group('say'))}
            />
          </Field>
          <Field label="Delay before transfer (seconds)" id={`${id}-delay`}>
            <input
              id={`${id}-delay`}
              className="stFInput"
              type="number"
              min="0"
              step="0.5"
              value={transfer?.delay_s ?? 0}
              onChange={(event) => apply(setTransferDelay(config, toolId, event.target.value), group('delay'))}
            />
          </Field>
          {node.shared > 1 && <p className="wfNote">{node.shared} subagents use this transfer: changing it changes it for all of them.</p>}
          {ti >= 0 && (
            <div className="wfRow">
              <button type="button" className="quietButton" onClick={() => onOpenSettings(['tools', ti])}>
                All its settings on the Tools page
              </button>
            </div>
          )}
          <section className="wfSection">
            <h4>Delete</h4>
            <DeleteButton
              label={node.shared > 1 ? `Stop offering it to ${owner}` : 'Delete this block'}
              why={
                node.shared > 1
                  ? `Other subagents keep it. ${owner} can no longer transfer callers to ${node.label}.`
                  : `${owner} can no longer transfer callers to ${node.label}.`
              }
              onConfirm={() => onRemove(node.id)}
            />
          </section>
          {index >= 0 && <Where />}
        </>
      )}
      {tab === 'edges' && (
        <section className="wfSection">
          <h4>Callers come from</h4>
          <ul className="wfList">
            {into.map((e) => (
              <li key={e.id}>
                <button type="button" className="wfLink" onClick={() => onSelect({ type: 'edge', id: e.id })}>
                  <Icon name="subagent" size={15} />
                  <span>
                    <strong>{flow.nodes.find((n) => n.id === e.from)?.label || e.from}</strong>
                    <small className={e.missing ? 'wfWarnText' : undefined}>{e.missing ? 'Nothing says when yet.' : e.full}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Shell>
  );
}

// The panel's frame: the icon, what it is and its name; a button to hide the panel (the picture gets the whole width)
// and one to close what is selected; its parts as tabs when it has several (the configuration's place is then on its
// first part, which says so itself).
function Shell({ icon, title, kicker, children, onClose, tabs = null }) {
  const head = (
    <header>
      <span className="wfIcon" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <span>
        <small>{kicker}</small>
        <strong>{title}</strong>
      </span>
      <HideButton />
      <Tip label="Close">
        <button type="button" className="smClose" aria-label="Close this panel" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </Tip>
    </header>
  );
  if (tabs)
    return (
      <aside className="wfInspector" aria-label={`${kicker}: ${title}`}>
        <Parts value={tabs.value} onChange={tabs.onChange}>
          {head}
          <PartRow className="wfTabs" label={`${title}: parts`} items={tabs.items} value={tabs.value} />
          <div className="wfInspectorBody">
            <PartPanel value={tabs.value}>{children}</PartPanel>
          </div>
        </Parts>
      </aside>
    );
  return (
    <aside className="wfInspector" aria-label={`${kicker}: ${title}`}>
      {head}
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
  const button = useRef(null);
  const question = useRef(null);
  const was = useRef(false);
  useEffect(() => {
    if (asking) question.current?.querySelector('button')?.focus({ preventScroll: true });
    else if (was.current) button.current?.focus({ preventScroll: true });
    was.current = asking;
  }, [asking]);
  if (asking) {
    return (
      <div className="wfConfirm" role="group" aria-label={label} ref={question}>
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
    <>
      <button ref={button} type="button" className="quietButton wfDanger" disabled={disabled} onClick={() => setAsking(true)}>
        <Icon name="trash" size={15} /> {label}
      </button>
      {disabled && why && <p className="wfMuted">{why}</p>}
    </>
  );
}

// the button that hides the panel (the picture gets the whole width): in every panel's frame, and on the overview
function HideButton() {
  const ctx = useContext(WhereCtx);
  if (!ctx?.onHide) return null;
  return (
    <Tip label="Hide the panel">
      <button type="button" className="smClose" aria-label="Hide the panel" onClick={ctx.onHide}>
        <Icon name="panelRight" size={16} />
      </button>
    </Tip>
  );
}

// ---- nothing selected
function Overview({ flow, config, apply, onSelect }) {
  const agents = list(config?.agents?.items);
  const isAgent = (id) => agents.some((a) => a?.id === id);
  const counts = { agents: agents.length, hand: flow.edges.filter((e) => e.kind !== 'start' && isAgent(e.from) && isAgent(e.to)).length };
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
        <HideButton />
      </header>
      <div className="wfInspectorBody">
        <p className="wfMuted">
          {counts.agents === 1
            ? 'One subagent answers every call.'
            : `${counts.agents} subagents, ${counts.hand} way${counts.hand === 1 ? '' : 's'} to pass a caller between them.`}{' '}
          Pick a block or an arrow to change it.
        </p>
        {agents.length > 1 && (
          <Field label="Who answers first" id="wf-entry">
            <Select
              id="wf-entry"
              className="stFInput"
              value={flow.entryUnset ? '' : flow.entry}
              onChange={(event) => apply(setEntry(config, event.target.value))}
            >
              {flow.entryUnset && (
                <option value="" disabled>
                  Choose who answers first
                </option>
              )}
              {agents
                .filter((a) => a && a.id)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || a.id}
                  </option>
                ))}
            </Select>
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
              <b>Add</b> by selecting a subagent and pressing <Icon name="plus" size={13} className="wfInlineIcon" /> beside it: a subagent, a line to say,
              something to remember, a way to another subagent, a transfer to another of your agents or to a number, a tool, the end of the call. Or draw an
              arrow from the right edge of one subagent to another, or pick one of the Templates.
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

// ---- a sticky note: what it says and its colour (kept in this browser: the agent's configuration has no place for notes)
function NoteView({ note, edit, onChange, onDelete, onClose }) {
  const box = useRef(null);
  useEffect(() => {
    if (edit) box.current?.focus({ preventScroll: true });
  }, [edit]);
  return (
    <Shell icon="note" title="Note" kicker="Sticky note" onClose={onClose}>
      <Field label="What it says" id="wf-note-text" hint="Notes are kept in this browser only: the agent’s configuration has no place for them.">
        <textarea
          ref={box}
          id="wf-note-text"
          className="stFInput"
          rows={7}
          value={note.text}
          placeholder="What to remember about this part of the workflow"
          onChange={(event) => onChange(note.id, { text: event.target.value })}
        />
      </Field>
      <div className="wfField">
        <span className="wfFieldLabel">Colour</span>
        <div className="wfSwatches" role="radiogroup" aria-label="Colour">
          {NOTE_COLORS.map(([color, name]) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={(note.color || 'yellow') === color}
              aria-label={name}
              title={name}
              className={`wfSwatch ${color}`}
              onClick={() => onChange(note.id, { color })}
            />
          ))}
        </div>
      </div>
      <section className="wfSection">
        <h4>Delete</h4>
        <DeleteButton label="Delete this note" why="The note is gone from this browser." onConfirm={() => onDelete(note.id)} />
      </section>
    </Shell>
  );
}

// ---- a channel a call comes in on: whether it is on (on the Channels page), what it says first, and who answers. What
// it says first is written to it and to every other channel that says the same line, as the Agent page's greeting is
// (simpleModel.js); which channels, kept from the first change, so that emptying the field and typing again writes to
// the same ones.
function ChannelView({ node, flow, config, apply, onClose, onOpenSettings }) {
  const agents = list(config?.agents?.items);
  const channel = node.channel ? list(config?.channels)[node.channelIndex] : null;
  const [target, setTarget] = useState(null);
  const mine = target || (channel ? channelGreetingTarget(config, node.channelIndex) : []);
  const greeting = channel ? greetingOf(config, mine) : null;
  const id = `wf-greeting-${node.channelIndex}`;
  return (
    <Shell icon={node.channel ? 'bolt' : 'flag'} title={node.label} kicker={node.channel ? 'Where a call comes in' : 'Where a call begins'} onClose={onClose}>
      {channel ? (
        <>
          <p className={node.off ? 'wfWarnText' : 'wfMuted'}>
            {node.off
              ? 'Switched off: nothing comes in this way until it is switched on.'
              : 'Calls and chats come in here, then the subagent that answers first takes over.'}
          </p>
          <Field
            label="What it says first"
            id={id}
            hint={[
              mine.length > 1 ? `${mine.length} channels say this line, so it changes on all of them.` : '',
              greeting.reference ? 'It is one of the agent’s fixed lines; changing it changes that line.' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <Text
              id={id}
              multiline
              rows={3}
              value={greeting.text}
              placeholder="Nothing: it waits for the caller to speak first."
              onChange={(v) => {
                if (!target) setTarget(mine);
                apply(setGreeting(config, v, mine), { group: `greeting:${node.id}` });
              }}
            />
          </Field>
          <div className="wfRow">
            <button type="button" className="quietButton" onClick={() => onOpenSettings(['channels', node.channelIndex])}>
              {node.off ? 'Switch it on on the Channels page' : 'Open it on the Channels page'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="wfMuted">This agent has no channel yet: add one, and calls and chats come in through it.</p>
          <div className="wfRow">
            <button type="button" className="quietButton" onClick={() => onOpenSettings(['channels'])}>
              Open the Channels page
            </button>
          </div>
        </>
      )}
      <Field label="Who answers first" id="wf-start-entry">
        <Select
          id="wf-start-entry"
          className="stFInput"
          value={flow.entryUnset ? '' : flow.entry}
          onChange={(event) => apply(setEntry(config, event.target.value))}
        >
          {flow.entryUnset && (
            <option value="" disabled>
              Choose who answers first
            </option>
          )}
          {agents
            .filter((a) => a && a.id)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.id}
              </option>
            ))}
        </Select>
      </Field>
    </Shell>
  );
}

// ---- the AI model plugged into a subagent: its own, or the default, with its voice and interruptions (as on its General part)
function ModelView({ node, agent, i, config, apply, onSelect }) {
  const write = (next, group) => apply(setAt(config, ['agents', 'items', i], next), { group: group ?? `agent:${agent.id}` });
  return (
    <Shell icon="sparkle" title={node.label} kicker={`AI model of ${agent.name || agent.id}`} onClose={() => onSelect(null)}>
      <p className="wfMuted">{node.own ? 'This subagent has a model of its own.' : 'It uses the agent’s default model until it is given one of its own.'}</p>
      <AgentOverrides id={`wf-model-${agent.id}`} agent={agent} config={config} write={write} />
      <div className="wfRow">
        <button type="button" className="quietButton" onClick={() => onSelect({ type: 'node', id: agent.id })}>
          Open {agent.name || agent.id}
        </button>
      </div>
    </Shell>
  );
}

// ---- knowledge plugged into a subagent: read on every turn
function KnowledgePlugView({ node, agent, i, config, apply, onSelect, onOpenSettings }) {
  const base = list(config?.knowledge).find((b) => isObj(b) && b.id === node.base);
  const readers = list(config?.agents?.items).filter((a) => isObj(a) && list(a.knowledge).includes(node.base));
  const stop = () => {
    apply(
      setAt(
        config,
        ['agents', 'items', i, 'knowledge'],
        list(agent.knowledge).filter((k) => k !== node.base),
      ),
      { group: '' },
    );
    onSelect({ type: 'node', id: agent.id, tab: 'knowledge' });
  };
  return (
    <Shell icon="book" title={node.label} kicker={`Knowledge ${agent.name || agent.id} reads`} onClose={() => onSelect(null)}>
      {base ? (
        <p className="wfMuted">Read on every turn{base.description ? `: ${base.description}` : '.'}</p>
      ) : (
        <p className="wfWarnText">“{node.base}” is not knowledge this agent has. Take it away, or add it on the Knowledge page.</p>
      )}
      {readers.length > 1 && <p className="wfNote">{readers.length} subagents read it.</p>}
      <div className="wfRow">
        <button type="button" className="quietButton" onClick={() => onOpenSettings(['knowledge'])}>
          Open the Knowledge page
        </button>
      </div>
      <section className="wfSection">
        <h4>Delete</h4>
        <DeleteButton label={`Stop ${agent.name || agent.id} reading it`} why="The knowledge stays on the Knowledge page." onConfirm={stop} />
      </section>
    </Shell>
  );
}

// ---- what an agent does as it takes over
function EnterView({ node, agent, ai, owner, config, set, apply, onSelect, onRemove, onMoveStep, onOpenSettings }) {
  const index = parseNodeId(node.id).index;
  const steps = list(agent?.on_enter);
  const action = steps[index];
  const transfers = list(config?.telephony?.transfers).filter((t) => isObj(t) && t.id);
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
      {action?.type === 'say' && (
        <LineField
          id={`${id}-text`}
          label="What it says"
          value={action.text}
          config={config}
          rows={4}
          hint="Spoken, or written in a chat, as soon as this agent takes over."
          required="A step that says something needs the words to say: write them, or delete the step."
          onChange={(v) => set([...base, 'text'], v)}
        />
      )}
      {action?.type === 'set_state' && (
        <StateRows values={isObj(action.values) ? action.values : {}} variables={variables} config={config} apply={apply} path={[...base, 'values']} />
      )}
      {action?.type === 'transfer' && (
        <Field label="Transfer" id={`${id}-transfer`}>
          <Select
            id={`${id}-transfer`}
            className="stFInput"
            value={transfers.some((t) => t.id === action.transfer) ? action.transfer : ''}
            onChange={(event) => set([...base, 'transfer'], event.target.value)}
          >
            {!transfers.some((t) => t.id === action.transfer) && (
              <option value="" disabled>
                Choose a transfer
              </option>
            )}
            {transfers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id}
              </option>
            ))}
          </Select>
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
      {steps.length > 1 && onMoveStep && (
        // the order matters: a line said before a hand-over, a variable set before a line that uses it
        <section className="wfSection">
          <h4>When it runs</h4>
          <p className="wfMuted">
            Step {index + 1} of {steps.length} as {owner} takes over.
          </p>
          <div className="wfRow">
            <button type="button" className="quietButton" disabled={index === 0} onClick={() => onMoveStep(agent.id, index, -1)}>
              Run it earlier
            </button>
            <button type="button" className="quietButton" disabled={index === steps.length - 1} onClick={() => onMoveStep(agent.id, index, 1)}>
              Run it later
            </button>
          </div>
        </section>
      )}
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
  const newButton = useRef(null);
  const nameBox = useRef(null);
  const wasAdding = useRef(false);
  useEffect(() => {
    if (adding) nameBox.current?.focus({ preventScroll: true });
    else if (wasAdding.current) newButton.current?.focus({ preventScroll: true });
    wasAdding.current = adding;
  }, [adding]);
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
            <span className="wfPairName" title={name}>
              {name}
            </span>
            {['object', 'array'].includes(variables[name]?.type) ? (
              <code className="wfPairName" title="Change this one in its settings">
                {JSON.stringify(value)}
              </code>
            ) : variables[name]?.type === 'enum' ? (
              <Select
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
              </Select>
            ) : variables[name]?.type === 'boolean' ? (
              <Select
                className="stFInput"
                aria-label={`Value of ${name}`}
                value={String(!!value)}
                onChange={(event) => write({ ...values, [name]: typed(name, event.target.value) })}
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </Select>
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
              aria-label={`Delete ${name}`}
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
        <Select
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
        </Select>
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
            ref={nameBox}
            className="stFInput mono"
            aria-label="Variable name"
            placeholder="caller_intent"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value.toLowerCase() })}
          />
          <Select className="stFInput" aria-label="It holds" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value })}>
            <option value="string">Text</option>
            <option value="integer">A number</option>
            <option value="boolean">Yes / no</option>
          </Select>
          <button type="submit" className="primaryCta compactCta" disabled={!/^[a-z][a-z0-9_]{0,63}$/.test(draft.name) || draft.name in variables}>
            Add it
          </button>
          <button type="button" className="quietButton" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button ref={newButton} type="button" className="stAddBtn" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> New variable
        </button>
      )}
    </section>
  );
}

// ---- what an agent can do: its tools A tool block: what the tool does here, and what it says, written here as on the
// Tools page (it is the same tool): when it is used, what it says before it ends the conversation, the number a
// transfer passes calls to. The rest of its settings are on the Tools page.
function ToolView({ node, owner, config, set, apply, onSelect, onRemove, onOpenSettings }) {
  const toolId = parseNodeId(node.id).tool;
  const ti = list(config?.tools).findIndex((t) => t?.id === toolId);
  const tool = list(config?.tools)[ti];
  const transfer = node.type === 'transfer' ? list(config?.telephony?.transfers).find((t) => t?.id === tool?.params?.transfer) : null;
  const ti2 = transfer ? list(config.telephony.transfers).indexOf(transfer) : -1;
  const id = `wf-${node.id}`;
  const shared =
    node.shared > 1 ? (
      <p className="wfNote">
        {node.shared} agents use this {node.type === 'end' ? 'way of ending the conversation' : node.type === 'transfer' ? 'transfer' : 'tool'}: changing it
        changes it for all of them.
      </p>
    ) : null;
  const when = typeof tool?.description === 'string' ? tool.description : '';
  // an optional line: emptied, it is taken away
  const setOrUnset = (path, v, group) => (v ? set(path, v, group) : apply(unsetAt(config, path), { group }));
  return (
    <Shell
      icon={node.type === 'end' ? 'endCall' : node.type === 'transfer' ? 'phoneTransfer' : 'tools'}
      title={node.label}
      kicker={`${owner} can use this`}
      onClose={() => onSelect(null)}
    >
      {!tool && <p className="wfWarn">This agent offers “{toolId}”, but there is no such tool. Delete this block, or create the tool on the Tools page.</p>}
      {node.type === 'tool' && tool && <p className="wfMuted">{node.sub}.</p>}
      {node.type === 'transfer' &&
        tool &&
        (!transfer ? (
          <p className="wfWarnText">This transfer is not set up yet.</p>
        ) : transfer.target === undefined || typeof transfer.target === 'string' ? (
          <Field
            label="Number it passes calls to"
            id={`${id}-number`}
            hint={node.noNumber ? 'No number yet: callers are offered a callback instead.' : 'A phone number with + and the country code, or a SIP address.'}
          >
            <Text
              id={`${id}-number`}
              mono
              value={transfer.target || ''}
              placeholder="+44 20 7946 0000"
              onChange={(v) => setOrUnset(['telephony', 'transfers', ti2, 'target'], v.trim() ? v : '', `transfer:${transfer.id}:number`)}
            />
          </Field>
        ) : (
          <p className="wfMuted wfNumber">
            The number is {node.sub}.{' '}
            <button type="button" className="linkButton" onClick={() => onOpenSettings(['telephony', 'transfers', ti2])}>
              Change it
            </button>
          </p>
        ))}
      {tool && node.type === 'end' && (
        <LineField
          id={`${id}-goodbye`}
          label="What it says before it ends the conversation"
          value={tool.params?.say}
          config={config}
          hint="Leave it empty and the conversation ends without a goodbye."
          placeholder="Thanks for calling. Goodbye!"
          onChange={(v) => setOrUnset(['tools', ti, 'params', 'say'], v, `tool:${toolId}:say`)}
        />
      )}
      {tool && (
        <Field
          label="When it uses it"
          id={`${id}-when`}
          hint={when.trim() ? 'The agent reads this to decide when to use it.' : 'Not said yet, so the agent may not know when to use it.'}
        >
          <Text id={`${id}-when`} multiline rows={3} value={when} onChange={(v) => set(['tools', ti, 'description'], v, `tool:${toolId}:when`)} />
        </Field>
      )}
      {shared}
      {tool && (
        <div className="wfRow">
          <button type="button" className="quietButton" onClick={() => onOpenSettings(['tools', ti])}>
            All its settings on the Tools page
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
function EdgeView({ edge, flow, config, agents, set, apply, onSelect, onRemove, onDeleted, indexOf }) {
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
          <Select
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
          </Select>
        </Field>
        <LineField
          id={`${id}-say`}
          label="Say while handing over"
          value={h.announce}
          config={config}
          rows={2}
          hint="Optional. Spoken while the next agent gets ready."
          placeholder="One moment, I’ll put you through."
          onChange={(v) => {
            const next = { ...h };
            if (v) next.announce = v;
            else delete next.announce;
            set(base, next);
          }}
        />
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
              const next = removeHandoff(config, ref.agent, { handoff: ref.handoff });
              apply(next, { group: '' });
              onDeleted?.(title, next);
              onSelect(null);
            }}
          />
        </section>
      </Shell>
    );
  }
  if (ref.enter !== undefined || (edge.kind === 'return' && ref.tool)) {
    const stop = () => {
      const next = removeHandoff(config, ref.agent, ref.enter !== undefined ? { enter: ref.enter } : { tool: ref.tool });
      apply(next, { group: '' });
      onDeleted?.(title, next);
      onSelect(null);
    };
    return (
      <Shell icon="swap" title={title} kicker={kicker} onClose={() => onSelect(null)}>
        <p className="wfMuted">
          {ref.enter !== undefined
            ? `As soon as ${from?.label} takes over, it passes the caller on.`
            : `${from?.label} can send the caller back to ${to?.label}${ref.tool ? ` with the tool “${toolName(ref.tool)}”` : ''}.`}
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
            <h4>{isTool ? `Tool “${toolName(rid)}”` : `Safety rule “${humanize(rid)}”`}</h4>
            {isTool && agentsUsingTool(config, rid).length > 1 && (
              <p className="wfNote">{agentsUsingTool(config, rid).length} agents use this tool: changing it changes it for all of them.</p>
            )}
            <Field label="Passes the caller to" id={`${id}-${rid}-to`}>
              <Select
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
              </Select>
            </Field>
            <DeleteButton
              label={isTool ? 'Stop it handing over' : 'Delete this safety rule'}
              why={
                isTool
                  ? `The tool “${toolName(rid)}” stays, but no longer passes the caller to ${to?.label}.`
                  : `The safety rule “${humanize(rid)}” is deleted: it no longer does anything.`
              }
              onConfirm={() => {
                const next = isTool ? removeToolHandoff(config, rid, edge.to) : removeRule(config, rid);
                apply(next, { group: '' });
                onDeleted?.(title, next);
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
    exit: 'The agent can do this.',
    uses: 'The agent can use this tool.',
    enter: 'This runs first, when the agent takes over.',
  };
  // the block this arrow joins to its agent: the tool's block (exit, uses) or the step's (enter)
  const block = edge.kind === 'enter' ? from : edge.kind === 'exit' || edge.kind === 'uses' ? to : null;
  const owner = edge.kind === 'enter' ? to : from;
  return (
    <Shell icon="swap" title={title} kicker={kicker} onClose={() => onSelect(null)}>
      <p className="wfMuted">{words[edge.kind] || ''}</p>
      <div className="wfRow">
        {[from, to].filter(Boolean).map((n) => (
          <button key={n.id} type="button" className="quietButton" onClick={() => onSelect({ type: 'node', id: n.id })}>
            Go to {n.label}
          </button>
        ))}
      </div>
      {block && owner && (
        <section className="wfSection">
          <h4>Delete</h4>
          <DeleteButton
            label={edge.kind === 'enter' ? 'Delete this step' : block.shared > 1 ? `Stop offering it to ${owner.label}` : 'Delete this block'}
            why={edge.kind === 'enter' ? 'The agent stops doing this when it takes over.' : `${owner.label} can no longer do this.`}
            onConfirm={() => onRemove(block.id)}
          />
        </section>
      )}
    </Shell>
  );
}
