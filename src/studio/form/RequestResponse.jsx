import React, { useEffect, useId, useMemo, useState } from 'react';
import Fold from '../../ui/Fold.jsx';
import SmartSelect from '../SmartSelect.jsx';
import { isObj } from './engine.js';
import { JsonInput, Select } from './fields.jsx';
import InlineCreate from './InlineCreate.jsx';
import { useConfigSelect, useForm } from './ctx.js';
import { parseJsonStrict } from '../jsonDuplicates.js';
import { describeMatches, samplePaths, validatePath } from './jsonPaths.js';
import TryIt from './TryIt.jsx';
import { bodyFromParams } from './paramSchema.js';
import TemplateField from './TemplateField.jsx';
import { TechKey } from './TechName.jsx';
import Icon from '../../ui/Icon.jsx';
import ChoiceBox from '../../ui/Select.tsx';

// A tool's HTTP call in the form: the request (RequestEditor: connection, method, path, query, headers, body), a path
// field that offers what can go in it (PathInput), and what is done with the answer (ResponsePanel).

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const CREDENTIAL_NAME = /authori[sz]ation|api[-_ ]?key|token|secret|password|passwd|bearer/i;

// ---- name → value rows (query, headers), kept locally so a half-typed name isn't lost
function KeyValueRows({ value, onChange, scope, disabled, keyLabel, warnCredentials }) {
  const object = isObj(value) ? value : {};
  const fromObject = () => Object.entries(object).map(([key, v]) => ({ key, value: typeof v === 'string' ? v : JSON.stringify(v) }));
  const [rows, setRows] = useState(fromObject);
  const write = (list) => {
    const out = {};
    list.forEach((row) => {
      if (row.key) out[row.key] = row.value;
    });
    return out;
  };
  useEffect(() => {
    if (JSON.stringify(write(rows)) !== JSON.stringify(object)) setRows(fromObject());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const update = (list, meta) => {
    setRows(list);
    onChange(write(list), meta);
  };
  return (
    <div className="stKV">
      {rows.map((row, index) => (
        <div className="stKVRow" key={index}>
          <input
            className="stFInput small mono"
            type="text"
            spellCheck={false}
            value={row.key}
            placeholder={keyLabel}
            aria-label={`${keyLabel} ${index + 1} name`}
            disabled={disabled}
            onChange={(event) => update(rows.map((r, i) => (i === index ? { ...r, key: event.target.value } : r)))}
          />
          <TemplateField
            value={row.value}
            scope={scope}
            disabled={disabled}
            ariaLabel={`${keyLabel} ${index + 1} value`}
            onChange={(v) => update(rows.map((r, i) => (i === index ? { ...r, value: v } : r)))}
          />
          <button
            type="button"
            className="stFDel small"
            aria-label={`Delete ${keyLabel} ${row.key || index + 1}`}
            disabled={disabled}
            onClick={() =>
              update(
                rows.filter((_, i) => i !== index),
                { deleted: `${keyLabel} ${row.key || index + 1}` },
              )
            }
          >
            Delete
          </button>
          {warnCredentials && CREDENTIAL_NAME.test(row.key) && (
            <small className="stFWarn stKVWarn">
              This looks like a credential. Don’t put a secret here: it would be saved in every version. Put it in the connection’s authentication, which holds
              only the secret’s name.
            </small>
          )}
        </div>
      ))}
      <button type="button" className="stAddBtn" disabled={disabled} onClick={() => setRows([...rows, { key: '', value: '' }])}>
        <Icon name="plus" size={14} /> Add {keyLabel.toLowerCase()}
      </button>
    </div>
  );
}

function joinUrl(base, path, query) {
  const root = String(base || '').replace(/\/+$/, '');
  const tail = String(path || '');
  const url = root ? `${root}${tail.startsWith('/') || !tail ? '' : '/'}${tail}` : tail || '…';
  const pairs = isObj(query) ? Object.entries(query).filter(([k]) => k) : [];
  return pairs.length ? `${url}?${pairs.map(([k, v]) => `${k}=${v}`).join('&')}` : url;
}

// ---- the HTTP request: connection, method, path, query, headers, body -----------------------------------------------
export function RequestEditor({ request, onChange, connection, onConnection, connectionPath, scope, paramRows, disabled }) {
  const ctx = useForm();
  const req = isObj(request) ? request : { method: 'GET', path: '' };
  const [creating, setCreating] = useState(false);
  const own = useId(); // ids of this request's own boxes: two tools' requests can be open at once
  const methodId = `${own}-method`;
  const pathId = `${own}-path`;
  const set = (patch) => {
    const next = { ...req, ...patch };
    Object.keys(next).forEach((key) => {
      if (next[key] === undefined || (['query', 'headers'].includes(key) && isObj(next[key]) && !Object.keys(next[key]).length)) delete next[key];
    });
    onChange(next);
  };
  const connections = ctx.refOptions.http_connections || [];
  const base = useConfigSelect((c) => c?.connections?.[connection]?.base_url);
  const hasBody = 'body' in req;
  const url = `${req.method || 'GET'} ${joinUrl(base, req.path, req.query)}`;

  return (
    <div className="stRequest">
      <div className="stFGrid">
        <div className="stFRow">
          <div className="stFLabel">
            <label>Connection</label>
            <abbr title="Required" className="stFReq">
              *
            </abbr>
          </div>
          {connections.length || connection ? (
            <Select value={connection} options={connections} onChange={onConnection} disabled={disabled} placeholder="Choose a connection…" />
          ) : (
            <p className="stFEmpty">There are no HTTP connections yet.</p>
          )}
          {!disabled && (
            <button type="button" className="stLink stNewBtn" onClick={() => setCreating((v) => !v)}>
              <Icon name="plus" size={14} /> New HTTP connection
            </button>
          )}
          {creating && <InlineCreate collection="http_connections" target={connectionPath} onClose={() => setCreating(false)} />}
          {base && (
            <small className="stMuted">
              Base address: <code>{base}</code>
            </small>
          )}
        </div>
        <div className="stFRow">
          <div className="stFLabel">
            <label htmlFor={methodId}>Method</label>
            <abbr title="Required" className="stFReq">
              *
            </abbr>
          </div>
          <ChoiceBox
            id={methodId}
            className="stFInput"
            value={req.method || 'GET'}
            disabled={disabled}
            onChange={(event) => set({ method: event.target.value })}
          >
            {METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </ChoiceBox>
        </div>
      </div>
      <div className="stFRow wide">
        <div className="stFLabel">
          <label htmlFor={pathId}>Path</label>
          <abbr title="Required" className="stFReq">
            *
          </abbr>
        </div>
        <TemplateField
          id={pathId}
          value={req.path || ''}
          onChange={(v) => set({ path: v })}
          scope={scope}
          disabled={disabled}
          placeholder="/accounts/{{args.account_id}}/bill"
        />
        <p className="stUrlPreview" aria-label="The address that will be called">
          <span>Calls</span> <code>{url}</code>
        </p>
      </div>
      <Fold className="stFold" open={isObj(req.query) && Object.keys(req.query).length > 0}>
        <summary>Query parameters{isObj(req.query) && Object.keys(req.query).length ? ` (${Object.keys(req.query).length})` : ''}</summary>
        <KeyValueRows
          value={req.query}
          onChange={(v, meta) => {
            if (meta?.deleted) ctx.markDelete(meta.deleted);
            set({ query: v });
          }}
          scope={scope}
          disabled={disabled}
          keyLabel="Query parameter"
        />
      </Fold>
      <Fold className="stFold" open={isObj(req.headers) && Object.keys(req.headers).length > 0}>
        <summary>Headers{isObj(req.headers) && Object.keys(req.headers).length ? ` (${Object.keys(req.headers).length})` : ''}</summary>
        <KeyValueRows
          value={req.headers}
          onChange={(v, meta) => {
            if (meta?.deleted) ctx.markDelete(meta.deleted);
            set({ headers: v });
          }}
          scope={scope}
          disabled={disabled}
          keyLabel="Header"
          warnCredentials
        />
      </Fold>
      <div className="stFRow wide">
        <div className="stFLabel">
          <label>Body</label>
          {hasBody && !disabled && (
            <button
              type="button"
              className="stFDel small"
              onClick={() => {
                ctx.markDelete('the request body');
                set({ body: undefined });
              }}
            >
              Delete
            </button>
          )}
        </div>
        {hasBody ? (
          <>
            <JsonInput value={req.body} onChange={(v) => set({ body: v })} disabled={disabled} />
            {paramRows.length > 0 && !disabled && (
              <button type="button" className="stLink stNewBtn" onClick={() => set({ body: bodyFromParams(paramRows) })}>
                Build the body from the parameters
              </button>
            )}
          </>
        ) : (
          <div className="stFAddRow">
            <button
              type="button"
              className="stAddBtn"
              disabled={disabled}
              onClick={() => set({ body: paramRows.length && req.method !== 'GET' ? bodyFromParams(paramRows) : {} })}
            >
              <Icon name="plus" size={14} /> Add a body{paramRows.length && req.method !== 'GET' ? ' from the parameters' : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- a path with its check: the grammar, and what it picks out of the sample ----------------------------------------
export function PathInput({ value, onChange, sample, disabled, label, placeholder = '$.field' }) {
  const check = validatePath(value || '');
  const match = sample !== undefined && check.ok ? describeMatches(sample, value) : null;
  return (
    <div className="stPathBox">
      <input
        className="stFInput mono"
        type="text"
        spellCheck={false}
        value={value ?? ''}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={(!check.ok && !!value) || undefined}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && !check.ok && <small className="stFErr">{check.error}</small>}
      {match && <small className={match.ok ? 'stFOk' : 'stFWarn'}>{match.ok ? `→ ${match.text}` : `This ${match.text}.`}</small>}
    </div>
  );
}

// ---- the response: what the model sees, which values go into state --------------------------------------------------
export function ResponsePanel({ path: toolPath = [], result, onChange, outOfBand, disabled, toolId, parameters }) {
  const ctx = useForm();
  const value = isObj(result) ? result : {};
  const toLlm = Array.isArray(value.to_llm) ? value.to_llm : [];
  const toState = isObj(value.to_state) ? value.to_state : {};
  const stateVars = ctx.refOptions.state_vars || [];
  const [sampleText, setSampleText] = useState('');
  const [creating, setCreating] = useState(false);
  const [sampleOpen, setSampleOpen] = useState(false);
  const parsed = useMemo(() => {
    if (!sampleText.trim()) return { sample: undefined, error: '' };
    try {
      return { sample: parseJsonStrict(sampleText), error: '' };
    } catch (error) {
      return { sample: undefined, error: error.message };
    }
  }, [sampleText]);
  const sample = parsed.sample;
  const paths = useMemo(() => (sample === undefined ? [] : samplePaths(sample)), [sample]);

  const set = (patch) => {
    const next = { ...value, ...patch };
    if (Array.isArray(next.to_llm) && !next.to_llm.length) delete next.to_llm;
    if (isObj(next.to_state) && !Object.keys(next.to_state).length) delete next.to_state;
    onChange(Object.keys(next).length ? next : undefined);
  };
  const addToLlm = (path) => {
    if (!toLlm.includes(path)) set({ to_llm: [...toLlm, path] });
  };
  const addToState = (variable, path) => set({ to_state: { ...toState, [variable]: path } });
  const unmapped = stateVars.filter((name) => !(name in toState));

  return (
    <div className="stResponse">
      <div className={`stSeeNotice ${toLlm.length ? 'ok' : 'warn'}`} role="note">
        {toLlm.length ? (
          <>Only these fields of the response are shown to the model; everything else is dropped.</>
        ) : (
          <>
            <strong>The model will see the whole response</strong>, including fields you didn’t mean to expose. Choose the fields it needs below.
          </>
        )}
      </div>

      <div className="stFRow wide">
        <div className="stFLabel">
          <label>Fields the model sees</label>
          <TechKey name="to_llm" path={[...toolPath, 'result', 'to_llm']} />
        </div>
        {toLlm.map((path, index) => (
          <div className="stPathRow" key={index}>
            <PathInput
              value={path}
              sample={sample}
              disabled={disabled}
              label={`Model field ${index + 1}`}
              onChange={(v) => set({ to_llm: toLlm.map((p, i) => (i === index ? v : p)) })}
            />
            <button
              type="button"
              className="stFDel small"
              aria-label={`Delete model field ${path || index + 1}`}
              disabled={disabled}
              onClick={() => {
                ctx.markDelete(`model field ${path || index + 1}`);
                set({ to_llm: toLlm.filter((_, i) => i !== index) });
              }}
            >
              Delete
            </button>
          </div>
        ))}
        <button type="button" className="stAddBtn" disabled={disabled} onClick={() => set({ to_llm: [...toLlm, ''] })}>
          <Icon name="plus" size={14} /> Add a field
        </button>
      </div>

      <div className="stFRow wide">
        <div className="stFLabel">
          <label>Values kept for later</label>
          <TechKey name="to_state" path={[...toolPath, 'result', 'to_state']} />
        </div>
        <p className="stFHelp">Copy a value from the response into a state variable, so later steps (and {'{{state.…}}'} in what the agent says) can use it.</p>
        {Object.keys(toState).map((variable) => (
          <div className="stPathRow" key={variable}>
            <code className="stFMapKey">{variable}</code>
            <PathInput value={toState[variable]} sample={sample} disabled={disabled} label={`Path for ${variable}`} onChange={(v) => addToState(variable, v)} />
            <button
              type="button"
              className="stFDel small"
              aria-label={`Delete value kept in ${variable}`}
              disabled={disabled}
              onClick={() => {
                ctx.markDelete(`the value kept in ${variable}`);
                const { [variable]: _gone, ...rest } = toState;
                set({ to_state: rest });
              }}
            >
              Delete
            </button>
          </div>
        ))}
        {!disabled && (
          <div className="stFAddRow">
            <SmartSelect
              action
              className="stFInput small"
              ariaLabel="Keep a value in a state variable"
              placeholder="Keep a value in…"
              options={unmapped}
              onChange={(name) => {
                if (name) addToState(name, '');
              }}
            />
            <button type="button" className="stLink" onClick={() => setCreating((v) => !v)}>
              <Icon name="plus" size={14} /> New state variable
            </button>
          </div>
        )}
        {creating && <InlineCreate collection="state_vars" onClose={() => setCreating(false)} />}
      </div>

      {outOfBand}

      <details className="stFold sample" onToggle={(event) => setSampleOpen(event.currentTarget.open)}>
        <summary>Try it on a sample response{sample !== undefined ? ` (${paths.length} fields)` : ''}</summary>
        <p className="stFHelp">
          Paste an example of what the API sends back. It is only used on this screen to pick fields and check paths. <strong>It is never saved</strong>, but
          don’t paste real customer data anyway.
        </p>
        <textarea
          className="stFInput mono"
          rows={6}
          value={sampleText}
          spellCheck={false}
          aria-label="A sample response"
          placeholder={'{ "balance": 42.5, "customer": { "name": "Asha" } }'}
          onChange={(event) => setSampleText(event.target.value)}
        />
        {parsed.error && <small className="stFErr">Not valid JSON: {parsed.error}</small>}
        {sample !== undefined && (
          <>
            <ul className="stSampleTree" aria-label="Fields in the sample">
              {paths.map((item) => (
                <li key={item.path}>
                  <code>{item.path}</code>
                  <span className="stMuted">{item.preview}</span>
                  {!disabled && (
                    <span className="stSampleActions">
                      <button type="button" className="stLink" onClick={() => addToLlm(item.path)} disabled={toLlm.includes(item.path)}>
                        {toLlm.includes(item.path) ? 'Shown to the model' : 'Show to the model'}
                      </button>
                      {unmapped.length > 0 && item.kind !== 'list' && (
                        <SmartSelect
                          action
                          className="stFInput small"
                          ariaLabel={`Keep ${item.path} in a variable`}
                          placeholder="Keep in…"
                          options={unmapped}
                          onChange={(name) => {
                            if (name) addToState(name, item.path);
                          }}
                        />
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {sampleOpen && toolId && <TryIt toolId={toolId} parameters={parameters} sample={sample} sampleError={parsed.error} hasSample={sample !== undefined} />}
      </details>
    </div>
  );
}
