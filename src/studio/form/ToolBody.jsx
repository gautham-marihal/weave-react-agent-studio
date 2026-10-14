import React from 'react';
import { isObj } from './engine.js';
import { useForm } from './ctx.js';
import { NumberInput, TextInput } from './fields.jsx';
import { IdChip } from './IdTools.jsx';
import { FieldRow, ObjectBody } from './Node.jsx';
import EffectsEditor from './EffectsEditor.jsx';
import ParamsEditor from './ParamsEditor.jsx';
import { RequestEditor, ResponsePanel } from './RequestResponse.jsx';
import { argNamesOf, templateScope } from './templates.js';
import { BUILTIN_HELP, ON_ERROR_HELP, REPLY_CHOICES, agentsUsingTool, describeAdvice, notAvailable, timeoutAdvice } from './toolInfo.js';
import { readParams } from './paramSchema.js';

// One tool, drawn for what it is. The description (the text that tells the model when to use it) comes first, the
// model-facing parts are in one place each (what it fills in, the request, the response, what happens on an error), and
// what the runtime can't run yet or what no agent uses is said right on the card. The rest uses the ordinary form.

const HANDLED = ['id', 'name', 'description', 'parameters', 'connection', 'request', 'result', 'reply', 'effects', 'on_error', 'timeout_s', 'retries'];

const sortByOrder = (obj, order) => {
  const rank = (key) => { const i = order.indexOf(key); return i === -1 ? order.length : i; };
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).sort(([a], [b]) => rank(a) - rank(b)));
};

