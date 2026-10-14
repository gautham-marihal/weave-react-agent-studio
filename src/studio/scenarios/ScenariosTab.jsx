import React, { useMemo, useState } from 'react';
import { Notice } from '../ui.jsx';
import { formatWhen } from '../format.js';
import { EXPECT_KINDS, describeExpectation, hasProblems, kindOfExpectation, newScenario, parseImport, parseValue, regexProblem, scenarioProblems, showValue } from './model.js';
import { RUNNERS, runAll } from './runner.js';
import { clearRuns, latestStatuses, loadRuns, saveRun } from './history.js';
import './scenarios.css';

// Test scenarios: conversations written down with what must hold afterwards, kept in the agent's draft (`tests`), played by a runner,
// with each outcome recorded. The runner today is a SIMULATION (see runner.js): it checks that the scenarios are well formed and shows
// what they would look like, not whether the real agent passes. A real run needs an endpoint the API doesn't have yet.

const STATUS = { passed: ['Passed', 'good'], failed: ['Failed', 'bad'], unchecked: ['Not checked', 'idle'], error: ['Broken', 'bad'] };
const MARK = { passed: '✓', failed: '✕', unchecked: '–', error: '!' };
const Chip = ({ status }) => { const [text, tone] = STATUS[status] || ['Not run', 'idle']; return <span className={`scChip ${tone}`}>{text}</span>; };

function toolIdsOf(config) {
  const tools = (Array.isArray(config?.tools) ? config.tools : []).map((t) => t?.id);
  const handoffs = (Array.isArray(config?.agents?.items) ? config.agents.items : []).flatMap((a) => (Array.isArray(a?.handoffs) ? a.handoffs.map((h) => h?.tool) : []));
  return [...new Set([...tools, ...handoffs].filter(Boolean))];
}

