import React from 'react';
import { Card, Field } from '../builderUi.jsx';
import { Notice } from '../ui.jsx';
import { CATALOGUE_REVIEWED, FREE_TEXT_PROVIDERS, STAGES, modelStatus, modelsFor, providerLabel, providersForStage } from './catalog.js';
import {
  SECRET_PATTERN,
  applyRenamedProvider,
  readModels,
  renamedProvider,
  setBaseUrl,
  setModel,
  setProvider,
  setSecret,
  setVoiceId,
  voicesFor,
} from './config.js';
import GenderToggle, { useVoiceGender } from './GenderToggle.jsx';
import { useProviders } from './useProviders.js';
import './models.css';

const STAGE_HELP = {
  stt: 'Speech-to-text converts the caller’s speech into text the assistant can understand.',
  llm: 'The language model decides what the assistant should say and which configured tool to use.',
  tts: 'Text-to-speech turns the assistant’s reply into spoken audio.',
};

// The model cards of one stage: the models its provider offers, the one in use selected. A model the list doesn't
// know (one typed in, or set elsewhere) is shown as the current one rather than hidden.
function ModelCards({ stage, provider, value, onChange }) {
  const models = modelsFor(stage.id, provider);
  const known = models.some((model) => model.id === value);
  return (
    <div className="builderModelPicker">
      <div className="builderModelPickerHeading">
        <div>
          <strong>{stage.modelHeading}</strong>
          <small>{provider ? `${providerLabel(provider)} · ${models.length} model option${models.length === 1 ? '' : 's'}` : 'Choose a provider first'}</small>
        </div>
        <span className="builderModelTag">Model</span>
      </div>
      <div className="builderModelGrid">
        {models.map((model) => (
          <button
            type="button"
            key={model.id}
            className={`builderModelCard ${value === model.id ? 'selected' : ''}`}
            onClick={() => onChange(model.id)}
            aria-pressed={value === model.id}
          >
            <span className="builderModelRadio" aria-hidden="true">
              {value === model.id ? '✓' : ''}
            </span>
            <span className="builderModelCopy">
              <strong>{model.label}</strong>
              <small>{model.note}</small>
              <code>{model.id}</code>
              {model.tags?.length > 0 && (
                <span className="builderModelTags">
                  {model.tags.map((tag) => (
                    <em key={tag}>{tag}</em>
                  ))}
                </span>
              )}
            </span>
          </button>
        ))}
        {value && !known && (
          <button type="button" className="builderModelCard selected" aria-pressed="true">
            <span className="builderModelRadio" aria-hidden="true">
              ✓
            </span>
            <span className="builderModelCopy">
              <strong>Current model</strong>
              <small>Not in the list above</small>
              <code>{value}</code>
            </span>
          </button>
        )}
      </div>
      {models.length === 0 && provider && (
        <p className="builderModelFootnote">
          {FREE_TEXT_PROVIDERS[provider] || `${providerLabel(provider)} has no ready-made list here.`} Type the model id below.
        </p>
      )}
      <p className="builderModelFootnote">
        This is a catalogue kept in the studio and reviewed on {CATALOGUE_REVIEWED}, not a live check of what{' '}
        {provider ? providerLabel(provider) : 'a provider'} or your account offers. The server doesn’t check model ids: confirm the model is available before
        you deploy.
      </p>
    </div>
  );
}

// One provider the runtime can run at this stage. A provider whose plugin isn't installed on the server is shown but
// can't be chosen; one whose usual key isn't set there is flagged, since a call would fail to start.
function ProviderCard({ provider, selected, onPick }) {
  const missing = provider.installed === false;
  const noKey = !missing && provider.default_secret && provider.key_available === false;
  return (
    <button
      type="button"
      className={`builderProviderCard ${selected ? 'selected' : ''} ${missing ? 'unavailable' : ''}`}
      disabled={missing}
      onClick={() => onPick(provider.name)}
      aria-pressed={selected}
      title={missing ? 'Its plugin isn’t installed on the server.' : noKey ? `${provider.default_secret} isn’t set on the server.` : undefined}
    >
      <span className="builderProviderIcon">{provider.name === 'openai' ? '✦' : provider.name === 'elevenlabs' ? '◉' : '○'}</span>
      <span>
        <strong>{providerLabel(provider.name)}</strong>
        <small>{selected ? 'Selected' : missing ? 'Not installed on this server' : noKey ? 'Key not set on the server' : 'Available'}</small>
      </span>
      <i>{selected ? '✓' : ''}</i>
    </button>
  );
}