export default function ToolBody({ shape, value, path, onChange, disabled }) {
  const ctx = useForm();
  const obj = isObj(value) ? value : {};
  const order = Object.keys(shape.properties);
  const has = (key) => key in shape.properties;
  const handled = Object.fromEntries(Object.entries(obj).filter(([key]) => HANDLED.includes(key)));
  const rest = Object.fromEntries(Object.entries(obj).filter(([key]) => !HANDLED.includes(key)));
  const restShape = {
    ...shape,
    properties: Object.fromEntries(Object.entries(shape.properties).filter(([key]) => !HANDLED.includes(key))),
    required: (shape.required || []).filter((key) => !HANDLED.includes(key)),
  };
  const set = (patch, meta) => {
    if (meta?.deleted) ctx.markDelete(meta.deleted);
    onChange(sortByOrder({ ...obj, ...patch }, order));
  };

  const scope = templateScope(ctx.config, { argNames: argNamesOf(obj) });
  const unavailable = notAvailable(obj);
  const users = obj.id ? agentsUsingTool(ctx.config, obj.id) : [];
  const advice = has('description') ? describeAdvice(obj.description) : null;
  const paramRows = has('parameters') ? readParams(obj.parameters).rows : [];
  const showName = has('name') && obj.name !== undefined && obj.name !== obj.id;
  const timeoutNotes = has('timeout_s') ? timeoutAdvice(obj) : [];
  const isHttp = obj.type === 'http';
  const resultShape = isHttp && has('result') ? ctx.engine.resolveShape(shape.properties.result, obj.result) : null;

  return (
    <div className="stFObject stTool" data-tool-kind={obj.type || 'builtin'}>
      {unavailable && (
        <div className="stToolNote warn" role="note">
          <strong>{unavailable} aren’t available in the runtime yet.</strong> This tool is saved with the agent but will have no effect until they are.
        </div>
      )}

      <div className="stFGrid">
        {obj.id ? <IdChip id={obj.id} disabled={disabled} onRename={() => ctx.requestRename('tools', obj.id)} /> : null}
        {has('name') && (
          <div className="stFRow wide">
            {showName ? (
              <>
                <div className="stFLabel"><label htmlFor={`${path.join('-')}-name`}>Name the model sees</label><code className="stFKey">name</code>
                  <button type="button" className="stFDel small" disabled={disabled} onClick={() => set({ name: undefined }, { deleted: 'the model-facing name' })}>Delete</button></div>
                <TextInput id={`${path.join('-')}-name`} value={obj.name} onChange={(v) => set({ name: v })} disabled={disabled} mono placeholder="snake_case" />
                <p className="stFHelp">The name the model calls the tool by: lowercase letters, digits and _.</p>
              </>
            ) : (
              <p className="stFHelp">The model sees this tool as <code>{obj.id || 'its id'}</code>. {!disabled && <button type="button" className="stLink" onClick={() => set({ name: obj.id })}>Use a different name…</button>}</p>
            )}
          </div>
        )}
      </div>

      {obj.builtin && BUILTIN_HELP[obj.builtin] && <p className="stToolNote info">{BUILTIN_HELP[obj.builtin]}</p>}

      {has('description') && (
        <div className="stFRow wide stDescRow" data-path={`${path.join('.')}.description`}>
          <div className="stFLabel"><label htmlFor={`${path.join('-')}-desc`}>Description</label>{has('description') && (shape.required || []).includes('description') && <abbr title="Required" className="stFReq">*</abbr>}<code className="stFKey">description</code></div>
          <TextInput id={`${path.join('-')}-desc`} value={obj.description ?? ''} onChange={(v) => set({ description: v === '' ? undefined : v })} disabled={disabled} multiline placeholder="Use this when the caller asks for their current bill. It needs their account number." invalid={advice?.level === 'warn' && (shape.required || []).includes('description')} />
          <div className="stDescMeta">
            <span className={`stDescAdvice ${advice?.level}`}>{advice?.text || 'It tells the model when to reach for this tool.'}</span>
            <span className="stMuted">{(obj.description || '').length} characters</span>
          </div>
        </div>
      )}

      {has('parameters') && (
        <fieldset className="stToolBlock">
          <legend>What the model fills in</legend>
          <ParamsEditor value={obj.parameters} onChange={(next, meta) => set({ parameters: next }, meta)} toolName={obj.name || obj.id} description={obj.description} disabled={disabled} />
        </fieldset>
      )}

      {isHttp && has('request') && (
        <fieldset className="stToolBlock">
          <legend>The request</legend>
          <RequestEditor request={obj.request} onChange={(next) => set({ request: next })} connection={obj.connection || ''} onConnection={(v) => set({ connection: v })}
            connectionPath={[...path, 'connection']} scope={scope} paramRows={paramRows} disabled={disabled} />
        </fieldset>
      )}

      {isHttp && has('result') && (
        <fieldset className="stToolBlock">
          <legend>The response</legend>
          <ResponsePanel result={obj.result} onChange={(next) => set({ result: next })} disabled={disabled}
            outOfBand={resultShape?.properties?.out_of_band ? (
              <FieldRow name="out_of_band" label="Sent straight to the caller" schema={resultShape.properties.out_of_band} value={obj.result?.out_of_band} path={[...path, 'result', 'out_of_band']}
                missing={!isObj(obj.result) || !('out_of_band' in obj.result)} disabled={disabled}
                onAdd={() => set({ result: { ...(obj.result || {}), out_of_band: ctx.engine.defaultFor(resultShape.properties.out_of_band) } })}
                onChange={(v) => set({ result: { ...(obj.result || {}), out_of_band: v } })}
                onRemove={() => set({ result: Object.fromEntries(Object.entries(obj.result || {}).filter(([k]) => k !== 'out_of_band')) }, { deleted: 'the direct delivery' })} />
            ) : null} />
        </fieldset>
      )}

      {(has('reply') || has('effects')) && (
        <fieldset className="stToolBlock" data-block="after">
          <legend>After it succeeds</legend>
          {has('reply') && (
            <div className="stFRow wide" data-path={`${path.join('.')}.reply`}>
              <div className="stFLabel"><span>Who speaks next</span><code className="stFKey">reply</code></div>
              <div className="stReply" role="radiogroup" aria-label="Who speaks after the tool runs">
                {REPLY_CHOICES.map((choice) => {
                  const checked = (obj.reply ?? 'model') === choice.value;
                  return (
                    <label key={choice.value} className={`stReplyChoice ${checked ? 'on' : ''}`}>
                      <input type="radio" name={`${path.join('-')}-reply`} checked={checked} disabled={disabled} onChange={() => set({ reply: choice.value === 'model' ? undefined : choice.value })} />
                      <span><strong>{choice.label}</strong><small>{choice.help}</small><em>{choice.example}</em></span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {has('effects') && (
            <div className="stFRow wide" data-path={`${path.join('.')}.effects`}>
              <div className="stFLabel"><span>Then, in order</span><code className="stFKey">effects</code></div>
              <p className="stFHelp">Rules that run after the tool succeeds: each applies always or only when a condition holds, and then does its steps in order (say a line, change state, hand off, end the call…).</p>
              <EffectsEditor shape={shape.properties.effects} value={obj.effects} path={[...path, 'effects']} disabled={disabled}
                emptyText="Nothing happens after this tool succeeds, apart from the model answering. Add a rule to say a line, change state, hand off or end the call."
                onChange={(next) => set({ effects: next.length ? next : undefined }, next.length < (obj.effects || []).length ? { deleted: 'the rule' } : undefined)} />
            </div>
          )}
        </fieldset>
      )}

      {isHttp && (has('on_error') || has('timeout_s') || has('retries')) && (
        <fieldset className="stToolBlock">
          <legend>When it goes wrong</legend>
          {has('on_error') && (
            <div className="stFRow wide" data-path={`${path.join('.')}.on_error`}>
              <div className="stFLabel"><label htmlFor={`${path.join('-')}-err`}>Message for the model</label><code className="stFKey">on_error.tool_error</code></div>
              <TextInput id={`${path.join('-')}-err`} value={obj.on_error?.tool_error ?? ''} multiline disabled={disabled} placeholder="Tell the caller you could not fetch the bill and offer a callback."
                onChange={(v) => set({ on_error: v === '' ? undefined : { ...(obj.on_error || {}), tool_error: v } })} />
              <p className="stFHelp">{ON_ERROR_HELP}</p>
            </div>
          )}
          <div className="stFGrid">
            {has('timeout_s') && (
              <div className="stFRow">
                <div className="stFLabel"><label>Give up after (seconds)</label><code className="stFKey">timeout_s</code></div>
                <NumberInput value={obj.timeout_s} onChange={(v) => set({ timeout_s: v })} min={0.1} disabled={disabled} />
              </div>
            )}
            {has('retries') && (
              <div className="stFRow">
                <div className="stFLabel"><label>Retries</label><code className="stFKey">retries</code></div>
                <NumberInput value={obj.retries} onChange={(v) => set({ retries: v })} min={0} integer disabled={disabled} />
              </div>
            )}
          </div>
          {timeoutNotes.map((note, index) => <p key={index} className="stFHint">{note}</p>)}
        </fieldset>
      )}

      <ObjectBody shape={restShape} value={rest} path={path} disabled={disabled}
        onChange={(nextRest) => onChange(sortByOrder({ ...handled, ...nextRest }, order))} />

      {obj.id && (
        <p className={`stToolUse ${users.length ? '' : 'unused'}`}>
          {users.length
            ? <>Offered by {users.map((id, i) => <React.Fragment key={id}>{i ? ', ' : ''}<code>{id}</code></React.Fragment>)}.</>
            : <>No agent offers this tool yet, so the model can’t use it. Add it to an agent’s tools. (Handing over to another agent isn’t done here but under the agent’s Handoffs.)</>}
        </p>
      )}
    </div>
  );
}
