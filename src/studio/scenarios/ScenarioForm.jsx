import React, { useEffect, useMemo, useRef, useState } from 'react';
import SmartSelect from '../SmartSelect.jsx';
import {
  EXPECT_KINDS, HTTP_METHODS, hasProblems, isUnknownExpectation, kindOfExpectation, newExpectation, parseObject, parseValue, regexProblem, scenarioProblems, showValue, toolIdsOf,
} from './model.js';

// The editor for one scenario. It covers every part the schema has (the caller's turns, nine kinds of expectation, a description, a pretend
// clock, starting state, answers for the bot's API calls, a model script) and "Edit as JSON" for anything else. It never blocks Save for a
// part it does not know: that part is kept exactly as it is. Only what is positively wrong (a missing id, a channel that isn't there, an
// invalid pattern) is a problem, and it is said where it is.

// A box for a JSON object or value: keeps what is typed, only passes up what parses, says what is wrong when it doesn't.
function JsonBox({ value, onChange, label, rows = 3, placeholder, objectOnly = true, className = '' }) {
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)));
  const [error, setError] = useState('');
  const mine = useRef(JSON.stringify(value));
  useEffect(() => {
    // the value changed from somewhere else (another mock, a reset): show it, unless it is what was just typed
    if (JSON.stringify(value) !== mine.current) { mine.current = JSON.stringify(value); setText(value === undefined ? '' : JSON.stringify(value, null, 2)); setError(''); }
  }, [value]);
  const change = (next) => {
    setText(next);
    if (!next.trim()) { setError(''); mine.current = JSON.stringify(undefined); onChange(undefined); return; }
    if (objectOnly) {
      const parsed = parseObject(next);
      if (parsed.error) { setError(parsed.error); return; }
      setError(''); mine.current = JSON.stringify(parsed.value); onChange(parsed.value);
    } else {
      try { const parsed = JSON.parse(next); setError(''); mine.current = JSON.stringify(parsed); onChange(parsed); } catch (e) { setError(`Not valid JSON (${e.message}).`); }
    }
  };
  return (
    <span className="scField">
      <textarea className={`stFInput small mono ${className}`} rows={rows} value={text} placeholder={placeholder} aria-label={label} aria-invalid={!!error || undefined} spellCheck={false} onChange={(event) => change(event.target.value)} />
      {error && <small className="stFErr">{error}</small>}
    </span>
  );
}

