import React, { useMemo, useState } from 'react';
import { whatIfValue, whatIfVariables } from './serverPreview.js';
import Select from '../../ui/Select.tsx';

// "Preview as…": the what-ifs the server's previews take (channel, time, caller number, a few state values). Shared by
// the prompt preview and "Try it" so both ask the same in the same words; only changes from the defaults are sent.

// The what-if choices as state, with the request fields they make: { channel, state, nowLocal, callerPhone }.
export function useWhatIf(config) {
  const [channel, setChannel] = useState('');
  const [typed, setTyped] = useState({}); // what-if values as typed
  const [nowLocal, setNowLocal] = useState('');
  const [callerPhone, setCallerPhone] = useState('');
  const variables = useMemo(() => whatIfVariables(config), [config]);
  const state = useMemo(
    () => Object.fromEntries(variables.map((v) => [v.name, whatIfValue(v.type, typed[v.name])]).filter(([, value]) => value !== undefined)),
    [variables, typed],
  );
  const changed = !!channel || Object.keys(state).length > 0 || !!nowLocal || !!callerPhone.trim();
  const reset = () => {
    setChannel('');
    setTyped({});
    setNowLocal('');
    setCallerPhone('');
  };
  return {
    channel,
    setChannel,
    typed,
    setTyped,
    nowLocal,
    setNowLocal,
    callerPhone: callerPhone.trim(),
    callerPhoneText: callerPhone,
    setCallerPhone,
    variables,
    state,
    changed,
    reset,
  };
}

export default function WhatIfBar({ config, what, phone = true }) {
  const channels = (Array.isArray(config?.channels) ? config.channels : []).map((channel) => channel?.id).filter(Boolean);
  return (
    <div className="stPromptAs" role="group" aria-label="Preview as">
      <strong>Preview as…</strong>
      {channels.length > 0 && (
        <label>
          <span>On channel</span>
          <Select className="stFInput small" value={what.channel} onChange={(event) => what.setChannel(event.target.value)} aria-label="Preview on channel">
            <option value="">The first enabled one</option>
            {channels.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </Select>
        </label>
      )}
      <label>
        <span>Pretend it is</span>
        <input
          className="stFInput small"
          type="datetime-local"
          value={what.nowLocal}
          onChange={(event) => what.setNowLocal(event.target.value)}
          aria-label="Pretend it is this time"
        />
      </label>
      {phone && (
        <label>
          <span>Caller’s number</span>
          <input
            className="stFInput small"
            type="text"
            inputMode="tel"
            value={what.callerPhoneText}
            placeholder="as it comes"
            maxLength={30}
            onChange={(event) => what.setCallerPhone(event.target.value)}
            aria-label="Pretend the caller’s number is"
          />
        </label>
      )}
      {what.variables.map((v) => (
        <label key={v.name}>
          <span>
            If <code>{v.name}</code> were
          </span>
          {v.type === 'boolean' ? (
            <Select
              className="stFInput small"
              value={what.typed[v.name] ?? ''}
              onChange={(event) => what.setTyped((old) => ({ ...old, [v.name]: event.target.value }))}
              aria-label={`What if ${v.name} were`}
            >
              <option value="">as it starts</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </Select>
          ) : (
            <input
              className="stFInput small"
              type={v.type === 'number' || v.type === 'integer' ? 'number' : 'text'}
              value={what.typed[v.name] ?? ''}
              placeholder="as it starts"
              onChange={(event) => what.setTyped((old) => ({ ...old, [v.name]: event.target.value }))}
              aria-label={`What if ${v.name} were`}
            />
          )}
        </label>
      ))}
      {what.changed && (
        <button type="button" className="stLink" onClick={what.reset}>
          Reset
        </button>
      )}
    </div>
  );
}
