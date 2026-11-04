import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SmartSelect from '../SmartSelect.jsx';
import Icon from '../../ui/Icon.jsx';
import { channelLabel } from '../agent/rowNames.js';
import { channelTypeOf, hasProblems, isKeysTurn, newExpectation, scenarioProblems, toolChoices } from './model.js';
import Select from '../../ui/Select.tsx';
import Button from '../../ui/Button.tsx';
import { Input, TextArea } from '../../ui/Input.tsx';
import { JsonBox } from './JsonBox.jsx';
import ExpectRow from './ExpectRow.jsx';
import { MocksEditor, ScriptEditor } from './MocksAndScript.jsx';

// The editor for one scenario: every part the schema has (turns, thirteen kinds of expectation, clock, state, API
// mocks, model script) plus "Edit as JSON". Unknown parts are kept as they are and never block Save; only what is
// positively wrong (a missing id, a missing channel, a bad pattern) is a problem, shown where it is.

export default function ScenarioForm({ initial, config, others, onSave, onCancel, isNew }) {
  const formRef = useRef(null);
  // focus goes to the form's first field when it opens, and back to its opener when it closes (else it is lost)
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));
  useEffect(() => {
    formRef.current?.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])')?.focus();
    return () => {
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the form opens and closes
  }, []);
  const [scenario, setScenario] = useState(initial);
  const [tried, setTried] = useState(false);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [badBoxes, setBadBoxes] = useState([]); // the JSON boxes that hold something that does not parse
  // "More" stays as the author left it: open when the scenario uses it, not shut when the last of it is removed
  const [moreOpen, setMoreOpen] = useState(() => !!(initial?.model_script || initial?.http_mocks || initial?.now || initial?.state));
  const [blocked, setBlocked] = useState(false); // Save was pressed with something still wrong
  const reportBox = useCallback(
    (name, ok) => setBadBoxes((old) => (ok ? (old.includes(name) ? old.filter((n) => n !== name) : old) : old.includes(name) ? old : [...old, name])),
    [],
  );
  const problems = useMemo(() => scenarioProblems(scenario, config, others), [scenario, config, others]);
  const channels = (Array.isArray(config?.channels) ? config.channels : []).map((c) => c?.id).filter(Boolean);
  const connections = Object.entries(config?.connections || {})
    .filter(([, c]) => c?.type === 'http')
    .map(([id]) => id);
  const tools = toolChoices(config);
  const set = (patch) =>
    setScenario((old) => {
      const next = { ...old, ...patch };
      Object.keys(next).forEach((k) => {
        if (next[k] === undefined || (Array.isArray(next[k]) && !next[k].length && ['http_mocks', 'model_script'].includes(k))) delete next[k];
      });
      return next;
    });
  const setTurn = (i, text) => set({ turns: (scenario.turns || []).map((t, k) => (k !== i ? t : isKeysTurn(t) ? { keys: text } : { say: text })) });
  const setTurnKind = (i, keys) =>
    set({ turns: (scenario.turns || []).map((t, k) => (k !== i || isKeysTurn(t) === keys ? t : keys ? { keys: '' } : { say: '' })) });
  const phoneLine = channelTypeOf(config, scenario.channel) === 'sip_voice';
  const setCaller = (patch) => {
    const caller = { ...(scenario.caller || {}), ...patch };
    Object.keys(caller).forEach((k) => {
      if (!caller[k]) delete caller[k];
    });
    set({ caller: Object.keys(caller).length ? caller : undefined });
  };
  const show = (key) => tried && problems[key];
  const scripted = Array.isArray(scenario.model_script) && scenario.model_script.length > 0;

  const openJson = () => {
    setJsonText(JSON.stringify(scenario, null, 2));
    setJsonError('');
    setJsonMode(true);
  };
  const closeJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('a scenario is an object');
      setScenario(parsed);
      setJsonMode(false);
      setJsonError('');
    } catch (e) {
      setJsonError(`Not valid JSON (${e.message}).`);
    }
  };
  const submit = (event) => {
    event.preventDefault();
    let value = scenario;
    if (jsonMode) {
      try {
        value = JSON.parse(jsonText);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('a scenario is an object');
      } catch (e) {
        setJsonError(`Not valid JSON (${e.message}).`);
        return;
      }
    }
    const found = scenarioProblems(value, config, others);
    setTried(true);
    if (jsonMode) {
      setScenario(value);
      // the form's fields say what is wrong beside each one; here they are not shown, so it is said under the box
      if (hasProblems(found)) {
        setJsonError(`It can’t be saved yet. ${Object.values(found).flat().filter(Boolean).join(' ')}`);
        return;
      }
    }
    if (badBoxes.length || hasProblems(found)) {
      // the boxes and fields say what is wrong; folded parts open and the first gets focus, so Save is never silent
      setBlocked(true);
      window.requestAnimationFrame(() => {
        const form = formRef.current;
        if (!form) return;
        form.querySelectorAll('[aria-invalid="true"], .stFErr').forEach((el) => {
          for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
        });
        form.querySelector('[aria-invalid="true"]')?.focus();
      });
      return;
    }
    onSave(value);
  };

  return (
    <form ref={formRef} className="scForm" noValidate aria-label={isNew ? 'New scenario' : `Edit ${initial.id}`} onSubmit={submit}>
      <div className="scFormTop">
        <span
          className={`scChip ${scripted ? 'good' : 'warn'}`}
          title={scripted ? 'Runs without a model: free and repeatable' : 'Uses a real model when run: costs money'}
        >
          {scripted ? 'Scripted' : 'Live'}
        </span>
        <button type="button" className="stLink" onClick={jsonMode ? closeJson : openJson}>
          {jsonMode ? 'Back to the form' : 'Edit as JSON'}
        </button>
      </div>

      {jsonMode ? (
        <label className="scJson">
          <span>The scenario as JSON</span>
          <TextArea
            mono
            rows={16}
            value={jsonText}
            spellCheck={false}
            aria-label="The scenario as JSON"
            aria-invalid={!!jsonError || undefined}
            onChange={(event) => {
              setJsonText(event.target.value);
              setJsonError('');
            }}
          />
          {jsonError && <small className="stFErr">{jsonError}</small>}
        </label>
      ) : (
        <>
          <div className="scGrid">
            <label>
              <span>Id</span>
              <Input
                size="small"
                mono
                type="text"
                value={scenario.id}
                onChange={(event) => set({ id: event.target.value })}
                aria-invalid={!!show('id') || undefined}
              />
              {show('id') && <small className="stFErr">{problems.id}</small>}
            </label>
            <label>
              <span>Channel</span>
              <SmartSelect
                className="stFInput small"
                value={scenario.channel}
                placeholder="Choose a channel…"
                ariaLabel="Channel"
                invalid={!!show('channel')}
                onChange={(chosen) => set({ channel: chosen })}
                options={[
                  ...channels.map((id) => ({ value: id, label: channelLabel(config, id) })),
                  ...(scenario.channel && !channels.includes(scenario.channel)
                    ? [{ value: scenario.channel, label: `${scenario.channel} (not in this agent)` }]
                    : []),
                ]}
              />
              {show('channel') && <small className="stFErr">{problems.channel}</small>}
            </label>
            <label className="wide">
              <span>
                What this scenario shows <em>(optional)</em>
              </span>
              <Input
                size="small"
                type="text"
                value={scenario.description || ''}
                placeholder="e.g. A billing question reaches billing and a ticket is raised."
                onChange={(event) => set({ description: event.target.value || undefined })}
              />
            </label>
            <label className="wide">
              <span>
                Who is calling <em>(optional)</em>
              </span>
              <Input
                size="small"
                type="text"
                value={scenario.caller?.persona || ''}
                placeholder="e.g. an impatient customer who was double charged"
                onChange={(event) => setCaller({ persona: event.target.value })}
              />
            </label>
          </div>

          <fieldset className="scBlock">
            <legend>What the caller says, in order</legend>
            <ol className="scTurns">
              {(scenario.turns || []).map((turn, i) => (
                <li key={i}>
                  {(phoneLine || isKeysTurn(turn)) && (
                    <Select
                      className="stFInput small"
                      value={isKeysTurn(turn) ? 'keys' : 'say'}
                      onChange={(event) => setTurnKind(i, event.target.value === 'keys')}
                      aria-label={`Turn ${i + 1}: kind`}
                    >
                      <option value="say">Says</option>
                      <option value="keys">Presses keys</option>
                    </Select>
                  )}
                  <Input
                    className={`small${isKeysTurn(turn) ? ' mono' : ''}`}
                    type="text"
                    value={(isKeysTurn(turn) ? turn.keys : turn.say) ?? ''}
                    placeholder={isKeysTurn(turn) ? 'Keys, e.g. 4821#' : 'What they say'}
                    aria-label={isKeysTurn(turn) ? `Turn ${i + 1}: the keys the caller presses` : `Turn ${i + 1}: what the caller says`}
                    onChange={(event) => setTurn(i, event.target.value)}
                  />
                  <button
                    type="button"
                    className="stIconBtn danger"
                    aria-label={`Delete turn ${i + 1}`}
                    onClick={() => set({ turns: (scenario.turns || []).filter((_, k) => k !== i) })}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ol>
            {show('turns') && <small className="stFErr">{problems.turns}</small>}
            <button type="button" className="stAddBtn" onClick={() => set({ turns: [...(scenario.turns || []), { say: '' }] })}>
              <Icon name="plus" size={14} /> Add a turn
            </button>
          </fieldset>

          <fieldset className="scBlock">
            <legend>What must be true afterwards</legend>
            <ul className="scExpects">
              {(scenario.expect || []).map((value, i) => (
                <ExpectRow
                  reportBox={reportBox}
                  key={i}
                  index={i}
                  value={value}
                  config={config}
                  onChange={(next) => set({ expect: (scenario.expect || []).map((e, k) => (k === i ? next : e)) })}
                  onRemove={() => set({ expect: (scenario.expect || []).filter((_, k) => k !== i) })}
                />
              ))}
            </ul>
            {show('expect') && (
              <ul className="scProblems">
                {problems.expect.map((text) => (
                  <li key={text} className="stFErr">
                    {text}
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="stAddBtn" onClick={() => set({ expect: [...(scenario.expect || []), newExpectation('said_matches', config)] })}>
              <Icon name="plus" size={14} /> Add an expectation
            </button>
          </fieldset>

          <details className="scMore" open={moreOpen} onToggle={(event) => setMoreOpen(event.currentTarget.open)}>
            <summary>Model script, API answers, clock and starting state</summary>
            <fieldset className="scBlock">
              <legend>
                The model’s replies <em>(a script makes the scenario free and repeatable)</em>
              </legend>
              <ScriptEditor reportBox={reportBox} script={scenario.model_script} tools={tools} onChange={(model_script) => set({ model_script })} />
              {show('script') && (
                <ul className="scProblems">
                  {problems.script.map((text) => (
                    <li key={text} className="stFErr">
                      {text}
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
            <fieldset className="scBlock">
              <legend>Answers for the bot’s API calls</legend>
              <MocksEditor reportBox={reportBox} mocks={scenario.http_mocks} connections={connections} onChange={(http_mocks) => set({ http_mocks })} />
              {show('mocks') && (
                <ul className="scProblems">
                  {problems.mocks.map((text) => (
                    <li key={text} className="stFErr">
                      {text}
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
            <div className="scGrid">
              <label>
                <span>
                  Pretend it is <em>(a date and time with a time zone)</em>
                </span>
                <Input
                  size="small"
                  mono
                  type="text"
                  value={scenario.now || ''}
                  placeholder="2026-10-14T03:00:00+08:00"
                  aria-label="Pretend it is"
                  aria-invalid={!!show('now') || undefined}
                  onChange={(event) => set({ now: event.target.value || undefined })}
                />
                {show('now') ? (
                  <small className="stFErr">{problems.now}</small>
                ) : (
                  <small className="stMuted">
                    Makes a schedule such as business hours open or closed, as the scenario needs. Without it the real clock is used.
                  </small>
                )}
              </label>
              <label className="wide">
                <span>
                  Starting state <em>(values set before the conversation starts)</em>
                </span>
                <JsonBox
                  onValid={reportBox}
                  value={scenario.state}
                  rows={2}
                  label="Starting state"
                  placeholder='{ "verified": true }'
                  onChange={(state) => set({ state })}
                />
              </label>
            </div>
          </details>
        </>
      )}

      <div className="scActions">
        <Button type="submit" variant="primary" size="compact">
          {isNew ? 'Add the scenario' : 'Save the scenario'}
        </Button>
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
        {blocked && !jsonMode && (badBoxes.length > 0 || hasProblems(problems)) && (
          <small className="stFErr" role="alert">
            Not saved: fix what is marked above first.
          </small>
        )}
      </div>
    </form>
  );
}
