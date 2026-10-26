// The providers and models offered when choosing how an agent listens, thinks and speaks.
//
// The list of providers comes from the server (GET /providers: what the runtime can run, which plugins are installed,
// whether a key is set), see useProviders.js. FALLBACK_PROVIDERS below is only what the screen shows when the server
// can't be reached; it is the set the server image ships with.
//
// A model list is a convenience, not a guarantee: the provider decides what its account can use, so every picker also
// accepts any other model id (and the server does not check model ids at all).
// This is a CATALOGUE kept in this file and reviewed by hand (CATALOGUE_REVIEWED): it is not a live check of what a provider or an
// account offers. To add a model, add a line under its stage and provider below; `catalogueProblems()` (run by the tests) checks that the
// table is consistent.
// Pure data and a few helpers: no network, no DOM.

export const CATALOGUE_REVIEWED = '2026-10-14';

const m = (id, label, note, tags = []) => ({ id, label, note, tags });

export const PROVIDER_LABELS = {
  openai: 'OpenAI',
  openai_compatible: 'OpenAI-compatible',
  elevenlabs: 'ElevenLabs',
  deepgram: 'Deepgram',
  cartesia: 'Cartesia',
  anthropic: 'Anthropic',
  google: 'Google',
  groq: 'Groq',
  assemblyai: 'AssemblyAI',
  silero: 'Silero',
  // turn detectors
  'livekit-multilingual': 'LiveKit multilingual',
  'livekit-english': 'LiveKit English',
};

// What the server image ships with (plugins installed), by stage. Used only while the real list is unavailable.
export const FALLBACK_PROVIDERS = [
  {
    name: 'openai',
    stages: ['stt', 'llm', 'tts', 'realtime'],
    installed: true,
    realtime_runnable: true,
    default_secret: 'OPENAI_API_KEY',
    key_available: null,
  },
  { name: 'openai_compatible', stages: ['stt', 'llm', 'tts'], installed: true, default_secret: 'OPENAI_API_KEY', key_available: null },
  { name: 'anthropic', stages: ['llm'], installed: true, default_secret: 'ANTHROPIC_API_KEY', key_available: null },
  { name: 'deepgram', stages: ['stt', 'tts'], installed: true, default_secret: 'DEEPGRAM_API_KEY', key_available: null },
  { name: 'cartesia', stages: ['stt', 'tts'], installed: true, default_secret: 'CARTESIA_API_KEY', key_available: null },
  { name: 'elevenlabs', stages: ['stt', 'tts'], installed: true, default_secret: 'ELEVEN_API_KEY', key_available: null },
  { name: 'silero', stages: ['vad'], installed: true, default_secret: null, key_available: null },
];