// "Models": choose how the agent listens (speech-to-text), thinks (language model) and speaks (text-to-speech): a
// provider the runtime can run, then one of that provider's models. Written to defaults.models, which is what the
// agent runs with, and what the Test tab runs once the draft is saved.
// The provider's voices, one gender at a time (Female | Male), each with a button to use it.
function VoiceList({ provider, voiceId, onPick }) {
  const [gender, setGender] = useVoiceGender(provider, voiceId);
  if (voicesFor(provider).length === 0) return null;
  return (
    <>
      <div className="builderSubhead">Voices · {providerLabel(provider)}</div>
      <GenderToggle provider={provider} value={gender} onChange={setGender} />
      <div className="builderSuggestedVoices">
        {voicesFor(provider, gender).map((voice) => {
          const inUse = voice.voiceId === voiceId;
          return (
            <div className="builderSuggestedVoice" key={voice.id}>
              <span className="builderVoiceAvatar">{voice.name.slice(0, 1)}</span>
              <span className="builderSuggestedVoiceInfo">
                <strong>{voice.name}</strong>
                <small>
                  {voice.language} <i>·</i> {voice.style}
                </small>
              </span>
              <button type="button" disabled={inUse} onClick={() => onPick(voice.voiceId)}>
                {inUse ? 'In use' : 'Use voice'}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function ModelsEditor({ editor, onShowJson }) {
  const { providers, live, loading, error, note, reload } = useProviders();
  const config = editor.parsed.value;
  if (editor.parsed.error || !editor.isObject) {
    return (
      <Notice
        kind="warn"
        title="The JSON needs fixing first"
        actions={
          <button type="button" className="quietButton" onClick={onShowJson}>
            Open the JSON
          </button>
        }
      >
        The models are read from the draft, which isn’t valid JSON right now.
      </Notice>
    );
  }
  const read = readModels(config);
  const apply = (next) => {
    if (next !== config) editor.setValue(next);
  };

  return (
    <div className="stModels">
      <Notice kind="info" title="One choice, used everywhere">
        These are the models the agent runs with. Save the draft and the Test tab starts a conversation with exactly these.
      </Notice>
      {!live && !loading && (
        <Notice
          kind="warn"
          title="Couldn’t check which providers the server can run"
          actions={
            <button type="button" className="quietButton" onClick={reload}>
              Try again
            </button>
          }
        >
          {error?.message ? `${error.message} ` : ''}The list below is the set the server normally ships with, so a provider may be offered that this server
          doesn’t have.
        </Notice>
      )}

      {STAGES.map((stage) => {
        const slot = read[stage.id];
        const offered = providersForStage(providers, stage.id);
        const current = providers.find((item) => item.name === slot.provider);
        const runnable = !slot.provider || (current && current.installed !== false && (current.stages || []).includes(stage.id));
        const fix = renamedProvider(stage.id, slot.provider);
        const secretBad = !!slot.secret && !SECRET_PATTERN.test(slot.secret);
        const needsBaseUrl = slot.provider === 'openai_compatible';
        return (
          <Card key={stage.id} title={stage.title} help={STAGE_HELP[stage.id]} subtitle={stage.subtitle}>
            <div className="builderProviderGrid">
              {offered.map((provider) => (
                <ProviderCard
                  key={provider.name}
                  provider={provider}
                  selected={slot.provider === provider.name}
                  onPick={(name) => apply(setProvider(config, stage.id, name, providers))}
                />
              ))}
            </div>
            {!runnable && (
              <Notice
                kind="error"
                title={`The runtime can’t run “${slot.provider}” for ${stage.short.toLowerCase()}`}
                actions={
                  fix ? (
                    <button type="button" className="quietButton" onClick={() => apply(applyRenamedProvider(config, stage.id, providers))}>
                      {fix.needsBaseUrl ? 'Switch to OpenAI-compatible' : `Switch to ${providerLabel(fix.provider)}`}
                    </button>
                  ) : undefined
                }
              >
                {fix
                  ? fix.why
                  : current && current.installed === false
                    ? 'Its plugin isn’t installed on this server.'
                    : 'The server doesn’t list it for this stage.'}{' '}
                The server refuses a configuration that names it, so it can’t be published until you choose one of the cards above.
              </Notice>
            )}
            <ModelCards stage={stage} provider={slot.provider} value={slot.model} onChange={(model) => apply(setModel(config, stage.id, model))} />
            <div className="builderGrid two stModelsFields">
              <Field
                label="Model ID"
                requirement="required"
                help="Pick a card above, or type any model id your provider offers. The server needs one."
                example="e.g. gpt-4o-transcribe"
                value={slot.model}
                onChange={(v) => apply(setModel(config, stage.id, v))}
                invalid={!!slot.provider && !slot.model}
                hint={slot.provider ? modelStatus(stage.id, slot.provider, slot.model).text : undefined}
              />
              <Field
                label="API key secret"
                requirement="optional"
                help="The name of the secret in the server’s vault that holds this provider’s key. The key itself is never stored in the configuration."
                example="e.g. OPENAI_API_KEY"
                value={slot.secret}
                onChange={(v) => apply(setSecret(config, stage.id, v))}
                invalid={secretBad}
                hint={secretBad ? 'Use capital letters, digits and underscores, starting with a letter.' : undefined}
              />
            </div>
            {needsBaseUrl && (
              <div className="stModelsFields">
                <Field
                  label="Base URL"
                  requirement="required"
                  help="The address of the OpenAI-compatible service (Mistral, Azure, a local model server, ...)."
                  example="e.g. https://api.mistral.ai/v1"
                  value={slot.baseUrl}
                  onChange={(v) => apply(setBaseUrl(config, stage.id, v))}
                  invalid={!slot.baseUrl}
                />
              </div>
            )}
            {stage.id === 'tts' && (
              <>
                <VoiceList provider={slot.provider} voiceId={slot.voiceId} onPick={(id) => apply(setVoiceId(config, id))} />
                <Field
                  label="Voice ID"
                  requirement="optional"
                  help="The exact voice identifier from the provider. Pick a voice above or paste your own."
                  example="e.g. owsLoyJNU4K7ctU6NF7F"
                  value={slot.voiceId}
                  onChange={(v) => apply(setVoiceId(config, v))}
                />
              </>
            )}
          </Card>
        );
      })}
      {note && <p className="stModelsNote">{note}</p>}
    </div>
  );
}
