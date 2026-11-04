import React from 'react';
import { isObj } from '../../form/engine.js';
import { getAt, setAt } from '../../form/inlineCreate.js';
import { parseNodeId } from '../workflowModel.js';
import Button from '../../../ui/Button.tsx';
import { list, Field, Text, LineField, Shell, DeleteButton } from './panelParts.jsx';

// The side panel for a tool block, edited as on the Tools page.

// the configuration without the value at a path (a field emptied leaves nothing behind)
const unsetAt = (root, path) => {
  const parent = getAt(root, path.slice(0, -1));
  if (!isObj(parent) || !(path.at(-1) in parent)) return root;
  const rest = { ...parent };
  delete rest[path.at(-1)];
  return setAt(root, path.slice(0, -1), rest);
};

// ---- a tool block, edited as on the Tools page (it is the same tool): when it is used, its goodbye line, a transfer's
// number. The rest of its settings are on the Tools page.
export function ToolView({ node, owner, config, set, apply, onSelect, onRemove, onOpenSettings }) {
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
  // an optional line: emptied, it is removed
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
