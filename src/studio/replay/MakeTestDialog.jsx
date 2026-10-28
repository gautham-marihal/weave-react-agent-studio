import React, { useMemo, useState } from 'react';
import { Modal } from '../ui.jsx';
import { toolNamesOf } from '../scenarios/model.js';
import { addScenario, buildScenario, hasPersonalData, suggestTest, testProblems } from './callToTest.js';
import Select from '../../ui/Select.tsx';
import './replay.css';
import Button from '../../ui/Button.tsx';
import { Input, TextArea } from '../../ui/Input.tsx';

// "Keep this call as a test": the caller's words (editable), the checks to keep, and what should have happened. The
// test is added to the draft like any other edit: nothing is saved until the draft is, and it can be undone.
export default function MakeTestDialog({ facts, config, call, onAdd, onClose, expected = '' }) {
  const start = useMemo(() => suggestTest(facts, config, { callId: call?.id || '', startedAt: call?.started_at || '' }), [facts, config, call]);
  const [id, setId] = useState(start.id);
  const [description, setDescription] = useState(start.description);
  const [channel, setChannel] = useState(start.channel);
  const [turns, setTurns] = useState(start.turns);
  const [checks, setChecks] = useState(start.checks);
  const [expectedText, setExpectedText] = useState(expected);
  const [never, setNever] = useState([]);

  const channels = (Array.isArray(config?.channels) ? config.channels : []).filter((c) => c && c.id);
  const toolIds = toolNamesOf(config);
  const draft = { id, description, channel, turns, checks, expectedText, toolsNeverCalled: never };
  const problems = testProblems(draft, config);
  const personal = turns.some(hasPersonalData);

  const add = () => {
    if (problems.length) return;
    onAdd(addScenario(config, buildScenario(draft)), id);
  };

  return (
    <Modal
      wide
      eyebrow="Keep this call as a test"
      title="What should always be true about this conversation?"
      subtitle="The caller’s words become a test scenario in the draft. From then on, every run checks that the agent still handles them this way."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="modalCancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="modalCreate" disabled={problems.length > 0} onClick={add}>
            Add the test to the draft
          </button>
        </>
      }
    >
      <div className="rpDialog">
        {start.warnings.map((w, i) => (
          <p key={i} className="rpWarn" role="note">
            {w}
          </p>
        ))}

        <div className="rpFields">
          <label>
            <span>Name</span>
            <Input mono value={id} onChange={(event) => setId(event.target.value)} aria-label="Test name" spellCheck={false} />
          </label>
          <label>
            <span>Channel</span>
            <Select className="stFInput" value={channel} onChange={(event) => setChannel(event.target.value)} aria-label="Channel">
              {!channels.some((c) => c.id === channel) && <option value={channel}>{channel || 'Choose…'}</option>}
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <label className="rpWide">
          <span>Why it is kept</span>
          <Input value={description} onChange={(event) => setDescription(event.target.value)} aria-label="Why it is kept" />
        </label>

        <fieldset className="rpSet">
          <legend>What the caller says</legend>
          {personal && <p className="rpWarn">A number or an address is still in here. Edit it before keeping the test.</p>}
          {turns.map((text, index) => (
            <div key={index} className="rpTurnEdit">
              <span>{index + 1}</span>
              <Input
                size="small"
                value={text}
                aria-label={`Caller turn ${index + 1}`}
                onChange={(event) => setTurns(turns.map((t, i) => (i === index ? event.target.value : t)))}
              />
              <Button
                type="button"
                size="small"
                aria-label={`Remove turn ${index + 1}`}
                onClick={() => setTurns(turns.filter((_, i) => i !== index))}
                disabled={turns.length === 1}
              >
                Remove
              </Button>
            </div>
          ))}
        </fieldset>

        <fieldset className="rpSet">
          <legend>What must hold afterwards</legend>
          {checks.length === 0 && <p className="stMuted">Nothing in this call is plain enough to suggest. Say what should have happened below.</p>}
          {checks.map((c) => (
            <label key={c.id} className="rpCheck">
              <input
                type="checkbox"
                checked={c.checked}
                onChange={(event) => setChecks(checks.map((x) => (x.id === c.id ? { ...x, checked: event.target.checked } : x)))}
              />
              <span>
                <b>{c.label}</b>
                <small>{c.why}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="rpWide">
          <span>
            What should have happened? <em>(optional)</em>
          </span>
          <TextArea
            rows={2}
            value={expectedText}
            onChange={(event) => setExpectedText(event.target.value)}
            placeholder="e.g. the agent offers to check the order again, and never promises a refund"
            aria-label="What should have happened"
          />
          <small className="stMuted">
            A reviewer (a language model) grades this, so a test with it needs a live run and is skipped when the scenario has a model script.
          </small>
        </label>

        {toolIds.length > 0 && (
          <fieldset className="rpSet">
            <legend>
              The agent must never use… <em>(optional)</em>
            </legend>
            <div className="rpChips">
              {toolIds.map((tool) => (
                <label key={tool} className={never.includes(tool) ? 'on' : ''}>
                  <input
                    type="checkbox"
                    checked={never.includes(tool)}
                    onChange={(event) => setNever(event.target.checked ? [...never, tool] : never.filter((t) => t !== tool))}
                  />{' '}
                  {tool}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {problems.length > 0 && (
          <ul className="rpProblems" role="alert">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
