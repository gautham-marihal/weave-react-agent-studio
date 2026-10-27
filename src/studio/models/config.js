// Reads and writes an agent's three model choices (listen, think, speak) under defaults.models. Pure, so the tests run
// it in plain Node.
//
// Choosing a provider also sets its first model, the conventional name of its key's secret and (for speech) a voice.
// The rest of the slot (language, keyterms, temperature, fallbacks…) stays; anything only the old provider used goes.

import { VOICE_CATALOG } from '../../voiceCatalog.js';
import { RENAMED_PROVIDERS, STAGES, defaultModelFor, modelLabel, providerLabel, providersForStage, secretFor } from './catalog.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value) => (typeof value === 'string' ? value : '');

export const SECRET_PATTERN = /^[A-Z][A-Z0-9_]*$/;
export const VOICE_GENDERS = ['Female', 'Male'];
// A provider's voices, optionally only the Female or only the Male ones.
export const voicesFor = (provider, gender) =>
  VOICE_CATALOG.filter((voice) => voice.provider.toLowerCase() === String(provider).toLowerCase() && (!gender || voice.gender === gender));
// The voice a provider starts with: a female one, unless it has none.
export const defaultVoiceFor = (provider) => voicesFor(provider, 'Female')[0] || voicesFor(provider)[0];
// Which list to show for the voice in use: its own gender, else Female.
export const genderOfVoice = (provider, voiceId) => voicesFor(provider).find((voice) => voice.voiceId === voiceId)?.gender || 'Female';

export function readModels(config) {
  const models = isObject(config?.defaults?.models) ? config.defaults.models : {};
  const slot = (stage) => ({
    provider: str(models[stage]?.provider),
    model: str(models[stage]?.model),
    secret: str(models[stage]?.api_key?.secret),
    baseUrl: str(models[stage]?.base_url),
  });
  return { stt: slot('stt'), llm: slot('llm'), tts: { ...slot('tts'), voiceId: str(models.tts?.voice_id) } };
}

// One line per stage for showing what an agent will use, e.g. "Speech-to-text · OpenAI · GPT Realtime Whisper".
export function summarizeModels(config) {
  const read = readModels(config);
  return STAGES.map((stage) => {
    const { provider, model } = read[stage.id];
    return {
      stage: stage.id,
      label: stage.short,
      provider,
      providerName: provider ? providerLabel(provider) : '',
      model,
      modelName: model ? modelLabel(stage.id, provider, model) : '',
      set: !!provider,
    };
  });
}

export const sameModels = (a, b) => JSON.stringify(readModels(a)) === JSON.stringify(readModels(b));

// Writes into a copy; returns the same object when nothing would change.
function edit(config, stage, change) {
  const next = clone(config);
  const defaults = isObject(next.defaults) ? next.defaults : (next.defaults = {});
  const models = isObject(defaults.models) ? defaults.models : (defaults.models = {});
  const slot = { ...(isObject(models[stage]) ? models[stage] : {}) };
  change(slot);
  models[stage] = slot;
  return JSON.stringify(next) === JSON.stringify(config) ? config : next;
}

// `providers` is the server's list (for each provider's secret name); without it the conventional names are used.
export function setProvider(config, stage, provider, providers) {
  if (readModels(config)[stage].provider === provider) return config;
  return edit(config, stage, (slot) => {
    slot.provider = provider;
    const model = defaultModelFor(stage, provider);
    if (model) slot.model = model;
    else delete slot.model;
    const secret = secretFor(provider, providers);
    if (secret) slot.api_key = { secret };
    else delete slot.api_key;
    delete slot.base_url; // an endpoint and options belong to the provider that was chosen before
    delete slot.options;
    if (stage === 'tts') {
      const voice = defaultVoiceFor(provider);
      if (voice) slot.voice_id = voice.voiceId;
      else delete slot.voice_id;
    }
  });
}

export function setModel(config, stage, model) {
  const value = String(model || '').trim();
  if (readModels(config)[stage].model === value) return config;
  return edit(config, stage, (slot) => {
    if (value) slot.model = value;
    else delete slot.model;
  });
}

