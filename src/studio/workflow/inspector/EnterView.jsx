import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../ui/Icon.jsx';
import { isObj } from '../../form/engine.js';
import { setAt } from '../../form/inlineCreate.js';
import { addStateVariable, blankValue } from '../workflowOps.js';
import { parseNodeId } from '../workflowModel.js';
import Select from '../../../ui/Select.tsx';
import Button from '../../../ui/Button.tsx';
import { Input } from '../../../ui/Input.tsx';
import { list, Field, LineField, Shell, DeleteButton } from './panelParts.jsx';

// The side panel for what an agent does as it takes over, with its "Update state" rows.

// ---- what an agent does as it takes over
export function EnterView({ node, agent, ai, owner, config, set, apply, onSelect, onRemove, onMoveStep, onOpenSettings }) {
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
        <Button type="button" onClick={() => onOpenSettings(['agents', 'items', ai, 'on_enter'])}>
          Open its settings
        </Button>
      </div>
      {steps.length > 1 && onMoveStep && (
        // the order matters: a line said before a hand-over, a variable set before a line that uses it
        <section className="wfSection">
          <h4>When it runs</h4>
          <p className="wfMuted">
            Step {index + 1} of {steps.length} as {owner} takes over.
          </p>
          <div className="wfRow">
            <Button type="button" disabled={index === 0} onClick={() => onMoveStep(agent.id, index, -1)}>
              Run it earlier
            </Button>
            <Button type="button" disabled={index === steps.length - 1} onClick={() => onMoveStep(agent.id, index, 1)}>
              Run it later
            </Button>
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
              <Input
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
          <Input
            ref={nameBox}
            mono
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
          <Button type="submit" variant="primary" size="compact" disabled={!/^[a-z][a-z0-9_]{0,63}$/.test(draft.name) || draft.name in variables}>
            Add it
          </Button>
          <Button type="button" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <button ref={newButton} type="button" className="stAddBtn" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> New variable
        </button>
      )}
    </section>
  );
}