// One expectation's inputs.
function ExpectRow({ value, onChange, onRemove, index, config }) {
  const kind = kindOfExpectation(value);
  const tools = toolIdsOf(config);
  const states = Object.keys(config?.state?.variables || {});
  const change = (key) => {
    if (key === kind) return;
    onChange({ tool_called: { tool_called: tools[0] || '' }, tool_not_called: { tool_not_called: tools[0] || '' }, state_equals: { state_equals: { state: states[0] || '', value: '' } }, said_matches: { said_matches: '' }, judge: { judge: '' } }[key]);
  };
  const label = (what) => `Expectation ${index + 1}: ${what}`;
  return (
    <li className="scExpect">
      <select className="stFInput small" value={kind} onChange={(event) => change(event.target.value)} aria-label={label('what to check')}>
        {!kind && <option value="">Choose what to check…</option>}
        {EXPECT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
      </select>
      {(kind === 'tool_called' || kind === 'tool_not_called') && (
        <select className="stFInput small" value={value[kind] || ''} onChange={(event) => onChange({ [kind]: event.target.value })} aria-label={label('tool')}>
          <option value="">Choose a tool…</option>
          {tools.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      )}
      {kind === 'state_equals' && (
        <>
          <select className="stFInput small" value={value.state_equals?.state || ''} onChange={(event) => onChange({ state_equals: { ...value.state_equals, state: event.target.value } })} aria-label={label('state variable')}>
            <option value="">Choose a variable…</option>
            {states.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <input className="stFInput small mono" type="text" value={showValue(value.state_equals?.value ?? '')} placeholder="value, e.g. true, 3 or paid" aria-label={label('value')}
            onChange={(event) => onChange({ state_equals: { ...value.state_equals, value: parseValue(event.target.value) } })} />
        </>
      )}
      {kind === 'said_matches' && (
        <span className="scField">
          <input className="stFInput small mono" type="text" value={value.said_matches || ''} placeholder="a pattern, e.g. refund|money back" aria-label={label('pattern')} aria-invalid={!!regexProblem(value.said_matches || '') || undefined}
            onChange={(event) => onChange({ said_matches: event.target.value })} />
          {regexProblem(value.said_matches || '') && <small className="stFErr">Not a valid pattern: {regexProblem(value.said_matches)}</small>}
        </span>
      )}
      {kind === 'judge' && <textarea className="stFInput small" rows={2} value={value.judge || ''} placeholder="e.g. the agent stays polite and does not promise a refund" aria-label={label('criterion')} onChange={(event) => onChange({ judge: event.target.value })} />}
      <button type="button" className="stIconBtn danger" aria-label={`Delete expectation ${index + 1}`} onClick={onRemove}>×</button>
    </li>
  );
}

function ScenarioForm({ initial, config, others, onSave, onCancel, isNew }) {
  const [scenario, setScenario] = useState(initial);
  const [tried, setTried] = useState(false);
  const problems = useMemo(() => scenarioProblems(scenario, config, others), [scenario, config, others]);
  const channels = (Array.isArray(config?.channels) ? config.channels : []).map((c) => c?.id).filter(Boolean);
  const set = (patch) => setScenario((old) => ({ ...old, ...patch }));
  const setTurn = (i, say) => set({ turns: scenario.turns.map((t, k) => (k === i ? { say } : t)) });
  const setCaller = (patch) => { const caller = { ...(scenario.caller || {}), ...patch }; Object.keys(caller).forEach((k) => { if (!caller[k]) delete caller[k]; }); const next = { ...scenario }; if (Object.keys(caller).length) next.caller = caller; else delete next.caller; setScenario(next); };
  const show = (key) => tried && problems[key];

  return (
    <form className="scForm" noValidate aria-label={isNew ? 'New scenario' : `Edit ${initial.id}`} onSubmit={(event) => { event.preventDefault(); setTried(true); if (!hasProblems(problems)) onSave(scenario); }}>
      <div className="scGrid">
        <label><span>Id</span>
          <input className="stFInput small mono" type="text" value={scenario.id} onChange={(event) => set({ id: event.target.value })} aria-invalid={!!show('id') || undefined} />
          {show('id') && <small className="stFErr">{problems.id}</small>}
        </label>
        <label><span>Channel</span>
          <select className="stFInput small" value={scenario.channel} onChange={(event) => set({ channel: event.target.value })} aria-invalid={!!show('channel') || undefined}>
            <option value="">Choose a channel…</option>
            {channels.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
          {show('channel') && <small className="stFErr">{problems.channel}</small>}
        </label>
        <label className="wide"><span>Who is calling <em>(optional)</em></span>
          <input className="stFInput small" type="text" value={scenario.caller?.persona || ''} placeholder="e.g. an impatient customer who was double charged" onChange={(event) => setCaller({ persona: event.target.value })} />
        </label>
      </div>

      <fieldset className="scBlock">
        <legend>What the caller says, in order</legend>
        <ol className="scTurns">
          {scenario.turns.map((turn, i) => (
            <li key={i}>
              <input className="stFInput small" type="text" value={turn.say} placeholder="What they say" aria-label={`Turn ${i + 1}: what the caller says`} onChange={(event) => setTurn(i, event.target.value)} />
              <button type="button" className="stIconBtn danger" aria-label={`Delete turn ${i + 1}`} onClick={() => set({ turns: scenario.turns.filter((_, k) => k !== i) })}>×</button>
            </li>
          ))}
        </ol>
        {show('turns') && <small className="stFErr">{problems.turns}</small>}
        <button type="button" className="stAddBtn" onClick={() => set({ turns: [...scenario.turns, { say: '' }] })}>＋ Add a turn</button>
      </fieldset>

      <fieldset className="scBlock">
        <legend>What must be true afterwards</legend>
        <ul className="scExpects">
          {scenario.expect.map((value, i) => (
            <ExpectRow key={i} index={i} value={value} config={config} onChange={(next) => set({ expect: scenario.expect.map((e, k) => (k === i ? next : e)) })} onRemove={() => set({ expect: scenario.expect.filter((_, k) => k !== i) })} />
          ))}
        </ul>
        {show('expect') && <ul className="scProblems">{problems.expect.map((text) => <li key={text} className="stFErr">{text}</li>)}</ul>}
        <button type="button" className="stAddBtn" onClick={() => set({ expect: [...scenario.expect, { said_matches: '' }] })}>＋ Add an expectation</button>
      </fieldset>

      <div className="scActions">
        <button type="submit" className="primaryCta compactCta">{isNew ? 'Add the scenario' : 'Save the scenario'}</button>
        <button type="button" className="quietButton" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function Outcome({ result }) {
  return (
    <div className="scOutcome">
      <ul className="scResults">
        {result.results.map((r, i) => (
          <li key={i} className={r.status}><b aria-hidden="true">{MARK[r.status]}</b><span><strong>{describeExpectation(r.expect)}</strong><small>{r.detail}</small></span></li>
        ))}
        {result.detail && <li className="error"><b aria-hidden="true">!</b><span><small>{result.detail}</small></span></li>}
      </ul>
      {result.transcript.length > 0 && (
        <details className="scTranscript">
          <summary>The simulated conversation ({result.transcript.length} messages)</summary>
          <ol>{result.transcript.map((m, i) => <li key={i} className={m.role}><b>{m.role === 'user' ? 'Caller' : 'Agent'}</b> {m.text}{m.tools?.length ? <em> (tool: {m.tools.join(', ')})</em> : null}</li>)}</ol>
        </details>
      )}
    </div>
  );
}

export default function ScenariosTab({ botId, name, editor }) {
  const config = editor.parsed.value;
  const ready = editor.status === 'ready' && editor.isObject && !editor.parsed.error;
  const scenarios = useMemo(() => (Array.isArray(config?.tests) ? config.tests.filter((s) => s && typeof s === 'object') : []), [config]);
  const [runs, setRuns] = useState(() => loadRuns(botId));
  const [shown, setShown] = useState(null); // a run being looked at
  const [editing, setEditing] = useState(null); // { index: number | -1 (new), scenario }
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState(null);
  const statuses = useMemo(() => latestStatuses(runs), [runs]);

  if (!ready) return <Notice kind="warn" title="The draft can’t be read right now">Fix the JSON on the Config tab first. Scenarios are part of the draft.</Notice>;

  const writeTests = (next) => {
    const copy = { ...config };
    if (next.length) copy.tests = next; else delete copy.tests;
    editor.setValue(copy);
  };
  const run = (which) => {
    const result = runAll(config, which, 'simulated');
    setRuns(saveRun(botId, result));
    setShown(result);
  };
  const shownRun = shown || runs[0] || null;

  return (
    <div className="scTab">
      <section className="stCard scHead">
        <div>
          <h3>Test scenarios</h3>
          <p className="stMuted">Write down conversations and what must be true afterwards, run them, and see which fail. They are part of {name}’s draft (<code>tests</code>), so they are saved and versioned with it.</p>
        </div>
        <div className="pvModes scRunner" role="group" aria-label="How to run">
          <button type="button" className="on" aria-pressed="true" title={RUNNERS.simulated.what}>{RUNNERS.simulated.label}</button>
          <button type="button" disabled aria-pressed="false" title={RUNNERS.live.reason}>{RUNNERS.live.label}</button>
        </div>
      </section>

      <p className="pvBanner sim" role="note">
        <b>Simulated runs.</b> {RUNNERS.simulated.what} A scenario passing here means it is well formed and its expectations can be met by the simulation, <strong>not</strong> that the real agent would pass.
        {' '}<b>Real runs aren’t available yet:</b> {RUNNERS.live.reason} Criteria for a reviewer (“a reviewer agrees that…”) are never checked in a simulation.
      </p>
      {editor.dirty && (
        <Notice kind="info" title="Scenarios and edits are in the draft, not saved yet" actions={<button type="button" className="quietButton" onClick={() => editor.save()} disabled={editor.saving}>{editor.saving ? 'Saving…' : 'Save draft'}</button>}>
          Runs use your current edits, saved or not.
        </Notice>
      )}

      <div className="scBar">
        <button type="button" className="primaryCta compactCta" disabled={!scenarios.length} onClick={() => run(scenarios)}>Run all ({scenarios.length})</button>
        <button type="button" className="quietButton" disabled={!!editing} onClick={() => setEditing({ index: -1, scenario: newScenario(config) })}>＋ New scenario</button>
        <button type="button" className="quietButton" aria-expanded={importOpen} onClick={() => setImportOpen((v) => !v)}>Paste scenarios…</button>
      </div>

      {importOpen && (
        <section className="stCard scImport">
          <label><span>Paste a list of scenarios as JSON</span>
            <textarea className="stFInput mono" rows={6} value={importText} onChange={(event) => { setImportText(event.target.value); setImportResult(null); }} spellCheck={false} aria-label="Scenarios as JSON" placeholder='[{ "id": "asks_for_a_person", "channel": "web-chat", "turns": [{ "say": "Can I speak to someone?" }], "expect": [{ "tool_called": "escalate_to_human" }] }]' />
          </label>
          <div className="scActions">
            <button type="button" className="primaryCta compactCta" disabled={!importText.trim()} onClick={() => {
              const result = parseImport(importText, config);
              setImportResult(result);
              if (result.scenarios.length) { writeTests([...scenarios, ...result.scenarios]); if (!result.problems.length) { setImportText(''); setImportOpen(false); } }
            }}>Add them</button>
          </div>
          {importResult && (
            <div role="status">
              {importResult.scenarios.length > 0 && <p className="scOk">Added {importResult.scenarios.length} scenario{importResult.scenarios.length === 1 ? '' : 's'} to the draft.</p>}
              {importResult.problems.length > 0 && <ul className="scProblems">{importResult.problems.map((p) => <li key={p} className="stFErr">{p}</li>)}</ul>}
            </div>
          )}
        </section>
      )}

      {editing && (
        <section className="stCard">
          <ScenarioForm key={editing.index} initial={editing.scenario} config={config} others={scenarios.filter((_, i) => i !== editing.index)} isNew={editing.index < 0} onCancel={() => setEditing(null)}
            onSave={(saved) => { writeTests(editing.index < 0 ? [...scenarios, saved] : scenarios.map((s, i) => (i === editing.index ? saved : s))); setEditing(null); }} />
        </section>
      )}

      <section className="stCard" aria-label="Scenarios">
        {scenarios.length === 0 ? (
          <div className="scEmpty">
            <strong>No scenarios yet</strong>
            <span>A scenario is one conversation: what the caller says, and what must be true afterwards (a tool was called, something was said, a state variable ended up a certain way).</span>
            <button type="button" className="primaryCta compactCta" onClick={() => setEditing({ index: -1, scenario: newScenario(config) })}>Write the first one</button>
          </div>
        ) : (
          <ul className="scList">
            {scenarios.map((scenario, index) => {
              const last = statuses[scenario.id];
              const outcome = shownRun?.scenarios.find((s) => s.id === scenario.id);
              return (
                <li key={`${scenario.id}-${index}`} className="scItem" data-scenario={scenario.id}>
                  <header>
                    <strong>{scenario.id}</strong>
                    <small>{scenario.channel} · {(scenario.turns || []).length} turn{(scenario.turns || []).length === 1 ? '' : 's'} · {(scenario.expect || []).length} expectation{(scenario.expect || []).length === 1 ? '' : 's'}</small>
                    {last ? <span title={`${last.runner} run, ${formatWhen(last.ranAt)}`}><Chip status={last.status} /></span> : <span className="scChip idle">Not run</span>}
                    <span className="scItemActions">
                      <button type="button" className="quietButton" onClick={() => run([scenario])}>Run</button>
                      <button type="button" className="quietButton" disabled={!!editing} onClick={() => setEditing({ index, scenario: JSON.parse(JSON.stringify(scenario)) })}>Edit</button>
                      <button type="button" className="stFDel small" aria-label={`Delete ${scenario.id}`} onClick={() => { if (window.confirm(`Delete the scenario “${scenario.id}” from the draft?`)) writeTests(scenarios.filter((_, i) => i !== index)); }}>Delete</button>
                    </span>
                  </header>
                  <p className="scSaid">{(scenario.turns || []).map((t) => `“${t.say}”`).join(' → ')}</p>
                  {outcome && outcome.status !== undefined && (
                    <div className={`scLast ${outcome.status}`}>
                      <p><Chip status={outcome.status} /> <small>in the {shownRun.runner} run of {formatWhen(shownRun.ranAt)}</small></p>
                      <Outcome result={outcome} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {shownRun && (
        <section className="stCard scSummary" aria-label="Latest run" role="status">
          <h4>Latest run: {formatWhen(shownRun.ranAt)} <span className="scChip idle">{shownRun.runner}</span></h4>
          <p>
            <b className="scNum good">{shownRun.passed}</b> passed · <b className="scNum bad">{shownRun.failed}</b> failed
            {shownRun.unchecked > 0 && <> · <b className="scNum">{shownRun.unchecked}</b> not checked</>}
            {shownRun.errors > 0 && <> · <b className="scNum bad">{shownRun.errors}</b> broken</>}
            {' '}of {shownRun.total}.
          </p>
          {shownRun.failed + shownRun.errors > 0 && <p className="scFailed">Failing: {shownRun.scenarios.filter((s) => s.status === 'failed' || s.status === 'error').map((s) => s.id).join(', ')}</p>}
        </section>
      )}

      {runs.length > 0 && (
        <section className="stCard" aria-label="Earlier runs">
          <h4>Earlier runs <button type="button" className="stLink" onClick={() => { setRuns(clearRuns(botId)); setShown(null); }}>Clear</button></h4>
          <ul className="scHistory">
            {runs.map((r) => (
              <li key={r.id}>
                <button type="button" className={`quietButton ${shownRun?.id === r.id ? 'on' : ''}`} onClick={() => setShown(r)} aria-pressed={shownRun?.id === r.id}>
                  {formatWhen(r.ranAt)} · {r.runner} · {r.passed}/{r.total} passed{r.failed ? `, ${r.failed} failed` : ''}
                </button>
              </li>
            ))}
          </ul>
          <p className="stMuted">Kept in this browser (the API has nowhere to record runs yet).</p>
        </section>
      )}
    </div>
  );
}
