import React, { useEffect, useId, useState } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { CREDENTIAL_NAME, describeMatches, joinUrl, samplePaths, validatePath, type TemplateScope } from '../../../../models/toolsPaths';
import { bodyFromParams, type ParamRow } from '../../../../models/toolsParams';
import { Button } from '../../../ui/Button';
import { cn, inputClass } from '../../../../utils/styles';
import { IdSelect, Labelled, Note } from './parts';
import { linkButton } from './keys';
import { TemplateInput } from './TemplateInput';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Name → value rows (query, headers), kept here so a half-typed name isn't lost. */
function KeyValueRows({ value, onChange, scope, disabled, word, warnCredentials }: {
  value: unknown;
  onChange: (next: Record<string, string>) => void;
  scope: TemplateScope;
  disabled?: boolean;
  word: string;
  warnCredentials?: boolean;
}) {
  const object = isObj(value) ? value : {};
  const fromObject = () => Object.entries(object).map(([key, v]) => ({ key, value: typeof v === 'string' ? v : JSON.stringify(v) }));
  const [rows, setRows] = useState(fromObject);
  const write = (items: { key: string; value: string }[]) => Object.fromEntries(items.filter((r) => r.key).map((r) => [r.key, r.value]));
  const outside = JSON.stringify(object);
  useEffect(() => {
    if (JSON.stringify(write(rows)) !== outside) setRows(fromObject());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outside]);
  const update = (items: { key: string; value: string }[]) => {
    setRows(items);
    onChange(write(items));
  };
  return (
    <div className="space-y-2">
      {rows.map((row, index) =>
      <div key={index} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-start gap-2">
          <input
          className={cn(inputClass, 'font-mono text-[13px]')}
          value={row.key}
          placeholder="name"
          spellCheck={false}
          aria-label={`${word} ${index + 1} name`}
          disabled={disabled}
          onChange={(e) => update(rows.map((r, i) => (i === index ? { ...r, key: e.target.value } : r)))} />
          <TemplateInput value={row.value} scope={scope} label={`${word} ${index + 1} value`} disabled={disabled} onChange={(v) => update(rows.map((r, i) => (i === index ? { ...r, value: v } : r)))} />
          {!disabled &&
        <Button size="sm" variant="ghost" className="h-9" aria-label={`Delete ${word.toLowerCase()} ${row.key || index + 1}`} onClick={() => update(rows.filter((_, i) => i !== index))}>
              <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
            </Button>
        }
          {warnCredentials && CREDENTIAL_NAME.test(row.key) &&
        <p className="col-span-3 text-xs text-warning">
              This looks like a credential. Don’t put a secret here: it would be saved in every version. Put it in the connection’s sign-in, which holds only the secret’s name.
            </p>
        }
        </div>
      )}
      {!disabled &&
      <Button size="sm" variant="ghost" onClick={() => setRows([...rows, { key: '', value: '' }])}>
          <PlusIcon className="h-3.5 w-3.5" aria-hidden />
          Add {word.toLowerCase()}
        </Button>
      }
    </div>);

}

interface RequestEditorProps {
  request: unknown;
  onChange: (next: Json) => void;
  connection: string;
  connections: string[];
  baseUrl: string;
  onConnection: (id: string) => void;
  scope: TemplateScope;
  paramRows: ParamRow[];
  disabled?: boolean;
}

