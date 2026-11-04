import React from 'react';
import SmartSelect from '../SmartSelect.jsx';
import Icon from '../../ui/Icon.jsx';
import { HTTP_METHODS } from './model.js';
import Select from '../../ui/Select.tsx';
import { Input } from '../../ui/Input.tsx';
import { JsonBox } from './JsonBox.jsx';

// The scenario editor's fakes: answers for the bot's API calls and the model's scripted replies.
// The answers for the bot's API calls.
export function MocksEditor({ mocks, onChange, connections, reportBox }) {
  const list = Array.isArray(mocks) ? mocks : [];
  const set = (i, patch) => onChange(list.map((m, k) => (k === i ? cleaned({ ...m, ...patch }) : m)));
  const cleaned = (m) => {
    const out = { ...m };
    Object.keys(out).forEach((k) => {
      if (out[k] === undefined || out[k] === '') delete out[k];
    });
    return out;
  };
  return (
    <div className="scMocks">
      {list.length === 0 && (
        <p className="stMuted">
          No mocks. A scenario never calls a real API: a request nothing answers gets a 404 and is listed in the result, with a button to add the mock.
        </p>
      )}
      {list.map((mock, i) => (
        <fieldset className="scMock" key={i}>
          <legend>Mock {i + 1}</legend>
          <div className="scGrid">
            <label>
              <span>Method</span>
              <Select
                className="stFInput small"
                value={mock.method || ''}
                onChange={(event) => set(i, { method: event.target.value })}
                aria-label={`Mock ${i + 1}: method`}
              >
                <option value="">Any</option>
                {HTTP_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              <span>Path</span>
              <Input
                size="small"
                mono
                type="text"
                value={mock.path || ''}
                placeholder="/orders/*"
                aria-label={`Mock ${i + 1}: path`}
                onChange={(event) => set(i, { path: event.target.value })}
              />
            </label>
            <label>
              <span>Answers with status</span>
              <Input
                size="small"
                type="number"
                min="100"
                max="599"
                value={mock.status ?? ''}
                placeholder="200"
                aria-label={`Mock ${i + 1}: status`}
                onChange={(event) => set(i, { status: event.target.value === '' ? undefined : Number(event.target.value) })}
              />
            </label>
            <label>
              <span>Only this many times</span>
              <Input
                size="small"
                type="number"
                min="1"
                value={mock.times ?? ''}
                placeholder="every time"
                aria-label={`Mock ${i + 1}: times`}
                onChange={(event) => set(i, { times: event.target.value === '' ? undefined : Number(event.target.value) })}
              />
            </label>
            {connections.length > 0 && (
              <label>
                <span>Only for connection</span>
                <Select
                  className="stFInput small"
                  value={mock.connection || ''}
                  onChange={(event) => set(i, { connection: event.target.value })}
                  aria-label={`Mock ${i + 1}: connection`}
                >
                  <option value="">Any</option>
                  {connections.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <label className="wide">
              <span>The JSON it answers with</span>
              <JsonBox
                onValid={reportBox}
                value={mock.json}
                objectOnly={false}
                rows={3}
                label={`Mock ${i + 1}: the JSON it answers with`}
                placeholder='{ "found": true }'
                onChange={(json) => set(i, { json })}
              />
            </label>
          </div>
          <details className="scMore">
            <summary>More: plain-text answer, query, body</summary>
            <div className="scGrid">
              <label>
                <span>Or a plain-text answer</span>
                <Input
                  size="small"
                  type="text"
                  value={mock.text || ''}
                  aria-label={`Mock ${i + 1}: text answer`}
                  onChange={(event) => set(i, { text: event.target.value })}
                />
              </label>
              <label>
                <span>The request must have these query values</span>
                <JsonBox
                  onValid={reportBox}
                  value={mock.query}
                  rows={2}
                  label={`Mock ${i + 1}: query`}
                  placeholder='{ "status": "open" }'
                  onChange={(query) => set(i, { query })}
                />
              </label>
              <label>
                <span>The JSON body must contain</span>
                <JsonBox
                  onValid={reportBox}
                  value={mock.body_contains}
                  rows={2}
                  label={`Mock ${i + 1}: body contains`}
                  placeholder='{ "reason": "late" }'
                  onChange={(body_contains) => set(i, { body_contains })}
                />
              </label>
            </div>
          </details>
          <button type="button" className="stFDel small" onClick={() => onChange(list.filter((_, k) => k !== i))}>
            Delete mock {i + 1}
          </button>
        </fieldset>
      ))}
      <button type="button" className="stAddBtn" onClick={() => onChange([...list, { method: 'GET', path: '', status: 200, json: {} }])}>
        <Icon name="plus" size={14} /> Add a mock
      </button>
    </div>
  );
}

// The model's replies, one per item: what it says, or the tool it calls.
export function ScriptEditor({ script, onChange, tools, reportBox }) {
  const list = Array.isArray(script) ? script : [];
  const set = (i, item) => onChange(list.map((x, k) => (k === i ? item : x)));
  return (
    <div className="scScript">
      <p className="stMuted">
        With a script, the language model is replaced: each item is one reply. It runs the real runtime (prompts, tools, preconditions, effects, handoffs)
        without a model, so it is free and the same every time. Without a script the scenario is <strong>live</strong>: it uses a real model, costs money, and
        can differ from run to run.
      </p>
      <ol className="scScriptList">
        {list.map((item, i) => {
          const calls = typeof item === 'object' && item !== null;
          return (
            <li key={i}>
              <Select
                className="stFInput small"
                value={calls ? 'tool' : 'say'}
                aria-label={`Model reply ${i + 1}: what it does`}
                onChange={(event) => set(i, event.target.value === 'tool' ? { tool: tools[0]?.value || '' } : '')}
              >
                <option value="say">Says</option>
                <option value="tool">Calls a tool</option>
              </Select>
              {calls ? (
                <>
                  <SmartSelect
                    className="stFInput small"
                    value={item.tool || ''}
                    placeholder="Choose a tool…"
                    ariaLabel={`Model reply ${i + 1}: tool`}
                    options={tools}
                    onChange={(chosen) => set(i, { ...item, tool: chosen })}
                  />
                  <JsonBox
                    onValid={reportBox}
                    value={item.args}
                    rows={1}
                    label={`Model reply ${i + 1}: arguments`}
                    placeholder='arguments, e.g. { "order_id": "NB-1003" }'
                    onChange={(args) => {
                      const next = { ...item };
                      if (args === undefined) delete next.args;
                      else next.args = args;
                      set(i, next);
                    }}
                  />
                </>
              ) : (
                <Input
                  size="small"
                  type="text"
                  value={item}
                  placeholder="What the model says"
                  aria-label={`Model reply ${i + 1}: what it says`}
                  onChange={(event) => set(i, event.target.value)}
                />
              )}
              <button
                type="button"
                className="stIconBtn danger"
                aria-label={`Delete model reply ${i + 1}`}
                onClick={() => onChange(list.filter((_, k) => k !== i))}
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          );
        })}
      </ol>
      <div className="scActions">
        <button type="button" className="stAddBtn" onClick={() => onChange([...list, ''])}>
          <Icon name="plus" size={14} /> Add a reply
        </button>
        {list.length > 0 && (
          <button type="button" className="stLink" onClick={() => onChange(undefined)}>
            Remove the script (make it live)
          </button>
        )}
      </div>
    </div>
  );
}
