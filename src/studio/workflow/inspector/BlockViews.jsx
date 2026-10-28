import React, { useEffect, useRef, useState } from 'react';
import { isObj } from '../../form/engine.js';
import { setAt } from '../../form/inlineCreate.js';
import { setEntry } from '../workflowOps.js';
import { NOTE_COLORS } from '../notes.js';
import { channelGreetingTarget, greetingOf, setGreeting } from '../../simple/simpleModel.js';
import Select from '../../../ui/Select.tsx';
import Button from '../../../ui/Button.tsx';
import { TextArea } from '../../../ui/Input.tsx';
import { list, Field, Text, Shell, DeleteButton } from './panelParts.jsx';
import { AgentOverrides } from './AgentOverrides.jsx';

// The side panels for a sticky note, a channel, and the AI model or knowledge plugged into a subagent.

// ---- a sticky note: its words and colour (kept in this browser; the configuration has no place for notes)
export function NoteView({ note, edit, onChange, onDelete, onClose }) {
  const box = useRef(null);
  useEffect(() => {
    if (edit) box.current?.focus({ preventScroll: true });
  }, [edit]);
  return (
    <Shell icon="note" title="Note" kicker="Sticky note" onClose={onClose}>
      <Field label="What it says" id="wf-note-text" hint="Notes are kept in this browser only: the agent’s configuration has no place for them.">
        <TextArea
          ref={box}
          id="wf-note-text"
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

// ---- a channel: whether it is on (Channels page), its greeting and who answers first. The greeting goes to every
// channel sharing that line (simpleModel.js), fixed at the first edit so clearing and retyping writes the same ones.
export function ChannelView({ node, flow, config, apply, onClose, onOpenSettings }) {
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
            <Button type="button" onClick={() => onOpenSettings(['channels', node.channelIndex])}>
              {node.off ? 'Switch it on on the Channels page' : 'Open it on the Channels page'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="wfMuted">This agent has no channel yet: add one, and calls and chats come in through it.</p>
          <div className="wfRow">
            <Button type="button" onClick={() => onOpenSettings(['channels'])}>
              Open the Channels page
            </Button>
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

// ---- the AI model plugged into a subagent: its own or the default, with voice and interruptions (as on General)
export function ModelView({ node, agent, i, config, apply, onSelect }) {
  const write = (next, group) => apply(setAt(config, ['agents', 'items', i], next), { group: group ?? `agent:${agent.id}` });
  return (
    <Shell icon="sparkle" title={node.label} kicker={`AI model of ${agent.name || agent.id}`} onClose={() => onSelect(null)}>
      <p className="wfMuted">{node.own ? 'This subagent has a model of its own.' : 'It uses the agent’s default model until it is given one of its own.'}</p>
      <AgentOverrides id={`wf-model-${agent.id}`} agent={agent} config={config} write={write} />
      <div className="wfRow">
        <Button type="button" onClick={() => onSelect({ type: 'node', id: agent.id })}>
          Open {agent.name || agent.id}
        </Button>
      </div>
    </Shell>
  );
}

// ---- knowledge plugged into a subagent: read on every turn
export function KnowledgePlugView({ node, agent, i, config, apply, onSelect, onOpenSettings }) {
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
        <Button type="button" onClick={() => onOpenSettings(['knowledge'])}>
          Open the Knowledge page
        </Button>
      </div>
      <section className="wfSection">
        <h4>Delete</h4>
        <DeleteButton label={`Stop ${agent.name || agent.id} reading it`} why="The knowledge stays on the Knowledge page." onConfirm={stop} />
      </section>
    </Shell>
  );
}