/** A tool's web request: the connection, method, path, query, headers and body, with the address it will call. */
export function RequestEditor({ request, onChange, connection, connections, baseUrl, onConnection, scope, paramRows, disabled }: RequestEditorProps) {
  const own = useId();
  const req: Json = isObj(request) ? request : { method: 'GET', path: '' };
  const set = (patch: Json) => {
    const next: Json = { ...req, ...patch };
    Object.keys(next).forEach((k) => {
      if (next[k] === undefined || (['query', 'headers'].includes(k) && isObj(next[k]) && !Object.keys(next[k] as Json).length)) delete next[k];
    });
    onChange(next);
  };
  const method = String(req.method || 'GET');
  const hasBody = 'body' in req;
  const [bodyText, setBodyText] = useState(() => (hasBody ? JSON.stringify(req.body, null, 2) : ''));
  const [bodyError, setBodyError] = useState('');
  const outsideBody = JSON.stringify(req.body ?? null);
  useEffect(() => {
    try {
      if (JSON.stringify(JSON.parse(bodyText || 'null')) === outsideBody) return;
    } catch {
      /* a half-typed body is replaced by what the config now has */
    }
    setBodyText(hasBody ? JSON.stringify(req.body, null, 2) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outsideBody]);
  const queryCount = isObj(req.query) ? Object.keys(req.query).length : 0;
  const headerCount = isObj(req.headers) ? Object.keys(req.headers).length : 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <Labelled label="Connection" htmlFor={`${own}-conn`} help={baseUrl ? <>Base address: <code className="font-mono">{baseUrl}</code></> : connections.length ? 'The web service this tool calls. Connections are listed with the other extras on this page.' : 'There are no web connections yet. Add one under Connections on this page.'}>
          <IdSelect id={`${own}-conn`} label="Connection" value={connection} options={connections} disabled={disabled} onChange={onConnection} placeholder="Choose a connection…" />
        </Labelled>
        <Labelled label="Method" htmlFor={`${own}-method`}>
          <select id={`${own}-method`} className={inputClass} value={method} disabled={disabled} onChange={(e) => set({ method: e.target.value })}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Labelled>
      </div>
      <Labelled label="Path" htmlFor={`${own}-path`}>
        <TemplateInput id={`${own}-path`} label="Path" value={String(req.path ?? '')} scope={scope} disabled={disabled} placeholder="/accounts/{{args.account_id}}/bill" onChange={(v) => set({ path: v })} />
        <p className="mt-1.5 text-xs text-muted" aria-label="The address that will be called">
          Calls <code className="break-all font-mono text-ink-soft">{method} {joinUrl(baseUrl, req.path, req.query)}</code>
        </p>
      </Labelled>
      <details open={queryCount > 0} className="group">
        <summary className="cursor-pointer text-[13px] font-medium text-ink-soft">Query parameters{queryCount ? ` (${queryCount})` : ''}</summary>
        <div className="mt-2">
          <KeyValueRows value={req.query} scope={scope} disabled={disabled} word="Query parameter" onChange={(v) => set({ query: v })} />
        </div>
      </details>
      <details open={headerCount > 0}>
        <summary className="cursor-pointer text-[13px] font-medium text-ink-soft">Headers{headerCount ? ` (${headerCount})` : ''}</summary>
        <div className="mt-2">
          <KeyValueRows value={req.headers} scope={scope} disabled={disabled} word="Header" warnCredentials onChange={(v) => set({ headers: v })} />
        </div>
      </details>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[13px] font-medium text-ink-soft">Body</span>
          {hasBody && !disabled && <button type="button" className={cn(linkButton, 'text-xs')} onClick={() => set({ body: undefined })}>Remove the body</button>}
        </div>
        {hasBody ?
        <>
            <textarea
            aria-label="Request body (JSON)"
            rows={5}
            spellCheck={false}
            className={cn(inputClass, 'resize-y font-mono text-[13px]')}
            value={bodyText}
            disabled={disabled}
            onChange={(e) => {
              setBodyText(e.target.value);
              try {
                const v: unknown = JSON.parse(e.target.value);
                setBodyError('');
                set({ body: v });
              } catch (err: unknown) {
                setBodyError(err instanceof Error ? err.message : String(err));
              }
            }} />
            {bodyError && <Note tone="error" role="alert">Not valid JSON yet: {bodyError}</Note>}
            {paramRows.length > 0 && !disabled && <button type="button" className={cn(linkButton, 'mt-1 text-xs')} onClick={() => set({ body: bodyFromParams(paramRows) })}>Build the body from the parameters</button>}
          </> :

        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => set({ body: paramRows.length && method !== 'GET' ? bodyFromParams(paramRows) : {} })}>
            <PlusIcon className="h-3.5 w-3.5" aria-hidden />
            Add a body{paramRows.length && method !== 'GET' ? ' from the parameters' : ''}
          </Button>
        }
      </div>
    </div>);

}

/** A response path box with its check: the grammar, and what it picks out of the sample (when there is one). */
function PathBox({ value, onChange, sample, label, disabled }: { value: string; onChange: (v: string) => void; sample: unknown; label: string; disabled?: boolean }) {
  const check = validatePath(value);
  const match = sample !== undefined && check.ok ? describeMatches(sample, value) : null;
  return (
    <div className="min-w-0 flex-1">
      <input className={cn(inputClass, 'font-mono text-[13px]')} value={value} placeholder="$.field" spellCheck={false} aria-label={label} aria-invalid={(!check.ok && !!value) || undefined} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      {value && !check.ok && <Note tone="error">{check.error}</Note>}
      {match && <Note tone={match.ok ? 'ok' : 'warn'}>{match.ok ? `→ ${match.text}` : `This ${match.text}.`}</Note>}
    </div>);

}

interface ResponsePanelProps {
  result: unknown;
  onChange: (next: Json | undefined) => void;
  stateVars: string[];
  sample: unknown;
  disabled?: boolean;
}