export function setSecret(config, stage, secret) {
  const value = String(secret || '').trim();
  if (readModels(config)[stage].secret === value) return config;
  return edit(config, stage, (slot) => {
    if (value) slot.api_key = { secret: value };
    else delete slot.api_key;
  });
}

export function setBaseUrl(config, stage, baseUrl) {
  const value = String(baseUrl || '').trim();
  if (readModels(config)[stage].baseUrl === value) return config;
  return edit(config, stage, (slot) => {
    if (value) slot.base_url = value;
    else delete slot.base_url;
  });
}

// For a provider the runtime doesn't know under that name: the same thing under the name it does know.
export const renamedProvider = (stage, provider) => {
  const fix = RENAMED_PROVIDERS[provider];
  return fix && fix.stages.includes(stage) ? fix : null;
};
export function applyRenamedProvider(config, stage, providers) {
  const fix = renamedProvider(stage, readModels(config)[stage].provider);
  if (!fix) return config;
  let next = setProvider(config, stage, fix.provider, providers);
  if (fix.model) next = setModel(next, stage, fix.model);
  if (fix.baseUrl) next = setBaseUrl(next, stage, fix.baseUrl);
  if (fix.secret) next = setSecret(next, stage, fix.secret);
  return next;
}

// Makes a saved voice the agent's actual voice: its provider (with that provider's model and key) and its voice id.
export function applyVoice(config, voice, providers) {
  const withProvider = voice.provider ? setProvider(config, 'tts', voice.provider, providers) : config;
  return setVoiceId(withProvider, voice.voice_id || voice.voiceId);
}

export function setVoiceId(config, voiceId) {
  const value = String(voiceId || '').trim();
  if (readModels(config).tts.voiceId === value) return config;
  return edit(config, 'tts', (slot) => {
    if (value) slot.voice_id = value;
    else delete slot.voice_id;
  });
}

// What would stop a stage from starting with its chosen model, per GET /providers; null when nothing (or nothing is
// chosen, or the list is unknown). The Agent page's row and the AI models panel say the same.
//   -> { short, text } | null
export function slotProblem(stage, slot, providers) {
  if (!slot?.provider || !Array.isArray(providers) || !providers.length) return null;
  const current = providers.find((p) => p.name === slot.provider);
  const runnable = current && current.installed !== false && (current.stages || []).includes(stage);
  if (!runnable) return { short: 'Can’t run', text: `The runtime can’t run “${slot.provider}” for this. Choose one from the list.` };
  if (current.default_secret && current.key_available === false)
    return { short: 'Key missing', text: `The server doesn’t have ${current.default_secret} set, so a call would fail to start until it does.` };
  return null;
}

// ---- default speech models
// A voice channel needs speech-to-text and text-to-speech models (a new agent has neither). Picks an installed provider
// with its key set, else any installed one (the deploy check flags the key), never one needing a base URL; else null.
export function bestProviderFor(stage, providers) {
  const usable = providersForStage(providers, stage).filter((p) => p.installed !== false && p.name !== 'openai_compatible' && !!defaultModelFor(stage, p.name));
  return usable.find((p) => p.key_available === true) || usable[0] || null;
}

// A copy of the config with missing speech models set to the best provider's default; models already set stay.
// -> { config, added: [{ stage, provider, keySet }], skipped: [stage] }
export function addDefaultSpeechModels(config, providers) {
  const models = isObject(config?.defaults?.models) ? config.defaults.models : {};
  let next = config;
  const added = [];
  const skipped = [];
  ['stt', 'tts'].forEach((stage) => {
    if (models[stage]?.provider) return;
    const provider = bestProviderFor(stage, providers);
    if (!provider) {
      skipped.push(stage);
      return;
    }
    next = setProvider(next, stage, provider.name, providers);
    added.push({ stage, provider: provider.name, keySet: provider.key_available === true });
  });
  return { config: next, added, skipped };
}
