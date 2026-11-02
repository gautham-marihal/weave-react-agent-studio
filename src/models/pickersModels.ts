// The AI models picker: an agent's three model choices (listen, think, speak) under defaults.models, read and written
// as ordinary config fields, and what the picker offers for each from the server's provider list (GET /providers) and
// the hand-kept model table (data/providers.ts). There is no fallback provider list: without the server's answer nothing
// is offered as runnable and the screen says the list could not be checked. Pure: no React, no network.
import type { AgentConfig } from '../types/studio';
import type { Provider } from '../api/types';
import { CATALOGUE_REVIEWED, FREE_TEXT_PROVIDERS, MODEL_OPTIONS, PROVIDER_STAGES, providerLabel, providerLabels, providerSecrets, type ModelStage, type ProviderModel } from '../data/providers';
import { VOICE_CATALOG, type CatalogVoice } from '../data/voiceCatalog';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const STAGES: { id: ModelStage; title: string; short: string; what: string }[] = [
  { id: 'llm', title: 'Language model', short: 'Language model', what: 'Decides what to say and which tool to use.' },
  { id: 'stt', title: 'Speech-to-text', short: 'Speech-to-text', what: 'Turns what the caller says into text.' },
  { id: 'tts', title: 'Text-to-speech', short: 'Text-to-speech', what: 'Turns the reply into speech. The voice itself is chosen under Voice.' },
];

// ---- the catalogue --------------------------------------------------------------------------------------------------
export const modelsFor = (stage: ModelStage, provider: string): ProviderModel[] => MODEL_OPTIONS[stage]?.[provider] ?? [];
export const defaultModelFor = (stage: ModelStage, provider: string): string => modelsFor(stage, provider)[0]?.id ?? '';
/** The model chosen with a provider (the first in its list) is marked "Recommended" wherever models are listed. */
export const isRecommendedModel = (stage: ModelStage, provider: string, id: string): boolean => !!id && id === defaultModelFor(stage, provider);
export const modelLabel = (stage: ModelStage, provider: string, id: string): string => modelsFor(stage, provider).find((x) => x.id === id)?.label ?? id ?? '';
export const catalogueSize = (): number => Object.values(MODEL_OPTIONS).reduce((sum, byProvider) => sum + Object.values(byProvider).reduce((n, list) => n + list.length, 0), 0);

