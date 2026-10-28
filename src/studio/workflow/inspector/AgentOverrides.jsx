import React from 'react';
import { isObj } from '../../form/engine.js';
import {
  defaultInterrupt,
  defaultLlm,
  defaultVoice,
  interruptChoice,
  llmChoice,
  llmOptions,
  setInterrupt,
  setLlm,
  setVoice,
  voiceChoice,
  voiceOptions,
} from '../agentOverrides.js';
import { useProviders } from '../../models/useProviders.js';
import Select from '../../../ui/Select.tsx';

// A subagent's own AI model, voice and interruptions (shown on its General tab and on its AI model block).

// a setting the agent may override: its label, and "Use the default" while it has its own
function OwnSetting({ label, id, mine, onDefault, children }) {
  return (
    <div className="wfField wfOwn">
      <div className="wfOwnHead">
        <label htmlFor={id}>{label}</label>
        {mine ? (
          <button type="button" className="linkButton" onClick={onDefault}>
            Use the default
          </button>
        ) : (
          <small>Using default</small>
        )}
      </div>
      {children}
    </div>
  );
}

const grouped = (options) => {
  const groups = new Map();
  options.forEach((o) => groups.set(o.group, [...(groups.get(o.group) || []), o]));
  return [...groups.entries()];
};

// its own AI model, voice and whether it can be interrupted; each uses the default until it is changed here
export function AgentOverrides({ id, agent, config, write }) {
  const { providers } = useProviders();
  const llm = llmChoice(agent, config);
  const voice = voiceChoice(agent, config);
  const interrupt = interruptChoice(agent);
  const own = isObj(agent.overrides?.models) ? agent.overrides.models : {};
  const realtime = isObj(own.realtime)
    ? own.realtime
    : own.realtime === undefined && isObj(config?.defaults?.models?.realtime)
      ? config.defaults.models.realtime
      : null;
  const special = realtime || own.llm === null || own.tts === null;
  return (
    <section className="wfSection wfOwnSet">
      <h4>How it talks</h4>
      {special ? (
        <p className="wfMuted">
          {realtime
            ? `It talks through a realtime model${realtime.model ? ` (${realtime.model})` : ''}, so its AI model and voice are set in All settings for this subagent.`
            : 'Its AI model and voice are set in All settings for this subagent.'}
        </p>
      ) : (
        <>
          <OwnSetting label="AI model" id={`${id}-llm`} mine={!!llm} onDefault={() => write(setLlm(agent, '', config))}>
            <Select id={`${id}-llm`} className="stFInput" value={llm} onChange={(event) => write(setLlm(agent, event.target.value, config, providers))}>
              <option value="">Default: {defaultLlm(config)}</option>
              {grouped(llmOptions(agent, providers, config)).map(([group, options]) => (
                <optgroup key={group} label={group}>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </OwnSetting>
          <OwnSetting label="Voice" id={`${id}-voice`} mine={!!voice} onDefault={() => write(setVoice(agent, '', config))}>
            <Select id={`${id}-voice`} className="stFInput" value={voice} onChange={(event) => write(setVoice(agent, event.target.value, config, providers))}>
              <option value="">Default: {defaultVoice(config)}</option>
              {grouped(voiceOptions(agent, config)).map(([group, options]) => (
                <optgroup key={group} label={group}>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </OwnSetting>
        </>
      )}
      <OwnSetting
        label="Callers can interrupt it"
        id={`${id}-interrupt`}
        mine={interrupt !== undefined}
        onDefault={() => write(setInterrupt(agent, undefined))}
      >
        <label className="wfCheck">
          <input
            id={`${id}-interrupt`}
            type="checkbox"
            checked={interrupt ?? defaultInterrupt(config)}
            onChange={(event) => write(setInterrupt(agent, event.target.checked), '')}
          />{' '}
          It stops talking when the caller starts
        </label>
      </OwnSetting>
    </section>
  );
}
