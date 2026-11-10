import React, { useMemo, useState } from 'react';
import Fold from '../../../../ui/Fold.jsx';
import { Input, TextArea } from '../../../../ui/Input.tsx';
import Select from '../../../../ui/Select.tsx';
import { useResultPreview } from '../../../form/usePreview.js';
import { sampleArgs, taskWords } from '../../../form/serverPreview.js';
import WhatIfBar, { useWhatIf } from '../../../form/WhatIfBar.jsx';
import { PREVIEW_SOURCE } from '../../../form/tryPanels.js';
import { getAtPath } from '../../schemaPath.js';
import './toolTry.css';

// "Try it" for the tool chosen on Build › Tools (FRONTEND_GUIDE 10.1, POST /preview/result): sample arguments and a
// pasted sample answer in; out comes the request it would send, whether it may run, and how the answer splits three
// ways (what the model reads, what is kept in state, what goes straight to the caller), then what follows. Nothing is
// called and no secret is read: the server works it out from the draft as it is now. Nothing here is saved.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

// one argument as a box: a choice for an enum or a yes/no, a number box for a number, else text
function ArgField({ name, spec, value, onChange, id }) {
  const kind = Array.isArray(spec?.enum) ? 'enum' : spec?.type;
  return (
    <label className="ttField" htmlFor={id}>
      <span>
        {name}
        {spec?.description && <small>{spec.description}</small>}
      </span>
      {kind === 'enum' || kind === 'boolean' ? (
        <Select
          id={id}
          className="stFInput"
          value={String(value ?? '')}
          onChange={(event) => onChange(kind === 'boolean' ? event.target.value === 'true' : event.target.value)}
        >
          {(kind === 'boolean' ? ['true', 'false'] : spec.enum.map(String)).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          id={id}
          type={kind === 'number' || kind === 'integer' ? 'number' : 'text'}
          value={value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)}
          onChange={(event) => {
            const raw = event.target.value;
            if (kind === 'number' || kind === 'integer') onChange(raw === '' ? undefined : Number(raw));
            else if (kind === 'array' || kind === 'object') {
              try {
                onChange(JSON.parse(raw));
              } catch {
                onChange(raw);
              }
            } else onChange(raw);
          }}
        />
      )}
    </label>
  );
}