/** The name of the secret holding a provider's key: the server's own answer first, else the usual one, else made from the name. */
export function secretFor(provider: string, providers?: Provider[] | null): string {
  const known = (providers ?? []).find((p) => p.name === provider)?.default_secret;
  if (known) return known;
  if (providerSecrets[provider]) return providerSecrets[provider];
  const name = String(provider || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[A-Z]/.test(name) ? `${name}_API_KEY` : '';
}
export const SECRET_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export type ModelState = 'listed' | 'custom' | 'free' | 'empty';
/** What the catalogue knows about a chosen model, in words. */
export function modelStatus(stage: ModelStage, provider: string, model: string): { state: ModelState; text: string } {
  const id = String(model || '').trim();
  const entry = modelsFor(stage, provider).find((x) => x.id === id);
  if (!id) return { state: 'empty', text: 'No model chosen yet. The server needs one.' };
  if (entry) return { state: 'listed', text: `${entry.label}: ${entry.note ?? ''}`.trim() };
  if (FREE_TEXT_PROVIDERS[provider] || modelsFor(stage, provider).length === 0)
    return { state: 'free', text: `${providerLabel(provider)} has no ready-made list here, so “${id}” is saved as typed. The server doesn’t check model ids.` };
  return {
    state: 'custom',
    text: `“${id}” isn’t in the catalogue (reviewed ${CATALOGUE_REVIEWED}), so it is saved as typed. The server doesn’t check model ids: make sure ${providerLabel(provider)} offers it.`,
  };
}

/** Mistakes in the model table itself, as sentences: [] when it is consistent. Run by the tests. */
export function catalogueProblems(): string[] {
  const problems: string[] = [];
  (Object.entries(MODEL_OPTIONS) as [ModelStage, Record<string, ProviderModel[]>][]).forEach(([stage, byProvider]) => {
    Object.entries(byProvider).forEach(([provider, models]) => {
      if (!(PROVIDER_STAGES[provider] ?? []).includes(stage)) problems.push(`${provider} is listed for ${stage}, which it can’t do`);
      const seen = new Set<string>();
      models.forEach((model) => {
        if (!model.id || /\s/.test(model.id)) problems.push(`${stage}/${provider}: “${model.id}” is not a usable model id`);
        if (seen.has(model.id)) problems.push(`${stage}/${provider}: ${model.id} is listed twice`);
        seen.add(model.id);
        if (!model.label || !model.note) problems.push(`${stage}/${provider}: ${model.id} needs a label and a note`);
      });
    });
  });
  Object.entries(PROVIDER_STAGES).forEach(([provider, stages]) => {
    stages.forEach((stage) => {
      if (!(provider in MODEL_OPTIONS[stage])) problems.push(`${provider} can do ${stage} but has no entry in the table`);
    });
    if (!(provider in providerLabels)) problems.push(`${provider} has no display name`);
  });
  return problems;
}

/**
 * The providers of the server's list that have a use at a stage, installed ones first, then by name. Without the
 * server's list this is empty: nothing is offered as runnable on a guess.
 */
export const providersForStage = (providers: Provider[] | null | undefined, stage: string): Provider[] =>
  (providers ?? [])
    .filter((p) => (p.stages ?? []).includes(stage as Provider['stages'][number]))
    .sort((a, b) => Number(b.installed !== false) - Number(a.installed !== false) || providerLabel(a.name).localeCompare(providerLabel(b.name)));

/** Beside a provider in a stage's choices: its technical name, whether it can run there, whether its key is set. */
export function providerOptionNote(provider: Provider, stage: string): string {
  return [
    provider.name !== providerLabel(provider.name) ? provider.name : '',
    provider.installed === false ? 'not installed on this server' : '',
    stage === 'realtime' && provider.installed !== false && provider.realtime_runnable === false ? 'the runtime can’t run its realtime model yet' : '',
    provider.default_secret && provider.key_available === false ? 'no key set on the server' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

// ---- reading and writing the config ---------------------------------------------------------------------------------
export interface ModelSlot {
  provider: string;
  model: string;
  secret: string;
  baseUrl: string;
}
export interface ModelsRead {
  stt: ModelSlot;
  llm: ModelSlot;
  tts: ModelSlot & { voiceId: string };
}

export function readModels(config: AgentConfig | null | undefined): ModelsRead {
  const models: Json = isObj(config?.defaults?.models) ? (config?.defaults?.models as Json) : {};
  const slot = (stage: ModelStage): ModelSlot => {
    const s: Json = isObj(models[stage]) ? (models[stage] as Json) : {};
    return { provider: str(s.provider), model: str(s.model), secret: isObj(s.api_key) ? str(s.api_key.secret) : '', baseUrl: str(s.base_url) };
  };
  const tts: Json = isObj(models.tts) ? (models.tts as Json) : {};
  return { stt: slot('stt'), llm: slot('llm'), tts: { ...slot('tts'), voiceId: str(tts.voice_id) } };
}

/** One line per stage for showing what an agent uses: "Language model · OpenAI · GPT-4.1 mini". */
export function summarizeModels(config: AgentConfig | null | undefined) {
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

// Writes into a copy; the same object comes back when nothing changes.
function edit(config: AgentConfig, stage: ModelStage, change: (slot: Json) => void): AgentConfig {
  const next = clone(config ?? {}) as AgentConfig;
  const defaults: Json = isObj(next.defaults) ? (next.defaults as Json) : ((next.defaults = {}) as Json);
  const models: Json = isObj(defaults.models) ? (defaults.models as Json) : ((defaults.models = {}) as Json);
  const slot: Json = { ...(isObj(models[stage]) ? (models[stage] as Json) : {}) };
  change(slot);
  models[stage] = slot;
  return JSON.stringify(next) === JSON.stringify(config) ? config : next;
}

/** A provider's voices, optionally only the Female or only the Male ones. */
export const voicesOf = (provider: string, gender?: string): CatalogVoice[] =>
  VOICE_CATALOG.filter((v) => v.provider.toLowerCase() === String(provider).toLowerCase() && (!gender || v.gender === gender));
/** The voice a provider starts with: a female one, unless it has none. */
export const defaultVoiceFor = (provider: string): CatalogVoice | undefined => voicesOf(provider, 'Female')[0] ?? voicesOf(provider)[0];

/**
 * Choosing a provider also chooses its first model, the name of its key's secret and (for speech) a voice. The rest of
 * the slot (language, fallbacks…) stays; an address and options belonged to the provider chosen before and go.
 */
export function setProvider(config: AgentConfig, stage: ModelStage, provider: string, providers?: Provider[] | null): AgentConfig {
  if (readModels(config)[stage].provider === provider) return config;
  return edit(config, stage, (slot) => {
    slot.provider = provider;
    const model = defaultModelFor(stage, provider);
    if (model) slot.model = model;
    else delete slot.model;
    // a service of your own has no usual key name: only the one the server names, if any
    const named = (providers ?? []).find((p) => p.name === provider)?.default_secret;
    const secret = FREE_TEXT_PROVIDERS[provider] ? named ?? '' : secretFor(provider, providers);
    if (secret) slot.api_key = { secret };
    else delete slot.api_key;
    delete slot.base_url;
    delete slot.options;
    if (stage === 'tts') {
      const voice = defaultVoiceFor(provider);
      if (voice) slot.voice_id = voice.voiceId;
      else delete slot.voice_id;
    }
  });
}

export function setModel(config: AgentConfig, stage: ModelStage, model: string): AgentConfig {
  const value = String(model || '').trim();
  if (readModels(config)[stage].model === value) return config;
  return edit(config, stage, (slot) => {
    if (value) slot.model = value;
    else delete slot.model;
  });
}

export function setVoiceId(config: AgentConfig, voiceId: string): AgentConfig {
  const value = String(voiceId || '').trim();
  if (readModels(config).tts.voiceId === value) return config;
  return edit(config, 'tts', (slot) => {
    if (value) slot.voice_id = value;
    else delete slot.voice_id;
  });
}

/** A catalogue voice becomes the agent's voice: its engine (with that engine's model and key) and its voice id. */
export function applyVoice(config: AgentConfig, voice: { provider: string; voiceId: string }, providers?: Provider[] | null): AgentConfig {
  const withProvider = voice.provider ? setProvider(config, 'tts', voice.provider.toLowerCase(), providers) : config;
  return setVoiceId(withProvider, voice.voiceId);
}

export interface SlotProblem {
  short: string;
  text: string;
}
/**
 * What would stop a stage starting with its chosen provider, per GET /providers: not runnable, or its key not set.
 * Null when nothing is chosen, nothing is wrong, or the list is not known (the screen says that separately).
 */
export function slotProblem(stage: ModelStage, slot: Pick<ModelSlot, 'provider'> | null | undefined, providers: Provider[] | null | undefined): SlotProblem | null {
  if (!slot?.provider || !providers?.length) return null;
  const current = providers.find((p) => p.name === slot.provider);
  const runnable = current && current.installed !== false && (current.stages ?? []).includes(stage);
  if (!current || !runnable) return { short: 'Can’t run', text: `The server can’t run “${slot.provider}” for this. Choose one from the list.` };
  if (current.default_secret && current.key_available === false)
    return { short: 'Key missing', text: `The server doesn’t have ${current.default_secret} set, so a call would fail to start until it does.` };
  return null;
}

// ---- what the picker lists ------------------------------------------------------------------------------------------
const norm = (text: unknown) =>
  String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
export const matches = (query: string, ...parts: unknown[]): boolean => {
  const q = norm(query).trim();
  return !q || parts.some((p) => norm(p).includes(q));
};

export interface ModelRow {
  provider: string;
  providerName: string;
  id: string;
  label: string;
  note: string;
  tags: string[];
  recommended: boolean;
  installed: boolean;
  /** The secret the server says is not set, or ''. */
  keyMissing: string;
  selected: boolean;
}

/**
 * The models offered for a part of the call: the catalogue models of every provider the server lists for it, matching
 * the search and provider filter, the one in use first, then what the server can run. The provider in use is kept
 * even when the server didn't list it, so it can be seen.
 */
export function modelRows({ stage, providers, query = '', provider = '', current = { provider: '', model: '' } }: { stage: ModelStage; providers: Provider[] | null | undefined; query?: string; provider?: string; current?: { provider: string; model: string } }): ModelRow[] {
  const rows: ModelRow[] = [];
  providersForStage(providers, stage).forEach((p) => {
    if (provider && p.name !== provider) return;
    modelsFor(stage, p.name).forEach((x) => {
      if (!matches(query, x.label, x.id, x.note, providerLabel(p.name), (x.tags ?? []).join(' '))) return;
      rows.push({
        provider: p.name,
        providerName: providerLabel(p.name),
        id: x.id,
        label: x.label,
        note: x.note ?? '',
        tags: x.tags ?? [],
        recommended: isRecommendedModel(stage, p.name, x.id),
        installed: p.installed !== false,
        keyMissing: p.default_secret && p.key_available === false ? p.default_secret : '',
        selected: p.name === current.provider && x.id === current.model,
      });
    });
  });
  return rows.sort((a, b) => Number(b.selected) - Number(a.selected) || Number(b.installed) - Number(a.installed));
}

/** The providers to filter by, each with how many models it offers for this part of the call. */
export function providerChips({ stage, providers }: { stage: ModelStage; providers: Provider[] | null | undefined }) {
  return providersForStage(providers, stage)
    .map((p) => ({ value: p.name, label: providerLabel(p.name), count: modelsFor(stage, p.name).length, installed: p.installed !== false }))
    .filter((p) => p.count > 0);
}

// ---- the Provider and Model boxes of the full settings form -----------------------------------------------------------
const MODEL_STAGES = ['stt', 'llm', 'tts', 'realtime', 'vad', 'turn_detector'];
/**
 * Which part of a call a Provider or Model box is for: 'llm' for defaults.models.llm.model and for its fallbacks too;
 * null for any other setting called "model" or "provider".
 */
export function modelStageOf(path: Array<string | number>): string | null {
  const leaf = path[path.length - 1];
  if (leaf !== 'provider' && leaf !== 'model') return null;
  if (!path.includes('models')) return null;
  for (let i = path.length - 2; i >= 0; i -= 1) if (MODEL_STAGES.includes(String(path[i]))) return String(path[i]);
  return null;
}

export interface FieldOption {
  value: string;
  label: string;
  description: string;
}
/**
 * The list a Provider or Model box offers (anything else can still be typed): for a provider, the ones the server lists
 * for that stage (the turn detector from the server's own list); for a model, the catalogue's models of the provider
 * beside it. Empty when nothing is known (the box is then plain text).
 */
export function modelFieldOptions({ stage, leaf, provider = '', providers, turnDetectors = [] }: { stage: string; leaf: 'provider' | 'model'; provider?: string; providers: Provider[] | null | undefined; turnDetectors?: string[] }): FieldOption[] {
  if (leaf === 'provider' && stage === 'turn_detector') return turnDetectors.map((name) => ({ value: name, label: providerLabel(name), description: name !== providerLabel(name) ? name : '' }));
  if (leaf === 'provider') return providersForStage(providers, stage).map((p) => ({ value: p.name, label: providerLabel(p.name), description: providerOptionNote(p, stage) }));
  if (stage !== 'stt' && stage !== 'llm' && stage !== 'tts') return [];
  return modelsFor(stage, provider).map((x) => ({
    value: x.id,
    label: isRecommendedModel(stage, provider, x.id) ? `${x.label} · Recommended` : x.label,
    description: [x.id !== x.label ? x.id : '', x.note].filter(Boolean).join(' · '),
  }));
}
