import React from 'react';
import { removeHandoff, removeRule, removeToolHandoff, retargetRule, retargetToolHandoff } from '../workflowOps.js';
import { toolName } from '../workflowModel.js';
import { humanize } from '../../agent/rowNames.js';
import Select from '../../../ui/Select.tsx';
import { agentsUsingTool } from '../../form/toolInfo.js';
import Button from '../../../ui/Button.tsx';
import { list, Field, Text, LineField, Shell, DeleteButton } from './panelParts.jsx';

// The side panel for an arrow: a hand-over, a tool's or safety rule's way on, or a step.

// ---- an arrow
export function EdgeView({ edge, flow, config, agents, set, apply, onSelect, onRemove, onDeleted, indexOf }) {
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
          <Button key={n.id} type="button" onClick={() => onSelect({ type: 'node', id: n.id })}>
            Go to {n.label}
          </Button>
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