export const MODEL_OPTIONS = {
  stt: {
    openai: [
      m('gpt-realtime-whisper', 'GPT Realtime Whisper', 'Streaming transcription for live calls', ['live calls']),
      m('gpt-4o-transcribe', 'GPT-4o Transcribe', 'High-accuracy speech recognition', ['accurate']),
      m('gpt-4o-mini-transcribe', 'GPT-4o Mini Transcribe', 'Lower-latency, cost-conscious transcription', ['fast']),
      m('whisper-1', 'Whisper 1', 'General-purpose transcription'),
      m('gpt-4o-transcribe-diarize', 'GPT-4o Transcribe Diarize', 'Transcription with speaker labels'),
      m('gpt-4o-mini-transcribe-2025-03-20', 'GPT-4o Mini Transcribe (Snapshot)', 'Pinned model snapshot where supported'),
    ],
    deepgram: [
      m('nova-3', 'Nova-3', 'Latest-generation speech recognition', ['accurate', 'live calls']),
      m('nova-2', 'Nova-2', 'Balanced accuracy and speed'),
      m('nova-2-general', 'Nova-2 General', 'General conversation transcription'),
      m('nova-2-phonecall', 'Nova-2 Phonecall', 'Optimized for telephone audio', ['phone']),
    ],
    cartesia: [m('ink-whisper', 'Ink Whisper', 'Cartesia’s streaming speech recognition')],
    elevenlabs: [m('scribe_v1', 'Scribe v1', 'ElevenLabs speech recognition')],
    assemblyai: [m('universal-streaming', 'Universal Streaming', 'Real-time streaming transcription')],
    google: [m('chirp_2', 'Chirp 2', 'Multilingual speech recognition'), m('latest_long', 'Latest Long', 'Long-form conversation')],
    groq: [
      m('whisper-large-v3', 'Whisper Large v3', 'High-accuracy multilingual recognition'),
      m('whisper-large-v3-turbo', 'Whisper Large v3 Turbo', 'Faster large-model variant'),
    ],
    openai_compatible: [],
  },
  llm: {
    openai: [
      m('gpt-5.4', 'GPT-5.4', 'Advanced reasoning and complex tasks', ['most capable']),
      m('gpt-5.4-mini', 'GPT-5.4 Mini', 'Balanced speed and capability'),
      m('gpt-5.4-nano', 'GPT-5.4 Nano', 'Lightweight, low-latency tasks', ['fast']),
      m('gpt-4.1', 'GPT-4.1', 'Strong general-purpose model'),
      m('gpt-4.1-mini', 'GPT-4.1 Mini', 'Efficient general-purpose model'),
    ],
    anthropic: [
      m('claude-sonnet-5-5', 'Claude Sonnet 5.5', 'Balanced quality and speed'),
      m('claude-haiku-5-5', 'Claude Haiku 5.5', 'Fastest, for low-latency replies', ['fast']),
      m('claude-opus-5-5', 'Claude Opus 5.5', 'Most capable, for complex tasks', ['most capable']),
      m('claude-fable-5-1', 'Claude Fable 5.1', 'Latest generation'),
    ],
    google: [
      m('gemini-2.5-flash', 'Gemini 2.5 Flash', 'Fast, general purpose'),
      m('gemini-2.5-pro', 'Gemini 2.5 Pro', 'Advanced reasoning'),
      m('gemini-2.0-flash', 'Gemini 2.0 Flash', 'Previous generation, low latency'),
    ],
    groq: [
      m('llama-3.3-70b-versatile', 'Llama 3.3 70B', 'Capable open model, fast on Groq'),
      m('llama-3.1-8b-instant', 'Llama 3.1 8B', 'Lightweight, lowest latency'),
    ],
    openai_compatible: [],
  },
  tts: {
    elevenlabs: [
      m('eleven_flash_v2_5', 'Flash v2.5', 'Lowest latency, best for live calls', ['fast', 'live calls']),
      m('eleven_turbo_v2_5', 'Turbo v2.5', 'Fast, with higher quality than Flash'),
      m('eleven_multilingual_v2', 'Multilingual v2', 'Highest quality across many languages', ['multilingual']),
      m('eleven_v3', 'v3', 'Most expressive; slower, for quality over speed'),
    ],
    cartesia: [
      m('sonic-3', 'Sonic 3', 'Latest generation, natural and expressive'),
      m('sonic-2', 'Sonic 2', 'Previous generation, widely compatible'),
      m('sonic-turbo', 'Sonic Turbo', 'Lowest latency', ['fast']),
    ],
    openai: [
      m('gpt-4o-mini-tts', 'GPT-4o Mini TTS', 'Steerable, natural voices'),
      m('tts-1', 'TTS 1', 'Fast, standard quality'),
      m('tts-1-hd', 'TTS 1 HD', 'Higher quality'),
    ],
    deepgram: [m('aura-2-thalia-en', 'Aura 2 Thalia', 'English voice, Aura 2'), m('aura-asteria-en', 'Aura Asteria', 'English voice, Aura')],
    google: [],
    groq: [],
    openai_compatible: [],
  },
};

