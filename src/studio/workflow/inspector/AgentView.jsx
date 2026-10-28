import React, { useState } from 'react';
import Icon from '../../../ui/Icon.jsx';
import { isObj } from '../../form/engine.js';
import { setAt } from '../../form/inlineCreate.js';
import { addBackToStart, addEnd, addTool, removeHandoff, removeNode, isBuiltin, setEntry, whyKeepAgent } from '../workflowOps.js';
import { Switch } from '../../form/fields.jsx';
import { freshScenarioId, newScenario } from '../../scenarios/model.js';
import { isTriggerId, toolName, toolNodeId, toolTitle } from '../workflowModel.js';
import { humanize } from '../../agent/rowNames.js';
import { KNOWLEDGE_ID } from '../../setup/setupModel.js';
import Select from '../../../ui/Select.tsx';
import Button from '../../../ui/Button.tsx';
import { list, Field, Text, Where, Shell, DeleteButton } from './panelParts.jsx';
import { AgentOverrides } from './AgentOverrides.jsx';

// The side panel for a subagent: its tabs General, Knowledge base, Tools, Tests and Edges.

const KINDS = [
  ['router', 'Passes callers on'],
  ['specialist', 'Does one job'],
  ['standalone', 'Answers on its own'],
];

// ---- a subagent, in tabs: General (what it is, how it talks), Knowledge base, Tools, Tests (that a call reaches it)
// and Edges (where it sends callers, and who sends them to it)
const AGENT_TABS = [
  { id: 'general', label: 'General' },
  { id: 'knowledge', label: 'Knowledge base' },
  { id: 'tools', label: 'Tools' },
  { id: 'tests', label: 'Tests' },
  { id: 'edges', label: 'Edges' },
];

export function AgentView({ node, agent, i, flow, config, agents, set, apply, onSelect, onOpenSettings, onRemove, onAddHandoff, workspace, initialTab }) {
  const [tab, setTab] = useState(AGENT_TABS.some((t) => t.id === initialTab) ? initialTab : 'general');
  const id = `wf-agent-${node.id}`;
  const path = ['agents', 'items', i];
  const write = (next, group) => apply(setAt(config, path, next), { group: group ?? `agent:${node.id}` });
  // what keeps it (the only agent, or a test, wrap-up or task step needs it), shown instead of a useless Delete
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
              <Button type="button" onClick={() => apply(setEntry(config, node.id))}>
                Make it answer first
              </Button>
            )}
            <Button type="button" onClick={() => onOpenSettings(path)}>
              All settings for this subagent
            </Button>
          </div>
          {node.deadEnd && (
            // a caller passed to it would stay there: one click gives it a way to finish
            <section className="wfSection">
              <p className="wfWarnText">A caller passed to it can’t leave: it can’t end the conversation, hand over to a person or pass them back.</p>
              <div className="wfRow">
                <Button type="button" onClick={() => apply(addEnd(config, node.id).config)}>
                  Let it end the conversation
                </Button>
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

// a list row with a switch at its end: a name, a line under it, and whether it is on
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

// ---- Knowledge base: what the subagent reads in every conversation (a base looked up on demand is reached through a
// tool, so it counts as a tool). A base it was given that isn't read that way is still listed, so it can be removed.
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
        <Button type="button" onClick={() => onOpenSettings(['knowledge'])}>
          Add knowledge
        </Button>
      </div>
    </section>
  );
}

// ---- Tools: the built-in ones (ending the call, going back, transfers, keypad tones, forms), then the Tools page's.
// Switching one off does what deleting its block does (an end or transfer nobody else offers goes with it).
const isBuiltinTool = (t) => isObj(t) && (t.type === 'builtin' || (!t.type && t.builtin));
function AgentTools({ agent, config, workspace, apply, onOpenSettings, isEntry }) {
  const defined = list(config?.tools).filter((t) => isObj(t) && t.id);
  const offered = list(agent.tools).filter((t) => typeof t === 'string');
  const offers = (id) => offered.includes(id);
  // switch several off in one change (an agent can offer two End tools, for calls and chats): applying each to the
  // same config in turn would undo the one before
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
          <Button type="button" onClick={() => onOpenSettings(['tools'])}>
            Add tool
          </Button>
        </div>
      </section>
    </>
  );
}

// ---- Tests: the tests checking that a call ends with this subagent in charge (agent_is). "Add test" adds one with a
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
        <Button type="button" onClick={add}>
          Add test
        </Button>
      </div>
      {tests.length === 0 ? (
        <div className="wfEmptyCard">
          <span className="wfIcon" aria-hidden="true">
            <Icon name="test" size={18} />
          </span>
          <strong>No tests yet</strong>
          <p>A test here checks that a call ends with this subagent in charge.</p>
          <Button type="button" onClick={add}>
            Add test
          </Button>
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

// ---- Edges: where the subagent can send the caller, who sends callers to it, and a new hand-over to a subagent
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
                <Button
                  type="button"
                  onClick={() => apply(removeHandoff(config, node.id, b.handoff !== undefined ? { handoff: b.handoff } : { enter: b.enter }), { group: '' })}
                >
                  Remove this hand-over
                </Button>
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