export default function ToolTry({ ctx, entry }) {
  const tool = getAtPath(ctx.config, entry.base) || {};
  const props = isObj(tool.parameters?.properties) ? tool.parameters.properties : {};
  const [args, setArgs] = useState(() => sampleArgs(tool.parameters));
  const [answerText, setAnswerText] = useState('');
  const answer = useMemo(() => {
    if (!answerText.trim()) return { value: undefined, error: '' };
    try {
      return { value: JSON.parse(answerText), error: '' };
    } catch (e) {
      return { value: undefined, error: `Not valid JSON (${e.message}).` };
    }
  }, [answerText]);
  const what = useWhatIf(ctx.config);
  const result = useResultPreview({
    config: ctx.config,
    tool: tool.id,
    args,
    response: answer.value,
    state: what.state,
    channel: what.channel,
    nowLocal: what.nowLocal,
    enabled: !!tool.id && !answer.error,
  });
  const view = result.data;
  const runs = !view?.preconditions || view.preconditions.holds;
  const stored = Object.entries(view?.storedInState || {});

  return (
    <div className="ttTry">
      <div className="ttGrid">
        <div className="ttPane" aria-label="What you give it">
          <h3 className="ttHead">You give it</h3>
          {Object.keys(props).length === 0 ? (
            <p className="dtNote">It takes no arguments: the model calls it with nothing to fill in.</p>
          ) : (
            Object.entries(props).map(([name, spec]) => (
              <ArgField
                key={name}
                id={`tt-${entry.key}-${name}`}
                name={name}
                spec={spec}
                value={args[name]}
                onChange={(v) => setArgs((old) => ({ ...old, [name]: v }))}
              />
            ))
          )}
          <label className="ttField" htmlFor={`tt-${entry.key}-answer`}>
            <span>
              A sample answer from the service
              <small>Paste one to see what the model reads of it. It is never saved.</small>
            </span>
            <TextArea
              id={`tt-${entry.key}-answer`}
              mono
              rows={4}
              spellCheck={false}
              value={answerText}
              placeholder='{ "found": true, "status": "shipped" }'
              aria-invalid={!!answer.error || undefined}
              onChange={(event) => setAnswerText(event.target.value)}
            />
            {answer.error && <small className="stFErr">{answer.error}</small>}
          </label>
          <Fold className="ttWhatIf" open={what.changed}>
            <summary>What if… {what.changed && <span className="stTag">changed</span>}</summary>
            <WhatIfBar config={ctx.config} what={what} phone={false} />
          </Fold>
        </div>

        <div className="ttPane" aria-live="polite" aria-label="What would happen">
          <h3 className="ttHead">
            What would happen
            {result.source && <span className={`stTag ${result.source === 'server' ? 'good' : ''}`}>{PREVIEW_SOURCE[result.source]}</span>}
          </h3>
          {result.note && (
            <p className="stFWarn" role="note">
              {result.note}
            </p>
          )}
          {result.loading && !view && (
            <p className="dtNote" role="status">
              Asking the server…
            </p>
          )}
          {result.error && (
            <p className="stFErr" role="alert">
              The server couldn’t work this out: {result.error.message}
            </p>
          )}
          {view && (
            <>
              {view.argsProblems.map((p) => (
                <p key={p} className="stFWarn">
                  {p}
                </p>
              ))}
              {view.request && (
                <div className="ttReq" data-block="request">
                  <span className="ttReqLine">
                    <b className="ttVerb">{view.request.method || 'GET'}</b>
                    <span>{view.request.url}</span>
                  </span>
                  {Object.keys(view.request.query).length > 0 && <small>Query {show(view.request.query)}</small>}
                  {view.request.body !== null && <small>Body {show(view.request.body)}</small>}
                  {Object.keys(view.request.headers).length > 0 && <small>Headers {show(view.request.headers)}</small>}
                  {view.request.auth && view.request.auth.type !== 'none' && (
                    <small>
                      Signed in with {view.request.auth.type}
                      {view.request.auth.secrets.length
                        ? `, from the secret${view.request.auth.secrets.length === 1 ? '' : 's'} ${view.request.auth.secrets.join(', ')}`
                        : ''}
                    </small>
                  )}
                </div>
              )}
              {view.task && <p className="dtNote">{taskWords(view.task)}</p>}
              <div className={`ttGate ${runs ? 'yes' : 'no'}`} data-block="gate">
                <span className="ttGateIco" aria-hidden="true">
                  {runs ? '✓' : '!'}
                </span>
                <span>
                  <b>May it run? {runs ? 'Yes.' : 'No.'}</b>{' '}
                  {runs
                    ? view.preconditions
                      ? 'Its conditions hold with these values.'
                      : 'It has no conditions.'
                    : `Nothing is sent, and the model is told: “${view.preconditions.message || 'it can’t run now'}”`}
                </span>
              </div>
              {runs && view.hasAnswer && (
                <div className="ttLanes" data-block="answer">
                  <div className="ttLane model">
                    <h4>
                      <i aria-hidden="true" />
                      The model reads
                    </h4>
                    <pre>{view.modelSeesText || '(nothing)'}</pre>
                  </div>
                  <div className="ttLane state">
                    <h4>
                      <i aria-hidden="true" />
                      Kept in state
                    </h4>
                    {stored.length ? <pre>{stored.map(([k, v]) => `${k} = ${show(v)}`).join('\n')}</pre> : <small>Nothing is kept.</small>}
                  </div>
                  <div className="ttLane caller">
                    <h4>
                      <i aria-hidden="true" />
                      Straight to the caller
                    </h4>
                    {view.keptFromModel.length ? (
                      <>
                        <pre>{view.keptFromModel.join(', ')}</pre>
                        <small>Sent without passing through the model</small>
                      </>
                    ) : (
                      <small>Nothing goes around the model.</small>
                    )}
                  </div>
                </div>
              )}
              {runs && !view.hasAnswer && <p className="dtNote">Paste a sample answer to see what the model, the state and the caller each get.</p>}
              {runs && view.hasAnswer && (
                <div className="ttThen" data-block="effects">
                  <span className="ttThenIco" aria-hidden="true">
                    ↳
                  </span>
                  {view.effects.length ? (
                    <ul>
                      {view.effects.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  ) : (
                    <span>Nothing else happens after it.</span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