// Names that used to be offered (they come from the older XML configuration) and what the runtime calls the same
// thing. The server refuses them, so an agent that has one is offered the fix.
export const RENAMED_PROVIDERS = {
  whisper: {
    stages: ['stt'],
    provider: 'openai',
    model: 'whisper-1',
    why: '“Whisper” is an OpenAI model, not a provider. Use OpenAI with the model whisper-1.',
  },
  'gpt-transcribe': {
    stages: ['stt'],
    provider: 'openai',
    model: 'gpt-4o-transcribe',
    why: '“GPT Transcribe” is an OpenAI model, not a provider. Use OpenAI with the model gpt-4o-transcribe.',
  },
  mistral: {
    stages: ['llm'],
    provider: 'openai_compatible',
    model: 'mistral-small-latest',
    baseUrl: 'https://api.mistral.ai/v1',
    secret: 'MISTRAL_API_KEY',
    needsBaseUrl: true,
    why: 'Mistral is reached through an OpenAI-compatible endpoint. The switch fills in Mistral’s address and a model; check them and make sure MISTRAL_API_KEY is set on the server.',
  },
  'microsoft phi-4': {
    stages: ['llm'],
    provider: 'openai_compatible',
    model: 'phi-4',
    needsBaseUrl: true,
    why: 'Phi-4 is reached through an OpenAI-compatible endpoint. The switch moves it to OpenAI-compatible; then enter the base URL of where Phi-4 is hosted.',
  },
};