function ExpectRow({ value, onChange, onRemove, index, config }) {
  const kind = kindOfExpectation(value);
  const tools = toolIdsOf(config);
  const states = Object.keys(config?.state?.variables || {});
  const agents = (Array.isArray(config?.agents?.items) ? config.agents.items : []).map((a) => a?.id).filter(Boolean);
  const label = (what) => `Expectation ${index + 1}: ${what}`;
  const unknown = isUnknownExpectation(value);

  if (unknown || !value || typeof value !== 'object') {
    return (
      <li className="scExpect unknown">
        <span className="scField">
          <small className="stMuted">This check isn’t one the form can edit, so it is kept exactly as it is. Use “Edit as JSON” to change it.</small>
          <code className="scUnknownCode">{JSON.stringify(value)}</code>
        </span>
        <button type="button" className="stIconBtn danger" aria-label={`Delete expectation ${index + 1}`} onClick={onRemove}>×</button>
      </li>
    );
  }

  const pickTool = (key, current) => (
    <SmartSelect className="stFInput small" value={current || ''} placeholder="Choose a tool…" ariaLabel={label('tool')} options={tools}
      onChange={(chosen) => onChange(key === 'tool_called_with' ? { tool_called_with: { ...value.tool_called_with, tool: chosen } } : { [key]: chosen })} />
  );
  const http = value[kind] || {};
  const setHttp = (patch) => { const next = { ...http, ...patch }; Object.keys(next).forEach((k) => { if (next[k] === '' || next[k] === undefined) delete next[k]; }); onChange({ [kind]: next }); };

  return (
    <li className="scExpect">
      <select className="stFInput small" value={kind} onChange={(event) => { if (event.target.value !== kind) onChange(newExpectation(event.target.value, config)); }} aria-label={label('what to check')}>
        {EXPECT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
      </select>

      {(kind === 'tool_called' || kind === 'tool_not_called') && pickTool(kind, value[kind])}

      {kind === 'tool_called_with' && (
        <>
          {pickTool('tool_called_with', value.tool_called_with?.tool)}
          <JsonBox value={value.tool_called_with?.args ?? {}} label={label('arguments it must include')} rows={2} placeholder='{ "order_id": "NB-1003" }' onChange={(args) => onChange({ tool_called_with: { ...value.tool_called_with, args: args ?? {} } })} />
        </>
      )}

      {kind === 'state_equals' && (
        <>
          <SmartSelect className="stFInput small" value={value.state_equals?.state || ''} placeholder="Choose a variable…" ariaLabel={label('state variable')} options={states} onChange={(chosen) => onChange({ state_equals: { ...value.state_equals, state: chosen } })} />
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

      {kind === 'agent_is' && (
        <SmartSelect className="stFInput small" value={value.agent_is || ''} placeholder="Choose an agent…" ariaLabel={label('agent')} options={agents} onChange={(chosen) => onChange({ agent_is: chosen })} />
      )}

      {(kind === 'http_called' || kind === 'http_not_called') && (
        <>
          <select className="stFInput small" value={http.method || ''} onChange={(event) => setHttp({ method: event.target.value })} aria-label={label('method')}>
            <option value="">Any method</option>
            {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input className="stFInput small mono" type="text" value={http.path || ''} placeholder="/orders/* (a * matches anything)" aria-label={label('path')} onChange={(event) => setHttp({ path: event.target.value })} />
          {kind === 'http_called' && (
            <input className="stFInput small" type="number" min="1" step="1" value={http.times ?? ''} placeholder="times (empty: at least once)" aria-label={label('how many times')} onChange={(event) => setHttp({ times: event.target.value === '' ? undefined : Number(event.target.value) })} />
          )}
        </>
      )}

      {kind === 'judge' && <textarea className="stFInput small" rows={2} value={value.judge || ''} placeholder="e.g. the agent stays polite and does not promise a refund" aria-label={label('criterion')} onChange={(event) => onChange({ judge: event.target.value })} />}
      <button type="button" className="stIconBtn danger" aria-label={`Delete expectation ${index + 1}`} onClick={onRemove}>×</button>
    </li>
  );
}

// The answers for the bot's API calls.
function MocksEditor({ mocks, onChange, connections }) {
  const list = Array.isArray(mocks) ? mocks : [];
  const set = (i, patch) => onChange(list.map((m, k) => (k === i ? cleaned({ ...m, ...patch }) : m)));
  const cleaned = (m) => { const out = { ...m }; Object.keys(out).forEach((k) => { if (out[k] === undefined || out[k] === '') delete out[k]; }); return out; };
  return (
    <div className="scMocks">
      {list.length === 0 && <p className="stMuted">No mocks. A scenario never calls a real API: a request nothing answers gets a 404 and is listed in the result, with a button to add the mock.</p>}
      {list.map((mock, i) => (
        <fieldset className="scMock" key={i}>
          <legend>Mock {i + 1}</legend>
          <div className="scGrid">
            <label><span>Method</span>
              <select className="stFInput small" value={mock.method || ''} onChange={(event) => set(i, { method: event.target.value })} aria-label={`Mock ${i + 1}: method`}>
                <option value="">Any</option>
                {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label><span>Path</span>
              <input className="stFInput small mono" type="text" value={mock.path || ''} placeholder="/orders/*" aria-label={`Mock ${i + 1}: path`} onChange={(event) => set(i, { path: event.target.value })} />
            </label>
            <label><span>Answers with status</span>
              <input className="stFInput small" type="number" min="100" max="599" value={mock.status ?? ''} placeholder="200" aria-label={`Mock ${i + 1}: status`} onChange={(event) => set(i, { status: event.target.value === '' ? undefined : Number(event.target.value) })} />
            </label>
            <label><span>Only this many times</span>
              <input className="stFInput small" type="number" min="1" value={mock.times ?? ''} placeholder="every time" aria-label={`Mock ${i + 1}: times`} onChange={(event) => set(i, { times: event.target.value === '' ? undefined : Number(event.target.value) })} />
            </label>
            {connections.length > 0 && (
              <label><span>Only for connection</span>
                <select className="stFInput small" value={mock.connection || ''} onChange={(event) => set(i, { connection: event.target.value })} aria-label={`Mock ${i + 1}: connection`}>
                  <option value="">Any</option>
                  {connections.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            )}
            <label className="wide"><span>The JSON it answers with</span>
              <JsonBox value={mock.json} objectOnly={false} rows={3} label={`Mock ${i + 1}: the JSON it answers with`} placeholder='{ "found": true }' onChange={(json) => set(i, { json })} />
            </label>
          </div>
          <details className="scMore">
            <summary>More: plain-text answer, query, body</summary>
            <div className="scGrid">
              <label><span>Or a plain-text answer</span>
                <input className="stFInput small" type="text" value={mock.text || ''} aria-label={`Mock ${i + 1}: text answer`} onChange={(event) => set(i, { text: event.target.value })} />
              </label>
              <label><span>The request must have these query values</span>
                <JsonBox value={mock.query} rows={2} label={`Mock ${i + 1}: query`} placeholder='{ "status": "open" }' onChange={(query) => set(i, { query })} />
              </label>
              <label><span>The JSON body must contain</span>
                <JsonBox value={mock.body_contains} rows={2} label={`Mock ${i + 1}: body contains`} placeholder='{ "reason": "late" }' onChange={(body_contains) => set(i, { body_contains })} />
              </label>
            </div>
          </details>
          <button type="button" className="stFDel small" onClick={() => onChange(list.filter((_, k) => k !== i))}>Delete mock {i + 1}</button>
        </fieldset>
      ))}
      <button type="button" className="stAddBtn" onClick={() => onChange([...list, { method: 'GET', path: '', status: 200, json: {} }])}>＋ Add a mock</button>
    </div>
  );
}

// The model's replies, one per item: what it says, or the tool it calls.
function ScriptEditor({ script, onChange, tools }) {
  const list = Array.isArray(script) ? script : [];
  const set = (i, item) => onChange(list.map((x, k) => (k === i ? item : x)));
  return (
    <div className="scScript">
      <p className="stMuted">With a script, the language model is replaced: each item is one reply. It runs the real runtime (prompts, tools, preconditions, effects, handoffs) without a model, so it is free and the same every time. Without a script the scenario is <strong>live</strong>: it uses a real model, costs money, and can differ from run to run.</p>
      <ol className="scScriptList">
        {list.map((item, i) => {
          const calls = typeof item === 'object' && item !== null;
          return (
            <li key={i}>
              <select className="stFInput small" value={calls ? 'tool' : 'say'} aria-label={`Model reply ${i + 1}: what it does`} onChange={(event) => set(i, event.target.value === 'tool' ? { tool: tools[0] || '' } : '')}>
                <option value="say">Says</option>
                <option value="tool">Calls a tool</option>
              </select>
              {calls ? (
                <>
                  <SmartSelect className="stFInput small" value={item.tool || ''} placeholder="Choose a tool…" ariaLabel={`Model reply ${i + 1}: tool`} options={tools} onChange={(chosen) => set(i, { ...item, tool: chosen })} />
                  <JsonBox value={item.args} rows={1} label={`Model reply ${i + 1}: arguments`} placeholder='arguments, e.g. { "order_id": "NB-1003" }' onChange={(args) => { const next = { ...item }; if (args === undefined) delete next.args; else next.args = args; set(i, next); }} />
                </>
              ) : <input className="stFInput small" type="text" value={item} placeholder="What the model says" aria-label={`Model reply ${i + 1}: what it says`} onChange={(event) => set(i, event.target.value)} />}
              <button type="button" className="stIconBtn danger" aria-label={`Delete model reply ${i + 1}`} onClick={() => onChange(list.filter((_, k) => k !== i))}>×</button>
            </li>
          );
        })}
      </ol>
      <div className="scActions">
        <button type="button" className="stAddBtn" onClick={() => onChange([...list, ''])}>＋ Add a reply</button>
        {list.length > 0 && <button type="button" className="stLink" onClick={() => onChange(undefined)}>Remove the script (make it live)</button>}
      </div>
    </div>
  );
}

export default function ScenarioForm({ initial, config, others, onSave, onCancel, isNew }) {
  const [scenario, setScenario] = useState(initial);
  const [tried, setTried] = useState(false);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState('');
  const problems = useMemo(() => scenarioProblems(scenario, config, others), [scenario, config, others]);
  const channels = (Array.isArray(config?.channels) ? config.channels : []).map((c) => c?.id).filter(Boolean);
  const connections = Object.entries(config?.connections || {}).filter(([, c]) => c?.type === 'http').map(([id]) => id);
  const tools = toolIdsOf(config);
  const set = (patch) => setScenario((old) => { const next = { ...old, ...patch }; Object.keys(next).forEach((k) => { if (next[k] === undefined || (Array.isArray(next[k]) && !next[k].length && ['http_mocks', 'model_script'].includes(k))) delete next[k]; }); return next; });
  const setTurn = (i, say) => set({ turns: scenario.turns.map((t, k) => (k === i ? { ...t, say } : t)) });
  const setCaller = (patch) => { const caller = { ...(scenario.caller || {}), ...patch }; Object.keys(caller).forEach((k) => { if (!caller[k]) delete caller[k]; }); set({ caller: Object.keys(caller).length ? caller : undefined }); };
  const show = (key) => tried && problems[key];
  const scripted = Array.isArray(scenario.model_script) && scenario.model_script.length > 0;

  const openJson = () => { setJsonText(JSON.stringify(scenario, null, 2)); setJsonError(''); setJsonMode(true); };
  const closeJson = () => {
    try { const parsed = JSON.parse(jsonText); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('a scenario is an object'); setScenario(parsed); setJsonMode(false); setJsonError(''); } catch (e) { setJsonError(`Not valid JSON (${e.message}).`); }
  };
  const submit = (event) => {
    event.preventDefault();
    let value = scenario;
    if (jsonMode) { try { value = JSON.parse(jsonText); } catch (e) { setJsonError(`Not valid JSON (${e.message}).`); return; } }
    const found = scenarioProblems(value, config, others);
    setTried(true);
    if (jsonMode) setScenario(value);
    if (!hasProblems(found)) onSave(value);
  };

  return (
    <form className="scForm" noValidate aria-label={isNew ? 'New scenario' : `Edit ${initial.id}`} onSubmit={submit}>
      <div className="scFormTop">
        <span className={`scChip ${scripted ? 'good' : 'warn'}`} title={scripted ? 'Runs without a model: free and repeatable' : 'Uses a real model when run: costs money'}>{scripted ? 'Scripted' : 'Live'}</span>
        <button type="button" className="stLink" onClick={jsonMode ? closeJson : openJson}>{jsonMode ? 'Back to the form' : 'Edit as JSON'}</button>
      </div>

      {jsonMode ? (
        <label className="scJson"><span>The scenario as JSON</span>
          <textarea className="stFInput mono" rows={16} value={jsonText} spellCheck={false} aria-label="The scenario as JSON" aria-invalid={!!jsonError || undefined} onChange={(event) => { setJsonText(event.target.value); setJsonError(''); }} />
          {jsonError && <small className="stFErr">{jsonError}</small>}
        </label>
      ) : (
        <>
          <div className="scGrid">
            <label><span>Id</span>
              <input className="stFInput small mono" type="text" value={scenario.id} onChange={(event) => set({ id: event.target.value })} aria-invalid={!!show('id') || undefined} />
              {show('id') && <small className="stFErr">{problems.id}</small>}
            </label>
            <label><span>Channel</span>
              <SmartSelect className="stFInput small" value={scenario.channel} placeholder="Choose a channel…" ariaLabel="Channel" invalid={!!show('channel')} onChange={(chosen) => set({ channel: chosen })}
                options={[...channels, ...(scenario.channel && !channels.includes(scenario.channel) ? [{ value: scenario.channel, label: `${scenario.channel} (not in this agent)` }] : [])]} />
              {show('channel') && <small className="stFErr">{problems.channel}</small>}
            </label>
            <label className="wide"><span>What this scenario shows <em>(optional)</em></span>
              <input className="stFInput small" type="text" value={scenario.description || ''} placeholder="e.g. A billing question reaches billing and a ticket is raised." onChange={(event) => set({ description: event.target.value || undefined })} />
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
            <button type="button" className="stAddBtn" onClick={() => set({ expect: [...scenario.expect, newExpectation('said_matches', config)] })}>＋ Add an expectation</button>
          </fieldset>

          <details className="scMore" open={!!(scenario.model_script || scenario.http_mocks || scenario.now || scenario.state) || undefined}>
            <summary>Model script, API answers, clock and starting state</summary>
            <fieldset className="scBlock">
              <legend>The model’s replies <em>(a script makes the scenario free and repeatable)</em></legend>
              <ScriptEditor script={scenario.model_script} tools={tools} onChange={(model_script) => set({ model_script })} />
              {show('script') && <ul className="scProblems">{problems.script.map((text) => <li key={text} className="stFErr">{text}</li>)}</ul>}
            </fieldset>
            <fieldset className="scBlock">
              <legend>Answers for the bot’s API calls</legend>
              <MocksEditor mocks={scenario.http_mocks} connections={connections} onChange={(http_mocks) => set({ http_mocks })} />
              {show('mocks') && <ul className="scProblems">{problems.mocks.map((text) => <li key={text} className="stFErr">{text}</li>)}</ul>}
            </fieldset>
            <div className="scGrid">
              <label><span>Pretend it is <em>(a date and time with a time zone)</em></span>
                <input className="stFInput small mono" type="text" value={scenario.now || ''} placeholder="2026-10-14T03:00:00+08:00" aria-label="Pretend it is" aria-invalid={!!show('now') || undefined} onChange={(event) => set({ now: event.target.value || undefined })} />
                {show('now') ? <small className="stFErr">{problems.now}</small> : <small className="stMuted">Makes a schedule such as business hours open or closed, as the scenario needs. Without it the real clock is used.</small>}
              </label>
              <label className="wide"><span>Starting state <em>(values set before the conversation starts)</em></span>
                <JsonBox value={scenario.state} rows={2} label="Starting state" placeholder='{ "verified": true }' onChange={(state) => set({ state })} />
              </label>
            </div>
          </details>
        </>
      )}

      <div className="scActions">
        <button type="submit" className="primaryCta compactCta">{isNew ? 'Add the scenario' : 'Save the scenario'}</button>
        <button type="button" className="quietButton" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

