import { isObj } from '../form/engine.js';
import { readModels } from '../models/config.js';
import { MODEL_OPTIONS, PROVIDER_LABELS, secretFor } from '../models/catalog.js';
import { allVoices, voiceInUse } from '../agent/pickers/pickerLogic.js';

// What one agent of a workflow does differently from the rest: its own AI model, its own voice, whether a caller can
// interrupt it. Each is kept in the agent's `overrides` (merged over the defaults by the runtime) and is absent while
// the agent uses the default, which is what the panel says. Pure: it reads and returns agents, and never changes the
// one it is given.

const own = (agent) => (isObj(agent?.overrides) ? agent.overrides : {});
const ownModels = (agent) => (isObj(own(agent).models) ? own(agent).models : {});
const clone = (v) => JSON.parse(JSON.stringify(v));

// an agent with one part of its overrides set (or taken away, `value` undefined), and every part left empty by that taken away too
function withOverride(agent, path, value) {
  const next = clone(agent);
  let at = (next.overrides = isObj(next.overrides) ? next.overrides : {});
  const trail = [at];
  path.slice(0, -1).forEach((key) => {
    at[key] = isObj(at[key]) ? at[key] : {};
    at = at[key];
    trail.push(at);
  });
  const last = path[path.length - 1];
  if (value === undefined) delete at[last];
  else at[last] = value;
  // empty containers go, innermost first
  for (let i = path.length - 2; i >= 0; i -= 1) {
    const parent = trail[i];
    if (!Object.keys(parent[path[i]]).length) delete parent[path[i]];
  }
  if (!Object.keys(next.overrides).length) delete next.overrides;
  return next;
}

// ---- the AI model: "provider|model", '' for the default An agent's own model is merged over the default's by the
// runtime: it may leave the provider out (the default's is used) and carry settings of its own (a temperature), which
// are kept. A model of another provider than the one in use brings that provider's key, and leaves the key, endpoint
// and options of the one before behind (as the Models page does); back on the default's provider, the default's key is
// used.
const modelLabel = (stage, provider, model) => MODEL_OPTIONS[stage]?.[provider]?.find((m) => m.id === model)?.label || model;
export const providerName = (provider) => PROVIDER_LABELS[provider] || provider;
const PROVIDER_KEYS = ['provider', 'api_key', 'base_url', 'options'];
const without = (slot, keys) => {
  const next = { ...slot };
  keys.forEach((key) => delete next[key]);
  return next;
};
const ownSlot = (agent, stage) => (isObj(ownModels(agent)[stage]) ? ownModels(agent)[stage] : {});
const lower = (v) => String(v || '').toLowerCase();

export function llmChoice(agent, config) {
  const llm = ownSlot(agent, 'llm');
  return llm.model ? `${llm.provider || readModels(config).llm.provider || ''}|${llm.model}` : '';
}
export function defaultLlm(config) {
  const { provider, model } = readModels(config).llm;
  return model ? `${modelLabel('llm', provider, model)} (${providerName(provider)})` : 'Not chosen yet';
}
// the catalogue's models, by provider (only providers the server can run, when that is known); the agent's own choice is kept even if it isn't in it
export function llmOptions(agent, providers = [], config = null) {
  const runnable = (name) => !providers.length || providers.some((p) => p.name === name && (p.stages || []).includes('llm') && p.installed !== false);
  const options = Object.entries(MODEL_OPTIONS.llm)
    .filter(([provider, models]) => models.length && runnable(provider))
    .flatMap(([provider, models]) => models.map((m) => ({ value: `${provider}|${m.id}`, label: m.label, group: providerName(provider) })));
  const mine = llmChoice(agent, config);
  if (mine && !options.some((o) => o.value === mine)) {
    const [provider, model] = mine.split('|');
    options.unshift({ value: mine, label: model, group: providerName(provider) });
  }
  return options;
}
export function setLlm(agent, value, config = null, providers = []) {
  const own = ownSlot(agent, 'llm');
  if (!value) {
    const rest = without(own, [...PROVIDER_KEYS, 'model']);
    return withOverride(agent, ['models', 'llm'], Object.keys(rest).length ? rest : undefined);
  }
  const [provider, model] = value.split('|');
  const fallback = readModels(config).llm.provider;
  const before = own.provider || fallback;
  let next = { ...own, model };
  if (provider !== before) {
    next = without(next, PROVIDER_KEYS);
    if (provider !== fallback) {
      next.provider = provider;
      const secret = secretFor(provider, providers);
      if (secret) next.api_key = { secret };
    }
  }
  return withOverride(agent, ['models', 'llm'], next);
}

// ---- the voice: "engine|voiceId", '' for the default (the same merging: a voice of another engine brings that engine's first model and its key)
export function voiceChoice(agent, config) {
  const tts = ownSlot(agent, 'tts');
  return tts.voice_id ? `${lower(tts.provider || readModels(config).tts.provider)}|${tts.voice_id}` : '';
}
export function defaultVoice(config) {
  const tts = readModels(config).tts;
  const voice = voiceInUse(tts);
  return voice ? `${voice.name} (${voice.engineName})` : tts.voiceId || 'Not chosen yet';
}
export function voiceOptions(agent, config = null) {
  const options = allVoices().map((v) => ({ value: `${v.engine}|${v.voiceId}`, label: `${v.name}, ${v.style.toLowerCase()}`, group: v.engineName }));
  const mine = voiceChoice(agent, config);
  if (mine && !options.some((o) => o.value === mine)) options.unshift({ value: mine, label: mine.split('|')[1], group: providerName(mine.split('|')[0]) });
  return options;
}
export function setVoice(agent, value, config = null, providers = []) {
  const own = ownSlot(agent, 'tts');
  if (!value) {
    const rest = without(own, [...PROVIDER_KEYS, 'model', 'voice_id']);
    return withOverride(agent, ['models', 'tts'], Object.keys(rest).length ? rest : undefined);
  }
  const [engine, voiceId] = value.split('|');
  const fallback = lower(readModels(config).tts.provider);
  const before = lower(own.provider || fallback);
  let next = { ...own, voice_id: voiceId };
  if (engine !== before) {
    next = without(next, [...PROVIDER_KEYS, 'model']);
    if (engine !== fallback) {
      next.provider = engine;
      const model = MODEL_OPTIONS.tts[engine]?.[0]?.id;
      if (model) next.model = model;
      const secret = secretFor(engine, providers);
      if (secret) next.api_key = { secret };
    }
  }
  return withOverride(agent, ['models', 'tts'], next);
}

// ---- whether a caller can interrupt it: true / false of its own, undefined for the default
const INTERRUPTION = ['conversation', 'turn_handling', 'interruption', 'enabled'];
export function interruptChoice(agent) {
  const value = own(agent).conversation?.turn_handling?.interruption?.enabled;
  return typeof value === 'boolean' ? value : undefined;
}
export const defaultInterrupt = (config) => config?.defaults?.conversation?.turn_handling?.interruption?.enabled !== false;
export const setInterrupt = (agent, value) => withOverride(agent, INTERRUPTION, value);
