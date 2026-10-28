import React from 'react';
import Icon from '../../../ui/Icon.jsx';
import { setEntry } from '../workflowOps.js';
import { describeItems } from '../workflowModel.js';
import Select from '../../../ui/Select.tsx';
import { list, Field, HideButton } from './panelParts.jsx';

// The side panel with nothing selected: the call walked through step by step.

// ---- nothing selected
export function Overview({ flow, config, apply, onSelect }) {
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