/** What is done with the answer: which fields the model sees, which values are kept for later. */
export function ResponsePanel({ result, onChange, stateVars, sample, disabled }: ResponsePanelProps) {
  const value: Json = isObj(result) ? result : {};
  const toLlm = Array.isArray(value.to_llm) ? (value.to_llm as string[]) : [];
  const toState = (isObj(value.to_state) ? value.to_state : {}) as Record<string, string>;
  const set = (patch: Json) => {
    const next: Json = { ...value, ...patch };
    if (Array.isArray(next.to_llm) && !next.to_llm.length) delete next.to_llm;
    if (isObj(next.to_state) && !Object.keys(next.to_state).length) delete next.to_state;
    onChange(Object.keys(next).length ? next : undefined);
  };
  const unmapped = stateVars.filter((v) => !(v in toState));
  const paths = sample === undefined ? [] : samplePaths(sample);
  const outOfBand = isObj(value.out_of_band) ? value.out_of_band : null;

  return (
    <div className="space-y-4">
      <p className={cn('rounded-md px-3 py-2 text-[13px]', toLlm.length ? 'bg-subtle text-ink-soft' : 'bg-warning-soft text-ink')} role="note">
        {toLlm.length ? 'Only these fields of the answer are shown to the model; everything else is dropped.' : 'The model sees the whole answer, including fields you didn’t mean to show. Choose the fields it needs below.'}
      </p>
      <div>
        <p className="mb-1 text-[13px] font-medium text-ink-soft">Fields the model sees</p>
        <div className="space-y-2">
          {toLlm.map((path, index) =>
          <div key={index} className="flex items-start gap-2">
              <PathBox value={path} sample={sample} disabled={disabled} label={`Model field ${index + 1}`} onChange={(v) => set({ to_llm: toLlm.map((p, i) => (i === index ? v : p)) })} />
              {!disabled &&
            <Button size="sm" variant="ghost" className="h-9" aria-label={`Delete model field ${path || index + 1}`} onClick={() => set({ to_llm: toLlm.filter((_, i) => i !== index) })}>
                  <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
                </Button>
            }
            </div>
          )}
          {!disabled &&
          <Button size="sm" variant="ghost" onClick={() => set({ to_llm: [...toLlm, ''] })}>
              <PlusIcon className="h-3.5 w-3.5" aria-hidden />
              Add a field
            </Button>
          }
        </div>
      </div>
      <div>
        <p className="mb-1 text-[13px] font-medium text-ink-soft">Values kept for later</p>
        <p className="mb-2 text-xs text-muted">Copy a value from the answer into a state variable, so later steps (and {'{{state.…}}'} in what the agent says) can use it.</p>
        <div className="space-y-2">
          {Object.keys(toState).map((variable) =>
          <div key={variable} className="flex items-start gap-2">
              <code className="mt-2 w-36 shrink-0 truncate font-mono text-[13px] text-ink" title={variable}>{variable}</code>
              <PathBox value={String(toState[variable] ?? '')} sample={sample} disabled={disabled} label={`Path for ${variable}`} onChange={(v) => set({ to_state: { ...toState, [variable]: v } })} />
              {!disabled &&
            <Button
              size="sm"
              variant="ghost"
              className="h-9"
              aria-label={`Delete the value kept in ${variable}`}
              onClick={() => set({ to_state: Object.fromEntries(Object.entries(toState).filter(([k]) => k !== variable)) })}>
                  <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
                </Button>
            }
            </div>
          )}
          {!disabled &&
          <select
            aria-label="Keep a value in a state variable"
            className={cn(inputClass, 'max-w-xs')}
            value=""
            onChange={(e) => e.target.value && set({ to_state: { ...toState, [e.target.value]: '' } })}>
              <option value="">{unmapped.length ? 'Keep a value in…' : stateVars.length ? 'Every state variable is used' : 'No state variables yet'}</option>
              {unmapped.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          }
        </div>
      </div>
      {outOfBand &&
      <p className="text-[13px] text-ink-soft">
          Sent straight to the caller, never shown to the model: {(Array.isArray(outOfBand.fields) ? outOfBand.fields : []).map(String).join(', ') || 'no fields yet'}
          {typeof outOfBand.via === 'string' && outOfBand.via ? ` (by ${outOfBand.via})` : ''}. Change it in the JSON view.
        </p>
      }
      {sample !== undefined && paths.length > 0 &&
      <div>
          <p className="mb-1 text-[13px] font-medium text-ink-soft">Fields in the sample answer</p>
          <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-md border border-line" aria-label="Fields in the sample">
            {paths.map((p) =>
          <li key={p.path} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-[13px]">
                <code className="font-mono text-ink">{p.path}</code>
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{p.preview}</span>
                {!disabled &&
            <button type="button" className={cn(linkButton, 'text-xs')} disabled={toLlm.includes(p.path)} onClick={() => set({ to_llm: [...toLlm, p.path] })}>
                    {toLlm.includes(p.path) ? 'Shown to the model' : 'Show to the model'}
                  </button>
            }
              </li>
          )}
          </ul>
        </div>
      }
    </div>);

}
