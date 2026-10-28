import React, { useState } from 'react';
import Icon from '../../../ui/Icon.jsx';
import { isObj } from '../../form/engine.js';
import { setAt } from '../../form/inlineCreate.js';
import { setTransferAgent, setTransferDelay, setTransferSay, transferOf } from '../workflowOps.js';
import { parseNodeId } from '../workflowModel.js';
import Select from '../../../ui/Select.tsx';
import Button from '../../../ui/Button.tsx';
import { Input } from '../../../ui/Input.tsx';
import { list, Field, Text, Where, Shell, DeleteButton } from './panelParts.jsx';

// The side panel for an Agent transfer: the call moves on to another workspace agent.

// ---- an Agent transfer: the call moves on to another workspace agent through one of its numbers. Which agent, when
// (the tool's own words, as on the Tools page), what is said during the transfer and how long to wait first.
const TRANSFER_TABS = [
  { id: 'general', label: 'General' },
  { id: 'edges', label: 'Edges' },
];
export function AgentTransferView({ node, owner, config, flow, workspace, botId, apply, onSelect, onRemove, onOpenSettings }) {
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
            <Input
              id={`${id}-delay`}
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
              <Button type="button" onClick={() => onOpenSettings(['tools', ti])}>
                All its settings on the Tools page
              </Button>
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