// The name, in the server's vault, of the secret that holds a provider's key (credentials are never in the
// configuration, only this name). The server's own list says which one each provider uses; this is the fallback.
export const SECRET_BY_PROVIDER = Object.fromEntries(
  FALLBACK_PROVIDERS.filter((provider) => provider.default_secret).map((provider) => [provider.name, provider.default_secret]),
);
export function secretFor(provider, providers) {
  const known = (providers || []).find((item) => item.name === provider)?.default_secret;
  if (known) return known;
  if (SECRET_BY_PROVIDER[provider]) return SECRET_BY_PROVIDER[provider];
  const name = String(provider || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[A-Z]/.test(name) ? `${name}_API_KEY` : '';
}

export const STAGES = [
  {
    id: 'stt',
    title: 'Speech-to-text (STT)',
    short: 'Speech-to-text',
    subtitle: 'Choose a provider, then choose the specific speech recognition model.',
    modelHeading: 'Speech recognition model',
  },
  {
    id: 'llm',
    title: 'Language model (LLM)',
    short: 'Language model',
    subtitle: 'Choose a provider, then select the model that best fits your assistant.',
    modelHeading: 'Reasoning model',
  },
  {
    id: 'tts',
    title: 'Text-to-speech (TTS)',
    short: 'Text-to-speech',
    subtitle: 'Choose a provider, then the voice model, then the voice.',
    modelHeading: 'Voice model',
  },
];

export const providerLabel = (provider = '') =>
  PROVIDER_LABELS[String(provider).toLowerCase()] ||
  String(provider)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
export const modelsFor = (stage, provider) => MODEL_OPTIONS[stage]?.[provider] || [];
export const defaultModelFor = (stage, provider) => modelsFor(stage, provider)[0]?.id || '';
// The model the studio picks when someone chooses this provider (the first in its list): marked "Recommended" wherever the models are listed.
export const isRecommendedModel = (stage, provider, id) => !!id && id === defaultModelFor(stage, provider);
export const modelLabel = (stage, provider, id) => modelsFor(stage, provider).find((model) => model.id === id)?.label || id || '';

// The providers of one stage out of a server list (or the fallback): the ones the runtime has a use for at that stage.
// What to say beside a provider in a list of choices for a stage: its technical name, whether it can run there (GET /providers: `installed`,
// `realtime_runnable` for a speech-to-speech model) and whether its usual key is set on the server.
export function providerOptionNote(provider, stage) {
  return [
    provider.name !== providerLabel(provider.name) ? provider.name : '',
    provider.installed === false ? 'not installed on this server' : '',
    stage === 'realtime' && provider.installed !== false && provider.realtime_runnable === false ? 'the runtime can’t run its realtime model yet' : '',
    provider.default_secret && provider.key_available === false ? 'no key set on the server' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

// The turn detectors the runtime can run (GET /providers' `turn_detectors`), while the server can't be asked.
export const FALLBACK_TURN_DETECTORS = ['livekit-multilingual', 'livekit-english'];

export const providersForStage = (providers, stage) =>
  (providers || FALLBACK_PROVIDERS)
    .filter((provider) => (provider.stages || []).includes(stage))
    .sort((a, b) => Number(b.installed !== false) - Number(a.installed !== false) || providerLabel(a.name).localeCompare(providerLabel(b.name)));

// ---- what each provider can do, by stage (the runtime's own list is GET /providers; this is the catalogue's copy, used to check the table
// and to say sensible things when the server can't be asked)
export const PROVIDER_STAGES = {
  openai: ['stt', 'llm', 'tts'],
  openai_compatible: ['stt', 'llm', 'tts'],
  anthropic: ['llm'],
  google: ['stt', 'llm', 'tts'],
  groq: ['stt', 'llm', 'tts'],
  deepgram: ['stt', 'tts'],
  cartesia: ['stt', 'tts'],
  elevenlabs: ['stt', 'tts'],
  assemblyai: ['stt'],
};

// Providers with no list of their own: the model is whatever the service serves, so it is typed.
export const FREE_TEXT_PROVIDERS = {
  openai_compatible: 'This is any service that speaks the OpenAI API (Mistral, Azure, a local model server…). Type the model id it serves.',
};

export const catalogueSize = () =>
  Object.values(MODEL_OPTIONS).reduce((sum, byProvider) => sum + Object.values(byProvider).reduce((n, models) => n + models.length, 0), 0);

// What the catalogue knows about a model: { state: 'listed' | 'custom' | 'free' | 'empty', entry?, text }.
//   listed  it is in the table;  custom  typed by someone, not in the table (saved as typed);
//   free    the provider has no list, so any id is expected;  empty  nothing chosen yet.
export function modelStatus(stage, provider, model) {
  const id = String(model || '').trim();
  const entry = modelsFor(stage, provider).find((item) => item.id === id);
  if (!id) return { state: 'empty', text: 'No model chosen yet. The server needs one.' };
  if (entry) return { state: 'listed', entry, text: `${entry.label}: ${entry.note}.` };
  if (FREE_TEXT_PROVIDERS[provider] || modelsFor(stage, provider).length === 0)
    return { state: 'free', text: `${providerLabel(provider)} has no ready-made list here, so “${id}” is saved as typed. The server doesn’t check model ids.` };
  return {
    state: 'custom',
    text: `“${id}” isn’t in the catalogue (reviewed ${CATALOGUE_REVIEWED}), so it is saved as typed. The server doesn’t check model ids: make sure ${providerLabel(provider)} offers it.`,
  };
}

// Mistakes in the table itself, as readable strings: [] when it is consistent. Run by the tests.
export function catalogueProblems() {
  const problems = [];
  Object.entries(MODEL_OPTIONS).forEach(([stage, byProvider]) => {
    Object.entries(byProvider).forEach(([provider, models]) => {
      if (!(PROVIDER_STAGES[provider] || []).includes(stage)) problems.push(`${provider} is listed for ${stage}, which it can’t do`);
      const seen = new Set();
      models.forEach((model) => {
        if (!model.id || /\s/.test(model.id)) problems.push(`${stage}/${provider}: “${model.id}” is not a usable model id`);
        if (seen.has(model.id)) problems.push(`${stage}/${provider}: ${model.id} is listed twice`);
        seen.add(model.id);
        if (!model.label || !model.note) problems.push(`${stage}/${provider}: ${model.id} needs a label and a note`);
        if (!Array.isArray(model.tags)) problems.push(`${stage}/${provider}: ${model.id} needs tags (even an empty list)`);
      });
    });
  });
  Object.entries(PROVIDER_STAGES).forEach(([provider, stages]) => {
    stages.forEach((stage) => {
      if (!(provider in (MODEL_OPTIONS[stage] || {})))
        problems.push(`${provider} can do ${stage} but has no entry in the table (an empty list is fine for free-text providers)`);
    });
    if (!(provider in PROVIDER_LABELS)) problems.push(`${provider} has no display name`);
  });
  FALLBACK_PROVIDERS.forEach((provider) =>
    (provider.stages || [])
      .filter((stage) => ['stt', 'llm', 'tts'].includes(stage))
      .forEach((stage) => {
        if (!(PROVIDER_STAGES[provider.name] || []).includes(stage))
          problems.push(`the fallback list offers ${provider.name} for ${stage}, but the catalogue doesn’t know it does that`);
      }),
  );
  return problems;
}
